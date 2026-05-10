// PHASE N1-CLEAN-CORE-INFRA — infrastructure-only shell for the
// Nigerian clean-English `core_native` mini-catalog.
//
// Activation:
//   region        === "nigeria"
//   languageStyle === "clean"
//
// Mutually exclusive with the existing approved Nigerian pack
// (`nigerianHookPackApproved.ts`), which is gated on
// `languageStyle ∈ {"pidgin", "light_pidgin"}`. Nothing in this
// module touches that pack, its author, its slot reservation, its
// per-creator memory column, the rewrite YAML, or the reviewer
// worksheet. Western / India / Philippines are excluded by region.
// `null` / `undefined` languageStyle is excluded — that surface
// remains the safety domain of `nigerianCleanCoreGuard.ts`.
//
// This file ships with `NIGERIAN_CLEAN_CORE_ENTRIES = []`. The 30
// clean-English Nigerian entries will be hand-authored separately
// and provided as an exact apply packet. Until then the wiring
// branch in `coreCandidateGenerator.ts` is inert (length-gated).
//
// No DB column, no migration, no codegen, no creative production
// copy authored here. Validators below exist only to protect the
// future hand-authored entries when they arrive.

import type { LanguageStyle } from "./tasteCalibration.js";
import { isNigerianCleanCoreHookBlocked } from "./nigerianCleanCoreGuard.js";

// Region is a string union in `@workspace/lumina-trends`; importing
// the type would widen the import surface unnecessarily. Match the
// pattern used by `nigerianCleanCoreGuard.ts` and accept any string.

// ---------------------------------------------------------------- //
// Types                                                             //
// ---------------------------------------------------------------- //

export type NigerianCleanCoreEntry = {
  readonly id: string;
  readonly draftId: string;
  readonly anchor: string;
  readonly hook: string;
  readonly whatToShow: string;
  readonly howToFilm: string;
  readonly caption: string;
  readonly premiseFamily: string;
  readonly voiceTone: string;
  readonly reviewedBy: string;
};

// ---------------------------------------------------------------- //
// Production catalog — N1-CLEAN-CORE-P1 (BI-CLEAN 2026-05-09)        //
// ---------------------------------------------------------------- //
//
// 30 hand-authored Nigerian clean-English `core_native` entries.
// All entries reviewed by `BI-CLEAN 2026-05-09`. Applied byte-for-
// byte from the user-supplied curator packet. NEVER paraphrase,
// rewrite, or auto-replace these strings — any future
// modification requires a new explicit reviewer stamp.

export const NIGERIAN_CLEAN_CORE_ENTRIES: readonly NigerianCleanCoreEntry[] =
  Object.freeze([
    {
      id: "ng_clean_001",
      draftId: "CLEAN-DRAFT-001",
      anchor: "light",
      hook: "The light came back and exposed everyone\u2019s fake patience.",
      whatToShow:
        "Show a quiet room where everyone is pretending to be calm, then the light returns and three people rush for chargers at once, ending with one person guarding the only free socket like property.",
      howToFilm:
        "Start on the dark room with phones at low battery, cut to the light returning, then follow the scramble toward the sockets and end on the person blocking the extension box with their slippers.",
      caption: "Peace ended at 2%.",
      premiseFamily: "power_light",
      voiceTone: "dry_clean_observation",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_002",
      draftId: "CLEAN-DRAFT-002",
      anchor: "generator",
      hook: "The generator stopped and the house started hearing secrets.",
      whatToShow:
        "Show the generator noise covering everyone\u2019s activities, then the generator goes off and tiny sounds become loud, ending with someone\u2019s chewing becoming the main event.",
      howToFilm:
        "Capture the fan spinning, the TV playing, and someone snacking, then cut the generator sound suddenly and show everyone slowly turning toward the loudest small noise.",
      caption: "Silence has witnesses.",
      premiseFamily: "power_light",
      voiceTone: "quiet_realization_clean",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_003",
      draftId: "CLEAN-DRAFT-003",
      anchor: "inverter",
      hook: "The inverter beeped once and my confidence packed out.",
      whatToShow:
        "Show someone enjoying backup power like a rich person, then the inverter warning beep starts, and the payoff is them switching off everything except the phone charger.",
      howToFilm:
        "Begin with the fan, TV, and charger running together, add the inverter warning beep, then show fast hands turning off appliances until only one charging phone remains like a national project.",
      caption: "Luxury has battery percentage.",
      premiseFamily: "power_light",
      voiceTone: "clean_deadpan",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_004",
      draftId: "CLEAN-DRAFT-004",
      anchor: "bus",
      hook: "The bus conductor announced my stop like breaking news.",
      whatToShow:
        "Show a passenger relaxing in the bus, then the conductor shouts the bus stop with terrifying urgency, and the payoff is the passenger grabbing their bag like they just remembered their entire life.",
      howToFilm:
        "Film from the passenger seat with a bag on your lap, show the bus slowing and the conductor\u2019s hand tapping the doorframe, then cut to the passenger checking pockets, bag zip, and slippers in panic.",
      caption: "My stop attacked me.",
      premiseFamily: "transport",
      voiceTone: "clean_overdramatic",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_005",
      draftId: "CLEAN-DRAFT-005",
      anchor: "traffic",
      hook: "One traffic update turned my plan into a prayer point.",
      whatToShow:
        "Show someone dressed and ready to leave on time, then a traffic update arrives, and the payoff is them slowly removing their watch like punctuality has resigned.",
      howToFilm:
        "Start with shoes, keys, and a confident time check, show the traffic update on the phone, then cut to the person sitting back down and calculating three impossible routes on their fingers.",
      caption: "The road had other plans.",
      premiseFamily: "transport",
      voiceTone: "dry_clean_observation",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_006",
      draftId: "CLEAN-DRAFT-006",
      anchor: "keke",
      hook: "The keke driver said shortcut and entered character development.",
      whatToShow:
        "Show a passenger agreeing to a shortcut, then the keke turns into a narrow rough street, and the payoff is the passenger holding the seat frame like they signed a survival contract.",
      howToFilm:
        "Film the passenger nodding confidently, show the keke turning away from the main road, then capture bouncing feet, gripping fingers, and a final relieved step onto solid ground.",
      caption: "Shortcut humbled all of us.",
      premiseFamily: "transport",
      voiceTone: "clean_absurd_escalation",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_007",
      draftId: "CLEAN-DRAFT-007",
      anchor: "pos",
      hook: "The POS terminal waited for my turn before becoming mysterious.",
      whatToShow:
        "Show a smooth line of customers paying with the pos terminal, then your card enters and the machine starts loading forever, ending with everyone behind you becoming financial supervisors.",
      howToFilm:
        "Show two quick successful payments, cut to your card inside the POS terminal, then hold on the loading screen while the people behind you lean closer with increasing concern.",
      caption: "Technology chose me.",
      premiseFamily: "money_pos_bank",
      voiceTone: "clean_deadpan",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_008",
      draftId: "CLEAN-DRAFT-008",
      anchor: "transfer",
      hook: "The transfer receipt arrived before the money developed courage.",
      whatToShow:
        "Show someone proudly displaying a transfer receipt, then the seller keeps checking their own phone, and the payoff is both of them staring at network bars like witnesses in court.",
      howToFilm:
        "Open on the buyer showing the transfer receipt, cut to the seller refreshing their balance, then end with both phones side by side while nobody touches the goods.",
      caption: "Receipt is not arrival.",
      premiseFamily: "money_pos_bank",
      voiceTone: "dry_clean_observation",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_009",
      draftId: "CLEAN-DRAFT-009",
      anchor: "app",
      hook: "The app loaded slowly enough to expose my balance fear.",
      whatToShow:
        "Show someone trying to pay confidently with a bank app, then the app keeps loading, and the payoff is their smile reducing one bar at a time.",
      howToFilm:
        "Frame the app loading on the phone, cut between the waiting seller and the payer\u2019s shrinking smile, then finish on the payer pretending to check network settings.",
      caption: "Loading screen, character test.",
      premiseFamily: "money_pos_bank",
      voiceTone: "quiet_realization_clean",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_010",
      draftId: "CLEAN-DRAFT-010",
      anchor: "auntie",
      hook: "One auntie asked one question and the table lost sound.",
      whatToShow:
        "Show a family table with normal conversation, then one auntie asks a personal question, and the payoff is everyone suddenly becoming interested in their plate.",
      howToFilm:
        "Start with hands serving food and casual smiles, cut to the auntie leaning in with a calm question, then show three people looking down, sipping water, and adjusting chairs for no reason.",
      caption: "The spoon saved nobody.",
      premiseFamily: "family_aunties",
      voiceTone: "clean_social_comedy",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_011",
      draftId: "CLEAN-DRAFT-011",
      anchor: "uncle",
      hook: "The uncle who came late still gave the longest advice.",
      whatToShow:
        "Show the family event almost ending, then one uncle arrives late and starts advising everyone, ending with the tired children aging in real time.",
      howToFilm:
        "Capture empty plates and people packing up, show the uncle entering with fresh energy, then cut to seated relatives slowly losing posture while he counts advice points on his fingers.",
      caption: "Late arrival, full lecture.",
      premiseFamily: "family_aunties",
      voiceTone: "dry_clean_observation",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_012",
      draftId: "CLEAN-DRAFT-012",
      anchor: "cousin",
      hook: "My cousin greeted everyone and went straight to the fridge.",
      whatToShow:
        "Show a cousin entering politely, greeting the room, then drifting to the fridge with official seriousness, ending with them judging one lonely container like evidence.",
      howToFilm:
        "Film the greeting at the door, follow the cousin\u2019s eyes moving toward the fridge, then show the fridge opening and a slow inspection of each shelf before the final disappointed nod.",
      caption: "Family visit or audit?",
      premiseFamily: "family_aunties",
      voiceTone: "clean_deadpan",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_013",
      draftId: "CLEAN-DRAFT-013",
      anchor: "chat",
      hook: "The chat said quick question and formed a committee.",
      whatToShow:
        "Show one innocent chat message asking a quick question, then replies multiply into voice notes, polls, and side arguments, ending with the original question still unanswered.",
      howToFilm:
        "Screen-record the chat starting with one short message, then show fast cuts of notification bubbles, typing indicators, and a poll appearing before ending on the unanswered first question.",
      caption: "Quick became quarterly.",
      premiseFamily: "group_chats",
      voiceTone: "clean_absurd_escalation",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_014",
      draftId: "CLEAN-DRAFT-014",
      anchor: "admin",
      hook: "The admin pinned rules and became the first suspect.",
      whatToShow:
        "Show a group admin posting strict rules, then the same admin sends a long unrelated message, and the payoff is everyone silently screenshotting the evidence.",
      howToFilm:
        "Record the pinned admin rules at the top of the group, scroll to the unrelated announcement, then cut to fingers taking screenshots like a quiet investigation has opened.",
      caption: "Leadership is flexible.",
      premiseFamily: "group_chats",
      voiceTone: "clean_deadpan",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_015",
      draftId: "CLEAN-DRAFT-015",
      anchor: "voice",
      hook: "The voice note was seven minutes and opened with greetings.",
      whatToShow:
        "Show someone pressing play on a voice note expecting one update, then the timer reveals seven minutes, ending with them placing the phone down like a radio program has started.",
      howToFilm:
        "Frame the phone as the voice note starts, show the long duration, then show the listener washing a cup, sitting down, and returning while the message is still playing.",
      caption: "This is now a podcast.",
      premiseFamily: "group_chats",
      voiceTone: "dry_clean_observation",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_016",
      draftId: "CLEAN-DRAFT-016",
      anchor: "tomatoes",
      hook: "The tomatoes price changed my entire stew vision.",
      whatToShow:
        "Show someone entering the market with a confident stew plan, then they hear the tomatoes price, and the payoff is them downgrading the menu with painful maturity.",
      howToFilm:
        "Begin with a shopping list and cash in hand, cut to the tomatoes being weighed, then show the buyer quietly crossing out ingredients and choosing a smaller bowl.",
      caption: "The stew adjusted itself.",
      premiseFamily: "market_food",
      voiceTone: "quiet_realization_clean",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_017",
      draftId: "CLEAN-DRAFT-017",
      anchor: "pepper",
      hook: "The pepper seller added one extra and became family.",
      whatToShow:
        "Show a buyer bargaining seriously for pepper, then the seller adds one tiny extra piece, and the payoff is the buyer walking away like they received customer appreciation from heaven.",
      howToFilm:
        "Film the pepper being counted into a small bag, capture the seller dropping in one extra piece, then show the buyer holding the bag with dramatic gratitude on the walk home.",
      caption: "Customer care entered my bag.",
      premiseFamily: "market_food",
      voiceTone: "clean_overdramatic",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_018",
      draftId: "CLEAN-DRAFT-018",
      anchor: "meat",
      hook: "The meat disappeared in the pot like it had appointments.",
      whatToShow:
        "Show someone adding visible pieces of meat to a pot, then later serving food and searching for them, ending with one tiny piece appearing like a rumor.",
      howToFilm:
        "Record the meat entering the pot clearly, cut to serving time with a spoon searching through the stew, then reveal one small piece sitting alone at the edge of the plate.",
      caption: "Protein played hide and seek.",
      premiseFamily: "market_food",
      voiceTone: "clean_absurd_escalation",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_019",
      draftId: "CLEAN-DRAFT-019",
      anchor: "tailor",
      hook: "The tailor said tomorrow with government-level confidence.",
      whatToShow:
        "Show someone bringing fabric early, then the tailor promises tomorrow, and the payoff is the outfit still being chalk lines on event morning.",
      howToFilm:
        "Open on fresh fabric and measuring tape, cut to the tailor nodding confidently, then jump to event morning with the unfinished outfit on the table and the customer holding matching shoes in disbelief.",
      caption: "Tomorrow has layers.",
      premiseFamily: "tailoring_events",
      voiceTone: "dry_clean_observation",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_020",
      draftId: "CLEAN-DRAFT-020",
      anchor: "asoebi",
      hook: "The asoebi price entered and my joy logged out.",
      whatToShow:
        "Show someone excited for an event, then the asoebi price drops in the group, and the payoff is them calculating attendance without fabric.",
      howToFilm:
        "Show the invitation message and excited outfit planning, cut to the asoebi price on the phone, then film the person closing the wardrobe and quietly choosing a neutral outfit.",
      caption: "Celebration came with invoice.",
      premiseFamily: "tailoring_events",
      voiceTone: "clean_deadpan",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_021",
      draftId: "CLEAN-DRAFT-021",
      anchor: "gele",
      hook: "The gele looked simple until it requested engineering.",
      whatToShow:
        "Show someone placing gele fabric on their head confidently, then folds keep growing in strange directions, ending with the final shape blocking one eyebrow and all confidence.",
      howToFilm:
        "Start with the gele spread neatly, show hands folding and refolding from different angles, then end on the wearer checking the final height beside a doorway before deciding whether to pass.",
      caption: "Architecture, but make it headwear.",
      premiseFamily: "tailoring_events",
      voiceTone: "clean_absurd_escalation",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_022",
      draftId: "CLEAN-DRAFT-022",
      anchor: "lecturer",
      hook: "The lecturer said brief test and brought extra pages.",
      whatToShow:
        "Show students relaxing because the lecturer called it brief, then the question paper arrives with serious pages, and the payoff is everyone turning pages like legal documents.",
      howToFilm:
        "Film notebooks closing in relief, cut to the lecturer\u2019s test papers landing on desks, then show students flipping page after page while one person checks the front page for mercy.",
      caption: "Brief where?",
      premiseFamily: "school_work",
      voiceTone: "clean_overdramatic",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_023",
      draftId: "CLEAN-DRAFT-023",
      anchor: "meeting",
      hook: "The meeting ended, then someone said just one thing.",
      whatToShow:
        "Show workers packing up after a meeting, then one person says just one thing, and the payoff is everyone slowly reopening laptops like prisoners returning.",
      howToFilm:
        "Capture chairs moving and notebooks closing, cut to the meeting voice raising one finger, then show laptops opening again and one worker quietly removing their bag from their shoulder.",
      caption: "Freedom postponed.",
      premiseFamily: "school_work",
      voiceTone: "dry_clean_observation",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_024",
      draftId: "CLEAN-DRAFT-024",
      anchor: "attendance",
      hook: "The attendance sheet arrived after my spirit had left class.",
      whatToShow:
        "Show a tired student preparing to sneak out, then the attendance sheet starts moving row by row, and the payoff is the student sitting back down with sudden academic commitment.",
      howToFilm:
        "Begin with the student sliding books into a bag, show the attendance sheet being passed from the front row, then capture the student unpacking everything again with a serious face.",
      caption: "Education found me.",
      premiseFamily: "school_work",
      voiceTone: "clean_deadpan",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_025",
      draftId: "CLEAN-DRAFT-025",
      anchor: "data",
      hook: "My data finished faster than the video introduction.",
      whatToShow:
        "Show someone opening a short video with confidence, then the data warning appears before the actual point begins, ending with them staring at the paused screen like betrayal.",
      howToFilm:
        "Show the thumb pressing play, cut to the video intro still running, then reveal the data warning notification and freeze on the viewer\u2019s face as they lower the phone.",
      caption: "The intro ate everything.",
      premiseFamily: "phone_data",
      voiceTone: "quiet_realization_clean",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_026",
      draftId: "CLEAN-DRAFT-026",
      anchor: "charger",
      hook: "The charger worked only when I held it like evidence.",
      whatToShow:
        "Show a phone refusing to charge normally, then the charger connects only at one strange angle, and the payoff is the owner frozen in place like part of the furniture.",
      howToFilm:
        "Record the battery icon refusing to change, show small charger angle adjustments until charging begins, then hold on the owner trapped beside the socket with one hand suspended carefully.",
      caption: "Charging by negotiation.",
      premiseFamily: "phone_data",
      voiceTone: "clean_absurd_escalation",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_027",
      draftId: "CLEAN-DRAFT-027",
      anchor: "network",
      hook: "The network vanished the moment I needed maturity.",
      whatToShow:
        "Show someone trying to send an important message calmly, then the network bars drop, and the payoff is them lifting the phone around the room like a small offering.",
      howToFilm:
        "Start with the typed message ready to send, cut to the network bars disappearing, then follow the phone moving near the window, above the head, and beside the door before the message fails.",
      caption: "Signal respects nobody.",
      premiseFamily: "phone_data",
      voiceTone: "clean_deadpan",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_028",
      draftId: "CLEAN-DRAFT-028",
      anchor: "draft",
      hook: "The draft looked funny until family entered the room.",
      whatToShow:
        "Show a creator laughing while editing a draft alone, then family members enter the room, and the payoff is the creator suddenly reducing the volume and questioning their entire brand.",
      howToFilm:
        "Show the creator replaying the draft and smiling, cut to footsteps or relatives entering the space, then capture the creator lowering volume, closing the preview, and pretending to check emails.",
      caption: "Comedy needs privacy.",
      premiseFamily: "creator_social_behavior",
      voiceTone: "quiet_realization_clean",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_029",
      draftId: "CLEAN-DRAFT-029",
      anchor: "caption",
      hook: "The caption took longer than the whole video.",
      whatToShow:
        "Show a creator finishing a simple video quickly, then spending forever rewriting the caption, ending with them posting the shortest version after all that suffering.",
      howToFilm:
        "Record the final edit exporting, then show the caption options filling a notes app with crossed-out lines and emoji trials before the creator deletes everything and types three words.",
      caption: "Creative process suffered.",
      premiseFamily: "creator_social_behavior",
      voiceTone: "dry_clean_observation",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_030",
      draftId: "CLEAN-DRAFT-030",
      anchor: "views",
      hook: "The views moved once and I became a data analyst.",
      whatToShow:
        "Show a creator checking views casually, then the views increase by one, and the payoff is them opening analytics like a serious board meeting has started.",
      howToFilm:
        "Show the creator glancing at the views, cut to the number changing slightly, then capture fast switches between analytics tabs, notes, and a dramatic calculation on paper.",
      caption: "One view changed management.",
      premiseFamily: "creator_social_behavior",
      voiceTone: "clean_deadpan",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_031",
      draftId: "CLEAN-DRAFT-031",
      anchor: "bucket",
      hook: "The bucket judged my morning routine.",
      whatToShow:
        "Show a bucket waiting under a dry tap, you arriving with soap on your face, then freezing when the first drop lands like breaking news.",
      howToFilm:
        "Start on the empty bucket, tilt up to your half-washed face, then cut to your hand celebrating one tiny drop from the tap.",
      caption: "Water has timing issues.",
      premiseFamily: "resource_scramble",
      voiceTone: "dry_observational",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_032",
      draftId: "CLEAN-DRAFT-032",
      anchor: "tank",
      hook: "The tank chose drama at bath time.",
      whatToShow:
        "Show the tank tap coughing, you holding a towel like a serious deadline, then accepting a tiny cup of water as the full plan.",
      howToFilm:
        "Film the tank tap sputtering into a bowl, cut to your towel-and-bucket negotiation, then end on the cup beside your full bathing supplies.",
      caption: "Luxury reduced to cup size.",
      premiseFamily: "utility_betrayal",
      voiceTone: "calm_frustration",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_033",
      draftId: "CLEAN-DRAFT-033",
      anchor: "fan",
      hook: "The fan slowed down and exposed the heat.",
      whatToShow:
        "Show everyone sitting normally while the fan is moving, then the fan slows down and the room suddenly starts negotiating with sweat, ending with one person using paper like a survival tool.",
      howToFilm:
        "Start on the fan spinning above the room, cut to it slowing down, then show quick reactions: collars loosening, paper fanning, and one person staring at the ceiling in betrayal.",
      caption: "Breeze resigned quietly.",
      premiseFamily: "home_competition",
      voiceTone: "deadpan_family",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_034",
      draftId: "CLEAN-DRAFT-034",
      anchor: "pothole",
      hook: "The pothole interviewed my whole body.",
      whatToShow:
        "Show a car or bus hitting a pothole, your face bouncing from calm to regret, then your hand checking if your spine is still loyal.",
      howToFilm:
        "Place the camera on your lap, bounce it once during the pothole moment, then cut to you silently adjusting every body part.",
      caption: "Road feedback received.",
      premiseFamily: "road_survival",
      voiceTone: "physical_deadpan",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_035",
      draftId: "CLEAN-DRAFT-035",
      anchor: "fare",
      hook: "The fare changed before I sat down.",
      whatToShow:
        "Show you entering transport confidently, hearing the fare, sitting halfway, then rising slowly like the seat rejected your budget.",
      howToFilm:
        "Film your foot stepping in, cut to your hand holding exact cash, then show your slow retreat from the seat.",
      caption: "Budget cancelled boarding.",
      premiseFamily: "price_shock",
      voiceTone: "quiet_disbelief",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_036",
      draftId: "CLEAN-DRAFT-036",
      anchor: "junction",
      hook: "The junction had five wrong directions.",
      whatToShow:
        "Show you reaching a busy junction, three people pointing different ways, then you choosing the quietest option and regretting it immediately.",
      howToFilm:
        "Use quick cuts of three pointing hands, show your confident nod, then reveal you walking back from the wrong direction.",
      caption: "Navigation by committee.",
      premiseFamily: "errand_confusion",
      voiceTone: "dry_panic",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_037",
      draftId: "CLEAN-DRAFT-037",
      anchor: "cash",
      hook: "The cash disappeared inside my budget.",
      whatToShow:
        "Show you counting cash for one errand, adding transport and small snacks, then staring at the remaining note like it betrayed mathematics.",
      howToFilm:
        "Lay the cash on a table, remove notes for each expense with labels nearby, then zoom slightly on the lonely final note.",
      caption: "Money did gymnastics.",
      premiseFamily: "budget_collapse",
      voiceTone: "financial_deadpan",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_038",
      draftId: "CLEAN-DRAFT-038",
      anchor: "queue",
      hook: "The queue made me question ambition.",
      whatToShow:
        "Show a short queue becoming longer after you join, someone squeezing in with confidence, then you calculating whether the item is still necessary.",
      howToFilm:
        "Frame your shoes at the end of the queue, cut to more feet appearing ahead, then show you returning the item to your bag.",
      caption: "Dreams have queues.",
      premiseFamily: "shopping_delay",
      voiceTone: "soft_surrender",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_039",
      draftId: "CLEAN-DRAFT-039",
      anchor: "change",
      hook: "The change came with life advice.",
      whatToShow:
        "Show you waiting for change after buying something, the seller searching slowly, then handing coins with a full lecture on patience.",
      howToFilm:
        "Film your open palm waiting, cut to a drawer search, then show the change arriving while your smile fades politely.",
      caption: "Receipt plus sermon.",
      premiseFamily: "micro_transaction",
      voiceTone: "polite_exhaustion",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_040",
      draftId: "CLEAN-DRAFT-040",
      anchor: "greeting",
      hook: "The greeting became a full exam.",
      whatToShow:
        "Show you giving one greeting, an older relative asking who your parents are, where you work, and why you look thinner.",
      howToFilm:
        "Play both sides with over-shoulder cuts: your polite greeting first, then stack each greeting question with your smile getting smaller.",
      caption: "Respect is paperwork.",
      premiseFamily: "family_interrogation",
      voiceTone: "controlled_comedy",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_041",
      draftId: "CLEAN-DRAFT-041",
      anchor: "visit",
      hook: "The visit was never ten minutes.",
      whatToShow:
        "Show someone arriving for a quick visit, removing shoes, requesting water, charging phone, then settling like rent was paid.",
      howToFilm:
        "Cut from the visitor at the door to their visit items spreading across the room, then show the clock jumping forward.",
      caption: "Ten minutes moved in.",
      premiseFamily: "social_overstay",
      voiceTone: "domestic_deadpan",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_042",
      draftId: "CLEAN-DRAFT-042",
      anchor: "errand",
      hook: "The errand came dressed as conversation.",
      whatToShow:
        "Show a family member chatting sweetly, slowly mentioning one small errand, then revealing three stops and no transport money.",
      howToFilm:
        "Start with a friendly close shot, cut to your hand opening a notes app, then reveal the errand list growing line by line.",
      caption: "Kindness has logistics.",
      premiseFamily: "family_assignment",
      voiceTone: "gentle_suspicion",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_043",
      draftId: "CLEAN-DRAFT-043",
      anchor: "poll",
      hook: "The poll solved nothing beautifully.",
      whatToShow:
        "Show a group poll with four options, everyone voting differently, then someone suggesting the original plan like progress never happened.",
      howToFilm:
        "Screen-record a recreated poll, cut to your face reading the poll results, then show your finger hovering over mute.",
      caption: "Democracy failed calmly.",
      premiseFamily: "group_decision_fail",
      voiceTone: "dry_social",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_044",
      draftId: "CLEAN-DRAFT-044",
      anchor: "sticker",
      hook: "The sticker ended the serious meeting.",
      whatToShow:
        "Show a serious group chat discussion, then one sticker lands at the wrong time and the whole room loses focus while the original topic sits there untouched.",
      howToFilm:
        "Film a recreated chat screen with the serious message visible, show the sticker appearing underneath it, then cut to your notebook staying open while nobody returns to the agenda.",
      caption: "Agenda defeated by sticker.",
      premiseFamily: "chat_derailment",
      voiceTone: "office_deadpan",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_045",
      draftId: "CLEAN-DRAFT-045",
      anchor: "mute",
      hook: "The mute button protected my peace.",
      whatToShow:
        "Show your phone buzzing nonstop from one group, you reading only three messages, then choosing mute like a medical prescription.",
      howToFilm:
        "Show notifications stacking on the phone, cut to your tired thumb selecting mute, then end with peaceful silence and a snack.",
      caption: "Healing in settings.",
      premiseFamily: "digital_boundaries",
      voiceTone: "relieved_deadpan",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_046",
      draftId: "CLEAN-DRAFT-046",
      anchor: "onion",
      hook: "The onion priced itself like jewelry.",
      whatToShow:
        "Show you asking for onion, hearing the price, checking the onion again, then treating it like a luxury item.",
      howToFilm:
        "Hold one onion in your palm, cut to your shocked face, then place the onion carefully in a bag like a phone.",
      caption: "Luxury seasoning.",
      premiseFamily: "market_price_comedy",
      voiceTone: "dry_shock",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_047",
      draftId: "CLEAN-DRAFT-047",
      anchor: "rice",
      hook: "The rice multiplied without permission.",
      whatToShow:
        "Show you measuring small rice for yourself, the pot swelling, then you staring at enough food for unexpected relatives.",
      howToFilm:
        "Film the rice measuring cup, cut to the pot lid lifting, then show three empty plates appearing beside your single spoon.",
      caption: "Cooking for surprise guests.",
      premiseFamily: "kitchen_miscalculation",
      voiceTone: "quiet_absurd",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_048",
      draftId: "CLEAN-DRAFT-048",
      anchor: "freezer",
      hook: "The freezer hid the important fish.",
      whatToShow:
        "Show you searching the freezer for fish, removing frozen containers with no labels, then finding everything except dinner.",
      howToFilm:
        "Point into the open freezer, pull out mystery bowls one by one, then end on your hand holding ice like evidence.",
      caption: "Cold case investigation.",
      premiseFamily: "home_food_mystery",
      voiceTone: "detective_deadpan",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_049",
      draftId: "CLEAN-DRAFT-049",
      anchor: "zip",
      hook: "The zip waited for event day.",
      whatToShow:
        "Show your outfit looking perfect, the zip refusing to close minutes before leaving, then everyone becoming a technical support team.",
      howToFilm:
        "Start with the outfit laid out proudly, cut to hands wrestling the zip, then show safety pins entering like emergency workers.",
      caption: "Fashion chose conflict.",
      premiseFamily: "event_panic",
      voiceTone: "stylish_disaster",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_050",
      draftId: "CLEAN-DRAFT-050",
      anchor: "shoe",
      hook: "The shoe retired during the entrance.",
      whatToShow:
        "Show you entering an event with confidence, the shoe strap failing, then your walk becoming a negotiation with gravity.",
      howToFilm:
        "Film your shoe stepping proudly, cut to the loose strap, then show your careful limp past decorated chairs.",
      caption: "Grand entrance, small betrayal.",
      premiseFamily: "public_composure",
      voiceTone: "physical_clean",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_051",
      draftId: "CLEAN-DRAFT-051",
      anchor: "fabric",
      hook: "The fabric looked different at home.",
      whatToShow:
        "Show fabric looking rich at the shop, then at home it suddenly looks loud, shiny, and ready to embarrass the wearer.",
      howToFilm:
        "Show the fabric under bright shop-style light, cut to it spread on your bed, then show your slow blink of regret.",
      caption: "Confidence sold separately.",
      premiseFamily: "shopping_expectation_gap",
      voiceTone: "fashion_deadpan",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_052",
      draftId: "CLEAN-DRAFT-052",
      anchor: "form",
      hook: "The form asked for my entire history.",
      whatToShow:
        "Show you filling a simple form, then discovering questions about birthplace, next of kin, and details nobody prepared you for.",
      howToFilm:
        "Film your pen moving confidently, cut to the long form pages, then show you calling home for one forgotten answer.",
      caption: "Application became autobiography.",
      premiseFamily: "admin_overload",
      voiceTone: "bureaucratic_deadpan",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_053",
      draftId: "CLEAN-DRAFT-053",
      anchor: "deadline",
      hook: "The deadline appeared after the weekend.",
      whatToShow:
        "Show you relaxing on Sunday, opening one message, then discovering the deadline was quietly waiting since Friday.",
      howToFilm:
        "Film your relaxed hand holding a drink, cut to the deadline message timestamp, then show your laptop opening with panic speed.",
      caption: "Rest was a trap.",
      premiseFamily: "work_surprise",
      voiceTone: "controlled_panic",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_054",
      draftId: "CLEAN-DRAFT-054",
      anchor: "printer",
      hook: "The printer sensed my urgency.",
      whatToShow:
        "Show you needing one document quickly, the printer blinking, swallowing paper, then producing a faded page nobody can respect.",
      howToFilm:
        "Frame the printer light blinking, cut to your tapping foot, then show the weak printout beside your disappointed face.",
      caption: "Technology smelled fear.",
      premiseFamily: "office_machine_betrayal",
      voiceTone: "dry_urgency",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_055",
      draftId: "CLEAN-DRAFT-055",
      anchor: "airtime",
      hook: "The airtime entered the wrong purpose.",
      whatToShow:
        "Show you buying airtime for data, tapping too fast, then realizing your phone can call everyone but browse nothing.",
      howToFilm:
        "Screen-record a recreated airtime purchase flow, pause on the wrong option, then cut to your face accepting expensive silence.",
      caption: "Calls I never planned.",
      premiseFamily: "phone_money_mistake",
      voiceTone: "digital_regret",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_056",
      draftId: "CLEAN-DRAFT-056",
      anchor: "update",
      hook: "The update arrived during low battery.",
      whatToShow:
        "Show your phone requesting an update, battery at five percent, then you negotiating with the screen like it understands rent.",
      howToFilm:
        "Show the update prompt and low battery icon, cut to your charger search, then end on the phone dimming mid-decision.",
      caption: "Software chose violence quietly.",
      premiseFamily: "app_timing_betrayal",
      voiceTone: "calm_frustration",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_057",
      draftId: "CLEAN-DRAFT-057",
      anchor: "password",
      hook: "The password remembered me as a stranger.",
      whatToShow:
        "Show you entering the password confidently, getting rejected, trying old versions, then questioning your own biography.",
      howToFilm:
        "Film your thumb typing password dots, cut to each failed attempt message, then show you opening a notebook of ancient clues.",
      caption: "Identity denied.",
      premiseFamily: "login_comedy",
      voiceTone: "existential_deadpan",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_058",
      draftId: "CLEAN-DRAFT-058",
      anchor: "audio",
      hook: "The audio became popular after my idea.",
      whatToShow:
        "Show you saving an audio for later, finally filming with it, then opening the app to see everyone already used it better.",
      howToFilm:
        "Show the saved audio screen, cut to your filming setup, then reveal your feed filled with the same sound.",
      caption: "Trend left without me.",
      premiseFamily: "creator_timing",
      voiceTone: "soft_defeat",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_059",
      draftId: "CLEAN-DRAFT-059",
      anchor: "thumbnail",
      hook: "The thumbnail looked serious until my face disagreed.",
      whatToShow:
        "Show a creator choosing a thumbnail, zooming into their own face, then realizing the expression is fighting the entire message of the video.",
      howToFilm:
        "Frame the thumbnail choices on the phone, tap into the awkward face, then cut to the creator comparing it with the video title in quiet disappointment.",
      caption: "Brand image under review.",
      premiseFamily: "creator_self_review",
      voiceTone: "honest_deadpan",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    {
      id: "ng_clean_060",
      draftId: "CLEAN-DRAFT-060",
      anchor: "ringlight",
      hook: "The ringlight revealed too much ambition.",
      whatToShow:
        "Show you setting up a ringlight for a simple clip, adding powder, adjusting angles, then forgetting the original joke completely.",
      howToFilm:
        "Start with the ringlight switching on, cut through fast setup steps, then end on you staring at the phone with no script.",
      caption: "Production swallowed content.",
      premiseFamily: "creator_overpreparation",
      voiceTone: "clean_self_mockery",
      reviewedBy: "BI-CLEAN 2026-05-09",
    },
    // ---------------------------------------------------------------- //
    // P3 — N1-FOLLOWUP-NG-CLEAN-SLOT0-CORPUS-LIFT-P2-HUMAN-COMEDY      //
    // (BI-CLEAN 2026-05-10) — single entry imported from the           //
    // 10-candidate human-comedy packet. Originally curator-id          //
    // ng_clean_070; renumbered to ng_clean_061 to preserve the         //
    // contiguous-id corpus invariant. Hook text is byte-identical to   //
    // the curator submission. The other 9 candidates failed the        //
    // existing HQS >= 50 floor (range 28-47) under the live scorer     //
    // and were not imported per session-plan rule 7. See               //
    // .local/N1_FOLLOWUP_NG_CLEAN_SLOT0_CORPUS_LIFT_P2_HUMAN_COMEDY_REPORT.md
    // ---------------------------------------------------------------- //
    {
      id: "ng_clean_061",
      draftId: "CLEAN-DRAFT-061",
      anchor: "screen",
      hook: "The screen dimmed and I started bargaining.",
      whatToShow:
        "Show the screen dimming at low battery. Look from the screen to the charger across the room, then start moving like every step needs approval.",
      howToFilm:
        "Close on the screen first, then wide to reveal the charger. End on your frozen reaction when the phone dims again.",
      caption: "low battery turns everybody into a negotiator.",
      premiseFamily: "phone_survival_panic",
      voiceTone: "dry_clean_observation",
      reviewedBy: "BI-CLEAN 2026-05-10",
    },
    // ---------------------------------------------------------------- //
    // PHASE N1-FOLLOWUP-NG-CLEAN-HIGH-HQS-CORPUS-LIFT-P3-HUMAN-FIRST   //
    // (BI-CLEAN 2026-05-10)                                            //
    // ---------------------------------------------------------------- //
    // 3 entries imported from a 20-candidate packet. Each PRE-IMPORT   //
    // verified against live `scoreHookQualityDetailed` (HQS >= 50),    //
    // live `classifyNigerianCleanCoreEntryFailure` (validator clean),  //
    // AND live `authorPackEntryAsIdea` runtime-author (catches the     //
    // hook_topic_noun_drift surface). Supervisor-approved hook         //
    // tightenings applied to NEW_005, _006, _012, _015, _016, _017     //
    // (text) and _018 (anchor) before scoring. 16 candidates failed    //
    // HQS-only; 1 (NEW_005 "screen dimmed during my account balance")  //
    // passed HQS=65 + boot-validator but failed runtime-author with    //
    // hook_topic_noun_drift (anchor "screen" vs banking-balance body)  //
    // and was rejected. None rewritten into scorer-shaped filler per   //
    // session-plan rules 7, 12, 13, 14.                                //
    // See .local/N1_FOLLOWUP_NG_CLEAN_HIGH_HQS_CORPUS_LIFT_P3_HUMAN_FIRST_REPORT.md
    // ---------------------------------------------------------------- //
    {
      id: "ng_clean_062",
      draftId: "CLEAN-DRAFT-062",
      anchor: "auntie\u2019s spoon",
      hook: "Auntie\u2019s spoon measured rice like national security.",
      whatToShow:
        "At a kitchen table, a person tries to serve rice casually. An auntie enters with one specific spoon and starts measuring every scoop with serious authority. The person freezes mid-scoop as the whole meal becomes a controlled operation. The auntie\u2019s spoon does not negotiate.",
      howToFilm:
        "Film the serving plate, then reveal the spoon entering frame like an official tool. Use quick reaction cuts from the server, the plate, and the auntie\u2019s calm supervision. End with one tiny extra grain being noticed.",
      caption: "Some spoons are not ordinary spoons.",
      premiseFamily: "family_food_pressure",
      voiceTone: "observational_clean",
      reviewedBy: "BI-CLEAN 2026-05-10",
    },
    {
      id: "ng_clean_063",
      draftId: "CLEAN-DRAFT-063",
      anchor: "online form",
      hook: "The online form asked like my mother.",
      whatToShow:
        "A person fills a fake online form and starts confident. The questions become increasingly personal: address history, next of kin, previous school, reason for applying. The person looks at the laptop, then toward the door like a parent might enter and continue the questioning. The online form just keeps asking.",
      howToFilm:
        "Use a fake form with safe placeholder text and blurred details. Cut between the cursor, the person\u2019s tired face, and their hand hovering over the keyboard. Payoff with them closing the laptop gently like ending a family interrogation.",
      caption: "Some forms are raised in strict homes.",
      premiseFamily: "admin_overload",
      voiceTone: "dry_deadpan",
      reviewedBy: "BI-CLEAN 2026-05-10",
    },
    {
      id: "ng_clean_064",
      draftId: "CLEAN-DRAFT-064",
      anchor: "measuring cup",
      hook: "The measuring cup exposed my cooking confidence.",
      whatToShow:
        "A person starts cooking by guessing ingredients with confidence. Someone hands them a measuring cup, and suddenly every guess becomes suspicious. They pour, stop, return some, add more, and pretend this was the plan all along.",
      howToFilm:
        "Use a kitchen counter with dry ingredients or water in safe amounts. Show the confident free-pour first, then the measuring cup entering frame and changing the person\u2019s behavior. Payoff with a tiny correction treated like a scientific breakthrough.",
      caption: "Cooking confidence ends when measurement arrives.",
      premiseFamily: "household_false_confidence",
      voiceTone: "dry_clean",
      reviewedBy: "BI-CLEAN 2026-05-10",
    },
    // ---------------------------------------------------------------- //
    // PHASE N1-FOLLOWUP-NG-CLEAN-IMPLICIT-ANTHROPOMORPH-HQS-FIX        //
    // (BI-CLEAN 2026-05-10) — 7 P3-HUMAN-FIRST candidates that were    //
    // previously HQS-blocked at the `pickerHookQualityFloor` (50) by   //
    // the IMPLICIT_ANTHROPOMORPH verb-alternation check in             //
    // `hookQuality.ts`. The narrowest-possible verb-alternation        //
    // expansion (this same packet) added `smiled / printed /           //
    // appointed / rang / sounded / arrived` to the recognized          //
    // object-as-agent verb set, lifting these 7 hooks above the        //
    // floor while preserving every other validator/scorer surface.    //
    // Predict + runtime-author results captured at                     //
    // `.local/qa-runs/n1_ng_clean_implicit_anthropomorph_p3_predict.json`. //
    // ---------------------------------------------------------------- //
    {
      id: "ng_clean_065",
      draftId: "CLEAN-DRAFT-065",
      anchor: "bank app",
      hook: "The bank app smiled before rejecting my confidence.",
      whatToShow:
        "A person stands at a small shop counter acting calm while the bank app loads. They nod like everything is fine, then the screen shows a fake failed transfer message. The seller quietly pulls the nylon bag back, and the person suddenly starts explaining network issues like a trained spokesperson.",
      howToFilm:
        "Shoot over the shoulder with a blurred fake bank screen, then cut to the shopkeeper\u2019s hand slowly reclaiming the bag. End on the person giving a confident thumbs-up while clearly panicking.",
      caption: "When your bank app embarrasses you in public.",
      premiseFamily: "money_pos_bank",
      voiceTone: "dry_clean",
      reviewedBy: "BI-CLEAN 2026-05-10",
    },
    {
      id: "ng_clean_066",
      draftId: "CLEAN-DRAFT-066",
      anchor: "POS receipt",
      hook: "The POS receipt printed slower than my excuses.",
      whatToShow:
        "A person finishes paying and waits for the POS receipt while everyone watches. The machine prints tiny lines painfully slowly. The person starts pretending to check other important messages, but keeps looking back at the receipt like it is deciding their future.",
      howToFilm:
        "Use a close shot of a fake POS receipt inching out, then cut between waiting faces and the person forcing a serious expression. Finish with the receipt finally printing and the person collecting it like exam results.",
      caption: "That POS silence can humble anybody.",
      premiseFamily: "money_pos_bank",
      voiceTone: "quiet_panic",
      reviewedBy: "BI-CLEAN 2026-05-10",
    },
    {
      id: "ng_clean_067",
      draftId: "CLEAN-DRAFT-067",
      anchor: "group chat",
      hook: "The group chat appointed me without discussion.",
      whatToShow:
        "A person opens a family or office group chat and sees their name volunteered for a task. They stare at the phone, look around the empty room for witnesses, then begin typing and deleting polite complaints until they simply reply, \u201cOkay.\u201d",
      howToFilm:
        "Show a fake chat screen with private details removed, then film the person\u2019s face changing from confusion to forced responsibility. Add quick cuts of typed replies being deleted before the defeated final reply.",
      caption: "Promotion without salary, ceremony, or consent.",
      premiseFamily: "group_chats",
      voiceTone: "dry_deadpan",
      reviewedBy: "BI-CLEAN 2026-05-10",
    },
    {
      id: "ng_clean_068",
      draftId: "CLEAN-DRAFT-068",
      anchor: "doorbell",
      hook: "The doorbell rang while I was acting serious.",
      whatToShow:
        "A creator is filming comfortably in a room, wearing a dramatic top half and relaxed home clothes below. The doorbell rings. They freeze, glance at the outfit, hide props under a pillow, and try to answer the door like nothing strange was happening.",
      howToFilm:
        "Start with a creator mid-performance, then cut sharply to the doorbell sound and full-body outfit panic. Stage the doorway safely indoors and end with the creator opening the door only halfway.",
      caption: "Visitors always know when to arrive.",
      premiseFamily: "creator_social_behavior",
      voiceTone: "dry_clean",
      reviewedBy: "BI-CLEAN 2026-05-10",
    },
    {
      id: "ng_clean_069",
      draftId: "CLEAN-DRAFT-069",
      anchor: "email subject",
      hook: "The email subject already sounded like extra work.",
      whatToShow:
        "A person opens their inbox and sees a subject line like \u201cQuick Help Needed Today.\u201d They lean back, close the laptop halfway, reopen it, and begin acting busy in an empty room before even reading the message. The email subject already feels heavy.",
      howToFilm:
        "Use a fake inbox with safe placeholder details. Start with a calm face, then punch in on the subject line and the immediate physical retreat. Payoff with the person typing \u201cNoted\u201d while looking personally defeated.",
      caption: "Some emails announce stress before opening.",
      premiseFamily: "school_work",
      voiceTone: "dry_clean",
      reviewedBy: "BI-CLEAN 2026-05-10",
    },
    {
      id: "ng_clean_070",
      draftId: "CLEAN-DRAFT-070",
      anchor: "transfer narration",
      hook: "The transfer narration sounded richer than my balance.",
      whatToShow:
        "A person makes a small transfer but writes an unnecessarily serious transfer narration like \u201cPayment for urgent services.\u201d They pause, reread it, then check their fake balance and quietly reduce the confidence in both the amount and the wording.",
      howToFilm:
        "Show only a fake transfer screen with blurred or placeholder values. Cut to the person proudly typing, then shrinking physically after checking the balance. End with the narration changed to something plain and humble.",
      caption: "Sometimes the narration has more confidence than you.",
      premiseFamily: "money_pos_bank",
      voiceTone: "self_aware_clean",
      reviewedBy: "BI-CLEAN 2026-05-10",
    },
    {
      id: "ng_clean_071",
      draftId: "CLEAN-DRAFT-071",
      anchor: "calendar reminder",
      hook: "The calendar reminder arrived like family intervention.",
      whatToShow:
        "A person is relaxing confidently when a calendar reminder pops up for an appointment they forgot. They sit up slowly, check the time, look at their outfit, and begin moving around the room like the reminder personally came to correct their life.",
      howToFilm:
        "Use a fake reminder screen with no personal details. Start with comfort and silence, then let the notification sound trigger sudden movement. Payoff with the person packing random items while still not fully understanding where they are going.",
      caption: "A reminder can change your whole posture.",
      premiseFamily: "school_work",
      voiceTone: "quiet_realization",
      reviewedBy: "BI-CLEAN 2026-05-10",
    },
  ]);

// ---------------------------------------------------------------- //
// premiseFamily → NigerianPackEntry-compatible domain bucket        //
// ---------------------------------------------------------------- //
//
// The wiring site in `coreCandidateGenerator.ts` reuses
// `authorPackEntryAsIdea` (from `nigerianPackAuthor.ts`) to
// synthesize the full `Idea` schema fields and run the same four
// production validators (ideaSchema parse, validateScenarioCoherence,
// validateComedy, validateAntiCopyDetailed). That author takes a
// `NigerianPackEntry` shape with a `domain` string from the curator
// bucket set; we project the clean-core `premiseFamily` onto the
// closest pack-domain bucket so the synthesised `setting` /
// `triggerCategory` fields fall in their `ideaSchema` enums.
//
// The map covers exactly the 9 premiseFamily values used in the 30
// entries above. Unknown premiseFamily falls back to "everyday" — a
// safe portable bucket that maps to the canonical "home" domain.
export const NIGERIAN_CLEAN_CORE_PREMISE_FAMILY_TO_PACK_DOMAIN: Readonly<
  Record<string, string>
> = Object.freeze({
  power_light: "home",
  transport: "transport",
  money_pos_bank: "money",
  family_aunties: "family",
  group_chats: "messaging",
  market_food: "everyday",
  tailoring_events: "everyday",
  school_work: "work",
  phone_data: "phone",
  creator_social_behavior: "creator",
});

// ---------------------------------------------------------------- //
// Activation gate                                                   //
// ---------------------------------------------------------------- //

export function canActivateNigerianCleanCorePack(args: {
  region?: string | null;
  languageStyle?: LanguageStyle | null;
}): boolean {
  return args.region === "nigeria" && args.languageStyle === "clean";
}

// ---------------------------------------------------------------- //
// Validator helpers — protect future hand-authored entries          //
// ---------------------------------------------------------------- //
//
// Conservative until proven otherwise. The user can broaden these
// gates explicitly per-token (e.g., approve `oga` for clean
// Nigerian English) once entries land and editorial review surfaces
// concrete tradeoffs.

/** Pidgin grammar markers banned from clean-style entries. */
export const NIGERIAN_CLEAN_CORE_BANNED_PIDGIN_MARKERS: readonly string[] =
  Object.freeze([
    "dey",
    "don",
    "abeg",
    "wahala",
    "wetin",
    "sha",
    "abi",
    "oga",
  ]);

/** Lazy stereotype / punching-down tokens banned from clean entries. */
export const NIGERIAN_CLEAN_CORE_BANNED_STEREOTYPE_TOKENS: readonly string[] =
  Object.freeze([
    "nepa",
    "village people",
    "my enemies",
    "yahoo boy",
    "419",
    "jollof",
    "buka",
  ]);

/** Old filming boilerplate phrasings banned from clean entries. */
export const NIGERIAN_CLEAN_CORE_BANNED_FILMING_BOILERPLATE: readonly string[] =
  Object.freeze([
    "phone-level lock-off",
    "desk-height lock-off",
    "counter-level lock-off",
    "couch-level handheld",
    "bed-level handheld",
    "door-side handheld",
    "mirror lock-off",
    "soft daylight",
    "one take",
    "keep the",
  ]);

export type NigerianCleanCoreEntryValidationFailure =
  | "missing_id"
  | "missing_draft_id"
  | "missing_anchor"
  | "missing_hook"
  | "missing_what_to_show"
  | "missing_how_to_film"
  | "missing_caption"
  | "missing_premise_family"
  | "missing_voice_tone"
  | "missing_reviewed_by"
  | "anchor_not_in_hook"
  | "anchor_not_in_what_to_show"
  | "pidgin_marker_in_hook_or_what_to_show"
  | "stereotype_token_in_hook_or_what_to_show_or_caption"
  | "filming_boilerplate_in_how_to_film"
  | "shouty_template_blocked_by_clean_core_guard"
  | "hook_word_count_exceeds_idea_schema_cap";

/** Tokenize on word boundaries, case-insensitive, for marker scans. */
function tokenize(text: string): readonly string[] {
  return text.toLowerCase().match(/\b[a-z0-9]+\b/g) ?? [];
}

/** Returns true iff every banned-marker token appears as a discrete
 *  word in `text` (case-insensitive). Whitespace-bearing markers
 *  (`village people`) are matched as substrings on the lowercased
 *  text. */
function containsAnyBannedMarker(
  text: string,
  banned: readonly string[],
): string | null {
  const lower = text.toLowerCase();
  const tokens = new Set(tokenize(lower));
  for (const marker of banned) {
    if (marker.includes(" ")) {
      if (lower.includes(marker)) return marker;
    } else {
      if (tokens.has(marker)) return marker;
    }
  }
  return null;
}

/** Returns true iff `anchor` (case-insensitive) appears as a
 *  substring of `text`. The catalog already enforces
 *  anchor-in-hook + anchor-in-whatToShow elsewhere; this is the
 *  same predicate at the per-entry boundary. */
function containsAnchor(text: string, anchor: string): boolean {
  return text.toLowerCase().includes(anchor.toLowerCase());
}

export function classifyNigerianCleanCoreEntryFailure(
  entry: NigerianCleanCoreEntry,
): NigerianCleanCoreEntryValidationFailure | null {
  if (!entry.id) return "missing_id";
  if (!entry.draftId) return "missing_draft_id";
  if (!entry.anchor) return "missing_anchor";
  if (!entry.hook) return "missing_hook";
  if (!entry.whatToShow) return "missing_what_to_show";
  if (!entry.howToFilm) return "missing_how_to_film";
  if (!entry.caption) return "missing_caption";
  if (!entry.premiseFamily) return "missing_premise_family";
  if (!entry.voiceTone) return "missing_voice_tone";
  if (!entry.reviewedBy) return "missing_reviewed_by";

  if (!containsAnchor(entry.hook, entry.anchor)) {
    return "anchor_not_in_hook";
  }
  if (!containsAnchor(entry.whatToShow, entry.anchor)) {
    return "anchor_not_in_what_to_show";
  }

  const pidginScan = `${entry.hook}\n${entry.whatToShow}`;
  if (
    containsAnyBannedMarker(
      pidginScan,
      NIGERIAN_CLEAN_CORE_BANNED_PIDGIN_MARKERS,
    )
  ) {
    return "pidgin_marker_in_hook_or_what_to_show";
  }

  const stereotypeScan = `${entry.hook}\n${entry.whatToShow}\n${entry.caption}`;
  if (
    containsAnyBannedMarker(
      stereotypeScan,
      NIGERIAN_CLEAN_CORE_BANNED_STEREOTYPE_TOKENS,
    )
  ) {
    return "stereotype_token_in_hook_or_what_to_show_or_caption";
  }

  if (
    containsAnyBannedMarker(
      entry.howToFilm,
      NIGERIAN_CLEAN_CORE_BANNED_FILMING_BOILERPLATE,
    )
  ) {
    return "filming_boilerplate_in_how_to_film";
  }

  if (isNigerianCleanCoreHookBlocked(entry.hook)) {
    return "shouty_template_blocked_by_clean_core_guard";
  }

  // PHASE N1-CLEAN-CORE-P1 architect-fix (2026-05-09): mirror the
  // production `ideaSchema` rule `hook must be ≤10 words (target ≤8)`
  // at the boot-time entry validator so a curator submitting an
  // 11+-word hook is rejected at module load — NOT silently dropped
  // at runtime by `authorPackEntryAsIdea`'s `schema_invalid` branch.
  // Word count uses the same whitespace-split semantics as
  // `ideaGen.ts` (split on `/\s+/`, filter empty).
  const hookWordCount = entry.hook.trim().split(/\s+/).filter(Boolean).length;
  if (hookWordCount > 10) {
    return "hook_word_count_exceeds_idea_schema_cap";
  }

  return null;
}

export function isValidNigerianCleanCoreEntry(
  entry: NigerianCleanCoreEntry,
): boolean {
  return classifyNigerianCleanCoreEntryFailure(entry) === null;
}

// ---------------------------------------------------------------- //
// Boot-time invariant — catalog stays valid                         //
// ---------------------------------------------------------------- //
//
// Intentionally light: with the empty production array the loop is
// a no-op. When entries land, any malformed row throws at module
// load — caught by the test suite and any boot path.

for (const entry of NIGERIAN_CLEAN_CORE_ENTRIES) {
  const failure = classifyNigerianCleanCoreEntryFailure(entry);
  if (failure !== null) {
    throw new Error(
      `[nigerianCleanCorePack] entry "${entry.id}" failed validation: ${failure}`,
    );
  }
}
