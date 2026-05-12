/**
 * P16-A1 — HQS HUMAN-LIFT SCORER (staging-flagged additive layer)
 *
 * Pure / deterministic helper that adds three positive signals to
 * `scoreHookQualityDetailed`:
 *
 *   1. understatedAbsurdityLift  — quiet implicit-anthropomorph + bland/low/none verb (max +5)
 *   2. emotionalSpecificity      — named emotion noun, with payoff-beat bonus (max +6)
 *   3. brevityWideningDelta      — widened brevity curve for qualifying observational hooks
 *
 * Activation gate: env var `LUMINA_HQS_HUMAN_LIFT_ENABLED` must be
 * `"1"` or `"true"`. Default OFF. Production `start` script and
 * production `[services.production.run.env]` MUST NOT set it.
 *
 * HARD-RULE COMPLIANCE
 *   • Pure function. No external deps beyond the brevity helpers.
 *   • Flag OFF: every consumer of `scoreHookQualityDetailed` is byte-
 *     for-byte identical to pre-P16-A1 behavior; this module's contri-
 *     bution to `total` is exactly 0.
 *   • Pure-positive: every signal can only ADD to total. The brevity
 *     widening uses `max(widened, original)` so the brevity component
 *     can never DROP below its pre-flag value.
 *   • No validator/floor/picker constants changed.
 *   • No corpus authored / imported / modified.
 *
 * The tier + branch + source metadata is supplied by the caller from
 * the canonical `*Detailed` helpers in `hookQuality.ts` — we do NOT
 * re-tokenize or re-classify here, ensuring there is exactly one
 * source of truth for verb tier, anthropomorph branch, and
 * contradiction source.
 */

import { brevityScoreOriginal, brevityWordCount } from "./hookQuality.js";
import type {
  AnthropomorphBranch,
  ContradictionSource,
  VisceralVerbTier,
} from "./hookQuality.js";

export type HumanLiftBreakdown = {
  understatedAbsurdity: number;
  emotionalSpecificity: number;
  brevityWideningDelta: number;
  total: number;
  /** Diagnostic — which observational qualifier (if any) opened the
   *  brevity-widening branch. `"none"` when widening did not fire. */
  brevityWideningQualifier:
    | "none"
    | "understated"
    | "emotional"
    | "sequence";
};

export const ZERO_HUMAN_LIFT: HumanLiftBreakdown = {
  understatedAbsurdity: 0,
  emotionalSpecificity: 0,
  brevityWideningDelta: 0,
  total: 0,
  brevityWideningQualifier: "none",
};

/** Env-flag check. Reads each call (cheap; one string compare).
 *  Tests MUST set/unset the env var around assertions and clean up
 *  afterwards (vitest `beforeEach` / `afterEach`). */
export function isHumanLiftEnabled(): boolean {
  const v = process.env.LUMINA_HQS_HUMAN_LIFT_ENABLED;
  return v === "1" || v === "true";
}

// ---------------------------------------------------------------- //
// Signal 1 — Understated Absurdity Lift                             //
// ---------------------------------------------------------------- //
//
// Fires when the IMPLICIT_ANTHROPOMORPH branch matched AND the verb
// tier is BLAND, LOW, or NONE — the surprise is precisely that an
// inanimate object is the agent of a quiet verb. Does NOT fire when:
//   • EXPLICIT anthropomorph fired (regardless of gaming-guard cap)
//   • aiCliche penalty is negative (anti-gaming guard)
//   • verb tier is MID or HIGH (loud register doesn't get the lift)
// Single-credit, capped at +5. No per-hit stacking.

const UNDERSTATED_ABSURDITY_LIFT = 5;

function computeUnderstatedAbsurdity(input: {
  verbTier: VisceralVerbTier;
  anthropomorphBranch: AnthropomorphBranch;
  aiClicheNegative: boolean;
}): number {
  if (input.aiClicheNegative) return 0;
  if (input.anthropomorphBranch !== "implicit") return 0;
  if (input.verbTier !== "BLAND" && input.verbTier !== "LOW" &&
      input.verbTier !== "NONE") {
    return 0;
  }
  return UNDERSTATED_ABSURDITY_LIFT;
}

// ---------------------------------------------------------------- //
// Signal 2 — Emotional Specificity                                  //
// ---------------------------------------------------------------- //
//
// Token presence from the curated emotion lexicon: +4. Emotion as
// payoff beat (e.g. "tea, biscuits, regret"): +6. Cap at +6 — a hook
// with both a payoff and an additional emotion token still scores +6.
// When the contradiction credit was already paid via the operatic
// DRAMATIC_NOUNS branch, cap at +3 (preserves the understated >
// overstated bias).

export const SPECIFIC_EMOTION_NOUNS = [
  "regret","shame","relief","envy","grief","annoyance","smug","smugness",
  "guilt","longing","vindication","pettiness","petty","pride","embarrassment",
  "humiliation","loneliness","jealousy","disappointment","satisfaction",
  "amusement","exhaustion","dread","anticipation","contempt","fondness",
  "tenderness","resentment","gratitude","mortification",
] as const;

const SPECIFIC_EMOTION_SET: ReadonlySet<string> = new Set(SPECIFIC_EMOTION_NOUNS);

const EMOTION_PAYOFF_BEAT =
  /\b(?:and|just|only|nothing\s+but)\s+(?:regret|shame|relief|envy|grief|guilt|longing|pride|embarrassment|disappointment|satisfaction|exhaustion|dread|contempt|fondness|tenderness|resentment|gratitude|mortification)\b/;

const EMOTIONAL_SPECIFICITY_TOKEN = 4;
const EMOTIONAL_SPECIFICITY_PAYOFF = 6;
const EMOTIONAL_SPECIFICITY_CAP = 6;
const EMOTIONAL_SPECIFICITY_DRAMATIC_CAP = 3;

function computeEmotionalSpecificity(input: {
  hookLower: string;
  contradictionSource: ContradictionSource;
}): number {
  const tokens = input.hookLower.match(/[a-z]+/g) ?? [];
  let hasEmotion = false;
  for (const t of tokens) {
    if (SPECIFIC_EMOTION_SET.has(t)) {
      hasEmotion = true;
      break;
    }
  }
  if (!hasEmotion && !EMOTION_PAYOFF_BEAT.test(input.hookLower)) return 0;
  let raw = hasEmotion ? EMOTIONAL_SPECIFICITY_TOKEN : 0;
  if (EMOTION_PAYOFF_BEAT.test(input.hookLower)) {
    raw = EMOTIONAL_SPECIFICITY_PAYOFF;
  }
  // Cap at +3 if dramatic-noun contradiction branch already fired.
  if (input.contradictionSource === "dramatic") {
    return Math.min(raw, EMOTIONAL_SPECIFICITY_DRAMATIC_CAP);
  }
  return Math.min(raw, EMOTIONAL_SPECIFICITY_CAP);
}

// ---------------------------------------------------------------- //
// Signal 3 — Conditional Observational Brevity Widening             //
// ---------------------------------------------------------------- //
//
// Replaces the brevity component for hooks that QUALIFY as
// observational. A hook qualifies when at least one of:
//   • understatedAbsurdity > 0   (quiet object-agent verb)
//   • emotionalSpecificity > 0   (named emotion noun)
//   • OBSERVATIONAL_SEQUENCE_RX matches (minimal sequence detector)
//
// Widened curve (single tier per word count):
//   words 5–11  → 18
//   words 12–14 → 13
//   words 15+   → 5
//   words <5    → original (no widening)
//
// MONOTONICITY GUARANTEE: returned brevity = max(widenedTable(w),
// originalBrevity(w)). For words 5–7 the original gives 20 — the
// widening returns 20 (max of 18 and 20), delta = 0. For words 8 the
// original gives 17, widening gives max(18, 17) = 18, delta = +1.
// At no word count can the widened curve return less than the
// original curve.
//
// `brevityWideningDelta` = widenedBrevity − originalBrevity. The
// caller adds this delta to `total`; the brevity component itself
// stays at its original value in the breakdown so flag-OFF semantics
// are preserved.

const OBSERVATIONAL_SEQUENCE_RX =
  /\b(?:first\b.*\bthen\b|every\s+time|each\s+time|by\s+the\s+time|next\s+thing|and\s+now|now\s+suddenly)\b/i;

/** Pure widened-brevity table (no monotonicity max). Exported for
 *  the monotonicity test. */
export function widenedBrevityTable(words: number): number {
  if (words >= 5 && words <= 11) return 18;
  if (words >= 12 && words <= 14) return 13;
  if (words >= 15) return 5;
  // Unreachable in normal flow — `widenedBrevityMonotone` short-circuits
  // for words < 5. Returning 5 (the original curve's `else` value)
  // keeps the function total even if called directly with a small w.
  return 5;
}

/** Monotone widened brevity = max(widenedTable, original). Returns
 *  the original score for word counts <5 so widening never fires
 *  on ultra-short hooks. */
export function widenedBrevityMonotone(hookLower: string): number {
  const w = brevityWordCount(hookLower);
  const orig = brevityScoreOriginal(hookLower);
  if (w < 5) return orig;
  const widened = widenedBrevityTable(w);
  return widened > orig ? widened : orig;
}

function computeBrevityWidening(input: {
  hookLower: string;
  originalBrevity: number;
  understatedAbsurdity: number;
  emotionalSpecificity: number;
}): { delta: number; qualifier: HumanLiftBreakdown["brevityWideningQualifier"] } {
  let qualifier: HumanLiftBreakdown["brevityWideningQualifier"] = "none";
  if (input.understatedAbsurdity > 0) qualifier = "understated";
  else if (input.emotionalSpecificity > 0) qualifier = "emotional";
  else if (OBSERVATIONAL_SEQUENCE_RX.test(input.hookLower)) qualifier = "sequence";
  if (qualifier === "none") return { delta: 0, qualifier };
  const widened = widenedBrevityMonotone(input.hookLower);
  const delta = widened - input.originalBrevity;
  // Defensive: monotonicity is enforced inside widenedBrevityMonotone,
  // but clamp here too in case future edits drift.
  return { delta: delta < 0 ? 0 : delta, qualifier };
}

// ---------------------------------------------------------------- //
// Composition                                                       //
// ---------------------------------------------------------------- //

export function computeHumanLift(input: {
  hookLower: string;
  verbTier: VisceralVerbTier;
  anthropomorphBranch: AnthropomorphBranch;
  contradictionSource: ContradictionSource;
  aiClicheNegative: boolean;
  originalBrevity: number;
}): HumanLiftBreakdown {
  const understatedAbsurdity = computeUnderstatedAbsurdity({
    verbTier: input.verbTier,
    anthropomorphBranch: input.anthropomorphBranch,
    aiClicheNegative: input.aiClicheNegative,
  });
  const emotionalSpecificity = computeEmotionalSpecificity({
    hookLower: input.hookLower,
    contradictionSource: input.contradictionSource,
  });
  const widening = computeBrevityWidening({
    hookLower: input.hookLower,
    originalBrevity: input.originalBrevity,
    understatedAbsurdity,
    emotionalSpecificity,
  });
  const total =
    understatedAbsurdity + emotionalSpecificity + widening.delta;
  return {
    understatedAbsurdity,
    emotionalSpecificity,
    brevityWideningDelta: widening.delta,
    total,
    brevityWideningQualifier: widening.qualifier,
  };
}
