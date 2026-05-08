/**
 * PHASE W2-K — Western APPROVED pack slot reservation.
 * PHASE W2-K2 — memory-aware selection with soft diversity penalties.
 *
 * Reorders the final shipped batch to prefer up to 2 W2 ideas per
 * batch, keeping ≥1 non-W2 slot. Runs AFTER
 * `applyNigerianPackSlotReservation` and AFTER the catalog skeleton
 * swap, so the upstream selection / hero / taste / NG composition
 * remain authoritative for the non-reserved positions.
 *
 * W2-K2 selection algorithm (no validator changes):
 *   1. HARD prefilter pool by per-creator memory:
 *        drop entries whose entryId / normalized hook / hook
 *        skeleton appears in the recent-seen sets.
 *   2. SOFT score adjustment per pool entry:
 *        adjusted = qualityScore
 *                 - (anchor seen ?  2.0 : 0)
 *                 - (family seen ?  1.0 : 0)
 *                 - (setting seen ? 0.5 : 0)
 *                 - (spike seen   ? 0.5 : 0)
 *        — rotates picker pressure toward underused dimensions.
 *   3. Drop in-batch collisions (entryId / normalized hook).
 *   4. Per-pool dedup (entryId + normalized hook + skeleton).
 *   5. Sort by adjusted score desc; pick top-1 unconditionally.
 *   6. Try a second W2: REQUIRE entryId + normalized hook +
 *      skeleton + anchor distinct from top; PREFER family + spike
 *      + setting also distinct (skip otherwise — fall back to
 *      1 W2 + 2 non-W2 instead of forcing a near-duplicate).
 *   7. Compose final batch: reserved W2 first, then existing
 *      non-W2 (preserving upstream order), then leftover W2 picks.
 *      Cap at desiredCount; never shrink below selectionBatch.length.
 *
 * Hard rules:
 *   • Activation guard short-circuits to identity for every cohort
 *     other than (region∈{undefined,"western"} +
 *     languageStyle∈{undefined,null,"clean"} + flag ON + non-empty
 *     pool). NG / India / PH cohorts return `selectionBatch`
 *     unchanged.
 *   • Always preserve ≥1 non-W2 slot when a non-W2 candidate is
 *     available — `maxReserved = min(2, w2Pool.length, desiredCount-1)`.
 *   • Composed batch never exceeds `desiredCount`.
 *   • Composed batch length never falls below `selectionBatch.length`
 *     — never regress shipped count.
 *   • Per-batch dedup: no two slots share a `westernPackEntryId`,
 *     and no two slots share a normalized hook.
 *   • No score boost is applied to the candidate's `score`; soft
 *     adjustments are LOCAL ranking signal only and never mutate
 *     the candidate's `meta` or its `score.total`.
 */

import type { ScoredCandidate } from "./ideaScorer.js";
import type { Region } from "@workspace/lumina-trends";
import type { LanguageStyle } from "./tasteCalibration.js";
import {
  APPROVED_WESTERN_PROMOTION_CANDIDATES,
  canActivateWesternApprovedPool,
  getEligibleWesternApprovedEntries,
  isWesternApprovedPoolFeatureEnabled,
} from "./westernHookPackApproved.js";
import {
  WESTERN_HOOK_PACK_LIVE,
  canActivateWesternLivePool,
  getEligibleWesternLiveEntries,
  isWesternLivePoolFeatureEnabled,
} from "./westernHookPackLive.js";
import type { WesternHookPackDraftEntry } from "./westernHookPack.js";

/** Telemetry / classification metadata required for the distinctness check. */
export interface WesternPackCandidate {
  candidate: ScoredCandidate;
  entryId: string;
  comedyFamily: string;
  setting: string;
  anchor: string;
  /** PHASE W2-K2 — emotional spike + skeleton tags for soft / hard
   *  diversity gates. Hook skeleton is the
   *  `normalizeWesternHookSkeleton(entry.hook)` value. */
  emotionalSpike: string;
  hookSkeleton: string;
  /** PHASE W2-R — `idea.hookStyle` (HookStyle enum from `ideaGen`,
   *  e.g. `internal_thought`, `curiosity`, `why_do_i`, `contrast`).
   *  Distinct from `entry.hookStyle` (WesternBatchHookStyle, narrower
   *  authoring vocabulary). Consumed by the W2-R soft penalty to
   *  rotate hookStyle pressure across consecutive batches. Required
   *  (non-optional) because every authored W2 idea has it set by
   *  `pickHookStyle` in `westernPackAuthor`. */
  hookStyle: string;
  /** PHASE W2-R-FIX1 (Path C) — OPTIONAL curated W2-pack hook-style
   *  (`WesternBatchHookStyle`, 10 values). Populated only for W2-
   *  authored candidates from `entry.hookStyle`. Distinct from
   *  `hookStyle` above (which is the 5-value `HookStyle` shape
   *  classifier from `pickHookStyle()`). The W2-R soft penalty
   *  reads `westernHookStyle ?? hookStyle` so curated granularity
   *  is preserved end-to-end. Optional — non-W2 paths cannot reach
   *  this struct, but the field is typed optional defensively. */
  westernHookStyle?: string;
  /** Higher is better. Used to rank the pool. */
  qualityScore: number;
}

/** PHASE W2-K2 — full per-creator recent-axes snapshot. Mirrors
 *  `WesternRecentAxes` from `westernPackCreatorMemory`; redeclared
 *  here as a structural type to keep this module dependency-free
 *  on the memory module (avoids a cycle). */
export interface WesternExcludeAxes {
  entryIds: ReadonlySet<string>;
  hooks: ReadonlySet<string>;
  skeletons: ReadonlySet<string>;
  anchors: ReadonlySet<string>;
  families: ReadonlySet<string>;
  spikes: ReadonlySet<string>;
  settings: ReadonlySet<string>;
  /** PHASE W2-R — recent `idea.hookStyle` values for this creator.
   *  Soft penalty only; never a hard reject. */
  hookStyles: ReadonlySet<string>;
}

const EMPTY_AXES: WesternExcludeAxes = {
  entryIds: new Set(),
  hooks: new Set(),
  skeletons: new Set(),
  anchors: new Set(),
  families: new Set(),
  spikes: new Set(),
  settings: new Set(),
  hookStyles: new Set(),
};

export interface WesternSlotReservationDiagnostic {
  /** W2 candidates supplied BEFORE per-creator memory filter. */
  w2PoolPreFilter: number;
  /** Surviving W2 candidates AFTER memory hard-prefilter. */
  w2PoolPostMemoryFilter: number;
  /** Number of W2 ideas inserted into the final batch. */
  w2Reserved: number;
  /** True when the activation guard short-circuited to identity. */
  shortCircuited: boolean;
  /** True when the helper produced a composed batch shorter than
   *  the upstream selectionBatch and fell back to identity. */
  shrunkFallback: boolean;
  /** PHASE W2-K2 — count of pool entries dropped per hard-skip
   *  axis (debug / QA-only — sums may exceed dropped-count when
   *  one entry collides on multiple axes). */
  droppedByEntryId: number;
  droppedByHook: number;
  droppedBySkeleton: number;
  /** PHASE W2-K2 — true when a 2nd-W2 candidate was found in the
   *  pool but rejected by the strict distinctness gate (so a
   *  1-W2 + 2-non-W2 batch shipped instead of forcing a near-dup). */
  secondW2RejectedForDistinctness: boolean;
}

export interface WesternSlotReservationInput {
  selectionBatch: ScoredCandidate[];
  w2Candidates: ReadonlyArray<WesternPackCandidate>;
  desiredCount: number;
  region: Region | undefined;
  languageStyle: LanguageStyle | null | undefined;
  flagEnabled: boolean;
  packLength: number;
  /** PHASE W2-K2 — full per-creator recent-axes snapshot. Optional;
   *  defaults to all-empty Sets (cold-start creator behavior). */
  excludeAxes?: WesternExcludeAxes;
  /** PHASE W2-QA-FIX-1 (Task A) — creator id, used ONLY for the
   *  cold-start first-impression deterministic quality-band rotation.
   *  When set AND `excludeAxes` is structurally empty (no recent
   *  history => "first batch"-like), the top-1 W2 pick rotates
   *  across the quality band instead of always selecting `pool[0]`,
   *  so 10 fresh creators don't all see the same opener. Behaviour
   *  is otherwise UNCHANGED — refresh batches (non-empty axes), all
   *  non-Western cohorts, and missing-creatorId paths take the
   *  pre-Fix-1 deterministic `pool[0]` path. */
  creatorId?: string;
  /** Optional diagnostic sink — invoked once per call. */
  onDiagnostic?: (d: WesternSlotReservationDiagnostic) => void;
}

// ---------------------------------------------------------------- //
// PHASE W2-QA-FIX-1 (Task A) — first-impression deterministic       //
// quality-band rotation.                                            //
//                                                                    //
// W2-QA-AUDIT (`.local/W2QA_AUDIT_REPORT.md`) proved that on cold-  //
// start (no per-creator recent-axes memory), `pool[0]!` was picked  //
// unconditionally — so 10 fresh creators got the SAME first idea    //
// 100% of the time even though several runner-up entries had        //
// indistinguishable adjusted scores. The fix is purely deterministic //
// and additive: when `creatorId` is provided AND the axes are       //
// structurally empty, we build the band of pool entries within K    //
// quality points of the leader and pick `band[fnv1a(creatorId) %    //
// band.length]`. K=5 keeps the band tight to the leader so we never //
// rotate down into materially-weaker candidates; per-batch          //
// determinism is preserved (same creator + same pool ⇒ same pick).  //
// On refresh batches (excludeAxes non-empty) the function takes the //
// pre-Fix-1 deterministic `pool[0]` path verbatim — soft penalties  //
// and hard memory filters above this point already disambiguate.    //
// ---------------------------------------------------------------- //

/** Quality-band tolerance in raw qualityScore points (after soft
 *  penalty adjustment). Tight enough that band members are
 *  effectively quality-equivalent — never rotates to a materially
 *  weaker candidate. */
export const W2_FIRST_IMPRESSION_QUALITY_BAND_K = 5;

/** Pure FNV-1a 32-bit hash over a UTF-16 string. Deterministic,
 *  no allocations beyond the loop counter. We only need
 *  `result % bandSize` so the 32-bit truncation collisions don't
 *  matter for selection fairness. */
function fnv1aHash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // 32-bit FNV prime multiplication via shift-add ladder.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** Returns true when every axis Set is empty — indistinguishable
 *  from the demo creator's structural cold-start state and from any
 *  real creator's first idea batch. The DB envelope readers in
 *  `westernPackCreatorMemory.ts` return all-empty Sets when the
 *  envelope is missing or empty, so this check intentionally treats
 *  both "no envelope" and "empty envelope" the same way. */
function isAxesStructurallyEmpty(axes: WesternExcludeAxes): boolean {
  return (
    axes.entryIds.size === 0 &&
    axes.hooks.size === 0 &&
    axes.skeletons.size === 0 &&
    axes.anchors.size === 0 &&
    axes.families.size === 0 &&
    axes.spikes.size === 0 &&
    axes.settings.size === 0 &&
    axes.hookStyles.size === 0
  );
}

/** Pick the cold-start first-impression winner from the post-soft-
 *  penalty `pool`. Caller must have verified `pool.length >= 1`.
 *
 *  The band is `pool[i]` such that `pool[i].qualityScore >=
 *  pool[0].qualityScore - K` (raw, NOT adjusted, because the
 *  caller's `adjusted` mapping has already discarded its scores by
 *  the time this is reached — and on cold-start every soft penalty
 *  is zero anyway since `axes` is empty, so adjusted === raw here).
 *  The band always contains at least `pool[0]` (size>=1).
 *
 *  Walk the contiguous prefix that meets the band tolerance — `pool`
 *  is sorted desc by `qualityScore` at the call site, so a single
 *  scan with an early break is sufficient. */
export function pickFirstImpressionWinnerForTesting(
  pool: ReadonlyArray<WesternPackCandidate>,
  creatorId: string,
  k: number = W2_FIRST_IMPRESSION_QUALITY_BAND_K,
): WesternPackCandidate {
  if (pool.length === 0) {
    throw new Error(
      "[w2.first_impression] pool must contain >=1 candidate",
    );
  }
  const leader = pool[0]!;
  const floor = leader.qualityScore - k;
  let bandSize = 1;
  for (let i = 1; i < pool.length; i++) {
    if (pool[i]!.qualityScore >= floor) bandSize++;
    else break;
  }
  const idx = fnv1aHash32(creatorId) % bandSize;
  return pool[idx]!;
}

// ---------------------------------------------------------------- //
// PHASE W2-O — Active-pool resolver + activation mutex.              //
//                                                                    //
// Two independent staging-only env flags now gate the Western pack:  //
//   • LUMINA_W2_WESTERN_APPROVED_ENABLED — staging pool (300 entries //
//     all PENDING_EDITORIAL_REVIEW, no real editorial gate).          //
//   • LUMINA_W2_WESTERN_LIVE_ENABLED      — editor-signed live pool   //
//     (W2-O rubric-derived; reviewedBy = WESTERN_LIVE_PROMOTION_SIGNOFF). //
//                                                                    //
// Resolution rule (mutex at activation site):                        //
//   1. If LIVE flag is ON and the live-pool guard passes → LIVE.     //
//      (`bothFlagsOn` is reported back so the caller can emit a      //
//      loud warning when APPROVED is also ON — the live pool wins   //
//      to preserve the editor-signed bar.)                           //
//   2. Else if APPROVED flag is ON and the staging guard passes →    //
//      APPROVED.                                                     //
//   3. Else → no active pool (caller short-circuits W2-K reservation).//
//                                                                    //
// Both guards are individually identical to the W2-K activation      //
// guard (region∈{undef,"western"} + lang∈{undef,null,"clean"} +      //
// flag ON + pool non-empty), so NG / IN / PH cohorts are excluded   //
// from BOTH pools by the same axes.                                  //
// ---------------------------------------------------------------- //

export type ActiveWesternPoolSource = "live" | "approved" | "none";

export interface ActiveWesternPoolInput {
  region: Region | undefined;
  languageStyle: LanguageStyle | null | undefined;
  /** Read of `LUMINA_W2_WESTERN_APPROVED_ENABLED`. Optional — defaults
   *  to `isWesternApprovedPoolFeatureEnabled()`. */
  approvedFlagEnabled?: boolean;
  /** Read of `LUMINA_W2_WESTERN_LIVE_ENABLED`. Optional — defaults
   *  to `isWesternLivePoolFeatureEnabled()`. */
  liveFlagEnabled?: boolean;
}

export interface ActiveWesternPoolResolution {
  /** Which pool the caller should source candidates from. `"none"`
   *  means no W2 reservation should run (cohort-mismatch or both
   *  flags OFF). */
  readonly source: ActiveWesternPoolSource;
  /** The eligible entries for the resolved pool, returned in the
   *  shape `WesternHookPackDraftEntry[]` so the existing W2-K author
   *  + slot-reservation chain can consume them without branching. */
  readonly entries: readonly WesternHookPackDraftEntry[];
  /** The full pool length (used by `applyWesternApprovedPackSlotReservation`'s
   *  `packLength` activation arg). */
  readonly packLength: number;
  /** True when both `LUMINA_W2_WESTERN_APPROVED_ENABLED` and
   *  `LUMINA_W2_WESTERN_LIVE_ENABLED` are ON. The caller should emit
   *  a loud warning log in this case (live wins). */
  readonly bothFlagsOn: boolean;
  /** Echo of the resolved approved/live flag values at decision time
   *  for telemetry. */
  readonly approvedFlagEnabled: boolean;
  readonly liveFlagEnabled: boolean;
}

/**
 * Resolve which Western pool is active for the current request.
 * Pure function over the four inputs (region / languageStyle +
 * the two flag values). When both flags are ON the live pool wins
 * — `bothFlagsOn` is set so the caller can emit a loud warning.
 */
export function getActiveWesternPool(
  input: ActiveWesternPoolInput,
): ActiveWesternPoolResolution {
  const approvedFlagEnabled =
    input.approvedFlagEnabled ?? isWesternApprovedPoolFeatureEnabled();
  const liveFlagEnabled =
    input.liveFlagEnabled ?? isWesternLivePoolFeatureEnabled();
  const bothFlagsOn = approvedFlagEnabled && liveFlagEnabled;

  // 1. Prefer LIVE when its flag is ON and its guard passes.
  if (
    canActivateWesternLivePool({
      region: input.region,
      languageStyle: input.languageStyle,
      flagEnabled: liveFlagEnabled,
      packLength: WESTERN_HOOK_PACK_LIVE.length,
    })
  ) {
    return {
      source: "live",
      entries: getEligibleWesternLiveEntries({
        region: input.region,
        languageStyle: input.languageStyle,
        flagEnabled: liveFlagEnabled,
        packLength: WESTERN_HOOK_PACK_LIVE.length,
      }),
      packLength: WESTERN_HOOK_PACK_LIVE.length,
      bothFlagsOn,
      approvedFlagEnabled,
      liveFlagEnabled,
    };
  }

  // 2. Fall back to APPROVED.
  if (
    canActivateWesternApprovedPool({
      region: input.region,
      languageStyle: input.languageStyle,
      flagEnabled: approvedFlagEnabled,
      packLength: APPROVED_WESTERN_PROMOTION_CANDIDATES.length,
    })
  ) {
    return {
      source: "approved",
      entries: getEligibleWesternApprovedEntries({
        region: input.region,
        languageStyle: input.languageStyle,
        flagEnabled: approvedFlagEnabled,
        packLength: APPROVED_WESTERN_PROMOTION_CANDIDATES.length,
      }),
      packLength: APPROVED_WESTERN_PROMOTION_CANDIDATES.length,
      bothFlagsOn,
      approvedFlagEnabled,
      liveFlagEnabled,
    };
  }

  return {
    source: "none",
    entries: [],
    packLength: 0,
    bothFlagsOn,
    approvedFlagEnabled,
    liveFlagEnabled,
  };
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

/** Score adjustment magnitudes — see file-header algorithm step 2.
 *  Constants exported so QA can reproduce ranking offline.
 *
 *  PHASE W2-R: `setting` bumped 0.5 → 1.0 and `hookStyle: 1.0` added
 *  to address the measured `desk/couch/kitchen/bed` setting
 *  concentration and the dominant `internal_thought` hookStyle
 *  collapse (94.6% of all W2 ideas at baseline). Both are SOFT
 *  penalties only — no hard ban, validators unchanged, the strongest
 *  candidate can still win when alternatives are weak.
 *
 *  PHASE W2-R-A2 (sensitivity probe): `hookStyle` weight is read from
 *  the `LUMINA_W2_HOOKSTYLE_PENALTY` env var when set (parsed as a
 *  finite non-negative number ≤100). When unset / unparseable / out
 *  of range, falls back to the W2-R default of 1.0. Env-override is
 *  resolved once at module load so behavior remains deterministic
 *  across requests within a process. The override exists ONLY for
 *  the offline sensitivity-probe sweep — production toml does not
 *  set this var, so production behavior is byte-identical to W2-R. */
export const W2_HOOK_STYLE_PENALTY_DEFAULT = 1.0;
/** Exported for unit tests so we can verify env parsing without
 *  module-reload acrobatics. Production code path goes through the
 *  module-load-time `W2K2_SOFT_PENALTY.hookStyle` constant below. */
export function resolveHookStylePenaltyFromEnv(
  raw: string | undefined = process.env.LUMINA_W2_HOOKSTYLE_PENALTY,
): number {
  if (raw === undefined || raw === "") return W2_HOOK_STYLE_PENALTY_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    return W2_HOOK_STYLE_PENALTY_DEFAULT;
  }
  return n;
}
export const W2K2_SOFT_PENALTY = {
  anchor: 2.0,
  family: 1.0,
  setting: 1.0,
  spike: 0.5,
  hookStyle: resolveHookStylePenaltyFromEnv(),
} as const;

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
    excludeAxes,
    creatorId,
    onDiagnostic,
  } = input;

  const axes: WesternExcludeAxes = excludeAxes ?? EMPTY_AXES;

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
      droppedByEntryId: 0,
      droppedByHook: 0,
      droppedBySkeleton: 0,
      secondW2RejectedForDistinctness: false,
    });
    return selectionBatch;
  }
  if (desiredCount <= 0) return selectionBatch;

  const w2PoolPreFilter = w2Candidates.length;

  // PHASE W2-K2 — HARD memory prefilter on entryId / hook / skeleton.
  let droppedByEntryId = 0;
  let droppedByHook = 0;
  let droppedBySkeleton = 0;
  let pool: WesternPackCandidate[] = [];
  for (const w of w2Candidates) {
    if (axes.entryIds.has(w.entryId)) {
      droppedByEntryId++;
      continue;
    }
    const hk = normHook(w.candidate.idea.hook);
    if (axes.hooks.has(hk)) {
      droppedByHook++;
      continue;
    }
    if (axes.skeletons.has(w.hookSkeleton)) {
      droppedBySkeleton++;
      continue;
    }
    pool.push(w);
  }

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

  // Per-pool dedup — same entryId + same hook + same skeleton can't
  // ship twice from the in-pool ranking.
  {
    const seenIds = new Set<string>();
    const seenHooks = new Set<string>();
    const seenSkeletons = new Set<string>();
    const dedup: WesternPackCandidate[] = [];
    for (const w of pool) {
      const hk = normHook(w.candidate.idea.hook);
      if (seenIds.has(w.entryId) || seenHooks.has(hk) ||
          seenSkeletons.has(w.hookSkeleton)) continue;
      seenIds.add(w.entryId);
      seenHooks.add(hk);
      seenSkeletons.add(w.hookSkeleton);
      dedup.push(w);
    }
    pool = dedup;
  }

  // PHASE W2-K2 — apply soft diversity penalties to ranking signal.
  // Sort by ADJUSTED score desc; ties broken by raw qualityScore desc.
  const adjusted = pool.map((w) => {
    let pen = 0;
    if (axes.anchors.has(w.anchor.toLowerCase()))
      pen += W2K2_SOFT_PENALTY.anchor;
    if (axes.families.has(w.comedyFamily))
      pen += W2K2_SOFT_PENALTY.family;
    if (axes.settings.has(w.setting))
      pen += W2K2_SOFT_PENALTY.setting;
    if (axes.spikes.has(w.emotionalSpike))
      pen += W2K2_SOFT_PENALTY.spike;
    // PHASE W2-R — soft penalty for repeating the creator's recent
    // hookStyle. Light enough that a strong candidate can still win
    // when no alternative exists; deterministic.
    //
    // PHASE W2-R-FIX1 (Path C): effective style key prefers the
    // curated 10-value `westernHookStyle` (set by W2 author from
    // `entry.hookStyle`) over the 5-value `hookStyle` shape
    // classifier. The recent-axes set (`axes.hookStyles`) is fed
    // by `recordW2InMemorySeen` with the SAME effective key
    // (hybridIdeator passes `westernHookStyle ?? hookStyle`), so
    // both sides of this membership check use the same vocabulary
    // for any given W2 idea. Non-W2 candidates have no
    // `westernHookStyle` and fall back to the legacy 5-value path
    // — pre-Path-C behaviour preserved exactly.
    const effectiveHookStyle = w.westernHookStyle ?? w.hookStyle;
    if (effectiveHookStyle && axes.hookStyles.has(effectiveHookStyle))
      pen += W2K2_SOFT_PENALTY.hookStyle;
    return { w, adjusted: w.qualityScore - pen };
  });
  adjusted.sort((a, b) =>
    b.adjusted - a.adjusted || b.w.qualityScore - a.w.qualityScore,
  );
  pool = adjusted.map((a) => a.w);

  const w2PoolPostMemoryFilter = pool.length;

  if (pool.length === 0) {
    emit({
      w2PoolPreFilter,
      w2PoolPostMemoryFilter,
      w2Reserved: 0,
      shortCircuited: false,
      shrunkFallback: false,
      droppedByEntryId,
      droppedByHook,
      droppedBySkeleton,
      secondW2RejectedForDistinctness: false,
    });
    return selectionBatch;
  }

  // PHASE W2-QA-FIX-1 (Task A) — first-impression deterministic
  // quality-band rotation on cold-start. See JSDoc above
  // `W2_FIRST_IMPRESSION_QUALITY_BAND_K` for the audit context.
  // On any refresh batch (axes non-empty) OR when `creatorId` is not
  // supplied (legacy callers / tests / unit fixtures) we take the
  // pre-Fix-1 `pool[0]!` path verbatim — preserving every existing
  // test expectation and the deterministic refresh-axis penalty
  // ordering proven in W2-R / W2-K2.
  const useFirstImpressionRotation =
    typeof creatorId === "string" &&
    creatorId.length > 0 &&
    isAxesStructurallyEmpty(axes);
  const firstW2 = useFirstImpressionRotation
    ? pickFirstImpressionWinnerForTesting(pool, creatorId)
    : pool[0]!;
  const reserved: WesternPackCandidate[] = [firstW2];

  // Cap the reserved count so we always keep ≥1 non-W2 slot when a
  // non-W2 exists — `maxReserved = min(2, pool.length, desiredCount-1)`.
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
      droppedByEntryId,
      droppedByHook,
      droppedBySkeleton,
      secondW2RejectedForDistinctness: false,
    });
    return selectionBatch;
  }

  // PHASE W2-K2 — Try to add a 2nd W2 ONLY if STRICTLY distinct.
  // REQUIRE entryId + normalized hook + skeleton + anchor distinct;
  // PREFER family + spike + setting distinct (skip otherwise so we
  // ship 1 W2 + 2 non-W2 rather than a near-duplicate W2 pair).
  //
  // PHASE W2-QA-FIX-1 (Task A) — when first-impression rotation
  // selected a non-zero pool index for slot-1, the runner-up walk
  // starts from i=0 and SKIPS the chosen index so the same entry
  // can't be reserved twice. The post-loop entryId distinctness
  // gate would already reject a same-entry duplicate, but iterating
  // from 0 still finds the next-best truly-distinct alternative.
  let secondW2RejectedForDistinctness = false;
  if (maxReserved >= 2 && pool.length >= 2) {
    const top = reserved[0]!;
    const topHook = normHook(top.candidate.idea.hook);
    let foundCandidateButRejected = false;
    for (let i = 0; i < pool.length; i++) {
      if (pool[i] === top) continue;
      const cand = pool[i]!;
      // Hard distinctness gates.
      const entryIdDistinct = cand.entryId !== top.entryId;
      const hookDistinct = normHook(cand.candidate.idea.hook) !== topHook;
      const skeletonDistinct = cand.hookSkeleton !== top.hookSkeleton;
      const anchorDistinct =
        cand.anchor.toLowerCase() !== top.anchor.toLowerCase();
      if (!(entryIdDistinct && hookDistinct && skeletonDistinct && anchorDistinct)) {
        continue;
      }
      // Soft distinctness gates.
      const familyDistinct = cand.comedyFamily !== top.comedyFamily;
      const settingDistinct = cand.setting !== top.setting;
      const spikeDistinct = cand.emotionalSpike !== top.emotionalSpike;
      if (!(familyDistinct && settingDistinct && spikeDistinct)) {
        foundCandidateButRejected = true;
        continue;
      }
      reserved.push(cand);
      break;
    }
    if (reserved.length === 1 && foundCandidateButRejected) {
      secondW2RejectedForDistinctness = true;
    }
  }

  const reservedCandidates = reserved.map((w) => w.candidate);
  const reservedHooks = new Set<string>(
    reservedCandidates.map((c) => normHook(c.idea.hook)),
  );
  const reservedEntryIds = new Set<string>(reserved.map((w) => w.entryId));

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
      droppedByEntryId,
      droppedByHook,
      droppedBySkeleton,
      secondW2RejectedForDistinctness,
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
    droppedByEntryId,
    droppedByHook,
    droppedBySkeleton,
    secondW2RejectedForDistinctness,
  });
  return composed;
}
