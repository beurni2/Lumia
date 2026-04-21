/**
 * Affiliate auto-matcher.
 *
 * Bridges `detectAffiliates()` to the RevenueEvent stream the ledger consumes.
 * Sprint 4 simulates settlement using a deterministic per-network rate card;
 * Sprint 5 swaps the simulator for real partner-network webhooks while
 * preserving the function shape and the `attributableToLumina` discipline.
 *
 * Pure, deterministic, no IO. The `now` clock is injected so the same input
 * + clock always produces the same RevenueEvent set — which matters for the
 * ledger hash chain audit.
 */

import { detectAffiliates, type AffiliateMatch, type AffiliateNetwork, type ScanInput } from "./affiliate";
import type { Currency, RevenueEvent } from "./index";

/**
 * Indicative per-network blended commission rate for a 60s integration with
 * a 1K–50K creator (Sprint 4 desk rates from regional partner programs).
 * Rates are intentionally conservative so the ledger never over-projects.
 */
const NETWORK_RATE: Record<AffiliateNetwork, number> = {
  "amazon-associates":   0.04,
  "shopee-affiliate":    0.10,
  "lazada-affiliate":    0.08,
  "tokopedia-affiliate": 0.08,
  "magalu-parceiro":     0.06,
  "mercado-livre":       0.05,
  "tiktok-shop":         0.12,
  "kwai-shop":           0.10,
  "rakuten":             0.05,
  "linktree-monetized":  0.03,
};

/** Sprint 4 simulator — 0.4% projected click-to-purchase on 1K–50K reach. */
const PROJECTED_CONVERSION = 0.004 as const;
/** Avg basket size USD per network (deliberately conservative). */
const AVG_BASKET_USD: Record<AffiliateNetwork, number> = {
  "amazon-associates":   42,
  "shopee-affiliate":    18,
  "lazada-affiliate":    22,
  "tokopedia-affiliate": 19,
  "magalu-parceiro":     35,
  "mercado-livre":       28,
  "tiktok-shop":         24,
  "kwai-shop":           18,
  "rakuten":             52,
  "linktree-monetized":  20,
};

export interface AutoMatchInput {
  readonly videoId: string;
  readonly content: ScanInput;
  readonly projectedReach: number;        // estimated views in attribution window
  readonly creatorBaselineUsd: number;    // creator's pre-Lumina baseline for the slot
  readonly currency: Currency;            // settlement currency for the simulated revenue
  readonly now: number;
}

export interface AutoMatchResult {
  readonly matches: readonly AffiliateMatch[];
  readonly events: readonly RevenueEvent[];
  readonly projectedGrossUsd: number;
}

/**
 * Scan video metadata, derive simulated RevenueEvents, return both. The
 * caller pipes `events` straight into the PerformanceFeeLedger.
 */
export function autoMatchAffiliates(input: AutoMatchInput): AutoMatchResult {
  const matches = detectAffiliates(input.content);
  if (matches.length === 0) {
    return { matches: [], events: [], projectedGrossUsd: 0 };
  }
  // Even split of projected reach across detected affiliate links — the
  // simulator does NOT favor first-position links so the ledger isn't
  // sensitive to caption order.
  const reachPerLink = input.projectedReach / matches.length;
  // Per-creator baseline split across links so the incremental rule still
  // applies: revenue Lumina creates above what the creator would have made.
  const baselinePerLink = input.creatorBaselineUsd / matches.length;

  let totalGrossUsd = 0;
  const events: RevenueEvent[] = matches.map((m, i) => {
    const conversions = reachPerLink * PROJECTED_CONVERSION;
    const grossUsd = round2(conversions * AVG_BASKET_USD[m.network] * NETWORK_RATE[m.network]);
    totalGrossUsd += grossUsd;
    return {
      id: `aff-${input.videoId}-${i}`,
      videoId: input.videoId,
      amount: grossUsd,
      currency: input.currency,
      source: "affiliate",
      occurredAt: input.now,
      attributableToLumina: true,
      baseline: round2(baselinePerLink),
    };
  });

  return {
    matches,
    events,
    projectedGrossUsd: round2(totalGrossUsd),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
