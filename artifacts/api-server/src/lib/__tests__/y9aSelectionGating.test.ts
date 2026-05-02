/**
 * PHASE Y9-A — `selectionPenalty` path-aware gating regressions.
 *
 * Locks in the two behavioral guarantees of Y9-A:
 *
 *   1. Y4 demote stack (-5 / -5 / -5 per-axis + -4 / -4 combo) is
 *      SKIPPED for `meta.source === "core_native"` candidates and
 *      PRESERVED for `pattern_variation` candidates. The delta
 *      between the two paths on an identically-shaped candidate
 *      with all three Y4 axes (style + exec + core) recent must be
 *      exactly -23 (the Y4 demote sum).
 *
 *   2. Selection-layer boost source switches by path:
 *        - core_native (carries `hookQualityScore`)         → `hookQualityBoost`
 *        - pattern_variation (carries `premiseComedyScore`) → `premiseComedyBoost` (unchanged)
 *      The pattern_variation magnitude must equal the pre-Y9-A
 *      magnitude exactly — Y9-A is a strict-improvement migration
 *      ONLY for the core_native path.
 *
 * Construction note: we cast minimal hand-built `CandidateMeta`
 * shapes through `unknown` because the union has many optional
 * fields the test does not need to populate. The `selectionPenalty`
 * helper reads only the fields the test sets, so undefined elsewhere
 * is the same fail-quiet posture every existing call site relies on.
 */
import { describe, it, expect } from "vitest";
import {
  selectionPenalty,
  type CandidateMeta,
  type NoveltyContext,
} from "../ideaScorer.js";
import {
  hookQualityBoost,
  scoreHookQuality,
} from "../hookQuality.js";
import { premiseComedyBoost } from "../patternIdeator.js";
import type { Idea } from "../ideaGen.js";

function ideaWith(hook: string): Idea {
  return {
    hook,
    whatToShow: "show",
    howToFilm: "film",
    trigger: "trigger",
    premise: "premise",
    transcript: "transcript",
    cta: "cta",
    captionTags: [],
  } as unknown as Idea;
}

/** Build a meta shape with the Y4 axes + boost source for a given path. */
function buildMeta(opts: {
  source: "core_native" | "pattern_variation";
  premiseStyleId: string;
  executionId: string;
  premiseCoreId: string;
  hookQualityScore?: number;
  premiseComedyTotal?: number;
}): CandidateMeta {
  const base: Record<string, unknown> = {
    source: opts.source,
    usedBigPremise: true,
    premiseStyleId: opts.premiseStyleId,
    executionId: opts.executionId,
    premiseCoreId: opts.premiseCoreId,
  };
  if (opts.hookQualityScore !== undefined) {
    base.hookQualityScore = opts.hookQualityScore;
  }
  if (opts.premiseComedyTotal !== undefined) {
    base.premiseComedyScore = {
      total: opts.premiseComedyTotal,
      // Other rubric components — selectionPenalty reads `.total` only.
      visceral: 0,
      anthropomorph: 0,
      brevity: 0,
      concrete: 0,
      contradiction: 0,
    };
  }
  return base as unknown as CandidateMeta;
}

/** Build a NoveltyContext with the three Y4 axes seeded as recent. */
function buildCtxAllAxesRecent(opts: {
  premiseStyleId: string;
  executionId: string;
  premiseCoreId: string;
}): NoveltyContext {
  return {
    recentPremiseStyleIds: new Set([
      opts.premiseStyleId,
    ]) as unknown as ReadonlySet<never>,
    recentExecutionIds: new Set([opts.executionId]),
    recentPremiseCoreIds: new Set([opts.premiseCoreId]),
  } as unknown as NoveltyContext;
}

describe("selectionPenalty — Y9-A path-aware Y4 demote skip", () => {
  it("core_native skips full Y4 stack; pattern_variation keeps it (delta = -23)", () => {
    const idea = ideaWith("uniquely fresh hook for y9a gating test");
    const ids = {
      premiseStyleId: "y9a_test_style",
      executionId: "y9a_test_exec",
      premiseCoreId: "y9a_test_core",
    };
    const ctx = buildCtxAllAxesRecent(ids);

    // Core_native + hookQualityScore. baseBoost = hookQualityBoost(85)
    // = +6, capped to +3 (style + exec recent). All Y4 demotes
    // SKIPPED by Y9-A path gate.
    const coreMeta = buildMeta({
      source: "core_native",
      ...ids,
      hookQualityScore: 85,
    });
    const pCore = selectionPenalty({ idea, meta: coreMeta }, [], ctx);

    // Pattern_variation + premiseComedyScore. baseBoost =
    // premiseComedyBoost(7) = +4, capped to +3 (style + exec recent).
    // Full Y4 demote stack APPLIES: -5 style + -5 core + -5 exec + -4
    // combo style+exec + -4 near-shell (style+exec+core all recent).
    const patternMeta = buildMeta({
      source: "pattern_variation",
      ...ids,
      premiseComedyTotal: 7,
    });
    const pPattern = selectionPenalty(
      { idea, meta: patternMeta },
      [],
      ctx,
    );

    // Both candidates have the SAME baseBoost magnitude after the
    // Y3 D-lite cap (+3 vs +3) so the boost contribution cancels.
    // Both have the SAME +4 Phase 6C premise preference bonus
    // (gated on usedBigPremise=true, not on source). Every other
    // selectionPenalty branch reads fields neither candidate
    // populates, so they cancel too. The ONLY remaining delta is
    // the Y4 demote stack, gated by Y9-A on source.
    expect(pPattern - pCore).toBe(-23);
  });

  it("core_native with single recent axis: per-axis -5 demote skipped", () => {
    const idea = ideaWith("another uniquely fresh y9a single-axis hook");
    const ids = {
      premiseStyleId: "y9a_solo_style",
      executionId: "y9a_solo_exec",
      premiseCoreId: "y9a_solo_core",
    };
    // ONLY style is recent — combo demote does NOT fire (requires
    // style + exec both recent), so the only delta is the per-axis
    // -5 style demote.
    const ctx = {
      recentPremiseStyleIds: new Set([
        ids.premiseStyleId,
      ]) as unknown as ReadonlySet<never>,
    } as unknown as NoveltyContext;

    const coreMeta = buildMeta({
      source: "core_native",
      ...ids,
      hookQualityScore: 85,
    });
    const patternMeta = buildMeta({
      source: "pattern_variation",
      ...ids,
      premiseComedyTotal: 7,
    });

    const pCore = selectionPenalty({ idea, meta: coreMeta }, [], ctx);
    const pPattern = selectionPenalty(
      { idea, meta: patternMeta },
      [],
      ctx,
    );

    // Per-axis style demote = -5. Y3 D-lite cap fires for BOTH (style
    // is recent), so both baseBoosts cap to +3. Delta = pattern_variation
    // -5, core_native 0 → -5.
    expect(pPattern - pCore).toBe(-5);
  });
});

describe("selectionPenalty — Y9-A boost source switch", () => {
  it("core_native baseBoost = hookQualityBoost(score) when no recent axis fires", () => {
    const idea = ideaWith("yet another uniquely fresh y9a boost test hook");
    const ids = {
      premiseStyleId: "y9a_boost_style",
      executionId: "y9a_boost_exec",
      premiseCoreId: "y9a_boost_core",
    };
    // EMPTY recent context — no demote, no Y3 D-lite cap, no
    // fresh-axis +2 boost (fresh boost requires non-empty history).
    const ctx: NoveltyContext = {};

    const coreLow = buildMeta({
      source: "core_native",
      ...ids,
      hookQualityScore: 55,
    });
    const coreHigh = buildMeta({
      source: "core_native",
      ...ids,
      hookQualityScore: 85,
    });

    const pLow = selectionPenalty({ idea, meta: coreLow }, [], ctx);
    const pHigh = selectionPenalty({ idea, meta: coreHigh }, [], ctx);

    // hookQualityBoost(85) - hookQualityBoost(55) = 6 - 0 = +6.
    expect(hookQualityBoost(85)).toBe(6);
    expect(hookQualityBoost(55)).toBe(0);
    expect(pHigh - pLow).toBe(6);
  });

  it("pattern_variation baseBoost = premiseComedyBoost(total) — pre-Y9-A magnitude preserved", () => {
    const idea = ideaWith("pattern variation y9a parity hook for boost test");
    const ids = {
      premiseStyleId: "y9a_parity_style",
      executionId: "y9a_parity_exec",
      premiseCoreId: "y9a_parity_core",
    };
    const ctx: NoveltyContext = {};

    const lowScore = buildMeta({
      source: "pattern_variation",
      ...ids,
      premiseComedyTotal: 6,
    });
    const highScore = buildMeta({
      source: "pattern_variation",
      ...ids,
      premiseComedyTotal: 10,
    });

    const pLow = selectionPenalty({ idea, meta: lowScore }, [], ctx);
    const pHigh = selectionPenalty({ idea, meta: highScore }, [], ctx);

    // premiseComedyBoost(10) - premiseComedyBoost(6) = 7 - 1 = +6 — exact
    // pre-Y9-A magnitude. The fallback path is BIT-FOR-BIT identical to
    // pre-Y9-A for pattern_variation candidates.
    expect(premiseComedyBoost(10)).toBe(7);
    expect(premiseComedyBoost(6)).toBe(1);
    expect(pHigh - pLow).toBe(6);
  });

  it("source-aware branch: pattern_variation with hookQualityScore set ignores it (back-compat guarantee)", () => {
    // Architect-fix regression: the resolver branches on
    // `meta.source === "core_native"`, NOT on
    // `hookQualityScore !== undefined`. A defensive scenario where
    // a pattern_variation candidate somehow carries hookQualityScore
    // (e.g. transitional cache shape, Llama re-scoring path) MUST
    // still read the legacy `premiseComedyBoost` band, otherwise the
    // "ZERO change for non-core paths" Y9-A guarantee breaks.
    const idea = ideaWith("source aware branch y9a regression hook");
    const ids = {
      premiseStyleId: "y9a_branch_style",
      executionId: "y9a_branch_exec",
      premiseCoreId: "y9a_branch_core",
    };
    const ctx: NoveltyContext = {};

    // Pattern_variation + hookQualityScore=85 (would be +6 if resolver
    // were presence-based) + premiseComedyScore.total=6 (= +1 via
    // legacy band).
    const sneakyMeta = buildMeta({
      source: "pattern_variation",
      ...ids,
      hookQualityScore: 85,
      premiseComedyTotal: 6,
    });
    // Same shape but without hookQualityScore — confirms the legacy
    // band fires identically.
    const baselineMeta = buildMeta({
      source: "pattern_variation",
      ...ids,
      premiseComedyTotal: 6,
    });

    const pSneaky = selectionPenalty({ idea, meta: sneakyMeta }, [], ctx);
    const pBaseline = selectionPenalty(
      { idea, meta: baselineMeta },
      [],
      ctx,
    );

    // Source-aware branching → both read premiseComedyBoost(6) = +1.
    // Delta MUST be 0. If the resolver were presence-based, the
    // sneaky candidate would have scored +6 instead and the delta
    // would be +5.
    expect(pSneaky - pBaseline).toBe(0);
  });

  it("source-aware branch: defensive core_native without hookQualityScore collapses to neutral 0", () => {
    // Architect-fix regression mirror: a core_native candidate that
    // somehow lacks hookQualityScore (defensive — should never
    // happen in production, but cache replay or partial-write
    // scenarios could expose it) MUST collapse to a neutral 0
    // boost, not crash and not silently fall back to premiseComedy.
    // hookQualityBoost(undefined) === 0 — same neutral posture as
    // premiseComedyBoost(undefined).
    const idea = ideaWith("defensive core native missing score y9a hook");
    const ids = {
      premiseStyleId: "y9a_def_style",
      executionId: "y9a_def_exec",
      premiseCoreId: "y9a_def_core",
    };
    const ctx: NoveltyContext = {};

    const defensiveMeta = buildMeta({
      source: "core_native",
      ...ids,
      // hookQualityScore intentionally omitted
      premiseComedyTotal: 10, // would yield +7 via legacy if path were taken
    });
    const referenceMeta = buildMeta({
      source: "core_native",
      ...ids,
      hookQualityScore: 55, // hookQualityBoost(55) = 0
    });

    const pDefensive = selectionPenalty(
      { idea, meta: defensiveMeta },
      [],
      ctx,
    );
    const pReference = selectionPenalty(
      { idea, meta: referenceMeta },
      [],
      ctx,
    );

    // Both collapse to baseBoost=0 via hookQualityBoost. Delta is 0.
    // If the resolver had fallen back to premiseComedyBoost on
    // missing hookQualityScore, the defensive candidate would have
    // scored +7 and the delta would be +7.
    expect(pDefensive - pReference).toBe(0);
  });
});

describe("selectionPenalty — Y9-A integration with Y8 captivating-hook scorer", () => {
  it("the Y8 user-requirement winner ('ghosted my own to-do list') outscores its loser at selection", () => {
    // Y8 spec quote: "every hook title must be captivating and
    // intriguing — 'i ghosted my own to-do list' is better than
    // 'i abandoned my checklist'". This integration test confirms
    // the Y9-A boost wire-up actually surfaces that preference at
    // the SELECTION layer, not just at the recipe-loop's
    // best-of-N picker. A regression that re-flips the preference
    // here is a Y8 + Y9-A joint failure.
    const ghostedHook = "i ghosted my own to-do list";
    const abandonedHook = "i abandoned my checklist";
    const ghostedScore = scoreHookQuality(ghostedHook, "self_betrayal");
    const abandonedScore = scoreHookQuality(abandonedHook, "self_betrayal");
    expect(ghostedScore).toBeGreaterThan(abandonedScore);

    const ids = {
      premiseStyleId: "y9a_ghosted_style",
      executionId: "y9a_ghosted_exec",
      premiseCoreId: "y9a_ghosted_core",
    };
    const ctx: NoveltyContext = {};

    const ghostedMeta = buildMeta({
      source: "core_native",
      ...ids,
      hookQualityScore: ghostedScore,
    });
    const abandonedMeta = buildMeta({
      source: "core_native",
      ...ids,
      hookQualityScore: abandonedScore,
    });

    const pGhosted = selectionPenalty(
      { idea: ideaWith(ghostedHook), meta: ghostedMeta },
      [],
      ctx,
    );
    const pAbandoned = selectionPenalty(
      { idea: ideaWith(abandonedHook), meta: abandonedMeta },
      [],
      ctx,
    );

    // selectionPenalty is the LOWER-IS-BETTER convention; the higher-quality
    // hook gets a HIGHER (less-negative / more-positive) penalty score
    // because the selectionPenalty function adds the boost to `p`. So the
    // captivating winner must rank STRICTLY ABOVE the loser at this layer.
    expect(pGhosted).toBeGreaterThan(pAbandoned);
  });
});
