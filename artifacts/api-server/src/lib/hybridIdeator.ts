/**
 * Layer 4 of the Hybrid Ideator Pipeline — orchestrator.
 *
 * Routes a single ideator request through:
 *   1. Same-day cache check on the creator row.
 *   2. Layer 1 (`generatePatternCandidates`) + Layer 2
 *      (`filterAndRescore`) — fully local, $0.
 *   3. Claude fallback via existing `generateIdeas` ONLY when fewer
 *      than 3 local candidates clear the scorer. Fallback ideas are
 *      run through the same scorer so the bar is identical.
 *   4. Persist the final batch back into `creators.last_idea_batch_*`
 *      so a same-day repeat without `regenerate=true` is free.
 *
 * Public contract: returns `{ ideas: Idea[] }` shaped exactly like
 * `generateIdeas`, plus telemetry fields the route layer logs but
 * does NOT forward to clients. The mobile app stays unchanged.
 *
 * No mutation of the public Idea shape. The pipeline never throws —
 * any failure inside cache load, persistence, or memory aggregation
 * falls back to the next viable step so the user always sees ideas.
 */

import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { logger } from "./logger";
import {
  generateIdeas,
  ideaSchema,
  type GenerateIdeasInput,
  type Idea,
} from "./ideaGen";
import {
  BIG_PREMISE_STYLES,
  generatePatternCandidates,
  HOOK_LANGUAGE_STYLES,
  IDEA_CORE_FAMILIES,
  IDEA_CORE_TYPES,
  lookupHookOpener,
  lookupIdeaCoreType,
  lookupScriptType,
  lookupTopicLane,
  lookupVisualActionPattern,
  parsePremiseStyleId,
  resolveIdeaCoreFamily,
  SCRIPT_TYPE_CLUSTERS,
  SCRIPT_TYPES,
  selectPrimaryVoiceProfile,
  VOICE_PROFILES,
  type BigPremiseStyle,
  type Energy,
  type HookIntent,
  type HookLanguageStyle,
  type HookOpener,
  type IdeaCoreFamily,
  type IdeaCoreType,
  type PatternCandidate,
  type PremiseStyleId,
  type ScriptType,
  type Setting,
  type TopicLane,
  type VideoPattern,
  type VisualActionPattern,
  type VoiceProfile,
  type VoiceProfileSelection,
} from "./patternIdeator";
import { parseTasteCalibration } from "./tasteCalibration";
import {
  filterAndRescore,
  hookBigramJaccard,
  hookWordBigrams,
  normalizeHookForDedup,
  scoreNovelty,
  selectionPenalty,
  computeFirstSessionBoostFactor,
  type CandidateMeta,
  type IdeaScore,
  type NoveltyContext,
  type ScoredCandidate,
} from "./ideaScorer";
// PHASE Z1 — willingness ranker + trust-line composer. Pure
// deterministic, no Claude / DB. See lib/willingnessScorer.ts +
// lib/whyThisFitsYou.ts for the scoring rubric and template set.
import { scoreWillingness } from "./willingnessScorer";
import { composeWhyThisFitsYou } from "./whyThisFitsYou";
// PHASE X2 — PART 4 — `recentPremises` set for the anti-copy
// validator. Imported here (not in ideaScorer) because the
// orchestrator owns the cache-history walk and needs the same
// normalize function the validator uses internally.
import { normalizeHookFingerprint } from "./comedyValidation";
import { validateScenarioCoherence } from "./scenarioCoherence";
// PHASE Y (PREMISE CORE LIBRARY) — orchestrator owns the core-
// selection step (anti-recent + family-rotation are cross-batch
// concerns the picker can't see from inside `generateIdeas`). The
// selected cores are passed via `premiseCoreSeeds` on the
// GenerateIdeasInput; `formatPremiseCoresForPrompt` renders them
// into the system prompt at the call site.
import {
  getPremiseCoreById,
  selectPremiseCores,
} from "./premiseCoreLibrary";
// PHASE Y5 — SAFE PARALLEL deterministic core-native candidate generator.
// Same supply-side seed source as the Y2 fallback path (selectPremiseCores
// + recent-id / recent-mechanism + ≥1-fresh swap) but emitted as LOCAL
// candidates that compete in `filterAndRescore` alongside the existing
// pattern_variation pool. NO Claude / cost / API change. Pure deterministic
// given (cores, regenerateSalt, noveltyContext, recentPremises). See
// module header for the meta-shape contract + scorer-side semantics.
import {
  generateCoreCandidates,
  type AntiCopyRejectsTelemetry,
} from "./coreCandidateGenerator";
import {
  buildRetentionProfile,
  applyBatchComposition,
} from "./retentionNoveltyScorer";
// PHASE N1-S2 — Nigerian Pack Slot Reservation. Activation guard
// inside the helper short-circuits to identity for every cohort
// other than nigeria + pidgin/light_pidgin + flag ON + non-empty
// pack — flag-OFF and non-eligible cohorts are byte-identical to
// the upstream `selection.batch`.
import {
  applyNigerianPackSlotReservation,
  type SlotReservationDiagnostic,
} from "./nigerianPackSlotReservation";
// PHASE N1-LIVE-HARDEN F2 — Nigerian region-anchor brand validator.
// Cohort-gated post-merge filter: drops catalog/pattern candidates
// whose rendered surfaces carry obvious Western-only brand anchors
// (doordash/venmo/walmart/...) ONLY when the request resolves to a
// Nigeria + light_pidgin/pidgin + flag-ON cohort. Non-NG / NG-clean
// / NG-null / flag-OFF cohorts are byte-identical to baseline
// because `shouldApplyNigerianRegionAnchorValidator` short-circuits
// the helper to a no-op. NEVER touches anti-copy / safety / scoring.
import {
  shouldApplyNigerianRegionAnchorValidator,
  validateNigerianRegionAnchor,
} from "./nigerianRegionAnchorValidator.js";
import {
  getRecentSeenEntryIds,
  getRecentSeenEntriesOrdered,
  recordSeenEntries,
} from "./nigerianPackCreatorMemory.js";
// PHASE N1-FULL-SPEC LIVE v2 — catalog hook-skeleton dedup. The
// first attempt (pre-filter by `meta.templateId` for
// `pattern_variation` only) regressed latency (pool shrinkage →
// selectWithNovelty underfill → Claude fallback) AND missed
// repeats flowing through `core_native`. The corrected design:
//   • Track NORMALIZED HOOK SKELETONS (not templateIds) — cross-
//     source, catches every repeat by the same template family.
//   • Apply AFTER selection (post-pack-reservation), as a SWAP
//     with alternatives from the same `merged` pool — never
//     drops, never shrinks the pool fed to selectWithNovelty.
//   • Skip pack candidates (governed by per-pack-entry memory
//     immediately above).
//   • Graceful degradation — if no alternative exists, ship the
//     repeat. Better to repeat than to underfill or stall.
import {
  getRecentSeenSkeletons,
  recordSeenSkeletons,
  normalizeHookToSkeleton,
} from "./catalogTemplateCreatorMemory.js";
import {
  canActivateNigerianPack,
  isNigerianPackFeatureEnabled,
  NIGERIAN_HOOK_PACK,
} from "./nigerianHookPack";
// PHASE Y6 — cohesive author surfaces a `scenarioFingerprint` on
// every core_native candidate's meta + the catalog exposes the
// distinct anchors used for served-log probing. The `extractAnchor`
// + `_allActions` pair lets the served-log block recover which
// catalog anchor each core_native idea actually shipped with
// (without the meta carrying it directly — cost-neutral relative
// to a probe over the small constant catalog).
import {
  getAllCatalogAnchors,
  FAMILY_ACTIONS,
} from "./coreDomainAnchorCatalog";
import {
  canonicalizeHookForFingerprint,
  extractAnchorAndAction,
} from "./scenarioFingerprint";
import {
  isVoiceClusterId as _isVoiceClusterId,
  type VoiceClusterId,
} from "./voiceClusters.js";
// PHASE Y10 — `isVoiceClusterId` is the single source of truth for
// the 4-cluster taxonomy membership (lives in `voiceClusters.ts`
// next to the type itself + the `VOICE_CLUSTERS` registry it reads
// off). Imported under the `_` alias here to mark it as a guard
// helper for the cache parse / write paths below (architect-fix:
// avoids a duplicated literal tuple that could silently under-
// accept a future taxonomy addition).
import {
  resolveArchetypeLoose,
  type Archetype,
  type ArchetypeFamily,
} from "./archetypeTaxonomy";
import {
  lookupSceneObjectTag,
  ENV_CLUSTER_BY_TAG,
  SCENE_OBJECT_TAGS,
  type SceneObjectTag,
  type SceneEnvCluster,
} from "./sceneObjectTaxonomy";
import {
  computeViralPatternMemory,
  EMPTY_MEMORY,
  type ViralPatternMemory,
} from "./viralPatternMemory";
import {
  applyOnboardingSeed,
  buildOnboardingSeed,
  type OnboardingSeed,
} from "./onboardingSeed";
import {
  maybeMutateBatch,
  type MutationUsageContext,
} from "./llamaHookMutator";
import {
  DEFAULT_STYLE_PROFILE,
  type StyleProfile,
} from "./styleProfile";
import { parseVisionStyleDoc } from "./visionProfileAggregator";
import type { Creator } from "../db/schema";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type HybridIdeatorInput = GenerateIdeasInput & {
  /** Full creator row (from `resolveCreator`) — required for cache. */
  creator?: Creator;
  /** Soft-penalty list of recently-used scenario families. */
  recentScenarios?: string[];
  /**
   * PHASE UX3 — visible-hook exclusion list from the mobile
   * refresh tap. Lowercased + trimmed hook strings of whatever
   * the creator can currently see on Home. The orchestrator
   * applies a two-tier filter against the merged scored pool
   * BEFORE selectWithNovelty:
   *
   *   - hard-reject any candidate whose normalized hook exactly
   *     matches an entry (defends against deterministic local
   *     pattern paths re-emitting the same hook on regenerate).
   *   - soft-demote (`score.total - 8`) any candidate whose hook
   *     bigram-Jaccard against ANY excluded hook is >= 0.5
   *     (defends against trivial rephrases of the same idea —
   *     same threshold the existing skeleton-similarity guard
   *     uses, see `ideaScorer.hookBigramJaccard`).
   *
   * Optional / additive — when omitted or empty the filter is a
   * no-op and the orchestrator behaves identically to pre-UX3.
   * Capped at 20 by the route-layer Zod schema; we re-cap
   * defensively here too in case a future caller bypasses Zod.
   */
  excludeHooks?: string[];
  /**
   * Per-creator usage snapshot for the Llama cost-control / anti-abuse
   * gates inside `maybeMutateBatch`. Optional — when absent, no gate
   * fires (matches demo bypass). Counters are read by the route layer
   * BEFORE this call so the mutator and route logs share the same
   * snapshot.
   */
  usageContext?: MutationUsageContext;
  /**
   * Llama 3.2 Vision style-extraction document
   * (`creators.vision_style_json`). Optional — when absent or under
   * the per-video threshold the scoring stack behaves identically to
   * the pre-vision pipeline. When present and at-threshold, the
   * orchestrator parses it into `derivedStyleHints` once and threads
   * them into `filterAndRescore` (both local + fallback paths) so a
   * single soft +1 personalFit boost can fire when a candidate
   * matches the creator's vision-derived setting preference.
   */
  visionStyleJson?: unknown | null;
};

export type HybridIdeatorSource = "cache" | "pattern" | "fallback" | "mixed";

export type HybridIdeatorResult = {
  ideas: Idea[];
  source: HybridIdeatorSource;
  usedFallback: boolean;
  counts: {
    /** Local pattern candidates that survived scoring. */
    localKept: number;
    /** Claude-fallback candidates that survived scoring. */
    fallbackKept: number;
  };
  /**
   * PHASE Y7 — additive QA telemetry surfaced per shipped idea.
   * Mirrors the fields the served-log emits but exposed
   * structurally so QA harnesses (and only QA harnesses) can
   * assert anchor / voice / fingerprint diversity without
   * scraping logs. Strictly additive — production callers
   * (route layer, mobile app) ignore this field. Optional so
   * cache replay paths (which don't have per-candidate meta
   * available) can omit it.
   */
  qaTelemetry?: {
    perIdea: Array<{
      source: string;
      voiceClusterId?: string;
      scenarioFingerprint?: string;
      /** PHASE Y8 — captivating-hook score (0-100) the
       *  `coreCandidateGenerator` recipe loop wrote when collecting
       *  passing recipes; the highest-scoring recipe per core is
       *  the one that ships, so this is the WINNER's score. Only
       *  populated for `core_native` candidates. */
      hookQualityScore?: number;
      anchor?: string;
      premiseCoreId?: string;
      /** PHASE UX3.2 — domainId of the authored scenario plan the
       *  cohesive author rendered from. Present only when a
       *  `core_native` candidate hit the AUTHORED_SCENARIO_PLANS
       *  fast-path; absent for generic-template renders + all
       *  Llama / Claude wraps. */
      authoredPlanId?: string;
      /** PHASE N1-S — when set, identifies the `NIGERIAN_HOOK_PACK`
       *  entry id this `core_native` candidate was authored from
       *  (via `authorPackEntryAsIdea`, not `authorCohesiveIdea`).
       *  Surfaces here so the staging QA harness can verify
       *  per-cohort pack-usage rate without scraping logs. */
      nigerianPackEntryId?: string;
    }>;
    scenarioFingerprintsThisBatch: string[];
    coreNativeAnchorsUsed: string[];
    /**
     * PHASE D5-QA — additive surface for the reject-source telemetry
     * D4 already aggregates inside `coreCandidateGenerator`. Lets the
     * D5-QA harness (and only QA harnesses) read aggregate counts +
     * bounded sample tuples directly off the orchestrator result
     * instead of scraping the structured `phase_y5.core_native_generated`
     * log. Optional so the cache replay path (which doesn't run
     * core-native generation) can omit it. Production callers ignore
     * this field, same as the rest of `qaTelemetry`.
     */
    coreNative?: {
      antiCopyRejects: AntiCopyRejectsTelemetry;
    };
  };
};

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** UTC `YYYY-MM-DD` string — matches Postgres `date` text representation. */
function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Novelty-aware selector for the final batch.
 *
 * Replaces the prior 4-pass HARD diversifier with a greedy selector
 * that picks by `qualityScore + noveltyBonus + penalty`, then
 * validates HARD batch guards. The novelty bonus (0–5) only applies
 * to candidates with quality >= HIGH_QUALITY_SCORE (8) so a weak
 * idea cannot be rescued by being "different".
 *
 * Selection algorithm:
 *
 *   Step 1: Filter to high-tier (quality >= 8); fall back to the
 *           full scored pool when high-tier can't fill `count`.
 *   Step 2: Greedy — for each slot, score every remaining candidate
 *           with current penalties + novelty against already-picked,
 *           pick the highest adjustedScore.
 *   Step 3: Run hard batch guards on the result. If they fail AND
 *           count <= 5, exhaustively search top-(count*4) combinations
 *           for the best guard-passing batch (capped at C(20,5) work).
 *   Step 4: Return { batch, guardsPassed }. The orchestrator decides
 *           whether a guard failure should trigger Claude fallback.
 *
 * Hard batch guards (any failure → reselect, then signal fallback):
 *   - all 3 share hookStyle  →  fail
 *   - all 3 share structure  →  fail
 *   - more than 2 share scenarioFamily / visualAction / topicLane → fail
 *
 * For batches of size 1 or 2, the guards trivially pass (you can't
 * have "3 share X" with fewer than 3 picks).
 */
const HIGH_QUALITY_SCORE = 8;
const RESELECT_MAX_COUNT = 5;

/* ----------------------------------------------------------------- */
/* PHASE 6D DIAGNOSTIC INSTRUMENTATION — env-gated, REMOVABLE.       */
/*                                                                    */
/* (REMOVED in T005 cleanup — block kept as a marker comment so the   */
/* phase history is greppable. The diagnostic types, sink, and        */
/* per-pass snapshot tracker that lived between this block and        */
/* `RESELECT_TOP_MULTIPLIER` were stripped after Path F shipped.)     */
/* ----------------------------------------------------------------- */
/* HISTORICAL NOTES                                                   */
/*                                                                    */
/* Path C from the Phase 6D session-plan resolution: investigate why  */
/* certain premise executions (e.g. `relationship_framing` with 11    */
/* catalog entries, `delusion_admission` with 26) NEVER win selection */
/* slots in 3-6 of 8 sample QA runs. The premise gate is structurally */
/* blocked at 0.787 mean (target 0.85). Hypothesis: the highTier      */
/* filter at L884 (`scored.filter((c) => c.score.total >= 8)`) drops  */
/* premise candidates BEFORE the +4 selectionPenalty boost can fire — */
/* so a premise scoring 7 intrinsically never enters the pool the     */
/* greedy picker sees, even though a 7+4=11 adjusted would beat any   */
/* legacy-9 sitting in highTier.                                      */
/*                                                                    */
/* This sink captures, per call to `selectWithNovelty`, the top-N     */
/* candidates ranked by adjusted score (intrinsic + novelty +         */
/* penalty), with a `picked` + `inHighTier` flag so we can see        */
/* exactly which premise candidates would have won but were filtered  */
/* out vs. which entered the pool but lost on intrinsic score alone.  */
/* Empty-batch view (slot-0 perspective): novelty / penalty are       */
/* computed against `[]` so dynamic within-batch levers (-3 dup       */
/* style, etc.) don't pollute the diagnostic baseline.                */
/*                                                                    */
/* Path F (final): same-bucket within-batch dup penalty reduced       */
/* -3 → -1 in `selectionPenalty`. Same-style protection preserved by  */
/* the -8 fine-grained id penalty + the HARD `batchGuardsPass`        */
/* tuple-reject from 6C/6D-T004. 10-batch QA mean lifted 0.800 →     */
/* 0.840 with all HARD gates clean (0/0/200/200).                     */
/* ----------------------------------------------------------------- */
const RESELECT_TOP_MULTIPLIER = 4;

type SelectionResult = {
  batch: ScoredCandidate[];
  guardsPassed: boolean;
};

function adjustedScore(
  c: ScoredCandidate,
  batchSoFar: ScoredCandidate[],
  ctx: NoveltyContext,
): number {
  const novelty =
    c.score.total >= HIGH_QUALITY_SCORE
      ? scoreNovelty(c, batchSoFar, ctx)
      : 0;
  const penalty = selectionPenalty(c, batchSoFar, ctx);
  return c.score.total + novelty + penalty;
}

function greedySelect(
  pool: ScoredCandidate[],
  count: number,
  ctx: NoveltyContext,
): ScoredCandidate[] {
  const picked: ScoredCandidate[] = [];
  const pickedSet = new Set<ScoredCandidate>();
  while (picked.length < count) {
    let best: { c: ScoredCandidate; adj: number; baseIdx: number } | null = null;
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i];
      if (pickedSet.has(c)) continue;
      const adj = adjustedScore(c, picked, ctx);
      // Tie-break: prefer earlier sorted position (preserves the
      // filterAndRescore ordering: score → personalFit → hookImpact →
      // pattern_variation). Important so deterministic input → same output.
      if (
        best === null ||
        adj > best.adj ||
        (adj === best.adj && i < best.baseIdx)
      ) {
        best = { c, adj, baseIdx: i };
      }
    }
    if (!best) break;
    picked.push(best.c);
    pickedSet.add(best.c);
  }
  return picked;
}

export function batchGuardsPass(
  batch: ScoredCandidate[],
  /**
   * VOICE PROFILES spec — optional context for the 3-identical voice
   * hard reject. When `voiceStrongPreference === true`, the guard
   * BYPASSES the all-3-identical-voiceProfile rejection (the user
   * explicitly locked to that voice via tasteCalibration; forcing
   * a rotation would contradict their stated choice). Default
   * undefined ⇒ enforce the rotation guard normally for hints /
   * vision / default-rotation tiers. All other guards (opener,
   * setting, archetype, hookLanguageStyle, scriptType, etc.) are
   * unaffected by this flag — they enforce regardless.
   */
  ctx?: { voiceStrongPreference?: boolean },
): boolean {
  if (batch.length === 0) return false;

  // ---------------------------------------------------------------
  // HARD anti-clone guards — apply at every batch size >= 2. These
  // catch the QA failure modes that survived the soft-novelty
  // scorer (three picks that share opener/setting/filming language
  // and read like the same video filmed three times).
  // ---------------------------------------------------------------
  if (batch.length >= 2) {
    // (a) Hook opener — max 1 per batch. Without this, a batch can
    // pick three "I just realized…" / "I just realized…" / "I
    // just…" hooks even when hookStyle differs.
    const openers: HookOpener[] = [];
    for (const b of batch) {
      const op = b.meta.hookOpener ?? lookupHookOpener(b.idea.hook);
      if (op) openers.push(op);
    }
    if (countMax(openers) > 1) return false;

    // (b) Physical setting — max 1 per batch. Three kitchen scenes
    // read as one video filmed three ways.
    const settings = batch.map((b) => b.idea.setting as Setting);
    if (countMax(settings) > 1) return false;

    // (c) `howToFilm` byte-identical pairs — defense in depth for
    // the per-visualAction lookup. If two picks happen to share a
    // visualActionPattern (allowed up to 2 by the soft-2 guard
    // below), they MUST have non-identical filming language.
    const filmStrs = batch.map((b) => b.idea.howToFilm.trim());
    if (new Set(filmStrs).size !== filmStrs.length) return false;

    // (d) IDEA ARCHETYPE spec — max 1 archetype per batch. Blocks
    // two `ill_do_it_later` picks even when scenarioFamily / hook /
    // scriptType differ (e.g. "I'll clean tomorrow" + "I'll text
    // them tomorrow" = two distinct families but one archetype).
    // Skip when fields missing (legacy / fallback safety — counts
    // toward batch but doesn't trip the guard).
    const archetypes: Archetype[] = [];
    for (const b of batch) {
      if (b.meta.archetype) archetypes.push(b.meta.archetype);
    }
    if (countMax(archetypes) > 1) return false;

    // (e) IDEA ARCHETYPE spec — max 1 archetypeFamily per batch.
    // Stricter than (d): two distinct archetypes from the SAME
    // family (e.g. `ill_do_it_later` + `fake_productivity`, both
    // self_deception) still read as the same kind of idea. The
    // family guard catches that even when (d) lets them through.
    const archetypeFamilies: ArchetypeFamily[] = [];
    for (const b of batch) {
      if (b.meta.archetypeFamily) archetypeFamilies.push(b.meta.archetypeFamily);
    }
    if (countMax(archetypeFamilies) > 1) return false;

    // (f) SCENE-OBJECT TAG spec — max 1 sceneObjectTag per batch.
    // Two `coffee` or two `unread_messages` picks read as the same
    // physical scene shot twice even when the narrative differs.
    const sceneTags: SceneObjectTag[] = [];
    for (const b of batch) {
      if (b.meta.sceneObjectTag) sceneTags.push(b.meta.sceneObjectTag);
    }
    if (countMax(sceneTags) > 1) return false;

    // (g) SCENE-OBJECT TAG spec — max 1 sceneEnvCluster per batch.
    // Catches cluster collisions across distinct tags (e.g. `coffee`
    // + `fridge` are both kitchen-cluster — feels like one kitchen
    // morning split into two videos).
    const sceneClusters: SceneEnvCluster[] = [];
    for (const b of batch) {
      if (b.meta.sceneEnvCluster) sceneClusters.push(b.meta.sceneEnvCluster);
    }
    if (countMax(sceneClusters) > 1) return false;

    // (h) Phase 6C (PREMISE-FIRST SELECTION) — premiseStyleId HARD
    // reject. Stricter than the existing -8 within-batch demotion in
    // `selectionPenalty` (the soft signal): even with -8 there is a
    // tail case where greedy on a small or premise-saturated pool
    // picks the same fine-grained `premiseStyleId` twice (e.g. -8
    // vs no fresh-style alternative still ships, since -8 only
    // beats the alternative if a non-dup alternative exists at all).
    // Closes that case by rejecting the batch outright; the picker
    // re-runs in `exhaustiveReselect` over a wider candidate set,
    // which has many more shippable alternatives at the per-fine-
    // grained-id level (50 distinct ids vs 12 ideaCoreFamily / 8
    // hookIntent / etc., so the alternative-density is favorable).
    // Composes safely with (e)/(f)/(g) above — those guards reject
    // by topical/scene clustering; this one rejects by premise-
    // shape clustering, an orthogonal axis that they don't catch.
    // Skip when fields missing (legacy / fallback safety — entries
    // without a `premiseStyleId` count toward batch.length but don't
    // contribute to this guard, identical discipline to (d)/(e)/(f)).
    const premiseStyleIds: PremiseStyleId[] = [];
    for (const b of batch) {
      if (b.meta.premiseStyleId) premiseStyleIds.push(b.meta.premiseStyleId);
    }
    if (countMax(premiseStyleIds) > 1) return false;

    // (i) Phase 6D (PREMISE EXECUTION EXPANSION) — `(premiseStyleId,
    // executionId)` tuple HARD reject. Defense-in-depth on top of
    // (h) above: spec PART 5 explicitly states BOTH the per-style
    // HARD AND the per-tuple HARD as separate rules. Under (h) the
    // tuple guard is functionally redundant (no two entries can
    // share the same premiseStyleId so they can't share the same
    // tuple either), but if (h) is ever weakened or bypassed (e.g.
    // a future rescue-ship path that disables (h)) this guard
    // independently catches the (style, execution) repeat. Skip
    // when fields missing (legacy / fallback safety — entries
    // without both `premiseStyleId` AND `executionId` count toward
    // batch.length but don't contribute to this guard, identical
    // discipline to (d)/(e)/(f)/(h)).
    const tupleKeys: string[] = [];
    for (const b of batch) {
      if (b.meta.premiseStyleId && b.meta.executionId) {
        tupleKeys.push(`${b.meta.premiseStyleId}::${b.meta.executionId}`);
      }
    }
    if (countMax(tupleKeys) > 1) return false;
  }

  // Guards below only meaningful at >=3 picks — at 1 or 2 every
  // "max 2 per group" condition is vacuously satisfied.
  if (batch.length < 3) return true;

  // (h) HOOK INTENT spec (Phase 4) — HARD reject when ALL picks in
  // a batch of 3+ share the same hookIntent. Mirrors the -100
  // "soft" all-3-same penalty in selectionPenalty: that lever
  // prevents the GREEDY selector from ever PICKING the third clone
  // when an other-intent shippable exists in the candidate pool;
  // this final guard is defense-in-depth for the residual case
  // where the candidate pool collapses to a single effective intent
  // (e.g., severe picker fallback or pool starvation), leaving
  // greedy with no other-intent shippable. Without this guard the
  // -100 penalty becomes irrelevant in that case (-100 vs no
  // alternative still ships). Skip when fewer than batch.length
  // candidates contributed an intent (legacy / pre-Phase-4 cache
  // entries) — the guard is "all 3 confirmed same", not "all 3
  // missing intent". Spec: "no batch of 3 ships with all 3 sharing
  // the same hookIntent" — batches of 1-2 trivially can't trip,
  // already excluded by the early return above.
  const intents: HookIntent[] = [];
  for (const b of batch) {
    // `hookIntent` lives only on the pattern_variation variant of
    // CandidateMeta; the llama_3_1 / claude_fallback variants omit
    // it entirely (intent is a Phase 4 / pattern-pipeline-only
    // concept). Use a property check to narrow safely so fallback
    // wraps don't synthetically mark the batch as "intent missing".
    if ("hookIntent" in b.meta && b.meta.hookIntent) {
      intents.push(b.meta.hookIntent);
    }
  }
  if (intents.length === batch.length && new Set(intents).size === 1) {
    return false;
  }

  // Spec: "never 3× same hookStyle/format/structure, never >2
  // share family/visualAction/topic" — both clauses collapse to
  // a uniform "max 2 per group" rule for any batch size, so use
  // `> 2` everywhere. (Earlier draft used `>= batch.length` for
  // hookStyle/structure which let 3-of-a-kind through any
  // batch larger than 3.)
  const MAX_GROUP_SHARE = 2;
  // No 3-same hookStyle.
  if (countMax(batch.map((b) => b.idea.hookStyle)) > MAX_GROUP_SHARE) return false;
  // No 3-same format/pattern. Spec called this out explicitly
  // alongside hookStyle and structure; without it a batch of
  // three "stitch_redo" or three "voiceover" formats could ship.
  if (countMax(batch.map((b) => b.idea.pattern)) > MAX_GROUP_SHARE) return false;
  // Phase 5 (PATTERN MAPPING LAYER) — guard `h2`. No 3-same typed
  // VideoPattern. Parallel to the legacy `idea.pattern` guard above
  // but on the typed Phase-5 axis: `meta.videoPattern` is the
  // controller axis ABOVE the legacy `idea.pattern` string, so a
  // 3-of-same batch reads as one filming approach repeated even when
  // the legacy `idea.pattern` field varies. Filtered to defined
  // values so candidates without the field (Llama / Claude fallback
  // wraps + pre-Phase-5 cache reads) silently abstain — the guard
  // never fires against absences. Same MAX_GROUP_SHARE = 2 cap.
  const videoPatternsInBatch = batch
    .map((b): VideoPattern | undefined =>
      "videoPattern" in b.meta ? b.meta.videoPattern : undefined,
    )
    .filter((v): v is VideoPattern => v !== undefined);
  if (
    videoPatternsInBatch.length > 0 &&
    countMax(videoPatternsInBatch) > MAX_GROUP_SHARE
  ) {
    return false;
  }
  // No 3-same structure.
  if (countMax(batch.map((b) => b.idea.structure)) > MAX_GROUP_SHARE) return false;
  // No more than 2 share family.
  if (
    countMax(
      batch
        .map((b) => b.meta.scenarioFamily)
        .filter((x): x is string => !!x),
    ) > MAX_GROUP_SHARE
  ) {
    return false;
  }
  // No more than 2 share visualActionPattern.
  if (
    countMax(
      batch
        .map((b) => b.meta.visualActionPattern)
        .filter((x): x is VisualActionPattern => !!x),
    ) > MAX_GROUP_SHARE
  ) {
    return false;
  }
  // No more than 2 share topicLane.
  if (
    countMax(
      batch
        .map((b) => b.meta.topicLane)
        .filter((x): x is TopicLane => !!x),
    ) > MAX_GROUP_SHARE
  ) {
    return false;
  }
  // HOOK STYLE spec — HARD reject only the all-3-identical worst case.
  // Softer than the archetype max-1 rule (per spec): 2-of-same is
  // allowed (the soft -2 within-batch penalty in selectionPenalty
  // discourages it without rejecting the whole batch). Skip when
  // fields missing on legacy / fallback entries — they neither
  // contribute to the count nor block the guard.
  const langStyles: HookLanguageStyle[] = [];
  for (const b of batch) {
    if (b.meta.hookLanguageStyle) langStyles.push(b.meta.hookLanguageStyle);
  }
  if (
    langStyles.length === batch.length &&
    new Set(langStyles).size === 1
  ) {
    return false;
  }
  // VOICE PROFILES spec — HARD reject only the all-3-identical worst
  // case, AND only when the creator's primary voice did NOT come
  // from explicit calibration. A creator who locked their preferred
  // tone via tasteCalibration deserves three picks in that voice
  // rather than a forced rotation; the spec carves this out as the
  // "user strongly prefers" exception. For hints / vision / default-
  // rotation tiers (`voiceStrongPreference !== true`), 3-of-same
  // is rejected — the soft within-batch -2 in selectionPenalty
  // discourages 2-of-same without rejecting the whole batch. Skip
  // when fields missing on legacy / fallback entries — same
  // discipline as the hookLanguageStyle / archetype guards above.
  if (!ctx?.voiceStrongPreference) {
    const voiceProfiles: VoiceProfile[] = [];
    for (const b of batch) {
      if (b.meta.voiceProfile) voiceProfiles.push(b.meta.voiceProfile);
    }
    if (
      voiceProfiles.length === batch.length &&
      new Set(voiceProfiles).size === 1
    ) {
      return false;
    }
  }
  // Phase 1 — IDEA CORE FAMILY / TYPE HARD GUARDS. REPLACES the prior
  // scriptType ≤2-share + SCRIPT_TYPE_CLUSTERS all-in-one-cluster
  // checks (both went inert with the scriptType axis). The new
  // guards operate on the 12-family / 120-type ideaCore axis the
  // selector now uses for scoring + penalties.
  //
  //   1. ≤ 2 share ideaCoreFamily          (parallel to family / topic)
  //   2. ≤ 1 share ideaCoreType            (stricter — 120-value axis,
  //                                          a single collision already
  //                                          feels like a clone)
  //   3. failure_contradiction count       (the "I planned X → I failed"
  //      < 0.4 * batch.length               loop the spec calls out as
  //                                          the dominant failure mode.
  //                                          Comparator is STRICT `< 40%`
  //                                          (i.e. `>= 0.4 → reject`), so
  //                                          allowed maxima are: N=3 → ≤1,
  //                                          N=4 → ≤1, N=5 → ≤1 (2/5 = 0.4
  //                                          which trips the floor),
  //                                          N=6 → ≤2 (2/6 ≈ 0.333). If
  //                                          inclusive ≤40% is later
  //                                          desired, switch the comparator
  //                                          to `> 0.4`.)
  //
  // All three guards skip when the relevant fields are missing on
  // legacy / fallback entries — same omit-safe discipline as the
  // archetype / hookLanguageStyle / voiceProfile guards above.
  const coreFamilies = batch
    .map((b) => b.meta.ideaCoreFamily)
    .filter((x): x is IdeaCoreFamily => !!x);
  if (coreFamilies.length > 0 && countMax(coreFamilies) > MAX_GROUP_SHARE) {
    return false;
  }
  const coreTypes = batch
    .map((b) => b.meta.ideaCoreType)
    .filter((x): x is IdeaCoreType => !!x);
  if (coreTypes.length > 0 && countMax(coreTypes) > 1) {
    return false;
  }
  if (coreFamilies.length === batch.length) {
    let failCount = 0;
    for (const f of coreFamilies) {
      if (f === "failure_contradiction") failCount += 1;
    }
    if (failCount / batch.length >= 0.4) return false;
  }
  // Reject batch where ALL picks are low-energy (passive sit-and-stare
  // beats — phone_scroll_freeze, text_message_panic, face_reaction_-
  // deadpan). Spec: "all are low-energy reaction loops". Same omit-
  // safe gate as the cluster check above.
  const energies = batch
    .map((b) => b.meta.energy)
    .filter((x): x is Energy => !!x);
  if (
    energies.length === batch.length &&
    energies.every((e) => e === "low")
  ) {
    return false;
  }
  return true;
}

function countMax<T>(arr: T[]): number {
  if (arr.length === 0) return 0;
  const m = new Map<T, number>();
  let max = 0;
  for (const x of arr) {
    const v = (m.get(x) ?? 0) + 1;
    m.set(x, v);
    if (v > max) max = v;
  }
  return max;
}

/**
 * Exhaustive guard-passing search over the top-(count*4) candidates.
 * Returns the highest-adjustedScore-sum batch that passes guards, or
 * `null` if no combination passes. Capped at count <= 5 because
 * C(20,5) = 15,504 is an acceptable worst case but C(40,10) is not.
 */
function exhaustiveReselect(
  pool: ScoredCandidate[],
  count: number,
  ctx: NoveltyContext,
  /**
   * Optional additional acceptance predicate, applied after the
   * standard `batchGuardsPass` gate. Used by the regen-fresh-
   * scriptType rescue path to require ≥1 fresh scriptType vs the
   * immediate-prior batch on top of normal guards. Default is no-op.
   */
  extraGuard?: (batch: ScoredCandidate[]) => boolean,
): ScoredCandidate[] | null {
  if (count > RESELECT_MAX_COUNT) return null;
  const top = pool.slice(
    0,
    Math.min(pool.length, count * RESELECT_TOP_MULTIPLIER),
  );
  if (top.length < count) return null;

  // Wrap in an object so the recursive closure mutates a property
  // rather than reassigning a `let` (which trips TypeScript's
  // control-flow narrowing into `never` at the post-recursion read).
  const bestRef: { value: { batch: ScoredCandidate[]; total: number } | null } = {
    value: null,
  };

  const indices: number[] = new Array(count).fill(0);
  function recurse(slot: number, start: number): void {
    if (slot === count) {
      const batch = indices.map((i) => top[i]);
      if (!batchGuardsPass(batch, { voiceStrongPreference: ctx.voiceStrongPreference })) return;
      if (extraGuard && !extraGuard(batch)) return;
      let total = 0;
      const partial: ScoredCandidate[] = [];
      for (const c of batch) {
        total += adjustedScore(c, partial, ctx);
        partial.push(c);
      }
      if (bestRef.value === null || total > bestRef.value.total) {
        bestRef.value = { batch: batch.slice(), total };
      }
      return;
    }
    for (let i = start; i <= top.length - (count - slot); i++) {
      indices[slot] = i;
      recurse(slot + 1, i + 1);
    }
  }
  recurse(0, 0);

  return bestRef.value ? bestRef.value.batch : null;
}

/**
 * @deprecated Phase 1 — scriptType axis is INERT. Kept exported in case
 * legacy callers / tests still reference it; selectWithNovelty no longer
 * uses it. Replaced by `countNewIdeaCoreFamilies` below.
 */
export function countNewScriptTypes(
  batch: ScoredCandidate[],
  recent: ReadonlySet<ScriptType> | undefined,
): number {
  const seen = new Set<ScriptType>();
  for (const c of batch) {
    const st = c.meta.scriptType;
    if (!st) continue;
    if (recent && recent.size > 0 && recent.has(st)) continue;
    seen.add(st);
  }
  return seen.size;
}

/**
 * Count distinct fresh IdeaCoreFamilies in `batch` — i.e. families
 * present in `batch` but absent from `recent`. Phase 1 replacement
 * for `countNewScriptTypes`. Drives the regen HARD `≥2 NEW families`
 * rescue in `selectWithNovelty`. Picks without an ideaCoreFamily
 * (legacy / fallback) don't count as fresh. When `recent` is empty /
 * undefined, every distinct family in the batch is treated as fresh
 * (no prior batch → any pick is novel).
 */
export function countNewIdeaCoreFamilies(
  batch: ScoredCandidate[],
  recent: ReadonlySet<IdeaCoreFamily> | undefined,
): number {
  const seen = new Set<IdeaCoreFamily>();
  for (const c of batch) {
    const f = c.meta.ideaCoreFamily;
    if (!f) continue;
    if (recent && recent.size > 0 && recent.has(f)) continue;
    seen.add(f);
  }
  return seen.size;
}

/**
 * Phase 6D — Path B: count distinct fresh DIVERSITY TOKENS in `batch`,
 * where a token is either a fresh `ideaCoreFamily` (not in
 * `recentFamilies`) OR a fresh `premiseStyleId` (not in
 * `recentPremiseStyleIds`). Tokens are union-counted in a single Set
 * keyed by axis prefix, so a candidate carrying both a fresh family
 * AND a fresh premise-style contributes to BOTH axes (max one entry
 * each per distinct value across the batch). Drives the Phase 1
 * `≥2 NEW diversity tokens` rescue invariant in `selectWithNovelty`,
 * superseding the family-only count.
 *
 * Rationale: PremiseStyle is a legitimate diversity axis introduced
 * by Phase 6/6D — two batches with overlapping `ideaCoreFamily` but
 * distinct `premiseStyleId` values (e.g. yesterday: "burnout_betrayal"
 * + "self_destruction_speedrun" both in `expectation_collapse` family;
 * today: "whiplash_wisdom" + "pattern_exposure" same family) are
 * stylistically distinct and should NOT trip the cross-batch
 * fresh-families HARD floor. Without this, the rescue forces legacy
 * substitutions whenever the premise pool's family distribution
 * concentrates, capping premise-share at ~0.78 (see Phase 6D T005
 * diagnostic /tmp/qa6d_diag4.json). Legacy / fallback picks lacking
 * BOTH axis values still don't contribute (preserves the original
 * intent: a batch of pure-legacy carryover from yesterday counts as 0
 * fresh tokens regardless of how many candidates it has).
 */
export function countFreshDiversityTokens(
  batch: ScoredCandidate[],
  recentFamilies: ReadonlySet<IdeaCoreFamily> | undefined,
  recentPremiseStyleIds: ReadonlySet<string> | undefined,
): number {
  const seen = new Set<string>();
  for (const c of batch) {
    const f = c.meta.ideaCoreFamily;
    if (
      f &&
      !(recentFamilies && recentFamilies.size > 0 && recentFamilies.has(f))
    ) {
      seen.add(`fam:${f}`);
    }
    const p = c.meta.premiseStyleId;
    if (
      p &&
      !(
        recentPremiseStyleIds &&
        recentPremiseStyleIds.size > 0 &&
        recentPremiseStyleIds.has(p)
      )
    ) {
      seen.add(`pstyle:${p}`);
    }
  }
  return seen.size;
}

/**
 * True when at least one pick in `batch` carries `meta.energy ===
 * "active"`. Used by the script-system FINAL spec §7 soft "≥1 active"
 * preference. Picks without an energy field don't count as active.
 */
export function batchHasActive(batch: ScoredCandidate[]): boolean {
  return batch.some((c) => c.meta.energy === "active");
}

/**
 * Count distinct fresh archetypeFamilies in `batch` — i.e. families
 * present in `batch` but absent from `recent`. IDEA ARCHETYPE spec
 * regen-rescue helper. Picks without an archetypeFamily (legacy /
 * fallback) don't count as fresh. Vacuously every-distinct when
 * `recent` is empty / undefined.
 */
export function countNewArchetypeFamilies(
  batch: ScoredCandidate[],
  recent: ReadonlySet<ArchetypeFamily> | undefined,
): number {
  const seen = new Set<ArchetypeFamily>();
  for (const c of batch) {
    const f = c.meta.archetypeFamily;
    if (!f) continue;
    if (recent && recent.size > 0 && recent.has(f)) continue;
    seen.add(f);
  }
  return seen.size;
}

/**
 * Predicate for the regen-fresh-archetypeFamily rescue: at least one
 * pick carries an archetypeFamily NOT in `recent`. Vacuously true
 * when `recent` is empty / undefined. Picks without a family are
 * skipped (neither prove freshness nor block the predicate firing
 * for some other pick).
 */
export function batchHasNewArchetypeFamily(
  batch: ScoredCandidate[],
  recent: ReadonlySet<ArchetypeFamily> | undefined,
): boolean {
  if (!recent || recent.size === 0) return true;
  for (const c of batch) {
    const f = c.meta.archetypeFamily;
    if (f && !recent.has(f)) return true;
  }
  return false;
}

/**
 * Count distinct fresh sceneObjectTags in `batch` — i.e. tags present
 * in `batch` but absent from `recent`. SCENE-OBJECT TAG spec regen-
 * rescue helper.
 */
export function countNewSceneObjectTags(
  batch: ScoredCandidate[],
  recent: ReadonlySet<SceneObjectTag> | undefined,
): number {
  const seen = new Set<SceneObjectTag>();
  for (const c of batch) {
    const t = c.meta.sceneObjectTag;
    if (!t) continue;
    if (recent && recent.size > 0 && recent.has(t)) continue;
    seen.add(t);
  }
  return seen.size;
}

/**
 * Predicate for the regen-fresh-sceneObjectTag rescue: at least one
 * pick carries a sceneObjectTag NOT in `recent`. Same vacuously-true
 * + skip-missing-fields discipline as the archetype variant above.
 */
export function batchHasNewSceneObjectTag(
  batch: ScoredCandidate[],
  recent: ReadonlySet<SceneObjectTag> | undefined,
): boolean {
  if (!recent || recent.size === 0) return true;
  for (const c of batch) {
    const t = c.meta.sceneObjectTag;
    if (t && !recent.has(t)) return true;
  }
  return false;
}

/**
 * Count distinct fresh hookLanguageStyles in `batch` — i.e. styles
 * present in `batch` but absent from `recent`. HOOK STYLE spec
 * regen-rescue helper. Skips picks without the field (legacy /
 * fallback) so a partially-tagged batch still contributes its
 * tagged picks to the count.
 */
export function countNewHookLanguageStyles(
  batch: ScoredCandidate[],
  recent: ReadonlySet<HookLanguageStyle> | undefined,
): number {
  const seen = new Set<HookLanguageStyle>();
  for (const c of batch) {
    const hls = c.meta.hookLanguageStyle;
    if (!hls) continue;
    if (recent && recent.size > 0 && recent.has(hls)) continue;
    seen.add(hls);
  }
  return seen.size;
}

/**
 * Predicate for the regen-fresh-hookLanguageStyle rescue: at least
 * one pick carries a hookLanguageStyle NOT in `recent`. Same
 * vacuously-true + skip-missing-fields discipline as the
 * sceneObjectTag variant above.
 */
export function batchHasNewHookLanguageStyle(
  batch: ScoredCandidate[],
  recent: ReadonlySet<HookLanguageStyle> | undefined,
): boolean {
  if (!recent || recent.size === 0) return true;
  for (const c of batch) {
    const hls = c.meta.hookLanguageStyle;
    if (hls && !recent.has(hls)) return true;
  }
  return false;
}

/**
 * Count distinct fresh voiceProfiles in `batch` — i.e. voices present
 * in `batch` but absent from `recent`. VOICE PROFILES spec regen-
 * rescue helper. Picks without a voiceProfile (Llama / Claude
 * fallback wraps may omit) don't count as fresh. Vacuously every-
 * distinct when `recent` is empty / undefined (no prior batch ⇒
 * any pick is novel).
 */
export function countNewVoiceProfiles(
  batch: ScoredCandidate[],
  recent: ReadonlySet<VoiceProfile> | undefined,
): number {
  const seen = new Set<VoiceProfile>();
  for (const c of batch) {
    const vp = c.meta.voiceProfile;
    if (!vp) continue;
    if (recent && recent.size > 0 && recent.has(vp)) continue;
    seen.add(vp);
  }
  return seen.size;
}

/**
 * Predicate for the regen-fresh-voiceProfile rescue: at least one
 * pick carries a voiceProfile NOT in `recent`. Same vacuously-true
 * + skip-missing-fields discipline as the hookLanguageStyle variant
 * above. Sized as a "≥1 fresh" minimum (not a count) — the harder
 * "prefer 2-3 distinct voices per batch" goal lives in the soft
 * within-batch -2 penalty in `selectionPenalty`, not here, because
 * the voice catalog is only 8 values and a creator's allowed-set
 * is typically 3-4 (so a strict 2-fresh hard rescue would starve
 * on narrow allowed-sets where the prior batch covered 2-3 of them).
 */
export function batchHasNewVoiceProfile(
  batch: ScoredCandidate[],
  recent: ReadonlySet<VoiceProfile> | undefined,
): boolean {
  if (!recent || recent.size === 0) return true;
  for (const c of batch) {
    const vp = c.meta.voiceProfile;
    if (vp && !recent.has(vp)) return true;
  }
  return false;
}

// Phase 6D Path B+: PremiseStyle is now a primary diversity axis. The
// four downstream cross-batch rescues (archetype / sceneTag / hookLang /
// voice) all gate on a single axis. Per the unified-token principle from
// Path B, a batch with a fresh premiseStyleId IS stylistically diverse
// — the rescue should pass even if the axis-of-record token repeats.
// This helper mirrors the four batchHas* signatures above so the cascade
// rescues can compose `axisHasNew(b) || batchHasNewPremiseStyleId(b, ...)`
// in a single uniform pattern.
export function batchHasNewPremiseStyleId(
  batch: ScoredCandidate[],
  recent: ReadonlySet<string> | undefined,
): boolean {
  if (!recent || recent.size === 0) return true;
  for (const c of batch) {
    const ps = c.meta.premiseStyleId;
    if (ps && !recent.has(ps)) return true;
  }
  return false;
}

/**
 * @deprecated Phase 1 — scriptType axis is INERT. Kept private and
 * unreferenced; selectWithNovelty no longer composes a scriptType
 * freshness extraGuard. The active rescue uses `countNewIdeaCoreFamilies`
 * directly.
 */
function batchHasNewScriptType(
  batch: ScoredCandidate[],
  recent: ReadonlySet<ScriptType> | undefined,
): boolean {
  if (!recent || recent.size === 0) return true;
  for (const c of batch) {
    const st = c.meta.scriptType;
    if (st && !recent.has(st)) return true;
  }
  return false;
}

export function selectWithNovelty(
  scored: ScoredCandidate[],
  count: number,
  ctx: NoveltyContext,
  opts: { regenerate?: boolean } = {},
): SelectionResult {
  if (scored.length === 0 || count <= 0) {
    return { batch: [], guardsPassed: false };
  }
  const highTier = scored.filter((c) => c.score.total >= HIGH_QUALITY_SCORE);
  const pool = highTier.length >= count ? highTier : scored;

  const greedy = greedySelect(pool, count, ctx);
  let chosen: ScoredCandidate[] | null = null;
  const greedyGuardsPass = batchGuardsPass(greedy, {
    voiceStrongPreference: ctx.voiceStrongPreference,
  });
  if (greedyGuardsPass) {
    chosen = greedy;
  } else {
    // Greedy violated guards — try exhaustive search over top candidates.
    //
    // Phase 6D Path D (extension to guards_reselect): apply the same
    // premise-aware tiered reselect used by the active_energy rescue
    // below. When greedy fails non-freshness guards (e.g.
    // allLowEnergy, narrative-shape, voice-strong-preference), the
    // reselect should prefer a guards-passing combo that retains AT
    // LEAST as many premise candidates as greedy had — otherwise the
    // reselect silently swaps in LEG candidates whenever they happen
    // to satisfy guards (empirically the dominant non-freshness LEG
    // source post Path-B+ / Path-C; see /tmp/qa6d_pathCD10.json
    // batches 4/5/6). Tier 2 fallback preserves the original
    // "any guards-passing combo" semantics so we never lose the
    // underlying invariant on creators whose pool genuinely cannot
    // supply a premise-preserving guards-passing combo.
    const greedyPremiseCount = greedy.filter(
      (c) => c.meta.usedBigPremise === true,
    ).length;
    let reselected =
      greedyPremiseCount > 0
        ? exhaustiveReselect(
            pool,
            count,
            ctx,
            (b) =>
              b.filter((c) => c.meta.usedBigPremise === true).length >=
              greedyPremiseCount,
          )
        : null;
    if (!reselected) {
      reselected = exhaustiveReselect(pool, count, ctx);
    }
    if (reselected) chosen = reselected;
  }
  // Phase 1 — IDEA CORE FAMILY HARD regen rescue. REPLACES the prior
  // scriptType rescue. When regenerating, the picked batch MUST
  // introduce at least 2 IdeaCoreFamilies that weren't in the
  // immediate-prior batch (the "≥2 NEW families" rule from the spec —
  // stricter than the prior ≥1 fresh because the family axis only
  // has 12 values, so requiring 2 fresh per regen is what actually
  // breaks the "I planned X → I failed × 3" loop). The standard
  // guards already cap per-axis sharing + the failure-cluster floor,
  // but they DON'T require cross-batch novelty — a perfectly guard-
  // clean pick can still be 100% same-family-as-yesterday if the pool
  // is dominated by it. Run one more exhaustive pass; if it's
  // impossible (small pool genuinely lacks 2 fresh families), ship
  // best-effort with a warn log so the rut is visible in telemetry.
  // Phase 6D — Path B: replace the family-only freshness count with
  // `countFreshDiversityTokens`, which unions fresh `ideaCoreFamily`
  // values AND fresh `premiseStyleId` values into a single token set.
  // PremiseStyle is a stylistic diversity axis introduced by Phase
  // 6/6D — two batches with overlapping families but distinct premise
  // styles ARE diverse and should not trip the HARD ≥2 floor. Trigger
  // condition unchanged in shape: still fires whenever the rescue's
  // upstream signal (`recentIdeaCoreFamilies` populated) indicates
  // we're past the cold-start; we now also consult premise-style
  // freshness so that pure-premise batches with concentrated families
  // but distinct styles satisfy the floor without legacy substitution
  // (lifts premise-share past the structural ~0.78 cap — see Phase
  // 6D T005 diagnostic /tmp/qa6d_diag4.json batch 8). The diversity
  // INTENT (≥2 fresh tokens) is preserved; only the token vocabulary
  // is widened to recognize the premise-style axis.
  if (
    opts.regenerate &&
    chosen &&
    (ctx.recentIdeaCoreFamilies?.size ?? 0) > 0 &&
    countFreshDiversityTokens(
      chosen,
      ctx.recentIdeaCoreFamilies,
      ctx.recentPremiseStyleIds,
    ) < 2
  ) {
    const fresh = exhaustiveReselect(
      pool,
      count,
      ctx,
      (b) =>
        countFreshDiversityTokens(
          b,
          ctx.recentIdeaCoreFamilies,
          ctx.recentPremiseStyleIds,
        ) >= 2,
    );
    if (fresh) {
      chosen = fresh;
    } else {
      logger.warn(
        {
          recentIdeaCoreFamilies: Array.from(
            ctx.recentIdeaCoreFamilies ?? [],
          ),
          recentPremiseStyleIds: Array.from(
            ctx.recentPremiseStyleIds ?? [],
          ),
          poolSize: pool.length,
          count,
        },
        "hybrid_ideator.regen_lt_two_fresh_diversity_tokens_shipping_best_effort",
      );
    }
  }
  // CASCADE SNAPSHOT DISCIPLINE — the four rescue passes below
  // (archetype / sceneObjectTag / hookLanguageStyle / voiceProfile)
  // each compose their own +≥1-fresh invariant with whatever prior
  // axes ALREADY achieved on `chosen`. Two snapshot rules:
  //
  //   (a) ideaCoreFamily — snapshot the COUNT of fresh families on
  //       `chosen` as the floor; require `b` to match or exceed it.
  //       This means: if the Phase 1 hard rescue achieved 2 fresh
  //       families, every later pass preserves that 2; if the pool
  //       only allowed 1 (best-effort ship), later passes only
  //       require ≥1 so they can still improve scene/HLS/voice
  //       freshness without re-tripping the impossible-to-satisfy
  //       ≥2 floor.
  //   (b) archetype / sceneObjectTag / hookLanguageStyle — snapshot
  //       the BOOLEAN achievement of `chosen` on each axis; only
  //       require it of `b` when `chosen` already had it. Prevents
  //       a later pass from being blocked by a prior axis's
  //       impossible-to-satisfy invariant (e.g. archetype rescue
  //       failed → don't require fresh archetype in the
  //       sceneObjectTag pass — would block a real scene-tag win).
  //
  // Both rules mirror the active-energy pass's snapshot logic
  // (lines below) so the whole cascade has consistent
  // "preserve-achieved" semantics instead of mixed
  // absolute-required + preserve-achieved predicates.
  // Phase 6D — Path B: snapshot helper now mirrors the Phase 1
  // rescue's widened token vocabulary so downstream cascade rescues
  // (archetype / sceneTag / hookLang / voice) preserve the SAME
  // unified-token achieved-floor as the Phase 1 pass produced.
  // Without this widening the cascade would re-tighten to
  // family-only and immediately undo the Path B lift on the very
  // next pass. Retains the cold-start abstain (return 0 when no
  // recent batches exist).
  function freshFamiliesAchieved(b: ScoredCandidate[]): number {
    return (ctx.recentIdeaCoreFamilies?.size ?? 0) === 0
      ? 0
      : countFreshDiversityTokens(
          b,
          ctx.recentIdeaCoreFamilies,
          ctx.recentPremiseStyleIds,
        );
  }
  function archetypeAchieved(b: ScoredCandidate[]): boolean {
    return (
      (ctx.recentArchetypeFamilies?.size ?? 0) === 0 ||
      batchHasNewArchetypeFamily(b, ctx.recentArchetypeFamilies) ||
      // Phase 6D Path B+: a fresh premiseStyleId satisfies the
      // archetype-axis "achieved" predicate via unified-token logic
      // (PremiseStyle is now a primary diversity axis). Composing
      // rescues see this as already-achieved and won't re-impose the
      // axis predicate on the reselect pool.
      batchHasNewPremiseStyleId(b, ctx.recentPremiseStyleIds)
    );
  }
  function sceneTagAchieved(b: ScoredCandidate[]): boolean {
    return (
      (ctx.recentSceneObjectTags?.size ?? 0) === 0 ||
      batchHasNewSceneObjectTag(b, ctx.recentSceneObjectTags) ||
      // Phase 6D Path B+ — see archetypeAchieved comment.
      batchHasNewPremiseStyleId(b, ctx.recentPremiseStyleIds)
    );
  }
  function hookLangAchieved(b: ScoredCandidate[]): boolean {
    return (
      (ctx.recentHookLanguageStyles?.size ?? 0) === 0 ||
      batchHasNewHookLanguageStyle(b, ctx.recentHookLanguageStyles) ||
      // Phase 6D Path B+ — see archetypeAchieved comment.
      batchHasNewPremiseStyleId(b, ctx.recentPremiseStyleIds)
    );
  }

  // IDEA ARCHETYPE spec rescue: when regenerating, the picked batch
  // MUST introduce at least one archetypeFamily that wasn't in the
  // immediate-prior batch. Composes with the Phase 1 ideaCoreFamily
  // invariant via the achieved-count snapshot (rule a above).
  if (
    opts.regenerate &&
    chosen &&
    (ctx.recentArchetypeFamilies?.size ?? 0) > 0 &&
    !batchHasNewArchetypeFamily(chosen, ctx.recentArchetypeFamilies) &&
    // Phase 6D Path B+: skip the rescue when the chosen batch already
    // carries a fresh premiseStyleId — unified-token logic treats that
    // as sufficient cross-batch diversity even if archetypeFamily
    // tokens repeat.
    !batchHasNewPremiseStyleId(chosen, ctx.recentPremiseStyleIds)
  ) {
    const minFresh = freshFamiliesAchieved(chosen);
    const fresh = exhaustiveReselect(
      pool,
      count,
      ctx,
      (b) =>
        // Phase 6D Path B+: accept reselects that introduce EITHER a
        // fresh archetypeFamily OR a fresh premiseStyleId. Same
        // unified-token vocabulary as the rescue's trigger condition.
        (batchHasNewArchetypeFamily(b, ctx.recentArchetypeFamilies) ||
          batchHasNewPremiseStyleId(b, ctx.recentPremiseStyleIds)) &&
        freshFamiliesAchieved(b) >= minFresh,
    );
    if (fresh) {
      chosen = fresh;
    } else {
      logger.warn(
        {
          recentArchetypeFamilies: Array.from(
            ctx.recentArchetypeFamilies ?? [],
          ),
          poolSize: pool.length,
          count,
        },
        "hybrid_ideator.regen_no_new_archetype_family_shipping_best_effort",
      );
    }
  }
  // SCENE-OBJECT TAG spec rescue: when regenerating, the picked batch
  // MUST introduce at least one sceneObjectTag that wasn't in the
  // immediate-prior batch. ExtraGuard composes via the snapshot
  // pattern — only preserves prior achievements, not absolute
  // invariants (rules a + b above).
  if (
    opts.regenerate &&
    chosen &&
    (ctx.recentSceneObjectTags?.size ?? 0) > 0 &&
    !batchHasNewSceneObjectTag(chosen, ctx.recentSceneObjectTags) &&
    // Phase 6D Path B+ — see archetype rescue above for rationale.
    !batchHasNewPremiseStyleId(chosen, ctx.recentPremiseStyleIds)
  ) {
    const minFresh = freshFamiliesAchieved(chosen);
    const requireArchetype = archetypeAchieved(chosen);
    const fresh = exhaustiveReselect(
      pool,
      count,
      ctx,
      (b) =>
        // Phase 6D Path B+: unified-token reselect predicate.
        (batchHasNewSceneObjectTag(b, ctx.recentSceneObjectTags) ||
          batchHasNewPremiseStyleId(b, ctx.recentPremiseStyleIds)) &&
        freshFamiliesAchieved(b) >= minFresh &&
        (!requireArchetype || archetypeAchieved(b)),
    );
    if (fresh) {
      chosen = fresh;
    } else {
      logger.warn(
        {
          recentSceneObjectTags: Array.from(ctx.recentSceneObjectTags ?? []),
          poolSize: pool.length,
          count,
        },
        "hybrid_ideator.regen_no_new_scene_object_tag_shipping_best_effort",
      );
    }
  }
  // HOOK STYLE spec rescue: when regenerating, the picked batch MUST
  // introduce at least one hookLanguageStyle that wasn't in the
  // immediate-prior batch. ExtraGuard composes via the snapshot
  // pattern (rules a + b above).
  if (
    opts.regenerate &&
    chosen &&
    (ctx.recentHookLanguageStyles?.size ?? 0) > 0 &&
    !batchHasNewHookLanguageStyle(chosen, ctx.recentHookLanguageStyles) &&
    // Phase 6D Path B+ — see archetype rescue above for rationale.
    !batchHasNewPremiseStyleId(chosen, ctx.recentPremiseStyleIds)
  ) {
    const minFresh = freshFamiliesAchieved(chosen);
    const requireArchetype = archetypeAchieved(chosen);
    const requireSceneTag = sceneTagAchieved(chosen);
    const fresh = exhaustiveReselect(
      pool,
      count,
      ctx,
      (b) =>
        // Phase 6D Path B+: unified-token reselect predicate.
        (batchHasNewHookLanguageStyle(b, ctx.recentHookLanguageStyles) ||
          batchHasNewPremiseStyleId(b, ctx.recentPremiseStyleIds)) &&
        freshFamiliesAchieved(b) >= minFresh &&
        (!requireArchetype || archetypeAchieved(b)) &&
        (!requireSceneTag || sceneTagAchieved(b)),
    );
    if (fresh) {
      chosen = fresh;
    } else {
      logger.warn(
        {
          recentHookLanguageStyles: Array.from(
            ctx.recentHookLanguageStyles ?? [],
          ),
          poolSize: pool.length,
          count,
        },
        "hybrid_ideator.regen_no_new_hook_language_style_shipping_best_effort",
      );
    }
  }
  // VOICE PROFILES spec rescue: when regenerating, the picked batch
  // MUST introduce at least one voiceProfile that wasn't in the
  // immediate-prior batch. ExtraGuard composes via the snapshot
  // pattern (rules a + b above) with all four prior axes. Same
  // warn-and-ship-best-effort discipline. Sized as "≥1 fresh"
  // because the voice catalog is only 8 values and a creator's
  // allowed-set is typically 3-4 — a stricter rescue would starve
  // on narrow calibration sets.
  if (
    opts.regenerate &&
    chosen &&
    (ctx.recentVoiceProfiles?.size ?? 0) > 0 &&
    !batchHasNewVoiceProfile(chosen, ctx.recentVoiceProfiles) &&
    // Phase 6D Path B+ — see archetype rescue above for rationale.
    !batchHasNewPremiseStyleId(chosen, ctx.recentPremiseStyleIds)
  ) {
    const minFresh = freshFamiliesAchieved(chosen);
    const requireArchetype = archetypeAchieved(chosen);
    const requireSceneTag = sceneTagAchieved(chosen);
    const requireHookLang = hookLangAchieved(chosen);
    const fresh = exhaustiveReselect(
      pool,
      count,
      ctx,
      (b) =>
        // Phase 6D Path B+: unified-token reselect predicate.
        (batchHasNewVoiceProfile(b, ctx.recentVoiceProfiles) ||
          batchHasNewPremiseStyleId(b, ctx.recentPremiseStyleIds)) &&
        freshFamiliesAchieved(b) >= minFresh &&
        (!requireArchetype || archetypeAchieved(b)) &&
        (!requireSceneTag || sceneTagAchieved(b)) &&
        (!requireHookLang || hookLangAchieved(b)),
    );
    if (fresh) {
      chosen = fresh;
    } else {
      logger.warn(
        {
          recentVoiceProfiles: Array.from(ctx.recentVoiceProfiles ?? []),
          poolSize: pool.length,
          count,
          voiceStrongPreference: ctx.voiceStrongPreference === true,
        },
        "hybrid_ideator.regen_no_new_voice_profile_shipping_best_effort",
      );
    }
  }
  // Phase 1 NOTE — the prior "soft ≥2-fresh scriptType upgrade" pass is
  // GONE: the new IdeaCoreFamily HARD rescue above already enforces
  // `≥2 NEW families` as a hard regen requirement, so a separate soft
  // upgrade is redundant (any batch reaching this point either passed
  // the hard rescue with ≥2 fresh families, or shipped best-effort
  // because the pool genuinely couldn't supply 2 fresh families).
  // SOFT preference (script-system FINAL spec §7): prefer batches that
  // contain ≥1 "active" energy idea. The hard `allLowEnergy` reject in
  // batchGuardsPass already prevents the all-3-low worst case; this
  // additionally nudges toward an active-energy anchor when the pool
  // has one available. Best-effort, runs for both regen and non-regen
  // since the spec applies to all batches.
  //
  // CRITICAL: this pass MUST preserve the freshness invariant of the
  // currently-chosen batch on ALL FIVE axes (scriptType, archetype-
  // Family, sceneObjectTag, hookLanguageStyle, voiceProfile) —
  // otherwise it could silently downgrade a fresh-rescued batch
  // into an active-but-stale batch, violating the spec's hard regen
  // guarantees. We snapshot the current fresh count on each axis
  // and only accept active candidates that match or exceed it.
  if (chosen && !batchHasActive(chosen)) {
    // Phase 1 — snapshot the current ideaCoreFamily fresh count so the
    // active-energy pass can't silently downgrade the rescue's HARD
    // ≥2-fresh-families guarantee (replaces the prior scriptType
    // snapshot). Outside regen this is `0` so the predicate is
    // vacuous on the family axis (matching the prior scriptType
    // behavior on first-load).
    const minFreshFamiliesRequired =
      opts.regenerate && (ctx.recentIdeaCoreFamilies?.size ?? 0) > 0
        ? countNewIdeaCoreFamilies(chosen, ctx.recentIdeaCoreFamilies)
        : 0;
    const requireFreshFamily =
      opts.regenerate &&
      (ctx.recentArchetypeFamilies?.size ?? 0) > 0 &&
      batchHasNewArchetypeFamily(chosen, ctx.recentArchetypeFamilies);
    const requireFreshTag =
      opts.regenerate &&
      (ctx.recentSceneObjectTags?.size ?? 0) > 0 &&
      batchHasNewSceneObjectTag(chosen, ctx.recentSceneObjectTags);
    const requireFreshLang =
      opts.regenerate &&
      (ctx.recentHookLanguageStyles?.size ?? 0) > 0 &&
      batchHasNewHookLanguageStyle(chosen, ctx.recentHookLanguageStyles);
    // VOICE PROFILES spec — same snapshot pattern as the four prior
    // axes. Only enforced when the current batch ALREADY satisfies
    // ≥1-fresh-voice (so we don't manufacture a freshness invariant
    // out of thin air); when it doesn't, this clause goes no-op and
    // the active-energy pass operates on the other four axes only.
    const requireFreshVoice =
      opts.regenerate &&
      (ctx.recentVoiceProfiles?.size ?? 0) > 0 &&
      batchHasNewVoiceProfile(chosen, ctx.recentVoiceProfiles);
    // Phase 6D Path D: count premise candidates in the currently-
    // chosen batch, so we can require any active-energy reselect to
    // preserve OR INCREASE that count. The active-energy rescue's
    // primary job is to add an "active" anchor — but it must NOT
    // silently downgrade premise share by swapping in a more-active
    // batch that happens to carry more LEG. This snapshot drives the
    // tiered reselect below: prefer premise-preserving alternatives
    // first, and only fall back to "any active alternative" if the
    // pool genuinely cannot supply one. Mirrors the snapshot
    // discipline used for the freshness invariants above.
    const minPremiseRequired = chosen.filter(
      (c) => c.meta.usedBigPremise === true,
    ).length;
    // Phase 6D Path B+: each axis-preservation predicate accepts
    // EITHER the axis-of-record token OR a fresh premiseStyleId.
    // This keeps the active-energy pass in step with the four
    // cascade rescues above — they all agree that a fresh
    // premiseStyleId is sufficient cross-batch diversity, so the
    // active-energy reselect must not reject candidates the
    // cascades would have accepted. Hoisted into a single named
    // predicate so the Path D tiered reselect below can compose it.
    const baseActiveGuard = (b: ScoredCandidate[]): boolean =>
      batchHasActive(b) &&
      countNewIdeaCoreFamilies(b, ctx.recentIdeaCoreFamilies) >=
        minFreshFamiliesRequired &&
      (!requireFreshFamily ||
        batchHasNewArchetypeFamily(b, ctx.recentArchetypeFamilies) ||
        batchHasNewPremiseStyleId(b, ctx.recentPremiseStyleIds)) &&
      (!requireFreshTag ||
        batchHasNewSceneObjectTag(b, ctx.recentSceneObjectTags) ||
        batchHasNewPremiseStyleId(b, ctx.recentPremiseStyleIds)) &&
      (!requireFreshLang ||
        batchHasNewHookLanguageStyle(b, ctx.recentHookLanguageStyles) ||
        batchHasNewPremiseStyleId(b, ctx.recentPremiseStyleIds)) &&
      (!requireFreshVoice ||
        batchHasNewVoiceProfile(b, ctx.recentVoiceProfiles) ||
        batchHasNewPremiseStyleId(b, ctx.recentPremiseStyleIds));
    // Phase 6D Path D — TIER 1: try to find an active alternative
    // that ALSO preserves (or increases) premise count. This is the
    // premise-aware tiebreak: among multiple valid active reselects,
    // prefer those that don't sacrifice premise share. Honors all
    // user constraints — does not weaken hard diversity guards
    // (composes baseActiveGuard verbatim), does not remove the
    // active_energy rescue (Tier 2 below preserves the original
    // semantics as fallback), does not force 100% premise (the
    // tiered design caps premise preservation at the chosen
    // batch's current count, never adds a 100%-premise floor).
    let active = exhaustiveReselect(
      pool,
      count,
      ctx,
      (b) =>
        baseActiveGuard(b) &&
        b.filter((c) => c.meta.usedBigPremise === true).length >=
          minPremiseRequired,
    );
    // Phase 6D Path D — TIER 2: if no premise-preserving active
    // alternative exists, fall back to the original active-only
    // predicate. This preserves the rescue's original "best-effort
    // active anchor" semantics for the rare case where the pool
    // genuinely lacks a premise-preserving option (e.g. the only
    // active candidates are Llama-generated legacy hooks). Without
    // this fallback we'd silently lose the active-energy spec
    // guarantee on those batches — Tier 1 wraps the constraint,
    // Tier 2 ensures we never drop the underlying invariant.
    if (!active) {
      active = exhaustiveReselect(pool, count, ctx, baseActiveGuard);
    }
    if (active) chosen = active;
  }
  if (chosen) return { batch: chosen, guardsPassed: true };
  // No guard-passing combination exists in the top-N. Return the
  // greedy result so the orchestrator can decide to call fallback
  // and re-select on a wider merged pool.
  return { batch: greedy, guardsPassed: false };
}

/**
 * Build cross-batch novelty context from the previous cached batch.
 * `recentFamilies` and `recentStyles` come straight from the cache;
 * `recentTopics` and `recentVisualActions` are derived via the
 * pattern-ideator's family→category lookup tables (so we don't need
 * to migrate the cache shape every time we add a new dimension).
 */
function buildNoveltyContext(
  prev: CachedBatchEntry[],
  /**
   * Per-batch breakdown of the last (up to) 3 shipped batches, newest-
   * first. Used to compute the tiered scriptType history fields
   * (`frequentScriptTypesLast3` / `unusedScriptTypesLast3`). Pass an
   * empty array (default) on cold-start / no-cache paths — both
   * tiered fields then stay undefined and the scoreNovelty/penalty
   * code paths short-circuit on the optional-set pattern.
   *
   * Existing per-axis sets (recentFamilies / styles / topics / etc.)
   * still derive from `prev` to preserve their established cross-
   * batch behavior — strict scope discipline.
   */
  last3Batches: CachedBatchEntry[][] = [],
  /**
   * Phase 3 HOOK TEMPLATE TUNING — full visible cache history,
   * per-batch newest-first. Used ONLY to compute the session-wide
   * `hookSkeletonsAtSessionCap` set (skeleton ids already shipped
   * ≥2 times across the entire visible history). Defaults to
   * `last3Batches` for back-compat — callers without a wider window
   * effectively cap at last-3 for the session-cap signal too, which
   * is the conservative behavior. Pass the full `priorBatches` to
   * activate the every-other-batch repeat block.
   */
  allBatchesForSessionCap: CachedBatchEntry[][] = last3Batches,
): NoveltyContext {
  if (prev.length === 0 && last3Batches.length === 0) return { };
  const recentFamilies = new Set<string>();
  const recentStyles = new Set<string>();
  const recentTopics = new Set<TopicLane>();
  const recentVisualActions = new Set<VisualActionPattern>();
  // Both new dimensions are derived from the cached `idea` payload —
  // hookOpener via prefix lookup over `idea.hook`, setting straight
  // off `idea.setting`. Zero cache-shape change: any envelope written
  // by older code already has these fields on its embedded ideas.
  const recentHookOpeners = new Set<HookOpener>();
  const recentSettings = new Set<Setting>();
  // Immediate-prior-batch scriptType demotion — SCOPED to the LAST
  // batch only (not the flat 5-batch window the other per-axis sets
  // use). This is required by spec so that:
  //   * `selectionPenalty -3 if ∈ recentScriptTypes` only demotes
  //     scriptTypes from the last shipped batch (older repeats are
  //     handled by the softer `-2 if ∈ frequentScriptTypesLast3` tier).
  //   * The regen rescue's `batchHasNewScriptType(batch, recent)`
  //     check only requires freshness vs. the last batch, not vs. the
  //     entire history window — otherwise the rescue starves on a
  //     small pool with naturally-recurring scriptTypes.
  // Derived via `lookupScriptType(family, templateId)` — legacy cache
  // entries lacking templateId fall back to scenario-default scriptType
  // so the axis still functions on pre-taxonomy cached batches.
  const recentScriptTypes = new Set<ScriptType>();
  // IDEA ARCHETYPE + SCENE-OBJECT TAG spec axes — derived in the same
  // immediate-prior-batch scope so the rescue invariants and per-pick
  // -3 / -2 demotions are scoped consistently with the scriptType
  // axis. Archetype + family fall out of scriptType via the resolver;
  // sceneObjectTag falls out of family via the lookup.
  const recentArchetypes = new Set<Archetype>();
  const recentArchetypeFamilies = new Set<ArchetypeFamily>();
  const recentSceneObjectTags = new Set<SceneObjectTag>();
  // HOOK STYLE spec — immediate-prior-batch language modes. Read
  // directly off the cache entry (first-class field, no derivation
  // path from family / hook). Legacy entries written before the
  // field existed contribute nothing — that's the right behavior:
  // an absent tag should NOT appear in the "recent" set or it would
  // poison the +2 unused-boost / -3 demotion semantics.
  const recentHookLanguageStyles = new Set<HookLanguageStyle>();
  // VOICE PROFILES spec — immediate-prior-batch voices. Read directly
  // off the cache entry (first-class field, no derivation path from
  // family / hook). Legacy entries written before the field existed
  // contribute nothing — that's the right behavior: an absent tag
  // should NOT appear in the "recent" set or it would poison the
  // +1 unused-boost / -2 cross-batch demotion semantics with a
  // ghost voice that no candidate actually shipped.
  const recentVoiceProfiles = new Set<VoiceProfile>();
  // TREND CONTEXT LAYER spec — immediate-prior-batch trend ids. Read
  // directly off the cache entry (first-class JSONB field). Legacy
  // entries (and Llama / Claude fallback wraps) without the field
  // contribute nothing — that's the right behavior: an absent tag
  // should NOT appear in the "recent" set or it would poison the -2
  // cross-batch demotion semantics with a ghost trend that no
  // candidate actually shipped.
  const recentTrendIds = new Set<string>();
  // Phase 3 HOOK TEMPLATE TUNING — immediate-prior-batch hook
  // skeleton ids. Read directly off the persisted envelope (no
  // derivation path from `idea.hook` — formulaic templates lose
  // their fingerprint once the Scenario noun interpolates), so
  // legacy entries written before the field shipped silently
  // contribute nothing to the set, and the -3 cross-batch lever in
  // `selectionPenalty` stays quiet for that entry rather than
  // false-matching against absent. Populated alongside trendId in
  // the immediate-prior loop below.
  const recentHookSkeletons = new Set<string>();
  // Phase 1 — IDEA CORE FAMILY / TYPE axis. Populated from the
  // immediate-prior batch (same scope as scriptType / archetype /
  // sceneObjectTag). Source priority: persisted envelope field
  // (Phase-1+ writes) → `lookupIdeaCoreType(family, templateId)`
  // derivation (legacy entries pre-dating the persisted fields).
  // Either path produces the same canonical IdeaCoreType so the
  // downstream lever is consistent across cache vintages.
  const recentIdeaCoreFamilies = new Set<IdeaCoreFamily>();
  const recentIdeaCoreTypes = new Set<IdeaCoreType>();
  const immediatePrior = last3Batches[0] ?? [];
  for (const e of immediatePrior) {
    if (e.family) {
      const st = lookupScriptType(e.family, e.templateId);
      if (st) {
        recentScriptTypes.add(st);
        const arc = resolveArchetypeLoose(st);
        if (arc) {
          recentArchetypes.add(arc.archetype);
          recentArchetypeFamilies.add(arc.family);
        }
      }
      const tag = lookupSceneObjectTag(e.family);
      if (tag) recentSceneObjectTags.add(tag);
      // ideaCoreType: prefer the envelope-persisted value so cache
      // entries written by Phase 1+ reflect the exact assembly-time
      // resolution (template overrides applied). Fall back to the
      // family/template lookup for legacy entries written before
      // the field was persisted — same semantics, just one lookup
      // per entry.
      const ict =
        e.ideaCoreType ?? lookupIdeaCoreType(e.family, e.templateId);
      if (ict) {
        recentIdeaCoreTypes.add(ict);
        // Cross-validate the persisted family against the canonical
        // type→family mapping. When ideaCoreType resolves, the
        // canonical `resolveIdeaCoreFamily(ict)` is the source of
        // truth — a malformed / mismatched persisted `ideaCoreFamily`
        // (e.g. tampered JSONB or a future type→family remap) cannot
        // poison `recentIdeaCoreFamilies` even though it survived
        // the per-field whitelist parse. The persisted family is
        // only consulted when type-lookup fails on a legacy entry
        // (handled by the else branch below).
        recentIdeaCoreFamilies.add(resolveIdeaCoreFamily(ict));
      } else if (e.ideaCoreFamily) {
        // Legacy / fallback path — type lookup failed (no persisted
        // value AND no catalog mapping) but the envelope still
        // carries a whitelisted family. Use it directly so that a
        // valid persisted family isn't dropped on the floor when
        // its sibling type is unrecoverable.
        recentIdeaCoreFamilies.add(e.ideaCoreFamily);
      }
    }
    if (e.hookLanguageStyle) recentHookLanguageStyles.add(e.hookLanguageStyle);
    if (e.voiceProfile) recentVoiceProfiles.add(e.voiceProfile);
    if (e.trendId) recentTrendIds.add(e.trendId);
    if (e.hookSkeletonId) recentHookSkeletons.add(e.hookSkeletonId);
  }
  // Phase 6 (BIG PREMISE LAYER) — cross-batch premise-style set,
  // sourced from the LAST-3-BATCHES window (wider than the
  // immediate-prior-only `recentTrendIds` / `recentHookSkeletons`
  // axes above). The wider window is intentional: there are only 5
  // premise styles so an immediate-prior-only set would have ~80%
  // false-fresh hit rate after one batch — the last-3 window keeps
  // the -2 cross-batch lever active long enough to actually rotate
  // styles. Legacy entries (and Llama / Claude fallback wraps)
  // without `bigPremiseStyle` contribute nothing — same discipline
  // as the trendId / skeletonId sets above.
  const recentBigPremiseStyles = new Set<BigPremiseStyle>();
  for (const batch of last3Batches) {
    for (const e of batch) {
      if (e.bigPremiseStyle) recentBigPremiseStyles.add(e.bigPremiseStyle);
    }
  }
  // Phase 6 EXPANSION (PREMISE STYLE ENGINE) — cross-batch fine-grained
  // 50-id set, parallel to `recentBigPremiseStyles` above and sourced
  // from the same last-3-batches window. The fine-grained pool is 50
  // ids so the wider window stays comfortable (~6 ids at most after 3
  // batches × ~2 premises per batch) — well under the catalog so the
  // -2 cross-batch lever in `selectionPenalty` keeps the picker
  // rotating ids without starving the supply. Legacy entries (and the
  // original 29 hand-written premise entries without a fine-grained
  // id) contribute nothing — same discipline as the bucket-level set
  // above.
  const recentPremiseStyleIds = new Set<PremiseStyleId>();
  for (const batch of last3Batches) {
    for (const e of batch) {
      if (e.premiseStyleId) recentPremiseStyleIds.add(e.premiseStyleId);
    }
  }
  // Phase 6D (PREMISE EXECUTION EXPANSION) — cross-batch execution-id
  // set, parallel to `recentPremiseStyleIds` above and sourced from
  // the same last-3-batches window. The execution-id pool is open-
  // ended (~15 reusable patterns shared across styles) so the wider
  // window stays comfortable — at ~2 premises per batch × 3 batches
  // = ~6 ids tracked, well under the catalog so the -2/+2 cross-
  // batch levers in `selectionPenalty` keep the picker rotating
  // executions without starving the supply. Legacy entries (and
  // Llama / Claude fallback wraps + the original 29 hand-written
  // premise entries that don't carry an execution id) contribute
  // nothing — same discipline as the style-level set above.
  const recentExecutionIds = new Set<string>();
  for (const batch of last3Batches) {
    for (const e of batch) {
      if (e.executionId) recentExecutionIds.add(e.executionId);
    }
  }
  // PHASE Y (PREMISE CORE LIBRARY) — cross-batch core-id set,
  // parallel to `recentPremiseStyleIds` above and sourced from the
  // same last-3-batches window. Read directly off `e.idea.premiseCoreId`
  // (top-level idea field) — no cache-envelope shape change required.
  // Layer-3 batches that weren't seeded with cores contribute nothing
  // (the field stays absent on the embedded idea), and pattern-
  // variation candidates have no core id by construction. The 40-id
  // pool is small enough that the -3 cross-batch demotion lever in
  // `selectionPenalty` keeps the picker rotating cores without
  // starving the supply (typical batch ships ~3-5 cores; 3 batches ×
  // ~4 cores = ~12 ids tracked, well under 40).
  const recentPremiseCoreIds = new Set<string>();
  for (const batch of last3Batches) {
    for (const e of batch) {
      const cid = e.idea.premiseCoreId;
      if (typeof cid === "string" && cid.length > 0) {
        recentPremiseCoreIds.add(cid);
      }
    }
  }
  for (const e of prev) {
    if (e.family) {
      recentFamilies.add(e.family);
      const tl = lookupTopicLane(e.family);
      if (tl) recentTopics.add(tl);
      const va = lookupVisualActionPattern(e.family);
      if (va) recentVisualActions.add(va);
    }
    recentStyles.add(e.idea.hookStyle);
    const op = lookupHookOpener(e.idea.hook);
    if (op) recentHookOpeners.add(op);
    recentSettings.add(e.idea.setting as Setting);
  }

  // Cross-batch tiered scriptType history. Computed separately from
  // `recentScriptTypes` (which is a flat union) so the two pieces of
  // information stack in selectionPenalty without a double-count
  // reduction in scoreNovelty's freshness check.
  let frequentScriptTypesLast3: ReadonlySet<ScriptType> | undefined;
  let unusedScriptTypesLast3: ReadonlySet<ScriptType> | undefined;
  // SCENE-OBJECT TAG spec — parallel tiered history on the tag axis.
  // Same compute pattern as scriptType (per-batch sets → count → ≥2
  // = frequent; catalog minus union = unused).
  let frequentSceneObjectTagsLast3: ReadonlySet<SceneObjectTag> | undefined;
  let unusedSceneObjectTagsLast3: ReadonlySet<SceneObjectTag> | undefined;
  // HOOK STYLE spec — only the unused-last-3 tier on this axis (no
  // frequent-last-3 stack). Sized smaller (+2 boost in scoreNovelty
  // vs +3 for scriptType / sceneObjectTag) because the axis is brand
  // new with no historical signal yet — start conservative.
  let unusedHookLanguageStylesLast3:
    | ReadonlySet<HookLanguageStyle>
    | undefined;
  // VOICE PROFILES spec — only the unused-last-3 tier on this axis
  // (no frequent-last-3 stack). Sized smallest (+1 boost in
  // scoreNovelty vs +2 for HookLanguageStyle) because the voice
  // pool is only 8 values and the per-creator allowed-set is
  // typically 3-4 — over-rewarding "unused in last 3" would let a
  // weak axis dominate well-evidenced scriptType / scene-object
  // levers when they conflict.
  let unusedVoiceProfilesLast3: ReadonlySet<VoiceProfile> | undefined;
  // Phase 1 — IDEA CORE FAMILY tiered cross-batch history. Computed
  // separately from `recentIdeaCoreFamilies` (immediate-prior) so the
  // two pieces stack in selectionPenalty: -3 for "in last batch" and
  // -2 for "in ≥2 of last 3" (parallel to the prior scriptType
  // tiering pattern). Same compute discipline as the scriptType axis
  // — per-batch sets → counts → ≥2 = frequent; catalog minus union
  // = unused.
  let frequentIdeaCoreFamiliesLast3:
    | ReadonlySet<IdeaCoreFamily>
    | undefined;
  let unusedIdeaCoreFamiliesLast3:
    | ReadonlySet<IdeaCoreFamily>
    | undefined;
  // Phase 3 HOOK TEMPLATE TUNING — tiered cross-batch hookSkeletonId
  // history. Computed separately from `recentHookSkeletons`
  // (immediate-prior) so the two pieces stack in `selectionPenalty`:
  // -3 for "in last batch" and -2 for "in ≥2 of last 3" (parallel
  // to the IdeaCoreFamily tiering pattern). No `unusedLast3` tier
  // because there's no positive boost on this axis — only the dual-
  // tier demotion. Catalog is open-ended (no enum to subtract from),
  // and the rotation work is done by the formulaic-vs-scenario
  // genericness penalty + the within-batch dup demotion. Source =
  // first-class `hookSkeletonId` field per cache entry — legacy
  // entries omit silently and don't pollute counts.
  let frequentHookSkeletonsLast3: ReadonlySet<string> | undefined;
  if (last3Batches.length > 0) {
    // Per-batch scriptType sets — one Set per batch so we can count
    // how many batches each scriptType appeared in (≥2 ⇒ frequent).
    const seenInBatch: Set<ScriptType>[] = last3Batches.map((batch) => {
      const s = new Set<ScriptType>();
      for (const e of batch) {
        if (!e.family) continue;
        const sct = lookupScriptType(e.family, e.templateId);
        if (sct) s.add(sct);
      }
      return s;
    });
    const counts = new Map<ScriptType, number>();
    for (const s of seenInBatch) {
      for (const sct of s) counts.set(sct, (counts.get(sct) ?? 0) + 1);
    }
    const freq = new Set<ScriptType>();
    for (const [sct, c] of counts) {
      if (c >= 2) freq.add(sct);
    }
    frequentScriptTypesLast3 = freq;
    // Unused-in-3 = catalog minus union of all batches' scriptTypes.
    // Catalog is the full SCRIPT_TYPES list (37 values); a batch
    // typically covers 2-3 distinct scriptTypes, so the unused set
    // is dominated by ≥30 entries on a healthy rotation.
    const seenAny = new Set<ScriptType>();
    for (const s of seenInBatch) for (const sct of s) seenAny.add(sct);
    unusedScriptTypesLast3 = new Set(
      SCRIPT_TYPES.filter((sct) => !seenAny.has(sct)),
    );

    // Same compute on the sceneObjectTag axis.
    const tagSeenInBatch: Set<SceneObjectTag>[] = last3Batches.map((batch) => {
      const s = new Set<SceneObjectTag>();
      for (const e of batch) {
        if (!e.family) continue;
        const tag = lookupSceneObjectTag(e.family);
        if (tag) s.add(tag);
      }
      return s;
    });
    const tagCounts = new Map<SceneObjectTag, number>();
    for (const s of tagSeenInBatch) {
      for (const t of s) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    }
    const freqTags = new Set<SceneObjectTag>();
    for (const [t, c] of tagCounts) {
      if (c >= 2) freqTags.add(t);
    }
    frequentSceneObjectTagsLast3 = freqTags;
    const tagSeenAny = new Set<SceneObjectTag>();
    for (const s of tagSeenInBatch) for (const t of s) tagSeenAny.add(t);
    unusedSceneObjectTagsLast3 = new Set(
      SCENE_OBJECT_TAGS.filter((t) => !tagSeenAny.has(t)),
    );

    // HOOK STYLE spec — unused-in-last-3 on the language-style axis.
    // Source = first-class `hookLanguageStyle` field on each cache
    // entry (no derivation from family / hook). Legacy entries
    // without the field don't contribute to seenAny — that means
    // their styles won't be subtracted from the catalog, so the
    // unused set may temporarily look broader than reality. That's
    // safe: the +2 boost just gets handed out a touch more
    // generously until the cache rolls forward with envelopes that
    // include the new field.
    const langSeenAny = new Set<HookLanguageStyle>();
    for (const batch of last3Batches) {
      for (const e of batch) {
        if (e.hookLanguageStyle) langSeenAny.add(e.hookLanguageStyle);
      }
    }
    unusedHookLanguageStylesLast3 = new Set(
      HOOK_LANGUAGE_STYLES.filter((s) => !langSeenAny.has(s)),
    );

    // VOICE PROFILES spec — unused-in-last-3 on the voice axis. Same
    // first-class read pattern as `hookLanguageStyle` above. Catalog
    // size is 8 — typical batch covers 2-3 distinct voices, so the
    // unused set in a healthy rotation is dominated by ≥4 entries
    // (and shrinks fast on creators with a narrow allowed-set, which
    // is fine because the +1 boost only fires for picks that ALSO
    // satisfy the calibration's allowed-voice gate). Legacy-entry
    // omission is benign: the +1 boost stays a touch more generous
    // until the cache rolls forward, never poisons the lever's
    // direction.
    const voiceSeenAny = new Set<VoiceProfile>();
    for (const batch of last3Batches) {
      for (const e of batch) {
        if (e.voiceProfile) voiceSeenAny.add(e.voiceProfile);
      }
    }
    unusedVoiceProfilesLast3 = new Set(
      VOICE_PROFILES.filter((v) => !voiceSeenAny.has(v)),
    );

    // Phase 1 — IDEA CORE FAMILY tiered cross-batch history. Source
    // priority per entry mirrors the immediate-prior loop above:
    // persisted envelope field first, then `lookupIdeaCoreType(family,
    // templateId)` derivation for legacy entries. The two paths
    // resolve to the same canonical family so the per-batch counts
    // are stable across cache vintages.
    const familySeenInBatch: Set<IdeaCoreFamily>[] = last3Batches.map(
      (batch) => {
        const s = new Set<IdeaCoreFamily>();
        for (const e of batch) {
          if (!e.family) continue;
          const ict =
            e.ideaCoreType ?? lookupIdeaCoreType(e.family, e.templateId);
          if (!ict) continue;
          s.add(e.ideaCoreFamily ?? resolveIdeaCoreFamily(ict));
        }
        return s;
      },
    );
    const familyCounts = new Map<IdeaCoreFamily, number>();
    for (const s of familySeenInBatch) {
      for (const f of s) {
        familyCounts.set(f, (familyCounts.get(f) ?? 0) + 1);
      }
    }
    const freqFamilies = new Set<IdeaCoreFamily>();
    for (const [f, c] of familyCounts) {
      if (c >= 2) freqFamilies.add(f);
    }
    frequentIdeaCoreFamiliesLast3 = freqFamilies;
    const familySeenAny = new Set<IdeaCoreFamily>();
    for (const s of familySeenInBatch) for (const f of s) familySeenAny.add(f);
    unusedIdeaCoreFamiliesLast3 = new Set(
      IDEA_CORE_FAMILIES.filter((f) => !familySeenAny.has(f)),
    );

    // Phase 3 HOOK TEMPLATE TUNING — tiered cross-batch hookSkeletonId
    // compute. Same per-batch-set → counts → ≥2 = frequent pattern as
    // IdeaCoreFamily above. Source is the first-class persisted field
    // (no derivation), so legacy entries silently abstain — the
    // counts only reflect Phase-3+ writes, which is exactly the
    // right behavior (an absent tag should NOT show up in the
    // frequent set or the -2 stack would fire against a fresh
    // skeleton). No catalog-minus-seen "unused" tier because the
    // skeleton catalog is open-ended (no enum to subtract from) and
    // the only lever on this axis is demotion, not boost.
    const skeletonSeenInBatch: Set<string>[] = last3Batches.map((batch) => {
      const s = new Set<string>();
      for (const e of batch) {
        if (e.hookSkeletonId) s.add(e.hookSkeletonId);
      }
      return s;
    });
    const skeletonCounts = new Map<string, number>();
    for (const s of skeletonSeenInBatch) {
      for (const k of s) {
        skeletonCounts.set(k, (skeletonCounts.get(k) ?? 0) + 1);
      }
    }
    const freqSkeletons = new Set<string>();
    for (const [k, c] of skeletonCounts) {
      if (c >= 2) freqSkeletons.add(k);
    }
    frequentHookSkeletonsLast3 = freqSkeletons;
  }

  // Phase 3 HOOK TEMPLATE TUNING — session-wide hard-cap tier on top
  // of the last-3 levers above. Counts skeleton uses across the FULL
  // visible cache history (not just last 3) and surfaces any
  // skeleton at usage ≥2 so the next-batch selector can apply a -4
  // demotion to prevent a third appearance — closing the every-
  // other-batch repeat hole that the last-3 tiers leave open
  // (a skeleton at batches 2+4 misses both `recentHookSkeletons`
  // (batch 5 prior) and `frequentHookSkeletonsLast3` (any 3-batch
  // window covers ≤1 use)). Computed unconditionally — even with
  // <3 batches of history a 2× use within batches 1+2 should already
  // demote the third batch's third use. Legacy entries without the
  // first-class field silently abstain via the truthy-string guard.
  // Count TOTAL OCCURRENCES (not batches) across the visible session.
  // The earlier per-batch `seenInBatch` collapse-then-count dropped a
  // legitimate failure mode: a skeleton shipping 2× in batch N + 1×
  // in batch N+1 is 3 total occurrences but counted as only 2 batch
  // hits. Since the within-batch dup lever is a soft -3 (not a filter),
  // 2-of-same-skeleton in one batch can absolutely ship — and the
  // session cap MUST see that as 2 occurrences toward the ≥2 threshold
  // so the next batch's third occurrence gets the -8 demotion. Legacy
  // entries without the first-class `hookSkeletonId` field silently
  // abstain via the truthy-string guard.
  const sessionSkeletonCounts = new Map<string, number>();
  // Phase 3D BUG B — exact-hook string dedup. Harvest normalized
  // hook strings from the FULL visible cache history in the same
  // walk that powers `sessionSkeletonCounts`. Symmetric with
  // `selectionPenalty`'s lookup side — both call
  // `normalizeHookForDedup`. This catches the legacy
  // `9:14pm. still here.` repeat-shipping failure mode where the
  // skeleton-id cap was bypassed because the entry shipped without
  // a `skeletonId` in older batches; even after we tag it going
  // forward (Phase 3D Bug B fix in patternIdeator.ts), the
  // exact-string set is the belt-and-braces guard that catches any
  // mid-string punctuation drift or re-emission via a different
  // code path.
  const recentHookStrings = new Set<string>();
  // PHASE D1 — hook FINGERPRINT set (canonicalized via lemma +
  // synonym + sort). Built in the same walk as `recentHookStrings`
  // and threaded into `selectionPenalty` via the same -1000 hard-
  // reject lever. Catches near-duplicate hooks (e.g. "my body quit.
  // my brain kept screaming" vs "my body quit; my brain still
  // screams") that the exact-string set would miss.
  const recentHookFingerprints = new Set<string>();
  for (const batch of allBatchesForSessionCap) {
    for (const e of batch) {
      if (e.hookSkeletonId) {
        sessionSkeletonCounts.set(
          e.hookSkeletonId,
          (sessionSkeletonCounts.get(e.hookSkeletonId) ?? 0) + 1,
        );
      }
      // Harvest the hook string regardless of whether the entry has
      // a skeletonId — that's the whole point of the belt-and-braces
      // guard. Defensive guard for malformed cache entries (missing
      // idea or missing hook) so a single bad row can't kill the
      // whole context build.
      const h = e.idea?.hook;
      if (typeof h === "string" && h.length > 0) {
        recentHookStrings.add(normalizeHookForDedup(h));
        // PHASE D1 — additionally harvest the stronger HOOK
        // FINGERPRINT (lemma + synonym + sort) so the cross-batch
        // -1000 hard reject in `selectionPenalty` catches near-
        // duplicate hooks that share content but differ in stop-
        // words / inflection / punctuation. The exact-string set
        // above is a strict subset of what the fingerprint set
        // catches — both are populated for belt-and-braces.
        const hf = canonicalizeHookForFingerprint(h);
        if (hf.length > 0) recentHookFingerprints.add(hf);
      }
    }
  }
  const hookSkeletonsAtSessionCap = new Set<string>();
  for (const [k, c] of sessionSkeletonCounts) {
    if (c >= 2) hookSkeletonsAtSessionCap.add(k);
  }

  return {
    recentFamilies,
    recentStyles,
    recentTopics,
    recentVisualActions,
    recentHookOpeners,
    recentSettings,
    recentScriptTypes,
    frequentScriptTypesLast3,
    unusedScriptTypesLast3,
    recentArchetypes,
    recentArchetypeFamilies,
    recentSceneObjectTags,
    frequentSceneObjectTagsLast3,
    unusedSceneObjectTagsLast3,
    recentHookLanguageStyles,
    unusedHookLanguageStylesLast3,
    recentVoiceProfiles,
    unusedVoiceProfilesLast3,
    recentIdeaCoreFamilies,
    frequentIdeaCoreFamiliesLast3,
    unusedIdeaCoreFamiliesLast3,
    recentIdeaCoreTypes,
    recentTrendIds,
    recentHookSkeletons,
    frequentHookSkeletonsLast3,
    hookSkeletonsAtSessionCap,
    // Phase 3D BUG B — exact-hook string set (normalized) sourced
    // from the FULL visible cache. Consumed by `selectionPenalty`
    // for the -1000 cross-batch hard reject. Never empty when
    // history exists; cold-start callers see an empty Set which is
    // a no-op in the lookup path.
    recentHookStrings,
    // PHASE D1 — hook FINGERPRINT set, populated in the same walk.
    // Same -1000 hard-reject lever in `selectionPenalty`; catches
    // near-duplicate hooks that exact-string dedup misses.
    recentHookFingerprints,
    // Phase 6 (BIG PREMISE LAYER) — last-3 premise-style set drives
    // the -2 cross-batch demotion in `selectionPenalty`. Empty Set
    // for cold-start (caller treats as no contribution).
    recentBigPremiseStyles,
    // Phase 6 EXPANSION — fine-grained last-3 PremiseStyleId set
    // drives the parallel -2 cross-batch demotion on the 50-id axis.
    recentPremiseStyleIds,
    // Phase 6D (PREMISE EXECUTION EXPANSION) — last-3 execution-id set
    // drives the -2 cross-batch demotion + +2 fresh-execution boost
    // on the open-ended execution axis. Empty Set for cold-start
    // (caller treats as no contribution).
    recentExecutionIds,
    // PHASE Y (PREMISE CORE LIBRARY) — last-3 premiseCoreId set drives
    // the -3 cross-batch demotion + +2 fresh-core boost in
    // `selectionPenalty`. Empty Set for cold-start (caller treats as
    // no contribution); empty for batches that didn't ride the
    // PHASE Y core-seeded fallback path.
    recentPremiseCoreIds,
    // NOTE: `voiceStrongPreference` is intentionally NOT set here.
    // It's a callsite-provided flag (the orchestrator knows the
    // selection-source tier from `selectPrimaryVoiceProfile`) and
    // must override / shadow whatever batch-history derived. Callers
    // merge it into the context AFTER calling `buildNoveltyContext`.
  };
}

/**
 * Cached-batch entry shape — `idea` plus the metadata we need to
 * exclude / penalize on regenerate.
 */
type CachedBatchEntry = {
  idea: Idea;
  family?: string;
  templateId?: string;
  /**
   * HOOK STYLE spec axis (12 values). Persisted in cache so
   * `buildNoveltyContext` can derive `recentHookLanguageStyles` and
   * `unusedHookLanguageStylesLast3` without an in-memory state. Cache
   * is JSONB so adding the field is non-breaking; legacy entries
   * without it just don't contribute to the cross-batch hook-language
   * lever (the +2 unused-boost / -3 cross-batch demotion silently
   * stay quiet until the next regen writes a new envelope).
   */
  hookLanguageStyle?: HookLanguageStyle;
  /**
   * VOICE PROFILES spec axis (8 values). Persisted in cache so
   * `buildNoveltyContext` can derive `recentVoiceProfiles` and
   * `unusedVoiceProfilesLast3` without an in-memory state. Same
   * non-breaking JSONB pattern as `hookLanguageStyle` above —
   * legacy entries without the field silently don't contribute to
   * the cross-batch voice levers (the +1 unused-boost / -2 cross-
   * batch demotion stay quiet until the next regen writes a new
   * envelope with voiceProfile populated).
   */
  voiceProfile?: VoiceProfile;
  /**
   * TREND CONTEXT LAYER spec — id of the curated trend item that
   * was injected into this candidate's caption (when one fired).
   * Persisted in cache so `buildNoveltyContext` can derive
   * `recentTrendIds` directly off the envelope without a derivation
   * step. Same non-breaking JSONB pattern as `voiceProfile` above —
   * legacy entries written before the trend layer shipped contribute
   * nothing to the cross-batch -2 trend lever (the penalty stays
   * quiet until the next regen writes a new envelope with trendId
   * populated). Tolerantly parsed — unknown / removed / typo'd
   * trend ids drop to undefined.
   */
  trendId?: string;
  /**
   * Phase 1 — IdeaCoreType / IdeaCoreFamily persisted alongside the
   * existing scriptType-derivable fields so `buildNoveltyContext`
   * can read the family / type axis directly off the envelope without
   * a per-entry `lookupIdeaCoreType` call. Same non-breaking JSONB
   * pattern: legacy entries written before this field shipped fall
   * back to `lookupIdeaCoreType(family, templateId)` at read time, so
   * the cross-batch family lever still functions on pre-Phase-1
   * cached batches. Tolerantly parsed — unknown values (typos /
   * future renames / dropped families) silently drop to undefined.
   */
  ideaCoreType?: IdeaCoreType;
  ideaCoreFamily?: IdeaCoreFamily;
  /**
   * Phase 3 HOOK TEMPLATE TUNING — formulaic hook-template skeleton id
   * (e.g. `"todays_update"`, `"manage_now_hostage"`). Set ONLY when
   * the picked LanguagePhrasingEntry carried a `skeletonId` tag —
   * entries with genuinely scenario-shaped phrasings have no
   * skeleton and persist undefined here. Persisted in cache so
   * `buildNoveltyContext` can derive `recentHookSkeletons` (immediate-
   * prior batch) and `frequentHookSkeletonsLast3` (≥2 of last 3
   * batches) directly off the envelope without a derivation path —
   * formulaic templates lose their fingerprint after Scenario noun
   * interpolation, so there's no recovery from `idea.hook` text.
   * Same non-breaking JSONB pattern as `trendId` above — legacy
   * entries written before the field shipped contribute nothing to
   * the cross-batch skeleton lever (the -3 immediate-prior / -2
   * frequent-last-3 demotions stay quiet until the next regen
   * writes a new envelope with the field populated). Tolerantly
   * parsed: any non-empty string passes through (open-ended catalog
   * — new skeletons can be added without a schema migration), empty
   * strings drop to undefined so the recent set never holds a "".
   */
  hookSkeletonId?: string;
  /**
   * Phase 6 (BIG PREMISE LAYER) — premise-style id (one of 5 values)
   * persisted on cache so `buildNoveltyContext` can populate
   * `recentBigPremiseStyles` directly off the envelope. Same non-
   * breaking JSONB pattern as `hookSkeletonId` above — legacy entries
   * written before Phase 6 shipped contribute nothing to the cross-
   * batch -2 premise-style lever. Tolerantly parsed against
   * `BIG_PREMISE_STYLES`: unknown / typo'd / future-removed values
   * silently drop to undefined so the recent set never holds a
   * string the catalog doesn't recognize.
   */
  bigPremiseStyle?: BigPremiseStyle;
  /**
   * Phase 6 EXPANSION (PREMISE STYLE ENGINE) — fine-grained 50-style
   * id persisted on cache so `buildNoveltyContext` can populate
   * `recentPremiseStyleIds` directly off the envelope, parallel to
   * `bigPremiseStyle` above. Same non-breaking JSONB pattern: legacy
   * entries written before Phase 6 EXPANSION shipped (and the
   * original 29 hand-written premise entries that don't carry a
   * fine-grained id) contribute nothing to the cross-batch -2
   * fine-grained lever. Tolerantly parsed via `parsePremiseStyleId`
   * against the closed PREMISE_STYLE_IDS set: unknown / typo'd /
   * future-removed values silently drop to undefined so the recent
   * set never holds a string the catalog doesn't recognize.
   */
  premiseStyleId?: PremiseStyleId;
  /**
   * Phase 6D (PREMISE EXECUTION EXPANSION) — fine-grained execution-
   * pattern id persisted on cache so `buildNoveltyContext` can
   * populate `recentExecutionIds` directly off the envelope, parallel
   * to `premiseStyleId` above. Same non-breaking JSONB pattern:
   * legacy entries written before Phase 6D shipped (and the original
   * 29 hand-written premise entries that don't carry an execution id)
   * contribute nothing to the cross-batch -2/+2 execution levers.
   * Tolerantly parsed as a non-empty string (open-ended catalog —
   * new execution variants can ship without a schema migration; same
   * discipline as `hookSkeletonId` above). Empty strings drop to
   * undefined so the recent set never holds a "" sentinel.
   */
  executionId?: string;
  /**
   * Phase 6E (PREMISE COMEDY SCORING + REJECTION) — integer rubric
   * total (0-10) for the WINNING premise hook, persisted on the
   * cache envelope so future telemetry / QA drivers can read it back
   * via `extractCurrent` without re-scoring from the hook string
   * (which would lose the picker-walk's exact context-aware score
   * after later Llama polish edits the text — `executionId` and
   * `scenario.topicNoun` boosts can't be reproduced from the hook
   * alone). No cross-batch novelty consumer today — the field is
   * telemetry-only. Same non-breaking JSONB pattern as the rest of
   * the Phase 6 fields above: legacy entries written before this
   * field shipped read back as undefined. Tolerantly parsed as a
   * finite integer in `[0, 10]` — anything outside that range
   * silently drops to undefined so downstream averages / histograms
   * can't be poisoned by a corrupt envelope.
   */
  premiseComedyScoreTotal?: number;
  /**
   * Phase 6F (LEGACY COMEDY SCORING + REJECTION) — symmetric
   * single-integer cache field for the LEGACY rubric, parallel to
   * `premiseComedyScoreTotal` above. Persists `[0, 10]` total of
   * the 4-dim rubric (relatability 0-3 / clarity 0-3 / simplicity
   * 0-2 / emotional 0-2) for the WINNING legacy hook, so the QA
   * driver can read it back via `extractCurrent` without re-scoring
   * from the post-Llama-polish hook string (which would lose the
   * picker-walk's exact context-aware score and the `entry.generic-
   * Hook` flag adjustment). No cross-batch novelty consumer today —
   * field is telemetry-only, identical to the premise field. Same
   * non-breaking JSONB pattern: legacy / pre-6F entries silently
   * read back as undefined. Mutually exclusive with
   * `premiseComedyScoreTotal` by construction (a candidate is
   * either premise or legacy, never both — the picker walk's
   * if/else assigns at most one rubric on `c.meta`). Tolerantly
   * parsed below to a finite integer in `[0, 10]` — anything
   * outside that range silently drops to undefined so downstream
   * QA averages / histograms can't be poisoned by a corrupt
   * envelope.
   */
  legacyComedyScoreTotal?: number;
  /**
   * Phase 7 (VIRAL FEEL SCORE) — integer rubric total (0-10) for the
   * WINNING candidate, persisted on the cache envelope so the QA
   * driver and future telemetry can read it back via `extractCurrent`
   * without re-scoring from the post-Llama-polish hook string. Unlike
   * the comedy fields above (which are mutually exclusive — premise
   * OR legacy, never both), this field is set on EVERY pattern_-
   * variation candidate (premise + legacy alike), since the viral
   * score is a final ranking polish layer that runs symmetrically.
   *
   * No cross-batch novelty consumer today — telemetry only. Same
   * non-breaking JSONB pattern as `legacyComedyScoreTotal` above:
   * legacy / pre-Phase-7 entries silently read back as undefined,
   * and Llama / Claude fallback wraps that didn't run through
   * `assembleCandidate` (no `meta.viralFeelScore`) also persist
   * undefined. Tolerantly parsed below as a finite integer in
   * `[0, 10]` — anything outside that range silently drops to
   * undefined so QA averages / histograms can't be poisoned by a
   * corrupt envelope.
   */
  viralFeelScoreTotal?: number;
  /**
   * PHASE Y8 — scenario fingerprint (`sf_<12hex>`) computed by
   * `cohesiveIdeaAuthor` over the candidate's
   * `(mechanism, anchor, action)` triple, persisted on cache so the
   * next regen's `loadMemory` can populate
   * `recentScenarioFingerprints` directly off the envelope without a
   * derivation path (the fp is path-dependent on the picker walk's
   * exact (mechanism, anchor, action) — re-deriving from `idea.hook`
   * + `idea.whatToShow` after Llama polish would lose the original
   * action verb when the polish swapped it). Same non-breaking JSONB
   * pattern as `viralFeelScoreTotal` above — legacy entries written
   * before Y8 shipped (and Llama / Claude fallback wraps that don't
   * compute one) read back as undefined and contribute nothing to the
   * cross-batch dedup gate, which silently stays quiet for those
   * entries rather than poisoning the recent set with a non-fp
   * string. Tolerantly parsed below as `/^sf_[0-9a-f]{12}$/` — any
   * other shape silently drops to undefined so a corrupt envelope
   * can't false-match a fresh fp downstream.
   */
  scenarioFingerprint?: string;
  /**
   * PHASE Y10 — voice cluster id (`dry_deadpan` | `chaotic_confession`
   * | `quiet_realization` | `overdramatic_reframe`) the cohesive
   * author resolved at cache-write time. Persisted so the next
   * regen's `loadMemory` can build the `recentVoiceClusters`
   * histogram directly off the envelope without a derivation path
   * (the chosen cluster is path-dependent on the
   * `(salt, coreId, recipeIdx)` triple — re-deriving from the cached
   * `idea.hook` text would be both expensive AND lossy after Llama
   * polish). Same non-breaking JSONB pattern as
   * `scenarioFingerprint` above — legacy entries written before Y10
   * shipped (and Llama / Claude fallback wraps that pick a voice
   * outside the 4-cluster taxonomy) read back as undefined and
   * contribute nothing to the cross-batch voice rotation. Tolerantly
   * parsed below against the 4-id union — any other string silently
   * drops to undefined so a corrupt envelope can't poison the
   * recent voice histogram with a non-cluster string.
   */
  voiceClusterId?: VoiceClusterId;
};

/**
 * Cache envelope: the most recent batch (`current`, used for the
 * same-day non-regen cache hit) plus a rolling history of the
 * previous batches. History is the cross-batch novelty memory: a
 * regen reads `current + history` so it can avoid re-shipping any
 * combination from the last `1 + MAX_HISTORY_BATCHES` batches.
 *
 * Without this, regenerate=true bounces between two states (after
 * regen #1 overwrites the cache, the seed's hooks/families look
 * "fresh" again and regen #2 happily re-ships them).
 */
type CachedEnvelope = {
  current: CachedBatchEntry[];
  history: CachedBatchEntry[][]; // newest first
};

/**
 * How many *prior* batches we keep beyond the current one. PHASE Y10
 * lifted this from 4 → 6 so the cross-batch freshness windows
 * (anchors, scenario fingerprints, voice clusters) span the LAST 7
 * BATCHES (current + 6 history) the creator has been shown. The HARD
 * hook exclusion in `buildExclusion` widens with the same window —
 * with count=3 picks per batch that's ~21 unique hooks excluded,
 * which mathematically prevents an identical 3-hook batch from
 * re-appearing across the user-visible window.
 *
 * FAMILY exclusion stays at depth 1 (`immediatePrior`, see
 * `buildExclusion`) because the family pool is only ~20 entries —
 * extending family exclusion to depth 7 would shrink the pattern
 * engine's candidate pool below the 3-pick threshold. Older-batch
 * family repetition is handled SOFTLY by the novelty-context
 * penalties.
 */
const MAX_HISTORY_BATCHES = 6;

/**
 * Parse the entries inside a single batch. Accepts either the
 * wrapper shape `{ idea, family?, templateId? }` or the oldest legacy
 * raw `Idea` shape. Returns null on any structural mismatch.
 */
function tryParseEntries(raw: unknown): CachedBatchEntry[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: CachedBatchEntry[] = [];
  for (const item of raw) {
    if (item && typeof item === "object" && "idea" in item) {
      const wrapper = item as {
        idea: unknown;
        family?: unknown;
        templateId?: unknown;
        hookLanguageStyle?: unknown;
        voiceProfile?: unknown;
        trendId?: unknown;
        ideaCoreType?: unknown;
        ideaCoreFamily?: unknown;
        hookSkeletonId?: unknown;
        bigPremiseStyle?: unknown;
        premiseStyleId?: unknown;
        executionId?: unknown;
        premiseComedyScoreTotal?: unknown;
        legacyComedyScoreTotal?: unknown;
        viralFeelScoreTotal?: unknown;
        scenarioFingerprint?: unknown;
        voiceClusterId?: unknown;
      };
      const parsed = ideaSchema.safeParse(wrapper.idea);
      if (!parsed.success) return null;
      // hookLanguageStyle is tolerantly parsed: only adopt it when the
      // string matches a registered language-style value. Unknown
      // values (legacy entries / typos / future-rename drift) silently
      // drop to undefined so the cross-batch lever just stays quiet
      // for that entry rather than corrupting the context Set.
      const hlsRaw = wrapper.hookLanguageStyle;
      const hookLanguageStyle: HookLanguageStyle | undefined =
        typeof hlsRaw === "string" &&
        (HOOK_LANGUAGE_STYLES as readonly string[]).includes(hlsRaw)
          ? (hlsRaw as HookLanguageStyle)
          : undefined;
      // VOICE PROFILES spec — same tolerant parse pattern as hookLang-
      // uageStyle above. Unknown / future / legacy values silently
      // drop to undefined so the +1 unused-boost / -2 cross-batch
      // demotion just stay quiet for that entry rather than poisoning
      // the recentVoiceProfiles Set with a string the catalog doesn't
      // recognize.
      const vpRaw = wrapper.voiceProfile;
      const voiceProfile: VoiceProfile | undefined =
        typeof vpRaw === "string" &&
        (VOICE_PROFILES as readonly string[]).includes(vpRaw)
          ? (vpRaw as VoiceProfile)
          : undefined;
      // TREND CONTEXT LAYER — tolerant parse: any string passes
      // through (the curator-managed catalog set is open-ended and
      // can grow / decay between batches without a code deploy, so
      // we don't whitelist against an enum here). The cross-batch
      // -2 lever in `selectionPenalty` simply checks Set membership
      // — an unknown id can never accidentally match a fresh trend
      // because the live `meta.trendId` writes go through
      // `TREND_BY_ID`'s known set. Empty strings drop to undefined
      // so the recentTrendIds Set never holds a "" sentinel.
      const tidRaw = wrapper.trendId;
      const trendId: string | undefined =
        typeof tidRaw === "string" && tidRaw.length > 0 ? tidRaw : undefined;
      // Phase 1 — IdeaCoreType / IdeaCoreFamily tolerant parse. Same
      // discipline as hookLanguageStyle / voiceProfile above: only
      // adopt when the string is a registered catalog value, else
      // silently drop to undefined. This preserves cross-batch lever
      // sanity through future taxonomy edits — a renamed / removed
      // type can never accidentally show up in `recentIdeaCoreTypes`
      // and false-match a fresh candidate. Each field is parsed
      // independently because future edits could legitimately
      // produce one without the other (cache rolls forward over
      // multiple regens, partial fills are fine).
      const ictRaw = wrapper.ideaCoreType;
      const ideaCoreType: IdeaCoreType | undefined =
        typeof ictRaw === "string" &&
        (IDEA_CORE_TYPES as readonly string[]).includes(ictRaw)
          ? (ictRaw as IdeaCoreType)
          : undefined;
      const icfRaw = wrapper.ideaCoreFamily;
      const ideaCoreFamily: IdeaCoreFamily | undefined =
        typeof icfRaw === "string" &&
        (IDEA_CORE_FAMILIES as readonly string[]).includes(icfRaw)
          ? (icfRaw as IdeaCoreFamily)
          : undefined;
      // Phase 3 HOOK TEMPLATE TUNING — tolerant parse: any non-empty
      // string passes through. Same discipline as `trendId` above —
      // the catalog of skeleton ids is open-ended (new formulaic
      // templates may add new ids without a schema migration), so
      // we can't whitelist against an enum. Empty strings drop to
      // undefined so the recent set never holds a "" sentinel and
      // cross-batch matches against an absent tag never fire.
      const hsidRaw = wrapper.hookSkeletonId;
      const hookSkeletonId: string | undefined =
        typeof hsidRaw === "string" && hsidRaw.length > 0
          ? hsidRaw
          : undefined;
      // Phase 6 (BIG PREMISE LAYER) — tolerant parse against the closed
      // BIG_PREMISE_STYLES enum. Unknown / future-removed / typo'd
      // values silently drop to undefined so the cross-batch -2
      // premise-style lever stays quiet for legacy / corrupt entries
      // rather than poisoning the recentBigPremiseStyles Set with a
      // string the catalog doesn't recognize.
      const bpsRaw = wrapper.bigPremiseStyle;
      const bigPremiseStyle: BigPremiseStyle | undefined =
        typeof bpsRaw === "string" &&
        (BIG_PREMISE_STYLES as readonly string[]).includes(bpsRaw)
          ? (bpsRaw as BigPremiseStyle)
          : undefined;
      // Phase 6 EXPANSION — tolerant parse of fine-grained 50-style id.
      // Same discipline as `bigPremiseStyle` above (closed enum, drop
      // to undefined on typo / future removal). Decoupled from
      // `bigPremiseStyle` so a future cache row may carry the
      // fine-grained id even when the bucket field rolled out of
      // sync (defensive — both fields are independently optional).
      const premiseStyleId = parsePremiseStyleId(wrapper.premiseStyleId);
      // Phase 6D (PREMISE EXECUTION EXPANSION) — tolerant parse: any
      // non-empty string passes through (open-ended catalog of
      // execution ids — new variants can ship without a schema
      // migration). Same discipline as `hookSkeletonId` / `trendId`
      // above: the catalog is curator-managed, so we don't whitelist
      // against an enum here — the live `meta.executionId` writes go
      // through `PREMISE_STYLE_DEFS[*].executions[*].id`'s known set.
      // Empty strings drop to undefined so `recentExecutionIds` never
      // holds a "" sentinel and cross-batch matches against an
      // absent tag never fire.
      const eidRaw = wrapper.executionId;
      const executionId: string | undefined =
        typeof eidRaw === "string" && eidRaw.length > 0 ? eidRaw : undefined;
      // Phase 6E (PREMISE COMEDY SCORING + REJECTION) — tolerant
      // parse: only adopt finite integers in `[0, 10]` (rubric range
      // by construction). NaN / out-of-range / non-number / float
      // values silently drop to undefined so a corrupt envelope can
      // never poison QA-driver averages or histograms. The rubric's
      // total is always integer-valued in the live writer (sum of
      // five 0-2 integer dim scores), so a non-integer in cache is
      // unambiguously corruption — drop it.
      const pcsRaw = wrapper.premiseComedyScoreTotal;
      const premiseComedyScoreTotal: number | undefined =
        typeof pcsRaw === "number" &&
        Number.isInteger(pcsRaw) &&
        pcsRaw >= 0 &&
        pcsRaw <= 10
          ? pcsRaw
          : undefined;
      // Phase 6F (LEGACY COMEDY SCORING + REJECTION) — same
      // tolerant integer-in-[0,10] parse as the premise field
      // immediately above. The legacy rubric's total is also
      // always integer-valued in the live writer (sum of four
      // integer dim scores: relatability 0-3 / clarity 0-3 /
      // simplicity 0-2 / emotional 0-2), so a non-integer / out-
      // of-range / non-number value in cache is unambiguously
      // corruption — silently drop to undefined so QA driver
      // averages / histograms can't be poisoned.
      const lcsRaw = wrapper.legacyComedyScoreTotal;
      const legacyComedyScoreTotal: number | undefined =
        typeof lcsRaw === "number" &&
        Number.isInteger(lcsRaw) &&
        lcsRaw >= 0 &&
        lcsRaw <= 10
          ? lcsRaw
          : undefined;
      // Phase 7 (VIRAL FEEL SCORE) — same tolerant integer-in-[0,10]
      // parse as the comedy fields above. The viral rubric's total
      // is always integer-valued in the live writer (sum of five
      // integer dim scores: instantRecognition 0-3 / scrollInterruption
      // 0-2 / shareability 0-2 / emotionalSpike 0-2 / formatFit 0-1),
      // so a non-integer / out-of-range / non-number value in cache
      // is unambiguously corruption — silently drop to undefined so
      // QA driver averages / histograms can't be poisoned by a
      // garbled envelope. Symmetric across premise + legacy entries
      // (the viral score is a final ranking polish layer, not
      // mutually exclusive with either comedy track).
      const vfsRaw = wrapper.viralFeelScoreTotal;
      const viralFeelScoreTotal: number | undefined =
        typeof vfsRaw === "number" &&
        Number.isInteger(vfsRaw) &&
        vfsRaw >= 0 &&
        vfsRaw <= 10
          ? vfsRaw
          : undefined;
      // PHASE Y8 — scenario fingerprint tolerant parse: only adopt
      // strings matching `sf_<12 lowercase hex>` (the exact shape
      // emitted by `computeScenarioFingerprint` — `sf_` prefix + 8
      // hex chars from djb2(seed-a) + 4 hex chars from djb2(seed-b)).
      // Anything else (legacy entries / Llama/Claude wraps without a
      // fp / corruption / future-rename drift) silently drops to
      // undefined so the recentScenarioFingerprints Set built from
      // the envelope can't false-match a fresh fp downstream — the
      // hard-reject gate in `coreCandidateGenerator` would then
      // erroneously kill a real candidate. Strict `/^sf_[0-9a-f]{12}$/`
      // is the right discipline (same as how `parsePremiseStyleId`
      // whitelists against the closed catalog set).
      const sfRaw = wrapper.scenarioFingerprint;
      const scenarioFingerprint: string | undefined =
        typeof sfRaw === "string" && /^sf_[0-9a-f]{12}$/.test(sfRaw)
          ? sfRaw
          : undefined;
      // PHASE Y10 — voice cluster id tolerant parse: only adopt
      // strings matching one of the 4 known `VoiceClusterId` values
      // (see voiceClusters.ts). Anything else (legacy entries pre-
      // Y10 / Llama / Claude wraps without a cluster id / corruption
      // / future-rename drift) silently drops to undefined so the
      // recentVoiceClusters histogram built from the envelope can't
      // be poisoned by a non-cluster string downstream.
      const vcRaw = wrapper.voiceClusterId;
      const voiceClusterId: VoiceClusterId | undefined =
        typeof vcRaw === "string" && _isVoiceClusterId(vcRaw)
          ? vcRaw
          : undefined;
      out.push({
        idea: parsed.data,
        family:
          typeof wrapper.family === "string" ? wrapper.family : undefined,
        templateId:
          typeof wrapper.templateId === "string"
            ? wrapper.templateId
            : undefined,
        hookLanguageStyle,
        voiceProfile,
        trendId,
        ideaCoreType,
        ideaCoreFamily,
        hookSkeletonId,
        bigPremiseStyle,
        premiseStyleId,
        executionId,
        premiseComedyScoreTotal,
        legacyComedyScoreTotal,
        viralFeelScoreTotal,
        scenarioFingerprint,
        voiceClusterId,
      });
    } else {
      const parsed = ideaSchema.safeParse(item);
      if (!parsed.success) return null;
      out.push({ idea: parsed.data });
    }
  }
  return out;
}

/**
 * Read the persisted JSONB into the canonical envelope shape.
 * Accepts THREE on-disk shapes (newest → oldest):
 *
 *   1. `{ version: 2, current: [...], history: [[...], ...] }`
 *      — current writes (rolling-history aware).
 *   2. `[{ idea, family?, templateId? }, ...]`
 *      — pre-history writes; treated as `current`, history empty.
 *   3. `[Idea, ...]`
 *      — original legacy writes; treated as `current`, history empty.
 *
 * Returns null only when nothing parses; callers default to an
 * empty envelope.
 */
function tryParseCachedEnvelope(raw: unknown): CachedEnvelope | null {
  // Shape 1: versioned envelope.
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const env = raw as {
      version?: unknown;
      current?: unknown;
      history?: unknown;
    };
    if (env.version === 2) {
      const current = tryParseEntries(env.current) ?? [];
      const history: CachedBatchEntry[][] = [];
      if (Array.isArray(env.history)) {
        for (const h of env.history) {
          const parsed = tryParseEntries(h);
          if (parsed) history.push(parsed);
        }
      }
      // Empty current + empty history is treated as no cache.
      if (current.length === 0 && history.length === 0) return null;
      return { current, history };
    }
  }
  // Shape 2/3: legacy array — entire array is the current batch.
  const legacy = tryParseEntries(raw);
  if (legacy === null) return null;
  return { current: legacy, history: [] };
}

/**
 * Normalize a hook for exclusion comparison — lowercase, strip
 * punctuation, collapse whitespace. Two hooks that differ only in
 * casing or stray punctuation collide here so regenerate can't ship
 * "the way I sleep at 3am" right after "The way I sleep at 3am!".
 */
function normalizeHook(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Stable 32-bit hash of all hooks in a batch — fed into the pattern
 * engine's `regenerateSalt` so each regenerate produces a different
 * (template, scenario, style) starting offset.
 */
function hashEntries(entries: CachedBatchEntry[]): number {
  let h = 2166136261;
  for (const e of entries) {
    const s = e.idea.hook;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return Math.abs(h | 0);
}

type ExclusionSet = {
  hooks: Set<string>;
  families: Set<string>;
  styles: Set<string>;
};

/**
 * HARD exclusion is split across two windows so we can guarantee
 * "no identical 3-hook batch in the last N batches" without
 * exhausting the family pool:
 *
 *   - `allHistory` (depth N=7 — PHASE Y10 widened from 5) →
 *     contributes excluded HOOK texts. Every hook the creator has
 *     been shown in the last 7 batches becomes off-limits, which
 *     mathematically prevents an identical 3-hook batch from
 *     re-appearing across the user-visible window.
 *
 *   - `immediatePrior` (depth 1) → contributes excluded FAMILIES
 *     and styles. Family exclusion only spans the immediately
 *     previous batch — extending it to depth 7 would shrink the
 *     pattern engine's candidate pool below the 3-pick threshold
 *     after a few regens (the pattern engine has ~20 families;
 *     7 batches × ~3 unique families each = ~17 excluded → only
 *     ~3 left, often not enough to satisfy the per-batch axis
 *     guards). Older-batch family repetition is handled SOFTLY by
 *     the novelty-context penalties below.
 */
function buildExclusion(
  allHistory: CachedBatchEntry[],
  immediatePrior: CachedBatchEntry[],
): ExclusionSet {
  const hooks = new Set<string>();
  for (const e of allHistory) {
    hooks.add(normalizeHook(e.idea.hook));
  }
  const families = new Set<string>();
  const styles = new Set<string>();
  for (const e of immediatePrior) {
    if (e.family) families.add(e.family);
    styles.add(e.idea.hookStyle);
  }
  return { hooks, families, styles };
}

const EMPTY_EXCLUSION: ExclusionSet = {
  hooks: new Set(),
  families: new Set(),
  styles: new Set(),
};

/**
 * HARD exclusion gate — drop any pattern candidate whose hook
 * (normalized) appears in the previous batch OR whose
 * `scenarioFamily` was used in the previous batch. This is what
 * makes regenerate=true feel actually fresh instead of returning
 * the same 3 hooks on repeat.
 */
function applyExclusion(
  candidates: PatternCandidate[],
  exclude: ExclusionSet,
): PatternCandidate[] {
  if (exclude.hooks.size === 0 && exclude.families.size === 0) {
    return candidates;
  }
  return candidates.filter((c) => {
    if (exclude.hooks.has(normalizeHook(c.idea.hook))) return false;
    if (exclude.families.has(c.meta.scenarioFamily)) return false;
    return true;
  });
}

/**
 * Same exclusion logic for Claude fallback ideas — but family info
 * is unavailable so we can only hard-exclude by hook. Style/family
 * repetition is handled downstream by the diversifier.
 */
function applyExclusionToFallback(
  ideas: Idea[],
  exclude: ExclusionSet,
): Idea[] {
  if (exclude.hooks.size === 0) return ideas;
  return ideas.filter((i) => !exclude.hooks.has(normalizeHook(i.hook)));
}

function toCacheEntries(picks: ScoredCandidate[]): CachedBatchEntry[] {
  return picks.map((c) => ({
    idea: c.idea,
    family: c.meta.scenarioFamily,
    templateId:
      c.meta.source === "pattern_variation" ? c.meta.templateId : undefined,
    hookLanguageStyle: c.meta.hookLanguageStyle,
    // VOICE PROFILES spec — persist alongside hookLanguageStyle so
    // the next regen's `buildNoveltyContext` can read the immediate-
    // prior + last-3 voice sets straight off the envelope without
    // a derivation step. Llama / Claude fallback wraps may omit
    // voiceProfile, in which case undefined flows through to the
    // cache and silently keeps that entry out of the cross-batch
    // voice levers (matches the hookLanguageStyle / templateId
    // pattern above).
    voiceProfile: c.meta.voiceProfile,
    // TREND CONTEXT LAYER spec — persist the injected trend id (when
    // one fired). Same non-breaking pattern as voiceProfile above —
    // most candidates ship with `trendId === undefined` (the gate
    // skips ~70% of candidates by design + soft-skip drops any that
    // failed validateTrendInjection), and undefined flows through to
    // the cache cleanly. The next regen's `buildNoveltyContext` reads
    // this field directly off the envelope to populate
    // `recentTrendIds` for the -2 cross-batch demotion lever.
    trendId: c.meta.trendId,
    // Phase 1 — persist ideaCoreType + ideaCoreFamily so the next
    // regen's `buildNoveltyContext` can derive the active family /
    // type axis directly off the envelope (no per-entry
    // `lookupIdeaCoreType` round-trip). Llama / Claude fallback wraps
    // may omit; undefined flows through cleanly and the next regen
    // falls back to the `lookupIdeaCoreType(family, templateId)`
    // derivation path for those entries.
    ideaCoreType: c.meta.ideaCoreType,
    ideaCoreFamily: c.meta.ideaCoreFamily,
    // Phase 3 HOOK TEMPLATE TUNING — persist the formulaic-template
    // skeleton id (when the picked LanguagePhrasingEntry carried
    // one). Same non-breaking pattern as `trendId` / `voiceProfile`
    // above: `meta.hookSkeletonId` is undefined for entries with
    // genuinely scenario-shaped phrasings (no skeleton tag) and for
    // Llama / Claude fallback wraps; undefined flows through to the
    // cache cleanly and the next regen's `buildNoveltyContext`
    // silently leaves that entry out of the recent / frequent
    // skeleton sets — which is the right behavior since an absent
    // tag should never accidentally match a fresh skeleton.
    hookSkeletonId: c.meta.hookSkeletonId,
    // Phase 6 (BIG PREMISE LAYER) — persist the premise-style id
    // (when the picked entry carried one). Same non-breaking pattern
    // as `hookSkeletonId` above: undefined for legacy template entries
    // (no `bigPremise` flag) and for Llama / Claude fallback wraps;
    // undefined flows through to the cache cleanly and the next
    // regen's `buildNoveltyContext` silently leaves that entry out
    // of `recentBigPremiseStyles`.
    bigPremiseStyle: c.meta.bigPremiseStyle,
    // Phase 6 EXPANSION — persist the fine-grained 50-style id so the
    // next regen's `buildNoveltyContext` can seed
    // `recentPremiseStyleIds`. Same discipline as the bucket field
    // above; undefined for entries without a fine-grained tag (the
    // original 29 hand-written premise entries + every legacy entry).
    premiseStyleId: c.meta.premiseStyleId,
    // Phase 6D (PREMISE EXECUTION EXPANSION) — persist the execution-
    // pattern id so the next regen's `buildNoveltyContext` can seed
    // `recentExecutionIds`. Same discipline as the style-level field
    // above; undefined for entries without an execution tag (the
    // original 29 hand-written premise entries + every legacy entry
    // + every Llama / Claude fallback wrap).
    executionId: c.meta.executionId,
    // Phase 6E (PREMISE COMEDY SCORING + REJECTION) — persist ONLY
    // the integer rubric total (0-10), not the per-dimension
    // breakdown. The cross-batch consumers (none today; this is
    // QA-driver telemetry only) need the headline number; the
    // per-dim split is runtime-only state for boost computation +
    // QA report tables. Same non-breaking JSONB pattern as the rest
    // of the Phase 6 fields above: undefined for legacy template
    // entries / Llama / Claude fallback wraps that didn't run
    // through the premise picker walk. Source: `meta.premiseComedy-
    // Score?.total` — the optional `?.` chain collapses to undefined
    // for both PatternMeta entries without the field set AND for
    // CandidateMeta fallback-shape entries (where the field is
    // declared on the union but never populated by the wrap path).
    premiseComedyScoreTotal:
      "premiseComedyScore" in c.meta &&
      c.meta.premiseComedyScore !== undefined
        ? c.meta.premiseComedyScore.total
        : undefined,
    // Phase 6F (LEGACY COMEDY SCORING + REJECTION) — symmetric
    // single-integer write parallel to `premiseComedyScoreTotal`
    // above. Source: `meta.legacyComedyScore?.total` — the
    // optional `?.` chain collapses to undefined for both
    // PatternMeta entries without the field set (premise picks +
    // pre-6F replays + cache rolls without the score) AND for
    // CandidateMeta fallback-shape entries (Llama/Claude wraps
    // where the field is declared on the union but not populated
    // by the wrap path; the Phase 6F Llama re-score guard in
    // `applyHookRewrite` DOES populate it on polish, so a
    // polished fallback wrap will carry a meaningful score
    // through to cache). Mutually exclusive with the premise
    // field on every well-formed candidate (the picker walk's
    // if/else assigns at most one rubric), so both fields can
    // safely co-exist on the cache shape without ambiguity.
    legacyComedyScoreTotal:
      "legacyComedyScore" in c.meta &&
      c.meta.legacyComedyScore !== undefined
        ? c.meta.legacyComedyScore.total
        : undefined,
    // Phase 7 (VIRAL FEEL SCORE) — symmetric single-integer persist
    // parallel to the comedy fields above. Unlike those (which are
    // mutually exclusive — premise OR legacy, never both on the
    // same candidate), the viral score is a final ranking polish
    // layer that runs symmetrically across premise + legacy entries
    // alike, so this field is set on EVERY well-formed
    // pattern_variation candidate. Source: `meta.viralFeelScore?.total`
    // — the optional `?.` chain collapses to undefined for both
    // PatternMeta entries without the field set (pre-Phase-7 cache
    // rolls — only `assembleCandidate` populates it today) AND
    // for CandidateMeta fallback-shape entries (Llama / Claude
    // wraps that didn't run through `assembleCandidate`; the field
    // is declared on the PatternMeta union, so the fallback shape
    // simply leaves it undefined). Same `"key" in c.meta` guard
    // pattern as the comedy fields so TypeScript narrows correctly
    // across the candidate-meta union without runtime allocation.
    viralFeelScoreTotal:
      "viralFeelScore" in c.meta &&
      c.meta.viralFeelScore !== undefined
        ? c.meta.viralFeelScore.total
        : undefined,
    // PHASE Y8 — persist the cohesive author's scenario fingerprint
    // (`sf_<12hex>`) on the cache envelope so the next regen's
    // `loadMemory` can populate `recentScenarioFingerprints` directly
    // off the envelope without re-deriving from
    // `(idea.whatToShow, idea.hook)` text after Llama polish. Source:
    // `meta.scenarioFingerprint` — a flat optional field on the
    // CandidateMeta union (set by `coreCandidateGenerator` for
    // core_native picks; absent for PatternMeta + Llama / Claude
    // fallback wraps, which the cross-batch fp gate intentionally
    // skips since those candidates don't author through the
    // (mechanism, anchor, action) recipe). Same non-breaking JSONB
    // pattern as the rest of the cache fields above — undefined
    // flows through cleanly and the next regen's harvest just skips
    // that entry. tryParseEntries above guards the read side with a
    // strict `/^sf_[0-9a-f]{12}$/` regex so a corrupt envelope can't
    // poison the recent fp set.
    scenarioFingerprint: c.meta.scenarioFingerprint,
    // PHASE Y10 — persist the cohesive author's resolved voice
    // cluster id on the cache envelope so the next regen's
    // `loadMemory` can build the `recentVoiceClusters` histogram
    // directly off the envelope without a derivation path. Source:
    // `meta.voiceClusterId` — a flat optional field on the
    // CandidateMeta union (set by `coreCandidateGenerator` for
    // core_native picks; absent for PatternMeta + Llama / Claude
    // fallback wraps which don't necessarily pick from the 4-cluster
    // taxonomy). Same non-breaking JSONB pattern as the rest of the
    // cache fields — undefined flows through cleanly and the next
    // regen's histogram build just skips that entry. tryParseEntries
    // above guards the read side with a 4-id whitelist so a corrupt
    // envelope can't poison the recent voice histogram.
    voiceClusterId:
      typeof c.meta.voiceClusterId === "string" &&
      _isVoiceClusterId(c.meta.voiceClusterId)
        ? c.meta.voiceClusterId
        : undefined,
  }));
}

/**
 * TREND + ARCHETYPE PAIRING spec — within-batch HARD CAP enforcing
 * ≤ N-1 trend-injected candidates per N-pick batch (so a 3-pick
 * batch ships with at most 2 candidates carrying `meta.trendId`).
 * The cap exists to prevent a "trend takeover" where every idea in
 * a single response feels like the same algorithmic flavor — the
 * spec calls out 3-of-3 trend injection as a hard ship-blocker
 * even when each individual injection is locally well-fit.
 *
 * Soft-skip semantics (mirrors `validateTrendInjection`): when the
 * cap is exceeded, we DON'T drop the candidate — instead we revert
 * its caption to the pre-trend snapshot stashed in
 * `meta.originalCaption` AND clear `meta.trendId`. The candidate
 * STILL ships, just untagged. The transformation isn't trivially
 * reversible from the transformed string alone (object swaps need
 * the original noun lookup, behavior/format/phrase appends shift
 * with idempotency normalization), so `assembleCandidate` snapshots
 * the source caption at injection time alongside `trendId` — the
 * two fields are paired 1-to-1 (both set together, both cleared
 * together).
 *
 * Selection priority — when more than (N-1) trend-injected
 * candidates exist, drop the LOWEST-priority ones first. Caller
 * supplies a `priorityOf` function so the helper stays
 * polymorphic across the main path (priority = score.total) and
 * the rescue path (priority = -index, since rescue candidates
 * aren't scored — earlier in the slice = higher priority by
 * convention). Ties broken by index ascending for determinism.
 *
 * Cap formula — `Math.max(1, n - 1)`: keeps the rule "≤ N-1" for
 * batches of 2+, but allows a single-idea batch to carry 1 trend
 * (the spec's "0-1 default" prose extends naturally; capping a
 * 1-pick batch at 0 trends would forbid the feature entirely on
 * single-idea responses, which the spec doesn't intend).
 *
 * Returns a NEW array — original picks are not mutated. Reverted
 * candidates are shallow-cloned (new `idea` + new `meta` objects);
 * unchanged candidates pass through by reference. Cache writes
 * downstream see the reverted state.
 */
export function enforceTrendCap<
  T extends { idea: Idea; meta: CandidateMeta },
>(picks: readonly T[], priorityOf: (c: T, i: number) => number): T[] {
  const n = picks.length;
  if (n === 0) return picks.slice();
  const maxAllowed = Math.max(1, n - 1);
  const trended: { i: number; p: number }[] = [];
  picks.forEach((c, i) => {
    if (c.meta.trendId !== undefined) {
      trended.push({ i, p: priorityOf(c, i) });
    }
  });
  if (trended.length <= maxAllowed) return picks.slice();
  // Sort ASCENDING by priority — lowest-priority entries land at
  // the front and become revert targets. Index tiebreak keeps the
  // pass deterministic across runs with identical scores.
  trended.sort((a, b) => a.p - b.p || a.i - b.i);
  const dropCount = trended.length - maxAllowed;
  const dropIndices = new Set(trended.slice(0, dropCount).map((t) => t.i));
  return picks.map((c, i) => {
    if (!dropIndices.has(i)) return c;
    const orig = c.meta.originalCaption;
    // Revert caption only when the snapshot exists. In practice
    // `originalCaption` is always present when `trendId` is — they
    // are written together by `assembleCandidate` — but the
    // optional-field discipline matches `voiceProfile` / `archetype`
    // (no runtime throws on missing optional meta fields).
    const newIdea: Idea =
      orig !== undefined ? { ...c.idea, caption: orig } : c.idea;
    const newMeta = {
      ...c.meta,
      trendId: undefined,
      originalCaption: undefined,
    } as CandidateMeta;
    return { ...c, idea: newIdea, meta: newMeta } as T;
  });
}

/**
 * PHASE UX3 — visible-hook exclusion filter. Two-tier defense
 * against the "I tapped refresh and got the same hook" failure
 * mode reported on closed-beta dogfooding:
 *
 *   1. HARD-REJECT — exact lowercased+trimmed hook match against
 *      any entry in `excludeHooks`. Drops the candidate from the
 *      pool entirely (no rewrite, no demote — the same hook
 *      coming back through deterministic local pattern paths is
 *      a definitive duplicate, period).
 *   2. SOFT-DEMOTE — bigram-Jaccard >= 0.5 against ANY excluded
 *      hook. Keeps the candidate in the pool but subtracts 8
 *      from `score.total` so the novelty selector below
 *      naturally prefers a different candidate when one exists.
 *      Same threshold the existing skeleton-similarity guard
 *      uses (`hookBigramJaccard`); -8 is calibrated against the
 *      0-100 score band so the demoted candidate STAYS competitive
 *      with novel candidates near the bottom of the cut, but
 *      LOSES to any novel candidate clustered around the median.
 *
 * Pure / synchronous / no I/O. No-op when the exclusion set is
 * empty — same compile-time cost as the legacy path. Returns a
 * fresh array; never mutates inputs (selectionPenalty downstream
 * reads `score.total` and the score type is shared, so we MUST
 * spread `c.score` before overriding `total`).
 */
function applyExcludeHooksFilter(
  scored: ScoredCandidate[],
  excludeHooks: ReadonlySet<string>,
  excludeBigrams: ReadonlyArray<Set<string>>,
): ScoredCandidate[] {
  if (excludeHooks.size === 0) return scored;
  const out: ScoredCandidate[] = [];
  for (const c of scored) {
    const hookKey = c.idea.hook.toLowerCase().trim();
    if (excludeHooks.has(hookKey)) {
      // Hard-reject: drop entirely.
      continue;
    }
    let maxJacc = 0;
    if (excludeBigrams.length > 0) {
      const cBg = hookWordBigrams(c.idea.hook);
      for (const xBg of excludeBigrams) {
        const j = hookBigramJaccard(cBg, xBg);
        if (j > maxJacc) maxJacc = j;
      }
    }
    if (maxJacc >= 0.5) {
      out.push({
        ...c,
        score: { ...c.score, total: c.score.total - 8 },
      });
    } else {
      out.push(c);
    }
  }
  return out;
}

/**
 * Wrap a Claude `Idea` as a scorer candidate. The fallback loses the
 * `scenarioFamily` we'd get from pattern_variation, so the scorer
 * tie-breakers naturally prefer pattern_variation when scores match.
 */
function wrapFallbackIdea(idea: Idea): { idea: Idea; meta: CandidateMeta } {
  // PHASE Y (PREMISE CORE LIBRARY) — mirror `idea.premiseCoreId` into
  // meta so the cross-batch demotion lever in `selectionPenalty`
  // (which reads via `metaPremiseCoreId(c.meta)`) sees the core
  // tag without a per-variant guard. Same discipline as
  // `bigPremiseStyle` / `premiseStyleId` mirroring on the catalog
  // path. Absent on Layer-3 batches that weren't seeded with cores
  // (the model emits no id, so the field stays undefined and the
  // lever silently abstains for that wrap).
  const meta: CandidateMeta = { source: "claude_fallback" };
  if (typeof idea.premiseCoreId === "string" && idea.premiseCoreId.length > 0) {
    (meta as { premiseCoreId?: string }).premiseCoreId = idea.premiseCoreId;
  }
  return { idea, meta };
}

// -----------------------------------------------------------------------------
// Cache
// -----------------------------------------------------------------------------

async function tryCache(
  creator: Creator | undefined,
  regenerate: boolean,
): Promise<Idea[] | null> {
  if (!creator) return null;
  if (regenerate) return null;
  if (creator.isDemo) return null;
  const today = utcToday();
  // Drizzle's `date` column returns a `YYYY-MM-DD` string by default
  // (no `mode: "date"`), so direct string compare is correct.
  const cachedDate = creator.lastIdeaBatchDate;
  if (!cachedDate || cachedDate !== today) return null;
  const env = tryParseCachedEnvelope(creator.lastIdeaBatchJson);
  if (!env || env.current.length === 0) return null;
  return env.current.map((e) => e.idea);
}

/**
 * Read the rolling batch history (regardless of date) for exclusion
 * + novelty purposes during regenerate. Returns:
 *   - `current`: the most recently shipped batch (used for HARD
 *     family/style exclusion, depth 1).
 *   - `flat`: `current` + up to `MAX_HISTORY_BATCHES` prior batches,
 *     flattened newest-first (used for HARD hook exclusion + novelty
 *     context, depth up to 5).
 * Stale-day batches are still valuable input — they tell us what
 * the creator has seen recently.
 */
function readBatchHistory(
  creator: Creator | undefined,
): {
  flat: CachedBatchEntry[];
  current: CachedBatchEntry[];
  /**
   * Per-batch breakdown — index 0 = current (newest), indices 1+
   * are prior batches from `envelope.history`, newest-first. Same
   * depth as `flat` (capped at MAX_HISTORY_BATCHES + 1). Used by
   * the cross-batch tiered scriptType history (frequent-in-3 /
   * unused-in-3) which needs per-batch composition, not just the
   * flat union.
   */
  perBatch: CachedBatchEntry[][];
} {
  if (!creator) return { flat: [], current: [], perBatch: [] };
  const env = tryParseCachedEnvelope(creator.lastIdeaBatchJson);
  if (!env) return { flat: [], current: [], perBatch: [] };
  const flat: CachedBatchEntry[] = [];
  const perBatch: CachedBatchEntry[][] = [];
  if (env.current.length > 0) {
    flat.push(...env.current);
    perBatch.push(env.current);
  }
  for (const h of env.history) {
    flat.push(...h);
    perBatch.push(h);
  }
  return { flat, current: env.current, perBatch };
}

async function persistCache(
  creator: Creator | undefined,
  entries: CachedBatchEntry[],
): Promise<void> {
  if (!creator || creator.isDemo) return;
  if (entries.length === 0) return;
  // Read existing envelope, archive its `current` to the head of
  // history, cap history at MAX_HISTORY_BATCHES, then write the new
  // envelope with the just-shipped entries as the new `current`.
  const existing =
    tryParseCachedEnvelope(creator.lastIdeaBatchJson) ?? {
      current: [],
      history: [],
    };
  const newHistory: CachedBatchEntry[][] = [];
  if (existing.current.length > 0) {
    newHistory.push(existing.current);
  }
  for (const h of existing.history) {
    if (newHistory.length >= MAX_HISTORY_BATCHES) break;
    newHistory.push(h);
  }
  const envelope: { version: 2; current: CachedBatchEntry[]; history: CachedBatchEntry[][] } = {
    version: 2,
    current: entries,
    history: newHistory,
  };
  try {
    await db
      .update(schema.creators)
      .set({
        lastIdeaBatchJson: envelope,
        lastIdeaBatchDate: utcToday(),
        lastIdeaBatchAt: sql`now()` as unknown as Date,
      })
      .where(eq(schema.creators.id, creator.id));
  } catch (err) {
    // Cache persistence is best-effort — never fail the request
    // because we couldn't stash the batch for tomorrow.
    logger.warn(
      { err, creatorId: creator.id },
      "hybrid_ideator.cache_persist_failed",
    );
  }
}

// -----------------------------------------------------------------------------
// Memory loader (mirrors generateIdeas' own logic)
// -----------------------------------------------------------------------------

async function loadMemory(
  input: HybridIdeatorInput,
  onboardingSeed: OnboardingSeed | null,
): Promise<ViralPatternMemory> {
  if (input.viralPatternMemory) return input.viralPatternMemory;
  const cid = input.ctx?.creatorId ?? input.creator?.id;
  if (!cid) {
    // No creator id (curl bench path or brand-new account whose row
    // hasn't been resolved yet). If the seed is available we still
    // surface it — applyOnboardingSeed against EMPTY_MEMORY produces
    // the cold-start synthetic snapshot that the prompt block knows
    // how to render. Without a seed we fall back to the empty shape.
    if (onboardingSeed) {
      return applyOnboardingSeed(EMPTY_MEMORY, onboardingSeed, 0);
    }
    return EMPTY_MEMORY;
  }
  try {
    return await computeViralPatternMemory(cid, { onboardingSeed });
  } catch {
    return EMPTY_MEMORY;
  }
}

// -----------------------------------------------------------------------------
// Public entry point
// -----------------------------------------------------------------------------

export async function runHybridIdeator(
  input: HybridIdeatorInput,
): Promise<HybridIdeatorResult> {
  const startedAt = Date.now();
  const desiredCount = Math.max(1, Math.min(input.count ?? 3, 20));
  const profile: StyleProfile = input.styleProfile ?? DEFAULT_STYLE_PROFILE;
  const regenerate = input.regenerate ?? false;

  // -------- Step 1: cache check -----------------------------------
  const cached = await tryCache(input.creator, regenerate);
  if (cached && cached.length >= desiredCount) {
    const ideas = cached.slice(0, desiredCount);
    logger.info(
      {
        source: "cache",
        creatorId: input.creator?.id,
        count: ideas.length,
        durationMs: Date.now() - startedAt,
        // Y4 telemetry counters (PART 6 schema-consistency).
        // Cache replay does not run selectionPenalty against a fresh
        // novelty context, so these counters are not measurable on
        // this path — emit 0 so downstream parsers don't NPE on the
        // missing keys and so dashboard aggregations stay correct.
        selectedRepeatedPremiseStyleCount: 0,
        selectedRepeatedExecutionCount: 0,
        selectedRepeatedPremiseCoreCount: 0,
        selectedSameStyleExecutionCount: 0,
        selectedSameStyleExecutionCoreCount: 0,
        // PHASE Y5 telemetry zero-defaults (cache replay never runs
        // the core-native generator, so these counters are NA on
        // this path — same discipline as the Y4 counters above).
        coreNativeGeneratedCount: 0,
        coreNativeKeptCount: 0,
        coreNativeSelectedCount: 0,
        coreNativeSelectedRate: 0,
        localSelectedCount: 0,
        topSelectedSources: [] as Array<{ source: string; count: number }>,
        selectedPremiseCoreIds: [] as string[],
        coreNativeRejectionReasons: {
          no_contradiction: 0,
          no_tension: 0,
          generic_observation: 0,
          too_soft: 0,
          hook_scenario_mismatch: 0,
          filming_mismatch: 0,
          copied_seed_hook: 0,
          near_duplicate_premise: 0,
          schema_invalid: 0,
          // Y6 — cohesive author construction-precondition counter.
          construction_failed: 0,
        },
        // PHASE Y6 telemetry zero-defaults (cache replay ships no
        // core-native candidates so neither fingerprints nor anchors
        // are measurable on this path).
        scenarioFingerprintsThisBatch: [] as string[],
        coreNativeAnchorsUsed: [] as string[],
      },
      "hybrid_ideator.served",
    );
    return {
      ideas,
      source: "cache",
      usedFallback: false,
      counts: { localKept: 0, fallbackKept: 0 },
    };
  }

  // -------- Step 2: regenerate exclusion + salt + novelty ctx ----
  // Read the rolling batch history (current + up to MAX_HISTORY_BATCHES
  // prior batches) so the novelty scorer + HARD exclusion gate see
  // not just the immediately-previous batch but everything the
  // creator has been shown recently. Without this, regen #2 happily
  // re-ships seed's combo (regen #1 overwrites the cache → seed
  // looks "fresh" again on the next call). The HARD exclusion gate
  // (`buildExclusion`) is still regenerate-only — non-regen
  // requests should be free to ship the same family if the scorer
  // thinks it's the best fit, just with a small novelty penalty for
  // repeating it.
  const {
    flat: previousEntries,
    current: immediatePriorEntries,
    perBatch: priorBatches,
  } = readBatchHistory(input.creator);
  const exclude = regenerate
    ? buildExclusion(previousEntries, immediatePriorEntries)
    : EMPTY_EXCLUSION;
  // Cross-batch tiered scriptType history needs per-batch breakdown
  // (not the flat union). Slice to the last 3 batches per spec —
  // beyond that, the rotate-the-catalog signal becomes too diffuse
  // to reliably steer pick selection.
  const last3Batches = priorBatches.slice(0, 3);
  const noveltyContext: NoveltyContext = buildNoveltyContext(
    previousEntries,
    last3Batches,
    // Phase 3 HOOK TEMPLATE TUNING — pass the FULL visible per-
    // batch breakdown (not just last 3) so `buildNoveltyContext`
    // can compute the session-wide `hookSkeletonsAtSessionCap` set.
    // The last-3 levers above only catch back-to-back / 2-of-3
    // repeats; this third tier closes the every-other-batch
    // (batches 2+4+6) repeat hole that escapes both windows.
    priorBatches,
  );
  // Phase Z5.6 — thread the adaptive first-session boost factor into
  // the novelty context so `selectionPenalty` can apply broad-safe
  // lane boosts for cold-start creators. The factor decays with batch
  // history depth and drops to 0 when taste calibration exists.
  noveltyContext.firstSessionBoostFactor = computeFirstSessionBoostFactor(
    priorBatches.length,
    input.tasteCalibrationJson != null &&
      input.tasteCalibrationJson !== undefined,
  );
  // PHASE Z5.8b — thread the creator's multi-select Quick Tune
  // situations into the novelty context so `selectionPenalty` can
  // apply the additive alignment delta (+4 strong / +2 adjacent /
  // 0 neutral / -1 mismatch when ≥3 selected). Pure + additive: an
  // empty Set (cold-start, skipped calibration, missing
  // selectedSituations field on a legacy doc) is a silent no-op
  // inside `scoreSituationAlignment`. We re-parse the calibration
  // here rather than threading the parsed object so this lever stays
  // co-located with the other novelty-context wiring; downstream
  // `parseTasteCalibration` calls in this function (line ~3500)
  // remain unchanged.
  {
    const calForSituations = parseTasteCalibration(input.tasteCalibrationJson);
    const sitArr = calForSituations?.selectedSituations ?? [];
    if (sitArr.length > 0) {
      noveltyContext.selectedSituations = new Set(sitArr);
    }
  }
  // PHASE X2 — PART 4 — collect normalized premise sentences from
  // the last-7 visible batches' cached `idea.premise` fields (PHASE
  // Y10 widened from 5 → 7 batches; the slice is the shared
  // freshness window also feeding `recentAnchors`,
  // `recentScenarioFingerprints`, and `recentVoiceClusters` below). Set
  // is empty for cold-start creators and for legacy entries
  // written before the premise field was persisted (the field is
  // optional on Idea — Layer-1 candidates don't carry it; only
  // Layer-3 Claude candidates that explicitly ride the premise-
  // first prompt do). The validator no-ops on an empty set, so
  // there is no harm in a sparse history. Window sized at 5
  // batches per spec (wider than the last-3 mechanism window
  // because exact-premise duplication is a sharper signal — a
  // creator notices a verbatim premise repeat across 5 batches,
  // not just the immediate prior).
  const last7BatchesForFreshness = priorBatches.slice(0, 7);
  const recentPremises = new Set<string>();
  for (const batch of last7BatchesForFreshness) {
    for (const e of batch) {
      const p = e.idea.premise;
      if (typeof p === "string" && p.length > 0) {
        const fp = normalizeHookFingerprint(p);
        if (fp.length > 0) recentPremises.add(fp);
      }
    }
  }
  // PHASE Y7 — anchor freshness memory. Probe each cached idea's
  // whatToShow / hook against the catalog vocabulary via
  // `extractAnchorAndAction`. Window matches `recentPremises` (last
  // 7 visible batches — PHASE Y10 widened from 5 → 7) so all
  // freshness channels stay aligned. Empty set
  // for cold-start creators OR for batches whose ideas don't carry
  // a recognizable catalog anchor (Layer-1 Llama / Claude fallback
  // wraps don't necessarily ship catalog vocabulary — the probe
  // silently misses on those, which is fine: false absence ≠ false
  // staleness, the recipe queue just reverts to the salt-rotated
  // start position for that anchor). Threaded into the recipe queue
  // via `noveltyContext.recentAnchors` below.
  const recentAnchors = new Set<string>();
  {
    const anchorVocab = getAllCatalogAnchors();
    const actionVocab = new Set<string>(
      Object.values(FAMILY_ACTIONS).map((a) => a.bare),
    );
    for (const batch of last7BatchesForFreshness) {
      for (const e of batch) {
        const probe = extractAnchorAndAction(e.idea, anchorVocab, actionVocab);
        if (probe.anchor) recentAnchors.add(probe.anchor.toLowerCase());
      }
    }
  }
  // PHASE Y8 — scenario fingerprint freshness memory. Flat read off
  // each cached entry's `scenarioFingerprint` field (Y8 widened
  // CachedBatchEntry to persist the fp directly on the envelope; see
  // `tryParseEntries` for the strict `/^sf_[0-9a-f]{12}$/` tolerant
  // parse + `toCacheEntries` for the write side). Window matches
  // `recentAnchors` / `recentPremises` (last 7 visible batches — PHASE
  // Y10 widened from 5 → 7) so all freshness channels stay aligned.
  // Empty set for cold-start
  // creators (no batch json), for batches whose entries predate Y6's
  // fingerprint write, and for entries from Llama / Claude fallback
  // wraps (no fp computation path). Threaded into
  // `generateCoreCandidates` via `noveltyContext.recentScenarioFingerprints`
  // below; `coreCandidateGenerator` uses it as an O(1) HARD-REJECT
  // signal — recipes whose freshly-authored idea fingerprints land
  // in this set are dropped with reason `scenario_repeat`, the
  // recipe iterator advances. Catches the structural-repeat failure
  // mode anchor freshness alone misses ("ghosted my to-do list" and
  // "abandoned my checklist" share an fp via the synonym map).
  const recentScenarioFingerprints = new Set<string>();
  for (const batch of last7BatchesForFreshness) {
    for (const e of batch) {
      if (e.scenarioFingerprint) {
        recentScenarioFingerprints.add(e.scenarioFingerprint);
      }
    }
  }
  // PHASE Y10 — voice cluster freshness memory. Build a HISTOGRAM
  // (Map<VoiceClusterId, number>) of voice cluster usages across the
  // same last-7-batches window the other freshness channels read
  // from. Reads `e.voiceClusterId` off each cached entry (Y6 wrote
  // it; see `tryParseEntries` + `toCacheEntries`). Coerces only
  // valid `VoiceClusterId` values (drops unknowns silently — same
  // tolerant pattern as the fingerprint loop). Threaded into
  // `generateCoreCandidates` via `noveltyContext.recentVoiceClusters`
  // below. With only 4 voice clusters, a Set-based exclusion would
  // starve the picker after 1-2 batches; using a histogram lets the
  // resolver pick the LEAST-RECENTLY-USED cluster every recipe
  // (preserves family-bias as tiebreak). Empty Map for cold-start
  // creators (no batch json) and for entries written before Y6
  // started persisting voiceClusterId — the resolver no-ops on an
  // empty histogram and falls through to the existing salt-rotated
  // family-biased table.
  const recentVoiceClusters = new Map<VoiceClusterId, number>();
  for (const batch of last7BatchesForFreshness) {
    for (const e of batch) {
      const v = e.voiceClusterId;
      if (typeof v === "string" && _isVoiceClusterId(v)) {
        recentVoiceClusters.set(v, (recentVoiceClusters.get(v) ?? 0) + 1);
      }
    }
  }
  // PHASE Y (PREMISE CORE LIBRARY) — collect the last-5-batches set
  // of `idea.premiseCoreId` values that have already shipped to this
  // creator. Used by `selectPremiseCores` below to demote recent
  // cores at SELECTION time so the LLM never even sees a recently-
  // shipped core in its seeded list (this is the SUPPLY-SIDE lever;
  // the cross-batch -3/+2 demotion in `selectionPenalty` is the
  // separate DEMAND-SIDE lever — they stack). Sized at 5 batches to
  // match the `recentPremises` window above; the cores library
  // selector already enforces ≥1 fresh-core swap when history is
  // non-empty so the picker can't starve even if 4 of the 5
  // remembered cores share a family with the active mechanism
  // weights. Empty Set for cold-start creators (selector treats as
  // no contribution and falls through to pure FAMILY_DEFAULT_TASTE_WEIGHT
  // sampling).
  const recentPremiseCoreIdsForSeeding = new Set<string>();
  // Mechanism strings drawn from those same recent ids — derived
  // here (not on the cache envelope) so the cache shape stays
  // unchanged. Unknown ids (e.g. cores trimmed from a future
  // catalog revision) silently drop; same tolerant pattern as
  // `parsePremiseStyleId` above.
  const recentMechanismsForSeeding = new Set<string>();
  for (const batch of last7BatchesForFreshness) {
    for (const e of batch) {
      const cid = e.idea.premiseCoreId;
      if (typeof cid === "string" && cid.length > 0) {
        recentPremiseCoreIdsForSeeding.add(cid);
        const core = getPremiseCoreById(cid);
        if (core) recentMechanismsForSeeding.add(core.mechanism);
      }
    }
  }
  // `>>> 0` coerces the XOR result to an unsigned 32-bit int so the
  // subsequent `% 997` is always non-negative (JS keeps the sign of
  // the dividend, so a negative seedSalt would produce negative
  // array offsets downstream).
  const regenerateSalt = regenerate
    ? ((hashEntries(previousEntries) ^ Date.now()) >>> 0) % 997
    : undefined;

  // -------- Step 3: Layer 1 + Layer 2 ----------------------------
  // Parse the persisted vision-style doc once at the orchestrator
  // boundary so both the local and fallback rescore paths see the
  // same `derivedStyleHints` snapshot. `parseVisionStyleDoc` is
  // tolerant of NULL / malformed shapes (returns the empty doc),
  // and `derivedStyleHints` is itself empty under the per-video
  // threshold, so for new creators / pre-v21 rows this is a strict
  // no-op — `filterAndRescore` short-circuits inside `applyVisionBoost`.
  // PHASE Y9 — moved ABOVE loadMemory so the onboarding seed (which
  // depends on visionDoc + calibration + profile) can be built and
  // threaded into computeViralPatternMemory in a single load pass.
  const visionDoc = parseVisionStyleDoc(input.visionStyleJson ?? null);
  const derivedStyleHints = visionDoc.derivedStyleHints;
  const calibrationForSeed = parseTasteCalibration(input.tasteCalibrationJson);
  // Seed building is a pure function over already-parsed inputs —
  // returns null when none of the three onboarding docs contributed
  // anything (default style profile, no calibration, empty vision
  // doc) so the load path falls through to the legacy behaviour-only
  // memory pipeline unchanged.
  const onboardingSeed = buildOnboardingSeed({
    tasteCalibration: calibrationForSeed,
    styleProfile: input.styleProfile ?? null,
    visionStyleDoc: visionDoc,
  });
  const memory = await loadMemory(input, onboardingSeed);
  if (memory.seededFromOnboarding === true && onboardingSeed) {
    // Single info log per request when the seed actually got
    // applied (cold-start OR warm-up merge — driven by the
    // `seededFromOnboarding` flag the load helper stamps). Captures
    // which onboarding sources contributed for ops debugging; the
    // log fires only once per request so it's safe to leave on at
    // INFO level.
    logger.info(
      {
        creatorId: input.ctx?.creatorId ?? input.creator?.id ?? null,
        seedSampleSize: onboardingSeed.sampleSize,
        seedSources: onboardingSeed.sources,
        memorySampleSize: memory.sampleSize,
      },
      "phase_y9.viral_memory_seeded_from_onboarding",
    );
  }
  // VOICE PROFILES spec — resolve the primary voice ONCE at the
  // orchestrator boundary so:
  //   1) generatePatternCandidates skips its hint-only fallback and
  //      sees the FULL priority chain (calibration → hints → vision);
  //   2) noveltyContext.voiceStrongPreference can relax the hard 3-
  //      identical-voice batch guard ONLY when the creator's
  //      calibration explicitly locked the voice (hints + vision
  //      stay strict — they're inferred, not user-stated).
  // Tolerant parsing throughout: parseTasteCalibration returns the
  // empty defaults on null / malformed input; visionDoc was already
  // built tolerantly above; rotationSeed falls back to a stable 0
  // when not regenerating (deterministic per-creator default
  // rotation between self_aware and dry_humor).
  // PHASE Y9 — reuse the parse from above (used to build the
  // onboarding seed) so we don't double-parse the same jsonb blob.
  const retentionProfile = buildRetentionProfile(last3Batches);
  if (retentionProfile.batchDepth >= 2 && memory.sampleSize >= 3) {
    noveltyContext.retentionMemory = memory;
    noveltyContext.retentionProfile = retentionProfile;
  }
  const calibration = calibrationForSeed;
  // Vision tier — majority-mode aggregation of `deliveryStyle` across
  // the per-video signals. We deliberately ignore `unknown` (it's the
  // parser's null-stand-in for missing/malformed signals; counting it
  // as a real value would let "noisy uploads" outvote a creator's
  // actual deadpan/awkward/etc cluster). Ties broken by the most-
  // recent occurrence — perVideoSignals are stored newest-first by
  // mergeAnalysisIntoDoc so the first occurrence in a tied bucket
  // also wins recency. Empty / all-unknown → null (vision tier
  // skipped, falls through to default rotation).
  let visionDelivery:
    | "deadpan"
    | "awkward"
    | "expressive"
    | "confident"
    | "chaotic"
    | "unknown"
    | null = null;
  if (visionDoc.perVideoSignals.length > 0) {
    const counts: Record<string, number> = {};
    let bestKey: string | null = null;
    let bestCount = 0;
    for (const sig of visionDoc.perVideoSignals) {
      const k = sig.deliveryStyle;
      if (k === "unknown") continue;
      const next = (counts[k] ?? 0) + 1;
      counts[k] = next;
      if (next > bestCount) {
        bestCount = next;
        bestKey = k;
      }
    }
    visionDelivery = (bestKey as typeof visionDelivery) ?? null;
  }
  const voiceSelection: VoiceProfileSelection = selectPrimaryVoiceProfile({
    // Tier 1 — calibration is the only user-stated tier (strong
    // preference). `parseTasteCalibration` returns `null` on
    // missing/malformed; coalesce to `null` literal so the resolver
    // skips this tier without throwing.
    calibrationTone: calibration?.preferredTone ?? null,
    // Tier 2 — derived hints tone is reserved for a future schema
    // enhancement. `DerivedStyleHints` does NOT currently carry a
    // `tone` axis (only formats / settings / energy / framing /
    // reactionTypes), so we pass null and the priority chain
    // gracefully falls through to vision (tier 3) or default.
    hintsTone: null,
    // Tier 3 — vision delivery, majority-mode aggregation above.
    visionDelivery,
    rotationSeed: regenerateSalt ?? 0,
  });
  noveltyContext.voiceStrongPreference = voiceSelection.strongPreference;
  // Generate enough pattern candidates to cover the requested count
  // even after hard-rejects + scoring drops: target = max(16, desired + 4)
  // capped at 20 (the engine's hard ceiling). For desiredCount=3 this
  // stays at 16; for desiredCount=20 it bumps to 20.
  const candidateTarget = Math.max(16, Math.min(desiredCount + 4, 20));
  const rawCandidates: PatternCandidate[] = generatePatternCandidates({
    count: candidateTarget,
    profile,
    memory,
    recentScenarios: input.recentScenarios,
    regenerate,
    regenerateSalt,
    voiceSelection,
  });
  // HARD-exclude any candidate matching the previous batch's hooks
  // or scenarioFamilies. This is the core of the regenerate fix —
  // the diversifier alone can't conjure freshness from a stale pool.
  const localCandidatesPreCoherence = applyExclusion(rawCandidates, exclude);
  // PHASE UX3.1 — coherence guard on the pattern engine path.
  // Pre-UX3.1 the validator only ran inside `cohesiveIdeaAuthor`
  // (the core-native path), which let pattern-engine candidates
  // ship with template-stiffness phrases, hook↔scenario noun-cluster
  // mismatches ("yesterday me booked chaos for today me's calendar"
  // attached to a mug/cart), and verb-anchor implausibilities
  // ("abandon the fork", "ghost the calendar"). We now apply the
  // SAME validator on the pattern path before merging into the
  // local pool. Per-reason rejection counts surface in the
  // validation_summary log under `coherenceRejections` so we can
  // distinguish from the existing `localRejections` (scoring/anti-
  // copy) channel.
  const coherenceRejections: Record<string, number> = {};
  const localCandidates = localCandidatesPreCoherence.filter((c) => {
    const reason = validateScenarioCoherence(c.idea);
    if (reason) {
      coherenceRejections[reason] = (coherenceRejections[reason] ?? 0) + 1;
      return false;
    }
    return true;
  });
  if (Object.keys(coherenceRejections).length > 0) {
    logger.info(
      {
        event: "phase_ux3_1.pattern_coherence_filter",
        creatorId: input.creator?.id,
        regenerate,
        preCount: localCandidatesPreCoherence.length,
        postCount: localCandidates.length,
        rejected:
          localCandidatesPreCoherence.length - localCandidates.length,
        coherenceRejections,
      },
      "phase_ux3_1.pattern_coherence_filter",
    );
  }
  // -------- PHASE Y5: SAFE PARALLEL core-native generation ---------
  // Independent supply-side step from the Y2 fallback path (which is
  // gated by `needFallback` and ALSO calls `selectPremiseCores` for
  // its Claude prompt). This selection is unconditional and produces
  // LOCAL candidates that compete head-to-head with `pattern_variation`
  // in the same `filterAndRescore` pass — no forced slots, no replace,
  // no cost. Validation gates (`validateComedy` + `validateAntiCopy`)
  // are re-run inside the generator so a bad seed-execution pairing
  // is dropped before it ever reaches the merged pool. Selector here
  // re-uses the SAME recent-id / recent-mechanism sets so the supply
  // side stays aligned with the existing demand-side -3 demotion in
  // `selectionPenalty`.
  const coreNativeSelection = selectPremiseCores({
    count: desiredCount + 2,
    recentCoreIds: recentPremiseCoreIdsForSeeding,
    recentMechanisms: recentMechanismsForSeeding,
    // Default rng (Math.random) — matches the existing Y2 call site
    // wiring at L3305. The generator's own picks (style / execution /
    // example) are seeded by `regenerateSalt` for determinism on
    // regenerate; the core selection itself is allowed to vary across
    // calls so the supply pool isn't pinned to one fixed slate.
  });
  // PHASE N1-LIVE-INSTRUMENT — opt-in live throttle observer for
  // diagnosing why pack candidates fail to surface for a real
  // creator's actual core slate. Default OFF; enable per-process
  // by setting `LUMINA_NG_THROTTLE_LOG=true` in dev. When ON, we
  // (a) install the observer global the pack-prefix block in
  // `coreCandidateGenerator.ts` already speaks to (PHASE
  // N1-INSTRUMENT v2 — additive, no behavior change), (b) collect
  // its records into a local array for THIS call only, (c) restore
  // the prior global immediately after the call so concurrent
  // requests cannot leak observers across each other. The records
  // are then dumped through `logger.info` so they appear in the
  // existing pino stream alongside the rest of the per-request
  // telemetry. Production is off by default and never sets this
  // env var; this is a developer-only debug surface.
  const _liveThrottleEnabled =
    process.env.LUMINA_NG_THROTTLE_LOG === "true";
  type LiveThrottleRec = {
    coreId: string;
    eligible: number;
    matching: number;
    attempted: number;
    authoredOk: number;
    survivedFpDedup: number;
    enteredPassing: number;
    validatorRejectsByReason: Record<string, number>;
    rejectedEntrySamples: Array<{
      entryHook: string;
      entryAnchor: string;
      reason: string;
    }>;
  };
  const _liveThrottleRecords: LiveThrottleRec[] = [];
  const _priorObserver = (
    globalThis as { __nigerianThrottleObserver?: unknown }
  ).__nigerianThrottleObserver;
  if (_liveThrottleEnabled) {
    (
      globalThis as {
        __nigerianThrottleObserver?: (rec: LiveThrottleRec) => void;
      }
    ).__nigerianThrottleObserver = (rec: LiveThrottleRec) => {
      _liveThrottleRecords.push(rec);
    };
  }
  // PHASE N1-LIVE-HARDEN PACK-AWARE-RETENTION (BI 2026-05-07) —
  // hoist the per-creator Nigerian pack memory snapshot ABOVE the
  // core-native generator so its pack-aware per-core retention block
  // can skip already-seen pack entryIds (avoids cross-batch pack
  // repeats). The same Set is reused below by the slot-reservation
  // call (`excludeEntryIds`), so this hoist is read-budget-neutral
  // when active and ELIMINATES the read entirely for non-NG cohorts.
  // Gating is the full NG activation context (region + languageStyle
  // ∈ {pidgin, light_pidgin} + LUMINA_NG_PACK_ENABLED) so flag-ON,
  // non-NG cohorts pay nothing. The helper swallows errors and
  // returns an empty Set on missing creator / DB failure / empty
  // column.
  const _hoistedLanguageStyle = calibration?.languageStyle ?? null;
  const _hoistedNgEligible =
    input.region === "nigeria" &&
    (_hoistedLanguageStyle === "pidgin" ||
      _hoistedLanguageStyle === "light_pidgin") &&
    process.env.LUMINA_NG_PACK_ENABLED === "true";
  const _hoistedNigerianPackSeenIds: ReadonlySet<string> = _hoistedNgEligible
    ? await getRecentSeenEntryIds(input.creator?.id)
    : new Set<string>();
  // Pack-aware retention is staging-only. When OFF we still benefit
  // from the hoisted Set being reused at the slot-reservation site
  // below; the core generator simply receives an empty Set and the
  // pack-aware retention block no-ops on the `.has()` check.
  const _packAwareRetentionFlag =
    process.env.LUMINA_NG_PACK_AWARE_RETENTION_ENABLED === "true";
  const _recentNigerianPackEntryIdsForRetention: ReadonlySet<string> =
    _packAwareRetentionFlag ? _hoistedNigerianPackSeenIds : new Set<string>();
  const coreNativeResult = generateCoreCandidates({
    cores: coreNativeSelection.cores,
    count: desiredCount + 2,
    recentNigerianPackEntryIds: _recentNigerianPackEntryIdsForRetention,
    noveltyContext: {
      recentPremiseStyleIds: noveltyContext.recentPremiseStyleIds,
      recentExecutionIds: noveltyContext.recentExecutionIds,
      // PHASE Y7 — anchor freshness channel: O(1) Set.has probe in
      // `buildRecipeQueue` against the lowercased catalog
      // vocabulary harvested above from the last-5-batches' cached
      // ideas. Empty set for cold-start (no batch json) and for
      // batches whose ideas don't carry catalog vocabulary; the
      // queue then reverts to the Y6 word-boundary regex over
      // `recentPremises` for back-compat (handled inside
      // `buildRecipeQueue`).
      recentAnchors,
      // PHASE Y8 — scenario fingerprint dedup channel: O(1) Set.has
      // HARD-REJECT in `coreCandidateGenerator`'s recipe loop against
      // the `sf_<12hex>` codes harvested above from the last-7-
      // batches' cached entries (PHASE Y10 widened the window). Recipes
      // whose freshly-authored idea fingerprints land in this set are
      // dropped with reason `scenario_repeat` and the iterator advances.
      // Empty set for cold-start (no batch json) — the gate stays quiet
      // and every recipe ships, which is the correct behavior for a
      // creator with no history. Pairs with the in-batch fp tracker
      // inside `coreCandidateGenerator` (mirrors `usedAnchorsThisBatch`)
      // for full coverage across cross-batch + intra-batch dedup.
      recentScenarioFingerprints,
      // PHASE Y10 — voice cluster freshness channel. Histogram of
      // voice cluster usages across the last 7 visible batches.
      // Threaded into `resolveVoiceCluster` (see coreCandidateGenerator)
      // which picks the LEAST-RECENTLY-USED cluster from the family-
      // biased rotation table. Empty Map for cold-start creators — the
      // resolver no-ops on an empty histogram and falls through to the
      // existing salt-rotated family-biased table. Family bias (the
      // family's curated default appears 3x in the rotation table) is
      // preserved as the natural tiebreak when multiple clusters share
      // the min recency count.
      recentVoiceClusters,
    },
    regenerateSalt,
    recentPremises,
    // PHASE Y7 — taste-pinned voice cluster. When the creator has
    // set `preferredTone` in their calibration doc, every recipe
    // in the batch is generated in the matching voice cluster.
    // Cold-start creators get the salt-rotated cold-start fallback
    // inside `resolveVoiceCluster` instead. Calibration was already
    // parsed once at the top of this function (L3199); re-use it
    // here instead of re-parsing.
    tasteCalibration: calibration,
    // PHASE R1 — thread the request region through to the cohesive
    // author so each shipped core_native idea gets the deterministic
    // regional baseline decoration applied to its caption /
    // howToFilm / whyItWorks copy. `"western"` and `undefined`
    // short-circuit to identity inside the adapter, so cold-start
    // and western creators are byte-identical to pre-R1.
    region: input.region,
  });
  // PHASE N1-LIVE-INSTRUMENT — restore prior observer FIRST (so a
  // throw in the logger.info path can't leak the global), then dump
  // the collected per-core throttle records to pino. Bounded: the
  // observer fires at most once per core attempted in the pack-prefix
  // block, and the slate cap is small (≤8 cores per request).
  if (_liveThrottleEnabled) {
    (
      globalThis as { __nigerianThrottleObserver?: unknown }
    ).__nigerianThrottleObserver = _priorObserver;
    logger.info(
      {
        event: "nigerian_pack.live_throttle",
        region: input.region,
        coreCount: _liveThrottleRecords.length,
        records: _liveThrottleRecords,
      },
      "nigerian_pack.live_throttle",
    );
  }
  logger.info(
    {
      event: "phase_y5.core_native_generated",
      region: input.region,
      desiredCount,
      seedCoreCount: coreNativeSelection.cores.length,
      hasFreshCore: coreNativeSelection.hasFreshCore,
      generatedCount: coreNativeResult.stats.generatedCount,
      keptCount: coreNativeResult.stats.keptCount,
      rejectedCount:
        coreNativeResult.stats.generatedCount -
        coreNativeResult.stats.keptCount,
      rejectionReasons: coreNativeResult.stats.rejectionReasons,
      // PHASE D4 — additive reject-source telemetry. Breaks down
      // `copied_seed_hook` rejections by which reference pool
      // (`corpus` vs `style_defs`) the matched seed came from, so
      // we can SEE whether the D3 corpus expansion (~200 → ~359
      // ref pool) over-rejects in practice. Aggregate counts on
      // `bySource`; bounded `samples` array carries individual
      // (hash, jaccard, gate) tuples for the QA driver. Always
      // present — `bySource` defaults to `{ corpus: 0, style_defs: 0 }`
      // for cold-start / no-reject batches.
      antiCopyRejects: coreNativeResult.stats.antiCopyRejects,
      seedCoreIds: coreNativeSelection.cores.map((c) => c.id),
      keptCoreIds: coreNativeResult.candidates.map(
        (c) => c.meta.premiseCoreId,
      ),
    },
    "phase_y5.core_native_generated",
  );
  // Merge BEFORE `filterAndRescore`. Type widens naturally — both
  // `PatternCandidate` (whose meta is `PatternMeta`) and the core-
  // native shape (whose meta is the non-PatternMeta arm of
  // `CandidateMeta`) coalesce to `{ idea: Idea; meta: CandidateMeta }`,
  // which is exactly what `FilterAndRescoreInput.candidates` accepts.
  const mergedLocalCandidates: { idea: Idea; meta: CandidateMeta }[] = [
    ...localCandidates,
    ...coreNativeResult.candidates,
  ];
  const localResult = filterAndRescore({
    candidates: mergedLocalCandidates,
    profile,
    memory,
    recentScenarios: input.recentScenarios,
    derivedStyleHints,
    // Phase 3D BUG A — thread the cross-batch hot skeleton list to
    // the rewriter via filterAndRescore so its two-pass walk can
    // prefer fresh skeletons. Phase 3D BUG B — pass the exact-hook
    // string set too, even though filterAndRescore doesn't read it
    // today (selectionPenalty does). Keeps the wiring symmetric so
    // a future pre-scoring filter can consume the same field.
    recentHookSkeletons: noveltyContext.recentHookSkeletons,
    recentHookStrings: noveltyContext.recentHookStrings,
    // PHASE X2 — PART 4 — anti-copy guard input. No-op for Layer-1
    // candidates (no premise field) but threaded uniformly so
    // wrapped Claude fallback candidates that happen to flow back
    // into a re-scoring pass behave the same way. PHASE Y5 — the
    // core-native generator already self-validated against this set,
    // but filter re-runs are idempotent: a candidate that passed
    // anti-copy in the generator will pass it here too.
    recentPremises,
  });

  // PHASE UX3 — exclusion sets built ONCE per orchestrator call
  // and reused on both selection passes (local pool + post-merge
  // pool). Hard-reject set is the lowercased + trimmed exact hook;
  // bigram set is precomputed per excluded hook so the inner loop
  // doesn't re-tokenize for every candidate.
  const excludeHooksList: ReadonlyArray<string> = (input.excludeHooks ?? [])
    .map((h) => h.toLowerCase().trim())
    .filter((h) => h.length > 0)
    .slice(0, 20);
  const excludeHooksSet: ReadonlySet<string> = new Set(excludeHooksList);
  const excludeBigramsList: ReadonlyArray<Set<string>> = excludeHooksList.map(
    (h) => hookWordBigrams(h),
  );

  let usedFallback = false;
  let fallbackKeptCount = 0;
  // PHASE X2 — PART 6 — captured from the fallback `filterAndRescore`
  // call when the Claude path fires. Hoisted out of the try block
  // so the validation_summary log below can surface fallback-path
  // rejections separately from local-path rejections (the two sets
  // tell different stories — local rejections argue for catalog
  // gaps; fallback rejections argue for prompt drift).
  let fallbackRejectionReasons: typeof localResult.rejectionReasons | undefined;
  let merged: ScoredCandidate[] = localResult.kept;
  // PHASE UX3 — apply visible-hook exclusion to the local pool
  // BEFORE the first selection so a deterministic re-emission of
  // a currently-visible hook never reaches selectWithNovelty.
  // No-op when excludeHooksSet is empty (legacy callers / cold-
  // start refresh).
  merged = applyExcludeHooksFilter(merged, excludeHooksSet, excludeBigramsList);

  // PHASE N1-LIVE-HARDEN F2 — region-anchor brand filter. Gated on
  // the same activation guard as the pack itself
  // (`canActivateNigerianPack`), so non-NG / NG-clean / NG-null /
  // flag-OFF cohorts skip this block entirely (`merged` returned
  // by reference). Inside the gate, we drop any candidate whose
  // rendered surfaces match a Western-only brand term — pack
  // candidates are unaffected because their hooks are vetted
  // Pidgin and never carry doordash/venmo/walmart. Pure additive
  // reject branch — does not loosen any existing validator,
  // does not change scoring, does not touch anti-copy.
  const _n1F2_calibrationForFilter = parseTasteCalibration(
    input.tasteCalibrationJson,
  );
  const _n1F2_languageStyle =
    _n1F2_calibrationForFilter?.languageStyle ?? null;
  const _n1F2_flagEnabled = isNigerianPackFeatureEnabled();
  const _n1F2_packLength = NIGERIAN_HOOK_PACK.length;
  const _n1F2_active = shouldApplyNigerianRegionAnchorValidator({
    region: input.region,
    languageStyle: _n1F2_languageStyle,
    flagEnabled: _n1F2_flagEnabled,
    packLength: _n1F2_packLength,
  });
  let _n1F2_droppedFirstPass = 0;
  if (_n1F2_active) {
    const before = merged.length;
    merged = merged.filter(
      (c) => validateNigerianRegionAnchor(c.idea) === null,
    );
    _n1F2_droppedFirstPass = before - merged.length;
    if (_n1F2_droppedFirstPass > 0) {
      logger.info(
        {
          creatorId: input.creator?.id,
          region: input.region ?? null,
          languageStyle: _n1F2_languageStyle,
          dropped: _n1F2_droppedFirstPass,
          remaining: merged.length,
          stage: "post_local",
        },
        "nigerian_region_anchor.filter_applied",
      );
    }
  }

  // PHASE N1-FULL-SPEC LIVE — per-creator catalog template memory
  // wiring intentionally REVERTED (2026-05-06). Schema column #23,
  // migration, and `catalogTemplateCreatorMemory.ts` are kept as
  // inert plumbing for a corrected future attempt. Reason for
  // revert: filtering by `meta.source === "pattern_variation" &&
  // meta.templateId` had two failure modes confirmed by live test:
  //   (1) Filtering shrank `merged` enough that `selectWithNovelty`
  //       underfilled the batch (per-style/per-core diversity gates
  //       require a richer pool than `desiredCount` candidates).
  //       That fired Claude fallback on every batch — undoing the
  //       latency win from FIX A (1.6-7s → 16-61s).
  //   (2) The same hook skeleton (`the X and i are still here.
  //       barely.`) ships through MULTIPLE source paths, including
  //       `core_native`, not just `pattern_variation`. So the
  //       filter never bit on the actually-repeating templates.
  // The next attempt should track a normalized HOOK SKELETON across
  // all source paths, not a per-source templateId, and run AFTER
  // selection (excluding from the next batch's `excludeHooksSet`)
  // rather than BEFORE selection.

  // -------- Step 4a: first selection on local pool ----------------
  // Run the novelty-aware selector on the local pool. If batch
  // guards pass AND we have at least `desiredCount` picks, we're
  // done — no Claude needed. If guards fail OR we're short, we'll
  // top up with fallback below and re-select on the merged pool.
  let selection = selectWithNovelty(merged, desiredCount, noveltyContext, {
    regenerate,
  });

  // -------- Step 4b: Claude fallback (when needed) ---------------
  // Three triggers, in spec order:
  //   1. Fewer than 3 local candidates passed the scorer — same as
  //      pre-novelty rule: we just don't have enough raw material.
  //      Threshold is the literal `3`, NOT `desiredCount`, so for
  //      count=1|2 we still demand a healthy pool (which gives the
  //      novelty selector real choice).
  //   2. The selector couldn't fill `desiredCount` picks even
  //      against the local pool (e.g. all candidates clustered on
  //      one family).
  //   3. Hard batch guards failed on the local pool — adding
  //      Claude variety may unlock a guard-passing combination
  //      (different family / topic / visual).
  // For count=1|2 trigger 3 is vacuous (guards short-circuit at
  // batch.length<3), so the effective rule there is "fewer than 3
  // local candidates passed."
  // PHASE Y2 — PART 1 — core-aware primary pass. The original
  // `needFallback` triggers (short pool, underfilled selection, guard
  // failure) still apply, but on every `regenerate=true` batch we
  // ALSO run the Claude-with-cores call eagerly so the new
  // PremiseCore library actually reaches the user (Y1 QA showed
  // 97% of ideas bypassed cores because the deterministic local
  // pattern catalog covered the desiredCount on its own — the
  // fallback never fired). For regenerate=false (cheap pattern /
  // cache path) the trigger is unchanged so we don't regress the
  // sub-second normal-tap latency.
  // PHASE N1-FULL-SPEC LIVE — cohort-gated skip of the mandatory
  // regenerate-Claude wrap when the local pool is already healthy
  // AND the active cohort is NG-pidgin/light_pidgin with the pack
  // flag ON. Live request audit (request d28a3efe, 2026-05-06)
  // showed the regenerate-mandatory Claude path costing ~20s and
  // returning `claudeKept: 0`, then the Llama mutator costing
  // another ~10s and returning `mutationsSelected: 0` — 30 of 31
  // total seconds wasted on no-op LLM round-trips while the local
  // pool ALREADY had 10 healthy keepers (5 catalog `core_native`
  // + 5 pack-prefix). For the NG-pidgin cohort the pack-prefix
  // block is the highest-quality source by construction
  // (reviewer-stamped entries, scoreNigerianPackEntry-validated),
  // so Claude's variety contribution is structurally redundant.
  // Gate is the same four-AND used by `canActivateNigerianPack`
  // (region + languageStyle + flag + non-empty pack) PLUS a
  // pool-fullness check (localKept >= desiredCount + 2 keeps a
  // 2-candidate selection headroom for novelty / guard variety).
  // Western/India/PH/NG-clean/flag-OFF cohorts evaluate the gate
  // to false → byte-identical to pre-fix behaviour.
  const n1LiveSkipFallback =
    canActivateNigerianPack({
      region: input.region,
      languageStyle: calibration?.languageStyle ?? null,
      flagEnabled: isNigerianPackFeatureEnabled(),
      packLength: NIGERIAN_HOOK_PACK.length,
    }) && localResult.kept.length >= desiredCount + 2;
  const layer1CoreAwareTriggered = regenerate && !n1LiveSkipFallback;
  // PHASE N1-LIVE-HARDEN P3 — skip the Claude fallback round-trip
  // when the local pool already satisfies the batch on a
  // non-regenerate (normal-tap) request. Conditions (ALL must
  // hold):
  //   • `!regenerate` — never skip on the regenerate path; the
  //     +novelty contribution from Claude's variety axis is the
  //     whole point of regenerate. The `n1LiveSkipFallback` flag
  //     above already governs the regenerate-NG-pidgin-pack-only
  //     skip; this gate is its complement for the non-regenerate
  //     general case.
  //   • `localResult.kept.length >= desiredCount` — local pool
  //     can fill the batch without external help.
  //   • `merged.length >= 3` — same `merged.length < 3` gate the
  //     `needFallback` cascade uses for the bare-pool branch.
  //     We never skip when the merged pool would otherwise force
  //     a fallback for under-fill.
  // Net effect: a normal-tap request whose local pool is healthy
  // ships in 2-7s instead of 20-35s when Claude would otherwise
  // run as a regenerate-mandatory fallback. The two harder
  // failure paths (`!selection.guardsPassed`, `selection.batch.length
  // < desiredCount`) still trigger the fallback because the
  // local pool DIDN'T actually satisfy the batch in those cases.
  // P3 SAFETY: only mask the `layer1CoreAwareTriggered` (regenerate
  // +novelty) skip condition. The harder failure paths
  // (`merged.length < 3`, `selection.batch.length < desiredCount`,
  // `!selection.guardsPassed`) MUST still trigger fallback — local
  // pool counts (`localResult.kept`) are pre-selection and don't
  // prove the actual batch was filled or passed diversity guards.
  const p3SkipFallbackLocalSufficient =
    !regenerate &&
    localResult.kept.length >= desiredCount &&
    merged.length >= 3 &&
    selection.batch.length >= desiredCount &&
    selection.guardsPassed;
  const needFallback =
    layer1CoreAwareTriggered && !p3SkipFallbackLocalSufficient
      ? true
      : merged.length < 3 ||
        selection.batch.length < desiredCount ||
        !selection.guardsPassed;
  if (p3SkipFallbackLocalSufficient) {
    logger.info(
      {
        creatorId: input.creator?.id,
        region: input.region ?? null,
        desiredCount,
        localKept: localResult.kept.length,
        mergedSize: merged.length,
        regenerate,
      },
      "hybrid_ideator.p3_skip_fallback_local_sufficient",
    );
  }
  if (needFallback) {
    usedFallback = true;
    try {
      // PHASE Y (PREMISE CORE LIBRARY) — pick `desiredCount + 2` cores
      // (small headroom so the LLM has room to drop one or two it
      // can't make work without starving the batch) using the
      // 5-batch recent-id + recent-mechanism sets built upstream.
      // Selector enforces the ≥1-fresh-core swap when history is
      // non-empty; cold-start creators fall through to pure
      // FAMILY_DEFAULT_TASTE_WEIGHT sampling. Telemetry-only log
      // immediately below so the QA driver can confirm cores
      // actually flowed into the prompt on the fallback path.
      const coreSelection = selectPremiseCores({
        count: desiredCount + 2,
        recentCoreIds: recentPremiseCoreIdsForSeeding,
        recentMechanisms: recentMechanismsForSeeding,
      });
      logger.info(
        {
          event: "phase_y.premise_cores_selected",
          region: input.region,
          desiredCount,
          seedCount: coreSelection.cores.length,
          selectedCoreIds: coreSelection.cores.map((c) => c.id),
          selectedFamilies: coreSelection.cores.map((c) => c.family),
          recentCoreCount: recentPremiseCoreIdsForSeeding.size,
          recentMechanismCount: recentMechanismsForSeeding.size,
          hasFreshCore: coreSelection.hasFreshCore,
        },
        "phase_y.premise_cores_selected",
      );
      // PHASE N1-LIVE-HARDEN P4 — outer 45s timeout race for the
      // Claude fallback call. The Anthropic SDK's own `timeout=60_000`
      // covers the network leg, but the ideator-side wrapper does
      // additional pre/post work (prompt build, response parse,
      // anti-copy gates) and the batch-served wall clock has been
      // observed at 60-90s with the 60s client cutoff producing the
      // visible "blank batch" timeouts. A 45s ceiling here gives the
      // outer route a 15s buffer before its own 60s cutoff so the
      // best-effort ship path below has time to run. On timeout we
      // throw an `AbortError`-shaped error which the existing
      // `catch (err)` at the bottom of this block already handles by
      // logging `hybrid_ideator.fallback_failed` and falling through
      // to whatever local candidates we have.
      const FALLBACK_TIMEOUT_MS = 45_000;
      let _p4TimeoutHandle: ReturnType<typeof setTimeout> | null = null;
      const _p4TimeoutPromise = new Promise<never>((_, reject) => {
        _p4TimeoutHandle = setTimeout(() => {
          reject(
            new Error(
              `hybrid_ideator.fallback_timeout: Claude generateIdeas exceeded ${FALLBACK_TIMEOUT_MS}ms`,
            ),
          );
        }, FALLBACK_TIMEOUT_MS);
      });
      const _p4ClaudeCall = generateIdeas({
        region: input.region,
        styleProfile: input.styleProfile,
        count: desiredCount,
        regenerate,
        tasteCalibrationJson: input.tasteCalibrationJson,
        viralPatternMemory: memory,
        // PHASE Y9 — pass through so a future caller that injects a
        // pre-computed `viralPatternMemory: undefined` (forcing the
        // ideator's own load path) still gets the seed applied.
        // Today the orchestrator always pre-loads `memory` here so
        // generateIdeas's own load branch is a no-op, but the field
        // is forward-compatible with any path that bypasses the
        // orchestrator's `loadMemory` step.
        onboardingSeed,
        ctx: input.ctx,
        // PHASE Y — primary seed for Layer-3 generation. The prompt
        // builder in `ideaGen.ts` renders these via
        // `formatPremiseCoresForPrompt` above the existing premise-
        // first instructions. When this field is omitted (legacy
        // callers / tests), the prompt renders the empty string and
        // collapses to the pre-PHASE-Y behavior.
        premiseCoreSeeds: coreSelection.cores,
      });
      let claudeResult: Awaited<ReturnType<typeof generateIdeas>>;
      try {
        claudeResult = await Promise.race([
          _p4ClaudeCall,
          _p4TimeoutPromise,
        ]);
      } finally {
        if (_p4TimeoutHandle !== null) clearTimeout(_p4TimeoutHandle);
      }
      // Apply the same hook-exclusion to Claude's output so a
      // regenerate fallback can't ship a near-duplicate of the
      // previous batch (Claude lacks scenarioFamily, so family
      // exclusion is structurally a no-op here).
      const freshFallback = applyExclusionToFallback(
        claudeResult.ideas,
        exclude,
      );
      const wrapped = freshFallback.map(wrapFallbackIdea);
      const fallbackResult = filterAndRescore({
        candidates: wrapped,
        profile,
        memory,
        recentScenarios: input.recentScenarios,
        derivedStyleHints,
        // Phase 3D BUG A / BUG B — same wiring as the local-pool
        // filterAndRescore call above. Cross-batch hot skeletons
        // for the rewriter; exact-hook string set for the future
        // pre-scoring filter (selectionPenalty already reads it).
        // Critical to thread on the fallback path too — Claude can
        // freely produce a near-duplicate of a recently-shipped hook
        // even though it doesn't ride the legacy skeleton catalog.
        recentHookSkeletons: noveltyContext.recentHookSkeletons,
        recentHookStrings: noveltyContext.recentHookStrings,
        // PHASE X2 — PART 4 — Claude fallback IS the layer that
        // emits `idea.premise`, so threading `recentPremises` here
        // is what actually catches verbatim premise repeats across
        // batches. Same set used on the local pool above for
        // wiring symmetry.
        recentPremises,
      });
      fallbackKeptCount = fallbackResult.kept.length;
      fallbackRejectionReasons = fallbackResult.rejectionReasons;
      // PHASE Y2 — PART 1 — pool-promotion rule. When the
      // core-aware primary pass fired AND Claude returned enough
      // valid candidates to fill the batch on its own, REPLACE the
      // deterministic local pool entirely so core-tagged ideas win
      // selection (the +2 fresh-core scorer lever isn't always
      // enough to overcome the local pool's pattern-fit head-start
      // — Y1 QA showed local-only pools winning even with cores
      // selected and the fallback ran). For all other cases (Claude
      // short-delivered, Claude failed, or the fallback fired for
      // its original "local underfilled" reasons) keep the existing
      // merge behavior so we never ship an empty / under-filled
      // batch.
      const claudeCanFillSolo =
        layer1CoreAwareTriggered &&
        fallbackResult.kept.length >= desiredCount;
      const promotionReason: string = claudeCanFillSolo
        ? "claude_only_core_aware"
        : layer1CoreAwareTriggered
          ? "merged_core_aware_short"
          : "merged_local_underfilled";
      if (claudeCanFillSolo) {
        merged = [...fallbackResult.kept].sort(
          (a, b) => b.score.total - a.score.total,
        );
      } else {
        merged = [...merged, ...fallbackResult.kept].sort(
          (a, b) => b.score.total - a.score.total,
        );
      }
      // PHASE UX3 — re-apply the exclusion filter on the merged
      // pool so Claude-fallback candidates that happen to repeat a
      // currently-visible hook (or a bigram-Jaccard-near rephrase)
      // can't slip through the second selection pass below. Same
      // sets reused — no extra tokenization.
      merged = applyExcludeHooksFilter(
        merged,
        excludeHooksSet,
        excludeBigramsList,
      );
      // PHASE N1-LIVE-HARDEN F2 — re-apply the region-anchor brand
      // filter on the post-fallback merged pool so any Claude-
      // generated candidate that happens to mention a Western-only
      // brand can't slip into the second selection pass. Same gate
      // (`_n1F2_active`) as the first-pass filter above; non-NG /
      // flag-OFF cohorts skip this block (no-op).
      if (_n1F2_active) {
        const beforePost = merged.length;
        merged = merged.filter(
          (c) => validateNigerianRegionAnchor(c.idea) === null,
        );
        const droppedPost = beforePost - merged.length;
        if (droppedPost > 0) {
          logger.info(
            {
              creatorId: input.creator?.id,
              region: input.region ?? null,
              languageStyle: _n1F2_languageStyle,
              dropped: droppedPost,
              remaining: merged.length,
              stage: "post_fallback",
            },
            "nigerian_region_anchor.filter_applied",
          );
        }
      }
      logger.info(
        {
          event: "phase_y2.layer1_core_aware_used",
          creatorId: input.creator?.id,
          regenerate,
          desiredCount,
          claudeKept: fallbackResult.kept.length,
          localKeptBefore: localResult.kept.length,
          mergedSize: merged.length,
          promotionReason,
          coreTaggedInPool: merged.filter(
            (c) =>
              "premiseCoreId" in c.meta &&
              typeof (c.meta as { premiseCoreId?: string }).premiseCoreId ===
                "string",
          ).length,
        },
        "phase_y2.layer1_core_aware_used",
      );
      // Re-select on the (possibly replaced) pool — Claude may have
      // unlocked axis variety the local pool lacked, and on the
      // pool-promotion path the selector now picks exclusively from
      // core-tagged candidates.
      selection = selectWithNovelty(merged, desiredCount, noveltyContext, {
        regenerate,
      });

      // PHASE Y2 — PART 1c — core-priority swap. The +2 fresh-core
      // scorer lever (ideaScorer L3186-3192) self-suppresses on
      // cold-start (`recentPremiseCoreIds.size === 0`) so the very
      // batches we most need to bootstrap core coverage on are also
      // the ones where core-tagged Claude candidates carry ZERO
      // selection bias against the local pattern pool. Y2 QA round-1
      // showed 0/8 regen batches shipping a core-tagged idea even
      // though Claude consistently returned 1-3 valid core candidates
      // per batch. Post-process the selector's pick: any core-tagged
      // candidate from `merged` that didn't make the cut is swapped
      // in, displacing the lowest-scored NON-core pick first. Bounded
      // by `desiredCount` so we never expand the batch, and silent on
      // empty (no Claude cores in pool → unchanged behavior).
      if (layer1CoreAwareTriggered) {
        const getCoreId = (
          c: ScoredCandidate,
        ): string | undefined =>
          (c.meta as { premiseCoreId?: string }).premiseCoreId;
        const batchHas = new Set(selection.batch);
        const inBatchCoreIds = new Set(
          selection.batch
            .map(getCoreId)
            .filter((x): x is string => typeof x === "string"),
        );
        const missingCoreCandidates = merged
          .filter((c) => {
            const cid = getCoreId(c);
            return (
              typeof cid === "string" &&
              !inBatchCoreIds.has(cid) &&
              !batchHas.has(c)
            );
          })
          .sort((a, b) => b.score.total - a.score.total);

        if (missingCoreCandidates.length > 0) {
          const newBatch = [...selection.batch];
          const swapTargets = newBatch
            .map((c, i) => ({ c, i }))
            .filter(({ c }) => !getCoreId(c))
            .sort((a, b) => a.c.score.total - b.c.score.total);
          const swappedInIds: string[] = [];
          for (const cand of missingCoreCandidates) {
            const target = swapTargets.shift();
            if (!target) break;
            newBatch[target.i] = cand;
            const cid = getCoreId(cand);
            if (cid) swappedInIds.push(cid);
          }
          if (swappedInIds.length > 0) {
            // PHASE Y2 — recompute `guardsPassed` after mutating
            // `selection.batch`. Without this, downstream consumers
            // (e.g. the `guards_failed_shipping_best_effort` warn
            // path) read a STALE `guardsPassed=true` even when the
            // swap newly violates a HARD guard (opener-cap, setting-
            // cap, archetype-cap, etc.). Use the same
            // `voiceStrongPreference` context as the original
            // `selectWithNovelty` call so the guard semantics are
            // consistent across the swap. `postCoreCount` is the
            // count of UNIQUE post-swap core ids (using a Set so
            // multiple Claude candidates sharing one premiseCoreId
            // don't inflate the metric).
            const newGuardsPassed = batchGuardsPass(newBatch, {
              voiceStrongPreference: noveltyContext.voiceStrongPreference,
            });
            const postCoreIds = new Set([
              ...inBatchCoreIds,
              ...swappedInIds,
            ]);
            logger.info(
              {
                event: "phase_y2.core_priority_swap",
                creatorId: input.creator?.id,
                swappedIn: swappedInIds.length,
                coreIdsAdded: swappedInIds,
                preCoreCount: inBatchCoreIds.size,
                postCoreCount: postCoreIds.size,
                preSwapGuardsPassed: selection.guardsPassed,
                postSwapGuardsPassed: newGuardsPassed,
              },
              "phase_y2.core_priority_swap",
            );
            selection = { batch: newBatch, guardsPassed: newGuardsPassed };
          }
        }
      }
    } catch (err) {
      // Fallback failure is non-fatal — we still ship whatever local
      // candidates we have. If we ALSO have zero local, the catch
      // below the rescue path will surface the empty state.
      logger.error(
        { err, creatorId: input.creator?.id },
        "hybrid_ideator.fallback_failed",
      );
    }
  }

  // PHASE X2 — PART 6 — per-reason validation telemetry. Always
  // fires (no gating on `usedFallback` or rejection counts) so we
  // can see the steady-state baseline + the empty-rejection case
  // ("zero rejections" is itself useful signal — it tells us the
  // catalog is clearing the gates cleanly). `fallbackRejections`
  // is undefined when the Claude path didn't fire; logged as
  // `null` for grep-ability rather than omitted.
  // PHASE UX3.1 — surface coherence-filter rejections (pattern-engine
  // path) on the SAME validation_summary log line so dashboards keyed
  // on `localRejections` see the full local-side rejection picture in
  // one grep. The dedicated `phase_ux3_1.pattern_coherence_filter`
  // event above stays for per-event drill-down; this folds the same
  // counts into the steady-state summary alongside scoring/anti-copy
  // drops in `localRejections`. `null` (not undefined / omitted) when
  // the filter found nothing — matches the `fallbackRejections` shape
  // convention above.
  const coherenceRejectionsForSummary =
    Object.keys(coherenceRejections).length > 0
      ? coherenceRejections
      : null;
  logger.info(
    {
      creatorId: input.creator?.id,
      regenerate,
      localKept: localResult.kept.length,
      localRejected: localResult.rejected,
      localHardRejected: localResult.hardRejected,
      localRejections: localResult.rejectionReasons,
      coherenceRejections: coherenceRejectionsForSummary,
      coherenceRejected:
        localCandidatesPreCoherence.length - localCandidates.length,
      usedFallback,
      fallbackKept: fallbackKeptCount,
      fallbackRejections: fallbackRejectionReasons ?? null,
      recentPremisesCount: recentPremises.size,
    },
    "hybrid_ideator.validation_summary",
  );

  // -------- Step 4c: Layer 3 — Llama hook mutation ---------------
  // Pattern engine + scorer + selector have produced the best batch
  // they can structurally. Llama 3.1 8B (via OpenRouter) gets one
  // shot to humanize hooks (and optionally captions) on a small
  // subset of candidates. Triggered ONLY by:
  //   - regenerate=true
  //   - templated/repeated openers or families in-batch
  //   - cross-batch similarity vs recent history
  //   - all-pattern batch (give one a human voice)
  //   - borderline novelty (weak hookImpact even though total passed)
  // Mutated candidates replace originals ONLY when re-scoring shows
  // a strict improvement on hookImpact / personalFit / total. On any
  // Llama failure the original batch ships unchanged. Telemetry is
  // logged either way so we can tune the trigger thresholds.
  let usedLlamaMutation = false;
  const mutationResult = await maybeMutateBatch(selection.batch, {
    profile,
    memory,
    recentScenarios: input.recentScenarios ?? [],
    novelty: noveltyContext,
    regenerate,
    usage: input.usageContext,
  });
  // Log on EITHER a real mutation attempt OR a cost-control skip so
  // the skip rate is observable (not silently dropped).
  if (
    mutationResult.telemetry.used ||
    mutationResult.telemetry.costControlSkipped
  ) {
    usedLlamaMutation = mutationResult.telemetry.mutationsSelected > 0;
    logger.info(
      {
        creatorId: input.creator?.id,
        regenerate,
        reason: mutationResult.telemetry.reason,
        candidatesSent: mutationResult.telemetry.candidatesSent,
        optionsReturned: mutationResult.telemetry.optionsReturned,
        mutationsSelected: mutationResult.telemetry.mutationsSelected,
        rejected: mutationResult.telemetry.rejectedReasonCounts,
        costEstimateTokens: mutationResult.telemetry.costEstimateTokens,
        errored: mutationResult.telemetry.errored,
        costControlSkipped: mutationResult.telemetry.costControlSkipped,
        skipReason: mutationResult.telemetry.skipReason,
        ideaRequestCountToday:
          mutationResult.telemetry.ideaRequestCountToday,
        llamaCallsLast2Min: mutationResult.telemetry.llamaCallsLast2Min,
      },
      "hybrid_ideator.llama_mutation",
    );
  }
  selection = { ...selection, batch: mutationResult.batch };

  // -------- Step 4c: batch composition (hero/taste/novelty) -------
  if (noveltyContext.retentionMemory && noveltyContext.retentionProfile) {
    selection = {
      ...selection,
      batch: applyBatchComposition(
        selection.batch,
        noveltyContext.retentionMemory,
        noveltyContext.retentionProfile,
      ),
    };
  }

  // -------- Step 4d: Nigerian Pack Slot Reservation (N1-S2) ------
  // Pure reorder of `selection.batch` after `applyBatchComposition`.
  // The helper's activation guard (`canActivateNigerianPack`) short-
  // circuits to identity for every region/style/flag combination
  // other than nigeria + pidgin/light_pidgin + flag ON + non-empty
  // approved pack, so flag-OFF and non-eligible cohorts get the
  // upstream batch back unchanged (byte-identical to pre-N1-S2).
  // Pack candidates are drawn from `merged` — the same post-
  // validation pool that fed `selectWithNovelty`, so every reserved
  // pack idea has already passed `ideaSchema`,
  // `validateScenarioCoherence`, `validateComedy`, and
  // `validateAntiCopyDetailed`. No validator, scorer, or anti-copy
  // gate is touched. Per-batch dedup on `nigerianPackEntryId` AND
  // normalized hook is enforced inside the helper.
  const n1s2_preBatch = selection.batch;
  const n1s2_languageStyle = calibration?.languageStyle ?? null;
  const n1s2_flagEnabled = isNigerianPackFeatureEnabled();
  const n1s2_packLength = NIGERIAN_HOOK_PACK.length;
  // PHASE N1-FULL-SPEC — per-creator hook memory. Fetch the set of
  // entry ids this creator has seen in a recent shipped batch so
  // the slot reservation can filter them out BEFORE picking. The
  // helper returns an empty Set when there's no creator id or when
  // the column is empty/NULL/unreadable, which preserves the
  // baseline behaviour for every non-NG cohort and every fresh
  // creator. Read failures are logged and swallowed inside the
  // helper — never fail the request.
  // Reuse the hoisted snapshot fetched ABOVE generateCoreCandidates
  // for pack-aware retention. Same Set semantics — empty on non-NG
  // cohorts (read skipped) or DB failure. Eliminates the duplicate
  // DB read this call previously incurred per request.
  const n1s2_excludeEntryIds = _hoistedNigerianPackSeenIds;
  // PHASE N1-LIVE-HARDEN P1 — staging-only memory soft-cap rescue
  // wiring. Gated behind `LUMINA_NG_MEMORY_SOFT_CAP_ENABLED=true`;
  // production keeps this OFF until staging QA approves the lift.
  // When the flag is off we skip the ordered-list DB read entirely
  // (returns []) so the byte-identical baseline holds for every
  // production cohort. When ON, the ordered list (most-recent
  // first) is passed alongside the standard exclusion set; the
  // helper only acts on it when the standard filter would
  // otherwise wipe the pack pool to zero (memory-saturated case).
  const n1s2_softCapEnabled =
    process.env.LUMINA_NG_MEMORY_SOFT_CAP_ENABLED === "true";
  const n1s2_excludeEntryIdsOrdered = n1s2_softCapEnabled
    ? await getRecentSeenEntriesOrdered(input.creator?.id)
    : [];
  // PHASE N1-LIVE-HARDEN F3 — slot-reservation diagnostic capture.
  // The sink is invoked once per ACTIVATED invocation (the helper's
  // own activation guard short-circuits the call for non-NG /
  // flag-OFF / NG-clean / NG-null cohorts), so this stays
  // byte-identical to baseline outside the NG-pidgin path.
  let n1s2_diagnostic: SlotReservationDiagnostic | null = null;
  const n1s2_postBatch = applyNigerianPackSlotReservation({
    selectionBatch: n1s2_preBatch,
    candidatePool: merged,
    desiredCount,
    region: input.region,
    languageStyle: n1s2_languageStyle,
    flagEnabled: n1s2_flagEnabled,
    packLength: n1s2_packLength,
    excludeEntryIds: n1s2_excludeEntryIds,
    softCapEnabled: n1s2_softCapEnabled,
    excludeEntryIdsOrdered: n1s2_excludeEntryIdsOrdered,
    creatorIdForLog: input.creator?.id ?? null,
    onDiagnostic: (d) => {
      n1s2_diagnostic = d;
    },
  });
  selection = { ...selection, batch: n1s2_postBatch };
  // Record the entry ids actually shipped in this batch so the
  // NEXT request can filter them. Best-effort — write failures are
  // logged and swallowed inside the helper. We collect from the
  // post-batch (not the pre-batch) so a creator who only ended up
  // with non-pack ideas this turn isn't penalized.
  {
    const shippedEntryIds = n1s2_postBatch
      .map(
        (c) =>
          (c.meta as { nigerianPackEntryId?: string })
            .nigerianPackEntryId,
      )
      .filter((id): id is string => typeof id === "string");
    if (shippedEntryIds.length > 0) {
      void recordSeenEntries(input.creator?.id, shippedEntryIds);
    }
  }

  // PHASE N1-FULL-SPEC LIVE v2 — catalog hook-skeleton dedup.
  // Operates on the FINAL post-pack-reservation batch. For each
  // non-pack candidate whose normalized hook skeleton matches one
  // the creator has seen recently AND another candidate exists in
  // `merged` whose skeleton is novel, swap them. Pack candidates
  // (`meta.nigerianPackEntryId` set) are skipped — they are
  // governed by the per-pack-entry memory above. Pool unchanged
  // (no pre-filter), so selectWithNovelty's diversity machinery
  // is untouched and the previous attempt's latency regression
  // cannot recur. Graceful degradation: when no alternative is
  // available, the original candidate ships and recordSeenSkeletons
  // logs the repeat — strictly better than underfilling.
  {
    const seenSkeletons = await getRecentSeenSkeletons(input.creator?.id);
    if (seenSkeletons.size > 0) {
      const isPack = (c: { meta: unknown }): boolean =>
        (c.meta as { nigerianPackEntryId?: string })
          .nigerianPackEntryId !== undefined;
      const usedSkeletons = new Set<string>();
      const usedIds = new Set<string>();
      for (const c of n1s2_postBatch) {
        usedSkeletons.add(normalizeHookToSkeleton(c.idea.hook));
        const idAny = (c.idea as { id?: unknown }).id;
        if (typeof idAny === "string") usedIds.add(idAny);
      }
      const swapped = n1s2_postBatch.map((c) => {
        if (isPack(c)) return c;
        const sk = normalizeHookToSkeleton(c.idea.hook);
        if (sk.length === 0 || !seenSkeletons.has(sk)) return c;
        // Primary: alt whose skeleton is novel (unseen by creator)
        // and not already chosen elsewhere in this batch.
        const novelAlt = merged.find((p) => {
          if (isPack(p)) return false;
          const altIdAny = (p.idea as { id?: unknown }).id;
          if (typeof altIdAny === "string" && usedIds.has(altIdAny)) {
            return false;
          }
          const altSk = normalizeHookToSkeleton(p.idea.hook);
          if (altSk.length === 0) return false;
          if (seenSkeletons.has(altSk)) return false;
          if (usedSkeletons.has(altSk)) return false;
          return true;
        });
        // Relaxed fallback (BI 2026-05-07 catalog repetition fix):
        // when the per-creator seen-set has saturated the local pool's
        // skeleton space, no truly novel alt exists — strict swap fails
        // and the repeating skeleton ships again (root cause of the
        // observed 3-4× repeats of "my body quit…" across 10 batches).
        // Accept any non-pack alt whose skeleton (a) differs from the
        // repeating one and (b) isn't already used in this batch. Still
        // rotates the user away from the visible repeat — strictly
        // better than shipping the same hook again. SWAP-ONLY semantics
        // preserved (never drops, never shrinks the pool).
        const alt =
          novelAlt ??
          merged.find((p) => {
            if (isPack(p)) return false;
            const altIdAny = (p.idea as { id?: unknown }).id;
            if (typeof altIdAny === "string" && usedIds.has(altIdAny)) {
              return false;
            }
            const altSk = normalizeHookToSkeleton(p.idea.hook);
            if (altSk.length === 0) return false;
            if (altSk === sk) return false;
            if (usedSkeletons.has(altSk)) return false;
            return true;
          });
        if (!alt) return c;
        usedSkeletons.delete(sk);
        usedSkeletons.add(normalizeHookToSkeleton(alt.idea.hook));
        const cIdAny = (c.idea as { id?: unknown }).id;
        if (typeof cIdAny === "string") usedIds.delete(cIdAny);
        const altIdAny = (alt.idea as { id?: unknown }).id;
        if (typeof altIdAny === "string") usedIds.add(altIdAny);
        return alt;
      });
      let changed = false;
      for (let i = 0; i < swapped.length; i++) {
        if (swapped[i] !== n1s2_postBatch[i]) {
          changed = true;
          break;
        }
      }
      if (changed) {
        selection = { ...selection, batch: swapped };
      }
    }
    // Record AFTER any swaps so the next request's seen-set
    // reflects what actually shipped. Skip pack candidates — their
    // hooks are catalog-curated and tracked separately. No-op when
    // there's no creator id (helper short-circuits) or no non-pack
    // hooks shipped.
    {
      const shippedNonPackHooks = selection.batch
        .filter(
          (c) =>
            (c.meta as { nigerianPackEntryId?: string })
              .nigerianPackEntryId === undefined,
        )
        .map((c) => c.idea.hook)
        .filter((h): h is string => typeof h === "string" && h.length > 0);
      if (shippedNonPackHooks.length > 0) {
        void recordSeenSkeletons(
          input.creator?.id,
          shippedNonPackHooks,
        );
      }
    }
  }

  // PHASE N1-FULL-SPEC — structured activation/decision telemetry.
  // Spec §"DEBUGGING AND QA VISIBILITY" enumerates these fields as
  // required debug surfaces. Pure observability — no behavior change
  // (`n1s2_postBatch` was already assigned to `selection.batch`).
  // Emitted for every request so flag-OFF / non-eligible cohorts are
  // greppable as `activated:false` (no Nigeria-only sampling bias).
  {
    const packCandidatesAvailable = merged.filter(
      (c) =>
        (c.meta as { nigerianPackEntryId?: string }).nigerianPackEntryId !==
        undefined,
    ).length;
    const packEntryIdsShipped = n1s2_postBatch
      .map(
        (c) =>
          (c.meta as { nigerianPackEntryId?: string }).nigerianPackEntryId,
      )
      .filter((id): id is string => typeof id === "string");
    const activated = canActivateNigerianPack({
      region: input.region,
      languageStyle: n1s2_languageStyle,
      flagEnabled: n1s2_flagEnabled,
      packLength: n1s2_packLength,
    });
    logger.info(
      {
        creatorId: input.creator?.id,
        region: input.region ?? null,
        languageStyle: n1s2_languageStyle,
        flagEnabled: n1s2_flagEnabled,
        packLength: n1s2_packLength,
        activated,
        poolSize: merged.length,
        packCandidatesAvailable,
        packShippedCount: packEntryIdsShipped.length,
        packEntryIdsShipped,
        preBatchSize: n1s2_preBatch.length,
        postBatchSize: n1s2_postBatch.length,
        reorderApplied:
          n1s2_preBatch.length === n1s2_postBatch.length &&
          n1s2_preBatch.some((c, i) => c !== n1s2_postBatch[i]),
        // PHASE N1-LIVE-HARDEN F3 — pack-pool drain attribution.
        // Present only on ACTIVATED invocations (helper's gate);
        // null for non-NG / flag-OFF cohorts. Lets QA distinguish
        // "no pack produced upstream" (preFilter=0) from
        // "exhausted by per-creator memory" (preFilter>0,
        // postMemoryFilter=0) from "killed by per-batch dedup"
        // (postMemoryFilter>0, postBatchDedup=0).
        slotReservationDiagnostic: n1s2_diagnostic,
      },
      "nigerian_pack.slot_reservation_decision",
    );
  }

  // -------- Step 5: ship final batch, persist --------------------
  let final = selection.batch;
  if (final.length >= desiredCount && !selection.guardsPassed) {
    // Best-effort ship — neither local nor merged pools could yield
    // a guard-passing combination. Surface in logs so we can grep
    // for cohorts that need richer scenario coverage.
    logger.warn(
      {
        creatorId: input.creator?.id,
        regenerate,
        localKept: localResult.kept.length,
        fallbackKept: fallbackKeptCount,
        usedFallback,
        styles: final.map((c) => c.idea.hookStyle),
        families: final.map((c) => c.meta.scenarioFamily),
        topics: final.map((c) => c.meta.topicLane),
        visuals: final.map((c) => c.meta.visualActionPattern),
        // PHASE X2 — PART 6 — surface the per-reason breakdown on
        // the guards-failed log too so a single grep on the warn
        // line tells the full story (no need to cross-reference
        // a separate validation_summary entry by request id).
        // PHASE UX3.1 — also surface coherence-filter map + scalar
        // count so the guards-failed log carries the full local-side
        // picture (parity with `hybrid_ideator.validation_summary`
        // above; one grep on either line tells the same story).
        localRejections: localResult.rejectionReasons,
        coherenceRejections: coherenceRejectionsForSummary,
        coherenceRejected:
          localCandidatesPreCoherence.length - localCandidates.length,
        fallbackRejections: fallbackRejectionReasons ?? null,
      },
      "hybrid_ideator.guards_failed_shipping_best_effort",
    );
  }

  // Final schema gate — every Idea returned (including the rescue
  // path below) MUST validate against ideaSchema. This is paranoia,
  // not policy: the pattern engine already builds candidates against
  // the schema and the cache reader pre-validates, but a final gate
  // makes the public contract bulletproof.
  function gate(ideas: Idea[]): Idea[] {
    return ideas.filter((i) => ideaSchema.safeParse(i).success);
  }

  /**
   * PHASE Z1 — willingness annotation + reorder. Pure deterministic
   * pass over the surviving candidates: stamp each `c.idea` with
   * `willingnessScore` / `pickerEligible` / `whyThisFitsYou`, then
   * sort the array so picker-eligible candidates come first and
   * within each tier they're ordered by descending willingnessScore.
   *
   * The mutation is on `c.idea` (not a new wrapper) so every
   * downstream consumer (cache write, source label counters,
   * `final.map(c => c.idea)`) sees the annotated idea with no
   * additional plumbing. Cache entries naturally carry the fields
   * forward — pre-Z1 cached batches simply lack them and re-render
   * fine on the mobile side (the schema fields are optional).
   */
  function annotateAndSortByWillingness<
    T extends { idea: Idea; score: IdeaScore; meta: CandidateMeta },
  >(candidates: T[]): T[] {
    for (const c of candidates) {
      const w = scoreWillingness({ idea: c.idea, score: c.score, meta: c.meta });
      const why = composeWhyThisFitsYou({
        voiceClusterId: c.meta.voiceClusterId,
        ideaCoreFamily: (c.meta as { ideaCoreFamily?: string }).ideaCoreFamily,
        scenarioFingerprint: c.meta.scenarioFingerprint,
        hook: c.idea.hook,
      });
      c.idea = {
        ...c.idea,
        willingnessScore: w.total,
        pickerEligible: w.pickerEligible,
        whyThisFitsYou: why,
      };
    }
    // Sort key: (pickerEligible desc, willingnessScore desc).
    // EDGE-PROTECTION SCOPE (architect-noted, intentional
    // fail-open): the `pickerEligible` floor only guarantees
    // a sharp candidate sorts ahead of a safe one WHEN AT
    // LEAST ONE candidate is eligible. In the degenerate
    // batch where every candidate fails the floor (every
    // hookQualityScore < 50 OR every aiClicheScore > 0), the
    // tier collapses and ordering falls back to willingness
    // among the all-ineligible set — a "safe boring" idea
    // can technically sort first there. This is intentional
    // fail-open: shipping nothing is strictly worse than
    // shipping the best of a bad batch, and an all-ineligible
    // batch already signals an upstream-pipeline issue the
    // willingness ranker shouldn't try to mask.
    return [...candidates].sort((a, b) => {
      const aE = a.idea.pickerEligible === true ? 1 : 0;
      const bE = b.idea.pickerEligible === true ? 1 : 0;
      if (aE !== bE) return bE - aE;
      const aW = typeof a.idea.willingnessScore === "number" ? a.idea.willingnessScore : 0;
      const bW = typeof b.idea.willingnessScore === "number" ? b.idea.willingnessScore : 0;
      return bW - aW;
    });
  }

  if (final.length === 0) {
    // Last-ditch rescue: ship the unfiltered top of the local pool so
    // the user almost never sees an empty page. This is rare — pattern
    // candidates almost always clear the scorer because the engine
    // builds them from the same rubric the scorer enforces.
    //
    // HARD-EXCLUSION INVARIANT: on regenerate=true we MUST NOT ship
    // any hook/family that was in the previous batch. The previous
    // implementation fell back to `rawCandidates` (pre-exclusion) when
    // the post-exclusion pool was empty — that silently violated the
    // contract by re-shipping the very items we just excluded.
    //
    // New rescue policy:
    //   * regenerate=false → can use rawCandidates (no exclusion to honor).
    //   * regenerate=true  → only post-exclusion candidates are eligible;
    //                        if exclusion zeroed the pool AND fallback
    //                        couldn't fill, return an empty list. The
    //                        client surfaces a "no fresh ideas — try
    //                        again" state rather than re-serving stale.
    const rescueSource: PatternCandidate[] =
      localCandidates.length > 0
        ? localCandidates
        : regenerate
          ? []
          : rawCandidates;
    // TREND + ARCHETYPE PAIRING spec — apply the within-batch HARD
    // CAP on the rescue slice before computing ideasOnly + cache
    // entries. Rescue candidates aren't scored (they're top-of-pool
    // by ranking, not by scorer.total), so we use `(_c, i) => -i`
    // for priority — earlier in the slice = higher priority by
    // convention, so the LAST trend-injected entries become revert
    // targets. The rescue path almost never carries trends in
    // practice (the 30%-bucket gate skips ~70% of candidates and
    // soft-skip drops most of the rest), but the cap is wired here
    // for symmetry — a degenerate request that lands all-3 trends
    // in rescue MUST honor the same ≤ N-1 ceiling as the main
    // path, otherwise the cap leaks under exactly the failure mode
    // it exists to guard against.
    const rescueSlice = enforceTrendCap(
      rescueSource.slice(0, desiredCount),
      (_c, i) => -i,
    );
    // PHASE Z1 — rescue path intentionally does NOT carry
    // willingness annotation: rescue candidates haven't been
    // through `filterAndRescore` so they have no `IdeaScore` to
    // feed the willingness scorer, and rescue ships are rare
    // (only when `final.length === 0`). Cards will render fine
    // without `willingnessScore` / `whyThisFitsYou` — those
    // schema fields are optional on the public idea.
    const ideasOnly = gate(rescueSlice.map((c) => c.idea));
    logger.warn(
      {
        creatorId: input.creator?.id,
        regenerate,
        rawCandidateCount: rawCandidates.length,
        localCandidateCount: localCandidates.length,
        localKept: localResult.kept.length,
        hardRejected: localResult.hardRejected,
        rejected: localResult.rejected,
        excluded: rawCandidates.length - localCandidates.length,
        rescueShipped: ideasOnly.length,
      },
      ideasOnly.length === 0
        ? "hybrid_ideator.empty_after_exclusion_no_rescue"
        : "hybrid_ideator.empty_after_filter_using_unfiltered_local",
    );
    // Only persist when we actually shipped something — empty
    // rescue must not overwrite the previous batch (otherwise the
    // next regenerate has nothing to exclude against).
    if (ideasOnly.length > 0) {
      const rescueEntries: CachedBatchEntry[] = rescueSlice
        .filter((c) => ideaSchema.safeParse(c.idea).success)
        .slice(0, ideasOnly.length)
        .map((c) => ({
          idea: c.idea,
          family: c.meta.scenarioFamily,
          templateId: c.meta.templateId,
          hookLanguageStyle: c.meta.hookLanguageStyle,
          // VOICE PROFILES spec — same field on the rescue path so a
          // best-effort empty-after-filter ship still seeds the next
          // regen's recentVoiceProfiles correctly. Mirrors the main
          // toCacheEntries write above.
          voiceProfile: c.meta.voiceProfile,
          // TREND CONTEXT LAYER spec — same field on the rescue path
          // so a best-effort empty-after-filter ship still seeds the
          // next regen's recentTrendIds correctly. Most rescue
          // entries ship with `trendId === undefined` (the gate
          // skips ~70% by design + soft-skip drops any that failed
          // validateTrendInjection); undefined flows through cleanly.
          // Mirrors the main toCacheEntries write above.
          trendId: c.meta.trendId,
          // Phase 1 — mirror the main `toCacheEntries` write so the
          // rescue path also seeds the next regen's
          // `recentIdeaCoreFamilies` / `recentIdeaCoreTypes` straight
          // off the envelope (envelope-first persistence goal).
          // Without this, the lookup-fallback path in
          // `buildNoveltyContext` masks the omission for catalog
          // entries but leaks for any rescue ship that lacked a
          // canonical lookup mapping.
          ideaCoreType: c.meta.ideaCoreType,
          ideaCoreFamily: c.meta.ideaCoreFamily,
          // Phase 3 HOOK TEMPLATE TUNING — same field on the rescue
          // path so a best-effort empty-after-filter ship still
          // seeds the next regen's `recentHookSkeletons` /
          // `frequentHookSkeletonsLast3` correctly. Mirrors the main
          // toCacheEntries write above; undefined for entries with
          // genuinely scenario-shaped phrasings flows through
          // cleanly.
          hookSkeletonId: c.meta.hookSkeletonId,
          // Phase 6 (BIG PREMISE LAYER) — same field on the rescue
          // path so a best-effort empty-after-filter ship still seeds
          // the next regen's `recentBigPremiseStyles` correctly.
          // Mirrors the main toCacheEntries write above; undefined
          // for legacy template entries flows through cleanly.
          bigPremiseStyle: c.meta.bigPremiseStyle,
          // Phase 6 EXPANSION — fine-grained id on the rescue path
          // (mirrors the main toCacheEntries write above).
          premiseStyleId: c.meta.premiseStyleId,
          // Phase 6D (PREMISE EXECUTION EXPANSION) — execution-pattern
          // id on the rescue path (mirrors the main toCacheEntries
          // write above).
          executionId: c.meta.executionId,
          // Phase 6E (PREMISE COMEDY SCORING + REJECTION) — same
          // field on the rescue path so a best-effort empty-after-
          // filter ship still surfaces the rubric total to the QA
          // driver telemetry. Mirrors the main toCacheEntries write
          // above; undefined for legacy / fallback entries that
          // never carried a comedy score flows through cleanly.
          premiseComedyScoreTotal:
            "premiseComedyScore" in c.meta &&
            c.meta.premiseComedyScore !== undefined
              ? c.meta.premiseComedyScore.total
              : undefined,
          // Phase 6F (LEGACY COMEDY SCORING + REJECTION) — same
          // field on the rescue path so a best-effort empty-after-
          // filter ship still surfaces the legacy rubric total to
          // the QA driver telemetry. Mirrors the main
          // toCacheEntries write above; undefined for premise /
          // pre-6F-cache / fallback-without-polish entries that
          // never carried a legacy comedy score flows through
          // cleanly.
          legacyComedyScoreTotal:
            "legacyComedyScore" in c.meta &&
            c.meta.legacyComedyScore !== undefined
              ? c.meta.legacyComedyScore.total
              : undefined,
          // Phase 7 (VIRAL FEEL SCORE) — same field on the rescue
          // path so a best-effort empty-after-filter ship still
          // surfaces the viral rubric total to the QA driver
          // telemetry. Mirrors the main toCacheEntries write
          // above; undefined for pre-Phase-7 cache entries +
          // Llama / Claude fallback wraps that didn't run through
          // `assembleCandidate` flows through cleanly.
          viralFeelScoreTotal:
            "viralFeelScore" in c.meta &&
            c.meta.viralFeelScore !== undefined
              ? c.meta.viralFeelScore.total
              : undefined,
        }));
      await persistCache(input.creator, rescueEntries);
    }
    return {
      ideas: ideasOnly,
      source: "pattern",
      usedFallback,
      counts: { localKept: 0, fallbackKept: 0 },
    };
  }

  // TREND + ARCHETYPE PAIRING spec — apply the within-batch HARD
  // CAP just before computing the shipped `ideas` + the persisted
  // cache entries, so BOTH consumers (the response payload AND the
  // next regen's `recentTrendIds`) see the capped state. Reverted
  // candidates have their pre-trend caption restored from
  // `meta.originalCaption` and `meta.trendId` cleared — they STILL
  // ship in the response (just untagged), and the cache entry's
  // `trendId` becomes undefined for those slots (matches the
  // soft-skip discipline of `validateTrendInjection`). Priority
  // uses `score.total` so the lowest-scoring trend-injected
  // candidate is the one that loses its trend tag when the cap
  // fires. Reassigning `final` (declared `let` above) keeps every
  // downstream reference (cache write, source label counters)
  // consistent with the post-cap state.
  final = enforceTrendCap(final, (c) => c.score.total);
  // PHASE Z1 — annotate willingnessScore + whyThisFitsYou on every
  // shipped idea AND reorder so picker-eligible / high-willingness
  // candidates surface first. Pure deterministic, no I/O. The
  // reorder happens AFTER trend-cap so trend semantics are
  // preserved (cap operates on `score.total`, ranker on the
  // separate `willingnessScore` axis).
  final = annotateAndSortByWillingness(final);
  const ideas = gate(final.map((c) => c.idea));
  // Persist as entries so the next regenerate has family +
  // templateId for HARD exclusion, not just hook strings.
  const entriesToCache = toCacheEntries(final).slice(0, ideas.length);
  await persistCache(input.creator, entriesToCache);

  // Source label:
  //   "pattern"  — pure deterministic, no Claude fallback, no Llama mutation
  //   "fallback" — Claude fallback used AND every shipped idea came from Claude
  //   "mixed"    — at least one Claude idea + at least one non-Claude, OR
  //                Llama mutation produced at least one accepted rewrite
  //                (mutated ideas live on top of pattern seeds, but their
  //                hooks are now Llama-authored — surface that to the caller)
  const claudeShipped = final.filter(
    (c) => c.meta.source === "claude_fallback",
  ).length;
  const localShipped = final.length - claudeShipped;
  const source: HybridIdeatorSource = usedFallback
    ? claudeShipped === final.length
      ? "fallback"
      : "mixed"
    : usedLlamaMutation
      ? "mixed"
      : "pattern";

  // PHASE Y3 (LOCAL premiseCoreId TAGGING) — telemetry on
  // local-pool core-tagging coverage. Counts cover only the
  // LOCAL pattern-pool candidates (Layer-1) since the Claude
  // wrap path already ships premiseCoreId from the model. The
  // `topUnmappedPremiseHooks` slice is the actionable signal for
  // the next mapping-spec pass — premium entries that picker-walked
  // through but the (premiseStyleId, executionId) pair didn't
  // resolve to a core are exactly the candidates a future mapping
  // expansion needs to absorb.
  let localPremiseCoreTaggedCount = 0;
  let localPremiseCoreUnmappedCount = 0;
  const mappedCoreIds = new Set<string>();
  const unmappedHookCounts = new Map<string, number>();
  for (const c of localCandidates) {
    if (c.meta.source !== "pattern_variation") continue;
    if (c.meta.usedBigPremise !== true) continue;
    const tag = (c.meta as { premiseCoreId?: string }).premiseCoreId;
    if (typeof tag === "string" && tag.length > 0) {
      localPremiseCoreTaggedCount += 1;
      mappedCoreIds.add(tag);
    } else if (c.meta.premiseStyleId && c.meta.executionId) {
      localPremiseCoreUnmappedCount += 1;
      const key = c.idea.hook.toLowerCase().trim();
      unmappedHookCounts.set(key, (unmappedHookCounts.get(key) ?? 0) + 1);
    }
  }
  const localPremiseCount =
    localPremiseCoreTaggedCount + localPremiseCoreUnmappedCount;
  const localPremiseCoreTaggedRate =
    localPremiseCount > 0
      ? localPremiseCoreTaggedCount / localPremiseCount
      : 0;
  const topUnmappedPremiseHooks = Array.from(unmappedHookCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([hook, count]) => ({ hook, count }));

  // PHASE Y4 telemetry — count how many SHIPPED ideas (post-selection)
  // carry per-axis recent-repeat tags. Computed against the same
  // `noveltyContext` recent sets that `selectionPenalty` reads, so
  // these counters tell us "how many demoted candidates still won
  // their slot" — exactly the signal needed to gauge whether the
  // PART 1/2/3 demotes are biting hard enough to flip selection.
  // Counters fire post-selection on `final[]`, NOT on the
  // candidate pool, so the same idea can only contribute once
  // per axis. Skipped silently when a tag is undefined (legacy /
  // pattern entries without the relevant fine-grained id).
  let selectedRepeatedPremiseStyleCount = 0;
  let selectedRepeatedExecutionCount = 0;
  let selectedRepeatedPremiseCoreCount = 0;
  let selectedSameStyleExecutionCount = 0;
  let selectedSameStyleExecutionCoreCount = 0;
  const recentStyles = noveltyContext.recentPremiseStyleIds;
  const recentExecs = noveltyContext.recentExecutionIds;
  const recentCores = noveltyContext.recentPremiseCoreIds;
  for (const c of final) {
    const sId = (c.meta as { premiseStyleId?: string }).premiseStyleId;
    const eId = c.meta.executionId;
    const cId = (c.meta as { premiseCoreId?: string }).premiseCoreId;
    const styleHit =
      typeof sId === "string" && (recentStyles?.has(sId as never) ?? false);
    const execHit =
      typeof eId === "string" && (recentExecs?.has(eId) ?? false);
    const coreHit =
      typeof cId === "string" && (recentCores?.has(cId) ?? false);
    if (styleHit) selectedRepeatedPremiseStyleCount += 1;
    if (execHit) selectedRepeatedExecutionCount += 1;
    if (coreHit) selectedRepeatedPremiseCoreCount += 1;
    if (styleHit && execHit) {
      selectedSameStyleExecutionCount += 1;
      if (coreHit) selectedSameStyleExecutionCoreCount += 1;
    }
  }

  // -------- PHASE Y5 telemetry --------------------------------------
  // Counts how many `core_native` candidates the parallel generator
  // produced, how many survived `filterAndRescore`, how many won
  // selection vs. `pattern_variation`, plus a top-3 source histogram
  // and the selected core ids. Pure read-only — no behavior change.
  // The cache-path served log mirrors zero defaults for these keys
  // so dashboards never NPE on a `cache` reply.
  const coreNativeGeneratedCount = coreNativeResult.stats.generatedCount;
  let coreNativeKeptCount = 0;
  for (const c of localResult.kept) {
    if (c.meta.source === "core_native") coreNativeKeptCount += 1;
  }
  let coreNativeSelectedCount = 0;
  let localSelectedCount = 0;
  const sourceHist = new Map<string, number>();
  const selectedPremiseCoreIds: string[] = [];
  for (const c of final) {
    const src = c.meta.source;
    sourceHist.set(src, (sourceHist.get(src) ?? 0) + 1);
    if (src === "core_native") coreNativeSelectedCount += 1;
    if (src === "pattern_variation") localSelectedCount += 1;
    const cId = (c.meta as { premiseCoreId?: string }).premiseCoreId;
    if (typeof cId === "string" && cId.length > 0) {
      selectedPremiseCoreIds.push(cId);
    }
  }
  const coreNativeSelectedRate =
    final.length > 0 ? coreNativeSelectedCount / final.length : 0;
  const topSelectedSources: Array<{ source: string; count: number }> =
    Array.from(sourceHist.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([s, n]) => ({ source: s, count: n }));
  const coreNativeRejectionReasons = coreNativeResult.stats.rejectionReasons;

  // -------- PHASE Y6 telemetry --------------------------------------
  // Cohesive single-pass author surfaces a `scenarioFingerprint`
  // (sf_<12hex>) on every core_native candidate's meta. We surface
  // them here so QA + Y8 (semantic dedup) can read them off the
  // served-log without a DB scan. We also surface the distinct
  // anchor nouns the author used this batch — coverage signal that
  // the catalog rotation is actually rotating, not just shipping
  // the same anchor cycle after cycle.
  const scenarioFingerprintsThisBatch: string[] = [];
  const coreNativeAnchorsUsedSet = new Set<string>();
  // Catalog anchor probe is materialized lazily inside extractAnchor
  // — we only call it on core_native candidates so the cost is
  // bounded by `count` (≤ batch size).
  const _allAnchors = getAllCatalogAnchors();
  // Action probe set — small constant set of family-action bare
  // verbs. Cheap to materialize per batch.
  const _allActions = new Set<string>(
    Object.values(FAMILY_ACTIONS).map((a) => a.bare),
  );
  for (const c of final) {
    // PHASE Y8 — `scenarioFingerprint` is now a properly typed field
    // on both arms of `CandidateMeta` (PatternMeta + the fallback
    // arm), so the Y6-era `as { scenarioFingerprint?: string }` cast
    // is no longer needed — read the field directly off the union.
    const sf = c.meta.scenarioFingerprint;
    if (typeof sf === "string" && sf.length > 0) {
      scenarioFingerprintsThisBatch.push(sf);
    }
    if (c.meta.source === "core_native") {
      const probe = extractAnchorAndAction(c.idea, _allAnchors, _allActions);
      if (probe.anchor) coreNativeAnchorsUsedSet.add(probe.anchor);
    }
  }
  const coreNativeAnchorsUsed = Array.from(coreNativeAnchorsUsedSet).sort();

  logger.info(
    {
      source,
      creatorId: input.creator?.id,
      count: ideas.length,
      localCandidates: localCandidates.length,
      localKept: localResult.kept.length,
      fallbackKept: fallbackKeptCount,
      hardRejected: localResult.hardRejected,
      rewriteSucceeded: localResult.rewriteSucceeded,
      usedFallback,
      durationMs: Date.now() - startedAt,
      // PHASE Y3 telemetry
      localPremiseCoreTaggedCount,
      localPremiseCoreTaggedRate,
      localPremiseCoreUnmappedCount,
      mappedPremiseCoreIds: Array.from(mappedCoreIds),
      topUnmappedPremiseHooks,
      // PHASE Y4 telemetry (selected-set repeat counters)
      selectedRepeatedPremiseStyleCount,
      selectedRepeatedExecutionCount,
      selectedRepeatedPremiseCoreCount,
      selectedSameStyleExecutionCount,
      selectedSameStyleExecutionCoreCount,
      // PHASE Y5 telemetry (core-native parallel generator)
      coreNativeGeneratedCount,
      coreNativeKeptCount,
      coreNativeSelectedCount,
      coreNativeSelectedRate,
      localSelectedCount,
      topSelectedSources,
      selectedPremiseCoreIds,
      coreNativeRejectionReasons,
      // PHASE Y6 telemetry (cohesive single-pass author)
      // - scenarioFingerprintsThisBatch: every shipped idea's
      //   `meta.scenarioFingerprint` (sf_<12hex>) — Y8 will use
      //   the cross-batch distribution for semantic dedup; Y6
      //   surfaces it for QA inspection
      // - coreNativeAnchorsUsed: distinct anchor nouns the cohesive
      //   author rendered into core_native candidates this batch
      //   (extracted from the meta-side fingerprint via the catalog
      //   anchor probe)
      scenarioFingerprintsThisBatch,
      coreNativeAnchorsUsed,
    },
    "hybrid_ideator.served",
  );

  // PHASE Y7 — build the per-idea QA telemetry array. We already
  // walked `final` above for fingerprints + anchors; do one more
  // bounded pass here (≤ batch size) to capture per-idea voice
  // and source labels for the additive `qaTelemetry` surface.
  const qaPerIdea = final.map((c) => {
    // PHASE Y8 — `scenarioFingerprint`, `voiceClusterId`, AND
    // `hookQualityScore` are now properly typed optional fields on
    // both arms of `CandidateMeta` (see PatternMeta + the fallback
    // arm in ideaScorer.ts), so the Y6/Y7-era cast can read them
    // directly off the union with no `as` widening.
    const m = c.meta;
    let anchor: string | undefined;
    if (m.source === "core_native") {
      const probe = extractAnchorAndAction(c.idea, _allAnchors, _allActions);
      if (probe.anchor) anchor = probe.anchor.toLowerCase();
    }
    return {
      source: m.source ?? "unknown",
      voiceClusterId: m.voiceClusterId,
      scenarioFingerprint: m.scenarioFingerprint,
      hookQualityScore: m.hookQualityScore,
      anchor,
      premiseCoreId: (m as { premiseCoreId?: string }).premiseCoreId,
      // PHASE UX3.2 — surface the authored-plan domainId so QA
      // harness + the `authored_domain_used_generic_template`
      // validator can verify which authoring path each shipped
      // `core_native` candidate took. Absent for non-`core_native`
      // candidates and for `core_native` candidates whose anchor
      // wasn't in the authored set.
      authoredPlanId: (m as { authoredPlanId?: string }).authoredPlanId,
      nigerianPackEntryId: (m as { nigerianPackEntryId?: string })
        .nigerianPackEntryId,
    };
  });

  return {
    ideas,
    source,
    usedFallback,
    counts: {
      localKept: localShipped,
      fallbackKept: claudeShipped,
    },
    qaTelemetry: {
      perIdea: qaPerIdea,
      scenarioFingerprintsThisBatch,
      coreNativeAnchorsUsed,
      // PHASE D5-QA — surface the D4 reject-source aggregate on the
      // orchestrator result so the d5Qa.ts harness can read it
      // structurally. `coreNativeResult.stats.antiCopyRejects` is
      // ALWAYS populated (defaults `{ corpus:0, style_defs:0 }, []`
      // for cold-start / no-reject batches), so consumers can rely
      // on the field without null checks.
      coreNative: {
        antiCopyRejects: coreNativeResult.stats.antiCopyRejects,
      },
    },
  };
}
