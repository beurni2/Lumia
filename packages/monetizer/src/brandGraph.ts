/**
 * Brand reputation graph + Deal Router.
 *
 * Sprint 4 starter — in-memory deterministic reputation graph. Sprint 5
 * swaps the storage layer for a stateless cloud router (per ROADMAP.md
 * Sprint 4 acceptance: "Deal Router (cloud, stateless) with reputation-
 * scored brand graph").
 *
 * Reputation score is computed from observed outcomes: paidOnTime increments,
 * disputeFiled / ghosted decrements. Scores are clamped [0, 1] and decay
 * deterministically based on the supplied `now` clock — no Date.now() calls
 * inside the graph itself, so all behaviour is replayable for audit.
 */

import type { CulturalRegion, DealRouter } from "./types";

export interface BrandRecord {
  readonly id: string;
  readonly handle: string;
  readonly region: CulturalRegion;
  /** Typical USD payout for a 60s integration with a 1K–50K creator. */
  readonly typicalPayoutUsd: number;
  /** Free-form tags used by the matcher (e.g. "fashion", "halal", "fmcg"). */
  readonly tags: readonly string[];
}

export interface ReputationEvent {
  readonly brandId: string;
  readonly kind: "paid-on-time" | "paid-late" | "disputed" | "ghosted";
  readonly occurredAt: number;
}

export interface BrandMatch {
  readonly brandId: string;
  readonly handle: string;
  readonly score: number;       // composite match score in [0, 1]
  readonly reputation: number;  // reputation score in [0, 1]
  readonly typicalPayoutUsd: number;
  readonly reason: string;
}

const REP_BASE = 0.5;
const REP_DELTA = {
  "paid-on-time": +0.10,
  "paid-late":    -0.05,
  "disputed":     -0.20,
  "ghosted":      -0.30,
} as const;
/** Reputation half-life: each 30 days, the delta from REP_BASE halves. */
const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;

export class InMemoryBrandGraph implements DealRouter {
  private readonly brands = new Map<string, BrandRecord>();
  private readonly events: ReputationEvent[] = [];

  registerBrand(b: BrandRecord): void {
    this.brands.set(b.id, b);
  }

  recordEvent(e: ReputationEvent): void {
    this.events.push(e);
  }

  /**
   * Reputation in [0, 1] at time `now`. Deterministic — given the same event
   * log + clock the result is bit-identical.
   */
  reputation(brandId: string, now: number): number {
    let score = REP_BASE;
    for (const e of this.events) {
      if (e.brandId !== brandId) continue;
      const ageMs = Math.max(0, now - e.occurredAt);
      const decay = Math.pow(0.5, ageMs / HALF_LIFE_MS);
      score += REP_DELTA[e.kind] * decay;
    }
    return clamp01(score);
  }

  // ── DealRouter contract ──────────────────────────────────────────────
  async matchBrands(
    videoId: string,
    region: string,
  ): Promise<Array<{ brandId: string; score: number }>> {
    const matches = this.matchBrandsSync(videoId, region as CulturalRegion, {
      now: 0,
      tags: [],
      videoSeed: videoId,
    });
    return matches.map((m) => ({ brandId: m.brandId, score: m.score }));
  }

  async draftPitch(videoId: string, brandId: string): Promise<string> {
    const brand = this.brands.get(brandId);
    if (!brand) throw new Error(`brand not registered: ${brandId}`);
    return [
      `Pitch ${brand.handle} for video ${videoId}`,
      `Region: ${brand.region}, typical payout USD ${brand.typicalPayoutUsd}.`,
    ].join("\n");
  }

  /**
   * Deterministic ranked match. Composite score:
   *   tagOverlap·0.5 + reputation·0.4 + payoutFit·0.1
   * Ties broken by brandId (lexicographic) so re-runs are bit-identical.
   */
  matchBrandsSync(
    videoId: string,
    region: CulturalRegion,
    opts: { now: number; tags: readonly string[]; videoSeed: string; limit?: number },
  ): BrandMatch[] {
    const limit = opts.limit ?? 5;
    const candidates = [...this.brands.values()].filter((b) => b.region === region);
    const ranked = candidates
      .map((b) => {
        const overlap = jaccard(opts.tags, b.tags);
        const reputation = this.reputation(b.id, opts.now);
        const payoutFit = clamp01(b.typicalPayoutUsd / 600);
        const score = clamp01(overlap * 0.5 + reputation * 0.4 + payoutFit * 0.1);
        return {
          brandId: b.id,
          handle: b.handle,
          score,
          reputation,
          typicalPayoutUsd: b.typicalPayoutUsd,
          reason: `tag-overlap=${overlap.toFixed(2)} rep=${reputation.toFixed(2)} fit=${payoutFit.toFixed(2)}`,
        };
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.brandId.localeCompare(b.brandId);
      })
      .slice(0, limit);
    return ranked;
  }
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const A = new Set(a.map((x) => x.toLowerCase()));
  const B = new Set(b.map((x) => x.toLowerCase()));
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
