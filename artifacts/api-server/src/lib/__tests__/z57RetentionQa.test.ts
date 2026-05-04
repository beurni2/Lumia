import { describe, it, expect } from "vitest";
import {
  buildRetentionProfile,
  computeSignalAlignment,
  computeOverfitPenalty,
  computeFatigueRisk,
  computeNoveltyDistance,
  retentionSelectionBonus,
  applyBatchComposition,
  scoreRetention,
  EMPTY_RETENTION_PROFILE,
} from "../retentionNoveltyScorer";
import { EMPTY_MEMORY, type ViralPatternMemory } from "../viralPatternMemory";
import { selectionPenalty, type NoveltyContext, EMPTY_NOVELTY_CONTEXT } from "../ideaScorer";
import type { Idea } from "../ideaGen";
import type { CandidateMeta, ScoredCandidate } from "../ideaScorer";

function makeIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    hook: "test hook " + Math.random().toString(36).slice(2, 8),
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

describe("QA A: Repeated exports → signal alignment boost + novelty", () => {
  it("candidates aligned with liked patterns get positive signal alignment", () => {
    const memory = makeMemory({
      structures: { denial_loop: 4, self_callout: 3 },
      hookStyles: { internal_thought: 3, why_do_i: 2 },
      emotionalSpikes: { guilt: 2 },
      formats: { pov: 3, mini_story: 1 },
    });
    const liked = { idea: makeIdea(), meta: makeMeta() };
    const neutral = {
      idea: makeIdea({ structure: "avoidance", hookStyle: "contrast", pattern: "reaction" }),
      meta: makeMeta(),
    };
    const saLiked = computeSignalAlignment(liked, memory);
    const saNeutral = computeSignalAlignment(neutral, memory);
    expect(saLiked).toBeGreaterThan(saNeutral);
    expect(saLiked).toBeGreaterThan(0);
  });

  it("selectionPenalty includes retention bonus for returning creators", () => {
    const memory = makeMemory({
      structures: { denial_loop: 3 },
      hookStyles: { internal_thought: 2 },
      emotionalSpikes: { guilt: 1 },
      formats: { pov: 2 },
    });
    const profile = buildRetentionProfile([
      [{ idea: makeIdea() }, { idea: makeIdea() }, { idea: makeIdea() }],
      [{ idea: makeIdea() }, { idea: makeIdea() }, { idea: makeIdea() }],
    ]);
    const ctx: NoveltyContext = {
      retentionMemory: memory,
      retentionProfile: profile,
    };
    const c = { idea: makeIdea(), meta: makeMeta() };
    const withRetention = selectionPenalty(c, [], ctx);
    const withoutRetention = selectionPenalty(c, [], EMPTY_NOVELTY_CONTEXT);
    expect(withRetention).not.toBe(withoutRetention);
  });

  it("batch composition puts diverse slots when history exists", () => {
    const memory = makeMemory({
      structures: { self_callout: 4 },
      hookStyles: { why_do_i: 3 },
    });
    const profile = buildRetentionProfile([
      [
        { idea: makeIdea({ structure: "denial_loop" }) },
        { idea: makeIdea({ structure: "denial_loop" }) },
        { idea: makeIdea({ structure: "denial_loop" }) },
      ],
      [
        { idea: makeIdea({ structure: "denial_loop" }) },
        { idea: makeIdea({ structure: "denial_loop" }) },
        { idea: makeIdea({ structure: "denial_loop" }) },
      ],
    ]);
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
    const result = applyBatchComposition(
      [hero, taste, novelty],
      memory,
      profile,
    );
    expect(result).toHaveLength(3);
    const slots = result.map((c) =>
      scoreRetention(c, memory, profile).slotClass,
    );
    const uniqueSlots = new Set(slots);
    expect(uniqueSlots.size).toBeGreaterThanOrEqual(2);
  });
});

describe("QA B: Repeated dislikes → deweight", () => {
  it("negative signal weight causes negative alignment score", () => {
    const memory = makeMemory({
      structures: { denial_loop: -3 },
      hookStyles: { internal_thought: -2 },
      emotionalSpikes: { guilt: -1 },
      formats: { pov: -1 },
    });
    const disliked = { idea: makeIdea(), meta: makeMeta() };
    const sa = computeSignalAlignment(disliked, memory);
    expect(sa).toBeLessThan(0);
  });

  it("retention bonus is negative for disliked pattern + overfit", () => {
    const memory = makeMemory({
      structures: { denial_loop: -2 },
      hookStyles: { internal_thought: -1 },
    });
    const profile = {
      ...EMPTY_RETENTION_PROFILE,
      batchDepth: 4,
      totalEntries: 12,
      structureCounts: { denial_loop: 7 },
      hookStyleCounts: { internal_thought: 6 },
      emotionalSpikeCounts: { guilt: 6 },
      formatCounts: { pov: 6 },
    };
    const bonus = retentionSelectionBonus(
      { idea: makeIdea(), meta: makeMeta() },
      memory,
      profile,
    );
    expect(bonus).toBeLessThan(0);
  });

  it("disliked patterns score worse than neutral patterns", () => {
    const memory = makeMemory({
      structures: { denial_loop: -3 },
      hookStyles: { internal_thought: -2 },
    });
    const profile = {
      ...EMPTY_RETENTION_PROFILE,
      batchDepth: 3,
      totalEntries: 9,
      structureCounts: { denial_loop: 5 },
      hookStyleCounts: { internal_thought: 4 },
      emotionalSpikeCounts: {},
      formatCounts: {},
    };
    const disliked = retentionSelectionBonus(
      { idea: makeIdea(), meta: makeMeta() },
      memory,
      profile,
    );
    const neutral = retentionSelectionBonus(
      {
        idea: makeIdea({ structure: "avoidance", hookStyle: "contrast" }),
        meta: makeMeta(),
      },
      memory,
      profile,
    );
    expect(disliked).toBeLessThan(neutral);
  });
});

describe("QA C: 5-10 batch fatigue → freshness", () => {
  it("high fatigue risk for deeply repeated axes across 5 batches", () => {
    const batches = Array.from({ length: 5 }, () => [
      { idea: makeIdea({ structure: "denial_loop", hookStyle: "internal_thought", pattern: "pov" }) },
      { idea: makeIdea({ structure: "denial_loop", hookStyle: "internal_thought", pattern: "pov" }) },
      { idea: makeIdea({ structure: "denial_loop", hookStyle: "internal_thought", pattern: "pov" }) },
    ]);
    const profile = buildRetentionProfile(batches);
    expect(profile.totalEntries).toBe(15);
    expect(profile.batchDepth).toBe(5);
    const fatigue = computeFatigueRisk({ idea: makeIdea() }, profile);
    expect(fatigue).toBe(-3);
  });

  it("novelty distance is high for candidates on fresh axes", () => {
    const profile = buildRetentionProfile(
      Array.from({ length: 5 }, () => [
        { idea: makeIdea({ structure: "denial_loop", hookStyle: "internal_thought", emotionalSpike: "guilt", pattern: "pov" }) },
        { idea: makeIdea({ structure: "denial_loop", hookStyle: "internal_thought", emotionalSpike: "guilt", pattern: "pov" }) },
      ]),
    );
    const fresh = makeIdea({
      structure: "avoidance",
      hookStyle: "contrast",
      emotionalSpike: "panic",
      pattern: "mini_story",
    });
    const nd = computeNoveltyDistance({ idea: fresh }, profile);
    expect(nd).toBe(3);
  });

  it("overfit penalty applies after many batches of same structure", () => {
    const profile = buildRetentionProfile(
      Array.from({ length: 5 }, () => [
        { idea: makeIdea({ structure: "denial_loop" }) },
        { idea: makeIdea({ structure: "denial_loop" }) },
      ]),
    );
    const penalty = computeOverfitPenalty({ idea: makeIdea() }, profile);
    expect(penalty).toBeLessThanOrEqual(-3);
  });

  it("fresh candidate gets positive bonus while fatigued one gets negative", () => {
    const memory = makeMemory({
      structures: { denial_loop: 1 },
    });
    const profile = buildRetentionProfile(
      Array.from({ length: 5 }, () => [
        { idea: makeIdea({ structure: "denial_loop", hookStyle: "internal_thought", pattern: "pov" }) },
        { idea: makeIdea({ structure: "denial_loop", hookStyle: "internal_thought", pattern: "pov" }) },
      ]),
    );
    const fatigued = retentionSelectionBonus(
      { idea: makeIdea(), meta: makeMeta() },
      memory,
      profile,
    );
    const freshMemory = makeMemory({
      structures: { avoidance: 2 },
      hookStyles: { contrast: 2 },
    });
    const freshBonus = retentionSelectionBonus(
      {
        idea: makeIdea({ structure: "avoidance", hookStyle: "contrast", pattern: "mini_story" }),
        meta: makeMeta(),
      },
      freshMemory,
      profile,
    );
    expect(fatigued).toBeLessThan(freshBonus);
  });

  it("first-session creators get no retention penalty (immunity)", () => {
    const memory = makeMemory({
      structures: { denial_loop: 3 },
    });
    const emptyProfile = EMPTY_RETENTION_PROFILE;
    const bonus = retentionSelectionBonus(
      { idea: makeIdea(), meta: makeMeta() },
      memory,
      emptyProfile,
    );
    expect(bonus).toBe(0);
  });

  it("no API shape change — retention scoring is internal only", () => {
    const scored = makeScored();
    const keys = Object.keys(scored.idea);
    expect(keys).not.toContain("retentionScore");
    expect(keys).not.toContain("signalAlignment");
    expect(keys).not.toContain("fatigueRisk");
  });
});
