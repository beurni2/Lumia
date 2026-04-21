/**
 * Local on-device wallet — Sprint 4 deposit simulation.
 *
 * Pure, deterministic, multi-currency. Append-only ledger of deposits with
 * source attribution. Sprint 5 swaps the in-memory store for the device's
 * encrypted SecureBackend slot and wires real settlement events from the
 * payout providers; the public surface stays.
 *
 * Hard contract:
 *   - Deposits are positive-amount only (`amount > 0`) — withdrawal lives in
 *     `escrow.ts` and never touches this surface directly.
 *   - Per-currency balances are monotonically non-decreasing.
 *   - The ledger is the source of truth: balances are derived, not stored.
 */

import type { Currency } from "./index";

export type DepositSource =
  | "performance-fee-creator-take"
  | "referral-bounty-referrer"
  | "referral-bounty-referee"
  | "manual-credit";

export interface WalletEntry {
  readonly seq: number;
  readonly amount: number;
  readonly currency: Currency;
  readonly source: DepositSource;
  readonly reference: string; // payoutId / bountyId / videoId etc — for audit join
  readonly at: number;
}

export interface WalletSummary {
  readonly entries: number;
  readonly balances: Readonly<Partial<Record<Currency, number>>>;
  readonly bySource: Readonly<Record<DepositSource, number>>;
}

const ALL_SOURCES: readonly DepositSource[] = [
  "performance-fee-creator-take",
  "referral-bounty-referrer",
  "referral-bounty-referee",
  "manual-credit",
];

export class LocalWallet {
  private readonly entries: WalletEntry[] = [];

  deposit(opts: {
    amount: number;
    currency: Currency;
    source: DepositSource;
    reference: string;
    at: number;
  }): WalletEntry {
    if (!(opts.amount > 0)) {
      throw new Error(`deposits must be positive: got ${opts.amount}`);
    }
    const entry: WalletEntry = {
      seq: this.entries.length + 1,
      amount: round2(opts.amount),
      currency: opts.currency,
      source: opts.source,
      reference: opts.reference,
      at: opts.at,
    };
    this.entries.push(entry);
    return entry;
  }

  balance(currency: Currency): number {
    let total = 0;
    for (const e of this.entries) if (e.currency === currency) total += e.amount;
    return round2(total);
  }

  ledger(): readonly WalletEntry[] {
    return this.entries;
  }

  summary(): WalletSummary {
    const balances: Partial<Record<Currency, number>> = {};
    const bySource: Record<DepositSource, number> = Object.fromEntries(
      ALL_SOURCES.map((s) => [s, 0]),
    ) as Record<DepositSource, number>;
    for (const e of this.entries) {
      balances[e.currency] = round2((balances[e.currency] ?? 0) + e.amount);
      bySource[e.source] = round2(bySource[e.source] + e.amount);
    }
    return {
      entries: this.entries.length,
      balances,
      bySource,
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
