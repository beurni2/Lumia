/**
 * Enhancement Brain — analyses a creator's filmed/uploaded video idea
 * and returns 1–3 high-impact, non-technical suggestions for making
 * the idea hit harder.
 *
 * UNIFIED WITH IDEATOR — this module is intentionally a thin LLM
 * adapter on top of the SAME building blocks the ideator already
 * uses to ship ideas:
 *   • hook craft rules (≤2s clarity, tension, single format)
 *   • style shaping (DerivedStyleHints — tone / emoji / phrasing)
 *   • viral pattern memory (top structures / hookStyles / spikes /
 *     formats + recent accepted / rejected)
 *   • quality rules (visible reaction, payoff lands, style match)
 *
 * The brain follows the 7-step spec verbatim:
 *   1. Understand intent (hook / moment / payoff)
 *   2. Evaluate against ideator rules (HOOK / PACING / REACTION /
 *      PAYOFF / STYLE)
 *   3. Identify the SINGLE biggest weakness
 *   4. Generate ≤3 sentence-long actionable suggestions
 *   5. Apply user style/tone/emoji rules to PHRASING ONLY
 *   6. Prioritise by impact / speed / clarity
 *   7. Output { title, suggestions[] }
 *
 * HARD CONSTRAINTS (server-enforced, not just prompt-asked):
 *   • At most 3 suggestions (clamped on parse).
 *   • Each suggestion ≤ 1 sentence (clamped to first sentence on parse).
 *   • At most 1 emoji per suggestion (extras stripped on parse).
 *   • No editing-UI vocabulary (filters / lighting / resolution /
 *     transitions / cuts-the-tool / colour grading / camera settings)
 *     — banned tokens are stripped at parse, and the prompt also
 *     forbids them. This is the "feels like a friend, not a video
 *     editor" guarantee.
 *
 * Cost: a single Claude Haiku call with a tight max-tokens budget
 * (suggestions are short by spec). Per-creator daily $ cap is
 * enforced upstream by `lib/aiCost.ts` via `callJsonAgent`.
 */

import { z } from "zod";
import { callJsonAgent, type AiCallContext } from "./ai";
import type { DerivedStyleHints } from "./styleProfile";
import type {
  PatternBundle,
  ViralPatternMemory,
} from "./viralPatternMemory";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export type EnhancementOriginalIdea = {
  hook: string;
  concept?: string | null;
  pattern?: string | null;
  emotionalSpike?: string | null;
  structure?: string | null;
  hookStyle?: string | null;
};

export type EnhancementMemorySummary = {
  topStructures: string[];
  topHookStyles: string[];
  topEmotionalSpikes: string[];
  topFormats: string[];
  sampleSize: number;
};

export type EnhancementInput = {
  originalIdea: EnhancementOriginalIdea;
  videoDescription?: string | null;
  transcript?: string | null;
  styleHints: DerivedStyleHints;
  memory: EnhancementMemorySummary;
  recentAcceptedPatterns: PatternBundle[];
  recentRejectedPatterns: PatternBundle[];
};

export type EnhancementResult = {
  title: string;
  suggestions: string[];
};

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

/**
 * Tokens that are flagged as "video-editor talk". If a suggestion
 * contains any of these, we drop it on parse — the goal feeling is
 * "easy fix" not "I need to edit this", and the spec is explicit:
 * NEVER suggest filters / effects / lighting / resolution / editing
 * UI. Lower-cased word-boundary match.
 *
 * NOTE on near-misses: "cut" is intentionally NOT banned even though
 * it's a video-editor verb — the spec's own example is "Remove the
 * first second — it starts too slow", which is a cut suggestion. The
 * editor-tool flavour ("cuts per second", "use cuts") is filtered
 * by the surrounding banned tokens (transitions / effects / etc).
 */
const BANNED_TOKENS: readonly string[] = [
  "filter",
  "filters",
  "effect",
  "effects",
  "lighting",
  "resolution",
  "transition",
  "transitions",
  "colour grad",
  "color grad",
  "grade",
  "lut",
  "luts",
  "exposure",
  "iso",
  "shutter",
  "aperture",
  "fps",
  "framerate",
  "frame rate",
  "codec",
  "bitrate",
  "aspect ratio",
  "crop tool",
  "trim tool",
  "edit tool",
  "editing software",
  "premiere",
  "capcut",
  "after effects",
  "davinci",
];

/** Maximum suggestions the spec allows. */
const MAX_SUGGESTIONS = 3;

/** Reasonable upper bound on suggestion length. */
const MAX_SUGGESTION_CHARS = 140;

/** Reasonable upper bound on title length. */
const MAX_TITLE_CHARS = 50;

/* ------------------------------------------------------------------ */
/*  Schema (raw LLM output — validated, then sanitised)               */
/* ------------------------------------------------------------------ */

const rawResponseSchema = z.object({
  title: z.string().trim().min(1),
  suggestions: z.array(z.string().trim().min(1)).min(1),
});

/* ------------------------------------------------------------------ */
/*  Sanitisers                                                        */
/* ------------------------------------------------------------------ */

/** Match a sequence of one Unicode emoji code point. */
const EMOJI_REGEX =
  /\p{Extended_Pictographic}(?:\u200d\p{Extended_Pictographic})*/gu;

function clampToOneSentence(s: string): string {
  // First terminator wins; if no terminator we return as-is. We
  // include the terminator in the kept slice so "Try this." reads
  // naturally.
  const m = s.match(/^[^.!?…]+[.!?…]/);
  return (m ? m[0] : s).trim();
}

function clampEmojis(s: string): string {
  let kept = 0;
  return s.replace(EMOJI_REGEX, (g) => {
    kept += 1;
    return kept === 1 ? g : "";
  });
}

function containsBannedToken(s: string): boolean {
  const lc = s.toLowerCase();
  for (const t of BANNED_TOKENS) {
    // Word-boundary-ish: token must be surrounded by non-alpha or
    // string boundary. We do this with a simple regex per token; the
    // BANNED_TOKENS list is small and this runs once per suggestion.
    const re = new RegExp(`(^|[^a-z])${escapeRegExp(t)}([^a-z]|$)`, "i");
    if (re.test(lc)) return true;
  }
  return false;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Sanitise raw LLM output into a guaranteed-safe EnhancementResult.
 * Drops banned suggestions, clamps each to a single sentence, strips
 * extra emojis, length-caps, and clamps the array to ≤3.
 */
export function sanitizeEnhancement(raw: unknown): EnhancementResult | null {
  const parsed = rawResponseSchema.safeParse(raw);
  if (!parsed.success) return null;

  const cleanedSuggestions: string[] = [];
  for (const s of parsed.data.suggestions) {
    if (cleanedSuggestions.length >= MAX_SUGGESTIONS) break;
    const oneSentence = clampToOneSentence(s);
    const emojiClamped = clampEmojis(oneSentence);
    const lenClamped = emojiClamped.slice(0, MAX_SUGGESTION_CHARS).trim();
    if (lenClamped.length === 0) continue;
    if (containsBannedToken(lenClamped)) continue;
    // Avoid duplicates (case-insensitive).
    if (
      cleanedSuggestions.some((c) => c.toLowerCase() === lenClamped.toLowerCase())
    ) {
      continue;
    }
    cleanedSuggestions.push(lenClamped);
  }

  if (cleanedSuggestions.length === 0) return null;

  const title = parsed.data.title.slice(0, MAX_TITLE_CHARS).trim();
  if (title.length === 0) return null;

  return { title, suggestions: cleanedSuggestions };
}

/* ------------------------------------------------------------------ */
/*  Prompt                                                            */
/* ------------------------------------------------------------------ */

function bullet(items: string[]): string {
  if (items.length === 0) return "(none yet)";
  return items.map((s) => `  - ${s}`).join("\n");
}

function describePatterns(label: string, bundles: PatternBundle[]): string {
  if (bundles.length === 0) return `${label}: (none yet)`;
  const lines = bundles
    .slice(0, 5)
    .map((b) => {
      const tags = [
        b.structure && `structure=${b.structure}`,
        b.hookStyle && `hookStyle=${b.hookStyle}`,
        b.emotionalSpike && `spike=${b.emotionalSpike}`,
        b.format && `format=${b.format}`,
      ]
        .filter(Boolean)
        .join(", ");
      return `  - ${tags || "(no tags)"}`;
    })
    .join("\n");
  return `${label}:\n${lines}`;
}

function buildSystemPrompt(): string {
  return [
    "You are the ENHANCEMENT BRAIN for a short-form-video creator app.",
    "Your job: analyse one filmed video idea and suggest 1-3 high-impact, non-technical improvements that make the moment hit harder.",
    "",
    "YOU ARE NOT A VIDEO EDITOR. NEVER suggest filters, effects, lighting, resolution, transitions, colour grading, exposure, framerate, codecs, aspect ratio, or any editing-software step.",
    "The user must feel: \"that's an easy fix — I can make this better right now.\"",
    "They must NOT feel: \"I need to edit this.\"",
    "",
    "FOLLOW THESE 7 STEPS INTERNALLY (do not show your work):",
    "1. Understand the intent — what's the hook, the moment, and the reaction/payoff?",
    "2. Evaluate the idea against these rules:",
    "   • HOOK — clear in first 1-2s, has tension, one format only.",
    "   • PACING — no slow start, no dead time before the reaction.",
    "   • REACTION VISIBILITY — emotion is obvious in the first moment.",
    "   • PAYOFF — the moment lands clearly.",
    "   • STYLE MATCH — sounds like the user's tone and phrasing.",
    "3. Identify the SINGLE biggest weakness (weak hook OR slow start OR unclear reaction OR weak ending OR style mismatch). Do not list multiple small issues.",
    "4. Generate up to 3 suggestions — each ONE simple, actionable sentence. Allowed types: hook improvement, cut suggestion, reaction clarity, caption upgrade.",
    "5. Apply the user's tone, sentence style, and emoji preference to PHRASING ONLY (not to logic). Sound like a text message.",
    "6. Prioritise by (a) impact on performance, (b) speed to apply, (c) clarity. Keep only the top 1-3.",
    "7. Return JSON: { \"title\": string, \"suggestions\": string[] }.",
    "",
    "OUTPUT RULES (HARD):",
    "• 1 to 3 suggestions. Never more.",
    "• Each suggestion is exactly 1 sentence.",
    "• At most 1 emoji per suggestion, only if it feels natural for the user's tone.",
    "• Title is short (≤6 words), e.g. \"Make it hit harder\" or \"Tighten the open\".",
    "• No filters / effects / lighting / resolution / transitions / colour grading / camera settings.",
    "• No editing-software references (CapCut, Premiere, etc).",
    "• No meta-talk (\"as an AI…\" / \"based on your data…\"). Speak directly.",
  ].join("\n");
}

function buildUserPrompt(input: EnhancementInput): string {
  const {
    originalIdea,
    videoDescription,
    transcript,
    styleHints,
    memory,
    recentAcceptedPatterns,
    recentRejectedPatterns,
  } = input;

  const ideaTags = [
    originalIdea.pattern && `pattern=${originalIdea.pattern}`,
    originalIdea.structure && `structure=${originalIdea.structure}`,
    originalIdea.hookStyle && `hookStyle=${originalIdea.hookStyle}`,
    originalIdea.emotionalSpike && `spike=${originalIdea.emotionalSpike}`,
  ]
    .filter(Boolean)
    .join(", ");

  return [
    "ORIGINAL IDEA",
    `  hook: "${originalIdea.hook}"`,
    originalIdea.concept ? `  concept: ${originalIdea.concept}` : null,
    ideaTags ? `  tags: ${ideaTags}` : null,
    "",
    "WHAT THE USER FILMED",
    videoDescription
      ? `  description: ${videoDescription}`
      : "  description: (not provided — infer from the idea above)",
    transcript ? `  transcript: ${transcript}` : null,
    "",
    "USER STYLE HINTS (apply to PHRASING only)",
    `  tone: ${styleHints.tone}`,
    `  sentence style: ${styleHints.sentenceStyle}`,
    `  energy level: ${styleHints.energyLevel}`,
    `  emoji preference: ${styleHints.emojiPreference}`,
    styleHints.hookVoice.length > 0
      ? `  recent hook samples (echo cadence, not content):\n${bullet(styleHints.hookVoice)}`
      : null,
    styleHints.captionVoice.length > 0
      ? `  recent phrases (echo cadence, not content):\n${bullet(styleHints.captionVoice)}`
      : null,
    "",
    "VIRAL MEMORY (what tends to land for this user)",
    `  sample size: ${memory.sampleSize}`,
    memory.sampleSize >= 3
      ? [
          memory.topStructures.length
            ? `  top structures: ${memory.topStructures.join(", ")}`
            : null,
          memory.topHookStyles.length
            ? `  top hook styles: ${memory.topHookStyles.join(", ")}`
            : null,
          memory.topEmotionalSpikes.length
            ? `  top emotional spikes: ${memory.topEmotionalSpikes.join(", ")}`
            : null,
          memory.topFormats.length
            ? `  top formats: ${memory.topFormats.join(", ")}`
            : null,
        ]
          .filter(Boolean)
          .join("\n")
      : "  (not enough signal yet — do not lean on this)",
    "",
    "RECENT PATTERNS",
    describePatterns("  recently ACCEPTED", recentAcceptedPatterns),
    describePatterns("  recently REJECTED", recentRejectedPatterns),
    "",
    "TASK",
    "Identify the SINGLE biggest weakness in the filmed idea and return 1-3 short, actionable suggestions to fix it.",
    "Respond with JSON only.",
  ]
    .filter(Boolean)
    .join("\n");
}

/* ------------------------------------------------------------------ */
/*  Public entry point                                                */
/* ------------------------------------------------------------------ */

export async function enhanceVideo(
  input: EnhancementInput,
  ctx?: AiCallContext,
): Promise<EnhancementResult> {
  const system = buildSystemPrompt();
  const user = buildUserPrompt(input);

  // Suggestions are short by spec (1 sentence × 3). 384 tokens is a
  // comfortable ceiling that fits the JSON envelope + room for a
  // marginally chatty model without truncating mid-suggestion.
  const raw = await callJsonAgent({
    system,
    user,
    schema: rawResponseSchema,
    maxTokens: 384,
    ctx,
  });

  const cleaned = sanitizeEnhancement(raw);
  if (!cleaned) {
    // The model returned a structurally valid object but every
    // suggestion was empty / banned. Surface a stable fallback so
    // the UI never has to render an empty card.
    return {
      title: "Tighten the open",
      suggestions: ["Start right on your reaction so the moment lands faster."],
    };
  }
  return cleaned;
}
