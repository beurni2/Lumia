/**
 * PHASE N1-FULL-SPEC LIVE — per-creator CATALOG TEMPLATE memory.
 *
 * Mirrors `nigerianPackCreatorMemory.ts` but for `pattern_variation`
 * candidates that flow through the hybrid ideator. Records the
 * `meta.templateId` of every catalog candidate this creator has
 * already SEEN in a shipped batch, so the next request can filter
 * those template ids out of the merged pool BEFORE
 * `selectWithNovelty` picks. Prevents the visible-skeleton-
 * repetition failure mode (e.g. consecutive batches shipping
 * `the ${anchor} and i are still here. barely.` and
 * `how to avoid ${topicNoun} in three steps` with only the noun
 * swapped — exact symptom reported in live test batches 1 and 5).
 *
 * Storage: `creators.catalog_template_seen_ids_json` — a JSONB
 * array of `{ templateId, lastSeenAt }` objects, capped at the 24
 * most-recent ids (older drop off → become eligible again).
 *
 * Why 24? The active catalog template pool is ~30+ distinct ids in
 * any given run; capping memory below the pool size is a HARD
 * SAFETY GUARANTEE that filtering can never exhaust the pool. The
 * wiring step in `hybridIdeator.ts` adds an additional
 * underfill-safety re-admit-oldest-first fallback in case a
 * particular run's eligible-template subset is unusually narrow.
 *
 * Hard rules preserved here:
 *   • No validator, scorer, or anti-copy gate is touched. The filter
 *     happens against the candidate pool, not against any score or
 *     quality threshold — a filtered template is exactly equivalent
 *     to a template that wasn't generated this batch.
 *   • Best-effort persistence — write failures NEVER fail the
 *     ideator request. We log and swallow.
 *   • Pure aggregation — no PII, just opaque template ids.
 *   • Cohort-agnostic — applies to every creator with a stable id;
 *     repetition is a global complaint, not an N1-specific one.
 *     Pre-migration creators / fresh creators / no-id callers read
 *     `[]`, which is a no-op filter, so behaviour for them is
 *     byte-identical to the pre-fix baseline.
 */
import { eq } from "drizzle-orm";

import { db, schema } from "../db/client.js";
import { logger } from "./logger.js";

/** Maximum entries retained in the per-creator catalog memory window. */
export const CATALOG_TEMPLATE_MEMORY_CAP = 24;

interface SeenTemplate {
  readonly templateId: string;
  readonly lastSeenAt: string;
}

const isSeenTemplate = (v: unknown): v is SeenTemplate =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as { templateId?: unknown }).templateId === "string" &&
  typeof (v as { lastSeenAt?: unknown }).lastSeenAt === "string";

const readMemory = (raw: unknown): SeenTemplate[] => {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isSeenTemplate);
};

/**
 * Returns the ordered list of template ids the creator has seen
 * recently — most recent first by virtue of how `recordSeenTemplates`
 * writes the column. Returned as an ARRAY (not a Set) so the wiring
 * step can use the order for the underfill-safety re-admit-oldest
 * fallback.
 *
 * Returns an empty array on:
 *   • missing creatorId (caller has no creator)
 *   • DB read failure (logged, swallowed — never fail the request)
 *   • empty / NULL column (pre-migration row, fresh creator)
 */
export const getRecentSeenTemplateIds = async (
  creatorId: string | undefined,
): Promise<string[]> => {
  if (!creatorId) return [];
  try {
    const rows = await db
      .select({
        memory: schema.creators.catalogTemplateSeenIdsJson,
      })
      .from(schema.creators)
      .where(eq(schema.creators.id, creatorId))
      .limit(1);
    const memory = readMemory(rows[0]?.memory);
    return memory.map((m) => m.templateId);
  } catch (err) {
    logger.warn(
      { err, creatorId },
      "catalog_template.memory_read_failed",
    );
    return [];
  }
};

/**
 * Records that the creator has just seen the given template ids in
 * a shipped batch. Merges with existing memory, deduplicates by
 * templateId (newer lastSeenAt wins), and caps at the most-recent
 * CATALOG_TEMPLATE_MEMORY_CAP entries.
 *
 * No-op when:
 *   • creatorId is missing
 *   • templateIds is empty (e.g. a batch that shipped only pack
 *     entries and zero pattern_variation candidates)
 *   • DB write fails (logged, swallowed)
 */
export const recordSeenTemplates = async (
  creatorId: string | undefined,
  templateIds: ReadonlyArray<string>,
): Promise<void> => {
  if (!creatorId || templateIds.length === 0) return;
  try {
    const rows = await db
      .select({
        memory: schema.creators.catalogTemplateSeenIdsJson,
      })
      .from(schema.creators)
      .where(eq(schema.creators.id, creatorId))
      .limit(1);
    const existing = readMemory(rows[0]?.memory);

    const now = new Date().toISOString();
    const merged = new Map<string, SeenTemplate>();
    // New entries first so they win when a templateId appears in
    // both `templateIds` and `existing`.
    for (const templateId of templateIds) {
      merged.set(templateId, { templateId, lastSeenAt: now });
    }
    for (const e of existing) {
      if (!merged.has(e.templateId)) merged.set(e.templateId, e);
    }

    const capped = [...merged.values()]
      .sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1))
      .slice(0, CATALOG_TEMPLATE_MEMORY_CAP);

    await db
      .update(schema.creators)
      .set({
        catalogTemplateSeenIdsJson: capped,
      })
      .where(eq(schema.creators.id, creatorId));
  } catch (err) {
    logger.warn(
      { err, creatorId, templateIdCount: templateIds.length },
      "catalog_template.memory_write_failed",
    );
  }
};

/** Test-only helper — clear the memory for a creator. */
export const __resetCatalogMemoryForTests = async (
  creatorId: string,
): Promise<void> => {
  await db
    .update(schema.creators)
    .set({ catalogTemplateSeenIdsJson: [] })
    .where(eq(schema.creators.id, creatorId));
};
