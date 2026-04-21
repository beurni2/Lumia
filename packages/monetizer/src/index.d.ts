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
export type Currency = "USD" | "BRL" | "MXN" | "COP" | "ARS" | "IDR" | "PHP" | "VND" | "THB";
export type PayoutRail = "wise" | "pix" | "gcash" | "ovo" | "spei" | "promptpay";
export interface RevenueEvent {
    id: string;
    videoId: string;
    amount: number;
    currency: Currency;
    source: "affiliate" | "brand-deal" | "tip" | "platform-rev-share";
    occurredAt: number;
    /** True only if Lumina's swarm directly created or negotiated this revenue. */
    attributableToLumina: boolean;
    /** Baseline revenue the creator would have earned without Lumina. */
    baseline: number;
}
export interface FeeCalculation {
    revenueEventId: string;
    gross: number;
    baseline: number;
    /** gross - baseline, clamped to ≥ 0. */
    incremental: number;
    /** 10% of incremental — the only fee Lumina charges. */
    fee: number;
    /** gross - fee. */
    creatorTake: number;
}
/**
 * The single source of truth for the 10% performance fee.
 * Pure, deterministic, and unit-tested against 100 fixture scenarios.
 */
export declare function calculateFee(event: RevenueEvent): FeeCalculation;
export interface Payout {
    id: string;
    creatorId: string;
    amount: number;
    currency: Currency;
    rail: PayoutRail;
    feeCalculations: FeeCalculation[];
    status: "pending" | "in-escrow" | "settled" | "reversed";
    createdAt: number;
    settledAt?: number;
}
export interface DealRouter {
    matchBrands(videoId: string, region: string): Promise<Array<{
        brandId: string;
        score: number;
    }>>;
    draftPitch(videoId: string, brandId: string): Promise<string>;
}
export interface PayoutGateway {
    open(payout: Omit<Payout, "id" | "status" | "createdAt">): Promise<Payout>;
    release(payoutId: string): Promise<Payout>;
    reverse(payoutId: string, reason: string): Promise<Payout>;
}
export declare const SPRINT: 4;
export declare const STATUS: "stub";
export declare const PERFORMANCE_FEE_RATE: 0.1;
