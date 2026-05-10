import { describe, it, expect } from "vitest";

import {
  applyNgCleanSlot0AntiRepeatSwap,
  resolveCleanCoreEntryIdByHook,
  type SwapCandidate,
} from "../nigerianCleanCoreSlot0AntiRepeatSwap.js";
import { NIGERIAN_CLEAN_CORE_ENTRIES } from "../nigerianCleanCorePack.js";

const cleanById = (id: string) => {
  const e = NIGERIAN_CLEAN_CORE_ENTRIES.find((x) => x.id === id);
  if (!e) throw new Error(`fixture missing clean-core id ${id}`);
  return e;
};

const cleanCand = (
  id: string,
  opts: { pickerEligible?: boolean } = {},
): SwapCandidate => ({
  idea: {
    hook: cleanById(id).hook,
    pickerEligible: opts.pickerEligible ?? true,
  },
});

const nonCleanCand = (
  hook: string,
  opts: { pickerEligible?: boolean } = {},
): SwapCandidate => ({
  idea: { hook, pickerEligible: opts.pickerEligible ?? true },
});

describe("resolveCleanCoreEntryIdByHook", () => {
  it("resolves the canonical ng_clean_001 hook", () => {
    const id = resolveCleanCoreEntryIdByHook(cleanById("ng_clean_001").hook);
    expect(id).toBe("ng_clean_001");
  });

  it("resolves case-insensitively and trims whitespace", () => {
    const raw = cleanById("ng_clean_001").hook;
    expect(resolveCleanCoreEntryIdByHook(`  ${raw.toUpperCase()}  `)).toBe(
      "ng_clean_001",
    );
  });

  it("returns null for a non-clean-core hook", () => {
    expect(
      resolveCleanCoreEntryIdByHook("the fridge knows i'm lying."),
    ).toBeNull();
  });

  it.each([undefined, "", "   "])("returns null for empty input %p", (h) => {
    expect(resolveCleanCoreEntryIdByHook(h as string | undefined)).toBeNull();
  });

  // Architect-flagged regression: a non-clean-core hook that EMBEDS
  // a clean-core hook as a substring must NOT resolve. Strict
  // normalized-equality only — substring/startsWith/includes
  // fallbacks are intentionally absent.
  it("(regression) does NOT resolve a non-clean hook that contains a clean-core hook as substring", () => {
    const cleanHook = NIGERIAN_CLEAN_CORE_ENTRIES[0]!.hook;
    // Decorate / pattern-vary by appending an extra clause — this
    // is the shape an upstream pattern_variation candidate could
    // produce.
    const decorated = `${cleanHook} and then everything went sideways`;
    expect(resolveCleanCoreEntryIdByHook(decorated)).toBeNull();
    const prefixed = `well, ${cleanHook}`;
    expect(resolveCleanCoreEntryIdByHook(prefixed)).toBeNull();
  });
});

describe("applyNgCleanSlot0AntiRepeatSwap", () => {
  it("(1) swaps to the highest-ranked eligible clean-core alternative when slot-0 is recent", () => {
    const final = [
      cleanCand("ng_clean_001"),
      nonCleanCand("the fridge knows i'm lying.", { pickerEligible: false }),
      cleanCand("ng_clean_039"),
      cleanCand("ng_clean_002"),
    ];
    const r = applyNgCleanSlot0AntiRepeatSwap(final, {
      recentSlot0CleanCoreEntryIds: new Set(["ng_clean_001"]),
    });
    expect(r.swapped).toBe(true);
    expect(r.detail).toEqual({
      fromCleanCoreEntryId: "ng_clean_001",
      toCleanCoreEntryId: "ng_clean_039",
      fromIndex: 2,
    });
    expect(r.final[0]?.idea.hook).toBe(cleanById("ng_clean_039").hook);
    expect(r.final[2]?.idea.hook).toBe(cleanById("ng_clean_001").hook);
    // Identity set preserved.
    expect(r.final.length).toBe(final.length);
    expect(new Set(r.final.map((c) => c.idea.hook))).toEqual(
      new Set(final.map((c) => c.idea.hook)),
    );
  });

  it("(2) does NOT swap when slot-0 cleanCoreEntryId is not in recent memory", () => {
    const final = [cleanCand("ng_clean_001"), cleanCand("ng_clean_039")];
    const r = applyNgCleanSlot0AntiRepeatSwap(final, {
      recentSlot0CleanCoreEntryIds: new Set(["ng_clean_002"]),
    });
    expect(r.swapped).toBe(false);
    expect(r.detail).toBeNull();
    expect(r.final).toBe(final);
  });

  it("(3) does NOT swap when the only alternative is not pickerEligible", () => {
    const final = [
      cleanCand("ng_clean_001"),
      cleanCand("ng_clean_039", { pickerEligible: false }),
    ];
    const r = applyNgCleanSlot0AntiRepeatSwap(final, {
      recentSlot0CleanCoreEntryIds: new Set(["ng_clean_001"]),
    });
    expect(r.swapped).toBe(false);
    expect(r.final).toBe(final);
  });

  it("(4) does NOT swap when the alternative is not clean-core (pattern_variation)", () => {
    const final = [
      cleanCand("ng_clean_001"),
      nonCleanCand("the fridge knows i'm lying."),
    ];
    const r = applyNgCleanSlot0AntiRepeatSwap(final, {
      recentSlot0CleanCoreEntryIds: new Set(["ng_clean_001"]),
    });
    expect(r.swapped).toBe(false);
    expect(r.final).toBe(final);
  });

  it("(5) does NOT swap when the alternative has no resolvable cleanCoreEntryId", () => {
    const final = [
      cleanCand("ng_clean_001"),
      // Hook crafted to not match any clean-core hook.
      nonCleanCand("hand-authored hook with no entry mapping."),
    ];
    const r = applyNgCleanSlot0AntiRepeatSwap(final, {
      recentSlot0CleanCoreEntryIds: new Set(["ng_clean_001"]),
    });
    expect(r.swapped).toBe(false);
  });

  it("(6) does NOT swap when no alternative exists (single candidate)", () => {
    const final = [cleanCand("ng_clean_001")];
    const r = applyNgCleanSlot0AntiRepeatSwap(final, {
      recentSlot0CleanCoreEntryIds: new Set(["ng_clean_001"]),
    });
    expect(r.swapped).toBe(false);
    expect(r.final).toBe(final);
  });

  it("(6b) does NOT swap when EVERY candidate is in recent memory", () => {
    const final = [
      cleanCand("ng_clean_001"),
      cleanCand("ng_clean_039"),
      cleanCand("ng_clean_002"),
    ];
    const r = applyNgCleanSlot0AntiRepeatSwap(final, {
      recentSlot0CleanCoreEntryIds: new Set([
        "ng_clean_001",
        "ng_clean_039",
        "ng_clean_002",
      ]),
    });
    expect(r.swapped).toBe(false);
    expect(r.final).toBe(final);
  });

  it("(7) preserves candidate count and identity set across a swap", () => {
    const final = [
      cleanCand("ng_clean_001"),
      nonCleanCand("filler a", { pickerEligible: false }),
      nonCleanCand("filler b", { pickerEligible: false }),
      cleanCand("ng_clean_039"),
      nonCleanCand("filler c", { pickerEligible: false }),
    ];
    const r = applyNgCleanSlot0AntiRepeatSwap(final, {
      recentSlot0CleanCoreEntryIds: new Set(["ng_clean_001"]),
    });
    expect(r.swapped).toBe(true);
    expect(r.final.length).toBe(final.length);
    const before = final.map((c) => c.idea.hook).sort();
    const after = r.final.map((c) => c.idea.hook).sort();
    expect(after).toEqual(before);
  });

  it("(8) does not mutate the input array", () => {
    const final = [
      cleanCand("ng_clean_001"),
      cleanCand("ng_clean_039"),
      cleanCand("ng_clean_002"),
    ];
    const before = final.map((c) => c.idea.hook);
    const r = applyNgCleanSlot0AntiRepeatSwap(final, {
      recentSlot0CleanCoreEntryIds: new Set(["ng_clean_001"]),
    });
    expect(r.swapped).toBe(true);
    expect(final.map((c) => c.idea.hook)).toEqual(before);
    // And the returned array is a fresh reference when a swap fires.
    expect(r.final).not.toBe(final);
  });

  it("(10) is a no-op when the candidate list contains no clean-core entries (non-ng_clean cohort)", () => {
    const final = [
      nonCleanCand("western pattern hook 1"),
      nonCleanCand("western pattern hook 2"),
      nonCleanCand("western pattern hook 3"),
    ];
    const r = applyNgCleanSlot0AntiRepeatSwap(final, {
      recentSlot0CleanCoreEntryIds: new Set(["ng_clean_001", "ng_clean_039"]),
    });
    expect(r.swapped).toBe(false);
    expect(r.final).toBe(final);
  });

  it("(11) picks the HIGHEST-ranked (lowest index) eligible alternative when multiple exist", () => {
    const final = [
      cleanCand("ng_clean_001"),
      // Two clean-core alts both eligible + both not in memory; the
      // lower-index one (ng_clean_039) must win.
      cleanCand("ng_clean_039"),
      cleanCand("ng_clean_002"),
    ];
    const r = applyNgCleanSlot0AntiRepeatSwap(final, {
      recentSlot0CleanCoreEntryIds: new Set(["ng_clean_001"]),
    });
    expect(r.swapped).toBe(true);
    expect(r.detail?.toCleanCoreEntryId).toBe("ng_clean_039");
    expect(r.detail?.fromIndex).toBe(1);
  });

  it("(12) skips a recent alternative and picks the next eligible one", () => {
    const final = [
      cleanCand("ng_clean_001"),
      cleanCand("ng_clean_039"), // also recent ⇒ skip
      cleanCand("ng_clean_002"), // not recent ⇒ winner
    ];
    const r = applyNgCleanSlot0AntiRepeatSwap(final, {
      recentSlot0CleanCoreEntryIds: new Set(["ng_clean_001", "ng_clean_039"]),
    });
    expect(r.swapped).toBe(true);
    expect(r.detail?.toCleanCoreEntryId).toBe("ng_clean_002");
    expect(r.detail?.fromIndex).toBe(2);
  });

  it("(safety regression) refuses to swap a decorated non-clean hook into slot 0", () => {
    // The alt is a hook that would have falsely resolved under the
    // prior `includes/startsWith` substring fallback. Strict
    // equality means the resolver returns null ⇒ alt is ineligible
    // ⇒ no swap.
    const cleanHook = NIGERIAN_CLEAN_CORE_ENTRIES[0]!.hook;
    const final = [
      cleanCand("ng_clean_001"),
      nonCleanCand(`${cleanHook} and then everything went sideways`),
    ];
    const r = applyNgCleanSlot0AntiRepeatSwap(final, {
      recentSlot0CleanCoreEntryIds: new Set(["ng_clean_001"]),
    });
    expect(r.swapped).toBe(false);
    expect(r.final).toBe(final);
  });

  it("(13) deterministic: same input + same memory ⇒ same result", () => {
    const final = [
      cleanCand("ng_clean_001"),
      cleanCand("ng_clean_039"),
      cleanCand("ng_clean_002"),
    ];
    const memory = new Set(["ng_clean_001"]);
    const a = applyNgCleanSlot0AntiRepeatSwap(final, {
      recentSlot0CleanCoreEntryIds: memory,
    });
    const b = applyNgCleanSlot0AntiRepeatSwap(final, {
      recentSlot0CleanCoreEntryIds: memory,
    });
    expect(a.detail).toEqual(b.detail);
    expect(a.final.map((c) => c.idea.hook)).toEqual(
      b.final.map((c) => c.idea.hook),
    );
  });
});
