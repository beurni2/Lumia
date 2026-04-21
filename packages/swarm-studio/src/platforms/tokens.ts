import {
  NotAuthenticatedError,
  TokenRefreshFailedError,
  type AuthProvider,
  type OAuthTokens,
  type PlatformAuthId,
  type TokenStore,
} from "./types";

/**
 * Volatile token store — used by tests and as the fallback when no
 * SecureTokenStore is wired (e.g. running the package against `tsx` in CI).
 * Swap in `SecureTokenStore` (expo-secure-store) inside the Lumina app.
 */
export class InMemoryTokenStore implements TokenStore {
  private readonly map = new Map<PlatformAuthId, OAuthTokens>();

  async get(platform: PlatformAuthId): Promise<OAuthTokens | null> {
    return this.map.get(platform) ?? null;
  }

  async set(platform: PlatformAuthId, tokens: OAuthTokens): Promise<void> {
    if (tokens.platform !== platform) {
      throw new Error(`InMemoryTokenStore.set: tokens.platform=${tokens.platform} != ${platform}`);
    }
    this.map.set(platform, tokens);
  }

  async clear(platform: PlatformAuthId): Promise<void> {
    this.map.delete(platform);
  }
}

/** Refresh tokens this many ms before expiry. */
const REFRESH_HEADROOM_MS = 60_000;

/**
 * Wraps a `TokenStore` + per-platform `AuthProvider`s with auto-refresh.
 * Every real platform client goes through `getValidAccessToken()` so the
 * refresh logic lives in exactly one place (audit-friendly).
 */
export class TokenManager {
  constructor(
    private readonly store: TokenStore,
    private readonly providers: Partial<Record<PlatformAuthId, AuthProvider>>,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** Persists a freshly-minted token bundle (called after the OAuth callback). */
  async save(tokens: OAuthTokens): Promise<void> {
    await this.store.set(tokens.platform, tokens);
  }

  /** Surfaces `null` instead of throwing — for "Connected?" UI checks. */
  async peek(platform: PlatformAuthId): Promise<OAuthTokens | null> {
    return this.store.get(platform);
  }

  async signOut(platform: PlatformAuthId): Promise<void> {
    await this.store.clear(platform);
  }

  /**
   * Returns a non-expired access token, refreshing in-place if needed.
   * Throws `NotAuthenticatedError` if the user has never authed (or signed
   * out) and `TokenRefreshFailedError` if the refresh round-trip fails.
   */
  async getValidAccessToken(platform: PlatformAuthId): Promise<string> {
    const current = await this.store.get(platform);
    if (!current) throw new NotAuthenticatedError(platform);

    if (current.expiresAt - this.clock() > REFRESH_HEADROOM_MS) {
      return current.accessToken;
    }
    if (!current.refreshToken) {
      // Access expired and no refresh token issued — force re-auth.
      await this.store.clear(platform);
      throw new NotAuthenticatedError(platform);
    }
    const provider = this.providers[platform];
    if (!provider) throw new NotAuthenticatedError(platform);

    let refreshed: OAuthTokens;
    try {
      refreshed = await provider.refresh(current);
    } catch (err) {
      throw new TokenRefreshFailedError(platform, err instanceof Error ? err.message : String(err));
    }
    await this.store.set(platform, refreshed);
    return refreshed.accessToken;
  }
}
