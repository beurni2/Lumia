/**
 * PHASE P16-A6-NG-CLEAN-SLOT1-MEMORY-ANTI-REPEAT (BI 2026-05-12) —
 * per-creator recent-slot-1+ memory for the Nigerian clean-English
 * `core_native` mini-catalog.
 *
 * Sibling of `nigerianCleanCoreCreatorMemory.ts` (which handles
 * slot-0). Records which `cleanCoreEntryId`s were shipped at the
 * NON-slot-0 positions of every recent ng_clean batch, so the
 * post-rank slot-1+ anti-repeat FILTER
 * (`applyNgCleanSlot1PlusAntiRepeatFilter`) can replace seen
 * slot-1+ clean-core entries with fresh sidecar entries.
 *
 * Storage: `creators.nigerian_clean_core_slot1plus_seen_ids_json` —
 * a JSONB array of `{ entryId, lastSeenAt }` objects, capped at
 * NIGERIAN_CLEAN_CORE_SLOT1PLUS_MEMORY_CAP most-recent entries
 * (older drop off → become eligible again). The slot-0 and
 * slot-1+ memory columns are EXPLICITLY DECOUPLED — see schema
 * comment on `nigerianCleanCoreSlot1PlusSeenIdsJson` (P16-A6
 * addendum §1).
 *
 * Hard rules from the addendum preserved here:
 *   • No effect outside the activated cohort. Callers gate on
 *     `region === "nigeria" + languageStyle === "clean"`; this
 *     module is structural plumbing only.
 *   • No score boost / no validator change — the filter helper is
 *     post-rank (preserves candidate identity set + count), and
 *     this memory is the only state it consults beyond the input
 *     `final` array and the sidecar.
 *   • Best-effort persistence: a write failure must NEVER fail the
 *     ideator request. We log and swallow.
 *   • Pure aggregation — no PII, just opaque entry ids.
 *
 * Mirrors the shape and conventions of `nigerianCleanCoreCreatorMemory.ts`.
 * Cap is 18 here, vs 20 there — slot-1+ writes typically 4-6 entries
 * per batch (vs 1 for slot-0), so 18 covers ~3 batches before the
 * oldest ages out, which matches the rotation gradient observed
 * in the P16-A4/A5 audit data (4-5 always-on entries in slot-1+).
 *
 * Window-size pre-check (per addendum §5):
 *   • Total clean-core pool: 87 entries (`NIGERIAN_CLEAN_CORE_ENTRIES`).
 *   • Eligible slot-1+ pool per batch (post-domain/voice/HQS gates):
 *     observed ~5-10 per batch in the P16-A4 audit.
 *   • Distinct emitted across history (rotation pool) approaches the
 *     full 87 over many batches.
 *   • 18 ≪ 87 ⇒ relaxation does not fire constantly. The default
 *     window is 18; if the rotation pool turns out to be too small in
 *     practice, the FALLBACK constant `..._MEMORY_CAP_FALLBACK = 12`
 *     is documented for future reduction.
 */
import { eq, sql } from "drizzle-orm";

import { db, schema } from "../db/client.js";
import { logger } from "./logger.js";

/** Maximum entries retained in the per-creator slot-1+ memory window.
 *  Default = 18 (~3 batches at 5-6 emitted slot-1+ clean-core entries
 *  per batch). FALLBACK = 12 documented for the small-pool relaxation
 *  case but not currently used; the relaxation path inside the filter
 *  helper handles small-pool cases gracefully without a constant
 *  change. */
export const NIGERIAN_CLEAN_CORE_SLOT1PLUS_MEMORY_CAP = 18;
/** Documented fallback per P16-A6 addendum §5 — used only if a
 *  future audit shows the relaxation path firing constantly. */
export const NIGERIAN_CLEAN_CORE_SLOT1PLUS_MEMORY_CAP_FALLBACK = 12;

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
  // the filter helper is bounded.
  return raw
    .filter(isSeenEntry)
    .slice(0, NIGERIAN_CLEAN_CORE_SLOT1PLUS_MEMORY_CAP);
};

/**
 * Returns the set of clean-core entry ids the creator has shipped
 * at slot 1+ recently. The set is capped at
 * NIGERIAN_CLEAN_CORE_SLOT1PLUS_MEMORY_CAP and ordered most-recent
 * first by virtue of how `recordSlot1PlusCleanCoreEntryIds` writes
 * the column.
 *
 * Returns an empty Set on:
 *   • missing creatorId (caller has no creator)
 *   • DB read failure (logged, swallowed — never fail the request).
 *     This includes the pre-migration "column does not exist"
 *     error which surfaces as a Postgres `42703`; the read will
 *     simply return `[]` and the filter helper will no-op until the
 *     additive migration is applied.
 *   • empty / NULL column (pre-migration row, fresh creator)
 */
export const getRecentSlot1PlusCleanCoreEntryIds = async (
  creatorId: string | undefined,
): Promise<Set<string>> => {
  if (!creatorId) return new Set();
  try {
    const rows = await db
      .select({
        memory: schema.creators.nigerianCleanCoreSlot1PlusSeenIdsJson,
      })
      .from(schema.creators)
      .where(eq(schema.creators.id, creatorId))
      .limit(1);
    const memory = readMemory(rows[0]?.memory);
    return new Set(memory.map((m) => m.entryId));
  } catch (err) {
    logger.warn(
      { err, creatorId },
      "nigerian_clean_core.slot1plus_memory_read_failed",
    );
    return new Set();
  }
};

/**
 * Records that the creator has just shipped the given clean-core
 * entry ids at slot 1+ of a batch. Merges with existing memory,
 * deduplicates by entryId (newer lastSeenAt wins), and caps at the
 * most-recent NIGERIAN_CLEAN_CORE_SLOT1PLUS_MEMORY_CAP entries.
 *
 * Caller is responsible for the per-emitted-id guard (P16-A6
 * addendum §4): only invoke with ids that satisfy
 *   • cohort is ng_clean
 *   • sourceType === "core_native" or equivalent clean-core marker
 *   • slotIndex >= 1
 *   • entry has a real ng_clean_* ID (resolved via
 *     `resolveCleanCoreEntryIdByHook`)
 *   • ID is not held / rejected
 *   • ID is actually emitted to the user-visible batch
 *
 * No-op when:
 *   • creatorId is missing
 *   • entryIds is empty
 *   • DB write fails (logged, swallowed). This includes the
 *     pre-migration "column does not exist" case.
 *
 * Plural variant of the slot-0 sibling — slot-1+ writes 4-6 entries
 * per batch vs 1 for slot-0. Performs a single UPDATE per call
 * regardless of how many ids are recorded.
 */
export const recordSlot1PlusCleanCoreEntryIds = async (
  creatorId: string | undefined,
  entryIds: ReadonlyArray<string>,
): Promise<void> => {
  if (!creatorId) return;
  const newIds = entryIds.filter(
    (id) => typeof id === "string" && id.length > 0,
  );
  if (newIds.length === 0) return;
  try {
    const rows = await db
      .select({
        memory: schema.creators.nigerianCleanCoreSlot1PlusSeenIdsJson,
      })
      .from(schema.creators)
      .where(eq(schema.creators.id, creatorId))
      .limit(1);
    const existing = readMemory(rows[0]?.memory);

    const now = new Date().toISOString();
    const merged = new Map<string, SeenEntry>();
    // New entries first so they win when entryId is duplicated in
    // `existing`. Walk in input order so a duplicate within
    // `entryIds` (shouldn't happen — filter helper dedups — but
    // belt-and-braces) keeps the FIRST occurrence's timestamp,
    // which is fine since they all share `now` anyway.
    for (const id of newIds) {
      if (!merged.has(id)) merged.set(id, { entryId: id, lastSeenAt: now });
    }
    for (const e of existing) {
      if (!merged.has(e.entryId)) merged.set(e.entryId, e);
    }

    const capped = [...merged.values()]
      .sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1))
      .slice(0, NIGERIAN_CLEAN_CORE_SLOT1PLUS_MEMORY_CAP);

    await db
      .update(schema.creators)
      .set({
        nigerianCleanCoreSlot1PlusSeenIdsJson: capped,
      })
      .where(eq(schema.creators.id, creatorId));
  } catch (err) {
    logger.warn(
      { err, creatorId, entryIds: newIds },
      "nigerian_clean_core.slot1plus_memory_write_failed",
    );
  }
};

/** Test-only helper — clear the memory for a creator. */
export const __resetSlot1PlusMemoryForTests = async (
  creatorId: string,
): Promise<void> => {
  await db
    .update(schema.creators)
    .set({ nigerianCleanCoreSlot1PlusSeenIdsJson: [] })
    .where(eq(schema.creators.id, creatorId));
};

void sql;
