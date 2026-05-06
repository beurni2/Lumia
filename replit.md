# Lumina

Lumina is a creator tool that enhances daily consistency for English-speaking micro-creators by streamlining content creation from idea to export.

## Run & Operate

- **Run development server:** `pnpm dev`
- **Build application:** `pnpm build`
- **Run typecheck:** `pnpm typecheck`
- **Generate API client:** `pnpm orval`
- **Push database schema:** `pnpm drizzle-kit push:pg`

**Environment Variables:**
- `DATABASE_URL`: Connection string for PostgreSQL.
- `CLERK_SECRET_KEY`: Clerk authentication secret.
- `CLAUDE_API_KEY`: API key for Claude Haiku 4.5.
- `OPENROUTER_API_KEY`: API key for OpenRouter AI (used by Llama mutator).
- `EXPO_PUBLIC_SHOW_POST_BETA_SURFACES`: Feature flag for beta surfaces (default: `false`).
- `LUMINA_NG_PACK_ENABLED`: Nigerian Comedy Pack feature flag (default: `"false"`).

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
- **Nigerian Comedy Pack (N1):** `artifacts/api-server/src/lib/nigerianHookPack.ts`
- **Regional QA Harnesses:** `artifacts/api-server/src/qa/regionalR{1,2,3,4}Qa.ts`

## Architecture decisions

- **Hybrid Ideator Pipeline:** Prioritizes cost-efficiency by routing requests through a deterministic local pattern engine first, falling back to Claude Haiku 4.5 only when necessary.
- **Micro-creator Focus:** UI/UX decisions, such as the 3-step onboarding and single-tap export, are tailored for micro-creators to reduce friction.
- **Additive Development:** New features are layered as additive overlays, preserving existing functionality and minimizing schema/migration changes. Data changes are often pure TypeScript.
- **Quality-First LLM Mutation:** Llama 3.1 hook mutation only replaces original content if it scores strictly better, preventing quality regressions.
- **Layered Diversity & Novelty:** Utilizes multiple axes (script type, archetype, scene object tag, hook language style, voice profile, hook fingerprint, anchor, region) with tiered penalties and boosts to ensure diversity and freshness.
- **N1 Nigerian Comedy Pack (Dark Infrastructure):** The pack ships empty and is behind an environment flag. Activation requires specific regional and language style conditions, ensuring no cross-region leakage. Pack entries are atomic and cannot be authored by the agent; they require a native speaker's review stamp. Mocking-spelling regex prevents cartoonized tropes.
- **Staged Regional Beta (R1→R4→R2→R3):** Non-western regions receive layered, additive overlays for content decoration, voice-cluster biasing, prompt polishing, and curated regional anchor catalogs. Western and undefined-region paths remain byte-identical to the baseline. Live QA is a manual gate before beta rollout.

## Product

- **Style Profiling:** Rule-based system to understand and adapt to creator styles.
- **Idea Generation:** AI-powered video idea generation with strict constraints.
- **Feedback Loop:** "Yes/Maybe/No" feedback on ideas influences future generations.
- **Enhancement Suggestions:** AI-driven suggestions for improving videos.
- **Quick Tune Calibration:** User-guided flow to bias idea generation based on preferences.
- **Regional Adaptation:** Deterministic per-region decoration layer for captions and filming instructions.

## User preferences

I prefer to develop iteratively and see changes frequently. Please ask before making any major architectural changes or introducing new dependencies. I value clear, concise explanations and prefer a functional programming style where appropriate. Do not make changes to files or folders marked as `ARCHIVED` or related to `MONETIZATION` or `POSTING` systems unless explicitly instructed and the associated feature flag is enabled.

## Gotchas

- **Cache Invalidation:** Changes to `creators.last_idea_batch_json` schema require careful handling.
- **LLM Rate Limits:** Be mindful of daily quotas and per-minute rate limits for AI calls.
- **Determinism:** Many ideator components rely on deterministic hashing and seeded randomness.
- **Additive Layers:** New features must be additive and preserve upstream phase behavior.
- **N1 Pack Activation:** Never relax `canActivateNigerianPack`; all four AND-conditions are critical for cross-region leak prevention. `reviewedBy` must be a valid native speaker stamp — the integrity guard rejects empty stamps, the `PENDING_NATIVE_REVIEW` sentinel, and any stamp starting with `AGENT-PROPOSED` (used for agent-authored rewrite candidates that need reviewer sign-off).
- **N1 Agent-Proposed Rewrites:** The agent may add rewrite candidates to `.local/REGIONAL_N1_REWRITES.yaml` with an explicit `reviewedBy: "AGENT-PROPOSED — pending BI review"` per-row override. These ride through the worksheet→ingest path but are rejected by all three defense layers (`buildApprovedNigerianPack` validator, `assertNigerianPackIntegrity` boot assert, `scoreNigerianPackEntry` safety check) until the reviewer overwrites the stamp with their initials + date.

## Pointers

- **Replit AI Integrations:** [https://docs.replit.com/ai/](https://docs.replit.com/ai/)
- **Drizzle ORM Documentation:** [https://orm.drizzle.team/docs/overview](https://orm.drizzle.team/docs/overview)
- **Zod Documentation:** [https://zod.dev/](https://zod.dev/)
- **Expo Documentation:** [https://docs.expo.dev/](https://docs.expo.dev/)
- **Clerk Documentation:** [https://clerk.com/docs](https://clerk.com/docs)