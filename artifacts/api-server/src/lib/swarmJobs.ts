/**
 * Swarm job-type registration.
 *
 * Centralizes the `swarm.run` job type so both the route handler and
 * the nightly scheduler enqueue the same shape. The handler fully
 * encapsulates execution; if it throws the job queue retries with
 * exponential backoff.
 */

import { executeSwarmRun } from "../agents/swarm";
import { logger } from "./logger";
import { enqueueJob, registerJobHandler, type EnqueueOpts } from "./jobQueue";

export const SWARM_RUN_JOB = "swarm.run";

type SwarmRunPayload = {
  runId: string;
  creatorId: string;
};

export function registerSwarmJobHandlers(): void {
  registerJobHandler(SWARM_RUN_JOB, async (payload, { jobId }) => {
    const p = payload as SwarmRunPayload;
    if (!p?.runId || !p?.creatorId) {
      throw new Error("swarm.run payload missing runId/creatorId");
    }
    logger.info(
      { jobId, runId: p.runId, creatorId: p.creatorId },
      "[swarm.run] starting",
    );
    await executeSwarmRun(p.runId, p.creatorId);
  });
}

export async function enqueueSwarmRun(
  runId: string,
  creatorId: string,
  opts: EnqueueOpts = {},
): Promise<{ jobId: string | null; deduped: boolean }> {
  return enqueueJob(SWARM_RUN_JOB, { runId, creatorId }, opts);
}
