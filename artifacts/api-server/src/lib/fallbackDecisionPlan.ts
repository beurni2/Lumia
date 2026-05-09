/**
 * PHASE W2-M — Refresh Latency + Claude Fallback Control
 *
 * Pure decision function: given the orchestrator's local-pipeline state,
 * decide whether the Claude fallback round-trip is required and report
 * a single explicit reason. Extracted from `hybridIdeator.ts` so the
 * gating logic is unit-testable in isolation and so QA telemetry can
 * surface a structured `fallbackDecision` field without scraping logs.
 *
 * Behavior contract (preserves pre-W2-M semantics when the new W2-M
 * skip is OFF):
 *
 *   1. Hard failure paths ALWAYS trigger fallback, regardless of any
 *      skip gate:
 *        - merged pool too small (< 3)
 *        - selection under-filled (selection.batch.length < desiredCount)
 *        - selection diversity guards failed
 *      These are the same three conditions the legacy needFallback
 *      cascade tested.
 *
 *   2. When the local pool produced a valid desiredCount batch with
 *      passing guards, three skip gates can short-circuit the
 *      remaining regenerate-novelty fallback:
 *        - P3 (existing, always-on): non-regenerate (normal-tap) request
 *          + localKept >= desiredCount → safe to skip; the regenerate-
 *          novelty +Claude axis isn't relevant because the user didn't
 *          ask for a refresh.
 *        - N1-live (existing, always-on when applicable): regenerate
 *          request whose pack pool is structurally healthy
 *          (n1LiveSkipFallback already encapsulates the four-AND
 *          activation gate + pack-pool fullness check).
 *        - W2-M (NEW, flag-gated): regenerate request whose local pool
 *          is sufficient AND the orchestrator has already applied the
 *          excludeHooks + memory dedupe filters BEFORE selection (so a
 *          batch that fills with passing guards has structurally
 *          satisfied regenerate's freshness intent locally). Gated on
 *          `LUMINA_W2M_LOCAL_FIRST_REFRESH_ENABLED=true` so production
 *          is byte-identical to pre-W2-M behavior until the flag is
 *          turned on.
 *
 *   3. If none of the skip gates fire AND we're on a regenerate request
 *      that didn't qualify for the N1-live skip, the legacy
 *      `layer1CoreAwareTriggered` path forces fallback. Reason:
 *      `regenerate_legacy_force`. Once W2-M ships and the flag is ON
 *      this branch is observable only when the local pool was actually
 *      insufficient post-novelty filtering — a real signal we surface
 *      in QA telemetry.
 *
 * Pure: no I/O, no logging, no env reads. The orchestrator threads in
 * the resolved `w2mLocalFirstRefreshEnabled` boolean so test code can
 * exercise both states deterministically.
 */

export type FallbackReason =
  | "not_needed_p3_local_sufficient"
  | "not_needed_w2m_local_sufficient"
  | "not_needed_n1_live_skip"
  | "not_needed_gap_only_local_sufficient"
  | "merged_pool_too_small"
  | "selection_underfilled"
  | "guards_failed"
  | "regenerate_legacy_force";

export type FallbackDecision = Readonly<{
  needFallback: boolean;
  reason: FallbackReason;
}>;

export type FallbackDecisionInput = Readonly<{
  regenerate: boolean;
  desiredCount: number;
  localKept: number;
  mergedSize: number;
  selectionBatchSize: number;
  selectionGuardsPassed: boolean;
  n1LiveSkipFallback: boolean;
  w2mLocalFirstRefreshEnabled: boolean;
  /**
   * PHASE F3-FALLBACK-GAP-ONLY — staging-only flag-gated narrowing of
   * the `guards_failed` rail. Default false. When true AND the
   * `guards_failed` rail would have fired AND the local pool is
   * structurally sufficient (`localKept >= max(3, desiredCount)`), the
   * decider returns `not_needed_gap_only_local_sufficient` instead of
   * triggering the Claude round-trip. The two true under-fill rails
   * (`merged_pool_too_small`, `selection_underfilled`) are unaffected
   * and still fire regardless of this flag — we only short-circuit
   * the diversity-only failure path that the F3 audit proved
   * contributed 0/120 ideas while adding ~50 s per request.
   */
  fallbackGapOnlyEnabled: boolean;
}>;

export function decideFallbackPlan(
  input: FallbackDecisionInput,
): FallbackDecision {
  const {
    regenerate,
    desiredCount,
    localKept,
    mergedSize,
    selectionBatchSize,
    selectionGuardsPassed,
    n1LiveSkipFallback,
    w2mLocalFirstRefreshEnabled,
    fallbackGapOnlyEnabled,
  } = input;

  // Hard failure paths — these match the legacy needFallback cascade
  // exactly and override every skip gate. Order matches the legacy
  // short-circuit so the FIRST observable reason on a multi-failure
  // batch matches what the pre-W2-M code path would have logged.
  if (mergedSize < 3) {
    return { needFallback: true, reason: "merged_pool_too_small" };
  }
  if (selectionBatchSize < desiredCount) {
    return { needFallback: true, reason: "selection_underfilled" };
  }
  if (!selectionGuardsPassed) {
    // PHASE F3-FALLBACK-GAP-ONLY (BI 2026-05-09) — staging-only narrowing
    // of the guards_failed rail. The F3 LLM-fallback stress sweep proved
    // the guards_failed branch fired 12/12 times with `localKept` far
    // above `desiredCount` (avg 23 ≫ 10), every Claude call timed out at
    // the 45 s P4 wrapper, and **0/120 served ideas were sourced from
    // the fallback** — i.e. ~50 s of pure latency tax with zero
    // observable user-quality contribution. When the flag is ON AND the
    // local pool is structurally sufficient (`localKept >= max(3,
    // desiredCount)`), the existing best-effort ship path downstream
    // already produces a complete batch from the local pool, so the
    // Claude round-trip is skipped. The hard floor `max(3, desiredCount)`
    // mirrors the `merged_pool_too_small` (<3) and `selection_underfilled`
    // (<desiredCount) rails so we never skip on a thin pool. Flag-OFF
    // path is byte-identical to the pre-F3 cascade.
    if (
      fallbackGapOnlyEnabled &&
      localKept >= Math.max(3, desiredCount)
    ) {
      return {
        needFallback: false,
        reason: "not_needed_gap_only_local_sufficient",
      };
    }
    return { needFallback: true, reason: "guards_failed" };
  }

  // P3 — non-regenerate request. Always-on (no flag). The three hard
  // failure paths above already guarantee mergedSize >= 3,
  // selectionBatchSize >= desiredCount, and selectionGuardsPassed,
  // which in turn imply the local pool produced a complete batch —
  // i.e. localKept is implicitly sufficient. Legacy parity: pre-W2-M
  // `needFallback` short-circuited to false here regardless of
  // localKept. The earlier explicit `localKept >= desiredCount` check
  // was a redundant defensive guard; dropping it preserves bit-for-bit
  // legacy semantics on every non-regenerate call.
  if (!regenerate) {
    return { needFallback: false, reason: "not_needed_p3_local_sufficient" };
  }

  // N1-live — regenerate but the NG-pack pool is structurally healthy
  // (caller already evaluated the four-AND activation gate + the
  // `localKept >= desiredCount + 2` headroom check). Always-on (no
  // flag); legacy behavior preserved bit-for-bit.
  if (regenerate && n1LiveSkipFallback) {
    return { needFallback: false, reason: "not_needed_n1_live_skip" };
  }

  // W2-M — regenerate + flag enabled + local pool sufficient. The
  // orchestrator applies excludeHooks + memory dedupe to the merged
  // pool BEFORE selection, so a selection that filled desiredCount
  // with passing guards has already excluded visible/recent hooks
  // and respected per-creator memory. Claude's novelty contribution
  // is structurally redundant in this state.
  if (
    regenerate &&
    w2mLocalFirstRefreshEnabled &&
    localKept >= desiredCount
  ) {
    return { needFallback: false, reason: "not_needed_w2m_local_sufficient" };
  }

  // Legacy regenerate-mandatory fallback. With W2-M OFF this is the
  // pre-W2-M path for every non-N1 regenerate request. With W2-M ON
  // this only fires when the local pool was actually short post-
  // novelty filtering (localKept < desiredCount) — a real signal worth
  // surfacing in telemetry.
  return { needFallback: true, reason: "regenerate_legacy_force" };
}

/**
 * Resolves the W2-M flag from the process environment. Hoisted so the
 * orchestrator can read it once per request and threading is explicit.
 * Default OFF — production stays byte-identical to pre-W2-M behavior
 * until the flag is set on the dev / staging start path.
 */
export function isW2mLocalFirstRefreshEnabled(): boolean {
  return process.env.LUMINA_W2M_LOCAL_FIRST_REFRESH_ENABLED === "true";
}

/**
 * PHASE F3-FALLBACK-GAP-ONLY (BI 2026-05-09) — resolves the staging-only
 * `LUMINA_FALLBACK_GAP_ONLY` env flag. Default OFF — production stays
 * byte-identical to pre-F3 behavior until the flag is set on a
 * dev / staging start path. See the `fallbackGapOnlyEnabled` field
 * docstring on `FallbackDecisionInput` for the full semantic contract.
 */
export function isFallbackGapOnlyEnabled(): boolean {
  return process.env.LUMINA_FALLBACK_GAP_ONLY === "true";
}
