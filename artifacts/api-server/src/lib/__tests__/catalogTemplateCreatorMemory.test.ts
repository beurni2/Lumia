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
  CATALOG_TEMPLATE_MEMORY_CAP,
  getRecentSeenTemplateIds,
  recordSeenTemplates,
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

describe("catalogTemplateCreatorMemory", () => {
  test("getRecentSeenTemplateIds returns empty array for missing creatorId", async () => {
    const ids = await getRecentSeenTemplateIds(undefined);
    expect(ids).toEqual([]);
  });

  test("getRecentSeenTemplateIds returns empty array when column is empty", async () => {
    getState().rows = [{ memory: [] }];
    const ids = await getRecentSeenTemplateIds("creator-1");
    expect(ids).toEqual([]);
  });

  test("getRecentSeenTemplateIds returns empty array when column is null", async () => {
    getState().rows = [{ memory: null }];
    const ids = await getRecentSeenTemplateIds("creator-1");
    expect(ids).toEqual([]);
  });

  test("getRecentSeenTemplateIds returns templateIds in stored order", async () => {
    getState().rows = [
      {
        memory: [
          { templateId: "tpl-a", lastSeenAt: "2026-05-06T10:00:00Z" },
          { templateId: "tpl-b", lastSeenAt: "2026-05-06T09:00:00Z" },
        ],
      },
    ];
    const ids = await getRecentSeenTemplateIds("creator-1");
    expect(ids).toEqual(["tpl-a", "tpl-b"]);
  });

  test("getRecentSeenTemplateIds tolerates malformed entries", async () => {
    getState().rows = [
      {
        memory: [
          { templateId: "tpl-good", lastSeenAt: "2026-05-06T10:00:00Z" },
          { wrongShape: true },
          null,
          "string-not-object",
          { templateId: 42, lastSeenAt: "x" },
        ],
      },
    ];
    const ids = await getRecentSeenTemplateIds("creator-1");
    expect(ids).toEqual(["tpl-good"]);
  });

  test("recordSeenTemplates is no-op for missing creatorId", async () => {
    await recordSeenTemplates(undefined, ["tpl-a"]);
    expect(getState().lastUpdate).toBeUndefined();
  });

  test("recordSeenTemplates is no-op for empty list", async () => {
    await recordSeenTemplates("creator-1", []);
    expect(getState().lastUpdate).toBeUndefined();
  });

  test("recordSeenTemplates writes new templateIds with current timestamp", async () => {
    await recordSeenTemplates("creator-1", ["tpl-a", "tpl-b"]);
    const written = getState().lastUpdate as Array<{
      templateId: string;
      lastSeenAt: string;
    }>;
    expect(written).toHaveLength(2);
    expect(written.map((e) => e.templateId).sort()).toEqual(["tpl-a", "tpl-b"]);
    written.forEach((e) => {
      expect(typeof e.lastSeenAt).toBe("string");
      expect(e.lastSeenAt.length).toBeGreaterThan(0);
    });
  });

  test("recordSeenTemplates merges with existing memory and dedupes", async () => {
    getState().rows = [
      {
        memory: [
          { templateId: "tpl-old", lastSeenAt: "2025-01-01T00:00:00Z" },
          { templateId: "tpl-shared", lastSeenAt: "2025-01-02T00:00:00Z" },
        ],
      },
    ];
    await recordSeenTemplates("creator-1", ["tpl-new", "tpl-shared"]);
    const written = getState().lastUpdate as Array<{
      templateId: string;
      lastSeenAt: string;
    }>;
    const ids = written.map((e) => e.templateId);
    expect(ids).toContain("tpl-old");
    expect(ids).toContain("tpl-shared");
    expect(ids).toContain("tpl-new");
    expect(ids.length).toBe(3);
    // tpl-shared keeps the NEW timestamp, not the old one (newer wins)
    const shared = written.find((e) => e.templateId === "tpl-shared");
    expect(shared?.lastSeenAt).not.toBe("2025-01-02T00:00:00Z");
  });

  test("recordSeenTemplates caps at CATALOG_TEMPLATE_MEMORY_CAP, dropping oldest", async () => {
    // Existing memory: 30 entries, oldest first being "tpl-00"
    const existing = Array.from({ length: 30 }, (_, i) => ({
      templateId: `tpl-${String(i).padStart(2, "0")}`,
      lastSeenAt: `2025-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
    }));
    getState().rows = [{ memory: existing }];
    await recordSeenTemplates("creator-1", ["tpl-NEW"]);
    const written = getState().lastUpdate as Array<{
      templateId: string;
      lastSeenAt: string;
    }>;
    expect(written.length).toBe(CATALOG_TEMPLATE_MEMORY_CAP);
    expect(written[0]?.templateId).toBe("tpl-NEW");
    // Oldest entries dropped
    expect(written.find((e) => e.templateId === "tpl-00")).toBeUndefined();
  });

  test("CATALOG_TEMPLATE_MEMORY_CAP is 24 (smaller than active template pool ~30+)", () => {
    // Hard safety: cap MUST be smaller than the active template pool
    // so filtering can never exhaust it. If this ever changes, the
    // underfill-safety re-admit fallback in hybridIdeator becomes
    // load-bearing instead of belt-and-suspenders.
    expect(CATALOG_TEMPLATE_MEMORY_CAP).toBe(24);
  });
});
