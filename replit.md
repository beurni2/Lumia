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
- **Lumina Evolution Engine (per-creator memory & adaptation, Phase 1 MVP):** Successor to v1 Viral Pattern Memory. A pattern-LEVEL (not topic-LEVEL) bias derived from recent feedback verdicts + action signals across **four structural dimensions**: `structure` (7 enum values — expectation_vs_reality, self_callout, denial_loop, avoidance, small_panic, social_awareness, routine_contradiction), `hookStyle` (5 — the_way_i, why_do_i, contrast, curiosity, internal_thought), `emotionalSpike` (5), and `format` (= the legacy `pattern` field, 4 values). The aggregator (`lib/viralPatternMemory.ts`) reads up to 50 rows each from `idea_feedback` and `ideator_signal` over a 60-day window and produces a `Record<tag, weight>` per dimension instead of the v1 top-3 arrays. New weight tables (verbatim from spec): yes=+1, maybe=+0.5, no=-2; exported=+3, make_another=+2, selected=+2, skipped=-1, abandoned=-1, regenerated_batch=-1. Per-tag weights are clamped to [-5, +10]. On top of the static weights the helper computes four transient adjustments per generation: (1) **MOMENTUM BOOST** — tag in 2+ of the last 10 positive interactions → 1.4× multiplier, 3+ → 1.7×; (2) **STALE PENALTY** — same `structure` in 3+ of last 5 accepted → -2 transient, same `format` in 4+ of last 5 → -1.5; (3) **TASTE SHIFT** — tag in last 10 positives but currently weight ≤ 0 → +2 promotion bonus; (4) **EXPLORATION TARGET** — anchor on the top-1 LEAN INTO `structure`, then surface 1–2 ADJACENT structures (from a hand-curated 7-key `STRUCTURE_ADJACENCY` map in the same file) that the creator hasn't explicitly accepted yet — keeps batches from collapsing into the same shape forever. `renderViralMemoryPromptBlock(memory, batchSize)` emits a Part-9 compact summary with LEAN INTO / AVOID / MOMENTUM / STALE / EXPLORATION TARGET / **BATCH MIX** sections; the BATCH MIX section enforces (a) ~70-80% aligned + ~20-30% adjacent-explore (with a hard ≥1-explore floor at batchSize ≥ 3 so the spec's 2/1 split for N=3 is preserved) and (b) "no more than ⌈N/2⌉ ideas may share the same `structure` or `hookStyle` value across the batch", plus the QUALITY OVERRIDE gate that lets the model drop a perfect-memory-match idea with a weak hook. Memory load is fail-soft (helper never throws + defensive try/catch in the call site) so a memory failure never breaks idea generation. Storage: `creators.viral_pattern_memory_json` (jsonb, nullable) for cached snapshots; the append-only `ideator_signal` table (uuid PK + FK to `creators`, indexed on `(creator_id, created_at desc)`) populated by `POST /api/ideas/signal`; and four NULLABLE `varchar(32)` columns added by **migration #19** — `structure` + `hook_style` on both `idea_feedback` and `ideator_signal` — that the aggregator reads alongside the pre-existing `idea_pattern` (= format) and `emotional_spike` columns. Pre-Evolution-Engine rows with NULL `structure` / `hook_style` are tolerated (skipped for that dimension) and a backward-compat `classifyHookStyle` heuristic fills `hookStyle` from the hook text for legacy rows. The feedback upsert uses `COALESCE(EXCLUDED.col, ideaFeedback.col)` on every structural-tag column so an older mobile build that omits the new fields cannot null-out tags a newer client previously recorded on the same `(creator, hook)` row. The mobile Home tab fires a fire-and-forget `selected` signal (with all four tags) when a creator taps a card to enter the create flow (`lib/ideatorSignal.ts`); failures are swallowed and never block UX. **Hidden ideator logic only — no dashboards, analytics, posting, or scheduling — those are explicitly out of scope for Phase 1.**
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