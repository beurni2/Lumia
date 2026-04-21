/**
 * Earnings agent — Sprint 4 scaffold.
 *
 * Bridges the swarm to @workspace/monetizer:
 *   1. Pulls revenue events (affiliate hits, brand-deal payouts, tips, platform
 *      rev-share) and records them in the PerformanceFeeLedger.
 *   2. Drafts payouts batched by (creatorId, currency), opens them in escrow.
 *   3. Triggers Referral Rocket bounties on a referee's first settled payout.
 *
 * Pure orchestration — all storage is injected. No IO, no Date.now() calls;
 * the caller supplies `now` so re-runs are bit-identical for audit.
 */

import {
  PerformanceFeeLedger,
  InMemoryEscrow,
  ReferralRocket,
  draftPayout,
  pickRail,
  type Currency,
  type Payout,
  type RevenueEvent,
} from "@workspace/monetizer";

export interface EarningsContext {
  readonly creatorId: string;
  readonly creatorRegion: string;
  readonly creatorKey: string;
  readonly ledger: PerformanceFeeLedger;
  readonly escrow: InMemoryEscrow;
  readonly referrals: ReferralRocket;
  /**
   * Resolves a stamped referralCode back to a referrer creatorKey.
   * Sprint 5 backs this with the creator-table; the scaffold accepts an
   * injected closure so tests stay deterministic.
   */
  readonly resolveReferrer: (code: string) => string | null;
}

export interface EarningsCycleResult {
  readonly recordedEvents: number;
  readonly openedPayouts: readonly Payout[];
  readonly bountiesTriggered: number;
  readonly headHash: string;
}

/**
 * One full earnings cycle: record → batch → escrow → maybe-bounty.
 * Events MUST be pre-sorted by occurredAt; the agent does not sort.
 */
export async function runEarningsCycle(
  ctx: EarningsContext,
  events: readonly RevenueEvent[],
  now: number,
): Promise<EarningsCycleResult> {
  // ── 1. Record every event in the ledger ──────────────────────────────
  for (const e of events) {
    ctx.ledger.record(e);
  }

  // ── 2. Batch fees by currency ────────────────────────────────────────
  const groups = new Map<Currency, ReturnType<typeof ctx.ledger.all>[number][]>();
  for (const entry of ctx.ledger.all()) {
    const cur = entry.event.currency;
    if (!groups.has(cur)) groups.set(cur, []);
    groups.get(cur)!.push(entry);
  }

  // ── 3. Open one escrow payout per currency for THIS cycle's events ──
  // Cycle scope: we only escrow the events we just recorded.
  const cycleIds = new Set(events.map((e) => e.id));
  const opened: Payout[] = [];
  for (const [currency, entries] of groups) {
    const fees = entries
      .filter((e) => cycleIds.has(e.event.id) && e.fee.creatorTake > 0)
      .map((e) => e.fee);
    if (fees.length === 0) continue;
    const draft = draftPayout({
      creatorId: ctx.creatorId,
      currency,
      rail: pickRail(ctx.creatorRegion, currency),
      fees,
    });
    const payout = await ctx.escrow.open(draft);
    opened.push(payout);
  }

  // ── 4. Referral bounty: first settled payout for THIS creator ────────
  // The bounty fires on the *first* settled payout. The scaffold treats the
  // first opened payout in this cycle as the trigger candidate; the real
  // wiring (Sprint 5) listens on `escrow.events` for a "released" event.
  let bounties = 0;
  for (const p of opened) {
    const bounty = ctx.referrals.onRefereeFirstPayout({
      refereeKey: ctx.creatorKey,
      refereePayoutId: p.id,
      now,
      resolveReferrer: ctx.resolveReferrer,
    });
    if (bounty) bounties++;
  }

  return {
    recordedEvents: events.length,
    openedPayouts: opened,
    bountiesTriggered: bounties,
    headHash: ctx.ledger.summary().headHash,
  };
}
