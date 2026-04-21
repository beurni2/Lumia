import {
  AUDIO_MATCH_GATE,
  HEADLINE_MATCH_TARGET,
  nearest,
  verifyMatch,
  type StyleFingerprint,
  type StyleTwin,
} from "@workspace/style-twin";

/** Wrap a bare fingerprint in a minimal StyleTwin envelope so verifyMatch() applies. */
function asTwin(fp: StyleFingerprint, seed: StyleTwin): StyleTwin {
  return {
    ...seed,
    fingerprint: fp,
  };
}
import type { Brief, CulturalRegion, PastWinReference, TwinAffinity } from "../types";
import { REGIONAL_TRENDS, type RegionalTrend } from "../regionalTrends";

/**
 * Ideator — picks 3 daily briefs from the regional trend pool.
 *
 * Two-phase:
 *   1. `ideateSync`: deterministic shortlist by vocabulary overlap + seeded jitter.
 *      Pure function of (twin, region, dayKey).
 *   2. `scoreBrief`: async per-brief enrichment that calls
 *      `verifyMatch()` and `nearest()` from @workspace/style-twin against the
 *      user's encrypted on-device vector memory. The orchestrator runs this
 *      for every shortlisted brief so the UI can show a real-time "this brief
 *      is X% on-Twin" score AND surface the most similar past on-device wins.
 *
 * The same creator opening the app twice in the same day sees the same briefs
 * AND the same affinity scores (vector memory is local + deterministic).
 */
export function ideate(
  twin: StyleTwin,
  region: CulturalRegion,
  dayKey: string,
): Array<{ brief: Omit<Brief, "twinAffinity" | "pastWinReferences">; trend: RegionalTrend }> {
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
    trend,
    brief: {
      id: `brief-${dayKey}-${i}-${trend.id}`,
      hook: personaliseHook(trend.hook, twin),
      beats: trend.beats,
      culturalTag: trend.culturalTag,
      region,
      trendSourceIds: [trend.id],
    },
  }));
}

/**
 * Project a candidate brief into fingerprint-space, then call into
 * @workspace/style-twin's similarity gates.
 *
 * The candidate is built by stretching the Twin along the axes the brief
 * would naturally stress: voice pacing follows hook length, vocabulary is
 * mixed with the trend's actual tokens (so off-brand trends genuinely lower
 * the vocab sub-score), and timbre is perturbed proportional to how far the
 * trend's audio cue is from the creator's catchphrases. This makes the gate
 * meaningful — some briefs naturally fall below AUDIO_MATCH_GATE so the
 * Compliance Shield's red pill in the UI is informative, not decorative.
 */
export async function scoreBrief(
  twin: StyleTwin,
  trend: RegionalTrend,
): Promise<{ twinAffinity: TwinAffinity; pastWinReferences: PastWinReference[] }> {
  const candidateFp = projectBriefFingerprint(twin.fingerprint, trend);
  const verdict = verifyMatch(asTwin(candidateFp, twin), twin);

  // Real on-device kNN against the encrypted vector memory, queried with the
  // *candidate's* timbre so each brief surfaces its own most-similar past
  // wins (not always the same three).
  const neighbors = await nearest(candidateFp.voice.timbreVector, "voice-timbre", 3);

  return {
    twinAffinity: {
      overall: round3(verdict.score.overall),
      voice: round3(verdict.score.voice),
      vocabulary: round3(verdict.score.vocabulary),
      meetsHeadlineGate: verdict.score.overall >= HEADLINE_MATCH_TARGET,
      meetsAudioGate: verdict.score.voice >= AUDIO_MATCH_GATE,
    },
    pastWinReferences: neighbors.map((n) => ({
      sampleId: n.entry.sampleId,
      score: round3(n.score),
      capturedAt: n.entry.capturedAt,
      // sampleId prefix `seed-` denotes synthetic demo vectors so the UI can
      // honestly label them as such instead of pretending they're real wins.
      synthetic: n.entry.sampleId.startsWith("seed-"),
    })),
  };
}

function projectBriefFingerprint(twin: StyleFingerprint, trend: RegionalTrend): StyleFingerprint {
  // 1. Pacing axis — short snappy hooks push wpm up; long meandering hooks slow it.
  const hookWords = trend.hook.split(/\s+/).length;
  const hookSnappiness = Math.min(1, hookWords / 12);
  const wpmShift = (1 - hookSnappiness) * 0.06 - hookSnappiness * 0.02;

  // 2. Vocabulary axis — blend the Twin's tokens with the trend's actual
  //    audio cue + cultural tag tokens. Off-brand trends lower the overlap.
  const trendTokens = `${trend.audioCue} ${trend.culturalTag} ${trend.beats.join(" ")}`
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const blendedTokens = Array.from(
    new Set([
      ...[...twin.vocabulary.tokens].slice(0, Math.max(1, twin.vocabulary.tokens.length - trendTokens.length)),
      ...trendTokens,
    ]),
  );

  // 3. Timbre axis — perturbation amplitude scales with vocab distance, so
  //    trends whose vocabulary is far from the Twin's also nudge timbre away.
  const overlap = jaccard([...twin.vocabulary.tokens], trendTokens);
  const timbreDrift = (1 - overlap) * 0.18; // 0.0 (perfect overlap) … 0.18 (none)
  const timbre = twin.voice.timbreVector.map((v, i) => {
    const noise = ((i * 2654435761) >>> 0) / 0xffffffff - 0.5;
    return v + noise * timbreDrift;
  });
  const norm = Math.sqrt(timbre.reduce((s, x) => s + x * x, 0)) || 1;

  return {
    voice: {
      pacingWpm: twin.voice.pacingWpm * (1 + wpmShift),
      energyMean: Math.min(1, twin.voice.energyMean + hookSnappiness * 0.02),
      energyStd: twin.voice.energyStd,
      timbreVector: timbre.map((x) => x / norm),
      fillerRate: twin.voice.fillerRate,
    },
    visual: twin.visual,
    vocabulary: {
      ...twin.vocabulary,
      tokens: blendedTokens,
    },
  };
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

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
