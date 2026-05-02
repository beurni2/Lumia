/**
 * PHASE Y8 — `scoreHookQuality` regression tests. Locks in the
 * five quality axes (visceral verb / anthropomorph / brevity /
 * concreteness / contradiction) so a future tuning pass can't
 * silently invert the scorer's preference order. The signature
 * test pair is the user's exact example — "i ghosted my own
 * to-do list" must score strictly higher than "i abandoned my
 * checklist", because a Y9 / Y10 selector that picks the wrong
 * one of those is the failure mode this whole phase is designed
 * to prevent.
 */
import { describe, it, expect } from "vitest";
import {
  scoreHookQuality,
  scoreHookQualityDetailed,
} from "../hookQuality.js";

describe("scoreHookQuality (Y8 captivating-hook scorer)", () => {
  it("USER REQUIREMENT: 'ghosted my own to-do list' beats 'abandoned my checklist'", () => {
    // The user-added Y8 requirement quoted verbatim:
    //   "every hook title must be captivating and intriguing —
    //    'i ghosted my own to-do list' is better than
    //    'i abandoned my checklist'"
    // The whole point of the scorer is to encode this preference.
    // If this test ever flips, Y8 has lost its design intent.
    const ghosted = scoreHookQuality(
      "i ghosted my own to-do list",
      "self_betrayal",
    );
    const abandoned = scoreHookQuality(
      "i abandoned my checklist",
      "self_betrayal",
    );
    expect(ghosted).toBeGreaterThan(abandoned);
    // Sanity: the captivating one should be well into the upper band
    // (not just edging out by a point).
    expect(ghosted).toBeGreaterThanOrEqual(70);
  });

  it("visceral verb beats bland verb at otherwise-equal hooks", () => {
    // Same length / same anchor / no anthropomorph markers; the only
    // difference is the verb tier. `ghosted` is HIGH (30), `did` is
    // BLAND (5).
    const visceral = scoreHookQuality("i ghosted the list", "self_betrayal");
    const bland = scoreHookQuality("i did the list", "self_betrayal");
    expect(visceral).toBeGreaterThan(bland);
  });

  it("anthropomorph marker boost: 'my own X' beats 'my X'", () => {
    // Same verb (`abandoned`, mid-tier 18), same anchor (`list`),
    // same length (5 words). Only difference: `my own` triggers the
    // explicit anthropomorph axis (worth 25) vs bare `my` (0).
    const withMarker = scoreHookQuality(
      "i abandoned my own list",
      "self_betrayal",
    );
    const withoutMarker = scoreHookQuality(
      "i abandoned my list",
      "self_betrayal",
    );
    expect(withMarker).toBeGreaterThan(withoutMarker);
    // The boost should be material — at least 20 points (the
    // anthropomorph axis is worth up to 25, so a ≥20 gap confirms
    // the explicit-marker path actually fired).
    expect(withMarker - withoutMarker).toBeGreaterThanOrEqual(20);
  });

  it("brevity: 6-word hook beats 11-word hook for the same scenario", () => {
    // Same verb, same anchor, same anthropomorph markers — only
    // length differs. Brevity peaks at 5-7 words (worth 20) and
    // decays outward; an 11-word version sits near the worst tier
    // (5 points).
    const tight = scoreHookQuality(
      "i ghosted my own list completely",
      "self_betrayal",
    );
    const verbose = scoreHookQuality(
      "i basically went and ghosted my own list completely yesterday afternoon",
      "self_betrayal",
    );
    expect(tight).toBeGreaterThan(verbose);
  });

  it("concrete anchor present beats anchor absent", () => {
    // Same verb, same length, same anthropomorph markers. The hook
    // WITH a concrete anchor (`list`, in CONCRETE_NOUNS) earns
    // concreteness points (worth up to 15); the version with only
    // the abstract noun `decision` earns 0.
    const concrete = scoreHookQuality(
      "i ghosted my own list",
      "self_betrayal",
    );
    const abstract = scoreHookQuality(
      "i ghosted my own decision",
      "self_betrayal",
    );
    expect(concrete).toBeGreaterThan(abstract);
  });

  it("contradiction beat (em-dash / period / number) earns tension credit", () => {
    // Both are otherwise identical 6-word hooks with the same verb +
    // anchor; the version WITH a contradiction marker (`. obviously.`
    // mid-sentence + terminal period) wins the contradiction axis
    // (worth 10).
    const withBeat = scoreHookQuality(
      "the list won. obviously.",
      "self_betrayal",
    );
    const withoutBeat = scoreHookQuality("the list won today", "self_betrayal");
    expect(withBeat).toBeGreaterThan(withoutBeat);
  });

  it("dramatic-stakes nouns (villain/apocalypse/etc.) earn tension credit", () => {
    // The `overdramatic_reframe` voice cluster carries its punch in
    // the noun, not the verb. The DRAMATIC_NOUNS rule keeps templates
    // like "X became my villain origin" / "X is a personal apocalypse
    // now" from scoring as bland.
    const dramatic = scoreHookQuality(
      "the list became my villain origin",
      "absurd_escalation",
    );
    const flat = scoreHookQuality(
      "the list became my morning thing",
      "absurd_escalation",
    );
    expect(dramatic).toBeGreaterThan(flat);
  });

  it("returns 0-100 bounded score", () => {
    // Sanity-bound the score so a future component addition can't
    // silently overflow the 0-100 contract documented in the
    // function comment.
    for (const hook of [
      "",
      "x",
      "i ghosted my own to-do list",
      "the alarm and i had a moment yesterday afternoon",
      "the list became my villain origin and i abandoned my own checklist apparently",
    ]) {
      const s = scoreHookQuality(hook, "self_betrayal");
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });

  it("Y8 GAMING GUARD: 'my own' alone (no verb / anchor / contradiction signal) is capped to IMPLICIT tier", () => {
    // The EXPLICIT anthropomorph regex is worth 25 — a hook could
    // game the median by prefixing any bland statement with `my own`.
    // The orchestrator caps the credit at the IMPLICIT tier (12) when
    // the hook has NO other captivating signal (visceral verb above
    // bland, concrete anchor, or contradiction beat). Genuine
    // captivating hooks like `i ghosted my own to-do list` are
    // unaffected — they have visceral=30 + concrete>0.
    const gamingHook = scoreHookQualityDetailed(
      "my own zorblax was florbed",
      "self_betrayal",
    );
    // Bland verb + EXPLICIT marker but no other signal → marker
    // demoted from 25 → 12, so the hook can't ride a single regex
    // into the median.
    expect(gamingHook.anthropomorph).toBe(12);

    const genuine = scoreHookQualityDetailed(
      "i ghosted my own to-do list",
      "self_betrayal",
    );
    // Genuine captivating hook: visceral verb (ghost) + concrete
    // anchor (list) → the EXPLICIT marker keeps its full 25.
    expect(genuine.anthropomorph).toBe(25);

    expect(genuine.total).toBeGreaterThan(gamingHook.total);
  });

  it("detailed scorer surfaces all five components individually", () => {
    // The detailed variant is the QA / dashboard surface — it must
    // never collapse axes silently.
    const detail = scoreHookQualityDetailed(
      "i ghosted my own to-do list",
      "self_betrayal",
    );
    expect(detail.total).toBe(scoreHookQuality(
      "i ghosted my own to-do list",
      "self_betrayal",
    ));
    expect(detail.visceral).toBeGreaterThan(0);
    expect(detail.anthropomorph).toBeGreaterThan(0);
    expect(detail.brevity).toBeGreaterThan(0);
    expect(detail.concrete).toBeGreaterThan(0);
  });
});
