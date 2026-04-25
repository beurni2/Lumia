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
