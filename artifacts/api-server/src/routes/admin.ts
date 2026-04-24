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
import { rateLimit } from "../middlewares/rateLimit";

const router: IRouter = Router();

// Tight per-IP rate limit on the admin surface. The global limiter
// already covers /api/*, but an exposed admin endpoint is a juicier
// target for token-guessing — cap it harder so a brute-force attempt
// has to come from many IPs to be effective.
router.use("/admin", rateLimit({ max: 30, windowMs: 60_000, prefix: "admin" }));

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

/**
 * GET /api/admin/ai-usage
 *   ?days=7 (1..30, default 7)
 *
 * Daily AI spend rollup across the platform: total cost, total
 * tokens, distinct creators, plus the per-day series so an operator
 * can eyeball trend lines without hitting an analytics tool.
 */
router.get("/admin/ai-usage", async (req: Request, res: Response) => {
  const daysRaw = Number.parseInt(String(req.query["days"] ?? "7"), 10);
  const days =
    Number.isFinite(daysRaw) && daysRaw > 0 && daysRaw <= 30 ? daysRaw : 7;

  const r = await db.execute(sql`
    SELECT
      date_trunc('day', created_at AT TIME ZONE 'UTC')::date AS day,
      count(*)::int AS calls,
      count(DISTINCT creator_id)::int AS creators,
      coalesce(sum(input_tokens), 0)::bigint AS input_tokens,
      coalesce(sum(output_tokens), 0)::bigint AS output_tokens,
      coalesce(sum(cost_usd_micro), 0)::bigint AS cost_usd_micro
    FROM ai_usage
   WHERE created_at >= now() - (${days} || ' days')::interval
   GROUP BY day
   ORDER BY day DESC
  `);
  const rows =
    (r as unknown as {
      rows: {
        day: string;
        calls: number;
        creators: number;
        input_tokens: string | number;
        output_tokens: string | number;
        cost_usd_micro: string | number;
      }[];
    }).rows ?? [];

  // Convert micro-dollars to USD with 4-decimal precision client-side.
  const series = rows.map((row) => ({
    day: row.day,
    calls: row.calls,
    creators: row.creators,
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    costUsd: Number(row.cost_usd_micro) / 1_000_000,
  }));
  const totalUsd = series.reduce((sum, r) => sum + r.costUsd, 0);

  res.json({ windowDays: days, totalUsd, series });
});

/**
 * GET /api/admin/ai-usage/by-creator
 *   ?days=7 (1..30, default 7)
 *   ?limit=20 (1..100, default 20)
 *
 * Top spenders for the window. Useful for spotting a runaway client
 * or a creator who's repeatedly hitting their cap.
 */
router.get(
  "/admin/ai-usage/by-creator",
  async (req: Request, res: Response) => {
    const daysRaw = Number.parseInt(String(req.query["days"] ?? "7"), 10);
    const days =
      Number.isFinite(daysRaw) && daysRaw > 0 && daysRaw <= 30 ? daysRaw : 7;
    const limitRaw = Number.parseInt(String(req.query["limit"] ?? "20"), 10);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 100
        ? limitRaw
        : 20;
    const offsetRaw = Number.parseInt(String(req.query["offset"] ?? "0"), 10);
    const offset =
      Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

    // Cost rows whose creator was deleted post-spend appear here as
    // creator_id = null and are filtered out — preserved in the
    // table for compliance audit but not surfaced in a per-creator
    // ranking. If we ever need to attribute orphaned spend in this
    // view, add a coalesce(c.name, '<deleted>') and drop the IS NOT
    // NULL filter.
    const r = await db.execute(sql`
      SELECT
        u.creator_id,
        c.name,
        count(*)::int AS calls,
        coalesce(sum(u.input_tokens), 0)::bigint AS input_tokens,
        coalesce(sum(u.output_tokens), 0)::bigint AS output_tokens,
        coalesce(sum(u.cost_usd_micro), 0)::bigint AS cost_usd_micro
      FROM ai_usage u
      LEFT JOIN creators c ON c.id = u.creator_id
     WHERE u.created_at >= now() - (${days} || ' days')::interval
       AND u.creator_id IS NOT NULL
     GROUP BY u.creator_id, c.name
     ORDER BY cost_usd_micro DESC
     LIMIT ${limit}
    OFFSET ${offset}
    `);
    const rows =
      (r as unknown as {
        rows: {
          creator_id: string;
          name: string | null;
          calls: number;
          input_tokens: string | number;
          output_tokens: string | number;
          cost_usd_micro: string | number;
        }[];
      }).rows ?? [];

    const creators = rows.map((row) => ({
      creatorId: row.creator_id,
      name: row.name,
      calls: row.calls,
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
      costUsd: Number(row.cost_usd_micro) / 1_000_000,
    }));

    res.json({ windowDays: days, limit, offset, creators });
  },
);

export default router;
