/**
 * Sprint 5 — Real OAuth + posting foundation contract.
 *
 * Locks the invariants the Lumina app relies on when flipping
 * `EXPO_PUBLIC_PUBLISHER_BACKEND=real`:
 *
 *   1. PKCE pair: code_challenge is the base64url SHA-256 of code_verifier
 *      and never re-uses across calls.
 *   2. InMemoryTokenStore round-trips per-platform.
 *   3. TokenManager returns the cached token when fresh.
 *   4. TokenManager auto-refreshes when within 60s of expiry, persists the
 *      result, and returns the new access token.
 *   5. TokenManager wipes the slot + throws NotAuthenticatedError when the
 *      access expires AND no refresh token is on file.
 *   6. TikTok / YouTube / Instagram providers each generate authorize URLs
 *      pointing at the documented endpoints with the documented params.
 *   7. The publisher's launchPublishPlan accepts a per-platform client
 *      overlay and routes through it instead of the mock registry.
 */
import { strict as assert } from "node:assert";

import { pkcePair } from "../platforms/oauth";
import { InMemoryTokenStore, TokenManager } from "../platforms/tokens";
import { TikTokAuthProvider } from "../platforms/tiktok";
import { YouTubeAuthProvider } from "../platforms/youtube";
import { InstagramAuthProvider } from "../platforms/instagram";
import {
  NotAuthenticatedError,
  type AuthProvider,
  type OAuthTokens,
  type PlatformAuthId,
} from "../platforms/types";
import { launchPublishPlan } from "../agents/publisher";
import { watermark } from "../watermark";
import type { PublishPlan } from "../types";
import type { PlatformClient } from "../agents/platformClients";
import { autoRewrite, POLICY_PACKS, type PublishContent } from "@workspace/compliance-shield";

async function run() {
  // ── 1. PKCE pair ───────────────────────────────────────────────────────
  const a = await pkcePair();
  const b = await pkcePair();
  assert.notEqual(a.codeVerifier, b.codeVerifier, "verifiers must be random");
  assert.notEqual(a.codeChallenge, b.codeChallenge, "challenges must differ");
  // Recompute SHA-256 ourselves and compare.
  const expectedDigest = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(a.codeVerifier)),
  );
  let bin = "";
  for (let i = 0; i < expectedDigest.length; i++) bin += String.fromCharCode(expectedDigest[i]!);
  const expected = globalThis.btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  assert.equal(a.codeChallenge, expected, "code_challenge must equal base64url(SHA-256(code_verifier))");

  // ── 2. InMemoryTokenStore round-trip ───────────────────────────────────
  const store = new InMemoryTokenStore();
  const tk: OAuthTokens = {
    platform: "tiktok",
    accessToken: "AT-1",
    refreshToken: "RT-1",
    expiresAt: Date.now() + 3600_000,
    scope: "video.upload",
    tokenType: "Bearer",
    obtainedAt: Date.now(),
    sandbox: true,
  };
  await store.set("tiktok", tk);
  assert.deepEqual(await store.get("tiktok"), tk);
  assert.equal(await store.get("youtube"), null, "store is keyed per platform");
  await store.clear("tiktok");
  assert.equal(await store.get("tiktok"), null, "clear removes the entry");

  // ── 3. TokenManager: fresh token cache ─────────────────────────────────
  const fakeNow = { t: 1_700_000_000_000 };
  const provider: AuthProvider = {
    platform: "tiktok",
    config: { clientId: "x", redirectUri: "y", scopes: [], sandbox: true },
    buildAuthorizeUrl: async () => ({ url: "u", state: "s", codeVerifier: "v" }),
    exchangeCode: async () => fresh,
    refresh: async (t) => ({
      ...t,
      accessToken: t.accessToken + "+r",
      expiresAt: fakeNow.t + 3600_000,
      obtainedAt: fakeNow.t,
    }),
  };
  const fresh: OAuthTokens = {
    platform: "tiktok",
    accessToken: "AT-fresh",
    refreshToken: "RT-fresh",
    expiresAt: fakeNow.t + 3600_000,
    scope: "video.upload",
    tokenType: "Bearer",
    obtainedAt: fakeNow.t,
    sandbox: true,
  };
  const store2 = new InMemoryTokenStore();
  await store2.set("tiktok", fresh);
  const mgr = new TokenManager(store2, { tiktok: provider }, () => fakeNow.t);
  assert.equal(await mgr.getValidAccessToken("tiktok"), "AT-fresh", "fresh token returned as-is");

  // ── 4. TokenManager: auto-refresh near expiry ──────────────────────────
  fakeNow.t += 3600_000 - 30_000; // 30 s before expiry — inside 60 s headroom.
  const refreshed = await mgr.getValidAccessToken("tiktok");
  assert.equal(refreshed, "AT-fresh+r", "expired-soon token must be refreshed");
  const persisted = await store2.get("tiktok");
  assert.equal(persisted?.accessToken, "AT-fresh+r", "refreshed token persisted");
  assert.equal(persisted?.expiresAt, fakeNow.t + 3600_000, "expiry advanced");

  // ── 5. TokenManager: no refresh token → wipe + throw ───────────────────
  const stripped: OAuthTokens = { ...fresh, refreshToken: null, expiresAt: fakeNow.t - 1 };
  const store3 = new InMemoryTokenStore();
  await store3.set("tiktok", stripped);
  const mgr3 = new TokenManager(store3, { tiktok: provider }, () => fakeNow.t);
  await assert.rejects(() => mgr3.getValidAccessToken("tiktok"), NotAuthenticatedError);
  assert.equal(await store3.get("tiktok"), null, "expired w/ no refresh wipes the slot");

  // ── 6. Authorize URL shape per provider ────────────────────────────────
  const tt = new TikTokAuthProvider({
    clientId: "tt-id",
    clientSecret: "tt-secret",
    redirectUri: "lumina://oauth/tiktok",
    scopes: ["video.upload", "user.info.basic"],
    sandbox: true,
  });
  const ttReq = await tt.buildAuthorizeUrl();
  assert.ok(ttReq.url.startsWith("https://www.tiktok.com/v2/auth/authorize/?"));
  assert.match(ttReq.url, /client_key=tt-id/);
  assert.match(ttReq.url, /code_challenge_method=S256/);
  assert.match(ttReq.url, /scope=video\.upload%2Cuser\.info\.basic/);
  assert.equal(ttReq.codeVerifier.length >= 43, true, "PKCE verifier ≥ 43 chars");

  const yt = new YouTubeAuthProvider({
    clientId: "yt-id",
    clientSecret: "yt-secret",
    redirectUri: "lumina://oauth/youtube",
    scopes: ["https://www.googleapis.com/auth/youtube.upload"],
    sandbox: true,
  });
  const ytReq = await yt.buildAuthorizeUrl();
  assert.ok(ytReq.url.startsWith("https://accounts.google.com/o/oauth2/v2/auth?"));
  assert.match(ytReq.url, /access_type=offline/);
  assert.match(ytReq.url, /prompt=consent/);

  const ig = new InstagramAuthProvider({
    clientId: "ig-id",
    clientSecret: "ig-secret",
    redirectUri: "lumina://oauth/instagram",
    scopes: ["instagram_content_publish", "pages_show_list"],
    sandbox: true,
  });
  const igReq = await ig.buildAuthorizeUrl();
  assert.ok(igReq.url.startsWith("https://www.facebook.com/v21.0/dialog/oauth?"));
  assert.match(igReq.url, /client_id=ig-id/);

  // ── 7. Publisher accepts a per-platform client overlay ─────────────────
  const calls: PlatformAuthId[] = [];
  const overlayClient: PlatformClient = {
    platform: "tiktok",
    async post() {
      calls.push("tiktok");
      return { platform: "tiktok", status: "posted", reason: null, mockUrl: "real://tiktok/123" };
    },
  };
  const cleanContent: PublishContent = {
    caption: "thanks for watching",
    hook: "look at this",
    hashtags: ["#fyp"],
    audioCue: "lo-fi",
    thumbnailLabel: "Today",
    durationSec: 28,
    regions: ["us"],
  };
  const passVerdict = autoRewrite(cleanContent, [POLICY_PACKS.tiktok]);
  const plan: PublishPlan = {
    planId: "p-1",
    videoId: "v-1",
    variants: [],
    winnerId: "w-1",
    watermark: watermark({
      video: { id: "v-1", filePath: "mem://v-1", durationSec: 28 },
      creatorKey: "lumina-creator-test",
    }),
    perPlatform: [
      {
        platform: "tiktok",
        adaptation: { aspect: "9:16", maxCaptionLen: 2200, maxDurationSec: 180, captionStyle: "casual" },
        shield: passVerdict,
        content: passVerdict.rewritten,
      },
    ],
    blockedReason: null,
  };
  const result = await launchPublishPlan(plan, 1, { clients: { tiktok: overlayClient } });
  assert.equal(result.perPlatform[0]?.mockUrl, "real://tiktok/123", "overlay client must be used");
  assert.deepEqual(calls, ["tiktok"], "overlay client must be called exactly once");

  console.log("swarm-studio real-platforms OAuth foundation: PASS");
}

run().catch((err) => { console.error(err); process.exit(1); });
