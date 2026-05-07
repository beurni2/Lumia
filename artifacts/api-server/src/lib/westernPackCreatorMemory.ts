/**
 * PHASE W2-K — per-creator Western APPROVED pack memory.
 *
 * Tracks which Western APPROVED entries each creator has already
 * seen in a recently shipped batch so the slot reservation step
 * can filter them out before picking. Prevents visible repetition
 * across consecutive Western batches.
 *
 * STORAGE: NO new column. Mines `creators.last_idea_batch_json`
 * (the existing cache envelope produced by `hybridIdeator.ts`'s
 * `toCacheEntries` / `persistCache`) for `westernPackEntryId`
 * fields stamped on each cached batch entry. Walks both the
 * envelope's `current` array and its `history` (newest-first) up
 * to the W2 memory cap.
 *
 * Hard rules:
 *   • No effect outside the western-activated cohort. Callers gate
 *     activation; this module is structural plumbing only.
 *   • Best-effort persistence: read failures NEVER fail the
 *     ideator request — log + swallow + return empty.
 *   • Pure aggregation — no PII, just opaque entry ids.
 *   • No migration: the cache JSONB is read tolerantly so pre-W2-K
 *     rows (no `westernPackEntryId` field) simply yield empty.
 */

import { eq } from "drizzle-orm";

import { db, schema } from "../db/client.js";
import { logger } from "./logger.js";

/** Maximum entries retained in the per-creator W2 memory window. */
export const WESTERN_PACK_MEMORY_CAP = 60;

/** A cached batch entry shape, narrowed to the field W2 cares about. */
interface CachedEntryWithW2 {
  westernPackEntryId?: unknown;
}

/**
 * Recursively scan an unknown JSON value for objects carrying a
 * string `westernPackEntryId` field. Returns ids in traversal order
 * (envelope-current first, then history newest-first by virtue of
 * how the envelope is written).
 *
 * Tolerant by design — the envelope shape is JSONB so any malformed
 * row simply yields fewer ids; we never throw.
 */
function collectW2EntryIds(raw: unknown, out: string[]): void {
  if (out.length >= WESTERN_PACK_MEMORY_CAP) return;
  if (raw === null || raw === undefined) return;
  if (Array.isArray(raw)) {
    for (const v of raw) {
      collectW2EntryIds(v, out);
      if (out.length >= WESTERN_PACK_MEMORY_CAP) return;
    }
    return;
  }
  if (typeof raw !== "object") return;
  const obj = raw as CachedEntryWithW2 & Record<string, unknown>;
  const id = obj.westernPackEntryId;
  if (typeof id === "string" && id.length > 0) {
    out.push(id);
    if (out.length >= WESTERN_PACK_MEMORY_CAP) return;
  }
  // Recurse into known envelope subtrees (current/history) AND into
  // any other object-valued fields defensively. The cache envelope
  // shape may evolve; the recursion keeps W2 memory robust to that.
  for (const v of Object.values(obj)) {
    if (v !== null && (typeof v === "object" || Array.isArray(v))) {
      collectW2EntryIds(v, out);
      if (out.length >= WESTERN_PACK_MEMORY_CAP) return;
    }
  }
}

/**
 * Returns the set of W2 entry ids the creator has seen recently.
 * Capped at WESTERN_PACK_MEMORY_CAP; mined from
 * `creators.last_idea_batch_json` (no migration).
 *
 * Empty Set on:
 *   • missing creatorId
 *   • DB read failure (logged, swallowed)
 *   • empty / NULL column
 *   • envelope contains no `westernPackEntryId` fields (pre-W2-K rows)
 */
export const getRecentSeenWesternEntryIds = async (
  creatorId: string | undefined,
): Promise<Set<string>> => {
  if (!creatorId) return new Set();
  try {
    const rows = await db
      .select({
        cache: schema.creators.lastIdeaBatchJson,
      })
      .from(schema.creators)
      .where(eq(schema.creators.id, creatorId))
      .limit(1);
    const raw = rows[0]?.cache;
    if (raw === null || raw === undefined) return new Set();
    const ids: string[] = [];
    collectW2EntryIds(raw, ids);
    return new Set(ids);
  } catch (err) {
    logger.warn(
      { err, creatorId },
      "western_pack.memory_read_failed",
    );
    return new Set();
  }
};

/**
 * Same data, ordered most-recent first (envelope `current` before
 * `history`). Useful if a future P1-style soft-cap rescue is added.
 * Currently used only by tests; the slot reservation reads the Set
 * variant above.
 */
export const getRecentSeenWesternEntriesOrdered = async (
  creatorId: string | undefined,
): Promise<ReadonlyArray<string>> => {
  if (!creatorId) return [];
  try {
    const rows = await db
      .select({
        cache: schema.creators.lastIdeaBatchJson,
      })
      .from(schema.creators)
      .where(eq(schema.creators.id, creatorId))
      .limit(1);
    const raw = rows[0]?.cache;
    if (raw === null || raw === undefined) return [];
    const ids: string[] = [];
    collectW2EntryIds(raw, ids);
    // De-dup preserving first occurrence (= most recent).
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  } catch (err) {
    logger.warn(
      { err, creatorId },
      "western_pack.memory_read_failed",
    );
    return [];
  }
};
