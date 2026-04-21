import { calculateFee, type RevenueEvent } from "@workspace/monetizer";
import type { CulturalRegion, DealDraft, RenderedVideo } from "../types";

/**
 * Monetizer agent — drafts brand pitches sized to the rendered video's viral
 * confidence and the creator's region. Uses @workspace/monetizer's pure
 * `calculateFee()` so the 10%-on-incremental rule is consistent everywhere.
 *
 * Sprint 2 picks brands from a hand-curated regional pool. Sprint 4's
 * DealRouter replaces this with the live brand-match index.
 */
const REGIONAL_BRANDS: Record<CulturalRegion, Array<{ handle: string; usd: number; channel: DealDraft["channel"] }>> = {
  // Day-1 English-first markets (v2.0 GTM blueprint)
  us: [
    { handle: "@gymshark",           usd: 750, channel: "instagram" },
    { handle: "@glossier",           usd: 620, channel: "instagram" },
    { handle: "@aloyoga",            usd: 540, channel: "tiktok"    },
  ],
  gb: [
    { handle: "@asos",               usd: 460, channel: "instagram" },
    { handle: "@gymshark",           usd: 590, channel: "tiktok"    },
  ],
  ca: [{ handle: "@lululemon",       usd: 510, channel: "instagram" }],
  au: [{ handle: "@cottononau",      usd: 380, channel: "instagram" }],
  in: [
    { handle: "@mamaearth.in",       usd: 290, channel: "instagram" },
    { handle: "@boat.nirvana",       usd: 340, channel: "whatsapp"  },
  ],
  ng: [{ handle: "@oraimo",          usd: 230, channel: "whatsapp"  }],
  // Phase 1 SEA/LATAM markets (engine-ready, layered remotely months 2–6)
  br: [
    { handle: "@reservaoficial",     usd: 380, channel: "instagram" },
    { handle: "@cea_brasil",         usd: 220, channel: "instagram" },
    { handle: "@havaianas",          usd: 540, channel: "tiktok"    },
  ],
  mx: [
    { handle: "@liverpool_mexico",   usd: 320, channel: "instagram" },
    { handle: "@cervezaindio",       usd: 410, channel: "tiktok"    },
  ],
  co: [{ handle: "@juanvaldezcafe",  usd: 260, channel: "instagram" }],
  ar: [{ handle: "@quilmescerveza",  usd: 290, channel: "instagram" }],
  id: [
    { handle: "@erigostore",         usd: 180, channel: "instagram" },
    { handle: "@gojekindonesia",     usd: 240, channel: "whatsapp"  },
  ],
  ph: [{ handle: "@jollibee",        usd: 310, channel: "tiktok"    }],
  vn: [{ handle: "@thecoffeehouse",  usd: 170, channel: "instagram" }],
  th: [{ handle: "@chang_official",  usd: 220, channel: "instagram" }],
};

export function monetize(
  video: RenderedVideo,
  region: CulturalRegion,
  now: number = Date.now(),
): DealDraft[] {
  const pool = REGIONAL_BRANDS[region];
  // Sort brands by viral-confidence-weighted payout fit.
  const ranked = pool
    .map((b) => ({ ...b, fit: b.usd * (0.6 + video.viralConfidence * 0.4) }))
    .sort((a, b) => b.fit - a.fit)
    .slice(0, 2);

  return ranked.map((brand, i) => {
    // Hypothetical revenue event for the fee preview the creator sees.
    const event: RevenueEvent = {
      id: `evt-${video.id}-${i}`,
      videoId: video.id,
      amount: brand.usd,
      currency: "USD",
      source: "brand-deal",
      occurredAt: now,
      attributableToLumina: true,
      baseline: brand.usd * 0.35, // creator's pre-Lumina baseline assumption
    };
    const fee = calculateFee(event);

    return {
      id: `deal-${video.id}-${i}`,
      videoId: video.id,
      brandHandle: brand.handle,
      channel: brand.channel,
      pitchMarkdown: pitchFor(brand.handle, video, brand.usd),
      dmDraft: dmFor(brand.handle, video),
      estimatedFeeUsd: fee.fee,
      estimatedCreatorTakeUsd: fee.creatorTake,
    };
  });
}

function pitchFor(handle: string, video: RenderedVideo, usd: number): string {
  return [
    `**Pitch to ${handle}**`,
    ``,
    `One 60-second integration in an upcoming video projected at`,
    `${Math.round(video.viralConfidence * 100)}% viral confidence ` +
      `(Twin-match ${Math.round(video.twinMatchScore * 100)}%).`,
    ``,
    `Ask: USD ${usd}, paid 50% on publish, 50% on 7-day performance.`,
  ].join("\n");
}

function dmFor(handle: string, video: RenderedVideo): string {
  return (
    `Hi ${handle} — drafted a 60s slot in my next video ` +
    `(${Math.round(video.viralConfidence * 100)}% projected reach). ` +
    `Would love to feature you. Quick pitch attached.`
  );
}
