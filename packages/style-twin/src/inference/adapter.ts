import type {
  InferenceMode,
  StyleFingerprint,
  VideoSample,
} from "../types";

export interface InferenceAdapter {
  readonly mode: InferenceMode;
  extractFingerprint(samples: readonly VideoSample[]): Promise<StyleFingerprint>;
  mergeFingerprints(
    existing: StyleFingerprint,
    incoming: StyleFingerprint,
    weight: number,
  ): Promise<StyleFingerprint>;
}
