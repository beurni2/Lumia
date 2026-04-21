import type { StyleTwin } from "@workspace/style-twin";
import type { PlatformId, PublishContent, ShieldVerdict } from "@workspace/compliance-shield";
import type { ABVariant } from "./abTest";
import type { SmartWatermark } from "./watermark";

export type AgentId = "ideator" | "director" | "editor" | "monetizer" | "publisher";

export type CulturalRegion =
  | "br" | "mx" | "co" | "ar"
  | "id" | "ph" | "vn" | "th";

/** Per-brief Twin affinity, computed live by verifyMatch() against the user's Style Twin. */
export interface TwinAffinity {
  readonly overall: number;
  readonly voice: number;
  readonly vocabulary: number;
  readonly meetsHeadlineGate: boolean;
  readonly meetsAudioGate: boolean;
}

export interface PastWinReference {
  readonly sampleId: string;
  readonly score: number;
  readonly capturedAt: number;
  readonly synthetic: boolean;
}

export interface Brief {
  id: string;
  hook: string;
  beats: string[];
  culturalTag: string;
  region: CulturalRegion;
  trendSourceIds: string[];
  twinAffinity: TwinAffinity;
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
  viralConfidence: number;
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
  kind: "video" | "brief" | "storyboard" | "win" | "audience-signal" | "deal" | "publish-plan";
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

/* ────────────── Sprint 3: Smart Publisher types ────────────── */

export interface PublishPlatformPlan {
  readonly platform: PlatformId;
  readonly adaptation: {
    readonly aspect: "9:16" | "1:1" | "16:9";
    readonly maxCaptionLen: number;
    readonly maxDurationSec: number;
    readonly captionStyle: "casual" | "punchy" | "title";
  };
  readonly shield: ShieldVerdict;
  /** Final content to actually post (= shield.rewritten). */
  readonly content: PublishContent;
}

export interface PublishPlan {
  readonly planId: string;
  readonly videoId: string;
  /** All 12 A/B variants the orchestrator considered. */
  readonly variants: readonly ABVariant[];
  /** ID of the winning variant, or null if no variant cleared the audio gate. */
  readonly winnerId: string | null;
  readonly watermark: SmartWatermark;
  readonly perPlatform: readonly PublishPlatformPlan[];
  /** Set when winnerId is null — the UI surfaces this verbatim. */
  readonly blockedReason: string | null;
}

export interface PublishResult {
  readonly planId: string;
  readonly launchedAt: number;
  readonly perPlatform: ReadonlyArray<{
    readonly platform: PlatformId;
    readonly status: "posted" | "posted-rewritten" | "blocked";
    readonly reason: string | null;
    readonly mockUrl: string | null;
  }>;
  readonly hardBlocked: boolean;
  readonly summary: string;
}

/* ────────────── Orchestrator interface ────────────── */

export interface PublishRequest {
  readonly platforms: readonly PlatformId[];
  readonly creatorKey: string;
  readonly regions: readonly string[];
}

export interface Orchestrator {
  dailyBriefs(ctx: OrchestratorContext): Promise<Brief[]>;
  storyboard(ctx: OrchestratorContext, briefId: string): Promise<Storyboard>;
  produce(ctx: OrchestratorContext, storyboardId: string): Promise<RenderedVideo>;
  monetize(ctx: OrchestratorContext, videoId: string): Promise<DealDraft[]>;
  /** Sprint 3: Smart Publisher — builds the 12-variant A/B + Shield plan. */
  plan(ctx: OrchestratorContext, videoId: string, request: PublishRequest): Promise<PublishPlan>;
  /** Sprint 3: launch a previously-built plan (mock platform clients). */
  launch(ctx: OrchestratorContext, planId: string): Promise<PublishResult>;
}
