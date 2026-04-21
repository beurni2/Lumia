import { type StyleFingerprint, type VideoSample } from "../types";
import type { InferenceAdapter } from "./adapter";
/**
 * MockInferenceAdapter — runs in Expo Go and tests.
 *
 * Generates a deterministic, plausible Style Twin fingerprint from the input
 * sample IDs. No native code, no model files, no network. Used until the
 * ExecuTorch adapter is wired in a custom dev build (Sprint 1.5).
 */
export declare class MockInferenceAdapter implements InferenceAdapter {
    readonly mode: "mock";
    extractFingerprint(samples: readonly VideoSample[]): Promise<StyleFingerprint>;
    mergeFingerprints(existing: StyleFingerprint, incoming: StyleFingerprint, weight: number): Promise<StyleFingerprint>;
}
