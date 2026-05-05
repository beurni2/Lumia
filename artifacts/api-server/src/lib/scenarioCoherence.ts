/**
 * PHASE UX3 — Scenario coherence guard.
 * PHASE UX3.1 — Expanded: corpus-grade stiffness detection across
 * all rendered surfaces; hook↔scenario noun-cluster bind guard;
 * verb-anchor plausibility gate; bad-grammar past-participle catch.
 *
 * Defensive validators that catch the surfaced failure modes the
 * cohesive author + Layer-1/Claude paths can leak into shipped
 * ideas:
 *
 *   1. `deliberate_template_artifact`
 *      Stiff "X the Y deliberately" template language in
 *      whatToShow / howToFilm.
 *
 *   2. `scene_template_leakage`
 *      The literal " scene" tail attached to an anchor noun
 *      ("the kitchen scene", "the laptop scene") — template
 *      placeholder leak.
 *
 *   3. `direct_to_camera_in_show`
 *      "direct to camera" appearing in whatToShow / howToFilm.
 *
 *   4. `show_missing_hook_anchor`
 *      whatToShow contains zero substantial tokens from the hook.
 *
 *   5. `split_self_show_mismatch`
 *      Hook references a temporal split-self ("yesterday me",
 *      "past me", "future me") but whatToShow neither includes a
 *      temporal cue NOR a contrast marker.
 *
 *   ── PHASE UX3.1 additions ──
 *
 *   6. `template_stiffness_phrase`
 *      Stiffness vocabulary the UX3 cleanup missed: "knowingly",
 *      "once, slow", "land the contradiction", "with intent",
 *      "on purpose", "end beat:", "frame the X center",
 *      "look straight at the lens", "hand-held — frame",
 *      "deadpan" as a standalone direction. Checked across hook,
 *      whatToShow, howToFilm, shotPlan, trigger, reaction,
 *      script, caption.
 *
 *   7. `bad_grammar_by_past_participle`
 *      Constructions like "by abandoned the fork" — past tense
 *      after "by " is grammatically broken (should be ing-form
 *      or bare). Caused by template substitution that pasted
 *      `${actionPast}` after a "by" preposition.
 *
 *   8. `hook_topic_noun_drift`
 *      Hook references a noun from one anchor compatibility
 *      cluster (e.g. "calendar") but whatToShow renders a noun
 *      from a different cluster (e.g. "mug"/"shopping cart"),
 *      with NO overlap between the two clusters. Catches the
 *      "yesterday me booked chaos for today me's calendar"
 *      attached to a shopping-cart scene failure mode. Hooks
 *      that contain no cluster-keyed nouns ("big premise"
 *      hooks) bypass this rule and fall through to UX3 rule 4.
 *
 *   9. `verb_anchor_implausible`
 *      The rendered (verb, anchor) pair is in the family-verb
 *      implausibility table (e.g. "abandon the fork", "ghost
 *      the calendar"). Wired through `isVerbAnchorImplausible`
 *      from `coreDomainAnchorCatalog`. Defensive — the cohesive
 *      author already swaps these via `resolveAnchorAwareAction`
 *      at render time; this catches pattern-engine candidates
 *      and any future regressions.
 *
 * Pure / synchronous / no I/O. Returns the first failure reason
 * or `null`. Caller threads the reason into the existing per-
 * reason rejection-counter telemetry. Existing UX3 rules (1-5)
 * fire BEFORE the new UX3.1 rules so legacy test fixtures keep
 * returning their established reasons.
 */

import type { Idea } from "./ideaGen.js";
import {
  clustersContaining,
  isVerbAnchorImplausible,
  FAMILY_ACTIONS,
} from "./coreDomainAnchorCatalog.js";

export type ScenarioCoherenceReason =
  | "deliberate_template_artifact"
  | "scene_template_leakage"
  | "direct_to_camera_in_show"
  | "show_missing_hook_anchor"
  | "split_self_show_mismatch"
  // PHASE UX3.1 additions
  | "template_stiffness_phrase"
  | "bad_grammar_by_past_participle"
  | "hook_topic_noun_drift"
  | "verb_anchor_implausible";

const STOPWORDS = new Set<string>([
  "the","a","an","and","or","but","if","then","of","for","to","in","on","at","by",
  "is","was","are","were","be","been","being","have","has","had","i","im","me","my",
  "you","your","it","its","this","that","these","those","there","here","when","where",
  "why","how","what","who","whom","do","does","did","done","doing","with","without",
  "into","onto","from","as","like","just","ok","okay","so","also","than","very",
  "really","too","still","yet","again","once","twice","now","not","no","yes",
  "go","goes","went","gone","going","get","got","gotten","getting",
  "him","her","his","hers","their","theirs","they","them","we","us","our","ours",
  "out","up","down","off","over","under","about","around","through","because",
  "while","upon","against","between","its","onto","its","one","two","three",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

const SPLIT_SELF_RE =
  /\b(yesterday|today|tomorrow|past|future|present|morning|night|evening|tonight)\s+me\b/;
const TEMPORAL_HINT_RE =
  /\b(yesterday|today|tomorrow|past|future|then|now|earlier|later|morning|night|tonight|before|after|previously|already|ago|hours)\b/;
const CONTRAST_HINT_RE =
  /\bvs\.?\b|→|<-|->|\bbut\b|\bwhile\b|\bversus\b|\bthen\b|\blater\b/;

// ---------------------------------------------------------------- //
// PHASE UX3.1 — stiffness phrase corpus                             //
// ---------------------------------------------------------------- //
//
// Each entry catches a stage-direction stiffness phrase that the
// pre-UX3.1 templates emitted into shipped ideas. Word-bounded
// where applicable so we don't false-positive on substrings.
const STIFFNESS_PHRASES: ReadonlyArray<RegExp> = [
  /\bknowingly\b/,
  /\bonce,\s*slow\b/,
  /\bonce,?\s+deliberately\b/,
  /\bland the contradiction\b/,
  /\bwith intent\b/,
  /\bon purpose\b/,
  /\bend beat\s*:/,
  /\bframe the [a-z][a-z\-]+ center\b/,
  /\bhand-?held\s*[—\-]\s*frame\b/,
  /\blook straight at the lens\b/,
  /\blook straight to camera\b/,
  /\bdirect-to-camera\b/,
  // standalone "deadpan" used as a stage direction (the comma/
  // sentence-final position): ", deadpan." or ", deadpan,"
  /,\s*deadpan[\.,]/,
  // "presenting evidence" stage-cliche from beat 3 pool
  /\blike presenting evidence\b/,
  // "the geography do the work" / "let the geography" filmschool stiffness
  /\blet the geography\b/,
  // "commit to the X beat" trigger stiffness
  /\bcommit to the\s+\w+\s+beat\b/,
  // "no reaction shot, just the silence" stiffness
  /\bno reaction shot\b/,
];

// ---------------------------------------------------------------- //
// PHASE UX3.1 — past-participle-after-by grammar gate               //
// ---------------------------------------------------------------- //
//
// "by abandoned the fork" — template substitution pasted the past
// tense after a "by " preposition where ing-form or bare was
// required. Build the regex from the canonical FAMILY_ACTIONS so
// it stays in sync if the verb table grows.
const BAD_BY_PAST_RE = (() => {
  const pasts = Object.values(FAMILY_ACTIONS)
    .map((a) => a.past.toLowerCase())
    .filter((p) => /^[a-z]+$/.test(p));
  if (pasts.length === 0) return /a^/; // never matches
  return new RegExp(`\\bby\\s+(${pasts.join("|")})\\s+the\\b`);
})();

// ---------------------------------------------------------------- //
// PHASE UX3.1 — hook-vs-show cluster mismatch                       //
// ---------------------------------------------------------------- //
//
// Walk the hook tokens; collect the cluster set for any token that
// matches a cluster keyword. Same for whatToShow. If both are non-
// empty AND disjoint, the hook references a noun from one
// compatibility cluster while the show depicts another — reject.
//
// Hooks with NO cluster-keyed nouns (abstract / big-premise hooks)
// bypass this rule. The existing rule 4 still requires at least one
// substantial token overlap, so abstract hooks aren't a free pass.
function clusterIndexesForText(text: string): Set<number> {
  const out = new Set<number>();
  for (const tok of tokenize(text)) {
    for (const idx of clustersContaining(tok)) out.add(idx);
  }
  return out;
}

function intersects(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

// ---------------------------------------------------------------- //
// PHASE UX3.1 — verb-anchor implausibility on rendered surfaces     //
// ---------------------------------------------------------------- //
//
// Scan whatToShow + shotPlan + howToFilm for every "{family-verb}
// the {noun}" pattern and probe the catalog's verb-anchor
// plausibility table. Defensive — the cohesive author already
// swaps implausible pairs via resolveAnchorAwareAction at render
// time; this catches pattern-engine candidates that bypass the
// author entirely.
const STIFF_VERBS = ["abandon", "ghost", "spiral", "fake"];
const STIFF_VERB_NOUN_RE = new RegExp(
  `\\b(${STIFF_VERBS.join("|")})\\s+the\\s+([a-z][a-z\\-]+)\\b`,
  "g",
);

function findFirstImplausibleVerbAnchor(
  text: string,
): { verb: string; anchor: string } | null {
  STIFF_VERB_NOUN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STIFF_VERB_NOUN_RE.exec(text)) !== null) {
    const verb = m[1]!;
    const anchor = m[2]!;
    if (isVerbAnchorImplausible(verb, anchor)) return { verb, anchor };
  }
  return null;
}

// ---------------------------------------------------------------- //
// Validator                                                         //
// ---------------------------------------------------------------- //

export function validateScenarioCoherence(
  idea: Idea,
): ScenarioCoherenceReason | null {
  const showLc = idea.whatToShow.toLowerCase();
  const filmLc = idea.howToFilm.toLowerCase();
  const hookLc = idea.hook.toLowerCase();
  const triggerLc = (idea.trigger ?? "").toLowerCase();
  const reactionLc = (idea.reaction ?? "").toLowerCase();
  const scriptLc = (idea.script ?? "").toLowerCase();
  const captionLc = (idea.caption ?? "").toLowerCase();
  const shotPlanLc = Array.isArray(idea.shotPlan)
    ? idea.shotPlan.join(" \n ").toLowerCase()
    : "";

  // Joined corpus for rules that span all rendered prose surfaces
  // (stiffness, bad grammar, verb-anchor implausibility).
  const allRenderedLc = [
    showLc,
    filmLc,
    triggerLc,
    reactionLc,
    shotPlanLc,
    scriptLc,
    captionLc,
  ].join(" \n ");

  // ── UX3 rules (preserved order; legacy tests rely on these
  // firing before the UX3.1 additions) ───────────────────────────

  // (1) verb-noun-deliberately stiffness
  if (/\bdeliberately\b/.test(showLc) || /\bdeliberately\b/.test(filmLc)) {
    return "deliberate_template_artifact";
  }

  // (2) "the {anchor} scene" template tail leak (whatToShow only)
  if (/\bthe\s+[a-z][a-z\-]+\s+scene\b/.test(showLc)) {
    return "scene_template_leakage";
  }

  // (3) "direct to camera" — whatToShow / howToFilm
  if (
    /\bdirect to camera\b/.test(showLc) ||
    /\bdirect to camera\b/.test(filmLc)
  ) {
    return "direct_to_camera_in_show";
  }

  // (4) hook-anchor token presence — at least one substantial hook
  // token must appear in whatToShow.
  const hookTokens = tokenize(idea.hook);
  if (hookTokens.length > 0) {
    const showTokens = new Set(tokenize(idea.whatToShow));
    let overlap = 0;
    for (const t of hookTokens) {
      if (showTokens.has(t)) {
        overlap += 1;
        break;
      }
    }
    if (overlap < 1) return "show_missing_hook_anchor";
  }

  // (5) split-self temporal hook MUST be reflected in whatToShow.
  if (SPLIT_SELF_RE.test(hookLc)) {
    if (!TEMPORAL_HINT_RE.test(showLc) && !CONTRAST_HINT_RE.test(showLc)) {
      return "split_self_show_mismatch";
    }
  }

  // ── UX3.1 rules (NEW — fire AFTER existing rules) ──────────────

  // (6) template stiffness corpus across all rendered surfaces.
  for (const re of STIFFNESS_PHRASES) {
    if (re.test(allRenderedLc)) return "template_stiffness_phrase";
  }

  // (7) bad grammar: "by {past-tense-verb} the X" — past tense
  // pasted after a "by" preposition. Substitution leak.
  if (BAD_BY_PAST_RE.test(allRenderedLc)) {
    return "bad_grammar_by_past_participle";
  }

  // (8) hook ↔ show anchor-cluster mismatch.
  // Abstract hooks (zero cluster-keyed nouns) bypass — rule 4
  // already forces minimum lexical overlap with the show.
  const hookClusters = clusterIndexesForText(idea.hook);
  if (hookClusters.size > 0) {
    const showClusters = clusterIndexesForText(idea.whatToShow);
    if (showClusters.size > 0 && !intersects(hookClusters, showClusters)) {
      return "hook_topic_noun_drift";
    }
  }

  // (9) verb-anchor implausibility on rendered surfaces.
  if (findFirstImplausibleVerbAnchor(allRenderedLc) !== null) {
    return "verb_anchor_implausible";
  }

  return null;
}
