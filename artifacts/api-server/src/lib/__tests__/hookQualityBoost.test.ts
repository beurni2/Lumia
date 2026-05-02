/**
 * PHASE Y9-A — `hookQualityBoost` boundary regression tests.
 *
 * Locks in the 7-bucket band (90+ → +7 / 80-89 → +6 / 70-79 → +5 /
 * 60-69 → +3 / 50-59 → 0 / 40-49 → -1 / <40 → -2) so a future tuning
 * pass cannot silently re-shape the curve and change selection
 * arithmetic for every core_native candidate.
 *
 * The undefined branch is critical: it MUST collapse to 0 (same as
 * `premiseComedyBoost(undefined)`) so non-core_native candidates
 * whose meta omits `hookQualityScore` get the neutral posture a
 * legacy hook gets at the selectionPenalty wire site.
 */
import { describe, it, expect } from "vitest";
import { hookQualityBoost } from "../hookQuality.js";

describe("hookQualityBoost (Y9-A selection-layer band)", () => {
  it("undefined collapses to 0 (parity with premiseComedyBoost(undefined))", () => {
    expect(hookQualityBoost(undefined)).toBe(0);
  });

  it("score >= 90 returns +7 (top of band)", () => {
    expect(hookQualityBoost(90)).toBe(7);
    expect(hookQualityBoost(95)).toBe(7);
    expect(hookQualityBoost(100)).toBe(7);
  });

  it("score 80-89 returns +6", () => {
    expect(hookQualityBoost(80)).toBe(6);
    expect(hookQualityBoost(85)).toBe(6);
    expect(hookQualityBoost(89)).toBe(6);
  });

  it("score 70-79 returns +5", () => {
    expect(hookQualityBoost(70)).toBe(5);
    expect(hookQualityBoost(75)).toBe(5);
    expect(hookQualityBoost(79)).toBe(5);
  });

  it("score 60-69 returns +3 (median floor)", () => {
    expect(hookQualityBoost(60)).toBe(3);
    expect(hookQualityBoost(65)).toBe(3);
    expect(hookQualityBoost(69)).toBe(3);
  });

  it("score 50-59 returns 0 (neutral band)", () => {
    expect(hookQualityBoost(50)).toBe(0);
    expect(hookQualityBoost(55)).toBe(0);
    expect(hookQualityBoost(59)).toBe(0);
  });

  it("score 40-49 returns -1 (defensive demote)", () => {
    expect(hookQualityBoost(40)).toBe(-1);
    expect(hookQualityBoost(45)).toBe(-1);
    expect(hookQualityBoost(49)).toBe(-1);
  });

  it("score < 40 returns -2 (deep demote — Y8 boot floor)", () => {
    expect(hookQualityBoost(0)).toBe(-2);
    expect(hookQualityBoost(20)).toBe(-2);
    expect(hookQualityBoost(39)).toBe(-2);
  });

  it("Y3 D-lite cap math: Math.min(boost, 3) clamps top of band to +3", () => {
    // The Y3 D-lite cap at the selectionPenalty wire site is
    // `Math.min(baseBoost, 3)` when the candidate's style/exec id is
    // recent. Confirm the cap arithmetic still works identically on
    // hookQualityBoost output as it did on premiseComedyBoost output:
    expect(Math.min(hookQualityBoost(90), 3)).toBe(3);
    expect(Math.min(hookQualityBoost(85), 3)).toBe(3);
    expect(Math.min(hookQualityBoost(75), 3)).toBe(3);
    expect(Math.min(hookQualityBoost(65), 3)).toBe(3);
    // Below the +3 floor the cap is a no-op (Math.min picks the
    // smaller of the two, and the boost is already <= 3):
    expect(Math.min(hookQualityBoost(55), 3)).toBe(0);
    expect(Math.min(hookQualityBoost(45), 3)).toBe(-1);
    expect(Math.min(hookQualityBoost(35), 3)).toBe(-2);
  });

  it("monotonic non-decreasing across the score range", () => {
    // Sanity: a higher score must NEVER produce a lower boost. Catches
    // future tuning passes that accidentally invert a bucket boundary.
    let prev = hookQualityBoost(0);
    for (let s = 1; s <= 100; s++) {
      const cur = hookQualityBoost(s);
      expect(cur).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
  });
});
