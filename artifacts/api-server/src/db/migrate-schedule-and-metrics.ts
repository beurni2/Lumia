/**
 * One-shot migration: scheduler columns on creators + metrics + shield
 * verdict columns on publications.
 *
 * All ADD COLUMN IF NOT EXISTS — pure additive, no rewrites, no row
 * backfill required. Existing creators show as opt-out, existing
 * publications show as null metrics / null verdict.
 *
 *   pnpm --filter @workspace/api-server exec tsx src/db/migrate-schedule-and-metrics.ts
 */

import pg from "pg";

async function main() {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL not set");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`
      ALTER TABLE creators
        ADD COLUMN IF NOT EXISTS nightly_swarm_enabled boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS nightly_swarm_hour integer,
        ADD COLUMN IF NOT EXISTS nightly_swarm_tz varchar(64),
        ADD COLUMN IF NOT EXISTS last_nightly_run_at timestamptz;
    `);
    await client.query(`
      ALTER TABLE publications
        ADD COLUMN IF NOT EXISTS shield_verdict varchar(16),
        ADD COLUMN IF NOT EXISTS metrics jsonb,
        ADD COLUMN IF NOT EXISTS metrics_fetched_at timestamptz;
    `);
    // eslint-disable-next-line no-console
    console.log("schedule + metrics columns ready");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
