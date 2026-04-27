/**
 * POST /api/ideator/generate
 *
 * The single v1 ideator endpoint. Conditioned on the requesting
 * creator's persisted Style Profile + the static regional trend
 * bundle. One creator gets at most TWO batches per UTC day (one
 * normal + one regenerate) — enforced via `consumeQuota('idea_batch')`.
 *
 * Request body (all optional):
 *   { region?: Region, count?: number (1-20), regenerate?: boolean,
 *     styleProfile?: StyleProfile }
 *
 * If `region` is omitted, falls back to `creators.region`. If that is
 * also null, defaults to `western`. The `styleProfile` field exists so
 * curl-based quality testing can pass a synthesized profile without
 * first persisting one.
 */

import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client";
import { resolveCreator } from "../lib/resolveCreator";
import { generateIdeas } from "../lib/ideaGen";
import { isRegion, type Region } from "@workspace/lumina-trends";
import { styleProfileSchema, type StyleProfile } from "../lib/styleProfile";
import { consumeQuota, refundQuota } from "../lib/quota";
import { DailyCapExceededError } from "../lib/aiCost";

const router: IRouter = Router();

const bodySchema = z.object({
  region: z.string().optional(),
  count: z.number().int().min(1).max(20).optional(),
  regenerate: z.boolean().optional(),
  // Allow a partial profile so curl callers don't have to spell out
  // every default. styleProfileSchema fills the rest.
  styleProfile: z.record(z.unknown()).optional(),
});

router.post("/ideator/generate", async (req, res, next) => {
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

    // Resolve region: explicit > persisted > default 'western'.
    const persistedRegion =
      (creator as { region?: string | null }).region ?? null;
    const candidateRegion =
      body.region ?? persistedRegion ?? "western";
    if (!isRegion(candidateRegion)) {
      res.status(400).json({
        error: "invalid_region",
        message: `region must be one of western|india|philippines|nigeria, got: ${candidateRegion}`,
      });
      return;
    }
    const region: Region = candidateRegion;

    // Resolve style profile: explicit body > persisted > defaults.
    let styleProfile: StyleProfile;
    if (body.styleProfile) {
      const sp = styleProfileSchema.safeParse(body.styleProfile);
      if (!sp.success) {
        res.status(400).json({
          error: "invalid_style_profile",
          details: sp.error.flatten(),
        });
        return;
      }
      styleProfile = sp.data;
    } else {
      const persisted = (creator as { styleProfileJson?: unknown })
        .styleProfileJson;
      if (persisted && typeof persisted === "object") {
        const sp = styleProfileSchema.safeParse(persisted);
        styleProfile = sp.success ? sp.data : styleProfileSchema.parse({});
      } else {
        styleProfile = styleProfileSchema.parse({});
      }
    }

    // Daily quota: 2 batches per creator per UTC day (1 normal + 1
    // regenerate). Real creators only — demo creator (curl) bypasses
    // so quality testing isn't blocked at idea 21.
    let consumed = false;
    if (!creator.isDemo) {
      const q = await consumeQuota(creator.id, "idea_batch");
      if (!q.ok) {
        res.status(429).json({
          error: "daily_cap_reached",
          message: `Daily idea-batch cap reached (${q.count}/${q.limit}). Resets at UTC midnight.`,
          count: q.count,
          limit: q.limit,
        });
        return;
      }
      consumed = true;
    }

    let result;
    try {
      result = await generateIdeas({
        region,
        styleProfile,
        count: body.count ?? 3,
        regenerate: body.regenerate ?? false,
        // Thread the already-loaded calibration jsonb through so
        // generateIdeas does NOT re-SELECT the creator row.
        // resolveCreator returns the full creator (`.select()`),
        // so this field is always present (may be null).
        tasteCalibrationJson: creator.tasteCalibrationJson,
        // Memory is left undefined here so generateIdeas runs the
        // aggregator itself — the SELECT is on the indexed tables
        // (creator_id, created_at desc), so it's cheap and we don't
        // want every caller of generateIdeas to need to know about
        // the helper.
        ctx: { creatorId: creator.id },
      });
    } catch (err) {
      // Refund quota if the call failed before producing ideas, so a
      // transient AI blip doesn't permanently burn a slot.
      if (consumed) await refundQuota(creator.id, "idea_batch");
      if (err instanceof DailyCapExceededError) {
        res.status(429).json({
          error: "ai_daily_cost_cap_reached",
          message: err.message,
        });
        return;
      }
      throw err;
    }

    // Stamp the batch timestamp so we can reason about freshness later
    // (e.g. "show today's ideas if last_idea_batch_at is today").
    if (!creator.isDemo) {
      await db
        .update(schema.creators)
        .set({ lastIdeaBatchAt: sql`now()` } as Record<string, unknown>)
        .where(eq(schema.creators.id, creator.id));
    }

    res.json({
      region,
      count: result.ideas.length,
      regenerate: body.regenerate ?? false,
      ideas: result.ideas,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
