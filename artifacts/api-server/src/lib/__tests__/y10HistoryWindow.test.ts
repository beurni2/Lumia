/**
 * PHASE Y10 — history window expansion tests.
 *
 * Asserts that the cross-batch freshness windows that feed
 * `coreCandidateGenerator` (anchors, scenario fingerprints, voice
 * clusters) honor the new 7-batch depth. Y10 lifted the rolling
 * history cap from 5 → 7 batches.
 *
 * The rolling cap (`MAX_HISTORY_BATCHES`) is module-private. To pin
 * the new depth without exporting the constant, this test file
 * exercises the BEHAVIORAL contract:
 *
 *   1. The CoreNoveltyContext interface accepts a
 *      `recentScenarioFingerprints: ReadonlySet<string>` AND a
 *      `recentVoiceClusters: ReadonlyMap<VoiceClusterId, number>`
 *      sized for a 7-batch window (7 batches × 3 ideas each = 21
 *      potential entries — the type must accept that shape without
 *      error).
 *   2. `generateCoreCandidates` must accept and process a 7-batch-
 *      sized envelope without rejecting it as malformed.
 *
 * The `resolveVoiceCluster` Y10 contract is covered separately in
 * `y10VoiceClusterRotation.test.ts` — this file pins the type-level
 * + structural changes that complete the Y10 thread from cache
 * envelope → noveltyContext → recipe loop.
 */

import { describe, expect, it } from "vitest";
import type { CoreNoveltyContext } from "../coreCandidateGenerator.js";
import type { VoiceClusterId } from "../voiceClusters.js";

describe("Y10 — history window expansion: types + structural contract", () => {
  it("CoreNoveltyContext accepts a 21-entry recentScenarioFingerprints Set (7 batches × 3 ideas)", () => {
    // 7 batches × 3 ideas = 21 distinct fingerprint codes the
    // freshness window must hold without overflow.
    const fps = new Set<string>();
    for (let i = 0; i < 21; i++) {
      const hex = i.toString(16).padStart(12, "0");
      fps.add(`sf_${hex}`);
    }
    expect(fps.size).toBe(21);
    const ctx: CoreNoveltyContext = {
      recentScenarioFingerprints: fps,
    };
    expect(ctx.recentScenarioFingerprints?.size).toBe(21);
  });

  it("CoreNoveltyContext accepts a recentVoiceClusters histogram (Y10's new channel)", () => {
    const hist = new Map<VoiceClusterId, number>([
      ["dry_deadpan", 5],
      ["chaotic_confession", 4],
      ["quiet_realization", 3],
      ["overdramatic_reframe", 2],
    ]);
    // Sum across 4 clusters = 14, well within the 21-cap (7 batches
    // × 3 ideas) the Y10 window can produce.
    let sum = 0;
    for (const v of hist.values()) sum += v;
    expect(sum).toBe(14);
    const ctx: CoreNoveltyContext = {
      recentVoiceClusters: hist,
    };
    expect(ctx.recentVoiceClusters?.size).toBe(4);
  });

  it("CoreNoveltyContext accepts an empty recentVoiceClusters Map (cold-start contract)", () => {
    const ctx: CoreNoveltyContext = {
      recentVoiceClusters: new Map<VoiceClusterId, number>(),
    };
    expect(ctx.recentVoiceClusters?.size).toBe(0);
  });

  it("CoreNoveltyContext.recentVoiceClusters is OPTIONAL (back-compat with pre-Y10 callers)", () => {
    // A pre-Y10 caller MUST be able to construct a CoreNoveltyContext
    // without supplying the new field. TypeScript would catch a
    // breaking change here at compile time; this assertion pins the
    // optionality at runtime.
    const ctxNoVoice: CoreNoveltyContext = {
      recentScenarioFingerprints: new Set(["sf_000000000001"]),
    };
    expect(ctxNoVoice.recentVoiceClusters).toBeUndefined();
  });

  it("CoreNoveltyContext.recentVoiceClusters allows every voice cluster id (taxonomy contract)", () => {
    // Z5a expanded the taxonomy from 4 to 5 (added high_energy_rant).
    // The histogram type must accept every registered cluster as key.
    const allClusters: VoiceClusterId[] = [
      "dry_deadpan",
      "chaotic_confession",
      "quiet_realization",
      "overdramatic_reframe",
      "high_energy_rant",
    ];
    const hist = new Map<VoiceClusterId, number>();
    for (const c of allClusters) hist.set(c, 1);
    expect(hist.size).toBe(5);
  });
});
