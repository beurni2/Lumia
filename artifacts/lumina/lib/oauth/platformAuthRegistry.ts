import {
  InstagramAuthProvider,
  InstagramPostingClient,
  TikTokAuthProvider,
  TikTokPostingClient,
  TokenManager,
  YouTubeAuthProvider,
  YouTubePostingClient,
  type AuthProvider,
  type OAuthConfig,
  type PlatformAuthId,
  type TokenStore,
} from "@workspace/swarm-studio";
import { SecureTokenStore } from "./secureTokenStore";

/**
 * Per-platform auth/post wiring for the Lumina app.
 *
 * Configs are read from `EXPO_PUBLIC_*` env vars (baked into the bundle at
 * build time, never read on-device after that). Sandbox mode is the
 * default — the production-key flip is a single env change at the EAS
 * dev-build profile level (see docs/EAS_DEV_BUILD_RUNBOOK.md).
 *
 * Three Day-1 v2.0 platforms only:
 *   tiktok / instagram / youtube
 *
 * SEA platforms (kwai/goplay/kumu) are NOT wired here — they continue to
 * use the in-process mock client registry until the Phase 1 SEA layering
 * lands (months 2–6 per ROADMAP.md).
 */

interface EnvSnapshot {
  readonly tiktokClientId: string | undefined;
  readonly tiktokClientSecret: string | undefined;
  readonly instagramClientId: string | undefined;
  readonly instagramClientSecret: string | undefined;
  readonly youtubeClientId: string | undefined;
  readonly youtubeClientSecret: string | undefined;
  readonly redirectScheme: string;
  readonly sandbox: boolean;
}

function readEnv(): EnvSnapshot {
  // process.env is statically inlined by the Metro bundler for any key
  // matching EXPO_PUBLIC_*.
  return {
    tiktokClientId: process.env.EXPO_PUBLIC_TIKTOK_CLIENT_ID,
    tiktokClientSecret: process.env.EXPO_PUBLIC_TIKTOK_CLIENT_SECRET,
    instagramClientId: process.env.EXPO_PUBLIC_INSTAGRAM_CLIENT_ID,
    instagramClientSecret: process.env.EXPO_PUBLIC_INSTAGRAM_CLIENT_SECRET,
    youtubeClientId: process.env.EXPO_PUBLIC_YOUTUBE_CLIENT_ID,
    youtubeClientSecret: process.env.EXPO_PUBLIC_YOUTUBE_CLIENT_SECRET,
    redirectScheme: process.env.EXPO_PUBLIC_REDIRECT_SCHEME ?? "lumina",
    sandbox: process.env.EXPO_PUBLIC_PLATFORM_MODE !== "production",
  };
}

function tiktokConfig(env: EnvSnapshot): OAuthConfig | null {
  if (!env.tiktokClientId) return null;
  return {
    clientId: env.tiktokClientId,
    clientSecret: env.tiktokClientSecret,
    redirectUri: `${env.redirectScheme}://oauth/tiktok`,
    scopes: ["user.info.basic", "video.upload", "video.publish"],
    sandbox: env.sandbox,
  };
}

function instagramConfig(env: EnvSnapshot): OAuthConfig | null {
  if (!env.instagramClientId) return null;
  return {
    clientId: env.instagramClientId,
    clientSecret: env.instagramClientSecret,
    redirectUri: `${env.redirectScheme}://oauth/instagram`,
    scopes: [
      "instagram_basic",
      "instagram_content_publish",
      "pages_show_list",
      "pages_read_engagement",
    ],
    sandbox: env.sandbox,
  };
}

function youtubeConfig(env: EnvSnapshot): OAuthConfig | null {
  if (!env.youtubeClientId) return null;
  return {
    clientId: env.youtubeClientId,
    clientSecret: env.youtubeClientSecret,
    redirectUri: `${env.redirectScheme}://oauth/youtube`,
    scopes: [
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
    ],
    sandbox: env.sandbox,
  };
}

export interface PlatformAuthRegistry {
  readonly tokens: TokenManager;
  readonly providers: Partial<Record<PlatformAuthId, AuthProvider>>;
  readonly configured: readonly PlatformAuthId[];
  readonly sandbox: boolean;
}

let cached: PlatformAuthRegistry | null = null;

/**
 * Lazy singleton — first call wires the providers + TokenManager from env.
 * `tokenStore` is injectable so tests can swap in `InMemoryTokenStore`.
 */
export function getPlatformAuthRegistry(
  tokenStore: TokenStore = new SecureTokenStore(),
): PlatformAuthRegistry {
  if (cached) return cached;
  const env = readEnv();
  const providers: Partial<Record<PlatformAuthId, AuthProvider>> = {};
  const configured: PlatformAuthId[] = [];

  const tt = tiktokConfig(env);
  if (tt) {
    providers.tiktok = new TikTokAuthProvider(tt);
    configured.push("tiktok");
  }
  const ig = instagramConfig(env);
  if (ig) {
    providers.instagram = new InstagramAuthProvider(ig);
    configured.push("instagram");
  }
  const yt = youtubeConfig(env);
  if (yt) {
    providers.youtube = new YouTubeAuthProvider(yt);
    configured.push("youtube");
  }

  cached = {
    tokens: new TokenManager(tokenStore, providers),
    providers,
    configured,
    sandbox: env.sandbox,
  };
  return cached;
}

/**
 * Build per-platform real `PostingClient`s. Returns only those platforms
 * that were configured via env. The shape `{ tiktok, instagram, youtube }`
 * matches `LaunchOptions.clients` exactly — but note that `LaunchOptions`
 * keys on `PlatformId` (which uses `reels`/`shorts`), so the
 * `publisherFactory` adapter remaps before handing them to the publisher.
 */
export function buildRealPostingClients(
  registry: PlatformAuthRegistry = getPlatformAuthRegistry(),
  igExtras?: () => Promise<{ igUserId: string }>,
): Partial<Record<PlatformAuthId, { post(input: { videoUri: string; caption: string; hashtags: readonly string[]; thumbnailUri?: string; accountUsername?: string }): Promise<unknown> }>> {
  const out: Partial<Record<PlatformAuthId, { post: (input: { videoUri: string; caption: string; hashtags: readonly string[]; thumbnailUri?: string; accountUsername?: string }) => Promise<unknown> }>> = {};
  if (registry.providers.tiktok) {
    out.tiktok = new TikTokPostingClient(registry.tokens);
  }
  if (registry.providers.instagram) {
    if (!igExtras) {
      throw new Error("Instagram client requires an igExtras provider (call with the IG Business User ID).");
    }
    out.instagram = new InstagramPostingClient(registry.tokens, igExtras);
  }
  if (registry.providers.youtube) {
    out.youtube = new YouTubePostingClient(registry.tokens);
  }
  return out;
}

/** Test hook: clear the cached registry. */
export function __resetPlatformAuthRegistryForTest(): void {
  cached = null;
}
