// PHASE N1-FOLLOWUP-NG-WEAK-SKELETON-QUOTA — sibling tests of the
// Western W1.3 quota with a NG-narrow blocklist (only
// `totally_fine_about`). Mirrors the structure of the Western quota
// tests in `westernHookQuality.test.ts` so future maintainers can
// reason about the two layers symmetrically.
import { describe, expect, it } from "vitest";
import {
  NIGERIAN_WEAK_SKELETON_IDS,
  applyNigerianWeakSkeletonQuota,
  canApplyNigerianWeakSkeletonQuota,
  classifyNigerianWeakCandidate,
} from "../nigerianWeakSkeletonQuota";

type Cand = {
  idea: { hook: string };
  meta: { hookSkeletonId?: string };
};

const cand = (hook: string, hookSkeletonId?: string): Cand => ({
  idea: { hook },
  meta: hookSkeletonId === undefined ? {} : { hookSkeletonId },
});

describe("NG weak-skeleton quota — NIGERIAN_WEAK_SKELETON_IDS contents", () => {
  it("contains only the audit-authorised skeleton", () => {
    expect(NIGERIAN_WEAK_SKELETON_IDS.has("totally_fine_about")).toBe(true);
    // The Western W1.3 set also blocks these — they are deliberately
    // OUT OF SCOPE for the NG follow-up phase.
    expect(NIGERIAN_WEAK_SKELETON_IDS.has("is_it_really_still_about")).toBe(
      false,
    );
    expect(NIGERIAN_WEAK_SKELETON_IDS.has("noun_won_today")).toBe(false);
    // Sanity — non-weak skeletons are never in the set.
    expect(NIGERIAN_WEAK_SKELETON_IDS.has("way_i_avoid_sport")).toBe(false);
    expect(NIGERIAN_WEAK_SKELETON_IDS.size).toBe(1);
  });
});

describe("NG weak-skeleton quota — classifyNigerianWeakCandidate", () => {
  it("matches the totally_fine_about skeletonId", () => {
    expect(
      classifyNigerianWeakCandidate({
        hook: "I am totally fine about the wifi",
        hookSkeletonId: "totally_fine_about",
      }),
    ).toBe("totally_fine_about");
  });

  it("does NOT match other Western weak skeletons", () => {
    expect(
      classifyNigerianWeakCandidate({
        hook: "is it really still about the wifi",
        hookSkeletonId: "is_it_really_still_about",
      }),
    ).toBeNull();
    expect(
      classifyNigerianWeakCandidate({
        hook: "the wifi won today",
        hookSkeletonId: "noun_won_today",
      }),
    ).toBeNull();
  });

  it("does NOT match a non-weak skeletonId", () => {
    expect(
      classifyNigerianWeakCandidate({
        hook: "the way I avoid the wifi like a sport",
        hookSkeletonId: "way_i_avoid_sport",
      }),
    ).toBeNull();
  });

  it("returns null when hookSkeletonId is missing (no regex fallback for NG)", () => {
    // Brief constraint: NG classifier does NOT consult any regex
    // family classifier — Claude / llama mutations re-emitting the
    // weak shape without a tag are deliberately out of scope.
    expect(
      classifyNigerianWeakCandidate({
        hook: "I am totally fine about the wifi",
      }),
    ).toBeNull();
    expect(
      classifyNigerianWeakCandidate({
        hook: "I am totally fine about the wifi",
        hookSkeletonId: undefined,
      }),
    ).toBeNull();
    expect(
      classifyNigerianWeakCandidate({
        hook: "I am totally fine about the wifi",
        hookSkeletonId: null,
      }),
    ).toBeNull();
  });
});

describe("NG weak-skeleton quota — canApplyNigerianWeakSkeletonQuota", () => {
  it("activates ONLY for region === 'nigeria'", () => {
    expect(canApplyNigerianWeakSkeletonQuota({ region: "nigeria" })).toBe(true);
    expect(
      canApplyNigerianWeakSkeletonQuota({
        region: "nigeria",
        languageStyle: "pidgin",
      }),
    ).toBe(true);
    expect(
      canApplyNigerianWeakSkeletonQuota({
        region: "nigeria",
        languageStyle: "light_pidgin",
      }),
    ).toBe(true);
    expect(
      canApplyNigerianWeakSkeletonQuota({
        region: "nigeria",
        languageStyle: null,
      }),
    ).toBe(true);
  });

  it("does NOT activate for any non-NG cohort (zero-overhead promise)", () => {
    expect(canApplyNigerianWeakSkeletonQuota({ region: undefined })).toBe(
      false,
    );
    expect(canApplyNigerianWeakSkeletonQuota({ region: "western" })).toBe(
      false,
    );
    expect(canApplyNigerianWeakSkeletonQuota({ region: "india" })).toBe(false);
    expect(canApplyNigerianWeakSkeletonQuota({ region: "philippines" })).toBe(
      false,
    );
  });

  it("respects the LUMINA_NG_WEAK_QUOTA_DISABLE_FOR_QA kill-switch (non-prod)", () => {
    const prevKill = process.env.LUMINA_NG_WEAK_QUOTA_DISABLE_FOR_QA;
    const prevNode = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "test";
      process.env.LUMINA_NG_WEAK_QUOTA_DISABLE_FOR_QA = "1";
      expect(canApplyNigerianWeakSkeletonQuota({ region: "nigeria" })).toBe(
        false,
      );
      // In production the kill-switch is ignored.
      process.env.NODE_ENV = "production";
      expect(canApplyNigerianWeakSkeletonQuota({ region: "nigeria" })).toBe(
        true,
      );
    } finally {
      if (prevKill === undefined) {
        delete process.env.LUMINA_NG_WEAK_QUOTA_DISABLE_FOR_QA;
      } else {
        process.env.LUMINA_NG_WEAK_QUOTA_DISABLE_FOR_QA = prevKill;
      }
      if (prevNode === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = prevNode;
      }
    }
  });
});

describe("NG weak-skeleton quota — applyNigerianWeakSkeletonQuota", () => {
  it("keeps everything when no candidate is weak", () => {
    const cands = [
      cand("the way I avoid the wifi like a sport", "way_i_avoid_sport"),
      cand("why did I lie to myself about the wifi", "why_lie_about"),
      cand("me, refusing to deal with the wifi"),
    ];
    const r = applyNigerianWeakSkeletonQuota(cands, { desiredCount: 5 });
    expect(r.kept).toHaveLength(3);
    expect(r.dropped).toHaveLength(0);
    expect(r.relaxed).toBe(false);
    expect(r.totalWeakKept).toBe(0);
    expect(r.totalWeakDropped).toBe(0);
  });

  it("drops weak candidates beyond the per-family cap", () => {
    const cands = [
      cand("why did I lie to myself about the wifi", "why_lie_about"),
      cand("I am totally fine about the wifi", "totally_fine_about"),
      cand("I am totally fine about the bed", "totally_fine_about"),
      cand("I am totally fine about the inbox", "totally_fine_about"),
      cand("me, refusing to deal with the wifi"),
    ];
    const r = applyNigerianWeakSkeletonQuota(cands, { desiredCount: 5 });
    // 1 non-weak + 1 weak survives + 1 non-weak = 3, but safety floor
    // = max(desiredCount=5, 4) so under-fill carve-out promotes the
    // remaining weak entries back until floor is met.
    expect(r.kept.length).toBeGreaterThanOrEqual(5);
    expect(r.relaxed).toBe(true);
  });

  it("under-fill carve-out preserves never-underfill invariant", () => {
    // Pool small enough that dropping weak candidates would drop us
    // below the safety floor — they MUST be promoted back.
    const cands = [
      cand("why did I lie to myself about the wifi", "why_lie_about"),
      cand("I am totally fine about the wifi", "totally_fine_about"),
      cand("I am totally fine about the bed", "totally_fine_about"),
      cand("I am totally fine about the inbox", "totally_fine_about"),
    ];
    const r = applyNigerianWeakSkeletonQuota(cands, { desiredCount: 4 });
    expect(r.kept.length).toBe(4);
    expect(r.relaxed).toBe(true);
  });

  it("under-fill carve-out NOT triggered when pool already exceeds floor with non-weak", () => {
    const cands = [
      cand("a", "way_i_avoid_sport"),
      cand("b", "way_i_avoid_sport"),
      cand("c", "way_i_avoid_sport"),
      cand("d", "way_i_avoid_sport"),
      cand("e", "way_i_avoid_sport"),
      cand("f", "way_i_avoid_sport"),
      cand("I am totally fine about the wifi", "totally_fine_about"),
      cand("I am totally fine about the bed", "totally_fine_about"),
      cand("I am totally fine about the inbox", "totally_fine_about"),
    ];
    const r = applyNigerianWeakSkeletonQuota(cands, { desiredCount: 5 });
    expect(r.totalWeakKept).toBe(1);
    expect(r.totalWeakDropped).toBe(2);
    expect(r.relaxed).toBe(false);
    expect(r.kept).toHaveLength(7);
  });

  it("is deterministic across repeated invocations", () => {
    // Same input → same output ordering, twice. (The carve-out
    // promotes spilled weak candidates to the TAIL of `kept` rather
    // than re-interleaving them in input order — symmetric with the
    // Western implementation. Determinism here is the
    // single-pass-then-promote contract, not strict input ordering.)
    const cands = [
      cand("a", "way_i_avoid_sport"),
      cand("I am totally fine about the wifi", "totally_fine_about"),
      cand("b", "way_i_avoid_sport"),
      cand("I am totally fine about the bed", "totally_fine_about"),
      cand("c", "way_i_avoid_sport"),
    ];
    const r1 = applyNigerianWeakSkeletonQuota(cands, { desiredCount: 5 });
    const r2 = applyNigerianWeakSkeletonQuota(cands, { desiredCount: 5 });
    expect(r1.kept.map((c) => c.idea.hook)).toEqual(
      r2.kept.map((c) => c.idea.hook),
    );
    expect(r1.relaxed).toBe(r2.relaxed);
    expect(r1.totalWeakKept).toBe(r2.totalWeakKept);
    // Sanity: every input row appears exactly once across kept+dropped.
    const allOut = [...r1.kept, ...r1.dropped].map((c) => c.idea.hook).sort();
    expect(allOut).toEqual(cands.map((c) => c.idea.hook).sort());
  });

  it("does NOT classify untagged 'I am totally fine about X' (no regex fallback)", () => {
    // Mutation hook re-emitting the weak shape without the
    // `meta.hookSkeletonId` tag MUST NOT be caught by the NG quota
    // (matches the brief's "Keep the blocklist narrow" rule).
    const cands = [
      cand("I am totally fine about the wifi"),
      cand("I am totally fine about the bed"),
      cand("I am totally fine about the inbox"),
    ];
    const r = applyNigerianWeakSkeletonQuota(cands, { desiredCount: 5 });
    expect(r.kept).toHaveLength(3);
    expect(r.totalWeakKept).toBe(0);
    expect(r.totalWeakDropped).toBe(0);
  });

  it("does NOT touch other Western weak skeletons (NG narrow scope)", () => {
    const cands = [
      cand("is it really still about the wifi", "is_it_really_still_about"),
      cand("is it really still about the bed", "is_it_really_still_about"),
      cand("the wifi won today", "noun_won_today"),
      cand("the bed won today", "noun_won_today"),
    ];
    const r = applyNigerianWeakSkeletonQuota(cands, { desiredCount: 5 });
    expect(r.kept).toHaveLength(4);
    expect(r.totalWeakKept).toBe(0);
    expect(r.totalWeakDropped).toBe(0);
  });
});
