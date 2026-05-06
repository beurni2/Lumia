# Lumina

Lumina is a creator tool that enhances daily consistency for English-speaking micro-creators by streamlining content creation from idea to export.

## Run & Operate

- **Run development server:** `pnpm dev`
- **Build application:** `pnpm build`
- **Run typecheck:** `pnpm typecheck`
- **Generate API client:** `pnpm orval`
- **Push database schema:** `pnpm drizzle-kit push:pg`

**Environment Variables:**
- `DATABASE_URL`: PostgreSQL connection string.
- `CLERK_SECRET_KEY`: Clerk authentication secret.
- `CLAUDE_API_KEY`: API key for Claude Haiku 4.5.
- `OPENROUTER_API_KEY`: API key for OpenRouter AI.
- `EXPO_PUBLIC_SHOW_POST_BETA_SURFACES`: Feature flag for beta surfaces.
- `LUMINA_NG_PACK_ENABLED`: Nigerian Comedy Pack feature flag.
- `LUMINA_NG_STYLE_PENALTY_ENABLED`: NG-pidgin/light_pidgin American-internet style penalty.

## Stack

- **Frameworks:** Expo (React Native), Express
- **Runtime:** Node.js 24
- **ORM:** Drizzle ORM
- **Validation:** Zod
- **Build Tool:** esbuild
- **Language:** TypeScript
- **Monorepo Tool:** pnpm workspaces

## Where things live

- **Mobile App Source:** `artifacts/lumina/`
- **API Server Source:** `artifacts/api-server/`
- **Database Schema:** `artifacts/api-server/src/db/schema.ts`
- **API Contracts:** `artifacts/api-server/openapi.yaml`
- **Core Ideator Logic:** `artifacts/api-server/src/lib/`
- **Taste Calibration Schema:** `artifacts/api-server/src/lib/tasteCalibration.ts`
- **Nigerian Comedy Pack Logic:** `artifacts/api-server/src/lib/nigerianHookPack.ts`
- **N1 Style Penalty Logic:** `artifacts/api-server/src/lib/nigerianStylePenalty.ts`
- **N1 Deterministic QA Harness:** `nigerianStagingQa.ts`

## Architecture decisions

- **Hybrid Ideator Pipeline:** Routes requests through a deterministic local pattern engine first, falling back to Claude Haiku 4.5 only when necessary to optimize cost.
- **Micro-creator Focus:** UI/UX (e.g., 3-step onboarding, single-tap export) is tailored to reduce friction for micro-creators.
- **Additive Development:** Features are implemented as additive overlays, preserving existing functionality and minimizing schema changes.
- **Quality-First LLM Mutation:** Llama 3.1 hook mutation only replaces original content if it demonstrates strict quality improvement.
- **Layered Diversity & Novelty:** Utilizes multiple axes (script type, archetype, scene object tag, hook language style, voice profile, hook fingerprint, anchor, region) with tiered penalties and boosts to ensure diverse and fresh content.
- **Nigerian Comedy Pack (N1):** An environment flag-gated feature with specific regional and language style activation conditions to prevent cross-region leakage. Pack entries are atomic, require native speaker review, and are protected by per-creator hook memory.
- **N1-FULL-SPEC Live Optimizations:** Includes `n1LiveSkipFallback` to bypass costly Claude regeneration when local pools are sufficient, and `maxReserved` adjustments in `nigerianPackSlotReservation.ts` for pack-first composition.
- **Staged Regional Beta:** Non-western regions receive layered, additive overlays for content decoration, voice-cluster biasing, prompt polishing, and curated regional anchor catalogs.
- **Per-Creator Skeleton Memory (FIX C v2):** Catalog hook-skeleton dedup runs AFTER pack reservation as a SWAP only — never drops candidates, never shrinks pool. Stores normalized hook skeletons (long tokens ≥5 chars → `__`, cap 24) in `creators.catalog_template_seen_ids_json`. Cohort-agnostic; degrades gracefully when no novel alternative exists.
- **FIX D — Anchor Pre-Validation in Pattern Engine:** `assembleCandidate` in `patternIdeator.ts` pre-validates `scenarioCoherence` rule (4) at construction time (≥1 substantial hook token must appear in `whatToShow`), soft-skipping bad pairings so the Cartesian iter re-rolls. Eliminates the dominant `show_missing_hook_anchor` rejection (~11/16 catalog candidates per batch) at the downstream `phase_ux3_1.pattern_coherence_filter`, which kept the local pool below `desiredCount` and forced a Claude fallback. Validator semantics UNCHANGED — only the rejection point moves upstream. `tokenize`/`STOPWORDS` are inlined as `fixDTokenize`/`FIX_D_STOPWORDS` (NOT imported) to avoid a circular-import TDZ on `PREMISE_CORES`; the two copies MUST stay byte-identical. Result: warm-state batch latency drops from ~35s → 2-7s.

## Product

- **Style Profiling:** Rule-based system for adapting to creator styles.
- **Idea Generation:** AI-powered video idea generation with strict constraints.
- **Feedback Loop:** "Yes/Maybe/No" feedback mechanism influences future idea generations.
- **Enhancement Suggestions:** AI-driven suggestions for improving videos.
- **Quick Tune Calibration:** User-guided flow for biasing idea generation.
- **Regional Adaptation:** Deterministic per-region decoration layer for captions and filming instructions.

## User preferences

I prefer to develop iteratively and see changes frequently. Please ask before making any major architectural changes or introducing new dependencies. I value clear, concise explanations and prefer a functional programming style where appropriate. Do not make changes to files or folders marked as `ARCHIVED` or related to `MONETIZATION` or `POSTING` systems unless explicitly instructed and the associated feature flag is enabled.

## Gotchas

- **Cache Invalidation:** Careful handling required for `creators.last_idea_batch_json` schema changes.
- **LLM Rate Limits:** Be mindful of daily and per-minute AI call quotas.
- **Determinism:** Many ideator components rely on deterministic hashing and seeded randomness.
- **Additive Layers:** New features must be additive and preserve upstream phase behavior.
- **N1 Pack Activation:** `canActivateNigerianPack` conditions are critical for leak prevention and `reviewedBy` must be a valid native speaker stamp.
- **N1 Style Penalty Symmetry:** `canApplyNigerianStylePenalty` must mirror `canActivateNigerianPack` to prevent cohort gate splitting and penalty leakage. Applied only at `scoreHookQuality` for catalog hooks, not pack hooks.
- **N1 Circular-Import TDZ:** `nigerianHookPackApproved.ts` must not self-call `assertNigerianPackIntegrity` or `registerApprovedPoolReference` at the module top level due to circular import dependencies.
- **N1 Agent-Proposed Rewrites:** Agent-proposed rewrites in `.local/REGIONAL_N1_REWRITES.yaml` require explicit reviewer sign-off to pass integrity checks.

## Pointers

- **Replit AI Integrations:** [https://docs.replit.com/ai/](https://docs.replit.com/ai/)
- **Drizzle ORM Documentation:** [https://orm.drizzle.team/docs/overview](https://orm.drizzle.team/docs/overview)
- **Zod Documentation:** [https://zod.dev/](https://zod.dev/)
- **Expo Documentation:** [https://docs.expo.dev/](https://docs.expo.dev/)
- **Clerk Documentation:** [https://clerk.com/docs](https://clerk.com/docs)