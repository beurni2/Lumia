/**
 * PHASE N1 — Draft Batch A tests.
 *
 * Pins the draft-import safety contract:
 *   • All 100 imported entries pass `assertNigerianDraftPackIntegrity`.
 *   • Live `NIGERIAN_HOOK_PACK` is unchanged (still empty).
 *   • Drafts cannot activate via the live guard:
 *     - guard returns false when pack-length argument is the live
 *       (empty) pool, regardless of draft length
 *     - `getEligibleNigerianPackEntries` THROWS when the draft pool
 *       is passed as `pool` (defense-in-depth reference check)
 *   • Cross-region leak is still hermetic.
 *   • Every draft entry's `reviewedBy` is the exact PENDING sentinel.
 *   • Tier breakdown is reported (clean / light_pidgin / pidgin).
 */

import { describe, expect, it } from "vitest";

import {
  NIGERIAN_HOOK_PACK,
  canActivateNigerianPack,
  getEligibleNigerianPackEntries,
} from "../nigerianHookPack.js";
import {
  DRAFT_NIGERIAN_HOOK_PACK,
  PENDING_NATIVE_REVIEW,
  assertNigerianDraftPackIntegrity,
  checkNigerianDraftPackIntegrity,
  isPotentiallyActivatable,
  type DraftNigerianPackEntry,
} from "../nigerianHookPackDrafts.js";

describe("N1 drafts — import shape", () => {
  it("imports exactly 380 candidate entries (Batch A + Batch B + Batch C + Batch B-extension + Batch C-rebalance)", () => {
    expect(DRAFT_NIGERIAN_HOOK_PACK.length).toBe(380);
  });

  it("the draft pool is frozen", () => {
    expect(Object.isFrozen(DRAFT_NIGERIAN_HOOK_PACK)).toBe(true);
  });

  // PHASE N1-FULL-SPEC — the BI native speaker has reviewed all 300
  // drafts and stamped them on 2026-05-06. The previous invariant
  // ("every entry uses PENDING_NATIVE_REVIEW") has been replaced by
  // the post-review invariant: every entry carries a non-empty,
  // non-sentinel, non-AGENT-PROPOSED stamp (mirrors production rule).
  it("every entry carries a real reviewer stamp (BI 2026-05-06)", () => {
    for (const e of DRAFT_NIGERIAN_HOOK_PACK) {
      expect(e.reviewedBy.trim().length).toBeGreaterThan(0);
      expect(e.reviewedBy).not.toBe(PENDING_NATIVE_REVIEW);
      expect(e.reviewedBy.startsWith("AGENT-PROPOSED")).toBe(false);
    }
    // Spot-check: at least one entry carries the BI stamp.
    expect(DRAFT_NIGERIAN_HOOK_PACK[0]!.reviewedBy).toBe("BI 2026-05-06");
  });

  it("draft-integrity check returns no issues for the imported batch", () => {
    const issues = checkNigerianDraftPackIntegrity(DRAFT_NIGERIAN_HOOK_PACK);
    if (issues.length > 0) {
      // Make failure messages actionable.
      console.log(
        "Draft integrity issues:\n" +
          issues
            .map((i) => `  [${i.index}] ${i.reason} | "${i.hookSnippet}"`)
            .join("\n"),
      );
    }
    expect(issues).toEqual([]);
  });

  it("boot-time assert is a no-op on the imported batch", () => {
    expect(() =>
      assertNigerianDraftPackIntegrity(DRAFT_NIGERIAN_HOOK_PACK),
    ).not.toThrow();
  });
});

describe("N1 drafts — assert sensitivity (synthetic failures)", () => {
  const BASE: DraftNigerianPackEntry = DRAFT_NIGERIAN_HOOK_PACK[0]!;

  // PHASE N1-FULL-SPEC — post-review the draft assert mirrors the
  // production rules with one intentional difference: the PENDING
  // sentinel is ACCEPTED at the draft layer (production assert
  // rejects it via its non-empty + sentinel checks, so a draft
  // carrying PENDING can never enter the live pack). Verify each
  // remaining rejection path: empty, AGENT-PROPOSED prefix.
  it("accepts an entry whose reviewedBy is the PENDING sentinel", () => {
    const ok: DraftNigerianPackEntry = {
      ...BASE,
      reviewedBy: PENDING_NATIVE_REVIEW,
    };
    expect(() => assertNigerianDraftPackIntegrity([ok])).not.toThrow();
  });

  it("rejects an entry whose reviewedBy is empty", () => {
    const bad: DraftNigerianPackEntry = { ...BASE, reviewedBy: "   " };
    expect(() => assertNigerianDraftPackIntegrity([bad])).toThrow(
      /reviewedBy/,
    );
  });

  it("rejects an entry whose reviewedBy starts with AGENT-PROPOSED", () => {
    const bad: DraftNigerianPackEntry = {
      ...BASE,
      reviewedBy: "AGENT-PROPOSED — pending BI review",
    };
    expect(() => assertNigerianDraftPackIntegrity([bad])).toThrow(
      /AGENT-PROPOSED/,
    );
  });

  it("rejects an entry with an empty cluster", () => {
    const bad = { ...BASE, cluster: "" };
    expect(() => assertNigerianDraftPackIntegrity([bad])).toThrow(/cluster/);
  });

  it("rejects an entry with multi-word anchor", () => {
    const bad = { ...BASE, anchor: "two words" };
    expect(() => assertNigerianDraftPackIntegrity([bad])).toThrow(/anchor/);
  });

  it("rejects an entry whose hook is too long", () => {
    const bad = { ...BASE, hook: "x".repeat(200) };
    expect(() => assertNigerianDraftPackIntegrity([bad])).toThrow(/hook length/);
  });
});

describe("N1 drafts — live pack remains DARK", () => {
  it("NIGERIAN_HOOK_PACK is still empty", () => {
    expect(NIGERIAN_HOOK_PACK.length).toBe(0);
  });

  it("activation guard returns false for live pack regardless of draft volume", () => {
    expect(
      canActivateNigerianPack({
        region: "nigeria",
        languageStyle: "pidgin",
        flagEnabled: true,
        packLength: NIGERIAN_HOOK_PACK.length,
      }),
    ).toBe(false);
  });

  it("getEligibleNigerianPackEntries returns [] under default (live) pool", () => {
    const out = getEligibleNigerianPackEntries({
      region: "nigeria",
      languageStyle: "pidgin",
      flagEnabled: true,
    });
    expect(out.length).toBe(0);
  });
});

describe("N1 drafts — defense-in-depth reference guard", () => {
  it("refuses to return draft entries even when DRAFT pool is passed via 'as'", () => {
    expect(() =>
      getEligibleNigerianPackEntries(
        { region: "nigeria", languageStyle: "pidgin", flagEnabled: true },
        DRAFT_NIGERIAN_HOOK_PACK as unknown as Parameters<
          typeof getEligibleNigerianPackEntries
        >[1],
      ),
    ).toThrow(/drafts cannot be activated/);
  });

  it("draft pool length cannot fool the activation guard for non-nigeria regions", () => {
    for (const region of ["western", "india", "philippines"] as const) {
      expect(
        canActivateNigerianPack({
          region,
          languageStyle: "pidgin",
          flagEnabled: true,
          packLength: DRAFT_NIGERIAN_HOOK_PACK.length,
        }),
      ).toBe(false);
    }
  });

  it("draft pool length cannot fool the guard for nigeria-clean / null", () => {
    for (const languageStyle of [null, "clean"] as const) {
      expect(
        canActivateNigerianPack({
          region: "nigeria",
          languageStyle,
          flagEnabled: true,
          packLength: DRAFT_NIGERIAN_HOOK_PACK.length,
        }),
      ).toBe(false);
    }
  });
});

describe("N1 drafts — tier breakdown report", () => {
  it("logs the clean/light_pidgin/pidgin breakdown for reviewer triage", () => {
    const counts = { clean: 0, light_pidgin: 0, pidgin: 0 } as Record<
      DraftNigerianPackEntry["pidginLevel"],
      number
    >;
    let activatable = 0;
    for (const e of DRAFT_NIGERIAN_HOOK_PACK) {
      counts[e.pidginLevel]++;
      if (isPotentiallyActivatable(e)) activatable++;
    }
    console.log(
      `[N1 drafts] tiers: clean=${counts.clean} ` +
        `light_pidgin=${counts.light_pidgin} pidgin=${counts.pidgin} ` +
        `(activation-eligible after promotion: ${activatable})`,
    );
    expect(counts.clean + counts.light_pidgin + counts.pidgin).toBe(380);
    // Sanity: at least some Pidgin-tier entries exist (otherwise the
    // pack's whole purpose is moot — would indicate a tier-mapping
    // regression in the import).
    expect(activatable).toBeGreaterThan(0);
  });
});
