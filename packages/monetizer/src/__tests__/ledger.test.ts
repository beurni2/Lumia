/**
 * Performance-fee ledger contract.
 *
 * Locks: append-only, hash-chain integrity, summary aggregation, duplicate
 * rejection, deterministic head hash. Per ROADMAP.md Sprint 4 phase-complete
 * audit: "Independent ledger reconciliation against payout-provider sandbox
 * statements. Zero discrepancies tolerated."
 */

import assert from "node:assert";
import { PerformanceFeeLedger } from "../ledger";
import { type RevenueEvent } from "../index";

function evt(id: string, amount: number, baseline: number, attr = true): RevenueEvent {
  return {
    id,
    videoId: "v1",
    amount,
    currency: "USD",
    source: "brand-deal",
    occurredAt: 1_700_000_000_000,
    attributableToLumina: attr,
    baseline,
  };
}

function run() {
  // ── 1. Empty ledger → genesis head ────────────────────────────────────
  const empty = new PerformanceFeeLedger();
  const emptySummary = empty.summary();
  assert.equal(emptySummary.entries, 0);
  assert.equal(emptySummary.headHash, "0000000000000000");
  assert.equal(empty.verify(), true, "empty ledger must verify");

  // ── 2. Append + summary aggregation ───────────────────────────────────
  const led = new PerformanceFeeLedger();
  led.record(evt("a", 100, 0));   // fee = 10
  led.record(evt("b", 200, 100)); // fee = 10
  led.record(evt("c", 50, 0, false)); // non-attributable, fee = 0
  const s = led.summary();
  assert.equal(s.entries, 3);
  assert.equal(s.grossUsd, 350);
  assert.equal(s.incrementalUsd, 200);
  assert.equal(s.feesCollectedUsd, 20);
  assert.equal(s.creatorTakeUsd, 330);
  assert.equal(s.feeRate, 0.10);

  // ── 3. Hash chain integrity ───────────────────────────────────────────
  assert.equal(led.verify(), true, "fresh chain must verify");
  const entries = led.all();
  assert.equal(entries[0]!.prevHash, "0000000000000000");
  for (let i = 1; i < entries.length; i++) {
    assert.equal(entries[i]!.prevHash, entries[i - 1]!.hash, `chain link ${i} must reference prev`);
  }

  // ── 4. Tamper detection ───────────────────────────────────────────────
  // Mutate an entry's hash → verify must fail.
  const mutated = new PerformanceFeeLedger();
  mutated.record(evt("a", 100, 0));
  mutated.record(evt("b", 200, 100));
  // @ts-expect-error reach into private to simulate tampering for the audit drill
  mutated.entries[1].hash = "deadbeefdeadbeef";
  assert.equal(mutated.verify(), false, "tampered hash must fail verification");

  // ── 5. Duplicate event rejection ──────────────────────────────────────
  const dup = new PerformanceFeeLedger();
  dup.record(evt("a", 100, 0));
  assert.throws(() => dup.record(evt("a", 999, 0)), /duplicate revenue event id/);

  // ── 6. Determinism — same event sequence → identical head hash ────────
  const led1 = new PerformanceFeeLedger();
  const led2 = new PerformanceFeeLedger();
  for (const e of [evt("a", 100, 0), evt("b", 200, 100), evt("c", 50, 0, false)]) {
    led1.record(e);
    led2.record(e);
  }
  assert.equal(led1.summary().headHash, led2.summary().headHash, "head hash must be deterministic");

  console.log("monetizer fee ledger: PASS");
}

run();
console.log("Done");
