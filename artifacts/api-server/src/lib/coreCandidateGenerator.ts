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
   *  last 5 visible batches. O(1) HARD-REJECT signal in the recipe
   *  loop — when a freshly authored idea's
   *  `result.scenarioFingerprint` lands in this set, the recipe
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
 *  override. */
export function resolveVoiceCluster(input: {
  family: Family;
  tasteCalibration?: TasteCalibration | null;
  salt: number;
  coreId: string;
  recipeIdx: number;
}): VoiceClusterId {
  const tone = input.tasteCalibration?.preferredTone;
  if (tone && tone in TONE_TO_VOICE_CLUSTER) {
    return TONE_TO_VOICE_CLUSTER[tone];
  }
  // 9-slot biased rotation table: 2 slots per cluster (8) + 1 extra
  // slot for the family's curated default → 3/9 vs 2/9 each for the
  // others (~1.5x bias). Keeps the curated FAMILY_VOICE intent but
  // never collapses diversity to a single voice.
  const familyDefault = FAMILY_VOICE[input.family];
  const biasedTable: VoiceClusterId[] = [];
  for (const c of ALL_VOICE_CLUSTERS) {
    biasedTable.push(c, c);
    if (c === familyDefault) biasedTable.push(c);
  }
  const idx =
    djb2(`${input.salt}|${input.coreId}|${input.recipeIdx}|voice`) %
    biasedTable.length;
  return biasedTable[idx]!;
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
      const voiceId = resolveVoiceCluster({
        family: core.family,
        tasteCalibration,
        salt,
        coreId: core.id,
        recipeIdx: attempts,
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
      // this core).
      lastReason = undefined;
    }

    perCoreAttempts.push({ coreId: core.id, kept, attempts, lastReason });
  }

  return {
    candidates,
    stats: {
      generatedCount,
      keptCount: candidates.length,
      rejectionReasons: reasons,
      perCoreAttempts,
    },
  };
}
