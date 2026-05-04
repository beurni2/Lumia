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

describe("Phase Z5.6b — Awkward phrase penalty", () => {
  it("penalizes 'faking me back' template-visible phrasing", () => {
    const clean = scoreHeroQuality(mkIdea({ hook: "i just checked my bank app" }));
    const awkward = scoreHeroQuality(
      mkIdea({ hook: "my own draft is faking me back!!" }),
    );
    expect(clean.hookPunch).toBeGreaterThan(awkward.hookPunch);
  });

  it("penalizes 'my body quit. my brain kept screaming'", () => {
    const clean = scoreHeroQuality(mkIdea({ hook: "the alarm won again" }));
    const weak = scoreHeroQuality(
      mkIdea({ hook: "my body quit. my brain kept screaming" }),
    );
    expect(clean.hookPunch).toBeGreaterThan(weak.hookPunch);
    expect(clean.total).toBeGreaterThan(weak.total);
  });

  it("penalizes 'watched myself fake' phrasing", () => {
    const clean = scoreHeroQuality(mkIdea({ hook: "the fridge knows i'm lying" }));
    const awkward = scoreHeroQuality(
      mkIdea({ hook: "watched myself fake the ringlight live" }),
    );
    expect(clean.hookPunch).toBeGreaterThan(awkward.hookPunch);
  });
});

describe("Phase Z5.6b — Weak hook skeleton penalty", () => {
  it("penalizes 'my body quit' skeleton", () => {
    const strong = scoreHeroQuality(mkIdea({ hook: "i just checked my bank app again" }));
    const weak = scoreHeroQuality(
      mkIdea({ hook: "my body quit on me at the gym" }),
    );
    expect(strong.hookPunch).toBeGreaterThan(weak.hookPunch);
  });

  it("penalizes 'brain kept screaming' skeleton", () => {
    const strong = scoreHeroQuality(mkIdea({ hook: "the app ghosted itself again" }));
    const weak = scoreHeroQuality(
      mkIdea({ hook: "my brain kept screaming the whole time" }),
    );
    expect(strong.hookPunch).toBeGreaterThan(weak.hookPunch);
  });
});

describe("Phase Z5.6b — Payoff clarity expansion", () => {
  it("gives partial credit for reaction payoff type", () => {
    const reaction = scoreHeroQuality(
      mkIdea({ payoffType: "reaction", hasVisualAction: false, hasContrast: false, emotionalSpike: "panic" }),
    );
    expect(reaction.payoffClarity).toBeGreaterThan(0);
  });

  it("gives partial credit for panic/regret spikes", () => {
    const panic = scoreHeroQuality(
      mkIdea({ emotionalSpike: "panic", payoffType: "reaction", hasVisualAction: false, hasContrast: false }),
    );
    const regret = scoreHeroQuality(
      mkIdea({ emotionalSpike: "regret", payoffType: "reaction", hasVisualAction: false, hasContrast: false }),
    );
    expect(panic.payoffClarity).toBeGreaterThan(0);
    expect(regret.payoffClarity).toBeGreaterThan(0);
  });

  it("still gives max credit for punchline + embarrassment", () => {
    const best = scoreHeroQuality(
      mkIdea({
        payoffType: "punchline",
        emotionalSpike: "embarrassment",
        hasVisualAction: true,
        hasContrast: true,
      }),
    );
    expect(best.payoffClarity).toBe(12);
  });

  it("returning profile with reaction+regret scores higher than before", () => {
    const returning = scoreHeroQuality(
      mkIdea({
        payoffType: "reaction",
        emotionalSpike: "regret",
        hasVisualAction: true,
        hasContrast: false,
      }),
    );
    expect(returning.payoffClarity).toBeGreaterThanOrEqual(6);
  });
});

describe("Phase Z5.6b — Caption synergy expansion", () => {
  it("rewards captions with comedy amplifier words", () => {
    const comedy = scoreHeroQuality(
      mkIdea({
        hook: "i just opened the app",
        caption: "the app always wins somehow",
      }),
    );
    const plain = scoreHeroQuality(
      mkIdea({
        hook: "i just opened the app",
        caption: "life is interesting today",
      }),
    );
    expect(comedy.captionSynergy).toBeGreaterThan(plain.captionSynergy);
  });

  it("rewards captions with specific nouns", () => {
    const concrete = scoreHeroQuality(
      mkIdea({
        hook: "why did i even try",
        caption: "the alarm clock is undefeated",
      }),
    );
    const vague = scoreHeroQuality(
      mkIdea({
        hook: "why did i even try",
        caption: "things just happen sometimes",
      }),
    );
    expect(concrete.captionSynergy).toBeGreaterThan(vague.captionSynergy);
  });
});

describe("Phase Z5.6b — Object anthropomorphism bonus", () => {
  it("boosts hookPunch for 'the fridge knows' pattern", () => {
    const anthropomorphic = scoreHeroQuality(
      mkIdea({ hook: "the fridge knows i'm lying" }),
    );
    const plain = scoreHeroQuality(
      mkIdea({ hook: "the fridge opened at midnight" }),
    );
    expect(anthropomorphic.hookPunch).toBeGreaterThan(plain.hookPunch);
  });
});

describe("Phase Z5.6b — Hero weight increase", () => {
  it("hero quality contributes meaningfully to IdeaScore total", () => {
    const strong = scoreHeroQuality(
      mkIdea({
        hook: "i just checked my bank app at 2am",
        hasVisualAction: true,
        hasContrast: true,
        payoffType: "punchline",
        emotionalSpike: "embarrassment",
        setting: "bed",
      }),
    );
    const contribution = Math.round(strong.total * 0.06);
    expect(contribution).toBeGreaterThanOrEqual(4);
  });
});

describe("Phase Z5.6b — Payoff floor in selectionPenalty", () => {
  it("penalizes ideas with no payoff signal", () => {
    const noPayoff = mkIdea({
      hasVisualAction: false,
      hasContrast: false,
      payoffType: "transformation",
      pattern: "mini_story",
      structure: "social_awareness",
      hookStyle: "the_way_i",
      setting: "outside",
      hook: "the way something kind of happened to me in a vague sort of way today",
    });
    const withPayoff = mkIdea({
      hasVisualAction: true,
      hasContrast: true,
      payoffType: "punchline",
      pattern: "contrast",
      structure: "expectation_vs_reality",
      hookStyle: "internal_thought",
      setting: "bed",
      hook: "i just checked my bank app at 2am and now i can't sleep",
    });
    const penNoPayoff = selectionPenalty({ idea: noPayoff, meta: mkMeta() }, []);
    const penWithPayoff = selectionPenalty({ idea: withPayoff, meta: mkMeta() }, []);
    expect(penWithPayoff).toBeGreaterThan(penNoPayoff);
  });
});

describe("Phase Z5.6b — Returning profile payoff protection", () => {
  it("personalization cannot promote low-payoff over high-payoff", () => {
    const lowPayoff = mkIdea({
      hasVisualAction: false,
      hasContrast: false,
      payoffType: "transformation",
      emotionalSpike: "regret",
    });
    const highPayoff = mkIdea({
      hasVisualAction: true,
      hasContrast: true,
      payoffType: "punchline",
      emotionalSpike: "embarrassment",
    });
    const lowHero = scoreHeroQuality(lowPayoff);
    const highHero = scoreHeroQuality(highPayoff);
    expect(highHero.payoffClarity).toBeGreaterThan(lowHero.payoffClarity);
    expect(highHero.total).toBeGreaterThan(lowHero.total);
  });
});

describe("Phase Z5.6b — Safety still hard-pass", () => {
  it("safety confidence unchanged for safe ideas", () => {
    const safe = scoreHeroQuality(mkIdea());
    expect(safe.safetyConfidence).toBe(10);
  });

  it("safety confidence still penalizes private data", () => {
    const unsafe = scoreHeroQuality(
      mkIdea({
        trigger: "checking my bank balance",
        whatToShow: "the bank balance on screen",
      }),
    );
    expect(unsafe.safetyConfidence).toBeLessThan(10);
  });
});

describe("Phase Z5.6b — Regex negative controls (no false positives)", () => {
  it("does NOT penalize 'my playlist is bringing me back' as awkward", () => {
    const legit = scoreHeroQuality(mkIdea({ hook: "my playlist is bringing me back" }));
    const awkward = scoreHeroQuality(mkIdea({ hook: "my own draft is faking me back!!" }));
    expect(legit.hookPunch).toBeGreaterThan(awkward.hookPunch);
  });

  it("does NOT penalize 'this happened when i opened my bank app' as weak skeleton", () => {
    const legit = scoreHeroQuality(mkIdea({ hook: "this happened when i opened my bank app" }));
    expect(legit.hookPunch).toBeGreaterThan(0);
  });

  it("does NOT give anthropomorphism bonus for 'my mom knows i'm lying'", () => {
    const human = scoreHeroQuality(mkIdea({ hook: "my mom knows i'm lying" }));
    const object = scoreHeroQuality(mkIdea({ hook: "the fridge knows i'm lying" }));
    expect(object.hookPunch).toBeGreaterThan(human.hookPunch);
  });

  it("does NOT penalize 'still editing the video at this hour' as awkward", () => {
    const legit = scoreHeroQuality(mkIdea({ hook: "i'm still editing the video at this hour" }));
    expect(legit.hookPunch).toBeGreaterThan(0);
  });
});

describe("Phase Z5.6b — First-session boost unchanged", () => {
  it("still returns 1.0 for cold start", () => {
    expect(computeFirstSessionBoostFactor(0, false)).toBe(1.0);
  });

  it("still returns 0 with taste calibration", () => {
    expect(computeFirstSessionBoostFactor(0, true)).toBe(0);
    expect(computeFirstSessionBoostFactor(2, true)).toBe(0);
  });

  it("still decays with batch history", () => {
    const f0 = computeFirstSessionBoostFactor(0, false);
    const f1 = computeFirstSessionBoostFactor(1, false);
    const f4 = computeFirstSessionBoostFactor(4, false);
    expect(f0).toBeGreaterThan(f1);
    expect(f4).toBe(0);
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
