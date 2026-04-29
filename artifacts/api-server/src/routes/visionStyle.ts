/**
 * POST /api/imported-videos/:id/vision-frames
 *
 * Receives ~3-5 base64-encoded thumbnail frames sampled on-device
 * from a single uploaded video, runs them through Llama 3.2 Vision
 * via OpenRouter, and aggregates the result into the per-creator
 * `creators.vision_style_json` document. Returns the (possibly
 * unchanged) `derivedStyleHints` rollup so the mobile app can
 * surface "we learned X" UX if it wants to.
 *
 * Privacy posture (NON-NEGOTIABLE — see spec):
 *   - We accept frames as ephemeral request bytes only. No frame
 *     ever touches the filesystem, object storage, or any log.
 *   - The vision model's free-text `visibleAction` and
 *     `privacyRiskReason` fields are stripped before persistence
 *     (see lib/visionProfileAggregator.ts). Only enums survive
 *     the write.
 *   - When the model flags `privacyRisk=true` the analysis is
 *     dropped entirely; only the counter (`totalDroppedForPrivacy`)
 *     bumps.
 *
 * Cost / abuse posture (mirrors the Llama 3.1 cost-control layer):
 *   - Each call counts as ONE `vision_call` against the per-creator
 *     daily counter. Hard cap at VISION_DAILY_CAP (default 20).
 *     Past the cap → 429 with the "take a break" body shape so
 *     the mobile error-mapper already handles it. Counter is NOT
 *     consumed on the rejected path.
 *   - Demo creators bypass the cap AND skip the OpenRouter call —
 *     they get a fixed mock analysis so the demo flow can still
 *     exercise the aggregation + bias hookup without spending
 *     tokens.
 *   - Frame payload size is bounded server-side: max 5 frames per
 *     request, max ~250KB per frame as a base64 string (~187KB
 *     decoded — comfortably above what `expo-video-thumbnails` at
 *     `quality: 0.5` produces, well below the JSON body limit).
 */

import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "../db/client";
import { resolveCreator } from "../lib/resolveCreator";
import { logger } from "../lib/logger";
import {
  extractStyleFromFrames,
  type VisionAnalysis,
} from "../lib/visionStyleExtractor";
import {
  aggregateVisionStyle,
  parseVisionStyleDoc,
} from "../lib/visionProfileAggregator";
import {
  getUsageToday,
  incrementUsage,
} from "../lib/usageTracker";

// -----------------------------------------------------------------------------
// Tunables
// -----------------------------------------------------------------------------

const VISION_DAILY_CAP = (() => {
  const raw = process.env.VISION_DAILY_CAP;
  if (!raw) return 20;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
})();

const MAX_FRAMES_PER_CALL = 5;
// Each frame ships as a `data:image/jpeg;base64,...` URL. 350_000
// chars ≈ 260KB decoded — well above what `expo-video-thumbnails`
// at quality 0.5 produces (typically 30-80KB) but below any
// reasonable abuse vector. Keeping it generous so a borderline
// high-DPI screenshot doesn't false-reject; the abuse case is
// the frame COUNT (capped at 5), not per-frame size.
const MAX_FRAME_LEN_CHARS = 350_000;

// Mock analysis returned for demo creators so the rest of the
// pipeline (aggregator, bias hookup) is exercisable without
// spending tokens. Deliberately picks "expressive" + "talking_head"
// so any bias-hookup test on the demo path sees a non-empty hint.
const DEMO_MOCK_ANALYSIS: VisionAnalysis = {
  contentType: "talking_head",
  setting: "bedroom",
  energyLevel: "medium",
  deliveryStyle: "expressive",
  framing: "close_up_face",
  reactionType: "eye_contact",
  talking: true,
  visibleAction: "demo creator mock — no real vision call made",
  privacyRisk: false,
  privacyRiskReason: null,
};

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

const bodySchema = z.object({
  frames: z
    .array(
      z
        .string()
        .min(1)
        .max(MAX_FRAME_LEN_CHARS)
        // Soft prefix check — keeps obviously-not-a-data-URL strings
        // out without being so strict we reject quirky-MIME values.
        .refine(
          (s) => s.startsWith("data:image/"),
          "frame must be a data:image/... URL",
        ),
    )
    .min(1)
    .max(MAX_FRAMES_PER_CALL),
});

// -----------------------------------------------------------------------------
// Router
// -----------------------------------------------------------------------------

const router: IRouter = Router();

router.post(
  "/imported-videos/:id/vision-frames",
  async (req, res, next) => {
    try {
      const r = await resolveCreator(req);
      if (r.kind !== "found") {
        res.status(401).json({ error: "no_creator" });
        return;
      }

      const parsed = bodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: "invalid_body",
          details: parsed.error.flatten(),
        });
        return;
      }

      // Verify the imported video belongs to this creator. The id
      // comes from the URL so we MUST validate ownership — without
      // this check, creator A could submit frames "for" video B and
      // pollute creator B's profile.
      const importedVideoId = req.params.id;
      const [video] = await db
        .select({ id: schema.importedVideos.id })
        .from(schema.importedVideos)
        .where(
          and(
            eq(schema.importedVideos.id, importedVideoId),
            eq(schema.importedVideos.creatorId, r.creator.id),
          ),
        )
        .limit(1);
      if (!video) {
        res.status(404).json({ error: "imported_video_not_found" });
        return;
      }

      // ---- Daily cap check (demo bypass) ---------------------------
      // Mirrors the Llama 3.1 hard-limit pattern in routes/ideator.ts:
      // count BEFORE the work happens (no quota consumed on rejection),
      // friendly take-a-break message, status 429.
      let usageBefore = 0;
      if (!r.creator.isDemo) {
        const usage = await getUsageToday(r.creator.id, ["vision_call"]);
        usageBefore = usage.vision_call;
        if (usageBefore >= VISION_DAILY_CAP) {
          logger.info(
            {
              creatorId: r.creator.id,
              visionCallCountToday: usageBefore,
              cap: VISION_DAILY_CAP,
            },
            "vision_style.rate_limited",
          );
          // Reuse the existing `rate_limit_take_a_break` error key
          // (NOT a new vision-specific key) so the mobile error
          // mapping in (tabs)/index.tsx — which surfaces the verbatim
          // server `message` for this exact error key — works without
          // an additional client branch. Different gate, identical
          // client UX contract: friendly server-supplied message.
          res.status(429).json({
            error: "rate_limit_take_a_break",
            message:
              "Take a break — we'll learn from your next videos tomorrow",
          });
          return;
        }
      }

      // ---- Vision call (or demo mock) ------------------------------
      let analysis: VisionAnalysis;
      let usageTokens: number | null = null;
      if (r.creator.isDemo) {
        analysis = DEMO_MOCK_ANALYSIS;
      } else {
        const result = await extractStyleFromFrames({
          frames: parsed.data.frames,
        });
        if (!result.ok) {
          // Fail-open: don't surface infrastructure failures as a
          // user-visible error. The mobile call is fire-and-forget;
          // returning a 502 here just adds noise. Log + 200 with a
          // null hints update.
          logger.warn(
            {
              creatorId: r.creator.id,
              importedVideoId,
              reason: result.reason,
            },
            "vision_style.extraction_failed",
          );
          res.status(200).json({
            ok: false,
            reason: result.reason,
            derivedStyleHints: null,
            hintsChanged: false,
          });
          return;
        }
        analysis = result.analysis;
        usageTokens = result.usageTokens;

        // Bump the vision_call counter on success only — failed
        // calls don't burn the user's daily budget. Best-effort:
        // a transient DB error here just fuzzes the counter.
        await incrementUsage(r.creator.id, "vision_call", 1);
      }

      // ---- Aggregate + persist -------------------------------------
      // Read the existing doc, run the aggregator, write back.
      // Single round-trip is fine — these calls are infrequent
      // and serialized per-creator at the application layer (the
      // mobile app fires one per import). If two genuine
      // concurrent calls land for the same creator, the second
      // overwrites the first's append; both per-video signals
      // would be lost-update. Acceptable for a 10-cap rolling
      // window where the next call rebuilds the rollup anyway.
      const [existingRow] = await db
        .select({ visionStyleJson: schema.creators.visionStyleJson })
        .from(schema.creators)
        .where(eq(schema.creators.id, r.creator.id))
        .limit(1);
      const existingDoc = existingRow
        ? parseVisionStyleDoc(existingRow.visionStyleJson)
        : null;

      const { doc, droppedForPrivacy, hintsChanged } = aggregateVisionStyle({
        existing: existingDoc,
        newAnalysis: analysis,
        importedVideoId,
      });

      await db
        .update(schema.creators)
        .set({ visionStyleJson: doc })
        .where(eq(schema.creators.id, r.creator.id));

      logger.info(
        {
          creatorId: r.creator.id,
          creatorIsDemo: r.creator.isDemo,
          importedVideoId,
          contentType: analysis.contentType,
          setting: analysis.setting,
          framing: analysis.framing,
          privacyRisk: droppedForPrivacy,
          hintsChanged,
          totalAnalyzed: doc.totalAnalyzed,
          totalDroppedForPrivacy: doc.totalDroppedForPrivacy,
          usageTokens,
        },
        droppedForPrivacy
          ? "vision_style.privacy_dropped"
          : "vision_style.extracted",
      );

      res.status(200).json({
        ok: true,
        droppedForPrivacy,
        hintsChanged,
        derivedStyleHints: doc.derivedStyleHints,
        totalAnalyzed: doc.totalAnalyzed,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
