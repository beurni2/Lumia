export * from "./types";
export type { InferenceAdapter } from "./inference/adapter";
export { MockInferenceAdapter } from "./inference/mock";
export {
  ExecuTorchInferenceAdapter,
  type ExecuTorchConfig,
} from "./inference/executorch";
export {
  configureBackend,
  loadTwin,
  saveTwin,
  wipe,
  MemoryBackend,
  type SecureBackend,
} from "./storage";
export { grantConsent, assertConsent } from "./consent";
export { train, retrain, type TrainResult } from "./train";
export {
  similarity,
  voiceSimilarity,
  visualSimilarity,
  vocabularySimilarity,
  cosineSimilarity,
  verifyMatch,
  AUDIO_MATCH_GATE,
  HEADLINE_MATCH_TARGET,
  type SimilarityBreakdown,
  type MatchVerdict,
} from "./similarity";
export {
  configureVectorBackend,
  loadVectors,
  appendVectors,
  wipeVectors,
  nearest,
  type VectorEntry,
  type NeighborMatch,
} from "./vectorMemory";
