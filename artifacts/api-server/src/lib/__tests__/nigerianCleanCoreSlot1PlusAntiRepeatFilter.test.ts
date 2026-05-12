/**
 * PHASE P16-A6-NG-CLEAN-SLOT1-MEMORY-ANTI-REPEAT — unit tests for
 * `applyNgCleanSlot1PlusAntiRepeatFilter`.
 *
 * Mirrors the slot-0 swap test pattern. Covers:
 *   • SWAP-ONLY length preservation
 *   • slot 0 is NEVER written (and slot-0 entry id cannot be promoted)
 *   • only `pickerEligible` + clean-core sidecar candidates qualify
 *   • distinct cleanCoreEntryId dedup vs final[] AND inside the pass
 *   • no-op when memory empty
 *   • no-op when no slot-1+ position is in memory
 *   • graceful relaxation when sidecar exhausted
 *   • walk order is lowest slot first
 *   • returns input reference unchanged on no-op
 *   • flag env constant
 *   • collectSlot1PlusCleanCoreEntryIds helper
 */
import { describe, expect, it } from "vitest";

import {
  applyNgCleanSlot1PlusAntiRepeatFilter,
  collectSlot1PlusCleanCoreEntryIds,
  isNgCleanSlot1PlusAntiRepeatEnabled,
  MAX_SLOT1PLUS_REPLACEMENTS,
  NG_CLEAN_SLOT1PLUS_ANTI_REPEAT_FLAG_ENV,
  type FilterCandidate,
} from "../nigerianCleanCoreSlot1PlusAntiRepeatFilter.js";
import { NIGERIAN_CLEAN_CORE_ENTRIES } from "../nigerianCleanCorePack.js";

const cleanById = (id: string) => {
  const e = NIGERIAN_CLEAN_CORE_ENTRIES.find((x) => x.id === id);
  if (!e) throw new Error(`fixture missing clean-core id ${id}`);
  return e;
};

const cleanCand = (
  id: string,
  opts: { pickerEligible?: boolean } = {},
): FilterCandidate => ({
  idea: {
    hook: cleanById(id).hook,
    pickerEligible: opts.pickerEligible ?? true,
  },
});

const nonCleanCand = (
  hook: string,
  opts: { pickerEligible?: boolean } = {},
): FilterCandidate => ({
  idea: { hook, pickerEligible: opts.pickerEligible ?? true },
});

describe("constants", () => {
  it("flag env name is the staging-only constant", () => {
    expect(NG_CLEAN_SLOT1PLUS_ANTI_REPEAT_FLAG_ENV).toBe(
      "LUMINA_NG_CLEAN_SLOT1PLUS_ANTI_REPEAT_ENABLED",
    );
  });
  it("MAX_SLOT1PLUS_REPLACEMENTS is a positive ceiling", () => {
    expect(MAX_SLOT1PLUS_REPLACEMENTS).toBeGreaterThanOrEqual(2);
  });
});

describe("isNgCleanSlot1PlusAntiRepeatEnabled", () => {
  it("returns false when flag unset", () => {
    const prev = process.env[NG_CLEAN_SLOT1PLUS_ANTI_REPEAT_FLAG_ENV];
    delete process.env[NG_CLEAN_SLOT1PLUS_ANTI_REPEAT_FLAG_ENV];
    try {
      expect(isNgCleanSlot1PlusAntiRepeatEnabled()).toBe(false);
    } finally {
      if (prev !== undefined)
        process.env[NG_CLEAN_SLOT1PLUS_ANTI_REPEAT_FLAG_ENV] = prev;
    }
  });
  it("returns true only on exact 'true'", () => {
    const prev = process.env[NG_CLEAN_SLOT1PLUS_ANTI_REPEAT_FLAG_ENV];
    try {
      process.env[NG_CLEAN_SLOT1PLUS_ANTI_REPEAT_FLAG_ENV] = "1";
      expect(isNgCleanSlot1PlusAntiRepeatEnabled()).toBe(false);
      process.env[NG_CLEAN_SLOT1PLUS_ANTI_REPEAT_FLAG_ENV] = "true";
      expect(isNgCleanSlot1PlusAntiRepeatEnabled()).toBe(true);
    } finally {
      if (prev === undefined)
        delete process.env[NG_CLEAN_SLOT1PLUS_ANTI_REPEAT_FLAG_ENV];
      else process.env[NG_CLEAN_SLOT1PLUS_ANTI_REPEAT_FLAG_ENV] = prev;
    }
  });
});

describe("applyNgCleanSlot1PlusAntiRepeatFilter", () => {
  it("(1) replaces a single seen slot-1 entry with the highest-ranked fresh sidecar entry", () => {
    const final = [
      cleanCand("ng_clean_001"),
      cleanCand("ng_clean_002"), // seen
      nonCleanCand("the fridge knows i'm lying.", { pickerEligible: false }),
    ];
    const sidecar = [
      cleanCand("ng_clean_039"),
      cleanCand("ng_clean_023"),
    ];
    const r = applyNgCleanSlot1PlusAntiRepeatFilter(final, {
      recentSlot1PlusCleanCoreEntryIds: new Set(["ng_clean_002"]),
      sidecarPool: sidecar,
    });
    expect(r.swappedCount).toBe(1);
    expect(r.relaxedCount).toBe(0);
    expect(r.suppressedEntryIds).toEqual(["ng_clean_002"]);
    expect(r.insertedEntryIds).toEqual(["ng_clean_039"]);
    expect(r.swaps).toEqual([
      { atIndex: 1, fromCleanCoreEntryId: "ng_clean_002", toCleanCoreEntryId: "ng_clean_039" },
    ]);
    expect(r.final.length).toBe(final.length);
    expect(r.final[0]?.idea.hook).toBe(cleanById("ng_clean_001").hook);
    expect(r.final[1]?.idea.hook).toBe(cleanById("ng_clean_039").hook);
    expect(r.final[2]).toBe(final[2]);
  });

  it("(2) walks lowest-slot-first when multiple positions are seen", () => {
    const final = [
      cleanCand("ng_clean_001"),
      cleanCand("ng_clean_002"), // seen
      nonCleanCand("filler one"),
      cleanCand("ng_clean_023"), // seen
      cleanCand("ng_clean_056"), // seen
    ];
    const sidecar = [
      cleanCand("ng_clean_039"),
      cleanCand("ng_clean_072"),
    ];
    const r = applyNgCleanSlot1PlusAntiRepeatFilter(final, {
      recentSlot1PlusCleanCoreEntryIds: new Set([
        "ng_clean_002",
        "ng_clean_023",
        "ng_clean_056",
      ]),
      sidecarPool: sidecar,
    });
    expect(r.swappedCount).toBe(2);
    expect(r.relaxedCount).toBe(1);
    expect(r.swaps[0]?.atIndex).toBe(1);
    expect(r.swaps[1]?.atIndex).toBe(3);
    expect(r.swaps[0]?.toCleanCoreEntryId).toBe("ng_clean_039");
    expect(r.swaps[1]?.toCleanCoreEntryId).toBe("ng_clean_072");
    // slot 4 (ng_clean_056) is left unchanged — sidecar exhausted
    expect(r.final[4]?.idea.hook).toBe(cleanById("ng_clean_056").hook);
    expect(r.suppressedEntryIds).toContain("ng_clean_056");
    expect(r.insertedEntryIds).toEqual(["ng_clean_039", "ng_clean_072"]);
    expect(r.final.length).toBe(final.length);
  });

  it("(3) NEVER writes slot 0 even if its entry id is in memory", () => {
    const final = [
      cleanCand("ng_clean_002"), // slot 0 — would match memory but slot 0 is off-limits
      cleanCand("ng_clean_039"),
    ];
    const sidecar = [cleanCand("ng_clean_023")];
    const r = applyNgCleanSlot1PlusAntiRepeatFilter(final, {
      recentSlot1PlusCleanCoreEntryIds: new Set(["ng_clean_002"]),
      sidecarPool: sidecar,
    });
    expect(r.swappedCount).toBe(0);
    expect(r.relaxedCount).toBe(0);
    expect(r.final).toBe(final);
  });

  it("(4) skips non-pickerEligible sidecar candidates", () => {
    const final = [
      cleanCand("ng_clean_001"),
      cleanCand("ng_clean_002"), // seen
    ];
    const sidecar = [
      cleanCand("ng_clean_039", { pickerEligible: false }),
      cleanCand("ng_clean_023"),
    ];
    const r = applyNgCleanSlot1PlusAntiRepeatFilter(final, {
      recentSlot1PlusCleanCoreEntryIds: new Set(["ng_clean_002"]),
      sidecarPool: sidecar,
    });
    expect(r.swappedCount).toBe(1);
    expect(r.swaps[0]?.toCleanCoreEntryId).toBe("ng_clean_023");
  });

  it("(5) skips sidecar candidates whose id is already in final[]", () => {
    const final = [
      cleanCand("ng_clean_001"),
      cleanCand("ng_clean_002"), // seen
      cleanCand("ng_clean_023"), // already present — sidecar must not re-promote it
    ];
    const sidecar = [
      cleanCand("ng_clean_023"), // duplicate of final[2]
      cleanCand("ng_clean_039"),
    ];
    const r = applyNgCleanSlot1PlusAntiRepeatFilter(final, {
      recentSlot1PlusCleanCoreEntryIds: new Set(["ng_clean_002"]),
      sidecarPool: sidecar,
    });
    expect(r.swappedCount).toBe(1);
    expect(r.swaps[0]?.toCleanCoreEntryId).toBe("ng_clean_039");
    // distinct entry-id preservation: no two slots share an id
    const ids = r.final.map((c) =>
      NIGERIAN_CLEAN_CORE_ENTRIES.find((e) => e.hook === c.idea.hook)?.id,
    );
    const distinct = ids.filter((x): x is string => typeof x === "string");
    expect(new Set(distinct).size).toBe(distinct.length);
  });

  it("(6) skips sidecar candidates whose id is in memory (cannot insert another seen entry)", () => {
    const final = [
      cleanCand("ng_clean_001"),
      cleanCand("ng_clean_002"), // seen
    ];
    const sidecar = [
      cleanCand("ng_clean_023"), // also seen
      cleanCand("ng_clean_039"),
    ];
    const r = applyNgCleanSlot1PlusAntiRepeatFilter(final, {
      recentSlot1PlusCleanCoreEntryIds: new Set([
        "ng_clean_002",
        "ng_clean_023",
      ]),
      sidecarPool: sidecar,
    });
    expect(r.swappedCount).toBe(1);
    expect(r.swaps[0]?.toCleanCoreEntryId).toBe("ng_clean_039");
  });

  it("(7) no-op when no slot-1+ position is in memory", () => {
    const final = [
      cleanCand("ng_clean_001"),
      cleanCand("ng_clean_002"),
      cleanCand("ng_clean_039"),
    ];
    const sidecar = [cleanCand("ng_clean_023")];
    const r = applyNgCleanSlot1PlusAntiRepeatFilter(final, {
      recentSlot1PlusCleanCoreEntryIds: new Set(["ng_clean_999"]),
      sidecarPool: sidecar,
    });
    expect(r.swappedCount).toBe(0);
    expect(r.relaxedCount).toBe(0);
    expect(r.final).toBe(final);
  });

  it("(8) no-op when memory is empty", () => {
    const final = [cleanCand("ng_clean_001"), cleanCand("ng_clean_002")];
    const r = applyNgCleanSlot1PlusAntiRepeatFilter(final, {
      recentSlot1PlusCleanCoreEntryIds: new Set(),
      sidecarPool: [cleanCand("ng_clean_039")],
    });
    expect(r.swappedCount).toBe(0);
    expect(r.final).toBe(final);
  });

  it("(9) no-op when final.length < 2", () => {
    const final = [cleanCand("ng_clean_001")];
    const r = applyNgCleanSlot1PlusAntiRepeatFilter(final, {
      recentSlot1PlusCleanCoreEntryIds: new Set(["ng_clean_001"]),
      sidecarPool: [cleanCand("ng_clean_039")],
    });
    expect(r.swappedCount).toBe(0);
    expect(r.final).toBe(final);
  });

  it("(10) graceful relaxation: sidecar empty ⇒ swappedCount=0, relaxedCount>0, returns input ref", () => {
    const final = [
      cleanCand("ng_clean_001"),
      cleanCand("ng_clean_002"), // seen
      cleanCand("ng_clean_023"), // seen
    ];
    const r = applyNgCleanSlot1PlusAntiRepeatFilter(final, {
      recentSlot1PlusCleanCoreEntryIds: new Set([
        "ng_clean_002",
        "ng_clean_023",
      ]),
      sidecarPool: [],
    });
    expect(r.swappedCount).toBe(0);
    expect(r.relaxedCount).toBe(2);
    expect(r.suppressedEntryIds).toEqual(["ng_clean_002", "ng_clean_023"]);
    expect(r.insertedEntryIds).toEqual([]);
    expect(r.final).toBe(final);
  });

  it("(11) deterministic: same inputs produce identical output", () => {
    const final = [
      cleanCand("ng_clean_001"),
      cleanCand("ng_clean_002"),
      cleanCand("ng_clean_023"),
    ];
    const sidecar = [cleanCand("ng_clean_039"), cleanCand("ng_clean_072")];
    const memory = new Set(["ng_clean_002", "ng_clean_023"]);
    const r1 = applyNgCleanSlot1PlusAntiRepeatFilter(final, {
      recentSlot1PlusCleanCoreEntryIds: memory,
      sidecarPool: sidecar,
    });
    const r2 = applyNgCleanSlot1PlusAntiRepeatFilter(final, {
      recentSlot1PlusCleanCoreEntryIds: memory,
      sidecarPool: sidecar,
    });
    expect(r1.swaps).toEqual(r2.swaps);
    expect(r1.final.map((c) => c.idea.hook)).toEqual(
      r2.final.map((c) => c.idea.hook),
    );
  });

  it("(12) does not mutate input array", () => {
    const final = [cleanCand("ng_clean_001"), cleanCand("ng_clean_002")];
    const snapshot = final.slice();
    applyNgCleanSlot1PlusAntiRepeatFilter(final, {
      recentSlot1PlusCleanCoreEntryIds: new Set(["ng_clean_002"]),
      sidecarPool: [cleanCand("ng_clean_039")],
    });
    expect(final).toEqual(snapshot);
  });

  it("(13) MAX_SLOT1PLUS_REPLACEMENTS bounds the swap count", () => {
    const ids = ["002", "023", "039", "056", "072", "001", "029", "030"];
    const seenIds = ids.slice(0, 8).map((s) => `ng_clean_${s}`);
    // build: slot 0 = filler non-clean, slots 1..8 all seen
    const filler = nonCleanCand("the fridge knows i'm lying.", { pickerEligible: false });
    const final: FilterCandidate[] = [filler];
    for (const id of seenIds) final.push(cleanCand(id));
    const sidecar: FilterCandidate[] = [];
    // 10 distinct fresh sidecar entries (not in seen, not in final)
    const freshIds = [
      "ng_clean_004",
      "ng_clean_005",
      "ng_clean_006",
      "ng_clean_007",
      "ng_clean_008",
      "ng_clean_009",
      "ng_clean_010",
      "ng_clean_011",
      "ng_clean_012",
      "ng_clean_013",
    ];
    for (const id of freshIds) {
      try {
        sidecar.push(cleanCand(id));
      } catch {
        /* skip held ids */
      }
    }
    const r = applyNgCleanSlot1PlusAntiRepeatFilter(final, {
      recentSlot1PlusCleanCoreEntryIds: new Set(seenIds),
      sidecarPool: sidecar,
    });
    expect(r.swappedCount).toBeLessThanOrEqual(MAX_SLOT1PLUS_REPLACEMENTS);
  });
});

describe("collectSlot1PlusCleanCoreEntryIds", () => {
  it("returns clean-core ids at slot 1+ in order, skipping slot 0 and non-clean", () => {
    const final = [
      cleanCand("ng_clean_001"), // slot 0 — skipped
      cleanCand("ng_clean_002"),
      nonCleanCand("the fridge knows i'm lying."), // skipped
      cleanCand("ng_clean_039"),
    ];
    expect(collectSlot1PlusCleanCoreEntryIds(final)).toEqual([
      "ng_clean_002",
      "ng_clean_039",
    ]);
  });

  it("dedupes within slot-1+ (defensive)", () => {
    const final = [
      cleanCand("ng_clean_001"),
      cleanCand("ng_clean_002"),
      cleanCand("ng_clean_002"),
    ];
    expect(collectSlot1PlusCleanCoreEntryIds(final)).toEqual(["ng_clean_002"]);
  });

  it("empty for final.length < 2", () => {
    expect(collectSlot1PlusCleanCoreEntryIds([cleanCand("ng_clean_001")])).toEqual([]);
    expect(collectSlot1PlusCleanCoreEntryIds([])).toEqual([]);
  });
});
