/**
 * PHASE W2-A — Western/default authored hook pack DARK INFRASTRUCTURE.
 *
 * This module ships the type, the empty draft corpus, the editorial
 * integrity checker, and the controlled vocabularies for a future
 * Western/default authored hook+scenario pack. It does NOT introduce
 * any runtime behavior — there is no slot reservation, no scoring
 * change, no activation guard, no API surface, no Claude touchpoint.
 * The draft corpus is `Object.freeze([])` and remains empty until a
 * separate authoring PR adds entries.
 *
 * Safety model (mirrors the N1 dark-infrastructure precedent):
 *
 *   1. The draft corpus is a SEPARATE constant from any future live
 *      Western pack constant. It cannot be reached by any current
 *      runtime path because no runtime path imports it.
 *   2. The draft type forces `reviewedBy` to the literal sentinel
 *      `PENDING_EDITORIAL_REVIEW`. Promoting a draft to a live pack
 *      would require an editor to overwrite that stamp in the same
 *      PR (and the live-pack integrity check — added in a future
 *      phase — must reject the sentinel for the same reason the
 *      Nigerian boot assert rejects `PENDING_NATIVE_REVIEW`).
 *   3. The integrity checker is exported but NOT called at module
 *      load (because the corpus is empty by construction). The QA
 *      driver and unit tests exercise it against synthetic fixtures.
 *
 * NOT in scope for W2-A (do not add now):
 *   - 150 entries (separate authoring PR)
 *   - Slot reservation
 *   - Scoring changes
 *   - Activation guard
 *   - API / Claude / validator changes
 *   - Migrations
 */

// `PENDING_EDITORIAL_REVIEW` is the draft-layer reviewer sentinel. The
// integrity checker REQUIRES draft rows to carry this exact stamp so
// no agent-authored draft entry can be silently promoted into a live
// pack without an editor overwriting the stamp.
export const PENDING_EDITORIAL_REVIEW = "PENDING_EDITORIAL_REVIEW" as const;

// ---------------------------------------------------------------- //
// Controlled vocabularies                                            //
// ---------------------------------------------------------------- //
//
// These three taxonomies are the editorial scaffolding for the future
// authored corpus — they let the QA report bucket entries and let the
// integrity checker reject typoed/freeform values that would otherwise
// create silent classification drift.

export const WESTERN_COMEDY_FAMILIES = Object.freeze([
  // a hook stating an intent then immediately breaking it
  "self_betrayal",
  // a hook performing denial of the obvious
  "denial_loop",
  // a hook performatively bracing for the dread
  "performative_dread",
  // a hook narrating a small, specific shame
  "tiny_humiliation",
  // a hook treating an inanimate object as a social actor
  "parasocial_object",
  // a hook narrating optimism that is obviously about to fail
  "anxious_optimism",
  // a hook narrating procrastination as theatre
  "procrastination_theatre",
  // a hook escalating a small thing into a catastrophe
  "catastrophizing",
] as const);
export type WesternComedyFamily = (typeof WESTERN_COMEDY_FAMILIES)[number];

export const WESTERN_EMOTIONAL_SPIKES = Object.freeze([
  "shame",
  "dread",
  "glee",
  "despair",
  "defeat",
  "smugness",
  "panic",
  "embarrassment",
] as const);
export type WesternEmotionalSpike =
  (typeof WESTERN_EMOTIONAL_SPIKES)[number];

export const WESTERN_SETTINGS = Object.freeze([
  "bedroom",
  "kitchen",
  "bathroom",
  "desk",
  "couch",
  "car",
  "gym",
  "doorway",
  "mirror",
  "phone",
] as const);
export type WesternSetting = (typeof WESTERN_SETTINGS)[number];

// ---------------------------------------------------------------- //
// Atomic draft entry shape (the 10 user-required fields).            //
// ---------------------------------------------------------------- //

export type WesternHookPackDraftEntry = {
  /** Stable identifier (snake_case + short hash). Author chooses. */
  readonly id: string;
  /** Verbatim hook text. ≤ 120 chars to match `ideaSchema.hook`. */
  readonly hook: string;
  /** Beat-by-beat scene narration. 20–500 chars to match
   *  `ideaSchema.whatToShow`. MUST describe a concrete behavior —
   *  the integrity checker rejects the generic "set X down / stare /
   *  walk away" template that has no behavioral specificity. */
  readonly whatToShow: string;
  /** Concrete filming instructions. 15–400 chars to match
   *  `ideaSchema.howToFilm`. */
  readonly howToFilm: string;
  /** Caption text. 1–280 chars (R-layer region tag may compose on
   *  top via the regionProfile decoration layer in the future). */
  readonly caption: string;
  /** Single lowercase token anchor. Same shape as
   *  `coreDomainAnchorCatalog` anchors. */
  readonly anchor: string;
  /** Coarse comedy bucket — one of `WESTERN_COMEDY_FAMILIES`. */
  readonly comedyFamily: WesternComedyFamily;
  /** Coarse emotional-spike label — one of
   *  `WESTERN_EMOTIONAL_SPIKES`. */
  readonly emotionalSpike: WesternEmotionalSpike;
  /** Coarse setting label — one of `WESTERN_SETTINGS`. */
  readonly setting: WesternSetting;
  /** Editor stamp. For draft rows the type is pinned to the
   *  `PENDING_EDITORIAL_REVIEW` literal so the invariant is enforced
   *  at compile time as well as in the runtime checker. The future
   *  live-pack entry type (out of scope for W2-A) will widen this to
   *  a real reviewer initials+date string and the live-pack
   *  integrity check MUST reject the sentinel. */
  readonly reviewedBy: typeof PENDING_EDITORIAL_REVIEW;
};

// ---------------------------------------------------------------- //
// THE DRAFT CORPUS — empty by construction.                          //
//                                                                    //
// SHIPS EMPTY. Real entries land via a separate authoring PR.        //
// The constant is exported only so the QA driver can read it.        //
// ---------------------------------------------------------------- //

export const WESTERN_HOOK_PACK_DRAFT: readonly WesternHookPackDraftEntry[] =
  Object.freeze([
    // ── PHASE W2-Batch-A — 50 authored draft entries ──────────────
    // Imported verbatim from the W2-Batch-A authoring brief.
    // All 50 ship with `reviewedBy = PENDING_EDITORIAL_REVIEW`.
    // The corpus REMAINS DARK: no runtime path imports this constant,
    // no slot reservation, no scoring change, no API surface change.
    // Vocabulary mismatches against the W2-A controlled vocabularies
    // are SURFACED by `checkWesternHookPackDraftIntegrity` and are
    // intentionally left for human reviewer adjudication (vocabulary
    // expansion vs entry rewrite — NOT silently fixed).
  {
      id: "W2A-001",
      hook: "checking the post like the likes owe me rent",
      whatToShow:
        "You post something, put the phone face down like you're above it, then immediately flip it back over to check the likes again.",
      howToFilm:
        "Set the phone on a desk or bed where we can see your hand trying to leave it alone. The joke is the failure, so hold the pause for a second before you snatch the phone back up. Keep it quiet and awkward.",
      caption: "i am not checking. i am monitoring.",
      anchor: "post",
      comedyFamily: "posting_anxiety" as WesternComedyFamily,
      emotionalSpike: "private_embarrassment" as WesternEmotionalSpike,
      setting: "bedroom" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-002",
      hook: "opening the fridge like new food spawned",
      whatToShow:
        "You open the fridge, stare inside, close it, walk away, then come back and open it again like the contents might have changed.",
      howToFilm:
        "Film from inside-fridge angle if possible, or from the side with the fridge light hitting your face. The second open is the punchline. Look genuinely hopeful, then disappointed in yourself.",
      caption: "refreshing the fridge app.",
      anchor: "fridge",
      comedyFamily: "food_self_control" as WesternComedyFamily,
      emotionalSpike: "self_betrayal" as WesternEmotionalSpike,
      setting: "kitchen" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-003",
      hook: "hovering over send like the text can fight back",
      whatToShow:
        "You type a simple reply, read it five times, change one word, change it back, then hold your thumb over send without pressing it.",
      howToFilm:
        "Shoot over your shoulder so the phone screen can be fake or blurred. The acting is in your thumb freezing and your face acting like this message is a legal document.",
      caption: "this was supposed to be a normal reply.",
      anchor: "send",
      comedyFamily: "texting_overthinking" as WesternComedyFamily,
      emotionalSpike: "social_panic" as WesternEmotionalSpike,
      setting: "bedroom" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-004",
      hook: "making a to-do list and immediately betraying it",
      whatToShow:
        "You write three productive tasks, nod like your life is together, then open a completely unrelated app two seconds later.",
      howToFilm:
        "Start close on the list so it feels sincere. Then cut wide enough to show your whole body relaxing into avoidance. The switch should feel embarrassingly fast.",
      caption: "the list was more of a decorative concept.",
      anchor: "list",
      comedyFamily: "task_avoidance" as WesternComedyFamily,
      emotionalSpike: "self_betrayal" as WesternEmotionalSpike,
      setting: "desk" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-005",
      hook: "saying i'm leaving, then sitting down for 18 more minutes",
      whatToShow:
        "You grab your keys, announce you're leaving, sit down to put on shoes, then somehow end up scrolling while fully dressed.",
      howToFilm:
        "Keep the keys visible the whole time. The comedy is that you're technically ready but spiritually unavailable. Let the silence stretch after you sit.",
      caption: "departure is a mindset i do not have.",
      anchor: "leaving",
      comedyFamily: "leaving_house_delay" as WesternComedyFamily,
      emotionalSpike: "quiet_realization" as WesternEmotionalSpike,
      setting: "bedroom" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-006",
      hook: "rehearsing a casual reply and still sounding insane",
      whatToShow:
        "You practice saying a simple 'yeah, sounds good' out loud, then send something weirdly formal anyway.",
      howToFilm:
        "Film the rehearsal like a tiny audition. Whisper the normal version, then cut to you typing the most unnatural message possible. Your face should know it's bad before you send it.",
      caption: "why did i become customer service.",
      anchor: "reply",
      comedyFamily: "texting_overthinking" as WesternComedyFamily,
      emotionalSpike: "social_panic" as WesternEmotionalSpike,
      setting: "bedroom" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-007",
      hook: "filming a gym story from the couch like nobody will notice",
      whatToShow:
        "You angle the camera at sneakers, a water bottle, or workout clothes while clearly sitting on the couch.",
      howToFilm:
        "Make it look like you're trying to hide the couch from the frame and failing. A tiny pan revealing the blanket or remote sells the lie without needing a word.",
      caption: "fitness content, emotionally.",
      anchor: "gym",
      comedyFamily: "creator_anxiety" as WesternComedyFamily,
      emotionalSpike: "exposed_lie" as WesternEmotionalSpike,
      setting: "living_room" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-008",
      hook: "changing my wallpaper like that counts as fixing my life",
      whatToShow:
        "You sit overwhelmed, change your phone wallpaper to something peaceful, then nod like you just handled everything.",
      howToFilm:
        "Keep it small and dead serious. Show the phone wallpaper change, then cut to your face pretending that solved the problem. The less dramatic you act, the funnier it feels.",
      caption: "fresh wallpaper, same emergency.",
      anchor: "wallpaper",
      comedyFamily: "procrastination" as WesternComedyFamily,
      emotionalSpike: "false_productivity" as WesternEmotionalSpike,
      setting: "bedroom" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-009",
      hook: "putting on jeans and immediately grieving sweatpants",
      whatToShow:
        "You pull on jeans, stand still for one second, then look back at your sweatpants like you left someone behind.",
      howToFilm:
        "Frame it from waist down first, then cut to your face doing the emotional math. Don't overact. Just let the regret sit there.",
      caption: "formal wear has consequences.",
      anchor: "jeans",
      comedyFamily: "getting_ready" as WesternComedyFamily,
      emotionalSpike: "instant_regret" as WesternEmotionalSpike,
      setting: "bedroom" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-010",
      hook: "checking one notification and losing the entire plot",
      whatToShow:
        "You pick up your phone to check one notification, then end up deep in another app with no memory of why you started.",
      howToFilm:
        "Start with a clear mission: one notification. Then jump cut through two or three tiny phone movements until you're completely somewhere else. End with you looking confused at your own screen.",
      caption: "i left to get one thing and came back a different person.",
      anchor: "notification",
      comedyFamily: "phone_distraction" as WesternComedyFamily,
      emotionalSpike: "self_betrayal" as WesternEmotionalSpike,
      setting: "desk" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-011",
      hook: "standing in the doorway buffering like a broken app",
      whatToShow:
        "You walk into a room, stop in the doorway, forget why you're there, and slowly look around like the room owes you an answer.",
      howToFilm:
        "Put the camera across the room so we see the full doorway pause. The stillness is the joke. Let your eyes search every corner before you quietly leave.",
      caption: "mission failed before loading.",
      anchor: "doorway",
      comedyFamily: "tiny_public_private_awkwardness" as WesternComedyFamily,
      emotionalSpike: "confused_pause" as WesternEmotionalSpike,
      setting: "home" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-012",
      hook: "liking the message in my head and calling that communication",
      whatToShow:
        "You read a message, smile, mentally respond, then lock the phone without actually replying.",
      howToFilm:
        "Show your face softening like you responded warmly. Then show the phone still unanswered. The contrast should feel painfully familiar.",
      caption: "emotionally replied.",
      anchor: "message",
      comedyFamily: "texting_overthinking" as WesternComedyFamily,
      emotionalSpike: "quiet_guilt" as WesternEmotionalSpike,
      setting: "bedroom" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-013",
      hook: "cleaning one corner and calling the whole room healed",
      whatToShow:
        "You tidy one tiny visible area, step back proudly, then the camera reveals the rest of the room is still chaos.",
      howToFilm:
        "Use a slow reveal. Start tight on the clean corner like a transformation video, then widen to expose everything else. Your proud face should stay proud too long.",
      caption: "selective adulthood.",
      anchor: "corner",
      comedyFamily: "procrastination" as WesternComedyFamily,
      emotionalSpike: "false_productivity" as WesternEmotionalSpike,
      setting: "bedroom" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-014",
      hook: "refreshing the tracking page like i can intimidate the package",
      whatToShow:
        "You refresh a package tracking page over and over even though it hasn't moved in hours.",
      howToFilm:
        "Keep the tracking screen fake or blurred. Focus on the physical ritual: refresh, lean in, refresh harder, lean back defeated.",
      caption: "the package and i are in negotiations.",
      anchor: "package",
      comedyFamily: "phone_distraction" as WesternComedyFamily,
      emotionalSpike: "impatient_spiral" as WesternEmotionalSpike,
      setting: "desk" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-015",
      hook: "opening the calendar and immediately closing it for my safety",
      whatToShow:
        "You open your calendar, see the day is packed, then close it like you saw something illegal.",
      howToFilm:
        "Shoot the phone from an angle so the calendar can be fake. The important part is the instant emotional shutdown after one glance.",
      caption: "i was not ready for information.",
      anchor: "calendar",
      comedyFamily: "work_school_panic" as WesternComedyFamily,
      emotionalSpike: "avoidance_spike" as WesternEmotionalSpike,
      setting: "desk" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-016",
      hook: "putting 'almost done' on a task i have emotionally abandoned",
      whatToShow:
        "You type 'almost done' in a message while the actual work is barely started on your screen.",
      howToFilm:
        "Frame the lie and the evidence together if you can: message on one side, unfinished work on the other. Your confidence should be fake but committed.",
      caption: "almost is a flexible word.",
      anchor: "almost",
      comedyFamily: "work_school_panic" as WesternComedyFamily,
      emotionalSpike: "exposed_lie" as WesternEmotionalSpike,
      setting: "desk" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-017",
      hook: "taking a break from the task i never started",
      whatToShow:
        "You sit down to work, arrange everything perfectly, then immediately decide you deserve a break.",
      howToFilm:
        "Show the setup like a productivity video: laptop, drink, notes. Then cut to you leaning back before touching anything. The break should feel completely unearned.",
      caption: "pre-work recovery.",
      anchor: "break",
      comedyFamily: "task_avoidance" as WesternComedyFamily,
      emotionalSpike: "self_betrayal" as WesternEmotionalSpike,
      setting: "desk" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-018",
      hook: "typing 'no worries' with every worry in my body",
      whatToShow:
        "You receive a mildly annoying message, type 'no worries,' then stare at the wall like you just lied professionally.",
      howToFilm:
        "Keep the message fake and simple. The comedy is not the text, it's the dead pause after sending the politest lie possible.",
      caption: "emotionally, there were worries.",
      anchor: "worries",
      comedyFamily: "texting_overthinking" as WesternComedyFamily,
      emotionalSpike: "polite_rage" as WesternEmotionalSpike,
      setting: "bedroom" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-019",
      hook: "trying to leave quietly and becoming a full percussion section",
      whatToShow:
        "You sneak out or move quietly, but your keys, bag, shoes, and door all make noise at once.",
      howToFilm:
        "Do it in one take if possible. Move slowly and carefully, then let each tiny object betray you. Your face should get more desperate after every sound.",
      caption: "stealth mode failed immediately.",
      anchor: "quietly",
      comedyFamily: "tiny_public_private_awkwardness" as WesternComedyFamily,
      emotionalSpike: "physical_embarrassment" as WesternEmotionalSpike,
      setting: "entryway" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-020",
      hook: "checking my bank app like the number might apologize",
      whatToShow:
        "You open a fake banking screen, stare at the balance, close it, then open it again as if it might change.",
      howToFilm:
        "Use a fake screen only. The funny part is the second open. Make the first look responsible and the second look desperate.",
      caption: "refreshing reality.",
      anchor: "bank",
      comedyFamily: "adulting_panic" as WesternComedyFamily,
      emotionalSpike: "financial_dread" as WesternEmotionalSpike,
      setting: "bedroom" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-021",
      hook: "saving the recipe and ordering delivery anyway",
      whatToShow:
        "You save a recipe with confidence, look at the ingredients, then open a delivery app with zero shame.",
      howToFilm:
        "Show the recipe moment like you're about to become a new person. Then let the delivery app enter like a villain. A tiny guilty glance makes it land.",
      caption: "cooking remained theoretical.",
      anchor: "recipe",
      comedyFamily: "food_self_control" as WesternComedyFamily,
      emotionalSpike: "self_betrayal" as WesternEmotionalSpike,
      setting: "kitchen" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-022",
      hook: "saying 'quick nap' like i haven't met myself",
      whatToShow:
        "You set an alarm for a short nap, lie down confidently, then cut to you waking up confused much later.",
      howToFilm:
        "Keep the setup simple: alarm, pillow, confidence. Then cut to a messy wake-up with the same framing so the time jump feels obvious.",
      caption: "i lied to the clock.",
      anchor: "nap",
      comedyFamily: "self_control" as WesternComedyFamily,
      emotionalSpike: "instant_regret" as WesternEmotionalSpike,
      setting: "bedroom" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-023",
      hook: "putting one dish in the sink and creating a movement",
      whatToShow:
        "You place one dish in the sink, walk away, then return to a pile that somehow looks like it organized itself.",
      howToFilm:
        "Use a before/after cut. The first dish should look harmless. The return should feel like betrayal. Stand there like you're meeting the sink for the first time.",
      caption: "the sink recruited friends.",
      anchor: "sink",
      comedyFamily: "procrastination" as WesternComedyFamily,
      emotionalSpike: "quiet_defeat" as WesternEmotionalSpike,
      setting: "kitchen" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-024",
      hook: "watching my own story like i didn't just post it",
      whatToShow:
        "You post a story, then immediately watch it from your own profile like you're part of the audience.",
      howToFilm:
        "Film your hand tapping into your own story, then cut to your face judging it like a stranger uploaded it. Keep the embarrassment tiny and real.",
      caption: "viewer number one.",
      anchor: "story",
      comedyFamily: "posting_anxiety" as WesternComedyFamily,
      emotionalSpike: "private_embarrassment" as WesternEmotionalSpike,
      setting: "bedroom" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-025",
      hook: "deleting a sentence and somehow making the text worse",
      whatToShow:
        "You edit a simple message, remove one sentence, then the whole message becomes colder and weirder.",
      howToFilm:
        "Show the typing process in pieces: type, delete, stare, type worse. The final face should say you know it got worse but you're tired.",
      caption: "editing made me suspicious.",
      anchor: "sentence",
      comedyFamily: "texting_overthinking" as WesternComedyFamily,
      emotionalSpike: "social_panic" as WesternEmotionalSpike,
      setting: "bedroom" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-026",
      hook: "bringing a water bottle to feel like a better person",
      whatToShow:
        "You carry a water bottle around proudly, then never actually drink from it.",
      howToFilm:
        "Let the bottle be visible in multiple little moments: desk, couch, doorway. Each time, you move it like a prop from your improved life.",
      caption: "hydration, but mostly branding.",
      anchor: "water",
      comedyFamily: "self_improvement_attempt" as WesternComedyFamily,
      emotionalSpike: "false_productivity" as WesternEmotionalSpike,
      setting: "home" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-027",
      hook: "standing in workout clothes waiting for motivation to arrive",
      whatToShow:
        "You put on workout clothes, stand in the room ready, then slowly sit down without starting.",
      howToFilm:
        "Frame it like a workout intro. Shoes tied, water nearby, serious face. Then let the energy drain out in real time until you're just sitting there.",
      caption: "outfit did its part.",
      anchor: "motivation",
      comedyFamily: "self_improvement_attempt" as WesternComedyFamily,
      emotionalSpike: "self_betrayal" as WesternEmotionalSpike,
      setting: "living_room" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-028",
      hook: "asking 'what time?' and regretting the answer immediately",
      whatToShow:
        "You agree to plans casually, ask what time, hear or read the time, and your face quietly collapses.",
      howToFilm:
        "Keep the reaction small. Look normal before the time, then let one tiny facial change give away that your soul left.",
      caption: "plans became real too fast.",
      anchor: "time",
      comedyFamily: "social_plans" as WesternComedyFamily,
      emotionalSpike: "instant_regret" as WesternEmotionalSpike,
      setting: "bedroom" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-029",
      hook: "joining the call with confidence and instantly forgetting English",
      whatToShow:
        "You join a video or work call, prepare to speak, then your sentence falls apart as soon as people are listening.",
      howToFilm:
        "Film from laptop height. Start with confident posture and a little nod. Then do the tiny panic smile when it's your turn. No need to show a real meeting.",
      caption: "professional until perceived.",
      anchor: "call",
      comedyFamily: "work_school_panic" as WesternComedyFamily,
      emotionalSpike: "performance_panic" as WesternEmotionalSpike,
      setting: "desk" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-030",
      hook: "packing a bag like i'm moving out for one errand",
      whatToShow:
        "You pack a bag for a simple errand and somehow add charger, water, snack, backup sweater, and things you absolutely won't need.",
      howToFilm:
        "Shoot from above or bed-level. Each extra item should feel more unnecessary than the last. End by struggling to zip the bag for a 20-minute outing.",
      caption: "emotionally preparing for survival.",
      anchor: "bag",
      comedyFamily: "leaving_house_delay" as WesternComedyFamily,
      emotionalSpike: "overprepared_panic" as WesternEmotionalSpike,
      setting: "bedroom" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-031",
      hook: "reading the group chat and choosing witness protection",
      whatToShow:
        "You open a busy group chat, scroll through chaos, then slowly turn off notifications and put the phone down.",
      howToFilm:
        "Use a fake group chat. The scroll should feel overwhelming. The punchline is the silent decision to disappear.",
      caption: "i support from a safe distance.",
      anchor: "groupchat",
      comedyFamily: "social_plans" as WesternComedyFamily,
      emotionalSpike: "avoidance_spike" as WesternEmotionalSpike,
      setting: "bedroom" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-032",
      hook: "checking the weather after already deciding to cancel",
      whatToShow:
        "You open the weather app, see a tiny inconvenience, and act like the universe personally told you to stay home.",
      howToFilm:
        "Keep the weather detail small so the overreaction is the joke. A light drizzle, wind icon, or cloudy screen is enough.",
      caption: "science supports my decision.",
      anchor: "weather",
      comedyFamily: "leaving_house_delay" as WesternComedyFamily,
      emotionalSpike: "excuse_found" as WesternEmotionalSpike,
      setting: "bedroom" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-033",
      hook: "moving the tab to a new window like that's progress",
      whatToShow:
        "You drag a browser tab into a fresh window, stare at it, and feel briefly productive without doing the task.",
      howToFilm:
        "Film the screen from behind or use a fake laptop setup. The tiny tab movement should be treated like a major life reset.",
      caption: "workspace healed. task untouched.",
      anchor: "tab",
      comedyFamily: "task_avoidance" as WesternComedyFamily,
      emotionalSpike: "false_productivity" as WesternEmotionalSpike,
      setting: "desk" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-034",
      hook: "saying 'i'll just browse' and becoming a shopping cart landlord",
      whatToShow:
        "You open an online store to browse, then slowly add items to cart like you're building a second life.",
      howToFilm:
        "Show the cart count going up, then your face pretending this is still casual. End on the checkout total if it's fake.",
      caption: "nothing was purchased except delusion.",
      anchor: "cart",
      comedyFamily: "adulting_panic" as WesternComedyFamily,
      emotionalSpike: "self_betrayal" as WesternEmotionalSpike,
      setting: "bedroom" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-035",
      hook: "trying to look busy when someone walks by",
      whatToShow:
        "You're doing nothing, hear footsteps, and immediately start typing or moving papers like your life depends on it.",
      howToFilm:
        "Set the camera at desk height. The switch from relaxed to fake-busy should be instant and guilty. Don't show another person; just react to the sound.",
      caption: "productivity by surveillance.",
      anchor: "busy",
      comedyFamily: "work_school_panic" as WesternComedyFamily,
      emotionalSpike: "caught_off_guard" as WesternEmotionalSpike,
      setting: "desk" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-036",
      hook: "setting a timer and then negotiating with it",
      whatToShow:
        "You set a focus timer, start working, then immediately pause it because you 'need one thing' first.",
      howToFilm:
        "Show the timer starting like a serious commitment. Then show your finger hovering over pause way too soon. The guilt is the whole joke.",
      caption: "the timer met my personality.",
      anchor: "timer",
      comedyFamily: "task_avoidance" as WesternComedyFamily,
      emotionalSpike: "self_betrayal" as WesternEmotionalSpike,
      setting: "desk" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-037",
      hook: "taking a screenshot instead of making a decision",
      whatToShow:
        "You screenshot an outfit, product, message, or plan instead of deciding what to do with it.",
      howToFilm:
        "Make the screenshot feel like an emotional escape hatch. Tap screenshot, exhale, then do absolutely nothing with the information.",
      caption: "saved for a future version of me.",
      anchor: "screenshot",
      comedyFamily: "phone_distraction" as WesternComedyFamily,
      emotionalSpike: "decision_avoidance" as WesternEmotionalSpike,
      setting: "bedroom" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-038",
      hook: "saying 'quick shower' and holding a full press conference in there",
      whatToShow:
        "You enter the bathroom for a quick shower, then cut to you clearly taking forever while imaginary arguments or speeches happen.",
      howToFilm:
        "No need to film in the shower. Use before/after: hand on bathroom door, then later sitting in a towel or robe looking like you solved world issues.",
      caption: "the shower had an agenda.",
      anchor: "shower",
      comedyFamily: "procrastination" as WesternComedyFamily,
      emotionalSpike: "time_loss" as WesternEmotionalSpike,
      setting: "bathroom" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-039",
      hook: "acting surprised by the laundry i personally ignored",
      whatToShow:
        "You see a laundry pile, look offended by its existence, then remember you walked past it all week.",
      howToFilm:
        "Film the first look like betrayal, then cut to a quick flashback-style walk-by where you ignore it. Keep it simple and silent.",
      caption: "the pile did not appear overnight.",
      anchor: "laundry",
      comedyFamily: "task_avoidance" as WesternComedyFamily,
      emotionalSpike: "quiet_guilt" as WesternEmotionalSpike,
      setting: "bedroom" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-040",
      hook: "checking the mirror for confidence and leaving with questions",
      whatToShow:
        "You check your outfit in the mirror, start confident, then notice one tiny thing and unravel.",
      howToFilm:
        "Use a mirror angle but keep it casual. The first look should be approving. Then one adjustment turns into five. End before it gets too polished.",
      caption: "the mirror opened a case.",
      anchor: "mirror",
      comedyFamily: "getting_ready" as WesternComedyFamily,
      emotionalSpike: "self_doubt_spike" as WesternEmotionalSpike,
      setting: "bedroom" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-041",
      hook: "muting the call and becoming a completely different person",
      whatToShow:
        "You speak professionally, hit mute, then instantly collapse into eating, stretching, or staring into space.",
      howToFilm:
        "Frame it like a laptop call from the side. The mute click is the switch. Make the difference between 'meeting you' and 'real you' obvious.",
      caption: "mute is my true personality.",
      anchor: "mute",
      comedyFamily: "work_school_panic" as WesternComedyFamily,
      emotionalSpike: "mask_drop" as WesternEmotionalSpike,
      setting: "desk" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-042",
      hook: "walking into Target for one thing and coming out with a personality",
      whatToShow:
        "You enter for one item, then cut to you holding random things that clearly weren't part of the plan.",
      howToFilm:
        "This can be filmed at home with a bag or pile of items. The joke is the contrast: say or show 'one thing,' then reveal the unnecessary haul.",
      caption: "the store made suggestions.",
      anchor: "target",
      comedyFamily: "adulting_panic" as WesternComedyFamily,
      emotionalSpike: "self_betrayal" as WesternEmotionalSpike,
      setting: "store" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-043",
      hook: "rewatching my own video like i'm investigating a crime",
      whatToShow:
        "You replay your own clip, pause at a weird face, zoom in, and reconsider posting.",
      howToFilm:
        "Use a fake clip or your camera roll blurred. The zoom-in is the punchline. React like you found evidence against yourself.",
      caption: "editor, detective, victim.",
      anchor: "video",
      comedyFamily: "creator_anxiety" as WesternComedyFamily,
      emotionalSpike: "private_embarrassment" as WesternEmotionalSpike,
      setting: "bedroom" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-044",
      hook: "recording one take and immediately becoming my own harshest manager",
      whatToShow:
        "You record a simple video, watch it back, then start giving yourself impossible notes.",
      howToFilm:
        "Show the recording setup, then your face watching playback. Whisper or mouth tiny critiques if you want, but the expression should do most of it.",
      caption: "creative director is being difficult.",
      anchor: "take",
      comedyFamily: "creator_anxiety" as WesternComedyFamily,
      emotionalSpike: "self_critique" as WesternEmotionalSpike,
      setting: "bedroom" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-045",
      hook: "checking if they replied by unlocking my phone with attitude",
      whatToShow:
        "You pretend not to care, unlock the phone dramatically, see no reply, and lock it again like you're above it.",
      howToFilm:
        "Keep the phone screen fake or hidden. The hand movement should have too much pride for someone who clearly cares.",
      caption: "not caring, aggressively.",
      anchor: "reply",
      comedyFamily: "texting_overthinking" as WesternComedyFamily,
      emotionalSpike: "social_panic" as WesternEmotionalSpike,
      setting: "bedroom" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-046",
      hook: "saying i'll start at 9:00 and treating 9:03 like a lost cause",
      whatToShow:
        "You look at the clock, see you're three minutes late, and decide the whole schedule is ruined.",
      howToFilm:
        "Show the time clearly. The overreaction should be tiny but dramatic: laptop slowly closes, you lean back, the day is over.",
      caption: "missed the ceremonial start time.",
      anchor: "clock",
      comedyFamily: "task_avoidance" as WesternComedyFamily,
      emotionalSpike: "excuse_found" as WesternEmotionalSpike,
      setting: "desk" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-047",
      hook: "pretending the unread email can't see me",
      whatToShow:
        "You open your inbox, see one unread email, then slowly move the cursor away like avoiding eye contact.",
      howToFilm:
        "Film over the shoulder with a fake inbox. The cursor movement should feel like sneaking past someone in public.",
      caption: "we both know it's there.",
      anchor: "email",
      comedyFamily: "work_school_panic" as WesternComedyFamily,
      emotionalSpike: "avoidance_spike" as WesternEmotionalSpike,
      setting: "desk" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-048",
      hook: "making plans while already planning the excuse",
      whatToShow:
        "You agree to plans in a chat, then immediately open your calendar or notes to think of a way out.",
      howToFilm:
        "Start with cheerful agreement, then cut to the immediate regret. The speed of the switch is what makes it human.",
      caption: "commitment and escape plan arrived together.",
      anchor: "plans",
      comedyFamily: "social_plans" as WesternComedyFamily,
      emotionalSpike: "instant_regret" as WesternEmotionalSpike,
      setting: "bedroom" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-049",
      hook: "eating one chip like the bag didn't hear me",
      whatToShow:
        "You take one chip, close the bag responsibly, then reopen it almost immediately.",
      howToFilm:
        "Frame the bag and your hand. Make the first close look serious. The second open should be quiet, like you're trying not to alert yourself.",
      caption: "portion control left the chat.",
      anchor: "chip",
      comedyFamily: "food_self_control" as WesternComedyFamily,
      emotionalSpike: "self_betrayal" as WesternEmotionalSpike,
      setting: "kitchen" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "W2A-050",
      hook: "checking the due date like it might become kinder",
      whatToShow:
        "You open an assignment or deadline page, stare at the due date, close it, then open it again like negotiation is possible.",
      howToFilm:
        "Use a fake assignment page. The second check is the joke. Add a little pause where you clearly hope the date changed.",
      caption: "deadline remained rude.",
      anchor: "deadline",
      comedyFamily: "work_school_panic" as WesternComedyFamily,
      emotionalSpike: "deadline_panic" as WesternEmotionalSpike,
      setting: "desk" as WesternSetting,
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  ]);

// ---------------------------------------------------------------- //
// Field-length bands — kept in lockstep with `ideaSchema`. Mirrors  //
// the bounds duplicated in `nigerianHookPack.ts` PACK_FIELD_BOUNDS. //
// ---------------------------------------------------------------- //

export const WESTERN_DRAFT_FIELD_BOUNDS = Object.freeze({
  hookMin: 1,
  hookMax: 120,
  whatToShowMin: 20,
  whatToShowMax: 500,
  howToFilmMin: 15,
  howToFilmMax: 400,
  captionMin: 1,
  captionMax: 280,
});

// ---------------------------------------------------------------- //
// Weak banned hook skeletons.                                        //
//                                                                    //
// Curated from the W1.3 ON shipped sample weak families. These are  //
// the shapes the editorial corpus MUST avoid by construction so the  //
// pack does not re-introduce the very templates W1.3+W1.4 are        //
// already demoting at the catalog scoring layer.                     //
// ---------------------------------------------------------------- //

export const WESTERN_DRAFT_WEAK_SKELETON_PATTERNS: ReadonlyArray<{
  readonly id: string;
  readonly pattern: RegExp;
}> = Object.freeze([
  {
    id: "totally_fine_about_anchor",
    pattern: /\bI\s+am\s+totally\s+fine\s+about\s+(?:the|my)\s+\w+/i,
  },
  {
    id: "anchor_knows_im_lying",
    pattern: /\b(?:the|my)\s+\w+(?:[-\s]\w+)?\s+knows\s+i'?m\s+lying\b/i,
  },
  {
    id: "someone_explain_anchor_now",
    pattern:
      /\bsomeone\s+explain\s+(?:the|my)\s+\w+(?:[-\s]\w+)?\s+to\s+me\.?\s+NOW\b/,
  },
  {
    id: "anchor_won_obviously",
    pattern: /\b(?:the|my)\s+\w+(?:[-\s]\w+)?\s+won\.?\s+obviously\b/i,
  },
  {
    id: "anchor_itself_became",
    pattern: /\b(?:the|my)\s+\w+(?:[-\s]\w+)?\s+itself\s+became\b/i,
  },
  {
    id: "anchor_flatlined_my_whole_week",
    pattern:
      /\b(?:the|my)\s+\w+(?:[-\s]\w+)?\s+flatlined\s+my\s+whole\s+week\b/i,
  },
  {
    id: "body_quit_brain_screaming",
    pattern: /\bmy\s+body\s+quit\.?\s+my\s+brain\s+kept\s+screaming\b/i,
  },
]);

// ---------------------------------------------------------------- //
// Generic "set X down / stare / walk away" scenario detector.       //
//                                                                    //
// A scenario is GENERIC when it describes putting an object down,    //
// staring at it, and walking away — without any concrete second      //
// behavior. The detector requires the lazy-template signature        //
// (set / put / place + stare / look + walk away / leave) to fire.    //
// Single-word matches like "stare" alone are not enough.             //
// ---------------------------------------------------------------- //

const GENERIC_SET_VERB = /\b(?:set|put|place)\s+(?:the|my|it)\b/i;
const GENERIC_STARE_VERB = /\b(?:stare|stares|staring|look|looks|looking)\b/i;
const GENERIC_WALKAWAY_VERB =
  /\b(?:walk(?:s|ing)?\s+away|leave(?:s|ing)?|leaves|left)\b/i;

function isGenericSetStareWalkAwayScenario(whatToShow: string): boolean {
  if (!whatToShow) return false;
  return (
    GENERIC_SET_VERB.test(whatToShow) &&
    GENERIC_STARE_VERB.test(whatToShow) &&
    GENERIC_WALKAWAY_VERB.test(whatToShow)
  );
}

// ---------------------------------------------------------------- //
// Privacy / safety patterns to reject.                               //
//                                                                    //
// Narrow band — the corpus must not invite leakage of real personal  //
// data (real names, real phone numbers, real addresses, real bank /  //
// SSN / credit-card / email). The intent is the same as              //
// FAKE_CHAT_NOTE / FAKE_BANK_NOTE in the N1 drafts — content shown   //
// must be obviously mock. The integrity checker enforces a small set //
// of obvious shapes; the editor remains the primary safety reviewer. //
// ---------------------------------------------------------------- //

const PRIVACY_PATTERNS: ReadonlyArray<{ readonly id: string; readonly pattern: RegExp }> =
  Object.freeze([
    // 9–11 digit unbroken phone-number-like sequences.
    { id: "phone_number_like", pattern: /\b\d{9,11}\b/ },
    // SSN-like 3-2-4 sequence.
    { id: "ssn_like", pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
    // 13–19-digit card-number-like.
    { id: "credit_card_like", pattern: /\b\d{13,19}\b/ },
    // Email-shaped string.
    { id: "email_like", pattern: /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i },
  ]);

// Local djb2 — same canonical implementation used by neighbouring
// modules. Inlined here to keep this dark-infrastructure module
// dependency-free.
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

/**
 * Normalise a hook to a coarse skeleton for near-duplicate detection.
 * Long content tokens (≥5 chars) collapse to `__`; short tokens are
 * kept verbatim. Capped at 24 tokens to avoid runaway strings.
 *
 * Inlined (rather than imported from `catalogTemplateCreatorMemory`)
 * to keep this dark-infrastructure module standalone.
 */
function normalizeDraftHookToSkeleton(hook: string): string {
  if (!hook) return "";
  const cleaned = hook
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .trim();
  if (cleaned.length === 0) return "";
  const tokens = cleaned.split(/\s+/).slice(0, 24);
  return tokens.map((t) => (t.length >= 5 ? "__" : t)).join(" ");
}

// ---------------------------------------------------------------- //
// Detailed integrity-check result. Returned by the checker (rather  //
// than thrown) so the QA driver can render a structured report.    //
// ---------------------------------------------------------------- //

export type WesternDraftIntegrityFailure = {
  readonly id: string | null;
  readonly index: number;
  readonly code: string;
  readonly detail: string;
};

export type WesternDraftIntegrityReport = {
  readonly ok: boolean;
  readonly failures: readonly WesternDraftIntegrityFailure[];
  readonly duplicateHookFingerprints: readonly string[];
  readonly weakSkeletonHits: ReadonlyMap<string, number>;
  readonly lengthFailures: readonly WesternDraftIntegrityFailure[];
  readonly privacyFailures: readonly WesternDraftIntegrityFailure[];
};

function inBand(s: string | undefined, min: number, max: number): boolean {
  if (typeof s !== "string") return false;
  const len = s.trim().length;
  return len >= min && len <= max;
}

function describeBand(name: string, min: number, max: number): string {
  return `${name} length out of band [${min}, ${max}]`;
}

/**
 * Validate the draft corpus. Returns a structured report. An empty
 * corpus is always `ok: true` with no failures (the resting state).
 */
export function checkWesternHookPackDraftIntegrity(
  pack: readonly WesternHookPackDraftEntry[],
): WesternDraftIntegrityReport {
  const failures: WesternDraftIntegrityFailure[] = [];
  const lengthFailures: WesternDraftIntegrityFailure[] = [];
  const privacyFailures: WesternDraftIntegrityFailure[] = [];
  const dupeFingerprints = new Map<string, number>();
  const seenIds = new Set<string>();
  const seenHookExact = new Map<string, number>();
  const seenSkeletons = new Map<string, number>();
  const weakSkeletonHits = new Map<string, number>();

  pack.forEach((entry, index) => {
    const id = entry?.id ?? null;
    const ctx = (code: string, detail: string): WesternDraftIntegrityFailure => ({
      id,
      index,
      code,
      detail,
    });
    if (!id || typeof id !== "string" || id.trim().length === 0) {
      failures.push(ctx("missing_id", "id is required and non-empty"));
    } else if (seenIds.has(id)) {
      failures.push(ctx("duplicate_id", `id '${id}' already used`));
    } else {
      seenIds.add(id);
    }

    const b = WESTERN_DRAFT_FIELD_BOUNDS;
    if (!inBand(entry?.hook, b.hookMin, b.hookMax)) {
      const f = ctx("hook_length", describeBand("hook", b.hookMin, b.hookMax));
      failures.push(f);
      lengthFailures.push(f);
    }
    if (!inBand(entry?.whatToShow, b.whatToShowMin, b.whatToShowMax)) {
      const f = ctx(
        "what_to_show_length",
        describeBand("whatToShow", b.whatToShowMin, b.whatToShowMax),
      );
      failures.push(f);
      lengthFailures.push(f);
    }
    if (!inBand(entry?.howToFilm, b.howToFilmMin, b.howToFilmMax)) {
      const f = ctx(
        "how_to_film_length",
        describeBand("howToFilm", b.howToFilmMin, b.howToFilmMax),
      );
      failures.push(f);
      lengthFailures.push(f);
    }
    if (!inBand(entry?.caption, b.captionMin, b.captionMax)) {
      const f = ctx(
        "caption_length",
        describeBand("caption", b.captionMin, b.captionMax),
      );
      failures.push(f);
      lengthFailures.push(f);
    }

    const anchor = (entry?.anchor ?? "").trim();
    if (anchor.length === 0 || /\s/.test(anchor)) {
      failures.push(
        ctx("anchor_invalid", "anchor must be a single non-empty token"),
      );
    }

    if (!WESTERN_COMEDY_FAMILIES.includes(entry?.comedyFamily as never)) {
      failures.push(
        ctx(
          "comedy_family_invalid",
          `comedyFamily '${String(entry?.comedyFamily)}' not in WESTERN_COMEDY_FAMILIES`,
        ),
      );
    }
    if (
      !WESTERN_EMOTIONAL_SPIKES.includes(entry?.emotionalSpike as never)
    ) {
      failures.push(
        ctx(
          "emotional_spike_invalid",
          `emotionalSpike '${String(entry?.emotionalSpike)}' not in WESTERN_EMOTIONAL_SPIKES`,
        ),
      );
    }
    if (!WESTERN_SETTINGS.includes(entry?.setting as never)) {
      failures.push(
        ctx(
          "setting_invalid",
          `setting '${String(entry?.setting)}' not in WESTERN_SETTINGS`,
        ),
      );
    }

    // Draft rows MUST carry the editorial-review sentinel — promoting
    // a draft to a live pack requires an editor to overwrite this
    // stamp in the same PR.
    if ((entry?.reviewedBy ?? "").trim() !== PENDING_EDITORIAL_REVIEW) {
      failures.push(
        ctx(
          "reviewed_by_invalid",
          `draft rows must carry reviewedBy='${PENDING_EDITORIAL_REVIEW}'`,
        ),
      );
    }

    const hook = entry?.hook ?? "";
    const exactKey = hook.toLowerCase().trim();
    if (exactKey.length > 0) {
      const prev = seenHookExact.get(exactKey);
      if (prev !== undefined) {
        const fp = `exact:${djb2(exactKey).toString(16)}`;
        if (!dupeFingerprints.has(fp)) dupeFingerprints.set(fp, prev);
        failures.push(
          ctx(
            "duplicate_hook_exact",
            `hook duplicates entry at index ${prev}: ${hook.slice(0, 60)}`,
          ),
        );
      } else {
        seenHookExact.set(exactKey, index);
      }
      const skeleton = normalizeDraftHookToSkeleton(hook);
      if (skeleton.length > 0) {
        const prevSk = seenSkeletons.get(skeleton);
        if (prevSk !== undefined) {
          const fp = `skel:${djb2(skeleton).toString(16)}`;
          if (!dupeFingerprints.has(fp)) dupeFingerprints.set(fp, prevSk);
          failures.push(
            ctx(
              "duplicate_hook_skeleton",
              `hook skeleton duplicates entry at index ${prevSk}: ${skeleton.slice(0, 60)}`,
            ),
          );
        } else {
          seenSkeletons.set(skeleton, index);
        }
      }
    }

    for (const w of WESTERN_DRAFT_WEAK_SKELETON_PATTERNS) {
      if (w.pattern.test(hook)) {
        weakSkeletonHits.set(w.id, (weakSkeletonHits.get(w.id) ?? 0) + 1);
        failures.push(
          ctx(
            "weak_banned_skeleton",
            `hook matches banned weak skeleton '${w.id}'`,
          ),
        );
        break;
      }
    }

    for (const p of PRIVACY_PATTERNS) {
      if (p.pattern.test(hook) || p.pattern.test(entry?.whatToShow ?? "")) {
        const f = ctx(
          "privacy_unsafe",
          `entry matches obvious privacy/safety pattern '${p.id}'`,
        );
        failures.push(f);
        privacyFailures.push(f);
        break;
      }
    }

    if (isGenericSetStareWalkAwayScenario(entry?.whatToShow ?? "")) {
      failures.push(
        ctx(
          "generic_object_scenario",
          "whatToShow describes generic 'set object down / stare / walk away' with no second behavior",
        ),
      );
    }
  });

  return {
    ok: failures.length === 0,
    failures,
    duplicateHookFingerprints: [...dupeFingerprints.keys()],
    weakSkeletonHits,
    lengthFailures,
    privacyFailures,
  };
}
