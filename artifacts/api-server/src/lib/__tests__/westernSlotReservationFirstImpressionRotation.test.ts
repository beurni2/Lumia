/**
 * PHASE W2-QA-FIX-1 (Task A) — first-impression deterministic
 * quality-band rotation tests for `applyWesternApprovedPackSlotReservation`.
 *
 * Pure unit tests over the new `creatorId` cold-start rotation
 * branch. No DB / network. The rotation MUST:
 *   • fire when `excludeAxes` is structurally empty AND `creatorId`
 *     is provided (cold-start)
 *   • be deterministic — same creatorId + same pool ⇒ same pick
 *   • spread picks across at least 2 distinct pool indices when
 *     >=2 candidates fall inside the K=5 quality band
 *   • NOT pick any candidate outside the K=5 band (no quality
 *     regression)
 *   • be a NO-OP on refresh (any non-empty axis Set), legacy
 *     callers (no creatorId), and non-Western activation cohorts
 *   • not double-reserve the rotated entry as the 2nd-W2 slot
 */

import { describe, expect, it } from "vitest";

import type { ScoredCandidate } from "../ideaScorer.js";
import {
  W2_FIRST_IMPRESSION_QUALITY_BAND_K,
  applyWesternApprovedPackSlotReservation,
  pickFirstImpressionWinnerForTesting,
  type WesternExcludeAxes,
  type WesternPackCandidate,
} from "../westernPackSlotReservation.js";

function emptyAxes(over: Partial<WesternExcludeAxes> = {}): WesternExcludeAxes {
  return {
    entryIds: new Set(),
    hooks: new Set(),
    skeletons: new Set(),
    anchors: new Set(),
    families: new Set(),
    spikes: new Set(),
    settings: new Set(),
    hookStyles: new Set(),
    ...over,
  };
}

function mkScored(hook: string): ScoredCandidate {
  return {
    idea: { hook, hookStyle: "internal_thought" } as ScoredCandidate["idea"],
    meta: {},
    score: {
      total: 0,
      hookImpact: 0,
      tension: 0,
      filmability: 0,
      personalFit: 0,
      captionStrength: 0,
      freshness: 0,
      scrollStopScore: 0,
      hookIntentScore: 0,
      heroQuality: 0,
    },
    rewriteAttempted: false,
  } as ScoredCandidate;
}

function mkCand(
  i: number,
  qualityScore: number,
  over: Partial<{
    family: string;
    setting: string;
    spike: string;
    anchor: string;
    skeleton: string;
  }> = {},
): WesternPackCandidate {
  const id = `w2_fi_${i.toString().padStart(3, "0")}`;
  // The slot-reservation function returns the underlying
  // `candidate.candidate` ScoredCandidate untouched — it does NOT
  // stamp meta. So we identify each fixture by a unique hook
  // substring (`#${id}#`) the way existing W2 tests do.
  return {
    candidate: mkScored(`hook for ${id} talking about ${over.anchor ?? `anchor_${i}`}`),
    entryId: id,
    comedyFamily: over.family ?? `family_${i}`,
    setting: over.setting ?? `setting_${i}`,
    anchor: over.anchor ?? `anchor_${i}`,
    emotionalSpike: over.spike ?? `spike_${i}`,
    hookSkeleton: over.skeleton ?? `__ ${i} __ __ ${i}`,
    hookStyle: "internal_thought",
    qualityScore,
  };
}

const COMMON = {
  selectionBatch: [] as ScoredCandidate[],
  desiredCount: 3,
  region: undefined,
  languageStyle: undefined,
  flagEnabled: true,
  packLength: 100,
};

describe("pickFirstImpressionWinnerForTesting (band picker)", () => {
  it("returns pool[0] when the band is size-1 (only leader within K)", () => {
    const pool = [
      mkCand(1, 80),
      mkCand(2, 70), // 80 - 70 = 10 > K=5 → outside band
      mkCand(3, 60),
    ];
    expect(pickFirstImpressionWinnerForTesting(pool, "creator-x")).toBe(pool[0]);
    expect(pickFirstImpressionWinnerForTesting(pool, "creator-y")).toBe(pool[0]);
  });

  it("never picks an entry outside the K=5 quality band", () => {
    // Band: indices 0..2 (scores 80, 78, 76); index 3 = 60 outside band.
    const pool = [mkCand(1, 80), mkCand(2, 78), mkCand(3, 76), mkCand(4, 60)];
    for (let i = 0; i < 200; i++) {
      const w = pickFirstImpressionWinnerForTesting(pool, `creator_${i}`);
      expect(pool.indexOf(w)).toBeLessThan(3);
      // Defensive sanity: chosen quality is at least leader - K.
      expect(w.qualityScore).toBeGreaterThanOrEqual(80 - W2_FIRST_IMPRESSION_QUALITY_BAND_K);
    }
  });

  it("distributes picks across ≥2 distinct band indices for many creator ids", () => {
    const pool = [mkCand(1, 80), mkCand(2, 78), mkCand(3, 76)];
    const distinctIdx = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const w = pickFirstImpressionWinnerForTesting(pool, `creator_${i}`);
      distinctIdx.add(pool.indexOf(w));
    }
    expect(distinctIdx.size).toBeGreaterThanOrEqual(2);
  });

  it("is deterministic — same creatorId yields same pick", () => {
    const pool = [mkCand(1, 80), mkCand(2, 78), mkCand(3, 76)];
    const a = pickFirstImpressionWinnerForTesting(pool, "stable-creator");
    const b = pickFirstImpressionWinnerForTesting(pool, "stable-creator");
    const c = pickFirstImpressionWinnerForTesting(pool, "stable-creator");
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("throws when pool is empty (caller contract)", () => {
    expect(() => pickFirstImpressionWinnerForTesting([], "x")).toThrow();
  });
});

describe("applyWesternApprovedPackSlotReservation — cold-start rotation", () => {
  it("fires on empty axes + creatorId, picks within band, deterministic", () => {
    const w2Candidates = [
      mkCand(1, 80),
      mkCand(2, 78),
      mkCand(3, 77),
      mkCand(4, 60), // outside band
    ];

    const picksByCreator = new Map<string, string>();
    for (let i = 0; i < 30; i++) {
      const cid = `creator_${i}`;
      const out = applyWesternApprovedPackSlotReservation({
        ...COMMON,
        w2Candidates,
        excludeAxes: emptyAxes(),
        creatorId: cid,
      });
      // Identify slot-1 by hook substring (no meta is stamped here).
      const firstHook = out[0]!.idea.hook;
      const matched = ["w2_fi_001", "w2_fi_002", "w2_fi_003"].find((id) =>
        firstHook.includes(id),
      );
      expect(matched).toBeDefined();
      picksByCreator.set(cid, matched!);
    }
    // Spread across ≥2 entries.
    const distinct = new Set(picksByCreator.values());
    expect(distinct.size).toBeGreaterThanOrEqual(2);

    // Determinism — replaying same creatorId gives same pick.
    for (const [cid, expected] of picksByCreator) {
      const out = applyWesternApprovedPackSlotReservation({
        ...COMMON,
        w2Candidates,
        excludeAxes: emptyAxes(),
        creatorId: cid,
      });
      expect(out[0]!.idea.hook).toContain(expected);
    }
  });

  it("is a NO-OP when creatorId is missing — falls back to pool[0] (legacy callers)", () => {
    const w2Candidates = [mkCand(1, 80), mkCand(2, 78), mkCand(3, 77)];
    const out = applyWesternApprovedPackSlotReservation({
      ...COMMON,
      w2Candidates,
      excludeAxes: emptyAxes(),
      // creatorId intentionally omitted
    });
    expect(out[0]!.idea.hook).toContain("w2_fi_001"); // pre-Fix-1: pool[0]
  });

  it("is a NO-OP when axes are non-empty (refresh batch) — picks pool[0]", () => {
    const w2Candidates = [mkCand(1, 80), mkCand(2, 78), mkCand(3, 77)];
    // Even ONE filled set should disable rotation — refresh memory exists.
    const refreshAxes = emptyAxes({ anchors: new Set(["unused_anchor"]) });
    for (const cid of ["alpha", "bravo", "charlie", "delta", "echo"]) {
      const out = applyWesternApprovedPackSlotReservation({
        ...COMMON,
        w2Candidates,
        excludeAxes: refreshAxes,
        creatorId: cid,
      });
      expect(out[0]!.idea.hook).toContain("w2_fi_001");
    }
  });

  it("does NOT double-reserve the rotated entry as the 2nd-W2 slot", () => {
    // Pool: 5 entries, all within band. Force rotation to a non-zero
    // index by choosing many creatorIds and verifying each batch's
    // two W2 slots have distinct hook strings.
    const w2Candidates = [
      mkCand(1, 80, { family: "fa", setting: "sa", spike: "spa", anchor: "an1", skeleton: "sk1" }),
      mkCand(2, 79, { family: "fb", setting: "sb", spike: "spb", anchor: "an2", skeleton: "sk2" }),
      mkCand(3, 78, { family: "fc", setting: "sc", spike: "spc", anchor: "an3", skeleton: "sk3" }),
      mkCand(4, 77, { family: "fd", setting: "sd", spike: "spd", anchor: "an4", skeleton: "sk4" }),
      mkCand(5, 76, { family: "fe", setting: "se", spike: "spe", anchor: "an5", skeleton: "sk5" }),
    ];
    // Provide 1 non-W2 in the batch so maxReserved=2.
    const nonW2: ScoredCandidate = mkScored("a non w2 hook here entirely");
    // The W2 ids 001..005 — filter to W2-source hooks (those
    // containing "w2_fi_") then verify distinctness.
    let sawTwoW2Slots = 0;
    for (let i = 0; i < 50; i++) {
      const out = applyWesternApprovedPackSlotReservation({
        ...COMMON,
        selectionBatch: [nonW2],
        w2Candidates,
        excludeAxes: emptyAxes(),
        creatorId: `cr_${i}`,
      });
      const w2Hooks = out
        .map((c) => c.idea.hook)
        .filter((h) => h.includes("w2_fi_"));
      const distinct = new Set(w2Hooks);
      expect(distinct.size).toBe(w2Hooks.length); // no double-reserve
      if (w2Hooks.length >= 2) sawTwoW2Slots++;
    }
    expect(sawTwoW2Slots).toBeGreaterThan(0);
  });
});
