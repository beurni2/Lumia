/**
 * PHASE W2-QA-FIX-2 — Final-composition first-card quality-band
 * rotation.
 *
 * Pure deterministic reorder of an already-shipped batch. Runs
 * AFTER `annotateAndSortByWillingness` in `hybridIdeator.ts`, so
 * `sorted` arrives in `(pickerEligible desc, willingnessScore desc)`
 * order. The helper:
 *
 *   1. Builds the top-quality band — same picker-eligibility tier
 *      as the leader AND `willingnessScore >= leader - K`.
 *   2. Picks `band[fnv1aHash32(creatorId) % band.length]`.
 *   3. SWAPS that pick with slot-0 (every other position is
 *      preserved verbatim — only positions 0 and `chosenIdx`
 *      change).
 *
 * Goals (W2-QA-AUDIT-2):
 *   • Spread first-card across distinct creators on cold-start
 *     (10 fresh creators must not all see the same idea[0]).
 *   • Same creatorId → same ordering, every call (deterministic).
 *   • NEVER swap in a candidate outside the quality band — never
 *     promotes a materially-weaker idea to slot-0.
 *   • NEVER changes which N ideas ship — pure reorder of the
 *     already-selected batch.
 *   • Ineligible-tier candidates are NEVER swapped above an
 *     eligible-tier leader (tier change ends the band scan).
 *
 * Caller responsibilities (`hybridIdeator.ts` L5884-ish):
 *   • Only call when `creatorId` is non-empty.
 *   • Only call on cold-start (`regenerate === false`). Refresh
 *     batches must bypass — selectWithNovelty's
 *     `recentIdeaCoreFamilies` etc. already spread refresh outputs
 *     across families, and the freshness signal there is more
 *     informative than a cold-start hash.
 *   • Cohort-agnostic: NG / India / PH activated cohorts route
 *     through `applyNigerianPackSlotReservation` upstream; that
 *     reservation places the NG-pack pick at slot-0 of the
 *     intermediate batch, but the willingness re-sort can still
 *     demote it. Calling this helper unconditionally on cold-start
 *     applies the same "spread first-card across creators"
 *     property to NG / IN / PH cohorts as well.
 */

/** Quality-band tolerance in willingnessScore points. Tight enough
 *  that band members are effectively willingness-equivalent — never
 *  rotates to a materially-weaker candidate. */
export const FIRST_CARD_QUALITY_BAND_K = 10;

/** Pure FNV-1a 32-bit hash over a UTF-16 string. Deterministic, no
 *  allocations beyond the loop counter. We only need
 *  `result % bandSize` so the 32-bit truncation collisions don't
 *  matter for selection fairness. Mirrors the helper in
 *  `westernPackSlotReservation.ts` — kept inline (rather than
 *  imported) to keep this lib free of W2-K coupling. */
function fnv1aHash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** Minimal structural shape required by the helper. The real
 *  candidate type from `hybridIdeator.ts` is `{ idea: Idea; score:
 *  IdeaScore; meta: CandidateMeta }`, but the rotation only reads
 *  `idea.willingnessScore` + `idea.pickerEligible` (set by
 *  `annotateAndSortByWillingness` immediately upstream). Generic
 *  parameterization keeps the caller's full candidate type in the
 *  output. */
export type FirstCardRotationCandidate = {
  idea: {
    willingnessScore?: number;
    pickerEligible?: boolean;
  };
};

/**
 * Cold-start first-card rotation.
 *
 * Returns a new array of the same length and contents as `sorted`,
 * with positions 0 and `chosenIdx` swapped when:
 *   - input length >= 2
 *   - creatorId non-empty
 *   - top-quality band size >= 2
 *   - hashed-modulo pick is not slot-0 itself
 *
 * In every other case (degenerate length, empty creatorId,
 * band-size-1, hash lands on slot-0) the original order is
 * returned (defensively cloned to keep the contract pure). */
export function applyFirstCardQualityBandRotation<
  T extends FirstCardRotationCandidate,
>(
  sorted: ReadonlyArray<T>,
  creatorId: string,
  k: number = FIRST_CARD_QUALITY_BAND_K,
): T[] {
  if (sorted.length < 2 || creatorId.length === 0) {
    return sorted.slice();
  }

  const leader = sorted[0]!;
  const leaderEligible = leader.idea.pickerEligible === true;
  const leaderScore =
    typeof leader.idea.willingnessScore === "number"
      ? leader.idea.willingnessScore
      : 0;
  const floor = leaderScore - k;

  const bandIndices: number[] = [0];
  for (let i = 1; i < sorted.length; i++) {
    const c = sorted[i]!;
    const cEligible = c.idea.pickerEligible === true;
    // Tier change: `annotateAndSortByWillingness` sorts by
    // (pickerEligible desc, willingnessScore desc), so the moment
    // we drop tier we are past every eligible candidate. Stop
    // immediately — never let an ineligible idea enter the band.
    if (cEligible !== leaderEligible) break;
    const ws =
      typeof c.idea.willingnessScore === "number"
        ? c.idea.willingnessScore
        : 0;
    if (ws >= floor) bandIndices.push(i);
    else break;
  }

  if (bandIndices.length < 2) return sorted.slice();

  const idx = fnv1aHash32(creatorId) % bandIndices.length;
  if (idx === 0) return sorted.slice();

  const chosenIdx = bandIndices[idx]!;
  const out = sorted.slice();
  const a = out[0]!;
  const b = out[chosenIdx]!;
  out[0] = b;
  out[chosenIdx] = a;
  return out;
}
