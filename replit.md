# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

This monorepo ships **Lumina** — an autonomous GenAI creative swarm for English-speaking micro-creators.

## Lumina v2.0 Blueprint (single source of truth)

US-first / English-first GTM. Day-1 markets: US (primary), UK, CA, AU, IN, PH, NG. Day-1 platforms: TikTok, Reels, Shorts. Day-1 payouts: Stripe Connect + PayPal instant. Day-1 compliance: CCPA, EU AI Act, COPPA, FTC disclosure, GDPR. SEA/LATAM is layered remotely in Phase 1 (months 2–6) once US proof lands. Pricing: Spark free (3 videos/day) · Lumina Pro $12.99/mo · 10% performance fee on incremental only.

The core agentic stack — Personal Style Twin, Swarm Studio, Smart Publisher, Earnings Engine, on-device privacy-first inference — is intact and non-negotiable. See `README.md`, `ARCHITECTURE.md`, `ROADMAP.md`.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Mobile**: Expo (React Native) · Reanimated · NativeTabs (iOS 26 liquid glass)
- **On-device inference**: quantized Llama 3.2 11B Vision · Mistral 7B · Qwen 3.5 9B (4/8-bit)
- **API framework**: Express 5 (`artifacts/api-server`) — now backed by Replit Postgres via Drizzle ORM (`src/db/schema.ts`, `src/db/client.ts`). All four routes (`/creator/me`, `/earnings/summary`, `/trends`, `/videos`) read from the database; the Sprint 3 Compliance Shield CDN / Deal Router / burst-layer endpoints layer on top — see `ARCHITECTURE.md`
- **Database**: Replit-managed PostgreSQL. Schema = creators · trend_briefs · videos · brand_deals · ledger_entries. Seed script: `artifacts/api-server/src/db/seed.ts`. The seeded demo creator (`is_demo = TRUE`) still serves any unauthenticated request so dev tooling and pre-sign-up onboarding renders content
- **Autonomous Swarm (Phase 1 — DONE)**: Four-agent pipeline lives in `artifacts/api-server/src/agents/`. `runner.ts` wraps each agent in agent_runs lifecycle bookkeeping (queued → running → done|failed). `ideator.ts` calls Claude Haiku 4.5 (`AI_INTEGRATIONS_ANTHROPIC_*` via Replit AI Integrations) to surface 2 fresh trend_briefs scoped to the creator. `director.ts` drafts a video row from the top brief (status='Editing', honoring the existing `VideoStatus` + `agents` OpenAPI contract: Ideating|Editing|Ready × pending|active|done). `editor.ts` refines the script + predicts viralScore → status='Ready'. `monetizer.ts` matches the video to a brand_deal and books a projected ledger_entries row (the 10% perf fee is computed downstream in `/earnings/summary`, never double-recorded). `swarm.ts` orchestrates them strictly sequentially via a parent agent_runs row; routes mounted at `POST /api/agents/run-overnight` (202 + runId, fire-and-forget via setImmediate), `GET /api/agents/runs`, `GET /api/agents/runs/:id`. Mobile `components/SwarmCta.tsx` wraps `useStartSwarmRun` + polling `useGetSwarmRun`, invalidates trends/videos/earnings caches on done. CTA lives on home + while-you-slept "Tomorrow's Promise". `agent_runs` table created via one-shot `src/db/migrate-agent-runs.ts` (no drizzle-kit installed; pure-additive `CREATE TABLE IF NOT EXISTS`)
- **Smart Publisher (Phase 3 — DONE)**: `packages/swarm-studio` already shipped real OAuth providers + posting clients for TikTok / Instagram Reels / YouTube Shorts (`src/platforms/{tiktok,instagram,youtube}.ts`); mobile `lib/oauth/platformAuthRegistry.ts` + `lib/publisherFactory.ts` wire them with a single `EXPO_PUBLIC_PUBLISHER_BACKEND=real` flip (mock registry stays default). Phase 3 closed the persistence gap: new `publications` table (`creator_id`, `video_id` → videos, `platform`, `status`, `platform_post_id`, `mock_url`, `scheduled_for`, `published_at`, `error`) created via one-shot `src/db/migrate-publications.ts`. Routes in `src/routes/publications.ts`: `POST /api/videos/:id/publications` (zod-validated, 401 on unknown user, 404 if video not owned by resolved creator), `GET /api/videos/:id/publications`, `GET /api/publications/recent`. OpenAPI declares `format: date-time` + `maxLength` constraints matching server validation. Mobile bridge: `app/studio/[id].tsx` passes `videoId` (and any sticky override) to `/publisher`, then renders ✓ tiktok / ✓ reels / ✓ shorts pill badges sourced from `useListVideoPublications` keyed by the orval-generated query key. `app/publisher.tsx` consumes both URL params (one-shot, then `router.replace` to strip), and after `launchPublishPlan` resolves it `Promise.allSettled`-fires `useRecordPublication` per platform result and invalidates the same generated query keys so badges hydrate without a manual refresh. Persistence is best-effort (logged to dev console on failure) so a flaky network never breaks the launch UX
- **Auth**: Clerk (whitelabel) — server uses `@clerk/express` `clerkMiddleware()` mounted before routes; Clerk's edge is exposed under `/api/__clerk` via a streaming proxy that runs *before* body parsers. `lib/resolveCreator.ts` reads `getAuth(req).userId`, atomically upserts (`ON CONFLICT (auth_user_id) DO NOTHING`) a fresh creator row on first sign-in, then re-selects so concurrent first requests deterministically resolve the same row. The mobile app wraps the tree in `ClerkProvider` (token cache + proxy URL) and gates routing in `app/_layout.tsx`: signed-out → `/(auth)/sign-in`; signed-in & not onboarded → `/onboarding`; signed-in & onboarded → `/(tabs)`. The generated API client's `setAuthTokenGetter` is registered at module scope and delegates through a ref so the very first request — even one fired during initial render — carries the freshest Clerk Bearer token. Branded `(auth)/sign-in.tsx` and `(auth)/sign-up.tsx` use the cosmic backdrop + firefly + Style-Twin orb language, built on Clerk Core v3 `useSignIn` / `useSignUp` (custom UI is required for Expo Go). Env vars `CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` / `VITE_CLERK_PUBLISHABLE_KEY` are managed by Replit; the Lumina dev script and `scripts/build.js` forward `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` and `EXPO_PUBLIC_CLERK_PROXY_URL` into the bundle
- **Payouts (Day-1)**: Stripe Connect + PayPal instant; Phase 1 layers Pix / GCash / OVO / SPEI / PromptPay / Wise
- **Validation**: Zod (`zod/v4`)
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/lumina run dev` — run the Lumina mobile app (Expo)
- `pnpm --filter @workspace/api-server run dev` — run the (currently frozen) API server locally
- `pnpm -r test` — run the full workspace test suite (the permanent quality gate)

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Compliance, Scheduler, Metrics (Apr 2026)

- **Consent surface**: `creators.ai_disclosure_consented_at` + `adult_confirmed_at`. Endpoints: `GET/POST /api/me/consent`, `POST /api/me/data-export`, `POST /api/me/data-delete`. Mobile onboarding has a 4th "consent" Act; profile screen exposes withdraw/export/delete.
- **Server-side gates**: `POST /api/videos/:id/publications`, `POST /api/agents/run-overnight`, and `POST /api/me/schedule` (enable=true) all require BOTH consents → 403 `consent_required`. The publications route also requires a `shieldVerdict` field and rejects `status='published' + verdict='blocked'` with 409.
- **Overnight scheduler**: `creators.nightly_swarm_{enabled,hour,tz,last_nightly_run_at}`. `lib/nightlyScheduler.ts` ticks every 5 min, computes IANA-tz local hour, atomic-claims via conditional `UPDATE ... WHERE lastNightlyRunAt IS NULL OR < dedupeFloor` (race-safe, 20h dedupe). Mobile profile has toggle + horizontal hour picker, tz auto-detected via `Intl`.
- **Platform metrics**: `publications.metrics` (jsonb `{views,likes,comments,shares}`) + `metrics_fetched_at`. `PATCH /api/videos/:id/publications/:pubId/metrics`, ownership-validated. OAuth posting clients (`TikTok`, `Instagram`, `YouTube`) each have a `fetchMetrics(remoteId)` method hitting the official analytics endpoints. Mobile `lib/metricsRefresher.ts` walks publications and PATCHes via the orval `useUpdatePublicationMetrics` hook; Studio badge row shows compact view counts (e.g. `12.5k ▶`) when metrics present, with a small refresh affordance.
- **Migrations** are one-shot pg scripts (`migrate-consent.ts`, `migrate-schedule-and-metrics.ts`) following the existing `migrate-publications.ts` / `migrate-agent-runs.ts` pattern (`ADD COLUMN IF NOT EXISTS`). No drizzle-kit in this repo. Subsequent migrations use a small versioned registry in `src/db/migrations.ts` + `src/db/migrate.ts` (advisory-lock, `IF NOT EXISTS` only, runs on every boot — same safety guarantees as drizzle-push, kept additive only).

## Production hardening (Apr 2026)

Across three rounds the API server picked up the production-readiness layer that the original blueprint deferred. All changes are pure-additive and run on boot:

- **Postgres job queue + scheduler**: `jobs` table (status/run_at/attempts/dedupe_key) with a partial unique index on `(dedupe_key) WHERE status IN ('pending','running')` that prevents duplicate work without blocking later re-enqueues. `nightlyScheduler` enqueues `swarm.run` jobs instead of calling `runOvernightSwarm` directly. `agent_runs` orphan reaper marks rows stuck in `running` past a TTL as `failed` so dashboards stay accurate.
- **AI cost ledger**: `ai_usage` rows record per-call input/output tokens, micro-USD cost (`Math.ceil`, zod-validated rate table per model), creator/agent/parent_run linkage. `lib/aiCost.ts` enforces a per-creator-per-UTC-day cap (`$5` default, configurable) and throws `DailyCapExceededError` *before* billing the call. `/api/admin/ai-usage` exposes daily / per-creator views (range scan via window-CTE, no full-table sort).
- **Per-step swarm idempotency**: `agent_runs.output jsonb` + partial index on `(parent_run_id, agent, status) WHERE parent_run_id IS NOT NULL`. `runner.ts` now checks for a prior `done` child by `(parent_run_id, agent)` and reuses its `summary + output` instead of re-billing the agent. End-to-end verified: 3 calls → 1 child row, fn invoked once.
- **Operational endpoints**: `/api/healthz` (process liveness) + `/api/readyz` (DB ping); `/api/admin/errors` (paged error_events); `/api/admin/overview` (jobs, errors-last-hour, swarms-today, AI spend + top spenders — `Promise.allSettled` so one slow widget can't blank the dashboard, partial failures returned in `errors[]`). All `/admin/*` routes refuse closed-by-default without `LUMINA_ADMIN_TOKEN`.
- **Webhooks**: `POST /api/webhooks/{stripe,clerk}` with manual HMAC-SHA256 signature verification (no svix/stripe SDK dependency). Raw body parser mounted at `/api/webhooks` *before* `express.json`. `constantTimeEqual` hashes both inputs to 32-byte SHA-256 digests before `timingSafeEqual` so it cannot throw on length mismatch and never leaks signature length via timing. Webhooks bypass the global 600/min IP limiter (skip predicate on `req.path.startsWith('/webhooks')`) so a flood of bogus signed-events can't starve real API traffic. Stripe handler dedupes via the new `webhook_events (provider, event_id)` PK *and* the jobs queue dedupe key — closes the gap where a successful job's dedupe slot would otherwise free up. Clerk handler inline-clears `auth_user_id` on `user.deleted` and back-fills empty names on `user.updated`. Both endpoints return `503 webhook_disabled` when the corresponding `*_WEBHOOK_SECRET` env var is missing (closed by default).
- **Other hardening**: structured `error_events` capture with stable name+digest grouping; in-process per-IP rate limiter on `/api` with optional `skip` predicate; `LUMINA_ADMIN_TOKEN` for ops endpoints; `cors` allowlist; pino structured logging.
