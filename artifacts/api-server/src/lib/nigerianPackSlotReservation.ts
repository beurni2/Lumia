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
  const packRanked = candidatePool
    .filter((c) => {
      const id = packEntryIdOf(c);
      if (id === undefined) return false;
      if (excludeEntryIds && excludeEntryIds.has(id)) return false;
      return true;
    })
    .slice()
    .sort((a, b) => b.score.total - a.score.total);

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
  if (dedupedPack.length === 0) return stripExcludedPackFromBatch(selectionBatch);

  // Cap reserved slots at 2 (per spec) AND at desiredCount AND at
  // the number of distinct pack candidates available.
  const maxReserved = Math.min(2, dedupedPack.length, desiredCount);
  const reservedPack = dedupedPack.slice(0, maxReserved);

  // Non-pack picks preserve upstream selection order. Drop any
  // non-pack pick whose normalized hook collides with a reserved
  // pack hook (impossible in practice — pack and catalog hooks have
  // distinct shapes — but the dedup keeps the invariant explicit).
  const nonPackOrdered = selectionBatch
    .filter((c) => packEntryIdOf(c) === undefined)
    .filter((c) => !reservedHooks.has(normHook(c.idea.hook)));

  // Compose: even-indexed slots reserved for pack, odd-indexed for
  // non-pack. For desiredCount=3 with ≥2 pack this yields the spec's
  // [pack, nonPack, pack]. For 1 pack it yields [pack, nonPack,
  // nonPack] (slot 2 wants pack, falls through to non-pack). For
  // desiredCount=1 it yields [pack]; for 2 it yields [pack, nonPack].
  const composed: ScoredCandidate[] = [];
  const pickedHooks = new Set<string>();
  let packIdx = 0;
  let nonPackIdx = 0;
  for (let slot = 0; slot < desiredCount; slot++) {
    const wantPackHere = slot % 2 === 0 && packIdx < reservedPack.length;
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
    return stripExcludedPackFromBatch(selectionBatch);
  }
  return composed;
}
