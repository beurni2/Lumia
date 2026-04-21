import type { StyleFingerprint, VideoSample } from "../types";
import type { InferenceAdapter } from "./adapter";

export interface ExecuTorchConfig {
  readonly visionModelPath: string;
  readonly audioModelPath: string;
  readonly speakerModelPath: string;
}

/**
 * ExecuTorchInferenceAdapter — placeholder.
 *
 * Wired in Sprint 1.5 against `react-native-executorch` with quantized
 * Llama 3.2 11B Vision (Q4_K_M), Whisper-tiny, and TitaNet-small bundled
 * into a custom dev build via EAS. Throws on Expo Go / web; the factory
 * picks the MockInferenceAdapter in those targets.
 */
export class ExecuTorchInferenceAdapter implements InferenceAdapter {
  readonly mode = "executorch" as const;

  constructor(private readonly config: ExecuTorchConfig) {}

  extractFingerprint(_samples: readonly VideoSample[]): Promise<StyleFingerprint> {
    void this.config;
    return Promise.reject(
      new Error(
        "ExecuTorch adapter not wired yet — requires custom dev build (Sprint 1.5).",
      ),
    );
  }

  mergeFingerprints(
    _existing: StyleFingerprint,
    _incoming: StyleFingerprint,
    _weight: number,
  ): Promise<StyleFingerprint> {
    return Promise.reject(
      new Error(
        "ExecuTorch adapter not wired yet — requires custom dev build (Sprint 1.5).",
      ),
    );
  }
}
