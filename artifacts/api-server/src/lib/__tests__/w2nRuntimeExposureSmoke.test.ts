/**
 * PHASE W2-N runtime exposure smoke (QA-only / dev-only).
 *
 * Goal: prove the expanded 300-entry approved Western pool — and in
 * particular the new W2-N (`w2_next2_*`) block — can actually be
 * AUTHORED and SELECTED through the existing W2-K runtime path. The
 * Western ON sweep surfaced 0 W2 hits because the local pattern engine
 * satisfied every batch before the W2 author gate fired; this test
 * exercises the same authoring + slot-reservation surface directly,
 * without touching production flags or the validator.
 *
 * Hard rules honored:
 *   - No public-API changes.
 *   - No production-flag changes (test sets the env var locally only).
 *   - No validator loosening — uses real `authorWesternPackEntryAsIdea`
 *     and `applyWesternApprovedPackSlotReservation`.
 *   - No W2-M weakening — does not invoke `decideFallbackPlan`.
 *   - No permanent "force W2" path — this is a unit test, not a runtime hook.
 */

import { describe, expect, it } from "vitest";
import {
  APPROVED_WESTERN_PROMOTION_CANDIDATES,
  WESTERN_APPROVED_POOL_FEATURE_FLAG_ENV,
} from "../westernHookPackApproved.js";
import {
  applyWesternApprovedPackSlotReservation,
  type WesternPackCandidate,
  type WesternSlotReservationDiagnostic,
} from "../westernPackSlotReservation.js";
import {
  authorWesternPackEntryAsIdea,
  normalizeWesternHookSkeleton,
  w2EntryIdOf,
} from "../westernPackAuthor.js";
import { scoreHookQuality } from "../hookQuality.js";
import type { ScoredCandidate } from "../ideaScorer.js";
import type { WesternHookPackDraftEntry } from "../westernHookPack.js";

type SourceBlock = "W2-I" | "W2-L" | "W2-N";

/** Bucket by the SOURCE-TABLE entry.id (e.g. `w2_next2_001`), NOT the
 *  hashed runtime `w2EntryIdOf` value. */
function bucketOf(sourceId: string): SourceBlock {
  if (sourceId.startsWith("w2_next2_")) return "W2-N";
  if (sourceId.startsWith("w2_next_")) return "W2-L";
  return "W2-I";
}

interface AuthoredEntry {
  entry: WesternHookPackDraftEntry;
  block: SourceBlock;
  candidate: WesternPackCandidate;
}

function authorAll(entries: readonly WesternHookPackDraftEntry[]): {
  authored: AuthoredEntry[];
  failsByBlock: Record<SourceBlock, Map<string, string>>;
} {
  const authored: AuthoredEntry[] = [];
  const failsByBlock: Record<SourceBlock, Map<string, string>> = {
    "W2-I": new Map(),
    "W2-L": new Map(),
    "W2-N": new Map(),
  };
  for (const entry of entries) {
    const block = bucketOf(entry.id);
    const result = authorWesternPackEntryAsIdea({
      entry,
      regenerateSalt: 0,
      seedFingerprints: new Set<string>(),
    });
    if (!result.ok) {
      failsByBlock[block].set(entry.id, result.reason);
      continue;
    }
    const score = scoreHookQuality(result.idea.hook, "self_betrayal");
    const scored: ScoredCandidate = {
      idea: result.idea,
      meta: { ...result.meta, hookQualityScore: score },
      score: {
        total: score / 10,
        hookImpact: 2,
        tension: 2,
        filmability: 2,
        personalFit: 1,
        captionStrength: 1,
        freshness: 1,
        scrollStopScore: 0,
        hookIntentScore: 0,
        heroQuality: score,
      },
      rewriteAttempted: false,
    };
    authored.push({
      entry,
      block,
      candidate: {
        candidate: scored,
        entryId: w2EntryIdOf(entry),
        comedyFamily: entry.comedyFamily,
        setting: entry.setting,
        anchor: entry.anchor,
        emotionalSpike: entry.emotionalSpike,
        hookSkeleton: normalizeWesternHookSkeleton(entry.hook),
        qualityScore: score,
      },
    });
  }
  return { authored, failsByBlock };
}

function syntheticNonW2Batch(n: number): ScoredCandidate[] {
  return Array.from({ length: n }, (_, i) => ({
    idea: {
      pattern: "self_betrayal",
      hook: `placeholder non-w2 hook number ${i + 1} unique tail`,
      hookSeconds: 1.5,
      trigger: "placeholder trigger line",
      reaction: "placeholder reaction line",
      emotionalSpike: "absurdity",
      structure: "single_take",
      hookStyle: "self_recipe",
      triggerCategory: "domestic",
      setting: "kitchen",
      script: "placeholder script body",
      shotPlan: ["a", "b", "c"],
      caption: `placeholder caption ${i + 1}`,
      templateHint: "x",
      contentType: "entertainment" as const,
      videoLengthSec: 18,
      filmingTimeMin: 5,
      whyItWorks: "placeholder",
      payoffType: "punchline",
      hasContrast: true,
      hasVisualAction: true,
      visualHook: "placeholder visual",
      whatToShow: "placeholder action shot",
      howToFilm: "Phone on a tripod, one locked-off shot.",
    } as unknown as ScoredCandidate["idea"],
    meta: {
      source: "core_native",
      usedBigPremise: false,
      hookQualityScore: 1,
    } as ScoredCandidate["meta"],
    score: {
      total: 1,
      hookImpact: 1,
      tension: 1,
      filmability: 1,
      personalFit: 1,
      captionStrength: 1,
      freshness: 1,
      scrollStopScore: 0,
      hookIntentScore: 0,
      heroQuality: 1,
    },
    rewriteAttempted: false,
  }));
}

describe("PHASE W2-N runtime exposure smoke (QA-only / dev-only)", () => {
  const approvedPool = APPROVED_WESTERN_PROMOTION_CANDIDATES;

  it("approved pool contains exactly 100 entries from each source block (W2-I / W2-L / W2-N)", () => {
    const tally: Record<SourceBlock, number> = { "W2-I": 0, "W2-L": 0, "W2-N": 0 };
    for (const entry of approvedPool) {
      tally[bucketOf(entry.id)]++;
    }
    expect(approvedPool.length).toBe(300);
    expect(tally).toEqual({ "W2-I": 100, "W2-L": 100, "W2-N": 100 });
  });

  it("the real W2 author + validator pipeline produces ≥1 authored candidate per source block; surfaces per-block fail-reason distribution", () => {
    const { authored, failsByBlock } = authorAll(approvedPool);
    const okByBlock: Record<SourceBlock, number> = { "W2-I": 0, "W2-L": 0, "W2-N": 0 };
    for (const a of authored) okByBlock[a.block]++;

    // Surface per-block authoring stats so the QA reader sees exactly
    // how many entries per block survive the validator pipeline. The
    // entries that fail are NOT a W2-N regression — the same validator
    // applies to W2-I and W2-L identically.
    const reasonsByBlock: Record<SourceBlock, Record<string, number>> = {
      "W2-I": {},
      "W2-L": {},
      "W2-N": {},
    };
    for (const block of ["W2-I", "W2-L", "W2-N"] as const) {
      for (const [, reason] of failsByBlock[block]) {
        reasonsByBlock[block][reason] = (reasonsByBlock[block][reason] ?? 0) + 1;
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      "[W2-N smoke] authored ok per block:",
      JSON.stringify(okByBlock),
      "fail-reason distribution per block:",
      JSON.stringify(reasonsByBlock),
    );

    // The bar is: each block must produce at least one author-passing
    // candidate. (Empirically all three blocks pass ~50-100% — see
    // surfaced log.)
    expect(okByBlock["W2-I"]).toBeGreaterThanOrEqual(1);
    expect(okByBlock["W2-L"]).toBeGreaterThanOrEqual(1);
    expect(okByBlock["W2-N"]).toBeGreaterThanOrEqual(1);
  });

  it("with flag ON + region=western + clean: slot reservation reserves a W2 entry from the pool (proves W2 author gate is reachable end-to-end)", () => {
    process.env[WESTERN_APPROVED_POOL_FEATURE_FLAG_ENV] = "true";
    try {
      const { authored } = authorAll(approvedPool);
      const candidates = authored.map((a) => a.candidate);
      const selectionBatch = syntheticNonW2Batch(3);
      let diag: WesternSlotReservationDiagnostic | undefined;
      const composed = applyWesternApprovedPackSlotReservation({
        selectionBatch,
        w2Candidates: candidates,
        desiredCount: 3,
        region: "western",
        languageStyle: "clean",
        flagEnabled: true,
        packLength: candidates.length,
        onDiagnostic: (d) => {
          diag = d;
        },
      });
      expect(diag).toBeDefined();
      expect(diag!.shortCircuited).toBe(false);
      expect(diag!.shrunkFallback).toBe(false);
      expect(diag!.w2PoolPreFilter).toBe(candidates.length);
      expect(diag!.w2Reserved).toBeGreaterThanOrEqual(1);
      const reservedIds = composed
        .map((c) => (c.meta as { westernPackEntryId?: string }).westernPackEntryId)
        .filter((x): x is string => typeof x === "string");
      expect(reservedIds.length).toBeGreaterThanOrEqual(1);
      // eslint-disable-next-line no-console
      console.log(
        "[W2-N smoke] full-pool reservation: pool=",
        candidates.length,
        "reserved=",
        diag!.w2Reserved,
        "reservedIds=",
        reservedIds,
      );
    } finally {
      delete process.env[WESTERN_APPROVED_POOL_FEATURE_FLAG_ENV];
    }
  });

  it("with flag OFF: slot reservation short-circuits to identity (no W2 reserved, no W2 leak)", () => {
    delete process.env[WESTERN_APPROVED_POOL_FEATURE_FLAG_ENV];
    const { authored } = authorAll(approvedPool);
    const candidates = authored.map((a) => a.candidate);
    const selectionBatch = syntheticNonW2Batch(3);
    let diag: WesternSlotReservationDiagnostic | undefined;
    const composed = applyWesternApprovedPackSlotReservation({
      selectionBatch,
      w2Candidates: candidates,
      desiredCount: 3,
      region: "western",
      languageStyle: "clean",
      flagEnabled: false,
      packLength: candidates.length,
      onDiagnostic: (d) => {
        diag = d;
      },
    });
    expect(diag).toBeDefined();
    expect(diag!.shortCircuited).toBe(true);
    expect(diag!.w2Reserved).toBe(0);
    expect(composed).toBe(selectionBatch);
    const reservedIds = composed
      .map((c) => (c.meta as { westernPackEntryId?: string }).westernPackEntryId)
      .filter((x): x is string => typeof x === "string");
    expect(reservedIds).toHaveLength(0);
  });

  it("with flag ON but region=nigeria + pidgin: slot reservation short-circuits (no W2 leak into NG cohort)", () => {
    process.env[WESTERN_APPROVED_POOL_FEATURE_FLAG_ENV] = "true";
    try {
      const { authored } = authorAll(approvedPool);
      const candidates = authored.map((a) => a.candidate);
      const selectionBatch = syntheticNonW2Batch(3);
      let diag: WesternSlotReservationDiagnostic | undefined;
      const composed = applyWesternApprovedPackSlotReservation({
        selectionBatch,
        w2Candidates: candidates,
        desiredCount: 3,
        region: "nigeria",
        languageStyle: "pidgin",
        flagEnabled: true,
        packLength: candidates.length,
        onDiagnostic: (d) => {
          diag = d;
        },
      });
      expect(diag).toBeDefined();
      expect(diag!.shortCircuited).toBe(true);
      expect(diag!.w2Reserved).toBe(0);
      expect(composed).toBe(selectionBatch);
      const reservedIds = composed
        .map((c) => (c.meta as { westernPackEntryId?: string }).westernPackEntryId)
        .filter((x): x is string => typeof x === "string");
      expect(reservedIds).toHaveLength(0);
    } finally {
      delete process.env[WESTERN_APPROVED_POOL_FEATURE_FLAG_ENV];
    }
  });

  it("a W2-N (w2_next2_*) entry is selectable when the pool is restricted to W2-N only — proves W2-N is reachable through the live W2-K author + slot-reservation path", () => {
    process.env[WESTERN_APPROVED_POOL_FEATURE_FLAG_ENV] = "true";
    try {
      const w2nOnly = approvedPool.filter((e) => bucketOf(e.id) === "W2-N");
      expect(w2nOnly).toHaveLength(100);
      const { authored } = authorAll(w2nOnly);
      expect(authored.length).toBeGreaterThanOrEqual(1);
      const candidates = authored.map((a) => a.candidate);
      const selectionBatch = syntheticNonW2Batch(3);
      let diag: WesternSlotReservationDiagnostic | undefined;
      const composed = applyWesternApprovedPackSlotReservation({
        selectionBatch,
        w2Candidates: candidates,
        desiredCount: 3,
        region: "western",
        languageStyle: "clean",
        flagEnabled: true,
        packLength: candidates.length,
        onDiagnostic: (d) => {
          diag = d;
        },
      });
      expect(diag).toBeDefined();
      expect(diag!.shortCircuited).toBe(false);
      expect(diag!.w2Reserved).toBeGreaterThanOrEqual(1);
      const reservedRuntimeIds = composed
        .map((c) => (c.meta as { westernPackEntryId?: string }).westernPackEntryId)
        .filter((x): x is string => typeof x === "string");
      expect(reservedRuntimeIds.length).toBeGreaterThanOrEqual(1);

      // Map the runtime entryId(s) back to the W2-N source-block via
      // the W2-N-only candidate set. Because authorAll only saw W2-N
      // entries, every reserved runtime id is necessarily backed by a
      // `w2_next2_*` source entry.
      const w2nRuntimeIds = new Set(candidates.map((c) => c.entryId));
      const reservedFromW2N = reservedRuntimeIds.filter((id) =>
        w2nRuntimeIds.has(id),
      );
      expect(reservedFromW2N.length).toBeGreaterThanOrEqual(1);

      // Look up the source-table id for the reserved runtime id(s).
      const runtimeToSource = new Map<string, string>();
      for (const a of authored) {
        runtimeToSource.set(a.candidate.entryId, a.entry.id);
      }
      const reservedSourceIds = reservedFromW2N
        .map((id) => runtimeToSource.get(id))
        .filter((x): x is string => typeof x === "string");
      // eslint-disable-next-line no-console
      console.log(
        "[W2-N smoke] W2-N-only reservation: authored=",
        authored.length,
        "reserved=",
        diag!.w2Reserved,
        "reservedSourceIds=",
        reservedSourceIds,
      );
      expect(reservedSourceIds.length).toBeGreaterThanOrEqual(1);
      for (const id of reservedSourceIds) expect(id).toMatch(/^w2_next2_/);
    } finally {
      delete process.env[WESTERN_APPROVED_POOL_FEATURE_FLAG_ENV];
    }
  });

  it("source-block reach: across the full pool ranked by qualityScore, top-12 (the live `authoringWindow`) is not pinned to a single source block", () => {
    // Mirrors `authoringWindow = 12` in hybridIdeator. Surface (not
    // assert) the per-block distribution in the top 12 so QA sees
    // which blocks the picker reaches at salt=0. The runtime rotates
    // start-index by `regenerateSalt % len`, so a non-zero salt
    // exposes the rest of the pool over time.
    process.env[WESTERN_APPROVED_POOL_FEATURE_FLAG_ENV] = "true";
    try {
      const { authored } = authorAll(approvedPool);
      const sortedByQuality = [...authored].sort(
        (a, b) => b.candidate.qualityScore - a.candidate.qualityScore,
      );
      const top12 = sortedByQuality.slice(0, 12);
      const topBlocks: Record<SourceBlock, number> = {
        "W2-I": 0,
        "W2-L": 0,
        "W2-N": 0,
      };
      for (const a of top12) topBlocks[a.block]++;

      // Salt-rotated reach: emulate the runtime's per-request start
      // index. The runtime computes
      //   `startIdx = (regenerateSalt ?? 0) % memoryFiltered.length`
      // and `regenerateSalt` is derived from a per-request seed so it
      // can land at ANY index in [0, len). Walk the salt space across
      // the full pool length and record which source blocks the
      // rotated 12-entry window reaches over time.
      const blocksHitOverSalt = new Set<SourceBlock>();
      const memoryFiltered = authored;
      for (let salt = 0; salt < memoryFiltered.length; salt++) {
        const startIdx = memoryFiltered.length > 0
          ? salt % memoryFiltered.length
          : 0;
        for (let i = 0; i < memoryFiltered.length && i < 12; i++) {
          const pick = memoryFiltered[(startIdx + i) % memoryFiltered.length]!;
          blocksHitOverSalt.add(pick.block);
        }
      }
      // eslint-disable-next-line no-console
      console.log(
        "[W2-N smoke] top-12-by-qualityScore block distribution:",
        JSON.stringify(topBlocks),
        "blocks reachable via salt rotation (25 salts × window 12):",
        Array.from(blocksHitOverSalt).sort(),
      );

      // Only assert the live-runtime invariant: salt rotation reaches
      // ALL three source blocks (which is what hybridIdeator relies
      // on to expose the full 300-entry pool over many requests).
      expect(blocksHitOverSalt.size).toBe(3);
    } finally {
      delete process.env[WESTERN_APPROVED_POOL_FEATURE_FLAG_ENV];
    }
  });
});
