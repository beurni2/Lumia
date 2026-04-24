/**
 * Migration runner — auto-applied on server boot.
 *
 * Uses a Postgres session-level advisory lock so two concurrent
 * processes (rolling deploy, replicas, etc.) can't apply the same
 * migration twice. Each migration runs inside its own transaction so
 * partial failures roll back cleanly.
 *
 * Idempotent by design: every migration uses `IF NOT EXISTS`. The
 * `_schema_migrations` table records which versions have been applied
 * so we don't re-run them needlessly on subsequent boots.
 */

import pg from "pg";

import { logger } from "../lib/logger";
import { migrations } from "./migrations";

// Arbitrary 64-bit constant — picked once, never changes. Two processes
// asking for the same advisory lock are serialized by Postgres.
const MIGRATION_LOCK_KEY = 0x4c554d_494e4131n; // "LUMINA1" in hex

export async function runMigrations(): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set; cannot run migrations on boot.",
    );
  }
  // Dedicated short-lived client — we don't want to hold an advisory
  // lock on a connection that goes back into the request-serving pool.
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      `SELECT pg_advisory_lock($1::bigint)`,
      [MIGRATION_LOCK_KEY.toString()],
    );
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS _schema_migrations (
          version integer PRIMARY KEY,
          name text NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now()
        );
      `);

      const applied = await client.query<{ version: number }>(
        `SELECT version FROM _schema_migrations`,
      );
      const appliedSet = new Set(applied.rows.map((r) => r.version));

      const pending = [...migrations]
        .sort((a, b) => a.id - b.id)
        .filter((m) => !appliedSet.has(m.id));

      if (pending.length === 0) {
        logger.info(
          { applied: appliedSet.size },
          "[migrate] no pending migrations",
        );
        return;
      }

      for (const m of pending) {
        logger.info({ id: m.id, name: m.name }, "[migrate] applying");
        await client.query("BEGIN");
        try {
          await client.query(m.sql);
          await client.query(
            `INSERT INTO _schema_migrations (version, name) VALUES ($1, $2)
             ON CONFLICT (version) DO NOTHING`,
            [m.id, m.name],
          );
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          logger.error(
            { err, id: m.id, name: m.name },
            "[migrate] failed; rolled back",
          );
          throw err;
        }
      }

      logger.info(
        { applied: pending.map((m) => m.id) },
        "[migrate] all pending applied",
      );
    } finally {
      await client.query(
        `SELECT pg_advisory_unlock($1::bigint)`,
        [MIGRATION_LOCK_KEY.toString()],
      );
    }
  } finally {
    await client.end();
  }
}
