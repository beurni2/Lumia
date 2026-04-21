import {
  ALL_PLATFORMS,
  POLICY_PACKS,
  autoRewrite,
  type PlatformId,
  type PolicyPack,
  type PublishContent,
  type ShieldVerdict,
} from "@workspace/compliance-shield";
import type { StyleTwin } from "@workspace/style-twin";
import {
  generateABVariants,
  pickWinner,
  type ABVariant,
  VARIANT_COUNT,
} from "../abTest";
import { watermark, type SmartWatermark } from "../watermark";
import type {
  PublishPlan,
  PublishPlatformPlan,
  PublishResult,
  RenderedVideo,
  Storyboard,
} from "../types";

/**
 * Smart Publisher — Sprint 3.
 *
 * Pipeline:
 *   1. Build A/B inputs from the Storyboard's hook variants + Editor video.
 *   2. Generate 12 variants (3 thumb × 2 caption × 2 hook), each scored
 *      against the StyleTwin via verifyMatch + nearest (live kNN).
 *   3. Pick the winning variant (gate-aware).
 *   4. Sign the rendered video with the lossless smart watermark.
 *   5. For every requested platform, run the winner through the Compliance
 *      Shield's autoRewrite pipeline. Per-platform aspect-ratio + caption
 *      adaptation is encoded in `PublishPlatformPlan.adaptation`.
 *
 * The pipeline is pure given (twin, video, storyboard, platforms,
 * creatorKey) plus the deterministic vector memory backend. Every Sprint 2
 * determinism guarantee carries forward.
 */

export interface BuildPlanInput {
  readonly twin: StyleTwin;
  readonly storyboard: Storyboard;
  readonly video: RenderedVideo;
  readonly platforms: readonly PlatformId[];
  /** Creator-stable key for the smart watermark signature. */
  readonly creatorKey: string;
  /** Region codes the creator is publishing into. */
  readonly regions: readonly string[];
}

export async function buildPublishPlan(input: BuildPlanInput): Promise<PublishPlan> {
  if (input.platforms.length === 0) {
    throw new Error("Smart Publisher requires at least one target platform");
  }

  // 1. A/B inputs derived from the Storyboard.
  const seedHooks = pickN(input.storyboard.hookVariants, 2);
  const seedCaptions = [
    captionFor("longform", input.storyboard, input.video),
    captionFor("punchy",   input.storyboard, input.video),
  ];
  const seedThumbnailLabels = [
    thumbnailLabel("hook", input.storyboard),
    thumbnailLabel("payoff", input.storyboard),
    thumbnailLabel("identity", input.storyboard),
  ];

  // 2. Generate 12 variants.
  const variants = await generateABVariants(input.twin, {
    seedHooks,
    seedCaptions,
    seedThumbnailLabels,
  });
  if (variants.length !== VARIANT_COUNT) {
    throw new Error(`Smart Publisher: A/B produced ${variants.length}, expected ${VARIANT_COUNT}`);
  }

  // 3. Pick the winner. Null = no variant cleared the audio gate.
  const winner = pickWinner(variants);
  // Plan identity must be stable across (video, platforms, creatorKey, regions) so
  // calling buildPublishPlan() twice with different requests on the same video
  // doesn't collide in the orchestrator's plans map.
  const planId = `plan-${input.video.id}-${planFingerprint(
    input.platforms,
    input.creatorKey,
    input.regions,
  )}`;
  if (!winner) {
    return {
      planId,
      videoId: input.video.id,
      variants,
      winnerId: null,
      watermark: watermark({ video: input.video, creatorKey: input.creatorKey }),
      perPlatform: [],
      blockedReason:
        "No A/B variant cleared the on-device Twin audio gate (0.95). Re-record one beat or re-train the Twin.",
    };
  }

  // 4. Watermark the video.
  const wm = watermark({ video: input.video, creatorKey: input.creatorKey });

  // 5. Per-platform Shield verdicts.
  const perPlatform: PublishPlatformPlan[] = [];
  for (const platform of input.platforms) {
    const pack: PolicyPack = POLICY_PACKS[platform];
    const baseContent = winnerToContent(winner, input.video, input.regions);
    const verdict = autoRewrite(baseContent, [pack]);
    perPlatform.push({
      platform,
      adaptation: adaptationFor(platform, input.video.durationSec),
      shield: verdict,
      content: verdict.rewritten,
    });
  }

  return {
    planId,
    videoId: input.video.id,
    variants,
    winnerId: winner.id,
    watermark: wm,
    perPlatform,
    blockedReason: null,
  };
}

/**
 * Stable 8-hex fingerprint of the request shape. Two buildPublishPlan() calls
 * on the same video but with different platforms/creatorKey/regions produce
 * distinct planIds and therefore do NOT overwrite each other in the
 * orchestrator's plan registry.
 */
function planFingerprint(
  platforms: readonly PlatformId[],
  creatorKey: string,
  regions: readonly string[],
): string {
  const blob = `${[...platforms].sort().join(",")}|${creatorKey}|${[...regions].sort().join(",")}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < blob.length; i++) {
    h ^= blob.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Mock platform launch. Sprint 3 keeps everything in-process — Sprint 5
 * wires real OAuth + per-platform SDK clients. The contract surface here
 * is what the Sprint 5 work will swap into.
 *
 * Refuses to launch any platform whose Shield verdict is `blocked`. Returns
 * a per-platform result with a deterministic mock URL so the UI can render
 * "✓ Posted to TikTok" affordances.
 */
export async function launchPublishPlan(plan: PublishPlan, now: number = Date.now()): Promise<PublishResult> {
  if (plan.blockedReason) {
    return {
      planId: plan.planId,
      launchedAt: now,
      perPlatform: [],
      hardBlocked: true,
      summary: plan.blockedReason,
    };
  }
  const results = plan.perPlatform.map((p) => {
    if (p.shield.status === "blocked") {
      const reason = p.shield.hits.find((h) => h.severity === "hard")?.explanation
        ?? "Shield blocked this platform.";
      return {
        platform: p.platform,
        status: "blocked" as const,
        reason,
        mockUrl: null as string | null,
      };
    }
    return {
      platform: p.platform,
      status: p.shield.status === "rewritten" ? ("posted-rewritten" as const) : ("posted" as const),
      reason: null as string | null,
      mockUrl: `mock://${p.platform}/${plan.videoId}`,
    };
  });
  const posted = results.filter((r) => r.status !== "blocked").length;
  const blocked = results.length - posted;
  return {
    planId: plan.planId,
    launchedAt: now,
    perPlatform: results,
    hardBlocked: false,
    summary: `Launched to ${posted}/${results.length} platforms${blocked > 0 ? ` · ${blocked} blocked by Shield` : ""}.`,
  };
}

/* ────────────────── helpers ────────────────── */

function pickN<T>(xs: readonly T[], n: number): T[] {
  if (xs.length >= n) return xs.slice(0, n);
  // Pad by repeating the last to keep variant count fixed.
  const out = xs.slice();
  while (out.length < n) out.push(xs[xs.length - 1]);
  return out;
}

function captionFor(
  shape: "longform" | "punchy",
  sb: Storyboard,
  video: RenderedVideo,
): string {
  const beats = sb.shots.map((s) => s.description).join(" · ");
  if (shape === "longform") {
    return `${beats} — Twin-match ${Math.round(video.twinMatchScore * 100)}%`;
  }
  return `${sb.shots[0]?.description ?? "watch"} — under ${Math.round(video.durationSec)}s`;
}

function thumbnailLabel(
  flavor: "hook" | "payoff" | "identity",
  sb: Storyboard,
): string {
  const last = sb.shots[sb.shots.length - 1]?.description ?? "Reveal";
  const first = sb.shots[0]?.description ?? "Watch";
  if (flavor === "hook") return shorten(first);
  if (flavor === "payoff") return shorten(last);
  return "On-Twin";
}

function shorten(s: string): string {
  return s.length > 22 ? s.slice(0, 21).trim() + "…" : s;
}

function winnerToContent(
  winner: ABVariant,
  video: RenderedVideo,
  regions: readonly string[],
): PublishContent {
  // Default platform-agnostic hashtag set; pack rules trim/adjust.
  return {
    caption: winner.caption,
    hook: winner.hook,
    hashtags: ["#fyp", "#brasil", "#viral"],
    audioCue: "on-Twin original",
    thumbnailLabel: winner.thumbnailLabel,
    durationSec: video.durationSec,
    regions,
  };
}

function adaptationFor(platform: PlatformId, durationSec: number): PublishPlatformPlan["adaptation"] {
  switch (platform) {
    case "tiktok":  return { aspect: "9:16", maxCaptionLen: 2200, maxDurationSec: 180, captionStyle: "casual"  };
    case "reels":   return { aspect: "9:16", maxCaptionLen: 2200, maxDurationSec: 90,  captionStyle: "punchy"  };
    case "shorts":  return { aspect: "9:16", maxCaptionLen: 100,  maxDurationSec: 60,  captionStyle: "title"   };
    case "kwai":    return { aspect: "9:16", maxCaptionLen: 300,  maxDurationSec: 60,  captionStyle: "casual"  };
    case "goplay":  return { aspect: "9:16", maxCaptionLen: 500,  maxDurationSec: 120, captionStyle: "casual"  };
    case "kumu":    return { aspect: "9:16", maxCaptionLen: 280,  maxDurationSec: 60,  captionStyle: "punchy"  };
    default: {
      const exhaustive: never = platform;
      throw new Error(`unknown platform adaptation: ${String(exhaustive)} (duration=${durationSec})`);
    }
  }
}

export { ALL_PLATFORMS };
