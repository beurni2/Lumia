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
import type { Setting, TopicLane } from "./patternIdeator";

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
  // PHASE Z5.8 — fifth tone option surfaced in the closed-beta
  // Quick Tune. Maps to the existing `high_energy_rant` voice
  // cluster (registered in Z5a) via TONE_TO_VOICE_CLUSTER. Adding
  // a new enum value is additive — old persisted docs without
  // this value parse cleanly.
  "high_energy_rant",
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
  // PHASE Z5.8 — fifth opener option surfaced in the closed-beta
  // Quick Tune. POV hooks ("POV: you're…") map to the
  // `internal_thought` HookStyle in the memory taxonomy via
  // CALIBRATION_HOOK_TO_MEMORY (onboardingSeed.ts).
  "pov_hook",
]);
export type PreferredHookStyle = z.infer<typeof preferredHookStyleEnum>;

// PHASE Z5.8 — TOPIC LANES / situations.
// Six creator-friendly situation buckets surfaced in the closed-beta
// Quick Tune. Stored on the calibration doc as `selectedSituations`
// for now; downstream ideator consumption is intentionally NOT
// wired up in this phase (gap reported to spec — situations land in
// the JSONB but the prompt block / generator does not yet read
// them). The persistence path is the contract this phase ships;
// downstream wiring is a separate task.
export const situationEnum = z.enum([
  "food_home",
  "dating_texting",
  "work_school",
  "social_awkwardness",
  "health_wellness",
  "creator_social",
]);
export type Situation = z.infer<typeof situationEnum>;

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
  // PHASE Z4 — `preferredTone` is the SCALAR back-compat field that
  // every existing server consumer (coreCandidateGenerator,
  // hybridIdeator, ideaScorer, patternIdeator, getToneGuidance)
  // already reads. It MUST keep its scalar shape so we don't have
  // to widen each downstream callsite. The route handler keeps it
  // in sync with `preferredTones[0]` on every save (see
  // `routes/tasteCalibration.ts`). Pre-Z4 clients that only POST
  // the scalar still work; pre-Z4 docs in the JSONB column still
  // parse cleanly because the new array field has `.default([])`.
  preferredTone: preferredToneEnum.nullable().default(null),
  // PHASE Z4 — multi-select tone array (≤3). Mobile sends 1-3
  // entries here; the route normalizes both fields so server-side
  // consumers can read either the scalar (back-compat) or the
  // array (future consumers that want all picked tones).
  preferredTones: z.array(preferredToneEnum).max(3).default([]),
  effortPreference: effortPreferenceEnum.nullable().default(null),
  privacyAvoidances: z.array(privacyAvoidanceEnum).default([]),
  preferredHookStyles: z.array(preferredHookStyleEnum).default([]),
  // PHASE Z5.8 — multi-select situations / topic lanes (≤4). New
  // REQUIRED Quick Tune screen. Persisted on the JSONB doc;
  // downstream consumers (ideator prompt, voice cluster picker)
  // do NOT yet read this field — see `situationEnum` doc above.
  // Default is `[]` so pre-Z5.8 docs still parse cleanly (additive
  // schema change, no migration).
  selectedSituations: z.array(situationEnum).max(4).default([]),
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

/**
 * PHASE Y13 — calibration staleness predicate.
 *
 * Returns true when a completed (non-skipped) calibration document
 * is older than `staleDays` (default 30 d), so the client can
 * re-surface the Quick Tune prompt for users whose taste may have
 * drifted since they first answered. Returns false for:
 *   • null / missing docs (handled by `needsCalibration` instead)
 *   • skipped docs (the user explicitly said "no thanks")
 *   • docs with no `completedAt` (half-state — `needsCalibration`
 *     covers this)
 *   • completed docs younger than the staleness window
 *
 * Pure / synchronous. Mirrors the mobile-side helper in
 * `artifacts/lumina/lib/tasteCalibration.ts` so server jobs (e.g. a
 * future "remind to recalibrate" notification) and the client gate
 * apply the same threshold.
 */
// PHASE Y14 — tightened 90 → 30 days. The Y13 90-day window was
// chosen as a conservative first-pass to never re-prompt a happy
// creator, but feedback showed taste materially shifts on a much
// shorter cycle (a single content-format A/B run, a tone-pivot
// week). 30 days catches drift while the explicit pin still
// matters; the once-per-process latch + count>=2 behavior gate
// keep the prompt from feeling pushy.
export const DEFAULT_CALIBRATION_STALE_DAYS = 30;

export function isCalibrationStale(
  cal: TasteCalibration | null,
  staleDays: number = DEFAULT_CALIBRATION_STALE_DAYS,
  now: Date = new Date(),
): boolean {
  if (!cal) return false;
  if (cal.skipped) return false;
  if (!cal.completedAt) return false;
  const completed = Date.parse(cal.completedAt);
  if (!Number.isFinite(completed)) return false;
  const ageMs = now.getTime() - completed;
  const staleMs = staleDays * 24 * 60 * 60 * 1000;
  return ageMs > staleMs;
}

// ---------------------------------------------------------------- //
// Format → distribution bias.
//
// Platform default is mini-story-heavy: 70 / 20 / 10 (mini_story /
// reaction / pov). Mini-story is the DEFAULT shape — the trigger →
// reaction beat is built into the format itself, which is what makes
// it the most consistent "would you post this" winner for the
// 1K–50K tier. Reaction is the second-line format (needs a strong
// emotional spike + an instantly visual face/body reaction). POV is
// gated — only used when the hook is very strong, the tension is
// unmistakable, and the angle feels personal (not a generic
// "POV: you…" template).
//
// Calibration shifts the FLOOR but never abandons the mini-story
// bias entirely: even when the user explicitly picks `reaction` or
// `pov`, mini_story keeps a 50% floor so the batch stays anchored in
// the format with the strongest payoff structure. The per-creator
// behavioural signal then layers on top — that's the explicit
// "behaviour beats stated preference" rule.
//
// `contrast` is intentionally 0 in every variant — it's only
// introduced once a creator actively likes one (via positive feedback
// on a contrast idea), to avoid blind "before/after" hacks.
// ---------------------------------------------------------------- //

const DEFAULT_DISTRIBUTION: FormatDistribution = {
  mini_story: 70,
  reaction: 20,
  pov: 10,
  contrast: 0,
};

const SINGLE_FORMAT_BIAS: Record<
  Exclude<PreferredFormat, "mixed">,
  FormatDistribution
> = {
  // Picking mini_story doubles down on the platform default — the
  // creator is telling us their voice fits the trigger → reaction
  // beat shape; lean even harder on it.
  mini_story: { mini_story: 80, reaction: 15, pov: 5, contrast: 0 },
  // Picking reaction shifts toward reaction but mini_story stays
  // dominant — reaction-only batches over-index on "face on phone"
  // setups and burn out fast; the mini_story floor keeps variety.
  reaction: { mini_story: 50, reaction: 40, pov: 10, contrast: 0 },
  // Picking pov bumps pov but mini_story stays at 50% — POV is the
  // gated format (strong hook + clear tension + personal feel
  // required); we never let it past 30% even when explicitly
  // preferred, to keep the safer mini_story format leading.
  pov: { mini_story: 50, reaction: 20, pov: 30, contrast: 0 },
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
  // Per-field rounding can drift the sum to 99 or 101 (e.g. averaging
  // mini_story+reaction biases yields 65/28/8/0 = 101). Apply the
  // drift to the largest non-contrast pattern so the floor always
  // sums to exactly 100 — distributionFromSignal's renormalisation
  // step assumes that invariant when no feedback signal is present.
  const sum = avg.pov + avg.reaction + avg.mini_story + avg.contrast;
  const drift = 100 - sum;
  if (drift !== 0) {
    const candidates: Pattern[] = ["mini_story", "reaction", "pov"];
    const largest = candidates.sort((a, b) => avg[b] - avg[a])[0];
    avg[largest] += drift;
  }
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
  // PHASE Z5.8 — POV-archetype hooks. Maps to the model's
  // "internal-thought / second-person scene" framing — the viewer
  // is invited into a moment in someone's head, e.g. "POV: you're
  // pretending to listen". Same tiebreaker share as the others.
  pov_hook:
    "Prefer \"POV: you're…\" / \"POV: when you…\" POV-archetype hooks as the SELECT-step tiebreaker (tune up to ~40% of the batch toward this archetype). Frame as a second-person moment the viewer steps into.",
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
  // PHASE Z5.8 — fifth tone. Loud, ranty, fast-paced energy. Pairs
  // with the high_energy_rant voice cluster via TONE_TO_VOICE_CLUSTER.
  high_energy_rant:
    "Tone: HIGH-ENERGY RANT — favour escalating, ranty, fast-paced delivery; the energy carries the hook. ALL-CAPS bursts and exclamation are fine where they amplify the rant; avoid flat / understated captions.",
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

// ---------------------------------------------------------------- //
// PHASE Z5.8b — situation alignment profiles.
//
// Each Situation maps to a "profile" of downstream signals the
// ideator's existing scoring axes already carry:
//
//   • strongTopicLanes   — TopicLane values that are a perfect
//                          content-lane match for this situation.
//   • adjacentTopicLanes — TopicLane values that are a near-match
//                          (related lane, partial overlap).
//   • strongSettings     — Setting values that match the typical
//                          physical environment of this situation.
//   • familySubstrings   — substrings to match against the
//                          candidate's `meta.scenarioFamily` for a
//                          high-confidence content-family signal
//                          (the most specific axis of the three).
//
// CONSUMED BY `selectionPenalty` (ideaScorer.ts) via the
// `scoreSituationAlignment` helper below, ADDITIVELY only — the
// boost band is intentionally narrow (0..+4) so it sits BELOW the
// existing comedy bands (+5..+7) and Hero Quality boosts (0..+6),
// preserving the "Hero / comedy ALWAYS dominate" invariant.
//
// NOT a hard filter: a candidate that matches no selected
// situation just gets 0; the only penalty path is a -1 nudge when
// the user picked ≥3 situations AND the candidate aligns with NONE
// of them (strong stated preference + clear mismatch). Sized so
// the sum cannot overpower comedy / hero / retention rankings.
//
// Pure / frozen at module load. NO DB. NO Claude. Same discipline
// as the rest of this file.
// ---------------------------------------------------------------- //

export type SituationProfile = {
  readonly strongTopicLanes: ReadonlyArray<TopicLane>;
  readonly adjacentTopicLanes: ReadonlyArray<TopicLane>;
  readonly strongSettings: ReadonlyArray<Setting>;
  readonly adjacentSettings: ReadonlyArray<Setting>;
  /** Lower-cased substrings matched against `scenarioFamily`. */
  readonly familySubstrings: ReadonlyArray<string>;
};

export const SITUATION_PROFILES: Readonly<Record<Situation, SituationProfile>> =
  Object.freeze({
    food_home: {
      strongTopicLanes: ["food_home"],
      adjacentTopicLanes: ["daily_routine"],
      strongSettings: ["kitchen"],
      adjacentSettings: ["couch", "bed"],
      familySubstrings: [
        "coffee",
        "fridge",
        "snack",
        "meal",
        "dishes",
        "dinner",
        "mug",
        "trash",
        "laundry",
        "cleaning",
        "hydration",
      ],
    },
    dating_texting: {
      strongTopicLanes: ["social_texting"],
      adjacentTopicLanes: [],
      strongSettings: ["couch", "bed"],
      adjacentSettings: ["outside"],
      familySubstrings: [
        "texting",
        "breakup_text",
        "group_chat",
        "wrong_friend_text",
        "wrong_chat_send",
        "typing_dots",
        "birthday_text",
        "weekend_plans",
      ],
    },
    work_school: {
      strongTopicLanes: ["work_productivity"],
      adjacentTopicLanes: [],
      strongSettings: ["desk"],
      adjacentSettings: ["car"],
      familySubstrings: [
        "email",
        "work",
        "meeting",
        "productivity",
        "study",
        "password_reset",
        "library",
        "journaling",
        "morning_pages",
        "posture",
        "wrong_year_form",
        "colleague",
      ],
    },
    social_awkwardness: {
      strongTopicLanes: ["social_texting"],
      adjacentTopicLanes: [],
      strongSettings: ["outside"],
      adjacentSettings: ["other", "couch"],
      familySubstrings: [
        "social_call",
        "name_blank_party",
        "wave_back",
        "social_post",
        "restaurant_pick",
        "gym_avoid_coworker",
        "meeting_collision",
        "accent_pickup",
        "voice_crack",
        "sneeze_chain",
        "compliment_freeze",
        "loud_neighbor",
        "tipping_internal",
        "gift_received",
        "concert_aftermath",
      ],
    },
    health_wellness: {
      strongTopicLanes: ["body_fitness"],
      adjacentTopicLanes: ["daily_routine"],
      strongSettings: ["bed", "bathroom"],
      adjacentSettings: ["outside"],
      familySubstrings: [
        "gym",
        "walk",
        "sleep",
        "hydration",
        "skincare",
        "fitness",
        "mirror_pep",
        "peak_was_yesterday",
        "nap",
        "bedtime",
        "screen_time",
        "morning",
        "routine_witness",
      ],
    },
    creator_social: {
      strongTopicLanes: ["social_texting"],
      adjacentTopicLanes: ["work_productivity", "daily_routine"],
      strongSettings: ["desk"],
      adjacentSettings: ["bed", "couch"],
      familySubstrings: [
        "social_post",
        "old_photo_self",
        "birthday_age_dread",
      ],
    },
  });

/**
 * Per-candidate alignment delta against the creator's selected
 * situations. ADDITIVE only:
 *
 *   +4  candidate strong-matches at least one selected situation
 *       (topicLane ∈ strongTopicLanes OR
 *        scenarioFamily contains a familySubstring OR
 *        setting ∈ strongSettings AND topicLane ∈ strongTopicLanes)
 *   +2  candidate adjacent-matches at least one selected situation
 *       (topicLane ∈ adjacentTopicLanes OR
 *        setting ∈ strongSettings OR
 *        setting ∈ adjacentSettings)
 *    0  no signal
 *   -1  ≥3 situations selected AND candidate matches none of them
 *       (strong stated preference + clear mismatch — gentle nudge,
 *        NEVER a hard filter)
 *
 * Returns 0 for empty / undefined situation set so the lever is a
 * no-op for cold-start creators and for anyone who skipped Quick
 * Tune. Returns 0 when the candidate has no usable signals
 * (Llama / Claude wraps without `meta.topicLane` AND without a
 * recognized `scenarioFamily`) — same fail-quiet discipline as the
 * rest of the soft scoring layer.
 */
export function scoreSituationAlignment(
  candidate: {
    readonly topicLane?: TopicLane;
    readonly setting?: Setting;
    readonly scenarioFamily?: string;
  },
  selectedSituations: ReadonlySet<Situation> | undefined,
): number {
  if (!selectedSituations || selectedSituations.size === 0) return 0;

  const lane = candidate.topicLane;
  const setting = candidate.setting;
  const familyLower = candidate.scenarioFamily
    ? candidate.scenarioFamily.toLowerCase()
    : undefined;

  // No usable axes → silent abstain. Llama / Claude wraps sometimes
  // omit topicLane AND ship a free-form scenarioFamily that doesn't
  // match any registered substring; treat as "no signal" rather than
  // letting the ≥3 mismatch penalty fire on a candidate we can't
  // even classify.
  if (lane === undefined && setting === undefined && !familyLower) return 0;

  let strongMatch = false;
  let adjacentMatch = false;

  for (const sit of selectedSituations) {
    const profile = SITUATION_PROFILES[sit];
    if (!profile) continue;

    const laneStrong = lane !== undefined && profile.strongTopicLanes.includes(lane);
    const settingStrong =
      setting !== undefined && profile.strongSettings.includes(setting);
    const familyStrong =
      familyLower !== undefined &&
      profile.familySubstrings.some((sub) => familyLower.includes(sub));

    if (familyStrong || laneStrong || (settingStrong && laneStrong)) {
      strongMatch = true;
      break; // can't beat +4
    }

    const laneAdj =
      lane !== undefined && profile.adjacentTopicLanes.includes(lane);
    const settingAdj =
      setting !== undefined && profile.adjacentSettings.includes(setting);
    if (laneAdj || settingStrong || settingAdj) {
      adjacentMatch = true;
    }
  }

  if (strongMatch) return 4;
  if (adjacentMatch) return 2;
  // Mismatch nudge — only fires when the user picked ≥3 situations
  // (strong stated preference) AND this candidate aligns with NONE.
  // Bounded at -1 so the lever stays well below comedy / hero
  // bands and never single-handedly deselects a strong candidate.
  if (selectedSituations.size >= 3) return -1;
  return 0;
}
