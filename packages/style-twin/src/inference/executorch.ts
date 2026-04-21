import { TIMBRE_DIMS, type StyleFingerprint, type VideoSample } from "../types";
import type { InferenceAdapter } from "./adapter";

export interface ExecuTorchConfig {
  /** Path to Llama-3.2-11B-Vision-Instruct.Q4_K_M.pte bundled in the app. */
  readonly visionModelPath: string;
  /** Path to whisper-tiny.Q4.pte bundled in the app. */
  readonly audioModelPath: string;
  /** Path to titanet-small.fp16.pte bundled in the app. */
  readonly speakerModelPath: string;
  /** Frames sampled per video for the vision encoder. Default 8. */
  readonly framesPerVideo?: number;
}

/**
 * ExecuTorchInferenceAdapter — real on-device inference.
 *
 * This implementation runs **only** in a custom EAS dev build that includes
 * the `react-native-executorch` native module and the bundled .pte models.
 * It throws clearly on Expo Go, web, and CI so the factory can fall back to
 * the MockInferenceAdapter without surprises.
 *
 * Pipeline (all on-device, no network):
 *   1. For each video, decode N frames + a 16 kHz mono audio track.
 *   2. Vision: Llama 3.2 11B Vision encoder → 4096-dim embedding per frame,
 *      mean-pooled across frames → palette + framing + motion features.
 *   3. Audio: TitaNet-small → 192-dim speaker timbre vector (the CI-gated
 *      ≥ 0.95 cosine signal per ROADMAP.md Sprint 1).
 *   4. Audio: Whisper-tiny → transcript → pacing (wpm) + filler rate +
 *      vocabulary tokens + catchphrases.
 *   5. Aggregate across videos with the merge weights below.
 *
 * Performance budget (per ARCHITECTURE.md non-functional table):
 *   - Train (10 videos): ≤ 90 s on a Pixel 7-class device.
 *   - Retrain (1 video): ≤ 8 s incremental.
 *   - Memory resident: ≤ 5.5 GB on 8 GB devices (Llama + Whisper + TitaNet
 *     warm; vocabulary tokenizer paged on demand).
 *   - Battery cost: ≤ 3 % of a 4000 mAh device per training run.
 */
export class ExecuTorchInferenceAdapter implements InferenceAdapter {
  readonly mode = "executorch" as const;
  private llama: ExecuTorchModule | null = null;
  private whisper: ExecuTorchModule | null = null;
  private titanet: ExecuTorchModule | null = null;

  constructor(private readonly config: ExecuTorchConfig) {}

  /** Lazy-load the three models on first use. Idempotent. */
  private async ensureModels(): Promise<void> {
    if (this.llama && this.whisper && this.titanet) return;
    const rne = await loadRuntimeOrThrow();
    [this.llama, this.whisper, this.titanet] = await Promise.all([
      rne.load(this.config.visionModelPath),
      rne.load(this.config.audioModelPath),
      rne.load(this.config.speakerModelPath),
    ]);
  }

  async extractFingerprint(samples: readonly VideoSample[]): Promise<StyleFingerprint> {
    if (samples.length === 0) throw new Error("No samples provided");
    await this.ensureModels();

    // ──────────────────────────────────────────────────────────────────────
    // The actual inference loop lives behind these helpers, each of which
    // calls the loaded ExecuTorch module. They are intentionally stubbed
    // here so the package compiles in Expo Go / web / CI; the real
    // implementations land alongside the EAS dev build (Sprint 1.5).
    //
    // const frames     = await decodeFrames(samples, this.config.framesPerVideo ?? 8);
    // const audioMono  = await decodeAudio(samples, 16000);
    // const visionEmbs = await Promise.all(frames.map((f) => this.llama!.run(f)));
    // const speakerEmb = meanPool(await Promise.all(audioMono.map((a) => this.titanet!.run(a))));
    // const transcript = await this.whisper!.run(concatAudio(audioMono));
    // const palette    = paletteFromVisionEmbeddings(visionEmbs);
    // const framing    = framingFromVisionEmbeddings(visionEmbs);
    // ──────────────────────────────────────────────────────────────────────

    throw new Error(
      "ExecuTorchInferenceAdapter.extractFingerprint: dev-build runtime not yet wired. " +
        "See packages/style-twin/IMPLEMENTATION_PLAN.md for the EAS dev-build runbook.",
    );

    // The shape the real implementation MUST return — kept here for type
    // documentation; unreachable until the runbook lands.
    // eslint-disable-next-line @typescript-eslint/no-unreachable
    return {
      voice: {
        pacingWpm: 0,
        energyMean: 0,
        energyStd: 0,
        timbreVector: new Array(TIMBRE_DIMS).fill(0),
        fillerRate: 0,
      },
      visual: {
        palette: [],
        temperatureKelvin: 5500,
        framingBias: { thirdsScore: 0, centerScore: 0 },
        motionEnergy: 0,
      },
      vocabulary: { tokens: [], catchphrases: [], languages: [] },
    };
  }

  async mergeFingerprints(
    existing: StyleFingerprint,
    incoming: StyleFingerprint,
    weight: number,
  ): Promise<StyleFingerprint> {
    // The merge math is identical to the Mock — no model needed. We delegate
    // to keep both adapters perfectly consistent.
    const { MockInferenceAdapter } = await import("./mock");
    return new MockInferenceAdapter().mergeFingerprints(existing, incoming, weight);
  }
}

// ─── Native runtime shim ────────────────────────────────────────────────────
// `react-native-executorch` is a native module — it cannot be imported
// statically without breaking Expo Go bundles. This dynamic loader returns
// the runtime when present and throws a useful error when not, so the
// inferenceFactory can fall back to MockInferenceAdapter cleanly.

interface ExecuTorchModule {
  run(input: ArrayBufferLike): Promise<Float32Array>;
}

interface ExecuTorchRuntime {
  load(path: string): Promise<ExecuTorchModule>;
}

async function loadRuntimeOrThrow(): Promise<ExecuTorchRuntime> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = (await import(/* webpackIgnore: true */ "react-native-executorch" as string)) as {
      Runtime?: ExecuTorchRuntime;
    };
    if (!mod.Runtime) throw new Error("Runtime export missing");
    return mod.Runtime;
  } catch (err) {
    throw new Error(
      "react-native-executorch is not available in this build. " +
        "Style Twin requires a custom EAS dev build with the native module. " +
        "Falling back to MockInferenceAdapter is automatic via inferenceFactory. " +
        `(underlying error: ${(err as Error).message})`,
    );
  }
}
