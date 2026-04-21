/**
 * Affiliate auto-matcher contract.
 *
 * Locks: deterministic event derivation, attributableToLumina=true,
 * baseline split across links, zero matches → zero events, currency
 * propagation.
 */

import assert from "node:assert";
import { autoMatchAffiliates } from "../affiliateMatcher";

function run() {
  // ── 1. No detected affiliates → empty result ─────────────────────────
  const empty = autoMatchAffiliates({
    videoId: "v0",
    content: { caption: "no links here", hook: "hi" },
    projectedReach: 100_000,
    creatorBaselineUsd: 10,
    currency: "BRL",
    now: 1000,
  });
  assert.equal(empty.matches.length, 0);
  assert.equal(empty.events.length, 0);
  assert.equal(empty.projectedGrossUsd, 0);

  // ── 2. Detected affiliates produce one RevenueEvent each ─────────────
  const r = autoMatchAffiliates({
    videoId: "v1",
    content: {
      caption: "shop https://shopee.com.br/product/123?af_id=mariafit and https://www.amazon.com.br/dp/3xyz?tag=mariafit-20",
      hook: "must-haves: https://www.lazada.co.id/product/abc?sub_aff_id=mariafit",
    },
    projectedReach: 50_000,
    creatorBaselineUsd: 30,
    currency: "BRL",
    now: 2000,
  });
  assert.equal(r.matches.length, 3, "3 affiliate links → 3 matches");
  assert.equal(r.events.length, 3, "1:1 match → event mapping");
  for (const e of r.events) {
    assert.equal(e.attributableToLumina, true, "all auto-matched events are attributable to Lumina");
    assert.equal(e.source, "affiliate");
    assert.equal(e.currency, "BRL");
    assert.equal(e.videoId, "v1");
    assert.equal(e.occurredAt, 2000);
    assert.equal(e.baseline, 10, "baseline split evenly across the 3 links (30/3=10)");
    assert.ok(e.amount > 0, "auto-match revenue must be positive");
  }
  assert.ok(r.projectedGrossUsd > 0);

  // ── 3. Determinism: same input → identical events ────────────────────
  const r2 = autoMatchAffiliates({
    videoId: "v1",
    content: {
      caption: "shop https://shopee.com.br/product/123?af_id=mariafit and https://www.amazon.com.br/dp/3xyz?tag=mariafit-20",
      hook: "must-haves: https://www.lazada.co.id/product/abc?sub_aff_id=mariafit",
    },
    projectedReach: 50_000,
    creatorBaselineUsd: 30,
    currency: "BRL",
    now: 2000,
  });
  assert.deepEqual(r2.events, r.events, "auto-match must be deterministic");

  // ── 4. Reach scales projected revenue linearly ───────────────────────
  const big = autoMatchAffiliates({
    videoId: "v2",
    content: { caption: "https://shopee.com.br/x?af_id=z", hook: "" },
    projectedReach: 100_000,
    creatorBaselineUsd: 0,
    currency: "USD",
    now: 3000,
  });
  const small = autoMatchAffiliates({
    videoId: "v3",
    content: { caption: "https://shopee.com.br/x?af_id=z", hook: "" },
    projectedReach: 50_000,
    creatorBaselineUsd: 0,
    currency: "USD",
    now: 3000,
  });
  assert.ok(
    Math.abs(big.events[0]!.amount / Math.max(small.events[0]!.amount, 0.01) - 2) < 0.05,
    "doubling reach must roughly double projected revenue",
  );

  console.log("monetizer affiliate auto-matcher: PASS");
}

run();
console.log("Done");
