/**
 * Real-platform OAuth + posting registry — Sprint 5 / v2.0 Day-1 surface.
 *
 * The mock `PLATFORM_CLIENTS` registry in `agents/platformClients.ts` stays
 * the default for every code path. Real clients are opt-in via:
 *   - the `clients` overlay accepted by `launchPublishPlan(plan, now, opts)`
 *   - the `EXPO_PUBLIC_PUBLISHER_BACKEND=real` flip in the Lumina dev build
 *
 * That means turning this on is a single-flag flip, never a refactor.
 */

export {
  PLATFORM_AUTH_IDS,
  NotAuthenticatedError,
  TokenRefreshFailedError,
  PlatformPostFailedError,
  type PlatformAuthId,
  type OAuthConfig,
  type OAuthTokens,
  type AuthProvider,
  type AuthorizeRequest,
  type TokenStore,
  type RealPostInput,
  type RealPostResult,
} from "./types";

export { InMemoryTokenStore, TokenManager } from "./tokens";
export { pkcePair, randomString, encodeForm, postForm } from "./oauth";

export { TikTokAuthProvider, TikTokPostingClient } from "./tiktok";
export {
  InstagramAuthProvider,
  InstagramPostingClient,
  type InstagramAuthExtras,
} from "./instagram";
export { YouTubeAuthProvider, YouTubePostingClient } from "./youtube";
