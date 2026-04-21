/**
 * Earnings agent contract — Sprint 4 (full flywheel).
 *
 * Locks: ledger records every event, escrow opens one payout per currency,
 * wallet receives creator-take deposits, referral bounty fires on the first
 * payout for an attributed referee with BOTH parties paid in cash to their
 * respective wallets, head hash is deterministic across re-runs, optional
 * auto-match step injects affiliate revenue into the same cycle.
 */

import assert from "node:assert";
import {
  PerformanceFeeLedger,
  InMemoryEscrow,
  ReferralRocket,
  LocalWallet,
  REFERRER_BOUNTY_USD,
  REFEREE_BOUNTY_USD,
  referralCodeFor,
  type ReferralBounty,
  type RevenueEvent,
} from "@workspace/monetizer";
import { runEarningsCycle } from "../agents/earnings";

function freshCtx(opts: {
  creatorKey: string;
  resolveReferrer: (c: string) => string | null;
  wallet?: LocalWallet;
  depositReferrerBounty?: (b: ReferralBounty) => boolean;
}) {
  return {
    creatorId: "creator-bob",
    creatorRegion: "br",
    creatorKey: opts.creatorKey,
    ledger: new PerformanceFeeLedger(),
    escrow: new InMemoryEscrow(() => 1_000),
    referrals: new ReferralRocket(),
    resolveReferrer: opts.resolveReferrer,
    wallet: opts.wallet,
    depositReferrerBounty: opts.depositReferrerBounty,
  };
}

function evt(id: string, amount: number, currency: "USD" | "BRL", baseline = 0): RevenueEvent {
  return {
    id,
    videoId: "v1",
    amount,
    currency,
    source: "brand-deal",
    occurredAt: 1_700_000_000_000,
    attributableToLumina: true,
    baseline,
  };
}

async function run() {
  // ── 1. Records every event + opens 1 payout per currency ─────────────
  const ctx = freshCtx({ creatorKey: "bob", resolveReferrer: () => null });
  const events = [evt("e1", 100, "USD"), evt("e2", 200, "USD", 50), evt("e3", 500, "BRL")];
  const result = await runEarningsCycle(ctx, events, 2_000);
  assert.equal(result.recordedEvents, 3);
  assert.equal(result.openedPayouts.length, 2, "one payout per distinct currency");
  const currencies = result.openedPayouts.map((p) => p.currency).sort();
  assert.deepEqual(currencies, ["BRL", "USD"]);
  assert.equal(ctx.ledger.summary().entries, 3);

  // ── 2. Rail picker is region-aware ───────────────────────────────────
  const brl = result.openedPayouts.find((p) => p.currency === "BRL")!;
  assert.equal(brl.rail, "pix", "BR + BRL → pix");
  const usd = result.openedPayouts.find((p) => p.currency === "USD")!;
  assert.equal(usd.rail, "wise", "USD always falls back to wise");

  // ── 3. No bounty when no attribution ─────────────────────────────────
  assert.equal(result.bountiesTriggered, 0, "unattributed referee → 0 bounties");
  assert.equal(result.walletDeposits, 0, "no wallet → no deposits");

  // ── 4. Wallet deposit simulation: creator-take lands in wallet ────────
  const wallet = new LocalWallet();
  const ctxW = freshCtx({ creatorKey: "wally", resolveReferrer: () => null, wallet });
  const r4 = await runEarningsCycle(ctxW, [evt("e1", 200, "USD", 50)], 5_000);
  assert.equal(r4.walletDeposits, 1, "1 payout → 1 wallet deposit");
  // Gross 200 - fee (10% of 150 incremental = 15) = 185
  assert.equal(wallet.balance("USD"), 185);
  assert.equal(wallet.ledger()[0]!.source, "performance-fee-creator-take");
  assert.equal(wallet.ledger()[0]!.reference, r4.openedPayouts[0]!.id);

  // ── 5. Attributed referee triggers bounty AND pays BOTH parties ──────
  const aliceCode = referralCodeFor("alice");
  const refereeWallet = new LocalWallet();
  const referrerWallet = new LocalWallet();
  const ctx2 = freshCtx({
    creatorKey: "carol",
    resolveReferrer: (c) => (c === aliceCode ? "alice" : null),
    wallet: refereeWallet,
    depositReferrerBounty: (b) => {
      referrerWallet.deposit({
        amount: b.referrerCreditUsd,
        currency: "USD",
        source: "referral-bounty-referrer",
        reference: b.bountyId,
        at: b.triggeredAt,
      });
      return true;
    },
  });
  ctx2.referrals.attribute("carol", aliceCode, 500);
  const r2 = await runEarningsCycle(ctx2, [evt("ev1", 100, "USD")], 1_500);
  assert.equal(r2.bountiesTriggered, 1, "attributed first payout must trigger bounty");
  assert.equal(r2.bountiesPaid, 1, "both wallet sides must have deposited");
  assert.equal(refereeWallet.balance("USD"), 100 - 10 + REFEREE_BOUNTY_USD,
    "referee wallet = creator take ($90) + referee bounty ($25)");
  assert.equal(referrerWallet.balance("USD"), REFERRER_BOUNTY_USD,
    "referrer wallet = referrer bounty ($25)");
  assert.equal(ctx2.referrals.pendingBounties().length, 1);
  assert.equal(ctx2.referrals.pendingBounties()[0]!.referrerKey, "alice");

  // ── 6. Auto-match step folds in affiliate-derived events ─────────────
  const wallet6 = new LocalWallet();
  const ctx6 = freshCtx({ creatorKey: "dave", resolveReferrer: () => null, wallet: wallet6 });
  const r6 = await runEarningsCycle(
    ctx6,
    {
      events: [evt("brand-1", 80, "USD", 0)],
      autoMatch: {
        videoId: "v9",
        content: { caption: "shop https://shopee.com.br/x?af_id=z", hook: "" },
        projectedReach: 100_000,
        creatorBaselineUsd: 0,
        currency: "USD",
        now: 6_000,
      },
    },
    6_000,
  );
  assert.ok(r6.autoMatched, "auto-match must run when input provided");
  assert.equal(r6.autoMatched!.events.length, 1);
  assert.equal(r6.recordedEvents, 2, "1 brand event + 1 auto-matched affiliate event");
  assert.equal(r6.openedPayouts.length, 1, "single currency → single payout");
  assert.ok(wallet6.balance("USD") > 80 - 8, "wallet must include both brand take + affiliate take");

  // ── 6a. Atomic dual-credit on referrer-deposit failure ───────────────
  // If the referrer dispatcher reports failure, the referee wallet MUST NOT
  // be credited (so wallets stay symmetric) and the next cycle MUST be able
  // to retry the bounty cleanly.
  const refereeWallet8 = new LocalWallet();
  const referrerWallet8 = new LocalWallet();
  let referrerShouldFail = true;
  const ctx8 = freshCtx({
    creatorKey: "henry",
    resolveReferrer: (c) => (c === referralCodeFor("ivy") ? "ivy" : null),
    wallet: refereeWallet8,
    depositReferrerBounty: (b) => {
      if (referrerShouldFail) return false;
      referrerWallet8.deposit({
        amount: b.referrerCreditUsd,
        currency: "USD",
        source: "referral-bounty-referrer",
        reference: b.bountyId,
        at: b.triggeredAt,
      });
      return true;
    },
  });
  ctx8.referrals.attribute("henry", referralCodeFor("ivy"), 100);
  const r8a = await runEarningsCycle(ctx8, [evt("ev-h-1", 100, "USD")], 8_000);
  assert.equal(r8a.bountiesTriggered, 1, "bounty must be reserved even if referrer dispatch fails");
  assert.equal(r8a.bountiesPaid, 0, "bounty must NOT be marked paid when referrer side fails");
  assert.equal(refereeWallet8.balance("USD"), 90,
    "referee wallet must contain ONLY the creator-take ($90), no referee bounty yet");
  assert.equal(referrerWallet8.balance("USD"), 0, "referrer wallet must be empty");
  assert.equal(ctx8.referrals.pendingBounties().length, 0, "no committed bounty after failure");

  // Second cycle — the referrer dispatcher now succeeds; the bounty must
  // re-issue and commit cleanly (atomic dual-credit retry).
  referrerShouldFail = false;
  const r8b = await runEarningsCycle(ctx8, [evt("ev-h-2", 100, "USD")], 8_500);
  assert.equal(r8b.bountiesTriggered, 1, "second cycle re-issues the bounty");
  assert.equal(r8b.bountiesPaid, 1, "second cycle commits both sides");
  assert.equal(refereeWallet8.balance("USD"), 90 + 90 + REFEREE_BOUNTY_USD,
    "referee wallet = 2× creator take + referee bounty");
  assert.equal(referrerWallet8.balance("USD"), REFERRER_BOUNTY_USD,
    "referrer wallet = referrer bounty");

  // ── 6b. Atomic dual-credit precondition: missing wallet must not commit
  // If the creator has no wallet attached yet (e.g. before SecureBackend
  // rehydrates), the bounty MUST stay uncommitted and re-trigger on the
  // next cycle — otherwise the referrer would be paid while the referee
  // gets nothing.
  let dispatcherCalls9 = 0;
  const ctx9 = freshCtx({
    creatorKey: "june",
    resolveReferrer: (c) => (c === referralCodeFor("kara") ? "kara" : null),
    wallet: undefined, // <-- no wallet on first cycle
    depositReferrerBounty: () => { dispatcherCalls9++; return true; },
  });
  ctx9.referrals.attribute("june", referralCodeFor("kara"), 100);
  const r9a = await runEarningsCycle(ctx9, [evt("ev-j-1", 100, "USD")], 9_000);
  assert.equal(r9a.bountiesTriggered, 1, "bounty reservation still issued");
  assert.equal(r9a.bountiesPaid, 0, "no wallet → cannot commit referee credit → no payout");
  assert.equal(dispatcherCalls9, 0, "referrer dispatcher must NOT be called when referee can't be credited");
  assert.equal(ctx9.referrals.pendingBounties().length, 0, "no committed bounty without wallet");

  // ── 6c. Atomic dual-credit on referrer-deposit *exception* ───────────
  // A throwing dispatcher (e.g. real-world network error) must release the
  // reservation, not leave it stuck inFlight.
  const wallet10 = new LocalWallet();
  let throwOnce = true;
  const ctx10 = freshCtx({
    creatorKey: "luna",
    resolveReferrer: (c) => (c === referralCodeFor("milo") ? "milo" : null),
    wallet: wallet10,
    depositReferrerBounty: () => {
      if (throwOnce) { throwOnce = false; throw new Error("simulated network blip"); }
      return true;
    },
  });
  ctx10.referrals.attribute("luna", referralCodeFor("milo"), 100);
  const r10a = await runEarningsCycle(ctx10, [evt("ev-l-1", 100, "USD")], 10_000);
  assert.equal(r10a.bountiesPaid, 0, "thrown dispatcher must not commit bounty");
  assert.equal(wallet10.balance("USD"), 90, "only creator-take credited; no referee bounty leaked");
  // Retry on next cycle must succeed.
  const r10b = await runEarningsCycle(ctx10, [evt("ev-l-2", 100, "USD")], 10_500);
  assert.equal(r10b.bountiesPaid, 1, "retry after thrown dispatcher must succeed");
  assert.equal(wallet10.balance("USD"), 90 + 90 + REFEREE_BOUNTY_USD,
    "referee wallet = 2× creator take + referee bounty after retry");

  // ── 7. Determinism: same inputs → identical head hash ────────────────
  const a = freshCtx({ creatorKey: "x", resolveReferrer: () => null });
  const b = freshCtx({ creatorKey: "x", resolveReferrer: () => null });
  const ra = await runEarningsCycle(a, events, 9_999);
  const rb = await runEarningsCycle(b, events, 9_999);
  assert.equal(ra.headHash, rb.headHash, "head hash must be deterministic across runs");
  assert.equal(a.ledger.summary().headHash, b.ledger.summary().headHash);

  console.log("swarm-studio earnings agent: PASS");
}

await run();
console.log("Done");
