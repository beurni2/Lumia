/**
 * Local wallet contract — Sprint 4 deposit simulation.
 *
 * Locks: positive-only deposits, multi-currency balance derivation,
 * monotonic seq, append-only ledger, source aggregation.
 */

import assert from "node:assert";
import { LocalWallet } from "../wallet";

function run() {
  // ── 1. Empty wallet ───────────────────────────────────────────────────
  const w = new LocalWallet();
  assert.equal(w.balance("USD"), 0);
  assert.equal(w.ledger().length, 0);
  assert.deepEqual(w.summary().balances, {});

  // ── 2. Positive deposits accumulate per currency ─────────────────────
  const e1 = w.deposit({
    amount: 12.345,
    currency: "USD",
    source: "performance-fee-creator-take",
    reference: "po-1",
    at: 1000,
  });
  assert.equal(e1.seq, 1);
  assert.equal(e1.amount, 12.35, "amounts round to 2dp on entry");

  w.deposit({ amount: 100, currency: "USD", source: "manual-credit", reference: "manual-1", at: 2000 });
  w.deposit({ amount: 250.50, currency: "BRL", source: "performance-fee-creator-take", reference: "po-2", at: 3000 });

  assert.equal(w.balance("USD"), 112.35);
  assert.equal(w.balance("BRL"), 250.50);
  assert.equal(w.balance("MXN"), 0);

  // ── 3. Negative / zero deposits are rejected ─────────────────────────
  assert.throws(
    () => w.deposit({ amount: 0, currency: "USD", source: "manual-credit", reference: "z", at: 4000 }),
    /positive/,
  );
  assert.throws(
    () => w.deposit({ amount: -5, currency: "USD", source: "manual-credit", reference: "n", at: 5000 }),
    /positive/,
  );

  // ── 4. Source aggregation in summary ──────────────────────────────────
  w.deposit({ amount: 25, currency: "USD", source: "referral-bounty-referrer", reference: "bounty-po-9", at: 6000 });
  w.deposit({ amount: 25, currency: "USD", source: "referral-bounty-referee", reference: "bounty-po-9", at: 6000 });
  const s = w.summary();
  assert.equal(s.entries, 5);
  assert.equal(s.bySource["performance-fee-creator-take"], 12.35 + 250.50);
  assert.equal(s.bySource["manual-credit"], 100);
  assert.equal(s.bySource["referral-bounty-referrer"], 25);
  assert.equal(s.bySource["referral-bounty-referee"], 25);
  assert.equal(s.balances.USD, 162.35);
  assert.equal(s.balances.BRL, 250.50);

  // ── 5. Append-only seq is monotonic and contiguous ────────────────────
  const seqs = w.ledger().map((e) => e.seq);
  assert.deepEqual(seqs, [1, 2, 3, 4, 5]);

  console.log("monetizer wallet (deposit simulation): PASS");
}

run();
console.log("Done");
