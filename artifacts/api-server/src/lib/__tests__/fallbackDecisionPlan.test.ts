import { describe, expect, it } from "vitest";

import {
  decideFallbackPlan,
  type FallbackDecisionInput,
} from "../fallbackDecisionPlan";

const baseHealthyLocal: FallbackDecisionInput = {
  regenerate: false,
  desiredCount: 3,
  localKept: 5,
  mergedSize: 8,
  selectionBatchSize: 3,
  selectionGuardsPassed: true,
  n1LiveSkipFallback: false,
  w2mLocalFirstRefreshEnabled: false,
  fallbackGapOnlyEnabled: false,
};

describe("decideFallbackPlan — hard failure paths (always trigger fallback)", () => {
  it("returns merged_pool_too_small when mergedSize < 3 even with healthy selection", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      mergedSize: 2,
    });
    expect(r).toEqual({
      needFallback: true,
      reason: "merged_pool_too_small",
    });
  });

  it("returns selection_underfilled when selection.batch.length < desiredCount", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      selectionBatchSize: 2,
    });
    expect(r).toEqual({
      needFallback: true,
      reason: "selection_underfilled",
    });
  });

  it("returns guards_failed when selection guards did not pass", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      selectionGuardsPassed: false,
    });
    expect(r).toEqual({
      needFallback: true,
      reason: "guards_failed",
    });
  });

  it("hard paths fire regardless of any skip-gate flag", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      mergedSize: 1,
      regenerate: true,
      n1LiveSkipFallback: true,
      w2mLocalFirstRefreshEnabled: true,
    });
    expect(r.needFallback).toBe(true);
    expect(r.reason).toBe("merged_pool_too_small");
  });

  it("hard-path priority: merged < 3 wins over underfilled which wins over guards", () => {
    // Multi-failure: merged=2 AND batch=1 AND guards=false → first reason returned.
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      mergedSize: 2,
      selectionBatchSize: 1,
      selectionGuardsPassed: false,
    });
    expect(r.reason).toBe("merged_pool_too_small");
  });
});

describe("decideFallbackPlan — P3 (non-regenerate) skip", () => {
  it("returns not_needed_p3_local_sufficient on healthy non-regenerate request", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      regenerate: false,
    });
    expect(r).toEqual({
      needFallback: false,
      reason: "not_needed_p3_local_sufficient",
    });
  });

  it("P3 skip is always-on (no flag dependency)", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      regenerate: false,
      n1LiveSkipFallback: false,
      w2mLocalFirstRefreshEnabled: false,
    });
    expect(r.reason).toBe("not_needed_p3_local_sufficient");
  });

  it("P3 skip does not fire when regenerate=true (legacy semantics)", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      regenerate: true,
      n1LiveSkipFallback: false,
      w2mLocalFirstRefreshEnabled: false,
    });
    expect(r.reason).toBe("regenerate_legacy_force");
    expect(r.needFallback).toBe(true);
  });

  it("P3 skip applies on non-regenerate even when localKept < desiredCount (legacy parity: hard paths already guarantee batch fullness)", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      regenerate: false,
      localKept: 2,
      desiredCount: 3,
    });
    expect(r).toEqual({
      needFallback: false,
      reason: "not_needed_p3_local_sufficient",
    });
  });
});

describe("decideFallbackPlan — N1-live skip (existing behavior preserved)", () => {
  it("returns not_needed_n1_live_skip on regenerate request when n1LiveSkipFallback=true", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      regenerate: true,
      n1LiveSkipFallback: true,
    });
    expect(r).toEqual({
      needFallback: false,
      reason: "not_needed_n1_live_skip",
    });
  });

  it("N1 skip is always-on (no flag dependency)", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      regenerate: true,
      n1LiveSkipFallback: true,
      w2mLocalFirstRefreshEnabled: false,
    });
    expect(r.reason).toBe("not_needed_n1_live_skip");
  });

  it("N1 skip does not apply on non-regenerate request (P3 wins first)", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      regenerate: false,
      n1LiveSkipFallback: true,
    });
    expect(r.reason).toBe("not_needed_p3_local_sufficient");
  });
});

describe("decideFallbackPlan — W2-M (regenerate-aware) skip", () => {
  it("flag OFF: regenerate request hits legacy force path", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      regenerate: true,
      w2mLocalFirstRefreshEnabled: false,
    });
    expect(r).toEqual({
      needFallback: true,
      reason: "regenerate_legacy_force",
    });
  });

  it("flag ON + regenerate + sufficient local pool: skips Claude", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      regenerate: true,
      w2mLocalFirstRefreshEnabled: true,
    });
    expect(r).toEqual({
      needFallback: false,
      reason: "not_needed_w2m_local_sufficient",
    });
  });

  it("flag ON but localKept < desiredCount: legacy force still fires (no false skip)", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      regenerate: true,
      w2mLocalFirstRefreshEnabled: true,
      localKept: 2,
      desiredCount: 3,
    });
    expect(r).toEqual({
      needFallback: true,
      reason: "regenerate_legacy_force",
    });
  });

  it("flag ON but selection.batch.length < desiredCount: hard path wins (selection_underfilled, not w2m skip)", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      regenerate: true,
      w2mLocalFirstRefreshEnabled: true,
      selectionBatchSize: 2,
    });
    expect(r.reason).toBe("selection_underfilled");
  });

  it("flag ON but guards failed: hard path wins (guards_failed, not w2m skip)", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      regenerate: true,
      w2mLocalFirstRefreshEnabled: true,
      selectionGuardsPassed: false,
    });
    expect(r.reason).toBe("guards_failed");
  });

  it("flag ON + N1 cohort: N1-live skip still wins first (preserves N1 fast path semantics)", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      regenerate: true,
      n1LiveSkipFallback: true,
      w2mLocalFirstRefreshEnabled: true,
    });
    expect(r.reason).toBe("not_needed_n1_live_skip");
  });

  it("flag ON does not change non-regenerate behavior (P3 still wins)", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      regenerate: false,
      w2mLocalFirstRefreshEnabled: true,
    });
    expect(r.reason).toBe("not_needed_p3_local_sufficient");
  });
});

describe("decideFallbackPlan — F3-FALLBACK-GAP-ONLY (guards_failed narrowing)", () => {
  // F3 audit proved the guards_failed rail fired 12/12 times in the
  // stress sweep with localKept ≫ desiredCount, every Claude call timed
  // out at 45 s, and 0/120 served ideas were Claude. The gap-only flag
  // narrows guards_failed to fire only when the local pool is
  // structurally too thin to ship best-effort.

  it("flag OFF + guards_failed: still triggers fallback (parity)", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      selectionGuardsPassed: false,
      fallbackGapOnlyEnabled: false,
    });
    expect(r).toEqual({ needFallback: true, reason: "guards_failed" });
  });

  it("flag ON + guards_failed + localKept >= desiredCount: SKIPS fallback with gap-only reason", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      selectionGuardsPassed: false,
      desiredCount: 3,
      localKept: 5,
      fallbackGapOnlyEnabled: true,
    });
    expect(r).toEqual({
      needFallback: false,
      reason: "not_needed_gap_only_local_sufficient",
    });
  });

  it("flag ON + guards_failed + localKept < desiredCount: still triggers guards_failed fallback (no false skip)", () => {
    // selectionBatchSize == desiredCount so selection_underfilled does NOT
    // pre-empt; localKept < desiredCount so the gap-only floor doesn't
    // skip; guards_failed is the rail we're exercising.
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      selectionGuardsPassed: false,
      desiredCount: 5,
      localKept: 4,
      mergedSize: 5,
      selectionBatchSize: 5,
      fallbackGapOnlyEnabled: true,
    });
    expect(r).toEqual({ needFallback: true, reason: "guards_failed" });
  });

  it("flag ON + guards_failed + localKept < 3 (sub-floor): still triggers guards_failed fallback", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      selectionGuardsPassed: false,
      desiredCount: 3,
      localKept: 2,
      fallbackGapOnlyEnabled: true,
    });
    expect(r).toEqual({ needFallback: true, reason: "guards_failed" });
  });

  it("hard rails unchanged: merged_pool_too_small fires regardless of gap-only flag", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      selectionGuardsPassed: false,
      mergedSize: 2,
      localKept: 100,
      fallbackGapOnlyEnabled: true,
    });
    expect(r).toEqual({
      needFallback: true,
      reason: "merged_pool_too_small",
    });
  });

  it("hard rails unchanged: selection_underfilled fires regardless of gap-only flag", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      selectionGuardsPassed: false,
      selectionBatchSize: 2,
      desiredCount: 3,
      localKept: 100,
      fallbackGapOnlyEnabled: true,
    });
    expect(r).toEqual({
      needFallback: true,
      reason: "selection_underfilled",
    });
  });

  // Boundary cases from the spec
  it("boundary: desiredCount=10, localKept=10, flag ON → no fallback", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      selectionGuardsPassed: false,
      selectionBatchSize: 10,
      desiredCount: 10,
      localKept: 10,
      mergedSize: 10,
      fallbackGapOnlyEnabled: true,
    });
    expect(r.needFallback).toBe(false);
    expect(r.reason).toBe("not_needed_gap_only_local_sufficient");
  });

  it("boundary: desiredCount=10, localKept=9, flag ON → fallback", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      selectionGuardsPassed: false,
      selectionBatchSize: 10,
      desiredCount: 10,
      localKept: 9,
      mergedSize: 10,
      fallbackGapOnlyEnabled: true,
    });
    expect(r).toEqual({ needFallback: true, reason: "guards_failed" });
  });

  it("boundary: desiredCount=3, localKept=3, flag ON → no fallback", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      selectionGuardsPassed: false,
      desiredCount: 3,
      localKept: 3,
      fallbackGapOnlyEnabled: true,
    });
    expect(r.needFallback).toBe(false);
    expect(r.reason).toBe("not_needed_gap_only_local_sufficient");
  });

  it("boundary: desiredCount=3, localKept=2, flag ON → fallback (sub-3 floor)", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      selectionGuardsPassed: false,
      desiredCount: 3,
      localKept: 2,
      fallbackGapOnlyEnabled: true,
    });
    expect(r).toEqual({ needFallback: true, reason: "guards_failed" });
  });

  it("boundary: desiredCount=1 (sub-floor), localKept=2, flag ON → fallback (max(3, desiredCount) floor enforced)", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      selectionGuardsPassed: false,
      selectionBatchSize: 1,
      desiredCount: 1,
      localKept: 2,
      mergedSize: 3,
      fallbackGapOnlyEnabled: true,
    });
    expect(r).toEqual({ needFallback: true, reason: "guards_failed" });
  });

  it("boundary: desiredCount=1, localKept=3, flag ON → no fallback (meets 3-floor)", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      selectionGuardsPassed: false,
      selectionBatchSize: 1,
      desiredCount: 1,
      localKept: 3,
      mergedSize: 3,
      fallbackGapOnlyEnabled: true,
    });
    expect(r.needFallback).toBe(false);
    expect(r.reason).toBe("not_needed_gap_only_local_sufficient");
  });

  it("flag ON + guards_passed + non-regenerate: P3 skip still wins (gap-only does not change healthy paths)", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      regenerate: false,
      fallbackGapOnlyEnabled: true,
    });
    expect(r.reason).toBe("not_needed_p3_local_sufficient");
  });

  it("flag ON does not affect regenerate + guards passed (W2-M / regenerate_legacy paths unchanged)", () => {
    const r = decideFallbackPlan({
      ...baseHealthyLocal,
      regenerate: true,
      w2mLocalFirstRefreshEnabled: false,
      fallbackGapOnlyEnabled: true,
    });
    expect(r).toEqual({
      needFallback: true,
      reason: "regenerate_legacy_force",
    });
  });
});

describe("decideFallbackPlan — pre-W2-M parity (flag OFF must match legacy semantics)", () => {
  // Reproduces the legacy `needFallback` cascade exactly:
  //   layer1CoreAwareTriggered = regenerate && !n1LiveSkipFallback;
  //   needFallback = (layer1CoreAwareTriggered && !p3) ? true
  //                : merged<3 || batch<desired || !guards;
  function legacyNeedFallback(i: FallbackDecisionInput): boolean {
    const layer = i.regenerate && !i.n1LiveSkipFallback;
    const p3 =
      !i.regenerate &&
      i.localKept >= i.desiredCount &&
      i.mergedSize >= 3 &&
      i.selectionBatchSize >= i.desiredCount &&
      i.selectionGuardsPassed;
    return layer && !p3
      ? true
      : i.mergedSize < 3 ||
          i.selectionBatchSize < i.desiredCount ||
          !i.selectionGuardsPassed;
  }

  const cases: Array<Partial<FallbackDecisionInput>> = [
    {}, // baseline
    { regenerate: true },
    { regenerate: true, n1LiveSkipFallback: true },
    { regenerate: true, n1LiveSkipFallback: true, mergedSize: 2 },
    { regenerate: false, mergedSize: 2 },
    { regenerate: false, selectionBatchSize: 2 },
    { regenerate: false, selectionGuardsPassed: false },
    { regenerate: true, mergedSize: 2 },
    { regenerate: true, selectionBatchSize: 1 },
    { regenerate: true, selectionGuardsPassed: false },
    { regenerate: true, n1LiveSkipFallback: true, selectionBatchSize: 1 },
    { regenerate: false, localKept: 1 },
    { regenerate: false, localKept: 1, mergedSize: 2 },
  ];

  for (const overlay of cases) {
    it(`flag OFF parity: ${JSON.stringify(overlay)}`, () => {
      const input: FallbackDecisionInput = {
        ...baseHealthyLocal,
        ...overlay,
        w2mLocalFirstRefreshEnabled: false,
      };
      const helper = decideFallbackPlan(input);
      expect(helper.needFallback).toBe(legacyNeedFallback(input));
    });
  }
});
