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
  // ── W2-Batch-A vocab additions (additive, draft-only) ──────────
  // The first 50 authored draft entries surfaced these clean,
  // distinct comedy buckets. Adding them additively widens the
  // draft taxonomy without touching runtime, scoring, or validators.
  "posting_anxiety",
  "food_self_control",
  "texting_overthinking",
  "task_avoidance",
  "leaving_house_delay",
  "creator_anxiety",
  "procrastination",
  "getting_ready",
  "phone_distraction",
  "tiny_public_private_awkwardness",
  "work_school_panic",
  "adulting_panic",
  "self_control",
  "self_improvement_attempt",
  "social_plans",
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
  // ── W2-Batch-A vocab additions (additive, draft-only) ──────────
  // The first 50 authored draft entries surfaced these clean,
  // distinct spike labels. Adding them additively widens the draft
  // taxonomy without touching runtime, scoring, or validators.
  "private_embarrassment",
  "self_betrayal",
  "social_panic",
  "quiet_realization",
  "exposed_lie",
  "false_productivity",
  "instant_regret",
  "confused_pause",
  "quiet_guilt",
  "impatient_spiral",
  "avoidance_spike",
  "polite_rage",
  "physical_embarrassment",
  "financial_dread",
  "quiet_defeat",
  "performance_panic",
  "overprepared_panic",
  "excuse_found",
  "caught_off_guard",
  "decision_avoidance",
  "time_loss",
  "self_doubt_spike",
  "mask_drop",
  "self_critique",
  "deadline_panic",
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
  // ── W2-Batch-A vocab additions (additive, draft-only) ──────────
  // The first 50 authored draft entries surfaced these additional
  // settings. Adding them additively widens the draft taxonomy
  // without touching runtime, scoring, or validators.
  "living_room",
  "home",
  "entryway",
  "store",
  // ── PHASE W2-Batch-B vocab addition (additive, draft-only) ─────
  // Surfaced by W2B-009/019/041/044; widened additively per
  // reviewer approval. Mirrors the W2-Batch-A widening pattern.
  "hallway",
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
    // ── PHASE W2-Batch-B — 50 authored draft entries ──────────────
      // Imported verbatim from the W2-Batch-B authoring brief.
      // All 50 ship with `reviewedBy = PENDING_EDITORIAL_REVIEW`.
      // The corpus REMAINS DARK. Vocabulary mismatches against the
      // (already-widened) W2-A controlled vocabularies are SURFACED
      // by `checkWesternHookPackDraftIntegrity` and left for human
      // adjudication. Only setting "hallway" (W2B-009/019/041/044)
      // is currently outside the vocab.
      {
        id: "W2B-001",
        hook: "practicing a two-word reply like HR is watching",
        whatToShow:
          "You rehearse a tiny reply out loud, then type it, delete it, type it again, and still hesitate over send.",
        howToFilm:
          "Keep it close and awkward: first your mouth quietly practicing the reply, then an over-shoulder fake chat. Hold on your thumb hovering over send like this text has legal consequences.",
        caption: "casual reply, courtroom energy.",
        anchor: "reply",
        comedyFamily: "texting_overthinking",
        emotionalSpike: "social_panic",
        setting: "bedroom",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-002",
        hook: "changing the emoji like it changes my entire personality",
        whatToShow:
          "You swap between heart, thumbs-up, laugh, and fire emojis while your face gets more stressed with every option.",
        howToFilm:
          "Shoot over your shoulder on the couch. Let the finger do the panic first, then cut to your face judging every emoji like it says too much about you.",
        caption: "emoji politics are real.",
        anchor: "emoji",
        comedyFamily: "texting_overthinking",
        emotionalSpike: "decision_avoidance",
        setting: "couch",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-003",
        hook: "opening the chat and immediately losing my nerve",
        whatToShow:
          "You open a fake conversation, stare at the empty text field, then back out so fast it feels like you touched a hot stove.",
        howToFilm:
          "Use a visible fake chat and keep the pause uncomfortable. The exit swipe should be quick, guilty, and a little embarrassing.",
        caption: "entered the chat. left emotionally.",
        anchor: "chat",
        comedyFamily: "texting_overthinking",
        emotionalSpike: "avoidance_spike",
        setting: "kitchen",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-004",
        hook: "turning a paragraph of feelings into 'haha yeah'",
        whatToShow:
          "You type a long honest message, stare at it, then delete almost everything until only 'haha yeah' is left.",
        howToFilm:
          "Start on your face thinking way too hard, then show the fake message shrinking line by line. The final two words should feel like a personal defeat.",
        caption: "emotional essay converted to small talk.",
        anchor: "haha",
        comedyFamily: "texting_overthinking",
        emotionalSpike: "self_critique",
        setting: "bedroom",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-005",
        hook: "watching the typing bubble disappear like it broke up with me",
        whatToShow:
          "You stare at a fake 'typing...' bubble, get hopeful, then watch it vanish while your whole face drops.",
        howToFilm:
          "Keep the phone low in frame and focus on your reaction. The bubble disappearing should be quiet, but your disappointment should say everything.",
        caption: "the typing bubble had commitment issues.",
        anchor: "typing",
        comedyFamily: "texting_overthinking",
        emotionalSpike: "social_panic",
        setting: "living_room",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-006",
        hook: "adding 'no pressure' to a message packed with pressure",
        whatToShow:
          "You type a message that clearly wants an answer, add 'no pressure,' then stare at it like even you don't believe yourself.",
        howToFilm:
          "Over-shoulder at a desk. Show the message before and after 'no pressure,' then cut to your side-eye at your own lie.",
        caption: "pressure, but wearing a cardigan.",
        anchor: "pressure",
        comedyFamily: "texting_overthinking",
        emotionalSpike: "exposed_lie",
        setting: "desk",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-007",
        hook: "screenshotting one reply for a full investigation",
        whatToShow:
          "You screenshot a short fake reply, zoom in on one word, and study it like evidence.",
        howToFilm:
          "Bedroom setup, phone close enough to understand the action but fake enough to avoid real messages. Let your face slowly become detective mode.",
        caption: "one text, three theories.",
        anchor: "screenshot",
        comedyFamily: "texting_overthinking",
        emotionalSpike: "private_embarrassment",
        setting: "bedroom",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-008",
        hook: "deleting 'lol' to sound emotionally employed",
        whatToShow:
          "You type 'lol,' pause, delete it, and replace it with 'that's funny' like you're trying to become a serious person.",
        howToFilm:
          "Couch over-shoulder. The replacement should feel unnecessary and deeply self-aware. Add one quick embarrassed look after typing the mature version.",
        caption: "professional laughing.",
        anchor: "lol",
        comedyFamily: "texting_overthinking",
        emotionalSpike: "self_betrayal",
        setting: "couch",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-009",
        hook: "sending the message and hiding from the read receipt",
        whatToShow:
          "You send a fake message, instantly close the app, and place the phone face down like it might retaliate.",
        howToFilm:
          "Shoot the send from over the shoulder, then make the app close fast and panicky. The phone face-down moment is the punchline.",
        caption: "sent it. fled the scene.",
        anchor: "receipt",
        comedyFamily: "texting_overthinking",
        emotionalSpike: "avoidance_spike",
        setting: "hallway" as WesternSetting,
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-010",
        hook: "finding the typo after the message is already gone",
        whatToShow:
          "You send a message, reread it, notice the typo, and freeze like the room temperature changed.",
        howToFilm:
          "Show the fake send, then cut to your eyes catching the typo. Don't overdo the facepalm; a tiny frozen stare is funnier.",
        caption: "proofread after disaster.",
        anchor: "typo",
        comedyFamily: "texting_overthinking",
        emotionalSpike: "instant_regret",
        setting: "bedroom",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-011",
        hook: "taking twelve story selfies to look effortless",
        whatToShow:
          "You take selfie after selfie, each one slightly different, then review them like you're casting a movie.",
        howToFilm:
          "Bathroom mirror or window light works. Let the repetition build: pose, check, delete, pose again. By the end, your face should be tired of your face.",
        caption: "effortless took 14 minutes.",
        anchor: "selfie",
        comedyFamily: "creator_anxiety",
        emotionalSpike: "self_critique",
        setting: "bathroom",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-012",
        hook: "writing the caption and deleting the whole post instead",
        whatToShow:
          "You finish a caption, read it back, lose confidence, and delete the entire fake post.",
        howToFilm:
          "Couch over-shoulder. Build the confidence slowly, then make the delete feel sudden and dramatic, like the caption betrayed you.",
        caption: "drafted bravery. deleted evidence.",
        anchor: "caption",
        comedyFamily: "creator_anxiety",
        emotionalSpike: "decision_avoidance",
        setting: "couch",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-013",
        hook: "reordering clips forever just to use the first take",
        whatToShow:
          "You drag clips around a fake editing timeline, overthink the order, then return everything to how it started.",
        howToFilm:
          "Shoot from desk level with the timeline visible. The funny part is the loop: confident rearranging, confusion, then quiet surrender to the original.",
        caption: "editing in a circle.",
        anchor: "timeline",
        comedyFamily: "creator_anxiety",
        emotionalSpike: "self_critique",
        setting: "desk",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-014",
        hook: "practicing the video entrance until the video never happens",
        whatToShow:
          "You do several fake casual walk-ins, stop each one, reset, and never actually start the video.",
        howToFilm:
          "Wide bedroom shot. Let every entrance get slightly less natural. The final reset should feel like you lost to the first three seconds.",
        caption: "intro took the whole shoot.",
        anchor: "entrance",
        comedyFamily: "creator_anxiety",
        emotionalSpike: "performance_panic",
        setting: "bedroom",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-015",
        hook: "posting and immediately turning off the evidence",
        whatToShow:
          "You upload a fake reel, see 'posted,' then rush to mute notifications before anyone can perceive you.",
        howToFilm:
          "Handheld in the living room. The switch from bold creator to panic settings-scroll should happen instantly.",
        caption: "posted, then went into hiding.",
        anchor: "notifications",
        comedyFamily: "creator_anxiety",
        emotionalSpike: "avoidance_spike",
        setting: "living_room",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-016",
        hook: "refreshing the views like the algorithm owes me an apology",
        whatToShow:
          "You refresh fake post analytics again and again while the number refuses to move.",
        howToFilm:
          "Couch close-up. Show the same number staying still, then your hopeful face slowly turning into customer-service anger.",
        caption: "views loading spiritually.",
        anchor: "views",
        comedyFamily: "posting_anxiety",
        emotionalSpike: "performance_panic",
        setting: "couch",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-017",
        hook: "changing the cover photo like it decides my future",
        whatToShow:
          "You cycle through cover photo options, reject each one, then come back to the first.",
        howToFilm:
          "Bedroom mirror or desk angle. Make each tiny thumbnail decision feel way too important. Your face should judge harder than the audience ever will.",
        caption: "thumbnail court is in session.",
        anchor: "cover",
        comedyFamily: "posting_anxiety",
        emotionalSpike: "self_critique",
        setting: "bedroom",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-018",
        hook: "posting and checking who liked it like attendance",
        whatToShow:
          "You post something, then immediately open the likes list to see who showed up first.",
        howToFilm:
          "Desk shot. The post goes live, then your hand jumps to the likes list too quickly to pretend it's casual.",
        caption: "roll call for my ego.",
        anchor: "likes",
        comedyFamily: "posting_anxiety",
        emotionalSpike: "social_panic",
        setting: "desk",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-019",
        hook: "saving the story draft like future me is braver",
        whatToShow:
          "You finish a story, hover over post, then hit save draft and look relieved for all the wrong reasons.",
        howToFilm:
          "Hallway natural light. Let the final check feel real, then make the save-draft tap feel like a tiny escape.",
        caption: "future me has been assigned courage.",
        anchor: "draft",
        comedyFamily: "posting_anxiety",
        emotionalSpike: "avoidance_spike",
        setting: "hallway" as WesternSetting,
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-020",
        hook: "testing the post on close friends like a focus group",
        whatToShow:
          "You post a fake story to close friends, then immediately watch it yourself to judge if it survives public release.",
        howToFilm:
          "Kitchen or bedroom setup. The comedy is the seriousness of the test: post, watch, analyze, still panic.",
        caption: "soft launch for my confidence.",
        anchor: "close",
        comedyFamily: "posting_anxiety",
        emotionalSpike: "private_embarrassment",
        setting: "kitchen",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-021",
        hook: "decorating the planner instead of having a plan",
        whatToShow:
          "You color headers, draw boxes, and make the planner look beautiful while the actual task lines stay empty.",
        howToFilm:
          "Top-down desk shot. Make the coloring look genuinely satisfying, then reveal the blank task section like a confession.",
        caption: "the planner is thriving. i am not.",
        anchor: "planner",
        comedyFamily: "task_avoidance",
        emotionalSpike: "false_productivity",
        setting: "desk",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-022",
        hook: "organizing socks to avoid one email",
        whatToShow:
          "You pair socks with intense focus while a laptop with an unread email sits untouched nearby.",
        howToFilm:
          "Bedroom floor angle. Show the socks getting more organized as your guilt gets louder. Glance at the laptop once like it's haunted.",
        caption: "sock drawer emergency.",
        anchor: "socks",
        comedyFamily: "task_avoidance",
        emotionalSpike: "avoidance_spike",
        setting: "bedroom",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-023",
        hook: "building the focus playlist instead of focusing",
        whatToShow:
          "You spend time picking songs for work while the actual task stays minimized.",
        howToFilm:
          "Couch shot with phone or laptop visible. Treat every song choice like productivity, then reveal the untouched work.",
        caption: "soundtrack ready. plot missing.",
        anchor: "playlist",
        comedyFamily: "task_avoidance",
        emotionalSpike: "false_productivity",
        setting: "couch",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-024",
        hook: "watering plants like the deadline is theirs",
        whatToShow:
          "You carefully water every plant while a timer, laptop, or assignment waits in the background.",
        howToFilm:
          "Living room wide shot. Move slowly and responsibly with the plants, then cut to the work still sitting there untouched.",
        caption: "plants got my attention first.",
        anchor: "plants",
        comedyFamily: "task_avoidance",
        emotionalSpike: "false_productivity",
        setting: "living_room",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-025",
        hook: "rearranging desktop icons like the work will respect me",
        whatToShow:
          "You drag icons into neat folders while the real document waits untouched.",
        howToFilm:
          "Desk close-up on the laptop and your hands. The satisfied nod after organizing icons should be way too proud for what just happened.",
        caption: "digital cleaning, real avoidance.",
        anchor: "desktop",
        comedyFamily: "task_avoidance",
        emotionalSpike: "false_productivity",
        setting: "desk",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-026",
        hook: "checking the forecast like it explains why i'm not working",
        whatToShow:
          "You open the weather app and scroll hourly details while the task you meant to do stays ignored.",
        howToFilm:
          "Kitchen table or desk. Make the weather check look thoughtful, like cloud coverage is part of the assignment.",
        caption: "meteorology instead of responsibility.",
        anchor: "forecast",
        comedyFamily: "task_avoidance",
        emotionalSpike: "avoidance_spike",
        setting: "kitchen",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-027",
        hook: "folding one shirt like i earned a break",
        whatToShow:
          "You fold one shirt very carefully, then look at your untouched work like the day has been productive.",
        howToFilm:
          "Couch or bed angle. The fold should be slow and dramatic. Afterward, glance at the task with the confidence of someone who did almost nothing.",
        caption: "one shirt changed everything.",
        anchor: "shirt",
        comedyFamily: "task_avoidance",
        emotionalSpike: "false_productivity",
        setting: "couch",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-028",
        hook: "opening a new notes app to avoid the old problem",
        whatToShow:
          "You create a fresh note, type a title, and start brainstorming around the task instead of doing it.",
        howToFilm:
          "Desk handheld. The new blank note should feel like a fresh start, then slowly reveal it's just another hiding place.",
        caption: "new document, same avoidance.",
        anchor: "notes",
        comedyFamily: "task_avoidance",
        emotionalSpike: "decision_avoidance",
        setting: "desk",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-029",
        hook: "watching one short for research and losing twenty minutes",
        whatToShow:
          "You open one short next to your work, then keep scrolling while the work stays untouched.",
        howToFilm:
          "Bedroom or desk. Keep the work visible in the corner so every scroll feels like betrayal. End with the guilty side-glance.",
        caption: "research became habitat.",
        anchor: "short",
        comedyFamily: "phone_distraction",
        emotionalSpike: "time_loss",
        setting: "bedroom",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-030",
        hook: "color-coding sticky notes for a task i still won't do",
        whatToShow:
          "You label and arrange sticky notes beautifully while the actual task stays blank.",
        howToFilm:
          "Living room table, top-down. Let the colors look impressive, then reveal that none of them contain real progress.",
        caption: "stationery cosplay.",
        anchor: "sticky",
        comedyFamily: "task_avoidance",
        emotionalSpike: "false_productivity",
        setting: "living_room",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-031",
        hook: "seeing a meeting invite and immediately losing my afternoon",
        whatToShow:
          "You open a fake meeting invite, switch to your calendar, and watch your face calculate the damage.",
        howToFilm:
          "Desk side angle. The invite should land quietly, but your shoulders should react like the day just got reorganized by force.",
        caption: "one invite moved the furniture in my brain.",
        anchor: "invite",
        comedyFamily: "work_school_panic",
        emotionalSpike: "performance_panic",
        setting: "desk",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-032",
        hook: "joining the call and forgetting my own personality",
        whatToShow:
          "You join a fake call, get asked to introduce yourself, and freeze before giving the most awkward version possible.",
        howToFilm:
          "Laptop-height front shot. Start with confident posture, then let the panic smile arrive the second you're perceived.",
        caption: "professional until spoken to.",
        anchor: "call",
        comedyFamily: "work_school_panic",
        emotionalSpike: "caught_off_guard",
        setting: "desk",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-033",
        hook: "opening the shared doc and vanishing to another tab",
        whatToShow:
          "You open a shared doc, see the work waiting, then immediately switch tabs like you didn't see it.",
        howToFilm:
          "Laptop over-shoulder. The tab switch should be fast and guilty, like avoiding eye contact with a person.",
        caption: "the doc loaded. i departed.",
        anchor: "doc",
        comedyFamily: "work_school_panic",
        emotionalSpike: "avoidance_spike",
        setting: "desk",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-034",
        hook: "opening the update thread and choosing peace",
        whatToShow:
          "You open a busy fake work chat, see too many updates, and close it without emotionally entering.",
        howToFilm:
          "Phone or laptop on desk. Scroll just enough to show the chaos, then exit with a face that says 'not today.'",
        caption: "informed enough to leave.",
        anchor: "thread",
        comedyFamily: "work_school_panic",
        emotionalSpike: "social_panic",
        setting: "desk",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-035",
        hook: "checking the deadline and doing emergency math",
        whatToShow:
          "You look at a fake deadline, count days or hours on your fingers, and realize the math does not love you.",
        howToFilm:
          "Desk close-up. Hold on the counting because that's where the panic becomes visible. End when you run out of fingers or hope.",
        caption: "deadline math is a horror genre.",
        anchor: "deadline",
        comedyFamily: "work_school_panic",
        emotionalSpike: "performance_panic",
        setting: "desk",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-036",
        hook: "talking on mute with full confidence",
        whatToShow:
          "You answer a fake call question, speak for several seconds, then notice you're still muted.",
        howToFilm:
          "Desk selfie style. The confidence before the mute discovery is everything. Let the realization hit slowly, then frantic unmute.",
        caption: "gave a speech to myself.",
        anchor: "mute",
        comedyFamily: "work_school_panic",
        emotionalSpike: "instant_regret",
        setting: "desk",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-037",
        hook: "seeing my name in the work thread and holding my breath",
        whatToShow:
          "A fake work notification shows your name, and you open it like it might contain a tiny court case.",
        howToFilm:
          "Desk shot. Start relaxed, then let the notification change your whole posture. Open it slowly.",
        caption: "my name should not appear without warning.",
        anchor: "name",
        comedyFamily: "work_school_panic",
        emotionalSpike: "social_panic",
        setting: "desk",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-038",
        hook: "rereading the report after sending it like edits still count",
        whatToShow:
          "You open a sent fake report, scan every line, and react to tiny things you can no longer change.",
        howToFilm:
          "Laptop screen plus your face. The scroll should get slower as the regret gets louder.",
        caption: "post-send proofreading is self-harm-adjacent but corporate.",
        anchor: "report",
        comedyFamily: "work_school_panic",
        emotionalSpike: "instant_regret",
        setting: "desk",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-039",
        hook: "shoes on, still spiritually inside",
        whatToShow:
          "You sit by the door with shoes fully on, then pull out your phone instead of leaving.",
        howToFilm:
          "Low entryway angle. Make the shoes look ready and the rest of you look absolutely not ready.",
        caption: "dressed for departure. not participating.",
        anchor: "shoes",
        comedyFamily: "leaving_house_delay",
        emotionalSpike: "decision_avoidance",
        setting: "entryway",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-040",
        hook: "bag on shoulder, memory suddenly becomes useful",
        whatToShow:
          "You grab your bag, reach the door, then remember one more thing and turn back inside.",
        howToFilm:
          "Entryway wide shot. The pause at the door is the joke. Let your body visibly accept defeat before turning around.",
        caption: "one more thing has entered the chat.",
        anchor: "bag",
        comedyFamily: "leaving_house_delay",
        emotionalSpike: "avoidance_spike",
        setting: "entryway",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-041",
        hook: "one last mirror check becoming a full audit",
        whatToShow:
          "You check the mirror before leaving, fix one thing, then another, then another.",
        howToFilm:
          "Hallway mirror angle. Start casual, then let each tiny fix make you more suspicious of the whole outfit.",
        caption: "mirror opened an investigation.",
        anchor: "mirror",
        comedyFamily: "leaving_house_delay",
        emotionalSpike: "self_critique",
        setting: "hallway" as WesternSetting,
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-042",
        hook: "sitting in the car like the car will start emotionally",
        whatToShow:
          "You sit in the driver's seat with keys ready, stare forward, and still don't start the car.",
        howToFilm:
          "Car interior shot from the passenger side. Let the silence sit. You are physically in the car but mentally still at home.",
        caption: "vehicle ready. person pending.",
        anchor: "car",
        comedyFamily: "leaving_house_delay",
        emotionalSpike: "decision_avoidance",
        setting: "car",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-043",
        hook: "locking the door and instantly remembering my water bottle",
        whatToShow:
          "You lock the door, pause, unlock it, and step back inside for the water bottle.",
        howToFilm:
          "Entryway close-up. The lock click should feel final, then let the pause betray you. Unlocking is the punchline.",
        caption: "hydration delayed the mission.",
        anchor: "water",
        comedyFamily: "leaving_house_delay",
        emotionalSpike: "avoidance_spike",
        setting: "entryway",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-044",
        hook: "walking to the door and remembering my charger like a plot twist",
        whatToShow:
          "You head toward the door, stop suddenly, and turn back for the charger.",
        howToFilm:
          "Hallway tracking shot. Keep the walk normal, then make the stop abrupt like your brain just shouted from another room.",
        caption: "charger remembered me first.",
        anchor: "charger",
        comedyFamily: "leaving_house_delay",
        emotionalSpike: "caught_off_guard",
        setting: "hallway" as WesternSetting,
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-045",
        hook: "reaching for the snack like we're in negotiations",
        whatToShow:
          "Your hand reaches for a snack, pulls back, reaches again, and finally gives in.",
        howToFilm:
          "Kitchen close-up on the hand, snack, and your face. The back-and-forth should feel like a tiny moral debate.",
        caption: "willpower requested a recess.",
        anchor: "snack",
        comedyFamily: "food_self_control",
        emotionalSpike: "self_betrayal",
        setting: "kitchen",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-046",
        hook: "pouring a responsible bowl and then correcting the mistake",
        whatToShow:
          "You pour a tiny bowl of cereal, stare at it, then add much more.",
        howToFilm:
          "Kitchen counter angle. The first pour should look disciplined. The second pour should look honest.",
        caption: "portion control was a draft.",
        anchor: "cereal",
        comedyFamily: "food_self_control",
        emotionalSpike: "self_betrayal",
        setting: "kitchen",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-047",
        hook: "checking the fridge again like it got a delivery",
        whatToShow:
          "You open the fridge for the third time, scan the same shelves, and close it empty-handed.",
        howToFilm:
          "Kitchen handheld or inside-fridge angle. Make the third check feel hopeful, then let the disappointment be very quiet.",
        caption: "fridge refresh failed.",
        anchor: "fridge",
        comedyFamily: "food_self_control",
        emotionalSpike: "avoidance_spike",
        setting: "kitchen",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-048",
        hook: "cutting a tiny slice of cake as a lie",
        whatToShow:
          "You cut a small slice, pause, then return with the knife for the bigger piece you actually wanted.",
        howToFilm:
          "Kitchen counter shot. The tiny slice is the performance. The second cut is the truth.",
        caption: "small slice was for witnesses.",
        anchor: "cake",
        comedyFamily: "food_self_control",
        emotionalSpike: "self_betrayal",
        setting: "kitchen",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-049",
        hook: "waving back and realizing the wave was never mine",
        whatToShow:
          "You wave at someone in a store aisle, realize they were waving behind you, and try to turn it into a stretch or hair fix.",
        howToFilm:
          "Store handheld or staged hallway. The recovery move matters: make it worse by pretending the wave was intentional.",
        caption: "borrowed someone else's greeting.",
        anchor: "wave",
        comedyFamily: "tiny_public_private_awkwardness",
        emotionalSpike: "private_embarrassment",
        setting: "store",
        reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
    {
        id: "W2B-050",
        hook: "holding the door so long it becomes a hostage situation",
        whatToShow:
          "You hold a door for someone too far away, commit too early, and stand there smiling through the regret.",
        howToFilm:
          "Store entrance or hallway. Hold the door and let the distance feel ridiculous. Your smile should slowly become a cry for help.",
        caption: "door etiquette got away from me.",
        anchor: "door",
        comedyFamily: "tiny_public_private_awkwardness",
        emotionalSpike: "caught_off_guard",
        setting: "store",
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
