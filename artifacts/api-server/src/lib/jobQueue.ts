/**
 * Postgres-backed durable job queue.
 *
 * Why this exists:
 *   - The previous overnight scheduler used `setImmediate` which is
 *     lost on process crash and has no retry.
 *   - The previous scheduler also could not survive a deploy mid-run.
 *
 * Mechanics:
 *   - `enqueueJob(type, payload, opts)` inserts a row into `jobs` with
 *     status='pending'. Optional `dedupeKey` makes it a no-op if a
 *     pending/running job with the same key already exists.
 *   - `startJobWorker()` polls every POLL_INTERVAL_MS, claiming up to
 *     (CONCURRENCY - inFlight) rows at a time via SELECT ... FOR
 *     UPDATE SKIP LOCKED. Each claimed row gets `status='running'`
 *     and a `locked_until` deadline (now + LEASE_MS). The deadline
 *     value is also captured in memory and used as a fingerprint on
 *     subsequent state transitions so a "lease expired → reclaimed
 *     by another worker" situation cannot cause double-finalization.
 *   - On handler success → status='succeeded' (only if our lease
 *     fingerprint still matches).
 *   - On handler error → attempts++; reschedule with exponential
 *     backoff if attempts<max_attempts, else status='failed'. Same
 *     lease-fingerprint check.
 *   - The polling loop never `await`s on handler completion — each
 *     handler runs concurrently via a tracked promise so a single
 *     slow job cannot starve the worker.
 *
 * Crash recovery:
 *   - On worker startup we sweep `status='running' AND locked_until<now`
 *     back to pending so jobs whose worker died mid-execution get
 *     retried. Same condition is also re-checked inside `claimBatch`
 *     for steady-state reclamation.
 *
 * Graceful shutdown:
 *   - `stopJobWorker()` flips a flag, cancels the next poll, and
 *     returns a promise that resolves only after every in-flight
 *     handler has settled. This makes SIGTERM in containers safe.
 */

import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { logger } from "./logger";

const POLL_INTERVAL_MS = 2_000;
const LEASE_MS = 5 * 60 * 1000; // 5 min — handlers must finish in this window
const CONCURRENCY = 4;

type JobHandler = (payload: unknown, ctx: { jobId: string }) => Promise<void>;

type ClaimedJob = {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
  // The exact `locked_until` value this worker stamped onto the row at
  // claim time. We use it as a fingerprint on every subsequent UPDATE
  // so a worker whose lease expired (and whose job got reclaimed by
  // another worker) cannot accidentally overwrite the new owner's
  // state. Two workers can never share the same fingerprint because
  // each lease deadline is computed from its own `now()`.
  leaseFingerprint: string;
};

const handlers = new Map<string, JobHandler>();
const inFlight = new Set<string>(); // jobIds currently executing
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

export function registerJobHandler(type: string, handler: JobHandler): void {
  if (handlers.has(type)) {
    logger.warn({ type }, "[jobs] handler re-registered (dev hot reload?)");
  }
  handlers.set(type, handler);
}

export type EnqueueOpts = {
  runAt?: Date;
  maxAttempts?: number;
  dedupeKey?: string;
};

export async function enqueueJob(
  type: string,
  payload: Record<string, unknown>,
  opts: EnqueueOpts = {},
): Promise<{ jobId: string | null; deduped: boolean }> {
  const runAt = opts.runAt ?? new Date();
  const maxAttempts = opts.maxAttempts ?? 3;
  const dedupeKey = opts.dedupeKey ?? null;

  // ON CONFLICT DO NOTHING handles the race where two enqueuers with
  // the same dedupe_key arrive at the same time — only one row wins.
  const result = await db.execute(sql`
    INSERT INTO jobs (type, payload, run_at, max_attempts, dedupe_key)
    VALUES (
      ${type},
      ${JSON.stringify(payload)}::jsonb,
      ${runAt.toISOString()}::timestamptz,
      ${maxAttempts},
      ${dedupeKey}
    )
    ON CONFLICT DO NOTHING
    RETURNING id
  `);
  const rows = (result as unknown as { rows: { id: string }[] }).rows ?? [];
  if (rows.length === 0) {
    return { jobId: null, deduped: true };
  }
  return { jobId: rows[0].id, deduped: false };
}

async function recoverOrphanedJobs(): Promise<void> {
  const r = await db.execute(sql`
    UPDATE jobs
       SET status = 'pending',
           locked_until = NULL,
           updated_at = now()
     WHERE status = 'running'
       AND locked_until IS NOT NULL
       AND locked_until < now()
    RETURNING id
  `);
  const rows = (r as unknown as { rows: { id: string }[] }).rows ?? [];
  if (rows.length > 0) {
    logger.warn({ count: rows.length }, "[jobs] recovered orphaned jobs");
  }
}

async function claimBatch(maxRows: number): Promise<ClaimedJob[]> {
  if (maxRows <= 0) return [];
  // Atomic claim — also reclaims any job whose lease has expired in
  // the same statement (status='pending' OR (status='running' AND
  // locked_until<now())). This means a crashed worker's job can be
  // picked up on the very next poll without waiting for the separate
  // recoverOrphanedJobs sweep.
  const leaseUntil = new Date(Date.now() + LEASE_MS);
  const leaseUntilIso = leaseUntil.toISOString();
  const r = await db.execute(sql`
    WITH claimed AS (
      SELECT id FROM jobs
       WHERE (
              status = 'pending'
              AND run_at <= now()
             )
          OR (
              status = 'running'
              AND locked_until IS NOT NULL
              AND locked_until < now()
             )
       ORDER BY run_at
       FOR UPDATE SKIP LOCKED
       LIMIT ${maxRows}
    )
    UPDATE jobs j
       SET status = 'running',
           locked_until = ${leaseUntilIso}::timestamptz,
           updated_at = now()
      FROM claimed
     WHERE j.id = claimed.id
    RETURNING j.id, j.type, j.payload, j.attempts, j.max_attempts
  `);
  const rows =
    (r as unknown as {
      rows: Array<{
        id: string;
        type: string;
        payload: unknown;
        attempts: number;
        max_attempts: number;
      }>;
    }).rows ?? [];
  return rows.map((row) => ({ ...row, leaseFingerprint: leaseUntilIso }));
}

async function markSucceeded(
  id: string,
  leaseFingerprint: string,
): Promise<boolean> {
  // Only finalize if the row still bears OUR lease. If a slow worker's
  // lease expired and another worker reclaimed the job, our finalize
  // becomes a no-op (the new owner remains in charge).
  const r = await db.execute(sql`
    UPDATE jobs
       SET status = 'succeeded',
           locked_until = NULL,
           updated_at = now()
     WHERE id = ${id}
       AND status = 'running'
       AND locked_until = ${leaseFingerprint}::timestamptz
    RETURNING id
  `);
  const rows = (r as unknown as { rows: { id: string }[] }).rows ?? [];
  return rows.length > 0;
}

async function markFailureOrReschedule(
  id: string,
  attempts: number,
  maxAttempts: number,
  leaseFingerprint: string,
  err: unknown,
): Promise<boolean> {
  const message =
    err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const nextAttempts = attempts + 1;
  if (nextAttempts >= maxAttempts) {
    const r = await db.execute(sql`
      UPDATE jobs
         SET status = 'failed',
             attempts = ${nextAttempts},
             last_error = ${message},
             locked_until = NULL,
             updated_at = now()
       WHERE id = ${id}
         AND status = 'running'
         AND locked_until = ${leaseFingerprint}::timestamptz
      RETURNING id
    `);
    const rows = (r as unknown as { rows: { id: string }[] }).rows ?? [];
    return rows.length > 0;
  }
  // Exponential backoff: 30s, 2m, 8m, capped at 30m.
  const backoffMs = Math.min(
    30_000 * Math.pow(4, nextAttempts - 1),
    30 * 60 * 1000,
  );
  const nextRunAt = new Date(Date.now() + backoffMs);
  const r = await db.execute(sql`
    UPDATE jobs
       SET status = 'pending',
           attempts = ${nextAttempts},
           last_error = ${message},
           run_at = ${nextRunAt.toISOString()}::timestamptz,
           locked_until = NULL,
           updated_at = now()
     WHERE id = ${id}
       AND status = 'running'
       AND locked_until = ${leaseFingerprint}::timestamptz
    RETURNING id
  `);
  const rows = (r as unknown as { rows: { id: string }[] }).rows ?? [];
  return rows.length > 0;
}

async function processOne(job: ClaimedJob): Promise<void> {
  const handler = handlers.get(job.type);
  if (!handler) {
    logger.error(
      { id: job.id, type: job.type },
      "[jobs] no handler registered — marking failed",
    );
    await db.execute(sql`
      UPDATE jobs
         SET status = 'failed',
             last_error = 'no handler registered for type ' || ${job.type},
             locked_until = NULL,
             updated_at = now()
       WHERE id = ${job.id}
         AND status = 'running'
         AND locked_until = ${job.leaseFingerprint}::timestamptz
    `);
    return;
  }
  try {
    await handler(job.payload, { jobId: job.id });
    const owned = await markSucceeded(job.id, job.leaseFingerprint);
    if (!owned) {
      logger.warn(
        { id: job.id, type: job.type },
        "[jobs] success but lease was reclaimed — another worker is now owner",
      );
    }
  } catch (err) {
    logger.error({ err, id: job.id, type: job.type }, "[jobs] handler error");
    const owned = await markFailureOrReschedule(
      job.id,
      job.attempts,
      job.max_attempts,
      job.leaseFingerprint,
      err,
    );
    if (!owned) {
      logger.warn(
        { id: job.id, type: job.type },
        "[jobs] failure but lease was reclaimed — skipping reschedule",
      );
    }
  }
}

function spawn(job: ClaimedJob): void {
  inFlight.add(job.id);
  // Fire-and-forget — but the .finally guarantees inFlight cleanup
  // even if processOne throws (it shouldn't, but defense in depth).
  processOne(job)
    .catch((err) =>
      logger.error({ err, id: job.id }, "[jobs] processOne crashed"),
    )
    .finally(() => {
      inFlight.delete(job.id);
    });
}

async function tick(): Promise<void> {
  if (!running) return;
  try {
    const slots = CONCURRENCY - inFlight.size;
    if (slots > 0) {
      const batch = await claimBatch(slots);
      for (const j of batch) spawn(j);
    }
  } catch (err) {
    logger.error({ err }, "[jobs] tick failed");
  } finally {
    if (running) {
      timer = setTimeout(() => {
        void tick();
      }, POLL_INTERVAL_MS);
    }
  }
}

export async function startJobWorker(): Promise<void> {
  if (running) return;
  running = true;
  await recoverOrphanedJobs().catch((err) => {
    logger.error({ err }, "[jobs] orphan recovery failed");
  });
  logger.info(
    { pollMs: POLL_INTERVAL_MS, concurrency: CONCURRENCY },
    "[jobs] worker started",
  );
  setImmediate(() => {
    void tick();
  });
}

/**
 * Stops polling and waits for in-flight handlers to drain. Hooked to
 * SIGTERM in src/index.ts so containers can shut down cleanly without
 * leaving orphaned 'running' rows behind.
 */
export async function stopJobWorker(timeoutMs = 30_000): Promise<void> {
  if (!running) return;
  running = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const deadline = Date.now() + timeoutMs;
  while (inFlight.size > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (inFlight.size > 0) {
    logger.warn(
      { remaining: inFlight.size },
      "[jobs] shutdown timeout — orphans will be reclaimed on next boot",
    );
  } else {
    logger.info("[jobs] worker stopped cleanly");
  }
}

export const __test = { recoverOrphanedJobs, claimBatch };
