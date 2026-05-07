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
  getRecentSeenSkeletonRecency,
  normalizeHookToSkeleton,
  pickRecencyScoredAltIndex,
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
    const existing = Array.from({ length: 60 }, (_, i) => ({
      skeleton: `s${i}`,
      lastSeenAt: `2025-01-01T${String(i).padStart(2, "0")}:00:00Z`,
    }));
    getState().rows = [{ memory: existing }];
    // "go now" normalizes to "go now" (both <5 chars → kept verbatim).
    await recordSeenSkeletons("c1", ["go now"]);
    const written = getState().lastUpdate as Array<{ skeleton: string }>;
    expect(written.length).toBe(CATALOG_SKELETON_MEMORY_CAP);
    expect(written[0]?.skeleton).toBe("go now");
    expect(written.find((e) => e.skeleton === "s0")).toBeUndefined();
  });

  test("CATALOG_SKELETON_MEMORY_CAP is 48", () => {
    expect(CATALOG_SKELETON_MEMORY_CAP).toBe(48);
  });
});

describe("getRecentSeenSkeletonRecency", () => {
  test("returns empty Map for missing creatorId", async () => {
    expect(await getRecentSeenSkeletonRecency(undefined)).toEqual(
      new Map(),
    );
  });

  test("returns empty Map when row is missing or memory is empty", async () => {
    getState().rows = [];
    expect(await getRecentSeenSkeletonRecency("c1")).toEqual(new Map());
    getState().rows = [{ memory: [] }];
    expect(await getRecentSeenSkeletonRecency("c1")).toEqual(new Map());
  });

  test("ranks newest = 0, older = larger (regardless of array order)", async () => {
    // Stored array intentionally NOT in chronological order — the
    // helper must sort by lastSeenAt desc to assign ranks.
    getState().rows = [
      {
        memory: [
          { skeleton: "old", lastSeenAt: "2025-01-01T00:00:00Z" },
          { skeleton: "newest", lastSeenAt: "2025-01-03T00:00:00Z" },
          { skeleton: "middle", lastSeenAt: "2025-01-02T00:00:00Z" },
        ],
      },
    ];
    const m = await getRecentSeenSkeletonRecency("c1");
    expect(m.get("newest")).toBe(0);
    expect(m.get("middle")).toBe(1);
    expect(m.get("old")).toBe(2);
  });

  test("scoring contract: unseen > oldest seen > most-recent seen", async () => {
    // Mirrors the picker logic in hybridIdeator.ts: score is
    // +Infinity for unseen skeletons, otherwise the rank from the
    // recency map (larger = older = preferred when no unseen alts).
    getState().rows = [
      {
        memory: [
          { skeleton: "recent", lastSeenAt: "2025-01-03T00:00:00Z" },
          { skeleton: "oldest", lastSeenAt: "2025-01-01T00:00:00Z" },
        ],
      },
    ];
    const m = await getRecentSeenSkeletonRecency("c1");
    const scoreOf = (sk: string): number => {
      const r = m.get(sk);
      return r === undefined ? Number.POSITIVE_INFINITY : r;
    };
    expect(scoreOf("never_seen")).toBe(Number.POSITIVE_INFINITY);
    expect(scoreOf("oldest")).toBe(1);
    expect(scoreOf("recent")).toBe(0);
    expect(scoreOf("never_seen")).toBeGreaterThan(scoreOf("oldest"));
    expect(scoreOf("oldest")).toBeGreaterThan(scoreOf("recent"));
  });

  test("returns -1 when no eligible alt exists (helper contract)", () => {
    // All alts blocked: same-as-sk, in usedSkeletons, or empty.
    const recency = new Map<string, number>();
    expect(
      pickRecencyScoredAltIndex(
        "sk_a",
        ["sk_a", "sk_b", ""],
        new Set<string>(["sk_b"]),
        recency,
      ),
    ).toBe(-1);
    expect(pickRecencyScoredAltIndex("sk_a", [], new Set(), recency)).toBe(
      -1,
    );
  });

  test("scoring ordering: unseen > oldest seen > newest seen (helper contract)", () => {
    // Mirrors the swap site in hybridIdeator.ts. Pool intentionally
    // ordered [newest_seen, oldest_seen, unseen] so a deterministic
    // first-match would have picked index 0; the recency picker must
    // pick index 2 (unseen).
    const recency = new Map<string, number>([
      ["newest", 0],
      ["oldest", 5],
    ]);
    expect(
      pickRecencyScoredAltIndex(
        "repeating",
        ["newest", "oldest", "unseen"],
        new Set<string>(),
        recency,
      ),
    ).toBe(2);
    // Drop the unseen alt — picker must fall back to oldest seen
    // (index 1), NOT the deterministic first-match (index 0).
    expect(
      pickRecencyScoredAltIndex(
        "repeating",
        ["newest", "oldest"],
        new Set<string>(),
        recency,
      ),
    ).toBe(1);
    // Also fall back to newest if oldest is blocked by usedSkeletons.
    expect(
      pickRecencyScoredAltIndex(
        "repeating",
        ["newest", "oldest"],
        new Set<string>(["oldest"]),
        recency,
      ),
    ).toBe(0);
  });

  test("first-write-wins on duplicate skeleton entries (most-recent rank kept)", async () => {
    getState().rows = [
      {
        memory: [
          { skeleton: "dup", lastSeenAt: "2025-01-03T00:00:00Z" },
          { skeleton: "other", lastSeenAt: "2025-01-02T00:00:00Z" },
          { skeleton: "dup", lastSeenAt: "2025-01-01T00:00:00Z" },
        ],
      },
    ];
    const m = await getRecentSeenSkeletonRecency("c1");
    // After sort desc: dup(rank 0), other(rank 1), dup(rank 2 — skipped)
    expect(m.get("dup")).toBe(0);
    expect(m.get("other")).toBe(1);
    expect(m.size).toBe(2);
  });
});
