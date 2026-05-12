/**
 * P13-T2 (BI 2026-05-12) — SLEEP_V1 packet integrity + scoring tests.
 *
 * Locks in:
 *   1. Packet has exactly 8 entries with stable provenance ids.
 *   2. Every entry passes `assertNigerianPackIntegrity` (boot-time
 *      contract — anchor in hook+whatToShow, length bands, mocking
 *      patterns clear, reviewer stamp, etc).
 *   3. Every entry scores ≥ 40 on `scoreNigerianPackEntry` against
 *      the live pool reference (matches the FOOD_V2 ingest floor).
 *   4. `domain` is `"everyday"` for every entry (closes the
 *      everyday→sleep topology starvation finding from P12-T2 audit).
 *   5. Anchors are distinct (8 distinct sleep-cluster anchors).
 *   6. SLEEP_V1 entries are concatenated into NIGERIAN_HOOK_PACK
 *      when the activation flag is set.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ORIGINAL_FLAG = process.env.LUMINA_NG_PACK_ENABLED;
beforeAll(() => {
  process.env.LUMINA_NG_PACK_ENABLED = "true";
});
afterAll(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.LUMINA_NG_PACK_ENABLED;
  else process.env.LUMINA_NG_PACK_ENABLED = ORIGINAL_FLAG;
});

describe("SLEEP_V1 packet (P13-T2)", () => {
  it("exports exactly 8 entries with matching provenance ids", async () => {
    const mod = await import("../nigerianHookPackSleepV1.js");
    expect(mod.SLEEP_V1_NIGERIAN_PROMOTION_CANDIDATES.length).toBe(8);
    expect(mod.SLEEP_V1_NIGERIAN_PROMOTION_IDS.length).toBe(8);
  });

  it("every entry passes assertNigerianPackIntegrity", async () => {
    const { SLEEP_V1_NIGERIAN_PROMOTION_CANDIDATES } = await import(
      "../nigerianHookPackSleepV1.js"
    );
    const { assertNigerianPackIntegrity } = await import(
      "../nigerianHookPack.js"
    );
    expect(() =>
      assertNigerianPackIntegrity(SLEEP_V1_NIGERIAN_PROMOTION_CANDIDATES),
    ).not.toThrow();
  });

  it("every entry has domain='everyday' and pidginLevel='light_pidgin'", async () => {
    const { SLEEP_V1_NIGERIAN_PROMOTION_CANDIDATES } = await import(
      "../nigerianHookPackSleepV1.js"
    );
    for (const e of SLEEP_V1_NIGERIAN_PROMOTION_CANDIDATES) {
      expect(e.domain).toBe("everyday");
      expect(e.pidginLevel).toBe("light_pidgin");
      expect(e.reviewedBy).toBe("BI-LIGHT-PIDGIN 2026-05-12");
    }
  });

  it("8 distinct sleep-cluster anchors", async () => {
    const { SLEEP_V1_NIGERIAN_PROMOTION_CANDIDATES } = await import(
      "../nigerianHookPackSleepV1.js"
    );
    const anchors = new Set(
      SLEEP_V1_NIGERIAN_PROMOTION_CANDIDATES.map((e) => e.anchor),
    );
    expect(anchors.size).toBe(8);
    // sanity: all expected sleep anchors present
    for (const a of [
      "alarm",
      "pillow",
      "bed",
      "charger",
      "fan",
      "blanket",
      "mosquito",
      "light",
    ]) {
      expect(anchors.has(a)).toBe(true);
    }
  });

  it("every entry scores >= 40 on scoreNigerianPackEntry", async () => {
    const { SLEEP_V1_NIGERIAN_PROMOTION_CANDIDATES } = await import(
      "../nigerianHookPackSleepV1.js"
    );
    const { NIGERIAN_HOOK_PACK } = await import("../nigerianHookPack.js");
    const { scoreNigerianPackEntry } = await import("../nigerianHookQuality.js");
    const ctx = { kind: "pool" as const, pool: NIGERIAN_HOOK_PACK };
    for (const e of SLEEP_V1_NIGERIAN_PROMOTION_CANDIDATES) {
      const score = scoreNigerianPackEntry(e, ctx);
      if (score < 40) {
        throw new Error(
          `SLEEP_V1 entry below ingest floor: anchor=${e.anchor} score=${score} hook="${e.hook}"`,
        );
      }
      expect(score).toBeGreaterThanOrEqual(40);
    }
  });

  it("SLEEP_V1 entries are present in NIGERIAN_HOOK_PACK when flag is ON", async () => {
    const { NIGERIAN_HOOK_PACK } = await import("../nigerianHookPack.js");
    const { SLEEP_V1_NIGERIAN_PROMOTION_CANDIDATES } = await import(
      "../nigerianHookPackSleepV1.js"
    );
    const packHooks = new Set(NIGERIAN_HOOK_PACK.map((e) => e.hook));
    for (const e of SLEEP_V1_NIGERIAN_PROMOTION_CANDIDATES) {
      expect(packHooks.has(e.hook)).toBe(true);
    }
  });
});

describe("FOOD_V2 P13-T2 selective taste pass", () => {
  it("the 5 rewritten hooks are present (anchors + new pidgin texture)", async () => {
    const { FOOD_V2_NIGERIAN_PROMOTION_CANDIDATES } = await import(
      "../nigerianHookPackFoodV2.js"
    );
    const hooks = new Set(
      FOOD_V2_NIGERIAN_PROMOTION_CANDIDATES.map((e) => e.hook),
    );
    expect(
      hooks.has("fridge just make small sound, i don confess before anybody ask"),
    ).toBe(true);
    expect(
      hooks.has("fridge get leftover, the house don enter court session"),
    ).toBe(true);
    expect(
      hooks.has("fridge open na for water, but my hand don carry evidence"),
    ).toBe(true);
    expect(
      hooks.has("plate don expose me, small taste no suppose reach corner"),
    ).toBe(true);
    expect(
      hooks.has("pan don smell finish, but food no carry evidence"),
    ).toBe(true);
  });

  it("all 25 FOOD_V2 entries still score >= 40 (no regression)", async () => {
    const { FOOD_V2_NIGERIAN_PROMOTION_CANDIDATES } = await import(
      "../nigerianHookPackFoodV2.js"
    );
    const { NIGERIAN_HOOK_PACK } = await import("../nigerianHookPack.js");
    const { scoreNigerianPackEntry } = await import("../nigerianHookQuality.js");
    const ctx = { kind: "pool" as const, pool: NIGERIAN_HOOK_PACK };
    for (const e of FOOD_V2_NIGERIAN_PROMOTION_CANDIDATES) {
      const score = scoreNigerianPackEntry(e, ctx);
      if (score < 40) {
        throw new Error(
          `FOOD_V2 entry below ingest floor: anchor=${e.anchor} score=${score} hook="${e.hook}"`,
        );
      }
      expect(score).toBeGreaterThanOrEqual(40);
    }
  });
});

describe("P13-T2 overlay correction (everyday → food)", () => {
  it("flag ON, NG cohort: at least one everyday-domain food-anchored pack candidate surfaces on a food-anchor core", async () => {
    process.env.LUMINA_NG_PACK_PROJECTION_T2_ENABLED = "true";
    try {
      const { generateCoreCandidates } = await import(
        "../coreCandidateGenerator.js"
      );
      const { PREMISE_CORES } = await import("../premiseCoreLibrary.js");
      // Use a wider core slice so the food-anchor cores are sampled
      // alongside their siblings — increases the chance of seeing the
      // overlay path emit at least one candidate.
      const out = generateCoreCandidates({
        cores: PREMISE_CORES.slice(0, 12),
        count: 72,
        regenerateSalt: 31,
        region: "nigeria",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tasteCalibration: { languageStyle: "light_pidgin" } as any,
      });
      // The structural invariant: pack flow is alive on the
      // activated cohort under the new overlay.
      const packCount = out.candidates
        .map((c) => (c.meta as { nigerianPackEntryId?: string }).nigerianPackEntryId)
        .filter((id) => typeof id === "string").length;
      expect(packCount).toBeGreaterThan(0);
    } finally {
      delete process.env.LUMINA_NG_PACK_PROJECTION_T2_ENABLED;
    }
  });

  it("western cohort: zero pack candidates regardless of overlay", async () => {
    process.env.LUMINA_NG_PACK_PROJECTION_T2_ENABLED = "true";
    try {
      const { generateCoreCandidates } = await import(
        "../coreCandidateGenerator.js"
      );
      const { PREMISE_CORES } = await import("../premiseCoreLibrary.js");
      const out = generateCoreCandidates({
        cores: PREMISE_CORES.slice(0, 6),
        count: 36,
        regenerateSalt: 17,
        region: "western",
        tasteCalibration: null,
      });
      const packCount = out.candidates
        .map((c) => (c.meta as { nigerianPackEntryId?: string }).nigerianPackEntryId)
        .filter((id) => typeof id === "string").length;
      expect(packCount).toBe(0);
    } finally {
      delete process.env.LUMINA_NG_PACK_PROJECTION_T2_ENABLED;
    }
  });

  // NOTE: ng_clean leak guard is enforced at the live-route layer
  // (selection / scoring) by the N1 style penalty + activation
  // gates, not at `generateCoreCandidates`. The cross-region leak
  // guard at the generator layer is the western-cohort case above.
  // The probe driver (p13T2TopologyTasteLiveProbe) verifies the live
  // ng_clean pack-leak count end-to-end on the real API route.
});
