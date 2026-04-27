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
  {
    id: 7,
    name: "error_events",
    // Structured error capture. Every uncaught error reaching the
    // express error handler writes one row here so we can answer
    // "what's been failing for whom in the last hour" without
    // grepping through pino-rotated JSON files. creator_id is
    // nullable because some errors happen before auth resolution
    // (e.g. malformed JSON body).
    sql: `
      CREATE TABLE IF NOT EXISTS error_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id varchar(64),
        occurred_at timestamptz NOT NULL DEFAULT now(),
        method varchar(8),
        route text,
        status_code integer,
        creator_id uuid REFERENCES creators(id) ON DELETE SET NULL,
        error_name varchar(120),
        error_message text,
        error_stack text,
        context jsonb NOT NULL DEFAULT '{}'::jsonb
      );
      CREATE INDEX IF NOT EXISTS idx_error_events_occurred
        ON error_events (occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_error_events_creator_occurred
        ON error_events (creator_id, occurred_at DESC)
        WHERE creator_id IS NOT NULL;
    `,
  },
  {
    id: 8,
    name: "ai_usage",
    // Per-call AI spend ledger. Cost is stored in micro-dollars
    // (1 USD = 1_000_000) as bigint so we never lose pennies to
    // float drift when summing across thousands of rows. agent_run_id
    // is nullable so cost can be recorded even when a call happens
    // outside a tracked agent run (e.g. ad-hoc admin tooling).
    sql: `
      CREATE TABLE IF NOT EXISTS ai_usage (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        creator_id uuid REFERENCES creators(id) ON DELETE SET NULL,
        agent_run_id uuid REFERENCES agent_runs(id) ON DELETE SET NULL,
        agent varchar(32),
        model varchar(64) NOT NULL,
        input_tokens integer NOT NULL DEFAULT 0,
        output_tokens integer NOT NULL DEFAULT 0,
        cost_usd_micro bigint NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_ai_usage_creator_created
        ON ai_usage (creator_id, created_at DESC)
        WHERE creator_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_ai_usage_run
        ON ai_usage (agent_run_id)
        WHERE agent_run_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_ai_usage_created
        ON ai_usage (created_at DESC);
    `,
  },
  {
    id: 9,
    name: "agent_runs_output",
    // Persist each step's structured result on its agent_runs row so a
    // re-invocation of the parent swarm can short-circuit any step
    // that already finished (per-step idempotency / resume). The
    // existing `summary` column is human-readable text; this jsonb is
    // the machine-readable handoff payload (e.g. {topBriefId, videoId})
    // that downstream agents consume in-process.
    sql: `
      ALTER TABLE agent_runs
        ADD COLUMN IF NOT EXISTS output jsonb;
      CREATE INDEX IF NOT EXISTS idx_agent_runs_parent_agent_status
        ON agent_runs (parent_run_id, agent, status)
        WHERE parent_run_id IS NOT NULL;
    `,
  },
  {
    id: 11,
    name: "creators_billing_and_connect",
    // Adds the Stripe + Stripe Connect columns onto `creators`. Pure
    // additive — no existing column or index is touched. The two
    // partial indexes let us look a creator up by either external id
    // (customer or connect-account) without an OR-scan, which the
    // webhook job handlers need on every event.
    sql: `
      ALTER TABLE creators
        ADD COLUMN IF NOT EXISTS stripe_customer_id varchar(64),
        ADD COLUMN IF NOT EXISTS stripe_subscription_id varchar(64),
        ADD COLUMN IF NOT EXISTS subscription_status varchar(32),
        ADD COLUMN IF NOT EXISTS subscription_plan varchar(32),
        ADD COLUMN IF NOT EXISTS subscription_current_period_end timestamptz,
        ADD COLUMN IF NOT EXISTS connect_account_id varchar(64),
        ADD COLUMN IF NOT EXISTS connect_payouts_enabled boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS connect_charges_enabled boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS connect_country varchar(2);

      CREATE INDEX IF NOT EXISTS idx_creators_stripe_customer
        ON creators (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_creators_connect_account
        ON creators (connect_account_id) WHERE connect_account_id IS NOT NULL;
    `,
  },
  {
    id: 12,
    name: "creators_phase1_mvp",
    // Phase 1 MVP additions on `creators` for region-conditioned
    // ideation + the lightweight Style Profile.
    //
    // Pure additive — only ADD COLUMN IF NOT EXISTS, no PK touched,
    // no existing column altered. The new columns are nullable
    // because pre-onboarding rows have no profile yet, and the
    // ideator endpoint defaults sensibly on absence.
    sql: `
      ALTER TABLE creators
        ADD COLUMN IF NOT EXISTS region varchar(16),
        ADD COLUMN IF NOT EXISTS style_profile_json jsonb,
        ADD COLUMN IF NOT EXISTS last_idea_batch_at timestamptz;
    `,
  },
  {
    id: 13,
    name: "imported_videos",
    // Records each clip the user picks during onboarding. Pure
    // additive: brand-new table with its own uuid PK, foreign-keys
    // back to creators(id) which is itself uuid. The existing
    // `videos` table is intentionally NOT used here — that one's
    // schema (status/script/agents NOT NULL) was designed for
    // agent-generated outputs and would force placeholder values
    // for an imported clip. A separate table keeps both surfaces
    // honest and lets us count imports cheaply on the home screen.
    sql: `
      CREATE TABLE IF NOT EXISTS imported_videos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
        filename varchar(255),
        duration_sec integer,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_imported_videos_creator_created
        ON imported_videos (creator_id, created_at DESC);
    `,
  },
  {
    id: 14,
    name: "idea_feedback",
    // Phase 1 MVP — per-idea creator feedback ("Would you post this?
    // Yes / Maybe / No"). Pure additive: brand-new table with its
    // own uuid PK, FK back to creators(id) which is itself uuid.
    // No FK to any "ideas" table because idea hooks are transient
    // (they live in AsyncStorage for the day's batch); the natural
    // identifier is `idea_hook` text.
    //
    // Two indexes on purpose:
    //   • (creator_id, created_at) — "what did this creator just
    //     say no to?" — drives the future ideator prompt feedback.
    //   • (verdict, created_at) — "what did the population reject
    //     this week?" — drives the Phase 2 trending surface.
    sql: `
      CREATE TABLE IF NOT EXISTS idea_feedback (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
        region varchar(16),
        idea_hook text NOT NULL,
        idea_caption text,
        idea_payoff_type varchar(32),
        verdict varchar(8) NOT NULL,
        reason text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_idea_feedback_creator_created
        ON idea_feedback (creator_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_idea_feedback_verdict_created
        ON idea_feedback (verdict, created_at DESC);
    `,
  },
  {
    id: 15,
    name: "idea_feedback_unique_per_hook",
    // Atomicity fix for /api/ideas/feedback. The original v14 route
    // did SELECT-then-INSERT/UPDATE, which races on a fast double-tap
    // — both requests can miss the SELECT and both INSERT, producing
    // a duplicate row that corrupts the very signal this loop exists
    // to collect. A unique index on (creator_id, idea_hook) lets the
    // route switch to a single-statement INSERT ... ON CONFLICT DO
    // UPDATE upsert, which is atomic in Postgres.
    //
    // Trade-off: a creator who sees the same hook re-surface in a
    // future day's batch can only have ONE feedback row per hook
    // forever — the latest verdict overwrites. This matches the
    // client's AsyncStorage cache (keyed by hook with no day stamp,
    // see lib/ideaFeedback.ts), so the UI never re-prompts on a
    // hook the user already voted on anyway. Net signal loss is
    // effectively zero.
    //
    // Safe to apply on the existing table: idea_feedback has only
    // existed since v14 (this same boot) and the v14 route's 60s
    // dedup window kept duplicate rows out, so there's no existing
    // pair that would violate the unique constraint.
    sql: `
      CREATE UNIQUE INDEX IF NOT EXISTS uq_idea_feedback_creator_hook
        ON idea_feedback (creator_id, idea_hook);
    `,
  },
  {
    id: 16,
    name: "idea_feedback_pattern_column",
    // Adds the `idea_pattern` column to `idea_feedback` so the
    // ideator can adapt its format distribution to per-creator taste
    // (see lib/formatDistribution.ts). Pure additive: NULLABLE
    // varchar(16), no default — old client builds that don't send
    // a pattern still produce valid rows (just without the new
    // signal). The aggregation query filters on `idea_pattern IS
    // NOT NULL` so historical rows are simply ignored.
    //
    // Index on (creator_id, idea_pattern, created_at DESC) drives
    // the per-creator-recent-feedback-window aggregation in
    // computeFormatDistribution(); without it the lookup becomes a
    // sequential scan on idea_feedback once the table is large.
    sql: `
      ALTER TABLE idea_feedback
        ADD COLUMN IF NOT EXISTS idea_pattern varchar(16);
      CREATE INDEX IF NOT EXISTS idx_idea_feedback_creator_pattern_created
        ON idea_feedback (creator_id, idea_pattern, created_at DESC);
    `,
  },
  {
    id: 17,
    name: "creators_taste_calibration_json",
    // Adds the optional Taste Calibration document to `creators` so
    // the new onboarding step (5 tap-only preference questions surfaced
    // AFTER the Style Profile reveal — see
    // components/onboarding/TasteCalibration.tsx) has somewhere to
    // persist. Pure additive: NULLABLE jsonb column, no default —
    // the absence of this column on old rows simply means "no
    // calibration on file" (the ideator falls back to defaults +
    // feedback-only adaptation, exactly as before migration 17).
    //
    // No index. The column is read once per ideator call by primary
    // key on `creators`, which is already covered by the table's PK
    // index. Adding a separate index would be wasted writes on a
    // jsonb document we never query by content.
    sql: `
      ALTER TABLE creators
        ADD COLUMN IF NOT EXISTS taste_calibration_json jsonb;
    `,
  },
  {
    id: 10,
    name: "webhook_events",
    // Permanent idempotency log for inbound webhooks. Composite PK is
    // the only unique constraint we need — duplicates are rejected by
    // ON CONFLICT DO NOTHING in the receiver. The jobs queue already
    // has its own dedupe on pending/running, but that gap closes the
    // moment a job moves to 'done': without this table, a Stripe
    // re-delivery of an already-processed event id would create a
    // brand-new pending job and double-process it.
    sql: `
      CREATE TABLE IF NOT EXISTS webhook_events (
        provider varchar(16) NOT NULL,
        event_id varchar(255) NOT NULL,
        received_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (provider, event_id)
      );
    `,
  },
];
