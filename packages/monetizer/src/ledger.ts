/**
 * Performance-fee ledger.
 *
 * Append-only audit log of every RevenueEvent + its FeeCalculation, plus the
 * reconciliation hash chain so we can prove the ledger has not been mutated
 * mid-stream during the Sprint 4 phase-complete audit ("Independent ledger
 * reconciliation against payout-provider sandbox statements. Zero
 * discrepancies tolerated").
 *
 * Pure & deterministic. No IO. Storage is in-memory; Sprint 5 swaps the
 * backend for Postgres while preserving the hash chain and the public API.
 */

import { calculateFee, PERFORMANCE_FEE_RATE, type FeeCalculation, type RevenueEvent } from "./index";

export interface LedgerEntry {
  readonly seq: number;
  readonly event: RevenueEvent;
  readonly fee: FeeCalculation;
  /** FNV-1a hash chain over (prevHash | seq | event.id | fee.fee). */
  readonly hash: string;
  readonly prevHash: string;
}

export interface LedgerSummary {
  readonly entries: number;
  readonly grossUsd: number;
  readonly incrementalUsd: number;
  readonly feesCollectedUsd: number;
  readonly creatorTakeUsd: number;
  readonly headHash: string;
  readonly feeRate: typeof PERFORMANCE_FEE_RATE;
}

const GENESIS = "0000000000000000";

export class PerformanceFeeLedger {
  private readonly entries: LedgerEntry[] = [];

  /** Append + return the new entry. Throws on duplicate event.id. */
  record(event: RevenueEvent): LedgerEntry {
    if (this.entries.some((e) => e.event.id === event.id)) {
      throw new Error(`duplicate revenue event id: ${event.id}`);
    }
    const fee = calculateFee(event);
    const seq = this.entries.length + 1;
    const prevHash = this.entries.length === 0 ? GENESIS : this.entries[this.entries.length - 1]!.hash;
    const hash = fnv1a16(`${prevHash}|${seq}|${event.id}|${fee.fee.toFixed(2)}`);
    const entry: LedgerEntry = { seq, event, fee, hash, prevHash };
    this.entries.push(entry);
    return entry;
  }

  all(): readonly LedgerEntry[] {
    return this.entries;
  }

  /** Re-hash from genesis and confirm chain integrity. */
  verify(): boolean {
    let prev = GENESIS;
    for (const e of this.entries) {
      const expected = fnv1a16(`${prev}|${e.seq}|${e.event.id}|${e.fee.fee.toFixed(2)}`);
      if (e.hash !== expected || e.prevHash !== prev) return false;
      prev = e.hash;
    }
    return true;
  }

  summary(): LedgerSummary {
    let gross = 0, incremental = 0, fees = 0, take = 0;
    for (const e of this.entries) {
      gross       += e.fee.gross;
      incremental += e.fee.incremental;
      fees        += e.fee.fee;
      take        += e.fee.creatorTake;
    }
    const headHash = this.entries.length === 0
      ? GENESIS
      : this.entries[this.entries.length - 1]!.hash;
    return {
      entries: this.entries.length,
      grossUsd: round2(gross),
      incrementalUsd: round2(incremental),
      feesCollectedUsd: round2(fees),
      creatorTakeUsd: round2(take),
      headHash,
      feeRate: PERFORMANCE_FEE_RATE,
    };
  }
}

function fnv1a16(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  // 16-hex (pad two 32-bit words for stable width).
  const hex = h.toString(16).padStart(8, "0");
  return (hex + hex).slice(0, 16);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
