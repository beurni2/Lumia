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
  lookupHookOpener,
  validateHook,
  type HookOpener,
  type PatternMeta,
  type Setting,
  type TopicLane,
  type VisualActionPattern,
} from "./patternIdeator";

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
};

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
): IdeaScore {
  // profile is reserved for future per-creator phrasing fit signals
  // (e.g. tone match between hook + their derived tone). For Layer 2
  // it's accepted but not yet used — keeps the public signature
  // forward-compatible.
  void profile;
  const hookImpact = scoreHookImpact(idea.hook);
  const tension = scoreTension(idea);
  const filmability = scoreFilmability(idea);
  const personalFit = scorePersonalFit(idea, memory);
  const captionStrength = scoreCaptionStrength(idea);
  const freshness = scoreFreshness(idea, recentScenarios, meta);
  const total =
    hookImpact +
    tension +
    filmability +
    personalFit +
    captionStrength +
    freshness;
  return {
    total,
    hookImpact,
    tension,
    filmability,
    personalFit,
    captionStrength,
    freshness,
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

function tryRewrite(
  idea: Idea,
  meta: CandidateMeta,
): { idea: Idea; meta: CandidateMeta } | null {
  if (meta.source !== "pattern_variation") return null;
  if (!meta.scenario) return null;
  const scenario = meta.scenario;
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
  for (const nextStyle of otherStyles) {
    const phrasings = HOOK_PHRASINGS_BY_STYLE[nextStyle];
    if (!phrasings || phrasings.length === 0) continue;
    for (let i = 0; i < phrasings.length; i++) {
      const entry = phrasings[i]!;
      const candidate = entry.build(scenario).trim();
      if (!validateHook(candidate)) continue;
      // Found a shippable rewrite. Update hookOpener too so the
      // batch guards / novelty scorer see the new opener (the
      // chosen entry's tag is authoritative; falling back to
      // `lookupHookOpener` only if the tag is somehow absent).
      const newOpener = entry.opener ?? lookupHookOpener(candidate);
      return {
        idea: { ...idea, hook: candidate, hookStyle: nextStyle },
        meta: {
          ...meta,
          hookStyle: nextStyle,
          hookPhrasingIndex: i,
          hookOpener: newOpener,
        },
      };
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
};

export type FilterAndRescoreResult = {
  kept: ScoredCandidate[];
  rejected: number;
  hardRejected: number;
  rewriteSucceeded: number;
};

export function filterAndRescore(
  input: FilterAndRescoreInput,
): FilterAndRescoreResult {
  const recent = input.recentScenarios ?? [];
  const kept: ScoredCandidate[] = [];
  let hardRejected = 0;
  let rewriteSucceeded = 0;
  let rejected = 0;

  for (const c of input.candidates) {
    const hard = checkHardRejects(c.idea);
    if (hard !== null) {
      hardRejected++;
      continue;
    }
    let score = scoreIdea(c.idea, input.profile, input.memory, recent, c.meta);
    let idea = c.idea;
    let meta = c.meta;
    let rewriteAttempted = false;

    // Hard floor: any zero in the three critical axes ⇒ reject regardless.
    if (score.hookImpact === 0 || score.tension === 0 || score.filmability === 0) {
      // Try rewrite once if it's pattern_variation — maybe a different
      // hook style salvages it.
      const rewritten = tryRewrite(idea, meta);
      if (!rewritten) {
        rejected++;
        continue;
      }
      rewriteAttempted = true;
      idea = rewritten.idea;
      meta = rewritten.meta;
      score = scoreIdea(idea, input.profile, input.memory, recent, meta);
      if (score.hookImpact === 0 || score.tension === 0 || score.filmability === 0) {
        rejected++;
        continue;
      }
      rewriteSucceeded++;
    }

    // 6–7 promising-but-weak: try one rewrite, keep best of the two.
    if (score.total >= 6 && score.total <= 7 && !rewriteAttempted) {
      const rewritten = tryRewrite(idea, meta);
      if (rewritten) {
        const rewrittenScore = scoreIdea(
          rewritten.idea,
          input.profile,
          input.memory,
          recent,
          rewritten.meta,
        );
        if (rewrittenScore.total > score.total) {
          idea = rewritten.idea;
          meta = rewritten.meta;
          score = rewrittenScore;
          rewriteAttempted = true;
          rewriteSucceeded++;
        }
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

  return { kept, rejected, hardRejected, rewriteSucceeded };
}

// -----------------------------------------------------------------------------
// Novelty scoring (0–5) + selection penalties
// -----------------------------------------------------------------------------
// Layered ON TOP of qualityScore (`IdeaScore.total`, 0–10) by the
// hybrid orchestrator's selector. Two ideas with the same quality
// score now get separated by:
//
//   1. Novelty bonus (0–5) — per-axis 0/1 across hookStyle, scenario,
//      structure, visualAction, topic. Computed against BOTH the
//      already-picked batch AND the recent context (previous batch).
//      ONLY applied when qualityScore >= HIGH_QUALITY_SCORE (8) so
//      novelty cannot rescue weak ideas.
//
//   2. Selection penalty (negative) — applied at pick time against
//      the already-picked batch only:
//         -2 same hookStyle
//         -3 same scenarioFamily
//         -1 same structure
//         -2 same topicLane
//         -2 same visualActionPattern
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

/**
 * 0–7 novelty score across hookStyle / scenario / structure /
 * visualAction / topic / hookOpener / setting. Each dimension
 * contributes 0 or 1 — 0 if the candidate's value matches anything
 * in the already-picked batch OR in the recent context, 1 if fresh
 * on both fronts.
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

  return (
    (hookFresh ? 1 : 0) +
    (scenFresh ? 1 : 0) +
    (structFresh ? 1 : 0) +
    (vaFresh ? 1 : 0) +
    (tlFresh ? 1 : 0) +
    (opFresh ? 1 : 0) +
    (stFresh ? 1 : 0)
  );
}

/**
 * Negative penalty applied to a candidate at pick time, against the
 * already-picked batch. Penalties saturate per-axis (one match is
 * enough — multiple picks sharing the same axis don't compound).
 *
 *   same hookStyle              → -2
 *   same scenarioFamily         → -3
 *   same structure              → -1
 *   same topicLane              → -2
 *   same visualActionPattern    → -2
 *   same hookOpener             → -2  (new — opener feels like the same hook)
 *   same setting                → -2  (new — same physical location)
 *
 * Returns 0 when batch is empty.
 */
export function selectionPenalty(
  c: { idea: Idea; meta: CandidateMeta },
  batchSoFar: ReadonlyArray<{ idea: Idea; meta: CandidateMeta }>,
): number {
  if (batchSoFar.length === 0) return 0;
  let p = 0;
  const styles = new Set<string>();
  const families = new Set<string>();
  const structures = new Set<string>();
  const visuals = new Set<VisualActionPattern>();
  const topics = new Set<TopicLane>();
  const openers = new Set<HookOpener>();
  const settings = new Set<Setting>();
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
  return p;
}
