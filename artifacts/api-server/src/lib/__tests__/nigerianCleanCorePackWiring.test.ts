/**
 * PHASE N1-CLEAN-CORE-P1 (BI-CLEAN 2026-05-09) — runtime wiring probe.
 *
 * Verifies the clean-core block in `coreCandidateGenerator.ts` is
 * correctly gated by `canActivateNigerianCleanCorePack`:
 *
 *   1. nigeria + clean → clean-core hooks DO surface in passing[]
 *      (at least one of the 60 hand-authored hooks; P1: 30 + P2: 30).
 *   2. nigeria + pidgin → no clean-core hooks (Pidgin pack path
 *      is mutually exclusive; clean-core gate returns false).
 *   3. nigeria + light_pidgin → no clean-core hooks.
 *   4. nigeria + null languageStyle → no clean-core hooks.
 *   5. western + clean → no clean-core hooks (region gate).
 *   6. india + clean → no clean-core hooks (region gate).
 *   7. philippines + clean → no clean-core hooks (region gate).
 *
 * The probe operates on real `PREMISE_CORES` and the real
 * `NIGERIAN_CLEAN_CORE_ENTRIES`; it does not stub validators.
 */
import { describe, expect, it } from "vitest";
import {
  generateCoreCandidates,
  type GenerateCoreCandidatesInput,
} from "../coreCandidateGenerator.js";
import { PREMISE_CORES } from "../premiseCoreLibrary.js";
import { NIGERIAN_CLEAN_CORE_ENTRIES } from "../nigerianCleanCorePack.js";

const CLEAN_CORE_HOOK_SET: ReadonlySet<string> = new Set(
  NIGERIAN_CLEAN_CORE_ENTRIES.map((e) => e.hook),
);

function buildInput(
  region: string | undefined,
  languageStyle: "clean" | "pidgin" | "light_pidgin" | null,
): GenerateCoreCandidatesInput {
  return {
    cores: PREMISE_CORES.slice(0, 6),
    count: 6,
    regenerateSalt: 11,
    ...(region ? { region: region as GenerateCoreCandidatesInput["region"] } : {}),
    tasteCalibration: languageStyle
      ? ({ languageStyle } as GenerateCoreCandidatesInput["tasteCalibration"])
      : null,
  };
}

function countCleanCoreHooks(
  out: ReturnType<typeof generateCoreCandidates>,
): number {
  return out.candidates.filter((c) => CLEAN_CORE_HOOK_SET.has(c.idea.hook))
    .length;
}

describe("N1-CLEAN-CORE-P1 — runtime wiring gate", () => {
  it("nigeria + clean: at least one clean-core hook surfaces", () => {
    const out = generateCoreCandidates(buildInput("nigeria", "clean"));
    expect(out.candidates.length).toBeGreaterThan(0);
    expect(countCleanCoreHooks(out)).toBeGreaterThan(0);
  });

  it("nigeria + pidgin: no clean-core hook surfaces", () => {
    const out = generateCoreCandidates(buildInput("nigeria", "pidgin"));
    expect(countCleanCoreHooks(out)).toBe(0);
  });

  it("nigeria + light_pidgin: no clean-core hook surfaces", () => {
    const out = generateCoreCandidates(buildInput("nigeria", "light_pidgin"));
    expect(countCleanCoreHooks(out)).toBe(0);
  });

  it("nigeria + null languageStyle: no clean-core hook surfaces", () => {
    const out = generateCoreCandidates(buildInput("nigeria", null));
    expect(countCleanCoreHooks(out)).toBe(0);
  });

  it("western + clean: no clean-core hook surfaces", () => {
    const out = generateCoreCandidates(buildInput("western", "clean"));
    expect(countCleanCoreHooks(out)).toBe(0);
  });

  it("india + clean: no clean-core hook surfaces", () => {
    const out = generateCoreCandidates(buildInput("india", "clean"));
    expect(countCleanCoreHooks(out)).toBe(0);
  });

  it("philippines + clean: no clean-core hook surfaces", () => {
    const out = generateCoreCandidates(buildInput("philippines", "clean"));
    expect(countCleanCoreHooks(out)).toBe(0);
  });

  it("nigeria + clean: every shipped clean-core idea has source=core_native", () => {
    const out = generateCoreCandidates(buildInput("nigeria", "clean"));
    const cleanCoreShipped = out.candidates.filter((c) =>
      CLEAN_CORE_HOOK_SET.has(c.idea.hook),
    );
    expect(cleanCoreShipped.length).toBeGreaterThan(0);
    for (const c of cleanCoreShipped) {
      expect(c.meta.source).toBe("core_native");
    }
  });
});
