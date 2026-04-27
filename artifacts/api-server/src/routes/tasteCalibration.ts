/**
 * GET / POST /api/taste-calibration — read / persist the optional
 * Taste Calibration document.
 *
 * The mobile app surfaces a 5-question tap-only preference screen
 * after the Style Profile reveal on first onboarding. The user can:
 *   • answer some/all of the questions and tap save → POST with the
 *     populated document and `skipped: false`
 *   • tap "Skip for now" → POST with `skipped: true` and empty
 *     selections
 * In both cases we persist a row so the UI never re-prompts.
 *
 * Reads return the parsed document (or null if there's nothing on
 * file yet) so the client can decide whether to show the prompt.
 *
 * The route is per-creator and uses the standard `resolveCreator`
 * resolver, which transparently maps unauth'd requests to the seeded
 * demo creator in dev / QA mode.
 */

import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";

import { db, schema } from "../db/client";
import { logger } from "../lib/logger";
import { resolveCreator } from "../lib/resolveCreator";
import {
  parseTasteCalibration,
  tasteCalibrationSchema,
} from "../lib/tasteCalibration";

const router: IRouter = Router();

router.get("/taste-calibration", async (_req, res, next) => {
  try {
    const r = await resolveCreator(_req);
    if (r.kind !== "found") {
      res.status(401).json({ error: "no_creator" });
      return;
    }
    const [row] = await db
      .select({
        tasteCalibrationJson: schema.creators.tasteCalibrationJson,
      })
      .from(schema.creators)
      .where(eq(schema.creators.id, r.creator.id))
      .limit(1);
    const parsed = parseTasteCalibration(row?.tasteCalibrationJson);
    res.status(200).json({ calibration: parsed });
  } catch (err) {
    next(err);
  }
});

router.post("/taste-calibration", async (req, res, next) => {
  try {
    const parsed = tasteCalibrationSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      logger.warn(
        { issues: parsed.error.flatten() },
        "[taste-calibration] invalid_body",
      );
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

    // Server stamps `completedAt` on a non-skipped save so we don't
    // trust client clocks. For a skipped save we leave it null —
    // the row's existence is enough to suppress the re-prompt.
    const doc = parsed.data;
    const persisted = {
      ...doc,
      completedAt: doc.skipped ? null : new Date().toISOString(),
    };

    await db
      .update(schema.creators)
      .set({ tasteCalibrationJson: persisted })
      .where(eq(schema.creators.id, r.creator.id));

    logger.info(
      {
        creatorId: r.creator.id,
        skipped: persisted.skipped,
        formats: persisted.preferredFormats.length,
        tone: persisted.preferredTone,
        effort: persisted.effortPreference,
        avoidances: persisted.privacyAvoidances.length,
        hookStyles: persisted.preferredHookStyles.length,
      },
      "[taste-calibration] saved",
    );

    res.status(200).json({ calibration: persisted });
  } catch (err) {
    next(err);
  }
});

export default router;
