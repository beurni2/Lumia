/**
 * Layer 2 of the Hybrid Ideator Pipeline — deterministic score / filter.
 *
 * NO AI. NO DB. Pure functions over already-built `Idea` objects.
 *
 * Two responsibilities:
 *   1. Hard rejects — patterns that should never ship regardless of
 *      score (weak hook starts, missing tension, abstract advice).
 *   2. 0–10 scoring across 6 axes (hook impact, tension, filmability,
 *      personal fit, caption strength, freshness) with rewrite-once
 *      logic for promising-but-weak (6–7) candidates.
 *
 * Scoring lives outside the pattern engine on purpose — both the
 * pattern_variation candidates AND any AI-fallback candidates run
 * through the same gate, so the bar is identical regardless of
 * source. The downstream merger trusts these scores absolutely.
 */

import type { Idea } from "./ideaGen";
import type { StyleProfile } from "./styleProfile";
import type { ViralPatternMemory } from "./viralPatternMemory";
import {
  HOOK_PHRASINGS_BY_STYLE,
  getEntryIntent,
  getEntryScores,
  lookupBannedHookPrefix,
  lookupHookOpener,
  // Phase 6E — selection-layer scaled boost replacing the Phase 6D
  // unconditional `+7 if usedBigPremise === true`. Function lives in
  // patternIdeator.ts (alongside `scorePremiseComedyScore` so the
  // picker walk's HARD reject can call the scorer without forcing a
  // new ideaScorer.ts → patternIdeator.ts runtime import cycle).
  premiseComedyBoost,
  // Phase 6F (LEGACY COMEDY SCORING) — selection-layer scaled boost
  // mirroring `premiseComedyBoost` for legacy hooks. Lighter band
  // (10→+5..5→-3) preserves spec PART 6 tie-bias: a premium premise
  // (≥7 → +4..+7) still beats a premium legacy (≥7 → +2..+5) on tie
  // axes, but a premium legacy (≥7 → +2..+5) beats a weak premise
  // (≤6 → -2..+1). Same import path as `premiseComedyBoost` for the
  // identical no-cycle reason — the function lives next to the
  // scorer in patternIdeator.ts.
  legacyComedyBoost,
  // Phase 7 (VIRAL FEEL SCORE) — selection-layer scaled boost for
  // the final ranking polish layer. Applied SYMMETRICALLY across
  // premise + legacy entries (the comedy boosts above are mutually
  // exclusive). Same import path as the comedy boosts for the
  // identical no-cycle reason — the function lives next to the
  // scorer in patternIdeator.ts. Boost band intentionally LIGHTER
  // than both comedy bands so a strong comedy score always
  // dominates selection per spec PART 5.
  viralFeelBoost,
  // Phase 7 PART 1 — soft PremiseStyle alignment preference maps
  // for HookIntent + HookLanguageStyle. Used at the selection-
  // penalty site below to award small (+1 each, max +2 stack)
  // tie-break-grade bonuses when the candidate's chosen surface
  // matches its premiseStyleId's preferred set. Pure data tables;
  // no behavior delta from importing them.
  PREMISESTYLE_TO_HOOKINTENT_PREFERENCE,
  PREMISESTYLE_TO_HOOKLANGUAGE_PREFERENCE,
  // Phase 6E — re-export of the scoring fn for the Llama re-scoring
  // guard in `hybridIdeator.ts` (T003). Re-exporting through
  // ideaScorer.ts keeps that file as the canonical "scoring API"
  // surface for downstream consumers; the picker walk in
  // patternIdeator.ts uses it locally without going back through the
  // re-export.
  scorePremiseComedyScore,
  // Phase 6F (LEGACY COMEDY SCORING) — re-export of the legacy
  // scorer for the Llama re-scoring guard (T005) in
  // `llamaHookMutator.ts`, parallel to `scorePremiseComedyScore`.
  scoreLegacyComedyScore,
  validateHook,
  type BigPremiseStyle,
  type Energy,
  type HookIntent,
  type HookLanguageStyle,
  type HookOpener,
  type IdeaCoreFamily,
  type IdeaCoreType,
  type LanguagePhrasingEntry,
  type LegacyComedyScore,
  // Phase 7 (VIRAL FEEL SCORE) — full rubric type mirroring the
  // matching field on PatternMeta. Imported here so the
  // CandidateMeta union's fallback shape can declare the symmetric
  // `viralFeelScore?: ViralFeelScore` field — same union-typing
  // reasoning as the comedy-score type imports above.
  type ViralFeelScore,
  type PatternMeta,
  type PremiseComedyScore,
  type PremiseStyleId,
  type ScriptType,
  type Setting,
  type TopicLane,
  type VideoPattern,
  type VisualActionPattern,
  type VoiceProfile,
} from "./patternIdeator";
import type { DerivedStyleHints } from "./visionProfileAggregator";
import type {
  Archetype,
  ArchetypeFamily,
} from "./archetypeTaxonomy";
import type {
  SceneObjectTag,
  SceneEnvCluster,
} from "./sceneObjectTaxonomy";
// PHASE X — PART 1+2 — single-source-of-truth taste profile.
import { scoreDefaultTaste } from "./defaultTasteProfile";
// PHASE X2 — PART 1+2+4 — heuristic comedy / alignment / anti-copy gates.
import {
  validateComedy,
  validateAntiCopy,
  loadSeedHookFingerprints,
  type ComedyRejectionReason,
} from "./comedyValidation";

// Phase 6E — re-exports of the comedy-scoring API. The function +
// type live in `patternIdeator.ts` (so the picker walk can call the
// scorer without forcing a runtime cycle), but `ideaScorer.ts`
// remains the canonical scoring-API surface so existing downstream
// consumers (test scripts, hybridIdeator's Llama re-scoring guard,
// the QA driver) keep their import paths unchanged. Pure pass-through —
// no wrapping, no behavior delta.
export { scorePremiseComedyScore, premiseComedyBoost } from "./patternIdeator";
export type { PremiseComedyScore } from "./patternIdeator";
// Phase 6F (LEGACY COMEDY SCORING) — same canonical-scoring-API
// reasoning as the Phase 6E re-exports above. Pure pass-through; no
// wrapping, no behavior delta. The Llama re-scoring guard in
// `llamaHookMutator.ts` (T005) and the QA driver (T008) consume
// these from `./ideaScorer` so test scripts and downstream callers
// keep one stable scoring-API import surface across both phases.
export { scoreLegacyComedyScore, legacyComedyBoost } from "./patternIdeator";
export type { LegacyComedyScore } from "./patternIdeator";

// Map the pattern engine's `Setting` enum (8 values, scenario-centric)
// to the Llama 3.2 Vision `setting` enum (7 values, frame-centric).
// Returns `null` for values that don't have a clean vision-side
// counterpart ("couch", "other") — those just don't get a vision
// boost, which is the safest default. Kept here (not in the
// aggregator) because the mapping is scoring-side concern: the
// aggregator never sees pattern-engine settings.
function mapPatternSettingToVisionSetting(s: Setting): string | null {
  switch (s) {
    case "bed":
      return "bedroom";
    case "kitchen":
      return "kitchen";
    case "car":
      return "car";
    case "bathroom":
      return "bathroom_mirror";
    case "desk":
      return "desk";
    case "outside":
      return "outside";
    case "couch":
    case "other":
      return null;
  }
}

/**
 * Apply the Llama 3.2 Vision style-extraction soft bias to a
 * pre-computed `personalFit` score. This is the ONE point at which
 * vision-derived hints touch the scoring stack — keeping it here
 * (not at generation time) means we can roll back the bias without
 * disturbing the candidate pool, and quality / safety filters
 * (which run BEFORE personalFit) are structurally unreachable
 * from this code path.
 *
 * Rule (per spec — "lightly bias future ideas, never override"):
 *   - Vision can push 1 → 2. NEVER 0 → anything (a candidate that
 *     looked like a poor personal fit before vision is still a
 *     poor fit — vision shouldn't drag it up to "great fit").
 *   - Vision NEVER subtracts. A candidate that didn't match the
 *     creator's vision-derived style stays at its original
 *     personalFit (no penalty for novelty).
 *   - Match condition: the candidate's `meta.scenario.setting`
 *     maps to a vision setting that appears in the creator's
 *     `preferredSettings`. (`preferredFormats` is intentionally
 *     unused here — the pattern engine doesn't carry contentType
 *     metadata, so any join would be a guess.)
 */
function applyVisionBoost(
  personalFit: 0 | 1 | 2,
  meta: CandidateMeta | undefined,
  hints: DerivedStyleHints | undefined,
): 0 | 1 | 2 {
  if (personalFit !== 1) return personalFit;
  if (!hints) return personalFit;
  if (hints.preferredSettings.length === 0) return personalFit;
  const candidateSetting = meta?.scenario?.setting;
  if (!candidateSetting) return personalFit;
  const visionSetting = mapPatternSettingToVisionSetting(candidateSetting);
  if (!visionSetting) return personalFit;
  if (
    (hints.preferredSettings as string[]).includes(visionSetting)
  ) {
    return 2;
  }
  return personalFit;
}

/**
 * Common metadata wrapper for candidates flowing through the scorer.
 * Today only `pattern_variation` is produced (Layer 1); future Layer
 * 3 (Llama) candidates would extend this union with their own
 * source tag, but the scoring pipeline only relies on the common
 * fields below + `source` for tie-breaks, the optional `scenario`
 * for the rewriter, and the optional `topicLane` /
 * `visualActionPattern` / `hookOpener` for novelty scoring (only
 * set when the fallback's family/hook resolves to a registered
 * taxonomy entry; usually absent on Claude output).
 */
export type CandidateMeta = PatternMeta | {
  source: "llama_3_1" | "claude_fallback";
  scenarioFamily?: string;
  scenario?: PatternMeta["scenario"];
  visualActionPattern?: VisualActionPattern;
  topicLane?: TopicLane;
  hookOpener?: HookOpener;
  scriptType?: ScriptType;
  /**
   * IdeaCoreType / IdeaCoreFamily — narrative-FAMILY diversity axis
   * (Phase 1 replacement for `scriptType`). Pattern-variation candidates
   * always set both via `resolveIdeaCoreType`. Llama / Claude fallback
   * wraps may set via `lookupIdeaCoreType(family, templateId)` when the
   * family is in the registered taxonomy; absent otherwise. Selector
   * treats absent as "no contribution to ideaCoreType axis" (same
   * discipline as the existing optional fields). The `scriptType` field
   * above is kept INERT for telemetry / archetype-derivation; selection
   * scoring + guards now read these two fields instead.
   */
  ideaCoreType?: IdeaCoreType;
  ideaCoreFamily?: IdeaCoreFamily;
  energy?: Energy;
  /**
   * Archetype + family — IDEA ARCHETYPE spec axes. Llama / Claude
   * fallback wraps may set these via `resolveArchetypeLoose(scriptType)`
   * at wrap time; absent when scriptType isn't in the registered
   * taxonomy. Selector treats absent as "no contribution to archetype
   * axis" (same discipline as the existing optional fields).
   */
  archetype?: Archetype;
  archetypeFamily?: ArchetypeFamily;
  /**
   * Scene-object tag + environment cluster — SCENE-OBJECT TAG spec
   * axes. Fallback wraps may set via `lookupSceneObjectTag(family)`
   * when the family is in the registered taxonomy.
   */
  sceneObjectTag?: SceneObjectTag;
  sceneEnvCluster?: SceneEnvCluster;
  /**
   * HOOK STYLE spec axis (12 values). Pattern-variation candidates
   * always set this. Llama / Claude fallback wraps may omit (no
   * derivation path from raw hook text — the language mode is a
   * generation-time choice, not a lookup); selector treats absent
   * as "no contribution to hookLanguageStyle axis".
   */
  hookLanguageStyle?: HookLanguageStyle;
  /**
   * VOICE PROFILES spec axis (8 values). Pattern-variation
   * candidates set this on every emit (selectPrimaryVoiceProfile +
   * pickVoiceForSlot in `generatePatternCandidates`). Llama / Claude
   * fallback wraps may omit — there's no derivation path from raw
   * hook text (the voice is a STYLE/TONE generation-time choice,
   * not a lookup). Selector treats absent as "no contribution to
   * voiceProfile axis" (same discipline as `hookLanguageStyle`).
   */
  voiceProfile?: VoiceProfile;
  /**
   * TREND CONTEXT LAYER axis. Pattern-variation candidates set this
   * when the deterministic 30%-bucket gate fires, a trend exists
   * whose compatibility tags include the candidate's
   * `(scenarioFamily, archetypeFamily)`, AND the transformed caption
   * survives the substring validator chain. Llama / Claude fallback
   * wraps + legacy cache entries omit — selector treats absent as
   * "no contribution to the trend axis" (same discipline as
   * `voiceProfile`). Drives the cross-batch -2 penalty in
   * `selectionPenalty` (immediate-prior batch only).
   */
  trendId?: string;
  /**
   * Phase 3 HOOK TEMPLATE TUNING — formulaic hook-template skeleton id
   * (e.g. `"todays_update"`). Mirrors the field on `PatternMeta`
   * (above) so the cache write site can read `c.meta.hookSkeletonId`
   * without a per-variant guard. Llama / Claude fallback wraps NEVER
   * set this — there's no derivation path from raw hook text (the
   * skeleton is a generation-time choice on the catalog entry, not a
   * lookup), so the field stays undefined on every fallback wrap and
   * the cross-batch lever silently abstains for those entries (same
   * discipline as `trendId` / `voiceProfile` above).
   */
  hookSkeletonId?: string;
  /**
   * Phase 6 (BIG PREMISE LAYER) — telemetry-only flag mirroring the
   * field on `PatternMeta`. Llama / Claude fallback wraps NEVER set
   * this (premises are only emitted by the local catalog), so the
   * field stays undefined on every fallback wrap and the QA driver
   * can count premises shipped without a per-variant guard.
   */
  usedBigPremise?: boolean;
  /**
   * Phase 6 — premise-style id mirroring the field on `PatternMeta`.
   * Llama / Claude fallback wraps NEVER set this; selector treats
   * absent as "no contribution to the premise-style axis" (same
   * discipline as `hookSkeletonId` / `trendId` above).
   */
  bigPremiseStyle?: BigPremiseStyle;
  /**
   * Phase 6 EXPANSION — fine-grained 50-style id mirroring the
   * matching field on `PatternMeta`. Llama / Claude fallback wraps
   * NEVER set this; selector treats absent as "no contribution to
   * the fine-grained premise-style axis" (same discipline as
   * `bigPremiseStyle` / `hookSkeletonId` / `trendId` above).
   */
  premiseStyleId?: PremiseStyleId;
  /**
   * Phase 6 EXPANSION — display label paired with `premiseStyleId`
   * (telemetry-only; never read by the selector). Cleared in lockstep
   * with `premiseStyleId` on the rewrite-clear path so stale labels
   * never leak past a hook substitution. Llama / Claude fallback
   * wraps NEVER set this.
   */
  premiseStyleLabel?: string;
  /**
   * Phase 6D (PREMISE EXECUTION EXPANSION) — fine-grained execution-
   * pattern id mirroring the matching field on `PatternMeta`. Llama /
   * Claude fallback wraps NEVER set this; selector treats absent as
   * "no contribution to the fine-grained execution axis" (same
   * discipline as `premiseStyleId` / `hookSkeletonId` / `trendId`
   * above).
   */
  executionId?: string;
  /**
   * Phase 6E (PREMISE COMEDY SCORING + REJECTION) — full rubric
   * score mirroring the matching field on `PatternMeta`. Llama /
   * Claude fallback wraps NEVER set this directly (premise hooks
   * are emitted only by the local catalog; the rubric is a premise-
   * quality gate, not a fallback gate). Field declared on this
   * fallback shape ANYWAY so the union member-access in
   * `selectionPenalty.premiseComedyBoost(c.meta.premiseComedyScore?.total)`
   * type-checks across both arms of the union without requiring an
   * `"in" meta` narrowing — the optional `?.` chain naturally
   * collapses to `undefined → 0 boost` for every fallback wrap.
   * Llama re-scoring guard in T003 may populate a Llama-polished
   * premise's score on the wrap path AFTER polish; until then the
   * field stays undefined for fallback wraps (no behavior change).
   */
  premiseComedyScore?: PremiseComedyScore;
  /**
   * Phase 6F (LEGACY COMEDY SCORING + REJECTION) — full rubric
   * score mirroring the matching field on `PatternMeta`. Same
   * union-typing reasoning as `premiseComedyScore` above: declared
   * on the fallback shape so the union member-access in
   * `selectionPenalty.legacyComedyBoost(c.meta.legacyComedyScore?.total)`
   * type-checks across both arms of the union without an `"in" meta`
   * narrowing — the optional `?.` chain naturally collapses to
   * `undefined → 0 boost` for every fallback wrap (Llama / Claude
   * fallback hooks are not legacy-catalog hooks, so the rubric
   * never applies; the boost stays neutral). The Llama re-scoring
   * guard in T005 may populate a Llama-polished legacy hook's score
   * on the wrap path AFTER polish; until then the field stays
   * undefined for fallback wraps (no behavior change).
   */
  legacyComedyScore?: LegacyComedyScore;
  /**
   * Phase 7 (VIRAL FEEL SCORE) — full rubric score mirroring the
   * matching field on `PatternMeta`. Same union-typing reasoning as
   * `premiseComedyScore` / `legacyComedyScore` above: declared on
   * the fallback shape so the union member-access in
   * `selectionPenalty.viralFeelBoost(c.meta.viralFeelScore?.total)`
   * type-checks across both arms of the union without an `"in" meta`
   * narrowing — the optional `?.` chain naturally collapses to
   * `undefined → 0 boost` for every fallback wrap. Llama / Claude
   * fallback wraps NEVER set this directly today (the viral score
   * is computed at `assembleCandidate` time on the pattern path
   * only); the field stays undefined for fallback wraps and the
   * scaled boost silently abstains (no behavior change).
   */
  viralFeelScore?: ViralFeelScore;
  /**
   * Phase 7 PART 1 — hook intent mirroring the matching field on
   * `PatternMeta`. Declared on the fallback shape so the soft
   * PremiseStyle alignment bonus in `selectionPenalty` can read
   * `c.meta.hookIntent` without an `"in" meta` narrowing. Llama /
   * Claude fallback wraps NEVER set this directly (no derivation
   * path from raw hook text — intent is a generation-time choice
   * on the catalog entry). The alignment bonus is also gated on
   * `premiseStyleId !== undefined` (which is also undefined on
   * fallback wraps), so the bonus silently abstains for fallback
   * wraps regardless — this field declaration is purely for type-
   * narrowing convenience, mirroring the same discipline as the
   * comedy-score + viral-score fields above.
   */
  hookIntent?: HookIntent;
  /**
   * TREND + ARCHETYPE PAIRING spec — pre-trend caption snapshot
   * captured by `assembleCandidate` ONLY when a trend was injected
   * (paired 1-to-1 with `trendId`). Read by `enforceTrendCap` in
   * `hybridIdeator` to revert the caption when the within-batch
   * HARD CAP fires (≤ N-1 trend-injected per N-pick batch — the
   * lowest-scoring trended candidate gets its caption reverted +
   * `trendId` cleared, the candidate STILL ships, no batch-level
   * rejection). Always paired with `trendId` — both are set
   * together at injection time, both are cleared together on
   * revert. Llama / Claude fallback wraps NEVER set this (no
   * trends apply to fallback paths). Not persisted to the cache —
   * runtime-only meta for the cap pass; cache envelope just
   * carries `trendId`.
   */
  originalCaption?: string;
};

// -----------------------------------------------------------------------------
// Hard rejects
// -----------------------------------------------------------------------------

/** Lowercase prefixes that almost always read as weak / generic. */
const WEAK_HOOK_PREFIXES = [
  "pov: you ",
  "when you ",
  "watching ",
  "reading ",
  "talk about ",
  "share your thoughts",
  "have you ever ",
  "anyone else ",
  "what i learned",
  "reminder that",
  "did you know",
];

/** Generic caption signals that mean "no real moment". */
const ABSTRACT_PHRASES = [
  "be yourself",
  "stay positive",
  "love yourself",
  "you got this",
  "manifest",
  "good vibes only",
];

export type HardRejectReason =
  | "weak_hook_prefix"
  | "missing_trigger"
  | "missing_reaction"
  | "abstract_caption"
  | "caption_repeats_hook"
  | "no_visual_action";

export function checkHardRejects(idea: Idea): HardRejectReason | null {
  const hookLower = idea.hook.trim().toLowerCase();
  if (WEAK_HOOK_PREFIXES.some((p) => hookLower.startsWith(p))) {
    return "weak_hook_prefix";
  }
  if (idea.trigger.trim().length < 5) return "missing_trigger";
  if (idea.reaction.trim().length < 5) return "missing_reaction";
  const captionLower = idea.caption.trim().toLowerCase();
  if (ABSTRACT_PHRASES.some((p) => captionLower.includes(p))) {
    return "abstract_caption";
  }
  if (captionLower === hookLower) return "caption_repeats_hook";
  if (!idea.hasVisualAction && idea.visualHook.trim().length === 0) {
    return "no_visual_action";
  }
  return null;
}

// -----------------------------------------------------------------------------
// Scoring (0–10)
// -----------------------------------------------------------------------------

export type IdeaScore = {
  total: number;
  hookImpact: 0 | 1 | 2;
  tension: 0 | 1 | 2;
  filmability: 0 | 1 | 2;
  personalFit: 0 | 1 | 2;
  captionStrength: 0 | 1;
  freshness: 0 | 1;
  /**
   * Phase 3 PART 3 — scroll-stop score (0-10) derived from intrinsic
   * hook properties (fragment shape, emotional charge, structure
   * break, specificity) plus the source `LanguagePhrasingEntry`'s
   * rigidity / sharpness scores.
   *
   * Phase 4 (HOOK INTENT) — STILL COMPUTED for every candidate
   * regardless of `meta.hookIntent` so the field retains its scroll-
   * stop semantics for telemetry / dashboards / historical comparisons.
   * NO LONGER FOLDED INTO `total` — that role moved to
   * `hookIntentScore` below, which dispatches to the per-intent scorer
   * matching the candidate's actual intent. Pre-Phase-4 callers reading
   * `scrollStopScore` get the same number they always got; only the
   * `total` arithmetic changed.
   */
  scrollStopScore: number;
  /**
   * Phase 4 (HOOK INTENT) — intent-aware hook score (0-10). Dispatches
   * via `scoreHookIntent(hook, meta.hookIntent ?? "scroll_stop", entry)`
   * so each candidate is scored against the hook discipline appropriate
   * to its assigned intent: scroll_stop → fragment-shape + emotional
   * charge (= existing `scoreScrollStop`), compulsion → mystery-ending
   * + forward-implication + demonstrative-verb shape, relatable →
   * first-person + specific-behavior + admission tokens. REPLACES
   * `scrollStopScore` in the `total` fold at the same 0.5x weight, so
   * the selection budget is unchanged — only the per-intent SHAPE of
   * a "good" hook moved.
   */
  hookIntentScore: number;
};

// -----------------------------------------------------------------------------
// scrollStopScore (Phase 3 PART 3)
// -----------------------------------------------------------------------------

/**
 * Emotional-charge tokens (case-insensitive substring match). When
 * the hook contains ANY of these the +2 emotional-charge boost
 * fires. Kept separate from `TENSION_MARKERS` (above) which scores
 * a different axis — these are explicitly the spec PART 3 "would
 * make a friend stop scrolling" affect words.
 */
const SCROLLSTOP_EMOTIONAL_TOKENS: readonly string[] = [
  "hate",
  "stressful",
  "exhausting",
  "annoying",
  "over it",
  "too much",
  "frustrating",
];

/**
 * Safe / hedged opening prefixes (case-insensitive prefix match).
 * Hooks starting with these get the -2 safe-phrasing penalty per
 * spec PART 3 — they read as the "preachy / observational" voice
 * that PART 5 explicitly warns against ("don't sound like a TED
 * talk").
 */
const SCROLLSTOP_SAFE_PREFIXES: readonly string[] = [
  "i think",
  "i feel like",
  "you know when",
  "kind of",
];

/**
 * Lead-pronoun pattern. When the hook starts with a subject pronoun
 * (i / you / we / they / he / she / it) it reads as a structurally-
 * expected sentence — the +2 "unusual structure" boost is withheld.
 * Combined with terminal punctuation + word count > 5 to detect a
 * fully-formed sentence (which then loses the +2 "not full sentence"
 * boost as well).
 */
const SCROLLSTOP_LEADING_PRONOUN_RE = /^(i|you|we|they|he|she|it)\b/i;

/**
 * Timestamp-leading pattern. A hook starting with a clock time
 * (`9:14pm` / `7am`) or a date marker counts as a structure break
 * even when the rest of the string contains a pronoun later — it's
 * the OPENING that grabs attention.
 */
const SCROLLSTOP_TIMESTAMP_RE = /^(\d{1,2}:\d{2}\s?(am|pm)?|\d{1,2}\s?(am|pm))/i;

/**
 * Abstract-only filler tokens (case-insensitive). When a hook has
 * NO digit + NO proper noun + NO meaningful noun outside this set,
 * it's pure abstraction → -3 penalty. Matches the spec PART 3
 * "no specific noun" rule. Tokens must be ≥4 chars when checked
 * against this set (shorter = function words, ignored).
 */
const SCROLLSTOP_ABSTRACT_ONLY_TOKENS: ReadonlySet<string> = new Set([
  "thing",
  "things",
  "everything",
  "nothing",
  "something",
  "anything",
  "stuff",
  "moment",
  "moments",
  "time",
  "times",
  "this",
  "that",
  "these",
  "those",
  "what",
  "when",
  "where",
  "really",
  "still",
  "again",
  "today",
  "right",
  "very",
  "much",
  "fine",
  "good",
  "nice",
  "okay",
  "anyway",
  "here",
  "there",
  "just",
  "kind",
  "with",
  "about",
  "from",
  "into",
  "over",
  "under",
  "after",
  "before",
  "always",
  "never",
  "maybe",
  "every",
  "some",
  "many",
  "most",
  "more",
  "less",
  "than",
  "then",
  "they",
  "have",
  "been",
  "were",
  "will",
  "would",
  "could",
  "should",
]);

/**
 * Pure-function 0-10 scorer for "would a thumb stop on this hook".
 * Composes intrinsic hook properties (fragment shape, emotional
 * charge, structure break, specificity) with the source
 * `LanguagePhrasingEntry`'s rigidity/sharpness when available. Safe
 * to call with `sourceEntry === undefined` (Claude/Llama fallback,
 * legacy cached entries) — entry-derived signals no-op in that case
 * and only intrinsic hook properties contribute.
 *
 * Composition (per HOOK STYLE spec PART 3, scoring rubric):
 *   baseline 0
 *   +3 fragment (≤4 words OR period before final word)
 *   +2 emotional charge (token match OR entry sharpness ≥4)
 *   +2 unusual structure (no leading pronoun OR timestamp-leading)
 *   +2 not a full sentence (no leading pronoun + terminal punct
 *      + > 5 words = "looks like a sentence" → boost withheld)
 *   +1 highly specific (digit OR proper noun)
 *   −3 entry rigidity ≥4 (highly reusable across scenarios)
 *   −2 safe-phrasing prefix
 *   −2 over-explained (>12 words)
 *   −3 pure abstraction (no digit + no proper noun + no
 *      meaningful noun outside the filler set)
 *   add baseline +5, clamp [0, 10]
 *
 * The weighted total ends up around 5-9 for shippable hooks, ≤4 for
 * "filler" hooks the rest of the scorer is also likely to reject.
 */
export function scoreScrollStop(
  hook: string,
  sourceEntry?: LanguagePhrasingEntry,
): number {
  const trimmed = hook.trim();
  if (trimmed.length === 0) return 0;
  const lower = trimmed.toLowerCase();
  const words = trimmed.split(/\s+/);
  const wordCount = words.length;

  // --- entry-derived signals (no-op when sourceEntry is undefined) ---
  const entryScores = sourceEntry ? getEntryScores(sourceEntry) : null;
  const entrySharp = entryScores ? entryScores.sharpness >= 4 : false;
  const entryRigid = entryScores ? entryScores.rigidity >= 4 : false;
  // Phase 3 HOOK TEMPLATE TUNING — scenario-AGNOSTIC entries (a `() =>`
  // build that never references the Scenario) read identically across
  // all topics, so they lose the topic-anchor that makes a scroll-stop
  // shape feel concrete to a specific viewer. -2 (post-baseline)
  // ensures a generic high-sharpness one-liner ("this ruined my
  // mood") still scores below an equally-sharp scenario-tagged
  // alternative. Strict `=== true` so absent / falsy fields contribute
  // nothing — same discipline as the `entrySharp` / `entryRigid`
  // checks above.
  const entryGeneric = sourceEntry?.genericHook === true;

  // --- intrinsic shape signals ---
  const isFragmentShape =
    wordCount <= 4 || /\.\s+\S/.test(trimmed);
  const startsWithPronoun = SCROLLSTOP_LEADING_PRONOUN_RE.test(trimmed);
  const startsWithTimestamp = SCROLLSTOP_TIMESTAMP_RE.test(trimmed);
  const hasUnusualStructure = !startsWithPronoun || startsWithTimestamp;
  // "Looks like a sentence": leading pronoun + terminal punctuation
  // + > 5 words. Anything that breaks one of these three reads as
  // an interruption / fragment / mid-action thought → +2 boost.
  const looksLikeFullSentence =
    startsWithPronoun && /[.!?]$/.test(trimmed) && wordCount > 5;

  // --- specificity ---
  const hasDigit = /\d/.test(trimmed);
  // Proper-noun heuristic: capital letter mid-string (skip the very
  // first character so a sentence-leading "I" / "Tuesday" still
  // counts via the digit/topicNoun path, not as a proper noun by
  // accident). The Cartesian assembler routinely produces lowercase
  // hooks so this fires mainly when scenario.topicNoun is a true
  // proper noun (rare) — kept as a +1 nudge, not a hard signal.
  const hasProperNoun = /\s[A-Z][a-z]{2,}/.test(trimmed);

  // --- abstraction detector ---
  const meaningfulNoun = words.some((w) => {
    const cleaned = w.toLowerCase().replace(/[.,!?;:'"`–—]/g, "");
    return (
      cleaned.length >= 4 && !SCROLLSTOP_ABSTRACT_ONLY_TOKENS.has(cleaned)
    );
  });
  const isPureAbstraction = !hasDigit && !hasProperNoun && !meaningfulNoun;

  // --- emotional charge: token in hook OR entry intrinsically sharp ---
  const hasEmotionToken = SCROLLSTOP_EMOTIONAL_TOKENS.some((t) =>
    lower.includes(t),
  );

  // --- safe-phrasing prefix ---
  const hasSafePrefix = SCROLLSTOP_SAFE_PREFIXES.some((p) =>
    lower.startsWith(p),
  );

  let raw = 0;
  if (isFragmentShape) raw += 3;
  if (hasEmotionToken || entrySharp) raw += 2;
  if (hasUnusualStructure) raw += 2;
  if (!looksLikeFullSentence) raw += 2;
  if (hasDigit || hasProperNoun) raw += 1;
  if (entryRigid) raw -= 3;
  if (hasSafePrefix) raw -= 2;
  if (wordCount > 12) raw -= 2;
  if (isPureAbstraction) raw -= 3;
  // Phase 3 HOOK TEMPLATE TUNING — generic-hook penalty (see the
  // `entryGeneric` definition above for the rationale). -4 sized to
  // overcome the broader composite-score gap (the per-intent score
  // is ~5–8 of the total ~15-20pt scale, so the previous -2 was too
  // soft — generic templates kept winning by virtue of catalog
  // volume since one generic phrasing fits any scenario while a
  // scenario-shaped phrasing only fits its own family). -4 ensures
  // a tagged generic ("this ruined my mood") loses to a scenario-
  // shaped alternative even when the alternative is mid-sharpness.
  if (entryGeneric) raw -= 4;

  return Math.max(0, Math.min(10, raw + 5));
}

/**
 * Resolve the source `LanguagePhrasingEntry` from a `CandidateMeta`.
 * Only `pattern_variation` candidates carry it (set by
 * `assembleCandidate`); Claude/Llama fallback wraps + legacy cached
 * entries return undefined. Same defensive shape as the existing
 * `metaTopicLane` / `metaScriptType` accessors.
 *
 * NOTE: After a JSONB cache round-trip the entry's `build` function
 * is gone but `rigidityScore` / `sharpnessScore` survive — readers
 * (currently only `scoreScrollStop`) MUST stick to score-field
 * lookups via `getEntryScores` and never call `.build()`.
 */
function metaSourceLanguagePhrasing(
  m: CandidateMeta,
): LanguagePhrasingEntry | undefined {
  return "sourceLanguagePhrasing" in m ? m.sourceLanguagePhrasing : undefined;
}

/**
 * Resolve the candidate's `hookIntent` from `CandidateMeta`. Phase 4
 * pattern_variation candidates always carry it (set by
 * `assembleCandidate` from the WINNING entry's intent, NOT the slot's
 * `assignedIntent`). Legacy cache reads + Claude/Llama fallback wraps
 * may omit it — the dispatcher in `scoreHookIntent` defaults absent
 * intent to `scroll_stop` to preserve Phase 3 scoring semantics.
 */
function metaHookIntent(m: CandidateMeta): HookIntent | undefined {
  return "hookIntent" in m ? m.hookIntent : undefined;
}

/**
 * Phase 5 (PATTERN MAPPING LAYER) — accessor for the typed
 * VideoPattern axis on PatternMeta. Returns undefined for fallback
 * wraps + pre-Phase-5 cache reads (same discipline as
 * `metaHookIntent`). Selectors / penalties that read this MUST treat
 * undefined as "no contribution to the video-pattern axis" — never
 * default to a specific pattern.
 */
function metaVideoPattern(m: CandidateMeta): VideoPattern | undefined {
  return "videoPattern" in m ? m.videoPattern : undefined;
}

/**
 * Phase 3 HOOK TEMPLATE TUNING — accessor for the formulaic skeleton
 * id that the picked `LanguagePhrasingEntry` carried (when it had
 * one). Returns undefined for entries whose phrasing is genuinely
 * scenario-shaped, for fallback wraps, and for pre-Phase-3 cache
 * reads — same discipline as `metaVideoPattern`. Selectors / penalty
 * code reading this MUST treat undefined as "no contribution to the
 * skeleton axis" — never default to a sentinel id.
 */
function metaHookSkeletonId(m: CandidateMeta): string | undefined {
  return "hookSkeletonId" in m ? m.hookSkeletonId : undefined;
}

/**
 * Phase 6 (BIG PREMISE LAYER) — premise-style accessor mirroring
 * `metaHookSkeletonId` above. Returns the persisted style id when
 * the meta variant carries one (pattern_variation candidates whose
 * picked entry was tagged `bigPremise: true`), otherwise undefined.
 * Llama / Claude fallback wraps NEVER set `bigPremiseStyle` (no
 * derivation path from raw hook text — premises are catalog-only)
 * so this returns undefined for them, and downstream callers MUST
 * treat undefined as "no contribution to the premise-style axis".
 */
function metaBigPremiseStyle(m: CandidateMeta): BigPremiseStyle | undefined {
  return "bigPremiseStyle" in m ? m.bigPremiseStyle : undefined;
}

/**
 * Phase 6 EXPANSION (PREMISE STYLE ENGINE) — fine-grained 50-style id
 * accessor mirroring `metaBigPremiseStyle` above. Returns the
 * persisted id when the meta variant carries one (every Phase 6
 * EXPANSION-derived candidate; undefined for the original 29
 * hand-written premise entries that only carry the bucket field, and
 * undefined for legacy template + Llama / Claude fallback wraps).
 * Downstream callers MUST treat undefined as "no contribution to the
 * fine-grained premise-style axis" — the bucket-level lever still
 * fires independently.
 */
function metaPremiseStyleId(m: CandidateMeta): PremiseStyleId | undefined {
  return "premiseStyleId" in m ? m.premiseStyleId : undefined;
}

// -----------------------------------------------------------------------------
// Phase 4 (HOOK INTENT) — per-intent scoring
//
// Each intent gets its OWN 0-10 hook score; `scoreHookIntent` dispatches
// to the right one based on the candidate's `meta.hookIntent`. The three
// scorers share the same shape as `scoreScrollStop` (intrinsic-only
// signals + low-weight fold into `total`) so the selection budget is
// unchanged — only the per-intent definition of a "good" hook moves.
// All three are pure (no entry-derived signals beyond the optional
// `sourceEntry` parameter, which is reserved for future symmetry with
// scroll_stop's rigidity / sharpness reads).
// -----------------------------------------------------------------------------

/**
 * Mystery-ending tokens (last alphabetic word in the hook). Per spec
 * PART 4 — "ends with the moment, not the resolution". Hooks ending
 * with these words leave the viewer unresolved, which is the core
 * compulsion mechanic. Lowercase-only; `lastAlphaWord` lower-cases
 * before the lookup so the hook can be any case.
 */
const COMPULSION_MYSTERY_WORDS: ReadonlySet<string> = new Set([
  "well",
  "here",
  "wrong",
  "next",
  "then",
]);

/**
 * Forward-implication tokens (case-insensitive substring match). When
 * present, the hook is pointing at a future event / consequence the
 * viewer hasn't seen yet — same compulsion mechanic as the mystery
 * ending, scored independently because the two patterns CAN co-occur
 * (e.g. "i should've stopped here" hits both).
 */
const COMPULSION_FORWARD_TOKENS: readonly string[] = [
  "should've",
  "should have",
  "was where",
  "going to",
  "until",
  "before",
];

/**
 * Demonstrative + verb shape ("this is", "this was", "this didn't").
 * The "this" without an antecedent forces the viewer to LOOK to find
 * out what "this" refers to — a different compulsion mechanic from
 * the mystery / forward shapes.
 */
const COMPULSION_DEMONSTRATIVE_VERB_RE: RegExp =
  /\bthis\s+(is|was|isn'?t|wasn'?t|didn'?t|won'?t|always|keeps)\b/i;

/**
 * Compulsion score — 0-10 derived from intrinsic hook properties:
 *   +3 ends with a mystery word (last alphabetic word in [well, here,
 *      wrong, next, then])
 *   +2 contains a forward-implication token (should've / was where /
 *      going to / until / before)
 *   +2 NOT a "looks like a complete resolved sentence" (mirrors the
 *      `looksLikeFullSentence` heuristic from `scoreScrollStop` so
 *      both intent scorers agree on what "resolved" looks like)
 *   +2 contains demonstrative + verb shape (this is / this was / …)
 *   −2 fully self-contained answer (= the looksLikeFullSentence shape
 *      DOES match — kept asymmetric vs the +2 above so a resolved
 *      sentence loses 4 points net rather than 2, matching the spec
 *      "ends with the moment, not the resolution")
 *   −2 over-explained (>12 words — same threshold as scoreScrollStop)
 *   add baseline +5, clamp [0, 10]
 *
 * sourceEntry is accepted for signature parity with `scoreScrollStop`
 * but not yet used — kept on the parameter list so a future entry-
 * derived compulsion signal (e.g. an explicit "leaves resolved"
 * tag) can be folded in without changing the call sites.
 */
export function scoreCompulsion(
  hook: string,
  sourceEntry?: LanguagePhrasingEntry,
): number {
  const trimmed = hook.trim();
  if (trimmed.length === 0) return 0;
  const lower = trimmed.toLowerCase();
  const words = trimmed.split(/\s+/);
  const wordCount = words.length;

  const lastAlphaWord =
    (lower.match(/[a-z']+(?=[^a-z']*$)/i)?.[0] ?? "").toLowerCase();
  const endsWithMystery = COMPULSION_MYSTERY_WORDS.has(lastAlphaWord);
  const hasForward = COMPULSION_FORWARD_TOKENS.some((t) => lower.includes(t));
  const hasDemonstrative = COMPULSION_DEMONSTRATIVE_VERB_RE.test(trimmed);
  const startsWithPronoun = SCROLLSTOP_LEADING_PRONOUN_RE.test(trimmed);
  const looksLikeFullSentence =
    startsWithPronoun && /[.!?]$/.test(trimmed) && wordCount > 5;
  // Phase 3 HOOK TEMPLATE TUNING — same generic-hook penalty as
  // scoreScrollStop. A scenario-AGNOSTIC compulsion fragment ("this
  // is it?", "still nothing.") points at "something" but the viewer
  // has no scenario hook to land on, so the open-loop mechanic is
  // softer than a scenario-anchored equivalent. -2 keeps the per-
  // intent contract symmetric across all three scorers.
  const entryGeneric = sourceEntry?.genericHook === true;

  let raw = 0;
  if (endsWithMystery) raw += 3;
  if (hasForward) raw += 2;
  if (!looksLikeFullSentence) raw += 2;
  if (hasDemonstrative) raw += 2;
  if (looksLikeFullSentence) raw -= 2;
  if (wordCount > 12) raw -= 2;
  if (entryGeneric) raw -= 4;

  return Math.max(0, Math.min(10, raw + 5));
}

/**
 * First-person leading shape (case-insensitive). Matches `i ` (with
 * word boundary), `i'm`, `i'll`, `i've`, leading `me`/`my`. Per spec
 * PART 4 — "sounds like the viewer's own internal monologue".
 */
const RELATABLE_FIRST_PERSON_RE: RegExp = /^(i\b|i'm|i'll|i've|me\b|my\b)/i;

/**
 * Concrete behavior verbs (case-insensitive whole-word match against
 * each token in the hook). Per spec PART 4 — "names a specific
 * action the viewer has done". Distinct from the abstract verbs the
 * scoreScrollStop abstraction detector rewards — these are
 * SPECIFICALLY past-tense narration verbs the relatable shape
 * leans on.
 */
const RELATABLE_BEHAVIOR_VERBS: ReadonlySet<string> = new Set([
  "opened",
  "closed",
  "texted",
  "deleted",
  "walked",
  "said",
  "did",
  "lied",
  "checked",
  "ignored",
  "scrolled",
  "stared",
  "called",
  "wrote",
  "read",
  "ate",
]);

/**
 * Admission tokens (case-insensitive whole-word match). Per spec
 * PART 4 — "admits something embarrassing". The presence of these
 * words flags a hook that's owning a recurring failure mode rather
 * than describing it from a distance.
 */
const RELATABLE_ADMISSION_TOKENS: readonly string[] = [
  "still",
  "again",
  "keep",
  "keeps",
  "always",
  "never",
];

/**
 * Relatable score — 0-10 derived from intrinsic hook properties:
 *   +3 starts with first-person (i, i'm, i'll, i've, me, my)
 *   +2 contains a concrete behavior verb (opened, closed, texted, …)
 *   +2 contains an admission token (still, again, keep, always, never)
 *   +2 lowercase-conversational (no uppercase chars beyond char 0 —
 *      catalog hooks are lowercase-styled so this rewards the
 *      dominant catalog shape vs. capitalized-fragment shapes that
 *      read as scroll_stop or compulsion)
 *   −2 generic abstraction (no first-person AND no meaningful noun —
 *      reuses the scoreScrollStop abstraction detector for symmetry)
 *   −2 starts with a safe prefix (i think / i feel like / you know
 *      when / kind of — same SCROLLSTOP_SAFE_PREFIXES set; safe
 *      phrasings are ALSO bad relatable because they observe-from-
 *      a-distance rather than admit)
 *   add baseline +5, clamp [0, 10]
 */
export function scoreRelatable(
  hook: string,
  sourceEntry?: LanguagePhrasingEntry,
): number {
  const trimmed = hook.trim();
  if (trimmed.length === 0) return 0;
  const lower = trimmed.toLowerCase();
  const words = trimmed.split(/\s+/);

  const startsFirstPerson = RELATABLE_FIRST_PERSON_RE.test(trimmed);

  const cleanedWords = words.map((w) =>
    w.toLowerCase().replace(/[.,!?;:'"`–—]/g, ""),
  );
  const hasBehaviorVerb = cleanedWords.some((w) =>
    RELATABLE_BEHAVIOR_VERBS.has(w),
  );
  const hasAdmission = cleanedWords.some((w) =>
    RELATABLE_ADMISSION_TOKENS.includes(w),
  );

  // lowercase-conversational: no uppercase chars beyond char 0. Slice(1)
  // skips any leading capital so a sentence-leading "I" doesn't
  // disqualify (matches the same first-char tolerance used in the
  // proper-noun heuristic of scoreScrollStop).
  const lowercaseConversational = !/[A-Z]/.test(trimmed.slice(1));

  // Generic abstraction reuses the SAME meaningful-noun heuristic as
  // scoreScrollStop so the two scorers agree on what "abstract" means.
  const meaningfulNoun = cleanedWords.some(
    (w) => w.length >= 4 && !SCROLLSTOP_ABSTRACT_ONLY_TOKENS.has(w),
  );
  const isGenericAbstraction = !startsFirstPerson && !meaningfulNoun;

  const hasSafePrefix = SCROLLSTOP_SAFE_PREFIXES.some((p) =>
    lower.startsWith(p),
  );

  // Phase 3 HOOK TEMPLATE TUNING — same generic-hook penalty as
  // scoreScrollStop / scoreCompulsion. A scenario-AGNOSTIC relatable
  // line ("i did not do it", "i'm over it. truly.") still admits
  // something, but without a scenario noun the admission is generic
  // self-talk rather than the spec's "names a specific action the
  // viewer has done". -2 (post-baseline) closes the parity loophole
  // where a generic high-admission line would beat a tagged scenario-
  // anchored line of equal admission strength.
  const entryGeneric = sourceEntry?.genericHook === true;

  let raw = 0;
  if (startsFirstPerson) raw += 3;
  if (hasBehaviorVerb) raw += 2;
  if (hasAdmission) raw += 2;
  if (lowercaseConversational) raw += 2;
  if (isGenericAbstraction) raw -= 2;
  if (hasSafePrefix) raw -= 2;
  if (entryGeneric) raw -= 4;

  return Math.max(0, Math.min(10, raw + 5));
}

/**
 * Dispatcher — routes to the per-intent scorer matching the
 * candidate's actual intent. Used by `scoreIdea` to compute
 * `hookIntentScore`. Defaults absent intent to `"scroll_stop"` so
 * legacy cache reads + Claude/Llama fallback wraps (which don't tag
 * intent) get the Phase 3 scoring semantics they always had.
 */
export function scoreHookIntent(
  hook: string,
  intent: HookIntent,
  sourceEntry?: LanguagePhrasingEntry,
): number {
  switch (intent) {
    case "scroll_stop":
      return scoreScrollStop(hook, sourceEntry);
    case "compulsion":
      return scoreCompulsion(hook, sourceEntry);
    case "relatable":
      return scoreRelatable(hook, sourceEntry);
  }
}

/** Words that signal tension / contradiction / regret in a hook. */
const TENSION_MARKERS = [
  "vs",
  "actually",
  "really",
  "instead",
  "anyway",
  "again",
  "still",
  "but",
  "and then",
  "the way i",
  "why do i",
  "why did i",
];

/** Words that signal an actionable / concrete moment. */
const CONCRETE_VERBS = [
  "open",
  "check",
  "read",
  "scroll",
  "watch",
  "find",
  "notice",
  "realise",
  "realize",
  "look",
  "stare",
  "pick",
  "grab",
  "send",
  "type",
  "swipe",
  "tap",
  "hear",
  "see",
  "do",
];

function scoreHookImpact(hook: string): 0 | 1 | 2 {
  const trimmed = hook.trim();
  const lower = trimmed.toLowerCase();
  const wordCount = trimmed.split(/\s+/).length;
  // Penalise generic / descriptive openings.
  if (
    lower.startsWith("here's") ||
    lower.startsWith("today i") ||
    lower.startsWith("a quick") ||
    wordCount > 12
  ) {
    return 0;
  }
  // Reward specific signals.
  const hasTensionMarker = TENSION_MARKERS.some((m) => lower.includes(m));
  const hasSpecificDetail = /\b(\d+|am|pm|3am|coffee|gym|laundry|fridge|inbox|hoodie|pile|alarm|cart)\b/.test(
    lower,
  );
  if (hasTensionMarker && hasSpecificDetail) return 2;
  if (hasTensionMarker || hasSpecificDetail) return 1;
  return 0;
}

function scoreTension(idea: Idea): 0 | 1 | 2 {
  const lower = `${idea.hook} ${idea.caption}`.toLowerCase();
  // Two strong tension signals — clear contradiction.
  const markerHits = TENSION_MARKERS.filter((m) => lower.includes(m)).length;
  if (markerHits >= 2 || idea.hasContrast) return 2;
  if (markerHits === 1) return 1;
  // Spike alone (without contradiction wording) is mild tension.
  if (
    idea.emotionalSpike === "regret" ||
    idea.emotionalSpike === "panic" ||
    idea.emotionalSpike === "embarrassment"
  ) {
    return 1;
  }
  return 0;
}

function scoreFilmability(idea: Idea): 0 | 1 | 2 {
  // Hard floor: requires more than 30 minutes ⇒ unfilmable.
  if (idea.filmingTimeMin > 30) return 0;
  // Sweet spot: ≤10 min in a single setting, single take.
  if (idea.filmingTimeMin <= 10 && idea.shotPlan.length <= 4) return 2;
  if (idea.filmingTimeMin <= 20 && idea.shotPlan.length <= 6) return 1;
  return 0;
}

function scorePersonalFit(
  idea: Idea,
  memory: ViralPatternMemory,
): 0 | 1 | 2 {
  // No memory → neutral fit (1). Don't penalise new creators.
  if (memory.sampleSize < 3) return 1;
  const structureWeight = memory.structures[idea.structure] ?? 0;
  const hookStyleWeight = memory.hookStyles[idea.hookStyle] ?? 0;
  const spikeWeight = memory.emotionalSpikes[idea.emotionalSpike] ?? 0;
  const total = structureWeight + hookStyleWeight + spikeWeight;
  if (total >= 4) return 2;
  if (total >= 2) return 1;
  return 0;
}

function scoreCaptionStrength(idea: Idea): 0 | 1 {
  const caption = idea.caption.trim();
  const hookLower = idea.hook.trim().toLowerCase();
  if (caption.toLowerCase() === hookLower) return 0;
  if (caption.length < 10) return 0;
  // Caption must add something — internal thought, contradiction, or
  // a specific detail not already in the hook.
  const addsContradiction = /\bbut\b|\binstead\b|\bactually\b|\bvs\b/.test(
    caption.toLowerCase(),
  );
  const addsDetail = caption.length >= 30;
  if (addsContradiction || addsDetail) return 1;
  return 0;
}

function scoreFreshness(
  idea: Idea,
  recentScenarios: string[],
  meta?: CandidateMeta,
): 0 | 1 {
  // If we know the scenario family AND it was recently used, demote.
  if (
    meta &&
    meta.scenarioFamily &&
    recentScenarios.includes(meta.scenarioFamily)
  ) {
    return 0;
  }
  return 1;
}

export function scoreIdea(
  idea: Idea,
  profile: StyleProfile,
  memory: ViralPatternMemory,
  recentScenarios: string[] = [],
  meta?: CandidateMeta,
  derivedStyleHints?: DerivedStyleHints,
): IdeaScore {
  // profile is reserved for future per-creator phrasing fit signals
  // (e.g. tone match between hook + their derived tone). For Layer 2
  // it's accepted but not yet used — keeps the public signature
  // forward-compatible.
  void profile;
  const hookImpact = scoreHookImpact(idea.hook);
  const tension = scoreTension(idea);
  const filmability = scoreFilmability(idea);
  const personalFitBase = scorePersonalFit(idea, memory);
  // Vision-derived soft bias — additive only, capped at 2, gated to
  // 1→2 transitions. Safe to call with `undefined` hints (no-op).
  const personalFit = applyVisionBoost(
    personalFitBase,
    meta,
    derivedStyleHints,
  );
  const captionStrength = scoreCaptionStrength(idea);
  const freshness = scoreFreshness(idea, recentScenarios, meta);
  // Phase 3 PART 3 — scroll-stop score. Pull the source phrasing
  // entry from the candidate meta when present (pattern_variation
  // candidates only); Claude/Llama fallback wraps + legacy cached
  // entries pass `undefined`, in which case `scoreScrollStop`
  // contributes intrinsic-only signal (no rigidity penalty / no
  // entry sharpness boost).
  const sourceEntry = meta ? metaSourceLanguagePhrasing(meta) : undefined;
  // Phase 3 PART 3 — scrollStopScore STAYS COMPUTED for telemetry /
  // dashboards / historical comparisons (the field on IdeaScore retains
  // its scroll-stop semantics regardless of the candidate's actual
  // intent). Phase 4 (HOOK INTENT) — `hookIntentScore` BELOW is the new
  // value folded into `total`; this scrollStopScore line is preserved
  // for the field but no longer contributes to the weighted sum.
  const scrollStopScore = scoreScrollStop(idea.hook, sourceEntry);
  // Phase 4 (HOOK INTENT) — dispatch to the per-intent scorer matching
  // the candidate's actual intent. Defaults absent intent to
  // `"scroll_stop"` so legacy cache reads + Claude/Llama fallback
  // wraps (which don't tag intent) get the Phase 3 scoring semantics
  // they always had — for those reads, hookIntentScore EQUALS
  // scrollStopScore by construction, so the total fold arithmetic is
  // unchanged for legacy candidates.
  const hookIntent: HookIntent =
    (meta ? metaHookIntent(meta) : undefined) ?? "scroll_stop";
  const hookIntentScore = scoreHookIntent(idea.hook, hookIntent, sourceEntry);
  // Low-weight (0.5x, rounded) fold into total — same weight slot as
  // scrollStopScore had in Phase 3 (REPLACED, not added — selection
  // budget unchanged). Range [0..5] additive on top of the existing
  // [0..10] from the legacy axes, so total floor / ceiling stays at
  // [0..15] — downstream selectors compare by total descending so
  // the absolute scale doesn't matter.
  const total =
    hookImpact +
    tension +
    filmability +
    personalFit +
    captionStrength +
    freshness +
    Math.round(hookIntentScore * 0.5);
  return {
    total,
    hookImpact,
    tension,
    filmability,
    personalFit,
    captionStrength,
    freshness,
    scrollStopScore,
    hookIntentScore,
  };
}

// -----------------------------------------------------------------------------
// Rewrite-once logic (no AI — just swap hook style + caption phrasing)
// -----------------------------------------------------------------------------

export type ScoredCandidate = {
  idea: Idea;
  meta: CandidateMeta;
  score: IdeaScore;
  rewriteAttempted: boolean;
};

/**
 * Phase 3D BUG B — exact-hook string dedup normalizer.
 * Used by `selectionPenalty` (against `ctx.recentHookStrings` AND
 * `batchSoFar`) AND by `buildNoveltyContext` when populating that
 * set from cache. MUST stay symmetric — the build side and the
 * lookup side must apply the EXACT same normalization or the
 * -1000 hard-reject silently no-ops. Lowercase + trim + collapse
 * internal whitespace + strip a single trailing `.,!?;:` so
 * cosmetic punctuation drift (e.g. `9:14pm. still here.` vs
 * `9:14pm. still here`) doesn't defeat the dedup. We deliberately
 * do NOT strip mid-string punctuation — preserves emoji, dashes,
 * and intentional fragmentation (the `9:14pm. still here.` static
 * timestamp template depends on the mid-string period for its
 * "two-clause status fragment" shape).
 */
export function normalizeHookForDedup(hook: string): string {
  return hook
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,!?;:]+$/, "");
}

function tryRewrite(
  idea: Idea,
  meta: CandidateMeta,
  recentHookSkeletons?: ReadonlySet<string>,
): { idea: Idea; meta: CandidateMeta } | null {
  if (meta.source !== "pattern_variation") return null;
  if (!meta.scenario) return null;
  const scenario = meta.scenario;
  // Phase 6 (BIG PREMISE LAYER) — premises are scenario-agnostic
  // complete jokes (spec PART 7). The rewrite path swaps the chosen
  // hook for a DIFFERENT legacy entry from `HOOK_PHRASINGS_BY_STYLE`,
  // which is scenario-bound by construction. Rewriting a premise
  // would replace the entire joke with a template — defeating the
  // feature. Skip rewrite for premise picks; if the score is too
  // weak the candidate gets rejected like any other (correct fail-
  // closed behavior — a premium premise that doesn't survive scoring
  // shouldn't be silently replaced by a generic template hook).
  if ("usedBigPremise" in meta && meta.usedBigPremise === true) return null;
  // Try each *other* hook style; for each, walk its phrasing list
  // and return the first variant that passes `validateHook`. We
  // deliberately do NOT slice to 10 words — the validator already
  // bounds length AND completeness, so a too-long variant is
  // skipped (not truncated into a dangling fragment, which was
  // the v1 rewriter's signature failure mode).
  const allStyles = Object.keys(HOOK_PHRASINGS_BY_STYLE) as Array<
    keyof typeof HOOK_PHRASINGS_BY_STYLE
  >;
  const otherStyles = allStyles.filter((s) => s !== idea.hookStyle);
  // Phase 3D BUG A — two-pass walk to keep the cross-batch
  // skeleton cap honest on the rewriter path. Pass 1 skips legacy
  // entries whose `skeletonId` is already in `recentHookSkeletons`
  // (i.e. has shipped recently per the persisted cache history),
  // so the rewriter no longer happily re-selects the same legacy
  // skeleton (`totally_fine_about` was the headline offender —
  // shipping in 8/8 batches in the Phase 3C QA sweep) on every
  // regen before `selectionPenalty`'s -3 cross-batch demotion
  // even sees the candidate. Pass 2 is the original no-skip walk,
  // entered only when pass 1 starved AND a non-empty hot list
  // existed (so cold-cache / unprovided callers behave EXACTLY
  // like before — same single walk, no behavioral drift). The
  // skip applies only when the entry HAS a `skeletonId` (legacy
  // entries without one are not subject to the cap and are
  // considered fresh on every pass).
  const hasHotList =
    recentHookSkeletons !== undefined && recentHookSkeletons.size > 0;
  const passes: ReadonlyArray<boolean> = hasHotList ? [true, false] : [false];
  for (const skipHotSkeletons of passes) {
    for (const nextStyle of otherStyles) {
      const phrasings = HOOK_PHRASINGS_BY_STYLE[nextStyle];
      if (!phrasings || phrasings.length === 0) continue;
      for (let i = 0; i < phrasings.length; i++) {
        const entry = phrasings[i]!;
        // Phase 3D BUG A — see two-pass header above. The skip
        // fires only on pass 1 (skipHotSkeletons=true), only when
        // the entry has a skeletonId, and only when that id is
        // in the recent set. Pass 2 (skipHotSkeletons=false)
        // bypasses this check entirely, preserving the original
        // pool-starvation safety net.
        if (
          skipHotSkeletons &&
          entry.skeletonId !== undefined &&
          recentHookSkeletons!.has(entry.skeletonId)
        ) {
          continue;
        }
        // Phase 3C HOOK CATALOG TAG COMPLETION — noun-type
      // compatibility gate. Skip the entry BEFORE calling `build()`
      // when the entry declared an `allowedNounTypes` allowlist and
      // the scenario's `topicNounType` is not in it. Mirrors the
      // identical gate inside `pickValidatedLanguagePhrasing.walk()`
      // (added in Phase 3B) so the rewriter and the live picker
      // share one noun-fit discipline. Undefined `allowedNounTypes`
      // means "any noun type is fine" (legacy + naturally-permissive
      // templates). The rewriter falls through to the next entry,
      // identical to the `validateHook` rejection path; the outer
      // `for (const nextStyle of otherStyles)` loop will also re-
      // enter the next style's phrasing list and find a compatible
      // entry there.
      if (
        entry.allowedNounTypes !== undefined &&
        !entry.allowedNounTypes.includes(scenario.topicNounType)
      ) {
        continue;
      }
      const candidate = entry.build(scenario).trim();
      if (!validateHook(candidate)) continue;
      // Phase 6F (LEGACY COMEDY SCORING + REJECTION) — apply the
      // same 4-dim 0-10 rubric + HARD reject < 5 that the picker
      // walk in `pickValidatedLanguagePhrasing` uses, so the
      // rewriter cannot rescue a low-quality legacy hook that the
      // picker would have rejected. The rewriter is already
      // legacy-only (the `if (... usedBigPremise === true) return null`
      // gate at the top of this function), so every `entry` here is
      // a legacy candidate and gets the legacy rubric applied
      // (never the premise rubric — premises are scenario-agnostic
      // and never appear in `HOOK_PHRASINGS_BY_STYLE`). The
      // computed score is propagated to `nextMeta.legacyComedyScore`
      // below (parallel to the `premiseComedyScore` clear) so
      // `selectionPenalty.legacyComedyBoost` reads accurate per-
      // rewrite data, not a stale score carried over from the
      // original pick. Symmetric with the picker walk's HARD reject
      // — no `continue` ordering subtlety because the per-entry
      // skeleton + noun-type checks above already use the same
      // `continue` exit path.
      const legacyScore = scoreLegacyComedyScore(candidate, entry, scenario);
      if (legacyScore.rejected || legacyScore.total < 5) continue;
      // Found a shippable rewrite. Update hookOpener too so the
      // batch guards / novelty scorer see the new opener (the
      // chosen entry's tag is authoritative; falling back to
      // `lookupHookOpener` only if the tag is somehow absent).
      const newOpener = entry.opener ?? lookupHookOpener(candidate);
      // Phase 3: the rewrite path draws from `HOOK_PHRASINGS_BY_STYLE`
      // (the legacy 5-style catalog) — these entries do NOT carry
      // rigidity/sharpness scores. If we kept the original meta's
      // `sourceLanguagePhrasing` (which pointed at the language-style
      // catalog entry the picker chose), `scoreScrollStop` would
      // attribute that entry's rigidity/sharpness to the rewritten
      // hook — a false signal. Clear the field so the scorer falls
      // back to hook-string inspection alone (the conservative path).
      const nextMeta: CandidateMeta = { ...meta };
      if ("sourceLanguagePhrasing" in nextMeta) {
        nextMeta.sourceLanguagePhrasing = undefined;
      }
      // Phase 3 HOOK TEMPLATE TUNING — the rewrite path swaps to a
      // DIFFERENT legacy entry, so any `meta.hookSkeletonId` carried
      // over from the original picker pick now belongs to a hook that
      // is NO LONGER on the candidate. Without clearing, the within-
      // batch + cross-batch + session-cap skeleton levers in
      // `selectionPenalty` would all fire against the WRONG skeleton
      // (penalizing or boosting based on phantom telemetry). Re-derive
      // from the rewrite entry — `entry.skeletonId` is undefined for
      // every legacy 5-style entry today (none of the legacy templates
      // were tagged in T001) so the assignment usually clears the
      // field, but the propagation path is in place for any future
      // legacy tagging without a follow-up code change.
      nextMeta.hookSkeletonId = entry.skeletonId;
      // Phase 3 HOOK TEMPLATE TUNING — also propagate `genericHook`
      // forward so a rewritten generic legacy hook still triggers both
      // the per-intent generic penalty (read via metaSourceLanguage-
      // Phrasing in scoreScrollStop / scoreCompulsion / scoreRelatable)
      // AND the flat selection-layer -3 demotion. Constructed as a
      // minimal stub (no `build` fn — the readers only touch optional
      // score fields, with `getEntryScores` returning the conservative
      // 3/3 default for the missing rigidityScore/sharpnessScore — same
      // as the cleared-source posture above). Cast through `unknown`
      // because LanguagePhrasingEntry's required `build` field is a
      // structural-only constraint here that the readers never
      // exercise on rewrite-derived stubs. Skipped when entry has no
      // genericHook flag (the normal case for current legacy entries),
      // in which case `sourceLanguagePhrasing` stays cleared per the
      // original conservative-scoring intent.
      if (entry.genericHook === true) {
        nextMeta.sourceLanguagePhrasing = {
          genericHook: true,
        } as unknown as LanguagePhrasingEntry;
      }
      // Phase 4 (HOOK INTENT) — the rewritten hook now comes from a
      // DIFFERENT legacy entry, which carries its own intent (or
      // defaults to scroll_stop via getEntryIntent for legacy entries
      // without the field). Without updating meta.hookIntent here, the
      // candidate would carry STALE intent metadata from the original
      // pick, causing scoreHookIntent to dispatch to the wrong per-
      // intent scorer and the batch guards (both the soft -3/-100 in
      // selectionPenalty and the hard all-3-same in batchGuardsPass)
      // to make decisions on a phantom intent. Re-derive from the
      // winning entry — the same discipline used at first-pick time
      // (assembleCandidate sets meta.hookIntent = getEntryIntent(
      // sourceLanguagePhrasing) at line 4948 of patternIdeator.ts).
      // intentFallback is cleared because rewrite is its own path —
      // the original picker's fallback telemetry no longer applies.
      const rewrittenIntent = getEntryIntent(entry);
      if ("intentFallback" in nextMeta) {
        nextMeta.intentFallback = undefined;
      }
      // Phase 6 (BIG PREMISE LAYER) — the rewrite swaps to a DIFFERENT
      // legacy entry which is NEVER a premise (no legacy entry carries
      // `bigPremise: true`). Clear the original premise telemetry so
      // downstream readers (QA driver count, within-batch -3 dup,
      // cross-batch -2 in `recentBigPremiseStyles`) don't attribute
      // a premise pick to a hook that no longer renders one. Same
      // staleness discipline as the `sourceLanguagePhrasing` /
      // `hookSkeletonId` / `intentFallback` clears above.
      if ("usedBigPremise" in nextMeta) {
        nextMeta.usedBigPremise = undefined;
      }
      if ("bigPremiseStyle" in nextMeta) {
        nextMeta.bigPremiseStyle = undefined;
      }
      // Phase 6 EXPANSION — also clear the fine-grained id + label
      // for the same staleness reason: the rewrite swaps to a legacy
      // entry which is NEVER a Phase 6 EXPANSION premise (no legacy
      // entry carries `premiseStyleId`), so leaving these set would
      // attribute a fine-grained premise pick to a hook that no
      // longer renders one. Both fields cleared together so the
      // OUTPUT METADATA pair (id + label) stays internally consistent
      // and the within-batch / cross-batch fine-grained levers go
      // quiet for the rewritten candidate.
      if ("premiseStyleId" in nextMeta) {
        nextMeta.premiseStyleId = undefined;
      }
      if ("premiseStyleLabel" in nextMeta) {
        nextMeta.premiseStyleLabel = undefined;
      }
      // Phase 6D (PREMISE EXECUTION EXPANSION) — also clear the fine-
      // grained execution id for the same staleness reason: the
      // rewrite swaps to a legacy entry which is NEVER a Phase 6D
      // execution (no legacy entry carries `executionId`), so leaving
      // this set would attribute an execution-tagged premise pick to
      // a hook that no longer renders one. The within-batch HARD
      // tuple guard + cross-batch -2/+2 levers go quiet for the
      // rewritten candidate. Same staleness discipline as the
      // `premiseStyleId` / `premiseStyleLabel` clears above.
      if ("executionId" in nextMeta) {
        nextMeta.executionId = undefined;
      }
      // Phase 6E — clear the comedy-rubric snapshot when the candidate
      // is rewritten to a legacy template. The score is intrinsically
      // tied to the original premise hook text + entry context; once
      // the hook is swapped to a non-premise legacy entry the cached
      // score no longer describes the shipped string. Same staleness
      // discipline as the `premiseStyleId` / `premiseStyleLabel` /
      // `executionId` clears above.
      if ("premiseComedyScore" in nextMeta) {
        nextMeta.premiseComedyScore = undefined;
      }
      // Phase 6F (LEGACY COMEDY SCORING + REJECTION) — OVERWRITE
      // (not clear) any prior `legacyComedyScore` carried over
      // from the original pick with the freshly-computed score
      // for THIS rewrite candidate. Different from the
      // `premiseComedyScore = undefined` above because the
      // original premise telemetry no longer applies (the
      // rewrite is legacy, not premise) so it must be cleared,
      // whereas the rewrite IS itself a legacy hook and so a
      // legacy score IS meaningful — just tied to the new
      // candidate, not the original. Assigning `legacyScore`
      // here keeps `selectionPenalty.legacyComedyBoost` in
      // perfect sync with the actual shipping hook string,
      // mirroring the picker walk's per-candidate scoring
      // discipline. The HARD reject above already guarantees
      // `legacyScore.total >= 5` and `rejected === false`, so
      // the boost band is in the safe demote-or-better range.
      nextMeta.legacyComedyScore = legacyScore;
      return {
        idea: { ...idea, hook: candidate, hookStyle: nextStyle },
        meta: {
          ...nextMeta,
          hookStyle: nextStyle,
          hookPhrasingIndex: i,
          hookOpener: newOpener,
          hookIntent: rewrittenIntent,
        },
      };
      }
    }
  }
  return null;
}

// -----------------------------------------------------------------------------
// Top-level filter+score+rewrite pipeline
// -----------------------------------------------------------------------------

export type FilterAndRescoreInput = {
  candidates: { idea: Idea; meta: CandidateMeta }[];
  profile: StyleProfile;
  memory: ViralPatternMemory;
  recentScenarios?: string[];
  /**
   * Llama 3.2 Vision-derived style hints. Optional — when absent
   * (the common case for new creators / pre-v21 rows) the scoring
   * pipeline is identical to its pre-vision behavior. When present,
   * applied via `applyVisionBoost` at the personalFit step only.
   * See `lib/visionProfileAggregator.ts` for the doc shape.
   */
  derivedStyleHints?: DerivedStyleHints;
  /**
   * Phase 3D BUG A — cross-batch hot skeleton ids forwarded into
   * `tryRewrite` so its two-pass entry walk skips legacy hook
   * entries whose `skeletonId` already shipped recently. Sourced
   * from `noveltyContext.recentHookSkeletons` at the orchestrator
   * boundary; defaults to undefined so callers that don't thread
   * a novelty context (e.g. unit tests, ad-hoc rescoring) keep
   * the original single-walk rewrite behavior.
   */
  recentHookSkeletons?: ReadonlySet<string>;
  /**
   * Phase 3D BUG B — exact-hook string set forwarded to nothing
   * here today (filtering happens in `selectionPenalty`); kept on
   * the input shape so the same orchestrator wiring that hands
   * `recentHookSkeletons` to filterAndRescore can pass this in
   * one shot. Reserved for future use if we want to short-circuit
   * candidates pre-scoring rather than rely on the -1000 demotion
   * inside the selector.
   */
  recentHookStrings?: ReadonlySet<string>;
  /**
   * PHASE X2 — PART 4 — normalized premise sentences (lowercase,
   * punctuation stripped, whitespace collapsed) collected from the
   * last-5 batches' cached `idea.premise` fields. Threaded into
   * `validateAntiCopy` to reject candidates whose premise duplicates
   * a recent batch's premise. Defaults to undefined for callers that
   * don't have history (cold start, ad-hoc rescoring) — the
   * validator no-ops on an absent / empty set.
   */
  recentPremises?: ReadonlySet<string>;
};

export type FilterAndRescoreResult = {
  kept: ScoredCandidate[];
  rejected: number;
  hardRejected: number;
  rewriteSucceeded: number;
  /**
   * PHASE X2 — PART 6 — per-reason rejection counters from the
   * comedy / alignment / anti-copy validators. Existing
   * `rejected` / `hardRejected` counters remain authoritative for
   * total counts; this map is a strictly additive breakdown for
   * telemetry. Empty when no validator fired (the rescue path
   * needs a stable shape; callers can `?.` into specific reasons).
   */
  rejectionReasons: Record<ComedyRejectionReason, number>;
};

function emptyRejectionReasons(): Record<ComedyRejectionReason, number> {
  return {
    no_contradiction: 0,
    no_tension: 0,
    generic_observation: 0,
    too_soft: 0,
    hook_scenario_mismatch: 0,
    filming_mismatch: 0,
    copied_seed_hook: 0,
    near_duplicate_premise: 0,
  };
}

export function filterAndRescore(
  input: FilterAndRescoreInput,
): FilterAndRescoreResult {
  const recent = input.recentScenarios ?? [];
  const kept: ScoredCandidate[] = [];
  let hardRejected = 0;
  let rewriteSucceeded = 0;
  let rejected = 0;
  // PHASE X2 — PART 6 — per-reason counters. Initialized with all
  // keys at zero so downstream telemetry can read any reason
  // unconditionally without `?? 0` checks.
  const rejectionReasons = emptyRejectionReasons();
  // Lazy-load the seed-hook fingerprint corpus once per
  // filterAndRescore call. The loader memoizes at module scope so
  // repeated calls within a process are O(1) after the first.
  const seedFingerprints = loadSeedHookFingerprints();

  for (const c of input.candidates) {
    const hard = checkHardRejects(c.idea);
    if (hard !== null) {
      hardRejected++;
      continue;
    }
    let score = scoreIdea(
      c.idea,
      input.profile,
      input.memory,
      recent,
      c.meta,
      input.derivedStyleHints,
    );
    // PHASE X — PART 1+2 — DefaultTaste boost. Pure additive lift
    // (0..+4) for candidates whose premise mechanism + hook
    // language style + premise-first path align with the
    // `DefaultTasteProfile`. Applied AFTER the existing scoring
    // so the per-axis breakdown (hookImpact / tension / etc.) is
    // unchanged for telemetry, but `score.total` rises so the
    // sort + greedy selector naturally favor on-taste candidates.
    // The big lever is `PREMISE_FIRST_BONUS` (~+1.5) which fires
    // any time `meta.usedBigPremise === true` — that's the
    // "premise-first generation" lever from PHASE X PART 2:
    // candidates born from the premise path now reliably beat
    // template-only candidates of equal raw quality.
    {
      const tasteBoost = scoreDefaultTaste({
        premiseStyleId:
          (c.meta as { premiseStyleId?: PremiseStyleId }).premiseStyleId ??
          null,
        hookLanguageStyle:
          (c.meta as { hookLanguageStyle?: HookLanguageStyle })
            .hookLanguageStyle ?? null,
        usedBigPremise:
          (c.meta as { usedBigPremise?: boolean }).usedBigPremise ?? false,
      });
      if (tasteBoost > 0) {
        score = { ...score, total: score.total + tasteBoost };
      }
    }
    let idea = c.idea;
    let meta = c.meta;
    let rewriteAttempted = false;

    // Hard floor: any zero in the three critical axes ⇒ reject regardless.
    // Phase 6 — Big Premise candidates are scenario-AGNOSTIC complete jokes by
    // design and therefore never contain the tension-marker / specific-detail
    // words `scoreHookImpact` looks for, so they always score `hookImpact = 0`
    // legitimately. The deferred Part 4 boost would have lifted their score
    // implicitly; until that ships, we exempt premise candidates ONLY from the
    // `hookImpact === 0` arm of the hard floor (tension and filmability arms
    // still apply — those measure the SHOT, not the hook's wording). This is a
    // structural gate-decision change for a new candidate kind, NOT a scoring
    // philosophy change: `scoreIdea` itself is untouched.
    const isPremise =
      (meta as { usedBigPremise?: boolean }).usedBigPremise === true;
    const hookImpactFails = !isPremise && score.hookImpact === 0;
    if (hookImpactFails || score.tension === 0 || score.filmability === 0) {
      // Try rewrite once if it's pattern_variation — maybe a different
      // hook style salvages it.
      // Phase 3D BUG A — thread the cross-batch hot skeleton list so
      // the rewriter's two-pass walk can prefer fresh skeletons.
      const rewritten = tryRewrite(idea, meta, input.recentHookSkeletons);
      if (!rewritten) {
        rejected++;
        continue;
      }
      rewriteAttempted = true;
      idea = rewritten.idea;
      meta = rewritten.meta;
      score = scoreIdea(
        idea,
        input.profile,
        input.memory,
        recent,
        meta,
        input.derivedStyleHints,
      );
      if (score.hookImpact === 0 || score.tension === 0 || score.filmability === 0) {
        rejected++;
        continue;
      }
      rewriteSucceeded++;
    }

    // 6–7 promising-but-weak: previously tried one rewrite via
    // `tryRewrite` and kept the best of the two. Phase 6D DISABLED
    // this promotion arm: the rewrite drew from the legacy
    // HOOK_PHRASINGS_BY_STYLE catalog ("I am totally fine about X" /
    // "I really planned to handle X" were the headline offenders,
    // accounting for ~80% of legacy ships in the 6D QA sweep),
    // inflating non-premise candidates above the typical premise-
    // with-+3-boost score of 9-12 and pinning premise share at ~67%
    // (below the 6D ≥85% gate). Skipping the promotion lets the
    // selector pick a premise candidate over a weak (6-7 score) non-
    // premise candidate naturally, instead of resurrecting a generic
    // legacy template. The hard-floor rewrite at L1501 above is
    // PRESERVED (it rescues candidates that would otherwise be
    // REJECTED outright, not promotes already-eligible ones — the
    // spec's "legacy drops NATURALLY from a larger pool" intent only
    // argues against the promotion arm). Premise candidates are not
    // affected either way (`tryRewrite` returns null for
    // `usedBigPremise === true` per its L1221 guard).
    void rewriteAttempted; // retained for hard-floor branch above
    void isPremise;

    // PHASE X2 — PART 1+2 — comedy + alignment validation. Cheap
    // heuristic checks that fire AFTER scoring (so the per-axis
    // breakdown is preserved for telemetry) and AFTER any rewrite
    // (so the final assembled idea is what the validator sees).
    // Vacuous-passes Layer-1 premise candidates on the comedy
    // gate by design — the curated catalog IS the comedy ground
    // truth and re-validating it would over-reject. The rescue
    // path in `hybridIdeator.ts` handles the unlikely case where
    // ALL candidates fail, so over-rejection cannot blank the
    // batch (PART 5 fail-open).
    {
      const reason = validateComedy(idea, meta);
      if (reason !== null) {
        rejectionReasons[reason]++;
        rejected++;
        continue;
      }
    }
    // PHASE X2 — PART 4 — anti-copy guard. Rejects LLM-generated
    // hooks that exact-match a curated seed hook (Layer 1
    // pattern_variation candidates ship the curated examples by
    // design and are exempt). Also rejects any candidate whose
    // premise sentence duplicates a recent batch's premise.
    {
      const reason = validateAntiCopy(
        idea,
        meta,
        seedFingerprints,
        input.recentPremises,
      );
      if (reason !== null) {
        rejectionReasons[reason]++;
        rejected++;
        continue;
      }
    }

    if (score.total < 6) {
      rejected++;
      continue;
    }

    kept.push({ idea, meta, score, rewriteAttempted });
  }

  // Sort by score desc, then prefer pattern_variation on ties.
  kept.sort((a, b) => {
    if (b.score.total !== a.score.total) return b.score.total - a.score.total;
    if (b.score.personalFit !== a.score.personalFit) {
      return b.score.personalFit - a.score.personalFit;
    }
    if (b.score.hookImpact !== a.score.hookImpact) {
      return b.score.hookImpact - a.score.hookImpact;
    }
    // pattern_variation wins ties because it cost nothing.
    if (a.meta.source === "pattern_variation" && b.meta.source !== "pattern_variation") return -1;
    if (b.meta.source === "pattern_variation" && a.meta.source !== "pattern_variation") return 1;
    return 0;
  });

  return { kept, rejected, hardRejected, rewriteSucceeded, rejectionReasons };
}

// -----------------------------------------------------------------------------
// Novelty scoring (0–5) + selection penalties
// -----------------------------------------------------------------------------
// Layered ON TOP of qualityScore (`IdeaScore.total`, 0–10) by the
// hybrid orchestrator's selector. Two ideas with the same quality
// score now get separated by:
//
//   1. Novelty bonus (0–8 plus a cross-batch +3 boost) — per-axis
//      0/1 across hookStyle, scenario, structure, visualAction,
//      topic, hookOpener, setting, scriptType (each fresh against
//      BOTH the already-picked batch AND the recent context). ON
//      TOP of that, an additional +3 fires when scriptType is in
//      `ctx.unusedScriptTypesLast3` — the spec's headline "rotate
//      the catalog" lever. Maximum bonus is 11 (fresh on all 8
//      axes plus catalog-cold scriptType). ONLY applied when
//      qualityScore >= HIGH_QUALITY_SCORE (8) so novelty cannot
//      rescue weak ideas.
//
//   2. Selection penalty (negative) — applied at pick time. The
//      already-picked batch contributes within-batch demotions;
//      the optional `ctx` adds cross-batch tiered demotions on
//      the scriptType axis (immediate-prior + frequent-in-3).
//      Within-batch:
//         -2 same hookStyle
//         -3 same scenarioFamily
//         -1 same structure
//         -2 same topicLane
//         -2 same visualActionPattern
//         -2 same hookOpener
//         -2 same setting
//         -2 same scriptType
//      Cross-batch (vs ctx):
//         -3 scriptType ∈ recentScriptTypes        (immediate-prior batch)
//         -2 scriptType ∈ frequentScriptTypesLast3 (≥2 of last 3, stacks
//                                                   on top of the -3)
//      Penalties stack across axes but DO NOT stack across multiple
//      already-picked candidates with the same axis value (a single
//      match is enough — the dimension is already saturated).
//
// adjustedScore at pick time = qualityScore + noveltyBonus + penalty.
// The selector picks greedily by adjustedScore, recomputing per pick.

/**
 * Recent / cross-batch context used by `scoreNovelty`. The current
 * batch's already-picked candidates are passed separately so the
 * caller can build context once per request and re-use it across
 * picks.
 */
export type NoveltyContext = {
  recentFamilies?: ReadonlySet<string>;
  recentStyles?: ReadonlySet<string>;
  recentTopics?: ReadonlySet<TopicLane>;
  recentVisualActions?: ReadonlySet<VisualActionPattern>;
  /**
   * Cross-batch demotion for hook openers — derived from the cached
   * hooks via `lookupHookOpener`. Without this dimension we'd ship
   * "I just realized…" three batches in a row even though every
   * other axis (family, style, structure) rotated.
   */
  recentHookOpeners?: ReadonlySet<HookOpener>;
  /**
   * Cross-batch demotion for physical setting — derived from each
   * cached idea's `setting` field. Stops three batches in a row
   * from all being in the kitchen.
   */
  recentSettings?: ReadonlySet<Setting>;
  /**
   * @deprecated Phase 1 — scriptType axis is INERT TELEMETRY. Set is still
   * populated by `buildNoveltyContext` so logs / cache parse continue to
   * work, but `scoreNovelty` and `selectionPenalty` no longer read it.
   * The active narrative-shape lever is now `recentIdeaCoreFamilies` /
   * `recentIdeaCoreTypes` below.
   */
  recentScriptTypes?: ReadonlySet<ScriptType>;
  /**
   * @deprecated Phase 1 — see `recentScriptTypes`. Replaced by
   * `frequentIdeaCoreFamiliesLast3`.
   */
  frequentScriptTypesLast3?: ReadonlySet<ScriptType>;
  /**
   * @deprecated Phase 1 — see `recentScriptTypes`. Replaced by
   * `unusedIdeaCoreFamiliesLast3`.
   */
  unusedScriptTypesLast3?: ReadonlySet<ScriptType>;
  /**
   * IdeaCoreFamily axis (Phase 1) — immediate-prior-batch families
   * derived from cached entries via `lookupIdeaCoreType(family,
   * templateId)` then `resolveIdeaCoreFamily(coreType)`. Used by:
   *   - `scoreNovelty` — binary "fresh family" dim.
   *   - `selectionPenalty` — `-3` cross-batch demotion when the
   *     candidate's family is in this set (last batch).
   *   - The hybrid orchestrator's regen rescue (requires ≥2 NEW
   *     families per batch on regenerate).
   *
   * Unset / empty when no prior cache exists (cold start). Selector
   * treats absent as "no contribution to the cross-batch family
   * lever" — same discipline as the legacy scriptType fields.
   */
  recentIdeaCoreFamilies?: ReadonlySet<IdeaCoreFamily>;
  /**
   * IdeaCoreFamily axis (Phase 1) — families appearing in ≥2 of the
   * last 3 batches. Stacks with `recentIdeaCoreFamilies` so a family
   * that's BOTH immediate-prior AND frequent-across-3 takes
   * `-3 + -2 = -5` cross-batch in `selectionPenalty`. Empty when
   * fewer than 3 batches of history exist.
   */
  frequentIdeaCoreFamiliesLast3?: ReadonlySet<IdeaCoreFamily>;
  /**
   * IdeaCoreFamily axis (Phase 1) — families that have NOT appeared
   * in any of the last 3 batches. Computed as
   * `IDEA_CORE_FAMILIES − union(last 3 batches' families)`. Drives the
   * spec's headline `+3` "rotate the catalog" boost in `scoreNovelty`
   * — sized to dominate the per-axis fresh signals so a catalog-cold
   * family wins over a tied-quality clone of a stale one.
   */
  unusedIdeaCoreFamiliesLast3?: ReadonlySet<IdeaCoreFamily>;
  /**
   * IdeaCoreType axis (Phase 1) — immediate-prior-batch exact types
   * derived from cache. Used by `scoreNovelty` (binary fresh dim;
   * smaller axis than family because exact-type collisions across
   * 120 values are rare even without rotation).
   */
  recentIdeaCoreTypes?: ReadonlySet<IdeaCoreType>;
  /**
   * Cross-batch demotion for archetype — IDEA ARCHETYPE spec.
   * Derived from cached entries via `resolveArchetypeLoose(scriptType)`
   * (where scriptType is itself derived via `lookupScriptType`).
   * Used by `scoreNovelty` (binary fresh dim) — the +3 catalog-rotate
   * boost rides on `unusedScriptTypesLast3` since archetype is 1:1
   * derived from scriptType for our 37 active values.
   */
  recentArchetypes?: ReadonlySet<Archetype>;
  /**
   * Cross-batch demotion for archetypeFamily — IDEA ARCHETYPE spec.
   * Used by `selectionPenalty` (-2 demotion) and the regen-fresh-
   * archetypeFamily rescue path (selectWithNovelty requires ≥1 pick
   * with a family NOT in this set when regenerating).
   */
  recentArchetypeFamilies?: ReadonlySet<ArchetypeFamily>;
  /**
   * Cross-batch demotion for sceneObjectTag — SCENE-OBJECT TAG spec.
   * Immediate-prior-batch only (analogous to recentScriptTypes).
   * Used by `scoreNovelty` (binary fresh dim) and `selectionPenalty`
   * (-3 demotion). Drives the regen-fresh-sceneObjectTag rescue.
   */
  recentSceneObjectTags?: ReadonlySet<SceneObjectTag>;
  /**
   * SceneObjectTags appearing in ≥2 of the last 3 batches. Stacks
   * with `recentSceneObjectTags` so a tag that's both immediate-
   * prior AND frequent across last 3 takes -3 + -2 = -5 cross-batch.
   */
  frequentSceneObjectTagsLast3?: ReadonlySet<SceneObjectTag>;
  /**
   * SceneObjectTags that have NOT appeared in any of the last 3
   * batches. Computed as `SCENE_OBJECT_TAGS − union(last 3 batches'
   * sceneObjectTags)`. Used by `scoreNovelty` for the +3 catalog-
   * rotate boost on the scene-object axis (parallel to the
   * `unusedScriptTypesLast3` lever).
   */
  unusedSceneObjectTagsLast3?: ReadonlySet<SceneObjectTag>;
  /**
   * HOOK STYLE spec axis — immediate-prior-batch language modes.
   * Used by `scoreNovelty` (binary fresh dim) and `selectionPenalty`
   * (-3 demotion). Drives the regen-fresh-hookLanguageStyle rescue.
   */
  recentHookLanguageStyles?: ReadonlySet<HookLanguageStyle>;
  /**
   * HOOK STYLE spec axis — language modes that have NOT appeared in
   * any of the last 3 batches. Computed as `HOOK_LANGUAGE_STYLES −
   * union(last 3 batches' hookLanguageStyles)`. Used by
   * `scoreNovelty` for the +2 catalog-rotate boost — sized smaller
   * than the +3 scriptType / sceneObjectTag boosts because the new
   * language axis ships with no historical signal yet (creator
   * memory doesn't track it), so we don't want it to fight the
   * scriptType / archetype levers when those have stronger
   * evidence.
   */
  unusedHookLanguageStylesLast3?: ReadonlySet<HookLanguageStyle>;
  /**
   * VOICE PROFILES spec axis — immediate-prior-batch voices. Used by
   * `scoreNovelty` (binary fresh dim) and `selectionPenalty` (-2
   * cross-batch demotion). Drives the regen-fresh-voiceProfile rescue
   * path in `selectWithNovelty`. Sized smaller than the scriptType /
   * sceneObjectTag cross-batch lever (-3) because the voice pool is
   * only 8 values and the allowed-set is typically 3-4 — a -3
   * stacked with the within-batch -2 would over-penalize creators
   * whose calibration intentionally locks them to a narrow set.
   */
  recentVoiceProfiles?: ReadonlySet<VoiceProfile>;
  /**
   * VOICE PROFILES spec axis — voices that have NOT appeared in any
   * of the last 3 batches. Computed as `VOICE_PROFILES − union(last
   * 3 batches' voiceProfiles)`. Used by `scoreNovelty` for the +1
   * catalog-rotate boost — sized smaller (+1 not +2) than the
   * HookLanguageStyle boost because the voice pool is only 8 values
   * (vs 12 for HLS) and a creator's allowed-set is typically 3-4
   * voices, so "unused in last 3" is statistically MORE common per
   * batch and we want to keep the boost from outweighing well-
   * evidenced scriptType / scene-object levers.
   */
  unusedVoiceProfilesLast3?: ReadonlySet<VoiceProfile>;
  /**
   * VOICE PROFILES spec — set when the creator's primary voice came
   * from `tasteCalibration.preferredTone` (the "user explicitly picked
   * it" priority tier). When true, `batchGuardsPass` BYPASSES the
   * "no 3-identical voiceProfile" hard reject — a creator who locked
   * to `blunt` deserves three blunt picks rather than a forced
   * rotation that contradicts their stated preference.
   *
   * False / undefined for hints / vision / default-rotation tiers
   * (the rotation pressure should win there because the source
   * signal isn't an explicit user choice — just an inferred default).
   * Within-batch and cross-batch SOFT penalties in `selectionPenalty`
   * still fire under strongPreference: even when 3-of-same is
   * tolerated, the selector should still prefer rotation when a
   * shippable alternative exists.
   */
  voiceStrongPreference?: boolean;
  /**
   * TREND CONTEXT LAYER spec — immediate-prior-batch trend ids
   * (curator-managed string identifiers from `TREND_CATALOG`). Used
   * by `selectionPenalty` for the -2 cross-batch demotion when this
   * candidate's `meta.trendId` matches one shipped in the previous
   * batch (keeps the same trend from dominating back-to-back
   * batches).
   *
   * Single-tier ONLY (no frequent-last-3 stack and no unused-last-3
   * boost) because trends are an OPTIONAL overlay, NOT a forced
   * rotation axis — emission rate is ≤30% by gate design and we
   * never penalize the absence of a trend (legacy / Llama / Claude
   * fallback entries with `trendId === undefined` skip the penalty
   * silently, same discipline as `voiceProfile`).
   *
   * Read directly off the cache entry (first-class JSONB field) by
   * `buildNoveltyContext`. Legacy entries written before the trend
   * layer shipped contribute nothing to this set, which is the
   * right behavior — an absent tag should NOT show up here or the
   * -2 penalty would fire against innocent fresh trends.
   */
  recentTrendIds?: ReadonlySet<string>;
  /**
   * Phase 5 (PATTERN MAPPING LAYER) — immediate-prior-batch
   * VideoPattern set (the typed video-shape axis from
   * `meta.videoPattern`). Used by `selectionPenalty` for the -3
   * cross-batch demotion when this candidate's `meta.videoPattern`
   * matches one shipped in the previous batch.
   *
   * Single-tier (no frequent-last-3 stack and no unused-last-3
   * boost) because the within-pool recency pressure inside
   * `pickVideoPattern` already handles within-pool spread, and the
   * batch-guard `h2` already caps within-batch dup at 2 — the
   * cross-batch lever here just keeps yesterday's two-of-a-kind
   * from showing up again today.
   *
   * Skips when the candidate has no `meta.videoPattern` (Llama /
   * Claude fallback wraps + pre-Phase-5 cache reads) — same
   * discipline as voiceProfile / trendId / archetype. Read off
   * cache by `buildNoveltyContext` (added in Phase 5 wiring there
   * if/when the cache writes the new field; absent reads collapse
   * to the empty set, which is the safe default).
   */
  recentVideoPatterns?: ReadonlySet<VideoPattern>;
  /**
   * Phase 3 HOOK TEMPLATE TUNING — immediate-prior-batch hook
   * skeleton ids (the formulaic-template tags from
   * `meta.hookSkeletonId`). Used by `selectionPenalty` for the -3
   * cross-batch demotion when this candidate's `meta.hookSkeletonId`
   * matches one shipped in the previous batch. Stacks with the -2
   * `frequentHookSkeletonsLast3` tier when a skeleton is BOTH
   * immediate-prior AND frequent across the last 3 batches (-3 + -2
   * = -5 cross-batch, plus any within-batch -3 dup penalty).
   *
   * Source = first-class `hookSkeletonId` field on each cache entry
   * (no derivation path from `idea.hook` text — formulaic templates
   * don't share a fingerprint after Scenario interpolation). Legacy
   * entries written before the field shipped contribute nothing,
   * which is the right behavior — an absent tag should NOT show up
   * in this set or the demotion would fire against innocent fresh
   * skeletons.
   */
  recentHookSkeletons?: ReadonlySet<string>;
  /**
   * Phase 3 HOOK TEMPLATE TUNING — cross-batch tiered counterpart to
   * `recentHookSkeletons`. Holds skeleton ids that appeared in ≥2 of
   * the last 3 batches (parallels `frequentIdeaCoreFamiliesLast3`
   * compute pattern). Drives the -2 `selectionPenalty` stack on top
   * of the immediate-prior -3, so a thrice-used skeleton accrues -5
   * cross-batch + -3 within-batch dup before any tied scoring axis
   * comes into play — comfortably enough to push the selector onto
   * an alternative entry of the same intent / language style.
   */
  frequentHookSkeletonsLast3?: ReadonlySet<string>;
  /**
   * Phase 3 HOOK TEMPLATE TUNING — session-wide hard-cap tier on top
   * of the tiered last-3 levers above. Holds skeleton ids that have
   * already shipped ≥2 times anywhere in the visible cache history
   * (not just the last 3 batches). Drives an additional -4 demotion
   * in `selectionPenalty` so a third appearance is reliably out-
   * ranked even when the prior two uses are spaced beyond the last-3
   * window (the failure mode the last-3 tiers leave open: a skeleton
   * used in batches 2 + 4 + 6 escapes both `recentHookSkeletons`
   * (batch 5) AND `frequentHookSkeletonsLast3` (batches 3–5 each
   * see ≤1 use), so without this set it returns again at batch 6).
   *
   * Computed from the same first-class persisted `hookSkeletonId`
   * field as the tiers above; legacy entries silently abstain.
   * Empty for cold-start / single-batch history.
   */
  hookSkeletonsAtSessionCap?: ReadonlySet<string>;
  /**
   * Phase 3D BUG B — exact-hook string dedup (the legacy
   * `9:14pm. still here.` repeat-shipping failure mode that the
   * skeleton-id cap doesn't catch when an entry has no
   * `skeletonId` tag, AND a belt-and-braces guard for entries that
   * DO have one but get re-emitted by a different code path). Holds
   * normalized hook strings (`normalizeHookForDedup` — lowercase +
   * trim + collapse whitespace + strip trailing `.,!?;:`) harvested
   * from the FULL visible cache history (every batch in
   * `allBatchesForSessionCap`). Used by `selectionPenalty` to apply
   * a -1000 demotion when the candidate's normalized hook is in this
   * set — effectively a hard reject when a fresh alternative exists,
   * but the soft selector still picks the highest-scored candidate
   * from a fully-poisoned pool (starvation fallback — every member
   * of the pool gets the same -1000, so the relative ordering on the
   * remaining axes is preserved).
   *
   * Empty for cold-start. Optional + ReadonlySet to mirror the
   * other fresh-axis sets.
   */
  recentHookStrings?: ReadonlySet<string>;
  /**
   * Phase 6 (BIG PREMISE LAYER) — cross-batch premise-style demotion.
   * Holds `bigPremiseStyle` ids drawn from the last-3 batches' cache
   * envelopes (any entry with a non-undefined `bigPremiseStyle` field
   * — the source-of-truth populated by `assembleCandidate` and
   * persisted via `toCacheEntries`). Used by `selectionPenalty` to
   * apply a `-2` cross-batch demotion when a candidate's
   * `meta.bigPremiseStyle` is in this set.
   *
   * Sized SMALLER than the skeleton tiers (-3 / -8) intentionally —
   * each premise entry is a UNIQUE complete-hook string (no
   * template-noun-swap risk), so cross-batch repetition is far less
   * obnoxious than skeleton repetition. The within-batch dup penalty
   * (handled inline in `selectionPenalty` by counting how many
   * `batchSoFar` entries already carry the same `bigPremiseStyle`)
   * is `-3` per duplicate — sized LARGER than the cross-batch lever
   * because three premises of the same style in ONE batch is the
   * primary failure mode the spec calls out.
   *
   * Empty / undefined for cold-start (no prior cache history) and
   * for entries that didn't ship a premise (legacy template entries
   * without `bigPremise: true`). Selector treats absent as "no
   * contribution" — same discipline as the legacy axis sets above.
   */
  recentBigPremiseStyles?: ReadonlySet<BigPremiseStyle>;
  /**
   * Phase 6 EXPANSION (PREMISE STYLE ENGINE) — cross-batch fine-grained
   * 50-id demotion set. Holds `premiseStyleId` values drawn from the
   * last-3 batches' cache envelopes (any entry with a non-undefined
   * `premiseStyleId` field — the source-of-truth populated by
   * `assembleCandidate` and persisted via `toCacheEntries`). Used by
   * `selectionPenalty` to apply a `-2` cross-batch demotion when a
   * candidate's `meta.premiseStyleId` is in this set, parallel to
   * the bucket-level `recentBigPremiseStyles` lever above.
   *
   * Sized SMALLER than the within-batch -3-per-dup lever
   * intentionally — within-batch dup is the primary failure mode the
   * spec calls out ("no same PremiseStyle twice in one batch") so
   * the within-batch lever is sized to overwhelm any plausible
   * scoring spread; cross-batch repetition on a 50-id pool is a
   * weaker signal (the next batch is still likely to land on a
   * fresh id by random walk).
   *
   * Empty / undefined for cold-start (no prior cache history) and
   * for entries that didn't ship a Phase 6 EXPANSION premise (the
   * original 29 hand-written premise entries + legacy template
   * entries). Selector treats absent as "no contribution" — same
   * discipline as the bucket-level set above.
   */
  recentPremiseStyleIds?: ReadonlySet<PremiseStyleId>;
  /**
   * Phase 6D (PREMISE EXECUTION EXPANSION) — cross-batch fine-grained
   * execution-id demotion set. Holds `executionId` values drawn from
   * the last-3 batches' cache envelopes (any entry with a non-empty
   * `executionId` field — the source-of-truth populated by
   * `assembleCandidate` and persisted via `toCacheEntries`). Used by
   * `selectionPenalty` to apply a `-2` cross-batch demotion when a
   * candidate's `meta.executionId` is in this set, AND a +2 fresh-
   * style boost when it is NOT in the set AND the set is non-empty
   * (first-batch cold-start abstains so brand-new accounts don't
   * inflate every premise pick by +2 with no novelty signal).
   *
   * Stacks with the bucket-level `recentBigPremiseStyles` and the
   * style-level `recentPremiseStyleIds` levers above — all three
   * axes (bucket / style / execution) score independently so a
   * candidate that's fresh on bucket + style + execution gets the
   * full novelty stack, while a same-execution recent repeat eats
   * -2 on top of any bucket / style demotions.
   *
   * Empty / undefined for cold-start (no prior cache history) and
   * for entries that didn't ship a Phase 6D execution-tagged premise
   * (legacy template entries + the original 29 hand-written premise
   * entries + Llama / Claude fallback wraps). Selector treats absent
   * as "no contribution" — same discipline as the bucket / style
   * sets above.
   */
  recentExecutionIds?: ReadonlySet<string>;
};

/** Empty context — pass to `scoreNovelty` when no prior batch info. */
export const EMPTY_NOVELTY_CONTEXT: NoveltyContext = {};

function metaTopicLane(m: CandidateMeta): TopicLane | undefined {
  return m.topicLane;
}

function metaVisualAction(m: CandidateMeta): VisualActionPattern | undefined {
  return m.visualActionPattern;
}

/**
 * Resolve the candidate's hookOpener — prefer the meta tag (set by
 * the assembler / rewriter), fall back to the prefix lookup so
 * Claude/Llama fallback candidates (which don't set the tag) still
 * participate in opener-novelty scoring.
 */
function metaHookOpener(c: {
  idea: Idea;
  meta: CandidateMeta;
}): HookOpener | undefined {
  // `lookupHookOpener` returns `HookOpener | null` (no match → null);
  // coalesce to undefined so the return type matches the optional
  // field on NoveltyContext / CandidateMeta consumers.
  return c.meta.hookOpener ?? lookupHookOpener(c.idea.hook) ?? undefined;
}

function metaScriptType(m: CandidateMeta): ScriptType | undefined {
  return m.scriptType;
}

function metaIdeaCoreType(m: CandidateMeta): IdeaCoreType | undefined {
  return m.ideaCoreType;
}

function metaIdeaCoreFamily(m: CandidateMeta): IdeaCoreFamily | undefined {
  return m.ideaCoreFamily;
}

function metaArchetype(m: CandidateMeta): Archetype | undefined {
  return m.archetype;
}

function metaArchetypeFamily(m: CandidateMeta): ArchetypeFamily | undefined {
  return m.archetypeFamily;
}

function metaSceneObjectTag(m: CandidateMeta): SceneObjectTag | undefined {
  return m.sceneObjectTag;
}

function metaHookLanguageStyle(
  m: CandidateMeta,
): HookLanguageStyle | undefined {
  return m.hookLanguageStyle;
}

function metaVoiceProfile(m: CandidateMeta): VoiceProfile | undefined {
  return m.voiceProfile;
}

function metaSceneEnvCluster(m: CandidateMeta): SceneEnvCluster | undefined {
  return m.sceneEnvCluster;
}

/**
 * Novelty score: 0-8 across hookStyle / scenario / structure /
 * visualAction / topic / hookOpener / setting / scriptType (each
 * 0/1, fresh on BOTH already-picked batch AND recent context),
 * PLUS an additional +3 cross-batch "rotate the catalog" boost
 * when `scriptType` is in `ctx.unusedScriptTypesLast3`. Maximum
 * return value is 11 (fresh on every axis + catalog-cold
 * scriptType). The +3 is the spec's primary lever for breaking
 * the "same mental loop" failure mode — ordinary per-axis fresh
 * signals are weak enough that the qualityScore tie-break can
 * easily pick three same-shape narratives.
 *
 * Caller is responsible for the `qualityScore >= 8` gate; this
 * function does not enforce it.
 */
export function scoreNovelty(
  c: { idea: Idea; meta: CandidateMeta },
  batchSoFar: ReadonlyArray<{ idea: Idea; meta: CandidateMeta }>,
  ctx: NoveltyContext = EMPTY_NOVELTY_CONTEXT,
): number {
  const styles = new Set<string>();
  const families = new Set<string>();
  const structures = new Set<string>();
  const visuals = new Set<VisualActionPattern>();
  const topics = new Set<TopicLane>();
  const openers = new Set<HookOpener>();
  const settings = new Set<Setting>();
  const archetypes = new Set<Archetype>();
  const sceneTags = new Set<SceneObjectTag>();
  const langStyles = new Set<HookLanguageStyle>();
  const voices = new Set<VoiceProfile>();
  // Phase 1 — within-batch sets for the new IdeaCoreType axis (replaces
  // the prior `scripts: Set<ScriptType>` set which is now inert).
  const coreFamilies = new Set<IdeaCoreFamily>();
  const coreTypes = new Set<IdeaCoreType>();
  for (const b of batchSoFar) {
    styles.add(b.idea.hookStyle);
    if (b.meta.scenarioFamily) families.add(b.meta.scenarioFamily);
    structures.add(b.idea.structure);
    const v = metaVisualAction(b.meta);
    if (v) visuals.add(v);
    const t = metaTopicLane(b.meta);
    if (t) topics.add(t);
    const op = metaHookOpener(b);
    if (op) openers.add(op);
    settings.add(b.idea.setting as Setting);
    const arc = metaArchetype(b.meta);
    if (arc) archetypes.add(arc);
    const sot = metaSceneObjectTag(b.meta);
    if (sot) sceneTags.add(sot);
    const hls = metaHookLanguageStyle(b.meta);
    if (hls) langStyles.add(hls);
    const vp = metaVoiceProfile(b.meta);
    if (vp) voices.add(vp);
    const ict = metaIdeaCoreType(b.meta);
    if (ict) coreTypes.add(ict);
    const icf = metaIdeaCoreFamily(b.meta);
    if (icf) coreFamilies.add(icf);
  }

  // A. Hook phrase novelty — fresh hookStyle on BOTH axes.
  const hookFresh =
    !styles.has(c.idea.hookStyle) &&
    !(ctx.recentStyles?.has(c.idea.hookStyle) ?? false);
  // B. Scenario novelty — fresh scenarioFamily on BOTH axes.
  const fam = c.meta.scenarioFamily;
  const scenFresh =
    !!fam &&
    !families.has(fam) &&
    !(ctx.recentFamilies?.has(fam) ?? false);
  // C. Structure novelty — within batch only ("underused" interpreted
  //    as not yet picked in this batch; cross-batch structure history
  //    is not tracked because we only persist hook + family on cache).
  const structFresh = !structures.has(c.idea.structure);
  // D. Visual action novelty — fresh visualActionPattern on BOTH axes.
  const va = metaVisualAction(c.meta);
  const vaFresh =
    !!va &&
    !visuals.has(va) &&
    !(ctx.recentVisualActions?.has(va) ?? false);
  // E. Topic novelty — fresh topicLane on BOTH axes.
  const tl = metaTopicLane(c.meta);
  const tlFresh =
    !!tl &&
    !topics.has(tl) &&
    !(ctx.recentTopics?.has(tl) ?? false);
  // F. Hook opener novelty — fresh on BOTH axes. This is the big
  //    perceptual lever: hookStyle is an internal taxonomy but
  //    hookOpener is what the viewer actually hears (the first
  //    2-3 words). Worth as much as scenario novelty.
  const op = metaHookOpener(c);
  const opFresh =
    !!op &&
    !openers.has(op) &&
    !(ctx.recentHookOpeners?.has(op) ?? false);
  // G. Setting novelty — fresh physical location on BOTH axes.
  //    Three "in the kitchen" picks read as one video filmed
  //    three ways even when family/topic differ.
  const st = c.idea.setting as Setting;
  const stFresh =
    !settings.has(st) && !(ctx.recentSettings?.has(st) ?? false);
  // H. IdeaCoreFamily / IdeaCoreType novelty (Phase 1) — REPLACES the
  //    prior scriptType fresh dim. `coreFamilyFresh` is the spec's
  //    headline lever: prevents 3 ideas from reading as the same
  //    narrative family (failure_contradiction × 3, etc) even when
  //    every other axis rotates. `coreTypeFresh` is the finer dim
  //    that prevents 3 distinct types in the same family from all
  //    being `planned_vs_did` etc — sized at 1 (parallel to family)
  //    so a fresh-on-both-dims pick gets the full +2 nudge.
  const icf = metaIdeaCoreFamily(c.meta);
  const coreFamilyFresh =
    !!icf &&
    !coreFamilies.has(icf) &&
    !(ctx.recentIdeaCoreFamilies?.has(icf) ?? false);
  const ict = metaIdeaCoreType(c.meta);
  const coreTypeFresh =
    !!ict &&
    !coreTypes.has(ict) &&
    !(ctx.recentIdeaCoreTypes?.has(ict) ?? false);

  // I. Archetype novelty — fresh archetype on BOTH axes (within batch
  //    + immediate-prior batch). IDEA ARCHETYPE spec axis: prevents
  //    two `ill_do_it_later` picks landing in the same batch even
  //    when scenarioFamily / scriptType / etc all rotate. Binary
  //    fresh dim only — the +3 catalog-rotate boost rides on the
  //    scriptType axis since archetype is 1:1 derived from scriptType
  //    for our 37 active values (a fresh scriptType is always a
  //    fresh archetype, so a separate +3 archetype boost would
  //    double-count the same lever).
  const arc = metaArchetype(c.meta);
  const arcFresh =
    !!arc &&
    !archetypes.has(arc) &&
    !(ctx.recentArchetypes?.has(arc) ?? false);
  // J. SceneObjectTag novelty — fresh tag on BOTH axes. SCENE-OBJECT
  //    TAG spec axis: prevents two coffee / two unread_messages picks
  //    in one batch. The +3 catalog-rotate boost on this axis IS its
  //    own lever (decoupled from scriptType), since tag↔scriptType
  //    is many-to-many across the 25 family / 53 tag space.
  const sot = metaSceneObjectTag(c.meta);
  const sotFresh =
    !!sot &&
    !sceneTags.has(sot) &&
    !(ctx.recentSceneObjectTags?.has(sot) ?? false);
  // K. HookLanguageStyle novelty — HOOK STYLE spec axis. Fresh on
  //    BOTH within-batch and immediate-prior-batch. The new axis is
  //    primary for hook diversity; we treat it as binary fresh dim
  //    (parallel to opFresh) so the soft selector nudges toward 3
  //    distinct language modes per batch (the HARD reject in
  //    batchGuardsPass only blocks the all-3-identical worst case).
  const hls = metaHookLanguageStyle(c.meta);
  const hlsFresh =
    !!hls &&
    !langStyles.has(hls) &&
    !(ctx.recentHookLanguageStyles?.has(hls) ?? false);
  // K2. VoiceProfile novelty — VOICE PROFILES spec axis. Fresh on
  //     BOTH within-batch and immediate-prior-batch. Binary fresh
  //     dim only (no per-axis +X boost beyond the unused-in-last-3
  //     boost below). Sized parallel to hlsFresh — the soft selector
  //     nudges toward 2-3 distinct voices per batch; the HARD reject
  //     in `batchGuardsPass` only blocks the all-3-identical case
  //     (and even that is bypassed when calibration strongPreference
  //     is set, per the spec's "user explicitly picked it" exception).
  const vp = metaVoiceProfile(c.meta);
  const vpFresh =
    !!vp &&
    !voices.has(vp) &&
    !(ctx.recentVoiceProfiles?.has(vp) ?? false);

  // L. Unused-IdeaCoreFamily-in-last-3-batches "rotate the catalog"
  //    boost (Phase 1, REPLACES the prior unused-scriptType +3 boost).
  //    Large +3 when this candidate's IdeaCoreFamily has not appeared
  //    in any of the last 3 batches. The spec's headline lever for
  //    breaking the "I planned X → I failed" loop: makes family
  //    rotation a hard, score-driven force at pick time. Stacks with
  //    the per-axis fresh signals so a fresh-on-every-axis pick of a
  //    catalog-cold family gets up to +12 + 3 + 3 + 2 = +20 over a
  //    clone pick of yesterday's dominant family.
  const unusedFamilyBoost =
    icf && (ctx.unusedIdeaCoreFamiliesLast3?.has(icf) ?? false) ? 3 : 0;
  // M. Unused-tag boost — parallel +3 lever on the scene-object axis.
  //    A catalog-cold sceneObjectTag (no appearance in the last 3
  //    batches) gets the same +3 nudge. Stacks with the scriptType
  //    boost so a pick that's fresh-cold on BOTH axes can score
  //    up to +11 + 6 + 2 = +19 over a clone.
  const unusedTagBoost =
    sot && (ctx.unusedSceneObjectTagsLast3?.has(sot) ?? false) ? 3 : 0;
  // N. Unused-language-style boost — parallel +2 lever on the new
  //    HookLanguageStyle axis. Sized smaller (+2 not +3) because the
  //    axis is brand-new with no historical signal yet — we don't
  //    want it to outweigh the well-evidenced scriptType / scene-
  //    object levers when forced to choose.
  const unusedLangBoost =
    hls && (ctx.unusedHookLanguageStylesLast3?.has(hls) ?? false) ? 2 : 0;
  // O. Unused-voice boost — parallel +1 lever on the new VoiceProfile
  //    axis. Sized smallest of the three "unused-in-last-3" boosts
  //    because the voice pool is only 8 values and the allowed-set
  //    is typically 3-4, so an unused voice is statistically the
  //    most common kind of "fresh" — overweighting it would let it
  //    fight the well-evidenced scriptType / scene-object levers
  //    when those have stronger signal.
  const unusedVoiceBoost =
    vp && (ctx.unusedVoiceProfilesLast3?.has(vp) ?? false) ? 1 : 0;

  return (
    (hookFresh ? 1 : 0) +
    (scenFresh ? 1 : 0) +
    (structFresh ? 1 : 0) +
    (vaFresh ? 1 : 0) +
    (tlFresh ? 1 : 0) +
    (opFresh ? 1 : 0) +
    (stFresh ? 1 : 0) +
    (coreFamilyFresh ? 1 : 0) +
    (coreTypeFresh ? 1 : 0) +
    (arcFresh ? 1 : 0) +
    (sotFresh ? 1 : 0) +
    (hlsFresh ? 1 : 0) +
    (vpFresh ? 1 : 0) +
    unusedFamilyBoost +
    unusedTagBoost +
    unusedLangBoost +
    unusedVoiceBoost
  );
}


/**
 * Negative penalty applied to a candidate at pick time. The
 * already-picked batch contributes within-batch demotions; the
 * optional `ctx` adds cross-batch tiered demotions on the scriptType
 * axis. Penalties saturate per-axis (one match is enough — multiple
 * picks sharing the same axis don't compound).
 *
 * Within-batch (vs `batchSoFar`):
 *   same hookStyle              → -2
 *   same scenarioFamily         → -3
 *   same structure              → -1
 *   same topicLane              → -2
 *   same visualActionPattern    → -2
 *   same hookOpener             → -2  (opener feels like the same hook)
 *   same setting                → -2  (same physical location)
 *   same scriptType             → -2  (same narrative shape)
 *   same archetype              → -4  (same idea archetype — strongest
 *                                       within-batch lever; the headline
 *                                       IDEA ARCHETYPE spec demotion)
 *   same archetypeFamily        → -2  (same family of archetype, even
 *                                       if the specific archetype differs)
 *   same sceneEnvCluster        → -1  (same env cluster — light demotion;
 *                                       cluster is broad so a single
 *                                       collision shouldn't be punitive)
 *
 * Cross-batch (vs `ctx`):
 *   scriptType ∈ recentScriptTypes              → -3  (immediate-prior batch)
 *   scriptType ∈ frequentScriptTypesLast3       → -2  (≥2 of last 3; stacks)
 *   sceneObjectTag ∈ recentSceneObjectTags      → -3  (immediate-prior batch)
 *   sceneObjectTag ∈ frequentSceneObjectTagsLast3 → -2  (≥2 of last 3; stacks)
 *
 * Returns 0 when batch is empty AND ctx contributes no penalty.
 */
export function selectionPenalty(
  c: { idea: Idea; meta: CandidateMeta },
  batchSoFar: ReadonlyArray<{ idea: Idea; meta: CandidateMeta }>,
  ctx: NoveltyContext = EMPTY_NOVELTY_CONTEXT,
): number {
  let p = 0;
  // Phase 3D BUG B — exact-hook string hard reject (effective).
  // -1000 demotion when this candidate's normalized hook is in
  // `ctx.recentHookStrings` (cross-batch — built from the FULL
  // visible cache history) OR matches the normalized hook of any
  // pick already in `batchSoFar` (within-batch). The selector still
  // picks the highest-scored member of a fully-poisoned pool (every
  // member then carries the same -1000 floor and relative ordering
  // on the remaining axes is preserved — that's the spec's
  // pool-starvation fallback). Normalization MUST stay symmetric
  // with `buildNoveltyContext`'s build side — both call
  // `normalizeHookForDedup`. We harvest cross-batch and within-batch
  // separately so this works on cold-start (no ctx) AND when the
  // selector hands us a partially-built batch.
  if (ctx.recentHookStrings || batchSoFar.length > 0) {
    const candNorm = normalizeHookForDedup(c.idea.hook);
    if (ctx.recentHookStrings?.has(candNorm)) {
      p -= 1000;
    } else if (batchSoFar.length > 0) {
      for (const b of batchSoFar) {
        if (normalizeHookForDedup(b.idea.hook) === candNorm) {
          p -= 1000;
          break;
        }
      }
    }
  }
  // Within-batch demotion: build per-axis sets from batchSoFar and
  // saturate per-axis (one match is enough). Skipping this whole
  // block when batchSoFar is empty preserves the previous
  // early-return-zero behavior for that path.
  if (batchSoFar.length > 0) {
    const styles = new Set<string>();
    const families = new Set<string>();
    const structures = new Set<string>();
    const visuals = new Set<VisualActionPattern>();
    const topics = new Set<TopicLane>();
    const openers = new Set<HookOpener>();
    const settings = new Set<Setting>();
    const archetypes = new Set<Archetype>();
    const archetypeFamilies = new Set<ArchetypeFamily>();
    const sceneClusters = new Set<SceneEnvCluster>();
    const langStyles = new Set<HookLanguageStyle>();
    // Phase 1 — within-batch sets for the IdeaCoreType axis. Drive
    // the -2 same-family / -3 same-type penalties below; replace
    // the prior `scripts: Set<ScriptType>` set + -2 same-scriptType
    // penalty (now inert).
    const coreFamilies = new Set<IdeaCoreFamily>();
    const coreTypes = new Set<IdeaCoreType>();
    // VOICE PROFILES spec — within-batch voice set, mirrors the
    // hookLanguageStyle pattern. Populated from `metaVoiceProfile`
    // (pattern_variation always sets; Llama / Claude wraps may
    // omit, in which case the value is silently undefined and
    // contributes nothing to the demotion).
    const voices = new Set<VoiceProfile>();
    // Phase 5 (PATTERN MAPPING LAYER) — within-batch VideoPattern set.
    // Drives the -3 dup penalty below. Sized at -3 (parallel to the
    // within-batch HookIntent dup lever) because videoPattern is the
    // controller axis above filming style — a 3-of-same batch reads
    // as one filming idea repeated, even when scenarios differ.
    // Skipped silently for fallback wraps + pre-Phase-5 cache reads
    // whose meta omits the field — same discipline as voiceProfile.
    const videoPatterns = new Set<VideoPattern>();
    for (const b of batchSoFar) {
      styles.add(b.idea.hookStyle);
      if (b.meta.scenarioFamily) families.add(b.meta.scenarioFamily);
      structures.add(b.idea.structure);
      const v = metaVisualAction(b.meta);
      if (v) visuals.add(v);
      const t = metaTopicLane(b.meta);
      if (t) topics.add(t);
      const op = metaHookOpener(b);
      if (op) openers.add(op);
      settings.add(b.idea.setting as Setting);
      const arc = metaArchetype(b.meta);
      if (arc) archetypes.add(arc);
      const arcFam = metaArchetypeFamily(b.meta);
      if (arcFam) archetypeFamilies.add(arcFam);
      const sec = metaSceneEnvCluster(b.meta);
      if (sec) sceneClusters.add(sec);
      const hls = metaHookLanguageStyle(b.meta);
      if (hls) langStyles.add(hls);
      const vp = metaVoiceProfile(b.meta);
      if (vp) voices.add(vp);
      const ict = metaIdeaCoreType(b.meta);
      if (ict) coreTypes.add(ict);
      const icf = metaIdeaCoreFamily(b.meta);
      if (icf) coreFamilies.add(icf);
      // Phase 5 — collect VideoPattern from each prior pick. Skipped
      // silently when meta.videoPattern is absent (fallback wraps,
      // pre-Phase-5 cache reads).
      const bvp2 = metaVideoPattern(b.meta);
      if (bvp2) videoPatterns.add(bvp2);
    }
    if (styles.has(c.idea.hookStyle)) p -= 2;
    if (c.meta.scenarioFamily && families.has(c.meta.scenarioFamily)) p -= 3;
    if (structures.has(c.idea.structure)) p -= 1;
    const cv = metaVisualAction(c.meta);
    if (cv && visuals.has(cv)) p -= 2;
    const ct = metaTopicLane(c.meta);
    if (ct && topics.has(ct)) p -= 2;
    const cop = metaHookOpener(c);
    if (cop && openers.has(cop)) p -= 2;
    const cst = c.idea.setting as Setting;
    if (settings.has(cst)) p -= 2;
    // Phase 1 — IdeaCoreType / IdeaCoreFamily within-batch demotions.
    // -3 for same exact type (the strongest within-batch lever after
    // archetype, since exact-type collisions are the
    // "I planned X → I failed × 3" failure mode the spec calls out).
    // -2 for same family (a softer nudge that fires even when the
    // exact types differ — e.g. two different failure_contradiction
    // types in one batch). The prior `-2 same scriptType` line is
    // REMOVED — scriptType is INERT in Phase 1.
    const cict = metaIdeaCoreType(c.meta);
    if (cict && coreTypes.has(cict)) p -= 3;
    const cicf = metaIdeaCoreFamily(c.meta);
    if (cicf && coreFamilies.has(cicf)) p -= 2;
    // IDEA ARCHETYPE spec — within-batch demotions. -4 for same
    // archetype (the strongest within-batch lever, sized to outrank
    // a typical fresh-on-3-axes novelty bonus); -2 for same family
    // (so a batch with two distinct archetypes-in-same-family is
    // softer than two-same-archetype but still discouraged).
    const carc = metaArchetype(c.meta);
    if (carc && archetypes.has(carc)) p -= 4;
    const carcFam = metaArchetypeFamily(c.meta);
    if (carcFam && archetypeFamilies.has(carcFam)) p -= 2;
    // SCENE-OBJECT TAG spec — within-batch cluster demotion. Lighter
    // (-1) than family because cluster is a broader bucket — five
    // clusters cover all 53 tags so collisions are statistically
    // common, but two-from-same-cluster still feels like one scene
    // shot twice. The HARD per-batch guard in batchGuardsPass
    // (max 1 cluster) is what actually prevents the worst case;
    // this nudges the soft selector toward the same outcome.
    const csec = metaSceneEnvCluster(c.meta);
    if (csec && sceneClusters.has(csec)) p -= 1;
    // HOOK STYLE spec — within-batch language-mode demotion. -2 for
    // a collision (one already-picked candidate has same hookLanguageStyle).
    // Soft nudge toward 3 distinct modes; the HARD reject in
    // batchGuardsPass blocks only the all-3-identical worst case so
    // a 2-of-same batch is still possible and gets this -2 to
    // discourage the third clone.
    const chls = metaHookLanguageStyle(c.meta);
    if (chls && langStyles.has(chls)) p -= 2;
    // VOICE PROFILES spec — within-batch voice demotion. -2 for a
    // collision (one already-picked candidate has same voiceProfile).
    // Soft nudge toward 2-3 distinct voices per batch; the HARD
    // reject in `batchGuardsPass` blocks only the all-3-identical
    // case (and bypasses even that when calibration strongPreference
    // is set). This penalty STILL fires under strongPreference —
    // intentional: the soft selector should still prefer rotation
    // when shippable, even if the hard guard tolerates 3-of-same.
    // Voices not in batchSoFar (pattern_variation always sets, but
    // Llama / Claude wraps may omit) silently skip — the meta read
    // returns undefined which `voices.has(undefined as any)` would
    // false-match, so we guard explicitly.
    const cvp = metaVoiceProfile(c.meta);
    if (cvp && voices.has(cvp)) p -= 2;

    // Phase 5 (PATTERN MAPPING LAYER) — within-batch VideoPattern dup
    // demotion. -3 when this candidate's videoPattern is already in
    // batchSoFar (parallel to the within-batch HookIntent dup -3
    // lever). Combined with the HARD batch guard `h2` (max 2 share
    // videoPattern, in `batchGuardsPass`), this nudges the soft
    // selector toward 3 distinct patterns even when the guard
    // tolerates 2-of-same. Skipped silently when the candidate has
    // no videoPattern — same discipline as voiceProfile.
    const cvp2 = metaVideoPattern(c.meta);
    if (cvp2 && videoPatterns.has(cvp2)) p -= 3;

    // Phase 3 HOOK TEMPLATE TUNING — within-batch hookSkeletonId dup
    // demotion. -3 when this candidate's `meta.hookSkeletonId` is
    // already in batchSoFar (parallel to the videoPattern dup lever
    // above). Combined with the cross-batch tiered demotion below
    // (-3 immediate-prior, -2 frequent-last-3 stack), a thrice-shipped
    // skeleton accumulates -8 before tied scoring axes — comfortably
    // below the typical 2-3pt spread between alternative entries of
    // the same intent / language style. Skipped silently when the
    // candidate has no hookSkeletonId (entries with genuinely
    // scenario-shaped phrasing — same discipline as voiceProfile).
    // Computed once outside the loop so the within-batch lookup is
    // O(batchSoFar) per candidate rather than O(batchSoFar²).
    const hookSkeletons = new Set<string>();
    for (const b of batchSoFar) {
      const hsid = metaHookSkeletonId(b.meta);
      if (hsid) hookSkeletons.add(hsid);
    }
    const cHsid = metaHookSkeletonId(c.meta);
    if (cHsid && hookSkeletons.has(cHsid)) p -= 3;

    // Phase 6 (BIG PREMISE LAYER) — within-batch premise-style dup
    // demotion. Originally -3 PER DUPLICATE on the BUCKET-level
    // `bigPremiseStyle` axis (which contains multiple distinct
    // PremiseStyles per bucket — e.g. the `expectation_collapse`
    // bucket holds `burnout_betrayal`, `self_destruction_speedrun`,
    // `whiplash_wisdom`, etc.).
    //
    // Phase 6D Path F: bucket-level -3 was over-penalizing distinct
    // PremiseStyles that happen to share a parent bucket — two
    // legitimately-different premise hooks (e.g. burnout_betrayal +
    // whiplash_wisdom, both in `expectation_collapse`) ate -3 of
    // selection-layer pressure each, often pushing slot-2 / slot-3
    // below LEG hooks even with the +7 selection-layer boost
    // (Mechanism A — see /tmp/qa6d_pathCDE7.json batches 6/7 where
    // greedy raw shipped 6 LEG despite Path-D rescues being
    // non-binding). Reduced to -1 PER DUPLICATE so:
    //   - Cross-bucket premise pair          : 0  (no penalty, was 0)
    //   - Same-bucket DIFFERENT premise id  : -1 (was -3) — main fix
    //   - Same-bucket SAME premise id        : -1 + -8 = -9 (was -11)
    //                                          — still strictly
    //                                          dominated by the
    //                                          fine-grained id
    //                                          penalty below + the
    //                                          HARD within-batch
    //                                          (premiseStyleId,
    //                                          executionId) tuple
    //                                          guard from 6C/6D-T004
    //                                          which makes a
    //                                          same-style second
    //                                          pick STRUCTURALLY
    //                                          impossible regardless
    //                                          of soft scoring.
    // Same-style protection is fully preserved: -8 fine-grained id
    // penalty (below) AND the HARD `batchGuardsPass` reject (6C/6D)
    // both still apply unchanged. Goal: allow multiple distinct
    // PremiseStyles to win within the same batch without LEG hooks
    // outranking them on within-batch dynamics.
    const premiseStyleCounts = new Map<BigPremiseStyle, number>();
    for (const b of batchSoFar) {
      const ps = metaBigPremiseStyle(b.meta);
      if (ps) premiseStyleCounts.set(ps, (premiseStyleCounts.get(ps) ?? 0) + 1);
    }
    const cPremise = metaBigPremiseStyle(c.meta);
    if (cPremise) {
      const dupCount = premiseStyleCounts.get(cPremise) ?? 0;
      if (dupCount > 0) p -= 1 * dupCount;
    }

    // Phase 6 EXPANSION (PREMISE STYLE ENGINE) — within-batch
    // fine-grained 50-id dup demotion. Sized at -8 PER DUPLICATE
    // (LARGER than the bucket-level -3 lever above) to honor the
    // spec hard rule "no same PremiseStyle twice in one batch": the
    // soft -3 alone wasn't enough to reliably block a same-id second
    // pick when its other axes outscored a fresh-id alternative by
    // 4+ points (and this lever STACKS with the bucket-level -3, so
    // a same-id pick eats -11 total on the second slot). Skipped
    // silently for legacy entries without a fine-grained id (the
    // original 29 hand-written premise entries + Llama / Claude
    // fallback wraps + every legacy template) — same fail-quiet
    // discipline as voiceProfile / videoPattern / hookSkeletonId.
    const premiseIdCounts = new Map<PremiseStyleId, number>();
    for (const b of batchSoFar) {
      const pid = metaPremiseStyleId(b.meta);
      if (pid) premiseIdCounts.set(pid, (premiseIdCounts.get(pid) ?? 0) + 1);
    }
    const cPremiseId = metaPremiseStyleId(c.meta);
    if (cPremiseId) {
      const dupCount = premiseIdCounts.get(cPremiseId) ?? 0;
      if (dupCount > 0) p -= 8 * dupCount;
    }

    // HOOK INTENT spec (Phase 4) — within-batch intent demotion +
    // HARD all-3-same guard. HookIntent is the controller axis
    // ABOVE HookLanguageStyle, so the per-dup soft penalty is sized
    // larger (-3) than the language-style / voice / opener -2 lever
    // and just under the -4 archetype lever — enough to overcome
    // the typical 1-2pt hookIntentScore spread between the strongest
    // and weakest intent's catalog entries (compulsion phrasings
    // tend to score 2-3pts below scroll_stop / relatable on the
    // intent-specific scorer, so a -2 dup wasn't enough to push the
    // 3rd pick onto a fresh intent — QA showed 7/1/7 distribution).
    // The HARD guard at the bottom is sized to overwhelm any
    // plausible base total (max ~15 with the per-intent fold) so
    // the selector will ALWAYS prefer a shippable other-intent
    // candidate over a third clone, even when the third clone
    // scores higher on every other axis. The guard fires ONLY when
    // batchSoFar.length === 2 AND both prior picks share THIS
    // candidate's intent — for batch sizes of 1 or 2 only the soft
    // -3 fires (per the session plan "no intent guard for batches
    // of 1-2"). Intentless candidates (legacy cache reads / Llama
    // / Claude wraps) silently skip both branches — same discipline
    // as every other optional-axis penalty above. Counts (not just
    // set membership) are required here because the HARD branch
    // needs to know "how many of the same intent are already in
    // the batch", which a Set cannot answer.
    const intentCounts = new Map<HookIntent, number>();
    for (const b of batchSoFar) {
      const bi = metaHookIntent(b.meta);
      if (bi) intentCounts.set(bi, (intentCounts.get(bi) ?? 0) + 1);
    }
    const ci = metaHookIntent(c.meta);
    if (ci) {
      const dupCount = intentCounts.get(ci) ?? 0;
      if (dupCount > 0) p -= 3;
      // Symmetric FRESH-intent bonus — captures the spec's
      // "Prefer 1 of each" SOFT preference explicitly. Fires only
      // when batchSoFar already has at least 1 pick AND this
      // candidate's intent is NOT yet represented in the batch.
      // Sized at +5 to give an 8pt total swing (fresh +5 vs dup
      // -3) that's enough to overcome BOTH the typical 2-3pt gap
      // in baseline intentScore between intents (compulsion ~7
      // vs scroll_stop / relatable ~9-10) AND the typical 2pt
      // lower novelty bonus that compulsion candidates accrue
      // because their language-style + archetype pool is narrower
      // than scroll_stop / relatable. WITHOUT this swing the
      // selector ships 7/2/6 instead of the spec's intended
      // ~5/5/5; the trace showed compulsion losing pick 3 by a
      // single adj-point because its noveltyScore was 2pt below
      // relatable, and a +3 bonus only closed half the gap. The
      // value is calibrated empirically against the QA driver —
      // bumping further would over-rotate (intent becomes the
      // ONLY axis that matters), so +5 is the floor that meets
      // G2 (≥3 ships per intent across 5 batches) without
      // distorting the other rotation axes.
      if (batchSoFar.length > 0 && dupCount === 0) p += 5;
      if (batchSoFar.length === 2 && dupCount === 2) p -= 100;
    }
  }
  // Cross-batch tiered IdeaCoreFamily demotion (Phase 1, REPLACES the
  // prior scriptType cross-batch lever). The two tiers stack: a
  // family that's BOTH in the immediate-prior batch AND frequent
  // across the last 3 takes -3 + -2 = -5 in addition to any within-
  // batch hit. This is the cross-batch half of the spec's headline
  // "rotate the family" lever — pairs with the +3 unused-family
  // boost in `scoreNovelty` so a catalog-cold family gets a +6 swing
  // over yesterday's dominant family on a tied-quality candidate.
  const cicfCross = metaIdeaCoreFamily(c.meta);
  if (cicfCross) {
    if (ctx.recentIdeaCoreFamilies?.has(cicfCross) ?? false) p -= 3;
    if (ctx.frequentIdeaCoreFamiliesLast3?.has(cicfCross) ?? false) p -= 2;
  }
  // Cross-batch tiered sceneObjectTag demotion — parallel to the
  // scriptType lever. A tag that's both immediate-prior AND frequent
  // across last 3 batches takes -3 + -2 = -5. Independent of the
  // scriptType axis (a "fresh archetype on a stale tag" pick still
  // gets the tag penalty, which is the correct behavior — same
  // physical scene shot back-to-back is the perceptual problem the
  // spec calls out, regardless of internal narrative shape).
  const csotCross = metaSceneObjectTag(c.meta);
  if (csotCross) {
    if (ctx.recentSceneObjectTags?.has(csotCross) ?? false) p -= 3;
    if (ctx.frequentSceneObjectTagsLast3?.has(csotCross) ?? false) p -= 2;
  }
  // HOOK STYLE spec — cross-batch hookLanguageStyle demotion. -3
  // when this candidate's language mode appeared in the immediate-
  // prior batch. Single-tier (no frequent-last-3 stack) because the
  // axis is brand-new with no historical signal yet — start
  // conservative and let the +2 unused-language boost do most of
  // the rotation work.
  const chlsCross = metaHookLanguageStyle(c.meta);
  if (chlsCross) {
    if (ctx.recentHookLanguageStyles?.has(chlsCross) ?? false) p -= 3;
  }
  // VOICE PROFILES spec — cross-batch voice demotion. -2 when this
  // candidate's voice appeared in the immediate-prior batch. Single-
  // tier (no frequent-last-3 stack) and sized smaller than the
  // hookLanguageStyle cross-batch (-3) because the voice pool is
  // only 8 values and the allowed-set is typically 3-4 — over-
  // penalizing would push selection toward the rare un-allowed
  // voices that the calibration explicitly steers away from.
  // Stacks with the within-batch -2 on distinct sets (intentional
  // double-charge for a clone that ALSO repeats yesterday's voice).
  // Skips when the candidate has no voiceProfile (Llama / Claude
  // fallback wraps may omit) — same discipline as every other
  // optional-axis penalty above.
  const cvpCross = metaVoiceProfile(c.meta);
  if (cvpCross) {
    if (ctx.recentVoiceProfiles?.has(cvpCross) ?? false) p -= 2;
  }
  // TREND CONTEXT LAYER spec — cross-batch trend demotion. -2 when
  // this candidate's trendId appeared in the immediate-prior batch.
  // Single-tier ONLY (no frequent-last-3 stack and no unused-last-3
  // boost) because trends are an OPTIONAL overlay, not a forced
  // rotation axis: the ~30% gate already keeps emission low and the
  // catalog is intentionally small (~30 items) — over-penalizing
  // would push the curated set toward exhaustion. Sized at -2 to
  // mirror the voice-profile cross-batch lever (also -2, also
  // single-tier) — strong enough to break ties when an alternative
  // with a fresh trend exists, soft enough that a high-quality
  // pattern with a repeated trend can still win when nothing else
  // shippable carries a different one. Skips when the candidate has
  // no trendId — same discipline as voiceProfile and templateId,
  // and the right behavior since absence is the ~70%-by-design norm
  // (gate skip + soft-skip on failed validation both leave trendId
  // undefined). The penalty NEVER fires against an absent tag.
  const ctidCross = c.meta.trendId;
  if (ctidCross) {
    if (ctx.recentTrendIds?.has(ctidCross) ?? false) p -= 2;
  }
  // Phase 5 (PATTERN MAPPING LAYER) — cross-batch VideoPattern
  // demotion. -3 when this candidate's videoPattern appeared in the
  // immediate-prior batch. Single-tier (no frequent-last-3 stack)
  // because:
  //   - The within-pool recency pressure inside `pickVideoPattern`
  //     already gives the pool natural pattern spread BEFORE the
  //     selector sees it.
  //   - The within-batch -3 dup + the HARD batch guard `h2` already
  //     cap within-batch dup at 2 — the cross-batch lever just
  //     prevents yesterday's two-of-a-kind from showing up again.
  // Sized at -3 (parallel to the within-batch dup) so the soft
  // selector breaks ties toward fresh patterns when a shippable
  // alternative exists. Skipped when meta.videoPattern is absent —
  // same discipline as voiceProfile / trendId / archetype.
  const cvpCrossPattern = metaVideoPattern(c.meta);
  if (cvpCrossPattern) {
    if (ctx.recentVideoPatterns?.has(cvpCrossPattern) ?? false) p -= 3;
  }
  // Phase 3 HOOK TEMPLATE TUNING — cross-batch hookSkeletonId
  // demotion. TIERED (parallel to the ideaCoreFamily lever above):
  //   - -3 when this candidate's `meta.hookSkeletonId` appeared in
  //     the immediate-prior batch (`recentHookSkeletons`).
  //   - additional -2 stack when the same skeleton appeared in ≥2 of
  //     the last 3 batches (`frequentHookSkeletonsLast3`).
  // Rationale for the stack: a skeleton like `todays_update` re-
  // emerging from "fresh after a one-batch gap" is a softer offence
  // than one that's been on rotation for three sessions running, so
  // the second tier is the right shape for the "scenario-noun-swap
  // repetition" failure mode the spec calls out. Combined with the
  // within-batch -3 lever (above), a thrice-shipped skeleton accrues
  // -8 cross+within before tied scoring axes — comfortably below the
  // ~2-3pt spread between alternative entries of the same intent /
  // language style. Skipped silently when the candidate has no
  // hookSkeletonId — same discipline as voiceProfile / videoPattern
  // / trendId. Matches against an absent tag never fire (Set.has
  // narrows on the truthy-string guard above).
  const cHsidCross = metaHookSkeletonId(c.meta);
  if (cHsidCross) {
    if (ctx.recentHookSkeletons?.has(cHsidCross) ?? false) p -= 3;
    if (ctx.frequentHookSkeletonsLast3?.has(cHsidCross) ?? false) p -= 2;
    // Phase 3 HOOK TEMPLATE TUNING — session-wide hard-cap. -8 stack
    // when the candidate's skeleton has already shipped ≥2 times
    // anywhere in the visible cache history. Catches the every-
    // other-batch repeat pattern that escapes both last-3 tiers
    // (a skeleton at batches 2+4 shows zero in `recent` and only
    // one in any 3-batch window — so neither -3 nor -2 fires when
    // it tries to return at batch 6). Sized at -8 because some
    // formulaic skeletons (e.g. `manage_now_hostage`) outscore
    // the next compulsion-intent alternative by ~5pt on the
    // composite, so a -4 cap was too soft to actually displace
    // them. -8 reliably pushes them below any same-intent alt.
    if (ctx.hookSkeletonsAtSessionCap?.has(cHsidCross) ?? false) p -= 8;
  }
  // Phase 6 (BIG PREMISE LAYER) — cross-batch premise-style demotion.
  // -2 when this candidate's `meta.bigPremiseStyle` appeared anywhere
  // in the last-3-batches premise-style set (`recentBigPremiseStyles`,
  // populated by `buildNoveltyContext` from each batch's persisted
  // `bigPremiseStyle` field). Sized SMALLER than the skeleton tiers
  // (-3 / -8) intentionally — every premise entry is a UNIQUE
  // complete-hook string so there's no template-noun-swap repetition
  // risk; cross-batch repetition is far less obnoxious than skeleton
  // repetition. Combined with the within-batch -3-per-dup lever
  // above, the soft selector consistently rotates premise styles
  // across batches even when the strongest catalog entry happens to
  // share a style with a recent shipment. Skipped silently when the
  // candidate has no bigPremiseStyle (legacy template entries +
  // Llama / Claude fallback wraps — same discipline as voiceProfile
  // / hookSkeletonId / trendId).
  const cPremCross = metaBigPremiseStyle(c.meta);
  if (cPremCross) {
    if (ctx.recentBigPremiseStyles?.has(cPremCross) ?? false) p -= 2;
  }
  // Phase 6 EXPANSION (PREMISE STYLE ENGINE) — cross-batch fine-grained
  // 50-id demotion. -2 when this candidate's `meta.premiseStyleId`
  // appeared anywhere in the last-3-batches fine-grained set
  // (`recentPremiseStyleIds`, populated by `buildNoveltyContext` from
  // each batch's persisted `premiseStyleId` field). Sized parallel to
  // the bucket-level lever above and STACKS with it (a same-id same-
  // bucket recent repeat eats -4 total). Skipped silently when the
  // candidate has no fine-grained id — same discipline as voiceProfile
  // / hookSkeletonId / trendId.
  const cPremIdCross = metaPremiseStyleId(c.meta);
  if (cPremIdCross) {
    // PHASE X2 — PART 3 — bumped from -2 to -3 to satisfy spec
    // "heavily penalize repeated mechanism." A single-style repeat
    // on top of the bucket-level -2 above stacks to -5, comfortably
    // below the typical 3-4pt premise-vs-alt spread so a fresh
    // mechanism reliably wins selection across consecutive batches.
    // The symmetric +2 fresh-vs-recent boost below is unchanged so
    // the spread between repeat (-3) and fresh (+2) is now 5pt
    // (was 4pt) — closer to the "heavily" semantics the spec calls
    // for without overpowering the +3 PREMISE_PREFERENCE bonus.
    if (ctx.recentPremiseStyleIds?.has(cPremIdCross) ?? false) p -= 3;
    // Phase 6C (PREMISE-FIRST SELECTION) — symmetric +2 boost when this
    // candidate's `meta.premiseStyleId` is NOT in the last-3-batches
    // fine-grained set AND the set is non-empty (i.e. we have history
    // to compare against — first-batch cold-start abstains so a
    // brand-new account doesn't artificially inflate every premise
    // pick by +2 with no novelty signal). Sized to mirror the -2
    // demotion above so the lever is symmetric: returning to a
    // recently-used style costs -2, choosing a fresh-vs-recent style
    // gains +2, total spread of 4pt between repeat + fresh — enough
    // to dominate the typical 1-2pt composite spread without
    // overpowering the +3 PREMISE_PREFERENCE bonus or the -8 fine-
    // grained within-batch dup penalty. Silent-skip on empty history
    // keeps the cold-start path identical to pre-6C behavior.
    if (
      ctx.recentPremiseStyleIds !== undefined &&
      ctx.recentPremiseStyleIds.size > 0 &&
      !ctx.recentPremiseStyleIds.has(cPremIdCross)
    ) {
      p += 2;
    }
  }
  // Phase 6D (PREMISE EXECUTION EXPANSION) — cross-batch fine-grained
  // execution-id demotion. -2 when this candidate's `meta.executionId`
  // appeared anywhere in the last-3-batches execution-id set
  // (`recentExecutionIds`, populated by `buildNoveltyContext` from
  // each batch's persisted `executionId` field). Sized parallel to
  // the style-level lever above and STACKS with it (a same-execution
  // same-style recent repeat eats -4 total; same-execution same-style
  // same-bucket eats -6). Skipped silently when the candidate has no
  // execution id — same discipline as `premiseStyleId` /
  // `hookSkeletonId` / `trendId`.
  const cExecId = c.meta.executionId;
  if (cExecId) {
    if (ctx.recentExecutionIds?.has(cExecId) ?? false) p -= 2;
    // Phase 6D — symmetric +2 boost when this candidate's executionId
    // is NOT in the last-3-batches set AND the set is non-empty (i.e.
    // we have history to compare against — first-batch cold-start
    // abstains so a brand-new account doesn't artificially inflate
    // every execution-tagged premise pick by +2 with no novelty
    // signal). Mirrors the +2 fresh-style boost on `premiseStyleId`
    // above so the lever is symmetric: returning to a recently-used
    // execution costs -2, choosing a fresh-vs-recent execution gains
    // +2, total spread of 4pt on the execution axis. Silent-skip on
    // empty history keeps the cold-start path identical to pre-6D.
    if (
      ctx.recentExecutionIds !== undefined &&
      ctx.recentExecutionIds.size > 0 &&
      !ctx.recentExecutionIds.has(cExecId)
    ) {
      p += 2;
    }
  }
  // Phase 6C (PREMISE-FIRST SELECTION) — premise PREFERENCE bonus.
  // +3 selection-layer boost when this candidate was sourced from a
  // premise entry (`meta.usedBigPremise === true`, set in
  // `assembleCandidate` whenever the picker's winning entry carried
  // `bigPremise: true`). Sized to outweigh the typical 1-2pt
  // composite-score spread between premise + legacy alternatives so
  // the soft selector breaks ties toward premise output even when a
  // legacy template otherwise scores marginally higher on
  // hookImpact / personalFit. The bonus is UNCONDITIONAL — it
  // applies on slot 1 (no batchSoFar) AND inside multi-slot
  // contention — so it stacks coherently with both the within-batch
  // dup penalties (-3 bucket / -8 fine-grained) and the cross-batch
  // demotions (-2 bucket / -2 fine-grained) above:
  //   - Fresh premise on slot 1                : net +4 (preferred).
  //   - Premise reusing a recent style         : +4 -2 = +2 (still
  //                                              preferred over legacy 0).
  //   - Premise duplicating an in-batch style  : +4 -8 = -4 (correctly
  //                                              loses to fresh-style
  //                                              alternative — the dup
  //                                              guards still win).
  // Skipped silently for legacy template entries + Llama / Claude
  // fallback wraps whose meta omits `usedBigPremise` — same fail-
  // quiet discipline as voiceProfile / videoPattern / hookSkeletonId.
  // The +4 / -8 stacking math above is the spec PART 1 acceptance
  // gate "premise hooks are preferred BY DEFAULT, but legacy still
  // wins on superior quality" expressed at the scoring layer; the
  // hard within-batch HARD guard for fine-grained premiseStyleId
  // dups (T003) closes the residual same-id-second-slot edge case.
  // Phase 6D: bumped from +3 → +4 to overcome the Llama-generated
  // legacy-hook bypass (Llama output lacks `usedBigPremise=true`
  // so it never gets the boost; +4 vs Llama +0 widens the moat
  // without re-enabling artificial legacy suppression — fully
  // spec-compliant per the "do not artificially suppress further"
  // rule).
  //
  // Phase 6D Path C (post-Path-B+ tightening): bumped +4 → +7 once
  // Path B + B+ confirmed all 5 cross-batch freshness rescues are
  // now non-binding. The earlier +5 / +6 attempts saturated /
  // backfired BEFORE the 200-entry executions catalog landed and
  // BEFORE the hand-written entries carried premiseStyleId — the
  // candidate landscape today has dense premiseStyleId coverage,
  // so a wider boost no longer starves the picker on creators
  // whose calibration leaves few premise-styled candidates in the
  // pool. Empirically (Path C+D QA), +7 lifts mean premise-share
  // toward the 0.85 spec gate without forcing 100% premise (the
  // strongest Llama legacy hooks with hookImpact/tension headroom
  // still win, preserving the 10-20% legacy rhythm requested by
  // the user). Stacking math:
  //   - Fresh premise on slot 1                : net +7 (preferred).
  //   - Premise reusing a recent style         : +7 -2 = +5 (still
  //                                              preferred over legacy 0).
  //   - Premise duplicating an in-batch style  : +7 -8 = -1 (correctly
  //                                              loses to fresh-style
  //                                              alternative — the dup
  //                                              guards still win).
  //   - Premise with banned prefix             : +7 -5 = +2 (banned
  //                                              prefix still penalized,
  //                                              just no longer fully
  //                                              suppressed at the
  //                                              selection layer; the
  //                                              hard `validateHook`
  //                                              reject still blocks
  //                                              these from shipping).
  // Phase 6E (PREMISE COMEDY SCORING + REJECTION) — REPLACES the
  // Phase 6D unconditional `if (usedBigPremise === true) p += 7`
  // with a scaled boost driven by `meta.premiseComedyScore.total`
  // (5-dim 0-10 rubric, computed at picker-walk time after
  // `validateOutputLine`):
  //   total >= 10 → +7 (matches the historical Phase 6D top — premium
  //                     premise wins easily, identical stacking math
  //                     for the strongest hooks)
  //   total ===  9 → +6
  //   total ===  8 → +5
  //   total ===  7 → +4 (clearly preferred over legacy 0)
  //   total ===  6 → +1 (demote band — premise can ship if no better
  //                     legacy alternative exists for the slot)
  //   total ===  5 → -2 (demote band — strong legacy strictly preferred)
  //   total <   5  →  0 (defensive — picker walk's HARD reject already
  //                     blocked these; this branch is never taken in
  //                     practice but keeps the math degradation clean
  //                     if a stale candidate slips through)
  //
  // Three orthogonal back-compat guarantees:
  //   1. Legacy entries (no `usedBigPremise`) skip the `if` exactly
  //      as they did under Phase 6D — the boost remains a premise-
  //      only lever, never accidentally promoting a legacy hook.
  //   2. The score is read via `?.total` so a defensive miss
  //      (premise candidate without a populated score, e.g. a
  //      cached pre-6E entry replayed from JSONB) collapses to
  //      `premiseComedyBoost(undefined) === 0` — the candidate
  //      neither gets the old +7 nor a demotion, exactly the same
  //      neutral position a legacy entry sits in. Zero behavior
  //      change for any non-premise candidate.
  //   3. The picker walk's < 5 HARD reject already keeps low-score
  //      premises out of the candidate pool entirely, so the -2 /
  //      +1 demote-band branches above only fire on hooks that
  //      passed both the rubric AND every prior structural rail
  //      (`validateHook` / `validateBigPremise` / `validateOutputLine`).
  //
  // Stacking math (re-verifying the Phase 6D acceptance gate at the
  // new boost ceiling, since the dup / freshness levers below are
  // unchanged):
  //   - Fresh score-10 premise on slot 1        : net +7 (preferred).
  //   - Score-10 premise reusing recent style   : +7 -2 = +5 (still
  //                                               preferred over legacy 0).
  //   - Score-10 premise dup'ing in-batch style : +7 -8 = -1 (correctly
  //                                               loses to fresh-style
  //                                               alternative).
  //   - Score-7 premise on slot 1               : net +4 (clearly above
  //                                               legacy 0).
  //   - Score-7 premise reusing recent style    : +4 -2 = +2 (still
  //                                               preferred over legacy 0).
  //   - Score-6 premise vs strong legacy        : +1 vs legacy +0..+5
  //                                               (legacy can win on
  //                                               other axes — exactly
  //                                               the spec PART 6 intent).
  //   - Score-5 premise vs neutral legacy       : -2 vs legacy 0 (legacy
  //                                               wins — exactly the spec
  //                                               PART 6 intent).
  if (c.meta.usedBigPremise === true) {
    p += premiseComedyBoost(c.meta.premiseComedyScore?.total);
  }
  // Phase 6F (LEGACY COMEDY SCORING + REJECTION) — selection-layer
  // scaled boost mirroring the Phase 6E premise wiring above for
  // legacy hooks (entries with `usedBigPremise !== true`). The
  // picker walk in `pickValidatedLanguagePhrasing` now scores every
  // legacy candidate via `scoreLegacyComedyScore` (4-dim 0-10
  // rubric: relatability 0-3 / clarity 0-3 / simplicity 0-2 /
  // emotional 0-2) and HARD-rejects < 5 BEFORE this boost ever
  // sees the candidate, exactly mirroring the premise gate. The
  // band is intentionally LIGHTER than premise (10→+5..5→-3 vs
  // premise 10→+7..5→-2) to preserve the spec PART 6 tie-bias —
  // a premium premise still beats a premium legacy on tie axes,
  // but a premium legacy beats a weak premise:
  //   total >= 10 → +5 (top of legacy band; loses to premise +7)
  //   total ===  9 → +4 (still loses to premise +6)
  //   total ===  8 → +3 (still loses to premise +5)
  //   total ===  7 → +2 (still loses to premise +4 — but BEATS
  //                      premise +1 / -2 demote-band cleanly)
  //   total ===  6 → 0  (neutral — same posture as a pre-6F legacy
  //                      hook, no behavior change for in-band picks)
  //   total ===  5 → -3 (demote band — premise demote is -2 here,
  //                      so a 5-band legacy loses to a 5-band
  //                      premise; both lose to a 7-band of either
  //                      kind. Mirrors the spec PART 6 demote
  //                      ordering.)
  //   total <   5  →  0 (defensive — picker walk's HARD reject
  //                      already blocked these; same neutral
  //                      collapse as `premiseComedyBoost(undefined)`)
  //
  // Three back-compat guarantees mirroring the Phase 6E reasoning:
  //   1. Premise entries (`usedBigPremise === true`) skip THIS `if`
  //      exactly as legacy entries skipped the Phase 6E `if` above —
  //      premise gets the premise boost, legacy gets the legacy
  //      boost, never both. The two surfaces are mutually exclusive
  //      by construction (the picker walk's if/else assigns at most
  //      one of `premiseComedyScore` / `legacyComedyScore`).
  //   2. The score is read via `?.total` so a defensive miss
  //      (legacy candidate without a populated score, e.g. a cached
  //      pre-6F entry replayed from JSONB, or a fallback wrap's
  //      candidate) collapses to `legacyComedyBoost(undefined) === 0` —
  //      the candidate sits at the same neutral position a pre-6F
  //      legacy candidate sat at. ZERO behavior change for any
  //      candidate whose score was not populated by the new picker
  //      walk.
  //   3. The picker walk's < 5 HARD reject already keeps low-score
  //      legacy entries out of the candidate pool, so the -3 demote
  //      branch above only fires on hooks that passed both the
  //      rubric AND every prior structural rail (`validateHook` /
  //      structural opener checks).
  //
  // Stacking math (verifying the spec PART 6 tie-bias holds at the
  // boost ceiling, since the dup / freshness / generic / banned
  // levers below are unchanged):
  //   - Premium premise (10) vs premium legacy (10) : +7 vs +5
  //                                                   → premise wins
  //                                                     by 2 (correct).
  //   - Premium premise (7)  vs premium legacy (10) : +4 vs +5
  //                                                   → legacy wins
  //                                                     by 1 (correct
  //                                                     — a premier
  //                                                     legacy outranks
  //                                                     a so-so premise).
  //   - Premium legacy (10)  vs weak premise (6)    : +5 vs +1
  //                                                   → legacy wins
  //                                                     by 4 (correct).
  //   - Premium legacy (10)  vs weak premise (5)    : +5 vs -2
  //                                                   → legacy wins
  //                                                     by 7 (correct).
  //   - 5-band premise vs 5-band legacy             : -2 vs -3
  //                                                   → premise wins
  //                                                     by 1 (correct
  //                                                     — premise tie-
  //                                                     bias still
  //                                                     applies in the
  //                                                     demote band).
  //   - Pre-6F cached legacy (no score) vs new 6-band:  0 vs 0
  //                                                   → tied (correct
  //                                                     — the cache
  //                                                     migration is
  //                                                     a no-op for the
  //                                                     baseline neutral
  //                                                     band).
  if (c.meta.usedBigPremise !== true) {
    p += legacyComedyBoost(c.meta.legacyComedyScore?.total);
  }
  // Phase 7 (VIRAL FEEL SCORE) — final ranking polish layer applied
  // SYMMETRICALLY across premise + legacy entries (unlike the comedy
  // boosts above which are mutually exclusive). The boost band is
  // intentionally LIGHTER than both comedy bands so the spec PART 5
  // invariant holds:
  //
  //   Comedy boost ceilings (already applied above):
  //     - premiseComedyBoost:    10→+7, 9→+6, 8→+5, 7→+4, 6→+1, 5→-2
  //     - legacyComedyBoost:     10→+5, 9→+4, 8→+3, 7→+2, 6→+0, 5→-3
  //
  //   Viral boost ceiling (this layer):
  //     - viralFeelBoost:         9-10→+3, 7-8→+2, 5-6→+1, <5→0
  //
  // A premium comedy candidate (≥7) earns at minimum +2 (legacy) or
  // +4 (premise) — so even a premium viral score (+3) on a weak
  // comedy hook (<5 → comedy boost 0; or already gated out by HARD
  // reject in the picker walk) cannot rescue a weak comedy hook to
  // displace a premium comedy candidate. Comedy ALWAYS dominates.
  //
  // Reads `meta.viralFeelScore?.total` defensively — `undefined` is
  // pre-Phase-7 cached candidates, Llama / Claude fallback wraps
  // that didn't run through `assembleCandidate`, and any future
  // candidate type that bypasses the scoring step. `viralFeelBoost-
  // (undefined) === 0`, so the absent path is a no-op. No HARD
  // reject from this layer — `validateHook` + the comedy `<5` HARD
  // reject in the picker walk remain the only gates.
  p += viralFeelBoost(c.meta.viralFeelScore?.total);
  // Phase 7 PART 1 — soft PremiseStyle alignment bonuses for
  // HookIntent + HookLanguageStyle. Small (+1 each, max +2 stack)
  // tie-break-grade nudges that fire ONLY when the candidate carries
  // an explicit `premiseStyleId` AND the candidate's chosen
  // `hookIntent` / `hookLanguageStyle` is in that style's preferred
  // set per `PREMISESTYLE_TO_HOOKINTENT_PREFERENCE` /
  // `PREMISESTYLE_TO_HOOKLANGUAGE_PREFERENCE`.
  //
  // Soft preferences, NOT hard filters: a non-preferred intent /
  // language style still ships normally, it just doesn't earn the
  // alignment bonus. Skipped entirely for legacy entries (no
  // `premiseStyleId`) and Llama / Claude fallback wraps that
  // didn't carry a resolved style id. The +1 magnitude is
  // deliberately well below the comedy + viral bands so alignment
  // never displaces comedy quality in selection — it only pushes
  // the picker toward the spec PART 1 style ⇄ surface combos
  // (deadpan/self-roast → matter_of_fact / confession; absurd →
  // absurd_claim / object_pov; duality → comparison / time_stamp;
  // confession → confession / observation) when comedy + viral
  // are tied.
  const styleIdForBonus = c.meta.premiseStyleId;
  if (styleIdForBonus !== undefined) {
    const intentPrefs = PREMISESTYLE_TO_HOOKINTENT_PREFERENCE[styleIdForBonus];
    const cIntent = c.meta.hookIntent;
    if (
      intentPrefs !== undefined &&
      cIntent !== undefined &&
      intentPrefs.includes(cIntent)
    ) {
      p += 1;
    }
    const langPrefs =
      PREMISESTYLE_TO_HOOKLANGUAGE_PREFERENCE[styleIdForBonus];
    const cLangStyle = c.meta.hookLanguageStyle;
    if (
      langPrefs !== undefined &&
      cLangStyle !== undefined &&
      langPrefs.includes(cLangStyle)
    ) {
      p += 1;
    }
  }
  // Phase 3 HOOK TEMPLATE TUNING — flat selection-layer demotion for
  // generic-template hooks (entries with `genericHook=true`). The
  // per-intent scorers already apply a -4 inside scoreScrollStop /
  // scoreCompulsion / scoreRelatable but that signal saturates at
  // the per-intent score clamp `Math.max(0, raw + 5)` — so once a
  // generic's intrinsic intent signal goes below 0 the additional
  // demotion has no effect on the composite total. Applying -3 here
  // (POST score-clamp, in the un-clamped selection-layer space)
  // closes that ceiling so generic templates reliably lose to
  // scenario-specific phrasings even when their other axes
  // (hookImpact / tension / personalFit) score equally. Skipped
  // silently for fallback wraps without `sourceLanguagePhrasing`.
  const cSrc = metaSourceLanguagePhrasing(c.meta);
  if (cSrc?.genericHook === true) p -= 3;
  // PART 4 — banned-phrasing penalty. -5 when the rendered hook
  // matches any banned-prefix regex (the catalog never produces
  // these but Llama / Claude fallback hooks can). Stacks with the
  // hard reject in `validateHook` (which strips them at generation
  // time) — this penalty is the belt-and-suspenders second line
  // for any candidate that somehow slipped through (e.g. a Llama
  // mutation that re-introduced a banned prefix on rewrite).
  if (lookupBannedHookPrefix(c.idea.hook)) p -= 5;
  return p;
}
