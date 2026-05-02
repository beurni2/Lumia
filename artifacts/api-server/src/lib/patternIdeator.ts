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
import { resolvePremiseCoreIdForLocalCandidate } from "./premiseCoreLocalMapping";
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
import {
  selectTrendForCandidate,
  applyTrendToCaption,
  validateTrendInjection,
  type TrendItem,
} from "./trendCatalog";

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

/**
 * Phase 3B PART 2 — coarse semantic class for a scenario's
 * `topicNoun`. Used by `LanguagePhrasingEntry.allowedNounTypes` to
 * gate template-noun composition before `entry.build(scenario)` is
 * called, eliminating semantically-broken pairs at the source
 * ("future me thinks about the sneeze", "the wave watching me
 * decide nothing") rather than relying on the post-build syntactic
 * validator.
 *
 *   - `object`     — concrete physical thing (the fridge, the mug)
 *   - `abstract`   — concept / persona / emotion (the compliment, the password)
 *   - `action`     — an activity treated as a noun (the brushing, the wave)
 *   - `place`      — a location (the front step, the bathroom)
 *   - `event`      — a happening at a point in time (the meeting, the sneeze)
 *   - `body_state` — physical sensation/condition (the soreness, the smell)
 *   - `person`     — reserved for future scenarios; no current scenario uses
 *                   a person as topicNoun.
 *
 * Add a value here only when a new scenario class needs it; templates
 * that omit `allowedNounTypes` accept any type by default, so the
 * gate is opt-in per template.
 */
export type TopicNounType =
  | "object"
  | "abstract"
  | "action"
  | "place"
  | "event"
  | "body_state"
  | "person";

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
  /**
   * Phase 3B PART 2 — coarse semantic class for `topicNoun`. REQUIRED
   * so a new scenario cannot ship without classification (the picker's
   * `allowedNounTypes` gate would silently abstain on undefined and
   * un-gate the scenario, defeating the rail). See `TopicNounType`
   * for value semantics. When a noun could plausibly satisfy two
   * types (e.g. "the meeting" is both event AND has place flavor),
   * choose the dominant template-affinity class — `event` here, since
   * "future me thinks about the meeting" + "the meeting watching me
   * decide" both read as event-of-time, not as place.
   */
  topicNounType: TopicNounType;
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
    topicNounType: "object",
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
    topicNounType: "object",
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
    topicNounType: "object",
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
    topicNounType: "object",
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
    topicNounType: "object",
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
    topicNounType: "object",
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
    topicNounType: "object",
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
    topicNounType: "object",
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
    topicNounType: "object",
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
    topicNounType: "object",
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
    topicNounType: "object",
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
    topicNounType: "object",
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
    topicNounType: "place",
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
    topicNounType: "place",
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
    topicNounType: "object",
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
    topicNounType: "object",
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
    topicNounType: "object",
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
    topicNounType: "object",
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
    topicNounType: "object",
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
    topicNounType: "object",
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
    topicNounType: "object",
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
    topicNounType: "object",
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
    topicNounType: "place",
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
    topicNounType: "object",
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
    topicNounType: "object",
  },
  // ---------------------------------------------------------------------------
  // Phase 2 — 58 new scenarios, family-balanced across the 12 IdeaCoreFamilies.
  // Each new family also wired into IDEA_CORE_TYPE_BY_FAMILY,
  // VISUAL_ACTION_BY_FAMILY, TOPIC_LANE_BY_FAMILY, SCRIPT_TYPE_BY_FAMILY, and
  // SCENE_OBJECT_TAG_BY_FAMILY (sceneObjectTaxonomy.ts).
  // ---------------------------------------------------------------------------

  // emotional_loop (+5)
  {
    family: "tipping_internal",
    triggerCategory: "environment",
    setting: "outside",
    settingDetail: "at a restaurant table, bill folder just landed",
    sceneBeat:
      "Bill lands. You open it, scan the total, do the math three times in your head, settle on a percentage you'll later regret, and slide your card in like you didn't just have a moral crisis.",
    actionShort: "tip 20% no problem",
    realityShort: "spiraling over the math at the table",
    trigger: "opens the bill folder, eyes flick across the total",
    reaction: "tight smile, calculator face, slow blink",
    visualHook: "bill folder open on the table, hand frozen on the card",
    filmingMin: 4,
    topicNoun: "the bill",
    topicNounType: "object",
  },
  {
    family: "gift_received",
    triggerCategory: "environment",
    setting: "couch",
    settingDetail: "on the couch with the half-unwrapped present in your lap",
    sceneBeat:
      "You unwrap the gift, smile big, say 'I love it' three times, hug them, then 20 minutes later in the kitchen the actual feeling finally arrives and you don't know what to do with your face.",
    actionShort: "react to the gift naturally",
    realityShort: "the real reaction lands 20 minutes later",
    trigger: "unwraps the box, performs the smile, sets it aside",
    reaction: "delayed face change, alone, in the kitchen",
    visualHook: "gift box on the couch, your face 20 min later by the sink",
    filmingMin: 6,
    topicNoun: "the gift",
    topicNounType: "object",
  },
  {
    family: "birthday_text",
    triggerCategory: "phone_screen",
    setting: "couch",
    settingDetail: "on the couch scrolling birthday wishes on your phone",
    sceneBeat:
      "You scroll the birthday-wishes thread looking for the one name you wanted, don't find it, double-tap-react every other message, then put the phone face-down.",
    actionShort: "feel grateful for the birthday wishes",
    realityShort: "noticing exactly who didn't text",
    trigger: "scrolls the thread, eyes scanning names",
    reaction: "small mouth-tightening, double-tap-react, phone down",
    visualHook: "phone screen of birthday emojis, thumb scrolling fast",
    filmingMin: 3,
    topicNoun: "the birthday thread",
    topicNounType: "object",
  },
  {
    family: "colleague_promoted",
    triggerCategory: "phone_screen",
    setting: "desk",
    settingDetail: "at the desk with LinkedIn open in a tab",
    sceneBeat:
      "You see the 'I'm thrilled to share' post from the coworker who started six months after you, type 'congrats!!' in the comment box, hit post, then close the tab and stare at the wall.",
    actionShort: "be happy for them",
    realityShort: "closing the tab and staring at the wall",
    trigger: "scrolls past the promotion post, types congrats",
    reaction: "two exclamation marks, post, deadpan stare",
    visualHook: "LinkedIn 'I'm thrilled to share' post on screen",
    filmingMin: 4,
    topicNoun: "the promotion post",
    topicNounType: "object",
  },
  {
    family: "compliment_freeze",
    triggerCategory: "self_check",
    setting: "bathroom",
    settingDetail: "at the bathroom mirror mid-skincare",
    sceneBeat:
      "Roommate walks past, says you look good today, you say 'thanks' way too flat, then the second they leave you whisper 'they meant that right' to your reflection.",
    actionShort: "take a compliment normally",
    realityShort: "interrogating the compliment in the mirror",
    trigger: "receives the compliment, says thanks too flat",
    reaction: "frozen smile, then immediate self-questioning to the mirror",
    visualHook: "your face in the mirror, neutral mid-skincare",
    filmingMin: 3,
    topicNoun: "the compliment",
    topicNounType: "abstract",
  },

  // failure_contradiction (+6)
  {
    family: "meal_prep",
    triggerCategory: "task",
    setting: "kitchen",
    settingDetail: "at the kitchen counter beside the meal-prep containers",
    sceneBeat:
      "You open the fridge, look at the six identical meal-prep containers you spent Sunday making, close the fridge, and open DoorDash.",
    actionShort: "eat the meal prep this week",
    realityShort: "ordering DoorDash for the third night",
    trigger: "opens the fridge, sees the containers, closes it",
    reaction: "slow phone pickup, app already open",
    visualHook: "six containers stacked on the shelf, untouched",
    filmingMin: 4,
    topicNoun: "the meal prep",
    topicNounType: "object",
  },
  {
    family: "bedtime",
    triggerCategory: "self_check",
    setting: "bed",
    settingDetail: "in bed with the phone clock visible",
    sceneBeat:
      "You said 'asleep by 10' out loud at dinner. The clock says 2:47am. You scroll for one more minute that becomes nine.",
    actionShort: "be asleep by 10",
    realityShort: "the clock reads 2:47am",
    trigger: "phone clock shows 2:47am, scroll continues",
    reaction: "no reaction, eyes on the screen, blink slow",
    visualHook: "phone clock 2:47, ceiling visible above",
    filmingMin: 3,
    topicNoun: "the bedtime",
    topicNounType: "event",
  },
  {
    family: "screen_time",
    triggerCategory: "phone_screen",
    setting: "couch",
    settingDetail: "on the couch with the weekly screen-time alert open",
    sceneBeat:
      "The Sunday screen-time report drops, you open it, see the number is up 14% from last week, sigh, then close the notification and go right back to the same app.",
    actionShort: "use the phone less this week",
    realityShort: "the weekly report is up 14%",
    trigger: "opens the screen-time notification, slow head shake",
    reaction: "the long sigh, swipe away, back to the app",
    visualHook: "screen-time bar chart on phone, time number circled",
    filmingMin: 3,
    topicNoun: "the screen time",
    topicNounType: "abstract",
  },
  {
    family: "journaling_habit",
    triggerCategory: "self_check",
    setting: "desk",
    settingDetail: "at the desk with the journal open to your own handwriting",
    sceneBeat:
      "You re-read your own journal entry from last month, the part that says 'stop checking the app every five minutes', then immediately check the app.",
    actionShort: "follow your own journal advice",
    realityShort: "checking the app mid-sentence",
    trigger: "reads the journal line, picks up the phone",
    reaction: "no recognition, no irony, just the unlock motion",
    visualHook: "journal page with the underlined sentence, phone in hand",
    filmingMin: 4,
    topicNoun: "the journal",
    topicNounType: "object",
  },
  {
    family: "parking_lecture",
    triggerCategory: "environment",
    setting: "car",
    settingDetail: "in the parked car holding the parking ticket",
    sceneBeat:
      "You lectured your roommate for ten minutes last week about expired meters. Today you're staring at your own ticket on the windshield and the camera knows.",
    actionShort: "always feed the meter",
    realityShort: "the ticket is on your windshield",
    trigger: "pulls the ticket from the windshield, slow turn to camera",
    reaction: "the silent look, jaw tight, ticket folded",
    visualHook: "parking ticket against the dashboard",
    filmingMin: 3,
    topicNoun: "the parking ticket",
    topicNounType: "object",
  },
  {
    family: "morning_pages",
    triggerCategory: "self_check",
    setting: "bed",
    settingDetail: "in bed with the alarm labeled 'morning pages 6am'",
    sceneBeat:
      "Alarm goes off labeled 'morning pages 6am'. You swipe snooze for the third day in a row. The label silently judges you back.",
    actionShort: "do morning pages at 6am",
    realityShort: "snoozing for the third morning",
    trigger: "alarm rings, label visible, thumb swipes snooze",
    reaction: "eyes still closed, snooze without looking",
    visualHook: "phone alarm screen with label 'morning pages 6am'",
    filmingMin: 3,
    topicNoun: "the morning alarm",
    topicNounType: "object",
  },

  // decision_paralysis (+5)
  {
    family: "streaming_pick",
    triggerCategory: "environment",
    setting: "couch",
    settingDetail: "on the couch with Netflix browse-screen on the TV",
    sceneBeat:
      "You scroll Netflix for 47 minutes, hover over six things, watch four trailers, then put on the same show you watched last night.",
    actionShort: "pick something new tonight",
    realityShort: "putting on last night's show again",
    trigger: "scrolls the home row twice, hovers, drops the remote",
    reaction: "the head-tilt back into the cushion, same show plays",
    visualHook: "Netflix browse screen on TV, remote on the couch arm",
    filmingMin: 4,
    topicNoun: "the show",
    topicNounType: "object",
  },
  {
    family: "restaurant_pick",
    triggerCategory: "environment",
    setting: "outside",
    settingDetail: "on the sidewalk between three restaurants",
    sceneBeat:
      "You stand on the corner with your friend, three restaurants visible. You say 'you pick'. They say 'you pick'. You both pull out phones.",
    actionShort: "just pick a place to eat",
    realityShort: "both saying 'you pick' on loop",
    trigger: "looks at friend, looks at restaurants, says 'you pick'",
    reaction: "stand still, hands in pockets, faint smile",
    visualHook: "wide shot of two people on a corner, three restaurants visible",
    filmingMin: 4,
    topicNoun: "the restaurant",
    topicNounType: "place",
  },
  {
    family: "outfit_paralysis",
    triggerCategory: "self_check",
    setting: "other",
    settingDetail: "on the bedroom floor with five outfits laid on the bed",
    sceneBeat:
      "Five outfits laid out on the bed. You take a photo of each, send them to the group chat, get no replies, then leave in the original outfit.",
    actionShort: "pick an outfit and go",
    realityShort: "leaving in the first outfit anyway",
    trigger: "snaps photos of each outfit, hits send",
    reaction: "phone-in-hand pacing, then resignation",
    visualHook: "five outfits laid in a row on the bed",
    filmingMin: 5,
    topicNoun: "the outfit",
    topicNounType: "object",
  },
  {
    family: "gym_signup_signs",
    triggerCategory: "phone_screen",
    setting: "couch",
    settingDetail: "on the couch with the gym-app signup screen open",
    sceneBeat:
      "You hover over the 'confirm class' button, decide 'if it's not raining tomorrow I'll go', open the weather app, see partly cloudy, close everything.",
    actionShort: "sign up for the gym class",
    realityShort: "outsourcing the decision to the weather",
    trigger: "thumb hovers over confirm, switches to weather app",
    reaction: "long stare at the cloud icon, phone face down",
    visualHook: "gym-app signup screen, then weather app, then black",
    filmingMin: 3,
    topicNoun: "the gym class",
    topicNounType: "event",
  },
  {
    family: "breakup_text_pivot",
    triggerCategory: "message",
    setting: "bathroom",
    settingDetail: "at the bathroom sink with the phone propped against the mirror",
    sceneBeat:
      "You draft a paragraph, re-read it, draft another paragraph, delete everything, then send the single letter 'k' and lock the screen.",
    actionShort: "send the real message",
    realityShort: "sending one letter and locking the phone",
    trigger: "types a paragraph, deletes it, types 'k', sends",
    reaction: "exhale, phone face-down on the sink",
    visualHook: "phone propped on the sink, typing then erasing",
    filmingMin: 4,
    topicNoun: "the message",
    topicNounType: "object",
  },

  // social_friction (+5)
  {
    family: "birthday_song",
    triggerCategory: "environment",
    setting: "kitchen",
    settingDetail: "in the kitchen surrounded by people singing",
    sceneBeat:
      "Everyone starts the birthday song. You're the loudest until the verse you forgot. You mouth the next four words and recover on the 'happy birthday' part.",
    actionShort: "sing happy birthday confidently",
    realityShort: "mouthing the verse you don't know",
    trigger: "song starts, you go loud, then mouth the middle",
    reaction: "wide eyes, lips moving silently, recovery smile",
    visualHook: "your face mid-song, candle glow, others around",
    filmingMin: 3,
    topicNoun: "the birthday song",
    topicNounType: "object",
  },
  {
    family: "wave_back",
    triggerCategory: "social",
    setting: "outside",
    settingDetail: "on the sidewalk a block from your apartment",
    sceneBeat:
      "Someone across the street raises an arm. You raise yours back, smile big, then realize they were waving at the person directly behind you.",
    actionShort: "wave back like you know them",
    realityShort: "they were waving past you",
    trigger: "sees the wave, returns the wave, eyes shift behind",
    reaction: "the slow turn, the freeze, lower the hand",
    visualHook: "wide shot of the sidewalk, the wave, the realization",
    filmingMin: 3,
    topicNoun: "the wave",
    topicNounType: "action",
  },
  {
    family: "loud_neighbor_call",
    triggerCategory: "environment",
    setting: "couch",
    settingDetail: "on the couch with the neighbor's phone call audible through the wall",
    sceneBeat:
      "Your neighbor's FaceTime audio comes through the wall in full clarity. You stare at the wall, turn your podcast up two notches, then turn it back down because now you're invested.",
    actionShort: "ignore the neighbor's call",
    realityShort: "fully invested in their drama",
    trigger: "tilts head toward the wall, headphones half-off",
    reaction: "the slow lean, the held breath, the small smile",
    visualHook: "ear toward the wall, headphones around the neck",
    filmingMin: 4,
    topicNoun: "the neighbor's call",
    topicNounType: "event",
  },
  {
    family: "group_chat_lurk",
    triggerCategory: "message",
    setting: "bed",
    settingDetail: "in bed with the group chat at 47 unread",
    sceneBeat:
      "You scroll the 47 unread messages, read every one, react to none, then jump in three days later with a single 'lol' that reveals you were there the whole time.",
    actionShort: "stay caught up in the group chat",
    realityShort: "lurking for three days then dropping a 'lol'",
    trigger: "scrolls 47 messages, no reaction, types 'lol'",
    reaction: "reads, smirks, types, sends, locks screen",
    visualHook: "group chat scrolling fast, 'lol' typed last",
    filmingMin: 3,
    topicNoun: "the group chat",
    topicNounType: "object",
  },
  {
    family: "library_voice",
    triggerCategory: "environment",
    setting: "desk",
    settingDetail: "at a cafe table with the laptop volume up too high",
    sceneBeat:
      "Your laptop ding goes off at full volume in the quiet cafe. Three people turn. You mute it without breaking eye contact with your screen and pretend it didn't happen.",
    actionShort: "work quietly at the cafe",
    realityShort: "the laptop ding turns three heads",
    trigger: "laptop pings loud, three people turn, you mute it",
    reaction: "eyes locked on the screen, mute without looking",
    visualHook: "laptop screen, mute icon, side-eyes from neighboring tables",
    filmingMin: 3,
    topicNoun: "the laptop ding",
    topicNounType: "event",
  },

  // time_distortion (+4)
  {
    family: "wrong_year_form",
    triggerCategory: "phone_screen",
    setting: "desk",
    settingDetail: "at the desk filling out an online form",
    sceneBeat:
      "You type the year on a form, glance at it, do the math, then quietly correct it from two years off and pretend that didn't just happen.",
    actionShort: "fill out the form quickly",
    realityShort: "writing the wrong year by two",
    trigger: "types the year, pauses, deletes, retypes",
    reaction: "small head shake, quiet 'oh', no eye contact",
    visualHook: "form field with the wrong year, then corrected",
    filmingMin: 3,
    topicNoun: "the year",
    topicNounType: "abstract",
  },
  {
    family: "meeting_collision",
    triggerCategory: "phone_screen",
    setting: "desk",
    settingDetail: "at the desk with two calendar pop-ups overlapping",
    sceneBeat:
      "Two meeting pop-ups stack on top of each other at the same minute. You stare, calculate, click 'join' on the wrong one, and realize three minutes in.",
    actionShort: "make both 2pm meetings",
    realityShort: "joining the wrong one for three minutes",
    trigger: "two meeting pop-ups overlap, click the wrong one",
    reaction: "frozen face on Zoom, slow camera-off, switch tabs",
    visualHook: "two calendar reminders stacked, then Zoom screen",
    filmingMin: 3,
    topicNoun: "the meeting",
    topicNounType: "event",
  },
  {
    family: "season_door",
    triggerCategory: "environment",
    setting: "outside",
    settingDetail: "in the doorway in shorts halfway out the door",
    sceneBeat:
      "You open the front door for the morning sun, get hit with a wall of cold air you weren't expecting, do a slow door-close, and walk back to the closet for a hoodie.",
    actionShort: "head out for the morning walk",
    realityShort: "the cold sends you back inside",
    trigger: "opens the door, freezes, slow door close",
    reaction: "the deep inhale, the silent retreat, the hoodie grab",
    visualHook: "front door open, cold visible breath in shorts",
    filmingMin: 3,
    topicNoun: "the cold",
    topicNounType: "abstract",
  },
  {
    family: "birthday_age_dread",
    triggerCategory: "self_check",
    setting: "bathroom",
    settingDetail: "at the bathroom mirror the morning of your birthday",
    sceneBeat:
      "You wake up the morning of your birthday, look at yourself in the mirror, and quietly age five years in real time.",
    actionShort: "feel celebratory on your birthday",
    realityShort: "aging five years at the mirror",
    trigger: "stares at the mirror, mouth slightly open, slow blink",
    reaction: "the long blink, hand to face, no smile",
    visualHook: "your face in the mirror, harsh bathroom lighting",
    filmingMin: 4,
    topicNoun: "the birthday",
    topicNounType: "event",
  },

  // identity_drift (+3)
  {
    family: "customer_service_voice",
    triggerCategory: "phone_screen",
    setting: "desk",
    settingDetail: "at the desk on a work call with the door closed",
    sceneBeat:
      "You answer the work call in your high-pitched 'so happy you called' voice, hang up, and immediately your real voice comes back two octaves lower mid-sentence.",
    actionShort: "use one consistent voice all day",
    realityShort: "two octaves swing the second you hang up",
    trigger: "answers in the high voice, hangs up, voice drops",
    reaction: "the immediate shift, no transition, deadpan to camera",
    visualHook: "headset on, mouth shape change post-call",
    filmingMin: 3,
    topicNoun: "the phone voice",
    topicNounType: "abstract",
  },
  {
    family: "accent_pickup",
    triggerCategory: "social",
    setting: "couch",
    settingDetail: "on the couch on a video call with a friend from out of town",
    sceneBeat:
      "Three minutes into the call you catch your own voice copying their accent. You stop mid-sentence, recover with a cough, and switch back to your normal voice like nothing happened.",
    actionShort: "use your own accent the whole call",
    realityShort: "drifting into their accent uninvited",
    trigger: "speaks, hears own accent slip, stops, coughs",
    reaction: "the freeze, the cough, the recovery",
    visualHook: "phone propped on the couch, your face mid-sentence",
    filmingMin: 3,
    topicNoun: "the accent",
    topicNounType: "abstract",
  },
  {
    family: "old_photo_self",
    triggerCategory: "phone_screen",
    setting: "couch",
    settingDetail: "on the couch with the photos-app memory of you from four years ago",
    sceneBeat:
      "Photos shows you a 'memory from four years ago'. You stare at the version of you in the picture, don't recognize the haircut, the apartment, or the shirt, then close the app.",
    actionShort: "feel nostalgic at the photo memory",
    realityShort: "not recognizing yourself",
    trigger: "memory notification opens, you stare at the photo",
    reaction: "no smile, slow zoom in on the screen, app closed",
    visualHook: "phone showing old photo memory, your reflection above",
    filmingMin: 4,
    topicNoun: "the old photo",
    topicNounType: "object",
  },

  // physical_betrayal (+5)
  {
    family: "nap_ambush",
    triggerCategory: "self_check",
    setting: "couch",
    settingDetail: "on the couch with the phone on your chest",
    sceneBeat:
      "You said 'I'm just resting my eyes for five minutes'. You wake up, the room is darker, and the phone shows two hours and fourteen minutes have passed.",
    actionShort: "rest the eyes for five minutes",
    realityShort: "wake up two hours and fourteen later",
    trigger: "eyes closed, phone on chest, jolt awake",
    reaction: "groggy phone check, slow blink, the realization",
    visualHook: "phone showing 2h 14m, room darker than before",
    filmingMin: 3,
    topicNoun: "the nap",
    topicNounType: "event",
  },
  {
    family: "sneeze_chain",
    triggerCategory: "self_check",
    setting: "desk",
    settingDetail: "at the desk on a video call during allergy season",
    sceneBeat:
      "You start to make your point on the call. Sneeze. Restart. Sneeze again. Restart. Sneeze a third time. Mute and surrender.",
    actionShort: "make the point on the call",
    realityShort: "three sneezes interrupt one sentence",
    trigger: "starts speaking, sneeze, restart, sneeze, mute",
    reaction: "frozen mid-word, sneeze, mute, deadpan to camera",
    visualHook: "headphones askew, mute icon, tissue box visible",
    filmingMin: 3,
    topicNoun: "the sneeze",
    topicNounType: "event",
  },
  {
    family: "posture_collapse_zoom",
    triggerCategory: "self_check",
    setting: "desk",
    settingDetail: "at the desk on a back-to-back Zoom day",
    sceneBeat:
      "You start the day upright, shoulders back, ready to be perceived. By the fourth meeting your spine is a question mark and your laptop camera is angled up at your chin.",
    actionShort: "sit upright on every Zoom",
    realityShort: "the spine becomes a question mark by 3pm",
    trigger: "the slow slide down the chair, meeting after meeting",
    reaction: "no awareness, just the gradual collapse",
    visualHook: "side-by-side: 9am posture vs 3pm posture",
    filmingMin: 4,
    topicNoun: "the posture",
    topicNounType: "body_state",
  },
  {
    family: "bladder_brain_drive",
    triggerCategory: "self_check",
    setting: "car",
    settingDetail: "in the car twelve minutes from home on a long drive",
    sceneBeat:
      "You're twelve minutes from home. Your bladder calculates the distance, the lights, the speed limit, and the probability of a green wave with the focus of a NASA engineer.",
    actionShort: "make it home no problem",
    realityShort: "the bladder is doing the math",
    trigger: "shift in seat, glances at the GPS, hand on knee",
    reaction: "tight jaw, eyes on the road, mental math face",
    visualHook: "GPS showing 12 min, your white-knuckle grip",
    filmingMin: 3,
    topicNoun: "the drive home",
    topicNounType: "event",
  },
  {
    family: "voice_crack_meeting",
    triggerCategory: "phone_screen",
    setting: "desk",
    settingDetail: "at the desk leading the team meeting",
    sceneBeat:
      "You're leading the meeting, going strong. The word 'agenda' comes out in three different octaves. You keep going like nothing happened. The chat fills with crying-laugh emojis.",
    actionShort: "lead the meeting smoothly",
    realityShort: "the word agenda hits three octaves",
    trigger: "speaks the word, voice cracks, no acknowledgment",
    reaction: "the steady stare, no smile, push through",
    visualHook: "Zoom view of you mid-meeting, chat filling with reactions",
    filmingMin: 3,
    topicNoun: "the meeting",
    topicNounType: "event",
  },

  // information_asymmetry (+6)
  {
    family: "typing_dots_paused",
    triggerCategory: "phone_screen",
    setting: "bed",
    settingDetail: "in bed staring at the typing-dots indicator",
    sceneBeat:
      "The 'typing…' bubble appears. Stops. Appears again. Stops. Two days pass with no message. You re-read your last text fourteen times trying to figure out what they're not saying.",
    actionShort: "wait for the reply patiently",
    realityShort: "watching the typing dots come and go",
    trigger: "typing indicator appears, stops, reappears, stops",
    reaction: "phone held inches from face, slow blink, scroll up",
    visualHook: "phone showing 'typing…' on, then off, then on",
    filmingMin: 3,
    topicNoun: "the typing dots",
    topicNounType: "object",
  },
  {
    family: "dinner_lie",
    triggerCategory: "environment",
    setting: "kitchen",
    settingDetail: "at the kitchen counter with the fridge open at 10pm",
    sceneBeat:
      "You and the roommate both said 'I already ate' an hour ago. You're both standing in front of the open fridge at 10pm, neither of you speaking.",
    actionShort: "stick to the 'already ate' story",
    realityShort: "both at the fridge at 10pm anyway",
    trigger: "both arrive at the fridge, neither speaks",
    reaction: "long mutual stare, slow grab of leftovers",
    visualHook: "two people at the open fridge, eye contact",
    filmingMin: 4,
    topicNoun: "the dinner",
    topicNounType: "event",
  },
  {
    family: "delivery_secret",
    triggerCategory: "environment",
    setting: "outside",
    settingDetail: "at the front door with the third Amazon box this week",
    sceneBeat:
      "Third package this week. You hear the doorbell, race to the door before the roommate notices, scoop up the box, and hide it under the couch like it's contraband.",
    actionShort: "be honest about the spending",
    realityShort: "boxes under the couch like contraband",
    trigger: "doorbell rings, you race to the door",
    reaction: "quick grab, hide under arm, glance over shoulder",
    visualHook: "three Amazon boxes lined up under the couch",
    filmingMin: 3,
    topicNoun: "the package",
    topicNounType: "object",
  },
  {
    family: "wrong_chat_send",
    triggerCategory: "message",
    setting: "desk",
    settingDetail: "at the desk with two group chats open",
    sceneBeat:
      "You type the message, pick the chat, hit send, look at the recipient, and the slow horror of which chat it actually went to settles in over four full seconds.",
    actionShort: "send to the right group chat",
    realityShort: "sent to the wrong chat, four-second horror",
    trigger: "types message, hits send, eyes go wide",
    reaction: "frozen, finger hovering over delete, too late",
    visualHook: "phone showing the wrong chat at the top",
    filmingMin: 3,
    topicNoun: "the message",
    topicNounType: "object",
  },
  {
    family: "gym_avoid_coworker",
    triggerCategory: "social",
    setting: "outside",
    settingDetail: "on the sidewalk outside the gym you ditched today",
    sceneBeat:
      "You skipped the gym, posted a fake 'great workout' story, then walk past your coworker on the sidewalk. They saw the story. They know.",
    actionShort: "have it both ways with the gym story",
    realityShort: "the coworker just saw your fake story",
    trigger: "spots the coworker, freezes, smiles too wide",
    reaction: "the locked-eye contact, the over-smile, the keep walking",
    visualHook: "wide sidewalk shot, the wave, the inner panic",
    filmingMin: 3,
    topicNoun: "the gym story",
    topicNounType: "abstract",
  },
  {
    family: "bathroom_eavesdrop",
    triggerCategory: "environment",
    setting: "bathroom",
    settingDetail: "in a public bathroom stall with the hand dryer just stopped",
    sceneBeat:
      "The hand dryer cuts off mid-cycle. In the silence you hear your own name from the next stall. You go absolutely still, holding your breath, until the door slams.",
    actionShort: "wash hands and leave like normal",
    realityShort: "frozen in the stall hearing your own name",
    trigger: "hand dryer stops, name spoken, you go still",
    reaction: "frozen, breath held, slow exhale",
    visualHook: "feet visible under the next stall, your hand frozen on the lock",
    filmingMin: 3,
    topicNoun: "the bathroom",
    topicNounType: "place",
  },

  // environmental_chaos (+5)
  {
    family: "wifi_outage",
    triggerCategory: "phone_screen",
    setting: "desk",
    settingDetail: "at the desk during a meeting with the wifi spinning",
    sceneBeat:
      "Mid-meeting, the wifi icon starts spinning. You stare at it, do the slow head turn toward the router across the room, then back to the screen, then back to the router.",
    actionShort: "have a stable wifi day",
    realityShort: "the wifi has betrayed you mid-meeting",
    trigger: "wifi icon spins, slow head turn to the router",
    reaction: "the long stare, the resigned hand-up to the camera",
    visualHook: "spinning wifi icon, then the router across the room",
    filmingMin: 3,
    topicNoun: "the wifi",
    topicNounType: "object",
  },
  {
    family: "surprise_storm",
    triggerCategory: "environment",
    setting: "outside",
    settingDetail: "on the sidewalk in shorts as the sky turns black",
    sceneBeat:
      "You walked out in shorts. The sky was clear. Three minutes later it's black, the wind picks up, and you do an immediate U-turn at the crosswalk.",
    actionShort: "enjoy the nice weather walk",
    realityShort: "U-turn at the crosswalk in the rain",
    trigger: "looks up, sees the black sky, immediate turn",
    reaction: "the eyebrow raise, the spin, speed-walk back",
    visualHook: "sky going from blue to black in two cuts",
    filmingMin: 3,
    topicNoun: "the weather",
    topicNounType: "abstract",
  },
  {
    family: "trash_smell_hunt",
    triggerCategory: "environment",
    setting: "kitchen",
    settingDetail: "in the kitchen smelling something you can't identify",
    sceneBeat:
      "Something smells. You sniff the trash, the fridge, the sink, the dishwasher, the corner. The source remains a mystery and the smell is winning.",
    actionShort: "find the smell and fix it",
    realityShort: "the smell is winning",
    trigger: "sniffs, opens trash, opens fridge, sniffs again",
    reaction: "nose wrinkled, head turning slow, hands on hips",
    visualHook: "wide kitchen shot, you mid-sniff at the corner",
    filmingMin: 4,
    topicNoun: "the smell",
    topicNounType: "body_state",
  },
  {
    family: "flicker_skincare",
    triggerCategory: "environment",
    setting: "bathroom",
    settingDetail: "at the bathroom mirror mid-skincare with the bulb flickering",
    sceneBeat:
      "Mid-skincare routine the overhead bulb starts flickering. You freeze, half-moisturized, watching yourself strobe in the mirror.",
    actionShort: "do the night skincare routine",
    realityShort: "strobe-lit at the mirror mid-routine",
    trigger: "bulb flickers, you freeze mid-application",
    reaction: "frozen face, eyes flick to the bulb, then back to mirror",
    visualHook: "your face strobing in the bathroom mirror",
    filmingMin: 3,
    topicNoun: "the bulb",
    topicNounType: "object",
  },
  {
    family: "package_pile_unknown",
    triggerCategory: "environment",
    setting: "outside",
    settingDetail: "at the front door with four boxes you didn't order",
    sceneBeat:
      "You open the front door to four boxes stacked on the step. None of the names match yours. You lift one anyway, look up and down the street, and bring it inside to inspect.",
    actionShort: "ignore the wrong-address packages",
    realityShort: "carrying the wrong package inside to inspect",
    trigger: "opens door, sees four boxes, lifts one",
    reaction: "head tilt at the label, look both ways, walk inside",
    visualHook: "four stacked boxes at the door, hand reaching",
    filmingMin: 3,
    topicNoun: "the packages",
    topicNounType: "object",
  },

  // memory_glitch (+5)
  {
    family: "name_blank_party",
    triggerCategory: "social",
    setting: "outside",
    settingDetail: "at a party introducing two friends to each other",
    sceneBeat:
      "You go to introduce two friends. The first name comes out fine. The second name evaporates from your brain mid-gesture and you commit to the silence.",
    actionShort: "introduce the friends smoothly",
    realityShort: "second name evaporates mid-gesture",
    trigger: "starts the introduction, first name out, hand gesture",
    reaction: "frozen smile, the silent hand wave, the abandon",
    visualHook: "your face mid-introduction, gesture frozen",
    filmingMin: 3,
    topicNoun: "the name",
    topicNounType: "abstract",
  },
  {
    family: "password_reset_loop",
    triggerCategory: "phone_screen",
    setting: "desk",
    settingDetail: "at the desk on the fourth password attempt",
    sceneBeat:
      "Fourth attempt. Each password slower than the last. Eventually you sigh, click 'forgot password', and watch the email take 90 seconds to arrive.",
    actionShort: "remember the password this time",
    realityShort: "the fourth try, then 'forgot password'",
    trigger: "types, gets rejected, types slower, gets rejected",
    reaction: "the hand-on-face, the click on 'forgot password'",
    visualHook: "login screen with 'incorrect password' showing",
    filmingMin: 3,
    topicNoun: "the password",
    topicNounType: "abstract",
  },
  {
    family: "song_loop_brushing",
    triggerCategory: "self_check",
    setting: "bathroom",
    settingDetail: "at the bathroom sink brushing teeth with a song stuck",
    sceneBeat:
      "Same four lyrics on loop in your head while you brush. You hum them out loud at the sink. They keep going through the rinse and the spit and the towel.",
    actionShort: "brush teeth in peace",
    realityShort: "the same four lyrics on loop",
    trigger: "starts brushing, the lyrics start, you hum",
    reaction: "the resigned face, lips moving around the toothbrush",
    visualHook: "you brushing, mouth full of foam, eyes distant",
    filmingMin: 3,
    topicNoun: "the song",
    topicNounType: "object",
  },
  {
    family: "did_i_lock_door",
    triggerCategory: "self_check",
    setting: "car",
    settingDetail: "in the car halfway down the driveway",
    sceneBeat:
      "You're halfway down the driveway when the doubt hits. You sit there for ten seconds, mentally reconstructing the door, then U-turn back to check.",
    actionShort: "drive off without doubt",
    realityShort: "U-turn back to check the door",
    trigger: "drives a few feet, brakes, mental replay",
    reaction: "the long stare ahead, the U-turn, the sigh",
    visualHook: "the rearview, the door, the steering wheel turning",
    filmingMin: 3,
    topicNoun: "the door",
    topicNounType: "object",
  },
  {
    family: "wrong_friend_text",
    triggerCategory: "message",
    setting: "couch",
    settingDetail: "on the couch starting a text 'hey are we still on for…'",
    sceneBeat:
      "You start the text 'hey we still on for…' and your brain blanks on which friend you have plans with. You scroll the calendar, the texts, the photos, then send the message anyway and hope they remember.",
    actionShort: "confirm the plans clearly",
    realityShort: "you don't remember whose plans they are",
    trigger: "types 'we still on for', stops, scrolls calendar",
    reaction: "phone scroll, brow furrow, send anyway",
    visualHook: "text screen mid-typing, calendar app, back to text",
    filmingMin: 3,
    topicNoun: "the plans",
    topicNounType: "abstract",
  },

  // ritual_disruption (+4)
  {
    family: "mug_replaced",
    triggerCategory: "environment",
    setting: "kitchen",
    settingDetail: "at the kitchen counter beside the dishwasher",
    sceneBeat:
      "Your favorite mug is in the dishwasher. You pour the coffee into the second-favorite mug, take one sip, and the betrayal is visible on your face.",
    actionShort: "have coffee like normal",
    realityShort: "the second-favorite mug ruins the morning",
    trigger: "pours coffee into the wrong mug, takes a sip",
    reaction: "the slow chew of disappointment, mug held away",
    visualHook: "the wrong mug in your hand, dishwasher closed",
    filmingMin: 3,
    topicNoun: "the mug",
    topicNounType: "object",
  },
  {
    family: "lucky_pen_missing",
    triggerCategory: "environment",
    setting: "desk",
    settingDetail: "at the desk searching every drawer",
    sceneBeat:
      "You search every drawer for the lucky pen for four minutes. You settle for a pencil. The whole project is now compromised in your head.",
    actionShort: "start the project with the lucky pen",
    realityShort: "settling for a pencil instead",
    trigger: "opens drawers, lifts notebooks, hand on hip",
    reaction: "the resigned grab of the pencil, the long stare",
    visualHook: "open drawers, pencil in hand, lucky pen nowhere",
    filmingMin: 3,
    topicNoun: "the pen",
    topicNounType: "object",
  },
  {
    family: "routine_witness",
    triggerCategory: "social",
    setting: "other",
    settingDetail: "in the bedroom doing the 12-step skincare with the roommate watching",
    sceneBeat:
      "You're three steps into the skincare routine when you notice the roommate in the doorway. You finish the remaining nine steps anyway, slower, in total silence.",
    actionShort: "do the routine privately",
    realityShort: "performing the full routine for an audience",
    trigger: "notices the roommate, finishes anyway, no eye contact",
    reaction: "the slowed pace, the focused silence, the deadpan",
    visualHook: "you mid-skincare, roommate's silhouette in the doorway",
    filmingMin: 4,
    topicNoun: "the skincare routine",
    topicNounType: "action",
  },
  {
    family: "kid_copies_brushing",
    triggerCategory: "self_check",
    setting: "bathroom",
    settingDetail: "at the bathroom sink with the kid brushing beside you",
    sceneBeat:
      "The kid is brushing teeth next to you, copying every move you make exactly. You realize the weird little circular motion you do is now genetic.",
    actionShort: "brush teeth normally",
    realityShort: "the kid copying your weird brushing exactly",
    trigger: "brushes, glances over, kid mirrors the motion",
    reaction: "slow-dawning realization, small smile around the brush",
    visualHook: "side-by-side at the sink, two toothbrushes, same motion",
    filmingMin: 3,
    topicNoun: "the brushing",
    topicNounType: "action",
  },

  // anti_climax (+5)
  {
    family: "birthday_aftermath",
    triggerCategory: "phone_screen",
    setting: "couch",
    settingDetail: "on the couch the day after your birthday with confetti on the floor",
    sceneBeat:
      "Day after your birthday. Confetti still on the floor. Lights off. You're scrolling through the photos of last night while eating cold takeout from the same containers.",
    actionShort: "celebrate the whole birthday week",
    realityShort: "cold takeout on the post-party couch",
    trigger: "scrolls last night's photos, takeout container in hand",
    reaction: "the long blank scroll, no expression, slow chew",
    visualHook: "confetti on the floor, takeout containers, phone glow",
    filmingMin: 4,
    topicNoun: "the birthday",
    topicNounType: "event",
  },
  {
    family: "concert_aftermath",
    triggerCategory: "environment",
    setting: "outside",
    settingDetail: "in the venue parking lot after the concert ended",
    sceneBeat:
      "The concert ends. Everyone files out. You're standing in the parking lot ten minutes later, ears ringing, watching the last cars leave, not ready to go home.",
    actionShort: "head straight home after the show",
    realityShort: "still standing in the parking lot ten minutes later",
    trigger: "watches the crowd thin, doesn't move",
    reaction: "the still stand, the slow exhale, the long look",
    visualHook: "wide parking lot shot, you alone, last cars leaving",
    filmingMin: 4,
    topicNoun: "the concert",
    topicNounType: "event",
  },
  {
    family: "email_drama_paperwork",
    triggerCategory: "phone_screen",
    setting: "desk",
    settingDetail: "at the desk staring at the unread bold email",
    sceneBeat:
      "The email subject line was menacing. You open it bracing for chaos. It's a tax form. You sit there for a beat, almost disappointed, then close the tab.",
    actionShort: "handle the dramatic email",
    realityShort: "the dramatic email is a tax form",
    trigger: "opens the email, scans, faintly disappointed",
    reaction: "shoulders drop, lean back in the chair, close tab",
    visualHook: "email open showing 'IRS Form W-9' or similar",
    filmingMin: 3,
    topicNoun: "the email",
    topicNounType: "object",
  },
  {
    family: "vacation_first_morning",
    triggerCategory: "self_check",
    setting: "bed",
    settingDetail: "in the hotel bed the first morning of vacation",
    sceneBeat:
      "Months of planning. Counting down the days. First morning of vacation: you wake up, look at the ceiling, and the only thought is 'we should probably do something'.",
    actionShort: "have the perfect vacation morning",
    realityShort: "staring at the ceiling thinking 'now what'",
    trigger: "wakes up, opens eyes, stares at the ceiling",
    reaction: "no smile, slow scroll on phone, no plan",
    visualHook: "hotel ceiling, your face on the pillow, phone in hand",
    filmingMin: 3,
    topicNoun: "the vacation morning",
    topicNounType: "event",
  },
  {
    family: "peak_was_yesterday_workout",
    triggerCategory: "self_check",
    setting: "bed",
    settingDetail: "in bed the day after the personal-best gym session",
    sceneBeat:
      "Yesterday you hit your personal-best lift. Today you can't sit up in bed without the slow groan. The achievement is yesterday's; the soreness is now.",
    actionShort: "ride the gym momentum",
    realityShort: "can't get out of bed today",
    trigger: "tries to sit up, groans, lies back down",
    reaction: "the wince, the slow lie back, the scroll",
    visualHook: "you flat on the bed, phone showing yesterday's PR screenshot",
    filmingMin: 3,
    topicNoun: "the soreness",
    topicNounType: "body_state",
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
  // Phase 2 families
  tipping_internal: "face_reaction_deadpan",
  gift_received: "face_reaction_deadpan",
  birthday_text: "phone_scroll_freeze",
  colleague_promoted: "desk_avoidance",
  compliment_freeze: "mirror_self_call_out",
  meal_prep: "fridge_open_stare",
  bedtime: "phone_scroll_freeze",
  screen_time: "couch_avoidance",
  journaling_habit: "desk_avoidance",
  parking_lecture: "car_avoidance",
  morning_pages: "bedroom_avoidance",
  streaming_pick: "couch_avoidance",
  restaurant_pick: "social_awkward_walkaway",
  outfit_paralysis: "outfit_check_cut",
  gym_signup_signs: "couch_avoidance",
  breakup_text_pivot: "text_message_panic",
  birthday_song: "face_reaction_deadpan",
  wave_back: "social_awkward_walkaway",
  loud_neighbor_call: "couch_avoidance",
  group_chat_lurk: "text_message_panic",
  library_voice: "desk_avoidance",
  wrong_year_form: "desk_avoidance",
  meeting_collision: "desk_avoidance",
  season_door: "doorway_retreat",
  birthday_age_dread: "mirror_self_call_out",
  customer_service_voice: "desk_avoidance",
  accent_pickup: "couch_avoidance",
  old_photo_self: "couch_avoidance",
  nap_ambush: "couch_avoidance",
  sneeze_chain: "desk_avoidance",
  posture_collapse_zoom: "desk_avoidance",
  bladder_brain_drive: "car_avoidance",
  voice_crack_meeting: "desk_avoidance",
  typing_dots_paused: "text_message_panic",
  dinner_lie: "fridge_open_stare",
  delivery_secret: "doorway_retreat",
  wrong_chat_send: "text_message_panic",
  gym_avoid_coworker: "social_awkward_walkaway",
  bathroom_eavesdrop: "face_reaction_deadpan",
  wifi_outage: "desk_avoidance",
  surprise_storm: "doorway_retreat",
  trash_smell_hunt: "kitchen_contradiction",
  flicker_skincare: "mirror_self_call_out",
  package_pile_unknown: "doorway_retreat",
  name_blank_party: "social_awkward_walkaway",
  password_reset_loop: "desk_avoidance",
  song_loop_brushing: "mirror_self_call_out",
  did_i_lock_door: "car_avoidance",
  wrong_friend_text: "text_message_panic",
  mug_replaced: "kitchen_contradiction",
  lucky_pen_missing: "desk_avoidance",
  routine_witness: "face_reaction_deadpan",
  kid_copies_brushing: "mirror_self_call_out",
  birthday_aftermath: "couch_avoidance",
  concert_aftermath: "face_reaction_deadpan",
  email_drama_paperwork: "desk_avoidance",
  vacation_first_morning: "bedroom_avoidance",
  peak_was_yesterday_workout: "bedroom_avoidance",
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
  // Phase 2 families
  tipping_internal: "social_texting",
  gift_received: "social_texting",
  birthday_text: "social_texting",
  colleague_promoted: "work_productivity",
  compliment_freeze: "body_fitness",
  meal_prep: "food_home",
  bedtime: "daily_routine",
  screen_time: "daily_routine",
  journaling_habit: "work_productivity",
  parking_lecture: "daily_routine",
  morning_pages: "daily_routine",
  streaming_pick: "daily_routine",
  restaurant_pick: "social_texting",
  outfit_paralysis: "daily_routine",
  gym_signup_signs: "body_fitness",
  breakup_text_pivot: "social_texting",
  birthday_song: "social_texting",
  wave_back: "social_texting",
  loud_neighbor_call: "daily_routine",
  group_chat_lurk: "social_texting",
  library_voice: "work_productivity",
  wrong_year_form: "work_productivity",
  meeting_collision: "work_productivity",
  season_door: "daily_routine",
  birthday_age_dread: "body_fitness",
  customer_service_voice: "work_productivity",
  accent_pickup: "social_texting",
  old_photo_self: "daily_routine",
  nap_ambush: "body_fitness",
  sneeze_chain: "work_productivity",
  posture_collapse_zoom: "work_productivity",
  bladder_brain_drive: "body_fitness",
  voice_crack_meeting: "work_productivity",
  typing_dots_paused: "social_texting",
  dinner_lie: "food_home",
  delivery_secret: "daily_routine",
  wrong_chat_send: "social_texting",
  gym_avoid_coworker: "social_texting",
  bathroom_eavesdrop: "social_texting",
  wifi_outage: "work_productivity",
  surprise_storm: "daily_routine",
  trash_smell_hunt: "food_home",
  flicker_skincare: "body_fitness",
  package_pile_unknown: "daily_routine",
  name_blank_party: "social_texting",
  password_reset_loop: "work_productivity",
  song_loop_brushing: "daily_routine",
  did_i_lock_door: "daily_routine",
  wrong_friend_text: "social_texting",
  mug_replaced: "food_home",
  lucky_pen_missing: "work_productivity",
  routine_witness: "body_fitness",
  kid_copies_brushing: "daily_routine",
  birthday_aftermath: "social_texting",
  concert_aftermath: "social_texting",
  email_drama_paperwork: "work_productivity",
  vacation_first_morning: "daily_routine",
  peak_was_yesterday_workout: "body_fitness",
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
  // Phase 2 families — inert telemetry (scriptType has been demoted from
  // diversity-driving axis to descriptive metadata; chosen for natural fit).
  tipping_internal: "suppressed_reaction",
  gift_received: "delayed_emotion",
  birthday_text: "suppressed_reaction",
  colleague_promoted: "polite_lie",
  compliment_freeze: "overreaction",
  meal_prep: "habit_break_fail",
  bedtime: "just_one_more_spiral",
  screen_time: "loop_behavior",
  journaling_habit: "internal_vs_external",
  parking_lecture: "internal_vs_external",
  morning_pages: "false_start",
  streaming_pick: "decision_flip",
  restaurant_pick: "social_overthinking",
  outfit_paralysis: "decision_flip",
  gym_signup_signs: "self_negotiation",
  breakup_text_pivot: "late_reply_regret",
  birthday_song: "fake_confidence",
  wave_back: "social_micro_fail",
  loud_neighbor_call: "suppressed_reaction",
  group_chat_lurk: "late_reply_regret",
  library_voice: "social_micro_fail",
  wrong_year_form: "realization",
  meeting_collision: "small_mistake_big_reaction",
  season_door: "realization",
  birthday_age_dread: "realization",
  customer_service_voice: "fake_confidence",
  accent_pickup: "social_overthinking",
  old_photo_self: "realization",
  nap_ambush: "time_blindness",
  sneeze_chain: "interrupted_action",
  posture_collapse_zoom: "slow_escalation",
  bladder_brain_drive: "quiet_panic",
  voice_crack_meeting: "small_mistake_big_reaction",
  typing_dots_paused: "conversation_replay",
  dinner_lie: "polite_lie",
  delivery_secret: "habit_break_fail",
  wrong_chat_send: "small_mistake_big_reaction",
  gym_avoid_coworker: "social_micro_fail",
  bathroom_eavesdrop: "quiet_panic",
  wifi_outage: "object_personification",
  surprise_storm: "realization",
  trash_smell_hunt: "loop_behavior",
  flicker_skincare: "interrupted_action",
  package_pile_unknown: "object_personification",
  name_blank_party: "social_micro_fail",
  password_reset_loop: "loop_behavior",
  song_loop_brushing: "loop_behavior",
  did_i_lock_door: "loop_behavior",
  wrong_friend_text: "conversation_replay",
  mug_replaced: "object_personification",
  lucky_pen_missing: "object_personification",
  routine_witness: "suppressed_reaction",
  kid_copies_brushing: "realization",
  birthday_aftermath: "delayed_consequence",
  concert_aftermath: "emotional_disconnect",
  email_drama_paperwork: "unexpected_response",
  vacation_first_morning: "emotional_disconnect",
  peak_was_yesterday_workout: "delayed_consequence",
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
// IdeaCoreType taxonomy — narrative-FAMILY diversity axis (Phase 1)
// -----------------------------------------------------------------------------
// 120-value enum (12 families × 10 types) that REPLACES `scriptType` as the
// active narrative-shape lever in the selector. `scriptType` is kept only as
// inert telemetry (still resolved + persisted) to preserve the IDEA ARCHETYPE
// derivation chain (resolveArchetypeLoose) and historical cache compatibility.
//
// Why a new axis: the prior `scriptType` taxonomy concentrated almost every
// scenario+template default into the "I planned X → I failed" narrative
// shape (loop_behavior / habit_break_fail / false_start / avoidance — all
// failure variants). Three batches in a row felt identical because every
// pick was a different filming of the same self-betrayal beat. The new
// IdeaCoreFamily axis spreads scenarios across 12 distinct narrative
// FAMILIES (failure is just ONE of them) and the selector enforces a hard
// `<40% failure_contradiction` cap per batch so that family can never
// dominate again.

export type IdeaCoreFamily =
  | "emotional_loop"
  | "failure_contradiction"
  | "decision_paralysis"
  | "social_friction"
  | "time_distortion"
  | "identity_drift"
  | "physical_betrayal"
  | "information_asymmetry"
  | "environmental_chaos"
  | "memory_glitch"
  | "ritual_disruption"
  | "anti_climax";

export const IDEA_CORE_FAMILIES: readonly IdeaCoreFamily[] = [
  "emotional_loop",
  "failure_contradiction",
  "decision_paralysis",
  "social_friction",
  "time_distortion",
  "identity_drift",
  "physical_betrayal",
  "information_asymmetry",
  "environmental_chaos",
  "memory_glitch",
  "ritual_disruption",
  "anti_climax",
] as const;

export type IdeaCoreType =
  // emotional_loop (10)
  | "denial"
  | "rationalization"
  | "suppressed_reaction"
  | "emotional_disconnect"
  | "delayed_emotion"
  | "overreaction"
  | "quiet_panic"
  | "hidden_envy"
  | "hidden_pride"
  | "suppressed_disappointment"
  // failure_contradiction (10)
  | "planned_vs_did"
  | "said_vs_meant"
  | "expected_vs_got"
  | "intent_vs_outcome"
  | "knew_better_did_anyway"
  | "promise_to_self_broken"
  | "plan_vs_reality"
  | "future_self_betrayed"
  | "advice_unfollowed"
  | "double_standard"
  // decision_paralysis (10)
  | "analysis_freeze"
  | "choice_overload"
  | "sunk_cost_lock"
  | "what_if_spiral"
  | "perfectionism_stall"
  | "default_to_safe"
  | "asking_for_signs"
  | "deferring_to_others"
  | "over_researching"
  | "last_minute_pivot"
  // social_friction (10)
  | "boundary_violated"
  | "unspoken_rule_broken"
  | "social_radar_off"
  | "awkward_silence_filler"
  | "misread_room"
  | "status_anxiety"
  | "group_chat_shame"
  | "public_correction"
  | "mismatched_energy"
  | "accidental_offense"
  // time_distortion (10)
  | "five_more_minutes"
  | "anachronism_realization"
  | "calendar_blindness"
  | "deadline_denial"
  | "hyperfixation_blackout"
  | "schedule_collision"
  | "ghost_of_yesterday"
  | "future_dread_present_freeze"
  | "age_dysphoria"
  | "season_shock"
  // identity_drift (10)
  | "voice_shift"
  | "accent_slip"
  | "persona_borrow"
  | "mirror_stranger"
  | "old_self_intrusion"
  | "pretending_to_be_pretending"
  | "fake_until_real"
  | "real_until_fake"
  | "brand_creep"
  | "tribe_betrayal"
  // physical_betrayal (10)
  | "body_won"
  | "body_lost"
  | "sense_betrayal"
  | "reflex_takeover"
  | "sneeze_chain"
  | "posture_collapse"
  | "hunger_override"
  | "sleep_signal_ignored"
  | "bladder_brain"
  | "voice_crack"
  // information_asymmetry (10)
  | "they_dont_know"
  | "i_dont_know_they_know"
  | "both_pretending"
  | "secret_kept"
  | "secret_overshared"
  | "dramatic_irony_self"
  | "missing_context_panic"
  | "surprise_information"
  | "eavesdrop_aftermath"
  | "partial_truth_spiral"
  // environmental_chaos (10)
  | "object_misplaced"
  | "object_multiplied"
  | "system_glitch"
  | "unexpected_weather"
  | "smell_invasion"
  | "lighting_betrayal"
  | "technology_rebellion"
  | "animal_intrusion"
  | "neighbor_event"
  | "package_drama"
  // memory_glitch (10)
  | "name_blank"
  | "walk_in_amnesia"
  | "password_amnesia"
  | "song_stuck"
  | "deja_vu_loop"
  | "false_memory"
  | "memory_collision"
  | "intrusive_old_text"
  | "witnessed_self_replay"
  | "mid_sentence_loss"
  // ritual_disruption (10)
  | "first_step_skipped"
  | "sequence_broken"
  | "replacement_inferior"
  | "missing_prop"
  | "contaminated_item"
  | "location_displacement"
  | "witness_to_ritual"
  | "ritual_aging_out"
  | "ritual_inheritance"
  | "ritual_for_one_now_for_two"
  // anti_climax (10)
  | "buildup_to_nothing"
  | "victory_was_pyrrhic"
  | "rehearsed_for_silence"
  | "expected_drama_got_paperwork"
  | "prepared_for_wrong_thing"
  | "escalation_fizzle"
  | "crowd_dispersed"
  | "finally_arrived_now_what"
  | "post_event_void"
  | "peak_was_yesterday";

/** family ⇒ ordered tuple of its 10 IdeaCoreTypes. Single source of truth
 * for both `IDEA_CORE_TYPE_TO_FAMILY` (reverse map) and the catalog
 * derivations in `buildNoveltyContext` (unused-in-last-3 calculations). */
const IDEA_CORE_TYPES_BY_FAMILY: Record<IdeaCoreFamily, readonly IdeaCoreType[]> = {
  emotional_loop: [
    "denial", "rationalization", "suppressed_reaction", "emotional_disconnect",
    "delayed_emotion", "overreaction", "quiet_panic", "hidden_envy",
    "hidden_pride", "suppressed_disappointment",
  ],
  failure_contradiction: [
    "planned_vs_did", "said_vs_meant", "expected_vs_got", "intent_vs_outcome",
    "knew_better_did_anyway", "promise_to_self_broken", "plan_vs_reality",
    "future_self_betrayed", "advice_unfollowed", "double_standard",
  ],
  decision_paralysis: [
    "analysis_freeze", "choice_overload", "sunk_cost_lock", "what_if_spiral",
    "perfectionism_stall", "default_to_safe", "asking_for_signs",
    "deferring_to_others", "over_researching", "last_minute_pivot",
  ],
  social_friction: [
    "boundary_violated", "unspoken_rule_broken", "social_radar_off",
    "awkward_silence_filler", "misread_room", "status_anxiety",
    "group_chat_shame", "public_correction", "mismatched_energy",
    "accidental_offense",
  ],
  time_distortion: [
    "five_more_minutes", "anachronism_realization", "calendar_blindness",
    "deadline_denial", "hyperfixation_blackout", "schedule_collision",
    "ghost_of_yesterday", "future_dread_present_freeze", "age_dysphoria",
    "season_shock",
  ],
  identity_drift: [
    "voice_shift", "accent_slip", "persona_borrow", "mirror_stranger",
    "old_self_intrusion", "pretending_to_be_pretending", "fake_until_real",
    "real_until_fake", "brand_creep", "tribe_betrayal",
  ],
  physical_betrayal: [
    "body_won", "body_lost", "sense_betrayal", "reflex_takeover",
    "sneeze_chain", "posture_collapse", "hunger_override",
    "sleep_signal_ignored", "bladder_brain", "voice_crack",
  ],
  information_asymmetry: [
    "they_dont_know", "i_dont_know_they_know", "both_pretending",
    "secret_kept", "secret_overshared", "dramatic_irony_self",
    "missing_context_panic", "surprise_information", "eavesdrop_aftermath",
    "partial_truth_spiral",
  ],
  environmental_chaos: [
    "object_misplaced", "object_multiplied", "system_glitch",
    "unexpected_weather", "smell_invasion", "lighting_betrayal",
    "technology_rebellion", "animal_intrusion", "neighbor_event",
    "package_drama",
  ],
  memory_glitch: [
    "name_blank", "walk_in_amnesia", "password_amnesia", "song_stuck",
    "deja_vu_loop", "false_memory", "memory_collision", "intrusive_old_text",
    "witnessed_self_replay", "mid_sentence_loss",
  ],
  ritual_disruption: [
    "first_step_skipped", "sequence_broken", "replacement_inferior",
    "missing_prop", "contaminated_item", "location_displacement",
    "witness_to_ritual", "ritual_aging_out", "ritual_inheritance",
    "ritual_for_one_now_for_two",
  ],
  anti_climax: [
    "buildup_to_nothing", "victory_was_pyrrhic", "rehearsed_for_silence",
    "expected_drama_got_paperwork", "prepared_for_wrong_thing",
    "escalation_fizzle", "crowd_dispersed", "finally_arrived_now_what",
    "post_event_void", "peak_was_yesterday",
  ],
};

/** Flat catalog of all 120 ideaCoreTypes — used by buildNoveltyContext for
 * the "unused in last 3 batches" boost computation. */
export const IDEA_CORE_TYPES: readonly IdeaCoreType[] = (() => {
  const flat: IdeaCoreType[] = [];
  for (const fam of IDEA_CORE_FAMILIES) {
    for (const t of IDEA_CORE_TYPES_BY_FAMILY[fam]) flat.push(t);
  }
  return flat;
})();

/** Reverse map — type → family. O(1) lookup driven by the
 * `IDEA_CORE_TYPES_BY_FAMILY` source of truth so adding a new type to a
 * family only needs to touch one place. */
const IDEA_CORE_TYPE_TO_FAMILY: Record<IdeaCoreType, IdeaCoreFamily> = (() => {
  const m = {} as Record<IdeaCoreType, IdeaCoreFamily>;
  for (const fam of IDEA_CORE_FAMILIES) {
    for (const t of IDEA_CORE_TYPES_BY_FAMILY[fam]) m[t] = fam;
  }
  return m;
})();

export function resolveIdeaCoreFamily(t: IdeaCoreType): IdeaCoreFamily {
  return IDEA_CORE_TYPE_TO_FAMILY[t];
}

/**
 * Default IdeaCoreType per scenario family. Deliberately spread across ALL
 * 12 IdeaCoreFamilies so the natural pool is family-diverse BEFORE template
 * overrides kick in. failure_contradiction is intentionally rare in defaults
 * (only `productivity`) — most "failure" content emerges from the
 * `avoidance` / `routine_contradiction` / `expectation_vs_reality` template
 * overrides below, where the per-batch <40% guard catches it.
 */
const IDEA_CORE_TYPE_BY_FAMILY: Record<string, IdeaCoreType> = {
  sleep: "five_more_minutes",
  coffee: "first_step_skipped",
  gym: "persona_borrow",
  laundry: "object_misplaced",
  texting: "they_dont_know",
  emails: "analysis_freeze",
  fridge: "walk_in_amnesia",
  outfit: "mirror_stranger",
  errands: "mid_sentence_loss",
  weekend_plans: "mismatched_energy",
  productivity: "planned_vs_did",
  cleaning: "sequence_broken",
  social_call: "awkward_silence_filler",
  snack: "hunger_override",
  hydration: "body_lost",
  morning: "first_step_skipped",
  shopping: "choice_overload",
  social_post: "hidden_envy",
  dishes: "post_event_void",
  podcast: "emotional_disconnect",
  skincare: "brand_creep",
  mirror_pep_talk: "fake_until_real",
  walk: "hyperfixation_blackout",
  doom_scroll_car: "hyperfixation_blackout",
  closet_pile: "object_multiplied",
  // Phase 2 families — defaults match the planned per-family distribution
  // so the natural pool covers all 12 IdeaCoreFamilies with ~6-7 scenarios
  // each (vs. 25-scenario pool which had 1-4 per family).
  tipping_internal: "suppressed_reaction",
  gift_received: "delayed_emotion",
  birthday_text: "suppressed_disappointment",
  colleague_promoted: "hidden_envy",
  compliment_freeze: "overreaction",
  meal_prep: "knew_better_did_anyway",
  bedtime: "intent_vs_outcome",
  screen_time: "future_self_betrayed",
  journaling_habit: "advice_unfollowed",
  parking_lecture: "double_standard",
  morning_pages: "said_vs_meant",
  streaming_pick: "what_if_spiral",
  restaurant_pick: "deferring_to_others",
  outfit_paralysis: "perfectionism_stall",
  gym_signup_signs: "asking_for_signs",
  breakup_text_pivot: "last_minute_pivot",
  birthday_song: "group_chat_shame",
  wave_back: "social_radar_off",
  loud_neighbor_call: "boundary_violated",
  group_chat_lurk: "unspoken_rule_broken",
  library_voice: "public_correction",
  wrong_year_form: "anachronism_realization",
  meeting_collision: "schedule_collision",
  season_door: "season_shock",
  birthday_age_dread: "age_dysphoria",
  customer_service_voice: "voice_shift",
  accent_pickup: "accent_slip",
  old_photo_self: "old_self_intrusion",
  nap_ambush: "sleep_signal_ignored",
  sneeze_chain: "sneeze_chain",
  posture_collapse_zoom: "posture_collapse",
  bladder_brain_drive: "bladder_brain",
  voice_crack_meeting: "voice_crack",
  typing_dots_paused: "i_dont_know_they_know",
  dinner_lie: "both_pretending",
  delivery_secret: "secret_kept",
  wrong_chat_send: "secret_overshared",
  gym_avoid_coworker: "dramatic_irony_self",
  bathroom_eavesdrop: "eavesdrop_aftermath",
  wifi_outage: "technology_rebellion",
  surprise_storm: "unexpected_weather",
  trash_smell_hunt: "smell_invasion",
  flicker_skincare: "lighting_betrayal",
  package_pile_unknown: "package_drama",
  name_blank_party: "name_blank",
  password_reset_loop: "password_amnesia",
  song_loop_brushing: "song_stuck",
  did_i_lock_door: "deja_vu_loop",
  wrong_friend_text: "memory_collision",
  mug_replaced: "replacement_inferior",
  lucky_pen_missing: "missing_prop",
  routine_witness: "witness_to_ritual",
  kid_copies_brushing: "ritual_inheritance",
  birthday_aftermath: "post_event_void",
  concert_aftermath: "crowd_dispersed",
  email_drama_paperwork: "expected_drama_got_paperwork",
  vacation_first_morning: "buildup_to_nothing",
  peak_was_yesterday_workout: "peak_was_yesterday",
};

/**
 * (template, scenario) overrides where the template's structural shape
 * fundamentally reshapes the narrative family away from the scenario default.
 *
 * Failure-shape templates (`avoidance`, `routine_contradiction`,
 * `expectation_vs_reality`) DO push picks into `failure_contradiction` — but
 * the per-batch <40% guard in `batchGuardsPass` ensures no batch is
 * dominated by them. Together with the scenario defaults' deliberate spread,
 * the natural pool stays ~12-20% failure_contradiction.
 */
const IDEA_CORE_TYPE_OVERRIDES: Partial<
  Record<TemplateId, Partial<Record<string, IdeaCoreType>>>
> = {
  denial_loop: {
    sleep: "denial",
    coffee: "rationalization",
    gym: "denial",
    hydration: "denial",
    skincare: "rationalization",
    productivity: "rationalization",
    dishes: "denial",
    closet_pile: "rationalization",
    cleaning: "denial",
    snack: "rationalization",
    fridge: "rationalization",
  },
  expectation_vs_reality: {
    gym: "expected_vs_got",
    productivity: "plan_vs_reality",
    morning: "plan_vs_reality",
    weekend_plans: "expected_vs_got",
    walk: "expected_vs_got",
    outfit: "expected_vs_got",
    podcast: "expected_vs_got",
  },
  small_panic: {
    texting: "quiet_panic",
    emails: "quiet_panic",
    social_post: "quiet_panic",
    social_call: "quiet_panic",
    shopping: "quiet_panic",
  },
  avoidance: {
    dishes: "planned_vs_did",
    hydration: "promise_to_self_broken",
    productivity: "planned_vs_did",
    skincare: "promise_to_self_broken",
    cleaning: "planned_vs_did",
    laundry: "promise_to_self_broken",
    emails: "planned_vs_did",
    gym: "planned_vs_did",
  },
  social_awareness: {
    mirror_pep_talk: "fake_until_real",
    weekend_plans: "awkward_silence_filler",
    social_call: "mismatched_energy",
    social_post: "status_anxiety",
    texting: "misread_room",
    outfit: "status_anxiety",
  },
  routine_contradiction: {
    productivity: "double_standard",
    coffee: "advice_unfollowed",
    dishes: "double_standard",
    skincare: "advice_unfollowed",
    cleaning: "double_standard",
    morning: "double_standard",
    hydration: "advice_unfollowed",
  },
};

/**
 * Resolve the IdeaCoreType for a (template, scenario) pair at assembly time.
 * Override → scenario default → safe fallback (`planned_vs_did` so the
 * caller never gets undefined; the failure-cluster guard will limit any
 * over-concentration of the fallback).
 */
export function resolveIdeaCoreType(
  templateId: TemplateId,
  family: string,
): IdeaCoreType {
  const override = IDEA_CORE_TYPE_OVERRIDES[templateId]?.[family];
  if (override) return override;
  return IDEA_CORE_TYPE_BY_FAMILY[family] ?? "planned_vs_did";
}

/**
 * Resolve the IdeaCoreType for a cached batch entry. Falls back to the
 * scenario-default when templateId is absent (legacy cache entries pre-
 * dating this taxonomy). Returns null when family itself is missing or
 * unknown — caller skips the candidate's contribution to cross-batch sets.
 */
export function lookupIdeaCoreType(
  family: string | undefined,
  templateId?: string,
): IdeaCoreType | null {
  if (!family) return null;
  if (templateId !== undefined) {
    const override =
      IDEA_CORE_TYPE_OVERRIDES[templateId as TemplateId]?.[family];
    if (override) return override;
  }
  return IDEA_CORE_TYPE_BY_FAMILY[family] ?? null;
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
/**
 * Phase 3B PART 1 — pairs of adjacent words that always indicate a
 * grammar break from a fragile template/noun composition. Checked
 * case-insensitively as a substring scan over the lowercased hook.
 * Each entry is a literal bigram; the regex engine is not used here
 * so accidental injection of regex metacharacters in a future
 * addition cannot weaken the rail.
 *
 * NOTE: keep this list narrow — false positives here cost real
 * candidates. The article-collision rail below catches the bulk of
 * "the the" / "a the" / "the a" cases without needing entries here.
 */
const BANNED_GRAMMAR_BIGRAMS: ReadonlyArray<string> = [
  "talks about it's",
  "talks about its",
  "thinking about it's",
  "thinking about its",
  "thinks about it's",
  "thinks about its",
  "about it's 3am",
  "about it's 2am",
];

/**
 * Phase 3B PART 1 — words that may legitimately appear adjacent to a
 * duplicate of themselves in natural English. Used by the
 * `repeated-word` rail so legitimate constructions ("had had",
 * "that that") aren't rejected. Empty by default — re-add only if a
 * real corpus-driven case appears.
 */
const REPEATED_WORD_ALLOWLIST: ReadonlySet<string> = new Set<string>([
  "had", // "I had had enough"
  "that", // "the thing that that means"
]);

export function validateHook(hook: string): boolean {
  const trimmed = hook.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.includes("${")) return false;
  if (/(\.{3}|…)\s*$/.test(trimmed)) return false;
  const words = trimmed.split(/\s+/);
  // Phase 3 PART 1 (HOOK TEMPLATE / SCROLL-STOPPING UPGRADE): floor
  // lowered from 3 → 2 to admit FRAGMENT-style scroll-stopping hooks
  // ("still nothing.", "immediately no.") that the spec PART 5 calls
  // out as the target voice. The other rejection rails (banned
  // prefix / generic filler / voice violation / dangling word /
  // truncation marker / interpolation leak) all still apply, so a
  // 2-word hook only passes if it's intentionally abrupt — not
  // accidentally truncated.
  if (words.length < 2 || words.length > 10) return false;
  const last = words[words.length - 1]!
    .toLowerCase()
    .replace(/[.,!?;:]+$/g, "");
  if (DANGLING_TRAILING_WORDS.has(last)) return false;
  if (lookupBannedHookPrefix(trimmed)) return false;
  if (containsGenericFiller(trimmed)) return false;
  if (containsVoiceViolation(trimmed)) return false;
  // Phase 3B PART 1 — article-collision rail. Catches the
  // "the the promotion post" / "a the mirror" / "the a fridge"
  // family of bugs caused by a template prefixing "the"/"a"/"an"
  // around a topicNoun that already starts with its own article.
  // The picker will move on to the next entry on rejection (same
  // mechanism as banned-prefix / generic-filler), so the catalog
  // self-heals without manual per-template auditing.
  if (/\b(the|a|an)\s+(the|a|an)\b/i.test(trimmed)) return false;
  // Phase 3B PART 1 — repeated-word rail. Catches "the the",
  // "is is", "to to" produced by template-noun composition
  // races. Allowlist preserves legitimate doublings.
  const lowerWords = trimmed
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[.,!?;:'"()]+/g, ""));
  for (let i = 1; i < lowerWords.length; i++) {
    const w = lowerWords[i]!;
    if (w.length === 0) continue;
    if (lowerWords[i - 1] === w && !REPEATED_WORD_ALLOWLIST.has(w)) {
      return false;
    }
  }
  // Phase 3B PART 1 — grammar-break bigram rail. Targeted catches
  // for "talks about it's …" / "thinking about it's …" composition
  // bugs the previous QA driver surfaced.
  const lowered = trimmed.toLowerCase();
  for (const bigram of BANNED_GRAMMAR_BIGRAMS) {
    if (lowered.includes(bigram)) return false;
  }
  return true;
}

/**
 * Phase 6 (BIG PREMISE LAYER) — anti-boring / comedy-compression
 * validator applied IN ADDITION to `validateHook` for entries marked
 * `bigPremise: true`. Enforces spec PART 2 (≤10 words — already in
 * `validateHook`) + PART 3 (no comedy-deflating filler words) + PART 4
 * penalty rules (no naked "i did X again" / "i (was )?thinking about" /
 * lazy-observation openers). Legacy template entries skip this gate
 * entirely (the picker only invokes it when `entry.bigPremise === true`)
 * so the existing flow is untouched and back-compat is preserved.
 *
 * Returns `true` when the candidate is sharp enough to ship as a
 * premise; `false` when it should be rejected so the picker walks to
 * the next entry in seed-rotated order (same self-healing path as
 * `validateHook` rejection).
 */
const BIG_PREMISE_FILLER_WORDS: ReadonlySet<string> = new Set<string>([
  "just",
  "really",
  "basically",
  "literally",
  "actually",
]);

const BIG_PREMISE_FILLER_PHRASES: readonly string[] = [
  "kind of",
  "pretty much",
  "sort of",
];

const BIG_PREMISE_BORING_PATTERNS: readonly RegExp[] = [
  // "i did X again" / "i tried X again" — Part 4 boring pattern
  /\bi (did|tried|attempted|was) \w+ again\b/i,
  // "i (was )?thinking about" — naked observation opener
  /\bi (was |am )?thinking about\b/i,
  // "i think …" as the FIRST two words — lazy observation opener
  /^i think\b/i,
  // "i feel like …" as the FIRST three words — lazy observation opener
  /^i feel like\b/i,
  // "you know when …" as the FIRST three words — lazy observation opener
  /^you know when\b/i,
];

export function validateBigPremise(hook: string): boolean {
  const trimmed = hook.trim();
  if (trimmed.length === 0) return false;
  // Word-count cap (spec PART 2). `validateHook` already enforces
  // ≤10 words but premises must NEVER bypass this even if the
  // shared validator is later relaxed.
  const words = trimmed.split(/\s+/);
  if (words.length > 10) return false;
  // Filler-word rail (spec PART 3 — "comedy compression").
  const lower = trimmed.toLowerCase();
  for (const word of words) {
    const w = word.toLowerCase().replace(/[.,!?;:'"()]+/g, "");
    if (BIG_PREMISE_FILLER_WORDS.has(w)) return false;
  }
  for (const phrase of BIG_PREMISE_FILLER_PHRASES) {
    if (lower.includes(phrase)) return false;
  }
  // Boring-pattern rail (spec PART 4 penalty class).
  for (const pat of BIG_PREMISE_BORING_PATTERNS) {
    if (pat.test(trimmed)) return false;
  }
  return true;
}

/**
 * Phase 6C (OUTPUT LINE OPTIMIZATION) — comedy-compression transform.
 *
 * Pure, idempotent string transform that strips comedy-deflating
 * filler words / softeners / redundant trailing words from a hook,
 * collapses double whitespace, and trims. Designed to be called
 * AFTER `validateHook` + `validateBigPremise` pass on a candidate;
 * the picker then RE-runs `validateHook` on the compressed string
 * (defensive — compression could in principle expose a previously-
 * masked banned prefix or dangling word) and uses the compressed
 * form ONLY when re-validation passes. If compression would push
 * word count below the safety floor (3 words), the original is
 * returned unchanged.
 *
 * Idempotence: calling `compressHook(compressHook(s))` returns the
 * same string as `compressHook(s)` because every transform is
 * content-removal — running on a fully-compressed string is a no-op.
 *
 * Empty-safety: never returns the empty string. If the input is
 * blank or compression somehow produces blank, returns the original.
 *
 * Casing-safety: case-insensitive matches (regex `i` flag), but
 * surviving tokens keep their original casing — we never lowercase
 * the result, since voice-faithful catalog entries deliberately use
 * lowercase / fragments and shouldn't be reflowed. The tone-inflect
 * pass upstream is the only legitimate place to alter casing.
 *
 * NOT exported from the picker's main hot path — only the picker's
 * `walk()` and the QA driver call it. Listed under the `// Phase
 * 6C` block alongside `validateOutputLine` for cohesion.
 */
const COMPRESS_FILLER_PHRASES: ReadonlyArray<RegExp> = [
  // Multi-word softeners. Match a leading word boundary + the phrase
  // + ONE trailing whitespace so we don't leave double-spaces after
  // removal; the trailing collapse-whitespace pass below cleans up
  // the rest. Case-insensitive throughout.
  /\b(?:a little bit|i feel like|you know|kind of|sort of|pretty much)\s+/gi,
];

const COMPRESS_FILLER_WORDS: ReadonlyArray<RegExp> = [
  // Single filler words — cut when followed by another word so we
  // don't strip the only content token (e.g. "just." stays). Matches
  // word + trailing whitespace; the collapse-whitespace pass below
  // cleans up the residual gap. Case-insensitive throughout.
  /\b(?:currently|basically|literally|actually|really|just)\s+/gi,
];

const COMPRESS_TRAILING_WORDS: ReadonlyArray<RegExp> = [
  // Trailing redundant words ("today" / "again") at the end of a
  // hook, optionally followed by terminal punctuation. We preserve
  // the punctuation so the rendered hook keeps its ".", "?", or "!".
  /\s+(?:today|again)([.,!?;:]*)$/i,
];

export function compressHook(hook: string): string {
  const original = hook.trim();
  if (original.length === 0) return original;

  let working = original;

  // Pass 1 — multi-word softener phrases.
  for (const re of COMPRESS_FILLER_PHRASES) {
    working = working.replace(re, "");
  }
  // Pass 2 — single filler words (only when followed by another
  // word, per the regex's required trailing whitespace).
  for (const re of COMPRESS_FILLER_WORDS) {
    working = working.replace(re, "");
  }
  // Pass 3 — trailing redundant words. Preserve any terminal
  // punctuation via the captured group.
  for (const re of COMPRESS_TRAILING_WORDS) {
    working = working.replace(re, "$1");
  }
  // Collapse double whitespace + trim. Compression can leave " "
  // gaps where a word was removed mid-sentence.
  working = working.replace(/\s+/g, " ").trim();

  // Empty-safety + min-word-count safety. If compression dropped to
  // blank or below 3 tokens, fall back to the original — better to
  // ship the un-compressed hook than risk a fragment that violates
  // `validateHook`'s lower bound on the second-pass re-validate.
  if (working.length === 0) return original;
  const finalWords = working.split(/\s+/).filter((w) => w.length > 0);
  if (finalWords.length < 3) return original;

  return working;
}

/**
 * Phase 6C (OUTPUT LINE OPTIMIZATION) — caption-like / over-clever /
 * AI-feel rejection rail. Layered AFTER `validateHook` +
 * `validateBigPremise` (and after `compressHook`) inside the picker's
 * `walk()` — entries whose final compressed output trips any of the
 * patterns below fall through to the next phrasing in seed-rotated
 * order, the SAME self-healing path used by `validateHook` rejection.
 *
 * Each rule encodes one of the spec PART 6 anti-patterns:
 *   - caption-like: 3+ sentences (multiple period+capital boundaries)
 *     reads as a social-media caption rather than a punchy hook.
 *   - too-many-clauses: >2 commas OR >2 of `and|but|or|because`.
 *     Premise hooks land in 6-10 words; multi-clause structure
 *     dilutes the joke.
 *   - over-clever lexical signals: `paradox` / `conundrum` /
 *     `juxtaposition` / `irony` / `oxymoron` are essayist words that
 *     signal "I am a thoughtful observation" rather than "this made
 *     me laugh out loud" — every catalog entry was audited; none of
 *     these words appear in any `build()` output (only in style-id
 *     telemetry tags + emotionalSpike strings, which never reach the
 *     hook surface).
 *   - AI-feel scaffolding: `it turns out that` / `as it happens` /
 *     `interestingly enough` / `the truth is` / leading-or-post-comma
 *     `ultimately` are formal-essay framings the catalog also
 *     audited as absent. Rejecting them at the picker is a forward-
 *     compatibility rail for any future entry / Llama mutation that
 *     might re-introduce them.
 *
 * Returns `true` when the hook is safe to ship as-is; `false` when
 * the picker should walk to the next entry. Pure (no I/O), so safe
 * to call from any code path that has a candidate hook string.
 */
const OVER_CLEVER_WORDS: ReadonlyArray<RegExp> = [
  // \b boundary on each side keeps "ironic" / "paradoxical" /
  // "ironies" out of the false-positive set, since the spec only
  // flags the noun forms ("paradox", "irony", etc.).
  /\b(?:paradox|conundrum|juxtaposition|irony|oxymoron)\b/i,
];

const AI_FEEL_PATTERNS: ReadonlyArray<RegExp> = [
  /\bit turns out that\b/i,
  /\bas it happens\b/i,
  /\binterestingly enough\b/i,
  /\bthe truth is\b/i,
  // "ultimately" only when leading or after a comma (typical AI-feel
  // placement). Standalone mid-sentence "ultimately" is rare in
  // natural speech but common in AI-generated essay text.
  /(?:^|,\s+)ultimately\b/i,
];

export function validateOutputLine(hook: string): boolean {
  const trimmed = hook.trim();
  if (trimmed.length === 0) return false;

  // Caption-like — count internal sentence boundaries (period /
  // exclamation / question mark followed by whitespace + an
  // alphanumeric character). 1+ such boundary means the hook has 2+
  // sentences; 2+ means 3+ sentences (caption-like). Premise +
  // legacy fragment hooks are 0-1 sentence by spec, so the threshold
  // ≥2 internal boundaries is a comfortable rejection floor.
  const sentenceBoundaries = (trimmed.match(/[.!?]\s+[A-Za-z0-9]/g) || []).length;
  if (sentenceBoundaries >= 2) return false;

  // Too-many-clauses — comma count > 2.
  const commas = (trimmed.match(/,/g) || []).length;
  if (commas > 2) return false;
  // Too-many-conjunctions — > 2 of and|but|or|because. \b boundary
  // both sides keeps "android" / "border" out of the count.
  const conjunctions = (trimmed.match(/\b(?:and|but|or|because)\b/gi) || []).length;
  if (conjunctions > 2) return false;

  // Over-clever lexical signals. Substring scan via regex.
  for (const re of OVER_CLEVER_WORDS) {
    if (re.test(trimmed)) return false;
  }
  // AI-feel formal scaffolding.
  for (const re of AI_FEEL_PATTERNS) {
    if (re.test(trimmed)) return false;
  }

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
  /**
   * Phase 4 (HOOK INTENT) — optional intent tag for legacy entries.
   * Used by `tryRewrite` so the rewriter can prefer entries matching
   * the original `meta.hookIntent` when retrying. Optional because
   * legacy cache / fallback paths may construct entries without it;
   * readers default to `scroll_stop` via `getEntryIntent` (the safest
   * default since the legacy validator already rejects open-loop /
   * relatable-style banned prefixes — anything that ships through
   * legacy is fragment-shaped by construction).
   */
  hookIntent?: HookIntent;
  /**
   * Phase 3 HOOK TEMPLATE TUNING — symmetric flag with the same name
   * + semantics on `LanguagePhrasingEntry` so the per-intent scorers
   * can apply the -2 generic penalty to legacy 5-style entries the
   * same way they do for the new Phase 3 entries. See the JSDoc on
   * `LanguagePhrasingEntry.genericHook` for the full contract.
   */
  genericHook?: boolean;
  /**
   * Phase 3 HOOK TEMPLATE TUNING — symmetric `skeletonId` field for
   * legacy 5-style entries, so a formulaic legacy template (e.g. a
   * scaffold-dominated `(s) =>` build) participates in the same
   * within-batch + cross-batch skeleton-cap as Phase 3 entries. See
   * the JSDoc on `LanguagePhrasingEntry.skeletonId` for semantics.
   */
  skeletonId?: string;
  /**
   * Phase 3C HOOK CATALOG TAG COMPLETION — symmetric `allowedNounTypes`
   * field for legacy 5-style entries used by `tryRewrite`. Same
   * semantics as `LanguagePhrasingEntry.allowedNounTypes`: undefined =
   * "any noun type works", otherwise the rewriter skips this entry
   * BEFORE calling `entry.build(scenario)` when
   * `scenario.topicNounType` is not in the allowlist. Critical for
   * preventing semantically-incompatible rewrites like
   * "I am totally fine about the wave" (event noun + denial template).
   */
  allowedNounTypes?: ReadonlyArray<TopicNounType>;
};

export const HOOK_PHRASINGS_BY_STYLE: Record<HookStyle, HookPhrasingEntry[]> = {
  the_way_i: [
    {
      opener: "the_way_i",
      build: (s) => `the way I avoid ${s.topicNoun} like a sport`,
      hookIntent: "relatable",
      skeletonId: "way_i_avoid_sport",
      allowedNounTypes: ["object", "place", "event", "person"] as const,
    },
    {
      opener: "the_way_i",
      build: (s) => `the way I gaslight myself about ${s.topicNoun}`,
      hookIntent: "relatable",
      skeletonId: "way_i_gaslight_about",
      allowedNounTypes: ["abstract", "event", "body_state", "place"] as const,
    },
    {
      opener: "me_saying",
      build: (s) => `me, refusing to deal with ${s.topicNoun}`,
      hookIntent: "relatable",
      skeletonId: "refusing_to_deal",
    },
  ],
  why_do_i: [
    {
      opener: "why_did_i",
      build: (s) => `why did I lie to myself about ${s.topicNoun}`,
      hookIntent: "relatable",
      skeletonId: "why_lie_about",
    },
    {
      opener: "why_did_i",
      build: (s) => `why did I expect anything from ${s.topicNoun}`,
      hookIntent: "relatable",
      skeletonId: "why_expect_anything",
      allowedNounTypes: ["object", "place", "event", "person"] as const,
    },
    {
      opener: "denial_statement",
      build: (s) => `I am totally fine about ${s.topicNoun}`,
      hookIntent: "relatable",
      skeletonId: "totally_fine_about",
      allowedNounTypes: ["abstract", "body_state", "object", "place"] as const,
      // Phase 6D: this is a legacy `HookPhrasingEntry` in
      // HOOK_PHRASINGS_BY_STYLE (the 5-style fallback pool), NOT a
      // `LanguagePhrasingEntry` in the premise pool. The two pools
      // have DIFFERENT types and DIFFERENT picker paths — a previous
      // attempt to add `bigPremise/premiseStyleId/executionId` here
      // failed TS object-literal check (those fields don't exist on
      // `HookPhrasingEntry`) and would have been a runtime no-op
      // anyway because `pickValidatedPhrasing` doesn't propagate
      // them to candidate `meta`. Re-tagging this template as premise
      // would require structurally MOVING it into a
      // `LanguagePhrasingEntry[]` premise array (cross-cutting
      // refactor, deferred). Spec rule "do NOT artificially suppress
      // legacy further" applies — this entry stays as legitimate
      // legacy "rhythm and variety" content per spec PART 1.
    },
  ],
  internal_thought: [
    {
      opener: "i_really",
      build: (s) => `I really thought I'd ${s.actionShort}`,
      hookIntent: "relatable",
      // Phase 6D: see the matching JSDoc on the `denial_statement`
      // entry above ("I am totally fine about ${topicNoun}") — these
      // legacy `HookPhrasingEntry` templates live in the 5-style
      // legacy pool, NOT the `LanguagePhrasingEntry` premise pool, so
      // adding `bigPremise/premiseStyleId/executionId` here is both
      // a TS error AND a runtime no-op. They stay legitimate legacy.
    },
    {
      opener: "i_really",
      build: (s) => `I really planned to handle ${s.topicNoun}`,
      hookIntent: "relatable",
      skeletonId: "planned_to_handle",
    },
    {
      opener: "me_saying",
      build: (s) => `me, lying about ${s.topicNoun} again`,
      hookIntent: "relatable",
      skeletonId: "lying_about_again",
      allowedNounTypes: ["abstract", "body_state", "object", "place"] as const,
    },
  ],
  contrast: [
    {
      opener: "what_i_planned_vs",
      build: () => `what I planned vs how it actually went`,
      hookIntent: "relatable",
      genericHook: true,
    },
    {
      opener: "what_i_planned_vs",
      build: () => `what morning me promised vs night me delivered`,
      hookIntent: "relatable",
      genericHook: true,
    },
    {
      opener: "me_saying",
      build: () => `me at 9am vs me at 9pm`,
      hookIntent: "relatable",
      genericHook: true,
    },
  ],
  curiosity: [
    {
      opener: "this_is_where",
      build: () => `this is where the plan officially fell apart`,
      hookIntent: "compulsion",
      genericHook: true,
    },
    {
      opener: "silent_panic",
      build: () => `silent panic, zero words, full body`,
      hookIntent: "scroll_stop",
      genericHook: true,
    },
    {
      opener: "realization",
      build: () => `the moment I knew I was never going`,
      hookIntent: "compulsion",
      genericHook: true,
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

/* ------------------------------------------------------------------ */
/* HOOK INTENT — controller axis ABOVE HookLanguageStyle (Phase 4).    */
/*                                                                     */
/* HookLanguageStyle answers "what TYPE of thought" (confession /       */
/* observation / question / …). HookIntent answers "what JOB does the   */
/* hook do for the viewer":                                             */
/*   - scroll_stop : abrupt, surprising, fragment — makes the user      */
/*     PAUSE on the post (anti_hook fragments, time_stamps, absurd      */
/*     claims, object_pov, hard 2-word interruptions).                  */
/*   - compulsion  : open loop / forward-implication — makes the user   */
/*     CONTINUE to find out what happened (questions, instructions,     */
/*     escalation, narrative ending mid-arc).                           */
/*   - relatable   : specific first-person admission — makes the user   */
/*     THINK "this is me" (confessions, comparisons me-vs-me, micro-    */
/*     story admission shapes).                                          */
/*                                                                      */
/* Generation flow: each candidate slot is assigned an intent           */
/* round-robin (slot % 3); the picker filters the chosen language-      */
/* style's entries to those matching the assigned intent, falling back  */
/* to ANY entry of that style if none match (telemetry-only — never     */
/* starves a slot). The `hookIntent` recorded on PatternMeta is the     */
/* intent of the entry that ACTUALLY won, not the assigned intent.     */
/* ------------------------------------------------------------------ */

export const HOOK_INTENTS = ["scroll_stop", "compulsion", "relatable"] as const;
export type HookIntent = (typeof HOOK_INTENTS)[number];

/* ------------------------------------------------------------------ */
/* Phase 5 — PATTERN MAPPING LAYER                                     */
/*                                                                    */
/* A 12-value typed VIDEO PATTERN axis layered ABOVE the existing      */
/* legacy `idea.pattern: string` field (which stays untouched — the    */
/* string field carries template-derived shape labels like "loop" /   */
/* "escalation" / "anticlimax" and is consumed by older selector      */
/* paths). VideoPattern is a parallel typed axis whose values map to  */
/* concrete filming approaches with explicit beats, pacing, and       */
/* camera style. Each idea gains `filmingGuide: string[]` derived     */
/* directly from the chosen pattern's beats — this is what the        */
/* creator-facing UI shows ("how to actually film this idea").        */
/*                                                                    */
/* SELECTION: pickVideoPattern walks PATTERN_BY_FAMILY[family] ∩      */
/* PATTERN_X_INTENT_COMPAT[hookIntent], ranking surviving candidates  */
/* by inverse recency (unused patterns boosted, recently-used         */
/* penalized) with a seed-deterministic tie-break. When the           */
/* family∩intent intersection is empty, falls back to family-only and */
/* sets `intentFallback=true` for telemetry — never returns null.     */
/*                                                                    */
/* DIVERSITY: max 2 picks share videoPattern per batch (hard guard    */
/* `h2` in batchGuardsPass, mirrors the existing legacy `idea.pattern */
/* ` cap). Cross-batch novelty: NoveltyContext.recentVideoPatterns +  */
/* selectionPenalty -3 per match (mirrors hookIntent / family levers).*/
/*                                                                    */
/* JSONB COMPAT: `videoPattern` on PatternMeta and `filmingGuide` on  */
/* Idea are BOTH OPTIONAL so cached pre-Phase-5 candidates round-trip */
/* cleanly — readers MUST treat absent as "no contribution to the     */
/* video-pattern axis" (same discipline as `voiceProfile`/`trendId`). */
/* ------------------------------------------------------------------ */

export const VIDEO_PATTERNS = [
  "silent_reaction",
  "escalation",
  "micro_story",
  "before_after",
  "pov_internal",
  "loop_behavior",
  "object_pov",
  "delayed_reaction",
  "montage_repeat",
  "confidence_collapse",
  "deadpan_statement",
  "cut_before_end",
] as const;
export type VideoPattern = (typeof VIDEO_PATTERNS)[number];

export type VideoPatternDef = {
  id: VideoPattern;
  /** 3-5 ordered shot beats. Becomes `idea.filmingGuide` verbatim. */
  beats: readonly string[];
  pacing: "fast" | "medium" | "slow";
  cameraStyle: string;
  typicalDuration: "short" | "medium";
};

export const PATTERN_DEFS: Record<VideoPattern, VideoPatternDef> = {
  silent_reaction: {
    id: "silent_reaction",
    beats: [
      "open on the trigger moment (object, screen, or event in frame)",
      "cut to your face — hold a flat, unreacting expression",
      "small involuntary tell (slow blink, eye dart, exhale)",
      "cut on the held look",
    ],
    pacing: "slow",
    cameraStyle: "static eye-level, single locked frame on face",
    typicalDuration: "short",
  },
  escalation: {
    id: "escalation",
    beats: [
      "first attempt — small, controlled, looks fine",
      "second attempt — slightly worse, you adjust",
      "third attempt — visibly worse, you commit harder",
      "final attempt — full failure, you stop",
    ],
    pacing: "fast",
    cameraStyle: "single locked frame, jump-cut between attempts",
    typicalDuration: "medium",
  },
  micro_story: {
    id: "micro_story",
    beats: [
      "establish the everyday setup in 1 shot",
      "show the small specific behavior the hook names",
      "show the result of that behavior",
      "land on the unspoken takeaway (face or object)",
    ],
    pacing: "medium",
    cameraStyle: "two locked frames, scene + reaction",
    typicalDuration: "medium",
  },
  before_after: {
    id: "before_after",
    beats: [
      "before-state shot — clear, framed identically to the after",
      "transition cut (no swipe, just hard cut)",
      "after-state shot — same framing, the change is the only diff",
      "optional 1-beat hold on the after",
    ],
    pacing: "fast",
    cameraStyle: "matched framing both sides, hard cut center",
    typicalDuration: "short",
  },
  pov_internal: {
    id: "pov_internal",
    beats: [
      "first-person POV of the situation as you see it",
      "overlay or voiceover of the inner monologue",
      "external behavior that contradicts the monologue",
      "hold the gap between thought and action",
    ],
    pacing: "medium",
    cameraStyle: "handheld POV, your hands in frame, text overlay for thoughts",
    typicalDuration: "medium",
  },
  loop_behavior: {
    id: "loop_behavior",
    beats: [
      "show the behavior once, fully",
      "cut and show it again, slightly different angle",
      "cut and show it a third time — same behavior, no progress",
      "end on the loop continuing (no resolution)",
    ],
    pacing: "medium",
    cameraStyle: "rotating angles around a single repeating action",
    typicalDuration: "medium",
  },
  object_pov: {
    id: "object_pov",
    beats: [
      "frame the object as the subject (low angle, fills frame)",
      "the object's perspective on what it 'sees' you do",
      "the object reacts (or doesn't) to your behavior",
      "cut on the object, not on you",
    ],
    pacing: "medium",
    cameraStyle: "low-angle on object, you in background or out of frame",
    typicalDuration: "short",
  },
  delayed_reaction: {
    id: "delayed_reaction",
    beats: [
      "the trigger event happens — you don't react",
      "continue what you were doing, fully composed",
      "beat passes (1-3 seconds of normal behavior)",
      "the reaction lands late, sudden, and disproportionate",
    ],
    pacing: "slow",
    cameraStyle: "static frame on you, no cuts until the late reaction",
    typicalDuration: "medium",
  },
  montage_repeat: {
    id: "montage_repeat",
    beats: [
      "same action, different setting #1",
      "same action, different setting #2",
      "same action, different setting #3",
      "optional 4th — the action becomes the punchline",
    ],
    pacing: "fast",
    cameraStyle: "matched framing across locations, hard cuts between",
    typicalDuration: "short",
  },
  confidence_collapse: {
    id: "confidence_collapse",
    beats: [
      "open at peak confidence — you commit fully to the bit",
      "first crack — something off-camera or in-frame undermines it",
      "visible shift in your expression as the confidence drains",
      "land on the collapsed version of the same pose / phrase",
    ],
    pacing: "medium",
    cameraStyle: "single locked frame, no cut — the collapse plays in one take",
    typicalDuration: "medium",
  },
  deadpan_statement: {
    id: "deadpan_statement",
    beats: [
      "open on a static frame of you, eye-level",
      "deliver the statement flat, no inflection",
      "hold the frame after the statement (1-2 seconds of silence)",
      "cut on the held silence, not on the line",
    ],
    pacing: "slow",
    cameraStyle: "static eye-level, talking-head, no cuts during delivery",
    typicalDuration: "short",
  },
  cut_before_end: {
    id: "cut_before_end",
    beats: [
      "build the action toward an obvious payoff",
      "the moment before the payoff lands, cut",
      "leave the resolution implied, not shown",
      "(no 4th beat — the cut IS the ending)",
    ],
    pacing: "fast",
    cameraStyle: "single moving or static frame, hard cut on the anticipation peak",
    typicalDuration: "short",
  },
};

/**
 * IdeaCoreFamily → allowed VideoPattern[].
 *
 * The Phase 5 spec lists 8 ideaCoreType-keyed mappings (overthinking,
 * avoidance, failure_contradiction, absurd_escalation, micro_win,
 * social_behavior, identity_conflict, time_distortion). Lumina's
 * actual taxonomy has 12 IdeaCoreFamilies. Mapping reconciles
 * semantically:
 *   - overthinking         → emotional_loop + decision_paralysis
 *   - avoidance            → ritual_disruption
 *   - failure_contradiction → failure_contradiction (exact)
 *   - absurd_escalation    → environmental_chaos
 *   - micro_win            → anti_climax
 *   - social_behavior      → social_friction
 *   - identity_conflict    → identity_drift
 *   - time_distortion      → time_distortion (exact)
 *
 * Three families are NOT in the spec (physical_betrayal,
 * information_asymmetry, memory_glitch). They get curated mappings
 * consistent with their narrative semantics — see inline notes.
 *
 * Every family resolves to ≥2 patterns, and every pattern appears
 * in at least one family entry. The selector intersects this set
 * with PATTERN_X_INTENT_COMPAT — the intersection is non-empty for
 * every (family, intent) combo across the full 12×3 Cartesian
 * (verified by the QA driver).
 */
export const PATTERN_BY_FAMILY: Record<IdeaCoreFamily, readonly VideoPattern[]> = {
  // overthinking — quiet rumination + recursive thought
  emotional_loop: ["pov_internal", "loop_behavior", "silent_reaction"],
  // exact spec match
  failure_contradiction: ["before_after", "micro_story", "confidence_collapse"],
  // overthinking, decision-flavored
  decision_paralysis: ["pov_internal", "loop_behavior", "delayed_reaction"],
  // social_behavior
  social_friction: ["montage_repeat", "pov_internal", "micro_story"],
  // exact spec match
  time_distortion: ["loop_behavior", "montage_repeat"],
  // identity_conflict
  identity_drift: ["before_after", "delayed_reaction", "confidence_collapse"],
  // NOT in spec — body-failing typically plays as quiet observation
  // ("the small humiliation of the body"). silent_reaction lands the
  // muted shock, micro_story frames the everyday setup, and
  // deadpan_statement gives the dry verbal acknowledgment lane.
  physical_betrayal: ["silent_reaction", "micro_story", "deadpan_statement"],
  // NOT in spec — the gap between what one party knows and what
  // another party shows. pov_internal carries the inner-knower
  // angle, delayed_reaction carries the late-realization angle,
  // before_after carries the "you knew / now you don't" cut.
  information_asymmetry: ["pov_internal", "delayed_reaction", "before_after"],
  // absurd_escalation
  environmental_chaos: ["escalation", "object_pov", "montage_repeat"],
  // NOT in spec — forgetting and misremembering play as quiet pause +
  // repetition. loop_behavior carries the rerun, silent_reaction
  // carries the held blank, delayed_reaction carries the eventual
  // catch-up.
  memory_glitch: ["loop_behavior", "silent_reaction", "delayed_reaction"],
  // avoidance
  ritual_disruption: ["micro_story", "deadpan_statement", "before_after"],
  // micro_win
  anti_climax: ["cut_before_end", "deadpan_statement", "silent_reaction"],
};

/**
 * VideoPattern × HookIntent compatibility.
 *
 * Spec PART 5 lists compat for 10 of 12 patterns:
 *   - scroll_stop : silent_reaction, deadpan_statement, object_pov
 *   - compulsion  : escalation, cut_before_end, delayed_reaction
 *   - relatable   : micro_story, loop_behavior, pov_internal,
 *                   montage_repeat
 *
 * The remaining 2 patterns (before_after, confidence_collapse) are
 * curated additions:
 *   - before_after        → scroll_stop + relatable
 *     (scroll_stop because the matched-framing hard cut is a strong
 *     visual hook; relatable because the change being shown IS the
 *     specific thing being claimed.)
 *   - confidence_collapse → compulsion + relatable
 *     (compulsion because the build-up demands the payoff; relatable
 *     because the collapse IS the admission the hook is making.)
 *
 * Stored INTENT-INDEXED (not PATTERN-indexed) so isPatternCompatible
 * can scan a small list per call. Both directions are covered by
 * the QA driver to catch any future drift.
 */
export const PATTERN_X_INTENT_COMPAT: Record<HookIntent, readonly VideoPattern[]> = {
  scroll_stop: [
    "silent_reaction",
    "deadpan_statement",
    "object_pov",
    "before_after",
  ],
  compulsion: [
    "escalation",
    "cut_before_end",
    "delayed_reaction",
    "confidence_collapse",
  ],
  relatable: [
    "micro_story",
    "loop_behavior",
    "pov_internal",
    "montage_repeat",
    "before_after",
    "confidence_collapse",
  ],
};

export function isPatternCompatible(
  pattern: VideoPattern,
  intent: HookIntent,
): boolean {
  return PATTERN_X_INTENT_COMPAT[intent].includes(pattern);
}

/**
 * pickVideoPattern — the Phase 5 selector.
 *
 * Walks PATTERN_BY_FAMILY[family] ∩ PATTERN_X_INTENT_COMPAT[intent],
 * ranking the survivors by inverse recency (unused patterns first,
 * recently-used patterns last). Ties are broken deterministically by
 * a fold of the seed so the same (family, intent, recent, seed)
 * inputs always produce the same pick.
 *
 * INTENT FALLBACK: when the intersection is empty (no allowed-by-
 * family pattern is also intent-compat), the selector falls back to
 * family-only and sets `intentFallback=true`. By construction across
 * the full 12-family × 3-intent Cartesian the intersection is
 * never empty (see the QA driver), so this fallback is paranoia
 * for future families/intents added without re-validating compat.
 *
 * UNDEFINED INTENT: when `intent` is undefined (callers that
 * pre-date Phase 4's hookIntent axis), the selector behaves as if
 * intent compat passes for everything — only family-allowed and
 * recency rank. `intentFallback` stays false in this case (no
 * intent was REQUESTED, so no fallback occurred).
 */
export function pickVideoPattern(
  family: IdeaCoreFamily,
  intent: HookIntent | undefined,
  recentPatterns: ReadonlySet<VideoPattern>,
  seed: number,
  premiseStyleId?: PremiseStyleId,
): {
  pattern: VideoPattern;
  intentFallback: boolean;
  premiseStyleAlignmentApplied: boolean;
} {
  const familyAllowed = PATTERN_BY_FAMILY[family];
  // Defensive: every family is registered above, but if a future
  // edit removes one the type-system would catch it at the
  // Record<IdeaCoreFamily, ...> declaration. This is just runtime
  // belt-and-suspenders — fall back to the full catalog.
  const allowed = familyAllowed.length > 0 ? familyAllowed : VIDEO_PATTERNS;

  let candidates: readonly VideoPattern[] = allowed;
  let intentFallback = false;
  if (intent !== undefined) {
    const intersected = allowed.filter((p) => isPatternCompatible(p, intent));
    if (intersected.length > 0) {
      candidates = intersected;
    } else {
      // No family-allowed pattern is intent-compat — fall back to
      // family-only. Telemetry flag set so QA can count starvation.
      intentFallback = true;
    }
  }

  // Phase 6B — premiseStyle → pattern alignment overlay. When the
  // candidate carries a fine-grained premiseStyleId, intersect the
  // family ∩ intent set with the style's compat list so the chosen
  // filming pattern AMPLIFIES the joke (not just satisfies the
  // family/intent allowlists). If the intersection is empty (style's
  // patterns don't overlap the family/intent path), fall back to the
  // family/intent candidates UNCHANGED — alignment is best-effort,
  // never a starvation source. Telemetry flag set so QA can count
  // hit/miss rate per style.
  let premiseStyleAlignmentApplied = false;
  if (premiseStyleId !== undefined) {
    const styleAllowed = PREMISESTYLE_TO_PATTERN_MAP[premiseStyleId];
    if (styleAllowed.length > 0) {
      const aligned = candidates.filter((p) => styleAllowed.includes(p));
      if (aligned.length > 0) {
        candidates = aligned;
        premiseStyleAlignmentApplied = true;
      }
    }
  }

  // Rank: unused (not in recentPatterns) before recently-used. Within
  // each bucket, deterministic seed-tie-break by name hash so the
  // same inputs always produce the same pick.
  const unsigned = (seed >>> 0);
  const ranked = [...candidates].sort((a, b) => {
    const aRecent = recentPatterns.has(a) ? 1 : 0;
    const bRecent = recentPatterns.has(b) ? 1 : 0;
    if (aRecent !== bRecent) return aRecent - bRecent;
    // Tie-break: deterministic seed fold over name char codes.
    const aHash = ((a.charCodeAt(0) * 31 + a.length) ^ unsigned) >>> 0;
    const bHash = ((b.charCodeAt(0) * 31 + b.length) ^ unsigned) >>> 0;
    return aHash - bHash;
  });

  const pattern = ranked[0]!;
  return { pattern, intentFallback, premiseStyleAlignmentApplied };
}

/* ------------------------------------------------------------------ */
/* End Phase 5 — PATTERN MAPPING LAYER                                 */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Phase 6 — BIG PREMISE + COMEDY COMPRESSION LAYER                    */
/*                                                                     */
/* A funnier-than-template variety of LanguagePhrasingEntry whose      */
/* `build` returns a complete scenario-AGNOSTIC premise hook (whole    */
/* joke, no template-noun-swap). Premises sit ABOVE templates per     */
/* spec PART 7 — they participate in the existing seed-rotated         */
/* picker so when a premise validates first it ships, otherwise the    */
/* picker falls through to the surrounding (template-shaped) entries  */
/* in the same HookLanguageStyle bucket. Five styles map to the       */
/* spec's PART 1 transformations:                                      */
/*   - self_roast          : exaggerate personal failure              */
/*   - absurd_metaphor     : turn the situation into something bigger */
/*   - contrast_duality    : two opposing identities                  */
/*   - over_dramatization  : make a small moment feel huge            */
/*   - identity_framing    : tie to "who I am"                        */
/* `bigPremise` + `premiseStyle` are OPTIONAL on LanguagePhrasingEntry */
/* (additive, JSON-safe). The picker layers an extra rejection rail   */
/* (`validateBigPremise`) ON TOP of `validateHook` for entries with    */
/* `bigPremise === true` — enforces the spec's PART 2 (≤10 words, no  */
/* filler) + PART 3 (no boring/observation phrasing) constraints,     */
/* without touching the legacy template flow.                          */
/* ------------------------------------------------------------------ */

export const BIG_PREMISE_STYLES = [
  "self_roast",
  "absurd_metaphor",
  "contrast_duality",
  "over_dramatization",
  "identity_framing",
] as const;
export type BigPremiseStyle = (typeof BIG_PREMISE_STYLES)[number];

/* ------------------------------------------------------------------ */
/* PHASE 6 EXPANSION (PREMISE STYLE ENGINE) — fine-grained 50-style    */
/* layer ABOVE the 5-bucket BigPremiseStyle infra. Each fine-grained   */
/* style maps to ONE parent BigPremiseStyle bucket via `parentBucket`  */
/* so all existing infrastructure (cross-batch novelty, cache          */
/* persistence, validators, hard-floor exemption, tryRewrite skip)     */
/* operates UNCHANGED at the bucket level. The fine-grained id is      */
/* layered on top as an extra novelty axis (within-batch hard-dedup +  */
/* cross-batch -2 demotion in `selectionPenalty`) so a single batch    */
/* never ships two entries of the SAME PremiseStyleId (spec's "no     */
/* same PremiseStyle twice in one batch" hard rule).                   */
/* ------------------------------------------------------------------ */

export const PREMISE_STYLE_IDS = [
  "self_roast_reactor",
  "absurd_escalation",
  "duality_clash",
  "overdramatic_reframe",
  "expectation_collapse",
  "irony_flip",
  "relatable_pain",
  "dopamine_denial",
  "collapse_core",
  "mundane_meltdown",
  "pattern_exposure",
  "delusion_downfall",
  "inner_demon",
  "micro_trauma",
  "fake_confidence",
  "anxiety_paradox",
  "lazy_genius",
  "doomscroll_disclosure",
  "adulting_betrayal",
  "hypocrisy_hyperdrive",
  "fomo_fracture",
  "self_destruction_speedrun",
  "self_sabotage_scrollstop",
  "chaos_confession",
  "rage_resonance",
  "metaphor_mayhem",
  "contrast_catastrophe",
  "pain_point_precision",
  "irony_implosion",
  "whiplash_wisdom",
  "everyday_armageddon",
  "delusion_spiral",
  "cringe_trigger",
  "confidence_crash",
  "anxiety_avalanche",
  "procrastination_paradox",
  "burnout_betrayal",
  "social_battery_sabotage",
  "manifestation_mockery",
  "group_chat_guilt",
  "main_character_meltdown",
  "comic_relief_cataclysm",
  "three_am_spiral",
  "todo_termination",
  "boundary_backfire",
  "plant_parent_psychosis",
  "cart_autopsy",
  "fridge_judgment",
  "dream_disappointment",
  "weekly_wipeout",
] as const;
export type PremiseStyleId = (typeof PREMISE_STYLE_IDS)[number];

const PREMISE_STYLE_ID_SET: ReadonlySet<string> = new Set<string>(
  PREMISE_STYLE_IDS,
);

/**
 * Phase 6 EXPANSION — per-style metadata. `parentBucket` MUST be one
 * of the 5 BigPremiseStyle buckets so the existing bucket-level
 * novelty levers (`recentBigPremiseStyles` cross-batch -2,
 * within-batch -3 dup) keep firing on the wider 50-id pool. The other
 * fields (`transformLogic` / `worksBestWith` / `hookShapes`) are
 * declarative metadata curated from the spec — currently telemetry-
 * only (no scorer/picker reads them) but reserved for downstream
 * tuning passes (e.g. ideaCoreFamily-aware compatibility filtering).
 * `executions` is what the catalog actually ships (Phase 6D — see the
 * `PremiseExecution` type below): each execution becomes one
 * `LanguagePhrasingEntry` premise entry via `buildPremiseEntriesFromDefs`,
 * tagged with `executionId` so the within-batch HARD `(premiseStyleId,
 * executionId)` dedup + cross-batch -2 demote / +2 fresh-boost levers
 * fire on the fine-grained execution axis on top of the bucket / style
 * axes.
 */
/**
 * Phase 6D (PREMISE EXECUTION EXPANSION) — a single execution-pattern
 * variant within a PremiseStyle. The premise-engine catalog declares
 * 3-5 executions per style so each style can be expressed in multiple
 * distinct comedic angles ("direct_failure", "relationship_framing",
 * "identity_framing", etc.) instead of a single canonical phrasing.
 *
 * - `id` — descriptive label (open-ended string, NOT a closed enum;
 *   shared across styles by convention so `direct_failure` in one
 *   style and `direct_failure` in another collide on the cross-batch
 *   `recentExecutionIds` lever for coherent semantic-pattern rotation).
 * - `pattern` — short prose tag describing the execution shape;
 *   inert at runtime (catalog-readability metadata only).
 * - `example` — the actual hook string the picker ships (validated by
 *   `validateHook` + `validateBigPremise` + `validateOutputLine` like
 *   any other premise entry).
 */
export type PremiseExecution = {
  id: string;
  pattern: string;
  example: string;
};

export type PremiseStyleDef = {
  label: string;
  purpose: string;
  transformLogic: readonly string[];
  worksBestWith: readonly string[];
  hookShapes: readonly string[];
  /**
   * Phase 6D — distinct execution variations of this style (3-5 each).
   * Each execution becomes one `LanguagePhrasingEntry` premise entry
   * via `buildPremiseEntriesFromDefs`, tagged with `executionId: exec.id`
   * so the within-batch HARD `(premiseStyleId, executionId)` dedup
   * + cross-batch -2 demote / +2 fresh-boost levers fire on the
   * fine-grained execution axis on top of the bucket / style axes.
   */
  executions: readonly PremiseExecution[];
  parentBucket: BigPremiseStyle;
};

export const PREMISE_STYLE_DEFS: Record<PremiseStyleId, PremiseStyleDef> = {
  self_roast_reactor: {
    label: "Self-Roast Reactor",
    purpose: "Make the creator the joke.",
    transformLogic: ["take a normal task", "frame creator as the failure point"],
    worksBestWith: ["failure_contradiction", "ritual_disruption", "decision_paralysis"],
    hookShapes: ["i cannot be trusted with X", "i ghosted my own X"],
    executions: [
      { id: "direct_failure", pattern: "flat statement of failure", example: "i cannot be trusted with simple tasks" },
      { id: "relationship_framing", pattern: "frame as broken relationship", example: "i ghosted my own to-do list" },
      { id: "identity_framing", pattern: "frame as core identity", example: "i specialize in disappointing myself" },
      { id: "understatement", pattern: "minimize the disaster", example: "this did not go well at all" },
    ],
    parentBucket: "self_roast",
  },
  absurd_escalation: {
    label: "Absurd Escalation Engine",
    purpose: "Turn a normal moment into chaos.",
    transformLogic: ["start with one tiny action", "show disproportionate consequence"],
    worksBestWith: ["environmental_chaos", "physical_betrayal", "failure_contradiction"],
    hookShapes: ["i did one X. ruined Y", "this got worse for no reason"],
    executions: [
      { id: "whiplash_pivot", pattern: "tiny action then instant escalation", example: "i checked one thing. ruined my day" },
      { id: "chaos_acceptance", pattern: "shrug at unexplained worsening", example: "this got worse for no reason" },
      { id: "cosmic_overreaction", pattern: "small cause cosmic effect", example: "one click and the whole day ended" },
      { id: "physical_stakes", pattern: "body-state escalation", example: "my body left the situation entirely" },
    ],
    parentBucket: "absurd_metaphor",
  },
  duality_clash: {
    label: "Duality Detonation",
    purpose: "Pit two versions of the creator against each other.",
    transformLogic: ["name two time-shifted selves", "show one betraying the other"],
    worksBestWith: ["identity_drift", "time_distortion", "decision_paralysis"],
    hookShapes: ["Xam me is A. Yam me is B", "morning me hates everything night me does"],
    executions: [
      { id: "time_marker", pattern: "two time-shifted selves clash", example: "2am me is a genius. 9am me is useless" },
      { id: "self_drag", pattern: "current me critiques past me", example: "morning me hates everything night me does" },
      { id: "expectation_collapse", pattern: "two selves disagree on plan", example: "yesterday me made promises today me cannot keep" },
      { id: "whiplash_pivot", pattern: "instant flip between selves", example: "monday me had goals. friday me has none" },
    ],
    parentBucket: "contrast_duality",
  },
  overdramatic_reframe: {
    label: "Overdramatization Overdrive",
    purpose: "Make a tiny issue feel huge.",
    transformLogic: ["take a mundane setback", "frame as life-altering catastrophe"],
    worksBestWith: ["anti_climax", "emotional_loop", "failure_contradiction"],
    hookShapes: ["this is where my life X", "a simple Y defeated me"],
    executions: [
      { id: "cosmic_overreaction", pattern: "frame mundane as catastrophic", example: "this is where my life collapsed" },
      { id: "understatement", pattern: "downplay actual mundane scale", example: "one chore ruined the whole afternoon" },
      { id: "identity_framing", pattern: "frame setback as personal undoing", example: "a small task became my villain origin" },
      { id: "physical_stakes", pattern: "tiny event body-level consequence", example: "this minor setback aged me visibly" },
    ],
    parentBucket: "over_dramatization",
  },
  expectation_collapse: {
    label: "Expectation Executioner",
    purpose: "Set up hope, destroy it fast.",
    transformLogic: ["state intention to do good thing", "instantly invalidate it"],
    worksBestWith: ["failure_contradiction", "anti_climax", "decision_paralysis"],
    hookShapes: ["i tried X. mistake.", "the plan did not survive Y"],
    executions: [
      { id: "whiplash_pivot", pattern: "intent then immediate failure", example: "i tried being productive. mistake." },
      { id: "expectation_collapse", pattern: "plan dies on contact", example: "the plan did not survive contact" },
      { id: "ironic_confidence", pattern: "confident pre-failure stance", example: "i had a system. the system won." },
      { id: "delusion_admission", pattern: "admit the lie to self", example: "the goal lasted six minutes" },
    ],
    parentBucket: "contrast_duality",
  },
  irony_flip: {
    label: "Savage Irony Inversion",
    purpose: "Say the opposite of what should be true.",
    transformLogic: ["pick a virtuous action", "show it producing the opposite outcome"],
    worksBestWith: ["failure_contradiction", "anti_climax", "ritual_disruption"],
    hookShapes: ["X somehow made me Y", "being responsible ruined Z"],
    executions: [
      { id: "expectation_collapse", pattern: "virtuous act backfires", example: "resting somehow made me more tired" },
      { id: "direct_failure", pattern: "responsibility produces failure", example: "being responsible ruined everything" },
      { id: "ironic_confidence", pattern: "doing it right made it worse", example: "doing it right made it worse" },
      { id: "understatement", pattern: "good behavior bad result casual", example: "the healthy choice was a mistake" },
    ],
    parentBucket: "contrast_duality",
  },
  relatable_pain: {
    label: "Relatable Pain Payload",
    purpose: "Expose a common private behavior.",
    transformLogic: ["name a private avoidance ritual", "show creator doing it"],
    worksBestWith: ["emotional_loop", "ritual_disruption", "social_friction"],
    hookShapes: ["i opened it and immediately closed it", "i checked it and pretended that counted"],
    executions: [
      { id: "pattern_naming", pattern: "expose private avoidance ritual", example: "i opened it and immediately closed it" },
      { id: "delusion_admission", pattern: "lie about doing the thing", example: "i checked it and pretended that counted" },
      { id: "direct_failure", pattern: "flat admission of avoidance", example: "i did the bare minimum and called it self-care" },
      { id: "self_drag", pattern: "third-person witness self", example: "watched myself avoid it in real time" },
    ],
    parentBucket: "self_roast",
  },
  dopamine_denial: {
    label: "Dopamine Denial Device",
    purpose: "Show craving vs self-control failure.",
    transformLogic: ["set up self-discipline", "show it collapsing on contact"],
    worksBestWith: ["emotional_loop", "ritual_disruption", "decision_paralysis"],
    hookShapes: ["my discipline expired X", "one Y became my whole personality"],
    executions: [
      { id: "expectation_collapse", pattern: "discipline collapses fast", example: "my discipline expired instantly" },
      { id: "identity_framing", pattern: "small habit becomes identity", example: "one scroll became my whole personality" },
      { id: "cosmic_overreaction", pattern: "tiny indulgence scaled consequence", example: "one snack rewrote the whole evening" },
      { id: "delusion_admission", pattern: "name the broken pact with self", example: "the rules i set lasted twelve minutes" },
    ],
    parentBucket: "over_dramatization",
  },
  collapse_core: {
    label: "Hyperbolic Collapse Core",
    purpose: "Make small failure feel like total collapse.",
    transformLogic: ["take one small inconvenience", "frame as full-day collapse"],
    worksBestWith: ["physical_betrayal", "environmental_chaos", "anti_climax"],
    hookShapes: ["this ended my whole X", "one Y took me out"],
    executions: [
      { id: "cosmic_overreaction", pattern: "tiny event ends momentum", example: "this ended my whole momentum" },
      { id: "understatement", pattern: "small thing casual KO framing", example: "one inconvenience took me out" },
      { id: "physical_stakes", pattern: "body-level collapse from minor cause", example: "a single notification flatlined my entire week" },
      { id: "gen_z_collapse", pattern: "collapse-speak vocabulary", example: "this absolutely demolished my whole vibe" },
    ],
    parentBucket: "absurd_metaphor",
  },
  mundane_meltdown: {
    label: "Mundane Meltdown Missile",
    purpose: "Make boring daily stuff emotionally dramatic.",
    transformLogic: ["pick a routine chore", "frame as final boss / war"],
    worksBestWith: ["ritual_disruption", "physical_betrayal", "environmental_chaos"],
    hookShapes: ["the X won again", "Y became my final boss"],
    executions: [
      { id: "relationship_framing", pattern: "personify chore as opponent", example: "the dishes won again" },
      { id: "cosmic_overreaction", pattern: "chore as boss-fight", example: "laundry became my final boss" },
      { id: "self_drag", pattern: "chore vs creator face-off", example: "the kitchen and i had a real moment" },
      { id: "physical_stakes", pattern: "chore drains body resources", example: "one errand drained the whole battery" },
    ],
    parentBucket: "absurd_metaphor",
  },
  pattern_exposure: {
    label: "Psychological Pattern Pulverizer",
    purpose: "Reveal a repeated behavior.",
    transformLogic: ["name the recurring loop", "label it as identity"],
    worksBestWith: ["emotional_loop", "identity_drift", "memory_glitch"],
    hookShapes: ["this is my entire pattern", "same X. new Y."],
    executions: [
      { id: "pattern_naming", pattern: "name the recurring loop", example: "this is my entire pattern" },
      { id: "self_drag", pattern: "expose repeat with same components", example: "same mistake. new outfit." },
      { id: "identity_framing", pattern: "frame loop as identity trait", example: "consistency is my failures on repeat" },
      { id: "delusion_admission", pattern: "admit the loop is the lifestyle", example: "the cycle is the personality at this point" },
    ],
    parentBucket: "identity_framing",
  },
  delusion_downfall: {
    label: "Delusional Downfall Drill",
    purpose: "Show confidence turning into failure.",
    transformLogic: ["claim early belief in self", "watch evidence destroy it"],
    worksBestWith: ["failure_contradiction", "anti_climax", "decision_paralysis"],
    hookShapes: ["i believed in myself too X", "the confidence was not supported by Y"],
    executions: [
      { id: "ironic_confidence", pattern: "premature confidence", example: "i believed in myself too early" },
      { id: "delusion_admission", pattern: "confidence wasn't backed", example: "the confidence was not supported by evidence" },
      { id: "expectation_collapse", pattern: "belief then evidence kills it", example: "i had hope. the evidence had jokes" },
      { id: "self_drag", pattern: "look back at past confidence", example: "past me was thriving on pure delusion" },
    ],
    parentBucket: "over_dramatization",
  },
  inner_demon: {
    label: "Inner Demon Detonator",
    purpose: "Externalize bad impulses.",
    transformLogic: ["personify the bad impulse", "let it win the scene"],
    worksBestWith: ["decision_paralysis", "emotional_loop", "identity_drift"],
    hookShapes: ["my brain chose violence at X", "the bad idea won immediately"],
    executions: [
      { id: "time_marker", pattern: "time-anchored bad impulse", example: "my brain chose violence at midnight" },
      { id: "expectation_collapse", pattern: "bad idea wins immediately", example: "the bad idea won immediately" },
      { id: "relationship_framing", pattern: "impulse as second character", example: "my impulse and i are co-conspirators" },
      { id: "identity_framing", pattern: "embrace the bad impulse as self", example: "the worst version of me clocked in early" },
    ],
    parentBucket: "absurd_metaphor",
  },
  micro_trauma: {
    label: "Micro-Trauma Magnifier",
    purpose: "Turn small awkwardness into lasting damage.",
    transformLogic: ["take a small awkward moment", "frame as permanent injury"],
    worksBestWith: ["social_friction", "memory_glitch", "anti_climax"],
    hookShapes: ["i will remember this forever", "that one moment changed my X"],
    executions: [
      { id: "direct_failure", pattern: "permanent damage from tiny thing", example: "i will remember this forever" },
      { id: "identity_framing", pattern: "single moment shifted personality", example: "that one moment changed my personality" },
      { id: "cosmic_overreaction", pattern: "minor event as origin story", example: "a small awkward second became my villain origin" },
      { id: "physical_stakes", pattern: "body still flinches at memory", example: "my body still flinches at the memory" },
    ],
    parentBucket: "over_dramatization",
  },
  fake_confidence: {
    label: "Fake Confidence Fracture",
    purpose: "Confidence cracks quickly.",
    transformLogic: ["walk in with a plan", "watch confidence vanish"],
    worksBestWith: ["social_friction", "decision_paralysis", "failure_contradiction"],
    hookShapes: ["i walked in like i had a X", "confidence left the Y first"],
    executions: [
      { id: "ironic_confidence", pattern: "claimed plan", example: "i walked in like i had a plan" },
      { id: "expectation_collapse", pattern: "confidence leaves immediately", example: "confidence left the room first" },
      { id: "self_drag", pattern: "outside view of fake confidence", example: "the act lasted maybe two seconds" },
      { id: "understatement", pattern: "downplay the confidence collapse", example: "the energy did not survive entry" },
    ],
    parentBucket: "self_roast",
  },
  anxiety_paradox: {
    label: "Anxiety Paradox Accelerator",
    purpose: "Show lazy body + anxious brain.",
    transformLogic: ["pit body's exhaustion against brain's panic", "show neither winning"],
    worksBestWith: ["physical_betrayal", "decision_paralysis", "emotional_loop"],
    hookShapes: ["too tired to X. too anxious to Y", "my body quit. my brain kept Z"],
    executions: [
      { id: "expectation_collapse", pattern: "tired but anxious double-bind", example: "too tired to move. too anxious to rest" },
      { id: "physical_stakes", pattern: "body-brain mismatch", example: "my body quit. my brain kept screaming" },
      { id: "understatement", pattern: "casual paradox framing", example: "i am exhausted and unable to relax" },
      { id: "cosmic_overreaction", pattern: "two opposing forces inside one body", example: "my brain and body have opposite agendas" },
    ],
    parentBucket: "over_dramatization",
  },
  lazy_genius: {
    label: "Lazy Genius Lockpick",
    purpose: "Clever excuse for laziness.",
    transformLogic: ["frame inaction as optimization", "weaponize jargon"],
    worksBestWith: ["ritual_disruption", "decision_paralysis", "anti_climax"],
    hookShapes: ["i optimized doing nothing", "this is efficiency if you don't think too hard"],
    executions: [
      { id: "delusion_admission", pattern: "frame inaction as optimization", example: "i optimized doing nothing" },
      { id: "ironic_confidence", pattern: "weaponize jargon for laziness", example: "this is efficiency if you don't think too hard" },
      { id: "identity_framing", pattern: "doing nothing is the strategy", example: "the plan was to have no plan" },
      { id: "self_drag", pattern: "honest about laziness as method", example: "rebranded my laziness as strategy" },
    ],
    parentBucket: "self_roast",
  },
  doomscroll_disclosure: {
    label: "Doomscroll Disclosure Bomb",
    purpose: "Expose phone spiral.",
    transformLogic: ["name the small intent", "show the hours-long spiral"],
    worksBestWith: ["time_distortion", "ritual_disruption", "emotional_loop"],
    hookShapes: ["i checked one thing. still here.", "my screen time filed a Y"],
    executions: [
      { id: "time_marker", pattern: "small intent then long spiral", example: "i checked one thing. still here." },
      { id: "relationship_framing", pattern: "personify the consequence", example: "my screen time filed a complaint" },
      { id: "delusion_admission", pattern: "admit the time-warp", example: "i went in for a minute. lost the evening" },
      { id: "physical_stakes", pattern: "body atrophy from spiral", example: "my thumb is the only working muscle" },
    ],
    parentBucket: "self_roast",
  },
  adulting_betrayal: {
    label: "Adulting Betrayal Blade",
    purpose: "Adult responsibility feels like a scam.",
    transformLogic: ["personify adulthood", "show it making demands"],
    worksBestWith: ["failure_contradiction", "ritual_disruption", "anti_climax"],
    hookShapes: ["adulthood keeps asking too X", "i tried adulting. it Y back"],
    executions: [
      { id: "direct_failure", pattern: "adulthood as too much", example: "adulthood keeps asking too much" },
      { id: "relationship_framing", pattern: "personify adulthood as opponent", example: "i tried adulting. it fought back" },
      { id: "delusion_admission", pattern: "admit adulthood was a scam", example: "nobody warned me adulting is part-time chaos" },
      { id: "understatement", pattern: "casual disappointment", example: "adulting did not match the brochure" },
    ],
    parentBucket: "over_dramatization",
  },
  hypocrisy_hyperdrive: {
    label: "Hypocrisy Hyperdrive",
    purpose: "Say one thing, do the opposite.",
    transformLogic: ["state the principle", "immediately violate it"],
    worksBestWith: ["failure_contradiction", "identity_drift", "decision_paralysis"],
    hookShapes: ["i said X. then disappeared", "my standards apply to Y only"],
    executions: [
      { id: "expectation_collapse", pattern: "say it then break it", example: "i said balance. then disappeared" },
      { id: "self_drag", pattern: "standards apply to others only", example: "my standards apply to future me only" },
      { id: "delusion_admission", pattern: "name the gap between word and act", example: "i preached one thing. did the other" },
      { id: "identity_framing", pattern: "double-standard as identity", example: "my values are very flexible apparently" },
    ],
    parentBucket: "self_roast",
  },
  fomo_fracture: {
    label: "FOMO Fracture Fuel",
    purpose: "Want inclusion but not the commitment.",
    transformLogic: ["want the invite", "reject the obligation"],
    worksBestWith: ["social_friction", "decision_paralysis", "emotional_loop"],
    hookShapes: ["i wanted an X. not a Y.", "i have fomo and no Z"],
    executions: [
      { id: "direct_failure", pattern: "want inclusion not the work", example: "i wanted an invite. not a plan." },
      { id: "understatement", pattern: "fomo without energy budget", example: "i have fomo and no energy" },
      { id: "delusion_admission", pattern: "honest about social paradox", example: "i miss everyone and want to see no one" },
      { id: "self_drag", pattern: "want plans abstractly", example: "i love being included from a safe distance" },
    ],
    parentBucket: "self_roast",
  },
  self_destruction_speedrun: {
    label: "Self-Destruction Speedrun",
    purpose: "Fast sabotage.",
    transformLogic: ["set up the win condition", "demolish it instantly"],
    worksBestWith: ["failure_contradiction", "decision_paralysis", "anti_climax"],
    hookShapes: ["i ruined it immediately", "record time. bad decision."],
    executions: [
      { id: "direct_failure", pattern: "instant ruin", example: "i ruined it immediately" },
      { id: "whiplash_pivot", pattern: "fast bad-decision pivot", example: "record time. bad decision." },
      { id: "self_drag", pattern: "outside view of speed", example: "speedrun mode of self-sabotage" },
      { id: "understatement", pattern: "casual fast collapse", example: "the situation lasted under a minute" },
    ],
    parentBucket: "self_roast",
  },
  self_sabotage_scrollstop: {
    label: "Scroll-Stopping Self-Sabotage",
    purpose: "Make the bad choice obvious.",
    transformLogic: ["acknowledge knowing better", "do it anyway"],
    worksBestWith: ["failure_contradiction", "decision_paralysis", "emotional_loop"],
    hookShapes: ["i knew better. did it anyway.", "i watched myself X"],
    executions: [
      { id: "delusion_admission", pattern: "knew better did it anyway", example: "i knew better. did it anyway." },
      { id: "self_drag", pattern: "watched self do bad thing", example: "i watched myself make it worse" },
      { id: "understatement", pattern: "casually self-destructive", example: "my judgment took the night off" },
      { id: "pattern_naming", pattern: "name the self-defeat ritual", example: "i sabotaged the thing i wanted" },
    ],
    parentBucket: "self_roast",
  },
  chaos_confession: {
    label: "Chaos Confession Catalyst",
    purpose: "Admit something unhinged.",
    transformLogic: ["frame self as research subject", "admit abnormal behavior"],
    worksBestWith: ["identity_drift", "memory_glitch", "decision_paralysis"],
    hookShapes: ["i need to be X", "this is not normal Y from me"],
    executions: [
      { id: "identity_framing", pattern: "self as research subject", example: "i need to be studied" },
      { id: "delusion_admission", pattern: "admit abnormal behavior", example: "this is not normal behavior anymore" },
      { id: "self_drag", pattern: "outside view of own chaos", example: "scientists could write entire papers about my chaos" },
      { id: "chaos_acceptance", pattern: "embrace the unhinged identity", example: "the chaos is the routine now" },
    ],
    parentBucket: "identity_framing",
  },
  rage_resonance: {
    label: "Rage Resonance Reactor",
    purpose: "Small annoyance becomes anger.",
    transformLogic: ["pick a tiny irritation", "escalate to disproportionate rage"],
    worksBestWith: ["physical_betrayal", "environmental_chaos", "social_friction"],
    hookShapes: ["this annoyed me more than it should", "i took that personally"],
    executions: [
      { id: "understatement", pattern: "low-key rage", example: "this annoyed me more than it should" },
      { id: "self_drag", pattern: "took it personally", example: "i took that personally" },
      { id: "physical_stakes", pattern: "body-level reaction", example: "my body had a full reaction over nothing" },
      { id: "cosmic_overreaction", pattern: "scaled-up rage", example: "a tiny inconvenience triggered nuclear rage" },
    ],
    parentBucket: "absurd_metaphor",
  },
  metaphor_mayhem: {
    label: "Metaphor Mayhem Machine",
    purpose: "Use surreal comparison.",
    transformLogic: ["pick a tech/social object", "map brain state onto it"],
    worksBestWith: ["emotional_loop", "memory_glitch", "decision_paralysis"],
    hookShapes: ["my brain is a X with Y", "my motivation left the Z"],
    executions: [
      { id: "relationship_framing", pattern: "brain as broken tool", example: "my brain is a browser with 47 tabs" },
      { id: "physical_stakes", pattern: "motivation as fled entity", example: "my motivation left the group chat" },
      { id: "cosmic_overreaction", pattern: "self as broken machine", example: "i am buffering at full capacity" },
      { id: "identity_framing", pattern: "self as outdated software", example: "my operating system needs a reboot" },
    ],
    parentBucket: "absurd_metaphor",
  },
  contrast_catastrophe: {
    label: "Contrast Catastrophe Core",
    purpose: "Opposite states collide.",
    transformLogic: ["state ambition", "state opposite reality"],
    worksBestWith: ["failure_contradiction", "decision_paralysis", "anti_climax"],
    hookShapes: ["big X. zero Y.", "high X. low Y."],
    executions: [
      { id: "expectation_collapse", pattern: "ambition vs reality", example: "big plans. zero movement." },
      { id: "self_drag", pattern: "high aim low output", example: "high standards. low execution." },
      { id: "understatement", pattern: "casual gap between aim and act", example: "the vision is grand. the doing is not" },
      { id: "whiplash_pivot", pattern: "ambition collapses on contact", example: "great idea. nothing happened" },
    ],
    parentBucket: "contrast_duality",
  },
  pain_point_precision: {
    label: "Pain Point Precision Nuke",
    purpose: "Hit one exact pain.",
    transformLogic: ["name the universal annoyance", "voice it bluntly"],
    worksBestWith: ["emotional_loop", "ritual_disruption", "anti_climax"],
    hookShapes: ["this hit a little too close", "this should not be this hard"],
    executions: [
      { id: "direct_failure", pattern: "name the universal pain", example: "this hit a little too close" },
      { id: "understatement", pattern: "shouldn't be this hard", example: "this should not be this hard" },
      { id: "delusion_admission", pattern: "admit shared private pain", example: "we all do this. nobody talks about it" },
      { id: "pattern_naming", pattern: "name the universal annoyance", example: "the same annoying thing every single day" },
    ],
    parentBucket: "over_dramatization",
  },
  irony_implosion: {
    label: "Irony Implosion Igniter",
    purpose: "The fix makes it worse.",
    transformLogic: ["attempt the remedy", "show it backfiring"],
    worksBestWith: ["failure_contradiction", "anti_climax", "ritual_disruption"],
    hookShapes: ["trying to X stressed me out", "Y made me less prepared"],
    executions: [
      { id: "expectation_collapse", pattern: "fix becomes failure", example: "trying to relax stressed me out" },
      { id: "self_drag", pattern: "preparation backfires", example: "planning made me less prepared" },
      { id: "ironic_confidence", pattern: "the cure caused the symptom", example: "the solution became a new problem" },
      { id: "understatement", pattern: "remedy worsens situation", example: "fixing it broke a different thing" },
    ],
    parentBucket: "contrast_duality",
  },
  whiplash_wisdom: {
    label: "Whiplash Wisdom Weapon",
    purpose: "Sudden realization with comedy.",
    transformLogic: ["reach the realization late", "make it about self"],
    worksBestWith: ["identity_drift", "memory_glitch", "anti_climax"],
    hookShapes: ["that's when i realized i was the X", "the lesson arrived late"],
    executions: [
      { id: "delusion_admission", pattern: "late realization", example: "that's when i realized i was the problem" },
      { id: "self_drag", pattern: "lesson came too late", example: "the lesson arrived late" },
      { id: "pattern_naming", pattern: "see the cycle finally", example: "and that's when the pattern became obvious" },
      { id: "understatement", pattern: "epiphany too late to use", example: "the realization could have helped earlier" },
    ],
    parentBucket: "contrast_duality",
  },
  everyday_armageddon: {
    label: "Everyday Armageddon Amplifier",
    purpose: "Daily routine feels apocalyptic.",
    transformLogic: ["pick a banal trigger", "frame as cosmic-scale disaster"],
    worksBestWith: ["environmental_chaos", "ritual_disruption", "physical_betrayal"],
    hookShapes: ["one X ruined the Y", "the morning started X me"],
    executions: [
      { id: "cosmic_overreaction", pattern: "small event ruined atmosphere", example: "one email ruined the atmosphere" },
      { id: "relationship_framing", pattern: "morning as antagonist", example: "the morning started attacking my plans" },
      { id: "physical_stakes", pattern: "small trigger full collapse", example: "a single ping unraveled my whole posture" },
      { id: "gen_z_collapse", pattern: "collapse vocabulary", example: "the day filed for divorce by 9am" },
    ],
    parentBucket: "absurd_metaphor",
  },
  delusion_spiral: {
    label: "Delusion Death Spiral",
    purpose: "False belief gets worse.",
    transformLogic: ["claim early calm", "expose deepening denial"],
    worksBestWith: ["emotional_loop", "memory_glitch", "decision_paralysis"],
    hookShapes: ["i thought i was X. adorable.", "the denial had layers"],
    executions: [
      { id: "self_drag", pattern: "thought i was fine wasn't", example: "i thought i was fine. adorable." },
      { id: "delusion_admission", pattern: "denial layered up", example: "the denial had layers" },
      { id: "pattern_naming", pattern: "name the denial loop", example: "i kept telling myself a smaller version of events" },
      { id: "understatement", pattern: "minimize ongoing collapse", example: "the situation is mostly under control allegedly" },
    ],
    parentBucket: "over_dramatization",
  },
  cringe_trigger: {
    label: "Trauma Trigger Turbo",
    purpose: "Memory cringe hits hard.",
    transformLogic: ["name the involuntary memory replay", "amplify intensity"],
    worksBestWith: ["memory_glitch", "social_friction", "emotional_loop"],
    hookShapes: ["my brain replayed it in X", "i was doing fine until i remembered"],
    executions: [
      { id: "physical_stakes", pattern: "memory replays in HD", example: "my brain replayed it in 4k" },
      { id: "expectation_collapse", pattern: "fine until memory hit", example: "i was doing fine until i remembered" },
      { id: "self_drag", pattern: "intrusive memory takes over", example: "an old memory walked in uninvited" },
      { id: "time_marker", pattern: "specific cringe moment surfaces", example: "remembered something embarrassing from 2014" },
    ],
    parentBucket: "absurd_metaphor",
  },
  confidence_crash: {
    label: "Confidence Crash Catalyst",
    purpose: "Confidence disappears on contact.",
    transformLogic: ["have confidence at start", "watch it vanish at the moment"],
    worksBestWith: ["social_friction", "decision_paralysis", "anti_climax"],
    hookShapes: ["i had confidence for X seconds", "the moment arrived. i Y."],
    executions: [
      { id: "time_marker", pattern: "confidence had a stopwatch", example: "i had confidence for six seconds" },
      { id: "expectation_collapse", pattern: "vanish at the moment", example: "the moment arrived. i vanished." },
      { id: "physical_stakes", pattern: "body abandons performance", example: "my body opted out the second it mattered" },
      { id: "self_drag", pattern: "outside view of vanish", example: "started bold. ended invisible." },
    ],
    parentBucket: "over_dramatization",
  },
  anxiety_avalanche: {
    label: "Anxiety Avalanche Architect",
    purpose: "One worry becomes many.",
    transformLogic: ["start with one thought", "show it cascading"],
    worksBestWith: ["emotional_loop", "decision_paralysis", "memory_glitch"],
    hookShapes: ["one X opened the floodgates", "my brain found a Y quest"],
    executions: [
      { id: "whiplash_pivot", pattern: "one thought full cascade", example: "one thought opened the floodgates" },
      { id: "relationship_framing", pattern: "brain as quest-giver", example: "my brain found a side quest" },
      { id: "cosmic_overreaction", pattern: "tiny thought full panic", example: "a small worry recruited fifteen friends" },
      { id: "pattern_naming", pattern: "name the cascade ritual", example: "the spiral has a real strong work ethic" },
    ],
    parentBucket: "over_dramatization",
  },
  procrastination_paradox: {
    label: "Procrastination Paradox Punch",
    purpose: "Avoiding work creates more work.",
    transformLogic: ["delay the task", "show snowball effect"],
    worksBestWith: ["decision_paralysis", "ritual_disruption", "time_distortion"],
    hookShapes: ["i delayed it until it became a X", "future me is Y"],
    executions: [
      { id: "identity_framing", pattern: "delay becomes lifestyle", example: "i delayed it until it became a lifestyle" },
      { id: "self_drag", pattern: "future me litigates", example: "future me is suing" },
      { id: "delusion_admission", pattern: "honest about avoidance escalation", example: "the small task is now a federal case" },
      { id: "time_marker", pattern: "tiny delay grows huge", example: "five minutes turned into next week somehow" },
    ],
    parentBucket: "self_roast",
  },
  burnout_betrayal: {
    label: "Burnout Betrayal Blast",
    purpose: "Rest no longer restores.",
    transformLogic: ["attempt rest", "find it failed to restore"],
    worksBestWith: ["physical_betrayal", "emotional_loop", "anti_climax"],
    hookShapes: ["i rested and still X", "sleep did not fix the Y"],
    executions: [
      { id: "expectation_collapse", pattern: "rest didn't restore", example: "i rested and still lost" },
      { id: "self_drag", pattern: "sleep didn't fix the plot", example: "sleep did not fix the plot" },
      { id: "physical_stakes", pattern: "body refuses to recover", example: "my body forgot how rest is supposed to work" },
      { id: "understatement", pattern: "rest underperformed", example: "the weekend did not deliver as promised" },
    ],
    parentBucket: "over_dramatization",
  },
  social_battery_sabotage: {
    label: "Social Battery Sabotage",
    purpose: "Social energy collapses.",
    transformLogic: ["want plans abstractly", "panic when they materialize"],
    worksBestWith: ["social_friction", "decision_paralysis", "emotional_loop"],
    hookShapes: ["i wanted X until they became real", "my social battery saw Y and died"],
    executions: [
      { id: "expectation_collapse", pattern: "wanted plans abstractly", example: "i wanted plans until they became real" },
      { id: "physical_stakes", pattern: "battery dies on sight", example: "my social battery saw people and died" },
      { id: "delusion_admission", pattern: "lied to self about wanting plans", example: "i agreed to things future me deeply resents" },
      { id: "self_drag", pattern: "battery percentage view", example: "showed up at three percent and a smile" },
    ],
    parentBucket: "over_dramatization",
  },
  manifestation_mockery: {
    label: "Manifestation Mockery Missile",
    purpose: "Self-help trend goes wrong.",
    transformLogic: ["invoke manifestation framing", "produce ironic result"],
    worksBestWith: ["failure_contradiction", "decision_paralysis", "anti_climax"],
    hookShapes: ["i manifested X", "the universe misunderstood the Y"],
    executions: [
      { id: "ironic_confidence", pattern: "manifested wrong outcome", example: "i manifested pressure" },
      { id: "self_drag", pattern: "universe misread the assignment", example: "the universe misunderstood the assignment" },
      { id: "delusion_admission", pattern: "honest about wrong wish", example: "asked for abundance. got obligations" },
      { id: "expectation_collapse", pattern: "vibes didn't deliver", example: "the vibes were strong. the results were not" },
    ],
    parentBucket: "self_roast",
  },
  group_chat_guilt: {
    label: "Group Chat Guilt Grenade",
    purpose: "Group chat pressure.",
    transformLogic: ["enter group chat", "feel social-debt anxiety"],
    worksBestWith: ["social_friction", "information_asymmetry", "emotional_loop"],
    hookShapes: ["the group chat replaced me already", "i opened it. immediately regretted it"],
    executions: [
      { id: "self_drag", pattern: "replaced already by group", example: "the group chat replaced me already" },
      { id: "physical_stakes", pattern: "regret on opening", example: "i opened it. immediately regretted it" },
      { id: "delusion_admission", pattern: "social-debt anxiety named", example: "i owe seventeen replies and one apology" },
      { id: "time_marker", pattern: "old unread piles up", example: "there are messages from october still waiting" },
    ],
    parentBucket: "self_roast",
  },
  main_character_meltdown: {
    label: "Main Character Meltdown",
    purpose: "Hero fantasy collapses.",
    transformLogic: ["claim main-character framing", "watch it dissolve"],
    worksBestWith: ["identity_drift", "anti_climax", "social_friction"],
    hookShapes: ["main character energy left X", "i started strong. became Y."],
    executions: [
      { id: "expectation_collapse", pattern: "lead role energy left", example: "lead role energy left early" },
      { id: "self_drag", pattern: "started lead became side", example: "i started strong. became comic relief." },
      { id: "identity_framing", pattern: "demoted from main to extra", example: "demoted myself to background of my own life" },
      { id: "understatement", pattern: "main character status revoked", example: "the lead-role thing did not stick" },
    ],
    parentBucket: "identity_framing",
  },
  comic_relief_cataclysm: {
    label: "Comic Relief Cataclysm",
    purpose: "Creator becomes the joke.",
    transformLogic: ["set up serious framing", "land as the funny part"],
    worksBestWith: ["identity_drift", "social_friction", "anti_climax"],
    hookShapes: ["i was not the lead. i was the X.", "somehow i became the Y part"],
    executions: [
      { id: "self_drag", pattern: "i was the lesson not the lead", example: "i was not the lead. i was the lesson." },
      { id: "identity_framing", pattern: "became the funny part", example: "somehow i became the funny part" },
      { id: "delusion_admission", pattern: "punchline status accepted", example: "showed up serious. landed as the joke" },
      { id: "understatement", pattern: "downgrade from hero to gag", example: "the role evolved into something sillier" },
    ],
    parentBucket: "identity_framing",
  },
  three_am_spiral: {
    label: "3AM Spiral Sniper",
    purpose: "Late-night brain chaos.",
    transformLogic: ["name late-night self", "frame as ungovernable"],
    worksBestWith: ["time_distortion", "decision_paralysis", "memory_glitch"],
    hookShapes: ["3am me needs supervision", "my brain gets creative after X"],
    executions: [
      { id: "time_marker", pattern: "3am self needs supervision", example: "3am me needs supervision" },
      { id: "identity_framing", pattern: "late-night brain as separate entity", example: "my brain gets creative after midnight" },
      { id: "cosmic_overreaction", pattern: "midnight thoughts as crisis", example: "every thought after 1am sounds like an emergency" },
      { id: "self_drag", pattern: "outside view of late-night self", example: "no one should trust me at 2am" },
    ],
    parentBucket: "identity_framing",
  },
  todo_termination: {
    label: "To-Do List Termination",
    purpose: "Task list relationship drama.",
    transformLogic: ["personify the to-do list", "name the relationship as broken"],
    worksBestWith: ["ritual_disruption", "decision_paralysis", "emotional_loop"],
    hookShapes: ["i ghosted my own X", "the X and i are not speaking"],
    executions: [
      { id: "relationship_framing", pattern: "list as estranged partner", example: "the list and i are not speaking" },
      { id: "self_drag", pattern: "ghosting the list", example: "i ghosted my own to-do list again" },
      { id: "delusion_admission", pattern: "honest about list avoidance", example: "the list moved out and took the calendar" },
      { id: "physical_stakes", pattern: "body refuses the list", example: "my body refuses to look at it" },
    ],
    parentBucket: "self_roast",
  },
  boundary_backfire: {
    label: "Boundary Backfire Bomb",
    purpose: "Boundary attempt becomes chaos.",
    transformLogic: ["claim a boundary", "show panic at the boundary"],
    worksBestWith: ["social_friction", "decision_paralysis", "emotional_loop"],
    hookShapes: ["i set a boundary and X", "peace somehow made me Y"],
    executions: [
      { id: "expectation_collapse", pattern: "boundary triggers panic", example: "i set a boundary and panicked" },
      { id: "self_drag", pattern: "peace causes anxiety", example: "peace somehow made me anxious" },
      { id: "delusion_admission", pattern: "honest about boundary failure", example: "saying no felt like an emergency" },
      { id: "ironic_confidence", pattern: "set rule immediately broke it", example: "set a limit. negotiated with myself" },
    ],
    parentBucket: "self_roast",
  },
  plant_parent_psychosis: {
    label: "Plant Parent Psychosis",
    purpose: "Treat plant care as emotional drama.",
    transformLogic: ["personify the plant", "frame care as emotional negotiation"],
    worksBestWith: ["ritual_disruption", "identity_drift", "physical_betrayal"],
    hookShapes: ["my plant knows i'm X", "i negotiated with a Y leaf"],
    executions: [
      { id: "identity_framing", pattern: "plant knows me as unreliable", example: "my plant knows i'm unreliable" },
      { id: "relationship_framing", pattern: "negotiate with dying plant", example: "i negotiated with a dying leaf" },
      { id: "delusion_admission", pattern: "honest about plant neglect", example: "i apologized to a plant out loud" },
      { id: "cosmic_overreaction", pattern: "plant care as emotional war", example: "the plant and i are in a real fight" },
    ],
    parentBucket: "absurd_metaphor",
  },
  cart_autopsy: {
    label: "Amazon Cart Autopsy",
    purpose: "Shopping cart exposes identity.",
    transformLogic: ["personify the cart as witness", "let it indict the creator"],
    worksBestWith: ["identity_drift", "ritual_disruption", "decision_paralysis"],
    hookShapes: ["my cart knows too X", "this cart is a cry for Y"],
    executions: [
      { id: "self_drag", pattern: "cart as evidence", example: "my cart knows too much" },
      { id: "identity_framing", pattern: "cart as personal indictment", example: "this cart is a cry for help" },
      { id: "delusion_admission", pattern: "honest about cart contents", example: "the cart told on me before i did" },
      { id: "understatement", pattern: "cart contains questionable choices", example: "every item in here is a poor decision" },
    ],
    parentBucket: "self_roast",
  },
  fridge_judgment: {
    label: "Fridge Judgment Frenzy",
    purpose: "Fridge as witness/judge.",
    transformLogic: ["personify the fridge", "let it indict the creator"],
    worksBestWith: ["ritual_disruption", "identity_drift", "physical_betrayal"],
    hookShapes: ["the fridge knows i'm X", "the fridge saw Y"],
    executions: [
      { id: "identity_framing", pattern: "fridge as silent judge", example: "the fridge knows i'm lying" },
      { id: "self_drag", pattern: "fridge witnessed everything", example: "the fridge saw everything" },
      { id: "relationship_framing", pattern: "fridge as silent partner", example: "me and the fridge made eye contact" },
      { id: "delusion_admission", pattern: "honest about fridge habits", example: "i visit the fridge for emotional reasons" },
    ],
    parentBucket: "absurd_metaphor",
  },
  dream_disappointment: {
    label: "Dream Disappointment Drill",
    purpose: "Ambition gets quietly betrayed.",
    transformLogic: ["name a dream/goal", "show it being quietly disappointed"],
    worksBestWith: ["identity_drift", "anti_climax", "emotional_loop"],
    hookShapes: ["i gently disappoint my X weekly", "my dreams lowered their Y"],
    executions: [
      { id: "pattern_naming", pattern: "weekly disappointment ritual", example: "i gently disappoint my goals weekly" },
      { id: "self_drag", pattern: "dreams compromised down", example: "my dreams lowered their expectations" },
      { id: "understatement", pattern: "ambition recalibrated downward", example: "the goals and i are taking a break" },
      { id: "delusion_admission", pattern: "ambition softened to nothing", example: "downgraded the dream to a hobby" },
    ],
    parentBucket: "self_roast",
  },
  weekly_wipeout: {
    label: "Weekly Warrior Wipeout",
    purpose: "Week starts strong, collapses.",
    transformLogic: ["name day X with potential", "show day Y collapsing"],
    worksBestWith: ["time_distortion", "anti_climax", "ritual_disruption"],
    hookShapes: ["X had potential. then i happened.", "the week lost me by Y"],
    executions: [
      { id: "time_marker", pattern: "monday strong then nope", example: "monday had potential. then i happened." },
      { id: "self_drag", pattern: "lost the week early", example: "the week lost me by tuesday" },
      { id: "expectation_collapse", pattern: "week plan dies fast", example: "the week peaked sunday night" },
      { id: "understatement", pattern: "week did not recover", example: "the schedule did not survive monday" },
    ],
    parentBucket: "self_roast",
  },
};

/**
 * Phase 6 EXPANSION — derived label map for `meta.premiseStyleLabel`
 * output (spec OUTPUT METADATA: `premiseStyleId` + `premiseStyleLabel`).
 * Computed once at module load from `PREMISE_STYLE_DEFS` so the type
 * system enforces label coverage for every id at compile time.
 */
export const PREMISE_STYLE_LABELS: Record<PremiseStyleId, string> =
  Object.fromEntries(
    (Object.entries(PREMISE_STYLE_DEFS) as ReadonlyArray<
      [PremiseStyleId, PremiseStyleDef]
    >).map(([id, def]) => [id, def.label]),
  ) as Record<PremiseStyleId, string>;

/**
 * Phase 6B — PremiseStyleId → compatible VideoPattern[] alignment map.
 *
 * Routing layer that lets the FILMING PATTERN match the JOKE, not just
 * the family/intent. Each of the 50 fine-grained premise styles maps
 * to 2-4 patterns whose `beats` / `cameraStyle` naturally amplify the
 * style's transformLogic (see `PREMISE_STYLE_DEFS[id].purpose`).
 *
 * USAGE: `pickVideoPattern` intersects this list with
 *   `PATTERN_BY_FAMILY[family]` ∩ `PATTERN_X_INTENT_COMPAT[intent]`.
 * If the intersection is non-empty → rank within it (existing inverse-
 * recency + seed-fold logic). If empty (or `premiseStyleId` undefined)
 * → fallback to the unchanged family/intent path.
 *
 * DIVERSITY AUDIT (verified by QA driver in T005):
 *   - every one of the 12 patterns appears in ≥1 style's compat list
 *     (loop_behavior is the floor at 5 occurrences = 10%)
 *   - no pattern dominates >40% of style mappings
 *     (deadpan_statement = 19/50 = 38% is the ceiling)
 *
 * NON-PREMISE candidates (legacy / Llama / Claude / fallbacks) do not
 * carry a `premiseStyleId` and therefore route through the unchanged
 * family/intent path — Phase 6F legacy scoring is untouched.
 */
export const PREMISESTYLE_TO_PATTERN_MAP: Record<
  PremiseStyleId,
  readonly VideoPattern[]
> = {
  // self_roast — creator named as the failure point; flat verbal naming + held face
  self_roast_reactor: ["deadpan_statement", "silent_reaction", "micro_story"],
  relatable_pain: ["micro_story", "silent_reaction", "deadpan_statement"],
  fake_confidence: ["confidence_collapse", "before_after", "cut_before_end"],
  lazy_genius: ["deadpan_statement", "micro_story", "silent_reaction"],
  doomscroll_disclosure: ["loop_behavior", "micro_story", "pov_internal"],
  hypocrisy_hyperdrive: ["before_after", "deadpan_statement", "micro_story"],
  fomo_fracture: ["before_after", "pov_internal", "confidence_collapse"],
  self_destruction_speedrun: ["cut_before_end", "escalation", "silent_reaction"],
  self_sabotage_scrollstop: ["micro_story", "silent_reaction", "deadpan_statement"],
  procrastination_paradox: ["loop_behavior", "escalation", "micro_story"],
  group_chat_guilt: ["object_pov", "micro_story", "silent_reaction"],
  todo_termination: ["object_pov", "deadpan_statement", "micro_story"],
  boundary_backfire: ["confidence_collapse", "escalation", "pov_internal"],
  cart_autopsy: ["object_pov", "deadpan_statement", "montage_repeat"],
  dream_disappointment: ["before_after", "deadpan_statement", "cut_before_end"],
  weekly_wipeout: ["before_after", "montage_repeat", "confidence_collapse"],
  manifestation_mockery: ["before_after", "confidence_collapse", "cut_before_end"],

  // absurd_metaphor — tiny → cosmic; chaos / object personification / surreal
  absurd_escalation: ["escalation", "cut_before_end", "montage_repeat"],
  collapse_core: ["cut_before_end", "silent_reaction", "deadpan_statement"],
  mundane_meltdown: ["escalation", "montage_repeat", "silent_reaction"],
  inner_demon: ["pov_internal", "deadpan_statement", "escalation"],
  metaphor_mayhem: ["object_pov", "deadpan_statement", "pov_internal"],
  rage_resonance: ["escalation", "silent_reaction", "cut_before_end"],
  everyday_armageddon: ["escalation", "object_pov", "montage_repeat"],
  cringe_trigger: ["delayed_reaction", "silent_reaction", "pov_internal"],
  plant_parent_psychosis: ["object_pov", "deadpan_statement", "micro_story"],
  fridge_judgment: ["object_pov", "silent_reaction", "deadpan_statement"],

  // contrast_duality — two-state collisions; matched-framing cuts
  duality_clash: ["before_after", "montage_repeat", "confidence_collapse"],
  expectation_collapse: ["confidence_collapse", "before_after", "cut_before_end"],
  irony_flip: ["before_after", "deadpan_statement", "delayed_reaction"],
  irony_implosion: ["before_after", "escalation", "cut_before_end"],
  whiplash_wisdom: ["delayed_reaction", "before_after", "confidence_collapse"],
  contrast_catastrophe: ["before_after", "confidence_collapse", "cut_before_end"],

  // over_dramatization — escalating buildup → collapse / abrupt KO
  overdramatic_reframe: ["escalation", "silent_reaction", "cut_before_end"],
  dopamine_denial: ["confidence_collapse", "escalation", "micro_story"],
  delusion_downfall: ["confidence_collapse", "before_after", "delayed_reaction"],
  micro_trauma: ["delayed_reaction", "silent_reaction", "before_after"],
  anxiety_paradox: ["pov_internal", "loop_behavior", "silent_reaction"],
  adulting_betrayal: ["escalation", "cut_before_end", "montage_repeat"],
  pain_point_precision: ["deadpan_statement", "silent_reaction", "micro_story"],
  delusion_spiral: ["confidence_collapse", "escalation", "pov_internal"],
  confidence_crash: ["confidence_collapse", "before_after", "cut_before_end"],
  anxiety_avalanche: ["escalation", "montage_repeat", "pov_internal"],
  burnout_betrayal: ["before_after", "silent_reaction", "deadpan_statement"],
  social_battery_sabotage: ["confidence_collapse", "before_after", "pov_internal"],

  // identity_framing — labelling self / role; before/after + interior + naming
  pattern_exposure: ["loop_behavior", "montage_repeat", "pov_internal"],
  chaos_confession: ["deadpan_statement", "pov_internal", "micro_story"],
  main_character_meltdown: ["confidence_collapse", "before_after", "delayed_reaction"],
  comic_relief_cataclysm: ["micro_story", "deadpan_statement", "delayed_reaction"],
  three_am_spiral: ["pov_internal", "loop_behavior", "deadpan_statement"],
};

/**
 * Phase 7 — PremiseStyleId × VideoPattern SYNERGY MAP.
 *
 * Curated subset of `PREMISESTYLE_TO_PATTERN_MAP` calling out the
 * style→pattern combos the spec PART 5 explicitly names as "obvious
 * mismatches" if NOT paired this way. When a candidate's chosen
 * `videoPattern` matches an entry here for its `premiseStyleId`, the
 * `formatFit` dim of `scoreViralFeel` is boosted to 1 (the dim's
 * ceiling). Absent / mismatched combos get formatFit=0 — they're
 * still valid (the routing layer in `pickVideoPattern` already
 * picked a family∩intent compatible pattern), they just don't earn
 * the synergy bonus.
 *
 * Pure additive — never used as a hard filter. The numeric value is
 * the synergy bonus magnitude; today only +1 is used (collapses into
 * the formatFit dim's 0/1 ladder), but the field is `number` so a
 * future tune can introduce graded synergy without a type change.
 */
export const PREMISE_PATTERN_SYNERGY_MAP: Record<
  PremiseStyleId,
  Partial<Record<VideoPattern, number>>
> = {
  // self_roast — hook is the punchline; flat verbal naming + held face
  self_roast_reactor: { silent_reaction: 1, deadpan_statement: 1 },
  relatable_pain: { silent_reaction: 1, micro_story: 1 },
  fake_confidence: { confidence_collapse: 1, before_after: 1 },
  lazy_genius: { deadpan_statement: 1, silent_reaction: 1 },
  doomscroll_disclosure: { loop_behavior: 1 },
  hypocrisy_hyperdrive: { before_after: 1 },
  fomo_fracture: { before_after: 1 },
  self_destruction_speedrun: { escalation: 1, cut_before_end: 1 },
  self_sabotage_scrollstop: { silent_reaction: 1, micro_story: 1 },
  procrastination_paradox: { loop_behavior: 1 },
  group_chat_guilt: { object_pov: 1, pov_internal: 1 },
  todo_termination: { object_pov: 1, deadpan_statement: 1 },
  boundary_backfire: { confidence_collapse: 1 },
  cart_autopsy: { object_pov: 1 },
  dream_disappointment: { before_after: 1, cut_before_end: 1 },
  weekly_wipeout: { before_after: 1, montage_repeat: 1 },
  manifestation_mockery: { confidence_collapse: 1, before_after: 1 },

  // absurd_metaphor — escalation / object personification / surreal
  absurd_escalation: { escalation: 1, montage_repeat: 1 },
  collapse_core: { cut_before_end: 1, silent_reaction: 1 },
  mundane_meltdown: { escalation: 1 },
  inner_demon: { pov_internal: 1 },
  metaphor_mayhem: { object_pov: 1, pov_internal: 1 },
  rage_resonance: { escalation: 1, cut_before_end: 1 },
  everyday_armageddon: { escalation: 1, montage_repeat: 1 },
  cringe_trigger: { delayed_reaction: 1, silent_reaction: 1 },
  plant_parent_psychosis: { object_pov: 1 },
  fridge_judgment: { object_pov: 1 },

  // contrast_duality — two-state collisions; matched-framing cuts
  duality_clash: { before_after: 1, montage_repeat: 1 },
  expectation_collapse: { before_after: 1, confidence_collapse: 1 },
  irony_flip: { before_after: 1, delayed_reaction: 1 },
  irony_implosion: { before_after: 1, escalation: 1 },
  whiplash_wisdom: { delayed_reaction: 1, before_after: 1 },
  contrast_catastrophe: { before_after: 1, confidence_collapse: 1 },

  // over_dramatization — escalating buildup → collapse / abrupt KO
  overdramatic_reframe: { escalation: 1, cut_before_end: 1 },
  dopamine_denial: { confidence_collapse: 1, escalation: 1 },
  delusion_downfall: { confidence_collapse: 1, delayed_reaction: 1 },
  micro_trauma: { delayed_reaction: 1, silent_reaction: 1 },
  anxiety_paradox: { pov_internal: 1, loop_behavior: 1 },
  adulting_betrayal: { escalation: 1, cut_before_end: 1 },
  pain_point_precision: { deadpan_statement: 1, silent_reaction: 1 },
  delusion_spiral: { confidence_collapse: 1, escalation: 1 },
  confidence_crash: { confidence_collapse: 1, before_after: 1 },
  anxiety_avalanche: { escalation: 1, pov_internal: 1 },
  burnout_betrayal: { before_after: 1, silent_reaction: 1 },
  social_battery_sabotage: { confidence_collapse: 1, pov_internal: 1 },

  // identity_framing — labelling self / role
  pattern_exposure: { loop_behavior: 1, montage_repeat: 1 },
  chaos_confession: { deadpan_statement: 1, pov_internal: 1 },
  main_character_meltdown: { confidence_collapse: 1, before_after: 1 },
  comic_relief_cataclysm: { delayed_reaction: 1, micro_story: 1 },
  three_am_spiral: { pov_internal: 1, loop_behavior: 1 },
};

/**
 * Phase 7 PART 1 — PremiseStyleId → preferred HookIntent[] alignment.
 *
 * Soft preference layer, NOT a hard filter. When a candidate's
 * `meta.hookIntent` is in this style's preferred set, `selectionPenalty`
 * adds a small +1 bonus (parallel to the language-style preference
 * map below). Empty array means no preference (the bonus never
 * fires for that style). All 50 ids are covered so the lookup is
 * total — readers can rely on `PREMISESTYLE_TO_HOOKINTENT_PREFERENCE[id]`
 * never being undefined.
 *
 * Curated per spec PART 1.1: self-roast / confession styles favor
 * `relatable` + `scroll_stop` (admission shapes); absurd_escalation
 * favors `compulsion` (open-loop dramatic buildup); duality / contrast
 * favors `scroll_stop` + `compulsion` (the flip is the payoff).
 */
export const PREMISESTYLE_TO_HOOKINTENT_PREFERENCE: Record<
  PremiseStyleId,
  readonly HookIntent[]
> = {
  // self_roast — confession / admission shapes
  self_roast_reactor: ["relatable", "scroll_stop"],
  relatable_pain: ["relatable"],
  fake_confidence: ["scroll_stop", "relatable"],
  lazy_genius: ["relatable", "scroll_stop"],
  doomscroll_disclosure: ["relatable", "scroll_stop"],
  hypocrisy_hyperdrive: ["relatable", "scroll_stop"],
  fomo_fracture: ["relatable", "compulsion"],
  self_destruction_speedrun: ["compulsion", "scroll_stop"],
  self_sabotage_scrollstop: ["scroll_stop", "relatable"],
  procrastination_paradox: ["relatable", "compulsion"],
  group_chat_guilt: ["relatable"],
  todo_termination: ["relatable", "scroll_stop"],
  boundary_backfire: ["relatable", "compulsion"],
  cart_autopsy: ["scroll_stop", "relatable"],
  dream_disappointment: ["relatable", "compulsion"],
  weekly_wipeout: ["relatable", "compulsion"],
  manifestation_mockery: ["scroll_stop", "relatable"],

  // absurd_metaphor — compulsion / scroll_stop dominate (open-loop drama)
  absurd_escalation: ["compulsion", "scroll_stop"],
  collapse_core: ["scroll_stop", "compulsion"],
  mundane_meltdown: ["compulsion", "scroll_stop"],
  inner_demon: ["compulsion", "relatable"],
  metaphor_mayhem: ["scroll_stop", "compulsion"],
  rage_resonance: ["compulsion", "scroll_stop"],
  everyday_armageddon: ["compulsion", "scroll_stop"],
  cringe_trigger: ["scroll_stop", "relatable"],
  plant_parent_psychosis: ["scroll_stop", "compulsion"],
  fridge_judgment: ["scroll_stop", "compulsion"],

  // contrast_duality — scroll_stop / compulsion (the flip is the payoff)
  duality_clash: ["scroll_stop", "compulsion"],
  expectation_collapse: ["scroll_stop", "compulsion"],
  irony_flip: ["scroll_stop", "compulsion"],
  irony_implosion: ["scroll_stop", "compulsion"],
  whiplash_wisdom: ["compulsion", "scroll_stop"],
  contrast_catastrophe: ["scroll_stop", "compulsion"],

  // over_dramatization — compulsion / scroll_stop (escalation pays off)
  overdramatic_reframe: ["compulsion", "scroll_stop"],
  dopamine_denial: ["compulsion", "relatable"],
  delusion_downfall: ["compulsion", "scroll_stop"],
  micro_trauma: ["relatable", "scroll_stop"],
  anxiety_paradox: ["relatable", "compulsion"],
  adulting_betrayal: ["compulsion", "relatable"],
  pain_point_precision: ["relatable", "scroll_stop"],
  delusion_spiral: ["compulsion", "scroll_stop"],
  confidence_crash: ["compulsion", "scroll_stop"],
  anxiety_avalanche: ["compulsion", "relatable"],
  burnout_betrayal: ["relatable", "compulsion"],
  social_battery_sabotage: ["relatable", "compulsion"],

  // identity_framing — relatable / scroll_stop (naming a role)
  pattern_exposure: ["relatable", "scroll_stop"],
  chaos_confession: ["relatable", "scroll_stop"],
  main_character_meltdown: ["scroll_stop", "compulsion"],
  comic_relief_cataclysm: ["relatable", "scroll_stop"],
  three_am_spiral: ["relatable", "compulsion"],
};

/**
 * Phase 7 PART 1 — PremiseStyleId → preferred HookLanguageStyle[]
 * alignment. Soft preference, parallel to the intent map above.
 *
 * Curated per spec PART 1.2: deadpan / self-roast → matter_of_fact /
 * confession / micro_story (blunt admission); absurd → absurd_claim /
 * object_pov / observation; duality → comparison / time_stamp (two-
 * state framing); confession → confession / observation (direct,
 * self-aware). Empty array = no preference (bonus never fires for
 * that style). All 50 ids covered so the lookup is total.
 */
export const PREMISESTYLE_TO_HOOKLANGUAGE_PREFERENCE: Record<
  PremiseStyleId,
  readonly HookLanguageStyle[]
> = {
  // self_roast — blunt / direct / micro_story
  self_roast_reactor: ["confession", "matter_of_fact", "micro_story"],
  relatable_pain: ["confession", "observation", "micro_story"],
  fake_confidence: ["matter_of_fact", "confession", "comparison"],
  lazy_genius: ["matter_of_fact", "confession", "observation"],
  doomscroll_disclosure: ["confession", "micro_story", "time_stamp"],
  hypocrisy_hyperdrive: ["comparison", "matter_of_fact", "observation"],
  fomo_fracture: ["comparison", "confession", "observation"],
  self_destruction_speedrun: ["escalation_hook", "micro_story", "matter_of_fact"],
  self_sabotage_scrollstop: ["confession", "matter_of_fact", "anti_hook"],
  procrastination_paradox: ["confession", "observation", "time_stamp"],
  group_chat_guilt: ["confession", "object_pov", "observation"],
  todo_termination: ["object_pov", "matter_of_fact", "confession"],
  boundary_backfire: ["confession", "comparison", "matter_of_fact"],
  cart_autopsy: ["object_pov", "observation", "matter_of_fact"],
  dream_disappointment: ["comparison", "matter_of_fact", "observation"],
  weekly_wipeout: ["comparison", "time_stamp", "observation"],
  manifestation_mockery: ["comparison", "matter_of_fact", "observation"],

  // absurd_metaphor — absurd_claim / object_pov / observation
  absurd_escalation: ["absurd_claim", "escalation_hook", "observation"],
  collapse_core: ["absurd_claim", "anti_hook", "matter_of_fact"],
  mundane_meltdown: ["absurd_claim", "escalation_hook", "observation"],
  inner_demon: ["absurd_claim", "confession", "observation"],
  metaphor_mayhem: ["object_pov", "absurd_claim", "observation"],
  rage_resonance: ["absurd_claim", "escalation_hook", "anti_hook"],
  everyday_armageddon: ["absurd_claim", "escalation_hook", "observation"],
  cringe_trigger: ["absurd_claim", "anti_hook", "observation"],
  plant_parent_psychosis: ["object_pov", "absurd_claim", "observation"],
  fridge_judgment: ["object_pov", "absurd_claim", "matter_of_fact"],

  // contrast_duality — comparison / time_stamp / before_after framing
  duality_clash: ["comparison", "time_stamp", "observation"],
  expectation_collapse: ["comparison", "matter_of_fact", "anti_hook"],
  irony_flip: ["comparison", "matter_of_fact", "observation"],
  irony_implosion: ["comparison", "escalation_hook", "observation"],
  whiplash_wisdom: ["comparison", "matter_of_fact", "observation"],
  contrast_catastrophe: ["comparison", "matter_of_fact", "anti_hook"],

  // over_dramatization — escalation / absurd_claim / anti_hook
  overdramatic_reframe: ["absurd_claim", "escalation_hook", "anti_hook"],
  dopamine_denial: ["matter_of_fact", "comparison", "anti_hook"],
  delusion_downfall: ["absurd_claim", "matter_of_fact", "anti_hook"],
  micro_trauma: ["confession", "observation", "anti_hook"],
  anxiety_paradox: ["confession", "observation", "matter_of_fact"],
  adulting_betrayal: ["matter_of_fact", "absurd_claim", "comparison"],
  pain_point_precision: ["matter_of_fact", "confession", "observation"],
  delusion_spiral: ["confession", "absurd_claim", "matter_of_fact"],
  confidence_crash: ["matter_of_fact", "comparison", "anti_hook"],
  anxiety_avalanche: ["escalation_hook", "confession", "observation"],
  burnout_betrayal: ["comparison", "confession", "matter_of_fact"],
  social_battery_sabotage: ["confession", "comparison", "matter_of_fact"],

  // identity_framing — confession / matter_of_fact / time_stamp
  pattern_exposure: ["matter_of_fact", "observation", "time_stamp"],
  chaos_confession: ["confession", "matter_of_fact", "observation"],
  main_character_meltdown: ["matter_of_fact", "absurd_claim", "comparison"],
  comic_relief_cataclysm: ["confession", "observation", "matter_of_fact"],
  three_am_spiral: ["time_stamp", "confession", "observation"],
};

/**
 * Phase 6 EXPANSION — resolve the parent BigPremiseStyle bucket for a
 * fine-grained PremiseStyleId. Used by callers that want to apply
 * bucket-level filters / penalties from a known fine-grained id
 * (e.g. cache parsing fallbacks). Pure lookup — no allocation.
 */
export function getPremiseStyleParent(id: PremiseStyleId): BigPremiseStyle {
  return PREMISE_STYLE_DEFS[id].parentBucket;
}

/**
 * Phase 6 EXPANSION — type-safe parser for cache-round-trip values.
 * Returns the typed id when `value` is a known PremiseStyleId, else
 * undefined. Used by `tryParseEntries` to tolerate stale cache rows
 * written before this field existed (or from a future build with
 * extra ids the current build doesn't know).
 */
export function parsePremiseStyleId(
  value: unknown,
): PremiseStyleId | undefined {
  return typeof value === "string" && PREMISE_STYLE_ID_SET.has(value)
    ? (value as PremiseStyleId)
    : undefined;
}

/**
 * Phase 6 EXPANSION — generate `LanguagePhrasingEntry` premise entries
 * from the 50-style catalog. Each example string in
 * `PREMISE_STYLE_DEFS[id].examples` becomes one entry tagged with:
 *   - `bigPremise: true` + `premiseStyle: parentBucket`
 *     (so all existing 5-bucket infrastructure activates)
 *   - `premiseStyleId: id`
 *     (fine-grained novelty axis on top of the bucket)
 *   - `rigidityScore: 1` + `sharpnessScore: 5` (premium scores)
 *   - hand-resolved `hookIntent` + `voiceProfiles` per the requested
 *     downstream slot (caller picks tags appropriate to the
 *     hookLanguageStyle bucket the entries are spread into).
 *
 * Pure function — returns a fresh array each call so callers can
 * spread it into different hookLanguageStyle buckets without
 * accidental aliasing.
 */
function buildPremiseEntriesFromDefs(
  ids: readonly PremiseStyleId[],
  hookIntent: HookIntent,
  voiceProfiles: readonly VoiceProfile[],
): LanguagePhrasingEntry[] {
  const out: LanguagePhrasingEntry[] = [];
  for (const id of ids) {
    const def = PREMISE_STYLE_DEFS[id];
    // Phase 6D (PREMISE EXECUTION EXPANSION) — iterate `executions`
    // (3-5 per style) instead of the old single `examples` list, so
    // each style ships multiple distinct comedic angles into the
    // candidate pool. Tag each entry with `executionId: exec.id` so
    // the within-batch HARD `(premiseStyleId, executionId)` dedup +
    // cross-batch -2 demote / +2 fresh-boost levers fire on the
    // fine-grained execution axis on top of the bucket / style axes.
    for (const exec of def.executions) {
      out.push({
        build: () => exec.example,
        voiceProfiles,
        rigidityScore: 1,
        sharpnessScore: 5,
        hookIntent,
        bigPremise: true,
        premiseStyle: def.parentBucket,
        premiseStyleId: id,
        executionId: exec.id,
      });
    }
  }
  return out;
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
/**
 * Phase 6E — PremiseComedyScore type (single source of truth).
 *
 * Lives in patternIdeator.ts (alongside PatternMeta) so PatternMeta
 * can declare an optional `premiseComedyScore` field without the
 * ideaScorer.ts ⇄ patternIdeator.ts circular import that would
 * otherwise be required. The SCORING FUNCTION
 * (`scorePremiseComedyScore`) lives in ideaScorer.ts and imports
 * this type back; ideaScorer.ts also re-exports the type so existing
 * callers that import `PremiseComedyScore` from there keep working.
 *
 * See `scorePremiseComedyScore` in ideaScorer.ts for the rubric and
 * the gating model (HARD reject < 5 at picker walk; scaled selection-
 * layer boost via `premiseComedyBoost` for 5-10 band).
 */
export type PremiseComedyScore = {
  /** Unexpected phrasing / non-obvious / not plain observation. 0-2. */
  surprise: 0 | 1 | 2;
  /** Tied to scenario / not generic / has concrete behavior or object. 0-2. */
  specificity: 0 | 1 | 2;
  /** Self-roast / embarrassment / frustration / anxiety / contradiction. 0-2. */
  punch: 0 | 1 | 2;
  /** Instantly understandable / short / one clear joke. 0-2. */
  simplicity: 0 | 1 | 2;
  /** Feels like something people actually do/think — triggers "me" response. 0-2. */
  relatability: 0 | 1 | 2;
  /** Sum of dims, capped at 10. */
  total: number;
  /**
   * True ONLY when a HARD reject pattern fired (PART 3 explicit examples
   * or "could apply to almost anything" structural shape). Independent
   * of `total < 5` — that gating decision lives at the picker walk.
   * `rejected: true` always implies `total: 0`.
   */
  rejected: boolean;
  /** Free-form telemetry tag for the matching reject family. */
  rejectReason?:
    | "hard_pattern_reject"
    | "no_anchor"
    | "starts_generic_observation";
  /** PART 4 — strong-comedy mechanisms detected. Telemetry only. */
  boostMechanisms: ReadonlyArray<
    | "self_roast"
    | "absurd_metaphor"
    | "object_personification"
    | "time_marker_contrast"
    | "identity_contradiction"
    | "overdramatic_framing"
    | "consumer_phone_behavior"
    | "late_night_spiral"
  >;
};

/**
 * Phase 6F — LegacyComedyScore type (single source of truth for the
 * legacy / non-premise rubric). Lives in patternIdeator.ts alongside
 * PremiseComedyScore so PatternMeta can declare an optional
 * `legacyComedyScore` field without re-introducing the ideaScorer.ts
 * ⇄ patternIdeator.ts circular import that was avoided in 6E.
 *
 * The Phase 6F SPEC explicitly characterizes legacy as the SIMPLER
 * fallback layer that "must still be good" but does NOT need to be
 * clever — so the rubric is intentionally LIGHTER than the premise
 * version. Four dims summing to 10 (vs the premise rubric's five
 * dims), with the harder-to-reach top-of-dim values reserved for
 * sharp-but-simple legacy hooks (e.g. "i opened it. then closed it",
 * "i checked. that counted").
 *
 * Gating model parallel to PremiseComedyScore but with thresholds
 * shifted ONE STEP LOWER per the spec PART 3 (legacy is simpler, so
 * the keep band starts at 6 instead of 7 and the demote band is the
 * single value 5 instead of the two-value 5-6 band):
 *   - score ≥ 6 → keep
 *   - score = 5 → demote (scaled `selectionPenalty` boost goes
 *                negative — see `legacyComedyBoost` below)
 *   - score < 5 → HARD reject at the picker walk fallback
 *
 * See `scoreLegacyComedyScore` further down for the rubric and
 * `legacyComedyBoost` for the selection-layer boost band.
 */
export type LegacyComedyScore = {
  /** Common behavior / everyday situation / "this is me" feeling. 0-3. */
  relatability: 0 | 1 | 2 | 3;
  /** Instantly understandable / no clever phrasing / no jargon. 0-3. */
  clarity: 0 | 1 | 2 | 3;
  /** Short / clean / one idea / no multi-clause caption-like split. 0-2. */
  simplicity: 0 | 1 | 2;
  /**
   * Mild frustration / avoidance / procrastination / subtle self-
   * awareness — legacy doesn't need an explicit emotion spike, but
   * the rubric rewards entries that carry one. 0-2.
   */
  emotional: 0 | 1 | 2;
  /** Sum of dims, capped at 10. */
  total: number;
  /**
   * True ONLY when a legacy-specific HARD reject pattern fired (the
   * explicit Part 4 generic-filler list, no-anchor structure, or
   * length > 12 words). Independent of `total < 5` — that gating
   * decision lives at the picker walk fallback site. `rejected: true`
   * always implies `total: 0`.
   */
  rejected: boolean;
  /** Free-form telemetry tag for the matching reject family. */
  rejectReason?:
    | "generic_filler"
    | "no_anchor"
    | "too_long";
};

/**
 * Phase 7 — ViralFeelScore type (single source of truth).
 *
 * Lives in patternIdeator.ts alongside PremiseComedyScore /
 * LegacyComedyScore so PatternMeta can declare an optional
 * `viralFeelScore` field without re-introducing the ideaScorer.ts ⇄
 * patternIdeator.ts circular import that 6E/6F also avoided.
 *
 * The ViralFeelScore is a FINAL RANKING POLISH layer — it does NOT
 * gate (no HARD reject), it does NOT rescue weak hooks (its
 * `selectionPenalty` boost band is intentionally LIGHTER than both
 * comedy bands so a strong comedy score always dominates), and it
 * does NOT change the catalog or hard validators. Its single job is
 * to break ties in the keep band toward the candidate that "feels
 * more sendable" — high instant recognition + scroll interruption +
 * shareability + emotional spike + format fit.
 *
 * Five dims summing to 10:
 *   - instantRecognition (0-3): first-person + behavior verbs + everyday
 *     anchor → "yeah, that's me" trigger
 *   - scrollInterruption (0-2): surprise/spike words, comma cuts,
 *     fragment shapes → makes the user PAUSE
 *   - shareability      (0-2): identity-mirror tokens + group/confession
 *     verbs → "I have to send this to ___"
 *   - emotionalSpike    (0-2): embarrassment / anxiety / irony /
 *     delusion vocabulary → emotional bite
 *   - formatFit         (0-1): videoPattern × premiseStyleId synergy
 *     bonus PLUS basic pattern-style compatibility — the filming
 *     pattern actually amplifies what the hook is doing
 *
 * See `scoreViralFeel` further down for the rubric and
 * `viralFeelBoost` for the selection-layer boost band.
 */
export type ViralFeelScore = {
  /** First-person + behavior verbs + everyday anchor. 0-3. */
  instantRecognition: 0 | 1 | 2 | 3;
  /** Surprise / spike words / fragment shape / comma cuts. 0-2. */
  scrollInterruption: 0 | 1 | 2;
  /** Identity-mirror tokens / group-confession verbs. 0-2. */
  shareability: 0 | 1 | 2;
  /** Embarrassment / anxiety / irony / delusion vocabulary. 0-2. */
  emotionalSpike: 0 | 1 | 2;
  /** VideoPattern × PremiseStyleId synergy + base compatibility. 0-1. */
  formatFit: 0 | 1;
  /** Sum of dims, capped at 10. Never < 0. */
  total: number;
};

export type LanguagePhrasingEntry = {
  build: (s: Scenario) => string;
  voiceProfiles?: readonly VoiceProfile[];
  /**
   * Phase 3 PART 1 (HOOK TEMPLATE / SCROLL-STOPPING UPGRADE):
   * lower = less reusable across scenarios = better. Range 1-5.
   * Used by `scoreScrollStop` (-3 penalty when >=4) so highly-
   * reusable templates take a hit unless their fragment / structure
   * boosts compensate. Optional with default 3 (via `getEntryScores`)
   * for backward-compat with cached / legacy entries.
   */
  rigidityScore?: number;
  /**
   * Phase 3 PART 1: higher = more emotional impact. Range 1-5.
   * Surfaced as a soft signal in `scoreScrollStop` (folds into the
   * +2 "emotionally charged" boost when intrinsic sharpness >= 4).
   * Optional with default 3 (via `getEntryScores`).
   */
  sharpnessScore?: number;
  /**
   * Phase 4 (HOOK INTENT) — REQUIRED job-of-the-hook tag controlling
   * which entries are eligible for a given candidate slot. The
   * generation flow assigns a target intent per slot (round-robin
   * `slot % 3`) and the picker filters this catalog to entries
   * matching that intent first, falling back to ANY entry of the
   * same hookLanguageStyle if none of the matching-intent entries
   * validate (telemetry-only fallback — never starves a slot). The
   * scorer dispatches per-intent scoring (`scoreScrollStop` /
   * `scoreCompulsion` / `scoreRelatable`) off this field. See the
   * HookIntent block above HookPhrasingEntry for definitions.
   */
  hookIntent: HookIntent;
  /**
   * Phase 3 HOOK TEMPLATE TUNING — stable identifier for a formulaic
   * hook skeleton (a `(s) => ...` build that interpolates Scenario
   * fields into a fixed sentence shape, e.g. "today's update: ${X}").
   * Two entries with the SAME `skeletonId` are noun-swap variants of
   * one underlying joke and read as repetition even when the
   * scenario differs.
   *
   * - Set ONLY on formulaic templates whose surface text is dominated
   *   by the fixed scaffold (template-noun-swap risk).
   * - LEAVE UNDEFINED on entries whose phrasing is genuinely scenario-
   *   shaped (the scaffold IS the scenario, no formulaic skeleton to
   *   cap).
   *
   * Drives:
   *   - within-batch -3 demotion in `selectionPenalty` (parallels the
   *     `videoPattern` dup lever).
   *   - cross-batch tiered demotion in `selectionPenalty`: -3 if the
   *     skeleton appeared in the immediate-prior batch, additional -2
   *     stack if it appeared in ≥2 of the last 3 batches (parallels
   *     the `ideaCoreFamily` cross-batch tiering).
   *
   * Persisted on cache envelopes via `meta.hookSkeletonId →
   * CachedBatchEntry.hookSkeletonId` so the cross-batch lever
   * survives the JSONB round-trip; entries written before this field
   * existed silently abstain (undefined never matches).
   */
  skeletonId?: string;
  /**
   * Phase 3 HOOK TEMPLATE TUNING — flag entries whose `build` is a
   * scenario-AGNOSTIC `() =>` literal (no Scenario fields used).
   * These hooks read the same regardless of which scenario produced
   * them ("this ruined my mood", "i'm over it", "9:14pm. still here.").
   *
   * Folded into `scoreScrollStop` / `scoreCompulsion` / `scoreRelatable`
   * as a -2 entry-derived signal — generic hooks lose their scenario-
   * specific scroll-stop power, so even a high-sharpness generic
   * loses to a scenario-tagged equivalent at parity.
   *
   * Optional with default false (via the `=== true` check at each
   * read site) so legacy entries / future additions that omit the
   * field are treated as scenario-shaped by default.
   */
  genericHook?: boolean;
  /**
   * Phase 3B PART 2 — coarse compatibility allowlist for the
   * scenario's `topicNounType`. When set, the picker
   * (`pickValidatedLanguagePhrasing` walk) skips this entry for any
   * scenario whose `topicNounType` is NOT in the list, BEFORE calling
   * `entry.build(scenario)`. This prevents semantically-broken
   * compositions ("future me thinks about the sneeze", "the wave
   * watching me decide nothing") at the source instead of rejecting
   * them post-build.
   *
   * Set ONLY on formulaic templates whose phrasing requires a
   * specific noun shape (most `skeletonId`-tagged templates do).
   * Leave undefined for templates whose phrasing is naturally
   * permissive across all noun types — undefined means "any
   * topicNounType passes", same fallback discipline as the other
   * optional fields here.
   *
   * Use the same `TopicNounType` union as `Scenario.topicNounType`
   * so the typecheck enforces a closed set on both sides.
   */
  allowedNounTypes?: ReadonlyArray<TopicNounType>;
  /**
   * Phase 6 (BIG PREMISE LAYER) — flag entries whose `build` returns
   * a complete scenario-AGNOSTIC premise hook (per spec PART 1: a
   * funny stand-alone joke, NOT a template-noun-swap). When true,
   * the picker layers `validateBigPremise` ON TOP of `validateHook`
   * (PART 2 + PART 3 rails: ≤10 words, no filler, no boring
   * observation phrasing). When undefined / false, the entry follows
   * the legacy template flow unchanged. Premise entries should also
   * leave `genericHook` undefined (premises are sharp, NOT flat) and
   * leave `skeletonId` undefined (each premise is its own unique
   * joke, not a template skeleton subject to the noun-swap cap).
   */
  bigPremise?: boolean;
  /**
   * Phase 6 — which of the 5 premise styles this entry expresses.
   * MUST be set when `bigPremise === true` (the picker doesn't
   * enforce this at runtime; it's a JSDoc contract). Drives the
   * cross-batch + within-batch premise-style novelty axis in
   * `selectionPenalty` so a single batch never ships 3+ premises
   * of the same style and back-to-back batches don't repeat styles.
   */
  premiseStyle?: BigPremiseStyle;
  /**
   * Phase 6 EXPANSION (PREMISE STYLE ENGINE) — fine-grained style id
   * (one of 50). MUST be set when this entry was generated from
   * `PREMISE_STYLE_DEFS[id].examples` via `buildPremiseEntriesFromDefs`.
   * Optional / undefined for legacy template entries that don't
   * carry a fine-grained style id (Llama-generated, Claude polish
   * path, plain non-premise hooks). Phase 6D: the 29 originally
   * hand-written premise entries WERE retro-threaded with both
   * `premiseStyleId` + `executionId` so they participate in the
   * within-batch HARD tuple guard and the cross-batch +2 fresh /
   * -2 reused executionId boost — bypassing them was the root cause
   * of the 6C premise-share ceiling. Drives the within-batch hard
   * dedup (-3 in `selectionPenalty`, "no same PremiseStyle twice in
   * one batch" hard rule from spec) and cross-batch -2 demotion via
   * `recentPremiseStyleIds`. The bucket-level `premiseStyle` lever
   * still fires independently — both axes stack.
   */
  premiseStyleId?: PremiseStyleId;
  /**
   * Phase 6D (PREMISE EXECUTION EXPANSION) — fine-grained execution-
   * pattern id (descriptive label like `direct_failure`,
   * `relationship_framing`, `time_marker`; open-ended string, NOT a
   * closed enum). Set ONLY on entries built from
   * `PREMISE_STYLE_DEFS[id].executions[*]` via
   * `buildPremiseEntriesFromDefs` (one entry per execution variant).
   * Optional / undefined for legacy template entries that don't
   * carry a fine-grained execution id (Llama-generated, Claude
   * polish path, plain non-premise hooks). Phase 6D: the 29
   * originally hand-written premise entries WERE retro-threaded
   * with both `premiseStyleId` + `executionId` so they participate
   * in the within-batch HARD tuple guard and the cross-batch +2
   * fresh / -2 reused executionId boost — bypassing them was the
   * root cause of the 6C premise-share ceiling. Drives the within-
   * batch HARD `(premiseStyleId, executionId)` tuple dedup in
   * `batchGuardsPass` (defense-in-depth on top of the premiseStyleId
   * -only HARD from 6C) and cross-batch -2 demote / +2 fresh-boost
   * levers in `selectionPenalty`. The style-level + bucket-level
   * levers still fire independently — all three axes (bucket /
   * style / execution) stack.
   */
  executionId?: string;
};

/**
 * Resolve effective `{ rigidity, sharpness }` for a phrasing entry,
 * defaulting absent fields to 3 (mid-pool). Pure helper so the
 * scorer + picker share one source of truth — adding or removing
 * default constants in one place updates both call sites.
 */
export function getEntryScores(
  entry: LanguagePhrasingEntry,
): { rigidity: number; sharpness: number } {
  return {
    rigidity: entry.rigidityScore ?? 3,
    sharpness: entry.sharpnessScore ?? 3,
  };
}

/**
 * Phase 4 — resolve effective `hookIntent` for either entry shape
 * (Phase 3 LanguagePhrasingEntry where the field is REQUIRED, or
 * legacy HookPhrasingEntry where it's OPTIONAL). Defaults to
 * `scroll_stop` when absent — the legacy validator already rejects
 * the open-loop / first-person banned prefixes, so anything that
 * ships through the legacy 5-style catalog is fragment-shaped by
 * construction. Pure helper so picker + scorer + rewriter share one
 * source of truth.
 */
export function getEntryIntent(
  entry: LanguagePhrasingEntry | HookPhrasingEntry,
): HookIntent {
  return entry.hookIntent ?? "scroll_stop";
}

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
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "relatable",
      skeletonId: "keep_pretending_doesnt_exist",
    },
    {
      build: (s) => `I told myself I'd ${s.actionShort}`,
      voiceProfiles: ["self_aware", "soft_confessional", "dry_humor"],
      rigidityScore: 4,
      sharpnessScore: 3,
      hookIntent: "relatable",
    },
    {
      build: (s) => `I have no plan, only ${s.realityShort}`,
      voiceProfiles: ["self_aware", "dry_humor", "deadpan"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "relatable",
    },
    {
      build: (s) => `I claimed I'd ${s.actionShort}, frankly`,
      voiceProfiles: ["self_aware", "blunt", "soft_confessional"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "relatable",
    },
    {
      build: (s) => `still avoiding ${s.topicNoun}, posting instead`,
      voiceProfiles: ["chaotic", "sarcastic", "self_aware"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "relatable",
      skeletonId: "avoiding_posting",
      allowedNounTypes: ["object", "place", "event", "action", "abstract"] as const,
    },
    {
      build: (s) => `${s.topicNoun} is my whole personality now`,
      voiceProfiles: ["poetic", "self_aware", "soft_confessional"],
      rigidityScore: 3,
      sharpnessScore: 3,
      hookIntent: "relatable",
      skeletonId: "whole_personality",
      allowedNounTypes: ["object", "abstract", "place", "action"] as const,
    },
    // Phase 3 PART 1 EMOTIONAL_SPIKE additions — sharp, abrupt
    // confession-flavored emotional reactions. All scenario-agnostic
    // (no `s.*` interpolation) so they read as raw mid-action thoughts.
    {
      build: () => `i'm over it. truly.`,
      voiceProfiles: ["blunt", "deadpan", "sarcastic"],
      rigidityScore: 3,
      sharpnessScore: 5,
      hookIntent: "scroll_stop",
      genericHook: true,
    },
    {
      build: () => `this ruined my mood`,
      voiceProfiles: ["soft_confessional", "blunt", "dry_humor"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
      genericHook: true,
    },
    {
      build: () => `i hate this part`,
      voiceProfiles: ["blunt", "soft_confessional", "deadpan"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
      genericHook: true,
    },
    {
      build: () => `i did not try that hard`,
      voiceProfiles: ["self_aware", "dry_humor", "soft_confessional"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "relatable",
      genericHook: true,
    },
    // ----------------------------------------------------------------
    // Phase 6 BIG PREMISE additions — scenario-AGNOSTIC complete
    // premise hooks (PART 1: SELF_ROAST + IDENTITY_FRAMING for the
    // confession bucket since first-person admissions read most
    // naturally as those two styles). Each carries `bigPremise: true`
    // + `premiseStyle` + premium scores (rigidity 1 = least reusable,
    // sharpness 5 = highest emotional impact). NO `genericHook` flag
    // (premises are sharp, not flat) and NO `skeletonId` (each entry
    // is its own unique joke, not a template skeleton).
    // ----------------------------------------------------------------
    {
      build: () => `i ghosted my own to-do list`,
      voiceProfiles: ["self_aware", "soft_confessional", "dry_humor"],
      rigidityScore: 1,
      sharpnessScore: 5,
      hookIntent: "relatable",
      bigPremise: true,
      premiseStyle: "self_roast",
      premiseStyleId: "todo_termination",
      executionId: "direct_failure",
    },
    {
      build: () => `i am my own worst project`,
      voiceProfiles: ["self_aware", "blunt", "dry_humor"],
      rigidityScore: 1,
      sharpnessScore: 5,
      hookIntent: "relatable",
      bigPremise: true,
      premiseStyle: "self_roast",
      premiseStyleId: "self_sabotage_scrollstop",
      executionId: "identity_framing",
    },
    {
      build: () => `i lose to myself in scheduled rounds`,
      voiceProfiles: ["dry_humor", "deadpan", "self_aware"],
      rigidityScore: 1,
      sharpnessScore: 5,
      hookIntent: "relatable",
      bigPremise: true,
      premiseStyle: "self_roast",
      premiseStyleId: "self_destruction_speedrun",
      executionId: "pattern_naming",
    },
    {
      build: () => `i am the protagonist of accidental chaos`,
      voiceProfiles: ["self_aware", "dry_humor", "soft_confessional"],
      rigidityScore: 1,
      sharpnessScore: 5,
      hookIntent: "relatable",
      bigPremise: true,
      premiseStyle: "identity_framing",
      premiseStyleId: "main_character_meltdown",
      executionId: "identity_framing",
    },
    {
      build: () => `i am professionally allergic to follow-through`,
      voiceProfiles: ["self_aware", "dry_humor", "soft_confessional"],
      rigidityScore: 1,
      sharpnessScore: 5,
      hookIntent: "relatable",
      bigPremise: true,
      premiseStyle: "identity_framing",
      premiseStyleId: "procrastination_paradox",
      executionId: "identity_framing",
    },
    {
      build: () => `i was raised to disappoint exactly myself`,
      voiceProfiles: ["self_aware", "soft_confessional", "dry_humor"],
      rigidityScore: 1,
      sharpnessScore: 5,
      hookIntent: "relatable",
      bigPremise: true,
      premiseStyle: "identity_framing",
      premiseStyleId: "self_destruction_speedrun",
      executionId: "delusion_admission",
    },
    // ----------------------------------------------------------------
    // Phase 6 EXPANSION — first-person confessional premise hooks
    // generated from PREMISE_STYLE_DEFS (17 styles × ~2 examples).
    // All use `relatable` intent + the canonical confession voice
    // triple. Each entry carries `premiseStyleId` so the fine-grained
    // within-batch hard-dedup + cross-batch -2 lever in
    // `selectionPenalty` activates, in addition to the bucket-level
    // `premiseStyle` lever already in place.
    // ----------------------------------------------------------------
    ...buildPremiseEntriesFromDefs(
      [
        "self_roast_reactor",
        "relatable_pain",
        "fake_confidence",
        "hypocrisy_hyperdrive",
        "self_destruction_speedrun",
        "self_sabotage_scrollstop",
        "chaos_confession",
        "doomscroll_disclosure",
        "fomo_fracture",
        "procrastination_paradox",
        "manifestation_mockery",
        "group_chat_guilt",
        "dream_disappointment",
        "plant_parent_psychosis",
        "cart_autopsy",
        "lazy_genius",
        "todo_termination",
      ],
      "relatable",
      ["self_aware", "soft_confessional", "dry_humor"],
    ),
  ],
  observation: [
    {
      build: (s) => `there's always one ${s.topicNoun} you never deal with`,
      voiceProfiles: ["dry_humor", "deadpan", "poetic"],
      rigidityScore: 3,
      sharpnessScore: 3,
      hookIntent: "relatable",
      skeletonId: "always_one_never_deal",
    },
    {
      build: (s) => `everybody has ${s.topicNoun} they keep avoiding`,
      voiceProfiles: ["dry_humor", "deadpan", "soft_confessional"],
      rigidityScore: 4,
      sharpnessScore: 2,
      hookIntent: "relatable",
      skeletonId: "everybody_has_avoiding",
      allowedNounTypes: ["object", "place", "event", "action", "abstract"] as const,
    },
    {
      build: (s) => `nobody ever talks about ${s.realityShort}`,
      voiceProfiles: ["blunt", "deadpan", "sarcastic"],
      rigidityScore: 3,
      sharpnessScore: 3,
      hookIntent: "compulsion",
    },
    {
      build: (s) => `it's always the same loop with ${s.topicNoun}`,
      voiceProfiles: ["dry_humor", "deadpan", "sarcastic"],
      rigidityScore: 4,
      sharpnessScore: 2,
      hookIntent: "relatable",
      skeletonId: "same_loop_with",
    },
    {
      build: (s) => `${s.topicNoun} is a personality trait apparently`,
      voiceProfiles: ["sarcastic", "chaotic", "dry_humor", "self_aware"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "relatable",
      skeletonId: "personality_trait_apparently",
      allowedNounTypes: ["object", "abstract", "action"] as const,
    },
    {
      build: () => `the small things become the whole thing eventually`,
      voiceProfiles: ["poetic", "soft_confessional", "self_aware"],
      rigidityScore: 4,
      sharpnessScore: 3,
      hookIntent: "compulsion",
      genericHook: true,
    },
    // Phase 3 PART 1 SELF_AWARE/META additions — observational hooks
    // about the creator's own pattern. Scenario-agnostic so they
    // read as direct meta-commentary.
    {
      build: () => `i see the pattern, again`,
      voiceProfiles: ["self_aware", "dry_humor", "deadpan"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "relatable",
      genericHook: true,
    },
    {
      build: () => `i keep doing this. cool.`,
      voiceProfiles: ["self_aware", "sarcastic", "dry_humor"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "relatable",
      genericHook: true,
    },
    {
      build: () => `this is on me, fully`,
      voiceProfiles: ["self_aware", "blunt", "soft_confessional"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "relatable",
      genericHook: true,
    },
    {
      build: () => `i already know how this ends`,
      voiceProfiles: ["self_aware", "deadpan", "soft_confessional"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "compulsion",
      genericHook: true,
    },
    // Phase 6 BIG PREMISE additions — OVER_DRAMATIZATION premises
    // read as "general observations about catastrophic stakes",
    // a natural fit for the observation bucket.
    {
      build: () => `this small thing has unmade me entirely`,
      voiceProfiles: ["soft_confessional", "blunt", "sarcastic"],
      rigidityScore: 1,
      sharpnessScore: 5,
      hookIntent: "scroll_stop",
      bigPremise: true,
      premiseStyle: "over_dramatization",
      premiseStyleId: "mundane_meltdown",
      executionId: "cosmic_overreaction",
    },
    {
      build: () => `this inconvenience has rewritten my whole arc`,
      voiceProfiles: ["chaotic", "sarcastic", "dry_humor"],
      rigidityScore: 1,
      sharpnessScore: 5,
      hookIntent: "scroll_stop",
      bigPremise: true,
      premiseStyle: "over_dramatization",
      premiseStyleId: "overdramatic_reframe",
      executionId: "cosmic_overreaction",
    },
    {
      build: () => `my entire personality is currently unraveling`,
      voiceProfiles: ["chaotic", "sarcastic", "soft_confessional"],
      rigidityScore: 1,
      sharpnessScore: 5,
      hookIntent: "scroll_stop",
      bigPremise: true,
      premiseStyle: "over_dramatization",
      premiseStyleId: "main_character_meltdown",
      executionId: "chaos_acceptance",
    },
  ],
  absurd_claim: [
    {
      build: (s) => `${s.topicNoun} and I are in a standoff`,
      voiceProfiles: ["dry_humor", "sarcastic", "chaotic"],
      rigidityScore: 3,
      sharpnessScore: 3,
      hookIntent: "scroll_stop",
      skeletonId: "noun_standoff",
      allowedNounTypes: ["object", "abstract"] as const,
    },
    {
      build: (s) => `${s.topicNoun} pays rent here at this point`,
      voiceProfiles: ["chaotic", "sarcastic", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
      skeletonId: "noun_pays_rent",
      allowedNounTypes: ["object", "abstract"] as const,
    },
    {
      build: (s) => `pretty sure ${s.topicNoun} runs my schedule now`,
      voiceProfiles: ["chaotic", "sarcastic", "self_aware"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
      skeletonId: "noun_runs_schedule",
      allowedNounTypes: ["object", "abstract"] as const,
    },
    {
      build: (s) => `${s.topicNoun} is officially a third roommate`,
      voiceProfiles: ["chaotic", "dry_humor", "sarcastic"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
      skeletonId: "noun_third_roommate",
      allowedNounTypes: ["object", "abstract"] as const,
    },
    {
      build: (s) => `${s.topicNoun} feels like a villain origin story`,
      voiceProfiles: ["sarcastic", "chaotic", "self_aware"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "compulsion",
      skeletonId: "noun_villain_origin",
      allowedNounTypes: ["object", "abstract", "event"] as const,
    },
    {
      build: (s) => `${s.topicNoun} is sentient and we both know`,
      voiceProfiles: ["deadpan", "dry_humor", "chaotic"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
      skeletonId: "noun_sentient",
      allowedNounTypes: ["object", "abstract"] as const,
    },
    {
      build: (s) => `we are quietly losing to ${s.topicNoun} again`,
      voiceProfiles: ["soft_confessional", "deadpan", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "relatable",
      skeletonId: "quietly_losing_to",
      allowedNounTypes: ["event", "body_state", "abstract", "object"] as const,
    },
    // Phase 6 BIG PREMISE additions — ABSURD_METAPHOR premises
    // (PART 1: turn the situation into something bigger). These
    // anthropomorphize internal state into bureaucratic / corporate
    // / aviation language for comic effect — natural fit for the
    // absurd_claim bucket. Plus 2 CONTRAST_DUALITY entries that
    // read as absurd parallel-self framings.
    {
      build: () => `my brain filed for emotional bankruptcy`,
      voiceProfiles: ["chaotic", "sarcastic", "dry_humor"],
      rigidityScore: 1,
      sharpnessScore: 5,
      hookIntent: "scroll_stop",
      bigPremise: true,
      premiseStyle: "absurd_metaphor",
      premiseStyleId: "burnout_betrayal",
      executionId: "metaphor_mayhem",
    },
    {
      build: () => `my brain hates me after 11pm`,
      voiceProfiles: ["chaotic", "dry_humor", "self_aware"],
      rigidityScore: 1,
      sharpnessScore: 5,
      hookIntent: "relatable",
      bigPremise: true,
      premiseStyle: "absurd_metaphor",
      premiseStyleId: "three_am_spiral",
      executionId: "time_marker",
    },
    {
      build: () => `my motivation is in airplane mode again`,
      voiceProfiles: ["dry_humor", "sarcastic", "self_aware"],
      rigidityScore: 1,
      sharpnessScore: 5,
      hookIntent: "relatable",
      bigPremise: true,
      premiseStyle: "absurd_metaphor",
      premiseStyleId: "dopamine_denial",
      executionId: "metaphor_mayhem",
    },
    {
      build: () => `my dopamine called in sick again`,
      voiceProfiles: ["chaotic", "dry_humor", "sarcastic"],
      rigidityScore: 1,
      sharpnessScore: 5,
      hookIntent: "relatable",
      bigPremise: true,
      premiseStyle: "absurd_metaphor",
      premiseStyleId: "dopamine_denial",
      executionId: "direct_failure",
    },
    {
      build: () => `my willpower is on permanent vacation`,
      voiceProfiles: ["dry_humor", "sarcastic", "self_aware"],
      rigidityScore: 1,
      sharpnessScore: 5,
      hookIntent: "relatable",
      bigPremise: true,
      premiseStyle: "absurd_metaphor",
      premiseStyleId: "dopamine_denial",
      executionId: "understatement",
    },
    {
      build: () => `morning me undoes everything afternoon me does`,
      voiceProfiles: ["dry_humor", "deadpan", "self_aware"],
      rigidityScore: 1,
      sharpnessScore: 5,
      hookIntent: "relatable",
      bigPremise: true,
      premiseStyle: "contrast_duality",
      premiseStyleId: "duality_clash",
      executionId: "time_marker",
    },
    {
      build: () => `past me made plans, present me suffers`,
      voiceProfiles: ["dry_humor", "sarcastic", "self_aware"],
      rigidityScore: 1,
      sharpnessScore: 5,
      hookIntent: "relatable",
      bigPremise: true,
      premiseStyle: "contrast_duality",
      premiseStyleId: "duality_clash",
      executionId: "whiplash_pivot",
    },
    // ----------------------------------------------------------------
    // Phase 6 EXPANSION — declarative / 3rd-person observational
    // premise hooks (11 styles × ~2 examples). `compulsion` intent
    // pairs with the dry/deadpan/self_aware voice triple — these read
    // as a creator naming a pattern, not confessing it.
    // ----------------------------------------------------------------
    ...buildPremiseEntriesFromDefs(
      [
        "pattern_exposure",
        "contrast_catastrophe",
        "mundane_meltdown",
        "fridge_judgment",
        "everyday_armageddon",
        "weekly_wipeout",
        "comic_relief_cataclysm",
        "three_am_spiral",
        "main_character_meltdown",
        "dopamine_denial",
        "social_battery_sabotage",
      ],
      "compulsion",
      ["dry_humor", "deadpan", "self_aware"],
    ),
  ],
  matter_of_fact: [
    {
      build: (s) => `${s.topicNoun} won today, again`,
      voiceProfiles: ["blunt", "deadpan", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
      skeletonId: "noun_won_today",
      allowedNounTypes: ["object", "abstract", "event"] as const,
    },
    {
      build: (s) => `${s.topicNoun} is staying exactly where it is`,
      voiceProfiles: ["blunt", "deadpan", "dry_humor"],
      rigidityScore: 3,
      sharpnessScore: 3,
      hookIntent: "scroll_stop",
      skeletonId: "noun_staying_put",
      allowedNounTypes: ["object", "place"] as const,
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
      rigidityScore: 4,
      sharpnessScore: 3,
      hookIntent: "scroll_stop",
      skeletonId: "todays_update",
    },
    {
      build: (s) => `nothing changed. ${s.realityShort}.`,
      voiceProfiles: ["blunt", "deadpan", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
      skeletonId: "nothing_changed_reality",
    },
    {
      build: (s) => `no progress. ${s.topicNoun} remains.`,
      voiceProfiles: ["deadpan", "soft_confessional", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
      skeletonId: "no_progress_remains",
      allowedNounTypes: ["object", "place", "abstract", "body_state"] as const,
    },
    // Phase 3 PART 1 DEADPAN/BLUNT additions — flat, scenario-agnostic
    // declarations of failure / non-action. The spec PART 5 voice
    // target ("interruptions, thoughts mid-action, slightly messy").
    {
      build: () => `this was my attempt`,
      voiceProfiles: ["deadpan", "dry_humor", "blunt"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
      genericHook: true,
    },
    {
      build: () => `no progress made`,
      voiceProfiles: ["deadpan", "blunt", "dry_humor"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
      genericHook: true,
    },
    {
      build: () => `i did not do it`,
      voiceProfiles: ["blunt", "deadpan", "soft_confessional"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "relatable",
      genericHook: true,
    },
    {
      build: () => `i gave up early`,
      voiceProfiles: ["deadpan", "soft_confessional", "dry_humor"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "relatable",
      genericHook: true,
    },
    {
      build: () => `this didn't work`,
      voiceProfiles: ["blunt", "deadpan", "dry_humor"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
      genericHook: true,
    },
    // Phase 6 BIG PREMISE additions — matter_of_fact carries the
    // bulk of declarative premise hooks (OVER_DRAMATIZATION +
    // SELF_ROAST + IDENTITY_FRAMING) since its bucket signature is
    // "blunt declarative statement about reality" — exactly what a
    // big-premise hook reads as.
    {
      build: () => `this is where my life collapsed`,
      voiceProfiles: ["chaotic", "blunt", "sarcastic"],
      rigidityScore: 1,
      sharpnessScore: 5,
      hookIntent: "scroll_stop",
      bigPremise: true,
      premiseStyle: "over_dramatization",
      premiseStyleId: "overdramatic_reframe",
      executionId: "expectation_collapse",
    },
    {
      build: () => `my dignity has officially left the chat`,
      voiceProfiles: ["chaotic", "sarcastic", "dry_humor"],
      rigidityScore: 1,
      sharpnessScore: 5,
      hookIntent: "scroll_stop",
      bigPremise: true,
      premiseStyle: "over_dramatization",
      premiseStyleId: "collapse_core",
      executionId: "gen_z_collapse",
    },
    {
      build: () => `my soul has politely vacated the building`,
      voiceProfiles: ["chaotic", "dry_humor", "sarcastic"],
      rigidityScore: 1,
      sharpnessScore: 5,
      hookIntent: "scroll_stop",
      bigPremise: true,
      premiseStyle: "over_dramatization",
      premiseStyleId: "collapse_core",
      executionId: "understatement",
    },
    {
      build: () => `i specialize in disappointing my future self`,
      voiceProfiles: ["self_aware", "dry_humor", "soft_confessional"],
      rigidityScore: 1,
      sharpnessScore: 5,
      hookIntent: "relatable",
      bigPremise: true,
      premiseStyle: "self_roast",
      premiseStyleId: "self_destruction_speedrun",
      executionId: "direct_failure",
    },
    {
      build: () => `i gently disappoint my dreams weekly`,
      voiceProfiles: ["self_aware", "soft_confessional", "dry_humor"],
      rigidityScore: 1,
      sharpnessScore: 5,
      hookIntent: "relatable",
      bigPremise: true,
      premiseStyle: "self_roast",
      premiseStyleId: "dream_disappointment",
      executionId: "understatement",
    },
    {
      build: () => `this is why i can't have nice habits`,
      voiceProfiles: ["self_aware", "dry_humor", "deadpan"],
      rigidityScore: 1,
      sharpnessScore: 5,
      hookIntent: "relatable",
      bigPremise: true,
      premiseStyle: "self_roast",
      premiseStyleId: "pattern_exposure",
      executionId: "pattern_naming",
    },
    {
      build: () => `i specialize in highly creative avoidance`,
      voiceProfiles: ["self_aware", "dry_humor", "sarcastic"],
      rigidityScore: 1,
      sharpnessScore: 5,
      hookIntent: "relatable",
      bigPremise: true,
      premiseStyle: "identity_framing",
      premiseStyleId: "procrastination_paradox",
      executionId: "ironic_confidence",
    },
    {
      build: () => `i am the villain of my own scheduling`,
      voiceProfiles: ["self_aware", "sarcastic", "dry_humor"],
      rigidityScore: 1,
      sharpnessScore: 5,
      hookIntent: "relatable",
      bigPremise: true,
      premiseStyle: "identity_framing",
      premiseStyleId: "self_sabotage_scrollstop",
      executionId: "direct_failure",
    },
    {
      build: () => `my brand is mild self-betrayal`,
      voiceProfiles: ["self_aware", "dry_humor", "blunt"],
      rigidityScore: 1,
      sharpnessScore: 5,
      hookIntent: "relatable",
      bigPremise: true,
      premiseStyle: "identity_framing",
      premiseStyleId: "self_roast_reactor",
      executionId: "identity_framing",
    },
  ],
  question: [
    {
      build: (s) => `at what point do we admit ${s.topicNoun}`,
      voiceProfiles: ["self_aware", "dry_humor", "blunt"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "compulsion",
      skeletonId: "at_what_point_admit",
      allowedNounTypes: ["object", "abstract", "body_state", "event"] as const,
    },
    {
      build: (s) => `how many days does ${s.topicNoun} get`,
      voiceProfiles: ["sarcastic", "dry_humor", "blunt"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "compulsion",
      skeletonId: "how_many_days_gets",
      allowedNounTypes: ["object", "abstract", "event", "place"] as const,
    },
    {
      build: () => `who decided this was fine again`,
      voiceProfiles: ["sarcastic", "dry_humor", "self_aware"],
      rigidityScore: 4,
      sharpnessScore: 3,
      hookIntent: "compulsion",
      genericHook: true,
    },
    {
      build: (s) => `is it really still about ${s.topicNoun}`,
      voiceProfiles: ["self_aware", "soft_confessional", "dry_humor"],
      rigidityScore: 3,
      sharpnessScore: 3,
      hookIntent: "compulsion",
      skeletonId: "is_it_really_still_about",
    },
    {
      build: (s) => `what if ${s.topicNoun} was the answer all along`,
      voiceProfiles: ["poetic", "self_aware", "dry_humor"],
      rigidityScore: 4,
      sharpnessScore: 2,
      hookIntent: "compulsion",
      skeletonId: "what_if_answer",
      allowedNounTypes: ["object", "abstract"] as const,
    },
    {
      build: (s) => `how many days of pretending about ${s.topicNoun}`,
      voiceProfiles: ["soft_confessional", "self_aware", "deadpan"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "compulsion",
      skeletonId: "how_many_days_pretending",
      allowedNounTypes: ["object", "abstract", "action", "event"] as const,
    },
  ],
  instruction: [
    {
      build: (s) => `how to avoid ${s.topicNoun} in three steps`,
      voiceProfiles: ["sarcastic", "dry_humor", "chaotic"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "compulsion",
      skeletonId: "how_to_avoid_three_steps",
      allowedNounTypes: ["object", "place", "event", "person"] as const,
    },
    {
      build: (s) => `pro tip: skip ${s.topicNoun} today`,
      voiceProfiles: ["sarcastic", "blunt", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "compulsion",
      skeletonId: "pro_tip_skip",
      allowedNounTypes: ["object", "place", "event", "person"] as const,
    },
    {
      build: (s) => `tutorial: how to ignore ${s.topicNoun} forever`,
      voiceProfiles: ["sarcastic", "chaotic", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "compulsion",
      skeletonId: "tutorial_ignore",
      allowedNounTypes: ["object", "place", "event", "person"] as const,
    },
    {
      build: () => `step one: stare. step two: leave.`,
      voiceProfiles: ["deadpan", "dry_humor", "sarcastic"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "compulsion",
      genericHook: true,
    },
    {
      build: () => `lesson one: do less, see what happens`,
      voiceProfiles: ["deadpan", "soft_confessional", "dry_humor"],
      rigidityScore: 4,
      sharpnessScore: 2,
      hookIntent: "compulsion",
      genericHook: true,
    },
    {
      build: (s) => `today's reminder: ${s.topicNoun} is allowed to wait`,
      voiceProfiles: ["poetic", "self_aware", "soft_confessional"],
      rigidityScore: 3,
      sharpnessScore: 3,
      hookIntent: "relatable",
      skeletonId: "todays_reminder_wait",
      allowedNounTypes: ["object", "abstract", "event", "action"] as const,
    },
  ],
  micro_story: [
    {
      build: (s) => `open ${s.topicNoun}, stare, close it, walk away`,
      voiceProfiles: ["deadpan", "dry_humor", "blunt"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "relatable",
      skeletonId: "open_stare_close",
      allowedNounTypes: ["object"] as const,
    },
    {
      build: (s) =>
        `looked at ${s.topicNoun}, did nothing, continued scrolling`,
      voiceProfiles: ["deadpan", "dry_humor", "blunt"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "relatable",
      skeletonId: "looked_did_nothing_scrolling",
      allowedNounTypes: ["object", "place", "abstract", "event", "action"] as const,
    },
    {
      build: () => `I open it, glance, close it, pretend that counted`,
      voiceProfiles: ["self_aware", "dry_humor", "deadpan"],
      rigidityScore: 2,
      sharpnessScore: 5,
      hookIntent: "relatable",
      genericHook: true,
    },
    {
      build: (s) => `walks past ${s.topicNoun}, nods, keeps walking`,
      voiceProfiles: ["deadpan", "dry_humor", "blunt"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "relatable",
      skeletonId: "walks_past_nods",
      allowedNounTypes: ["place", "object", "person"] as const,
    },
    {
      build: (s) => `spent five minutes preparing to think about ${s.topicNoun}`,
      voiceProfiles: ["soft_confessional", "self_aware", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "relatable",
      skeletonId: "prep_to_think",
      allowedNounTypes: ["object", "abstract", "event", "person"] as const,
    },
    {
      build: (s) => `stood near ${s.topicNoun} like a forgotten ghost`,
      voiceProfiles: ["poetic", "soft_confessional", "deadpan"],
      rigidityScore: 3,
      sharpnessScore: 3,
      hookIntent: "relatable",
      skeletonId: "stood_near_ghost",
      allowedNounTypes: ["place", "object"] as const,
    },
    // Phase 3 PART 1 NARRATIVE additions — short two-beat micro-stories.
    // Period mid-string triggers the +3 scrollStop fragment boost.
    {
      build: () => `i opened it. then closed it.`,
      voiceProfiles: ["deadpan", "dry_humor", "blunt"],
      rigidityScore: 4,
      sharpnessScore: 4,
      hookIntent: "relatable",
      genericHook: true,
    },
    {
      build: () => `i started. then stopped.`,
      voiceProfiles: ["deadpan", "blunt", "dry_humor"],
      rigidityScore: 4,
      sharpnessScore: 5,
      hookIntent: "relatable",
      genericHook: true,
    },
    {
      build: () => `i saw it. walked away.`,
      voiceProfiles: ["deadpan", "dry_humor", "blunt"],
      rigidityScore: 4,
      sharpnessScore: 5,
      hookIntent: "relatable",
      genericHook: true,
    },
    // ----------------------------------------------------------------
    // Phase 6D — premise entries for the question bucket. Phase 6C
    // shipped premise spreads into 4 of 5 hookLanguageStyle buckets
    // (confession / observation / matter_of_fact / comparison) but
    // left `question` empty, so EVERY question-style slot's
    // `tryPremiseFirst` walk (~85% of slots per
    // PREMISE_FIRST_BUCKET_PCT) starved on the premise pass and fell
    // through to legacy passes — pinning premise share at ~60% even
    // after Phase 6D's catalog growth (50 styles × 3-5 executions).
    // Spreading all 50 styles here mirrors the 4 existing per-bucket
    // spreads (one call per parentBucket so each style keeps its
    // native intent + tone family) and lifts question slots into the
    // same premise-first regime as the other 4 buckets. Style
    // overlap with other buckets is safe — the within-batch HARD
    // `premiseStyleId` guard (Phase 6C) AND the within-batch HARD
    // `(premiseStyleId, executionId)` tuple guard (Phase 6D) both
    // prevent any duplicate from shipping in a single batch.
    // ----------------------------------------------------------------
    ...buildPremiseEntriesFromDefs(
      [
        "self_roast_reactor",
        "relatable_pain",
        "fake_confidence",
        "hypocrisy_hyperdrive",
        "self_destruction_speedrun",
        "self_sabotage_scrollstop",
        "chaos_confession",
        "doomscroll_disclosure",
        "fomo_fracture",
        "procrastination_paradox",
        "manifestation_mockery",
        "group_chat_guilt",
        "dream_disappointment",
        "plant_parent_psychosis",
        "cart_autopsy",
        "lazy_genius",
        "todo_termination",
      ],
      "relatable",
      ["self_aware", "soft_confessional", "dry_humor"],
    ),
    ...buildPremiseEntriesFromDefs(
      [
        "pattern_exposure",
        "contrast_catastrophe",
        "mundane_meltdown",
        "fridge_judgment",
        "everyday_armageddon",
        "weekly_wipeout",
        "comic_relief_cataclysm",
        "three_am_spiral",
        "main_character_meltdown",
        "dopamine_denial",
        "social_battery_sabotage",
      ],
      "compulsion",
      ["dry_humor", "deadpan", "self_aware"],
    ),
    ...buildPremiseEntriesFromDefs(
      [
        "inner_demon",
        "micro_trauma",
        "anxiety_paradox",
        "anxiety_avalanche",
        "burnout_betrayal",
        "delusion_downfall",
        "delusion_spiral",
        "confidence_crash",
        "pain_point_precision",
        "adulting_betrayal",
        "rage_resonance",
      ],
      "scroll_stop",
      ["blunt", "deadpan", "dry_humor"],
    ),
    ...buildPremiseEntriesFromDefs(
      [
        "duality_clash",
        "overdramatic_reframe",
        "expectation_collapse",
        "irony_flip",
        "irony_implosion",
        "whiplash_wisdom",
        "collapse_core",
        "absurd_escalation",
        "metaphor_mayhem",
        "cringe_trigger",
        "boundary_backfire",
      ],
      "scroll_stop",
      ["dry_humor", "deadpan", "blunt"],
    ),
  ],
  comparison: [
    {
      build: (s) => `morning me with ${s.topicNoun} vs night me`,
      voiceProfiles: ["dry_humor", "self_aware", "sarcastic"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "relatable",
      skeletonId: "morning_me_vs_night_me",
      allowedNounTypes: ["object", "abstract", "action"] as const,
    },
    {
      build: (s) => `theory vs reality with ${s.topicNoun}`,
      voiceProfiles: ["dry_humor", "sarcastic", "self_aware"],
      rigidityScore: 4,
      sharpnessScore: 3,
      hookIntent: "relatable",
      skeletonId: "theory_vs_reality",
      allowedNounTypes: ["object", "abstract", "action", "event"] as const,
    },
    {
      build: () => `me at 9am vs me at 9pm`,
      voiceProfiles: ["dry_humor", "self_aware", "deadpan", "sarcastic"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "relatable",
      genericHook: true,
    },
    {
      build: (s) => `plans about ${s.topicNoun} vs reality`,
      voiceProfiles: ["dry_humor", "sarcastic", "deadpan"],
      rigidityScore: 4,
      sharpnessScore: 2,
      hookIntent: "relatable",
      skeletonId: "plans_vs_reality",
      allowedNounTypes: ["object", "abstract", "event", "action"] as const,
    },
    {
      build: (s) => `planner me vs actual me on ${s.topicNoun}`,
      voiceProfiles: ["soft_confessional", "self_aware", "poetic"],
      rigidityScore: 3,
      sharpnessScore: 3,
      hookIntent: "relatable",
      skeletonId: "planner_vs_version_me",
      allowedNounTypes: ["object", "abstract", "event", "action"] as const,
    },
    {
      // Phase 3 HOOK TEMPLATE TUNING — rewrite of broken
      // "future me's ${s.topicNoun} vs current me's" (the trailing
      // "current me's" had no possessed noun, producing ungrammatical
      // surface like "future me's gym vs current me's"). New shape
      // keeps the same future-vs-current observer device but reads
      // as a complete grammatical thought regardless of topicNoun.
      build: (s) => `future me thinks about ${s.topicNoun}, current me does not`,
      voiceProfiles: ["self_aware", "deadpan", "soft_confessional"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "relatable",
      skeletonId: "future_vs_current_thinks",
      allowedNounTypes: ["object", "abstract", "event"] as const,
    },
    // Phase 6 BIG PREMISE additions — CONTRAST_DUALITY premises
    // in the comparison bucket (explicit two-side framings).
    {
      build: () => `the planner version versus the chaos version`,
      voiceProfiles: ["dry_humor", "sarcastic", "deadpan"],
      rigidityScore: 1,
      sharpnessScore: 5,
      hookIntent: "scroll_stop",
      bigPremise: true,
      premiseStyle: "contrast_duality",
      premiseStyleId: "duality_clash",
      executionId: "expectation_collapse",
    },
    {
      build: () => `yesterday me booked chaos for today me's calendar`,
      voiceProfiles: ["dry_humor", "sarcastic", "deadpan"],
      rigidityScore: 1,
      sharpnessScore: 5,
      hookIntent: "scroll_stop",
      bigPremise: true,
      premiseStyle: "contrast_duality",
      premiseStyleId: "duality_clash",
      executionId: "chaos_acceptance",
    },
  ],
  object_pov: [
    {
      build: (s) => `${s.topicNoun} watching me decide nothing again`,
      voiceProfiles: ["dry_humor", "poetic", "self_aware"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
      skeletonId: "noun_watching_decide",
      allowedNounTypes: ["object", "abstract"] as const,
    },
    {
      build: (s) => `${s.topicNoun}, sitting there, fully aware of everything`,
      voiceProfiles: ["poetic", "dry_humor", "deadpan"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
      skeletonId: "noun_sitting_aware",
      allowedNounTypes: ["object"] as const,
    },
    {
      build: (s) => `${s.topicNoun} keeps the score so nothing escapes`,
      voiceProfiles: ["poetic", "dry_humor", "blunt"],
      rigidityScore: 3,
      sharpnessScore: 3,
      hookIntent: "scroll_stop",
      skeletonId: "noun_keeps_score",
      allowedNounTypes: ["object", "abstract"] as const,
    },
    {
      build: (s) => `${s.topicNoun} taking notes about my life again`,
      voiceProfiles: ["dry_humor", "sarcastic", "chaotic"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
      skeletonId: "noun_taking_notes",
      allowedNounTypes: ["object", "abstract"] as const,
    },
    {
      build: (s) => `${s.topicNoun} has seen things, ${s.topicNoun} is tired`,
      voiceProfiles: ["poetic", "soft_confessional", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
      skeletonId: "noun_seen_tired",
      allowedNounTypes: ["object", "abstract", "place"] as const,
    },
    {
      build: (s) => `${s.topicNoun} is smug about today, frankly`,
      voiceProfiles: ["sarcastic", "chaotic", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
      skeletonId: "noun_smug",
      allowedNounTypes: ["object", "abstract"] as const,
    },
    {
      build: (s) => `${s.topicNoun} just observing the disaster quietly`,
      voiceProfiles: ["dry_humor", "soft_confessional", "deadpan"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
      skeletonId: "just_observing_disaster",
      allowedNounTypes: ["object", "abstract"] as const,
    },
  ],
  time_stamp: [
    {
      build: (s) => `11:48pm and I'm still negotiating with ${s.topicNoun}`,
      voiceProfiles: ["soft_confessional", "self_aware", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 5,
      hookIntent: "scroll_stop",
      skeletonId: "timestamp_negotiating",
      allowedNounTypes: ["object", "abstract", "event", "body_state", "place"] as const,
    },
    {
      build: (s) => `7am plan: ${s.actionShort}`,
      voiceProfiles: ["blunt", "deadpan", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
      skeletonId: "morning_plan_action",
    },
    {
      build: (s) => `it's tuesday and ${s.topicNoun} has not moved`,
      voiceProfiles: ["deadpan", "dry_humor", "blunt"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
      skeletonId: "weekday_not_moved",
      allowedNounTypes: ["object", "place", "event"] as const,
    },
    {
      build: (s) => `12:14am: still in standoff with ${s.topicNoun}`,
      voiceProfiles: [
        "soft_confessional",
        "self_aware",
        "dry_humor",
        "deadpan",
      ],
      rigidityScore: 2,
      sharpnessScore: 5,
      hookIntent: "scroll_stop",
      skeletonId: "timestamp_standoff",
      allowedNounTypes: ["object", "abstract", "event", "place", "body_state"] as const,
    },
    {
      build: (s) => `monday and ${s.topicNoun} is winning, news at eleven`,
      voiceProfiles: ["sarcastic", "dry_humor", "chaotic"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
      skeletonId: "weekday_news_at_eleven",
      allowedNounTypes: ["object", "abstract", "event", "body_state"] as const,
    },
    {
      build: (s) => `3pm and ${s.topicNoun} is somehow louder`,
      voiceProfiles: ["poetic", "soft_confessional", "self_aware"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
      skeletonId: "afternoon_louder",
      allowedNounTypes: ["object", "abstract", "event"] as const,
    },
    // Phase 3 PART 1 TIMESTAMP additions — pure timestamp + status
    // fragments. Each contains a digit (highly specific +1 boost) and
    // a mid-string period (fragment boost).
    {
      // Phase 3D BUG B — tagged so the cross-batch skeleton cap and
      // the rewriter's two-pass walk both see this static-timestamp
      // template. The exact-hook string set in
      // `noveltyContext.recentHookStrings` provides a belt-and-braces
      // guard against re-shipping identical text even if a future
      // skeleton-id change accidentally untagged it again.
      skeletonId: "static_timestamp_still_here",
      build: () => `9:14pm. still here.`,
      voiceProfiles: ["soft_confessional", "dry_humor", "deadpan"],
      rigidityScore: 2,
      sharpnessScore: 5,
      hookIntent: "scroll_stop",
      genericHook: true,
    },
    {
      build: () => `2 hours later. nothing.`,
      voiceProfiles: ["blunt", "deadpan", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 5,
      hookIntent: "scroll_stop",
      genericHook: true,
    },
    {
      build: () => `midnight. no progress.`,
      voiceProfiles: ["soft_confessional", "deadpan", "blunt"],
      rigidityScore: 2,
      sharpnessScore: 5,
      hookIntent: "scroll_stop",
      genericHook: true,
    },
    {
      build: () => `day 3. nothing changed.`,
      voiceProfiles: ["blunt", "deadpan", "soft_confessional"],
      rigidityScore: 2,
      sharpnessScore: 5,
      hookIntent: "scroll_stop",
      genericHook: true,
    },
    // ----------------------------------------------------------------
    // Phase 6 EXPANSION — deadpan / blunt premise hooks (11 styles ×
    // ~2 examples). `scroll_stop` intent matches the matter_of_fact
    // bucket's role as the high-impact opener slot.
    // ----------------------------------------------------------------
    ...buildPremiseEntriesFromDefs(
      [
        "inner_demon",
        "micro_trauma",
        "anxiety_paradox",
        "anxiety_avalanche",
        "burnout_betrayal",
        "delusion_downfall",
        "delusion_spiral",
        "confidence_crash",
        "pain_point_precision",
        "adulting_betrayal",
        "rage_resonance",
      ],
      "scroll_stop",
      ["blunt", "deadpan", "dry_humor"],
    ),
  ],
  anti_hook: [
    {
      build: (s) => `anyway, ${s.topicNoun}`,
      voiceProfiles: ["deadpan", "dry_humor", "blunt"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
      skeletonId: "anyway_noun",
    },
    {
      build: (s) => `not great with ${s.topicNoun} today`,
      voiceProfiles: ["deadpan", "soft_confessional", "dry_humor"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
      skeletonId: "not_great_with_today",
    },
    {
      build: (s) => `so. ${s.topicNoun}.`,
      voiceProfiles: ["deadpan", "blunt", "dry_humor"],
      rigidityScore: 3,
      sharpnessScore: 5,
      hookIntent: "scroll_stop",
      skeletonId: "so_noun",
    },
    {
      build: (s) => `here we are with ${s.topicNoun}`,
      voiceProfiles: ["deadpan", "soft_confessional", "dry_humor"],
      rigidityScore: 3,
      sharpnessScore: 3,
      hookIntent: "scroll_stop",
      skeletonId: "here_we_are_with",
    },
    {
      build: (s) => `${s.topicNoun}. that's the whole post.`,
      voiceProfiles: ["sarcastic", "chaotic", "deadpan", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 5,
      hookIntent: "scroll_stop",
      skeletonId: "whole_post_noun",
    },
    {
      build: (s) => `${s.topicNoun} and a quiet kind of nothing`,
      voiceProfiles: ["poetic", "soft_confessional", "deadpan"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
      skeletonId: "quiet_kind_of_nothing",
      allowedNounTypes: ["place", "event", "body_state", "abstract", "object"] as const,
    },
    {
      build: (s) => `introducing: ${s.topicNoun} again, shockingly`,
      voiceProfiles: ["sarcastic", "self_aware", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
      skeletonId: "introducing_again",
    },
    // Phase 3 PART 1 FRAGMENT additions (spec PART 5 PRIMARY voice).
    // 2-3 word interruptions / mid-action thoughts. validateHook word
    // floor was lowered 3 → 2 specifically to admit these. Each is
    // scenario-agnostic so it reads as a raw thought, not a frame.
    {
      build: () => `again. seriously.`,
      voiceProfiles: ["deadpan", "blunt"],
      rigidityScore: 3,
      sharpnessScore: 5,
      hookIntent: "scroll_stop",
      genericHook: true,
    },
    {
      build: () => `still nothing.`,
      voiceProfiles: ["deadpan", "blunt", "soft_confessional"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
      genericHook: true,
    },
    {
      build: () => `this is it?`,
      voiceProfiles: ["deadpan", "sarcastic", "dry_humor"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
      genericHook: true,
    },
    {
      build: () => `immediately no.`,
      voiceProfiles: ["blunt", "deadpan", "dry_humor"],
      rigidityScore: 3,
      sharpnessScore: 5,
      hookIntent: "scroll_stop",
      genericHook: true,
    },
    {
      build: () => `yep. still stuck.`,
      voiceProfiles: ["dry_humor", "deadpan", "soft_confessional"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
      genericHook: true,
    },
    {
      build: () => `not happening today.`,
      voiceProfiles: ["blunt", "deadpan", "sarcastic"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
      genericHook: true,
    },
    // Phase 6 BIG PREMISE additions — short fragment premises that
    // fit the anti_hook bucket's "abrupt fragment" voice.
    {
      build: () => `joke's on me. again.`,
      voiceProfiles: ["dry_humor", "deadpan", "self_aware"],
      rigidityScore: 1,
      sharpnessScore: 5,
      hookIntent: "scroll_stop",
      bigPremise: true,
      premiseStyle: "self_roast",
      premiseStyleId: "self_roast_reactor",
      executionId: "understatement",
    },
    {
      build: () => `truly humiliating turn of events`,
      voiceProfiles: ["sarcastic", "blunt", "deadpan"],
      rigidityScore: 1,
      sharpnessScore: 5,
      hookIntent: "scroll_stop",
      bigPremise: true,
      premiseStyle: "over_dramatization",
      premiseStyleId: "overdramatic_reframe",
      executionId: "understatement",
    },
  ],
  escalation_hook: [
    {
      build: (s) => `started with ${s.topicNoun}, ended somewhere worse`,
      voiceProfiles: ["chaotic", "sarcastic", "self_aware"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "compulsion",
      skeletonId: "started_ended_worse",
      allowedNounTypes: ["object", "action", "event"] as const,
    },
    {
      build: (s) => `tried to handle ${s.topicNoun}, did the opposite`,
      voiceProfiles: ["chaotic", "sarcastic", "self_aware", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "compulsion",
      skeletonId: "tried_did_opposite",
      allowedNounTypes: ["object", "abstract", "action", "event"] as const,
    },
    {
      build: (s) => `one job around ${s.topicNoun}, you can guess`,
      voiceProfiles: ["sarcastic", "dry_humor", "chaotic"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "compulsion",
      skeletonId: "one_job_guess",
      allowedNounTypes: ["object", "abstract", "action"] as const,
    },
    {
      build: (s) =>
        `${s.topicNoun} started small, this is no longer small`,
      voiceProfiles: ["chaotic", "sarcastic", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "compulsion",
      skeletonId: "started_small_no_longer",
      allowedNounTypes: ["object", "place", "abstract", "event", "action", "body_state"] as const,
    },
    {
      build: (s) => `${s.topicNoun} went from small to entire personality`,
      voiceProfiles: ["chaotic", "sarcastic", "self_aware"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "compulsion",
      skeletonId: "small_to_personality",
      allowedNounTypes: ["object", "abstract"] as const,
    },
    {
      // Phase 3 HOOK TEMPLATE TUNING — typo fix "its" → "it's"
      // (the prior surface "now its hostage" used a possessive where
      // a contraction was meant; "now it's hostage" reads as the
      // intended "now it is being held hostage" admission).
      build: (s) => `thought I'd manage ${s.topicNoun}, now it's hostage`,
      voiceProfiles: ["chaotic", "dry_humor", "soft_confessional"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "compulsion",
      skeletonId: "manage_now_hostage",
      allowedNounTypes: ["object", "abstract"] as const,
    },
    {
      build: (s) => `${s.topicNoun} ate my afternoon, peacefully`,
      voiceProfiles: ["poetic", "chaotic", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "compulsion",
      skeletonId: "ate_afternoon",
      allowedNounTypes: ["object", "abstract", "event"] as const,
    },
    {
      build: (s) => `started managing ${s.topicNoun}, now we live together`,
      voiceProfiles: ["poetic", "soft_confessional", "deadpan"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "compulsion",
      skeletonId: "manage_live_together",
      allowedNounTypes: ["object", "abstract"] as const,
    },
    // ----------------------------------------------------------------
    // Phase 6 EXPANSION — fragment / contrast / duality premise hooks
    // (11 styles × ~2 examples). `scroll_stop` intent matches the
    // anti_hook bucket's role as the surprise-cut opener slot.
    // ----------------------------------------------------------------
    ...buildPremiseEntriesFromDefs(
      [
        "duality_clash",
        "overdramatic_reframe",
        "expectation_collapse",
        "irony_flip",
        "irony_implosion",
        "whiplash_wisdom",
        "collapse_core",
        "absurd_escalation",
        "metaphor_mayhem",
        "cringe_trigger",
        "boundary_backfire",
      ],
      "scroll_stop",
      ["dry_humor", "deadpan", "blunt"],
    ),
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
   * PHASE Y6 — deterministic `sf_*` scenario fingerprint. Optional
   * here because pattern_variation candidates don't yet compute
   * one (Y8 will extend the fingerprinter to cover the pattern
   * arm). Declared on both arms of `CandidateMeta` so the
   * `core_native` author can spread its meta + add the field
   * without the union widening to the pattern arm and erroring on
   * an unknown property.
   */
  scenarioFingerprint?: string;
  /**
   * PHASE Y7 — voice cluster id resolved by `resolveVoiceCluster`
   * for `core_native` candidates. Optional here because
   * pattern_variation candidates don't go through the resolver
   * (they pick voice via the existing pattern-arm mechanism).
   * Declared on both arms of `CandidateMeta` for the same reason
   * as `scenarioFingerprint` above — so the `core_native` author
   * can spread its meta + add the field without the union
   * widening to the pattern arm and erroring on an unknown
   * property.
   */
  voiceClusterId?: import("./voiceClusters").VoiceClusterId;
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
   *
   * Phase 1 update: scriptType is now INERT TELEMETRY ONLY. The
   * narrative-shape axis active in the selector is `ideaCoreType` /
   * `ideaCoreFamily` below. scriptType is kept populated so the
   * IDEA ARCHETYPE derivation chain (resolveArchetypeLoose) and
   * historical cache compatibility continue to work, but no batch
   * guard / penalty / boost / rescue reads it any more.
   */
  scriptType?: ScriptType;
  /**
   * IdeaCoreType / IdeaCoreFamily — narrative-FAMILY diversity axis
   * (Phase 1 replacement for scriptType). Resolved at assembly time
   * BEFORE the hook is generated via `resolveIdeaCoreType(template,
   * family)`; family falls out of the type via
   * `resolveIdeaCoreFamily`. Always set on pattern_variation
   * candidates. Drives:
   *   - HARD batch guards: ≤2 per family, ≤1 per exact type,
   *     `failure_contradiction` < 40% of batch.
   *   - Cross-batch novelty: -3 family ∈ recent (last batch),
   *     -2 family ∈ frequent in last 3, +3 family unused in last 3.
   *   - Pool caps + interleave: family-first ordering so the top of
   *     the pool spans 6+ distinct families.
   *   - Regen rescue: ≥2 NEW families vs the immediate-prior batch.
   *
   * Optional on the type so Claude/Llama fallback wraps can omit
   * when the family/templateId aren't in our taxonomy; readers fall
   * back to `lookupIdeaCoreType(family, templateId)` and treat
   * unresolvable as "no contribution to the ideaCoreType axis".
   */
  ideaCoreType?: IdeaCoreType;
  ideaCoreFamily?: IdeaCoreFamily;
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
  /**
   * TREND CONTEXT LAYER (lightweight) — id of the curated trend item
   * injected into this candidate's caption, when one fired. Set ONLY
   * when (a) the deterministic 30%-bucket gate passed, (b) a trend
   * exists whose `compatibleFamilies` + `compatibleArchetypeFamilies`
   * include this candidate's `(scenarioFamily, archetypeFamily)`, and
   * (c) `applyTrendToCaption` produced a string that survives the
   * substring validator chain (banned-prefix / generic-filler /
   * voice-violation). Soft skip otherwise — the candidate STILL
   * ships, just without the trend tag (no whole-batch rejection).
   *
   * Drives the cross-batch -2 novelty penalty in `selectionPenalty`
   * (immediate-prior batch only) so the same trend doesn't dominate
   * back-to-back batches. Read by `buildNoveltyContext` directly from
   * the JSONB cache envelope (first-class field — no derivation).
   *
   * Optional EVERYWHERE — legacy entries written before the trend
   * layer shipped will have `trendId === undefined`, and selectors
   * MUST treat that as "no contribution to the trend axis" (same
   * discipline as `archetype` / `voiceProfile` fallback paths).
   * Resolves to a `TrendItem` via `TREND_BY_ID[trendId]`.
   */
  trendId?: string;
  /**
   * TREND + ARCHETYPE PAIRING spec — pre-trend caption snapshot
   * captured by `assembleCandidate` ONLY when a trend was injected
   * (paired 1-to-1 with `trendId`). Read by `enforceTrendCap` in
   * `hybridIdeator` to revert the caption when the within-batch
   * HARD CAP fires (≤ N-1 trend-injected per N-pick batch — the
   * lowest-scoring trended candidate gets its caption reverted +
   * `trendId` cleared, the candidate STILL ships, no batch-level
   * rejection). Always paired with `trendId` — both set together
   * at injection, both cleared together on revert. Not persisted
   * to the cache — runtime-only meta for the cap pass; cache
   * envelope just carries `trendId`.
   */
  originalCaption?: string;
  /**
   * Phase 3 PART 1+3 (HOOK TEMPLATE / SCROLL-STOPPING UPGRADE) —
   * reference to the `LanguagePhrasingEntry` the hook was built
   * from. Read by `scoreScrollStop` (in `ideaScorer`) so the
   * scrollStopScore can apply the rigidity penalty (entry.rigidity
   * >= 4 → -3) and the sharpness boost (entry.sharpness >= 4 →
   * folds into +2 emotional charge) without re-running the catalog
   * lookup.
   *
   * IMPORTANT: this field is RUNTIME-ONLY. The `build` function on
   * the entry will NOT survive JSON serialization to the JSONB
   * cache, but `rigidityScore` + `sharpnessScore` + `voiceProfiles`
   * (the JSON-safe subset) WILL survive, so `getEntryScores` still
   * resolves correctly on rehydrated entries — readers MUST NOT
   * call `.build()` on this field after a cache round-trip; only
   * the score fields are reliable.
   *
   * Optional EVERYWHERE — Claude/Llama fallback wraps + legacy
   * cache entries written before Phase 3 will have it undefined,
   * and `scoreScrollStop(hook, undefined)` is the supported safe
   * path (rigidity penalty + sharpness boost both no-op on
   * absent entry — only intrinsic hook properties contribute).
   */
  sourceLanguagePhrasing?: LanguagePhrasingEntry;
  /**
   * Phase 4 (HOOK INTENT) — the intent of the entry that ACTUALLY won
   * the picker, NOT the slot's `assignedIntent` (which is only honored
   * when an intent-matching entry validated for the scenario). Always
   * set on pattern_variation candidates (the assembler reads it via
   * `getEntryIntent(picked.entry)`). The selector / batch guard / per-
   * intent scorer all read this field; readers MUST treat undefined as
   * "no contribution to intent axis" (legacy cache entries written
   * before Phase 4 won't have it, and Claude/Llama fallback wraps may
   * omit) — same fallback discipline as `archetype` / `voiceProfile`.
   * The dispatch in `scoreHookIntent(hook, intent ?? "scroll_stop", …)`
   * defaults absent intent to `scroll_stop` to preserve Phase 3
   * scoring semantics for legacy reads.
   */
  hookIntent?: HookIntent;
  /**
   * Phase 4 (HOOK INTENT) — true ONLY when the slot was assigned a
   * specific intent but the picker had to fall back to an entry of a
   * DIFFERENT intent (no intent-matching entry validated for the
   * scenario). Telemetry-only — used by the QA driver to count true
   * intent starvation events. Optional + defaults to false on legacy
   * cache reads. Does NOT affect scoring or batch guards.
   */
  intentFallback?: boolean;
  /**
   * Phase 5 (PATTERN MAPPING LAYER) — the typed VideoPattern axis the
   * candidate commits to. Resolved at assembly time AFTER ideaCoreFamily
   * and hookIntent are known via pickVideoPattern(family, intent,
   * recentPatternsInPool, seed). Always set on Phase-5 pattern_variation
   * candidates. Optional on the type so pre-Phase-5 cached candidates
   * + Claude/Llama fallback wraps round-trip cleanly — readers MUST
   * treat absent as "no contribution to the video-pattern axis" (same
   * discipline as voiceProfile / trendId). Drives:
   *   - HARD batch guard h2: ≤2 picks share videoPattern per batch.
   *   - selectionPenalty: -3 per duplicate in batchSoFar (same lever
   *     as the existing hookIntent dup penalty).
   *   - Cross-batch novelty via NoveltyContext.recentVideoPatterns.
   */
  videoPattern?: VideoPattern;
  /**
   * Phase 5 telemetry — true ONLY when pickVideoPattern fell back to
   * family-only because no family-allowed pattern was intent-compat
   * for the slot's hookIntent. By construction across the full
   * 12-family × 3-intent Cartesian the intersection is never empty
   * (verified by the QA driver), so this is paranoia for future
   * families/intents added without re-validating
   * PATTERN_X_INTENT_COMPAT. Telemetry-only — does NOT affect scoring
   * or batch guards.
   */
  videoPatternIntentFallback?: boolean;
  /**
   * Phase 6B — true when the chosen `videoPattern` was filtered through
   * `PREMISESTYLE_TO_PATTERN_MAP[premiseStyleId]` (style → pattern
   * alignment overlay applied on top of family ∩ intent). Absent /
   * false when:
   *   - the entry has no `premiseStyleId` (legacy / Llama / fallback)
   *   - the style's compat list has zero overlap with family ∩ intent
   *     (alignment skipped, family/intent path used UNCHANGED)
   * Telemetry-only — does NOT affect scoring or batch guards. The QA
   * driver counts hit/miss rate per style to validate the routing
   * actually fires for the premise share.
   */
  videoPatternPremiseStyleAligned?: boolean;
  /**
   * Phase 3 HOOK TEMPLATE TUNING — stable identifier for the chosen
   * `LanguagePhrasingEntry`'s formulaic skeleton (e.g. "todays_update",
   * "manage_now_hostage"). Set ONLY when the picked entry carries a
   * `skeletonId` (formulaic templates only); undefined for entries
   * whose phrasing is genuinely scenario-shaped. Drives:
   *   - within-batch -3 in `selectionPenalty` (parallels the
   *     `videoPattern` dup lever).
   *   - cross-batch tiered demotion in `selectionPenalty`: -3 if it
   *     appeared in the immediate-prior batch, additional -2 stack if
   *     it appeared in ≥2 of the last 3 batches.
   * Persisted on cache via `CachedBatchEntry.hookSkeletonId` so the
   * cross-batch lever survives the JSONB round-trip.
   * Readers MUST treat absent as "no contribution to the skeleton
   * axis" (same discipline as `videoPattern` / `voiceProfile`).
   */
  hookSkeletonId?: string;
  /**
   * Phase 6 (BIG PREMISE LAYER) — true when the WINNING
   * `LanguagePhrasingEntry` carried `bigPremise: true` (a complete
   * scenario-AGNOSTIC premise hook that passed BOTH `validateHook`
   * AND the additional `validateBigPremise` rail). Telemetry only;
   * the selector reads `bigPremiseStyle` (below) for the within-
   * batch + cross-batch novelty levers. Optional / defaults to
   * undefined for entries that fell through to the legacy template
   * flow — undefined is treated as "no contribution to the premise
   * axis" everywhere downstream.
   */
  usedBigPremise?: boolean;
  /**
   * Phase 6 — which of the 5 premise styles the WINNING entry
   * expressed (set ONLY when the picked entry carried both
   * `bigPremise: true` AND `premiseStyle`). Persisted on cache via
   * `CachedBatchEntry.bigPremiseStyle` so the cross-batch -2 lever
   * in `selectionPenalty` survives the JSONB round-trip. Readers
   * MUST treat absent as "no contribution to the premise-style
   * axis" (same discipline as `hookSkeletonId` / `videoPattern`).
   */
  bigPremiseStyle?: BigPremiseStyle;
  /**
   * Phase 6 EXPANSION (PREMISE STYLE ENGINE) — fine-grained 50-style
   * id mirroring `LanguagePhrasingEntry.premiseStyleId`. Set ONLY
   * when the picked entry carried both `bigPremise: true` AND
   * `premiseStyleId` (every Phase 6 EXPANSION entry; the original 29
   * hand-written premise entries leave this undefined and only
   * contribute to the bucket-level `bigPremiseStyle` lever above).
   * Persisted on cache via `CachedBatchEntry.premiseStyleId` so the
   * cross-batch -2 lever in `selectionPenalty` survives JSONB round-
   * trip. Readers MUST treat absent as "no contribution to the
   * fine-grained premise-style axis" (same discipline as
   * `bigPremiseStyle` / `hookSkeletonId` / `videoPattern`).
   */
  premiseStyleId?: PremiseStyleId;
  /**
   * Phase 6 EXPANSION — display label paired with `premiseStyleId`
   * (e.g. "Self-Roast Reactor" for `self_roast_reactor`). Resolved
   * from `PREMISE_STYLE_LABELS` at `assembleCandidate` time and
   * surfaced in spec OUTPUT METADATA so downstream readers (QA
   * driver / future telemetry) can render human-readable style names
   * without re-importing the catalog. NOT persisted on the cache —
   * it's a derived value that can always be recomputed from the
   * canonical `premiseStyleId` via `PREMISE_STYLE_LABELS[id]`. Same
   * persistence discipline as `trendCaptionPreSnapshot` in
   * `CandidateMeta` — runtime-only meta, cache carries only the id.
   */
  premiseStyleLabel?: string;
  /**
   * Phase 6D (PREMISE EXECUTION EXPANSION) — fine-grained execution-
   * pattern id mirroring the same field on `LanguagePhrasingEntry`.
   * Set ONLY when `assembleCandidate`'s sourceLanguagePhrasing carried
   * an `executionId` (i.e. the picked entry was generated from
   * `PREMISE_STYLE_DEFS[id].executions[*]`). Optional / undefined for
   * legacy template entries + Llama / Claude fallback wraps + the
   * original 29 hand-written premise entries (no fine-grained
   * execution tag). Persisted on cache via
   * `CachedBatchEntry.executionId` so the cross-batch -2 / +2 levers
   * in `selectionPenalty` survive JSONB round-trip. Readers MUST
   * treat absent as "no contribution to the fine-grained execution
   * axis" (same discipline as `premiseStyleId` / `hookSkeletonId` /
   * `videoPattern`).
   */
  executionId?: string;
  /**
   * PHASE Y3 (LOCAL premiseCoreId TAGGING) — synthesized core id
   * resolved from `(premiseStyleId, executionId)` via the
   * `premiseCoreLocalMapping` deterministic lookup. Set ONLY when
   * the picked entry carried `bigPremise === true` AND both
   * `premiseStyleId` AND `executionId` AND the pair maps
   * unambiguously to one core. Ambiguous pairs / legacy / Llama
   * wraps leave this undefined — telemetry surfaces unmapped
   * premium hooks via `localPremiseCoreUnmappedCount` /
   * `topUnmappedPremiseHooks` on the `hybrid_ideator.served` log.
   *
   * Mirrored to `idea.premiseCoreId` in the same `assembleCandidate`
   * pass so `buildNoveltyContext`'s existing `e.idea.premiseCoreId`
   * read site (added in PHASE Y2 for Layer-3 Claude candidates)
   * picks up local-tagged entries automatically — no envelope-shape
   * change required, no separate cache-write site (the existing
   * `c.idea` field in `toCacheEntries` carries the value through
   * to JSONB cleanly).
   *
   * NOT a replacement for the Claude core-aware path — that path
   * still picks cores from the full library and ships the chosen
   * id directly. This is a bridge tag that lights up the existing
   * `recentPremiseCoreIds` lever for Layer-1 majority candidates
   * until a future core-native local generator lands.
   */
  premiseCoreId?: string;
  /**
   * Phase 6E (PREMISE COMEDY SCORING + REJECTION) — full
   * PremiseComedyScore for the WINNING entry's hook, computed at
   * picker-walk time AFTER `validateHook` + `validateBigPremise` +
   * `validateOutputLine` pass on the FINAL post-`compressHook` text.
   * Drives:
   *   - HARD reject < 5 at the picker walk (set BEFORE this meta is
   *     materialized — a < 5 hook never reaches PatternMeta because
   *     the walk continues to the next phrasing in seed-rotated
   *     order).
   *   - Scaled selection-layer boost in `selectionPenalty` via
   *     `premiseComedyBoost(meta.premiseComedyScore?.total)` —
   *     replaces Phase 6D's flat +7 lever with a 7→+4, 8→+5, 9→+6,
   *     10→+7, 6→+1, 5→-2 gradient so a strong legacy can beat a
   *     borderline premise per spec PART 6.
   *   - Telemetry surface for the QA driver (PART 8 report).
   * Set ONLY when the picked entry carried `bigPremise === true`
   * (the rubric is a premise-quality gate, not a legacy gate).
   * Optional / undefined for legacy template entries + Llama /
   * Claude fallback wraps that didn't run through the premise
   * picker walk.
   */
  premiseComedyScore?: PremiseComedyScore;
  /**
   * Phase 6F (LEGACY COMEDY SCORING + REJECTION) — symmetric to
   * `premiseComedyScore` above but for legacy template entries
   * (entry.bigPremise !== true). Populated by the picker walk
   * (`pickValidatedPhrasing`) when the WINNING entry is a legacy
   * hook AND the 4-dim 0-10 rubric scored its post-compress /
   * post-validateOutputLine final hook >= 5. Walks that select
   * lower-scoring or rubric-rejected entries `continue` past them
   * in seed-rotated order, so anything attached here has already
   * cleared the HARD-reject bar.
   *
   * Three downstream consumers, all parallel to the premise field:
   *   - `selectionPenalty.legacyComedyBoost` reads
   *     `meta.legacyComedyScore?.total` → scaled lever
   *     (10→+5, 9→+4, 8→+3, 7→+2, 6→0, 5→-3). Lighter band than
   *     `premiseComedyBoost` so the spec PART 6 tie-bias falls out
   *     naturally without a separate "premise wins ties" rule:
   *     premise ≥7 still beats legacy ≥7 by ≥1pt; legacy ≥7 beats
   *     premise ≤6.
   *   - Telemetry surface for the QA driver (PART 8 report).
   *   - Llama re-score guard (T005) re-runs the rubric on polished
   *     legacy hooks so the cached score reflects the final form.
   * Set ONLY when the picked entry carried `bigPremise !== true`
   * (the legacy rubric is a legacy-quality gate, not a premise
   * gate). Optional / undefined for premise entries + Llama /
   * Claude fallback wraps that didn't run through the legacy
   * picker walk; mutually exclusive with `premiseComedyScore`.
   */
  legacyComedyScore?: LegacyComedyScore;
  /**
   * Phase 7 (VIRAL FEEL SCORE) — final ranking polish layer attached
   * to EVERY pattern_variation candidate (premise + legacy alike,
   * symmetric to the comedy scores above which are mutually
   * exclusive). Computed at `assembleCandidate` time AFTER
   * `videoPattern` + the comedy scores are populated, so the
   * formatFit dim can read the resolved style × pattern synergy.
   *
   * Drives a SINGLE downstream consumer:
   *   - Selection-layer scaled boost in `selectionPenalty` via
   *     `viralFeelBoost(meta.viralFeelScore?.total)` — band
   *     (10/9→+3, 8/7→+2, 6/5→+1, <5→0) intentionally LIGHTER than
   *     both premise (`+5..+7`) and legacy (`+5`) comedy ceilings,
   *     so the spec PART 5 invariant ("viral feel never overpowers
   *     comedy") falls out arithmetically: a strong comedy score
   *     always dominates a strong viral score in tie-breaking, and
   *     a weak comedy hook (already past the rubric < 5 HARD reject)
   *     can never be rescued by a high viral feel.
   *
   * Optional / undefined for Llama / Claude fallback wraps and
   * pre-Phase-7 cached candidates that round-trip through JSONB
   * without the field — `viralFeelBoost(undefined) === 0`, so the
   * absent-field path collapses cleanly to a no-op. Same defensive
   * discipline as `legacyComedyScore` / `premiseComedyScore`.
   */
  viralFeelScore?: ViralFeelScore;
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
 * Phase 6C (PREMISE-FIRST SELECTION) — per-slot deterministic gate
 * for the picker's premise-first walk passes. ~80% of slots try
 * premise entries (bigPremise === true) FIRST and only fall back to
 * legacy entries when no premise validates; the remaining ~20% skip
 * directly to legacy passes so the catalog still ships some
 * legacy/simple hooks for "rhythm and variety" per spec PART 1
 * ("Do NOT force 100%. Keep 10–20% legacy/simple hooks for rhythm
 * and variety").
 *
 * Combined with the natural fallback when premise validation fails
 * (validateHook / validateBigPremise / validateOutputLine — see T002),
 * empirical premise share lands in the spec's 80–90% target band:
 *   ~80% slot premise-first × ~100% premise pick rate (when premise
 *   pool has a passing entry) ≈ 80%
 * + ~20% slot legacy-first × ~30% organic premise rate (Phase 6
 *   EXPANSION baseline, since legacy passes still walk premises that
 *   happen to land earlier in the seed rotation) ≈ 6%
 * = ~86% premise share, mid-band.
 *
 * Deterministic per slot via seed hash so cache replay stays stable —
 * same (template, scenario, hookStyle) seed ⇒ same gate decision ⇒
 * same picker outcome.
 */
// Phase 6D — bumped from 85 → 100 (slot-level premise gate). Phase 6C
// shipped 85 to leave ~15% of slots as legacy "rhythm and variety"
// per spec PART 1, but the 6D ≥85% gate empirically pinned premise
// share at ~73-80% even after the question-bucket premise spread
// + L1530 promotion-path disable + intermediate 95 setting. The
// dominant residual leak: every legacy-first slot in the
// reservation bucket ships legacy unconditionally (no premise
// attempt at all), AND ~20% of premise-first slots still fall
// through to legacy when premise candidates fail validation for
// the scenario (validateBigPremise / scenario fit / output line).
// Setting the gate to 100 eliminates the artificial slot-level
// reservation; legacy still ships organically via the
// tryPremiseFirst → fall-through-on-validation-failure path
// (the L7514 "LEGACY passes" block stays the natural escape
// hatch when premise pool exhausts), so the catalog still mixes
// in legacy / simple hooks for "rhythm and variety" — just driven
// by genuine premise-pool exhaustion rather than a fixed quota.
// This honors spec PART 1's "Premise hooks are preferred BY
// DEFAULT, but legacy still wins on superior quality" intent and
// PART 5's "Legacy fallback drops NATURALLY from larger pool (do
// not artificially suppress further)" guidance: the reservation
// itself was the artificial floor on legacy, and removing it
// lets legacy diminish to its natural fallthrough rate.
const PREMISE_FIRST_BUCKET_PCT = 100;

/* ────────────────────────────────────────────────────────────────── */
/* Phase 6E — PREMISE COMEDY SCORING + REJECTION                      */
/*                                                                    */
/* Pure deterministic 0-10 rubric scoring premise hooks across 5      */
/* dimensions (surprise / specificity / emotional punch / simplicity  */
/* / relatability), each 0-2. Layered AFTER `validateHook` +          */
/* `validateBigPremise` + `validateOutputLine` (those rails handle    */
/* structural correctness; this rubric handles COMEDY QUALITY).       */
/*                                                                    */
/* Spec-compliant gating model:                                       */
/*   total >= 7  → keep (premium premise)                             */
/*   5 <= t < 7  → demote via scaled selection-layer boost (still     */
/*                 ships if no better legacy alternative exists)      */
/*   total < 5   → HARD REJECT at the picker walk layer (never        */
/*                 reaches selection)                                 */
/*                                                                    */
/* Detection sets are intentionally text-based (not catalog-bound)    */
/* so the rubric also scores Llama-polished output (PART 7) and any   */
/* future hand-written premise that may not carry an `executionId`.   */
/* `entry` + `scenario` are OPTIONAL — when omitted the function      */
/* gracefully degrades to text-only signals (no scenario-noun match,  */
/* no execution-id boost) so Llama / Claude fallback wraps still get  */
/* a reasonable comedy score for the re-scoring guard in T003.        */
/*                                                                    */
/* COLOCATION RATIONALE — lives in patternIdeator.ts (not             */
/* ideaScorer.ts where the rest of the SCORER lives) so the picker    */
/* walk in `pickValidatedLanguagePhrasing` (immediately below) can    */
/* call `scorePremiseComedyScore` at the < 5 HARD reject site WITHOUT */
/* introducing a new ideaScorer.ts → patternIdeator.ts runtime        */
/* import cycle. The selection-layer scaled boost                     */
/* (`premiseComedyBoost`) is consumed back from ideaScorer.ts via a   */
/* normal type-only ⇄ runtime import direction; that direction        */
/* already exists for many other helpers and stays acyclic.           */
/* ────────────────────────────────────────────────────────────────── */

/** Per-dimension cell — narrowed to the 0-2 spec range. */
type ComedyDim = 0 | 1 | 2;

/**
 * PART 3 explicit reject examples + structurally-equivalent shapes.
 * Anchored regexes (line-bounded) so a longer hook that happens to
 * contain "today was difficult" as a clause does NOT trip the
 * reject — only the literal SHIPPED-LINE form does.
 */
const COMEDY_HARD_REJECT_PATTERNS: ReadonlyArray<RegExp> = [
  /^i tried to be productive and failed[.!?]?$/i,
  /^this happens every time[.!?]?$/i,
  /^i am dealing with the task again[.!?]?$/i,
  /^this is relatable[.!?]?$/i,
  /^today was difficult[.!?]?$/i,
  // Structurally-equivalent generic-observation shapes the spec
  // PART 3 lumps under "too literal / not funny / generic".
  /^this is (so )?(me|relatable|true|us)[.!?]?$/i,
  /^that('?s| is) (so )?(me|relatable|true|us)[.!?]?$/i,
  /^(today|tonight|monday|life) (was|is|feels) (hard|tough|difficult|rough|exhausting)[.!?]?$/i,
];

/**
 * Surprise tokens — words/phrases that signal absurd, unexpected, or
 * cognitively-jarring framings. Lowercase substring matches (case
 * normalized at scoring time). Pulled from PART 4 boost-mechanism
 * examples ("filed for emotional bankruptcy", "ghosted my own to-do
 * list") + the executionIds vocabulary ("metaphor_mayhem",
 * "cosmic_overreaction"). Curated to avoid common everyday verbs
 * that would over-trigger.
 */
const COMEDY_SURPRISE_TOKENS: ReadonlyArray<string> = [
  // Legal / formal-vocab applied to casual life events
  "bankruptcy", "lawsuit", "subpoena", "litigation", "deposition",
  "filed for", "filed a", "filed taxes", "filed a complaint",
  "considered legally", "legally allowed", "patent pending",
  "trademarked", "warranty", "press conference", "press release",
  // Corporate / organizational vocab applied to self
  "ceo of", "manager of", "spokesperson", "ambassador", "specialist in",
  "specialize in", "specializes in", "hostile takeover", "negotiating",
  "blackmail", "unionized", "shareholders", "stakeholder",
  // Emotional-support / customer-service absurdism
  "emotional support", "customer service", "filed a complaint",
  "is a visionary", "the visionary",
  // Object personification / surveillance framing
  "knows i'm lying", "knows i'm fine", "watching me decide",
  "judging me", "judges me", "betrayed me", "betrayed by",
  // Game / RPG / mythology applied to mundane life
  "side quest", "boss battle", "final form", "main character",
  "villain origin", "lore drop", "speedrun", "patch notes",
];

/**
 * Execution-id boosts for the SURPRISE dimension. Hooks built from
 * these `PREMISE_STYLE_DEFS[*].executions[*]` patterns reliably
 * produce non-obvious comedic framings even when their text doesn't
 * trip a surface-token match.
 *
 * Phase 6E AUDIT (post-T005 QA): pruned the executions that were
 * inflating weak abstract / cosmic / vague-self-deception hooks
 * past the HARD reject. Removed entries (with example phrasings
 * they were boosting from <5 into the demote band):
 *   - `cosmic_overreaction`  → "this small thing has unmade me
 *                              entirely", "this inconvenience has
 *                              rewritten my whole arc" (dramatic
 *                              but ungrounded — fails relatability)
 *   - `pattern_naming`       → "this is my entire pattern" (meta-
 *                              vague observation, no specific
 *                              behavior)
 *   - `delusion_admission`   → "i checked it and pretended that
 *                              counted" (vague self-deception
 *                              without concrete behavior anchor)
 *
 * Retained executions all produce structurally-surprising framings
 * (absurd metaphor, sudden pivot, identity flip, ironic confidence)
 * that read as comedy independent of execution-id context.
 */
const COMEDY_SURPRISE_EXECUTION_IDS: ReadonlySet<string> = new Set([
  "metaphor_mayhem",
  "whiplash_pivot",
  "identity_framing",
  "ironic_confidence",
]);

/**
 * Generic-observation prefixes — when a hook starts with one of these
 * shapes the surprise dimension is forced to 0 (overrides any token
 * match). These openers signal "AI summary voice" or "bland caption-
 * like recap" and their presence dominates whatever follows.
 */
const COMEDY_GENERIC_PREFIX_PATTERNS: ReadonlyArray<RegExp> = [
  /^here'?s why\b/i,
  /^this is why\b/i,
  /^that'?s why\b/i,
  /^when you (try|just|simply)\b/i,
  /^(it|today|tonight) (is|was|feels)\b/i,
];

/**
 * Emotion / embarrassment / anxiety / frustration token set — drives
 * the punch dimension. Curated to favor specific emotional vocabulary
 * over generic ones ("sad", "happy") so the dimension actually
 * discriminates between flat feelings and sharp comedic spikes.
 */
const COMEDY_EMOTION_TOKENS: ReadonlyArray<string> = [
  "embarrassed", "anxiety", "anxious", "panic", "panicked",
  "frustration", "frustrated", "betrayed", "betrayal",
  "spiral", "spiraling", "meltdown", "trauma", "traumatized",
  "disappointment", "disappointed", "disaster", "collapse",
  "crisis", "existential", "emergency", "ashamed", "shame",
  "cringe", "cringing", "unhinged", "feral", "unwell",
  "goblin", "gremlin", "gaslight", "gaslit", "sabotaged",
  "ruined", "ruining", "ghosted", "ghosting", "haunted",
  "cursed", "drained", "overwhelmed", "wrecked", "begged",
  "apologized", "humiliated", "exposed", "menace",
  "delusional", "deluded", "depressed", "depression",
  "screaming", "crying", "weeping", "sobbing", "raging",
  // Burnout / fatigue-vocabulary (emotional-truth side of "tired")
  "burnout", "burnt out", "burned out", "exhausted", "drained",
  "tired", "wrecked", "worn out", "fried",
  // Self-roast verdict words (emotional self-judgment)
  "useless", "pointless", "worthless", "hopeless", "broken",
  // Internal-emotion vocabulary (regret / shame / guilt — strong
  // self-roast fuel even without an external trigger word)
  "regret", "regretted", "shame", "shameful", "guilt", "guilty",
  "remorse", "remorseful", "grief", "grieving",
  // Absurd-metaphor emotion-coded phrases (one punch point each)
  "emotional bankruptcy", "emotional damage", "emotional support",
  "filed for emotional", "in a chokehold", "chokehold",
];

/**
 * Execution-ids that reliably express emotional spikes regardless of
 * the surface text. Boost punch to 2 when matched.
 *
 * Phase 6E AUDIT (post-T005 QA): pruned executions whose "emotional
 * spike" was actually generic dramatic vocabulary unmoored from
 * concrete behavior. Removed entries (with examples they were
 * inflating into the demote band):
 *   - `cosmic_overreaction`  → "this small thing has unmade me
 *                              entirely" (drama without grounding)
 *   - `expectation_collapse` → "resting somehow made me more tired"
 *                              (clean ironic flip, but the punch
 *                              boost was masking weaker variants
 *                              shipping at the same exec id; text
 *                              still passes via emotion tokens when
 *                              actually grounded)
 *   - `gen_z_collapse`       → "my dignity has officially left the
 *                              chat" (vague life-collapse phrasing
 *                              the user audit explicitly called out)
 *   - `delusion_admission`   → "the cart told on me before i did"
 *                              (parallel to surprise removal —
 *                              vague self-deception without a real
 *                              emotional spike)
 *   - `whiplash_pivot`       → structural surprise, not an emotional
 *                              spike — kept in surprise set, dropped
 *                              from punch where it doesn't belong
 *
 * Retained: `chaos_acceptance` continues to produce grounded time-
 * marker / behavioral-contradiction punch hooks ("yesterday me
 * booked chaos for today me's calendar") via real first-person
 * action vocabulary the rubric should reward.
 */
const COMEDY_PUNCH_EXECUTION_IDS: ReadonlySet<string> = new Set([
  "chaos_acceptance",
]);

/**
 * Concrete-noun tokens — drives the specificity dimension. Generic
 * scenario-anchored objects that signal "this hook is grounded in a
 * real moment" rather than abstract advice.
 */
const COMEDY_CONCRETE_NOUN_TOKENS: ReadonlyArray<string> = [
  "to-do list", "todo list", "fridge", "phone", "alarm",
  "couch", "doomscroll", "tab", "tabs", "calendar", "voicemail",
  "card", "credit card", "subscription", "inbox", "email",
  "notification", "screen time", "gym bag", "mirror", "mug",
  "kettle", "hoodie", "fork", "spoon", "outfit", "laundry",
  "pillow", "blanket", "fridge door", "phone screen", "battery",
  "wifi", "doordash", "uber", "amazon cart", "grocery list",
];

/**
 * Universal-experience tokens — drives the relatability dimension.
 * Things people commonly identify with as "yeah that's me".
 */
const COMEDY_UNIVERSAL_TOKENS: ReadonlyArray<string> = [
  "procrastination", "productivity", "sleep", "phone", "food",
  "work", "weekend", "monday", "tuesday", "midnight", "scrolling",
  "doomscroll", "hangover", "broke", "tired", "burned out",
  "burnt out", "anxious", "lonely", "messy", "lazy", "broken",
  "9am me", "2am me", "3am me", "morning me", "future me",
  "past me", "me when", "the way i", "my brain", "my body",
  "my therapist", "my bank", "my mom", "my boss",
];

/**
 * Strong-relatability phrase patterns — match the "me" trigger shapes
 * the spec PART 1 calls out as ideal premise-hook DNA.
 */
const COMEDY_RELATABILITY_PHRASES: ReadonlyArray<RegExp> = [
  /\bi am the (kind|type|villain|ceo|manager|main character)\b/i,
  /\bi specialize in\b/i,
  /\bi ghosted my own\b/i,
  /\bmain character of (my|this|that)\b/i,
  /\bi (am|'?m) the reason\b/i,
  /\bme when (i|you|we)\b/i,
  /\b(2am|3am|9am|monday) (me|i)\b/i,
];

/**
 * PART 4 boost mechanism patterns — when a hook expresses one of
 * these strong-comedy mechanisms it gets a small dimension-targeted
 * bonus (capped per-dim at 2, total capped at 10). Detection is
 * purely text-based so it works on Llama output as well as catalog
 * entries.
 */
const COMEDY_MECHANISM_PATTERNS: ReadonlyArray<{
  mechanism: PremiseComedyScore["boostMechanisms"][number];
  pattern: RegExp;
}> = [
  {
    mechanism: "self_roast",
    pattern:
      /\bi(?:'?m| am) the (?:kind|type|villain|ceo|manager|reason|main character)\b|\bi specialize in\b|\bi ghosted my own\b/i,
  },
  {
    mechanism: "absurd_metaphor",
    pattern:
      /\b(?:filed (?:for|a)|filed taxes|patent pending|emotional bankruptcy|hostile takeover|press conference|side quest|speedrun|patch notes|customer service|emotional support)\b/i,
  },
  {
    mechanism: "object_personification",
    // Spec PART 4 example: "the fridge knows i'm lying" — accept BOTH
    // "my X" and "the X" possessive shapes so personified-object hooks
    // built around any salient object trigger the boost.
    pattern:
      /\b(?:my|the) (?:fridge|phone|alarm|brain|body|therapist|mug|couch|hoodie|wifi|inbox|doordash|to-?do list|mirror|kettle|laundry|calendar|voicemail|pillow|blanket|battery|notification|screen time|tabs?|email) (?:knows|told|judges|judged|watches|hates|betrayed|filed|ghosted|left|quit|gave up|texted|whispered|snitched|reported)\b/i,
  },
  {
    mechanism: "time_marker_contrast",
    pattern: /\b(?:2am|3am|9am|monday|tuesday|midnight|noon) (?:me|i)\b/i,
  },
  {
    mechanism: "identity_contradiction",
    pattern:
      /\b(?:visionary|specialist|expert|the kind of person|legally allowed|considered legally|the ceo of)\b/i,
  },
  {
    mechanism: "overdramatic_framing",
    pattern:
      /\b(?:meltdown|spiral|crisis|disaster|collapse|emergency|villain origin|trauma|haunted|cursed|wrecked)\b/i,
  },
  {
    mechanism: "consumer_phone_behavior",
    pattern:
      /\b(?:doomscroll|screen time|notification|inbox|tabs?|battery|wifi|amazon cart|doordash|uber)\b/i,
  },
  {
    mechanism: "late_night_spiral",
    pattern: /\b(?:2am|3am|midnight|late night|tonight)\b.*\b(?:me|i|spiral|thought)\b/i,
  },
];

/**
 * Score a candidate hook against the Phase 6E PremiseComedyScore
 * rubric. Pure deterministic — same inputs → same output (no clocks,
 * no random, no I/O). Returns a 0-10 total + per-dimension breakdown
 * + reject decision + telemetry boost-mechanism tags.
 *
 * NOTE: this function does NOT enforce gating. The < 5 HARD reject
 * is enforced by the caller (`pickValidatedLanguagePhrasing` walk
 * directly below); the 5-6 demote band is enforced by the
 * `selectionPenalty` scaled boost in ideaScorer.ts via
 * `premiseComedyBoost`. Keeping the scoring + the gating decisions
 * separate makes both layers independently testable and lets QA
 * telemetry see the raw score even on rejected hooks.
 *
 * @param hook   The fully-rendered hook string (POST-compressHook,
 *               POST-validateOutputLine — i.e. the form that would
 *               actually ship).
 * @param entry  Optional. The catalog `LanguagePhrasingEntry` the
 *               hook was built from. When provided, `executionId` /
 *               `bigPremise` boost the dimensions. Llama / Claude
 *               fallback wraps may omit; the function falls back to
 *               text-only signals cleanly.
 * @param scenario Optional. The scenario the hook was built for.
 *               When provided, `topicNoun` participates in the
 *               specificity match. Same fallback discipline.
 */
export function scorePremiseComedyScore(
  hook: string,
  entry?:
    | Pick<
        LanguagePhrasingEntry,
        "bigPremise" | "executionId" | "premiseStyleId"
      >
    | undefined,
  scenario?: { topicNoun?: string } | undefined,
): PremiseComedyScore {
  const text = (hook ?? "").toLowerCase().trim();
  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  // --- HARD REJECT pass (PART 3) ---------------------------------
  for (const pat of COMEDY_HARD_REJECT_PATTERNS) {
    if (pat.test(text)) {
      return {
        surprise: 0,
        specificity: 0,
        punch: 0,
        simplicity: 0,
        relatability: 0,
        total: 0,
        rejected: true,
        rejectReason: "hard_pattern_reject",
        boostMechanisms: [],
      };
    }
  }

  // --- Anchor pass — "could apply to almost anything" reject -----
  // A hook with NO first-person AND NO concrete-noun anchor AND NO
  // emotional-spike token is by definition "could apply to anything"
  // per PART 3. Bypassed at the rubric layer (returns total=0,
  // rejected=true) so the picker walk's < 5 gate trivially fires.
  const hasFirstPerson = /\b(i|me|my|i'?m|i'?ve|i'?ll|i'?d|mine)\b/.test(text);
  const hasConcreteNoun =
    COMEDY_CONCRETE_NOUN_TOKENS.some((t) => text.includes(t)) ||
    (scenario?.topicNoun !== undefined &&
      scenario.topicNoun.length > 0 &&
      text.includes(
        scenario.topicNoun.toLowerCase().replace(/^the\s+/, ""),
      ));
  const hasEmotion = COMEDY_EMOTION_TOKENS.some((t) => text.includes(t));
  if (!hasFirstPerson && !hasConcreteNoun && !hasEmotion) {
    return {
      surprise: 0,
      specificity: 0,
      punch: 0,
      simplicity: 0,
      relatability: 0,
      total: 0,
      rejected: true,
      rejectReason: "no_anchor",
      boostMechanisms: [],
    };
  }

  // --- Surprise (0-2) --------------------------------------------
  let surprise: ComedyDim = 1;
  const hasSurpriseToken = COMEDY_SURPRISE_TOKENS.some((t) =>
    text.includes(t),
  );
  const surpriseExecutionMatch =
    entry?.executionId !== undefined &&
    COMEDY_SURPRISE_EXECUTION_IDS.has(entry.executionId);
  if (hasSurpriseToken || surpriseExecutionMatch) surprise = 2;
  // Generic-observation prefix DOWNGRADES surprise to 0 regardless
  // of any token match — these openers signal "AI summary voice"
  // and dominate whatever follows them.
  const startsGeneric = COMEDY_GENERIC_PREFIX_PATTERNS.some((p) =>
    p.test(text),
  );
  if (startsGeneric) surprise = 0;

  // --- Specificity (0-2) -----------------------------------------
  let specificity: ComedyDim = 0;
  const matchesScenarioNoun =
    scenario?.topicNoun !== undefined &&
    scenario.topicNoun.length > 0 &&
    text.includes(
      scenario.topicNoun.toLowerCase().replace(/^the\s+/, ""),
    );
  const hasMyNoun = /\bmy [a-z]+\b/.test(text);
  if (hasConcreteNoun || matchesScenarioNoun || hasMyNoun) specificity = 1;
  if (
    (hasConcreteNoun || matchesScenarioNoun) &&
    (hasMyNoun ||
      /\b(today|tonight|3am|2am|9am|monday|tuesday|midnight)\b/.test(text))
  ) {
    specificity = 2;
  }

  // --- Emotional Punch (0-2) -------------------------------------
  let punch: ComedyDim = 0;
  if (hasEmotion) punch = 1;
  const punchExecutionMatch =
    entry?.executionId !== undefined &&
    COMEDY_PUNCH_EXECUTION_IDS.has(entry.executionId);
  if (punchExecutionMatch) punch = 2;

  // --- Simplicity (0-2) ------------------------------------------
  let simplicity: ComedyDim = 2;
  const commaCount = (text.match(/,/g) ?? []).length;
  const hasComplexConjunction = /\b(because|even though|while|however|despite|whereas)\b/i.test(
    text,
  );
  if (wordCount > 10 || commaCount > 1 || hasComplexConjunction) simplicity = 1;
  if (wordCount > 12 || commaCount > 2 || /[;:]/.test(text)) simplicity = 0;

  // --- Relatability (0-2) ----------------------------------------
  let relatability: ComedyDim = 0;
  const hasUniversal = COMEDY_UNIVERSAL_TOKENS.some((t) => text.includes(t));
  if (hasFirstPerson && (hasUniversal || hasEmotion || hasConcreteNoun)) {
    relatability = 1;
  }
  if (hasFirstPerson && hasUniversal && hasEmotion) relatability = 2;
  if (
    hasFirstPerson &&
    COMEDY_RELATABILITY_PHRASES.some((p) => p.test(text))
  ) {
    relatability = 2;
  }

  // --- Boost mechanisms (PART 4) ---------------------------------
  // Detect ALL matching mechanisms (cross-cutting telemetry) and
  // apply ONE small targeted dimension bonus per detected family.
  // Caps preserved (each dim ≤ 2, total ≤ 10) so a flood of
  // mechanisms can't push a structurally-weak hook above the keep
  // threshold artificially.
  const boostMechanisms: PremiseComedyScore["boostMechanisms"][number][] = [];
  for (const { mechanism, pattern } of COMEDY_MECHANISM_PATTERNS) {
    if (pattern.test(text)) boostMechanisms.push(mechanism);
  }
  if (boostMechanisms.includes("self_roast") && punch < 2) {
    punch = (punch + 1) as ComedyDim;
  }
  if (boostMechanisms.includes("absurd_metaphor") && surprise < 2) {
    surprise = (surprise + 1) as ComedyDim;
  }
  if (boostMechanisms.includes("object_personification") && specificity < 2) {
    specificity = (specificity + 1) as ComedyDim;
  }
  if (
    (boostMechanisms.includes("time_marker_contrast") ||
      boostMechanisms.includes("late_night_spiral")) &&
    relatability < 2
  ) {
    relatability = (relatability + 1) as ComedyDim;
  }
  if (boostMechanisms.includes("identity_contradiction") && surprise < 2) {
    surprise = (surprise + 1) as ComedyDim;
  }
  if (boostMechanisms.includes("overdramatic_framing") && punch < 2) {
    punch = (punch + 1) as ComedyDim;
  }

  const rawTotal = surprise + specificity + punch + simplicity + relatability;
  return {
    surprise,
    specificity,
    punch,
    simplicity,
    relatability,
    total: Math.min(10, rawTotal),
    rejected: false,
    boostMechanisms,
  };
}

/**
 * Phase 6E — selection-layer scaled boost replacing Phase 6D's flat
 * `+7 if usedBigPremise === true` lever (still applied in
 * `selectionPenalty` in ideaScorer.ts; this helper computes the new
 * value). Maps a comedy score onto a smooth +7..-2 boost band so:
 *   - 10              → +7  (Phase 6D top — premium premise wins easily)
 *   - 9               → +6
 *   - 8               → +5
 *   - 7               → +4  (keep band — clearly preferred over legacy)
 *   - 6               → +1  (demote band — premise can ship if no better
 *                            legacy alternative exists)
 *   - 5               → -2  (demote band — legacy strongly preferred)
 *   - <5 (rejected)   →  0  (defensive — these hooks were already blocked
 *                            at the picker walk and never reach selection;
 *                            return 0 so the math degrades cleanly if a
 *                            stale low-score candidate slips through)
 *
 * Pure helper — no side effects. Exported for QA / test introspection
 * + consumption from ideaScorer.ts at the selectionPenalty +7 site.
 */
export function premiseComedyBoost(score: number | undefined): number {
  if (score === undefined || score < 5) return 0;
  if (score >= 10) return 7;
  if (score === 9) return 6;
  if (score === 8) return 5;
  if (score === 7) return 4;
  if (score === 6) return 1;
  return -2; // score === 5
}

// ============================================================
// Phase 6F — Legacy comedy scoring (lighter rubric than premise)
// ============================================================
// Spec source:
// `attached_assets/Pasted-PHASE-6F-STRICT-PREMISESTYLE-INTEGRATION-A-VERSION-Goal_1777613462870.txt`
//
// PART 4 explicit hard-reject list. The first three are spec
// verbatim ("this is happening again", "today was hard", "this
// always happens"); the remaining shapes lump together other
// spec-equivalent generic-recap openers the user explicitly
// called out as "leftover / template filler" feel. Conservative
// per the user's T002 instruction ("do NOT make legacy too
// strict; legacy should not need to be clever").
const LEGACY_HARD_REJECT_PATTERNS: ReadonlyArray<RegExp> = [
  /^this is happening again[.!?]?$/i,
  /^today was hard[.!?]?$/i,
  /^this always happens[.!?]?$/i,
  /^that('?s| is)? life[.!?]?$/i,
  /^such is life[.!?]?$/i,
  /^story of my life[.!?]?$/i,
  /^another day another (struggle|fail|disaster)[.!?]?$/i,
  /^(today|tonight|monday) (was|is|feels) (so )?(hard|tough|difficult|rough|exhausting|long)[.!?]?$/i,
  /^this is (so )?(me|relatable|true|us)[.!?]?$/i,
  /^that('?s| is) (so )?(me|relatable|true|us)[.!?]?$/i,
];

/**
 * Behavior / action verb tokens — drives BOTH the no-anchor reject
 * (a hook with NO first-person AND NO concrete noun AND NO behavior
 * verb is "could apply to anything" per spec PART 4) AND the
 * relatability dim's top-step gating ("clear behavior anchor"
 * required for relatability=3).
 *
 * Curated to favor the everyday-procrastination action vocabulary
 * the spec PART 5 examples use ("opened", "closed", "checked",
 * "avoiding") rather than generic linking verbs ("is", "was", "be")
 * which would over-trigger and defeat the no-anchor check.
 */
const LEGACY_BEHAVIOR_VERB_TOKENS: ReadonlyArray<string> = [
  // Past-tense action verbs
  "opened", "closed", "checked", "checked it", "ignored", "snoozed",
  "skipped", "scrolled", "swiped", "refreshed", "deleted", "ordered",
  "paid", "bought", "returned", "ghosted", "blocked", "muted",
  "unfollowed", "left", "quit", "stopped", "started", "tried",
  "planned", "meant", "promised", "said", "told", "replied",
  "answered", "missed", "forgot", "remembered", "noticed", "realized",
  "watched", "looked", "ate", "drank", "lay", "sat", "walked",
  "woke", "slept", "waited", "called", "texted", "emailed",
  "booked", "cancelled", "canceled", "showed up", "showed",
  // Avoidance / procrastination present-tense
  "avoid", "avoiding", "avoided", "ignoring", "skipping", "scrolling",
  "doomscrolling", "procrastinating", "postponing", "snoozing",
  "still avoiding", "still ignoring", "still procrastinating",
  "still scrolling", "still waiting",
  // Said / promised future-tense softeners
  "i'll", "i will", "going to", "gonna", "supposed to", "meant to",
  "planned to", "tried to", "should have", "should've",
];

/**
 * Phase 6F audit-tune — additional present-tense action verbs used
 * in `micro_story` style multi-beat hooks. KEPT SEPARATE from
 * `LEGACY_BEHAVIOR_VERB_TOKENS` on purpose: this list is consumed
 * ONLY by `countBehaviorVerbs()` for the multi-beat-exemption flag
 * (≥2 visible action verbs ⇒ comma-separated micro-actions are
 * treated like period-separated beats). Keeping it isolated means
 * adding present-tense bare stems ("open", "close", "stare") cannot
 * change `hasBehaviorVerb` / no_anchor / relatability semantics for
 * single-action hooks — the existing rubric for non-multi-beat
 * hooks is unchanged.
 *
 * Word-boundary regex matching is used (not substring) so "open"
 * does not falsely match "opener", "opening", etc.
 */
const LEGACY_MULTIBEAT_ACTION_VERBS: ReadonlyArray<string> = [
  // Present-tense bare stems and 3rd-person singular forms commonly
  // used in micro_story patterns ("open the X, stare, close it,
  // walk away" / "I open it, glance, close it, pretend that
  // counted").
  "open", "opens", "close", "closes", "look", "looks",
  "watch", "watches", "glance", "glances", "stare", "stares",
  "pretend", "pretends", "walk", "walks", "stand", "stands",
  "sit", "sits", "scroll", "scrolls", "refresh", "refreshes",
  "swipe", "swipes", "check", "checks", "ignore", "ignores",
  "snooze", "snoozes", "skip", "skips", "wait", "waits",
  "leave", "leaves", "stop", "stops", "start", "starts",
  "say", "says", "tell", "tells", "reply", "replies",
  "answer", "answers", "show", "shows", "go", "goes",
  "see", "sees", "do", "does", "nod", "nods",
  "keep", "keeps", "begin", "begins", "continue", "continues",
  "spent", "preparing", "stood", "walked", "walking",
  // Compound verb phrase used in catalog ("walk away", "walks away")
  "walk away", "walks away",
  // Past-tense overlap with `LEGACY_BEHAVIOR_VERB_TOKENS` —
  // duplicated here so the count helper sees them too. The
  // word-boundary regex prevents double-substring matches.
  "opened", "closed", "checked", "ignored", "snoozed",
  "skipped", "scrolled", "swiped", "deleted", "ordered",
  "looked", "watched", "ate", "drank", "lay", "sat",
  "woke", "slept", "waited", "called", "texted", "emailed",
  "ghosted", "blocked", "muted",
];

/**
 * Phase 6F audit-tune — counts visible action verbs in a hook using
 * word-boundary regex (not substring matching). Used by
 * `scoreLegacyComedyScore` to detect multi-beat micro-story hooks
 * (≥2 verbs joined by commas/periods) and exempt them from the
 * comma penalty — so "I open it, glance, close it, pretend that
 * counted" is treated like the spec PART 5 example "i opened it.
 * then closed it" instead of being killed for having 3 commas.
 */
function countBehaviorVerbs(text: string): number {
  let count = 0;
  // Combine both lists (de-duplicated implicitly by the Set below)
  // so the count covers past-tense AND present-tense forms.
  const seen = new Set<string>();
  for (const v of LEGACY_MULTIBEAT_ACTION_VERBS) seen.add(v);
  for (const v of LEGACY_BEHAVIOR_VERB_TOKENS) seen.add(v);
  for (const v of seen) {
    // Escape regex special chars; spaces become \s+ so "walk away"
    // matches "walk  away" too.
    const escaped = v
      .replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")
      .replace(/\s+/g, "\\s+");
    const re = new RegExp(`\\b${escaped}\\b`, "g");
    const matches = text.match(re);
    if (matches) count += matches.length;
  }
  return count;
}

/**
 * Avoidance / procrastination / mild-frustration vocabulary — drives
 * the emotional dim. Lighter than the premise emotion token set on
 * purpose: legacy hooks earn the emotional dim via subtle self-aware
 * vocabulary, not the explicit emotional spikes ("emotional
 * bankruptcy", "spiral") that earn premise punch.
 */
const LEGACY_AVOIDANCE_TOKENS: ReadonlyArray<string> = [
  "avoid", "avoiding", "avoided", "ignored", "ignoring", "ghosted",
  "skipped", "skipping", "postponed", "postponing", "snoozed",
  "snoozing", "later", "tomorrow", "again", "still", "not today",
  "fine", "i'm fine", "totally fine", "okay", "i'm okay",
  "supposed to", "meant to", "planned to", "tried to",
  "should have", "should've", "going to", "gonna",
  "i'll", "i will", "next week", "in a minute", "in a sec",
];

/**
 * Self-awareness / mild-resignation phrases — the spec's "subtle
 * self-awareness" emotional signal. Detected by phrase pattern
 * because the bare tokens ("guess", "apparently") would over-trigger
 * outside the resignation framing.
 */
const LEGACY_SELF_AWARENESS_PHRASES: ReadonlyArray<RegExp> = [
  /\bi guess\b/i,
  /\bsomehow\b/i,
  /\bof course\b/i,
  /\bobviously\b/i,
  /\bapparently\b/i,
  /\bbecause why not\b/i,
  /\bwhy not\b/i,
  /\bi knew it\b/i,
  /\bthat tracks\b/i,
];

/**
 * Universal-experience tokens for legacy relatability — overlaps
 * with `COMEDY_UNIVERSAL_TOKENS` (premise) but lighter / more
 * everyday-coded so the relatability dim doesn't require the same
 * "main character meltdown" energy a premise hook would.
 */
const LEGACY_UNIVERSAL_TOKENS: ReadonlyArray<string> = [
  "procrastination", "productivity", "sleep", "phone", "food",
  "work", "weekend", "monday", "tuesday", "midnight", "tonight",
  "scrolling", "doomscroll", "tired", "lazy", "messy", "broke",
  "lonely", "anxious", "burnt out", "burned out", "exhausted",
  "to-do list", "todo list", "calendar", "inbox", "alarm",
  "morning", "evening", "afternoon", "night",
  "future me", "past me", "today me", "yesterday me", "tomorrow me",
  "my brain", "my body", "my phone", "my fridge",
];

/**
 * Filler / softener tokens — drives a CLARITY dim penalty when
 * present. Same vocab the existing `compressHook` strips but kept
 * separate here because we want to penalize hooks that ship WITH
 * the filler still in (they survived compression → the filler is
 * load-bearing in the entry's `build` output → the entry deserves
 * a clarity demote).
 */
const LEGACY_FILLER_TOKENS: ReadonlyArray<string> = [
  "really", "kind of", "kinda", "sort of", "sorta", "basically",
  "literally", "actually", "pretty much", "i think", "i feel like",
  "you know", "honestly", "tbh", "to be honest",
];

/**
 * Score a candidate legacy (non-premise) hook against the Phase 6F
 * LegacyComedyScore rubric. Pure deterministic — same inputs → same
 * output. Returns a 0-10 total + per-dimension breakdown + reject
 * decision.
 *
 * NOTE on gating responsibility (parallel to scorePremiseComedyScore):
 * this function does NOT enforce the < 5 reject. The HARD reject is
 * enforced by the caller (`pickValidatedLanguagePhrasing` walk
 * fallback path); the score=5 demote band is enforced by the
 * `selectionPenalty` scaled boost in ideaScorer.ts via
 * `legacyComedyBoost`. Keeping scoring + gating separate makes both
 * layers independently testable and lets QA telemetry see the raw
 * score even on rejected hooks.
 *
 * Conservative rubric per the user's T002 instruction ("legacy
 * should not need to be clever"): each dim earns its top step from
 * a small surface-text or entry-flag signal rather than requiring
 * sharp comedic mechanism detection. The keep band is ≥ 6 (not ≥ 7
 * like premise) and the no-anchor reject requires ALL THREE of
 * (no first-person, no concrete noun, no behavior verb) to fire —
 * a stricter precondition than the premise no-anchor rule because
 * legacy hooks legitimately ship with simpler structure.
 *
 * @param hook   The fully-rendered hook string (POST-compressHook,
 *               POST-validateOutputLine — i.e. the form that would
 *               actually ship).
 * @param entry  Optional. The catalog `LanguagePhrasingEntry` the
 *               hook was built from. When provided, `genericHook` /
 *               `hookIntent` participate in dim adjustments. Llama /
 *               Claude fallback wraps may omit; the function falls
 *               back to text-only signals cleanly.
 * @param scenario Optional. The scenario the hook was built for.
 *               When provided, `topicNoun` participates in the
 *               concrete-noun / specificity check.
 */
export function scoreLegacyComedyScore(
  hook: string,
  // Phase 6F (LEGACY COMEDY SCORING) — accepts either a Phase 3
  // `LanguagePhrasingEntry` (used by the picker walk) OR a legacy
  // `HookPhrasingEntry` (used by the rewriter), since the scorer
  // only reads `entry?.genericHook` (the catalog low-quality flag)
  // and never touches `hookIntent`. Both entry types have the
  // identical optional `genericHook?: boolean` field, so a single
  // structural shape `{ genericHook?: boolean }` is the precise
  // contract — broader than `Pick<LanguagePhrasingEntry, …>` (which
  // would force `hookIntent` to be required even though it's
  // never read) and intentionally NOT scenario-shape-typed so a
  // Phase 6 LegacyHookEntry remains call-compatible if/when added.
  entry?: { genericHook?: boolean } | undefined,
  scenario?: { topicNoun?: string } | undefined,
): LegacyComedyScore {
  const text = (hook ?? "").toLowerCase().trim();
  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  // --- HARD reject pass (PART 4 explicit list) -------------------
  for (const pat of LEGACY_HARD_REJECT_PATTERNS) {
    if (pat.test(text)) {
      return {
        relatability: 0,
        clarity: 0,
        simplicity: 0,
        emotional: 0,
        total: 0,
        rejected: true,
        rejectReason: "generic_filler",
      };
    }
  }

  // --- HARD reject — too long (>12 words) ------------------------
  if (wordCount > 12) {
    return {
      relatability: 0,
      clarity: 0,
      simplicity: 0,
      emotional: 0,
      total: 0,
      rejected: true,
      rejectReason: "too_long",
    };
  }

  // --- Anchor pass — "could apply to anything" reject ------------
  // Stricter precondition than the premise no_anchor rule (premise
  // requires NO first-person AND NO concrete noun AND NO emotion;
  // legacy adds behavior-verb to the OR-chain so simple action hooks
  // like "still avoiding it" pass even without first-person + emotion
  // tokens).
  const hasFirstPerson = /\b(i|me|my|i'?m|i'?ve|i'?ll|i'?d|mine)\b/.test(text);
  const hasConcreteNoun =
    COMEDY_CONCRETE_NOUN_TOKENS.some((t) => text.includes(t)) ||
    LEGACY_UNIVERSAL_TOKENS.some((t) => text.includes(t)) ||
    (scenario?.topicNoun !== undefined &&
      scenario.topicNoun.length > 0 &&
      text.includes(
        scenario.topicNoun.toLowerCase().replace(/^the\s+/, ""),
      ));
  const hasBehaviorVerb = LEGACY_BEHAVIOR_VERB_TOKENS.some((t) =>
    text.includes(t),
  );
  const hasEmotion =
    COMEDY_EMOTION_TOKENS.some((t) => text.includes(t)) ||
    LEGACY_AVOIDANCE_TOKENS.some((t) => text.includes(t));
  if (!hasFirstPerson && !hasConcreteNoun && !hasBehaviorVerb && !hasEmotion) {
    return {
      relatability: 0,
      clarity: 0,
      simplicity: 0,
      emotional: 0,
      total: 0,
      rejected: true,
      rejectReason: "no_anchor",
    };
  }

  // --- Relatability (0-3) ----------------------------------------
  // Ladder:
  //   0: nothing (would have been rejected at no_anchor; defensive)
  //   1: first-person OR universal token OR concrete noun OR behavior
  //   2: first-person + (universal OR concrete OR behavior OR emotion)
  //   3: first-person + universal-experience + (behavior OR emotion)
  const hasUniversal = LEGACY_UNIVERSAL_TOKENS.some((t) => text.includes(t));
  let relatability: 0 | 1 | 2 | 3 = 0;
  if (hasFirstPerson || hasUniversal || hasConcreteNoun || hasBehaviorVerb) {
    relatability = 1;
  }
  if (
    hasFirstPerson &&
    (hasUniversal || hasConcreteNoun || hasBehaviorVerb || hasEmotion)
  ) {
    relatability = 2;
  }
  if (hasFirstPerson && hasUniversal && (hasBehaviorVerb || hasEmotion)) {
    relatability = 3;
  }

  // --- Clarity (0-3) ---------------------------------------------
  // Default 2 (legacy templates are presumed clear per spec PART 7).
  // Adjustments:
  //   +1 if simple sentence (≤7 words, no commas, no complex
  //      conjunction, no multi-clause split) → max 3
  //   -1 if has filler/softener tokens (signals over-softening)
  //   -1 if has complex conjunction (because/while/whereas/etc)
  //   -1 if entry.genericHook === true (catalog flag for low-
  //      quality interchangeable templates)
  // Floor at 0.
  let clarity: 0 | 1 | 2 | 3 = 2;
  const hasFiller = LEGACY_FILLER_TOKENS.some((t) => text.includes(t));
  const commaCount = (text.match(/,/g) ?? []).length;
  const hasComplexConjunction =
    /\b(because|even though|while|however|despite|whereas|although)\b/i.test(
      text,
    );
  // Phase 6F audit-tune — multi-beat micro-story exemption. Hooks
  // with ≥2 visible action verbs (counted via word-boundary regex)
  // and ≤12 words are treated as comma-separated behavior beats —
  // structurally equivalent to the spec PART 5 period-separated
  // example "i opened it. then closed it". This unblocks sharp
  // multi-action hooks like "I open it, glance, close it, pretend
  // that counted" / "open the X, stare, close it, walk away" that
  // the strict comma rule was over-killing (T002 audit found ~37%
  // kill rate on `micro_story` style before tune).
  const behaviorVerbCount = countBehaviorVerbs(text);
  const isMultiBeatBehavior =
    behaviorVerbCount >= 2 && wordCount <= 12 && !hasComplexConjunction;
  const isSimple =
    (wordCount <= 7 && commaCount === 0 && !hasComplexConjunction) ||
    isMultiBeatBehavior;
  let clarityRaw: number = 2;
  if (isSimple) clarityRaw += 1;
  if (hasFiller) clarityRaw -= 1;
  if (hasComplexConjunction) clarityRaw -= 1;
  if (entry?.genericHook === true) clarityRaw -= 1;
  if (clarityRaw < 0) clarityRaw = 0;
  if (clarityRaw > 3) clarityRaw = 3;
  clarity = clarityRaw as 0 | 1 | 2 | 3;

  // --- Simplicity (0-2) ------------------------------------------
  // Note: word-count > 12 is HARD-rejected above, so this dim only
  // discriminates the ≤12 band.
  //
  // Phase 6F audit-tune — multi-beat behavior hooks (≥2 action
  // verbs, ≤12 words, no complex conjunction) are EXEMPT from the
  // comma-count penalty. Commas in this case are micro-action beat
  // separators (semantically the same as periods), not run-on
  // syntax. Only semicolons / colons (mid-sentence breaks) still
  // drop simplicity to 0.
  let simplicity: 0 | 1 | 2 = 2;
  if (isMultiBeatBehavior) {
    if (/[;:]/.test(text)) simplicity = 0;
  } else {
    if (wordCount > 10 || commaCount > 1 || hasComplexConjunction) {
      simplicity = 1;
    }
    if (commaCount > 2 || /[;:]/.test(text)) {
      simplicity = 0;
    }
  }

  // --- Emotional Signal (0-2) ------------------------------------
  // Ladder:
  //   0: nothing
  //   1: avoidance/procrastination token OR self-awareness phrase
  //   2: explicit emotion token (from premise emotion set) OR
  //      avoidance + self-awareness combo
  let emotional: 0 | 1 | 2 = 0;
  const hasAvoidance = LEGACY_AVOIDANCE_TOKENS.some((t) => text.includes(t));
  const hasSelfAwareness = LEGACY_SELF_AWARENESS_PHRASES.some((p) =>
    p.test(text),
  );
  const hasExplicitEmotion = COMEDY_EMOTION_TOKENS.some((t) =>
    text.includes(t),
  );
  if (hasAvoidance || hasSelfAwareness) emotional = 1;
  if (hasExplicitEmotion || (hasAvoidance && hasSelfAwareness)) emotional = 2;

  const rawTotal = relatability + clarity + simplicity + emotional;
  return {
    relatability,
    clarity,
    simplicity,
    emotional,
    total: Math.min(10, rawTotal),
    rejected: false,
  };
}

/**
 * Phase 6F — selection-layer scaled boost for legacy hooks. Mirrors
 * `premiseComedyBoost` but with a LIGHTER band so PART 6's tie-bias
 * rule ("both strong → prefer premise") falls out naturally without
 * a separate tie-break: at parity scores premise wins by 2pts; at
 * premise ≤ 6 + legacy ≥ 7 legacy can overcome the gap; ties go to
 * premise.
 *
 * Band:
 *   - 10              → +5  (top legacy — sharp + simple, allowed
 *                            to win against a 7-band premise)
 *   - 9               → +4
 *   - 8               → +3
 *   - 7               → +2  (keep band — clearly preferred over a
 *                            5-6 band premise but loses to ≥ 7 premise)
 *   - 6               → 0   (keep band floor — neutral lever; ships
 *                            when no better candidate exists)
 *   - 5               → -3  (demote band — strongly prefer alternatives)
 *   - <5 (rejected)   →  0  (defensive — these hooks were already
 *                            blocked at the picker walk fallback and
 *                            never reach selection)
 *
 * Pure helper — no side effects. Exported for QA / test introspection
 * + consumption from ideaScorer.ts at the selectionPenalty site.
 */
export function legacyComedyBoost(score: number | undefined): number {
  if (score === undefined || score < 5) return 0;
  if (score >= 10) return 5;
  if (score === 9) return 4;
  if (score === 8) return 3;
  if (score === 7) return 2;
  if (score === 6) return 0;
  return -3; // score === 5
}

/**
 * Phase 7 — instant-recognition vocabulary for ViralFeelScore.
 * Universal-everyday tokens reused from the legacy + premise sets so
 * "yeah, that's me" triggers don't drift away from the comedy
 * vocabulary the rest of the engine grounds against.
 */
const VIRAL_RECOGNITION_TOKENS: ReadonlyArray<string> = [
  ...LEGACY_UNIVERSAL_TOKENS,
  ...COMEDY_UNIVERSAL_TOKENS,
];

/**
 * Phase 7 — surprise / spike vocabulary for the scrollInterruption
 * dim. Reuses the premise comedy surprise execution-id signal via
 * text-only pattern fallbacks (we can't read execution-ids from the
 * post-Llama-polish hook string reliably) plus high-impact spike
 * words: numbers, time markers, fragment cues, hard-stop punctuation.
 */
const VIRAL_SPIKE_TOKENS: ReadonlyArray<string> = [
  // Time-marker spikes (specific moments)
  "2am", "3am", "9am", "midnight", "noon", "monday", "tuesday",
  "tonight", "yesterday me", "today me", "tomorrow me", "future me",
  "past me",
  // Object personification + absurd-metaphor spike words (curated
  // from COMEDY_MECHANISM_PATTERNS surface tokens — kept as bare
  // strings here so this list is `text.includes`-checkable like the
  // other token sets; the regex-based mechanism patterns drive the
  // emotional/recognition dims separately).
  "speedrun", "side quest", "patch notes", "press conference",
  "hostile takeover", "patent pending", "filed for", "filed taxes",
  "emotional bankruptcy", "emotional support", "customer service",
  // Hard-fact / numeric anchors (concrete spike tokens)
  "hours", "minutes", "tabs", "subscriptions", "screen time",
];

/**
 * Phase 7 — shareability vocabulary. Identity-mirror phrasings + the
 * "send this to my group chat" trigger words. Curated to favor the
 * "you'll know exactly who this is" phrasings the spec PART 5 calls
 * out as ideal viral-feel DNA.
 */
const VIRAL_SHAREABILITY_TOKENS: ReadonlyArray<string> = [
  "group chat", "the group chat", "my group chat",
  "tell my therapist", "tell my mom", "tell my boss",
  "literally me", "this is so me", "tag yourself", "tag a friend",
  "the type of person", "the kind of person", "main character",
  "ceo of", "manager of", "specialist", "visionary",
  "everyone i know", "every girl", "every guy",
];
const VIRAL_SHAREABILITY_PATTERNS: ReadonlyArray<RegExp> = [
  /\bi am the (?:kind|type|villain|ceo|manager|main character)\b/i,
  /\bi specialize in\b/i,
  /\bi'?m the reason\b/i,
  /\bme when (?:i|you|we)\b/i,
  /\b(?:everyone|every girl|every guy|every woman|every man)\b/i,
];

/**
 * Phase 7 — emotional-spike vocabulary. Subset of the premise
 * COMEDY_EMOTION_TOKENS curated to skew toward the embarrassment /
 * anxiety / irony / delusion bands the spec calls out, EXCLUDING
 * the burnout / fatigue tokens (those drive legacy emotional, not
 * viral spike).
 */
const VIRAL_EMOTIONAL_SPIKE_TOKENS: ReadonlyArray<string> = [
  "embarrassed", "anxiety", "anxious", "panic", "panicked",
  "spiral", "spiraling", "meltdown", "trauma", "traumatized",
  "disaster", "collapse", "crisis", "emergency",
  "ashamed", "shame", "cringe", "cringing", "unhinged", "feral",
  "humiliated", "exposed", "menace",
  "delusional", "deluded", "delusion",
  "betrayed", "betrayal", "ghosted", "gaslit",
  "ruined", "wrecked", "obliterated",
  "screaming", "crying", "sobbing", "begged",
];

/**
 * Phase 7 — pure deterministic ViralFeelScore. Same inputs → same
 * output. Computes a 5-dim total in [0, 10] with the per-dim
 * sub-scores in their advertised bands. Never throws, never rejects.
 *
 * Designed as a FINAL RANKING POLISH:
 *   - No HARD reject branch (returns total ≥ 0 for every input).
 *   - Bonus band in `viralFeelBoost` is intentionally LIGHTER than
 *     both `premiseComedyBoost` and `legacyComedyBoost` so a strong
 *     comedy score always dominates selection, exactly per spec
 *     PART 5 ("viral feel never overpowers comedy").
 *   - Pulls from existing token tables so the vocabulary stays in
 *     sync with the rest of the engine — no drift across rebuilds.
 *
 * @param hook   The fully-rendered hook string (POST-compressHook,
 *               POST-validateOutputLine — i.e. the form that would
 *               actually ship and that the user would read).
 * @param meta   Optional. The fully-assembled PatternMeta. When
 *               provided, `videoPattern` + `premiseStyleId` drive
 *               the formatFit dim's synergy bonus. Pre-Phase-7 +
 *               Llama / Claude wraps may omit fields; the function
 *               degrades cleanly to text-only signals.
 * @param scenario Optional. The scenario the hook was built for.
 *               When provided, `topicNoun` participates in the
 *               instant-recognition concrete-anchor check.
 */
export function scoreViralFeel(
  hook: string,
  meta?:
    | {
        videoPattern?: VideoPattern;
        premiseStyleId?: PremiseStyleId;
      }
    | undefined,
  scenario?: { topicNoun?: string } | undefined,
): ViralFeelScore {
  const text = (hook ?? "").toLowerCase().trim();
  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  // --- instantRecognition (0-3) ----------------------------------
  // Ladder:
  //   0: nothing
  //   1: first-person OR universal token OR concrete noun OR behavior
  //   2: first-person + (universal OR concrete OR behavior)
  //   3: first-person + universal-experience + behavior + (anchor or
  //      strong-relatability phrase)
  const hasFirstPerson = /\b(i|me|my|i'?m|i'?ve|i'?ll|i'?d|mine)\b/.test(text);
  const hasUniversal = VIRAL_RECOGNITION_TOKENS.some((t) => text.includes(t));
  const hasConcreteNoun =
    COMEDY_CONCRETE_NOUN_TOKENS.some((t) => text.includes(t)) ||
    (scenario?.topicNoun !== undefined &&
      scenario.topicNoun.length > 0 &&
      text.includes(
        scenario.topicNoun.toLowerCase().replace(/^the\s+/, ""),
      ));
  const hasBehaviorVerb = LEGACY_BEHAVIOR_VERB_TOKENS.some((t) =>
    text.includes(t),
  );
  const hasRelatabilityPhrase = COMEDY_RELATABILITY_PHRASES.some((p) =>
    p.test(text),
  );
  let instantRecognition: 0 | 1 | 2 | 3 = 0;
  if (hasFirstPerson || hasUniversal || hasConcreteNoun || hasBehaviorVerb) {
    instantRecognition = 1;
  }
  if (hasFirstPerson && (hasUniversal || hasConcreteNoun || hasBehaviorVerb)) {
    instantRecognition = 2;
  }
  if (
    hasFirstPerson &&
    hasUniversal &&
    hasBehaviorVerb &&
    (hasConcreteNoun || hasRelatabilityPhrase)
  ) {
    instantRecognition = 3;
  }

  // --- scrollInterruption (0-2) ----------------------------------
  // Ladder:
  //   0: nothing
  //   1: surprise/spike token OR fragment shape (≤4 words OR ends w/
  //      hard punctuation OR contains a comma cut)
  //   2: BOTH spike token AND fragment/cut shape
  const hasSpikeToken = VIRAL_SPIKE_TOKENS.some((t) => text.includes(t));
  const isShortFragment = wordCount > 0 && wordCount <= 4;
  const hasHardPunctuation = /[.!?]\s*$/.test(text);
  const hasCommaCut = /,/.test(text);
  const hasFragmentShape = isShortFragment || hasHardPunctuation || hasCommaCut;
  let scrollInterruption: 0 | 1 | 2 = 0;
  if (hasSpikeToken || hasFragmentShape) scrollInterruption = 1;
  if (hasSpikeToken && hasFragmentShape) scrollInterruption = 2;

  // --- shareability (0-2) ----------------------------------------
  // Ladder:
  //   0: nothing
  //   1: identity-mirror token OR group/confession phrase
  //   2: BOTH identity-mirror token AND first-person admission shape
  const hasShareToken = VIRAL_SHAREABILITY_TOKENS.some((t) => text.includes(t));
  const hasSharePattern = VIRAL_SHAREABILITY_PATTERNS.some((p) => p.test(text));
  const hasShareSignal = hasShareToken || hasSharePattern;
  let shareability: 0 | 1 | 2 = 0;
  if (hasShareSignal) shareability = 1;
  if (hasShareSignal && hasFirstPerson && (hasBehaviorVerb || hasUniversal)) {
    shareability = 2;
  }

  // --- emotionalSpike (0-2) --------------------------------------
  // Ladder:
  //   0: nothing
  //   1: one emotional-spike token
  //   2: ≥2 emotional-spike tokens OR one spike token + first-person
  //      admission ("i'm spiraling", "i'm anxious")
  let spikeHits = 0;
  for (const t of VIRAL_EMOTIONAL_SPIKE_TOKENS) {
    if (text.includes(t)) spikeHits += 1;
    if (spikeHits >= 2) break;
  }
  let emotionalSpike: 0 | 1 | 2 = 0;
  if (spikeHits >= 1) emotionalSpike = 1;
  if (spikeHits >= 2 || (spikeHits >= 1 && hasFirstPerson)) {
    emotionalSpike = 2;
  }

  // --- formatFit (0-1) -------------------------------------------
  // 1 when the chosen videoPattern is in PREMISE_PATTERN_SYNERGY_MAP
  // for this candidate's premiseStyleId (the spec PART 5 explicit-
  // synergy combos), OR when the chosen videoPattern is a member of
  // the broader PREMISESTYLE_TO_PATTERN_MAP allowlist for the same
  // style (compatibility floor — the routing layer already picked
  // a family∩intent compatible pattern, so this only adds the dim
  // when there's also style-level alignment).
  // 0 otherwise — unknown style / unknown pattern / non-premise
  // entries (no premiseStyleId) all collapse to the safe baseline.
  let formatFit: 0 | 1 = 0;
  const styleId = meta?.premiseStyleId;
  const pattern = meta?.videoPattern;
  if (styleId !== undefined && pattern !== undefined) {
    const synergy = PREMISE_PATTERN_SYNERGY_MAP[styleId];
    if (synergy && (synergy[pattern] ?? 0) > 0) {
      formatFit = 1;
    } else {
      const allowed = PREMISESTYLE_TO_PATTERN_MAP[styleId];
      if (allowed && allowed.includes(pattern)) {
        formatFit = 1;
      }
    }
  }

  const rawTotal =
    instantRecognition + scrollInterruption + shareability + emotionalSpike + formatFit;
  const total = Math.max(0, Math.min(10, rawTotal));

  return {
    instantRecognition,
    scrollInterruption,
    shareability,
    emotionalSpike,
    formatFit,
    total,
  };
}

/**
 * Phase 7 — selection-layer scaled boost for ViralFeelScore. Pure
 * helper, no side effects. Intentionally LIGHTER than both
 * `premiseComedyBoost` (10→+7..5→-2) and `legacyComedyBoost`
 * (10→+5..5→-3) so the spec PART 5 invariant holds:
 * a strong comedy score ALWAYS dominates a strong viral score in
 * selection, and a weak comedy hook is NEVER rescued by a high viral
 * feel.
 *
 * Band:
 *   - 9-10  → +3
 *   - 7-8   → +2
 *   - 5-6   → +1
 *   - <5    →  0  (also covers undefined — no rescue; defensive)
 *
 * Exported for QA / test introspection + consumption from
 * ideaScorer.ts at the selectionPenalty site.
 */
export function viralFeelBoost(score: number | undefined): number {
  if (score === undefined || score < 5) return 0;
  if (score >= 9) return 3;
  if (score >= 7) return 2;
  return 1; // 5 or 6
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
 *
 * Phase 6C (PREMISE-FIRST SELECTION) layered ON TOP of the existing
 * intent-first / intent-fallback / voice-aware pass orchestration:
 * when the per-slot `PREMISE_FIRST_BUCKET_PCT` gate allows (~80% of
 * slots), the picker runs the SAME 6-pass voice/intent matrix BUT
 * restricted to entries with `bigPremise === true` BEFORE the legacy
 * passes. Premise picker failure (no premise entry of any voice +
 * intent validates for this scenario) naturally drops to the existing
 * legacy passes — preserving Phase 6 EXPANSION's "premise as natural
 * fallback chain" without forcing 100% premise output.
 */
function pickValidatedLanguagePhrasing(
  hookLanguageStyle: HookLanguageStyle,
  scenario: Scenario,
  tone: DerivedTone,
  seed: number,
  voiceProfile?: VoiceProfile,
  // Phase 4 (HOOK INTENT) — optional. When set, the picker filters the
  // chosen language-style's entries to those tagged with this intent
  // first (intent-first passes), and only falls back to ANY-intent
  // entries (intent-fallback passes) when no intent-matching entry
  // validates for this scenario. The returned `intentFallback` flag
  // tells the caller which path won so PatternMeta can record it for
  // QA / scoring telemetry. When `assignedIntent` is undefined the
  // picker behaves exactly as before (3-pass voice-aware) and always
  // returns `intentFallback: false`.
  assignedIntent?: HookIntent,
): {
  entry: LanguagePhrasingEntry;
  index: number;
  hook: string;
  intentFallback: boolean;
  // Phase 6E — populated when the WINNING entry was a premise
  // (entry.bigPremise === true) AND the picker walk scored its
  // post-compress / post-validateOutputLine hook >= 5. Undefined
  // when the winner is a legacy entry, or when the winner is a
  // premise that pre-dated 6E plumbing (defensive — no current code
  // path strips the field, but the optional shape keeps callers
  // robust). Threaded up through every `return { ...x, ... }` site
  // below into PatternMeta in `assembleCandidate` so
  // `selectionPenalty.premiseComedyBoost` can read it.
  premiseComedyScore?: PremiseComedyScore;
  // Phase 6F — symmetric to `premiseComedyScore`, populated when the
  // WINNING entry was a legacy template (entry.bigPremise !== true)
  // AND the picker walk scored its final hook >= 5. Threaded up
  // through every `return { ...x, ... }` site below into
  // PatternMeta in `assembleCandidate` so
  // `selectionPenalty.legacyComedyBoost` can read it. Undefined
  // when the winner is a premise (the premise path already populates
  // `premiseComedyScore` instead — the two are mutually exclusive
  // because each walk site picks at most one entry).
  legacyComedyScore?: LegacyComedyScore;
} | null {
  const phrasings = HOOK_PHRASINGS_BY_LANGUAGE_STYLE[hookLanguageStyle];
  const n = phrasings.length;
  const start = ((seed % n) + n) % n;

  // Inner walker: scans phrasings in seed-rotated order. Used by both
  // the intent-first passes and the intent-fallback passes below —
  // sharing one walker means seed rotation discipline is identical
  // across all six passes.
  //
  // Phase 6C — `premiseOnly` (default false) restricts the walk to
  // entries with `bigPremise === true`. Used by the premise-first
  // orchestration block below; legacy callers keep the default and
  // get the original "all entries" behavior.
  //
  // Phase 6E (FOLLOWUP — picker walk reordering) — selection mode
  // depends on `premiseOnly`:
  //
  //   * premiseOnly === true   → BEST-SCORED. Walk the FULL seed-
  //     rotated rotation, collect every premise candidate that passes
  //     all gates (validateHook + validateBigPremise +
  //     validateOutputLine + comedy score >= 5), and return the one
  //     with the HIGHEST `premiseComedyScore.total`. Ties resolve to
  //     the candidate that appeared FIRST in the seed-rotated order
  //     (strict `>` below preserves the earlier-wins semantics —
  //     keeps seed rotation deterministic and stable across QA
  //     replays). Short-circuits on a perfect 10 (no further scan
  //     can improve). This eliminates the failure mode where a
  //     mediocre 5-6 hook ships only because it appeared earlier in
  //     seed order than a 7-9 hook in the same eligible pool.
  //
  //   * premiseOnly === false  → FIRST-VALID (original behavior). The
  //     legacy fallback passes are reached when premise-first
  //     exhausted, and they're a "find SOMETHING shippable" path
  //     where (a) legacy entries have no comparable quality score
  //     and (b) short-circuiting on first valid matters for slot
  //     fill rate. Premise entries that happen to surface in this
  //     fallback (intent + voice axes can shuffle them to the front)
  //     still get HARD-rejected at <5 via the same score gate; we
  //     just don't second-guess the first valid hit.
  //
  // The HARD reject (<5), the 5-6 demote band, all thresholds, the
  // catalog, validateHook / validateBigPremise / validateOutputLine,
  // and Phase 5 are all untouched. The change is selection-policy
  // only: scan the same eligible set, pick the best instead of the
  // first.
  const walk = (
    intentRequired: HookIntent | null,
    voicePred: (e: LanguagePhrasingEntry) => boolean,
    premiseOnly = false,
  ): {
    entry: LanguagePhrasingEntry;
    index: number;
    hook: string;
    // Phase 6E — see outer return-type comment. Set ONLY when the
    // winning entry was a premise; the < 5 HARD reject site already
    // filters out low scores so anything returned here is >= 5.
    premiseComedyScore?: PremiseComedyScore;
    // Phase 6F — see outer return-type comment. Set ONLY when the
    // winning entry was a legacy template; the < 5 HARD reject site
    // (mirroring premise) filters out low scores so anything
    // returned here is >= 5. The two are mutually exclusive.
    legacyComedyScore?: LegacyComedyScore;
  } | null => {
    // Phase 6E (premise) + Phase 6F (legacy) — `best` accumulates
    // the highest-scored valid candidate across the rotation. Both
    // premise and legacy walks now use best-scored selection so the
    // legacy pool meets the same quality bar as the premise pool
    // (spec PART 1 / PART 6 — "legacy hooks should not be cleverer
    // than premise but they MUST be clear/simple/relatable/non-
    // trash"). The previous first-valid behavior shipped mediocre
    // hooks that appeared earlier in seed-rotated order over higher-
    // quality hooks later in the rotation; mirroring premise's
    // best-scored policy fixes that without changing the eligible
    // set.
    let best:
      | {
          entry: LanguagePhrasingEntry;
          index: number;
          hook: string;
          premiseComedyScore?: PremiseComedyScore;
          legacyComedyScore?: LegacyComedyScore;
        }
      | null = null;
    for (let offset = 0; offset < n; offset++) {
      const idx = (start + offset) % n;
      const entry = phrasings[idx]!;
      // Phase 6C — premise-first filter. Skip non-premise entries
      // when the orchestration requested a premise-only walk; the
      // matched entry will naturally fall through to the legacy
      // pass below (which calls walk with premiseOnly = false) if
      // no premise candidate validates for this slot. Cheap check
      // BEFORE the more expensive intent / voice / build / validate
      // gates so the premise-only walks are as fast as possible.
      if (premiseOnly && entry.bigPremise !== true) continue;
      if (intentRequired !== null && entry.hookIntent !== intentRequired) continue;
      if (!voicePred(entry)) continue;
      // Phase 3B PART 3 — noun-type compatibility gate. Skip the
      // entry BEFORE calling `build()` when the entry declared an
      // `allowedNounTypes` allowlist and the scenario's
      // `topicNounType` is not in it. Undefined allowedNounTypes
      // means "any noun type is fine" (legacy + naturally-permissive
      // templates), preserving backwards-compatibility. The picker
      // will fall through to the next phrasing in seed-rotated
      // order, identical to the validateHook-rejection path; the
      // subsequent intent-fallback / voice-fallback passes will
      // also re-enter this walk and find a compatible entry.
      if (
        entry.allowedNounTypes !== undefined &&
        !entry.allowedNounTypes.includes(scenario.topicNounType)
      ) {
        continue;
      }
      const candidate = toneInflect(entry.build(scenario), tone).trim();
      if (!validateHook(candidate)) continue;
      // Phase 6 (BIG PREMISE LAYER) — premium anti-boring rail
      // applied AFTER `validateHook` succeeds, but ONLY for entries
      // marked `bigPremise: true`. Legacy template entries skip
      // this gate entirely so the existing flow is untouched.
      // Rejection falls through to the next phrasing in seed-rotated
      // order (same self-healing path as `validateHook` rejection).
      if (entry.bigPremise === true && !validateBigPremise(candidate)) {
        continue;
      }
      // Phase 6C (OUTPUT LINE OPTIMIZATION) — post-validate polish +
      // caption-like / over-clever / AI-feel rail. Two-step:
      //   1. `compressHook` — pure transform that strips comedy-
      //      deflating filler / softener / redundant trailing words.
      //      Idempotent + min-3-word-safe, so worst-case the helper
      //      returns the original string unchanged.
      //   2. The compressed string is RE-checked against
      //      `validateHook` (defensive — compression could in
      //      principle expose a previously-masked banned prefix or
      //      dangling word once the filler vanishes); on failure we
      //      fall back to the un-compressed candidate so we don't
      //      throw away a hook that was already shippable BEFORE
      //      compression.
      //   3. `validateOutputLine` then fires on the FINAL form
      //      (compressed-and-revalidated, or original on revalidate
      //      failure). Rejection walks to the next entry, same
      //      self-healing path as `validateHook` / `validateBigPremise`
      //      rejection above.
      // Applied to BOTH premise + legacy entries — the spec PART 6
      // anti-patterns (caption-like, paradox/conundrum, "ultimately…")
      // are off-voice for both surface types, and the catalog audit
      // confirmed zero existing entries trip these rails so the
      // back-compat surface is preserved.
      const compressed = compressHook(candidate);
      const finalHook =
        compressed !== candidate && validateHook(compressed)
          ? compressed
          : candidate;
      if (!validateOutputLine(finalHook)) continue;
      // Phase 6E (PREMISE COMEDY SCORING + REJECTION) — for premise
      // entries, score the FINAL hook against the 5-dim 0-10 rubric
      // and HARD REJECT when total < 5 (or when the rubric tripped a
      // PART 3 explicit / structural reject pattern). Same self-
      // healing behavior as `validateHook` / `validateBigPremise` /
      // `validateOutputLine` rejection above — we `continue` to the
      // next phrasing in seed-rotated order so the premise pool can
      // self-heal toward a higher-quality hook for the same scenario
      // before falling through to the legacy passes.
      //
      // Phase 6F (LEGACY COMEDY SCORING + REJECTION) — symmetric
      // gate for legacy entries (entry.bigPremise !== true). Score
      // the FINAL hook against the 4-dim 0-10 legacy rubric and
      // HARD REJECT when total < 5 (or when the structural rails
      // — generic_filler list / no_anchor / too_long — tripped).
      // Same self-healing `continue` so the legacy pool can also
      // self-heal toward a higher-quality hook before exhausting.
      // The 5-band (demote) is allowed here and penalized
      // downstream in `selectionPenalty` via the scaled
      // `legacyComedyBoost` — a lighter boost band than the premise
      // boost (10→+5..5→-3) so the spec PART 6 tie-bias falls out
      // naturally: premise ≥7 still beats legacy ≥7 by ≥1pt;
      // legacy ≥7 beats premise ≤6 (correct per spec).
      let premiseComedyScore: PremiseComedyScore | undefined;
      let legacyComedyScore: LegacyComedyScore | undefined;
      if (entry.bigPremise === true) {
        const score = scorePremiseComedyScore(finalHook, entry, scenario);
        if (score.rejected || score.total < 5) continue;
        premiseComedyScore = score;
      } else {
        const score = scoreLegacyComedyScore(finalHook, entry, scenario);
        if (score.rejected || score.total < 5) continue;
        legacyComedyScore = score;
      }
      // Phase 6E (FOLLOWUP) + Phase 6F — best-scored selection for
      // BOTH premise and legacy walks. Each iteration's score is
      // pulled from whichever rubric produced it (premise OR legacy
      // — they're mutually exclusive per the if/else above), then
      // accumulated into `best` if it strictly beats the running
      // max. Strict `>` preserves earlier-wins tie semantics so the
      // walk stays deterministic and matches QA snapshot replay.
      // Short-circuit on a perfect 10 (no scan can improve).
      const result = {
        entry,
        index: idx,
        hook: finalHook,
        premiseComedyScore,
        legacyComedyScore,
      };
      const score =
        premiseComedyScore?.total ?? legacyComedyScore?.total ?? 0;
      const bestScore =
        best?.premiseComedyScore?.total ?? best?.legacyComedyScore?.total ?? 0;
      if (best === null || score > bestScore) {
        best = result;
        if (score >= 10) break;
      }
    }
    return best;
  };

  const voiceMatch = (e: LanguagePhrasingEntry) =>
    voiceProfile !== undefined &&
    (e.voiceProfiles?.includes(voiceProfile) ?? false);
  const voiceNeutral = (e: LanguagePhrasingEntry) =>
    e.voiceProfiles === undefined;
  const anyVoice = (_e: LanguagePhrasingEntry) => true;

  // Phase 6C (PREMISE-FIRST SELECTION) — per-slot deterministic gate.
  // ~80% of slots run the SAME 6-pass intent / voice matrix below
  // BUT restricted to entries with `bigPremise === true` BEFORE the
  // legacy passes; the remaining ~20% skip directly to legacy passes
  // so the catalog still ships some legacy/simple hooks for "rhythm
  // and variety" per spec PART 1.
  //
  // The seed already encodes (template, scenario, hookLanguageStyle,
  // slot index) per the picker's seeding discipline upstream, so a
  // single `seed % 100` bucket is sufficient and stable across cache
  // replay. Defensive `>>> 0` collapses any sign so the modulo is
  // always non-negative.
  const tryPremiseFirst =
    (seed >>> 0) % 100 < PREMISE_FIRST_BUCKET_PCT;

  // PREMISE-FIRST passes (when bucket allows). Mirror the legacy
  // intent-first / intent-fallback orchestration below, but each call
  // passes `premiseOnly = true` so non-premise entries are filtered
  // out of the seed-rotated walk. Premise picker failure (no premise
  // entry of any voice / intent validates for this scenario) naturally
  // drops to the legacy passes below — the SAME self-healing path the
  // legacy block already uses for validateHook / validateBigPremise
  // rejection — so we never fail to ship a hook just because the
  // premise pool happened to exhaust for this slot.
  if (tryPremiseFirst) {
    // PREMISE intent-first passes (when assignedIntent is set).
    if (assignedIntent !== undefined) {
      if (voiceProfile !== undefined) {
        const pm = walk(assignedIntent, voiceMatch, true);
        if (pm) return { ...pm, intentFallback: false };
        const pne = walk(assignedIntent, voiceNeutral, true);
        if (pne) return { ...pne, intentFallback: false };
      }
      const paw = walk(assignedIntent, anyVoice, true);
      if (paw) return { ...paw, intentFallback: false };
    }
    // PREMISE intent-fallback passes (premise-only, ANY intent).
    // Reached when no intent-matching premise validated above. We
    // PREFER an intent-relaxed premise over an intent-honored legacy
    // template per spec PART 1 ("Premise hooks are preferred BY
    // DEFAULT") — HookIntent diversity is enforced at the BATCH
    // level by `selectionPenalty` + `batchGuardsPass`, so picking a
    // premise with relaxed intent here is recoverable downstream.
    // The `intentFallback` flag tracks whether assignedIntent was
    // honored so QA can count true intent-starvation events.
    const premiseFallbackFlag = assignedIntent !== undefined;
    if (voiceProfile !== undefined) {
      const pm = walk(null, voiceMatch, true);
      if (pm) return { ...pm, intentFallback: premiseFallbackFlag };
      const pne = walk(null, voiceNeutral, true);
      if (pne) return { ...pne, intentFallback: premiseFallbackFlag };
    }
    const paw = walk(null, anyVoice, true);
    if (paw) return { ...paw, intentFallback: premiseFallbackFlag };
  }

  // LEGACY passes (premiseOnly = false default) — unchanged behavior.
  // Reached when:
  //   (a) the per-slot premise-first gate skipped premise passes
  //       (the ~20% legacy-variety reservation), OR
  //   (b) all 6 premise-only passes above exhausted without yielding
  //       a shippable hook (every premise entry failed validateHook /
  //       validateBigPremise / scenario fit / NEW validateOutputLine
  //       (T002) for this slot).
  //
  // INTENT-FIRST passes (when assignedIntent is set):
  //   1. intent + voice-match
  //   2. intent + voice-neutral
  //   3. intent + ANY voice (preserve intent at the cost of voice)
  // Then the SAME seed-rotated voice discipline as before, but WITHOUT
  // the intent filter — `intentFallback: true` flags the candidate so
  // PatternMeta can record the slot's assigned intent was not honored.
  if (assignedIntent !== undefined) {
    if (voiceProfile !== undefined) {
      const m = walk(assignedIntent, voiceMatch);
      if (m) return { ...m, intentFallback: false };
      const ne = walk(assignedIntent, voiceNeutral);
      if (ne) return { ...ne, intentFallback: false };
    }
    const aw = walk(assignedIntent, anyVoice);
    if (aw) return { ...aw, intentFallback: false };
  }

  // INTENT-FALLBACK passes (no intent constraint). Reached when:
  //   (a) `assignedIntent` was undefined (legacy / test callers), or
  //   (b) every intent-matching entry failed validation for this
  //       scenario. The `intentFallback` flag distinguishes these
  //       cases — true ONLY when an intent was requested but couldn't
  //       be honored, so the QA driver can count true intent
  //       starvation events without false positives from intent-less
  //       call paths.
  const fallbackFlag = assignedIntent !== undefined;
  if (voiceProfile !== undefined) {
    const m = walk(null, voiceMatch);
    if (m) return { ...m, intentFallback: fallbackFlag };
    const ne = walk(null, voiceNeutral);
    if (ne) return { ...ne, intentFallback: fallbackFlag };
  }
  const aw = walk(null, anyVoice);
  if (aw) return { ...aw, intentFallback: fallbackFlag };
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
  // TREND CONTEXT LAYER inputs — both optional so callers that
  // pre-date the layer (none in-tree, but the signature is exported
  // surface-area for the QA harness + future fallback wraps) get the
  // safe default of "no trend selection attempted, no trendId set".
  // `slotIndex` is the 0-indexed position the candidate would occupy
  // on success (`out.length`, NOT the Cartesian iter index — keeps
  // failed-build attempts from burning trend rotation slots, mirrors
  // the voiceForSlot discipline). `slotSalt` is folded into the
  // hash so different scenarioSeeds produce different trend
  // assignments for the same slotIndex.
  slotIndex: number = 0,
  slotSalt: number = 0,
  // Phase 4 (HOOK INTENT) — optional. The slot's assigned intent for
  // round-robin pool diversity (see `generatePatternCandidates` for the
  // assignment policy). Passed straight through to the picker, which
  // honors it via intent-first passes and falls back to ANY-intent
  // entries when no intent-matching entry validates for the chosen
  // (style, scenario) pair. The `meta.hookIntent` recorded BELOW comes
  // from the WINNING entry (`getEntryIntent(picked.entry)`), NOT from
  // `assignedIntent` — fallbacks change the actual intent and the
  // selector / batch guard / per-intent scorer all need the truth. The
  // separate `meta.intentFallback` flag records whether the slot's
  // assigned intent was honored, used by the QA driver to count
  // starvation events. When `assignedIntent` is undefined (legacy /
  // test callers) the picker is unfiltered and `intentFallback`
  // defaults to false.
  assignedIntent?: HookIntent,
  // Phase 5 (PATTERN MAPPING LAYER) — the live within-pool set of
  // VideoPatterns already chosen by previously-assembled candidates
  // in this generation call. Threaded straight into pickVideoPattern
  // as the `recentPatterns` axis so unused patterns rank above
  // recently-used ones, giving the pool natural pattern spread BEFORE
  // any selector / batch guard fires. Optional — undefined behaves
  // as "no recency signal" (every pattern is equally fresh). The
  // caller (generatePatternCandidates) MUST add the chosen
  // `meta.videoPattern` to its mutable backing set after a successful
  // build for the next slot to see the update — same discipline as
  // `slotsAlreadyVoiced` for voice rotation.
  recentVideoPatternsInPool?: ReadonlySet<VideoPattern>,
): { idea: Idea; meta: PatternMeta } | null {
  const picked = pickValidatedLanguagePhrasing(
    hookLanguageStyle,
    scenario,
    tone,
    hookPhrasingIndex,
    voiceProfile,
    assignedIntent,
  );
  if (!picked) return null;
  const {
    entry: sourceLanguagePhrasing,
    index,
    hook,
    intentFallback,
    // Phase 6E — picker walk attaches the rubric score for the
    // winning premise hook (undefined for legacy winners). Threaded
    // straight onto PatternMeta in the bigPremise block below so
    // `selectionPenalty.premiseComedyBoost` (ideaScorer.ts) can read
    // `meta.premiseComedyScore.total` and the QA driver can read
    // the per-dimension breakdown + boost mechanisms.
    premiseComedyScore: pickedPremiseComedyScore,
    // Phase 6F — symmetric to `pickedPremiseComedyScore`. Populated
    // when the picker selected a legacy template (mutually exclusive
    // with the premise field). Threaded onto PatternMeta in the
    // !bigPremise block below so `selectionPenalty.legacyComedyBoost`
    // can read `meta.legacyComedyScore.total` for the lighter scaled
    // boost band that preserves spec PART 6 tie-bias.
    legacyComedyScore: pickedLegacyComedyScore,
  } = picked;
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

  // Resolve scriptType ONCE so the archetype derivation and the
  // PatternMeta tag agree on which value drives both axes. The
  // archetype + archetypeFamily fall out deterministically from
  // scriptType via the IDEA ARCHETYPE spec's resolver; sceneObjectTag
  // + cluster fall out from scenarioFamily via the SCENE-OBJECT TAG
  // spec's lookup. All four are best-effort — an unresolved scriptType
  // (legacy taxonomy gap) leaves archetype undefined, which the
  // selector treats as "no contribution to archetype axis" (same
  // discipline as the existing optional fields below).
  //
  // HOISTED above the `idea` literal (was below in the pre-trend
  // shape) so the TREND CONTEXT LAYER selector has access to
  // `archetypeResolved.family` BEFORE the caption is frozen into the
  // idea object. Pure refactor — same lookups, same return shape.
  const scriptType = resolveScriptType(template.id, scenario.family);
  const archetypeResolved = resolveArchetype(scriptType);
  const sceneObjectTag = lookupSceneObjectTag(scenario.family) ?? undefined;
  const sceneEnvCluster: SceneEnvCluster | undefined = sceneObjectTag
    ? ENV_CLUSTER_BY_TAG[sceneObjectTag]
    : undefined;
  // IDEA CORE TYPE axis (Phase 1) — resolved BEFORE hook generation per
  // spec so downstream hook+caption generation has access to the
  // narrative family this candidate is committing to. Both fields are
  // always set on pattern_variation candidates (the resolver returns
  // a non-null type for every (template, family) pair via the
  // `planned_vs_did` fallback in `resolveIdeaCoreType`).
  const ideaCoreType = resolveIdeaCoreType(template.id, scenario.family);
  const ideaCoreFamily = resolveIdeaCoreFamily(ideaCoreType);

  // Phase 5 (PATTERN MAPPING LAYER) — resolve VideoPattern AFTER
  // `ideaCoreFamily` and the winning entry's hook intent are both
  // known. We use `getEntryIntent(sourceLanguagePhrasing)` (the
  // ACTUAL intent of the entry that won, NOT `assignedIntent`) so
  // intent-fallback slots get pattern selection consistent with the
  // intent they're actually shipping with — keeps videoPattern in
  // sync with `meta.hookIntent` below. The seed folds slotSalt with
  // the family + intent name lengths so two slots with the same
  // (family, intent, recent) inputs but different slotSalt produce
  // different deterministic picks.
  const resolvedHookIntent = getEntryIntent(sourceLanguagePhrasing);
  // Phase 6B — pass the entry's fine-grained premiseStyleId (when
  // present) so `pickVideoPattern` can apply the alignment overlay
  // (style → patterns) on top of the family/intent allowlist. Legacy
  // / Llama / Claude / fallback entries don't carry premiseStyleId
  // and therefore route through the unchanged family/intent path.
  const {
    pattern: videoPattern,
    intentFallback: videoPatternIntentFallback,
    premiseStyleAlignmentApplied: videoPatternPremiseStyleAligned,
  } = pickVideoPattern(
    ideaCoreFamily,
    resolvedHookIntent,
    recentVideoPatternsInPool ?? new Set<VideoPattern>(),
    (slotSalt ^
      ((ideaCoreFamily.length * 13 + resolvedHookIntent.length) >>> 0)) >>>
      0,
    sourceLanguagePhrasing.premiseStyleId,
  );
  // Copy beats by spread so `idea.filmingGuide` isn't a reference
  // to the catalog's readonly array — downstream code that wants
  // to mutate / annotate gets a private mutable string[].
  const filmingGuide: string[] = [...PATTERN_DEFS[videoPattern].beats];

  // TREND CONTEXT LAYER (lightweight overlay, NOT a new generator).
  // The selector returns null for ~70% of candidates by design (the
  // 30%-bucket gate inside `selectTrendForCandidate`), and for the
  // remaining ~30% it returns null again whenever NO catalog item
  // passes the strict `(scenarioFamily, archetypeFamily)` fit
  // predicate. So the actual emission rate is ≤30% by construction.
  // Soft-skip discipline: when the transform fails the validator
  // chain, we drop `meta.trendId` AND revert to the un-transformed
  // caption — the candidate STILL ships, just without the trend tag
  // (no whole-batch rejection — trends are an OPTIONAL overlay per
  // the spec).
  const selectedTrend: TrendItem | null = selectTrendForCandidate({
    slotIndex,
    scenarioFamily: scenario.family,
    archetypeFamily: archetypeResolved?.family,
    salt: slotSalt,
  });
  // `isCleanCaption` = the substring half of `validateHook`. We DON'T
  // call `validateHook` directly because it requires a 3-10 word
  // count which most captions exceed by design. The substring checks
  // (banned-prefix / generic-filler / voice-violation) catch the
  // realistic catalog-drift failure modes — e.g. a phrase trend
  // whose label composes into a banned hook prefix.
  const isCleanCaption = (s: string): boolean => {
    if (lookupBannedHookPrefix(s)) return false;
    if (containsGenericFiller(s)) return false;
    if (containsVoiceViolation(s)) return false;
    return true;
  };
  let trendId: string | undefined;
  let originalCaption: string | undefined;
  let captionAfterTrend = caption;
  if (selectedTrend) {
    const transformed = applyTrendToCaption(
      caption,
      selectedTrend,
      scenario.topicNoun,
    );
    if (validateTrendInjection(caption, transformed, isCleanCaption)) {
      captionAfterTrend = transformed;
      trendId = selectedTrend.id;
      // TREND + ARCHETYPE PAIRING spec — snapshot the pre-trend
      // caption so `enforceTrendCap` (hybridIdeator finalization
      // pass) can revert deterministically when the within-batch
      // HARD CAP fires. Object substitution + behavior/format/
      // phrase appends aren't trivially reversible from the
      // transformed string alone (parenthetical positions vary
      // with idempotency normalization, object swaps need the
      // original noun lookup), so we capture the source string
      // here at injection time. Always paired with `trendId` —
      // both set together, both cleared together on revert.
      originalCaption = caption;
    }
    // else: validator rejected (no-op substitution OR clean check
    // failed) → soft skip: keep original caption, leave trendId
    // undefined. No telemetry emit here — the harness covers the
    // skip rate, and per-candidate trend skips are intentionally
    // silent (NOT a defect to surface to logs at request scale).
  }

  // PHASE Y3 (LOCAL premiseCoreId TAGGING) — resolve a core id from
  // the picked entry's fine-grained `(premiseStyleId, executionId)`
  // pair via the deterministic `premiseCoreLocalMapping` lookup.
  // Returns undefined when:
  //   (a) the entry is not bigPremise (legacy / scenario-shaped),
  //   (b) either fine-grained tag is missing (the original 29
  //       hand-written premise entries ship only the bucket id), OR
  //   (c) the pair is intentionally unmapped (ambiguous between
  //       cores — telemetry surfaces these as topUnmappedPremiseHooks
  //       for a follow-up mapping pass).
  // Mirrored to BOTH `idea.premiseCoreId` (cache-resident, picked up
  // by `buildNoveltyContext`'s `e.idea.premiseCoreId` read site) AND
  // `meta.premiseCoreId` (in-flight de-dup against Claude wraps in
  // the same batch — mirrors hybridIdeator's existing meta.premiseCoreId
  // mirroring at the Claude wrap site). Same value, two surfaces.
  const localPremiseCoreId: string | undefined = sourceLanguagePhrasing.bigPremise
    ? resolvePremiseCoreIdForLocalCandidate({
        premiseStyleId: sourceLanguagePhrasing.premiseStyleId,
        executionId: sourceLanguagePhrasing.executionId,
      })
    : undefined;

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
    caption: captionAfterTrend,
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
    // Phase 5 (PATTERN MAPPING LAYER) — ordered shot beats from
    // PATTERN_DEFS[videoPattern].beats. Always set on Phase-5
    // pattern_variation candidates. The legacy `howToFilm` prose
    // field above stays UNTOUCHED so existing UI paths and JSONB
    // cache readers continue to render without change.
    filmingGuide,
    // PHASE Y3 — local-pool premiseCoreId tag (see resolution above).
    // Spread-when-present so untagged candidates leave the field
    // undefined rather than serialising explicit nulls into JSONB.
    // `buildNoveltyContext` reads `e.idea.premiseCoreId` directly
    // off the cache envelope — this assignment is what makes the
    // existing recentPremiseCoreIds lever fire on Layer-1 entries.
    ...(localPremiseCoreId ? { premiseCoreId: localPremiseCoreId } : {}),
  };

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
      ideaCoreType,
      ideaCoreFamily,
      energy: ENERGY_BY_VISUAL_ACTION[visualActionPattern],
      archetype: archetypeResolved?.archetype,
      archetypeFamily: archetypeResolved?.family,
      sceneObjectTag,
      sceneEnvCluster,
      hookLanguageStyle,
      voiceProfile,
      // `trendId` is undefined when no trend was selected (~70% of
      // candidates by gate design + the strict-fit rejections), AND
      // when the validator soft-skipped a transformation. Readers
      // MUST treat absent as "no contribution to the trend axis"
      // (same discipline as `voiceProfile`).
      trendId,
      // TREND + ARCHETYPE PAIRING spec — `originalCaption` is the
      // pre-trend snapshot, set ONLY when `trendId` is set (paired
      // 1-to-1 above). Used by `enforceTrendCap` to revert the
      // caption when the within-batch HARD CAP fires. Undefined
      // when no trend was applied — readers MUST treat absent as
      // "no revert source available" (skip the candidate, never
      // attempt synthesis).
      originalCaption,
      // Phase 3 PART 1+3 — `LanguagePhrasingEntry` reference for
      // `scoreScrollStop` rigidity penalty + sharpness boost. Always
      // set on pattern_variation candidates (the picker returns the
      // entry alongside index + hook). RUNTIME-ONLY — see PatternMeta
      // JSDoc above for the JSON-serialization caveat (scores survive,
      // build fn does not — score lookups via getEntryScores still
      // work on rehydrated entries).
      sourceLanguagePhrasing,
      // Phase 4 (HOOK INTENT) — derived from the WINNING entry, NOT
      // from the slot's `assignedIntent`. When the picker's intent-
      // first passes succeed these are equal; when they fail and the
      // intent-fallback passes win, this records the actual intent
      // the candidate ships with (so the per-intent scorer + batch
      // guard see the truth, not the request). Always set on
      // pattern_variation candidates — `getEntryIntent` defaults to
      // `scroll_stop` for legacy entries lacking the field, which
      // means a non-tagged Phase 1/2 catalog entry would still
      // produce a non-null intent here. (Every Phase 3 entry IS
      // tagged, so the default never triggers in the current
      // generation flow — kept for future Claude/Llama wraps.)
      hookIntent: getEntryIntent(sourceLanguagePhrasing),
      // Phase 4 (HOOK INTENT) — telemetry for the QA driver. Only
      // SET when an `assignedIntent` was passed AND the picker had
      // to fall back to a different intent (no intent-matching entry
      // validated). Stays undefined when the slot's intent was
      // honored OR when no intent was requested — the latter so QA
      // counts only real starvation events, not intent-less call
      // paths.
      ...(intentFallback ? { intentFallback: true } : {}),
      // Phase 5 (PATTERN MAPPING LAYER) — the typed VideoPattern axis
      // resolved above via pickVideoPattern. ALWAYS set on Phase-5
      // pattern_variation candidates. Drives the within-batch hard
      // guard h2 (≤2 picks per pattern), the cross-batch novelty
      // penalty (-3 per match against NoveltyContext.recentVideoPatterns),
      // and the within-pool recency rank for the next slot's
      // pickVideoPattern call (via generatePatternCandidates'
      // recentVideoPatterns mutable Set).
      videoPattern,
      // Phase 5 telemetry — emitted ONLY when the pickVideoPattern
      // had to fall back to family-only (no family-allowed pattern
      // was intent-compat for `resolvedHookIntent`). By construction
      // this never fires for any (family, intent) combo in the
      // current catalog (verified by the QA driver), but the field
      // exists so future catalog additions surface starvation in
      // telemetry instead of silently corrupting selection.
      ...(videoPatternIntentFallback
        ? { videoPatternIntentFallback: true }
        : {}),
      // Phase 6B — telemetry: true when the chosen videoPattern was
      // filtered through the premiseStyleId → patterns alignment map.
      // Spread-when-true so non-premise entries (no premiseStyleId)
      // and premise entries with empty intersection (alignment fell
      // through to family/intent path) leave the field absent.
      ...(videoPatternPremiseStyleAligned
        ? { videoPatternPremiseStyleAligned: true }
        : {}),
      // Phase 3 HOOK TEMPLATE TUNING — propagate the formulaic
      // skeleton id from the WINNING entry. Spread-when-present so
      // entries whose phrasing is genuinely scenario-shaped (no
      // skeletonId tag) leave `meta.hookSkeletonId` undefined rather
      // than serialising an explicit `undefined` into JSONB. The
      // selectionPenalty + cross-batch novelty levers treat absent
      // as "no contribution to the skeleton axis", so an untagged
      // entry never matches the recent / frequent skeleton sets.
      ...(sourceLanguagePhrasing.skeletonId
        ? { hookSkeletonId: sourceLanguagePhrasing.skeletonId }
        : {}),
      // Phase 6 (BIG PREMISE LAYER) — propagate the winning entry's
      // premise flag + style. Spread-when-present so legacy template
      // entries (no `bigPremise` flag) leave both fields undefined
      // rather than serialising explicit `false` / `undefined` into
      // JSONB. The selector reads `bigPremiseStyle` for both within-
      // batch (-3 dup) and cross-batch (-2 in `recentBigPremiseStyles`)
      // novelty levers; `usedBigPremise` is telemetry-only (QA driver
      // counts premises shipped per batch).
      ...(sourceLanguagePhrasing.bigPremise
        ? {
            usedBigPremise: true,
            ...(sourceLanguagePhrasing.premiseStyle
              ? { bigPremiseStyle: sourceLanguagePhrasing.premiseStyle }
              : {}),
            // Phase 6 EXPANSION — propagate fine-grained 50-style id
            // + derived label. Spread-when-present so the original
            // 29 hand-written premise entries (which only carry the
            // bucket-level `premiseStyle` field) leave both the id
            // and label fields undefined rather than serialising
            // explicit nulls. The selector reads `premiseStyleId`
            // for both within-batch (-3 per dup) and cross-batch (-2
            // in `recentPremiseStyleIds`) novelty levers; the label
            // is telemetry-only OUTPUT METADATA per spec.
            ...(sourceLanguagePhrasing.premiseStyleId
              ? {
                  premiseStyleId: sourceLanguagePhrasing.premiseStyleId,
                  premiseStyleLabel:
                    PREMISE_STYLE_LABELS[sourceLanguagePhrasing.premiseStyleId],
                }
              : {}),
            // Phase 6D (PREMISE EXECUTION EXPANSION) — propagate fine-
            // grained execution-pattern id to PatternMeta so the cache
            // write site (`toCacheEntries`) can persist it for the
            // next regen's `recentExecutionIds` derivation, and so
            // `selectionPenalty` / `batchGuardsPass` can read it for
            // the cross-batch -2/+2 levers + within-batch HARD tuple
            // dedup. Spread-when-present so the original 29 hand-
            // written premise entries (which carry only the bucket
            // and style ids, no execution tag) leave the field
            // undefined rather than serialising explicit nulls. Same
            // discipline as the `premiseStyleId` block above.
            ...(sourceLanguagePhrasing.executionId
              ? { executionId: sourceLanguagePhrasing.executionId }
              : {}),
            // Phase 6E (PREMISE COMEDY SCORING + REJECTION) —
            // propagate the picker-walk's rubric score for the
            // winning premise hook to PatternMeta. Spread-when-
            // present so a defensive miss (premise entry that
            // somehow reached `assembleCandidate` without scoring,
            // e.g. a stale path) leaves the field undefined rather
            // than serialising explicit nulls — matching the
            // `premiseStyleId` / `executionId` discipline above.
            // The selection-layer scaled boost
            // (`selectionPenalty.premiseComedyBoost`) reads
            // `meta.premiseComedyScore?.total`; absent-or-zero
            // gracefully maps to a 0 boost contribution so a
            // missing score never accidentally promotes or demotes
            // a legacy candidate. The QA driver (T005) reads the
            // full breakdown for the PART 8 report.
            ...(pickedPremiseComedyScore !== undefined
              ? { premiseComedyScore: pickedPremiseComedyScore }
              : {}),
            // PHASE Y3 — mirror the local-resolved premiseCoreId onto
            // PatternMeta so the in-flight Claude-wrap dedup at
            // hybridIdeator (`recentCoreIds` rescue filter) sees
            // local-tagged candidates the same way it sees
            // Claude-tagged ones. Spread-when-present so unmapped /
            // legacy entries leave the field undefined. The `idea`
            // mirror above is what survives JSONB round-trip via
            // toCacheEntries; this meta mirror is runtime-only for
            // same-batch dedup.
            ...(localPremiseCoreId
              ? { premiseCoreId: localPremiseCoreId }
              : {}),
          }
        : {}),
      // Phase 6F (LEGACY COMEDY SCORING + REJECTION) — propagate the
      // picker walk's legacy rubric score onto PatternMeta when the
      // WINNING entry was a legacy template (entry.bigPremise !==
      // true). Sits OUTSIDE the bigPremise spread above (which is
      // gated on `sourceLanguagePhrasing.bigPremise`) so the legacy
      // field never co-exists with the premise field — the two
      // surfaces are mutually exclusive by construction (the picker
      // walk's if/else assigns at most one). Spread-when-present so
      // a defensive miss leaves the field undefined rather than
      // serialising explicit nulls — same discipline as the
      // `premiseStyleId` / `executionId` / `premiseComedyScore`
      // blocks. The selection-layer scaled boost
      // (`selectionPenalty.legacyComedyBoost`) reads
      // `meta.legacyComedyScore?.total`; absent-or-zero gracefully
      // maps to a 0 boost contribution so a missing score never
      // accidentally promotes or demotes a candidate. The QA driver
      // reads the full breakdown for the PART 8 report.
      ...(pickedLegacyComedyScore !== undefined
        ? { legacyComedyScore: pickedLegacyComedyScore }
        : {}),
      // Phase 7 (VIRAL FEEL SCORE) — final ranking polish layer.
      // Computed AFTER `videoPattern` is resolved above (so the
      // formatFit dim can read the chosen pattern × premiseStyleId
      // synergy) AND AFTER both comedy-score blocks are constructed
      // (the viral score is a SEPARATE final layer — it never
      // displaces the comedy boosts in selection, only complements
      // them per spec PART 5). Pure function — same `(hook, meta,
      // scenario)` triple always yields the same score, so ordering
      // here is stable across re-runs. Spread-when-defined kept for
      // discipline, though `scoreViralFeel` is total (always returns
      // a value) — the spread guards against future changes that
      // might introduce an undefined-path. The selection-layer
      // boost reads `meta.viralFeelScore?.total`, so the absent
      // path collapses cleanly to `viralFeelBoost(undefined) === 0`.
      viralFeelScore: scoreViralFeel(
        hook,
        {
          videoPattern,
          ...(sourceLanguagePhrasing.bigPremise &&
          sourceLanguagePhrasing.premiseStyleId
            ? { premiseStyleId: sourceLanguagePhrasing.premiseStyleId }
            : {}),
        },
        scenario,
      ),
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
  // Phase 5 (PATTERN MAPPING LAYER) — within-pool VideoPattern
  // recency. Mutated after every successful build so the next
  // slot's pickVideoPattern call ranks already-used patterns BELOW
  // unused ones. This gives the candidate POOL natural pattern
  // spread BEFORE the downstream selector / batch guards see it,
  // mirroring how `slotsAlreadyVoiced` shapes voice rotation. Reset
  // unnecessary for the same reason — the picker is monotonic per
  // generation call.
  const recentVideoPatterns = new Set<VideoPattern>();
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
    void slotsAlreadyVoiced;
    void voiceSelection.primary;
    // HOOK INTENT axis (Phase 4) — round-robin over the 3-value
    // HOOK_INTENTS array, indexed by `out.length` (the slot the
    // candidate would occupy on success — same discipline as
    // `voiceForSlot` and the trend layer's `slotIndex`, so failed-
    // build attempts don't burn intent rotation slots). With target=16
    // this guarantees the candidate POOL spans intents (≈5-6 of each
    // before the diversifier sees it) BEFORE any selection guard
    // fires — the soft preference for "1 of each in a batch of 3"
    // emerges naturally from the rotation. The picker honors this as
    // a hard filter on the chosen language-style's entries with a
    // graceful fallback when the (style, scenario) pair has no intent-
    // matching entry that validates (telemetry-only flag — see
    // `meta.intentFallback` in PatternMeta).
    const assignedIntent: HookIntent =
      HOOK_INTENTS[out.length % HOOK_INTENTS.length]!;
    // assembleCandidate returns null when NO phrasing in the chosen
    // hookLanguageStyle passes `validateHook` for this scenario (e.g.
    // every variant overruns 10 words for the longest realityShort,
    // or every variant matches a banned-prefix). Skip the triple
    // silently — the weave will offer many more before hitting
    // maxIter (T·S·H = 6·25·12 = 1800 triples).
    //
    // TREND CONTEXT LAYER inputs: `slotIndex = out.length` (the slot
    // the candidate would occupy on success — same discipline as
    // `voiceForSlot` so failed-build attempts don't burn trend
    // rotation slots) and `slotSalt = scenarioSeed` (a stable fold
    // of the (template, scenario, hls) triple, so cache replays
    // produce the same trend assignment for the same input).
    const built = assembleCandidate(
      t,
      s,
      hls,
      tone,
      i + seedSalt,
      (i * 3 + seedSalt) % 7,
      voiceForSlot,
      out.length,
      scenarioSeed,
      assignedIntent,
      recentVideoPatterns,
    );
    if (built !== null) {
      out.push(built);
      slotsAlreadyVoiced.push(voiceForSlot);
      // Phase 5 (PATTERN MAPPING LAYER) — record the chosen pattern
      // so the next slot's pickVideoPattern call ranks it BELOW
      // unused patterns. Always set on Phase-5 candidates (defensive
      // optional-chain for safety against future non-pattern-variation
      // sources slipping through this loop).
      if (built.meta.videoPattern !== undefined) {
        recentVideoPatterns.add(built.meta.videoPattern);
      }
    }
  }

  return interleaveByIdeaCoreFamily(applyPoolCaps(out));
}

/**
 * Hard distribution caps applied to the candidate pool BEFORE interleave.
 *
 * Phase 1: caps are now driven by the IdeaCoreType axis (not the inert
 * scriptType axis). Ensures no single ideaCoreType — and no single
 * ideaCoreFamily — can dominate the downstream selector's pool:
 *   - Per-type   cap:  ceil(N * 0.15)  (≤15% any single ideaCoreType)
 *   - Per-family cap:  ceil(N * 0.35)  (≤35% any single ideaCoreFamily)
 *
 * The tighter per-type cap (15% vs the prior 20%) reflects the larger
 * catalog (120 types vs 37 scriptTypes) — even a 15% cap is a generous
 * 18-of-120 ceiling on a typical pool. The per-family cap is sized
 * just below the per-batch <40% failure_contradiction guard so the
 * pool naturally underfills the worst-case batch ratio rather than
 * relying on the batch guard to be the only line of defense.
 *
 * Tail-drop preserves the upstream Cartesian-weave + memory-bias
 * ordering for the entries that survive (we drop OVERFLOW entries
 * encountered after the cap, never reorder kept entries). For pools
 * with ≤5 entries the caps are no-ops — the pool is already small
 * enough that any single dominant family is structural rather than
 * fixable by pruning. Candidates without an ideaCoreType (legacy /
 * fallback paths) bypass the per-type / per-family caps but still
 * count toward total N for cap calculation.
 */
export function applyPoolCaps(
  candidates: PatternCandidate[],
): PatternCandidate[] {
  if (candidates.length <= 5) return candidates;
  const N = candidates.length;
  const perTypeCap = Math.max(1, Math.ceil(N * 0.15));
  const perFamilyCap = Math.max(1, Math.ceil(N * 0.35));
  const typeCounts = new Map<IdeaCoreType, number>();
  const familyCounts = new Map<IdeaCoreFamily, number>();
  const out: PatternCandidate[] = [];
  for (const c of candidates) {
    const t = c.meta.ideaCoreType;
    const f = c.meta.ideaCoreFamily;
    if (!t || !f) {
      out.push(c);
      continue;
    }
    const tc = typeCounts.get(t) ?? 0;
    if (tc >= perTypeCap) continue;
    const fc = familyCounts.get(f) ?? 0;
    if (fc >= perFamilyCap) continue;
    typeCounts.set(t, tc + 1);
    familyCounts.set(f, fc + 1);
    out.push(c);
  }
  return out;
}

/**
 * Round-robin interleave the candidate pool by `meta.ideaCoreFamily`
 * (Phase 1 — was `meta.scriptType` pre-Phase-1). Buckets candidates by
 * family, then emits one from each bucket per pass until empty.
 * Guarantees that the FIRST 6+ candidates span as many distinct
 * IdeaCoreFamilies as the natural pool supports, making the downstream
 * selector's job dramatically easier — the highest-quality picks no
 * longer all cluster on the same narrative family just because that
 * family's scenarios sorted to the front of the Cartesian weave.
 *
 * Soft, NOT hard: never drops candidates. Candidates with no
 * ideaCoreFamily (legacy / fallback paths that may not resolve a
 * taxonomy entry) bucket under "_unknown" and are interleaved
 * alongside the typed buckets so they still ship.
 *
 * Bucket order = first-appearance order in the input, which preserves
 * the upstream memory bias (the creator's top-structure scenarios
 * surface their family buckets first in the rotation).
 */
function interleaveByIdeaCoreFamily(
  candidates: PatternCandidate[],
): PatternCandidate[] {
  if (candidates.length <= 1) return candidates;
  const buckets = new Map<string, PatternCandidate[]>();
  const order: string[] = [];
  for (const c of candidates) {
    const key = c.meta.ideaCoreFamily ?? "_unknown";
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
