import type { PolicyPack } from "../types";

/**
 * YouTube Shorts pack — Shorts are stricter than long-form on duration cap
 * (60s max enforced server-side), AdSense-friendly language, and copyrighted-
 * music callouts.
 */
const COPYRIGHT_FLAGS = [
  "official audio",
  "spotify rip",
  "from the album",
];

export const SHORTS_PACK: PolicyPack = {
  platform: "shorts",
  displayName: "YouTube Shorts",
  canonicalRegion: "global",
  rules: [
    {
      id: "shorts-duration-cap",
      severity: "hard",
      humanExplanation:
        "Shorts are capped at 60 seconds. Trim the video before publishing here, or post to long-form instead.",
      match: (c) => c.durationSec > 60,
    },
    {
      id: "shorts-copyrighted-music-callout",
      severity: "soft",
      humanExplanation:
        "Calling out copyrighted music in the caption can trigger a Content ID claim that demonetises the Short. We removed the reference.",
      match: (c) => {
        const blob = c.caption.toLowerCase();
        return COPYRIGHT_FLAGS.some((t) => blob.includes(t));
      },
      rewrite: (c) => ({
        ...c,
        caption: stripPhrases(c.caption, COPYRIGHT_FLAGS),
      }),
    },
    {
      id: "shorts-non-adsense-friendly",
      severity: "soft",
      humanExplanation:
        "Profanity and slurs make Shorts non-AdSense-eligible. We softened the language so the video stays monetisable.",
      match: (c) => /\b(fuck|shit|damn it)\b/i.test(`${c.caption} ${c.hook}`),
      rewrite: (c) => ({
        ...c,
        caption: c.caption.replace(/\bfuck\b/gi, "freaking").replace(/\bshit\b/gi, "stuff").replace(/\bdamn it\b/gi, "darn"),
        hook: c.hook.replace(/\bfuck\b/gi, "freaking").replace(/\bshit\b/gi, "stuff").replace(/\bdamn it\b/gi, "darn"),
      }),
    },
  ],
};

function stripPhrases(text: string, phrases: readonly string[]): string {
  let out = text;
  for (const p of phrases) {
    out = out.replace(new RegExp(escapeRegex(p), "gi"), "");
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
