/**
 * PHASE N1-FOLLOWUP-NG-CLEAN-FIRST-CARD-CORE-RESERVATION
 * (BI 2026-05-10) — pure helper.
 *
 * GOAL: Build a scalable ng_clean first-card pool. Acceptance floor
 * for this phase is ≥ 3 distinct slot-0 leaders across memory-
 * exercised batches; preferred 4-5; design supports 8-12+ in the
 * future without a rewrite. The reservation step ENSURES that
 * `final[]` carries enough `pickerEligible` clean-core candidates
 * for the existing `applyNgCleanSlot0AntiRepeatSwap` helper to
 * actually rotate through.
 *
 * ARCHITECTURE: this is the FINAL-side half of a two-part fix.
 *   • Part A (per-core retention) lives in `coreCandidateGenerator.ts`
 *     and pushes top-N distinct `pickerEligible`-quality clean-core
 *     candidates per active clean-core core into the pre-selection
 *     candidate stream — widening the pool that `selectWithNovelty`
 *     and the willingness ranker draw from.
 *   • Part B (THIS helper) operates AFTER `annotateAndSortByWillingness`
 *     in `hybridIdeator.ts`. It counts `pickerEligible` clean-core
 *     entries already present in `final[]` and, when below the
 *     configurable MIN target, replaces lowest-priority non-clean-
 *     core slots with `pickerEligible` clean-core entries from a
 *     supplied sidecar pool (post-rescore `localResult.kept`
 *     filtered to clean-core, annotated with `pickerEligible`).
 *
 * HARD CONTRACT
 *   1. SWAP-ONLY — preserves `final[]` length. Never appends, never
 *      removes; net candidate count is identical.
 *   2. Pure — does not mutate the input array. Returns a new array
 *      when reservations fire, otherwise returns the input reference.
 *   3. Slot 0 is NEVER directly written by this helper. The
 *      downstream `applyNgCleanSlot0AntiRepeatSwap` is responsible
 *      for slot-0 rotation; this helper only widens the pool the
 *      swap helper sees.
 *   4. Quality guard — both source candidates (final[] + sidecar)
 *      MUST be `pickerEligible === true`. Sub-floor or aiCliché
 *      candidates are STRUCTURALLY ineligible because that flag is
 *      set by `annotateAndSortByWillingness` against the strict
 *      `hookQualityScore >= PICKER_HQS_FLOOR && aiCliche === 0`
 *      gate.
 *   5. Clean-core resolution uses the canonical hook→entry-id
 *      lookup in `nigerianCleanCoreSlot0AntiRepeatSwap.ts` —
 *      `resolveCleanCoreEntryIdByHook`, strict normalized equality
 *      against `NIGERIAN_CLEAN_CORE_ENTRIES`. Decorated /
 *      pattern-variation hooks resolve to `null` and are
 *      structurally ineligible.
 *   6. Distinct entry-id dedup: a `cleanCoreEntryId` already
 *      present in `final[]` (or already chosen during the same
 *      reservation pass) is never re-reserved. Maximises distinct-
 *      leader surface for the slot-0 swap.
 *   7. Activation-gated by the caller (region=nigeria,
 *      languageStyle=clean, regenerate=false, non-empty creatorId,
 *      flag ON). Helper does NOT re-check; called only from the
 *      hybridIdeator activation block.
 *   8. Deterministic. No process-global state, no random behaviour,
 *      no DB I/O, no async work.
 *
 * CONFIGURABILITY: the three exported constants encode the phase
 * targets (MIN=3, PREFERRED=5, MAX=8). MIN is the acceptance
 * floor; PREFERRED is the steady-state target when the corpus
 * supplies enough distinct entries; MAX is the design ceiling for
 * future corpus growth. The helper accepts per-call overrides
 * inside the same [0, MAX] envelope so a future scale-up to
 * 8-12+ first-card candidates needs only a constant bump, not a
 * rewrite. If the corpus cannot supply more than 3-4 distinct
 * `pickerEligible` clean-core entries the helper will surface
 * exactly that count — that is a corpus / HQS limitation, not a
 * reservation limitation.
 */

import { resolveCleanCoreEntryIdByHook } from "./nigerianCleanCoreSlot0AntiRepeatSwap.js";

/** Env flag — staging-only. Production `[services.production.run.env]`
 *  does NOT set this. Default OFF preserves byte-identical behaviour
 *  for every cohort. */
export const NG_CLEAN_FIRST_CARD_RESERVATION_FLAG_ENV =
  "LUMINA_NG_CLEAN_FIRST_CARD_RESERVATION_ENABLED";

/** Acceptance floor for this phase (distinct slot-0 leaders). */
export const MIN_NG_CLEAN_FIRST_CARD_CORE_CANDIDATES = 3;

/** Preferred steady-state target. */
export const PREFERRED_NG_CLEAN_FIRST_CARD_CORE_CANDIDATES = 5;

/** Design ceiling — bumping this constant scales the design to
 *  8-12+ without any other change. */
export const MAX_NG_CLEAN_FIRST_CARD_CORE_CANDIDATES = 8;

/** Per-core retention cap inside `coreCandidateGenerator` — best
 *  + up to (CAP-1) `pickerEligible`-quality clean-core runner-ups
 *  per clean-core-active core. Keeps the per-core surface bounded
 *  while feeding the reservation step a non-trivial sidecar. */
export const NG_CLEAN_PER_CORE_RETENTION_CAP = 3;

/** HQS floor used by the per-core retention block as a proxy for
 *  the strict `pickerEligible` (which is set later by
 *  `annotateAndSortByWillingness`). Mirrors `PICKER_HQS_FLOOR`
 *  in `willingnessScorer.ts`. */
export const NG_CLEAN_RETENTION_HQS_FLOOR = 50;

export interface ReservationCandidate {
  readonly idea: {
    readonly hook: string;
    readonly pickerEligible?: boolean;
  };
}

export interface NgCleanFirstCardReservationContext<T extends ReservationCandidate> {
  /** Pre-selection / post-rescore candidate pool (typically
   *  `localResult.kept` filtered to clean-core and annotated via
   *  `annotateAndSortByWillingness`). Walk order is treated as
   *  rank order — earlier entries are higher-priority. */
  readonly sidecarPool: ReadonlyArray<T>;
  /** Override the hard MIN target (clamped to [0, MAX]). */
  readonly minTarget?: number;
  /** Override the steady-state PREFERRED target (clamped to
   *  [minTarget, MAX]). */
  readonly preferredTarget?: number;
  /** Override the design MAX target (clamped to
   *  [preferredTarget, MAX_NG_CLEAN_FIRST_CARD_CORE_CANDIDATES]). */
  readonly maxTarget?: number;
}

export interface NgCleanFirstCardReservationResult<T extends ReservationCandidate> {
  readonly final: ReadonlyArray<T>;
  /** Number of replacements actually performed. */
  readonly reservedCount: number;
  /** Distinct `pickerEligible` clean-core entry-id count BEFORE
   *  the helper ran (count of clean-core in `final[]`). */
  readonly preCount: number;
  /** Distinct `pickerEligible` clean-core entry-id count AFTER
   *  the helper ran. */
  readonly postCount: number;
  /** Indexes in `final[]` that were replaced (always ≥ 1; slot 0
   *  is never written by this helper). */
  readonly replacedIndexes: ReadonlyArray<number>;
  /** `cleanCoreEntryId`s newly inserted into `final[]`. Each is
   *  distinct and was not present in `final[]` before. */
  readonly reservedEntryIds: ReadonlyArray<string>;
}

/** Compose `pickerEligible && hook resolves to clean-core` once. */
const resolveEligibleCleanCore = (
  c: ReservationCandidate,
): { eligible: boolean; entryId: string | null } => {
  const eligible = c.idea.pickerEligible === true;
  const entryId = resolveCleanCoreEntryIdByHook(c.idea.hook);
  return { eligible: eligible && entryId !== null, entryId };
};

/** Apply the reservation step. Pure helper — see contract above. */
export const applyNgCleanFirstCardCoreReservation = <T extends ReservationCandidate>(
  final: ReadonlyArray<T>,
  ctx: NgCleanFirstCardReservationContext<T>,
): NgCleanFirstCardReservationResult<T> => {
  // ---- Resolve per-call targets, clamped into the design envelope. ----
  const rawMin = ctx.minTarget ?? MIN_NG_CLEAN_FIRST_CARD_CORE_CANDIDATES;
  const minTarget = Math.min(
    Math.max(rawMin, 0),
    MAX_NG_CLEAN_FIRST_CARD_CORE_CANDIDATES,
  );
  const rawPreferred =
    ctx.preferredTarget ?? PREFERRED_NG_CLEAN_FIRST_CARD_CORE_CANDIDATES;
  const preferredTarget = Math.min(
    Math.max(rawPreferred, minTarget),
    MAX_NG_CLEAN_FIRST_CARD_CORE_CANDIDATES,
  );
  const rawMax = ctx.maxTarget ?? MAX_NG_CLEAN_FIRST_CARD_CORE_CANDIDATES;
  const maxTarget = Math.min(
    Math.max(rawMax, preferredTarget),
    MAX_NG_CLEAN_FIRST_CARD_CORE_CANDIDATES,
  );

  // ---- Step 1: index `final[]` for clean-core entry ids. ----
  const finalEntryIdByIndex: Array<string | null> = new Array(final.length);
  const inFinalEntryIds = new Set<string>();
  for (let i = 0; i < final.length; i++) {
    const { eligible, entryId } = resolveEligibleCleanCore(final[i]!);
    if (eligible && entryId !== null) {
      finalEntryIdByIndex[i] = entryId;
      inFinalEntryIds.add(entryId);
    } else {
      finalEntryIdByIndex[i] = null;
    }
  }
  const preCount = inFinalEntryIds.size;

  const noopResult = (): NgCleanFirstCardReservationResult<T> => ({
    final,
    reservedCount: 0,
    preCount,
    postCount: preCount,
    replacedIndexes: [],
    reservedEntryIds: [],
  });

  // ---- Step 2: short-circuit if already at or above MIN. ----
  // The MIN target is what unblocks the slot-0 anti-repeat swap. We
  // intentionally do NOT push past MIN unless the caller set a
  // higher per-call target — the corpus may not support more, and
  // forcing replacements past MIN risks evicting genuinely high-
  // willingness non-clean-core candidates for marginal value.
  if (preCount >= minTarget) {
    return noopResult();
  }

  // ---- Step 3: collect distinct `pickerEligible` clean-core sidecar
  //              picks not already in `final[]`. Walk order is rank.
  const seen = new Set<string>(inFinalEntryIds);
  const sidecarPicks: Array<{ cand: T; entryId: string }> = [];
  const ceiling = Math.min(preferredTarget, maxTarget);
  for (const c of ctx.sidecarPool) {
    if (preCount + sidecarPicks.length >= ceiling) break;
    const { eligible, entryId } = resolveEligibleCleanCore(c);
    if (!eligible || entryId === null) continue;
    if (seen.has(entryId)) continue;
    seen.add(entryId);
    sidecarPicks.push({ cand: c, entryId });
  }

  if (sidecarPicks.length === 0) {
    return noopResult();
  }

  // ---- Step 4: find lowest-priority non-clean-core slots in
  //              `final[]` (skip slot 0). Walk from end toward 1.
  const replaceableIdx: number[] = [];
  for (let i = final.length - 1; i >= 1; i--) {
    if (finalEntryIdByIndex[i] === null) {
      replaceableIdx.push(i);
      if (replaceableIdx.length >= sidecarPicks.length) break;
    }
  }
  const swaps = Math.min(replaceableIdx.length, sidecarPicks.length);
  if (swaps === 0) {
    return noopResult();
  }

  // ---- Step 5: build the swapped array. Pure — input untouched. ----
  const next: T[] = final.slice();
  const replacedIndexes: number[] = [];
  const reservedEntryIds: string[] = [];
  for (let s = 0; s < swaps; s++) {
    const replaceAt = replaceableIdx[s]!;
    const pick = sidecarPicks[s]!;
    next[replaceAt] = pick.cand;
    replacedIndexes.push(replaceAt);
    reservedEntryIds.push(pick.entryId);
  }
  return {
    final: next,
    reservedCount: swaps,
    preCount,
    postCount: preCount + swaps,
    replacedIndexes,
    reservedEntryIds,
  };
};

/** Cheap singleton flag check — stays a single env-var read. */
export const isNgCleanFirstCardReservationEnabled = (): boolean =>
  process.env[NG_CLEAN_FIRST_CARD_RESERVATION_FLAG_ENV] === "true";
