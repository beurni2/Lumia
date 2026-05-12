/**
 * P16-A1 — HQS HUMAN-LIFT SCORER tests
 *
 * Covers:
 *   • Flag-off invariance (existing scores unchanged)
 *   • Understated absurdity lift firing/non-firing rules
 *   • Emotional specificity (token presence + payoff beat + caps)
 *   • Brevity widening (qualifier rules + monotonicity)
 *   • Floor invariance (PICKER_HQS_FLOOR=50, HOOK_QUALITY_FLOOR=40)
 *   • Breakdown shape additivity
 *   • Canonical verb-tier exposure (HIGH/MID/LOW/BLAND/NONE)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  scoreHookQuality,
  scoreHookQualityDetailed,
  visceralVerbScoreDetailed,
  anthropomorphScoreDetailed,
  contradictionScoreDetailed,
  brevityScoreOriginal,
  brevityWordCount,
} from "../hookQuality.js";
import {
  computeHumanLift,
  isHumanLiftEnabled,
  widenedBrevityTable,
  widenedBrevityMonotone,
  ZERO_HUMAN_LIFT,
} from "../hookQualityHumanLift.js";

// Always isolate env var around tests.
const FLAG = "LUMINA_HQS_HUMAN_LIFT_ENABLED";
let savedFlag: string | undefined;
beforeEach(() => {
  savedFlag = process.env[FLAG];
  delete process.env[FLAG];
});
afterEach(() => {
  if (savedFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = savedFlag;
});

// ---------------------------------------------------------------- //
// Floor invariance                                                  //
// ---------------------------------------------------------------- //

describe("P16-A1 — floor invariance", () => {
  it("PICKER_HQS_FLOOR source constant is exactly 50 (P16-A1 must not change it)", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(
      path.join(here, "..", "willingnessScorer.ts"),
      "utf8",
    );
    expect(src).toMatch(/const\s+PICKER_HQS_FLOOR\s*=\s*50\s*;/);
  });

  it("HOOK_QUALITY_FLOOR source constant is exactly 40 in voiceClusters.ts", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(
      path.join(here, "..", "voiceClusters.ts"),
      "utf8",
    );
    expect(src).toMatch(/const\s+HOOK_QUALITY_FLOOR\s*=\s*40\s*;/);
  });
});

// ---------------------------------------------------------------- //
// Flag-off invariance                                               //
// ---------------------------------------------------------------- //

const SAMPLE_HOOKS: ReadonlyArray<{ hook: string; family: "self_betrayal" }> = [
  { hook: "the list ghosted me first", family: "self_betrayal" },
  { hook: "i specialize in disappointing myself", family: "self_betrayal" },
  { hook: "tea, biscuits, and regret", family: "self_betrayal" },
  { hook: "first the kettle then the toaster then the printer", family: "self_betrayal" },
  { hook: "the kettle whispered nothing happened", family: "self_betrayal" },
  { hook: "my body quit", family: "self_betrayal" },
  { hook: "the fridge demolished my entire vibe", family: "self_betrayal" },
];

describe("P16-A1 — flag OFF invariance", () => {
  for (const { hook, family } of SAMPLE_HOOKS) {
    it(`'${hook}' scores identically with flag absent vs flag = "0"`, () => {
      delete process.env[FLAG];
      const a = scoreHookQuality(hook, family);
      process.env[FLAG] = "0";
      const b = scoreHookQuality(hook, family);
      expect(b).toBe(a);
    });
  }

  it("flag OFF → humanLift breakdown is the zero-valued sentinel", () => {
    const d = scoreHookQualityDetailed("the list ghosted me first", "self_betrayal");
    expect(d.humanLift).toEqual(ZERO_HUMAN_LIFT);
  });

  it("isHumanLiftEnabled returns false when env var is unset / '0' / 'false'", () => {
    delete process.env[FLAG];
    expect(isHumanLiftEnabled()).toBe(false);
    process.env[FLAG] = "0";
    expect(isHumanLiftEnabled()).toBe(false);
    process.env[FLAG] = "false";
    expect(isHumanLiftEnabled()).toBe(false);
    process.env[FLAG] = "1";
    expect(isHumanLiftEnabled()).toBe(true);
    process.env[FLAG] = "true";
    expect(isHumanLiftEnabled()).toBe(true);
  });
});

// ---------------------------------------------------------------- //
// Canonical verb-tier exposure                                      //
// ---------------------------------------------------------------- //

describe("P16-A1 — canonical verb-tier exposure", () => {
  const CASES: ReadonlyArray<{ hook: string; expectedTier: string; expectedScore: number }> = [
    { hook: "i ghosted my own list", expectedTier: "HIGH", expectedScore: 30 },
    { hook: "i abandoned the plan", expectedTier: "MID", expectedScore: 18 },
    { hook: "i checked the time", expectedTier: "LOW", expectedScore: 8 },
    { hook: "the list was here", expectedTier: "BLAND", expectedScore: 5 },
    { hook: "rice plate fork", expectedTier: "NONE", expectedScore: 5 },
  ];
  for (const { hook, expectedTier, expectedScore } of CASES) {
    it(`'${hook}' tier=${expectedTier} score=${expectedScore}`, () => {
      const d = visceralVerbScoreDetailed(hook.toLowerCase());
      expect(d.tier).toBe(expectedTier);
      expect(d.score).toBe(expectedScore);
    });
  }

  it("breakdown's verbTier matches the canonical helper", () => {
    const d = scoreHookQualityDetailed("i ghosted my own list", "self_betrayal");
    expect(d.verbTier).toBe("HIGH");
  });
});

// ---------------------------------------------------------------- //
// Anthropomorph branch metadata                                     //
// ---------------------------------------------------------------- //

describe("P16-A1 — anthropomorph branch metadata", () => {
  it("explicit branch detected ('my own list')", () => {
    const d = anthropomorphScoreDetailed("i ghosted my own list");
    expect(d.branch).toBe("explicit");
    expect(d.score).toBe(25);
  });
  it("implicit branch detected ('the list ghosted me')", () => {
    const d = anthropomorphScoreDetailed("the list ghosted me first");
    expect(d.branch).toBe("implicit");
    expect(d.score).toBe(12);
  });
  it("none branch when no marker", () => {
    const d = anthropomorphScoreDetailed("i had a sandwich");
    expect(d.branch).toBe("none");
    expect(d.score).toBe(0);
  });
  it("breakdown surfaces branch metadata", () => {
    const d = scoreHookQualityDetailed("the list ghosted me first", "self_betrayal");
    expect(d.anthropomorphBranch).toBe("implicit");
  });
});

// ---------------------------------------------------------------- //
// Contradiction source metadata                                     //
// ---------------------------------------------------------------- //

describe("P16-A1 — contradiction source metadata", () => {
  it("'marker' source for em-dash / 'but' / numbers", () => {
    expect(contradictionScoreDetailed("i tried but lost").source).toBe("marker");
    expect(contradictionScoreDetailed("47 posts later").source).toBe("marker");
  });
  it("'dramatic' source for villain / apocalypse", () => {
    expect(contradictionScoreDetailed("became my villain origin").source).toBe(
      "dramatic",
    );
  });
  it("'none' source for plain hook", () => {
    expect(contradictionScoreDetailed("i had rice").source).toBe("none");
  });
});

// ---------------------------------------------------------------- //
// Understated absurdity lift                                        //
// ---------------------------------------------------------------- //

describe("P16-A1 — understated absurdity lift", () => {
  beforeEach(() => {
    process.env[FLAG] = "1";
  });

  it("FIRES on quiet implicit-anthropomorph hook (BLAND/LOW/NONE verb)", () => {
    // "the kettle whispered nothing happened" — implicit-anthro via 'whispered'
    // (in the IMPLICIT alternation list), additional verb 'happened' is LOW.
    const d = scoreHookQualityDetailed(
      "the kettle whispered nothing happened",
      "self_betrayal",
    );
    expect(d.anthropomorphBranch).toBe("implicit");
    // 'whispered' is in the IMPLICIT alternation but not in any verb tier set,
    // 'happened' is not in any tier either. So tier is NONE → lift fires.
    expect(d.humanLift.understatedAbsurdity).toBe(5);
  });

  it("does NOT fire when EXPLICIT anthropomorph fired (gaming-guard cap aside)", () => {
    const d = scoreHookQualityDetailed(
      "i ghosted my own list",
      "self_betrayal",
    );
    expect(d.anthropomorphBranch).toBe("explicit");
    expect(d.humanLift.understatedAbsurdity).toBe(0);
  });

  it("does NOT fire when verb tier is HIGH or MID (loud register)", () => {
    // "the kettle ghosted me" → implicit-anth via 'ghosted', verb tier HIGH
    const d = scoreHookQualityDetailed(
      "the kettle ghosted me",
      "self_betrayal",
    );
    expect(d.anthropomorphBranch).toBe("implicit");
    expect(d.verbTier).toBe("HIGH");
    expect(d.humanLift.understatedAbsurdity).toBe(0);
  });

  it("does NOT fire when aiCliche penalty is negative", () => {
    // "my body quit" triggers aiCliche AND has no implicit-anth, but to test
    // the guard cleanly we use a hook that has BOTH implicit-anth and cliche.
    // "my brain hates me" → has 'my' but not 'my own', not implicit either.
    // Construct: an implicit-anth hook that also matches aiCliche.
    // "the kettle is unwell. it happened." → 'is unwell' is cliche, but no implicit.
    // Easier: directly call computeHumanLift with synthesized inputs.
    const lift = computeHumanLift({
      hookLower: "the kettle whispered",
      verbTier: "NONE",
      anthropomorphBranch: "implicit",
      contradictionSource: "none",
      aiClicheNegative: true,
      originalBrevity: 13,
    });
    expect(lift.understatedAbsurdity).toBe(0);
  });
});

// ---------------------------------------------------------------- //
// Emotional specificity                                             //
// ---------------------------------------------------------------- //

describe("P16-A1 — emotional specificity", () => {
  beforeEach(() => {
    process.env[FLAG] = "1";
  });

  it("token presence: 'regret' alone scores +4", () => {
    const lift = computeHumanLift({
      hookLower: "i felt regret today",
      verbTier: "BLAND",
      anthropomorphBranch: "none",
      contradictionSource: "none",
      aiClicheNegative: false,
      originalBrevity: 17,
    });
    expect(lift.emotionalSpecificity).toBe(4);
  });

  it("payoff beat: 'and regret' scores +6", () => {
    const lift = computeHumanLift({
      hookLower: "tea, biscuits, and regret",
      verbTier: "NONE",
      anthropomorphBranch: "none",
      contradictionSource: "none",
      aiClicheNegative: false,
      originalBrevity: 17,
    });
    expect(lift.emotionalSpecificity).toBe(6);
  });

  it("multiple emotion words still cap at +6 (not per-hit)", () => {
    const lift = computeHumanLift({
      hookLower: "and regret regret regret shame",
      verbTier: "NONE",
      anthropomorphBranch: "none",
      contradictionSource: "none",
      aiClicheNegative: false,
      originalBrevity: 17,
    });
    expect(lift.emotionalSpecificity).toBe(6);
  });

  it("dramatic-noun contradiction caps at +3", () => {
    const lift = computeHumanLift({
      hookLower: "and regret in the apocalypse",
      verbTier: "NONE",
      anthropomorphBranch: "none",
      contradictionSource: "dramatic",
      aiClicheNegative: false,
      originalBrevity: 17,
    });
    expect(lift.emotionalSpecificity).toBe(3);
  });

  it("no false positive from substring (e.g. 'reignite' contains no emotion token)", () => {
    const lift = computeHumanLift({
      hookLower: "i tried to reignite the spark",
      verbTier: "LOW",
      anthropomorphBranch: "none",
      contradictionSource: "none",
      aiClicheNegative: false,
      originalBrevity: 13,
    });
    expect(lift.emotionalSpecificity).toBe(0);
  });

  it("emotion lexicon list passes through to scoreHookQualityDetailed", () => {
    const d = scoreHookQualityDetailed(
      "tea, biscuits, and regret",
      "self_betrayal",
    );
    expect(d.humanLift.emotionalSpecificity).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------- //
// Brevity widening                                                  //
// ---------------------------------------------------------------- //

describe("P16-A1 — brevity widening", () => {
  beforeEach(() => {
    process.env[FLAG] = "1";
  });

  it("MONOTONICITY: widenedBrevityMonotone(w) >= brevityScoreOriginal for all w in 1..30", () => {
    for (let w = 1; w <= 30; w++) {
      const hook = Array(w).fill("word").join(" ");
      const orig = brevityScoreOriginal(hook);
      const widened = widenedBrevityMonotone(hook);
      expect(widened).toBeGreaterThanOrEqual(orig);
      expect(brevityWordCount(hook)).toBe(w);
    }
  });

  it("widenedBrevityMonotone caps at the existing brevity max (20)", () => {
    for (let w = 1; w <= 30; w++) {
      const hook = Array(w).fill("word").join(" ");
      expect(widenedBrevityMonotone(hook)).toBeLessThanOrEqual(20);
    }
  });

  it("widenedBrevityTable returns 18 for 5..11, 13 for 12..14, 5 for 15+", () => {
    for (let w = 5; w <= 11; w++) expect(widenedBrevityTable(w)).toBe(18);
    for (let w = 12; w <= 14; w++) expect(widenedBrevityTable(w)).toBe(13);
    for (let w = 15; w <= 20; w++) expect(widenedBrevityTable(w)).toBe(5);
  });

  it("9-word qualifying hook receives widened brevity (sequence qualifier)", () => {
    // "first the kettle then the toaster then the printer" — 9 words,
    // matches OBSERVATIONAL_SEQUENCE_RX.
    const lift = computeHumanLift({
      hookLower: "first the kettle then the toaster then the printer",
      verbTier: "NONE",
      anthropomorphBranch: "none",
      contradictionSource: "none",
      aiClicheNegative: false,
      originalBrevity: 13, // word=9 → orig 13
    });
    expect(lift.brevityWideningDelta).toBe(5); // widened 18 - orig 13
    expect(lift.brevityWideningQualifier).toBe("sequence");
  });

  it("13-word qualifying hook receives widened brevity (emotional qualifier)", () => {
    const hook =
      "and just regret again and again and again and finally just relief one";
    expect(brevityWordCount(hook)).toBe(13);
    const lift = computeHumanLift({
      hookLower: hook,
      verbTier: "NONE",
      anthropomorphBranch: "none",
      contradictionSource: "none",
      aiClicheNegative: false,
      originalBrevity: 5, // 11+ → orig 5
    });
    expect(lift.brevityWideningDelta).toBe(8); // widened 13 - orig 5
    expect(lift.brevityWideningQualifier).toBe("emotional");
  });

  it("9-word non-qualifying hook does NOT receive widened brevity", () => {
    const lift = computeHumanLift({
      hookLower: "i had a sandwich and read my email today",
      verbTier: "BLAND",
      anthropomorphBranch: "none",
      contradictionSource: "none",
      aiClicheNegative: false,
      originalBrevity: 13,
    });
    expect(lift.brevityWideningDelta).toBe(0);
    expect(lift.brevityWideningQualifier).toBe("none");
  });

  it("5-word hook (orig=20): widening delta is exactly 0", () => {
    const lift = computeHumanLift({
      hookLower: "first the dog then me",
      verbTier: "NONE",
      anthropomorphBranch: "none",
      contradictionSource: "none",
      aiClicheNegative: false,
      originalBrevity: 20,
    });
    expect(lift.brevityWideningDelta).toBe(0);
  });
});

// ---------------------------------------------------------------- //
// Breakdown shape additivity                                        //
// ---------------------------------------------------------------- //

describe("P16-A1 — breakdown shape additivity", () => {
  it("all pre-P16-A1 fields are present and unchanged in name", () => {
    const d = scoreHookQualityDetailed("i had a sandwich", "self_betrayal");
    const requiredOldFields = [
      "total","visceral","anthropomorph","brevity","concrete","contradiction","aiCliche",
    ] as const;
    for (const f of requiredOldFields) {
      expect(d).toHaveProperty(f);
      expect(typeof (d as Record<string, unknown>)[f]).toBe("number");
    }
  });

  it("new metadata fields are present and additive", () => {
    const d = scoreHookQualityDetailed("the list ghosted me first", "self_betrayal");
    expect(d).toHaveProperty("verbTier");
    expect(d).toHaveProperty("anthropomorphBranch");
    expect(d).toHaveProperty("contradictionSource");
    expect(d).toHaveProperty("aiClicheFired");
    expect(d).toHaveProperty("humanLift");
    expect(d.humanLift).toHaveProperty("understatedAbsurdity");
    expect(d.humanLift).toHaveProperty("emotionalSpecificity");
    expect(d.humanLift).toHaveProperty("brevityWideningDelta");
    expect(d.humanLift).toHaveProperty("total");
  });
});
