// PHASE N1-CORE-CLEAN-GUARD — narrow safety guard for the
// `core_native` (catalog/voice-cluster) hook authoring path when:
//
//   region        === "nigeria"
//   languageStyle ∈  { "clean", null, undefined }
//
// Background (audit BI 2026-05-09 — `.local/N1_CORE_CLEAN_NULL_AUDIT.md`):
// the `high_energy_rant` voice cluster in `voiceClusters.ts` ships
// templates such as `i ${actionPast} the ${anchor} AGAIN. AGAIN!!!`
// that render verbatim once anchor + verb are filled. The Western
// generic-template demotion in `westernHookQuality.ts`
// (`repeated_emphatic_again` family) WOULD catch these strings, but
// `canApplyWesternHookAdjustments` returns false for
// `region === "nigeria"`. The Nigerian style penalty in
// `nigerianStylePenalty.ts` only applies to pidgin / light_pidgin.
// Net: NG clean / null cohorts have no demotion or rejection signal
// for the loud-exclamation template family. This guard closes that
// gap as a hard reject, mirroring the inverse of
// `canApplyNigerianStylePenalty` for the opposite style range.
//
// Scope:
//   - applies ONLY at the catalog `core_native` scoring site in
//     `coreCandidateGenerator.ts` (the pack scoring site uses the
//     pidgin/light_pidgin language style, where the guard is gated
//     off by the activation predicate below).
//   - never runs for `region ∈ {undefined, "western", "india",
//     "philippines"}`.
//   - never runs for `languageStyle ∈ {"pidgin", "light_pidgin"}`.
//   - never modifies a candidate; only signals "drop this one".
//
// Composition note: Western behavior is unchanged — the existing
// `WESTERN_GENERIC_TEMPLATE_PATTERNS` continue to demote (not reject)
// for Western. The two layers do not interfere because their gates
// are mutually exclusive on `region`.

import type { LanguageStyle } from "./tasteCalibration.js";

// Region is a string union in `regionProfile.ts`; importing the type
// would create a wider import surface than needed. Accept any string
// and gate on the literal "nigeria" — matches the pattern used by
// `canApplyNigerianStylePenalty` and `canApplyWesternHookAdjustments`.
export interface NigerianCleanCoreGuardInput {
  readonly region?: string | null;
  readonly languageStyle?: LanguageStyle | null;
}

/**
 * Activation gate for the core-native clean/null guard. Returns true
 * iff the cohort is the inverse of the Nigerian-style-penalty cohort:
 *
 *   region === "nigeria" AND languageStyle ∈ {clean, null, undefined}
 *
 * Together with `canApplyNigerianStylePenalty` this covers the entire
 * Nigerian style space without overlap.
 */
export function canApplyNigerianCleanCoreGuard(
  input: NigerianCleanCoreGuardInput,
): boolean {
  if (input.region !== "nigeria") return false;
  const style = input.languageStyle;
  if (style === "pidgin" || style === "light_pidgin") return false;
  // style ∈ {"clean", null, undefined} → guard is active.
  return true;
}

// Pattern set — narrowly scoped to loud, generic shouty-template
// shapes. NOT a pidgin-marker blocklist: this guard intentionally
// does NOT demote `dey`, `don`, `abeg`, `wahala`, etc. (those are
// Nigerian voice markers that should remain available — the audit
// recommended only blocking shouty/exclamation-pile artifacts).
//
// Each pattern is anchored on a deterministic shouty signal so a
// well-formed clean-English Nigerian hook ("light disappear and
// power bank judge me", "the okada driver overtook a bus") will not
// match.
const REPEATED_EMPHATIC_AGAIN: RegExp = /\bAGAIN[.!]?\s+AGAIN[!.]*/;

const I_CANNOT_KEEP_BUT_I_WILL: RegExp =
  /\bi\s+(?:cannot|can't|can not)\s+keep\b[\s\S]*?\bBUT\s+I\s+WILL\b/i;

const I_CANNOT_STOP_DOUBLED: RegExp = /\bi\s+CANNOT\s+stop\b/;

const ANCHOR_TRIPLE_REPEAT_SHOUT: RegExp =
  /\bthe\s+\w+[.!]?\s+the\s+\w+!!\s+AGAIN\b/i;

const ANCHOR_BROKE_ME_SHOUT: RegExp = /\b\w+\s+broke\s+me!!/i;

const WHY_DOES_ANCHOR_KEEP_VERBING_ITSELF: RegExp =
  /\bWHY\s+does\s+(?:the|my)\s+\w+\s+keep\s+\w+ing\s+itself\b/;

const SOMEONE_EXPLAIN_NOW_SHOUT: RegExp =
  /\bsomeone\s+explain\s+(?:the|my)\s+\w+\s+to\s+me[.!]\s+NOW\b/i;

const I_SAID_BUT_NO_SHOUT: RegExp =
  /\bi\s+SAID\s+i'?d\s+\w+\s+the\s+\w+\s+but\s+NO\b/i;

const MY_OWN_ANCHOR_BACK_SHOUT: RegExp = /\bmy\s+own\s+\w+\s+is\s+\w+ing\s+me\s+back!!/i;

// Exclamation / question mark piles (3+ in a row), anywhere.
const PUNCTUATION_PILE: RegExp = /[!?]{3,}/;

// Repeated all-caps token within a short window:
//   "WAIT i did it AGAIN are you kidding me"  → caught by AGAIN family above
//   "why am i like this WHY am i LIKE THIS"   → caught here
// Two or more characters required to avoid false-firing on "I" or "A".
const REPEATED_ALL_CAPS_TOKEN: RegExp =
  /\b([A-Z]{2,})\b[\s\S]{0,40}\b\1\b/;

// Mid-sentence shouted contradictions exposed by the cluster: a
// short-window all-caps contrast word ("AGAIN", "BUT", "STILL",
// "NOW", "WHY", "WAIT") preceded by a comma/period and lowercase
// text. Tightened so a normal capitalized acronym (NEPA in a
// sentence) does not match — requires preceding punctuation + space.
const SHOUTED_CONTRADICTION: RegExp =
  /[.,]\s+(?:AGAIN|BUT|STILL|NOW|WHY|WAIT)\b/;

const BLOCKED_PATTERNS: readonly { readonly id: string; readonly re: RegExp }[] =
  [
    { id: "repeated_emphatic_again", re: REPEATED_EMPHATIC_AGAIN },
    { id: "i_cannot_keep_but_i_will", re: I_CANNOT_KEEP_BUT_I_WILL },
    { id: "i_cannot_stop_doubled", re: I_CANNOT_STOP_DOUBLED },
    { id: "anchor_triple_repeat_shout", re: ANCHOR_TRIPLE_REPEAT_SHOUT },
    { id: "anchor_broke_me_shout", re: ANCHOR_BROKE_ME_SHOUT },
    {
      id: "why_does_anchor_keep_verbing_itself",
      re: WHY_DOES_ANCHOR_KEEP_VERBING_ITSELF,
    },
    { id: "someone_explain_now_shout", re: SOMEONE_EXPLAIN_NOW_SHOUT },
    { id: "i_said_but_no_shout", re: I_SAID_BUT_NO_SHOUT },
    { id: "my_own_anchor_back_shout", re: MY_OWN_ANCHOR_BACK_SHOUT },
    { id: "punctuation_pile", re: PUNCTUATION_PILE },
    { id: "repeated_all_caps_token", re: REPEATED_ALL_CAPS_TOKEN },
    { id: "shouted_contradiction", re: SHOUTED_CONTRADICTION },
  ];

/**
 * Returns the matched pattern id if `hook` should be hard-rejected
 * for an active NG clean/null core_native cohort, else null.
 *
 * Caller MUST also have called `canApplyNigerianCleanCoreGuard` and
 * received `true` — this helper does not re-check the cohort gate
 * (cheap, but kept separate so the gate is colocated with the call
 * site and can be unit-tested independently).
 */
export function classifyNigerianCleanCoreHookBlock(
  hook: string,
): string | null {
  if (!hook) return null;
  for (const p of BLOCKED_PATTERNS) {
    if (p.re.test(hook)) return p.id;
  }
  return null;
}

/** Boolean convenience wrapper around `classifyNigerianCleanCoreHookBlock`. */
export function isNigerianCleanCoreHookBlocked(hook: string): boolean {
  return classifyNigerianCleanCoreHookBlock(hook) !== null;
}

/** Test-only export — list of pattern ids in declaration order. */
export const NIGERIAN_CLEAN_CORE_GUARD_PATTERN_IDS: readonly string[] =
  BLOCKED_PATTERNS.map((p) => p.id);
