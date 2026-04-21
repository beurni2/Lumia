/**
 * @workspace/swarm-studio
 *
 * The 4-agent collaborative swarm: Ideator → Director → Editor → Monetizer,
 * coordinated by the Orchestrator over an internal MemoryGraph.
 *
 * SPRINT 2 (weeks 3–4) — MockOrchestrator runs the full pipeline in Expo Go.
 * Real on-device generation (text via Mistral 7B, video via on-device render
 * graph) lands alongside the ExecuTorch dev build.
 */
export * from "./types";
export { InMemoryMemoryGraph, AlwaysAllowConsent } from "./memory";
export { MockOrchestrator, type MockOrchestratorOptions } from "./mockOrchestrator";
export { ideate, isoDay, scoreBrief } from "./agents/ideator";
export { direct } from "./agents/director";
export { edit, TwinMatchRejected } from "./agents/editor";
export { monetize } from "./agents/monetizer";
export { REGIONAL_TRENDS, type RegionalTrend } from "./regionalTrends";

export const SPRINT = 2 as const;
export const STATUS = "mock-pipeline" as const;
