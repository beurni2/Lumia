/**
   * PHASE W2-I — Western APPROVED promotion pool (DARK).
   *
   * This module exports the curated Top 100 entries selected from
   * `WESTERN_HOOK_PACK_DRAFT` after the W2-D editorial ranker pass,
   * the W2-F P0 visible-action / anchor-cohesion rewrite pass, and
   * the W2-H triplet-cluster resolution pass.
   *
   * Safety model (mirrors the W2-A / W2-B / W2-C / W2-F / W2-H
   * dark-infrastructure precedent):
   *
   *   1. The approved pool is a SEPARATE constant from any future
   *      live Western pack constant. It cannot be reached by any
   *      current runtime path because no runtime path imports it.
   *   2. Every approved row still carries the editorial-review
   *      sentinel `PENDING_EDITORIAL_REVIEW`. Promoting an approved
   *      row to a live pack would require an editor to overwrite
   *      that stamp in the same PR (the future live-pack integrity
   *      check must reject the sentinel for the same reason the
   *      Nigerian boot assert rejects `PENDING_NATIVE_REVIEW`).
   *   3. The integrity assertion below is exported but NOT called
   *      at module load (no top-level side effects). The dedicated
   *      unit test exercises it.
   *
   * NOT in scope for W2-I (do not add now):
   *   - Activation / runtime wiring
   *   - Slot reservation
   *   - Scoring changes
   *   - Validator / Claude / API / migration changes
   *   - Removal from `WESTERN_HOOK_PACK_DRAFT` (the draft remains
   *     the source of truth until a future promotion phase)
   */

  import {
    PENDING_EDITORIAL_REVIEW,
    WESTERN_HOOK_PACK_DRAFT,
    checkWesternHookPackDraftIntegrity,
    type WesternHookPackDraftEntry,
  } from "./westernHookPack.js";
  import {
    WESTERN_HOOK_PACK_BATCH_NEXT,
    WESTERN_HOOK_PACK_BATCH_NEXT_IDS,
  } from "./westernHookPackBatchNext.js";
  import {
    WESTERN_HOOK_PACK_BATCH_NEXT2,
    WESTERN_HOOK_PACK_BATCH_NEXT2_IDS,
  } from "./westernHookPackBatchNext2.js";
  import type { Region } from "@workspace/lumina-trends";
  import type { LanguageStyle } from "./tasteCalibration.js";

  // ---------------------------------------------------------------- //
  // PHASE W2-K — staging-only activation gates for the Western        //
  // approved promotion pool. Mirrors the NG pack activation pattern   //
  // (`canActivateNigerianPack`) but tighter: this pool ONLY targets   //
  // the western/default cohort and the "clean" / unspecified language //
  // style, so the NG cohort (region=nigeria + pidgin/light_pidgin) is  //
  // structurally excluded by both axes. Production `start` script does //
  // NOT set the env flag → OFF in prod. The dev `start` script sets it //
  // → ON in staging. Pool length is read from the frozen Top 100      //
  // export below so a future re-rank cannot accidentally activate an  //
  // empty pool.                                                       //
  // ---------------------------------------------------------------- //

  /** Staging-only env flag for the W2-K runtime wiring. */
  export const WESTERN_APPROVED_POOL_FEATURE_FLAG_ENV =
    "LUMINA_W2_WESTERN_APPROVED_ENABLED";

  /** Reads the env flag. `true` only when literal "true". */
  export const isWesternApprovedPoolFeatureEnabled = (): boolean =>
    process.env[WESTERN_APPROVED_POOL_FEATURE_FLAG_ENV] === "true";

  export interface CanActivateWesternApprovedPoolInput {
    region: Region | undefined;
    languageStyle: LanguageStyle | null | undefined;
    flagEnabled: boolean;
    packLength: number;
  }

  /**
   * Four-AND activation guard — short-circuits to false unless ALL
   * conditions hold. Order is intentional: cheapest first.
   *
   *   1. flagEnabled       — env flag ON (staging only by default)
   *   2. packLength > 0    — frozen Top 100 has entries
   *   3. region eligible   — undefined OR "western" (the default cohort)
   *   4. languageStyle ok  — undefined / null / "clean" only. The
   *                          NG cohort uses "pidgin" / "light_pidgin"
   *                          and is excluded by BOTH region (≠western)
   *                          and languageStyle (≠clean), so a single-
   *                          axis bug cannot leak W2 into NG.
   *
   * India / PH cohorts have region "india"/"philippines" → fail (3).
   * NG-clean (region=nigeria + clean) → fails (3).
   * Western-pidgin (region=western + pidgin) → fails (4) — defensive,
   * not expected in production but blocked here for cohort isolation.
   */
  export const canActivateWesternApprovedPool = (
    input: CanActivateWesternApprovedPoolInput,
  ): boolean => {
    if (!input.flagEnabled) return false;
    if (input.packLength <= 0) return false;
    if (input.region !== undefined && input.region !== "western") return false;
    const ls = input.languageStyle ?? null;
    if (ls !== null && ls !== "clean") return false;
    return true;
  };

  /**
   * Returns the eligible W2 entries for the given activation context.
   * Returns an empty frozen array (NOT the pool) when the four-AND
   * guard fails, so callers can pass the result through `.length` and
   * `.filter()` checks without an extra activation branch.
   */
  export const getEligibleWesternApprovedEntries = (
    input: CanActivateWesternApprovedPoolInput,
  ): readonly WesternHookPackDraftEntry[] => {
    if (!canActivateWesternApprovedPool(input)) {
      return EMPTY_WESTERN_APPROVED_FROZEN;
    }
    return APPROVED_WESTERN_PROMOTION_CANDIDATES;
  };

  const EMPTY_WESTERN_APPROVED_FROZEN: readonly WesternHookPackDraftEntry[] =
    Object.freeze([]);


  // Selection provenance: ids ordered by descending W2-D rubric score
  // (post-W2-F, post-W2-H corpus). Captured here as a readonly tuple
  // so the test can assert the count without re-running the ranker.
  /**
   * PHASE W2-I draft-promotion ids (the original Top 100 selected
   * from `WESTERN_HOOK_PACK_DRAFT`). Kept as a private const so the
   * public `APPROVED_WESTERN_PROMOTION_IDS` can concatenate the
   * later `WESTERN_HOOK_PACK_BATCH_NEXT_IDS` (PHASE W2-L) without
   * losing the W2-D rubric ordering of the draft-promoted block.
   */
  const W2I_DRAFT_PROMOTION_IDS: readonly string[] = Object.freeze([
    "W2A-014",
  "W2A-027",
  "W2B-041",
  "W2A-007",
  "W2A-047",
  "W2B-020",
  "W2C-039",
  "W2C-047",
  "W2A-001",
  "W2A-009",
  "W2A-016",
  "W2A-021",
  "W2A-023",
  "W2A-024",
  "W2A-026",
  "W2A-030",
  "W2A-033",
  "W2A-034",
  "W2A-050",
  "W2B-004",
  "W2B-005",
  "W2B-006",
  "W2B-010",
  "W2B-019",
  "W2B-023",
  "W2B-024",
  "W2B-025",
  "W2B-031",
  "W2B-033",
  "W2B-035",
  "W2B-037",
  "W2B-042",
  "W2B-049",
  "W2C-001",
  "W2C-007",
  "W2C-009",
  "W2C-013",
  "W2C-017",
  "W2C-022",
  "W2C-026",
  "W2C-036",
  "W2C-037",
  "W2C-040",
  "W2C-043",
  "W2C-044",
  "W2C-045",
  "W2C-046",
  "W2B-043",
  "W2A-049",
  "W2B-012",
  "W2B-017",
  "W2B-022",
  "W2B-044",
  "W2C-034",
  "W2A-002",
  "W2A-003",
  "W2A-005",
  "W2A-006",
  "W2A-008",
  "W2A-010",
  "W2A-011",
  "W2A-012",
  "W2A-015",
  "W2A-017",
  "W2A-018",
  "W2A-020",
  "W2A-022",
  "W2A-028",
  "W2A-032",
  "W2A-036",
  "W2A-039",
  "W2A-040",
  "W2A-041",
  "W2A-043",
  "W2A-045",
  "W2A-046",
  "W2A-048",
  "W2B-001",
  "W2B-007",
  "W2B-008",
  "W2B-011",
  "W2B-013",
  "W2B-021",
  "W2B-038",
  "W2C-002",
  "W2C-004",
  "W2C-006",
  "W2C-010",
  "W2C-011",
  "W2C-014",
  "W2C-015",
  "W2C-016",
  "W2C-018",
  "W2C-020",
  "W2C-021",
  "W2C-023",
  "W2C-024",
  "W2C-025",
  "W2C-027",
  "W2C-030",
  ]);

  /**
   * PHASE W2-I draft-promotion candidates (private). The public
   * `APPROVED_WESTERN_PROMOTION_CANDIDATES` concatenates these with
   * the W2-L `WESTERN_HOOK_PACK_BATCH_NEXT` so the runtime sees a
   * single homogeneous pool while the W2-D rubric ordering of the
   * first 100 entries is preserved at the head of the array.
   */
  const W2I_DRAFT_PROMOTION_CANDIDATES: readonly WesternHookPackDraftEntry[] = Object.freeze([
    {
    id: "W2A-014",
    hook: "refreshing the tracking page like i can intimidate the package",
    whatToShow:
      "You open the tracking page for the package, swipe down to refresh, stare at the unchanged timestamp, and swipe down again like you can intimidate it.",
    howToFilm:
      "Keep the tracking screen fake or blurred. Focus on the physical ritual: refresh, lean in, refresh harder, lean back defeated.",
    caption: "the package and i are in negotiations.",
    anchor: "package",
    comedyFamily: "phone_distraction",
    emotionalSpike: "impatient_spiral",
    setting: "desk",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
  {
    id: "W2A-027",
    hook: "standing in workout clothes waiting for motivation to arrive",
    whatToShow:
      "You put on the workout clothes, stand in the middle of the room waiting for motivation to land, then sit down without starting a single thing.",
    howToFilm:
      "Frame it like a workout intro. Shoes tied, water nearby, serious face. Then let the energy drain out in real time until you're just sitting there.",
    caption: "outfit did its part.",
    anchor: "motivation",
    comedyFamily: "self_improvement_attempt",
    emotionalSpike: "self_betrayal",
    setting: "living_room",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
  {
    id: "W2B-041",
    hook: "one last mirror check becoming a full audit",
    whatToShow:
      "You lean toward the mirror for one last check, adjust your collar, then your hair, then squint at the lighting and start an unscheduled audit.",
    howToFilm:
      "Hallway mirror angle. Start casual, then let each tiny fix make you more suspicious of the whole outfit.",
    caption: "mirror opened an investigation.",
    anchor: "mirror",
    comedyFamily: "leaving_house_delay",
    emotionalSpike: "self_critique",
    setting: "hallway",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2A-007",
    hook: "filming gym proof from the couch",
    whatToShow:
      "Creator films a fake gym story angle from the couch, shows only sneakers or a water bottle, then leans back into the cushions.",
    howToFilm:
      "Frame it like a fitness post at first. Reveal the couch context at the end so the “gym story” collapses.",
    caption: "gym story, couch production.",
    anchor: "gym",
    comedyFamily: "creator_anxiety",
    emotionalSpike: "exposed_lie",
    setting: "living_room",
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
    comedyFamily: "work_school_panic",
    emotionalSpike: "avoidance_spike",
    setting: "desk",
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
    id: "W2C-039",
    hook: "typing 'on my way' while still in a towel",
    whatToShow:
      "You sit wrapped in a towel, clearly nowhere near leaving, calmly typing 'on my way' into a fake chat.",
    howToFilm:
      "The contrast is the whole joke. Keep the towel, wet hair, or bathroom setting visible while the fake message says you're moving.",
    caption: "on my way to the hair dryer.",
    anchor: "way",
    comedyFamily: "leaving_house_delay",
    emotionalSpike: "exposed_lie",
    setting: "bathroom",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2C-047",
    hook: "meal photo behaved better than me",
    whatToShow:
      "Creator carefully takes a perfect meal photo, sets phone down, then immediately eats over the counter with zero grace.",
    howToFilm:
      "Start with the polished meal photo moment. Then cut to the unpolished eating reality so the contrast lands.",
    caption: "photo had manners. i did not.",
    anchor: "meal",
    comedyFamily: "food_self_control",
    emotionalSpike: "self_betrayal",
    setting: "kitchen",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2A-001",
    hook: "checking the post like the likes owe me rent",
    whatToShow:
      "You post something, put the phone face down like you're above it, then immediately flip it back over to check the likes again.",
    howToFilm:
      "Set the phone on a desk or bed where we can see your hand trying to leave it alone. The joke is the failure, so hold the pause for a second before you snatch the phone back up. Keep it quiet and awkward.",
    caption: "i am not checking. i am monitoring.",
    anchor: "post",
    comedyFamily: "posting_anxiety",
    emotionalSpike: "private_embarrassment",
    setting: "bedroom",
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
    comedyFamily: "getting_ready",
    emotionalSpike: "instant_regret",
    setting: "bedroom",
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
    comedyFamily: "work_school_panic",
    emotionalSpike: "exposed_lie",
    setting: "desk",
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
    comedyFamily: "food_self_control",
    emotionalSpike: "self_betrayal",
    setting: "kitchen",
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
    comedyFamily: "procrastination",
    emotionalSpike: "quiet_defeat",
    setting: "kitchen",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
  {
    id: "W2A-024",
    hook: "watching my own story like i didn't just post it",
    whatToShow:
      "You tap to post the story, open your own profile, and scroll to your story to watch it like you're part of the audience.",
    howToFilm:
      "Film your hand tapping into your own story, then cut to your face judging it like a stranger uploaded it. Keep the embarrassment tiny and real.",
    caption: "viewer number one.",
    anchor: "story",
    comedyFamily: "posting_anxiety",
    emotionalSpike: "private_embarrassment",
    setting: "bedroom",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
  {
    id: "W2A-026",
    hook: "bringing a water bottle to feel like a better person",
    whatToShow:
      "You grab a water bottle, place it next to the laptop with intention, glance at it every ten minutes, and never actually take a sip.",
    howToFilm:
      "Let the bottle be visible in multiple little moments: desk, couch, doorway. Each time, you move it like a prop from your improved life.",
    caption: "hydration, but mostly branding.",
    anchor: "water",
    comedyFamily: "self_improvement_attempt",
    emotionalSpike: "false_productivity",
    setting: "home",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
  {
    id: "W2A-030",
    hook: "packing a bag like i'm moving out for one errand",
    whatToShow:
      "You open the bag for one quick errand, place the charger inside, then a water bottle, then a snack, then a backup sweater nobody asked for.",
    howToFilm:
      "Shoot from above or bed-level. Each extra item should feel more unnecessary than the last. End by struggling to zip the bag for a 20-minute outing.",
    caption: "emotionally preparing for survival.",
    anchor: "bag",
    comedyFamily: "leaving_house_delay",
    emotionalSpike: "overprepared_panic",
    setting: "bedroom",
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
    comedyFamily: "task_avoidance",
    emotionalSpike: "false_productivity",
    setting: "desk",
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
    comedyFamily: "adulting_panic",
    emotionalSpike: "self_betrayal",
    setting: "bedroom",
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
    comedyFamily: "work_school_panic",
    emotionalSpike: "deadline_panic",
    setting: "desk",
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
    hook: "typing bubble disappeared with my confidence",
    whatToShow:
      "Creator watches fake typing bubbles in a chat, sits up with hope, then the bubble disappears and they slowly sink back down.",
    howToFilm:
      "Use fake chat text. Hold on the typing bubble, show the hopeful posture, then deflate when it vanishes.",
    caption: "typing bubble left quietly.",
    anchor: "typing",
    comedyFamily: "texting_overthinking",
    emotionalSpike: "social_panic",
    setting: "living_room",
    safetyNote: "Use fake chat text.",
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
    id: "W2B-010",
    hook: "finding the typo after the message is already gone",
    whatToShow:
      "You tap send, scroll back to reread the message, spot the typo, and stare at the screen like the room temperature just changed.",
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
    setting: "hallway",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2B-023",
    hook: "building the focus playlist instead of focusing",
    whatToShow:
      "You sit on the couch, scroll through songs, drag tracks into a focus playlist, and glance at the laptop where the task stays minimized.",
    howToFilm:
      "Couch shot with phone or laptop visible. Treat every song choice like productivity, then reveal the untouched work.",
    caption: "soundtrack ready. plot missing.",
    anchor: "playlist",
    comedyFamily: "procrastination",
    emotionalSpike: "false_productivity",
    setting: "couch",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2B-024",
    hook: "watering plants like the deadline is theirs",
    whatToShow:
      "You lean over the plants, pour water into each pot one by one, and glance back at the laptop where the deadline still waits.",
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
      "You drag desktop icons into neat folders, adjust the wallpaper, and glance at the real document still sitting blank.",
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
    id: "W2B-037",
    hook: "my name appeared. breathing stopped.",
    whatToShow:
      "Creator sees their name in a staged work thread, stops breathing for a beat, then slowly opens the message like it might explode.",
    howToFilm:
      "Use a staged work thread. Show the name mention, hold the breath, then open the message with extreme caution.",
    caption: "name mention activated survival mode.",
    anchor: "work",
    comedyFamily: "work_school_panic",
    emotionalSpike: "social_panic",
    setting: "desk",
    safetyNote: "Use staged work thread.",
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
    id: "W2C-001",
    hook: "exclamation point almost exposed me",
    whatToShow:
      "Creator types a fake message with an exclamation point, stares at it, deletes the exclamation, then rereads the now colder sentence.",
    howToFilm:
      "Use a fake message draft. Show the exclamation point being added, the hesitation, then the deletion and overthinking stare.",
    caption: "punctuation got too revealing.",
    anchor: "exclamation",
    comedyFamily: "texting_overthinking",
    emotionalSpike: "private_embarrassment",
    setting: "couch",
    safetyNote: "Use fake message text.",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2C-007",
    hook: "scrolling old posts to see if i was ever funny",
    whatToShow:
      "You scroll through old posts with a concerned face, occasionally doing a pity laugh at your own old joke.",
    howToFilm:
      "Use phone light on your face in a darker room. Move the phone closer like you are auditing your own personality.",
    caption: "a performance review for past me.",
    anchor: "posts",
    comedyFamily: "creator_anxiety",
    emotionalSpike: "self_critique",
    setting: "bedroom",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2C-009",
    hook: "rereading my sent email like i'm the hiring manager",
    whatToShow:
      "You open your sent folder and read your own email as if you are the person receiving it, nodding at your own wording.",
    howToFilm:
      "Over-the-shoulder at a laptop with a fake email. Mumble the serious phrases to yourself, then squint like the font might be judging you.",
    caption: "post-send professionalism audit.",
    anchor: "email",
    comedyFamily: "work_school_panic",
    emotionalSpike: "performance_panic",
    setting: "desk",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2C-013",
    hook: "seeing 'urgent' and immediately placing the phone face down",
    whatToShow:
      "A fake work notification pops up. You read the word urgent, nod once, and flip the phone over like a judge closing a case.",
    howToFilm:
      "Shoot from the phone's point of view if you can. Your face should be calm in the exact way that means absolutely not.",
    caption: "future me has been notified.",
    anchor: "urgent",
    comedyFamily: "work_school_panic",
    emotionalSpike: "avoidance_spike",
    setting: "couch",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2C-017",
    hook: "googling how to be a morning person at 2:45 a.m.",
    whatToShow:
      "You lie in bed under phone light, searching for morning-person advice at the worst possible hour.",
    howToFilm:
      "Close on your tired face and the fake search. The slow blink is the punchline; you clearly already lost tomorrow.",
    caption: "researching the person i will not become.",
    anchor: "morning",
    comedyFamily: "task_avoidance",
    emotionalSpike: "quiet_guilt",
    setting: "bedroom",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2C-022",
    hook: "one reset task became vacation proof",
    whatToShow:
      "Creator completes one tiny reset task, like wiping a counter corner, then sits down with vacation-level relief.",
    howToFilm:
      "Show the single reset task clearly. The punchline is treating that tiny task like a full life overhaul.",
    caption: "one reset task, full sabbatical.",
    anchor: "reset",
    comedyFamily: "task_avoidance",
    emotionalSpike: "false_productivity",
    setting: "living_room",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2C-026",
    hook: "“just saw this” was historical fiction",
    whatToShow:
      "Creator opens a fake old message, types “just saw this,” glances at the old timestamp, then sends the message anyway.",
    howToFilm:
      "Show the old fake message timestamp safely. Type “just saw this,” glance at the timestamp, then send the message with fake innocence.",
    caption: "just saw this, allegedly.",
    anchor: "message",
    comedyFamily: "texting_overthinking",
    emotionalSpike: "exposed_lie",
    setting: "couch",
    safetyNote: "Use fake message text.",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2C-036",
    hook: "choosing any door except the revolving one",
    whatToShow:
      "You approach a store, see the revolving door, pause, and immediately look for the normal door.",
    howToFilm:
      "Point-of-view shot of the revolving door, then cut to your face treating it like a machine built to humble you.",
    caption: "i prefer doors that don't require timing.",
    anchor: "door",
    comedyFamily: "tiny_public_private_awkwardness",
    emotionalSpike: "social_panic",
    setting: "store",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2C-037",
    hook: "starting a get-ready video and getting lost in the mirror",
    whatToShow:
      "You set up the camera and ring light, then lean into the mirror and forget the video because one tiny face detail distracted you.",
    howToFilm:
      "Keep the creator setup visible in the background. The joke is that the whole production gets abandoned for one tiny mirror inspection.",
    caption: "the tutorial lost to my pores.",
    anchor: "mirror",
    comedyFamily: "posting_anxiety",
    emotionalSpike: "time_loss",
    setting: "bathroom",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2C-040",
    hook: "desktop icons got more work than me",
    whatToShow:
      "Creator drags desktop icons into neat rows, leans back proudly, then leaves the actual work file unopened.",
    howToFilm:
      "Use a staged desktop. Show the icon organizing, the proud lean-back, and the untouched work file still sitting there.",
    caption: "desktop organized. work untouched.",
    anchor: "desktop",
    comedyFamily: "task_avoidance",
    emotionalSpike: "avoidance_spike",
    setting: "desk",
    safetyNote: "Use staged/blurred desktop.",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2C-043",
    hook: "scrubbing the sink because a deadline is chasing me",
    whatToShow:
      "You clean the sink with intense focus while the deadline sits visible on a laptop in the background.",
    howToFilm:
      "Shoot it like an action montage. The sink should look heroic, but the laptop in the background should expose the truth.",
    caption: "cleaning is just panic with supplies.",
    anchor: "sink",
    comedyFamily: "task_avoidance",
    emotionalSpike: "avoidance_spike",
    setting: "kitchen",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2C-044",
    hook: "checking my bank app after a treat-yourself weekend",
    whatToShow:
      "You open a fake bank app, cover one eye, peek at the number, and immediately regret the confidence you had yesterday.",
    howToFilm:
      "Use a fake screen only. Treat the reveal like a horror movie, but keep the reaction small: one quiet 'oh no' is enough.",
    caption: "the math came back with attitude.",
    anchor: "bank",
    comedyFamily: "adulting_panic",
    emotionalSpike: "instant_regret",
    setting: "living_room",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2C-045",
    hook: "rerecording the voice memo because my ending voice changed species",
    whatToShow:
      "You tap to record the voice memo, lean closer to hear your tone get weird at the end, swipe to cancel, then press record again with a fake calmer voice.",
    howToFilm:
      "Hold the phone like a walkie-talkie. The cancel swipe should be immediate. On take two, overcorrect your voice just enough to be funny.",
    caption: "who was speaking at the end.",
    anchor: "memo",
    comedyFamily: "texting_overthinking",
    emotionalSpike: "private_embarrassment",
    setting: "car",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2C-046",
    hook: "cleaning my glasses to see the mistake in HD",
    whatToShow:
      "You notice a mistake, take off your glasses, clean them carefully, put them back on, and realize the mistake is still there.",
    howToFilm:
      "Let the glasses cleaning be oddly serious. The punchline is putting them back on and getting the exact same bad news, but clearer.",
    caption: "clarity did not help.",
    anchor: "glasses",
    comedyFamily: "work_school_panic",
    emotionalSpike: "self_critique",
    setting: "desk",
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
    id: "W2A-049",
    hook: "eating one chip like the bag didn't hear me",
    whatToShow:
      "You take one chip, close the bag responsibly, then reopen it almost immediately.",
    howToFilm:
      "Frame the bag and your hand. Make the first close look serious. The second open should be quiet, like you're trying not to alert yourself.",
    caption: "portion control left the chat.",
    anchor: "chip",
    comedyFamily: "food_self_control",
    emotionalSpike: "self_betrayal",
    setting: "kitchen",
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
    id: "W2B-044",
    hook: "charger remembered itself at the door",
    whatToShow:
      "Creator walks to the door ready to leave, touches the handle, suddenly remembers the charger, and turns around like the movie changed genres.",
    howToFilm:
      "Frame the doorway. Show the confident exit, the hand on the handle, then the charger realization and dramatic turn.",
    caption: "charger entered the third act.",
    anchor: "charger",
    comedyFamily: "leaving_house_delay",
    emotionalSpike: "caught_off_guard",
    setting: "hallway",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2C-034",
    hook: "burying the snack wrapper like evidence",
    whatToShow:
      "You fold an empty snack wrapper into a tiny square and hide it deep in the trash under other things.",
    howToFilm:
      "Close on the burial. Look over your shoulder before you hide it, like the kitchen has witnesses.",
    caption: "if no one sees it, calories become folklore.",
    anchor: "wrapper",
    comedyFamily: "food_self_control",
    emotionalSpike: "quiet_guilt",
    setting: "kitchen",
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
    comedyFamily: "food_self_control",
    emotionalSpike: "self_betrayal",
    setting: "kitchen",
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
    comedyFamily: "texting_overthinking",
    emotionalSpike: "overprepared_panic",
    setting: "bedroom",
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
    comedyFamily: "leaving_house_delay",
    emotionalSpike: "quiet_realization",
    setting: "bedroom",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
  {
    id: "W2A-006",
    hook: "rehearsing a casual reply and still sounding insane",
    whatToShow:
      "You sit on the bed rehearsing a casual reply out loud, say “yeah, sounds good” normally, then type a casual reply that somehow sounds weirdly formal anyway.",
    howToFilm:
      "Film it like a tiny audition. Rehearse the casual reply out loud, then show the casual typed reply and the face that knows it got weird.",
    caption: "why did i become customer service.",
    anchor: "casual",
    comedyFamily: "texting_overthinking",
    emotionalSpike: "self_critique",
    setting: "bedroom",
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
    comedyFamily: "procrastination",
    emotionalSpike: "false_productivity",
    setting: "bedroom",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
  {
    id: "W2A-010",
    hook: "checking one notification and losing the entire plot",
    whatToShow:
      "You tap the notification, open the app, scroll for forty seconds, and lose all memory of why you picked the phone up in the first place.",
    howToFilm:
      "Start with a clear mission: one notification. Then jump cut through two or three tiny phone movements until you're completely somewhere else. End with you looking confused at your own screen.",
    caption: "i left to get one thing and came back a different person.",
    anchor: "notification",
    comedyFamily: "phone_distraction",
    emotionalSpike: "self_betrayal",
    setting: "desk",
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
    comedyFamily: "tiny_public_private_awkwardness",
    emotionalSpike: "confused_pause",
    setting: "home",
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
    comedyFamily: "texting_overthinking",
    emotionalSpike: "quiet_guilt",
    setting: "bedroom",
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
    comedyFamily: "work_school_panic",
    emotionalSpike: "avoidance_spike",
    setting: "desk",
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
    comedyFamily: "task_avoidance",
    emotionalSpike: "self_betrayal",
    setting: "desk",
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
    comedyFamily: "texting_overthinking",
    emotionalSpike: "polite_rage",
    setting: "bedroom",
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
    comedyFamily: "adulting_panic",
    emotionalSpike: "financial_dread",
    setting: "bedroom",
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
    comedyFamily: "self_control",
    emotionalSpike: "instant_regret",
    setting: "bedroom",
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
    comedyFamily: "social_plans",
    emotionalSpike: "instant_regret",
    setting: "bedroom",
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
    comedyFamily: "leaving_house_delay",
    emotionalSpike: "excuse_found",
    setting: "bedroom",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
  {
    id: "W2A-036",
    hook: "setting a timer and then negotiating with it",
    whatToShow:
      "You tap the timer to start a focus block, sit down at the desk, then immediately press pause because you 'need one thing' first.",
    howToFilm:
      "Show the timer starting like a serious commitment. Then show your finger hovering over pause way too soon. The guilt is the whole joke.",
    caption: "the timer met my personality.",
    anchor: "timer",
    comedyFamily: "task_avoidance",
    emotionalSpike: "self_betrayal",
    setting: "desk",
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
    comedyFamily: "task_avoidance",
    emotionalSpike: "quiet_guilt",
    setting: "bedroom",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
  {
    id: "W2A-040",
    hook: "checking the mirror for confidence and leaving with questions",
    whatToShow:
      "You stand at the mirror, adjust the outfit, lean in to fix one tiny thing, then squint at another and slowly unravel.",
    howToFilm:
      "Use a mirror angle but keep it casual. The first look should be approving. Then one adjustment turns into five. End before it gets too polished.",
    caption: "the mirror opened a case.",
    anchor: "mirror",
    comedyFamily: "getting_ready",
    emotionalSpike: "self_doubt_spike",
    setting: "bedroom",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
  {
    id: "W2A-041",
    hook: "muting the call and becoming a completely different person",
    whatToShow:
      "You speak professionally on a call, hit mute, then instantly become a different person: eating, stretching, or staring into space.",
    howToFilm:
      "Frame the laptop call from the side. The mute click is the switch. Show professional call-you first, then muted-you eating, stretching, or staring into space.",
    caption: "mute is my real personality.",
    anchor: "mute",
    comedyFamily: "work_school_panic",
    emotionalSpike: "mask_drop",
    setting: "desk",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
  {
    id: "W2A-043",
    hook: "rewatching my own video like i'm investigating a crime",
    whatToShow:
      "You open the video, tap pause on a weird face, lean in to squint at it, and reconsider posting.",
    howToFilm:
      "Use a fake clip or your camera roll blurred. The zoom-in is the punchline. React like you found evidence against yourself.",
    caption: "editor, detective, victim.",
    anchor: "video",
    comedyFamily: "creator_anxiety",
    emotionalSpike: "private_embarrassment",
    setting: "bedroom",
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
    comedyFamily: "texting_overthinking",
    emotionalSpike: "social_panic",
    setting: "bedroom",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
  {
    id: "W2A-046",
    hook: "9:03 made the day unusable",
    whatToShow:
      "Creator looks at the clock at 9:03, sees the planned 9:00 start time on a note, then closes the laptop like the day is ruined.",
    howToFilm:
      "Show the planned start note, then the 9:03 clock. The joke is treating three minutes like a total collapse.",
    caption: "9:03 ruined the department.",
    anchor: "start",
    comedyFamily: "task_avoidance",
    emotionalSpike: "excuse_found",
    setting: "desk",
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
    comedyFamily: "social_plans",
    emotionalSpike: "instant_regret",
    setting: "bedroom",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
      },
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
    emotionalSpike: "overprepared_panic",
    setting: "bedroom",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2B-007",
    hook: "screenshotting one reply for a full investigation",
    whatToShow:
      "You tap screenshot on a short fake reply, lean in to zoom on one word, and stare at it like it is evidence.",
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
    id: "W2B-011",
    hook: "taking twelve story selfies to look effortless",
    whatToShow:
      "You keep taking story selfies, checking each one, deleting it, then taking another like effortless somehow needs twelve attempts.",
    howToFilm:
      "Use a bathroom mirror or window light. Let the repetition build: selfie, check, delete, selfie again. End with the tired face.",
    caption: "effortless took twelve tries.",
    anchor: "taking",
    comedyFamily: "creator_anxiety",
    emotionalSpike: "self_critique",
    setting: "bathroom",
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
    id: "W2C-002",
    hook: "watching my own story four times like i'm quality control",
    whatToShow:
      "You lie on the bed replaying your own story again and again, judging every tiny facial movement.",
    howToFilm:
      "Start wide so it feels a little pathetic, then cut closer to your eyes tracking the replay bar. The fourth replay should feel like an investigation.",
    caption: "viewer number one has notes.",
    anchor: "story",
    comedyFamily: "posting_anxiety",
    emotionalSpike: "self_critique",
    setting: "bedroom",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2C-004",
    hook: "closing the laptop after one minor inconvenience",
    whatToShow:
      "A tiny error or confusing email appears. You stare for two seconds, then slowly close the laptop like the workday has legally ended.",
    howToFilm:
      "Keep the camera steady on your face. The laptop close should be slow and ceremonial, like you are respecting a moment of silence.",
    caption: "the universe sent a sign and i obeyed.",
    anchor: "laptop",
    comedyFamily: "work_school_panic",
    emotionalSpike: "avoidance_spike",
    setting: "desk",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2C-006",
    hook: "checking the delivery map like i'm tracking a fugitive",
    whatToShow:
      "You open the delivery app, lean in to zoom on the tiny car icon, and whisper at it like your driver can hear you.",
    howToFilm:
      "Show a fake or blurred map first, then cut to you peeking through the blinds like this is a stakeout. Keep it serious.",
    caption: "two minutes away has never felt so personal.",
    anchor: "delivery",
    comedyFamily: "food_self_control",
    emotionalSpike: "overprepared_panic",
    setting: "living_room",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2C-010",
    hook: "putting on one shoe and losing all momentum",
    whatToShow:
      "One shoe is tied, the other is still in your hand, and you are sitting on the bed staring into space.",
    howToFilm:
      "Start close on the tied shoe, then tilt up to reveal you completely frozen. Let the half-ready outfit tell the joke.",
    caption: "50% ready, 100% unavailable.",
    anchor: "shoe",
    comedyFamily: "leaving_house_delay",
    emotionalSpike: "time_loss",
    setting: "bedroom",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2C-011",
    hook: "hiding my phone like i'm not allowed to exist",
    whatToShow:
      "You are scrolling, hear footsteps, shove the phone under a pillow, then pretend to be doing something painfully innocent.",
    howToFilm:
      "Use a wide shot so the panic move is obvious. The fake activity should be awkwardly unconvincing, like holding a book upside down.",
    caption: "nothing suspicious, just suddenly literate.",
    anchor: "phone",
    comedyFamily: "tiny_public_private_awkwardness",
    emotionalSpike: "caught_off_guard",
    setting: "living_room",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2C-014",
    hook: "studying the menu for twenty minutes and ordering my usual",
    whatToShow:
      "You scroll a menu with deep focus, act interested in new options, then order the same thing you always get.",
    howToFilm:
      "Make the menu research look intense. Then cut hard to the most boring familiar order, said with total peace.",
    caption: "i like the illusion of range.",
    anchor: "menu",
    comedyFamily: "food_self_control",
    emotionalSpike: "decision_avoidance",
    setting: "car",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2C-015",
    hook: "checking who's active so i know who i'm avoiding",
    whatToShow:
      "You open a fake DM list, see active indicators, and physically move the phone away like it got hot.",
    howToFilm:
      "Keep the screen fake or blurred and focus on your face. Every green dot should make you retreat a little more.",
    caption: "visibility is a threat.",
    anchor: "active",
    comedyFamily: "texting_overthinking",
    emotionalSpike: "social_panic",
    setting: "bedroom",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2C-016",
    hook: "filming a day-in-the-life and quitting before lunch",
    whatToShow:
      "You start filming a day-in-the-life with morning coffee, one desk shot, and a hopeful angle, then stop before lunch and stare at the unfinished clips.",
    howToFilm:
      "Show the first few day-in-the-life clips quickly, then reveal the empty afternoon. The joke is the documentary ending before lunch.",
    caption: "day in the life ended at 10:42.",
    anchor: "filming",
    comedyFamily: "posting_anxiety",
    emotionalSpike: "self_betrayal",
    setting: "living_room",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2C-018",
    hook: "rereading my text like evidence",
    whatToShow:
      "Creator rereads a fake sent text, squints at the wording, tilts the phone, then whispers “why did I say it like that?”",
    howToFilm:
      "Use a staged sent text. Keep it small and real: reread, squint, tilt the phone, and let the regret show.",
    caption: "vibe audit failed.",
    anchor: "text",
    comedyFamily: "texting_overthinking",
    emotionalSpike: "self_critique",
    setting: "living_room",
    safetyNote: "Use fake text.",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2C-020",
    hook: "walking laps because i can't choose which chore to avoid",
    whatToShow:
      "You walk laps around the room, passing laundry, dishes, and a trash bag without touching any of them because choosing one chore would make it real.",
    howToFilm:
      "Shoot the walking loop from one corner. Walk past the laundry, dishes, and trash bag without touching them, then keep walking like movement counts as progress.",
    caption: "walking counted as a decision.",
    anchor: "walk",
    comedyFamily: "task_avoidance",
    emotionalSpike: "decision_avoidance",
    setting: "hallway",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2C-021",
    hook: "deleting the draft because perfect or nothing apparently",
    whatToShow:
      "You reread a draft, make one disgusted face, select everything, and delete it with dramatic finality.",
    howToFilm:
      "Close on the delete/backspace moment, then cut to your face looking both powerful and deeply sad.",
    caption: "creative process, but hostile.",
    anchor: "draft",
    comedyFamily: "posting_anxiety",
    emotionalSpike: "self_critique",
    setting: "desk",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2C-023",
    hook: "checking my drafts like a graveyard of confidence",
    whatToShow:
      "You open your drafts, scroll through the half-finished videos, wince at old ideas, and quietly close the app.",
    howToFilm:
      "Use dramatic low light if you want. Scroll slowly, like each draft is a past version of you asking for forgiveness.",
    caption: "some drafts are buried for a reason.",
    anchor: "drafts",
    comedyFamily: "creator_anxiety",
    emotionalSpike: "private_embarrassment",
    setting: "bedroom",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2C-024",
    hook: "reading the instructions again and becoming less informed",
    whatToShow:
      "You trace the instructions with your finger, mouth the words, then stare blankly like your brain rejected the file.",
    howToFilm:
      "Show the paper or fake screen first, then cut to your face completely empty. The silence should feel too long.",
    caption: "comprehension has left the chat.",
    anchor: "instructions",
    comedyFamily: "work_school_panic",
    emotionalSpike: "performance_panic",
    setting: "desk",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2C-025",
    hook: "standing in the fridge light waiting for dinner to appear",
    whatToShow:
      "You stand in front of the open fridge, looking from milk to mustard to leftovers like a meal might assemble itself.",
    howToFilm:
      "Shoot from inside the fridge if possible. Hold on your hopeful face for one beat too long, then close the door disappointed.",
    caption: "waiting for ingredients to unionize.",
    anchor: "fridge",
    comedyFamily: "food_self_control",
    emotionalSpike: "decision_avoidance",
    setting: "kitchen",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2C-027",
    hook: "putting my phone away and visiting it four minutes later",
    whatToShow:
      "You bravely leave your phone in another room, sit down to work, then immediately invent a reason to go check it.",
    howToFilm:
      "Film it like a tiny heist. The first walk away should feel proud; the return should feel sneaky and pathetic.",
    caption: "i failed as my own security guard.",
    anchor: "phone",
    comedyFamily: "phone_distraction",
    emotionalSpike: "self_betrayal",
    setting: "living_room",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  {
    id: "W2C-030",
    hook: "hovering over send like it's a detonator",
    whatToShow:
      "Your finger hovers just above the send button on a risky fake text while you breathe like a bomb squad intern.",
    howToFilm:
      "Extreme close-up on the finger. Build the tension, then cut immediately after the tap to you tossing the phone away.",
    caption: "once it sends, i belong to fate.",
    anchor: "send",
    comedyFamily: "texting_overthinking",
    emotionalSpike: "social_panic",
    setting: "bedroom",
    reviewedBy: PENDING_EDITORIAL_REVIEW,
        },
  ]);

  /**
   * PHASE W2-L / W2-N — public approved-pool exports concatenate the
   * W2-I draft-promotion ids/candidates with the W2-L and W2-N
   * curated batches. The W2-I block stays at the head of the array so
   * the W2-D rubric ordering is preserved (the slot reservation walks
   * the pool in order when scores tie). The W2-L block carries ids
   * `w2_next_NNN`; the W2-N block carries ids `w2_next2_NNN`. Both
   * are verified against the draft via the relaxed integrity check
   * below — entries here do NOT live in `WESTERN_HOOK_PACK_DRAFT`,
   * they live in `WESTERN_HOOK_PACK_BATCH_NEXT` and
   * `WESTERN_HOOK_PACK_BATCH_NEXT2` respectively.
   */
  export const APPROVED_WESTERN_PROMOTION_IDS: readonly string[] = Object.freeze([
    ...W2I_DRAFT_PROMOTION_IDS,
    ...WESTERN_HOOK_PACK_BATCH_NEXT_IDS,
    ...WESTERN_HOOK_PACK_BATCH_NEXT2_IDS,
  ]);

  export const APPROVED_WESTERN_PROMOTION_CANDIDATES: readonly WesternHookPackDraftEntry[] = Object.freeze([
    ...W2I_DRAFT_PROMOTION_CANDIDATES,
    ...WESTERN_HOOK_PACK_BATCH_NEXT,
    ...WESTERN_HOOK_PACK_BATCH_NEXT2,
  ]);

  /**
   * Lightweight integrity assertion for the approved pool. NOT called
   * at module load; invoked by the dedicated unit test and reusable
   * by any future activation path that wants a runtime guard.
   *
   * Returns `{ ok: true }` when:
   *   - count is exactly 300 (W2-I draft promotion 100 + W2-L 100 + W2-N 100)
   *   - every approved id exists in `WESTERN_HOOK_PACK_DRAFT`
   *     OR in `WESTERN_HOOK_PACK_BATCH_NEXT` (W2-L)
   *     OR in `WESTERN_HOOK_PACK_BATCH_NEXT2` (W2-N)
   *   - the underlying draft passes `checkWesternHookPackDraftIntegrity`
   *   - no duplicate hook strings inside the approved pool
   *   - every approved row carries `PENDING_EDITORIAL_REVIEW`
   *
   * Returns `{ ok: false, failures: [...] }` otherwise.
   */
  export function checkApprovedWesternPromotionPoolIntegrity(): {
    readonly ok: boolean;
    readonly failures: readonly string[];
  } {
    const failures: string[] = [];

    if (APPROVED_WESTERN_PROMOTION_CANDIDATES.length !== 300) {
      failures.push(
        `approved_count_must_be_300 (got ${APPROVED_WESTERN_PROMOTION_CANDIDATES.length})`,
      );
    }

    const draftIds = new Set(WESTERN_HOOK_PACK_DRAFT.map((e) => e.id));
    const batchNextIds = new Set(WESTERN_HOOK_PACK_BATCH_NEXT.map((e) => e.id));
    const batchNext2Ids = new Set(
      WESTERN_HOOK_PACK_BATCH_NEXT2.map((e) => e.id),
    );
    for (const e of APPROVED_WESTERN_PROMOTION_CANDIDATES) {
      if (
        !draftIds.has(e.id) &&
        !batchNextIds.has(e.id) &&
        !batchNext2Ids.has(e.id)
      ) {
        failures.push(`approved_id_not_in_draft_or_batch_next:${e.id}`);
      }
      if (e.reviewedBy !== PENDING_EDITORIAL_REVIEW) {
        failures.push(`approved_reviewedBy_must_be_pending:${e.id}`);
      }
    }

    const draftCheck = checkWesternHookPackDraftIntegrity(WESTERN_HOOK_PACK_DRAFT);
    if (!draftCheck.ok) {
      for (const f of draftCheck.failures) {
        failures.push(`underlying_draft_failure:${f}`);
      }
    }

    // PHASE W2-L — run the SAME draft-level invariants on the curated
    // batch source. The batch lives in a separate constant so the
    // draft integrity above does not cover it; without this check the
    // relaxed `DRAFT_IDS ∪ BATCH_NEXT_IDS` membership rule would
    // weaken our previous invariant coverage (length bands, anchor
    // shape, vocab membership, weak-skeleton patterns, etc.).
    const batchNextCheck = checkWesternHookPackDraftIntegrity(
      WESTERN_HOOK_PACK_BATCH_NEXT,
    );
    if (!batchNextCheck.ok) {
      for (const f of batchNextCheck.failures) {
        failures.push(`underlying_batch_next_failure:${f}`);
      }
    }

    // PHASE W2-N — same treatment for the W2-BATCH-NEXT-2 source.
    const batchNext2Check = checkWesternHookPackDraftIntegrity(
      WESTERN_HOOK_PACK_BATCH_NEXT2,
    );
    if (!batchNext2Check.ok) {
      for (const f of batchNext2Check.failures) {
        failures.push(`underlying_batch_next2_failure:${f}`);
      }
    }

    const seenHooks = new Set<string>();
    for (const e of APPROVED_WESTERN_PROMOTION_CANDIDATES) {
      if (seenHooks.has(e.hook)) {
        failures.push(`duplicate_approved_hook:${e.id}`);
      }
      seenHooks.add(e.hook);
    }

    return { ok: failures.length === 0, failures };
  }
  