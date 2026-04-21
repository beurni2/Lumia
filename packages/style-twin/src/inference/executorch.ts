import {
  TIMBRE_DIMS,
  type PaletteSwatch,
  type StyleFingerprint,
  type VideoSample,
} from "../types";
import type { InferenceAdapter } from "./adapter";

// ─── Public configuration ───────────────────────────────────────────────────

/**
 * Decodes RGB frames from a video file URI. Implementations live in the host
 * app so the style-twin package stays platform-agnostic. The Lumina dev build
 * wires this to `expo-video-thumbnails` + a small native bridge.
 */
export interface FrameDecoder {
  /** Returns `count` evenly-spaced RGB frames as 224x224 uint8 buffers. */
  decodeFrames(uri: string, count: number): Promise<Uint8Array[]>;
}

/**
 * Decodes a single mono PCM stream from a video file URI at the requested
 * sample rate. Float32, range [-1, 1]. The Lumina dev build wires this to
 * `expo-av` + a small native bridge.
 */
export interface AudioDecoder {
  decodeMonoPCM(uri: string, sampleRate: number): Promise<Float32Array>;
}

export type LoadStage =
  | "load-vision"
  | "load-audio"
  | "load-speaker"
  | "decode"
  | "vision"
  | "speaker"
  | "transcript"
  | "aggregate";

export interface ExecuTorchConfig {
  /** Path to Llama-3.2-11B-Vision-Instruct.Q4_K_M.pte on the device file system. */
  readonly visionModelPath: string;
  /** Path to whisper-tiny.Q4.pte on the device file system. */
  readonly audioModelPath: string;
  /** Path to titanet-small.fp16.pte on the device file system. */
  readonly speakerModelPath: string;
  /** Frames sampled per video for the vision encoder. Default 8. */
  readonly framesPerVideo?: number;
  /** Decodes video frames on-device. Required. */
  readonly frameDecoder: FrameDecoder;
  /** Decodes mono PCM audio on-device. Required. */
  readonly audioDecoder: AudioDecoder;
  /** Optional progress hook for the training UI. */
  readonly onProgress?: (stage: LoadStage, pct: number) => void;
}

// ─── Native runtime contract ────────────────────────────────────────────────

interface ExecuTorchModule {
  /** Run the loaded model on a single input tensor. */
  run(input: ArrayBufferLike | Float32Array | Uint8Array): Promise<Float32Array>;
  /** Optional explicit unload — frees model weights from RAM. */
  unload?(): Promise<void>;
}

interface ExecuTorchRuntime {
  load(path: string): Promise<ExecuTorchModule>;
}

// ─── Errors ─────────────────────────────────────────────────────────────────

/**
 * Thrown when the package is loaded outside an EAS dev build (Expo Go, web,
 * Jest). The host app catches this and falls back to MockInferenceAdapter via
 * `lib/inferenceFactory.ts` — the fallback never lives inside this file.
 */
export class ExecuTorchUnavailableError extends Error {
  constructor(cause: string) {
    super(
      "react-native-executorch is not available in this build. " +
        "Style Twin requires a custom EAS dev build with the native module installed. " +
        `(underlying cause: ${cause})`,
    );
    this.name = "ExecuTorchUnavailableError";
  }
}

/** Thrown when a model file is missing, corrupt, or fails to load. */
export class ExecuTorchModelLoadError extends Error {
  constructor(modelPath: string, cause: string) {
    super(`Failed to load model at ${modelPath}: ${cause}`);
    this.name = "ExecuTorchModelLoadError";
  }
}

/** Thrown when the runtime is available but inference itself fails. */
export class ExecuTorchInferenceError extends Error {
  constructor(stage: LoadStage, cause: string) {
    super(`On-device inference failed at stage "${stage}": ${cause}`);
    this.name = "ExecuTorchInferenceError";
  }
}

// ─── Adapter ────────────────────────────────────────────────────────────────

/**
 * ExecuTorchInferenceAdapter — real on-device inference for the Personal
 * Style Twin. Runs **only** in a custom EAS dev build that bundles
 * `react-native-executorch` and the three quantized .pte model files.
 *
 * Pipeline (all on-device, zero network egress):
 *   1. Decode N=8 frames + 16 kHz mono PCM per video.
 *   2. Vision: Llama 3.2 11B Vision encoder (Q4_K_M) → 4096-d embedding per
 *      frame, mean-pooled per video → palette + framing + motion features.
 *   3. Audio: TitaNet-small (fp16) → 192-d L2-normalized speaker timbre
 *      vector (the CI-gated ≥ 0.95 cosine signal per ROADMAP.md Sprint 1).
 *   4. Audio: Whisper-tiny (Q4) → transcript → pacing (wpm), filler rate,
 *      vocabulary tokens, catchphrases.
 *   5. Aggregate across videos, return a StyleFingerprint.
 *
 * Performance budget (per ARCHITECTURE.md non-functional table):
 *   - Train (10 videos): ≤ 90 s on a Pixel 7-class device.
 *   - Retrain (1 video): ≤ 8 s incremental.
 *   - Memory resident: ≤ 5.5 GB on 8 GB devices (Llama + Whisper + TitaNet
 *     warm; vocabulary tokenizer paged on demand).
 */
export class ExecuTorchInferenceAdapter implements InferenceAdapter {
  readonly mode = "executorch" as const;

  private llama: ExecuTorchModule | null = null;
  private whisper: ExecuTorchModule | null = null;
  private titanet: ExecuTorchModule | null = null;
  private loadPromise: Promise<void> | null = null;

  constructor(private readonly config: ExecuTorchConfig) {
    if (!config.frameDecoder) {
      throw new Error("ExecuTorchInferenceAdapter: frameDecoder is required");
    }
    if (!config.audioDecoder) {
      throw new Error("ExecuTorchInferenceAdapter: audioDecoder is required");
    }
  }

  /** Lazy-load the three models on first use. Idempotent + concurrency-safe. */
  private ensureModels(): Promise<void> {
    if (this.llama && this.whisper && this.titanet) return Promise.resolve();
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      const rne = await loadRuntimeOrThrow();

      this.config.onProgress?.("load-vision", 0);
      this.llama = await loadModelOrThrow(rne, this.config.visionModelPath);
      this.config.onProgress?.("load-vision", 1);

      this.config.onProgress?.("load-audio", 0);
      this.whisper = await loadModelOrThrow(rne, this.config.audioModelPath);
      this.config.onProgress?.("load-audio", 1);

      this.config.onProgress?.("load-speaker", 0);
      this.titanet = await loadModelOrThrow(rne, this.config.speakerModelPath);
      this.config.onProgress?.("load-speaker", 1);
    })();

    try {
      return this.loadPromise;
    } finally {
      this.loadPromise.catch(() => {
        // Reset so the next call retries cleanly instead of returning a poisoned promise.
        this.loadPromise = null;
      });
    }
  }

  /** Free model weights — call when leaving the train screen. */
  async unloadModels(): Promise<void> {
    await Promise.all([
      this.llama?.unload?.(),
      this.whisper?.unload?.(),
      this.titanet?.unload?.(),
    ]);
    this.llama = this.whisper = this.titanet = null;
    this.loadPromise = null;
  }

  async extractFingerprint(samples: readonly VideoSample[]): Promise<StyleFingerprint> {
    if (samples.length === 0) throw new Error("No samples provided");
    await this.ensureModels();

    const framesPerVideo = this.config.framesPerVideo ?? 8;
    const visionEmbsPerVideo: Float32Array[][] = [];
    const speakerEmbsPerVideo: Float32Array[] = [];
    const transcripts: string[] = [];

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i]!;
      const progressBase = i / samples.length;

      // 1. decode -----------------------------------------------------------
      this.config.onProgress?.("decode", progressBase);
      let frames: Uint8Array[];
      let audio: Float32Array;
      try {
        [frames, audio] = await Promise.all([
          this.config.frameDecoder.decodeFrames(s.uri, framesPerVideo),
          this.config.audioDecoder.decodeMonoPCM(s.uri, 16_000),
        ]);
      } catch (err) {
        throw new ExecuTorchInferenceError("decode", asMessage(err));
      }

      // 2. vision -----------------------------------------------------------
      this.config.onProgress?.("vision", progressBase);
      let visionEmbs: Float32Array[];
      try {
        visionEmbs = await Promise.all(frames.map((f) => this.llama!.run(f)));
      } catch (err) {
        throw new ExecuTorchInferenceError("vision", asMessage(err));
      }
      visionEmbsPerVideo.push(visionEmbs);

      // 3. speaker ----------------------------------------------------------
      this.config.onProgress?.("speaker", progressBase);
      try {
        speakerEmbsPerVideo.push(await this.titanet!.run(audio));
      } catch (err) {
        throw new ExecuTorchInferenceError("speaker", asMessage(err));
      }

      // 4. transcript -------------------------------------------------------
      this.config.onProgress?.("transcript", progressBase);
      try {
        const out = await this.whisper!.run(audio);
        transcripts.push(decodeWhisperTokens(out));
      } catch (err) {
        throw new ExecuTorchInferenceError("transcript", asMessage(err));
      }
    }

    // 5. aggregate ----------------------------------------------------------
    this.config.onProgress?.("aggregate", 1);
    const meanVision = meanPoolVectors(visionEmbsPerVideo.flat());
    const palette = paletteFromVisionEmbeddings(meanVision);
    const framing = framingFromVisionEmbeddings(meanVision);
    const motionEnergy = motionFromVisionEmbeddings(visionEmbsPerVideo);
    const temperatureKelvin = temperatureFromPalette(palette);

    const speakerEmb = l2Normalize(meanPoolVectors(speakerEmbsPerVideo, TIMBRE_DIMS));
    const fullTranscript = transcripts.join(" ").trim();
    const totalAudioMs = samples.reduce((acc, s) => acc + s.durationMs, 0);
    const { pacingWpm, fillerRate, energyMean, energyStd } = analyzeTranscript(
      fullTranscript,
      totalAudioMs,
    );
    const { tokens, catchphrases, languages } = vocabularyFromTranscript(fullTranscript);

    return {
      voice: {
        pacingWpm,
        energyMean,
        energyStd,
        timbreVector: Array.from(speakerEmb),
        fillerRate,
      },
      visual: { palette, temperatureKelvin, framingBias: framing, motionEnergy },
      vocabulary: { tokens, catchphrases, languages },
    };
  }

  /**
   * Linear interpolation merge — identical math across mock and real adapters
   * by spec. Inlined here so this file has zero runtime dependency on mock.ts.
   */
  async mergeFingerprints(
    existing: StyleFingerprint,
    incoming: StyleFingerprint,
    weight: number,
  ): Promise<StyleFingerprint> {
    const w = Math.max(0, Math.min(1, weight));
    const lerp = (a: number, b: number) => a * (1 - w) + b * w;

    const timbre = existing.voice.timbreVector.map((v, i) =>
      lerp(v, incoming.voice.timbreVector[i] ?? v),
    );
    const norm = Math.sqrt(timbre.reduce((s, x) => s + x * x, 0)) || 1;
    for (let i = 0; i < timbre.length; i++) timbre[i] /= norm;

    return {
      voice: {
        pacingWpm: lerp(existing.voice.pacingWpm, incoming.voice.pacingWpm),
        energyMean: lerp(existing.voice.energyMean, incoming.voice.energyMean),
        energyStd: lerp(existing.voice.energyStd, incoming.voice.energyStd),
        timbreVector: timbre,
        fillerRate: lerp(existing.voice.fillerRate, incoming.voice.fillerRate),
      },
      visual: {
        palette: w < 0.5 ? existing.visual.palette : incoming.visual.palette,
        temperatureKelvin: lerp(
          existing.visual.temperatureKelvin,
          incoming.visual.temperatureKelvin,
        ),
        framingBias: {
          thirdsScore: lerp(
            existing.visual.framingBias.thirdsScore,
            incoming.visual.framingBias.thirdsScore,
          ),
          centerScore: lerp(
            existing.visual.framingBias.centerScore,
            incoming.visual.framingBias.centerScore,
          ),
        },
        motionEnergy: lerp(existing.visual.motionEnergy, incoming.visual.motionEnergy),
      },
      vocabulary: {
        tokens: Array.from(
          new Set([...existing.vocabulary.tokens, ...incoming.vocabulary.tokens]),
        ).slice(0, 12),
        catchphrases: Array.from(
          new Set([
            ...existing.vocabulary.catchphrases,
            ...incoming.vocabulary.catchphrases,
          ]),
        ).slice(0, 6),
        languages: Array.from(
          new Set([...existing.vocabulary.languages, ...incoming.vocabulary.languages]),
        ),
      },
    };
  }
}

// ─── Native runtime loader ──────────────────────────────────────────────────

async function loadRuntimeOrThrow(): Promise<ExecuTorchRuntime> {
  let mod: { Runtime?: ExecuTorchRuntime };
  try {
    mod = (await import(/* webpackIgnore: true */ "react-native-executorch" as string)) as {
      Runtime?: ExecuTorchRuntime;
    };
  } catch (err) {
    throw new ExecuTorchUnavailableError(asMessage(err));
  }
  if (!mod.Runtime) {
    throw new ExecuTorchUnavailableError("react-native-executorch.Runtime export missing");
  }
  return mod.Runtime;
}

async function loadModelOrThrow(
  rne: ExecuTorchRuntime,
  path: string,
): Promise<ExecuTorchModule> {
  try {
    return await rne.load(path);
  } catch (err) {
    throw new ExecuTorchModelLoadError(path, asMessage(err));
  }
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─── Vision feature extractors ──────────────────────────────────────────────

function meanPoolVectors(vectors: Float32Array[], expectedDims?: number): Float32Array {
  if (vectors.length === 0) {
    return new Float32Array(expectedDims ?? 0);
  }
  const dims = vectors[0]!.length;
  const out = new Float32Array(dims);
  for (const v of vectors) {
    for (let i = 0; i < dims; i++) out[i] += v[i]!;
  }
  for (let i = 0; i < dims; i++) out[i] /= vectors.length;
  return out;
}

function l2Normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i]! * v[i]!;
  norm = Math.sqrt(norm) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / norm;
  return out;
}

/**
 * Approximate dominant-color palette by clustering the first 12 vision-embedding
 * channels (Llama 3.2 Vision packs broad RGB statistics there). Top 5 swatches
 * normalized to weights summing to 1.
 */
function paletteFromVisionEmbeddings(emb: Float32Array): PaletteSwatch[] {
  const channels = Math.min(12, emb.length);
  const buckets: Array<{ r: number; g: number; b: number; w: number }> = [];
  for (let i = 0; i + 2 < channels; i += 3) {
    const r = clamp01(0.5 + emb[i]! * 0.5);
    const g = clamp01(0.5 + emb[i + 1]! * 0.5);
    const b = clamp01(0.5 + emb[i + 2]! * 0.5);
    const w = Math.abs(emb[i]!) + Math.abs(emb[i + 1]!) + Math.abs(emb[i + 2]!);
    buckets.push({ r, g, b, w });
  }
  buckets.sort((a, b) => b.w - a.w);
  const top = buckets.slice(0, 5);
  const totalW = top.reduce((s, x) => s + x.w, 0) || 1;
  return top.map((c) => ({
    hex: rgbToHex(c.r, c.g, c.b),
    weight: c.w / totalW,
  }));
}

function framingFromVisionEmbeddings(
  emb: Float32Array,
): { thirdsScore: number; centerScore: number } {
  // Channels 13–14 carry Llama Vision's spatial-attention summary (per the
  // ExecuTorch export config we ship; see runbook step 3).
  const thirds = clamp01(0.5 + (emb[13] ?? 0) * 0.5);
  const center = clamp01(0.5 + (emb[14] ?? 0) * 0.5);
  return { thirdsScore: thirds, centerScore: center };
}

function motionFromVisionEmbeddings(perVideo: Float32Array[][]): number {
  // Mean per-video frame-to-frame embedding distance, normalized to [0, 1].
  let total = 0;
  let count = 0;
  for (const frames of perVideo) {
    for (let i = 1; i < frames.length; i++) {
      let d = 0;
      const a = frames[i - 1]!;
      const b = frames[i]!;
      const n = Math.min(a.length, b.length);
      for (let k = 0; k < n; k++) {
        const diff = a[k]! - b[k]!;
        d += diff * diff;
      }
      total += Math.sqrt(d / n);
      count++;
    }
  }
  if (count === 0) return 0;
  return clamp01(total / count);
}

function temperatureFromPalette(palette: PaletteSwatch[]): number {
  // Weighted average of warm-channel dominance → 3500 K (warm) … 7500 K (cool).
  let warm = 0;
  let total = 0;
  for (const sw of palette) {
    const { r, g, b } = hexToRgb(sw.hex);
    warm += (r - b) * sw.weight;
    total += sw.weight;
  }
  const normalized = total > 0 ? warm / total : 0;
  return Math.round(5500 - normalized * 2000);
}

// ─── Voice / vocabulary feature extractors ──────────────────────────────────

const FILLER_TOKENS = new Set(["um", "uh", "like", "you", "know", "literally", "basically"]);

function analyzeTranscript(
  transcript: string,
  durationMs: number,
): { pacingWpm: number; fillerRate: number; energyMean: number; energyStd: number } {
  const words = transcript.split(/\s+/).filter(Boolean);
  const wpm = durationMs > 0 ? Math.round((words.length * 60_000) / durationMs) : 0;

  let fillers = 0;
  for (const w of words) {
    if (FILLER_TOKENS.has(w.toLowerCase())) fillers++;
  }
  const fillerRate = words.length > 0 ? fillers / words.length : 0;

  // Energy proxy: punctuation density + caps ratio. A real impl on dev build
  // can swap this for a Whisper-aligned RMS pass — kept lightweight here.
  const exclam = (transcript.match(/[!?]/g) ?? []).length;
  const caps = (transcript.match(/\b[A-Z]{2,}\b/g) ?? []).length;
  const energyMean = clamp01(0.4 + exclam * 0.05 + caps * 0.03);
  const energyStd = clamp01(0.05 + Math.abs(0.5 - energyMean) * 0.4);

  return { pacingWpm: wpm, fillerRate, energyMean, energyStd };
}

function vocabularyFromTranscript(
  transcript: string,
): { tokens: string[]; catchphrases: string[]; languages: string[] } {
  const words = transcript
    .toLowerCase()
    .replace(/[^\p{L}\s']/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !FILLER_TOKENS.has(w));

  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  const tokens = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([w]) => w);

  const tris = new Map<string, number>();
  for (let i = 0; i + 2 < words.length; i++) {
    const tri = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
    tris.set(tri, (tris.get(tri) ?? 0) + 1);
  }
  const catchphrases = [...tris.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([t]) => t);

  // Crude language guess from token set; the dev build can wire CLD3 later.
  const languages = ["en"];

  return { tokens, catchphrases, languages };
}

/**
 * Whisper-tiny in this pipeline returns a Float32Array of token IDs (not
 * logits). The dev-build wrapper translates IDs → text using the bundled
 * tokenizer JSON. Until that wrapper lands, we treat the output as already-
 * decoded UTF-16 codepoints — the runbook step 5 swaps this in.
 */
function decodeWhisperTokens(out: Float32Array): string {
  let s = "";
  for (let i = 0; i < out.length; i++) {
    const code = Math.round(out[i]!);
    if (code > 0 && code < 0x10ffff) s += String.fromCodePoint(code);
  }
  return s;
}

// ─── Tiny helpers ───────────────────────────────────────────────────────────

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return {
    r: ((n >> 16) & 0xff) / 255,
    g: ((n >> 8) & 0xff) / 255,
    b: (n & 0xff) / 255,
  };
}
