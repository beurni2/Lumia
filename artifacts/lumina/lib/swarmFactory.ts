import {
  AlwaysAllowConsent,
  InMemoryMemoryGraph,
  MockOrchestrator,
  type CulturalRegion,
  type Orchestrator,
  type OrchestratorContext,
} from "@workspace/swarm-studio";
import {
  appendVectors,
  loadVectors,
  type StyleTwin,
  type VectorEntry,
} from "@workspace/style-twin";
import { ensureStyleTwinBackend } from "./styleTwinBackend";

/**
 * Process-singleton swarm wiring for Lumina Sprint 2.
 *
 * The MemoryGraph is in-process (resets on app reload). Sprint 3 swaps it
 * for the encrypted SecureBackend-persisted version. The ConsentGate is
 * always-allow in Sprint 2; Sprint 3 wires it to the in-app consent sheet.
 *
 * This module also seeds the encrypted vector memory with a small set of
 * synthetic "past win" embeddings derived from the user's own Twin so the
 * Ideator's `nearest()` calls return meaningful neighbors on first run.
 * Real recordings produced through the Editor will append over these.
 */
let cached: { orchestrator: Orchestrator; memory: InMemoryMemoryGraph } | null = null;

export function getOrchestrator() {
  if (cached) return cached;
  ensureStyleTwinBackend();
  cached = {
    orchestrator: new MockOrchestrator(),
    memory: new InMemoryMemoryGraph(),
  };
  return cached;
}

export function makeContext(twin: StyleTwin, region: CulturalRegion): OrchestratorContext {
  const { memory } = getOrchestrator();
  return {
    styleTwin: twin,
    memory,
    consent: new AlwaysAllowConsent(),
    region,
  };
}

/**
 * Idempotent. Seeds the encrypted on-device vector memory with three
 * synthetic past-win embeddings derived from the user's Twin timbre. Each
 * is a deterministic perturbation so `nearest()` returns a stable ordering
 * for the demo. Real Editor renders will append over these as the user
 * generates content.
 *
 * No-ops once any vectors exist (real or seeded), so it never overwrites
 * the user's actual history.
 */
export async function ensureSeededVectors(twin: StyleTwin): Promise<void> {
  ensureStyleTwinBackend();
  const existing = await loadVectors();
  if (existing.length > 0) return;

  const base = twin.fingerprint.voice.timbreVector;
  const seeded: VectorEntry[] = [0.02, 0.05, 0.09].map((drift, i) => ({
    sampleId: `seed-win-${i}`,
    capturedAt: Date.now() - (i + 1) * 86_400_000, // 1, 2, 3 days ago
    kind: "voice-timbre" as const,
    vector: normalise(
      base.map((v, j) => v + (((j * 2654435761) >>> 0) / 0xffffffff - 0.5) * drift),
    ),
  }));
  await appendVectors(seeded);
}

function normalise(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}
