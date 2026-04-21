/**
 * Escrowed payout pipeline.
 *
 * In-memory deterministic state machine. Sprint 5 swaps the storage for a
 * Postgres ledger + Wise/Pix/GCash/OVO provider adapters; the state machine
 * itself is the contract that survives.
 *
 * State machine:
 *
 *   open()      → status = "in-escrow"
 *   release()   → status = "settled"     (only valid from "in-escrow")
 *   reverse()   → status = "reversed"    (only valid from "in-escrow")
 *
 * Once a payout is in a terminal state ("settled" | "reversed") any further
 * transition throws. Audit trail is exposed via `events()`.
 */

import type { Currency, FeeCalculation, Payout, PayoutGateway, PayoutRail } from "./index";

export interface EscrowEvent {
  readonly payoutId: string;
  readonly kind: "opened" | "released" | "reversed";
  readonly at: number;
  readonly reason?: string;
}

export class InMemoryEscrow implements PayoutGateway {
  private readonly payouts = new Map<string, Payout>();
  private readonly log: EscrowEvent[] = [];
  private seq = 0;
  constructor(private readonly clock: () => number = () => Date.now()) {}

  async open(p: Omit<Payout, "id" | "status" | "createdAt">): Promise<Payout> {
    const id = `po-${++this.seq}`;
    const payout: Payout = {
      ...p,
      id,
      status: "in-escrow",
      createdAt: this.clock(),
    };
    this.payouts.set(id, payout);
    this.log.push({ payoutId: id, kind: "opened", at: payout.createdAt });
    return payout;
  }

  async release(payoutId: string): Promise<Payout> {
    const payout = this.payouts.get(payoutId);
    if (!payout) throw new Error(`payout not found: ${payoutId}`);
    if (payout.status !== "in-escrow") {
      throw new Error(`cannot release from terminal state '${payout.status}'`);
    }
    const now = this.clock();
    const next: Payout = { ...payout, status: "settled", settledAt: now };
    this.payouts.set(payoutId, next);
    this.log.push({ payoutId, kind: "released", at: now });
    return next;
  }

  async reverse(payoutId: string, reason: string): Promise<Payout> {
    const payout = this.payouts.get(payoutId);
    if (!payout) throw new Error(`payout not found: ${payoutId}`);
    if (payout.status !== "in-escrow") {
      throw new Error(`cannot reverse from terminal state '${payout.status}'`);
    }
    const now = this.clock();
    const next: Payout = { ...payout, status: "reversed", settledAt: now };
    this.payouts.set(payoutId, next);
    this.log.push({ payoutId, kind: "reversed", at: now, reason });
    return next;
  }

  get(payoutId: string): Payout | undefined {
    return this.payouts.get(payoutId);
  }

  events(): readonly EscrowEvent[] {
    return this.log;
  }
}

/**
 * Pure helper: pick the cheapest payout rail for (creator region, currency).
 * Sprint 5 swaps this for live FX + provider-fee quotes.
 */
export function pickRail(region: string, currency: Currency): PayoutRail {
  const r = region.toLowerCase();
  if (r === "br" && currency === "BRL") return "pix";
  if (r === "ph" && currency === "PHP") return "gcash";
  if (r === "id" && currency === "IDR") return "ovo";
  if (r === "mx" && currency === "MXN") return "spei";
  if (r === "th" && currency === "THB") return "promptpay";
  return "wise";
}

/**
 * Deterministic Payout draft from a batch of FeeCalculations. Throws on
 * mismatched currencies — escrow batches MUST be single-currency for audit.
 */
export function draftPayout(opts: {
  creatorId: string;
  currency: Currency;
  rail: PayoutRail;
  fees: FeeCalculation[];
}): Omit<Payout, "id" | "status" | "createdAt"> {
  const total = opts.fees.reduce((acc, f) => acc + f.creatorTake, 0);
  return {
    creatorId: opts.creatorId,
    amount: round2(total),
    currency: opts.currency,
    rail: opts.rail,
    feeCalculations: opts.fees,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
