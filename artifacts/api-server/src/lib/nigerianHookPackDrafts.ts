/**
 * PHASE N1 — DRAFT BATCH A (100 candidate Nigerian comedy entries)
 *
 * These are DRAFT/CANDIDATE entries imported for Nigerian native-speaker
 * review. They are NOT approved, NOT activated, and CANNOT activate the
 * pack by construction:
 *
 *   1. They live in `DRAFT_NIGERIAN_HOOK_PACK` — a SEPARATE constant
 *      from the production `NIGERIAN_HOOK_PACK` (which remains
 *      `Object.freeze([])`).
 *   2. Every entry's `reviewedBy` is the literal sentinel
 *      `PENDING_NATIVE_REVIEW`. The production
 *      `assertNigerianPackIntegrity` rejects this exact value
 *      indirectly via its non-empty check + the explicit refusal
 *      below — drafts cannot be moved into `NIGERIAN_HOOK_PACK`
 *      without a reviewer overwriting the stamp.
 *   3. `getEligibleNigerianPackEntries` throws at runtime if anyone
 *      passes `DRAFT_NIGERIAN_HOOK_PACK` as the `pool` argument
 *      (cheap reference check). Defense in depth.
 *   4. The activation guard (`canActivateNigerianPack`) requires
 *      `packLength > 0` of the LIVE pack. Even if a future caller
 *      forgets to pass the live pack, the guard does not know about
 *      DRAFT and therefore cannot select from it.
 *
 * What the draft assert ENFORCES:
 *   - All 8 atomic fields are present and non-empty
 *   - Field length bands match `ideaSchema` (same as production)
 *   - `pidginLevel` is one of `clean | light_pidgin | pidgin`
 *     (drafts allow `clean` because the source corpus mixes Clean
 *     Nigerian English with Pidgin tiers; only Pidgin tiers are
 *     ever activation-eligible — `clean` entries are stored for
 *     reviewer triage but cannot enter the live pack as-is)
 *   - `reviewedBy === PENDING_NATIVE_REVIEW` (exact sentinel)
 *   - `cluster` is a non-empty snake_case token
 *
 * What the draft assert intentionally SKIPS (these are the human
 * reviewer's responsibility — enforcing them automatically would
 * silently filter authentic Pidgin):
 *   - Anchor must appear in hook AND whatToShow. Many draft hooks
 *     and scenarios use different content tokens; the reviewer
 *     picks the final anchor when promoting an entry.
 *   - The mocking-spelling regex on the production assert. The
 *     production regex's `\b(abe+g+|waha+la+)\b` pattern
 *     false-positives on the legitimate Pidgin words "abeg" and
 *     "wahala" (it was meant to catch cartoonish stretching like
 *     "abeeeeg" but `+` matches 1+). For drafts we trust the
 *     reviewer to flag actual mocking; for the production assert
 *     we leave the existing regex untouched (per "do not weaken
 *     boot asserts for activated entries"). When the first real
 *     entry is promoted, the production regex must be tightened
 *     in the SAME PR — `assertNigerianPackIntegrity` will trip on
 *     authentic Pidgin until that fix lands.
 */

import {
  registerDraftPoolReference,
  type NigerianPackEntry,
} from "./nigerianHookPack.js";

export const PENDING_NATIVE_REVIEW = "PENDING_NATIVE_REVIEW" as const;

export type DraftNigerianPackEntry = Omit<
  NigerianPackEntry,
  "pidginLevel" | "reviewedBy"
> & {
  /** Drafts allow `clean` as a tier so the reviewer can triage Clean
   *  Nigerian English candidates that arrived in the same source
   *  corpus. Only `light_pidgin` / `pidgin` entries can ever be
   *  activation-eligible (the production type forbids `clean`). */
  readonly pidginLevel: "clean" | "light_pidgin" | "pidgin";
  /** Reviewer stamp. Either the legacy `PENDING_NATIVE_REVIEW`
   *  sentinel (for unreviewed entries) OR a real reviewer
   *  identifier such as `BI 2026-05-06`. The draft assert below
   *  applies the same rules as production: non-empty, NOT the
   *  `AGENT-PROPOSED…` prefix. The `PENDING_NATIVE_REVIEW`
   *  sentinel is still accepted at the draft layer because the
   *  PRODUCTION assert (the only one that gates activation)
   *  rejects it — drafts can carry it for triage without
   *  ever entering the live pack. */
  readonly reviewedBy: string;
  /** Free-form cluster label sourced from the bracketed style header
   *  (e.g. `whatsapp`, `transport`, `bank_alert`). Snake_case. */
  readonly cluster: string;
  /** Optional reviewer note — e.g. "use fake screenshots, never
   *  real chats". Surfaces in the QA harness when reviewing. */
  readonly privacyNote?: string;
};

const PHONE_FILM = "Phone-level lock-off, soft daylight, one take.";
const MIRROR_FILM = "Mirror lock-off, face out of frame, one take.";
const BED_FILM = "Bed-level handheld, low angle, one take.";
const DOOR_FILM = "Door-side handheld, mid-shot, one take.";
const DESK_FILM = "Desk-height lock-off, soft daylight, one take.";
const KITCHEN_FILM = "Counter-level lock-off, daylight, one take.";
const COUCH_FILM = "Couch-level handheld, mid-shot, one take.";

const FAKE_CHAT_NOTE =
  "Use fake screenshots / mock chats only; never real contacts.";
const FAKE_BANK_NOTE =
  "Use fake bank-alert mock; never a real account screen.";

export const DRAFT_NIGERIAN_HOOK_PACK: readonly DraftNigerianPackEntry[] =
  Object.freeze([
    // ─── 1–10  Messaging / WhatsApp / group chat ──────────────────
    {
      hook: "who send me make I tell them say I dey come?",
      whatToShow:
        "Show a fake WhatsApp group plan from yesterday. Someone texts 'you don dey road?' while you are still under the blanket. Your hand hovers over the keyboard, types 'almost there,' then deletes it.",
      howToFilm: BED_FILM,
      caption: "yesterday me too get mind.",
      anchor: "dey",
      domain: "messaging",
      cluster: "whatsapp",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "yesterday me joined the plan, today me is looking for network excuse",
      whatToShow:
        "Open a fake group chat where everyone is confirming the outing. You switch off your phone screen, turn it back on, and stare like the message became a court case.",
      howToFilm: PHONE_FILM,
      caption: "plans are easier when they are not today.",
      anchor: "plan",
      domain: "messaging",
      cluster: "whatsapp",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "the group chat said \"we move\" and my body said \"we where?\"",
      whatToShow:
        "Show a fake group chat popping off. You sit on the bed fully dressed except for slippers, then slowly remove one shoe like the outing has been cancelled by your spirit.",
      howToFilm: BED_FILM,
      caption: "my outfit attended more than me.",
      anchor: "move",
      domain: "messaging",
      cluster: "group_chat",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "one \"are you around?\" and my peace packed its load",
      whatToShow:
        "Phone buzzes beside you. The preview says 'are you around?' You stare at it, flip the phone face down, then immediately flip it back because curiosity won.",
      howToFilm: PHONE_FILM,
      caption: "availability is a dangerous rumor.",
      anchor: "phone",
      domain: "messaging",
      cluster: "whatsapp",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "I opened the message and immediately needed rest",
      whatToShow:
        "Show a fake WhatsApp preview with a long paragraph. You open it, scroll once, close the app, and put the phone under a pillow like it needs detention.",
      howToFilm: BED_FILM,
      caption: "if it is more than three lines, I need prayer.",
      anchor: "message",
      domain: "messaging",
      cluster: "messages",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "omo, this group chat don turn assignment",
      whatToShow:
        "Fake group chat shows five people tagging you. You type one reply, delete it, then just send a thumbs-up emoji and look away like that solved governance.",
      howToFilm: PHONE_FILM,
      caption: "leadership by emoji.",
      anchor: "group",
      domain: "messaging",
      cluster: "group_chat",
      pidginLevel: "pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "my phone buzzed like it had bad news from my ancestors",
      whatToShow:
        "Phone vibrates on the table. You lean in, see a fake message preview, then slowly push the phone away with one finger.",
      howToFilm: DESK_FILM,
      caption: "I respect my peace from a distance.",
      anchor: "phone",
      domain: "messaging",
      cluster: "messages",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "I said \"no wahala\" before I understood the wahala",
      whatToShow:
        "Show a fake chat where someone explains the plan in detail after you already replied 'no wahala.' You stare, then scroll back to your own message like you betrayed yourself.",
      howToFilm: PHONE_FILM,
      caption: "reading before replying is self-care.",
      anchor: "wahala",
      domain: "messaging",
      cluster: "whatsapp",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "the group chat made one simple plan feel like a national meeting",
      whatToShow:
        "Fake chat shows people arguing over time, location, and who is bringing what. You silently change the chat notification to mute.",
      howToFilm: PHONE_FILM,
      caption: "democracy has entered the outing.",
      anchor: "chat",
      domain: "messaging",
      cluster: "group_chat",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "my \"almost there\" is still at home charging phone",
      whatToShow:
        "Show a fake message typed: 'almost there.' Cut to your hand plugging in the phone while you are clearly still at home.",
      howToFilm: PHONE_FILM,
      caption: "location: emotionally on the way.",
      anchor: "phone",
      domain: "messaging",
      cluster: "messages",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    // ─── 11–20  Movement / transport / going out ──────────────────
    {
      hook: "I calculated transport fare and suddenly became indoor person",
      whatToShow:
        "Show notes app with a fake transport budget. You add the numbers, pause, then slowly change your clothes back to house clothes.",
      howToFilm: PHONE_FILM,
      caption: "outside is now a subscription.",
      anchor: "transport",
      domain: "movement",
      cluster: "transport",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "the outing was cute until movement entered the conversation",
      whatToShow:
        "Open a fake plan on your phone. Cut to your shoes by the door. You look at the shoes, look at the couch, and choose peace.",
      howToFilm: COUCH_FILM,
      caption: "the couch made a stronger argument.",
      anchor: "shoes",
      domain: "movement",
      cluster: "going_out",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "my energy left before the danfo even moved",
      whatToShow:
        "Show yourself holding a bag near the door. A fake 'traffic is mad' message appears. You slowly drop the bag and sit down.",
      howToFilm: DOOR_FILM,
      caption: "journey cancelled by imagination.",
      anchor: "danfo",
      domain: "movement",
      cluster: "danfo",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "one small errand turned into a full character test",
      whatToShow:
        "Show a short errand list. You pick up keys, then notice three more tasks added underneath. You drop the keys back on the table.",
      howToFilm: DESK_FILM,
      caption: "errands multiply when they smell confidence.",
      anchor: "keys",
      domain: "movement",
      cluster: "errand",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I dressed up and my motivation resigned",
      whatToShow:
        "Mirror shot without showing full face. You adjust your outfit, then sit on the bed 'for one second.' Cut to you still sitting there.",
      howToFilm: MIRROR_FILM,
      caption: "outfit ready. person pending.",
      anchor: "outfit",
      domain: "movement",
      cluster: "going_out",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I opened maps and the distance humbled my confidence",
      whatToShow:
        "Show a fake maps screen with a long travel time. Your hand closes the app, then opens food delivery instead.",
      howToFilm: PHONE_FILM,
      caption: "distance changed the whole personality.",
      anchor: "maps",
      domain: "movement",
      cluster: "transport",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "they said \"just come small\" like movement is free",
      whatToShow:
        "Fake chat says 'just come small.' You show your wallet, your shoes, then the bed. The bed wins.",
      howToFilm: BED_FILM,
      caption: "\"small\" has transport cost.",
      anchor: "small",
      domain: "movement",
      cluster: "social_plan",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "my body reached the door and remembered it has rights",
      whatToShow:
        "Camera on the door. You reach for the handle, freeze, then slowly step backward without breaking eye contact with the door.",
      howToFilm: DOOR_FILM,
      caption: "the door and I are negotiating.",
      anchor: "door",
      domain: "movement",
      cluster: "leaving_home",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I said I'd go outside and outside heard me",
      whatToShow:
        "You pick up your keys, hear a fake notification about traffic/rain/long queue, and gently put the keys back like they are fragile.",
      howToFilm: DESK_FILM,
      caption: "outside responded too fast.",
      anchor: "keys",
      domain: "movement",
      cluster: "errand",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "the plan was fun until logistics showed up",
      whatToShow:
        "Show a fake plan, then a notes app with time, fare, outfit, and return trip. You delete the whole note.",
      howToFilm: PHONE_FILM,
      caption: "logistics is where enjoyment goes to fight.",
      anchor: "plan",
      domain: "movement",
      cluster: "movement",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    // ─── 21–30  Phone / data / power ─────────────────────────────
    {
      hook: "my data saw one video and started crying",
      whatToShow:
        "Show a fake data warning screen. You pause a video, stare at the phone, then lower the brightness like that will help.",
      howToFilm: PHONE_FILM,
      caption: "data has trust issues.",
      anchor: "data",
      domain: "phone",
      cluster: "data",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "one low battery warning changed the whole day's plan",
      whatToShow:
        "Phone shows fake 5% battery. You unplug a charger from across the room, realize it is too short, and sit on the floor beside the socket.",
      howToFilm: PHONE_FILM,
      caption: "location chosen by battery percentage.",
      anchor: "battery",
      domain: "phone",
      cluster: "phone",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "the light blinked once and my productivity packed bag",
      whatToShow:
        "Laptop open. The room light flickers. You freeze, save the document aggressively, then stare at the socket like it owes you stability.",
      howToFilm: DESK_FILM,
      caption: "productivity needs electricity and emotional support.",
      anchor: "light",
      domain: "phone",
      cluster: "power",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "the generator sound reminded me that peace is expensive",
      whatToShow:
        "You sit down to rest. A generator hum starts outside. You slowly put on earphones without playing music.",
      howToFilm: COUCH_FILM,
      caption: "noise-cancelling by faith.",
      anchor: "generator",
      domain: "phone",
      cluster: "generator",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I said \"just one TikTok\" and my data said goodbye",
      whatToShow:
        "Show fake data balance before and after one scroll. Your hand hovers over 'buy data,' then closes the app like that will reverse time.",
      howToFilm: PHONE_FILM,
      caption: "one video, one financial decision.",
      anchor: "data",
      domain: "phone",
      cluster: "data",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "my phone battery judged my lifestyle before anyone else could",
      whatToShow:
        "Show phone at 2%. You look at the charger across the room, then choose to reduce brightness instead.",
      howToFilm: PHONE_FILM,
      caption: "denial mode activated.",
      anchor: "battery",
      domain: "phone",
      cluster: "phone",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I planned to work, then light said \"not today\"",
      whatToShow:
        "Laptop open, notes ready. The screen goes dim. You slowly close the laptop and pick up your phone like the meeting has ended.",
      howToFilm: DESK_FILM,
      caption: "agenda cancelled by electricity.",
      anchor: "light",
      domain: "phone",
      cluster: "power",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "my hotspot became a family responsibility",
      whatToShow:
        "Show a fake message: 'please on hotspot small.' You look at your data balance, then slowly turn your phone face down.",
      howToFilm: PHONE_FILM,
      caption: "generosity has megabytes.",
      anchor: "hotspot",
      domain: "phone",
      cluster: "phone_data",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "I sat beside socket like it was my office",
      whatToShow:
        "Phone charging with a short cable. You sit awkwardly on the floor, trying to scroll comfortably.",
      howToFilm: PHONE_FILM,
      caption: "furniture by charger length.",
      anchor: "socket",
      domain: "phone",
      cluster: "charging",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "one notification ruined the peace I was managing",
      whatToShow:
        "Phone lights up beside a cup or pillow. You ignore it for two seconds, then grab it like peace was only a suggestion.",
      howToFilm: PHONE_FILM,
      caption: "peace lost by preview.",
      anchor: "notification",
      domain: "phone",
      cluster: "notification",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    // ─── 31–40  Food / home / roommate ───────────────────────────
    {
      hook: "I opened the pot and understood why nobody was smiling",
      whatToShow:
        "Open a pot, look inside, close it slowly, then open a snack cupboard like you are switching departments.",
      howToFilm: KITCHEN_FILM,
      caption: "kitchen update: faith required.",
      anchor: "pot",
      domain: "home",
      cluster: "food",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "the fridge said I should stop pretending I cook",
      whatToShow:
        "Open the fridge, stare at ingredients, close it, then open a delivery app or grab biscuits.",
      howToFilm: KITCHEN_FILM,
      caption: "the fridge knows the truth.",
      anchor: "fridge",
      domain: "home",
      cluster: "food",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "one spoon of jollof and my discipline left the group",
      whatToShow:
        "Show plate or pot. You take one spoon 'just to taste,' pause, then come back with a bigger spoon.",
      howToFilm: KITCHEN_FILM,
      caption: "tasting committee became main consumer.",
      anchor: "jollof",
      domain: "home",
      cluster: "jollof",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "the shared fridge turned trust into a social experiment",
      whatToShow:
        "Open fridge, see your labeled item missing or moved. You close it, reopen it, then stare like evidence might appear.",
      howToFilm: KITCHEN_FILM,
      caption: "roommate science is not for the weak.",
      anchor: "fridge",
      domain: "home",
      cluster: "roommate",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I said I'd clean small and the room laughed",
      whatToShow:
        "Show one item on the floor. You pick it up and reveal a bigger mess underneath. You put it back like the room has structure.",
      howToFilm: BED_FILM,
      caption: "organization by denial.",
      anchor: "room",
      domain: "home",
      cluster: "home",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "my midnight hunger started negotiating with my future self",
      whatToShow:
        "Show dark kitchen/fridge light. You reach for food, pause, check time, then still take it.",
      howToFilm: KITCHEN_FILM,
      caption: "future me can explain.",
      anchor: "fridge",
      domain: "home",
      cluster: "food",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "the stew finished but nobody wanted to announce it",
      whatToShow:
        "Open a pot, scrape the bottom with spoon, then look around like the household has betrayed you.",
      howToFilm: KITCHEN_FILM,
      caption: "silence after stew is suspicious.",
      anchor: "pot",
      domain: "home",
      cluster: "kitchen",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "laundry waited quietly until I made weekend plans",
      whatToShow:
        "Show laundry basket. Then show a fake outing message. You look between both, then push laundry slightly out of frame.",
      howToFilm: BED_FILM,
      caption: "if I can't see it, it's not urgent.",
      anchor: "laundry",
      domain: "home",
      cluster: "home",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I bought snacks for the week and finished peace in one night",
      whatToShow:
        "Show a full snack bag, then cut to empty wrappers. Your hand folds the bag like evidence.",
      howToFilm: COUCH_FILM,
      caption: "weekly plan lasted one episode.",
      anchor: "snacks",
      domain: "home",
      cluster: "snacks",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "the house chore found me even after I changed location",
      whatToShow:
        "Move from bedroom to couch. A broom, plate, or laundry basket appears in the new frame. You look at it like it followed you.",
      howToFilm: COUCH_FILM,
      caption: "chores have tracking device.",
      anchor: "chore",
      domain: "home",
      cluster: "home",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    // ─── 41–50  School / work / deadlines ────────────────────────
    {
      hook: "I opened the assignment and my brain said \"abeg\"",
      whatToShow:
        "Show laptop or notebook with assignment. You read one line, scroll down, then slowly close the laptop halfway.",
      howToFilm: DESK_FILM,
      caption: "academic courage loading.",
      anchor: "assignment",
      domain: "work",
      cluster: "school",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "my inbox waited until I relaxed to start shouting",
      whatToShow:
        "Open fake inbox with unread emails. Start typing one reply, delete it, then open another tab to escape.",
      howToFilm: DESK_FILM,
      caption: "professional avoidance.",
      anchor: "inbox",
      domain: "work",
      cluster: "work",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: "Use mock email UI; never real inbox screenshots.",
    },
    {
      hook: "I highlighted one line and accidentally painted the whole page",
      whatToShow:
        "Show notes. Highlight one sentence, then another, then the full paragraph. You put the highlighter down like it betrayed you.",
      howToFilm: DESK_FILM,
      caption: "studying or interior decoration?",
      anchor: "notes",
      domain: "work",
      cluster: "study",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "the deadline was quiet until I checked the date",
      whatToShow:
        "Show calendar or assignment date. You count days on fingers, freeze, then open a blank document with panic energy.",
      howToFilm: DESK_FILM,
      caption: "time has been moving behind my back.",
      anchor: "deadline",
      domain: "work",
      cluster: "deadline",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I said \"I'll do it later\" and later brought lawyer",
      whatToShow:
        "Show a to-do list. One task has become three reminders. You try to swipe it away and it comes back.",
      howToFilm: PHONE_FILM,
      caption: "procrastination with evidence.",
      anchor: "later",
      domain: "work",
      cluster: "work",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "my notes looked organized until I needed them",
      whatToShow:
        "Show neat notes. You flip pages confidently, then realize none of it answers the question.",
      howToFilm: DESK_FILM,
      caption: "organization is not understanding.",
      anchor: "notes",
      domain: "work",
      cluster: "study",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "one meeting invite and my whole spirit minimized",
      whatToShow:
        "Show fake calendar invite. You stare, then adjust your shirt only from the top while still wearing house shorts/slippers.",
      howToFilm: DESK_FILM,
      caption: "corporate from waist up.",
      anchor: "meeting",
      domain: "work",
      cluster: "work_call",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "the task was simple until I opened the laptop",
      whatToShow:
        "Open laptop. Instead of the task, you open tabs, notes, calendar, then stare at the original blank document.",
      howToFilm: DESK_FILM,
      caption: "preparation became the project.",
      anchor: "laptop",
      domain: "work",
      cluster: "productivity",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "lecturer said \"quick quiz\" and my soul left early",
      whatToShow:
        "Show a notebook and fake class group message: 'quick quiz today.' You close the notebook, reopen it, then underline the title like that helps.",
      howToFilm: DESK_FILM,
      caption: "preparation by underlining.",
      anchor: "notebook",
      domain: "work",
      cluster: "school",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "my deadline and my confidence are not on speaking terms",
      whatToShow:
        "Show a task due today. You sit down, open document, type the title, then immediately reward yourself with a break.",
      howToFilm: DESK_FILM,
      caption: "progress: title entered.",
      anchor: "deadline",
      domain: "work",
      cluster: "deadline",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    // ─── 51–60  Family / social pressure ─────────────────────────
    {
      hook: "one family call and suddenly I had life update due",
      whatToShow:
        "Phone shows fake 'Mum calling.' You rehearse a responsible face, answer, then immediately sit up straighter.",
      howToFilm: PHONE_FILM,
      caption: "posture changed before the conversation.",
      anchor: "call",
      domain: "family",
      cluster: "family",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: "Use generic 'Mum' label; never real contact name.",
    },
    {
      hook: "the family group chat turned my weekend into public property",
      whatToShow:
        "Fake family group chat announces a plan. You stare, mute the chat, then unmute it because fear.",
      howToFilm: PHONE_FILM,
      caption: "family logistics has no opt-out.",
      anchor: "chat",
      domain: "family",
      cluster: "family",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "they asked \"when are you coming?\" like I had permission from my bed",
      whatToShow:
        "Show you in bed receiving a fake call/message. You look at your blanket, then the phone, then pull the blanket higher.",
      howToFilm: BED_FILM,
      caption: "my bed has authority.",
      anchor: "bed",
      domain: "family",
      cluster: "social_pressure",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "the event was optional until family started counting attendance",
      whatToShow:
        "Show a fake invitation. Then show three missed calls/messages from relatives. You slowly start looking for clothes.",
      howToFilm: PHONE_FILM,
      caption: "optional became attendance register.",
      anchor: "event",
      domain: "family",
      cluster: "event",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: "Use fake relatives in mock; no real names.",
    },
    {
      hook: "I said \"I'm coming\" and immediately started negotiating with myself",
      whatToShow:
        "Type 'I'm coming' in a fake chat. Then show yourself still sitting, checking time, and calculating excuses.",
      howToFilm: COUCH_FILM,
      caption: "promise made under pressure.",
      anchor: "coming",
      domain: "family",
      cluster: "family",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "one \"just greet everybody\" turned into a full interview",
      whatToShow:
        "Walk into frame, wave once, then fake text overlays appear: 'school?' 'work?' 'relationship?' You slowly step back.",
      howToFilm: DOOR_FILM,
      caption: "greeting became panel session.",
      anchor: "greet",
      domain: "family",
      cluster: "social",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I entered the room and became tech support",
      whatToShow:
        "Sit down with food or drink. Someone's phone/laptop is placed in front of you. You look at it like peace has expired.",
      howToFilm: COUCH_FILM,
      caption: "first born energy was not requested.",
      anchor: "room",
      domain: "family",
      cluster: "family",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "the small visit came with full expectations",
      whatToShow:
        "Show yourself arriving with nothing. Fake text overlay lists things you were expected to bring/do. You slowly hide your hands.",
      howToFilm: DOOR_FILM,
      caption: "visiting is project management.",
      anchor: "visit",
      domain: "family",
      cluster: "social",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I muted the family chat and somehow it got louder",
      whatToShow:
        "Show fake family group chat muted. Notifications still pile up visually. You stare at the mute icon like it lied.",
      howToFilm: PHONE_FILM,
      caption: "mute button needs backup.",
      anchor: "chat",
      domain: "family",
      cluster: "family_group",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "I wore one nice outfit and suddenly everybody had questions",
      whatToShow:
        "Mirror shot of outfit. Fake text overlays appear: 'where are you going?' 'who is there?' 'send picture.' You slowly change back.",
      howToFilm: MIRROR_FILM,
      caption: "fashion attracted investigation.",
      anchor: "outfit",
      domain: "family",
      cluster: "event",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    // ─── 61–70  Money / shopping / bank alert ────────────────────
    {
      hook: "my account balance and my confidence are not related",
      whatToShow:
        "Show a fake budget or fake bank-alert overlay. You open shopping cart, add one item, then look back at the fake balance like it will change.",
      howToFilm: PHONE_FILM,
      caption: "financial courage is not evidence.",
      anchor: "balance",
      domain: "money",
      cluster: "money",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_BANK_NOTE,
    },
    {
      hook: "the cart total spoke louder than my salary",
      whatToShow:
        "Open a fake cart. Remove one item proudly, then add two cheaper items that make the total worse.",
      howToFilm: PHONE_FILM,
      caption: "budgeting with vibes.",
      anchor: "cart",
      domain: "money",
      cluster: "shopping",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "one debit alert and I started remembering every mistake",
      whatToShow:
        "Fake bank-alert overlay pops up. You freeze, open calculator, then close it because the math is disrespectful.",
      howToFilm: PHONE_FILM,
      caption: "fake alert, real emotion.",
      anchor: "alert",
      domain: "money",
      cluster: "bank_alert",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_BANK_NOTE,
    },
    {
      hook: "my budget looked organized until food entered it",
      whatToShow:
        "Show a simple budget note. Add 'food' and the numbers collapse. You erase the whole plan and write 'survive.'",
      howToFilm: PHONE_FILM,
      caption: "budgeting is a hopeful sport.",
      anchor: "budget",
      domain: "money",
      cluster: "money",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I said I'm just checking price and somehow checkout opened",
      whatToShow:
        "Fake shopping app. You scroll, add to cart 'just to see,' then hover over checkout like your thumb has separate plans.",
      howToFilm: PHONE_FILM,
      caption: "window shopping with consequences.",
      anchor: "checkout",
      domain: "money",
      cluster: "shopping",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "payday arrived and immediately started leaving",
      whatToShow:
        "Show fake payday note. Then show rent, food, transport, data, and one 'small enjoyment' item. The total wins.",
      howToFilm: PHONE_FILM,
      caption: "salary came to visit.",
      anchor: "payday",
      domain: "money",
      cluster: "money",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I went market with list and came back with storyline",
      whatToShow:
        "Show a shopping list with three items. Cut to bags with extras. You check the list like it betrayed you.",
      howToFilm: DESK_FILM,
      caption: "the list lost control.",
      anchor: "list",
      domain: "money",
      cluster: "market",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "one small treat became a financial personality",
      whatToShow:
        "Show a fake cart with one item. Cut to several small 'treats.' You remove one, then add another.",
      howToFilm: PHONE_FILM,
      caption: "small things gather meeting.",
      anchor: "cart",
      domain: "money",
      cluster: "spending",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "data subscription humbled my enjoyment plan",
      whatToShow:
        "Fake data purchase screen. You choose the smaller plan, then open video app and immediately regret it.",
      howToFilm: PHONE_FILM,
      caption: "entertainment now has budget committee.",
      anchor: "data",
      domain: "money",
      cluster: "data_money",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I checked food prices and started respecting home cooking",
      whatToShow:
        "Fake delivery app. You stare at the delivery fee, close app, open fridge, then close fridge too.",
      howToFilm: KITCHEN_FILM,
      caption: "both options attacked me.",
      anchor: "fridge",
      domain: "money",
      cluster: "food_spending",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    // ─── 71–80  Creator / social media ───────────────────────────
    {
      hook: "I posted once and started refreshing like election result",
      whatToShow:
        "Show fake post analytics. You refresh, wait, refresh again, then lock the screen like you are above it. Immediately unlock.",
      howToFilm: PHONE_FILM,
      caption: "peace after posting is a myth.",
      anchor: "post",
      domain: "creator",
      cluster: "creator",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "my draft has been ready since fear entered the room",
      whatToShow:
        "Show a fake draft screen. Your thumb hovers over 'post.' You lock the phone, unlock it, and hover again.",
      howToFilm: PHONE_FILM,
      caption: "almost posting is a full-time job.",
      anchor: "draft",
      domain: "creator",
      cluster: "creator",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "one comment and I started doing press conference in my head",
      whatToShow:
        "Show fake comment preview. You type a reply, delete it, type again, then close the app dramatically.",
      howToFilm: PHONE_FILM,
      caption: "mental press briefing.",
      anchor: "comment",
      domain: "creator",
      cluster: "comments",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "the algorithm watched me try and said \"interesting\"",
      whatToShow:
        "Fake analytics screen shows low views. You stare, refresh, then put the phone down carefully like it might explode.",
      howToFilm: PHONE_FILM,
      caption: "the algorithm and I need counseling.",
      anchor: "analytics",
      domain: "creator",
      cluster: "creator",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I said I don't care about views and refreshed five times",
      whatToShow:
        "Show fake post screen. You say/overlay 'I don't care,' then your thumb immediately refreshes.",
      howToFilm: PHONE_FILM,
      caption: "the lie was still loading.",
      anchor: "post",
      domain: "creator",
      cluster: "posting",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "my drafts folder knows too much about my confidence",
      whatToShow:
        "Open fake drafts folder with many unsent videos. You select one, watch two seconds, then back out.",
      howToFilm: PHONE_FILM,
      caption: "archive of almost-courage.",
      anchor: "drafts",
      domain: "creator",
      cluster: "drafts",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I filmed content and immediately started judging myself like panel",
      whatToShow:
        "Watch your own fake clip. Pause at an awkward frame. Zoom in. Close app like the evidence is too much.",
      howToFilm: PHONE_FILM,
      caption: "self-review is violence.",
      anchor: "clip",
      domain: "creator",
      cluster: "creator_life",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "the video was fine until caption became an exam",
      whatToShow:
        "Show a post screen with blank caption. Type one caption, delete it, type another, then just write 'anyway.'",
      howToFilm: PHONE_FILM,
      caption: "caption defeated the content.",
      anchor: "caption",
      domain: "creator",
      cluster: "caption",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "views no move and my spirit started checking network",
      whatToShow:
        "Fake analytics stuck at same number. You toggle Wi-Fi/data like maybe the problem is physics.",
      howToFilm: PHONE_FILM,
      caption: "blaming network for emotional support.",
      anchor: "views",
      domain: "creator",
      cluster: "analytics",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I made the content, then remembered people will see it",
      whatToShow:
        "Show export/share screen. Your thumb hovers over post. You look around the room like the audience is already there.",
      howToFilm: PHONE_FILM,
      caption: "posting is public speaking with thumbnails.",
      anchor: "post",
      domain: "creator",
      cluster: "creator_fear",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    // ─── 81–100  Daily / object betrayal / misc ──────────────────
    {
      hook: "mirror looked at me and said \"try again\"",
      whatToShow:
        "Walk into frame feeling confident. Catch reflection, pause, adjust one thing, then adjust three more things.",
      howToFilm: MIRROR_FILM,
      caption: "mirror feedback was immediate.",
      anchor: "mirror",
      domain: "everyday",
      cluster: "mirror",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "the outfit made sense until outside entered the plan",
      whatToShow:
        "Mirror outfit check. Then fake weather/traffic/plan message appears. You slowly remove one accessory like reality edited the look.",
      howToFilm: MIRROR_FILM,
      caption: "outfit approved by indoor lighting only.",
      anchor: "outfit",
      domain: "everyday",
      cluster: "outfit",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "my bed held one meeting and I attended fully",
      whatToShow:
        "You sit on the bed 'for one minute.' Cut to you lying down with phone still in hand.",
      howToFilm: BED_FILM,
      caption: "meeting adjourned by sleep.",
      anchor: "bed",
      domain: "everyday",
      cluster: "bed",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "the door saw me ready and asked if I was sure",
      whatToShow:
        "Stand near the door with keys. Hand reaches for handle, pauses, then slowly turns back toward the room.",
      howToFilm: DOOR_FILM,
      caption: "the door raised a valid point.",
      anchor: "door",
      domain: "everyday",
      cluster: "door",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I wore shoes and still did not leave",
      whatToShow:
        "Show shoes on your feet while you sit on bed/couch scrolling. Cut to later, shoes still on, no movement.",
      howToFilm: COUCH_FILM,
      caption: "readiness without results.",
      anchor: "shoes",
      domain: "everyday",
      cluster: "shoes",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "my water bottle has witnessed too many fake fresh starts",
      whatToShow:
        "Fill a bottle, place it beside you, forget it, then later pick it up like you are surprised it exists.",
      howToFilm: DESK_FILM,
      caption: "hydration by decoration.",
      anchor: "bottle",
      domain: "everyday",
      cluster: "water_bottle",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I wrote the plan and immediately disobeyed it",
      whatToShow:
        "Show a neat to-do list. Then show you doing a completely unrelated task while the list stays open.",
      howToFilm: DESK_FILM,
      caption: "planning is performance art.",
      anchor: "plan",
      domain: "everyday",
      cluster: "planner",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "my charger decided where I would spend the evening",
      whatToShow:
        "Show short charger cable. You sit awkwardly near the socket, rearranging your body around the phone.",
      howToFilm: PHONE_FILM,
      caption: "furniture plan by charger.",
      anchor: "charger",
      domain: "everyday",
      cluster: "charger",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I boiled water and forgot the reason",
      whatToShow:
        "Show kettle or cup. Water is ready. You stare at it, then open your phone trying to remember the original plan.",
      howToFilm: KITCHEN_FILM,
      caption: "memory left before tea.",
      anchor: "kettle",
      domain: "everyday",
      cluster: "kettle",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "my keys disappeared the moment I became serious",
      whatToShow:
        "Show you checking table, pocket, bag. Keys are in the most obvious place. You find them and look personally offended.",
      howToFilm: DESK_FILM,
      caption: "the keys waited for drama.",
      anchor: "keys",
      domain: "everyday",
      cluster: "keys",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I wore slippers to do one thing and ended up doing nothing",
      whatToShow:
        "Camera on slippers. You stand up, take two steps, then sit back down with slippers still ready.",
      howToFilm: COUCH_FILM,
      caption: "mission cancelled at launch.",
      anchor: "slippers",
      domain: "everyday",
      cluster: "slippers",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "one notification changed the direction of my whole personality",
      whatToShow:
        "You are focused on a task. Phone lights up. You check it 'quickly,' then lose the task completely.",
      howToFilm: PHONE_FILM,
      caption: "focus left through notification.",
      anchor: "notification",
      domain: "everyday",
      cluster: "notification",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I said \"almost ready\" while still negotiating with towel",
      whatToShow:
        "Show towel/robe, phone message asking 'ready?' You type 'almost' while clearly nowhere near ready.",
      howToFilm: MIRROR_FILM,
      caption: "readiness is spiritual.",
      anchor: "towel",
      domain: "everyday",
      cluster: "towel",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I packed my bag and forgot the main thing with confidence",
      whatToShow:
        "Show bag packed neatly. Then show the important item still on the table. You zip the bag proudly and walk away.",
      howToFilm: DESK_FILM,
      caption: "confidence without evidence.",
      anchor: "bag",
      domain: "everyday",
      cluster: "bag",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I saw the queue and my errand became suggestion",
      whatToShow:
        "Show a fake queue/line situation or text overlay. You look at the line, look at your phone, then turn around slowly.",
      howToFilm: PHONE_FILM,
      caption: "patience did not follow me.",
      anchor: "queue",
      domain: "everyday",
      cluster: "queue",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "the rain started acting like it knew my plans",
      whatToShow:
        "You hold keys ready to leave. Rain sound or window shot. You slowly put the keys down and sit back.",
      howToFilm: DOOR_FILM,
      caption: "weather joined the opposition.",
      anchor: "rain",
      domain: "everyday",
      cluster: "rain",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "my hair agreed at home and betrayed me outside",
      whatToShow:
        "Mirror check looks fine. Step near brighter light or window. You freeze, then reach for cap/scarf.",
      howToFilm: MIRROR_FILM,
      caption: "indoor confidence is different.",
      anchor: "hair",
      domain: "everyday",
      cluster: "hair",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "the list had three things and somehow I forgot all three",
      whatToShow:
        "Show a short list. Cut to store/room with you holding the phone and staring like the list is written in another language.",
      howToFilm: PHONE_FILM,
      caption: "memory took personal leave.",
      anchor: "list",
      domain: "everyday",
      cluster: "list",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I said \"let me just quickly\" and the day laughed",
      whatToShow:
        "Show one small task. Cut to multiple tabs/items/messages open. You sit back and stare at everything you accidentally started.",
      howToFilm: DESK_FILM,
      caption: "quick task, long testimony.",
      anchor: "task",
      domain: "everyday",
      cluster: "small_task",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "my confidence arrived early and left before the actual problem",
      whatToShow:
        "Show yourself preparing for a task with energy. The moment the task appears, your posture drops and you slowly close the app/notebook.",
      howToFilm: DESK_FILM,
      caption: "confidence was only doing opening ceremony.",
      anchor: "task",
      domain: "everyday",
      cluster: "final_relatable",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },

    // ════════════════════════════════════════════════════════════════
    // BATCH B (entries B1–B100) — second 100 candidates
    // Same rules as Batch A: NOT activated, NOT reviewed, INERT.
    // ════════════════════════════════════════════════════════════════

    // ─── B1–B15  WhatsApp / group chat / messages ─────────────────
    {
      hook: "why is this group more active than my actual family?",
      whatToShow:
        "Open a fake family WhatsApp group at 11 p.m. The unread count is wild. You scroll through voice notes and Christmas-plan arguments, then slowly mute the chat like it personally exhausted you.",
      howToFilm: PHONE_FILM,
      caption: "family logistics after dark.",
      anchor: "group",
      domain: "messaging",
      cluster: "family_group",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "bros, you typed for 30 minutes just to send \"lol\"?",
      whatToShow:
        "Close-up of a chat showing 'typing...' for too long. The reply finally lands as one emoji. You stare at the phone from bed like the conversation wasted your data and emotions.",
      howToFilm: BED_FILM,
      caption: "suspense without content.",
      anchor: "typing",
      domain: "messaging",
      cluster: "typing_anxiety",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "the way we greet oga in the group chat versus real life",
      whatToShow:
        "In a fake office group chat, type 'Good morning sir, hope you rested well sir.' Cut to you in the office avoiding eye contact when oga walks past.",
      howToFilm: PHONE_FILM,
      caption: "respect is easier on WhatsApp.",
      anchor: "oga",
      domain: "messaging",
      cluster: "office_group_chat",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "I saw your message yesterday, but pride said I should relax",
      whatToShow:
        "Open a fake chat. The message has been on 'seen' for hours. You type, delete, type again, then lock the phone and pace like replying is a court case.",
      howToFilm: PHONE_FILM,
      caption: "seen since yesterday. peace since never.",
      anchor: "seen",
      domain: "messaging",
      cluster: "seen_wahala",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "they turned off last seen but forgot blue ticks exist",
      whatToShow:
        "Send a long message to a fake chat. Blue ticks appear instantly. No reply. You keep opening the chat while pretending to cook.",
      howToFilm: PHONE_FILM,
      caption: "blue ticks with no mercy.",
      anchor: "ticks",
      domain: "messaging",
      cluster: "blue_tick_pressure",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "why can't you just type small like a normal person?",
      whatToShow:
        "A friend sends seven fake voice notes. You start playing them while doing chores, then pause at voice note three like the message has become a podcast.",
      howToFilm: PHONE_FILM,
      caption: "voice note subscription.",
      anchor: "voice",
      domain: "messaging",
      cluster: "voice_notes",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "\"this message was deleted\" is doing too much",
      whatToShow:
        "In a fake group chat, someone sends something and deletes it immediately. You zoom in on the deleted bubble like evidence might come back.",
      howToFilm: PHONE_FILM,
      caption: "curiosity entered the chat.",
      anchor: "deleted",
      domain: "messaging",
      cluster: "deleted_message",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "the power WhatsApp admins have is too much",
      whatToShow:
        "You post one harmless 'good morning.' A fake admin warning pops up. Meanwhile, three people are posting forwarded prayers and nobody touches them.",
      howToFilm: PHONE_FILM,
      caption: "admin power is not democracy.",
      anchor: "admin",
      domain: "messaging",
      cluster: "group_admin",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "you viewed my status but ignored my message?",
      whatToShow:
        "Check your fake status viewers. The same person who ignored your chat is right there. You open the chat, then zoom into their profile picture like it owes you explanation.",
      howToFilm: PHONE_FILM,
      caption: "viewer but not replier.",
      anchor: "status",
      domain: "messaging",
      cluster: "status_reply",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "he said \"K\" and my whole day scattered",
      whatToShow:
        "Show a long fake message you sent. The reply comes in as just 'K.' Your smile drops slowly while you screenshot it like evidence.",
      howToFilm: PHONE_FILM,
      caption: "one letter. maximum damage.",
      anchor: "reply",
      domain: "messaging",
      cluster: "k_reply",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "I muted this group but I still check every minute",
      whatToShow:
        "Mute a noisy fake group. Five minutes later, open it yourself. Laugh at your lack of discipline and unmute like the problem is you.",
      howToFilm: PHONE_FILM,
      caption: "mute button could not save me.",
      anchor: "mute",
      domain: "messaging",
      cluster: "mute_unmute",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "the group chat remembered my birthday at 11:59 p.m.",
      whatToShow:
        "Show fake birthday messages flooding in right before midnight ends. You wake up to 87 messages and stare like the love came with deadline pressure.",
      howToFilm: PHONE_FILM,
      caption: "last-minute affection.",
      anchor: "birthday",
      domain: "messaging",
      cluster: "birthday_group",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "you're online, but somehow still unavailable",
      whatToShow:
        "Watch a fake chat show 'online' while the person who owes you a reply keeps typing and disappearing. You lock the phone, unlock it, and check again.",
      howToFilm: PHONE_FILM,
      caption: "online is not accountability.",
      anchor: "online",
      domain: "messaging",
      cluster: "online_ghosting",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "who is voting nonsense in this group poll?",
      whatToShow:
        "Fake group poll about weekend plans. You vote yes. Everyone else votes no. You stare, then type 'una no get joy' and delete it.",
      howToFilm: PHONE_FILM,
      caption: "democracy hurt my feelings.",
      anchor: "poll",
      domain: "messaging",
      cluster: "poll_wahala",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "someone left the group and now everybody is an investigator",
      whatToShow:
        "A fake group notification says someone left. The chat immediately starts guessing who and why. You silently scroll like it is breaking news.",
      howToFilm: PHONE_FILM,
      caption: "exit became entertainment.",
      anchor: "exit",
      domain: "messaging",
      cluster: "group_exit_drama",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },

    // ─── B16–B25  Transport / going out ───────────────────────────
    {
      hook: "\"I'm almost there\" is the biggest lie in traffic",
      whatToShow:
        "Show yourself stuck in traffic while sending 'almost there.' Cut to a fake map showing the route barely moving.",
      howToFilm: PHONE_FILM,
      caption: "emotionally nearby. physically unavailable.",
      anchor: "traffic",
      domain: "movement",
      cluster: "lagos_traffic",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "\"two minutes\" on bike can mean anything",
      whatToShow:
        "On a bike POV-style shot, show the rider taking a wrong turn while your hand checks the map in panic.",
      howToFilm: PHONE_FILM,
      caption: "quick route, long testimony.",
      anchor: "bike",
      domain: "movement",
      cluster: "okada_promise",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "your driver is 5 minutes away... for 45 minutes",
      whatToShow:
        "Stand outside watching a fake ride-app screen. The car icon circles your area like it is confused about its purpose.",
      howToFilm: PHONE_FILM,
      caption: "estimated arrival by imagination.",
      anchor: "driver",
      domain: "movement",
      cluster: "ride_app",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I said \"I dey come\" while still ironing",
      whatToShow:
        "Type 'I'm coming now.' Cut to you still ironing or looking for socks while the time on your phone keeps moving.",
      howToFilm: BED_FILM,
      caption: "coming soon. allegedly.",
      anchor: "ironing",
      domain: "movement",
      cluster: "im_coming",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "traffic became the villain even after I left early",
      whatToShow:
        "Show yourself dressed and ready, then a fake traffic update. Send a voice note explaining traffic while sitting completely stuck.",
      howToFilm: PHONE_FILM,
      caption: "punctuality met Lagos.",
      anchor: "traffic",
      domain: "movement",
      cluster: "traffic_excuse",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "\"make we enter keke, e go fast\" was a setup",
      whatToShow:
        "Squeeze into a tight ride setup. Rain starts or the cover leaks. Everyone in frame reacts silently while trying to protect their phone.",
      howToFilm: PHONE_FILM,
      caption: "speed came with suffering.",
      anchor: "keke",
      domain: "movement",
      cluster: "keke_drama",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "\"babe, I'm 5 minutes away\" from inside my house",
      whatToShow:
        "Say or type '5 minutes.' Cut to toothbrush, towel, or unbuttoned shirt clearly proving you are nowhere near ready.",
      howToFilm: MIRROR_FILM,
      caption: "distance calculated by confidence.",
      anchor: "minutes",
      domain: "movement",
      cluster: "almost_there_lie",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "driver cancelled after I waited long enough to change personality",
      whatToShow:
        "Stand roadside checking a fake ride app. 'Driver cancelled' appears. You look up slowly like the sky has answers.",
      howToFilm: PHONE_FILM,
      caption: "cancellation with sunlight.",
      anchor: "driver",
      domain: "movement",
      cluster: "ride_cancel",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "maps said 12 minutes and reality laughed",
      whatToShow:
        "Follow a fake map route, then stop and turn around when the route clearly makes no sense.",
      howToFilm: PHONE_FILM,
      caption: "technology with comedy timing.",
      anchor: "maps",
      domain: "movement",
      cluster: "maps_reality",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "\"I'm at the gate\" while still locking my door",
      whatToShow:
        "Type 'at the gate already.' Show your hand still locking the door, then checking if you forgot anything.",
      howToFilm: DOOR_FILM,
      caption: "location shared by faith.",
      anchor: "door",
      domain: "movement",
      cluster: "gate_lie",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },

    // ─── B26–B37  Power / data / phone realities ──────────────────
    {
      hook: "light came back and left before my joy settled",
      whatToShow:
        "Fan starts spinning, you celebrate for one second, then it slows down again. You stare at the fan like it betrayed the household.",
      howToFilm: COUCH_FILM,
      caption: "happiness had five minutes.",
      anchor: "light",
      domain: "phone",
      cluster: "light_surprise",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "my data finished but I still kept refreshing",
      whatToShow:
        "Phone shows no internet. You refresh the app anyway, then open settings like Wi-Fi might appear from mercy.",
      howToFilm: PHONE_FILM,
      caption: "hope uses data too.",
      anchor: "data",
      domain: "phone",
      cluster: "data_wahala",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "20% battery and I still chose reels",
      whatToShow:
        "Phone shows 20%. You keep scrolling. Cut to 1%. Panic finally enters the room.",
      howToFilm: PHONE_FILM,
      caption: "battery saver came too late.",
      anchor: "battery",
      domain: "phone",
      cluster: "battery_drama",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "generator noise said sleep is optional",
      whatToShow:
        "Try to sleep while generator hum plays. Pull pillow over your head, then remove it because it is somehow hotter.",
      howToFilm: BED_FILM,
      caption: "rest with soundtrack.",
      anchor: "generator",
      domain: "phone",
      cluster: "generator_noise",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "full network bars with no service is emotional damage",
      whatToShow:
        "Hold phone up around the room looking for signal. The bars are full, but nothing loads.",
      howToFilm: PHONE_FILM,
      caption: "bars without progress.",
      anchor: "network",
      domain: "phone",
      cluster: "network_bars",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "light came and everybody started running to charge",
      whatToShow:
        "Power returns. Everyone rushes to plug devices. Before you settle, power goes again. Freeze on the charger still in your hand.",
      howToFilm: DESK_FILM,
      caption: "national sprint event.",
      anchor: "charger",
      domain: "phone",
      cluster: "light_come_go",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "my phone picked the worst time to update itself",
      whatToShow:
        "You need to send a message. Phone starts updating. You stare at the progress bar like it is holding your life.",
      howToFilm: PHONE_FILM,
      caption: "technology chose violence.",
      anchor: "update",
      domain: "phone",
      cluster: "phone_update",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "my data was expiring, so suddenly I became productive online",
      whatToShow:
        "Check fake data expiry. Start downloading random things and opening videos like unused data is an emergency.",
      howToFilm: PHONE_FILM,
      caption: "data deadline pressure.",
      anchor: "data",
      domain: "phone",
      cluster: "data_expiry",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "this charger only works when I respect its feelings",
      whatToShow:
        "Twist charger cable into a ridiculous angle. Phone starts charging. You freeze and hold the position like surgery.",
      howToFilm: PHONE_FILM,
      caption: "charging by negotiation.",
      anchor: "charger",
      domain: "phone",
      cluster: "charger_angle",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "who is using my data in the background?",
      whatToShow:
        "Fake data usage screen shows one app used too much. You look around at roommates or at the phone like someone must confess.",
      howToFilm: PHONE_FILM,
      caption: "data investigation unit.",
      anchor: "data",
      domain: "phone",
      cluster: "data_thief",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "the moment I started cooking, light remembered me",
      whatToShow:
        "You start cooking. Power cuts. You stand with spoon in hand, staring at the cooker like the plan expired.",
      howToFilm: KITCHEN_FILM,
      caption: "dinner entered suspense mode.",
      anchor: "cooking",
      domain: "phone",
      cluster: "cooking_blackout",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "inverter said 8 hours and gave 45 minutes of hope",
      whatToShow:
        "You trust the inverter during outage. It dies. You sit in silence, looking at the dead power light.",
      howToFilm: COUCH_FILM,
      caption: "battery life with public relations.",
      anchor: "inverter",
      domain: "phone",
      cluster: "inverter_promise",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },

    // ─── B38–B49  Food / home / roommate ──────────────────────────
    {
      hook: "whose jollof is this? because it is not mine",
      whatToShow:
        "Open pot expecting your food. See a suspiciously different portion. Look around the kitchen like the culprit is still nearby.",
      howToFilm: KITCHEN_FILM,
      caption: "jollof identity crisis.",
      anchor: "jollof",
      domain: "home",
      cluster: "jollof",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "my indomie has disappeared again",
      whatToShow:
        "Open the cupboard. Your noodles or snacks are gone. You check behind other items like they might be hiding.",
      howToFilm: KITCHEN_FILM,
      caption: "household investigation.",
      anchor: "indomie",
      domain: "home",
      cluster: "food_thief",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "hunger at 2 a.m. is always a trap",
      whatToShow:
        "Open the fridge at night. Only random leftovers or one sad item is there. Close it slowly and stand in the dark.",
      howToFilm: KITCHEN_FILM,
      caption: "midnight disappointment.",
      anchor: "fridge",
      domain: "home",
      cluster: "late_night_hunger",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I left small garri this morning... so where is it?",
      whatToShow:
        "Reach for the garri pack. It is empty. Shake it once, then stare into the pack like answers are inside.",
      howToFilm: KITCHEN_FILM,
      caption: "garri vanished with confidence.",
      anchor: "garri",
      domain: "home",
      cluster: "garri",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "the one time I cook, everybody suddenly appears",
      whatToShow:
        "You finish cooking. Roommates appear one by one with 'just small taste' energy. You slowly guard the pot.",
      howToFilm: KITCHEN_FILM,
      caption: "food has announcement system.",
      anchor: "pot",
      domain: "home",
      cluster: "shared_food",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "my maggi reduced overnight and nobody is confessing",
      whatToShow:
        "Open spice box. Count the cubes. Look toward the doorway like the house is lying.",
      howToFilm: KITCHEN_FILM,
      caption: "seasoning mystery.",
      anchor: "maggi",
      domain: "home",
      cluster: "maggi",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "food was \"2 minutes away\" for the last 40 minutes",
      whatToShow:
        "Wait near the door, checking a fake delivery map every few seconds. Your hunger becomes visible.",
      howToFilm: DOOR_FILM,
      caption: "hunger tracking app.",
      anchor: "delivery",
      domain: "home",
      cluster: "delivery_delay",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "\"share this rice small na\" is how it starts",
      whatToShow:
        "You sit with food. Someone enters and starts negotiating for 'just one spoon.' You pull the plate slightly closer.",
      howToFilm: KITCHEN_FILM,
      caption: "one spoon has agenda.",
      anchor: "rice",
      domain: "home",
      cluster: "share_rice",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "light went and my freezer started threatening me",
      whatToShow:
        "Open freezer during outage. Food is thawing. You check the clock, then the freezer, then the ceiling.",
      howToFilm: KITCHEN_FILM,
      caption: "chicken under pressure.",
      anchor: "freezer",
      domain: "home",
      cluster: "generator_food",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "who put fish in the microwave?",
      whatToShow:
        "Open microwave, react to the smell, then look around like the suspect is hiding behind the fridge.",
      howToFilm: KITCHEN_FILM,
      caption: "kitchen crime scene.",
      anchor: "microwave",
      domain: "home",
      cluster: "microwave_mystery",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "\"I go buy my own next time\" means I am hurt",
      whatToShow:
        "Roommate finishes your snack. You say the line calmly, then stare at the empty wrapper too long.",
      howToFilm: KITCHEN_FILM,
      caption: "peace with evidence.",
      anchor: "snack",
      domain: "home",
      cluster: "buy_my_own",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "these plates have been in the sink long enough to pay rent",
      whatToShow:
        "Show dirty plates. You and roommate enter frame, both look at the sink, then both slowly leave.",
      howToFilm: KITCHEN_FILM,
      caption: "shared kitchen diplomacy.",
      anchor: "sink",
      domain: "home",
      cluster: "sink_war",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },

    // ─── B50–B59  School / work / deadlines ───────────────────────
    {
      hook: "assignment due in 2 hours and I am just meeting it",
      whatToShow:
        "Open laptop at midnight. Blank document. You type the title aggressively like progress has started.",
      howToFilm: DESK_FILM,
      caption: "academic sprint begins.",
      anchor: "assignment",
      domain: "work",
      cluster: "deadline",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "oga sent email at 11:59 p.m. like sleep is illegal",
      whatToShow:
        "You are about to sleep. Fake work email lands. You sit up slowly, open laptop, and stare at the screen.",
      howToFilm: BED_FILM,
      caption: "bedtime became office hours.",
      anchor: "email",
      domain: "work",
      cluster: "boss_email",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "group members only appear when deadline smells near",
      whatToShow:
        "Show a fake group project chat. You have done the work. On submission day, everyone messages 'how far?'",
      howToFilm: PHONE_FILM,
      caption: "teamwork by timing.",
      anchor: "deadline",
      domain: "work",
      cluster: "group_project",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "I said \"later\" until the portal said \"closed\"",
      whatToShow:
        "Keep postponing the upload. Refresh the portal and see closed status. Your hand freezes on the mouse.",
      howToFilm: DESK_FILM,
      caption: "later has consequences.",
      anchor: "portal",
      domain: "work",
      cluster: "submission_closed",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "Monday always arrives like it has a personal issue with me",
      whatToShow:
        "Alarm rings. You hit snooze, stare at ceiling, and mentally draft five excuses.",
      howToFilm: BED_FILM,
      caption: "Monday came prepared.",
      anchor: "alarm",
      domain: "work",
      cluster: "monday",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "working from home became working near the bed",
      whatToShow:
        "Laptop open on your chest or beside you. Work tab open, but a show or video is clearly 'in the background.'",
      howToFilm: BED_FILM,
      caption: "productivity with duvet.",
      anchor: "laptop",
      domain: "work",
      cluster: "wfh_reality",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "camera off, mic muted — that is the real meeting",
      whatToShow:
        "Join fake Zoom or meeting screen. Camera off. Mic muted. You are eating breakfast or folding clothes quietly.",
      howToFilm: DESK_FILM,
      caption: "attendance without presence.",
      anchor: "zoom",
      domain: "work",
      cluster: "zoom_life",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "presentation in 10 minutes and I am still editing slide one",
      whatToShow:
        "Laptop shows messy slides. You adjust one font while time runs out.",
      howToFilm: DESK_FILM,
      caption: "design under pressure.",
      anchor: "slides",
      domain: "work",
      cluster: "presentation_panic",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "class group chat is quiet until exam week attacks",
      whatToShow:
        "Fake class group chat suddenly explodes with 'past questions?' after weeks of silence. You scroll like you have entered a market.",
      howToFilm: PHONE_FILM,
      caption: "academic emergency broadcast.",
      anchor: "exam",
      domain: "work",
      cluster: "class_group",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "performance review season makes everyone remember humility",
      whatToShow:
        "Boss calls you in. You walk in smiling professionally while your hand wipes sweat off-screen.",
      howToFilm: DESK_FILM,
      caption: "confidence with small shaking.",
      anchor: "review",
      domain: "work",
      cluster: "performance_review",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },

    // ─── B60–B65  Family / social pressure ────────────────────────
    {
      hook: "family dinner is not dinner, it is a relationship audit",
      whatToShow:
        "At a family table setup, fake overlay says 'so when are you bringing someone?' You laugh nervously and focus too hard on the rice.",
      howToFilm: KITCHEN_FILM,
      caption: "rice did not ask me questions.",
      anchor: "dinner",
      domain: "family",
      cluster: "marriage_pressure",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "my mum's favorite weekend topic is my future",
      whatToShow:
        "You visit home. A fake text or voice overlay starts with 'you are not getting younger.' You slowly sit straighter.",
      howToFilm: COUCH_FILM,
      caption: "weekend motivation with pressure.",
      anchor: "mum",
      domain: "family",
      cluster: "mum_line",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I brought one friend home and they became a case study",
      whatToShow:
        "Fake family setting. Everyone starts asking your friend questions. You look into camera like you caused this.",
      howToFilm: COUCH_FILM,
      caption: "introduction turned interview.",
      anchor: "friend",
      domain: "family",
      cluster: "bring_friend",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "Instagram weddings are not helping my family meetings",
      whatToShow:
        "Scroll fake wedding posts. A parent or relative peeks over your shoulder, and you immediately lock the phone.",
      howToFilm: PHONE_FILM,
      caption: "timeline betrayed me.",
      anchor: "wedding",
      domain: "family",
      cluster: "social_media_flex",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "\"so who is the special person?\" ruined the whole party",
      whatToShow:
        "Relatives ask the question. You smile, take a drink, and suddenly become very interested in something across the room.",
      howToFilm: COUCH_FILM,
      caption: "topic change by survival.",
      anchor: "party",
      domain: "family",
      cluster: "special_person",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "aunty has one \"fine person\" for everybody",
      whatToShow:
        "Aunty shows a random profile or photo on fake WhatsApp. You lean back like the phone is too close to your destiny.",
      howToFilm: PHONE_FILM,
      caption: "matchmaking without consent.",
      anchor: "aunty",
      domain: "family",
      cluster: "aunty_setup",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },

    // ─── B66–B73  Money / fake bank alert / cart ──────────────────
    {
      hook: "fake alert entered my phone and I almost believed in miracles",
      whatToShow:
        "Show a fake credit alert. You celebrate for one second, then check fake balance and freeze.",
      howToFilm: PHONE_FILM,
      caption: "alert with no evidence.",
      anchor: "alert",
      domain: "money",
      cluster: "fake_bank_alert",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_BANK_NOTE,
    },
    {
      hook: "I filled the cart and my account said behave",
      whatToShow:
        "Fake shopping cart full of items. Checkout total appears. You remove one item, then realize it changed almost nothing.",
      howToFilm: PHONE_FILM,
      caption: "cart versus reality.",
      anchor: "cart",
      domain: "money",
      cluster: "cart_budget",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "\"send me small change\" has no small consequences",
      whatToShow:
        "Friend sends a fake money request. You send a small amount, then immediately check your balance like you made a national decision.",
      howToFilm: PHONE_FILM,
      caption: "generosity with aftershock.",
      anchor: "change",
      domain: "money",
      cluster: "small_change",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_BANK_NOTE,
    },
    {
      hook: "salary was supposed to drop today, but today is acting funny",
      whatToShow:
        "Refresh fake banking app. Nothing. Refresh again. Still nothing. You put the phone down and pick it back up.",
      howToFilm: PHONE_FILM,
      caption: "payday playing hard to get.",
      anchor: "salary",
      domain: "money",
      cluster: "salary_delay",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_BANK_NOTE,
    },
    {
      hook: "everything I want is above my character development budget",
      whatToShow:
        "Scroll expensive items. Add to wishlist, then close the app like wishlist is ownership.",
      howToFilm: PHONE_FILM,
      caption: "shopping by imagination.",
      anchor: "wishlist",
      domain: "money",
      cluster: "window_shopping",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "\"I go pay you back next week\" has entered season two",
      whatToShow:
        "Open fake chat with old repayment promise. Next message is a meme instead of money.",
      howToFilm: PHONE_FILM,
      caption: "debt with comedy timing.",
      anchor: "pay",
      domain: "money",
      cluster: "pay_back",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "airtime finished, but somehow data is also judging me",
      whatToShow:
        "Try to buy airtime with slow network. App loads forever. You stare like even the phone is tired.",
      howToFilm: PHONE_FILM,
      caption: "connection without cooperation.",
      anchor: "airtime",
      domain: "money",
      cluster: "airtime_data",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "salary came in and immediately started distributing itself",
      whatToShow:
        "Fake salary alert lands. Cut to a list: rent, food, transport, data. Your smile fades with every line.",
      howToFilm: PHONE_FILM,
      caption: "salary came to visit.",
      anchor: "salary",
      domain: "money",
      cluster: "salary_day",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_BANK_NOTE,
    },

    // ─── B74–B85  Creator / social media behavior ─────────────────
    {
      hook: "the algorithm watched me try and said \"interesting\"",
      whatToShow:
        "Fake analytics screen shows low views. You refresh, wait, refresh again, then put the phone down too carefully.",
      howToFilm: PHONE_FILM,
      caption: "algorithm and I need a meeting.",
      anchor: "algorithm",
      domain: "creator",
      cluster: "algorithm",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I said I don't care about views and refreshed five times",
      whatToShow:
        "Show fake post screen. Overlay 'I don't care.' Your thumb immediately refreshes again and again.",
      howToFilm: PHONE_FILM,
      caption: "the lie refreshed too.",
      anchor: "refresh",
      domain: "creator",
      cluster: "refresh_madness",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "this is take 47 and somehow the first one was better",
      whatToShow:
        "Film the same 15-second clip repeatedly. Watch the last take, sigh, and scroll back to the first one.",
      howToFilm: PHONE_FILM,
      caption: "perfection is wasting storage.",
      anchor: "take",
      domain: "creator",
      cluster: "takes",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "caption is harder than the whole video",
      whatToShow:
        "Finished video ready. You type one caption, delete it, type another, then stare at blank space like it is an exam.",
      howToFilm: PHONE_FILM,
      caption: "caption humbled the creator.",
      anchor: "caption",
      domain: "creator",
      cluster: "caption",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "everybody is doing the trend and I am still learning left from right",
      whatToShow:
        "Try a trend alone in your room. Pause the tutorial, attempt one move, then immediately rewind.",
      howToFilm: BED_FILM,
      caption: "trend joined my enemies.",
      anchor: "trend",
      domain: "creator",
      cluster: "trend",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I edited this video for three hours and still fear post",
      whatToShow:
        "Final video is open. Thumb hovers over post. Lock phone, unlock phone, hover again.",
      howToFilm: PHONE_FILM,
      caption: "courage loading forever.",
      anchor: "post",
      domain: "creator",
      cluster: "post_or_not",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "reading comments after posting is emotional gambling",
      whatToShow:
        "Post goes live. You open comments, scroll slowly, then hold the phone farther away like distance will help.",
      howToFilm: PHONE_FILM,
      caption: "comment section anxiety.",
      anchor: "comments",
      domain: "creator",
      cluster: "comments",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "content no dey, but camera is already rolling",
      whatToShow:
        "Sit in front of camera ready to film. Smile fades as you realize there is no idea. You slowly stop recording.",
      howToFilm: DESK_FILM,
      caption: "camera ready. brain absent.",
      anchor: "camera",
      domain: "creator",
      cluster: "no_content",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "filming in public builds character I did not request",
      whatToShow:
        "You set up to film. Someone nearby looks over. You suddenly pretend to be checking your phone.",
      howToFilm: PHONE_FILM,
      caption: "confidence left the location.",
      anchor: "filming",
      domain: "creator",
      cluster: "public_filming",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "one more edit and the video became worse",
      whatToShow:
        "Add effects, text, and transitions late at night. Watch the final version and realize the simple version was better.",
      howToFilm: DESK_FILM,
      caption: "editing with too much confidence.",
      anchor: "edit",
      domain: "creator",
      cluster: "one_more_edit",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I tagged everybody and nobody reposted",
      whatToShow:
        "Fake post screen shows many tagged friends. No shares. You stare at the activity tab like it owes you loyalty.",
      howToFilm: PHONE_FILM,
      caption: "tag list without results.",
      anchor: "tag",
      domain: "creator",
      cluster: "tag_friends",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I need a break, but content is looking at me",
      whatToShow:
        "You look tired, then still set up ring light. Sit down, turn it on, and stare into it like it started the problem.",
      howToFilm: DESK_FILM,
      caption: "creator rest is complicated.",
      anchor: "content",
      domain: "creator",
      cluster: "creator_burnout",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },

    // ─── B86–B100  Misc daily embarrassment ───────────────────────
    {
      hook: "my slipper chose public embarrassment today",
      whatToShow:
        "Walk quickly. One slipper slips off. You pause, retrieve it awkwardly, and continue like nothing happened.",
      howToFilm: PHONE_FILM,
      caption: "footwear betrayal.",
      anchor: "slipper",
      domain: "everyday",
      cluster: "slipper",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "cash no dey, POS dey charge extra, peace no dey",
      whatToShow:
        "At a shop counter setup, you check your wallet, then see the POS extra charge. Your face drops slowly.",
      howToFilm: DESK_FILM,
      caption: "payment method with plot twist.",
      anchor: "pos",
      domain: "everyday",
      cluster: "pos_fee",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_BANK_NOTE,
    },
    {
      hook: "my voice cracked right when I needed authority",
      whatToShow:
        "Deliver a serious line to camera or as overlay. Voice cracks while a fake subtitle marks the crack. You freeze while everyone tries not to laugh.",
      howToFilm: DESK_FILM,
      caption: "authority left the room.",
      anchor: "voice",
      domain: "everyday",
      cluster: "voice_crack",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I got lost but pride said I should continue",
      whatToShow:
        "Walk or drive while checking fake map secretly. Pretend you know the way, then turn around immediately.",
      howToFilm: PHONE_FILM,
      caption: "confidence without location.",
      anchor: "lost",
      domain: "everyday",
      cluster: "lost_but_proud",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "realizing your zip was down after the whole day is cinema",
      whatToShow:
        "Notice your zip or outfit issue in the mirror. Freeze. Flash back with quick cuts to all the people you greeted.",
      howToFilm: MIRROR_FILM,
      caption: "memory replay attacked me.",
      anchor: "zip",
      domain: "everyday",
      cluster: "wardrobe",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "seller said price and I said \"small small\" with confidence",
      whatToShow:
        "At a market-style setup, seller gives price. You bargain too low. Seller laughs. You laugh too like it was a joke.",
      howToFilm: PHONE_FILM,
      caption: "bargaining as performance.",
      anchor: "seller",
      domain: "everyday",
      cluster: "market_bargain",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I sent the wrong voice note and my soul left my body",
      whatToShow:
        "Fake chat shows voice note sent to the wrong person. You tap unsend repeatedly like speed can reverse history.",
      howToFilm: PHONE_FILM,
      caption: "wrong chat, correct panic.",
      anchor: "voice",
      domain: "everyday",
      cluster: "wrong_chat",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "I said I don chop while my stomach was doing meeting",
      whatToShow:
        "Someone offers food. You politely refuse. Your stomach makes noise while you look at the food too long.",
      howToFilm: KITCHEN_FILM,
      caption: "pride versus hunger.",
      anchor: "stomach",
      domain: "everyday",
      cluster: "food_refusal",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "elevator silence with your neighbor deserves background music",
      whatToShow:
        "Stand in an elevator with a neighbor. Both stare at the floor numbers. You almost speak, then don't.",
      howToFilm: PHONE_FILM,
      caption: "small talk refused to load.",
      anchor: "elevator",
      domain: "everyday",
      cluster: "elevator",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I forgot umbrella and rain did not forgive me",
      whatToShow:
        "Step outside. Rain hits. You run back in soaked, holding your phone like the only survivor.",
      howToFilm: DOOR_FILM,
      caption: "weather had agenda.",
      anchor: "rain",
      domain: "everyday",
      cluster: "rain",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "calling someone the wrong name in public has no recovery plan",
      whatToShow:
        "Greet someone loudly with the wrong name. Freeze when they correct you. Slowly pretend you were joking.",
      howToFilm: PHONE_FILM,
      caption: "confidence became evidence.",
      anchor: "name",
      domain: "everyday",
      cluster: "name_mixup",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "new shoe was fine at home, then started biting outside",
      whatToShow:
        "Walk confidently, then start limping slightly while pretending everything is normal.",
      howToFilm: PHONE_FILM,
      caption: "fashion with pain.",
      anchor: "shoe",
      domain: "everyday",
      cluster: "new_shoe",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I forgot their name mid-conversation and started speaking in circles",
      whatToShow:
        "Talk to someone, blank on their name, and replace it with 'you' and 'my guy' awkwardly.",
      howToFilm: PHONE_FILM,
      caption: "memory exited quietly.",
      anchor: "name",
      domain: "everyday",
      cluster: "forgot_name",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "\"I dey fine\" while looking like pending maintenance",
      whatToShow:
        "Someone asks how you are. You say 'fine' while clearly tired, holding too many things, or sitting in chaos.",
      howToFilm: COUCH_FILM,
      caption: "fine, according to official statement.",
      anchor: "fine",
      domain: "everyday",
      cluster: "i_dey_fine",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "waving at someone who was not waving at you is spiritual training",
      whatToShow:
        "Wave excitedly. Realize the person was greeting someone behind you. Slowly turn the wave into a head scratch.",
      howToFilm: PHONE_FILM,
      caption: "recovery by pretending.",
      anchor: "wave",
      domain: "everyday",
      cluster: "wrong_wave",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },

    // ════════════════════════════════════════════════════════════════
    // BATCH C (entries C1–C100) — third 100 candidates
    // Same rules as Batches A & B: NOT activated, NOT reviewed, INERT.
    // ════════════════════════════════════════════════════════════════

    // ─── C1–C19  WhatsApp / group chat / messages ─────────────────
    {
      hook: "why is everybody replying with stickers instead of words?",
      whatToShow:
        "You send a serious question in a fake family group. Everyone replies with laughing stickers, fire emojis, and dancing GIFs while you stare at the phone like the answer got kidnapped.",
      howToFilm: PHONE_FILM,
      caption: "communication has left the group.",
      anchor: "stickers",
      domain: "messaging",
      cluster: "stickers",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "no be every question need GIF reply o",
      whatToShow:
        "You ask 'who's free this weekend?' in a fake group chat. Friends reply with running-away GIFs and laughing reactions instead of answering.",
      howToFilm: PHONE_FILM,
      caption: "simple question, cinema reply.",
      anchor: "gif",
      domain: "messaging",
      cluster: "gif_war",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "you've been typing for 10 minutes and still sent nothing",
      whatToShow:
        "Close-up of a fake chat showing 'typing...' for too long. It stops, starts again, then disappears. You stare from bed like the conversation is doing suspense thriller.",
      howToFilm: BED_FILM,
      caption: "typing indicator with no evidence.",
      anchor: "typing",
      domain: "messaging",
      cluster: "typing_torture",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "you viewed my status but still no reply?",
      whatToShow:
        "Check your fake status viewers list. The same friend who ignored your message is at the top. You open the chat and zoom into their profile picture like it owes you explanation.",
      howToFilm: PHONE_FILM,
      caption: "viewer, not responder.",
      anchor: "status",
      domain: "messaging",
      cluster: "status_view_ghost",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "this group poll has turned into world war",
      whatToShow:
        "You create a simple lunch poll. People start arguing in voice notes while the votes keep changing. You slowly regret starting democracy.",
      howToFilm: PHONE_FILM,
      caption: "lunch became politics.",
      anchor: "poll",
      domain: "messaging",
      cluster: "poll_chaos",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "blue ticks don show, but reply no gree come",
      whatToShow:
        "You send a long fake message. Blue ticks appear immediately. You keep checking the chat while doing chores, pretending you are not checking.",
      howToFilm: PHONE_FILM,
      caption: "read receipt with pain.",
      anchor: "ticks",
      domain: "messaging",
      cluster: "blue_tick",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "one voice note turned into a full podcast",
      whatToShow:
        "Your friend sends one long fake voice note. You play it while cooking, then three more arrive. You pause with the spoon in your hand like the episode just got renewed.",
      howToFilm: KITCHEN_FILM,
      caption: "audio series I did not subscribe to.",
      anchor: "voice",
      domain: "messaging",
      cluster: "voice_note_marathon",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "wetin person delete for this group?",
      whatToShow:
        "Someone posts something in a fake group chat and deletes it instantly. Everyone starts asking what happened while you zoom into the deleted bubble.",
      howToFilm: PHONE_FILM,
      caption: "deleted message, public investigation.",
      anchor: "deleted",
      domain: "messaging",
      cluster: "deleted_message",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "one admin and the group becomes a courtroom",
      whatToShow:
        "You post one harmless meme. The admin warns you for 'off-topic' while actual spam keeps flying in the same group.",
      howToFilm: PHONE_FILM,
      caption: "justice is selective here.",
      anchor: "admin",
      domain: "messaging",
      cluster: "admin_power",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "no be every forward you suppose forward",
      whatToShow:
        "You receive a dramatic fake forwarded message. You hesitate, shake your head, then almost forward it before stopping yourself.",
      howToFilm: PHONE_FILM,
      caption: "forwarding requires self-control.",
      anchor: "forward",
      domain: "messaging",
      cluster: "forwarded_madness",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "the group remembered my birthday at midnight sharp",
      whatToShow:
        "At 12:01 a.m., fake birthday messages flood in. You wake up to 50 messages and stare like affection came with pressure.",
      howToFilm: BED_FILM,
      caption: "birthday notification ceremony.",
      anchor: "birthday",
      domain: "messaging",
      cluster: "birthday_flood",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "I mute the group but still dey open am every five minutes",
      whatToShow:
        "You mute a noisy fake group. Five minutes later, you open it yourself, laugh at your own lack of discipline, then keep scrolling.",
      howToFilm: PHONE_FILM,
      caption: "mute could not save me.",
      anchor: "mute",
      domain: "messaging",
      cluster: "muted_group",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "why are people reacting with hearts to my sad post?",
      whatToShow:
        "You post 'today was rough' in a fake group. People react with hearts and thumbs up. You stare at the screen like empathy needs training.",
      howToFilm: PHONE_FILM,
      caption: "wrong reaction, correct confusion.",
      anchor: "reaction",
      domain: "messaging",
      cluster: "reaction_confusion",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "she replied 'K' and my heart scattered",
      whatToShow:
        "Show a long sweet fake message you sent. The reply comes in as just 'K.' Your smile fades slowly while you screenshot it like evidence.",
      howToFilm: PHONE_FILM,
      caption: "one letter did damage.",
      anchor: "reply",
      domain: "messaging",
      cluster: "k_reply",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "one person left the group and now everybody is detective",
      whatToShow:
        "Fake group notification says someone exited. The chat immediately starts guessing who and why while you silently scroll like breaking news.",
      howToFilm: PHONE_FILM,
      caption: "exit turned to investigation.",
      anchor: "exit",
      domain: "messaging",
      cluster: "group_exit",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "you replied my status but ignored my DM?",
      whatToShow:
        "Friend replies to your status with an emoji, but your long message is still unread. You switch between the two screens like the math is not adding up.",
      howToFilm: PHONE_FILM,
      caption: "emoji came before accountability.",
      anchor: "emoji",
      domain: "messaging",
      cluster: "status_emoji",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "the poll results are not what we agreed on",
      whatToShow:
        "Fake group poll about weekend plans. Your vote loses badly. You type 'una no get joy,' pause, then delete it.",
      howToFilm: PHONE_FILM,
      caption: "democracy attacked my plans.",
      anchor: "poll",
      domain: "messaging",
      cluster: "poll_result",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "delivered for two hours is a special kind of stress",
      whatToShow:
        "You send an important fake message. It stays delivered but unread. You keep checking while eating, then lose appetite.",
      howToFilm: PHONE_FILM,
      caption: "delivered, not delivered emotionally.",
      anchor: "delivered",
      domain: "messaging",
      cluster: "delivered_anxiety",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "you dey online but no dey reply me",
      whatToShow:
        "Friend is online for 30 minutes but still has not replied. You watch the status like live sports.",
      howToFilm: PHONE_FILM,
      caption: "online without responsibility.",
      anchor: "online",
      domain: "messaging",
      cluster: "online_no_reply",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },

    // ─── C20–C33  Transport / going out ───────────────────────────
    {
      hook: "'Oshodi! Oshodi!' even when I'm going to Ikeja",
      whatToShow:
        "You enter a danfo setup. The conductor keeps shouting a destination that is clearly not yours while you try to correct him from the back.",
      howToFilm: PHONE_FILM,
      caption: "public transport with plot twist.",
      anchor: "danfo",
      domain: "transport",
      cluster: "danfo",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "'I know shortcut' is where the story started",
      whatToShow:
        "On an okada-style POV, the rider takes a rough shortcut. You hold tight and check your map like prayer has entered the journey.",
      howToFilm: PHONE_FILM,
      caption: "shortcut with consequences.",
      anchor: "shortcut",
      domain: "transport",
      cluster: "okada_shortcut",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "driver cancelled right when I saw his car",
      whatToShow:
        "Fake ride app says the driver is 30 seconds away. You see the car nearby. Then 'trip cancelled' appears. You look up like the sky owes answers.",
      howToFilm: PHONE_FILM,
      caption: "betrayal had headlights.",
      anchor: "driver",
      domain: "transport",
      cluster: "bolt_cancel",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "babe, I dey gate already",
      whatToShow:
        "You type 'I'm at the gate' while still tying your shoe and looking for keys inside the house.",
      howToFilm: PHONE_FILM,
      caption: "location by confidence.",
      anchor: "gate",
      domain: "transport",
      cluster: "gate_lie",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "traffic turned me into a content creator",
      whatToShow:
        "Stuck in traffic, you start recording yourself complaining. Another driver looks over and you immediately pretend you were checking camera settings.",
      howToFilm: PHONE_FILM,
      caption: "traffic gave me material.",
      anchor: "traffic",
      domain: "transport",
      cluster: "traffic_content",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "enter keke, e go fast — famous mistake",
      whatToShow:
        "You squeeze into a tight ride setup. Someone's bag, elbow, or food is too close. You look at the camera like speed came with suffering.",
      howToFilm: PHONE_FILM,
      caption: "quick journey, full experience.",
      anchor: "keke",
      domain: "transport",
      cluster: "keke_overload",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "'I'm almost there' said for the third time",
      whatToShow:
        "You are still at home eating or brushing. You send 'almost there' and check the time with panic in your eyes.",
      howToFilm: PHONE_FILM,
      caption: "almost is a flexible location.",
      anchor: "almost",
      domain: "transport",
      cluster: "almost_there",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "my driver arrived from the opposite direction",
      whatToShow:
        "You wait at the right pickup point. The fake map shows the driver passing you from the wrong side. You turn slowly like the app betrayed you.",
      howToFilm: PHONE_FILM,
      caption: "ride app with comedy timing.",
      anchor: "driver",
      domain: "transport",
      cluster: "wrong_pickup",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "last bus! run o!",
      whatToShow:
        "You sprint toward a bus at night. You enter just as it starts moving and sit down breathing like you escaped destiny.",
      howToFilm: PHONE_FILM,
      caption: "cardio by transport.",
      anchor: "bus",
      domain: "transport",
      cluster: "last_bus",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "Google said 15 minutes and lied with confidence",
      whatToShow:
        "Follow a fake map shortcut and end up at a dead end. You reverse slowly while staring at the map like it personally planned this.",
      howToFilm: PHONE_FILM,
      caption: "technology with audacity.",
      anchor: "map",
      domain: "transport",
      cluster: "maps_betrayal",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "oga drop me here every five minutes",
      whatToShow:
        "In a shared taxi setup, one passenger keeps asking to drop at every junction. Everyone else looks exhausted.",
      howToFilm: PHONE_FILM,
      caption: "journey by committee.",
      anchor: "passenger",
      domain: "transport",
      cluster: "passenger_argument",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "'I'm two minutes away' fifty minutes later",
      whatToShow:
        "You arrive at a restaurant or meetup spot sweating. The other person checks the time while you try to smile like traffic is a personality.",
      howToFilm: PHONE_FILM,
      caption: "arrival with evidence.",
      anchor: "minutes",
      domain: "transport",
      cluster: "date_arrival",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "make we take bike, e go quick",
      whatToShow:
        "Heavy rain starts mid-ride. You and the rider are soaked and laughing at the decision you both made.",
      howToFilm: PHONE_FILM,
      caption: "fast route, wet ending.",
      anchor: "bike",
      domain: "transport",
      cluster: "bike_rain",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I'm at the corner already",
      whatToShow:
        "You say the line while still two streets away, speed-walking and trying to sound calm on the phone.",
      howToFilm: PHONE_FILM,
      caption: "corner is a mindset.",
      anchor: "corner",
      domain: "transport",
      cluster: "corner_lie",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },

    // ─── C34–C47  Power / light / data / phone realities ──────────
    {
      hook: "light came for exactly seven minutes",
      whatToShow:
        "Power returns. You celebrate and plug in everything. Seven minutes later, darkness. You freeze with the charger still in your hand.",
      howToFilm: COUCH_FILM,
      caption: "joy had a timer.",
      anchor: "light",
      domain: "home",
      cluster: "light_tease",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "data don finish but Instagram still dey open",
      whatToShow:
        "Phone says no connection. You keep pulling to refresh anyway, then start searching for Wi-Fi like mercy might appear.",
      howToFilm: PHONE_FILM,
      caption: "hope is loading.",
      anchor: "data",
      domain: "phone",
      cluster: "data_finished",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "phone at 8% and I'm still watching reels",
      whatToShow:
        "Ignore the low battery warning and keep scrolling. The screen dims. Panic finally arrives.",
      howToFilm: BED_FILM,
      caption: "battery saver came late.",
      anchor: "battery",
      domain: "phone",
      cluster: "battery",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "generator dey sing better than my playlist",
      whatToShow:
        "Neighbor's generator roars while you try to sleep. You cover your head with a pillow, then remove it because heat has joined the matter.",
      howToFilm: BED_FILM,
      caption: "sleep with soundtrack.",
      anchor: "generator",
      domain: "home",
      cluster: "generator_noise",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "full 4G but nothing is loading",
      whatToShow:
        "You walk around the room holding your phone high. The bars are full, but the app refuses to move.",
      howToFilm: PHONE_FILM,
      caption: "signal without progress.",
      anchor: "network",
      domain: "phone",
      cluster: "network_bars",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "NEPA just did us dirty again",
      whatToShow:
        "You are charging your power bank. Power cuts. You stare at the socket like it betrayed the whole family.",
      howToFilm: COUCH_FILM,
      caption: "charging plan cancelled.",
      anchor: "light",
      domain: "home",
      cluster: "light_off",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "why now? I need to send this message",
      whatToShow:
        "You need to send something urgent. Your phone starts a long update. You stare at the progress bar like it controls your destiny.",
      howToFilm: PHONE_FILM,
      caption: "technology picked violence.",
      anchor: "update",
      domain: "phone",
      cluster: "phone_update",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "my data expires in 47 minutes",
      whatToShow:
        "You check fake data expiry and suddenly start downloading things you do not need.",
      howToFilm: PHONE_FILM,
      caption: "deadline made me productive.",
      anchor: "data",
      domain: "phone",
      cluster: "data_expiry",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "NEPA take light, phone torch became my spotlight",
      whatToShow:
        "Power outage. You use phone torch to move around the house and bump into furniture.",
      howToFilm: PHONE_FILM,
      caption: "night navigation by phone.",
      anchor: "torch",
      domain: "home",
      cluster: "torchlight",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "this charger only works when I respect its feelings",
      whatToShow:
        "Twist the charger cable into different angles. It finally charges. You freeze and hold the position like surgery.",
      howToFilm: DESK_FILM,
      caption: "charging by negotiation.",
      anchor: "charger",
      domain: "phone",
      cluster: "charger_angle",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "who dey use my data like this?",
      whatToShow:
        "Fake data usage screen shows one app used too much. You look at the phone like somebody must confess.",
      howToFilm: PHONE_FILM,
      caption: "data investigation unit.",
      anchor: "data",
      domain: "phone",
      cluster: "background_data",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "the exact moment I start frying, light goes",
      whatToShow:
        "Food is on the cooker. Power cuts. You stand with the spoon in your hand like dinner just entered suspense mode.",
      howToFilm: KITCHEN_FILM,
      caption: "cooking with plot twist.",
      anchor: "light",
      domain: "home",
      cluster: "cooking_blackout",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "phone 3% and I dey far from house",
      whatToShow:
        "You are outside with low battery. You turn on battery saver and start walking faster like speed can charge the phone.",
      howToFilm: PHONE_FILM,
      caption: "battery anxiety activated.",
      anchor: "battery",
      domain: "phone",
      cluster: "no_power_bank",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "inverter promised 6 hours and gave 40 minutes",
      whatToShow:
        "You trust the inverter during outage. It beeps and dies. You sit in darkness staring at it.",
      howToFilm: COUCH_FILM,
      caption: "power backup with vibes.",
      anchor: "inverter",
      domain: "home",
      cluster: "inverter",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },

    // ─── C48–C59  Food / home / roommate ──────────────────────────
    {
      hook: "who ate my leftovers and left the plate?",
      whatToShow:
        "Open the fridge expecting your food. Only an empty plate remains. You stare at it like the thief left a signature.",
      howToFilm: KITCHEN_FILM,
      caption: "evidence in the fridge.",
      anchor: "leftovers",
      domain: "home",
      cluster: "leftovers",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "my indomie pack don reduce overnight",
      whatToShow:
        "Open the cupboard. Half the packs are missing. You look toward your roommate like the case has suspects.",
      howToFilm: KITCHEN_FILM,
      caption: "noodle investigation.",
      anchor: "indomie",
      domain: "home",
      cluster: "indomie",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "hunger at 2 a.m. always meets an empty house",
      whatToShow:
        "Open fridge and cupboard. Only half an onion or stale bread appears. You close both slowly.",
      howToFilm: KITCHEN_FILM,
      caption: "midnight disappointment.",
      anchor: "hunger",
      domain: "home",
      cluster: "late_hunger",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I left small garri this morning...",
      whatToShow:
        "Reach for the garri bag. It is empty. You shake it once like more might appear.",
      howToFilm: KITCHEN_FILM,
      caption: "garri betrayed me.",
      anchor: "garri",
      domain: "home",
      cluster: "garri",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "the moment I cook, everybody appears",
      whatToShow:
        "You finish cooking alone. Roommates appear one by one asking what smells nice. You slowly guard the pot.",
      howToFilm: KITCHEN_FILM,
      caption: "food announced itself.",
      anchor: "cook",
      domain: "home",
      cluster: "cooking_attracts",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "my Maggi cubes don reduce again",
      whatToShow:
        "Open the spice box and count the cubes. Two are missing. You look at the house like everyone is lying.",
      howToFilm: KITCHEN_FILM,
      caption: "seasoning mystery.",
      anchor: "maggi",
      domain: "home",
      cluster: "maggi",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "food is 3 minutes away for one hour",
      whatToShow:
        "Fake delivery app says rider is close. You wait by the door, checking every few seconds while hunger becomes visible.",
      howToFilm: DOOR_FILM,
      caption: "delivery map with drama.",
      anchor: "delivery",
      domain: "home",
      cluster: "delivery_delay",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "bros, just one spoon na",
      whatToShow:
        "You sit with food. Roommate enters and starts negotiating for one spoon. You pull the plate closer.",
      howToFilm: COUCH_FILM,
      caption: "one spoon has agenda.",
      anchor: "spoon",
      domain: "home",
      cluster: "share_rice",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "NEPA take light, my meat don thaw",
      whatToShow:
        "Open freezer after outage. Food is thawing. You check the freezer, then the ceiling, then the clock.",
      howToFilm: KITCHEN_FILM,
      caption: "freezer under pressure.",
      anchor: "freezer",
      domain: "home",
      cluster: "freezer_thaw",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "who warmed fish in here again?",
      whatToShow:
        "Open the microwave and react to the smell. Look around the kitchen for the culprit.",
      howToFilm: KITCHEN_FILM,
      caption: "kitchen crime scene.",
      anchor: "microwave",
      domain: "home",
      cluster: "microwave_fish",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "no worry, I go buy my own next time",
      whatToShow:
        "Roommate finishes your snack. You say the line calmly, but your face stays on the empty wrapper too long.",
      howToFilm: COUCH_FILM,
      caption: "peace with pain.",
      anchor: "snack",
      domain: "home",
      cluster: "snacks",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "these plates have been there long enough to pay rent",
      whatToShow:
        "Show dirty plates. You and your roommate both enter, look at the sink, and slowly leave.",
      howToFilm: KITCHEN_FILM,
      caption: "shared kitchen diplomacy.",
      anchor: "sink",
      domain: "home",
      cluster: "sink_war",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },

    // ─── C60–C70  School / work / deadlines ───────────────────────
    {
      hook: "due in one hour and I'm still on page one",
      whatToShow:
        "Open laptop at 2 a.m. Blank document. You type the title like that counts as serious progress.",
      howToFilm: DESK_FILM,
      caption: "academic sprint begins.",
      anchor: "assignment",
      domain: "work",
      cluster: "assignment_panic",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "oga sent email at 11:58 p.m.",
      whatToShow:
        "You are about to sleep. Fake work email lands. You sit up slowly and open your laptop again.",
      howToFilm: BED_FILM,
      caption: "bedtime became office hours.",
      anchor: "email",
      domain: "work",
      cluster: "boss_email",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "they only appear when submission day arrives",
      whatToShow:
        "You did the project alone. On due date, group members suddenly message 'how far?'",
      howToFilm: DESK_FILM,
      caption: "teamwork by timing.",
      anchor: "project",
      domain: "work",
      cluster: "group_project",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "submission just closed",
      whatToShow:
        "You keep postponing. Refresh the portal and see 'closed.' Your hand freezes on the mouse.",
      howToFilm: DESK_FILM,
      caption: "later has consequences.",
      anchor: "submission",
      domain: "work",
      cluster: "portal_closed",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "Monday alarm hits different",
      whatToShow:
        "Alarm rings. You hit snooze five times while staring at the ceiling and creating excuses.",
      howToFilm: BED_FILM,
      caption: "Monday came prepared.",
      anchor: "alarm",
      domain: "work",
      cluster: "monday_alarm",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "working from home became working near the bed",
      whatToShow:
        "Laptop open beside you. Work tab is visible, but a show is clearly playing in the background.",
      howToFilm: BED_FILM,
      caption: "productivity with duvet.",
      anchor: "home",
      domain: "work",
      cluster: "wfh",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "camera off, I'm actually eating",
      whatToShow:
        "Join a fake Zoom meeting. Camera off, mic muted. You are quietly eating breakfast.",
      howToFilm: DESK_FILM,
      caption: "attendance without presence.",
      anchor: "camera",
      domain: "work",
      cluster: "zoom_camera_off",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "presentation in 5 minutes and I'm still editing",
      whatToShow:
        "Laptop shows messy slides. You keep adjusting one font while time runs out.",
      howToFilm: DESK_FILM,
      caption: "design under pressure.",
      anchor: "presentation",
      domain: "work",
      cluster: "presentation_panic",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "class group was dead until exam week",
      whatToShow:
        "Fake class chat is quiet for weeks. Suddenly hundreds of messages appear asking for past questions.",
      howToFilm: PHONE_FILM,
      caption: "academic emergency broadcast.",
      anchor: "class",
      domain: "work",
      cluster: "class_group",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "I'm in traffic but told them I'm already seated",
      whatToShow:
        "You reply work messages professionally while clearly stuck in traffic.",
      howToFilm: PHONE_FILM,
      caption: "remote presence by faith.",
      anchor: "traffic",
      domain: "work",
      cluster: "traffic_work_lie",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "review time makes everybody remember humility",
      whatToShow:
        "Boss calls you in. You walk in smiling professionally while wiping sweat off-camera.",
      howToFilm: DESK_FILM,
      caption: "confidence with small shaking.",
      anchor: "review",
      domain: "work",
      cluster: "performance_review",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },

    // ─── C71–C78  Family / social pressure ────────────────────────
    {
      hook: "Sunday lunch is not lunch, it is a relationship audit",
      whatToShow:
        "Family lunch setup. Aunty asks when you are bringing someone home. You focus too hard on your rice.",
      howToFilm: COUCH_FILM,
      caption: "rice did not ask me questions.",
      anchor: "lunch",
      domain: "family",
      cluster: "marriage_question",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "you no go marry this year?",
      whatToShow:
        "Family gathering. Aunties ask questions one after another. You smile like the ceiling has answers.",
      howToFilm: COUCH_FILM,
      caption: "interrogation with jollof.",
      anchor: "aunty",
      domain: "family",
      cluster: "aunty_pressure",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "mum's favorite weekend topic is my future",
      whatToShow:
        "You visit home. Mum brings out old photos and starts the 'you are not getting younger' speech.",
      howToFilm: COUCH_FILM,
      caption: "motivational pressure.",
      anchor: "mum",
      domain: "family",
      cluster: "mum_future",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "your mate don buy house already",
      whatToShow:
        "Mum shows a cousin's car or house photo. You stare at the phone like comparison has entered the room.",
      howToFilm: PHONE_FILM,
      caption: "family benchmarking.",
      anchor: "cousin",
      domain: "family",
      cluster: "cousin_comparison",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I brought one friend home and they became a case study",
      whatToShow:
        "Family starts asking your friend personal questions. You look at the camera like you caused a panel interview.",
      howToFilm: COUCH_FILM,
      caption: "introduction became investigation.",
      anchor: "friend",
      domain: "family",
      cluster: "friend_interview",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "Instagram weddings are not helping family meetings",
      whatToShow:
        "Scroll fake wedding posts. A relative peeks over your shoulder and immediately starts talking.",
      howToFilm: COUCH_FILM,
      caption: "timeline betrayed me.",
      anchor: "wedding",
      domain: "family",
      cluster: "ig_weddings",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "'who is the special person?' ruined the whole party",
      whatToShow:
        "Relatives ask the question. You smile, take a drink, and suddenly become interested in something across the room.",
      howToFilm: COUCH_FILM,
      caption: "topic change by survival.",
      anchor: "special",
      domain: "family",
      cluster: "special_person",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "aunty has one fine person for everybody",
      whatToShow:
        "Aunty shows a random profile on fake WhatsApp. You lean back like the phone is too close to destiny.",
      howToFilm: PHONE_FILM,
      caption: "matchmaking without consent.",
      anchor: "aunty",
      domain: "family",
      cluster: "matchmaking",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },

    // ─── C79–C88  Money / fake bank alert / cart ──────────────────
    {
      hook: "alert entered, but it was fake",
      whatToShow:
        "Show a fake credit alert. You celebrate for one second, then check fake balance and freeze.",
      howToFilm: PHONE_FILM,
      caption: "miracle without evidence.",
      anchor: "alert",
      domain: "money",
      cluster: "fake_alert",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_BANK_NOTE,
    },
    {
      hook: "I added everything, but account said no",
      whatToShow:
        "Fake cart is full. Checkout total appears. You begin removing items one by one with pain.",
      howToFilm: PHONE_FILM,
      caption: "cart versus reality.",
      anchor: "cart",
      domain: "money",
      cluster: "cart_overload",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_BANK_NOTE,
    },
    {
      hook: "'send me 1k' always sounds smaller than it feels",
      whatToShow:
        "Friend sends a fake money request. You send it, then immediately check your balance.",
      howToFilm: PHONE_FILM,
      caption: "generosity with aftershock.",
      anchor: "money",
      domain: "money",
      cluster: "small_money",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_BANK_NOTE,
    },
    {
      hook: "today is 25th... where is my salary?",
      whatToShow:
        "You refresh a fake banking app. Nothing drops. Refresh again. Still nothing.",
      howToFilm: PHONE_FILM,
      caption: "payday playing hard to get.",
      anchor: "salary",
      domain: "money",
      cluster: "salary_delay",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_BANK_NOTE,
    },
    {
      hook: "everything I like is too expensive",
      whatToShow:
        "Scroll nice items online. Add to wishlist, then close the app like wishlist equals ownership.",
      howToFilm: PHONE_FILM,
      caption: "shopping by imagination.",
      anchor: "wishlist",
      domain: "money",
      cluster: "wishlist",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "'next week' became next month",
      whatToShow:
        "Open fake chat with old repayment promise. Next message is a meme instead of money.",
      howToFilm: PHONE_FILM,
      caption: "debt with comedy timing.",
      anchor: "debt",
      domain: "money",
      cluster: "debt_promise",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
    {
      hook: "this ATM just swallowed my card",
      whatToShow:
        "Insert card. Machine keeps it. You stand there staring at the slot like negotiation might work.",
      howToFilm: PHONE_FILM,
      caption: "machine has chosen violence.",
      anchor: "atm",
      domain: "money",
      cluster: "atm_swallow",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_BANK_NOTE,
    },
    {
      hook: "machine no dey work again",
      whatToShow:
        "At a market counter setup, card payment fails three times. Seller's patience visibly disappears.",
      howToFilm: PHONE_FILM,
      caption: "payment method under trial.",
      anchor: "machine",
      domain: "money",
      cluster: "pos_failure",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_BANK_NOTE,
    },
    {
      hook: "I'm not broke, I'm just budgeting",
      whatToShow:
        "Show a very simple meal for the fifth day while you nod like the plan is financial discipline.",
      howToFilm: KITCHEN_FILM,
      caption: "budgeting with confidence.",
      anchor: "budget",
      domain: "money",
      cluster: "budget",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "salary finally dropped",
      whatToShow:
        "Alert lands. You smile, then open a list of bills and watch your smile reduce line by line.",
      howToFilm: PHONE_FILM,
      caption: "salary came to visit.",
      anchor: "salary",
      domain: "money",
      cluster: "salary_day",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_BANK_NOTE,
    },

    // ─── C89–C100  Creator / social media behavior ────────────────
    {
      hook: "the algorithm saw my video and said 'nah'",
      whatToShow:
        "Fake analytics shows low views after a day. You refresh, pause, refresh again, then place the phone down gently.",
      howToFilm: PHONE_FILM,
      caption: "algorithm needs explanation.",
      anchor: "algorithm",
      domain: "creator",
      cluster: "algorithm",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I said I don't care, then refreshed twenty times",
      whatToShow:
        "Show fake post screen. Overlay 'I don't care.' Your thumb refreshes again and again.",
      howToFilm: PHONE_FILM,
      caption: "lie with analytics.",
      anchor: "views",
      domain: "creator",
      cluster: "views_refresh",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "this is take 38 and somehow the first one was better",
      whatToShow:
        "Record the same clip repeatedly. Watch the latest take, sigh, then scroll back to the first one.",
      howToFilm: DESK_FILM,
      caption: "perfection wasting storage.",
      anchor: "take",
      domain: "creator",
      cluster: "many_takes",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "caption dey harder than the video itself",
      whatToShow:
        "Finished video ready. You type, delete, and retype captions while the post screen stays open.",
      howToFilm: PHONE_FILM,
      caption: "caption humbled me.",
      anchor: "caption",
      domain: "creator",
      cluster: "caption_struggle",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "everybody is doing the trend and my body refused",
      whatToShow:
        "Try a trend alone in your room. Pause the tutorial, attempt one move, then rewind immediately.",
      howToFilm: PHONE_FILM,
      caption: "trend joined my enemies.",
      anchor: "trend",
      domain: "creator",
      cluster: "trend_fail",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I don edit this video for four hours",
      whatToShow:
        "Final video is open. Your finger hovers over post. You lock the phone, unlock it, and hover again.",
      howToFilm: PHONE_FILM,
      caption: "courage loading forever.",
      anchor: "post",
      domain: "creator",
      cluster: "post_fear",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "opening comments after posting is emotional gambling",
      whatToShow:
        "Post goes live. You open comments slowly, holding the phone farther away like distance will protect you.",
      howToFilm: PHONE_FILM,
      caption: "comment section anxiety.",
      anchor: "comments",
      domain: "creator",
      cluster: "comment_anxiety",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "camera rolling but brain empty",
      whatToShow:
        "Sit in front of ring light ready to film. Smile fades when no idea comes. You slowly stop recording.",
      howToFilm: DESK_FILM,
      caption: "camera ready, brain absent.",
      anchor: "camera",
      domain: "creator",
      cluster: "blank_brain",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "gained 3, lost 5 in one hour",
      whatToShow:
        "Check fake follower count. It goes up, then down. You stare like the numbers are playing with you.",
      howToFilm: PHONE_FILM,
      caption: "growth with plot twist.",
      anchor: "followers",
      domain: "creator",
      cluster: "follower_count",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I tagged everybody and got zero shares",
      whatToShow:
        "Fake post shows many tagged friends. Activity stays empty. You stare at the screen like loyalty is under review.",
      howToFilm: PHONE_FILM,
      caption: "tag list without results.",
      anchor: "tag",
      domain: "creator",
      cluster: "tag_friends",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I need a break, but content is looking at me",
      whatToShow:
        "You look tired, then still set up the ring light. Turn it on and stare into it like it started the problem.",
      howToFilm: DESK_FILM,
      caption: "creator rest is complicated.",
      anchor: "burnout",
      domain: "creator",
      cluster: "burnout",
      pidginLevel: "clean",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I sent the voice note to my boss instead",
      whatToShow:
        "Fake chat shows a voice note sent to the wrong person. You tap unsend repeatedly like speed can reverse history.",
      howToFilm: PHONE_FILM,
      caption: "wrong chat, correct panic.",
      anchor: "voice",
      domain: "messaging",
      cluster: "wrong_chat",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_CHAT_NOTE,
    },
// ─── BATCH B (BI 2026-05-06) ──────────────────────────
    {
      hook: "NEPA blink once, everybody start prayer.",
      whatToShow:
        "You hear one small spark near transformer. NEPA blink again. Papa runs to inverter, madam grabs charger, you just stand there like hope still dey.",
      howToFilm: KITCHEN_FILM,
      caption: "joy came for 3 seconds.",
      anchor: "nepa",
      domain: "home",
      cluster: "power",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "bucket full halfway, I start feeling rich.",
      whatToShow:
        "Tap is dropping small-small. You guard the bucket like gold while iya keeps bringing more containers.",
      howToFilm: KITCHEN_FILM,
      caption: "water wealth loading.",
      anchor: "bucket",
      domain: "everyday",
      cluster: "home",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "kerosene seller called price, I greeted him \"sir.\"",
      whatToShow:
        "You carry small bottle to buy kerosene. Seller mentions amount, you quietly reduce your cooking ambition.",
      howToFilm: KITCHEN_FILM,
      caption: "fire now has class.",
      anchor: "kerosene",
      domain: "everyday",
      cluster: "home",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "gala entered bus, my stomach betrayed me.",
      whatToShow:
        "You promised yourself no spending. Gala seller passes by, and your hand starts moving without permission.",
      howToFilm: KITCHEN_FILM,
      caption: "discipline left the bus.",
      anchor: "gala",
      domain: "everyday",
      cluster: "food",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "puff-puff small, but price get boldness.",
      whatToShow:
        "Madam gives you three tiny puff-puff in nylon. You look inside twice to confirm they're not hiding.",
      howToFilm: KITCHEN_FILM,
      caption: "where the rest dey?",
      anchor: "puff-puff",
      domain: "everyday",
      cluster: "food",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "I bought meat-pie, now I'm searching for evidence.",
      whatToShow:
        "You buy meat-pie and break it open slowly. You break it open slowly. One tiny filling appears, then disappears like magic trick.",
      howToFilm: KITCHEN_FILM,
      caption: "meat entered exile.",
      anchor: "meat-pie",
      domain: "everyday",
      cluster: "food",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "okra no dey break up peacefully.",
      whatToShow:
        "You scoop okra from plate. It stretches from spoon to mouth like it's begging not to leave.",
      howToFilm: KITCHEN_FILM,
      caption: "this soup has attachment.",
      anchor: "okra",
      domain: "everyday",
      cluster: "food",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "egusi now deserves security escort.",
      whatToShow:
        "Papa sees you taking extra egusi and clears throat. You return one spoon like tax payment.",
      howToFilm: KITCHEN_FILM,
      caption: "premium soup behavior.",
      anchor: "egusi",
      domain: "everyday",
      cluster: "food",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "bukka smell dragged me inside by force.",
      whatToShow:
        "You walk past bukka with strong mind. One aroma of stew and egusi hits you, and your legs turn back.",
      howToFilm: KITCHEN_FILM,
      caption: "my nose made the decision.",
      anchor: "bukka",
      domain: "everyday",
      cluster: "food",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "agbero greeted me and my pocket got scared.",
      whatToShow:
        "You step down from bus. Agbero smiles too nicely, and you already know payment discussion is coming.",
      howToFilm: COUCH_FILM,
      caption: "that smile has charges.",
      anchor: "agbero",
      domain: "everyday",
      cluster: "people",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "marketer said \"sample,\" now I'm holding three products.",
      whatToShow:
        "You stop for one second. Marketer puts cream on your hand, powder on your wrist, and price in your heart.",
      howToFilm: COUCH_FILM,
      caption: "eye contact was the mistake.",
      anchor: "marketer",
      domain: "everyday",
      cluster: "people",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "iya said no change, but I heard coins.",
      whatToShow:
        "You buy akara. Iya claims no change while her tray is making coin sound. You both just stare.",
      howToFilm: COUCH_FILM,
      caption: "coins are hiding.",
      anchor: "change",
      domain: "everyday",
      cluster: "people",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "papa bought fuel and became household president.",
      whatToShow:
        "He measures fuel small-small, locks the container, and warns everybody like national address.",
      howToFilm: KITCHEN_FILM,
      caption: "fuel has entered VIP.",
      anchor: "fuel",
      domain: "home",
      cluster: "power",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "oga said transfer is coming, POS madam said \"I'm watching.\"",
      whatToShow:
        "Oga sends transfer. POS madam folds arms and waits for beep like exam result.",
      howToFilm: DESK_FILM,
      caption: "payment tension.",
      anchor: "transfer",
      domain: "money",
      cluster: "money",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_BANK_NOTE,
    },
    {
      hook: "madam priced pepper like she came with army.",
      whatToShow:
        "Seller says one amount. Madam laughs, adjusts her wrapper, and starts negotiation like court case.",
      howToFilm: COUCH_FILM,
      caption: "price must fall.",
      anchor: "madam",
      domain: "everyday",
      cluster: "people",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "danfo had one space, conductor said three people can fit.",
      whatToShow:
        "You look at the seat. Conductor keeps saying \"shift small\" until everybody becomes folded paper.",
      howToFilm: DOOR_FILM,
      caption: "human arrangement.",
      anchor: "conductor",
      domain: "transport",
      cluster: "transport",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "conductor heard balance and started looking at sky.",
      whatToShow:
        "You ask for your money. Conductor suddenly becomes busy counting passengers that don't exist.",
      howToFilm: DESK_FILM,
      caption: "my change has travelled.",
      anchor: "conductor",
      domain: "money",
      cluster: "money",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_BANK_NOTE,
    },
    {
      hook: "transformer made sound, every papa became engineer.",
      whatToShow:
        "One noise outside. Papa, oga, and madam gather from far, giving advice nobody asked for.",
      howToFilm: KITCHEN_FILM,
      caption: "street engineering meeting.",
      anchor: "papa",
      domain: "home",
      cluster: "power",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "gen came on, landlord started walking slow.",
      whatToShow:
        "The compound hears gen sound. Landlord stands near it proudly like he invented electricity.",
      howToFilm: KITCHEN_FILM,
      caption: "power with attitude.",
      anchor: "gen",
      domain: "home",
      cluster: "power",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "fuel line turned my fresh face to experience.",
      whatToShow:
        "You join the fuel line. You arrive looking neat. After a while, your smile disappears and your slippers start collecting dust.",
      howToFilm: KITCHEN_FILM,
      caption: "I came with hope.",
      anchor: "fuel",
      domain: "home",
      cluster: "power",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "bole seller added pepper, my eyes started negotiation.",
      whatToShow:
        "You buy bole and ask for small pepper. Seller adds one dangerous scoop. You smile with fear.",
      howToFilm: KITCHEN_FILM,
      caption: "bravery has limit.",
      anchor: "pepper",
      domain: "everyday",
      cluster: "food",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "suya man said \"one thousand,\" I started counting onion.",
      whatToShow:
        "You order suya. The meat is small, onion is plenty, but the smell still makes you respect it.",
      howToFilm: KITCHEN_FILM,
      caption: "onion with meat decoration.",
      anchor: "suya",
      domain: "everyday",
      cluster: "food",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "akara seller knows everybody except me.",
      whatToShow:
        "You wait patiently. Three people arrive after you and iya at the akara tray says they booked earlier.",
      howToFilm: KITCHEN_FILM,
      caption: "invisible booking system.",
      anchor: "akara",
      domain: "everyday",
      cluster: "food",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "moimoi opened, no egg, no fish, just silence.",
      whatToShow:
        "You peel the leaf slowly with hope. Inside is plain moimoi staring back at you.",
      howToFilm: KITCHEN_FILM,
      caption: "expectation crashed.",
      anchor: "moimoi",
      domain: "everyday",
      cluster: "food",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "pure-water cold small, my whole mood changed.",
      whatToShow:
        "You buy sachet pure-water after long walk. First sip enters, and you smile like life has improved.",
      howToFilm: KITCHEN_FILM,
      caption: "small joy, big relief.",
      anchor: "pure-water",
      domain: "everyday",
      cluster: "home",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "sachet refused to tear, my teeth entered work.",
      whatToShow:
        "You try to open sachet water with hand. It refuses. You look left and right, then use teeth like tradition.",
      howToFilm: KITCHEN_FILM,
      caption: "modern problem, old solution.",
      anchor: "sachet",
      domain: "everyday",
      cluster: "home",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "tray on iya head has better control than my budget.",
      whatToShow:
        "Iya walks with tray of akara and moimoi without shaking. You carry small nylon and almost stumble.",
      howToFilm: DESK_FILM,
      caption: "balance queen.",
      anchor: "tray",
      domain: "money",
      cluster: "money",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_BANK_NOTE,
    },
    {
      hook: "inverter beeped once, everybody reduced confidence.",
      whatToShow:
        "Charger in socket. Inverter makes one tiny beep. You unplug fast like you touched government property.",
      howToFilm: KITCHEN_FILM,
      caption: "power is warning us.",
      anchor: "inverter",
      domain: "home",
      cluster: "power",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "prepaid meter showing low unit is emotional attack.",
      whatToShow:
        "You check meter and see small number. Suddenly nobody is allowed near socket again.",
      howToFilm: KITCHEN_FILM,
      caption: "unit discipline begins.",
      anchor: "meter",
      domain: "home",
      cluster: "power",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "meter looked calm, but I no trust am.",
      whatToShow:
        "You pass near prepaid meter and check it twice. The number still low, so you switch off everything near you.",
      howToFilm: KITCHEN_FILM,
      caption: "silent danger.",
      anchor: "meter",
      domain: "home",
      cluster: "power",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "token is 20 digits, but my finger chose violence.",
      whatToShow:
        "You enter token carefully. One wrong number spoils everything, and you start again with serious face.",
      howToFilm: KITCHEN_FILM,
      caption: "one digit, full pain.",
      anchor: "token",
      domain: "home",
      cluster: "power",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "ATM line has one person pressing button like piano.",
      whatToShow:
        "You wait behind someone at ATM. They keep pressing, canceling, and starting again while everyone sighs.",
      howToFilm: DESK_FILM,
      caption: "uncle, decide abeg.",
      anchor: "atm",
      domain: "money",
      cluster: "money",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_BANK_NOTE,
    },
    {
      hook: "transfer successful, but seller's face said no.",
      whatToShow:
        "You show receipt. Seller says \"I never see am.\" You both wait for beep like final judgment.",
      howToFilm: DESK_FILM,
      caption: "money is on journey.",
      anchor: "seller",
      domain: "money",
      cluster: "money",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_BANK_NOTE,
    },
    {
      hook: "beep sounded and POS madam finally smiled.",
      whatToShow:
        "You pay with transfer. Everyone waits quietly. Beep comes, and madam's whole face relaxes.",
      howToFilm: DESK_FILM,
      caption: "peace restored.",
      anchor: "madam",
      domain: "money",
      cluster: "money",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_BANK_NOTE,
    },
    {
      hook: "recharge card lost two numbers, now I'm guessing destiny.",
      whatToShow:
        "You buy a recharge card. You scratch too hard. Two digits vanish. You start trying combinations like secret code.",
      howToFilm: DESK_FILM,
      caption: "scratch with regret.",
      anchor: "recharge",
      domain: "money",
      cluster: "money",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_BANK_NOTE,
    },
    {
      hook: "bundle finished faster than gala in bus.",
      whatToShow:
        "You buy bundle. You open one app, watch small thing, and balance starts looking empty.",
      howToFilm: DESK_FILM,
      caption: "where did it run?",
      anchor: "bundle",
      domain: "money",
      cluster: "money",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_BANK_NOTE,
    },
    {
      hook: "charger in public place has no real owner.",
      whatToShow:
        "You plug charger into socket. One person says \"just small,\" another says \"my own is urgent.\"",
      howToFilm: KITCHEN_FILM,
      caption: "socket politics.",
      anchor: "charger",
      domain: "home",
      cluster: "power",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "cart full like I'm rich, account quiet like village road.",
      whatToShow:
        "You add shoes, slides, and fine shirt to cart. Total appears, and you quietly remove everything.",
      howToFilm: DESK_FILM,
      caption: "shopping by imagination.",
      anchor: "cart",
      domain: "money",
      cluster: "money",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_BANK_NOTE,
    },
    {
      hook: "bus window seat can test friendship.",
      whatToShow:
        "You and your friend enter bus. One window seat remains. Both of you smile fake and move faster.",
      howToFilm: DOOR_FILM,
      caption: "love has limit.",
      anchor: "bus",
      domain: "transport",
      cluster: "transport",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "bike man said price, I checked if we're flying.",
      whatToShow:
        "You ask short distance fare. Bike rider calls big amount. You look at the road like maybe it changed.",
      howToFilm: DOOR_FILM,
      caption: "small trip, big bill.",
      anchor: "bike",
      domain: "transport",
      cluster: "transport",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "one socket, five chargers, zero peace.",
      whatToShow:
        "Five chargers fight for one socket. Everyone brings charger at once. Papa wants his own, madam wants hers, you guard your percentage with seriousness.",
      howToFilm: KITCHEN_FILM,
      caption: "family power battle.",
      anchor: "charger",
      domain: "home",
      cluster: "power",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "POS madam said charge, my smile disappeared.",
      whatToShow:
        "You withdraw small cash. POS madam adds charge that feels too personal. You collect money with pain.",
      howToFilm: DESK_FILM,
      caption: "withdrawal plus heartbreak.",
      anchor: "madam",
      domain: "money",
      cluster: "money",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_BANK_NOTE,
    },
    {
      hook: "I bought airtime instead of bundle and started advising myself.",
      whatToShow:
        "You recharge wrong option. Airtime enters proudly while you stare like \"who will I call?\"",
      howToFilm: DESK_FILM,
      caption: "wrong blessing.",
      anchor: "airtime",
      domain: "money",
      cluster: "money",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_BANK_NOTE,
    },
    {
      hook: "keke driver said \"enter,\" but space said no.",
      whatToShow:
        "Three people already inside keke. Driver still waves you in like your body can compress.",
      howToFilm: DOOR_FILM,
      caption: "science experiment.",
      anchor: "keke",
      domain: "transport",
      cluster: "transport",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "slippers cut in public and my pride followed it.",
      whatToShow:
        "You walk confidently. One slippers strap snaps. You start dragging leg like slow-motion movie.",
      howToFilm: DOOR_FILM,
      caption: "movement downgraded.",
      anchor: "slippers",
      domain: "transport",
      cluster: "transport",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "slides made sound and announced my arrival.",
      whatToShow:
        "You try to walk quietly. Slides keeps slapping floor and everybody turns to look.",
      howToFilm: DOOR_FILM,
      caption: "fashion with volume.",
      anchor: "slides",
      domain: "transport",
      cluster: "transport",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "Okada moved small, I held rider like family.",
      whatToShow:
        "Okada starts fast. You pretend to be brave, but your hands grip the back iron with full respect.",
      howToFilm: DOOR_FILM,
      caption: "confidence reduced.",
      anchor: "okada",
      domain: "transport",
      cluster: "transport",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "conductor gave me torn note and called it balance.",
      whatToShow:
        "You collect change in danfo. One note looks tired. You try returning it, conductor already moved away.",
      howToFilm: DOOR_FILM,
      caption: "money with history.",
      anchor: "conductor",
      domain: "transport",
      cluster: "transport",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "madam counted my suya pieces like tax officer.",
      whatToShow:
        "You bring suya home. Madam opens wrap, counts pieces, and asks why onion is plenty.",
      howToFilm: KITCHEN_FILM,
      caption: "suya investigation.",
      anchor: "madam",
      domain: "everyday",
      cluster: "food",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "papa at ATM presses cancel like it owes him money.",
      whatToShow:
        "Papa tries to withdraw. Machine delays small. He presses buttons with full authority and blames the bank.",
      howToFilm: DESK_FILM,
      caption: "technology vs papa.",
      anchor: "papa",
      domain: "money",
      cluster: "money",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
      privacyNote: FAKE_BANK_NOTE,
    },
// ─── BATCH C (BI 2026-05-06) — phone/work/social/content rebalance ──
    {
      hook: "data no dey stay long once scroll enter.",
      whatToShow:
        "You say you'll use small-small. One tiny scroll later, the data warning appears and you stare like the app robbed you politely.",
      howToFilm: PHONE_FILM,
      caption: "data dey evaporate for this country.",
      anchor: "data",
      domain: "phone",
      cluster: "messages",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "network waits till serious moment before it starts drama.",
      whatToShow:
        "You try to send one urgent message. The network loading circle keeps turning while your face slowly loses patience.",
      howToFilm: PHONE_FILM,
      caption: "na when you need am pass e dey hide.",
      anchor: "network",
      domain: "phone",
      cluster: "messages",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "signal get one special corner like shrine.",
      whatToShow:
        "You move around the room with your hand raised. One tiny corner finally works, and you freeze there like statue.",
      howToFilm: PHONE_FILM,
      caption: "sacred place of connection.",
      anchor: "corner",
      domain: "phone",
      cluster: "messages",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "wifi password don become visitor's first greeting.",
      whatToShow:
        "Visitor greets small, sits down, then immediately asks, \"abeg, wifi still dey?\"",
      howToFilm: PHONE_FILM,
      caption: "greeting first, password second.",
      anchor: "wifi",
      domain: "phone",
      cluster: "messages",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "hotspot request fit test real friendship.",
      whatToShow:
        "Friend asks for hotspot \"just two minutes.\" You look away for one second and they are already doing heavy browsing.",
      howToFilm: PHONE_FILM,
      caption: "small hotspot, big damage.",
      anchor: "hotspot",
      domain: "phone",
      cluster: "messages",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "one innocent dm don start full investigation.",
      whatToShow:
        "One message enters your dm. Somebody nearby sees your face change and starts asking who sent the dm investigation.",
      howToFilm: PHONE_FILM,
      caption: "dm no dey stay private.",
      anchor: "investigation",
      domain: "messaging",
      cluster: "messages",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "status complete, reply still missing.",
      whatToShow:
        "You check your status viewers. The same person who ignored your chat watched every slide.",
      howToFilm: PHONE_FILM,
      caption: "active ghosting.",
      anchor: "status",
      domain: "messaging",
      cluster: "messages",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "voicenote pass five minutes? that one na episode.",
      whatToShow:
        "Person sends a long voicenote. You press play, sit well, and prepare like lecture has started.",
      howToFilm: PHONE_FILM,
      caption: "abeg summarize am.",
      anchor: "voicenote",
      domain: "phone",
      cluster: "messages",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "extra shift entered and my smile reduced.",
      whatToShow:
        "You're already preparing to leave. Manager casually says someone needs to cover one more shift.",
      howToFilm: DESK_FILM,
      caption: "joy cancelled immediately.",
      anchor: "shift",
      domain: "work",
      cluster: "work",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "timesheet long pass the actual energy.",
      whatToShow:
        "You fill your timesheet with full seriousness, then stare at the hours like the week used you.",
      howToFilm: DESK_FILM,
      caption: "full effort, soft reward.",
      anchor: "timesheet",
      domain: "work",
      cluster: "work",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "deadline makes keyboard sound louder.",
      whatToShow:
        "Morning is calm. By evening, everyone is typing like competition because deadline has entered the room.",
      howToFilm: DESK_FILM,
      caption: "panic with professionalism.",
      anchor: "deadline",
      domain: "work",
      cluster: "work",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "salary-day morning sweet pass normal morning.",
      whatToShow:
        "You wake up with unusual patience, checking notifications like salary-day good news is warming up somewhere.",
      howToFilm: DESK_FILM,
      caption: "hope first, confirmation later.",
      anchor: "salary-day",
      domain: "work",
      cluster: "work",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "once I mention leave, manager starts smiling somehow.",
      whatToShow:
        "You ask for leave politely. Manager starts talking about \"team commitment\" and \"timing.\"",
      howToFilm: DESK_FILM,
      caption: "leave wey no wan leave.",
      anchor: "manager",
      domain: "work",
      cluster: "work",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "manager passing your side can reset your posture.",
      whatToShow:
        "You're relaxed one second. Manager walks by, and you suddenly sit straighter than school prefect.",
      howToFilm: DESK_FILM,
      caption: "instant office discipline.",
      anchor: "manager",
      domain: "work",
      cluster: "work",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "intern entered smiling, office reality was waiting.",
      whatToShow:
        "Intern arrives with fresh energy. Suddenly everyone is giving instructions like orientation became survival training.",
      howToFilm: DESK_FILM,
      caption: "welcome to real life.",
      anchor: "intern",
      domain: "work",
      cluster: "work",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "wedding-list long enough to humble anybody.",
      whatToShow:
        "You open the wedding-list and keep scrolling, wondering if you were invited as guest or committee member.",
      howToFilm: COUCH_FILM,
      caption: "celebration with assignment.",
      anchor: "wedding-list",
      domain: "family",
      cluster: "family",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "asoebi message landed and my group chat went quiet.",
      whatToShow:
        "The asoebi details enter the chat. Everybody reads it, but nobody wants to be the first to react.",
      howToFilm: COUCH_FILM,
      caption: "style with pressure.",
      anchor: "asoebi",
      domain: "family",
      cluster: "family",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "naming ceremony no dey small for our side.",
      whatToShow:
        "They say \"just come for naming.\" You arrive and it looks like full event with chairs, food, and loud gist.",
      howToFilm: COUCH_FILM,
      caption: "baby just arrived, everybody gathered.",
      anchor: "naming",
      domain: "family",
      cluster: "family",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "in-laws coming can change everybody's behavior.",
      whatToShow:
        "One message says in-laws are coming. Suddenly everyone becomes polite, arranged, and extra responsible.",
      howToFilm: COUCH_FILM,
      caption: "emergency respect mode.",
      anchor: "in-laws",
      domain: "family",
      cluster: "family",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "party said 2pm, but 2pm was suggestion.",
      whatToShow:
        "You dress for the party early. arrive on time. Only decorators and two confused chairs are around.",
      howToFilm: COUCH_FILM,
      caption: "punctuality punished.",
      anchor: "party",
      domain: "family",
      cluster: "family",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "\"I no get gist\" is how the biggest gist starts.",
      whatToShow:
        "Someone says they have nothing to say. Thirty minutes later, everybody is leaning forward, gist flowing.",
      howToFilm: COUCH_FILM,
      caption: "gist has no brakes.",
      anchor: "gist",
      domain: "family",
      cluster: "family",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "condolence gathering still get that one person asking questions.",
      whatToShow:
        "At the condolence gathering, the mood is serious. People are speaking softly, and one person is already whispering about who came late.",
      howToFilm: COUCH_FILM,
      caption: "gist no dey respect timing.",
      anchor: "condolence",
      domain: "family",
      cluster: "family",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "thumbnail face no dey match real life.",
      whatToShow:
        "You take a thumbnail (content cover photo) and choose the one where your eyes are widest like surprise ambassador.",
      howToFilm: PHONE_FILM,
      caption: "drama for visibility.",
      anchor: "thumbnail",
      domain: "creator",
      cluster: "creator",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "one simple video don turn ten retake.",
      whatToShow:
        "You start confidently, miss one word, laugh, start a retake, and now the whole room is tired with you.",
      howToFilm: PHONE_FILM,
      caption: "last one\" part nine.",
      anchor: "retake",
      domain: "creator",
      cluster: "creator",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "tripod waits for inspiration before it starts shaking.",
      whatToShow:
        "You set up to record. The moment you step back with confidence, the tripod bends small and your peace disappears.",
      howToFilm: PHONE_FILM,
      caption: "stable in theory.",
      anchor: "tripod",
      domain: "creator",
      cluster: "creator",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "lightring on, confidence don increase.",
      whatToShow:
        "Normal room suddenly looks premium. You switch on the lightring and start posing like brand ambassador.",
      howToFilm: PHONE_FILM,
      caption: "soft glow, big confidence.",
      anchor: "lightring",
      domain: "creator",
      cluster: "creator",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "mic in hand can turn small talk to announcement.",
      whatToShow:
        "You hold mic for a skit and immediately start speaking like host of serious program.",
      howToFilm: PHONE_FILM,
      caption: "tiny mic, giant authority.",
      anchor: "mic",
      domain: "creator",
      cluster: "creator",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "the exact clip you need don disappear.",
      whatToShow:
        "You're ready to finish content, but you keep scrolling through old clip takes like treasure hunt.",
      howToFilm: PHONE_FILM,
      caption: "hidden inside random clips.",
      anchor: "clip",
      domain: "creator",
      cluster: "creator",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "edit sweet at first, later na eye pain.",
      whatToShow:
        "You start excited, editing — trimming and arranging. After a while, every version looks the same and your brain wants rest.",
      howToFilm: PHONE_FILM,
      caption: "creator suffering quietly.",
      anchor: "edit",
      domain: "creator",
      cluster: "creator",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
    {
      hook: "batch content sounds smart until tiredness lands.",
      whatToShow:
        "You plan to batch shoot many videos at once. By the third one, your smile is working on contract.",
      howToFilm: PHONE_FILM,
      caption: "productivity with stress.",
      anchor: "batch",
      domain: "creator",
      cluster: "creator",
      pidginLevel: "light_pidgin",
      reviewedBy: "BI 2026-05-06",
    },
  ]);

// ---------------------------------------------------------------- //
// Draft-pack integrity assert. Structural-only. Native reviewer is
// responsible for anchor-in-text validity, mocking-spelling review,
// and final tier classification.
// ---------------------------------------------------------------- //

const DRAFT_HOOK_MAX = 120;
const DRAFT_WTS_MIN = 20;
const DRAFT_WTS_MAX = 500;
const DRAFT_HTF_MIN = 15;
const DRAFT_HTF_MAX = 400;
const DRAFT_CAP_MIN = 1;
const DRAFT_CAP_MAX = 280;

export type DraftIntegrityIssue = {
  readonly index: number;
  readonly hookSnippet: string;
  readonly reason: string;
};

/** Returns the list of issues; empty list = clean. Does NOT throw —
 *  drafts are by definition unfinished, and we want to surface ALL
 *  problems for reviewer triage rather than fail at the first one.
 *  The companion `assertNigerianDraftPackIntegrity` throws when ANY
 *  issue is present, which is what the boot path uses. */
export function checkNigerianDraftPackIntegrity(
  pack: readonly DraftNigerianPackEntry[],
): readonly DraftIntegrityIssue[] {
  const issues: DraftIntegrityIssue[] = [];
  pack.forEach((e, i) => {
    const tag = (e.hook ?? "").slice(0, 40);
    const push = (reason: string) =>
      issues.push({ index: i, hookSnippet: tag, reason });

    // Draft-layer reviewedBy rules — TIGHTENED per BI 2026-05-06
    // ingest. After the 300-draft stamping pass every draft carries a
    // real reviewer initials+date stamp; the legacy PENDING sentinel
    // is no longer accepted at the draft layer either, so a reviewer
    // can't accidentally regress a row to "unreviewed" without the
    // boot assert tripping.
    //   • must be a non-empty trimmed string
    //   • must NOT equal the PENDING_NATIVE_REVIEW sentinel
    //   • must NOT start with `AGENT-PROPOSED` (those need reviewer
    //     overwrite before promotion)
    const stamp = (e.reviewedBy ?? "").trim();
    if (stamp.length === 0) {
      push("reviewedBy missing or whitespace-only");
    } else if (stamp === PENDING_NATIVE_REVIEW) {
      push(
        `reviewedBy is the PENDING_NATIVE_REVIEW sentinel — every ` +
          `draft must carry a real reviewer stamp (e.g. 'BI 2026-05-06')`,
      );
    } else if (stamp.startsWith("AGENT-PROPOSED")) {
      push(
        `reviewedBy carries AGENT-PROPOSED prefix — needs reviewer ` +
          `overwrite before promotion (got '${e.reviewedBy}')`,
      );
    }
    if (
      e.pidginLevel !== "clean" &&
      e.pidginLevel !== "light_pidgin" &&
      e.pidginLevel !== "pidgin"
    ) {
      push(`invalid pidginLevel '${e.pidginLevel}'`);
    }
    if (!e.cluster || e.cluster.trim().length === 0) {
      push("cluster missing");
    }
    if (!e.domain || e.domain.trim().length === 0) {
      push("domain missing");
    }
    if (!e.anchor || e.anchor.trim().length === 0 || /\s/.test(e.anchor)) {
      push("anchor must be a non-empty single token");
    }
    if (!e.hook || e.hook.length === 0 || e.hook.length > DRAFT_HOOK_MAX) {
      push(`hook length out of band [1, ${DRAFT_HOOK_MAX}]: ${e.hook?.length ?? 0}`);
    }
    if (
      !e.whatToShow ||
      e.whatToShow.length < DRAFT_WTS_MIN ||
      e.whatToShow.length > DRAFT_WTS_MAX
    ) {
      push(
        `whatToShow length out of band [${DRAFT_WTS_MIN}, ${DRAFT_WTS_MAX}]: ${e.whatToShow?.length ?? 0}`,
      );
    }
    if (
      !e.howToFilm ||
      e.howToFilm.length < DRAFT_HTF_MIN ||
      e.howToFilm.length > DRAFT_HTF_MAX
    ) {
      push(
        `howToFilm length out of band [${DRAFT_HTF_MIN}, ${DRAFT_HTF_MAX}]: ${e.howToFilm?.length ?? 0}`,
      );
    }
    if (
      !e.caption ||
      e.caption.length < DRAFT_CAP_MIN ||
      e.caption.length > DRAFT_CAP_MAX
    ) {
      push(
        `caption length out of band [${DRAFT_CAP_MIN}, ${DRAFT_CAP_MAX}]: ${e.caption?.length ?? 0}`,
      );
    }
  });
  return issues;
}

export function assertNigerianDraftPackIntegrity(
  pack: readonly DraftNigerianPackEntry[],
): void {
  const issues = checkNigerianDraftPackIntegrity(pack);
  if (issues.length > 0) {
    const summary = issues
      .slice(0, 5)
      .map((i) => `  [${i.index}] ${i.reason} | "${i.hookSnippet}"`)
      .join("\n");
    throw new Error(
      `[nigerianHookPackDrafts] ${issues.length} integrity issue(s):\n${summary}` +
        (issues.length > 5 ? `\n  ...and ${issues.length - 5} more` : ""),
    );
  }
}

// Boot-time check. Throws on any structural problem — this is a
// fast-fail at import time so a bad draft entry cannot ship silently.
assertNigerianDraftPackIntegrity(DRAFT_NIGERIAN_HOOK_PACK);

// Register the draft pool reference with the live module so the
// activation guard can refuse it by identity (defense in depth).
registerDraftPoolReference(DRAFT_NIGERIAN_HOOK_PACK);

/** True iff the entry is in a tier that COULD activate (only
 *  light_pidgin / pidgin). Useful for the QA harness to count how
 *  many drafts would even be candidates after promotion. */
export function isPotentiallyActivatable(
  entry: DraftNigerianPackEntry,
): boolean {
  return entry.pidginLevel === "light_pidgin" || entry.pidginLevel === "pidgin";
}
