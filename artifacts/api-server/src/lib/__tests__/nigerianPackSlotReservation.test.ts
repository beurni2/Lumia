/**
 * PHASE N1-S2 — Nigerian Pack Slot Reservation tests.
 *
 * Verifies the slot-reservation helper's boundary behaviour:
 *
 *   1. Activation guard short-circuits to identity for every cohort
 *      other than nigeria + pidgin/light_pidgin + flag ON + non-empty
 *      pack (flag OFF, wrong region, wrong languageStyle, empty pack).
 *   2. With ≥2 distinct pack candidates, the composed batch shape is
 *      [pack, nonPack, pack] for desiredCount=3.
 *   3. With exactly 1 pack candidate, the composed batch is
 *      [pack, nonPack, nonPack].
 *   4. With 0 pack candidates in the pool, selectionBatch is returned
 *      unchanged.
 *   5. Per-batch dedup: two pool entries sharing the same
 *      `nigerianPackEntryId` only ever take ONE slot.
 *   6. Per-batch dedup: two pool entries sharing the same normalized
 *      hook only ever take ONE slot.
 *   7. Pack candidates are ranked by `score.total` desc — the higher
 *      scorer wins the reserved slot.
 */

import { describe, it, expect } from "vitest";
import type { Region } from "@workspace/lumina-trends";
import type { LanguageStyle } from "../tasteCalibration";
import type { ScoredCandidate, IdeaScore } from "../ideaScorer";
import { applyNigerianPackSlotReservation } from "../nigerianPackSlotReservation";

function mkScore(total: number): IdeaScore {
  return {
    hookImpact: 0,
    personalFit: 0,
    novelty: 0,
    timeliness: 0,
    captionQuality: 0,
    visualClarity: 0,
    riskScore: 0,
    confidence: 0,
    total,
    lowEffortSetting: false,
    captionSynergy: 0,
    isHero: false,
  } as unknown as IdeaScore;
}

function mkCandidate(opts: {
  hook: string;
  total: number;
  packEntryId?: string;
}): ScoredCandidate {
  return {
    idea: {
      hook: opts.hook,
      whatToShow: "x",
      howToFilm: "x",
      caption: "x",
      script: "x",
    } as unknown as ScoredCandidate["idea"],
    meta: opts.packEntryId
      ? ({ nigerianPackEntryId: opts.packEntryId } as unknown as ScoredCandidate["meta"])
      : ({} as unknown as ScoredCandidate["meta"]),
    score: mkScore(opts.total),
    rewriteAttempted: false,
  };
}

const NG: Region = "nigeria";
const WEST: Region = "western";
const PIDGIN: LanguageStyle = "pidgin";
const LIGHT: LanguageStyle = "light_pidgin";
const CLEAN: LanguageStyle = "clean";

describe("applyNigerianPackSlotReservation", () => {
  it("returns selectionBatch unchanged when flag OFF", () => {
    const a = mkCandidate({ hook: "a", total: 10, packEntryId: "p1" });
    const b = mkCandidate({ hook: "b", total: 9, packEntryId: "p2" });
    const c = mkCandidate({ hook: "c", total: 8 });
    const batch = [c, c, c];
    const out = applyNigerianPackSlotReservation({
      selectionBatch: batch,
      candidatePool: [a, b, c],
      desiredCount: 3,
      region: NG,
      languageStyle: PIDGIN,
      flagEnabled: false,
      packLength: 50,
    });
    expect(out).toBe(batch);
  });

  it("returns selectionBatch unchanged for non-nigeria region", () => {
    const a = mkCandidate({ hook: "a", total: 10, packEntryId: "p1" });
    const c = mkCandidate({ hook: "c", total: 8 });
    const batch = [c, c, c];
    const out = applyNigerianPackSlotReservation({
      selectionBatch: batch,
      candidatePool: [a, c],
      desiredCount: 3,
      region: WEST,
      languageStyle: PIDGIN,
      flagEnabled: true,
      packLength: 50,
    });
    expect(out).toBe(batch);
  });

  it("returns selectionBatch unchanged for nigeria + clean", () => {
    const a = mkCandidate({ hook: "a", total: 10, packEntryId: "p1" });
    const c = mkCandidate({ hook: "c", total: 8 });
    const batch = [c, c, c];
    const out = applyNigerianPackSlotReservation({
      selectionBatch: batch,
      candidatePool: [a, c],
      desiredCount: 3,
      region: NG,
      languageStyle: CLEAN,
      flagEnabled: true,
      packLength: 50,
    });
    expect(out).toBe(batch);
  });

  it("returns selectionBatch unchanged when packLength is 0", () => {
    const a = mkCandidate({ hook: "a", total: 10, packEntryId: "p1" });
    const c = mkCandidate({ hook: "c", total: 8 });
    const batch = [c, c, c];
    const out = applyNigerianPackSlotReservation({
      selectionBatch: batch,
      candidatePool: [a, c],
      desiredCount: 3,
      region: NG,
      languageStyle: PIDGIN,
      flagEnabled: true,
      packLength: 0,
    });
    expect(out).toBe(batch);
  });

  it("composes [pack, pack, nonPack] when 2 pack and ≥1 nonPack available (PHASE N1-FULL-SPEC LIVE — pack-first)", () => {
    // Pre-LIVE behaviour: [p1, nonPack, p2]. LIVE behaviour: pack-
    // first composition fills slots 0+1 with the two pack
    // candidates and falls through to non-pack at slot 2. Cohort
    // gate (NG-pidgin / light_pidgin + flag ON) unchanged.
    const p1 = mkCandidate({ hook: "pack one", total: 10, packEntryId: "p1" });
    const p2 = mkCandidate({ hook: "pack two", total: 9, packEntryId: "p2" });
    const n1 = mkCandidate({ hook: "non one", total: 8 });
    const n2 = mkCandidate({ hook: "non two", total: 7 });
    const out = applyNigerianPackSlotReservation({
      selectionBatch: [n1, n2, p1],
      candidatePool: [p1, p2, n1, n2],
      desiredCount: 3,
      region: NG,
      languageStyle: LIGHT,
      flagEnabled: true,
      packLength: 50,
    });
    expect(out.length).toBe(3);
    expect(out[0]!.meta).toMatchObject({ nigerianPackEntryId: "p1" });
    expect(out[1]!.meta).toMatchObject({ nigerianPackEntryId: "p2" });
    expect((out[2]!.meta as { nigerianPackEntryId?: string }).nigerianPackEntryId).toBeUndefined();
  });

  it("ranks pack candidates by score.total desc — higher scorer wins", () => {
    const lo = mkCandidate({ hook: "lo", total: 5, packEntryId: "lo" });
    const hi = mkCandidate({ hook: "hi", total: 50, packEntryId: "hi" });
    const n1 = mkCandidate({ hook: "non", total: 8 });
    const out = applyNigerianPackSlotReservation({
      selectionBatch: [n1, n1, n1],
      candidatePool: [lo, hi, n1],
      desiredCount: 3,
      region: NG,
      languageStyle: PIDGIN,
      flagEnabled: true,
      packLength: 50,
    });
    // PHASE N1-FULL-SPEC LIVE — pack-first composition: hi (rank 0)
    // lands at slot 0, lo (rank 1) at slot 1, non-pack at slot 2.
    expect(out[0]!.meta).toMatchObject({ nigerianPackEntryId: "hi" });
    expect(out[1]!.meta).toMatchObject({ nigerianPackEntryId: "lo" });
  });

  it("dedups pack candidates by nigerianPackEntryId", () => {
    const dup1 = mkCandidate({ hook: "dup a", total: 10, packEntryId: "same" });
    const dup2 = mkCandidate({ hook: "dup b", total: 9, packEntryId: "same" });
    const n1 = mkCandidate({ hook: "non one", total: 8 });
    const n2 = mkCandidate({ hook: "non two", total: 7 });
    const out = applyNigerianPackSlotReservation({
      selectionBatch: [n1, n2, n1],
      candidatePool: [dup1, dup2, n1, n2],
      desiredCount: 3,
      region: NG,
      languageStyle: PIDGIN,
      flagEnabled: true,
      packLength: 50,
    });
    const packIds = out
      .map((c) => (c.meta as { nigerianPackEntryId?: string }).nigerianPackEntryId)
      .filter((x): x is string => x !== undefined);
    expect(packIds).toEqual(["same"]);
  });

  it("dedups pack candidates by normalized hook", () => {
    const a = mkCandidate({ hook: "Same Hook!", total: 10, packEntryId: "p1" });
    const b = mkCandidate({ hook: "same hook", total: 9, packEntryId: "p2" });
    const n1 = mkCandidate({ hook: "non one", total: 8 });
    const n2 = mkCandidate({ hook: "non two", total: 7 });
    const out = applyNigerianPackSlotReservation({
      selectionBatch: [n1, n2, n1],
      candidatePool: [a, b, n1, n2],
      desiredCount: 3,
      region: NG,
      languageStyle: PIDGIN,
      flagEnabled: true,
      packLength: 50,
    });
    const packIds = out
      .map((c) => (c.meta as { nigerianPackEntryId?: string }).nigerianPackEntryId)
      .filter((x): x is string => x !== undefined);
    expect(packIds).toEqual(["p1"]);
  });

  it("returns selectionBatch unchanged when 0 pack candidates in pool", () => {
    const n1 = mkCandidate({ hook: "non one", total: 8 });
    const n2 = mkCandidate({ hook: "non two", total: 7 });
    const batch = [n1, n2, n1];
    const out = applyNigerianPackSlotReservation({
      selectionBatch: batch,
      candidatePool: [n1, n2],
      desiredCount: 3,
      region: NG,
      languageStyle: PIDGIN,
      flagEnabled: true,
      packLength: 50,
    });
    expect(out).toBe(batch);
  });

  it("with 1 pack candidate composes [pack, nonPack, nonPack]", () => {
    const p = mkCandidate({ hook: "only pack", total: 10, packEntryId: "p1" });
    const n1 = mkCandidate({ hook: "non one", total: 8 });
    const n2 = mkCandidate({ hook: "non two", total: 7 });
    const out = applyNigerianPackSlotReservation({
      selectionBatch: [n1, n2, n1],
      candidatePool: [p, n1, n2],
      desiredCount: 3,
      region: NG,
      languageStyle: PIDGIN,
      flagEnabled: true,
      packLength: 50,
    });
    expect(out.length).toBe(3);
    expect(out[0]!.meta).toMatchObject({ nigerianPackEntryId: "p1" });
    expect((out[1]!.meta as { nigerianPackEntryId?: string }).nigerianPackEntryId).toBeUndefined();
    expect((out[2]!.meta as { nigerianPackEntryId?: string }).nigerianPackEntryId).toBeUndefined();
  });

  describe("excludeEntryIds — per-creator memory (N1-FULL-SPEC)", () => {
    it("filters excluded pack entries from primary composition path", () => {
      const p1 = mkCandidate({ hook: "p1", total: 10, packEntryId: "p1" });
      const p2 = mkCandidate({ hook: "p2", total: 9, packEntryId: "p2" });
      const n1 = mkCandidate({ hook: "non one", total: 7 });
      const out = applyNigerianPackSlotReservation({
        selectionBatch: [p1, n1, p2],
        candidatePool: [p1, p2, n1],
        desiredCount: 3,
        region: NG,
        languageStyle: PIDGIN,
        flagEnabled: true,
        packLength: 50,
        excludeEntryIds: new Set(["p1"]),
      });
      const ids = out.map(
        (c) => (c.meta as { nigerianPackEntryId?: string }).nigerianPackEntryId,
      );
      expect(ids).not.toContain("p1");
    });

    it("strips excluded pack entries when no eligible pack survives (fallback path)", () => {
      // p1 is the only pack candidate AND it is excluded — dedupedPack
      // becomes empty, so the fallback returns selectionBatch. Pre-fix
      // this would re-ship p1 (it's in selectionBatch from upstream).
      // Post-fix: p1 must be stripped.
      const p1 = mkCandidate({ hook: "p1", total: 10, packEntryId: "p1" });
      const n1 = mkCandidate({ hook: "non one", total: 7 });
      const n2 = mkCandidate({ hook: "non two", total: 6 });
      const out = applyNigerianPackSlotReservation({
        selectionBatch: [p1, n1, n2],
        candidatePool: [p1, n1, n2],
        desiredCount: 3,
        region: NG,
        languageStyle: PIDGIN,
        flagEnabled: true,
        packLength: 50,
        excludeEntryIds: new Set(["p1"]),
      });
      const ids = out.map(
        (c) => (c.meta as { nigerianPackEntryId?: string }).nigerianPackEntryId,
      );
      expect(ids).not.toContain("p1");
      expect(out.length).toBe(2);
    });

    it("undefined excludeEntryIds is byte-identical to baseline (no-op)", () => {
      const p1 = mkCandidate({ hook: "p1", total: 10, packEntryId: "p1" });
      const n1 = mkCandidate({ hook: "non one", total: 7 });
      const batch = [p1, n1, n1];
      const baseline = applyNigerianPackSlotReservation({
        selectionBatch: batch,
        candidatePool: [p1, n1],
        desiredCount: 3,
        region: NG,
        languageStyle: PIDGIN,
        flagEnabled: true,
        packLength: 50,
      });
      const withUndef = applyNigerianPackSlotReservation({
        selectionBatch: batch,
        candidatePool: [p1, n1],
        desiredCount: 3,
        region: NG,
        languageStyle: PIDGIN,
        flagEnabled: true,
        packLength: 50,
        excludeEntryIds: undefined,
      });
      const withEmpty = applyNigerianPackSlotReservation({
        selectionBatch: batch,
        candidatePool: [p1, n1],
        desiredCount: 3,
        region: NG,
        languageStyle: PIDGIN,
        flagEnabled: true,
        packLength: 50,
        excludeEntryIds: new Set(),
      });
      expect(withUndef).toEqual(baseline);
      expect(withEmpty).toEqual(baseline);
    });
  });

  it("ships up to desiredCount pack hooks when pool allows (PHASE N1-FULL-SPEC LIVE — cap lifted from 2 to desiredCount)", () => {
    // Pre-LIVE behaviour capped reserved pack at literal `2` so
    // `packCount === 2`. LIVE behaviour caps at `desiredCount` so
    // `packCount === 3` when 3+ distinct pack candidates survive
    // dedup. Cohort gate at the top of the function (NG-pidgin /
    // light_pidgin + flag ON + non-empty pack) unchanged — non-NG
    // and flag-OFF cohorts never enter this code path.
    const p1 = mkCandidate({ hook: "p1", total: 10, packEntryId: "p1" });
    const p2 = mkCandidate({ hook: "p2", total: 9, packEntryId: "p2" });
    const p3 = mkCandidate({ hook: "p3", total: 8, packEntryId: "p3" });
    const n1 = mkCandidate({ hook: "non one", total: 7 });
    const out = applyNigerianPackSlotReservation({
      selectionBatch: [n1, n1, n1],
      candidatePool: [p1, p2, p3, n1],
      desiredCount: 3,
      region: NG,
      languageStyle: PIDGIN,
      flagEnabled: true,
      packLength: 50,
    });
    const packCount = out.filter(
      (c) => (c.meta as { nigerianPackEntryId?: string }).nigerianPackEntryId !== undefined,
    ).length;
    expect(packCount).toBe(3);
    expect(out[0]!.meta).toMatchObject({ nigerianPackEntryId: "p1" });
    expect(out[1]!.meta).toMatchObject({ nigerianPackEntryId: "p2" });
    expect(out[2]!.meta).toMatchObject({ nigerianPackEntryId: "p3" });
  });
});
