# Lumina

Lumina is a creator tool that enhances daily consistency for English-speaking micro-creators (1K–50K followers) by streamlining content creation from idea to export.

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
- **Core Ideator Logic:** `artifacts/api-server/src/lib/` (e.g., `patternIdeator.ts`, `ideaScorer.ts`, `hybridIdeator.ts`)
- **Taste Calibration Schema:** `artifacts/api-server/src/lib/tasteCalibration.ts`
- **User Blessed Hooks Corpus:** `artifacts/api-server/src/lib/userBlessedHookCorpus.ts`
- **Voice Clusters Definitions:** `artifacts/api-server/src/lib/voiceClusters.ts`
- **Trend Catalog:** `artifacts/api-server/src/lib/trendCatalog.ts`
- **Onboarding Seed Logic:** `artifacts/api-server/src/lib/onboardingSeed.ts`
- **Region Profile (R1 baseline + R4 voice bias + R2 fallback prompt):** `artifacts/api-server/src/lib/regionProfile.ts`
- **Region Anchor Catalog (R3):** `artifacts/api-server/src/lib/regionAnchorCatalog.ts`
- **Regional QA Harnesses (R1/R2/R3/R4):** `artifacts/api-server/src/qa/regionalR{1,2,3,4}Qa.ts` → outputs in `.local/REGIONAL_R{1,2,3,4}_QA.md`

## Architecture decisions

- **Hybrid Ideator Pipeline:** Prioritizes cost-efficiency by routing requests through a deterministic local pattern engine first, falling back to Claude Haiku 4.5 only when necessary.
- **Micro-creator Focus:** UI/UX decisions, such as the 3-step onboarding and single-tap export, are tailored for micro-creators to reduce friction.
- **Additive Development:** New features are layered as additive overlays, preserving existing functionality and minimizing schema/migration changes. Data changes are often pure TypeScript.
- **Quality-First LLM Mutation:** Llama 3.1 hook mutation only replaces original content if it scores strictly better, preventing quality regressions.
- **Layered Diversity & Novelty:** Utilizes multiple axes (script type, archetype, scene object tag, hook language style, voice profile, hook fingerprint, anchor, region) with tiered penalties and boosts to ensure diversity and freshness across generated ideas and batches.
- **Staged Regional Beta (R1→R4→R2→R3):** Non-western regions (nigeria/india/philippines) get layered, additive overlays — R1 deterministic caption/howToFilm decoration, R4 voice-cluster +slot bias (+1/+2 per region), R2 Claude-fallback prompt polish (clean English default + anti-stereotype + privacy notes; the generic "code-switch to slang" line is dropped for non-western and the per-region block is the sole source of truth), R3 small curated region anchor catalog (6 anchors per region) prepended to recipe queue at deterministic 25% gate per (salt, coreId), capped at 3 prefix recipes so the catalog queue still gets ≥5 of the 8 per-core attempts. Western and undefined-region paths are byte-identical to pre-overlay baseline at every phase. **Live 20-idea-per-region QA is a manual gate before beta rollout** — the synthetic harnesses (`qa/regionalR{1,2,3,4}Qa.ts`) verify the wiring is correct but live Claude + cohesive-author output quality remains untested.

## Product

- **Style Profiling:** Rule-based system to understand and adapt to creator styles.
- **Idea Generation:** AI-powered (Claude Haiku 4.5) video idea generation with strict constraints.
- **Templated Content Creation:** Tools for creating content using predefined templates.
- **Side-by-Side Review:** Process for comparing and refining content.
- **Export & Posting Flow:** Streamlined process for saving and posting content to various platforms.
- **Feedback Loop:** "Yes/Maybe/No" feedback on ideas influences future generations.
- **Enhancement Suggestions:** AI-driven suggestions for improving videos (caption, hook, etc.).
- **Quick Tune Calibration:** User-guided flow to bias idea generation based on preferences.
- **Regional Adaptation:** Deterministic per-region decoration layer for captions and filming instructions.

## User preferences

I prefer to develop iteratively and see changes frequently. Please ask before making any major architectural changes or introducing new dependencies. I value clear, concise explanations and prefer a functional programming style where appropriate. Do not make changes to files or folders marked as `ARCHIVED` or related to `MONETIZATION` or `POSTING` systems unless explicitly instructed and the associated feature flag is enabled.

## Gotchas

- **Cache Invalidation:** Changes to `creators.last_idea_batch_json` schema require careful handling to maintain backward compatibility.
- **LLM Rate Limits:** Be mindful of daily quotas and per-minute rate limits for AI calls.
- **Determinism:** Many ideator components rely on deterministic hashing and seeded randomness for reproducibility in QA and consistent user experience. Avoid introducing non-deterministic elements where determinism is expected.
- **Additive Layers:** When adding new features, ensure they are additive and preserve the behavior of frozen upstream phases.

## Pointers

- **Replit AI Integrations:** [https://docs.replit.com/ai/](https://docs.replit.com/ai/)
- **Drizzle ORM Documentation:** [https://orm.drizzle.team/docs/overview](https://orm.drizzle.team/docs/overview)
- **Zod Documentation:** [https://zod.dev/](https://zod.dev/)
- **Expo Documentation:** [https://docs.expo.dev/](https://docs.expo.dev/)
- **Clerk Documentation:** [https://clerk.com/docs](https://clerk.com/docs)