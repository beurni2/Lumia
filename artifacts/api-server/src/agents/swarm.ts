/**
 * Swarm orchestrator — the "while you slept" pipeline.
 *
 * Creates a parent agent_runs row (agent='swarm') and runs the four
 * agents sequentially, each as a tracked child run. Designed to be
 * fire-and-forget from the HTTP layer: the route returns the parent
 * runId immediately and the mobile app polls GET /agents/runs/:id.
 *
 * Sequencing is strict because each step consumes the previous
 * step's output (ideator → top brief → director → video → editor →
 * polished video → monetizer → deal + ledger).
 */

import { eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import { ideatorAgent } from "./ideator";
import { directorAgent } from "./director";
import { editorAgent } from "./editor";
import { monetizerAgent } from "./monetizer";
import { runAgent } from "./runner";
import { logger } from "../lib/logger";

export type SwarmStartResult = { runId: string };

/**
 * Inserts the parent run row in 'queued' state and returns its id.
 * The caller schedules the actual work asynchronously so the HTTP
 * response is fast.
 */
export async function startSwarmRun(
  creatorId: string,
): Promise<SwarmStartResult> {
  const [parent] = await db
    .insert(schema.agentRuns)
    .values({
      creatorId,
      agent: "swarm",
      status: "queued",
    })
    .returning({ id: schema.agentRuns.id });
  return { runId: parent.id };
}

/**
 * Drives the four-agent pipeline. Best run via setImmediate so the
 * HTTP request doesn't block on it.
 */
export async function executeSwarmRun(
  runId: string,
  creatorId: string,
): Promise<void> {
  await db
    .update(schema.agentRuns)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(schema.agentRuns.id, runId));

  const ctx = { creatorId, parentRunId: runId };
  const summaries: string[] = [];

  try {
    const ideatorOut = await runAgent("ideator", ctx, ideatorAgent);
    if (!ideatorOut) throw new Error("ideator failed");
    summaries.push(ideatorOut.summary);
    const topBriefId = (ideatorOut.data as { topBriefId: string }).topBriefId;

    const directorOut = await runAgent("director", ctx, (c) =>
      directorAgent(c, topBriefId),
    );
    if (!directorOut) throw new Error("director failed");
    summaries.push(directorOut.summary);
    const videoId = (directorOut.data as { videoId: string }).videoId;

    const editorOut = await runAgent("editor", ctx, (c) =>
      editorAgent(c, videoId),
    );
    if (!editorOut) throw new Error("editor failed");
    summaries.push(editorOut.summary);

    const monetizerOut = await runAgent("monetizer", ctx, (c) =>
      monetizerAgent(c, videoId),
    );
    if (!monetizerOut) throw new Error("monetizer failed");
    summaries.push(monetizerOut.summary);

    await db
      .update(schema.agentRuns)
      .set({
        status: "done",
        summary: summaries.join(" · "),
        finishedAt: new Date(),
      })
      .where(eq(schema.agentRuns.id, runId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, runId }, "swarm run failed");
    await db
      .update(schema.agentRuns)
      .set({
        status: "failed",
        error: message.slice(0, 2000),
        summary:
          summaries.length > 0
            ? summaries.join(" · ") + " · then failed"
            : null,
        finishedAt: new Date(),
      })
      .where(eq(schema.agentRuns.id, runId));
  }
}
