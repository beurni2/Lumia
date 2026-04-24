import { Router, type IRouter } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "../db/client";
import { resolveCreator } from "../lib/resolveCreator";
import { startSwarmRun } from "../agents/swarm";
import { consumeQuota, refundQuota } from "../lib/quota";
import { enqueueSwarmRun } from "../lib/swarmJobs";

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
    // Compliance gate: the swarm produces AI content. We refuse to
    // generate anything until the creator has acknowledged the FTC
    // AI-disclosure statement and confirmed they're 18+.
    if (
      !r.creator.aiDisclosureConsentedAt ||
      !r.creator.adultConfirmedAt
    ) {
      res.status(403).json({ error: "consent_required" });
      return;
    }
    // Cost guardrail: enforce a per-creator daily cap on swarm runs so
    // a compromised account or runaway client can't drain the AI
    // budget. Limit configurable via LUMINA_MAX_SWARM_RUNS_PER_DAY.
    const quota = await consumeQuota(r.creator.id, "swarm_run");
    if (!quota.ok) {
      res.status(429).json({
        error: "quota_exceeded",
        kind: "swarm_run",
        used: quota.count,
        limit: quota.limit,
      });
      return;
    }
    // Refund the quota unit on any failure between consumption and
    // successful enqueue, so transient DB hiccups don't permanently
    // burn a creator's daily budget.
    let runId: string | undefined;
    try {
      ({ runId } = await startSwarmRun(r.creator.id));
      // Hand off to the durable job queue. If the process dies before
      // the swarm finishes, the worker recovers the orphaned job on
      // next boot and retries with exponential backoff.
      await enqueueSwarmRun(runId, r.creator.id);
    } catch (e) {
      await refundQuota(r.creator.id, "swarm_run").catch(() => {});
      throw e;
    }
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
