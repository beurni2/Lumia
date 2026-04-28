# Overview

Lumina is a pnpm monorepo project designed as a creator tool to enhance daily consistency for English-speaking micro-creators (1K–50K followers). It streamlines the content creation loop from onboarding and style profiling to idea generation, templated content creation, side-by-side review, and export. The Phase 1 MVP focuses on a rule-based Style Profile, a cloud-based Ideator powered by Claude Haiku 4.5 for generating video ideas with strict constraints, templated content creation, and a side-by-side review process. Lumina supports micro-creators in the US, UK, CA, AU, IN, PH, and NG markets, aiming to validate this core loop.

# User Preferences

I prefer to develop iteratively and see changes frequently. Please ask before making any major architectural changes or introducing new dependencies. I value clear, concise explanations and prefer a functional programming style where appropriate. Do not make changes to files or folders marked as `ARCHIVED` or related to `MONETIZATION` or `POSTING` systems unless explicitly instructed and the associated feature flag is enabled.

# System Architecture

Lumina is a pnpm workspace monorepo built with TypeScript.

**UI/UX Decisions:**
- The mobile application is developed using Expo (React Native).
- The onboarding process is a 3-step flow: region selection, first video import, and two additional imports.
- The post-export review screen reads as a finish line: a single final-video preview, a 3-item confidence strip, an optional 2-action Quick Boost (Smoother flow / Faster hook with Fix → Done ✓ micro-interaction), a friction-free "Made with Lumina" watermark toggle, a primary "Save & Post" CTA, and low-emphasis "Make another version" / "Back to ideas" secondary actions. No before/after comparison, analysis blocks, or technical warnings.
- A 5-question screen biases format distribution, tone, effort, privacy, and hook style based on user input.
- One-tap export to the gallery with an optional "Made with Lumina" watermark.

**Technical Implementations:**
- **Monorepo Structure:** Managed with pnpm workspaces.
- **Node.js:** Version 24.
- **API Framework:** Express 5 interacts with PostgreSQL via Drizzle ORM.
- **Database Conventions:** Additive migrations, versioned registry, immutable primary-key types.
- **LLM Integration:** Claude Haiku 4.5 via Replit AI Integrations for idea generation.
- **Per-Creator Format Distribution:** Rule-based system derives a target mix of four canonical patterns.
- **Variation Injection:** Hard rule in the ideator system prompt forces variation across scenario, setting, emotional spike, hook style, payoff type, and prop/action, preventing repetition within a batch.
- **Caption Craft:** Ideator system prompt enforces caption quality for generated ideas.
- **Lumina Evolution Engine:** Derives pattern-level bias from recent feedback and action signals, aggregating data over 60 days to guide idea generation.
- **Style Extraction:** Rule-based extraction using regex, keyword frequency, and scene-change detection.
- **Trends:** Static, manually refreshed JSON bundles per region.
- **Authentication:** Clerk.
- **Web QA Mode:** Flag-gated bypass for testing onboarding with a seeded demo creator.
- **Validation:** Zod for schema validation.
- **API Codegen:** Orval generates API hooks and Zod schemas from OpenAPI specifications.
- **Build System:** esbuild for CJS bundle creation.
- **Feature Flags:** Key features guarded by feature flags.
- **Quota Management:** Manages per-creator daily quotas and AI spend caps.
- **Job Queue:** Postgres job queue with partial unique index for deduplication.
- **Error Handling:** Structured error capture, in-process per-IP rate limiting, and Pino structured logging.
- **Consent:** Endpoints for user consent, data export, and deletion.

**Feature Specifications:**
- The Ideator generates video ideas with hard constraints: hook ≤ 3 seconds/8 words, shoot ≤ 30 minutes, and ≥50% low-effort ideas per batch.
- Users provide "Yes / Maybe / No" feedback on ideas, influencing future generation and trending boards.
- AI-generated ideas are the sole primary entry into the filming/create flow.
- The import stage supports adding 1-2 clips with "Film" or "Upload" options.
- The "Ready to post?" stage confirms video readiness with hook + clip + caption and offers "Export video" or "Make another version."
- Film-screen UX includes a "Why this works" block derived from idea metadata.
- Camera permission denial is handled gracefully, allowing users to upload instead.
- Four fixed timing templates are deterministically selected based on the Ideator's `templateHint`.
- **Enhancement Brain:** Provides up to 3 typed suggestions (caption, hook, start hint, manual) for video improvement, reusing style derivation and viral pattern memory.
- **Semi-auto Suggestion Apply:** Allows applying suggestions with immediate visual feedback in the Before/After frame, triggering an `applied_enhancement` signal.
- **Semi-auto Edit (stitch + trim):** Offers `stitch_clips` and `trim_start` actions with visual confirmation in the Before/After frame. No on-device video processing; changes are intent-only for future processing.
- **QA-mode onboarding bypass:** Allows skipping onboarding for e2e tests.
- **Visible adaptation flow (Quick Tune):** A 3-step auto-advancing flow (format → tone → hook) that biases idea generation based on user preferences, with visual feedback and a "Better match?" prompt.
- **Quick Tune onboarding trigger:** Triggers the Quick Tune flow based on client-side state after a certain number of ideas are viewed or scrolled.
- **Daily-habit copy lock:** Home screen H1 and sub are locked to "3 ideas for today" / "Made for your style." Daily return messages vary based on user history.

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