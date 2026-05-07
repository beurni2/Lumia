/**
 * PHASE N1-LIVE-HARDEN F2 — region-anchor validator tests.
 *
 * Pins:
 *   • Term hits in any rendered surface return the reject code
 *     `western_anchor_in_ng_pidgin`.
 *   • Cohort-gate helper short-circuits to `false` for every cohort
 *     other than nigeria + (light_pidgin | pidgin) + flagOn +
 *     packLength>0.
 *   • Validator is byte-pure — does NOT touch idea fields, never
 *     mutates the input.
 */

import { describe, it, expect } from "vitest";
import type { Idea } from "../ideaGen";
import {
  shouldApplyNigerianRegionAnchorValidator,
  validateNigerianRegionAnchor,
  WESTERN_ONLY_BRAND_TERMS,
} from "../nigerianRegionAnchorValidator";

function mkIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    hook: "hook",
    whatToShow: "show",
    howToFilm: "film",
    caption: "cap",
    pattern: "mini_story",
    emotionalSpike: "relief",
    hookStyle: "behavior_hook",
    pickerEligible: true,
    ...overrides,
  } as unknown as Idea;
}

describe("validateNigerianRegionAnchor", () => {
  it("returns null for an idea with no western brands", () => {
    const idea = mkIdea({
      hook: "abeg make i show you wetin happen for canteen",
      whatToShow: "you eating jollof from a buka",
      howToFilm: "phone on table, single take",
      caption: "the way naija mornings dey go",
    });
    expect(validateNigerianRegionAnchor(idea)).toBe(null);
  });

  it("rejects doordash in hook", () => {
    expect(
      validateNigerianRegionAnchor(mkIdea({ hook: "i ordered doordash again" })),
    ).toBe("western_anchor_in_ng_pidgin");
  });

  it("rejects venmo in caption", () => {
    expect(
      validateNigerianRegionAnchor(
        mkIdea({ caption: "venmo me back later, friend" }),
      ),
    ).toBe("western_anchor_in_ng_pidgin");
  });

  it("rejects cash app (two words) in script", () => {
    expect(
      validateNigerianRegionAnchor(
        mkIdea({ script: "she said cash app me already" } as any),
      ),
    ).toBe("western_anchor_in_ng_pidgin");
  });

  it("rejects cashapp (one word) in whatToShow", () => {
    expect(
      validateNigerianRegionAnchor(
        mkIdea({ whatToShow: "cashapp screen reaction" }),
      ),
    ).toBe("western_anchor_in_ng_pidgin");
  });

  it("rejects walmart in howToFilm", () => {
    expect(
      validateNigerianRegionAnchor(
        mkIdea({ howToFilm: "outside walmart parking lot" }),
      ),
    ).toBe("western_anchor_in_ng_pidgin");
  });

  it("rejects trader joe's in shotPlan", () => {
    expect(
      validateNigerianRegionAnchor(
        mkIdea({ shotPlan: ["enter trader joe's"] } as any),
      ),
    ).toBe("western_anchor_in_ng_pidgin");
  });

  it("rejects every seed term independently", () => {
    const seeds = [
      "doordash",
      "venmo",
      "cashapp",
      "cash app",
      "zelle",
      "walmart",
      "target",
      "trader joe",
      "trader joes",
      "trader joe's",
      "starbucks",
      "dunkin",
      "whole foods",
      "costco",
      "cvs",
      "walgreens",
      "ihop",
      "chipotle",
      "ubereats",
      "uber eats",
      "grubhub",
      "amazon prime",
      "netflix",
      "hulu",
    ];
    for (const term of seeds) {
      const out = validateNigerianRegionAnchor(
        mkIdea({ hook: `i was at the ${term} place` }),
      );
      expect(out, `expected reject for term: ${term}`).toBe(
        "western_anchor_in_ng_pidgin",
      );
    }
  });

  it("does NOT match brand-name SUBSTRINGS inside other words", () => {
    // word boundaries — `cvsa` / `targeted` should not falsely match.
    expect(
      validateNigerianRegionAnchor(mkIdea({ caption: "targeted feedback" })),
    ).toBe(null);
    expect(
      validateNigerianRegionAnchor(mkIdea({ caption: "cvsa is a fake word" })),
    ).toBe(null);
  });

  it("does not mutate the idea object", () => {
    const idea = mkIdea({ hook: "doordash arrival" });
    const snap = JSON.stringify(idea);
    validateNigerianRegionAnchor(idea);
    expect(JSON.stringify(idea)).toBe(snap);
  });

  it("seed term list is non-empty", () => {
    expect(WESTERN_ONLY_BRAND_TERMS.length).toBeGreaterThan(20);
  });
});

describe("shouldApplyNigerianRegionAnchorValidator (cohort gate)", () => {
  const baseOn = { flagEnabled: true, packLength: 50 };

  it("activates for nigeria + light_pidgin + flag on + pack non-empty", () => {
    expect(
      shouldApplyNigerianRegionAnchorValidator({
        region: "nigeria",
        languageStyle: "light_pidgin",
        ...baseOn,
      }),
    ).toBe(true);
  });

  it("activates for nigeria + pidgin + flag on + pack non-empty", () => {
    expect(
      shouldApplyNigerianRegionAnchorValidator({
        region: "nigeria",
        languageStyle: "pidgin",
        ...baseOn,
      }),
    ).toBe(true);
  });

  it("does NOT activate for nigeria + clean", () => {
    expect(
      shouldApplyNigerianRegionAnchorValidator({
        region: "nigeria",
        languageStyle: "clean",
        ...baseOn,
      }),
    ).toBe(false);
  });

  it("does NOT activate for nigeria + null languageStyle", () => {
    expect(
      shouldApplyNigerianRegionAnchorValidator({
        region: "nigeria",
        languageStyle: null,
        ...baseOn,
      }),
    ).toBe(false);
  });

  it("does NOT activate for western / india / philippines (any languageStyle)", () => {
    for (const region of ["western", "india", "philippines"] as const) {
      for (const ls of [null, "clean", "light_pidgin", "pidgin"] as const) {
        expect(
          shouldApplyNigerianRegionAnchorValidator({
            region,
            languageStyle: ls,
            ...baseOn,
          }),
          `region=${region} ls=${ls}`,
        ).toBe(false);
      }
    }
  });

  it("does NOT activate when flag is OFF (even nigeria + pidgin)", () => {
    expect(
      shouldApplyNigerianRegionAnchorValidator({
        region: "nigeria",
        languageStyle: "pidgin",
        flagEnabled: false,
        packLength: 50,
      }),
    ).toBe(false);
  });

  it("does NOT activate when pack is empty", () => {
    expect(
      shouldApplyNigerianRegionAnchorValidator({
        region: "nigeria",
        languageStyle: "pidgin",
        flagEnabled: true,
        packLength: 0,
      }),
    ).toBe(false);
  });

  it("does NOT activate for region undefined", () => {
    expect(
      shouldApplyNigerianRegionAnchorValidator({
        region: undefined,
        languageStyle: "pidgin",
        ...baseOn,
      }),
    ).toBe(false);
  });
});
