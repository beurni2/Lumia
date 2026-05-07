/**
 * PHASE W2-K — Western APPROVED pack slot reservation.
 *
 * Reorders the final shipped batch to prefer 1 W2 idea per batch
 * (max 2 if highly distinct), keeping ≥1 non-W2 slot. Runs AFTER
 * `applyNigerianPackSlotReservation` and AFTER the catalog skeleton
 * swap, so the upstream selection / hero / taste / NG composition
 * remain authoritative for the non-reserved positions.
 *
 * Hard rules:
 *   • Activation guard short-circuits to identity for every cohort
 *     other than (region∈{undefined,"western"} +
 *     languageStyle∈{undefined,null,"clean"} + flag ON + non-empty
 *     pool). NG / India / PH cohorts return `selectionBatch`
 *     unchanged.
 *   • Per-creator memory filter (`excludeEntryIds`) is applied
 *     BEFORE picking, so seen W2 entries cannot ship.
 *   • "Highly distinct" two-W2 admission: same family + same
 *     setting + same anchor as the top W2 → only one W2 slot.
 *   • Always preserve ≥1 non-W2 slot when a non-W2 candidate is
 *     available — `maxReserved = min(2, w2Pool.length, desiredCount-1)`.
 *   • Composed batch never exceeds `desiredCount`.
 *   • Composed batch length never falls below `selectionBatch.length`
 *     — never regress shipped count.
 *   • Per-batch dedup: no two slots share a `westernPackEntryId`,
 *     and no two slots share a normalized hook.
 *   • No score boost. No mutation of any candidate's `meta`. Pure
 *     reorder + insert.
 */

import type { ScoredCandidate } from "./ideaScorer.js";
import type { Region } from "@workspace/lumina-trends";
import type { LanguageStyle } from "./tasteCalibration.js";
import { canActivateWesternApprovedPool } from "./westernHookPackApproved.js";

/** Telemetry / classification metadata required for the distinctness check. */
export interface WesternPackCandidate {
  candidate: ScoredCandidate;
  entryId: string;
  comedyFamily: string;
  setting: string;
  anchor: string;
  /** Higher is better. Used to rank the pool. */
  qualityScore: number;
}

export interface WesternSlotReservationDiagnostic {
  /** W2 candidates supplied BEFORE per-creator memory filter. */
  w2PoolPreFilter: number;
  /** Surviving W2 candidates AFTER memory filter. */
  w2PoolPostMemoryFilter: number;
  /** Number of W2 ideas inserted into the final batch. */
  w2Reserved: number;
  /** True when the activation guard short-circuited to identity. */
  shortCircuited: boolean;
  /** True when the helper produced a composed batch shorter than
   *  the upstream selectionBatch and fell back to identity. */
  shrunkFallback: boolean;
}

export interface WesternSlotReservationInput {
  selectionBatch: ScoredCandidate[];
  w2Candidates: ReadonlyArray<WesternPackCandidate>;
  desiredCount: number;
  region: Region | undefined;
  languageStyle: LanguageStyle | null | undefined;
  flagEnabled: boolean;
  packLength: number;
  /** Per-creator memory of W2 entry ids already shipped to this creator. */
  excludeEntryIds?: ReadonlySet<string>;
  /** Optional diagnostic sink — invoked once per call. */
  onDiagnostic?: (d: WesternSlotReservationDiagnostic) => void;
}

function normHook(h: string): string {
  return h
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,!?;:]+$/, "");
}

function w2EntryIdOf(c: ScoredCandidate): string | undefined {
  return (c.meta as { westernPackEntryId?: string }).westernPackEntryId;
}

export function applyWesternApprovedPackSlotReservation(
  input: WesternSlotReservationInput,
): ScoredCandidate[] {
  const {
    selectionBatch,
    w2Candidates,
    desiredCount,
    region,
    languageStyle,
    flagEnabled,
    packLength,
    excludeEntryIds,
    onDiagnostic,
  } = input;

  const emit = (d: WesternSlotReservationDiagnostic): void => {
    if (onDiagnostic) onDiagnostic(d);
  };

  // Activation guard — identical short-circuit to the helper module.
  if (
    !canActivateWesternApprovedPool({
      region,
      languageStyle,
      flagEnabled,
      packLength,
    })
  ) {
    emit({
      w2PoolPreFilter: 0,
      w2PoolPostMemoryFilter: 0,
      w2Reserved: 0,
      shortCircuited: true,
      shrunkFallback: false,
    });
    return selectionBatch;
  }
  if (desiredCount <= 0) return selectionBatch;

  const w2PoolPreFilter = w2Candidates.length;

  // Per-creator memory filter.
  let pool: WesternPackCandidate[] = excludeEntryIds && excludeEntryIds.size > 0
    ? w2Candidates.filter((w) => !excludeEntryIds.has(w.entryId))
    : w2Candidates.slice();

  // Drop anything whose entryId or normalized hook already collides
  // with an in-batch non-W2 candidate (extremely unlikely but
  // defensively cheap).
  const inBatchHooks = new Set<string>(
    selectionBatch.map((c) => normHook(c.idea.hook)),
  );
  const inBatchEntryIds = new Set<string>(
    selectionBatch
      .map((c) => w2EntryIdOf(c))
      .filter((id): id is string => typeof id === "string"),
  );
  pool = pool.filter(
    (w) => !inBatchEntryIds.has(w.entryId) &&
      !inBatchHooks.has(normHook(w.candidate.idea.hook)),
  );

  // Rank by qualityScore desc.
  pool.sort((a, b) => b.qualityScore - a.qualityScore);

  // Per-W2-pool dedup — same entryId + same hook can't ship twice.
  {
    const seenIds = new Set<string>();
    const seenHooks = new Set<string>();
    const dedup: WesternPackCandidate[] = [];
    for (const w of pool) {
      const hk = normHook(w.candidate.idea.hook);
      if (seenIds.has(w.entryId) || seenHooks.has(hk)) continue;
      seenIds.add(w.entryId);
      seenHooks.add(hk);
      dedup.push(w);
    }
    pool = dedup;
  }

  const w2PoolPostMemoryFilter = pool.length;

  if (pool.length === 0) {
    emit({
      w2PoolPreFilter,
      w2PoolPostMemoryFilter,
      w2Reserved: 0,
      shortCircuited: false,
      shrunkFallback: false,
    });
    return selectionBatch;
  }

  // Pick the top-1 W2 unconditionally.
  const reserved: WesternPackCandidate[] = [pool[0]!];

  // Cap the reserved count so we always keep ≥1 non-W2 slot when a
  // non-W2 exists — `maxReserved = min(2, pool.length, desiredCount-1)`.
  // When desiredCount === 1, maxReserved → 0 wins and we fall through
  // (no W2 inserted, since reserving would push out the only slot).
  const nonW2InBatch = selectionBatch.filter(
    (c) => w2EntryIdOf(c) === undefined,
  );
  const hasNonW2Available = nonW2InBatch.length > 0;
  const maxReserved = hasNonW2Available
    ? Math.min(2, pool.length, Math.max(0, desiredCount - 1))
    : Math.min(1, pool.length, desiredCount);

  if (maxReserved === 0) {
    emit({
      w2PoolPreFilter,
      w2PoolPostMemoryFilter,
      w2Reserved: 0,
      shortCircuited: false,
      shrunkFallback: false,
    });
    return selectionBatch;
  }

  // Try to add a 2nd W2 ONLY if highly distinct from the first.
  if (maxReserved >= 2 && pool.length >= 2) {
    const top = reserved[0]!;
    for (let i = 1; i < pool.length; i++) {
      const cand = pool[i]!;
      const distinctFamily = cand.comedyFamily !== top.comedyFamily;
      const distinctSetting = cand.setting !== top.setting;
      const distinctAnchor = cand.anchor !== top.anchor;
      if (distinctFamily && distinctSetting && distinctAnchor) {
        reserved.push(cand);
        break;
      }
    }
  }

  const reservedCandidates = reserved.map((w) => w.candidate);
  const reservedHooks = new Set<string>(
    reservedCandidates.map((c) => normHook(c.idea.hook)),
  );
  const reservedEntryIds = new Set<string>(reserved.map((w) => w.entryId));

  // Compose: reserved W2 first, then existing non-W2 (preserving
  // upstream order), then the leftover original W2 picks (if any).
  // Drop any selection-batch candidate whose hook or entryId collides
  // with a reserved one.
  const carriedNonW2 = selectionBatch.filter((c) => {
    if (reservedHooks.has(normHook(c.idea.hook))) return false;
    const id = w2EntryIdOf(c);
    if (id !== undefined && reservedEntryIds.has(id)) return false;
    return w2EntryIdOf(c) === undefined;
  });

  const carriedOriginalW2 = selectionBatch.filter((c) => {
    if (reservedHooks.has(normHook(c.idea.hook))) return false;
    const id = w2EntryIdOf(c);
    if (id !== undefined && reservedEntryIds.has(id)) return false;
    return w2EntryIdOf(c) !== undefined;
  });

  const composed: ScoredCandidate[] = [];
  const pickedHooks = new Set<string>();
  const pickedEntryIds = new Set<string>();

  const pushIfRoom = (c: ScoredCandidate): boolean => {
    if (composed.length >= desiredCount) return false;
    const hk = normHook(c.idea.hook);
    if (pickedHooks.has(hk)) return false;
    const id = w2EntryIdOf(c);
    if (id !== undefined && pickedEntryIds.has(id)) return false;
    composed.push(c);
    pickedHooks.add(hk);
    if (id !== undefined) pickedEntryIds.add(id);
    return true;
  };

  for (const c of reservedCandidates) pushIfRoom(c);
  for (const c of carriedNonW2) pushIfRoom(c);
  for (const c of carriedOriginalW2) pushIfRoom(c);

  // Never regress shipped count.
  if (composed.length < selectionBatch.length) {
    emit({
      w2PoolPreFilter,
      w2PoolPostMemoryFilter,
      w2Reserved: 0,
      shortCircuited: false,
      shrunkFallback: true,
    });
    return selectionBatch;
  }

  emit({
    w2PoolPreFilter,
    w2PoolPostMemoryFilter,
    w2Reserved: composed.filter(
      (c) => w2EntryIdOf(c) !== undefined &&
        reservedEntryIds.has(w2EntryIdOf(c)!),
    ).length,
    shortCircuited: false,
    shrunkFallback: false,
  });
  return composed;
}
