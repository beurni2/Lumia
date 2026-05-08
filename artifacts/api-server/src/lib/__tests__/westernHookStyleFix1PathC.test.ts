/**
 * PHASE W2-R-FIX1 (Path C) — schema + author tests for the new
 * optional `westernHookStyle` field on `Idea`.
 *
 * Verifies the four invariants approved in the user brief:
 *   1. Old ideas WITHOUT `westernHookStyle` still parse (additive
 *      optional field, no migration).
 *   2. Ideas with a valid `WesternBatchHookStyle` value parse.
 *   3. Ideas with an out-of-vocabulary value are REJECTED by the
 *      validator (vocabulary integrity preserved).
 *   4. `authorWesternPackEntryAsIdea` populates `westernHookStyle`
 *      from `entry.hookStyle` verbatim, AND leaves the existing
 *      5-value `hookStyle` shape classifier set by `pickHookStyle`
 *      unchanged (parallel-field semantics, NOT replacement).
 *
 * No DB / network access. Pure unit tests.
 */

import { describe, expect, it } from "vitest";

import { ideaSchema, type Idea } from "../ideaGen.js";
import { authorWesternPackEntryAsIdea } from "../westernPackAuthor.js";
import {
  WESTERN_BATCH_HOOK_STYLES,
  type WesternHookPackDraftEntry,
} from "../westernHookPack.js";
import { WESTERN_HOOK_PACK_BATCH_NEXT } from "../westernHookPackBatchNext.js";

// Real-shape valid Idea fixture: author a known-good W2 idea once
// and reuse its full field set so the schema parse tests are not
// fragile to unrelated future field additions on `ideaSchema`.
const SOURCE_ENTRY: WesternHookPackDraftEntry | undefined =
  WESTERN_HOOK_PACK_BATCH_NEXT.find((e) => typeof e.hookStyle === "string");
function mkBaseIdea(over: Partial<Idea> = {}): unknown {
  if (!SOURCE_ENTRY) throw new Error("fixture missing — no W2-L entry");
  const r = authorWesternPackEntryAsIdea({
    entry: SOURCE_ENTRY,
    regenerateSalt: 0,
    seedFingerprints: new Set<string>(),
  });
  if (!r.ok) throw new Error(`fixture authoring failed: ${r.reason}`);
  // Author already populates `westernHookStyle` (Path C). Strip it
  // by default so the "legacy" parse test exercises the absence
  // path; tests that want it can re-add via `over`.
  const { westernHookStyle: _strip, ...rest } = r.idea;
  return { ...rest, ...over };
}

// Snapshot the fixture's actual hookStyle once so assertions that
// care about "the legacy field is unchanged" don't hard-code a
// guess.
const FIXTURE_HOOK_STYLE: string = (() => {
  const base = mkBaseIdea() as { hookStyle: string };
  return base.hookStyle;
})();

describe("PATH-C schema — `westernHookStyle` is OPTIONAL on Idea", () => {
  it("parses an Idea WITHOUT westernHookStyle (legacy / non-W2 row)", () => {
    const r = ideaSchema.safeParse(mkBaseIdea());
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.westernHookStyle).toBeUndefined();
      // Existing `hookStyle` field is unchanged.
      expect(r.data.hookStyle).toBe(FIXTURE_HOOK_STYLE);
    }
  });

  it("parses an Idea WITH a valid WesternBatchHookStyle value", () => {
    for (const v of WESTERN_BATCH_HOOK_STYLES) {
      const r = ideaSchema.safeParse(mkBaseIdea({ westernHookStyle: v }));
      expect(r.success, `expected '${v}' to parse`).toBe(true);
      if (r.success) {
        expect(r.data.westernHookStyle).toBe(v);
        // `hookStyle` field still required and untouched by the
        // new field's presence.
        expect(r.data.hookStyle).toBe(FIXTURE_HOOK_STYLE);
      }
    }
  });

  it("REJECTS an Idea with an out-of-vocabulary westernHookStyle (vocab integrity)", () => {
    // Pollute with a value that is NOT in WesternBatchHookStyle.
    // Examples: a value from the 5-value HookStyle enum (no overlap),
    // a typo, an empty string.
    const badValues = [
      "internal_thought", // legitimate HookStyle but NOT a WesternBatchHookStyle
      "the_way_i",
      "tiny_documentry", // typo
      "",
      "TINY_DOCUMENTARY", // wrong case
      "fake-tutorial", // wrong separator
    ];
    for (const v of badValues) {
      const r = ideaSchema.safeParse(
        mkBaseIdea({ westernHookStyle: v as unknown as Idea["westernHookStyle"] }),
      );
      expect(r.success, `expected '${v}' to be REJECTED`).toBe(false);
    }
  });

  it("REJECTS Idea where required `hookStyle` is missing — proves new field did NOT loosen any other validator", () => {
    const sample = mkBaseIdea();
    const obj = sample as Record<string, unknown>;
    delete obj.hookStyle;
    const r = ideaSchema.safeParse(obj);
    expect(r.success).toBe(false);
  });
});

describe("PATH-C author — `authorWesternPackEntryAsIdea` preserves curated hookStyle", () => {
  // Pick the first W2-L entry that ships with a hookStyle metadata
  // tag (W2-L / W2-N entries set hookStyle; W2-I early entries
  // may not). The brief requires at least one positive proof.
  const entryWithCuratedStyle: WesternHookPackDraftEntry | undefined =
    WESTERN_HOOK_PACK_BATCH_NEXT.find((e) => typeof e.hookStyle === "string");

  it("smoke: at least one W2-L entry exposes a curated hookStyle", () => {
    expect(entryWithCuratedStyle).toBeDefined();
    expect(entryWithCuratedStyle!.hookStyle).toBeDefined();
    expect(
      WESTERN_BATCH_HOOK_STYLES.includes(
        entryWithCuratedStyle!.hookStyle as never,
      ),
    ).toBe(true);
  });

  it("authored Idea sets idea.westernHookStyle === entry.hookStyle (verbatim passthrough)", () => {
    if (!entryWithCuratedStyle) throw new Error("fixture missing");
    const result = authorWesternPackEntryAsIdea({
      entry: entryWithCuratedStyle,
      regenerateSalt: 0,
      seedFingerprints: new Set<string>(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idea.westernHookStyle).toBe(entryWithCuratedStyle.hookStyle);
  });

  it("authored Idea ALSO sets the existing 5-value hookStyle (parallel field, not replacement)", () => {
    if (!entryWithCuratedStyle) throw new Error("fixture missing");
    const result = authorWesternPackEntryAsIdea({
      entry: entryWithCuratedStyle,
      regenerateSalt: 0,
      seedFingerprints: new Set<string>(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The 5-value SHAPE classifier is set by `pickHookStyle()` and
    // remains in the legacy enum.
    const HOOK_STYLE_5 = new Set([
      "the_way_i",
      "why_do_i",
      "contrast",
      "curiosity",
      "internal_thought",
    ]);
    expect(HOOK_STYLE_5.has(result.idea.hookStyle)).toBe(true);
    // The two enums share zero values — proving the parallel-field
    // design holds in practice.
    expect(WESTERN_BATCH_HOOK_STYLES.includes(result.idea.hookStyle as never))
      .toBe(false);
  });

  it("authored Idea round-trips through ideaSchema cleanly with both fields populated", () => {
    if (!entryWithCuratedStyle) throw new Error("fixture missing");
    const result = authorWesternPackEntryAsIdea({
      entry: entryWithCuratedStyle,
      regenerateSalt: 0,
      seedFingerprints: new Set<string>(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = ideaSchema.safeParse(result.idea);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.westernHookStyle).toBe(entryWithCuratedStyle.hookStyle);
    }
  });
});

/**
 * PHASE W2-R-FIX1 (Path C) — persisted-cache memory-axis regression
 * suite. Architect review flagged that
 * `westernPackCreatorMemory.collectW2Axes` mined `idea.hookStyle`
 * only, so after process restart the persisted memory axis would
 * collapse back to the legacy 5-value classifier — breaking
 * like-with-like alignment with the slot-reservation penalty
 * (`effectiveHookStyle = w.westernHookStyle ?? w.hookStyle`).
 *
 * These tests pin the fix: the cache miner must prefer
 * `idea.westernHookStyle` when present, fall back to
 * `idea.hookStyle`, and remain empty when neither is set.
 */
describe("W2-R-FIX1 Path C — persisted-cache memory mines westernHookStyle ?? hookStyle", () => {
  function emptyAcc() {
    return {
      entryIds: [] as string[],
      hooks: [] as string[],
      skeletons: [] as string[],
      anchors: [] as string[],
      families: [] as string[],
      spikes: [] as string[],
      settings: [] as string[],
      hookStyles: [] as string[],
    };
  }

  it("prefers idea.westernHookStyle when both fields are present", async () => {
    const { __collectW2AxesForTests } = await import(
      "../westernPackCreatorMemory.js"
    );
    const cached = {
      westernPackEntryId: "w2_test_001",
      idea: {
        hook: "test hook",
        hookStyle: "internal_thought",
        westernHookStyle: "object_betrayal",
      },
    };
    const acc = emptyAcc();
    __collectW2AxesForTests(cached, acc);
    expect(acc.hookStyles).toEqual(["object_betrayal"]);
  });

  it("falls back to idea.hookStyle when westernHookStyle is absent (legacy persisted rows)", async () => {
    const { __collectW2AxesForTests } = await import(
      "../westernPackCreatorMemory.js"
    );
    const cached = {
      westernPackEntryId: "w2_test_002",
      idea: { hook: "test hook", hookStyle: "internal_thought" },
    };
    const acc = emptyAcc();
    __collectW2AxesForTests(cached, acc);
    expect(acc.hookStyles).toEqual(["internal_thought"]);
  });

  it("records nothing when neither hook-style field is a string", async () => {
    const { __collectW2AxesForTests } = await import(
      "../westernPackCreatorMemory.js"
    );
    const cached = {
      westernPackEntryId: "w2_test_003",
      idea: { hook: "test hook" },
    };
    const acc = emptyAcc();
    __collectW2AxesForTests(cached, acc);
    expect(acc.hookStyles).toEqual([]);
  });

  it("recurses into envelope.history shape and prefers curated style for each W2 entry", async () => {
    const { __collectW2AxesForTests } = await import(
      "../westernPackCreatorMemory.js"
    );
    const envelope = {
      current: {
        westernPackEntryId: "w2_test_010",
        idea: {
          hook: "h",
          hookStyle: "internal_thought",
          westernHookStyle: "tiny_documentary",
        },
      },
      history: [
        [
          {
            westernPackEntryId: "w2_test_011",
            idea: {
              hook: "h2",
              hookStyle: "internal_thought",
              westernHookStyle: "before_after_self",
            },
          },
        ],
      ],
    };
    const acc = emptyAcc();
    __collectW2AxesForTests(envelope, acc);
    expect(acc.hookStyles).toEqual(["tiny_documentary", "before_after_self"]);
  });
});
