// PHASE N1-CLEAN-CORE-P1.1 — rotation/diversity tests for the
// per-core windowed clean-core picker in `coreCandidateGenerator`.
//
// Asserts:
// 1. Same (region, languageStyle, salt, cores) → identical
//    candidate hooks (deterministic).
// 2. Across 5 salts × 6 cores the runtime probe surfaces ≥10
//    distinct clean-core ids (preferred ≥15) — exercises both the
//    `*7`/`*11` window-start mix and the stride-7 in-window
//    sampling.
// 3. No two cores in the same batch ship the same clean-core
//    entry (intra-batch entry dedup).
// 4. Non-activation cohorts surface 0 clean-core entries.
// 5. Activation cohort delivery share ≥80% of the per-core slots.
import { describe, expect, it } from "vitest";
import {
  generateCoreCandidates,
  type GenerateCoreCandidatesInput,
} from "../coreCandidateGenerator.js";
import { PREMISE_CORES } from "../premiseCoreLibrary.js";
import { NIGERIAN_CLEAN_CORE_ENTRIES } from "../nigerianCleanCorePack.js";

const cleanHookSet = new Set(NIGERIAN_CLEAN_CORE_ENTRIES.map((e) => e.hook));
const cleanHookToId = new Map(
  NIGERIAN_CLEAN_CORE_ENTRIES.map((e) => [e.hook, e.id] as const),
);

function buildInput(
  region: string | undefined,
  languageStyle: "clean" | "pidgin" | "light_pidgin" | null,
  salt: number,
): GenerateCoreCandidatesInput {
  return {
    cores: PREMISE_CORES.slice(0, 6),
    count: 6,
    regenerateSalt: salt,
    ...(region
      ? { region: region as GenerateCoreCandidatesInput["region"] }
      : {}),
    tasteCalibration: languageStyle
      ? ({ languageStyle } as GenerateCoreCandidatesInput["tasteCalibration"])
      : null,
  };
}

function shippedHooks(
  region: string | undefined,
  languageStyle: "clean" | "pidgin" | "light_pidgin" | null,
  salts: number[],
): string[] {
  const hooks: string[] = [];
  for (const salt of salts) {
    const out = generateCoreCandidates(buildInput(region, languageStyle, salt));
    for (const c of out.candidates) hooks.push(c.idea.hook);
  }
  return hooks;
}

describe("N1-CLEAN-CORE-P1.1 — windowed picker rotation", () => {
  it("is deterministic for the same (region, style, salt, cores)", () => {
    const a = shippedHooks("nigeria", "clean", [0]);
    const b = shippedHooks("nigeria", "clean", [0]);
    expect(a).toEqual(b);
  });

  it("ships clean-core for ≥80% of per-core slots in the activated cohort", () => {
    const hooks = shippedHooks("nigeria", "clean", [0, 1, 2, 3, 4]);
    const total = hooks.length;
    const cleanCount = hooks.filter((h) => cleanHookSet.has(h)).length;
    expect(total).toBeGreaterThan(0);
    expect(cleanCount / total).toBeGreaterThanOrEqual(0.8);
  });

  it("surfaces ≥10 distinct clean-core ids across 5 salts × 6 cores (preferred ≥15)", () => {
    const hooks = shippedHooks("nigeria", "clean", [0, 1, 2, 3, 4]);
    const ids = hooks
      .map((h) => cleanHookToId.get(h))
      .filter((x): x is string => Boolean(x));
    const distinct = new Set(ids);
    expect(distinct.size).toBeGreaterThanOrEqual(10);
    // Soft assertion of the preferred target — fail loud if a
    // future change degrades distinct coverage below the level
    // shipped at P1.1.
    expect(distinct.size).toBeGreaterThanOrEqual(15);
  });

  it("never ships the same clean-core entry twice in a single batch", () => {
    for (const salt of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const hooks = shippedHooks("nigeria", "clean", [salt]);
      const ids = hooks
        .map((h) => cleanHookToId.get(h))
        .filter((x): x is string => Boolean(x));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("does not leak clean-core hooks into non-activation cohorts", () => {
    const cohorts: Array<
      [string | undefined, "clean" | "pidgin" | "light_pidgin" | null]
    > = [
      ["nigeria", "pidgin"],
      ["nigeria", "light_pidgin"],
      ["nigeria", null],
      ["western", "clean"],
      ["india", "clean"],
      ["philippines", "clean"],
    ];
    for (const [region, ls] of cohorts) {
      const hooks = shippedHooks(region, ls, [0, 1, 2]);
      const leaks = hooks.filter((h) => cleanHookSet.has(h));
      expect(leaks.length).toBe(0);
    }
  });
});
