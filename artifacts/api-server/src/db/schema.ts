/**
 * Lumina backend schema — single source of truth.
 *
 * Designed for the production multi-creator world we're moving toward,
 * but seeded with the same demo data the in-memory routes used so the
 * mobile app keeps working unchanged.
 *
 * Tables:
 *   creators            — one row per creator account (Clerk userId pending).
 *   trend_briefs        — Ideator-surfaced trends; will be regenerated daily
 *                         by the swarm in production. Currently seeded.
 *   videos              — work-in-progress + published pieces a creator owns.
 *   brand_deals         — monetizer deal pipeline.
 *   ledger_entries      — append-only earnings ledger. Hash-chained in app
 *                         logic by packages/monetizer; the row itself is a
 *                         flat record so we can SELECT/aggregate fast.
 */

import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const creators = pgTable("creators", {
  id: uuid("id").primaryKey().defaultRandom(),
  // External identity (Clerk userId or other auth provider). Nullable
  // until Clerk is wired so the demo creator can exist without a user.
  authUserId: varchar("auth_user_id", { length: 255 }).unique(),
  name: varchar("name", { length: 120 }).notNull(),
  location: varchar("location", { length: 120 }).notNull(),
  niche: varchar("niche", { length: 120 }).notNull(),
  followers: integer("followers").notNull().default(0),
  currency: varchar("currency", { length: 3 }).notNull().default("USD"),
  imageKey: varchar("image_key", { length: 64 }).notNull(),
  // Demo creators are returned by /creator/me when no auth context exists,
  // letting the mobile app render content during onboarding / signed-out.
  isDemo: boolean("is_demo").notNull().default(false),
  // Compliance surface (FTC AI-content disclosure + COPPA adult gate).
  // Both nullable until the user actively consents — server-side gates
  // (publication recording + swarm runs) refuse to proceed until both
  // timestamps are populated.
  aiDisclosureConsentedAt: timestamp("ai_disclosure_consented_at", {
    withTimezone: true,
  }),
  adultConfirmedAt: timestamp("adult_confirmed_at", { withTimezone: true }),
  // Nightly swarm scheduler — opt-in fire-and-forget. The scheduler ticks
  // every 5 min and runs a swarm cycle for any opted-in creator whose
  // local hour (per `nightlySwarmTz`) currently equals `nightlySwarmHour`
  // and whose `lastNightlyRunAt` is older than 20 hours.
  nightlySwarmEnabled: boolean("nightly_swarm_enabled")
    .notNull()
    .default(false),
  nightlySwarmHour: integer("nightly_swarm_hour"),
  nightlySwarmTz: varchar("nightly_swarm_tz", { length: 64 }),
  lastNightlyRunAt: timestamp("last_nightly_run_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const trendBriefs = pgTable(
  "trend_briefs",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    title: varchar("title", { length: 200 }).notNull(),
    context: varchar("context", { length: 200 }).notNull(),
    viralPotential: integer("viral_potential").notNull(),
    description: text("description").notNull(),
    imageKey: varchar("image_key", { length: 64 }).notNull(),
    // Optional creator scope — null = global feed (today's catalog),
    // populated when the swarm queues a brief for a specific creator.
    creatorId: uuid("creator_id").references(() => creators.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_trends_creator").on(t.creatorId)],
);

export const videos = pgTable(
  "videos",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    // NOT NULL: every video belongs to a creator. Global / unscoped video
    // rows are not part of the product model.
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 200 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    viralScore: integer("viral_score"),
    reasoning: text("reasoning").notNull(),
    thumbnailKey: varchar("thumbnail_key", { length: 64 }).notNull(),
    script: text("script").notNull(),
    // Per-agent state map. Stored as jsonb so we can index/query later
    // without a separate join table for the four-key payload.
    agents: jsonb("agents").$type<Record<string, string>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_videos_creator").on(t.creatorId)],
);

export const brandDeals = pgTable(
  "brand_deals",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    brand: varchar("brand", { length: 120 }).notNull(),
    // Status: Negotiating | Signed | Paid (matches earnings UI tone map).
    status: varchar("status", { length: 32 }).notNull(),
    amount: integer("amount").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_brand_deals_creator").on(t.creatorId)],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    // Calendar month bucket — YYYY-MM. Lets us aggregate "currentMonth"
    // and the 7-month history sparkline with simple GROUP BY.
    monthBucket: varchar("month_bucket", { length: 7 }).notNull(),
    amount: integer("amount").notNull(),
    source: varchar("source", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_ledger_creator_month").on(t.creatorId, t.monthBucket)],
);

/**
 * agent_runs — one row per swarm/agent invocation.
 *
 * The orchestrator inserts a parent row with agent='swarm' and one
 * child row per agent (ideator/director/editor/monetizer) referencing
 * the parent via parent_run_id. This gives us a tree per cycle so the
 * mobile app can show "what the swarm did last night" without joining
 * across four tables.
 */
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    // 'swarm' (parent) | 'ideator' | 'director' | 'editor' | 'monetizer'
    agent: varchar("agent", { length: 32 }).notNull(),
    // 'queued' | 'running' | 'done' | 'failed'
    status: varchar("status", { length: 16 }).notNull().default("queued"),
    parentRunId: uuid("parent_run_id"),
    summary: text("summary"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_agent_runs_creator_created").on(t.creatorId, t.createdAt)],
);

export type Creator = typeof creators.$inferSelect;
export type TrendBrief = typeof trendBriefs.$inferSelect;
export type Video = typeof videos.$inferSelect;

/**
 * publications — per-(video, platform) publish outcome tracking.
 *
 * One row per platform attempt. The Smart Publisher launches up to 3
 * platforms in parallel (TikTok / Reels / Shorts) and writes one row
 * per result. Status mirrors what the platform returned so the UI can
 * show "✓ tiktok" badges or "blocked: caption rewritten" hints without
 * re-running the orchestrator.
 */
export const publications = pgTable(
  "publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    videoId: varchar("video_id", { length: 64 })
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    platform: varchar("platform", { length: 16 }).notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    platformPostId: text("platform_post_id"),
    mockUrl: text("mock_url"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    error: text("error"),
    // Compliance Shield verdict captured at the moment of publish.
    // Server rejects status='published' rows whose verdict='blocked'
    // — preventing a buggy or malicious client from recording a
    // "successful" post the Shield refused to allow.
    shieldVerdict: varchar("shield_verdict", { length: 16 }),
    // Last-known platform metrics for this post, refreshed by the
    // mobile client (the only place that holds the OAuth tokens).
    metrics: jsonb("metrics").$type<{
      views: number;
      likes: number;
      comments: number;
      shares: number;
    }>(),
    metricsFetchedAt: timestamp("metrics_fetched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_publications_creator_created").on(t.creatorId, t.createdAt),
    index("idx_publications_video").on(t.videoId),
  ],
);
export type Publication = typeof publications.$inferSelect;
export type BrandDeal = typeof brandDeals.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type AgentRun = typeof agentRuns.$inferSelect;

/**
 * jobs — durable background work queue.
 *
 * Backs the swarm scheduler and any future enqueue-based work
 * (metrics refresh, scheduled publishes, etc.). See lib/jobQueue.ts
 * for the worker. `dedupeKey` makes "enqueue if not already pending"
 * a one-row insert thanks to the partial unique index in migration 5.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: varchar("type", { length: 64 }).notNull(),
    payload: jsonb("payload").notNull().default({}),
    // 'pending' | 'running' | 'succeeded' | 'failed'
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    runAt: timestamp("run_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastError: text("last_error"),
    dedupeKey: varchar("dedupe_key", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("idx_jobs_pending_run_at").on(t.status, t.runAt)],
);

/**
 * usage_counters — per-creator, per-day, per-kind counters.
 *
 * Used by lib/quota.ts to cap expensive operations (currently the
 * nightly swarm). Composite PK (creator_id, day, kind) means upserts
 * are a single row each.
 */
export const usageCounters = pgTable(
  "usage_counters",
  {
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    kind: varchar("kind", { length: 32 }).notNull(),
    count: integer("count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.creatorId, t.day, t.kind] })],
);

export type Job = typeof jobs.$inferSelect;
export type UsageCounter = typeof usageCounters.$inferSelect;
