/**
 * PHASE Z1 — willingnessScorer regression tests. Locks in the
 * three load-bearing properties of the scorer:
 *
 *   1. EDGE BEATS EFFICIENCY — a high-edge candidate with average
 *      filmability beats a low-edge candidate with maxed filmability.
 *      The whole point of the multiplicative edgeFactor.
 *   2. PICKER ELIGIBILITY HARD FLOOR — sub-50 hookQualityScore OR
 *      any aiCliche hit flips `pickerEligible` to false regardless
 *      of how high the rest of the score is.
 *   3. DETERMINISM — same inputs => identical output (no Date.now,
 *      no Math.random, no DB read).
 */
import { describe, it, expect } from "vitest";
import { scoreWillingness } from "../willingnessScorer.js";
import type { Idea } from "../ideaGen.js";
import type { IdeaScore, CandidateMeta } from "../ideaScorer.js";

function mkIdea(overrides: Partial<Idea> = {}): Idea {
  // Minimal Idea shape — most fields aren't read by the scorer but
  // the type requires them. We cast through `unknown` because the
  // full Idea schema has many required fields the scorer doesn't
  // touch and faking them all would only test the type system.
  return {
    hook: "i ghosted my own to-do list",
    caption: "the list won again",
    visualHook: "stare at the list",
    hasVisualAction: true,
    whatToShow: "the list, then nothing",
    howToFilm: "phone propped, one take",
    whyItWorks: "the silence is the joke",
    shotPlan: ["one static shot of the list"],
    filmingTimeMin: 3,
    setting: "bedroom",
    ...overrides,
  } as unknown as Idea;
}

function mkScore(overrides: Partial<IdeaScore> = {}): IdeaScore {
  return {
    total: 7,
    hookImpact: 2,
    tension: 2,
    filmability: 2,
    personalFit: 2,
    captionStrength: 1,
    freshness: 1,
    scrollStopScore: 8,
    hookIntentScore: 8,
    heroQuality: 60,
    ...overrides,
  };
}

function mkMeta(overrides: Partial<CandidateMeta> = {}): CandidateMeta {
  return {
    source: "core_native",
    hookQualityScore: 75,
    voiceClusterId: "dry_deadpan",
    scenarioFingerprint: "sf_test_001",
    ideaCoreFamily: "self_betrayal",
    ...overrides,
  } as unknown as CandidateMeta;
}

describe("scoreWillingness (Z1)", () => {
  it("EDGE BEATS EFFICIENCY: high-edge / mid-filmability beats low-edge / max-filmability", () => {
    // Candidate A — sharp Y8 hook (contradiction marker, high HQS),
    // multi-shot setup (filmability dragged down).
    const a = scoreWillingness({
      idea: mkIdea({
        hook: "i ghosted my own to-do list. it didn't notice.",
        shotPlan: ["wide", "close on list", "back to face", "fade"],
        filmingTimeMin: 12,
      }),
      score: mkScore({ filmability: 1, personalFit: 2, freshness: 1 }),
      meta: mkMeta({ hookQualityScore: 85 }),
    });
    // Candidate B — bland hook (no contradiction, low HQS), one-shot
    // bedroom setup (max filmability).
    const b = scoreWillingness({
      idea: mkIdea({
        hook: "this is a thing about the list",
        shotPlan: ["one shot"],
        filmingTimeMin: 2,
      }),
      score: mkScore({ filmability: 2, personalFit: 2, freshness: 1 }),
      meta: mkMeta({ hookQualityScore: 35 }),
    });
    expect(a.total).toBeGreaterThan(b.total);
  });

  it("PICKER FLOOR: hookQualityScore < 50 ⇒ pickerEligible false", () => {
    const r = scoreWillingness({
      idea: mkIdea(),
      score: mkScore(),
      meta: mkMeta({ hookQualityScore: 42 }),
    });
    expect(r.pickerEligible).toBe(false);
  });

  it("PICKER FLOOR: aiCliche hit ⇒ pickerEligible false even at high HQS", () => {
    const r = scoreWillingness({
      idea: mkIdea({ hook: "my body quit on me again" }),
      score: mkScore(),
      meta: mkMeta({ hookQualityScore: 80 }),
    });
    expect(r.pickerEligible).toBe(false);
  });

  it("PICKER FLOOR: clean high-HQS hook ⇒ pickerEligible true", () => {
    const r = scoreWillingness({
      idea: mkIdea({ hook: "i ghosted my own to-do list. it didn't notice." }),
      score: mkScore(),
      meta: mkMeta({ hookQualityScore: 75 }),
    });
    expect(r.pickerEligible).toBe(true);
  });

  it("DETERMINISM: identical inputs ⇒ identical output", () => {
    const args = {
      idea: mkIdea(),
      score: mkScore(),
      meta: mkMeta(),
    };
    const a = scoreWillingness(args);
    const b = scoreWillingness(args);
    expect(a).toEqual(b);
  });

  it("score is bounded in [0,100]", () => {
    const max = scoreWillingness({
      idea: mkIdea({
        hook: "i ghosted my own to-do list. it didn't notice.",
        shotPlan: ["one shot"],
        filmingTimeMin: 2,
      }),
      score: mkScore(),
      meta: mkMeta({ hookQualityScore: 100 }),
    });
    const min = scoreWillingness({
      idea: mkIdea({
        hook: "x",
        shotPlan: ["a", "b", "c", "d", "e", "f"],
        filmingTimeMin: 60,
      }),
      score: mkScore({
        filmability: 0,
        personalFit: 0,
        freshness: 0,
        hookImpact: 0,
        tension: 0,
        captionStrength: 0,
      }),
      meta: mkMeta({ hookQualityScore: 0 }),
    });
    expect(max.total).toBeLessThanOrEqual(100);
    expect(max.total).toBeGreaterThanOrEqual(0);
    expect(min.total).toBeLessThanOrEqual(100);
    expect(min.total).toBeGreaterThanOrEqual(0);
  });
});
