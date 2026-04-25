/**
 * Static regional trend bundles.
 *
 * Each region's bundle is a curated list of hooks, caption templates,
 * and formats that the Ideator endpoint feeds Claude as cultural
 * grounding. Static-by-design for v1: no scraping, no real-time pulls.
 * Refresh cadence is manual (PR every few days) — keeps quality high
 * and infra surface minimal.
 *
 * Each item carries `popularityScore` (1-10, how viral right now) and
 * `recencyScore` (1-10, how fresh — 10 = today, 1 = months old). The
 * ideator slices the top items by combined score before prompting.
 */

import western from "./bundles/western.json" with { type: "json" };
import india from "./bundles/india.json" with { type: "json" };
import philippines from "./bundles/philippines.json" with { type: "json" };
import nigeria from "./bundles/nigeria.json" with { type: "json" };

export const REGIONS = ["western", "india", "philippines", "nigeria"] as const;
export type Region = (typeof REGIONS)[number];

export type HookType = "question" | "boldStatement" | "sceneSetter";
export type ContentType =
  | "entertainment"
  | "educational"
  | "lifestyle"
  | "storytelling";
export type TemplateLetter = "A" | "B" | "C" | "D";
export type CaptionTone = "short" | "descriptive";

export type TrendHook = {
  text: string;
  type: HookType;
  contentType: ContentType;
  popularityScore: number;
  recencyScore: number;
};

export type TrendCaption = {
  template: string;
  tone: CaptionTone;
  popularityScore: number;
  recencyScore: number;
};

export type TrendFormat = {
  name: string;
  description: string;
  template: TemplateLetter;
  popularityScore: number;
  recencyScore: number;
};

export type TrendBundle = {
  region: Region;
  schemaVersion: 1;
  generatedAt: string;
  /** Free-form note about what makes this region's trends distinct. */
  culturalNote: string;
  hooks: TrendHook[];
  captionTemplates: TrendCaption[];
  formats: TrendFormat[];
};

const BUNDLES: Record<Region, TrendBundle> = {
  western: western as TrendBundle,
  india: india as TrendBundle,
  philippines: philippines as TrendBundle,
  nigeria: nigeria as TrendBundle,
};

export function loadTrendBundle(region: Region): TrendBundle {
  return BUNDLES[region];
}

export function isRegion(s: string): s is Region {
  return (REGIONS as readonly string[]).includes(s);
}

/**
 * Combined score = popularityScore + recencyScore. Ideator passes the
 * top-N hooks/captions/formats by this score to Claude as the prompt
 * stays compact even as bundles grow.
 */
export function combinedScore(item: {
  popularityScore: number;
  recencyScore: number;
}): number {
  return item.popularityScore + item.recencyScore;
}

export function topByScore<T extends { popularityScore: number; recencyScore: number }>(
  items: T[],
  n: number,
): T[] {
  return [...items]
    .sort((a, b) => combinedScore(b) - combinedScore(a))
    .slice(0, n);
}
