/**
 * PHASE N1-STYLE — unit tests for the cohort-gated American-internet
 * style penalty. Verifies:
 *   1. Activation gate: returns 0 for every non-NG-pidgin cohort,
 *      every flag-off configuration.
 *   2. Pattern detection: returns >0 for catalog-style hooks confirmed
 *      by the throttle audit.
 *   3. Per-match accumulation + cap.
 *   4. Authentic Pidgin / pack hooks pass through unpenalized when
 *      the gate IS active (no false positives).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  AMERICAN_INTERNET_PATTERNS,
  STYLE_PENALTY_PER_MATCH,
  STYLE_PENALTY_CAP,
  computeNigerianStylePenalty,
  isNigerianStylePenaltyFeatureEnabled,
} from "../nigerianStylePenalty.js";
import { APPROVED_NIGERIAN_PROMOTION_CANDIDATES } from "../nigerianHookPackApproved.js";

describe("N1-STYLE — isNigerianStylePenaltyFeatureEnabled", () => {
  const original = process.env.LUMINA_NG_STYLE_PENALTY_ENABLED;
  afterEach(() => {
    if (original === undefined) {
      delete process.env.LUMINA_NG_STYLE_PENALTY_ENABLED;
    } else {
      process.env.LUMINA_NG_STYLE_PENALTY_ENABLED = original;
    }
  });

  it("defaults to false when env unset", () => {
    delete process.env.LUMINA_NG_STYLE_PENALTY_ENABLED;
    expect(isNigerianStylePenaltyFeatureEnabled()).toBe(false);
  });

  it("returns false for any value other than literal 'true'", () => {
    process.env.LUMINA_NG_STYLE_PENALTY_ENABLED = "1";
    expect(isNigerianStylePenaltyFeatureEnabled()).toBe(false);
    process.env.LUMINA_NG_STYLE_PENALTY_ENABLED = "TRUE";
    expect(isNigerianStylePenaltyFeatureEnabled()).toBe(false);
    process.env.LUMINA_NG_STYLE_PENALTY_ENABLED = "yes";
    expect(isNigerianStylePenaltyFeatureEnabled()).toBe(false);
  });

  it("returns true only for literal 'true'", () => {
    process.env.LUMINA_NG_STYLE_PENALTY_ENABLED = "true";
    expect(isNigerianStylePenaltyFeatureEnabled()).toBe(true);
  });
});

describe("N1-STYLE — computeNigerianStylePenalty activation gate", () => {
  const tripingHook = "the dishes ruined my villain arc";

  it("returns 0 when flagEnabled=false (regardless of region/style)", () => {
    expect(
      computeNigerianStylePenalty({
        hook: tripingHook,
        region: "nigeria",
        languageStyle: "pidgin",
        flagEnabled: false,
      }),
    ).toBe(0);
  });

  it("returns 0 for region=undefined", () => {
    expect(
      computeNigerianStylePenalty({
        hook: tripingHook,
        region: undefined,
        languageStyle: "pidgin",
        flagEnabled: true,
      }),
    ).toBe(0);
  });

  it.each(["western", "india", "philippines"] as const)(
    "returns 0 for region=%s",
    (region) => {
      expect(
        computeNigerianStylePenalty({
          hook: tripingHook,
          region,
          languageStyle: "pidgin",
          flagEnabled: true,
        }),
      ).toBe(0);
    },
  );

  it("returns 0 for nigeria + languageStyle=null (NG-clean)", () => {
    expect(
      computeNigerianStylePenalty({
        hook: tripingHook,
        region: "nigeria",
        languageStyle: null,
        flagEnabled: true,
      }),
    ).toBe(0);
  });

  it("returns 0 for nigeria + languageStyle='clean' (non-pidgin)", () => {
    expect(
      computeNigerianStylePenalty({
        hook: tripingHook,
        region: "nigeria",
        languageStyle: "clean",
        flagEnabled: true,
      }),
    ).toBe(0);
  });

  it("activates ONLY for nigeria + pidgin/light_pidgin + flagEnabled=true", () => {
    for (const languageStyle of ["pidgin", "light_pidgin"] as const) {
      const out = computeNigerianStylePenalty({
        hook: tripingHook,
        region: "nigeria",
        languageStyle,
        flagEnabled: true,
      });
      expect(out).toBeGreaterThan(0);
    }
  });
});

describe("N1-STYLE — pattern detection (gate active)", () => {
  const ngActive = {
    region: "nigeria" as const,
    languageStyle: "pidgin" as const,
    flagEnabled: true,
  };

  it.each([
    "the dishes ruined my villain arc",
    "the bed demolished my entire vibe",
    "the gym and i are co-conspirators now",
    "the lockscreen keeps revealing itself",
    "the fork itself is the entire pattern",
    "WHY does the fork keep avoiding itself",
    "lived rent-free in my head",
    "this is so unhinged",
    "main character energy today",
    "the keyboard ate my homework",
  ])("penalizes catalog-style hook: %s", (hook) => {
    const out = computeNigerianStylePenalty({ hook, ...ngActive });
    expect(out).toBeGreaterThanOrEqual(STYLE_PENALTY_PER_MATCH);
  });

  it("returns 0 for neutral catalog hooks", () => {
    const neutralHooks = [
      "i raided the fridge. it didn't notice.",
      "watched myself dodge the calendar live",
      "this fridge flatlined my whole week",
      "i looked at my own groupchat and got quiet",
    ];
    for (const hook of neutralHooks) {
      expect(computeNigerianStylePenalty({ hook, ...ngActive })).toBe(0);
    }
  });

  it("returns 0 for every approved pack hook (no false positives on authored content)", () => {
    // Use the static approved pool directly — the runtime
    // `NIGERIAN_HOOK_PACK` export returns an empty stub when the
    // feature flag is off in the test process, which would silently
    // skip this assertion.
    expect(APPROVED_NIGERIAN_PROMOTION_CANDIDATES.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const entry of APPROVED_NIGERIAN_PROMOTION_CANDIDATES) {
      const out = computeNigerianStylePenalty({
        hook: entry.hook,
        ...ngActive,
      });
      if (out > 0) offenders.push(entry.hook);
    }
    expect(offenders).toEqual([]);
  });

  it("accumulates per match and caps at STYLE_PENALTY_CAP", () => {
    // Two matches in one hook (villain arc + ruined my villain).
    const twoMatch = "the dishes ruined my villain arc";
    const out = computeNigerianStylePenalty({
      hook: twoMatch,
      region: "nigeria",
      languageStyle: "pidgin",
      flagEnabled: true,
    });
    expect(out).toBeGreaterThanOrEqual(STYLE_PENALTY_PER_MATCH * 2);
    expect(out).toBeLessThanOrEqual(STYLE_PENALTY_CAP);
  });

  it("cap holds even if every pattern matches", () => {
    // Synthesise a hook with many matches.
    const all = AMERICAN_INTERNET_PATTERNS.length;
    const synthetic =
      "villain arc demolished my entire vibe ruined my villain " +
      "killed my vibe co-conspirator unhinged main character " +
      "lived rent-free the bed itself is the personality is " +
      "the keyboard ate my homework keeps revealing itself avoiding myself";
    const out = computeNigerianStylePenalty({
      hook: synthetic,
      region: "nigeria",
      languageStyle: "pidgin",
      flagEnabled: true,
    });
    expect(out).toBe(STYLE_PENALTY_CAP);
    expect(all).toBeGreaterThan(STYLE_PENALTY_CAP / STYLE_PENALTY_PER_MATCH);
  });
});
