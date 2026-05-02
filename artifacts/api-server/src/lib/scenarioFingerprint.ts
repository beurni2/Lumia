/**
 * PHASE Y6 — SCENARIO FINGERPRINT
 *
 * Pure / deterministic helper that collapses a candidate's
 * (mechanism, anchor, action) triple into a stable 12-hex-char
 * fingerprint string prefixed `sf_`. Used by Y8's semantic dedup
 * to catch "same idea wearing a new wrapper" — different surface
 * wording but the same comedic skeleton.
 *
 * Process:
 *   1. lowercase + strip non-word chars from each input field
 *   2. lemmatize each token (suffix-strip table for verbs / nouns)
 *   3. canonicalize via SYNONYM_MAP (list/checklist/tasks → "list",
 *      phone/screen/feed → "phone", gym/workout/fitness → "gym")
 *   4. dedupe + sort tokens (commutative on input field order)
 *   5. djb2 the joined string twice with two seeds, concat hex →
 *      12 chars, prefix `sf_`
 *
 * Stability properties:
 *   - identical (mechanism, anchor, action) sets → identical fp
 *   - synonym substitution does not change the fp
 *   - reordered inputs do not change the fp (sort step)
 *
 * NO external deps. NO mutable state. Same discipline as the
 * djb2 helper inside `coreCandidateGenerator.ts` (same algorithm,
 * different output width).
 */

import type { Idea } from "./ideaGen.js";

// ---------------------------------------------------------------- //
// djb2 32-bit hash                                                  //
// ---------------------------------------------------------------- //

function djb2(s: string): number {
  let h = 5381 | 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

// ---------------------------------------------------------------- //
// Synonym + lemma tables                                            //
// ---------------------------------------------------------------- //

/** Anchor / scenario synonym normalizer. Keys MUST be lowercased
 *  bare tokens (post lemma + punctuation strip). The catalog is
 *  intentionally narrow — it collapses the most common "same idea
 *  new noun" pairs (list/tasks/checklist; phone/screen/feed;
 *  gym/workout) without trying to be a full thesaurus. */
const SYNONYM_MAP: Record<string, string> = {
  // list-y nouns
  list: "list",
  lists: "list",
  checklist: "list",
  task: "list",
  tasks: "list",
  todo: "list",
  todos: "list",
  // phone-y nouns
  phone: "phone",
  screen: "phone",
  feed: "phone",
  scroll: "phone",
  app: "phone",
  apps: "phone",
  notification: "phone",
  notifications: "phone",
  // gym-y nouns
  gym: "gym",
  workout: "gym",
  workouts: "gym",
  fitness: "gym",
  treadmill: "gym",
  // food-y nouns
  fridge: "fridge",
  snack: "fridge",
  snacks: "fridge",
  leftover: "fridge",
  leftovers: "fridge",
  meal: "fridge",
  meals: "fridge",
  // money-y nouns
  card: "money",
  bank: "money",
  cart: "money",
  subscription: "money",
  subscriptions: "money",
  receipt: "money",
  // sleep-y nouns
  alarm: "alarm",
  snooze: "alarm",
  blanket: "alarm",
  pillow: "alarm",
  // home-y nouns
  dish: "dishes",
  dishes: "dishes",
  laundry: "dishes",
  // social-y nouns
  groupchat: "groupchat",
  chat: "groupchat",
  text: "groupchat",
  thread: "groupchat",
  dm: "groupchat",
  // dating-y nouns
  match: "match",
  profile: "match",
  // morning-y nouns
  coffee: "coffee",
  shower: "coffee",
  routine: "coffee",
};

/** Suffix-strip lemmatizer. Operates AFTER lowercasing/punctuation
 *  strip and BEFORE the synonym map. Order matters — try longer
 *  suffixes first. */
function lemmatize(tok: string): string {
  if (tok.length <= 3) return tok;
  // -ing → drop (running → runn → run? leave as-is, just drop -ing)
  if (tok.endsWith("ing") && tok.length > 5) return tok.slice(0, -3);
  // -ied → -y (tried → try)
  if (tok.endsWith("ied") && tok.length > 4) return tok.slice(0, -3) + "y";
  // -ed → drop (ghosted → ghost)
  if (tok.endsWith("ed") && tok.length > 4) return tok.slice(0, -2);
  // -es / -s → drop when noun-like (notifications → notification → after
  // the next pass through SYNONYM_MAP this maps to "phone")
  if (tok.endsWith("es") && tok.length > 4) return tok.slice(0, -2);
  if (tok.endsWith("s") && tok.length > 3 && !tok.endsWith("ss")) {
    return tok.slice(0, -1);
  }
  return tok;
}

function canonicalize(tok: string): string {
  const lemma = lemmatize(tok);
  return SYNONYM_MAP[lemma] ?? lemma;
}

/** PHASE Y7 — exported wrapper around the internal `canonicalize`
 *  pipeline (lowercase → lemma-strip → SYNONYM_MAP collapse).
 *  Used by `coreDomainAnchorCatalog`'s boot-time distinctness
 *  assert so the catalog and the fingerprinter share ONE
 *  canonicalization rule (no drift between what the assert checks
 *  and what the dedup actually produces). */
export function canonicalizeToken(tok: string): string {
  return canonicalize(tok.toLowerCase());
}

// ---------------------------------------------------------------- //
// Tokenization                                                      //
// ---------------------------------------------------------------- //

const TOKEN_RE = /[a-z][a-z0-9']{1,}/g;

function tokensFrom(s: string): string[] {
  if (!s) return [];
  const lowered = s.toLowerCase();
  const matches = lowered.match(TOKEN_RE);
  if (!matches) return [];
  const out: string[] = [];
  for (const m of matches) out.push(canonicalize(m));
  return out;
}

// ---------------------------------------------------------------- //
// Public API                                                        //
// ---------------------------------------------------------------- //

export type FingerprintInput = {
  mechanism: string;
  anchor: string;
  action: string;
};

/** Compute the scenario fingerprint for a (mechanism, anchor,
 *  action) triple. Stable across token-order permutations of the
 *  same scenario and across synonym substitution. Always 12 hex
 *  chars prefixed `sf_`. */
export function computeScenarioFingerprint(input: FingerprintInput): string {
  const allTokens = [
    ...tokensFrom(input.mechanism),
    ...tokensFrom(input.anchor),
    ...tokensFrom(input.action),
  ];
  // Dedupe + sort — fingerprint is commutative on token order.
  const unique = Array.from(new Set(allTokens)).sort();
  const joined = unique.join(" ");
  const h1 = djb2(`sf|a|${joined}`).toString(16).padStart(8, "0");
  const h2 = djb2(`sf|b|${joined}`).toString(16).padStart(8, "0").slice(0, 4);
  return `sf_${h1}${h2}`;
}

/** Probe an idea's `whatToShow` (and `hook` as fallback) for an
 *  anchor + action pair using the catalog's known anchor list as a
 *  match probe. Returns the longest matching anchor + the first
 *  matching action verb (bare or inflected). When nothing matches,
 *  returns empty strings — caller can decide whether to skip
 *  fingerprint computation or fall back to whole-text hashing. */
export function extractAnchorAndAction(
  idea: Idea,
  knownAnchors: ReadonlySet<string>,
  knownActions: ReadonlySet<string>,
): { anchor: string; action: string } {
  const haystack = `${idea.whatToShow}\n${idea.hook}`.toLowerCase();
  let bestAnchor = "";
  for (const cand of knownAnchors) {
    if (cand.length <= bestAnchor.length) continue;
    // word-boundary-ish probe (avoid "tab" matching "tablet")
    const re = new RegExp(`\\b${cand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (re.test(haystack)) bestAnchor = cand;
  }
  let action = "";
  for (const verb of knownActions) {
    const re = new RegExp(
      `\\b${verb.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:e?d|ing|s)?\\b`,
    );
    if (re.test(haystack)) {
      action = verb;
      break;
    }
  }
  return { anchor: bestAnchor, action };
}
