/**
 * Onboarding Seed — Phase Y9.
 *
 * Pure cross-walk from the three onboarding documents into the
 * `ViralPatternMemory` shape. The output is a *partial* memory that
 * `computeViralPatternMemory` consumes when behavioural signal is
 * sparse (totalRows < WARMUP_THRESHOLD), so a brand-new creator who
 * has finished onboarding gets meaningful Layer-3 prompt bias from
 * day one — instead of falling back to `EMPTY_MEMORY` which would
 * suppress the viral-memory prompt block entirely (its <3 sampleSize
 * floor) and leave the model with no per-creator hookStyle / format
 * preference signal.
 *
 * Three source documents (all already loaded by `routes/ideator.ts`
 * and parsed by `hybridIdeator.ts`):
 *   1. `taste_calibration_json` — explicit 5-question answers.
 *      Strongest seed signal because the creator literally picked it.
 *   2. `style_profile_json.hookStyle.primary` — derived from past
 *      videos' captions. Softer seed signal because we inferred it.
 *   3. `vision_style_json.derivedStyleHints.preferredFormats` —
 *      Llama-3.2-Vision majority-vote across the creator's frames.
 *      Softer signal for the same reason.
 *
 * "Behaviour beats stated preference" is enforced by the
 * `computeViralPatternMemory` caller: once the creator has accrued
 * ≥ WARMUP_THRESHOLD feedback / signal rows, the seed is dropped
 * entirely and only the live aggregates drive the bias.
 *
 * NO I/O. NO DB. Pure mapping function — easy to test, easy to
 * reason about, easy to extend.
 */

import type {
  HookStyle,
  Format,
  EmotionalSpike,
  Structure,
  ViralPatternMemory,
} from "./viralPatternMemory";
import type { TasteCalibration } from "./tasteCalibration";
import type { StyleProfile } from "./styleProfile";
import type { VisionStyleDoc } from "./visionProfileAggregator";

/**
 * Seed weight applied for SIGNALS the creator EXPLICITLY chose during
 * the 5-question Taste Calibration step. Calibration is a stated
 * preference, so it deserves a real bump on the prompt's LEAN INTO
 * list. Capped well below the Evolution-Engine `+10` clamp so a few
 * pieces of behavioural feedback can still flip the bias the other
 * way (the explicit "behaviour beats stated preference" rule).
 */
export const CALIBRATION_WEIGHT = 3;

/**
 * Seed weight applied for SIGNALS that were INFERRED from the
 * creator's existing content (Style Profile + Vision Profile).
 * Inferred signals are softer than explicit answers — half-weight.
 * If both calibration AND a derived source point at the same tag,
 * the weights stack (e.g. behavior_hook + sceneSetter both bump
 * `the_way_i` for a combined 4.5).
 */
export const DERIVED_WEIGHT = 1.5;

/**
 * Cross-walk for `taste_calibration.preferredHookStyles`. The
 * calibration enum uses creator-friendly labels; the memory
 * taxonomy uses the canonical Evolution-Engine HookStyle keys.
 */
const CALIBRATION_HOOK_TO_MEMORY: Record<string, HookStyle> = {
  behavior_hook: "the_way_i",
  thought_hook: "why_do_i",
  curiosity_hook: "curiosity",
  contrast_hook: "contrast",
  // PHASE Z5.8 — POV ("POV: you're…") openers map to the
  // `internal_thought` HookStyle in the memory taxonomy. POVs put
  // the viewer inside a moment / head, which is the closest
  // semantic fit among the five HOOK_STYLES values. Additive seed
  // — does not change weights for the prior four mappings.
  pov_hook: "internal_thought",
};

/**
 * Cross-walk for `style_profile.hookStyle.primary` (derived from
 * past video captions). The style-profile enum is small; we map
 * each value to its closest memory HookStyle.
 */
const STYLE_HOOK_TO_MEMORY: Record<string, HookStyle> = {
  question: "why_do_i",
  boldStatement: "contrast",
  sceneSetter: "the_way_i",
};

/**
 * Cross-walk for `vision.derivedStyleHints.preferredFormats`. Three
 * of the six vision content-type values map directly to the canonical
 * memory Format taxonomy (mini_story / reaction / pov); the other
 * three (talking_head / lifestyle / unknown) don't fit the four-format
 * production model and are intentionally skipped (no-op rather than
 * a forced cross-walk that would mislead the prompt).
 */
const VISION_FORMAT_TO_MEMORY: Record<string, Format> = {
  mini_story: "mini_story",
  reaction: "reaction",
  pov: "pov",
};

/* ------------------------------------------------------------------ */
/* Public type + builder.                                              */
/* ------------------------------------------------------------------ */

export type OnboardingSeed = {
  /** Seeded structure weights — currently always empty (no
   *  onboarding doc maps to STRUCTURES; behaviour is the only
   *  signal that fills this dim). Kept on the type so future
   *  signals (e.g. a "what kind of moment do you film?" question)
   *  can populate it without a shape change. */
  structures: Partial<Record<Structure, number>>;
  hookStyles: Partial<Record<HookStyle, number>>;
  emotionalSpikes: Partial<Record<EmotionalSpike, number>>;
  formats: Partial<Record<Format, number>>;
  /** Count of distinct seeded entries across all four dims. Drives
   *  the prompt-block's <3 suppression check — a non-empty seed
   *  always renders a non-trivial sample size so the block isn't
   *  suppressed for cold-start creators. */
  sampleSize: number;
  /** Which docs contributed — telemetry only, never rendered. */
  sources: ("taste_calibration" | "style_profile" | "vision_style")[];
};

function bump<T extends string>(
  rec: Partial<Record<T, number>>,
  key: T,
  weight: number,
): void {
  rec[key] = (rec[key] ?? 0) + weight;
}

function countEntries(rec: Partial<Record<string, number>>): number {
  let n = 0;
  for (const v of Object.values(rec)) {
    if (typeof v === "number" && v > 0) n += 1;
  }
  return n;
}

/**
 * Build the per-creator memory seed from the three onboarding docs.
 * Returns `null` when none of the docs contribute anything (no
 * calibration on file AND default style profile AND empty vision
 * doc) — the caller treats `null` as "no seed, fall through to
 * standard behaviour".
 */
export function buildOnboardingSeed(input: {
  tasteCalibration: TasteCalibration | null;
  styleProfile: StyleProfile | null;
  visionStyleDoc: VisionStyleDoc | null;
}): OnboardingSeed | null {
  const seed: OnboardingSeed = {
    structures: {},
    hookStyles: {},
    emotionalSpikes: {},
    formats: {},
    sampleSize: 0,
    sources: [],
  };

  // -------- Source 1: Taste Calibration (explicit answers) --------
  // Skipped calibration documents (`{skipped: true}`) carry the empty
  // arrays from the schema defaults, so the loops below are no-ops
  // and `taste_calibration` never gets pushed onto `sources`.
  const cal = input.tasteCalibration;
  if (cal && !cal.skipped) {
    let calibrationContributed = false;
    for (const hs of cal.preferredHookStyles) {
      const memoryKey = CALIBRATION_HOOK_TO_MEMORY[hs];
      if (memoryKey) {
        bump(seed.hookStyles, memoryKey, CALIBRATION_WEIGHT);
        calibrationContributed = true;
      }
    }
    for (const fmt of cal.preferredFormats) {
      // `mixed` is the explicit "no preference" answer — leave the
      // formats Record untouched so the platform default
      // (mini_story-heavy) carries through unchanged.
      if (fmt === "mixed") continue;
      bump(seed.formats, fmt, CALIBRATION_WEIGHT);
      calibrationContributed = true;
    }
    if (calibrationContributed) seed.sources.push("taste_calibration");
  }

  // -------- Source 2: Style Profile (derived from past videos) ----
  // Only contribute when a profile was passed AND it isn't the
  // identity default (DEFAULT_STYLE_PROFILE has primary=question
  // baked in — we don't want EVERY new creator to get a why_do_i
  // seed bump just because the default exists). Heuristic: a non-
  // default profile has at least one non-empty topic keyword OR a
  // non-default `derivedAt` timestamp (the default uses now() at
  // load time, so we can't trust that — use the keyword presence
  // test instead).
  const sp = input.styleProfile;
  const styleProfileLooksReal =
    sp != null &&
    (sp.topics.keywords.length > 0 ||
      sp.topics.recurringPhrases.length > 0 ||
      sp.captionStyle.avgSentenceLengthWords !== 10); // default = 10
  if (sp && styleProfileLooksReal) {
    const primary = sp.hookStyle.primary;
    const memoryKey = STYLE_HOOK_TO_MEMORY[primary];
    if (memoryKey) {
      bump(seed.hookStyles, memoryKey, DERIVED_WEIGHT);
      seed.sources.push("style_profile");
    }
  }

  // -------- Source 3: Vision Style (Llama-3.2-Vision majority) ----
  const vd = input.visionStyleDoc;
  if (vd && vd.totalAnalyzed > 0) {
    let visionContributed = false;
    for (const cType of vd.derivedStyleHints.preferredFormats) {
      const memoryKey = VISION_FORMAT_TO_MEMORY[cType];
      if (memoryKey) {
        bump(seed.formats, memoryKey, DERIVED_WEIGHT);
        visionContributed = true;
      }
    }
    if (visionContributed) seed.sources.push("vision_style");
  }

  // Total distinct seeded dim entries — drives the prompt block's
  // sampleSize floor. Kept as a count (NOT a sum) so a single
  // strongly-seeded tag doesn't artificially inflate confidence.
  seed.sampleSize =
    countEntries(seed.structures) +
    countEntries(seed.hookStyles) +
    countEntries(seed.emotionalSpikes) +
    countEntries(seed.formats);

  if (seed.sampleSize === 0) return null;
  return seed;
}

/**
 * Apply the seed to a freshly-aggregated memory snapshot. Two modes,
 * branching on `totalRows` (the number of feedback + signal rows
 * that drove the aggregation):
 *
 *   • `totalRows === 0` (cold-start) — the snapshot's four Records
 *     are empty; we POPULATE them from the seed wholesale and
 *     stamp `seededFromOnboarding: true`. The prompt-block render
 *     path special-cases this so the LEAN INTO list isn't suppressed
 *     by the <3 sampleSize floor.
 *
 *   • `0 < totalRows < WARMUP_THRESHOLD` (warming up) — the snapshot
 *     has SOME behavioural signal but not enough to fully drive the
 *     bias on its own. We MERGE: behavioural weights are primary;
 *     for each dim, any tag the seed knows about that has weight 0
 *     in the behavioural aggregate gets its seed weight (zero-fill).
 *     `seededFromOnboarding` is `true` so the prompt block can frame
 *     the bias as partly-onboarding-derived.
 *
 *   • `totalRows >= WARMUP_THRESHOLD` (warm) — caller passes
 *     `seed=null` (or this function is a no-op): the seed is dropped
 *     entirely and only behavioural signal drives the bias. This is
 *     the "behaviour beats stated preference" handover point.
 *
 * Returns a NEW memory object (does not mutate the input).
 */
export function applyOnboardingSeed(
  memory: ViralPatternMemory,
  seed: OnboardingSeed | null,
  totalRows: number,
): ViralPatternMemory {
  if (!seed) return memory;

  const merge = <T extends string>(
    behavioral: Record<string, number>,
    seeded: Partial<Record<T, number>>,
  ): Record<string, number> => {
    const out: Record<string, number> = { ...behavioral };
    for (const [tag, w] of Object.entries(seeded)) {
      if (typeof w !== "number" || w <= 0) continue;
      const existing = out[tag] ?? 0;
      // Only zero-fill — never overwrite or stack on top of an
      // existing behavioural weight (whether positive OR negative).
      // A negative behavioural weight means the creator has actively
      // rejected this tag despite their stated preference; respect
      // that, don't paper over it with the stated bias.
      if (existing === 0) out[tag] = w;
    }
    return out;
  };

  return {
    ...memory,
    structures: merge(memory.structures, seed.structures),
    hookStyles: merge(memory.hookStyles, seed.hookStyles),
    emotionalSpikes: merge(memory.emotionalSpikes, seed.emotionalSpikes),
    formats: merge(memory.formats, seed.formats),
    // Cold-start: the seed becomes the entire sample. Otherwise the
    // behavioural sampleSize stays — we don't pad it with seed
    // entries because a "you have 5 feedback rows + onboarding
    // seed" memory shouldn't claim to be more confident than
    // 5 rows justify.
    sampleSize: totalRows === 0 ? seed.sampleSize : memory.sampleSize,
    seededFromOnboarding: true,
  };
}

/**
 * Threshold (inclusive) at which behavioural signal is considered
 * dense enough to drive the bias on its own — the seed is dropped.
 * 8 rows ≈ 2-3 batches with light feedback engagement; chosen so a
 * creator who actually USES the app for a session or two transitions
 * out of the seeded regime quickly, while a creator who barely uses
 * it keeps the onboarding-derived bias for as long as it's the only
 * signal we have.
 *
 * Exported for the caller (hybridIdeator) so the "is the seed being
 * applied?" log line uses the same constant.
 */
export const WARMUP_THRESHOLD = 8;
