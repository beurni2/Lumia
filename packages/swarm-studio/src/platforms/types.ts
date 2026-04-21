/**
 * Real OAuth + posting foundation — Sprint 5 (US-first launch).
 *
 * Sandbox-mode first. Real production credentials are flipped only after
 * the v2.0 English-First Beta gate clears the privacy + posting audit.
 *
 * Only the three Day-1 v2.0 platforms are wired here:
 *   - TikTok  (Content Posting API + Login Kit)
 *   - Instagram Reels (Meta Graph API + Facebook Login)
 *   - YouTube Shorts (Data API v3 + Google OAuth)
 *
 * SEA platforms (kwai/goplay/kumu) stay on the mock client registry until
 * the Phase 1 SEA layering kicks in (months 2–6 per ROADMAP.md).
 */

export type PlatformAuthId = "tiktok" | "instagram" | "youtube";

export const PLATFORM_AUTH_IDS: readonly PlatformAuthId[] = [
  "tiktok",
  "instagram",
  "youtube",
] as const;

export interface OAuthConfig {
  readonly clientId: string;
  /**
   * Confidential clients only. On-device flows MUST be PKCE public clients
   * and pass `undefined` here — the secret never lives on the phone.
   */
  readonly clientSecret?: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  /**
   * `true` while the platform app is in its sandbox / test-mode state.
   * Surfaces in the UI as a "Sandbox" badge so QA never confuses sandbox
   * posts with real posts.
   */
  readonly sandbox: boolean;
}

export interface OAuthTokens {
  readonly platform: PlatformAuthId;
  readonly accessToken: string;
  readonly refreshToken: string | null;
  /** Unix ms when the access token expires. */
  readonly expiresAt: number;
  readonly scope: string;
  readonly tokenType: "Bearer";
  /** Unix ms when this token bundle was minted (for audit). */
  readonly obtainedAt: number;
  /** `true` when issued by a sandbox app. Mirrored from `OAuthConfig`. */
  readonly sandbox: boolean;
}

/**
 * Platform-agnostic encrypted token vault. Implementations:
 *   - `InMemoryTokenStore`        — tests and CI
 *   - `SecureTokenStore`          — `expo-secure-store` (artifacts/lumina)
 */
export interface TokenStore {
  get(platform: PlatformAuthId): Promise<OAuthTokens | null>;
  set(platform: PlatformAuthId, tokens: OAuthTokens): Promise<void>;
  clear(platform: PlatformAuthId): Promise<void>;
}

/** Returned by `AuthProvider.buildAuthorizeUrl()` so the UI can launch the browser flow. */
export interface AuthorizeRequest {
  readonly url: string;
  readonly state: string;
  readonly codeVerifier: string;
}

export interface AuthProvider {
  readonly platform: PlatformAuthId;
  readonly config: OAuthConfig;
  buildAuthorizeUrl(): Promise<AuthorizeRequest>;
  exchangeCode(code: string, codeVerifier: string): Promise<OAuthTokens>;
  refresh(tokens: OAuthTokens): Promise<OAuthTokens>;
}

/** Payload handed to a real platform client when the publisher launches. */
export interface RealPostInput {
  readonly videoUri: string;
  readonly caption: string;
  readonly hashtags: readonly string[];
  readonly thumbnailUri?: string;
  /** Some platforms require the public-facing username; cached at auth time. */
  readonly accountUsername?: string;
}

export interface RealPostResult {
  readonly platform: PlatformAuthId;
  readonly status: "posted" | "queued" | "failed";
  readonly remoteId: string | null;
  readonly publicUrl: string | null;
  readonly sandbox: boolean;
  readonly error: string | null;
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export class NotAuthenticatedError extends Error {
  constructor(public readonly platform: PlatformAuthId) {
    super(`Not authenticated for ${platform}. Run the OAuth flow first.`);
    this.name = "NotAuthenticatedError";
  }
}

export class TokenRefreshFailedError extends Error {
  constructor(public readonly platform: PlatformAuthId, cause: string) {
    super(`Token refresh failed for ${platform}: ${cause}`);
    this.name = "TokenRefreshFailedError";
  }
}

export class PlatformPostFailedError extends Error {
  constructor(public readonly platform: PlatformAuthId, cause: string) {
    super(`Post to ${platform} failed: ${cause}`);
    this.name = "PlatformPostFailedError";
  }
}
