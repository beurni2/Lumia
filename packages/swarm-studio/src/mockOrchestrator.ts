import { ideate, isoDay } from "./agents/ideator";
import { direct } from "./agents/director";
import { edit } from "./agents/editor";
import { monetize } from "./agents/monetizer";
import type {
  Brief,
  DealDraft,
  Orchestrator,
  OrchestratorContext,
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
 * against the in-memory MemoryGraph. Every step writes a node so the UI can
 * render the audit trail (the same trail the Compliance Shield audits in
 * production).
 *
 * Determinism contract: given identical (StyleTwin, region, dayKey, now),
 * the orchestrator produces bit-identical Brief / Storyboard / RenderedVideo
 * / DealDraft outputs. Wall-clock dependence is isolated to the injectable
 * `now()` and `dayKey()` so tests can pin them.
 */
export class MockOrchestrator implements Orchestrator {
  private briefs = new Map<string, Brief>();
  private storyboards = new Map<string, Storyboard>();
  private videos = new Map<string, RenderedVideo>();
  private now: () => number;
  private dayKey: () => string;

  constructor(opts: MockOrchestratorOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.dayKey = opts.dayKey ?? (() => isoDay(this.now()));
  }

  async dailyBriefs(ctx: OrchestratorContext): Promise<Brief[]> {
    const briefs = ideate(ctx.styleTwin, ctx.region, this.dayKey());
    for (const b of briefs) {
      this.briefs.set(b.id, b);
      await ctx.memory.write({ id: b.id, kind: "brief", payload: b });
    }
    return briefs;
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
    // edit() throws TwinMatchRejected if the candidate falls below the gate;
    // the orchestrator surfaces it to the caller verbatim.
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
}
