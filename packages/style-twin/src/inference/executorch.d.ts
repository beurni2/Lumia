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
export declare class ExecuTorchInferenceAdapter implements InferenceAdapter {
    private readonly config;
    readonly mode: "executorch";
    constructor(config: ExecuTorchConfig);
    extractFingerprint(_samples: readonly VideoSample[]): Promise<StyleFingerprint>;
    mergeFingerprints(_existing: StyleFingerprint, _incoming: StyleFingerprint, _weight: number): Promise<StyleFingerprint>;
}
