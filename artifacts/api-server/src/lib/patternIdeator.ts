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
 *   • does NOT end on `…` or `...` (truncation marker).
 * Returns true iff the hook is shippable.
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

function assembleCandidate(
  template: Template,
  scenario: Scenario,
  hookStyle: HookStyle,
  tone: DerivedTone,
  hookPhrasingIndex: number,
  captionPhrasingIndex: number,
): { idea: Idea; meta: PatternMeta } | null {
  const picked = pickValidatedPhrasing(
    hookStyle,
    scenario,
    tone,
    hookPhrasingIndex,
  );
  if (!picked) return null;
  const { entry, index, hook } = picked;

  const captionPhrasings = CAPTION_PHRASINGS[template.structure];
  const caption = pickPhrasing(captionPhrasings, captionPhrasingIndex)(scenario);

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
      hookOpener: entry.opener,
      scriptType,
      energy: ENERGY_BY_VISUAL_ACTION[visualActionPattern],
      archetype: archetypeResolved?.archetype,
      archetypeFamily: archetypeResolved?.family,
      sceneObjectTag,
      sceneEnvCluster,
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
    // assembleCandidate returns null when NO phrasing in the chosen
    // hookStyle passes `validateHook` for this scenario (e.g. every
    // variant overruns 10 words for the longest actionShort). Skip
    // the triple silently — the weave will offer many more before
    // hitting maxIter.
    const built = assembleCandidate(
      t,
      s,
      hs,
      tone,
      i + seedSalt,
      (i * 3 + seedSalt) % 7,
    );
    if (built !== null) out.push(built);
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
