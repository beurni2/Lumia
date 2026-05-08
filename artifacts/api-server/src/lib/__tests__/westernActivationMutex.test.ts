/**
 * PHASE W2-O — Western activation mutex tests.
 *
 * Verifies `getActiveWesternPool`'s resolution rules:
 *   • neither flag ON                           → none
 *   • approved-only ON, eligible cohort         → approved
 *   • live-only ON, eligible cohort             → live
 *   • both flags ON, eligible cohort            → live (with bothFlagsOn=true)
 *   • non-Western cohort, either/both flag ON   → none
 *   • Pool length echoed correctly per source.
 */

import { describe, expect, it } from "vitest";
import { APPROVED_WESTERN_PROMOTION_CANDIDATES } from "../westernHookPackApproved.js";
import { WESTERN_HOOK_PACK_LIVE } from "../westernHookPackLive.js";
import { getActiveWesternPool } from "../westernPackSlotReservation.js";

describe("W2-O — activation mutex", () => {
  it("neither flag ON → source=none", () => {
    const r = getActiveWesternPool({
      region: "western",
      languageStyle: "clean",
      approvedFlagEnabled: false,
      liveFlagEnabled: false,
    });
    expect(r.source).toBe("none");
    expect(r.entries.length).toBe(0);
    expect(r.bothFlagsOn).toBe(false);
  });

  it("approved-only ON → source=approved (staging pool length)", () => {
    const r = getActiveWesternPool({
      region: "western",
      languageStyle: "clean",
      approvedFlagEnabled: true,
      liveFlagEnabled: false,
    });
    expect(r.source).toBe("approved");
    expect(r.entries.length).toBe(APPROVED_WESTERN_PROMOTION_CANDIDATES.length);
    expect(r.packLength).toBe(APPROVED_WESTERN_PROMOTION_CANDIDATES.length);
    expect(r.bothFlagsOn).toBe(false);
  });

  it("live-only ON → source=live (live pool length)", () => {
    const r = getActiveWesternPool({
      region: "western",
      languageStyle: "clean",
      approvedFlagEnabled: false,
      liveFlagEnabled: true,
    });
    expect(r.source).toBe("live");
    expect(r.entries.length).toBe(WESTERN_HOOK_PACK_LIVE.length);
    expect(r.packLength).toBe(WESTERN_HOOK_PACK_LIVE.length);
    expect(r.bothFlagsOn).toBe(false);
  });

  it("both flags ON → source=live + bothFlagsOn=true", () => {
    const r = getActiveWesternPool({
      region: "western",
      languageStyle: "clean",
      approvedFlagEnabled: true,
      liveFlagEnabled: true,
    });
    expect(r.source).toBe("live");
    expect(r.entries.length).toBe(WESTERN_HOOK_PACK_LIVE.length);
    expect(r.bothFlagsOn).toBe(true);
    expect(r.approvedFlagEnabled).toBe(true);
    expect(r.liveFlagEnabled).toBe(true);
  });

  it("nigeria cohort, both flags ON → source=none (cohort guard wins)", () => {
    const r = getActiveWesternPool({
      region: "nigeria",
      languageStyle: "pidgin",
      approvedFlagEnabled: true,
      liveFlagEnabled: true,
    });
    expect(r.source).toBe("none");
    expect(r.entries.length).toBe(0);
  });

  it("india cohort, live ON → source=none", () => {
    const r = getActiveWesternPool({
      region: "india",
      languageStyle: "clean",
      approvedFlagEnabled: false,
      liveFlagEnabled: true,
    });
    expect(r.source).toBe("none");
  });

  it("philippines cohort, approved ON → source=none", () => {
    const r = getActiveWesternPool({
      region: "philippines",
      languageStyle: "clean",
      approvedFlagEnabled: true,
      liveFlagEnabled: false,
    });
    expect(r.source).toBe("none");
  });

  it("undefined region + null languageStyle resolves to default Western cohort", () => {
    const r = getActiveWesternPool({
      region: undefined,
      languageStyle: null,
      approvedFlagEnabled: true,
      liveFlagEnabled: false,
    });
    expect(r.source).toBe("approved");
  });

  it("western region + pidgin language → source=none (cross-axis defense)", () => {
    const r = getActiveWesternPool({
      region: "western",
      languageStyle: "pidgin",
      approvedFlagEnabled: true,
      liveFlagEnabled: true,
    });
    expect(r.source).toBe("none");
  });
});
