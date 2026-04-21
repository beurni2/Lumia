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
export const SPRINT = 2;
export const STATUS = "stub";
export const MAX_BURST_LATENCY_MS = 5000;
