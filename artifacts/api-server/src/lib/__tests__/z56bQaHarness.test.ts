import { describe, it, expect } from "vitest";
import {
  scoreHeroQuality,
  selectionPenalty,
  type HeroQualityBreakdown,
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

function mkMeta(overrides: Partial<CandidateMeta> = {}): CandidateMeta {
  return {
    source: "core_native",
    hookQualityScore: 75,
    voiceClusterId: "dry_deadpan",
    scenarioFingerprint: "sf_qa_001",
    ideaCoreFamily: "self_betrayal",
    ...overrides,
  } as unknown as CandidateMeta;
}

const PASS_A_IDEAS: Array<{ label: string; idea: Idea }> = [
  {
    label: "cold_blank_1: app ghosting",
    idea: mkIdea({
      hook: "WHY does the app keep ghosting itself",
      caption: "the app ghosted itself again somehow",
      pattern: "pov",
      setting: "couch",
      payoffType: "reaction",
      emotionalSpike: "embarrassment",
      hasVisualAction: true,
      hasContrast: true,
      trigger: "opening the app and it just closed",
      reaction: "blank stare, slow head turn",
    }),
  },
  {
    label: "cold_blank_2: draft faking",
    idea: mkIdea({
      hook: "my own draft just saved itself wrong",
      caption: "the draft never cooperates",
      pattern: "contrast",
      setting: "desk",
      payoffType: "reveal",
      emotionalSpike: "irony",
      hasVisualAction: true,
      hasContrast: true,
      trigger: "checking the draft and it saved wrong",
      reaction: "confusion face, then slow nod",
    }),
  },
  {
    label: "cold_blank_3: fridge knows",
    idea: mkIdea({
      hook: "the fridge knows i'm lying",
      caption: "the fridge always wins at midnight",
      pattern: "reaction",
      setting: "bed",
      payoffType: "punchline",
      emotionalSpike: "embarrassment",
      hasVisualAction: true,
      hasContrast: false,
      trigger: "opening the fridge at midnight",
      reaction: "guilty look, closes fridge slowly",
    }),
  },
  {
    label: "cold_blank_4: alarm negotiation",
    idea: mkIdea({
      hook: "i negotiated with my alarm for 40 minutes",
      caption: "the alarm is undefeated",
      pattern: "pov",
      setting: "bed",
      payoffType: "punchline",
      emotionalSpike: "denial",
      hasVisualAction: true,
      hasContrast: true,
      trigger: "alarm going off, hitting snooze repeatedly",
      reaction: "eyes half open, finger hovering over snooze",
    }),
  },
  {
    label: "cold_blank_5: cart abandoned",
    idea: mkIdea({
      hook: "i abandoned my cart like it owed me money",
      caption: "the cart never stood a chance",
      pattern: "contrast",
      setting: "couch",
      payoffType: "punchline",
      emotionalSpike: "irony",
      hasVisualAction: true,
      hasContrast: true,
      trigger: "looking at $200 cart total",
      reaction: "slow close of laptop, deep breath",
    }),
  },
  {
    label: "cold_blank_6: coffee betrayal",
    idea: mkIdea({
      hook: "my coffee went cold judging me",
      caption: "the coffee always goes cold first",
      pattern: "pov",
      setting: "desk",
      payoffType: "reaction",
      emotionalSpike: "embarrassment",
      hasVisualAction: true,
      hasContrast: false,
      trigger: "reaching for coffee and it's cold",
      reaction: "sad sip, disappointed face",
    }),
  },
  {
    label: "cold_blank_7: email spiral",
    idea: mkIdea({
      hook: "i reread my email 12 times then sent the wrong one",
      caption: "the email won again",
      pattern: "mini_story",
      setting: "desk",
      payoffType: "reveal",
      emotionalSpike: "panic",
      hasVisualAction: true,
      hasContrast: true,
      trigger: "staring at email draft for too long",
      reaction: "face drops, hand covers mouth",
    }),
  },
  {
    label: "cold_blank_8: mirror stare",
    idea: mkIdea({
      hook: "the mirror caught me practicing my smile",
      caption: "even the mirror looked concerned",
      pattern: "reaction",
      setting: "bathroom",
      payoffType: "punchline",
      emotionalSpike: "embarrassment",
      hasVisualAction: true,
      hasContrast: false,
      trigger: "looking in mirror, practicing a smile",
      reaction: "freezes mid-smile, slowly backs away",
    }),
  },
  {
    label: "cold_blank_9: notification trap",
    idea: mkIdea({
      hook: "i checked my notification and it was just the weather",
      caption: "the phone always lies",
      pattern: "pov",
      setting: "bed",
      payoffType: "reaction",
      emotionalSpike: "denial",
      hasVisualAction: true,
      hasContrast: true,
      trigger: "phone buzzes, grab it excitedly",
      reaction: "face falls, puts phone face down",
    }),
  },
  {
    label: "cold_blank_10: laundry pile",
    idea: mkIdea({
      hook: "the laundry pile is taller than my goals",
      caption: "the pile never shrinks honestly",
      pattern: "contrast",
      setting: "bed",
      payoffType: "punchline",
      emotionalSpike: "irony",
      hasVisualAction: true,
      hasContrast: true,
      trigger: "walking past the laundry pile again",
      reaction: "brief glance, keeps walking",
    }),
  },
];

const PASS_B_IDEAS: Array<{ label: string; idea: Idea }> = [
  {
    label: "returning_dry: body quit",
    idea: mkIdea({
      hook: "my body quit. my brain kept screaming",
      caption: "the body always quits first",
      pattern: "mini_story",
      setting: "couch",
      payoffType: "transformation",
      emotionalSpike: "regret",
      hasVisualAction: false,
      hasContrast: false,
      trigger: "exhaustion hitting mid-scroll",
      reaction: "thousand yard stare into nothing",
    }),
  },
  {
    label: "returning_chaotic: watched fake",
    idea: mkIdea({
      hook: "watched myself fake the ringlight live",
      caption: "the ringlight never forgives",
      pattern: "contrast",
      setting: "desk",
      payoffType: "reaction",
      emotionalSpike: "embarrassment",
      hasVisualAction: true,
      hasContrast: true,
      trigger: "turning on ringlight and forcing a smile",
      reaction: "cringe, look away from camera",
    }),
  },
  {
    label: "returning_vulnerable: textbook exposing",
    idea: mkIdea({
      hook: "my own textbook is exposing me back!!",
      caption: "the textbook has no mercy",
      pattern: "contrast",
      setting: "desk",
      payoffType: "reveal",
      emotionalSpike: "panic",
      hasVisualAction: true,
      hasContrast: true,
      trigger: "opening textbook to wrong page",
      reaction: "eyes go wide, slams book shut",
    }),
  },
  {
    label: "returning_confident: grocery receipt",
    idea: mkIdea({
      hook: "i checked my grocery receipt and blacked out",
      caption: "the receipt always wins",
      pattern: "pov",
      setting: "kitchen",
      payoffType: "reaction",
      emotionalSpike: "panic",
      hasVisualAction: true,
      hasContrast: false,
      trigger: "looking at the grocery receipt total",
      reaction: "slow blink, sets receipt face-down",
    }),
  },
  {
    label: "returning_playful: spotify judging",
    idea: mkIdea({
      hook: "my spotify is judging me at this point",
      caption: "spotify never forgets apparently",
      pattern: "pov",
      setting: "bed",
      payoffType: "reaction",
      emotionalSpike: "embarrassment",
      hasVisualAction: true,
      hasContrast: false,
      trigger: "seeing embarrassing recommendations",
      reaction: "guilty scroll, hiding phone from nobody",
    }),
  },
  {
    label: "returning_dry2: scale won",
    idea: mkIdea({
      hook: "the scale won and i didn't even step on it",
      caption: "the scale is undefeated honestly",
      pattern: "reaction",
      setting: "bathroom",
      payoffType: "punchline",
      emotionalSpike: "denial",
      hasVisualAction: true,
      hasContrast: true,
      trigger: "walking past the bathroom scale",
      reaction: "side-eye at scale, keeps walking",
    }),
  },
  {
    label: "returning_chaotic2: uber surge",
    idea: mkIdea({
      hook: "i saw the uber surge and just started walking",
      caption: "the uber price always wins somehow",
      pattern: "contrast",
      setting: "outside",
      payoffType: "reaction",
      emotionalSpike: "regret",
      hasVisualAction: true,
      hasContrast: true,
      trigger: "opening uber app and seeing 3x surge",
      reaction: "closes app, deep breath, starts walking",
    }),
  },
  {
    label: "returning_vulnerable2: group chat",
    idea: mkIdea({
      hook: "the group chat moved on without me again",
      caption: "the group chat never waits",
      pattern: "pov",
      setting: "bed",
      payoffType: "reaction",
      emotionalSpike: "regret",
      hasVisualAction: true,
      hasContrast: false,
      trigger: "opening group chat to 200 unread messages",
      reaction: "scrolling up, realizing nobody noticed",
    }),
  },
  {
    label: "returning_confident2: netflix scroll",
    idea: mkIdea({
      hook: "i scrolled netflix for an hour then watched nothing",
      caption: "netflix won again somehow",
      pattern: "mini_story",
      setting: "couch",
      payoffType: "reaction",
      emotionalSpike: "irony",
      hasVisualAction: true,
      hasContrast: true,
      trigger: "endless scrolling through netflix",
      reaction: "closes laptop, stares at ceiling",
    }),
  },
  {
    label: "returning_playful2: venmo request",
    idea: mkIdea({
      hook: "the venmo request from 3 months ago is still haunting me",
      caption: "venmo never forgets ever",
      pattern: "pov",
      setting: "couch",
      payoffType: "reaction",
      emotionalSpike: "panic",
      hasVisualAction: true,
      hasContrast: false,
      trigger: "opening venmo and seeing pending request",
      reaction: "grimace, scrolls past quickly",
    }),
  },
];

function runPass(
  ideas: Array<{ label: string; idea: Idea }>,
  passLabel: string,
): {
  results: Array<{ label: string; hero: HeroQualityBreakdown }>;
  avgTotal: number;
  avgPayoff: number;
  avgCapSynergy: number;
  avgHookPunch: number;
  heroPassRate: number;
  safetyFailures: number;
} {
  const results = ideas.map(({ label, idea }) => ({
    label,
    hero: scoreHeroQuality(idea),
  }));
  const totals = results.map((r) => r.hero.total);
  const payoffs = results.map((r) => r.hero.payoffClarity);
  const synergies = results.map((r) => r.hero.captionSynergy);
  const hooks = results.map((r) => r.hero.hookPunch);
  const heroCount = results.filter((r) => r.hero.isHero).length;
  const safetyFails = results.filter((r) => r.hero.safetyConfidence < 10).length;
  return {
    results,
    avgTotal: totals.reduce((a, b) => a + b, 0) / totals.length,
    avgPayoff: payoffs.reduce((a, b) => a + b, 0) / payoffs.length,
    avgCapSynergy: synergies.reduce((a, b) => a + b, 0) / synergies.length,
    avgHookPunch: hooks.reduce((a, b) => a + b, 0) / hooks.length,
    heroPassRate: heroCount / results.length,
    safetyFailures: safetyFails,
  };
}

describe("Phase Z5.6b — QA Pass A (Cold-Start)", () => {
  const passA = runPass(PASS_A_IDEAS, "Pass A");

  it("hero pass rate ≥ 70%", () => {
    console.log(`Pass A hero pass rate: ${(passA.heroPassRate * 100).toFixed(1)}%`);
    console.log(`Pass A avg hero total: ${passA.avgTotal.toFixed(1)}`);
    console.log(`Pass A avg payoffClarity: ${passA.avgPayoff.toFixed(1)}`);
    console.log(`Pass A avg captionSynergy: ${passA.avgCapSynergy.toFixed(1)}`);
    console.log(`Pass A avg hookPunch: ${passA.avgHookPunch.toFixed(1)}`);
    for (const r of passA.results) {
      console.log(
        `  ${r.label}: total=${r.hero.total} hero=${r.hero.isHero} hook=${r.hero.hookPunch} payoff=${r.hero.payoffClarity} syn=${r.hero.captionSynergy}`,
      );
    }
    expect(passA.heroPassRate).toBeGreaterThanOrEqual(0.7);
  });

  it("avg hero total ≥ 72", () => {
    expect(passA.avgTotal).toBeGreaterThanOrEqual(72);
  });

  it("zero safety failures", () => {
    expect(passA.safetyFailures).toBe(0);
  });
});

describe("Phase Z5.6b — QA Pass B (Returning)", () => {
  const passB = runPass(PASS_B_IDEAS, "Pass B");

  it("hero pass rate ≥ 50% (3 ideas intentionally awkward-penalized)", () => {
    console.log(`Pass B hero pass rate: ${(passB.heroPassRate * 100).toFixed(1)}%`);
    console.log(`Pass B avg hero total: ${passB.avgTotal.toFixed(1)}`);
    console.log(`Pass B avg payoffClarity: ${passB.avgPayoff.toFixed(1)}`);
    console.log(`Pass B avg captionSynergy: ${passB.avgCapSynergy.toFixed(1)}`);
    console.log(`Pass B avg hookPunch: ${passB.avgHookPunch.toFixed(1)}`);
    for (const r of passB.results) {
      console.log(
        `  ${r.label}: total=${r.hero.total} hero=${r.hero.isHero} hook=${r.hero.hookPunch} payoff=${r.hero.payoffClarity} syn=${r.hero.captionSynergy}`,
      );
    }
    expect(passB.heroPassRate).toBeGreaterThanOrEqual(0.5);
  });

  it("avg payoff clarity ≥ 8", () => {
    expect(passB.avgPayoff).toBeGreaterThanOrEqual(8);
  });

  it("zero safety failures", () => {
    expect(passB.safetyFailures).toBe(0);
  });
});

describe("Phase Z5.6b — QA Combined", () => {
  const passA = runPass(PASS_A_IDEAS, "Pass A");
  const passB = runPass(PASS_B_IDEAS, "Pass B");
  const allResults = [...passA.results, ...passB.results];
  const combinedTotal = allResults.reduce((s, r) => s + r.hero.total, 0) / allResults.length;
  const combinedHeroRate = allResults.filter((r) => r.hero.isHero).length / allResults.length;
  const combinedPayoff = allResults.reduce((s, r) => s + r.hero.payoffClarity, 0) / allResults.length;
  const combinedSynergy = allResults.reduce((s, r) => s + r.hero.captionSynergy, 0) / allResults.length;
  const safetyFails = allResults.filter((r) => r.hero.safetyConfidence < 10).length;

  it("combined hero pass rate ≥ 65%", () => {
    console.log(`Combined hero pass rate: ${(combinedHeroRate * 100).toFixed(1)}%`);
    console.log(`Combined avg hero total: ${combinedTotal.toFixed(1)}`);
    console.log(`Combined avg payoffClarity: ${combinedPayoff.toFixed(1)}`);
    console.log(`Combined avg captionSynergy: ${combinedSynergy.toFixed(1)}`);
    expect(combinedHeroRate).toBeGreaterThanOrEqual(0.65);
  });

  it("combined avg hero total ≥ 70", () => {
    expect(combinedTotal).toBeGreaterThanOrEqual(70);
  });

  it("zero safety failures across all passes", () => {
    expect(safetyFails).toBe(0);
  });

  it("awkward hooks score below hero threshold", () => {
    const awkwardIdeas = [
      mkIdea({ hook: "my body quit. my brain kept screaming", payoffType: "transformation", emotionalSpike: "regret", hasVisualAction: false, hasContrast: false }),
      mkIdea({ hook: "still scrolling the feed at this hour", payoffType: "reaction", emotionalSpike: "regret", hasVisualAction: false, hasContrast: false }),
    ];
    for (const idea of awkwardIdeas) {
      const hero = scoreHeroQuality(idea);
      expect(hero.isHero).toBe(false);
    }
  });

  it("payoff floor penalty fires for no-signal ideas", () => {
    const noSignal = mkIdea({
      hasVisualAction: false,
      hasContrast: false,
      payoffType: "transformation",
      hook: "something just happened to me today",
    });
    const withSignal = mkIdea({
      hasVisualAction: true,
      hasContrast: true,
      payoffType: "punchline",
      hook: "i just checked my bank app at 2am",
    });
    const penNo = selectionPenalty({ idea: noSignal, meta: mkMeta() }, []);
    const penWith = selectionPenalty({ idea: withSignal, meta: mkMeta() }, []);
    expect(penWith).toBeGreaterThan(penNo);
  });
});
