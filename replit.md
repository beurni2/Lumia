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
