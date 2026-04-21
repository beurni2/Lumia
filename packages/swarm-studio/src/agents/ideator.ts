import type { StyleTwin } from "@workspace/style-twin";
import type { Brief, CulturalRegion } from "../types";
import { REGIONAL_TRENDS } from "../regionalTrends";

/**
 * Ideator — picks 3 daily briefs from the regional trend pool, scoring each
 * trend by overlap with the creator's StyleTwin vocabulary and pacing.
 *
 * Deterministic given (StyleTwin, region, dayKey). The same creator opening
 * the app twice in the same day sees the same briefs.
 */
/**
 * `dayKey` is required (no `new Date()` default) so the function is purely
 * deterministic in (twin, region, dayKey). The orchestrator supplies it.
 */
export function ideate(
  twin: StyleTwin,
  region: CulturalRegion,
  dayKey: string,
): Brief[] {
  const pool = REGIONAL_TRENDS[region];
  const seed = hash(`${twin.fingerprint.voice.pacingWpm}:${region}:${dayKey}`);
  const rand = seeded(seed);

  const scored = pool.map((trend) => {
    const vocabOverlap = jaccard(
      [...twin.fingerprint.vocabulary.tokens, ...twin.fingerprint.vocabulary.catchphrases],
      [trend.hook, trend.audioCue, trend.culturalTag, ...trend.beats]
        .join(" ")
        .toLowerCase()
        .split(/\s+/),
    );
    const noise = (rand() - 0.5) * 0.08;
    return { trend, score: vocabOverlap * 0.6 + (1 - vocabOverlap) * 0.4 + noise };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.min(3, scored.length));

  return top.map(({ trend }, i) => ({
    id: `brief-${dayKey}-${i}-${trend.id}`,
    hook: personaliseHook(trend.hook, twin),
    beats: trend.beats,
    culturalTag: trend.culturalTag,
    region,
    trendSourceIds: [trend.id],
  }));
}

function personaliseHook(hook: string, twin: StyleTwin): string {
  const phrase = twin.fingerprint.vocabulary.catchphrases[0];
  if (!phrase) return hook;
  return `${hook} — ${phrase}`;
}

export function isoDay(now: number = Date.now()): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seeded(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const sa = new Set(a.map((x) => x.toLowerCase()));
  const sb = new Set(b.map((x) => x.toLowerCase()));
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}
