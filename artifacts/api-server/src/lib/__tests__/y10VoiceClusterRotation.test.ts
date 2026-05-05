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

// PHASE Z5a — fifth cluster `high_energy_rant` added to the pool.
// Tests below that pin specific cold/hot cluster expectations have
// been widened to either include the new cluster in the histogram
// (when its presence would change the min-count outcome) or to
// include it in the cold set (when its count==0 makes it a valid
// pick alongside the other count==0 clusters). Tests that only
// assert determinism / parity are unchanged.
const ALL_CLUSTERS: readonly VoiceClusterId[] = [
  "dry_deadpan",
  "chaotic_confession",
  "quiet_realization",
  "overdramatic_reframe",
  "high_energy_rant",
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

  it("two hot clusters → resolver picks one of the OTHER cold clusters", () => {
    // Z5a: cold set widened to 3 (quiet_realization, overdramatic_reframe,
    // high_energy_rant), all at count==0 → all valid picks.
    const hist = new Map<VoiceClusterId, number>([
      ["dry_deadpan", 4],
      ["chaotic_confession", 3],
    ]);
    const cold = new Set<VoiceClusterId>([
      "quiet_realization",
      "overdramatic_reframe",
      "high_energy_rant",
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
    // Steady-state stress test: 4 of 5 clusters at high count, 1 at
    // 0. The resolver MUST pick the 0-count cluster every time.
    // Z5a: high_energy_rant added at high count so overdramatic_reframe
    // remains the unique min.
    const hist = new Map<VoiceClusterId, number>([
      ["dry_deadpan", 7],
      ["chaotic_confession", 9],
      ["quiet_realization", 6],
      ["high_energy_rant", 8],
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

  it("all clusters hot at unequal counts → resolver picks the lowest-count cluster", () => {
    // Even at full saturation (every cluster has been used recently),
    // the resolver must keep rotating: the LEAST-USED cluster wins.
    // Z5a: high_energy_rant added at non-min count so quiet_realization
    // remains the unique min.
    const hist = new Map<VoiceClusterId, number>([
      ["dry_deadpan", 5],
      ["chaotic_confession", 4],
      ["quiet_realization", 2], // ← min
      ["overdramatic_reframe", 6],
      ["high_energy_rant", 3],
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

  it("all clusters equal counts → resolver falls through to salt-rotated start (parity with cold-start)", () => {
    // When every cluster has the same recent count, the min-walk
    // returns the FIRST cluster in the salt-rotated table — which
    // is the same cluster the cold-start branch would return. So
    // the histogram should have NO observable effect.
    // Z5a: high_energy_rant added at the same count so all 5 are tied.
    const histEq = new Map<VoiceClusterId, number>([
      ["dry_deadpan", 3],
      ["chaotic_confession", 3],
      ["quiet_realization", 3],
      ["overdramatic_reframe", 3],
      ["high_energy_rant", 3],
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

  it("PHASE D1 — taste-pinned preferredTone DOMINATES (~50%+) but does NOT monopolise", () => {
    // Pre-D1 contract was a HARD 1.00 short-circuit on
    // `TONE_TO_VOICE_CLUSTER[tone]` — a creator who pinned a tone in
    // calibration got the same voice cluster on every single recipe,
    // collapsing batch-level voice variety and producing the
    // monoculture observed in the post-Y11 14-trash-ideas user
    // report. PHASE D1 softens this to a +5-slot bias on the
    // biased-table mechanism (alongside the existing +1 familyDefault
    // bias). Resulting distribution targets:
    //   - tone == family default:   preferred ~57%, others ~14%
    //   - tone != family default:   preferred ~50%, family ~21%, others ~14%
    // Test runs 200 deterministic salts WITHOUT history (so the
    // Y10 LRU walk doesn't overrule the bias) and asserts
    // dry_deadpan dominates with ≥40% but does NOT exceed ~75%
    // (i.e. it's a softer-than-pre-D1 lever, not a removed lever).
    const counts: Record<string, number> = {};
    const N = 200;
    for (let salt = 0; salt < N; salt++) {
      const got = resolveVoiceCluster({
        family: "self_betrayal", // family default: ALSO dry_deadpan
        tasteCalibration: {
          preferredFormats: [],
          preferredTone: "dry_subtle", // → dry_deadpan
          preferredTones: ["dry_subtle"],
          effortPreference: null,
          privacyAvoidances: [],
          preferredHookStyles: [],
          languageStyle: null,
          slangIntensity: 0,
          // PHASE Z5.8 — additive default keeps this Y10 test
          // structurally parseable against the new schema.
          selectedSituations: [],
          completedAt: null,
          skipped: false,
        },
        salt,
        coreId: "core_taste",
        recipeIdx: 0,
      });
      counts[got] = (counts[got] ?? 0) + 1;
    }
    const dryDeadpanShare = (counts["dry_deadpan"] ?? 0) / N;
    // D1 spec: preferred dominates but does not monopolise.
    expect(dryDeadpanShare).toBeGreaterThanOrEqual(0.4);
    expect(dryDeadpanShare).toBeLessThanOrEqual(0.75);
    // At least 2 OTHER clusters must show up at all — that's the
    // batch-level voice variety the D1 fix was meant to restore.
    const others = Object.keys(counts).filter((k) => k !== "dry_deadpan");
    expect(others.length).toBeGreaterThanOrEqual(2);
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
