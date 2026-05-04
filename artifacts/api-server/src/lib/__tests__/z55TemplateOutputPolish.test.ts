/**
 * PHASE Z5.5 — Template Output Polish regression tests.
 *
 * Pins the Z5.5 additive fixes:
 *   1. No "Shop chef eat student" or similar malformed script LINE 3.
 *   2. Reaction ending diversity (no single reaction dominates).
 *   3. Caption-tail diversity (expanded pool, no single tail dominates).
 *   4. Cold-start skeleton similarity guard (hookWordBigrams + Jaccard).
 *   5. Existing Z5 corpus integrity preserved.
 */
import { describe, it, expect } from "vitest";
import {
  authorCohesiveIdea,
  type CohesiveAuthorInput,
} from "../cohesiveIdeaAuthor.js";
import { PREMISE_CORES } from "../premiseCoreLibrary.js";
import { VOICE_CLUSTERS } from "../voiceClusters.js";
import { loadSeedHookFingerprints } from "../comedyValidation.js";
import {
  hookWordBigrams,
  hookBigramJaccard,
} from "../ideaScorer.js";
import { USER_BLESSED_HOOK_CORPUS } from "../userBlessedHookCorpus.js";

const seedFingerprints = loadSeedHookFingerprints();

const GROCERY_CORE = PREMISE_CORES.find(
  (c) => c.id === "adulting_chaos_grocery_optimism",
)!;

const DEFAULT_VOICE = VOICE_CLUSTERS.find((v) => v.id === "dry_deadpan")!;

const ANCHORS = ["grocery bag", "alarm", "phone", "charger", "fridge", "inbox", "coffee", "laptop"];

function makeInput(
  overrides: Partial<CohesiveAuthorInput> = {},
): CohesiveAuthorInput {
  return {
    core: overrides.core ?? GROCERY_CORE,
    domain: overrides.domain ?? "food",
    anchor: overrides.anchor ?? "grocery bag",
    action: overrides.action ?? "inspect",
    voice: overrides.voice ?? DEFAULT_VOICE,
    regenerateSalt: overrides.regenerateSalt ?? 0,
    seedFingerprints,
  };
}

describe("Z5.5 — Template Output Polish", () => {
  describe("T001: No malformed script artifacts", () => {
    it("script LINE 3 uses core.tension, not humanized mechanism", () => {
      const result = authorCohesiveIdea(makeInput());
      if (!result.ok) return;
      expect(result.idea.script).not.toMatch(/shop chef eat student/i);
      expect(result.idea.script).toContain("LINE 3");
      const line3Match = result.idea.script.match(/LINE 3[^:]*:\s*(.+)/);
      expect(line3Match).toBeTruthy();
      const line3Text = line3Match![1]!;
      expect(line3Text.toLowerCase()).toContain(
        GROCERY_CORE.tension.toLowerCase().slice(0, 15),
      );
    });

    it("no mechanism humanization produces word-salad in any core", () => {
      for (const core of PREMISE_CORES) {
        const result = authorCohesiveIdea(
          makeInput({ core, anchor: "phone", action: "check" }),
        );
        if (!result.ok) continue;
        const allText = JSON.stringify(result.idea).toLowerCase();
        expect(allText).not.toMatch(/\bshop chef eat student\b/i);
      }
    });

    it("regression: 'Shop chef eat student' absent from all idea fields for grocery core", () => {
      const result = authorCohesiveIdea(makeInput());
      if (!result.ok) return;
      const allText = JSON.stringify(result.idea).toLowerCase();
      expect(allText).not.toContain("shop chef eat student");
    });

    it("premise and whyItWorks use core.tension not mechanism", () => {
      const result = authorCohesiveIdea(makeInput());
      if (!result.ok) return;
      expect(result.idea.premise?.toLowerCase()).toContain("shop like a chef");
      expect(result.idea.premise?.toLowerCase()).not.toContain("shop chef eat student");
      expect(result.idea.whyItWorks?.toLowerCase()).not.toContain("shop chef eat student");
    });
  });

  describe("T002: Reaction ending diversity", () => {
    it("reactions vary across different core+anchor combinations", () => {
      const reactions = new Set<string>();
      let deadpanCount = 0;
      for (const core of PREMISE_CORES.slice(0, 10)) {
        for (const anchor of ANCHORS.slice(0, 4)) {
          const result = authorCohesiveIdea(
            makeInput({ core, anchor, action: "check" }),
          );
          if (!result.ok) continue;
          reactions.add(result.idea.reaction);
          if (/deadpan\s*(stare|glare)/i.test(result.idea.reaction)) {
            deadpanCount++;
          }
        }
      }
      expect(reactions.size).toBeGreaterThan(3);
      expect(deadpanCount).toBe(0);
    });

    it("trigger field varies across core+anchor combinations", () => {
      const triggers = new Set<string>();
      for (const core of PREMISE_CORES.slice(0, 8)) {
        for (const anchor of ANCHORS.slice(0, 3)) {
          const result = authorCohesiveIdea(
            makeInput({ core, anchor, action: "check" }),
          );
          if (!result.ok) continue;
          triggers.add(result.idea.trigger);
        }
      }
      expect(triggers.size).toBeGreaterThan(1);
    });

    it("shotPlan beat 3 varies across core+anchor combinations", () => {
      const beat3s = new Set<string>();
      for (const core of PREMISE_CORES.slice(0, 8)) {
        for (const anchor of ANCHORS.slice(0, 3)) {
          const result = authorCohesiveIdea(
            makeInput({ core, anchor, action: "check" }),
          );
          if (!result.ok) continue;
          const sp = result.idea.shotPlan;
          if (sp.length >= 3) beat3s.add(sp[2]!);
        }
      }
      expect(beat3s.size).toBeGreaterThan(1);
    });
  });

  describe("T003: Caption-tail diversity", () => {
    it("captions use more than 4 distinct tails across core+anchor sample", () => {
      const captions = new Set<string>();
      for (const core of PREMISE_CORES.slice(0, 10)) {
        for (const anchor of ANCHORS.slice(0, 3)) {
          const result = authorCohesiveIdea(
            makeInput({ core, anchor, action: "check" }),
          );
          if (!result.ok) continue;
          captions.add(result.idea.caption);
        }
      }
      expect(captions.size).toBeGreaterThan(4);
    });

    it("no single caption tail pattern exceeds 30% of sample", () => {
      const tails = [
        "fine probably",
        "lying about it now",
        "pretending it didn't",
        "send help",
      ];
      const results: string[] = [];
      for (const core of PREMISE_CORES.slice(0, 15)) {
        for (const anchor of ANCHORS.slice(0, 3)) {
          const result = authorCohesiveIdea(
            makeInput({ core, anchor, action: "check" }),
          );
          if (!result.ok) continue;
          results.push(result.idea.caption);
        }
      }
      if (results.length === 0) return;
      for (const tail of tails) {
        const count = results.filter((c) =>
          c.toLowerCase().includes(tail),
        ).length;
        expect(count / results.length).toBeLessThan(0.3);
      }
    });
  });

  describe("T004: Cold-start skeleton similarity guard", () => {
    it("hookWordBigrams extracts correct bigrams", () => {
      const bigrams = hookWordBigrams("my own charger is spiraling me back");
      expect(bigrams.size).toBe(6);
      expect(bigrams.has("my|own")).toBe(true);
      expect(bigrams.has("own|charger")).toBe(true);
      expect(bigrams.has("is|spiraling")).toBe(true);
    });

    it("returns empty set for hooks shorter than 4 words", () => {
      expect(hookWordBigrams("too short").size).toBe(0);
      expect(hookWordBigrams("a b c").size).toBe(0);
    });

    it("hooks from same template have Jaccard >= 0.45 (threshold)", () => {
      const a = hookWordBigrams("my own charger is spiraling me back!!");
      const b = hookWordBigrams("my own keyboard is spiraling me back!!");
      expect(hookBigramJaccard(a, b)).toBeGreaterThanOrEqual(0.45);
    });

    it("longer hooks from same template have Jaccard > 0.6", () => {
      const a = hookWordBigrams("i watched myself abandon the charger and pretend it was fine live");
      const b = hookWordBigrams("i watched myself abandon the laptop and pretend it was fine live");
      expect(hookBigramJaccard(a, b)).toBeGreaterThan(0.6);
    });

    it("genuinely different hooks have Jaccard < 0.3", () => {
      const a = hookWordBigrams("my own charger is spiraling me back");
      const b = hookWordBigrams("i ghosted my alarm clock this morning");
      expect(hookBigramJaccard(a, b)).toBeLessThan(0.3);
    });

    it("Jaccard returns 0 for empty sets", () => {
      expect(hookBigramJaccard(new Set(), new Set())).toBe(0);
      expect(
        hookBigramJaccard(
          new Set(["a|b"]),
          new Set(),
        ),
      ).toBe(0);
    });
  });

  describe("T006: Existing corpus integrity preserved", () => {
    it("corpus size unchanged at 532", () => {
      expect(USER_BLESSED_HOOK_CORPUS.length).toBe(532);
    });
  });
});
