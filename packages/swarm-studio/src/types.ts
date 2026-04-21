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
  id: string;
  briefId: string;
  shots: Array<{ duration: number; description: string; cameraNote?: string }>;
  hookVariants: string[];
}

export interface RenderedVideo {
  id: string;
  storyboardId: string;
  filePath: string;
  durationSec: number;
  /** Confidence the rendered video clones the StyleTwin within tolerance. */
  viralConfidence: number;
  /** Twin-similarity overall score (0–1) — must be ≥ 0.95 to publish. */
  twinMatchScore: number;
  reasoning: string;
}

export interface DealDraft {
  id: string;
  videoId: string;
  brandHandle: string;
  pitchMarkdown: string;
  dmDraft: string;
  channel: "instagram" | "whatsapp" | "tiktok";
  estimatedFeeUsd: number;
  estimatedCreatorTakeUsd: number;
}

export interface MemoryGraphNode {
  id: string;
  kind: "video" | "brief" | "storyboard" | "win" | "audience-signal" | "deal";
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
  storyboard(ctx: OrchestratorContext, briefId: string): Promise<Storyboard>;
  produce(ctx: OrchestratorContext, storyboardId: string): Promise<RenderedVideo>;
  monetize(ctx: OrchestratorContext, videoId: string): Promise<DealDraft[]>;
}
