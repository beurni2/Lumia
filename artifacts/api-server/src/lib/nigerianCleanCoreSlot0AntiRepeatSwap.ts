/**
 * PHASE N1-FOLLOWUP-NG-CLEAN-SLOT0-ANTI-REPEAT-SWAP — pure helper.
 *
 * Surface-check verdict (`.local/N1_FOLLOWUP_NG_CLEAN_SLOT0_SURFACE_
 * CHECK_REPORT.md`): across 10/10 ng_clean cold-start batches the
 * post-sort/post-rotation `final` stream contains a `pickerEligible`
 * clean-core alternative to the slot-0 winner. The slot-0
 * monoculture is therefore a SELECTION-stage problem, not a
 * surfacing problem — the right intervention is a narrow,
 * memory-driven swap that rotates slot 0 away from a recently-
 * shipped clean-core entry to the highest-ranked eligible
 * clean-core alternative already present in the final list.
 *
 * Hard contract:
 *   1. SWAP-ONLY — preserves candidate identity set + count.
 *      Never drops, never appends, never reaches outside `final`.
 *   2. Pure helper — does not mutate the input array. Returns a
 *      new array (or the same reference when no swap fires).
 *   3. Activation-gated — non-ng_clean cohorts and non-cold-start
 *      requests skip the helper entirely (caller responsibility).
 *   4. Quality guard — alternative MUST be `pickerEligible` AND
 *      resolve to a `cleanCoreEntryId` against
 *      `NIGERIAN_CLEAN_CORE_ENTRIES`. `pattern_variation` /
 *      non-clean-core / non-eligible candidates can never replace
 *      slot 0 under this rule.
 *   5. Deterministic — same `final` + same `recentMemory` ⇒ same
 *      result. Picks the LOWEST-RANK (highest-ranked) eligible
 *      alternative not in recent memory.
 *   6. Cohort isolation — entry-id resolution is via
 *     `NIGERIAN_CLEAN_CORE_ENTRIES`, which is itself the activated-
 *      cohort surface; non-ng_clean candidates are intrinsically
 *      unresolvable here, so even if a caller forgot the gate the
 *      helper is a no-op outside the cohort.
 *   7. No process-global state, no random behaviour, no DB I/O.
 *
 * Note on entry-id resolution: the upstream `coreCandidateGenerator`
 * sets `cleanCoreEntryId` on its LOCAL `passing[]` array but does
 * NOT thread the field into `CandidateMeta` (audited at
 * `coreCandidateGenerator.ts` L1041, L1255, L1709). To keep this
 * helper additive (no `CandidateMeta` widening, no broad selector
 * rewrite) we resolve entry id by hook-text lookup against the
 * canonical `NIGERIAN_CLEAN_CORE_ENTRIES` export. The surface-check
 * audit (`.local/qa-runs/n1_ng_clean_slot0_surface_check.json`)
 * verified this lookup correctly resolves both `ng_clean_001` and
 * `ng_clean_039` in 10/10 cold-start batches at this exact post-
 * rotation point in the pipeline. Lookups against decorated /
 * non-matching hooks return `null`, which the helper treats as
 * "not clean-core" ⇒ ineligible for swap.
 */

import { NIGERIAN_CLEAN_CORE_ENTRIES } from "./nigerianCleanCorePack.js";

/** Minimal candidate shape this helper requires. */
export interface SwapCandidate {
  readonly idea: { readonly hook: string; readonly pickerEligible?: boolean };
}

export interface NgCleanSlot0AntiRepeatContext {
  /**
   * Recent slot-0 `cleanCoreEntryId`s for THIS creator. Membership
   * is the swap trigger: if `final[0]` resolves to a `cleanCoreEntryId`
   * present in this set, the helper attempts to find an alternative
   * whose id is NOT in the set.
   */
  readonly recentSlot0CleanCoreEntryIds: ReadonlySet<string>;
}

export interface SwapDetail {
  readonly fromCleanCoreEntryId: string;
  readonly toCleanCoreEntryId: string;
  /** Original index of the alternative inside `final` (always ≥ 1). */
  readonly fromIndex: number;
}

export interface NgCleanSlot0AntiRepeatResult<T extends SwapCandidate> {
  readonly final: ReadonlyArray<T>;
  readonly swapped: boolean;
  readonly detail: SwapDetail | null;
}

/** Build the hook→cleanCoreEntryId resolver once, at module load. */
const CLEAN_CORE_HOOK_INDEX: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const e of NIGERIAN_CLEAN_CORE_ENTRIES) {
    m.set(e.hook.toLowerCase().trim(), e.id);
  }
  return m;
})();

/**
 * Resolve a candidate hook to its `cleanCoreEntryId`.
 *
 * STRICT NORMALIZED-EQUALITY ONLY. We deliberately do NOT do
 * substring / startsWith matching here: the helper's safety
 * contract requires that a non-clean-core hook can NEVER be
 * promoted to slot 0, and any substring fallback would let a
 * decorated / pattern-variation candidate whose hook text happens
 * to contain a clean-core hook resolve to a clean-core id and
 * become swap-eligible. Surface-check audit (`.local/qa-runs/
 * n1_ng_clean_slot0_surface_check.json`) confirms direct
 * normalized equality resolves 100% of legitimate clean-core
 * candidates at this exact pipeline point — the substring
 * fallback was strictly speculative and is removed.
 *
 * Normalization: lowercase + trim. (Both sides indexed identically
 * at module load.) Returns `null` for any hook not present in
 * `NIGERIAN_CLEAN_CORE_ENTRIES`.
 */
export const resolveCleanCoreEntryIdByHook = (
  hook: string | undefined,
): string | null => {
  if (typeof hook !== "string") return null;
  const norm = hook.toLowerCase().trim();
  if (norm.length === 0) return null;
  return CLEAN_CORE_HOOK_INDEX.get(norm) ?? null;
};

/**
 * Apply the slot-0 anti-repeat / swap. Pure: returns a new array
 * when a swap fires, otherwise returns the input reference
 * unchanged. The candidate identity set and count are always
 * preserved.
 *
 * Caller MUST have already verified the activation gate
 * (`region === "nigeria"`, `languageStyle === "clean"`,
 * `regenerate === false`, non-empty `creatorId`). This helper does
 * NOT re-check those — it only enforces the candidate-side guards
 * (slot-0 must be clean-core, must be in recent memory, alternative
 * must be `pickerEligible` clean-core not in recent memory).
 */
export const applyNgCleanSlot0AntiRepeatSwap = <T extends SwapCandidate>(
  final: ReadonlyArray<T>,
  ctx: NgCleanSlot0AntiRepeatContext,
): NgCleanSlot0AntiRepeatResult<T> => {
  if (final.length < 2) {
    return { final, swapped: false, detail: null };
  }
  const slot0 = final[0]!;
  const slot0EntryId = resolveCleanCoreEntryIdByHook(slot0.idea.hook);
  // Slot-0 isn't clean-core ⇒ this rule does not apply.
  if (slot0EntryId === null) {
    return { final, swapped: false, detail: null };
  }
  // Slot-0's entry id isn't recent ⇒ no swap (first occurrence
  // for this creator OR this entry id has aged out of the cap).
  if (!ctx.recentSlot0CleanCoreEntryIds.has(slot0EntryId)) {
    return { final, swapped: false, detail: null };
  }
  // Walk in current rank order so we pick the HIGHEST-ranked
  // (lowest index ≥ 1) eligible alternative. This is the rank
  // already produced by `annotateAndSortByWillingness` +
  // `applyFirstCardQualityBandRotation` +
  // `applyCreatorSeededRankRotation` — the swap respects that
  // ranking by promoting the best available alt that satisfies
  // the freshness constraint.
  for (let i = 1; i < final.length; i++) {
    const cand = final[i]!;
    if (cand.idea.pickerEligible !== true) continue;
    const altId = resolveCleanCoreEntryIdByHook(cand.idea.hook);
    if (altId === null) continue; // not clean-core ⇒ ineligible
    if (altId === slot0EntryId) continue; // same entry ⇒ no rotation
    if (ctx.recentSlot0CleanCoreEntryIds.has(altId)) continue; // also recent ⇒ skip
    // Build the swapped array WITHOUT mutating `final`. Slot 0
    // becomes the alt; the old slot-0 takes the alt's previous
    // index. All other positions are preserved.
    const next: T[] = final.slice();
    next[0] = cand;
    next[i] = slot0;
    return {
      final: next,
      swapped: true,
      detail: {
        fromCleanCoreEntryId: slot0EntryId,
        toCleanCoreEntryId: altId,
        fromIndex: i,
      },
    };
  }
  // No eligible alternative ⇒ keep original slot 0 unchanged.
  return { final, swapped: false, detail: null };
};
