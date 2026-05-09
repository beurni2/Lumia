// PHASE N1-CLEAN-CORE-INFRA — infrastructure-only shell for the
// Nigerian clean-English `core_native` mini-catalog.
//
// Activation:
//   region        === "nigeria"
//   languageStyle === "clean"
//
// Mutually exclusive with the existing approved Nigerian pack
// (`nigerianHookPackApproved.ts`), which is gated on
// `languageStyle ∈ {"pidgin", "light_pidgin"}`. Nothing in this
// module touches that pack, its author, its slot reservation, its
// per-creator memory column, the rewrite YAML, or the reviewer
// worksheet. Western / India / Philippines are excluded by region.
// `null` / `undefined` languageStyle is excluded — that surface
// remains the safety domain of `nigerianCleanCoreGuard.ts`.
//
// This file ships with `NIGERIAN_CLEAN_CORE_ENTRIES = []`. The 30
// clean-English Nigerian entries will be hand-authored separately
// and provided as an exact apply packet. Until then the wiring
// branch in `coreCandidateGenerator.ts` is inert (length-gated).
//
// No DB column, no migration, no codegen, no creative production
// copy authored here. Validators below exist only to protect the
// future hand-authored entries when they arrive.

import type { LanguageStyle } from "./tasteCalibration.js";
import { isNigerianCleanCoreHookBlocked } from "./nigerianCleanCoreGuard.js";

// Region is a string union in `@workspace/lumina-trends`; importing
// the type would widen the import surface unnecessarily. Match the
// pattern used by `nigerianCleanCoreGuard.ts` and accept any string.

// ---------------------------------------------------------------- //
// Types                                                             //
// ---------------------------------------------------------------- //

export type NigerianCleanCoreEntry = {
  readonly id: string;
  readonly draftId: string;
  readonly anchor: string;
  readonly hook: string;
  readonly whatToShow: string;
  readonly howToFilm: string;
  readonly caption: string;
  readonly premiseFamily: string;
  readonly voiceTone: string;
  readonly reviewedBy: string;
};

// ---------------------------------------------------------------- //
// Production catalog — INTENTIONALLY EMPTY                          //
// ---------------------------------------------------------------- //
//
// Hand-authored entries land here as a separate apply packet. Do
// NOT add fixtures, samples, or LLM-generated rows. Keep this array
// empty until the user supplies a reviewed batch.

export const NIGERIAN_CLEAN_CORE_ENTRIES: readonly NigerianCleanCoreEntry[] =
  Object.freeze([]);

// ---------------------------------------------------------------- //
// Activation gate                                                   //
// ---------------------------------------------------------------- //

export function canActivateNigerianCleanCorePack(args: {
  region?: string | null;
  languageStyle?: LanguageStyle | null;
}): boolean {
  return args.region === "nigeria" && args.languageStyle === "clean";
}

// ---------------------------------------------------------------- //
// Validator helpers — protect future hand-authored entries          //
// ---------------------------------------------------------------- //
//
// Conservative until proven otherwise. The user can broaden these
// gates explicitly per-token (e.g., approve `oga` for clean
// Nigerian English) once entries land and editorial review surfaces
// concrete tradeoffs.

/** Pidgin grammar markers banned from clean-style entries. */
export const NIGERIAN_CLEAN_CORE_BANNED_PIDGIN_MARKERS: readonly string[] =
  Object.freeze([
    "dey",
    "don",
    "abeg",
    "wahala",
    "wetin",
    "sha",
    "abi",
    "oga",
  ]);

/** Lazy stereotype / punching-down tokens banned from clean entries. */
export const NIGERIAN_CLEAN_CORE_BANNED_STEREOTYPE_TOKENS: readonly string[] =
  Object.freeze([
    "nepa",
    "village people",
    "my enemies",
    "yahoo boy",
    "419",
    "jollof",
    "buka",
  ]);

/** Old filming boilerplate phrasings banned from clean entries. */
export const NIGERIAN_CLEAN_CORE_BANNED_FILMING_BOILERPLATE: readonly string[] =
  Object.freeze([
    "phone-level lock-off",
    "desk-height lock-off",
    "counter-level lock-off",
    "couch-level handheld",
    "bed-level handheld",
    "door-side handheld",
    "mirror lock-off",
    "soft daylight",
    "one take",
    "keep the",
  ]);

export type NigerianCleanCoreEntryValidationFailure =
  | "missing_id"
  | "missing_draft_id"
  | "missing_anchor"
  | "missing_hook"
  | "missing_what_to_show"
  | "missing_how_to_film"
  | "missing_caption"
  | "missing_premise_family"
  | "missing_voice_tone"
  | "missing_reviewed_by"
  | "anchor_not_in_hook"
  | "anchor_not_in_what_to_show"
  | "pidgin_marker_in_hook_or_what_to_show"
  | "stereotype_token_in_hook_or_what_to_show_or_caption"
  | "filming_boilerplate_in_how_to_film"
  | "shouty_template_blocked_by_clean_core_guard";

/** Tokenize on word boundaries, case-insensitive, for marker scans. */
function tokenize(text: string): readonly string[] {
  return text.toLowerCase().match(/\b[a-z0-9]+\b/g) ?? [];
}

/** Returns true iff every banned-marker token appears as a discrete
 *  word in `text` (case-insensitive). Whitespace-bearing markers
 *  (`village people`) are matched as substrings on the lowercased
 *  text. */
function containsAnyBannedMarker(
  text: string,
  banned: readonly string[],
): string | null {
  const lower = text.toLowerCase();
  const tokens = new Set(tokenize(lower));
  for (const marker of banned) {
    if (marker.includes(" ")) {
      if (lower.includes(marker)) return marker;
    } else {
      if (tokens.has(marker)) return marker;
    }
  }
  return null;
}

/** Returns true iff `anchor` (case-insensitive) appears as a
 *  substring of `text`. The catalog already enforces
 *  anchor-in-hook + anchor-in-whatToShow elsewhere; this is the
 *  same predicate at the per-entry boundary. */
function containsAnchor(text: string, anchor: string): boolean {
  return text.toLowerCase().includes(anchor.toLowerCase());
}

export function classifyNigerianCleanCoreEntryFailure(
  entry: NigerianCleanCoreEntry,
): NigerianCleanCoreEntryValidationFailure | null {
  if (!entry.id) return "missing_id";
  if (!entry.draftId) return "missing_draft_id";
  if (!entry.anchor) return "missing_anchor";
  if (!entry.hook) return "missing_hook";
  if (!entry.whatToShow) return "missing_what_to_show";
  if (!entry.howToFilm) return "missing_how_to_film";
  if (!entry.caption) return "missing_caption";
  if (!entry.premiseFamily) return "missing_premise_family";
  if (!entry.voiceTone) return "missing_voice_tone";
  if (!entry.reviewedBy) return "missing_reviewed_by";

  if (!containsAnchor(entry.hook, entry.anchor)) {
    return "anchor_not_in_hook";
  }
  if (!containsAnchor(entry.whatToShow, entry.anchor)) {
    return "anchor_not_in_what_to_show";
  }

  const pidginScan = `${entry.hook}\n${entry.whatToShow}`;
  if (
    containsAnyBannedMarker(
      pidginScan,
      NIGERIAN_CLEAN_CORE_BANNED_PIDGIN_MARKERS,
    )
  ) {
    return "pidgin_marker_in_hook_or_what_to_show";
  }

  const stereotypeScan = `${entry.hook}\n${entry.whatToShow}\n${entry.caption}`;
  if (
    containsAnyBannedMarker(
      stereotypeScan,
      NIGERIAN_CLEAN_CORE_BANNED_STEREOTYPE_TOKENS,
    )
  ) {
    return "stereotype_token_in_hook_or_what_to_show_or_caption";
  }

  if (
    containsAnyBannedMarker(
      entry.howToFilm,
      NIGERIAN_CLEAN_CORE_BANNED_FILMING_BOILERPLATE,
    )
  ) {
    return "filming_boilerplate_in_how_to_film";
  }

  if (isNigerianCleanCoreHookBlocked(entry.hook)) {
    return "shouty_template_blocked_by_clean_core_guard";
  }

  return null;
}

export function isValidNigerianCleanCoreEntry(
  entry: NigerianCleanCoreEntry,
): boolean {
  return classifyNigerianCleanCoreEntryFailure(entry) === null;
}

// ---------------------------------------------------------------- //
// Boot-time invariant — catalog stays valid                         //
// ---------------------------------------------------------------- //
//
// Intentionally light: with the empty production array the loop is
// a no-op. When entries land, any malformed row throws at module
// load — caught by the test suite and any boot path.

for (const entry of NIGERIAN_CLEAN_CORE_ENTRIES) {
  const failure = classifyNigerianCleanCoreEntryFailure(entry);
  if (failure !== null) {
    throw new Error(
      `[nigerianCleanCorePack] entry "${entry.id}" failed validation: ${failure}`,
    );
  }
}
