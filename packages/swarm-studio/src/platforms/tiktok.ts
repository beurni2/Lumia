import { encodeForm, pkcePair, postForm, randomString } from "./oauth";
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
 * TikTok — Content Posting API + Login Kit.
 *
 * Sandbox: enabled per-app in the TikTok Developers Portal. Sandbox apps can
 * only post to allow-listed test accounts; the wire endpoints are identical.
 *
 * Docs:
 *   - https://developers.tiktok.com/doc/oauth-user-access-token-management
 *   - https://developers.tiktok.com/doc/content-posting-api-get-started
 */

const TIKTOK_AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const TIKTOK_POST_INIT_URL = "https://open.tiktokapis.com/v2/post/publish/video/init/";
const TIKTOK_VIDEO_QUERY_URL =
  "https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count";

interface TikTokTokenResponse {
  readonly access_token: string;
  readonly expires_in: number;
  readonly refresh_token: string;
  readonly refresh_expires_in: number;
  readonly scope: string;
  readonly token_type: string;
}

export class TikTokAuthProvider implements AuthProvider {
  readonly platform = "tiktok" as const;
  constructor(
    readonly config: OAuthConfig,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  async buildAuthorizeUrl(): Promise<AuthorizeRequest> {
    const { codeVerifier, codeChallenge } = await pkcePair();
    const state = randomString(16);
    const url =
      TIKTOK_AUTHORIZE_URL +
      "?" +
      encodeForm({
        client_key: this.config.clientId,
        redirect_uri: this.config.redirectUri,
        response_type: "code",
        scope: this.config.scopes.join(","),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      });
    return { url, state, codeVerifier };
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<OAuthTokens> {
    const raw = (await postForm(
      TIKTOK_TOKEN_URL,
      {
        client_key: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: this.config.redirectUri,
        code_verifier: codeVerifier,
      },
      { fetch: this.fetchImpl },
    )) as TikTokTokenResponse;
    return tokensFromResponse(raw, this.config.sandbox);
  }

  async refresh(tokens: OAuthTokens): Promise<OAuthTokens> {
    if (!tokens.refreshToken) throw new Error("no refresh token");
    const raw = (await postForm(
      TIKTOK_TOKEN_URL,
      {
        client_key: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: tokens.refreshToken,
        grant_type: "refresh_token",
      },
      { fetch: this.fetchImpl },
    )) as TikTokTokenResponse;
    return tokensFromResponse(raw, this.config.sandbox);
  }
}

function tokensFromResponse(raw: TikTokTokenResponse, sandbox: boolean): OAuthTokens {
  const now = Date.now();
  return {
    platform: "tiktok",
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? null,
    expiresAt: now + raw.expires_in * 1000,
    scope: raw.scope,
    tokenType: "Bearer",
    obtainedAt: now,
    sandbox,
  };
}

export class TikTokPostingClient {
  readonly platform = "tiktok" as const;
  constructor(
    private readonly tokens: TokenManager,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  async post(input: RealPostInput): Promise<RealPostResult> {
    const accessToken = await this.tokens.getValidAccessToken("tiktok");
    const body = {
      post_info: {
        title: truncate(`${input.caption} ${input.hashtags.join(" ")}`.trim(), 2200),
        privacy_level: "SELF_ONLY",
        disable_comment: false,
        disable_duet: false,
        disable_stitch: false,
        video_cover_timestamp_ms: 1000,
      },
      source_info: {
        source: "PULL_FROM_URL",
        video_url: input.videoUri,
      },
    };
    let res: Response;
    try {
      res = await this.fetchImpl(TIKTOK_POST_INIT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new PlatformPostFailedError("tiktok", err instanceof Error ? err.message : String(err));
    }
    const text = await res.text();
    if (!res.ok) {
      throw new PlatformPostFailedError("tiktok", `HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    let parsed: { data?: { publish_id?: string } } = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      /* tolerate empty bodies */
    }
    const publishId = parsed.data?.publish_id ?? null;
    return {
      platform: "tiktok",
      status: "queued",
      remoteId: publishId,
      publicUrl: null,
      sandbox: (await this.tokens.peek("tiktok"))?.sandbox ?? false,
      error: null,
    };
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";
}

/* Augment TikTokPostingClient with metrics fetch via /v2/video/query/. */
declare module "./tiktok" {
  interface TikTokPostingClient {
    fetchMetrics(
      remoteId: string,
    ): Promise<{ views: number; likes: number; comments: number; shares: number }>;
  }
}

TikTokPostingClient.prototype.fetchMetrics = async function fetchMetrics(
  this: TikTokPostingClient,
  remoteId: string,
) {
  // The private-prop access is intentional — fetchMetrics belongs with
  // the client and shares its token + fetch implementation.
  const self = this as unknown as {
    tokens: TokenManager;
    fetchImpl: typeof fetch;
  };
  const accessToken = await self.tokens.getValidAccessToken("tiktok");
  const res = await self.fetchImpl(TIKTOK_VIDEO_QUERY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({ filters: { video_ids: [remoteId] } }),
  });
  if (!res.ok) {
    throw new PlatformPostFailedError(
      "tiktok",
      `video/query HTTP ${res.status}`,
    );
  }
  const json = (await res.json()) as {
    data?: { videos?: Array<{ view_count?: number; like_count?: number; comment_count?: number; share_count?: number }> };
  };
  const v = json.data?.videos?.[0] ?? {};
  return {
    views: v.view_count ?? 0,
    likes: v.like_count ?? 0,
    comments: v.comment_count ?? 0,
    shares: v.share_count ?? 0,
  };
};
