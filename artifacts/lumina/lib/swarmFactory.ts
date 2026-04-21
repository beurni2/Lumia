import {
  AlwaysAllowConsent,
  InMemoryMemoryGraph,
  MockOrchestrator,
  type CulturalRegion,
  type Orchestrator,
  type OrchestratorContext,
} from "@workspace/swarm-studio";
import type { StyleTwin } from "@workspace/style-twin";

/**
 * Process-singleton swarm wiring for Lumina Sprint 2.
 *
 * The MemoryGraph is in-process (resets on app reload). Sprint 3 swaps it
 * for the encrypted SecureBackend-persisted version. The ConsentGate is
 * always-allow in Sprint 2; Sprint 3 wires it to the in-app consent sheet.
 */
let cached: { orchestrator: Orchestrator; memory: InMemoryMemoryGraph } | null = null;

export function getOrchestrator() {
  if (cached) return cached;
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
