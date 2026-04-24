/**
 * Agent runner — wraps an agent function in standardized agent_runs
 * lifecycle bookkeeping. Each individual agent (ideator, director,
 * editor, monetizer) gets a child row whose status transitions
 * queued → running → done|failed and whose summary/error capture the
 * outcome for the mobile app's "what the swarm did" surface.
 *
 * Per-step idempotency: before running, we look for a 'done' child
 * row matching (parent_run_id, agent). If one exists, we return its
 * persisted summary + output instead of executing again. This means
 * a re-invocation of the parent swarm (e.g. accidental double-call,
 * or a future "resume from failure" code path) will NOT re-run any
 * step that already produced a side effect — no duplicate trend
 * briefs, videos, brand deals, or AI spend.
 */

import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import { logger } from "../lib/logger";

export type AgentName = "ideator" | "director" | "editor" | "monetizer";

export type AgentContext = {
  creatorId: string;
  parentRunId: string;
};

export type AgentResult = {
  summary: string;
  /**
   * Free-form payload the next agent consumes in-process. Persisted
   * on the child agent_runs row as jsonb so a resumed parent can
   * recover it without re-running the agent.
   *
   * MUST be JSON-serializable. Date instances will round-trip as
   * ISO strings, Map / Set become {} / [], and circular references
   * will throw at insert time. Stick to primitives, arrays, and
   * plain objects — if you need to preserve a richer type, encode
   * it explicitly here and decode it in the consuming agent.
   */
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
  // ---- Per-step idempotency check ---------------------------------
  // If a previous attempt of this same parent already finished this
  // agent, surface the recorded result instead of re-executing.
  const existing = await db
    .select({
      id: schema.agentRuns.id,
      summary: schema.agentRuns.summary,
      output: schema.agentRuns.output,
    })
    .from(schema.agentRuns)
    .where(
      and(
        eq(schema.agentRuns.parentRunId, ctx.parentRunId),
        eq(schema.agentRuns.agent, name),
        eq(schema.agentRuns.status, "done"),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    const prev = existing[0];
    logger.info(
      { runId: prev.id, parentRunId: ctx.parentRunId, agent: name },
      "[runner] reusing prior done run for this step",
    );
    return {
      summary: prev.summary ?? "(no summary recorded)",
      data: prev.output ?? undefined,
    };
  }

  // ---- Fresh execution --------------------------------------------
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
        // null when an agent has no structured handoff payload (rare
        // but allowed). jsonb null is distinguishable from "absent"
        // because the column is nullable.
        output: (result.data ?? null) as never,
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
