import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../db/client.js", () => {
  const state: { rows: Array<{ memory: unknown }>; lastUpdate?: unknown } = {
    rows: [],
  };

  const select = () => ({
    from: () => ({
      where: () => ({
        limit: async () => state.rows,
      }),
    }),
  });
  const update = () => ({
    set: (vals: { catalogTemplateSeenIdsJson: unknown }) => ({
      where: async () => {
        state.lastUpdate = vals.catalogTemplateSeenIdsJson;
        state.rows = [{ memory: vals.catalogTemplateSeenIdsJson }];
      },
    }),
  });

  return {
    db: {
      select: () => ({ ...select() }),
      update: () => ({ ...update() }),
    },
    schema: {
      creators: {
        catalogTemplateSeenIdsJson: "catalog_template_seen_ids_json",
        id: "id",
      },
    },
    __state: state,
  };
});

vi.mock("../logger.js", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  CATALOG_SKELETON_MEMORY_CAP,
  CATALOG_SKELETON_LONG_TOKEN_THRESHOLD,
  getRecentSeenSkeletons,
  normalizeHookToSkeleton,
  recordSeenSkeletons,
} from "../catalogTemplateCreatorMemory.js";
import * as dbModule from "../../db/client.js";

const getState = () =>
  (dbModule as unknown as { __state: { rows: Array<{ memory: unknown }>; lastUpdate?: unknown } }).__state;

beforeEach(() => {
  const s = getState();
  s.rows = [];
  s.lastUpdate = undefined;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("normalizeHookToSkeleton", () => {
  test("returns empty for empty / non-string input", () => {
    expect(normalizeHookToSkeleton("")).toBe("");
    expect(normalizeHookToSkeleton(undefined as unknown as string)).toBe("");
    expect(normalizeHookToSkeleton(null as unknown as string)).toBe("");
  });

  test("collapses surface noun variation in the canonical repeat skeletons", () => {
    // "the X and i are still here. barely." — exact symptom from
    // live batches 2 ("vacuum") + 4 ("groupchat") of the test sweep.
    expect(
      normalizeHookToSkeleton("the vacuum and i are still here. barely."),
    ).toBe(normalizeHookToSkeleton("the groupchat and i are still here. barely."));
    expect(
      normalizeHookToSkeleton("the inbox and i are still here. barely."),
    ).toBe(normalizeHookToSkeleton("the profile and i are still here. barely."));
  });

  test("collapses 'how to avoid the X in three steps' variants with 5+ char anchor", () => {
    expect(
      normalizeHookToSkeleton("how to avoid the fridge in three steps"),
    ).toBe(normalizeHookToSkeleton("how to avoid the laundry in three steps"));
    expect(
      normalizeHookToSkeleton("how to avoid the closet in three steps"),
    ).toBe(normalizeHookToSkeleton("how to avoid the inbox in three steps"));
  });

  test("collapses 'I am totally fine about the X' variants with 5+ char anchors", () => {
    // email=5→__, errand=6→__ — both collapse.
    expect(
      normalizeHookToSkeleton("I am totally fine about the email"),
    ).toBe(normalizeHookToSkeleton("I am totally fine about the errand"));
    // Different anchor word-COUNT (1 vs 2) intentionally does NOT
    // collapse — these surface as visually distinct hooks even
    // when the structural skeleton is the same family.
    expect(
      normalizeHookToSkeleton("I am totally fine about the email"),
    ).not.toBe(
      normalizeHookToSkeleton("I am totally fine about the typing dots"),
    );
  });

  test("does NOT collapse genuinely different hooks", () => {
    expect(
      normalizeHookToSkeleton("i checked one thing. ruined my day"),
    ).not.toBe(normalizeHookToSkeleton("i faked the profile AGAIN. AGAIN!!!"));
    expect(
      normalizeHookToSkeleton("watched myself ignore the statement live"),
    ).not.toBe(normalizeHookToSkeleton("blue ticks expose reply wey disappear"));
  });

  test("treats different short-word structures as different skeletons", () => {
    // "i SAID i'd fake the profile but NO" is structurally different
    // from "i faked the profile AGAIN" — must not collapse.
    expect(
      normalizeHookToSkeleton("i SAID i'd fake the profile but NO"),
    ).not.toBe(normalizeHookToSkeleton("i faked the profile AGAIN"));
  });

  test("is case- and punctuation-insensitive", () => {
    expect(
      normalizeHookToSkeleton("THE VACUUM AND I ARE STILL HERE. BARELY."),
    ).toBe(normalizeHookToSkeleton("the vacuum and i are still here, barely!"));
  });

  test("LONG_TOKEN_THRESHOLD is 5 (tuned against catalog templates)", () => {
    expect(CATALOG_SKELETON_LONG_TOKEN_THRESHOLD).toBe(5);
  });
});

describe("getRecentSeenSkeletons", () => {
  test("returns empty set for missing creatorId", async () => {
    expect(await getRecentSeenSkeletons(undefined)).toEqual(new Set());
  });

  test("returns empty set when column is empty", async () => {
    getState().rows = [{ memory: [] }];
    expect(await getRecentSeenSkeletons("c1")).toEqual(new Set());
  });

  test("returns empty set when column is null (pre-migration row)", async () => {
    getState().rows = [{ memory: null }];
    expect(await getRecentSeenSkeletons("c1")).toEqual(new Set());
  });

  test("returns the stored skeleton strings", async () => {
    getState().rows = [
      {
        memory: [
          { skeleton: "the __ and i are still here __", lastSeenAt: "2026-05-06T10:00:00Z" },
          { skeleton: "how to __ the __ in three __", lastSeenAt: "2026-05-06T09:00:00Z" },
        ],
      },
    ];
    const set = await getRecentSeenSkeletons("c1");
    expect(set.has("the __ and i are still here __")).toBe(true);
    expect(set.has("how to __ the __ in three __")).toBe(true);
    expect(set.size).toBe(2);
  });

  test("tolerates malformed entries in the JSONB column", async () => {
    getState().rows = [
      {
        memory: [
          { skeleton: "good", lastSeenAt: "2026-05-06T10:00:00Z" },
          { wrongShape: true },
          null,
          "string-not-object",
          { skeleton: 42, lastSeenAt: "x" },
        ],
      },
    ];
    expect(await getRecentSeenSkeletons("c1")).toEqual(new Set(["good"]));
  });
});

describe("recordSeenSkeletons", () => {
  test("is no-op for missing creatorId", async () => {
    await recordSeenSkeletons(undefined, ["the vacuum and i are still here barely"]);
    expect(getState().lastUpdate).toBeUndefined();
  });

  test("is no-op for empty list", async () => {
    await recordSeenSkeletons("c1", []);
    expect(getState().lastUpdate).toBeUndefined();
  });

  test("is no-op when all hooks normalize to empty", async () => {
    await recordSeenSkeletons("c1", ["", "   ", "!!!"]);
    expect(getState().lastUpdate).toBeUndefined();
  });

  test("normalizes hooks before storing", async () => {
    await recordSeenSkeletons("c1", [
      "the vacuum and i are still here. barely.",
    ]);
    const written = getState().lastUpdate as Array<{ skeleton: string }>;
    expect(written).toHaveLength(1);
    // still=5→__, vacuum=6→__, barely=6→__
    expect(written[0]?.skeleton).toBe("the __ and i are __ here __");
  });

  test("dedupes within a single record call by skeleton", async () => {
    // Both hooks normalize to the SAME skeleton — should store once.
    await recordSeenSkeletons("c1", [
      "the vacuum and i are still here. barely.",
      "the groupchat and i are still here. barely.",
    ]);
    const written = getState().lastUpdate as Array<{ skeleton: string }>;
    expect(written).toHaveLength(1);
  });

  test("merges with existing memory and dedupes (newer timestamp wins)", async () => {
    // Pre-seed the column with two entries — one we expect to keep
    // untouched ("old __") and one we expect a new record to
    // collide with by skeleton ("__ here").
    const sharedSkeletonOldTs = "2025-01-02T00:00:00Z";
    const oldOnlyTs = "2025-01-01T00:00:00Z";
    getState().rows = [
      {
        memory: [
          { skeleton: "old __", lastSeenAt: oldOnlyTs },
          // "the inbox" → normalized = "the __" (inbox≥5 → __).
          // We'll re-record it via a hook that produces the SAME
          // normalized skeleton to test dedup.
          { skeleton: "the __", lastSeenAt: sharedSkeletonOldTs },
        ],
      },
    ];
    // "the email" normalizes to "the __" too — should collide.
    await recordSeenSkeletons("c1", ["i am new", "the email"]);
    const written = getState().lastUpdate as Array<{
      skeleton: string;
      lastSeenAt: string;
    }>;
    const skels = written.map((e) => e.skeleton);
    expect(skels).toContain("old __");
    expect(skels).toContain("the __");
    expect(skels).toContain("i am new");
    expect(written.length).toBe(3);
    const collided = written.find((e) => e.skeleton === "the __");
    expect(collided?.lastSeenAt).not.toBe(sharedSkeletonOldTs);
    const untouched = written.find((e) => e.skeleton === "old __");
    expect(untouched?.lastSeenAt).toBe(oldOnlyTs);
  });

  test("caps at CATALOG_SKELETON_MEMORY_CAP, dropping oldest", async () => {
    const existing = Array.from({ length: 30 }, (_, i) => ({
      skeleton: `s${i}`,
      lastSeenAt: `2025-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
    }));
    getState().rows = [{ memory: existing }];
    // "go now" normalizes to "go now" (both <5 chars → kept verbatim).
    await recordSeenSkeletons("c1", ["go now"]);
    const written = getState().lastUpdate as Array<{ skeleton: string }>;
    expect(written.length).toBe(CATALOG_SKELETON_MEMORY_CAP);
    expect(written[0]?.skeleton).toBe("go now");
    expect(written.find((e) => e.skeleton === "s0")).toBeUndefined();
  });

  test("CATALOG_SKELETON_MEMORY_CAP is 24", () => {
    expect(CATALOG_SKELETON_MEMORY_CAP).toBe(24);
  });
});
