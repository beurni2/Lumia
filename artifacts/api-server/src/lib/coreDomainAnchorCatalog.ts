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
 *   - total (core, domain, anchor) triples ≥ 800
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
const CANONICAL_DOMAIN_ANCHORS: Record<CanonicalDomain, readonly string[]> = {
  // sleep: was alarm/blanket/pillow/snooze/lamp → 2 canonical
  // (alarm, lamp). Replaced 3 alarm-collapsing anchors with
  // visually-distinct sleep-adjacent props.
  sleep: ["alarm", "lamp", "mattress", "slippers", "eyemask"],
  // food: was fridge/snack/leftovers/fork/groceries → 3 canonical
  // (fridge, fork, groceries — snack/leftovers both → fridge).
  // Swap snack+leftovers for oven+plate (camera-distinct).
  food: ["fridge", "fork", "groceries", "oven", "plate"],
  // money: was card/savings/cart/subscription/receipt → 2 canonical
  // (money, savings — 4 of 5 collapse). Rebuilt around money-
  // adjacent objects/services that don't share the SYNONYM_MAP
  // money key.
  money: ["wallet", "savings", "venmo", "atm", "statement"],
  // phone: was screen/feed/notification/lockscreen/thumb → 3
  // canonical (phone, lockscreen, thumb). Swap 3 phone-collapsing
  // anchors for camera-distinct phone-adjacent props.
  phone: ["phone", "lockscreen", "thumb", "charger", "earbuds"],
  // work: passes already (inbox/tasks/calendar/tab/doc → tasks
  // collapses to `list` via SYNONYM_MAP; rest distinct = 5).
  work: ["inbox", "tasks", "calendar", "tab", "doc"],
  // fitness: was gym/treadmill/yoga/pushups/shoes → 4 canonical
  // (gym, yoga, pushup, shoe — treadmill collapses to gym). Swap
  // treadmill for dumbbell.
  fitness: ["gym", "yoga", "pushups", "shoes", "dumbbell"],
  // dating: was app/thread/profile/match/convo → 4 canonical
  // (phone, groupchat, match, convo — `profile` collapses to
  // `match` via SYNONYM_MAP). Swap profile for swipe + drop
  // convo for bio (more visually distinct).
  dating: ["app", "thread", "profile", "swipe", "bio"],
  // social: passes (groupchat/invite/rsvp/voicememo/table = 5
  // distinct).
  social: ["groupchat", "invite", "rsvp", "voicememo", "table"],
  // home: was dishes/laundry/junk/mail/vacuum → 4 canonical
  // (dishes, junk, mail, vacuum — laundry collapses to dishes).
  // Swap laundry for sink.
  home: ["dishes", "sink", "junk", "mail", "vacuum"],
  // mornings: was coffee/shower/mirror/routine/kettle → 3
  // canonical (coffee, mirror, kettle — shower+routine both →
  // coffee). Swap shower+routine for toothbrush+towel.
  mornings: ["coffee", "mirror", "kettle", "toothbrush", "towel"],
  // study: passes (notes/textbook/flashcards/syllabus/highlighter
  // = 5 distinct after lemmatization).
  study: ["notes", "textbook", "flashcards", "syllabus", "highlighter"],
  // content: passes (lens/draft/ringlight/tripod/selfie = 5
  // distinct).
  content: ["lens", "draft", "ringlight", "tripod", "selfie"],
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
  if (totalTriples < 800) {
    throw new Error(
      `[coreDomainAnchorCatalog] only ${totalTriples} (core, domain, anchor) triples (require ≥800)`,
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
