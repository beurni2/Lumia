import {
  AUDIO_MATCH_GATE,
  HEADLINE_MATCH_TARGET,
  nearest,
  similarity,
  type StyleFingerprint,
  type StyleTwin,
} from "@workspace/style-twin";

/**
 * 12-variant A/B orchestration: 3 thumbnails × 2 captions × 2 hooks = 12.
 *
 * Each variant is scored against the StyleTwin via the *same* similarity
 * pipeline the Ideator uses (`verifyMatch`/`nearest`), so winners selected
 * here are already gate-compliant. The Editor's TwinMatchRejected gate
 * still runs at render time — this layer just picks the variant most
 * likely to clear it AND clear the publish-platform's policy pack.
 *
 * Pure & deterministic given (twin, seedHook, seedCaption, thumbnailLabels).
 */

export interface ABInputs {
  readonly seedHooks: readonly string[];           // length must be 2
  readonly seedCaptions: readonly string[];        // length must be 2
  readonly seedThumbnailLabels: readonly string[]; // length must be 3
}

export interface ABVariant {
  readonly id: string;          // deterministic: "v-{thumbIdx}-{capIdx}-{hookIdx}"
  readonly hookIndex: number;
  readonly captionIndex: number;
  readonly thumbnailIndex: number;
  readonly hook: string;
  readonly caption: string;
  readonly thumbnailLabel: string;
  /** Twin-affinity overall score for this variant (0–1). */
  readonly twinAffinityOverall: number;
  /** Voice sub-score — must be ≥ AUDIO_MATCH_GATE to be eligible to win. */
  readonly twinAffinityVoice: number;
  /** True iff voice ≥ AUDIO_MATCH_GATE. */
  readonly meetsAudioGate: boolean;
  /** Top kNN neighbor score from the encrypted vector memory. */
  readonly nearestNeighborScore: number;
  /** Composite ranking score the orchestrator sorts on. Higher = better. */
  readonly rankScore: number;
}

export const VARIANT_COUNT = 12 as const;
export const REQUIRED_THUMBNAILS = 3 as const;
export const REQUIRED_CAPTIONS = 2 as const;
export const REQUIRED_HOOKS = 2 as const;

export async function generateABVariants(
  twin: StyleTwin,
  inputs: ABInputs,
): Promise<ABVariant[]> {
  if (inputs.seedHooks.length !== REQUIRED_HOOKS) {
    throw new Error(`A/B requires exactly ${REQUIRED_HOOKS} seed hooks (got ${inputs.seedHooks.length})`);
  }
  if (inputs.seedCaptions.length !== REQUIRED_CAPTIONS) {
    throw new Error(`A/B requires exactly ${REQUIRED_CAPTIONS} seed captions (got ${inputs.seedCaptions.length})`);
  }
  if (inputs.seedThumbnailLabels.length !== REQUIRED_THUMBNAILS) {
    throw new Error(`A/B requires exactly ${REQUIRED_THUMBNAILS} seed thumbnails (got ${inputs.seedThumbnailLabels.length})`);
  }

  const variants: ABVariant[] = [];
  for (let t = 0; t < REQUIRED_THUMBNAILS; t++) {
    for (let c = 0; c < REQUIRED_CAPTIONS; c++) {
      for (let h = 0; h < REQUIRED_HOOKS; h++) {
        const hook = inputs.seedHooks[h];
        const caption = inputs.seedCaptions[c];
        const thumbnailLabel = inputs.seedThumbnailLabels[t];

        const candidate = projectVariantFingerprint(
          twin.fingerprint,
          hook,
          caption,
          thumbnailLabel,
          t * 100 + c * 10 + h,
        );
        const score = similarity(twin.fingerprint, candidate);
        const neighbors = await nearest(candidate.voice.timbreVector, "voice-timbre", 1);
        const top = neighbors[0]?.score ?? 0;

        // Composite rank: voice carries the gate, overall carries the headline,
        // neighbor score is the "this resembles a past win" signal.
        const rankScore =
          score.voice * 0.5 + score.overall * 0.35 + top * 0.15;

        variants.push({
          id: `v-${t}-${c}-${h}`,
          hookIndex: h,
          captionIndex: c,
          thumbnailIndex: t,
          hook,
          caption,
          thumbnailLabel,
          twinAffinityOverall: round3(score.overall),
          twinAffinityVoice: round3(score.voice),
          meetsAudioGate: score.voice >= AUDIO_MATCH_GATE,
          nearestNeighborScore: round3(top),
          rankScore: round3(rankScore),
        });
      }
    }
  }

  if (variants.length !== VARIANT_COUNT) {
    throw new Error(`A/B produced ${variants.length} variants, expected ${VARIANT_COUNT}`);
  }
  return variants;
}

/**
 * Pick the winning variant.
 *
 * Selection rule (locked in tests):
 *   1. Filter to variants meeting the AUDIO_MATCH_GATE (voice ≥ 0.95).
 *   2. From those, pick the highest rankScore.
 *   3. Tie-break by deterministic variant id.
 *   4. If NO variant meets the gate, return null — the Smart Publisher
 *      surfaces this honestly rather than silently shipping an off-Twin pick.
 */
export function pickWinner(variants: readonly ABVariant[]): ABVariant | null {
  const eligible = variants.filter((v) => v.meetsAudioGate);
  if (eligible.length === 0) return null;
  const sorted = eligible.slice().sort((a, b) => {
    if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
    return a.id.localeCompare(b.id);
  });
  return sorted[0];
}

/** Stretch the Twin along axes the variant copy would naturally stress. */
function projectVariantFingerprint(
  twin: StyleFingerprint,
  hook: string,
  caption: string,
  thumbnailLabel: string,
  seed: number,
): StyleFingerprint {
  const hookWords = hook.split(/\s+/).length;
  const capWords = caption.split(/\s+/).length;
  const snappy = Math.min(1, hookWords / 12);
  const wpmShift = (1 - snappy) * 0.04 - snappy * 0.015;
  const drift = (snappy * 0.02) + (capWords > 18 ? 0.015 : 0) + (variantHash(`${hook}|${caption}|${thumbnailLabel}|${seed}`) / 0xffffffff) * 0.04;

  const timbre = twin.voice.timbreVector.map((v, i) => {
    const noise = ((i * 2654435761) >>> 0) / 0xffffffff - 0.5;
    return v + noise * drift;
  });
  const norm = Math.sqrt(timbre.reduce((s, x) => s + x * x, 0)) || 1;

  return {
    voice: {
      pacingWpm: twin.voice.pacingWpm * (1 + wpmShift),
      energyMean: Math.min(1, twin.voice.energyMean + snappy * 0.01),
      energyStd: twin.voice.energyStd,
      timbreVector: timbre.map((x) => x / norm),
      fillerRate: twin.voice.fillerRate,
    },
    visual: twin.visual,
    vocabulary: twin.vocabulary,
  };
}

function variantHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export { AUDIO_MATCH_GATE, HEADLINE_MATCH_TARGET };
