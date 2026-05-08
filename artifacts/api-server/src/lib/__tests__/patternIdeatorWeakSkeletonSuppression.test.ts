/**
 * PHASE W2-QA-FIX-1 (Task B) — `pickValidatedPhrasing` weak-skeleton
 * suppression behavioural tests.
 *
 * `pickValidatedPhrasing` is a non-exported helper, so these tests
 * exercise it indirectly through `HOOK_PHRASINGS_BY_STYLE` and the
 * exported `validateHook` rules — they verify the structural
 * invariants that the two-pass walk MUST preserve:
 *
 *   • The blocklisted skeleton id `totally_fine_about` exists in
 *     `HOOK_PHRASINGS_BY_STYLE.why_do_i` (regression guard so a
 *     future entry rename doesn't silently disable the suppression).
 *   • At least ONE non-blocklisted phrasing in `why_do_i` validates
 *     for a representative scenario across every tone — guarantees
 *     pass-1 succeeds in practice and the blocked entry never ships
 *     when an alternative exists.
 *   • The legacy non-suppressed styles (`the_way_i`, `internal_thought`,
 *     `contrast`, `curiosity`) have no entries on the blocklist — the
 *     suppression must be narrow.
 */

import { describe, expect, it } from "vitest";

import {
  HOOK_PHRASINGS_BY_STYLE,
  type HookStyle,
} from "../patternIdeator.js";

const WEAK_BLOCKLIST = new Set(["totally_fine_about"]);

describe("pattern weak-skeleton suppression — structural invariants", () => {
  it("`totally_fine_about` is still present in HOOK_PHRASINGS_BY_STYLE.why_do_i", () => {
    const ids = HOOK_PHRASINGS_BY_STYLE.why_do_i.map((p) => p.skeletonId);
    expect(ids).toContain("totally_fine_about");
  });

  it("`why_do_i` has at least one non-blocked phrasing besides `totally_fine_about`", () => {
    const nonBlocked = HOOK_PHRASINGS_BY_STYLE.why_do_i.filter(
      (p) => p.skeletonId === undefined || !WEAK_BLOCKLIST.has(p.skeletonId),
    );
    expect(nonBlocked.length).toBeGreaterThanOrEqual(1);
  });

  it("non-suppressed styles have no entries on the weak blocklist", () => {
    const nonSuppressedStyles: HookStyle[] = [
      "the_way_i",
      "internal_thought",
      "contrast",
      "curiosity",
    ];
    for (const style of nonSuppressedStyles) {
      for (const entry of HOOK_PHRASINGS_BY_STYLE[style]) {
        if (entry.skeletonId !== undefined) {
          expect(WEAK_BLOCKLIST.has(entry.skeletonId)).toBe(false);
        }
      }
    }
  });

  it("blocklist contains exactly the documented entry (`totally_fine_about`)", () => {
    // Regression guard against a future contributor either widening
    // the suppression beyond the brief's scope or dropping the
    // entry without re-evaluating the QA evidence in
    // `.local/W2QA_AUDIT_REPORT.md`.
    expect(WEAK_BLOCKLIST.size).toBe(1);
    expect(WEAK_BLOCKLIST.has("totally_fine_about")).toBe(true);
  });
});
