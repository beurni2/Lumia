import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import type { AuthProvider, OAuthTokens, PlatformAuthId } from "@workspace/swarm-studio";

/**
 * Bridge between `expo-auth-session`'s system-browser PKCE flow and the
 * platform-agnostic `AuthProvider` interface from `@workspace/swarm-studio`.
 *
 * Why bridge instead of using `AuthProvider.buildAuthorizeUrl()` directly?
 *   `expo-auth-session` handles the deep-link round-trip (deep-link parsing,
 *   state validation, ASWebAuthenticationSession on iOS, Custom Tabs on
 *   Android) — which we want — but it builds the URL itself. We ignore the
 *   verifier we'd build ourselves and use the one AuthSession generates,
 *   then hand the returned `code` + verifier to the provider's
 *   `exchangeCode()`.
 */

// Required for proper redirect handling on Android.
WebBrowser.maybeCompleteAuthSession();

const ENDPOINTS: Record<PlatformAuthId, AuthSession.DiscoveryDocument> = {
  tiktok: {
    authorizationEndpoint: "https://www.tiktok.com/v2/auth/authorize/",
    tokenEndpoint: "https://open.tiktokapis.com/v2/oauth/token/",
  },
  instagram: {
    authorizationEndpoint: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenEndpoint: "https://graph.facebook.com/v21.0/oauth/access_token",
  },
  youtube: {
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
  },
};

export interface AuthSessionResult {
  readonly status: "success" | "cancelled" | "error";
  readonly tokens: OAuthTokens | null;
  readonly error: string | null;
}

/**
 * Run the full OAuth flow for one platform. Opens the system browser,
 * waits for the redirect deep-link, exchanges the code via the provider,
 * and returns the issued tokens. Caller persists them via `TokenManager.save`.
 *
 * `clientId`/`scopes`/`redirectUri` come from the provider config; passing
 * the provider in directly keeps PKCE behaviour and platform-specific
 * extras (TikTok's `client_key` rename, Google's `prompt=consent`) the
 * provider's responsibility.
 */
export async function runOAuthFlow(provider: AuthProvider): Promise<AuthSessionResult> {
  const platform = provider.platform;
  const discovery = ENDPOINTS[platform];

  // expo-auth-session uses `client_id`; TikTok uses `client_key`. We add the
  // platform-specific field via `extraParams` so the wire format is correct.
  const extraParams: Record<string, string> = {};
  if (platform === "tiktok") {
    extraParams.client_key = provider.config.clientId;
  }
  if (platform === "youtube") {
    extraParams.access_type = "offline";
    extraParams.prompt = "consent";
  }

  const request = new AuthSession.AuthRequest({
    clientId: provider.config.clientId,
    redirectUri: provider.config.redirectUri,
    scopes: [...provider.config.scopes],
    responseType: AuthSession.ResponseType.Code,
    usePKCE: platform !== "instagram", // Facebook OAuth doesn't accept PKCE.
    extraParams,
  });

  let result: AuthSession.AuthSessionResult;
  try {
    await request.makeAuthUrlAsync(discovery);
    result = await request.promptAsync(discovery);
  } catch (err) {
    return {
      status: "error",
      tokens: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (result.type === "cancel" || result.type === "dismiss") {
    return { status: "cancelled", tokens: null, error: null };
  }
  if (result.type !== "success") {
    return {
      status: "error",
      tokens: null,
      error: result.type === "error" ? result.error?.message ?? "auth error" : `unexpected: ${result.type}`,
    };
  }

  const code = result.params.code;
  if (!code) {
    return { status: "error", tokens: null, error: "redirect missing 'code'" };
  }
  // PKCE verifier lives on the AuthRequest; for non-PKCE flows it's empty.
  const verifier = request.codeVerifier ?? "";

  try {
    const tokens = await provider.exchangeCode(code, verifier);
    return { status: "success", tokens, error: null };
  } catch (err) {
    return {
      status: "error",
      tokens: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
