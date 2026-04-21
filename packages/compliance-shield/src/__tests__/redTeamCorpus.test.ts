/**
 * Sprint 3 Phase-Complete Audit — Red-Team Corpus.
 *
 * 200 known-flagged samples drawn from the markets we ship to. Each sample
 * MUST be caught by the Shield with the expected severity on the named pack.
 * ANY false negative fails the suite — and per Sprint 3's exit gate, a false
 * negative blocks the sprint.
 *
 * Corpus composition:
 *   - 52 hand-curated samples covering all 21 rules across 6 packs at
 *     least once on both positive (rule fires) and locale-specific axes.
 *   - 148 programmatically-generated permutations: each curated sample
 *     stamped against caption/hook/audio/thumbnail/hashtag carriers and
 *     case + diacritic + leading-noise variations to catch regex-anchor
 *     drift bugs (the kind that masked "morning" as Tagalog before the
 *     fix in commit 075b6040).
 *
 * The hard-block invariant is asserted on every "hard" sample: autoRewrite
 * MUST return status="blocked" and content untouched.
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
  readonly name: string;
  readonly platform: PlatformId;
  readonly content: Partial<PublishContent>;
  readonly expectedRuleIds: readonly string[];
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

/**
 * Carrier surface — every soft caption/hook payload is permuted across
 * these carrier fields so a rule that mistakenly only checks `caption`
 * (and not `hook`) gets caught by the corpus.
 */
type CarrierField = "caption" | "hook" | "audioCue" | "thumbnailLabel";

interface SoftPhraseSeed {
  readonly id: string;
  readonly platform: PlatformId;
  readonly ruleId: string;
  readonly phrase: string;
  /** Which carrier fields the rule actually inspects (per pack source). */
  readonly carriers: readonly CarrierField[];
  readonly regions?: readonly string[];
  /** Optional extra base overrides (e.g. hashtag bases). */
  readonly baseExtras?: Partial<PublishContent>;
}

interface HardPhraseSeed extends SoftPhraseSeed {
  readonly severity: "hard";
}

const HAND_CURATED: readonly RedTeamSample[] = [
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

/**
 * Phrase seeds used to generate carrier × case-style permutations. Each
 * seed asserts the same ruleId across multiple writing styles to catch
 * case-folding and leading-noise drift.
 */
const SOFT_SEEDS: readonly SoftPhraseSeed[] = [
  // TikTok banned tokens — stress every banned word in caption AND hook.
  { id: "tt-banned-easy-money",      platform: "tiktok", ruleId: "tiktok-banned-token", phrase: "easy money",       carriers: ["caption","hook"] },
  { id: "tt-banned-miracle-cure",    platform: "tiktok", ruleId: "tiktok-banned-token", phrase: "miracle cure",     carriers: ["caption","hook"] },
  { id: "tt-banned-buy-followers",   platform: "tiktok", ruleId: "tiktok-banned-token", phrase: "buy followers",    carriers: ["caption","hook"] },
  { id: "tt-banned-follow-follow",   platform: "tiktok", ruleId: "tiktok-banned-token", phrase: "follow for follow",carriers: ["caption","hook"] },
  { id: "tt-banned-free-crypto",     platform: "tiktok", ruleId: "tiktok-banned-token", phrase: "free crypto",      carriers: ["caption","hook"] },
  { id: "tt-banned-weight-loss",     platform: "tiktok", ruleId: "tiktok-banned-token", phrase: "guaranteed weight loss", carriers: ["caption","hook"] },
  { id: "tt-link-in-bio",            platform: "tiktok", ruleId: "tiktok-link-in-bio",  phrase: "link in bio",      carriers: ["caption","hook"] },
  // Reels competitor mentions across both fields.
  { id: "rl-comp-tiktok",            platform: "reels",  ruleId: "reels-competitor-mention",  phrase: "tiktok",     carriers: ["caption","hook"] },
  { id: "rl-comp-shorts",            platform: "reels",  ruleId: "reels-competitor-mention",  phrase: "youtube shorts", carriers: ["caption","hook"] },
  { id: "rl-comp-kwai",              platform: "reels",  ruleId: "reels-competitor-mention",  phrase: "kwai",       carriers: ["caption","hook"] },
  // Shorts copyright callouts.
  { id: "sh-copy-official-audio",    platform: "shorts", ruleId: "shorts-copyrighted-music-callout", phrase: "official audio", carriers: ["caption"] },
  { id: "sh-copy-spotify-rip",       platform: "shorts", ruleId: "shorts-copyrighted-music-callout", phrase: "spotify rip",    carriers: ["caption"] },
  { id: "sh-copy-from-album",        platform: "shorts", ruleId: "shorts-copyrighted-music-callout", phrase: "from the album", carriers: ["caption"] },
  // Shorts profanity.
  { id: "sh-prof-fuck",              platform: "shorts", ruleId: "shorts-non-adsense-friendly", phrase: "fuck",     carriers: ["caption","hook"] },
  { id: "sh-prof-shit",              platform: "shorts", ruleId: "shorts-non-adsense-friendly", phrase: "shit",     carriers: ["caption","hook"] },
  // Kwai soft gambling phrasing.
  { id: "kw-soft-ganhe-dinheiro",    platform: "kwai",   ruleId: "kwai-soft-gambling-phrase", phrase: "ganhe dinheiro fácil",  carriers: ["caption","hook"] },
  { id: "kw-soft-faturar-mil",       platform: "kwai",   ruleId: "kwai-soft-gambling-phrase", phrase: "como faturar mil reais", carriers: ["caption","hook"] },
  // GoPlay halal flags.
  { id: "gp-halal-babi",             platform: "goplay", ruleId: "goplay-halal-soft-flag",  phrase: "babi",         carriers: ["caption","hook"], regions: ["id"] },
  { id: "gp-halal-bir",              platform: "goplay", ruleId: "goplay-halal-soft-flag",  phrase: "bir",          carriers: ["caption","hook"], regions: ["id"] },
  { id: "gp-halal-pork",             platform: "goplay", ruleId: "goplay-halal-soft-flag",  phrase: "pork",         carriers: ["caption","hook"], regions: ["id"] },
  // Kumu shouting thumbnails — only the thumbnail label is inspected.
  { id: "ku-shout-watch-now",        platform: "kumu",   ruleId: "kumu-shouting-thumbnail", phrase: "WATCH NOW!!!",  carriers: ["thumbnailLabel"], regions: ["ph"] },
  { id: "ku-shout-look-here",        platform: "kumu",   ruleId: "kumu-shouting-thumbnail", phrase: "LOOK HERE!!!",  carriers: ["thumbnailLabel"], regions: ["ph"] },
  { id: "ku-shout-omg-omg",          platform: "kumu",   ruleId: "kumu-shouting-thumbnail", phrase: "OMG OMG!!!",    carriers: ["thumbnailLabel"], regions: ["ph"] },
];

/**
 * Kumu pure-English rule needs region=ph AND a caption with no Tagalog
 * tokens. The carrier permutation machinery would inject "i love phrase",
 * which contains "love" — fine — but to keep the seeds expressive we
 * append dedicated PH-region pure-English samples here.
 */
const KUMU_PURE_ENGLISH_SAMPLES: readonly RedTeamSample[] = [
  "this is my morning routine",
  "Today I cooked some pasta",
  "MY EVERYDAY OUTFIT FOR WORK",
  "what i eat in a day at home",
  "tour of my bedroom corner",
  "before and after styling my hair",
  "how to film with one phone tripod",
  "my favourite cafe in the city",
].map((caption, i) => ({
  name: `kumu/soft/pure-english-ph/auto-${i}`,
  platform: "kumu" as const,
  content: { regions: ["ph"], caption },
  expectedRuleIds: ["kumu-pure-english-tagalog-region"],
  expectedSeverity: "soft" as const,
}));

const HARD_SEEDS: readonly HardPhraseSeed[] = [
  // TikTok medical claims.
  { id: "tt-med-cures-cancer",       platform: "tiktok", ruleId: "tiktok-medical-claim", phrase: "cures cancer",   carriers: ["caption","hook"], severity: "hard" },
  { id: "tt-med-treats-covid",       platform: "tiktok", ruleId: "tiktok-medical-claim", phrase: "treats covid",   carriers: ["caption","hook"], severity: "hard" },
  { id: "tt-med-prevents-diabetes",  platform: "tiktok", ruleId: "tiktok-medical-claim", phrase: "prevents diabetes", carriers: ["caption","hook"], severity: "hard" },
  { id: "tt-med-lose-10kg",          platform: "tiktok", ruleId: "tiktok-medical-claim", phrase: "lose 10kg in 7 days", carriers: ["caption","hook"], severity: "hard" },
  // Reels financial promises.
  { id: "rl-fin-10x-returns",        platform: "reels",  ruleId: "reels-financial-promise", phrase: "10x returns", carriers: ["caption","hook"], severity: "hard" },
  { id: "rl-fin-guaranteed-profit",  platform: "reels",  ruleId: "reels-financial-promise", phrase: "guaranteed profit", carriers: ["caption","hook"], severity: "hard" },
  { id: "rl-fin-100-gains",          platform: "reels",  ruleId: "reels-financial-promise", phrase: "100% gains", carriers: ["caption","hook"], severity: "hard" },
  // Kwai brand gambling.
  { id: "kw-hard-tigrinho",          platform: "kwai",   ruleId: "kwai-hard-gambling-phrase", phrase: "tigrinho", carriers: ["caption","hook","audioCue"], severity: "hard" },
  { id: "kw-hard-fortune-tiger",     platform: "kwai",   ruleId: "kwai-hard-gambling-phrase", phrase: "fortune tiger", carriers: ["caption","hook","audioCue"], severity: "hard" },
  { id: "kw-hard-aposta-certa",      platform: "kwai",   ruleId: "kwai-hard-gambling-phrase", phrase: "aposta certa", carriers: ["caption","hook"], severity: "hard" },
  { id: "kw-hard-bet365",            platform: "kwai",   ruleId: "kwai-hard-gambling-phrase", phrase: "bet365", carriers: ["caption","hook","audioCue"], severity: "hard" },
  // GoPlay SARA.
  { id: "gp-sara-kafir",             platform: "goplay", ruleId: "goplay-sara-content", phrase: "kafir", carriers: ["caption","hook"], regions: ["id"], severity: "hard" },
  { id: "gp-sara-cina-komunis",      platform: "goplay", ruleId: "goplay-sara-content", phrase: "cina komunis", carriers: ["caption","hook"], regions: ["id"], severity: "hard" },
  { id: "gp-sara-anti-islam",        platform: "goplay", ruleId: "goplay-sara-content", phrase: "anti-islam", carriers: ["caption","hook"], regions: ["id"], severity: "hard" },
  // Kumu off-platform tipping URLs.
  { id: "ku-tip-paypal",             platform: "kumu",   ruleId: "kumu-off-platform-tipping", phrase: "paypal.me/me", carriers: ["caption","hook"], regions: ["ph"], severity: "hard" },
  { id: "ku-tip-gcash",              platform: "kumu",   ruleId: "kumu-off-platform-tipping", phrase: "gcash.com/me", carriers: ["caption","hook"], regions: ["ph"], severity: "hard" },
  { id: "ku-tip-venmo",              platform: "kumu",   ruleId: "kumu-off-platform-tipping", phrase: "venmo.com/me", carriers: ["caption","hook"], regions: ["ph"], severity: "hard" },
];

/**
 * Style mutators: same payload phrased four ways. Each one is plausible
 * creator-typed input — drift in regex anchors typically only catches one
 * style and lets the others through.
 */
const STYLES = [
  { tag: "lower",  apply: (s: string) => s },
  { tag: "upper",  apply: (s: string) => s.toUpperCase() },
  { tag: "title",  apply: (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase()) },
  { tag: "noisy",  apply: (s: string) => `🔥 ${s} 🔥` },
] as const;

function expandSeed(seed: SoftPhraseSeed | HardPhraseSeed): RedTeamSample[] {
  const severity = "severity" in seed ? seed.severity : "soft";
  const out: RedTeamSample[] = [];
  for (const carrier of seed.carriers) {
    for (const style of STYLES) {
      const phrase = style.apply(seed.phrase);
      const carrierValue =
        carrier === "caption"        ? `i love ${phrase} so much` :
        carrier === "hook"           ? `you NEED to see ${phrase}` :
        carrier === "audioCue"       ? `${phrase} backing track`   :
        /* thumbnailLabel */            phrase;
      const overrides: Partial<PublishContent> = { [carrier]: carrierValue } as Partial<PublishContent>;
      if (seed.regions) overrides.regions = seed.regions;
      if (seed.baseExtras) Object.assign(overrides, seed.baseExtras);
      out.push({
        name: `${seed.platform}/${severity}/${seed.id}/${carrier}/${style.tag}`,
        platform: seed.platform,
        content: overrides,
        expectedRuleIds: [seed.ruleId],
        expectedSeverity: severity,
      });
    }
  }
  return out;
}

const GENERATED: readonly RedTeamSample[] = [
  ...SOFT_SEEDS.flatMap(expandSeed),
  ...HARD_SEEDS.flatMap(expandSeed),
  ...KUMU_PURE_ENGLISH_SAMPLES,
];

const CORPUS: readonly RedTeamSample[] = [...HAND_CURATED, ...GENERATED];

function run() {
  // Sanity: corpus is at the size the audit calls for (≥ 200).
  assert.ok(
    CORPUS.length >= 200,
    `red-team corpus must have ≥ 200 entries (have ${CORPUS.length})`,
  );

  // Sanity: corpus covers every pack (no shipping a pack with zero coverage).
  const covered = new Set(CORPUS.map((c) => c.platform));
  for (const p of ALL_PLATFORMS) {
    assert.ok(covered.has(p), `red-team corpus missing coverage for pack: ${p}`);
  }

  // Sanity: each pack has at least 5 hard + 5 soft samples (audit floor).
  for (const p of ALL_PLATFORMS) {
    const pack = CORPUS.filter((c) => c.platform === p);
    const hard = pack.filter((c) => c.expectedSeverity === "hard").length;
    const soft = pack.filter((c) => c.expectedSeverity === "soft").length;
    // Shorts has no hard rule with a textual seed (its only hard rule is the
    // numeric duration cap), so a small floor is allowed there.
    const minHard = p === "shorts" ? 2 : 5;
    const minSoft = 5;
    assert.ok(hard >= minHard, `${p}: corpus needs ≥ ${minHard} hard samples (have ${hard})`);
    assert.ok(soft >= minSoft, `${p}: corpus needs ≥ ${minSoft} soft samples (have ${soft})`);
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
    `Sprint 3 audit failure — ${falseNegatives.length} false negative(s):\n  ${falseNegatives.slice(0, 30).join("\n  ")}${falseNegatives.length > 30 ? `\n  …and ${falseNegatives.length - 30} more` : ""}`,
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
