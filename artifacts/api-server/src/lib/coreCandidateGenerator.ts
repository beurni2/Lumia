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
  | "scenario_repeat";

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
      | "scenario_repeat",
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
};

const ALL_VOICE_CLUSTERS: readonly VoiceClusterId[] = [
  "dry_deadpan",
  "chaotic_confession",
  "quiet_realization",
  "overdramatic_reframe",
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
  for (const c of ALL_VOICE_CLUSTERS) {
    biasedTable.push(c, c);
    if (c === familyDefault) biasedTable.push(c);
    if (c === preferredFromTone) {
      biasedTable.push(c, c, c, c, c);
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
    return rotated;
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
  return [...fresh, ...stale];
}

// ---------------------------------------------------------------- //
// Public API                                                        //
// ---------------------------------------------------------------- //

const EMPTY_REASONS: Record<
  | ComedyRejectionReason
  | "schema_invalid"
  | "construction_failed"
  | "scenario_repeat",
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

  const candidates: CoreNativeCandidate[] = [];
  const perCoreAttempts: CoreCandidateAttempt[] = [];
  const reasons: Record<
    | ComedyRejectionReason
    | "schema_invalid"
    | "construction_failed"
    | "scenario_repeat",
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
      const quality = scoreHookQuality(result.idea.hook, core.family);
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
    },
  };
}
