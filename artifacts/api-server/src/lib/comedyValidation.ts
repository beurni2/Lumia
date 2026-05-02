/**
 * Comedy validation (PHASE X2 — PART 1, PART 2, PART 4)
 *
 * Heuristic, deterministic, fail-open validators that gate
 * idea candidates after scoring but before final selection.
 * Three sets of checks:
 *
 *   PART 1 (validateComedy):
 *     - Hard-rejects ideas that read as soft / hedged
 *       observations rather than jokes. Requires ≥2 of a small
 *       comedy-signal set across (hook + trigger + reaction).
 *
 *   PART 2 (validateComedy, alignment branch):
 *     - Hard-rejects ideas where the hook, whatToShow, and
 *       howToFilm don't share content tokens — i.e. the scene
 *       doesn't act out the joke, or the filming doesn't match
 *       the action.
 *
 *   PART 4 (validateAntiCopy):
 *     - Hard-rejects LLM-generated hooks that exact-match a
 *       curated seed hook (Layer 1 deterministic candidates ARE
 *       the curated examples by design — they pass through).
 *     - Hard-rejects when the candidate's premise sentence
 *       exact-matches a premise from the recent batch history.
 *
 * Intentionally cheap: regex / Set lookup only, no external
 * deps, no LLM calls. The cost of mis-rejection is bounded by
 * the existing rescue path in `hybridIdeator.ts` which ships
 * unfiltered top-of-pool when the kept set is empty.
 */
import {
  PREMISE_STYLE_DEFS,
  type PremiseStyleId,
} from "./patternIdeator.js";
import type { Idea } from "./ideaGen.js";

// ---------------------------------------------------------------- //
// Reasons enum                                                      //
// ---------------------------------------------------------------- //

export type ComedyRejectionReason =
  | "no_contradiction"
  | "no_tension"
  | "generic_observation"
  | "too_soft"
  | "hook_scenario_mismatch"
  | "filming_mismatch"
  | "copied_seed_hook"
  | "near_duplicate_premise";

// ---------------------------------------------------------------- //
// Signal detectors (PART 1)                                         //
// ---------------------------------------------------------------- //

// Words that mark contradiction / contrast / reversal in the hook.
const CONTRADICTION_MARKERS: readonly string[] = [
  " vs ",
  " vs.",
  "instead",
  "actually",
  "but",
  "still",
  "anyway",
  "and then",
  "yet",
  "the way i",
  "why do i",
  "why did i",
  "thought i",
  "said i would",
  "told myself",
];

// Words that indicate intention/plan that gets contradicted.
const INTENTION_MARKERS: readonly string[] = [
  "planned to",
  "tried to",
  "meant to",
  "going to",
  "supposed to",
  "promised",
  "decided to",
  "told myself",
  "said i would",
  "wanted to",
];

// Self-betrayal markers — "I betrayed me" patterns.
const SELF_BETRAYAL_MARKERS: readonly RegExp[] = [
  /\bghosted my own\b/i,
  /\bdisappoint(ed|ing) myself\b/i,
  /\bbetray(ed|ing|s) me\b/i,
  /\bquit on me\b/i,
  /\bcannot be trusted\b/i,
  /\bi specialize in\b/i,
  /\bsabotage(d)? (myself|me)\b/i,
  /\blied to myself\b/i,
  /\bi (always|keep|just) do this\b/i,
];

// Self-as-other / relationship-metaphor markers.
const SELF_AS_OTHER_MARKERS: readonly RegExp[] = [
  /\b(2am|3am|9am|morning|future|past|yesterday|tomorrow|present|current) me\b/i,
  /\bmy (brain|body|hands|legs|mouth|eyes|to-do|todo|list|fridge|phone|laundry|inbox|alarm|wallet|cart)\b/i,
  /\bgave my (\w+) the silent treatment\b/i,
  /\bnot speaking\b/i,
  /\bwaiting for a reply\b/i,
];

// Identity-exposure markers — confessional first-person identity.
const IDENTITY_MARKERS: readonly RegExp[] = [
  /\bi am the (kind|type) of person\b/i,
  /\bthis is who i am\b/i,
  /\bi specialize in\b/i,
  /\bthis is my (whole )?personality\b/i,
  /\bi'?m (the|a) person who\b/i,
  /\bthis is the kind of\b/i,
];

// Absurd escalation markers — small cause cosmic effect.
const ESCALATION_MARKERS: readonly RegExp[] = [
  /\bruined (my|the) (whole|entire) (day|week|life|month)\b/i,
  /\bthe (entire|whole) (day|week|year|month) (ended|over|gone)\b/i,
  /\bthe universe\b/i,
  /\bcosmic\b/i,
  /\bate my soul\b/i,
  /\bone (click|tap|word|look) and\b/i,
  /\bcompletely (ended|over|done|destroyed)\b/i,
];

// Specific-behavior signal: concrete verbs + concrete nouns.
const CONCRETE_TOKENS = /\b(open|check|read|scroll|watch|find|notice|realize|realise|stare|grab|send|type|swipe|tap|hear|see|fridge|inbox|coffee|gym|laundry|alarm|cart|hoodie|pile|3am|2am|9am|morning|bedtime|cashier|email|text)\b/i;

// Hedging / softness tokens — the "kinda observation" voice the
// spec explicitly rejects.
const SOFTNESS_TOKENS = /\b(kinda|kind of|sort of|sorta|maybe|a little|somewhat|ish|i think|i feel like|you know when|i guess)\b/i;

function detectComedySignals(text: string): {
  contradiction: boolean;
  intention: boolean;
  selfBetrayal: boolean;
  selfAsOther: boolean;
  identity: boolean;
  escalation: boolean;
  specific: boolean;
  count: number;
} {
  const lower = text.toLowerCase();
  const contradiction = CONTRADICTION_MARKERS.some((m) => lower.includes(m));
  const intention = INTENTION_MARKERS.some((m) => lower.includes(m));
  const selfBetrayal = SELF_BETRAYAL_MARKERS.some((r) => r.test(text));
  const selfAsOther = SELF_AS_OTHER_MARKERS.some((r) => r.test(text));
  const identity = IDENTITY_MARKERS.some((r) => r.test(text));
  const escalation = ESCALATION_MARKERS.some((r) => r.test(text));
  const specific = CONCRETE_TOKENS.test(text);
  const count =
    (contradiction ? 1 : 0) +
    (intention ? 1 : 0) +
    (selfBetrayal ? 1 : 0) +
    (selfAsOther ? 1 : 0) +
    (identity ? 1 : 0) +
    (escalation ? 1 : 0) +
    (specific ? 1 : 0);
  return {
    contradiction,
    intention,
    selfBetrayal,
    selfAsOther,
    identity,
    escalation,
    specific,
    count,
  };
}

// ---------------------------------------------------------------- //
// Alignment helpers (PART 2)                                        //
// ---------------------------------------------------------------- //

// Tiny stopword set tuned for short-form hooks — broader stopword
// lists from NLP libraries would over-strip the already-terse
// hooks (a 6-word hook could lose half its tokens). This list is
// limited to grammatical glue + the most generic "scene" verbs.
const STOPWORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "and", "or", "but", "if", "so",
  "to", "of", "in", "on", "at", "by", "for", "with",
  "is", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "doing", "done",
  "have", "has", "had", "having",
  "this", "that", "these", "those",
  "i", "me", "my", "mine", "you", "your", "we", "us", "our",
  "it", "its", "they", "them", "their",
  "as", "from", "into", "out", "up", "down", "over", "off",
  "then", "than", "just", "very", "really", "also",
  "show", "shows", "showing", "shown", "see", "seen",
  "scene", "shot", "phone", "camera", "video",
]);

function tokenize(s: string): Set<string> {
  const out = new Set<string>();
  const matches = s.toLowerCase().match(/[a-z][a-z0-9']{2,}/g);
  if (!matches) return out;
  for (const m of matches) {
    if (STOPWORDS.has(m)) continue;
    out.add(m);
  }
  return out;
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

// ---------------------------------------------------------------- //
// Anti-copy fingerprinting (PART 4)                                 //
// ---------------------------------------------------------------- //

/** Normalize a hook string for fingerprint comparison. */
export function normalizeHookFingerprint(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Lazily build the seed-hook fingerprint set from PREMISE_STYLE_DEFS
 * example hooks. Cached at module scope after first call so the
 * one-time scan (~200 examples) doesn't repeat per request.
 */
let _seedFingerprintsCache: ReadonlySet<string> | null = null;
export function loadSeedHookFingerprints(): ReadonlySet<string> {
  if (_seedFingerprintsCache) return _seedFingerprintsCache;
  const out = new Set<string>();
  // PREMISE_STYLE_DEFS is a Record<PremiseStyleId, PremiseStyleDef>;
  // each def has executions[] with a .example string. Iterate
  // defensively — the catalog is hand-edited and a future entry
  // could omit executions.
  for (const id of Object.keys(PREMISE_STYLE_DEFS) as PremiseStyleId[]) {
    const def = PREMISE_STYLE_DEFS[id];
    const execs = (def as { executions?: ReadonlyArray<{ example?: string }> })
      .executions;
    if (!execs) continue;
    for (const ex of execs) {
      if (ex.example && typeof ex.example === "string") {
        out.add(normalizeHookFingerprint(ex.example));
      }
    }
  }
  _seedFingerprintsCache = out;
  return out;
}

// ---------------------------------------------------------------- //
// Public API                                                        //
// ---------------------------------------------------------------- //

export type ValidateComedyMeta = {
  source?: string;
  usedBigPremise?: boolean | null | undefined;
};

/**
 * PART 1 + PART 2 — comedy + alignment validation.
 *
 * Returns a rejection reason string when the candidate fails any
 * gate, or null when it passes. Pure and deterministic.
 *
 * Layer-1 deterministic candidates whose source is
 * `pattern_variation` AND that came from the premise path
 * (`usedBigPremise === true`) are vacuous-passed on the comedy
 * gate — the premise catalog IS curated comedy by construction
 * and re-validating it would over-reject the engine's own ground
 * truth. Alignment + anti-copy still apply to those candidates.
 */
export function validateComedy(
  idea: Idea,
  meta: ValidateComedyMeta,
): ComedyRejectionReason | null {
  // PHASE X2 review (architect) — exemption is OR, not AND. Both
  // pattern_variation and usedBigPremise candidates ride curated
  // comedy by construction (the former IS the catalog; the latter
  // is a curated mechanism), so either flag alone should vacuous-
  // pass the comedy gate. The previous AND form would have re-
  // checked legacy pattern_variation entries and raw usedBigPremise
  // entries against the comedy regexes — over-rejecting curated
  // ground truth. Alignment + anti-copy still apply to both.
  const isCuratedComedy =
    meta.source === "pattern_variation" || meta.usedBigPremise === true;

  // ---- PART 1 — comedy signals ------------------------------------ //
  if (!isCuratedComedy) {
    const combined = `${idea.hook}\n${idea.trigger}\n${idea.reaction}`;
    const signals = detectComedySignals(combined);
    // Spec: "at least 2 of" the comedy signals.
    if (signals.count < 2) {
      // No tension AND no specific behavior — reads as a generic
      // observation rather than a joke. Distinguish "no_tension"
      // (has specific behavior but no twist) from "generic_observation"
      // (neither) for cleaner telemetry.
      if (!signals.contradiction && !signals.intention && !signals.escalation) {
        if (!signals.specific) return "generic_observation";
        return "no_tension";
      }
      return "no_contradiction";
    }
    // Softness check — hedging tokens without an offsetting contradiction.
    if (
      SOFTNESS_TOKENS.test(idea.hook) &&
      !signals.contradiction &&
      !signals.escalation
    ) {
      return "too_soft";
    }
  }

  // ---- PART 2 — alignment ----------------------------------------- //
  // PHASE X2 review (architect) — alignment thresholds tightened
  // to match spec exactly:
  //   * whatToShow ↔ (hook OR trigger): ≥2 tokens with EITHER side
  //     individually (was: combined ≥1 — too lenient, passed when
  //     one token leaked into hook+show overlap and zero into
  //     trigger+show).
  //   * vacuous-pass restricted to truly-empty token sets (was:
  //     `size >= 3` — let short-but-mismatched candidates skip).
  //     Zod min-length guarantees the source strings are non-empty;
  //     the only way `tokenize` returns an empty Set is if the text
  //     was 100% stopwords / sub-3-char (extremely rare in practice
  //     but worth not punishing — the gate has zero signal there).
  const hookTokens = tokenize(idea.hook);
  const showTokens = tokenize(idea.whatToShow);
  const triggerTokens = tokenize(idea.trigger);
  if (hookTokens.size > 0 && showTokens.size > 0) {
    const hookOverlap = intersectionSize(hookTokens, showTokens);
    const triggerOverlap = intersectionSize(triggerTokens, showTokens);
    if (Math.max(hookOverlap, triggerOverlap) < 2) {
      return "hook_scenario_mismatch";
    }
  }
  // whatToShow ↔ howToFilm: the filming must match the action.
  const filmTokens = tokenize(idea.howToFilm);
  if (showTokens.size > 0 && filmTokens.size > 0) {
    if (intersectionSize(showTokens, filmTokens) < 1) {
      return "filming_mismatch";
    }
  }
  // PHASE X2 review (architect) — premise→hook alignment edge.
  // Spec chain is "premise→hook→whatToShow→howToFilm", and the
  // upstream prompt design implies the hook is BORN FROM the
  // premise sentence. When a premise is present (Layer-3 / Claude
  // path only — Layer-1 candidates don't carry one), the hook
  // should share ≥1 content token with it. Lower threshold than
  // the show edge because the hook is a compressed re-statement,
  // not an enumeration; ≥2 would over-reject. Vacuous-pass when
  // either side tokenizes empty (same discipline as above).
  if (typeof idea.premise === "string" && idea.premise.length > 0) {
    const premiseTokens = tokenize(idea.premise);
    if (premiseTokens.size > 0 && hookTokens.size > 0) {
      if (intersectionSize(premiseTokens, hookTokens) < 1) {
        return "hook_scenario_mismatch";
      }
    }
  }

  return null;
}

/**
 * PART 4 — anti-copy guard.
 *
 * Returns a rejection reason when the candidate copies a curated
 * seed hook OR re-uses a premise sentence from recent history.
 * Pattern-variation candidates are exempt from the seed-hook check
 * because the catalog IS the seed corpus by design.
 */
export function validateAntiCopy(
  idea: Idea,
  meta: ValidateComedyMeta,
  seedFingerprints: ReadonlySet<string>,
  recentPremises?: ReadonlySet<string>,
): ComedyRejectionReason | null {
  // Pattern-variation candidates ship the curated examples on
  // purpose — exempt from the copy check.
  if (meta.source !== "pattern_variation") {
    const fp = normalizeHookFingerprint(idea.hook);
    if (fp.length > 0 && seedFingerprints.has(fp)) {
      return "copied_seed_hook";
    }
  }
  // Premise dup applies to ALL sources because duplicating the same
  // premise across batches collapses the comedic surface area
  // regardless of which layer produced it.
  if (idea.premise && recentPremises && recentPremises.size > 0) {
    const pfp = normalizeHookFingerprint(idea.premise);
    if (pfp.length > 0 && recentPremises.has(pfp)) {
      return "near_duplicate_premise";
    }
  }
  return null;
}

// ---------------------------------------------------------------- //
// Test-only resets                                                  //
// ---------------------------------------------------------------- //

/** Reset the seed-fingerprint cache. Test-only — call between tests
 *  if `PREMISE_STYLE_DEFS` is mocked. Production code never calls
 *  this (the catalog is immutable at runtime). */
export function _resetSeedFingerprintCacheForTests(): void {
  _seedFingerprintsCache = null;
}
