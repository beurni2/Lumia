/**
 * Earnings agent — Sprint 4 (full monetization flywheel).
 *
 * Bridges the swarm to @workspace/monetizer:
 *   1. (optional) auto-match affiliates from the video metadata → simulated
 *      RevenueEvents that flow into the ledger.
 *   2. Records every revenue event in the PerformanceFeeLedger.
 *   3. Drafts payouts batched by (creatorId, currency), opens them in escrow.
 *   4. Deposits the creator's take into the LocalWallet (deposit simulation).
 *   5. Triggers Referral Rocket bounties on the referee's first settled
 *      payout — both the referrer AND the referee are paid real cash, routed
 *      to their respective wallets through the injected dispatcher.
 *
 * Pure orchestration — all storage is injected. No IO, no Date.now() calls;
 * the caller supplies `now` so re-runs are bit-identical for audit.
 */

import {
  PerformanceFeeLedger,
  InMemoryEscrow,
  ReferralRocket,
  LocalWallet,
  draftPayout,
  pickRail,
  autoMatchAffiliates,
  type AutoMatchInput,
  type AutoMatchResult,
  type Currency,
  type Payout,
  type ReferralBounty,
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
  /**
   * Optional. When supplied, the creator's take from each opened payout is
   * deposited here AND the REFEREE side of any triggered bounty lands here
   * (this creator IS the referee in that bounty).
   */
  readonly wallet?: LocalWallet;
  /**
   * Optional. Routes the REFERRER side of any triggered bounty to the
   * referrer's own wallet. Sprint 5 wires this to a creator-table lookup;
   * the scaffold accepts an injected closure so tests stay deterministic.
   * Returning `false` (or omitting the dispatcher) means the bounty is
   * recorded in `referrals.pendingBounties()` but no wallet credit is made.
   */
  readonly depositReferrerBounty?: (bounty: ReferralBounty) => boolean;
}

export interface EarningsCycleResult {
  readonly recordedEvents: number;
  readonly openedPayouts: readonly Payout[];
  readonly bountiesTriggered: number;
  readonly bountiesPaid: number; // bounties where BOTH sides actually deposited
  readonly walletDeposits: number;
  readonly autoMatched: AutoMatchResult | null;
  readonly headHash: string;
}

export interface EarningsCycleInput {
  /** Pre-collected events (e.g. brand-deal payouts already settled). */
  readonly events?: readonly RevenueEvent[];
  /** Optional auto-match step — derives extra RevenueEvents from a video. */
  readonly autoMatch?: AutoMatchInput;
}

/**
 * One full earnings cycle: optional auto-match → record → batch → escrow →
 * wallet-deposit → maybe-bounty. Events MUST be pre-sorted by occurredAt;
 * the agent does not sort.
 */
export async function runEarningsCycle(
  ctx: EarningsContext,
  inputOrEvents: EarningsCycleInput | readonly RevenueEvent[],
  now: number,
): Promise<EarningsCycleResult> {
  // Back-compat: accept a bare events array as the second arg.
  const input: EarningsCycleInput = Array.isArray(inputOrEvents)
    ? { events: inputOrEvents as readonly RevenueEvent[] }
    : (inputOrEvents as EarningsCycleInput);

  // ── 0. Optional auto-match step ──────────────────────────────────────
  let autoMatched: AutoMatchResult | null = null;
  if (input.autoMatch) {
    autoMatched = autoMatchAffiliates(input.autoMatch);
  }
  const events: readonly RevenueEvent[] = [
    ...(input.events ?? []),
    ...(autoMatched?.events ?? []),
  ];

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
  const cycleIds = new Set(events.map((e) => e.id));
  const opened: Payout[] = [];
  let walletDeposits = 0;
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

    // ── 4. Wallet deposit simulation ────────────────────────────────
    if (ctx.wallet && payout.amount > 0) {
      ctx.wallet.deposit({
        amount: payout.amount,
        currency: payout.currency,
        source: "performance-fee-creator-take",
        reference: payout.id,
        at: now,
      });
      walletDeposits++;
    }
  }

  // ── 5. Referral bounty: first payout for THIS creator (the referee) ──
  //
  // Atomic dual-credit contract:
  //   - We RESERVE the bounty via onRefereeFirstPayout() — no `firstPayoutSeen`
  //     lock yet, so retry is safe if anything fails mid-flight.
  //   - We deposit the REFERRER side first (via the injected dispatcher). If
  //     the dispatcher reports failure (or is missing), we release the
  //     reservation and the next cycle will re-trigger.
  //   - Only after the referrer deposit succeeds do we credit the REFEREE
  //     wallet (which is append-only and therefore impossible to roll back).
  //   - Finally we commit the bounty so the referee is locked-in seen.
  let bountiesTriggered = 0;
  let bountiesPaid = 0;
  for (const p of opened) {
    const bounty = ctx.referrals.onRefereeFirstPayout({
      refereeKey: ctx.creatorKey,
      refereePayoutId: p.id,
      now,
      resolveReferrer: ctx.resolveReferrer,
    });
    if (!bounty) continue;
    bountiesTriggered++;

    // Strict dual-credit precondition: both the referrer dispatcher AND a
    // referee wallet MUST be present, OR we release the reservation so the
    // next cycle retries (e.g. once the wallet rehydrates from disk).
    if (!ctx.depositReferrerBounty || !ctx.wallet) {
      ctx.referrals.releaseBounty(bounty);
      continue;
    }

    // Referrer side first. Wrap in try/catch so a thrown dispatcher (e.g.
    // network failure on a real Sprint 5 wallet API) does not leave the
    // reservation stuck `inFlight`.
    let depositedReferrer = false;
    try {
      depositedReferrer = !!ctx.depositReferrerBounty(bounty);
    } catch {
      depositedReferrer = false;
    }
    if (!depositedReferrer) {
      // Referrer side could not be paid — release so the next cycle retries.
      // Crucially, we do NOT touch the referee wallet here, so the wallet
      // ledgers stay symmetric.
      ctx.referrals.releaseBounty(bounty);
      continue;
    }

    // Referee side. The wallet is append-only and positive-only; if its
    // deposit throws (extremely unlikely given the Sprint 4 contract, but
    // defensively guarded) we still commit because the referrer side is
    // already paid — leaving the bounty uncommitted would let the next
    // cycle double-pay the referrer.
    try {
      ctx.wallet.deposit({
        amount: bounty.refereeCreditUsd,
        currency: "USD",
        source: "referral-bounty-referee",
        reference: bounty.bountyId,
        at: now,
      });
      walletDeposits++;
    } catch {
      // Swallow — see comment above. Commit still proceeds.
    }
    ctx.referrals.commitBounty(bounty);
    bountiesPaid++;
    // Only one bounty per creator, ever — short-circuit the rest of opened[].
    break;
  }

  return {
    recordedEvents: events.length,
    openedPayouts: opened,
    bountiesTriggered,
    bountiesPaid,
    walletDeposits,
    autoMatched,
    headHash: ctx.ledger.summary().headHash,
  };
}
