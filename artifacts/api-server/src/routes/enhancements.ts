/**
 * POST /api/enhancements/suggest
 *
 * The single entry point for the ENHANCEMENT BRAIN — analyses one
 * filmed/uploaded video idea against the SAME logic stack the
 * ideator uses (style hints, viral pattern memory) and returns
 * 1–3 short, actionable, non-technical suggestions.
 *
 * The route is a thin adapter: it loads the creator's persisted
 * Style Profile, derives style hints, computes the per-creator
 * viral pattern memory, and hands a fully-shaped EnhancementInput
 * to `enhanceVideo`. All the actual reasoning lives in the brain
 * module so the route stays trivially testable and readable.
 *
 * Request body (all optional except originalIdea.hook):
 *   {
 *     originalIdea: { hook: string; concept?: string;
 *                     pattern?: string; structure?: string;
 *                     hookStyle?: string; emotionalSpike?: string },
 *     videoDescription?: string,
 *     transcript?: string,
 *   }
 *
 * Response 200:
 *   { title: string, suggestions: string[] }   // 1..3
 *
 * Errors:
 *   401 no_creator     — request did not resolve to a known creator
 *   400 invalid_body   — body failed Zod validation
 *   429 ai_daily_cost_cap_reached — creator hit their daily $ ceiling
 *   503 ai_unavailable — AI integration env vars missing
 *   500 internal_error — anything else (logged server-side)
 *
 * Quota note: this route does NOT consume the `idea_batch` quota —
 * that quota is reserved for whole-batch idea generation. Daily $
 * cost is still capped per-creator inside `callJsonAgent` so a
 * runaway loop can't burn unbounded credit; the cap is shared with
 * the ideator and other AI-backed routes.
 */

import { Router, type IRouter } from "express";
import { z } from "zod";

import { resolveCreator } from "../lib/resolveCreator";
import {
  styleProfileSchema,
  deriveStyleHints,
  type StyleProfile,
} from "../lib/styleProfile";
import { computeViralPatternMemory } from "../lib/viralPatternMemory";
import { DailyCapExceededError } from "../lib/aiCost";
import { logger } from "../lib/logger";
import {
  enhanceVideo,
  type EnhancementMemorySummary,
} from "../lib/enhancementBrain";

const router: IRouter = Router();

const bodySchema = z.object({
  originalIdea: z.object({
    hook: z.string().trim().min(1).max(280),
    concept: z.string().trim().max(2_000).optional(),
    pattern: z.string().trim().max(64).optional(),
    structure: z.string().trim().max(64).optional(),
    hookStyle: z.string().trim().max(64).optional(),
    emotionalSpike: z.string().trim().max(64).optional(),
  }),
  videoDescription: z.string().trim().max(4_000).optional(),
  transcript: z.string().trim().max(8_000).optional(),
});

/**
 * Pick the top-N tag names from a `Record<tag, weight>` map, sorted
 * by descending weight. Mirrors how the ideator's prompt block
 * surfaces "what tends to land" — top names only, weights elided
 * because the brain just needs the list.
 */
function topTags(map: Record<string, number>, n: number): string[] {
  return Object.entries(map)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([name]) => name);
}

router.post("/enhancements/suggest", async (req, res, next) => {
  try {
    const parsed = bodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "invalid_body",
        details: parsed.error.flatten(),
      });
      return;
    }
    const body = parsed.data;

    const resolution = await resolveCreator(req);
    if (resolution.kind !== "found") {
      res.status(401).json({ error: "no_creator" });
      return;
    }
    const creator = resolution.creator;

    // Resolve persisted style profile → derived style hints. Mirrors
    // the ideator's resolution path: persisted JSON > defaults.
    const persisted = (creator as { styleProfileJson?: unknown })
      .styleProfileJson;
    let styleProfile: StyleProfile;
    if (persisted && typeof persisted === "object") {
      const sp = styleProfileSchema.safeParse(persisted);
      styleProfile = sp.success ? sp.data : styleProfileSchema.parse({});
    } else {
      styleProfile = styleProfileSchema.parse({});
    }
    const styleHints = deriveStyleHints(styleProfile);

    // Compute viral pattern memory (NEVER throws — returns
    // EMPTY_MEMORY on failure so the brain still ships).
    const viralMemory = await computeViralPatternMemory(creator.id);

    const memory: EnhancementMemorySummary = {
      topStructures: topTags(viralMemory.structures, 3),
      topHookStyles: topTags(viralMemory.hookStyles, 3),
      topEmotionalSpikes: topTags(viralMemory.emotionalSpikes, 3),
      topFormats: topTags(viralMemory.formats, 3),
      sampleSize: viralMemory.sampleSize,
    };

    let result;
    try {
      result = await enhanceVideo(
        {
          originalIdea: body.originalIdea,
          videoDescription: body.videoDescription ?? null,
          transcript: body.transcript ?? null,
          styleHints,
          memory,
          recentAcceptedPatterns: viralMemory.recentAcceptedPatterns,
          recentRejectedPatterns: viralMemory.recentRejectedPatterns,
        },
        { creatorId: creator.id, agent: "enhancement_brain" },
      );
    } catch (err) {
      if (err instanceof DailyCapExceededError) {
        res.status(429).json({
          error: "ai_daily_cost_cap_reached",
          message:
            "Daily AI cost cap reached. Try again tomorrow at UTC midnight.",
        });
        return;
      }
      // Missing AI env vars (the warning at module load) surfaces
      // here as a fetch-level error from the SDK. Map to 503 so the
      // client can render a clean "try again later" instead of a
      // generic crash.
      const msg = err instanceof Error ? err.message : String(err);
      if (
        /missing/i.test(msg) ||
        /api key/i.test(msg) ||
        /baseurl/i.test(msg) ||
        /unauthor/i.test(msg)
      ) {
        logger.warn(
          { err, creatorId: creator.id },
          "[enhancements] AI integration unavailable",
        );
        res.status(503).json({ error: "ai_unavailable" });
        return;
      }
      throw err;
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
