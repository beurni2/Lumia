/**
 * PHASE P16-A6-NG-CLEAN-SLOT1-MEMORY-ANTI-REPEAT (BI 2026-05-12) —
 * pure helper.
 *
 * Sibling of `applyNgCleanSlot0AntiRepeatSwap`. Where the slot-0
 * helper rotates ONE position (slot 0) within `final[]`, this helper
 * targets slots 1..N: for every position whose candidate is a
 * clean-core entry whose `cleanCoreEntryId` is in the creator's
 * recent slot-1+ memory, REPLACE it with a fresh clean-core entry
 * drawn from a supplied sidecar pool whose id is NOT in memory and
 * NOT already present in `final[]`.
 *
 * P16-A6 addendum §2 — suppression mechanism MUST be a post-rank
 * filter, not a score demotion. This helper:
 *   • does NOT modify `hookQualityScore`
 *   • does NOT apply score penalties
 *   • does NOT change scorer math
 *   • operates entirely on the post-rank `final` array + sidecar
 *
 * GRACEFUL RELAXATION (addendum §2): if the sidecar runs out of
 * fresh entries before every seen-id position has been replaced,
 * the helper STOPS swapping. The remaining seen-id positions keep
 * their original candidate. The result preserves length, never
 * under-fills.
 *
 * HARD CONTRACT
 *   1. SWAP-ONLY — preserves `final[]` length. Never appends, never
 *      removes; net candidate count is identical.
 *   2. Pure — does not mutate the input array. Returns a new array
 *      when swaps fire, otherwise returns the input reference.
 *   3. Slot 0 is NEVER directly written by this helper (the slot-0
 *      swap/corpus-feed has already finalised slot 0). The
 *      `slot0EntryId` parameter, if set, is treated as part of the
 *      "already-in-final" set so the helper cannot accidentally
 *      promote a sidecar entry that matches the freshly-finalised
 *      slot-0 entry id.
 *   4. Quality guard — sidecar candidates MUST be `pickerEligible`
 *      AND resolve to a `cleanCoreEntryId` against
 *      `NIGERIAN_CLEAN_CORE_ENTRIES`. Decorated /
 *      pattern-variation hooks resolve to `null` and are
 *      structurally ineligible.
 *   5. Distinct entry-id dedup: a `cleanCoreEntryId` already in
 *      `final[]` (or already chosen during this pass) is never
 *      reserved. Maximises distinct-leader surface for slot-1+.
 *   6. Activation-gated by the caller (region=nigeria,
 *      languageStyle=clean, non-empty creatorId, flag ON).
 *      Helper does NOT re-check; called only from the hybridIdeator
 *      activation block. Per addendum §3, this helper applies on
 *      BOTH cold-start AND regenerate flows.
 *   7. Deterministic. No process-global state, no random behaviour,
 *      no DB I/O, no async work.
 *
 * Comparison to `applyNgCleanFirstCardCoreReservation`:
 *   • Reservation fills `final[]` UP TO a target count of distinct
 *     clean-core entries. Trigger: `preCount < MIN`.
 *   • This filter REPLACES specific seen-id entries with fresh ones.
 *     Trigger: any slot-1+ position whose entry id is in memory.
 *   • Both are SWAP-ONLY post-rank operations consuming the same
 *     `localResult.kept`-derived sidecar pool, both preserve
 *     length, both gracefully degrade when sidecar is exhausted.
 *   • This filter runs AFTER the slot-0 swap/corpus-feed; the
 *     reservation runs BEFORE.
 *
 * Walk order: lowest index first (1, 2, 3, ...). This matches user
 * perception — earlier slots are higher-visibility, so prioritise
 * freshness there.
 */

import { resolveCleanCoreEntryIdByHook } from "./nigerianCleanCoreSlot0AntiRepeatSwap.js";

/** Env flag — staging-only. Production `[services.production.run.env]`
 *  does NOT set this. Default OFF preserves byte-identical behaviour
 *  for every cohort. */
export const NG_CLEAN_SLOT1PLUS_ANTI_REPEAT_FLAG_ENV =
  "LUMINA_NG_CLEAN_SLOT1PLUS_ANTI_REPEAT_ENABLED";

/** Cap on the number of slot-1+ replacements per call. Defensive
 *  ceiling: a typical batch has ≤ 6 slots and ≤ 5 slot-1+ clean-core
 *  entries, so 6 is the structural maximum. Set explicitly so a
 *  pathological future call cannot churn unbounded slots. */
export const MAX_SLOT1PLUS_REPLACEMENTS = 6;

export interface FilterCandidate {
  readonly idea: {
    readonly hook: string;
    readonly pickerEligible?: boolean;
  };
}

export interface NgCleanSlot1PlusAntiRepeatContext<T extends FilterCandidate> {
  /** Per-creator recent slot-1+ clean-core entry ids. Membership
   *  triggers a swap attempt for the matching slot. */
  readonly recentSlot1PlusCleanCoreEntryIds: ReadonlySet<string>;
  /** Pre-selection / post-rescore candidate pool (typically
   *  `localResult.kept`). Walk order is treated as rank order —
   *  earlier entries are higher-priority. The helper picks the
   *  highest-ranked sidecar entry whose `cleanCoreEntryId` is
   *  not in memory and not already in `final[]`. */
  readonly sidecarPool: ReadonlyArray<T>;
}

export interface SwapDetail {
  readonly atIndex: number;
  readonly fromCleanCoreEntryId: string;
  readonly toCleanCoreEntryId: string;
}

export interface NgCleanSlot1PlusAntiRepeatResult<T extends FilterCandidate> {
  readonly final: ReadonlyArray<T>;
  /** Number of slot-1+ positions actually replaced. */
  readonly swappedCount: number;
  /** Number of seen-id positions that could NOT be replaced because
   *  the sidecar ran out of fresh entries. Non-zero ⇒ relaxation
   *  fired. */
  readonly relaxedCount: number;
  /** entryIds the helper attempted to suppress (matched memory at
   *  slot ≥ 1). Includes both successfully-swapped and relaxed. */
  readonly suppressedEntryIds: ReadonlyArray<string>;
  /** entryIds inserted from the sidecar (newly added to `final[]`). */
  readonly insertedEntryIds: ReadonlyArray<string>;
  /** Per-swap details. */
  readonly swaps: ReadonlyArray<SwapDetail>;
}

/** Cheap singleton flag check — stays a single env-var read. */
export const isNgCleanSlot1PlusAntiRepeatEnabled = (): boolean =>
  process.env[NG_CLEAN_SLOT1PLUS_ANTI_REPEAT_FLAG_ENV] === "true";

/** Apply the slot-1+ anti-repeat filter. Pure helper — see
 *  contract above. */
export const applyNgCleanSlot1PlusAntiRepeatFilter = <T extends FilterCandidate>(
  final: ReadonlyArray<T>,
  ctx: NgCleanSlot1PlusAntiRepeatContext<T>,
): NgCleanSlot1PlusAntiRepeatResult<T> => {
  const noopResult = (): NgCleanSlot1PlusAntiRepeatResult<T> => ({
    final,
    swappedCount: 0,
    relaxedCount: 0,
    suppressedEntryIds: [],
    insertedEntryIds: [],
    swaps: [],
  });
  if (final.length < 2) return noopResult();
  if (ctx.recentSlot1PlusCleanCoreEntryIds.size === 0) return noopResult();

  // ---- Step 1: index final[] by cleanCoreEntryId. ----
  // Slot 0 is included so its id can never be promoted to a slot-1+
  // position by the sidecar pick (would create an in-batch duplicate).
  const finalEntryIdByIndex: Array<string | null> = new Array(final.length);
  const inFinalEntryIds = new Set<string>();
  for (let i = 0; i < final.length; i++) {
    const eid = resolveCleanCoreEntryIdByHook(final[i]!.idea.hook);
    finalEntryIdByIndex[i] = eid;
    if (eid !== null) inFinalEntryIds.add(eid);
  }

  // ---- Step 2: identify slot-1+ positions whose id is in memory. ----
  const seenSlot1PlusIndexes: number[] = [];
  for (let i = 1; i < final.length; i++) {
    const eid = finalEntryIdByIndex[i];
    if (eid === null) continue;
    if (ctx.recentSlot1PlusCleanCoreEntryIds.has(eid)) {
      seenSlot1PlusIndexes.push(i);
    }
  }
  if (seenSlot1PlusIndexes.length === 0) return noopResult();

  // ---- Step 3: build the fresh-sidecar pool. ----
  // Eligible iff: pickerEligible, resolves to clean-core, NOT in
  // recent memory, NOT already in final[]. Walk order = rank order.
  // Dedupe by cleanCoreEntryId so two sidecar items mapping to the
  // same id can't both be selected.
  const sidecarUsedEntryIds = new Set<string>();
  type SidecarPick = { cand: T; entryId: string };
  const sidecarPicks: SidecarPick[] = [];
  for (const c of ctx.sidecarPool) {
    if (sidecarPicks.length >= seenSlot1PlusIndexes.length) break;
    if (sidecarPicks.length >= MAX_SLOT1PLUS_REPLACEMENTS) break;
    if (c.idea.pickerEligible !== true) continue;
    const eid = resolveCleanCoreEntryIdByHook(c.idea.hook);
    if (eid === null) continue;
    if (ctx.recentSlot1PlusCleanCoreEntryIds.has(eid)) continue;
    if (inFinalEntryIds.has(eid)) continue;
    if (sidecarUsedEntryIds.has(eid)) continue;
    sidecarUsedEntryIds.add(eid);
    sidecarPicks.push({ cand: c, entryId: eid });
  }

  // ---- Step 4: build the swapped array. ----
  const swaps: SwapDetail[] = [];
  const suppressed: string[] = [];
  const inserted: string[] = [];
  let next: T[] | null = null;
  const swapBudget = Math.min(
    seenSlot1PlusIndexes.length,
    sidecarPicks.length,
    MAX_SLOT1PLUS_REPLACEMENTS,
  );
  for (let s = 0; s < swapBudget; s++) {
    const targetIdx = seenSlot1PlusIndexes[s]!;
    const pick = sidecarPicks[s]!;
    const fromEntryId = finalEntryIdByIndex[targetIdx]!;
    if (next === null) next = final.slice();
    next[targetIdx] = pick.cand;
    swaps.push({
      atIndex: targetIdx,
      fromCleanCoreEntryId: fromEntryId,
      toCleanCoreEntryId: pick.entryId,
    });
    suppressed.push(fromEntryId);
    inserted.push(pick.entryId);
  }

  // Account relaxation: every seen-id position past the swap budget
  // is left unchanged.
  const relaxedCount = seenSlot1PlusIndexes.length - swapBudget;
  for (let s = swapBudget; s < seenSlot1PlusIndexes.length; s++) {
    const targetIdx = seenSlot1PlusIndexes[s]!;
    suppressed.push(finalEntryIdByIndex[targetIdx]!);
  }

  if (next === null) {
    // No fresh sidecar entries available — all seen positions
    // relaxed. Telemetry still reports the suppressed ids so QA
    // can attribute the relaxation event.
    return {
      final,
      swappedCount: 0,
      relaxedCount,
      suppressedEntryIds: suppressed,
      insertedEntryIds: [],
      swaps: [],
    };
  }

  return {
    final: next,
    swappedCount: swaps.length,
    relaxedCount,
    suppressedEntryIds: suppressed,
    insertedEntryIds: inserted,
    swaps,
  };
};

/**
 * Convenience helper: extract the clean-core entry ids actually
 * shipped at slot 1+ of `final[]`. Caller uses this as the input to
 * `recordSlot1PlusCleanCoreEntryIds`. Skips slot 0, skips
 * non-clean-core, skips empty/duplicate ids.
 */
export const collectSlot1PlusCleanCoreEntryIds = <T extends FilterCandidate>(
  final: ReadonlyArray<T>,
): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = 1; i < final.length; i++) {
    const eid = resolveCleanCoreEntryIdByHook(final[i]!.idea.hook);
    if (eid === null) continue;
    if (seen.has(eid)) continue;
    seen.add(eid);
    out.push(eid);
  }
  return out;
};
