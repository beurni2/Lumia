/**
 * DefaultTasteProfile (PHASE X — PART 1)
 *
 * The single, named bundle of comedic taste weights that every
 * Lumina creator inherits before any per-creator personalization
 * lands on top. Until PHASE X, taste weights were spread across
 * a dozen scorer/picker call-sites and emerged as an
 * undocumented average — easy to drift, easy to weaken, hard to
 * reason about. This file makes the default taste a single
 * inspectable artifact.
 *
 * IMPORTANT — taxonomy bridge:
 * The PHASE X spec uses abstract mechanism names ("self_betrayal",
 * "absurd_escalation", "identity_exposure", "self_as_other").
 * The real taxonomy in `patternIdeator.ts` is finer-grained
 * (`PremiseStyleId` — 50 styles). Rather than invent a parallel
 * vocabulary, this file MAPS the spec's mechanisms onto the
 * existing `PremiseStyleId` set. Each mechanism is a curated
 * list of premise-style ids that embody that mechanism, and the
 * mechanism's spec-level weight becomes the per-style boost.
 *
 * Likewise, spec joke-shapes ("contrast", "confession",
 * "escalation", "metaphor") map onto the existing
 * `HookLanguageStyle` set so the bias rides the existing
 * selection axes — no new selection axes introduced.
 *
 * SCOPE — what this file does NOT do:
 * - It does NOT enforce hard rejection of off-taste candidates.
 *   That is PART 3 (deferred).
 * - It does NOT verify hook/scenario/filming alignment via a
 *   second LLM pass. That is PART 5 (deferred).
 * - It does NOT fingerprint training hooks. That is PART 6
 *   (deferred).
 *
 * Consumers (PHASE X — PART 2 wiring):
 * - `ideaScorer.ts` reads the boost selectors during
 *   `filterAndRescore` to bias selection toward taste-aligned
 *   premise candidates AND toward the premise-first path
 *   generally (`usedBigPremise === true`).
 * - `ideaGen.ts` (Layer 3 LLM fallback) reads the language /
 *   joke-shape preferences to construct the premise-first
 *   prompt block.
 */
import type {
  HookLanguageStyle,
  PremiseStyleId,
} from "./patternIdeator.js";

// ---------------------------------------------------------------- //
// Spec-level mechanism weights                                     //
// ---------------------------------------------------------------- //
//
// These are the raw spec weights from PHASE X PART 1. They get
// translated into per-PremiseStyleId boosts via MECHANISM_TO_STYLES
// below — the scorer never reads these directly.

const MECHANISM_WEIGHTS = {
  self_betrayal: 1.0, // highest weight per spec
  self_as_other: 0.7,
  absurd_escalation: 0.7,
  identity_exposure: 0.6,
} as const;

type MechanismName = keyof typeof MECHANISM_WEIGHTS;

// ---------------------------------------------------------------- //
// Mechanism → PremiseStyleId mapping (curated)                     //
// ---------------------------------------------------------------- //
//
// Each entry lists the existing premise styles whose underlying
// joke shape embodies that mechanism. Curated by hand from the
// PREMISE_STYLE_IDS list in patternIdeator.ts — when a new style
// id lands, add it here under its closest mechanism (or leave it
// out to give it a neutral weight). A style appearing under
// multiple mechanisms gets the SUM of those mechanism weights,
// which is intentional: cross-mechanism styles like
// `hypocrisy_hyperdrive` (self_betrayal + identity_exposure)
// should out-rank single-mechanism styles.

const MECHANISM_TO_STYLES: Record<MechanismName, readonly PremiseStyleId[]> = {
  self_betrayal: [
    "self_roast_reactor",
    "self_destruction_speedrun",
    "self_sabotage_scrollstop",
    "adulting_betrayal",
    "burnout_betrayal",
    "hypocrisy_hyperdrive",
    "todo_termination",
    "boundary_backfire",
    "procrastination_paradox",
  ],
  self_as_other: [
    "duality_clash",
    "three_am_spiral",
    "fridge_judgment",
    "inner_demon",
    "main_character_meltdown",
    "anxiety_paradox",
  ],
  absurd_escalation: [
    "absurd_escalation",
    "mundane_meltdown",
    "everyday_armageddon",
    "comic_relief_cataclysm",
    "anxiety_avalanche",
    "metaphor_mayhem",
    "contrast_catastrophe",
    "weekly_wipeout",
  ],
  identity_exposure: [
    "pattern_exposure",
    "chaos_confession",
    "doomscroll_disclosure",
    "fake_confidence",
    "delusion_spiral",
    "delusion_downfall",
    "confidence_crash",
    "cart_autopsy",
    "fomo_fracture",
  ],
};

// Pre-compute the per-style boost as the sum of mechanism weights
// for every mechanism the style appears under. Done at module load
// so the hot path is a single Map lookup.
const STYLE_BOOST: ReadonlyMap<PremiseStyleId, number> = (() => {
  const m = new Map<PremiseStyleId, number>();
  (Object.keys(MECHANISM_TO_STYLES) as MechanismName[]).forEach((mech) => {
    const w = MECHANISM_WEIGHTS[mech];
    MECHANISM_TO_STYLES[mech].forEach((styleId) => {
      m.set(styleId, (m.get(styleId) ?? 0) + w);
    });
  });
  return m;
})();

// ---------------------------------------------------------------- //
// Joke-shape preference (spec → HookLanguageStyle)                 //
// ---------------------------------------------------------------- //
//
// Spec PART 1: contrast (dominant) > confession > escalation >
// metaphor. We translate to existing HookLanguageStyle entries.
// `comparison` and `time_stamp` are both contrast shapes ("X vs
// Y" / "3am me vs 9am me") so they share the dominant weight.

const JOKE_SHAPE_WEIGHTS: Partial<Record<HookLanguageStyle, number>> = {
  comparison: 1.0, // contrast (dominant)
  time_stamp: 1.0, // contrast variant
  confession: 0.8,
  escalation_hook: 0.7,
  absurd_claim: 0.6, // closest existing match for "metaphor"
  micro_story: 0.5, // story-shaped contrast adjacent
  matter_of_fact: 0.4, // deadpan delivery boost
  // Other shapes (observation, question, instruction, object_pov,
  // anti_hook) get neutral weight (0). `observation` is intentionally
  // unboosted — spec PART 3 will eventually reject "observation
  // instead of joke" outputs; for now we just don't boost them.
};

// ---------------------------------------------------------------- //
// Language preference (lowercase / conversational / deadpan / short) //
// ---------------------------------------------------------------- //
//
// Returned as a const block the LLM prompt can render verbatim.
// Kept here (not in `ideaGen.ts`) so language is owned by the
// taste profile, not the prompt builder — easier to audit when
// drift shows up.

export const DEFAULT_TASTE_LANGUAGE = {
  case: "lowercase",
  register: "conversational",
  delivery: "deadpan",
  length: "short", // prefer ≤8 words on hook
} as const;

// ---------------------------------------------------------------- //
// Targets (spec PART 1)                                            //
// ---------------------------------------------------------------- //
//
// Read by the LLM prompt builder. Scorer biases on existing
// premiseComedyScore + viralFeelScore already encode most of
// this — these constants exist so the prompt can verbalize the
// targets to the model.

export const DEFAULT_TASTE_TARGETS = {
  specificity: "high", // concrete, named, observable
  absurdity: "medium", // exaggerated but not surreal
  intensity: "high", // emotional spike on every idea
  softness: "very_low", // no hedging, no "kinda" / "maybe"
} as const;

// ---------------------------------------------------------------- //
// Public selectors (consumed by scorer + prompt builder)            //
// ---------------------------------------------------------------- //

/**
 * Boost for a premise-style id under the default taste. Returns 0
 * for unmapped styles (no penalty — just no boost). Bounded by the
 * sum of the largest two mechanism weights (~1.7) by construction.
 */
export function tasteMechanismBoost(
  premiseStyleId: PremiseStyleId | null | undefined,
): number {
  if (!premiseStyleId) return 0;
  return STYLE_BOOST.get(premiseStyleId) ?? 0;
}

/**
 * Boost for a hook language style under the default taste. Returns
 * 0 for unmapped styles. Range: 0..1.0.
 */
export function tasteJokeShapeBoost(
  hookLanguageStyle: HookLanguageStyle | null | undefined,
): number {
  if (!hookLanguageStyle) return 0;
  return JOKE_SHAPE_WEIGHTS[hookLanguageStyle] ?? 0;
}

/**
 * Strong flat bonus for any candidate that came from the premise
 * path (i.e. `meta.usedBigPremise === true`). This is the
 * "premise-first generation" lever for Layer 1: the deterministic
 * engine already produces both premise-driven and template-driven
 * candidates; we want the premise-driven ones to dominate top-3
 * selection without disabling the template path entirely (which
 * would starve the pool when premise candidates fail other
 * filters). Tuned to sit above noise (~+1.5) but below the strong
 * end of viralFeelBoost (~+3) so a great template idea can still
 * beat a mediocre premise idea.
 */
export const PREMISE_FIRST_BONUS = 1.5;

/**
 * Combined taste-alignment score for a candidate, bounded so it
 * can't dominate other scoring axes. Sum of:
 *   - mechanism boost (premiseStyleId)        ~0..1.7
 *   - joke-shape boost (hookLanguageStyle)    ~0..1.0
 *   - premise-first flat bonus if usedBigPremise
 * Hard-capped at +4.0 as a defensive ceiling.
 */
export function scoreDefaultTaste(input: {
  premiseStyleId: PremiseStyleId | null | undefined;
  hookLanguageStyle: HookLanguageStyle | null | undefined;
  usedBigPremise: boolean | null | undefined;
}): number {
  const mech = tasteMechanismBoost(input.premiseStyleId);
  const shape = tasteJokeShapeBoost(input.hookLanguageStyle);
  const premiseFirst = input.usedBigPremise ? PREMISE_FIRST_BONUS : 0;
  const raw = mech + shape + premiseFirst;
  return Math.min(4, raw);
}

/**
 * Renders the spec-level taste guidance as a verbatim block for
 * the Layer-3 LLM prompt. Kept short and in lowercase to match
 * the `DEFAULT_TASTE_LANGUAGE.case` constraint — the model tends
 * to mirror the case of the instructions it's given.
 */
export function renderDefaultTastePromptBlock(): string {
  return [
    "default taste (mandatory bias):",
    "- mechanisms (highest first): self-betrayal, self-as-other, absurd escalation, identity exposure",
    "- joke shapes (dominant first): contrast, confession, escalation, metaphor",
    "- language: lowercase, conversational, deadpan, short (<= 8 words on hook)",
    "- targets: high specificity, medium absurdity, high intensity, very low softness",
    "- forbidden: observation framed as a joke, hedging words (kinda, maybe, sort of), generic relatable shells",
  ].join("\n");
}
