/**
   * PHASE W2-L — curated W2-BATCH-NEXT promotion entries (DARK by
   * default; surfaced through the W2-K runtime path via
   * `westernHookPackApproved.ts`).
   *
   * 100 editorial-curated Western hooks supplied as a single batch
   * (W2-BATCH-NEXT-001..100). Imported under Path A guardrails:
   *
   *   • single runtime path — entries flow through the SAME approved
   *     pool that W2-K activated; no new public API surface.
   *   • howToFilm + caption are SYNTHESIZED deterministically here
   *     from the curated WHAT TO SHOW + voiceCluster + emotionalSpike
   *     (so every entry stays small and filmable without inviting
   *     creator-voice editorialization in the import script).
   *   • freeform vocab from the curated batch (Comedy family,
   *     Emotional spike, Setting) is normalized into the EXISTING
   *     `WESTERN_COMEDY_FAMILIES` / `WESTERN_EMOTIONAL_SPIKES` /
   *     `WESTERN_SETTINGS` controlled vocab — no enum widening was
   *     necessary for any curated entry.
   *   • anchor is normalized to a single token that appears
   *     (lowercased) in whatToShow — exactly the invariant the W2-I
   *     unit test enforces. Five entries (#36, #66, #74, #81, #86)
   *     received an anchor swap to avoid collision with an existing
   *     approved (anchor|setting|comedyFamily) triple; one entry
   *     (#38) received an anchor swap to avoid collision with another
   *     batch entry on (comedyFamily|emotionalSpike|anchor).
   *
   * Cross-batch dedup verified at import time vs:
   *   • `APPROVED_WESTERN_PROMOTION_CANDIDATES` (existing 100)
   *   • `WESTERN_HOOK_PACK_DRAFT` (150)
   *   • `userBlessedHookCorpus.ts` (heuristic string scan)
   *   • this batch's own running set
   *
   * Exact-hook, normalized-skeleton (long tokens >=5 chars -> "__",
   * cap 24), bigram-Jaccard >= 0.50, and (anchor|setting|comedyFamily)
   * triple — all enforced at import time. Result: 100/100 accepted.
   *
   * The captured-but-not-stored fields (voiceCluster, hookStyle,
   * whyThisWorks, safetyNote, originalBatchNumber) live in the
   * `.local/W2L_REPORT.md` import report — they are deliberately
   * NOT carried on the runtime entry to keep the existing
   * `WesternHookPackDraftEntry` shape intact (no schema/migration).
   *
   * Production stays OFF — gating still flows through
   * `isWesternApprovedPoolFeatureEnabled` +
   * `canActivateWesternApprovedPool`. Promotion to live requires a
   * separate editorial-review PR that overwrites
   * `reviewedBy: PENDING_EDITORIAL_REVIEW`.
   */

  import {
    PENDING_EDITORIAL_REVIEW,
    type WesternHookPackDraftEntry,
  } from "./westernHookPack.js";

  export const WESTERN_HOOK_PACK_BATCH_NEXT_IDS: readonly string[] =
    Object.freeze([
    "w2_next_001",
  "w2_next_002",
  "w2_next_003",
  "w2_next_004",
  "w2_next_005",
  "w2_next_006",
  "w2_next_007",
  "w2_next_008",
  "w2_next_009",
  "w2_next_010",
  "w2_next_011",
  "w2_next_012",
  "w2_next_013",
  "w2_next_014",
  "w2_next_015",
  "w2_next_016",
  "w2_next_017",
  "w2_next_018",
  "w2_next_019",
  "w2_next_020",
  "w2_next_021",
  "w2_next_022",
  "w2_next_023",
  "w2_next_024",
  "w2_next_025",
  "w2_next_026",
  "w2_next_027",
  "w2_next_028",
  "w2_next_029",
  "w2_next_030",
  "w2_next_031",
  "w2_next_032",
  "w2_next_033",
  "w2_next_034",
  "w2_next_035",
  "w2_next_036",
  "w2_next_037",
  "w2_next_038",
  "w2_next_039",
  "w2_next_040",
  "w2_next_041",
  "w2_next_042",
  "w2_next_043",
  "w2_next_044",
  "w2_next_045",
  "w2_next_046",
  "w2_next_047",
  "w2_next_048",
  "w2_next_049",
  "w2_next_050",
  "w2_next_051",
  "w2_next_052",
  "w2_next_053",
  "w2_next_054",
  "w2_next_055",
  "w2_next_056",
  "w2_next_057",
  "w2_next_058",
  "w2_next_059",
  "w2_next_060",
  "w2_next_061",
  "w2_next_062",
  "w2_next_063",
  "w2_next_064",
  "w2_next_065",
  "w2_next_066",
  "w2_next_067",
  "w2_next_068",
  "w2_next_069",
  "w2_next_070",
  "w2_next_071",
  "w2_next_072",
  "w2_next_073",
  "w2_next_074",
  "w2_next_075",
  "w2_next_076",
  "w2_next_077",
  "w2_next_078",
  "w2_next_079",
  "w2_next_080",
  "w2_next_081",
  "w2_next_082",
  "w2_next_083",
  "w2_next_084",
  "w2_next_085",
  "w2_next_086",
  "w2_next_087",
  "w2_next_088",
  "w2_next_089",
  "w2_next_090",
  "w2_next_091",
  "w2_next_092",
  "w2_next_093",
  "w2_next_094",
  "w2_next_095",
  "w2_next_096",
  "w2_next_097",
  "w2_next_098",
  "w2_next_099",
  "w2_next_100",
    ]);

  export const WESTERN_HOOK_PACK_BATCH_NEXT: readonly WesternHookPackDraftEntry[] =
    Object.freeze([
    {
      id: "w2_next_001",
      hook: "My fridge light just exposed another week of good intentions",
      whatToShow:
        "Fridge door swings open, slow pan across wilting kale bag next to three identical takeout containers, hand grabs yogurt instead, door slams",
      howToFilm:
        "Single static shot, framed on the fridge. Let the action play in one take — no cuts inside the beat. Hold one beat too long after the punchline; small and reflective.",
      caption: "the fridge knows.",
      anchor: "fridge",
      comedyFamily: "anxious_optimism",
      emotionalSpike: "self_critique",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_002",
      hook: "The takeout bag math that never adds up",
      whatToShow:
        "Kitchen counter close-up unpacking bag, pulling out twelve sauce packets and three napkins before the actual tiny entrée appears",
      howToFilm:
        "Single static shot, framed on the actual. Let the action play in one take — no cuts inside the beat. Keep your face deadpan and let the silence land.",
      caption: "actual update: not great.",
      anchor: "actual",
      comedyFamily: "tiny_humiliation",
      emotionalSpike: "quiet_defeat",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_003",
      hook: "Third night of leftovers and I’m still pretending",
      whatToShow:
        "Microwave door opens, Tupperware sniffed dramatically, single bite taken with full regret face while nodding “it’s fine”",
      howToFilm:
        "Single static shot, framed on the microwave. Let the action play in one take — no cuts inside the beat. Lean slightly theatrical on the final beat; treat it like breaking news.",
      caption: "microwave? never met them.",
      anchor: "microwave",
      comedyFamily: "self_betrayal",
      emotionalSpike: "avoidance_spike",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_004",
      hook: "Cutting board looks like a crime scene every single time",
      whatToShow:
        "Close-up of uneven carrot chunks next to phone recipe photo, knife pauses mid-chop as I stare in defeat",
      howToFilm:
        "Single static shot, framed on the close. Let the action play in one take — no cuts inside the beat. Talk like you are confessing to a friend; loose and a little frantic.",
      caption: "close update: not great.",
      anchor: "close",
      comedyFamily: "tiny_humiliation",
      emotionalSpike: "quiet_defeat",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_005",
      hook: "Grocery bags unloaded and the snacks won again",
      whatToShow:
        "Counter covered in bags, healthy items placed neatly then pushed aside as chip bags take over the frame",
      howToFilm:
        "Single static shot, framed on the bags. Let the action play in one take — no cuts inside the beat. Keep your face deadpan and let the silence land.",
      caption: "the bags knows.",
      anchor: "bags",
      comedyFamily: "self_betrayal",
      emotionalSpike: "instant_regret",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_006",
      hook: "That unopened yogurt is now part of the fridge furniture",
      whatToShow:
        "Fridge door opens, hand reaches for yogurt, pauses at the date, gently rotates it to the back like hiding evidence",
      howToFilm:
        "Single static shot, framed on the yogurt. Let the action play in one take — no cuts inside the beat. Hold one beat too long after the punchline; small and reflective.",
      caption: "yogurt update: not great.",
      anchor: "yogurt",
      comedyFamily: "parasocial_object",
      emotionalSpike: "quiet_defeat",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_007",
      hook: "I bought oat milk like an adult and it’s still unopened",
      whatToShow:
        "Fridge pull, oat milk carton held up proudly then placed back untouched next to regular milk",
      howToFilm:
        "Single static shot, framed on the milk. Let the action play in one take — no cuts inside the beat. Lean slightly theatrical on the final beat; treat it like breaking news.",
      caption: "milk update: not great.",
      anchor: "milk",
      comedyFamily: "self_improvement_attempt",
      emotionalSpike: "quiet_defeat",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_008",
      hook: "Microwave said done and I still negotiated with it",
      whatToShow:
        "Microwave beeps, food gets opened, poked once, door closes again for “just 12 more seconds”",
      howToFilm:
        "Single static shot, framed on the food. Let the action play in one take — no cuts inside the beat. Keep your face deadpan and let the silence land.",
      caption: "food math.",
      anchor: "food",
      comedyFamily: "task_avoidance",
      emotionalSpike: "confused_pause",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_009",
      hook: "My “one bowl” dinner turned into three separate plates",
      whatToShow:
        "Counter with one empty bowl then three half-used plates of random ingredients",
      howToFilm:
        "Single static shot, framed on the bowl. Let the action play in one take — no cuts inside the beat. Talk like you are confessing to a friend; loose and a little frantic.",
      caption: "bowl update: not great.",
      anchor: "bowl",
      comedyFamily: "tiny_humiliation",
      emotionalSpike: "quiet_defeat",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_010",
      hook: "Freezer drawer refuses to close for the fourth night",
      whatToShow:
        "Freezer door open, hand shoving ice cream tub deeper, drawer still won’t shut",
      howToFilm:
        "Single static shot, framed on the freezer. Let the action play in one take — no cuts inside the beat. Hold one beat too long after the punchline; small and reflective.",
      caption: "freezer won.",
      anchor: "freezer",
      comedyFamily: "parasocial_object",
      emotionalSpike: "polite_rage",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_011",
      hook: "My meal prep era fit inside one container",
      whatToShow:
        "One lonely Tupperware centered on the counter, surrounded by empty grocery bags and takeout utensils",
      howToFilm:
        "Single static shot, framed on the lonely. Let the action play in one take — no cuts inside the beat. Keep your face deadpan and let the silence land.",
      caption: "lonely update: not great.",
      anchor: "lonely",
      comedyFamily: "self_betrayal",
      emotionalSpike: "quiet_defeat",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_012",
      hook: "Condiment shelf has seventeen mustards and no ketchup",
      whatToShow:
        "Fridge door open, condiments scanned, hand holds up random mustards",
      howToFilm:
        "Single static shot, framed on the mustards. Let the action play in one take — no cuts inside the beat. Lean slightly theatrical on the final beat; treat it like breaking news.",
      caption: "mustards update: not great.",
      anchor: "mustards",
      comedyFamily: "tiny_humiliation",
      emotionalSpike: "quiet_defeat",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_013",
      hook: "Grocery list still has confidence I lost days ago",
      whatToShow:
        "Phone note shows “spinach, bananas, salmon,” then camera cuts to chips, coffee, and no bananas",
      howToFilm:
        "Single static shot, framed on the phone. Let the action play in one take — no cuts inside the beat. Hold one beat too long after the punchline; small and reflective.",
      caption: "phone math.",
      anchor: "phone",
      comedyFamily: "task_avoidance",
      emotionalSpike: "quiet_realization",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_014",
      hook: "Toast landed butter-side down again",
      whatToShow:
        "Butter knife hovers, bread drops, slow-motion regret face",
      howToFilm:
        "Single static shot, framed on the butter. Let the action play in one take — no cuts inside the beat. Talk like you are confessing to a friend; loose and a little frantic.",
      caption: "butter update: not great.",
      anchor: "butter",
      comedyFamily: "tiny_humiliation",
      emotionalSpike: "quiet_defeat",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_015",
      hook: "I cooked rice and immediately ordered pizza",
      whatToShow:
        "Pot of rice on stove, phone showing pizza tracker, shrug to camera",
      howToFilm:
        "Single static shot, framed on the rice. Let the action play in one take — no cuts inside the beat. Keep your face deadpan and let the silence land.",
      caption: "rice? never met them.",
      anchor: "rice",
      comedyFamily: "self_betrayal",
      emotionalSpike: "avoidance_spike",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_016",
      hook: "Cart total hit $92 and I still added gum",
      whatToShow:
        "Kitchen table with unpacked bags, hand drops one last pack of gum on top",
      howToFilm:
        "Single static shot, framed on the kitchen. Let the action play in one take — no cuts inside the beat. Keep your face deadpan and let the silence land.",
      caption: "the kitchen knows.",
      anchor: "kitchen",
      comedyFamily: "self_betrayal",
      emotionalSpike: "instant_regret",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_017",
      hook: "I opened my bank app like it owed me emotional support",
      whatToShow:
        "Phone angled away from camera, face goes from hopeful to blank, app gets closed with two fingers",
      howToFilm:
        "Single static shot, framed on the phone. Let the action play in one take — no cuts inside the beat. Talk like you are confessing to a friend; loose and a little frantic.",
      caption: "phone situation, ongoing.",
      anchor: "phone",
      comedyFamily: "task_avoidance",
      emotionalSpike: "social_panic",
      setting: "couch",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_018",
      hook: "A subscription from my confident era just charged me",
      whatToShow:
        "Phone notification appears, cut to me staring at the app icon like I’m trying to remember who I was",
      howToFilm:
        "Single static shot, framed on the phone. Let the action play in one take — no cuts inside the beat. Hold one beat too long after the punchline; small and reflective.",
      caption: "the phone knows.",
      anchor: "phone",
      comedyFamily: "tiny_humiliation",
      emotionalSpike: "financial_dread",
      setting: "desk",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_019",
      hook: "Checkout line total made me put back the fancy cheese",
      whatToShow:
        "Kitchen table with groceries, fancy cheese placed back in bag while sighing",
      howToFilm:
        "Single static shot, framed on the back. Let the action play in one take — no cuts inside the beat. Lean slightly theatrical on the final beat; treat it like breaking news.",
      caption: "back update: not great.",
      anchor: "back",
      comedyFamily: "self_betrayal",
      emotionalSpike: "quiet_defeat",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_020",
      hook: "My “treat yourself” budget lasts until Wednesday",
      whatToShow:
        "Wallet on table, cards fanned out, hand puts one back",
      howToFilm:
        "Single static shot, framed on the wallet. Let the action play in one take — no cuts inside the beat. Keep your face deadpan and let the silence land.",
      caption: "the wallet knows.",
      anchor: "wallet",
      comedyFamily: "self_betrayal",
      emotionalSpike: "instant_regret",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_021",
      hook: "Parking lot receipt still in my cupholder two weeks later",
      whatToShow:
        "Car dashboard close-up, hand grabs crumpled receipt, tosses it in glovebox",
      howToFilm:
        "Single static shot, framed on the receipt. Let the action play in one take — no cuts inside the beat. Talk like you are confessing to a friend; loose and a little frantic.",
      caption: "the receipt knows.",
      anchor: "receipt",
      comedyFamily: "tiny_humiliation",
      emotionalSpike: "quiet_guilt",
      setting: "car",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_022",
      hook: "I budgeted for coffee and still bought the large",
      whatToShow:
        "Coffee cup on desk, receipt next to it showing large size",
      howToFilm:
        "Single static shot, framed on the coffee. Let the action play in one take — no cuts inside the beat. Hold one beat too long after the punchline; small and reflective.",
      caption: "coffee update: not great.",
      anchor: "coffee",
      comedyFamily: "self_betrayal",
      emotionalSpike: "quiet_defeat",
      setting: "desk",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_023",
      hook: "Cart had three “essentials” and fourteen snacks",
      whatToShow:
        "Kitchen table unload, snacks pile visibly larger",
      howToFilm:
        "Single static shot, framed on the snacks. Let the action play in one take — no cuts inside the beat. Lean slightly theatrical on the final beat; treat it like breaking news.",
      caption: "snacks math.",
      anchor: "snacks",
      comedyFamily: "self_betrayal",
      emotionalSpike: "quiet_realization",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_024",
      hook: "Payment failed and somehow I felt personally reviewed",
      whatToShow:
        "Phone shows generic payment error, hand slowly turns the phone face-down like ending a conversation",
      howToFilm:
        "Single static shot, framed on the payment. Let the action play in one take — no cuts inside the beat. Keep your face deadpan and let the silence land.",
      caption: "payment update: not great.",
      anchor: "payment",
      comedyFamily: "tiny_humiliation",
      emotionalSpike: "quiet_defeat",
      setting: "couch",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_025",
      hook: "I canceled three subscriptions and kept the one I forgot",
      whatToShow:
        "Laptop screen subscription list, finger hovers, skips the forgotten one",
      howToFilm:
        "Single static shot, framed on the laptop. Let the action play in one take — no cuts inside the beat. Hold one beat too long after the punchline; small and reflective.",
      caption: "laptop update: not great.",
      anchor: "laptop",
      comedyFamily: "task_avoidance",
      emotionalSpike: "quiet_defeat",
      setting: "desk",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_026",
      hook: "Receipt says $6.99 and my brain says “worth it”",
      whatToShow:
        "Small item on kitchen table next to receipt, shrug to camera",
      howToFilm:
        "Single static shot, framed on the receipt. Let the action play in one take — no cuts inside the beat. Talk like you are confessing to a friend; loose and a little frantic.",
      caption: "no comment on the receipt.",
      anchor: "receipt",
      comedyFamily: "self_betrayal",
      emotionalSpike: "quiet_guilt",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_027",
      hook: "My savings goal notification just got swiped away",
      whatToShow:
        "Phone lock screen savings alert, finger swipe dismisses it",
      howToFilm:
        "Single static shot, framed on the savings. Let the action play in one take — no cuts inside the beat. Keep your face deadpan and let the silence land.",
      caption: "the savings knows.",
      anchor: "savings",
      comedyFamily: "self_improvement_attempt",
      emotionalSpike: "quiet_guilt",
      setting: "couch",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_028",
      hook: "Typing bubble stayed so long I started preparing emotionally",
      whatToShow:
        "Phone with typing dots, creator sits upright, fixes posture, then the dots vanish",
      howToFilm:
        "Single static shot, framed on the typing. Let the action play in one take — no cuts inside the beat. Talk like you are confessing to a friend; loose and a little frantic.",
      caption: "typing update: not great.",
      anchor: "typing",
      comedyFamily: "texting_overthinking",
      emotionalSpike: "quiet_defeat",
      setting: "couch",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_029",
      hook: "Read at 2:14am turned my ceiling into a witness",
      whatToShow:
        "Phone lights up in bed, creator lowers phone and stares straight at the ceiling like it has answers",
      howToFilm:
        "Single static shot, framed on the ceiling. Let the action play in one take — no cuts inside the beat. Hold one beat too long after the punchline; small and reflective.",
      caption: "ceiling math.",
      anchor: "ceiling",
      comedyFamily: "texting_overthinking",
      emotionalSpike: "caught_off_guard",
      setting: "bedroom",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_030",
      hook: "The second text left my body before my pride could stop it",
      whatToShow:
        "Two message bubbles on phone, thumb hovers over delete even though it is already sent",
      howToFilm:
        "Single static shot, framed on the message. Let the action play in one take — no cuts inside the beat. Lean slightly theatrical on the final beat; treat it like breaking news.",
      caption: "the message knows.",
      anchor: "message",
      comedyFamily: "texting_overthinking",
      emotionalSpike: "instant_regret",
      setting: "couch",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_031",
      hook: "Voice note deleted after thirty seconds of rambling",
      whatToShow:
        "Phone recording screen, finger hits delete after long voice note",
      howToFilm:
        "Single static shot, framed on the voice. Let the action play in one take — no cuts inside the beat. Keep your face deadpan and let the silence land.",
      caption: "voice update: not great.",
      anchor: "voice",
      comedyFamily: "self_betrayal",
      emotionalSpike: "quiet_defeat",
      setting: "desk",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_032",
      hook: "They said “k” and I assembled a legal defense",
      whatToShow:
        "Phone shows “k,” creator types a huge paragraph, deletes it, then sends “cool”",
      howToFilm:
        "Single static shot, framed on the phone. Let the action play in one take — no cuts inside the beat. Talk like you are confessing to a friend; loose and a little frantic.",
      caption: "still about the phone.",
      anchor: "phone",
      comedyFamily: "texting_overthinking",
      emotionalSpike: "social_panic",
      setting: "couch",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_033",
      hook: "Four hours on delivered and I became a private investigator",
      whatToShow:
        "Phone shows delivered status, creator checks Wi-Fi, battery, app, then pretends not to care",
      howToFilm:
        "Single static shot, framed on the delivered. Let the action play in one take — no cuts inside the beat. Lean slightly theatrical on the final beat; treat it like breaking news.",
      caption: "delivered won.",
      anchor: "delivered",
      comedyFamily: "texting_overthinking",
      emotionalSpike: "impatient_spiral",
      setting: "couch",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_034",
      hook: "Group chat went quiet and I assumed I was canceled",
      whatToShow:
        "Phone group chat silence, me staring then typing “haha” then deleting",
      howToFilm:
        "Single static shot, framed on the group. Let the action play in one take — no cuts inside the beat. Hold one beat too long after the punchline; small and reflective.",
      caption: "group situation, ongoing.",
      anchor: "group",
      comedyFamily: "texting_overthinking",
      emotionalSpike: "social_panic",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_035",
      hook: "Screenshot sent to wrong person and I’m dying",
      whatToShow:
        "Phone send confirmation to wrong chat, hand slaps forehead",
      howToFilm:
        "Single static shot, framed on the wrong. Let the action play in one take — no cuts inside the beat. Talk like you are confessing to a friend; loose and a little frantic.",
      caption: "wrong situation, ongoing.",
      anchor: "wrong",
      comedyFamily: "self_betrayal",
      emotionalSpike: "panic",
      setting: "desk",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_036",
      hook: "“We should catch up” text I will never follow through on",
      whatToShow:
        "Phone message thread, me typing then closing app",
      howToFilm:
        "Single static shot, framed on the message. Let the action play in one take — no cuts inside the beat. Keep your face deadpan and let the silence land.",
      caption: "no comment on the message.",
      anchor: "message",
      comedyFamily: "task_avoidance",
      emotionalSpike: "quiet_guilt",
      setting: "couch",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_037",
      hook: "Dating app match replied and I left them on read",
      whatToShow:
        "App match reply notification, me closing phone dramatically",
      howToFilm:
        "Single static shot, framed on the match. Let the action play in one take — no cuts inside the beat. Lean slightly theatrical on the final beat; treat it like breaking news.",
      caption: "the match knows.",
      anchor: "match",
      comedyFamily: "texting_overthinking",
      emotionalSpike: "quiet_guilt",
      setting: "couch",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_038",
      hook: "The typing dots disappeared and took my confidence with them",
      whatToShow:
        "Phone typing dots vanish, creator slowly lowers phone onto chest like receiving news",
      howToFilm:
        "Single static shot, framed on the chest. Let the action play in one take — no cuts inside the beat. Hold one beat too long after the punchline; small and reflective.",
      caption: "the chest caught me.",
      anchor: "chest",
      comedyFamily: "texting_overthinking",
      emotionalSpike: "quiet_defeat",
      setting: "bedroom",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_039",
      hook: "I replied “lol” to a serious text",
      whatToShow:
        "Phone serious message, “lol” typed, send, immediate regret face",
      howToFilm:
        "Single static shot, framed on the serious. Let the action play in one take — no cuts inside the beat. Talk like you are confessing to a friend; loose and a little frantic.",
      caption: "the serious knows.",
      anchor: "serious",
      comedyFamily: "texting_overthinking",
      emotionalSpike: "instant_regret",
      setting: "desk",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_040",
      hook: "Calendar says deep work while my thumb is on autopilot",
      whatToShow:
        "Laptop calendar block labeled “deep work,” phone scrolls beside it without the creator looking proud",
      howToFilm:
        "Single static shot, framed on the calendar. Let the action play in one take — no cuts inside the beat. Keep your face deadpan and let the silence land.",
      caption: "the calendar knows.",
      anchor: "calendar",
      comedyFamily: "self_improvement_attempt",
      emotionalSpike: "quiet_guilt",
      setting: "desk",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_041",
      hook: "This to-do item has survived three versions of me",
      whatToShow:
        "Notebook or app list, finger points to one old task, cut to different pens/colors around it",
      howToFilm:
        "Single static shot, framed on the task. Let the action play in one take — no cuts inside the beat. Hold one beat too long after the punchline; small and reflective.",
      caption: "task update: not great.",
      anchor: "task",
      comedyFamily: "task_avoidance",
      emotionalSpike: "quiet_defeat",
      setting: "desk",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_042",
      hook: "Pomodoro timer just rang and I ignored it",
      whatToShow:
        "Phone timer alarm, me continuing to scroll instead",
      howToFilm:
        "Single static shot, framed on the timer. Let the action play in one take — no cuts inside the beat. Lean slightly theatrical on the final beat; treat it like breaking news.",
      caption: "timer? never met them.",
      anchor: "timer",
      comedyFamily: "self_improvement_attempt",
      emotionalSpike: "avoidance_spike",
      setting: "desk",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_043",
      hook: "Productivity app opened and my soul logged out",
      whatToShow:
        "Laptop productivity page loads, creator stares, closes tab, and immediately opens a blank browser tab",
      howToFilm:
        "Single static shot, framed on the productivity. Let the action play in one take — no cuts inside the beat. Talk like you are confessing to a friend; loose and a little frantic.",
      caption: "productivity situation, ongoing.",
      anchor: "productivity",
      comedyFamily: "task_avoidance",
      emotionalSpike: "social_panic",
      setting: "desk",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_044",
      hook: "Work-from-home outfit is still pajamas at 3pm",
      whatToShow:
        "Mirror shot of pajama pants and hoodie, clock shows 3pm",
      howToFilm:
        "Single static shot, framed on the mirror. Let the action play in one take — no cuts inside the beat. Keep your face deadpan and let the silence land.",
      caption: "mirror update: not great.",
      anchor: "mirror",
      comedyFamily: "self_improvement_attempt",
      emotionalSpike: "quiet_defeat",
      setting: "bathroom",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_045",
      hook: "Slack “away” status I never turned off",
      whatToShow:
        "Laptop Slack status still “away,” me actually working",
      howToFilm:
        "Single static shot, framed on the slack. Let the action play in one take — no cuts inside the beat. Hold one beat too long after the punchline; small and reflective.",
      caption: "slack? never met them.",
      anchor: "slack",
      comedyFamily: "self_improvement_attempt",
      emotionalSpike: "false_productivity",
      setting: "desk",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_046",
      hook: "My focus playlist is just lo-fi and snacks",
      whatToShow:
        "Laptop music app open, hand grabs chips",
      howToFilm:
        "Single static shot, framed on the laptop. Let the action play in one take — no cuts inside the beat. Lean slightly theatrical on the final beat; treat it like breaking news.",
      caption: "laptop? never met them.",
      anchor: "laptop",
      comedyFamily: "self_betrayal",
      emotionalSpike: "false_productivity",
      setting: "desk",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_047",
      hook: "I accepted the calendar invite before my personality loaded",
      whatToShow:
        "Phone calendar invite accepted, creator freezes, then checks the time like it changed",
      howToFilm:
        "Single static shot, framed on the calendar. Let the action play in one take — no cuts inside the beat. Talk like you are confessing to a friend; loose and a little frantic.",
      caption: "no comment on the calendar.",
      anchor: "calendar",
      comedyFamily: "task_avoidance",
      emotionalSpike: "instant_regret",
      setting: "couch",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_048",
      hook: "I wrote “email boss” on my list and it’s still there",
      whatToShow:
        "Notebook entry “email boss,” crossed nothing out",
      howToFilm:
        "Single static shot, framed on the email. Let the action play in one take — no cuts inside the beat. Keep your face deadpan and let the silence land.",
      caption: "email update: not great.",
      anchor: "email",
      comedyFamily: "self_improvement_attempt",
      emotionalSpike: "quiet_defeat",
      setting: "desk",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_049",
      hook: "Standing desk became a very expensive shelf",
      whatToShow:
        "Standing desk covered with mugs, mail, headphones; creator works from chair beside it",
      howToFilm:
        "Single static shot, framed on the standing. Let the action play in one take — no cuts inside the beat. Hold one beat too long after the punchline; small and reflective.",
      caption: "standing update: not great.",
      anchor: "standing",
      comedyFamily: "self_improvement_attempt",
      emotionalSpike: "quiet_defeat",
      setting: "desk",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_050",
      hook: "My daily planner is now a snack log",
      whatToShow:
        "Planner page with crossed tasks replaced by snack doodles",
      howToFilm:
        "Single static shot, framed on the planner. Let the action play in one take — no cuts inside the beat. Lean slightly theatrical on the final beat; treat it like breaking news.",
      caption: "planner update: not great.",
      anchor: "planner",
      comedyFamily: "self_improvement_attempt",
      emotionalSpike: "quiet_defeat",
      setting: "desk",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_051",
      hook: "“Urgent” flag still on email from last month",
      whatToShow:
        "Email inbox with old urgent flag, me sipping coffee",
      howToFilm:
        "Single static shot, framed on the urgent. Let the action play in one take — no cuts inside the beat. Keep your face deadpan and let the silence land.",
      caption: "urgent update: not great.",
      anchor: "urgent",
      comedyFamily: "task_avoidance",
      emotionalSpike: "quiet_defeat",
      setting: "desk",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_052",
      hook: "I blocked my own calendar for “me time” and filled it",
      whatToShow:
        "Calendar block labeled “me time,” then new meeting added",
      howToFilm:
        "Single static shot, framed on the time. Let the action play in one take — no cuts inside the beat. Talk like you are confessing to a friend; loose and a little frantic.",
      caption: "time update: not great.",
      anchor: "time",
      comedyFamily: "task_avoidance",
      emotionalSpike: "quiet_defeat",
      setting: "desk",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_053",
      hook: "My task streak broke and I felt free too quickly",
      whatToShow:
        "App streak reset screen, creator looks disappointed for one second, then visibly relieved",
      howToFilm:
        "Single static shot, framed on the streak. Let the action play in one take — no cuts inside the beat. Hold one beat too long after the punchline; small and reflective.",
      caption: "streak update: not great.",
      anchor: "streak",
      comedyFamily: "self_improvement_attempt",
      emotionalSpike: "quiet_defeat",
      setting: "desk",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_054",
      hook: "Roommate left one dish and I’m writing the constitution",
      whatToShow:
        "Sink with single plate, me dramatically gesturing with dish soap",
      howToFilm:
        "Single static shot, framed on the single. Let the action play in one take — no cuts inside the beat. Lean slightly theatrical on the final beat; treat it like breaking news.",
      caption: "single won.",
      anchor: "single",
      comedyFamily: "tiny_public_private_awkwardness",
      emotionalSpike: "polite_rage",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_055",
      hook: "Laundry basket has been “almost done” for six days",
      whatToShow:
        "Laundry basket in hallway, hand touches it then walks away",
      howToFilm:
        "Single static shot, framed on the laundry. Let the action play in one take — no cuts inside the beat. Keep your face deadpan and let the silence land.",
      caption: "the laundry knows.",
      anchor: "laundry",
      comedyFamily: "tiny_humiliation",
      emotionalSpike: "quiet_guilt",
      setting: "hallway",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_056",
      hook: "Fridge note from roommate is now a passive-aggressive novel",
      whatToShow:
        "Fridge sticky note with long handwriting, me reading aloud silently",
      howToFilm:
        "Single static shot, framed on the fridge. Let the action play in one take — no cuts inside the beat. Hold one beat too long after the punchline; small and reflective.",
      caption: "fridge won.",
      anchor: "fridge",
      comedyFamily: "tiny_public_private_awkwardness",
      emotionalSpike: "polite_rage",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_057",
      hook: "Shared bathroom counter has my stuff and zero of theirs",
      whatToShow:
        "Bathroom counter with my products dominating, shrug",
      howToFilm:
        "Single static shot, framed on the bathroom. Let the action play in one take — no cuts inside the beat. Talk like you are confessing to a friend; loose and a little frantic.",
      caption: "the bathroom knows.",
      anchor: "bathroom",
      comedyFamily: "tiny_public_private_awkwardness",
      emotionalSpike: "self_critique",
      setting: "bathroom",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_058",
      hook: "I folded one towel and called it “laundry day”",
      whatToShow:
        "Single folded towel on bed, rest of pile untouched",
      howToFilm:
        "Single static shot, framed on the folded. Let the action play in one take — no cuts inside the beat. Lean slightly theatrical on the final beat; treat it like breaking news.",
      caption: "folded? never met them.",
      anchor: "folded",
      comedyFamily: "self_improvement_attempt",
      emotionalSpike: "false_productivity",
      setting: "bedroom",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_059",
      hook: "Trash can full and I’m still adding one more thing",
      whatToShow:
        "Overflowing trash can, hand pushes one last item in",
      howToFilm:
        "Single static shot, framed on the trash. Let the action play in one take — no cuts inside the beat. Keep your face deadpan and let the silence land.",
      caption: "trash? never met them.",
      anchor: "trash",
      comedyFamily: "tiny_humiliation",
      emotionalSpike: "avoidance_spike",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_060",
      hook: "My side of the couch has permanent snack crumbs",
      whatToShow:
        "Couch cushion close-up with crumbs, hand brushes half-heartedly",
      howToFilm:
        "Single static shot, framed on the couch. Let the action play in one take — no cuts inside the beat. Hold one beat too long after the punchline; small and reflective.",
      caption: "couch update: not great.",
      anchor: "couch",
      comedyFamily: "self_betrayal",
      emotionalSpike: "quiet_defeat",
      setting: "couch",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_061",
      hook: "Roommate schedule says they’re home and they’re not",
      whatToShow:
        "Shared calendar on phone, empty apartment pan",
      howToFilm:
        "Single static shot, framed on the shared. Let the action play in one take — no cuts inside the beat. Talk like you are confessing to a friend; loose and a little frantic.",
      caption: "shared math.",
      anchor: "shared",
      comedyFamily: "tiny_public_private_awkwardness",
      emotionalSpike: "confused_pause",
      setting: "living_room",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_062",
      hook: "I used their mug and immediately washed it",
      whatToShow:
        "Mug taken from cabinet, used, washed dramatically",
      howToFilm:
        "Single static shot, framed on the used. Let the action play in one take — no cuts inside the beat. Lean slightly theatrical on the final beat; treat it like breaking news.",
      caption: "used situation, ongoing.",
      anchor: "used",
      comedyFamily: "tiny_public_private_awkwardness",
      emotionalSpike: "social_panic",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_063",
      hook: "Vacuum line still visible from last month",
      whatToShow:
        "Carpet with faint vacuum line, foot steps on it",
      howToFilm:
        "Single static shot, framed on the vacuum. Let the action play in one take — no cuts inside the beat. Keep your face deadpan and let the silence land.",
      caption: "vacuum update: not great.",
      anchor: "vacuum",
      comedyFamily: "tiny_humiliation",
      emotionalSpike: "quiet_defeat",
      setting: "hallway",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_064",
      hook: "Shared grocery list has only my snacks now",
      whatToShow:
        "Fridge list with crossed healthy items, snacks added",
      howToFilm:
        "Single static shot, framed on the list. Let the action play in one take — no cuts inside the beat. Hold one beat too long after the punchline; small and reflective.",
      caption: "the list knows.",
      anchor: "list",
      comedyFamily: "tiny_public_private_awkwardness",
      emotionalSpike: "quiet_guilt",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_065",
      hook: "I took the last paper towel and didn’t replace it",
      whatToShow:
        "Empty paper towel roll, guilty face",
      howToFilm:
        "Single static shot, framed on the roll. Let the action play in one take — no cuts inside the beat. Talk like you are confessing to a friend; loose and a little frantic.",
      caption: "the roll knows.",
      anchor: "roll",
      comedyFamily: "tiny_humiliation",
      emotionalSpike: "quiet_guilt",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_066",
      hook: "Drafts folder is where my confidence goes to cool off",
      whatToShow:
        "Phone drafts scroll, thumb opens one draft, watches it for half a second, exits without posting",
      howToFilm:
        "Single static shot, framed on the phone. Let the action play in one take — no cuts inside the beat. Keep your face deadpan and let the silence land.",
      caption: "me vs the phone: phone won.",
      anchor: "phone",
      comedyFamily: "posting_anxiety",
      emotionalSpike: "quiet_defeat",
      setting: "desk",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_067",
      hook: "Algorithm showed me my old post like it found evidence",
      whatToShow:
        "Phone feed surfaces an old post, creator immediately lowers brightness and looks away",
      howToFilm:
        "Single static shot, framed on the post. Let the action play in one take — no cuts inside the beat. Lean slightly theatrical on the final beat; treat it like breaking news.",
      caption: "the post caught me.",
      anchor: "post",
      comedyFamily: "creator_anxiety",
      emotionalSpike: "private_embarrassment",
      setting: "couch",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_068",
      hook: "I filmed a 12-second idea for 45 minutes",
      whatToShow:
        "Phone camera open, multiple takes, exhausted face",
      howToFilm:
        "Single static shot, framed on the phone. Let the action play in one take — no cuts inside the beat. Talk like you are confessing to a friend; loose and a little frantic.",
      caption: "phone update: not great.",
      anchor: "phone",
      comedyFamily: "creator_anxiety",
      emotionalSpike: "quiet_defeat",
      setting: "desk",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_069",
      hook: "Caption deleted after 200 likes",
      whatToShow:
        "Post with likes, caption edited to blank",
      howToFilm:
        "Single static shot, framed on the post. Let the action play in one take — no cuts inside the beat. Hold one beat too long after the punchline; small and reflective.",
      caption: "post situation, ongoing.",
      anchor: "post",
      comedyFamily: "posting_anxiety",
      emotionalSpike: "self_doubt_spike",
      setting: "phone",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_070",
      hook: "I found the trend right after it turned into homework",
      whatToShow:
        "Phone trend page, creator opens camera, pauses, closes it because the sound already feels tired",
      howToFilm:
        "Single static shot, framed on the trend. Let the action play in one take — no cuts inside the beat. Keep your face deadpan and let the silence land.",
      caption: "trend update: not great.",
      anchor: "trend",
      comedyFamily: "creator_anxiety",
      emotionalSpike: "quiet_defeat",
      setting: "couch",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_071",
      hook: "This saved video is retired before it ever worked",
      whatToShow:
        "Phone saved folder, creator taps a video thumbnail, shakes head, moves it to another folder",
      howToFilm:
        "Single static shot, framed on the saved. Let the action play in one take — no cuts inside the beat. Hold one beat too long after the punchline; small and reflective.",
      caption: "saved update: not great.",
      anchor: "saved",
      comedyFamily: "creator_anxiety",
      emotionalSpike: "quiet_defeat",
      setting: "desk",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_072",
      hook: "Analytics gave me hope and I punished the app for it",
      whatToShow:
        "Analytics screen flashes a positive metric, creator smiles for half a second, then force-closes the app",
      howToFilm:
        "Single static shot, framed on the analytics. Let the action play in one take — no cuts inside the beat. Lean slightly theatrical on the final beat; treat it like breaking news.",
      caption: "analytics? never met them.",
      anchor: "analytics",
      comedyFamily: "creator_anxiety",
      emotionalSpike: "avoidance_spike",
      setting: "desk",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_073",
      hook: "Story reply I overthought for an hour",
      whatToShow:
        "Story reply bubble typing, deleted, retyped, deleted",
      howToFilm:
        "Single static shot, framed on the story. Let the action play in one take — no cuts inside the beat. Talk like you are confessing to a friend; loose and a little frantic.",
      caption: "story won.",
      anchor: "story",
      comedyFamily: "posting_anxiety",
      emotionalSpike: "impatient_spiral",
      setting: "couch",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_074",
      hook: "I posted at 9:07pm like it was prime time",
      whatToShow:
        "Post timestamp 9:07pm, me checking phone for likes",
      howToFilm:
        "Single static shot, framed on the timestamp. Let the action play in one take — no cuts inside the beat. Keep your face deadpan and let the silence land.",
      caption: "timestamp won.",
      anchor: "timestamp",
      comedyFamily: "creator_anxiety",
      emotionalSpike: "impatient_spiral",
      setting: "couch",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_075",
      hook: "My drafts are now organized by emotional damage",
      whatToShow:
        "Phone folder labels like “maybe,” “absolutely not,” and “why did I film this,” creator scrolls silently",
      howToFilm:
        "Single static shot, framed on the phone. Let the action play in one take — no cuts inside the beat. Hold one beat too long after the punchline; small and reflective.",
      caption: "phone, finally seen.",
      anchor: "phone",
      comedyFamily: "posting_anxiety",
      emotionalSpike: "quiet_realization",
      setting: "phone",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_076",
      hook: "Algorithm recommended a memory I did not authorize",
      whatToShow:
        "Phone feed shows a blurred/staged awkward old post or contact, creator scrolls so fast the phone almost drops",
      howToFilm:
        "Single static shot, framed on the phone. Let the action play in one take — no cuts inside the beat. Lean slightly theatrical on the final beat; treat it like breaking news.",
      caption: "oh — the phone.",
      anchor: "phone",
      comedyFamily: "posting_anxiety",
      emotionalSpike: "caught_off_guard",
      setting: "couch",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_077",
      hook: "I refreshed the feed and the feed refreshed my patience",
      whatToShow:
        "Pull-to-refresh animation, same post returns, creator sets phone down like it lost privileges",
      howToFilm:
        "Single static shot, framed on the refresh. Let the action play in one take — no cuts inside the beat. Talk like you are confessing to a friend; loose and a little frantic.",
      caption: "refresh update: not great.",
      anchor: "refresh",
      comedyFamily: "creator_anxiety",
      emotionalSpike: "quiet_defeat",
      setting: "desk",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_078",
      hook: "Snooze button turned morning into a rumor",
      whatToShow:
        "Alarm at 7:00, quick cuts of snooze taps, final clock reads 11:48",
      howToFilm:
        "Single static shot, framed on the alarm. Let the action play in one take — no cuts inside the beat. Keep your face deadpan and let the silence land.",
      caption: "alarm math.",
      anchor: "alarm",
      comedyFamily: "self_improvement_attempt",
      emotionalSpike: "time_loss",
      setting: "bedroom",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_079",
      hook: "Wellness journal entry is just “coffee”",
      whatToShow:
        "Notebook open to “Day 47: coffee” only",
      howToFilm:
        "Single static shot, framed on the coffee. Let the action play in one take — no cuts inside the beat. Hold one beat too long after the punchline; small and reflective.",
      caption: "me vs the coffee: coffee won.",
      anchor: "coffee",
      comedyFamily: "self_improvement_attempt",
      emotionalSpike: "quiet_defeat",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_080",
      hook: "Nighttime skincare routine reduced to face wash",
      whatToShow:
        "Bathroom sink, single face wash pump, done",
      howToFilm:
        "Single static shot, framed on the face. Let the action play in one take — no cuts inside the beat. Lean slightly theatrical on the final beat; treat it like breaking news.",
      caption: "face update: not great.",
      anchor: "face",
      comedyFamily: "self_improvement_attempt",
      emotionalSpike: "quiet_defeat",
      setting: "bathroom",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_081",
      hook: "5am me made promises 5:12am me never respected",
      whatToShow:
        "Alarm rings at 5:00, creator sits up heroically, then instantly lies back down at 5:12",
      howToFilm:
        "Single static shot, framed on the rings. Let the action play in one take — no cuts inside the beat. Talk like you are confessing to a friend; loose and a little frantic.",
      caption: "rings update: not great.",
      anchor: "rings",
      comedyFamily: "self_improvement_attempt",
      emotionalSpike: "quiet_defeat",
      setting: "bedroom",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_082",
      hook: "Meditation app streak ended because I checked my phone",
      whatToShow:
        "Meditation timer open, phone notification distracts, streak broken",
      howToFilm:
        "Single static shot, framed on the meditation. Let the action play in one take — no cuts inside the beat. Keep your face deadpan and let the silence land.",
      caption: "meditation update: not great.",
      anchor: "meditation",
      comedyFamily: "self_improvement_attempt",
      emotionalSpike: "quiet_defeat",
      setting: "couch",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_083",
      hook: "Wind-down routine became a wrist workout",
      whatToShow:
        "Phone in bed, thumb scrolls endlessly, book or eye mask sits untouched nearby",
      howToFilm:
        "Single static shot, framed on the phone. Let the action play in one take — no cuts inside the beat. Hold one beat too long after the punchline; small and reflective.",
      caption: "no comment on the phone.",
      anchor: "phone",
      comedyFamily: "self_improvement_attempt",
      emotionalSpike: "quiet_guilt",
      setting: "bedroom",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_084",
      hook: "I stretched once and called it yoga",
      whatToShow:
        "Floor stretch, immediate stand up satisfied",
      howToFilm:
        "Single static shot, framed on the floor. Let the action play in one take — no cuts inside the beat. Lean slightly theatrical on the final beat; treat it like breaking news.",
      caption: "floor? never met them.",
      anchor: "floor",
      comedyFamily: "self_improvement_attempt",
      emotionalSpike: "false_productivity",
      setting: "living_room",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_085",
      hook: "Sleep tracker says I slept great and I feel dead",
      whatToShow:
        "Phone sleep data “excellent,” me with tired face",
      howToFilm:
        "Single static shot, framed on the sleep. Let the action play in one take — no cuts inside the beat. Talk like you are confessing to a friend; loose and a little frantic.",
      caption: "the sleep caught me.",
      anchor: "sleep",
      comedyFamily: "self_improvement_attempt",
      emotionalSpike: "exposed_lie",
      setting: "bedroom",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_086",
      hook: "Morning coffee is now my only productivity",
      whatToShow:
        "Coffee mug held like trophy, empty desk behind",
      howToFilm:
        "Single static shot, framed on the held. Let the action play in one take — no cuts inside the beat. Keep your face deadpan and let the silence land.",
      caption: "held update: not great.",
      anchor: "held",
      comedyFamily: "self_improvement_attempt",
      emotionalSpike: "quiet_defeat",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_087",
      hook: "Bedtime reminder arrived like a suggestion box",
      whatToShow:
        "Phone bedtime reminder pops up, creator taps “remind me later” while already under blankets",
      howToFilm:
        "Single static shot, framed on the bedtime. Let the action play in one take — no cuts inside the beat. Hold one beat too long after the punchline; small and reflective.",
      caption: "bedtime? never met them.",
      anchor: "bedtime",
      comedyFamily: "self_improvement_attempt",
      emotionalSpike: "avoidance_spike",
      setting: "bedroom",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_088",
      hook: "Autocorrect changed my tone and left me with the consequences",
      whatToShow:
        "Phone text changes a normal word into something colder/weirder, creator notices after sending and freezes",
      howToFilm:
        "Single static shot, framed on the phone. Let the action play in one take — no cuts inside the beat. Talk like you are confessing to a friend; loose and a little frantic.",
      caption: "phone won.",
      anchor: "phone",
      comedyFamily: "parasocial_object",
      emotionalSpike: "polite_rage",
      setting: "couch",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_089",
      hook: "Charger waited until 3% to reveal its true character",
      whatToShow:
        "Phone at 3%, cord plugs in, battery icon does nothing, creator slowly looks at the cord",
      howToFilm:
        "Single static shot, framed on the phone. Let the action play in one take — no cuts inside the beat. Lean slightly theatrical on the final beat; treat it like breaking news.",
      caption: "phone alarm in my chest.",
      anchor: "phone",
      comedyFamily: "parasocial_object",
      emotionalSpike: "panic",
      setting: "desk",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_090",
      hook: "Earbuds fell in the exact spot I can’t reach",
      whatToShow:
        "Earbud drops between couch cushions, hand fishes unsuccessfully",
      howToFilm:
        "Single static shot, framed on the earbud. Let the action play in one take — no cuts inside the beat. Keep your face deadpan and let the silence land.",
      caption: "earbud update: not great.",
      anchor: "earbud",
      comedyFamily: "tiny_humiliation",
      emotionalSpike: "quiet_defeat",
      setting: "couch",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_091",
      hook: "Remote died during the one scene I was emotionally available for",
      whatToShow:
        "TV paused, remote click fails, creator stares at remote like it betrayed the plot",
      howToFilm:
        "Single static shot, framed on the remote. Let the action play in one take — no cuts inside the beat. Hold one beat too long after the punchline; small and reflective.",
      caption: "remote won.",
      anchor: "remote",
      comedyFamily: "parasocial_object",
      emotionalSpike: "polite_rage",
      setting: "couch",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_092",
      hook: "Mouse stopped working and I accused the whole laptop",
      whatToShow:
        "Mouse click fails, creator taps keyboard, shakes mouse, then notices mouse power switch",
      howToFilm:
        "Single static shot, framed on the mouse. Let the action play in one take — no cuts inside the beat. Talk like you are confessing to a friend; loose and a little frantic.",
      caption: "mouse won.",
      anchor: "mouse",
      comedyFamily: "parasocial_object",
      emotionalSpike: "polite_rage",
      setting: "desk",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_093",
      hook: "Laptop fan started screaming at 2% battery",
      whatToShow:
        "Laptop fan noise, screen at 2%, panicked face",
      howToFilm:
        "Single static shot, framed on the laptop. Let the action play in one take — no cuts inside the beat. Lean slightly theatrical on the final beat; treat it like breaking news.",
      caption: "laptop situation, ongoing.",
      anchor: "laptop",
      comedyFamily: "tiny_humiliation",
      emotionalSpike: "performance_panic",
      setting: "desk",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_094",
      hook: "Headphones tangled themselves overnight",
      whatToShow:
        "Headphones pulled from bag, giant knot",
      howToFilm:
        "Single static shot, framed on the headphones. Let the action play in one take — no cuts inside the beat. Keep your face deadpan and let the silence land.",
      caption: "headphones update: not great.",
      anchor: "headphones",
      comedyFamily: "parasocial_object",
      emotionalSpike: "quiet_defeat",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_095",
      hook: "Water bottle lid popped off in my bag",
      whatToShow:
        "Bag opened, water spill visible, defeated sigh",
      howToFilm:
        "Single static shot, framed on the water. Let the action play in one take — no cuts inside the beat. Hold one beat too long after the punchline; small and reflective.",
      caption: "water update: not great.",
      anchor: "water",
      comedyFamily: "parasocial_object",
      emotionalSpike: "quiet_defeat",
      setting: "hallway",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_096",
      hook: "I bought a plant and it’s already yellow",
      whatToShow:
        "Windowsill plant turning yellow, me watering anyway",
      howToFilm:
        "Single static shot, framed on the plant. Let the action play in one take — no cuts inside the beat. Hold one beat too long after the punchline; small and reflective.",
      caption: "the plant knows.",
      anchor: "plant",
      comedyFamily: "tiny_humiliation",
      emotionalSpike: "quiet_guilt",
      setting: "home",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_097",
      hook: "My keys were in my hand the whole search",
      whatToShow:
        "Hand holding keys while other hand searches pockets",
      howToFilm:
        "Single static shot, framed on the keys. Let the action play in one take — no cuts inside the beat. Talk like you are confessing to a friend; loose and a little frantic.",
      caption: "keys math.",
      anchor: "keys",
      comedyFamily: "tiny_humiliation",
      emotionalSpike: "quiet_realization",
      setting: "hallway",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_098",
      hook: "Reminder popped up and watched me choose chaos",
      whatToShow:
        "Phone reminder appears, creator reads it, nods seriously, dismisses it, and keeps doing the opposite",
      howToFilm:
        "Single static shot, framed on the reminder. Let the action play in one take — no cuts inside the beat. Keep your face deadpan and let the silence land.",
      caption: "reminder update: not great.",
      anchor: "reminder",
      comedyFamily: "task_avoidance",
      emotionalSpike: "quiet_defeat",
      setting: "desk",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_099",
      hook: "Laundry returned every sock except the one with accountability",
      whatToShow:
        "Laundry basket dump, creator holds two obviously wrong socks together and accepts it",
      howToFilm:
        "Single static shot, framed on the laundry. Let the action play in one take — no cuts inside the beat. Lean slightly theatrical on the final beat; treat it like breaking news.",
      caption: "laundry math.",
      anchor: "laundry",
      comedyFamily: "tiny_humiliation",
      emotionalSpike: "confused_pause",
      setting: "home",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
  {
      id: "w2_next_100",
      hook: "I cleaned one surface and immediately gave it a sequel",
      whatToShow:
        "Clear counter, one item placed down, then another, then the counter is back to chaos",
      howToFilm:
        "Single static shot, framed on the clear. Let the action play in one take — no cuts inside the beat. Hold one beat too long after the punchline; small and reflective.",
      caption: "clear update: not great.",
      anchor: "clear",
      comedyFamily: "tiny_humiliation",
      emotionalSpike: "quiet_defeat",
      setting: "kitchen",
      reviewedBy: PENDING_EDITORIAL_REVIEW,
    },
    ]);
  