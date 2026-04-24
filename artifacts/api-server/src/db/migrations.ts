/**
 * Versioned migrations registry.
 *
 * Each migration is a pure-additive SQL block (CREATE TABLE IF NOT
 * EXISTS / ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS) so
 * re-running on an environment that already has the table is a no-op.
 *
 * The `runMigrations` runner in ./migrate.ts:
 *   1. Acquires a session-level advisory lock so only one process can
 *      apply migrations at a time (prevents racing horizontally).
 *   2. Creates `_schema_migrations(version int pk, name text, applied_at)`.
 *   3. Sorts migrations by version, runs any not yet recorded inside a
 *      single transaction each, then records the version.
 *
 * Add new migrations here in ascending `id` order. **Never edit a
 * migration once it has been deployed** — write a new one instead.
 */

export type Migration = {
  id: number;
  name: string;
  sql: string;
};

export const migrations: Migration[] = [
  {
    id: 1,
    name: "consent_columns",
    sql: `
      ALTER TABLE creators
        ADD COLUMN IF NOT EXISTS ai_disclosure_consented_at timestamptz,
        ADD COLUMN IF NOT EXISTS adult_confirmed_at timestamptz;
    `,
  },
  {
    id: 2,
    name: "publications_table",
    sql: `
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
      CREATE INDEX IF NOT EXISTS idx_publications_creator_created
        ON publications (creator_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_publications_video
        ON publications (video_id);
    `,
  },
  {
    id: 3,
    name: "agent_runs_table",
    sql: `
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
      CREATE INDEX IF NOT EXISTS idx_agent_runs_creator_created
        ON agent_runs (creator_id, created_at);
    `,
  },
  {
    id: 4,
    name: "schedule_and_metrics",
    sql: `
      ALTER TABLE creators
        ADD COLUMN IF NOT EXISTS nightly_swarm_enabled boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS nightly_swarm_hour integer,
        ADD COLUMN IF NOT EXISTS nightly_swarm_tz varchar(64),
        ADD COLUMN IF NOT EXISTS last_nightly_run_at timestamptz;
      ALTER TABLE publications
        ADD COLUMN IF NOT EXISTS shield_verdict varchar(16),
        ADD COLUMN IF NOT EXISTS metrics jsonb,
        ADD COLUMN IF NOT EXISTS metrics_fetched_at timestamptz;
    `,
  },
  /* ------------------------------------------------------------------ *
   *   New production-readiness migrations begin here.                  *
   * ------------------------------------------------------------------ */
  {
    id: 5,
    name: "jobs_queue",
    // Postgres-backed durable job queue. SELECT ... FOR UPDATE SKIP
    // LOCKED is the correct primitive for cooperating workers; the
    // partial index on (status, run_at) keeps that scan cheap.
    sql: `
      CREATE TABLE IF NOT EXISTS jobs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        type varchar(64) NOT NULL,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        status varchar(16) NOT NULL DEFAULT 'pending',
        run_at timestamptz NOT NULL DEFAULT now(),
        attempts integer NOT NULL DEFAULT 0,
        max_attempts integer NOT NULL DEFAULT 3,
        locked_until timestamptz,
        last_error text,
        dedupe_key varchar(255),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_pending_run_at
        ON jobs (status, run_at)
        WHERE status = 'pending';
      CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_dedupe_key_pending
        ON jobs (dedupe_key)
        WHERE dedupe_key IS NOT NULL AND status IN ('pending','running');
    `,
  },
  {
    id: 6,
    name: "usage_counters",
    // Per-creator daily counters. Day is a date (UTC) so a single row
    // per (creator, day, kind) tuple. Cheap upserts via the unique key.
    sql: `
      CREATE TABLE IF NOT EXISTS usage_counters (
        creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
        day date NOT NULL,
        kind varchar(32) NOT NULL,
        count integer NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (creator_id, day, kind)
      );
    `,
  },
];
