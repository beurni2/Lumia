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
 * `toCacheEntries` / `persistCache`) for `westernPackEntryId` AND
 * the W2-K2 axis fields (skeleton/anchor/family/spike/setting)
 * stamped on each cached batch entry. Walks both the envelope's
 * `current` array and its `history` (newest-first) up to the W2
 * memory cap.
 *
 * Hard rules:
 *   • No effect outside the western-activated cohort. Callers gate
 *     activation; this module is structural plumbing only.
 *   • Best-effort persistence: read failures NEVER fail the
 *     ideator request — log + swallow + return empty.
 *   • Pure aggregation — no PII, just opaque entry ids and short
 *     editorially-curated axis tags.
 *   • No migration: the cache JSONB is read tolerantly so pre-W2-K2
 *     rows (no axis fields) simply yield empty axis sets while the
 *     entryId set still works.
 */

import { eq } from "drizzle-orm";

import { db, schema } from "../db/client.js";
import { logger } from "./logger.js";

/** Maximum entries retained in the per-creator W2 memory window. */
export const WESTERN_PACK_MEMORY_CAP = 60;

/**
 * PHASE W2-K2 — process-local in-memory fallback for creators whose
 * cache row is NEVER persisted (`creator.isDemo === true` short-
 * circuits `persistCache` in `hybridIdeator.ts`). Without this, the
 * demo creator's batch envelope is never written, so every request's
 * `getRecentSeenWesternAxes` reads an empty Set and the cross-batch
 * dedup is a no-op.
 *
 * Bounded LRU keyed by creatorId; per-axis cap mirrors the cache-
 * mined cap above. Pure additive plumbing — non-demo flows still
 * read off the DB envelope (which `persistCache` already populates),
 * and the merge below uses the in-memory snapshot ONLY to extend the
 * mined Sets, never to override them. Map clears on process restart
 * (acceptable — staging QA only).
 */
const IN_MEMORY_DEMO_AXES_CAP = 64;
const inMemoryDemoAxes = new Map<
  string,
  {
    entryIds: string[];
    hooks: string[];
    skeletons: string[];
    anchors: string[];
    families: string[];
    spikes: string[];
    settings: string[];
  }
>();

function pushBounded(arr: string[], v: string): void {
  arr.unshift(v);
  if (arr.length > WESTERN_PACK_MEMORY_CAP)
    arr.length = WESTERN_PACK_MEMORY_CAP;
}

/**
 * PHASE W2-K2 — record axes from a freshly shipped W2 idea on the
 * process-local in-memory snapshot. Called by `hybridIdeator` once
 * per W2 idea AFTER slot reservation. Safe to call for non-demo
 * creators too — `getRecentSeenWesternAxes` merges both sources, so
 * the worst case is a few extra in-memory entries that duplicate
 * what the DB envelope already holds (idempotent under Set merge).
 */
export function recordW2InMemorySeen(
  creatorId: string | undefined,
  axes: {
    entryId?: string;
    hook?: string;
    skeleton?: string;
    anchor?: string;
    family?: string;
    spike?: string;
    setting?: string;
  },
): void {
  if (!creatorId) return;
  if (!axes.entryId) return;
  let bucket = inMemoryDemoAxes.get(creatorId);
  if (!bucket) {
    if (inMemoryDemoAxes.size >= IN_MEMORY_DEMO_AXES_CAP) {
      const firstKey = inMemoryDemoAxes.keys().next().value;
      if (typeof firstKey === "string") inMemoryDemoAxes.delete(firstKey);
    }
    bucket = {
      entryIds: [],
      hooks: [],
      skeletons: [],
      anchors: [],
      families: [],
      spikes: [],
      settings: [],
    };
    inMemoryDemoAxes.set(creatorId, bucket);
  }
  pushBounded(bucket.entryIds, axes.entryId);
  if (axes.hook) pushBounded(bucket.hooks, normHookForMemory(axes.hook));
  if (axes.skeleton) pushBounded(bucket.skeletons, axes.skeleton);
  if (axes.anchor) pushBounded(bucket.anchors, axes.anchor.toLowerCase());
  if (axes.family) pushBounded(bucket.families, axes.family);
  if (axes.spike) pushBounded(bucket.spikes, axes.spike);
  if (axes.setting) pushBounded(bucket.settings, axes.setting);
}

/** Test-only: clears the in-memory map. Not called from production
 *  code paths. */
export function __resetW2InMemoryForTests(): void {
  inMemoryDemoAxes.clear();
}

/** A cached batch entry shape, narrowed to the fields W2 cares about. */
interface CachedEntryWithW2Axes {
  westernPackEntryId?: unknown;
  westernPackHookSkeleton?: unknown;
  westernPackAnchor?: unknown;
  westernPackComedyFamily?: unknown;
  westernPackEmotionalSpike?: unknown;
  westernPackSetting?: unknown;
}

/** Aggregate of recent W2 axes across the cached envelope. Each set
 *  is capped at WESTERN_PACK_MEMORY_CAP independently. */
export interface WesternRecentAxes {
  entryIds: ReadonlySet<string>;
  hooks: ReadonlySet<string>;
  skeletons: ReadonlySet<string>;
  anchors: ReadonlySet<string>;
  families: ReadonlySet<string>;
  spikes: ReadonlySet<string>;
  settings: ReadonlySet<string>;
}

const EMPTY_AXES: WesternRecentAxes = {
  entryIds: new Set(),
  hooks: new Set(),
  skeletons: new Set(),
  anchors: new Set(),
  families: new Set(),
  spikes: new Set(),
  settings: new Set(),
};

/** Lower-case + collapse whitespace; matches what the slot
 *  reservation does for in-batch hook dedup. Kept identical so
 *  cross-batch and in-batch normalization compare equal. */
function normHookForMemory(h: string): string {
  return h.toLowerCase().trim().replace(/\s+/g, " ").replace(/[.,!?;:]+$/, "");
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
  const obj = raw as CachedEntryWithW2Axes & Record<string, unknown>;
  const id = obj.westernPackEntryId;
  if (typeof id === "string" && id.length > 0) {
    out.push(id);
    if (out.length >= WESTERN_PACK_MEMORY_CAP) return;
  }
  for (const v of Object.values(obj)) {
    if (v !== null && (typeof v === "object" || Array.isArray(v))) {
      collectW2EntryIds(v, out);
      if (out.length >= WESTERN_PACK_MEMORY_CAP) return;
    }
  }
}

/**
 * Recursively scan for ALL W2 axis fields in one pass. For each
 * batch entry that carries an entryId, collects the matching axis
 * tags onto their respective lists. This is one DB read producing
 * 7 ordered lists (no per-axis revisit of the JSONB envelope).
 *
 * The traversal also picks up the `idea.hook` next to a known W2
 * entryId so the hooks-set works for legacy envelopes that didn't
 * stamp the explicit axis fields yet.
 */
function collectW2Axes(
  raw: unknown,
  acc: {
    entryIds: string[];
    hooks: string[];
    skeletons: string[];
    anchors: string[];
    families: string[];
    spikes: string[];
    settings: string[];
  },
): void {
  if (raw === null || raw === undefined) return;
  if (Array.isArray(raw)) {
    for (const v of raw) collectW2Axes(v, acc);
    return;
  }
  if (typeof raw !== "object") return;
  const obj = raw as CachedEntryWithW2Axes & {
    idea?: { hook?: unknown };
  } & Record<string, unknown>;
  const id = obj.westernPackEntryId;
  const isW2Entry = typeof id === "string" && id.length > 0;
  if (isW2Entry) {
    if (acc.entryIds.length < WESTERN_PACK_MEMORY_CAP)
      acc.entryIds.push(id as string);
    const hook =
      obj.idea && typeof (obj.idea as { hook?: unknown }).hook === "string"
        ? ((obj.idea as { hook: string }).hook)
        : undefined;
    if (hook && acc.hooks.length < WESTERN_PACK_MEMORY_CAP)
      acc.hooks.push(normHookForMemory(hook));
    const skel = obj.westernPackHookSkeleton;
    if (typeof skel === "string" && skel.length > 0 &&
        acc.skeletons.length < WESTERN_PACK_MEMORY_CAP)
      acc.skeletons.push(skel);
    const anc = obj.westernPackAnchor;
    if (typeof anc === "string" && anc.length > 0 &&
        acc.anchors.length < WESTERN_PACK_MEMORY_CAP)
      acc.anchors.push(anc.toLowerCase());
    const fam = obj.westernPackComedyFamily;
    if (typeof fam === "string" && fam.length > 0 &&
        acc.families.length < WESTERN_PACK_MEMORY_CAP)
      acc.families.push(fam);
    const spk = obj.westernPackEmotionalSpike;
    if (typeof spk === "string" && spk.length > 0 &&
        acc.spikes.length < WESTERN_PACK_MEMORY_CAP)
      acc.spikes.push(spk);
    const set = obj.westernPackSetting;
    if (typeof set === "string" && set.length > 0 &&
        acc.settings.length < WESTERN_PACK_MEMORY_CAP)
      acc.settings.push(set);
  }
  // Recurse into nested objects/arrays (envelope.current,
  // envelope.history[i][j]). Stop recursing once every axis cap is
  // hit — saves work on long histories.
  const allCapsHit =
    acc.entryIds.length >= WESTERN_PACK_MEMORY_CAP &&
    acc.hooks.length >= WESTERN_PACK_MEMORY_CAP &&
    acc.skeletons.length >= WESTERN_PACK_MEMORY_CAP &&
    acc.anchors.length >= WESTERN_PACK_MEMORY_CAP &&
    acc.families.length >= WESTERN_PACK_MEMORY_CAP &&
    acc.spikes.length >= WESTERN_PACK_MEMORY_CAP &&
    acc.settings.length >= WESTERN_PACK_MEMORY_CAP;
  if (allCapsHit) return;
  for (const v of Object.values(obj)) {
    if (v !== null && (typeof v === "object" || Array.isArray(v))) {
      collectW2Axes(v, acc);
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
 * PHASE W2-K2 — single-DB-read aggregator that returns ALL recent
 * W2 axes (entryIds, hooks, skeletons, anchors, families, spikes,
 * settings) the creator has seen. Replaces multiple per-axis reads.
 *
 * Empty axes object on missing creator / DB failure / empty column.
 * Tolerant of legacy cache rows that pre-date the W2-K2 axis stamp:
 * those contribute to `entryIds` (and `hooks`, since hook is mined
 * off `idea.hook`) but yield empty `skeletons`/`anchors`/etc.
 */
export const getRecentSeenWesternAxes = async (
  creatorId: string | undefined,
): Promise<WesternRecentAxes> => {
  if (!creatorId) return EMPTY_AXES;
  try {
    const rows = await db
      .select({
        cache: schema.creators.lastIdeaBatchJson,
      })
      .from(schema.creators)
      .where(eq(schema.creators.id, creatorId))
      .limit(1);
    const raw = rows[0]?.cache;
    const acc = {
      entryIds: [] as string[],
      hooks: [] as string[],
      skeletons: [] as string[],
      anchors: [] as string[],
      families: [] as string[],
      spikes: [] as string[],
      settings: [] as string[],
    };
    if (raw !== null && raw !== undefined) collectW2Axes(raw, acc);
    // PHASE W2-K2 — merge in-memory demo fallback. Idempotent:
    // duplicates between DB envelope and in-memory store collapse
    // under Set construction. For non-demo creators the in-memory
    // bucket is typically absent (no record call fires unless a
    // batch shipped this process). For demo creators (where
    // `persistCache` short-circuits) this IS the only source.
    const mem = creatorId ? inMemoryDemoAxes.get(creatorId) : undefined;
    if (mem) {
      for (const v of mem.entryIds) acc.entryIds.push(v);
      for (const v of mem.hooks) acc.hooks.push(v);
      for (const v of mem.skeletons) acc.skeletons.push(v);
      for (const v of mem.anchors) acc.anchors.push(v);
      for (const v of mem.families) acc.families.push(v);
      for (const v of mem.spikes) acc.spikes.push(v);
      for (const v of mem.settings) acc.settings.push(v);
    }
    return {
      entryIds: new Set(acc.entryIds),
      hooks: new Set(acc.hooks),
      skeletons: new Set(acc.skeletons),
      anchors: new Set(acc.anchors),
      families: new Set(acc.families),
      spikes: new Set(acc.spikes),
      settings: new Set(acc.settings),
    };
  } catch (err) {
    logger.warn(
      { err, creatorId },
      "western_pack.memory_axes_read_failed",
    );
    return EMPTY_AXES;
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
