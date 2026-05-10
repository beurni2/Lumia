/**
 * PHASE N1-FOLLOWUP-NG-CLEAN-SLOT0-ANTI-REPEAT-SWAP — per-creator
 * recent-slot-0 memory for the Nigerian clean-English clean-core
 * mini-catalog.
 *
 * Records which `cleanCoreEntryId` was shipped at slot 0 of each
 * recent ng_clean batch so the post-rotation anti-repeat helper
 * (`applyNgCleanSlot0AntiRepeatSwap`) can rotate slot 0 away from
 * a recently-shown entry to the highest-ranked eligible clean-core
 * alternative whose entry id is NOT in the recent-memory set.
 *
 * Storage: `creators.nigerian_clean_core_slot0_seen_ids_json` —
 * a JSONB array of `{ entryId, lastSeenAt }` objects, capped at the
 * 20 most-recent entries (older drop off → become eligible again).
 *
 * Hard rules from the surface-check spec preserved here:
 *   • No effect outside the activated cohort. Callers gate on
 *     `region === "nigeria" + languageStyle === "clean"`; this
 *     module is structural plumbing only.
 *   • No score boost / no validator change — the swap helper is
 *     SWAP-ONLY (preserves the candidate identity set + count),
 *     and this memory is the only state it consults beyond the
 *     post-sort/post-rotation `final` array.
 *   • Best-effort persistence: a write failure must NEVER fail the
 *     ideator request. We log and swallow.
 *   • Pure aggregation — no PII, just opaque entry ids.
 *
 * Mirrors the shape and conventions of
 * `nigerianPackCreatorMemory.ts` (cap is 20 here, vs 60 there —
 * the slot-0 memory is single-entry-per-batch and a tighter cap
 * keeps the rotation gradient honest).
 */
import { eq, sql } from "drizzle-orm";

import { db, schema } from "../db/client.js";
import { logger } from "./logger.js";

/** Maximum entries retained in the per-creator slot-0 memory window. */
export const NIGERIAN_CLEAN_CORE_SLOT0_MEMORY_CAP = 20;

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
  // Defensive cap on read: the writer enforces the cap, but if
  // persisted data is ever malformed (manual edit, partial
  // migration) we still guarantee the in-process Set passed to
  // the swap helper is bounded.
  return raw
    .filter(isSeenEntry)
    .slice(0, NIGERIAN_CLEAN_CORE_SLOT0_MEMORY_CAP);
};

/**
 * Returns the set of clean-core entry ids the creator has shipped
 * at slot 0 recently. The set is capped at
 * NIGERIAN_CLEAN_CORE_SLOT0_MEMORY_CAP and ordered most-recent first
 * by virtue of how `recordSlot0CleanCoreEntryId` writes the column.
 *
 * Returns an empty Set on:
 *   • missing creatorId (caller has no creator)
 *   • DB read failure (logged, swallowed — never fail the request)
 *   • empty / NULL column (pre-migration row, fresh creator)
 */
export const getRecentSlot0CleanCoreEntryIds = async (
  creatorId: string | undefined,
): Promise<Set<string>> => {
  if (!creatorId) return new Set();
  try {
    const rows = await db
      .select({
        memory: schema.creators.nigerianCleanCoreSlot0SeenIdsJson,
      })
      .from(schema.creators)
      .where(eq(schema.creators.id, creatorId))
      .limit(1);
    const memory = readMemory(rows[0]?.memory);
    return new Set(memory.map((m) => m.entryId));
  } catch (err) {
    logger.warn(
      { err, creatorId },
      "nigerian_clean_core.slot0_memory_read_failed",
    );
    return new Set();
  }
};

/**
 * Records that the creator has just shipped the given clean-core
 * entry id at slot 0 of a batch. Merges with existing memory,
 * deduplicates by entryId (newer lastSeenAt wins), and caps at the
 * most-recent NIGERIAN_CLEAN_CORE_SLOT0_MEMORY_CAP entries.
 *
 * No-op when:
 *   • creatorId is missing
 *   • entryId is empty
 *   • DB write fails (logged, swallowed)
 */
export const recordSlot0CleanCoreEntryId = async (
  creatorId: string | undefined,
  entryId: string | undefined,
): Promise<void> => {
  if (!creatorId || !entryId) return;
  try {
    const rows = await db
      .select({
        memory: schema.creators.nigerianCleanCoreSlot0SeenIdsJson,
      })
      .from(schema.creators)
      .where(eq(schema.creators.id, creatorId))
      .limit(1);
    const existing = readMemory(rows[0]?.memory);

    const now = new Date().toISOString();
    const merged = new Map<string, SeenEntry>();
    // New entry first so it wins when entryId is duplicated in
    // `existing`.
    merged.set(entryId, { entryId, lastSeenAt: now });
    for (const e of existing) {
      if (!merged.has(e.entryId)) merged.set(e.entryId, e);
    }

    const capped = [...merged.values()]
      .sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1))
      .slice(0, NIGERIAN_CLEAN_CORE_SLOT0_MEMORY_CAP);

    await db
      .update(schema.creators)
      .set({
        nigerianCleanCoreSlot0SeenIdsJson: capped,
      })
      .where(eq(schema.creators.id, creatorId));
  } catch (err) {
    logger.warn(
      { err, creatorId, entryId },
      "nigerian_clean_core.slot0_memory_write_failed",
    );
  }
};

/** Test-only helper — clear the memory for a creator. */
export const __resetSlot0MemoryForTests = async (
  creatorId: string,
): Promise<void> => {
  await db
    .update(schema.creators)
    .set({ nigerianCleanCoreSlot0SeenIdsJson: [] })
    .where(eq(schema.creators.id, creatorId));
};

void sql;
