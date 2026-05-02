/**
 * PHASE Y7 — regression tests for the cohesive author's structural
 * preconditions. These tests lock in the Y6 architect-fix corner
 * cases so a future refactor can't silently regress them:
 *
 *   - The canonical 12-word end-beat template MUST pass the
 *     terminal-contradiction check (a previous version cropped to
 *     the last 8 words and chopped the verb out, tripping
 *     `construction_failed` for every candidate).
 *   - The action verb MUST live in the FINAL sentence; a verb that
 *     only appears in an earlier sentence does NOT satisfy the
 *     "ends on contradiction" semantic.
 *   - Word-boundary matching MUST rule out the substring trap:
 *     short verbs like `lie` should NOT match inside `lies` /
 *     `belief`.
 */
import { describe, it, expect } from "vitest";
import { showEndsOnContradiction } from "../cohesiveIdeaAuthor.js";

describe("showEndsOnContradiction (Y6 architect-fix regression guard)", () => {
  it("passes the canonical 12-word end-beat template (verb at word 4)", () => {
    // Template: "End beat: i ${actionPast} the ${anchorLc} and look
    // straight to camera, deadpan." — 12 words; `${actionPast}` sits
    // at word 4. Y6's pre-fix version cropped to the last 8 words
    // and chopped the verb out → false negative on every candidate.
    const show =
      "i scroll for an hour. end beat: i abandoned the alarm and look straight to camera, deadpan.";
    expect(showEndsOnContradiction(show, "abandon", "abandoned")).toBe(true);
  });

  it("passes when the bare verb (not past) appears in the final sentence", () => {
    const show =
      "i open the inbox. i abandon every reply mid-sentence and stare.";
    expect(showEndsOnContradiction(show, "abandon", "abandoned")).toBe(true);
  });

  it("fails when the verb only appears in a NON-final sentence", () => {
    // Verb is in sentence 1; sentence 2 has no contradiction beat.
    const show =
      "i abandoned the alarm at 6. then i made coffee and sat down.";
    expect(showEndsOnContradiction(show, "abandon", "abandoned")).toBe(false);
  });

  it("rules out substring false positive: `lie` does NOT match inside `lies`", () => {
    const show = "i tell myself two lies before noon and keep going.";
    expect(showEndsOnContradiction(show, "lie", "lied")).toBe(false);
  });

  it("rules out substring false positive: `lie` does NOT match inside `belief`", () => {
    const show = "i hold the belief that today is different. it is not.";
    expect(showEndsOnContradiction(show, "lie", "lied")).toBe(false);
  });

  it("matches when the verb is the LAST word with terminal punctuation", () => {
    const show = "the alarm rings and i abandoned.";
    expect(showEndsOnContradiction(show, "abandon", "abandoned")).toBe(true);
  });

  it("treats trailing whitespace / no terminal punctuation as one segment", () => {
    // No `.!?` at all → whole string is the final segment.
    const show = "i opened the inbox and abandoned every reply";
    expect(showEndsOnContradiction(show, "abandon", "abandoned")).toBe(true);
  });

  it("ignores empty segments from collapsed punctuation (`...`)", () => {
    const show = "i look at the alarm... and i abandoned it";
    expect(showEndsOnContradiction(show, "abandon", "abandoned")).toBe(true);
  });
});
