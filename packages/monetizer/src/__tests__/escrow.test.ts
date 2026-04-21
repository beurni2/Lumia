/**
 * Escrow state-machine contract.
 *
 * Locks: open → in-escrow, release/reverse only from in-escrow,
 * terminal-state immutability, audit log completeness, rail picker.
 */

import assert from "node:assert";
import {
  InMemoryEscrow,
  draftPayout,
  pickRail,
} from "../escrow";
import { calculateFee, type RevenueEvent } from "../index";

function fee(amount: number, baseline: number): ReturnType<typeof calculateFee> {
  const evt: RevenueEvent = {
    id: `e-${amount}-${baseline}`,
    videoId: "v1",
    amount,
    currency: "USD",
    source: "brand-deal",
    occurredAt: 0,
    attributableToLumina: true,
    baseline,
  };
  return calculateFee(evt);
}

async function run() {
  // ── 1. open → in-escrow + audit event ─────────────────────────────────
  let clock = 1_000;
  const escrow = new InMemoryEscrow(() => clock);
  const draft = draftPayout({
    creatorId: "alice",
    currency: "USD",
    rail: "wise",
    fees: [fee(100, 0), fee(50, 25)],
  });
  const opened = await escrow.open(draft);
  assert.equal(opened.status, "in-escrow");
  assert.equal(opened.amount, draft.amount);
  assert.equal(opened.createdAt, 1_000);
  assert.equal(escrow.events().length, 1);
  assert.equal(escrow.events()[0]!.kind, "opened");

  // ── 2. release: in-escrow → settled ──────────────────────────────────
  clock = 2_000;
  const settled = await escrow.release(opened.id);
  assert.equal(settled.status, "settled");
  assert.equal(settled.settledAt, 2_000);
  assert.equal(escrow.events().length, 2);
  assert.equal(escrow.events()[1]!.kind, "released");

  // ── 3. terminal states are immutable ──────────────────────────────────
  await assert.rejects(() => escrow.release(opened.id), /terminal state 'settled'/);
  await assert.rejects(() => escrow.reverse(opened.id, "n/a"), /terminal state 'settled'/);

  // ── 4. reverse path ──────────────────────────────────────────────────
  const draft2 = draftPayout({
    creatorId: "alice",
    currency: "USD",
    rail: "wise",
    fees: [fee(200, 100)],
  });
  const opened2 = await escrow.open(draft2);
  clock = 3_000;
  const reversed = await escrow.reverse(opened2.id, "chargeback");
  assert.equal(reversed.status, "reversed");
  await assert.rejects(() => escrow.release(opened2.id), /terminal state 'reversed'/);

  // ── 5. unknown payout → throws ────────────────────────────────────────
  await assert.rejects(() => escrow.release("po-999"), /payout not found/);

  // ── 6. rail picker by region+currency ─────────────────────────────────
  assert.equal(pickRail("br", "BRL"), "pix");
  assert.equal(pickRail("ph", "PHP"), "gcash");
  assert.equal(pickRail("id", "IDR"), "ovo");
  assert.equal(pickRail("mx", "MXN"), "spei");
  assert.equal(pickRail("th", "THB"), "promptpay");
  assert.equal(pickRail("br", "USD"), "wise", "USD always falls back to wise");
  assert.equal(pickRail("vn", "VND"), "wise", "no native rail → wise");

  // ── 7. draftPayout sums fees correctly ───────────────────────────────
  const sum = draftPayout({
    creatorId: "bob",
    currency: "USD",
    rail: "wise",
    fees: [fee(100, 0), fee(50, 0)],
  });
  // 100 - 10 (fee) + 50 - 5 (fee) = 135
  assert.equal(sum.amount, 135);

  console.log("monetizer escrow state machine: PASS");
}

await run();
console.log("Done");
