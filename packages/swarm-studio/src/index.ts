/**
 * @workspace/swarm-studio
 *
 * The 4-agent collaborative swarm. Ideator → Director → Editor → Monetizer,
 * coordinated by the Orchestrator via an internal memory graph.
 *
 * SPRINT 2 (weeks 3–4) — currently a contract-only stub.
 * Real agent implementations land alongside the ExecuTorch adapter in
 * @workspace/style-twin.
 */
import type { StyleTwin } from "@workspace/style-twin";

export type AgentId = "ideator" | "director" | "editor" | "monetizer";

export type CulturalRegion =
  | "br" | "mx" | "co" | "ar"
  | "id" | "ph" | "vn" | "th";

export interface Brief {
  id: string;
  hook: string;
  beats: string[];
  culturalTag: string;
  region: CulturalRegion;
  trendSourceIds: string[];
}

export interface Storyboard {
  briefId: string;
  shots: Array<{ duration: number; description: string; cameraNote?: string }>;
  hookVariants: string[];
}

export interface RenderedVideo {
  storyboardId: string;
  filePath: string;
  durationSec: number;
  viralConfidence: number;
  reasoning: string;
}

export interface DealDraft {
  videoId: string;
  brandHandle: string;
  pitchMarkdown: string;
  dmDraft: string;
  channel: "instagram" | "whatsapp" | "tiktok";
}

export interface MemoryGraphNode {
  id: string;
  kind: "video" | "brief" | "win" | "audience-signal" | "deal";
  payload: unknown;
  createdAt: number;
}

export interface MemoryGraph {
  read(filter: { kind?: MemoryGraphNode["kind"]; limit?: number }): Promise<MemoryGraphNode[]>;
  write(node: Omit<MemoryGraphNode, "createdAt">): Promise<void>;
}

export interface ConsentGate {
  request(action: "burst-render" | "send-dm" | "publish"): Promise<boolean>;
}

export interface OrchestratorContext {
  styleTwin: StyleTwin;
  memory: MemoryGraph;
  consent: ConsentGate;
  region: CulturalRegion;
}

export interface Orchestrator {
  dailyBriefs(ctx: OrchestratorContext): Promise<Brief[]>;
  produce(ctx: OrchestratorContext, briefId: string): Promise<RenderedVideo>;
  monetize(ctx: OrchestratorContext, videoId: string): Promise<DealDraft[]>;
}

export const SPRINT = 2 as const;
export const STATUS = "stub" as const;
