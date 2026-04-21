export interface VideoSample {
  readonly id: string;
  readonly uri: string;
  readonly durationMs: number;
  readonly capturedAt: number;
}

export interface VoiceFingerprint {
  readonly pacingWpm: number;
  readonly energyMean: number;
  readonly energyStd: number;
  readonly timbreVector: readonly number[];
  readonly fillerRate: number;
}

export interface PaletteSwatch {
  readonly hex: string;
  readonly weight: number;
}

export interface VisualFingerprint {
  readonly palette: readonly PaletteSwatch[];
  readonly temperatureKelvin: number;
  readonly framingBias: { readonly thirdsScore: number; readonly centerScore: number };
  readonly motionEnergy: number;
}

export interface VocabularyFingerprint {
  readonly tokens: readonly string[];
  readonly catchphrases: readonly string[];
  readonly languages: readonly string[];
}

export interface StyleFingerprint {
  readonly voice: VoiceFingerprint;
  readonly visual: VisualFingerprint;
  readonly vocabulary: VocabularyFingerprint;
}

export interface StyleTwin {
  readonly version: number;
  readonly createdAt: number;
  readonly lastRetrainedAt: number;
  readonly trainedOnCount: number;
  readonly fingerprint: StyleFingerprint;
}

export type ConsentScope = "train" | "retrain" | "preview";

export interface ConsentGrant {
  readonly scope: ConsentScope;
  readonly grantedAt: number;
  readonly expiresAt: number;
  readonly nonce: string;
}

export type InferenceMode = "mock" | "executorch";

export const MIN_SAMPLES = 10;
export const TIMBRE_DIMS = 192;
export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = "lumina.styleTwin.v1";
