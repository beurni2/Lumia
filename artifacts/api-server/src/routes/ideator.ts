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
import { z } from "zod";
import { resolveCreator } from "../lib/resolveCreator";
import { runHybridIdeator } from "../lib/hybridIdeator";
import { isRegion, type Region } from "@workspace/lumina-trends";
import { styleProfileSchema, type StyleProfile } from "../lib/styleProfile";
import { consumeQuota, refundQuota } from "../lib/quota";
import { DailyCapExceededError } from "../lib/aiCost";
import {
  getUsageToday,
  getLlamaCallsLast2Min,
  acquireRegenSlot,
  incrementUsage,
} from "../lib/usageTracker";
import { logger } from "../lib/logger";

const HARD_REGEN_LIMIT = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

    const regenerate = body.regenerate ?? false;

    // -------- Cost-control / anti-abuse pre-flight ----------------
    // Real creators only — demo creator (curl) bypasses every gate
    // so quality testing isn't blocked. Same isDemo check the cache
    // and quota paths use.
    let usageToday = { idea_request: 0, regenerate_request: 0, llama_call: 0 };
    let cooldownAppliedMs = 0;
    if (!creator.isDemo) {
      usageToday = await getUsageToday(creator.id, [
        "idea_request",
        "regenerate_request",
        "llama_call",
      ]);

      // Hard limit: regenerate is the abusive vector (cheap re-roll).
      // Initial generation always works. Surface a friendly take-a-
      // break message rather than exposing the raw count.
      if (
        regenerate &&
        usageToday.idea_request > HARD_REGEN_LIMIT
      ) {
        logger.info(
          {
            creatorId: creator.id,
            ideaRequestCountToday: usageToday.idea_request,
            limit: HARD_REGEN_LIMIT,
          },
          "ideator.hard_limit_blocked",
        );
        res.status(429).json({
          error: "rate_limit_take_a_break",
          message: "Take a break — come back later for fresh ideas",
        });
        return;
      }

      // Rapid-regen cooldown (3-5s jitter). `acquireRegenSlot` is the
      // atomic check-and-record primitive — two parallel taps from the
      // same creator can't both read "no prior" before either records,
      // so the second one always sees the first's just-stored
      // timestamp and gets the cooldown.
      if (regenerate) {
        cooldownAppliedMs = acquireRegenSlot(creator.id);
        if (cooldownAppliedMs > 0) {
          logger.info(
            { creatorId: creator.id, cooldownMs: cooldownAppliedMs },
            "ideator.cooldown_applied",
          );
          await sleep(cooldownAppliedMs);
        }
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

    // Snapshot the in-memory 2-min Llama-call window for this creator
    // so the mutator's gate sees the same value the route logs. Demo
    // creators get an empty usageContext (their flag flips off every
    // gate inside the mutator anyway).
    const llamaCallsLast2Min = creator.isDemo
      ? 0
      : getLlamaCallsLast2Min(creator.id);

    let result;
    try {
      // Hybrid Ideator Pipeline — pattern engine first ($0), Claude
      // fallback only if <3 local candidates pass the scorer. The
      // orchestrator owns cache hit/miss + persistence; the route
      // just threads `creator` through and keeps the response
      // shape identical (`{ region, count, regenerate, ideas }`).
      result = await runHybridIdeator({
        region,
        styleProfile,
        count: body.count ?? 3,
        regenerate,
        // Thread the already-loaded calibration jsonb through so
        // the orchestrator (and any Claude fallback) does NOT
        // re-SELECT the creator row. resolveCreator returns the
        // full creator (`.select()`), so this field is always
        // present (may be null).
        tasteCalibrationJson: creator.tasteCalibrationJson,
        // Same pattern for the Llama 3.2 Vision style-extraction
        // document. NULL for new creators / pre-v21 rows / anyone
        // who hasn't uploaded any analyzable video — the
        // orchestrator parses it once and the bias is a strict
        // no-op when hints are empty.
        visionStyleJson: creator.visionStyleJson,
        // Memory is left undefined so the orchestrator computes
        // it once and shares it with the fallback path.
        ctx: { creatorId: creator.id },
        creator,
        usageContext: {
          creatorId: creator.id,
          creatorIsDemo: creator.isDemo,
          ideaRequestCountToday: usageToday.idea_request,
          llamaCallsLast2Min,
        },
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

    // The orchestrator persists `lastIdeaBatchJson` + `lastIdeaBatchDate`
    // + `lastIdeaBatchAt` together for non-demo creators (skipped on
    // cache hits since the row is already current). Demo creators
    // intentionally never persist — that's how the curl-driven QA
    // path stays cache-free.

    // Post-flight: increment per-day counters by the ideas actually
    // shipped (so a partial response doesn't burn the same budget as
    // a full one). Demo creators are skipped to keep the curl-driven
    // QA path counter-free. Increments are best-effort inside the
    // tracker — failures only fuzz observability.
    let ideaRequestCountAfter = usageToday.idea_request;
    let regenerateRequestCountAfter = usageToday.regenerate_request;
    if (!creator.isDemo) {
      // Idea counter tracks ideas SERVED, so a zero-result response
      // costs the user nothing. Only increment when we shipped at
      // least one idea.
      if (result.ideas.length > 0) {
        const updated = await incrementUsage(
          creator.id,
          "idea_request",
          result.ideas.length,
        );
        if (typeof updated === "number") ideaRequestCountAfter = updated;
      }
      // Regenerate counter tracks ATTEMPTS, not successes — even an
      // empty regen burned the slot from the user's intent perspective
      // and should count toward their daily regenerate budget. (No
      // double-count: this branch only runs when `regenerate=true`.)
      if (regenerate) {
        const updatedRegen = await incrementUsage(
          creator.id,
          "regenerate_request",
          1,
        );
        if (typeof updatedRegen === "number") {
          regenerateRequestCountAfter = updatedRegen;
        }
      }
    }

    logger.info(
      {
        creatorId: creator.id,
        creatorIsDemo: creator.isDemo,
        count: result.ideas.length,
        regenerate,
        cooldownAppliedMs,
        ideaRequestCountAfter,
        regenerateRequestCountAfter,
        // Pre-mutator snapshot — the mutator's per-call DB increment
        // is fire-and-forget (so the post-await value isn't reliably
        // available without another roundtrip), and the live 2-min
        // ring-buffer count below is what ops actually need for
        // throttle-tuning anyway.
        llamaCallCountBefore: usageToday.llama_call,
        llamaCallsLast2Min,
      },
      "ideator.usage",
    );

    // PHASE X — PART 2 — strip the server-internal `premise` field
    // before returning. The field is used by Layer-2 scoring,
    // server-side telemetry, and Claude-fallback validation, but
    // is intentionally NOT surfaced to the mobile client (same
    // pattern as `meta.viralFeelScore`). Keeping it off the wire
    // also avoids client-side parse drift if the field shape ever
    // changes server-side.
    // PHASE Y — strip `premiseCoreId` for the same reason: it's a
    // server-side scoring/telemetry tag, not a client-facing field.
    const publicIdeas = result.ideas.map(
      ({ premise: _premise, premiseCoreId: _premiseCoreId, ...rest }) => rest,
    );
    res.json({
      region,
      count: publicIdeas.length,
      regenerate,
      ideas: publicIdeas,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
