import type { StyleTwin } from "@workspace/style-twin";

export type AgentId = "ideator" | "director" | "editor" | "monetizer";

export type CulturalRegion =
  | "br" | "mx" | "co" | "ar"
  | "id" | "ph" | "vn" | "th";

/** Per-brief Twin affinity, computed live by verifyMatch() against the user's Style Twin. */
export interface TwinAffinity {
  /** Overall similarity score (0–1) of this brief's projected fingerprint vs the user's Twin. */
  readonly overall: number;
  /** Sub-score for voice/pacing match. */
  readonly voice: number;
  /** Sub-score for vocabulary/catchphrase overlap. */
  readonly vocabulary: number;
  /** True iff overall ≥ HEADLINE_MATCH_TARGET (0.998). */
  readonly meetsHeadlineGate: boolean;
  /** True iff voice ≥ AUDIO_MATCH_GATE (0.95) — the publish gate. */
  readonly meetsAudioGate: boolean;
}

/** Reference to a past on-device win the Director can riff on. */
export interface PastWinReference {
  readonly sampleId: string;
  readonly score: number;
  readonly capturedAt: number;
  /** True if this neighbor came from synthetic demo seed data, not a real win. */
  readonly synthetic: boolean;
}

export interface Brief {
  id: string;
  hook: string;
  beats: string[];
  culturalTag: string;
  region: CulturalRegion;
  trendSourceIds: string[];
  /** Real-time score from @workspace/style-twin verifyMatch(). */
  twinAffinity: TwinAffinity;
  /** Top-k past wins from the encrypted on-device vector memory (kNN). */
  pastWinReferences: PastWinReference[];
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
