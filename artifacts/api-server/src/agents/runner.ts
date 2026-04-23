/**
 * Agent runner — wraps an agent function in standardized agent_runs
 * lifecycle bookkeeping. Each individual agent (ideator, director,
 * editor, monetizer) gets a child row whose status transitions
 * queued → running → done|failed and whose summary/error capture the
 * outcome for the mobile app's "what the swarm did" surface.
 */

import { eq } from "drizzle-orm";
import { db, schema } from "../db/client";

export type AgentName = "ideator" | "director" | "editor" | "monetizer";

export type AgentContext = {
  creatorId: string;
  parentRunId: string;
};

export type AgentResult = {
  summary: string;
  // Free-form payload the next agent can consume in-process. We don't
  // persist this — it lives in memory between agents in the same swarm.
  data?: unknown;
};

/**
 * Runs `fn` as a tracked agent step. Always resolves; on failure the
 * row records the error and the resolved result is `null` so the
 * orchestrator can decide whether to short-circuit.
 */
export async function runAgent(
  name: AgentName,
  ctx: AgentContext,
  fn: (ctx: AgentContext) => Promise<AgentResult>,
): Promise<AgentResult | null> {
  const [row] = await db
    .insert(schema.agentRuns)
    .values({
      creatorId: ctx.creatorId,
      agent: name,
      status: "running",
      parentRunId: ctx.parentRunId,
      startedAt: new Date(),
    })
    .returning({ id: schema.agentRuns.id });

  try {
    const result = await fn(ctx);
    await db
      .update(schema.agentRuns)
      .set({
        status: "done",
        summary: result.summary,
        finishedAt: new Date(),
      })
      .where(eq(schema.agentRuns.id, row.id));
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(schema.agentRuns)
      .set({
        status: "failed",
        error: message.slice(0, 2000),
        finishedAt: new Date(),
      })
      .where(eq(schema.agentRuns.id, row.id));
    return null;
  }
}
