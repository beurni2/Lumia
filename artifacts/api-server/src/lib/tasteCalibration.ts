/**
 * Taste Calibration — optional 5-question preference document.
 *
 * Surfaced once on first onboarding (after the Style Profile reveal)
 * and used as INITIAL bias for the per-creator format distribution
 * and the ideator prompt's tone / effort / privacy / hook-style
 * fragments. The user can skip it; their feedback (Yes/Maybe/No on
 * generated ideas) always overrides stated preference over time —
 * "behaviour beats stated preference" is the explicit rule from
 * the spec.
 *
 * Storage: a single jsonb document on `creators.taste_calibration_json`
 * (migration id=17). NULLABLE — the absence of a row simply means
 * "ask once, never block" — the ideator falls back to its existing
 * defaults + feedback-only adaptation.
 */

import { z } from "zod";

import type { FormatDistribution, Pattern } from "./formatDistribution";

// ---------------------------------------------------------------- //
// Enums — kept narrow and explicit. Adding a new option requires a
// schema change here AND a UI change in TasteCalibration.tsx, which
// is the right level of friction for a calibrated psychology surface.
// ---------------------------------------------------------------- //

export const preferredFormatEnum = z.enum([
  "mini_story",
  "reaction",
  "pov",
  "mixed",
]);
export type PreferredFormat = z.infer<typeof preferredFormatEnum>;

export const preferredToneEnum = z.enum([
  "dry_subtle",
  "chaotic",
  "bold",
  "self_aware",
]);
export type PreferredTone = z.infer<typeof preferredToneEnum>;

export const effortPreferenceEnum = z.enum([
  "zero_effort",
  "low_effort",
  "structured",
]);
export type EffortPreference = z.infer<typeof effortPreferenceEnum>;

export const privacyAvoidanceEnum = z.enum([
  "avoid_messages",
  "avoid_finance",
  "avoid_people",
  "avoid_private_info",
  "no_privacy_limits",
]);
export type PrivacyAvoidance = z.infer<typeof privacyAvoidanceEnum>;

export const preferredHookStyleEnum = z.enum([
  "behavior_hook",
  "thought_hook",
  "curiosity_hook",
  "contrast_hook",
]);
export type PreferredHookStyle = z.infer<typeof preferredHookStyleEnum>;

// ---------------------------------------------------------------- //
// The persisted document. Two shapes are valid:
//   1. The "skipped" payload (`{skipped: true, completedAt: null}`)
//      — set when the user taps "Skip for now" so the UI doesn't
//      keep re-surfacing the prompt.
//   2. The "completed" payload — every field populated.
// We accept both and let the consumer branch on `skipped`.
// ---------------------------------------------------------------- //

export const tasteCalibrationSchema = z.object({
  preferredFormats: z.array(preferredFormatEnum).default([]),
  preferredTone: preferredToneEnum.nullable().default(null),
  effortPreference: effortPreferenceEnum.nullable().default(null),
  privacyAvoidances: z.array(privacyAvoidanceEnum).default([]),
  preferredHookStyles: z.array(preferredHookStyleEnum).default([]),
  // ISO-8601 timestamp; null when `skipped: true`.
  completedAt: z.string().datetime().nullable().default(null),
  skipped: z.boolean().default(false),
});

export type TasteCalibration = z.infer<typeof tasteCalibrationSchema>;

/**
 * Best-effort parser for whatever's on `creators.taste_calibration_json`.
 * Returns null on missing/invalid — the ideator must never block on a
 * bad calibration document.
 */
export function parseTasteCalibration(
  raw: unknown,
): TasteCalibration | null {
  if (!raw || typeof raw !== "object") return null;
  const parsed = tasteCalibrationSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------- //
// Format → distribution bias.
//
// Spec rule: "Default distribution before calibration: 40 / 40 / 20.
// For a strongly-preferred single format, calibration may shift toward
// 60 / 30 / 10. But this must be per-user, not global." So a single
// preferred format shifts the FLOOR distribution (which the per-creator
// signal then layers on top of); "mixed" or no selection keeps the
// existing default. POV is capped at 50 because it's a higher-risk
// format the ideator is more likely to do badly — leave headroom for
// the safer formats even when the user explicitly asks for POV.
//
// `contrast` is intentionally 0 in every variant — it's only
// introduced once a creator actively likes one (via positive feedback
// on a contrast idea), to avoid blind "before/after" hacks.
// ---------------------------------------------------------------- //

const DEFAULT_DISTRIBUTION: FormatDistribution = {
  mini_story: 40,
  reaction: 40,
  pov: 20,
  contrast: 0,
};

const SINGLE_FORMAT_BIAS: Record<
  Exclude<PreferredFormat, "mixed">,
  FormatDistribution
> = {
  mini_story: { mini_story: 60, reaction: 30, pov: 10, contrast: 0 },
  reaction: { mini_story: 30, reaction: 60, pov: 10, contrast: 0 },
  pov: { mini_story: 25, reaction: 25, pov: 50, contrast: 0 },
};

/**
 * Compute the FLOOR distribution the per-creator signal layers on top
 * of. If the user picked exactly one concrete format (mini_story /
 * reaction / pov), that format is biased; "mixed" or any combination
 * keeps the conservative default. Skipped / null calibration also
 * returns the default — that's the whole point of "optional".
 */
export function distributionFloorFromCalibration(
  cal: TasteCalibration | null,
): FormatDistribution {
  if (!cal || cal.skipped) return { ...DEFAULT_DISTRIBUTION };
  const formats = cal.preferredFormats;
  // "mixed" present → user explicitly asked for variety; ignore any
  // other accidental selections and return the default.
  if (formats.includes("mixed")) return { ...DEFAULT_DISTRIBUTION };
  // Exactly one single-format preference → bias the floor.
  if (formats.length === 1) {
    const only = formats[0] as Exclude<PreferredFormat, "mixed">;
    if (only in SINGLE_FORMAT_BIAS) {
      return { ...SINGLE_FORMAT_BIAS[only] };
    }
  }
  // Multiple non-mixed selections → average their biases. Rare in
  // practice (the UI is single-select), but defend against it so
  // a future multi-select redesign doesn't crash the floor.
  const PATTERNS: Pattern[] = ["pov", "reaction", "mini_story", "contrast"];
  const sums: Record<Pattern, number> = {
    pov: 0,
    reaction: 0,
    mini_story: 0,
    contrast: 0,
  };
  let n = 0;
  for (const f of formats) {
    if (f === "mixed") continue;
    const bias = SINGLE_FORMAT_BIAS[f as Exclude<PreferredFormat, "mixed">];
    if (!bias) continue;
    for (const p of PATTERNS) sums[p] += bias[p];
    n += 1;
  }
  if (n === 0) return { ...DEFAULT_DISTRIBUTION };
  const avg: FormatDistribution = {
    pov: Math.round(sums.pov / n),
    reaction: Math.round(sums.reaction / n),
    mini_story: Math.round(sums.mini_story / n),
    contrast: Math.round(sums.contrast / n),
  };
  return avg;
}

// ---------------------------------------------------------------- //
// Hook-style bias.
//
// The four hook archetypes map to the existing "five formats" the
// ideator's HOOK CRAFT gate already brainstorms across (Behavior /
// Thought / Moment / Contrast / Curiosity). When the user picks one,
// we tell the model to *prefer* that archetype as the SELECT step's
// tiebreaker — not to use it for every idea (variety still matters).
// ---------------------------------------------------------------- //

const HOOK_STYLE_GUIDANCE: Record<PreferredHookStyle, string> = {
  behavior_hook:
    'Prefer "the way I…" / "the way my [thing]…" Behavior-archetype hooks as the SELECT-step tiebreaker (tune up to ~40% of the batch toward this archetype).',
  thought_hook:
    'Prefer "why do I…" / "why am I…" Thought-archetype hooks as the SELECT-step tiebreaker (tune up to ~40% of the batch toward this archetype).',
  curiosity_hook:
    'Prefer "this is where it went wrong" / "the moment I realised…" Curiosity-archetype hooks as the SELECT-step tiebreaker (tune up to ~40% of the batch toward this archetype).',
  contrast_hook:
    'Prefer "what I say vs what I do" / "expectation vs reality" Contrast-archetype hooks as the SELECT-step tiebreaker (tune up to ~40% of the batch toward this archetype).',
};

const TONE_GUIDANCE: Record<PreferredTone, string> = {
  dry_subtle:
    "Tone: DRY / SUBTLE — favour understated hooks, irony, deadpan captions, small physical reactions. Avoid loud panic emoji and screamed text.",
  chaotic:
    "Tone: CHAOTIC / EXPRESSIVE — favour expressive hooks, panic, bigger visible reactions, ALL-CAPS or 😭/💀 captions where natural. Avoid flat deadpan.",
  bold:
    "Tone: CONFIDENT / BOLD — favour direct statements, confident contrast, no hedging. Hooks land like a verdict, not a question.",
  self_aware:
    'Tone: AWKWARD / SELF-AWARE — favour embarrassment, regret, self-callout (the "I shouldn\'t have done that 💀" register). Hook should feel like the creator catching themselves.',
};

const EFFORT_GUIDANCE: Record<EffortPreference, string> = {
  zero_effort:
    "Effort: ZERO — every idea must be ONE LOCATION, ONE TAKE, NO PROPS. No edits beyond a cut. filmingTimeMin ≤ 5.",
  low_effort:
    "Effort: LOW — every idea fits in 1–2 clips with a quick cut. No multi-step setup. filmingTimeMin ≤ 15.",
  structured:
    "Effort: STRUCTURED — mini-story / contrast formats with a simple setup are fine, but still no rigid scripts and filmingTimeMin ≤ 30.",
};

const PRIVACY_BANS: Record<
  Exclude<PrivacyAvoidance, "no_privacy_limits">,
  string
> = {
  avoid_messages:
    "BANNED (privacy): no real messages or DM screenshots — fake-text overlay only if the idea needs the concept.",
  avoid_finance:
    "BANNED (privacy): no bank apps, balances, transaction history, salary numbers, payment confirmations, or anything that implies a real money figure.",
  avoid_people:
    "BANNED (privacy): no ideas that REQUIRE filming another person (friends/roommates/strangers/family). Solo-only.",
  avoid_private_info:
    "BANNED (privacy): no private personal data — addresses, IDs, medical info, real names of people who didn't consent.",
};

/**
 * Render the calibration as a prompt block the ideator can follow.
 * Returns the empty string when there's nothing to inject (no
 * calibration on file, or user skipped) — callers can join it
 * unconditionally without producing an empty section header.
 */
export function tasteCalibrationPromptBlock(
  cal: TasteCalibration | null,
): string {
  if (!cal || cal.skipped) return "";

  const lines: string[] = [];
  const tone = cal.preferredTone ? TONE_GUIDANCE[cal.preferredTone] : null;
  const effort = cal.effortPreference
    ? EFFORT_GUIDANCE[cal.effortPreference]
    : null;
  const hookGuidance = (cal.preferredHookStyles ?? [])
    .map((s) => HOOK_STYLE_GUIDANCE[s])
    .filter(Boolean);

  const privacy = cal.privacyAvoidances ?? [];
  const noLimits = privacy.includes("no_privacy_limits");
  const privacyBans = noLimits
    ? []
    : privacy
        .filter((p): p is Exclude<PrivacyAvoidance, "no_privacy_limits"> =>
          p !== "no_privacy_limits",
        )
        .map((p) => PRIVACY_BANS[p])
        .filter(Boolean);

  // Suppress the entire block if every dimension is empty — keeps
  // the prompt tight when the user only answered Q1 (format).
  if (
    !tone &&
    !effort &&
    hookGuidance.length === 0 &&
    privacyBans.length === 0
  ) {
    return "";
  }

  lines.push(
    "=== TASTE CALIBRATION (creator-stated preferences — bias INITIAL ideas, but creator behaviour overrides over time) ===",
  );
  if (tone) lines.push(`• ${tone}`);
  if (effort) lines.push(`• ${effort}`);
  for (const h of hookGuidance) lines.push(`• ${h}`);
  for (const p of privacyBans) lines.push(`• ${p}`);
  lines.push(
    "These are starting biases, not hard constraints — except the BANNED items above (privacy bans are absolute).",
  );
  return lines.join("\n");
}
