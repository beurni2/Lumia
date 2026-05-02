/**
 * Phase Y9 — viralPatternMemory render-block tests for the
 * onboarding-seeded path.
 *
 * `computeViralPatternMemory` itself is integration-tested through
 * the running server (no DB mocking here — keeps the unit suite
 * synchronous and free of import-time DB clients). The behaviour
 * we DO want to lock down at unit level is the prompt-block render
 * path: a seeded snapshot must (1) bypass the <3 sampleSize floor,
 * (2) emit the "INITIAL bias from your onboarding answers" framing
 * line, and (3) still emit the LEAN INTO / AVOID / BATCH MIX
 * sections so the model has actionable bias.
 */

import { describe, expect, it } from "vitest";

import {
  EMPTY_MEMORY,
  renderViralMemoryPromptBlock,
} from "../viralPatternMemory";
import { applyOnboardingSeed, type OnboardingSeed } from "../onboardingSeed";

const seed: OnboardingSeed = {
  structures: {},
  hookStyles: { the_way_i: 3, why_do_i: 1.5 },
  emotionalSpikes: {},
  formats: { mini_story: 3, reaction: 1.5 },
  sampleSize: 4,
  sources: ["taste_calibration", "style_profile"],
};

describe("renderViralMemoryPromptBlock — Phase Y9 seeded paths", () => {
  it("EMPTY_MEMORY (no seed) → null (suppression unchanged)", () => {
    expect(renderViralMemoryPromptBlock(EMPTY_MEMORY)).toBeNull();
  });

  it("non-seeded memory with sampleSize=2 → null (the <3 floor still applies)", () => {
    const tiny = { ...EMPTY_MEMORY, sampleSize: 2 };
    expect(renderViralMemoryPromptBlock(tiny)).toBeNull();
  });

  it("seeded cold-start memory → renders block (bypasses <3 floor)", () => {
    const seeded = applyOnboardingSeed(EMPTY_MEMORY, seed, 0);
    const block = renderViralMemoryPromptBlock(seeded, 8);
    expect(block).not.toBeNull();
    expect(block).toContain("VIRAL PATTERN MEMORY");
  });

  it("pure cold-start framing line names the onboarding source", () => {
    const seeded = applyOnboardingSeed(EMPTY_MEMORY, seed, 0);
    const block = renderViralMemoryPromptBlock(seeded, 8)!;
    expect(block).toContain("onboarding answers");
    expect(block).toContain("INITIAL bias");
    // Cold-start has no behavioural verdicts — the framing line
    // must NOT pretend "recent N verdicts + actions" exist.
    expect(block).not.toContain("verdicts + actions");
  });

  it("LEAN INTO line surfaces the seeded hookStyle", () => {
    const seeded = applyOnboardingSeed(EMPTY_MEMORY, seed, 0);
    const block = renderViralMemoryPromptBlock(seeded, 8)!;
    expect(block).toContain("LEAN INTO hook styles: the_way_i");
  });

  it("LEAN INTO line surfaces the seeded format", () => {
    const seeded = applyOnboardingSeed(EMPTY_MEMORY, seed, 0);
    const block = renderViralMemoryPromptBlock(seeded, 8)!;
    expect(block).toContain("LEAN INTO formats: mini_story");
  });

  it("BATCH MIX is still emitted (Part 6 invariant)", () => {
    const seeded = applyOnboardingSeed(EMPTY_MEMORY, seed, 0);
    const block = renderViralMemoryPromptBlock(seeded, 8)!;
    expect(block).toContain("BATCH MIX");
  });

  it("warm-up merge framing acknowledges BOTH behaviour AND onboarding", () => {
    // Behavioural snapshot with 5 rows + seed → seededFromOnboarding=true
    // AND non-empty recentAcceptedPatterns simulating real behaviour.
    const behavioural = {
      ...EMPTY_MEMORY,
      hookStyles: { the_way_i: 4 },
      sampleSize: 5,
      recentAcceptedPatterns: [
        {
          structure: null,
          hookStyle: "the_way_i" as const,
          emotionalSpike: null,
          format: "mini_story" as const,
          timestamp: new Date().toISOString(),
        },
      ],
    };
    const merged = applyOnboardingSeed(behavioural, seed, 5);
    const block = renderViralMemoryPromptBlock(merged, 8)!;
    expect(block).toContain("recent 5 verdicts + actions");
    expect(block).toContain("PLUS their onboarding answers");
  });

  it("warm-up merge: behavioural weight wins, seed only zero-fills", () => {
    const behavioural = {
      ...EMPTY_MEMORY,
      hookStyles: { the_way_i: 8 }, // behaviour has stronger pref
      sampleSize: 5,
    };
    const merged = applyOnboardingSeed(behavioural, seed, 5);
    expect(merged.hookStyles.the_way_i).toBe(8); // unchanged
    expect(merged.hookStyles.why_do_i).toBe(1.5); // seed-filled
  });

  it("non-seeded warm memory keeps the legacy framing line verbatim", () => {
    const warm = {
      ...EMPTY_MEMORY,
      hookStyles: { the_way_i: 4 },
      sampleSize: 12,
      seededFromOnboarding: false,
    };
    const block = renderViralMemoryPromptBlock(warm, 8)!;
    expect(block).toContain("recent 12 verdicts + actions, what's earning");
    expect(block).not.toContain("onboarding answers");
  });
});
