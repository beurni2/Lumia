/**
 * Brand pitch deck generator.
 *
 * Produces two deterministic outputs for a single (video, brand) pair:
 *   1. A markdown one-pager (rendered to PDF in Sprint 5 via the API server).
 *   2. A 6-slide IG-friendly carousel spec (1080×1350 portrait).
 *
 * Pure & deterministic. No file IO, no PDF lib in this package — the API
 * server's `/pitch/render` endpoint owns the rendering boundary.
 */

import type { BrandRecord } from "./brandGraph";

export interface PitchInput {
  readonly videoId: string;
  readonly hook: string;
  readonly viralConfidencePct: number;   // 0–100
  readonly twinMatchPct: number;          // 0–100
  readonly creatorHandle: string;
  readonly creatorRegion: string;
  readonly avgViewsPerVideo: number;
}

export interface PitchDeck {
  readonly id: string;
  readonly markdown: string;
  readonly carousel: readonly CarouselSlide[];
  readonly askUsd: number;
}

export interface CarouselSlide {
  readonly slot: number;          // 1-indexed, 6 total
  readonly kind: "cover" | "stats" | "hook" | "fit" | "ask" | "next-step";
  readonly headline: string;
  readonly body: string;
}

const CAROUSEL_SLOTS = 6;

export function generatePitchDeck(input: PitchInput, brand: BrandRecord): PitchDeck {
  const askUsd = computeAsk(input, brand);
  const id = `pitch-${input.videoId}-${brand.id}`;
  const carousel = buildCarousel(input, brand, askUsd);
  const markdown = buildMarkdown(input, brand, askUsd);
  if (carousel.length !== CAROUSEL_SLOTS) {
    throw new Error(`carousel must have exactly ${CAROUSEL_SLOTS} slides, got ${carousel.length}`);
  }
  return { id, markdown, carousel, askUsd };
}

/**
 * Ask USD = brand baseline scaled by viral confidence + Twin match.
 * Floors at 60% of typical, caps at 180% to avoid out-of-distribution asks.
 */
function computeAsk(input: PitchInput, brand: BrandRecord): number {
  const confidence = clamp01(input.viralConfidencePct / 100);
  const twin = clamp01(input.twinMatchPct / 100);
  const multiplier = 0.6 + (confidence * 0.7) + (twin * 0.5);
  const clamped = Math.min(1.8, Math.max(0.6, multiplier));
  return Math.round(brand.typicalPayoutUsd * clamped);
}

function buildMarkdown(input: PitchInput, brand: BrandRecord, askUsd: number): string {
  return [
    `# Brand pitch — ${brand.handle}`,
    ``,
    `**From:** ${input.creatorHandle} (${input.creatorRegion.toUpperCase()})`,
    `**Avg views / video:** ${input.avgViewsPerVideo.toLocaleString("en-US")}`,
    ``,
    `## The video`,
    `> ${input.hook}`,
    ``,
    `- Projected viral confidence: **${input.viralConfidencePct}%**`,
    `- Style-Twin match: **${input.twinMatchPct}%**`,
    ``,
    `## Why ${brand.handle}`,
    `Tags overlap: ${brand.tags.join(", ") || "(none registered)"}.`,
    ``,
    `## Ask`,
    `**USD ${askUsd}** — 50% on publish, 50% on 7-day performance.`,
  ].join("\n");
}

function buildCarousel(input: PitchInput, brand: BrandRecord, askUsd: number): CarouselSlide[] {
  return [
    {
      slot: 1,
      kind: "cover",
      headline: `${input.creatorHandle} × ${brand.handle}`,
      body: `One 60-second integration. Made with Lumina.`,
    },
    {
      slot: 2,
      kind: "stats",
      headline: `${input.avgViewsPerVideo.toLocaleString("en-US")} avg views`,
      body: `${input.creatorRegion.toUpperCase()} micro-creator, organic-only.`,
    },
    {
      slot: 3,
      kind: "hook",
      headline: `The hook`,
      body: input.hook,
    },
    {
      slot: 4,
      kind: "fit",
      headline: `Why this fits`,
      body: brand.tags.length > 0
        ? `Aligned on: ${brand.tags.slice(0, 3).join(", ")}.`
        : `Regional alignment + tone match.`,
    },
    {
      slot: 5,
      kind: "ask",
      headline: `USD ${askUsd}`,
      body: `50% on publish, 50% on 7-day performance.`,
    },
    {
      slot: 6,
      kind: "next-step",
      headline: `Next step`,
      body: `DM "yes" to lock this slot. 48h reply window.`,
    },
  ];
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
