/**
 * PHASE N1 — additive `languageStyle` + `slangIntensity` field tests.
 *
 * Pins:
 *   • pre-N1 docs (no languageStyle / slangIntensity keys) parse with
 *     defaults `null` and `0` — backward compatibility intact.
 *   • new docs with valid values round-trip cleanly.
 *   • invalid enum values reject (so a poisoned client cannot push
 *     "deep_pidgin" / 999 etc.).
 *   • parseTasteCalibration returns the same defaults on partial
 *     legacy docs.
 */

import { describe, expect, it } from "vitest";

import {
  parseTasteCalibration,
  tasteCalibrationSchema,
} from "../tasteCalibration.js";

describe("N1 — tasteCalibrationSchema additive fields", () => {
  it("parses a pre-N1 doc with defaults applied", () => {
    const out = tasteCalibrationSchema.parse({
      preferredFormats: ["mini_story"],
      preferredTone: "dry_subtle",
      effortPreference: "low_effort",
    });
    expect(out.languageStyle).toBe(null);
    expect(out.slangIntensity).toBe(0);
  });

  it("parses an empty object (the most extreme legacy case)", () => {
    const out = tasteCalibrationSchema.parse({});
    expect(out.languageStyle).toBe(null);
    expect(out.slangIntensity).toBe(0);
    expect(out.preferredFormats).toEqual([]);
  });

  it("round-trips a doc with explicit clean languageStyle", () => {
    const out = tasteCalibrationSchema.parse({ languageStyle: "clean" });
    expect(out.languageStyle).toBe("clean");
  });

  it("round-trips light_pidgin", () => {
    const out = tasteCalibrationSchema.parse({
      languageStyle: "light_pidgin",
      slangIntensity: 1,
    });
    expect(out.languageStyle).toBe("light_pidgin");
    expect(out.slangIntensity).toBe(1);
  });

  it("round-trips pidgin + slangIntensity 2", () => {
    const out = tasteCalibrationSchema.parse({
      languageStyle: "pidgin",
      slangIntensity: 2,
    });
    expect(out.languageStyle).toBe("pidgin");
    expect(out.slangIntensity).toBe(2);
  });

  it("rejects an unknown languageStyle value", () => {
    expect(() =>
      tasteCalibrationSchema.parse({ languageStyle: "deep_pidgin" }),
    ).toThrow();
  });

  it("rejects out-of-band slangIntensity", () => {
    expect(() =>
      tasteCalibrationSchema.parse({ slangIntensity: 5 }),
    ).toThrow();
    expect(() =>
      tasteCalibrationSchema.parse({ slangIntensity: -1 }),
    ).toThrow();
  });

  it("rejects fractional slangIntensity", () => {
    expect(() =>
      tasteCalibrationSchema.parse({ slangIntensity: 1.5 }),
    ).toThrow();
  });

  it("parseTasteCalibration tolerates partial legacy docs", () => {
    const parsed = parseTasteCalibration({
      preferredFormats: ["pov"],
      skipped: false,
    });
    expect(parsed?.languageStyle).toBe(null);
    expect(parsed?.slangIntensity).toBe(0);
  });

  it("parseTasteCalibration returns null on garbage input", () => {
    expect(parseTasteCalibration(null)).toBe(null);
    expect(parseTasteCalibration("not a doc")).toBe(null);
    expect(parseTasteCalibration(42)).toBe(null);
  });

  it("parseTasteCalibration preserves new fields on valid input", () => {
    const parsed = parseTasteCalibration({
      languageStyle: "light_pidgin",
      slangIntensity: 1,
    });
    expect(parsed?.languageStyle).toBe("light_pidgin");
    expect(parsed?.slangIntensity).toBe(1);
  });
});
