/**
 * PHASE N1-LIVE-HARDEN P1 — Memory soft-cap rescue tests.
 *
 * Verifies the staging-only rescue branch in
 * `applyNigerianPackSlotReservation`:
 *
 *   1. Saturated memory (every pack id in `excludeEntryIds`) +
 *      softCapEnabled + ordered list → rescue fires; relaxed set
 *      keeps only the most-recent ⌈n/2⌉ ids; pack candidates from
 *      the OLDER half are surfaced into the composed batch.
 *   2. Partially-saturated memory (the standard filter still
 *      surfaces ≥1 candidate) → rescue does NOT fire.
 *   3. softCapEnabled=false / undefined → rescue does NOT fire even
 *      with a saturated memory and an ordered list (production
 *      gate respected).
 *   4. Empty `excludeEntryIdsOrdered` → rescue does NOT fire even
 *      with softCapEnabled=true (no ordered evidence to relax).
 *   5. Per-batch dedup on `nigerianPackEntryId` is preserved AFTER
 *      rescue — the relaxed pool can never produce a batch with a
 *      duplicate entry id.
 *   6. Non-NG cohort → activation guard short-circuits BEFORE
 *      reaching the rescue branch (no diagnostic emission).
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

function packEntryIdsOf(batch: ScoredCandidate[]): string[] {
  return batch
    .map((c) => (c.meta as { nigerianPackEntryId?: string }).nigerianPackEntryId)
    .filter((id): id is string => typeof id === "string");
}

const NG: Region = "nigeria";
const WEST: Region = "western";
const PIDGIN: LanguageStyle = "pidgin";

describe("applyNigerianPackSlotReservation — P1 memory soft-cap rescue", () => {
  it("fires rescue when saturated memory wipes pool to zero and softCap ON", () => {
    const events: SlotReservationDiagnostic[] = [];
    // Pool has p1 (oldest) and p2 (mid) and p3 (most-recent).
    // Memory has all three ⇒ standard filter wipes pool.
    // Ordered list (most-recent first): [p3, p2, p1]
    // Rescue keeps ⌈3/2⌉ = 2 most-recent (p3, p2) ⇒ p1 surfaces.
    const p1 = mkCandidate({ hook: "h1 oldest", total: 10, packEntryId: "p1" });
    const p2 = mkCandidate({ hook: "h2 mid", total: 9, packEntryId: "p2" });
    const p3 = mkCandidate({ hook: "h3 newest", total: 8, packEntryId: "p3" });
    // Three DISTINCT non-pack hooks so the composition pass can
    // fill the trailing slots without colliding on `pickedHooks`
    // and falling back to the "shrunk → return upstream" branch.
    const np1 = mkCandidate({ hook: "np one", total: 5 });
    const np2 = mkCandidate({ hook: "np two", total: 4 });
    const np3 = mkCandidate({ hook: "np three", total: 3 });
    const out = applyNigerianPackSlotReservation({
      selectionBatch: [np1, np2, np3],
      candidatePool: [p1, p2, p3, np1, np2, np3],
      desiredCount: 3,
      region: NG,
      languageStyle: PIDGIN,
      flagEnabled: true,
      packLength: 100,
      excludeEntryIds: new Set(["p1", "p2", "p3"]),
      softCapEnabled: true,
      excludeEntryIdsOrdered: ["p3", "p2", "p1"],
      onDiagnostic: (d) => events.push(d),
    });
    expect(events).toHaveLength(1);
    expect(events[0].packPoolPreFilter).toBe(3);
    expect(events[0].packPoolPostMemoryFilter).toBe(0);
    expect(events[0].softCapRescueFired).toBe(true);
    expect(events[0].softCapRelaxedSeenSize).toBe(2);
    // p1 was the only entry NOT in the relaxed exclusion set.
    expect(packEntryIdsOf(out)).toEqual(["p1"]);
  });

  it("does NOT fire rescue when standard filter still surfaces candidates", () => {
    const events: SlotReservationDiagnostic[] = [];
    const p1 = mkCandidate({ hook: "h1", total: 10, packEntryId: "p1" });
    const p2 = mkCandidate({ hook: "h2", total: 9, packEntryId: "p2" });
    const np = mkCandidate({ hook: "np", total: 5 });
    applyNigerianPackSlotReservation({
      selectionBatch: [p1, np, p2],
      candidatePool: [p1, p2, np],
      desiredCount: 3,
      region: NG,
      languageStyle: PIDGIN,
      flagEnabled: true,
      packLength: 100,
      excludeEntryIds: new Set(["p1"]),
      softCapEnabled: true,
      excludeEntryIdsOrdered: ["p1"],
      onDiagnostic: (d) => events.push(d),
    });
    expect(events).toHaveLength(1);
    expect(events[0].softCapRescueFired).toBe(false);
    expect(events[0].softCapRelaxedSeenSize).toBeNull();
  });

  it("does NOT fire rescue when softCapEnabled=false (production gate)", () => {
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
      softCapEnabled: false,
      excludeEntryIdsOrdered: ["p2", "p1"],
      onDiagnostic: (d) => events.push(d),
    });
    expect(events).toHaveLength(1);
    expect(events[0].softCapRescueFired).toBe(false);
    expect(events[0].softCapRelaxedSeenSize).toBeNull();
    expect(events[0].earlyReturnEmptyPack).toBe(true);
  });

  it("does NOT fire rescue when ordered list is empty", () => {
    const events: SlotReservationDiagnostic[] = [];
    const p1 = mkCandidate({ hook: "h1", total: 10, packEntryId: "p1" });
    const np = mkCandidate({ hook: "np", total: 5 });
    applyNigerianPackSlotReservation({
      selectionBatch: [np, np, np],
      candidatePool: [p1, np],
      desiredCount: 3,
      region: NG,
      languageStyle: PIDGIN,
      flagEnabled: true,
      packLength: 100,
      excludeEntryIds: new Set(["p1"]),
      softCapEnabled: true,
      excludeEntryIdsOrdered: [],
      onDiagnostic: (d) => events.push(d),
    });
    expect(events).toHaveLength(1);
    expect(events[0].softCapRescueFired).toBe(false);
    expect(events[0].earlyReturnEmptyPack).toBe(true);
  });

  it("preserves per-batch entry-id dedup AFTER rescue surfaces pool", () => {
    const events: SlotReservationDiagnostic[] = [];
    // Two pool entries share entryId "p1" — even after rescue
    // surfaces them, the dedup loop must still pick only ONE.
    const p1a = mkCandidate({ hook: "h1a", total: 10, packEntryId: "p1" });
    const p1b = mkCandidate({ hook: "h1b", total: 9, packEntryId: "p1" });
    const np1 = mkCandidate({ hook: "np one", total: 5 });
    const np2 = mkCandidate({ hook: "np two", total: 4 });
    const np3 = mkCandidate({ hook: "np three", total: 3 });
    const out = applyNigerianPackSlotReservation({
      selectionBatch: [np1, np2, np3],
      candidatePool: [p1a, p1b, np1, np2, np3],
      desiredCount: 3,
      region: NG,
      languageStyle: PIDGIN,
      flagEnabled: true,
      packLength: 100,
      excludeEntryIds: new Set(["p1", "p9"]),
      softCapEnabled: true,
      excludeEntryIdsOrdered: ["p9", "p1"],
      onDiagnostic: (d) => events.push(d),
    });
    expect(events[0].softCapRescueFired).toBe(true);
    // Rescue keeps ⌈2/2⌉ = 1 most-recent (p9). p1 is now allowed.
    // Both p1a and p1b would qualify, but dedup picks only one.
    expect(packEntryIdsOf(out)).toEqual(["p1"]);
  });

  it("non-NG cohort short-circuits before reaching rescue branch", () => {
    const events: SlotReservationDiagnostic[] = [];
    const p1 = mkCandidate({ hook: "h1", total: 10, packEntryId: "p1" });
    const np = mkCandidate({ hook: "np", total: 5 });
    applyNigerianPackSlotReservation({
      selectionBatch: [np, np, np],
      candidatePool: [p1, np],
      desiredCount: 3,
      region: WEST,
      languageStyle: PIDGIN,
      flagEnabled: true,
      packLength: 100,
      excludeEntryIds: new Set(["p1"]),
      softCapEnabled: true,
      excludeEntryIdsOrdered: ["p1"],
      onDiagnostic: (d) => events.push(d),
    });
    // Activation guard fires first; diagnostic is never emitted.
    expect(events).toHaveLength(0);
  });
});
