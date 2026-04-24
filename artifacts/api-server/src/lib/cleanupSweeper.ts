/**
 * Periodic table-trimming sweeper.
 *
 * The `error_events` and `jobs` tables grow without bound otherwise:
 *   - `error_events`: every uncaught exception gets a row.
 *   - `jobs`: every enqueue persists, even after success/failure.
 *
 * For an internal tool we don't need long retention — operators care
 * about "what's been failing today" and "what's stuck in the queue
 * right now", not month-old noise. Anything older than the TTL
 * windows below is deleted on every tick.
 *
 * Sweeping is scheduled once per hour, on a process-singleton
 * interval that's installed on boot from src/index.ts and torn down
 * in the SIGTERM shutdown path so containers don't leak the timer.
 */

import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { logger } from "./logger";

const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const ERROR_EVENTS_TTL_DAYS = 30;
const JOBS_SUCCEEDED_TTL_DAYS = 7;
const JOBS_FAILED_TTL_DAYS = 30;

let timer: ReturnType<typeof setInterval> | null = null;

async function sweepErrorEvents(): Promise<number> {
  const r = await db.execute(sql`
    DELETE FROM error_events
     WHERE occurred_at < now() - (${ERROR_EVENTS_TTL_DAYS} || ' days')::interval
  `);
  return (r as unknown as { rowCount?: number }).rowCount ?? 0;
}

async function sweepJobs(): Promise<{ succeeded: number; failed: number }> {
  const succR = await db.execute(sql`
    DELETE FROM jobs
     WHERE status = 'succeeded'
       AND updated_at < now() - (${JOBS_SUCCEEDED_TTL_DAYS} || ' days')::interval
  `);
  const failR = await db.execute(sql`
    DELETE FROM jobs
     WHERE status = 'failed'
       AND updated_at < now() - (${JOBS_FAILED_TTL_DAYS} || ' days')::interval
  `);
  return {
    succeeded: (succR as unknown as { rowCount?: number }).rowCount ?? 0,
    failed: (failR as unknown as { rowCount?: number }).rowCount ?? 0,
  };
}

async function tick(): Promise<void> {
  try {
    const errors = await sweepErrorEvents();
    const jobs = await sweepJobs();
    if (errors > 0 || jobs.succeeded > 0 || jobs.failed > 0) {
      logger.info(
        {
          errorsDeleted: errors,
          jobsSucceededDeleted: jobs.succeeded,
          jobsFailedDeleted: jobs.failed,
        },
        "[cleanupSweeper] swept",
      );
    }
  } catch (err) {
    logger.error({ err }, "[cleanupSweeper] tick failed");
  }
}

export function startCleanupSweeper(): void {
  if (timer) return;
  // Run once on boot so a long-stopped instance catches up immediately,
  // then on the hourly cadence.
  setImmediate(() => {
    void tick();
  });
  timer = setInterval(() => {
    void tick();
  }, SWEEP_INTERVAL_MS);
  logger.info(
    {
      intervalMs: SWEEP_INTERVAL_MS,
      errorEventsTtlDays: ERROR_EVENTS_TTL_DAYS,
      jobsSucceededTtlDays: JOBS_SUCCEEDED_TTL_DAYS,
      jobsFailedTtlDays: JOBS_FAILED_TTL_DAYS,
    },
    "[cleanupSweeper] started",
  );
}

export function stopCleanupSweeper(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

export const __test = { tick, sweepErrorEvents, sweepJobs };
