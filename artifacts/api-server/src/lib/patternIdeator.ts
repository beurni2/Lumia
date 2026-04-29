/**
 * Layer 1 of the Hybrid Ideator Pipeline — pattern + variation engine.
 *
 * NO AI. NO DB. Pure deterministic TS.
 *
 * Produces 12–20 candidate Ideas locally from a small library of
 * reusable viral structures (denial_loop / expectation_vs_reality /
 * small_panic / avoidance / social_awareness / routine_contradiction)
 * crossed with a safe pool of low-effort scenarios (sleep / coffee /
 * gym / laundry / texting / etc.) and rotated across five hook styles
 * (the_way_i / why_do_i / internal_thought / contrast / curiosity).
 *
 * Output candidates fully validate against `ideaSchema` from
 * `ideaGen.ts` so the public API contract is unchanged. Source
 * tracking + scenario family lives in a parallel `meta[]` array
 * (returned alongside the ideas) so the downstream ranker can prefer
 * pattern_variation on score ties without polluting the public Idea.
 *
 * Design notes:
 *   • All scenarios are explicitly safe — no bank apps / DMs / IDs /
 *     medical data / addresses / passwords / salary. Privacy is
 *     enforced at the source, not by post-hoc filtering.
 *   • Memory bias: top structure / hookStyle / emotionalSpike from
 *     the per-creator viral pattern memory get oversampled; ~25% of
 *     the batch is intentionally "adjacent exploration" so we don't
 *     calcify on a single shape.
 *   • Repetition is penalised, not banned — recently accepted
 *     scenario families get a soft demotion in the ranking pool.
 *   • Hook style rotation is enforced inside a single batch — we
 *     never return all "the way I…" candidates even if memory
 *     overwhelmingly prefers it.
 */

import {
  EMOTIONAL_SPIKES,
  HOOK_STYLES,
  STRUCTURES,
  type EmotionalSpike,
  type Format,
  type HookStyle,
  type Structure,
  type ViralPatternMemory,
} from "./viralPatternMemory";
import { deriveTone, type DerivedTone, type StyleProfile } from "./styleProfile";
import type { Idea } from "./ideaGen";

// -----------------------------------------------------------------------------
// Templates — reusable viral idea SHAPES
// -----------------------------------------------------------------------------

type TemplateId =
  | "denial_loop"
  | "expectation_vs_reality"
  | "small_panic"
  | "avoidance"
  | "social_awareness"
  | "routine_contradiction";

type Template = {
  id: TemplateId;
  structure: Structure;
  pattern: Format;
  emotionalSpike: EmotionalSpike;
  payoffType: "reveal" | "reaction" | "transformation" | "punchline";
  hasContrast: boolean;
  templateHint: "A" | "B" | "C" | "D";
};

const TEMPLATES: Template[] = [
  {
    id: "denial_loop",
    structure: "denial_loop",
    pattern: "mini_story",
    emotionalSpike: "denial",
    payoffType: "reaction",
    hasContrast: true,
    templateHint: "B",
  },
  {
    id: "expectation_vs_reality",
    structure: "expectation_vs_reality",
    pattern: "contrast",
    emotionalSpike: "irony",
    payoffType: "reveal",
    hasContrast: true,
    templateHint: "A",
  },
  {
    id: "small_panic",
    structure: "small_panic",
    pattern: "reaction",
    emotionalSpike: "panic",
    payoffType: "reaction",
    hasContrast: false,
    templateHint: "C",
  },
  {
    id: "avoidance",
    structure: "avoidance",
    pattern: "mini_story",
    emotionalSpike: "regret",
    payoffType: "reaction",
    hasContrast: false,
    templateHint: "B",
  },
  {
    id: "social_awareness",
    structure: "social_awareness",
    pattern: "pov",
    emotionalSpike: "embarrassment",
    payoffType: "reaction",
    hasContrast: false,
    templateHint: "C",
  },
  {
    id: "routine_contradiction",
    structure: "routine_contradiction",
    pattern: "contrast",
    emotionalSpike: "irony",
    payoffType: "reveal",
    hasContrast: true,
    templateHint: "A",
  },
];

// -----------------------------------------------------------------------------
// Scenario pool — safe, low-effort, filmable
// -----------------------------------------------------------------------------

type TriggerCategory =
  | "phone_screen"
  | "message"
  | "social"
  | "environment"
  | "self_check"
  | "task";

type Setting =
  | "bed"
  | "couch"
  | "desk"
  | "bathroom"
  | "kitchen"
  | "car"
  | "outside"
  | "other";

export type Scenario = {
  family: string;
  triggerCategory: TriggerCategory;
  setting: Setting;
  /** SHORT verb phrase used in hooks ("sleep early", "go to the gym"). */
  actionShort: string;
  /** SHORT contradiction the reality lands on ("it's 3am scrolling"). */
  realityShort: string;
  /** Filled into `trigger` — specific observable action on screen. */
  trigger: string;
  /** Filled into `reaction` — visible micro-expression / body beat. */
  reaction: string;
  /** Filled into `visualHook` — cinematic detail for the trust card. */
  visualHook: string;
  /** Estimated end-to-end filming time in minutes. ≤30. */
  filmingMin: number;
  /** A concrete object/topic noun ("the gym bag", "the fridge", "your phone"). */
  topicNoun: string;
};

const SCENARIOS: Scenario[] = [
  {
    family: "sleep",
    triggerCategory: "phone_screen",
    setting: "bed",
    actionShort: "sleep early",
    realityShort: "it's 3am scrolling",
    trigger: "checks the clock thinking it's still 11pm",
    reaction: "frozen face, slow blink, then back to scrolling",
    visualHook: "phone glow on face in dark room, eyes dart to clock",
    filmingMin: 5,
    topicNoun: "the clock",
  },
  {
    family: "coffee",
    triggerCategory: "task",
    setting: "kitchen",
    actionShort: "make coffee at home today",
    realityShort: "ordering a $7 latte anyway",
    trigger: "stares at the empty French press, then grabs car keys",
    reaction: "slow head shake, then a small guilty smile to camera",
    visualHook: "untouched coffee gear on the counter, keys jingle",
    filmingMin: 6,
    topicNoun: "the coffee",
  },
  {
    family: "gym",
    triggerCategory: "self_check",
    setting: "bed",
    actionShort: "go to the gym",
    realityShort: "the gym bag never moves",
    trigger: "looks at the gym bag packed three days ago",
    reaction: "deadpan stare, then turns back to the couch",
    visualHook: "gym bag in same spot, dust visible on the strap",
    filmingMin: 4,
    topicNoun: "the gym bag",
  },
  {
    family: "laundry",
    triggerCategory: "environment",
    setting: "bed",
    actionShort: "fold the laundry today",
    realityShort: "wearing the wrinkled shirt",
    trigger: "pulls a shirt from the laundry mountain and shrugs",
    reaction: "squints at the wrinkles, decides it's fine",
    visualHook: "laundry pile on the chair, shirt held up to the light",
    filmingMin: 4,
    topicNoun: "the laundry",
  },
  {
    family: "texting",
    triggerCategory: "message",
    setting: "couch",
    actionShort: "reply to that text",
    realityShort: "letting it sit for 4 days",
    trigger: "opens the unread thread, types nothing, closes it",
    reaction: "the 'I'll do it later' sigh, lock screen, deadpan",
    visualHook: "thumb hovers over the keyboard, then locks the screen",
    filmingMin: 3,
    topicNoun: "the unread text",
  },
  {
    family: "emails",
    triggerCategory: "phone_screen",
    setting: "desk",
    actionShort: "clear my inbox",
    realityShort: "marking everything read instead",
    trigger: "scrolls past 47 unread emails and taps select-all",
    reaction: "the 'mark all as read' satisfied face, then panic",
    visualHook: "thumb sweeps across the inbox, the unread count drops to zero",
    filmingMin: 4,
    topicNoun: "the inbox",
  },
  {
    family: "fridge",
    triggerCategory: "environment",
    setting: "kitchen",
    actionShort: "cook tonight",
    realityShort: "opening DoorDash again",
    trigger: "stares into the fridge, closes it slowly",
    reaction: "small lip-bite, opens the food-delivery app",
    visualHook: "fridge door open on bare shelves, light on the face",
    filmingMin: 4,
    topicNoun: "the fridge",
  },
  {
    family: "outfit",
    triggerCategory: "self_check",
    setting: "bed",
    actionShort: "wear something new today",
    realityShort: "the same hoodie again",
    trigger: "stands in front of the closet, grabs the hoodie",
    reaction: "the resigned shrug into the mirror",
    visualHook: "closet open, hand goes straight past everything to the hoodie",
    filmingMin: 4,
    topicNoun: "the closet",
  },
  {
    family: "errands",
    triggerCategory: "task",
    setting: "car",
    actionShort: "knock out all my errands",
    realityShort: "doing one and going home",
    trigger: "starts the car, looks at the errand list, sighs",
    reaction: "crosses off one thing, drives home, deadpan to camera",
    visualHook: "list on the dashboard with one item crossed off",
    filmingMin: 8,
    topicNoun: "the errand list",
  },
  {
    family: "weekend_plans",
    triggerCategory: "message",
    setting: "couch",
    actionShort: "go out this weekend",
    realityShort: "cancelling Friday afternoon",
    trigger: "rereads the group chat plans, types 'so sorry rain check'",
    reaction: "soft smile of relief, settles deeper into the blanket",
    visualHook: "thumb hits send, blanket pulled up to the chin",
    filmingMin: 3,
    topicNoun: "the group chat",
  },
  {
    family: "productivity",
    triggerCategory: "phone_screen",
    setting: "desk",
    actionShort: "actually focus today",
    realityShort: "two hours of TikTok",
    trigger: "opens the to-do app, immediately swipes to TikTok",
    reaction: "catches own reflection in the screen, doesn't stop scrolling",
    visualHook: "to-do list flashes on screen, then the For You feed",
    filmingMin: 4,
    topicNoun: "the to-do app",
  },
  {
    family: "cleaning",
    triggerCategory: "environment",
    setting: "bed",
    actionShort: "deep clean the room",
    realityShort: "moving one pile to a different chair",
    trigger: "picks up the pile from the chair, sets it on the bed",
    reaction: "stares at the new pile, calls it productive",
    visualHook: "same pile, different surface — wide shot of the room",
    filmingMin: 5,
    topicNoun: "the pile",
  },
  {
    family: "social_call",
    triggerCategory: "social",
    setting: "kitchen",
    actionShort: "answer like a normal person",
    realityShort: "the awkward over-laugh",
    trigger: "neighbour says hi in the hallway, autopilot kicks in",
    reaction: "the too-loud laugh, then the slow walk away cringe",
    visualHook: "wave goodbye, then the cringe-walk back to the door",
    filmingMin: 3,
    topicNoun: "the hallway",
  },
  {
    family: "snack",
    triggerCategory: "task",
    setting: "kitchen",
    actionShort: "stop snacking after dinner",
    realityShort: "back in the pantry by 9pm",
    trigger: "opens the pantry, pretends to look for something specific",
    reaction: "the 'I'm just checking' face, hand emerges with chips",
    visualHook: "pantry door open, chip bag in hand, casual exit",
    filmingMin: 3,
    topicNoun: "the pantry",
  },
  {
    family: "hydration",
    triggerCategory: "self_check",
    setting: "desk",
    actionShort: "drink more water",
    realityShort: "the water bottle is full from yesterday",
    trigger: "picks up the water bottle from this morning, still full",
    reaction: "the slow guilty look at the bottle, sets it back down",
    visualHook: "water bottle from yesterday, condensation gone",
    filmingMin: 3,
    topicNoun: "the water bottle",
  },
  {
    family: "morning",
    triggerCategory: "phone_screen",
    setting: "bed",
    actionShort: "wake up at 6am",
    realityShort: "snoozing until 9:47",
    trigger: "the alarm rings, hand reaches out without looking",
    reaction: "the swipe-to-snooze, eyes never open",
    visualHook: "alarm screen, hand swipes, screen goes dark",
    filmingMin: 3,
    topicNoun: "the alarm",
  },
  {
    family: "shopping",
    triggerCategory: "phone_screen",
    setting: "couch",
    actionShort: "stop online shopping",
    realityShort: "three new tabs open",
    trigger: "closes the cart, opens it again 90 seconds later",
    reaction: "the 'just looking' face, taps add to cart anyway",
    visualHook: "cart count goes from 0 to 1 to 3 in one shot",
    filmingMin: 4,
    topicNoun: "the shopping cart",
  },
  {
    family: "social_post",
    triggerCategory: "phone_screen",
    setting: "couch",
    actionShort: "stop checking my likes",
    realityShort: "refreshing the post every 4 minutes",
    trigger: "drags down to refresh the feed for the fifth time",
    reaction: "the small disappointed nose-exhale, locks the screen",
    visualHook: "pull-to-refresh animation loops, like count unchanged",
    filmingMin: 3,
    topicNoun: "the post",
  },
  {
    family: "dishes",
    triggerCategory: "environment",
    setting: "kitchen",
    actionShort: "do the dishes tonight",
    realityShort: "pushing them aside for tomorrow",
    trigger: "looks at the sink, decides 'morning me will handle it'",
    reaction: "the slow turn away, lights off, exit the room",
    visualHook: "sink full of dishes, kitchen light clicks off",
    filmingMin: 3,
    topicNoun: "the sink",
  },
  {
    family: "podcast",
    triggerCategory: "task",
    setting: "car",
    actionShort: "learn something on my commute",
    realityShort: "same playlist for the 40th time",
    trigger: "opens the podcast app, immediately switches to Spotify",
    reaction: "the 'next time' nod, presses play on the usual playlist",
    visualHook: "podcast app closes, Spotify opens, familiar cover art",
    filmingMin: 3,
    topicNoun: "the podcast app",
  },
];

// -----------------------------------------------------------------------------
// Hook-style phrasing pools
// -----------------------------------------------------------------------------

export type HookPhraseFn = (s: Scenario) => string;

export const HOOK_PHRASINGS_BY_STYLE: Record<HookStyle, HookPhraseFn[]> = {
  the_way_i: [
    (s) => `the way I said I'd ${s.actionShort} and ${s.realityShort}`,
    (s) => `the way I act like ${s.topicNoun} doesn't exist`,
    (s) => `the way I keep promising to ${s.actionShort}`,
  ],
  why_do_i: [
    (s) => `why do I say I'll ${s.actionShort} like I don't know myself`,
    (s) => `why did I think I'd ${s.actionShort} this time`,
    (s) => `why do I keep lying to myself about ${s.topicNoun}`,
  ],
  internal_thought: [
    (s) => `I really said I'd ${s.actionShort} and ${s.realityShort}`,
    (s) => `I really just ignored ${s.topicNoun} like it would disappear`,
    (s) => `me saying I'm done with this — ${s.realityShort}`,
  ],
  contrast: [
    (s) => `me saying I'll ${s.actionShort} vs me ${s.realityShort}`,
    (s) => `what I planned vs ${s.realityShort}`,
    (s) => `how I thought today would go vs ${s.realityShort}`,
  ],
  curiosity: [
    (s) => `this is where my plan to ${s.actionShort} fell apart`,
    (s) => `nobody warned me ${s.actionShort} would go like this`,
    (s) => `POV: you said you'd ${s.actionShort} this morning`,
  ],
};

// -----------------------------------------------------------------------------
// Caption phrasings keyed off structure
// -----------------------------------------------------------------------------

const CAPTION_PHRASINGS: Record<Structure, ((s: Scenario) => string)[]> = {
  denial_loop: [
    (s) => `lying to myself about ${s.topicNoun} is a full-time job`,
    () => `the trick is to never look directly at the problem`,
    () => `my self-discipline expires after 11am`,
  ],
  expectation_vs_reality: [
    () => `the gap between morning me and night me is unwell`,
    (s) => `${s.actionShort} → in theory only`,
    () => `every day a fresh tragedy in two acts`,
  ],
  small_panic: [
    () => `the quiet freakout is the only freakout I do`,
    () => `internal scream, external nothing`,
    (s) => `${s.topicNoun} sent me into orbit`,
  ],
  avoidance: [
    (s) => `${s.topicNoun} and I are not on speaking terms`,
    () => `if I ignore it long enough it becomes someone else's problem`,
    () => `the to-do list is more of a suggestion`,
  ],
  social_awareness: [
    () => `every social interaction is a fresh humbling`,
    () => `replaying that one in my head until 2026`,
    () => `I do NOT know how to be a person`,
  ],
  self_callout: [
    () => `caught myself in the act and just kept going`,
    () => `the call is coming from inside the house`,
    () => `me, watching me, being like this`,
  ],
  routine_contradiction: [
    (s) => `said no more ${s.topicNoun}. immediately went back to ${s.topicNoun}`,
    () => `consistency is my brand and that brand is hypocrisy`,
    () => `the rules I make for myself are decorative`,
  ],
};

// -----------------------------------------------------------------------------
// Tone-aware phrasing tweak (light — never overrides structure)
// -----------------------------------------------------------------------------

function toneInflect(hook: string, tone: DerivedTone): string {
  if (tone === "chaotic") return hook;
  if (tone === "dry") return hook.replace(/\!/g, "");
  return hook;
}

// -----------------------------------------------------------------------------
// Assembler — Template × Scenario × HookStyle → full Idea
// -----------------------------------------------------------------------------

function pickPhrasing<T>(arr: T[], seed: number): T {
  // Defensive double-modulo: collapse any (possibly negative) seed into
  // a valid array index. Pairs with the unsigned-coerced seedSalt in
  // generatePatternCandidates so `arr[idx]` can never be undefined.
  const n = arr.length;
  const idx = ((seed % n) + n) % n;
  return arr[idx]!;
}

function buildScript(template: Template, scenario: Scenario, hook: string): string {
  // Three-beat micro-script: hook → trigger → reaction.
  // Bounded to fit the 10–800 char schema window.
  return [
    `0–2s — On screen text: "${hook}"`,
    `2–10s — ${scenario.trigger}.`,
    `10–${15 + (template.hasContrast ? 5 : 3)}s — ${scenario.reaction}.`,
  ].join(" ");
}

function buildShotPlan(template: Template, scenario: Scenario): string[] {
  // 2–4 shots — depends on pattern. Keep each terse (<=160 chars).
  const base = [
    `Wide on ${scenario.setting} — ${scenario.visualHook}.`,
    `Tight on the face for the reaction beat — hold for 1.5s.`,
  ];
  if (template.pattern === "contrast") {
    base.splice(
      1,
      0,
      `Cut to the contradiction — same setup, opposite outcome.`,
    );
  }
  if (template.pattern === "mini_story") {
    base.push(`Closing beat — small wordless reaction to camera.`);
  }
  return base;
}

function buildWhatToShow(scenario: Scenario, template: Template): string {
  // 20–500 chars — beat-by-beat, plain English.
  return (
    `Open on you in the ${scenario.setting}. ${scenario.trigger}. ` +
    `Beat. Then the reaction lands: ${scenario.reaction}. ` +
    (template.hasContrast
      ? `Cut between what you said you'd do and what you actually did. End on the deadpan. `
      : `Hold the reaction beat — let it breathe before cutting. `) +
    `Total runtime feels like a single thought, not a story.`
  );
}

function buildHowToFilm(scenario: Scenario): string {
  // 15–400 chars — concrete filming instructions.
  return (
    `Phone propped at chest height in the ${scenario.setting} — single take, ` +
    `no edits. Natural light. Don't perform the reaction; just react to the ` +
    `trigger as if no one's filming. One re-take if the timing feels off.`
  );
}

function buildWhyItWorks(template: Template, scenario: Scenario): string {
  // 2–280 chars.
  return (
    `${capitalize(template.structure.replaceAll("_", " "))} on a universal ` +
    `${scenario.family} moment — viewers recognise the loop and the ` +
    `${template.emotionalSpike} spike lands without explanation.`
  );
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

function clampHookWords(hook: string): string {
  // Schema enforces ≤10 words. Trim hard if a phrasing variant slips
  // past 10 (rare but possible with longer scenarios).
  const words = hook.trim().split(/\s+/);
  if (words.length <= 10) return hook.trim();
  return words.slice(0, 10).join(" ");
}

export type PatternMeta = {
  source: "pattern_variation";
  templateId: TemplateId;
  scenarioFamily: string;
  hookStyle: HookStyle;
  hookPhrasingIndex: number;
  /**
   * Reference to the source scenario so the rewriter can produce
   * alternative hook phrasings without a separate lookup table.
   * Optional so future non-pattern sources (e.g. Llama fallback)
   * can omit it.
   */
  scenario?: Scenario;
};

function assembleCandidate(
  template: Template,
  scenario: Scenario,
  hookStyle: HookStyle,
  tone: DerivedTone,
  hookPhrasingIndex: number,
  captionPhrasingIndex: number,
): { idea: Idea; meta: PatternMeta } {
  const phrasings = HOOK_PHRASINGS_BY_STYLE[hookStyle];
  const phrasingFn = pickPhrasing(phrasings, hookPhrasingIndex);
  const hook = clampHookWords(toneInflect(phrasingFn(scenario), tone));

  const captionPhrasings = CAPTION_PHRASINGS[template.structure];
  const caption = pickPhrasing(captionPhrasings, captionPhrasingIndex)(scenario);

  const idea: Idea = {
    pattern: template.pattern,
    hook,
    hookSeconds: 1.5,
    trigger: scenario.trigger,
    reaction: scenario.reaction,
    emotionalSpike: template.emotionalSpike,
    structure: template.structure,
    hookStyle,
    triggerCategory: scenario.triggerCategory,
    setting: scenario.setting,
    script: buildScript(template, scenario, hook),
    shotPlan: buildShotPlan(template, scenario),
    caption,
    templateHint: template.templateHint,
    contentType: "lifestyle",
    videoLengthSec: template.hasContrast ? 18 : 16,
    filmingTimeMin: scenario.filmingMin,
    whyItWorks: buildWhyItWorks(template, scenario),
    payoffType: template.payoffType,
    hasContrast: template.hasContrast,
    hasVisualAction: true,
    visualHook: scenario.visualHook,
    whatToShow: buildWhatToShow(scenario, template),
    howToFilm: buildHowToFilm(scenario),
  };

  return {
    idea,
    meta: {
      source: "pattern_variation",
      templateId: template.id,
      scenarioFamily: scenario.family,
      hookStyle,
      hookPhrasingIndex,
      scenario,
    },
  };
}

// -----------------------------------------------------------------------------
// Memory bias helpers
// -----------------------------------------------------------------------------

function topKey<K extends string>(
  tally: Record<string, number> | undefined,
  enumValues: readonly K[],
): K | null {
  if (!tally) return null;
  let best: { k: K; v: number } | null = null;
  for (const k of enumValues) {
    const v = tally[k] ?? 0;
    if (v > 0 && (best === null || v > best.v)) best = { k, v };
  }
  return best?.k ?? null;
}

function topStructure(memory: ViralPatternMemory): Structure | null {
  return topKey(memory.structures, STRUCTURES);
}

function topHookStyle(memory: ViralPatternMemory): HookStyle | null {
  return topKey(memory.hookStyles, HOOK_STYLES);
}

function topSpike(memory: ViralPatternMemory): EmotionalSpike | null {
  return topKey(memory.emotionalSpikes, EMOTIONAL_SPIKES);
}

// -----------------------------------------------------------------------------
// Public entry point
// -----------------------------------------------------------------------------

export type GeneratePatternCandidatesInput = {
  /** Target candidate count — capped to [12, 20]. */
  count?: number;
  profile: StyleProfile;
  memory: ViralPatternMemory;
  /** Soft penalty: scenarios in these families get demoted. */
  recentScenarios?: string[];
  /** When true, shift the deterministic seed so we don't repeat yesterday. */
  regenerate?: boolean;
  /**
   * Caller-supplied cursor that varies the (template, scenario, style)
   * weave starting offsets. When `regenerate=true` the orchestrator
   * passes a hash of the previous batch so each regenerate produces
   * a structurally different candidate ordering. Falls back to the
   * legacy constant when `regenerate=true` and no salt is supplied.
   */
  regenerateSalt?: number;
};

export type PatternCandidate = { idea: Idea; meta: PatternMeta };

/**
 * Generate 12–20 deterministic pattern-based candidates.
 *
 * The candidate set is biased toward the creator's top structure /
 * hookStyle / emotionalSpike when memory is available, with ~25%
 * adjacent exploration so the batch never calcifies. No two
 * candidates share the same (templateId, scenarioFamily, hookStyle)
 * triple. Order matters — earlier entries are higher-priority for
 * the downstream scorer's tie-breaks.
 */
export function generatePatternCandidates(
  input: GeneratePatternCandidatesInput,
): PatternCandidate[] {
  const target = Math.max(12, Math.min(input.count ?? 16, 20));
  const tone = deriveTone(input.profile);
  const memTopStructure = topStructure(input.memory);
  const memTopHookStyle = topHookStyle(input.memory);
  const memTopSpike = topSpike(input.memory);
  const recent = new Set((input.recentScenarios ?? []).slice(0, 4));

  // Order templates: top structure first, then everything else.
  const orderedTemplates = [...TEMPLATES].sort((a, b) => {
    const aBoost =
      (memTopStructure === a.structure ? 2 : 0) +
      (memTopSpike === a.emotionalSpike ? 1 : 0);
    const bBoost =
      (memTopStructure === b.structure ? 2 : 0) +
      (memTopSpike === b.emotionalSpike ? 1 : 0);
    return bBoost - aBoost;
  });

  // Order scenarios: non-recent first, then recent (soft penalty,
  // not a ban — recent scenarios still appear if we run out of room).
  const orderedScenarios = [...SCENARIOS].sort((a, b) => {
    const aPen = recent.has(a.family) ? 1 : 0;
    const bPen = recent.has(b.family) ? 1 : 0;
    return aPen - bPen;
  });

  // Hook-style rotation: top first, then everything else, repeated.
  const styleOrder: HookStyle[] = [];
  if (memTopHookStyle) styleOrder.push(memTopHookStyle);
  for (const s of HOOK_STYLES) if (!styleOrder.includes(s)) styleOrder.push(s);

  const seen = new Set<string>();
  const out: PatternCandidate[] = [];
  // Salt the seed when regenerating so the (template, scenario, style)
  // weave shifts deterministically — same inputs never produce the same
  // 12 candidates twice in a row. Caller-supplied salt (typically a
  // hash of the previous batch + a millisecond cursor) gives every
  // regenerate call a different starting offset.
  // Unsigned-coerce the salt up-front so every downstream modulo /
  // index expression — including `pickPhrasing(arr, i + seedSalt)` and
  // `(i * 3 + seedSalt) % 7` — is guaranteed non-negative even if a
  // future caller hands us a signed-int salt. `>>> 0` collapses any
  // bit pattern into a uint32 in [0, 2^32-1].
  const rawSalt = input.regenerate
    ? typeof input.regenerateSalt === "number"
      ? input.regenerateSalt
      : 7
    : 0;
  const seedSalt = (rawSalt >>> 0);

  // Cartesian-diagonal weave: each axis (template, scenario, style)
  // advances every iteration at its own rate. With T=6, S=20, H=5 and
  // target=16 this guarantees all 5 hookStyles, all 6 structures, and
  // 16 distinct scenarios in the candidate pool — giving the Layer 4
  // diversifier real material to enforce hard structure/style/family
  // uniqueness on. The previous nested weave divided style by T*S=120,
  // which meant every batch <=120 candidates was single-style.
  // Memory bias is preserved because orderedTemplates is already
  // sorted top-structure-first, so the first iteration still surfaces
  // the creator's strongest pattern.
  const T = orderedTemplates.length;
  const S = orderedScenarios.length;
  const H = styleOrder.length;
  const maxIter = T * S * H;
  // Decorrelated per-axis offsets: each axis advances every iteration
  // AND starts from a different rotation derived from the salt. This
  // is what gives regenerate calls a structurally different pool, not
  // just a "same set, shifted by N" pool.
  // `(x % N + N) % N` guarantees a non-negative offset even if the
  // caller-supplied salt is negative — defensive against any future
  // signed-int regression in the salt computation.
  const tOff = ((seedSalt % T) + T) % T;
  const sOff = ((seedSalt * 3) % S + S) % S;
  const hOff = ((seedSalt * 7) % H + H) % H;
  let i = 0;
  while (out.length < target && i < maxIter) {
    const t = orderedTemplates[(i + tOff) % T];
    const s = orderedScenarios[(i + sOff) % S];
    const hs = styleOrder[(i + hOff) % H];
    const key = `${t.id}|${s.family}|${hs}`;
    i++;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(
      assembleCandidate(t, s, hs, tone, i + seedSalt, (i * 3 + seedSalt) % 7),
    );
  }

  return out;
}
