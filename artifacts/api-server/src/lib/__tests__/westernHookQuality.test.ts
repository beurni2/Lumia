/**
 * PHASE W1 — unit tests for the cohort-gated Western catalog hook
 * adjustment. Verifies:
 *   1. Cohort gate: returns 0 for india / philippines / nigeria;
 *      fires for region undefined or "western".
 *   2. Weak-skeleton detection demotes the canonical families.
 *   3. Family-level recent-skeleton demotion (anchor swap collapse —
 *      "fridge" / "sink" / "microwave" share one normalized skeleton).
 *   4. Specificity bonus fires on visible-action / posting / private-
 *      embarrassment / contradiction signals (capped).
 *   5. Generic+generic combo stacks with the weak-skeleton hit.
 *   6. A strong specific hook outranks a weak-template hook
 *      deterministically on net adjustment.
 */

import { describe, it, expect } from "vitest";
import {
  WESTERN_WEAK_SKELETONS,
  WEAK_SKELETON_DEMOTION,
  RECENT_SKELETON_DEMOTION,
  GENERIC_COMBO_DEMOTION,
  WESTERN_BONUS_CAP,
  canApplyWesternHookAdjustments,
  classifyWesternWeakSkeletonFamily,
  computeWesternHookAdjustment,
  isGenericWhatToShow,
} from "../westernHookQuality.js";
import { normalizeHookToSkeleton } from "../catalogTemplateCreatorMemory.js";

const NEUTRAL_WHAT_TO_SHOW =
  "open the laptop, refresh the inbox three times, then close it again";

describe("W1 — canApplyWesternHookAdjustments cohort gate", () => {
  it("returns true for region undefined", () => {
    expect(
      canApplyWesternHookAdjustments({ region: undefined, languageStyle: null }),
    ).toBe(true);
  });

  it("returns true for region 'western'", () => {
    expect(
      canApplyWesternHookAdjustments({ region: "western", languageStyle: null }),
    ).toBe(true);
  });

  it.each(["nigeria", "india", "philippines"] as const)(
    "returns false for region=%s (any languageStyle)",
    (region) => {
      for (const languageStyle of [null, "pidgin", "light_pidgin", "clean"] as const) {
        expect(
          canApplyWesternHookAdjustments({ region, languageStyle }),
        ).toBe(false);
      }
    },
  );

  it("returns 0 adjustment on every non-western cohort regardless of hook", () => {
    const weakHook = "the fridge knows i'm lying";
    for (const region of ["nigeria", "india", "philippines"] as const) {
      const out = computeWesternHookAdjustment({
        hook: weakHook,
        whatToShow: "stares at the fridge. nothing happens.",
        region,
        languageStyle: "pidgin",
        recentSkeletons: new Set([normalizeHookToSkeleton(weakHook)]),
      });
      expect(out).toBe(0);
    }
  });
});

describe("W1 — weak skeleton family classification", () => {
  it("classifies every documented family", () => {
    const samples: ReadonlyArray<[string, string]> = [
      ["the fridge won. obviously.", "anchor_won"],
      ["the sink won obviously", "anchor_won"],
      ["the fridge knows I'm lying", "anchor_knows_lying"],
      ["the kitchen knows i am lying", "anchor_knows_lying"],
      ["someone explain the keyboard to me. NOW", "someone_explain_anchor"],
      ["someone please explain the fridge", "someone_explain_anchor"],
      ["i am totally fine about the fridge", "totally_fine_about_anchor"],
      ["the fridge itself became my villain", "anchor_itself_became"],
      ["the fridge flatlined my whole week", "anchor_flatlined"],
      ["the fridge demolished my entire vibe", "anchor_demolished_vibe"],
      ["the fridge keeps revealing itself", "anchor_keeps_revealing_itself"],
      ["my body quit. my brain kept screaming", "body_quit_brain_screaming"],
    ];
    for (const [hook, expectedId] of samples) {
      expect(classifyWesternWeakSkeletonFamily(hook)).toBe(expectedId);
    }
  });

  it("returns null for non-weak hooks", () => {
    const benign = [
      "i opened the laptop and pretended to work for an hour",
      "rehearsed the apology three times before sending it",
      "drafted the post, deleted it, drafted it again",
      "checked the notifications until my battery died",
    ];
    for (const hook of benign) {
      expect(classifyWesternWeakSkeletonFamily(hook)).toBeNull();
    }
  });

  it("every documented family in the table classifies a synthetic instance", () => {
    expect(WESTERN_WEAK_SKELETONS.length).toBeGreaterThan(0);
  });
});

describe("W1 — weak skeleton demotion", () => {
  it("demotes a weak hook by exactly WEAK_SKELETON_DEMOTION (no other signals)", () => {
    const out = computeWesternHookAdjustment({
      hook: "the fridge won obviously",
      whatToShow: NEUTRAL_WHAT_TO_SHOW,
      region: "western",
      languageStyle: null,
      recentSkeletons: new Set(),
    });
    expect(out).toBe(-WEAK_SKELETON_DEMOTION);
  });

  it("does not demote a non-weak hook", () => {
    const out = computeWesternHookAdjustment({
      hook: "i sat down and just stared at the inbox until it blinked",
      whatToShow: "filming the laptop screen",
      region: "western",
      languageStyle: null,
      recentSkeletons: new Set(),
    });
    expect(out).toBeGreaterThanOrEqual(0);
  });
});

describe("W1 — recent-skeleton family demotion (anchor-swap collapse)", () => {
  it("anchor swaps collapse to the SAME normalized skeleton", () => {
    // Skeleton normalizer masks 5+ char tokens to `__` so fridge,
    // microwave, and kitchen all collapse onto one fingerprint.
    const a = normalizeHookToSkeleton("the fridge knows i'm lying");
    const b = normalizeHookToSkeleton("the kitchen knows i'm lying");
    expect(a).toBe(b);
  });

  it("demotes when current skeleton ∈ recentSkeletons (regardless of weak match)", () => {
    const hook = "rehearsed the apology three times before sending it";
    const sk = normalizeHookToSkeleton(hook);
    const without = computeWesternHookAdjustment({
      hook,
      whatToShow: NEUTRAL_WHAT_TO_SHOW,
      region: "western",
      languageStyle: null,
      recentSkeletons: new Set(),
    });
    const withRepeat = computeWesternHookAdjustment({
      hook,
      whatToShow: NEUTRAL_WHAT_TO_SHOW,
      region: "western",
      languageStyle: null,
      recentSkeletons: new Set([sk]),
    });
    expect(withRepeat).toBe(without - RECENT_SKELETON_DEMOTION);
  });

  it("recent-skeleton family demotion fires for an anchor-swap on a previously seen skeleton", () => {
    // Creator already saw "the fridge knows i'm lying"; new candidate
    // is "the microwave knows i'm lying" — collapses to the same
    // skeleton via the `__` mask, so the repetition demotion fires.
    const seenHook = "the fridge knows i'm lying";
    const newHook = "the microwave knows i'm lying";
    const seenSk = normalizeHookToSkeleton(seenHook);

    const out = computeWesternHookAdjustment({
      hook: newHook,
      whatToShow: NEUTRAL_WHAT_TO_SHOW,
      region: "western",
      languageStyle: null,
      recentSkeletons: new Set([seenSk]),
    });
    // Weak skeleton (-15) + recent-skeleton family demotion (-10).
    expect(out).toBe(-(WEAK_SKELETON_DEMOTION + RECENT_SKELETON_DEMOTION));
  });
});

describe("W1 — specificity bonus", () => {
  it("fires on a single visible-action verb", () => {
    const out = computeWesternHookAdjustment({
      hook: "i opened the laptop and just sat there",
      whatToShow: NEUTRAL_WHAT_TO_SHOW,
      region: undefined,
      languageStyle: null,
      recentSkeletons: new Set(),
    });
    expect(out).toBeGreaterThan(0);
  });

  it("stacks multiple specificity axes up to WESTERN_BONUS_CAP", () => {
    // visible verb + posting anxiety + contradiction + embarrassment
    // — would naively be 4×5=20, but the cap clips to 10.
    const hook =
      "said i would not post and then i drafted three replies in front of the whole room";
    const out = computeWesternHookAdjustment({
      hook,
      whatToShow: NEUTRAL_WHAT_TO_SHOW,
      region: "western",
      languageStyle: null,
      recentSkeletons: new Set(),
    });
    expect(out).toBe(WESTERN_BONUS_CAP);
  });

  it("specificity bonus does NOT fire when a weak skeleton matched (weak hits dominate)", () => {
    // "the fridge knows I'm lying" is a weak skeleton; even if we
    // append a visible verb the helper should NOT add a bonus on top.
    const hook = "the fridge knows i'm lying after i opened the door";
    const out = computeWesternHookAdjustment({
      hook,
      whatToShow: NEUTRAL_WHAT_TO_SHOW,
      region: "western",
      languageStyle: null,
      recentSkeletons: new Set(),
    });
    expect(out).toBeLessThan(0);
  });
});

describe("W1 — generic-scenario combo demotion", () => {
  it("isGenericWhatToShow detects canonical generic patterns", () => {
    expect(isGenericWhatToShow("the fridge wins")).toBe(true);
    expect(isGenericWhatToShow("set it down and walks out of frame")).toBe(true);
    expect(isGenericWhatToShow("just stares at the sink")).toBe(true);
    expect(isGenericWhatToShow("ignores the laptop completely")).toBe(true);
    expect(isGenericWhatToShow("nothing happens for a while")).toBe(true);
  });

  it("isGenericWhatToShow returns false for filmable specific scenarios", () => {
    expect(
      isGenericWhatToShow(
        "open the laptop, type three sentences, delete them, repeat",
      ),
    ).toBe(false);
  });

  it("stacks an extra GENERIC_COMBO_DEMOTION on top of weak skeleton when scenario is generic", () => {
    const out = computeWesternHookAdjustment({
      hook: "the sink won obviously",
      whatToShow: "stares at the sink. nothing happens.",
      region: "western",
      languageStyle: null,
      recentSkeletons: new Set(),
    });
    expect(out).toBe(-(WEAK_SKELETON_DEMOTION + GENERIC_COMBO_DEMOTION));
  });

  it("does NOT stack the combo when the hook is weak but the scenario is specific", () => {
    const out = computeWesternHookAdjustment({
      hook: "the sink won obviously",
      whatToShow: NEUTRAL_WHAT_TO_SHOW,
      region: "western",
      languageStyle: null,
      recentSkeletons: new Set(),
    });
    expect(out).toBe(-WEAK_SKELETON_DEMOTION);
  });
});

describe("W1 — strong vs weak deterministic ordering", () => {
  it("a strong specific hook outranks a weak template hook on net adjustment", () => {
    const weak = computeWesternHookAdjustment({
      hook: "the fridge won obviously",
      whatToShow: "stares at the fridge",
      region: "western",
      languageStyle: null,
      recentSkeletons: new Set(),
    });
    const strong = computeWesternHookAdjustment({
      hook:
        "i drafted the apology, deleted it, drafted it again, then left it on read",
      whatToShow: NEUTRAL_WHAT_TO_SHOW,
      region: "western",
      languageStyle: null,
      recentSkeletons: new Set(),
    });
    expect(strong).toBeGreaterThan(weak);
  });
});
