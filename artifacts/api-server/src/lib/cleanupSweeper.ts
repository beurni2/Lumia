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
// Any agent_runs row in 'queued' or 'running' for longer than this
// — AND with no still-pending/running underlying job — is considered
// orphaned (its worker crashed or was killed) and gets flipped to
// 'failed' so it stops haunting the creator's history. Chosen to be
// well past the queue's 5-minute lease and the longest expected
// swarm runtime.
const AGENT_RUNS_ORPHAN_MINUTES = 60;

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

async function reapOrphanedAgentRuns(): Promise<number> {
  // A queued/running parent run that hasn't moved in N minutes means
  // its worker crashed or was killed mid-execution. The job queue
  // already retries the underlying job (and our parent-level
  // idempotency guard skips re-execution if status≠'queued'), but
  // the agent_runs row itself is left dangling forever. Reap it so
  // the creator's history shows a clear failure instead of a row
  // that's "running" days later.
  //
  // Crucially we ONLY reap rows whose backing job is no longer
  // pending/running — otherwise a slow swarm that legitimately
  // exceeds the wall-clock threshold would race the reaper: the
  // reaper marks failed, the swarm finishes and writes done,
  // leaving the row inconsistent with the work that actually ran.
  // The NOT EXISTS subquery makes the reap a no-op while a worker
  // still owns the job; only after the queue gives up (status
  // 'failed' on max attempts) does the parent agent_runs row become
  // eligible for reaping.
  const r = await db.execute(sql`
    UPDATE agent_runs
       SET status = 'failed',
           error = COALESCE(error,
             'orphaned: no progress for ' || ${AGENT_RUNS_ORPHAN_MINUTES} || ' minutes'),
           finished_at = COALESCE(finished_at, now())
     WHERE status IN ('queued','running')
       AND COALESCE(started_at, created_at) <
           now() - (${AGENT_RUNS_ORPHAN_MINUTES} || ' minutes')::interval
       AND NOT EXISTS (
         SELECT 1 FROM jobs
          WHERE jobs.type = 'swarm.run'
            AND jobs.status IN ('pending','running')
            AND jobs.payload->>'runId' = agent_runs.id::text
       )
  `);
  return (r as unknown as { rowCount?: number }).rowCount ?? 0;
}

async function tick(): Promise<void> {
  try {
    const errors = await sweepErrorEvents();
    const jobs = await sweepJobs();
    const orphans = await reapOrphanedAgentRuns();
    if (
      errors > 0 ||
      jobs.succeeded > 0 ||
      jobs.failed > 0 ||
      orphans > 0
    ) {
      logger.info(
        {
          errorsDeleted: errors,
          jobsSucceededDeleted: jobs.succeeded,
          jobsFailedDeleted: jobs.failed,
          agentRunsReaped: orphans,
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
      agentRunsOrphanMinutes: AGENT_RUNS_ORPHAN_MINUTES,
    },
    "[cleanupSweeper] started",
  );
}

export function stopCleanupSweeper(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

export const __test = {
  tick,
  sweepErrorEvents,
  sweepJobs,
  reapOrphanedAgentRuns,
};
