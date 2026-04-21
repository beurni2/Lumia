import {
  ALL_PLATFORMS,
  PlatformPostFailedError,
  NotAuthenticatedError,
  TikTokPostingClient,
  InstagramPostingClient,
  YouTubePostingClient,
  type LaunchOptions,
  type PlatformAuthId,
  type RealPostInput,
  type RealPostResult,
} from "@workspace/swarm-studio";
import type {
  PlatformClient,
  PlatformPostInput,
  PlatformPostResult,
} from "@workspace/swarm-studio";
import type { PlatformId } from "@workspace/compliance-shield";
import type { StyleTwin } from "@workspace/style-twin";
import {
  getPlatformAuthRegistry,
  type PlatformAuthRegistry,
} from "./oauth/platformAuthRegistry";

/**
 * Smart Publisher wiring helpers for the Lumina UI.
 *
 * Two responsibilities:
 *   1. Surface the per-creator stable key the smart watermark needs.
 *   2. Decide — at launch time — whether each platform posts via the mock
 *      registry (Sprint 3 default) or the real OAuth-backed clients
 *      (Sprint 5, US-first launch). The decision is one env flip away:
 *      `EXPO_PUBLIC_PUBLISHER_BACKEND=real`.
 */

export function creatorKeyFor(twin: StyleTwin): string {
  const first = twin.fingerprint.voice.timbreVector[0] ?? 0;
  return `lumina-creator-${first.toFixed(6)}`;
}

/**
 * Default platform set for the "Launch to the World" button. Day-1 v2.0
 * markets only — TikTok / Reels / Shorts. SEA platforms are intentionally
 * excluded from the default; users opt in via the platform picker.
 */
export const DEFAULT_PLATFORMS: readonly PlatformId[] = ["tiktok", "reels", "shorts"];

/** Day-1 v2.0 regions; UI exposes a picker. */
export const DEFAULT_REGIONS: readonly string[] = ["us", "gb", "ca", "au", "in", "ph", "ng"];

/** All supported platforms (Day-1 + SEA Phase 1) for power-user mode. */
export const ALL_SUPPORTED_PLATFORMS: readonly PlatformId[] = ALL_PLATFORMS;

// ─── Mock-to-real switch ────────────────────────────────────────────────────

export type PublisherBackend = "mock" | "real";

export function publisherBackend(): PublisherBackend {
  return process.env.EXPO_PUBLIC_PUBLISHER_BACKEND === "real" ? "real" : "mock";
}

/** Maps Smart Publisher platform IDs ↔ OAuth platform IDs. */
const PLATFORM_ID_TO_AUTH: Partial<Record<PlatformId, PlatformAuthId>> = {
  tiktok: "tiktok",
  reels: "instagram",
  shorts: "youtube",
};

/**
 * Adapts a real OAuth-backed posting client (returns `RealPostResult`) to
 * the in-process `PlatformClient` interface the publisher expects (returns
 * `PlatformPostResult`). This is the seam where the new world meets the
 * old one — keeping the publisher contract unchanged means SEA platforms
 * (still mocks) and Day-1 platforms (real) coexist without forking.
 */
class RealPlatformClientAdapter implements PlatformClient {
  constructor(
    public readonly platform: PlatformId,
    private readonly real: { post(input: RealPostInput): Promise<RealPostResult> },
    /** Resolves the publishable video URI from the publisher's videoId. */
    private readonly resolveVideo: (videoId: string) => Promise<{ videoUri: string; thumbnailUri?: string; accountUsername?: string }>,
  ) {}

  async post(input: PlatformPostInput): Promise<PlatformPostResult> {
    if (input.shield.status === "blocked") {
      const reason =
        input.shield.hits.find((h: { severity: string; explanation: string }) => h.severity === "hard")?.explanation ??
        "Compliance Shield blocked this platform.";
      return { platform: this.platform, status: "blocked", reason, mockUrl: null };
    }
    let resolved: Awaited<ReturnType<typeof this.resolveVideo>>;
    try {
      resolved = await this.resolveVideo(input.videoId);
    } catch (err) {
      return {
        platform: this.platform,
        status: "blocked",
        reason: `Could not resolve video URI: ${err instanceof Error ? err.message : String(err)}`,
        mockUrl: null,
      };
    }
    const realInput: RealPostInput = {
      videoUri: resolved.videoUri,
      caption: input.content.caption,
      hashtags: input.content.hashtags,
      thumbnailUri: resolved.thumbnailUri,
      accountUsername: resolved.accountUsername,
    };
    try {
      const result = await this.real.post(realInput);
      const status: PlatformPostResult["status"] =
        result.status === "failed"
          ? "blocked"
          : input.shield.status === "rewritten"
            ? "posted-rewritten"
            : "posted";
      return {
        platform: this.platform,
        status,
        reason: result.error,
        mockUrl: result.publicUrl ?? result.remoteId,
      };
    } catch (err) {
      const isAuth = err instanceof NotAuthenticatedError;
      const isPostFail = err instanceof PlatformPostFailedError;
      return {
        platform: this.platform,
        status: "blocked",
        reason: isAuth
          ? `Connect your ${this.platform} account to publish there.`
          : isPostFail
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err),
        mockUrl: null,
      };
    }
  }
}

export interface VideoResolver {
  (videoId: string): Promise<{ videoUri: string; thumbnailUri?: string; accountUsername?: string }>;
}

export interface InstagramExtrasResolver {
  (): Promise<{ igUserId: string }>;
}

/**
 * Build the `LaunchOptions.clients` overlay for `launchPublishPlan`. Returns
 * `{}` (no overlay → all-mock) when:
 *   - `EXPO_PUBLIC_PUBLISHER_BACKEND` is not "real", OR
 *   - the per-platform OAuth env vars are not configured.
 *
 * In all other cases, returns a partial overlay — only platforms with
 * configured credentials get real clients; the rest fall through to mocks.
 * That guarantees the demo path keeps working in any half-configured
 * environment.
 */
export function buildLaunchOptions(args: {
  resolveVideo: VideoResolver;
  resolveInstagramExtras?: InstagramExtrasResolver;
  registry?: PlatformAuthRegistry;
}): LaunchOptions {
  if (publisherBackend() !== "real") return {};
  const registry = args.registry ?? getPlatformAuthRegistry();
  if (registry.configured.length === 0) return {};

  const clients: Partial<Record<PlatformId, PlatformClient>> = {};
  for (const [platformId, authId] of Object.entries(PLATFORM_ID_TO_AUTH) as Array<
    [PlatformId, PlatformAuthId]
  >) {
    if (!registry.providers[authId]) continue;
    const real =
      authId === "tiktok"
        ? new TikTokPostingClient(registry.tokens)
        : authId === "instagram"
          ? args.resolveInstagramExtras
            ? new InstagramPostingClient(registry.tokens, args.resolveInstagramExtras)
            : null
          : new YouTubePostingClient(registry.tokens);
    if (!real) continue;
    clients[platformId] = new RealPlatformClientAdapter(platformId, real, args.resolveVideo);
  }
  return { clients };
}
