// ---------------------------------------------------------------- //
// PHASE N1-FOLLOWUP-NG-WEAK-SKELETON-QUOTA                          //
// ---------------------------------------------------------------- //
//
// The follow-up audit (.local/N1_E2E_FCR_FOLLOWUP_AUDIT.md §3-§7)
// identified `totally_fine_about` as the dominant weak pattern-
// variation skeleton flooding slots 3-4 in every Nigerian cohort
// (10 / 60 = 16.7 % per cohort across ng_pidgin, ng_light_pidgin,
// ng_clean, ng_null in the post-rotation QA probe). The slot-0
// rotation helper cannot move it because rotation only swaps slot 0;
// slots 1-5 are returned in pure willingness order, and the
// content-deterministic ranker surfaces this skeleton at the same
// slot in every cold-start batch.
//
// W1.3 already enforces a "max 1 per family, max 3 total weak"
// upstream quota on the merged pool BEFORE selection for the
// western/default cohort, with an under-fill carve-out so the
// promise of "never under-fill" is preserved. The W1.3 cohort gate
// (`canApplyWesternHookAdjustments`) is region-only and explicitly
// excludes Nigeria — so today every NG cohort skips the quota
// entirely.
//
// This module is the audit's recommended Option A: a NARROW NG-only
// sibling that re-uses the SAME `applyWesternWeakSkeletonQuota`
// algorithm (max 1 per family + max 3 total + under-fill carve-out),
// with a NG-specific classifier that ONLY matches the
// `totally_fine_about` skeletonId — no regex fallback, no other
// skeletons. Cross-cohort isolation is guaranteed by the gate
// (region === "nigeria") + the empty regex set; pidgin / light_pidgin
// / clean all share the same rule; Western behaviour is bit-for-bit
// unchanged because the Western quota is gated on
// region undefined / "western".
//
// Hard constraints honoured (per the supervisor brief):
//   - No validator loosening              — picker only drops
//                                            duplicates from the
//                                            pre-selection merged pool
//   - No prompt changes                   — no LLM surface touched
//   - No schema / API / mobile / DB       — pure runtime helper
//   - No pack reservation                 — merged pool only; pack
//                                            reservation is downstream
//   - No score smoothing / K widening     — willingness scoring
//                                            untouched
//   - No first-card rotation rewrite      — rotation helper untouched
//   - Never-underfill preserved           — same safety-floor carve-
//                                            out as Western W1.3
//   - Deterministic                       — single-pass over a
//                                            stable input order
//   - Cohort isolation                    — region === "nigeria" gate
//   - Minimal blocklist                   — only `totally_fine_about`

import type { Region } from "@workspace/lumina-trends";
import type { LanguageStyle } from "./tasteCalibration.js";
import {
  applyWesternWeakSkeletonQuota,
  type WesternWeakQuotaCandidate,
  type WesternWeakQuotaResult,
} from "./westernHookQuality";

/**
 * NG-specific weak-skeleton blocklist. Intentionally narrow. The
 * brief explicitly authorises ONLY `totally_fine_about` for this
 * phase — broadening the set requires a fresh audit + supervisor
 * sign-off.
 */
export const NIGERIAN_WEAK_SKELETON_IDS: ReadonlySet<string> = new Set([
  "totally_fine_about",
]);

/**
 * NG-specific family map. Symmetric to
 * `WESTERN_WEAK_SKELETON_ID_TO_FAMILY` but holding only the audit-
 * authorised skeleton, with itself as its own family identity (we
 * have no W1.2-style regex family for NG — the Western family map
 * exists to collapse `meta.hookSkeletonId` and the regex-derived
 * family into a single key, and we deliberately do NOT add a regex
 * fallback for NG).
 */
export const NIGERIAN_WEAK_SKELETON_ID_TO_FAMILY: ReadonlyMap<string, string> =
  new Map([["totally_fine_about", "totally_fine_about"]]);

/**
 * NG-specific classifier. Mirrors `classifyWesternWeakCandidate`'s
 * shape so it slots into `applyWesternWeakSkeletonQuota` via the
 * `classifier` injection point below, but:
 *   - does NOT consult any regex family classifier (no regex
 *     surface for NG)
 *   - returns null for any skeletonId not in
 *     `NIGERIAN_WEAK_SKELETON_IDS`
 *
 * This means a Claude / llama mutation that re-emits "I am totally
 * fine about X" without the `hookSkeletonId` tag will NOT be caught
 * by the NG quota. That is intentional and matches the brief's
 * "Keep the blocklist narrow" rule. Per the audit, NG mutation hooks
 * for this skeleton are zero-volume in the QA sample (the dominant
 * 10× / cohort offenders all carry the explicit
 * `meta.hookSkeletonId === "totally_fine_about"` tag from
 * `HOOK_PHRASINGS_BY_STYLE`).
 */
export function classifyNigerianWeakCandidate(input: {
  hook: string;
  hookSkeletonId?: string | null | undefined;
}): string | null {
  if (input.hookSkeletonId === undefined || input.hookSkeletonId === null) {
    return null;
  }
  const fam = NIGERIAN_WEAK_SKELETON_ID_TO_FAMILY.get(input.hookSkeletonId);
  return fam ?? null;
}

/**
 * Activation gate. Returns true ONLY for `region === "nigeria"`
 * (covers all NG cohorts: pidgin, light_pidgin, clean, null
 * languageStyle). Western / India / Philippines / undefined region
 * → false, so non-NG cohorts pay zero overhead — the helper short-
 * circuits before the merged-pool walk.
 *
 * Symmetric with `canApplyWesternWeakSkeletonQuota` (region-only
 * gate; languageStyle ignored). Mirrors the same kill-switch escape
 * hatch (`LUMINA_NG_WEAK_QUOTA_DISABLE_FOR_QA=1`, non-prod only) so
 * the QA harness can pair an OFF baseline against the same running
 * server without disturbing W1.3.
 */
export function canApplyNigerianWeakSkeletonQuota(input: {
  region: Region | undefined;
  languageStyle?: LanguageStyle | null;
}): boolean {
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.LUMINA_NG_WEAK_QUOTA_DISABLE_FOR_QA === "1"
  ) {
    return false;
  }
  return input.region === "nigeria";
}

/**
 * Apply the NG-specific weak-skeleton quota to a merged candidate
 * pool. Re-uses the proven `applyWesternWeakSkeletonQuota` algorithm
 * by injecting a NG-specific `classifier` so the
 * "max-per-family / max-total / safety-floor carve-out" semantics
 * are bit-for-bit identical to the Western implementation — same
 * kept-vs-dropped ordering, same under-fill behaviour, same
 * determinism. The only behaviour change vs the Western helper is
 * which skeletons are classified as "weak".
 *
 * The helper is cohort-agnostic by construction; the caller
 * (hybridIdeator.ts) is responsible for gating on
 * `canApplyNigerianWeakSkeletonQuota`. Keeps the helper trivially
 * testable without env state.
 */
export function applyNigerianWeakSkeletonQuota<
  T extends WesternWeakQuotaCandidate,
>(
  candidates: ReadonlyArray<T>,
  opts: {
    desiredCount: number;
    maxPerFamily?: number;
    maxTotal?: number;
    safetyFloorMin?: number;
  },
): WesternWeakQuotaResult<T> {
  return applyWesternWeakSkeletonQuota(candidates, {
    ...opts,
    classifier: classifyNigerianWeakCandidate,
  });
}
