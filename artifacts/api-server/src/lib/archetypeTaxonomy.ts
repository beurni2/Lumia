// -----------------------------------------------------------------------------
// Archetype taxonomy — IDEA ARCHETYPE spec
// -----------------------------------------------------------------------------
// Layered on top of the existing template-based generator. Each
// `ScriptType` resolves to ONE primary `Archetype` (which itself
// belongs to ONE `ArchetypeFamily`) so every assembled candidate
// carries an archetype + family tag without a separate generation
// step. The selector enforces archetype/family diversity in the
// same way it already enforces scriptType diversity (max 1 per
// batch on each axis, plus cross-batch penalties).
//
// 12 families × 10 archetypes = 120 total. Families and archetypes
// are spec-supplied verbatim; mappings from the 37 ScriptType values
// to (family, archetype) are hand-tuned so the 37 actively-rotating
// archetypes are all DISTINCT and span all 12 families.

import type { ScriptType } from "./patternIdeator.js";

// -----------------------------------------------------------------------------
// Family + archetype literal types
// -----------------------------------------------------------------------------

export type ArchetypeFamily =
  | "self_deception"
  | "micro_rituals"
  | "social_observation"
  | "object_personality"
  | "time_distortion"
  | "inner_monologue"
  | "escalation"
  | "weird_habits"
  | "petty_logic"
  | "identity"
  | "low_energy_realism"
  | "unexpected_competence";

export const ARCHETYPE_FAMILIES: readonly ArchetypeFamily[] = [
  "self_deception",
  "micro_rituals",
  "social_observation",
  "object_personality",
  "time_distortion",
  "inner_monologue",
  "escalation",
  "weird_habits",
  "petty_logic",
  "identity",
  "low_energy_realism",
  "unexpected_competence",
] as const;

export type Archetype =
  // self_deception (10)
  | "ill_do_it_later"
  | "fake_productivity"
  | "this_counts"
  | "future_me_lie"
  | "selective_memory"
  | "moving_goalpost"
  | "redefining_success"
  | "almost_did_it"
  | "moral_licensing"
  | "tiny_excuse_big_avoidance"
  // micro_rituals (10)
  | "unnecessary_routine"
  | "repeated_check"
  | "comfort_loop"
  | "double_checking"
  | "restart_ritual"
  | "premature_celebration"
  | "unnecessary_preparation"
  | "just_in_case"
  | "multiple_attempts"
  | "perfectionism_loop"
  // social_observation (10)
  | "shared_awkwardness"
  | "fake_politeness"
  | "unspoken_rules"
  | "silent_judgment"
  | "social_compliance"
  | "awkward_silence"
  | "accidental_eye_contact"
  | "unintended_offense"
  | "group_dynamic"
  | "social_translation"
  // object_personality (10)
  | "object_judging_you"
  | "possessions_with_attitude"
  | "household_drama"
  | "technology_betrayal"
  | "food_with_personality"
  | "clothes_have_opinions"
  | "room_atmosphere"
  | "weather_personality"
  | "vehicle_personality"
  | "anthropomorphic_objects"
  // time_distortion (10)
  | "lost_time"
  | "just_a_second"
  | "two_minutes_forty"
  | "infinite_loop_feeling"
  | "instant_regret"
  | "delay_illusion"
  | "slow_motion_panic"
  | "time_freeze"
  | "hyper_speed_chaos"
  | "expanding_minute"
  // inner_monologue (10)
  | "internal_debate"
  | "contradictory_thoughts"
  | "mental_negotiation"
  | "overthinking_spiral"
  | "rehearsed_conversation"
  | "hypothetical_argument"
  | "anticipating_judgment"
  | "replaying_moment"
  | "self_critique"
  | "intrusive_thought"
  // escalation (10)
  | "small_to_chaos"
  | "one_step_too_far"
  | "doubling_down"
  | "overcommit"
  | "domino_effect"
  | "mistake_spiral"
  | "refusal_to_stop"
  | "unnecessary_complexity"
  | "now_its_worse"
  | "self_created_chaos"
  // weird_habits (10)
  | "pattern_behavior"
  | "irrational_rule"
  | "comfort_action"
  | "harmless_obsession"
  | "micro_perfectionism"
  | "secret_routine"
  | "weird_efficiency"
  | "niche_compulsion"
  | "hyper_specific_preference"
  | "micro_pet_peeve"
  // petty_logic (10)
  | "self_justification"
  | "convenient_logic"
  | "technically_right"
  | "loophole_thinking"
  | "moral_relativism"
  | "half_truth"
  | "accidental_genius"
  | "lazy_genius"
  | "pragmatic_corner_cut"
  | "plausible_deniability"
  // identity (10)
  | "self_vs_reality"
  | "public_vs_private"
  | "momentary_confidence"
  | "accidental_competence"
  | "fake_competence"
  | "aspirational_self"
  | "future_self_promise"
  | "hypothetical_self"
  | "contrasting_self"
  | "self_perception_gap"
  // low_energy_realism (10)
  | "deadpan_acceptance"
  | "quiet_failure"
  | "silent_resignation"
  | "soft_disappointment"
  | "no_big_moment"
  | "minimal_reaction"
  | "slow_realization"
  | "it_is_what_it_is"
  | "suppressed_emotion"
  | "undramatic_truth"
  // unexpected_competence (10)
  | "surprising_skill"
  | "accidental_excellence"
  | "brief_mastery"
  | "one_time_excellence"
  | "hidden_talent"
  | "surprising_clarity"
  | "unintended_authority"
  | "sudden_skill"
  | "surprising_self_awareness"
  | "capable_for_one_moment";

// -----------------------------------------------------------------------------
// Family → archetypes lookup (10 each, 120 total)
// -----------------------------------------------------------------------------

export const ARCHETYPES_BY_FAMILY: Record<ArchetypeFamily, readonly Archetype[]> = {
  self_deception: [
    "ill_do_it_later",
    "fake_productivity",
    "this_counts",
    "future_me_lie",
    "selective_memory",
    "moving_goalpost",
    "redefining_success",
    "almost_did_it",
    "moral_licensing",
    "tiny_excuse_big_avoidance",
  ],
  micro_rituals: [
    "unnecessary_routine",
    "repeated_check",
    "comfort_loop",
    "double_checking",
    "restart_ritual",
    "premature_celebration",
    "unnecessary_preparation",
    "just_in_case",
    "multiple_attempts",
    "perfectionism_loop",
  ],
  social_observation: [
    "shared_awkwardness",
    "fake_politeness",
    "unspoken_rules",
    "silent_judgment",
    "social_compliance",
    "awkward_silence",
    "accidental_eye_contact",
    "unintended_offense",
    "group_dynamic",
    "social_translation",
  ],
  object_personality: [
    "object_judging_you",
    "possessions_with_attitude",
    "household_drama",
    "technology_betrayal",
    "food_with_personality",
    "clothes_have_opinions",
    "room_atmosphere",
    "weather_personality",
    "vehicle_personality",
    "anthropomorphic_objects",
  ],
  time_distortion: [
    "lost_time",
    "just_a_second",
    "two_minutes_forty",
    "infinite_loop_feeling",
    "instant_regret",
    "delay_illusion",
    "slow_motion_panic",
    "time_freeze",
    "hyper_speed_chaos",
    "expanding_minute",
  ],
  inner_monologue: [
    "internal_debate",
    "contradictory_thoughts",
    "mental_negotiation",
    "overthinking_spiral",
    "rehearsed_conversation",
    "hypothetical_argument",
    "anticipating_judgment",
    "replaying_moment",
    "self_critique",
    "intrusive_thought",
  ],
  escalation: [
    "small_to_chaos",
    "one_step_too_far",
    "doubling_down",
    "overcommit",
    "domino_effect",
    "mistake_spiral",
    "refusal_to_stop",
    "unnecessary_complexity",
    "now_its_worse",
    "self_created_chaos",
  ],
  weird_habits: [
    "pattern_behavior",
    "irrational_rule",
    "comfort_action",
    "harmless_obsession",
    "micro_perfectionism",
    "secret_routine",
    "weird_efficiency",
    "niche_compulsion",
    "hyper_specific_preference",
    "micro_pet_peeve",
  ],
  petty_logic: [
    "self_justification",
    "convenient_logic",
    "technically_right",
    "loophole_thinking",
    "moral_relativism",
    "half_truth",
    "accidental_genius",
    "lazy_genius",
    "pragmatic_corner_cut",
    "plausible_deniability",
  ],
  identity: [
    "self_vs_reality",
    "public_vs_private",
    "momentary_confidence",
    "accidental_competence",
    "fake_competence",
    "aspirational_self",
    "future_self_promise",
    "hypothetical_self",
    "contrasting_self",
    "self_perception_gap",
  ],
  low_energy_realism: [
    "deadpan_acceptance",
    "quiet_failure",
    "silent_resignation",
    "soft_disappointment",
    "no_big_moment",
    "minimal_reaction",
    "slow_realization",
    "it_is_what_it_is",
    "suppressed_emotion",
    "undramatic_truth",
  ],
  unexpected_competence: [
    "surprising_skill",
    "accidental_excellence",
    "brief_mastery",
    "one_time_excellence",
    "hidden_talent",
    "surprising_clarity",
    "unintended_authority",
    "sudden_skill",
    "surprising_self_awareness",
    "capable_for_one_moment",
  ],
};

// Reverse lookup: archetype → family. Built once at module load.
export const FAMILY_BY_ARCHETYPE: Readonly<Record<Archetype, ArchetypeFamily>> = (() => {
  const m: Partial<Record<Archetype, ArchetypeFamily>> = {};
  for (const fam of ARCHETYPE_FAMILIES) {
    for (const arch of ARCHETYPES_BY_FAMILY[fam]) {
      m[arch] = fam;
    }
  }
  return m as Record<Archetype, ArchetypeFamily>;
})();

// -----------------------------------------------------------------------------
// ScriptType → primary Archetype mapping
// -----------------------------------------------------------------------------
// Hand-tuned 1:1 derivation: each of the 37 ScriptType values maps
// to ONE primary archetype. All 37 mapped archetypes are distinct
// (no two scriptTypes share an archetype) and the mapping covers
// all 12 archetype families.
//
// Family distribution:
//   self_deception (4):  avoidance, false_start, denial, productivity_illusion
//   micro_rituals  (1):  habit_break_fail
//   social_obs     (2):  social_micro_fail, polite_lie
//   object_pers    (1):  object_personification
//   time_distort   (2):  delayed_consequence, time_blindness
//   inner_mono     (5):  internal_vs_external, social_overthinking,
//                        conversation_replay, self_negotiation, internal_monologue
//   escalation     (7):  overcommit, interrupted_action, slow_escalation,
//                        small_mistake_big_reaction, overreaction,
//                        just_one_more_spiral, exaggeration
//   weird_habits   (1):  loop_behavior  (anchor — only scriptType in this fam)
//   petty_logic    (2):  rationalization, decision_flip
//   identity       (3):  realization, fake_confidence, alternate_reality
//   low_energy     (6):  late_reply_regret, quiet_panic, suppressed_reaction,
//                        delayed_emotion, emotional_disconnect, silent_story
//   unexpected     (3):  unexpected_response, dramatic_narration, fake_documentary
//   TOTAL: 37 ✓ — all 12 families anchored
//
// NOTE: archetypes for scriptTypes NOT listed here (i.e. the 83
// archetypes that are not anchored to any scriptType) are reserved
// for future scriptType additions / Llama fallback / explicit
// override expansion. They still appear in the taxonomy so guards
// and helpers can validate against the full 120 list.

const PRIMARY_ARCHETYPE_BY_SCRIPT_TYPE: Record<ScriptType, Archetype> = {
  // CORE INTERNAL (8)
  avoidance: "ill_do_it_later",
  realization: "self_vs_reality",
  false_start: "almost_did_it",
  overcommit: "overcommit",
  internal_vs_external: "contradictory_thoughts",
  delayed_consequence: "delay_illusion",
  denial: "future_me_lie",
  rationalization: "self_justification",
  // SOCIAL (7)
  social_micro_fail: "shared_awkwardness",
  social_overthinking: "overthinking_spiral",
  late_reply_regret: "soft_disappointment",
  conversation_replay: "rehearsed_conversation",
  fake_confidence: "momentary_confidence",
  polite_lie: "fake_politeness",
  unexpected_response: "surprising_clarity",
  // ACTION-BASED (5)
  interrupted_action: "one_step_too_far",
  loop_behavior: "pattern_behavior",
  decision_flip: "convenient_logic",
  slow_escalation: "small_to_chaos",
  small_mistake_big_reaction: "now_its_worse",
  // EMOTIONAL (5)
  quiet_panic: "quiet_failure",
  suppressed_reaction: "minimal_reaction",
  delayed_emotion: "deadpan_acceptance",
  overreaction: "mistake_spiral",
  emotional_disconnect: "no_big_moment",
  // BEHAVIORAL (5)
  habit_break_fail: "repeated_check",
  just_one_more_spiral: "doubling_down",
  self_negotiation: "mental_negotiation",
  productivity_illusion: "fake_productivity",
  time_blindness: "lost_time",
  // ABSURD / CREATIVE (7)
  object_personification: "object_judging_you",
  dramatic_narration: "one_time_excellence",
  fake_documentary: "brief_mastery",
  internal_monologue: "internal_debate",
  alternate_reality: "aspirational_self",
  exaggeration: "unnecessary_complexity",
  silent_story: "it_is_what_it_is",
};

// -----------------------------------------------------------------------------
// Public resolver
// -----------------------------------------------------------------------------

/**
 * Resolve the primary archetype + family for a ScriptType. Used by
 * `assembleCandidate` so every pattern_variation candidate carries
 * an archetype tag without a separate pick step.
 *
 * Returns `null` when scriptType isn't in the taxonomy (defensive —
 * the union type makes this unreachable for known callers, but the
 * cached-batch lookup path can pass through any string).
 */
export function resolveArchetype(
  scriptType: ScriptType | undefined | null,
): { archetype: Archetype; family: ArchetypeFamily } | null {
  if (!scriptType) return null;
  const archetype = PRIMARY_ARCHETYPE_BY_SCRIPT_TYPE[scriptType];
  if (!archetype) return null;
  const family = FAMILY_BY_ARCHETYPE[archetype];
  return { archetype, family };
}

/**
 * Loose variant for cached-batch entries whose ScriptType was
 * resolved as a free-form string (legacy / fallback). Returns null
 * on unknown values rather than throwing.
 */
export function resolveArchetypeLoose(
  scriptType: string | undefined | null,
): { archetype: Archetype; family: ArchetypeFamily } | null {
  if (!scriptType) return null;
  const archetype = (PRIMARY_ARCHETYPE_BY_SCRIPT_TYPE as Record<string, Archetype | undefined>)[scriptType];
  if (!archetype) return null;
  const family = FAMILY_BY_ARCHETYPE[archetype];
  return { archetype, family };
}
