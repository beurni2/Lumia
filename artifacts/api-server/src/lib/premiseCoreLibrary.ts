/**
 * PHASE Y — PREMISE CORE LIBRARY
 *
 * 40 ultra-refined comedic-engine "cores" organized into 8 families
 * (5 per family). Each core is a DISTINCT generator rule that
 * produces strong, on-taste, premise-first ideas. The library is
 * the PRIMARY seed for the Layer-3 (LLM) generation path — a core
 * is selected per idea, its `generatorRule` drives the model's
 * premise sentence, and `hook` / `whatToShow` / `howToFilm` are
 * derived FROM that single premise.
 *
 * Constraints (per spec):
 *   - exactly 40 cores
 *   - each core distinct (no overlap, no rewordings)
 *   - works WITH DefaultTasteProfile (does not replace it — the
 *     per-family default-mechanism mapping below biases selection
 *     by the same self_betrayal / self_as_other / absurd_escalation
 *     / identity_exposure weights the profile already publishes)
 *   - layer-1 pattern catalog stays untouched
 *
 * The library is pure data + pure helpers — no DB, no I/O. Safe to
 * import from any codepath. A module-load assertion guarantees the
 * 40-core invariant survives editing.
 */

import {
  PREMISE_STYLE_IDS,
  type PremiseStyleId,
} from "./patternIdeator.js";

// ---------------------------------------------------------------- //
// Types                                                            //
// ---------------------------------------------------------------- //

export const PREMISE_CORE_FAMILIES = [
  "self_betrayal",
  "self_as_relationship",
  "absurd_escalation",
  "confident_vs_real",
  "social_mask",
  "adulting_chaos",
  "dopamine_overthinking",
  "identity_exposure",
] as const;

export type PremiseCoreFamily = (typeof PREMISE_CORE_FAMILIES)[number];

export type PremiseCore = {
  /** Stable id — used for telemetry, anti-recent tracking, and
   *  cross-batch demotion. Never change once shipped. */
  id: string;
  family: PremiseCoreFamily;
  /** Underlying joke shape (e.g. "self_betrayal", "intent_vs_action").
   *  Used by anti-loop tracking — repeated mechanisms are penalized. */
  mechanism: string;
  /** One-line tension descriptor (the contradiction at the heart). */
  tension: string;
  /** One-sentence human description of what the core is. */
  description: string;
  /** The generator rule for the LLM. Precise, premise-focused,
   *  contains the contradiction or tension explicitly. */
  generatorRule: string;
  /** Free-form domain tags ("sleep", "money", "food", "phone",
   *  "work", etc.) — informational only, NOT bound to any existing
   *  enum. Used by the prompt to suggest scenario domains. */
  compatibleDomains: readonly string[];
  /** Subset of existing PremiseStyleIds whose joke shape this core
   *  embodies. Used for telemetry and (future) cross-axis biasing. */
  compatiblePremiseStyles: readonly PremiseStyleId[];
  /** 2-3 SHORT example premises (anti-copy seeds — these MUST NOT
   *  be regurgitated by the model; they're shown to illustrate the
   *  shape and explicitly forbidden as outputs). */
  examples: readonly string[];
  /** Concrete patterns the model must NOT repeat. */
  antiCopyHints: readonly string[];
};

// ---------------------------------------------------------------- //
// Family → default-mechanism map (selection weighting)             //
// ---------------------------------------------------------------- //
//
// Mirrors the DefaultTasteProfile spec weights so PremiseCore
// selection is biased by the SAME taste profile that already
// drives Layer-2 scoring. Keeps the two systems aligned without
// importing across module boundaries (DefaultTaste's MECHANISM_-
// WEIGHTS is private; we re-encode the same numbers here scoped
// to the 8 PHASE Y families).
//
//   self_betrayal → 1.0  (highest)
//   self_as_other → 0.7
//   absurd_escalation → 0.7
//   identity_exposure → 0.6

const FAMILY_DEFAULT_TASTE_WEIGHT: Record<PremiseCoreFamily, number> = {
  self_betrayal: 1.0,
  self_as_relationship: 0.7,    // self_as_other shape
  absurd_escalation: 0.7,
  confident_vs_real: 0.85,      // self_betrayal + identity_exposure
  social_mask: 0.6,             // identity_exposure
  adulting_chaos: 0.85,         // self_betrayal + absurd_escalation
  dopamine_overthinking: 0.7,   // self_as_other + absurd_escalation, normalized
  identity_exposure: 0.6,
};

// ---------------------------------------------------------------- //
// THE 40 CORES                                                     //
// ---------------------------------------------------------------- //
//
// 5 cores per family × 8 families = 40 total. Order within a
// family is intentional but not load-bearing — selection is
// weighted, not positional.

const CORES_RAW: readonly PremiseCore[] = [
  // ───────────── FAMILY 1: self_betrayal ─────────────
  {
    id: "self_betrayal_rule_break",
    family: "self_betrayal",
    mechanism: "intent_vs_action",
    tension: "user states a rule, then violates it within seconds",
    description: "Declare a personal rule. Break it immediately, casually.",
    generatorRule:
      "Generate a situation where the user commits to a specific rule out loud, then violates it within the next sentence in a casual or confident way. The contradiction must land in ONE beat — no 'later that day,' the betrayal is immediate.",
    compatibleDomains: ["sleep", "money", "food", "phone", "work", "fitness"],
    compatiblePremiseStyles: [
      "self_roast_reactor",
      "self_destruction_speedrun",
      "hypocrisy_hyperdrive",
    ],
    examples: [
      "i said one episode → opens season 4",
      "no spending today → tabs already open",
    ],
    antiCopyHints: [
      "do not reuse 'one episode' phrasing",
      "do not reuse 'just one' as the rule clause",
      "avoid generic time-stamp punchlines like 'it's 3am'",
    ],
  },
  {
    id: "self_betrayal_promise_to_self",
    family: "self_betrayal",
    mechanism: "future_self_disrespect",
    tension: "vow to change tomorrow, undermining it the same minute",
    description:
      "Earnest commitment to start fresh, instantly contradicted by the present moment.",
    generatorRule:
      "Generate a situation where the user solemnly vows that 'starting tomorrow / Monday / next week' they'll change a behavior — then the punch is what they're doing IN THE SAME MOMENT they're saying it. The future-self is being lied to in real time.",
    compatibleDomains: ["fitness", "diet", "money", "sleep", "study"],
    compatiblePremiseStyles: [
      "self_roast_reactor",
      "burnout_betrayal",
      "procrastination_paradox",
    ],
    examples: [
      "monday i'm clean → currently inhaling sour patch",
      "starting fresh tomorrow → adds to cart mid-sentence",
    ],
    antiCopyHints: [
      "do not lean on the literal word 'monday' more than once per batch",
      "avoid the phrase 'new me'",
    ],
  },
  {
    id: "self_betrayal_principle_collapse",
    family: "self_betrayal",
    mechanism: "principle_vs_convenience",
    tension: "loud principle, abandoned the moment it's mildly inconvenient",
    description:
      "User invokes a deeply-held principle, then drops it for trivial convenience.",
    generatorRule:
      "Generate a situation where the user states a strong principle ('i never...,' 'i refuse to...,' 'on principle i...') and the next beat shows them doing exactly the thing they refuse to do, because the alternative was slightly annoying. The principle must be specific, not vague.",
    compatibleDomains: ["dating", "ethics", "shopping", "work"],
    compatiblePremiseStyles: [
      "hypocrisy_hyperdrive",
      "fake_confidence",
      "delusion_downfall",
    ],
    examples: [
      "i don't text first → 47 unsent drafts",
      "i don't pay shipping → adds bath mat to qualify",
    ],
    antiCopyHints: [
      "avoid 'i don't text first' itself in the hook (used as anchor only)",
      "do not reuse the 'qualify for free shipping' beat verbatim",
    ],
  },
  {
    id: "self_betrayal_bargain_loop",
    family: "self_betrayal",
    mechanism: "bargain_inflation",
    tension: "negotiating with yourself in steadily worse terms",
    description:
      "User strikes a small bargain with themselves that compounds into a much bigger surrender.",
    generatorRule:
      "Generate a stepladder of internal bargains the user makes with themselves — each one slightly worse than the last — collapsing the original limit. Three steps max; the final step must be obviously absurd compared to step one.",
    compatibleDomains: ["food", "money", "phone", "sleep"],
    compatiblePremiseStyles: [
      "self_destruction_speedrun",
      "absurd_escalation",
      "todo_termination",
    ],
    examples: [
      "one bite → one bowl → just finish it for the bag",
      "10 more min → 30 → just call out tomorrow",
    ],
    antiCopyHints: [
      "do not reuse the food→bag escalation literally",
      "avoid the literal '10 more minutes' clause",
    ],
  },
  {
    id: "self_betrayal_resolution_decay",
    family: "self_betrayal",
    mechanism: "plan_collapse",
    tension: "a multi-step plan collapses by step two",
    description:
      "User lays out a clean N-step plan. By step 2 it's already in ruins.",
    generatorRule:
      "Generate a numbered plan (3-5 steps) the user announces at the top, then show the camera/voice landing on step 2 already failed. The collapse must be sudden, not gradual — step 1 lands, step 2 is the wreckage.",
    compatibleDomains: ["fitness", "study", "career", "morning_routine"],
    compatiblePremiseStyles: ["self_roast_reactor", "todo_termination"],
    examples: [
      "5 step morning routine: 1. wake at 6 — 2. nope",
      "30 day glow up: day 1 ✓, day 2 it's over",
    ],
    antiCopyHints: [
      "avoid the literal '30 day glow up' phrase",
      "do not number-list more than 5 steps — visual must stay tight",
    ],
  },

  // ───────────── FAMILY 2: self_as_relationship ─────────────
  {
    id: "self_as_relationship_negotiation",
    family: "self_as_relationship",
    mechanism: "self_as_other_negotiation",
    tension: "treating yourself like a third party at the bargaining table",
    description:
      "User negotiates with themselves as if it's a separate, slightly hostile person.",
    generatorRule:
      "Generate a moment where the user explicitly negotiates terms with themselves out loud — using 'we,' 'you,' or 'okay listen' — like it's two people. The two voices must want different things; one wins, badly.",
    compatibleDomains: ["sleep", "exercise", "phone", "spending"],
    compatiblePremiseStyles: ["duality_clash", "inner_demon", "anxiety_paradox"],
    examples: [
      "okay we're doing 20 push-ups. counter-offer: zero",
      "self: bedtime is 11. self: counter-offer: 2am",
    ],
    antiCopyHints: [
      "do not literally use 'counter-offer' more than once per batch",
      "avoid the literal '20 push-ups' beat",
    ],
  },
  {
    id: "self_as_relationship_disappointment",
    family: "self_as_relationship",
    mechanism: "self_as_disappointed_partner",
    tension: "being disappointed in yourself the way a partner would be",
    description:
      "User addresses themselves with the tone of a tired partner who has had this conversation before.",
    generatorRule:
      "Generate a direct-to-self monologue where the user expresses disappointment in themselves using the cadence of a parent / partner / coach reviewing a repeat offense. The specific behavior reviewed must be small and embarrassing.",
    compatibleDomains: ["dating", "habits", "money", "self_care"],
    compatiblePremiseStyles: ["fridge_judgment", "main_character_meltdown"],
    examples: [
      "we talked about this. checking his story. again.",
      "we agreed: no more 11pm doordash. and yet.",
    ],
    antiCopyHints: [
      "avoid the literal 'we talked about this' twice in same batch",
      "do not reuse 'doordash' as the surrender object",
    ],
  },
  {
    id: "self_as_relationship_breakup",
    family: "self_as_relationship",
    mechanism: "self_as_breakup_target",
    tension: "trying to break up with a habit, version of yourself, or pattern",
    description:
      "User formally tries to end a relationship with one of their own behaviors. The behavior does not consent.",
    generatorRule:
      "Generate a 'breakup speech' framed at a habit or a version of the user (3am-self, broke-self, anxious-self). The speech is sincere; the punch is the immediate return to the behavior, OR the behavior 'replying.'",
    compatibleDomains: ["phone", "anxiety", "money", "ex_relationships"],
    compatiblePremiseStyles: ["duality_clash", "three_am_spiral", "inner_demon"],
    examples: [
      "we're done, scrolling. (still scrolling)",
      "i'm leaving you, anxiety. anxiety: lol where",
    ],
    antiCopyHints: [
      "avoid the literal 'we're done' twice per batch",
      "do not have the habit 'reply' more than once per batch",
    ],
  },
  {
    id: "self_as_relationship_caretaker",
    family: "self_as_relationship",
    mechanism: "self_as_unreliable_dependent",
    tension: "having to caretake a version of you that can't be trusted",
    description:
      "User treats themselves like a child or pet they have to manage so the day doesn't fall apart.",
    generatorRule:
      "Generate a moment where the user has to physically or verbally caretake a version of themselves (lay out clothes the night before, hide the snacks, set 6 alarms) BECAUSE they don't trust the morning version of themselves. The distrust is funny; the precaution is over-engineered.",
    compatibleDomains: ["morning_routine", "food", "sleep", "work"],
    compatiblePremiseStyles: ["adulting_betrayal", "boundary_backfire"],
    examples: [
      "hides own snacks from self. finds them.",
      "puts phone across room. crawls.",
    ],
    antiCopyHints: [
      "do not reuse the 'phone across the room' beat literally",
      "avoid hiding snacks from self verbatim — vary the object",
    ],
  },
  {
    id: "self_as_relationship_coworker",
    family: "self_as_relationship",
    mechanism: "self_as_unreliable_coworker",
    tension: "future-you is the coworker who never delivers",
    description:
      "User treats their future self the way you'd treat a flaky coworker you've stopped relying on.",
    generatorRule:
      "Generate a moment where the user assigns a task to 'future me' / 'tomorrow me' / 'monday me' with the cadence of delegating to a colleague — and the punchline is the immediate, knowing acknowledgment that they will be ghosted by that future self.",
    compatibleDomains: ["work", "study", "errands", "email"],
    compatiblePremiseStyles: ["procrastination_paradox", "todo_termination"],
    examples: [
      "tomorrow me's got it. tomorrow me: lol no i don't",
      "delegating this to monday me. monday me: who hired you",
    ],
    antiCopyHints: [
      "avoid 'tomorrow me' verbatim more than once per batch",
      "do not reuse the 'delegating to' framing",
    ],
  },

  // ───────────── FAMILY 3: absurd_escalation ─────────────
  {
    id: "absurd_escalation_micro_to_macro",
    family: "absurd_escalation",
    mechanism: "minor_irritant_to_life_decision",
    tension: "a tiny annoyance becomes an identity-level decision",
    description:
      "A trivial inconvenience snowballs into a sweeping life change in three beats.",
    generatorRule:
      "Generate a chain where one small irritation (slow wifi, cold coffee, a typo) escalates in three beats to a major life decision (move cities, quit job, change name). Each step must be a concrete jump, not a vague 'and then everything fell apart.'",
    compatibleDomains: ["work", "tech", "city_life", "small_annoyances"],
    compatiblePremiseStyles: ["absurd_escalation", "everyday_armageddon"],
    examples: [
      "wifi slow → cafe → laptop in lap → moving to spain",
      "one typo in slack → considering monastery",
    ],
    antiCopyHints: [
      "avoid 'moving to spain' itself",
      "do not reuse 'monastery' as the endpoint",
    ],
  },
  {
    id: "absurd_escalation_5min_task",
    family: "absurd_escalation",
    mechanism: "task_time_inflation",
    tension: "a 5-minute task spirals into hours of unrelated work",
    description:
      "User starts a tiny task. By beat three they're deep in a wholly different project.",
    generatorRule:
      "Generate a moment where the user announces a 5-minute task, then 4 hours later we cut to them mid-something completely different (rearranging shelves, watching a tutorial in another language, deep in someone else's wedding album). The transition must not be explained — that's the joke.",
    compatibleDomains: ["work", "cleaning", "errands", "study"],
    compatiblePremiseStyles: [
      "absurd_escalation",
      "mundane_meltdown",
      "weekly_wipeout",
    ],
    examples: [
      "5 min email → 3 hrs deep in stranger's linkedin",
      "quick tidy → entire kitchen disassembled",
    ],
    antiCopyHints: [
      "do not reuse the literal '3 hours later' card",
      "avoid 'linkedin' as the endpoint",
    ],
  },
  {
    id: "absurd_escalation_one_text",
    family: "absurd_escalation",
    mechanism: "single_signal_doom_spiral",
    tension: "one ambiguous signal becomes a worst-case scenario in 3 beats",
    description:
      "A single unanswered text / unread message escalates into elaborate worst-case-scenario thinking.",
    generatorRule:
      "Generate a moment where ONE neutral or ambiguous social signal (unread text, unliked post, dry response) triggers a runaway internal monologue that ends at an absurd conclusion (they're dead, they hate me, we're broken up). Three escalation beats max; final beat must be wildly disproportionate.",
    compatibleDomains: ["dating", "friendship", "work", "family"],
    compatiblePremiseStyles: [
      "anxiety_avalanche",
      "anxiety_paradox",
      "three_am_spiral",
    ],
    examples: [
      "left on read 4 min → he's dead → fine, i'm dead",
      "boss said 'k' → packing my desk in my head",
    ],
    antiCopyHints: [
      "avoid 'left on read' verbatim more than once per batch",
      "do not reuse the literal 'k' from the boss as the trigger",
    ],
  },
  {
    id: "absurd_escalation_purchase_chain",
    family: "absurd_escalation",
    mechanism: "necessary_purchase_chain",
    tension: "one 'necessary' purchase requires a chain of supporting purchases",
    description:
      "User buys one thing. To use that thing they must buy three more. The original need vanishes in the receipts.",
    generatorRule:
      "Generate a chain where one 'just need this one thing' purchase reveals it requires N supporting purchases (a stand, a charger, a special cleaner, a course on how to use it). The user lands somewhere they did not intend, financially or aesthetically.",
    compatibleDomains: ["shopping", "hobbies", "tech", "fitness_gear"],
    compatiblePremiseStyles: ["cart_autopsy", "absurd_escalation"],
    examples: [
      "one matcha whisk → ceremonial set → kimono → kyoto flight tab",
      "yoga mat → blocks → strap → guru on retainer",
    ],
    antiCopyHints: [
      "avoid the literal 'matcha' chain",
      "do not reuse 'on retainer' as a punch",
    ],
  },
  {
    id: "absurd_escalation_prep_loop",
    family: "absurd_escalation",
    mechanism: "preparation_eclipses_task",
    tension: "preparing to do the thing becomes the entire activity",
    description:
      "User spends so much time preparing to do something that the something never happens.",
    generatorRule:
      "Generate a moment where the user is elaborately preparing to do a task — gathering, arranging, lighting, vibing — and the cut shows the task itself never happens, but the prep is now a 2-hour project.",
    compatibleDomains: ["study", "exercise", "creative_work", "morning_routine"],
    compatiblePremiseStyles: [
      "procrastination_paradox",
      "mundane_meltdown",
      "todo_termination",
    ],
    examples: [
      "lit candle, made playlist, opened doc. doc: untitled.",
      "cleared desk, cleared mind, cleared whole afternoon",
    ],
    antiCopyHints: [
      "do not reuse 'untitled' as the doc punch verbatim",
      "avoid 'lit a candle' as a recurring opener",
    ],
  },

  // ───────────── FAMILY 4: confident_vs_real ─────────────
  {
    id: "confident_vs_real_skill_claim",
    family: "confident_vs_real",
    mechanism: "claimed_skill_vs_demo",
    tension: "claim mastery, immediately demo amateur-level skill",
    description:
      "User confidently claims a skill, then performs it badly on camera.",
    generatorRule:
      "Generate a moment where the user states a confident skill claim (cooking, dancing, language, sport) and the next cut visually exposes that the skill is at beginner level. The claim must be specific (not 'i'm good at stuff') and the demo must be a single concrete fail.",
    compatibleDomains: ["cooking", "dancing", "languages", "sports"],
    compatiblePremiseStyles: ["fake_confidence", "delusion_spiral"],
    examples: [
      "i'm basically a chef → microwaves rice for 9 minutes",
      "i'm fluent → orders by pointing for the third year",
    ],
    antiCopyHints: [
      "avoid 'basically a chef' verbatim",
      "do not reuse 'fluent' more than once per batch",
    ],
  },
  {
    id: "confident_vs_real_advice_giving",
    family: "confident_vs_real",
    mechanism: "advice_vs_self_practice",
    tension: "give advice you obviously do not follow",
    description:
      "User confidently gives life advice. The visual reveals they don't follow any of it.",
    generatorRule:
      "Generate a moment where the user gives confident advice (budgeting, dating, productivity, sleep) while the surrounding visual evidence shows they violate that advice in plain sight. The advice line must be sharp; the visual contradiction must be obvious in one frame.",
    compatibleDomains: ["money", "dating", "productivity", "wellness"],
    compatiblePremiseStyles: ["hypocrisy_hyperdrive", "fake_confidence"],
    examples: [
      "always pay yourself first → cuts to 14 buy-now-pay-laters",
      "set boundaries → at 2am replying to ex",
    ],
    antiCopyHints: [
      "do not reuse 'set boundaries' as the advice line",
      "avoid 'pay yourself first' verbatim",
    ],
  },
  {
    id: "confident_vs_real_persona_drop",
    family: "confident_vs_real",
    mechanism: "composure_collapse",
    tension: "polished persona drops the moment one small thing goes wrong",
    description:
      "User maintains a confident persona that shatters at the first micro-irritation.",
    generatorRule:
      "Generate a moment where the user holds a calm, curated, composed persona (work, content, social) and ONE small disruption (audio cuts, hair falls, ring cam catches a sound) breaks the entire facade in a single beat.",
    compatibleDomains: ["content_creation", "work", "social", "appearance"],
    compatiblePremiseStyles: [
      "confidence_crash",
      "fake_confidence",
      "main_character_meltdown",
    ],
    examples: [
      "calm yoga teacher voice → dog barks → screams",
      "ceo posture → laptop dies mid-pitch → visible despair",
    ],
    antiCopyHints: [
      "avoid 'yoga teacher voice' verbatim",
      "do not reuse the 'laptop dies' beat",
    ],
  },
  {
    id: "confident_vs_real_internal_panic",
    family: "confident_vs_real",
    mechanism: "calm_outside_panic_inside",
    tension: "outwardly composed, internally a fire alarm",
    description:
      "Split between exterior calm and chaotic internal monologue.",
    generatorRule:
      "Generate a moment with a clear visual or audio split: outside, the user looks unbothered; inside (text overlay, voiceover, internal monologue) the user is panicking. The two tracks must contradict beat for beat.",
    compatibleDomains: ["work_meeting", "small_talk", "first_date", "doctor"],
    compatiblePremiseStyles: ["duality_clash", "anxiety_paradox", "inner_demon"],
    examples: [
      "outside: 'great q!' inside: i don't know what year it is",
      "outside: chill nod. inside: did i lock the door",
    ],
    antiCopyHints: [
      "avoid the literal 'great q' more than once per batch",
      "do not reuse 'did i lock the door' verbatim",
    ],
  },
  {
    id: "confident_vs_real_resume_lie",
    family: "confident_vs_real",
    mechanism: "self_description_vs_evidence",
    tension: "confident self-description meets one piece of damning evidence",
    description:
      "User describes themselves as one thing; one shot of their environment reveals the truth.",
    generatorRule:
      "Generate a moment where the user gives a confident one-line self-description (an early-riser, a minimalist, a foodie) and ONE shot of their actual room / fridge / phone screen reveals the opposite. The contradiction must be a single visual reveal.",
    compatibleDomains: ["self_image", "lifestyle", "wellness", "aesthetic"],
    compatiblePremiseStyles: ["delusion_downfall", "delusion_spiral", "cart_autopsy"],
    examples: [
      "i'm a minimalist → reveals 14 candles, 9 mugs",
      "i'm a foodie → fridge: ketchup, vibes",
    ],
    antiCopyHints: [
      "do not reuse 'minimalist' more than once per batch",
      "avoid 'fridge: ketchup' verbatim — vary the inventory",
    ],
  },

  // ───────────── FAMILY 5: social_mask ─────────────
  {
    id: "social_mask_text_vs_real",
    family: "social_mask",
    mechanism: "online_calm_vs_irl_chaos",
    tension: "chill text reply, frantic real-life reaction",
    description:
      "User composes an unbothered text while visibly losing it in the room.",
    generatorRule:
      "Generate a split between the user's typed reply (one-word, casual, 'haha all good') and the simultaneous physical reality (pacing, sweating, face in pillow). The two tracks must be visible in the same frame or back-to-back cuts.",
    compatibleDomains: ["dating", "friendship", "work_dms", "family_chat"],
    compatiblePremiseStyles: [
      "duality_clash",
      "anxiety_paradox",
      "main_character_meltdown",
    ],
    examples: [
      "text: 'lol np' / room: full pacing meltdown",
      "text: 'sounds good!' / face: silent scream",
    ],
    antiCopyHints: [
      "avoid the literal 'lol np' verbatim",
      "do not reuse 'silent scream' as the visual beat",
    ],
  },
  {
    id: "social_mask_polite_to_petty",
    family: "social_mask",
    mechanism: "polite_outside_savage_inside",
    tension: "polite to their face, scathing the moment they look away",
    description:
      "User is gracious in conversation, ruthless in commentary the second the camera/scene shifts.",
    generatorRule:
      "Generate a beat where the user is warm and polite to a person, then the moment the person leaves frame the user delivers a sharp internal verdict. The verdict must be specific (not just 'they suck') and the politeness must be plausibly believable.",
    compatibleDomains: ["work_meetings", "family_dinner", "service_workers", "exes"],
    compatiblePremiseStyles: ["chaos_confession", "fridge_judgment", "duality_clash"],
    examples: [
      "'so good to see you!' (door closes) 'never again.'",
      "'love that for you!' (turns) 'he's lost his mind.'",
    ],
    antiCopyHints: [
      "do not reuse 'never again' verbatim",
      "avoid 'love that for you' as the polite line repeatedly",
    ],
  },
  {
    id: "social_mask_friend_solo_vs_group",
    family: "social_mask",
    mechanism: "1v1_self_vs_group_self",
    tension: "the version of you with one friend vs. the version with the group",
    description:
      "User shows the dramatic shift in their personality between 1:1 and group settings with the same friend.",
    generatorRule:
      "Generate a side-by-side beat: the user with ONE specific friend (loud, weird, themselves) vs. the same user once a third person enters (quieter, more measured, edited). The shift must be triggered by the third person arriving on screen.",
    compatibleDomains: ["friendship", "work", "family", "parties"],
    compatiblePremiseStyles: ["pattern_exposure", "duality_clash"],
    examples: [
      "with sarah alone: feral. one coworker walks up: composed.",
      "with mom alone: villain era. dad enters: scholar.",
    ],
    antiCopyHints: [
      "avoid the literal 'feral' more than once per batch",
      "do not reuse the name 'sarah' or 'kevin' as anchor names",
    ],
  },
  {
    id: "social_mask_pro_vs_off",
    family: "social_mask",
    mechanism: "work_self_vs_weekend_self",
    tension: "the work-self and the weekend-self are barely the same person",
    description:
      "Stark contrast between the user's professional version and their off-the-clock version.",
    generatorRule:
      "Generate a beat with a hard cut: 9-5 work-self (composed wardrobe, careful language, controlled tone) vs. weekend-self (chaotic, unhinged, a different verbal register). The contrast must be in posture / language / setting all at once.",
    compatibleDomains: ["work_life", "weekend", "career", "identity"],
    compatiblePremiseStyles: ["duality_clash", "pattern_exposure", "chaos_confession"],
    examples: [
      "monday: 'kindly advise.' saturday: 'WHAT did you JUST say'",
      "tuesday: 9am stand-up smile. friday 6:01: gone",
    ],
    antiCopyHints: [
      "avoid the literal 'kindly advise' more than once per batch",
      "do not reuse 'stand-up' as the meeting anchor verbatim",
    ],
  },
  {
    id: "social_mask_camera_on_off",
    family: "social_mask",
    mechanism: "rec_dot_persona_shift",
    tension: "behavior pivots the second a camera or recorder activates",
    description:
      "User behaves one way. The red dot appears. Different person.",
    generatorRule:
      "Generate a beat where the user is being themselves (mid-snack, mid-sentence, mid-spiral) and the moment a camera, voice memo, or recording starts they snap into a totally curated persona. The pivot must happen on the recording cue, not before.",
    compatibleDomains: ["content_creation", "video_calls", "voice_memos"],
    compatiblePremiseStyles: [
      "fake_confidence",
      "main_character_meltdown",
      "chaos_confession",
    ],
    examples: [
      "rec dot appears → instantly an oxford lecturer",
      "camera on → posture, vocabulary, soul: upgraded",
    ],
    antiCopyHints: [
      "avoid 'oxford lecturer' verbatim",
      "do not reuse 'rec dot' more than once per batch",
    ],
  },

  // ───────────── FAMILY 6: adulting_chaos ─────────────
  {
    id: "adulting_chaos_budget_collapse",
    family: "adulting_chaos",
    mechanism: "budget_decorative",
    tension: "the budget exists; it does not function",
    description:
      "User has a budget. The budget is purely ceremonial. Everything is fine.",
    generatorRule:
      "Generate a moment where the user references their budget (an app, a spreadsheet, a category) while the surrounding evidence shows it's been ignored for weeks. The line must reference the budget by name; the visual must show the breach.",
    compatibleDomains: ["money", "shopping", "subscriptions", "rent"],
    compatiblePremiseStyles: ["adulting_betrayal", "cart_autopsy", "hypocrisy_hyperdrive"],
    examples: [
      "checks budget app → it's been screaming for a month",
      "groceries category: $200 / month. june spend: $0 (uber eats)",
    ],
    antiCopyHints: [
      "avoid 'budget app' verbatim more than once per batch",
      "do not reuse 'uber eats' as the breach object — vary the surrender",
    ],
  },
  {
    id: "adulting_chaos_meal_plan_decay",
    family: "adulting_chaos",
    mechanism: "ambitious_plan_to_cereal",
    tension: "ambitious meal-plan decays into the same default by day three",
    description:
      "User ambitiously preps a week of meals. By day 3 it's cereal again.",
    generatorRule:
      "Generate a beat showing the trajectory of the week: monday meal-prepped abundance → wednesday a sad portion → friday cereal at 9pm. The decay must be three concrete beats, food-specific, not vague.",
    compatibleDomains: ["food", "meal_prep", "groceries"],
    compatiblePremiseStyles: ["weekly_wipeout", "adulting_betrayal", "everyday_armageddon"],
    examples: [
      "mon: roasted salmon. wed: just rice. fri: cereal in the dark",
      "sun prep: 14 containers. thu: ordering pad thai over them",
    ],
    antiCopyHints: [
      "avoid 'meal prep' as a recurring label inside the hook",
      "do not reuse the literal 'cereal in the dark' beat",
    ],
  },
  {
    id: "adulting_chaos_email_avoidance",
    family: "adulting_chaos",
    mechanism: "unread_to_crisis",
    tension: "an unread email becomes a slow-burning life crisis",
    description:
      "User avoids one specific email. It compounds into a real problem.",
    generatorRule:
      "Generate a beat where the user has one specific email/letter/notification they refuse to open. Time passes (visible cue: count climbing, dust gathering, deadline passing). The avoidance is the joke; the eventual consequence is implied, not shown.",
    compatibleDomains: ["email", "bills", "tax", "work_admin"],
    compatiblePremiseStyles: ["procrastination_paradox", "todo_termination"],
    examples: [
      "unread: 1. that 1: from the irs. day 47.",
      "voicemail count: 12. all dentist. teeth are fine probably.",
    ],
    antiCopyHints: [
      "do not reuse the literal 'irs' as the sender twice per batch",
      "avoid 'voicemail' as the avoidance object more than once",
    ],
  },
  {
    id: "adulting_chaos_grocery_optimism",
    family: "adulting_chaos",
    mechanism: "shop_chef_eat_student",
    tension: "shop like a chef, eat like a college student",
    description:
      "User shops with high ambition. The fridge tells a different story by day 4.",
    generatorRule:
      "Generate a contrast between the user's grocery haul (fresh produce, 3 oils, an ambitious herb) and the actual meal that night (toast / cereal / cold leftovers). The contrast must show the haul AND the meal in the same beat.",
    compatibleDomains: ["food", "groceries", "cooking_aspiration"],
    compatiblePremiseStyles: ["delusion_downfall", "adulting_betrayal", "fridge_judgment"],
    examples: [
      "haul: dragon fruit, miso, bok choy. dinner: peanut butter spoon",
      "$143 whole foods. tonight: oatmeal in a mug",
    ],
    antiCopyHints: [
      "avoid 'whole foods' verbatim more than once per batch",
      "do not reuse 'peanut butter spoon' as the surrender meal",
    ],
  },
  {
    id: "adulting_chaos_responsible_facade",
    family: "adulting_chaos",
    mechanism: "one_responsible_thing_excuses_all",
    tension: "the one responsible thing you do is doing all the work",
    description:
      "User does one mature, legible thing (paid a bill, made the bed, drank water) and uses it to forgive everything else.",
    generatorRule:
      "Generate a beat where the user proudly cites ONE responsible action they took today, and uses it as full justification for the surrounding chaos. The 'responsible' action must be something tiny.",
    compatibleDomains: ["money", "wellness", "self_image", "habits"],
    compatiblePremiseStyles: ["fake_confidence", "delusion_spiral", "hypocrisy_hyperdrive"],
    examples: [
      "drank water once today. eligible for a nobel.",
      "paid one bill on time. the others can wait, i've contributed.",
    ],
    antiCopyHints: [
      "avoid 'nobel' as the punch verbatim",
      "do not reuse 'drank water' more than once per batch",
    ],
  },

  // ───────────── FAMILY 7: dopamine_overthinking ─────────────
  {
    id: "dopamine_overthinking_doomscroll_logic",
    family: "dopamine_overthinking",
    mechanism: "next_post_is_the_last_lie",
    tension: "convincing yourself the next post will be the last one",
    description:
      "User keeps scrolling on the strict promise that the NEXT post is the final one. It is not.",
    generatorRule:
      "Generate an internal-monologue spiral where the user repeatedly tells themselves 'okay, just this one more' while the visual shows the scroll continuing well past that. The promise is the joke; the visible scroll is the punchline.",
    compatibleDomains: ["phone", "tiktok", "instagram", "reddit"],
    compatiblePremiseStyles: ["doomscroll_disclosure", "self_sabotage_scrollstop"],
    examples: [
      "okay just one more → 47 posts later → okay just one more",
      "this is the last one → it's not → this is the last one",
    ],
    antiCopyHints: [
      "avoid 'just one more' verbatim more than once per batch",
      "do not reuse the literal '47 posts later' time-stamp",
    ],
  },
  {
    id: "dopamine_overthinking_5_apps",
    family: "dopamine_overthinking",
    mechanism: "app_circuit_for_same_hit",
    tension: "cycling through 5 apps looking for the same dopamine hit",
    description:
      "User opens app A, finds nothing, opens B, C, D, E, returns to A.",
    generatorRule:
      "Generate a beat showing the rapid app-cycling pattern: open one, refresh, close, open the next, refresh, close, repeat — landing back on the first one. The cycle must be visually rapid and clearly futile.",
    compatibleDomains: ["phone", "social_media", "boredom"],
    compatiblePremiseStyles: ["doomscroll_disclosure", "self_sabotage_scrollstop", "pattern_exposure"],
    examples: [
      "ig → tiktok → twitter → email → ig (still nothing)",
      "refresh, refresh, refresh, what was i looking for",
    ],
    antiCopyHints: [
      "avoid app names in the hook three+ times — vary which apps appear",
      "do not reuse 'what was i looking for' verbatim",
    ],
  },
  {
    id: "dopamine_overthinking_replay_convo",
    family: "dopamine_overthinking",
    mechanism: "30sec_convo_3day_replay",
    tension: "a 30-second exchange runs in your head for days",
    description:
      "User replays a brief, embarrassing or ambiguous conversation on loop for an absurd duration.",
    generatorRule:
      "Generate a beat referencing one specific tiny exchange (something the user said, mispronounced, or mis-timed). Show the time frame of the rumination (still thinking about it 4 days later) — the disproportion is the joke.",
    compatibleDomains: ["embarrassment", "social", "work", "dating"],
    compatiblePremiseStyles: ["three_am_spiral", "anxiety_avalanche", "pain_point_precision"],
    examples: [
      "said 'you too' to the waiter. day 4. still bothered.",
      "waved at someone not waving at me. it's been 6 weeks.",
    ],
    antiCopyHints: [
      "avoid the literal 'you too' to a waiter verbatim",
      "do not reuse 'waved at someone' as the trigger",
    ],
  },
  {
    id: "dopamine_overthinking_shower_planning",
    family: "dopamine_overthinking",
    mechanism: "shower_arc_to_amnesia",
    tension: "plan an entire life arc in the shower; forget by toweling off",
    description:
      "User plans the next five years of their life in the shower. Total amnesia by the time they're dressed.",
    generatorRule:
      "Generate a beat where the user is in the shower constructing an elaborate plan / monologue / breakthrough realization, then a hard cut to dry-and-dressed user with NO memory of any of it. The contrast must show both states.",
    compatibleDomains: ["shower", "morning", "self_help"],
    compatiblePremiseStyles: ["delusion_spiral", "main_character_meltdown", "absurd_escalation"],
    examples: [
      "shower me: 'i will write the book.' towel me: 'what book.'",
      "shower: career pivot pitch. bedroom: lost the thread",
    ],
    antiCopyHints: [
      "do not reuse 'towel me' verbatim more than once per batch",
      "avoid 'write the book' as the lost goal",
    ],
  },
  {
    id: "dopamine_overthinking_decision_paralysis",
    family: "dopamine_overthinking",
    mechanism: "deciding_takes_longer_than_doing",
    tension: "spend more time deciding than doing the thing",
    description:
      "User researches a small decision longer than the decision itself would have taken to execute and undo.",
    generatorRule:
      "Generate a beat where the user spends a wildly disproportionate amount of time deciding about a tiny decision (which kettle, which restaurant, which font), with a clear over/under: time spent deciding vs. time the actual thing would have taken.",
    compatibleDomains: ["shopping", "food_orders", "creative_work"],
    compatiblePremiseStyles: [
      "anxiety_avalanche",
      "procrastination_paradox",
      "anxiety_paradox",
    ],
    examples: [
      "2 hrs deciding what to eat. ate cereal. cereal time: 90 sec.",
      "47 tabs comparing kettles. they all boil water.",
    ],
    antiCopyHints: [
      "avoid '47 tabs' verbatim more than once per batch",
      "do not reuse 'they all boil water' as the punch",
    ],
  },

  // ───────────── FAMILY 8: identity_exposure ─────────────
  {
    id: "identity_exposure_aesthetic_collapse",
    family: "identity_exposure",
    mechanism: "curated_aesthetic_one_reveal",
    tension: "curated aesthetic vs. one revealing detail in the same frame",
    description:
      "User maintains a curated aesthetic. ONE detail in the shot exposes the truth.",
    generatorRule:
      "Generate a beat where the user is staging or showing a curated aesthetic moment (clean girl coffee, soft minimalist desk, elevated dinner) and ONE small detail in the same frame contradicts everything (an empty wrapper, a chaotic cable nest, a screaming pile in the corner).",
    compatibleDomains: ["aesthetic", "home", "content", "self_image"],
    compatiblePremiseStyles: [
      "delusion_downfall",
      "main_character_meltdown",
      "cart_autopsy",
    ],
    examples: [
      "soft minimalist desk → just out of frame: 9 mugs",
      "clean girl morning → reflection in mug: it's 2pm",
    ],
    antiCopyHints: [
      "avoid 'clean girl' verbatim more than once per batch",
      "do not reuse '9 mugs' as the contradiction",
    ],
  },
  {
    id: "identity_exposure_taste_betrayal",
    family: "identity_exposure",
    mechanism: "refined_taste_vs_guilty_pleasure",
    tension: "refined taste publicly, guilty pleasure privately",
    description:
      "User claims refined taste; one fact about their actual private consumption ruins it.",
    generatorRule:
      "Generate a beat where the user states a refined taste claim (music, food, books, film) and the contradiction is one specific item that destroys it (a song on repeat, a snack drawer, a guilty rewatch). The specific item must be embarrassing-specific, not generic.",
    compatibleDomains: ["music", "food", "media", "fashion"],
    compatiblePremiseStyles: [
      "hypocrisy_hyperdrive",
      "delusion_downfall",
      "chaos_confession",
    ],
    examples: [
      "i only listen to jazz → spotify wrapped: 'baby shark x47'",
      "elevated palate → freezer: 11 bagel bites",
    ],
    antiCopyHints: [
      "avoid 'baby shark' verbatim",
      "do not reuse 'spotify wrapped' as the reveal more than once per batch",
    ],
  },
  {
    id: "identity_exposure_routine_lie",
    family: "identity_exposure",
    mechanism: "claimed_routine_vs_day_one",
    tension: "claim a long-running routine, reveal it's day one (or none)",
    description:
      "User claims a healthy/disciplined routine. The truth is it's day one — or it never started.",
    generatorRule:
      "Generate a beat where the user claims a long-running routine (5am gym, daily journaling, sober october) and the punch reveals the actual count: day 1, day 0, or 'i thought about starting it.' The contrast must be the very next beat.",
    compatibleDomains: ["fitness", "wellness", "habits", "discipline"],
    compatiblePremiseStyles: ["fake_confidence", "delusion_spiral", "hypocrisy_hyperdrive"],
    examples: [
      "i'm a 5am person → today: day 1, again",
      "daily journal practice → opens to: blank",
    ],
    antiCopyHints: [
      "avoid '5am' verbatim more than once per batch",
      "do not reuse 'opens to blank' as the visual punch",
    ],
  },
  {
    id: "identity_exposure_competence_gap",
    family: "identity_exposure",
    mechanism: "expert_in_X_amateur_in_adjacent",
    tension: "deep expertise in one area, basic incompetence in the obvious neighbor",
    description:
      "User is an expert in one specific thing. The basic adjacent skill exposes them.",
    generatorRule:
      "Generate a beat where the user demonstrates real expertise in a niche area (technical, professional, creative) and is then shown failing at a much more basic adjacent skill (engineer who can't fold a fitted sheet, michelin chef who can't open a yogurt). Both must be visible.",
    compatibleDomains: ["work", "skills", "household", "tech"],
    compatiblePremiseStyles: ["pattern_exposure", "fake_confidence", "delusion_downfall"],
    examples: [
      "writes distributed systems → microwave timer: still flashing 12:00",
      "phd in econ → splits the bill on a calculator twice",
    ],
    antiCopyHints: [
      "avoid 'distributed systems' verbatim",
      "do not reuse 'microwave 12:00' as the contradiction",
    ],
  },
  {
    id: "identity_exposure_age_marker",
    family: "identity_exposure",
    mechanism: "behavior_reveals_real_age",
    tension: "one behavior betrays the age you actually are vs. the age you act",
    description:
      "User performs as a different age than they are. ONE habit instantly reveals the real one.",
    generatorRule:
      "Generate a beat where the user is performing a younger or older identity (slang, music, energy) and one specific habit instantly outs the real age (groans getting up, knows obscure song from 2003, asks where the 'volume button' is). The reveal must be a single beat.",
    compatibleDomains: ["age", "identity", "music", "tech_literacy"],
    compatiblePremiseStyles: ["pattern_exposure", "duality_clash", "delusion_spiral"],
    examples: [
      "tries to use slang → groans audibly bending over",
      "claims gen z → goes to find the 'app store' on tv remote",
    ],
    antiCopyHints: [
      "avoid 'gen z' verbatim more than once per batch",
      "do not reuse the literal 'groans bending over' beat",
    ],
  },
];

// Module-load invariant — this file is the single source of truth
// for the 40-core spec. If a future edit drifts the count we want
// the server to refuse to boot rather than silently ship 39 cores.
if (CORES_RAW.length !== 40) {
  throw new Error(
    `[premiseCoreLibrary] expected exactly 40 cores, got ${CORES_RAW.length}`,
  );
}

// Per-family count invariant — 5 cores per family × 8 families.
{
  const counts = new Map<PremiseCoreFamily, number>();
  for (const c of CORES_RAW) {
    counts.set(c.family, (counts.get(c.family) ?? 0) + 1);
  }
  for (const fam of PREMISE_CORE_FAMILIES) {
    const n = counts.get(fam) ?? 0;
    if (n !== 5) {
      throw new Error(
        `[premiseCoreLibrary] family "${fam}" must have exactly 5 cores, got ${n}`,
      );
    }
  }
}

// Stable id uniqueness invariant.
{
  const seen = new Set<string>();
  for (const c of CORES_RAW) {
    if (seen.has(c.id)) {
      throw new Error(`[premiseCoreLibrary] duplicate core id: ${c.id}`);
    }
    seen.add(c.id);
  }
}

// Validate that every `compatiblePremiseStyles` entry is a real
// PremiseStyleId — protects against typos when new cores are added.
{
  const styleSet: ReadonlySet<string> = new Set<string>(PREMISE_STYLE_IDS);
  for (const c of CORES_RAW) {
    for (const s of c.compatiblePremiseStyles) {
      if (!styleSet.has(s)) {
        throw new Error(
          `[premiseCoreLibrary] core "${c.id}" references unknown premiseStyleId "${s}"`,
        );
      }
    }
  }
}

export const PREMISE_CORES: readonly PremiseCore[] = Object.freeze(CORES_RAW);

const CORES_BY_ID: ReadonlyMap<string, PremiseCore> = (() => {
  const m = new Map<string, PremiseCore>();
  for (const c of PREMISE_CORES) m.set(c.id, c);
  return m;
})();

export function getPremiseCoreById(id: string): PremiseCore | undefined {
  return CORES_BY_ID.get(id);
}

// ---------------------------------------------------------------- //
// Selection                                                         //
// ---------------------------------------------------------------- //

export type SelectPremiseCoresOptions = {
  /** How many cores to return (one per idea the LLM will produce,
   *  typically `desiredCount + small headroom`). Clamped to [1, 40]. */
  count: number;
  /** Core ids drawn from recently-shipped batches — selection
   *  heavily down-weights these to satisfy spec PART 7
   *  ("heavily penalize repeating mechanism", "ensure at least
   *  1 fresh core in each batch"). */
  recentCoreIds?: ReadonlySet<string>;
  /** Mechanism strings drawn from recently-shipped batches.
   *  Same-mechanism cores get an additional penalty even if the
   *  exact id rotates. */
  recentMechanisms?: ReadonlySet<string>;
  /** Deterministic RNG seam for tests. Defaults to Math.random. */
  rng?: () => number;
};

export type SelectPremiseCoresResult = {
  cores: PremiseCore[];
  /** Whether the result satisfies "≥1 fresh core" — true when at
   *  least one returned core's id is NOT in `recentCoreIds`, OR
   *  when `recentCoreIds` was empty/undefined (cold-start). */
  hasFreshCore: boolean;
};

/**
 * Weighted, anti-recent, family-rotating core selection.
 *
 * Algorithm (deterministic given a fixed `rng`):
 *   1. For each candidate core, compute a base weight from its
 *      family's DefaultTaste mechanism mapping (see
 *      FAMILY_DEFAULT_TASTE_WEIGHT above).
 *   2. Apply demotion if its id is in `recentCoreIds` (×0.2).
 *   3. Apply demotion if its mechanism string is in
 *      `recentMechanisms` (×0.4) — stacks with id demotion.
 *   4. Pick `count` cores via weighted-without-replacement
 *      sampling. After each pick, lightly demote the picked core's
 *      family for subsequent picks (×0.5) to encourage rotation
 *      within a single batch.
 *   5. If after the picks the result contains no "fresh" core
 *      (one whose id is not in `recentCoreIds`) AND the catalog
 *      has at least one fresh option, swap the lowest-weighted
 *      pick for the highest-weighted fresh option not yet picked.
 */
export function selectPremiseCores(
  opts: SelectPremiseCoresOptions,
): SelectPremiseCoresResult {
  const rng = opts.rng ?? Math.random;
  const count = Math.max(1, Math.min(40, Math.floor(opts.count)));
  const recentIds = opts.recentCoreIds ?? new Set<string>();
  const recentMechs = opts.recentMechanisms ?? new Set<string>();

  // Working pool of {core, weight}. Weight starts at the family's
  // taste-bias and is mutated by demotions.
  type Entry = { core: PremiseCore; weight: number };
  const pool: Entry[] = PREMISE_CORES.map((core) => {
    let w = FAMILY_DEFAULT_TASTE_WEIGHT[core.family];
    if (recentIds.has(core.id)) w *= 0.2;
    if (recentMechs.has(core.mechanism)) w *= 0.4;
    return { core, weight: Math.max(w, 0.01) }; // never zero
  });

  const familyDemotion = new Map<PremiseCoreFamily, number>();
  const picked: PremiseCore[] = [];
  const pickedIds = new Set<string>();

  for (let i = 0; i < count && pool.length > 0; i++) {
    // Apply per-pick family demotion on top of the stored weight.
    let total = 0;
    const weighted = pool.map((e) => {
      const famMul = familyDemotion.get(e.core.family) ?? 1;
      const w = e.weight * famMul;
      total += w;
      return w;
    });
    if (total <= 0) break;

    let r = rng() * total;
    let idx = 0;
    for (let j = 0; j < weighted.length; j++) {
      r -= weighted[j];
      if (r <= 0) {
        idx = j;
        break;
      }
    }

    const chosen = pool[idx].core;
    picked.push(chosen);
    pickedIds.add(chosen.id);
    // Remove from pool (without-replacement) and demote the family.
    pool.splice(idx, 1);
    familyDemotion.set(
      chosen.family,
      (familyDemotion.get(chosen.family) ?? 1) * 0.5,
    );
  }

  // ≥1 fresh core invariant — only enforce when there's a recent
  // history to be fresh-vs.
  const hasFreshAlready =
    recentIds.size === 0 || picked.some((c) => !recentIds.has(c.id));
  let hasFreshCore = hasFreshAlready;

  if (!hasFreshAlready && recentIds.size > 0) {
    // Find the highest-effective-weighted unpicked core whose id is
    // not in recentIds; swap it for the lowest-effective-weighted
    // picked core. "Effective weight" = the same composite the main
    // sampler uses (family taste × id-recency × mechanism-recency ×
    // accumulated per-pick family demotion). Using the full effective
    // weight (instead of raw FAMILY_DEFAULT_TASTE_WEIGHT) keeps the
    // swap aligned with the rest of the picker — a fresh-but-tired
    // family can't displace a higher-utility pick just because its
    // raw family bias is heavier; symmetrically, a picked core whose
    // recency penalties already softened it is the correct eviction
    // target. A fresh candidate's id is by definition NOT in
    // recentIds (the filter above guarantees it), so the id-recency
    // factor for fresh candidates is always 1.0 — but we still apply
    // the mechanism-recency + family-demotion factors which can
    // legitimately differ.
    const effectiveWeight = (c: PremiseCore): number => {
      let w = FAMILY_DEFAULT_TASTE_WEIGHT[c.family];
      if (recentIds.has(c.id)) w *= 0.2;
      if (recentMechs.has(c.mechanism)) w *= 0.4;
      const famMul = familyDemotion.get(c.family) ?? 1;
      w *= famMul;
      return Math.max(w, 0.01);
    };
    const freshCandidates = PREMISE_CORES.filter(
      (c) => !recentIds.has(c.id) && !pickedIds.has(c.id),
    );
    if (freshCandidates.length > 0) {
      // Pick the fresh candidate with the highest effective weight.
      let bestFresh: PremiseCore = freshCandidates[0];
      let bestW = effectiveWeight(bestFresh);
      for (let i = 1; i < freshCandidates.length; i++) {
        const w = effectiveWeight(freshCandidates[i]);
        if (w > bestW) {
          bestW = w;
          bestFresh = freshCandidates[i];
        }
      }
      // Find the picked entry with the lowest effective weight to
      // swap out.
      let worstIdx = 0;
      let worstW = effectiveWeight(picked[0]);
      for (let i = 1; i < picked.length; i++) {
        const w = effectiveWeight(picked[i]);
        if (w < worstW) {
          worstW = w;
          worstIdx = i;
        }
      }
      pickedIds.delete(picked[worstIdx].id);
      picked[worstIdx] = bestFresh;
      pickedIds.add(bestFresh.id);
      hasFreshCore = true;
    }
  }

  return { cores: picked, hasFreshCore };
}

// ---------------------------------------------------------------- //
// Prompt rendering                                                  //
// ---------------------------------------------------------------- //

/**
 * Render a list of cores as a SYSTEM-prompt block the LLM injects
 * into its premise-first reasoning step. Format: each core listed
 * with its rule, mechanism, tension, anti-copy hints, and a
 * forbidden-phrasings line built from `examples` (since examples
 * are anti-copy seeds — never to be regurgitated).
 *
 * Output is plain text. Caller is responsible for placing it into
 * the surrounding prompt at the right position.
 */
export function formatPremiseCoresForPrompt(
  cores: readonly PremiseCore[],
): string {
  if (cores.length === 0) return "";
  const lines: string[] = [];
  lines.push("PREMISE CORE LIBRARY — pick ONE core per idea.");
  lines.push(
    "For each idea: (1) pick a core from the list, (2) write the `premise` sentence USING that core's generatorRule, (3) derive `hook`, `whatToShow`, and `howToFilm` so they ALL enact the SAME premise, (4) emit the chosen core's id in `premiseCoreId`.",
  );
  lines.push(
    "STRICT: do NOT regurgitate the example phrasings — they are forbidden seeds shown to clarify shape only.",
  );
  lines.push("");
  for (const c of cores) {
    lines.push(`• core id: ${c.id}`);
    lines.push(`  family: ${c.family}`);
    lines.push(`  mechanism: ${c.mechanism}`);
    lines.push(`  tension: ${c.tension}`);
    lines.push(`  rule: ${c.generatorRule}`);
    if (c.compatibleDomains.length > 0) {
      lines.push(`  domains: ${c.compatibleDomains.join(", ")}`);
    }
    if (c.examples.length > 0) {
      lines.push(
        `  forbidden seed phrasings (DO NOT REUSE): ${c.examples
          .map((e) => `"${e}"`)
          .join(" | ")}`,
      );
    }
    if (c.antiCopyHints.length > 0) {
      lines.push(`  anti-copy: ${c.antiCopyHints.join("; ")}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

// ---------------------------------------------------------------- //
// Test seam                                                         //
// ---------------------------------------------------------------- //

/**
 * Module exports a frozen catalog with no module-scope mutable
 * state, so no reset is needed today. The export is provided as a
 * forward-compat seam so test code can call it without breaking
 * if future selection caching is added here.
 */
export function _resetPremiseCoreStateForTests(): void {
  // intentionally empty — see comment above
}
