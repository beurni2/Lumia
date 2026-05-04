import { describe, it, expect } from "vitest";
import {
  scoreHeroQuality,
  computeFirstSessionBoostFactor,
  selectionPenalty,
  type NoveltyContext,
  type IdeaScore,
  EMPTY_NOVELTY_CONTEXT,
} from "../ideaScorer.js";
import { scoreWillingness } from "../willingnessScorer.js";
import type { Idea } from "../ideaGen.js";
import type { CandidateMeta } from "../ideaScorer.js";

function mkIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    pattern: "pov",
    hook: "i just checked my bank app at 2am",
    hookSeconds: 1.5,
    trigger: "opening the bank app and seeing the balance",
    reaction: "slow blink, jaw drops, eyes widen",
    emotionalSpike: "embarrassment",
    structure: "self_callout",
    hookStyle: "internal_thought",
    triggerCategory: "phone_screen",
    setting: "bed",
    script: "you open your bank app knowing full well you shouldn't",
    shotPlan: ["close-up of phone screen"],
    caption: "the bank app always wins at 2am",
    templateHint: "A" as const,
    contentType: "entertainment" as const,
    videoLengthSec: 18,
    filmingTimeMin: 3,
    whyItWorks: "universal late-night money anxiety",
    payoffType: "reaction",
    hasContrast: true,
    hasVisualAction: true,
    visualHook: "staring at phone screen in bed",
    whatToShow: "phone screen glowing in dark room, face reaction",
    howToFilm: "phone propped on nightstand, one take",
    ...overrides,
  } as unknown as Idea;
}

function mkScore(overrides: Partial<IdeaScore> = {}): IdeaScore {
  return {
    total: 10,
    hookImpact: 2,
    tension: 2,
    filmability: 2,
    personalFit: 2,
    captionStrength: 1,
    freshness: 1,
    scrollStopScore: 7,
    hookIntentScore: 7,
    heroQuality: 70,
    ...overrides,
  };
}

function mkMeta(overrides: Partial<CandidateMeta> = {}): CandidateMeta {
  return {
    source: "core_native",
    hookQualityScore: 75,
    voiceClusterId: "dry_deadpan",
    scenarioFingerprint: "sf_test_001",
    ...overrides,
  } as CandidateMeta;
}

describe("Phase Z5.6 — Hero Quality Scorer", () => {
  it("scores a strong hero idea >= 70", () => {
    const idea = mkIdea();
    const result = scoreHeroQuality(idea);
    expect(result.total).toBeGreaterThanOrEqual(70);
    expect(result.isHero).toBe(true);
  });

  it("returns all 10 dimension breakdowns", () => {
    const result = scoreHeroQuality(mkIdea());
    expect(result).toHaveProperty("hookPunch");
    expect(result).toHaveProperty("filmNowEase");
    expect(result).toHaveProperty("payoffClarity");
    expect(result).toHaveProperty("comedicSpecificity");
    expect(result).toHaveProperty("scenarioCoherence");
    expect(result).toHaveProperty("voiceNaturalness");
    expect(result).toHaveProperty("safetyConfidence");
    expect(result).toHaveProperty("freshness");
    expect(result).toHaveProperty("lowEffortSetting");
    expect(result).toHaveProperty("captionSynergy");
    expect(result.total).toBe(
      result.hookPunch +
        result.filmNowEase +
        result.payoffClarity +
        result.comedicSpecificity +
        result.scenarioCoherence +
        result.voiceNaturalness +
        result.safetyConfidence +
        result.freshness +
        result.lowEffortSetting +
        result.captionSynergy,
    );
  });

  it("penalizes vague hooks", () => {
    const strong = scoreHeroQuality(mkIdea({ hook: "i just checked my bank app" }));
    const vague = scoreHeroQuality(
      mkIdea({ hook: "this is where my life collapsed" }),
    );
    expect(strong.hookPunch).toBeGreaterThan(vague.hookPunch);
    expect(strong.total).toBeGreaterThan(vague.total);
  });

  it("penalizes high-lift scenes (long shotPlan, high filmingTime)", () => {
    const easy = scoreHeroQuality(
      mkIdea({ shotPlan: ["one shot"], filmingTimeMin: 3 }),
    );
    const hard = scoreHeroQuality(
      mkIdea({
        shotPlan: ["shot 1", "shot 2", "shot 3", "shot 4", "shot 5"],
        filmingTimeMin: 20,
      }),
    );
    expect(easy.filmNowEase).toBeGreaterThan(hard.filmNowEase);
  });

  it("boosts payoff clarity for visual action + contrast + clear spike", () => {
    const clear = scoreHeroQuality(
      mkIdea({
        hasVisualAction: true,
        hasContrast: true,
        emotionalSpike: "embarrassment",
        payoffType: "punchline",
      }),
    );
    const unclear = scoreHeroQuality(
      mkIdea({
        hasVisualAction: false,
        hasContrast: false,
        emotionalSpike: "regret",
        payoffType: "transformation",
      }),
    );
    expect(clear.payoffClarity).toBeGreaterThan(unclear.payoffClarity);
  });

  it("gives higher comedicSpecificity for concrete nouns + action verbs + physical reactions", () => {
    const specific = scoreHeroQuality(
      mkIdea({
        hook: "i just checked my phone at dinner",
        trigger: "opening the notification and reading the text",
        reaction: "jaw drops, eyes widen, slow blink",
      }),
    );
    const abstract = scoreHeroQuality(
      mkIdea({
        hook: "something happened to me today",
        trigger: "a thing occurred that was unexpected",
        reaction: "i felt emotional about it",
      }),
    );
    expect(specific.comedicSpecificity).toBeGreaterThan(
      abstract.comedicSpecificity,
    );
  });

  it("penalizes AI-speak in hook or script", () => {
    const natural = scoreHeroQuality(
      mkIdea({ hook: "i can't stop checking my ex's story", script: "you know you shouldn't" }),
    );
    const aiSpeak = scoreHeroQuality(
      mkIdea({
        hook: "i leverage my morning routine",
        script: "let me delve into this transformative paradigm",
      }),
    );
    expect(natural.voiceNaturalness).toBeGreaterThan(aiSpeak.voiceNaturalness);
  });

  it("penalizes private-data-dependent ideas", () => {
    const safe = scoreHeroQuality(mkIdea());
    const unsafe = scoreHeroQuality(
      mkIdea({
        trigger: "checking my bank balance and salary info",
        whatToShow: "the bank balance on screen",
      }),
    );
    expect(safe.safetyConfidence).toBeGreaterThan(unsafe.safetyConfidence);
  });

  it("rewards low-effort settings", () => {
    const bed = scoreHeroQuality(mkIdea({ setting: "bed" }));
    const outside = scoreHeroQuality(mkIdea({ setting: "outside" }));
    expect(bed.lowEffortSetting).toBeGreaterThan(outside.lowEffortSetting);
  });

  it("rewards caption synergy with hook", () => {
    const synergy = scoreHeroQuality(
      mkIdea({
        hook: "i just checked my bank app",
        caption: "the bank app wins every time",
      }),
    );
    const noSynergy = scoreHeroQuality(
      mkIdea({
        hook: "i just checked my bank app",
        caption: "life is wild sometimes",
      }),
    );
    expect(synergy.captionSynergy).toBeGreaterThan(noSynergy.captionSynergy);
  });

  it("accepts optional hookImpact and freshness axes", () => {
    const base = scoreHeroQuality(mkIdea());
    const withAxes = scoreHeroQuality(mkIdea(), 2, 1);
    expect(typeof base.total).toBe("number");
    expect(typeof withAxes.total).toBe("number");
    expect(withAxes.freshness).toBe(8);
  });

  it("is deterministic", () => {
    const idea = mkIdea();
    const a = scoreHeroQuality(idea);
    const b = scoreHeroQuality(idea);
    expect(a).toEqual(b);
  });
});

describe("Phase Z5.6 — Top-card ordering (hero idea ranks first)", () => {
  it("hero idea gets higher willingness than non-hero", () => {
    const heroIdea = mkIdea();
    const heroScore = mkScore({ heroQuality: 85 });
    const heroMeta = mkMeta();

    const plainIdea = mkIdea({
      hook: "something happened",
      setting: "outside",
      shotPlan: ["a", "b", "c", "d", "e"],
      filmingTimeMin: 15,
      hasVisualAction: false,
      hasContrast: false,
    });
    const plainScore = mkScore({ heroQuality: 30 });
    const plainMeta = mkMeta();

    const heroW = scoreWillingness({
      idea: heroIdea,
      score: heroScore,
      meta: heroMeta,
    });
    const plainW = scoreWillingness({
      idea: plainIdea,
      score: plainScore,
      meta: plainMeta,
    });
    expect(heroW.total).toBeGreaterThan(plainW.total);
  });
});

describe("Phase Z5.6 — First-session boost factor", () => {
  it("returns 1.0 for brand-new creator (0 batches)", () => {
    expect(computeFirstSessionBoostFactor(0, false)).toBe(1.0);
  });

  it("decays with batch history depth", () => {
    const f0 = computeFirstSessionBoostFactor(0, false);
    const f1 = computeFirstSessionBoostFactor(1, false);
    const f2 = computeFirstSessionBoostFactor(2, false);
    const f3 = computeFirstSessionBoostFactor(3, false);
    const f4 = computeFirstSessionBoostFactor(4, false);
    expect(f0).toBeGreaterThan(f1);
    expect(f1).toBeGreaterThan(f2);
    expect(f2).toBeGreaterThan(f3);
    expect(f3).toBeGreaterThan(f4);
    expect(f4).toBe(0);
  });

  it("returns 0 when taste calibration exists", () => {
    expect(computeFirstSessionBoostFactor(0, true)).toBe(0);
    expect(computeFirstSessionBoostFactor(1, true)).toBe(0);
  });

  it("personalization outranks generic launch-safe with signal", () => {
    const factorWithSignal = computeFirstSessionBoostFactor(4, true);
    expect(factorWithSignal).toBe(0);
  });
});

describe("Phase Z5.6 — First-session boost in selectionPenalty", () => {
  it("boosts POV pattern for cold-start", () => {
    const idea = mkIdea({ pattern: "pov" });
    const c = { idea, meta: mkMeta() };
    const ctxCold: NoveltyContext = { firstSessionBoostFactor: 1.0 };
    const ctxWarm: NoveltyContext = { firstSessionBoostFactor: 0 };
    const penCold = selectionPenalty(c, [], ctxCold);
    const penWarm = selectionPenalty(c, [], ctxWarm);
    expect(penCold).toBeGreaterThan(penWarm);
  });

  it("boosts safe structures for cold-start", () => {
    const idea = mkIdea({ structure: "expectation_vs_reality", pattern: "contrast" });
    const c = { idea, meta: mkMeta() };
    const ctxCold: NoveltyContext = { firstSessionBoostFactor: 1.0 };
    const ctxNone: NoveltyContext = {};
    const penCold = selectionPenalty(c, [], ctxCold);
    const penNone = selectionPenalty(c, [], ctxNone);
    expect(penCold).toBeGreaterThan(penNone);
  });

  it("caps small_panic + panic spike for cold-start", () => {
    const idea = mkIdea({
      structure: "small_panic",
      emotionalSpike: "panic",
      pattern: "reaction",
      hookStyle: "the_way_i",
      setting: "outside",
      hook: "the way i panicked over absolutely nothing at all today was honestly embarrassing",
    });
    const c = { idea, meta: mkMeta() };
    const ctxCold: NoveltyContext = { firstSessionBoostFactor: 1.0 };
    const ctxNone: NoveltyContext = {};
    const penCold = selectionPenalty(c, [], ctxCold);
    const penNone = selectionPenalty(c, [], ctxNone);
    expect(penCold).toBeLessThan(penNone);
  });

  it("caps high-lift filming for cold-start", () => {
    const idea = mkIdea({
      filmingTimeMin: 15,
      pattern: "reaction",
      structure: "social_awareness",
      hookStyle: "the_way_i",
      setting: "outside",
      hook: "the way everyone at this entire crowded outdoor gathering just stared directly at me",
    });
    const c = { idea, meta: mkMeta() };
    const ctxCold: NoveltyContext = { firstSessionBoostFactor: 1.0 };
    const ctxNone: NoveltyContext = {};
    const penCold = selectionPenalty(c, [], ctxCold);
    const penNone = selectionPenalty(c, [], ctxNone);
    expect(penCold).toBeLessThan(penNone);
  });

  it("no boost when factor is 0 (returning user)", () => {
    const idea = mkIdea({ pattern: "pov" });
    const c = { idea, meta: mkMeta() };
    const ctxZero: NoveltyContext = { firstSessionBoostFactor: 0 };
    const ctxNone: NoveltyContext = {};
    const penZero = selectionPenalty(c, [], ctxZero);
    const penNone = selectionPenalty(c, [], ctxNone);
    expect(penZero).toBe(penNone);
  });

  it("boost strength scales with factor", () => {
    const idea = mkIdea({ pattern: "pov" });
    const c = { idea, meta: mkMeta() };
    const penFull = selectionPenalty(c, [], { firstSessionBoostFactor: 1.0 });
    const penHalf = selectionPenalty(c, [], { firstSessionBoostFactor: 0.4 });
    const penNone = selectionPenalty(c, [], {});
    expect(penFull).toBeGreaterThanOrEqual(penHalf);
    expect(penHalf).toBeGreaterThanOrEqual(penNone);
  });
});

describe("Phase Z5.6 — No API shape changes", () => {
  it("heroQuality lives on IdeaScore (internal), not on Idea schema", async () => {
    const { ideaSchema } = await import("../ideaGen.js");
    const parsed = ideaSchema.safeParse(mkIdea());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("heroQuality");
    }
  });
});
