/**
 * Earnings agent contract — Sprint 4 scaffold.
 *
 * Locks: ledger records every event, escrow opens one payout per currency,
 * referral bounty fires on the first payout for an attributed referee,
 * head hash is deterministic across re-runs.
 */

import assert from "node:assert";
import {
  PerformanceFeeLedger,
  InMemoryEscrow,
  ReferralRocket,
  referralCodeFor,
  type RevenueEvent,
} from "@workspace/monetizer";
import { runEarningsCycle } from "../agents/earnings";

function freshCtx(opts: { creatorKey: string; resolveReferrer: (c: string) => string | null }) {
  return {
    creatorId: "creator-bob",
    creatorRegion: "br",
    creatorKey: opts.creatorKey,
    ledger: new PerformanceFeeLedger(),
    escrow: new InMemoryEscrow(() => 1_000),
    referrals: new ReferralRocket(),
    resolveReferrer: opts.resolveReferrer,
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

  // ── 4. Attributed referee triggers exactly one bounty ────────────────
  const aliceCode = referralCodeFor("alice");
  const ctx2 = freshCtx({
    creatorKey: "carol",
    resolveReferrer: (c) => (c === aliceCode ? "alice" : null),
  });
  ctx2.referrals.attribute("carol", aliceCode, 500);
  const r2 = await runEarningsCycle(ctx2, [evt("ev1", 100, "USD")], 1_500);
  assert.equal(r2.bountiesTriggered, 1, "attributed first payout must trigger bounty");
  assert.equal(ctx2.referrals.pendingBounties().length, 1);
  assert.equal(ctx2.referrals.pendingBounties()[0]!.referrerKey, "alice");

  // ── 5. Determinism: same inputs → identical head hash ────────────────
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
