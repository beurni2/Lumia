/**
 * Sprint 3 regression — Compliance Shield rule-pack contracts.
 *
 * Locks the per-pack soft/hard rules so future agent work cannot
 * silently weaken the policy engine. Mirrors the Sprint 3 phase-complete
 * audit's red-team corpus shape: a known-flagged sample MUST trip its
 * expected rule under its expected platform pack.
 */
import { strict as assert } from "node:assert";
import {
  ALL_PLATFORMS,
  POLICY_PACKS,
  autoRewrite,
  evaluate,
  type PublishContent,
} from "../index";

function clean(overrides: Partial<PublishContent> = {}): PublishContent {
  return {
    caption: "obrigado por assistir, comenta aí",
    hook: "tem uma coisa que ninguém te conta",
    hashtags: ["#fyp", "#brasil"],
    audioCue: "lo-fi café",
    thumbnailLabel: "Sao Paulo",
    durationSec: 28,
    regions: ["br"],
    ...overrides,
  };
}

function expectHit(hits: readonly { ruleId: string }[], ruleId: string): void {
  assert.ok(
    hits.some((h) => h.ruleId === ruleId),
    `expected hit for ${ruleId}, got: ${hits.map((h) => h.ruleId).join(", ")}`,
  );
}

function run() {
  // ── 1. All 6 packs registered ─────────────────────────────────────────
  assert.equal(ALL_PLATFORMS.length, 6, "must ship 6 packs (TikTok, Reels, Shorts, Kwai, GoPlay, Kumu)");
  for (const p of ALL_PLATFORMS) {
    assert.ok(POLICY_PACKS[p], `missing pack: ${p}`);
    assert.ok(POLICY_PACKS[p].rules.length > 0, `pack ${p} has no rules`);
    // Hard rules MUST NOT define a rewrite — they exist to block.
    for (const rule of POLICY_PACKS[p].rules) {
      if (rule.severity === "hard") {
        assert.equal(
          rule.rewrite,
          undefined,
          `hard rule ${rule.id} must not define rewrite()`,
        );
      }
    }
  }

  // ── 2. TikTok soft + hard hits ────────────────────────────────────────
  const tt = POLICY_PACKS.tiktok;
  expectHit(evaluate(clean({ caption: "miracle cure for acne, link in bio" }), [tt]), "tiktok-banned-token");
  expectHit(evaluate(clean({ caption: "link in bio for the recipe" }), [tt]), "tiktok-link-in-bio");
  expectHit(
    evaluate(clean({ hashtags: ["#a", "#b", "#c", "#d", "#e", "#f"] }), [tt]),
    "tiktok-hashtag-spam",
  );
  expectHit(evaluate(clean({ hook: "this cures cancer" }), [tt]), "tiktok-medical-claim");
  expectHit(evaluate(clean({ hashtags: ["#vape"] }), [tt]), "tiktok-age-restricted-tag");

  // ── 3. Reels soft hits ────────────────────────────────────────────────
  const r = POLICY_PACKS.reels;
  expectHit(
    evaluate(clean({ caption: "a".repeat(140) }), [r]),
    "reels-caption-length",
  );
  expectHit(evaluate(clean({ caption: "watch me on tiktok too" }), [r]), "reels-competitor-mention");
  expectHit(
    evaluate(clean({ hook: "guaranteed 10x returns this week" }), [r]),
    "reels-financial-promise",
  );

  // ── 4. Shorts hard duration ───────────────────────────────────────────
  const s = POLICY_PACKS.shorts;
  expectHit(evaluate(clean({ durationSec: 90 }), [s]), "shorts-duration-cap");
  expectHit(evaluate(clean({ caption: "official audio: Bad Bunny" }), [s]), "shorts-copyrighted-music-callout");

  // ── 5. Kwai gambling rules (BR-specific) ──────────────────────────────
  const k = POLICY_PACKS.kwai;
  expectHit(evaluate(clean({ caption: "ganhe dinheiro fácil hoje" }), [k]), "kwai-soft-gambling-phrase");
  expectHit(evaluate(clean({ caption: "joguei tigrinho e ganhei" }), [k]), "kwai-hard-gambling-phrase");
  expectHit(evaluate(clean({ thumbnailLabel: "GANHE AGORA" }), [k]), "kwai-thumbnail-shouting");

  // ── 6. GoPlay (Indonesia) SARA hard block ─────────────────────────────
  const gp = POLICY_PACKS.goplay;
  expectHit(
    evaluate(clean({ regions: ["id"], caption: "kafir semua orang" }), [gp]),
    "goplay-sara-content",
  );
  expectHit(
    evaluate(clean({ regions: ["id"], caption: "saya makan babi tadi" }), [gp]),
    "goplay-halal-soft-flag",
  );

  // ── 7. Kumu (Philippines) off-platform tipping hard block ────────────
  const km = POLICY_PACKS.kumu;
  expectHit(
    evaluate(clean({ regions: ["ph"], caption: "tip me at paypal.me/foo" }), [km]),
    "kumu-off-platform-tipping",
  );

  // ── 8. autoRewrite: clean → pass ──────────────────────────────────────
  const cleanV = autoRewrite(clean(), [tt, r]);
  assert.equal(cleanV.status, "pass");
  assert.equal(cleanV.rewritePasses, 0);
  assert.equal(cleanV.hits.length, 0);

  // ── 9. autoRewrite: soft-only → rewritten ─────────────────────────────
  const soft = autoRewrite(
    clean({ caption: "easy money — link in bio", hashtags: ["#a", "#b", "#c", "#d", "#e", "#f", "#g"] }),
    [tt],
  );
  assert.equal(soft.status, "rewritten", `expected rewritten, got ${soft.status} hits=${JSON.stringify(soft.hits)}`);
  assert.ok(soft.rewritePasses >= 1);
  assert.ok(!/easy money/i.test(soft.rewritten.caption), "easy money must be scrubbed");
  assert.ok(!/link in bio/i.test(soft.rewritten.caption), "link in bio must be replaced");
  assert.equal(soft.rewritten.hashtags.length, 5, "hashtags must be capped at 5");

  // ── 10. autoRewrite: hard hit → blocked, original returned ────────────
  const hard = autoRewrite(clean({ hook: "this cures cancer" }), [tt]);
  assert.equal(hard.status, "blocked");
  assert.equal(hard.rewritePasses, 0);
  assert.equal(hard.rewritten.hook, "this cures cancer", "hard block must NOT mutate content");
  assert.ok(hard.hits.some((h) => h.severity === "hard"));

  // ── 11. autoRewrite: mixed soft + hard → blocked (no false-negative) ─
  // Sprint 3 phase-complete audit invariant: a hard hit ALWAYS short-
  // circuits, even when soft rewrites would superficially clean the rest.
  const mixed = autoRewrite(
    clean({ caption: "easy money — link in bio", hook: "this cures cancer" }),
    [tt],
  );
  assert.equal(mixed.status, "blocked");
  assert.ok(mixed.hits.some((h) => h.ruleId === "tiktok-medical-claim"));

  // ── 12. Multi-pack: TikTok + Kwai together ────────────────────────────
  const multi = autoRewrite(
    clean({ caption: "ganhe dinheiro fácil — link in bio" }),
    [tt, k],
  );
  // Both packs fire soft rules — final must rewrite both
  assert.equal(multi.status, "rewritten");
  assert.ok(!/link in bio/i.test(multi.rewritten.caption));
  assert.ok(!/ganhe dinheiro fácil/i.test(multi.rewritten.caption));

  console.log("compliance-shield rule packs + autoRewrite: PASS");
}

run();
