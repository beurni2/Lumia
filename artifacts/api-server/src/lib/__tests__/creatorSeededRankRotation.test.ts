import { describe, it, expect } from "vitest";
import {
  applyCreatorSeededRankRotation,
  CREATOR_SEEDED_RANK_BAND_K,
  type CreatorSeededRankCandidate,
} from "../creatorSeededRankRotation";

type C = CreatorSeededRankCandidate & { id: string };

function mk(id: string, w: number, eligible = true): C {
  return { id, idea: { willingnessScore: w, pickerEligible: eligible } };
}

function ids(arr: ReadonlyArray<C>): string[] {
  return arr.map((c) => c.id);
}

describe("applyCreatorSeededRankRotation", () => {
  // (1) Same creator id + same pool → byte-identical order.
  it("is deterministic for the same creator id", () => {
    const pool: C[] = [
      mk("a", 80), mk("b", 78), mk("c", 76), mk("d", 75), mk("e", 73), mk("f", 70),
    ];
    const a = applyCreatorSeededRankRotation(pool, "creator-xyz");
    const b = applyCreatorSeededRankRotation(pool, "creator-xyz");
    expect(ids(a)).toEqual(ids(b));
  });

  // (2) Different creator ids on a near-tied pool → at least one
  // pair of creators sees different orderings.
  it("varies across creator ids on a near-tied pool", () => {
    const pool: C[] = [
      mk("a", 80), mk("b", 79), mk("c", 78), mk("d", 77), mk("e", 76), mk("f", 75),
    ];
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const out = applyCreatorSeededRankRotation(pool, `creator-${i}`);
      seen.add(ids(out).join(","));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  // (3) Candidates outside the K-band are never promoted.
  it("never promotes a candidate outside the K-band", () => {
    // Top 2 are tied; positions 3..6 are far below K=10 floor.
    const pool: C[] = [
      mk("hi1", 90), mk("hi2", 89),
      mk("lo1", 50), mk("lo2", 49), mk("lo3", 48), mk("lo4", 47),
    ];
    for (let i = 0; i < 50; i++) {
      const out = applyCreatorSeededRankRotation(pool, `c-${i}`);
      // First two slots may permute among {hi1, hi2}; lo* may NEVER
      // appear at slot 0 or slot 1.
      expect(["hi1", "hi2"]).toContain(out[0]!.id);
      expect(["hi1", "hi2"]).toContain(out[1]!.id);
      // Slots 2..5 are also single-element bands (lo1 vs lo2..lo4
      // are within K=10 ⇒ lo1 may swap with one of them; assert
      // identity set is preserved instead).
      expect(new Set(ids(out))).toEqual(new Set(ids(pool)));
    }
  });

  // (4) Identity set + count are preserved.
  it("preserves count and identity set", () => {
    const pool: C[] = [
      mk("a", 80), mk("b", 78), mk("c", 76), mk("d", 75), mk("e", 73), mk("f", 70),
    ];
    for (let i = 0; i < 20; i++) {
      const out = applyCreatorSeededRankRotation(pool, `c-${i}`);
      expect(out.length).toBe(pool.length);
      expect(new Set(ids(out))).toEqual(new Set(ids(pool)));
    }
  });

  // (5) Pure: input array and elements are not mutated.
  it("does not mutate the input array or any element", () => {
    const e0 = mk("a", 80);
    const e1 = mk("b", 78);
    const pool: C[] = [e0, e1, mk("c", 76), mk("d", 75)];
    const before = ids(pool);
    const beforeRefs = pool.slice();
    const beforeE0 = { ...e0.idea };
    applyCreatorSeededRankRotation(pool, "creator-xyz");
    expect(ids(pool)).toEqual(before);
    expect(pool).toEqual(beforeRefs);
    expect(e0.idea).toEqual(beforeE0);
  });

  // (6) Never crosses the pickerEligible tier boundary.
  it("never crosses tiers (eligible above ineligible)", () => {
    const pool: C[] = [
      mk("E1", 80, true), mk("E2", 79, true),
      mk("I1", 78, false), mk("I2", 77, false), mk("I3", 76, false),
    ];
    for (let i = 0; i < 40; i++) {
      const out = applyCreatorSeededRankRotation(pool, `c-${i}`);
      // Slot 0 and slot 1 must be among the eligible pair; slots
      // 2..4 must be among the ineligible trio (any permutation).
      expect(["E1", "E2"]).toContain(out[0]!.id);
      expect(["E1", "E2"]).toContain(out[1]!.id);
      const tail = new Set([out[2]!.id, out[3]!.id, out[4]!.id]);
      expect(tail).toEqual(new Set(["I1", "I2", "I3"]));
    }
  });

  // (7) Degenerate cases return the input verbatim (defensive clone).
  it("returns a defensive clone for length<2 / empty creatorId", () => {
    const single: C[] = [mk("a", 80)];
    const a = applyCreatorSeededRankRotation(single, "creator-xyz");
    expect(ids(a)).toEqual(["a"]);
    expect(a).not.toBe(single);

    const pool: C[] = [mk("a", 80), mk("b", 78)];
    const b = applyCreatorSeededRankRotation(pool, "");
    expect(ids(b)).toEqual(["a", "b"]);
    expect(b).not.toBe(pool);
  });

  // (8) Repeated hooks within a K-band CAN be displaced by valid
  // alternatives — concrete cross-creator distinctness assertion
  // tied to the audit's evidence shape.
  it("displaces a repeated leader for some creators when K-band has alternatives", () => {
    // Mirrors the instrumentation report: leader 'totally_fine' at
    // willingness 17, with 5 alternatives all within K=10.
    const pool: C[] = [
      mk("totally_fine", 17), mk("alt1", 17), mk("alt2", 16),
      mk("alt3", 15), mk("alt4", 14), mk("alt5", 13),
    ];
    let displacedAtSlot0 = 0;
    const N = 200;
    for (let i = 0; i < N; i++) {
      const out = applyCreatorSeededRankRotation(pool, `creator-${i}`);
      if (out[0]!.id !== "totally_fine") displacedAtSlot0++;
    }
    // With 6-element K-band, expected ~5/6 ≈ 83% displacement at
    // slot 0 (any non-zero hash modular pick). Assert a generous
    // floor (>50%) — we are not testing hash distribution quality,
    // only that displacement OCCURS.
    expect(displacedAtSlot0).toBeGreaterThan(N * 0.5);
  });

  // (9) The constant matches the first-card K so the two helpers
  // compose inside the same band.
  it("uses K=10 (matches first-card rotation band)", () => {
    expect(CREATOR_SEEDED_RANK_BAND_K).toBe(10);
  });

  // (10) Within-tier band but band-size-1 at every slot ⇒ no-op.
  it("no-ops when every slot's band is size 1", () => {
    // Each adjacent pair is more than K=10 apart ⇒ every band is
    // size 1 ⇒ output must equal input.
    const pool: C[] = [
      mk("a", 100), mk("b", 80), mk("c", 60), mk("d", 40),
    ];
    for (let i = 0; i < 20; i++) {
      const out = applyCreatorSeededRankRotation(pool, `c-${i}`);
      expect(ids(out)).toEqual(["a", "b", "c", "d"]);
    }
  });
});
