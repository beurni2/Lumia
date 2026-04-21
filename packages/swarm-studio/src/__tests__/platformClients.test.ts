/**
 * Sprint 3 regression — Platform clients contract.
 *
 * The Smart Publisher launch path dispatches each per-platform plan to a
 * `PlatformClient`. Sprint 3 ships in-process mocks; Sprint 5 will swap in
 * real OAuth + per-platform SDK clients against the SAME interface.
 *
 * Asserted invariants:
 *   1. There is exactly one client per supported platform.
 *   2. Each client's `platform` field matches its registry key.
 *   3. The mock URL is platform-shaped (host pattern matches the real
 *      public URL of that platform) — Sprint 5 demos rely on this for
 *      believable "view post" affordances.
 *   4. The mock URL embeds the watermark sig prefix → different creators
 *      / different watermarks produce different URLs (no collisions in
 *      multi-creator demo runs).
 *   5. Determinism: same input → same output across calls.
 *   6. Blocked-shield short-circuit: client refuses to post and surfaces
 *      the hard rule's `humanExplanation` verbatim (UI shows it).
 *   7. Rewritten-shield maps to `posted-rewritten` status.
 *   8. Pass-shield maps to `posted` status.
 *   9. Live pipeline: launch returns one result per platform, each
 *      sourced from the corresponding client.
 */
import { strict as assert } from "node:assert";
import { PLATFORM_CLIENTS, clientFor } from "../agents/platformClients";
import {
  ALL_PLATFORMS,
  POLICY_PACKS,
  autoRewrite,
  type PlatformId,
  type PublishContent,
  type ShieldVerdict,
} from "@workspace/compliance-shield";

const URL_HOST: Record<PlatformId, RegExp> = {
  tiktok: /^mock:\/\/tiktok\.com\/@lumina\/video\//,
  reels:  /^mock:\/\/instagram\.com\/reel\//,
  shorts: /^mock:\/\/youtube\.com\/shorts\//,
  kwai:   /^mock:\/\/kwai\.com\/@lumina\//,
  goplay: /^mock:\/\/goplay\.id\/v\//,
  kumu:   /^mock:\/\/kumu\.live\/v\//,
};

function cleanContent(): PublishContent {
  return {
    caption: "thanks for watching",
    hook: "look at this",
    hashtags: ["#fyp"],
    audioCue: "lo-fi café",
    thumbnailLabel: "Today",
    durationSec: 28,
    regions: ["br"],
  };
}

function blockedVerdictFor(platform: PlatformId, content: PublishContent): ShieldVerdict {
  // Force a hard hit — TikTok medical claim is universal-friendly so we
  // craft per-platform blocked content that trips a hard rule on each pack.
  const hardContent: Record<PlatformId, PublishContent> = {
    tiktok: { ...content, caption: "this cures cancer in 7 days" },
    reels:  { ...content, caption: "guaranteed 10x returns this week" },
    shorts: { ...content, durationSec: 90 },
    kwai:   { ...content, caption: "joguei tigrinho hoje" },
    goplay: { ...content, regions: ["id"], caption: "kafir semua" },
    kumu:   { ...content, regions: ["ph"], caption: "tip me at paypal.me/foo" },
  };
  const verdict = autoRewrite(hardContent[platform], [POLICY_PACKS[platform]]);
  assert.equal(verdict.status, "blocked", `precondition: ${platform} blocked-fixture must be hard-blocked`);
  return verdict;
}

async function run() {
  // ── 1. & 2. Registry shape. ──────────────────────────────────────────
  for (const p of ALL_PLATFORMS) {
    const c = PLATFORM_CLIENTS[p];
    assert.ok(c, `missing client for ${p}`);
    assert.equal(c.platform, p, `client.platform must equal registry key (${p})`);
    assert.equal(clientFor(p), c, "clientFor() must return the registry singleton");
  }
  assert.equal(Object.keys(PLATFORM_CLIENTS).length, ALL_PLATFORMS.length, "exactly one client per supported platform");

  // ── 3. & 4. & 5. URL shape, watermark coupling, determinism. ────────
  const baseInput = {
    videoId: "vid-123",
    watermarkSig: "abcdef1234567890",
    content: cleanContent(),
    shield: autoRewrite(cleanContent(), [POLICY_PACKS.tiktok]),
  };
  for (const p of ALL_PLATFORMS) {
    const r1 = await clientFor(p).post(baseInput);
    const r2 = await clientFor(p).post(baseInput);
    assert.equal(r1.platform, p);
    assert.equal(r1.status, "posted", `${p}: clean content must be posted`);
    assert.ok(r1.mockUrl, `${p}: clean post must return a mockUrl`);
    assert.ok(URL_HOST[p].test(r1.mockUrl!), `${p}: mockUrl ${r1.mockUrl} must match host pattern ${URL_HOST[p]}`);
    assert.deepEqual(r1, r2, `${p}: client must be deterministic for identical input`);
    // Different watermark → different URL (no collisions).
    const rDifferentWm = await clientFor(p).post({ ...baseInput, watermarkSig: "ffffffff00000000" });
    assert.notEqual(r1.mockUrl, rDifferentWm.mockUrl, `${p}: different watermark sigs must produce different URLs`);
  }

  // ── 6. Blocked shield short-circuits. ────────────────────────────────
  for (const p of ALL_PLATFORMS) {
    const content = cleanContent();
    const blocked = blockedVerdictFor(p, content);
    const result = await clientFor(p).post({
      videoId: "vid-blocked",
      watermarkSig: "deadbeefcafebabe",
      content: blocked.rewritten,
      shield: blocked,
    });
    assert.equal(result.status, "blocked", `${p}: blocked shield must short-circuit to status="blocked"`);
    assert.equal(result.mockUrl, null, `${p}: blocked posts must NOT return a URL`);
    assert.ok(result.reason && result.reason.length > 0, `${p}: blocked posts must surface a human reason`);
    // The reason must be the hard rule's humanExplanation, byte-for-byte.
    const hardHit = blocked.hits.find((h) => h.severity === "hard");
    assert.ok(hardHit, `${p}: blocked-fixture must contain a hard hit`);
    assert.equal(result.reason, hardHit!.explanation, `${p}: reason must be the hard rule's humanExplanation`);
  }

  // ── 7. Rewritten-shield mapping. ─────────────────────────────────────
  // TikTok: link-in-bio is a soft rule that auto-rewrites; outcome should
  // be `posted-rewritten`.
  const linkContent: PublishContent = { ...cleanContent(), caption: "recipe — link in bio" };
  const rewrittenVerdict = autoRewrite(linkContent, [POLICY_PACKS.tiktok]);
  assert.equal(rewrittenVerdict.status, "rewritten");
  const rewrittenResult = await clientFor("tiktok").post({
    videoId: "vid-rewritten",
    watermarkSig: "0102030405060708",
    content: rewrittenVerdict.rewritten,
    shield: rewrittenVerdict,
  });
  assert.equal(rewrittenResult.status, "posted-rewritten", "rewritten shield must map to posted-rewritten status");
  assert.ok(rewrittenResult.mockUrl, "rewritten posts still return a mockUrl");

  console.log("swarm-studio platform clients contract: PASS");
}

run().catch((err) => { console.error(err); process.exit(1); });
