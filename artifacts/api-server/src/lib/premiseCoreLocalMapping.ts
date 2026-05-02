/**
 * PHASE Y3 — LOCAL-POOL premiseCoreId MAPPING
 *
 * Bridge layer: tag local pattern-pool candidates with a
 * `premiseCoreId` synthesized from a deterministic high-confidence
 * `(premiseStyleId, executionId) → premiseCoreId` lookup table.
 *
 * Why this exists:
 *   - Layer-3 (Claude) candidates ship with `idea.premiseCoreId` set
 *     directly by the model per the PREMISE CORE LIBRARY prompt.
 *   - Layer-1 (local pattern catalog) candidates have NO core tag, so
 *     `buildNoveltyContext`'s `recentPremiseCoreIds` lever sees
 *     nothing for the Layer-1 majority of shipped ideas. Cross-batch
 *     core dedup and the within-batch Claude `recentCoreIds` rescue
 *     filter are silently no-ops on the dominant code path.
 *   - The Y2 baseline measured this directly: 8.8% of shipped ideas
 *     carried `premiseCoreId`. Target for Y3: 50-70%.
 *
 * Discipline:
 *   - Mapping is CONSERVATIVE. We only tag a candidate when its
 *     `(premiseStyleId, executionId)` pair maps unambiguously to one
 *     core. Ambiguous pairs are left untagged — telemetry surfaces
 *     them as `topUnmappedPremiseHooks` for a follow-up pass.
 *   - Mapping is DETERMINISTIC. Same input → same core, every time.
 *     No fuzzy matching, no scoring, no fallback core.
 *   - Mapping is SOURCE-VALIDATED. Each mapped `premiseCoreId` MUST
 *     appear in `PREMISE_CORES`. Drift is caught by an api-server
 *     boot-time call to `validateLocalCoreMappingAgainst(PREMISE_CORES)`
 *     (see `src/index.ts`). Any rename/deletion in the core library
 *     refuses-to-boot rather than silently mistagging candidates.
 *     Validation lives in the caller because this module deliberately
 *     has zero runtime import on `premiseCoreLibrary` (would close a
 *     3-way cyclic import — see the import block below).
 *
 * NOT a replacement for the Layer-3 core-aware path. The Claude path
 * still picks cores from the full library + emits the chosen id; this
 * helper just back-fills the local-pool blind spot until a future
 * core-native generator replaces the local catalog entirely.
 *
 * See `.local/y3_mapping_spec.md` (working notes) for the full
 * justification of every mapped pair and the explicitly-unmapped
 * ambiguous pairs.
 */

import type { PremiseStyleId } from "./patternIdeator.js";

// NOTE: do NOT import `PREMISE_CORES` (or any other runtime value)
// from `./premiseCoreLibrary.js` here. `premiseCoreLibrary` runtime-
// imports `PREMISE_STYLE_IDS` from `patternIdeator`, and
// `patternIdeator` runtime-imports `resolvePremiseCoreIdForLocalCandidate`
// from this module — adding a back-edge into `premiseCoreLibrary` from
// here closes a 3-way runtime cycle whose worst case is ESM partial-
// snapshot TDZ on whichever module the entry point loads first.
// Drift detection lives in `validateLocalCoreMappingAgainst`, called
// once from `src/index.ts` boot() after the full module graph has
// settled — see that callsite for the reasoning.

// ---------------------------------------------------------------- //
// Mapping table                                                    //
// ---------------------------------------------------------------- //

/**
 * Tuple list `[premiseStyleId, executionId, premiseCoreId]`. Source
 * for `LOCAL_CORE_MAPPING` below. Exported as a tuple list (not the
 * Map directly) so test code can iterate the raw entries without
 * re-deriving them from Map iteration order.
 */
export const LOCAL_CORE_MAPPING_ENTRIES: ReadonlyArray<
  readonly [PremiseStyleId, string, string]
> = Object.freeze([
  // todo_termination — plan/list collapse family
  ["todo_termination", "direct_failure", "self_betrayal_resolution_decay"],
  ["todo_termination", "pattern_naming", "self_betrayal_resolution_decay"],
  ["todo_termination", "identity_framing", "self_as_relationship_coworker"],
  ["todo_termination", "ironic_confidence", "self_betrayal_promise_to_self"],
  ["todo_termination", "understatement", "adulting_chaos_email_avoidance"],

  // procrastination_paradox — confident avoider family
  [
    "procrastination_paradox",
    "identity_framing",
    "self_betrayal_promise_to_self",
  ],
  [
    "procrastination_paradox",
    "ironic_confidence",
    "adulting_chaos_email_avoidance",
  ],
  [
    "procrastination_paradox",
    "direct_failure",
    "self_betrayal_resolution_decay",
  ],
  [
    "procrastination_paradox",
    "pattern_naming",
    "adulting_chaos_email_avoidance",
  ],

  // self_destruction_speedrun — declared rule, instant break
  ["self_destruction_speedrun", "direct_failure", "self_betrayal_rule_break"],
  [
    "self_destruction_speedrun",
    "delusion_admission",
    "self_betrayal_rule_break",
  ],
  ["self_destruction_speedrun", "pattern_naming", "self_betrayal_rule_break"],
  ["self_destruction_speedrun", "identity_framing", "self_betrayal_rule_break"],
  [
    "self_destruction_speedrun",
    "ironic_confidence",
    "self_betrayal_rule_break",
  ],

  // self_sabotage_scrollstop — self-description vs reality
  [
    "self_sabotage_scrollstop",
    "identity_framing",
    "confident_vs_real_resume_lie",
  ],
  ["self_sabotage_scrollstop", "direct_failure", "self_betrayal_rule_break"],
  [
    "self_sabotage_scrollstop",
    "pattern_naming",
    "dopamine_overthinking_doomscroll_logic",
  ],

  // main_character_meltdown — persona drop / aesthetic collapse
  [
    "main_character_meltdown",
    "identity_framing",
    "confident_vs_real_persona_drop",
  ],
  [
    "main_character_meltdown",
    "chaos_acceptance",
    "identity_exposure_aesthetic_collapse",
  ],
  [
    "main_character_meltdown",
    "cosmic_overreaction",
    "absurd_escalation_micro_to_macro",
  ],
  [
    "main_character_meltdown",
    "delusion_admission",
    "confident_vs_real_persona_drop",
  ],

  // mundane_meltdown — micro to macro
  [
    "mundane_meltdown",
    "cosmic_overreaction",
    "absurd_escalation_micro_to_macro",
  ],
  [
    "mundane_meltdown",
    "expectation_collapse",
    "absurd_escalation_micro_to_macro",
  ],

  // overdramatic_reframe — micro to macro / aesthetic collapse
  [
    "overdramatic_reframe",
    "cosmic_overreaction",
    "absurd_escalation_micro_to_macro",
  ],
  [
    "overdramatic_reframe",
    "expectation_collapse",
    "absurd_escalation_micro_to_macro",
  ],
  [
    "overdramatic_reframe",
    "chaos_acceptance",
    "identity_exposure_aesthetic_collapse",
  ],

  // collapse_core — curated-self collapse
  [
    "collapse_core",
    "gen_z_collapse",
    "identity_exposure_aesthetic_collapse",
  ],
  [
    "collapse_core",
    "understatement",
    "identity_exposure_aesthetic_collapse",
  ],
  [
    "collapse_core",
    "cosmic_overreaction",
    "identity_exposure_aesthetic_collapse",
  ],

  // duality_clash — self-as-other relationships
  ["duality_clash", "time_marker", "social_mask_pro_vs_off"],
  ["duality_clash", "whiplash_pivot", "self_as_relationship_negotiation"],
  ["duality_clash", "expectation_collapse", "self_as_relationship_coworker"],
  ["duality_clash", "chaos_acceptance", "self_as_relationship_caretaker"],

  // dream_disappointment — promise-to-self
  ["dream_disappointment", "understatement", "self_betrayal_promise_to_self"],
  ["dream_disappointment", "direct_failure", "self_betrayal_promise_to_self"],

  // pattern_exposure — routine lie
  ["pattern_exposure", "pattern_naming", "identity_exposure_routine_lie"],
  ["pattern_exposure", "identity_framing", "identity_exposure_routine_lie"],

  // self_roast_reactor — rule-break self-roast
  ["self_roast_reactor", "identity_framing", "self_betrayal_rule_break"],
  ["self_roast_reactor", "understatement", "self_betrayal_rule_break"],
  ["self_roast_reactor", "direct_failure", "self_betrayal_rule_break"],
  ["self_roast_reactor", "pattern_naming", "self_betrayal_rule_break"],
]);

// ---------------------------------------------------------------- //
// Drift validation (caller-provided cores, called once at boot)    //
// ---------------------------------------------------------------- //

/**
 * Verifies every `premiseCoreId` in `LOCAL_CORE_MAPPING_ENTRIES`
 * exists in the supplied `cores` array (typically `PREMISE_CORES`
 * from `premiseCoreLibrary`). Caller-provided so this module has
 * ZERO runtime dependency on `premiseCoreLibrary` (closing what
 * would otherwise be a 3-way cyclic-import on the hot path
 * `patternIdeator → premiseCoreLocalMapping → premiseCoreLibrary →
 * patternIdeator`). Call once at api-server boot, after the full
 * module graph has evaluated; see `src/index.ts`. Throws with a
 * concrete drift report on mismatch — the api-server refuses to
 * accept traffic rather than silently mis-tag candidates.
 */
export function validateLocalCoreMappingAgainst(
  cores: ReadonlyArray<{ readonly id: string }>,
): void {
  const validIds: ReadonlySet<string> = new Set(cores.map((c) => c.id));
  const missing: string[] = [];
  for (const [, , coreId] of LOCAL_CORE_MAPPING_ENTRIES) {
    if (!validIds.has(coreId)) missing.push(coreId);
  }
  if (missing.length > 0) {
    const uniq = [...new Set(missing)].sort();
    throw new Error(
      `[premiseCoreLocalMapping] mapped premiseCoreId(s) not found in PREMISE_CORES — drift between mapping table and core library. Missing: ${uniq.join(", ")}. Check premiseCoreLibrary.ts and premiseCoreLocalMapping.ts.`,
    );
  }
}

// ---------------------------------------------------------------- //
// Public API                                                       //
// ---------------------------------------------------------------- //

/**
 * Frozen lookup keyed by `${premiseStyleId}::${executionId}`.
 * Iteration order matches `LOCAL_CORE_MAPPING_ENTRIES`.
 */
const MAPPING: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [styleId, execId, coreId] of LOCAL_CORE_MAPPING_ENTRIES) {
    m.set(`${styleId}::${execId}`, coreId);
  }
  return m;
})();

export const LOCAL_CORE_MAPPING: ReadonlyMap<string, string> = MAPPING;

/**
 * Resolve a `premiseCoreId` for a local pattern-pool candidate,
 * given the picked `LanguagePhrasingEntry`'s fine-grained style +
 * execution tags. Returns `undefined` when:
 *   - either tag is missing (legacy / Llama / Claude wraps),
 *   - or the `(styleId, executionId)` pair is intentionally unmapped
 *     (ambiguous between two cores — see `.local/y3_mapping_spec.md`).
 *
 * Pure / deterministic / no I/O — safe to call from any codepath.
 */
export function resolvePremiseCoreIdForLocalCandidate(args: {
  premiseStyleId?: PremiseStyleId | undefined;
  executionId?: string | undefined;
}): string | undefined {
  const { premiseStyleId, executionId } = args;
  if (!premiseStyleId || !executionId) return undefined;
  return MAPPING.get(`${premiseStyleId}::${executionId}`);
}
