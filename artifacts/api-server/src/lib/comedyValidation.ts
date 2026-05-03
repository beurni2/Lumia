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
import { USER_BLESSED_HOOK_CORPUS } from "./userBlessedHookCorpus.js";

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
 *
 * PHASE Y6 NOTE: the seed-hook fingerprint set is no longer
 * consumed as an EXACT-MATCH anti-copy gate. `validateAntiCopy`
 * computes Jaccard bigram similarity against the seed corpus
 * directly (see `loadSeedHookBigrams` below). The fingerprint set
 * is kept exported because (a) the cohesive author still passes
 * it through to `validateAntiCopy` for backwards-compat call-site
 * shape, and (b) telemetry / future debug paths may want the
 * normalized-string form. Treat it as an OPAQUE corpus identifier
 * post-Y6.
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
  // PHASE D3 — fold the user's 159-hook blessed corpus into the seed
  // fingerprint set so the post-Y6 Jaccard near-verbatim gate treats
  // each corpus hook as a voice-training reference (generated hooks
  // landing within Jaccard 0.85 are rejected as near-copies, which
  // is the same discipline already applied to PREMISE_STYLE_DEFS
  // examples). Pure additive — fingerprint set is consumed
  // downstream as opaque corpus identity, never as an allowlist.
  for (const e of USER_BLESSED_HOOK_CORPUS) {
    out.add(normalizeHookFingerprint(e.hook));
  }
  _seedFingerprintsCache = out;
  return out;
}

// ---------------------------------------------------------------- //
// PHASE Y6 — Seed-hook bigram set + Jaccard similarity              //
// ---------------------------------------------------------------- //

/** Tokenize a hook string for bigram-based Jaccard similarity.
 *  Lowercases, COLLAPSES hyphenated compounds (`to-do` → `todo`) so
 *  punctuation-only variants of the same hook hash to the same token
 *  set, then strips remaining non-word chars (keeping spaces) and
 *  splits on whitespace. Different policy from `tokenize` above — we
 *  KEEP stopwords here because Jaccard is comparing surface phrasing
 *  (where pronouns + articles are part of the voice fingerprint),
 *  not semantic content overlap. The hyphen-collapse is the post-Y6-
 *  architect fix: bigram-set Jaccard at 0.85 was missing common
 *  near-copies like `to-do list` vs `todo list` because the hyphen
 *  inserted a phantom token boundary; collapsing first means both
 *  variants tokenize identically and trip the gate. */
function jaccardTokens(s: string): string[] {
  const cleaned = s
    .toLowerCase()
    .replace(/(\w)-(\w)/g, "$1$2")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];
  return cleaned.split(/\s+/);
}

function bigramsOf(tokens: readonly string[]): Set<string> {
  const out = new Set<string>();
  if (tokens.length < 2) {
    // Single-token hooks have no bigrams; fall back to the unigram
    // so 1-word vs 1-word identical hooks still register as 1.0.
    if (tokens.length === 1) out.add(tokens[0]!);
    return out;
  }
  for (let i = 0; i < tokens.length - 1; i++) {
    out.add(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return out;
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  if (union === 0) return 0;
  return inter / union;
}

/** PHASE D4 — opaque per-seed identity tag used by the reject-source
 *  telemetry overlay. Kept short (8 hex chars = 32 bits) because it's
 *  log/metric noise, not a cryptographic identifier — collisions are
 *  acceptable for telemetry aggregation. Pure deterministic djb2. */
function djb2Hex8(s: string): string {
  let h = 5381 | 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 8);
}

/** PHASE D4 — which reference pool a near-verbatim Jaccard match was
 *  drawn from. `corpus` = `USER_BLESSED_HOOK_CORPUS` (D3, ~159 hooks);
 *  `style_defs` = `PREMISE_STYLE_DEFS[*].executions[*].example`
 *  (~200 hooks). Surfaced on the validateAntiCopy reject metadata so
 *  downstream telemetry can break `copied_seed_hook` rejections down
 *  by which sub-pool over-rejects in practice — closes the D3 honest
 *  gap. */
export type AntiCopySeedSource = "corpus" | "style_defs";

/** PHASE D4 — full reject-source metadata for a `copied_seed_hook`
 *  rejection. Pure additive overlay — only attached to the reject
 *  result when the gate fires. */
export type AntiCopyMatch = {
  /** Which reference pool the matched seed came from. */
  source: AntiCopySeedSource;
  /** Stable 8-char djb2 hex of the matched seed hook. Used to
   *  identify which specific seed is doing the rejecting without
   *  logging the full hook text (telemetry hygiene). */
  hash: string;
  /** Jaccard similarity in [0, 1] at the time of the match. ≥
   *  `SEED_HOOK_JACCARD_REJECT` (0.85) for the bigram gate, or ≥
   *  `SHORT_HOOK_UNIGRAM_REJECT` (0.6) for the short-hook unigram
   *  fallback. */
  jaccard: number;
  /** Which of the two gates fired: the long-hook bigram gate or
   *  the short-hook unigram fallback. */
  gate: "bigram" | "unigram";
};

type SeedFingerprint = {
  unigrams: Set<string>;
  bigrams: Set<string>;
  tokenCount: number;
  /** PHASE D4 — reject-source telemetry tag. Cheap to carry around
   *  on every seed entry (bounded by the ~359 entry pool size); the
   *  `validateAntiCopyDetailed` path attaches these to its
   *  `AntiCopyMatch` result on a hit. */
  source: AntiCopySeedSource;
  hash: string;
};

let _seedBigramsCache: readonly SeedFingerprint[] | null = null;
function loadSeedHookBigrams(): readonly SeedFingerprint[] {
  if (_seedBigramsCache) return _seedBigramsCache;
  const out: SeedFingerprint[] = [];
  // PHASE D3 — fold USER_BLESSED_HOOK_CORPUS into the seed-bigram
  // set first so the Jaccard 0.85 near-verbatim gate (in
  // validateAntiCopy below) starts treating the user's 159 blessed
  // hooks as voice-training references. Same shape and threshold as
  // PREMISE_STYLE_DEFS examples — generated hooks must stay in
  // voice (low Jaccard) but can't ship near-copies (high Jaccard).
  // PHASE D4 — each entry is now tagged with its source pool +
  // a stable djb2 hash so reject metadata can identify which
  // sub-pool is doing the rejecting. Iteration order preserved
  // (corpus first, then style_defs) so per-source counts are
  // stable across calls.
  for (const e of USER_BLESSED_HOOK_CORPUS) {
    const tokens = jaccardTokens(e.hook);
    out.push({
      unigrams: new Set(tokens),
      bigrams: bigramsOf(tokens),
      tokenCount: tokens.length,
      source: "corpus",
      hash: djb2Hex8(e.hook),
    });
  }
  for (const id of Object.keys(PREMISE_STYLE_DEFS) as PremiseStyleId[]) {
    const def = PREMISE_STYLE_DEFS[id];
    const execs = (def as { executions?: ReadonlyArray<{ example?: string }> })
      .executions;
    if (!execs) continue;
    for (const ex of execs) {
      if (ex.example && typeof ex.example === "string") {
        const tokens = jaccardTokens(ex.example);
        out.push({
          unigrams: new Set(tokens),
          bigrams: bigramsOf(tokens),
          tokenCount: tokens.length,
          source: "style_defs",
          hash: djb2Hex8(ex.example),
        });
      }
    }
  }
  _seedBigramsCache = out;
  return out;
}

/** PHASE Y6 — near-verbatim threshold. ≥0.85 catches "i ghosted my
 *  own to-do list" vs "i ghosted my todo list" (true near-duplicates
 *  — punctuation / synonym swap of the same hook) but allows "i
 *  ghosted my own gym routine" (same scaffold, fresh anchor — the
 *  whole point of voice training). 0.85 ≈ 5 of 6 bigrams identical
 *  for a typical 6-word hook. */
const SEED_HOOK_JACCARD_REJECT = 0.85;
/** Length-aware fallback threshold. For short hooks (≤4 tokens) the
 *  bigram set is so small that a single substitution drops Jaccard
 *  well below 0.85 even though the hook reads as a near-verbatim
 *  copy. Concrete math: a 4-token hook differing from a 4-token
 *  seed by ONE word = 3 shared / 5 union tokens = 0.6 unigram
 *  Jaccard. To actually catch that case (the architect's
 *  "short-hook single substitution" corner) we set the unigram bar
 *  to 0.6. False-positive risk: stays bounded because we only fire
 *  when BOTH sides are short AND share ≥60% of words (and 60%
 *  shared word overlap on a 4-word hook IS near-verbatim by any
 *  reasonable reading — only one token differs). */
const SHORT_HOOK_TOKEN_THRESHOLD = 4;
const SHORT_HOOK_UNIGRAM_REJECT = 0.6;

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
 *
 * PHASE Y6 — SEED-HOOK GATE FLIPPED FROM EXACT TO NEAR-VERBATIM.
 * The original gate hard-rejected any non-`pattern_variation`
 * candidate whose normalized hook fingerprint EXACT-matched a seed
 * hook fingerprint. That made the 150 seed hooks function as an
 * anti-copy blocklist — any voice-trained generator that happened
 * to emit phrasing close to a seed got hard-rejected, even when the
 * scenario (anchor, action) was completely fresh.
 *
 * Y6 reframes the seed corpus as VOICE TRAINING REFERENCE (see
 * `voiceClusters.ts` `seedHookExemplars`). The gate now computes
 * Jaccard similarity on TOKEN BIGRAMS between the candidate hook
 * and each seed hook. Reject when similarity ≥ `SEED_HOOK_JACCARD_REJECT`
 * (0.85). This catches:
 *   - true near-duplicates: "i ghosted my own to-do list" vs
 *     "i ghosted my todo list" → bigrams identical except for one
 *     synonym → Jaccard ≈ 0.83-1.0 → rejected
 * but ALLOWS:
 *   - same scaffold + fresh anchor: "i ghosted my own to-do list"
 *     vs "i ghosted my own gym routine" → 3 of 7 unique bigrams
 *     overlap → Jaccard ≈ 0.43 → ships (this is the whole point
 *     of voice training)
 *   - same hook style + different mechanism: "this is where the
 *     alarm broke me" vs "this is where my life collapsed" →
 *     Jaccard ≈ 0.22 → ships
 *
 * Premise-dup check (`near_duplicate_premise`) is unchanged — that
 * channel handles cross-batch recency, not seed-corpus similarity.
 */
/** PHASE D4 — full reject result with optional reject-source
 *  metadata. Returned from `validateAntiCopyDetailed` so callers
 *  that want telemetry can read which sub-pool matched + the
 *  Jaccard score + a stable seed identity hash, without changing
 *  the legacy `validateAntiCopy` shape (which still returns just
 *  the reason for back-compat with the ideaScorer call site +
 *  the existing test surface). `antiCopyMatch` is ONLY populated
 *  when `reason === "copied_seed_hook"` — `near_duplicate_premise`
 *  and the null pass-through never carry a match. */
export type ValidateAntiCopyResult = {
  reason: ComedyRejectionReason | null;
  antiCopyMatch?: AntiCopyMatch;
};

/** PHASE D4 — internal detailed implementation. Returns the
 *  rejection reason AND, on a `copied_seed_hook` hit, the matched
 *  seed's source / hash / Jaccard / gate. The legacy
 *  `validateAntiCopy` is now a thin wrapper that drops the match
 *  metadata for back-compat. New telemetry-aware call sites should
 *  use this variant instead. */
export function validateAntiCopyDetailed(
  idea: Idea,
  meta: ValidateComedyMeta,
  // Kept for backwards-compat call-site shape — Y6 reads the
  // seed-bigram corpus internally instead. Treat as opaque
  // corpus-identity tag (see `loadSeedHookFingerprints` JSDoc).
  _seedFingerprints: ReadonlySet<string>,
  recentPremises?: ReadonlySet<string>,
): ValidateAntiCopyResult {
  // Pattern-variation candidates ship the curated examples on
  // purpose — exempt from the copy check.
  if (meta.source !== "pattern_variation") {
    const candTokens = jaccardTokens(idea.hook);
    const candUnigrams = new Set(candTokens);
    const candBigrams = bigramsOf(candTokens);
    if (candBigrams.size > 0 || candUnigrams.size > 0) {
      const seeds = loadSeedHookBigrams();
      for (const seed of seeds) {
        // Primary: bigram-set Jaccard (catches typical 6-word
        // near-verbatims like "i ghosted my own to-do list" vs
        // "i ghosted my own todo list" once hyphen-collapse in
        // jaccardTokens normalizes "to-do" → "todo" — both
        // tokenize to the same bigram set and Jaccard = 1.0).
        if (seed.bigrams.size > 0 && candBigrams.size > 0) {
          const j = jaccard(candBigrams, seed.bigrams);
          if (j >= SEED_HOOK_JACCARD_REJECT) {
            return {
              reason: "copied_seed_hook",
              antiCopyMatch: {
                source: seed.source,
                hash: seed.hash,
                jaccard: j,
                gate: "bigram",
              },
            };
          }
        }
        // Length-aware fallback: when EITHER side is short
        // (≤ SHORT_HOOK_TOKEN_THRESHOLD tokens) the bigram set
        // gets so small that a single substitution drops Jaccard
        // well below 0.85 even for an obvious near-copy. Cross-
        // check unigram Jaccard at the slightly lower
        // SHORT_HOOK_UNIGRAM_REJECT bar to catch this corner.
        if (
          (candTokens.length <= SHORT_HOOK_TOKEN_THRESHOLD ||
            seed.tokenCount <= SHORT_HOOK_TOKEN_THRESHOLD) &&
          seed.unigrams.size > 0 &&
          candUnigrams.size > 0
        ) {
          const j = jaccard(candUnigrams, seed.unigrams);
          if (j >= SHORT_HOOK_UNIGRAM_REJECT) {
            return {
              reason: "copied_seed_hook",
              antiCopyMatch: {
                source: seed.source,
                hash: seed.hash,
                jaccard: j,
                gate: "unigram",
              },
            };
          }
        }
      }
    }
  }
  // Premise dup applies to ALL sources because duplicating the same
  // premise across batches collapses the comedic surface area
  // regardless of which layer produced it.
  if (idea.premise && recentPremises && recentPremises.size > 0) {
    const pfp = normalizeHookFingerprint(idea.premise);
    if (pfp.length > 0 && recentPremises.has(pfp)) {
      return { reason: "near_duplicate_premise" };
    }
  }
  return { reason: null };
}

/** Back-compat wrapper. Drops the D4 reject-source metadata and
 *  returns just the reason (or null on pass). New call sites that
 *  want telemetry should use `validateAntiCopyDetailed` directly. */
export function validateAntiCopy(
  idea: Idea,
  meta: ValidateComedyMeta,
  seedFingerprints: ReadonlySet<string>,
  recentPremises?: ReadonlySet<string>,
): ComedyRejectionReason | null {
  return validateAntiCopyDetailed(idea, meta, seedFingerprints, recentPremises)
    .reason;
}

// ---------------------------------------------------------------- //
// Test-only resets                                                  //
// ---------------------------------------------------------------- //

/** Reset the seed-fingerprint + seed-bigram caches. Test-only —
 *  call between tests if `PREMISE_STYLE_DEFS` is mocked. Production
 *  code never calls this (the catalog is immutable at runtime). */
export function _resetSeedFingerprintCacheForTests(): void {
  _seedFingerprintsCache = null;
  _seedBigramsCache = null;
}
