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
  isStiffFamilyVerbLeak,
  FAMILY_ACTIONS,
} from "./coreDomainAnchorCatalog.js";
import {
  ABSTRACT_ANCHORS,
  getAuthoredAnchorSet,
} from "./authoredScenarioPlans.js";

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
  | "verb_anchor_implausible"
  // PHASE UX3.2 additions
  | "impossible_physical_action_on_abstract"
  | "placeholder_filming_phrase"
  | "authored_domain_used_generic_template"
  // PHASE UX3.3 additions — close the metric-lying gap from UX3.2
  // live QA (validator said PASS while shipping "abandon the
  // textbook" / "overthink the invite" / "Beat 3: i abandoned the
  // X" / "pick the phone showing the invite up, put it back").
  | "family_verb_leak_on_scene"
  | "meta_template_signature";

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
// PHASE UX3.3 — family-verb leak on scene surfaces                  //
// ---------------------------------------------------------------- //
//
// Catches the exact failure mode UX3.2 live QA shipped with PASS:
// the cohesive author's `resolveAnchorAwareAction` falls open and
// returns the raw stiff family verb when the anchor isn't in
// `ANCHOR_VERB_FALLBACK`. The verb then leaks through every render
// surface ("abandon the textbook", "overthink the invite", "fake
// the doc"). Rule 9 only catches anchors that are IN the fallback
// table; this rule catches the long tail.
//
// Hook surfaces are exempt — hooks are allowed to use these verbs
// metaphorically ("when overthinking the text becomes a hobby")
// and have their own quality gates. We only ban these on scene
// surfaces (whatToShow / howToFilm / shotPlan / trigger / reaction /
// caption / script) where they imply an unfilmable physical action.
//
// PHASE UX3.3 — `expose` added. UX3.2 live QA shipped scene text
// like "expose the sink" / "expose the gym" because `expose` is the
// `identity_exposure` family verb and was passing through unchecked.
//
// PHASE UX3.3 (rev 2) — capture groups added: group 1 = verb (any
// tense), group 2 = anchor noun. Rule 13 below uses these to gate
// the rejection on `isVerbAnchorImplausible(bareVerb, anchor)` so
// we honour rule 9's `VERB_ANCHOR_PLAUSIBLE` whitelist (e.g.
// "abandon the draft" / "ghost the thread" are explicitly allowed
// and must not be rejected by the leak rule).
// PHASE UX3.3 (rev-4) — broadened determiner alternation. Pre-rev-4
// only matched `verb + (the|my|your|...) + noun`. 20-idea live sweep
// shipped "Frame the app, pause for a beat, then **ghost it**." and
// "i confessed to the X. then **performed myself**." — both bypassed
// detection because `it` and `myself` weren't in the alternation.
// Added `it|me|myself|yourself|himself|herself|themself|themselves|
// itself|ourselves` so any "verb + pronoun" tail also catches.
const FAMILY_VERB_LEAK_RE =
  /\b(abandon(?:ed|ing|s)?|ghost(?:ed|ing|s)?|fake[ds]?|faking|spiral(?:ed|ing|s)?|overthink(?:s|ing)?|overthought|perform(?:ed|ing|s)?|expose[ds]?|exposing)\s+(?:the|my|your|their|its|this|that|it|me|myself|yourself|himself|herself|themself|themselves|itself|ourselves)\b(?:\s+(\w+))?/;

/** PHASE UX3.3 — collapse a tense-inflected family verb token back
 *  to its bare form so we can ask the catalog whether the
 *  (bare-verb, anchor) pair is plausible. The set of forms here
 *  must stay aligned with the alternation in `FAMILY_VERB_LEAK_RE`
 *  group 1. */
function bareFamilyVerb(token: string): string {
  const t = token.toLowerCase();
  if (t === "overthought" || t.startsWith("overthink")) return "overthink";
  if (t.startsWith("abandon")) return "abandon";
  if (t.startsWith("ghost")) return "ghost";
  if (t === "faking" || t.startsWith("fake")) return "fake";
  if (t.startsWith("spiral")) return "spiral";
  if (t.startsWith("perform")) return "perform";
  if (t === "exposing" || t.startsWith("expose")) return "expose";
  return t;
}

// ---------------------------------------------------------------- //
// PHASE UX3.3 — meta-template signatures                            //
// ---------------------------------------------------------------- //
//
// Catches the "the template IS the failure" patterns from
// `cohesiveIdeaAuthor.ts` generic-fallback show / film shapes:
//
//   • "Beat 1: glance at the X. Beat 2: shrug. Beat 3: i ${ap} the X."
//     — meta-instruction pretending to be a beat plan.
//   • "Step in, pick the X up, put it back. One more beat — then
//     ${ab} the X for real this time."
//     — fake gesture (no comedic logic).
//
// Both are unfilmable regardless of which anchor is plugged in.
// Banned on every scene surface.
//
// PHASE UX3.3 — added the "...hesitate, and X the Y — end on your
// face mid-realization." signature from the now-deleted generic
// showShape[3] template. The template is gone from
// `cohesiveIdeaAuthor.ts` but we keep the regex as defense in depth
// (future contributors / Claude fallback / pattern-engine variants
// could regenerate the same scaffold).
const META_TEMPLATE_SIGNATURES: ReadonlyArray<RegExp> = [
  /\bbeat\s*\d+\s*:\s*(?:glance|shrug)\b/,
  /\bup,\s*put\s+it\s+back\b/,
  /\bone\s+more\s+beat\b\s*[—–\-]\s*then\b/,
  // PHASE UX3.3 — "hesitate, and X the Y — end on your face mid-realization."
  /\bhesitate,\s+and\s+\w+\s+the\s+\w+\s*[—–\-]\s*end\s+on\s+your\s+face\s+mid-realization\b/,
  // PHASE UX3.3 (rev-4) — script LINE 2 placeholder that shipped
  // verbatim in 20-idea live sweep ("show the X that contradicts
  // line 1." was the literal template metadata, not creative
  // direction). Source template fixed in `cohesiveIdeaAuthor.ts`
  // L653; regex is defense-in-depth so any future regression that
  // re-introduces the placeholder gets rejected at validation.
  /\bshow\s+the\s+\w+\s+that\s+contradicts\s+line\s*1\b/,
  // PHASE UX3.3 (rev-4) — "knows i'm faking it" idiom shipped 3× in
  // a single 20-idea batch from the now-deleted voiceClusters L305
  // template. Defensive regex catches the construction even if the
  // template returns from a future contributor or pattern-engine
  // variant.
  /\bknows\s+(?:i\s*['']?m|i\s+am)\s+faking\s+it\b/,
  // PHASE UX3.3 (rev-4) — "i confessed to the X. then Y myself."
  // shape from now-deleted voiceClusters L163 template. The `then
  // <verb> myself` tail is the giveaway — defends against return.
  /\bconfessed\s+to\s+the\s+\w+\.\s+then\s+\w+\s+myself\b/,
];

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

  // ── UX3.2 rules (NEW — fire AFTER the existing rules) ───────────

  // (10) impossible physical action on an abstract anchor.
  // The 19 abstract anchors (gym, inbox, calendar, profile, thread,
  // tasks, mood, vibe, plan, deadline, week, morning, evening,
  // mirror, rsvp, doc, yoga, swipe, bio, app, draft, syllabus,
  // flashcards, wallpaper, lockscreen, junk) cannot literally be
  // "set down" / "picked up" / "dodged" / "moved" / "dropped" by
  // a creator on camera — they're concepts, screens, or places.
  // Catches verbatim "set the inbox down" / "pick the gym up" /
  // "dodge the calendar" patterns. The cohesive author's UX3.2
  // generic-fallback path swaps the bare abstract noun for a
  // concrete prop phrase ("phone open to the inbox") so this
  // pattern shouldn't fire from the legitimate render path; this
  // rule defends against pattern-engine candidates and any future
  // regression that bypasses the prop-substitution branch.
  // PHASE UX3.2 (post-architect-review) — the directional adverb
  // (up|down|away|over|out|aside) is REQUIRED, not optional. The
  // earlier optional form false-fired on the concrete-prop swap
  // path: e.g. for the `gym` anchor, prop swap renders "Set the
  // gym shoes by the door down where the camera can see it." which
  // matched `set the gym` even though the actual direct object is
  // the prop phrase ("gym shoes by the door"), not the bare anchor.
  // Requiring the adverb guarantees the rule only fires when the
  // anchor IS the direct object — which is the actual impossible
  // construction we want to catch ("set the inbox down", "pick
  // the gym up", "dodge the calendar away"). Generic-template
  // emissions on the swap path are caught by rule 12 instead.
  for (const abstractAnchor of ABSTRACT_ANCHORS) {
    const escAnchor = abstractAnchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `\\b(set|pick|dodge|move|drop|grab|toss|throw|push|kick|carry|hold)\\s+(?:the\\s+)?${escAnchor}\\s+(up|down|away|over|out|aside)\\b`,
    );
    if (re.test(allRenderedLc)) {
      return "impossible_physical_action_on_abstract";
    }
  }

  // (11) placeholder / "Lean into the X beat" / "the reveal lands
  // here" / "let the props carry the deadpan" filming phrases.
  // These are the literal placeholder strings the pre-UX3.2
  // film-this-now placeholder beat + ux31 comfortAdaptCopy emitted
  // when the idea didn't actually have a concrete twist beat to
  // describe. Caught here so neither the cached idea path nor any
  // future template regression can ship them.
  const PLACEHOLDER_PHRASES: ReadonlyArray<RegExp> = [
    /\blean into the\s+\w+\s+beat\b/,
    /\bthe\s+\w+(?:\s+\w+)?\s+lands here\b/,
    /\blet the (?:contradiction|shift|reveal) (?:widen|breathe)\b/,
    /\blet the props carry\b/,
    /\bprops carry the deadpan\b/,
    /\bend beat\s*:/,
  ];
  for (const re of PLACEHOLDER_PHRASES) {
    if (re.test(allRenderedLc)) {
      return "placeholder_filming_phrase";
    }
  }

  // (12) authored domain shipped with a generic-template signature.
  // Fires only when one of the 10 hand-curated authored anchors is
  // BOTH the apparent topic AND appears INSIDE one of the generic
  // shape-template signatures the cohesive author's GENERIC fallback
  // emits when no authored plan was selected.
  //
  // The signatures below are SUBSTITUTION-PROOF: they all key off
  // patterns the generic templates render with `${anchorLc}` (the
  // bare authored anchor token) — which is preserved verbatim even
  // when the abstract-anchor concrete-prop swap turns `${n}` into
  // `phone showing the inbox`. This was the gap in the first cut:
  // earlier signatures keyed off `${n}` patterns that never matched
  // for abstract authored anchors because `${n}` had been swapped.
  //
  // Per-anchor anchored regexes (instead of one global regex with
  // an alternation over all anchors) keep legacy fixtures from
  // spuriously firing — the matched anchor token must also literally
  // be present in the rule output.
  const authoredAnchors = getAuthoredAnchorSet();
  for (const a of authoredAnchors) {
    const escAnchor = a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sigs: ReadonlyArray<RegExp> = [
      // L493 generic show shape 1: "...Beat 3: i ${ap} the ${anchorLc}."
      new RegExp(`\\bbeat 3: i \\w+ the ${escAnchor}\\b`),
      // L495 generic show shape 2: "...Then ${ab} the ${anchorLc} and walk out of frame."
      new RegExp(`\\b\\w+ the ${escAnchor} and walk out of frame\\b`),
      // L497 generic show shape 3: "...then ${ab} the ${anchorLc} for real this time."
      new RegExp(`\\b\\w+ the ${escAnchor} for real this time\\b`),
      // L499 generic show shape 4: "...${ab} the ${anchorLc} — end on your face mid-realization."
      new RegExp(
        `\\b\\w+ the ${escAnchor}\\s+[—–-]\\s+end on your face mid-realization\\b`,
      ),
      // L510 generic film shape 1: "...Cut the second you ${ab} the ${anchorLc}."
      new RegExp(`\\bcut the second you \\w+ the ${escAnchor}\\b`),
      // L512 generic film shape 2: "...The moment you ${ab} the ${anchorLc} is the cut."
      new RegExp(
        `\\bthe moment you \\w+ the ${escAnchor} is the cut\\b`,
      ),
      // L514 generic film shape 3: "...do the ${ab} beat on the ${anchorLc} once..."
      new RegExp(`\\bdo the \\w+ beat on the ${escAnchor}\\b`),
      // L516 generic film shape 4: "...${ab} the ${anchorLc} on the beat, step out..."
      new RegExp(`\\b\\w+ the ${escAnchor} on the beat,\\s+step out\\b`),
      // L537 generic shotPlan beat 2: "Medium: ${actionBare} the ${anchorLc} in one clear gesture."
      new RegExp(
        `\\bmedium:\\s+\\w+ the ${escAnchor} in one clear gesture\\b`,
      ),
      // L536 generic shotPlan beat 1: "Wide-ish: enter the frame with the ${renderNoun} visible."
      // When concrete-prop swap fires, `renderNoun` is one of the
      // ABSTRACT_TO_CONCRETE_PROP entries — and the authored anchor
      // token can sit anywhere inside that prop phrase (head:
      // "gym shoes by the door"; middle: "phone with the alarm
      // ringing"; tail: "phone open to the calendar"). Two bounded
      // `.{0,80}?` spans — one between `with` and the anchor, one
      // between the anchor and `visible` — accept all three layouts
      // while still requiring both the "wide-?ish: enter the frame
      // with" preamble AND the "visible" sentence tail. False-fire
      // risk is constrained by the literal preamble + tail (legacy
      // fixtures with unrelated authored-anchor tokens elsewhere in
      // the corpus don't carry that exact preamble + tail bracket).
      new RegExp(
        `\\bwide-?ish: enter the frame with .{0,80}?\\b${escAnchor}\\b.{0,80}?visible\\b`,
      ),
    ];
    for (const re of sigs) {
      if (re.test(allRenderedLc)) {
        return "authored_domain_used_generic_template";
      }
    }
  }

  // ── UX3.3 rules (NEW — close the metric-lying gap) ─────────────

  // (13) family-verb leak on a scene surface. Catches "abandon the
  // textbook" / "overthink the invite" / "fake the doc" — the
  // exact strings UX3.2 live QA shipped with PASS. Hook surfaces
  // are exempt by construction (`allRenderedLc` excludes hookLc).
  //
  // PHASE UX3.3 (rev 3, post-architect) — iterate ALL matches via
  // `matchAll`, not just the first, and use the validator-only
  // `isStiffFamilyVerbLeak` predicate (no fallback-existence gate)
  // so the long-tail catch is preserved. Rev 2 used `.match()` +
  // `isVerbAnchorImplausible` which had two bugs: (a) only the
  // first match was checked, so a plausible-then-implausible
  // sequence ("ghost the thread … expose the sink") falsely
  // passed; (b) the fallback gate caused unknown-anchor stiff-verb
  // leaks to fail open. Both flagged by architect UX3.3-C5 review.
  // Whitelist semantics from rule 9 are preserved: pairs in
  // `VERB_ANCHOR_PLAUSIBLE[verb]` still pass.
  for (const m of allRenderedLc.matchAll(
    new RegExp(FAMILY_VERB_LEAK_RE, "g"),
  )) {
    const bareVerb = bareFamilyVerb(m[1] ?? "");
    const anchorToken = (m[2] ?? "").toLowerCase();
    if (isStiffFamilyVerbLeak(bareVerb, anchorToken)) {
      return "family_verb_leak_on_scene";
    }
  }

  // (14) meta-template signatures from the generic show/film shape
  // pool. Independent of which anchor or verb is plugged in — the
  // template structure itself is unfilmable.
  for (const re of META_TEMPLATE_SIGNATURES) {
    if (re.test(allRenderedLc)) {
      return "meta_template_signature";
    }
  }

  return null;
}
