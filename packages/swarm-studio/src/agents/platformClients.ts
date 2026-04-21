import type { PlatformId, PublishContent, ShieldVerdict } from "@workspace/compliance-shield";

/**
 * Platform clients — Sprint 3.
 *
 * The Smart Publisher's pipeline ends here. Sprint 3 ships in-process,
 * deterministic mock clients per platform; Sprint 5 swaps the same
 * `PlatformClient` interface for real OAuth + per-platform SDK clients.
 *
 * Each client is responsible for:
 *   - Translating a `PublishContent` + watermark sig into a platform-shaped
 *     URL (the shape Sprint 5's real client will return after a successful
 *     post).
 *   - Refusing the post if the Shield verdict is `blocked`.
 *   - Reporting the per-platform status the UI renders.
 *
 * Determinism guarantee: given identical (videoId, watermarkSig, content,
 * shield) the mock client returns bit-identical (status, url, reason).
 */

export interface PlatformPostResult {
  readonly platform: PlatformId;
  readonly status: "posted" | "posted-rewritten" | "blocked";
  readonly reason: string | null;
  readonly mockUrl: string | null;
}

export interface PlatformPostInput {
  readonly videoId: string;
  readonly watermarkSig: string;
  readonly content: PublishContent;
  readonly shield: ShieldVerdict;
}

export interface PlatformClient {
  readonly platform: PlatformId;
  post(input: PlatformPostInput): Promise<PlatformPostResult>;
}

/**
 * Build a platform-shaped mock URL from the video id + watermark sig.
 * URL shape mirrors each platform's real public URL pattern so the UI
 * can render a believable "✓ Posted to TikTok · view post" affordance
 * during Sprint 3 demos. The watermark sig is woven in so re-runs that
 * produce different watermarks (different creators) get different URLs.
 */
function urlFor(platform: PlatformId, videoId: string, sig: string): string {
  const slug = `${videoId}-${sig.slice(0, 8)}`;
  switch (platform) {
    case "tiktok":  return `mock://tiktok.com/@lumina/video/${slug}`;
    case "reels":   return `mock://instagram.com/reel/${slug}/`;
    case "shorts":  return `mock://youtube.com/shorts/${slug}`;
    case "kwai":    return `mock://kwai.com/@lumina/${slug}`;
    case "goplay":  return `mock://goplay.id/v/${slug}`;
    case "kumu":    return `mock://kumu.live/v/${slug}`;
    default: {
      const exhaustive: never = platform;
      throw new Error(`urlFor: unknown platform ${String(exhaustive)}`);
    }
  }
}

class MockPlatformClient implements PlatformClient {
  constructor(public readonly platform: PlatformId) {}

  async post(input: PlatformPostInput): Promise<PlatformPostResult> {
    if (input.shield.status === "blocked") {
      const reason =
        input.shield.hits.find((h) => h.severity === "hard")?.explanation ??
        "Compliance Shield blocked this platform.";
      return {
        platform: this.platform,
        status: "blocked",
        reason,
        mockUrl: null,
      };
    }
    return {
      platform: this.platform,
      status: input.shield.status === "rewritten" ? "posted-rewritten" : "posted",
      reason: null,
      mockUrl: urlFor(this.platform, input.videoId, input.watermarkSig),
    };
  }
}

/**
 * Per-platform mock clients. Stable singleton registry — identity is
 * preserved across calls so test suites can assert reference equality.
 */
export const PLATFORM_CLIENTS: Record<PlatformId, PlatformClient> = {
  tiktok: new MockPlatformClient("tiktok"),
  reels:  new MockPlatformClient("reels"),
  shorts: new MockPlatformClient("shorts"),
  kwai:   new MockPlatformClient("kwai"),
  goplay: new MockPlatformClient("goplay"),
  kumu:   new MockPlatformClient("kumu"),
};

export function clientFor(platform: PlatformId): PlatformClient {
  const c = PLATFORM_CLIENTS[platform];
  if (!c) throw new Error(`No platform client registered for ${platform}`);
  return c;
}
