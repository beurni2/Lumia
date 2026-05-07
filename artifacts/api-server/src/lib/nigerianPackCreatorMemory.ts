/**
 * PHASE N1-FULL-SPEC — per-creator Nigerian Comedy Pack memory.
 *
 * Tracks which approved-pack entries each creator has already seen
 * in a shipped batch, so the slot-reservation step can filter them
 * out before picking. Prevents the visible-repetition failure mode
 * where a creator running two consecutive Pidgin batches sees the
 * same hook twice in a row.
 *
 * Storage: `creators.nigerian_pack_seen_entry_ids_json` — a JSONB
 * array of `{ entryId, lastSeenAt }` objects, capped at the
 * 60 most-recent entries (older drop off → become eligible again).
 *
 * Hard rules from the spec preserved here:
 *   • No effect outside the Nigeria-activated cohort. Callers
 *     gate on activation; this module is structural plumbing only.
 *   • No score boost / no validator change — the filter happens in
 *     `applyNigerianPackSlotReservation` BEFORE the reserve-vs-
 *     non-pack composition, so a filtered batch can only DROP pack
 *     slots back toward 0, never inflate or change scoring.
 *   • Best-effort persistence: a write failure must NEVER fail the
 *     ideator request. We log and swallow.
 *   • Pure aggregation — no PII, just opaque entry ids.
 */
import { eq, sql } from "drizzle-orm";

import { db, schema } from "../db/client.js";
import { logger } from "./logger.js";

/** Maximum entries retained in the per-creator memory window. */
export const NIGERIAN_PACK_MEMORY_CAP = 60;

interface SeenEntry {
  readonly entryId: string;
  readonly lastSeenAt: string;
}

const isSeenEntry = (v: unknown): v is SeenEntry =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as { entryId?: unknown }).entryId === "string" &&
  typeof (v as { lastSeenAt?: unknown }).lastSeenAt === "string";

const readMemory = (raw: unknown): SeenEntry[] => {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isSeenEntry);
};

/**
 * Returns the set of entry ids the creator has seen recently. The
 * set is capped at NIGERIAN_PACK_MEMORY_CAP and ordered most-recent
 * first by virtue of how `recordSeenEntries` writes the column.
 *
 * Returns an empty Set on:
 *   • missing creatorId (caller has no creator)
 *   • DB read failure (logged, swallowed — never fail the request)
 *   • empty / NULL column (pre-migration row, fresh creator)
 */
export const getRecentSeenEntryIds = async (
  creatorId: string | undefined,
): Promise<Set<string>> => {
  if (!creatorId) return new Set();
  try {
    const rows = await db
      .select({
        memory: schema.creators.nigerianPackSeenEntryIdsJson,
      })
      .from(schema.creators)
      .where(eq(schema.creators.id, creatorId))
      .limit(1);
    const memory = readMemory(rows[0]?.memory);
    return new Set(memory.map((m) => m.entryId));
  } catch (err) {
    logger.warn(
      { err, creatorId },
      "nigerian_pack.memory_read_failed",
    );
    return new Set();
  }
};

/**
 * PHASE N1-LIVE-HARDEN P1 — ordered view of the per-creator memory.
 *
 * Returns the entry ids the creator has seen recently, ordered
 * MOST-RECENT FIRST (matching the order `recordSeenEntries` writes
 * into the JSONB column). Used by the memory soft-cap rescue path
 * in `applyNigerianPackSlotReservation` to drop the OLDEST half of
 * seen entries when the standard memory filter would otherwise
 * wipe the pack pool to zero.
 *
 * Same error-swallowing contract as `getRecentSeenEntryIds`:
 *   • Empty array on missing creatorId.
 *   • Empty array on DB read failure (logged, swallowed).
 *   • Empty array on empty / NULL column.
 *
 * The persisted column is NEVER mutated by this read or by the
 * soft-cap rescue path that consumes its output. The relaxation is
 * per-request only.
 */
export const getRecentSeenEntriesOrdered = async (
  creatorId: string | undefined,
): Promise<ReadonlyArray<string>> => {
  if (!creatorId) return [];
  try {
    const rows = await db
      .select({
        memory: schema.creators.nigerianPackSeenEntryIdsJson,
      })
      .from(schema.creators)
      .where(eq(schema.creators.id, creatorId))
      .limit(1);
    const memory = readMemory(rows[0]?.memory);
    // `recordSeenEntries` already sorts most-recent first when it
    // writes the column, but sort defensively here so a hand-edited
    // or migrated row can't surprise the rescue heuristic.
    return memory
      .slice()
      .sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1))
      .map((m) => m.entryId);
  } catch (err) {
    logger.warn(
      { err, creatorId },
      "nigerian_pack.memory_read_failed",
    );
    return [];
  }
};

/**
 * Records that the creator has just seen the given entry ids in a
 * shipped batch. Merges with existing memory, deduplicates by
 * entryId (newer lastSeenAt wins), and caps at the most-recent
 * NIGERIAN_PACK_MEMORY_CAP entries.
 *
 * No-op when:
 *   • creatorId is missing
 *   • entryIds is empty
 *   • DB write fails (logged, swallowed)
 */
export const recordSeenEntries = async (
  creatorId: string | undefined,
  entryIds: ReadonlyArray<string>,
): Promise<void> => {
  if (!creatorId || entryIds.length === 0) return;
  try {
    const rows = await db
      .select({
        memory: schema.creators.nigerianPackSeenEntryIdsJson,
      })
      .from(schema.creators)
      .where(eq(schema.creators.id, creatorId))
      .limit(1);
    const existing = readMemory(rows[0]?.memory);

    const now = new Date().toISOString();
    const merged = new Map<string, SeenEntry>();
    // New entries first so they win when an entryId is duplicated
    // in `existing`.
    for (const entryId of entryIds) {
      merged.set(entryId, { entryId, lastSeenAt: now });
    }
    for (const e of existing) {
      if (!merged.has(e.entryId)) merged.set(e.entryId, e);
    }

    const capped = [...merged.values()]
      .sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1))
      .slice(0, NIGERIAN_PACK_MEMORY_CAP);

    await db
      .update(schema.creators)
      .set({
        nigerianPackSeenEntryIdsJson: capped,
      })
      .where(eq(schema.creators.id, creatorId));
  } catch (err) {
    logger.warn(
      { err, creatorId, entryIdCount: entryIds.length },
      "nigerian_pack.memory_write_failed",
    );
  }
};

/** Test-only helper — clear the memory for a creator. */
export const __resetMemoryForTests = async (
  creatorId: string,
): Promise<void> => {
  await db
    .update(schema.creators)
    .set({ nigerianPackSeenEntryIdsJson: [] })
    .where(eq(schema.creators.id, creatorId));
};

// Suppress unused-import lint when sql is not referenced in a build.
void sql;
