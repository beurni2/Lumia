import { ideate, isoDay, scoreBrief } from "./agents/ideator";
import { direct } from "./agents/director";
import { edit } from "./agents/editor";
import { monetize } from "./agents/monetizer";
import { buildPublishPlan, launchPublishPlan } from "./agents/publisher";
import type {
  Brief,
  DealDraft,
  Orchestrator,
  OrchestratorContext,
  PublishPlan,
  PublishRequest,
  PublishResult,
  RenderedVideo,
  Storyboard,
} from "./types";

export interface MockOrchestratorOptions {
  /** Deterministic clock — defaults to Date.now. Tests pin a value. */
  now?: () => number;
  /** Deterministic ISO day key — defaults to UTC day from `now()`. */
  dayKey?: () => string;
}

/**
 * MockOrchestrator — coordinates Ideator → Director → Editor → Monetizer
 * → Publisher against the in-memory MemoryGraph.
 *
 * Determinism contract (Sprint 2 + extended in Sprint 3): given identical
 * (StyleTwin, region, dayKey, now, platforms, creatorKey, regions) the
 * orchestrator produces bit-identical Brief / Storyboard / RenderedVideo /
 * DealDraft / PublishPlan / PublishResult outputs.
 */
export class MockOrchestrator implements Orchestrator {
  private briefs = new Map<string, Brief>();
  private storyboards = new Map<string, Storyboard>();
  private videos = new Map<string, RenderedVideo>();
  private plans = new Map<string, PublishPlan>();
  private now: () => number;
  private dayKey: () => string;

  constructor(opts: MockOrchestratorOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.dayKey = opts.dayKey ?? (() => isoDay(this.now()));
  }

  async dailyBriefs(ctx: OrchestratorContext): Promise<Brief[]> {
    const shortlist = ideate(ctx.styleTwin, ctx.region, this.dayKey());
    const enriched = await Promise.all(
      shortlist.map(async ({ brief, trend }) => {
        const enrichment = await scoreBrief(ctx.styleTwin, trend);
        return { ...brief, ...enrichment } as Brief;
      }),
    );
    for (const b of enriched) {
      this.briefs.set(b.id, b);
      await ctx.memory.write({ id: b.id, kind: "brief", payload: b });
    }
    return enriched;
  }

  async storyboard(ctx: OrchestratorContext, briefId: string): Promise<Storyboard> {
    const brief = this.briefs.get(briefId);
    if (!brief) throw new Error(`Brief not found: ${briefId}`);
    const sb = direct(brief, ctx.styleTwin);
    this.storyboards.set(sb.id, sb);
    await ctx.memory.write({ id: sb.id, kind: "storyboard", payload: sb });
    return sb;
  }

  async produce(ctx: OrchestratorContext, storyboardId: string): Promise<RenderedVideo> {
    const sb = this.storyboards.get(storyboardId);
    if (!sb) throw new Error(`Storyboard not found: ${storyboardId}`);
    const allowed = await ctx.consent.request("burst-render");
    if (!allowed) throw new Error("Render denied by consent gate");
    const video = edit(sb, ctx.styleTwin);
    this.videos.set(video.id, video);
    await ctx.memory.write({ id: video.id, kind: "video", payload: video });
    if (video.viralConfidence > 0.85) {
      await ctx.memory.write({
        id: `win-${video.id}`,
        kind: "win",
        payload: { videoId: video.id, score: video.viralConfidence },
      });
    }
    return video;
  }

  async monetize(ctx: OrchestratorContext, videoId: string): Promise<DealDraft[]> {
    const video = this.videos.get(videoId);
    if (!video) throw new Error(`Video not found: ${videoId}`);
    const drafts = monetize(video, ctx.region, this.now());
    for (const d of drafts) {
      await ctx.memory.write({ id: d.id, kind: "deal", payload: d });
    }
    return drafts;
  }

  async plan(
    ctx: OrchestratorContext,
    videoId: string,
    request: PublishRequest,
  ): Promise<PublishPlan> {
    const video = this.videos.get(videoId);
    if (!video) throw new Error(`Video not found: ${videoId}`);
    const sb = this.storyboards.get(video.storyboardId);
    if (!sb) throw new Error(`Storyboard not found for video ${videoId}`);
    const plan = await buildPublishPlan({
      twin: ctx.styleTwin,
      storyboard: sb,
      video,
      platforms: request.platforms,
      creatorKey: request.creatorKey,
      regions: request.regions,
    });
    this.plans.set(plan.planId, plan);
    await ctx.memory.write({ id: plan.planId, kind: "publish-plan", payload: plan });
    return plan;
  }

  async launch(ctx: OrchestratorContext, planId: string): Promise<PublishResult> {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`PublishPlan not found: ${planId}`);
    const allowed = await ctx.consent.request("publish");
    if (!allowed) throw new Error("Publish denied by consent gate");
    return launchPublishPlan(plan, this.now());
  }
}
