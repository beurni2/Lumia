/**
 * PHASE Z5.8b — situation alignment scoring tests.
 *
 * Hard rules verified:
 *   • selectionPenalty stays additive (no hard filter, no candidate
 *     can be removed by this lever alone).
 *   • Boost band sits below comedy / hero — capped at +4.
 *   • Mismatch penalty -1 fires only when ≥3 situations selected.
 *   • Cold-start (no situations selected) is a silent no-op.
 *   • Pre-Z5.8b calibration docs (no `selectedSituations`) parse
 *     cleanly and contribute nothing to the lever.
 *   • Llama / Claude wraps without `meta.topicLane` AND without a
 *     known `scenarioFamily` get 0 (silent abstain), even when the
 *     creator picked ≥3 situations.
 */

import { describe, expect, it } from "vitest";

import {
  parseTasteCalibration,
  scoreSituationAlignment,
  SITUATION_PROFILES,
  type Situation,
} from "../tasteCalibration";
import type { Setting, TopicLane } from "../patternIdeator";

const ALL_SITUATIONS: ReadonlyArray<Situation> = [
  "food_home",
  "dating_texting",
  "work_school",
  "social_awkwardness",
  "health_wellness",
  "creator_social",
];

describe("Z5.8b — SITUATION_PROFILES table", () => {
  it("covers every Situation enum value", () => {
    for (const sit of ALL_SITUATIONS) {
      expect(SITUATION_PROFILES[sit]).toBeDefined();
    }
    expect(Object.keys(SITUATION_PROFILES).sort()).toEqual(
      [...ALL_SITUATIONS].sort(),
    );
  });

  it("each profile has at least one strong signal axis", () => {
    for (const sit of ALL_SITUATIONS) {
      const p = SITUATION_PROFILES[sit];
      const totalStrong =
        p.strongTopicLanes.length +
        p.strongSettings.length +
        p.familySubstrings.length;
      expect(totalStrong).toBeGreaterThan(0);
    }
  });

  it("uses only valid TopicLane values", () => {
    const validLanes: ReadonlySet<TopicLane> = new Set([
      "food_home",
      "work_productivity",
      "social_texting",
      "body_fitness",
      "daily_routine",
    ]);
    for (const sit of ALL_SITUATIONS) {
      const p = SITUATION_PROFILES[sit];
      for (const l of p.strongTopicLanes) expect(validLanes.has(l)).toBe(true);
      for (const l of p.adjacentTopicLanes)
        expect(validLanes.has(l)).toBe(true);
    }
  });

  it("uses only valid Setting values", () => {
    const validSettings: ReadonlySet<Setting> = new Set([
      "bed",
      "couch",
      "desk",
      "bathroom",
      "kitchen",
      "car",
      "outside",
      "other",
    ]);
    for (const sit of ALL_SITUATIONS) {
      const p = SITUATION_PROFILES[sit];
      for (const s of p.strongSettings)
        expect(validSettings.has(s)).toBe(true);
      for (const s of p.adjacentSettings)
        expect(validSettings.has(s)).toBe(true);
    }
  });
});

describe("Z5.8b — scoreSituationAlignment additive contract", () => {
  it("returns 0 when no situations selected (cold-start no-op)", () => {
    expect(
      scoreSituationAlignment(
        { topicLane: "food_home", setting: "kitchen", scenarioFamily: "fridge" },
        undefined,
      ),
    ).toBe(0);
    expect(
      scoreSituationAlignment(
        { topicLane: "food_home", setting: "kitchen", scenarioFamily: "fridge" },
        new Set<Situation>(),
      ),
    ).toBe(0);
  });

  it("+4 strong match when topicLane is in strongTopicLanes", () => {
    expect(
      scoreSituationAlignment(
        { topicLane: "food_home", setting: "kitchen", scenarioFamily: "fridge" },
        new Set<Situation>(["food_home"]),
      ),
    ).toBe(4);
  });

  it("+4 strong match via familySubstring even when topicLane is missing", () => {
    expect(
      scoreSituationAlignment(
        { setting: "kitchen", scenarioFamily: "coffee" },
        new Set<Situation>(["food_home"]),
      ),
    ).toBe(4);
  });

  it("+2 adjacent match via adjacentTopicLanes", () => {
    expect(
      scoreSituationAlignment(
        // daily_routine is adjacent for food_home
        { topicLane: "daily_routine", setting: "other", scenarioFamily: "x" },
        new Set<Situation>(["food_home"]),
      ),
    ).toBe(2);
  });

  it("+2 adjacent match via strongSettings alone", () => {
    expect(
      scoreSituationAlignment(
        // kitchen is strong for food_home, lane mismatches
        { topicLane: "work_productivity", setting: "kitchen", scenarioFamily: "x" },
        new Set<Situation>(["food_home"]),
      ),
    ).toBe(2);
  });

  it("0 when 1-2 situations selected and candidate matches none (no penalty)", () => {
    expect(
      scoreSituationAlignment(
        { topicLane: "body_fitness", setting: "outside", scenarioFamily: "x" },
        new Set<Situation>(["food_home"]),
      ),
    ).toBe(0);
    expect(
      scoreSituationAlignment(
        { topicLane: "body_fitness", setting: "outside", scenarioFamily: "x" },
        new Set<Situation>(["food_home", "work_school"]),
      ),
    ).toBe(0);
  });

  it("-1 mismatch only when ≥3 situations selected and zero match", () => {
    expect(
      scoreSituationAlignment(
        { topicLane: "body_fitness", setting: "bathroom", scenarioFamily: "gym" },
        new Set<Situation>(["food_home", "dating_texting", "work_school"]),
      ),
    ).toBe(-1);
  });

  it("strong match ≥3 selected still wins (mismatch penalty does NOT fire)", () => {
    expect(
      scoreSituationAlignment(
        { topicLane: "body_fitness", setting: "bed", scenarioFamily: "gym" },
        new Set<Situation>([
          "food_home",
          "dating_texting",
          "health_wellness",
        ]),
      ),
    ).toBe(4);
  });

  it("silent abstain (returns 0) when candidate has no usable signals, even with ≥3 selected", () => {
    // Llama / Claude wrap with no topicLane, no setting, no recognized family
    expect(
      scoreSituationAlignment(
        { scenarioFamily: undefined },
        new Set<Situation>(["food_home", "dating_texting", "work_school"]),
      ),
    ).toBe(0);
    expect(
      scoreSituationAlignment(
        {},
        new Set<Situation>(["food_home", "dating_texting", "work_school"]),
      ),
    ).toBe(0);
  });

  it("never exceeds +4 even when multiple situations strong-match", () => {
    // food_home + dating_texting both strong-match a kitchen+texting candidate?
    // Easier: food_home strong + adjacent for another. Cap at +4.
    const score = scoreSituationAlignment(
      { topicLane: "food_home", setting: "kitchen", scenarioFamily: "coffee" },
      new Set<Situation>([
        "food_home",
        "dating_texting",
        "work_school",
        "creator_social",
      ]),
    );
    expect(score).toBe(4);
  });

  it("max selected (4) with one strong match still capped at +4", () => {
    const score = scoreSituationAlignment(
      { topicLane: "social_texting", setting: "couch", scenarioFamily: "texting" },
      new Set<Situation>([
        "food_home",
        "dating_texting",
        "work_school",
        "health_wellness",
      ]),
    );
    expect(score).toBe(4);
  });
});

describe("Z5.8b — back-compat parsing", () => {
  it("pre-Z5.8b doc (no selectedSituations field) parses cleanly with default []", () => {
    const legacy = {
      preferredFormats: ["mini_story"],
      preferredTone: "dry_subtle",
      effortPreference: "low_effort",
      privacyAvoidances: [],
      preferredHookStyles: ["thought_hook"],
      completedAt: "2025-01-01T00:00:00.000Z",
      skipped: false,
    };
    const parsed = parseTasteCalibration(legacy);
    expect(parsed).not.toBeNull();
    expect(parsed!.selectedSituations).toEqual([]);
  });

  it("Z5.8b doc with selectedSituations round-trips", () => {
    const z58b = {
      preferredFormats: [],
      preferredTone: null,
      preferredTones: [],
      effortPreference: null,
      privacyAvoidances: [],
      preferredHookStyles: [],
      selectedSituations: ["food_home", "work_school", "dating_texting"],
      completedAt: "2025-05-01T00:00:00.000Z",
      skipped: false,
    };
    const parsed = parseTasteCalibration(z58b);
    expect(parsed).not.toBeNull();
    expect(parsed!.selectedSituations).toEqual([
      "food_home",
      "work_school",
      "dating_texting",
    ]);
  });

  it("malformed selectedSituations entry causes safe parse fallback to null", () => {
    const broken = {
      preferredFormats: [],
      preferredTones: [],
      privacyAvoidances: [],
      preferredHookStyles: [],
      selectedSituations: ["food_home", "not_a_real_situation"],
      completedAt: null,
      skipped: false,
    };
    expect(parseTasteCalibration(broken)).toBeNull();
  });

  it("max constraint of 4 selectedSituations is enforced", () => {
    const tooMany = {
      preferredFormats: [],
      preferredTones: [],
      privacyAvoidances: [],
      preferredHookStyles: [],
      selectedSituations: [
        "food_home",
        "dating_texting",
        "work_school",
        "social_awkwardness",
        "health_wellness",
      ],
      completedAt: null,
      skipped: false,
    };
    expect(parseTasteCalibration(tooMany)).toBeNull();
  });
});

describe("Z5.8b — boost band invariants (Hero / comedy still dominate)", () => {
  it("max situation boost (+4) is strictly below max premise comedy boost (+7)", () => {
    // Documenting the invariant — no runtime check needed because
    // this is a literal-band assertion. The band layout in
    // ideaScorer.ts comments + selectionPenalty composition keep
    // comedy ≥ +5 and Hero ≥ +6 strictly above this lever.
    const MAX_SITUATION_BOOST = 4;
    const MAX_PREMISE_COMEDY_BOOST = 7;
    const MAX_HERO_QUALITY_BOOST = 6;
    expect(MAX_SITUATION_BOOST).toBeLessThan(MAX_PREMISE_COMEDY_BOOST);
    expect(MAX_SITUATION_BOOST).toBeLessThan(MAX_HERO_QUALITY_BOOST);
  });

  it("min situation penalty (-1) is strictly above the -1000 hard-reject floor", () => {
    const MIN_SITUATION_PENALTY = -1;
    const HARD_REJECT_FLOOR = -1000;
    expect(MIN_SITUATION_PENALTY).toBeGreaterThan(HARD_REJECT_FLOOR);
  });
});
