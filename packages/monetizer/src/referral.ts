/**
 * Referral Rocket — both parties earn real cash.
 *
 * Sprint 4 acceptance: "Referral Rocket: smart watermark + referral code +
 * cash payout on referee's first payout."
 *
 * Updated for Sprint 4 close: BOTH the referrer AND the referee earn a
 * real-cash credit when the referee's FIRST payout settles. The bounty
 * carries two amounts so the wallet ledger can deposit the correct credit
 * into each side under its own attribution source.
 *
 * Hard contract:
 *   - Every creator gets exactly one deterministic referralCode derived from
 *     creatorKey (collision-safe via 12-hex FNV-1a).
 *   - Stamped attribution is permanent — re-attribution is silently ignored.
 *   - Self-referral is rejected.
 *   - Bounty fires exactly once per referee, on their first payout.
 *   - Both `referrerCreditUsd` and `refereeCreditUsd` are paid simultaneously
 *     from the same triggering event so the wallet ledgers stay symmetric.
 */

export const REFERRER_BOUNTY_USD = 25 as const;
export const REFEREE_BOUNTY_USD = 25 as const;
/** Back-compat alias — same value as the referrer side. */
export const BOUNTY_USD = REFERRER_BOUNTY_USD;

export interface ReferralLink {
  readonly referrerKey: string;
  readonly referralCode: string;
}

export interface ReferralAttribution {
  readonly refereeKey: string;
  readonly referralCode: string;
  readonly attributedAt: number;
}

export interface ReferralBounty {
  readonly referrerKey: string;
  readonly refereeKey: string;
  readonly referrerCreditUsd: number;
  readonly refereeCreditUsd: number;
  /** Total payout = referrer + referee. Convenience aggregate. */
  readonly totalCreditUsd: number;
  readonly triggeredAt: number;
  readonly refereePayoutId: string;
  /** Stable id usable as a wallet `reference` field. */
  readonly bountyId: string;
}

export function referralCodeFor(creatorKey: string): string {
  return "L" + fnv1a12(creatorKey).toUpperCase();
}

export class ReferralRocket {
  private readonly attributions = new Map<string, ReferralAttribution>();
  /** Refereees whose bounty has been **committed** (both sides paid). Terminal. */
  private readonly firstPayoutSeen = new Set<string>();
  /**
   * Refereees whose bounty has been issued but not yet committed. Prevents
   * double-trigger within a single cycle. Cleared on `commitBounty()` or
   * `releaseBounty()` so the agent can retry on the next cycle if either
   * deposit failed mid-flight.
   */
  private readonly inFlight = new Set<string>();
  private readonly bounties: ReferralBounty[] = [];

  /**
   * Stamp an incoming creator with the referrer's code. Only the first call
   * per refereeKey takes effect — subsequent attributions are ignored so
   * codes cannot be re-attributed once a creator joins.
   */
  attribute(refereeKey: string, referralCode: string, now: number): ReferralAttribution | null {
    if (this.attributions.has(refereeKey)) return null;
    if (referralCodeFor(refereeKey) === referralCode) return null; // no self-referrals
    const att: ReferralAttribution = { refereeKey, referralCode, attributedAt: now };
    this.attributions.set(refereeKey, att);
    return att;
  }

  /**
   * Triggered by the ledger on a referee's first settled payout. Returns a
   * **reserved** bounty (both sides' credits) the caller must then either
   * `commitBounty()` (after both deposits succeed) or `releaseBounty()` (so
   * the next cycle retries). Returns null if no attribution / already paid /
   * already in flight.
   *
   * The "no attribution" / "unresolvable referrer" / "self-referral" branches
   * are still terminal — those bounties can never be earned, so we mark them
   * `firstPayoutSeen` immediately to short-circuit future cycles.
   */
  onRefereeFirstPayout(opts: {
    refereeKey: string;
    refereePayoutId: string;
    now: number;
    /** Resolves a referralCode back to the referrer's creatorKey. */
    resolveReferrer: (code: string) => string | null;
  }): ReferralBounty | null {
    if (this.firstPayoutSeen.has(opts.refereeKey)) return null;
    if (this.inFlight.has(opts.refereeKey)) return null;
    const att = this.attributions.get(opts.refereeKey);
    if (!att) {
      this.firstPayoutSeen.add(opts.refereeKey);
      return null;
    }
    const referrerKey = opts.resolveReferrer(att.referralCode);
    if (!referrerKey) {
      this.firstPayoutSeen.add(opts.refereeKey);
      return null;
    }
    if (referrerKey === opts.refereeKey) {
      // Defensive — should be impossible thanks to attribute()'s self-referral
      // guard, but the bounty surface is the source of truth either way.
      this.firstPayoutSeen.add(opts.refereeKey);
      return null;
    }
    const bounty: ReferralBounty = {
      referrerKey,
      refereeKey: opts.refereeKey,
      referrerCreditUsd: REFERRER_BOUNTY_USD,
      refereeCreditUsd: REFEREE_BOUNTY_USD,
      totalCreditUsd: REFERRER_BOUNTY_USD + REFEREE_BOUNTY_USD,
      triggeredAt: opts.now,
      refereePayoutId: opts.refereePayoutId,
      bountyId: `bounty-${opts.refereePayoutId}`,
    };
    this.inFlight.add(opts.refereeKey);
    return bounty;
  }

  /**
   * Caller successfully deposited BOTH sides of the bounty — lock it in.
   * Idempotent: re-committing the same refereeKey is a no-op.
   */
  commitBounty(bounty: ReferralBounty): void {
    if (this.firstPayoutSeen.has(bounty.refereeKey)) return;
    this.inFlight.delete(bounty.refereeKey);
    this.firstPayoutSeen.add(bounty.refereeKey);
    this.bounties.push(bounty);
  }

  /**
   * Caller failed to deposit one or both sides — release the reservation so
   * the next cycle can re-issue and retry. Does NOT mark the referee as seen.
   */
  releaseBounty(bounty: ReferralBounty): void {
    this.inFlight.delete(bounty.refereeKey);
  }

  pendingBounties(): readonly ReferralBounty[] {
    return this.bounties;
  }

  /**
   * Has the supplied refereeKey ever been stamped with an attribution?
   * Used by the morning recap to show "you joined via @alice" copy.
   */
  attributionFor(refereeKey: string): ReferralAttribution | null {
    return this.attributions.get(refereeKey) ?? null;
  }
}

function fnv1a12(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  const hex = h.toString(16).padStart(8, "0");
  return (hex + hex).slice(0, 12);
}
