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
