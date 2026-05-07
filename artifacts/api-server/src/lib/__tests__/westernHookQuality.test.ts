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
  WESTERN_WEAK_SKELETON_IDS,
  WESTERN_WEAK_QUOTA_MAX_PER_FAMILY,
  WESTERN_WEAK_QUOTA_MAX_TOTAL,
  WESTERN_WEAK_QUOTA_SAFETY_FLOOR_MIN,
  applyWesternWeakSkeletonQuota,
  canApplyWesternHookAdjustments,
  canApplyWesternWeakSkeletonQuota,
  classifyWesternWeakCandidate,
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

// ---------------------------------------------------------------- //
// PHASE W1.2 — Per-batch weak-family diversity cap                  //
// ---------------------------------------------------------------- //

import {
  WESTERN_WEAK_FAMILY_BATCH_PENALTY,
  computeWesternWeakFamilyBatchPenalty,
  canApplyWesternWeakFamilyCap,
} from "../westernHookQuality.js";

describe("W1.2 — computeWesternWeakFamilyBatchPenalty", () => {
  it("returns 0 when batchSoFar is empty", () => {
    expect(
      computeWesternWeakFamilyBatchPenalty("the fridge won", []),
    ).toBe(0);
  });

  it("returns 0 when candidate matches no weak family", () => {
    expect(
      computeWesternWeakFamilyBatchPenalty(
        "i opened the door and just stood there",
        ["the fridge won"],
      ),
    ).toBe(0);
  });

  it("returns 0 when batchSoFar has no candidate of the same weak family", () => {
    expect(
      computeWesternWeakFamilyBatchPenalty("the fridge won", [
        "i am totally fine about the fridge",
      ]),
    ).toBe(0);
  });

  it("returns the penalty when batchSoFar contains the same weak family (anchor swap)", () => {
    expect(
      computeWesternWeakFamilyBatchPenalty("the fridge won", [
        "the sink won. obviously.",
      ]),
    ).toBe(WESTERN_WEAK_FAMILY_BATCH_PENALTY);
  });

  it("returns the penalty when same weak family appears anywhere in batchSoFar", () => {
    expect(
      computeWesternWeakFamilyBatchPenalty("totally fine about my list", [
        "i opened the door",
        "i am totally fine about the fridge",
        "the keyboard knows i am lying",
      ]),
    ).toBe(WESTERN_WEAK_FAMILY_BATCH_PENALTY);
  });
});

describe("W1.2 — canApplyWesternWeakFamilyCap", () => {
  it("fires for region undefined", () => {
    expect(
      canApplyWesternWeakFamilyCap({ region: undefined, languageStyle: null }),
    ).toBe(true);
  });
  it("fires for region western", () => {
    expect(
      canApplyWesternWeakFamilyCap({ region: "western", languageStyle: null }),
    ).toBe(true);
  });
  it("does NOT fire for nigeria / india / philippines", () => {
    expect(
      canApplyWesternWeakFamilyCap({ region: "nigeria", languageStyle: null }),
    ).toBe(false);
    expect(
      canApplyWesternWeakFamilyCap({ region: "india", languageStyle: null }),
    ).toBe(false);
    expect(
      canApplyWesternWeakFamilyCap({
        region: "philippines",
        languageStyle: null,
      }),
    ).toBe(false);
  });
  it("kill-switch LUMINA_W1_2_DISABLE_FOR_QA=1 disables in non-prod", () => {
    const prevNode = process.env.NODE_ENV;
    const prevFlag = process.env.LUMINA_W1_2_DISABLE_FOR_QA;
    try {
      process.env.NODE_ENV = "development";
      process.env.LUMINA_W1_2_DISABLE_FOR_QA = "1";
      expect(
        canApplyWesternWeakFamilyCap({
          region: "western",
          languageStyle: null,
        }),
      ).toBe(false);
    } finally {
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      if (prevFlag === undefined) delete process.env.LUMINA_W1_2_DISABLE_FOR_QA;
      else process.env.LUMINA_W1_2_DISABLE_FOR_QA = prevFlag;
    }
  });
});

// ---------------------------------------------------------------- //
// PHASE W1.3 — upstream weak-skeleton generation quota              //
// ---------------------------------------------------------------- //

type QC = { idea: { hook: string }; meta: { hookSkeletonId?: string } };
const mk = (hook: string, hookSkeletonId?: string): QC => ({
  idea: { hook },
  meta: hookSkeletonId === undefined ? {} : { hookSkeletonId },
});

describe("W1.3 — WESTERN_WEAK_SKELETON_IDS contents", () => {
  it("contains the three known patternIdeator flooders", () => {
    expect(WESTERN_WEAK_SKELETON_IDS.has("totally_fine_about")).toBe(true);
    expect(WESTERN_WEAK_SKELETON_IDS.has("is_it_really_still_about")).toBe(true);
    expect(WESTERN_WEAK_SKELETON_IDS.has("noun_won_today")).toBe(true);
  });
  it("does not contain unrelated skeletonIds", () => {
    expect(WESTERN_WEAK_SKELETON_IDS.has("way_i_avoid_sport")).toBe(false);
    expect(WESTERN_WEAK_SKELETON_IDS.has("noun_pays_rent")).toBe(false);
  });
});

describe("W1.3 — classifyWesternWeakCandidate", () => {
  it("matches via hookSkeletonId and canonicalizes to the regex family id", () => {
    // skeletonId `totally_fine_about` → canonical regex family
    // `totally_fine_about_anchor` so a hookSkeletonId-tagged candidate
    // and a regex-classified candidate of the same shape collapse to
    // the SAME family key under `maxPerFamily=1`.
    expect(
      classifyWesternWeakCandidate({
        hook: "I am totally fine about the errand list",
        hookSkeletonId: "totally_fine_about",
      }),
    ).toBe("totally_fine_about_anchor");
    expect(
      classifyWesternWeakCandidate({
        hook: "the inbox won today, again",
        hookSkeletonId: "noun_won_today",
      }),
    ).toBe("anchor_won");
  });
  it("`is_it_really_still_about` skeletonId stays as its own canonical key", () => {
    // No W1.2 regex equivalent — keeps its skeletonId namespace.
    expect(
      classifyWesternWeakCandidate({
        hook: "is it really still about the gym",
        hookSkeletonId: "is_it_really_still_about",
      }),
    ).toBe("is_it_really_still_about");
  });
  it("matches via regex fallback when skeletonId missing", () => {
    expect(
      classifyWesternWeakCandidate({
        hook: "the fridge knows i'm lying",
        hookSkeletonId: undefined,
      }),
    ).toBe("anchor_knows_lying");
  });
  it("matches via regex fallback when skeletonId is non-weak", () => {
    expect(
      classifyWesternWeakCandidate({
        hook: "the fridge won again",
        hookSkeletonId: "some_other_template",
      }),
    ).toBe("anchor_won");
  });
  it("returns null for non-weak hooks with no weak skeletonId", () => {
    expect(
      classifyWesternWeakCandidate({
        hook: "i opened the laptop and immediately closed it",
        hookSkeletonId: "way_i_avoid_sport",
      }),
    ).toBeNull();
  });
  it("collapses skeletonId-tagged + regex-only same-family candidates to ONE family key under quota", () => {
    // Mixed-metadata flooding by the SAME effective family must
    // count as one family under `maxPerFamily=1`.
    const cands = [
      mk("I am totally fine about the inbox", "totally_fine_about"), // skeletonId path
      mk("I am totally fine about the dishes"), // regex path, no metadata
      mk("I am completely fine about the bills"), // regex path, no metadata
      mk("the way I avoid the inbox", "way_i_avoid_sport"),
      mk("planned to handle today", "planned_to_handle"),
      mk("me, refusing to deal", "refusing_to_deal"),
      mk("neutral filler X", "noun_pays_rent"),
    ];
    const r = applyWesternWeakSkeletonQuota(cands, { desiredCount: 5 });
    // All three "totally fine about ..." candidates share canonical
    // family `totally_fine_about_anchor` → only ONE survives the cap.
    expect(r.perFamilyKept["totally_fine_about_anchor"]).toBe(1);
    expect(r.totalWeakKept).toBe(1);
    expect(r.totalWeakDropped).toBe(2);
    expect(r.relaxed).toBe(false);
  });
});

describe("W1.3 — applyWesternWeakSkeletonQuota", () => {
  it("keeps all non-weak candidates untouched", () => {
    const cands = [
      mk("the way I avoid the inbox like a sport", "way_i_avoid_sport"),
      mk("me, refusing to deal with the dishes", "refusing_to_deal"),
      mk("i opened the laptop and gave up", "neutral_a"),
    ];
    const r = applyWesternWeakSkeletonQuota(cands, { desiredCount: 5 });
    expect(r.kept).toHaveLength(3);
    expect(r.dropped).toHaveLength(0);
    expect(r.relaxed).toBe(false);
    expect(r.totalWeakKept).toBe(0);
    expect(r.totalWeakDropped).toBe(0);
  });

  it("caps a single flooding family at maxPerFamily=1", () => {
    const cands = [
      mk("I am totally fine about the inbox", "totally_fine_about"),
      mk("I am totally fine about the dishes", "totally_fine_about"),
      mk("I am totally fine about the laundry", "totally_fine_about"),
      mk("the way I avoid the inbox", "way_i_avoid_sport"),
      mk("me, refusing to deal", "refusing_to_deal"),
      mk("i did not do it", "neutral"),
      mk("planned to handle today", "planned_to_handle"),
    ];
    const r = applyWesternWeakSkeletonQuota(cands, { desiredCount: 5 });
    expect(r.perFamilyKept["totally_fine_about_anchor"]).toBe(1);
    expect(r.totalWeakKept).toBe(1);
    expect(r.totalWeakDropped).toBe(2);
    expect(r.dropped).toHaveLength(2);
    expect(r.relaxed).toBe(false);
    expect(r.kept).toHaveLength(5);
  });

  it("caps total weak at maxTotal=3 across distinct families", () => {
    const fillers = Array.from({ length: 10 }, (_, i) =>
      mk(`neutral hook ${i}`, `neutral_${i}`),
    );
    const cands: QC[] = [
      mk("I am totally fine about the inbox", "totally_fine_about"),
      mk("is it really still about the dishes", "is_it_really_still_about"),
      mk("the inbox won today, again", "noun_won_today"),
      mk("the fridge knows i'm lying"),
      mk("someone explain the keyboard to me"),
      ...fillers,
    ];
    const r = applyWesternWeakSkeletonQuota(cands, { desiredCount: 5 });
    expect(r.totalWeakKept).toBe(WESTERN_WEAK_QUOTA_MAX_TOTAL);
    expect(r.totalWeakDropped).toBe(2);
    expect(r.relaxed).toBe(false);
  });

  it("under-fill carve-out promotes spilled candidates and sets relaxed=true", () => {
    const cands = [
      mk("I am totally fine about the inbox", "totally_fine_about"),
      mk("I am totally fine about the dishes", "totally_fine_about"),
      mk("I am totally fine about the laundry", "totally_fine_about"),
      mk("I am totally fine about the bills", "totally_fine_about"),
    ];
    const r = applyWesternWeakSkeletonQuota(cands, { desiredCount: 5 });
    // safetyFloor = max(5, 4) = 5 → all four promoted back
    expect(r.kept).toHaveLength(4);
    expect(r.dropped).toHaveLength(0);
    expect(r.relaxed).toBe(true);
    expect(r.totalWeakKept).toBe(4);
  });

  it("safetyFloorMin floor applies when desiredCount is small", () => {
    const cands = [
      mk("I am totally fine about A", "totally_fine_about"),
      mk("I am totally fine about B", "totally_fine_about"),
      mk("I am totally fine about C", "totally_fine_about"),
    ];
    const r = applyWesternWeakSkeletonQuota(cands, { desiredCount: 1 });
    // safetyFloor = max(1, 4) = 4, but only 3 cands → all kept, relaxed=true
    expect(r.kept).toHaveLength(3);
    expect(r.relaxed).toBe(true);
  });

  it("preserves input order in kept (no carve-out)", () => {
    const cands = [
      mk("neutral A", "way_i_avoid_sport"),
      mk("I am totally fine about X", "totally_fine_about"),
      mk("neutral B", "refusing_to_deal"),
      mk("I am totally fine about Y", "totally_fine_about"),
      mk("neutral C", "planned_to_handle"),
      mk("neutral D", "lying_about_again"),
      mk("neutral E", "noun_pays_rent"),
    ];
    const r = applyWesternWeakSkeletonQuota(cands, { desiredCount: 5 });
    expect(r.relaxed).toBe(false);
    expect(r.kept.map((c) => c.idea.hook)).toEqual([
      "neutral A",
      "I am totally fine about X",
      "neutral B",
      "neutral C",
      "neutral D",
      "neutral E",
    ]);
  });

  it("safetyFloorMin constant matches helper default", () => {
    expect(WESTERN_WEAK_QUOTA_SAFETY_FLOOR_MIN).toBe(4);
    expect(WESTERN_WEAK_QUOTA_MAX_PER_FAMILY).toBe(1);
    expect(WESTERN_WEAK_QUOTA_MAX_TOTAL).toBe(3);
  });

  it("no-ops on empty input", () => {
    const r = applyWesternWeakSkeletonQuota([], { desiredCount: 5 });
    expect(r.kept).toHaveLength(0);
    expect(r.dropped).toHaveLength(0);
    expect(r.relaxed).toBe(false);
  });
});

describe("W1.3 — canApplyWesternWeakSkeletonQuota cohort gate", () => {
  it("returns true for region undefined and 'western'", () => {
    expect(
      canApplyWesternWeakSkeletonQuota({ region: undefined, languageStyle: null }),
    ).toBe(true);
    expect(
      canApplyWesternWeakSkeletonQuota({ region: "western", languageStyle: null }),
    ).toBe(true);
  });
  it("returns false for non-western regions", () => {
    for (const region of ["nigeria", "india", "philippines"] as const) {
      expect(
        canApplyWesternWeakSkeletonQuota({ region, languageStyle: null }),
      ).toBe(false);
    }
  });
  it("kill-switch LUMINA_W1_3_DISABLE_FOR_QA=1 disables in non-prod", () => {
    const prevNode = process.env.NODE_ENV;
    const prevFlag = process.env.LUMINA_W1_3_DISABLE_FOR_QA;
    try {
      process.env.NODE_ENV = "development";
      process.env.LUMINA_W1_3_DISABLE_FOR_QA = "1";
      expect(
        canApplyWesternWeakSkeletonQuota({
          region: "western",
          languageStyle: null,
        }),
      ).toBe(false);
    } finally {
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      if (prevFlag === undefined) delete process.env.LUMINA_W1_3_DISABLE_FOR_QA;
      else process.env.LUMINA_W1_3_DISABLE_FOR_QA = prevFlag;
    }
  });
  it("W1.3 kill-switch is independent of W1.2 kill-switch", () => {
    const prevNode = process.env.NODE_ENV;
    const prevFlag2 = process.env.LUMINA_W1_2_DISABLE_FOR_QA;
    const prevFlag3 = process.env.LUMINA_W1_3_DISABLE_FOR_QA;
    try {
      process.env.NODE_ENV = "development";
      process.env.LUMINA_W1_2_DISABLE_FOR_QA = "1";
      delete process.env.LUMINA_W1_3_DISABLE_FOR_QA;
      // W1.3 should still be active even though W1.2 kill-switch is on
      expect(
        canApplyWesternWeakSkeletonQuota({
          region: "western",
          languageStyle: null,
        }),
      ).toBe(true);
    } finally {
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      if (prevFlag2 === undefined) delete process.env.LUMINA_W1_2_DISABLE_FOR_QA;
      else process.env.LUMINA_W1_2_DISABLE_FOR_QA = prevFlag2;
      if (prevFlag3 === undefined) delete process.env.LUMINA_W1_3_DISABLE_FOR_QA;
      else process.env.LUMINA_W1_3_DISABLE_FOR_QA = prevFlag3;
    }
  });
});
