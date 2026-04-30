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
};

export const HOOK_PHRASINGS_BY_STYLE: Record<HookStyle, HookPhrasingEntry[]> = {
  the_way_i: [
    {
      opener: "the_way_i",
      build: (s) => `the way I avoid ${s.topicNoun} like a sport`,
      hookIntent: "relatable",
    },
    {
      opener: "the_way_i",
      build: (s) => `the way I gaslight myself about ${s.topicNoun}`,
      hookIntent: "relatable",
    },
    {
      opener: "me_saying",
      build: (s) => `me, refusing to deal with ${s.topicNoun}`,
      hookIntent: "relatable",
    },
  ],
  why_do_i: [
    {
      opener: "why_did_i",
      build: (s) => `why did I lie to myself about ${s.topicNoun}`,
      hookIntent: "relatable",
    },
    {
      opener: "why_did_i",
      build: (s) => `why did I expect anything from ${s.topicNoun}`,
      hookIntent: "relatable",
    },
    {
      opener: "denial_statement",
      build: (s) => `I am totally fine about ${s.topicNoun}`,
      hookIntent: "relatable",
    },
  ],
  internal_thought: [
    {
      opener: "i_really",
      build: (s) => `I really thought I'd ${s.actionShort}`,
      hookIntent: "relatable",
    },
    {
      opener: "i_really",
      build: (s) => `I really planned to handle ${s.topicNoun}`,
      hookIntent: "relatable",
    },
    {
      opener: "me_saying",
      build: (s) => `me, lying about ${s.topicNoun} again`,
      hookIntent: "relatable",
    },
  ],
  contrast: [
    {
      opener: "what_i_planned_vs",
      build: () => `what I planned vs how it actually went`,
      hookIntent: "relatable",
    },
    {
      opener: "what_i_planned_vs",
      build: () => `what morning me promised vs night me delivered`,
      hookIntent: "relatable",
    },
    {
      opener: "me_saying",
      build: () => `me at 9am vs me at 9pm`,
      hookIntent: "relatable",
    },
  ],
  curiosity: [
    {
      opener: "this_is_where",
      build: () => `this is where the plan officially fell apart`,
      hookIntent: "compulsion",
    },
    {
      opener: "silent_panic",
      build: () => `silent panic, zero words, full body`,
      hookIntent: "scroll_stop",
    },
    {
      opener: "realization",
      build: () => `the moment I knew I was never going`,
      hookIntent: "compulsion",
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
      build: (s) => `I lied about ${s.actionShort}`,
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
    },
    {
      build: (s) => `${s.topicNoun} is my whole personality now`,
      voiceProfiles: ["poetic", "self_aware", "soft_confessional"],
      rigidityScore: 3,
      sharpnessScore: 3,
      hookIntent: "relatable",
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
    },
    {
      build: () => `this ruined my mood`,
      voiceProfiles: ["soft_confessional", "blunt", "dry_humor"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
    },
    {
      build: () => `i hate this part`,
      voiceProfiles: ["blunt", "soft_confessional", "deadpan"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
    },
    {
      build: () => `i did not try that hard`,
      voiceProfiles: ["self_aware", "dry_humor", "soft_confessional"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "relatable",
    },
  ],
  observation: [
    {
      build: (s) => `there's always one ${s.topicNoun} you never deal with`,
      voiceProfiles: ["dry_humor", "deadpan", "poetic"],
      rigidityScore: 3,
      sharpnessScore: 3,
      hookIntent: "relatable",
    },
    {
      build: (s) => `everybody has a ${s.topicNoun} they keep avoiding`,
      voiceProfiles: ["dry_humor", "deadpan", "soft_confessional"],
      rigidityScore: 4,
      sharpnessScore: 2,
      hookIntent: "relatable",
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
    },
    {
      build: (s) => `${s.topicNoun} is a personality trait apparently`,
      voiceProfiles: ["sarcastic", "chaotic", "dry_humor", "self_aware"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "relatable",
    },
    {
      build: () => `the small things become the whole thing eventually`,
      voiceProfiles: ["poetic", "soft_confessional", "self_aware"],
      rigidityScore: 4,
      sharpnessScore: 3,
      hookIntent: "compulsion",
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
    },
    {
      build: () => `i keep doing this. cool.`,
      voiceProfiles: ["self_aware", "sarcastic", "dry_humor"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "relatable",
    },
    {
      build: () => `this is on me, fully`,
      voiceProfiles: ["self_aware", "blunt", "soft_confessional"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "relatable",
    },
    {
      build: () => `i already know how this ends`,
      voiceProfiles: ["self_aware", "deadpan", "soft_confessional"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "compulsion",
    },
  ],
  absurd_claim: [
    {
      build: (s) => `${s.topicNoun} and I are in a standoff`,
      voiceProfiles: ["dry_humor", "sarcastic", "chaotic"],
      rigidityScore: 3,
      sharpnessScore: 3,
      hookIntent: "scroll_stop",
    },
    {
      build: (s) => `${s.topicNoun} pays rent here at this point`,
      voiceProfiles: ["chaotic", "sarcastic", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
    },
    {
      build: (s) => `pretty sure ${s.topicNoun} runs my schedule now`,
      voiceProfiles: ["chaotic", "sarcastic", "self_aware"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
    },
    {
      build: (s) => `${s.topicNoun} is officially a third roommate`,
      voiceProfiles: ["chaotic", "dry_humor", "sarcastic"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
    },
    {
      build: (s) => `${s.topicNoun} feels like a villain origin story`,
      voiceProfiles: ["sarcastic", "chaotic", "self_aware"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "compulsion",
    },
    {
      build: (s) => `${s.topicNoun} is sentient and we both know`,
      voiceProfiles: ["deadpan", "dry_humor", "chaotic"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
    },
    {
      build: (s) => `we are quietly losing to ${s.topicNoun} again`,
      voiceProfiles: ["soft_confessional", "deadpan", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "relatable",
    },
  ],
  matter_of_fact: [
    {
      build: (s) => `${s.topicNoun} won today, again`,
      voiceProfiles: ["blunt", "deadpan", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
    },
    {
      build: (s) => `${s.topicNoun} is staying exactly where it is`,
      voiceProfiles: ["blunt", "deadpan", "dry_humor"],
      rigidityScore: 3,
      sharpnessScore: 3,
      hookIntent: "scroll_stop",
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
    },
    {
      build: (s) => `nothing changed. ${s.realityShort}.`,
      voiceProfiles: ["blunt", "deadpan", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
    },
    {
      build: (s) => `no progress. ${s.topicNoun} remains.`,
      voiceProfiles: ["deadpan", "soft_confessional", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
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
    },
    {
      build: () => `no progress made`,
      voiceProfiles: ["deadpan", "blunt", "dry_humor"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
    },
    {
      build: () => `i did not do it`,
      voiceProfiles: ["blunt", "deadpan", "soft_confessional"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "relatable",
    },
    {
      build: () => `i gave up early`,
      voiceProfiles: ["deadpan", "soft_confessional", "dry_humor"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "relatable",
    },
    {
      build: () => `this didn't work`,
      voiceProfiles: ["blunt", "deadpan", "dry_humor"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
    },
  ],
  question: [
    {
      build: (s) => `at what point do we admit ${s.topicNoun}`,
      voiceProfiles: ["self_aware", "dry_humor", "blunt"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "compulsion",
    },
    {
      build: (s) => `how many days does ${s.topicNoun} get`,
      voiceProfiles: ["sarcastic", "dry_humor", "blunt"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "compulsion",
    },
    {
      build: () => `who decided this was fine again`,
      voiceProfiles: ["sarcastic", "dry_humor", "self_aware"],
      rigidityScore: 4,
      sharpnessScore: 3,
      hookIntent: "compulsion",
    },
    {
      build: (s) => `is it really still about ${s.topicNoun}`,
      voiceProfiles: ["self_aware", "soft_confessional", "dry_humor"],
      rigidityScore: 3,
      sharpnessScore: 3,
      hookIntent: "compulsion",
    },
    {
      build: (s) => `what if ${s.topicNoun} was the answer all along`,
      voiceProfiles: ["poetic", "self_aware", "dry_humor"],
      rigidityScore: 4,
      sharpnessScore: 2,
      hookIntent: "compulsion",
    },
    {
      build: (s) => `how many days of pretending about ${s.topicNoun}`,
      voiceProfiles: ["soft_confessional", "self_aware", "deadpan"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "compulsion",
    },
  ],
  instruction: [
    {
      build: (s) => `how to avoid ${s.topicNoun} in three steps`,
      voiceProfiles: ["sarcastic", "dry_humor", "chaotic"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "compulsion",
    },
    {
      build: (s) => `pro tip: skip ${s.topicNoun} today`,
      voiceProfiles: ["sarcastic", "blunt", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "compulsion",
    },
    {
      build: (s) => `tutorial: how to ignore ${s.topicNoun} forever`,
      voiceProfiles: ["sarcastic", "chaotic", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "compulsion",
    },
    {
      build: () => `step one: stare. step two: leave.`,
      voiceProfiles: ["deadpan", "dry_humor", "sarcastic"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "compulsion",
    },
    {
      build: () => `lesson one: do less, see what happens`,
      voiceProfiles: ["deadpan", "soft_confessional", "dry_humor"],
      rigidityScore: 4,
      sharpnessScore: 2,
      hookIntent: "compulsion",
    },
    {
      build: (s) => `today's reminder: ${s.topicNoun} is allowed to wait`,
      voiceProfiles: ["poetic", "self_aware", "soft_confessional"],
      rigidityScore: 3,
      sharpnessScore: 3,
      hookIntent: "relatable",
    },
  ],
  micro_story: [
    {
      build: (s) => `open ${s.topicNoun}, stare, close it, walk away`,
      voiceProfiles: ["deadpan", "dry_humor", "blunt"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "relatable",
    },
    {
      build: (s) =>
        `looked at ${s.topicNoun}, did nothing, continued scrolling`,
      voiceProfiles: ["deadpan", "dry_humor", "blunt"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "relatable",
    },
    {
      build: () => `I open it, glance, close it, pretend that counted`,
      voiceProfiles: ["self_aware", "dry_humor", "deadpan"],
      rigidityScore: 2,
      sharpnessScore: 5,
      hookIntent: "relatable",
    },
    {
      build: (s) => `walks past ${s.topicNoun}, nods, keeps walking`,
      voiceProfiles: ["deadpan", "dry_humor", "blunt"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "relatable",
    },
    {
      build: (s) => `spent five minutes preparing to think about ${s.topicNoun}`,
      voiceProfiles: ["soft_confessional", "self_aware", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "relatable",
    },
    {
      build: (s) => `stood near ${s.topicNoun} like a forgotten ghost`,
      voiceProfiles: ["poetic", "soft_confessional", "deadpan"],
      rigidityScore: 3,
      sharpnessScore: 3,
      hookIntent: "relatable",
    },
    // Phase 3 PART 1 NARRATIVE additions — short two-beat micro-stories.
    // Period mid-string triggers the +3 scrollStop fragment boost.
    {
      build: () => `i opened it. then closed it.`,
      voiceProfiles: ["deadpan", "dry_humor", "blunt"],
      rigidityScore: 4,
      sharpnessScore: 4,
      hookIntent: "relatable",
    },
    {
      build: () => `i started. then stopped.`,
      voiceProfiles: ["deadpan", "blunt", "dry_humor"],
      rigidityScore: 4,
      sharpnessScore: 5,
      hookIntent: "relatable",
    },
    {
      build: () => `i saw it. walked away.`,
      voiceProfiles: ["deadpan", "dry_humor", "blunt"],
      rigidityScore: 4,
      sharpnessScore: 5,
      hookIntent: "relatable",
    },
  ],
  comparison: [
    {
      build: (s) => `morning me with ${s.topicNoun} vs night me`,
      voiceProfiles: ["dry_humor", "self_aware", "sarcastic"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "relatable",
    },
    {
      build: (s) => `theory vs reality with ${s.topicNoun}`,
      voiceProfiles: ["dry_humor", "sarcastic", "self_aware"],
      rigidityScore: 4,
      sharpnessScore: 3,
      hookIntent: "relatable",
    },
    {
      build: () => `me at 9am vs me at 9pm`,
      voiceProfiles: ["dry_humor", "self_aware", "deadpan", "sarcastic"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "relatable",
    },
    {
      build: (s) => `plans about ${s.topicNoun} vs reality`,
      voiceProfiles: ["dry_humor", "sarcastic", "deadpan"],
      rigidityScore: 4,
      sharpnessScore: 2,
      hookIntent: "relatable",
    },
    {
      build: (s) => `planner me vs the ${s.topicNoun} version of me`,
      voiceProfiles: ["soft_confessional", "self_aware", "poetic"],
      rigidityScore: 3,
      sharpnessScore: 3,
      hookIntent: "relatable",
    },
    {
      build: (s) => `future me's ${s.topicNoun} vs current me's`,
      voiceProfiles: ["self_aware", "deadpan", "soft_confessional"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "relatable",
    },
  ],
  object_pov: [
    {
      build: (s) => `${s.topicNoun} watching me decide nothing again`,
      voiceProfiles: ["dry_humor", "poetic", "self_aware"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
    },
    {
      build: (s) => `${s.topicNoun}, sitting there, fully aware of everything`,
      voiceProfiles: ["poetic", "dry_humor", "deadpan"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
    },
    {
      build: (s) => `${s.topicNoun} keeps the score so nothing escapes`,
      voiceProfiles: ["poetic", "dry_humor", "blunt"],
      rigidityScore: 3,
      sharpnessScore: 3,
      hookIntent: "scroll_stop",
    },
    {
      build: (s) => `${s.topicNoun} taking notes about my life again`,
      voiceProfiles: ["dry_humor", "sarcastic", "chaotic"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
    },
    {
      build: (s) => `${s.topicNoun} has seen things, ${s.topicNoun} is tired`,
      voiceProfiles: ["poetic", "soft_confessional", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
    },
    {
      build: (s) => `the ${s.topicNoun} is smug about today, frankly`,
      voiceProfiles: ["sarcastic", "chaotic", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
    },
    {
      build: (s) => `${s.topicNoun} just observing the disaster quietly`,
      voiceProfiles: ["dry_humor", "soft_confessional", "deadpan"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
    },
  ],
  time_stamp: [
    {
      build: (s) => `11:48pm and I'm still negotiating with ${s.topicNoun}`,
      voiceProfiles: ["soft_confessional", "self_aware", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 5,
      hookIntent: "scroll_stop",
    },
    {
      build: (s) => `7am plan: ${s.actionShort}`,
      voiceProfiles: ["blunt", "deadpan", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
    },
    {
      build: (s) => `it's tuesday and ${s.topicNoun} has not moved`,
      voiceProfiles: ["deadpan", "dry_humor", "blunt"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
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
    },
    {
      build: (s) => `monday and ${s.topicNoun} is winning, news at eleven`,
      voiceProfiles: ["sarcastic", "dry_humor", "chaotic"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
    },
    {
      build: (s) => `3pm and the ${s.topicNoun} is somehow louder`,
      voiceProfiles: ["poetic", "soft_confessional", "self_aware"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
    },
    // Phase 3 PART 1 TIMESTAMP additions — pure timestamp + status
    // fragments. Each contains a digit (highly specific +1 boost) and
    // a mid-string period (fragment boost).
    {
      build: () => `9:14pm. still here.`,
      voiceProfiles: ["soft_confessional", "dry_humor", "deadpan"],
      rigidityScore: 2,
      sharpnessScore: 5,
      hookIntent: "scroll_stop",
    },
    {
      build: () => `2 hours later. nothing.`,
      voiceProfiles: ["blunt", "deadpan", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 5,
      hookIntent: "scroll_stop",
    },
    {
      build: () => `midnight. no progress.`,
      voiceProfiles: ["soft_confessional", "deadpan", "blunt"],
      rigidityScore: 2,
      sharpnessScore: 5,
      hookIntent: "scroll_stop",
    },
    {
      build: () => `day 3. nothing changed.`,
      voiceProfiles: ["blunt", "deadpan", "soft_confessional"],
      rigidityScore: 2,
      sharpnessScore: 5,
      hookIntent: "scroll_stop",
    },
  ],
  anti_hook: [
    {
      build: (s) => `anyway, ${s.topicNoun}`,
      voiceProfiles: ["deadpan", "dry_humor", "blunt"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
    },
    {
      build: (s) => `not great with ${s.topicNoun} today`,
      voiceProfiles: ["deadpan", "soft_confessional", "dry_humor"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
    },
    {
      build: (s) => `so. ${s.topicNoun}.`,
      voiceProfiles: ["deadpan", "blunt", "dry_humor"],
      rigidityScore: 3,
      sharpnessScore: 5,
      hookIntent: "scroll_stop",
    },
    {
      build: (s) => `here we are with ${s.topicNoun}`,
      voiceProfiles: ["deadpan", "soft_confessional", "dry_humor"],
      rigidityScore: 3,
      sharpnessScore: 3,
      hookIntent: "scroll_stop",
    },
    {
      build: (s) => `${s.topicNoun}. that's the whole post.`,
      voiceProfiles: ["sarcastic", "chaotic", "deadpan", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 5,
      hookIntent: "scroll_stop",
    },
    {
      build: (s) => `${s.topicNoun} and a quiet kind of nothing`,
      voiceProfiles: ["poetic", "soft_confessional", "deadpan"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
    },
    {
      build: (s) => `introducing: ${s.topicNoun} again, shockingly`,
      voiceProfiles: ["sarcastic", "self_aware", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
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
    },
    {
      build: () => `still nothing.`,
      voiceProfiles: ["deadpan", "blunt", "soft_confessional"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
    },
    {
      build: () => `this is it?`,
      voiceProfiles: ["deadpan", "sarcastic", "dry_humor"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
    },
    {
      build: () => `immediately no.`,
      voiceProfiles: ["blunt", "deadpan", "dry_humor"],
      rigidityScore: 3,
      sharpnessScore: 5,
      hookIntent: "scroll_stop",
    },
    {
      build: () => `yep. still stuck.`,
      voiceProfiles: ["dry_humor", "deadpan", "soft_confessional"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
    },
    {
      build: () => `not happening today.`,
      voiceProfiles: ["blunt", "deadpan", "sarcastic"],
      rigidityScore: 3,
      sharpnessScore: 4,
      hookIntent: "scroll_stop",
    },
  ],
  escalation_hook: [
    {
      build: (s) => `started with ${s.topicNoun}, ended somewhere worse`,
      voiceProfiles: ["chaotic", "sarcastic", "self_aware"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "compulsion",
    },
    {
      build: (s) => `tried to handle ${s.topicNoun}, did the opposite`,
      voiceProfiles: ["chaotic", "sarcastic", "self_aware", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "compulsion",
    },
    {
      build: (s) => `one job around ${s.topicNoun}, you can guess`,
      voiceProfiles: ["sarcastic", "dry_humor", "chaotic"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "compulsion",
    },
    {
      build: (s) =>
        `${s.topicNoun} started small, this is no longer small`,
      voiceProfiles: ["chaotic", "sarcastic", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "compulsion",
    },
    {
      build: (s) => `${s.topicNoun} went from small to entire personality`,
      voiceProfiles: ["chaotic", "sarcastic", "self_aware"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "compulsion",
    },
    {
      build: (s) => `thought I'd manage ${s.topicNoun}, now its hostage`,
      voiceProfiles: ["chaotic", "dry_humor", "soft_confessional"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "compulsion",
    },
    {
      build: (s) => `the ${s.topicNoun} ate my afternoon, peacefully`,
      voiceProfiles: ["poetic", "chaotic", "dry_humor"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "compulsion",
    },
    {
      build: (s) => `started managing ${s.topicNoun}, now we live together`,
      voiceProfiles: ["poetic", "soft_confessional", "deadpan"],
      rigidityScore: 2,
      sharpnessScore: 4,
      hookIntent: "compulsion",
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
} | null {
  const phrasings = HOOK_PHRASINGS_BY_LANGUAGE_STYLE[hookLanguageStyle];
  const n = phrasings.length;
  const start = ((seed % n) + n) % n;

  // Inner walker: scans phrasings in seed-rotated order, returning the
  // first entry that passes the intent filter, the voice predicate, AND
  // `validateHook`. Used by both the intent-first passes and the
  // intent-fallback passes below — sharing one walker means seed
  // rotation discipline is identical across all six passes.
  const walk = (
    intentRequired: HookIntent | null,
    voicePred: (e: LanguagePhrasingEntry) => boolean,
  ): { entry: LanguagePhrasingEntry; index: number; hook: string } | null => {
    for (let offset = 0; offset < n; offset++) {
      const idx = (start + offset) % n;
      const entry = phrasings[idx]!;
      if (intentRequired !== null && entry.hookIntent !== intentRequired) continue;
      if (!voicePred(entry)) continue;
      const candidate = toneInflect(entry.build(scenario), tone).trim();
      if (validateHook(candidate)) {
        return { entry, index: idx, hook: candidate };
      }
    }
    return null;
  };

  const voiceMatch = (e: LanguagePhrasingEntry) =>
    voiceProfile !== undefined &&
    (e.voiceProfiles?.includes(voiceProfile) ?? false);
  const voiceNeutral = (e: LanguagePhrasingEntry) =>
    e.voiceProfiles === undefined;
  const anyVoice = (_e: LanguagePhrasingEntry) => true;

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
  const { entry: sourceLanguagePhrasing, index, hook, intentFallback } = picked;
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
    );
    if (built !== null) {
      out.push(built);
      slotsAlreadyVoiced.push(voiceForSlot);
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
