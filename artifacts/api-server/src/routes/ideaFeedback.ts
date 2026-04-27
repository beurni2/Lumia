/**
 * POST /api/ideas/feedback — capture per-idea creator signal.
 *
 * The mobile app surfaces a tiny "Would you post this? Yes / Maybe /
 * No" row beneath each idea on the daily Home feed. On tap we write
 * one row here so the ideator (and a future Phase 2 trending surface)
 * can use the population's real Yes/Maybe/No distribution rather than
 * guessing what's resonating.
 *
 * **Atomicity:** the table has a UNIQUE INDEX on (creator_id,
 * idea_hook) (migration id=15), so the route is a single
 * INSERT ... ON CONFLICT DO UPDATE. This is race-safe — a fast
 * double-tap that fires two POSTs concurrently can't produce two
 * rows. The previous SELECT-then-INSERT version had a TOCTOU window
 * that an architect review caught on the first ship of this route.
 *
 * **Trade-off** of one-row-per-(creator, hook) forever: a creator
 * who sees the same hook re-surface in a future day's batch can
 * only have ONE feedback row per hook — the latest verdict
 * overwrites. This matches the client's AsyncStorage cache (keyed
 * by hook with no day stamp), so the UI never re-prompts on a hook
 * the user already voted on. Net signal loss is effectively zero.
 *
 * **Fire-and-forget on the client:** the UI optimistically marks
 * the verdict locally and never blocks on this round-trip, so a
 * 5xx here is never user-visible — we just lose that one signal
 * row. For diagnosability of "feedback isn't recording" reports
 * we log every accepted / rejected outcome via the shared pino
 * logger.
 */

import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "../db/client";
import { logger } from "../lib/logger";
import { resolveCreator } from "../lib/resolveCreator";

const router: IRouter = Router();

const verdictEnum = z.enum(["yes", "maybe", "no"]);

// Mirrors the IdeaCardData shape the client knows. Everything but
// `ideaHook` and `verdict` is optional — if the client only sends
// the hook + verdict we can still attribute and aggregate.
// `ideaPattern` is one of the four canonical patterns. Optional so
// older client builds that don't send it can still record a row —
// they just won't contribute to the per-creator format-distribution
// adaptation in lib/formatDistribution.ts.
const patternEnum = z.enum(["pov", "reaction", "mini_story", "contrast"]);
// Same five-spike enum the ideator emits (lib/ideaGen.ts ideaSchema).
// Optional on the body so older clients can still record a verdict —
// the viral-pattern-memory aggregator simply ignores rows where it's
// null, so a missing spike never blocks feedback recording.
const spikeEnum = z.enum([
  "embarrassment",
  "regret",
  "denial",
  "panic",
  "irony",
]);
// Action-signal enum for POST /api/ideas/signal. Mirrors the weight
// table in lib/viralPatternMemory.ts — keep them in lock-step or the
// memory aggregator silently drops the signal.
const signalTypeEnum = z.enum([
  "selected",
  "exported",
  "make_another",
  "regenerated_batch",
  "skipped",
  "abandoned",
]);
// Lumina Evolution Engine tags (Part 1). Same canonical taxonomies
// the model emits in ideaSchema. Optional here so older clients can
// still record verdicts without the new fields — the memory
// aggregator tolerates NULL by skipping that dimension's tally for
// the row.
const structureEnum = z.enum([
  "expectation_vs_reality",
  "self_callout",
  "denial_loop",
  "avoidance",
  "small_panic",
  "social_awareness",
  "routine_contradiction",
]);
const hookStyleEnum = z.enum([
  "the_way_i",
  "why_do_i",
  "contrast",
  "curiosity",
  "internal_thought",
]);

const feedbackBody = z.object({
  ideaHook: z.string().trim().min(1).max(400),
  verdict: verdictEnum,
  reason: z.string().trim().max(500).optional(),
  region: z.string().trim().max(16).optional(),
  ideaCaption: z.string().trim().max(500).optional(),
  ideaPayoffType: z.string().trim().max(32).optional(),
  ideaPattern: patternEnum.optional(),
  emotionalSpike: spikeEnum.optional(),
  structure: structureEnum.optional(),
  hookStyle: hookStyleEnum.optional(),
});

const signalBody = z.object({
  ideaHook: z.string().trim().min(1).max(400),
  signalType: signalTypeEnum,
  ideaPattern: patternEnum.optional(),
  emotionalSpike: spikeEnum.optional(),
  payoffType: z.string().trim().max(32).optional(),
  structure: structureEnum.optional(),
  hookStyle: hookStyleEnum.optional(),
});

// Deterministic short identifier for log lines — gives ops a way to
// correlate a "this hook didn't record" report with the row without
// leaking the full hook text into structured logs (which often go
// to a different retention class than DB rows).
function hookHash(hook: string): string {
  let h = 0;
  for (let i = 0; i < hook.length; i++) {
    h = (h * 31 + hook.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

router.post("/ideas/feedback", async (req, res, next) => {
  try {
    const parsed = feedbackBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      logger.warn(
        { issues: parsed.error.flatten() },
        "[idea-feedback] invalid_body",
      );
      res.status(400).json({
        error: "invalid_body",
        details: parsed.error.flatten(),
      });
      return;
    }

    const r = await resolveCreator(req);
    if (r.kind !== "found") {
      logger.warn("[idea-feedback] no_creator");
      res.status(401).json({ error: "no_creator" });
      return;
    }

    const {
      ideaHook,
      verdict,
      reason,
      region,
      ideaCaption,
      ideaPayoffType,
      ideaPattern,
      emotionalSpike,
      structure,
      hookStyle,
    } = parsed.data;

    // Reason only makes sense when the verdict is 'no' — for 'yes'
    // and 'maybe' the UI never collects one. We trim it server-side
    // too so a stale optimistic-payload reason from a flipped
    // verdict doesn't poison the analytics column.
    const cleanedReason = verdict === "no" ? (reason ?? null) : null;

    // Atomic upsert: the unique index on (creator_id, idea_hook)
    // makes the conflict target meaningful, and the SET clause
    // overwrites the previous verdict + context so a verdict change
    // (No → Yes after the user reconsidered) is reflected in-place.
    // This collapses the prior SELECT-then-write path into one
    // statement, removing the TOCTOU race entirely.
    const [row] = await db
      .insert(schema.ideaFeedback)
      .values({
        creatorId: r.creator.id,
        region: region ?? null,
        ideaHook,
        ideaCaption: ideaCaption ?? null,
        ideaPayoffType: ideaPayoffType ?? null,
        ideaPattern: ideaPattern ?? null,
        emotionalSpike: emotionalSpike ?? null,
        structure: structure ?? null,
        hookStyle: hookStyle ?? null,
        verdict,
        reason: cleanedReason,
      })
      .onConflictDoUpdate({
        target: [
          schema.ideaFeedback.creatorId,
          schema.ideaFeedback.ideaHook,
        ],
        // verdict + reason ALWAYS overwrite (the new tap is the
        // current truth). For all the structural-tag columns
        // (pattern / spike / structure / hookStyle / payoffType /
        // caption / region) we PRESERVE the previously-captured
        // value when the new request omits the field — older
        // mobile builds (pre-Evolution-Engine) don't send
        // structure/hookStyle, so a plain `?? null` would silently
        // null-out tags the v1 client recorded earlier on the
        // same (creator, hook) row, weakening the per-creator
        // memory aggregator over time. COALESCE here means
        // "use the new value if present, else keep the old one".
        // Architect-flagged on the Evolution-Engine MVP review.
        set: {
          verdict,
          reason: cleanedReason,
          region: sql`COALESCE(EXCLUDED.region, ${schema.ideaFeedback.region})`,
          ideaCaption: sql`COALESCE(EXCLUDED.idea_caption, ${schema.ideaFeedback.ideaCaption})`,
          ideaPayoffType: sql`COALESCE(EXCLUDED.idea_payoff_type, ${schema.ideaFeedback.ideaPayoffType})`,
          ideaPattern: sql`COALESCE(EXCLUDED.idea_pattern, ${schema.ideaFeedback.ideaPattern})`,
          emotionalSpike: sql`COALESCE(EXCLUDED.emotional_spike, ${schema.ideaFeedback.emotionalSpike})`,
          structure: sql`COALESCE(EXCLUDED.structure, ${schema.ideaFeedback.structure})`,
          hookStyle: sql`COALESCE(EXCLUDED.hook_style, ${schema.ideaFeedback.hookStyle})`,
        },
      })
      .returning({ id: schema.ideaFeedback.id });

    logger.info(
      {
        creatorId: r.creator.id,
        verdict,
        region: region ?? null,
        payoffType: ideaPayoffType ?? null,
        pattern: ideaPattern ?? null,
        hookHash: hookHash(ideaHook),
        reasonLen: cleanedReason?.length ?? 0,
      },
      "[idea-feedback] recorded",
    );

    res.status(200).json({
      id: row!.id,
      verdict,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/ideas/signal — append-only action event.
 *
 * Distinct from /ideas/feedback because feedback is a verdict on the
 * card while signals are downstream actions ("selected for production",
 * "exported the script", "asked for another version", "regenerated
 * the batch instead", "skipped past it"). Used by the viral-pattern-
 * memory aggregator (`lib/viralPatternMemory.ts`) which weights
 * signals more heavily than verdicts because actions reveal real
 * intent (the creator went to make the video) while verdicts are
 * cheap taps.
 *
 * Append-only: every call inserts a new row. We do NOT collapse on
 * (creator_id, idea_hook) because the memory aggregator cares about
 * the FREQUENCY of action — three "selected" events for the same hook
 * is a stronger signal than one. The unique-index trade-off that
 * /ideas/feedback makes (one verdict per hook) does NOT apply here.
 *
 * Fire-and-forget on the client: the UI never blocks on this round-
 * trip, so a 5xx is never user-visible.
 */
router.post("/ideas/signal", async (req, res, next) => {
  try {
    const parsed = signalBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      logger.warn(
        { issues: parsed.error.flatten() },
        "[ideator-signal] invalid_body",
      );
      res.status(400).json({
        error: "invalid_body",
        details: parsed.error.flatten(),
      });
      return;
    }

    const r = await resolveCreator(req);
    if (r.kind !== "found") {
      logger.warn("[ideator-signal] no_creator");
      res.status(401).json({ error: "no_creator" });
      return;
    }

    const {
      ideaHook,
      signalType,
      ideaPattern,
      emotionalSpike,
      payoffType,
      structure,
      hookStyle,
    } = parsed.data;

    const [row] = await db
      .insert(schema.ideatorSignal)
      .values({
        creatorId: r.creator.id,
        ideaHook,
        ideaPattern: ideaPattern ?? null,
        emotionalSpike: emotionalSpike ?? null,
        payoffType: payoffType ?? null,
        structure: structure ?? null,
        hookStyle: hookStyle ?? null,
        signalType,
      })
      .returning({ id: schema.ideatorSignal.id });

    logger.info(
      {
        creatorId: r.creator.id,
        signalType,
        pattern: ideaPattern ?? null,
        spike: emotionalSpike ?? null,
        payoffType: payoffType ?? null,
        hookHash: hookHash(ideaHook),
      },
      "[ideator-signal] recorded",
    );

    res.status(200).json({ id: row!.id, signalType });
  } catch (err) {
    next(err);
  }
});

export default router;
