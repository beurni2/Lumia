import type { PolicyPack } from "../types";

/**
 * Kwai pack — Kwai's BR + LATAM moderation is stricter than TikTok on
 * gambling-adjacent ("aposta", "bet", "tigrinho") content thanks to
 * the 2024 Brazilian regulator (ANATEL/SECAP) crackdown. Soft-rewrite the
 * common spillover phrases; hard-block the unambiguous ones.
 */
const SOFT_GAMBLING_PHRASES = [
  "ganhe dinheiro fácil",
  "como faturar mil reais",
];

const HARD_GAMBLING_PHRASES = [
  "tigrinho",
  "fortune tiger",
  "aposta certa",
  "bet365",
];

export const KWAI_PACK: PolicyPack = {
  platform: "kwai",
  displayName: "Kwai",
  canonicalRegion: "br",
  rules: [
    {
      id: "kwai-soft-gambling-phrase",
      severity: "soft",
      humanExplanation:
        "Kwai suppresses videos with common get-rich phrases under the 2024 Brazilian gambling-ad rules. We rewrote them to neutral wording.",
      match: (c) => {
        const blob = `${c.caption} ${c.hook}`.toLowerCase();
        return SOFT_GAMBLING_PHRASES.some((t) => blob.includes(t));
      },
      rewrite: (c) => ({
        ...c,
        caption: stripPhrases(c.caption, SOFT_GAMBLING_PHRASES),
        hook: stripPhrases(c.hook, SOFT_GAMBLING_PHRASES),
      }),
    },
    {
      id: "kwai-hard-gambling-phrase",
      severity: "hard",
      humanExplanation:
        "Direct mentions of regulated gambling brands are a strike under SECAP/ANATEL. The Shield will not let this publish to Kwai BR.",
      match: (c) => {
        const blob = `${c.caption} ${c.hook} ${c.audioCue}`.toLowerCase();
        return HARD_GAMBLING_PHRASES.some((t) => blob.includes(t));
      },
    },
    {
      id: "kwai-thumbnail-shouting",
      severity: "soft",
      humanExplanation:
        "All-caps thumbnail labels look spammy on Kwai's feed. We re-cased yours.",
      match: (c) => c.thumbnailLabel.length > 4 && c.thumbnailLabel === c.thumbnailLabel.toUpperCase(),
      rewrite: (c) => ({ ...c, thumbnailLabel: toTitleCase(c.thumbnailLabel) }),
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

function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
