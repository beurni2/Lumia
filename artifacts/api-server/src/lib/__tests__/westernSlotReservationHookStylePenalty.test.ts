/**
 * PHASE W2-R — `hookStyle` soft-penalty wiring tests for
 * `applyWesternApprovedPackSlotReservation`.
 *
 * Covers the new `W2K2_SOFT_PENALTY.hookStyle` axis (and the bumped
 * `setting` weight 0.5 → 1.0). All tests:
 *   • use the fully-activated cohort (region=undefined, languageStyle
 *     left undefined, flagEnabled=true, packLength>0) so the
 *     activation guard passes.
 *   • construct minimal `WesternPackCandidate` fixtures whose
 *     `qualityScore` differences are designed to flip rank ONLY when
 *     a penalty fires (or fails to fire).
 *   • verify hard distinctness gates still dominate (entryId/hook/
 *     skeleton hard rejects always beat soft penalties).
 *   • verify behavior is deterministic across repeated calls with
 *     identical inputs.
 *
 * No DB / network access. Pure unit tests over the exported penalty
 * application path.
 */

import { describe, expect, it } from "vitest";

import type { ScoredCandidate } from "../ideaScorer.js";
import {
  W2K2_SOFT_PENALTY,
  W2_HOOK_STYLE_PENALTY_DEFAULT,
  applyWesternApprovedPackSlotReservation,
  resolveHookStylePenaltyFromEnv,
  type WesternExcludeAxes,
  type WesternPackCandidate,
} from "../westernPackSlotReservation.js";

function emptyAxes(over: Partial<WesternExcludeAxes> = {}): WesternExcludeAxes {
  return {
    entryIds: new Set(),
    hooks: new Set(),
    skeletons: new Set(),
    anchors: new Set(),
    families: new Set(),
    spikes: new Set(),
    settings: new Set(),
    hookStyles: new Set(),
    ...over,
  };
}

function mkScored(hook: string, hookStyle: string): ScoredCandidate {
  return {
    idea: { hook, hookStyle } as ScoredCandidate["idea"],
    meta: {},
    score: {
      total: 0,
      hookImpact: 0,
      tension: 0,
      filmability: 0,
      personalFit: 0,
      captionStrength: 0,
      freshness: 0,
      scrollStopScore: 0,
      hookIntentScore: 0,
      heroQuality: 0,
    },
    rewriteAttempted: false,
  } as ScoredCandidate;
}

function mkCand(
  i: number,
  opts: {
    hookStyle?: string;
    setting?: string;
    family?: string;
    spike?: string;
    anchor?: string;
    qualityScore?: number;
  } = {},
): WesternPackCandidate {
  const hookStyle = opts.hookStyle ?? "internal_thought";
  const hook = `placeholder hook number ${i} talking about ${opts.anchor ?? "thing"}`;
  return {
    candidate: mkScored(hook, hookStyle),
    entryId: `w2_test_${i.toString().padStart(3, "0")}`,
    comedyFamily: opts.family ?? "denial_loop",
    setting: opts.setting ?? "couch",
    anchor: opts.anchor ?? `anchor_${i}`,
    emotionalSpike: opts.spike ?? "shame",
    hookSkeleton: `__ ${i} __ __`,
    hookStyle,
    qualityScore: opts.qualityScore ?? 50,
  };
}

const COMMON = {
  selectionBatch: [] as ScoredCandidate[],
  desiredCount: 3,
  region: undefined,
  languageStyle: undefined,
  flagEnabled: true,
  packLength: 100,
} as const;

describe("W2-R — hookStyle soft penalty wiring", () => {
  it("hookStyle penalty matches resolveHookStylePenaltyFromEnv() at module load", () => {
    // PHASE W2-R-A2 — the constant is now env-overridable. Whatever
    // env state the test process was launched in, the module-load-time
    // constant must equal what `resolveHookStylePenaltyFromEnv()`
    // returns for that same env state. This stays correct whether the
    // env is unset (→ default 1.0) or set to a valid value (→ that
    // value), and explicitly accepts `0` as a valid override.
    expect(W2K2_SOFT_PENALTY.hookStyle).toBe(resolveHookStylePenaltyFromEnv());
    if (
      process.env.LUMINA_W2_HOOKSTYLE_PENALTY === undefined ||
      process.env.LUMINA_W2_HOOKSTYLE_PENALTY === ""
    ) {
      expect(W2K2_SOFT_PENALTY.hookStyle).toBe(W2_HOOK_STYLE_PENALTY_DEFAULT);
      expect(W2_HOOK_STYLE_PENALTY_DEFAULT).toBe(1.0);
    }
  });

  it("resolveHookStylePenaltyFromEnv parses valid inputs and rejects invalid ones to default", () => {
    // Valid: returns the parsed numeric value (including 0).
    expect(resolveHookStylePenaltyFromEnv("0")).toBe(0);
    expect(resolveHookStylePenaltyFromEnv("1")).toBe(1);
    expect(resolveHookStylePenaltyFromEnv("1.0")).toBe(1.0);
    expect(resolveHookStylePenaltyFromEnv("5")).toBe(5);
    expect(resolveHookStylePenaltyFromEnv("10")).toBe(10);
    expect(resolveHookStylePenaltyFromEnv("100")).toBe(100);
    // Unset/empty: returns default.
    expect(resolveHookStylePenaltyFromEnv(undefined)).toBe(
      W2_HOOK_STYLE_PENALTY_DEFAULT,
    );
    expect(resolveHookStylePenaltyFromEnv("")).toBe(
      W2_HOOK_STYLE_PENALTY_DEFAULT,
    );
    // Invalid: unparseable, out-of-range, NaN, Infinity → default.
    expect(resolveHookStylePenaltyFromEnv("abc")).toBe(
      W2_HOOK_STYLE_PENALTY_DEFAULT,
    );
    expect(resolveHookStylePenaltyFromEnv("-1")).toBe(
      W2_HOOK_STYLE_PENALTY_DEFAULT,
    );
    expect(resolveHookStylePenaltyFromEnv("101")).toBe(
      W2_HOOK_STYLE_PENALTY_DEFAULT,
    );
    expect(resolveHookStylePenaltyFromEnv("Infinity")).toBe(
      W2_HOOK_STYLE_PENALTY_DEFAULT,
    );
    expect(resolveHookStylePenaltyFromEnv("-Infinity")).toBe(
      W2_HOOK_STYLE_PENALTY_DEFAULT,
    );
    expect(resolveHookStylePenaltyFromEnv("NaN")).toBe(
      W2_HOOK_STYLE_PENALTY_DEFAULT,
    );
  });

  it("setting penalty bumped 0.5 → 1.0", () => {
    expect(W2K2_SOFT_PENALTY.setting).toBe(1.0);
  });

  it("anchor / family / spike weights unchanged from W2-K2", () => {
    expect(W2K2_SOFT_PENALTY.anchor).toBe(2.0);
    expect(W2K2_SOFT_PENALTY.family).toBe(1.0);
    expect(W2K2_SOFT_PENALTY.spike).toBe(0.5);
  });

  it("recent hookStyle gets penalised; tied raw score swaps in favour of fresh hookStyle", () => {
    // Both candidates score 50; A's hookStyle is in recent set so loses
    // 1.0; B is fresh. Result: B reserved at slot 1.
    const candA = mkCand(1, { hookStyle: "internal_thought" });
    const candB = mkCand(2, { hookStyle: "curiosity" });
    const result = applyWesternApprovedPackSlotReservation({
      ...COMMON,
      w2Candidates: [candA, candB],
      excludeAxes: emptyAxes({ hookStyles: new Set(["internal_thought"]) }),
    });
    // Top-1 reservation reorders the batch — winner is the first in
    // composed result.
    expect(result.length).toBeGreaterThan(0);
    const top = result[0]!;
    expect(top.idea.hookStyle).toBe("curiosity");
  });

  it("no penalty fires when hookStyles set is empty (W2-K2 baseline behavior preserved)", () => {
    const candA = mkCand(1, { hookStyle: "internal_thought", qualityScore: 60 });
    const candB = mkCand(2, { hookStyle: "curiosity", qualityScore: 50 });
    const result = applyWesternApprovedPackSlotReservation({
      ...COMMON,
      w2Candidates: [candA, candB],
      excludeAxes: emptyAxes(),
    });
    const top = result[0]!;
    // No memory hits → raw quality score wins → A.
    expect(top.idea.hookStyle).toBe("internal_thought");
  });

  it("strong candidate still wins despite hookStyle penalty when alternative is much weaker", () => {
    // A: hookStyle in recent set, raw 60 → adjusted 59.
    // B: fresh hookStyle, raw 55 → adjusted 55.
    // 59 > 55 → A still wins.
    const candA = mkCand(1, { hookStyle: "internal_thought", qualityScore: 60 });
    const candB = mkCand(2, { hookStyle: "curiosity", qualityScore: 55 });
    const result = applyWesternApprovedPackSlotReservation({
      ...COMMON,
      w2Candidates: [candA, candB],
      excludeAxes: emptyAxes({ hookStyles: new Set(["internal_thought"]) }),
    });
    expect(result[0]!.idea.hookStyle).toBe("internal_thought");
  });

  it("setting bump (0.5 → 1.0) swaps rank when raw scores within 1 point", () => {
    // A: setting in recent set, raw 51 → adjusted 50.
    // B: fresh setting, raw 50 → adjusted 50.
    // Tie on adjusted; sort tiebreak is raw qualityScore desc → A wins.
    // To prove the bump matters, use a 0.6-point lead instead:
    // A raw 50.6 - 1.0 = 49.6 vs B raw 50.0 → B wins (would NOT have
    // won under the old 0.5 weight where A would be 50.1).
    const candA = mkCand(1, { setting: "couch", qualityScore: 50.6 });
    const candB = mkCand(2, { setting: "kitchen", qualityScore: 50 });
    const result = applyWesternApprovedPackSlotReservation({
      ...COMMON,
      w2Candidates: [candA, candB],
      excludeAxes: emptyAxes({ settings: new Set(["couch"]) }),
    });
    // Top-1 should be B (fresh setting) thanks to the bumped weight.
    // No meta is stamped in this synthetic fixture; assert via hook
    // text instead (B's hook contains "number 2").
    expect(result[0]!.idea.hook).toContain("number 2");
    // Sanity: confirm we're testing the new weight, not the old.
    expect(W2K2_SOFT_PENALTY.setting).toBeGreaterThan(0.5);
  });

  it("hard entryId rejection still dominates the hookStyle penalty", () => {
    // A is in the entryIds hard-reject set; B is penalised on
    // hookStyle. A must NOT be reserved (hard reject wins), so B is
    // the only candidate and ships despite its hookStyle penalty.
    const candA = mkCand(1, { hookStyle: "curiosity", qualityScore: 90 });
    const candB = mkCand(2, { hookStyle: "internal_thought", qualityScore: 50 });
    const result = applyWesternApprovedPackSlotReservation({
      ...COMMON,
      w2Candidates: [candA, candB],
      excludeAxes: emptyAxes({
        entryIds: new Set([candA.entryId]),
        hookStyles: new Set(["internal_thought"]),
      }),
    });
    expect(result[0]!.idea.hook).toContain("number 2");
  });

  it("multi-axis penalty stacks deterministically (hookStyle + setting + anchor)", () => {
    // Three candidates, all raw 100:
    //   A: hits hookStyle (-1) + setting (-1) + anchor (-2) = -4 → 96
    //   B: hits hookStyle (-1)                              = 99
    //   C: clean                                            = 100
    // Order should be C > B > A.
    const candA = mkCand(1, {
      hookStyle: "internal_thought",
      setting: "couch",
      anchor: "phone",
      qualityScore: 100,
    });
    const candB = mkCand(2, {
      hookStyle: "internal_thought",
      setting: "park",
      anchor: "rock",
      qualityScore: 100,
    });
    const candC = mkCand(3, {
      hookStyle: "curiosity",
      setting: "garage",
      anchor: "drill",
      qualityScore: 100,
    });
    const axes = emptyAxes({
      hookStyles: new Set(["internal_thought"]),
      settings: new Set(["couch"]),
      anchors: new Set(["phone"]),
    });
    const r = applyWesternApprovedPackSlotReservation({
      ...COMMON,
      w2Candidates: [candA, candB, candC],
      excludeAxes: axes,
    });
    // Top-1 is C (cleanest).
    expect(r[0]!.idea.hook).toContain("number 3");
  });

  it("identical inputs produce identical output across repeated calls (determinism)", () => {
    const seed = (): WesternPackCandidate[] => [
      mkCand(1, { hookStyle: "internal_thought", qualityScore: 60 }),
      mkCand(2, { hookStyle: "curiosity", qualityScore: 50 }),
      mkCand(3, { hookStyle: "contrast", qualityScore: 55 }),
    ];
    const axes = emptyAxes({ hookStyles: new Set(["internal_thought"]) });
    const r1 = applyWesternApprovedPackSlotReservation({
      ...COMMON,
      w2Candidates: seed(),
      excludeAxes: axes,
    });
    const r2 = applyWesternApprovedPackSlotReservation({
      ...COMMON,
      w2Candidates: seed(),
      excludeAxes: axes,
    });
    expect(r1.map((c) => c.idea.hook)).toEqual(r2.map((c) => c.idea.hook));
  });

  it("non-Western cohort short-circuits to identity (penalty never fires)", () => {
    // Activation guard is region/languageStyle-gated; passing region
    // = "nigeria" must produce identity output regardless of penalty
    // configuration. Defends the `LUMINA_W2_WESTERN_*` non-leak rule.
    const candA = mkCand(1, { hookStyle: "internal_thought", qualityScore: 50 });
    const result = applyWesternApprovedPackSlotReservation({
      selectionBatch: [],
      w2Candidates: [candA],
      desiredCount: 3,
      region: "nigeria",
      languageStyle: "pidgin",
      flagEnabled: true,
      packLength: 100,
      excludeAxes: emptyAxes({ hookStyles: new Set(["internal_thought"]) }),
    });
    // Identity = original empty selectionBatch returned.
    expect(result).toEqual([]);
  });
});
