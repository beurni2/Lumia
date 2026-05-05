/**
 * PHASE Y6 — CORE × DOMAIN × ANCHOR CATALOG
 *
 * For each of the 40 PremiseCores in `premiseCoreLibrary.ts` this
 * catalog enumerates 4-6 canonical domains, and for each (core,
 * domain) pair lists 3-5 concrete single-token anchor nouns plus a
 * default `exampleAction` verb describing the contradiction beat.
 *
 * Anchors are deliberately SINGLE-WORD content nouns (e.g.
 * "alarm", "fridge", "inbox", "groupchat") so the comedy-validation
 * tokenizer (`/[a-z][a-z0-9']{2,}/g` + STOPWORDS) sees them as
 * one stable token shared between hook ↔ whatToShow ↔ howToFilm.
 * Multi-word anchors like "to-do list" would split into "todo" +
 * "list" with one of those words landing on a stopword, breaking
 * the alignment math the cohesive author relies on.
 *
 * The catalog is built at module load by canonicalizing each
 * core's `compatibleDomains` through `RAW_DOMAIN_TO_CANONICAL`,
 * deduping, padding from a per-family default pool when a core
 * winds up with <5 unique canonical domains, then attaching the
 * per-canonical anchor + per-family action.
 *
 * Boot-time assertions:
 *   - every core in `PREMISE_CORES` is present
 *   - every (core, domain) row has anchors.length ≥ 3
 *   - total (core, domain, anchor) triples ≥ 1000 (Y12 raised this
 *     from 800 after each domain row gained a 6th anchor)
 *
 * Pure / frozen at load. NO Claude. NO DB. Same discipline as
 * `premiseCoreLibrary.ts` and `voiceClusters.ts`.
 */

import {
  PREMISE_CORES,
  type PremiseCore,
  type PremiseCoreFamily,
} from "./premiseCoreLibrary.js";
import { canonicalizeToken } from "./scenarioFingerprint.js";

// ---------------------------------------------------------------- //
// Canonical domain set                                              //
// ---------------------------------------------------------------- //

export type CanonicalDomain =
  | "sleep"
  | "food"
  | "money"
  | "phone"
  | "work"
  | "fitness"
  | "dating"
  | "social"
  | "home"
  | "mornings"
  | "study"
  | "content";

// PHASE Y7 — every row MUST collapse to ≥5 DISTINCT
// `canonicalizeToken` keys (post lemma + SYNONYM_MAP). The Y6
// catalog had 6 rows that padded to 5 anchors via SYNONYM_MAP
// synonyms of the same noun (e.g. `sleep: alarm/blanket/pillow/
// snooze/lamp` → all 5 collapse to {`alarm`, `lamp`} = 2 distinct
// keys), which made the recipe queue look like it was rotating
// across 5 anchors but was really cycling 2 fingerprints. The
// boot assert below enforces the new floor; `canonicalize` is
// re-imported from `scenarioFingerprint` so the assert and the
// dedup share one canonicalization rule.
// PHASE Y12 — each domain row holds 6 anchors (was 5 in Y7). The
// extra anchor per domain widens the (core, domain, anchor) recipe
// surface from ~1000 → ~1200 triples, giving the deterministic
// recipe loop more distinct fingerprints to rotate through before
// the 7-batch freshness window starts forcing repeats. Each new
// anchor was hand-verified to (a) canonicalize to a key that's NOT
// already in the row's existing 5, (b) be a single-word concrete
// noun the comedy-validation tokenizer keeps as one stable token,
// and (c) be camera-distinct from the existing anchors in the row.
const CANONICAL_DOMAIN_ANCHORS: Record<CanonicalDomain, readonly string[]> = {
  // sleep: alarm/lamp/mattress/slippers/eyemask + Y12 `bed`
  // (lemma=bed, no SYNONYM_MAP entry → distinct key, iconic).
  sleep: ["alarm", "lamp", "mattress", "slippers", "eyemask", "bed"],
  // food: fridge/fork/groceries/oven/plate + Y12 `pan`
  // (lemma=pan → distinct, classic kitchen prop).
  food: ["fridge", "fork", "groceries", "oven", "plate", "pan"],
  // money: wallet/savings/venmo/atm/statement + Y12 `coupon`
  // (lemma=coupon → distinct, money-adjacent visible prop).
  money: ["wallet", "savings", "venmo", "atm", "statement", "coupon"],
  // phone: phone/lockscreen/thumb/charger/earbuds + Y12 `wallpaper`
  // (lemma=wallpaper → distinct, phone-adjacent visual surface).
  phone: ["phone", "lockscreen", "thumb", "charger", "earbuds", "wallpaper"],
  // work: inbox/tasks/calendar/tab/doc + Y12 `keyboard`
  // (lemma=keyboard → distinct, universal work prop).
  work: ["inbox", "tasks", "calendar", "tab", "doc", "keyboard"],
  // fitness: gym/yoga/pushups/shoes/dumbbell + Y12 `bottle`
  // (lemma=bottle → distinct, classic fitness prop).
  fitness: ["gym", "yoga", "pushups", "shoes", "dumbbell", "bottle"],
  // dating: app/thread/profile/swipe/bio + Y12 `crush`
  // (lemma=crush → distinct, dating-context noun).
  dating: ["app", "thread", "profile", "swipe", "bio", "crush"],
  // social: groupchat/invite/rsvp/voicememo/table + Y12 `gift`
  // (lemma=gift → distinct, party/social staple).
  social: ["groupchat", "invite", "rsvp", "voicememo", "table", "gift"],
  // home: dishes/sink/junk/mail/vacuum + Y12 `couch`
  // (lemma=couch → distinct, iconic home object).
  home: ["dishes", "sink", "junk", "mail", "vacuum", "couch"],
  // mornings: coffee/mirror/kettle/toothbrush/towel + Y12 `robe`
  // (lemma=robe → distinct, morning-routine prop).
  mornings: ["coffee", "mirror", "kettle", "toothbrush", "towel", "robe"],
  // study: notes/textbook/flashcards/syllabus/highlighter + Y12 `pen`
  // (lemma=pen → distinct, universal study prop).
  study: ["notes", "textbook", "flashcards", "syllabus", "highlighter", "pen"],
  // content: lens/draft/ringlight/tripod/selfie + Y12 `caption`
  // (lemma=caption → distinct, creator-workflow object).
  content: ["lens", "draft", "ringlight", "tripod", "selfie", "caption"],
};

// ---------------------------------------------------------------- //
// Synonym map: raw library domain → canonical                       //
// ---------------------------------------------------------------- //

const RAW_DOMAIN_TO_CANONICAL: Record<string, CanonicalDomain> = {
  // sleep
  sleep: "sleep",
  bed: "sleep",
  // food
  food: "food",
  diet: "food",
  meal_prep: "food",
  groceries: "food",
  cooking: "food",
  cooking_aspiration: "food",
  food_orders: "food",
  // money
  money: "money",
  spending: "money",
  shopping: "money",
  subscriptions: "money",
  rent: "money",
  bills: "money",
  tax: "money",
  fitness_gear: "money",
  // phone
  phone: "phone",
  tiktok: "phone",
  instagram: "phone",
  reddit: "phone",
  social_media: "phone",
  voice_memos: "phone",
  video_calls: "phone",
  boredom: "phone",
  // work
  work: "work",
  errands: "work",
  email: "work",
  work_admin: "work",
  career: "work",
  work_life: "work",
  work_meeting: "work",
  work_meetings: "work",
  work_dms: "work",
  productivity: "work",
  creative_work: "work",
  weekend: "work",
  cleaning: "work",
  tech: "work",
  // fitness
  fitness: "fitness",
  exercise: "fitness",
  sports: "fitness",
  dancing: "fitness",
  hobbies: "fitness",
  wellness: "fitness",
  habits: "fitness",
  self_care: "fitness",
  discipline: "fitness",
  // dating
  dating: "dating",
  first_date: "dating",
  ex_relationships: "dating",
  exes: "dating",
  // social
  social: "social",
  friendship: "social",
  family: "social",
  family_chat: "social",
  family_dinner: "social",
  parties: "social",
  service_workers: "social",
  small_talk: "social",
  embarrassment: "social",
  anxiety: "social",
  doctor: "social",
  ethics: "social",
  // home
  home: "home",
  household: "home",
  aesthetic: "home",
  self_image: "home",
  appearance: "home",
  lifestyle: "home",
  identity: "home",
  age: "home",
  city_life: "home",
  small_annoyances: "home",
  // mornings
  morning_routine: "mornings",
  morning: "mornings",
  shower: "mornings",
  // study
  study: "study",
  languages: "study",
  skills: "study",
  self_help: "study",
  tech_literacy: "study",
  // content
  content: "content",
  content_creation: "content",
  music: "content",
  media: "content",
  fashion: "content",
};

// ---------------------------------------------------------------- //
// Per-family default canonical pool (for padding under-spec cores) //
// ---------------------------------------------------------------- //

const FAMILY_DEFAULT_DOMAINS: Record<
  PremiseCoreFamily,
  readonly CanonicalDomain[]
> = {
  self_betrayal: ["sleep", "food", "money", "phone", "work", "fitness"],
  self_as_relationship: ["phone", "work", "dating", "social", "fitness", "home"],
  absurd_escalation: ["work", "phone", "money", "home", "social", "mornings"],
  confident_vs_real: ["work", "social", "dating", "content", "fitness", "food"],
  social_mask: ["social", "work", "dating", "phone", "content", "home"],
  adulting_chaos: ["money", "food", "work", "home", "mornings", "phone"],
  dopamine_overthinking: ["phone", "social", "work", "mornings", "money", "study"],
  identity_exposure: ["content", "home", "fitness", "social", "phone", "food"],
};

// ---------------------------------------------------------------- //
// Per-family default action verb (the "contradiction beat" verb)    //
// ---------------------------------------------------------------- //

export type FamilyAction = {
  readonly bare: string;
  readonly past: string;
  readonly ing: string;
};

export const FAMILY_ACTIONS: Record<PremiseCoreFamily, FamilyAction> = {
  self_betrayal: { bare: "abandon", past: "abandoned", ing: "abandoning" },
  self_as_relationship: { bare: "ghost", past: "ghosted", ing: "ghosting" },
  absurd_escalation: { bare: "spiral", past: "spiraled", ing: "spiraling" },
  confident_vs_real: { bare: "fake", past: "faked", ing: "faking" },
  social_mask: { bare: "perform", past: "performed", ing: "performing" },
  adulting_chaos: { bare: "avoid", past: "avoided", ing: "avoiding" },
  dopamine_overthinking: {
    bare: "overthink",
    past: "overthought",
    ing: "overthinking",
  },
  identity_exposure: { bare: "expose", past: "exposed", ing: "exposing" },
};

// ---------------------------------------------------------------- //
// Public types                                                      //
// ---------------------------------------------------------------- //

export type CoreDomainAnchorRow = {
  readonly domain: CanonicalDomain;
  readonly anchors: readonly string[];
  readonly exampleAction: string;
};

// ---------------------------------------------------------------- //
// Catalog construction                                              //
// ---------------------------------------------------------------- //

const TARGET_DOMAINS_PER_CORE = 5;

function canonicalizeAndPad(core: PremiseCore): CanonicalDomain[] {
  const seen = new Set<CanonicalDomain>();
  const out: CanonicalDomain[] = [];
  for (const raw of core.compatibleDomains) {
    const canon = RAW_DOMAIN_TO_CANONICAL[raw];
    if (!canon) continue;
    if (seen.has(canon)) continue;
    seen.add(canon);
    out.push(canon);
    if (out.length >= TARGET_DOMAINS_PER_CORE) return out;
  }
  // Pad from family defaults until we hit the target.
  for (const canon of FAMILY_DEFAULT_DOMAINS[core.family]) {
    if (seen.has(canon)) continue;
    seen.add(canon);
    out.push(canon);
    if (out.length >= TARGET_DOMAINS_PER_CORE) return out;
  }
  return out;
}

// PHASE Y7 — boot-time distinctness assert: every domain row MUST
// resolve to ≥5 distinct `canonicalizeToken` keys. Catches the Y6
// regression where SYNONYM_MAP collapsed multiple anchors to the
// same key and the recipe queue silently shipped duplicates.
for (const [domain, anchors] of Object.entries(CANONICAL_DOMAIN_ANCHORS)) {
  const canonicalKeys = new Set<string>();
  for (const a of anchors) canonicalKeys.add(canonicalizeToken(a));
  if (canonicalKeys.size < 5) {
    throw new Error(
      `[coreDomainAnchorCatalog] domain '${domain}' has only ${canonicalKeys.size} distinct canonical keys (anchors=${JSON.stringify(anchors)}, keys=${JSON.stringify([...canonicalKeys])}); require ≥5`,
    );
  }
}

function buildCatalog(): Readonly<Record<string, readonly CoreDomainAnchorRow[]>> {
  const out: Record<string, readonly CoreDomainAnchorRow[]> = {};
  let totalTriples = 0;
  for (const core of PREMISE_CORES) {
    const canonicalDomains = canonicalizeAndPad(core);
    if (canonicalDomains.length < 4) {
      throw new Error(
        `[coreDomainAnchorCatalog] core '${core.id}' has only ${canonicalDomains.length} canonical domains after padding (require ≥4)`,
      );
    }
    const action = FAMILY_ACTIONS[core.family];
    const rows: CoreDomainAnchorRow[] = canonicalDomains.map((d) => {
      const anchors = CANONICAL_DOMAIN_ANCHORS[d];
      if (!anchors || anchors.length < 3) {
        throw new Error(
          `[coreDomainAnchorCatalog] canonical domain '${d}' has <3 anchors`,
        );
      }
      return Object.freeze({
        domain: d,
        anchors: Object.freeze([...anchors]),
        exampleAction: action.bare,
      });
    });
    out[core.id] = Object.freeze(rows);
    totalTriples += rows.reduce((n, r) => n + r.anchors.length, 0);
  }
  // PHASE Y12 — floor raised from 800 to 1000 after each domain
  // row gained a 6th anchor (~40 cores × 5 domains × 6 anchors =
  // 1200 expected; 1000 gives headroom for under-spec cores).
  if (totalTriples < 1000) {
    throw new Error(
      `[coreDomainAnchorCatalog] only ${totalTriples} (core, domain, anchor) triples (require ≥1000)`,
    );
  }
  return Object.freeze(out);
}

export const CORE_DOMAIN_ANCHORS: Readonly<
  Record<string, readonly CoreDomainAnchorRow[]>
> = buildCatalog();

// Boot-time coverage assertion: every coreId in PREMISE_CORES is
// present (defense in depth — buildCatalog already iterates them
// but a future refactor could miss a row).
for (const core of PREMISE_CORES) {
  if (!CORE_DOMAIN_ANCHORS[core.id]) {
    throw new Error(
      `[coreDomainAnchorCatalog] core '${core.id}' missing from catalog`,
    );
  }
}

// ---------------------------------------------------------------- //
// Convenience accessors                                             //
// ---------------------------------------------------------------- //

export function getCoreDomainAnchors(
  coreId: string,
): readonly CoreDomainAnchorRow[] {
  return CORE_DOMAIN_ANCHORS[coreId] ?? [];
}

/** Flat list of every (coreId, domain, anchor, action) recipe in
 *  the catalog. Materialized lazily on first call (modest memory
 *  cost, ~1000 rows). Used by `cohesiveIdeaAuthor` for fingerprint
 *  probing and by the QA harness for total-coverage stats. */
let _allAnchorsFlat: ReadonlySet<string> | null = null;
export function getAllCatalogAnchors(): ReadonlySet<string> {
  if (_allAnchorsFlat) return _allAnchorsFlat;
  const s = new Set<string>();
  for (const rows of Object.values(CORE_DOMAIN_ANCHORS)) {
    for (const row of rows) {
      for (const a of row.anchors) s.add(a.toLowerCase());
    }
  }
  _allAnchorsFlat = s;
  return s;
}

/** PHASE Y7 — flat set of every action verb (bare form) the catalog
 *  uses, for `extractAnchorAndAction` probing. Materialized lazily
 *  on first call. Each `FAMILY_ACTIONS[family].bare` is unique per
 *  family but we expose the union here so callers don't need to
 *  iterate the FAMILY_ACTIONS map themselves. */
let _allActionsFlat: ReadonlySet<string> | null = null;
export function getAllCatalogActions(): ReadonlySet<string> {
  if (_allActionsFlat) return _allActionsFlat;
  const s = new Set<string>();
  for (const a of Object.values(FAMILY_ACTIONS)) {
    s.add(a.bare.toLowerCase());
  }
  _allActionsFlat = s;
  return s;
}

// ---------------------------------------------------------------- //
// PHASE UX3.1 — Anchor-aware verb override                          //
// ---------------------------------------------------------------- //
//
// Family-action verbs (`abandon`, `ghost`, `spiral`, `fake`) are
// abstract / relational and don't compose with every concrete
// anchor in the catalog. Pre-UX3.1 these produced the screenshot-
// grade nonsense:
//   - "abandon the fork once, slow"
//   - "ghost the calendar knowingly"
//   - "spiral the lockscreen once, slow"
//   - "fake my own tab"
//
// Fix: per-anchor fallback verb (single word, regular tenses) used
// when the family verb is in `STIFF_FAMILY_VERBS` and the
// (verb, anchor) pair is NOT in `VERB_ANCHOR_PLAUSIBLE`. Other
// family verbs (`avoid`, `expose`, `perform`, `overthink`) compose
// broadly enough that they pass through unchanged.
//
// Single-word verbs only — multi-word verbs would break the
// `${actionBare} the ${anchor}` template grammar.

/** Family verbs that need anchor-fitting overrides for most concrete
 *  anchors (the `{family-verb} the {object}` construction reads as
 *  template stiffness for these four). */
const STIFF_FAMILY_VERBS: ReadonlySet<string> = new Set([
  "abandon",
  "ghost",
  "spiral",
  "fake",
]);

/** Per stiff family verb, the set of anchors where the verb DOES
 *  read naturally. Membership = use the family verb. Non-membership
 *  = swap to `ANCHOR_VERB_FALLBACK[anchor]`.
 *
 *  Conservative whitelist — when in doubt, swap. Empty set for
 *  `spiral` because it's intransitive in natural English ("i
 *  spiraled" not "i spiraled the X"). */
const VERB_ANCHOR_PLAUSIBLE: Record<string, ReadonlySet<string>> = {
  // `abandon` composes with concrete tasks/objects you actively
  // walk away from. `fork` is intentionally NOT here — "abandon
  // the fork" was the directive's first ship-blocker example.
  abandon: new Set([
    "draft", "plan", "groceries", "plate", "coffee", "textbook",
    "syllabus", "tasks", "tab", "doc", "inbox", "yoga",
    "gym", "pushups", "notes", "flashcards", "cart", "highlighter",
  ]),
  // `ghost` composes with people / messaging surfaces. PHASE UX3.1
  // P0: REMOVED `calendar`, `tasks`, `inbox` — directive flagged
  // "ghost the calendar" specifically as nonsense; `tasks`/`inbox`
  // belong to the calendar/work cluster that drift with `ghost`
  // the same way. The fallback table provides `dodge` for all
  // three so the swap is non-destructive.
  ghost: new Set([
    "thread", "groupchat", "invite", "rsvp", "crush", "profile",
    "app", "swipe", "bio", "voicememo",
    "table", "gift", "dm", "message",
  ]),
  spiral: new Set([]),
  // `fake` composes with personae/social surfaces. PHASE UX3.1 P0:
  // REMOVED `tab`, `tasks`, `calendar`, `invite`, `rsvp`, `draft`,
  // `swipe` — directive flagged "fake my own tab" specifically;
  // the others are the same calendar/work-admin abstraction class.
  fake: new Set([
    "app", "profile", "bio", "crush", "thread", "selfie",
    "caption", "groupchat", "gym", "yoga", "pushups",
  ]),
};

/** Per-anchor fallback verb. Single-word, regular tenses where
 *  possible. Picked for natural fit with `{verb} the {anchor}`. */
const ANCHOR_VERB_FALLBACK: Record<string, FamilyAction> = {
  // sleep
  alarm:      { bare: "snooze", past: "snoozed",  ing: "snoozing" },
  bed:        { bare: "leave",  past: "left",     ing: "leaving" },
  mattress:   { bare: "ignore", past: "ignored",  ing: "ignoring" },
  slippers:   { bare: "ignore", past: "ignored",  ing: "ignoring" },
  eyemask:    { bare: "ignore", past: "ignored",  ing: "ignoring" },
  lamp:       { bare: "ignore", past: "ignored",  ing: "ignoring" },
  // food
  fridge:     { bare: "raid",   past: "raided",   ing: "raiding" },
  fork:       { bare: "drop",   past: "dropped",  ing: "dropping" },
  groceries:  { bare: "ignore", past: "ignored",  ing: "ignoring" },
  oven:       { bare: "ignore", past: "ignored",  ing: "ignoring" },
  plate:      { bare: "push",   past: "pushed",   ing: "pushing" },
  pan:        { bare: "ignore", past: "ignored",  ing: "ignoring" },
  // money
  wallet:     { bare: "close",  past: "closed",   ing: "closing" },
  savings:    { bare: "raid",   past: "raided",   ing: "raiding" },
  venmo:      { bare: "dodge",  past: "dodged",   ing: "dodging" },
  atm:        { bare: "dodge",  past: "dodged",   ing: "dodging" },
  statement:  { bare: "ignore", past: "ignored",  ing: "ignoring" },
  coupon:     { bare: "ignore", past: "ignored",  ing: "ignoring" },
  // phone
  phone:      { bare: "ignore", past: "ignored",  ing: "ignoring" },
  lockscreen: { bare: "dodge",  past: "dodged",   ing: "dodging" },
  thumb:      { bare: "freeze", past: "froze",    ing: "freezing" },
  charger:    { bare: "ignore", past: "ignored",  ing: "ignoring" },
  earbuds:    { bare: "ignore", past: "ignored",  ing: "ignoring" },
  wallpaper:  { bare: "ignore", past: "ignored",  ing: "ignoring" },
  // work
  inbox:      { bare: "dodge",  past: "dodged",   ing: "dodging" },
  tasks:      { bare: "dodge",  past: "dodged",   ing: "dodging" },
  calendar:   { bare: "dodge",  past: "dodged",   ing: "dodging" },
  tab:        { bare: "close",  past: "closed",   ing: "closing" },
  doc:        { bare: "close",  past: "closed",   ing: "closing" },
  keyboard:   { bare: "ignore", past: "ignored",  ing: "ignoring" },
  // fitness
  gym:        { bare: "skip",   past: "skipped",  ing: "skipping" },
  yoga:       { bare: "skip",   past: "skipped",  ing: "skipping" },
  pushups:    { bare: "skip",   past: "skipped",  ing: "skipping" },
  shoes:      { bare: "ignore", past: "ignored",  ing: "ignoring" },
  dumbbell:   { bare: "ignore", past: "ignored",  ing: "ignoring" },
  bottle:     { bare: "ignore", past: "ignored",  ing: "ignoring" },
  // dating
  app:        { bare: "close",  past: "closed",   ing: "closing" },
  thread:     { bare: "mute",   past: "muted",    ing: "muting" },
  profile:    { bare: "close",  past: "closed",   ing: "closing" },
  swipe:      { bare: "pause",  past: "paused",   ing: "pausing" },
  bio:        { bare: "freeze", past: "froze",    ing: "freezing" },
  crush:      { bare: "dodge",  past: "dodged",   ing: "dodging" },
  // social
  groupchat:  { bare: "mute",   past: "muted",    ing: "muting" },
  invite:     { bare: "decline",past: "declined", ing: "declining" },
  rsvp:       { bare: "dodge",  past: "dodged",   ing: "dodging" },
  voicememo:  { bare: "ignore", past: "ignored",  ing: "ignoring" },
  table:      { bare: "leave",  past: "left",     ing: "leaving" },
  gift:       { bare: "regift", past: "regifted", ing: "regifting" },
  // home
  dishes:     { bare: "ignore", past: "ignored",  ing: "ignoring" },
  sink:       { bare: "ignore", past: "ignored",  ing: "ignoring" },
  junk:       { bare: "ignore", past: "ignored",  ing: "ignoring" },
  mail:       { bare: "ignore", past: "ignored",  ing: "ignoring" },
  vacuum:     { bare: "skip",   past: "skipped",  ing: "skipping" },
  couch:      { bare: "claim",  past: "claimed",  ing: "claiming" },
  // mornings
  coffee:     { bare: "abandon",past: "abandoned",ing: "abandoning" },
  mirror:     { bare: "dodge",  past: "dodged",   ing: "dodging" },
  kettle:     { bare: "ignore", past: "ignored",  ing: "ignoring" },
  toothbrush: { bare: "skip",   past: "skipped",  ing: "skipping" },
  towel:      { bare: "ignore", past: "ignored",  ing: "ignoring" },
  robe:       { bare: "ignore", past: "ignored",  ing: "ignoring" },
  // study
  notes:      { bare: "skim",   past: "skimmed",  ing: "skimming" },
  textbook:   { bare: "close",  past: "closed",   ing: "closing" },
  flashcards: { bare: "skip",   past: "skipped",  ing: "skipping" },
  syllabus:   { bare: "skim",   past: "skimmed",  ing: "skimming" },
  highlighter:{ bare: "ignore", past: "ignored",  ing: "ignoring" },
  pen:        { bare: "ignore", past: "ignored",  ing: "ignoring" },
  // content
  lens:       { bare: "dodge",  past: "dodged",   ing: "dodging" },
  draft:      { bare: "abandon",past: "abandoned",ing: "abandoning" },
  ringlight:  { bare: "ignore", past: "ignored",  ing: "ignoring" },
  tripod:     { bare: "ignore", past: "ignored",  ing: "ignoring" },
  selfie:     { bare: "retake", past: "retook",   ing: "retaking" },
  caption:    { bare: "delete", past: "deleted",  ing: "deleting" },
};

/** PHASE UX3.1 — Resolve the (bare, past, ing) tuple for a given
 *  family-action + anchor pair. Swaps the family verb to a fitting
 *  per-anchor verb when the family verb is stiffness-prone AND the
 *  (verb, anchor) pair is not in the explicit plausible whitelist.
 *
 *  Pure / deterministic. Returns the input `famAction` when no
 *  swap is warranted (non-stiff verb, or pair already plausible,
 *  or anchor missing from fallback table — fail open). */
export function resolveAnchorAwareAction(
  famAction: FamilyAction,
  anchor: string,
): FamilyAction {
  const verb = famAction.bare.toLowerCase();
  if (!STIFF_FAMILY_VERBS.has(verb)) return famAction;
  const anchorLc = anchor.toLowerCase();
  const plausible = VERB_ANCHOR_PLAUSIBLE[verb];
  if (plausible && plausible.has(anchorLc)) return famAction;
  const fallback = ANCHOR_VERB_FALLBACK[anchorLc];
  if (!fallback) return famAction;
  return fallback;
}

/** PHASE UX3.1 — exported for `validateScenarioCoherence` so the
 *  validator can also check (verb, anchor) plausibility on
 *  pattern-engine candidates that bypass the cohesive author. */
export function isVerbAnchorImplausible(
  verb: string,
  anchor: string,
): boolean {
  const v = verb.toLowerCase();
  if (!STIFF_FAMILY_VERBS.has(v)) return false;
  const a = anchor.toLowerCase();
  const plausible = VERB_ANCHOR_PLAUSIBLE[v];
  if (plausible && plausible.has(a)) return false;
  // If we have a fallback for this anchor, the original pair is
  // implausible. If we DON'T have a fallback, fail open (don't
  // claim implausibility we can't repair).
  return ANCHOR_VERB_FALLBACK[a] !== undefined;
}

// ---------------------------------------------------------------- //
// PHASE UX3.1 — Semantic anchor groups (compatibility clusters)     //
// ---------------------------------------------------------------- //
//
// Per the UX3.1 directive, the hook–scenario binding guard does NOT
// require exact noun equality. Instead it enforces "same compatibility
// cluster". Each cluster lists nouns (single tokens, lemma form) that
// can be substituted for each other without breaking the scene.
//
// A noun may appear in MULTIPLE clusters (e.g. "groupchat" is both a
// social-thread surface AND a calendar-coordination surface). The
// validator passes when hook-cluster ∩ show-cluster is non-empty.
//
// The `null` cluster is implicit — if the hook contains zero
// cluster-keyed nouns, we treat it as "abstract / big-premise" and
// the noun-bind guard does not fire (we still need the existing
// hook-anchor token-overlap rule from UX3 to pass).

export const ANCHOR_CLUSTERS: ReadonlyArray<ReadonlySet<string>> = [
  // calendar / scheduling
  new Set(["calendar","schedule","plan","appointment","groupchat","invite","rsvp","tasks","inbox","doc","meeting"]),
  // food / fridge / kitchen
  new Set(["fridge","food","leftovers","groceries","takeout","snack","fork","plate","pan","oven","kettle","coffee","kitchen","dishes","sink"]),
  // messaging / threads
  new Set(["thread","message","text","groupchat","reply","unread","dm","voicememo","inbox","app"]),
  // social profile / story
  new Set(["profile","story","account","page","view","bio","app","selfie","caption","crush"]),
  // sleep / alarm
  new Set(["alarm","snooze","phone","bed","blanket","mattress","slippers","eyemask","lamp","robe","towel","mirror"]),
  // shopping / cart
  new Set(["cart","shopping","order","checkout","package","wallet","venmo","atm","statement","coupon","savings"]),
  // mirror / bathroom / reflection
  new Set(["mirror","reflection","bathroom","lighting","face","toothbrush","towel","robe"]),
  // browser / tabs / fake productivity
  new Set(["tab","browser","laptop","work","keyboard","doc","tasks","inbox","calendar"]),
  // fitness / movement
  new Set(["gym","yoga","pushups","shoes","dumbbell","bottle","fitness","workout"]),
  // study
  new Set(["notes","textbook","flashcards","syllabus","highlighter","pen","study"]),
  // content / creator
  new Set(["lens","draft","ringlight","tripod","selfie","caption","content","camera"]),
];

/** Returns the indexes of clusters that contain the given lowercased
 *  noun. Empty array means the noun is not in any cluster (treated
 *  as cluster-neutral). */
export function clustersContaining(noun: string): number[] {
  const n = noun.toLowerCase();
  const out: number[] = [];
  for (let i = 0; i < ANCHOR_CLUSTERS.length; i++) {
    if (ANCHOR_CLUSTERS[i]!.has(n)) out.push(i);
  }
  return out;
}
