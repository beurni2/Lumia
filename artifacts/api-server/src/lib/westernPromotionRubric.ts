/**
 * PHASE W2-O — Western promotion rubric.
 *
 * Pure, deterministic scorer over `WesternHookPackDraftEntry` rows
 * that codifies the editorial promotion bar separating the staging
 * pool (`APPROVED_WESTERN_PROMOTION_CANDIDATES`, 300 entries, all
 * `PENDING_EDITORIAL_REVIEW`) from the editor-signed live pool
 * (`WESTERN_HOOK_PACK_LIVE` — see `westernHookPackLive.ts`).
 *
 * The rubric is invoked:
 *   1. At live-pool module load time (`westernHookPackLive.ts`) to
 *      derive the promote-eligible subset.
 *   2. By the QA driver (`qa/w2oPromotionRubricQa.ts`) to surface
 *      promote / needs_rewrite / reject counts + reasons per source
 *      block in `.local/W2O_RUBRIC_REPORT.md`.
 *   3. By the rubric unit tests for determinism + safety guarantees.
 *
 * Hard rules honored:
 *   • No validator loosening — survival uses the real
 *     `authorWesternPackEntryAsIdea` (4-validator pipeline).
 *   • No Claude prompt change, no migration, no public-API change.
 *   • Pure functions only — no I/O, no global state. Same input
 *     always yields the same output.
 *
 * Dimension weights:
 *   validatorSurvival     30  (HARD: a fail forces recommendation = reject)
 *   hookLength             5
 *   hookAiTell             8
 *   hookPunch              8
 *   scenarioFilmability   10
 *   scenarioSpecificity    8
 *   hookScenarioCohesion   8
 *   lowLiftSolo            6
 *   safetyPrivacy          8  (HARD: a hit forces recommendation = reject)
 *   duplicationNovelty     8  (HARD: skeleton appears > 2 times → reject)
 *   diversityContribution  8
 *   ── total max         107
 *
 * Recommendation (deterministic from result fields):
 *   promote        — no rejectReasons AND totalScore >= PROMOTE_FLOOR (88)
 *   needs_rewrite  — no rejectReasons AND totalScore in [REWRITE_FLOOR, PROMOTE_FLOOR)
 *   reject         — rejectReasons present OR totalScore < REWRITE_FLOOR (65)
 */

import type {
  WesternComedyFamily,
  WesternEmotionalSpike,
  WesternHookPackDraftEntry,
  WesternSetting,
} from "./westernHookPack.js";
import {
  authorWesternPackEntryAsIdea,
  normalizeWesternHookSkeleton,
} from "./westernPackAuthor.js";

// ---------------------------------------------------------------- //
// Public types and constants                                         //
// ---------------------------------------------------------------- //

export const RUBRIC_DIMENSIONS = [
  "validatorSurvival",
  "hookLength",
  "hookAiTell",
  "hookPunch",
  "scenarioFilmability",
  "scenarioSpecificity",
  "hookScenarioCohesion",
  "lowLiftSolo",
  "safetyPrivacy",
  "duplicationNovelty",
  "diversityContribution",
] as const;

export type RubricDimension = (typeof RUBRIC_DIMENSIONS)[number];

export const RUBRIC_WEIGHTS: Readonly<Record<RubricDimension, number>> =
  Object.freeze({
    validatorSurvival: 30,
    hookLength: 5,
    hookAiTell: 8,
    hookPunch: 8,
    scenarioFilmability: 10,
    scenarioSpecificity: 8,
    hookScenarioCohesion: 8,
    lowLiftSolo: 6,
    safetyPrivacy: 8,
    duplicationNovelty: 8,
    diversityContribution: 8,
  });

export const RUBRIC_MAX_SCORE: number = (
  Object.values(RUBRIC_WEIGHTS) as number[]
).reduce((a, b) => a + b, 0);

/** Promotion-bar thresholds. Tuned so the live pool ships a meaningful
 *  fraction of the staging pool while keeping the bar editorial-strict. */
export const RUBRIC_PROMOTE_FLOOR = 88;
export const RUBRIC_REWRITE_FLOOR = 65;

export type RubricRecommendation = "promote" | "needs_rewrite" | "reject";

export interface RubricEntryResult {
  readonly entryId: string;
  readonly totalScore: number;
  readonly perDimension: Readonly<Record<RubricDimension, number>>;
  readonly rejectReasons: readonly string[];
  readonly warningReasons: readonly string[];
  readonly recommendation: RubricRecommendation;
}

export interface RubricPoolContext {
  readonly skeletonCounts: ReadonlyMap<string, number>;
  readonly anchorCounts: ReadonlyMap<string, number>;
  readonly familyCounts: ReadonlyMap<WesternComedyFamily, number>;
  readonly settingCounts: ReadonlyMap<WesternSetting, number>;
  readonly spikeCounts: ReadonlyMap<WesternEmotionalSpike, number>;
}

// ---------------------------------------------------------------- //
// Stoplists / heuristic vocabularies                                 //
// ---------------------------------------------------------------- //

const STOPWORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "in", "on", "at",
  "to", "for", "with", "by", "from", "as", "is", "are", "was", "were",
  "be", "been", "being", "have", "has", "had", "do", "does", "did",
  "i", "me", "my", "you", "your", "we", "our", "they", "them", "their",
  "it", "its", "this", "that", "these", "those", "so", "not", "no",
  "yes", "just", "very", "really", "too", "than", "then", "now", "out",
  "up", "down", "off", "over", "into", "about", "again", "still",
]);

/** Words / glyphs that strongly cue AI-generated copy. Hits stack
 *  (each unique hit subtracts 2 from the dimension score). */
const HOOK_AI_TELLS: readonly RegExp[] = [
  /—/, // em-dash
  /\bdelve\b/i,
  /\belevate\b/i,
  /\bembark\b/i,
  /\btreasure trove\b/i,
  /\bnavigate the\b/i,
  /\bin today's\b/i,
  /\bunleash\b/i,
  /\bunlock\b/i,
  /\bgame[- ]changer\b/i,
  /\bground[- ]breaking\b/i,
  /\bcutting[- ]edge\b/i,
  /\bseamless\b/i,
  /\bleverage\b/i,
  /\boptimi[sz]e\b/i,
  /\bsynerg\w*/i,
  /\bin essence\b/i,
  /\bit is worth noting\b/i,
];

/** Concrete verbs that signal a filmable, specific moment. The list
 *  is intentionally tight so a generic "is/has" copy fails the
 *  hookPunch dimension. */
const HOOK_CONCRETE_VERBS: ReadonlySet<string> = new Set([
  "open", "close", "drop", "snatch", "swipe", "scroll", "type",
  "delete", "send", "post", "stare", "freeze", "pause", "lean",
  "flip", "scoop", "hold", "hit", "land", "fall", "trip", "smile",
  "stretch", "rehearse", "reach", "explain", "reply", "answer",
  "watch", "look", "say", "tell", "ask", "make", "take", "get",
  "go", "come", "leave", "walk", "sit", "stand", "run", "jump",
  "move", "turn", "cut", "check", "click", "tap", "wait", "hover",
  "lock", "vanish", "remove", "give", "keep", "put", "try", "want",
  "need", "feel", "start", "stop", "refresh", "begin", "begs",
  "pretend", "pretends", "promise", "promises", "claim", "claims",
  "swear", "swears", "argue", "argues", "stare", "stares",
]);

/** Visible-action verbs in whatToShow that clear the filmability
 *  dimension. Aligned with the existing approved-pool test's
 *  `VISIBLE_ACTION_VERBS` philosophy without re-importing it. */
const SCENARIO_VISIBLE_VERBS: ReadonlySet<string> = new Set([
  "open", "opens", "close", "closes", "drop", "drops", "snatch",
  "snatches", "swipe", "swipes", "scroll", "scrolls", "type", "types",
  "delete", "deletes", "send", "sends", "post", "posts", "stare",
  "stares", "freeze", "freezes", "pause", "pauses", "lean", "leans",
  "flip", "flips", "scoop", "scoops", "hold", "holds", "hit", "hits",
  "land", "lands", "fall", "falls", "trip", "trips", "smile", "smiles",
  "stretch", "stretches", "rehearse", "rehearses", "reach", "reaches",
  "explain", "explains", "reply", "replies", "answer", "answers",
  "watch", "watches", "look", "looks", "tap", "taps", "click", "clicks",
  "lock", "locks", "remove", "removes", "vanish", "vanishes",
  "walk", "walks", "sit", "sits", "stand", "stands", "run", "runs",
  "turn", "turns", "cut", "cuts", "wait", "waits", "hover", "hovers",
  "refresh", "refreshes", "pick", "picks", "grab", "grabs",
]);

/** Markers that imply more than one on-camera person — fails the
 *  low-lift solo filming dimension when present in `whatToShow`. */
const NON_SOLO_MARKERS: ReadonlyArray<RegExp> = [
  /\bfriend(s)?\b/i,
  /\bguest(s)?\b/i,
  /\bcrowd\b/i,
  /\bpeople\b/i,
  /\bgroup\b/i,
  /\bcouple\b/i,
  /\beveryone\b/i,
  /\baudience\b/i,
  /\bfamily\b/i,
  /\bmom\b/i,
  /\bdad\b/i,
  /\bsister\b/i,
  /\bbrother\b/i,
  /\bcoworker(s)?\b/i,
  /\bclassmate(s)?\b/i,
  /\bteam\b/i,
];

/** Privacy / safety stoplist. A hit forces a HARD reject. */
const PRIVACY_PATTERNS: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: "phone_number", pattern: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/ },
  { id: "email", pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/ },
  {
    id: "address_line",
    pattern:
      /\b\d+\s+[A-Z][a-z]+\s+(Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Boulevard|Blvd)\b/,
  },
  { id: "child_reference", pattern: /\b(child|children|kid|kids|toddler|baby|infant|minor)\b/i },
  // Heuristic real-name: two consecutive Title-cased tokens that look
  // like a first+last name. Not a hard rejecter on its own (warning).
];

const REAL_NAME_HEURISTIC = /\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/;

// ---------------------------------------------------------------- //
// Helpers                                                            //
// ---------------------------------------------------------------- //

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z][a-z0-9']{1,}/g) ?? []).filter(
    (t) => t.length >= 2,
  );
}

function contentTokens(s: string): string[] {
  return tokenize(s).filter((t) => !STOPWORDS.has(t));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ---------------------------------------------------------------- //
// Pool context — frequency maps over the entries being scored.       //
// ---------------------------------------------------------------- //

export function buildPoolContext(
  entries: readonly WesternHookPackDraftEntry[],
): RubricPoolContext {
  const skeletonCounts = new Map<string, number>();
  const anchorCounts = new Map<string, number>();
  const familyCounts = new Map<WesternComedyFamily, number>();
  const settingCounts = new Map<WesternSetting, number>();
  const spikeCounts = new Map<WesternEmotionalSpike, number>();

  for (const e of entries) {
    const sk = normalizeWesternHookSkeleton(e.hook);
    skeletonCounts.set(sk, (skeletonCounts.get(sk) ?? 0) + 1);
    const a = e.anchor.toLowerCase();
    anchorCounts.set(a, (anchorCounts.get(a) ?? 0) + 1);
    familyCounts.set(
      e.comedyFamily,
      (familyCounts.get(e.comedyFamily) ?? 0) + 1,
    );
    settingCounts.set(e.setting, (settingCounts.get(e.setting) ?? 0) + 1);
    spikeCounts.set(
      e.emotionalSpike,
      (spikeCounts.get(e.emotionalSpike) ?? 0) + 1,
    );
  }

  return { skeletonCounts, anchorCounts, familyCounts, settingCounts, spikeCounts };
}

// ---------------------------------------------------------------- //
// Per-dimension scorers                                              //
// ---------------------------------------------------------------- //

interface DimensionOutcome {
  readonly score: number;
  readonly rejectReasons: readonly string[];
  readonly warningReasons: readonly string[];
}

function none(score: number): DimensionOutcome {
  return { score, rejectReasons: [], warningReasons: [] };
}

function scoreValidatorSurvival(
  entry: WesternHookPackDraftEntry,
): DimensionOutcome {
  const result = authorWesternPackEntryAsIdea({
    entry,
    regenerateSalt: 0,
    seedFingerprints: new Set<string>(),
  });
  if (result.ok) return none(RUBRIC_WEIGHTS.validatorSurvival);
  return {
    score: 0,
    rejectReasons: [`validator_failed:${result.reason}`],
    warningReasons: [],
  };
}

function scoreHookLength(hook: string): DimensionOutcome {
  const len = hook.trim().length;
  if (len >= 30 && len <= 100) return none(RUBRIC_WEIGHTS.hookLength);
  if (len >= 20 && len <= 120) return none(3);
  return { score: 1, rejectReasons: [], warningReasons: ["hook_length_out_of_band"] };
}

function scoreHookAiTell(hook: string): DimensionOutcome {
  let hits = 0;
  for (const re of HOOK_AI_TELLS) if (re.test(hook)) hits++;
  // Excessive -ly adverbs are an additional weak AI-tell signal.
  const lyMatches = hook.toLowerCase().match(/\b\w+ly\b/g) ?? [];
  if (lyMatches.length >= 3) hits++;
  const score = clamp(RUBRIC_WEIGHTS.hookAiTell - hits * 2, 0, RUBRIC_WEIGHTS.hookAiTell);
  const warnings: string[] = hits >= 2 ? ["hook_ai_tell_density"] : [];
  return { score, rejectReasons: [], warningReasons: warnings };
}

function scoreHookPunch(hook: string): DimensionOutcome {
  const toks = tokenize(hook);
  const content = toks.filter((t) => !STOPWORDS.has(t));
  const hasSpecificNoun = content.some(
    (t) => t.length >= 5 && !HOOK_CONCRETE_VERBS.has(t),
  );
  const hasConcreteVerb = content.some((t) => HOOK_CONCRETE_VERBS.has(t));
  if (hasSpecificNoun && hasConcreteVerb)
    return none(RUBRIC_WEIGHTS.hookPunch);
  if (hasSpecificNoun || hasConcreteVerb) return none(4);
  return { score: 1, rejectReasons: [], warningReasons: ["hook_punch_weak"] };
}

function scoreScenarioFilmability(whatToShow: string): DimensionOutcome {
  const len = whatToShow.trim().length;
  let bandPts = 0;
  if (len >= 60 && len <= 280) bandPts = 6;
  else if (len >= 40 && len <= 400) bandPts = 3;
  else bandPts = 1;
  const toks = tokenize(whatToShow);
  const verbCount = toks.filter((t) => SCENARIO_VISIBLE_VERBS.has(t)).length;
  const verbPts = verbCount >= 2 ? 4 : verbCount === 1 ? 2 : 0;
  const total = clamp(bandPts + verbPts, 0, RUBRIC_WEIGHTS.scenarioFilmability);
  const warnings: string[] = [];
  if (verbCount === 0) warnings.push("scenario_no_visible_verb");
  if (len > 400 || len < 40) warnings.push("scenario_length_out_of_band");
  return { score: total, rejectReasons: [], warningReasons: warnings };
}

function scoreScenarioSpecificity(whatToShow: string): DimensionOutcome {
  const content = contentTokens(whatToShow).filter((t) => t.length >= 4);
  const distinct = new Set(content).size;
  if (distinct >= 6) return none(RUBRIC_WEIGHTS.scenarioSpecificity);
  if (distinct >= 4) return none(6);
  if (distinct >= 2) return none(3);
  return { score: 1, rejectReasons: [], warningReasons: ["scenario_thin_specificity"] };
}

function scoreHookScenarioCohesion(
  hook: string,
  whatToShow: string,
): DimensionOutcome {
  const hookContent = new Set(contentTokens(hook).filter((t) => t.length >= 4));
  const wtsContent = new Set(contentTokens(whatToShow).filter((t) => t.length >= 4));
  let overlap = 0;
  for (const t of hookContent) if (wtsContent.has(t)) overlap++;
  if (overlap >= 3) return none(RUBRIC_WEIGHTS.hookScenarioCohesion);
  if (overlap >= 2) return none(5);
  if (overlap === 1) return none(2);
  return { score: 0, rejectReasons: [], warningReasons: ["hook_scenario_no_overlap"] };
}

function scoreLowLiftSolo(whatToShow: string): DimensionOutcome {
  const hits = NON_SOLO_MARKERS.filter((re) => re.test(whatToShow));
  if (hits.length === 0) return none(RUBRIC_WEIGHTS.lowLiftSolo);
  const warnings = ["scenario_implies_extra_people"];
  const score = clamp(RUBRIC_WEIGHTS.lowLiftSolo - hits.length * 3, 0, RUBRIC_WEIGHTS.lowLiftSolo);
  return { score, rejectReasons: [], warningReasons: warnings };
}

function scoreSafetyPrivacy(
  entry: WesternHookPackDraftEntry,
): DimensionOutcome {
  const haystack = [
    entry.hook,
    entry.whatToShow,
    entry.howToFilm,
    entry.caption,
  ].join(" ");
  const hardHits: string[] = [];
  for (const p of PRIVACY_PATTERNS) {
    if (p.pattern.test(haystack)) hardHits.push(`privacy_${p.id}`);
  }
  if (hardHits.length > 0) {
    return { score: 0, rejectReasons: hardHits, warningReasons: [] };
  }
  // Soft real-name heuristic: TitleCase + TitleCase. Only check the
  // hook + caption (whatToShow can legitimately use TitleCase tokens
  // for places like "Trader Joe's"). Even then a hit is a warning,
  // not a hard reject — the editorial reviewer adjudicates.
  const hookCap = REAL_NAME_HEURISTIC.test(entry.hook);
  const capCap = REAL_NAME_HEURISTIC.test(entry.caption);
  if (hookCap || capCap) {
    return {
      score: clamp(RUBRIC_WEIGHTS.safetyPrivacy - 4, 0, RUBRIC_WEIGHTS.safetyPrivacy),
      rejectReasons: [],
      warningReasons: ["possible_real_name_heuristic"],
    };
  }
  return none(RUBRIC_WEIGHTS.safetyPrivacy);
}

function scoreDuplicationNovelty(
  entry: WesternHookPackDraftEntry,
  ctx: RubricPoolContext,
): DimensionOutcome {
  const sk = normalizeWesternHookSkeleton(entry.hook);
  const occurrences = ctx.skeletonCounts.get(sk) ?? 1;
  if (occurrences === 1) return none(RUBRIC_WEIGHTS.duplicationNovelty);
  if (occurrences === 2)
    return {
      score: 4,
      rejectReasons: [],
      warningReasons: ["skeleton_appears_twice_in_pool"],
    };
  return {
    score: 0,
    rejectReasons: [`duplicate_skeleton:${occurrences}_occurrences`],
    warningReasons: [],
  };
}

function scoreDiversityContribution(
  entry: WesternHookPackDraftEntry,
  ctx: RubricPoolContext,
): DimensionOutcome {
  // Each axis: rare (count <= 5) → 2, mid (6..15) → 1, common (>15) → 0.
  const axisScore = (count: number): number =>
    count <= 5 ? 2 : count <= 15 ? 1 : 0;
  const sum =
    axisScore(ctx.anchorCounts.get(entry.anchor.toLowerCase()) ?? 0) +
    axisScore(ctx.familyCounts.get(entry.comedyFamily) ?? 0) +
    axisScore(ctx.settingCounts.get(entry.setting) ?? 0) +
    axisScore(ctx.spikeCounts.get(entry.emotionalSpike) ?? 0);
  return none(clamp(sum, 0, RUBRIC_WEIGHTS.diversityContribution));
}

// ---------------------------------------------------------------- //
// Per-entry orchestration                                            //
// ---------------------------------------------------------------- //

export function scoreEntry(
  entry: WesternHookPackDraftEntry,
  ctx: RubricPoolContext,
): RubricEntryResult {
  const outcomes: Record<RubricDimension, DimensionOutcome> = {
    validatorSurvival: scoreValidatorSurvival(entry),
    hookLength: scoreHookLength(entry.hook),
    hookAiTell: scoreHookAiTell(entry.hook),
    hookPunch: scoreHookPunch(entry.hook),
    scenarioFilmability: scoreScenarioFilmability(entry.whatToShow),
    scenarioSpecificity: scoreScenarioSpecificity(entry.whatToShow),
    hookScenarioCohesion: scoreHookScenarioCohesion(entry.hook, entry.whatToShow),
    lowLiftSolo: scoreLowLiftSolo(entry.whatToShow),
    safetyPrivacy: scoreSafetyPrivacy(entry),
    duplicationNovelty: scoreDuplicationNovelty(entry, ctx),
    diversityContribution: scoreDiversityContribution(entry, ctx),
  };

  const perDimension: Record<RubricDimension, number> = {
    validatorSurvival: outcomes.validatorSurvival.score,
    hookLength: outcomes.hookLength.score,
    hookAiTell: outcomes.hookAiTell.score,
    hookPunch: outcomes.hookPunch.score,
    scenarioFilmability: outcomes.scenarioFilmability.score,
    scenarioSpecificity: outcomes.scenarioSpecificity.score,
    hookScenarioCohesion: outcomes.hookScenarioCohesion.score,
    lowLiftSolo: outcomes.lowLiftSolo.score,
    safetyPrivacy: outcomes.safetyPrivacy.score,
    duplicationNovelty: outcomes.duplicationNovelty.score,
    diversityContribution: outcomes.diversityContribution.score,
  };

  const totalScore = (Object.values(perDimension) as number[]).reduce(
    (a, b) => a + b,
    0,
  );

  const rejectReasons: string[] = [];
  const warningReasons: string[] = [];
  for (const dim of RUBRIC_DIMENSIONS) {
    for (const r of outcomes[dim].rejectReasons) rejectReasons.push(r);
    for (const w of outcomes[dim].warningReasons) warningReasons.push(w);
  }

  let recommendation: RubricRecommendation;
  if (rejectReasons.length > 0) {
    recommendation = "reject";
  } else if (totalScore >= RUBRIC_PROMOTE_FLOOR) {
    recommendation = "promote";
  } else if (totalScore >= RUBRIC_REWRITE_FLOOR) {
    recommendation = "needs_rewrite";
  } else {
    recommendation = "reject";
  }

  return Object.freeze({
    entryId: entry.id,
    totalScore,
    perDimension: Object.freeze(perDimension),
    rejectReasons: Object.freeze(rejectReasons),
    warningReasons: Object.freeze(warningReasons),
    recommendation,
  });
}

export function scorePool(
  entries: readonly WesternHookPackDraftEntry[],
): readonly RubricEntryResult[] {
  const ctx = buildPoolContext(entries);
  return entries.map((e) => scoreEntry(e, ctx));
}
