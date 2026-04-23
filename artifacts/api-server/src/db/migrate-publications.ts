/**
 * One-shot migration: create the `publications` table.
 *
 * Pure additive change. Safe to run repeatedly via `IF NOT EXISTS`.
 *
 *   pnpm --filter @workspace/api-server exec tsx src/db/migrate-publications.ts
 */

import pg from "pg";

async function main() {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL not set");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS publications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
        video_id varchar(64) NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        platform varchar(16) NOT NULL,
        status varchar(16) NOT NULL,
        platform_post_id text,
        mock_url text,
        scheduled_for timestamptz,
        published_at timestamptz,
        error text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_publications_creator_created
        ON publications (creator_id, created_at);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_publications_video
        ON publications (video_id);
    `);
    // eslint-disable-next-line no-console
    console.log("publications table ready");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
