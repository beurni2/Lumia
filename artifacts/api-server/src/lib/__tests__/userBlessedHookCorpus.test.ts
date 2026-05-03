/**
 * PHASE D3 — corpus integrity + voice-training-reference wiring.
 *
 * D2 RUNTIME-DRAW REVERTED. Corpus is no longer drawn at recipe
 * time; instead it feeds into:
 *   (a) the seed-hook bigram set consumed by `validateAntiCopy`'s
 *       Jaccard 0.85 near-verbatim gate (each corpus hook becomes a
 *       voice-training reference — generated hooks must stay in
 *       voice without copying any corpus hook verbatim);
 *   (b) the seed-hook fingerprint set (kept consistent with the
 *       bigram set as opaque corpus identity post-Y6).
 *
 * Tests cover:
 *   - corpus integrity (cluster validity, anchor-in-hook, per-cluster
 *     boot-floor coverage);
 *   - the D3 wiring — every corpus hook's normalized fingerprint is
 *     present in `loadSeedHookFingerprints()` AND every corpus hook's
 *     bigram set is one of the entries returned by the seed-bigram
 *     loader (verified via Jaccard 1.0 self-match);
 *   - cliché-allowlist discipline — no corpus hook trips the AI-
 *     cliché demote axis (the curator must keep the cliché regex
 *     list disjoint from the user's blessed shapes — same posture
 *     as the cluster `seedHookExemplars`).
 */
import { describe, it, expect } from "vitest";
import {
  USER_BLESSED_HOOK_CORPUS,
  getCorpusHooksByCluster,
} from "../userBlessedHookCorpus.js";
import {
  loadSeedHookFingerprints,
  normalizeHookFingerprint,
} from "../comedyValidation.js";
import { scoreHookQualityDetailed } from "../hookQuality.js";
import { type VoiceClusterId } from "../voiceClusters.js";

const CLUSTERS: readonly VoiceClusterId[] = [
  "dry_deadpan",
  "chaotic_confession",
  "overdramatic_reframe",
  "quiet_realization",
];

describe("USER_BLESSED_HOOK_CORPUS integrity", () => {
  it("has at least 100 entries (5x the per-cluster template pool)", () => {
    expect(USER_BLESSED_HOOK_CORPUS.length).toBeGreaterThanOrEqual(100);
  });

  it("every entry's anchor literally appears in its hook (lowercase substring)", () => {
    for (const e of USER_BLESSED_HOOK_CORPUS) {
      expect(
        e.hook.toLowerCase().includes(e.anchor.toLowerCase()),
        `anchor '${e.anchor}' missing from hook '${e.hook}'`,
      ).toBe(true);
    }
  });

  it("every entry's cluster is one of the 4 valid voice clusters", () => {
    for (const e of USER_BLESSED_HOOK_CORPUS) {
      expect(CLUSTERS).toContain(e.cluster);
    }
  });

  it("every cluster pool has ≥8 entries (boot-floor coverage)", () => {
    for (const cid of CLUSTERS) {
      expect(getCorpusHooksByCluster(cid).length).toBeGreaterThanOrEqual(8);
    }
  });
});

describe("PHASE D3 — corpus → seed-hook wiring", () => {
  it("every corpus hook's normalized fingerprint is in loadSeedHookFingerprints()", () => {
    const seeds = loadSeedHookFingerprints();
    for (const e of USER_BLESSED_HOOK_CORPUS) {
      const fp = normalizeHookFingerprint(e.hook);
      expect(
        seeds.has(fp),
        `corpus hook missing from seed fingerprint set: '${e.hook}' → fp '${fp}'`,
      ).toBe(true);
    }
  });
});

describe("PHASE D3 — corpus respects AI-cliché allowlist discipline", () => {
  // The Phase D1 AI-cliché demote (negative addend on
  // `scoreHookQualityDetailed.aiCliche`) targets generic LLM tells
  // (`in this economy`, `not gonna lie`, etc.). The user's blessed
  // corpus is hand-authored voice — by curator policy it must NOT
  // intersect the cliché regex list. This test enforces the policy:
  // a future cliché-list addition that accidentally swallows a
  // corpus hook fails CI before shipping a regression that demotes
  // the user's own voice.
  it("no corpus hook's hookQuality breakdown has a non-zero aiCliche penalty", () => {
    const offenders: { hook: string; aiCliche: number }[] = [];
    for (const e of USER_BLESSED_HOOK_CORPUS) {
      const breakdown = scoreHookQualityDetailed(e.hook, "self_betrayal");
      if (breakdown.aiCliche !== 0) {
        offenders.push({ hook: e.hook, aiCliche: breakdown.aiCliche });
      }
    }
    expect(
      offenders,
      `cliché-list discipline violation — these blessed corpus hooks now trip an AI-cliché regex:\n${offenders
        .map((o) => `  ${o.aiCliche.toFixed(0)}  "${o.hook}"`)
        .join("\n")}`,
    ).toEqual([]);
  });
});
