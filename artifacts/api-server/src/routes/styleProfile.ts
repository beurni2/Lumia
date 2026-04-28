/**
 * GET  /api/style-profile        — read the current creator's profile
 * POST /api/style-profile        — upsert the current creator's profile
 *                                  + optional region update
 *
 * The profile is a single JSON document persisted on
 * `creators.style_profile_json`. Region lives in `creators.region` as
 * a varchar(16) so we can index/filter on it cheaply and avoid
 * reaching into the JSON for the most common read.
 *
 * There is no DELETE — the consent-withdraw flow handles full erasure
 * via the existing `/api/me` surface.
 */

import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { resolveCreator } from "../lib/resolveCreator";
import {
  deriveStyleHints,
  deriveTone,
  styleProfileSchema,
  type DerivedStyleHints,
  type DerivedTone,
  type StyleProfile,
} from "../lib/styleProfile";
import { computeViralPatternMemory } from "../lib/viralPatternMemory";
import { isRegion, type Region } from "@workspace/lumina-trends";
import { z } from "zod";

const router: IRouter = Router();

/**
 * Picks the top-N entries from a Record<tag, weight> map. Returns
 * `{ name, weight }` pairs ordered descending by weight, dropping
 * entries with zero/negative weight (they shouldn't be surfaced as
 * "what's working"). Used by the Studio summary block below.
 */
function topEntries(
  bag: Record<string, number>,
  n: number,
): { name: string; weight: number }[] {
  return Object.entries(bag)
    .filter(([, w]) => typeof w === "number" && w > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([name, weight]) => ({ name, weight }));
}

/**
 * Compact, UI-friendly slice of `ViralPatternMemory` — what the Studio
 * tab needs to render the "Your Creator Style" + "What's Working"
 * sections without re-implementing weight aggregation client-side.
 *
 * Pure projection of existing fields, no new logic. Top-3 per
 * dimension, top-1 emotional spike, top-1 pattern format, plus the
 * existing `sampleSize` so the client can decide how loudly to talk
 * about the data.
 */
type ViralMemorySummary = {
  topStructures: { name: string; weight: number }[];
  topHookStyles: { name: string; weight: number }[];
  topFormats: { name: string; weight: number }[];
  topEmotionalSpike: string | null;
  topFormat: string | null;
  sampleSize: number;
};

router.get("/style-profile", async (req, res, next) => {
  try {
    const r = await resolveCreator(req);
    if (r.kind !== "found") {
      res.status(401).json({ error: "no_creator" });
      return;
    }
    const c = r.creator as typeof r.creator & {
      styleProfileJson?: unknown;
      region?: string | null;
      lastIdeaBatchAt?: Date | null;
    };
    const persisted = c.styleProfileJson;
    let profile: StyleProfile | null = null;
    if (persisted && typeof persisted === "object") {
      const sp = styleProfileSchema.safeParse(persisted);
      profile = sp.success ? sp.data : null;
    }

    // ADDITIVE — Studio control-centre needs derived tone + style
    // hints + a small viral-memory summary in the same payload so
    // the mobile client doesn't need to fan out to 3 endpoints just
    // to render the top card. All values come from existing pure
    // helpers; no new aggregation logic lives here.
    let derivedTone: DerivedTone | null = null;
    let derivedStyleHints: DerivedStyleHints | null = null;
    if (profile !== null) {
      derivedTone = deriveTone(profile);
      derivedStyleHints = deriveStyleHints(profile);
    }

    // computeViralPatternMemory NEVER throws — it returns EMPTY_MEMORY
    // for new creators (sampleSize === 0) so the client can render an
    // honest "no data yet" state without the route needing a try/catch.
    const memory = await computeViralPatternMemory(r.creator.id);
    const topFormats = topEntries(memory.formats, 3);
    const viralMemory: ViralMemorySummary = {
      topStructures: topEntries(memory.structures, 3),
      topHookStyles: topEntries(memory.hookStyles, 3),
      topFormats,
      topEmotionalSpike: topEntries(memory.emotionalSpikes, 1)[0]?.name ?? null,
      topFormat: topFormats[0]?.name ?? null,
      sampleSize: memory.sampleSize,
    };

    res.json({
      hasProfile: profile !== null,
      profile,
      region: c.region ?? null,
      lastIdeaBatchAt: c.lastIdeaBatchAt ?? null,
      derivedTone,
      derivedStyleHints,
      viralMemory,
    });
  } catch (err) {
    next(err);
  }
});

const upsertBody = z.object({
  styleProfile: z.record(z.unknown()).optional(),
  region: z.string().optional(),
});

router.post("/style-profile", async (req, res, next) => {
  try {
    const parsed = upsertBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "invalid_body",
        details: parsed.error.flatten(),
      });
      return;
    }
    const r = await resolveCreator(req);
    if (r.kind !== "found") {
      res.status(401).json({ error: "no_creator" });
      return;
    }

    let normalizedProfile: StyleProfile | undefined;
    if (parsed.data.styleProfile) {
      const sp = styleProfileSchema.safeParse(parsed.data.styleProfile);
      if (!sp.success) {
        res.status(400).json({
          error: "invalid_style_profile",
          details: sp.error.flatten(),
        });
        return;
      }
      normalizedProfile = sp.data;
    }

    let normalizedRegion: Region | undefined;
    if (parsed.data.region != null) {
      if (!isRegion(parsed.data.region)) {
        res.status(400).json({
          error: "invalid_region",
          message: `region must be one of western|india|philippines|nigeria`,
        });
        return;
      }
      normalizedRegion = parsed.data.region;
    }

    if (!normalizedProfile && !normalizedRegion) {
      res.status(400).json({
        error: "nothing_to_update",
        message: "Provide at least one of: styleProfile, region",
      });
      return;
    }

    // Build update set conditionally so we don't blow away whichever
    // half the caller didn't send.
    const updateSet: Record<string, unknown> = {};
    if (normalizedProfile) updateSet.styleProfileJson = normalizedProfile;
    if (normalizedRegion) updateSet.region = normalizedRegion;

    await db
      .update(schema.creators)
      .set(updateSet)
      .where(eq(schema.creators.id, r.creator.id));

    res.json({
      ok: true,
      hasProfile: normalizedProfile !== undefined,
      region: normalizedRegion ?? r.creator.region ?? null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
