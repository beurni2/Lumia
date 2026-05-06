/**
 * PHASE N1-FULL-SPEC — review-stamp whitespace hardening lock-in.
 *
 * Spec §"REVIEW MODEL" explicitly demands rejection of "whitespace
 * or padded variants" of `PENDING_NATIVE_REVIEW` and `AGENT-PROPOSED`
 * sentinels. The current implementation already calls `.trim()`
 * before comparing in all three defense layers:
 *
 *   1. `assertNigerianPackIntegrity` (nigerianHookPack.ts L266/L278)
 *   2. `failsSafetyChecks`           (nigerianHookQuality.ts L172/L176)
 *   3. `validateRow`                 (buildApprovedNigerianPack.ts L306/L309)
 *
 * This file locks that contract in so a future refactor cannot
 * accidentally drop the `.trim()` and let a padded sentinel slip
 * through.
 */

import { describe, it, expect } from "vitest";
import {
  assertNigerianPackIntegrity,
  type NigerianPackEntry,
} from "../nigerianHookPack";
import {
  scoreNigerianPackEntry,
  getNigerianHookQualityIngestKey,
} from "../nigerianHookQuality";

const VALID_BASE: NigerianPackEntry = {
  hook: "i told my mama say i go come home for christmas",
  whatToShow:
    "phone propped chest height. you say the line straight to camera, " +
    "then mama call right after — you stare at the screen, deciding.",
  howToFilm:
    "single take, chest height, no overhead light. cut on the stare.",
  caption: "every nigerian child knows this stare",
  anchor: "mama",
  domain: "family_pressure",
  pidginLevel: "light_pidgin",
  reviewedBy: "BI 2026-05-05",
};

const PADDED_PENDING_VARIANTS = [
  " PENDING_NATIVE_REVIEW",
  "PENDING_NATIVE_REVIEW ",
  "  PENDING_NATIVE_REVIEW  ",
  "\tPENDING_NATIVE_REVIEW\n",
];

const PADDED_AGENT_VARIANTS = [
  " AGENT-PROPOSED — pending BI review",
  "  AGENT-PROPOSED — pending BI review  ",
  "\tAGENT-PROPOSED — pending review",
];

const PADDED_VALID_VARIANTS = [
  " BI 2026-05-05",
  "BI 2026-05-05 ",
  "  BI 2026-05-05  ",
  "\tBI 2026-05-05\n",
];

describe("N1-FULL-SPEC — reviewedBy stamp hardening (whitespace variants)", () => {
  describe("assertNigerianPackIntegrity (boot-time defense layer 1)", () => {
    it.each(PADDED_PENDING_VARIANTS)(
      "rejects whitespace-padded PENDING_NATIVE_REVIEW: %j",
      (stamp) => {
        expect(() =>
          assertNigerianPackIntegrity([{ ...VALID_BASE, reviewedBy: stamp }]),
        ).toThrow(/PENDING_NATIVE_REVIEW/);
      },
    );

    it.each(PADDED_AGENT_VARIANTS)(
      "rejects whitespace-padded AGENT-PROPOSED stamp: %j",
      (stamp) => {
        expect(() =>
          assertNigerianPackIntegrity([{ ...VALID_BASE, reviewedBy: stamp }]),
        ).toThrow(/AGENT-PROPOSED/);
      },
    );

    it("rejects empty + whitespace-only reviewedBy", () => {
      for (const stamp of ["", " ", "  \t\n  "]) {
        expect(() =>
          assertNigerianPackIntegrity([{ ...VALID_BASE, reviewedBy: stamp }]),
        ).toThrow(/reviewedBy/);
      }
    });

    it.each(PADDED_VALID_VARIANTS)(
      "ACCEPTS whitespace-padded valid native-reviewer stamp: %j",
      (stamp) => {
        expect(() =>
          assertNigerianPackIntegrity([{ ...VALID_BASE, reviewedBy: stamp }]),
        ).not.toThrow();
      },
    );
  });

  describe("scoreNigerianPackEntry safety check (defense layer 2)", () => {
    // The scorer accepts only trusted contexts; we use kind:"ingest"
    // with the documented INGEST_KEY contract (an opaque symbol exposed
    // via the public getter for trusted callers like this regression test).
    const ingestCtx = {
      kind: "ingest" as const,
      key: getNigerianHookQualityIngestKey(),
    };

    it.each([...PADDED_PENDING_VARIANTS, ...PADDED_AGENT_VARIANTS])(
      "scores 0 for padded sentinel stamp: %j",
      (stamp) => {
        const score = scoreNigerianPackEntry(
          { ...VALID_BASE, reviewedBy: stamp },
          ingestCtx,
        );
        expect(score).toBe(0);
      },
    );

    it.each(PADDED_VALID_VARIANTS)(
      "scores >0 for padded VALID stamp: %j",
      (stamp) => {
        const score = scoreNigerianPackEntry(
          { ...VALID_BASE, reviewedBy: stamp },
          ingestCtx,
        );
        expect(score).toBeGreaterThan(0);
      },
    );
  });
});
