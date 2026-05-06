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

  // Distinct pack candidates from the post-validation pool, ranked
  // by score.total descending. Per-batch dedup on entry id AND on
  // normalized hook so the same pack hook can't take two slots even
  // if it surfaced under two different cores.
  const packRanked = candidatePool
    .filter((c) => packEntryIdOf(c) !== undefined)
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
  if (dedupedPack.length === 0) return selectionBatch;

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
  if (composed.length < selectionBatch.length) return selectionBatch;
  return composed;
}
