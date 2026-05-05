/**
 * PHASE UX3 — Scenario coherence guard.
 *
 * Defensive validators that catch the surfaced failure modes the
 * cohesive author + Layer-1/Claude paths can leak into shipped
 * ideas:
 *
 *   1. `deliberate_template_artifact`
 *      Stiff "X the Y deliberately" template language in
 *      whatToShow / howToFilm. Reads as a stage direction, not
 *      a real beat. Caused by old showShape/filmShape templates
 *      that hard-coded the adverb.
 *
 *   2. `scene_template_leakage`
 *      The literal " scene" tail attached to an anchor noun
 *      ("the kitchen scene", "the laptop scene") — template
 *      placeholder leak from the legacy showShape pool.
 *
 *   3. `direct_to_camera_in_show`
 *      "direct to camera" appearing in whatToShow / howToFilm.
 *      Same legacy template tail; also incompatible with
 *      `comfortMode === "no_face"` clients downstream.
 *
 *   4. `show_missing_hook_anchor`
 *      whatToShow contains zero substantial tokens from the
 *      hook. Catches "yesterday me booked chaos" hook attached
 *      to an "abandoned the thread" scene where the hook's
 *      subject isn't depicted at all.
 *
 *   5. `split_self_show_mismatch`
 *      Hook references a temporal split-self ("yesterday me",
 *      "past me", "future me", etc.) but whatToShow neither
 *      includes a temporal cue NOR a contrast marker. The
 *      depicted action shows only one self and the hook's
 *      contrast goes unspoken.
 *
 * Pure / synchronous / no I/O — same discipline as
 * `validateComedy` in `comedyValidation.ts`. Returns the first
 * failure reason or `null`. Caller threads the reason into the
 * existing rejection-counter telemetry.
 */

import type { Idea } from "./ideaGen.js";

export type ScenarioCoherenceReason =
  | "deliberate_template_artifact"
  | "scene_template_leakage"
  | "direct_to_camera_in_show"
  | "show_missing_hook_anchor"
  | "split_self_show_mismatch";

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

export function validateScenarioCoherence(
  idea: Idea,
): ScenarioCoherenceReason | null {
  const showLc = idea.whatToShow.toLowerCase();
  const filmLc = idea.howToFilm.toLowerCase();
  const hookLc = idea.hook.toLowerCase();

  // (1) verb-noun-deliberately stiffness
  if (/\bdeliberately\b/.test(showLc) || /\bdeliberately\b/.test(filmLc)) {
    return "deliberate_template_artifact";
  }

  // (2) "the {anchor} scene" template tail leak. We reject any
  // "the [WORD] scene" pattern in the show; if a creator's anchor
  // genuinely IS something like "kitchen" + "scene" the recipe
  // can phrase it differently ("the kitchen", "the morning kitchen
  // moment"). We only check whatToShow because howToFilm rarely
  // uses "scene" naturally.
  if (/\bthe\s+[a-z][a-z\-]+\s+scene\b/.test(showLc)) {
    return "scene_template_leakage";
  }

  // (3) "direct to camera" — legacy template phrasing in either
  // surface. Catches both the rendered-template leak and any
  // Claude-fallback that happens to copy the phrase.
  if (
    /\bdirect to camera\b/.test(showLc) ||
    /\bdirect to camera\b/.test(filmLc)
  ) {
    return "direct_to_camera_in_show";
  }

  // (4) hook-anchor token presence — at least one substantial
  // hook token must appear in whatToShow.
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

  // (5) split-self temporal hook MUST be reflected in whatToShow
  // either by another temporal cue or an explicit contrast marker.
  if (SPLIT_SELF_RE.test(hookLc)) {
    if (!TEMPORAL_HINT_RE.test(showLc) && !CONTRAST_HINT_RE.test(showLc)) {
      return "split_self_show_mismatch";
    }
  }

  return null;
}
