/**
 * PHASE Y8 — HOOK QUALITY SCORING
 *
 * Pure / deterministic scorer that grades a `core_native` hook string
 * on a 0-100 punch scale. Used by `coreCandidateGenerator`'s recipe
 * loop AFTER Y8: the iterator now COLLECTS up to `RECIPES_PER_CORE_CAP`
 * passing candidates per core (Y6 / Y7 shipped the FIRST passing one)
 * and ships the highest-scoring one. Without this layer, the new
 * scenario-fingerprint dedup gate would silently degrade hook quality
 * by funnelling the iterator toward bland synonym swaps:
 *
 *   "i ghosted my own to-do list"   ← original (sf_X)
 *   "i abandoned my checklist"      ← lazy escape (also sf_X under
 *                                     the synonym map → still rejected)
 *   "i did the list thing again"    ← passes dedup (different fp)
 *                                     but loses every interesting beat
 *
 * The scorer composes 5 components, max points in parens:
 *
 *   - visceralVerbScore  (30) — verb table by tier:
 *       HIGH (30):  ghost, lie, negotiate, fake, betray, ditch,
 *                   weaponize, gaslight, sabotage, expose, lecture,
 *                   judge, mock, divorce, dump, sue, spiral, kill,
 *                   ate, devour, demolish, flatline
 *       MID  (18):  abandon, avoid, perform, overthink, hide, refuse,
 *                   escape, stall, snooze, beat, ruin, conquer, win,
 *                   break, hit, reveal, expire, end, lose
 *       LOW   (8):  leave, miss, forget, skip, stop, look, watch,
 *                   notice, check, open, close, walk
 *       BLAND (0):  did, got, had, made, took, was, were, is, are,
 *                   become, came, gone, go, will, would
 *       UNKNOWN (default 5)
 *   - anthropomorphScore (25) — explicit (25) markers:
 *       "my own X", "X itself", "X themselves", "myself", "ourselves",
 *       "back at me", "to me", "at me", "X and i", "i and X"
 *     Implicit (12) — inanimate-subject + animate-verb pattern:
 *       "the {anchor-or-noun} (won|beat|killed|ruined|ate|broke|hit|
 *        reveal|revealed|spoke|texted|called|decided|voted|watched|
 *        laughed|cried|left|started|stopped|happened|came|returned)"
 *   - brevityScore       (20) — token count → score:
 *       5,6,7  → 20    (the punch sweet spot)
 *       4,8    → 17
 *       3,9    → 13
 *       2,10   → 9
 *       1,11+  → 5
 *   - concretenessScore  (15) — concrete-noun presence:
 *       2+ concrete nouns from the curated list → 15
 *       1 concrete noun                          → 10
 *       0 concrete nouns                         →  0
 *   - contradictionScore (10) — beat marker present:
 *       arrow `→` / em-dash `—` / mid-sentence `.` / ` but ` /
 *       ` and ` mid-clause / `again` / `anymore` / `instead` /
 *       `still` / numeric `\d+` (e.g. "47 posts later") → 10, else 0
 *
 * Total range: 0-100. Boot assertion in `voiceClusters.ts` verifies
 * every hook template scores ≥40 against a baseline filled-in example
 * using the family's curated FAMILY_ACTIONS verb + a representative
 * concrete anchor — catches catalog drift before a degraded template
 * ships to a creator.
 *
 * NO external deps. NO mutable state. Pure function. Same discipline
 * as `scenarioFingerprint.ts` and `voiceClusters.ts`.
 */

import type { PremiseCoreFamily } from "./premiseCoreLibrary.js";
import {
  computeHumanLift,
  isHumanLiftEnabled,
  ZERO_HUMAN_LIFT,
  type HumanLiftBreakdown,
} from "./hookQualityHumanLift.js";

// ---------------------------------------------------------------- //
// Verb tiers                                                        //
//                                                                   //
// Stems are stored in the table; the lookup function below probes   //
// each tier's set against any morphological form (bare / past /     //
// progressive / 3sg) by stripping common suffixes before comparison.//
// Inflection-aware so "ghosted" / "ghosting" / "ghosts" all hit the //
// HIGH tier without listing every form individually.                //
// ---------------------------------------------------------------- //

const VERB_HIGH: ReadonlySet<string> = new Set([
  "ghost",
  "lie",
  "negotiate",
  "fake",
  "betray",
  "ditch",
  "weaponize",
  "gaslight",
  "sabotage",
  "expose",
  "lecture",
  "judge",
  "mock",
  "divorce",
  "dump",
  "sue",
  "spiral",
  "kill",
  "devour",
  "demolish",
  "flatline",
  "haunt",
  "stalk",
  "interrogate",
  "ambush",
  "hijack",
  "seduce",
  "guilt",
  "bribe",
  "blackmail",
]);

const VERB_MID: ReadonlySet<string> = new Set([
  "abandon",
  "avoid",
  "perform",
  "overthink",
  "hide",
  "refuse",
  "escape",
  "stall",
  "snooze",
  "beat",
  "ruin",
  "conquer",
  "win",
  "break",
  "broke",
  "hit",
  "reveal",
  "expire",
  "end",
  "lose",
  "ate",
  "eat",
  "doomscroll",
  "scroll",
  "panic",
  "freeze",
  "hostage",
  "drown",
  "vanish",
  "collapse",
  "doom",
  "burn",
  "sink",
  "implode",
  "explode",
  "shatter",
  "crack",
  "drain",
  "rot",
]);

const VERB_LOW: ReadonlySet<string> = new Set([
  "leave",
  "miss",
  "forget",
  "skip",
  "stop",
  "look",
  "watch",
  "notice",
  "check",
  "open",
  "close",
  "walk",
  "pretend",
  "wait",
  "try",
  "say",
  "happen",
  "show",
  "talk",
  "speak",
  "whisper",
  "decide",
  "vote",
  "start",
  "return",
  "come",
  // PATCH D — N1 ng_clean calibration (BI 2026-05-10). LOW-tier
  // additions for observational comedy verbs and irregular past
  // forms that did not stem to existing entries. Recognition only —
  // LOW tier (8 pts) avoids over-promotion. See
  // .local/N1_FOLLOWUP_NG_CLEAN_HQS_CALIBRATION_PATCH_D_REPORT.md.
  "ask",
  "came",
  "chose",
  "ended",
  "said",
  "saw",
  "forgot",
  "loaded",
  "slowed",
  "dimmed",
  "priced",
  "assigned",
  "interrupted",
  "embarrassed",
  "humbled",
  "delayed",
  "declined",
  "renewed",
  "multiplied",
  "bargain",
  "bargained",
]);

const VERB_BLAND: ReadonlySet<string> = new Set([
  "did",
  "do",
  "does",
  "doing",
  "done",
  "got",
  "get",
  "gets",
  "getting",
  "gotten",
  "had",
  "have",
  "has",
  "having",
  "made",
  "make",
  "makes",
  "making",
  "took",
  "take",
  "takes",
  "taking",
  "taken",
  "was",
  "were",
  "is",
  "are",
  "be",
  "been",
  "being",
  "am",
  "become",
  "becomes",
  "becoming",
  "became",
  "go",
  "went",
  "goes",
  "gone",
  "going",
  "will",
  "would",
  "could",
  "should",
  "might",
  "may",
  "use",
  "used",
  "uses",
  "using",
  "put",
  "puts",
  "putting",
]);

/** Strip the most common English verb suffixes to recover a stem
 *  that probes the tier sets cleanly. `ghosted` → `ghost`, `ghosting`
 *  → `ghost`, `negotiated` → `negotiate`, `tried` → `try`. Order
 *  matters — try longer suffixes first. Mirrors the same shape as
 *  `scenarioFingerprint.ts`'s `lemmatize` but biased toward verb
 *  forms (no `-es` noun-plural collapse). Returns the input unchanged
 *  for short tokens or anything without a recognized suffix — the
 *  tier sets store both bare AND irregular forms (e.g. `ate`, `broke`,
 *  `won`) so unrecognized morphology still hits the right tier. */
function stemVerb(tok: string): string {
  if (tok.length <= 3) return tok;
  if (tok.endsWith("ied") && tok.length > 4) return tok.slice(0, -3) + "y";
  if (tok.endsWith("ing") && tok.length > 5) {
    const stem = tok.slice(0, -3);
    // Restore dropped trailing `e` (negotiating → negotiate).
    if (VERB_HIGH.has(stem + "e") || VERB_MID.has(stem + "e")) {
      return stem + "e";
    }
    return stem;
  }
  if (tok.endsWith("ed") && tok.length > 4) {
    const stem = tok.slice(0, -2);
    if (VERB_HIGH.has(stem) || VERB_MID.has(stem) || VERB_LOW.has(stem)) {
      return stem;
    }
    // Restore dropped trailing `e` (negotiated → negotiate, faked → fake).
    if (VERB_HIGH.has(stem + "e") || VERB_MID.has(stem + "e")) {
      return stem + "e";
    }
    // Doubled-consonant drop (ditched → ditch handled by no-double; but
    // e.g. `stopped` → `stopp` → `stop`).
    if (
      stem.length > 2 &&
      stem[stem.length - 1] === stem[stem.length - 2] &&
      VERB_LOW.has(stem.slice(0, -1))
    ) {
      return stem.slice(0, -1);
    }
    return stem;
  }
  if (tok.endsWith("s") && tok.length > 3 && !tok.endsWith("ss")) {
    return tok.slice(0, -1);
  }
  return tok;
}

function classifyVerb(tok: string): "high" | "mid" | "low" | "bland" | "none" {
  const lower = tok.toLowerCase();
  if (VERB_BLAND.has(lower)) return "bland";
  const stem = stemVerb(lower);
  if (VERB_HIGH.has(stem) || VERB_HIGH.has(lower)) return "high";
  if (VERB_MID.has(stem) || VERB_MID.has(lower)) return "mid";
  if (VERB_LOW.has(stem) || VERB_LOW.has(lower)) return "low";
  return "none";
}

/** P16-A1 — canonical verb-tier exposure. Returns `{score, tier}` so
 *  human-lift logic in `hookQualityHumanLift.ts` can read the
 *  authoritative tier without a parallel quiet-verb set. The wrapper
 *  `visceralVerbScore` returns the same `score` value as before — no
 *  caller behavior changes. Tier is "NONE" / "BLAND" / "LOW" / "MID" /
 *  "HIGH"; cased for human readability. */
export type VisceralVerbTier = "NONE" | "BLAND" | "LOW" | "MID" | "HIGH";

export function visceralVerbScoreDetailed(
  hookLower: string,
): { score: number; tier: VisceralVerbTier } {
  const tokens = hookLower.match(/[a-z]+/g) ?? [];
  let best: "high" | "mid" | "low" | "bland" | "none" = "none";
  const rank = { none: 0, bland: 1, low: 2, mid: 3, high: 4 } as const;
  for (const t of tokens) {
    const c = classifyVerb(t);
    if (rank[c] > rank[best]) best = c;
    if (best === "high") break;
  }
  switch (best) {
    case "high":
      return { score: 30, tier: "HIGH" };
    case "mid":
      return { score: 18, tier: "MID" };
    case "low":
      return { score: 8, tier: "LOW" };
    case "bland":
      return { score: 5, tier: "BLAND" };
    case "none":
      return { score: 5, tier: "NONE" };
  }
}

function visceralVerbScore(hookLower: string): number {
  return visceralVerbScoreDetailed(hookLower).score;
}

// ---------------------------------------------------------------- //
// Anthropomorphization                                              //
// ---------------------------------------------------------------- //

/** Explicit anthropomorph markers — the inanimate object is being
 *  treated as a person with relational standing ("my own list",
 *  "the list itself", "the list and i"). Worth the full 25. */
const EXPLICIT_ANTHROPOMORPH = [
  /\bmy own\b/,
  /\bitself\b/,
  /\bthemselves\b/,
  /\bmyself\b/,
  /\bourselves\b/,
  /\bback at me\b/,
  /\bto me\b/,
  /\bat me\b/,
  /\bme back\b/,
  /\b(?:the|my)\s+\w+(?:[-\s]\w+)?\s+and i\b/,
  /\bi and (?:the|my)\b/,
];

/** Implicit anthropomorph — inanimate noun is the subject of an
 *  animate-coded verb ("the phone won", "the to-do list ate me",
 *  "the list ghosted me first"). Worth a partial 12 since the
 *  marker is structural, not lexical. Y8 expands the past-tense
 *  verb set with the family-action verbs (ghosted / abandoned /
 *  faked / etc.) so curated voice templates that use the family
 *  verb in the X-as-actor pattern register as anthropomorph. */
// PATCH D — N1 ng_clean calibration (BI 2026-05-10). The trailing
// 20 verbs (judged..froze) extend the implicit-anthropomorph
// recognition list with object-betrayal verbs that surfaced from
// the ng_clean corpus audit. The structural pattern remains
// identical (`the <noun-phrase> <verb>`) — only the verb-list
// alternation widens. See
// .local/N1_FOLLOWUP_NG_CLEAN_HQS_CALIBRATION_PATCH_D_REPORT.md.
//
// IMPLICIT-ANTHROPOMORPH HQS FIX — N1 ng_clean (BI 2026-05-10). 10
// human-comedy verbs (smiled..arrived) added to the alternation to
// recognize object-as-agent verbs that surface in P3-HUMAN-FIRST
// candidate hooks. 9 required (smiled / printed / appointed / rang /
// made / opened / turned / sounded / corrected) + 1 optional
// (arrived) — gated by predict evidence: only verbs whose absence
// blocked a P3 candidate from clearing PICKER_HQS_FLOOR=50 are
// added. The structural `the <noun-phrase> <verb>` gate is
// unchanged; the floor is unchanged; the validators/selector are
// unchanged.
//
// HUMAN-SUBJECT FALSE-POSITIVE GUARD (BI 2026-05-10, post-architect).
// A negative lookahead immediately after `\bthe\s+` excludes hooks
// whose subject head-noun is an obvious human noun (person, people,
// creator, man, woman, …). This is a strict TIGHTENING of the gate:
// it can only REMOVE the +12 bonus, never add it. Confirmed on the
// shipped clean-core corpus the only affected entry was
// `ng_clean_011` (`The uncle who came late …`), whose total was
// already 39 (under floor) before and after the tightening — so no
// picker behavior changes. See
// .local/N1_FOLLOWUP_NG_CLEAN_IMPLICIT_ANTHROPOMORPH_HQS_FIX_REPORT.md.
// P16-A1 — exported (read-only) so the UA lift in
// hookQualityHumanLift.ts can re-inspect the matched span and skip
// over-captured matches without duplicating the long verb alternation.
export const IMPLICIT_ANTHROPOMORPH_RX_FOR_INSPECTION: RegExp =
  /\bthe\s+(?!(?:person|people|creator|man|woman|boy|girl|kid|child|baby|son|daughter|brother|sister|mother|father|mom|dad|auntie|aunt|uncle|supervisor|boss|manager|teacher|friend|neighbor|stranger|guy|lady|driver|cousin|husband|wife|doctor|nurse|customer|client|partner)\b)[a-z][a-z\-\s]{1,30}?\s+(?:won|beat|killed|ruined|ate|broke|hit|revealed|spoke|texted|called|decided|voted|watched|laughed|cried|left|started|stopped|happened|came|returned|whispered|told|asked|answered|lied|caught|scared|haunted|stalked|kept|chose|knew|saw|wanted|needed|loved|hated|ghosted|abandoned|faked|betrayed|ditched|performed|exposed|spiraled|avoided|overthought|drained|demolished|sabotaged|gaslit|seduced|hijacked|judged|mocked|refused|slowed|dimmed|loaded|declined|multiplied|vanished|expired|ended|embarrassed|humbled|delayed|interrupted|assigned|priced|forgot|said|froze|smiled|printed|appointed|rang|made|opened|turned|sounded|corrected|arrived)\b/;
const IMPLICIT_ANTHROPOMORPH =
  /\bthe\s+(?!(?:person|people|creator|man|woman|boy|girl|kid|child|baby|son|daughter|brother|sister|mother|father|mom|dad|auntie|aunt|uncle|supervisor|boss|manager|teacher|friend|neighbor|stranger|guy|lady|driver|cousin|husband|wife|doctor|nurse|customer|client|partner)\b)[a-z][a-z\-\s]{1,30}?\s+(?:won|beat|killed|ruined|ate|broke|hit|revealed|spoke|texted|called|decided|voted|watched|laughed|cried|left|started|stopped|happened|came|returned|whispered|told|asked|answered|lied|caught|scared|haunted|stalked|kept|chose|knew|saw|wanted|needed|loved|hated|ghosted|abandoned|faked|betrayed|ditched|performed|exposed|spiraled|avoided|overthought|drained|demolished|sabotaged|gaslit|seduced|hijacked|judged|mocked|refused|slowed|dimmed|loaded|declined|multiplied|vanished|expired|ended|embarrassed|humbled|delayed|interrupted|assigned|priced|forgot|said|froze|smiled|printed|appointed|rang|made|opened|turned|sounded|corrected|arrived)\b/;

/** P16-A1 — branch metadata exposure for human-lift scorer. The
 *  `branch` field tells downstream code WHICH path produced the
 *  score: `"explicit"` (raw 25), `"implicit"` (raw 12), or `"none"`
 *  (0). The Y8 gaming guard in `scoreHookQualityDetailed` may cap
 *  an explicit raw 25 down to 12 when no other signal is present —
 *  that capping does NOT change `branch`; an explicit-but-capped
 *  hook still reports `branch === "explicit"`. The understated-
 *  absurdity lift only fires for `branch === "implicit"` so an
 *  explicit-then-capped hook is correctly ineligible. */
export type AnthropomorphBranch = "none" | "explicit" | "implicit";

export function anthropomorphScoreDetailed(
  hookLower: string,
): { score: number; branch: AnthropomorphBranch } {
  for (const re of EXPLICIT_ANTHROPOMORPH) {
    if (re.test(hookLower)) return { score: 25, branch: "explicit" };
  }
  if (IMPLICIT_ANTHROPOMORPH.test(hookLower)) {
    return { score: 12, branch: "implicit" };
  }
  return { score: 0, branch: "none" };
}

function anthropomorphScore(hookLower: string): number {
  return anthropomorphScoreDetailed(hookLower).score;
}

// ---------------------------------------------------------------- //
// Brevity                                                           //
// ---------------------------------------------------------------- //

/** P16-A1 — exported so `hookQualityHumanLift.ts` can compute the
 *  monotone widened brevity (`max(widened, original)`) without a
 *  parallel curve. Behavior unchanged. */
export function brevityScoreOriginal(hookLower: string): number {
  const words = hookLower.trim().split(/\s+/).filter(Boolean).length;
  if (words >= 5 && words <= 7) return 20;
  if (words === 4 || words === 8) return 17;
  if (words === 3 || words === 9) return 13;
  if (words === 2 || words === 10) return 9;
  return 5;
}

function brevityScore(hookLower: string): number {
  return brevityScoreOriginal(hookLower);
}

/** Word count helper — exported alongside `brevityScoreOriginal` so the
 *  human-lift widening helper uses the SAME tokenization. */
export function brevityWordCount(hookLower: string): number {
  return hookLower.trim().split(/\s+/).filter(Boolean).length;
}

// ---------------------------------------------------------------- //
// Concreteness                                                      //
//                                                                   //
// Curated list of concrete-anchor nouns drawn from the catalog +    //
// the fingerprint synonym map. Catches both catalog vocabulary      //
// (list, phone, gym, fridge, dishes, etc) AND common scene-object   //
// nouns the cohesive author may interpolate into a template.        //
// ---------------------------------------------------------------- //

const CONCRETE_NOUNS: ReadonlySet<string> = new Set([
  "list",
  "lists",
  "checklist",
  "task",
  "tasks",
  "todo",
  "to-do",
  "phone",
  "screen",
  "feed",
  "scroll",
  "app",
  "apps",
  "notification",
  "notifications",
  "gym",
  "workout",
  "workouts",
  "fitness",
  "treadmill",
  "fridge",
  "snack",
  "snacks",
  "leftover",
  "leftovers",
  "meal",
  "meals",
  "card",
  "bank",
  "cart",
  "subscription",
  "subscriptions",
  "receipt",
  "alarm",
  "snooze",
  "blanket",
  "pillow",
  "dish",
  "dishes",
  "laundry",
  "groupchat",
  "chat",
  "text",
  "thread",
  "dm",
  "match",
  "profile",
  "coffee",
  "shower",
  "routine",
  "bed",
  "kitchen",
  "mirror",
  "email",
  "slack",
  "inbox",
  "calendar",
  "post",
  "story",
  "reel",
  "video",
  "draft",
  "tab",
  "tabs",
  "cart",
  "wallet",
  "key",
  "keys",
  "wallet",
  "schedule",
  "plan",
  "playlist",
  "doorknob",
  "couch",
  "rug",
  "fridge",
  "drawer",
  "closet",
  "fork",
  "spoon",
  "bowl",
  "mug",
  // PATCH D — N1 ng_clean calibration (BI 2026-05-10). Concrete
  // everyday-anchor nouns observed as ng_clean entry anchors that
  // currently miss the catalog. All concrete physical objects /
  // operational anchors — no abstract emotional states. See
  // .local/N1_FOLLOWUP_NG_CLEAN_HQS_CALIBRATION_PATCH_D_REPORT.md.
  "charger",
  "printer",
  "traffic",
  "rice",
  "plate",
  "tailor",
  "generator",
  "socket",
  "doorbell",
  "password",
  "transfer",
  "data",
  "network",
  "bucket",
  "fan",
  "sticker",
  "tank",
  "ringlight",
  "onion",
  "light",
  "pothole",
  "cable",
  "fuel",
  "change",
  "form",
  "errand",
  "balance",
  "battery",
]);

function concretenessScore(hookLower: string): number {
  const tokens = hookLower.match(/[a-z][a-z\-]{1,}/g) ?? [];
  let count = 0;
  // Walk tokens and 2-token windows (catches "to-do list", "group chat").
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === undefined) continue;
    if (CONCRETE_NOUNS.has(t)) {
      count++;
      continue;
    }
    if (i + 1 < tokens.length) {
      const next = tokens[i + 1];
      if (next === undefined) continue;
      const bi = `${t}-${next}`;
      if (CONCRETE_NOUNS.has(bi)) {
        count++;
        i++;
      }
    }
  }
  if (count >= 2) return 15;
  if (count === 1) return 10;
  return 0;
}

// ---------------------------------------------------------------- //
// Contradiction beat                                                //
// ---------------------------------------------------------------- //

const CONTRADICTION_PATTERNS: readonly RegExp[] = [
  /→/,
  /—/,
  /\bbut\b/,
  /\binstead\b/,
  /\banymore\b/,
  /\bagain\b/,
  /\bstill\b/,
  /\d+/,
  /\.\s+[a-z]/, // mid-sentence period followed by a continuation
  /\.\s*$/, // hooks ending in a period after a clause carry a beat
];

/** Dramatic-stakes nouns — words that signal identity-level
 *  reframing of a small inconvenience, the defining move of the
 *  `overdramatic_reframe` voice cluster. Without this credit, that
 *  cluster's templates ("became my villain origin", "is a personal
 *  apocalypse now", "scientists could write papers about my X")
 *  read as bland to the verb-biased scorer because they carry their
 *  punch in the noun, not in the verb. Worth the same 10 as a
 *  contradiction-beat marker — both are signals of tension. */
const DRAMATIC_NOUNS: RegExp =
  /\b(?:villain|apocalypse|catastrophe|doom|hostage|conspirator|accomplice|sabotage|scandal|witness|evidence|scientist|scientists|papers|origin|breakdown|tragedy|casualty|breakup|demise|villainy|murder|crime|trial|verdict|funeral|autopsy|exorcism)\b/;

/** P16-A1 — source metadata exposure. The emotional-specificity lift
 *  caps at +3 (instead of +6) when the contradiction credit was
 *  already paid via the operatic DRAMATIC_NOUNS branch — preserves the
 *  understated > overstated bias the human-lift signals are designed
 *  to introduce. `source` is `"marker"` for the regex-pattern branch,
 *  `"dramatic"` for the dramatic-noun branch, `"none"` for no credit. */
export type ContradictionSource = "none" | "marker" | "dramatic";

export function contradictionScoreDetailed(
  hookLower: string,
): { score: number; source: ContradictionSource } {
  for (const re of CONTRADICTION_PATTERNS) {
    if (re.test(hookLower)) return { score: 10, source: "marker" };
  }
  if (DRAMATIC_NOUNS.test(hookLower)) return { score: 10, source: "dramatic" };
  return { score: 0, source: "none" };
}

function contradictionScore(hookLower: string): number {
  return contradictionScoreDetailed(hookLower).score;
}

// ---------------------------------------------------------------- //
// PHASE D1 — AI-cliché demote band                                  //
//                                                                   //
// Negative-only score component (range -15..0) that demotes hooks   //
// using the over-recycled AI-voice phrasings the post-Y11 user      //
// report flagged: "my body quit", "my brain hates me", "i specialize//
// in disappointing", "my brain filed for emotional bankruptcy",     //
// "is unwell", "totally fine about", "knows i'm lying" + close      //
// variants. NOT a hard reject — the cap of -15 keeps a hook with    //
// genuinely-strong other axes still shippable, but it stops the     //
// generic AI dialect from being the median pick. Frozen list; not   //
// per-creator (the AI's own dialect is the same dialect for every   //
// creator). Same discipline as the verb tier sets above.            //
// ---------------------------------------------------------------- //

// IMPORTANT: do NOT add user-blessed seed-exemplar shapes to this
// list. The user's voiceClusters seedHookExemplars include
// "i specialize in disappointing myself" — that shape is taste-
// approved and must NOT be demoted even though the AI overuses
// adjacent phrasings. The list below targets ONLY phrases observed
// in the post-Y11 trash report that are absent from the user's
// blessed seed corpus.
const AI_CLICHE_PATTERNS: readonly RegExp[] = [
  /\bmy body quit\b/,
  /\bmy brain (?:hates?|filed|kept screaming)/,
  /\bis unwell\b/,
  /\bemotional bankruptcy\b/,
  /\bfiled for (?:emotional|divorce|bankruptcy)/,
  /\b(?:totally|completely) fine (?:about|with)\b/,
  /\bknows i'?m lying\b/,
  /\bruined my villain (?:arc|origin)/,
  /\bvillain (?:arc|origin) (?:ruined|cancelled|over)/,
  /\bmy own personal (?:hell|apocalypse|villain)/,
  /\bsomeone please (?:help|stop|tell)/,
  /\bnot a phase mom\b/,
];

function aiClicheScore(hookLower: string): number {
  let demerits = 0;
  for (const re of AI_CLICHE_PATTERNS) {
    if (re.test(hookLower)) {
      demerits += 8;
      if (demerits >= 15) return -15;
    }
  }
  return -demerits;
}

// ---------------------------------------------------------------- //
// Public API                                                        //
// ---------------------------------------------------------------- //

export type HookQualityBreakdown = {
  total: number;
  visceral: number;
  anthropomorph: number;
  brevity: number;
  concrete: number;
  contradiction: number;
  /** PHASE D1 — AI-cliché demote (range -15..0). Soft signal,
   *  applied as a negative addend to `total`. Surfaced in the
   *  breakdown so QA harness telemetry can identify which hooks
   *  are bleeding score to the cliché list. */
  aiCliche: number;
  /** P16-A1 — additive metadata + human-lift breakdown. ALWAYS
   *  present (zero-valued when flag OFF or signals absent). The
   *  three numeric lift fields are folded into `total` only when
   *  `LUMINA_HQS_HUMAN_LIFT_ENABLED` is `"1"` or `"true"`; with the
   *  flag OFF every existing field above is byte-for-byte unchanged
   *  and `total` does not include any human-lift contribution.
   *
   *  `verbTier`, `anthropomorphBranch`, `contradictionSource`, and
   *  `aiClicheFired` are diagnostic-only — they expose information
   *  already used internally so tests + the predict harness can
   *  attribute lifts. They never affect `total` directly. */
  verbTier: VisceralVerbTier;
  anthropomorphBranch: AnthropomorphBranch;
  contradictionSource: ContradictionSource;
  aiClicheFired: boolean;
  humanLift: HumanLiftBreakdown;
};

/** Score a hook on the Y8 punch scale. `family` is currently unused
 *  by the scoring math (the verb tiers are family-agnostic), but is
 *  retained on the signature so future per-family weighting (e.g.
 *  `quiet_realization` family permitting softer verbs without
 *  penalty) can land without changing every call site. */
export function scoreHookQuality(
  hook: string,
  _family: PremiseCoreFamily,
): number {
  return scoreHookQualityDetailed(hook, _family).total;
}

/** Same scoring as `scoreHookQuality` but returns the per-component
 *  breakdown for the boot assertion in `voiceClusters.ts`, the QA
 *  harness, and unit tests. */
export function scoreHookQualityDetailed(
  hook: string,
  _family: PremiseCoreFamily,
): HookQualityBreakdown {
  const lower = (hook ?? "").toLowerCase();
  const visceralD = visceralVerbScoreDetailed(lower);
  const visceral = visceralD.score;
  const anthD = anthropomorphScoreDetailed(lower);
  const rawAnthropomorph = anthD.score;
  const brevity = brevityScore(lower);
  const concrete = concretenessScore(lower);
  const contradictionD = contradictionScoreDetailed(lower);
  const contradiction = contradictionD.score;
  // PHASE D1 — negative-only AI-cliché demote.
  const aiCliche = aiClicheScore(lower);

  // PHASE Y8 — gaming guard. The EXPLICIT anthropomorph regex
  // (`my own`, `myself`, `itself`, etc.) is worth a full 25, big
  // enough that a hook could fake personhood by prefixing any bland
  // statement with `my own X was Y` and clear the median bar. The
  // marker only earns its full credit when the hook ALSO shows real
  // captivating signal somewhere (a captivating verb above bland, OR
  // a concrete catalog anchor, OR a contradiction beat). When the
  // marker is the ONLY signal, we cap the credit at the IMPLICIT
  // anthropomorph tier (12) so the gaming hook lands well below the
  // ≥60 median target. IMPLICIT credit is unaffected because its
  // structural pattern (`the X verbed me`) already requires a real
  // animate-coded verb, which itself is a meaningful signal.
  let anthropomorph = rawAnthropomorph;
  if (rawAnthropomorph === 25) {
    const hasOtherSignal =
      visceral > 5 || concrete > 0 || contradiction > 0;
    if (!hasOtherSignal) anthropomorph = 12;
  }

  // P16-A1 — Human-lift signals. ALWAYS computed for telemetry; only
  // FOLDED INTO `total` when the staging flag is on. Flag OFF →
  // `humanLift.total === 0` and `total` is byte-for-byte identical to
  // pre-P16-A1 behavior. The widening helper guarantees
  // `widenedBrevity >= originalBrevity` for every word count, so the
  // brevity-axis contribution to `total` can only ever grow.
  const flagOn = isHumanLiftEnabled();
  const humanLift: HumanLiftBreakdown = flagOn
    ? computeHumanLift({
        hookLower: lower,
        verbTier: visceralD.tier,
        anthropomorphBranch: anthD.branch,
        contradictionSource: contradictionD.source,
        aiClicheNegative: aiCliche < 0,
        originalBrevity: brevity,
      })
    : ZERO_HUMAN_LIFT;

  const baseTotal =
    visceral + anthropomorph + brevity + concrete + contradiction + aiCliche;
  const total = flagOn ? baseTotal + humanLift.total : baseTotal;

  return {
    total,
    visceral,
    anthropomorph,
    brevity,
    concrete,
    contradiction,
    aiCliche,
    verbTier: visceralD.tier,
    anthropomorphBranch: anthD.branch,
    contradictionSource: contradictionD.source,
    aiClicheFired: aiCliche < 0,
    humanLift,
  };
}

/* ------------------------------------------------------------------ */
/* PHASE Y9-A — `hookQualityBoost` selection-layer band.              */
/* ------------------------------------------------------------------ */
/*                                                                    */
/* Mirrors the SAME magnitude band as `premiseComedyBoost`            */
/* (+7 max, -2 floor, 0 default for `undefined`) but reads the Y8     */
/* 0-100 `scoreHookQuality` total instead of the Phase 6E 0-10        */
/* `premiseComedyScore.total`. The boost band is a bucket-discrete    */
/* function of the score so QA can read off "candidate at score 67    */
/* gets +3 base boost" without re-running selectionPenalty:           */
/*                                                                    */
/*   score >= 90 → +7 (top of band — the "captivating + vivid +       */
/*                     tight + concrete + contradiction" hook the     */
/*                     Y8 scorer rewards on every axis)               */
/*   score 80-89 → +6                                                 */
/*   score 70-79 → +5                                                 */
/*   score 60-69 → +3 (median floor — Y8 boot assert at floor 40 is   */
/*                     enforced by `voiceClusters.ts`, but the BOOST  */
/*                     band's positive side starts at 60 so a hook    */
/*                     must be clearly above median to earn promotion */
/*                     pressure at selection)                         */
/*   score 50-59 → 0  (neutral — same posture as a pre-Y9-A non-      */
/*                     premise candidate)                             */
/*   score 40-49 → -1 (demote band — recipe loop usually filters      */
/*                     these out before selection sees them, but the  */
/*                     defensive demote keeps the math degradation    */
/*                     clean if a stale candidate slips through)      */
/*   score <  40 → -2 (deep demote band — the Y8 boot assert refuses  */
/*                     to ship a voice cluster whose worst hook       */
/*                     scores below this floor; this branch is        */
/*                     defensive for the same self-healing reason as  */
/*                     `premiseComedyBoost`'s `total < 5 → 0` branch) */
/*   undefined  → 0  (defensive collapse — non-core_native            */
/*                     candidates whose meta omits `hookQualityScore` */
/*                     get the neutral 0 a legacy hook gets, exactly  */
/*                     mirroring `premiseComedyBoost(undefined)`)     */
/*                                                                    */
/* The band INTENTIONALLY ladders sub-linearly across the 60-90       */
/* range (60→+3, 70→+5, 80→+6, 90→+7) instead of linearly so the      */
/* difference between a "median" and a "premium" hook is the          */
/* dominant signal, while the difference between a "premium" and a    */
/* "perfect" hook is a tiebreaker. Mirrors the `premiseComedyBoost`   */
/* design (10→+7, 9→+6, 8→+5, 7→+4 — same +1 ladder per point at      */
/* the top) so the migration is a strict "more signal, same ranking  */
/* magnitude" upgrade.                                                */
/*                                                                    */
/* Wire site: `selectionPenalty` in `ideaScorer.ts` reads             */
/* `c.meta.hookQualityScore` (set by `coreCandidateGenerator` on     */
/* core_native candidates) and falls back to                          */
/* `premiseComedyBoost(c.meta.premiseComedyScore?.total)` when the    */
/* hookQuality score is absent (pattern_variation + claude_fallback). */
/* The fallback path lands in the EXACT SAME boost magnitude as       */
/* pre-Y9-A for those non-core paths — Y9-A is core_native-only.      */
export function hookQualityBoost(score: number | undefined): number {
  if (score === undefined) return 0;
  if (score >= 90) return 7;
  if (score >= 80) return 6;
  if (score >= 70) return 5;
  if (score >= 60) return 3;
  if (score >= 50) return 0;
  if (score >= 40) return -1;
  return -2;
}
