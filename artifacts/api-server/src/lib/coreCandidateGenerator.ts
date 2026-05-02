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
};

/** Y6 widens the rejection-reason union with `construction_failed`
 *  (cohesive author returns this when its structural precondition —
 *  hook ↔ whatToShow ↔ howToFilm anchor present and contradiction
 *  beat present — fails) so dashboards can distinguish recipe-bug
 *  rejections from gate rejections. */
export type CoreCandidateRejectionReason =
  | ComedyRejectionReason
  | "schema_invalid"
  | "construction_failed"
  | "core_misconfigured";

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
     *  `.no_tension` etc. without `??`. */
    rejectionReasons: Record<
      ComedyRejectionReason | "schema_invalid" | "construction_failed",
      number
    >;
    perCoreAttempts: CoreCandidateAttempt[];
  };
};

// ---------------------------------------------------------------- //
// Y6 family → voice cluster (deterministic; Y7 will replace with    //
// taste-driven selection)                                           //
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
 *  position, with anchors NOT substring-contained in any recent
 *  premise PROMOTED to the front (recency channel — same anchor as
 *  the last batch loses tiebreak, never gets HARD rejected). */
function buildRecipeQueue(
  rows: readonly CoreDomainAnchorRow[],
  salt: number,
  coreId: string,
  recentPremises: ReadonlySet<string>,
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
  // Salt-rotated start position so cold-start (no recent premises)
  // still rotates across batches.
  const start = djb2(`${salt}|${coreId}|recipe`) % all.length;
  const rotated: Recipe[] = [];
  for (let i = 0; i < all.length; i++) {
    rotated.push(all[(start + i) % all.length]!);
  }
  // Promote fresh anchors. An anchor is "stale" if its lowercase
  // form appears as a WORD-BOUNDARY token in any recent premise.
  // Word-boundary (vs raw substring) rules out the false-positive
  // class the post-Y6 architect flagged: short anchors like `tab`
  // would otherwise match inside `tablet`/`stable`/`table` and
  // misclassify a fresh anchor as stale. Using \b on both sides
  // means we only mark stale on a real token re-use.
  if (recentPremises.size === 0) return rotated;
  const fresh: Recipe[] = [];
  const stale: Recipe[] = [];
  for (const r of rotated) {
    const a = r.anchor.toLowerCase();
    const escaped = a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`);
    let isStale = false;
    for (const pre of recentPremises) {
      if (re.test(pre.toLowerCase())) {
        isStale = true;
        break;
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
  ComedyRejectionReason | "schema_invalid" | "construction_failed",
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
};

/** Spec — was 3 in Y5; Y6 walks 5 (domain, anchor) recipes per core
 *  before dropping. Still cheap (no Claude); raises kept-rate floor
 *  modestly across the cohesive author. */
const RECIPES_PER_CORE_CAP = 5;

export function generateCoreCandidates(
  input: GenerateCoreCandidatesInput,
): GenerateCoreCandidatesResult {
  const salt = Math.trunc(input.regenerateSalt ?? 0);
  const recentPremises = input.recentPremises ?? new Set<string>();
  const seedFingerprints = loadSeedHookFingerprints();
  const cap = Math.max(0, Math.trunc(input.count));

  const candidates: CoreNativeCandidate[] = [];
  const perCoreAttempts: CoreCandidateAttempt[] = [];
  const reasons: Record<
    ComedyRejectionReason | "schema_invalid" | "construction_failed",
    number
  > = { ...EMPTY_REASONS };
  let generatedCount = 0;

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

    const voiceId = FAMILY_VOICE[core.family];
    const voice = getVoiceCluster(voiceId);

    const queue = buildRecipeQueue(rows, salt, core.id, recentPremises);

    let kept = false;
    let attempts = 0;
    let lastReason: CoreCandidateRejectionReason | undefined;

    for (const recipe of queue) {
      if (attempts >= RECIPES_PER_CORE_CAP) break;
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
      // Attach scenarioFingerprint to meta for served-log telemetry.
      // Read by `hybridIdeator` via `(c.meta as { scenarioFingerprint?:
      // string }).scenarioFingerprint` — same indirection used for
      // `premiseCoreId` etc. Y8 will harden this into a proper field.
      const meta: CandidateMeta = {
        ...result.meta,
        scenarioFingerprint: result.scenarioFingerprint,
      };
      candidates.push({ idea: result.idea, meta });
      kept = true;
      break;
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
