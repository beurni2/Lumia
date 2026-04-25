/**
 * Per-creator daily usage quotas.
 *
 * Backed by `usage_counters(creator_id, day, kind, count)`. A
 * cost-protective gate the API server applies to expensive AI
 * operations (overnight swarm runs in particular) so a single
 * compromised account or runaway client can't drain the AI budget.
 *
 * Limits live in env so ops can tune without a deploy:
 *   LUMINA_MAX_SWARM_RUNS_PER_DAY (default 10)
 */

import { sql } from "drizzle-orm";
import { db } from "../db/client";

export type QuotaKind = "swarm_run" | "idea_batch";

const DEFAULTS: Record<QuotaKind, number> = {
  swarm_run: 10,
  // Phase 1 MVP: each creator gets at most 2 ideator batches per UTC
  // day — the initial morning batch + at most one regeneration if
  // the first three ideas don't appeal. Tuneable via env.
  idea_batch: 2,
};

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function quotaLimit(kind: QuotaKind): number {
  if (kind === "swarm_run") {
    return envInt("LUMINA_MAX_SWARM_RUNS_PER_DAY", DEFAULTS.swarm_run);
  }
  if (kind === "idea_batch") {
    return envInt("LUMINA_MAX_IDEA_BATCHES_PER_DAY", DEFAULTS.idea_batch);
  }
  return DEFAULTS[kind];
}

/**
 * Atomic check-and-increment. Returns `{ ok: true, count }` when the
 * caller is within budget for today (after their increment), or
 * `{ ok: false, count, limit }` when the cap would be exceeded.
 *
 * The DO UPDATE only fires when the existing count is below the limit
 * — this means racing requests can't both squeak in past the boundary.
 *
 * The day bucket is computed by Postgres (`(now() AT TIME ZONE 'UTC')
 * ::date`) rather than by the app, so two replicas with slightly
 * skewed clocks always agree on which bucket a request belongs to.
 *
 * `refundQuota` reverses this when the work the quota was consumed
 * for failed to be queued — see routes/agents.ts.
 */
export async function consumeQuota(
  creatorId: string,
  kind: QuotaKind,
): Promise<
  | { ok: true; count: number; limit: number }
  | { ok: false; count: number; limit: number }
> {
  const limit = quotaLimit(kind);

  const r = await db.execute(sql`
    INSERT INTO usage_counters (creator_id, day, kind, count, updated_at)
    VALUES (
      ${creatorId},
      (now() AT TIME ZONE 'UTC')::date,
      ${kind},
      1,
      now()
    )
    ON CONFLICT (creator_id, day, kind) DO UPDATE
       SET count = usage_counters.count + 1,
           updated_at = now()
     WHERE usage_counters.count < ${limit}
    RETURNING count
  `);
  const rows = (r as unknown as { rows: { count: number }[] }).rows ?? [];
  if (rows.length === 0) {
    const cur = await db.execute(sql`
      SELECT count FROM usage_counters
       WHERE creator_id = ${creatorId}
         AND day = (now() AT TIME ZONE 'UTC')::date
         AND kind = ${kind}
    `);
    const curRows =
      (cur as unknown as { rows: { count: number }[] }).rows ?? [];
    return { ok: false, count: curRows[0]?.count ?? limit, limit };
  }
  return { ok: true, count: rows[0].count, limit };
}

/**
 * Decrements a previously-consumed quota unit. Used to refund a
 * counter when the work it was reserved for failed to enqueue, so a
 * transient DB blip can't permanently burn a creator's daily budget.
 *
 * Floored at zero — never goes negative.
 */
export async function refundQuota(
  creatorId: string,
  kind: QuotaKind,
): Promise<void> {
  await db.execute(sql`
    UPDATE usage_counters
       SET count = GREATEST(count - 1, 0),
           updated_at = now()
     WHERE creator_id = ${creatorId}
       AND day = (now() AT TIME ZONE 'UTC')::date
       AND kind = ${kind}
  `);
}
