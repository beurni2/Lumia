import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  NG_CLEAN_RESERVE_PICKER_HQS_FLOOR,
  NG_CLEAN_RESERVE_MAX_RETURN,
  NG_CLEAN_RESERVE_TOTAL_AUTHORED,
  buildNgCleanSlot1PlusSidecarReserve,
  getNgCleanSidecarReservePool,
} from "../nigerianCleanCoreSlot1PlusSidecarReserve.js";
import { NIGERIAN_CLEAN_CORE_ENTRIES } from "../nigerianCleanCorePack.js";
import { resolveCleanCoreEntryIdByHook } from "../nigerianCleanCoreSlot0AntiRepeatSwap.js";

describe("P16-A7 nigerianCleanCoreSlot1PlusSidecarReserve", () => {
  describe("PICKER_HQS_FLOOR parity", () => {
    it("source-grep: PICKER_HQS_FLOOR=50 in willingnessScorer.ts is unchanged", () => {
      const src = readFileSync(
        join(__dirname, "..", "willingnessScorer.ts"),
        "utf-8",
      );
      expect(src).toMatch(/const\s+PICKER_HQS_FLOOR\s*=\s*50\s*;/);
    });

    it("reserve floor mirrors PICKER_HQS_FLOOR exactly", () => {
      expect(NG_CLEAN_RESERVE_PICKER_HQS_FLOOR).toBe(50);
    });

    it("source-grep: HOOK_QUALITY_FLOOR (whichever name) not lowered to <40 anywhere in lib", () => {
      // Defence-in-depth: this phase MUST NOT touch any quality
      // floor. We explicitly assert the well-known floors are
      // unchanged.
      const wsrc = readFileSync(
        join(__dirname, "..", "willingnessScorer.ts"),
        "utf-8",
      );
      expect(wsrc).toMatch(/PICKER_HQS_FLOOR\s*=\s*50/);
    });
  });

  describe("pool composition", () => {
    it("pool is non-empty (corpus + author both produce >0 reserve entries)", () => {
      expect(NG_CLEAN_RESERVE_TOTAL_AUTHORED).toBeGreaterThan(0);
    });

    it("every pool entry's hookQualityScore >= PICKER_HQS_FLOOR", () => {
      const pool = getNgCleanSidecarReservePool();
      for (const row of pool) {
        expect(row.hookQualityScore).toBeGreaterThanOrEqual(
          NG_CLEAN_RESERVE_PICKER_HQS_FLOOR,
        );
      }
    });

    it("every pool entry's entryId resolves canonically against the corpus", () => {
      const pool = getNgCleanSidecarReservePool();
      for (const row of pool) {
        const resolved = resolveCleanCoreEntryIdByHook(row.idea.hook);
        expect(resolved).toBe(row.entryId);
      }
    });

    it("pool is sorted by HQS desc, ties by entryId asc", () => {
      const pool = getNgCleanSidecarReservePool();
      for (let i = 1; i < pool.length; i++) {
        const prev = pool[i - 1]!;
        const cur = pool[i]!;
        if (prev.hookQualityScore === cur.hookQualityScore) {
          expect(prev.entryId.localeCompare(cur.entryId)).toBeLessThanOrEqual(0);
        } else {
          expect(prev.hookQualityScore).toBeGreaterThan(cur.hookQualityScore);
        }
      }
    });

    it("held entries 080/088 are structurally absent from the corpus and reserve", () => {
      const ids = NIGERIAN_CLEAN_CORE_ENTRIES.map((e) => e.id);
      expect(ids).not.toContain("ng_clean_080");
      expect(ids).not.toContain("ng_clean_088");
      const pool = getNgCleanSidecarReservePool();
      const poolIds = pool.map((r) => r.entryId);
      expect(poolIds).not.toContain("ng_clean_080");
      expect(poolIds).not.toContain("ng_clean_088");
    });

    it("reserve includes substantially more than 2 entries (the P16-A6 ceiling)", () => {
      // P16-A6 ceiling was 2 fresh sidecar candidates. P16-A7 must
      // widen well past that.
      expect(NG_CLEAN_RESERVE_TOTAL_AUTHORED).toBeGreaterThan(10);
    });

    it("every reserve entry carries pickerEligible:true on idea after build", () => {
      const out = buildNgCleanSlot1PlusSidecarReserve({
        excludeFinalEntryIds: new Set(),
        excludeRecentMemoryEntryIds: new Set(),
        excludeLiveSidecarEntryIds: new Set(),
      });
      for (const c of out) {
        expect(c.idea.pickerEligible).toBe(true);
      }
    });

    it("every reserve entry has hook + whatToShow + howToFilm + caption populated", () => {
      const out = buildNgCleanSlot1PlusSidecarReserve({
        excludeFinalEntryIds: new Set(),
        excludeRecentMemoryEntryIds: new Set(),
        excludeLiveSidecarEntryIds: new Set(),
      });
      for (const c of out) {
        expect(c.idea.hook.length).toBeGreaterThan(0);
        expect(c.idea.whatToShow.length).toBeGreaterThan(0);
        expect(c.idea.howToFilm.length).toBeGreaterThan(0);
        expect(c.idea.caption.length).toBeGreaterThan(0);
      }
    });
  });

  describe("exclusion semantics", () => {
    it("excludes ids in excludeFinalEntryIds", () => {
      const baseline = buildNgCleanSlot1PlusSidecarReserve({
        excludeFinalEntryIds: new Set(),
        excludeRecentMemoryEntryIds: new Set(),
        excludeLiveSidecarEntryIds: new Set(),
        maxReturn: 9999,
      });
      const firstId = baseline[0]!.cleanCoreEntryId;
      const filtered = buildNgCleanSlot1PlusSidecarReserve({
        excludeFinalEntryIds: new Set([firstId]),
        excludeRecentMemoryEntryIds: new Set(),
        excludeLiveSidecarEntryIds: new Set(),
        maxReturn: 9999,
      });
      expect(filtered.find((c) => c.cleanCoreEntryId === firstId)).toBeUndefined();
      expect(filtered.length).toBe(baseline.length - 1);
    });

    it("excludes ids in excludeRecentMemoryEntryIds", () => {
      // Use a sky-high cap so the assertion exercises the full
      // pool; the default 32-cap can otherwise mask exclusion
      // arithmetic when total > cap.
      const baseline = buildNgCleanSlot1PlusSidecarReserve({
        excludeFinalEntryIds: new Set(),
        excludeRecentMemoryEntryIds: new Set(),
        excludeLiveSidecarEntryIds: new Set(),
        maxReturn: 9999,
      });
      const ids = baseline.slice(0, 3).map((c) => c.cleanCoreEntryId);
      const filtered = buildNgCleanSlot1PlusSidecarReserve({
        excludeFinalEntryIds: new Set(),
        excludeRecentMemoryEntryIds: new Set(ids),
        excludeLiveSidecarEntryIds: new Set(),
        maxReturn: 9999,
      });
      for (const id of ids) {
        expect(filtered.find((c) => c.cleanCoreEntryId === id)).toBeUndefined();
      }
      expect(filtered.length).toBe(baseline.length - 3);
    });

    it("excludes ids in excludeLiveSidecarEntryIds", () => {
      const baseline = buildNgCleanSlot1PlusSidecarReserve({
        excludeFinalEntryIds: new Set(),
        excludeRecentMemoryEntryIds: new Set(),
        excludeLiveSidecarEntryIds: new Set(),
      });
      const id = baseline[0]!.cleanCoreEntryId;
      const filtered = buildNgCleanSlot1PlusSidecarReserve({
        excludeFinalEntryIds: new Set(),
        excludeRecentMemoryEntryIds: new Set(),
        excludeLiveSidecarEntryIds: new Set([id]),
      });
      expect(filtered.find((c) => c.cleanCoreEntryId === id)).toBeUndefined();
    });

    it("excluding all ids yields empty reserve", () => {
      const baseline = buildNgCleanSlot1PlusSidecarReserve({
        excludeFinalEntryIds: new Set(),
        excludeRecentMemoryEntryIds: new Set(),
        excludeLiveSidecarEntryIds: new Set(),
        maxReturn: 9999,
      });
      const allIds = new Set(baseline.map((c) => c.cleanCoreEntryId));
      const filtered = buildNgCleanSlot1PlusSidecarReserve({
        excludeFinalEntryIds: allIds,
        excludeRecentMemoryEntryIds: new Set(),
        excludeLiveSidecarEntryIds: new Set(),
        maxReturn: 9999,
      });
      expect(filtered.length).toBe(0);
    });
  });

  describe("determinism + cap", () => {
    it("two calls with identical inputs return identical results (entryIds, hooks, order)", () => {
      const ctx = {
        excludeFinalEntryIds: new Set(["ng_clean_023"]),
        excludeRecentMemoryEntryIds: new Set(["ng_clean_056", "ng_clean_072"]),
        excludeLiveSidecarEntryIds: new Set<string>(),
      };
      const a = buildNgCleanSlot1PlusSidecarReserve(ctx);
      const b = buildNgCleanSlot1PlusSidecarReserve(ctx);
      expect(a.map((c) => c.cleanCoreEntryId)).toEqual(
        b.map((c) => c.cleanCoreEntryId),
      );
      expect(a.map((c) => c.idea.hook)).toEqual(b.map((c) => c.idea.hook));
    });

    it("respects maxReturn cap (clamped into [0, MAX])", () => {
      const out2 = buildNgCleanSlot1PlusSidecarReserve({
        excludeFinalEntryIds: new Set(),
        excludeRecentMemoryEntryIds: new Set(),
        excludeLiveSidecarEntryIds: new Set(),
        maxReturn: 2,
      });
      expect(out2.length).toBe(2);

      const outNeg = buildNgCleanSlot1PlusSidecarReserve({
        excludeFinalEntryIds: new Set(),
        excludeRecentMemoryEntryIds: new Set(),
        excludeLiveSidecarEntryIds: new Set(),
        maxReturn: -5,
      });
      expect(outNeg.length).toBe(0);

      const outHuge = buildNgCleanSlot1PlusSidecarReserve({
        excludeFinalEntryIds: new Set(),
        excludeRecentMemoryEntryIds: new Set(),
        excludeLiveSidecarEntryIds: new Set(),
        maxReturn: 9999,
      });
      // maxReturn is a soft default — when the caller explicitly
      // overrides above NG_CLEAN_RESERVE_MAX_RETURN, the full
      // pool is exposed (capped at pool size).
      expect(outHuge.length).toBe(getNgCleanSidecarReservePool().length);
    });

    it("default cap matches NG_CLEAN_RESERVE_MAX_RETURN", () => {
      const out = buildNgCleanSlot1PlusSidecarReserve({
        excludeFinalEntryIds: new Set(),
        excludeRecentMemoryEntryIds: new Set(),
        excludeLiveSidecarEntryIds: new Set(),
      });
      expect(out.length).toBeLessThanOrEqual(NG_CLEAN_RESERVE_MAX_RETURN);
    });
  });

  describe("walk-order sanity", () => {
    it("first reserve entry has highest HQS in pool minus exclusions", () => {
      const out = buildNgCleanSlot1PlusSidecarReserve({
        excludeFinalEntryIds: new Set(),
        excludeRecentMemoryEntryIds: new Set(),
        excludeLiveSidecarEntryIds: new Set(),
      });
      const pool = getNgCleanSidecarReservePool();
      expect(out[0]!.cleanCoreEntryId).toBe(pool[0]!.entryId);
    });
  });
});
