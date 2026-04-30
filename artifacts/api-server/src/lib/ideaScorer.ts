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
  lookupBannedHookPrefix,
  lookupHookOpener,
  validateHook,
  type Energy,
  type HookLanguageStyle,
  type HookOpener,
  type IdeaCoreFamily,
  type IdeaCoreType,
  type PatternMeta,
  type ScriptType,
  type Setting,
  type TopicLane,
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
  /**
   * Llama 3.2 Vision-derived style hints. Optional — when absent
   * (the common case for new creators / pre-v21 rows) the scoring
   * pipeline is identical to its pre-vision behavior. When present,
   * applied via `applyVisionBoost` at the personalFit step only.
   * See `lib/visionProfileAggregator.ts` for the doc shape.
   */
  derivedStyleHints?: DerivedStyleHints;
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
    let score = scoreIdea(
      c.idea,
      input.profile,
      input.memory,
      recent,
      c.meta,
      input.derivedStyleHints,
    );
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
          input.derivedStyleHints,
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
