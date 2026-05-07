/**
 * PHASE N1-LIVE-HARDEN F3 — Slot reservation diagnostic emission tests.
 *
 * Verifies the optional `onDiagnostic` callback added in F3:
 *   1. NOT invoked when activation guard short-circuits (flag OFF /
 *      wrong region / wrong languageStyle / empty pack).
 *   2. Invoked once with `earlyReturnEmptyPack=true` when no pack
 *      candidates survive memory + dedup filters.
 *   3. Invoked once with `earlyReturnEmptyPack=false` when composition
 *      ships at least the upstream batch size.
 *   4. Per-stage counts (preFilter / postMemoryFilter / postBatchDedup)
 *      reflect the filter cascade correctly.
 */

import { describe, it, expect } from "vitest";
import type { Region } from "@workspace/lumina-trends";
import type { LanguageStyle } from "../tasteCalibration";
import type { ScoredCandidate, IdeaScore } from "../ideaScorer";
import {
  applyNigerianPackSlotReservation,
  type SlotReservationDiagnostic,
} from "../nigerianPackSlotReservation";

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
const CLEAN: LanguageStyle = "clean";

describe("applyNigerianPackSlotReservation — F3 diagnostic emission", () => {
  it("does NOT invoke onDiagnostic when flag OFF (activation short-circuit)", () => {
    const events: SlotReservationDiagnostic[] = [];
    const a = mkCandidate({ hook: "a", total: 10, packEntryId: "p1" });
    const b = mkCandidate({ hook: "b", total: 9 });
    applyNigerianPackSlotReservation({
      selectionBatch: [b, b, b],
      candidatePool: [a, b],
      desiredCount: 3,
      region: NG,
      languageStyle: PIDGIN,
      flagEnabled: false,
      packLength: 100,
      onDiagnostic: (d) => events.push(d),
    });
    expect(events).toHaveLength(0);
  });

  it("does NOT invoke onDiagnostic for non-NG region (activation short-circuit)", () => {
    const events: SlotReservationDiagnostic[] = [];
    const a = mkCandidate({ hook: "a", total: 10, packEntryId: "p1" });
    const b = mkCandidate({ hook: "b", total: 9 });
    applyNigerianPackSlotReservation({
      selectionBatch: [b, b, b],
      candidatePool: [a, b],
      desiredCount: 3,
      region: WEST,
      languageStyle: PIDGIN,
      flagEnabled: true,
      packLength: 100,
      onDiagnostic: (d) => events.push(d),
    });
    expect(events).toHaveLength(0);
  });

  it("does NOT invoke onDiagnostic for ng_clean (activation short-circuit)", () => {
    const events: SlotReservationDiagnostic[] = [];
    const a = mkCandidate({ hook: "a", total: 10, packEntryId: "p1" });
    const b = mkCandidate({ hook: "b", total: 9 });
    applyNigerianPackSlotReservation({
      selectionBatch: [b, b, b],
      candidatePool: [a, b],
      desiredCount: 3,
      region: NG,
      languageStyle: CLEAN,
      flagEnabled: true,
      packLength: 100,
      onDiagnostic: (d) => events.push(d),
    });
    expect(events).toHaveLength(0);
  });

  it("emits earlyReturnEmptyPack=true when no pack candidates in pool", () => {
    const events: SlotReservationDiagnostic[] = [];
    const x = mkCandidate({ hook: "x", total: 5 });
    const y = mkCandidate({ hook: "y", total: 4 });
    const z = mkCandidate({ hook: "z", total: 3 });
    applyNigerianPackSlotReservation({
      selectionBatch: [x, y, z],
      candidatePool: [x, y, z],
      desiredCount: 3,
      region: NG,
      languageStyle: PIDGIN,
      flagEnabled: true,
      packLength: 100,
      onDiagnostic: (d) => events.push(d),
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      packPoolPreFilter: 0,
      packPoolPostMemoryFilter: 0,
      packPoolPostBatchDedup: 0,
      earlyReturnEmptyPack: true,
    });
  });

  it("emits earlyReturnEmptyPack=true when memory filter strips all pack candidates", () => {
    const events: SlotReservationDiagnostic[] = [];
    const p1 = mkCandidate({ hook: "h1", total: 10, packEntryId: "p1" });
    const p2 = mkCandidate({ hook: "h2", total: 9, packEntryId: "p2" });
    const np = mkCandidate({ hook: "np", total: 5 });
    applyNigerianPackSlotReservation({
      selectionBatch: [np, np, np],
      candidatePool: [p1, p2, np],
      desiredCount: 3,
      region: NG,
      languageStyle: PIDGIN,
      flagEnabled: true,
      packLength: 100,
      excludeEntryIds: new Set(["p1", "p2"]),
      onDiagnostic: (d) => events.push(d),
    });
    expect(events).toHaveLength(1);
    expect(events[0].packPoolPreFilter).toBe(2);
    expect(events[0].packPoolPostMemoryFilter).toBe(0);
    expect(events[0].packPoolPostBatchDedup).toBe(0);
    expect(events[0].earlyReturnEmptyPack).toBe(true);
  });

  it("emits earlyReturnEmptyPack=false on successful composition with correct cascade counts", () => {
    const events: SlotReservationDiagnostic[] = [];
    const p1 = mkCandidate({ hook: "h1", total: 10, packEntryId: "p1" });
    const p2 = mkCandidate({ hook: "h2", total: 9, packEntryId: "p2" });
    const p3 = mkCandidate({ hook: "h3", total: 8, packEntryId: "p3" });
    const np = mkCandidate({ hook: "np", total: 5 });
    const out = applyNigerianPackSlotReservation({
      selectionBatch: [p1, np, p2],
      candidatePool: [p1, p2, p3, np],
      desiredCount: 3,
      region: NG,
      languageStyle: PIDGIN,
      flagEnabled: true,
      packLength: 100,
      onDiagnostic: (d) => events.push(d),
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      packPoolPreFilter: 3,
      packPoolPostMemoryFilter: 3,
      packPoolPostBatchDedup: 3,
      earlyReturnEmptyPack: false,
    });
    expect(out.length).toBeGreaterThanOrEqual(3);
  });

  it("dedup count reflects entry-id collisions surviving memory filter", () => {
    const events: SlotReservationDiagnostic[] = [];
    const p1a = mkCandidate({ hook: "h1a", total: 10, packEntryId: "p1" });
    const p1b = mkCandidate({ hook: "h1b", total: 9, packEntryId: "p1" });
    const p2 = mkCandidate({ hook: "h2", total: 8, packEntryId: "p2" });
    const np = mkCandidate({ hook: "np", total: 5 });
    applyNigerianPackSlotReservation({
      selectionBatch: [p1a, np, p2],
      candidatePool: [p1a, p1b, p2, np],
      desiredCount: 3,
      region: NG,
      languageStyle: PIDGIN,
      flagEnabled: true,
      packLength: 100,
      onDiagnostic: (d) => events.push(d),
    });
    expect(events).toHaveLength(1);
    expect(events[0].packPoolPreFilter).toBe(3);
    expect(events[0].packPoolPostMemoryFilter).toBe(3);
    expect(events[0].packPoolPostBatchDedup).toBe(2);
    expect(events[0].earlyReturnEmptyPack).toBe(false);
  });
});
