/**
 * PHASE N1-S2 — Nigerian Pack Slot Reservation.
 *
 * Reserves up to 2 of `desiredCount` final shipped slots for
 * Nigerian-pack candidates when the four-AND activation guard is
 * satisfied (`canActivateNigerianPack`). For desiredCount=3 the
 * composed batch is:
 *
 *   ≥2 distinct pack candidates : [topPack, topNonPack, secondPack]
 *    1 pack candidate           : [topPack, topNonPack, nextNonPack]
 *    0 pack candidates          : selectionBatch returned unchanged
 *
 * Hard rules honoured:
 *   • Activation guard short-circuits to identity for every cohort
 *     other than nigeria + pidgin/light_pidgin + flag ON + non-empty
 *     pack — flag-OFF and non-eligible cohorts are byte-identical to
 *     the upstream `selection.batch`.
 *   • Pack candidates are drawn ONLY from the post-validation
 *     `candidatePool` — every entry in that pool has already passed
 *     `ideaSchema`, `validateScenarioCoherence`, `validateComedy`,
 *     and `validateAntiCopyDetailed`. No validator is touched here.
 *   • Per-batch dedup: no two reserved slots share a
 *     `nigerianPackEntryId` and no two slots share a normalized hook.
 *   • Non-pack slots preserve the order produced by upstream
 *     `selectWithNovelty` + `applyBatchComposition`, so trend-cap,
 *     hero/taste composition, and willingness ordering all remain
 *     authoritative for the non-reserved positions.
 *   • No score boost. No global change to `scoreHookQuality`. No
 *     mutation of any candidate's `meta`. Pure reorder.
 */

import type { ScoredCandidate } from "./ideaScorer.js";
import type { Region } from "@workspace/lumina-trends";
import type { LanguageStyle } from "./tasteCalibration.js";
import { canActivateNigerianPack } from "./nigerianHookPack.js";
import { logger } from "./logger.js";

// PHASE N1-LIVE-HARDEN F3 — observability shape. Emitted once per
// invocation (when activated) so the orchestrator log can attribute
// pack-pool drains to the right filter stage. NOT emitted for the
// short-circuit / non-activated path — that already logs as
// `activated:false` upstream.
export type SlotReservationDiagnostic = {
  /** Pack candidates in `candidatePool` BEFORE per-creator memory filter. */
  packPoolPreFilter: number;
  /** Pack candidates remaining AFTER per-creator memory (`excludeEntryIds`) filter. */
  packPoolPostMemoryFilter: number;
  /** Pack candidates remaining AFTER per-batch entry-id + hook dedup. */
  packPoolPostBatchDedup: number;
  /**
   * `true` when reservation took the early `dedupedPack.length === 0`
   * fallback (i.e. composed pack count = 0). The two non-empty paths
   * (composed batch returned, or composition shrunk below upstream and
   * fell through) emit `false`.
   */
  earlyReturnEmptyPack: boolean;
  /**
   * PHASE N1-LIVE-HARDEN P1 — `true` when the memory soft-cap rescue
   * path fired (memory wiped pool to zero AND softCapEnabled AND an
   * ordered seen-entry list was supplied AND relaxing to the most-
   * recent half surfaced ≥1 candidate). `false` otherwise (including
   * when softCapEnabled is OFF, the field defaults to `false` so the
   * diagnostic shape is stable across cohorts).
   */
  softCapRescueFired: boolean;
  /**
   * PHASE N1-LIVE-HARDEN P1 — when the rescue fires, the size of the
   * relaxed exclusion set (the most-recent ⌈n/2⌉ of the original
   * ordered seen list). `null` when the rescue did not fire.
   */
  softCapRelaxedSeenSize: number | null;
};

export interface SlotReservationInput {
  selectionBatch: ScoredCandidate[];
  candidatePool: ScoredCandidate[];
  desiredCount: number;
  region: Region | undefined;
  languageStyle: LanguageStyle | null;
  flagEnabled: boolean;
  packLength: number;
  /**
   * PHASE N1-FULL-SPEC — per-creator hook memory.
   *
   * Optional set of `nigerianPackEntryId` values the creator has
   * already seen in a recent shipped batch. Pack candidates whose
   * entry id is in this set are filtered out of the ranked pool
   * BEFORE the reserve-vs-non-pack composition runs, so the
   * creator never sees the same pack hook twice in a row.
   *
   * Strictly additive: when undefined or empty, the function
   * behaves identically to its previous signature (this is what
   * keeps non-NG cohorts and tests that don't pass the field
   * byte-identical to the baseline).
   *
   * The filter happens BEFORE the per-batch dedup and the
   * `maxReserved = min(2, ..., desiredCount)` cap, so it can only
   * REDUCE the reserved-pack count, never inflate it. If filtering
   * leaves zero pack candidates, the function falls through to
   * `return selectionBatch` exactly like the no-pack-available
   * branch — no upstream selection is regressed.
   */
  excludeEntryIds?: ReadonlySet<string>;
  /**
   * PHASE N1-LIVE-HARDEN P1 — staging-only memory soft-cap rescue.
   *
   * When `softCapEnabled` is true AND the standard memory filter
   * (`excludeEntryIds`) would wipe the pack pool to zero AND
   * `excludeEntryIdsOrdered` is provided (most-recent first), the
   * rescue path drops the OLDEST half of seen entries from the
   * exclusion set FOR THIS REQUEST ONLY and re-runs the filter.
   *
   * The persisted memory column is NEVER mutated — relaxation is
   * per-request only. Per-batch dedup on `nigerianPackEntryId` AND
   * normalized hook is enforced AFTER rescue, so the rescue can
   * never produce duplicate entry ids or duplicate hooks in the
   * shipped batch (those constraints sit downstream of the rescue
   * branch on the same code path).
   *
   * Both fields default to OFF — when `softCapEnabled` is false /
   * undefined, the helper is byte-identical to the pre-P1 baseline
   * for every cohort. Production must keep this gated OFF until the
   * staging QA verdict explicitly approves enabling.
   */
  softCapEnabled?: boolean;
  excludeEntryIdsOrdered?: ReadonlyArray<string>;
  /**
   * PHASE N1-LIVE-HARDEN F3 — observability sink. Optional callback
   * invoked once per ACTIVATED invocation (gated by
   * `canActivateNigerianPack`) with the per-stage pack-pool counts.
   * Pure side-channel; never affects the return value. Non-activated
   * cohorts skip the call entirely so flag-OFF / non-NG / NG-clean /
   * NG-null behaviour is byte-identical.
   */
  onDiagnostic?: (d: SlotReservationDiagnostic) => void;
  /**
   * PHASE N1-LIVE-HARDEN P1 — opaque creator id surfaced into the
   * `nigerian_pack.memory_soft_cap_rescued` log line when the rescue
   * fires. Optional; when omitted the log line is still emitted with
   * `creatorId: null`. NOT used for any branching — pure logging
   * tag.
   */
  creatorIdForLog?: string | null;
}

function normHook(h: string): string {
  return h
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,!?;:]+$/, "");
}

function packEntryIdOf(c: ScoredCandidate): string | undefined {
  return (c.meta as { nigerianPackEntryId?: string }).nigerianPackEntryId;
}

export function applyNigerianPackSlotReservation(
  input: SlotReservationInput,
): ScoredCandidate[] {
  const {
    selectionBatch,
    candidatePool,
    desiredCount,
    region,
    languageStyle,
    flagEnabled,
    packLength,
    excludeEntryIds,
    softCapEnabled,
    excludeEntryIdsOrdered,
    onDiagnostic,
    creatorIdForLog,
  } = input;

  // Activation guard — identical short-circuit set to S1 wiring.
  if (
    !canActivateNigerianPack({
      region,
      languageStyle,
      flagEnabled,
      packLength,
    })
  ) {
    return selectionBatch;
  }
  if (desiredCount <= 0) return selectionBatch;

  // PHASE N1-FULL-SPEC — fallback hardening for per-creator memory.
  //
  // The two fallback paths below (`return selectionBatch` when no
  // pack candidates survive dedup, and again when composition would
  // shrink the batch) used to return the upstream selection
  // verbatim. That batch is produced by `selectWithNovelty` +
  // `applyBatchComposition` upstream, neither of which is aware of
  // `excludeEntryIds` — so when a creator had already seen a pack
  // entry and that entry happened to also surface in the upstream
  // selection, the fallback would re-ship the seen entry, defeating
  // the per-creator memory contract.
  //
  // This helper strips excluded pack entries from any batch we are
  // about to return through a fallback path. When `excludeEntryIds`
  // is undefined or empty the helper is a no-op (`batch` is returned
  // by reference unchanged), preserving the byte-identical baseline
  // for non-NG cohorts and for tests that don't pass the field.
  //
  // Trade-off: in the rare edge case where stripping shrinks the
  // batch below `desiredCount`, we accept the smaller batch rather
  // than re-ship a seen entry. The per-creator memory contract is
  // explicitly the higher priority of the two — repeated pack hooks
  // are a worse failure mode than a one-short batch.
  const stripExcludedPackFromBatch = (
    batch: ScoredCandidate[],
  ): ScoredCandidate[] => {
    if (!excludeEntryIds || excludeEntryIds.size === 0) return batch;
    return batch.filter((c) => {
      const id = packEntryIdOf(c);
      return id === undefined || !excludeEntryIds.has(id);
    });
  };

  // Distinct pack candidates from the post-validation pool, ranked
  // by score.total descending. Per-batch dedup on entry id AND on
  // normalized hook so the same pack hook can't take two slots even
  // if it surfaced under two different cores.
  //
  // PHASE N1-FULL-SPEC — apply the per-creator memory filter HERE,
  // before any per-batch dedup or the maxReserved cap. Pack
  // candidates whose entry id is in the excludeEntryIds set are
  // dropped from the ranked pool. Undefined / empty set → no-op,
  // baseline behaviour preserved (non-NG cohorts unchanged).
  // PHASE N1-LIVE-HARDEN F3 — capture the pack pool size BEFORE the
  // per-creator memory filter so the diagnostic surface can
  // distinguish "no pack candidates produced upstream" from "pack
  // candidates produced but all already shipped to this creator
  // recently".
  const packPoolPreFilter = candidatePool.reduce(
    (n, c) => (packEntryIdOf(c) !== undefined ? n + 1 : n),
    0,
  );
  // Initial filter against the FULL exclusion set. Both `excludeEntryIds`
  // and (later) the rescue's relaxed set are read through this local
  // mutable so the dedup loop below works against whichever set the
  // current code path settled on.
  let activeExcludeIds: ReadonlySet<string> | undefined = excludeEntryIds;
  let packRanked = candidatePool
    .filter((c) => {
      const id = packEntryIdOf(c);
      if (id === undefined) return false;
      if (activeExcludeIds && activeExcludeIds.has(id)) return false;
      return true;
    })
    .slice()
    .sort((a, b) => b.score.total - a.score.total);
  const packPoolPostMemoryFilter = packRanked.length;

  // PHASE N1-LIVE-HARDEN P1 — memory soft-cap rescue.
  //
  // Conditions for the rescue path to fire (ALL must hold):
  //   1. The standard memory filter wiped the pool to zero
  //      (`packPoolPostMemoryFilter === 0`).
  //   2. There were pack candidates upstream
  //      (`packPoolPreFilter > 0`) — otherwise nothing to rescue.
  //   3. The caller passed `softCapEnabled: true` (env-flag-gated;
  //      defaults to false in production).
  //   4. The caller passed `excludeEntryIdsOrdered` with ≥1 entry
  //      (most-recent first). Empty / missing → no rescue.
  //
  // Rescue action: build a relaxed exclusion set keeping only the
  // most-recent ⌈n/2⌉ ids; refilter the pool against it. The
  // persisted memory column is NOT mutated. Per-batch dedup on
  // entry id + hook is the SAME loop below, so the rescue cannot
  // produce a duplicate entry id or duplicate hook in the shipped
  // batch — those constraints are downstream of the rescue branch.
  let softCapRescueFired = false;
  let softCapRelaxedSeenSize: number | null = null;
  if (
    packPoolPostMemoryFilter === 0 &&
    packPoolPreFilter > 0 &&
    softCapEnabled === true &&
    excludeEntryIdsOrdered !== undefined &&
    excludeEntryIdsOrdered.length > 0
  ) {
    const originalSeen = excludeEntryIdsOrdered.length;
    const keepCount = Math.ceil(originalSeen / 2);
    const relaxed = new Set(excludeEntryIdsOrdered.slice(0, keepCount));
    const rescuedRanked = candidatePool
      .filter((c) => {
        const id = packEntryIdOf(c);
        if (id === undefined) return false;
        if (relaxed.has(id)) return false;
        return true;
      })
      .slice()
      .sort((a, b) => b.score.total - a.score.total);
    if (rescuedRanked.length > 0) {
      packRanked = rescuedRanked;
      activeExcludeIds = relaxed;
      softCapRescueFired = true;
      softCapRelaxedSeenSize = relaxed.size;
      logger.info(
        {
          creatorId: creatorIdForLog ?? null,
          region: region ?? null,
          languageStyle: languageStyle ?? null,
          packPoolPreFilter,
          originalSeenSize: originalSeen,
          relaxedSeenSize: relaxed.size,
          rescuedCandidateCount: rescuedRanked.length,
        },
        "nigerian_pack.memory_soft_cap_rescued",
      );
    }
  }

  const seenEntryIds = new Set<string>();
  const reservedHooks = new Set<string>();
  const dedupedPack: ScoredCandidate[] = [];
  for (const c of packRanked) {
    const entryId = packEntryIdOf(c)!;
    const hookKey = normHook(c.idea.hook);
    if (seenEntryIds.has(entryId) || reservedHooks.has(hookKey)) continue;
    seenEntryIds.add(entryId);
    reservedHooks.add(hookKey);
    dedupedPack.push(c);
  }
  const packPoolPostBatchDedup = dedupedPack.length;
  if (dedupedPack.length === 0) {
    if (onDiagnostic) {
      onDiagnostic({
        packPoolPreFilter,
        packPoolPostMemoryFilter,
        packPoolPostBatchDedup,
        earlyReturnEmptyPack: true,
        softCapRescueFired,
        softCapRelaxedSeenSize,
      });
    }
    // Strip-on-fallback uses the ACTIVE exclusion set so the rescue
    // branch (when it surfaced no usable candidates) still respects
    // the relaxed contract — never shrinks below the original
    // exclusion behavior.
    if (!activeExcludeIds || activeExcludeIds.size === 0) return selectionBatch;
    const localExcl = activeExcludeIds;
    return selectionBatch.filter((c) => {
      const id = packEntryIdOf(c);
      return id === undefined || !localExcl.has(id);
    });
  }

  // PHASE N1-FULL-SPEC LIVE — cap lifted from literal `2` to
  // `desiredCount`. Spec §"Slot reservation" originally capped at
  // 2 to preserve a non-pack variety slot; live user feedback
  // (2026-05-06) explicitly asked for more pidgin coverage and the
  // pack-prefix block (coreCandidateGenerator.ts L955-1064)
  // routinely produces 3+ distinct pack candidates per batch
  // (15 generated, ~2-5 surviving per-core ranking with the style
  // penalty active). The cohort gate at the top of this function
  // (`canActivateNigerianPack`) already restricts this code path
  // to nigeria + pidgin/light_pidgin + flag ON, so non-NG /
  // flag-OFF cohorts remain byte-identical to the pre-lift
  // baseline. `dedupedPack.length` and `desiredCount` are still
  // in the min so we never over-allocate.
  const maxReserved = Math.min(dedupedPack.length, desiredCount);
  const reservedPack = dedupedPack.slice(0, maxReserved);

  // Non-pack picks preserve upstream selection order. Drop any
  // non-pack pick whose normalized hook collides with a reserved
  // pack hook (impossible in practice — pack and catalog hooks have
  // distinct shapes — but the dedup keeps the invariant explicit).
  const nonPackOrdered = selectionBatch
    .filter((c) => packEntryIdOf(c) === undefined)
    .filter((c) => !reservedHooks.has(normHook(c.idea.hook)));

  // PHASE N1-FULL-SPEC LIVE — composition lifted from "even-indexed
  // pack" to "pack-first". The original `slot % 2 === 0` pattern
  // structurally capped pack at ⌈desiredCount/2⌉ (2 for the typical
  // desiredCount=3) even when reservedPack.length allowed more.
  // With the maxReserved cap above lifted to desiredCount, this
  // change closes the loop: when 3 pack candidates survive
  // dedup+memory-filter, all 3 ship as pack. When fewer survive,
  // the trailing slots fall through to non-pack exactly like the
  // 1-pack case did before. Result by available pack count
  // (desiredCount=3): 3-pack → [pack,pack,pack], 2-pack →
  // [pack,pack,nonPack] (was [pack,nonPack,pack]), 1-pack →
  // [pack,nonPack,nonPack] (unchanged). Same cohort gate at the
  // top of the function ensures non-NG / flag-OFF cohorts never
  // hit this loop, so byte-identical parity is preserved.
  const composed: ScoredCandidate[] = [];
  const pickedHooks = new Set<string>();
  let packIdx = 0;
  let nonPackIdx = 0;
  for (let slot = 0; slot < desiredCount; slot++) {
    const wantPackHere = packIdx < reservedPack.length;
    if (wantPackHere) {
      const c = reservedPack[packIdx]!;
      composed.push(c);
      pickedHooks.add(normHook(c.idea.hook));
      packIdx += 1;
      continue;
    }
    // Non-pack slot — advance until we find a hook not already picked.
    let placed = false;
    while (nonPackIdx < nonPackOrdered.length) {
      const c = nonPackOrdered[nonPackIdx]!;
      nonPackIdx += 1;
      const hookKey = normHook(c.idea.hook);
      if (pickedHooks.has(hookKey)) continue;
      composed.push(c);
      pickedHooks.add(hookKey);
      placed = true;
      break;
    }
    if (placed) continue;
    // Ran out of non-pack candidates — fall back to remaining pack
    // picks so we still ship `desiredCount` ideas when possible.
    if (packIdx < reservedPack.length) {
      const c = reservedPack[packIdx]!;
      composed.push(c);
      pickedHooks.add(normHook(c.idea.hook));
      packIdx += 1;
      continue;
    }
    break;
  }

  // If composition produced fewer ideas than upstream selection,
  // return upstream unchanged — never regress shipped count.
  if (composed.length < selectionBatch.length) {
    if (onDiagnostic) {
      onDiagnostic({
        packPoolPreFilter,
        packPoolPostMemoryFilter,
        packPoolPostBatchDedup,
        earlyReturnEmptyPack: false,
        softCapRescueFired,
        softCapRelaxedSeenSize,
      });
    }
    return stripExcludedPackFromBatch(selectionBatch);
  }
  if (onDiagnostic) {
    onDiagnostic({
      packPoolPreFilter,
      packPoolPostMemoryFilter,
      packPoolPostBatchDedup,
      earlyReturnEmptyPack: false,
      softCapRescueFired,
      softCapRelaxedSeenSize,
    });
  }
  return composed;
}
