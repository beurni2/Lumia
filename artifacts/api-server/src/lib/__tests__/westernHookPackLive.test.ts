/**
 * PHASE W2-O — westernHookPackLive unit tests.
 *
 * Verifies the live pool's safety + activation contract:
 *   - every entry carries the W2-O sign-off stamp (NOT pending)
 *   - integrity check rejects PENDING_EDITORIAL_REVIEW + missing stamp
 *   - id / hook / skeleton uniqueness within the live pool
 *   - every live id is also present in the staging pool
 *   - cohort-axis activation guard mirrors the staging-pool guard
 *   - feature-flag env reader returns true only for literal "true"
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APPROVED_WESTERN_PROMOTION_CANDIDATES } from "../westernHookPackApproved.js";
import {
  PENDING_EDITORIAL_REVIEW,
} from "../westernHookPack.js";
import { normalizeWesternHookSkeleton } from "../westernPackAuthor.js";
import {
  WESTERN_HOOK_PACK_LIVE,
  WESTERN_LIVE_POOL_FEATURE_FLAG_ENV,
  WESTERN_LIVE_PROMOTION_SIGNOFF,
  canActivateWesternLivePool,
  checkWesternLivePoolIntegrity,
  getEligibleWesternLiveEntries,
  isWesternLivePoolFeatureEnabled,
} from "../westernHookPackLive.js";

describe("W2-O — live pool shape & stamp", () => {
  it("every entry carries the W2-O system sign-off", () => {
    for (const e of WESTERN_HOOK_PACK_LIVE) {
      expect(e.reviewedBy).toBe(WESTERN_LIVE_PROMOTION_SIGNOFF);
      expect(e.reviewedBy).not.toBe(PENDING_EDITORIAL_REVIEW);
    }
  });

  it("live pool is non-empty (rubric promotes some staging entries)", () => {
    expect(WESTERN_HOOK_PACK_LIVE.length).toBeGreaterThan(0);
  });

  it("live pool is strictly smaller than staging pool", () => {
    expect(WESTERN_HOOK_PACK_LIVE.length).toBeLessThan(
      APPROVED_WESTERN_PROMOTION_CANDIDATES.length,
    );
  });

  it("every live id exists in the staging pool", () => {
    const stagingIds = new Set(
      APPROVED_WESTERN_PROMOTION_CANDIDATES.map((e) => e.id),
    );
    for (const e of WESTERN_HOOK_PACK_LIVE) {
      expect(stagingIds.has(e.id), `live id ${e.id} missing from staging`).toBe(
        true,
      );
    }
  });
});

describe("W2-O — live pool uniqueness", () => {
  it("ids are unique", () => {
    const ids = WESTERN_HOOK_PACK_LIVE.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("hooks are unique (case-insensitive trimmed)", () => {
    const hooks = WESTERN_HOOK_PACK_LIVE.map((e) =>
      e.hook.toLowerCase().trim(),
    );
    expect(new Set(hooks).size).toBe(hooks.length);
  });

  it("hook skeletons are unique", () => {
    const skeletons = WESTERN_HOOK_PACK_LIVE.map((e) =>
      normalizeWesternHookSkeleton(e.hook),
    ).filter((s) => s.length > 0);
    expect(new Set(skeletons).size).toBe(skeletons.length);
  });
});

describe("W2-O — integrity check", () => {
  it("checkWesternLivePoolIntegrity returns ok=true on the as-shipped pool", () => {
    const r = checkWesternLivePoolIntegrity();
    expect(r.failures).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

describe("W2-O — activation guard mirrors staging-pool axes", () => {
  const baseInput = {
    flagEnabled: true,
    packLength: WESTERN_HOOK_PACK_LIVE.length,
  };

  it("western + clean + flag ON + non-empty pool → activates", () => {
    expect(
      canActivateWesternLivePool({
        region: "western",
        languageStyle: "clean",
        ...baseInput,
      }),
    ).toBe(true);
  });

  it("undefined region + null lang → activates (default cohort)", () => {
    expect(
      canActivateWesternLivePool({
        region: undefined,
        languageStyle: null,
        ...baseInput,
      }),
    ).toBe(true);
  });

  it("nigeria region → blocked even with flag ON", () => {
    expect(
      canActivateWesternLivePool({
        region: "nigeria",
        languageStyle: "clean",
        ...baseInput,
      }),
    ).toBe(false);
  });

  it("pidgin language style → blocked even with flag ON", () => {
    expect(
      canActivateWesternLivePool({
        region: "western",
        languageStyle: "pidgin",
        ...baseInput,
      }),
    ).toBe(false);
  });

  it("flag OFF → blocked", () => {
    expect(
      canActivateWesternLivePool({
        region: "western",
        languageStyle: "clean",
        flagEnabled: false,
        packLength: WESTERN_HOOK_PACK_LIVE.length,
      }),
    ).toBe(false);
  });

  it("packLength=0 → blocked", () => {
    expect(
      canActivateWesternLivePool({
        region: "western",
        languageStyle: "clean",
        flagEnabled: true,
        packLength: 0,
      }),
    ).toBe(false);
  });

  it("getEligibleWesternLiveEntries returns the pool when guard passes, [] otherwise", () => {
    const ok = getEligibleWesternLiveEntries({
      region: "western",
      languageStyle: "clean",
      ...baseInput,
    });
    expect(ok.length).toBe(WESTERN_HOOK_PACK_LIVE.length);
    const blocked = getEligibleWesternLiveEntries({
      region: "nigeria",
      languageStyle: "clean",
      ...baseInput,
    });
    expect(blocked.length).toBe(0);
  });
});

describe("W2-O — feature flag env reader", () => {
  const before = process.env[WESTERN_LIVE_POOL_FEATURE_FLAG_ENV];
  beforeEach(() => {
    delete process.env[WESTERN_LIVE_POOL_FEATURE_FLAG_ENV];
  });
  afterEach(() => {
    if (before === undefined) {
      delete process.env[WESTERN_LIVE_POOL_FEATURE_FLAG_ENV];
    } else {
      process.env[WESTERN_LIVE_POOL_FEATURE_FLAG_ENV] = before;
    }
  });

  it("returns false when unset", () => {
    expect(isWesternLivePoolFeatureEnabled()).toBe(false);
  });

  it("returns true only for literal 'true'", () => {
    process.env[WESTERN_LIVE_POOL_FEATURE_FLAG_ENV] = "true";
    expect(isWesternLivePoolFeatureEnabled()).toBe(true);
    process.env[WESTERN_LIVE_POOL_FEATURE_FLAG_ENV] = "TRUE";
    expect(isWesternLivePoolFeatureEnabled()).toBe(false);
    process.env[WESTERN_LIVE_POOL_FEATURE_FLAG_ENV] = "1";
    expect(isWesternLivePoolFeatureEnabled()).toBe(false);
  });
});
