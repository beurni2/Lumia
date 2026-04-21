/**
 * @workspace/edge-cloud
 *
 * Selective edge-cloud burst client. <5s additional latency for renders that
 * exceed the device's thermal/memory budget (4K upscale, 3D VFX, multi-track
 * music synthesis).
 *
 * SPRINT 2/3 — currently a contract-only stub.
 *
 * Burst invariants (enforced by the BurstClient implementation):
 *   1. Per-action consent required — never implicit.
 *   2. Stateless payload — no creator identity, no Style Twin, no raw audio.
 *   3. Burst layer never persists creator data.
 *   4. Trend sync is delta-only nightly pull (no per-creator queries).
 */

export type BurstKind = "upscale-4k" | "vfx-3d" | "music-synth" | "trend-delta";

export interface BurstRequest<T = unknown> {
  kind: BurstKind;
  /** Opaque, anonymized payload. Must contain no PII. */
  payload: T;
  /** Sentinel asserting the caller obtained per-action user consent. */
  consentToken: string;
}

export interface BurstResponse<T = unknown> {
  kind: BurstKind;
  result: T;
  latencyMs: number;
  /** Server-issued certificate that no creator data was persisted. */
  ephemeralProof: string;
}

export interface BurstClient {
  invoke<TIn, TOut>(req: BurstRequest<TIn>): Promise<BurstResponse<TOut>>;
}

export interface TrendDelta {
  region: string;
  generatedAt: number;
  added: Array<{ id: string; tag: string; weight: number }>;
  removed: string[];
  /** Ed25519 signature over the canonicalized delta. */
  signature: string;
}

export interface TrendSyncClient {
  pullNightlyDelta(region: string, sinceMs: number): Promise<TrendDelta>;
}

export const SPRINT = 2 as const;
export const STATUS = "stub" as const;
export const MAX_BURST_LATENCY_MS = 5000 as const;
