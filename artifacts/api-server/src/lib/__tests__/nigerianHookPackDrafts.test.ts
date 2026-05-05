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
  it("imports exactly 300 candidate entries (Batch A + Batch B + Batch C)", () => {
    expect(DRAFT_NIGERIAN_HOOK_PACK.length).toBe(300);
  });

  it("the draft pool is frozen", () => {
    expect(Object.isFrozen(DRAFT_NIGERIAN_HOOK_PACK)).toBe(true);
  });

  it("every entry uses the PENDING_NATIVE_REVIEW sentinel", () => {
    for (const e of DRAFT_NIGERIAN_HOOK_PACK) {
      expect(e.reviewedBy).toBe(PENDING_NATIVE_REVIEW);
    }
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

  it("rejects an entry whose reviewedBy is not the sentinel", () => {
    const bad: DraftNigerianPackEntry = {
      ...BASE,
      reviewedBy: "X" as unknown as typeof PENDING_NATIVE_REVIEW,
    };
    expect(() => assertNigerianDraftPackIntegrity([bad])).toThrow(
      /PENDING_NATIVE_REVIEW/,
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
    expect(counts.clean + counts.light_pidgin + counts.pidgin).toBe(300);
    // Sanity: at least some Pidgin-tier entries exist (otherwise the
    // pack's whole purpose is moot — would indicate a tier-mapping
    // regression in the import).
    expect(activatable).toBeGreaterThan(0);
  });
});
