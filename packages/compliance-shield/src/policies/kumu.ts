import type { PolicyPack } from "../types";

/**
 * Kumu (Philippines) pack — Manila-based live-stream-first platform with
 * its own community standards stricter than TikTok PH on:
 *   - external commerce links (must use Kumu Coins instead),
 *   - tagalog mixed-script captions (Kumu's NLP penalises pure-English
 *     captions for Tagalog-region creators), and
 *   - any hint of off-platform tipping (PayPal, GCash links).
 */
const OFF_PLATFORM_TIPPING = [
  "paypal.me/",
  "gcash.com/",
  "venmo.com/",
];

export const KUMU_PACK: PolicyPack = {
  platform: "kumu",
  displayName: "Kumu",
  canonicalRegion: "ph",
  rules: [
    {
      id: "kumu-off-platform-tipping",
      severity: "hard",
      humanExplanation:
        "Kumu blocks off-platform tipping URLs (PayPal, GCash, Venmo). Use Kumu Coins instead.",
      match: (c) => {
        const blob = `${c.caption} ${c.hook}`.toLowerCase();
        return OFF_PLATFORM_TIPPING.some((t) => blob.includes(t));
      },
    },
    {
      id: "kumu-pure-english-tagalog-region",
      severity: "soft",
      humanExplanation:
        "Kumu's PH discovery algorithm boosts Taglish (Tagalog + English) captions for PH creators. We added a short Tagalog lead-in.",
      match: (c) => {
        if (!c.regions.includes("ph")) return false;
        // crude Tagalog token check
        return !/(ang|ng|sa|na|po|naman|talaga|pre)\b/i.test(c.caption);
      },
      rewrite: (c) => ({ ...c, caption: `Grabe — ${c.caption}` }),
    },
    {
      id: "kumu-shouting-thumbnail",
      severity: "soft",
      humanExplanation:
        "Kumu suppresses thumbnails with all-caps + multiple exclamation marks. We re-cased yours.",
      match: (c) => /!{2,}/.test(c.thumbnailLabel) || (c.thumbnailLabel.length > 4 && c.thumbnailLabel === c.thumbnailLabel.toUpperCase()),
      rewrite: (c) => ({
        ...c,
        thumbnailLabel: c.thumbnailLabel.replace(/!{2,}/g, "!").replace(/(\b\w)(\w*)/g, (_, a: string, b: string) => a.toUpperCase() + b.toLowerCase()),
      }),
    },
  ],
};
