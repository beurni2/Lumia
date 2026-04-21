/**
 * ExecuTorchInferenceAdapter — placeholder.
 *
 * Wired in Sprint 1.5 against `react-native-executorch` with quantized
 * Llama 3.2 11B Vision (Q4_K_M), Whisper-tiny, and TitaNet-small bundled
 * into a custom dev build via EAS. Throws on Expo Go / web; the factory
 * picks the MockInferenceAdapter in those targets.
 */
export class ExecuTorchInferenceAdapter {
    config;
    mode = "executorch";
    constructor(config) {
        this.config = config;
    }
    extractFingerprint(_samples) {
        void this.config;
        return Promise.reject(new Error("ExecuTorch adapter not wired yet — requires custom dev build (Sprint 1.5)."));
    }
    mergeFingerprints(_existing, _incoming, _weight) {
        return Promise.reject(new Error("ExecuTorch adapter not wired yet — requires custom dev build (Sprint 1.5)."));
    }
}
