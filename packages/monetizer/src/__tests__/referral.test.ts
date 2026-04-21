/**
 * Referral Rocket contract.
 *
 * Locks: deterministic referral codes, one-bounty-per-referee invariant,
 * self-referral guard, no-attribution → no-bounty, fixed BOUNTY_USD.
 */

import assert from "node:assert";
import { BOUNTY_USD, ReferralRocket, referralCodeFor } from "../referral";

function run() {
  // ── 1. Deterministic codes ────────────────────────────────────────────
  const code = referralCodeFor("alice-key-v1");
  assert.equal(code, referralCodeFor("alice-key-v1"), "referral code must be deterministic");
  assert.notEqual(code, referralCodeFor("alice-key-v2"), "different keys → different codes");
  assert.match(code, /^L[0-9A-F]{12}$/, "code must be L + 12 hex chars (uppercase)");

  // ── 2. Bounty fires on first payout for an attributed referee ─────────
  const r = new ReferralRocket();
  const aliceCode = referralCodeFor("alice");
  r.attribute("bob", aliceCode, 1000);
  const bounty = r.onRefereeFirstPayout({
    refereeKey: "bob",
    refereePayoutId: "po-1",
    now: 2000,
    resolveReferrer: (c) => (c === aliceCode ? "alice" : null),
  });
  assert.ok(bounty, "first payout for attributed referee must trigger bounty");
  assert.equal(bounty!.referrerKey, "alice");
  assert.equal(bounty!.refereeKey, "bob");
  assert.equal(bounty!.amountUsd, BOUNTY_USD);
  assert.equal(bounty!.refereePayoutId, "po-1");

  // ── 3. Second payout for same referee → no bounty ─────────────────────
  const second = r.onRefereeFirstPayout({
    refereeKey: "bob",
    refereePayoutId: "po-2",
    now: 3000,
    resolveReferrer: () => "alice",
  });
  assert.equal(second, null, "only the FIRST payout per referee triggers a bounty");

  // ── 4. No attribution → no bounty (but firstPayoutSeen still recorded)─
  const r2 = new ReferralRocket();
  const noAtt = r2.onRefereeFirstPayout({
    refereeKey: "carol",
    refereePayoutId: "po-3",
    now: 1000,
    resolveReferrer: () => null,
  });
  assert.equal(noAtt, null, "unattributed referee must yield no bounty");
  // Subsequent attribution attempts MUST still be storable, but the bounty
  // window has closed for carol — the next first-payout call no-ops.
  r2.attribute("carol", referralCodeFor("alice"), 2000);
  const late = r2.onRefereeFirstPayout({
    refereeKey: "carol",
    refereePayoutId: "po-4",
    now: 3000,
    resolveReferrer: () => "alice",
  });
  assert.equal(late, null, "post-window attribution must not retroactively pay");

  // ── 5. Self-referral is silently ignored ──────────────────────────────
  const r3 = new ReferralRocket();
  const selfCode = referralCodeFor("dave");
  const selfAtt = r3.attribute("dave", selfCode, 1000);
  assert.equal(selfAtt, null, "self-referral attribution must be rejected");

  // ── 6. Re-attribution is a no-op (locks attribution at first stamp) ───
  const r4 = new ReferralRocket();
  r4.attribute("eve", referralCodeFor("alice"), 1000);
  const reAtt = r4.attribute("eve", referralCodeFor("frank"), 2000);
  assert.equal(reAtt, null, "re-attribution must be ignored");

  // ── 7. Bounty list reflects all triggered bounties ────────────────────
  assert.equal(r.pendingBounties().length, 1);

  // ── 8. BOUNTY_USD constant drift detection ────────────────────────────
  assert.equal(BOUNTY_USD, 25, "Sprint 4 bounty default is $25");

  console.log("monetizer referral rocket: PASS");
}

run();
console.log("Done");
