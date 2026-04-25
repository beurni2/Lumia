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
  styleProfileSchema,
  type StyleProfile,
} from "../lib/styleProfile";
import { isRegion, type Region } from "@workspace/lumina-trends";
import { z } from "zod";

const router: IRouter = Router();

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
    res.json({
      hasProfile: profile !== null,
      profile,
      region: c.region ?? null,
      lastIdeaBatchAt: c.lastIdeaBatchAt ?? null,
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
