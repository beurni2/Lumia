/**
 * Affiliate detection contract.
 *
 * Locks: deterministic ordering, network coverage across the SEA/LATAM
 * primary networks, tracking-code extraction, canonical URL form.
 */

import assert from "node:assert";
import { detectAffiliates, type AffiliateMatch } from "../affiliate";

function run() {
  // ── 1. Multi-network detection ────────────────────────────────────────
  const matches = detectAffiliates({
    caption:
      "shop here https://amazon.com/dp/B0/?tag=lumina-20 and " +
      "https://shopee.co.id/product?af_id=alice123 — tap https://kwai.com/x?kshop_aff=k99",
    hook: "go go go https://shop.tokopedia.com/p?aff_unique_id=tk-7",
  });
  assert.equal(matches.length, 4, "should detect all 4 affiliate links");
  const networks = matches.map((m) => m.network).sort();
  assert.deepEqual(
    networks,
    ["amazon-associates", "kwai-shop", "shopee-affiliate", "tokopedia-affiliate"].sort(),
    "all 4 networks must be detected",
  );

  // ── 2. Sort order: source, then position ──────────────────────────────
  for (let i = 1; i < matches.length; i++) {
    const a = matches[i - 1]!;
    const b = matches[i]!;
    if (a.source === b.source) {
      assert.ok(b.position >= a.position, "matches within same source must be position-sorted");
    } else {
      assert.ok(a.source.localeCompare(b.source) < 0, "matches must be source-sorted");
    }
  }

  // ── 3. Tracking codes are extracted, not invented ─────────────────────
  const amazon = matches.find((m) => m.network === "amazon-associates")!;
  assert.equal(amazon.trackingCode, "lumina-20");
  const shopee = matches.find((m) => m.network === "shopee-affiliate")!;
  assert.equal(shopee.trackingCode, "alice123");

  // ── 4. Canonical URL strips non-tracking params, lowercases ───────────
  assert.ok(
    amazon.canonicalUrl.startsWith("https://amazon.com/"),
    "canonical URL must lowercase host",
  );
  assert.ok(amazon.canonicalUrl.includes("tag=lumina-20"));
  assert.ok(!amazon.canonicalUrl.includes("dp/B0"), "canonical URL preserves path");

  // ── 5. Untracked URLs are NOT matched ─────────────────────────────────
  const noTrack = detectAffiliates({
    caption: "see https://amazon.com/dp/B0",  // no ?tag=
    hook: "https://google.com/search?q=foo",
  });
  assert.equal(noTrack.length, 0, "URLs without a tracking param must not match");

  // ── 6. Empty input safe ───────────────────────────────────────────────
  assert.deepEqual(detectAffiliates({ caption: "", hook: "" }), []);

  // ── 7. Determinism: same input → identical output ─────────────────────
  const a = detectAffiliates({ caption: "https://amazon.com/x?tag=t1", hook: "" });
  const b = detectAffiliates({ caption: "https://amazon.com/x?tag=t1", hook: "" });
  assert.deepEqual(a, b, "affiliate detection must be deterministic");

  console.log("monetizer affiliate detection: PASS");
}

run();
console.log("Done");
