/**
 * PHASE Z1 — Willingness scorer.
 *
 * Pure deterministic 0-100 score answering the strategic question
 * "of all 16 candidates in this batch, which one is the creator
 *  most likely to actually film today?". Additive overlay on the
 * existing pipeline — does NOT replace `IdeaScore`, NOT involved
 * in selection / rejection / rewrite. Used by the route layer to
 * REORDER the public ideas array and by the mobile picker to pull
 * the top-k for the "Today's picks" surface.
 *
 * Y11 discipline: ZERO Claude cost, ZERO new DB I/O, ZERO cache
 * shape changes. Reads ONLY fields already computed upstream
 * (`IdeaScore`, `meta.hookQualityScore`, `idea.shotPlan`,
 * `idea.filmingTimeMin`) plus a re-derivation of `aiClicheScore`
 * from `scoreHookQualityDetailed` (already in the same library).
 *
 * Anti-boring guarantee — TWO independent guards:
 *   1. MULTIPLICATIVE edge factor — a flat hook with maxed
 *      filmability gets HALVED regardless. The score formula is
 *      `base * (0.5 + 0.5 * edgeFactor)` so a high-effort
 *      high-edge candidate beats a low-effort low-edge one even
 *      when their `base` components match.
 *   2. HARD picker-eligibility floor — a candidate with
 *      `hookQualityScore < 50` OR ANY `aiCliche` regex hit is
 *      `pickerEligible: false`. The route layer keeps it in the
 *      response but sorts ineligible candidates AFTER eligible
 *      ones, so the user-facing top of the list never contains
 *      a "safe boring" winner.
 */

import type { Idea } from "./ideaGen.js";
import type { IdeaScore, CandidateMeta } from "./ideaScorer.js";
import { scoreHookQualityDetailed } from "./hookQuality.js";
import type { PremiseCoreFamily } from "./premiseCoreLibrary.js";

export type WillingnessBreakdown = {
  /** 0-30 — derived from `IdeaScore.filmability` (0-2 base) bumped
   *  by shotPlan complexity and filming time. One-shot static beats
   *  multi-cut even at the same IdeaScore tier. */
  filmability: number;
  /** 0-25 — derived from `IdeaScore.personalFit` (0-2). Personal
   *  fit is already taste-aware via the per-creator selectionPenalty
   *  + DefaultTaste boost, so we just rescale. */
  tasteFit: number;
  /** 0-15 — derived from `IdeaScore.freshness` (0-1). */
  freshness: number;
  /** 0-30 — derived from `meta.hookQualityScore` (0-100 punch
   *  scale). The hook is the single biggest predictor of whether
   *  the creator will hit record vs. swipe. */
  hookStrength: number;
  /** 0-1 — multiplicative guardrail. Reads `hookQualityScore` and
   *  re-derived `aiCliche` + `contradiction` to keep flat / cliché
   *  / no-contradiction hooks from winning by filmability alone. */
  edgeFactor: number;
};

export type WillingnessResult = {
  /** 0-100 final score. `base * (0.5 + 0.5 * edgeFactor)` where
   *  `base = filmability + tasteFit + freshness + hookStrength`. */
  total: number;
  breakdown: WillingnessBreakdown;
  /** Hard picker floor — true iff `hookQualityScore >= 50` AND no
   *  `aiCliche` demerit. The route layer sorts ineligible behind
   *  eligible. NOT a rejection — ineligible candidates still ship
   *  in the full 16-batch, just never as the top recommendation. */
  pickerEligible: boolean;
};

const PICKER_HQS_FLOOR = 50;

/** Map `IdeaScore.filmability` (0|1|2) to the willingness band, then
 *  apply shotPlan + filmingTime bumps. Caps at 30. */
function deriveFilmability(idea: Idea, score: IdeaScore): number {
  const base = score.filmability === 2 ? 22 : score.filmability === 1 ? 15 : 0;
  const shotPlanLen = Array.isArray(idea.shotPlan) ? idea.shotPlan.length : 0;
  const shotBonus =
    shotPlanLen === 1
      ? 5
      : shotPlanLen === 2
        ? 2
        : shotPlanLen >= 5
          ? -3
          : 0;
  const timeBonus =
    typeof idea.filmingTimeMin === "number" && idea.filmingTimeMin <= 5 ? 3 : 0;
  return Math.max(0, Math.min(30, base + shotBonus + timeBonus));
}

function deriveTasteFit(score: IdeaScore): number {
  return score.personalFit === 2 ? 25 : score.personalFit === 1 ? 15 : 5;
}

function deriveFreshness(score: IdeaScore): number {
  return score.freshness === 1 ? 15 : 5;
}

function deriveHookStrength(meta: CandidateMeta): number {
  const hqs = typeof meta.hookQualityScore === "number"
    ? meta.hookQualityScore
    : 50;
  return Math.max(0, Math.min(30, hqs * 0.3));
}

/** The anti-boring multiplier. Three components, all in [0,1].
 *
 *  - `quality` rises linearly from `hookQualityScore = 50` (=> 0)
 *    to `hookQualityScore >= 100` (=> 1). A hook below the picker
 *    floor contributes nothing to edge.
 *  - `clicheGate` is 1 when `aiCliche === 0`, else 0.4. AI-cliché
 *    hits are caught by the corpus blocklist already; this just
 *    ensures any leaked cliché still loses to a clean hook even if
 *    its raw HQS is comparable.
 *  - `contradictionGate` is 1 when the hook has a contradiction
 *    beat (the Y8 `contradiction` axis fired), else 0.7. Contradiction
 *    is the single highest-signal "this hook has tension" marker. */
function deriveEdgeFactor(
  hookText: string,
  meta: CandidateMeta,
): number {
  const hqs = typeof meta.hookQualityScore === "number"
    ? meta.hookQualityScore
    : 50;
  const quality = Math.max(0, Math.min(1, (hqs - PICKER_HQS_FLOOR) / 50));
  const family =
    ((meta as { ideaCoreFamily?: string }).ideaCoreFamily as
      | PremiseCoreFamily
      | undefined) ?? "self_betrayal";
  const detail = scoreHookQualityDetailed(hookText, family);
  const clicheGate = detail.aiCliche === 0 ? 1 : 0.4;
  const contradictionGate = detail.contradiction > 0 ? 1 : 0.7;
  return quality * clicheGate * contradictionGate;
}

export function scoreWillingness(input: {
  idea: Idea;
  score: IdeaScore;
  meta: CandidateMeta;
}): WillingnessResult {
  const { idea, score, meta } = input;
  const filmability = deriveFilmability(idea, score);
  const tasteFit = deriveTasteFit(score);
  const freshness = deriveFreshness(score);
  const hookStrength = deriveHookStrength(meta);
  const heroBoost = Math.min(20, Math.round((score.heroQuality ?? 0) * 0.25));
  const base = filmability + tasteFit + freshness + hookStrength + heroBoost;
  const edgeFactor = deriveEdgeFactor(idea.hook, meta);
  const total = Math.round(base * (0.5 + 0.5 * edgeFactor));

  const hqs = typeof meta.hookQualityScore === "number"
    ? meta.hookQualityScore
    : 0;
  const family =
    ((meta as { ideaCoreFamily?: string }).ideaCoreFamily as
      | PremiseCoreFamily
      | undefined) ?? "self_betrayal";
  const aiCliche = scoreHookQualityDetailed(idea.hook, family).aiCliche;
  const pickerEligible = hqs >= PICKER_HQS_FLOOR && aiCliche === 0;

  return {
    total: Math.max(0, Math.min(100, total)),
    breakdown: {
      filmability,
      tasteFit,
      freshness,
      hookStrength,
      edgeFactor,
    },
    pickerEligible,
  };
}
