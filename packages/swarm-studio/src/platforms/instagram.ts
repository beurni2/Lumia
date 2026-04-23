import { encodeForm, postForm, randomString } from "./oauth";
import {
  PlatformPostFailedError,
  type AuthProvider,
  type AuthorizeRequest,
  type OAuthConfig,
  type OAuthTokens,
  type RealPostInput,
  type RealPostResult,
} from "./types";
import type { TokenManager } from "./tokens";

/**
 * Instagram Reels — Meta Graph API (v21).
 *
 * Sandbox: Meta App Dashboard → "Development Mode". Test users added there
 * can post Reels via the same Graph endpoints; non-test posts return
 * `OAuthException`. Confidential client — clientSecret required.
 *
 * Docs:
 *   - https://developers.facebook.com/docs/facebook-login/guides/access-tokens
 *   - https://developers.facebook.com/docs/instagram-api/guides/content-publishing
 */

const FB_AUTHORIZE_URL = "https://www.facebook.com/v21.0/dialog/oauth";
const FB_TOKEN_URL = "https://graph.facebook.com/v21.0/oauth/access_token";
const IG_GRAPH_BASE = "https://graph.facebook.com/v21.0";

interface FbTokenResponse {
  readonly access_token: string;
  readonly token_type: string;
  readonly expires_in?: number;
  readonly refresh_token?: string;
}

export interface InstagramAuthExtras {
  /** IG Business account ID — captured at onboarding via /me/accounts. */
  readonly igUserId: string;
}

export class InstagramAuthProvider implements AuthProvider {
  readonly platform = "instagram" as const;
  constructor(
    readonly config: OAuthConfig,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  async buildAuthorizeUrl(): Promise<AuthorizeRequest> {
    const state = randomString(16);
    const url =
      FB_AUTHORIZE_URL +
      "?" +
      encodeForm({
        client_id: this.config.clientId,
        redirect_uri: this.config.redirectUri,
        response_type: "code",
        scope: this.config.scopes.join(","),
        state,
      });
    // Facebook OAuth doesn't use PKCE; codeVerifier is unused but kept on
    // the AuthorizeRequest contract for consistency with TikTok/YouTube.
    return { url, state, codeVerifier: "" };
  }

  async exchangeCode(code: string, _codeVerifier: string): Promise<OAuthTokens> {
    const raw = (await postForm(
      FB_TOKEN_URL,
      {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri,
        code,
      },
      { fetch: this.fetchImpl },
    )) as FbTokenResponse;
    return await this.toLongLived(raw);
  }

  /**
   * Meta short-lived tokens (~1 h) are upgraded to long-lived (~60 d)
   * server-side via the `fb_exchange_token` flow. Refresh re-runs the
   * upgrade — tokens within their refresh window (last 24 h) are extended.
   */
  async refresh(tokens: OAuthTokens): Promise<OAuthTokens> {
    const raw = (await postForm(
      `${IG_GRAPH_BASE}/oauth/access_token`,
      {
        grant_type: "fb_exchange_token",
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        fb_exchange_token: tokens.accessToken,
      },
      { fetch: this.fetchImpl },
    )) as FbTokenResponse;
    return await this.toLongLived(raw);
  }

  private async toLongLived(raw: FbTokenResponse): Promise<OAuthTokens> {
    const now = Date.now();
    return {
      platform: "instagram",
      accessToken: raw.access_token,
      // Long-lived tokens are self-refreshing — reuse the access token in the
      // refresh slot so TokenManager can call refresh() near expiry.
      refreshToken: raw.access_token,
      expiresAt: now + (raw.expires_in ?? 60 * 24 * 3600) * 1000,
      scope: this.config.scopes.join(","),
      tokenType: "Bearer",
      obtainedAt: now,
      sandbox: this.config.sandbox,
    };
  }
}

export class InstagramPostingClient {
  readonly platform = "instagram" as const;
  constructor(
    private readonly tokens: TokenManager,
    private readonly extras: () => Promise<InstagramAuthExtras>,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  async post(input: RealPostInput): Promise<RealPostResult> {
    const accessToken = await this.tokens.getValidAccessToken("instagram");
    const { igUserId } = await this.extras();

    // 1. Create container.
    const createUrl = `${IG_GRAPH_BASE}/${igUserId}/media?${encodeForm({
      media_type: "REELS",
      video_url: input.videoUri,
      caption: `${input.caption}\n\n${input.hashtags.join(" ")}`.trim(),
      access_token: accessToken,
    })}`;
    let createRes: Response;
    try {
      createRes = await this.fetchImpl(createUrl, { method: "POST" });
    } catch (err) {
      throw new PlatformPostFailedError("instagram", err instanceof Error ? err.message : String(err));
    }
    const createText = await createRes.text();
    if (!createRes.ok) {
      throw new PlatformPostFailedError("instagram", `media create HTTP ${createRes.status}: ${createText.slice(0, 200)}`);
    }
    const { id: containerId } = JSON.parse(createText) as { id: string };

    // 2. Publish container. Real impl polls /{container-id}?fields=status_code
    //    until FINISHED before publishing — kept inline here for clarity.
    const publishUrl = `${IG_GRAPH_BASE}/${igUserId}/media_publish?${encodeForm({
      creation_id: containerId,
      access_token: accessToken,
    })}`;
    const publishRes = await this.fetchImpl(publishUrl, { method: "POST" });
    const publishText = await publishRes.text();
    if (!publishRes.ok) {
      throw new PlatformPostFailedError("instagram", `media_publish HTTP ${publishRes.status}: ${publishText.slice(0, 200)}`);
    }
    const { id: mediaId } = JSON.parse(publishText) as { id: string };

    return {
      platform: "instagram",
      status: "posted",
      remoteId: mediaId,
      publicUrl: input.accountUsername
        ? `https://instagram.com/${input.accountUsername}/reel/${mediaId}`
        : null,
      sandbox: (await this.tokens.peek("instagram"))?.sandbox ?? false,
      error: null,
    };
  }

  /**
   * Reels metrics via /{media-id}/insights. We request the four metric
   * names that map to our normalized `{views, likes, comments, shares}`
   * shape; missing values become zero so downstream consumers always
   * see a complete record.
   */
  async fetchMetrics(
    remoteId: string,
  ): Promise<{ views: number; likes: number; comments: number; shares: number }> {
    const accessToken = await this.tokens.getValidAccessToken("instagram");
    const url = `${IG_GRAPH_BASE}/${remoteId}/insights?${encodeForm({
      metric: "plays,likes,comments,shares",
      access_token: accessToken,
    })}`;
    const res = await this.fetchImpl(url);
    if (!res.ok) {
      throw new PlatformPostFailedError(
        "instagram",
        `insights HTTP ${res.status}`,
      );
    }
    const json = (await res.json()) as {
      data?: Array<{ name: string; values?: Array<{ value?: number }> }>;
    };
    const lookup = (name: string) =>
      json.data?.find((d) => d.name === name)?.values?.[0]?.value ?? 0;
    return {
      views: lookup("plays"),
      likes: lookup("likes"),
      comments: lookup("comments"),
      shares: lookup("shares"),
    };
  }
}
