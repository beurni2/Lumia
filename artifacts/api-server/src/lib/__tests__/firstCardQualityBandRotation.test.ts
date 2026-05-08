import { describe, it, expect } from "vitest";
import {
  applyFirstCardQualityBandRotation,
  FIRST_CARD_QUALITY_BAND_K,
} from "../firstCardQualityBandRotation.js";

type TestCandidate = {
  id: string;
  idea: { willingnessScore: number; pickerEligible: boolean };
};

const mk = (
  id: string,
  willingnessScore: number,
  pickerEligible: boolean = true,
): TestCandidate => ({ id, idea: { willingnessScore, pickerEligible } });

describe("applyFirstCardQualityBandRotation (W2-QA-FIX-2)", () => {
  it("returns a defensive clone for inputs of length < 2", () => {
    const empty: TestCandidate[] = [];
    expect(applyFirstCardQualityBandRotation(empty, "creator-a")).not.toBe(
      empty,
    );
    expect(applyFirstCardQualityBandRotation(empty, "creator-a")).toEqual([]);
    const one = [mk("a", 90)];
    const out = applyFirstCardQualityBandRotation(one, "creator-a");
    expect(out).not.toBe(one);
    expect(out).toEqual(one);
  });

  it("returns a defensive clone when creatorId is empty", () => {
    const xs = [mk("a", 95), mk("b", 94), mk("c", 93)];
    const out = applyFirstCardQualityBandRotation(xs, "");
    expect(out).not.toBe(xs);
    expect(out.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("is deterministic for the same creatorId", () => {
    const xs = [mk("a", 95), mk("b", 94), mk("c", 93), mk("d", 92)];
    const r1 = applyFirstCardQualityBandRotation(xs, "creator-deterministic");
    const r2 = applyFirstCardQualityBandRotation(xs, "creator-deterministic");
    const r3 = applyFirstCardQualityBandRotation(xs, "creator-deterministic");
    expect(r1.map((c) => c.id)).toEqual(r2.map((c) => c.id));
    expect(r2.map((c) => c.id)).toEqual(r3.map((c) => c.id));
  });

  it("spreads first-card across many creator ids when band size > 1", () => {
    const xs = [mk("a", 95), mk("b", 94), mk("c", 93), mk("d", 92)];
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const out = applyFirstCardQualityBandRotation(xs, `creator-${i}`);
      seen.add(out[0]!.id);
    }
    // Band is {a,b,c,d} (all within K=10 of leader 95). Hash modulo
    // 4 must spread across at least 2 distinct first-card ids over
    // 100 random creator strings.
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  it("keeps original leader when the top-quality band has size 1", () => {
    // Leader 95, runner-up 80 → outside K=10 band → band size 1.
    const xs = [mk("a", 95), mk("b", 80), mk("c", 70)];
    for (let i = 0; i < 20; i++) {
      const out = applyFirstCardQualityBandRotation(xs, `cid-${i}`);
      expect(out[0]!.id).toBe("a");
      expect(out.map((c) => c.id)).toEqual(["a", "b", "c"]);
    }
  });

  it("never promotes a candidate outside the K-point quality band", () => {
    // Leader 95; b=90 (in band), c=70 (out of band).
    const xs = [mk("a", 95), mk("b", 90), mk("c", 70)];
    for (let i = 0; i < 200; i++) {
      const out = applyFirstCardQualityBandRotation(xs, `creator-${i}`);
      // slot-0 must always be "a" or "b", never "c".
      expect(["a", "b"]).toContain(out[0]!.id);
    }
  });

  it("never promotes an ineligible-tier candidate above an eligible leader", () => {
    // a/b eligible, c ineligible (sorted last by annotateAndSortByWillingness).
    const xs = [mk("a", 95, true), mk("b", 94, true), mk("c", 99, false)];
    for (let i = 0; i < 100; i++) {
      const out = applyFirstCardQualityBandRotation(xs, `creator-${i}`);
      expect(out[0]!.idea.pickerEligible).toBe(true);
      expect(["a", "b"]).toContain(out[0]!.id);
    }
  });

  it("when the leader is ineligible (degenerate batch), rotation stays within ineligible tier", () => {
    // No eligible candidates; leader is ineligible. Band scan stays
    // in-tier; spread happens within ineligibles. (This documents
    // the intentional fail-open semantics — same shape as
    // annotateAndSortByWillingness's all-ineligible behaviour.)
    const xs = [mk("a", 60, false), mk("b", 58, false), mk("c", 55, false)];
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const out = applyFirstCardQualityBandRotation(xs, `creator-${i}`);
      expect(out[0]!.idea.pickerEligible).toBe(false);
      seen.add(out[0]!.id);
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  it("preserves shipping count and the full id set", () => {
    const xs = [mk("a", 95), mk("b", 94), mk("c", 93)];
    const out = applyFirstCardQualityBandRotation(xs, "creator-x");
    expect(out.length).toBe(xs.length);
    expect(new Set(out.map((c) => c.id))).toEqual(new Set(["a", "b", "c"]));
  });

  it("only swaps positions 0 and chosenIdx — every other position preserved", () => {
    const xs = [mk("a", 95), mk("b", 94), mk("c", 93), mk("d", 92), mk("e", 91)];
    // Find a creatorId whose hash lands chosenIdx === 2 (i.e. id "c"):
    let targetCid: string | null = null;
    for (let i = 0; i < 1000; i++) {
      const cid = `cid-${i}`;
      const out = applyFirstCardQualityBandRotation(xs, cid);
      if (out[0]!.id === "c") {
        targetCid = cid;
        break;
      }
    }
    expect(targetCid).not.toBeNull();
    const out = applyFirstCardQualityBandRotation(xs, targetCid!);
    // After the swap of positions 0 and 2: ["c", "b", "a", "d", "e"]
    expect(out.map((c) => c.id)).toEqual(["c", "b", "a", "d", "e"]);
  });

  it("does not mutate the input array", () => {
    const xs = [mk("a", 95), mk("b", 94), mk("c", 93)];
    const before = xs.map((c) => c.id);
    applyFirstCardQualityBandRotation(xs, "creator-x");
    applyFirstCardQualityBandRotation(xs, "creator-y");
    applyFirstCardQualityBandRotation(xs, "creator-z");
    expect(xs.map((c) => c.id)).toEqual(before);
  });

  it("respects the K=10 default band tolerance", () => {
    // Leader 95, c=85.0 is exactly at the K=10 floor → IN band.
    const xs = [mk("a", 95), mk("b", 90), mk("c", 85)];
    expect(FIRST_CARD_QUALITY_BAND_K).toBe(10);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const out = applyFirstCardQualityBandRotation(xs, `creator-${i}`);
      seen.add(out[0]!.id);
    }
    // All three are in the band; should see at least 2 distinct
    // first-cards across 200 creators.
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  it("treats missing willingnessScore as 0 (defensive)", () => {
    const xs: TestCandidate[] = [
      { id: "a", idea: { willingnessScore: 95, pickerEligible: true } },
      { id: "b", idea: { willingnessScore: 94, pickerEligible: true } },
    ];
    // Strip willingnessScore from b to simulate degenerate input.
    const degenerate: { id: string; idea: { pickerEligible: boolean } }[] = [
      { id: "a", idea: { pickerEligible: true } },
      { id: "b", idea: { pickerEligible: true } },
    ];
    expect(() =>
      applyFirstCardQualityBandRotation(degenerate, "creator-x"),
    ).not.toThrow();
    expect(() =>
      applyFirstCardQualityBandRotation(xs, "creator-x"),
    ).not.toThrow();
  });
});
