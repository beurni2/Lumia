/**
 * Sprint 3 Phase-Complete Audit — Red-Team Corpus.
 *
 * Each entry is a known-flagged sample drawn from the markets we ship to.
 * The Shield MUST catch every one with the expected severity on the named
 * pack. ANY false negative fails the suite — and per Sprint 3's exit gate,
 * a false negative blocks the sprint.
 *
 * The corpus mixes:
 *   - Hard blocks (medical claims, gambling brands, SARA hate speech,
 *     off-platform tipping, financial scams).
 *   - Soft rewrites (clickbait, link-in-bio, hashtag spam, competitor
 *     mentions, halal-default flags, copyrighted-music callouts).
 *   - Multi-pack collisions (same payload tripping rules on more than one
 *     platform — common in cross-publish flows).
 *   - Locale-specific edge cases (Bahasa Indonesia trigger tokens,
 *     Tagalog/Taglish discovery rules, Brazilian gambling slang).
 *
 * Adding a new entry is the audit-time mechanism for proving a pack rule
 * works against a real-world sample. Coverage today: 50 entries spanning
 * all 6 packs.
 */
import { strict as assert } from "node:assert";
import {
  ALL_PLATFORMS,
  POLICY_PACKS,
  autoRewrite,
  evaluate,
  type PlatformId,
  type PublishContent,
  type RuleHit,
} from "../index";

interface RedTeamSample {
  /** Short human-readable id used in failure messages. */
  readonly name: string;
  /** Pack(s) the sample is expected to trip. */
  readonly platform: PlatformId;
  readonly content: Partial<PublishContent>;
  /** At least one of these rule ids must fire on the named pack. */
  readonly expectedRuleIds: readonly string[];
  /** Required severity for at least one of the expected hits. */
  readonly expectedSeverity: "soft" | "hard";
}

function base(overrides: Partial<PublishContent> = {}): PublishContent {
  return {
    caption: "thanks for watching",
    hook: "look at this",
    hashtags: ["#fyp"],
    audioCue: "lo-fi café",
    thumbnailLabel: "Today",
    durationSec: 28,
    regions: ["br"],
    ...overrides,
  };
}

const CORPUS: readonly RedTeamSample[] = [
  // ── TikTok hard blocks ────────────────────────────────────────────────
  { name: "tiktok/hard/medical-cancer-cure",         platform: "tiktok", content: { hook: "this cures cancer in 7 days" },                expectedRuleIds: ["tiktok-medical-claim"],     expectedSeverity: "hard" },
  { name: "tiktok/hard/medical-covid",               platform: "tiktok", content: { caption: "this treats covid naturally" },             expectedRuleIds: ["tiktok-medical-claim"],     expectedSeverity: "hard" },
  { name: "tiktok/hard/medical-diabetes",            platform: "tiktok", content: { caption: "prevents diabetes overnight" },             expectedRuleIds: ["tiktok-medical-claim"],     expectedSeverity: "hard" },
  { name: "tiktok/hard/medical-weight-loss",         platform: "tiktok", content: { hook: "lose 10kg in 7 days guaranteed" },             expectedRuleIds: ["tiktok-medical-claim"],     expectedSeverity: "hard" },
  { name: "tiktok/hard/age-vape",                    platform: "tiktok", content: { hashtags: ["#vape", "#fyp"] },                        expectedRuleIds: ["tiktok-age-restricted-tag"],expectedSeverity: "hard" },
  { name: "tiktok/hard/age-nicotine",                platform: "tiktok", content: { hashtags: ["#nicotine"] },                            expectedRuleIds: ["tiktok-age-restricted-tag"],expectedSeverity: "hard" },
  { name: "tiktok/hard/age-alcohol21",               platform: "tiktok", content: { hashtags: ["#alcohol21"] },                           expectedRuleIds: ["tiktok-age-restricted-tag"],expectedSeverity: "hard" },

  // ── TikTok soft rewrites ──────────────────────────────────────────────
  { name: "tiktok/soft/banned-miracle-cure",         platform: "tiktok", content: { caption: "miracle cure for acne" },                   expectedRuleIds: ["tiktok-banned-token"],      expectedSeverity: "soft" },
  { name: "tiktok/soft/banned-easy-money",           platform: "tiktok", content: { hook: "easy money this week" },                       expectedRuleIds: ["tiktok-banned-token"],      expectedSeverity: "soft" },
  { name: "tiktok/soft/banned-buy-followers",        platform: "tiktok", content: { caption: "buy followers fast" },                      expectedRuleIds: ["tiktok-banned-token"],      expectedSeverity: "soft" },
  { name: "tiktok/soft/banned-follow-for-follow",    platform: "tiktok", content: { caption: "follow for follow gang" },                  expectedRuleIds: ["tiktok-banned-token"],      expectedSeverity: "soft" },
  { name: "tiktok/soft/banned-free-crypto",          platform: "tiktok", content: { hook: "free crypto airdrop" },                        expectedRuleIds: ["tiktok-banned-token"],      expectedSeverity: "soft" },
  { name: "tiktok/soft/banned-guaranteed-loss",      platform: "tiktok", content: { caption: "guaranteed weight loss program" },          expectedRuleIds: ["tiktok-banned-token"],      expectedSeverity: "soft" },
  { name: "tiktok/soft/link-in-bio",                 platform: "tiktok", content: { caption: "recipe — link in bio" },                    expectedRuleIds: ["tiktok-link-in-bio"],       expectedSeverity: "soft" },
  { name: "tiktok/soft/link-in-bio-mixed-case",      platform: "tiktok", content: { hook: "Link In Bio for the discount" },               expectedRuleIds: ["tiktok-link-in-bio"],       expectedSeverity: "soft" },
  { name: "tiktok/soft/hashtag-spam-6",              platform: "tiktok", content: { hashtags: ["#a","#b","#c","#d","#e","#f"] },          expectedRuleIds: ["tiktok-hashtag-spam"],      expectedSeverity: "soft" },
  { name: "tiktok/soft/hashtag-spam-12",             platform: "tiktok", content: { hashtags: Array.from({length:12},(_,i)=>`#t${i}`) }, expectedRuleIds: ["tiktok-hashtag-spam"],      expectedSeverity: "soft" },

  // ── Reels ─────────────────────────────────────────────────────────────
  { name: "reels/hard/financial-10x",                platform: "reels",  content: { caption: "guaranteed 10x returns this week" },        expectedRuleIds: ["reels-financial-promise"],  expectedSeverity: "hard" },
  { name: "reels/hard/financial-100pct",             platform: "reels",  content: { hook: "100% gains in 24h" },                          expectedRuleIds: ["reels-financial-promise"],  expectedSeverity: "hard" },
  { name: "reels/hard/financial-guaranteed-profit",  platform: "reels",  content: { caption: "guaranteed profit no risk" },               expectedRuleIds: ["reels-financial-promise"],  expectedSeverity: "hard" },
  { name: "reels/soft/caption-too-long",             platform: "reels",  content: { caption: "x".repeat(160) },                           expectedRuleIds: ["reels-caption-length"],     expectedSeverity: "soft" },
  { name: "reels/soft/competitor-tiktok",            platform: "reels",  content: { caption: "follow me on tiktok too" },                 expectedRuleIds: ["reels-competitor-mention"], expectedSeverity: "soft" },
  { name: "reels/soft/competitor-shorts",            platform: "reels",  content: { hook: "more on youtube shorts" },                     expectedRuleIds: ["reels-competitor-mention"], expectedSeverity: "soft" },
  { name: "reels/soft/competitor-kwai",              platform: "reels",  content: { caption: "originally from kwai" },                    expectedRuleIds: ["reels-competitor-mention"], expectedSeverity: "soft" },
  { name: "reels/soft/tiktok-watermark-call",        platform: "reels",  content: { caption: "ignore the tiktok watermark" },             expectedRuleIds: ["reels-watermark-detected"], expectedSeverity: "soft" },
  { name: "reels/soft/at-tiktok-mention",            platform: "reels",  content: { caption: "see @tiktok bio" },                         expectedRuleIds: ["reels-watermark-detected"], expectedSeverity: "soft" },

  // ── Shorts ────────────────────────────────────────────────────────────
  { name: "shorts/hard/duration-90s",                platform: "shorts", content: { durationSec: 90 },                                    expectedRuleIds: ["shorts-duration-cap"],      expectedSeverity: "hard" },
  { name: "shorts/hard/duration-61s",                platform: "shorts", content: { durationSec: 61 },                                    expectedRuleIds: ["shorts-duration-cap"],      expectedSeverity: "hard" },
  { name: "shorts/soft/copyright-official-audio",    platform: "shorts", content: { caption: "official audio: Bad Bunny" },               expectedRuleIds: ["shorts-copyrighted-music-callout"], expectedSeverity: "soft" },
  { name: "shorts/soft/copyright-spotify-rip",       platform: "shorts", content: { caption: "spotify rip — full track" },                expectedRuleIds: ["shorts-copyrighted-music-callout"], expectedSeverity: "soft" },
  { name: "shorts/soft/copyright-from-album",        platform: "shorts", content: { caption: "track from the album Versions" },           expectedRuleIds: ["shorts-copyrighted-music-callout"], expectedSeverity: "soft" },
  { name: "shorts/soft/profanity-fuck",              platform: "shorts", content: { hook: "what the fuck" },                              expectedRuleIds: ["shorts-non-adsense-friendly"], expectedSeverity: "soft" },
  { name: "shorts/soft/profanity-shit",              platform: "shorts", content: { caption: "shit happens" },                            expectedRuleIds: ["shorts-non-adsense-friendly"], expectedSeverity: "soft" },

  // ── Kwai (Brazil) ─────────────────────────────────────────────────────
  { name: "kwai/hard/tigrinho",                      platform: "kwai",   content: { caption: "joguei tigrinho hoje" },                    expectedRuleIds: ["kwai-hard-gambling-phrase"],expectedSeverity: "hard" },
  { name: "kwai/hard/fortune-tiger",                 platform: "kwai",   content: { hook: "fortune tiger pagou alto" },                   expectedRuleIds: ["kwai-hard-gambling-phrase"],expectedSeverity: "hard" },
  { name: "kwai/hard/aposta-certa",                  platform: "kwai",   content: { caption: "aposta certa do dia" },                     expectedRuleIds: ["kwai-hard-gambling-phrase"],expectedSeverity: "hard" },
  { name: "kwai/hard/bet365",                        platform: "kwai",   content: { audioCue: "bet365 promo audio" },                     expectedRuleIds: ["kwai-hard-gambling-phrase"],expectedSeverity: "hard" },
  { name: "kwai/soft/ganhe-dinheiro-facil",          platform: "kwai",   content: { caption: "ganhe dinheiro fácil online" },             expectedRuleIds: ["kwai-soft-gambling-phrase"],expectedSeverity: "soft" },
  { name: "kwai/soft/faturar-mil-reais",             platform: "kwai",   content: { hook: "como faturar mil reais por semana" },          expectedRuleIds: ["kwai-soft-gambling-phrase"],expectedSeverity: "soft" },
  { name: "kwai/soft/thumbnail-shouting",            platform: "kwai",   content: { thumbnailLabel: "GANHE AGORA" },                      expectedRuleIds: ["kwai-thumbnail-shouting"],  expectedSeverity: "soft" },

  // ── GoPlay (Indonesia) ────────────────────────────────────────────────
  { name: "goplay/hard/sara-kafir",                  platform: "goplay", content: { regions: ["id"], caption: "kafir semua" },            expectedRuleIds: ["goplay-sara-content"],      expectedSeverity: "hard" },
  { name: "goplay/hard/sara-cina-komunis",           platform: "goplay", content: { regions: ["id"], hook: "cina komunis" },              expectedRuleIds: ["goplay-sara-content"],      expectedSeverity: "hard" },
  { name: "goplay/hard/sara-anti-islam",             platform: "goplay", content: { regions: ["id"], caption: "anti-islam content" },     expectedRuleIds: ["goplay-sara-content"],      expectedSeverity: "hard" },
  { name: "goplay/soft/halal-babi",                  platform: "goplay", content: { regions: ["id"], caption: "saya makan babi tadi" },   expectedRuleIds: ["goplay-halal-soft-flag"],   expectedSeverity: "soft" },
  { name: "goplay/soft/halal-bir",                   platform: "goplay", content: { regions: ["id"], caption: "minum bir dingin" },       expectedRuleIds: ["goplay-halal-soft-flag"],   expectedSeverity: "soft" },
  { name: "goplay/soft/halal-pork",                  platform: "goplay", content: { regions: ["id"], caption: "pork ribs recipe" },       expectedRuleIds: ["goplay-halal-soft-flag"],   expectedSeverity: "soft" },
  { name: "goplay/soft/bahasa-required",             platform: "goplay", content: { regions: ["id"], caption: "this is a recipe video" }, expectedRuleIds: ["goplay-bahasa-required"],   expectedSeverity: "soft" },

  // ── Kumu (Philippines) ────────────────────────────────────────────────
  { name: "kumu/hard/paypal-tip",                    platform: "kumu",   content: { regions: ["ph"], caption: "tip me at paypal.me/foo" },expectedRuleIds: ["kumu-off-platform-tipping"],expectedSeverity: "hard" },
  { name: "kumu/hard/gcash-tip",                     platform: "kumu",   content: { regions: ["ph"], caption: "send to gcash.com/bar" },  expectedRuleIds: ["kumu-off-platform-tipping"],expectedSeverity: "hard" },
  { name: "kumu/hard/venmo-tip",                     platform: "kumu",   content: { regions: ["ph"], hook: "venmo.com/baz pls" },         expectedRuleIds: ["kumu-off-platform-tipping"],expectedSeverity: "hard" },
  { name: "kumu/soft/pure-english-ph",               platform: "kumu",   content: { regions: ["ph"], caption: "this is my morning routine" },expectedRuleIds:["kumu-pure-english-tagalog-region"],expectedSeverity: "soft" },
  { name: "kumu/soft/shouting-thumbnail-bangs",      platform: "kumu",   content: { regions: ["ph"], thumbnailLabel: "WATCH NOW!!!" },    expectedRuleIds: ["kumu-shouting-thumbnail"],  expectedSeverity: "soft" },
];

function run() {
  // Sanity: corpus is at the size the audit calls for (≥ 50).
  assert.ok(CORPUS.length >= 50, `red-team corpus must have ≥ 50 entries (have ${CORPUS.length})`);

  // Sanity: corpus covers every pack (no shipping a pack with zero coverage).
  const covered = new Set(CORPUS.map((c) => c.platform));
  for (const p of ALL_PLATFORMS) {
    assert.ok(covered.has(p), `red-team corpus missing coverage for pack: ${p}`);
  }

  // Each sample MUST trip its expected rule on its expected pack.
  // ANY false negative fails the suite (Sprint 3 exit-gate invariant).
  const falseNegatives: string[] = [];
  for (const sample of CORPUS) {
    const pack = POLICY_PACKS[sample.platform];
    const content = base(sample.content);
    const hits = evaluate(content, [pack]);
    const matchedExpected = hits.filter(
      (h) => sample.expectedRuleIds.includes(h.ruleId) && h.severity === sample.expectedSeverity,
    );
    if (matchedExpected.length === 0) {
      falseNegatives.push(
        `${sample.name}: expected ${sample.expectedSeverity} hit on ${sample.expectedRuleIds.join("|")}, got [${hits.map((h: RuleHit) => `${h.ruleId}:${h.severity}`).join(", ") || "no hits"}]`,
      );
    }
  }
  assert.equal(
    falseNegatives.length,
    0,
    `Sprint 3 audit failure — ${falseNegatives.length} false negative(s):\n  ${falseNegatives.join("\n  ")}`,
  );

  // Hard-block invariant against the whole corpus: every "hard" sample MUST
  // result in autoRewrite returning status="blocked" with content untouched.
  const hardSamples = CORPUS.filter((s) => s.expectedSeverity === "hard");
  for (const sample of hardSamples) {
    const pack = POLICY_PACKS[sample.platform];
    const content = base(sample.content);
    const verdict = autoRewrite(content, [pack]);
    assert.equal(
      verdict.status,
      "blocked",
      `${sample.name}: hard sample must autoRewrite → blocked, got ${verdict.status}`,
    );
    // The original content MUST be returned untouched on hard short-circuit.
    if (verdict.rewritePasses === 0) {
      assert.deepEqual(
        verdict.rewritten,
        content,
        `${sample.name}: hard short-circuit must return original content untouched`,
      );
    }
  }

  console.log(`compliance-shield red-team corpus (${CORPUS.length} samples, 0 false negatives): PASS`);
}

run();
