# Overview

Lumina is a pnpm monorepo project designed as a creator tool to enhance daily consistency for English-speaking micro-creators (1K–50K followers). It streamlines the content creation loop from onboarding and style profiling to idea generation, templated content creation, side-by-side review, and export. The Phase 1 MVP focuses on a rule-based Style Profile, a cloud-based Ideator powered by Claude Haiku 4.5 for generating video ideas with strict constraints, templated content creation, and a side-by-side review process. Lumina currently supports micro-creators in the US, UK, CA, AU, IN, PH, and NG markets, aiming to validate this core loop before expanding features.

# User Preferences

I prefer to develop iteratively and see changes frequently. Please ask before making any major architectural changes or introducing new dependencies. I value clear, concise explanations and prefer a functional programming style where appropriate. Do not make changes to files or folders marked as `ARCHIVED` or related to `MONETIZATION` or `POSTING` systems unless explicitly instructed and the associated feature flag is enabled.

# System Architecture

Lumina is a pnpm workspace monorepo built with TypeScript.

**UI/UX Decisions:**
- The mobile application is developed using Expo (React Native).
- The onboarding process is a 3-step flow: region selection, first video import, and two additional imports for the daily feed.
- The review process includes a side-by-side comparison with a plain-English diff.

**Technical Implementations:**
- **Monorepo Structure:** Managed with pnpm workspaces.
- **Node.js:** Version 24.
- **API Framework:** Express 5 (`artifacts/api-server`) interacts with PostgreSQL via Drizzle ORM.
- **Database Conventions:** Additive migrations, versioned registry, immutable primary-key types.
- **LLM Integration:** Claude Haiku 4.5 via Replit AI Integrations for idea generation (8000 tokens/batch cap).
- **Per-Creator Format Distribution:** Rule-based system (`lib/formatDistribution.ts`) derives a target mix of four canonical patterns (`pov`, `reaction`, `mini_story`, `contrast`).
- **Variation Injection (per-batch):** Hard rule in the ideator system prompt (`lib/ideaGen.ts`) forces variation across scenario, setting, emotional spike, hook style, payoff type, and prop/action, preventing repetition within a batch.
- **Caption Craft (per-idea):** Ideator system prompt enforces caption quality: continues the moment, 3–8 words, adds new detail, reads like a text message, connects to hook+trigger+reaction, bans generic fluff/repetition.
- **Lumina Evolution Engine (per-creator memory & adaptation):** Derives pattern-level bias from recent feedback and action signals across `structure`, `hookStyle`, `emotionalSpike`, and `format`. Aggregates data from `idea_feedback` and `ideator_signal` over 60 days, producing `Record<tag, weight>`. Includes momentum boosts, stale penalties, taste shifts, and exploration targets to guide idea generation. Fail-soft design ensures memory failures don't break generation.
- **Optional Taste Calibration:** A 5-question screen (`components/onboarding/TasteCalibration.tsx`) biases format distribution, tone, effort, privacy, and hook style based on user input.
- **Style Extraction:** Rule-based extraction using regex, keyword frequency, and scene-change detection.
- **Trends:** Static, manually refreshed JSON bundles per region (`packages/lumina-trends`).
- **Authentication:** Clerk (`@clerk/express`).
- **Web QA Mode:** Flag-gated bypass for testing onboarding with a seeded demo creator.
- **Validation:** Zod for schema validation.
- **API Codegen:** Orval generates API hooks and Zod schemas from OpenAPI specifications.
- **Build System:** esbuild for CJS bundle creation.
- **Feature Flags:** Key features guarded by feature flags.
- **Quota Management:** `lib/quota.ts` manages per-creator daily quotas.
- **AI Cost Management:** `lib/aiCost.ts` enforces a daily AI spend cap per creator.
- **Job Queue:** Postgres job queue with partial unique index for deduplication.
- **Error Handling:** Structured error capture, in-process per-IP rate limiting, and Pino structured logging.
- **Consent:** Endpoints for user consent, data export, and deletion.

**Feature Specifications:**
- The Ideator generates video ideas with hard constraints: hook ≤ 3 seconds/8 words, shoot ≤ 30 minutes, and ≥50% low-effort ideas per batch, with a best-effort top-up rule.
- **Phase 1 Idea Feedback:** Users provide "Yes / Maybe / No" feedback on ideas, influencing future generation and trending boards.
- **Phase 1 Entry Point:** AI-generated ideas are the sole primary entry into the filming/create flow; no custom idea creation.
- **Phase 1 Multi-clip Rule:** The import stage supports exactly two labeled tap-targets ("Clip 1" and "Clip 2 (optional)"), allowing users to select single clips into fixed slots without editing tools. Fast entry via "camera" or "picker" auto-opens the native modal for Slot 1.
- **Film-screen UX (Tips stage):** Renders a "Why this works" block derived client-side from idea metadata. Both "I'm ready to film" and "Upload video instead" routes lead to the same unified Import stage.
- Four fixed timing templates are deterministically selected based on the Ideator's `templateHint`.
- One-tap export to the gallery with an optional "Made with Lumina" watermark.

# External Dependencies

- **pnpm workspaces:** Monorepo management.
- **TypeScript:** Programming language.
- **Expo (React Native):** Mobile application framework.
- **Express:** Web application framework.
- **Replit Postgres:** Database hosting.
- **Drizzle ORM:** Object-Relational Mapper.
- **Clerk:** Authentication service.
- **Claude Haiku 4.5 (via Replit AI Integrations):** Large Language Model.
- **Zod:** Schema declaration and validation.
- **Orval:** OpenAPI client code generator.
- **esbuild:** JavaScript bundler.
- **pino:** Structured logging library.