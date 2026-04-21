import type { PolicyPack } from "../types";

/**
 * GoPlay (Telkomsel/Indonesia) pack — local SEA app. KOMINFO content
 * regulations (2020 MR5) require platforms to filter content tagged as
 * SARA (Suku, Agama, Ras, Antar-golongan — ethnic/religious/racial/inter-
 * group hate). Pork & alcohol promotion is also auto-flagged in halal-
 * default regions.
 */
const SARA_TRIGGER_TOKENS = [
  "kafir",
  "cina komunis",
  "anti-islam",
];

const HALAL_SOFT_FLAGS = ["babi", "pork", "bir", "alcohol"];

export const GOPLAY_PACK: PolicyPack = {
  platform: "goplay",
  displayName: "GoPlay",
  canonicalRegion: "id",
  rules: [
    {
      id: "goplay-sara-content",
      severity: "hard",
      humanExplanation:
        "Indonesian KOMINFO MR5 categorises this language as SARA (ethnic/religious hate speech). The Shield will not let this publish.",
      match: (c) => {
        const blob = `${c.caption} ${c.hook}`.toLowerCase();
        return SARA_TRIGGER_TOKENS.some((t) => blob.includes(t));
      },
    },
    {
      id: "goplay-halal-soft-flag",
      severity: "soft",
      humanExplanation:
        "GoPlay's default audience is halal-observant. We softened references to pork/alcohol so the video isn't auto-down-ranked in default feeds.",
      match: (c) => {
        const blob = `${c.caption} ${c.hook}`.toLowerCase();
        return HALAL_SOFT_FLAGS.some((t) => new RegExp(`\\b${t}\\b`, "i").test(blob));
      },
      rewrite: (c) => ({
        ...c,
        caption: c.caption.replace(/\b(babi|pork)\b/gi, "[meat]").replace(/\b(bir|alcohol)\b/gi, "[drink]"),
        hook: c.hook.replace(/\b(babi|pork)\b/gi, "[meat]").replace(/\b(bir|alcohol)\b/gi, "[drink]"),
      }),
    },
    {
      id: "goplay-bahasa-required",
      severity: "soft",
      humanExplanation:
        "GoPlay's discovery algorithm prioritises Bahasa Indonesia captions for ID region. We added a short Bahasa lead-in.",
      match: (c) => c.regions.includes("id") && !/[\u00C0-\u017F]?(yang|untuk|dari|kamu|aku|gue)\b/i.test(c.caption),
      rewrite: (c) => ({ ...c, caption: `Cek ini — ${c.caption}` }),
    },
  ],
};
