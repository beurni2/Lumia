/**
 * Admin endpoints for operator visibility into runtime issues.
 *
 * Auth model: a single shared bearer token in `LUMINA_ADMIN_TOKEN`.
 * The token is compared in constant time. If the env var is unset
 * the route refuses every request — closed by default. This is
 * intentionally simpler than building a role system; a proper RBAC
 * model can replace it once we have more than one operator.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db/client";

const router: IRouter = Router();

function adminAuthOk(req: Request): boolean {
  const expected = process.env["LUMINA_ADMIN_TOKEN"];
  if (!expected || expected.length < 16) return false;
  const presented = req.header("x-admin-token") ?? "";
  // Compare byte-length, not string length — a multi-byte token would
  // pass the string-length check but trip timingSafeEqual's
  // equal-length-buffer requirement and throw a RangeError.
  const presentedBuf = Buffer.from(presented, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (presentedBuf.byteLength !== expectedBuf.byteLength) return false;
  return timingSafeEqual(presentedBuf, expectedBuf);
}

router.use("/admin", (req, res, next) => {
  if (!adminAuthOk(req)) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  next();
});

/**
 * GET /api/admin/errors
 *   ?limit=50            (1..200, default 50)
 *   ?since=ISO8601       (only events at or after this time)
 *   ?creatorId=uuid      (filter to one creator)
 *   ?status=500          (filter to one status code)
 *
 * Returns the most recent error_events ordered by occurred_at desc.
 */
router.get("/admin/errors", async (req: Request, res: Response) => {
  const limitRaw = Number.parseInt(String(req.query["limit"] ?? "50"), 10);
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 50;

  const sinceParam =
    typeof req.query["since"] === "string" ? req.query["since"] : null;
  const sinceDate = sinceParam ? new Date(sinceParam) : null;
  const since =
    sinceDate && !Number.isNaN(sinceDate.getTime()) ? sinceDate : null;

  const creatorId =
    typeof req.query["creatorId"] === "string" && req.query["creatorId"].length > 0
      ? req.query["creatorId"]
      : null;

  const statusRaw = Number.parseInt(String(req.query["status"] ?? ""), 10);
  const status = Number.isFinite(statusRaw) && statusRaw > 0 ? statusRaw : null;

  const r = await db.execute(sql`
    SELECT id, request_id, occurred_at, method, route, status_code,
           creator_id, error_name, error_message
      FROM error_events
     WHERE (${since}::timestamptz IS NULL OR occurred_at >= ${since}::timestamptz)
       AND (${creatorId}::uuid IS NULL OR creator_id = ${creatorId}::uuid)
       AND (${status}::int IS NULL OR status_code = ${status}::int)
     ORDER BY occurred_at DESC
     LIMIT ${limit}
  `);
  const rows = (r as unknown as { rows: unknown[] }).rows ?? [];
  res.json({ events: rows, limit });
});

/**
 * GET /api/admin/errors/:id — full record including the stack.
 */
router.get("/admin/errors/:id", async (req: Request, res: Response) => {
  const idParam = req.params["id"];
  const id = typeof idParam === "string" ? idParam : "";
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const r = await db.execute(sql`
    SELECT * FROM error_events WHERE id = ${id}::uuid
  `);
  const rows = (r as unknown as { rows: unknown[] }).rows ?? [];
  if (rows.length === 0) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ event: rows[0] });
});

/**
 * GET /api/admin/errors-summary
 *   ?hours=24 (1..168, default 24)
 *
 * Aggregates by (route, status_code, error_name) for quick triage.
 */
router.get("/admin/errors-summary", async (req: Request, res: Response) => {
  const hoursRaw = Number.parseInt(String(req.query["hours"] ?? "24"), 10);
  const hours =
    Number.isFinite(hoursRaw) && hoursRaw > 0 && hoursRaw <= 168 ? hoursRaw : 24;

  const r = await db.execute(sql`
    SELECT route, status_code, error_name, count(*)::int AS count,
           max(occurred_at) AS last_seen
      FROM error_events
     WHERE occurred_at >= now() - (${hours} || ' hours')::interval
     GROUP BY route, status_code, error_name
     ORDER BY count DESC
     LIMIT 100
  `);
  const rows = (r as unknown as { rows: unknown[] }).rows ?? [];
  res.json({ windowHours: hours, groups: rows });
});

export default router;
