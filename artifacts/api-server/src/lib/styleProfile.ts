/**
 * Lightweight Style Profile — the JSON shape we extract from a
 * creator's past videos and feed back to the Ideator.
 *
 * v1 is rule-based (regex + keyword frequency + simple scene-change
 * detection). No vector DB, no on-device model. The profile is a
 * single JSON document persisted on `creators.style_profile_json`
 * and small enough to round-trip on every request without a join.
 *
 * Every field is optional with a sensible default, so the ideator
 * endpoint can be exercised before the mobile client has a real
 * profile to upload (essential for independent curl validation
 * during the v1 build).
 */

import { z } from "zod";

export const HOOK_TYPES = ["question", "boldStatement", "sceneSetter"] as const;
export const CONTENT_TYPES = [
  "entertainment",
  "educational",
  "lifestyle",
  "storytelling",
] as const;
export const CAPTION_TONES = ["short", "descriptive"] as const;
export const PUNCTUATION_PATTERNS = [
  "minimal",
  "exclamation-heavy",
  "question-heavy",
  "mixed",
] as const;

export const styleProfileSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  hookStyle: z
    .object({
      primary: z.enum(HOOK_TYPES).default("question"),
      distribution: z
        .object({
          question: z.number().min(0).max(1).default(0.34),
          boldStatement: z.number().min(0).max(1).default(0.33),
          sceneSetter: z.number().min(0).max(1).default(0.33),
        })
        .default({ question: 0.34, boldStatement: 0.33, sceneSetter: 0.33 }),
      sampleHooks: z.array(z.string()).max(10).default([]),
    })
    .default({
      primary: "question",
      distribution: { question: 0.34, boldStatement: 0.33, sceneSetter: 0.33 },
      sampleHooks: [],
    }),
  captionStyle: z
    .object({
      avgEmojiCount: z.number().min(0).max(20).default(2),
      emojiRange: z.tuple([z.number(), z.number()]).default([1, 4]),
      avgSentenceLengthWords: z.number().min(1).max(60).default(10),
      sentenceLengthRange: z.tuple([z.number(), z.number()]).default([5, 18]),
      tone: z.enum(CAPTION_TONES).default("short"),
      punctuationPattern: z.enum(PUNCTUATION_PATTERNS).default("mixed"),
    })
    .default({
      avgEmojiCount: 2,
      emojiRange: [1, 4],
      avgSentenceLengthWords: 10,
      sentenceLengthRange: [5, 18],
      tone: "short",
      punctuationPattern: "mixed",
    }),
  pacing: z
    .object({
      avgCutsPerSecond: z.number().min(0).max(5).default(0.5),
      avgVideoDurationSeconds: z.number().min(1).max(300).default(20),
    })
    .default({ avgCutsPerSecond: 0.5, avgVideoDurationSeconds: 20 }),
  topics: z
    .object({
      keywords: z.array(z.string()).max(40).default([]),
      recurringPhrases: z.array(z.string()).max(20).default([]),
      contentType: z.enum(CONTENT_TYPES).default("lifestyle"),
    })
    .default({ keywords: [], recurringPhrases: [], contentType: "lifestyle" }),
  language: z
    .object({
      primary: z
        .enum(["en-US", "en-IN", "en-PH", "en-NG"])
        .default("en-US"),
      slangMarkers: z.array(z.string()).max(20).default([]),
    })
    .default({ primary: "en-US", slangMarkers: [] }),
  derivedAt: z.string().default(() => new Date().toISOString()),
});

export type StyleProfile = z.infer<typeof styleProfileSchema>;

/**
 * The default profile is what the ideator falls back to when a creator
 * has not yet uploaded any videos. Keeps the endpoint usable from the
 * very first request — necessary for the onboarding "instant first
 * idea after the first upload" flow + for curl-based quality testing.
 */
export const DEFAULT_STYLE_PROFILE: StyleProfile = styleProfileSchema.parse({});

/**
 * Derived tone bucket — `dry | chaotic | self-aware | confident`.
 *
 * The Style Profile we persist describes the creator's writing in
 * concrete signals (emoji density, punctuation pattern, hook primary,
 * sentence length). The IDEATOR prompt wants a HIGHER-LEVEL TONE
 * label so it can colour PHRASING (hook wording + caption tone)
 * without touching idea structure.
 *
 * This helper is the bridge — it derives a single tone label from
 * the existing fields with NO schema change. Pure function: same
 * profile → same tone, deterministic, cheap, easy to reason about.
 *
 * Heuristic priority order (first match wins):
 *   1. CHAOTIC    — emoji-heavy OR exclamation-heavy. Loud energy.
 *   2. SELF-AWARE — question-heavy punctuation OR question hookStyle.
 *                   Introspective / ironic vibe.
 *   3. CONFIDENT  — boldStatement hookStyle + sparing emoji (≤1).
 *                   Declarative, no hedging.
 *   4. DRY        — fallback. Understated, deadpan, minimal everything.
 *
 * The DEFAULT_STYLE_PROFILE (used before the creator has uploaded any
 * videos) lands in DRY by default — the safest tone for an unknown
 * voice (no risk of putting words in their mouth).
 */
export type DerivedTone = "dry" | "chaotic" | "self-aware" | "confident";

export function deriveTone(profile: StyleProfile): DerivedTone {
  const cap = profile.captionStyle;
  const hookPrimary = profile.hookStyle.primary;

  if (cap.avgEmojiCount >= 3 || cap.punctuationPattern === "exclamation-heavy") {
    return "chaotic";
  }
  if (cap.punctuationPattern === "question-heavy" || hookPrimary === "question") {
    return "self-aware";
  }
  if (hookPrimary === "boldStatement" && cap.avgEmojiCount <= 1) {
    return "confident";
  }
  return "dry";
}

/**
 * Derived Style Hints — Phase 1 lightweight style hint extractor.
 *
 * The spec ("BUILD — Lightweight Style Hint Extractor") asks for a
 * small, debuggable hint object that the ideator can read to colour
 * hook PHRASING + caption TONE without touching idea structure.
 *
 *   • Pure function — same profile in → same hints out, deterministic.
 *   • Uses existing StyleProfile signals only (no embeddings, no ML,
 *     no transcription, no schema change).
 *   • Confidence-aware — when the source profile is mostly defaults,
 *     confidence drops below 0.3 and the ideator is instructed to
 *     fall back to viral memory + calibration instead of forcing a
 *     style guess (Part 6 of the spec).
 *
 * Note on tone naming: the existing `DerivedTone` type uses
 * "self-aware" (kebab) for the older deriveTone() callers; the spec
 * for hints uses "self_aware" (snake). We translate inline to keep
 * the spec contract verbatim while not breaking the older tone block.
 */
export type DerivedStyleHints = {
  tone: "dry" | "chaotic" | "self_aware" | "confident" | "neutral";
  hookVoice: string[];
  captionVoice: string[];
  emojiPreference: "none" | "low" | "medium";
  sentenceStyle: "short" | "medium" | "punchy";
  energyLevel: "low" | "medium" | "high";
  /** 0.0-0.3 low · 0.4-0.7 medium · 0.8-1.0 high */
  confidence: number;
};

export function deriveStyleHints(profile: StyleProfile): DerivedStyleHints {
  const cap = profile.captionStyle;
  const pacing = profile.pacing;
  const hooks = profile.hookStyle.sampleHooks ?? [];
  const phrases = profile.topics.recurringPhrases ?? [];
  const keywords = profile.topics.keywords ?? [];

  // CONFIDENCE — how much real signal backs these hints? Each
  // bucket weights the cumulative score; capped at 1.0. The schema
  // defaults (avgEmojiCount=2, avgCutsPerSecond=0.5) act as the
  // "no signal" baseline — when they've been moved we know real
  // extraction has run. Threshold 0.3 = the "force neutral" floor.
  let confidence = 0;
  if (hooks.length >= 3) confidence += 0.3;
  else if (hooks.length >= 1) confidence += 0.15;
  if (phrases.length >= 3) confidence += 0.2;
  else if (phrases.length >= 1) confidence += 0.1;
  if (keywords.length >= 5) confidence += 0.2;
  else if (keywords.length >= 1) confidence += 0.1;
  if (pacing.avgCutsPerSecond !== 0.5) confidence += 0.15;
  if (cap.avgEmojiCount !== 2) confidence += 0.15;
  confidence = Math.min(1, confidence);

  // TONE — reuse the existing 4-tone classifier, then downgrade to
  // "neutral" if confidence is too low (Part 6 — don't force style
  // when we don't have data).
  const baseTone = deriveTone(profile);
  const tone: DerivedStyleHints["tone"] =
    confidence < 0.3
      ? "neutral"
      : baseTone === "self-aware"
        ? "self_aware"
        : baseTone;

  // HOOK VOICE — concrete past hook samples the model can echo
  // (up to 5, trimmed of empties).
  const hookVoice = hooks
    .filter((h): h is string => typeof h === "string" && h.trim().length > 0)
    .slice(0, 5);

  // CAPTION VOICE — recurring phrases the creator actually uses
  // (up to 5, trimmed of empties).
  const captionVoice = phrases
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .slice(0, 5);

  // EMOJI PREFERENCE — coarse 3-bucket from avg emoji count.
  // (The ideator's hard EMOJI BUDGET still caps captions at max 1.)
  const emojiPreference: DerivedStyleHints["emojiPreference"] =
    cap.avgEmojiCount === 0
      ? "none"
      : cap.avgEmojiCount <= 2
        ? "low"
        : "medium";

  // SENTENCE STYLE — short (terse), punchy (exclamation-driven), or
  // medium (everything else). Sentence length alone isn't enough —
  // a 12-word sentence with an exclamation reads punchier than a
  // 12-word descriptive one.
  const avgLen = cap.avgSentenceLengthWords;
  const sentenceStyle: DerivedStyleHints["sentenceStyle"] =
    avgLen < 5
      ? "short"
      : cap.punctuationPattern === "exclamation-heavy"
        ? "punchy"
        : "medium";

  // ENERGY LEVEL — pacing first (cuts/sec), then bumped one notch
  // by exclamation-heavy punctuation or emoji-heavy captions
  // (signals enthusiasm / chaotic delivery on top of cut frequency).
  let energyLevel: DerivedStyleHints["energyLevel"] =
    pacing.avgCutsPerSecond < 0.3
      ? "low"
      : pacing.avgCutsPerSecond > 0.8
        ? "high"
        : "medium";
  if (
    energyLevel !== "high" &&
    (cap.punctuationPattern === "exclamation-heavy" || cap.avgEmojiCount >= 3)
  ) {
    energyLevel = energyLevel === "low" ? "medium" : "high";
  }

  return {
    tone,
    hookVoice,
    captionVoice,
    emojiPreference,
    sentenceStyle,
    energyLevel,
    confidence: Math.round(confidence * 100) / 100,
  };
}
