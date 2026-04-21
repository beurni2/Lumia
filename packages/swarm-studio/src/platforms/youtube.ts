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
 * YouTube Shorts — Data API v3.
 *
 * Sandbox: Google does not expose a dedicated sandbox; the v2.0 launch uses
 * an isolated test channel + a Google Cloud project in "Testing" publishing
 * status (allow-listed test users only). The wire endpoints are identical
 * to production. `config.sandbox === true` triggers the sandbox UI badge
 * but does not change endpoints.
 *
 * Docs:
 *   - https://developers.google.com/identity/protocols/oauth2/native-app
 *   - https://developers.google.com/youtube/v3/docs/videos/insert
 */

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const YT_VIDEO_INSERT_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";

interface GoogleTokenResponse {
  readonly access_token: string;
  readonly expires_in: number;
  readonly refresh_token?: string;
  readonly scope: string;
  readonly token_type: string;
}

export class YouTubeAuthProvider implements AuthProvider {
  readonly platform = "youtube" as const;
  constructor(
    readonly config: OAuthConfig,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  async buildAuthorizeUrl(): Promise<AuthorizeRequest> {
    const { codeVerifier, codeChallenge } = await pkcePair();
    const state = randomString(16);
    const url =
      GOOGLE_AUTHORIZE_URL +
      "?" +
      encodeForm({
        client_id: this.config.clientId,
        redirect_uri: this.config.redirectUri,
        response_type: "code",
        scope: this.config.scopes.join(" "),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        access_type: "offline",
        prompt: "consent",
      });
    return { url, state, codeVerifier };
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<OAuthTokens> {
    const raw = (await postForm(
      GOOGLE_TOKEN_URL,
      {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: this.config.redirectUri,
        code_verifier: codeVerifier,
      },
      { fetch: this.fetchImpl },
    )) as GoogleTokenResponse;
    return tokensFromResponse(raw, this.config.sandbox, /* preserveRefresh */ undefined);
  }

  async refresh(tokens: OAuthTokens): Promise<OAuthTokens> {
    if (!tokens.refreshToken) throw new Error("no refresh token");
    const raw = (await postForm(
      GOOGLE_TOKEN_URL,
      {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: tokens.refreshToken,
        grant_type: "refresh_token",
      },
      { fetch: this.fetchImpl },
    )) as GoogleTokenResponse;
    // Google does NOT re-emit the refresh_token on refresh — preserve it.
    return tokensFromResponse(raw, this.config.sandbox, tokens.refreshToken);
  }
}

function tokensFromResponse(
  raw: GoogleTokenResponse,
  sandbox: boolean,
  preserveRefresh: string | undefined,
): OAuthTokens {
  const now = Date.now();
  return {
    platform: "youtube",
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? preserveRefresh ?? null,
    expiresAt: now + raw.expires_in * 1000,
    scope: raw.scope,
    tokenType: "Bearer",
    obtainedAt: now,
    sandbox,
  };
}

export class YouTubePostingClient {
  readonly platform = "youtube" as const;
  constructor(
    private readonly tokens: TokenManager,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  async post(input: RealPostInput): Promise<RealPostResult> {
    const accessToken = await this.tokens.getValidAccessToken("youtube");
    // YouTube Data API: a Short is just a vertical video ≤ 60 s with the
    // #Shorts hashtag in the title or description. The Smart Publisher's
    // adaptation step already clamps duration; we ensure the hashtag here.
    const titleSeed = input.caption.split("\n")[0]?.trim() || "Lumina post";
    const title = truncate(`${titleSeed} #Shorts`, 100);
    const description = `${input.caption}\n\n${input.hashtags.join(" ")} #Shorts`.trim();

    const metadata = {
      snippet: {
        title,
        description,
        categoryId: "22", // People & Blogs
      },
      status: {
        privacyStatus: "private", // sandbox safety — promote to "public" via the UI
        selfDeclaredMadeForKids: false,
      },
    };

    let initRes: Response;
    try {
      initRes = await this.fetchImpl(YT_VIDEO_INSERT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": "video/mp4",
        },
        body: JSON.stringify(metadata),
      });
    } catch (err) {
      throw new PlatformPostFailedError("youtube", err instanceof Error ? err.message : String(err));
    }
    if (!initRes.ok) {
      const text = await initRes.text();
      throw new PlatformPostFailedError("youtube", `init HTTP ${initRes.status}: ${text.slice(0, 200)}`);
    }
    const uploadUrl = initRes.headers.get("Location") || initRes.headers.get("location");
    if (!uploadUrl) {
      throw new PlatformPostFailedError("youtube", "init succeeded but no resumable upload URL returned");
    }

    // The actual byte upload is delegated to the Lumina upload manager so
    // it can stream from `expo-file-system` with progress + retry. Here we
    // surface the upload URL as the "remoteId" until the bytes are pushed.
    return {
      platform: "youtube",
      status: "queued",
      remoteId: uploadUrl,
      publicUrl: null,
      sandbox: (await this.tokens.peek("youtube"))?.sandbox ?? false,
      error: null,
    };
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";
}
