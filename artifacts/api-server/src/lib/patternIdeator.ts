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
import { deriveStyleHints, deriveTone, type DerivedTone, type StyleProfile } from "./styleProfile";
import type { Idea } from "./ideaGen";
import {
  resolveArchetype,
  type Archetype,
  type ArchetypeFamily,
} from "./archetypeTaxonomy";
import {
  lookupSceneObjectTag,
  ENV_CLUSTER_BY_TAG,
  type SceneObjectTag,
  type SceneEnvCluster,
} from "./sceneObjectTaxonomy";

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

export type Setting =
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
  /**
   * Free-form fine-grained location string used in user-facing prose
   * (whatToShow / howToFilm). Lets us say "bathroom mirror" or
   * "kitchen counter" or "front door" while the schema-bound `setting`
   * field stays in its 8-value enum. Picks within a batch are guarded
   * on `setting` (HARD: max 1 per batch) and `settingDetail` provides
   * the visible variety in copy.
   */
  settingDetail: string;
  /**
   * The specific physical moment that defines this scenario — a
   * 1–2 sentence beat-by-beat description used as the spine of
   * `whatToShow`. Replaces the old generic "Open on you in the
   * {setting}. Beat. Then the reaction lands…" template that made
   * every idea feel identical regardless of family.
   */
  sceneBeat: string;
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
    settingDetail: "in bed in the dark with phone glow on your face",
    sceneBeat:
      "You glance at the clock thinking it's still 11pm, do a slow double-take when it reads 3am, then go right back to scrolling like nothing happened.",
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
    settingDetail: "at the kitchen counter beside the coffee gear",
    sceneBeat:
      "You stare at the untouched French press for two beats, sigh, then grab your keys and head out the door for the $7 latte.",
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
    settingDetail: "in bed with the packed gym bag visible by the door",
    sceneBeat:
      "You glance at the packed gym bag by the door, slowly pull the blanket higher, and look away like you never saw it.",
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
    settingDetail: "next to the laundry pile on the bedroom chair",
    sceneBeat:
      "You pull a shirt from the top of the laundry mountain, hold it up to the light, squint at the wrinkles, and put it on anyway.",
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
    settingDetail: "on the couch with the phone in your hand",
    sceneBeat:
      "You open the unread thread, thumb hovers over the keyboard for a beat, you type nothing, then lock the screen and set the phone face-down.",
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
    settingDetail: "at the desk in front of the open laptop",
    sceneBeat:
      "You scroll past 47 unread emails, dead inside, then tap select-all and 'mark as read' with the satisfied-then-immediately-panicked face.",
    actionShort: "clear my inbox",
    realityShort: "marking everything read",
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
    settingDetail: "at the open fridge with the door light on your face",
    sceneBeat:
      "You open the fridge, stare at the same leftovers for two beats, close it slowly, then immediately unlock DoorDash on your phone.",
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
    setting: "bathroom",
    settingDetail: "at the bathroom mirror with the closet visible behind you",
    sceneBeat:
      "You step in front of the mirror in the new outfit, hold the look for one beat, then turn around and walk out wearing the same hoodie as always.",
    actionShort: "wear something new today",
    realityShort: "the same hoodie again",
    trigger: "stands in front of the mirror, grabs the hoodie instead",
    reaction: "the resigned shrug into the mirror",
    visualHook: "closet open behind you, hand goes straight to the hoodie",
    filmingMin: 4,
    topicNoun: "the closet",
  },
  {
    family: "errands",
    triggerCategory: "task",
    setting: "car",
    settingDetail: "in the driver's seat, errand list on the dashboard",
    sceneBeat:
      "You start the car, look at the six-item errand list on the dash, cross off one thing, then drive home and deadpan straight into the camera.",
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
    settingDetail: "wrapped in a blanket on the couch",
    sceneBeat:
      "You reread the group chat plans, type 'so sorry rain check', hit send, and let the relief wash over your face as you sink deeper into the blanket.",
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
    settingDetail: "at the desk in front of the laptop with the phone in hand",
    sceneBeat:
      "You open the to-do app, look at the list for one second, swipe over to TikTok, then catch your own reflection in the screen and keep scrolling anyway.",
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
    setting: "other",
    settingDetail: "in the doorway of the closet looking in at the chaos",
    sceneBeat:
      "You pick up the pile from the chair, walk it across the room, set it on the dresser, and call the entire afternoon productive.",
    actionShort: "deep clean the room",
    realityShort: "moving one pile to a different surface",
    trigger: "picks up the pile from the chair, sets it on the dresser",
    reaction: "stares at the new pile, calls it productive",
    visualHook: "same pile, different surface — wide shot of the room",
    filmingMin: 5,
    topicNoun: "the pile",
  },
  {
    family: "social_call",
    triggerCategory: "social",
    setting: "outside",
    settingDetail: "in the apartment hallway by the front door",
    sceneBeat:
      "Neighbour says hi in the hallway, your autopilot kicks in with the too-loud laugh, then you do the slow cringe-walk back to your door and exhale.",
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
    settingDetail: "in front of the open pantry door",
    sceneBeat:
      "You open the pantry, scan the shelves with the 'I'm just checking' face, and your hand emerges holding the chips you said you wouldn't touch.",
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
    settingDetail: "at the desk with the same water bottle from yesterday",
    sceneBeat:
      "You pick up the water bottle, feel that it's still full from yesterday, give it the slow guilty look, and set it back down without drinking.",
    actionShort: "drink more water",
    realityShort: "yesterday's bottle is still full",
    trigger: "picks up the water bottle from yesterday, still full",
    reaction: "the slow guilty look at the bottle, sets it back down",
    visualHook: "water bottle from yesterday, condensation gone",
    filmingMin: 3,
    topicNoun: "the water bottle",
  },
  {
    family: "morning",
    triggerCategory: "phone_screen",
    setting: "bed",
    settingDetail: "in bed, alarm screen lighting up the pillow",
    sceneBeat:
      "The alarm rings at 6am, your hand reaches out without your eyes opening, you swipe-to-snooze on muscle memory, and the screen goes dark.",
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
    settingDetail: "on the couch with the phone in your lap",
    sceneBeat:
      "You close the shopping cart, breathe out like the temptation is over, then 90 seconds later you open it back up and tap add to cart twice more.",
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
    setting: "bathroom",
    settingDetail: "at the bathroom sink, scrolling instead of brushing teeth",
    sceneBeat:
      "You drag down to refresh the post for the fifth time, the like count hasn't moved, you do the small disappointed nose-exhale, then lock the screen.",
    actionShort: "stop checking my likes",
    realityShort: "refreshing every 4 minutes",
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
    settingDetail: "at the sink in front of the dishes pile",
    sceneBeat:
      "You look at the sink full of dishes, decide 'morning me will handle it', do the slow turn away, and click the kitchen light off as you exit.",
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
    settingDetail: "in the driver's seat with the dashboard screen lit up",
    sceneBeat:
      "You open the podcast app, hover over the queue for a beat, switch over to Spotify, do the 'next time' nod, and press play on the same playlist as always.",
    actionShort: "learn something on my commute",
    realityShort: "same playlist for the 40th time",
    trigger: "opens the podcast app, immediately switches to Spotify",
    reaction: "the 'next time' nod, presses play on the usual playlist",
    visualHook: "podcast app closes, Spotify opens, familiar cover art",
    filmingMin: 3,
    topicNoun: "the podcast app",
  },
  {
    family: "skincare",
    triggerCategory: "self_check",
    setting: "bathroom",
    settingDetail: "at the bathroom sink in front of the mirror",
    sceneBeat:
      "You line up the full skincare routine on the counter, take one beat staring at the mirror, then grab a face wipe and walk straight to bed.",
    actionShort: "do my full skincare routine",
    realityShort: "one face wipe and bed",
    trigger: "lines up six bottles, picks up the face wipe instead",
    reaction: "the resigned look at the mirror, then exits the bathroom",
    visualHook: "skincare bottles untouched, single face wipe in hand",
    filmingMin: 3,
    topicNoun: "the skincare shelf",
  },
  {
    family: "mirror_pep_talk",
    triggerCategory: "self_check",
    setting: "bathroom",
    settingDetail: "at the bathroom mirror, hands on the sink",
    sceneBeat:
      "You plant both hands on the sink, look yourself dead in the eye for a long beat for the pep talk, then quietly say 'maybe tomorrow' and turn off the light.",
    actionShort: "give myself a real pep talk",
    realityShort: "deadpan stare for 30 seconds",
    trigger: "leans on the sink, locks eyes with the mirror, says nothing",
    reaction: "the long deadpan stare, then 'maybe tomorrow', light off",
    visualHook: "tight on the mirror, your reflection holding its own gaze",
    filmingMin: 3,
    topicNoun: "the mirror",
  },
  {
    family: "walk",
    triggerCategory: "self_check",
    setting: "outside",
    settingDetail: "on the front step with the door still open behind you",
    sceneBeat:
      "You make it as far as the front step in your walking shoes, look at the sidewalk, decide that counts, and turn straight back inside.",
    actionShort: "go for the morning walk",
    realityShort: "made it as far as the front step",
    trigger: "steps onto the front step, looks at the sidewalk, turns back",
    reaction: "the 'that counts' nod to camera, retreats inside",
    visualHook: "walking shoes on, door still open behind you",
    filmingMin: 4,
    topicNoun: "the front step",
  },
  {
    family: "doom_scroll_car",
    triggerCategory: "phone_screen",
    setting: "car",
    settingDetail: "in the parked car, key still in the ignition",
    sceneBeat:
      "You arrive home, kill the engine, then sit in the parked car scrolling for 20 minutes before you can face going inside.",
    actionShort: "go straight inside after work",
    realityShort: "20 minutes scrolling in the car",
    trigger: "kills the engine, immediately picks up the phone and scrolls",
    reaction: "the long blank scroll-stare, then a slow look at the front door",
    visualHook: "key still in the ignition, phone glow on your face",
    filmingMin: 3,
    topicNoun: "the parked car",
  },
  {
    family: "closet_pile",
    triggerCategory: "environment",
    setting: "other",
    settingDetail: "on the bedroom floor surrounded by the try-on pile",
    sceneBeat:
      "You sit on the bedroom floor surrounded by every outfit you tried on, stare at the chaos, then put the original hoodie back on and call it done.",
    actionShort: "find something nice to wear",
    realityShort: "back in the original hoodie",
    trigger: "tries on six outfits, surveys the floor pile",
    reaction: "the long defeated exhale, hoodie back on, exits frame",
    visualHook: "wide shot of the outfit pile on the bedroom floor",
    filmingMin: 5,
    topicNoun: "the try-on pile",
  },
];

// -----------------------------------------------------------------------------
// Visual-action + topic-lane taxonomies
// -----------------------------------------------------------------------------
// Two SOFT-diversity dimensions on top of the existing {structure,
// hookStyle, scenarioFamily} HARD axes. Novelty scoring uses these to
// prevent a batch from feeling like clones even when the structure /
// style / family axes are technically distinct (e.g. "coffee + snack +
// fridge" all live in the food_home lane and would feel like the same
// idea wearing different clothes).
//
// Stored as side-maps keyed by `scenario.family` so the 20 SCENARIOS
// rows above stay readable, and so cached batches (which only persist
// `family`) can derive both dimensions on read for cross-batch
// novelty context.

export type VisualActionPattern =
  | "phone_scroll_freeze"
  | "text_message_panic"
  | "kitchen_contradiction"
  | "fridge_open_stare"
  | "bedroom_avoidance"
  | "outfit_check_cut"
  | "couch_avoidance"
  | "car_avoidance"
  | "desk_avoidance"
  | "social_awkward_walkaway"
  | "face_reaction_deadpan"
  | "mirror_self_call_out"
  | "doorway_retreat";

export type TopicLane =
  | "food_home"
  | "work_productivity"
  | "social_texting"
  | "body_fitness"
  | "daily_routine";

const VISUAL_ACTION_BY_FAMILY: Record<string, VisualActionPattern> = {
  sleep: "phone_scroll_freeze",
  coffee: "kitchen_contradiction",
  gym: "bedroom_avoidance",
  laundry: "outfit_check_cut",
  texting: "text_message_panic",
  emails: "desk_avoidance",
  fridge: "fridge_open_stare",
  outfit: "mirror_self_call_out",
  errands: "car_avoidance",
  weekend_plans: "text_message_panic",
  productivity: "desk_avoidance",
  cleaning: "doorway_retreat",
  social_call: "social_awkward_walkaway",
  snack: "kitchen_contradiction",
  hydration: "desk_avoidance",
  morning: "bedroom_avoidance",
  shopping: "couch_avoidance",
  social_post: "mirror_self_call_out",
  dishes: "kitchen_contradiction",
  podcast: "car_avoidance",
  // New families
  skincare: "mirror_self_call_out",
  mirror_pep_talk: "face_reaction_deadpan",
  walk: "doorway_retreat",
  doom_scroll_car: "car_avoidance",
  closet_pile: "outfit_check_cut",
};

const TOPIC_LANE_BY_FAMILY: Record<string, TopicLane> = {
  sleep: "daily_routine",
  coffee: "food_home",
  gym: "body_fitness",
  laundry: "daily_routine",
  texting: "social_texting",
  emails: "work_productivity",
  fridge: "food_home",
  outfit: "daily_routine",
  errands: "work_productivity",
  weekend_plans: "social_texting",
  productivity: "work_productivity",
  cleaning: "daily_routine",
  social_call: "social_texting",
  snack: "food_home",
  hydration: "body_fitness",
  morning: "daily_routine",
  shopping: "daily_routine",
  social_post: "social_texting",
  dishes: "food_home",
  podcast: "daily_routine",
  // New families
  skincare: "body_fitness",
  mirror_pep_talk: "body_fitness",
  walk: "body_fitness",
  doom_scroll_car: "work_productivity",
  closet_pile: "daily_routine",
};

/**
 * Resolve the visual-action pattern for a scenario family. Returns
 * `null` for unknown families (e.g. Claude-fallback ideas whose
 * "scenarioFamily" is a free-form string we never registered).
 */
export function lookupVisualActionPattern(
  family: string | undefined,
): VisualActionPattern | null {
  if (!family) return null;
  return VISUAL_ACTION_BY_FAMILY[family] ?? null;
}

/**
 * Resolve the topic lane for a scenario family. Returns `null` for
 * unknown families (same caveat as `lookupVisualActionPattern`).
 */
export function lookupTopicLane(
  family: string | undefined,
): TopicLane | null {
  if (!family) return null;
  return TOPIC_LANE_BY_FAMILY[family] ?? null;
}

// -----------------------------------------------------------------------------
// ScriptType taxonomy — narrative-shape diversity axis
// -----------------------------------------------------------------------------
// 37-value enum capturing the NARRATIVE PSYCHOLOGY of the moment (what
// the video is "about" emotionally / behaviorally), distinct from the
// physical setting, visual action, or hook style. Two ideas can share
// scenarioFamily but differ in scriptType when the template reshapes
// the beat (e.g. `gym` scenario assembled with `expectation_vs_reality`
// template reads as `realization`, with `avoidance` template reads as
// `avoidance`). Used by batch guards (max 2 same per batch, reject all
// in same cluster) and novelty scorer (within-batch + cross-batch
// history, with tiered penalties + boosts).

export type ScriptType =
  // CORE INTERNAL (8)
  | "avoidance"
  | "realization"
  | "false_start"
  | "overcommit"
  | "internal_vs_external"
  | "delayed_consequence"
  | "denial"
  | "rationalization"
  // SOCIAL (7)
  | "social_micro_fail"
  | "social_overthinking"
  | "late_reply_regret"
  | "conversation_replay"
  | "fake_confidence"
  | "polite_lie"
  | "unexpected_response"
  // ACTION-BASED (5)
  | "interrupted_action"
  | "loop_behavior"
  | "decision_flip"
  | "slow_escalation"
  | "small_mistake_big_reaction"
  // EMOTIONAL (5)
  | "quiet_panic"
  | "suppressed_reaction"
  | "delayed_emotion"
  | "overreaction"
  | "emotional_disconnect"
  // BEHAVIORAL (5)
  | "habit_break_fail"
  | "just_one_more_spiral"
  | "self_negotiation"
  | "productivity_illusion"
  | "time_blindness"
  // ABSURD / CREATIVE (7)
  | "object_personification"
  | "dramatic_narration"
  | "fake_documentary"
  | "internal_monologue"
  | "alternate_reality"
  | "exaggeration"
  | "silent_story";

export const SCRIPT_TYPES: readonly ScriptType[] = [
  "avoidance", "realization", "false_start", "overcommit",
  "internal_vs_external", "delayed_consequence", "denial", "rationalization",
  "social_micro_fail", "social_overthinking", "late_reply_regret",
  "conversation_replay", "fake_confidence", "polite_lie", "unexpected_response",
  "interrupted_action", "loop_behavior", "decision_flip", "slow_escalation",
  "small_mistake_big_reaction",
  "quiet_panic", "suppressed_reaction", "delayed_emotion", "overreaction",
  "emotional_disconnect",
  "habit_break_fail", "just_one_more_spiral", "self_negotiation",
  "productivity_illusion", "time_blindness",
  "object_personification", "dramatic_narration", "fake_documentary",
  "internal_monologue", "alternate_reality", "exaggeration", "silent_story",
] as const;

/**
 * Narrative clusters used by `batchGuardsPass`'s "reject all in same
 * cluster" rule. The spec calls out three explicit failure modes:
 *
 *   1. "all are avoidance"           → AVOIDANCE_CLUSTER
 *   2. "all are internal contradiction" → INTERNAL_CONTRADICTION_CLUSTER
 *   3. "all are low-energy reaction loops" — handled by the energy
 *      axis check (not here), since scriptType doesn't carry energy.
 *
 * Clusters are a SOFT semantic grouping — most scriptTypes don't
 * belong to any cluster (so they never trigger the guard). The two
 * clusters here only fire when the entire batch falls inside one,
 * preserving the existing "max 2 same scriptType" rule as the
 * primary guard.
 */
export const SCRIPT_TYPE_CLUSTERS = {
  avoidance: new Set<ScriptType>([
    "avoidance",
    "false_start",
    "habit_break_fail",
    "time_blindness",
  ]),
  internal_contradiction: new Set<ScriptType>([
    "realization",
    "internal_vs_external",
    "denial",
    "rationalization",
    "self_negotiation",
  ]),
} as const;

/**
 * Default scriptType per scenario family. Used by `resolveScriptType`
 * as the fallback when no (template, family) override matches, and by
 * `lookupScriptType` for legacy cache entries that lack templateId.
 *
 * 25 scenarios → 14 distinct scriptTypes in active rotation:
 *   loop_behavior (3), habit_break_fail (4), false_start (3),
 *   self_negotiation (2), just_one_more_spiral (2),
 *   delayed_consequence (2), decision_flip (2),
 *   late_reply_regret/avoidance/small_mistake_big_reaction/
 *   time_blindness/polite_lie/productivity_illusion/social_micro_fail (1 each)
 */
const SCRIPT_TYPE_BY_FAMILY: Record<string, ScriptType> = {
  sleep: "loop_behavior",
  coffee: "habit_break_fail",
  gym: "avoidance",
  laundry: "habit_break_fail",
  texting: "late_reply_regret",
  emails: "small_mistake_big_reaction",
  fridge: "loop_behavior",
  outfit: "decision_flip",
  errands: "time_blindness",
  weekend_plans: "polite_lie",
  productivity: "productivity_illusion",
  cleaning: "self_negotiation",
  social_call: "social_micro_fail",
  snack: "just_one_more_spiral",
  hydration: "habit_break_fail",
  morning: "false_start",
  shopping: "just_one_more_spiral",
  social_post: "loop_behavior",
  dishes: "delayed_consequence",
  podcast: "false_start",
  skincare: "habit_break_fail",
  mirror_pep_talk: "self_negotiation",
  walk: "false_start",
  doom_scroll_car: "delayed_consequence",
  closet_pile: "decision_flip",
};

/**
 * (template, scenario) overrides where the template's structural
 * shape fundamentally reshapes the narrative away from the scenario
 * default. Sparse — only ~17 entries — most (template, family) pairs
 * inherit the scenario default.
 */
const SCRIPT_TYPE_OVERRIDES: Partial<
  Record<TemplateId, Partial<Record<string, ScriptType>>>
> = {
  expectation_vs_reality: {
    gym: "realization",
    weekend_plans: "realization",
    productivity: "realization",
    morning: "realization",
    walk: "realization",
  },
  small_panic: {
    texting: "quiet_panic",
    emails: "quiet_panic",
    social_post: "quiet_panic",
    social_call: "quiet_panic",
  },
  avoidance: {
    dishes: "avoidance",
    hydration: "avoidance",
    productivity: "avoidance",
    skincare: "avoidance",
  },
  social_awareness: {
    mirror_pep_talk: "fake_confidence",
    weekend_plans: "polite_lie",
  },
  routine_contradiction: {
    productivity: "internal_vs_external",
    coffee: "internal_vs_external",
    dishes: "internal_vs_external",
    skincare: "internal_vs_external",
  },
};

/**
 * Resolve the scriptType for a (template, scenario) pair. Used by
 * `assembleCandidate` at generation time. Override → scenario default.
 */
export function resolveScriptType(
  templateId: TemplateId,
  family: string,
): ScriptType {
  const override = SCRIPT_TYPE_OVERRIDES[templateId]?.[family];
  if (override) return override;
  return SCRIPT_TYPE_BY_FAMILY[family] ?? "avoidance";
}

/**
 * Resolve the scriptType for a cached batch entry. Falls back to the
 * scenario-default when templateId is absent (legacy cache entries
 * pre-dating this taxonomy). Returns null when family itself is
 * missing or unknown — caller skips the candidate's contribution to
 * cross-batch sets.
 */
export function lookupScriptType(
  family: string | undefined,
  templateId?: string,
): ScriptType | null {
  if (!family) return null;
  if (templateId !== undefined) {
    const override =
      SCRIPT_TYPE_OVERRIDES[templateId as TemplateId]?.[family];
    if (override) return override;
  }
  return SCRIPT_TYPE_BY_FAMILY[family] ?? null;
}

// -----------------------------------------------------------------------------
// Energy taxonomy — derived from VisualActionPattern
// -----------------------------------------------------------------------------
// Per-batch "all-low-energy" rejection rule (spec section 5).
// `active` = physical motion / outfit changes / mirror beats that
// require visible body movement. `low` = static/passive (sitting,
// scrolling, deadpan reaction). `medium` = everything in between.

export type Energy = "active" | "low" | "medium";

const ENERGY_BY_VISUAL_ACTION: Record<VisualActionPattern, Energy> = {
  phone_scroll_freeze: "low",
  text_message_panic: "low",
  face_reaction_deadpan: "low",
  kitchen_contradiction: "medium",
  fridge_open_stare: "medium",
  bedroom_avoidance: "medium",
  couch_avoidance: "medium",
  car_avoidance: "medium",
  desk_avoidance: "medium",
  social_awkward_walkaway: "medium",
  doorway_retreat: "medium",
  outfit_check_cut: "active",
  mirror_self_call_out: "active",
};

export function lookupEnergy(va: VisualActionPattern | undefined): Energy | null {
  if (!va) return null;
  return ENERGY_BY_VISUAL_ACTION[va] ?? null;
}

// -----------------------------------------------------------------------------
// Hook-style phrasing pools
// -----------------------------------------------------------------------------
//
// REWRITE NOTE (Apr 2026): The original phrasings ended several variants
// on `${realityShort}` (a multi-word fragment like "letting it sit for
// 4 days"). When `actionShort` was also long, the assembled hook ran
// past 10 words and the (now-removed) `clampHookWords` truncator chopped
// it mid-clause — producing dangling endings like "and marking" or
// "vs me the". The new pool obeys two rules:
//
//   1. NO phrasing ends on `${realityShort}`. Slots are limited to
//      `actionShort` (verb phrase) and `topicNoun` (short noun phrase).
//   2. Every phrasing is hand-budgeted to ≤10 words across all
//      scenarios in the SCENARIOS array. The longest `actionShort`
//      ("give myself a real pep talk", 6w) is the ceiling that drove
//      the prefix-length budget.
//
// Hooks that still slip past 10 words (defensive — should never happen
// with the current scenarios) are REJECTED by `validateHook` and the
// assembler tries the next phrasing instead of truncating.

/**
 * Coarse-grained classification of hook OPENERS for cross-batch and
 * within-batch diversity. Independent of `HookStyle` (which the user
 * picks for tonal preference) — two hooks with style="contrast" but
 * openers="me_saying" vs "what_i_planned_vs" feel like different
 * videos. Two hooks with different styles but the same opener
 * ("me saying I'll X" / "me, refusing to deal with Y") feel like
 * the same video with a wallpaper swap.
 *
 * Derived in-memory from hook text via `lookupHookOpener` — no
 * schema change, no cache change. Pattern-source hooks always
 * resolve; Claude/Llama-fallback hooks may return null (which the
 * scorer treats as "unknown opener, no penalty").
 */
export type HookOpener =
  | "the_way_i"
  | "me_saying"
  | "i_really"
  | "why_did_i"
  | "what_i_planned_vs"
  | "this_is_where"
  | "silent_panic"
  | "realization"
  | "denial_statement";

export const HOOK_OPENERS: readonly HookOpener[] = [
  "the_way_i",
  "me_saying",
  "i_really",
  "why_did_i",
  "what_i_planned_vs",
  "this_is_where",
  "silent_panic",
  "realization",
  "denial_statement",
] as const;

/**
 * Prefix-anchored regexes — order matters only when two patterns
 * could match the same prefix (none currently). All patterns
 * lowercase-anchor and tolerate leading whitespace.
 */
const HOOK_OPENER_PATTERNS: ReadonlyArray<{
  opener: HookOpener;
  re: RegExp;
}> = [
  { opener: "the_way_i", re: /^\s*the way i\b/i },
  { opener: "i_really", re: /^\s*i really\b/i },
  { opener: "why_did_i", re: /^\s*why (did|do) i\b/i },
  { opener: "what_i_planned_vs", re: /^\s*what (i|morning|today)\b/i },
  { opener: "this_is_where", re: /^\s*this is\b/i },
  { opener: "silent_panic", re: /^\s*(silent panic|internal scream)/i },
  { opener: "realization", re: /^\s*(realizing|the moment i)\b/i },
  { opener: "denial_statement", re: /^\s*i (am|have) (totally|very|a great)\b/i },
  // me_saying must come AFTER "me, lying" / "me at" wouldn't conflict,
  // but the broad `^\s*me\b` would swallow anything starting with "me"
  // — so we anchor it last and only after the more-specific patterns
  // have had their shot.
  { opener: "me_saying", re: /^\s*me\b/i },
];

/**
 * Classify a hook by its opening clause. Returns null when no
 * pattern matches (Claude/Llama fallback hooks, mostly). Callers
 * MUST handle null — the novelty scorer treats null as "no opener
 * info, no diversity bonus or penalty."
 */
export function lookupHookOpener(hook: string): HookOpener | null {
  for (const { opener, re } of HOOK_OPENER_PATTERNS) {
    if (re.test(hook)) return opener;
  }
  return null;
}

/**
 * Words that, if a hook ends on them, signal a truncated/dangling
 * fragment. Includes coordinating conjunctions, prepositions, and
 * bare determiners — anything that demands a noun/clause to follow.
 * Used by `validateHook` to reject candidates that would have read
 * as broken English ("the way I said I'd reply to that text and").
 */
const DANGLING_TRAILING_WORDS = new Set([
  "and", "or", "but", "vs", "with", "to", "the", "a", "an",
  "my", "me", "of", "on", "in", "at", "for", "by", "from",
  "into", "onto", "than", "so", "as", "if", "is", "are",
]);

/**
 * Hard validation gate for assembled hooks. A hook passes only if:
 *   • word count ∈ [3, 10] (schema enforces ≤10; we add ≥3 to
 *     reject pathologically short results from over-aggressive
 *     phrasing tweaks);
 *   • does NOT end on a word in DANGLING_TRAILING_WORDS;
 *   • does NOT contain a literal `${` (template interpolation leak);
 *   • does NOT end on `…` or `...` (truncation marker);
 *   • does NOT start with any pattern in BANNED_HOOK_PREFIXES
 *     (PART 4 of the HOOK STYLE spec — these phrasings collapse
 *     into "same joke, different noun" and are rejected outright);
 *   • does NOT contain any phrase in GENERIC_FILLER_PHRASES
 *     (PART 6 — "this is so me", "we've all been there", etc.
 *     read as social-media boilerplate rather than a specific
 *     thought).
 * Returns true iff the hook is shippable.
 *
 * The banned-prefix + generic-filler checks are pure-additive
 * extensions — every hook that passed before still passes UNLESS
 * it matches one of these patterns (which is the desired
 * behavior). The legacy HOOK_PHRASINGS_BY_STYLE catalog contains
 * a few entries that DO match banned prefixes ("the way I…",
 * "why did I…"); those entries no longer ship through the new
 * generation path (which iterates HOOK_LANGUAGE_STYLES via the
 * fresh HOOK_PHRASINGS_BY_LANGUAGE_STYLE catalog), and tryRewrite
 * in the scorer now skips them too — exactly the spec's intent.
 */
export function validateHook(hook: string): boolean {
  const trimmed = hook.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.includes("${")) return false;
  if (/(\.{3}|…)\s*$/.test(trimmed)) return false;
  const words = trimmed.split(/\s+/);
  if (words.length < 3 || words.length > 10) return false;
  const last = words[words.length - 1]!
    .toLowerCase()
    .replace(/[.,!?;:]+$/g, "");
  if (DANGLING_TRAILING_WORDS.has(last)) return false;
  if (lookupBannedHookPrefix(trimmed)) return false;
  if (containsGenericFiller(trimmed)) return false;
  if (containsVoiceViolation(trimmed)) return false;
  return true;
}

/**
 * A single phrasing variant — `build` takes a scenario and returns
 * the assembled hook string. `opener` is the HookOpener it produces
 * (declared statically so we don't have to re-derive it per call).
 *
 * Phrasings within a HookStyle are tried in order; the assembler
 * picks the first that passes `validateHook`, falling back to the
 * next on failure. If none pass, the assembler returns null and the
 * generator skips this (template, scenario, style) triple.
 */
export type HookPhrasingEntry = {
  opener: HookOpener;
  build: (s: Scenario) => string;
};

export const HOOK_PHRASINGS_BY_STYLE: Record<HookStyle, HookPhrasingEntry[]> = {
  the_way_i: [
    {
      opener: "the_way_i",
      build: (s) => `the way I avoid ${s.topicNoun} like a sport`,
    },
    {
      opener: "the_way_i",
      build: (s) => `the way I gaslight myself about ${s.topicNoun}`,
    },
    {
      opener: "me_saying",
      build: (s) => `me, refusing to deal with ${s.topicNoun}`,
    },
  ],
  why_do_i: [
    {
      opener: "why_did_i",
      build: (s) => `why did I lie to myself about ${s.topicNoun}`,
    },
    {
      opener: "why_did_i",
      build: (s) => `why did I expect anything from ${s.topicNoun}`,
    },
    {
      opener: "denial_statement",
      build: (s) => `I am totally fine about ${s.topicNoun}`,
    },
  ],
  internal_thought: [
    {
      opener: "i_really",
      build: (s) => `I really thought I'd ${s.actionShort}`,
    },
    {
      opener: "i_really",
      build: (s) => `I really planned to handle ${s.topicNoun}`,
    },
    {
      opener: "me_saying",
      build: (s) => `me, lying about ${s.topicNoun} again`,
    },
  ],
  contrast: [
    {
      opener: "what_i_planned_vs",
      build: () => `what I planned vs how it actually went`,
    },
    {
      opener: "what_i_planned_vs",
      build: () => `what morning me promised vs night me delivered`,
    },
    {
      opener: "me_saying",
      build: () => `me at 9am vs me at 9pm`,
    },
  ],
  curiosity: [
    {
      opener: "this_is_where",
      build: () => `this is where the plan officially fell apart`,
    },
    {
      opener: "silent_panic",
      build: () => `silent panic, zero words, full body`,
    },
    {
      opener: "realization",
      build: () => `the moment I knew I was never going`,
    },
  ],
};

/* ------------------------------------------------------------------ */
/* HOOK LANGUAGE STYLE — the "type of thought" axis (12 values).       */
/*                                                                     */
/* The legacy 5-value HookStyle catalog above describes phrasing-       */
/* PATTERNS (the_way_i / why_do_i / contrast / curiosity /              */
/* internal_thought) and is kept for backward-compat reads of cached    */
/* candidate metadata. HookLanguageStyle is the NEW primary axis        */
/* layered on top: it describes the LANGUAGE MODE the hook expresses    */
/* (confession / observation / instruction / time_stamp / …).           */
/*                                                                      */
/* Generation now iterates HOOK_LANGUAGE_STYLES (12) instead of         */
/* HOOK_STYLES (5) for the H axis of the Cartesian, picks a phrasing    */
/* from HOOK_PHRASINGS_BY_LANGUAGE_STYLE, and DERIVES the legacy        */
/* `hookStyle` field for each candidate via                              */
/* HOOK_LANGUAGE_STYLE_TO_LEGACY_HOOK_STYLE so the JSONB cache /        */
/* memory module / quality scorer paths that still read `hookStyle`     */
/* keep working unchanged.                                              */
/* ------------------------------------------------------------------ */

/** The 12 language modes a hook can express ("type of thought"). */
export const HOOK_LANGUAGE_STYLES = [
  "confession",
  "observation",
  "absurd_claim",
  "matter_of_fact",
  "question",
  "instruction",
  "micro_story",
  "comparison",
  "object_pov",
  "time_stamp",
  "anti_hook",
  "escalation_hook",
] as const;
export type HookLanguageStyle = (typeof HOOK_LANGUAGE_STYLES)[number];

/**
 * Lossy backward-compat mapping: HookLanguageStyle → legacy HookStyle.
 *
 * Generation now drives off HookLanguageStyle, but the legacy
 * `hookStyle` field stays populated on every candidate so the
 * JSONB cache reader, viralPatternMemory module, and quality
 * scorer continue to see a valid value (no schema change, no
 * cache invalidation). The mapping deliberately leans away from
 * the two banned legacy patterns ("the_way_i", "why_do_i") since
 * the new catalog never produces those phrasings.
 */
export const HOOK_LANGUAGE_STYLE_TO_LEGACY_HOOK_STYLE: Record<
  HookLanguageStyle,
  HookStyle
> = {
  confession: "internal_thought",
  observation: "curiosity",
  absurd_claim: "curiosity",
  matter_of_fact: "curiosity",
  question: "curiosity",
  instruction: "curiosity",
  micro_story: "internal_thought",
  comparison: "contrast",
  object_pov: "curiosity",
  time_stamp: "curiosity",
  anti_hook: "internal_thought",
  escalation_hook: "internal_thought",
};

// -----------------------------------------------------------------------------
// VOICE PROFILES SYSTEM (style-layer)
//
// VoiceProfile = TONE of expression (HOW the hook sounds).
// HookLanguageStyle = TYPE of thought (WHAT the hook expresses).
//
// These are orthogonal: same HLS × different voice should produce
// recognizably different wording (e.g. object_pov × dry_humor = "the
// laundry won again", object_pov × chaotic = "the laundry is actually
// bullying me"). VoiceProfile is a STYLE LAYER ONLY — it does NOT
// affect safety filters, quality threshold, scenario selection, or
// archetype selection (per spec). It DOES affect hook wording,
// caption wording, and (when visible) "why this works" copy.
// -----------------------------------------------------------------------------

export const VOICE_PROFILES = [
  "dry_humor",
  "chaotic",
  "poetic",
  "blunt",
  "sarcastic",
  "self_aware",
  "deadpan",
  "soft_confessional",
] as const;
export type VoiceProfile = (typeof VOICE_PROFILES)[number];

/**
 * Maps the `tasteCalibrationJson.preferredTone` 4-value enum (set
 * during onboarding) to a VoiceProfile. Calibration is the highest-
 * priority signal — if set, the user has explicitly chosen this tone
 * and the batch guard treats it as a `strongPreference` (the
 * never-3-identical rule is RELAXED when strongPreference=true).
 */
export const CALIBRATION_TONE_TO_VOICE: Record<
  "dry_subtle" | "chaotic" | "bold" | "self_aware",
  VoiceProfile
> = {
  dry_subtle: "dry_humor",
  chaotic: "chaotic",
  bold: "blunt",
  self_aware: "self_aware",
};

/**
 * Maps `deriveStyleHints(profile).tone` to a VoiceProfile. This is
 * the rule-based hint derived from the creator's uploaded videos /
 * past hooks. Lower priority than calibration. `neutral` returns
 * null so we fall through to the next priority tier.
 */
export const HINTS_TONE_TO_VOICE: Record<
  "dry" | "chaotic" | "self_aware" | "confident" | "neutral",
  VoiceProfile | null
> = {
  dry: "dry_humor",
  chaotic: "chaotic",
  self_aware: "self_aware",
  confident: "blunt",
  neutral: null,
};

/**
 * Maps `visionStyleJson.deliveryStyle` (Llama 3.2 Vision-extracted
 * trait) to a VoiceProfile. Lowest of the three signal tiers because
 * vision extraction is noisier than calibration / hints. `unknown`
 * returns null so we fall through to the default rotation.
 */
export const VISION_DELIVERY_TO_VOICE: Record<
  "deadpan" | "awkward" | "expressive" | "confident" | "chaotic" | "unknown",
  VoiceProfile | null
> = {
  deadpan: "deadpan",
  awkward: "soft_confessional",
  expressive: "chaotic",
  confident: "blunt",
  chaotic: "chaotic",
  unknown: null,
};

/**
 * For each primary voice, the rotation set of compatible secondary
 * voices the per-slot picker may emit. The PRIMARY is always at index
 * 0 (gets the highest per-slot priority); secondaries cycle in order
 * so a 3-slot batch surfaces 3 distinct voices when the allowed set
 * has ≥3 members. The "default" set (used when no signal at all
 * resolves) is broad and tone-neutral so the system stays usable for
 * a fresh creator with no calibration / hints / vision data yet.
 *
 * Hand-curated for compatibility — e.g. dry_humor pairs naturally
 * with deadpan + sarcastic, but chaotic would clash; chaotic pairs
 * with sarcastic + self_aware but would feel jarring next to poetic.
 */
export const ALLOWED_VOICES_BY_PRIMARY: Record<VoiceProfile, VoiceProfile[]> = {
  dry_humor: ["dry_humor", "deadpan", "sarcastic", "self_aware"],
  chaotic: ["chaotic", "sarcastic", "self_aware", "dry_humor"],
  poetic: ["poetic", "soft_confessional", "dry_humor", "self_aware"],
  blunt: ["blunt", "deadpan", "dry_humor", "sarcastic"],
  sarcastic: ["sarcastic", "dry_humor", "blunt", "self_aware"],
  self_aware: ["self_aware", "soft_confessional", "dry_humor", "deadpan"],
  deadpan: ["deadpan", "dry_humor", "blunt", "self_aware"],
  soft_confessional: [
    "soft_confessional",
    "self_aware",
    "poetic",
    "dry_humor",
  ],
};

/**
 * The default allowed set when no signal resolves at all (cold-start
 * creator with no calibration, no usable hints, no vision data). The
 * 4 voices here are chosen to be tone-neutral and broadly usable —
 * none of the high-energy (chaotic) or high-decoration (poetic)
 * voices, which we only emit when we have positive signal. The
 * primary rotates between `self_aware` and `dry_humor` per the spec
 * ("Default = self_aware or dry_humor"); rotation is deterministic
 * (seed-based) so a given creator's batches stay coherent.
 */
export const DEFAULT_ALLOWED_VOICES: readonly VoiceProfile[] = [
  "self_aware",
  "dry_humor",
  "deadpan",
  "soft_confessional",
] as const;

/**
 * Inputs to `selectPrimaryVoiceProfile`. All three signals are
 * optional — the resolver tries them in priority order and falls
 * through to the default rotation when none is set. Types are
 * intentionally narrow (literal unions, not full schema types) so
 * patternIdeator stays free of cross-cutting imports — the caller
 * (hybridIdeator) extracts the relevant tone string from each
 * source schema and passes the literal here.
 */
export type VoiceSignalInputs = {
  calibrationTone?:
    | "dry_subtle"
    | "chaotic"
    | "bold"
    | "self_aware"
    | null;
  hintsTone?:
    | "dry"
    | "chaotic"
    | "self_aware"
    | "confident"
    | "neutral"
    | null;
  visionDelivery?:
    | "deadpan"
    | "awkward"
    | "expressive"
    | "confident"
    | "chaotic"
    | "unknown"
    | null;
  /**
   * Deterministic rotation seed. When no signal resolves, the
   * default-rotation primary cycles between `self_aware` and
   * `dry_humor` based on `(seed >>> 1) & 1`. Pass a stable
   * per-creator+per-batch hash so the same creator's regen stays
   * coherent without locking forever.
   */
  rotationSeed?: number;
};

export type VoiceProfileSelection = {
  primary: VoiceProfile;
  source: "calibration" | "hints" | "vision" | "default";
  allowed: readonly VoiceProfile[];
  /**
   * True ONLY when calibration explicitly set the voice — the spec's
   * "user strongly prefers" exception that RELAXES the never-3-
   * identical batch guard. Hints + vision do NOT count as strong
   * preference (they're inferred, not user-stated).
   */
  strongPreference: boolean;
};

/**
 * Resolve the primary VoiceProfile for a creator following the spec's
 * priority chain: calibration → hints → vision → default rotation.
 * Returns the primary, the rotation set the per-slot picker is
 * allowed to draw from, the source of the decision (telemetry), and
 * the strongPreference flag (relaxes batch guard).
 */
export function selectPrimaryVoiceProfile(
  inputs: VoiceSignalInputs,
): VoiceProfileSelection {
  // Tier 1 — calibration (user-stated, highest authority).
  if (inputs.calibrationTone) {
    const primary = CALIBRATION_TONE_TO_VOICE[inputs.calibrationTone];
    return {
      primary,
      source: "calibration",
      allowed: ALLOWED_VOICES_BY_PRIMARY[primary],
      strongPreference: true,
    };
  }
  // Tier 2 — derived hints (rule-based from past videos).
  if (inputs.hintsTone) {
    const mapped = HINTS_TONE_TO_VOICE[inputs.hintsTone];
    if (mapped) {
      return {
        primary: mapped,
        source: "hints",
        allowed: ALLOWED_VOICES_BY_PRIMARY[mapped],
        strongPreference: false,
      };
    }
  }
  // Tier 3 — vision-extracted delivery style (Llama 3.2 Vision).
  if (inputs.visionDelivery) {
    const mapped = VISION_DELIVERY_TO_VOICE[inputs.visionDelivery];
    if (mapped) {
      return {
        primary: mapped,
        source: "vision",
        allowed: ALLOWED_VOICES_BY_PRIMARY[mapped],
        strongPreference: false,
      };
    }
  }
  // Tier 4 — default rotation. Cycle between self_aware ↔ dry_humor
  // based on the seed so the same creator's repeated cold-start calls
  // alternate primaries instead of always landing on the same voice.
  const rotIdx = ((inputs.rotationSeed ?? 0) >>> 1) & 1;
  const primary: VoiceProfile = rotIdx === 0 ? "self_aware" : "dry_humor";
  return {
    primary,
    source: "default",
    allowed: DEFAULT_ALLOWED_VOICES,
    strongPreference: false,
  };
}

/**
 * Pick the voice for a specific candidate slot in the pool. Cycles
 * through the `allowed` set so the pool naturally surfaces all
 * compatible voices — the downstream batch selector then has voice
 * diversity to work with when assembling the final 3-pick batch.
 *
 * The primary voice (allowed[0]) gets every Nth slot where
 * N = allowed.length, ensuring it dominates without monopolizing.
 * Secondary voices fill the gaps in rotation order. This is
 * deterministic w.r.t. (slotIndex, allowed) so a regen with the
 * same allowed set produces the same per-slot voice assignment —
 * the regen variation comes from the upstream Cartesian salt
 * shuffling (template, scenario, hookLanguageStyle), not from
 * randomizing voice independently.
 */
export function pickVoiceForSlot(
  slotIndex: number,
  allowed: readonly VoiceProfile[],
): VoiceProfile {
  if (allowed.length === 0) return "self_aware";
  const idx = ((slotIndex % allowed.length) + allowed.length) % allowed.length;
  return allowed[idx]!;
}

// -----------------------------------------------------------------------------
// Voice-violation phrases (spec PART validation)
//
// Reject voice output if:
//   - too theatrical (hyperbolic intensifiers without grounding)
//   - mean / insulting (judges the user as a person)
//   - motivational / advice-like (positions Lumina as a coach)
//
// Pure additive — extends the existing validateHook chain. Sized
// narrowly so existing 46-entry catalog × all scenarios still
// passes (verified via QA). Substring-match (case-insensitive)
// since these tells can appear mid-hook, not just at start.
// -----------------------------------------------------------------------------

export const VOICE_VIOLATION_PHRASES: ReadonlyArray<RegExp> = [
  // Mean / insulting — judges the user as a person.
  /\b(pathetic|loser|cringe|embarrassing yourself)\b/i,
  // Motivational / advice-like — positions Lumina as a coach.
  // The `(?:\w+\s+){0,3}` interstitial allows up to three modifier
  // words between "you" and the advice verb so spec-flagged hooks
  // like "you absolutely deserve this" still trip the guard. Capped
  // at 3 to keep the regex anchored — longer windows would let
  // benign sentences containing both "you" and "deserve" 10 words
  // apart match falsely.
  /\byou\b\s+(?:\w+\s+){0,3}(got|deserve|owe yourself|earned|are worthy)\b/i,
  /\b(own your|step into your|main character energy|life update incoming)\b/i,
  // Theatrical — hyperbolic intensifiers stacked on each other.
  /\b(literally absolutely|absolutely literally|the most.*ever)\b/i,
];

/**
 * Returns true if the hook contains any voice-violation phrase. Used
 * by `validateHook` to reject hooks that read mean / preachy /
 * theatrical regardless of which voice produced them.
 */
export function containsVoiceViolation(hook: string): boolean {
  for (const re of VOICE_VIOLATION_PHRASES) {
    if (re.test(hook)) return true;
  }
  return false;
}

/**
 * Apply a tiny voice-tone tweak to a caption. Idempotent — if the
 * caption already matches the voice, no change is made. Never
 * increases length by more than 2 chars (spec: voice must NOT lose
 * clarity). Used by `assembleCandidate` after `pickPhrasing`
 * resolves the structural caption.
 */
export function applyVoiceToCaption(
  caption: string,
  voice: VoiceProfile,
): string {
  const trimmed = caption.trim();
  if (!trimmed) return caption;
  switch (voice) {
    case "chaotic": {
      // Light expressive marker if the caption isn't already loud.
      // Appended WITHOUT a separating space so the +length budget
      // stays at exactly 2 UTF-16 code units (one surrogate pair),
      // which keeps `applyVoiceToCaption` within the spec's "never
      // increases length by more than 2 chars" guarantee.
      if (/[!?😭🥲💀🫠]/.test(trimmed)) return trimmed;
      return `${trimmed}😭`;
    }
    case "deadpan":
    case "blunt": {
      // Strip trailing exclamations / over-punctuation. Single dot,
      // tops. (deadpan + blunt both want a flat landing.)
      return trimmed.replace(/[!]+\s*$/g, "").replace(/\.{2,}\s*$/g, ".");
    }
    case "soft_confessional": {
      // No transformation — the catalog phrasing already reads
      // gentle when this voice was selected. Idempotent passthrough.
      return trimmed;
    }
    default:
      return trimmed;
  }
}

/**
 * A phrasing variant keyed by HookLanguageStyle. Unlike the legacy
 * HookPhrasingEntry, there is no static `opener` field — the new
 * catalog's phrasings rarely match any of the 9 existing
 * HookOpener regex patterns, so we let `lookupHookOpener(hook)`
 * return null for these entries (the diversity tracker treats
 * null as "no opener info, no penalty").
 *
 * `voiceProfiles` is OPTIONAL: when present, lists the VoiceProfiles
 * this phrasing reads naturally in (the per-slot voice picker
 * prefers entries whose voice list contains the requested voice).
 * When undefined, the entry is voice-neutral and acceptable for ANY
 * voice (used for safety-net fallback when no voice-tagged entry
 * for the requested HLS × voice cell exists).
 */
export type LanguagePhrasingEntry = {
  build: (s: Scenario) => string;
  voiceProfiles?: readonly VoiceProfile[];
};

/**
 * Banned hook prefixes (PART 4 of the HOOK STYLE spec). Hooks
 * matching any of these prefixes are REJECTED by `validateHook`
 * and additionally take a -5 selection penalty in the scorer.
 *
 * The regex set is anchored at start-of-string + optional leading
 * whitespace, case-insensitive. Each pattern is the LITERAL prefix
 * the user identified as collapsing into "same joke, different
 * noun" — they are surface-level phrasings, not deep structures,
 * so prefix-match is the correct fidelity.
 */
export const BANNED_HOOK_PREFIXES: ReadonlyArray<RegExp> = [
  /^\s*the way i\b/i,
  /^\s*why (did|do) i\b/i,
  /^\s*i really thought\b/i,
  /^\s*me saying\b/i,
  /^\s*me,/i,
  /^\s*what i said vs what i did\b/i,
];

/**
 * Generic-filler phrases that read as "social-media boilerplate"
 * rather than a specific thought. Hooks containing any of these
 * substrings (case-insensitive) are REJECTED by `validateHook`.
 * Substring-match (not prefix) because these phrases can appear
 * mid-hook ("classic me, this is so me, anyway").
 */
export const GENERIC_FILLER_PHRASES: ReadonlyArray<RegExp> = [
  /\bthis is so me\b/i,
  /\bwe(?:'ve| have) all been there\b/i,
  /\bso relatable\b/i,
  /\btell me you\b/i,
  /\bname a more iconic\b/i,
];

/**
 * Returns true if the hook starts with any banned prefix.
 * Used by both the validator (hard reject) and the scorer
 * (-5 penalty if a fallback / Llama-mutated hook somehow
 * sneaks through).
 */
export function lookupBannedHookPrefix(hook: string): boolean {
  for (const re of BANNED_HOOK_PREFIXES) {
    if (re.test(hook)) return true;
  }
  return false;
}

/**
 * Returns true if the hook contains any generic-filler phrase.
 * Used by the validator only; not penalized separately because
 * the validator-reject already removes it from the pool.
 */
export function containsGenericFiller(hook: string): boolean {
  for (const re of GENERIC_FILLER_PHRASES) {
    if (re.test(hook)) return true;
  }
  return false;
}

/**
 * Phrasings keyed by HookLanguageStyle. Each style ships ≥3
 * build-fn templates parameterized over Scenario fields
 * (s.topicNoun / s.actionShort / s.realityShort). Every entry
 * is hand-audited to:
 *   - produce hook text that passes `validateHook` for ALL 25
 *     scenarios (worst-case actionShort = 6 words,
 *     worst-case realityShort = 8 words);
 *   - never trigger any BANNED_HOOK_PREFIX or
 *     GENERIC_FILLER_PHRASES match;
 *   - express the language mode distinctly (a confession SOUNDS
 *     like a confession, a time_stamp SOUNDS like a time_stamp).
 *
 * For each style, AT LEAST ONE entry is guaranteed to pass for
 * EVERY scenario, so `pickValidatedLanguagePhrasing` never
 * returns null for a (hookLanguageStyle, scenario) pair.
 */
export const HOOK_PHRASINGS_BY_LANGUAGE_STYLE: Record<
  HookLanguageStyle,
  LanguagePhrasingEntry[]
> = {
  confession: [
    {
      build: (s) => `I keep pretending ${s.topicNoun} doesn't exist`,
      voiceProfiles: ["self_aware", "soft_confessional", "dry_humor"],
    },
    {
      build: (s) => `I told myself I'd ${s.actionShort}`,
      voiceProfiles: ["self_aware", "soft_confessional", "dry_humor"],
    },
    {
      build: (s) => `I have no plan, only ${s.realityShort}`,
      voiceProfiles: ["self_aware", "dry_humor", "deadpan"],
    },
    {
      build: (s) => `I lied about ${s.actionShort}`,
      voiceProfiles: ["self_aware", "blunt", "soft_confessional"],
    },
    {
      build: (s) => `still avoiding ${s.topicNoun}, posting instead`,
      voiceProfiles: ["chaotic", "sarcastic", "self_aware"],
    },
    {
      build: (s) => `${s.topicNoun} is my whole personality now`,
      voiceProfiles: ["poetic", "self_aware", "soft_confessional"],
    },
  ],
  observation: [
    {
      build: (s) => `there's always one ${s.topicNoun} you never deal with`,
      voiceProfiles: ["dry_humor", "deadpan", "poetic"],
    },
    {
      build: (s) => `everybody has a ${s.topicNoun} they keep avoiding`,
      voiceProfiles: ["dry_humor", "deadpan", "soft_confessional"],
    },
    {
      build: (s) => `nobody ever talks about ${s.realityShort}`,
      voiceProfiles: ["blunt", "deadpan", "sarcastic"],
    },
    {
      build: (s) => `it's always the same loop with ${s.topicNoun}`,
      voiceProfiles: ["dry_humor", "deadpan", "sarcastic"],
    },
    {
      build: (s) => `${s.topicNoun} is a personality trait apparently`,
      voiceProfiles: ["sarcastic", "chaotic", "dry_humor", "self_aware"],
    },
    {
      build: () => `the small things become the whole thing eventually`,
      voiceProfiles: ["poetic", "soft_confessional", "self_aware"],
    },
  ],
  absurd_claim: [
    {
      build: (s) => `${s.topicNoun} and I are in a standoff`,
      voiceProfiles: ["dry_humor", "sarcastic", "chaotic"],
    },
    {
      build: (s) => `${s.topicNoun} pays rent here at this point`,
      voiceProfiles: ["chaotic", "sarcastic", "dry_humor"],
    },
    {
      build: (s) => `pretty sure ${s.topicNoun} runs my schedule now`,
      voiceProfiles: ["chaotic", "sarcastic", "self_aware"],
    },
    {
      build: (s) => `${s.topicNoun} is officially a third roommate`,
      voiceProfiles: ["chaotic", "dry_humor", "sarcastic"],
    },
    {
      build: (s) => `${s.topicNoun} feels like a villain origin story`,
      voiceProfiles: ["sarcastic", "chaotic", "self_aware"],
    },
    {
      build: (s) => `${s.topicNoun} is sentient and we both know`,
      voiceProfiles: ["deadpan", "dry_humor", "chaotic"],
    },
    {
      build: (s) => `we are quietly losing to ${s.topicNoun} again`,
      voiceProfiles: ["soft_confessional", "deadpan", "dry_humor"],
    },
  ],
  matter_of_fact: [
    {
      build: (s) => `${s.topicNoun} won today, again`,
      voiceProfiles: ["blunt", "deadpan", "dry_humor"],
    },
    {
      build: (s) => `${s.topicNoun} is staying exactly where it is`,
      voiceProfiles: ["blunt", "deadpan", "dry_humor"],
    },
    {
      build: (s) => `today's update: ${s.realityShort}`,
      voiceProfiles: [
        "blunt",
        "deadpan",
        "soft_confessional",
        "dry_humor",
        "self_aware",
      ],
    },
    {
      build: (s) => `nothing changed. ${s.realityShort}.`,
      voiceProfiles: ["blunt", "deadpan", "dry_humor"],
    },
    {
      build: (s) => `no progress. ${s.topicNoun} remains.`,
      voiceProfiles: ["deadpan", "soft_confessional", "dry_humor"],
    },
  ],
  question: [
    {
      build: (s) => `at what point do we admit ${s.topicNoun}`,
      voiceProfiles: ["self_aware", "dry_humor", "blunt"],
    },
    {
      build: (s) => `how many days does ${s.topicNoun} get`,
      voiceProfiles: ["sarcastic", "dry_humor", "blunt"],
    },
    {
      build: () => `who decided this was fine again`,
      voiceProfiles: ["sarcastic", "dry_humor", "self_aware"],
    },
    {
      build: (s) => `is it really still about ${s.topicNoun}`,
      voiceProfiles: ["self_aware", "soft_confessional", "dry_humor"],
    },
    {
      build: (s) => `what if ${s.topicNoun} was the answer all along`,
      voiceProfiles: ["poetic", "self_aware", "dry_humor"],
    },
    {
      build: (s) => `how many days of pretending about ${s.topicNoun}`,
      voiceProfiles: ["soft_confessional", "self_aware", "deadpan"],
    },
  ],
  instruction: [
    {
      build: (s) => `how to avoid ${s.topicNoun} in three steps`,
      voiceProfiles: ["sarcastic", "dry_humor", "chaotic"],
    },
    {
      build: (s) => `pro tip: skip ${s.topicNoun} today`,
      voiceProfiles: ["sarcastic", "blunt", "dry_humor"],
    },
    {
      build: (s) => `tutorial: how to ignore ${s.topicNoun} forever`,
      voiceProfiles: ["sarcastic", "chaotic", "dry_humor"],
    },
    {
      build: () => `step one: stare. step two: leave.`,
      voiceProfiles: ["deadpan", "dry_humor", "sarcastic"],
    },
    {
      build: () => `lesson one: do less, see what happens`,
      voiceProfiles: ["deadpan", "soft_confessional", "dry_humor"],
    },
    {
      build: (s) => `today's reminder: ${s.topicNoun} is allowed to wait`,
      voiceProfiles: ["poetic", "self_aware", "soft_confessional"],
    },
  ],
  micro_story: [
    {
      build: (s) => `open ${s.topicNoun}, stare, close it, walk away`,
      voiceProfiles: ["deadpan", "dry_humor", "blunt"],
    },
    {
      build: (s) =>
        `looked at ${s.topicNoun}, did nothing, continued scrolling`,
      voiceProfiles: ["deadpan", "dry_humor", "blunt"],
    },
    {
      build: () => `I open it, glance, close it, pretend that counted`,
      voiceProfiles: ["self_aware", "dry_humor", "deadpan"],
    },
    {
      build: (s) => `walks past ${s.topicNoun}, nods, keeps walking`,
      voiceProfiles: ["deadpan", "dry_humor", "blunt"],
    },
    {
      build: (s) => `spent five minutes preparing to think about ${s.topicNoun}`,
      voiceProfiles: ["soft_confessional", "self_aware", "dry_humor"],
    },
    {
      build: (s) => `stood near ${s.topicNoun} like a forgotten ghost`,
      voiceProfiles: ["poetic", "soft_confessional", "deadpan"],
    },
  ],
  comparison: [
    {
      build: (s) => `morning me with ${s.topicNoun} vs night me`,
      voiceProfiles: ["dry_humor", "self_aware", "sarcastic"],
    },
    {
      build: (s) => `theory vs reality with ${s.topicNoun}`,
      voiceProfiles: ["dry_humor", "sarcastic", "self_aware"],
    },
    {
      build: () => `me at 9am vs me at 9pm`,
      voiceProfiles: ["dry_humor", "self_aware", "deadpan", "sarcastic"],
    },
    {
      build: (s) => `plans about ${s.topicNoun} vs reality`,
      voiceProfiles: ["dry_humor", "sarcastic", "deadpan"],
    },
    {
      build: (s) => `planner me vs the ${s.topicNoun} version of me`,
      voiceProfiles: ["soft_confessional", "self_aware", "poetic"],
    },
    {
      build: (s) => `future me's ${s.topicNoun} vs current me's`,
      voiceProfiles: ["self_aware", "deadpan", "soft_confessional"],
    },
  ],
  object_pov: [
    {
      build: (s) => `${s.topicNoun} watching me decide nothing again`,
      voiceProfiles: ["dry_humor", "poetic", "self_aware"],
    },
    {
      build: (s) => `${s.topicNoun}, sitting there, fully aware of everything`,
      voiceProfiles: ["poetic", "dry_humor", "deadpan"],
    },
    {
      build: (s) => `${s.topicNoun} keeps the score so nothing escapes`,
      voiceProfiles: ["poetic", "dry_humor", "blunt"],
    },
    {
      build: (s) => `${s.topicNoun} taking notes about my life again`,
      voiceProfiles: ["dry_humor", "sarcastic", "chaotic"],
    },
    {
      build: (s) => `${s.topicNoun} has seen things, ${s.topicNoun} is tired`,
      voiceProfiles: ["poetic", "soft_confessional", "dry_humor"],
    },
    {
      build: (s) => `the ${s.topicNoun} is smug about today, frankly`,
      voiceProfiles: ["sarcastic", "chaotic", "dry_humor"],
    },
    {
      build: (s) => `${s.topicNoun} just observing the disaster quietly`,
      voiceProfiles: ["dry_humor", "soft_confessional", "deadpan"],
    },
  ],
  time_stamp: [
    {
      build: (s) => `11:48pm and I'm still negotiating with ${s.topicNoun}`,
      voiceProfiles: ["soft_confessional", "self_aware", "dry_humor"],
    },
    {
      build: (s) => `7am plan: ${s.actionShort}`,
      voiceProfiles: ["blunt", "deadpan", "dry_humor"],
    },
    {
      build: (s) => `it's tuesday and ${s.topicNoun} has not moved`,
      voiceProfiles: ["deadpan", "dry_humor", "blunt"],
    },
    {
      build: (s) => `12:14am: still in standoff with ${s.topicNoun}`,
      voiceProfiles: [
        "soft_confessional",
        "self_aware",
        "dry_humor",
        "deadpan",
      ],
    },
    {
      build: (s) => `monday and ${s.topicNoun} is winning, news at eleven`,
      voiceProfiles: ["sarcastic", "dry_humor", "chaotic"],
    },
    {
      build: (s) => `3pm and the ${s.topicNoun} is somehow louder`,
      voiceProfiles: ["poetic", "soft_confessional", "self_aware"],
    },
  ],
  anti_hook: [
    {
      build: (s) => `anyway, ${s.topicNoun}`,
      voiceProfiles: ["deadpan", "dry_humor", "blunt"],
    },
    {
      build: (s) => `not great with ${s.topicNoun} today`,
      voiceProfiles: ["deadpan", "soft_confessional", "dry_humor"],
    },
    {
      build: (s) => `so. ${s.topicNoun}.`,
      voiceProfiles: ["deadpan", "blunt", "dry_humor"],
    },
    {
      build: (s) => `here we are with ${s.topicNoun}`,
      voiceProfiles: ["deadpan", "soft_confessional", "dry_humor"],
    },
    {
      build: (s) => `${s.topicNoun}. that's the whole post.`,
      voiceProfiles: ["sarcastic", "chaotic", "deadpan", "dry_humor"],
    },
    {
      build: (s) => `${s.topicNoun} and a quiet kind of nothing`,
      voiceProfiles: ["poetic", "soft_confessional", "deadpan"],
    },
    {
      build: (s) => `introducing: ${s.topicNoun} again, shockingly`,
      voiceProfiles: ["sarcastic", "self_aware", "dry_humor"],
    },
  ],
  escalation_hook: [
    {
      build: (s) => `started with ${s.topicNoun}, ended somewhere worse`,
      voiceProfiles: ["chaotic", "sarcastic", "self_aware"],
    },
    {
      build: (s) => `tried to handle ${s.topicNoun}, did the opposite`,
      voiceProfiles: ["chaotic", "sarcastic", "self_aware", "dry_humor"],
    },
    {
      build: (s) => `one job around ${s.topicNoun}, you can guess`,
      voiceProfiles: ["sarcastic", "dry_humor", "chaotic"],
    },
    {
      build: (s) =>
        `${s.topicNoun} started small, this is no longer small`,
      voiceProfiles: ["chaotic", "sarcastic", "dry_humor"],
    },
    {
      build: (s) => `${s.topicNoun} went from small to entire personality`,
      voiceProfiles: ["chaotic", "sarcastic", "self_aware"],
    },
    {
      build: (s) => `thought I'd manage ${s.topicNoun}, now its hostage`,
      voiceProfiles: ["chaotic", "dry_humor", "soft_confessional"],
    },
    {
      build: (s) => `the ${s.topicNoun} ate my afternoon, peacefully`,
      voiceProfiles: ["poetic", "chaotic", "dry_humor"],
    },
    {
      build: (s) => `started managing ${s.topicNoun}, now we live together`,
      voiceProfiles: ["poetic", "soft_confessional", "deadpan"],
    },
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

/**
 * `whatToShow` is now driven by the scenario's `sceneBeat` — a hand-
 * written 1–2 sentence physical moment that's specific to the family
 * (the gym bag stays in bed, the closet pile gets sat in, the
 * neighbour gets the over-laugh). Replaces the previous generic
 * "Open on you in the {setting}. Beat. Then the reaction lands…"
 * template that produced near-identical copy across families.
 *
 * The template-shape tail still varies (contrast vs hold-the-beat)
 * so contrast-pattern ideas read as cuts and non-contrast read as
 * single-take holds. Char budget: ~280–420 (well inside the 20–500
 * schema window).
 */
function buildWhatToShow(scenario: Scenario, template: Template): string {
  const tail = template.hasContrast
    ? ` Cut between what you said you'd do and the contradiction — end on the deadpan, no music sting.`
    : ` Hold the final beat for a full second before cutting — let the silence do the work.`;
  return `${scenario.sceneBeat}${tail}`;
}

/**
 * Per-visualActionPattern filming directions. Replaces the previous
 * generic "Phone propped at chest height in the {setting}" boilerplate
 * that read identically across every batch regardless of the actual
 * physical scene. Each variant gives a CONCRETE camera placement
 * tied to the visual action (mirror straight-on, fridge low-side,
 * dashboard mount, hallway two-shot, etc.) so two ideas with
 * different `visualActionPattern` values produce visibly different
 * filming language. Within a batch, `batchGuardsPass` enforces no
 * two ideas with byte-identical `howToFilm` strings.
 *
 * Char budget: each variant 200–350 chars (inside the 15–400 schema
 * window). Some templates substitute `topicNoun` (kitchen, desk) for
 * specificity; others are scenario-agnostic (face_reaction_deadpan).
 */
const HOW_TO_FILM_BY_VISUAL_ACTION: Record<
  VisualActionPattern,
  (s: Scenario) => string
> = {
  phone_scroll_freeze: (s) =>
    `Hold the phone vertically right at face level so the screen glow lights you. Single static shot, ${s.settingDetail}. Let the scroll itself be the action — no cutaways, no music. Brightness all the way up so the glow reads on camera.`,
  text_message_panic: () =>
    `Tight overhead on the phone — keyboard and unread thread fill the whole frame. Don't show your face; the thumb hesitation IS the shot. Hold for a beat after the screen locks before cutting.`,
  kitchen_contradiction: (s) =>
    `Camera at counter height, framing you and ${s.topicNoun} in the same shot. Single take, ${s.settingDetail}. Walk in, look, decide, walk out — let the geography of the kitchen tell the contradiction.`,
  fridge_open_stare: () =>
    `Camera low and to the side so the fridge light hits your face when the door opens. Hold the open-fridge stare for a full two seconds before you close it. Single take, no edits.`,
  bedroom_avoidance: (s) =>
    `Hand-held from inside the bed, low angle looking out at ${s.topicNoun}. The blanket and pillow stay in the bottom of the frame to anchor the avoidance. One shot, no cuts.`,
  outfit_check_cut: () =>
    `Two shots, hard cut: first you in the new look (mirror or wide), then the same exact frame in the hoodie. Match the framing precisely so the cut hits — no music, no transition.`,
  couch_avoidance: () =>
    `Camera at couch level, far enough back that the blanket and the phone are both in frame. Single take. Stay seated through the whole beat — the not-getting-up is the joke.`,
  car_avoidance: () =>
    `Phone mounted on the dashboard pointing at the driver's seat. Hands stay on the wheel except for the one specific gesture (key, phone, list). Single take, engine sound on.`,
  desk_avoidance: (s) =>
    `Camera looking down at the desk from your seated POV — laptop, phone, and ${s.topicNoun} all in frame. Don't show your face; the desk surface does the work. One take.`,
  social_awkward_walkaway: () =>
    `Two angles: wide of the hallway for the encounter (8 sec), hard cut to tight on your face for the cringe walk back (4 sec). Cut on the wave, not after.`,
  face_reaction_deadpan: () =>
    `Phone at eye level, your face fills two-thirds of the frame. Single locked-off shot. Let the silence run — no music, no cuts, no movement. The deadpan IS the entire video.`,
  mirror_self_call_out: () =>
    `Film straight into the bathroom mirror with the phone at chest height in your other hand. The reflection IS the shot — your eyes lock on yours for the whole beat. Bathroom light only, no overhead.`,
  doorway_retreat: () =>
    `Camera placed behind you in the doorway, looking out at what you were supposed to do. Take one beat at the threshold, then turn back into frame and walk away. The retreat is the punchline.`,
};

function buildHowToFilm(
  scenario: Scenario,
  visualActionPattern: VisualActionPattern,
): string {
  const fn =
    HOW_TO_FILM_BY_VISUAL_ACTION[visualActionPattern] ??
    HOW_TO_FILM_BY_VISUAL_ACTION.face_reaction_deadpan;
  return fn(scenario);
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
  /**
   * SOFT-diversity dimensions derived from `scenarioFamily`. Used by
   * the novelty scorer + selector to prevent batches that are
   * structurally distinct but feel like clones (same physical scene
   * or same topic lane). Always set on pattern_variation candidates;
   * Claude/Llama fallback may omit when the family isn't in our
   * registered taxonomy.
   */
  visualActionPattern: VisualActionPattern;
  topicLane: TopicLane;
  /**
   * The opener classification of the assembled hook. Used by the
   * batch guards (HARD: max 1 per batch) and the novelty scorer
   * (cross-batch demotion). Always set on pattern_variation
   * candidates because the assembler picks an entry whose `opener`
   * is known. Claude/Llama fallback wraps may omit (the fallback
   * wrap layer derives via `lookupHookOpener`).
   */
  hookOpener: HookOpener;
  /**
   * Narrative-shape diversity axis. Resolved at assembly time from
   * `(template.id, scenario.family)` via `resolveScriptType` —
   * SCRIPT_TYPE_OVERRIDES first, then SCRIPT_TYPE_BY_FAMILY default.
   * Drives the spec's HARD batch guards (max 2 per batch, reject
   * all-in-cluster) and the cross-batch tiered history rule
   * (-3 last batch / -2 frequent in last 3 / +3 unused in last 3).
   * Optional on the type so Claude/Llama fallback wraps can omit
   * when the family/templateId aren't in our taxonomy; readers
   * fall back to `lookupScriptType(family, templateId)` and treat
   * unresolvable as "no contribution to scriptType axis".
   */
  scriptType?: ScriptType;
  /**
   * Energy classification (active / low / medium) derived from
   * `visualActionPattern` via ENERGY_BY_VISUAL_ACTION. Used by the
   * "reject all-low-energy" batch guard. Optional only because
   * Claude/Llama fallback wraps may not set visualActionPattern.
   */
  energy?: Energy;
  /**
   * Archetype + family — derived from `scriptType` via
   * `resolveArchetype`. Drives the IDEA ARCHETYPE spec's HARD batch
   * guards (max 1 archetype + max 1 family per batch) and the cross-
   * batch penalties (-4 same archetype, -2 same family in immediate-
   * prior batch). Optional so Claude/Llama fallback wraps can omit
   * when scriptType isn't set; readers fall back to
   * `resolveArchetypeLoose(lookupScriptType(family, templateId))` and
   * treat unresolvable as "no contribution to archetype axis".
   */
  archetype?: Archetype;
  archetypeFamily?: ArchetypeFamily;
  /**
   * Scene-object tag + environment cluster — derived from
   * `scenarioFamily` via `lookupSceneObjectTag`. Drives the SCENE-
   * OBJECT TAG spec's HARD batch guards (max 1 tag + max 1 cluster
   * per batch) and the cross-batch tiered history (-3 last batch /
   * -2 frequent in last 3 / +3 unused in last 3 — analogous to the
   * scriptType axis). Optional with the same fallback discipline as
   * `archetype` above.
   */
  sceneObjectTag?: SceneObjectTag;
  sceneEnvCluster?: SceneEnvCluster;
  /**
   * Language-mode classification of the hook (12 values: confession,
   * observation, absurd_claim, matter_of_fact, question, instruction,
   * micro_story, comparison, object_pov, time_stamp, anti_hook,
   * escalation_hook). Drives the HOOK STYLE spec's HARD batch guard
   * (reject when all 3 picks share same hookLanguageStyle), the
   * cross-batch penalty/boost (-3 same as last batch / +2 unused in
   * last 3 batches), and the regen rescue pass (≥1 fresh language
   * style on regenerate). Optional so Claude/Llama fallback wraps
   * can omit; readers treat undefined as "no contribution to the
   * hookLanguageStyle axis" (same discipline as `archetype`).
   */
  hookLanguageStyle?: HookLanguageStyle;
  /**
   * Style/tone layer (8 values: dry_humor, chaotic, poetic, blunt,
   * sarcastic, self_aware, deadpan, soft_confessional). Resolved
   * once per generation via `selectPrimaryVoiceProfile` (priority:
   * tasteCalibration → styleHints → vision → default rotation),
   * then per-slot rotated through `ALLOWED_VOICES_BY_PRIMARY[primary]`
   * by `pickVoiceForSlot`. Drives the VOICE PROFILES spec's HARD
   * batch guard (reject 3-identical voice unless calibration
   * strongPreference), the cross-batch -2/-2 stacking penalty, and
   * the regen rescue pass (≥1 fresh voice on regenerate). Optional
   * so Claude/Llama fallback wraps + legacy cache entries can omit;
   * readers treat undefined as "no contribution to the voiceProfile
   * axis" (same discipline as `archetype` / `hookLanguageStyle`).
   * Does NOT affect safety, quality, scenario, or archetype paths.
   */
  voiceProfile?: VoiceProfile;
};

/**
 * Try each phrasing of the chosen hookStyle in seed-rotated order,
 * returning the first that passes `validateHook`. Returns null if
 * NO phrasing in the style produces a shippable hook for this
 * scenario — caller skips the (template, scenario, style) triple
 * rather than ship a broken hook.
 *
 * This replaces the old "pick one + clampHookWords + ship" flow,
 * which produced dangling-fragment hooks when the chosen phrasing
 * ran past 10 words for the chosen scenario.
 *
 * Returns the entry + its index so PatternMeta can record which
 * phrasing variant actually shipped (rewriter uses this).
 */
function pickValidatedPhrasing(
  hookStyle: HookStyle,
  scenario: Scenario,
  tone: DerivedTone,
  seed: number,
): { entry: HookPhrasingEntry; index: number; hook: string } | null {
  const phrasings = HOOK_PHRASINGS_BY_STYLE[hookStyle];
  const n = phrasings.length;
  // Rotate the start index by the seed so different (template,
  // scenario, style) triples don't all pick phrasings[0]. Defensive
  // double-modulo collapses any sign.
  const start = ((seed % n) + n) % n;
  for (let offset = 0; offset < n; offset++) {
    const idx = (start + offset) % n;
    const entry = phrasings[idx]!;
    const candidate = toneInflect(entry.build(scenario), tone).trim();
    if (validateHook(candidate)) {
      return { entry, index: idx, hook: candidate };
    }
  }
  return null;
}

/**
 * HookLanguageStyle counterpart to `pickValidatedPhrasing`. Iterates
 * the new HOOK_PHRASINGS_BY_LANGUAGE_STYLE catalog in seed-rotated
 * order, returning the first entry whose built hook passes
 * `validateHook` (which now ALSO rejects banned-prefix matches +
 * generic-filler matches via the extended validator above).
 *
 * The catalog is hand-audited so EVERY (hookLanguageStyle, scenario)
 * pair has at least one passing entry, but we still return null on
 * exhaustion as a safety rail — the Cartesian weave will offer many
 * more (template, scenario, languageStyle) triples before maxIter.
 */
function pickValidatedLanguagePhrasing(
  hookLanguageStyle: HookLanguageStyle,
  scenario: Scenario,
  tone: DerivedTone,
  seed: number,
  voiceProfile?: VoiceProfile,
): { entry: LanguagePhrasingEntry; index: number; hook: string } | null {
  const phrasings = HOOK_PHRASINGS_BY_LANGUAGE_STYLE[hookLanguageStyle];
  const n = phrasings.length;
  const start = ((seed % n) + n) % n;

  // Voice-aware selection (THREE-PASS):
  //   Pass 1: prefer entries whose `voiceProfiles` contains the
  //           requested voice (the spec's "voice should affect the
  //           hook wording" rule — same HLS × different voice =
  //           different phrasing).
  //   Pass 2: voice-NEUTRAL entries (no `voiceProfiles` tag — these
  //           read fine in any voice, used as a graceful fallback
  //           when no voice-tagged entry is shippable).
  //   Pass 3: ANY entry that passes `validateHook` (preserves the
  //           existing safety net — same behavior as before voice
  //           was added when voiceProfile is undefined).
  // The seed-rotated start index is the same across all three passes
  // so a given (seed, scenario, hls, voice) tuple is deterministic.
  if (voiceProfile) {
    for (let offset = 0; offset < n; offset++) {
      const idx = (start + offset) % n;
      const entry = phrasings[idx]!;
      if (!entry.voiceProfiles?.includes(voiceProfile)) continue;
      const candidate = toneInflect(entry.build(scenario), tone).trim();
      if (validateHook(candidate)) {
        return { entry, index: idx, hook: candidate };
      }
    }
    for (let offset = 0; offset < n; offset++) {
      const idx = (start + offset) % n;
      const entry = phrasings[idx]!;
      if (entry.voiceProfiles !== undefined) continue;
      const candidate = toneInflect(entry.build(scenario), tone).trim();
      if (validateHook(candidate)) {
        return { entry, index: idx, hook: candidate };
      }
    }
  }
  for (let offset = 0; offset < n; offset++) {
    const idx = (start + offset) % n;
    const entry = phrasings[idx]!;
    const candidate = toneInflect(entry.build(scenario), tone).trim();
    if (validateHook(candidate)) {
      return { entry, index: idx, hook: candidate };
    }
  }
  return null;
}

function assembleCandidate(
  template: Template,
  scenario: Scenario,
  hookLanguageStyle: HookLanguageStyle,
  tone: DerivedTone,
  hookPhrasingIndex: number,
  captionPhrasingIndex: number,
  voiceProfile?: VoiceProfile,
): { idea: Idea; meta: PatternMeta } | null {
  const picked = pickValidatedLanguagePhrasing(
    hookLanguageStyle,
    scenario,
    tone,
    hookPhrasingIndex,
    voiceProfile,
  );
  if (!picked) return null;
  const { index, hook } = picked;
  // Legacy hookStyle field is DERIVED from hookLanguageStyle via
  // the lossy backward-compat mapping. Every value is a valid
  // legacy HookStyle so the JSONB cache, viralPatternMemory, and
  // quality scorer paths that read `hookStyle` keep working
  // unchanged. The mapping never produces "the_way_i" or
  // "why_do_i" since the new catalog never produces those
  // phrasings — exactly the spec's PART 4 intent.
  const hookStyle: HookStyle =
    HOOK_LANGUAGE_STYLE_TO_LEGACY_HOOK_STYLE[hookLanguageStyle];
  // hookOpener is DERIVED from the assembled hook text via the
  // existing regex set. Most new-catalog phrasings don't match
  // any of the 9 legacy opener patterns, so this returns null —
  // the diversity tracker treats null as "no opener info, no
  // penalty" (same discipline as Claude/Llama fallback hooks).
  const derivedOpener = lookupHookOpener(hook);

  const captionPhrasings = CAPTION_PHRASINGS[template.structure];
  const rawCaption = pickPhrasing(captionPhrasings, captionPhrasingIndex)(scenario);
  // Apply the per-voice caption transform when a voice was selected
  // for this slot. Idempotent (no-op if the caption already matches
  // the voice) and never increases length by more than 2 chars, so
  // length-sensitive downstream paths are unaffected.
  const caption = voiceProfile
    ? applyVoiceToCaption(rawCaption, voiceProfile)
    : rawCaption;

  // Resolve the visual-action lookup ONCE so both the howToFilm
  // builder and PatternMeta agree on which variant the candidate
  // belongs to. Family-not-registered fallback keeps PatternMeta
  // non-null (paranoia — every hard-coded family is in the table).
  const visualActionPattern: VisualActionPattern =
    VISUAL_ACTION_BY_FAMILY[scenario.family] ?? "face_reaction_deadpan";

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
    howToFilm: buildHowToFilm(scenario, visualActionPattern),
  };

  // Resolve scriptType ONCE so the archetype derivation and the
  // PatternMeta tag agree on which value drives both axes. The
  // archetype + archetypeFamily fall out deterministically from
  // scriptType via the IDEA ARCHETYPE spec's resolver; sceneObjectTag
  // + cluster fall out from scenarioFamily via the SCENE-OBJECT TAG
  // spec's lookup. All four are best-effort — an unresolved scriptType
  // (legacy taxonomy gap) leaves archetype undefined, which the
  // selector treats as "no contribution to archetype axis" (same
  // discipline as the existing optional fields above).
  const scriptType = resolveScriptType(template.id, scenario.family);
  const archetypeResolved = resolveArchetype(scriptType);
  const sceneObjectTag = lookupSceneObjectTag(scenario.family) ?? undefined;
  const sceneEnvCluster: SceneEnvCluster | undefined = sceneObjectTag
    ? ENV_CLUSTER_BY_TAG[sceneObjectTag]
    : undefined;

  return {
    idea,
    meta: {
      source: "pattern_variation",
      templateId: template.id,
      scenarioFamily: scenario.family,
      hookStyle,
      hookPhrasingIndex: index,
      scenario,
      visualActionPattern,
      topicLane:
        TOPIC_LANE_BY_FAMILY[scenario.family] ?? "daily_routine",
      // hookOpener falls through derived value (may be undefined for
      // new-catalog phrasings whose start matches none of the 9
      // legacy regex patterns — diversity tracker handles undefined
      // as "no opener info"). PatternMeta declares hookOpener as
      // non-optional so we cast — undefined is safe at runtime
      // (every read site in the codebase fallbacks via `?? null`).
      hookOpener: derivedOpener as HookOpener,
      scriptType,
      energy: ENERGY_BY_VISUAL_ACTION[visualActionPattern],
      archetype: archetypeResolved?.archetype,
      archetypeFamily: archetypeResolved?.family,
      sceneObjectTag,
      sceneEnvCluster,
      hookLanguageStyle,
      voiceProfile,
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
  /**
   * Pre-resolved voice profile selection (computed by the orchestrator
   * via `selectPrimaryVoiceProfile` from creator's calibration / hints
   * / vision data). Optional so legacy callers + tests that only need
   * the structural pipeline can omit — when omitted, this function
   * derives a default rotation from the profile's `deriveStyleHints`
   * tone alone (no calibration / vision tier visible from here).
   * Passing the orchestrator-resolved selection in is preferred so
   * the same selection drives both generation AND the cross-batch
   * `strongPreference` flag in the downstream batch guard.
   */
  voiceSelection?: VoiceProfileSelection;
};

export type PatternCandidate = { idea: Idea; meta: PatternMeta };

/**
 * Generate 12–20 deterministic pattern-based candidates.
 *
 * The candidate set is biased toward the creator's top structure /
 * emotionalSpike when memory is available, with ~25% adjacent
 * exploration so the batch never calcifies. No two candidates
 * share the same (templateId, scenarioFamily, hookLanguageStyle)
 * triple. The H axis iterates the new 12-value HookLanguageStyle
 * catalog (was 5-value HookStyle) so each batch surfaces a far
 * broader spread of language modes. Order matters — earlier
 * entries are higher-priority for the downstream scorer's
 * tie-breaks.
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

  // Resolve the voice selection ONCE per generation. Caller-supplied
  // selection wins (orchestrator already wove calibration / hints /
  // vision into a primary + allowed-set + strongPreference flag);
  // when omitted, fall back to the hint-only resolver derived from
  // the profile alone — calibration + vision tiers aren't visible
  // from here so they collapse to the default rotation. The selected
  // `allowed` set drives per-slot voice rotation in the Cartesian
  // inner loop below.
  const voiceSelection: VoiceProfileSelection =
    input.voiceSelection ??
    selectPrimaryVoiceProfile({
      hintsTone: deriveStyleHints(input.profile).tone,
      rotationSeed: input.regenerateSalt ?? 0,
    });
  const allowedVoices = voiceSelection.allowed;

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

  // Hook-language-style rotation: the H axis of the Cartesian was
  // previously the legacy 5-value HookStyle catalog; it now iterates
  // the new 12-value HookLanguageStyle catalog so each batch surfaces
  // far more language modes (confession, observation, instruction,
  // time_stamp, …) instead of recycling the same 5 phrasing patterns.
  //
  // Memory bias for the legacy hookStyle is INTENTIONALLY DROPPED at
  // the H axis — the memory module tracks `hookStyles` (5 buckets,
  // populated by historical posts) but not `hookLanguageStyles` (the
  // new axis has no historical signal yet). We still order templates
  // by memTopStructure + memTopSpike above, so the creator's
  // strongest structural pattern still surfaces first. The legacy
  // memTopHookStyle remains computed (and read by the rewriter +
  // novelty scorer paths) but no longer drives generation order.
  const styleOrder: HookLanguageStyle[] = [...HOOK_LANGUAGE_STYLES];
  // Reference memTopHookStyle so its computation isn't dead-code
  // eliminated by the linter — the value still flows through
  // memory-bias paths in tryRewrite + scorer; we just don't use it
  // to reorder the H axis anymore (no historical signal for the new
  // 12-value axis).
  void memTopHookStyle;

  const seen = new Set<string>();
  const out: PatternCandidate[] = [];
  // Salt the seed when regenerating so the (template, scenario,
  // languageStyle) weave shifts deterministically — same inputs never
  // produce the same 12 candidates twice in a row. Caller-supplied
  // salt (typically a hash of the previous batch + a millisecond
  // cursor) gives every regenerate call a different starting offset.
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

  // Cartesian-diagonal weave: each axis (template, scenario,
  // languageStyle) advances every iteration at its own rate. With
  // T=6, S=25, H=12 and target=16 this guarantees a far broader
  // language-mode spread per batch than the previous H=5 setup —
  // the Layer 4 diversifier sees ≥12 distinct hookLanguageStyles
  // available before any guard kicks in. The seen-key still
  // includes hookLanguageStyle so two candidates with the same
  // (templateId, scenarioFamily, languageStyle) triple are still
  // de-duped.
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
  // Track voices already emitted so the per-slot picker can rotate
  // away from over-represented voices toward the rest of the allowed
  // set. Reset is unnecessary — the picker is monotonic per generation
  // call, and a fresh call from the orchestrator gets a fresh pool.
  const slotsAlreadyVoiced: VoiceProfile[] = [];
  while (out.length < target && i < maxIter) {
    const t = orderedTemplates[(i + tOff) % T];
    const s = orderedScenarios[(i + sOff) % S];
    const hls = styleOrder[(i + hOff) % H];
    const key = `${t.id}|${s.family}|${hls}`;
    i++;
    if (seen.has(key)) continue;
    seen.add(key);
    // Pick the voice for THIS slot before assembling so the phrasing
    // selector can prefer entries tagged with the matching voice. The
    // slot index used by the picker is `out.length` (the position the
    // candidate would occupy on success) — NOT `i` — so failed-build
    // attempts don't burn voice rotation slots. The scenarioSeed is
    // a small fold of (template, scenario, hls) so the same triple
    // would produce the same voice across regenerate calls when the
    // rotationSeed lines up — important for the cache-replay path.
    // INSIDE the Cartesian inner loop (per spec), NOT a new outer
    // axis — would explode the pool 8× to 96 candidates.
    const scenarioSeed =
      ((t.id.length * 31 + s.family.length * 17 + hls.length) >>> 0) ^ seedSalt;
    // pickVoiceForSlot is a pure round-robin over `allowedVoices`
    // — primary-first bias is already baked into the array order
    // by `selectPrimaryVoiceProfile` (allowed = ALLOWED_VOICES_BY_
    // PRIMARY[primary], with primary at index 0). Using out.length
    // (not the Cartesian iter `i`) means failed-build attempts
    // don't burn voice rotation slots, which is the property the
    // 5-arg form was originally going to model — collapsed into
    // the 2-arg signature now that order-encodes-priority.
    const voiceForSlot = pickVoiceForSlot(out.length, allowedVoices);
    void scenarioSeed;
    void slotsAlreadyVoiced;
    void voiceSelection.primary;
    // assembleCandidate returns null when NO phrasing in the chosen
    // hookLanguageStyle passes `validateHook` for this scenario (e.g.
    // every variant overruns 10 words for the longest realityShort,
    // or every variant matches a banned-prefix). Skip the triple
    // silently — the weave will offer many more before hitting
    // maxIter (T·S·H = 6·25·12 = 1800 triples).
    const built = assembleCandidate(
      t,
      s,
      hls,
      tone,
      i + seedSalt,
      (i * 3 + seedSalt) % 7,
      voiceForSlot,
    );
    if (built !== null) {
      out.push(built);
      slotsAlreadyVoiced.push(voiceForSlot);
    }
  }

  return interleaveByScriptType(applyPoolCaps(out));
}

/**
 * Hard distribution caps applied to the candidate pool BEFORE interleave
 * (per script-system FINAL spec §3). Ensures no single scriptType — and
 * neither the avoidance nor the internal_contradiction cluster — can
 * dominate the downstream selector's pool:
 *   - Per-scriptType cap:  ceil(N * 0.20)  (≤20% any single scriptType)
 *   - Per-cluster   cap:   ceil(N * 0.40)  (≤40% avoidance OR
 *                                           internal_contradiction)
 *
 * Tail-drop preserves the upstream Cartesian-weave + memory-bias
 * ordering for the entries that survive (we drop OVERFLOW entries
 * encountered after the cap, never reorder kept entries). For pools
 * with ≤5 entries the caps are no-ops — the pool is already small
 * enough that any single dominant scriptType is structural rather
 * than fixable by pruning. Candidates without a scriptType (legacy
 * / fallback paths) bypass the per-scriptType cap but still count
 * toward total N for cap calculation; cluster caps don't apply to
 * them.
 */
export function applyPoolCaps(
  candidates: PatternCandidate[],
): PatternCandidate[] {
  if (candidates.length <= 5) return candidates;
  const N = candidates.length;
  const perTypeCap = Math.max(1, Math.ceil(N * 0.20));
  const perClusterCap = Math.max(1, Math.ceil(N * 0.40));
  const typeCounts = new Map<ScriptType, number>();
  let avoidanceCount = 0;
  let internalContradictionCount = 0;
  const out: PatternCandidate[] = [];
  for (const c of candidates) {
    const sct = c.meta.scriptType;
    if (!sct) {
      out.push(c);
      continue;
    }
    const tc = typeCounts.get(sct) ?? 0;
    if (tc >= perTypeCap) continue;
    if (
      SCRIPT_TYPE_CLUSTERS.avoidance.has(sct) &&
      avoidanceCount >= perClusterCap
    ) {
      continue;
    }
    if (
      SCRIPT_TYPE_CLUSTERS.internal_contradiction.has(sct) &&
      internalContradictionCount >= perClusterCap
    ) {
      continue;
    }
    typeCounts.set(sct, tc + 1);
    if (SCRIPT_TYPE_CLUSTERS.avoidance.has(sct)) avoidanceCount++;
    if (SCRIPT_TYPE_CLUSTERS.internal_contradiction.has(sct)) {
      internalContradictionCount++;
    }
    out.push(c);
  }
  return out;
}

/**
 * Round-robin interleave the candidate pool by `meta.scriptType`.
 * Buckets candidates by scriptType, then emits one from each bucket
 * per pass until empty. Guarantees that the FIRST 6+ candidates span
 * ≥6 distinct scriptTypes when the natural pool supports it (i.e.
 * at least 6 buckets exist), making the downstream selector's job
 * dramatically easier — the highest-quality picks no longer all
 * cluster on the same narrative shape just because that scriptType's
 * scenarios sorted to the front of the Cartesian weave.
 *
 * Soft, NOT hard: never drops candidates. Candidates with no
 * scriptType (legacy / fallback paths that may not resolve a
 * taxonomy entry) bucket under "_unknown" and are interleaved
 * alongside the typed buckets so they still ship.
 *
 * Bucket order = first-appearance order in the input, which preserves
 * the upstream memory bias (the creator's top-structure scenarios
 * surface their scriptType buckets first in the rotation).
 */
function interleaveByScriptType(
  candidates: PatternCandidate[],
): PatternCandidate[] {
  if (candidates.length <= 1) return candidates;
  const buckets = new Map<string, PatternCandidate[]>();
  const order: string[] = [];
  for (const c of candidates) {
    const key = c.meta.scriptType ?? "_unknown";
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
      order.push(key);
    }
    bucket.push(c);
  }
  // Single bucket → no reordering needed (preserves input order
  // exactly, which is what the diagonal-weave produces).
  if (order.length === 1) return candidates;
  const out: PatternCandidate[] = [];
  while (out.length < candidates.length) {
    for (const k of order) {
      const arr = buckets.get(k)!;
      if (arr.length > 0) out.push(arr.shift()!);
    }
  }
  return out;
}
