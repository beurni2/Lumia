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

function visceralVerbScore(hookLower: string): number {
  // Tokenize and find the BEST verb in the hook (a hook can carry
  // multiple verbs; we score on the strongest one). 0 baseline so a
  // hook with no recognizable verb at all (rare — most templates
  // carry at least one) still has a chance via the other axes.
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
      return 30;
    case "mid":
      return 18;
    case "low":
      return 8;
    case "bland":
      // Bland verbs (`is` / `was` / `did` / `had`) shouldn't score
      // WORSE than no-verb-at-all hooks (the verb is present but
      // contributes nothing punchy). Match the UNKNOWN baseline so
      // the verb axis just stays neutral on bland-verb templates;
      // the captivating-verb signal lives in the HIGH/MID/LOW
      // tiers above. Quiet/noticing voice clusters intentionally
      // use bland verbs to set a soft register (`is the
      // personality`, `became my villain`) — the hook earns its
      // captivating points from the anthropomorph + contradiction
      // axes, not from the verb tier.
      return 5;
    case "none":
      return 5;
  }
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
const IMPLICIT_ANTHROPOMORPH =
  /\bthe\s+[a-z][a-z\-\s]{1,30}?\s+(?:won|beat|killed|ruined|ate|broke|hit|revealed|spoke|texted|called|decided|voted|watched|laughed|cried|left|started|stopped|happened|came|returned|whispered|told|asked|answered|lied|caught|scared|haunted|stalked|kept|chose|knew|saw|wanted|needed|loved|hated|ghosted|abandoned|faked|betrayed|ditched|performed|exposed|spiraled|avoided|overthought|drained|demolished|sabotaged|gaslit|seduced|hijacked)\b/;

function anthropomorphScore(hookLower: string): number {
  for (const re of EXPLICIT_ANTHROPOMORPH) {
    if (re.test(hookLower)) return 25;
  }
  if (IMPLICIT_ANTHROPOMORPH.test(hookLower)) return 12;
  return 0;
}

// ---------------------------------------------------------------- //
// Brevity                                                           //
// ---------------------------------------------------------------- //

function brevityScore(hookLower: string): number {
  const words = hookLower.trim().split(/\s+/).filter(Boolean).length;
  if (words >= 5 && words <= 7) return 20;
  if (words === 4 || words === 8) return 17;
  if (words === 3 || words === 9) return 13;
  if (words === 2 || words === 10) return 9;
  return 5;
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

function contradictionScore(hookLower: string): number {
  for (const re of CONTRADICTION_PATTERNS) {
    if (re.test(hookLower)) return 10;
  }
  if (DRAMATIC_NOUNS.test(hookLower)) return 10;
  return 0;
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
  const visceral = visceralVerbScore(lower);
  const rawAnthropomorph = anthropomorphScore(lower);
  const brevity = brevityScore(lower);
  const concrete = concretenessScore(lower);
  const contradiction = contradictionScore(lower);

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

  return {
    total: visceral + anthropomorph + brevity + concrete + contradiction,
    visceral,
    anthropomorph,
    brevity,
    concrete,
    contradiction,
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
