/**
 * PHASE W2-A — unit tests for the Western draft hook pack
 * dark-infrastructure integrity checker.
 *
 * Spec: "empty draft passes; duplicate hooks fail; weak skeletons
 * fail; invalid reviewedBy fails; invalid category fails; generic
 * object scenario fails; valid sample row passes."
 *
 * NOT covered (out of W2-A scope): runtime activation, slot
 * reservation, scoring, API surface — none of those exist for the
 * Western pack yet.
 */

import { describe, it, expect } from "vitest";
import {
  PENDING_EDITORIAL_REVIEW,
  WESTERN_HOOK_PACK_DRAFT,
  WESTERN_DRAFT_WEAK_SKELETON_PATTERNS,
  WESTERN_COMEDY_FAMILIES,
  WESTERN_EMOTIONAL_SPIKES,
  WESTERN_SETTINGS,
  checkWesternHookPackDraftIntegrity,
  type WesternHookPackDraftEntry,
} from "../westernHookPack.js";

const VALID: WesternHookPackDraftEntry = {
  id: "w_001",
  hook: "opening the fridge like new food spawned",
  whatToShow:
    "Walk to the fridge, open it, scan every shelf with intent, mouth the word 'wait', then close it without taking anything.",
  howToFilm: "Counter-level lock-off, daylight, one take.",
  caption: "denial level: kitchen.",
  anchor: "fridge",
  comedyFamily: "denial_loop",
  emotionalSpike: "shame",
  setting: "kitchen",
  reviewedBy: PENDING_EDITORIAL_REVIEW,
};

describe("W2-A — corpus shape (dark)", () => {
  it("WESTERN_HOOK_PACK_DRAFT is a frozen array with the imported W2-Batch-A entries", () => {
    // PHASE W2-Batch-A imported the first 50 authored draft entries.
    // The corpus is still DARK (no runtime path imports it); this test
    // asserts the shape, not emptiness.
    expect(Object.isFrozen(WESTERN_HOOK_PACK_DRAFT)).toBe(true);
    expect(WESTERN_HOOK_PACK_DRAFT.length).toBeGreaterThanOrEqual(50);
    // All draft rows must carry the editorial-review sentinel.
    for (const e of WESTERN_HOOK_PACK_DRAFT) {
      expect(e.reviewedBy).toBe(PENDING_EDITORIAL_REVIEW);
    }
    // Stable id range from the W2-Batch-A brief.
    const ids = WESTERN_HOOK_PACK_DRAFT.map((e) => e.id);
    expect(ids).toContain("W2A-001");
    expect(ids).toContain("W2A-050");
    expect(new Set(ids).size).toBe(ids.length); // no duplicate ids
  });
  it("draft hook layer (dupes, weak skeletons, scenario, privacy) is clean", () => {
    // The W2-Batch-A entries fail vocabulary validation (the W2-A
    // taxonomies need to be widened — pending reviewer adjudication),
    // but the HOOK-LAYER checks (duplicates, weak banned skeletons,
    // generic scenarios, obvious privacy patterns) must already pass.
    const r = checkWesternHookPackDraftIntegrity(WESTERN_HOOK_PACK_DRAFT);
    expect(r.duplicateHookFingerprints, "no duplicate hooks").toEqual([]);
    expect(r.weakSkeletonHits.size, "no weak banned skeletons").toBe(0);
    expect(r.privacyFailures, "no obvious privacy hits").toEqual([]);
    expect(
      r.failures.filter((f) => f.code === "generic_object_scenario"),
      "no generic set/stare/walkaway scenarios",
    ).toEqual([]);
    expect(
      r.failures.filter((f) => f.code.endsWith("_length")),
      "no length-band failures",
    ).toEqual([]);
    expect(
      r.failures.filter((f) => f.code === "anchor_invalid"),
      "no anchor failures",
    ).toEqual([]);
    expect(
      r.failures.filter((f) => f.code === "reviewed_by_invalid"),
      "no reviewedBy failures",
    ).toEqual([]);
  });
  it("an explicitly-empty pack still passes the integrity check", () => {
    // Sanity: the checker must still treat an empty pack as ok so
    // future cohorts/authoring milestones can re-test in isolation.
    const r = checkWesternHookPackDraftIntegrity([]);
    expect(r.ok).toBe(true);
    expect(r.failures).toHaveLength(0);
  });
});

describe("W2-A — checkWesternHookPackDraftIntegrity per-entry rules", () => {
  it("a valid sample row passes", () => {
    const r = checkWesternHookPackDraftIntegrity([VALID]);
    expect(r.ok).toBe(true);
    expect(r.failures).toHaveLength(0);
  });

  it("duplicate hooks fail", () => {
    const r = checkWesternHookPackDraftIntegrity([
      VALID,
      { ...VALID, id: "w_002" },
    ]);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.code === "duplicate_hook_exact")).toBe(true);
    expect(r.duplicateHookFingerprints.length).toBeGreaterThan(0);
  });

  it("near-duplicate hook skeletons fail (long-token collapse)", () => {
    const r = checkWesternHookPackDraftIntegrity([
      VALID,
      {
        // Same long-token-collapsed skeleton as VALID:
        // "__ the __ like new food __" (long ≥5 → "__", short kept).
        ...VALID,
        id: "w_002",
        hook: "checking the kitchen like new food existed",
        anchor: "kitchen",
      },
    ]);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.code === "duplicate_hook_skeleton")).toBe(
      true,
    );
  });

  it("weak banned skeletons fail (one example per pattern)", () => {
    for (const w of WESTERN_DRAFT_WEAK_SKELETON_PATTERNS) {
      const exemplar: Record<string, string> = {
        totally_fine_about_anchor: "I am totally fine about the inbox",
        anchor_knows_im_lying: "the inbox knows i'm lying",
        someone_explain_anchor_now: "someone explain the inbox to me. NOW",
        anchor_won_obviously: "the inbox won. obviously.",
        anchor_itself_became: "the inbox itself became my villain arc",
        anchor_flatlined_my_whole_week:
          "the inbox flatlined my whole week",
        body_quit_brain_screaming: "my body quit. my brain kept screaming",
      };
      const hook = exemplar[w.id];
      expect(hook, `missing exemplar for ${w.id}`).toBeTruthy();
      const r = checkWesternHookPackDraftIntegrity([
        { ...VALID, hook, id: `w_${w.id}` },
      ]);
      expect(
        r.failures.some((f) => f.code === "weak_banned_skeleton"),
        `weak skeleton ${w.id} should fail on hook '${hook}'`,
      ).toBe(true);
    }
  });

  it("invalid reviewedBy fails (anything other than PENDING_EDITORIAL_REVIEW)", () => {
    const r = checkWesternHookPackDraftIntegrity([
      { ...VALID, reviewedBy: "BI 2026-05-07" as never },
    ]);
    expect(r.failures.some((f) => f.code === "reviewed_by_invalid")).toBe(true);
    const r2 = checkWesternHookPackDraftIntegrity([
      { ...VALID, reviewedBy: "" as never },
    ]);
    expect(r2.failures.some((f) => f.code === "reviewed_by_invalid")).toBe(
      true,
    );
  });

  it("invalid comedyFamily / emotionalSpike / setting fails", () => {
    const r = checkWesternHookPackDraftIntegrity([
      {
        ...VALID,
        comedyFamily: "made_up_family" as never,
      },
    ]);
    expect(r.failures.some((f) => f.code === "comedy_family_invalid")).toBe(
      true,
    );
    const r2 = checkWesternHookPackDraftIntegrity([
      { ...VALID, emotionalSpike: "ennui" as never },
    ]);
    expect(r2.failures.some((f) => f.code === "emotional_spike_invalid")).toBe(
      true,
    );
    const r3 = checkWesternHookPackDraftIntegrity([
      { ...VALID, setting: "rooftop" as never },
    ]);
    expect(r3.failures.some((f) => f.code === "setting_invalid")).toBe(true);
  });

  it("generic 'set X down / stare / walk away' scenario fails", () => {
    const r = checkWesternHookPackDraftIntegrity([
      {
        ...VALID,
        id: "w_generic",
        whatToShow:
          "Set the phone down on the counter, stare at it for a beat, then walk away from the kitchen.",
      },
    ]);
    expect(r.failures.some((f) => f.code === "generic_object_scenario")).toBe(
      true,
    );
  });

  it("length-band failures are reported in lengthFailures", () => {
    const r = checkWesternHookPackDraftIntegrity([
      { ...VALID, hook: "x".repeat(200) },
    ]);
    expect(r.failures.some((f) => f.code === "hook_length")).toBe(true);
    expect(r.lengthFailures.some((f) => f.code === "hook_length")).toBe(true);
  });

  it("obvious privacy patterns fail (phone-like / email-like)", () => {
    const r = checkWesternHookPackDraftIntegrity([
      {
        ...VALID,
        id: "w_phone",
        whatToShow:
          "Hold up a phone screen showing the contact 5551234567 prominently and laugh.",
      },
    ]);
    expect(r.privacyFailures.length).toBeGreaterThan(0);
    const r2 = checkWesternHookPackDraftIntegrity([
      {
        ...VALID,
        id: "w_email",
        whatToShow:
          "Show a draft email open on screen addressed to me@example.com for the punchline.",
      },
    ]);
    expect(r2.privacyFailures.length).toBeGreaterThan(0);
  });

  it("vocabularies are non-empty and frozen", () => {
    expect(WESTERN_COMEDY_FAMILIES.length).toBeGreaterThan(0);
    expect(WESTERN_EMOTIONAL_SPIKES.length).toBeGreaterThan(0);
    expect(WESTERN_SETTINGS.length).toBeGreaterThan(0);
    expect(Object.isFrozen(WESTERN_COMEDY_FAMILIES)).toBe(true);
    expect(Object.isFrozen(WESTERN_EMOTIONAL_SPIKES)).toBe(true);
    expect(Object.isFrozen(WESTERN_SETTINGS)).toBe(true);
  });
});
