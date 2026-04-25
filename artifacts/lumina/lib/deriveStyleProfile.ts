/**
 * Rule-based v1 Style Profile derivation.
 *
 * Inputs are deliberately tiny — region + the metadata of the 3
 * onboarding clips (filename + duration) — because Phase 1 ships
 * without any on-device or semantic analysis. The locked spec calls
 * the v1 extraction "rule-based" specifically because we'll have a
 * real Style Twin pipeline later; in the meantime, region defaults
 * + a pacing read from real durations are honest signals we can
 * surface in the reveal screen and feed back into the Ideator.
 *
 * The shape returned matches the server's `styleProfileSchema`
 * (`artifacts/api-server/src/lib/styleProfile.ts`) exactly — POST
 * `/api/style-profile` Zod-validates it, so a drift between this
 * file and the server schema surfaces immediately as a 400.
 */

import type { Bundle } from "@/constants/regions";

export type DerivedStyleProfile = {
  schemaVersion: 1;
  hookStyle: {
    primary: "question" | "boldStatement" | "sceneSetter";
    distribution: {
      question: number;
      boldStatement: number;
      sceneSetter: number;
    };
    sampleHooks: string[];
  };
  captionStyle: {
    avgEmojiCount: number;
    emojiRange: [number, number];
    avgSentenceLengthWords: number;
    sentenceLengthRange: [number, number];
    tone: "short" | "descriptive";
    punctuationPattern:
      | "minimal"
      | "exclamation-heavy"
      | "question-heavy"
      | "mixed";
  };
  pacing: {
    avgCutsPerSecond: number;
    avgVideoDurationSeconds: number;
  };
  topics: {
    keywords: string[];
    recurringPhrases: string[];
    contentType: "entertainment" | "educational" | "lifestyle" | "storytelling";
  };
  language: {
    primary: "en-US" | "en-IN" | "en-PH" | "en-NG";
    slangMarkers: string[];
  };
  derivedAt: string;
};

export type ImportedClipMeta = {
  filename?: string | null;
  durationSec?: number | null;
};

type RegionDefaults = {
  language: DerivedStyleProfile["language"]["primary"];
  slangMarkers: string[];
  primaryHook: DerivedStyleProfile["hookStyle"]["primary"];
  hookDistribution: DerivedStyleProfile["hookStyle"]["distribution"];
  contentType: DerivedStyleProfile["topics"]["contentType"];
  punctuationPattern: DerivedStyleProfile["captionStyle"]["punctuationPattern"];
  captionTone: DerivedStyleProfile["captionStyle"]["tone"];
  avgEmojiCount: number;
  emojiRange: [number, number];
  avgSentenceLengthWords: number;
};

// Defaults are intentionally a strong prior — most v1 creators won't
// post enough through Lumina for us to refine these fast, so the
// reveal screen needs to feel right out of the gate. Slang markers
// are the most regionally-distinctive lever and come straight from
// the locked spec's "code-switch where appropriate" rule.
const REGION_DEFAULTS: Record<Bundle, RegionDefaults> = {
  western: {
    language: "en-US",
    slangMarkers: ["tbh", "ngl", "lowkey"],
    primaryHook: "boldStatement",
    hookDistribution: { question: 0.3, boldStatement: 0.5, sceneSetter: 0.2 },
    contentType: "lifestyle",
    punctuationPattern: "mixed",
    captionTone: "short",
    avgEmojiCount: 2,
    emojiRange: [1, 3],
    avgSentenceLengthWords: 9,
  },
  india: {
    language: "en-IN",
    slangMarkers: ["yaar", "bhai", "actually"],
    primaryHook: "question",
    hookDistribution: { question: 0.55, boldStatement: 0.25, sceneSetter: 0.2 },
    contentType: "entertainment",
    punctuationPattern: "exclamation-heavy",
    captionTone: "descriptive",
    avgEmojiCount: 4,
    emojiRange: [2, 6],
    avgSentenceLengthWords: 14,
  },
  philippines: {
    language: "en-PH",
    slangMarkers: ["talaga", "sobra", "lodi"],
    primaryHook: "sceneSetter",
    hookDistribution: { question: 0.3, boldStatement: 0.25, sceneSetter: 0.45 },
    contentType: "lifestyle",
    punctuationPattern: "exclamation-heavy",
    captionTone: "descriptive",
    avgEmojiCount: 5,
    emojiRange: [3, 8],
    avgSentenceLengthWords: 12,
  },
  nigeria: {
    language: "en-NG",
    slangMarkers: ["abeg", "no wahala", "sharp sharp"],
    primaryHook: "boldStatement",
    hookDistribution: { question: 0.25, boldStatement: 0.55, sceneSetter: 0.2 },
    contentType: "entertainment",
    punctuationPattern: "exclamation-heavy",
    captionTone: "short",
    avgEmojiCount: 3,
    emojiRange: [1, 5],
    avgSentenceLengthWords: 10,
  },
};

export function deriveStyleProfile(input: {
  region: Bundle;
  videos: ImportedClipMeta[];
}): DerivedStyleProfile {
  const defaults = REGION_DEFAULTS[input.region];

  // Real signal #1 — pacing comes from actual clip durations the
  // user just imported. Clamped so a 0.5s blooper or a 4-minute
  // gym video doesn't anchor the value.
  const durations = input.videos
    .map((v) => v.durationSec)
    .filter((d): d is number => typeof d === "number" && d > 0);
  const avgDuration =
    durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 20;
  const clampedAvgDuration = Math.min(60, Math.max(8, avgDuration));

  // Real signal #2 — topic hints from filenames, best-effort. Most
  // gallery clips are named IMG_1234 / VID_001 etc. so this lands
  // empty more often than not — that's fine, the reveal still has
  // four other meaningful rows.
  const keywords = extractTopicKeywords(input.videos.map((v) => v.filename ?? ""));

  return {
    schemaVersion: 1,
    hookStyle: {
      primary: defaults.primaryHook,
      distribution: defaults.hookDistribution,
      sampleHooks: [],
    },
    captionStyle: {
      avgEmojiCount: defaults.avgEmojiCount,
      emojiRange: defaults.emojiRange,
      avgSentenceLengthWords: defaults.avgSentenceLengthWords,
      sentenceLengthRange: [
        Math.max(3, defaults.avgSentenceLengthWords - 4),
        defaults.avgSentenceLengthWords + 6,
      ],
      tone: defaults.captionTone,
      punctuationPattern: defaults.punctuationPattern,
    },
    pacing: {
      avgCutsPerSecond: 0.5,
      avgVideoDurationSeconds: clampedAvgDuration,
    },
    topics: {
      keywords,
      recurringPhrases: [],
      contentType: defaults.contentType,
    },
    language: {
      primary: defaults.language,
      slangMarkers: defaults.slangMarkers,
    },
    derivedAt: new Date().toISOString(),
  };
}

function extractTopicKeywords(filenames: string[]): string[] {
  // Common camera/recorder prefixes + container suffixes — these
  // would otherwise dominate the keyword list and look silly in
  // the reveal screen ("topic focus: img, mp4, dcim").
  const stop = new Set([
    "img",
    "vid",
    "mov",
    "mp4",
    "m4v",
    "video",
    "clip",
    "rec",
    "dcim",
    "iphone",
    "android",
    "screen",
    "recording",
    "tmp",
    "fallback",
    "sim",
    "web",
    "export",
  ]);
  const seen = new Set<string>();
  for (const fn of filenames) {
    if (!fn) continue;
    const stripped = fn.replace(/\.[a-z0-9]{2,4}$/i, "").toLowerCase();
    for (const t of stripped.split(/[^a-z]+/)) {
      if (t.length >= 3 && !stop.has(t)) seen.add(t);
    }
  }
  return Array.from(seen).slice(0, 8);
}

/* ---------------- Display labels (used by the reveal UI) ---------------- */

export const HOOK_LABELS: Record<DerivedStyleProfile["hookStyle"]["primary"], string> = {
  question: "Question hooks",
  boldStatement: "Bold statements",
  sceneSetter: "Scene-setter openers",
};

export const TONE_LABELS: Record<DerivedStyleProfile["captionStyle"]["tone"], string> = {
  short: "Short, punchy captions",
  descriptive: "Descriptive captions",
};

export const CONTENT_TYPE_LABELS: Record<
  DerivedStyleProfile["topics"]["contentType"],
  string
> = {
  entertainment: "Entertainment",
  educational: "Educational",
  lifestyle: "Lifestyle",
  storytelling: "Storytelling",
};

export const LANGUAGE_LABELS: Record<
  DerivedStyleProfile["language"]["primary"],
  string
> = {
  "en-US": "English · US/UK/CA/AU",
  "en-IN": "English · India",
  "en-PH": "English · Philippines",
  "en-NG": "English · Nigeria",
};
