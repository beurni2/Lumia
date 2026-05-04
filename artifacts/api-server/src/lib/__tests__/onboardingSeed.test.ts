/**
 * Phase Y9 — onboardingSeed.ts unit tests.
 *
 * Covers the pure mapping from the three onboarding documents
 * (taste_calibration_json, style_profile_json, vision_style_json)
 * into the `OnboardingSeed` shape consumed by
 * `applyOnboardingSeed`.
 */

import { describe, expect, it } from "vitest";

import {
  applyOnboardingSeed,
  buildOnboardingSeed,
  CALIBRATION_WEIGHT,
  DERIVED_WEIGHT,
  WARMUP_THRESHOLD,
  type OnboardingSeed,
} from "../onboardingSeed";
import {
  EMPTY_MEMORY,
  type ViralPatternMemory,
} from "../viralPatternMemory";
import { DEFAULT_STYLE_PROFILE, type StyleProfile } from "../styleProfile";
import { EMPTY_VISION_STYLE_DOC } from "../visionProfileAggregator";
import type { TasteCalibration } from "../tasteCalibration";

const baseCal = (overrides: Partial<TasteCalibration> = {}): TasteCalibration => ({
  preferredFormats: [],
  preferredTone: null,
  preferredTones: [],
  effortPreference: null,
  privacyAvoidances: [],
  preferredHookStyles: [],
  // PHASE Z5.8 — required-default for the new situations field;
  // existing tests don't exercise it, so [] is the right baseline.
  selectedSituations: [],
  completedAt: "2026-04-01T00:00:00.000Z",
  skipped: false,
  ...overrides,
});

const realisticProfile = (
  overrides: Partial<StyleProfile> = {},
): StyleProfile => ({
  ...DEFAULT_STYLE_PROFILE,
  // Mark as "real" by populating topic keywords (the heuristic
  // buildOnboardingSeed uses to distinguish a real profile from the
  // identity DEFAULT_STYLE_PROFILE).
  topics: {
    ...DEFAULT_STYLE_PROFILE.topics,
    keywords: ["coffee", "morning", "routine"],
  },
  ...overrides,
});

describe("buildOnboardingSeed", () => {
  describe("calibration → hookStyles cross-walk", () => {
    it("maps behavior_hook → the_way_i with CALIBRATION_WEIGHT", () => {
      const seed = buildOnboardingSeed({
        tasteCalibration: baseCal({ preferredHookStyles: ["behavior_hook"] }),
        styleProfile: null,
        visionStyleDoc: null,
      });
      expect(seed?.hookStyles.the_way_i).toBe(CALIBRATION_WEIGHT);
      expect(seed?.sources).toContain("taste_calibration");
    });

    it("maps thought_hook → why_do_i", () => {
      const seed = buildOnboardingSeed({
        tasteCalibration: baseCal({ preferredHookStyles: ["thought_hook"] }),
        styleProfile: null,
        visionStyleDoc: null,
      });
      expect(seed?.hookStyles.why_do_i).toBe(CALIBRATION_WEIGHT);
    });

    it("maps curiosity_hook → curiosity", () => {
      const seed = buildOnboardingSeed({
        tasteCalibration: baseCal({ preferredHookStyles: ["curiosity_hook"] }),
        styleProfile: null,
        visionStyleDoc: null,
      });
      expect(seed?.hookStyles.curiosity).toBe(CALIBRATION_WEIGHT);
    });

    it("maps contrast_hook → contrast", () => {
      const seed = buildOnboardingSeed({
        tasteCalibration: baseCal({ preferredHookStyles: ["contrast_hook"] }),
        styleProfile: null,
        visionStyleDoc: null,
      });
      expect(seed?.hookStyles.contrast).toBe(CALIBRATION_WEIGHT);
    });

    it("stacks multiple calibration hook styles additively", () => {
      const seed = buildOnboardingSeed({
        tasteCalibration: baseCal({
          preferredHookStyles: ["behavior_hook", "curiosity_hook"],
        }),
        styleProfile: null,
        visionStyleDoc: null,
      });
      expect(seed?.hookStyles.the_way_i).toBe(CALIBRATION_WEIGHT);
      expect(seed?.hookStyles.curiosity).toBe(CALIBRATION_WEIGHT);
    });
  });

  describe("calibration → formats cross-walk", () => {
    it("maps mini_story / reaction / pov to formats Record", () => {
      const seed = buildOnboardingSeed({
        tasteCalibration: baseCal({
          preferredFormats: ["mini_story", "reaction", "pov"],
        }),
        styleProfile: null,
        visionStyleDoc: null,
      });
      expect(seed?.formats.mini_story).toBe(CALIBRATION_WEIGHT);
      expect(seed?.formats.reaction).toBe(CALIBRATION_WEIGHT);
      expect(seed?.formats.pov).toBe(CALIBRATION_WEIGHT);
    });

    it("'mixed' is a no-op — does not bump any format key", () => {
      const seed = buildOnboardingSeed({
        tasteCalibration: baseCal({ preferredFormats: ["mixed"] }),
        styleProfile: null,
        visionStyleDoc: null,
      });
      // mixed alone with no other contributions → no seed at all
      expect(seed).toBeNull();
    });

    it("'mixed' alongside concrete formats keeps only the concrete picks", () => {
      const seed = buildOnboardingSeed({
        tasteCalibration: baseCal({
          preferredFormats: ["mixed", "mini_story"],
        }),
        styleProfile: null,
        visionStyleDoc: null,
      });
      expect(seed?.formats.mini_story).toBe(CALIBRATION_WEIGHT);
      expect(seed?.formats.reaction).toBeUndefined();
      expect(seed?.formats.pov).toBeUndefined();
    });
  });

  describe("style profile → hookStyles cross-walk", () => {
    it("question → why_do_i with DERIVED_WEIGHT", () => {
      const seed = buildOnboardingSeed({
        tasteCalibration: null,
        styleProfile: realisticProfile({
          hookStyle: { primary: "question", distribution: { question: 1, boldStatement: 0, sceneSetter: 0 }, sampleHooks: [] },
        }),
        visionStyleDoc: null,
      });
      expect(seed?.hookStyles.why_do_i).toBe(DERIVED_WEIGHT);
      expect(seed?.sources).toContain("style_profile");
    });

    it("boldStatement → contrast", () => {
      const seed = buildOnboardingSeed({
        tasteCalibration: null,
        styleProfile: realisticProfile({
          hookStyle: { primary: "boldStatement", distribution: { question: 0, boldStatement: 1, sceneSetter: 0 }, sampleHooks: [] },
        }),
        visionStyleDoc: null,
      });
      expect(seed?.hookStyles.contrast).toBe(DERIVED_WEIGHT);
    });

    it("sceneSetter → the_way_i", () => {
      const seed = buildOnboardingSeed({
        tasteCalibration: null,
        styleProfile: realisticProfile({
          hookStyle: { primary: "sceneSetter", distribution: { question: 0, boldStatement: 0, sceneSetter: 1 }, sampleHooks: [] },
        }),
        visionStyleDoc: null,
      });
      expect(seed?.hookStyles.the_way_i).toBe(DERIVED_WEIGHT);
    });

    it("DEFAULT_STYLE_PROFILE alone does NOT contribute (no real signal)", () => {
      const seed = buildOnboardingSeed({
        tasteCalibration: null,
        styleProfile: DEFAULT_STYLE_PROFILE,
        visionStyleDoc: null,
      });
      // Default profile heuristic → no seed, no source
      expect(seed).toBeNull();
    });
  });

  describe("vision → formats cross-walk", () => {
    const visionWith = (formats: string[]) => ({
      ...EMPTY_VISION_STYLE_DOC,
      totalAnalyzed: 3,
      derivedStyleHints: {
        ...EMPTY_VISION_STYLE_DOC.derivedStyleHints,
        // Cast through unknown so the test can supply enum values
        // for any contentType branch without the per-test Schema
        // cast tax.
        preferredFormats: formats as never,
      },
    });

    it("mini_story / reaction / pov pass through directly", () => {
      const seed = buildOnboardingSeed({
        tasteCalibration: null,
        styleProfile: null,
        visionStyleDoc: visionWith(["mini_story", "reaction", "pov"]),
      });
      expect(seed?.formats.mini_story).toBe(DERIVED_WEIGHT);
      expect(seed?.formats.reaction).toBe(DERIVED_WEIGHT);
      expect(seed?.formats.pov).toBe(DERIVED_WEIGHT);
      expect(seed?.sources).toContain("vision_style");
    });

    it("talking_head / lifestyle / unknown are SKIPPED (no map)", () => {
      const seed = buildOnboardingSeed({
        tasteCalibration: null,
        styleProfile: null,
        visionStyleDoc: visionWith(["talking_head", "lifestyle", "unknown"]),
      });
      expect(seed).toBeNull();
    });

    it("vision doc with totalAnalyzed=0 does NOT contribute", () => {
      const seed = buildOnboardingSeed({
        tasteCalibration: null,
        styleProfile: null,
        visionStyleDoc: { ...EMPTY_VISION_STYLE_DOC, totalAnalyzed: 0 },
      });
      expect(seed).toBeNull();
    });
  });

  describe("stacking across sources", () => {
    it("calibration + style profile both contributing to same key SUM weights", () => {
      const seed = buildOnboardingSeed({
        tasteCalibration: baseCal({ preferredHookStyles: ["behavior_hook"] }),
        styleProfile: realisticProfile({
          hookStyle: { primary: "sceneSetter", distribution: { question: 0, boldStatement: 0, sceneSetter: 1 }, sampleHooks: [] },
        }),
        visionStyleDoc: null,
      });
      // Both → the_way_i
      expect(seed?.hookStyles.the_way_i).toBe(
        CALIBRATION_WEIGHT + DERIVED_WEIGHT,
      );
      expect(seed?.sources).toEqual([
        "taste_calibration",
        "style_profile",
      ]);
    });

    it("calibration + vision both contributing to same format SUM weights", () => {
      const seed = buildOnboardingSeed({
        tasteCalibration: baseCal({ preferredFormats: ["reaction"] }),
        styleProfile: null,
        visionStyleDoc: {
          ...EMPTY_VISION_STYLE_DOC,
          totalAnalyzed: 5,
          derivedStyleHints: {
            ...EMPTY_VISION_STYLE_DOC.derivedStyleHints,
            preferredFormats: ["reaction"] as never,
          },
        },
      });
      expect(seed?.formats.reaction).toBe(
        CALIBRATION_WEIGHT + DERIVED_WEIGHT,
      );
      expect(seed?.sources).toEqual(["taste_calibration", "vision_style"]);
    });
  });

  describe("edge cases", () => {
    it("all empty inputs → null", () => {
      expect(
        buildOnboardingSeed({
          tasteCalibration: null,
          styleProfile: null,
          visionStyleDoc: null,
        }),
      ).toBeNull();
    });

    it("skipped calibration is treated as no calibration", () => {
      const seed = buildOnboardingSeed({
        tasteCalibration: baseCal({
          skipped: true,
          preferredHookStyles: ["behavior_hook"],
          preferredFormats: ["mini_story"],
        }),
        styleProfile: null,
        visionStyleDoc: null,
      });
      // Skipped → all calibration arrays ignored → no seed
      expect(seed).toBeNull();
    });

    it("sampleSize counts distinct positive entries across all dims", () => {
      const seed = buildOnboardingSeed({
        tasteCalibration: baseCal({
          preferredHookStyles: ["behavior_hook", "curiosity_hook"],
          preferredFormats: ["mini_story", "reaction"],
        }),
        styleProfile: null,
        visionStyleDoc: null,
      });
      // 2 hookStyles + 2 formats = 4 distinct entries
      expect(seed?.sampleSize).toBe(4);
    });

    it("sampleSize counts a stacked tag as ONE entry (not two)", () => {
      const seed = buildOnboardingSeed({
        tasteCalibration: baseCal({ preferredHookStyles: ["behavior_hook"] }),
        styleProfile: realisticProfile({
          hookStyle: { primary: "sceneSetter", distribution: { question: 0, boldStatement: 0, sceneSetter: 1 }, sampleHooks: [] },
        }),
        visionStyleDoc: null,
      });
      // Both contribute to the_way_i — count = 1, weight = stacked
      expect(seed?.sampleSize).toBe(1);
    });
  });
});

describe("applyOnboardingSeed", () => {
  const seed: OnboardingSeed = {
    structures: {},
    hookStyles: { the_way_i: 3, why_do_i: 1.5 },
    emotionalSpikes: {},
    formats: { mini_story: 3, reaction: 1.5 },
    sampleSize: 4,
    sources: ["taste_calibration", "style_profile"],
  };

  it("returns memory unchanged when seed is null", () => {
    const out = applyOnboardingSeed(EMPTY_MEMORY, null, 0);
    expect(out).toBe(EMPTY_MEMORY);
  });

  it("cold-start (totalRows=0): seed populates all four dims, sampleSize = seed.sampleSize", () => {
    const out = applyOnboardingSeed(EMPTY_MEMORY, seed, 0);
    expect(out.hookStyles).toEqual({ the_way_i: 3, why_do_i: 1.5 });
    expect(out.formats).toEqual({ mini_story: 3, reaction: 1.5 });
    expect(out.sampleSize).toBe(4);
    expect(out.seededFromOnboarding).toBe(true);
  });

  it("warm-up (0 < totalRows < WARMUP): zero-fills behavioural gaps from seed, keeps behavioural sampleSize", () => {
    const behavioural: ViralPatternMemory = {
      ...EMPTY_MEMORY,
      hookStyles: { the_way_i: 5 }, // behaviour already prefers this
      formats: {}, // behaviour has nothing for formats
      sampleSize: 3,
    };
    const out = applyOnboardingSeed(behavioural, seed, 3);
    // hookStyles.the_way_i: behavioural wins (5), seed's 3 ignored
    expect(out.hookStyles.the_way_i).toBe(5);
    // hookStyles.why_do_i: behavioural=0 → zero-filled from seed
    expect(out.hookStyles.why_do_i).toBe(1.5);
    // formats: all zero-filled from seed
    expect(out.formats.mini_story).toBe(3);
    expect(out.formats.reaction).toBe(1.5);
    // sampleSize NOT inflated by seed
    expect(out.sampleSize).toBe(3);
    expect(out.seededFromOnboarding).toBe(true);
  });

  it("zero-fill respects negative behavioural weights — never overwrites", () => {
    const behavioural: ViralPatternMemory = {
      ...EMPTY_MEMORY,
      hookStyles: { the_way_i: -3 }, // creator actively rejected this
      sampleSize: 5,
    };
    const out = applyOnboardingSeed(behavioural, seed, 5);
    // Seed's +3 must NOT paper over the -3 behavioural rejection
    expect(out.hookStyles.the_way_i).toBe(-3);
  });

  it("WARMUP_THRESHOLD constant matches the spec (= 8)", () => {
    expect(WARMUP_THRESHOLD).toBe(8);
  });
});
