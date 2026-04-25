# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

This monorepo ships **Lumina** — a creator tool that lifts daily consistency for English-speaking micro-creators (1K–50K followers). The whole product is one loop:

> **Onboarding (region picker + 3 video imports) → rule-based Style Profile → cloud Ideator (region-conditioned) → templated Create → side-by-side Review → export.**

## Lumina Phase 1 MVP scope (single source of truth)

**Pivoted April 2026** from the autonomous GenAI swarm + monetization roadmap to a tightly-scoped Phase 1 MVP. Day-1 markets: US (primary), UK, CA, AU, IN, PH, NG. The locked spec lives at [`attached_assets/Pasted-LUMINA-PHASE-1-MVP-FINAL-LOCKED-SPEC*.txt`](attached_assets/) and is mirrored across [`README.md`](README.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), and [`ROADMAP.md`](ROADMAP.md).

**What's in v1:**

- One LLM surface only — `POST /api/ideator/generate` (Claude Haiku 4.5 via Replit AI Integrations), conditioned by a lightweight rule-based **Style Profile** + a static regional **Trend Bundle**.
- Hard constraints baked into the Ideator: hook ≤ 3 s · ≤ 8 words (understandable in < 3 s) · shoot ≤ 30 min.
- Four region bundles in `packages/lumina-trends`: western · india · philippines · nigeria.
- Four fixed timing templates (A Fast Hook · B Story Build · C POV/Relatable · D Trend Jack), selected deterministically from the Ideator's `templateHint`.
- Side-by-side review using a past video of the creator's vs. the Lumina version + plain-English diff.
- One-tap export to gallery + optional "Made with Lumina" watermark.
- Daily $ cap on AI spend (`$5` default, `LUMINA_DAILY_AI_USD_CAP`). Quota: 2 idea batches / creator / UTC day (`LUMINA_MAX_IDEA_BATCHES_PER_DAY`).

**Frozen behind feature flags** (defaults ON in `lib/featureFlags.ts`; flip env to `"false"` to revive selectively):

- `ARCHIVED_AUTONOMY=true` → swarm agents, overnight scheduler, agent run routes
- `ARCHIVED_MONETIZATION=true` → monetizer package, earnings routes, Stripe billing + Stripe Connect payout routes, PayPal, brand deals, performance fees, Lumina Pro tier
- `ARCHIVED_POSTING=true` → Smart Publisher, OAuth posting (TikTok / IG Reels / YT Shorts), publications routes, smart watermark, A/B variants

Source for archived systems still present in tree; physical move to `/archive/` is milestone **M7** in [`ROADMAP.md`](ROADMAP.md), gated on user approval after the v1 loop works end-to-end.

**Kept and reused for v1**: Express + Drizzle + Postgres infrastructure, Clerk auth (with demo-creator fallback), pino logging, Postgres job queue, AI cost ledger (`lib/aiCost.ts`), per-creator quota counters (`lib/quota.ts`), consent surface (`/api/me/consent`, `/api/me/data-export`, `/api/me/data-delete`), foundation/design system, BlackHoleUpload, ConfettiBurst, feedback haptics.

**Newly built for v1**: `packages/lumina-trends` (4 region JSONs), `src/lib/styleProfile.ts` (Zod-typed, all-optional defaults), `src/lib/ideaGen.ts` (Haiku call with hard constraints + recovery), `src/routes/ideator.ts`, `src/routes/styleProfile.ts`. Migration #12 added `creators.region varchar(16)` + `creators.style_profile_json jsonb` + `creators.last_idea_batch_at timestamptz` (pure additive, no PK changes).

The earlier v2.0 blueprint (autonomous swarm + Stripe Connect + brand-deal negotiation + 99.8 % Style Twin clone + 10 % performance fee + 12-variant A/B publisher + 6-pack Compliance Shield) is **archived**. Older content in any doc that contradicts this section should be read as historical context, not current scope.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Mobile**: Expo (React Native) · Reanimated · NativeTabs (iOS 26 liquid glass). The locked spec calls for an eventual move to **Flutter + ExecuTorch/LiteRT + FFmpeg-kit** for the on-device parts — Phase 2 only, after the v1 loop validates. Expo + Express stays for v1 to avoid a stack rewrite ahead of product proof.
- **API framework**: Express 5 (`artifacts/api-server`) backed by Replit Postgres via Drizzle ORM (`src/db/schema.ts`, `src/db/client.ts`).
- **Database**: Replit-managed PostgreSQL. Active v1 tables: `creators` · `videos` · `ai_usage` · `usage_counters` · `jobs` · `agent_runs` · `error_events`. Tables present in `schema.ts` from earlier work but not read or written by any v1 code path: `brand_deals`, `ledger_entries`, `publications`, `webhook_events` (belong to archived systems).
- **LLM**: Claude Haiku 4.5 via Replit AI Integrations (`AI_INTEGRATIONS_ANTHROPIC_*`). Single endpoint. Output cap clamped at 8000 tokens (within Haiku 4.5's 8192 ceiling) — enough for 20-idea quality batches.
- **Style extraction**: Rule-based (regex + keyword frequency + simple scene-change detection). No vector DB, no on-device model. Schema in [`artifacts/api-server/src/lib/styleProfile.ts`](artifacts/api-server/src/lib/styleProfile.ts).
- **Trends**: Static JSON bundles in [`packages/lumina-trends`](packages/lumina-trends), one per region. Manual refresh every few days.
- **Auth**: Clerk (`@clerk/express`). `clerkMiddleware()` mounts before routes; Clerk's edge is exposed under `/api/__clerk` via a streaming proxy that runs *before* body parsers. `lib/resolveCreator.ts` reads `getAuth(req).userId`, atomically upserts (`ON CONFLICT (auth_user_id) DO NOTHING`) a fresh creator row on first sign-in. The seeded demo creator (`is_demo = TRUE`) serves any unauthenticated request so dev tooling and pre-sign-up onboarding renders content; the demo creator also bypasses the idea-batch quota so curl-based quality testing isn't blocked at idea 21. Mobile wraps the tree in `ClerkProvider`; Lumina dev script + `scripts/build.js` forward `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` and `EXPO_PUBLIC_CLERK_PROXY_URL` into the bundle.
- **Validation**: Zod (`zod/v4`)
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/lumina run dev` — run the Lumina mobile app (Expo)
- `pnpm --filter @workspace/api-server run dev` — run the API server locally (port 8080)
- `pnpm -r test` — run the full workspace test suite

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Phase 1 MVP — what's where

| Surface | Location | Notes |
|---|---|---|
| **Region trend bundles** | `packages/lumina-trends/src/bundles/{western,india,philippines,nigeria}.json` | ~25 hooks + 15 captions + 10 formats per region with `popularityScore` + `recencyScore` |
| **Trend bundle loader** | `packages/lumina-trends/src/index.ts` | Typed `loadTrendBundle()` + `topByScore()` + `isRegion()` |
| **Style Profile schema** | `artifacts/api-server/src/lib/styleProfile.ts` | Zod-validated, all-optional defaults |
| **Ideator** | `artifacts/api-server/src/lib/ideaGen.ts` | Single Haiku call. Output cap clamps `hookSeconds ≤ 3` and `shootMinutes ≤ 30` defensively |
| **Ideator route** | `artifacts/api-server/src/routes/ideator.ts` | `POST /api/ideator/generate`. Body: `{ region?, count?, regenerate?, styleProfile? }`. Resolves region from body > `creators.region` > `western`. Demo creator bypasses quota |
| **Style Profile route** | `artifacts/api-server/src/routes/styleProfile.ts` | `GET/POST /api/style-profile`. Persists `creators.style_profile_json` + `creators.region` |
| **Quota** | `artifacts/api-server/src/lib/quota.ts` | `idea_batch` kind: 2/day default. `swarm_run` kind kept for the archived swarm but no v1 code calls it |
| **AI cost cap** | `artifacts/api-server/src/lib/aiCost.ts` | $5/day per-creator default. Throws `DailyCapExceededError` *before* billing |
| **Migration #12** | `artifacts/api-server/src/db/migrations.ts` | Pure additive `ALTER TABLE creators ADD COLUMN IF NOT EXISTS …` for region + style_profile_json + last_idea_batch_at |
| **Migration #13** | `artifacts/api-server/src/db/migrations.ts` | Pure additive `CREATE TABLE imported_videos` (uuid PK, FK→creators(id) ON DELETE CASCADE, idx on (creator_id, created_at DESC)). Records onboarding clip imports as metadata only — kept separate from `videos` (which has NOT NULL columns scoped to agent-generated outputs) |
| **Imported-videos route** | `artifacts/api-server/src/routes/importedVideos.ts` | `GET /api/imported-videos` (list+count) and `POST` (record metadata). Soft idempotency: same creator + filename within 5s returns the original row instead of duplicating, so network retries can't inflate the onboarding step counter |
| **MVP onboarding (mobile)** | `artifacts/lumina/app/onboarding.tsx` (router) + `components/onboarding/MvpOnboarding.tsx` (active) + `components/onboarding/CinematicOnboarding.tsx` (legacy) | 3-step flow: region picker (7 countries → 4 bundles), first import → quick-win idea, 2 more imports → daily feed. Sequential POSTs with retry path so the ideator quota isn't burned on transient failures. Uses `customFetch` directly (not codegen) — these endpoints are intentionally outside the OpenAPI spec |
| **Feature flags** | `artifacts/api-server/src/lib/featureFlags.ts` | `ARCHIVED_AUTONOMY` · `ARCHIVED_MONETIZATION` · `ARCHIVED_POSTING` (defaults ON). Mobile-side: `EXPO_PUBLIC_USE_CINEMATIC_ONBOARDING=true` opts back into the legacy 3-act onboarding |

## Database conventions

- All migrations are **pure additive** (`ALTER TABLE … ADD COLUMN IF NOT EXISTS …`, `CREATE TABLE IF NOT EXISTS …`, `CREATE INDEX IF NOT EXISTS …`). No `DROP`, no `ALTER COLUMN`, no PK changes — ever.
- No `drizzle-kit` in this repo. Migrations use a small versioned registry in [`src/db/migrations.ts`](artifacts/api-server/src/db/migrations.ts) + [`src/db/migrate.ts`](artifacts/api-server/src/db/migrate.ts) (advisory-locked, runs on every boot — same safety guarantees as drizzle-push, kept additive only).
- Primary-key types are immutable. `creators.id` is `uuid` with `gen_random_uuid()` default. `videos.id` / `brand_deals.id` / `trend_briefs.id` are `varchar(64)`. Composite PKs on `usage_counters (creator_id, day, kind)` and `webhook_events (provider, event_id)`.

## Production hardening (Apr 2026, kept in v1)

These were built during the v2.0 push but are infrastructure rather than product surface, so they remain active for v1:

- **Postgres job queue + scheduler**: `jobs` table (status / run_at / attempts / dedupe_key) with a partial unique index on `(dedupe_key) WHERE status IN ('pending','running')`. The nightly scheduler that previously enqueued `swarm.run` jobs is gated behind `ARCHIVED_AUTONOMY` and does not run in v1.
- **AI cost ledger**: `ai_usage` rows record per-call input/output tokens, micro-USD cost (`Math.ceil`, zod-validated rate table), creator/agent/parent_run linkage. `lib/aiCost.ts` enforces a per-creator-per-UTC-day cap (`$5` default, `LUMINA_DAILY_AI_USD_CAP`) and throws `DailyCapExceededError` *before* billing the call.
- **Operational endpoints**: `/api/healthz` (process liveness) + `/api/readyz` (DB ping). Admin endpoints (`/api/admin/*`) are closed-by-default behind `LUMINA_ADMIN_TOKEN`.
- **Structured error capture**: `error_events` with stable name+digest grouping. In-process per-IP rate limiter on `/api`. Pino structured logging.
- **Webhooks**: `POST /api/webhooks/{stripe,clerk}` plumbing exists with manual HMAC-SHA256 signature verification (no svix/stripe SDK dependency). Both endpoints return `503 webhook_disabled` when the corresponding `*_WEBHOOK_SECRET` env var is missing — closed by default in v1.
- **Consent surface**: `creators.ai_disclosure_consented_at` + `adult_confirmed_at`. Endpoints: `GET/POST /api/me/consent`, `POST /api/me/data-export`, `POST /api/me/data-delete`. Mobile profile screen exposes withdraw / export / delete.

## Archived systems (still in tree, not active in v1)

The following are from the v2.0 blueprint and are **frozen behind feature flags**. Source remains in the tree until the physical `/archive` move (roadmap milestone M7). None are in the v1 read/write path.

| System | Where it lives | Flag |
|---|---|---|
| Autonomous Swarm (Ideator → Director → Editor → Monetizer orchestrator + overnight scheduler + agent_runs idempotency) | `artifacts/api-server/src/agents/*` (excluding the file the v1 ideator-route lives in: it does not import the swarm) · `routes/agents.ts` | `ARCHIVED_AUTONOMY` |
| Smart Publisher + 12-variant A/B + smart watermark + Cultural Voice Packs | `packages/swarm-studio` · `routes/publications.ts` | `ARCHIVED_POSTING` |
| Compliance Shield (6 policy packs · 21 rules · 368-sample red-team corpus · auto-rewrite · hard-block) | `packages/compliance-shield` | (not mounted) |
| Earnings Engine + Monetization (10% perf fee · hash-chained ledger · brand graph · pitch deck · DM drafts · escrow · regional rails: Pix / GCash / OVO / SPEI / PromptPay / Wise) | `packages/monetizer` · `routes/earnings.ts` | `ARCHIVED_MONETIZATION` |
| Stripe billing + Stripe Connect payouts + PayPal | `routes/billing.ts` · `routes/payouts.ts` · `lib/stripe.ts` · `lib/stripeJobs.ts` | `ARCHIVED_MONETIZATION` (also closed-by-default unless `STRIPE_SECRET_KEY` set) |
| 99.8% Style Twin clone (encrypted on-device storage · similarity gates · voice timbre · vector kNN) | `packages/style-twin` | (not active; v1 uses `lib/styleProfile.ts` instead) |
| On-device inference (quantized Llama 3.2 11B Vision · Mistral 7B · Qwen 3.5 9B · ExecuTorch / llama.rn) | `packages/style-twin/IMPLEMENTATION_PLAN.md` (runbook only) | (not built) |
| Earnings dashboard + Referral Rocket (`while-you-slept.tsx` · morning recap · dual $25 bounty) | `artifacts/lumina/app/while-you-slept.tsx` | (removed from active navigation) |
