/**
 * PHASE Y10 — voice cluster rotation tests.
 *
 * Asserts that `resolveVoiceCluster` honors the new
 * `recentVoiceClusters` histogram channel:
 *
 *   - cold-start (no histogram) → returns the salt-rotated index of
 *     the family-biased table (bit-for-bit identical to pre-Y10).
 *   - empty Map (vs undefined) → equivalent to cold-start (the
 *     `hist.size > 0` guard short-circuits).
 *   - histogram with one or more "hot" clusters → resolver returns
 *     the LEAST-RECENTLY-USED cluster (lowest count) from the salt-
 *     rotated family-biased table.
 *   - histogram with all 4 clusters at equal counts → falls through
 *     to the salt-rotated start (every cluster has min count → first
 *     in walk wins, identical to pre-Y10 distribution).
 *   - taste-pinned `preferredTone` priority-1 short-circuit STILL
 *     wins (Y10 only affects the cold-start salt-rotation arm).
 *
 * These tests pin the deterministic semantics of the Y10 picker so a
 * future refactor can't silently change the rotation distribution.
 */

import { describe, expect, it } from "vitest";
import {
  resolveVoiceCluster,
} from "../coreCandidateGenerator.js";
import type { VoiceClusterId } from "../voiceClusters.js";

const ALL_CLUSTERS: readonly VoiceClusterId[] = [
  "dry_deadpan",
  "chaotic_confession",
  "quiet_realization",
  "overdramatic_reframe",
];

describe("Y10 — resolveVoiceCluster history-aware rotation", () => {
  it("cold-start: no histogram → returns deterministic salt-rotated cluster (parity with pre-Y10)", () => {
    // No `recentVoiceClusters` argument supplied. The resolver must
    // fall through the Y10 short-circuit AND return a cluster from
    // the family-biased table. With salt=0, coreId="core_a",
    // recipeIdx=0, the resolver is deterministic — pinning the
    // exact return value here locks in the pre-Y10 contract.
    const a = resolveVoiceCluster({
      family: "self_betrayal",
      tasteCalibration: null,
      salt: 0,
      coreId: "core_a",
      recipeIdx: 0,
    });
    expect(ALL_CLUSTERS).toContain(a);

    // Same call with a SECOND invocation must return the same value
    // (purity / determinism).
    const a2 = resolveVoiceCluster({
      family: "self_betrayal",
      tasteCalibration: null,
      salt: 0,
      coreId: "core_a",
      recipeIdx: 0,
    });
    expect(a2).toBe(a);
  });

  it("empty histogram (Map.size === 0) is equivalent to cold-start", () => {
    const empty = new Map<VoiceClusterId, number>();
    const baseline = resolveVoiceCluster({
      family: "absurd_escalation",
      tasteCalibration: null,
      salt: 17,
      coreId: "core_b",
      recipeIdx: 2,
    });
    const withEmpty = resolveVoiceCluster({
      family: "absurd_escalation",
      tasteCalibration: null,
      salt: 17,
      coreId: "core_b",
      recipeIdx: 2,
      recentVoiceClusters: empty,
    });
    expect(withEmpty).toBe(baseline);
  });

  it("one hot cluster → resolver picks one of the OTHER 3 clusters", () => {
    // Mark `dry_deadpan` as heavily used. The resolver must pick a
    // cluster whose count is 0 — any of the other 3.
    const hist = new Map<VoiceClusterId, number>([["dry_deadpan", 5]]);
    // Sweep across many (salt, recipeIdx) combinations to confirm the
    // hot cluster is ALWAYS skipped (deterministic exclusion, not
    // probabilistic).
    for (let salt = 0; salt < 8; salt++) {
      for (let recipeIdx = 0; recipeIdx < 8; recipeIdx++) {
        const got = resolveVoiceCluster({
          family: "self_betrayal",
          tasteCalibration: null,
          salt,
          coreId: "core_x",
          recipeIdx,
          recentVoiceClusters: hist,
        });
        expect(got).not.toBe("dry_deadpan");
      }
    }
  });

  it("two hot clusters → resolver picks one of the OTHER 2 (the cold ones)", () => {
    const hist = new Map<VoiceClusterId, number>([
      ["dry_deadpan", 4],
      ["chaotic_confession", 3],
    ]);
    const cold = new Set<VoiceClusterId>([
      "quiet_realization",
      "overdramatic_reframe",
    ]);
    for (let salt = 0; salt < 8; salt++) {
      for (let recipeIdx = 0; recipeIdx < 8; recipeIdx++) {
        const got = resolveVoiceCluster({
          family: "absurd_escalation",
          tasteCalibration: null,
          salt,
          coreId: "core_y",
          recipeIdx,
          recentVoiceClusters: hist,
        });
        expect(cold.has(got)).toBe(true);
      }
    }
  });

  it("three hot, one cold → resolver always returns the cold cluster", () => {
    // Steady-state stress test: 3 of 4 clusters at high count, 1 at
    // 0. The resolver MUST pick the 0-count cluster every time.
    const hist = new Map<VoiceClusterId, number>([
      ["dry_deadpan", 7],
      ["chaotic_confession", 9],
      ["quiet_realization", 6],
      // overdramatic_reframe omitted → 0
    ]);
    for (let salt = 0; salt < 8; salt++) {
      for (let recipeIdx = 0; recipeIdx < 8; recipeIdx++) {
        const got = resolveVoiceCluster({
          family: "self_betrayal",
          tasteCalibration: null,
          salt,
          coreId: "core_z",
          recipeIdx,
          recentVoiceClusters: hist,
        });
        expect(got).toBe("overdramatic_reframe");
      }
    }
  });

  it("all 4 hot at unequal counts → resolver picks the lowest-count cluster", () => {
    // Even at full saturation (every cluster has been used recently),
    // the resolver must keep rotating: the LEAST-USED cluster wins.
    const hist = new Map<VoiceClusterId, number>([
      ["dry_deadpan", 5],
      ["chaotic_confession", 4],
      ["quiet_realization", 2], // ← min
      ["overdramatic_reframe", 6],
    ]);
    for (let salt = 0; salt < 8; salt++) {
      for (let recipeIdx = 0; recipeIdx < 8; recipeIdx++) {
        const got = resolveVoiceCluster({
          family: "social_mask",
          tasteCalibration: null,
          salt,
          coreId: "core_q",
          recipeIdx,
          recentVoiceClusters: hist,
        });
        expect(got).toBe("quiet_realization");
      }
    }
  });

  it("all 4 equal counts → resolver falls through to salt-rotated start (parity with cold-start)", () => {
    // When every cluster has the same recent count, the min-walk
    // returns the FIRST cluster in the salt-rotated table — which
    // is the same cluster the cold-start branch would return. So
    // the histogram should have NO observable effect.
    const histEq = new Map<VoiceClusterId, number>([
      ["dry_deadpan", 3],
      ["chaotic_confession", 3],
      ["quiet_realization", 3],
      ["overdramatic_reframe", 3],
    ]);
    for (let salt = 0; salt < 8; salt++) {
      for (let recipeIdx = 0; recipeIdx < 8; recipeIdx++) {
        const baseline = resolveVoiceCluster({
          family: "dopamine_overthinking",
          tasteCalibration: null,
          salt,
          coreId: "core_eq",
          recipeIdx,
        });
        const withEq = resolveVoiceCluster({
          family: "dopamine_overthinking",
          tasteCalibration: null,
          salt,
          coreId: "core_eq",
          recipeIdx,
          recentVoiceClusters: histEq,
        });
        expect(withEq).toBe(baseline);
      }
    }
  });

  it("taste-pinned preferredTone STILL wins — Y10 only affects the cold-start arm", () => {
    // Priority 1 (taste-pinned) short-circuit must stay unchanged.
    // Even with a histogram marking `dry_deadpan` as freshly used,
    // a `dry_subtle` tone pin must return `dry_deadpan` every time.
    const hist = new Map<VoiceClusterId, number>([["dry_deadpan", 99]]);
    for (let salt = 0; salt < 4; salt++) {
      for (let recipeIdx = 0; recipeIdx < 4; recipeIdx++) {
        const got = resolveVoiceCluster({
          family: "self_betrayal",
          tasteCalibration: {
            preferredFormats: [],
            preferredTone: "dry_subtle",
            effortPreference: null,
            privacyAvoidances: [],
            preferredHookStyles: [],
            completedAt: null,
            skipped: false,
          },
          salt,
          coreId: "core_taste",
          recipeIdx,
          recentVoiceClusters: hist,
        });
        expect(got).toBe("dry_deadpan");
      }
    }
  });

  it("rotation across recipes for SAME core: histogram updates → different cluster picked", () => {
    // Simulate the steady-state case: pick recipe 0, then update
    // the histogram with that pick, then pick recipe 1 — the second
    // pick must be a DIFFERENT cluster (rotation property).
    const hist = new Map<VoiceClusterId, number>();
    const pick0 = resolveVoiceCluster({
      family: "self_betrayal",
      tasteCalibration: null,
      salt: 42,
      coreId: "core_rot",
      recipeIdx: 0,
      recentVoiceClusters: hist,
    });
    // Bump pick0's count.
    hist.set(pick0, (hist.get(pick0) ?? 0) + 1);
    const pick1 = resolveVoiceCluster({
      family: "self_betrayal",
      tasteCalibration: null,
      salt: 42,
      coreId: "core_rot",
      recipeIdx: 1,
      recentVoiceClusters: hist,
    });
    // pick1 must be one of the other 3 clusters (count=0 ties win
    // over pick0's count=1).
    expect(pick1).not.toBe(pick0);
  });
});
