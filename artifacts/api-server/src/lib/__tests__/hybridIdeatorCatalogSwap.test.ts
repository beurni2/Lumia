/**
 * Regression tests for the post-pack-reservation catalog skeleton
 * swap (BI 2026-05-07 catalog repeat fix). The swap was previously
 * inline in `hybridIdeator.ts` and was extracted to
 * `applyCatalogSkeletonSwap` precisely so its contract — never drop,
 * never shrink the pool, prefer unseen alts, fall back to oldest-seen
 * alts, and never re-select an in-batch skeleton — can be exercised
 * here without spinning up the full ideator pipeline.
 *
 * The DB / logger mocks below mirror those in
 * `catalogTemplateCreatorMemory.test.ts`. They are required because
 * `catalogTemplateCreatorMemory.ts` imports `db`/`logger` at module
 * top-level even though `applyCatalogSkeletonSwap` itself is pure.
 */
import { describe, expect, test, vi } from "vitest";

vi.mock("../../db/client.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => undefined,
      }),
    }),
  },
  schema: {
    creators: {
      catalogTemplateSeenIdsJson: "catalog_template_seen_ids_json",
      id: "id",
    },
  },
}));

vi.mock("../logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import {
  applyCatalogSkeletonSwap,
  normalizeHookToSkeleton,
  type SkeletonSwapCandidate,
} from "../catalogTemplateCreatorMemory.js";

interface TestCandidate extends SkeletonSwapCandidate {
  readonly idea: {
    readonly id: string;
    readonly hook: string;
  };
  readonly meta: {
    readonly nigerianPackEntryId?: string;
  };
}

const mkCand = (
  id: string,
  hook: string,
  packEntryId?: string,
): TestCandidate => ({
  idea: { id, hook },
  meta: packEntryId === undefined ? {} : { nigerianPackEntryId: packEntryId },
});

describe("applyCatalogSkeletonSwap — regression suite", () => {
  test("when no unseen alt exists, falls back to a differing-but-seen alt and swap occurs", () => {
    // The repeating in-batch hook ("the vacuum and i are still here.
    // barely.") shares its skeleton with the creator's most-recent
    // seen entry. The merged pool offers two alts:
    //   1. An identical-skeleton hook ("the email …") — disqualified
    //      because the alt skeleton must DIFFER from the repeating one.
    //   2. A different-skeleton but ALSO-seen hook
    //      ("monday brain hit different already.") — this is the
    //      "fallback" tier — it should fire and the swap should occur.
    const repeatingHook = "the vacuum and i are still here. barely.";
    const sameSkAlt = "the email and i are still here. barely.";
    const diffSeenAlt = "monday brain hit different already.";
    const repeatingSk = normalizeHookToSkeleton(repeatingHook);
    const diffSeenSk = normalizeHookToSkeleton(diffSeenAlt);
    expect(repeatingSk).toBe(normalizeHookToSkeleton(sameSkAlt));
    expect(diffSeenSk).not.toBe(repeatingSk);

    const batch: TestCandidate[] = [
      mkCand("c1", repeatingHook),
      mkCand("c2", "totally fresh different hook here.", "pack-1"),
    ];
    const merged: TestCandidate[] = [
      ...batch,
      mkCand("alt-same", sameSkAlt),
      mkCand("alt-diff-seen", diffSeenAlt),
    ];
    // Both the repeating skeleton AND the differing alt's skeleton
    // are in the seen-set (no unseen alt available).
    const seen = new Set([repeatingSk, diffSeenSk]);
    const recency = new Map([
      [repeatingSk, 0],
      [diffSeenSk, 1],
    ]);

    const out = applyCatalogSkeletonSwap(batch, merged, seen, recency);

    expect(out).not.toBe(batch);
    expect(out).toHaveLength(batch.length);
    expect(out[0]?.idea.id).toBe("alt-diff-seen");
    // Pack candidate is never touched.
    expect(out[1]?.idea.id).toBe("c2");
  });

  test("when neither primary nor fallback finds an alt, the original ships and batch length is unchanged", () => {
    // Repeating skeleton is in the seen-set. The merged pool's only
    // non-pack alt has the SAME skeleton as the repeating one — no
    // valid replacement at any tier. Original ships, length preserved,
    // reference-equal return signals no-op to call sites.
    const repeatingHook = "the vacuum and i are still here. barely.";
    const sameSkAlt = "the inbox and i are still here. barely.";
    const repeatingSk = normalizeHookToSkeleton(repeatingHook);
    expect(normalizeHookToSkeleton(sameSkAlt)).toBe(repeatingSk);

    const batch: TestCandidate[] = [
      mkCand("c1", repeatingHook),
      mkCand("c2", "the groupchat and i are still here. barely."),
      mkCand("c3", "pack hook here.", "pack-7"),
    ];
    const merged: TestCandidate[] = [
      ...batch,
      mkCand("alt-same", sameSkAlt),
    ];
    const seen = new Set([repeatingSk]);
    const recency = new Map([[repeatingSk, 0]]);

    const out = applyCatalogSkeletonSwap(batch, merged, seen, recency);

    expect(out).toBe(batch); // reference-equal — no-op signal
    expect(out).toHaveLength(3);
    expect(out.map((c) => c.idea.id)).toEqual(["c1", "c2", "c3"]);
  });

  test("usedSkeletons bookkeeping prevents a later swap from re-selecting an in-batch duplicate skeleton", () => {
    // Initial batch contains TWO candidates with the same skeleton
    // (c1 and c2 — "the vacuum…" and "the inbox…"). Only c2's
    // skeleton is in the seen-set as a repeat trigger (we want one
    // swap candidate, not two, to keep the assertion crisp). The
    // merged pool offers an "alt" candidate whose skeleton — though
    // unseen by the creator — is IDENTICAL to the duplicated
    // in-batch skeleton. Because `usedSkeletons` was seeded from
    // the initial batch (and includes that duplicated skeleton), the
    // alt must be REJECTED even though it would otherwise score
    // highest (unseen = +∞). The picker must instead fall through
    // to the only other eligible alt (`alt-novel-real`) which has a
    // genuinely-distinct skeleton.
    const dupHookA = "the vacuum and i are still here. barely.";
    const dupHookB = "the inbox and i are still here. barely.";
    const altSameAsDup = "the profile and i are still here. barely.";
    const altNovelReal = "monday brain hit different already.";
    const dupSk = normalizeHookToSkeleton(dupHookA);
    expect(normalizeHookToSkeleton(dupHookB)).toBe(dupSk);
    expect(normalizeHookToSkeleton(altSameAsDup)).toBe(dupSk);
    const novelSk = normalizeHookToSkeleton(altNovelReal);
    expect(novelSk).not.toBe(dupSk);

    const batch: TestCandidate[] = [
      mkCand("c1", dupHookA),
      mkCand("c2", dupHookB),
      mkCand("c3", "completely unrelated stable hook one."),
    ];
    const merged: TestCandidate[] = [
      ...batch,
      mkCand("alt-same-as-dup", altSameAsDup),
      mkCand("alt-novel-real", altNovelReal),
    ];
    // Mark only the duplicated skeleton as seen → c1 and c2 both
    // trigger the swap path, but the picker must avoid re-using the
    // in-batch duplicate skeleton even though it appears unseen via
    // `alt-same-as-dup`.
    const seen = new Set([dupSk]);
    const recency = new Map([[dupSk, 0]]);

    const out = applyCatalogSkeletonSwap(batch, merged, seen, recency);

    expect(out).not.toBe(batch);
    expect(out).toHaveLength(3);
    // The first repeating candidate must swap to the genuinely-novel
    // alt. The duplicate-skeleton "alt" must NOT be selected, since
    // its skeleton was already in `usedSkeletons` from the initial
    // batch seeding.
    const ids = out.map((c) => c.idea.id);
    expect(ids).toContain("alt-novel-real");
    expect(ids).not.toContain("alt-same-as-dup");
    // c3 (untouched, distinct skeleton) is preserved.
    expect(ids).toContain("c3");
    // No skeleton appears more than once in the final shipped batch.
    const shippedSkeletons = out.map((c) =>
      normalizeHookToSkeleton(c.idea.hook),
    );
    const uniqueSkeletons = new Set(shippedSkeletons);
    expect(uniqueSkeletons.size).toBe(shippedSkeletons.length);
  });
});
