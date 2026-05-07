/**
 * PHASE N1-LIVE-HARDEN F1 — request-scoped languageStyle override tests.
 *
 * Exercises:
 *   1. The route's body-schema accepts/rejects the override correctly.
 *   2. The pure `buildOverriddenTasteCalibration` helper that the
 *      handler uses to merge the override into the persisted
 *      calibration — verifies the merge is request-scoped (the
 *      persisted object is never mutated) and that omitted overrides
 *      forward the persisted document by reference (zero-cost path).
 *
 * The full HTTP path is not exercised here — supertest is not a
 * dependency and the rest of the handler depends on db / clerk /
 * quota wiring that is covered by the live QA harness instead.
 */

import { describe, it, expect } from "vitest";
import {
  ideatorGenerateBodySchema,
  buildOverriddenTasteCalibration,
} from "../ideator";

describe("F1 — bodySchema languageStyle field", () => {
  it("omits → field stays undefined", () => {
    const out = ideatorGenerateBodySchema.parse({ region: "nigeria" });
    expect(out.languageStyle).toBeUndefined();
  });

  it("accepts null", () => {
    const out = ideatorGenerateBodySchema.parse({
      region: "nigeria",
      languageStyle: null,
    });
    expect(out.languageStyle).toBe(null);
  });

  it("accepts clean", () => {
    expect(
      ideatorGenerateBodySchema.parse({
        region: "nigeria",
        languageStyle: "clean",
      }).languageStyle,
    ).toBe("clean");
  });

  it("accepts light_pidgin", () => {
    expect(
      ideatorGenerateBodySchema.parse({
        region: "nigeria",
        languageStyle: "light_pidgin",
      }).languageStyle,
    ).toBe("light_pidgin");
  });

  it("accepts pidgin", () => {
    expect(
      ideatorGenerateBodySchema.parse({
        region: "nigeria",
        languageStyle: "pidgin",
      }).languageStyle,
    ).toBe("pidgin");
  });

  it("rejects invalid enum values", () => {
    const out = ideatorGenerateBodySchema.safeParse({
      region: "nigeria",
      languageStyle: "deep_pidgin",
    });
    expect(out.success).toBe(false);
  });

  it("rejects integer / wrong-type values", () => {
    expect(
      ideatorGenerateBodySchema.safeParse({
        region: "nigeria",
        languageStyle: 1,
      }).success,
    ).toBe(false);
  });
});

describe("F1 — buildOverriddenTasteCalibration", () => {
  it("returns persisted UNCHANGED when override is undefined (zero-cost path)", () => {
    const persisted = { preferredFormats: ["mini_story"], languageStyle: "pidgin" };
    const out = buildOverriddenTasteCalibration(persisted, undefined);
    expect(out).toBe(persisted); // referential identity — no copy
  });

  it("override 'clean' replaces persisted 'pidgin' but does not mutate persisted", () => {
    const persisted = {
      preferredFormats: ["mini_story"],
      languageStyle: "pidgin",
      slangIntensity: 2,
    };
    const out = buildOverriddenTasteCalibration(persisted, "clean") as Record<
      string,
      unknown
    >;
    expect(out.languageStyle).toBe("clean");
    expect(out.preferredFormats).toEqual(["mini_story"]);
    expect(out.slangIntensity).toBe(2);
    expect(out).not.toBe(persisted);
    // Persisted source-of-truth remains 'pidgin' (request-scoped).
    expect(persisted.languageStyle).toBe("pidgin");
  });

  it("override 'null' is a valid disable signal — passes through to merged doc", () => {
    const persisted = { languageStyle: "pidgin" };
    const out = buildOverriddenTasteCalibration(persisted, null) as Record<
      string,
      unknown
    >;
    expect(out.languageStyle).toBe(null);
    expect(persisted.languageStyle).toBe("pidgin");
  });

  it("override on null persisted (cold-start creator) returns minimal doc", () => {
    const out = buildOverriddenTasteCalibration(null, "light_pidgin") as Record<
      string,
      unknown
    >;
    expect(out).toEqual({ languageStyle: "light_pidgin" });
  });

  it("override on undefined persisted returns minimal doc", () => {
    const out = buildOverriddenTasteCalibration(
      undefined,
      "pidgin",
    ) as Record<string, unknown>;
    expect(out).toEqual({ languageStyle: "pidgin" });
  });

  it("override on non-object persisted (defensive) returns minimal doc", () => {
    const out = buildOverriddenTasteCalibration(42, "clean") as Record<
      string,
      unknown
    >;
    expect(out).toEqual({ languageStyle: "clean" });
  });

  it("override does NOT alter unrelated keys", () => {
    const persisted = {
      preferredTone: "dry_subtle",
      preferredFormats: ["reaction"],
      slangIntensity: 1,
      languageStyle: "pidgin",
    };
    const out = buildOverriddenTasteCalibration(
      persisted,
      "clean",
    ) as Record<string, unknown>;
    expect(out.preferredTone).toBe("dry_subtle");
    expect(out.preferredFormats).toEqual(["reaction"]);
    expect(out.slangIntensity).toBe(1);
    expect(out.languageStyle).toBe("clean");
  });
});
