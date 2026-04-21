/**
 * Referral Rocket contract — Sprint 4 (both parties earn).
 *
 * Locks: deterministic referral codes, one-bounty-per-referee invariant,
 * self-referral guard, no-attribution → no-bounty, fixed bounty constants
 * for BOTH the referrer AND the referee, total = sum of the two sides.
 */

import assert from "node:assert";
import {
  BOUNTY_USD,
  REFERRER_BOUNTY_USD,
  REFEREE_BOUNTY_USD,
  ReferralRocket,
  referralCodeFor,
} from "../referral";

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
  assert.equal(bounty!.referrerCreditUsd, REFERRER_BOUNTY_USD);
  assert.equal(bounty!.refereeCreditUsd, REFEREE_BOUNTY_USD);
  assert.equal(bounty!.totalCreditUsd, REFERRER_BOUNTY_USD + REFEREE_BOUNTY_USD);
  assert.equal(bounty!.refereePayoutId, "po-1");
  assert.equal(bounty!.bountyId, "bounty-po-1", "bountyId must be derivable from payoutId");

  // ── 3. While a bounty is in-flight (not yet committed), no double-trigger
  const dup = r.onRefereeFirstPayout({
    refereeKey: "bob",
    refereePayoutId: "po-1b",
    now: 2500,
    resolveReferrer: () => "alice",
  });
  assert.equal(dup, null, "in-flight bounty must not double-issue");

  // Commit the bounty → it becomes terminal, second payout never re-triggers
  r.commitBounty(bounty!);
  const second = r.onRefereeFirstPayout({
    refereeKey: "bob",
    refereePayoutId: "po-2",
    now: 3000,
    resolveReferrer: () => "alice",
  });
  assert.equal(second, null, "only the FIRST committed payout per referee triggers a bounty");

  // Re-committing the same bounty must be a no-op (idempotent)
  r.commitBounty(bounty!);
  assert.equal(r.pendingBounties().length, 1, "commit is idempotent");

  // ── 4. No attribution → no bounty (but firstPayoutSeen still recorded)─
  const r2 = new ReferralRocket();
  const noAtt = r2.onRefereeFirstPayout({
    refereeKey: "carol",
    refereePayoutId: "po-3",
    now: 1000,
    resolveReferrer: () => null,
  });
  assert.equal(noAtt, null, "unattributed referee must yield no bounty");
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

  // ── 7. Bounty list reflects all COMMITTED bounties ────────────────────
  assert.equal(r.pendingBounties().length, 1);

  // ── 7a. Retry-after-failure semantics ────────────────────────────────
  // Reservation is released → next cycle can re-issue and commit cleanly.
  const r5 = new ReferralRocket();
  const grace = referralCodeFor("alice");
  r5.attribute("grace", grace, 1000);
  const tryOne = r5.onRefereeFirstPayout({
    refereeKey: "grace",
    refereePayoutId: "po-x",
    now: 2000,
    resolveReferrer: () => "alice",
  });
  assert.ok(tryOne, "first reservation succeeds");
  // Simulate downstream payout failure → release the reservation.
  r5.releaseBounty(tryOne!);
  assert.equal(r5.pendingBounties().length, 0, "released bounty must NOT appear in committed list");
  const tryTwo = r5.onRefereeFirstPayout({
    refereeKey: "grace",
    refereePayoutId: "po-y",
    now: 3000,
    resolveReferrer: () => "alice",
  });
  assert.ok(tryTwo, "after release, retry MUST succeed (atomic dual-credit invariant)");
  assert.equal(tryTwo!.bountyId, "bounty-po-y");
  r5.commitBounty(tryTwo!);
  // Now further attempts must be locked.
  const tryThree = r5.onRefereeFirstPayout({
    refereeKey: "grace",
    refereePayoutId: "po-z",
    now: 4000,
    resolveReferrer: () => "alice",
  });
  assert.equal(tryThree, null, "after commit, no further bounties for the same referee");

  // ── 8. Bounty constants drift detection ───────────────────────────────
  assert.equal(REFERRER_BOUNTY_USD, 25, "Sprint 4 referrer bounty default is $25");
  assert.equal(REFEREE_BOUNTY_USD, 25, "Sprint 4 referee bounty default is $25");
  assert.equal(BOUNTY_USD, REFERRER_BOUNTY_USD, "BOUNTY_USD back-compat alias must equal referrer side");

  // ── 9. attributionFor surface (used by morning-recap copy) ────────────
  assert.ok(r.attributionFor("bob"), "attributionFor must return the stamped record");
  assert.equal(r.attributionFor("nobody"), null);

  console.log("monetizer referral rocket: PASS");
}

run();
console.log("Done");
