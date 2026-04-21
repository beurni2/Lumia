/**
 * 100-fixture fee accounting test.
 *
 * Per ROADMAP.md Sprint 4 acceptance:
 *   "Unit: fee accounting against 100 fixture revenue scenarios."
 *
 * Generates 100 deterministic RevenueEvents covering:
 *   - non-attributable (no fee)
 *   - attributable with baseline > amount (no fee)
 *   - attributable with positive incremental (10% fee)
 *   - boundary cases: zero amount, zero baseline, equal amount/baseline
 *
 * The fee invariants checked on every fixture:
 *   1. fee + creatorTake === gross (within rounding tolerance)
 *   2. fee === round2(incremental * 0.10)
 *   3. incremental === max(0, gross - baseline) when attributable
 *   4. incremental === 0 when not attributable (fee === 0)
 *   5. fee >= 0 (no negative fees ever)
 */

import assert from "node:assert";
import {
  PERFORMANCE_FEE_RATE,
  calculateFee,
  type RevenueEvent,
} from "../index";

const TOLERANCE = 0.01;

function makeFixture(i: number): RevenueEvent {
  // Deterministic seeded PRNG (LCG) — same input → same fixture.
  let s = (i * 2654435761) >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };

  const mode = i % 5;
  const amount = round2(rand() * 1000);
  let baseline: number;
  let attributableToLumina: boolean;
  switch (mode) {
    case 0: // non-attributable
      baseline = round2(rand() * 1000);
      attributableToLumina = false;
      break;
    case 1: // baseline > amount (no incremental)
      baseline = amount + round2(rand() * 200) + 1;
      attributableToLumina = true;
      break;
    case 2: // baseline === amount (no incremental)
      baseline = amount;
      attributableToLumina = true;
      break;
    case 3: // baseline === 0 (full incremental)
      baseline = 0;
      attributableToLumina = true;
      break;
    default: // partial incremental
      baseline = round2(amount * rand() * 0.8);
      attributableToLumina = true;
  }

  return {
    id: `fix-${i.toString().padStart(3, "0")}`,
    videoId: `vid-${(i % 10).toString().padStart(2, "0")}`,
    amount,
    currency: "USD",
    source: ["affiliate", "brand-deal", "tip", "platform-rev-share"][i % 4] as RevenueEvent["source"],
    occurredAt: 1_700_000_000_000 + i * 60_000,
    attributableToLumina,
    baseline,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function run() {
  assert.equal(PERFORMANCE_FEE_RATE, 0.10, "fee rate must be 10% — drift detection");

  let totalFees = 0;
  let zeroFeeCount = 0;
  let nonZeroFeeCount = 0;

  for (let i = 0; i < 100; i++) {
    const evt = makeFixture(i);
    const calc = calculateFee(evt);

    // ── Invariant 1: fee + creatorTake === gross ────────────────────────
    assert.ok(
      Math.abs(calc.fee + calc.creatorTake - calc.gross) <= TOLERANCE,
      `fixture ${evt.id}: fee+take must equal gross (${calc.fee} + ${calc.creatorTake} != ${calc.gross})`,
    );

    // ── Invariant 2: fee === round2(incremental * 0.10) ─────────────────
    assert.ok(
      Math.abs(calc.fee - round2(calc.incremental * PERFORMANCE_FEE_RATE)) <= TOLERANCE,
      `fixture ${evt.id}: fee must equal 10% of incremental`,
    );

    // ── Invariant 3 / 4: incremental rule ───────────────────────────────
    if (evt.attributableToLumina) {
      const expected = Math.max(0, evt.amount - evt.baseline);
      assert.equal(calc.incremental, expected, `fixture ${evt.id}: incremental mismatch`);
    } else {
      assert.equal(calc.incremental, 0, `fixture ${evt.id}: non-attributable must have zero incremental`);
      assert.equal(calc.fee, 0, `fixture ${evt.id}: non-attributable must have zero fee`);
    }

    // ── Invariant 5: no negative fees ───────────────────────────────────
    assert.ok(calc.fee >= 0, `fixture ${evt.id}: fee must be >= 0`);

    totalFees += calc.fee;
    if (calc.fee === 0) zeroFeeCount++;
    else nonZeroFeeCount++;
  }

  // Coverage sanity — both branches must be exercised by the corpus.
  assert.ok(zeroFeeCount > 20, `expected >20 zero-fee fixtures, got ${zeroFeeCount}`);
  assert.ok(nonZeroFeeCount > 20, `expected >20 nonzero-fee fixtures, got ${nonZeroFeeCount}`);
  assert.ok(totalFees > 0, "aggregate fees across 100 fixtures must be positive");

  console.log(
    `monetizer fee accounting (100 fixtures): PASS — ${nonZeroFeeCount} fee-bearing, ${zeroFeeCount} zero-fee, total $${totalFees.toFixed(2)}`,
  );
}

run();
console.log("Done");
