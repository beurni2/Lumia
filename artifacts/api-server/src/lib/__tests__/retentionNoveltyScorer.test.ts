import { describe, it, expect } from "vitest";
import {
  buildRetentionProfile,
  computeSignalAlignment,
  computeOverfitPenalty,
  computeFatigueRisk,
  computeNoveltyDistance,
  classifySlot,
  retentionSelectionBonus,
  applyBatchComposition,
  EMPTY_RETENTION_PROFILE,
} from "../retentionNoveltyScorer";
import { EMPTY_MEMORY, type ViralPatternMemory } from "../viralPatternMemory";
import type { Idea } from "../ideaGen";
import type { CandidateMeta, ScoredCandidate } from "../ideaScorer";

function makeIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    hook: "test hook",
    hookStyle: "internal_thought",
    structure: "denial_loop",
    emotionalSpike: "guilt",
    pattern: "pov",
    setting: "desk",
    howToFilm: "film at desk",
    whyItWorks: "relatable",
    hasVisualAction: true,
    hasContrast: true,
    filmingTimeMin: 5,
    payoffType: "punchline",
    ...overrides,
  } as Idea;
}

function makeMeta(overrides: Partial<CandidateMeta> = {}): CandidateMeta {
  return {
    scenarioFamily: "test_family",
    source: "pattern_variation",
    ...overrides,
  } as CandidateMeta;
}

function makeScored(
  ideaOverrides: Partial<Idea> = {},
  metaOverrides: Partial<CandidateMeta> = {},
  total = 9,
): ScoredCandidate {
  return {
    idea: makeIdea(ideaOverrides),
    meta: makeMeta(metaOverrides),
    score: {
      total,
      hookImpact: 8,
      tension: 8,
      filmability: 8,
      personalFit: 8,
      captionStrength: 8,
      freshness: 8,
    },
  } as ScoredCandidate;
}

function makeMemory(overrides: Partial<ViralPatternMemory> = {}): ViralPatternMemory {
  return {
    ...EMPTY_MEMORY,
    sampleSize: 10,
    ...overrides,
  };
}

describe("buildRetentionProfile", () => {
  it("returns empty profile for no batches", () => {
    const profile = buildRetentionProfile([]);
    expect(profile.batchDepth).toBe(0);
    expect(profile.totalEntries).toBe(0);
  });

  it("counts structures and styles from batch history", () => {
    const batches = [
      [
        { idea: makeIdea({ structure: "denial_loop", hookStyle: "internal_thought" }) },
        { idea: makeIdea({ structure: "denial_loop", hookStyle: "why_do_i" }) },
        { idea: makeIdea({ structure: "self_callout", hookStyle: "internal_thought" }) },
      ],
      [
        { idea: makeIdea({ structure: "denial_loop", hookStyle: "the_way_i" }) },
      ],
    ];
    const profile = buildRetentionProfile(batches);
    expect(profile.batchDepth).toBe(2);
    expect(profile.totalEntries).toBe(4);
    expect(profile.structureCounts["denial_loop"]).toBe(3);
    expect(profile.structureCounts["self_callout"]).toBe(1);
    expect(profile.hookStyleCounts["internal_thought"]).toBe(2);
  });
});

describe("computeSignalAlignment", () => {
  it("returns 0 when sample size < 3", () => {
    const memory = makeMemory({ sampleSize: 2 });
    const result = computeSignalAlignment(
      { idea: makeIdea(), meta: makeMeta() },
      memory,
    );
    expect(result).toBe(0);
  });

  it("boosts candidates aligned with positive signals", () => {
    const memory = makeMemory({
      structures: { denial_loop: 3 },
      hookStyles: { internal_thought: 2 },
      emotionalSpikes: { guilt: 1 },
      formats: { pov: 2 },
    });
    const result = computeSignalAlignment(
      { idea: makeIdea(), meta: makeMeta() },
      memory,
    );
    expect(result).toBeGreaterThan(0);
  });

  it("penalizes candidates aligned with negative signals", () => {
    const memory = makeMemory({
      structures: { denial_loop: -3 },
      hookStyles: { internal_thought: -2 },
      emotionalSpikes: {},
      formats: {},
    });
    const result = computeSignalAlignment(
      { idea: makeIdea(), meta: makeMeta() },
      memory,
    );
    expect(result).toBeLessThan(0);
  });

  it("adds momentum boost when matching", () => {
    const memory = makeMemory({
      structures: { denial_loop: 1 },
      momentumBoosts: [
        { tag: "denial_loop", dimension: "structure", multiplier: 1.7 },
      ],
    });
    const result = computeSignalAlignment(
      { idea: makeIdea(), meta: makeMeta() },
      memory,
    );
    expect(result).toBeGreaterThanOrEqual(3);
  });

  it("applies stale penalty when matching", () => {
    const memory = makeMemory({
      stalePenalties: [
        { tag: "denial_loop", dimension: "structure", penalty: -2 },
      ],
    });
    const result = computeSignalAlignment(
      { idea: makeIdea(), meta: makeMeta() },
      memory,
    );
    expect(result).toBeLessThan(0);
  });

  it("is clamped between -5 and 7", () => {
    const highMemory = makeMemory({
      structures: { denial_loop: 5 },
      hookStyles: { internal_thought: 5 },
      emotionalSpikes: { guilt: 5 },
      formats: { pov: 5 },
      momentumBoosts: [
        { tag: "denial_loop", dimension: "structure", multiplier: 1.7 },
        { tag: "internal_thought", dimension: "hookStyle", multiplier: 1.7 },
      ],
    });
    const result = computeSignalAlignment(
      { idea: makeIdea(), meta: makeMeta() },
      highMemory,
    );
    expect(result).toBeLessThanOrEqual(7);

    const lowMemory = makeMemory({
      structures: { denial_loop: -5 },
      hookStyles: { internal_thought: -5 },
      emotionalSpikes: { guilt: -5 },
      formats: { pov: -5 },
      stalePenalties: [
        { tag: "denial_loop", dimension: "structure", penalty: -2 },
      ],
    });
    const lowResult = computeSignalAlignment(
      { idea: makeIdea(), meta: makeMeta() },
      lowMemory,
    );
    expect(lowResult).toBeGreaterThanOrEqual(-5);
  });
});

describe("computeOverfitPenalty", () => {
  it("returns 0 for small history", () => {
    const profile = { ...EMPTY_RETENTION_PROFILE, totalEntries: 3 };
    expect(computeOverfitPenalty({ idea: makeIdea() }, profile)).toBe(0);
  });

  it("penalizes structure dominance above 50%", () => {
    const profile = {
      ...EMPTY_RETENTION_PROFILE,
      totalEntries: 10,
      structureCounts: { denial_loop: 6 },
      hookStyleCounts: {},
      emotionalSpikeCounts: {},
      formatCounts: {},
    };
    expect(computeOverfitPenalty({ idea: makeIdea() }, profile)).toBe(-3);
  });

  it("penalizes multiple axis overfit", () => {
    const profile = {
      ...EMPTY_RETENTION_PROFILE,
      totalEntries: 10,
      structureCounts: { denial_loop: 6 },
      hookStyleCounts: { internal_thought: 6 },
      emotionalSpikeCounts: { guilt: 6 },
      formatCounts: { pov: 6 },
    };
    expect(computeOverfitPenalty({ idea: makeIdea() }, profile)).toBeLessThanOrEqual(-6);
  });

  it("applies lighter penalty at 40% threshold", () => {
    const profile = {
      ...EMPTY_RETENTION_PROFILE,
      totalEntries: 10,
      structureCounts: { denial_loop: 4 },
      hookStyleCounts: { internal_thought: 4 },
      emotionalSpikeCounts: {},
      formatCounts: {},
    };
    const result = computeOverfitPenalty({ idea: makeIdea() }, profile);
    expect(result).toBe(-2);
  });
});

describe("computeFatigueRisk", () => {
  it("returns 0 for shallow history", () => {
    const profile = { ...EMPTY_RETENTION_PROFILE, batchDepth: 2 };
    expect(computeFatigueRisk({ idea: makeIdea() }, profile)).toBe(0);
  });

  it("penalizes high average frequency", () => {
    const profile = {
      ...EMPTY_RETENTION_PROFILE,
      batchDepth: 5,
      totalEntries: 10,
      structureCounts: { denial_loop: 6 },
      hookStyleCounts: { internal_thought: 6 },
      formatCounts: { pov: 6 },
    };
    expect(computeFatigueRisk({ idea: makeIdea() }, profile)).toBe(-3);
  });

  it("applies lighter penalty at moderate frequency", () => {
    const profile = {
      ...EMPTY_RETENTION_PROFILE,
      batchDepth: 3,
      totalEntries: 10,
      structureCounts: { denial_loop: 4 },
      hookStyleCounts: { internal_thought: 3 },
      formatCounts: { pov: 3 },
    };
    expect(computeFatigueRisk({ idea: makeIdea() }, profile)).toBe(-1);
  });
});

describe("computeNoveltyDistance", () => {
  it("returns 0 when no history", () => {
    expect(computeNoveltyDistance({ idea: makeIdea() }, EMPTY_RETENTION_PROFILE)).toBe(0);
  });

  it("returns 3 for candidate fresh on 3+ axes", () => {
    const profile = {
      ...EMPTY_RETENTION_PROFILE,
      totalEntries: 9,
      structureCounts: { self_callout: 5 },
      hookStyleCounts: { why_do_i: 5 },
      emotionalSpikeCounts: { panic: 5 },
      formatCounts: { pov: 5 },
    };
    const idea = makeIdea({
      structure: "denial_loop",
      hookStyle: "internal_thought",
      emotionalSpike: "guilt",
    });
    expect(computeNoveltyDistance({ idea }, profile)).toBe(3);
  });

  it("returns 0 when all axes have history", () => {
    const profile = {
      ...EMPTY_RETENTION_PROFILE,
      totalEntries: 9,
      structureCounts: { denial_loop: 3 },
      hookStyleCounts: { internal_thought: 3 },
      emotionalSpikeCounts: { guilt: 3 },
      formatCounts: { pov: 3 },
    };
    expect(computeNoveltyDistance({ idea: makeIdea() }, profile)).toBe(0);
  });
});

describe("classifySlot", () => {
  it("classifies high novelty distance as novelty", () => {
    const memory = makeMemory({ structures: {} });
    const profile = {
      ...EMPTY_RETENTION_PROFILE,
      totalEntries: 9,
      structureCounts: { self_callout: 5 },
      hookStyleCounts: { why_do_i: 5 },
      emotionalSpikeCounts: { panic: 5 },
      formatCounts: { mini_story: 5 },
    };
    const c = { idea: makeIdea(), meta: makeMeta() };
    expect(classifySlot(c, memory, profile)).toBe("novelty");
  });

  it("classifies high signal alignment as taste", () => {
    const memory = makeMemory({
      structures: { denial_loop: 4 },
      hookStyles: { internal_thought: 3 },
      emotionalSpikes: { guilt: 2 },
      formats: { pov: 2 },
    });
    const profile = {
      ...EMPTY_RETENTION_PROFILE,
      totalEntries: 9,
      structureCounts: { denial_loop: 3 },
      hookStyleCounts: { internal_thought: 3 },
      emotionalSpikeCounts: { guilt: 3 },
      formatCounts: { pov: 3 },
    };
    const c = { idea: makeIdea(), meta: makeMeta() };
    expect(classifySlot(c, memory, profile)).toBe("taste");
  });

  it("classifies default as hero", () => {
    const memory = makeMemory({ structures: { denial_loop: 1 } });
    const profile = {
      ...EMPTY_RETENTION_PROFILE,
      totalEntries: 9,
      structureCounts: { denial_loop: 3 },
      hookStyleCounts: { internal_thought: 3 },
      emotionalSpikeCounts: { guilt: 3 },
      formatCounts: { pov: 3 },
    };
    const c = { idea: makeIdea(), meta: makeMeta() };
    expect(classifySlot(c, memory, profile)).toBe("hero");
  });
});

describe("retentionSelectionBonus", () => {
  it("returns 0 for first session (batchDepth 0)", () => {
    const result = retentionSelectionBonus(
      { idea: makeIdea(), meta: makeMeta() },
      makeMemory(),
      EMPTY_RETENTION_PROFILE,
    );
    expect(result).toBe(0);
  });

  it("is clamped between -8 and 5", () => {
    const highMemory = makeMemory({
      structures: { denial_loop: 5 },
      hookStyles: { internal_thought: 5 },
      emotionalSpikes: { guilt: 5 },
      formats: { pov: 5 },
    });
    const profile = {
      ...EMPTY_RETENTION_PROFILE,
      batchDepth: 3,
      totalEntries: 3,
    };
    const result = retentionSelectionBonus(
      { idea: makeIdea(), meta: makeMeta() },
      highMemory,
      profile,
    );
    expect(result).toBeLessThanOrEqual(5);
    expect(result).toBeGreaterThanOrEqual(-8);
  });

  it("negative for overfitted + fatigued candidates", () => {
    const memory = makeMemory({
      structures: { denial_loop: -1 },
      hookStyles: { internal_thought: -1 },
    });
    const profile = {
      ...EMPTY_RETENTION_PROFILE,
      batchDepth: 5,
      totalEntries: 12,
      structureCounts: { denial_loop: 8 },
      hookStyleCounts: { internal_thought: 8 },
      emotionalSpikeCounts: { guilt: 7 },
      formatCounts: { pov: 7 },
    };
    const result = retentionSelectionBonus(
      { idea: makeIdea(), meta: makeMeta() },
      memory,
      profile,
    );
    expect(result).toBeLessThan(0);
  });
});

describe("applyBatchComposition", () => {
  it("returns batch unchanged when fewer than 3", () => {
    const batch = [makeScored(), makeScored()];
    const result = applyBatchComposition(batch, makeMemory(), EMPTY_RETENTION_PROFILE);
    expect(result).toEqual(batch);
  });

  it("returns batch unchanged when batchDepth < 2", () => {
    const batch = [makeScored(), makeScored(), makeScored()];
    const profile = { ...EMPTY_RETENTION_PROFILE, batchDepth: 1 };
    const result = applyBatchComposition(batch, makeMemory(), profile);
    expect(result).toEqual(batch);
  });

  it("reorders batch for diversity when slots differ", () => {
    const hero = makeScored({}, {}, 10);
    const taste = makeScored(
      { structure: "self_callout", hookStyle: "why_do_i" },
      {},
      8,
    );
    const novelty = makeScored(
      {
        structure: "avoidance",
        hookStyle: "contrast",
        emotionalSpike: "panic",
        pattern: "mini_story",
      },
      {},
      7,
    );
    const memory = makeMemory({
      structures: { self_callout: 4 },
      hookStyles: { why_do_i: 3 },
      emotionalSpikes: {},
      formats: {},
    });
    const profile = {
      ...EMPTY_RETENTION_PROFILE,
      batchDepth: 3,
      totalEntries: 9,
      structureCounts: { denial_loop: 5 },
      hookStyleCounts: { internal_thought: 5 },
      emotionalSpikeCounts: { guilt: 5 },
      formatCounts: { pov: 5 },
    };
    const result = applyBatchComposition(
      [hero, taste, novelty],
      memory,
      profile,
    );
    expect(result).toHaveLength(3);
  });

  it("preserves all candidates in output", () => {
    const candidates = [
      makeScored({ hook: "hook1" }, {}, 10),
      makeScored({ hook: "hook2" }, {}, 9),
      makeScored({ hook: "hook3" }, {}, 8),
      makeScored({ hook: "hook4" }, {}, 7),
    ];
    const memory = makeMemory({
      structures: { denial_loop: 2 },
    });
    const profile = {
      ...EMPTY_RETENTION_PROFILE,
      batchDepth: 3,
      totalEntries: 9,
      structureCounts: { denial_loop: 3 },
      hookStyleCounts: { internal_thought: 3 },
      emotionalSpikeCounts: { guilt: 3 },
      formatCounts: { pov: 3 },
    };
    const result = applyBatchComposition(candidates, memory, profile);
    expect(result).toHaveLength(4);
    const hooks = result.map((c) => c.idea.hook);
    expect(hooks).toContain("hook1");
    expect(hooks).toContain("hook2");
    expect(hooks).toContain("hook3");
    expect(hooks).toContain("hook4");
  });
});
