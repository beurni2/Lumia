# Overview

Lumina is a pnpm monorepo project designed as a creator tool to enhance daily consistency for English-speaking micro-creators (1K–50K followers). It streamlines the content creation loop from onboarding and style profiling to idea generation, templated content creation, side-by-side review, and export. The Phase 1 MVP focuses on core functionalities: a rule-based Style Profile, a cloud-based Ideator powered by Claude Haiku 4.5 for generating video ideas with strict constraints (hook, shoot times, regional trends), templated content creation, and a side-by-side review process. Lumina currently supports micro-creators in the US, UK, CA, AU, IN, PH, and NG markets. The project aims to validate this core loop before expanding features in future phases.

# User Preferences

I prefer to develop iteratively and see changes frequently. Please ask before making any major architectural changes or introducing new dependencies. I value clear, concise explanations and prefer a functional programming style where appropriate. Do not make changes to files or folders marked as `ARCHIVED` or related to `MONETIZATION` or `POSTING` systems unless explicitly instructed and the associated feature flag is enabled.

# System Architecture

Lumina is a pnpm workspace monorepo built with TypeScript.

**UI/UX Decisions:**
- The mobile application is developed using Expo (React Native).
- The onboarding process is a 3-step flow: region selection, first video import for a quick-win idea, and two additional imports for the daily feed.
- The review process includes a side-by-side comparison of the creator's original video with the Lumina-generated version, featuring a plain-English diff.

**Technical Implementations:**
- **Monorepo Structure:** Managed with pnpm workspaces.
- **Node.js:** Version 24.
- **API Framework:** Express 5 (`artifacts/api-server`) interacts with a PostgreSQL database via Drizzle ORM.
- **Database Conventions:** Purely additive migrations, managed via a versioned registry. Primary-key types are immutable.
- **LLM Integration:** Utilizes Claude Haiku 4.5 via Replit AI Integrations for idea generation, with output capped at 8000 tokens per batch.
- **Per-Creator Format Distribution:** A rule-based system (`lib/formatDistribution.ts`) derives a target mix of four canonical patterns (`pov`, `reaction`, `mini_story`, `contrast`) based on creator feedback, influencing the ideator prompt.
- **Optional Taste Calibration:** A 5-question preference screen (`components/onboarding/TasteCalibration.tsx`) that biases format distribution, tone, effort, privacy avoidances, and hook style based on user input, stored in `creators.taste_calibration_json`. Trigger logic lives in `lib/tasteCalibration.ts` (`needsCalibration()` predicate, shared by onboarding and Home); the Home tab uses a `useFocusEffect` gate to push the `/calibration` full-screen modal whenever the predicate fires (catches existing users + post-QA-reset re-triggers). A short-lived in-memory suppression window (`suppressCalibrationGate`) prevents the gate from racing the fire-and-forget Save/Skip POST. Dev/QA can force re-prompt via `?forceCalibration=1`, `EXPO_PUBLIC_FORCE_CALIBRATION=true`, or the Profile-tab "reset taste calibration" action (calls `DELETE /api/taste-calibration`).
- **Style Extraction:** Rule-based extraction using regex, keyword frequency, and simple scene-change detection.
- **Trends:** Static, manually refreshed JSON bundles per region (`packages/lumina-trends`).
- **Authentication:** Clerk (`@clerk/express`) manages user authentication.
- **Web QA Mode:** A flag-gated bypass for testing the onboarding loop in mobile Safari, routing unauthenticated requests to a seeded demo creator.
- **Validation:** Zod is used for schema validation.
- **API Codegen:** Orval generates API hooks and Zod schemas from OpenAPI specifications.
- **Build System:** esbuild is used for CJS bundle creation.
- **Feature Flags:** Key features are guarded by feature flags.
- **Quota Management:** `lib/quota.ts` manages per-creator daily quotas (e.g., 2 idea batches).
- **AI Cost Management:** `lib/aiCost.ts` enforces a daily AI spend cap per creator ($5 by default).
- **Job Queue:** A Postgres job queue with a partial unique index for deduplication.
- **Error Handling:** Structured error capture, in-process per-IP rate limiting, and Pino structured logging.
- **Consent:** Endpoints for user consent, data export, and deletion.

**Feature Specifications:**
- The Ideator generates video ideas with hard constraints: hook ≤ 3 seconds/8 words, shoot ≤ 30 minutes, and ≥50% low-effort ideas per batch. It includes a best-effort top-up rule to ensure the requested idea count is met without errors.
- **Phase 1 Idea Feedback:** Users provide "Yes / Maybe / No" feedback on ideas in the Home feed. "No" feedback prompts for a reason. This feedback influences future idea generation and trending boards.
- **Phase 1 Entry Point:** AI-generated ideas are the sole primary entry into the filming/create flow; no custom idea creation is permitted in Phase 1.
- **Phase 1 Multi-clip:** The import step accepts one or two clips, primarily for simple problem/solution or before/after scenarios. Templates render a single short-form video output.
- Four fixed timing templates are deterministically selected based on the Ideator's `templateHint`.
- One-tap export to the gallery with an optional "Made with Lumina" watermark.

# External Dependencies

- **pnpm workspaces:** Monorepo management.
- **TypeScript:** Programming language.
- **Expo (React Native):** Mobile application framework.
- **Express:** Web application framework for the API server.
- **Replit Postgres:** Database hosting.
- **Drizzle ORM:** Object-Relational Mapper.
- **Clerk:** Authentication service.
- **Claude Haiku 4.5 (via Replit AI Integrations):** Large Language Model.
- **Zod:** Schema declaration and validation library.
- **Orval:** OpenAPI client code generator.
- **esbuild:** JavaScript bundler.
- **pino:** Structured logging library.