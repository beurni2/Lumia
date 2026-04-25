# Overview

This pnpm monorepo project, Lumina, is a creator tool designed to enhance daily consistency for English-speaking micro-creators (1K–50K followers). The core functionality revolves around a streamlined content creation loop: onboarding, style profiling, idea generation, content creation from templates, side-by-side review, and export.

The project has pivoted to a Phase 1 MVP focusing on a tightly scoped feature set. Key capabilities include a rule-based Style Profile, a cloud-based Ideator for generating video ideas using Claude Haiku 4.5, templated content creation, and a side-by-side review process. The Ideator adheres to strict constraints for video hooks and shoot times, and utilizes regional trend bundles. Lumina supports US, UK, CA, AU, IN, PH, and NG markets. Future phases aim to expand capabilities, but the current focus is on validating this core loop.

# User Preferences

I prefer to develop iteratively and see changes frequently. Please ask before making any major architectural changes or introducing new dependencies. I value clear, concise explanations and prefer a functional programming style where appropriate. Do not make changes to files or folders marked as `ARCHIVED` or related to `MONETIZATION` or `POSTING` systems unless explicitly instructed and the associated feature flag is enabled.

# System Architecture

Lumina is a pnpm workspace monorepo using TypeScript.

**UI/UX Decisions:**
- The mobile application is built with Expo (React Native), with a planned migration to Flutter + ExecuTorch/LiteRT + FFmpeg-kit in Phase 2 for on-device operations.
- The onboarding flow is a 3-step process: region picker, first video import leading to a quick-win idea, and two additional imports for a daily feed.
- The review process involves a side-by-side comparison of the creator's past video with the Lumina-generated version, including a plain-English diff.

**Technical Implementations:**
- **Monorepo Structure:** Managed with pnpm workspaces, each package handling its own dependencies.
- **Node.js:** Version 24.
- **API Framework:** Express 5 (`artifacts/api-server`) interacts with a PostgreSQL database via Drizzle ORM.
- **Database Conventions:** All database migrations are pure additive (no `DROP`, `ALTER COLUMN`, or PK changes). Migrations are managed via a small versioned registry. Primary-key types are immutable.
- **LLM Integration:** Utilizes Claude Haiku 4.5 via Replit AI Integrations for idea generation, with output capped at 8000 tokens per batch.
- **Style Extraction:** Rule-based using regex, keyword frequency, and simple scene-change detection; no vector databases or on-device models are used.
- **Trends:** Static JSON bundles per region (`packages/lumina-trends`), manually refreshed.
- **Authentication:** Clerk (`@clerk/express`) handles user authentication. A seeded demo creator allows unauthenticated access and bypasses daily quotas for development and testing.
- **Web QA Mode (temporary):** A flag-gated bypass for testing the Phase 1 onboarding loop in mobile Safari while the iOS dev build is blocked on Apple Developer approval. When `EXPO_PUBLIC_WEB_QA_MODE=true` (set in `artifacts/lumina/package.json` `dev` script) AND `Platform.OS === "web"`, `app/_layout.tsx` skips `ClerkProvider`/`AuthAwareRouter` entirely and uses a `QaAwareRouter` that mirrors the routing logic without the auth gate. The `(auth)/sign-in.tsx` and `(auth)/sign-up.tsx` screens have defensive `if (isWebQaMode()) return null` guards. With no Bearer token present, the api-server's `resolveCreator` transparently maps requests to the seeded demo creator (`is_demo = TRUE`, name "Alex"), so all API routes return real data. To reset and re-test the loop from scratch, clear the browser site storage (the `hasCompletedOnboarding` flag is in localStorage). Single source of truth: `artifacts/lumina/lib/qaMode.ts` — see its docstring for the exit criteria. Native builds never enter this branch (the flag also gates on `Platform.OS === "web"`). Remove the env var from the `dev` script once either the iOS dev client is buildable or the Clerk web proxy is extended to forward the CDN `/npm/...` bundle path.
- **Validation:** Zod is used for schema validation.
- **API Codegen:** Orval generates API hooks and Zod schemas from OpenAPI specifications.
- **Build System:** esbuild is used for CJS bundle creation.
- **Feature Flags:** Key features are guarded by feature flags, allowing for selective activation or archival of certain functionalities (e.g., `ARCHIVED_AUTONOMY`, `ARCHIVED_MONETIZATION`, `ARCHIVED_POSTING`).
- **Quota Management:** `lib/quota.ts` manages per-creator quotas (e.g., 2 idea batches per day).
- **AI Cost Management:** `lib/aiCost.ts` enforces a daily AI spend cap ($5 by default) per creator, preventing over-billing.
- **Job Queue:** A Postgres job queue with a partial unique index for deduplication.
- **Error Handling:** Structured error capture, in-process per-IP rate limiting, and Pino structured logging are implemented.
- **Consent:** Endpoints for user consent, data export, and data deletion are provided.

**Feature Specifications:**
- The Ideator generates video ideas with hard constraints: hook ≤ 3 seconds, ≤ 8 words; shoot ≤ 30 minutes.
- **Phase 1 entry-point rule (do not violate):** AI-generated ideas are the *only* primary entry into the filming/create flow. No "create your own hook", "write your own idea", or free-text composer is permitted in Phase 1 — the goal is minimize thinking, maximize action. A custom-idea path (provisional copy: "Got your own idea?" / "Remix your idea") will be introduced later as a *secondary* affordance, never as the primary CTA. Until then, every route into `app/create.tsx` must originate from an Ideator-produced idea passed via the `idea` search param.
- Four fixed timing templates are deterministically selected based on the Ideator's `templateHint`.
- One-tap export to the gallery with an optional "Made with Lumina" watermark.

# External Dependencies

- **pnpm workspaces:** Monorepo management.
- **TypeScript:** Programming language.
- **Expo (React Native):** Mobile application framework.
- **Express:** Web application framework for the API server.
- **Replit Postgres:** Database hosting.
- **Drizzle ORM:** Object-Relational Mapper for database interaction.
- **Clerk:** Authentication service.
- **Claude Haiku 4.5 (via Replit AI Integrations):** Large Language Model for idea generation.
- **Zod:** Schema declaration and validation library.
- **Orval:** OpenAPI client code generator.
- **esbuild:** JavaScript bundler.
- **pino:** Structured logging library.
- **Stripe:** (Archived/Feature-flagged) Payment processing and payouts.
- **PayPal:** (Archived/Feature-flagged) Payment processing.