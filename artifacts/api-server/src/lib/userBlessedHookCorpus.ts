/**
 * PHASE D3 — USER-BLESSED HOOK CORPUS (voice-training reference)
 *
 * Hand-authored hook pool drawn from the user's curated 175-hook
 * seed corpus (attached_assets/1-just_5_more_minutes_in_bed... and
 * 1-my_no_more_soda_challenge...) plus the Z5 POV/relatable skit
 * expansion (attached_assets/BATCH_1 + BATCH_2, +200 hooks).
 * Each entry is `{ hook, cluster,
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

  // ---- PHASE D14 — second user-blessed corpus expansion (+74) ----- //
  // Source: attached_assets/1-my_just_one_thing_store_run_just_*.txt
  // (76 numbered hook lines authored by the user — file uses two
  // distinct "17-..." entries, hence 76 not 75; 2 skipped for
  // cliché-allowlist discipline — "...my phone knows im lying when
  // i say im fine" trips /\bknows i'?m lying\b/, "...metabolism
  // filed for divorce" trips /\bfiled for (?:emotional|divorce|
  // bankruptcy)/). Cluster assignment: deadpan-stare beats →
  // dry_deadpan; real-time admission/escalation → chaotic_confession;
  // tiny inconvenience catastrophized → overdramatic_reframe; soft
  // introspective notice ("i quietly realized..." / truism reframe)
  // → quiet_realization. Distribution restores cluster balance:
  // post-D14 floor ~35 per cluster (was 29), pool 159 → 233. Y11
  // discipline preserved — additive only, no schema/cache/Claude/
  // migration changes.
  { hook: 'my "just one thing" store run just cost me $92', cluster: "dry_deadpan", anchor: "store" },
  { hook: 'my situationship hit me with "lol"... after i caught feelings', cluster: "overdramatic_reframe", anchor: "situationship" },
  { hook: 'i put on gym clothes at 7am... by 7:45 i was back in bed', cluster: "dry_deadpan", anchor: "gym" },
  { hook: 'adulting tried to warn me... but i ignored it and ordered takeout', cluster: "overdramatic_reframe", anchor: "takeout" },
  { hook: 'started a side hustle for extra cash... now i have zero free time', cluster: "dry_deadpan", anchor: "hustle" },
  { hook: 'i confessed my love drunk... then sobered up and pretended it was a joke', cluster: "chaotic_confession", anchor: "love" },
  { hook: 'i still pay for my ex\'s spotify... two years later', cluster: "chaotic_confession", anchor: "spotify" },
  { hook: 'i told my therapist everything... then never went back', cluster: "chaotic_confession", anchor: "therapist" },
  { hook: 'i faked being sick... to avoid my own birthday party', cluster: "chaotic_confession", anchor: "birthday" },
  { hook: 'my gym app just roasted my 2026 fitness goals', cluster: "overdramatic_reframe", anchor: "gym" },
  { hook: 'my boss emailed... said "we need to talk"', cluster: "dry_deadpan", anchor: "boss" },
  { hook: 'dating apps know im lonely but keep matching me with red flags', cluster: "quiet_realization", anchor: "dating" },
  { hook: 'my coffee order costs more than my childhood allowance', cluster: "overdramatic_reframe", anchor: "coffee" },
  { hook: 'hustle culture called... it said take a break', cluster: "overdramatic_reframe", anchor: "hustle" },
  { hook: 'my rent just ate my entire paycheck alive', cluster: "overdramatic_reframe", anchor: "rent" },
  { hook: 'my dating profile is 100% honest and still gets zero matches', cluster: "dry_deadpan", anchor: "dating" },
  { hook: 'fitness app said i only burned 47 calories today', cluster: "dry_deadpan", anchor: "fitness" },
  { hook: 'my group chat called an emergency meeting about me', cluster: "overdramatic_reframe", anchor: "chat" },
  { hook: 'meal prepping sounded way better in my head', cluster: "quiet_realization", anchor: "meal" },
  { hook: 'my therapist said "tell me about your mother" and i talked about taxes', cluster: "chaotic_confession", anchor: "taxes" },
  { hook: 'hustle culture promised me freedom not 3am anxiety', cluster: "quiet_realization", anchor: "hustle" },
  { hook: 'my amazon cart knows more about me than my mom', cluster: "overdramatic_reframe", anchor: "cart" },
  { hook: 'being a functioning adult is 90% pretending', cluster: "quiet_realization", anchor: "adult" },
  { hook: 'crypto taught me money can disappear faster than my motivation', cluster: "quiet_realization", anchor: "crypto" },
  { hook: 'my plants are the only living things i can keep alive', cluster: "quiet_realization", anchor: "plants" },
  { hook: 'quiet quitting my own life goals', cluster: "dry_deadpan", anchor: "goals" },
  { hook: 'my bank app knows when im sad shopping', cluster: "overdramatic_reframe", anchor: "bank" },
  { hook: 'being 30 is just 20 but with more back pain', cluster: "quiet_realization", anchor: "back" },
  { hook: 'delivery apps have ruined my cooking ambition', cluster: "quiet_realization", anchor: "cooking" },
  { hook: 'self care is just expensive avoidance', cluster: "quiet_realization", anchor: "care" },
  { hook: 'my camera roll is 80% screenshots of things i\'ll never do', cluster: "dry_deadpan", anchor: "camera" },
  { hook: 'adult friendships are just "we should catch up" texts', cluster: "quiet_realization", anchor: "friendships" },
  { hook: 'my airpods overheard my therapy and now push therapy ads', cluster: "overdramatic_reframe", anchor: "airpods" },
  { hook: 'work emails at 11pm should be illegal', cluster: "dry_deadpan", anchor: "emails" },
  { hook: 'my mental health app just charged me for ghosting me', cluster: "overdramatic_reframe", anchor: "app" },
  { hook: 'grocery store trips are basically therapy with receipts', cluster: "quiet_realization", anchor: "grocery" },
  { hook: 'side hustle turned into main struggle', cluster: "dry_deadpan", anchor: "hustle" },
  { hook: 'my fridge light is the only thing glowing in my life', cluster: "dry_deadpan", anchor: "fridge" },
  { hook: 'dating in 2026 is just trauma bonding with extra steps', cluster: "quiet_realization", anchor: "dating" },
  { hook: 'my calendar is full and my soul is empty', cluster: "dry_deadpan", anchor: "calendar" },
  { hook: 'coffee is the only personality trait i have left', cluster: "dry_deadpan", anchor: "coffee" },
  { hook: 'my inner child called... said grow up', cluster: "overdramatic_reframe", anchor: "child" },
  { hook: 'my savings goal moved the finish line again', cluster: "overdramatic_reframe", anchor: "savings" },
  { hook: 'being online is my full-time job with no pay', cluster: "quiet_realization", anchor: "online" },
  { hook: 'my ex\'s spotify playlist still knows me better', cluster: "quiet_realization", anchor: "spotify" },
  { hook: 'holiday shopping budget called it quits', cluster: "overdramatic_reframe", anchor: "shopping" },
  { hook: 'my motivation left without saying goodbye', cluster: "overdramatic_reframe", anchor: "motivation" },
  { hook: 'my echo dot heard my crying and suggested sad songs', cluster: "overdramatic_reframe", anchor: "echo" },
  { hook: '2026 me is already disappointed in 2025 me', cluster: "quiet_realization", anchor: "disappointed" },
  { hook: 'dating apps said my vibe was "unavailable"', cluster: "overdramatic_reframe", anchor: "vibe" },
  { hook: 'my car insurance laughed at my driving record', cluster: "overdramatic_reframe", anchor: "insurance" },
  { hook: 'grocery prices just humbled me', cluster: "overdramatic_reframe", anchor: "grocery" },
  { hook: 'work from home became work from bed', cluster: "dry_deadpan", anchor: "home" },
  { hook: 'my ex texted "happy for you"', cluster: "chaotic_confession", anchor: "ex" },
  { hook: 'my mental health said "not today"', cluster: "overdramatic_reframe", anchor: "health" },
  { hook: 'alarm clock and i are done', cluster: "dry_deadpan", anchor: "alarm" },
  { hook: 'dating in 2026 is pay to play', cluster: "dry_deadpan", anchor: "dating" },
  { hook: 'savings goal hit the snooze button', cluster: "overdramatic_reframe", anchor: "savings" },
  { hook: 'life update: still figuring it out', cluster: "dry_deadpan", anchor: "life" },
  { hook: 'quietly realizing my glow up was just good lighting', cluster: "quiet_realization", anchor: "lighting" },
  { hook: 'i quietly realized i\'m the stable friend now', cluster: "quiet_realization", anchor: "friend" },
  { hook: 'quiet realization i\'m becoming my parents', cluster: "quiet_realization", anchor: "parents" },
  { hook: 'quietly accepting my dating app era is over', cluster: "quiet_realization", anchor: "dating" },
  { hook: 'i realized i\'m not "figuring it out" anymore', cluster: "quiet_realization", anchor: "figuring" },
  { hook: 'my independence just became loneliness with taxes', cluster: "quiet_realization", anchor: "independence" },
  { hook: 'i quietly realized i\'m the group chat dad', cluster: "quiet_realization", anchor: "dad" },
  { hook: 'my dream job became "at least i have benefits"', cluster: "quiet_realization", anchor: "job" },
  { hook: 'my "one day" plans became "maybe never"', cluster: "quiet_realization", anchor: "plans" },
  { hook: 'i quietly realized i\'m allergic to commitment', cluster: "quiet_realization", anchor: "commitment" },
  { hook: 'i realized i\'m not "bad with money" i\'m broke', cluster: "quiet_realization", anchor: "money" },
  { hook: 'quietly realizing my friends are all married now', cluster: "quiet_realization", anchor: "friends" },
  { hook: 'my confidence just became delusional', cluster: "quiet_realization", anchor: "confidence" },
  { hook: 'quiet realization my "chill" is actually anxiety', cluster: "quiet_realization", anchor: "chill" },
  { hook: 'my "figuring things out" phase is a lifestyle', cluster: "quiet_realization", anchor: "phase" },

  // ---- PHASE Z5 — POV/relatable skit corpus expansion (+200) ---- //
  // Source: attached_assets/BATCH_1 (100 hooks) + BATCH_2 (100 hooks).
  // POV-driven relatable mini-sketches aligned to the
  // `pov_relatable_sketch` VideoPattern (Z5c). Cluster assignment
  // based on hook linguistic voice: overdramatic personification →
  // overdramatic_reframe; real-time admission/spiral → chaotic_confession;
  // soft introspective notice → quiet_realization; flat declarative →
  // dry_deadpan. Distribution: dd=61, od=55, qr=46, cc=38.
  // Additive only — no schema/cache/Claude/migration changes.
  // -- Batch 1 --
  { hook: 'pov: you said almost ready and you\'re still in towel mode', cluster: "chaotic_confession", anchor: "towel" },
  { hook: 'pov: you chose salad and the doorbell chose violence', cluster: "overdramatic_reframe", anchor: "salad" },
  { hook: 'pov: you opened the group chat and aged three years', cluster: "overdramatic_reframe", anchor: "chat" },
  { hook: 'pov: you hear a bag of chips and suddenly have questions', cluster: "overdramatic_reframe", anchor: "chips" },
  { hook: 'pov: you act busy and accidentally get assigned more work', cluster: "chaotic_confession", anchor: "work" },
  { hook: 'pov: your friend says quick favor and your soul packs a bag', cluster: "overdramatic_reframe", anchor: "favor" },
  { hook: 'pov: you said one drink and now the uber driver knows your lore', cluster: "dry_deadpan", anchor: "uber" },
  { hook: 'pov: your mom calls and your boundaries leave the room', cluster: "dry_deadpan", anchor: "mom" },
  { hook: 'pov: you open linkedin and your cereal tastes unemployed', cluster: "dry_deadpan", anchor: "linkedin" },
  { hook: 'pov: you try to walk normally after realizing people can see you', cluster: "dry_deadpan", anchor: "normally" },
  { hook: 'pov: your meal prep started looking at you weird by wednesday', cluster: "overdramatic_reframe", anchor: "looking" },
  { hook: 'pov: they said low maintenance and ordered like rent was optional', cluster: "dry_deadpan", anchor: "rent" },
  { hook: 'pov: you did one squat and your body contacted HR', cluster: "overdramatic_reframe", anchor: "squat" },
  { hook: 'pov: your plants saw you adulting and chose extinction', cluster: "overdramatic_reframe", anchor: "plants" },
  { hook: 'pov: you ghosted your group project and it still found you', cluster: "chaotic_confession", anchor: "project" },
  { hook: 'pov: your amazon package arrived from a parallel universe', cluster: "dry_deadpan", anchor: "amazon" },
  { hook: 'pov: you said you\'d cook tonight and now it\'s cereal again', cluster: "dry_deadpan", anchor: "cereal" },
  { hook: 'pov: your hair waited until public visibility to betray you', cluster: "dry_deadpan", anchor: "hair" },
  { hook: 'pov: you opened your laptop and your phone claimed custody', cluster: "overdramatic_reframe", anchor: "laptop" },
  { hook: 'pov: your crush liked your story and your brain wrote a novel', cluster: "dry_deadpan", anchor: "crush" },
  { hook: 'pov: you cleaned one room and chaos filed an appeal', cluster: "overdramatic_reframe", anchor: "chaos" },
  { hook: 'pov: you quit caffeine and 3pm started speaking in threats', cluster: "dry_deadpan", anchor: "caffeine" },
  { hook: 'pov: your phone hits 1% and becomes the most important object alive', cluster: "dry_deadpan", anchor: "phone" },
  { hook: 'pov: you tried small talk and it turned into therapy', cluster: "chaotic_confession", anchor: "therapy" },
  { hook: 'pov: your fitbit says you walked 300 steps and your legs disagree', cluster: "dry_deadpan", anchor: "fitbit" },
  { hook: 'pov: you said save money and the sale said prove it', cluster: "chaotic_confession", anchor: "sale" },
  { hook: 'pov: your airpods died and left you alone with your thoughts', cluster: "overdramatic_reframe", anchor: "airpods" },
  { hook: 'pov: you finally replied to that text and they left you on read', cluster: "dry_deadpan", anchor: "text" },
  { hook: 'pov: your outfit finally ate and the weather got jealous', cluster: "overdramatic_reframe", anchor: "outfit" },
  { hook: 'pov: your to-do list watched your weekend disappear in silence', cluster: "overdramatic_reframe", anchor: "weekend" },
  { hook: 'pov: you tried meditation and your brain threw a rave', cluster: "quiet_realization", anchor: "meditation" },
  { hook: 'pov: your show dropped a new season and your responsibilities became extras', cluster: "dry_deadpan", anchor: "show" },
  { hook: 'pov: you said no gifts and everyone treated it like a dare', cluster: "chaotic_confession", anchor: "treated" },
  { hook: 'pov: your coffee is wrong and your conflict avoidance says thank you', cluster: "quiet_realization", anchor: "coffee" },
  { hook: 'pov: you joined the gym and your couch won the custody battle', cluster: "overdramatic_reframe", anchor: "gym" },
  { hook: 'pov: the group chat woke up at 2am and brought your worst decisions', cluster: "dry_deadpan", anchor: "chat" },
  { hook: 'pov: you tried no-carb and bread seduced you immediately', cluster: "chaotic_confession", anchor: "bread" },
  { hook: 'pov: your boss said good job and your trauma waited for the but', cluster: "overdramatic_reframe", anchor: "boss" },
  { hook: 'pov: you bought the expensive skincare and your face still rebelled', cluster: "dry_deadpan", anchor: "skincare" },
  { hook: 'pov: you said you\'d go to bed early and it\'s 3am tiktok', cluster: "dry_deadpan", anchor: "tiktok" },
  { hook: 'pov: your plants survived winter but you didn\'t', cluster: "chaotic_confession", anchor: "plants" },
  { hook: 'pov: the match was cute until the voice note loaded', cluster: "dry_deadpan", anchor: "match" },
  { hook: 'pov: your food arrived before your motivation finished loading', cluster: "dry_deadpan", anchor: "motivation" },
  { hook: 'pov: you tried journaling and it became a vent session', cluster: "chaotic_confession", anchor: "journal" },
  { hook: 'pov: your wifi waited until the exact emotional support episode to collapse', cluster: "dry_deadpan", anchor: "wifi" },
  { hook: 'pov: you said you\'d be there in five and it\'s been twenty', cluster: "dry_deadpan", anchor: "five" },
  { hook: 'pov: you washed your sheets and your allergies took that personally', cluster: "dry_deadpan", anchor: "allergies" },
  { hook: 'pov: you found motivation and the weather filed an objection', cluster: "overdramatic_reframe", anchor: "motivation" },
  { hook: 'pov: your camera roll is just abandoned versions of your future self', cluster: "dry_deadpan", anchor: "camera" },
  { hook: 'pov: you tried being mysterious and your mouth had other plans', cluster: "chaotic_confession", anchor: "mouth" },
  { hook: 'my "five minute" nap just turned into a crime scene', cluster: "overdramatic_reframe", anchor: "nap" },
  { hook: 'pov: you said "no" and then felt the guilt enter', cluster: "chaotic_confession", anchor: "guilt" },
  { hook: 'pov: you checked your screen time and saw your life leaving', cluster: "chaotic_confession", anchor: "screen" },
  { hook: 'pov: the "gifted kid" just encountered a basic minor inconvenience', cluster: "quiet_realization", anchor: "basic" },
  { hook: 'pov: you tried to be "low-key" and became the main character', cluster: "chaotic_confession", anchor: "main" },
  { hook: 'i\u2019m "saving money" (i just bought three little treats)', cluster: "quiet_realization", anchor: "treats" },
  { hook: 'pov: you heard a noise at 3am and became rambo', cluster: "overdramatic_reframe", anchor: "noise" },
  { hook: 'pov: the gym crush looked your way and you died', cluster: "dry_deadpan", anchor: "gym" },
  { hook: 'pov: you opened an email that started with "as per my last"', cluster: "chaotic_confession", anchor: "email" },
  { hook: 'pov: you made eye contact with a toddler in public', cluster: "quiet_realization", anchor: "toddler" },
  { hook: 'pov: you\u2019re "rotting" in bed but the doorbell rings', cluster: "quiet_realization", anchor: "bed" },
  { hook: 'pov: you realized your "chill" hobby is now your personality', cluster: "quiet_realization", anchor: "hobby" },
  { hook: 'pov: you\u2019re trying to look busy but the boss lingers', cluster: "quiet_realization", anchor: "boss" },
  { hook: 'pov: you said "one more episode" and the sun came out', cluster: "dry_deadpan", anchor: "episode" },
  { hook: 'pov: you tried to cook and the smoke alarm judged you', cluster: "overdramatic_reframe", anchor: "alarm" },
  { hook: 'pov: you\u2019re at the register and the card didn\'t chip', cluster: "quiet_realization", anchor: "register" },
  { hook: 'pov: you told a joke and nobody laughed in the chat', cluster: "chaotic_confession", anchor: "chat" },
  { hook: 'pov: you\u2019re trying to find the song that goes "doo doo"', cluster: "quiet_realization", anchor: "song" },
  { hook: 'pov: you saw a photo of yourself you didn\'t take', cluster: "chaotic_confession", anchor: "photo" },
  { hook: 'pov: the "quick catch up" hit the three-hour mark', cluster: "dry_deadpan", anchor: "catch" },
  { hook: 'pov: you\u2019re "getting ready" (staring at a wall for an hour)', cluster: "quiet_realization", anchor: "staring" },
  { hook: 'pov: you\u2019re the "tech person" for your parents again', cluster: "quiet_realization", anchor: "parents" },
  { hook: 'pov: you entered a room and forgot your entire purpose', cluster: "dry_deadpan", anchor: "forgot" },
  { hook: 'pov: you\u2019re trying to be "mysterious" but you\u2019re just awkward', cluster: "overdramatic_reframe", anchor: "mysterious" },
  { hook: 'pov: the movie said the title and you acted like you solved cinema', cluster: "chaotic_confession", anchor: "movie" },
  { hook: 'pov: you\u2019re "drinking water" to solve all your problems', cluster: "quiet_realization", anchor: "water" },
  { hook: 'pov: you\u2019re trying to cancel a subscription and it\u2019s a war', cluster: "overdramatic_reframe", anchor: "subscription" },
  { hook: 'pov: you\u2019re listening to your own voice note', cluster: "quiet_realization", anchor: "voice" },
  { hook: 'pov: you\u2019re the "designated driver" at 2am', cluster: "quiet_realization", anchor: "designated" },
  { hook: 'pov: you\u2019re trying to "act natural" around your crush', cluster: "quiet_realization", anchor: "crush" },
  { hook: 'pov: you\u2019re "cleaning" but you found an old photo', cluster: "quiet_realization", anchor: "photo" },
  { hook: 'pov: you\u2019re at a party and the dog enters', cluster: "quiet_realization", anchor: "dog" },
  { hook: 'pov: you\u2019re "organizing" and now the room is worse', cluster: "dry_deadpan", anchor: "room" },
  { hook: 'pov: you tried a life hack and accidentally created a new problem', cluster: "chaotic_confession", anchor: "accidentally" },
  { hook: 'pov: you read the ingredients and still chose emotional ignorance', cluster: "quiet_realization", anchor: "ingredients" },
  { hook: 'pov: you\u2019re trying to "meditate" and your brain starts screaming', cluster: "dry_deadpan", anchor: "brain" },
  { hook: 'pov: you\u2019re the first one to arrive at the hang', cluster: "quiet_realization", anchor: "arrive" },
  { hook: 'pov: you\u2019re trying to "parallel park" with people watching', cluster: "quiet_realization", anchor: "parallel" },
  { hook: 'pov: you\u2019re "walking away" after a cool exit and trip', cluster: "quiet_realization", anchor: "cool" },
  { hook: 'pov: you\u2019re "re-reading" a text before you send it', cluster: "quiet_realization", anchor: "text" },
  { hook: 'pov: you\u2019re trying to "be healthy" and see a donut', cluster: "quiet_realization", anchor: "donut" },
  { hook: 'pov: you picked up the 5s and a Marvel villain sat next to you', cluster: "dry_deadpan", anchor: "villain" },
  { hook: 'pov: you\u2019re "checking the mail" and find only bills', cluster: "quiet_realization", anchor: "mail" },
  { hook: 'pov: you\u2019re trying to "fix your hair" and make it worse', cluster: "quiet_realization", anchor: "hair" },
  { hook: 'pov: the tutorial said \'just do this\' and skipped the part where you become qualified', cluster: "dry_deadpan", anchor: "tutorial" },
  { hook: 'pov: you\u2019re "trying to sleep" and remember a 2014 cringe', cluster: "quiet_realization", anchor: "sleep" },
  { hook: 'pov: you\u2019re "working from home" and the camera is on', cluster: "quiet_realization", anchor: "camera" },
  { hook: 'pov: you\u2019re "eating a snack" and your dog hears a molecule', cluster: "dry_deadpan", anchor: "snack" },
  { hook: 'pov: you\u2019re "putting on jeans" after the holidays', cluster: "quiet_realization", anchor: "jeans" },
  { hook: 'pov: you\u2019re "leaving the house" and realize you forgot... everything', cluster: "dry_deadpan", anchor: "realize" },
  // -- Batch 2 --
  { hook: 'pov: the elevator got quiet right after your stomach joined the meeting', cluster: "overdramatic_reframe", anchor: "elevator" },
  { hook: 'pov: you waved back and realized they were waving at someone behind you', cluster: "quiet_realization", anchor: "realized" },
  { hook: 'pov: the cashier asked one normal question and your vocabulary resigned', cluster: "overdramatic_reframe", anchor: "cashier" },
  { hook: 'pov: you tripped in public and had to pretend the sidewalk started it', cluster: "chaotic_confession", anchor: "sidewalk" },
  { hook: 'pov: autocorrect entered the conversation and destroyed your social standing', cluster: "overdramatic_reframe", anchor: "autocorrect" },
  { hook: 'pov: you tried to "merge" into a conversation and failed', cluster: "chaotic_confession", anchor: "conversation" },
  { hook: 'pov: the elevator door stayed open long enough for your soul to leave first', cluster: "overdramatic_reframe", anchor: "elevator" },
  { hook: 'pov: you blessed a cough and now everyone knows you panicked', cluster: "quiet_realization", anchor: "knows" },
  { hook: 'pov: you made accidental eye contact and entered a staring contest you never agreed to', cluster: "quiet_realization", anchor: "staring" },
  { hook: 'pov: you laughed before realizing it was someone\u2019s actual trauma', cluster: "quiet_realization", anchor: "laugh" },
  { hook: 'pov: you held the door but they were 40 feet away', cluster: "dry_deadpan", anchor: "door" },
  { hook: 'pov: the cashier said "hello" and you said "good"', cluster: "chaotic_confession", anchor: "cashier" },
  { hook: 'pov: you\u2019re "window shopping" but the employee is lurking', cluster: "quiet_realization", anchor: "shopping" },
  { hook: 'pov: you walked into a spiderweb in front of everyone', cluster: "dry_deadpan", anchor: "spiderweb" },
  { hook: 'pov: you recognized someone but your brain deleted their name', cluster: "overdramatic_reframe", anchor: "deleted" },
  { hook: 'pov: the restaurant server is still standing there', cluster: "dry_deadpan", anchor: "standing" },
  { hook: 'pov: you laughed at a TikTok and everyone heard', cluster: "dry_deadpan", anchor: "tiktok" },
  { hook: 'pov: you\u2019re trying to "act normal" while walking past police', cluster: "quiet_realization", anchor: "walking" },
  { hook: 'pov: you thought the "pull" door was a "push"', cluster: "dry_deadpan", anchor: "door" },
  { hook: 'pov: you\u2019re at the gym and the machine hissed', cluster: "quiet_realization", anchor: "gym" },
  { hook: 'pov: someone said your name and you became the wrong main character', cluster: "dry_deadpan", anchor: "main" },
  { hook: 'pov: you bumped into a mannequin and said "sorry"', cluster: "quiet_realization", anchor: "mannequin" },
  { hook: 'pov: the "quick sync" is on its 45th minute', cluster: "dry_deadpan", anchor: "sync" },
  { hook: 'pov: the professor said "find a partner" and you\'re cooked', cluster: "quiet_realization", anchor: "professor" },
  { hook: 'pov: your camera turned on before your personality did', cluster: "overdramatic_reframe", anchor: "camera" },
  { hook: 'pov: you opened the spreadsheet and immediately respected people with skills', cluster: "chaotic_confession", anchor: "spreadsheet" },
  { hook: 'pov: you replied all instead of just the one person', cluster: "chaotic_confession", anchor: "instead" },
  { hook: 'pov: your boss said no rush and your anxiety heard midnight deadline', cluster: "overdramatic_reframe", anchor: "boss" },
  { hook: 'you pretended to type during the entire zoom meeting', cluster: "chaotic_confession", anchor: "meeting" },
  { hook: 'pov: you\u2019re nodding in the meeting but your brain already moved cities', cluster: "dry_deadpan", anchor: "meeting" },
  { hook: 'pov: your mom says "quick question" and opens a full investigation', cluster: "overdramatic_reframe", anchor: "mom" },
  { hook: 'pov: your roommate said they cleaned and meant one spoon', cluster: "overdramatic_reframe", anchor: "roommate" },
  { hook: 'pov: the family group chat said "big news" and your nervous system left', cluster: "overdramatic_reframe", anchor: "family" },
  { hook: 'pov: your parents discovered screen sharing and ruined your afternoon', cluster: "quiet_realization", anchor: "parents" },
  { hook: 'pov: your roommate\u2019s version of quiet hours includes a blender', cluster: "dry_deadpan", anchor: "roommate" },
  { hook: 'pov: your family asked what you do for work and you forgot too', cluster: "overdramatic_reframe", anchor: "family" },
  { hook: 'pov: your roommate touched your leftovers and chose violence', cluster: "overdramatic_reframe", anchor: "roommate" },
  { hook: 'pov: your parents visit and suddenly your apartment has witnesses', cluster: "dry_deadpan", anchor: "parents" },
  { hook: 'pov: the shared fridge became a cold little crime scene', cluster: "overdramatic_reframe", anchor: "fridge" },
  { hook: 'pov: your sibling borrowed something and started a disappearance case', cluster: "overdramatic_reframe", anchor: "sibling" },
  { hook: 'pov: your dad says "come look at this" and it\u2019s a 40-minute side quest', cluster: "overdramatic_reframe", anchor: "dad" },
  { hook: 'pov: your roommate left one dish soaking like it needed therapy', cluster: "overdramatic_reframe", anchor: "roommate" },
  { hook: 'pov: you posted for fun and became your own analytics department', cluster: "chaotic_confession", anchor: "analytics" },
  { hook: 'pov: your draft was hilarious at midnight and illegal by morning', cluster: "chaotic_confession", anchor: "draft" },
  { hook: 'pov: one comment looked shady and you opened a federal case', cluster: "overdramatic_reframe", anchor: "comment" },
  { hook: 'pov: the algorithm showed your video to everyone except your audience', cluster: "dry_deadpan", anchor: "show" },
  { hook: 'pov: you said you don\u2019t care about views and refreshed every eight seconds', cluster: "chaotic_confession", anchor: "refreshed" },
  { hook: 'pov: you tried to film one take and became a hostage to your own face', cluster: "overdramatic_reframe", anchor: "hostage" },
  { hook: 'pov: your camera roll is 400 versions of the same three seconds', cluster: "chaotic_confession", anchor: "camera" },
  { hook: 'pov: your caption sounded profound until your mouth got involved', cluster: "chaotic_confession", anchor: "caption" },
  { hook: 'pov: you checked who viewed your story and found emotional evidence', cluster: "overdramatic_reframe", anchor: "story" },
  { hook: 'pov: your post got one view and you started investigating the viewery', cluster: "overdramatic_reframe", anchor: "started" },
  { hook: 'pov: you saved a trend and missed it by six business days', cluster: "chaotic_confession", anchor: "trend" },
  { hook: 'pov: you tried to be authentic and immediately over-edited yourself', cluster: "chaotic_confession", anchor: "authentic" },
  { hook: 'pov: you walked into the DMV with hope like an amateur', cluster: "dry_deadpan", anchor: "dmv" },
  { hook: 'pov: the grocery total made breathing feel financially irresponsible', cluster: "dry_deadpan", anchor: "grocery" },
  { hook: 'pov: they sent "haha" and your self-respect opened an emergency exit', cluster: "dry_deadpan", anchor: "opened" },
  { hook: 'pov: your sleeve caught the door handle and activated rage mode', cluster: "overdramatic_reframe", anchor: "sleeve" },
  { hook: 'pov: you dropped your phone and became a stunt coordinator', cluster: "overdramatic_reframe", anchor: "phone" },
  { hook: 'pov: the drawer got stuck and you made it personal', cluster: "dry_deadpan", anchor: "drawer" },
  { hook: 'pov: your mirror hyped you up and the front camera reported the truth', cluster: "overdramatic_reframe", anchor: "camera" },
  { hook: 'pov: you entered a room and your mission deleted itself', cluster: "overdramatic_reframe", anchor: "mission" },
  { hook: 'pov: one video had a part two and your sleep schedule packed its bags', cluster: "overdramatic_reframe", anchor: "sleep" },
  { hook: 'pov: you downloaded a fitness app and counted that as cardio', cluster: "quiet_realization", anchor: "fitness" },
  { hook: 'pov: you put on activewear and emotionally completed the workout', cluster: "quiet_realization", anchor: "activewear" },
  { hook: 'pov: you tried meditation and your brain brought slides', cluster: "quiet_realization", anchor: "slides" },
  { hook: 'pov: you tried sleeping early and your brain requested a meeting', cluster: "overdramatic_reframe", anchor: "meeting" },
  { hook: 'pov: you stretched for wellness and discovered new injuries', cluster: "quiet_realization", anchor: "stretch" },
  { hook: 'pov: you drank water once and waited for your life to change', cluster: "quiet_realization", anchor: "water" },
  { hook: 'pov: your cereal dinner started feeling like a financial strategy', cluster: "overdramatic_reframe", anchor: "cereal" },
  { hook: 'pov: the chip bag made one sound and your discipline left the room', cluster: "overdramatic_reframe", anchor: "chip" },
  { hook: 'pov: your meal prep became a hostage situation by wednesday', cluster: "overdramatic_reframe", anchor: "hostage" },
  { hook: 'pov: you bought spinach once and became impossible to talk to', cluster: "dry_deadpan", anchor: "spinach" },
  { hook: 'pov: you said one snack and accidentally built a tasting menu', cluster: "chaotic_confession", anchor: "snack" },
  { hook: 'pov: the date went well and now you have to act normal after', cluster: "quiet_realization", anchor: "date" },
  { hook: 'pov: they liked your story and your brain booked the reception hall', cluster: "dry_deadpan", anchor: "story" },
  { hook: 'pov: the professor said easy assignment and the rubric committed fraud', cluster: "overdramatic_reframe", anchor: "professor" },
  { hook: 'pov: you joined the call and forgot your own name', cluster: "chaotic_confession", anchor: "forgot" },
  { hook: 'pov: you opened the assignment portal and met your consequences', cluster: "chaotic_confession", anchor: "assignment" },
  { hook: 'pov: the group chat was alive until you asked who\u2019s doing the slides', cluster: "dry_deadpan", anchor: "slides" },
  { hook: 'pov: you unmuted to talk and forgot every word', cluster: "chaotic_confession", anchor: "forgot" },
  { hook: 'pov: you made a to-do list and felt falsely powerful', cluster: "dry_deadpan", anchor: "felt" },
  { hook: 'pov: you said i\u2019ll do it later and later arrived armed', cluster: "chaotic_confession", anchor: "arrived" },
  { hook: 'pov: the teacher said partner up and every friendship got drafted before you blinked', cluster: "chaotic_confession", anchor: "teacher" },
  { hook: 'pov: you turned your camera on and met your sleep schedule', cluster: "dry_deadpan", anchor: "camera" },
  { hook: 'pov: you volunteered once and got adopted by responsibility', cluster: "overdramatic_reframe", anchor: "adopted" },
  { hook: 'pov: the restaurant got quiet during your loudest sentence', cluster: "dry_deadpan", anchor: "loudest" },
  { hook: 'pov: your grocery basket broke your rich illusion', cluster: "overdramatic_reframe", anchor: "grocery" },
  { hook: 'pov: you laughed too hard before understanding the joke', cluster: "dry_deadpan", anchor: "joke" },
  { hook: 'pov: you said excuse me and nobody was blocking you', cluster: "dry_deadpan", anchor: "nobody" },
  { hook: 'pov: you posted and refreshed like payroll depended on it', cluster: "chaotic_confession", anchor: "payroll" },
  { hook: 'pov: one comment ruined your entire artistic movement', cluster: "dry_deadpan", anchor: "comment" },
  { hook: 'pov: you gained one follower and planned headquarters', cluster: "overdramatic_reframe", anchor: "follower" },
  { hook: 'pov: your friend says post it and disappears immediately', cluster: "dry_deadpan", anchor: "post" },
  { hook: 'pov: the dmv line aged you in real time', cluster: "dry_deadpan", anchor: "dmv" },
  { hook: 'pov: you returned one item and somehow owed money', cluster: "dry_deadpan", anchor: "money" },
  { hook: 'pov: parking looked easy until the curb developed an attitude', cluster: "quiet_realization", anchor: "parking" },
  { hook: 'pov: self-checkout needed a manager for your bananas', cluster: "overdramatic_reframe", anchor: "bananas" },
  { hook: 'pov: one quick errand turned into an unpaid internship in patience', cluster: "overdramatic_reframe", anchor: "errand" },
  { hook: 'pov: you found the office and still missed the appointment', cluster: "dry_deadpan", anchor: "appointment" },

    // ═══════════════════════════════════════════════════════════
    // PHASE Z5 — Surprise Twist Endings (Batch 3) — 99 entries
    // Category: Surprise twist endings
    // Clusters: dd=21, od=27, qr=29, cc=22
    // ═══════════════════════════════════════════════════════════
  { hook: 'i went outside for peace and came back with bonus anxiety', cluster: "dry_deadpan", anchor: "anxiety" },
  { hook: 'i cleaned my room and found out the mess had structural integrity', cluster: "overdramatic_reframe", anchor: "room" },
  { hook: 'i tried to relax and accidentally audited my entire life', cluster: "chaotic_confession", anchor: "life" },
  { hook: 'i bought running shoes and immediately entered my collector era', cluster: "chaotic_confession", anchor: "shoes" },
  { hook: 'i opened my budget and watched my delusion get itemized', cluster: "quiet_realization", anchor: "budget" },
  { hook: 'i deleted their number and my thumbs said "watch this"', cluster: "dry_deadpan", anchor: "number" },
  { hook: 'i took a mental health walk and got humbled by a baby hill', cluster: "dry_deadpan", anchor: "walk" },
  { hook: 'i posted for fun and became unpaid head of analytics', cluster: "chaotic_confession", anchor: "analytics" },
  { hook: 'i tried to be spontaneous and scheduled it for next thursday', cluster: "overdramatic_reframe", anchor: "schedule" },
  { hook: 'i opened my notes app to organize my life and found evidence against me', cluster: "dry_deadpan", anchor: "life" },
  { hook: 'my meal prep started looking at me weird by wednesday', cluster: "chaotic_confession", anchor: "meal" },
  { hook: 'i stretched for wellness and discovered a new sound effect', cluster: "dry_deadpan", anchor: "sound" },
  { hook: 'i meal prepped and accidentally built five little prisons', cluster: "dry_deadpan", anchor: "meal" },
  { hook: 'i went to bed early and my brain requested a meeting', cluster: "dry_deadpan", anchor: "brain" },
  { hook: 'i bought vegetables and became annoying for six minutes', cluster: "dry_deadpan", anchor: "vegetables" },
  { hook: 'i downloaded a fitness app and counted that as cardio', cluster: "dry_deadpan", anchor: "app" },
  { hook: 'i tried meditation and my brain brought a guest speaker', cluster: "overdramatic_reframe", anchor: "brain" },
  { hook: 'i went sugar-free and immediately developed cake awareness', cluster: "overdramatic_reframe", anchor: "cake" },
  { hook: 'i drank green juice and my personality left the room', cluster: "dry_deadpan", anchor: "room" },
  { hook: 'i walked in confident and immediately switched to manual legs', cluster: "chaotic_confession", anchor: "walk" },
  { hook: 'you thought the date was going perfectly until they said "my ex would love you"', cluster: "quiet_realization", anchor: "date" },
  { hook: 'you thought you nailed the silent exit until your phone betrayed you', cluster: "overdramatic_reframe", anchor: "phone" },
  { hook: 'your first impression was perfect until your friends started live-commenting', cluster: "chaotic_confession", anchor: "impression" },
  { hook: 'you finally cooked a flawless meal and the smoke alarm demanded credit', cluster: "dry_deadpan", anchor: "meal" },
  { hook: 'the gym win felt real until your headphones launched across the room', cluster: "chaotic_confession", anchor: "room" },
  { hook: 'your grand romantic gesture became a solo performance', cluster: "chaotic_confession", anchor: "gesture" },
  { hook: 'you mastered the fake laugh until it became real horror', cluster: "overdramatic_reframe", anchor: "laugh" },
  { hook: 'the online order looked perfect until it arrived in doll size', cluster: "quiet_realization", anchor: "order" },
  { hook: 'you thought the zoom call was muted until your mom walked in', cluster: "quiet_realization", anchor: "walk" },
  { hook: 'your stealth snack run ended with a standing ovation', cluster: "chaotic_confession", anchor: "snack" },
  { hook: 'the group project was saved until the teacher opened the doc', cluster: "quiet_realization", anchor: "project" },
  { hook: 'your confident walk turned legendary because your shoe betrayed you', cluster: "overdramatic_reframe", anchor: "walk" },
  { hook: 'you thought it was a promotion cake until your name was spelled wrong', cluster: "quiet_realization", anchor: "cake" },
  { hook: 'the surprise party you planned started before the birthday person arrived', cluster: "chaotic_confession", anchor: "party" },
  { hook: 'your budget was bulletproof until one click destroyed it', cluster: "overdramatic_reframe", anchor: "budget" },
  { hook: 'the healthy meal prep lasted until your emotions ordered pizza', cluster: "quiet_realization", anchor: "meal" },
  { hook: 'the job interview was flawless until your pet joined the call', cluster: "quiet_realization", anchor: "interview" },
  { hook: 'the road trip playlist was perfect until shuffle exposed your feelings', cluster: "chaotic_confession", anchor: "playlist" },
  { hook: 'your confident coffee order ended with a drink from another timeline', cluster: "chaotic_confession", anchor: "order" },
  { hook: 'you thought the fitting room was locked until the curtain disagreed', cluster: "chaotic_confession", anchor: "room" },
  { hook: 'your presentation was flawless until the last slide exposed your camera roll energy', cluster: "chaotic_confession", anchor: "presentation" },
  { hook: 'you thought the text was to your bestie until it wasn\'t', cluster: "quiet_realization", anchor: "text" },
  { hook: 'the surprise visit was perfect until the wrong door opened', cluster: "quiet_realization", anchor: "door" },
  { hook: 'you beat the final boss and remembered your real deadline', cluster: "overdramatic_reframe", anchor: "boss" },
  { hook: 'the coffee run was flawless until the lid had trust issues', cluster: "overdramatic_reframe", anchor: "coffee" },
  { hook: 'your anonymous feedback stopped feeling anonymous real fast', cluster: "chaotic_confession", anchor: "feedback" },
  { hook: 'your love letter was poetic until autocorrect got creative', cluster: "quiet_realization", anchor: "letter" },
  { hook: 'the team-building game revealed you are not built for trust', cluster: "chaotic_confession", anchor: "trust" },
  { hook: 'you thought it was a drill until your snack got left behind', cluster: "quiet_realization", anchor: "drill" },
  { hook: 'the perfect selfie angle hid one catastrophic truth', cluster: "overdramatic_reframe", anchor: "selfie" },
  { hook: 'your victory lap was iconic until gravity remembered you', cluster: "quiet_realization", anchor: "gravity" },
  { hook: 'everything was going according to plan until one tiny task became the final boss', cluster: "overdramatic_reframe", anchor: "boss" },
  { hook: 'you waved at your neighbor and accidentally started a weekly obligation', cluster: "chaotic_confession", anchor: "neighbor" },
  { hook: 'you paid all your bills early and your account immediately overdrafted', cluster: "overdramatic_reframe", anchor: "bills" },
  { hook: 'you cleaned your entire apartment then lost your keys in the mess', cluster: "chaotic_confession", anchor: "mess" },
  { hook: 'you organized your closet and now can\'t find anything', cluster: "dry_deadpan", anchor: "closet" },
  { hook: 'you tried reverse psychology and accidentally got exactly what you asked for', cluster: "chaotic_confession", anchor: "psychology" },
  { hook: 'you told your mom not to worry about you and she called nonstop', cluster: "overdramatic_reframe", anchor: "mom" },
  { hook: 'you gave your plant one pep talk and it chose drama', cluster: "chaotic_confession", anchor: "plan" },
  { hook: 'i joined the call and my camera introduced a stranger', cluster: "quiet_realization", anchor: "camera" },
  { hook: 'i tried to look busy and got promoted to responsible', cluster: "quiet_realization", anchor: "look" },
  { hook: 'i posted at the perfect time and the algorithm took the day off', cluster: "quiet_realization", anchor: "algorithm" },
  { hook: 'my alarm clock chose violence and i chose denial', cluster: "dry_deadpan", anchor: "alarm" },
  { hook: 'my phone hit 1% and became the most important object alive', cluster: "dry_deadpan", anchor: "phone" },
  { hook: 'my chair made one sound and became the suspect', cluster: "dry_deadpan", anchor: "sound" },
  { hook: 'my airpods died and left me alone with the real me', cluster: "dry_deadpan", anchor: "airpods" },
  { hook: 'my wi-fi waited until the emotional support episode to collapse', cluster: "overdramatic_reframe", anchor: "wi-fi" },
  { hook: 'my fridge is full but none of it matches my spirit', cluster: "overdramatic_reframe", anchor: "fridge" },
  { hook: 'i bought a planner and immediately started lying to it', cluster: "dry_deadpan", anchor: "plan" },
  { hook: 'i cleaned my camera lens and found out it was just my face', cluster: "dry_deadpan", anchor: "camera" },
  { hook: 'i said just browsing and the cart started making decisions', cluster: "overdramatic_reframe", anchor: "cart" },
  { hook: 'i tried to fix my sleep schedule and created a night shift', cluster: "dry_deadpan", anchor: "sleep" },
  { hook: 'i wore gym clothes and emotionally completed the workout', cluster: "dry_deadpan", anchor: "gym" },
  { hook: 'i asked for advice and received a character assassination', cluster: "overdramatic_reframe", anchor: "advice" },
  { hook: 'i tried to be humble and immediately checked if anyone noticed', cluster: "chaotic_confession", anchor: "humble" },
  { hook: 'your phone battery died the second you hit record', cluster: "overdramatic_reframe", anchor: "phone" },
  { hook: 'gps promised 10 minutes and delivered a nightmare tour', cluster: "overdramatic_reframe", anchor: "gps" },
  { hook: 'autocorrect turned your flirty text into a crime scene', cluster: "overdramatic_reframe", anchor: "text" },
  { hook: 'your keys hid perfectly right as you were already late', cluster: "overdramatic_reframe", anchor: "keys" },
  { hook: 'i ghosted my goals harder than my ex ghosted me', cluster: "quiet_realization", anchor: "goals" },
  { hook: 'i looked in the mirror and my reflection asked for space', cluster: "overdramatic_reframe", anchor: "mirror" },
  { hook: 'my bank account and i are in a toxic situationship', cluster: "overdramatic_reframe", anchor: "account" },
  { hook: 'my confidence is sky high until anyone looks at me', cluster: "quiet_realization", anchor: "confidence" },
  { hook: 'i called this my glow up while wearing yesterday\'s hoodie at 3pm', cluster: "quiet_realization", anchor: "hoodie" },
  { hook: 'i tried being mysterious and my mouth had other plans', cluster: "quiet_realization", anchor: "plan" },
  { hook: 'i said "this time i\'ll stick to the plan" and the plan asked for proof', cluster: "quiet_realization", anchor: "plan" },
  { hook: 'my dating profile says outdoorsy and my couch would like a word', cluster: "quiet_realization", anchor: "door" },
  { hook: 'my motivation shows up right before i go to sleep', cluster: "quiet_realization", anchor: "sleep" },
  { hook: 'i tried self-care and my anxiety threw a block party', cluster: "quiet_realization", anchor: "anxiety" },
  { hook: 'my hair looked perfect until outside loaded', cluster: "quiet_realization", anchor: "hair" },
  { hook: 'i tried being consistent and day two filed a complaint', cluster: "quiet_realization", anchor: "complaint" },
  { hook: 'i pay for spotify premium and still let five songs raise me', cluster: "quiet_realization", anchor: "spotify" },
  { hook: 'i said i\'d sleep early and tiktok introduced a witness', cluster: "quiet_realization", anchor: "sleep" },
  { hook: 'me acting like i don\'t care but replaying the voice note', cluster: "dry_deadpan", anchor: "voice" },
  { hook: 'i said i was turning my life around and took the scenic route', cluster: "quiet_realization", anchor: "life" },
  { hook: 'you asked how their day was and accidentally opened the extended cut', cluster: "overdramatic_reframe", anchor: "asked" },
  { hook: 'your quick favor turned into moving their entire house', cluster: "overdramatic_reframe", anchor: "favor" },
  { hook: 'one polite complaint turned into a corporate side quest', cluster: "overdramatic_reframe", anchor: "complaint" },
  { hook: 'you said maybe later and they started planning a shared calendar', cluster: "chaotic_confession", anchor: "calendar" },
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
