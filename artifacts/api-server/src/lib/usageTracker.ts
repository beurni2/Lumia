/**
 * Per-creator usage tracking for the Llama cost-control + anti-abuse
 * layer. Backed by the existing `usage_counters(creator_id, day, kind,
 * count)` table — no schema changes. New `kind` values are opaque
 * strings that flow through the same parameter binding `quota.ts`
 * uses, so nothing about the existing quota gates is touched.
 *
 * The 2-min Llama-call window is in-memory only (a sliding window of
 * timestamps per creator). Lost on restart, which is fine for a
 * 2-minute signal — at worst the throttle is briefly re-armed after
 * a deploy. The same applies to the regenerate-cooldown timestamp.
 *
 * All DB writes are best-effort: a transient Postgres blip should
 * never block idea generation, only fuzz the counters slightly. Reads
 * fall back to zero when they fail. Demo creators bypass entirely
 * (the caller is responsible for honoring `creator.isDemo` — this
 * module has no opinion).
 */

import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { logger } from "./logger";

// -----------------------------------------------------------------------------
// Counter kinds — opaque strings, varchar(32) on the DB side.
// -----------------------------------------------------------------------------

export type UsageKind =
  | "idea_request"
  | "regenerate_request"
  | "llama_call"
  // Llama 3.2 Vision style-extraction calls. Same DB pattern as the
  // other kinds — `varchar(32)` on the column means any string fits
  // and no schema migration is required to add a new kind. Capped
  // daily by the vision-frames route handler (default 20/creator/day,
  // see VISION_DAILY_CAP). Demo creators bypass.
  | "vision_call";

const ALL_KINDS: ReadonlyArray<UsageKind> = [
  "idea_request",
  "regenerate_request",
  "llama_call",
  "vision_call",
];

// -----------------------------------------------------------------------------
// In-memory sliding window for Llama-call throttle (2 min)
// + last-regenerate-attempt timestamp for cooldown.
// -----------------------------------------------------------------------------

const LLAMA_WINDOW_MS = 2 * 60 * 1000;
const COOLDOWN_GAP_MS = 3000;
const COOLDOWN_MIN_MS = 3000;
const COOLDOWN_MAX_MS = 5000;
const MAX_TRACKED_CREATORS = 50_000;
const JANITOR_INTERVAL_MS = 5 * 60 * 1000;
const JANITOR_IDLE_MS = 10 * 60 * 1000;

const llamaCallTimestamps = new Map<string, number[]>();
const lastRegenerateAt = new Map<string, number>();

let janitor: ReturnType<typeof setInterval> | null = null;

function startJanitor(): void {
  if (janitor) return;
  janitor = setInterval(() => {
    const now = Date.now();
    // Llama timestamps: drop creators whose newest entry is past the
    // idle threshold (no recent activity).
    for (const [k, arr] of llamaCallTimestamps) {
      const newest = arr[arr.length - 1] ?? 0;
      if (now - newest > JANITOR_IDLE_MS) llamaCallTimestamps.delete(k);
    }
    // Regenerate timestamps: same idleness rule.
    for (const [k, ts] of lastRegenerateAt) {
      if (now - ts > JANITOR_IDLE_MS) lastRegenerateAt.delete(k);
    }
  }, JANITOR_INTERVAL_MS);
  janitor.unref?.();
}

function evictIfFull(map: Map<string, unknown>): void {
  while (map.size >= MAX_TRACKED_CREATORS) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

/**
 * Push a Llama-call timestamp into the per-creator sliding window
 * (after pruning expired entries). Call this on EVERY attempt —
 * success or failure — so the throttle reflects real load on the
 * upstream model, not just successful completions.
 */
export function recordLlamaCall(creatorId: string): void {
  startJanitor();
  const now = Date.now();
  const cutoff = now - LLAMA_WINDOW_MS;
  const cur = llamaCallTimestamps.get(creatorId) ?? [];
  const pruned = cur.filter((t) => t > cutoff);
  pruned.push(now);
  if (!llamaCallTimestamps.has(creatorId)) {
    evictIfFull(llamaCallTimestamps);
  }
  // delete+set keeps map iteration order = recency (mirrors rateLimit.ts)
  llamaCallTimestamps.delete(creatorId);
  llamaCallTimestamps.set(creatorId, pruned);
}

/**
 * Count Llama calls for this creator in the last 2 minutes. Prunes
 * expired entries as a side effect so the map stays bounded.
 */
export function getLlamaCallsLast2Min(creatorId: string): number {
  const now = Date.now();
  const cutoff = now - LLAMA_WINDOW_MS;
  const cur = llamaCallTimestamps.get(creatorId);
  if (!cur || cur.length === 0) return 0;
  const pruned = cur.filter((t) => t > cutoff);
  if (pruned.length === 0) {
    llamaCallTimestamps.delete(creatorId);
    return 0;
  }
  if (pruned.length !== cur.length) {
    llamaCallTimestamps.delete(creatorId);
    llamaCallTimestamps.set(creatorId, pruned);
  }
  return pruned.length;
}

/**
 * If the previous regenerate attempt for this creator was less than
 * COOLDOWN_GAP_MS ago, return a randomized 3000-5000ms delay the
 * caller should `await sleep`. Otherwise return 0. Reads only — does
 * NOT update the timestamp (call `recordRegenerateAttempt` after).
 */
export function getCooldownDelayMs(creatorId: string): number {
  const last = lastRegenerateAt.get(creatorId);
  if (last === undefined) return 0;
  const gap = Date.now() - last;
  if (gap >= COOLDOWN_GAP_MS) return 0;
  const span = COOLDOWN_MAX_MS - COOLDOWN_MIN_MS;
  return COOLDOWN_MIN_MS + Math.floor(Math.random() * (span + 1));
}

/**
 * Record this regenerate attempt's timestamp so the next call can
 * detect a rapid second tap. Call AFTER any cooldown sleep so the
 * post-sleep "now" is what gets stored.
 */
export function recordRegenerateAttempt(creatorId: string): void {
  startJanitor();
  if (!lastRegenerateAt.has(creatorId)) {
    evictIfFull(lastRegenerateAt);
  }
  lastRegenerateAt.set(creatorId, Date.now());
}

/**
 * Atomic check-and-record for the regen cooldown. Returns the
 * cooldown the caller should sleep before generating, AND records the
 * new "last attempt" timestamp in the same synchronous tick. This
 * closes the TOCTOU window two parallel taps would otherwise have
 * with separate `getCooldownDelayMs` + `recordRegenerateAttempt`
 * calls (where both could read "no prior" before either records).
 *
 * The first of two simultaneous taps gets cooldownMs=0 (no prior
 * timestamp yet); the second sees the freshly-recorded timestamp
 * from <1ms ago and gets a 3000-5000ms sleep — exactly the
 * "rate-limit the spammer, not the polite user" semantics we want.
 */
export function acquireRegenSlot(creatorId: string): number {
  startJanitor();
  const now = Date.now();
  const last = lastRegenerateAt.get(creatorId);
  if (!lastRegenerateAt.has(creatorId)) {
    evictIfFull(lastRegenerateAt);
  }
  lastRegenerateAt.set(creatorId, now);
  if (last === undefined) return 0;
  const gap = now - last;
  if (gap >= COOLDOWN_GAP_MS) return 0;
  const span = COOLDOWN_MAX_MS - COOLDOWN_MIN_MS;
  return COOLDOWN_MIN_MS + Math.floor(Math.random() * (span + 1));
}

// -----------------------------------------------------------------------------
// Postgres-backed daily counters
// -----------------------------------------------------------------------------

/**
 * Increment a per-creator, per-UTC-day counter by `by` (default 1).
 * UPSERT — creates the row at count=`by` on first hit, otherwise
 * adds `by` to the existing count. Returns the new count, or null on
 * any DB error (best-effort; never throws).
 *
 * The day bucket is computed by Postgres so two replicas with skewed
 * clocks always agree on which bucket a request belongs to.
 */
export async function incrementUsage(
  creatorId: string,
  kind: UsageKind,
  by: number = 1,
): Promise<number | null> {
  if (by <= 0) return 0;
  try {
    const r = await db.execute(sql`
      INSERT INTO usage_counters (creator_id, day, kind, count, updated_at)
      VALUES (
        ${creatorId},
        (now() AT TIME ZONE 'UTC')::date,
        ${kind},
        ${by},
        now()
      )
      ON CONFLICT (creator_id, day, kind) DO UPDATE
         SET count = usage_counters.count + ${by},
             updated_at = now()
      RETURNING count
    `);
    const rows = (r as unknown as { rows: { count: number }[] }).rows ?? [];
    return rows[0]?.count ?? null;
  } catch (err) {
    logger.warn(
      { err, creatorId, kind, by },
      "usage_tracker.increment_failed",
    );
    return null;
  }
}

/**
 * Read today's counts for the requested kinds in a single query.
 * Missing rows are zero-filled, so the returned record always has
 * exactly the requested keys. Returns all-zeros on DB error so the
 * caller never has to special-case undefined.
 */
export async function getUsageToday(
  creatorId: string,
  kinds: ReadonlyArray<UsageKind> = ALL_KINDS,
): Promise<Record<UsageKind, number>> {
  const zero = Object.fromEntries(kinds.map((k) => [k, 0])) as Record<
    UsageKind,
    number
  >;
  if (kinds.length === 0) return zero;
  try {
    const r = await db.execute(sql`
      SELECT kind, count FROM usage_counters
       WHERE creator_id = ${creatorId}
         AND day = (now() AT TIME ZONE 'UTC')::date
         AND kind = ANY(${sql.raw(`ARRAY[${kinds.map((k) => `'${k}'`).join(",")}]::varchar[]`)})
    `);
    const rows =
      (r as unknown as { rows: { kind: string; count: number }[] }).rows ?? [];
    const out: Record<UsageKind, number> = { ...zero };
    for (const row of rows) {
      if ((kinds as ReadonlyArray<string>).includes(row.kind)) {
        out[row.kind as UsageKind] = Number(row.count) || 0;
      }
    }
    return out;
  } catch (err) {
    logger.warn({ err, creatorId, kinds }, "usage_tracker.read_failed");
    return zero;
  }
}

// -----------------------------------------------------------------------------
// Test-only helpers — exported so QA can reset between scenarios
// without prodding internal Maps via dynamic imports.
// -----------------------------------------------------------------------------

export function __resetInMemoryForTests(): void {
  llamaCallTimestamps.clear();
  lastRegenerateAt.clear();
}
