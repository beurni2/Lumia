/**
 * One-shot migration: create the `agent_runs` table.
 *
 * Pure additive change (no existing tables or columns altered), so it
 * is safe to run repeatedly via `IF NOT EXISTS`. Run with:
 *
 *   pnpm --filter @workspace/api-server exec tsx src/db/migrate-agent-runs.ts
 */

import pg from "pg";

async function main() {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL not set");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
        agent varchar(32) NOT NULL,
        status varchar(16) NOT NULL DEFAULT 'queued',
        parent_run_id uuid,
        summary text,
        error text,
        started_at timestamptz,
        finished_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_runs_creator_created
        ON agent_runs (creator_id, created_at);
    `);
    // eslint-disable-next-line no-console
    console.log("agent_runs table ready");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
