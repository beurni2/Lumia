/**
 * GET  /api/imported-videos   — list this creator's onboarding clips
 * POST /api/imported-videos   — record a newly-picked clip
 *
 * The MVP ideator is rule-based and does not analyse clip bytes, so
 * this endpoint persists *metadata only* (filename + duration). That
 * keeps onboarding instant — no upload, no transcode, no waiting.
 *
 * The mobile onboarding flow uses the row count from GET to decide
 * when to flip from "quick win" (1 clip → 1 idea) to "daily feed"
 * (3+ clips → 3 ideas). An ON DELETE CASCADE FK on creators(id) lets
 * the existing /me/data-delete surface erase these implicitly.
 */

import { Router, type IRouter } from "express";
import { and, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client";
import { resolveCreator } from "../lib/resolveCreator";

// How long to consider two POSTs from the same creator with the same
// filename as a duplicate retry (a network blip or fast double-tap).
// Long enough to absorb a 4G round-trip + a couple of in-app rerenders,
// short enough that two genuinely-identical-named files picked in
// quick succession by a user still both record.
const DEDUP_WINDOW_MS = 5_000;

const router: IRouter = Router();

const importBody = z.object({
  filename: z.string().trim().min(1).max(255).optional(),
  durationSec: z.number().int().positive().max(7200).optional(),
});

router.get("/imported-videos", async (req, res, next) => {
  try {
    const r = await resolveCreator(req);
    if (r.kind !== "found") {
      res.status(401).json({ error: "no_creator" });
      return;
    }
    const rows = await db
      .select()
      .from(schema.importedVideos)
      .where(eq(schema.importedVideos.creatorId, r.creator.id))
      .orderBy(desc(schema.importedVideos.createdAt));

    res.json({
      count: rows.length,
      videos: rows.map((v) => ({
        id: v.id,
        filename: v.filename,
        durationSec: v.durationSec,
        createdAt: v.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/imported-videos", async (req, res, next) => {
  try {
    const parsed = importBody.safeParse(req.body ?? {});
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

    const filename = parsed.data.filename ?? null;

    // Soft idempotency: if the same creator just POSTed the same
    // filename within the dedup window, treat it as a network retry
    // and return the original row instead of creating a duplicate.
    // The mobile flow gates step transitions on row count, so a
    // duplicate would prematurely advance the user past step 2.
    let inserted: { id: string; createdAt: Date } | undefined;
    let dedup = false;
    if (filename) {
      const cutoff = new Date(Date.now() - DEDUP_WINDOW_MS);
      const [recent] = await db
        .select({
          id: schema.importedVideos.id,
          createdAt: schema.importedVideos.createdAt,
        })
        .from(schema.importedVideos)
        .where(
          and(
            eq(schema.importedVideos.creatorId, r.creator.id),
            eq(schema.importedVideos.filename, filename),
            gt(schema.importedVideos.createdAt, cutoff),
          ),
        )
        .orderBy(desc(schema.importedVideos.createdAt))
        .limit(1);
      if (recent) {
        inserted = recent;
        dedup = true;
      }
    }

    if (!inserted) {
      [inserted] = await db
        .insert(schema.importedVideos)
        .values({
          creatorId: r.creator.id,
          filename,
          durationSec: parsed.data.durationSec ?? null,
        })
        .returning({
          id: schema.importedVideos.id,
          createdAt: schema.importedVideos.createdAt,
        });
    }

    // Cheap follow-up read — the mobile UI needs the new total to
    // decide whether to fire the quick-win (n=1) or daily-feed (n=3)
    // ideator call, and a second round-trip would just be latency.
    const all = await db
      .select({ id: schema.importedVideos.id })
      .from(schema.importedVideos)
      .where(eq(schema.importedVideos.creatorId, r.creator.id));

    res.status(dedup ? 200 : 201).json({
      id: inserted.id,
      createdAt: inserted.createdAt,
      count: all.length,
      dedup,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
