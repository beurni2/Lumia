/**
 * PHASE Z5b — 4 new fine-grained PremiseStyleIds registration tests.
 *
 * Pins the additive contract for the new ids:
 *
 *   1. Each id is in `PREMISE_STYLE_IDS`, has a def in
 *      `PREMISE_STYLE_DEFS`, and a label in `PREMISE_STYLE_LABELS`.
 *   2. Each def points to a valid existing parent BigPremiseStyle
 *      bucket and ships ≥3 executions.
 *   3. Every example renders cleanly through the three premise-line
 *      validators (`validateBigPremise`, `validateHook`,
 *      `validateOutputLine`) — no validator loosening was needed.
 *   4. Each id is wired into the four pattern/intent/language maps
 *      AND `MECHANISM_TO_STYLES` (the defaultTasteProfile mech
 *      booster), so every downstream lever sees them.
 */
import { describe, it, expect } from "vitest";
import {
  PREMISE_STYLE_IDS,
  PREMISE_STYLE_DEFS,
  PREMISE_STYLE_LABELS,
  PREMISESTYLE_TO_PATTERN_MAP,
  PREMISE_PATTERN_SYNERGY_MAP,
  PREMISESTYLE_TO_HOOKINTENT_PREFERENCE,
  PREMISESTYLE_TO_HOOKLANGUAGE_PREFERENCE,
  BIG_PREMISE_STYLES,
  validateBigPremise,
  validateHook,
  validateOutputLine,
  type PremiseStyleId,
} from "../patternIdeator.js";
import { MECHANISM_TO_STYLES } from "../defaultTasteProfile.js";

const NEW_IDS = [
  "self_roast_escalation",
  "expectation_subversion",
  "quiet_punchline",
  "spiral_confession",
] as const satisfies readonly PremiseStyleId[];

const VALID_BUCKETS = new Set<string>(BIG_PREMISE_STYLES);

describe("Z5b — 4 new PremiseStyleIds registration", () => {
  it.each(NEW_IDS)("%s is in PREMISE_STYLE_IDS, DEFS, and LABELS", (id) => {
    expect(PREMISE_STYLE_IDS).toContain(id);
    expect(PREMISE_STYLE_DEFS[id]).toBeDefined();
    expect(typeof PREMISE_STYLE_LABELS[id]).toBe("string");
    expect(PREMISE_STYLE_LABELS[id].length).toBeGreaterThan(0);
  });

  it.each(NEW_IDS)("%s def has valid parentBucket + ≥3 executions", (id) => {
    const def = PREMISE_STYLE_DEFS[id];
    expect(VALID_BUCKETS.has(def.parentBucket)).toBe(true);
    expect(def.executions.length).toBeGreaterThanOrEqual(3);
    for (const exec of def.executions) {
      expect(exec.id.length).toBeGreaterThan(0);
      expect(exec.example.length).toBeGreaterThan(0);
    }
  });

  it.each(NEW_IDS)(
    "%s every execution example passes premise/hook/output validators",
    (id) => {
      const def = PREMISE_STYLE_DEFS[id];
      const failures: { exec: string; example: string; failed: string[] }[] = [];
      for (const exec of def.executions) {
        const failed: string[] = [];
        if (!validateBigPremise(exec.example)) failed.push("validateBigPremise");
        if (!validateHook(exec.example)) failed.push("validateHook");
        if (!validateOutputLine(exec.example)) failed.push("validateOutputLine");
        if (failed.length > 0) {
          failures.push({ exec: exec.id, example: exec.example, failed });
        }
      }
      expect(
        failures,
        `examples failing validators:\n${failures
          .map((f) => `  ${f.exec}: "${f.example}" → ${f.failed.join(", ")}`)
          .join("\n")}`,
      ).toEqual([]);
    },
  );

  it.each(NEW_IDS)("%s appears in all 4 alignment maps", (id) => {
    expect(PREMISESTYLE_TO_PATTERN_MAP[id]?.length).toBeGreaterThan(0);
    expect(Object.keys(PREMISE_PATTERN_SYNERGY_MAP[id] ?? {}).length)
      .toBeGreaterThan(0);
    expect(PREMISESTYLE_TO_HOOKINTENT_PREFERENCE[id]?.length).toBeGreaterThan(0);
    expect(PREMISESTYLE_TO_HOOKLANGUAGE_PREFERENCE[id]?.length).toBeGreaterThan(
      0,
    );
  });

  it.each(NEW_IDS)("%s is registered under at least one mechanism", (id) => {
    const allMechStyles = (
      Object.values(MECHANISM_TO_STYLES) as ReadonlyArray<readonly string[]>
    ).flat();
    expect(allMechStyles).toContain(id);
  });
});
