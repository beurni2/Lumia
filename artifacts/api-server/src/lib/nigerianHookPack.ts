/**
 * PHASE N1 — NIGERIAN COMEDY PACK (infrastructure only — DARK)
 *
 * SHIPS EMPTY. NOT ACTIVATED. NOT WIRED INTO THE RECIPE QUEUE.
 *
 * This module establishes the type, storage shape, boot-time integrity
 * asserts, and the central activation guard for a future hand-curated
 * Nigerian / Pidgin hook+scenario pack. The pack pool itself is an
 * empty `Object.freeze([])` until a Nigerian native speaker provides
 * reviewed entries. The pack-draw integration into the recipe queue
 * (planned for `coreCandidateGenerator.ts`) is intentionally NOT
 * present in this phase — leaving the live recipe path untouched
 * makes the byte-identity proof trivial:
 *
 *   • western / india / philippines / undefined-region: this module
 *     is never imported by any active code path → pre-N1 byte-
 *     identical.
 *   • nigeria with `languageStyle ∈ {null, "clean"}`: identical
 *     guard semantics — `canActivateNigerianPack` returns `false` →
 *     no pack draw, no behavior change.
 *   • nigeria with `languageStyle ∈ {"light_pidgin","pidgin"}`,
 *     flag ON, pack populated: still inert in this phase because the
 *     integration site is not wired. The guard exists so the wiring
 *     PR ships as a one-line callsite + zero new logic.
 *
 * SAFETY CONTRACT (enforced at module load when pack is non-empty):
 *
 *   1. Every entry MUST carry a non-empty `reviewedBy` stamp. Boot
 *      throws if missing — the agent CANNOT author entries; sign-off
 *      is a hard precondition.
 *   2. `anchor` MUST be a lowercase single token AND appear as a
 *      lowercase substring in BOTH `hook` and `whatToShow`. Same
 *      precondition the catalog anchor path enforces — keeps the
 *      pack uniform with the cohesive-author preconditions.
 *   3. Field length bands match `ideaSchema`: hook ≤ 120 chars,
 *      whatToShow 20–500, howToFilm 15–400, caption 1–280. Any
 *      out-of-band entry trips boot.
 *   4. `pidginLevel` MUST be `"light_pidgin"` or `"pidgin"` (the
 *      `clean` tier exists on the user-side dial but it makes no
 *      sense to ship a pack entry at that tier — clean Nigerian
 *      output already flows through R1+R2+R3+R4 unchanged).
 *   5. Mocking-spelling patterns (`PIDGIN_MOCKING_PATTERNS`) are
 *      checked against `hook` AND `caption`. Cartoonised vowel
 *      stretching, accent-mocking spellings, and the pre-vetted
 *      stereotype tropes from `regionProfile.NIGERIA_PROFILE
 *      .avoidStereotypes` trip boot.
 *
 * ACTIVATION GATE (the ONLY way the pack ever fires, once integration
 * lands in a future phase):
 *
 *   `canActivateNigerianPack({region, languageStyle, flagEnabled,
 *      packLength})` — returns `true` IFF:
 *     · region === "nigeria"
 *     · languageStyle ∈ {"light_pidgin","pidgin"} (NOT null, NOT
 *       "clean")
 *     · flagEnabled (server-side env flag ON)
 *     · packLength > 0 (at least one reviewed entry exists)
 *   ALL FOUR must hold. Any failure short-circuits to `false`.
 *
 * NO Claude. NO DB. Pure / frozen at module load. Same discipline
 * as `voiceClusters.ts`, `userBlessedHookCorpus.ts`, and
 * `regionAnchorCatalog.ts`. Cross-region leak is impossible by
 * construction: the guard hard-couples `region === "nigeria"` to
 * any pack activation.
 *
 * INTEGRATION TODO (NEXT PHASE — DO NOT ADD IN N1):
 *   When activating, the integration site is the recipe-queue
 *   builder in `coreCandidateGenerator.ts` (≈ L819 — the call to
 *   `buildRecipeQueue`). Pack entries are atomic recipes (hook +
 *   whatToShow + caption supplied directly), distinct from the R3
 *   anchor-prefix path which only swaps anchors. Wiring will:
 *     · evaluate `canActivateNigerianPack(...)` once per core
 *     · if true, prepend up to `NIGERIAN_PACK_PREFIX_CAP` eligible
 *       entries (filtered by core domain + creator's tier) BEFORE
 *       the catalog queue
 *     · pack candidates flow through every existing validator
 *       (`ideaSchema`, `validateComedy`, `validateAntiCopy`,
 *       `validateScenarioCoherence`) — N1 adds NO validator
 *       loosening
 *
 * ROLLBACK
 * ────────
 * Set `LUMINA_NG_PACK_ENABLED` to anything other than `"true"`
 * (or unset it) — `isNigerianPackFeatureEnabled()` returns false
 * and `canActivateNigerianPack` short-circuits regardless of pack
 * contents.
 */

import type { Region } from "@workspace/lumina-trends";
import type { LanguageStyle } from "./tasteCalibration";
// PHASE N1-S — staging activation. The approved pool is defined in
// `nigerianHookPackApproved.ts` (auto-generated, native-reviewer
// stamped). This module pulls it in so the live `NIGERIAN_HOOK_PACK`
// can swap to the approved entries when `LUMINA_NG_PACK_ENABLED=true`
// and otherwise stays equal to `Object.freeze([])` (byte-identical
// to the pre-N1-S DARK default — the activation guard's
// `flagEnabled === false` short-circuit also stays in force).
//
// Cycle-safety note: `nigerianHookPackApproved` re-imports
// `assertNigerianPackIntegrity` (function decl — hoisted across the
// ESM cycle) and the `NigerianPackEntry` type (erased at runtime).
// The `APPROVED_…` const fully evaluates inside that module before
// control returns here, so the assignment below sees a fully
// initialised frozen array.
import { APPROVED_NIGERIAN_PROMOTION_CANDIDATES } from "./nigerianHookPackApproved.js";
import { registerApprovedPoolReference } from "./nigerianHookQuality.js";

// Local djb2 — same canonical implementation already present in
// `coreCandidateGenerator.ts` and `scenarioFingerprint.ts`. Inlined
// here to keep this module standalone (zero hot-path imports) so the
// dark infrastructure cannot inadvertently widen any other module's
// dependency surface.
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

// ---------------------------------------------------------------- //
// Atomic entry shape (8 user-required fields).
//
// Pack entries are ATOMIC: hook ↔ whatToShow ↔ howToFilm ↔ caption
// ship together as one comedic unit. The cohesive author renders
// the catalog/template path against a (core, anchor, action) triple
// which then runs through anchored phrasing; pack entries skip that
// rendering and supply the literal text the validators must accept.
// This is intentional — Pidgin syntax is not template-shaped (see
// the audit), so any "render against placeholder" path would either
// produce broken Pidgin or trip the existing validators.
// ---------------------------------------------------------------- //

export type NigerianPackEntry = {
  /** Verbatim hook text. Lowercase preferred; the anchor must
   *  appear as a lowercase substring. ≤ 120 chars to match
   *  `ideaSchema.hook`. */
  readonly hook: string;
  /** Beat-by-beat scene narration, plain English (Pidgin tokens
   *  allowed where natural). 20–500 chars to match
   *  `ideaSchema.whatToShow`. The anchor MUST appear as a
   *  lowercase substring. */
  readonly whatToShow: string;
  /** Concrete filming instructions. 15–400 chars to match
   *  `ideaSchema.howToFilm`. */
  readonly howToFilm: string;
  /** Caption text. 1–280 chars (the R1 region tag may compose on
   *  top via the regionProfile decoration layer). */
  readonly caption: string;
  /** Single lowercase token anchor. Must appear in `hook` AND
   *  `whatToShow`. Same shape as `coreDomainAnchorCatalog`
   *  anchors — the validator fingerprint and tokenizer are
   *  source-agnostic. */
  readonly anchor: string;
  /** Coarse domain bucket — used by future pack-draw filtering to
   *  match the active core's domain. Lowercase. */
  readonly domain: string;
  /** Pack tier. The user-side `languageStyle` dial gates which
   *  tier(s) are eligible: `light_pidgin` → only `light_pidgin`
   *  entries; `pidgin` → both tiers eligible. The `clean` tier is
   *  intentionally absent (clean Nigerian output already flows
   *  through R1+R2+R3+R4 unchanged). */
  readonly pidginLevel: "light_pidgin" | "pidgin";
  /** Initials + ISO date of the Nigerian native speaker who
   *  reviewed and approved this entry. NON-EMPTY required — the
   *  agent cannot synthesize this string. Boot throws if blank. */
  readonly reviewedBy: string;
};

// ---------------------------------------------------------------- //
// THE PACK POOL.
//
// SHIPS EMPTY. Real entries land via a separate PR authored by, or
// signed off by, a Nigerian native speaker (the `reviewedBy`
// stamp). The pack-activation guard treats `length === 0` as a
// hard `false` short-circuit, so the dark pack cannot mis-fire.
// ---------------------------------------------------------------- //

// PHASE N1-S — staging activation. When `LUMINA_NG_PACK_ENABLED=true`
// is set in the environment AT MODULE LOAD, the live pack equals the
// 50-entry native-reviewer-stamped APPROVED pool. Otherwise (the
// default — flag unset, "false", or any non-`"true"` value) the pack
// stays `Object.freeze([])` and behavior is byte-identical to the
// pre-N1-S DARK state. The activation guard's `flagEnabled` AND
// `packLength > 0` checks ALSO remain in force at every call site,
// so even a same-process flag flip after module load cannot make a
// dark pack fire and an active pack stays gated by the guard.
export const NIGERIAN_HOOK_PACK: readonly NigerianPackEntry[] =
  isNigerianPackFeatureEnabled()
    ? APPROVED_NIGERIAN_PROMOTION_CANDIDATES
    : (Object.freeze([]) as readonly NigerianPackEntry[]);

// ---------------------------------------------------------------- //
// Mocking-spelling and stereotype patterns to REJECT at boot.
//
// Mirrors the documentary `regionProfile.NIGERIA_PROFILE
// .avoidStereotypes` list — that array is informational; this list
// is enforced at module load.
// ---------------------------------------------------------------- //

export const PIDGIN_MOCKING_PATTERNS: readonly RegExp[] = Object.freeze([
  // Cartoonised vowel stretching ("ohhhh nooooo" Pidgin caricature).
  /([aeiou])\1{3,}/i,
  // The "light just took" / NEPA punchline cliché.
  /\blight\s+just\s+(took|comot|taken)\b/i,
  // Yahoo / scammer trope.
  /\b(yahoo\s*boy|419)\b/i,
  // Lazy "auntie/uncle from village" framing.
  /\b(village\s+(auntie|aunty|uncle)|bush\s+(auntie|aunty|uncle))\b/i,
  // Mocking spelling of "abeg" / "wahala" with extended vowels.
  // PHASE N1-FULL-SPEC — TIGHTENED to eliminate false-positives on
  // legitimate Pidgin "abeg" / "wahala". The original `+` quantifiers
  // matched the canonical spelling itself (1+ matches 1). The new
  // pattern requires ≥2 of the variable letter, matching only the
  // cartoonized stretched variants ("abeeeg", "abeggg", "waahala",
  // "wahalaaa"). This is a TIGHTENING of the false-positive scope,
  // not a relaxation of safety: every string the original regex
  // rejected and that was actually mocking is still rejected; the
  // strings now allowed are authentic Pidgin spellings the original
  // regex incorrectly flagged.
  /\b(abe{2,}g+|abeg{2,}|waha{2,}la+|wahala{2,})\b/i,
]);

// ---------------------------------------------------------------- //
// Field-length bands — kept in lockstep with `ideaSchema`. We
// duplicate the numeric bounds here (rather than importing the
// schema) so the boot-assert is fast, side-effect-free, and does
// not pull the whole zod chain at module load. If `ideaSchema`
// bounds ever change, `ideaSchemaBoundsParity.test.ts` will fail
// (added below) — that's the intentional canary.
// ---------------------------------------------------------------- //

export const PACK_FIELD_BOUNDS = Object.freeze({
  hookMax: 120,
  whatToShowMin: 20,
  whatToShowMax: 500,
  howToFilmMin: 15,
  howToFilmMax: 400,
  captionMin: 1,
  captionMax: 280,
});

// ---------------------------------------------------------------- //
// Boot-time integrity assert. Called once at module load (below);
// also exported so tests can exercise it against synthetic
// fixtures without poisoning the real pool.
// ---------------------------------------------------------------- //

export function assertNigerianPackIntegrity(
  pack: readonly NigerianPackEntry[],
): void {
  // Empty pack is a valid resting state — the entire safety contract
  // is "no entries until a native speaker provides them". Skipping
  // the per-entry checks here is what lets the module load cleanly
  // in production today.
  if (pack.length === 0) return;

  for (const entry of pack) {
    const tag = JSON.stringify({
      hook: entry.hook?.slice(0, 40),
      anchor: entry.anchor,
    });

    if (!entry.reviewedBy || entry.reviewedBy.trim().length === 0) {
      throw new Error(
        `[nigerianHookPack] entry missing reviewedBy stamp: ${tag}. ` +
          `The agent cannot author this string — a Nigerian native ` +
          `speaker must sign off.`,
      );
    }
    // STRENGTHENED in N1 draft batch A: explicitly reject the draft
    // sentinel so a draft entry cannot be promoted into the live
    // pack without the reviewer overwriting the stamp. The literal
    // is duplicated (instead of imported from the drafts module) to
    // avoid a circular import on this hot boot path.
    if (entry.reviewedBy.trim() === "PENDING_NATIVE_REVIEW") {
      throw new Error(
        `[nigerianHookPack] entry still carries the PENDING_NATIVE_REVIEW ` +
          `sentinel: ${tag}. Drafts cannot be activated — a Nigerian native ` +
          `speaker must replace the sentinel with their initials + date.`,
      );
    }
    // STRENGTHENED in N1-Q follow-up: agent-proposed rewrite candidates
    // carry an AGENT-PROPOSED reviewedBy stamp so the integrity guard
    // rejects them on activation. The literal prefix is duplicated here
    // (not imported from the QA script) to keep this hot boot path
    // dependency-free.
    if (entry.reviewedBy.trim().startsWith("AGENT-PROPOSED")) {
      throw new Error(
        `[nigerianHookPack] entry carries the AGENT-PROPOSED sentinel: ` +
          `${tag}. Agent-proposed rewrites cannot be activated — a Nigerian ` +
          `native speaker must replace the stamp with their initials + date.`,
      );
    }

    if (
      entry.pidginLevel !== "light_pidgin" &&
      entry.pidginLevel !== "pidgin"
    ) {
      throw new Error(
        `[nigerianHookPack] entry has invalid pidginLevel ` +
          `'${entry.pidginLevel}': ${tag}. Must be 'light_pidgin' or ` +
          `'pidgin'.`,
      );
    }

    const anchor = entry.anchor?.trim().toLowerCase() ?? "";
    if (anchor.length === 0 || /\s/.test(anchor)) {
      throw new Error(
        `[nigerianHookPack] anchor must be a non-empty single ` +
          `lowercase token: ${tag}.`,
      );
    }
    if (!entry.hook.toLowerCase().includes(anchor)) {
      throw new Error(
        `[nigerianHookPack] anchor '${anchor}' not found in hook: ${tag}.`,
      );
    }
    if (!entry.whatToShow.toLowerCase().includes(anchor)) {
      throw new Error(
        `[nigerianHookPack] anchor '${anchor}' not found in whatToShow: ${tag}.`,
      );
    }

    if (entry.hook.length > PACK_FIELD_BOUNDS.hookMax) {
      throw new Error(
        `[nigerianHookPack] hook exceeds ${PACK_FIELD_BOUNDS.hookMax} chars: ${tag}.`,
      );
    }
    if (
      entry.whatToShow.length < PACK_FIELD_BOUNDS.whatToShowMin ||
      entry.whatToShow.length > PACK_FIELD_BOUNDS.whatToShowMax
    ) {
      throw new Error(
        `[nigerianHookPack] whatToShow length out of band ` +
          `[${PACK_FIELD_BOUNDS.whatToShowMin}, ${PACK_FIELD_BOUNDS.whatToShowMax}]: ${tag}.`,
      );
    }
    if (
      entry.howToFilm.length < PACK_FIELD_BOUNDS.howToFilmMin ||
      entry.howToFilm.length > PACK_FIELD_BOUNDS.howToFilmMax
    ) {
      throw new Error(
        `[nigerianHookPack] howToFilm length out of band ` +
          `[${PACK_FIELD_BOUNDS.howToFilmMin}, ${PACK_FIELD_BOUNDS.howToFilmMax}]: ${tag}.`,
      );
    }
    if (
      entry.caption.length < PACK_FIELD_BOUNDS.captionMin ||
      entry.caption.length > PACK_FIELD_BOUNDS.captionMax
    ) {
      throw new Error(
        `[nigerianHookPack] caption length out of band ` +
          `[${PACK_FIELD_BOUNDS.captionMin}, ${PACK_FIELD_BOUNDS.captionMax}]: ${tag}.`,
      );
    }

    if (!entry.domain || entry.domain.trim().length === 0) {
      throw new Error(`[nigerianHookPack] entry missing domain: ${tag}.`);
    }

    for (const pat of PIDGIN_MOCKING_PATTERNS) {
      if (pat.test(entry.hook)) {
        throw new Error(
          `[nigerianHookPack] hook matches mocking-spelling / ` +
            `stereotype pattern ${pat}: ${tag}.`,
        );
      }
      if (pat.test(entry.caption)) {
        throw new Error(
          `[nigerianHookPack] caption matches mocking-spelling / ` +
            `stereotype pattern ${pat}: ${tag}.`,
        );
      }
    }
  }
}

// Boot-time check on the real pack. Empty today → no-op.
assertNigerianPackIntegrity(NIGERIAN_HOOK_PACK);

// PHASE N1-Q — register the live pool with the additive scorer here
// (after `NIGERIAN_HOOK_PACK` is assigned + asserted) instead of from
// `nigerianHookPackApproved.ts`. The TDZ note above the
// `APPROVED_NIGERIAN_PROMOTION_CANDIDATES` import explains why. The
// scorer accepts the empty-frozen-array case as a no-op (no pool
// reference is registered when the flag is OFF).
if (NIGERIAN_HOOK_PACK.length > 0) {
  registerApprovedPoolReference(NIGERIAN_HOOK_PACK);
}

// ---------------------------------------------------------------- //
// Feature flag — server-side env gate. Read on every guard call
// (cheap; no caching) so test/runtime overrides take effect
// immediately. Default is OFF (anything other than the literal
// string "true" is OFF).
// ---------------------------------------------------------------- //

export function isNigerianPackFeatureEnabled(): boolean {
  return process.env.LUMINA_NG_PACK_ENABLED === "true";
}

// ---------------------------------------------------------------- //
// Central activation guard. THE ONLY supported entrypoint for
// deciding whether the pack should fire. ALL FOUR conditions must
// hold; any failure short-circuits to `false`.
//
// Cross-region leak proof:
//   • non-nigeria region → first condition false → exit
//   • languageStyle null / "clean" → second condition false → exit
//   • flag off → third condition false → exit
//   • empty pack → fourth condition false → exit
// All four are independent AND-conditions; a non-nigeria creator
// CANNOT activate the pack regardless of the other three values.
// ---------------------------------------------------------------- //

export type CanActivateInput = {
  readonly region: Region | undefined;
  readonly languageStyle: LanguageStyle | null | undefined;
  readonly flagEnabled: boolean;
  readonly packLength: number;
};

export function canActivateNigerianPack(input: CanActivateInput): boolean {
  if (input.region !== "nigeria") return false;
  if (
    input.languageStyle !== "light_pidgin" &&
    input.languageStyle !== "pidgin"
  ) {
    return false;
  }
  if (!input.flagEnabled) return false;
  if (input.packLength <= 0) return false;
  return true;
}

// ---------------------------------------------------------------- //
// Eligibility filter. Returns the entries that would be candidates
// for a draw — empty when the guard fails OR the pack is empty.
// `domain` is an optional narrower (matches the active core's
// domain). The function is pure and accepts the pool as an
// argument so tests can inject synthetic fixtures without
// poisoning the real frozen pool.
//
// Tier semantics:
//   • languageStyle === "light_pidgin" → only `light_pidgin` entries
//   • languageStyle === "pidgin"       → both tiers eligible
// (a creator who picked the lighter tier never sees a heavy-Pidgin
// hook — `pidgin` tier is opt-in to the heavier register).
// ---------------------------------------------------------------- //

export type EligibilityInput = {
  readonly region: Region | undefined;
  readonly languageStyle: LanguageStyle | null | undefined;
  readonly flagEnabled: boolean;
  readonly domain?: string;
};

export function getEligibleNigerianPackEntries(
  input: EligibilityInput,
  pool: readonly NigerianPackEntry[] = NIGERIAN_HOOK_PACK,
): readonly NigerianPackEntry[] {
  // DEFENSE IN DEPTH (N1 draft batch A): refuse to ever return draft
  // entries from this entrypoint. Drafts have a structurally
  // compatible shape (Omit<NigerianPackEntry, "pidginLevel"|"reviewedBy">
  // + extra fields) and TypeScript would not catch a misuse if a
  // caller passed `DRAFT_NIGERIAN_HOOK_PACK` here via `as`. The
  // reference check below catches that misuse at runtime. We avoid
  // a top-level import of the drafts module to keep this hot path
  // free of any side-effects from the drafts file's boot assert.
  // The drafts module already runs its own boot assert at its own
  // module load — no need to trigger it again here.
  if (DRAFT_POOL_REF !== undefined && (pool as unknown) === DRAFT_POOL_REF) {
    throw new Error(
      "[nigerianHookPack] DRAFT_NIGERIAN_HOOK_PACK was passed to " +
        "getEligibleNigerianPackEntries — drafts cannot be activated. " +
        "Native reviewer must promote entries into NIGERIAN_HOOK_PACK first.",
    );
  }
  if (
    !canActivateNigerianPack({
      region: input.region,
      languageStyle: input.languageStyle,
      flagEnabled: input.flagEnabled,
      packLength: pool.length,
    })
  ) {
    return EMPTY;
  }
  // Guard guarantees languageStyle is "light_pidgin" or "pidgin".
  const allowHeavy = input.languageStyle === "pidgin";
  const filtered = pool.filter((e) => {
    if (!allowHeavy && e.pidginLevel !== "light_pidgin") return false;
    if (input.domain && e.domain !== input.domain) return false;
    return true;
  });
  return Object.freeze(filtered);
}

const EMPTY: readonly NigerianPackEntry[] = Object.freeze([]);

// Lazy reference holder for the drafts pool — populated by
// `registerDraftPoolReference` (called from the drafts module). Kept
// `undefined` when the drafts module hasn't been imported, so the
// reference check is a cheap no-op for code paths that don't touch
// drafts at all.
let DRAFT_POOL_REF: object | undefined;

/** Internal — called once at drafts module load so the live guard
 *  can refuse the draft pool by reference. NOT for general use. */
export function registerDraftPoolReference(ref: object): void {
  DRAFT_POOL_REF = ref;
}

// ---------------------------------------------------------------- //
// Deterministic prefix gate (mirror of R3's `region-prefix`
// pattern). Exposed for the future integration site so the wiring
// PR is a one-liner. ~25% per (salt, coreId) — same band as the
// R3 anchor-prefix gate to keep pack draws conservative.
// ---------------------------------------------------------------- //

export const NIGERIAN_PACK_PREFIX_CAP = 3;

export function nigerianPackPrefixGate(
  salt: number,
  coreId: string,
): boolean {
  return djb2(`${salt}|${coreId}|ng-pack-prefix`) % 4 === 0;
}
