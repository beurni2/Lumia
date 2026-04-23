import { Router, type IRouter } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "../db/client";
import { resolveCreator } from "../lib/resolveCreator";
import { executeSwarmRun, startSwarmRun } from "../agents/swarm";

const router: IRouter = Router();

/**
 * POST /api/agents/run-overnight
 *
 * Kicks off a swarm cycle for the resolved creator. Returns the parent
 * runId immediately; actual execution runs asynchronously in this
 * process via setImmediate. The mobile app polls GET /api/agents/runs/:id
 * for status. On success the swarm has written new trend_briefs +
 * videos + brand_deals + ledger_entries, which the existing screens
 * pick up automatically on next refetch.
 */
router.post("/agents/run-overnight", async (req, res, next) => {
  try {
    const r = await resolveCreator(req);
    if (r.kind !== "found") {
      res.status(401).json({ error: "unknown_user" });
      return;
    }
    const { runId } = await startSwarmRun(r.creator.id);
    setImmediate(() => {
      executeSwarmRun(runId, r.creator.id).catch(() => {
        // executeSwarmRun handles its own error recording; this catch
        // exists only so an unhandled rejection never crashes the proc.
      });
    });
    res.status(202).json({ runId });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/agents/runs
 *
 * Recent swarm runs (parent rows only) for the resolved creator.
 */
router.get("/agents/runs", async (req, res, next) => {
  try {
    const r = await resolveCreator(req);
    if (r.kind !== "found") {
      res.status(401).json({ error: "unknown_user" });
      return;
    }
    const rows = await db
      .select()
      .from(schema.agentRuns)
      .where(
        and(
          eq(schema.agentRuns.creatorId, r.creator.id),
          isNull(schema.agentRuns.parentRunId),
        ),
      )
      .orderBy(desc(schema.agentRuns.createdAt))
      .limit(20);

    res.json({
      runs: rows.map((row) => ({
        id: row.id,
        agent: row.agent,
        status: row.status,
        summary: row.summary,
        error: row.error,
        startedAt: row.startedAt?.toISOString() ?? null,
        finishedAt: row.finishedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/agents/runs/:id
 *
 * Parent run + its child agent rows so the mobile app can show
 * per-agent status pills as the swarm advances.
 */
router.get("/agents/runs/:id", async (req, res, next) => {
  try {
    const r = await resolveCreator(req);
    if (r.kind !== "found") {
      res.status(401).json({ error: "unknown_user" });
      return;
    }
    const parent = (
      await db
        .select()
        .from(schema.agentRuns)
        .where(eq(schema.agentRuns.id, req.params.id))
        .limit(1)
    )[0];
    if (!parent || parent.creatorId !== r.creator.id) {
      res.status(404).json({ error: "run_not_found" });
      return;
    }
    const children = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.parentRunId, parent.id))
      .orderBy(schema.agentRuns.createdAt);

    res.json({
      id: parent.id,
      status: parent.status,
      summary: parent.summary,
      error: parent.error,
      startedAt: parent.startedAt?.toISOString() ?? null,
      finishedAt: parent.finishedAt?.toISOString() ?? null,
      createdAt: parent.createdAt.toISOString(),
      agents: children.map((c) => ({
        agent: c.agent,
        status: c.status,
        summary: c.summary,
        error: c.error,
        startedAt: c.startedAt?.toISOString() ?? null,
        finishedAt: c.finishedAt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
