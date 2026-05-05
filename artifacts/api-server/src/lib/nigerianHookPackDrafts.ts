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
  /** Always the literal `PENDING_NATIVE_REVIEW` sentinel for drafts. */
  readonly reviewedBy: typeof PENDING_NATIVE_REVIEW;
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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
      reviewedBy: PENDING_NATIVE_REVIEW,
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

    if (e.reviewedBy !== PENDING_NATIVE_REVIEW) {
      push(
        `reviewedBy must be the literal sentinel ` +
          `'${PENDING_NATIVE_REVIEW}' for drafts (got '${e.reviewedBy}')`,
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
