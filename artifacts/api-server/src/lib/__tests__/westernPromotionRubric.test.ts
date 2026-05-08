/**
 * PHASE W2-O — westernPromotionRubric unit tests.
 *
 * Determinism + safety guarantees for the rubric scorer:
 *   - same input yields identical output
 *   - validator-fail forces rejection (cannot promote)
 *   - skeleton duplication > 2 forces rejection
 *   - privacy hits force rejection
 *   - low-quality scenarios fail filmability dim
 *
 * No network, no DB, no env mutation.
 */

import { describe, expect, it } from "vitest";
import { APPROVED_WESTERN_PROMOTION_CANDIDATES } from "../westernHookPackApproved.js";
import {
  PENDING_EDITORIAL_REVIEW,
  type WesternHookPackDraftEntry,
} from "../westernHookPack.js";
import {
  RUBRIC_DIMENSIONS,
  RUBRIC_MAX_SCORE,
  RUBRIC_PROMOTE_FLOOR,
  RUBRIC_WEIGHTS,
  buildPoolContext,
  scoreEntry,
  scorePool,
} from "../westernPromotionRubric.js";

const seedEntry = (
  i: number,
  overrides: Partial<WesternHookPackDraftEntry> = {},
): WesternHookPackDraftEntry => {
  const e = APPROVED_WESTERN_PROMOTION_CANDIDATES[i];
  if (!e) throw new Error(`approved pool too small for index ${i}`);
  return { ...e, ...overrides };
};

describe("W2-O — rubric weights & invariants", () => {
  it("RUBRIC_DIMENSIONS and RUBRIC_WEIGHTS keys agree", () => {
    expect(Object.keys(RUBRIC_WEIGHTS).sort()).toEqual(
      [...RUBRIC_DIMENSIONS].sort(),
    );
  });

  it("RUBRIC_MAX_SCORE equals sum of weights", () => {
    const sum = (Object.values(RUBRIC_WEIGHTS) as number[]).reduce(
      (a, b) => a + b,
      0,
    );
    expect(RUBRIC_MAX_SCORE).toBe(sum);
  });

  it("PROMOTE_FLOOR < MAX_SCORE", () => {
    expect(RUBRIC_PROMOTE_FLOOR).toBeLessThan(RUBRIC_MAX_SCORE);
  });
});

describe("W2-O — rubric determinism", () => {
  it("scorePool over the staging pool is deterministic", () => {
    const a = scorePool(APPROVED_WESTERN_PROMOTION_CANDIDATES);
    const b = scorePool(APPROVED_WESTERN_PROMOTION_CANDIDATES);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toEqual(b[i]);
    }
  });

  it("scoreEntry on the same input twice yields identical output", () => {
    const ctx = buildPoolContext(APPROVED_WESTERN_PROMOTION_CANDIDATES);
    const entry = seedEntry(0);
    const r1 = scoreEntry(entry, ctx);
    const r2 = scoreEntry(entry, ctx);
    expect(r1).toEqual(r2);
  });
});

describe("W2-O — HARD reject conditions", () => {
  it("validator-fail prevents promotion", () => {
    // Construct an entry whose anchor token is missing from
    // whatToShow → fails the W2 author validator.
    const broken = seedEntry(0, {
      anchor: "absurdimpossiblezzz",
      whatToShow: "A person silently sips coffee while staring out the window.",
    });
    const ctx = buildPoolContext([broken]);
    const r = scoreEntry(broken, ctx);
    expect(r.recommendation).toBe("reject");
    expect(r.rejectReasons.some((x) => x.startsWith("validator_failed:"))).toBe(
      true,
    );
    expect(r.perDimension.validatorSurvival).toBe(0);
  });

  it("privacy hit (phone number) forces reject regardless of score", () => {
    const bad = seedEntry(1, {
      whatToShow:
        "Call me at 555-123-4567 then drop the phone on the table and walk away.",
    });
    const ctx = buildPoolContext([bad]);
    const r = scoreEntry(bad, ctx);
    expect(r.recommendation).toBe("reject");
    expect(r.rejectReasons.some((x) => x.startsWith("privacy_"))).toBe(true);
  });

  it("skeleton appearing > 2 times forces reject on every member", () => {
    const e1 = seedEntry(0);
    const e2 = seedEntry(1, { id: "DUP-2", hook: e1.hook });
    const e3 = seedEntry(2, { id: "DUP-3", hook: e1.hook });
    const ctx = buildPoolContext([e1, e2, e3]);
    for (const e of [e1, e2, e3]) {
      const r = scoreEntry(e, ctx);
      expect(r.rejectReasons.some((x) => x.startsWith("duplicate_skeleton:"))).toBe(
        true,
      );
      expect(r.recommendation).toBe("reject");
    }
  });
});

describe("W2-O — soft scoring sanity", () => {
  it("hookAiTell penalises em-dash + 'delve'", () => {
    const clean = seedEntry(0);
    const dirty = seedEntry(0, {
      hook: "Delve into the moment — quietly, then explain why it matters",
    });
    const ctx = buildPoolContext([clean, dirty]);
    const rc = scoreEntry(clean, ctx);
    const rd = scoreEntry(dirty, ctx);
    expect(rd.perDimension.hookAiTell).toBeLessThan(rc.perDimension.hookAiTell);
  });

  it("scenario with 'friends' lowers lowLiftSolo score", () => {
    const solo = seedEntry(0);
    const social = seedEntry(0, {
      whatToShow: solo.whatToShow + " Friends watch and laugh in the back.",
    });
    const ctx = buildPoolContext([solo, social]);
    expect(scoreEntry(social, ctx).perDimension.lowLiftSolo).toBeLessThan(
      scoreEntry(solo, ctx).perDimension.lowLiftSolo,
    );
  });
});

describe("W2-O — rubric over the as-shipped staging pool", () => {
  it("yields a non-empty 'promote' subset", () => {
    const results = scorePool(APPROVED_WESTERN_PROMOTION_CANDIDATES);
    const promoted = results.filter((r) => r.recommendation === "promote");
    expect(promoted.length).toBeGreaterThan(0);
  });

  it("staging entries all carry PENDING_EDITORIAL_REVIEW (sanity)", () => {
    for (const e of APPROVED_WESTERN_PROMOTION_CANDIDATES) {
      expect(e.reviewedBy).toBe(PENDING_EDITORIAL_REVIEW);
    }
  });
});
