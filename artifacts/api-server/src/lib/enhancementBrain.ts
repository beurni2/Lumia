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
 * SUGGESTION TYPES (semi-auto apply):
 *   • caption     — replace the displayed caption text immediately.
 *                   Carries `applyValue` = the new caption.
 *   • hook        — replace the displayed hook/title immediately.
 *                   Carries `applyValue` = the new hook.
 *   • start_hint  — recommend a start offset (e.g. "0:01"). UI
 *                   stores the hint and shows "Start around X" —
 *                   we do NOT actually trim. Carries
 *                   `applyValue` = the formatted offset.
 *   • manual      — anything else (refilm, hold longer, bigger
 *                   reaction, etc). Renders as a passive "Try this"
 *                   tip with no Apply button. NEVER carries
 *                   `applyValue`.
 *
 * HARD CONSTRAINTS (server-enforced, not just prompt-asked):
 *   • At most 3 suggestions (clamped on parse).
 *   • Each suggestion text ≤ 1 sentence (clamped to first sentence
 *     on parse).
 *   • At most 1 emoji per suggestion text (extras stripped).
 *   • No editing-UI vocabulary (filters / lighting / resolution /
 *     transitions / cuts-the-tool / colour grading / camera settings)
 *     — banned tokens are stripped at parse, and the prompt also
 *     forbids them.
 *   • Apply types caption/hook MUST carry an applyValue or they're
 *     downgraded to manual. start_hint must carry a value matching
 *     M:SS / MM:SS or it's downgraded to manual.
 *
 * Cost: a single Claude Haiku call with a tight max-tokens budget.
 * Per-creator daily $ cap is enforced upstream by `lib/aiCost.ts`
 * via `callJsonAgent`.
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

export type SuggestionType = "caption" | "hook" | "start_hint" | "manual";

export type EnhancementSuggestion = {
  /** Stable id for client-side apply tracking + signal attribution. */
  id: string;
  type: SuggestionType;
  /** The suggestion text the user reads on the card. */
  text: string;
  /**
   * The value to apply when the user taps Apply.
   *   • caption → new caption string
   *   • hook    → new hook string
   *   • start_hint → formatted offset, e.g. "0:01"
   *   • manual  → omitted
   */
  applyValue?: string;
};

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
  suggestions: EnhancementSuggestion[];
};

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

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

const MAX_SUGGESTIONS = 3;
const MAX_SUGGESTION_CHARS = 140;
const MAX_TITLE_CHARS = 50;
/** Caption / hook applyValue clamp — long enough for a punchy line, short enough to never blow out the overlay. */
const MAX_APPLY_TEXT_CHARS = 160;

/** Validates a "M:SS" or "MM:SS" timestamp, capped to 9:59 since we're talking short-form. */
const START_HINT_RE = /^([0-9]):([0-5][0-9])$/;

/* ------------------------------------------------------------------ */
/*  Schema (raw LLM output — validated, then sanitised)               */
/* ------------------------------------------------------------------ */

const rawSuggestionSchema = z.object({
  type: z.enum(["caption", "hook", "start_hint", "manual"]),
  text: z.string().trim().min(1),
  applyValue: z.string().trim().optional(),
});

const rawResponseSchema = z.object({
  title: z.string().trim().min(1),
  suggestions: z.array(rawSuggestionSchema).min(1),
});

/* ------------------------------------------------------------------ */
/*  Sanitisers                                                        */
/* ------------------------------------------------------------------ */

const EMOJI_REGEX =
  /\p{Extended_Pictographic}(?:\u200d\p{Extended_Pictographic})*/gu;

function clampToOneSentence(s: string): string {
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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsBannedToken(s: string): boolean {
  const lc = s.toLowerCase();
  for (const t of BANNED_TOKENS) {
    const re = new RegExp(`(^|[^a-z])${escapeRegExp(t)}([^a-z]|$)`, "i");
    if (re.test(lc)) return true;
  }
  return false;
}

/**
 * Strip surrounding quote marks (straight or curly) from an apply
 * value. Models often wrap caption/hook applyValues in quotes inside
 * the suggestion text, then echo the same quoting in applyValue. We
 * want the bare string to drop into the overlay.
 */
function stripWrappingQuotes(s: string): string {
  const trimmed = s.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
    ["‘", "’"],
    ["「", "」"],
  ];
  for (const [open, close] of pairs) {
    if (first === open && last === close) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

/**
 * Coerce a raw applyValue into a cleaned, type-appropriate string,
 * or null if it's invalid / banned for that type. Caller is
 * responsible for downgrading the suggestion to "manual" on null.
 */
function sanitizeApplyValue(
  type: SuggestionType,
  raw: string | undefined,
): string | null {
  if (type === "manual") return null;
  if (typeof raw !== "string") return null;
  const stripped = stripWrappingQuotes(raw);
  if (stripped.length === 0) return null;

  if (type === "start_hint") {
    // Accept M:SS / MM:SS only. We tolerate models that emit "0:01s"
    // by trimming a trailing 's' — anything else is rejected.
    const candidate = stripped.replace(/s$/i, "").trim();
    return START_HINT_RE.test(candidate) ? candidate : null;
  }

  // caption / hook — clamp emojis, length, ban editor-talk in the
  // applied text too (defence in depth — the suggestion text is
  // already filtered, but the applyValue can drift).
  const emojiClamped = clampEmojis(stripped);
  const lenClamped = emojiClamped.slice(0, MAX_APPLY_TEXT_CHARS).trim();
  if (lenClamped.length === 0) return null;
  if (containsBannedToken(lenClamped)) return null;
  return lenClamped;
}

/**
 * Sanitise raw LLM output into a guaranteed-safe EnhancementResult.
 * Drops banned suggestions, clamps each text to a single sentence,
 * strips extra emojis, length-caps, validates / cleans applyValue,
 * downgrades caption/hook/start_hint with bad values to "manual",
 * and clamps the array to ≤3.
 */
export function sanitizeEnhancement(raw: unknown): EnhancementResult | null {
  const parsed = rawResponseSchema.safeParse(raw);
  if (!parsed.success) return null;

  const cleaned: EnhancementSuggestion[] = [];
  for (let i = 0; i < parsed.data.suggestions.length; i++) {
    if (cleaned.length >= MAX_SUGGESTIONS) break;
    const s = parsed.data.suggestions[i];

    const oneSentence = clampToOneSentence(s.text);
    const emojiClamped = clampEmojis(oneSentence);
    const lenClamped = emojiClamped.slice(0, MAX_SUGGESTION_CHARS).trim();
    if (lenClamped.length === 0) continue;
    if (containsBannedToken(lenClamped)) continue;

    // Dedupe on text (case-insensitive). Different applyValues for
    // the same text would still be a UX dupe.
    if (cleaned.some((c) => c.text.toLowerCase() === lenClamped.toLowerCase())) {
      continue;
    }

    let type: SuggestionType = s.type;
    let applyValue: string | undefined;
    if (type !== "manual") {
      const v = sanitizeApplyValue(type, s.applyValue);
      if (v === null) {
        // Downgrade to manual rather than drop — the suggestion
        // text itself may still be a useful nudge.
        type = "manual";
      } else {
        applyValue = v;
      }
    }

    cleaned.push({
      id: `s${i + 1}`,
      type,
      text: lenClamped,
      applyValue,
    });
  }

  if (cleaned.length === 0) return null;

  const title = parsed.data.title.slice(0, MAX_TITLE_CHARS).trim();
  if (title.length === 0) return null;

  return { title, suggestions: cleaned };
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
    "4. Generate up to 3 suggestions, each ONE simple, actionable sentence. Each suggestion is one of these types:",
    "   • caption     — a new caption to use. Provide `applyValue` = the bare new caption text (no quote marks).",
    "   • hook        — a new hook/title to use. Provide `applyValue` = the bare new hook text (no quote marks), ≤8 words.",
    "   • start_hint  — a recommended start offset. Provide `applyValue` in M:SS form (e.g. \"0:01\", \"0:03\"). Capped at 9:59.",
    "   • manual      — anything that requires refilming, holding a shot longer, getting closer, making the reaction bigger, or any change the user must do themselves. NEVER provide `applyValue` for manual.",
    "5. Apply the user's tone, sentence style, and emoji preference to the suggestion's PHRASING (the `text` field) AND to caption/hook applyValue. Sound like a text message.",
    "6. Prioritise by (a) impact on performance, (b) speed to apply, (c) clarity. Keep only the top 1-3.",
    "7. Return JSON: { \"title\": string, \"suggestions\": [{ \"type\": ..., \"text\": ..., \"applyValue\": ... }] }.",
    "",
    "OUTPUT RULES (HARD):",
    "• 1 to 3 suggestions. Never more.",
    "• Each `text` is exactly 1 sentence.",
    "• At most 1 emoji per `text`, only if it feels natural for the user's tone.",
    "• `title` is short (≤6 words), e.g. \"Make it hit harder\" or \"Tighten the open\".",
    "• `applyValue` for caption/hook is the BARE replacement text — no quote marks, no \"Try:\" prefix.",
    "• `applyValue` for start_hint is M:SS only.",
    "• `applyValue` is OMITTED for type=manual.",
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
    "Prefer caption / hook / start_hint suggestions where they would genuinely help — these are instantly applyable and feel like easy wins.",
    "Use type=manual only when the fix truly requires the user to refilm or change a behaviour on camera.",
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

  // Suggestions are short by spec (1 sentence × 3) but each now also
  // carries an applyValue, so bump the budget a touch from the
  // pre-apply version.
  const raw = await callJsonAgent({
    system,
    user,
    schema: rawResponseSchema,
    maxTokens: 512,
    ctx,
  });

  const cleaned = sanitizeEnhancement(raw);
  if (!cleaned) {
    // The model returned a structurally valid object but every
    // suggestion was empty / banned. Surface a stable fallback so
    // the UI never has to render an empty card.
    return {
      title: "Tighten the open",
      suggestions: [
        {
          id: "fallback-1",
          type: "manual",
          text: "Start right on your reaction so the moment lands faster.",
        },
      ],
    };
  }
  return cleaned;
}
