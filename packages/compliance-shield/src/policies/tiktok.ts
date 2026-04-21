import type { PolicyPack } from "../types";

/**
 * TikTok pack — soft flags map to TikTok community-guidelines categories
 * that are routinely auto-suppressed (clickbait, "link in bio" off-platform
 * pull, banned token list). Hard flags are the ones that get accounts
 * actually banned (medical claims, tobacco/alcohol promotion to minors).
 */
const BANNED_TOKENS = [
  "miracle cure",
  "guaranteed weight loss",
  "free crypto",
  "easy money",
  "buy followers",
  "follow for follow",
];

const HARD_MEDICAL_CLAIMS = [
  "cures cancer",
  "treats covid",
  "prevents diabetes",
  "lose 10kg in",
];

const HARD_AGE_RESTRICTED = ["#vape", "#nicotine", "#alcohol21"];

export const TIKTOK_PACK: PolicyPack = {
  platform: "tiktok",
  displayName: "TikTok",
  canonicalRegion: "global",
  rules: [
    {
      id: "tiktok-banned-token",
      severity: "soft",
      humanExplanation:
        "TikTok suppresses videos containing common spam/clickbait phrases. We rewrote them to neutral language.",
      match: (c) => {
        const blob = `${c.caption} ${c.hook}`.toLowerCase();
        return BANNED_TOKENS.some((t) => blob.includes(t));
      },
      rewrite: (c) => ({
        ...c,
        caption: scrub(c.caption, BANNED_TOKENS),
        hook: scrub(c.hook, BANNED_TOKENS),
      }),
    },
    {
      id: "tiktok-link-in-bio",
      severity: "soft",
      humanExplanation:
        "TikTok deprioritises 'link in bio' calls-to-action. We replaced them with native engagement prompts.",
      match: (c) => /link\s+in\s+bio/i.test(`${c.caption} ${c.hook}`),
      rewrite: (c) => ({
        ...c,
        caption: c.caption.replace(/link\s+in\s+bio/gi, "comment ‘guide’"),
        hook: c.hook.replace(/link\s+in\s+bio/gi, "comment ‘guide’"),
      }),
    },
    {
      id: "tiktok-hashtag-spam",
      severity: "soft",
      humanExplanation:
        "TikTok ranks down posts with more than 5 hashtags. We kept the 5 highest-signal tags.",
      match: (c) => c.hashtags.length > 5,
      rewrite: (c) => ({ ...c, hashtags: c.hashtags.slice(0, 5) }),
    },
    {
      id: "tiktok-medical-claim",
      severity: "hard",
      humanExplanation:
        "Unverified medical claims violate TikTok's misinformation policy and risk a hard ban. Rewrite the claim or remove this video.",
      match: (c) => {
        const blob = `${c.caption} ${c.hook}`.toLowerCase();
        return HARD_MEDICAL_CLAIMS.some((t) => blob.includes(t));
      },
    },
    {
      id: "tiktok-age-restricted-tag",
      severity: "hard",
      humanExplanation:
        "Age-restricted hashtags (vape/nicotine/alcohol) trigger automatic age-gating and frequently strike accounts under the SEA/LATAM creator program.",
      match: (c) => c.hashtags.some((h) => HARD_AGE_RESTRICTED.includes(h.toLowerCase())),
    },
  ],
};

function scrub(text: string, terms: readonly string[]): string {
  let out = text;
  for (const t of terms) {
    out = out.replace(new RegExp(escapeRegex(t), "gi"), "[redacted]");
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
