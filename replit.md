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
- **Variation Injection (per-batch):** A hard rule baked into the ideator system prompt (`lib/ideaGen.ts`) that forces every batch to vary at least 2 of {scenario, setting, emotional spike, hook style, payoff type, prop/action} between ideas, and forbids two ideas from sharing the same core scenario. Eliminates the "coffee/coffee/coffee" failure mode while preserving the winning emotional pattern.
- **Viral Pattern Memory (per-creator):** A pattern-LEVEL (not topic-LEVEL) bias derived from recent feedback verdicts and downstream action signals. The aggregator (`lib/viralPatternMemory.ts`) reads up to 50 rows each from `idea_feedback` and the new `ideator_signal` table over a 60-day window, weights them (exported=5, make_another=4, selected=3, yes=2, maybe=1, no=-2, skipped/abandoned=-1, regenerated_batch=-0.5), and ranks the top-3 liked / top-3 disliked across four structural dimensions (pattern, emotionalSpike, payoffType, hookStyle). The rendered prompt block (only emitted when sampleSize≥3) tells the model to keep the winning STRUCTURE and swap the SURFACE; it is injected after the calibration block in both the main and top-up prompt paths. Memory load is fail-soft (helper never throws + defensive try/catch in the call site) so a memory failure never breaks idea generation. Storage: `creators.viral_pattern_memory_json` (jsonb, nullable) for cached snapshots, plus the append-only `ideator_signal` table (uuid PK + FK to `creators` + index on `(creator_id, created_at desc)`) populated by `POST /api/ideas/signal`. The mobile Home tab fires a fire-and-forget `selected` signal when a creator taps a card to enter the create flow (`lib/ideatorSignal.ts`); failures are swallowed and never block UX. The `idea_feedback` table also gained an `emotional_spike` column so verdicts can key on spike alongside pattern + payoff.
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