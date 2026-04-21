import {
  InMemoryEscrow,
  LocalWallet,
  PerformanceFeeLedger,
  REFEREE_BOUNTY_USD,
  REFERRER_BOUNTY_USD,
  ReferralRocket,
  referralCodeFor,
  type Currency,
  type DepositSource,
  type ReferralBounty,
  type RevenueEvent,
  type WalletEntry,
} from "@workspace/monetizer";
import { runEarningsCycle } from "@workspace/swarm-studio";

import { TREND_BRIEFS, EARNINGS } from "@/constants/mockData";

/**
 * "While You Slept" morning recap — Sprint 4.
 *
 * Pure-data factory that exercises the Sprint 4 monetizer surface end to end
 * (auto-match → ledger → escrow → wallet deposit → referral bounty) and
 * shapes the result into a UI-ready recap. Dark-first, deterministic, no IO.
 *
 * Sprint 5 swaps the seeded `RevenueEvent` set for the real overnight feed
 * coming back from the platform clients + affiliate network webhooks; the
 * shape of `MorningRecap` stays.
 */

const DEMO_NIGHT_MS = 1_700_000_000_000;

/** What the user sees: one earned-credit row per wallet entry. */
export interface RecapDeposit {
  readonly id: string;
  readonly label: string;
  readonly amount: number;
  readonly currency: Currency;
  readonly source: DepositSource;
}

export interface RecapBriefSlot {
  readonly id: string;
  readonly title: string;
  readonly hook: string;
  readonly viralPotential: number;
}

export interface MorningRecap {
  readonly generatedAt: number;
  /** Hours of work the swarm did while the creator slept. Always 8h for the demo. */
  readonly hoursAsleep: number;
  /** Deposits that landed overnight, ordered by seq. */
  readonly deposits: readonly RecapDeposit[];
  /** Sum of all USD-equivalent deposits (rough — currencies kept untouched). */
  readonly totalsByCurrency: Readonly<Partial<Record<Currency, number>>>;
  /** Did Lumina trigger a referral cash-out for the creator's network? */
  readonly bounty: {
    readonly fired: boolean;
    readonly referrerCreditUsd: number;
    readonly refereeCreditUsd: number;
    readonly referrerKey?: string;
    readonly bountyId?: string;
  };
  /** Stable referral code the watermark embeds. */
  readonly referralCode: string;
  /** Tomorrow's content plan — the next 3 trend briefs the swarm will tackle. */
  readonly tomorrowPlan: readonly RecapBriefSlot[];
  /** Headline for the hero card (copy-ready). */
  readonly headline: string;
  /** One-line subtitle under the headline. */
  readonly subtitle: string;
}

/**
 * Build a deterministic recap. Pure and idempotent — call as often as the
 * UI re-renders. Sprint 5 swaps `seedNightEvents()` for the real feed.
 */
export async function buildMorningRecap(creatorKey: string): Promise<MorningRecap> {
  const ledger = new PerformanceFeeLedger();
  const escrow = new InMemoryEscrow(() => DEMO_NIGHT_MS);
  const referrals = new ReferralRocket();
  const wallet = new LocalWallet();

  // Seed an attribution so the recap always shows the bounty-fired path —
  // this is the demo's "Maria was referred by Aisha last week" story.
  const referrerKey = "demo-referrer-aisha";
  referrals.attribute(creatorKey, referralCodeFor(referrerKey), DEMO_NIGHT_MS - 86_400_000);

  const events = seedNightEvents(creatorKey);

  let referrerCreditCaptured = 0;
  let bountyCaptured: ReferralBounty | null = null;

  await runEarningsCycle(
    {
      creatorId: creatorKey,
      creatorRegion: "br",
      creatorKey,
      ledger,
      escrow,
      referrals,
      wallet,
      resolveReferrer: (code) => (code === referralCodeFor(referrerKey) ? referrerKey : null),
      depositReferrerBounty: (b) => {
        referrerCreditCaptured += b.referrerCreditUsd;
        bountyCaptured = b;
        return true;
      },
    },
    {
      events,
      // Exercise the auto-match step end-to-end so the recap genuinely
      // walks the full Sprint 4 flywheel (affiliate scan → simulated
      // RevenueEvent[] → ledger → escrow → wallet). The seeded caption
      // contains a Shopee link the matcher will pick up deterministically.
      autoMatch: {
        videoId: `night-${creatorKey}-auto`,
        content: {
          caption: "Tap the Shopee link in bio for the gloss → https://shopee.com.br/product/123/456",
          hook: "Find the gloss everyone's been asking about ↓",
        },
        projectedReach: 12_000,
        creatorBaselineUsd: 0,
        currency: "USD",
        now: DEMO_NIGHT_MS - 7_200_000,
      },
    },
    DEMO_NIGHT_MS,
  );

  const deposits = wallet.ledger().map(toRecapDeposit);
  const totalsByCurrency = wallet.summary().balances;

  const bounty = bountyCaptured as ReferralBounty | null;
  const bountyFired = bounty !== null;

  // Tomorrow's plan — pull the top 3 viral-potential briefs.
  const tomorrowPlan: RecapBriefSlot[] = [...TREND_BRIEFS]
    .sort((a, b) => b.viralPotential - a.viralPotential)
    .slice(0, 3)
    .map((t) => ({
      id: t.id,
      title: t.title,
      hook: t.context,
      viralPotential: t.viralPotential,
    }));

  const totalUsdEquivalent = (totalsByCurrency.USD ?? 0) + referrerCreditCaptured;
  const otherCurrencies = Object.entries(totalsByCurrency)
    .filter(([c, v]) => c !== "USD" && (v ?? 0) > 0)
    .map(([c, v]) => `${c} ${(v ?? 0).toLocaleString()}`)
    .join(" · ");

  const headline = bountyFired
    ? `You earned $${totalUsdEquivalent.toFixed(2)} while you slept`
    : `You earned $${totalUsdEquivalent.toFixed(2)} overnight`;

  const subtitle = otherCurrencies
    ? `…plus ${otherCurrencies} from regional payouts.`
    : "…the swarm worked an 8-hour shift so you didn't have to.";

  return {
    generatedAt: DEMO_NIGHT_MS,
    hoursAsleep: 8,
    deposits,
    totalsByCurrency,
    bounty: {
      fired: bountyFired,
      referrerCreditUsd: bountyFired ? bounty!.referrerCreditUsd : 0,
      refereeCreditUsd: bountyFired ? bounty!.refereeCreditUsd : 0,
      referrerKey: bountyFired ? bounty!.referrerKey : undefined,
      bountyId: bountyFired ? bounty!.bountyId : undefined,
    },
    referralCode: referralCodeFor(creatorKey),
    tomorrowPlan,
    headline,
    subtitle,
  };
}

const SOURCE_LABELS: Record<DepositSource, string> = {
  "performance-fee-creator-take": "Creator take from overnight payout",
  "referral-bounty-referrer": "Referral bounty (you referred a friend)",
  "referral-bounty-referee": "Welcome bounty (you joined via a friend)",
  "manual-credit": "Manual credit",
};

function toRecapDeposit(e: WalletEntry): RecapDeposit {
  return {
    id: `dep-${e.seq}`,
    label: SOURCE_LABELS[e.source],
    amount: e.amount,
    currency: e.currency,
    source: e.source,
  };
}

/**
 * Deterministic overnight feed for the demo. Three integrations land in
 * three currencies; sums are well below the 12-month $1.5K threshold so
 * the ledger genuinely exercises the 10%-on-incremental rule end to end.
 */
function seedNightEvents(creatorKey: string): RevenueEvent[] {
  const at = DEMO_NIGHT_MS - 4 * 3600 * 1000; // 4h before "wake up"
  return [
    {
      id: `night-${creatorKey}-1`,
      videoId: "v-night-1",
      amount: EARNINGS?.deals?.[0]?.amount ? Math.min(EARNINGS.deals[0].amount, 220) : 220,
      currency: "BRL",
      source: "brand-deal",
      occurredAt: at,
      attributableToLumina: true,
      baseline: 60,
    },
    {
      id: `night-${creatorKey}-2`,
      videoId: "v-night-2",
      amount: 95,
      currency: "USD",
      source: "affiliate",
      occurredAt: at + 1800_000,
      attributableToLumina: true,
      baseline: 0,
    },
    {
      id: `night-${creatorKey}-3`,
      videoId: "v-night-3",
      amount: 18,
      currency: "USD",
      source: "tip",
      occurredAt: at + 3600_000,
      attributableToLumina: true,
      baseline: 0,
    },
  ];
}

export const REFERRAL_BOUNTY_BREAKDOWN = {
  referrerUsd: REFERRER_BOUNTY_USD,
  refereeUsd: REFEREE_BOUNTY_USD,
} as const;
