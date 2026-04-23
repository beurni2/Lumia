/**
 * One-shot migration: add consent columns to creators.
 *
 * Pure additive — both columns are nullable, no row backfill needed.
 * Existing creators show as "not yet consented" and the new server
 * gates (publish + swarm) will require them to consent before any
 * gated action proceeds.
 *
 *   pnpm --filter @workspace/api-server exec tsx src/db/migrate-consent.ts
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
        ADD COLUMN IF NOT EXISTS ai_disclosure_consented_at timestamptz,
        ADD COLUMN IF NOT EXISTS adult_confirmed_at timestamptz;
    `);
    // eslint-disable-next-line no-console
    console.log("creators consent columns ready");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
