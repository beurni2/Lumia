/**
 * Health endpoints — liveness vs readiness, per kubernetes convention.
 *
 *   GET /api/healthz  liveness — "process is alive". Cheap, no I/O.
 *                     Used by orchestrators to decide whether to
 *                     restart the container.
 *
 *   GET /api/readyz   readiness — "process is alive AND ready to
 *                     serve traffic". Probes the database with a
 *                     trivial SELECT 1 and (optionally) confirms the
 *                     migration runner has caught up. Used by load
 *                     balancers to decide whether to route traffic
 *                     to this instance.
 *
 * Splitting these matters: a temporarily-disconnected DB should drop
 * us from the LB pool (readiness fails) without restarting us
 * (liveness still passes), so we recover in-place when the DB returns.
 */

import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "../db/client";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Cache the readiness result briefly so an unauthenticated attacker
// can't amplify hits to /readyz into hits to the database connection
// pool. The 2s TTL is short enough that a real outage still drops us
// from the LB pool within a couple of poll intervals.
const READY_CACHE_TTL_MS = 2_000;
let readyCache: {
  expiresAt: number;
  status: number;
  body: Record<string, unknown>;
} | null = null;

router.get("/readyz", async (_req, res) => {
  const now = Date.now();
  if (readyCache && readyCache.expiresAt > now) {
    res.status(readyCache.status).json(readyCache.body);
    return;
  }
  const started = Date.now();
  try {
    // Cheapest possible DB probe — round-trips a single int through
    // the connection pool. If the pool is exhausted or the DB is
    // unreachable this throws; either way readiness should fail.
    await db.execute(sql`SELECT 1 AS ok`);
    const body = {
      status: "ready",
      checks: { db: { ok: true, latencyMs: Date.now() - started } },
    };
    readyCache = { expiresAt: now + READY_CACHE_TTL_MS, status: 200, body };
    res.json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const body = {
      status: "not_ready",
      checks: { db: { ok: false, error: message.slice(0, 200) } },
    };
    readyCache = { expiresAt: now + READY_CACHE_TTL_MS, status: 503, body };
    res.status(503).json(body);
  }
});

export default router;
