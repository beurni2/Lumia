/**
 * PHASE N1-FOLLOWUP-CREATOR-SEEDED-TIEBREAK — final-composition
 * creator-seeded rank rotation.
 *
 * Pure deterministic reorder of an already-shipped, already-sorted
 * batch. Runs AFTER `annotateAndSortByWillingness` AND AFTER
 * `applyFirstCardQualityBandRotation` in `hybridIdeator.ts`. Extends
 * the same "within a K-band of willingness, same pickerEligible
 * tier, creator-seeded swap" principle from slot-0 to every slot
 * `0..N-2`.
 *
 * Why
 * ---
 * `.local/N1_FOLLOWUP_PRESLICE_CANDIDATE_INSTRUMENTATION_REPORT.md`
 * proved that NG cold-start ships the same 4 hooks for every fresh
 * creator because `scoreTotal` is bit-identical across creators
 * ⇒ deterministic willingness sort ⇒ deterministic per-slot winner.
 * The pre-slice top-6 already contains 5 viable alternatives within
 * K=10 score for every repeated hook; the selector is collapsing
 * the pool, not running short of it.
 *
 * Algorithm
 * ---------
 * For each `slotIdx` in `0..N-2`:
 *   1. Treat `sorted[slotIdx]` as the slot leader. Snapshot its
 *      `pickerEligible` tier and `willingnessScore`.
 *   2. Walk `slotIdx+1..N-1` to identify the contiguous K-band:
 *      candidates whose `pickerEligible` matches the leader AND
 *      whose `willingnessScore >= leaderScore - K`. The walk stops
 *      at the first tier change OR the first below-floor score
 *      (mirrors `applyFirstCardQualityBandRotation` semantics).
 *   3. If band size < 2, leave `slotIdx` unchanged and continue.
 *   4. Compute `pickIdx = fnv1aHash32("<creatorId>|<slotIdx>") %
 *      bandSize`. If `pickIdx === 0`, leave unchanged. Otherwise
 *      swap `sorted[slotIdx]` with `sorted[band[pickIdx]]`.
 *   5. Continue to next `slotIdx`. The newly placed leader at
 *      `slotIdx` is the comparison anchor for the next slot's band.
 *
 * Salting the hash with `slotIdx` ensures slot 1's pick is
 * statistically independent of slot 0's pick for the same creator —
 * without the salt every slot would land on the same modular index
 * within its (different-shape) band, undoing most of the rotation.
 *
 * Hard invariants (mirrors `applyFirstCardQualityBandRotation`)
 * -------------------------------------------------------------
 *   • Same length, same identity set: pure swap, no drops, no
 *     duplicates, no underfill.
 *   • Same `creatorId` → byte-identical output for the same input.
 *   • Different `creatorId` → different output WHEN at least one
 *     slot has a band size ≥ 2 with a non-zero pick. When every
 *     slot's band size is 1, output is identical to input regardless
 *     of `creatorId`.
 *   • Never crosses tiers: a `pickerEligible: false` candidate
 *     CANNOT swap above a `pickerEligible: true` slot leader (the
 *     band walk stops at tier change).
 *   • Never promotes outside the K-band: tight `K=10` matches the
 *     instrumentation report's evidence (the four repeated hooks
 *     each had 5 alternatives within K=10).
 *   • Pure function — no I/O, no logging, no `Date.now()`, no
 *     `Math.random()`.
 *
 * Caller responsibilities (mirrors first-card rotation)
 * -----------------------------------------------------
 *   • Only call when `creatorId` is non-empty.
 *   • Only call on cold-start (`!regenerate && memoryEmpty`).
 *     Refresh batches must bypass — `selectWithNovelty` already
 *     spreads refresh outputs via the `recent*` cross-batch
 *     diversity rescues, and the cold-start hash adds nothing
 *     once memory is informative.
 *   • Cohort-agnostic: applies to every region the same way the
 *     first-card rotation does. Cohorts whose pre-slice pool only
 *     yields band-size-1 windows (e.g. western pools where the
 *     willingness gradient is sharper than K=10) get a no-op,
 *     which is exactly what we want for "preserve Western behavior
 *     unless deliberately measured."
 */

/** Quality-band tolerance in willingnessScore points. Matches
 *  `FIRST_CARD_QUALITY_BAND_K` so the slot-0 behavior of this helper
 *  is band-equivalent to the existing first-card helper. The two
 *  helpers compose: the first-card helper picks slot-0 with seed
 *  `fnv1a(creatorId)`, then this helper RE-CONSIDERS slot-0 with
 *  seed `fnv1a("creatorId|0")` (different hash domain). When the
 *  second pick lands on the same band index, the swap is a no-op;
 *  when it lands elsewhere, this helper performs the second swap
 *  on top of the first. Both helpers are pure swaps within the same
 *  band ⇒ composition stays inside the same band ⇒ quality stays
 *  bounded by `K` from the original leader's willingness in either
 *  case. */
export const CREATOR_SEEDED_RANK_BAND_K = 10;

/** FNV-1a 32-bit hash. Inlined (not imported from the W2-K helper
 *  or the first-card helper) to keep this lib free of cross-coupling.
 *  The byte-for-byte equality with the first-card helper is intentional
 *  and tested. */
function fnv1aHash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** Minimal structural shape required by the helper. Mirrors the
 *  first-card helper's `FirstCardRotationCandidate`. */
export type CreatorSeededRankCandidate = {
  idea: {
    willingnessScore?: number;
    pickerEligible?: boolean;
  };
};

/**
 * Apply creator-seeded K-band rotation to every rank slot.
 *
 * Returns a new array of the same length and identity set as
 * `sorted`. Pure: does NOT mutate `sorted` or any element.
 *
 * Degenerate cases (returned as a defensive `slice()` of `sorted`):
 *   - `sorted.length < 2`
 *   - `creatorId.length === 0`
 *   - every slot's band size is 1 (no rotation possible)
 */
export function applyCreatorSeededRankRotation<
  T extends CreatorSeededRankCandidate,
>(
  sorted: ReadonlyArray<T>,
  creatorId: string,
  k: number = CREATOR_SEEDED_RANK_BAND_K,
): T[] {
  if (sorted.length < 2 || creatorId.length === 0) {
    return sorted.slice();
  }
  const out = sorted.slice();
  for (let slotIdx = 0; slotIdx < out.length - 1; slotIdx++) {
    const leader = out[slotIdx]!;
    const leaderEligible = leader.idea.pickerEligible === true;
    const leaderScore =
      typeof leader.idea.willingnessScore === "number"
        ? leader.idea.willingnessScore
        : 0;
    const floor = leaderScore - k;
    // Build the band starting AT slotIdx (slot leader is band[0]).
    const bandIndices: number[] = [slotIdx];
    for (let i = slotIdx + 1; i < out.length; i++) {
      const c = out[i]!;
      const cEligible = c.idea.pickerEligible === true;
      // Tier change ⇒ band ends. `annotateAndSortByWillingness`
      // sorts pickerEligible-true ahead of pickerEligible-false, so
      // once we cross the tier boundary every later candidate is
      // ineligible relative to this slot's leader and CANNOT be
      // promoted into the slot.
      if (cEligible !== leaderEligible) break;
      const ws =
        typeof c.idea.willingnessScore === "number"
          ? c.idea.willingnessScore
          : 0;
      if (ws >= floor) bandIndices.push(i);
      else break;
    }
    if (bandIndices.length < 2) continue;
    // Salt the hash with `slotIdx` so each slot's pick is
    // statistically independent of every other slot's pick for the
    // same creator. Without the salt the same modular index would
    // be picked at every slot, undoing most of the rotation.
    const pickIdx = fnv1aHash32(`${creatorId}|${slotIdx}`) % bandIndices.length;
    if (pickIdx === 0) continue;
    const chosenIdx = bandIndices[pickIdx]!;
    const a = out[slotIdx]!;
    const b = out[chosenIdx]!;
    out[slotIdx] = b;
    out[chosenIdx] = a;
  }
  return out;
}
