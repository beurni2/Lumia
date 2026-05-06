/**
 * PHASE N1-FULL-SPEC LIVE — per-creator CATALOG hook-skeleton memory.
 *
 * Tracks a normalized "skeleton" form of every catalog hook this
 * creator has SEEN in a recent shipped batch, so the hybrid ideator
 * can SWAP a repeating skeleton out of the next batch's selection
 * (NOT pre-filter the candidate pool — that was the previous
 * iteration's failure mode; pool shrinkage caused selectWithNovelty
 * to underfill and trigger Claude fallback on every batch).
 *
 * Why a "skeleton" instead of a templateId or a literal hook?
 *   • templateId is per-source — `pattern_variation` has it, but
 *     `core_native` does not, and the same hook structure ships
 *     through multiple source paths. Filtering on templateId only
 *     caught one path.
 *   • Literal hook never repeats — only the surface noun changes
 *     ("the vacuum…" → "the groupchat…"), so per-hook memory
 *     misses every actually-visible repeat.
 *   • Normalized skeleton (lowercase + punctuation-stripped + every
 *     token of 6+ chars replaced with `__`) collapses surface noun
 *     variation into a single fingerprint, regardless of source.
 *
 * Storage: `creators.catalog_template_seen_ids_json` — same JSONB
 * column as the previous iteration (kept the column name for
 * migration stability), but the stored shape is now
 * `{ skeleton, lastSeenAt }`. Capped at the 24 most-recent skeletons
 * (older drop off → become eligible again).
 *
 * Hard rules preserved:
 *   • No validator, scorer, or anti-copy gate is touched. The
 *     wiring step never DROPS candidates — only swaps them when an
 *     alternative with a different skeleton is available — so the
 *     candidate pool seen by `selectWithNovelty` is unchanged and
 *     latency is unaffected (the previous iteration's regression
 *     came from pool shrinkage, not from the memory layer itself).
 *   • Best-effort persistence — write failures NEVER fail the
 *     ideator request.
 *   • Cohort-agnostic — repetition is a global complaint, not
 *     N1-specific. Pre-migration / fresh / no-id callers read `[]`
 *     (no-op), byte-identical to baseline.
 *   • Pure aggregation — no PII, just opaque skeleton strings that
 *     contain only function-words (long content tokens are masked).
 */
import { eq } from "drizzle-orm";

import { db, schema } from "../db/client.js";
import { logger } from "./logger.js";

/** Maximum skeletons retained in the per-creator memory window. */
export const CATALOG_SKELETON_MEMORY_CAP = 24;

/**
 * Token-length threshold for skeleton normalization. Tokens of 5+
 * characters (likely content nouns / verbs that vary per render)
 * are replaced with `__`; shorter tokens (function words: the, and,
 * i, am, my, no, but, …) are kept. Empirically tuned against the
 * actual catalog template strings.
 *
 * Threshold 5 was chosen over 6 because the canonical "still here.
 * barely." family includes short-noun renders ("inbox" = 5,
 * "email" = 5) that 6 leaves un-masked, leading to false-negatives
 * on the most-complained-about visible repeat. At 5, every member
 * of that family — vacuum, inbox, profile, email, groupchat —
 * collapses to the same skeleton.
 *
 * Loosening to ≥7 fails to catch most real repeats. Tightening
 * further (≥4) over-collapses unrelated templates whose nouns
 * happen to share a length bucket.
 */
export const CATALOG_SKELETON_LONG_TOKEN_THRESHOLD = 5;

interface SeenSkeleton {
  readonly skeleton: string;
  readonly lastSeenAt: string;
}

const isSeenSkeleton = (v: unknown): v is SeenSkeleton =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as { skeleton?: unknown }).skeleton === "string" &&
  typeof (v as { lastSeenAt?: unknown }).lastSeenAt === "string";

const readMemory = (raw: unknown): SeenSkeleton[] => {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isSeenSkeleton);
};

/**
 * Normalize a hook string to its skeleton form for repeat detection.
 *
 * Algorithm:
 *   1. Lowercase
 *   2. Strip punctuation (keep alphanumerics, apostrophes, spaces)
 *   3. Collapse whitespace
 *   4. Tokenize on spaces
 *   5. Replace every token of `LONG_TOKEN_THRESHOLD`+ characters
 *      with `__` (likely a content noun that varies per render)
 *   6. Rejoin
 *
 * Returns `""` for empty / non-string input.
 */
export const normalizeHookToSkeleton = (hook: string): string => {
  if (typeof hook !== "string" || hook.length === 0) return "";
  const cleaned = hook
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0) return "";
  return cleaned
    .split(" ")
    .map((tok) =>
      tok.length >= CATALOG_SKELETON_LONG_TOKEN_THRESHOLD ? "__" : tok,
    )
    .join(" ");
};

/**
 * Returns the set of skeleton fingerprints the creator has seen
 * recently. Returns an empty Set on:
 *   • missing creatorId
 *   • DB read failure (logged, swallowed)
 *   • empty / NULL column (pre-migration row, fresh creator)
 */
export const getRecentSeenSkeletons = async (
  creatorId: string | undefined,
): Promise<Set<string>> => {
  if (!creatorId) return new Set();
  try {
    const rows = await db
      .select({
        memory: schema.creators.catalogTemplateSeenIdsJson,
      })
      .from(schema.creators)
      .where(eq(schema.creators.id, creatorId))
      .limit(1);
    const memory = readMemory(rows[0]?.memory);
    return new Set(memory.map((m) => m.skeleton));
  } catch (err) {
    logger.warn(
      { err, creatorId },
      "catalog_skeleton.memory_read_failed",
    );
    return new Set();
  }
};

/**
 * Records that the creator has just seen the given HOOK STRINGS
 * (raw, not pre-normalized — the helper normalizes internally so
 * call sites can stay agnostic). Merges with existing memory,
 * deduplicates by skeleton (newer lastSeenAt wins), and caps at the
 * most-recent CATALOG_SKELETON_MEMORY_CAP entries.
 *
 * No-op when:
 *   • creatorId is missing
 *   • hooks is empty
 *   • DB write fails (logged, swallowed)
 *   • all hooks normalize to the empty string (defensive)
 */
export const recordSeenSkeletons = async (
  creatorId: string | undefined,
  hooks: ReadonlyArray<string>,
): Promise<void> => {
  if (!creatorId || hooks.length === 0) return;
  const newSkeletons = hooks
    .map(normalizeHookToSkeleton)
    .filter((s) => s.length > 0);
  if (newSkeletons.length === 0) return;
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
    const merged = new Map<string, SeenSkeleton>();
    // New entries first so they win on duplicate skeleton.
    for (const skeleton of newSkeletons) {
      merged.set(skeleton, { skeleton, lastSeenAt: now });
    }
    for (const e of existing) {
      if (!merged.has(e.skeleton)) merged.set(e.skeleton, e);
    }

    const capped = [...merged.values()]
      .sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1))
      .slice(0, CATALOG_SKELETON_MEMORY_CAP);

    await db
      .update(schema.creators)
      .set({
        catalogTemplateSeenIdsJson: capped,
      })
      .where(eq(schema.creators.id, creatorId));
  } catch (err) {
    logger.warn(
      { err, creatorId, hookCount: hooks.length },
      "catalog_skeleton.memory_write_failed",
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
