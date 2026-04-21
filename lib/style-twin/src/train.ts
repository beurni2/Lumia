import { assertConsent } from "./consent";
import type { InferenceAdapter } from "./inference/adapter";
import { loadTwin, saveTwin } from "./storage";
import {
  MIN_SAMPLES,
  type ConsentGrant,
  type StyleTwin,
  type VideoSample,
} from "./types";

export interface TrainResult {
  readonly twin: StyleTwin;
  readonly durationMs: number;
}

export async function train(
  samples: readonly VideoSample[],
  adapter: InferenceAdapter,
  consent: ConsentGrant,
): Promise<TrainResult> {
  assertConsent(consent, "train");
  if (samples.length < MIN_SAMPLES) {
    throw new Error(
      `Need at least ${MIN_SAMPLES} samples to train (got ${samples.length}).`,
    );
  }
  const t0 = Date.now();
  const fingerprint = await adapter.extractFingerprint(samples);
  const now = Date.now();
  const twin: StyleTwin = {
    version: 1,
    createdAt: now,
    lastRetrainedAt: now,
    trainedOnCount: samples.length,
    fingerprint,
  };
  await saveTwin(twin);
  return { twin, durationMs: Date.now() - t0 };
}

export async function retrain(
  newSamples: readonly VideoSample[],
  adapter: InferenceAdapter,
  consent: ConsentGrant,
): Promise<TrainResult> {
  assertConsent(consent, "retrain");
  if (newSamples.length === 0) {
    throw new Error("retrain requires at least one new sample");
  }
  const existing = await loadTwin();
  if (!existing) {
    throw new Error("No existing Style Twin to retrain. Train first.");
  }
  const t0 = Date.now();
  const incoming = await adapter.extractFingerprint(newSamples);
  const weight = Math.min(0.4, newSamples.length / (existing.trainedOnCount + newSamples.length));
  const merged = await adapter.mergeFingerprints(existing.fingerprint, incoming, weight);
  const updated: StyleTwin = {
    ...existing,
    version: existing.version + 1,
    lastRetrainedAt: Date.now(),
    trainedOnCount: existing.trainedOnCount + newSamples.length,
    fingerprint: merged,
  };
  await saveTwin(updated);
  return { twin: updated, durationMs: Date.now() - t0 };
}
