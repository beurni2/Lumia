import type { PolicyPack } from "../types";

/**
 * Instagram Reels pack — Meta penalises reposted-from-TikTok watermarks,
 * caption length over 125 chars (truncated in feed), and any explicit
 * mention of competing platforms.
 */
const COMPETITOR_MENTIONS = ["tiktok", "youtube shorts", "kwai"];

export const REELS_PACK: PolicyPack = {
  platform: "reels",
  displayName: "Instagram Reels",
  canonicalRegion: "global",
  rules: [
    {
      id: "reels-caption-length",
      severity: "soft",
      humanExplanation:
        "Reels truncates captions over 125 characters in the feed. We trimmed yours so the hook stays visible.",
      match: (c) => c.caption.length > 125,
      rewrite: (c) => ({ ...c, caption: c.caption.slice(0, 122).trimEnd() + "…" }),
    },
    {
      id: "reels-competitor-mention",
      severity: "soft",
      humanExplanation:
        "Meta down-ranks Reels that name competing platforms. We removed those mentions.",
      match: (c) => {
        const blob = `${c.caption} ${c.hook}`.toLowerCase();
        return COMPETITOR_MENTIONS.some((t) => blob.includes(t));
      },
      rewrite: (c) => ({
        ...c,
        caption: stripWords(c.caption, COMPETITOR_MENTIONS),
        hook: stripWords(c.hook, COMPETITOR_MENTIONS),
      }),
    },
    {
      id: "reels-watermark-detected",
      severity: "soft",
      humanExplanation:
        "A literal '@tiktok' or 'TikTok watermark' reference signals re-uploaded content; Reels suppresses these. We removed the reference.",
      match: (c) => /tiktok\s+watermark|@tiktok/i.test(c.caption),
      rewrite: (c) => ({
        ...c,
        caption: c.caption.replace(/tiktok\s+watermark|@tiktok/gi, "").replace(/\s{2,}/g, " ").trim(),
      }),
    },
    {
      id: "reels-financial-promise",
      severity: "hard",
      humanExplanation:
        "Promising guaranteed financial returns (e.g. '10x in a week') triggers Meta's Community Standards on financial scams. Hard block.",
      match: (c) => /(guaranteed|10x|100%)\s+(returns|profit|gains|earnings)/i.test(`${c.caption} ${c.hook}`),
    },
  ],
};

function stripWords(text: string, words: readonly string[]): string {
  let out = text;
  for (const w of words) {
    out = out.replace(new RegExp(`\\b${escapeRegex(w)}\\b`, "gi"), "");
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
