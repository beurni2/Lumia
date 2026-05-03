/**
 * PHASE D3 — USER-BLESSED HOOK CORPUS (voice-training reference)
 *
 * Hand-authored hook pool drawn from the user's curated 175-hook
 * seed corpus (attached_assets/1-just_5_more_minutes_in_bed... and
 * 1-my_no_more_soda_challenge...). Each entry is `{ hook, cluster,
 * anchor }`:
 *   - hook    : the verbatim authored hook string (lowercased,
 *               punctuation preserved).
 *   - cluster : voice cluster the hook belongs to (one of the four
 *               in `voiceClusters.ts`).
 *   - anchor  : the single-token noun the hook revolves around
 *               (e.g. "bed", "phone", "list", "laundry", "boys").
 *               MUST appear literally in the hook (lowercase
 *               substring) — boot-time assert enforces.
 *
 * USAGE (post-D3 — D2 runtime corpus-draw branch reverted):
 *
 * The corpus is a TRAINING / VOICE-REFERENCE dataset, not a runtime
 * draw pool. No corpus hook is ever shipped verbatim as the hook
 * field of a generated Idea. Two consumption sites:
 *
 *   1. `comedyValidation.loadSeedHookBigrams()` folds every corpus
 *      hook into the seed-bigram set so `validateAntiCopy`'s
 *      Jaccard 0.85 near-verbatim gate treats each corpus hook as
 *      a voice-training reference (generated hooks landing within
 *      Jaccard 0.85 of any corpus hook are rejected as near-copies
 *      — same discipline already applied to PREMISE_STYLE_DEFS
 *      example hooks). This is the primary wiring.
 *
 *   2. `voiceClusters.ts hookTemplates` — distilled abstracted
 *      templates per cluster (each marked `// PHASE D3 — distilled
 *      from corpus pattern ...`) capture recurring corpus shapes
 *      (`"quoted promise" + ellipsis + time-jump`, `"verbal denial"
 *      + contradicting action`, `truism-reframe`, `mundane object
 *      + bureaucratic-personification`) with placeholder substitution
 *      so the generator's recipe loop produces fresh-anchor
 *      variations of the user's voice without copying it.
 *
 * The cliché-allowlist discipline (D1) extends to this corpus by
 * curator policy: no `aiClicheScore` regex may match any corpus
 * hook. Enforced by a unit test (see __tests__/), not a boot
 * assert (the cliché list lives in `hookQuality.ts` whose imports
 * we don't want to widen here).
 *
 * No Claude. No DB. Pure / frozen at module load. Same discipline
 * as `voiceClusters.ts` and `coreDomainAnchorCatalog.ts`.
 */

import type { VoiceClusterId } from "./voiceClusters.js";

export type CorpusHookEntry = {
  readonly hook: string;
  readonly cluster: VoiceClusterId;
  readonly anchor: string;
};

// Tag conventions applied below:
//   dry_deadpan         → hooks ending on the deadpan-stare beat
//                         ("...no music sting", "...stare", flat
//                         declarative collapse).
//   chaotic_confession  → real-time admission, escalating spiral,
//                         "okay i ${verb}ed it again" energy.
//   overdramatic_reframe→ tiny inconvenience escalated to identity
//                         catastrophe ("filed for divorce", "hired
//                         a lawyer", "personal apocalypse").
//   quiet_realization   → soft introspective notice, "i tried to X
//                         but Y" / "i think the X is ...".
const RAW_CORPUS: readonly CorpusHookEntry[] = [
  // ---- File 1: 1-just_5_more_minutes_in_bed... -------------------- //
  { hook: '"just 5 more minutes" in bed... it\'s now next week', cluster: "dry_deadpan", anchor: "bed" },
  { hook: 'meal prepped like a responsible adult... for 14 minutes', cluster: "dry_deadpan", anchor: "adult" },
  { hook: '"i\'m not checking their story" ... 47th time today', cluster: "chaotic_confession", anchor: "story" },
  { hook: 'told myself "one episode" at midnight... sunrise loading', cluster: "dry_deadpan", anchor: "episode" },
  { hook: 'my therapist said "set boundaries"... i said "ok" then folded immediately', cluster: "chaotic_confession", anchor: "boundaries" },
  { hook: '"i\'ll reply later" ... it\'s been 3 weeks', cluster: "dry_deadpan", anchor: "reply" },
  { hook: 'said "I\'m not competitive" ... then saw my friend\'s win', cluster: "quiet_realization", anchor: "friend" },
  { hook: 'bought the "cheap" version... immediately regretted it', cluster: "chaotic_confession", anchor: "cheap" },
  { hook: '"this is my glow up year" ... april check-in', cluster: "dry_deadpan", anchor: "year" },
  { hook: 'i unfollowed for mental health... refollowed before i could blink', cluster: "chaotic_confession", anchor: "unfollowed" },
  { hook: '"i\'m not the jealous type"... until i saw their story', cluster: "quiet_realization", anchor: "story" },
  { hook: 'day 1 of new me... day 4 never showed up', cluster: "dry_deadpan", anchor: "day" },
  { hook: '"just one more episode" turned into season 4', cluster: "chaotic_confession", anchor: "episode" },
  { hook: 'i bought plants to be that girl... they\'re all dead', cluster: "dry_deadpan", anchor: "plants" },
  { hook: 'i unfollowed them for my peace... then searched their name', cluster: "chaotic_confession", anchor: "peace" },
  { hook: '"i don\'t care what people think"... then reread the comment 12 times', cluster: "quiet_realization", anchor: "comment" },
  { hook: 'my "no contact" streak... lasted until they texted', cluster: "overdramatic_reframe", anchor: "streak" },
  { hook: '"i\'m on a no-carb diet"... said while eating pasta', cluster: "chaotic_confession", anchor: "diet" },
  { hook: 'told myself "don\'t overthink it"... then overthought it for 3 hours', cluster: "chaotic_confession", anchor: "overthink" },
  { hook: 'i planned my entire week... then monday hit', cluster: "dry_deadpan", anchor: "week" },
  { hook: '"i\'m so over it"... still thinking about it at 4am', cluster: "quiet_realization", anchor: "over" },
  { hook: '"i\'ll be ready in 5 minutes"... 47 minutes later', cluster: "dry_deadpan", anchor: "ready" },
  { hook: 'my toxic trait is thinking a fresh haircut will fix my tax bracket', cluster: "overdramatic_reframe", anchor: "haircut" },
  { hook: 'i accidentally opened my front camera and met my sleep paralysis demon', cluster: "overdramatic_reframe", anchor: "camera" },
  { hook: 'my bank app asked if it was really me and honestly i respected it', cluster: "quiet_realization", anchor: "bank" },
  { hook: 'i tried to be emotionally unavailable but nobody was looking for me', cluster: "quiet_realization", anchor: "unavailable" },
  { hook: 'i responded "no worries" and immediately started worrying professionally', cluster: "chaotic_confession", anchor: "worries" },
  { hook: 'i tried to romanticize my life but my apartment said no', cluster: "overdramatic_reframe", anchor: "apartment" },
  { hook: 'i opened LinkedIn for motivation and left with chest pain', cluster: "overdramatic_reframe", anchor: "linkedin" },
  { hook: 'i made one small mistake and my brain turned it into a netflix documentary', cluster: "overdramatic_reframe", anchor: "mistake" },
  { hook: 'i\'m a morning person now... said no one after 11am', cluster: "dry_deadpan", anchor: "morning" },
  { hook: '"i\'m not dramatic"... as i write a 7 paragraph text', cluster: "chaotic_confession", anchor: "dramatic" },
  { hook: 'my "healthy girl era" lasted until i smelled pizza', cluster: "dry_deadpan", anchor: "pizza" },
  { hook: '"i\'ll be productive today"... scrolls for 6 hours', cluster: "dry_deadpan", anchor: "productive" },
  { hook: 'i checked my ex\'s new girlfriend\'s instagram... for research', cluster: "chaotic_confession", anchor: "ex" },
  { hook: 'i said "one drink"... blacked out in an uber', cluster: "dry_deadpan", anchor: "drink" },
  { hook: '"i forgive people easily"... still mad about 2019', cluster: "quiet_realization", anchor: "forgive" },
  { hook: '"i\'m so independent"... can\'t even be alone 20 minutes', cluster: "quiet_realization", anchor: "independent" },
  { hook: 'tried the "that girl" morning routine... ended in tears', cluster: "dry_deadpan", anchor: "routine" },
  { hook: '"i\'m cutting out sugar"... eats cake for breakfast', cluster: "chaotic_confession", anchor: "sugar" },
  { hook: 'i became a "hater" for 0.3 seconds... then liked the post', cluster: "chaotic_confession", anchor: "hater" },
  { hook: 'i tried to be the bigger person but i\'m built like a comment section', cluster: "overdramatic_reframe", anchor: "comment" },
  { hook: 'i said "let me check my calendar" like i\'m not just scared to say no', cluster: "quiet_realization", anchor: "calendar" },
  { hook: 'i bought a planner and immediately felt employed by my future self', cluster: "overdramatic_reframe", anchor: "planner" },
  { hook: 'i tried walking for my mental health and accidentally became a neighborhood suspect', cluster: "overdramatic_reframe", anchor: "walking" },
  { hook: 'i said "i\'m not hungry" then heard someone open chips', cluster: "chaotic_confession", anchor: "chips" },
  { hook: 'i tried to drink more water and my body acted like i filed a complaint', cluster: "overdramatic_reframe", anchor: "water" },
  { hook: 'i tried meal prepping but my leftovers started looking at me weird', cluster: "overdramatic_reframe", anchor: "leftovers" },
  { hook: 'i said "i\'ll just browse" and got emotionally adopted by a shopping cart', cluster: "overdramatic_reframe", anchor: "cart" },
  { hook: 'i put my phone on do not disturb and disturbed myself instead', cluster: "quiet_realization", anchor: "phone" },
  { hook: 'i tried being productive at a coffee shop and became a background character', cluster: "quiet_realization", anchor: "coffee" },
  { hook: 'i said "this will only take 10 minutes" and summoned a side quest', cluster: "overdramatic_reframe", anchor: "minutes" },
  { hook: 'i saw someone my age succeeding and suddenly my cereal tasted unemployed', cluster: "overdramatic_reframe", anchor: "cereal" },
  { hook: 'i cleaned one surface and started acting like i beat generational trauma', cluster: "overdramatic_reframe", anchor: "surface" },
  { hook: 'i said "i\'m saving money" and then got humbled by a subscription i forgot existed', cluster: "quiet_realization", anchor: "subscription" },
  { hook: 'i tried to have a morning routine and my bed hired a lawyer', cluster: "overdramatic_reframe", anchor: "bed" },
  { hook: 'i said "i\'m fine" with the confidence of someone absolutely not fine', cluster: "quiet_realization", anchor: "fine" },
  { hook: 'i tried to save a recipe and accidentally joined a woman\'s entire family history', cluster: "overdramatic_reframe", anchor: "recipe" },
  { hook: 'i heard "quick meeting" and prepared for spiritual damage', cluster: "overdramatic_reframe", anchor: "meeting" },
  { hook: 'i\'m manifesting my dream life... said from my bed at 2pm', cluster: "dry_deadpan", anchor: "bed" },
  { hook: '"i\'ll just take a quick nap"... woke up in a new decade', cluster: "overdramatic_reframe", anchor: "nap" },
  { hook: 'i ghosted my own to-do list... it deserved it', cluster: "dry_deadpan", anchor: "list" },
  { hook: '"i\'m so good at boundaries"... until my mom called', cluster: "chaotic_confession", anchor: "boundaries" },
  { hook: 'my emotional support water bottle... is still empty', cluster: "dry_deadpan", anchor: "bottle" },
  { hook: '"i don\'t chase people"... chases them in my head at 1am', cluster: "quiet_realization", anchor: "chase" },
  { hook: 'i tried the 75 hard challenge... lasted 75 minutes', cluster: "dry_deadpan", anchor: "challenge" },
  { hook: '"i\'m not addicted to my phone"... checks it mid-conversation with myself', cluster: "quiet_realization", anchor: "phone" },
  { hook: '"i\'ll fold the laundry later"... it\'s now a mountain', cluster: "dry_deadpan", anchor: "laundry" },
  { hook: 'i became that girl... for exactly one pinterest board', cluster: "dry_deadpan", anchor: "pinterest" },
  { hook: '"i\'m over my ex"... still have his playlist on repeat', cluster: "quiet_realization", anchor: "playlist" },
  { hook: 'my "clean girl" makeup... looks like raccoon after 10am', cluster: "dry_deadpan", anchor: "makeup" },
  { hook: 'i meal prepped for the week... ate it all monday night', cluster: "dry_deadpan", anchor: "week" },
  { hook: '"i\'m not sensitive"... cries over a dog video', cluster: "chaotic_confession", anchor: "dog" },
  { hook: 'my savings account called... it said "lol"', cluster: "overdramatic_reframe", anchor: "savings" },
  { hook: '"this is the last time"... famous last words again', cluster: "dry_deadpan", anchor: "last" },
  { hook: 'i said "new month, new me" and the old me filed an appeal', cluster: "overdramatic_reframe", anchor: "month" },
  { hook: 'i tried to look busy and accidentally got assigned more work', cluster: "quiet_realization", anchor: "busy" },
  { hook: 'i bought vegetables and immediately started respecting myself too much', cluster: "quiet_realization", anchor: "vegetables" },
  { hook: 'i said "i\'ll wake up early" and my nighttime self committed identity theft', cluster: "overdramatic_reframe", anchor: "early" },
  { hook: 'i tried to be spontaneous but needed 3-5 business days emotionally', cluster: "quiet_realization", anchor: "spontaneous" },
  { hook: 'i said "i don\'t care" and then conducted a full federal investigation', cluster: "overdramatic_reframe", anchor: "care" },
  { hook: 'i tried to relax and my brain opened 47 unsaved tabs', cluster: "overdramatic_reframe", anchor: "tabs" },
  { hook: 'i tried to flirt and accidentally became customer service', cluster: "overdramatic_reframe", anchor: "flirt" },
  { hook: 'i sent one voice note and immediately regretted releasing the director\'s cut', cluster: "overdramatic_reframe", anchor: "voice" },
  { hook: 'i said "i\'m almost ready" while still in my ancestral form', cluster: "overdramatic_reframe", anchor: "ready" },
  { hook: 'i tried to be minimalist but my junk drawer has tenure', cluster: "overdramatic_reframe", anchor: "drawer" },
  { hook: 'i heard my own laugh on video and considered witness protection', cluster: "overdramatic_reframe", anchor: "laugh" },
  { hook: 'i said "let\'s circle back" and felt my soul leave the meeting', cluster: "overdramatic_reframe", anchor: "meeting" },
  { hook: 'i tried to take a cute mirror selfie and created evidence', cluster: "overdramatic_reframe", anchor: "selfie" },
  { hook: 'i said "i\'ll only be on tiktok for five minutes" and learned raccoons can paint', cluster: "overdramatic_reframe", anchor: "tiktok" },
  { hook: 'i opened my laptop to work and immediately became an interior designer', cluster: "overdramatic_reframe", anchor: "laptop" },
  { hook: 'i bought a journal to fix my life... it\'s blank', cluster: "dry_deadpan", anchor: "journal" },

  // ---- File 2: 1-my_no_more_soda_challenge... --------------------- //
  { hook: 'my "no more soda" challenge... died at the gas station', cluster: "dry_deadpan", anchor: "soda" },
  { hook: '"i\'ll learn a new skill"... still can\'t boil water', cluster: "dry_deadpan", anchor: "skill" },
  { hook: 'my emotional support group chat is just me venting to ai', cluster: "quiet_realization", anchor: "chat" },
  { hook: '"i\'m so over social media"... posts this', cluster: "dry_deadpan", anchor: "social" },
  { hook: 'i became a coffee girl... now my blood is 87% latte', cluster: "overdramatic_reframe", anchor: "coffee" },
  { hook: '"i don\'t hold grudges"... remembers the 2017 text', cluster: "quiet_realization", anchor: "grudges" },
  { hook: 'i asked my mom for advice... immediately regretted it', cluster: "dry_deadpan", anchor: "mom" },
  { hook: '"i\'m not dramatic"... cries over sold-out sneakers', cluster: "chaotic_confession", anchor: "sneakers" },
  { hook: 'my personality is "sorry i saw your text 3 days later"', cluster: "dry_deadpan", anchor: "text" },
  { hook: 'i tried the "quiet luxury" trend... ended up in shein', cluster: "dry_deadpan", anchor: "luxury" },
  { hook: 'i tried to act normal around my crush and turned into a software update', cluster: "overdramatic_reframe", anchor: "crush" },
  { hook: 'i said "i know a shortcut" and became the villain of the trip', cluster: "overdramatic_reframe", anchor: "shortcut" },
  { hook: 'i tried to meditate and my brain started a podcast', cluster: "overdramatic_reframe", anchor: "meditate" },
  { hook: 'i checked my screen time and my phone called me family', cluster: "overdramatic_reframe", anchor: "phone" },
  { hook: 'i tried to be chill and my face leaked the entire report', cluster: "overdramatic_reframe", anchor: "chill" },
  { hook: 'i said "i\'ll remember that" and my brain immediately shredded the document', cluster: "overdramatic_reframe", anchor: "remember" },
  { hook: 'i tried to look confident walking past people and forgot how legs work', cluster: "overdramatic_reframe", anchor: "confident" },
  { hook: 'i said "i\'m not dramatic" then heard a different tone in one text', cluster: "quiet_realization", anchor: "text" },
  { hook: 'i said "i\'m on my way" while still making eye contact with my couch', cluster: "chaotic_confession", anchor: "couch" },
  { hook: '"money can\'t buy happiness" ... my cart has entered the chat', cluster: "chaotic_confession", anchor: "cart" },
  { hook: '"sleep is the best medicine"... said no one at 3am', cluster: "dry_deadpan", anchor: "sleep" },
  { hook: '"age is just a number" ... my back says otherwise', cluster: "overdramatic_reframe", anchor: "age" },
  { hook: '"forgiveness sets you free" ... i\'m still in jail', cluster: "overdramatic_reframe", anchor: "forgiveness" },
  { hook: '"love yourself first" ... i ghosted me too', cluster: "dry_deadpan", anchor: "love" },
  { hook: '"failure is the best teacher" ... i keep skipping class', cluster: "dry_deadpan", anchor: "failure" },
  { hook: '"less is more" ... my closet disagrees', cluster: "overdramatic_reframe", anchor: "closet" },
  { hook: 'confidence isn\'t real, it\'s just delusion with better posture', cluster: "quiet_realization", anchor: "confidence" },
  { hook: 'meal prep is not discipline, it\'s eating the same regret five times', cluster: "quiet_realization", anchor: "discipline" },
  { hook: 'self-care is just chores wearing a face mask', cluster: "quiet_realization", anchor: "chores" },
  { hook: 'a clean room doesn\'t fix your life, it just gives your anxiety better lighting', cluster: "quiet_realization", anchor: "room" },
  { hook: 'being independent is fun until you have to choose dinner every single night', cluster: "quiet_realization", anchor: "dinner" },
  { hook: 'getting older isn\'t wisdom, it\'s just knowing which foods will betray you', cluster: "quiet_realization", anchor: "foods" },
  { hook: 'coffee doesn\'t give you energy, it just makes your anxiety type faster', cluster: "quiet_realization", anchor: "coffee" },
  { hook: 'a fresh haircut doesn\'t change your life, it just makes your problems more aerodynamic', cluster: "quiet_realization", anchor: "haircut" },
  { hook: 'being "chill" is just panic with slower blinking', cluster: "quiet_realization", anchor: "chill" },
  { hook: 'motivation is fake, panic is the real project manager', cluster: "quiet_realization", anchor: "motivation" },
  { hook: 'it\'s okay to reply "k" and ruin their whole day', cluster: "dry_deadpan", anchor: "reply" },
  { hook: 'it\'s fine to eat cereal for dinner again', cluster: "dry_deadpan", anchor: "cereal" },
  { hook: 'you\'re allowed to doomscroll instead of journaling', cluster: "dry_deadpan", anchor: "doomscroll" },
  { hook: 'i tried the "no phone in bed" rule... my brain hired a lawyer about it', cluster: "overdramatic_reframe", anchor: "phone" },
  { hook: 'said i\'d "eat clean this week"... my fridge just filed a restraining order', cluster: "overdramatic_reframe", anchor: "fridge" },
  { hook: 'i opened the family group chat... now i need therapy and a new identity', cluster: "overdramatic_reframe", anchor: "chat" },
  { hook: 'tried manifesting my dream life... the universe sent me a hoodie instead', cluster: "dry_deadpan", anchor: "manifesting" },
  { hook: 'i told my boss "i\'m a quick learner"... 6 months later i\'m still pretending', cluster: "chaotic_confession", anchor: "boss" },
  { hook: 'opened my ex\'s story... healing timeline just got deleted', cluster: "overdramatic_reframe", anchor: "story" },
  { hook: 'said i\'d "touch grass" today... my houseplants just laughed at me', cluster: "overdramatic_reframe", anchor: "grass" },
  { hook: 'i tried the "quiet quitting" trend at home... my laundry served me with paperwork', cluster: "overdramatic_reframe", anchor: "laundry" },
  { hook: 'said i\'d cook at home this week... my uber eats driver now knows me by name', cluster: "chaotic_confession", anchor: "cook" },
  { hook: 'checked my step count... my apple watch is now filing for emotional damages', cluster: "overdramatic_reframe", anchor: "step" },
  { hook: 'opened my camera roll for memories... immediately needed emergency therapy', cluster: "overdramatic_reframe", anchor: "camera" },
  { hook: 'tried the viral dance trend... my body said "absolutely not, we\'re not built like that"', cluster: "overdramatic_reframe", anchor: "dance" },
  { hook: 'family asked what i\'m doing with my life... i said "vibing" and sprinted out the room', cluster: "chaotic_confession", anchor: "family" },
  { hook: 'my spotify wrapped just exposed me... now the algorithm knows way too much', cluster: "overdramatic_reframe", anchor: "spotify" },
  { hook: 'tried adulting with bills... my credit score laughed and sent me a late fee', cluster: "overdramatic_reframe", anchor: "bills" },
  { hook: 'i told my mirror "you got this"... my reflection immediately said "no we don\'t"', cluster: "chaotic_confession", anchor: "mirror" },
  { hook: 'my to-do list has 28 items... i completed "scroll tiktok" 47 times instead', cluster: "dry_deadpan", anchor: "list" },
  { hook: 'i told myself "just one more game"... 14 hours later my mom thinks i died in the basement', cluster: "overdramatic_reframe", anchor: "game" },
  { hook: 'checked my crypto portfolio at 3am... now i\'m googling "how to sell plasma near me"', cluster: "overdramatic_reframe", anchor: "crypto" },
  { hook: 'tried the "alpha male" morning routine... woke up at 2pm with regret', cluster: "dry_deadpan", anchor: "morning" },
  { hook: 'the boys said "no feelings"... i\'m now overanalyzing her leaving me on read', cluster: "chaotic_confession", anchor: "boys" },
  { hook: 'said i wasn\'t checking the score during work... now i\'m refreshing espn in the bathroom', cluster: "chaotic_confession", anchor: "score" },
  { hook: 'the boys hyped me up for the date... i still said "haha cool" when she canceled', cluster: "chaotic_confession", anchor: "date" },
  { hook: 'the boys said "keep it casual"... i\'m now planning our wedding in my head', cluster: "chaotic_confession", anchor: "casual" },
  { hook: 'i said i\'d never become my dad... now i\'m yelling at the tv during the game', cluster: "overdramatic_reframe", anchor: "dad" },
  { hook: 'i said "tonight is my self-care night"... 47 minutes later i\'m stress-eating ice cream in the dark', cluster: "chaotic_confession", anchor: "night" },
  { hook: 'i joined the "no contact" challenge with my situationship... my thumbs have other plans', cluster: "chaotic_confession", anchor: "thumbs" },
  { hook: 'tried being low-maintenance... my lash appointment bill said "lmao nice try girl"', cluster: "overdramatic_reframe", anchor: "lash" },
];

// ---------------------------------------------------------------- //
// Boot-time validation                                              //
// ---------------------------------------------------------------- //

const VALID_CLUSTERS: ReadonlySet<VoiceClusterId> = new Set([
  "dry_deadpan",
  "chaotic_confession",
  "overdramatic_reframe",
  "quiet_realization",
] as const);

for (const entry of RAW_CORPUS) {
  if (!entry.hook || entry.hook.trim().length === 0) {
    throw new Error(
      `[userBlessedHookCorpus] empty hook in entry ${JSON.stringify(entry)}`,
    );
  }
  if (!VALID_CLUSTERS.has(entry.cluster)) {
    throw new Error(
      `[userBlessedHookCorpus] invalid cluster '${entry.cluster}' for hook '${entry.hook}'`,
    );
  }
  if (!entry.anchor || entry.anchor.trim().length === 0) {
    throw new Error(
      `[userBlessedHookCorpus] empty anchor in entry ${JSON.stringify(entry)}`,
    );
  }
  // The anchor MUST literally appear in the hook (lowercase
  // substring). This is the construction precondition the cohesive
  // author relies on (`hookLower.includes(anchorLc)` at L491). If
  // it does not hold the corpus draw cannot satisfy the gate.
  if (!entry.hook.toLowerCase().includes(entry.anchor.toLowerCase())) {
    throw new Error(
      `[userBlessedHookCorpus] anchor '${entry.anchor}' not found in hook '${entry.hook}'`,
    );
  }
}

// Per-cluster minimum coverage. Without a healthy spread the
// corpus draw collapses to a few hooks for some clusters and the
// monoculture we are trying to fix recurs in those buckets.
const _byCluster = new Map<VoiceClusterId, number>();
for (const e of RAW_CORPUS) {
  _byCluster.set(e.cluster, (_byCluster.get(e.cluster) ?? 0) + 1);
}
for (const cid of VALID_CLUSTERS) {
  const n = _byCluster.get(cid) ?? 0;
  if (n < 8) {
    throw new Error(
      `[userBlessedHookCorpus] cluster '${cid}' has only ${n} corpus hooks (require ≥8)`,
    );
  }
}

// ---------------------------------------------------------------- //
// Public API                                                        //
// ---------------------------------------------------------------- //

export const USER_BLESSED_HOOK_CORPUS: readonly CorpusHookEntry[] =
  Object.freeze(RAW_CORPUS.map((e) => Object.freeze({ ...e })));

const _byClusterIndex: Map<VoiceClusterId, readonly CorpusHookEntry[]> =
  new Map();
for (const cid of VALID_CLUSTERS) {
  _byClusterIndex.set(
    cid,
    Object.freeze(USER_BLESSED_HOOK_CORPUS.filter((e) => e.cluster === cid)),
  );
}

export function getCorpusHooksByCluster(
  cluster: VoiceClusterId,
): readonly CorpusHookEntry[] {
  return _byClusterIndex.get(cluster) ?? [];
}

// PHASE D3 — `pickCorpusHook` and `shouldDrawFromCorpus` (the D2
// runtime-draw helpers) intentionally removed. The corpus is now a
// voice-training reference fed into the seed-bigram set + the
// distilled `hookTemplates` per cluster, not a runtime draw pool.
// See module-level JSDoc above for the full consumption surface.
