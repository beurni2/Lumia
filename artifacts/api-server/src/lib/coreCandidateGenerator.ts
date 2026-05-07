/**
 * PHASE Y5 — CORE-NATIVE CANDIDATE GENERATOR
 * PHASE Y6 — Cohesive single-pass authoring (replaces fragment-assembly)
 *
 * Pure, deterministic generator that turns selected `PremiseCore`
 * rows into local idea candidates that compete alongside the
 * existing `pattern_variation` pool. NO Claude. NO cost increase.
 * NO API/DB/schema change. Win on score; merge pre-`filterAndRescore`.
 *
 * Each candidate carries:
 *   meta.source = "core_native"
 *   meta.usedBigPremise = true
 *   meta.premiseCoreId, meta.premiseStyleId, meta.executionId
 *   meta.scenarioFingerprint  (Y6 — Y8 will use this for semantic dedup;
 *     read at served-log time via `as { scenarioFingerprint?: string }`)
 *   meta.scenarioFamily = undefined  (mirrors fallback discipline —
 *     `applyExclusion` family check is a structural no-op for absent
 *     family, same as Claude wraps)
 *
 * Pipeline-side semantics (unchanged for existing sources):
 *   - NOT eligible for the rewriter (it gates on
 *     `meta.source === "pattern_variation"`).
 *   - Loses sort tiebreaks against pattern_variation (cost-neutral
 *     catalog still wins on equal score).
 *   - Vacuous-passes the comedy gate via `usedBigPremise: true`
 *     (curated mechanism; same discipline as Claude premise wraps).
 *   - Stays subject to the anti-copy seed-hook check, but Y6 relaxes
 *     that gate from exact-fingerprint match to Jaccard ≥ 0.85 on
 *     bigrams (`comedyValidation.validateAntiCopy`) so voice-trained
 *     hooks that share a SCAFFOLD with a seed but use a fresh anchor
 *     are no longer rejected. Near-verbatim duplicates still are.
 *
 * Y6 architectural shift: the per-core retry loop no longer picks
 * a hook from `core.examples` and post-hoc glues whatToShow / etc
 * around its tokens. Instead, it iterates a salt-rotated
 * `(domain, anchor)` recipe queue from `CORE_DOMAIN_ANCHORS`, picks
 * a voice cluster deterministically by family, and calls
 * `authorCohesiveIdea(...)` which renders all downstream fields
 * from the same (anchor, actionPast, ingForm) substitution table
 * in ONE pass. There is no fragment-assembly step left to be
 * incoherent across.
 *
 * Determinism: given identical (cores, regenerateSalt, noveltyContext,
 * recentPremises) inputs, returns byte-identical output. Salt is the
 * only source of variation across regenerates.
 */

import { type Idea } from "./ideaGen.js";
import {
  loadSeedHookFingerprints,
  type ComedyRejectionReason,
  type AntiCopyMatch,
  type AntiCopySeedSource,
} from "./comedyValidation.js";
import type { PremiseCore } from "./premiseCoreLibrary.js";
import type { CandidateMeta } from "./ideaScorer.js";
import {
  CORE_DOMAIN_ANCHORS,
  type CoreDomainAnchorRow,
} from "./coreDomainAnchorCatalog.js";
import {
  getVoiceCluster,
  type VoiceClusterId,
} from "./voiceClusters.js";
import {
  authorCohesiveIdea,
  type CohesiveAuthorRejectionReason,
} from "./cohesiveIdeaAuthor.js";
import type {
  TasteCalibration,
  PreferredTone,
} from "./tasteCalibration.js";
import { scoreHookQuality } from "./hookQuality.js";
import type { Region } from "@workspace/lumina-trends";
import { REGION_VOICE_BIAS } from "./regionProfile.js";
import { REGION_ANCHORS, hasRegionAnchors } from "./regionAnchorCatalog.js";
// PHASE N1-S — Nigerian pack atomic-recipe integration. The pack
// import is unconditional (the live `NIGERIAN_HOOK_PACK` is empty
// when `LUMINA_NG_PACK_ENABLED` is not "true", so flag-off behavior
// stays byte-identical to pre-N1-S) but the activation guard
// `getEligibleNigerianPackEntries` short-circuits on every non-
// nigerian / non-pidgin / flag-off path. The author runs the SAME
// four production validators with NO loosening.
import {
  getEligibleNigerianPackEntries,
  isNigerianPackFeatureEnabled,
  NIGERIAN_PACK_PREFIX_CAP,
  type NigerianPackEntry,
} from "./nigerianHookPack.js";
import { authorPackEntryAsIdea } from "./nigerianPackAuthor.js";
// PHASE N1-LIVE-HARDEN P2 — structured per-core pack diagnostic.
import { logger } from "./logger.js";
import {
  computeNigerianStylePenalty,
  isNigerianStylePenaltyFeatureEnabled,
} from "./nigerianStylePenalty.js";
// PHASE W1 — Western catalog hook quality + repetition control.
// Cohort-gated demotion-only adjustment for the catalog (non-pack)
// recipe path. Returns 0 for non-western cohorts via its own gate so
// the call site is branch-free. See westernHookQuality.ts for the
// helper contract + magnitudes.
import {
  computeWesternHookAdjustment,
  computeWesternSpecificityAdjustment,
} from "./westernHookQuality.js";

// ---------------------------------------------------------------- //
// Public types                                                      //
// ---------------------------------------------------------------- //

export type CoreNativeCandidate = { idea: Idea; meta: CandidateMeta };

export type CoreNoveltyContext = {
  /** Premise-style ids shipped in recent batches. Y6 keeps the
   *  field on the input shape for backwards compat with callers,
   *  but the cohesive author chooses `premiseStyleId` from the
   *  core's first compatible style for traceability — recency
   *  pressure on style id moves to Y7's taste-driven selection. */
  recentPremiseStyleIds?: ReadonlySet<string>;
  /** Premise-execution ids shipped in recent batches — same shape
   *  notes as `recentPremiseStyleIds`. */
  recentExecutionIds?: ReadonlySet<string>;
  /** PHASE Y7 — lowercased anchors shipped in recent visible
   *  batches. O(1) freshness signal for `buildRecipeQueue` —
   *  catalog anchors NOT in this set get PROMOTED to the front
   *  of the per-core queue. Falls back to the existing
   *  `recentPremises` word-boundary regex when undefined OR
   *  empty (back-compat with cold-start creators). Built by
   *  `hybridIdeator.buildRecipeAnchorMemory`. */
  recentAnchors?: ReadonlySet<string>;
  /** PHASE Y8 — `sf_<12hex>` scenario fingerprints shipped in the
   *  last 7 visible batches (PHASE Y10 widened from 5). O(1)
   *  HARD-REJECT signal in the recipe loop — when a freshly authored
   *  idea's `result.scenarioFingerprint` lands in this set, the recipe
   *  is dropped with reason `scenario_repeat` and the iterator
   *  advances. Empty set / undefined for cold-start creators —
   *  the gate stays quiet and every recipe ships, which is the
   *  correct behavior for a creator with no history. Built by
   *  `hybridIdeator.loadMemory` by reading `e.scenarioFingerprint`
   *  off each cached batch entry (Y8 widened CachedBatchEntry to
   *  persist the fp directly). Pairs with the in-batch
   *  `usedFingerprintsThisBatch` tracker below for full coverage
   *  across cross-batch + intra-batch dedup. */
  recentScenarioFingerprints?: ReadonlySet<string>;
  /** PHASE Y10 — voice cluster usage HISTOGRAM across the last 7
   *  visible batches (current + 6 history). Map key is the
   *  `VoiceClusterId`; value is the integer count of times that
   *  cluster shipped in the window. Threaded into the per-recipe
   *  `resolveVoiceCluster` picker which selects the cluster with
   *  the LOWEST recent count from the family-biased rotation
   *  table. Family bias (the family's curated default appears 3x
   *  in the rotation table) is preserved as the natural tiebreak
   *  when multiple clusters share the min count.
   *
   *  Why a histogram (not a Set): there are only 4 voice clusters
   *  AND each batch ships ~3 ideas → after 1-2 batches a Set-based
   *  exclusion would mark every cluster recent and starve the
   *  picker. The histogram lets the resolver keep rotating
   *  smoothly even at steady state, always preferring the LEAST-
   *  USED cluster.
   *
   *  Empty Map / undefined for cold-start creators (no batch json)
   *  and for entries written before Y6 started persisting
   *  `voiceClusterId` on cache entries — the resolver no-ops on an
   *  empty histogram and falls through to the existing salt-
   *  rotated family-biased table. Built by
   *  `hybridIdeator.loadMemory`. */
  recentVoiceClusters?: ReadonlyMap<VoiceClusterId, number>;
};

export type GenerateCoreCandidatesInput = {
  cores: readonly PremiseCore[];
  /** Maximum candidates to return. Once cap is reached, remaining
   *  cores are recorded as `kept: false, attempts: 0` so the QA
   *  driver can see they were skipped (not rejected). */
  count: number;
  noveltyContext?: CoreNoveltyContext;
  /** Same engine-wide salt the local pool already uses; rotates
   *  every regenerate so the same core can produce a different
   *  hook variant on the next regenerate. */
  regenerateSalt?: number;
  /** Normalized premise sentences from the last-N cached batches.
   *  Threaded into `validateAntiCopy` to reject premise repeats AND
   *  used by the Y6 recipe rotation to PROMOTE fresh anchors to
   *  the front of the queue (anchors NOT substring-contained in
   *  any recent premise win the cycle order tiebreak). */
  recentPremises?: ReadonlySet<string>;
  /** PHASE Y7 — taste calibration document for the requesting
   *  creator (parsed via `parseTasteCalibration`). Drives
   *  `resolveVoiceCluster` priority: when `preferredTone` is set
   *  the resolver returns the matching `VoiceClusterId` for
   *  every recipe (taste-pinned generation). Null / undefined
   *  falls through to the cold-start salt rotation across all
   *  4 clusters with a 2x bias toward the family's curated
   *  default in `FAMILY_VOICE`. Parse failures must be coerced
   *  to `null` upstream — the resolver does not retry parsing. */
  tasteCalibration?: TasteCalibration | null;
  /** PHASE N1-LIVE-HARDEN PACK-AWARE-RETENTION (BI 2026-05-07) —
   *  per-creator Nigerian pack entry-id memory snapshot. Read by the
   *  pack-aware per-core retention block ONLY (and only when
   *  `LUMINA_NG_PACK_AWARE_RETENTION_ENABLED=true` AND the cohort is
   *  pack-eligible). Used to skip pack candidates whose entryId the
   *  creator already saw in a recent batch, preventing the per-core
   *  retained pack pick from re-shipping the same pack hook. The
   *  downstream `applyNigerianPackSlotReservation` enforces the same
   *  filter on its own pool — this field just teaches the upstream
   *  per-core picker about it so cross-batch repeats are avoided
   *  BEFORE the candidate flows into selection. Empty/undefined Set
   *  preserves pre-flag behavior. */
  recentNigerianPackEntryIds?: ReadonlySet<string>;
  /** PHASE W1 — per-creator catalog hook skeleton memory snapshot
   *  used by the cohort-gated Western hook adjustment for the
   *  recent-skeleton repetition demotion. Read upstream from the
   *  same `creators.catalog_template_seen_ids_json` column the
   *  hybrid ideator's catalog skeleton swap already consults
   *  (see `getRecentSeenSkeletons` in `catalogTemplateCreatorMemory.ts`),
   *  hoisted alongside the existing pack entry-id snapshot in
   *  `hybridIdeator.ts` so non-western cohorts pay zero DB cost.
   *  Empty/undefined Set short-circuits the repetition demotion
   *  (cold-start creators ship every skeleton). The Western helper
   *  also gates internally on cohort, so passing a non-empty Set
   *  to a non-western cohort is still a no-op. */
  recentCatalogSkeletons?: ReadonlySet<string>;
  /** PHASE R1 — optional region for deterministic regional
   *  baseline decoration. Threaded straight through to
   *  `authorCohesiveIdea`. `"western"` / `undefined` short-circuit
   *  the decoration adapter to identity, so cold-start and western
   *  creators are byte-identical to pre-R1. See
   *  `regionProfile.ts` for the decoration safety contract. */
  region?: Region;
};

/** Y6 widens the rejection-reason union with `construction_failed`
 *  (cohesive author returns this when its structural precondition —
 *  hook ↔ whatToShow ↔ howToFilm anchor present and contradiction
 *  beat present — fails) so dashboards can distinguish recipe-bug
 *  rejections from gate rejections. Y8 adds `scenario_repeat` for
 *  the new fingerprint dedup gate — fired when a freshly authored
 *  idea's `result.scenarioFingerprint` matches an entry in
 *  `noveltyContext.recentScenarioFingerprints` (cross-batch) OR in
 *  the in-batch `usedFingerprintsThisBatch` tracker (sibling cores
 *  in the same batch). */
export type CoreCandidateRejectionReason =
  | ComedyRejectionReason
  | "schema_invalid"
  | "construction_failed"
  | "core_misconfigured"
  | "scenario_repeat"
  // PHASE UX3 + UX3.1 — scenario coherence rejection reasons rolled
  // up from the cohesive author. The author surfaces these via its
  // own union (`CohesiveAuthorRejectionReason`); keeping them
  // representable here lets the recipe loop's `lastReason` and the
  // per-reason `reasons` map type-check cleanly without a cast.
  | "deliberate_template_artifact"
  | "scene_template_leakage"
  | "direct_to_camera_in_show"
  | "show_missing_hook_anchor"
  | "split_self_show_mismatch"
  | "template_stiffness_phrase"
  | "bad_grammar_by_past_participle"
  | "hook_topic_noun_drift"
  | "verb_anchor_implausible"
  // PHASE UX3.2 — Authored Scenario Planner rejection reasons.
  // Same additive overlay pattern as UX3 + UX3.1 above; keeps the
  // recipe loop's `lastReason` + per-reason counter map type-clean
  // when the cohesive author surfaces a UX3.2 verdict.
  | "impossible_physical_action_on_abstract"
  | "placeholder_filming_phrase"
  | "authored_domain_used_generic_template"
  // PHASE UX3.3 — close the metric-lying gap. Same additive overlay
  // pattern. Recipe loop counts these the same as any other coherence
  // rejection; rejection drives a recipe retry rather than a fail.
  | "family_verb_leak_on_scene"
  | "meta_template_signature";

export type CoreCandidateAttempt = {
  coreId: string;
  kept: boolean;
  attempts: number;
  lastReason?: CoreCandidateRejectionReason;
  /** PHASE D4 — when `lastReason === "copied_seed_hook"`, the
   *  reject-source metadata for the LAST recipe that tripped the
   *  gate (which sub-pool the matched seed came from + its hash +
   *  the Jaccard score + which gate fired). Lets the QA driver
   *  introspect specific reject events without a separate log
   *  scan. Optional — every other rejection reason omits it. */
  antiCopyMatch?: AntiCopyMatch;
};

/** PHASE D4 — per-batch aggregate of `copied_seed_hook` rejections
 *  broken down by which reference pool matched. Closes the D3 honest
 *  gap (post-D3 the corpus + style_defs combined raised the seed
 *  pool from ~200 to ~359; without this breakdown we couldn't tell
 *  whether the corpus expansion over-rejects in practice). Pure
 *  additive — consumers that don't read it ignore the field. */
export type AntiCopyRejectsTelemetry = {
  /** Per-source counters. Always full-shape so dashboards can
   *  read `.corpus` / `.style_defs` without `??`. */
  bySource: Record<AntiCopySeedSource, number>;
  /** Bounded sample of individual reject events (capped at
   *  `ANTI_COPY_SAMPLE_CAP` per batch) so the QA driver can see
   *  WHICH specific seeds are doing the rejecting + at what
   *  Jaccard. Order is insertion order (recipe iteration order,
   *  itself salt-deterministic). */
  samples: AntiCopyMatch[];
};

export type GenerateCoreCandidatesResult = {
  candidates: CoreNativeCandidate[];
  stats: {
    /** Total recipe attempts evaluated through the gates. */
    generatedCount: number;
    keptCount: number;
    /** Per-reason counters. Always full-shape so dashboards can
     *  `.no_tension` etc. without `??`. Y8 adds `scenario_repeat`
     *  to the shape so the QA driver can read fp-dedup rejection
     *  density off the same field. */
    rejectionReasons: Record<
      | ComedyRejectionReason
      | "schema_invalid"
      | "construction_failed"
      | "scenario_repeat"
      // PHASE UX3 + UX3.1 — scenario coherence reasons rolled up
      // from the cohesive author. Pure additive overlay; existing
      // dashboard fields (`.no_tension` etc.) keep working
      // unchanged.
      | "deliberate_template_artifact"
      | "scene_template_leakage"
      | "direct_to_camera_in_show"
      | "show_missing_hook_anchor"
      | "split_self_show_mismatch"
      | "template_stiffness_phrase"
      | "bad_grammar_by_past_participle"
      | "hook_topic_noun_drift"
      | "verb_anchor_implausible",
      number
    >;
    /** PHASE D4 — additive `copied_seed_hook` reject-source
     *  breakdown. The reason counter on `rejectionReasons.copied_seed_hook`
     *  always equals `bySource.corpus + bySource.style_defs` for
     *  this batch (invariant — every `copied_seed_hook` rejection
     *  flows through the detailed validator and contributes to
     *  exactly one of those two source buckets).
     *
     *  PHASE D15-alt — `bySource.style_defs_self` is a TELEMETRY-
     *  ONLY counter for self-recipe exemptions: the unigram-
     *  fallback gate matched the candidate's ORIGINATING execution
     *  example and the validator passed it through (D5 circularity
     *  fix). These events are NOT rejections and therefore do NOT
     *  appear in `rejectionReasons.copied_seed_hook`; the bucket
     *  tracks them separately so the QA driver can see how often
     *  the circularity is being hit. */
    antiCopyRejects: AntiCopyRejectsTelemetry;
    perCoreAttempts: CoreCandidateAttempt[];
    /** PHASE W1.1 AUDIT (BI 2026-05-07) — additive cohort-gated tally
     *  of per-recipe Western hook adjustment outcomes. Populated ONLY
     *  when `input.region === undefined || input.region === "western"`;
     *  omitted for non-western cohorts so existing dashboards see no
     *  shape drift. Counts cover EVERY catalog (non-pack) recipe whose
     *  hook reached the W1 scoring branch (i.e. survived comedy /
     *  anti-copy / scenario-fingerprint gates up to the per-core
     *  `westernAdjustment` site), not just the per-core winners.
     *  `netDelta` is the sum of signed adjustments — positive = pool
     *  got boosted on net, negative = pool got demoted on net. Pure
     *  read-only telemetry; no behavior change. */
    westernAdjustmentSummary?: {
      recipesScored: number;
      demoted: number;
      boosted: number;
      zero: number;
      netDelta: number;
    };
  };
};

// ---------------------------------------------------------------- //
// PHASE Y7 — voice cluster resolution                               //
//                                                                   //
// Resolution priority (first match wins):                           //
//   1. `tasteCalibration.preferredTone` set     → direct map        //
//      (taste-pinned: every recipe in the batch uses that voice)    //
//   2. Cold-start fallback                      → salt-rotation     //
//      across all 4 clusters indexed by                             //
//      djb2(`${salt}|${coreId}|${recipeIdx}|voice`) % 8 against     //
//      an 8-slot table where the family's curated `FAMILY_VOICE`    //
//      cluster occupies 2 slots (2x bias) and the other 3 clusters  //
//      occupy 2 slots each.                                         //
//                                                                   //
// Y6 collapsed to `dry_deadpan` for most families because the       //
// static map pinned each family to one cluster and the catalog      //
// distribution skewed toward families pinned to that cluster. Y7    //
// keeps the curated FAMILY_VOICE intent (2x weight) but lets the    //
// per-recipe rotation surface the other 3 clusters in cold-start    //
// QA — by construction (no calibration data required).              //
// ---------------------------------------------------------------- //

type Family = PremiseCore["family"];

const FAMILY_VOICE: Record<Family, VoiceClusterId> = {
  self_betrayal: "dry_deadpan",
  self_as_relationship: "chaotic_confession",
  absurd_escalation: "overdramatic_reframe",
  confident_vs_real: "quiet_realization",
  social_mask: "quiet_realization",
  adulting_chaos: "chaotic_confession",
  dopamine_overthinking: "quiet_realization",
  identity_exposure: "dry_deadpan",
};

const TONE_TO_VOICE_CLUSTER: Record<PreferredTone, VoiceClusterId> = {
  dry_subtle: "dry_deadpan",
  chaotic: "chaotic_confession",
  bold: "overdramatic_reframe",
  self_aware: "quiet_realization",
  // PHASE Z5.8 — closed-beta Quick Tune surfaces high_energy_rant
  // as a fifth tone option. The Z5a "internal-first, no enum pin"
  // posture is superseded by the explicit beta spec; the cluster
  // now participates in the same priority-1 tone-bias slot bonus
  // as the other four (D1-softened: +5 slots, ~50–57% share, never
  // monoculture). Z5a registration / template / cold-start coverage
  // remains untouched.
  high_energy_rant: "high_energy_rant",
};

// PHASE Z5a/Z5.8 — high_energy_rant rotation pool. Z5a added it
// internal-first (cold-start surfacing only); Z5.8 promoted it to
// a Quick Tune tone enum value, so it now also participates in the
// tone-bias slot bonus through TONE_TO_VOICE_CLUSTER above. The
// biased table still has 10 base slots (5 × 2), 11 with familyDefault
// bonus, 16 with a tone-pinned creator — see the slot-share
// comments in `resolveVoiceCluster`.
const ALL_VOICE_CLUSTERS: readonly VoiceClusterId[] = [
  "dry_deadpan",
  "chaotic_confession",
  "quiet_realization",
  "overdramatic_reframe",
  "high_energy_rant",
];

/** PHASE Y7 — pure, deterministic voice cluster resolver. See the
 *  block comment above for the priority chain. Exported for unit
 *  testing the cold-start rotation distribution + the taste-pinned
 *  override.
 *
 *  PHASE Y10 — accepts an optional `recentVoiceClusters` HISTOGRAM
 *  (Map<VoiceClusterId, number>) summing voice cluster usages
 *  across the last 7 visible batches. When non-empty, the resolver
 *  walks the salt-rotated biased table and picks the FIRST cluster
 *  whose recent count equals the MIN over the 4 clusters — i.e.
 *  the LEAST-RECENTLY-USED cluster wins, with the family's curated
 *  bias acting as the natural tiebreak (the family default
 *  appears 3x in the table → wins ties at the salt-rotated start).
 *  When undefined OR empty (cold-start), behavior is bit-for-bit
 *  identical to pre-Y10: the salt-rotated index of the biased
 *  table wins directly. */
export function resolveVoiceCluster(input: {
  family: Family;
  tasteCalibration?: TasteCalibration | null;
  salt: number;
  coreId: string;
  recipeIdx: number;
  recentVoiceClusters?: ReadonlyMap<VoiceClusterId, number>;
  /** PHASE R4 — optional region for additive +slot voice bias.
   *  `undefined` and `"western"` add zero entries (byte-identical
   *  to pre-R4). See REGION_VOICE_BIAS in regionProfile.ts. */
  region?: Region;
}): VoiceClusterId {
  // PHASE D1 — soften the prior priority-1 hard short-circuit
  // (was: `if (tone) return TONE_TO_VOICE_CLUSTER[tone]` — a 1.00
  // pin that collapsed every recipe to one voice cluster for any
  // creator who picked a tone in onboarding, producing the voice
  // monoculture observed in the post-Y11 14-trash-ideas user
  // report). The pin is now folded into the same biased-table
  // mechanism as `familyDefault` — preferred-tone cluster gets +5
  // slots so it dominates (~50-57%) without monopolising. Other
  // clusters keep enough representation that batch-level voice
  // variety survives. The Y10 histogram-LRU walk below still runs
  // unchanged and pushes underused clusters to the front.
  const tone = input.tasteCalibration?.preferredTone;
  const preferredFromTone: VoiceClusterId | undefined =
    tone && tone in TONE_TO_VOICE_CLUSTER
      ? TONE_TO_VOICE_CLUSTER[tone]
      : undefined;
  // Biased rotation table: 2 slots per cluster baseline (8 total).
  // +1 slot for `familyDefault` (curated narrative bias).
  // +5 slots for `preferredFromTone` when the creator's calibration
  // pins a tone (taste bias — softer than the pre-D1 hard pin).
  // - No tone:                       9 slots, family ~33%, others ~22%
  // - Tone == family default:       14 slots, preferred ~57%, others ~14%
  // - Tone != family default:       14 slots, preferred ~50%, family ~21%, others ~14%
  const familyDefault = FAMILY_VOICE[input.family];
  const biasedTable: VoiceClusterId[] = [];
  // PHASE R4 — pull region-specific +slot bonuses (empty {} for
  // western or undefined region — preserves byte-identical table).
  const regionBias =
    input.region && input.region !== "western"
      ? REGION_VOICE_BIAS[input.region]
      : undefined;
  for (const c of ALL_VOICE_CLUSTERS) {
    biasedTable.push(c, c);
    if (c === familyDefault) biasedTable.push(c);
    if (c === preferredFromTone) {
      biasedTable.push(c, c, c, c, c);
    }
    // PHASE R4 — additive region bonus. Each cluster keeps its
    // baseline 2 slots so no cluster is ever dropped from the pool;
    // region bonus only nudges sampling probability.
    if (regionBias) {
      const bonus = regionBias[c] ?? 0;
      for (let i = 0; i < bonus; i++) biasedTable.push(c);
    }
  }
  const startIdx =
    djb2(`${input.salt}|${input.coreId}|${input.recipeIdx}|voice`) %
    biasedTable.length;
  // PHASE Y10 — history-aware picking. If the caller supplied a
  // non-empty `recentVoiceClusters` histogram, walk the salt-rotated
  // table and return the FIRST cluster whose recent-count equals
  // the MIN across all 4 clusters. The walk preserves the salt-
  // rotation order (so behavior is deterministic per (salt, coreId,
  // recipeIdx)) and the family-bias 3x weighting (so the family's
  // curated default wins ties at the start position). When the
  // histogram is undefined or empty, skip the walk and return the
  // direct salt-rotated index — bit-for-bit identical to pre-Y10.
  const hist = input.recentVoiceClusters;
  if (hist && hist.size > 0) {
    let minCount = Infinity;
    for (const c of ALL_VOICE_CLUSTERS) {
      const n = hist.get(c) ?? 0;
      if (n < minCount) minCount = n;
    }
    for (let i = 0; i < biasedTable.length; i++) {
      const c = biasedTable[(startIdx + i) % biasedTable.length]!;
      if ((hist.get(c) ?? 0) === minCount) return c;
    }
    // Unreachable — biasedTable always contains all 4 clusters and
    // minCount is one of those 4 values. Fall through defensively.
  }
  return biasedTable[startIdx]!;
}

// ---------------------------------------------------------------- //
// Deterministic helpers                                             //
// ---------------------------------------------------------------- //

function djb2(s: string): number {
  let h = 5381 | 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

// ---------------------------------------------------------------- //
// Recipe queue construction                                         //
// ---------------------------------------------------------------- //

type Recipe = {
  domain: CoreDomainAnchorRow["domain"];
  anchor: string;
  action: string;
};

/** Materialize the per-core recipe queue: every (domain, anchor)
 *  pair from the catalog, salt-rotated to a deterministic starting
 *  position, with FRESH anchors PROMOTED to the front (anchors NOT
 *  shipped in recent batches AND NOT already used earlier in THIS
 *  batch win the tiebreak; never HARD rejected — a stale anchor
 *  still ships if the queue cycles back to it).
 *
 *  PHASE Y7 — freshness signal priority (first non-empty wins):
 *    1. `recentAnchors` Set.has(lowercase anchor) — O(1) check
 *       against catalog vocabulary harvested from cached ideas
 *       in `hybridIdeator.buildRecipeAnchorMemory`.
 *    2. `usedThisBatch` Set.has — in-flight tracker, mutated
 *       by the main loop after each successful candidate so
 *       sibling cores in the SAME batch see each others' picks.
 *    3. Fallback: word-boundary `recentPremises` regex (Y6
 *       behaviour, retained for back-compat when `recentAnchors`
 *       is empty / undefined for cold-start creators).
 *  Sources 1 + 2 stack — an anchor stale via either path loses
 *  the tiebreak. Source 3 only fires when source 1 is empty. */
function buildRecipeQueue(
  rows: readonly CoreDomainAnchorRow[],
  salt: number,
  coreId: string,
  recentPremises: ReadonlySet<string>,
  recentAnchors: ReadonlySet<string>,
  usedThisBatch: ReadonlySet<string>,
  // PHASE R3 — optional region anchor rows (additive overlay).
  // Empty array (western, undefined, or future regions with no
  // curated entries) → short-circuits to the pre-R3 catalog queue
  // BYTE-IDENTICAL. When non-empty, a 25% deterministic gate per
  // (salt, coreId) decides whether to PREPEND the region recipes
  // to the rotated catalog queue for that core. Region recipes are
  // themselves salt-rotated for deterministic order across batches.
  regionRows: readonly CoreDomainAnchorRow[] = [],
): Recipe[] {
  const all: Recipe[] = [];
  for (const row of rows) {
    for (const anchor of row.anchors) {
      all.push({
        domain: row.domain,
        anchor,
        action: row.exampleAction,
      });
    }
  }
  if (all.length === 0) return all;

  // PHASE R3 — region prefix gate. Deterministic ~25% per
  // (salt, coreId). Cannot fire when regionRows is empty so
  // western / undefined paths are byte-identical to pre-R3.
  //
  // Post-architect-review (R3 starvation fix): cap the prefix at
  // REGION_PREFIX_CAP recipes when the gate fires so the catalog
  // queue still receives the majority of `RECIPES_PER_CORE_CAP`
  // attempts. With CAP=8 and prefix cap=3, gated cores get up to
  // 3 region attempts followed by ≥5 catalog attempts — preventing
  // an all-region prefix from burning the per-core attempt budget
  // and indirectly pushing more requests onto the Claude fallback.
  // The salt-rotated start position still cycles through ALL 6
  // curated anchors over multiple batches, preserving anchor
  // coverage across a creator's session even though any single
  // gated core only sees 3.
  let regionPrefix: Recipe[] = [];
  if (regionRows.length > 0) {
    const gate = djb2(`${salt}|${coreId}|region-prefix`) % 4;
    if (gate === 0) {
      const flat: Recipe[] = [];
      for (const row of regionRows) {
        for (const anchor of row.anchors) {
          flat.push({
            domain: row.domain,
            anchor,
            action: row.exampleAction,
          });
        }
      }
      if (flat.length > 0) {
        const REGION_PREFIX_CAP = 3;
        const rstart =
          djb2(`${salt}|${coreId}|region-rotate`) % flat.length;
        const take = Math.min(REGION_PREFIX_CAP, flat.length);
        for (let i = 0; i < take; i++) {
          regionPrefix.push(flat[(rstart + i) % flat.length]!);
        }
      }
    }
  }
  // Salt-rotated start position so cold-start (no recent premises /
  // anchors) still rotates across batches.
  const start = djb2(`${salt}|${coreId}|recipe`) % all.length;
  const rotated: Recipe[] = [];
  for (let i = 0; i < all.length; i++) {
    rotated.push(all[(start + i) % all.length]!);
  }
  // Choose freshness probe. Y7 prefers the catalog-vocabulary anchor
  // set (O(1) Set.has); falls back to the word-boundary regex over
  // recent premises only when anchor memory is empty.
  const useAnchorSet = recentAnchors.size > 0;
  if (
    !useAnchorSet &&
    recentPremises.size === 0 &&
    usedThisBatch.size === 0
  ) {
    // PHASE R3 — cold-start path: still honour the region prefix
    // when the gate fired. Region recipes are tried first; the
    // catalog queue follows in pre-R3 deterministic order.
    return regionPrefix.length > 0 ? [...regionPrefix, ...rotated] : rotated;
  }
  const fresh: Recipe[] = [];
  const stale: Recipe[] = [];
  for (const r of rotated) {
    const a = r.anchor.toLowerCase();
    let isStale = false;
    // In-batch tracker first — even if cross-batch memory is empty
    // (cold start) the in-batch lever still spreads anchors across
    // sibling cores within a single generation pass.
    if (usedThisBatch.has(a)) {
      isStale = true;
    } else {
      // PHASE Y7 — primary cross-batch freshness probe via the
      // catalog-vocabulary anchor set (O(1) Set.has). If the anchor
      // memory is empty OR the anchor is missing from it (anchor
      // memory is partial — Layer-1 / Claude-fallback ideas don't
      // always carry catalog vocabulary, so `extractAnchorAndAction`
      // returns undefined for them and they don't contribute to
      // `recentAnchors`), ALSO consult the legacy `recentPremises`
      // word-boundary regex as a secondary stale signal. Either
      // probe finding the anchor stale is sufficient to demote it,
      // closing the partial-memory blind spot the post-Y7 architect
      // review flagged. Word-boundary (vs raw substring) rules out
      // false positives like `tab` matching inside `tablet`.
      if (useAnchorSet && recentAnchors.has(a)) {
        isStale = true;
      } else if (recentPremises.size > 0) {
        const escaped = a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`\\b${escaped}\\b`);
        for (const pre of recentPremises) {
          if (re.test(pre.toLowerCase())) {
            isStale = true;
            break;
          }
        }
      }
    }
    (isStale ? stale : fresh).push(r);
  }
  // PHASE R3 — region prefix sits at the absolute front (above the
  // freshness-sorted catalog queue) when the gate fired. Region
  // recipes are subject to all the same downstream gates
  // (`hookContainsAnchor`, `showContainsAnchor`, `validateComedy`,
  // `validateAntiCopy`, `validateScenarioCoherence`) so this only
  // re-orders the iterator — it cannot bypass any validator.
  return regionPrefix.length > 0
    ? [...regionPrefix, ...fresh, ...stale]
    : [...fresh, ...stale];
}

// ---------------------------------------------------------------- //
// Public API                                                        //
// ---------------------------------------------------------------- //

const EMPTY_REASONS: Record<
  | ComedyRejectionReason
  | "schema_invalid"
  | "construction_failed"
  | "scenario_repeat"
  | "deliberate_template_artifact"
  | "scene_template_leakage"
  | "direct_to_camera_in_show"
  | "show_missing_hook_anchor"
  | "split_self_show_mismatch"
  | "template_stiffness_phrase"
  | "bad_grammar_by_past_participle"
  | "hook_topic_noun_drift"
  | "verb_anchor_implausible"
  | "impossible_physical_action_on_abstract"
  | "placeholder_filming_phrase"
  | "authored_domain_used_generic_template"
  | "family_verb_leak_on_scene"
  | "meta_template_signature",
  number
> = {
  no_contradiction: 0,
  no_tension: 0,
  generic_observation: 0,
  too_soft: 0,
  hook_scenario_mismatch: 0,
  filming_mismatch: 0,
  copied_seed_hook: 0,
  near_duplicate_premise: 0,
  schema_invalid: 0,
  construction_failed: 0,
  scenario_repeat: 0,
  // PHASE UX3 — scenario coherence reasons from the cohesive
  // author's expanded validator. All start at 0 per batch.
  deliberate_template_artifact: 0,
  scene_template_leakage: 0,
  direct_to_camera_in_show: 0,
  show_missing_hook_anchor: 0,
  split_self_show_mismatch: 0,
  // PHASE UX3.1 — additions.
  template_stiffness_phrase: 0,
  bad_grammar_by_past_participle: 0,
  hook_topic_noun_drift: 0,
  verb_anchor_implausible: 0,
  // PHASE UX3.2 — Authored Scenario Planner additions.
  impossible_physical_action_on_abstract: 0,
  placeholder_filming_phrase: 0,
  authored_domain_used_generic_template: 0,
  // PHASE UX3.3 — close the metric-lying gap.
  family_verb_leak_on_scene: 0,
  meta_template_signature: 0,
};

/** Spec — was 3 in Y5; Y6 walked 5 (domain, anchor) recipes per
 *  core before dropping; Y8 raises to 8 because the recipe iterator
 *  now COLLECTS all passing candidates and ships the highest-
 *  hookQualityScore one (Y6/Y7 shipped the FIRST passing recipe).
 *  More attempts = a bigger choice set for the quality scorer to
 *  pick from. The new fp dedup gate also rejects more recipes per
 *  core (a creator on batch #20 has ~50 recent fps, so 1-3 of any
 *  8 recipes can collide), so the wider window keeps the kept-rate
 *  floor from regressing. Still cheap — every recipe is local
 *  (no Claude / no DB). */
const RECIPES_PER_CORE_CAP = 8;

/** PHASE D4 — cap on `antiCopyRejects.samples` size per batch.
 *  Bounded so the structured-log payload stays small even on
 *  pathologically reject-heavy batches; aggregate counts on
 *  `bySource` are unbounded and remain accurate. 20 ≈ 2×
 *  RECIPES_PER_CORE_CAP × per-batch-core count headroom. */
const ANTI_COPY_SAMPLE_CAP = 20;

export function generateCoreCandidates(
  input: GenerateCoreCandidatesInput,
): GenerateCoreCandidatesResult {
  const salt = Math.trunc(input.regenerateSalt ?? 0);
  const recentPremises = input.recentPremises ?? new Set<string>();
  const recentAnchors =
    input.noveltyContext?.recentAnchors ?? new Set<string>();
  // PHASE Y8 — cross-batch fp dedup channel. Empty set for cold-start
  // creators; the hard-reject gate inside the recipe loop just stays
  // quiet and every recipe ships, which is the correct behavior for
  // a creator with no history.
  const recentScenarioFingerprints =
    input.noveltyContext?.recentScenarioFingerprints ?? new Set<string>();
  // PHASE Y10 — voice cluster usage histogram across the last 7
  // visible batches. Empty map for cold-start creators; the resolver
  // no-ops on an empty histogram and falls through to the pre-Y10
  // salt-rotated family-biased table.
  const recentVoiceClusters =
    input.noveltyContext?.recentVoiceClusters ??
    new Map<VoiceClusterId, number>();
  const tasteCalibration = input.tasteCalibration ?? null;
  const seedFingerprints = loadSeedHookFingerprints();
  const cap = Math.max(0, Math.trunc(input.count));

  // PHASE N1-S — pack activation context. Computed ONCE per call so
  // the per-core loop only branches on a precomputed boolean. The
  // activation guard inside `getEligibleNigerianPackEntries` enforces
  // region === "nigeria" + languageStyle ∈ {light_pidgin, pidgin} +
  // flagEnabled + packLength > 0; on any failure the eligible list
  // is empty and the per-core block below is a structural no-op
  // (byte-identical to pre-N1-S). The pack feature flag is read
  // ONCE here (not per-core) so a same-call flag flip cannot turn
  // a pack-eligible call into a non-eligible one mid-loop.
  const packFlagEnabled = isNigerianPackFeatureEnabled();
  const packLanguageStyle = tasteCalibration?.languageStyle ?? null;

  // PHASE N1-LIVE-HARDEN PACK-AWARE-RETENTION (BI 2026-05-07) —
  // staging-only flag, default OFF. When ON AND inside the activation-
  // gated NG cohort (region===nigeria + languageStyle∈{pidgin,
  // light_pidgin} + flagEnabled + non-empty pack — same gate as
  // `getEligibleNigerianPackEntries`), the per-core picker at the
  // bottom of this loop retains the BEST PACK candidate alongside the
  // global best, when distinct. This prevents the per-core winner-
  // take-all selector from suppressing pack candidates whenever a
  // catalog candidate edges them out on `hookQualityScore`. No
  // validator / scorer / corpus / safety / anti-copy change — only
  // the per-core retention policy widens (1 → up to 2) inside the
  // already-activated NG branch. Per-batch dedup on
  // `nigerianPackEntryId` AND normalized hook is preserved by
  // downstream `applyNigerianPackSlotReservation`. Production OFF
  // until staging QA approves.
  const packAwareRetentionEnabled =
    process.env.LUMINA_NG_PACK_AWARE_RETENTION_ENABLED === "true";
  // Per-creator pack memory snapshot. Empty Set preserves pre-flag
  // behavior (no skip). Always defined so the retention block can do
  // a cheap `.has()` check without optional-chaining.
  const recentNigerianPackEntryIds: ReadonlySet<string> =
    input.recentNigerianPackEntryIds ?? new Set<string>();

  // PHASE N1-STYLE — cohort-gated American-internet style penalty
  // for the catalog (non-pack) recipe path. Computed ONCE per call
  // mirroring `packFlagEnabled` above so a same-call flag flip
  // cannot turn a penalized cohort into a non-penalized one mid-
  // loop. Defaults OFF; production behavior unchanged until staging
  // QA proves the calibration. Pack candidates are NEVER penalized
  // (this flag is read only at the catalog call site below).
  const stylePenaltyFlagEnabled = isNigerianStylePenaltyFeatureEnabled();

  // PHASE W1 — per-creator catalog skeleton memory snapshot for the
  // Western adjustment's recent-skeleton repetition demotion. Empty
  // Set when the caller didn't supply one (cold-start / non-western
  // cohorts where hybridIdeator skipped the DB read). The Western
  // helper also gates internally on cohort, so a non-empty Set on a
  // non-western cohort is still a no-op.
  const recentCatalogSkeletons: ReadonlySet<string> =
    input.recentCatalogSkeletons ?? new Set<string>();

  // PHASE W1.1 AUDIT (BI 2026-05-07) — cohort-gated tally of per-recipe
  // Western hook adjustment outcomes. Activated for the SAME cohort the
  // helper itself short-circuits on (region undefined OR "western"), so
  // non-western cohorts pay zero cost and the result field is omitted
  // from `stats`. Counts EVERY catalog (non-pack) recipe whose hook
  // reached the W1 scoring branch — pack candidates skip this branch
  // and are never counted (mirrors the production Western adjustment
  // wiring at L1354). Pure read-only telemetry.
  const _w1AuditEligible =
    input.region === undefined || input.region === "western";
  const _w1AuditTally = {
    recipesScored: 0,
    demoted: 0,
    boosted: 0,
    zero: 0,
    netDelta: 0,
  };

  const candidates: CoreNativeCandidate[] = [];
  const perCoreAttempts: CoreCandidateAttempt[] = [];
  const reasons: Record<
    | ComedyRejectionReason
    | "schema_invalid"
    | "construction_failed"
    | "scenario_repeat"
    | "deliberate_template_artifact"
    | "scene_template_leakage"
    | "direct_to_camera_in_show"
    | "show_missing_hook_anchor"
    | "split_self_show_mismatch"
    | "template_stiffness_phrase"
    | "bad_grammar_by_past_participle"
    | "hook_topic_noun_drift"
    | "verb_anchor_implausible"
    | "impossible_physical_action_on_abstract"
    | "placeholder_filming_phrase"
    | "authored_domain_used_generic_template"
    | "family_verb_leak_on_scene"
    | "meta_template_signature",
    number
  > = { ...EMPTY_REASONS };
  // PHASE D4 — per-batch reject-source roll-up. Mutated whenever
  // the cohesive author returns a `copied_seed_hook` rejection
  // carrying an `antiCopyMatch`. `samples` is capped to keep the
  // log payload bounded across very-deep iterator runs.
  const antiCopyRejects: AntiCopyRejectsTelemetry = {
    // PHASE D15-alt — `style_defs_self` is the telemetry-only
    // bucket for self-recipe exemptions. Always zero-initialised
    // alongside the two reject buckets so dashboards can read all
    // three keys without optional-chaining.
    bySource: { corpus: 0, style_defs: 0, style_defs_self: 0 },
    samples: [],
  };
  let generatedCount = 0;
  // PHASE Y7 — in-batch anchor tracker. Mutated after each successful
  // candidate so the next core's recipe queue demotes anchors already
  // shipped earlier in THIS batch. Pairs with `recentAnchors` (cross-
  // batch) for full freshness coverage.
  const usedAnchorsThisBatch = new Set<string>();
  // PHASE Y8 — in-batch fp tracker. Same shape as
  // `usedAnchorsThisBatch` above but for `sf_<12hex>` scenario
  // fingerprints. Mutated after each successful candidate is
  // PICKED (not after every passing candidate — only the
  // ship-winner contributes to the in-batch dedup envelope, since
  // the losers never leave the function). Stops sibling cores in
  // the same batch from shipping two ideas with the same scenario
  // fingerprint.
  const usedFingerprintsThisBatch = new Set<string>();

  for (const core of input.cores) {
    if (candidates.length >= cap) {
      perCoreAttempts.push({ coreId: core.id, kept: false, attempts: 0 });
      continue;
    }
    const rows = CORE_DOMAIN_ANCHORS[core.id];
    if (
      !rows ||
      rows.length === 0 ||
      core.compatiblePremiseStyles.length === 0
    ) {
      perCoreAttempts.push({
        coreId: core.id,
        kept: false,
        attempts: 0,
        lastReason: "core_misconfigured",
      });
      continue;
    }

    const queue = buildRecipeQueue(
      rows,
      salt,
      core.id,
      recentPremises,
      recentAnchors,
      usedAnchorsThisBatch,
      // PHASE R3 — pass region anchor rows when region is set and
      // not western. Western and undefined both resolve to `[]`
      // via `hasRegionAnchors` short-circuit, preserving pre-R3
      // queue byte-identical on those paths.
      input.region && hasRegionAnchors(input.region)
        ? REGION_ANCHORS[input.region]
        : [],
    );

    let attempts = 0;
    let lastReason: CoreCandidateRejectionReason | undefined;
    // PHASE D4 — last `copied_seed_hook` reject-source for this
    // core. Cleared on any successful pick (matches the existing
    // `lastReason = undefined` discipline below).
    let lastAntiCopyMatch: AntiCopyMatch | undefined;
    // PHASE Y8 — the recipe iterator now COLLECTS up to
    // RECIPES_PER_CORE_CAP passing candidates per core (Y6/Y7
    // shipped the FIRST passing one) and downstream picks the
    // highest hookQualityScore. The collect-then-pick pattern is
    // what makes the user-added "every hook must be captivating"
    // requirement enforceable — without it, the new fp dedup gate
    // would silently degrade hook quality by funnelling the
    // iterator toward bland synonym swaps.
    const passing: {
      idea: Idea;
      meta: CandidateMeta;
      sf: string | undefined;
      anchorLower: string;
      quality: number;
    }[] = [];

    // ─── PHASE N1-S — Nigerian pack atomic-recipe prefix ─────────── //
    // Pack candidates are authored ATOMICALLY from the curator's
    // verbatim hook+whatToShow+howToFilm+caption (vs. the catalog
    // path which composes a recipe from family/anchor/action). They
    // get FIRST-CLASS entry into the same `passing[]` set the
    // catalog recipes feed, so the existing pick logic (highest
    // hookQualityScore wins — `>` strict so ties favour the
    // earliest entry, which means pack candidates win equal-score
    // ties against later catalog recipes). Every pack candidate
    // runs through ideaSchema → validateScenarioCoherence →
    // validateComedy → validateAntiCopyDetailed unchanged. Failures
    // fall through silently to the catalog recipe loop below — the
    // recipe loop's existing reject counters do NOT pick up pack
    // failures because pack reasons are intentionally NOT in
    // `EMPTY_REASONS`, so we keep the catalog telemetry untouched.
    //
    // Cap = NIGERIAN_PACK_PREFIX_CAP (3). Same band as R3's anchor-
    // prefix gate so pack draws stay conservative even when many
    // entries match the active core's domain. Domain narrower
    // pulls per-core eligible entries; pidginLevel is tier-gated
    // inside `getEligibleNigerianPackEntries`.
    //
    // Activation guard is enforced inside the eligibility helper,
    // so any non-nigerian / non-pidgin / flag-off / empty-pack
    // call returns `[]` and this block is a structural no-op
    // (byte-identical to pre-N1-S). Pack-author imports are loaded
    // unconditionally — pack ESM bytes are still cheap on hot
    // paths because the eligibility helper short-circuits BEFORE
    // any author work runs.
    const packEligible: readonly NigerianPackEntry[] =
      getEligibleNigerianPackEntries({
        region: input.region,
        languageStyle: packLanguageStyle,
        flagEnabled: packFlagEnabled,
      });
    if (packEligible.length > 0) {
      // Filter to entries whose curator-declared domain bucket is
      // compatible with the active core's anchor rows. The
      // recipe-loop catalog is built from `CORE_DOMAIN_ANCHORS[core.id]`,
      // so the set of canonical domains for this core is a slice of
      // the same map. Pack entries declare a softer bucket label
      // that the author normalises onto a `CanonicalDomain` via
      // `PACK_DOMAIN_MAP`; we read the same projection table here
      // so the per-core filter aligns with the author's normalisation.
      const coreDomains = new Set(rows.map((r) => r.domain));
      const PACK_DOMAIN_MAP: Record<string, string> = {
        messaging: "phone",
        movement: "fitness",
        transport: "fitness",
        family: "social",
        creator: "content",
        everyday: "home",
        home: "home",
        money: "money",
        phone: "phone",
        work: "work",
      };
      const matching = packEligible.filter((e) => {
        const projected = PACK_DOMAIN_MAP[e.domain] ?? "phone";
        return coreDomains.has(projected as CoreDomainAnchorRow["domain"]);
      });
      // Salt-rotated stable order so pack draws are deterministic
      // across regenerates but still rotate (otherwise the same 3
      // entries would always win the prefix slot for a given core).
      // A 2026-05-06 segment-interleave-by-domain alternative was
      // tried + reverted (regressed staging QA 29→15 via per-batch
      // fp-dedup correlation across cores). See
      // .local/N1_ROTATION_FIX_PROPOSAL.md "Outcome appendix".
      const rotated = matching.slice();
      const rotateBy = ((salt | 0) >>> 0) % Math.max(1, rotated.length);
      const ordered = rotated
        .slice(rotateBy)
        .concat(rotated.slice(0, rotateBy));
      // PHASE N1-LIVE-HARDEN PRODUCT-PASS (BI 2026-05-07) — lift the
      // pack-prefix attempt cap inside the activation-gated NG path
      // ONLY. The original `NIGERIAN_PACK_PREFIX_CAP=3` left ~150
      // matching pack entries per core untried, capping end-to-end
      // pack delivery at ~10% on ng_pidgin/ng_light_pidgin (the
      // first 3 attempts often hit `schema_invalid` or fp-dedup,
      // wiping the pool). The eligible cap of 12 surfaces enough
      // surviving candidates for the slot reservation layer to
      // actually reserve pack slots without changing any validator,
      // scorer, anti-copy, safety/privacy, anchor, or corpus rule.
      // Strictly gated: this block is already inside
      // `if (packEligible.length > 0)`, and `packEligible` is
      // produced by `getEligibleNigerianPackEntries` which enforces
      // region===nigeria + languageStyle∈{pidgin,light_pidgin} +
      // `LUMINA_NG_PACK_ENABLED===true` + non-empty pack — so no
      // path can leak into clean/null/non-Nigeria cohorts.
      // `NIGERIAN_PACK_PREFIX_CAP` (3) export is preserved for any
      // out-of-band reader; only this draw site reads the lifted
      // value.
      const NIGERIAN_PACK_ELIGIBLE_DRAW_CAP = 12;
      const drawCap = Math.min(
        NIGERIAN_PACK_ELIGIBLE_DRAW_CAP,
        ordered.length,
      );

      // PHASE N1-INSTRUMENT — opt-in throttle observer. Strictly
      // additive: when `globalThis.__nigerianThrottleObserver` is
      // undefined (the default), the counter increments below are
      // dead-store and the trailing `if (_obs)` is a single
      // truthy-check no-op. NO behavior change for any production
      // caller. Set by the throttle-instrumentation analysis script
      // in `qa/instrumentNigerianThrottle.ts` only — production code
      // never sets this global.
      let _packAuthoredOk = 0;
      let _packSurvivedFpDedup = 0;
      let _packEnteredPassing = 0;
      // PHASE N1-INSTRUMENT v2 — per-validator drop accounting.
      // Captured ONLY when the observer global is set (pure
      // bookkeeping otherwise — these counters are emitted in the
      // throttle record at the end of the pack-prefix block and
      // never read by production logic). Samples capped at 5 per
      // core to bound memory.
      const _packValidatorRejects: Record<string, number> = {};
      const _packRejectedSamples: Array<{
        entryHook: string;
        entryAnchor: string;
        reason: string;
      }> = [];

      // Resolve a voice cluster ONCE for the pack-prefix block. The
      // pack entries are atomic native-Pidgin units — voice cluster
      // is metadata-only on the resulting CandidateMeta (the
      // verbatim hook text already carries the curator's voice).
      const packVoiceId = resolveVoiceCluster({
        family: core.family,
        tasteCalibration,
        salt,
        coreId: core.id,
        recipeIdx: 0,
        recentVoiceClusters,
        ...(input.region ? { region: input.region } : {}),
      });
      const packVoice = getVoiceCluster(packVoiceId);

      for (let i = 0; i < drawCap; i++) {
        const entry = ordered[i]!;
        const r = authorPackEntryAsIdea({
          entry,
          core,
          voice: packVoice,
          regenerateSalt: salt,
          recentPremises,
          seedFingerprints,
        });
        if (!r.ok) {
          // PHASE N1-INSTRUMENT v2 — record per-validator drop
          // reason for the throttle observer. No-op for production
          // semantics (counters are read only by the QA harness).
          const reason = r.reason ?? "unknown";
          _packValidatorRejects[reason] = (_packValidatorRejects[reason] ?? 0) + 1;
          if (_packRejectedSamples.length < 5) {
            _packRejectedSamples.push({
              entryHook: entry.hook,
              entryAnchor: entry.anchor,
              reason,
            });
          }
          continue;
        }
        _packAuthoredOk++;
        // Same intra-batch / cross-batch fp dedup gate as catalog
        // recipes — the pack candidate's fp competes against
        // earlier sibling cores in the SAME batch and against the
        // creator's last-7-batches envelope.
        const sf = r.scenarioFingerprint;
        if (
          sf &&
          (recentScenarioFingerprints.has(sf) ||
            usedFingerprintsThisBatch.has(sf))
        ) {
          continue;
        }
        _packSurvivedFpDedup++;
        const quality = scoreHookQuality(r.idea.hook, core.family);
        const meta: CandidateMeta = {
          ...r.meta,
          scenarioFingerprint: sf,
          voiceClusterId: packVoiceId,
          hookQualityScore: quality,
        };
        passing.push({
          idea: r.idea,
          meta,
          sf,
          anchorLower: entry.anchor.toLowerCase(),
          quality,
        });
        _packEnteredPassing++;
      }

      // PHASE N1-INSTRUMENT — emit throttle record (opt-in; no-op
      // when observer global is unset — see declaration above).
      // PHASE N1-INSTRUMENT v2: includes per-validator drop reasons
      // and a small bounded sample of rejected entries.
      const _obs = (
        globalThis as {
          __nigerianThrottleObserver?: (rec: {
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
          }) => void;
        }
      ).__nigerianThrottleObserver;
      if (_obs) {
        _obs({
          coreId: core.id,
          eligible: packEligible.length,
          matching: matching.length,
          attempted: drawCap,
          authoredOk: _packAuthoredOk,
          survivedFpDedup: _packSurvivedFpDedup,
          enteredPassing: _packEnteredPassing,
          validatorRejectsByReason: _packValidatorRejects,
          rejectedEntrySamples: _packRejectedSamples,
        });
      }

      // PHASE N1-LIVE-HARDEN P2 — per-core pack-prefix candidate
      // block diagnostic. Always emitted when `packEligible.length
      // > 0` (i.e. we actually attempted the pack-prefix path for
      // this core) so the orchestrator log has a per-core view of
      // why a pack-pool drain happened upstream of the slot
      // reservation. Mirrors the throttle observer payload but
      // ships through the standard structured logger so it survives
      // without a test-only observer being installed. Pure
      // observability — no validator / scorer / pool change.
      logger.info(
        {
          coreId: core.id,
          packEligibleCount: packEligible.length,
          matching: matching.length,
          drawCap,
          packAuthoredOk: _packAuthoredOk,
          packSurvivedFpDedup: _packSurvivedFpDedup,
          packEnteredPassing: _packEnteredPassing,
          packValidatorRejects: _packValidatorRejects,
          packRejectedSamples: _packRejectedSamples,
        },
        "nigerian_pack.candidate_block_diagnostic",
      );
    }

    for (const recipe of queue) {
      if (attempts >= RECIPES_PER_CORE_CAP) break;
      // PHASE Y7 — voice resolves PER-RECIPE (not per-core) so cold-
      // start creators get voice diversity across recipes for the
      // same core. Taste-pinned creators get the same cluster every
      // recipe via the priority-1 short-circuit in resolveVoiceCluster.
      // PHASE Y10 — when `recentVoiceClusters` is non-empty (creator
      // has visible history), the resolver picks the LEAST-RECENTLY-
      // USED cluster from the salt-rotated biased table. Cold-start
      // creators get the pre-Y10 behavior unchanged.
      const voiceId = resolveVoiceCluster({
        family: core.family,
        tasteCalibration,
        salt,
        coreId: core.id,
        recipeIdx: attempts,
        recentVoiceClusters,
        // PHASE R4 — pass region for additive +slot voice bias.
        // Undefined / "western" → no bonus pushed → biasedTable
        // byte-identical to pre-R4.
        ...(input.region ? { region: input.region } : {}),
      });
      const voice = getVoiceCluster(voiceId);
      attempts++;
      generatedCount++;
      const result = authorCohesiveIdea({
        core,
        domain: recipe.domain,
        anchor: recipe.anchor,
        action: recipe.action,
        voice,
        regenerateSalt: salt,
        recentPremises,
        seedFingerprints,
        // PHASE R1 — pass through optional region for deterministic
        // regional baseline decoration in the cohesive author.
        // `undefined` / `"western"` short-circuit to identity inside
        // the adapter, so cold-start and western creators are
        // byte-identical to pre-R1.
        ...(input.region ? { region: input.region } : {}),
      });
      if (!result.ok) {
        const r = result.reason as CohesiveAuthorRejectionReason;
        reasons[r] = (reasons[r] ?? 0) + 1;
        lastReason = r;
        // PHASE D4 — when the cohesive author surfaces
        // `antiCopyMatch` (only on `copied_seed_hook` rejections),
        // accumulate per-source counts AND attach the match to the
        // per-attempt entry so the QA driver can introspect the
        // last reject event for this core. Sample list capped at
        // ANTI_COPY_SAMPLE_CAP per batch.
        if (result.antiCopyMatch) {
          antiCopyRejects.bySource[result.antiCopyMatch.source] += 1;
          if (antiCopyRejects.samples.length < ANTI_COPY_SAMPLE_CAP) {
            antiCopyRejects.samples.push(result.antiCopyMatch);
          }
          lastAntiCopyMatch = result.antiCopyMatch;
        }
        continue;
      }
      // PHASE Y8 — scenario fingerprint HARD-REJECT. Gate fires when
      // either (a) the cross-batch envelope (last-5-batches harvested
      // by hybridIdeator) already contains this fp, OR (b) a sibling
      // core earlier in THIS batch shipped to the same fp. Both
      // checks operate on the SAME fp output the cache writes will
      // persist, so dedup is symmetric across the cross-batch +
      // intra-batch boundaries.
      const sf = result.scenarioFingerprint;
      if (
        sf &&
        (recentScenarioFingerprints.has(sf) ||
          usedFingerprintsThisBatch.has(sf))
      ) {
        reasons.scenario_repeat++;
        lastReason = "scenario_repeat";
        continue;
      }
      // PHASE Y8 — score the freshly-authored hook on the
      // visceral / anthropomorph / brevity / concrete / contradiction
      // axes. The score itself doesn't gate (any non-rejected recipe
      // is eligible to ship); it only orders the per-core passing
      // set so the SHIPPED candidate is the most captivating one
      // the iterator found.
      // PHASE D15-alt — when the cohesive author surfaces an
      // antiCopyMatch on the ok:true path, that's a self-recipe
      // exemption event (source: "style_defs_self"). Roll it under
      // its dedicated bySource bucket and append to samples so the
      // D4 telemetry surface still sees it. Pure additive — passes
      // without an exemption (the common case) skip this branch.
      if (result.antiCopyMatch) {
        antiCopyRejects.bySource[result.antiCopyMatch.source] += 1;
        if (antiCopyRejects.samples.length < ANTI_COPY_SAMPLE_CAP) {
          antiCopyRejects.samples.push(result.antiCopyMatch);
        }
      }
      // PHASE N1-STYLE — score this catalog hook on the punch
      // scale, then subtract a cohort-gated American-internet
      // penalty (NG-pidgin/light_pidgin only, flag-gated, default
      // 0). The penalty is a SOFT downweight, not a filter — the
      // hook still enters `passing[]` and can ship if it's the
      // only candidate. The goal is to lose the per-core quality
      // competition to authentic catalog or pack alternatives,
      // not to be excluded. Pack candidates (L1010 above) skip
      // this branch entirely.
      const baseQuality = scoreHookQuality(result.idea.hook, core.family);
      const stylePenalty = computeNigerianStylePenalty({
        hook: result.idea.hook,
        region: input.region,
        languageStyle: packLanguageStyle,
        flagEnabled: stylePenaltyFlagEnabled,
      });
      // PHASE W1 — cohort-gated Western catalog hook adjustment.
      // SIGNED (negative on weak skeleton / generic combo / recent
      // skeleton; positive on visible-action / posting / contradiction
      // / embarrassment specificity). Helper short-circuits to 0 for
      // any non-western cohort (region !== undefined && region !==
      // "western") so India / PH / Nigeria see ZERO net change. Pack
      // candidates skip this branch entirely (pack push is at the
      // earlier `if (packEligible.length > 0)` block, NOT here).
      const westernAdjustment = computeWesternHookAdjustment({
        hook: result.idea.hook,
        whatToShow: result.idea.whatToShow,
        region: input.region,
        languageStyle: packLanguageStyle,
        recentSkeletons: recentCatalogSkeletons,
      });
      // PHASE W1.4 — orthogonal specificity upgrade. Same cohort gate
      // (region undefined OR "western"), separate non-prod kill-switch
      // (`LUMINA_W1_4_DISABLE_FOR_QA=1`). Demotes the weak-but-not-
      // W1-classified template shapes observed in the W1.3 ON sample
      // (e.g. "X itself isn't the problem", "AGAIN. AGAIN!!!", "aged
      // me N years", "ruined my villain arc"); rewards gerund-led
      // action openers, "like X" comparison structure, "X, then Y"
      // self-betrayal, and concrete numeric durations. Composes by
      // addition with W1; pack candidates skip this branch (above).
      const w14Adjustment = computeWesternSpecificityAdjustment({
        hook: result.idea.hook,
        region: input.region,
        languageStyle: packLanguageStyle,
      });
      const quality =
        baseQuality - stylePenalty + westernAdjustment + w14Adjustment;
      // PHASE W1.1 AUDIT — tally per-recipe adjustment outcome for the
      // western/default cohort. Sign is the policy signal: <0 demoted,
      // >0 boosted (specificity bonus), ===0 net no-op (helper returned
      // 0 — either non-eligible cohort, no weak family + no bonus
      // signals, or the QA bypass env var was set).
      if (_w1AuditEligible) {
        _w1AuditTally.recipesScored += 1;
        _w1AuditTally.netDelta += westernAdjustment;
        if (westernAdjustment < 0) _w1AuditTally.demoted += 1;
        else if (westernAdjustment > 0) _w1AuditTally.boosted += 1;
        else _w1AuditTally.zero += 1;
      }
      const meta: CandidateMeta = {
        ...result.meta,
        scenarioFingerprint: sf,
        voiceClusterId: voiceId,
        hookQualityScore: quality,
      };
      passing.push({
        idea: result.idea,
        meta,
        sf,
        anchorLower: recipe.anchor.toLowerCase(),
        quality,
      });
    }

    let kept = false;
    if (passing.length > 0) {
      // PHASE Y8 — pick highest quality. Ties broken by first-seen
      // (deterministic — `passing` insertion order matches recipe
      // queue order, which is itself salt-deterministic). Strict
      // `>` so a quality tie keeps the earlier recipe; this matches
      // the stable-sort discipline used in the existing pattern
      // selector.
      let best = passing[0]!;
      for (let i = 1; i < passing.length; i++) {
        const p = passing[i]!;
        if (p.quality > best.quality) best = p;
      }
      candidates.push({ idea: best.idea, meta: best.meta });
      usedAnchorsThisBatch.add(best.anchorLower);
      if (best.sf) usedFingerprintsThisBatch.add(best.sf);
      kept = true;

      // PHASE N1-LIVE-HARDEN PACK-AWARE-RETENTION (BI 2026-05-07) —
      // when active (flag ON + cohort eligible via packEligible.length
      // > 0, which is the SAME activation gate as the pack-prefix
      // block above), additionally retain the BEST PACK candidate
      // when distinct from `best`. Pack candidates carry
      // `meta.nigerianPackEntryId` (set inside `authorPackEntryAsIdea`
      // and spread through `...r.meta` at the pack push site above).
      // Strict guards:
      //   • flag must be true (default OFF; production unchanged)
      //   • cohort must already be pack-eligible (no leak)
      //   • at least one pack candidate must exist in `passing[]`
      //   • the pack pick must differ from `best` (no in-batch
      //     duplicate packEntryId or duplicate hook — the second
      //     constraint is enforced structurally because pack hooks
      //     are atomic per entry, plus downstream slot reservation's
      //     per-batch hook dedup is preserved)
      // No validator / scorer / corpus / anti-copy change — only the
      // retention count widens from 1 → up to 2 in the activated NG
      // branch. The per-core attempt budget upstream is unaffected.
      if (
        packAwareRetentionEnabled &&
        packEligible.length > 0 &&
        passing.length > 1
      ) {
        const bestPackId = (best.meta as { nigerianPackEntryId?: string })
          .nigerianPackEntryId;
        // Pack-memory-aware: skip pack candidates whose entryId the
        // creator has already seen recently. Avoids cross-batch
        // repetition that would otherwise re-ship the same pack hook
        // because the per-core picker runs upstream of the slot
        // reservation memory filter. Falls through to "no extra pick"
        // when every pack candidate is seen — the global `best` is
        // still pushed unconditionally above, so this never under-
        // fills the per-core retention vs the pre-flag baseline.
        let bestPack: typeof passing[number] | null = null;
        for (const p of passing) {
          const pid = (p.meta as { nigerianPackEntryId?: string })
            .nigerianPackEntryId;
          if (pid === undefined) continue;
          if (pid === bestPackId) continue;
          if (recentNigerianPackEntryIds.has(pid)) continue;
          if (bestPack === null || p.quality > bestPack.quality) {
            bestPack = p;
          }
        }
        if (bestPack !== null) {
          candidates.push({ idea: bestPack.idea, meta: bestPack.meta });
          usedAnchorsThisBatch.add(bestPack.anchorLower);
          if (bestPack.sf) usedFingerprintsThisBatch.add(bestPack.sf);
        }
      }
      // Clear lastReason — a passing recipe was found (any earlier
      // rejections were intermediate, not the final disposition for
      // this core). PHASE D4 — clear lastAntiCopyMatch on the same
      // discipline so the per-attempt telemetry doesn't carry a
      // stale anti-copy match from an intermediate rejection.
      lastReason = undefined;
      lastAntiCopyMatch = undefined;
    }

    perCoreAttempts.push({
      coreId: core.id,
      kept,
      attempts,
      lastReason,
      ...(lastAntiCopyMatch ? { antiCopyMatch: lastAntiCopyMatch } : {}),
    });
  }

  return {
    candidates,
    stats: {
      generatedCount,
      keptCount: candidates.length,
      rejectionReasons: reasons,
      antiCopyRejects,
      perCoreAttempts,
      ...(_w1AuditEligible
        ? { westernAdjustmentSummary: _w1AuditTally }
        : {}),
    },
  };
}
