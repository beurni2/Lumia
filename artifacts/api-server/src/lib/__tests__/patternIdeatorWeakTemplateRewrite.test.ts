/**
 * PHASE W2-AUTHOR HYBRID — patternIdeator weak-template rewrite.
 *
 * Verifies the two HOW_TO_FILM_BY_VISUAL_ACTION templates that
 * previously emitted "Single static shot" / "Single locked-off
 * shot" boilerplate now emit V2-grammar copy:
 *
 *   - phone_scroll_freeze
 *   - face_reaction_deadpan
 *
 * Asserts (a) no banned phrase per WTS_HTF_BANNED_RE, (b) length
 * inside the schema window 15–400, (c) deterministic output for
 * the same scenario input, (d) concrete framing/action language
 * is preserved (face / phone / frame).
 *
 * The other 11 templates are NOT in scope of this rewrite and are
 * intentionally not asserted here.
 */

import { describe, expect, it } from "vitest";

import { HOW_TO_FILM_BY_VISUAL_ACTION } from "../patternIdeator";
import { WTS_HTF_BANNED_RE } from "../wtsHtfQualityGate";

// Minimal Scenario shim — the rewritten templates do not read any
// scenario field, so an empty stub is sufficient. The cast keeps
// the compiler happy without importing the internal Scenario
// type.
const STUB_SCENARIO = {
  topicNoun: "kitchen",
  settingDetail: "kitchen counter at golden hour",
  family: "self_betrayal",
} as unknown as Parameters<
  typeof HOW_TO_FILM_BY_VISUAL_ACTION.phone_scroll_freeze
>[0];

describe("HOW_TO_FILM_BY_VISUAL_ACTION rewrite — phone_scroll_freeze", () => {
  const out = HOW_TO_FILM_BY_VISUAL_ACTION.phone_scroll_freeze(STUB_SCENARIO);

  it("emits no banned-phrase boilerplate", () => {
    expect(WTS_HTF_BANNED_RE.test(out)).toBe(false);
  });

  it("falls inside the howToFilm schema length window 15–400", () => {
    expect(out.length).toBeGreaterThanOrEqual(15);
    expect(out.length).toBeLessThanOrEqual(400);
  });

  it("is deterministic across calls", () => {
    const again = HOW_TO_FILM_BY_VISUAL_ACTION.phone_scroll_freeze(STUB_SCENARIO);
    expect(again).toBe(out);
  });

  it("preserves concrete framing/action vocabulary", () => {
    expect(out.toLowerCase()).toContain("phone");
    expect(out.toLowerCase()).toContain("face");
    expect(out.toLowerCase()).toMatch(/scroll|freeze|hover/);
  });
});

describe("HOW_TO_FILM_BY_VISUAL_ACTION rewrite — face_reaction_deadpan", () => {
  const out = HOW_TO_FILM_BY_VISUAL_ACTION.face_reaction_deadpan(
    STUB_SCENARIO,
  );

  it("emits no banned-phrase boilerplate", () => {
    expect(WTS_HTF_BANNED_RE.test(out)).toBe(false);
  });

  it("falls inside the howToFilm schema length window 15–400", () => {
    expect(out.length).toBeGreaterThanOrEqual(15);
    expect(out.length).toBeLessThanOrEqual(400);
  });

  it("is deterministic across calls", () => {
    const again = HOW_TO_FILM_BY_VISUAL_ACTION.face_reaction_deadpan(
      STUB_SCENARIO,
    );
    expect(again).toBe(out);
  });

  it("preserves face-emphasis / silence vocabulary", () => {
    expect(out.toLowerCase()).toContain("face");
    expect(out.toLowerCase()).toMatch(/background|still|barely|small/);
  });
});
