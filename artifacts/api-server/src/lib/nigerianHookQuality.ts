/**
 * PHASE N1-Q — NIGERIAN PACK QUALITY SCORER (additive, ingest-only)
 *
 * Purpose
 * ───────
 * `scoreHookQuality` (lib/hookQuality.ts) is a Western-English punch
 * scorer: its three lexical axes (visceralVerbScore, anthropomorph,
 * concreteness) are syntactically and lexically locked to English.
 * Reviewed Pidgin / light-Pidgin hooks routinely score 22–38 against
 * its 40-point floor even when they pass every safety / coherence
 * validator — see the round-1..round-6 ingest history for the
 * Nigerian Comedy Pack.
 *
 * This module adds a NARROW, ADDITIVE scorer that judges reviewed
 * Nigerian pack entries on six dimensions calibrated for Pidgin /
 * Naija comedy:
 *
 *   1. contradiction / tension          (max 15)
 *   2. Pidgin / Naija naturalness       (max 20, with -5 floor for
 *                                        bland-English-with-anchor-
 *                                        swap hooks)
 *   3. anchor relevance                 (max 10)
 *   4. filmable scenario pairing        (max 10)
 *   5. concise hook rhythm              (max 20 — same brevity math
 *                                        as `scoreHookQuality`)
 *   6. visceral verb signal             (max 25 — English HIGH/MID
 *                                        tiers PLUS a curated
 *                                        Pidgin punch-verb set)
 *
 *   Hard reject (returns 0): mocking-spelling pattern hit on hook,
 *   whatToShow, or caption (mirrors `assertNigerianPackIntegrity`).
 *
 * Total range: 0..100 raw. The published `HOOK_QUALITY_FLOOR = 40`
 * is unchanged.
 *
 * Scope contract (HARD)
 * ─────────────────────
 * This scorer is NEVER called from runtime generation paths. It is
 * imported only by:
 *
 *   • `qa/buildApprovedNigerianPack.ts`  (ingest)
 *   • `qa/nigerianPackRewriteWorksheet.ts`  (ingest worksheet)
 *
 * `scoreHookQuality` continues to be the sole scorer used by:
 *
 *   • `coreCandidateGenerator.ts`
 *   • `patternIdeator.ts`
 *   • `hybridIdeator.ts`
 *   • `ideaScorer.ts`
 *   • Claude fallback
 *
 * Cross-region behavior is therefore byte-identical:
 *
 *   • western / india / philippines / undefined-region: this module
 *     is never imported on any active code path → no behavior change
 *   • nigeria + languageStyle ∈ {null, "clean"}: `scoreHookQuality`
 *     remains the only scorer that runs → no behavior change
 *
 * The scorer also enforces, for every call, the per-entry safety
 * preconditions documented in `nigerianHookPack.ts`:
 *
 *   • `entry.reviewedBy` non-empty and not the PENDING_NATIVE_REVIEW
 *     sentinel  → score = 0 if violated
 *   • `entry.pidginLevel` ∈ {"light_pidgin", "pidgin"}  → 0 if not
 *   • no `PIDGIN_MOCKING_PATTERNS` hit on hook/whatToShow/caption  → 0
 *
 * These per-entry checks DO NOT replace any existing validator —
 * they MIRROR them, so a misuse can never leak a fake entry past
 * the scorer even if the caller skipped validateRow.
 *
 * Trust model (reference-identity / opaque-token guard)
 * ─────────────────────────────────────────────────────
 * The scorer accepts a `ScoringContext` with two valid shapes:
 *
 *   • { kind: "pool", pool }
 *       Used at runtime (when the pack ever wires up). `pool` MUST
 *       be `NIGERIAN_HOOK_PACK` by reference identity, OR the
 *       APPROVED candidates pool registered via
 *       `registerApprovedPoolReference` (called once at module load
 *       of the auto-generated `nigerianHookPackApproved.ts`).
 *
 *   • { kind: "ingest", key }
 *       Used by the two QA scripts that BUILD the approved-candidate
 *       list. `key` MUST be the value returned by
 *       `getNigerianHookQualityIngestKey()`. The key is a private
 *       module-scoped Symbol — an architectural test verifies that
 *       only the two QA scripts (and the test file) import this
 *       function.
 *
 * Any other context shape, or a context with the wrong pool / key,
 * throws an Error. This makes it impossible for a generic generation
 * caller to score a synthetic entry through this module by accident.
 *
 * NO Claude. NO DB. Pure / deterministic. Same discipline as
 * `scoreHookQuality`, `voiceClusters.ts`, `nigerianHookPack.ts`.
 */

import {
  NIGERIAN_HOOK_PACK,
  PIDGIN_MOCKING_PATTERNS,
  type NigerianPackEntry,
} from "./nigerianHookPack.js";

// ──────────────────────────────────────────────────────────────── //
// Trust gate — pool reference identity + opaque ingest key.
// ──────────────────────────────────────────────────────────────── //

const INGEST_KEY: unique symbol = Symbol("nigerianHookQuality.ingest");

/** Returns the opaque ingest key. Calling this binds the caller to
 *  the architectural test that limits import surface to the two
 *  approved QA scripts (+ this module's own test). */
export function getNigerianHookQualityIngestKey(): symbol {
  return INGEST_KEY;
}

let APPROVED_POOL_REF: object | undefined;

/** Registered exactly once at module load of the auto-generated
 *  `nigerianHookPackApproved.ts` so the runtime "pool" context can
 *  also accept the APPROVED pool by reference identity. */
export function registerApprovedPoolReference(
  ref: readonly NigerianPackEntry[],
): void {
  APPROVED_POOL_REF = ref as unknown as object;
}

export type ScoringContext =
  | { readonly kind: "pool"; readonly pool: readonly NigerianPackEntry[] }
  | { readonly kind: "ingest"; readonly key: symbol };

function assertTrustedContext(ctx: ScoringContext): void {
  if (ctx.kind === "pool") {
    const ok =
      (ctx.pool as unknown as object) === NIGERIAN_HOOK_PACK ||
      (APPROVED_POOL_REF !== undefined &&
        (ctx.pool as unknown as object) === APPROVED_POOL_REF);
    if (!ok) {
      throw new Error(
        "[nigerianHookQuality] pool reference must be NIGERIAN_HOOK_PACK " +
          "or the registered APPROVED_NIGERIAN_PROMOTION_CANDIDATES; got an " +
          "unrecognized pool. The scorer refuses to grade entries from an " +
          "untrusted source.",
      );
    }
    return;
  }
  if (ctx.kind === "ingest") {
    if (ctx.key !== INGEST_KEY) {
      throw new Error(
        "[nigerianHookQuality] invalid ingest key. Only " +
          "buildApprovedNigerianPack.ts and nigerianPackRewriteWorksheet.ts " +
          "may construct an ingest context.",
      );
    }
    return;
  }
  // Defensive — exhaustiveness is enforced by the discriminated union
  // at compile time, but keep the runtime guard for hand-rolled callers.
  throw new Error(
    "[nigerianHookQuality] invalid ScoringContext: unknown 'kind'.",
  );
}

// ──────────────────────────────────────────────────────────────── //
// Per-entry safety preconditions (mirror assertNigerianPackIntegrity).
// ──────────────────────────────────────────────────────────────── //

function failsSafetyChecks(entry: NigerianPackEntry): boolean {
  if (!entry.reviewedBy || entry.reviewedBy.trim().length === 0) return true;
  if (entry.reviewedBy.trim() === "PENDING_NATIVE_REVIEW") return true;
  if (
    entry.pidginLevel !== "light_pidgin" &&
    entry.pidginLevel !== "pidgin"
  ) {
    return true;
  }
  for (const re of PIDGIN_MOCKING_PATTERNS) {
    if (re.test(entry.hook)) return true;
    if (re.test(entry.whatToShow)) return true;
    if (re.test(entry.caption)) return true;
  }
  return false;
}

// ──────────────────────────────────────────────────────────────── //
// Lexicons.
//
// Frozen module-scope sets — same discipline as VERB_HIGH / VERB_MID
// in hookQuality.ts. The Pidgin punch-verb set was assembled from
// the reviewed-pack ingest history (rounds 1–6) and the curated
// Pidgin / Naija lexicons in NIGERIA_PROFILE / regionAnchorCatalog.
// ──────────────────────────────────────────────────────────────── //

/** Pidgin / Naija discourse markers and aspect particles. Presence
 *  of these tokens is a strong signal of authentic register; absence
 *  on a hook tagged `light_pidgin`/`pidgin` is a signal that the
 *  rewrite is bland English with an anchor swap. */
const PIDGIN_MARKERS: ReadonlySet<string> = new Set([
  "don",
  "dey",
  "wey",
  "na",
  "sef",
  "oya",
  "comot",
  "japa",
  "abi",
  "sha",
  "am",
  "naa",
  "ehn",
  "abeg",
  "wahala",
  "biko",
  "chai",
  "ehen",
  "shey",
  "fit",
  "go",
  "wan",
  "wetin",
  "shebi",
]);

/** Pidgin tension / aspect phrasings — multi-token, regex-shaped.
 *  These are the Pidgin equivalents of the English contradiction
 *  markers (`but`, `instead`, `anymore`). */
const PIDGIN_TENSION_PATTERNS: readonly RegExp[] = [
  /\bdon\s+(?:turn|become|finish|vanish|expose|cancel|disgrace|reach|come|carry|enter|hijack|drag|scatter|humble|catch)\b/,
  /\bdey\s+\w+\b/,
  /\bwey\s+\w+\b/,
  /\bna\s+(?:so|the|my|him|her)\b/,
  /\bcome\s+\w+\b/,
];

/** Contrast / consequence nouns — the Pidgin equivalents of the
 *  English DRAMATIC_NOUNS list, plus generic Naija comedic stakes. */
const PIDGIN_CONTRAST_NOUNS: RegExp =
  /\b(?:disgrace|shame|panic|embarrassment|confession|courage|confidence|robbery|evidence|witness|peace|chaos|trouble|wahala|prayer|testimony|sorrow|tears)\b/;

/** English contradiction markers — same set as hookQuality.ts.
 *  Reused locally so this module is import-isolated (no dependency
 *  on the English scorer's internals). */
const ENGLISH_CONTRADICTION_PATTERNS: readonly RegExp[] = [
  /→/,
  /—/,
  /\bbut\b/,
  /\binstead\b/,
  /\banymore\b/,
  /\bagain\b/,
  /\bstill\b/,
  /\d+/,
  /\.\s+[a-z]/,
  /\.\s*$/,
];

/** Pidgin / Naija punch verbs (HIGH tier — worth 25). Curated from
 *  reviewed pack ingestion + the regional voice cluster catalogues.
 *  Some overlap with English VERB_HIGH (`expose`, `ghost`, `lie`,
 *  `betray`, `mock`, `judge`) is intentional — this is a stand-alone
 *  table. */
const PIDGIN_PUNCH_HIGH: ReadonlySet<string> = new Set([
  "disgrace",
  "expose",
  "scatter",
  "humble",
  "punish",
  "slap",
  "hijack",
  "ambush",
  "betray",
  "ghost",
  "lie",
  "fake",
  "ditch",
  "judge",
  "mock",
  "sue",
  "dump",
  "demolish",
  "sabotage",
  "haunt",
  "stalk",
  "interrogate",
  "blackmail",
  "bribe",
  "seduce",
  "weaponize",
  "gaslight",
  "spiral",
  "kill",
  "japa",
  "comot",
  "rob",
  "robbery",
  "fight",
  "drag",
  "carry",
  "bury",
  "rescue",
  "confess",
  "vanish",
  "collapse",
  "cancel",
  "demote",
  "reject",
]);

/** MID tier — worth 15. */
const PIDGIN_PUNCH_MID: ReadonlySet<string> = new Set([
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
  "drown",
  "burn",
  "sink",
  "shatter",
  "crack",
  "drain",
  "rot",
  "save",
  "protect",
  "fail",
  "attack",
  "drag",
  "save",
  "leave",
  "save",
  "humble",
  "block",
]);

/** LOW tier — worth 7. (Slightly higher than English LOW=8 to keep
 *  scoring continuous; kept as 7 so it doesn't dominate.) */
const PIDGIN_PUNCH_LOW: ReadonlySet<string> = new Set([
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
  "see",
  "go",
  "turn",
  "enter",
]);

/** Cinematic verbs in `whatToShow` — proxy for "the scene knows
 *  what to do with the anchor". */
const CINEMATIC_VERBS: ReadonlySet<string> = new Set([
  "show",
  "shows",
  "showing",
  "pause",
  "pauses",
  "cut",
  "cuts",
  "point",
  "points",
  "tap",
  "taps",
  "swipe",
  "swipes",
  "open",
  "opens",
  "flip",
  "flips",
  "reveal",
  "reveals",
  "hold",
  "holds",
  "look",
  "looks",
  "looking",
  "record",
  "records",
  "film",
  "films",
  "play",
  "plays",
  "playing",
  "text",
  "texts",
  "tilt",
  "tilts",
  "zoom",
  "zooms",
  "scroll",
  "scrolls",
  "type",
  "types",
  "press",
  "presses",
]);

/** English determiner / pronoun openers. A hook tagged Pidgin that
 *  starts with one of these is a candidate for the bland-English
 *  penalty (still gets the penalty waived if it carries Pidgin
 *  markers downstream). */
const ENGLISH_DETERMINER_OPENERS: ReadonlySet<string> = new Set([
  "the",
  "a",
  "an",
  "i",
  "my",
  "our",
  "we",
  "you",
  "your",
  "they",
  "their",
  "this",
  "that",
  "these",
  "those",
]);

// ──────────────────────────────────────────────────────────────── //
// Component scoring functions.
// ──────────────────────────────────────────────────────────────── //

function tokenize(s: string): string[] {
  return s.toLowerCase().match(/[a-z][a-z']*/g) ?? [];
}

function visceralScore(hookLower: string): number {
  const toks = tokenize(hookLower);
  let best: "high" | "mid" | "low" | "none" = "none";
  const rank = { none: 0, low: 1, mid: 2, high: 3 } as const;
  for (const t of toks) {
    let cls: "high" | "mid" | "low" | "none" = "none";
    if (PIDGIN_PUNCH_HIGH.has(t)) cls = "high";
    else if (PIDGIN_PUNCH_HIGH.has(stem(t))) cls = "high";
    else if (PIDGIN_PUNCH_MID.has(t) || PIDGIN_PUNCH_MID.has(stem(t))) {
      cls = "mid";
    } else if (PIDGIN_PUNCH_LOW.has(t) || PIDGIN_PUNCH_LOW.has(stem(t))) {
      cls = "low";
    }
    if (rank[cls] > rank[best]) best = cls;
    if (best === "high") break;
  }
  switch (best) {
    case "high":
      return 25;
    case "mid":
      return 15;
    case "low":
      return 7;
    default:
      return 5;
  }
}

/** Tiny English-suffix stemmer (subset of hookQuality.ts's stemVerb).
 *  Only used so morphological forms of punch verbs (`disgraced`,
 *  `disgracing`, `exposes`) hit the same tier as the bare stem. */
function stem(tok: string): string {
  if (tok.length <= 3) return tok;
  if (tok.endsWith("ied") && tok.length > 4) return tok.slice(0, -3) + "y";
  if (tok.endsWith("ing") && tok.length > 5) {
    const s = tok.slice(0, -3);
    if (PIDGIN_PUNCH_HIGH.has(s + "e") || PIDGIN_PUNCH_MID.has(s + "e")) {
      return s + "e";
    }
    return s;
  }
  if (tok.endsWith("ed") && tok.length > 4) {
    const s = tok.slice(0, -2);
    if (
      PIDGIN_PUNCH_HIGH.has(s) ||
      PIDGIN_PUNCH_MID.has(s) ||
      PIDGIN_PUNCH_LOW.has(s)
    ) {
      return s;
    }
    if (PIDGIN_PUNCH_HIGH.has(s + "e") || PIDGIN_PUNCH_MID.has(s + "e")) {
      return s + "e";
    }
    return s;
  }
  if (tok.endsWith("s") && tok.length > 3 && !tok.endsWith("ss")) {
    return tok.slice(0, -1);
  }
  return tok;
}

function pidginNaturalnessScore(
  hookLower: string,
  pidginLevel: NigerianPackEntry["pidginLevel"],
): number {
  const toks = tokenize(hookLower);
  let markers = 0;
  for (const t of toks) {
    if (PIDGIN_MARKERS.has(t)) markers++;
  }
  let score = Math.min(markers * 4, 12);

  // Heavy-register bonus.
  if (pidginLevel === "pidgin" && markers >= 2) score += 4;

  // Authentic-Pidgin syntactic structure bonus: Pidgin tension
  // pattern (`don turn`, `dey + verb`, `wey + clause`, `na so`)
  // present in the hook.
  let hasPidginPattern = false;
  for (const re of PIDGIN_TENSION_PATTERNS) {
    if (re.test(hookLower)) {
      hasPidginPattern = true;
      break;
    }
  }
  if (hasPidginPattern) score += 4;

  // Bland-English-with-anchor-swap penalty: zero markers AND zero
  // Pidgin syntactic pattern AND opens with an English determiner /
  // pronoun. Only fires when ALL three conditions hold so authentic
  // zero-determiner Pidgin (e.g. "generator drag sleep") is NOT
  // penalised even if it scores zero on the marker axis.
  if (markers === 0 && !hasPidginPattern) {
    const opener = toks[0];
    if (opener !== undefined && ENGLISH_DETERMINER_OPENERS.has(opener)) {
      score -= 5;
    }
  }

  return Math.max(-5, Math.min(20, score));
}

function contradictionScore(hookLower: string): number {
  let score = 0;

  for (const re of ENGLISH_CONTRADICTION_PATTERNS) {
    if (re.test(hookLower)) {
      score += 6;
      break;
    }
  }
  for (const re of PIDGIN_TENSION_PATTERNS) {
    if (re.test(hookLower)) {
      score += 6;
      break;
    }
  }
  if (PIDGIN_CONTRAST_NOUNS.test(hookLower)) score += 6;

  // Two-half setup/payoff bonus: comma OR em-dash splits the hook
  // into roughly balanced halves.
  if (/,|—/.test(hookLower)) {
    score += 3;
  }

  return Math.min(15, score);
}

function anchorRelevanceScore(hookLower: string, anchor: string): number {
  let score = 0;
  if (hookLower.includes(anchor)) score += 5;
  // Carrying-the-punch position — anchor in the first 4 tokens.
  const toks = tokenize(hookLower);
  const earlyZone = toks.slice(0, 4).join(" ");
  if (earlyZone.includes(anchor)) score += 5;
  return Math.min(10, score);
}

function filmableScenarioScore(
  whatToShowLower: string,
  anchor: string,
): number {
  let score = 0;
  if (whatToShowLower.includes(anchor)) score += 5;
  const toks = tokenize(whatToShowLower);
  for (const t of toks) {
    if (CINEMATIC_VERBS.has(t)) {
      score += 5;
      break;
    }
  }
  return Math.min(10, score);
}

function brevityScore(hookLower: string): number {
  const words = hookLower.trim().split(/\s+/).filter(Boolean).length;
  if (words >= 5 && words <= 7) return 20;
  if (words === 4 || words === 8) return 17;
  if (words === 3 || words === 9) return 13;
  if (words === 2 || words === 10) return 9;
  return 5;
}

// ──────────────────────────────────────────────────────────────── //
// Public API.
// ──────────────────────────────────────────────────────────────── //

export type NigerianHookQualityBreakdown = {
  readonly total: number;
  readonly visceral: number;
  readonly naturalness: number;
  readonly contradiction: number;
  readonly anchorRelevance: number;
  readonly filmable: number;
  readonly brevity: number;
  readonly safetyFail: boolean;
};

/** Score a reviewed Nigerian pack entry on the additive scale.
 *  Returns 0 if any safety precondition fails OR the trust gate
 *  rejects the context. The 0..100 raw score is returned otherwise.
 *  Use `scoreNigerianPackEntryDetailed` for the per-component
 *  breakdown (used by tests + ingest audit logs). */
export function scoreNigerianPackEntry(
  entry: NigerianPackEntry,
  ctx: ScoringContext,
): number {
  return scoreNigerianPackEntryDetailed(entry, ctx).total;
}

export function scoreNigerianPackEntryDetailed(
  entry: NigerianPackEntry,
  ctx: ScoringContext,
): NigerianHookQualityBreakdown {
  assertTrustedContext(ctx);

  if (failsSafetyChecks(entry)) {
    return {
      total: 0,
      visceral: 0,
      naturalness: 0,
      contradiction: 0,
      anchorRelevance: 0,
      filmable: 0,
      brevity: 0,
      safetyFail: true,
    };
  }

  const hookLower = entry.hook.toLowerCase();
  const whatToShowLower = entry.whatToShow.toLowerCase();
  const anchor = entry.anchor.trim().toLowerCase();

  const visceral = visceralScore(hookLower);
  const naturalness = pidginNaturalnessScore(hookLower, entry.pidginLevel);
  const contradiction = contradictionScore(hookLower);
  const anchorRelevance = anchorRelevanceScore(hookLower, anchor);
  const filmable = filmableScenarioScore(whatToShowLower, anchor);
  const brevity = brevityScore(hookLower);

  const total =
    visceral + naturalness + contradiction + anchorRelevance + filmable +
    brevity;

  return {
    total,
    visceral,
    naturalness,
    contradiction,
    anchorRelevance,
    filmable,
    brevity,
    safetyFail: false,
  };
}
