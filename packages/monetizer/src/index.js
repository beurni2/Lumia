/**
 * @workspace/monetizer
 *
 * Closed-loop monetization. Affiliate detection, brand pitch generation,
 * payout escrow accounting, and the 10% performance fee on incremental only.
 *
 * SPRINT 4 (weeks 7–8) — currently a contract-only stub.
 * The audit trail invariants below are non-negotiable per ROADMAP.md
 * Sprint 4 phase-complete audit (zero discrepancies tolerated).
 */
/**
 * The single source of truth for the 10% performance fee.
 * Pure, deterministic, and unit-tested against 100 fixture scenarios.
 */
export function calculateFee(event) {
    if (!event.attributableToLumina) {
        return {
            revenueEventId: event.id,
            gross: event.amount,
            baseline: event.amount,
            incremental: 0,
            fee: 0,
            creatorTake: event.amount,
        };
    }
    const incremental = Math.max(0, event.amount - event.baseline);
    const fee = round2(incremental * 0.10);
    return {
        revenueEventId: event.id,
        gross: event.amount,
        baseline: event.baseline,
        incremental,
        fee,
        creatorTake: round2(event.amount - fee),
    };
}
function round2(n) {
    return Math.round(n * 100) / 100;
}
export const SPRINT = 4;
export const STATUS = "stub";
export const PERFORMANCE_FEE_RATE = 0.10;
