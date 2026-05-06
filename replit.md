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
- **Nigerian Pack Slot Reservation (N1-S2):** `artifacts/api-server/src/lib/nigerianPackSlotReservation.ts`
- **Per-Creator Pack Memory (N1-FULL-SPEC):** `artifacts/api-server/src/lib/nigerianPackCreatorMemory.ts`
- **N1 Codegen + Rejection Report:** `artifacts/api-server/src/qa/buildApprovedNigerianPack.ts` → `.local/N1_REJECTION_REPORT.md`
- **N1 Rotation Regression Analysis (Batch B-extension + Batch C):** `.local/N1_ROTATION_REGRESSION_ANALYSIS.md` (original root-cause report + 2026-05-06 update noting the staging-QA harness is non-deterministic by design — `Math.random` in core selection — and a single-sample HOLD verdict is sample-driven, not a real regression)
- **N1 Rotation Fix Proposal (WITHDRAWN):** `.local/N1_ROTATION_FIX_PROPOSAL.md` — Option C segment-interleave was implemented, regressed staging QA 29→15, reverted. Helper deleted post-architect-review; only the rotation-block comment pointer remains in `coreCandidateGenerator.ts` so future readers can audit the failed reasoning.
- **N1 Deterministic QA Harness (PHASE N1-QA-DET):** `nigerianStagingQa.ts` overrides `Math.random` with a seeded mulberry32 PRNG at start-of-run, restores at end. Default seed `0x4e315330`; override via `LUMINA_NG_QA_SEED=<int>` or `=random` for legacy non-deterministic mode. Same seed = byte-identical output across runs. Production code untouched (harness is a CLI script).
- **N1 QA Seed Sweep:** `.local/N1_QA_SEED_SWEEP.md` — 5-seed distribution under deterministic harness: combined fill 25/29/30/35/35 (median ~30, exactly at GO threshold); 3 of 5 seeds GO. Pack is healthy at the threshold; single-seed verdicts remain sample-driven until/unless harness moves to multi-seed median.
- **N1 Worksheet Extender:** `artifacts/api-server/src/qa/extendNigerianWorksheet.ts`
- **Regional QA Harnesses:** `artifacts/api-server/src/qa/regionalR{1,2,3,4}Qa.ts`

## Architecture decisions

- **Hybrid Ideator Pipeline:** Prioritizes cost-efficiency by routing requests through a deterministic local pattern engine first, falling back to Claude Haiku 4.5 only when necessary.
- **Micro-creator Focus:** UI/UX decisions, such as the 3-step onboarding and single-tap export, are tailored for micro-creators to reduce friction.
- **Additive Development:** New features are layered as additive overlays, preserving existing functionality and minimizing schema/migration changes. Data changes are often pure TypeScript.
- **Quality-First LLM Mutation:** Llama 3.1 hook mutation only replaces original content if it scores strictly better, preventing quality regressions.
- **Layered Diversity & Novelty:** Utilizes multiple axes (script type, archetype, scene object tag, hook language style, voice profile, hook fingerprint, anchor, region) with tiered penalties and boosts to ensure diversity and freshness.
- **N1 Nigerian Comedy Pack (BI 2026-05-06 — 204 live entries after Batch C-rebalance ingest of 30 phone/work/social/content drafts targeting the four domains starved by Batch B-extension; 13/80 cumulative rejections on quality-floor or coherence, surfaced honestly in `.local/N1_REJECTION_REPORT.md`):** The pack ships behind an environment flag (default OFF). Activation requires specific regional and language style conditions, ensuring no cross-region leakage. Pack entries are atomic and cannot be authored by the agent; they require a native speaker's review stamp (current pass: `BI 2026-05-06`). Mocking-spelling regex catches stretched/doubled forms only (≥2 repetition), preserving authentic Pidgin "abeg"/"wahala". Per-creator hook memory (60-entry cap, JSONB on `creators` table, migration #22) prevents visible repetition; enforced in slot reservation primary AND fallback paths.
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
- **N1 Pack Activation:** Never relax `canActivateNigerianPack`; all four AND-conditions are critical for cross-region leak prevention. `reviewedBy` must be a valid native speaker stamp — the integrity guard rejects empty stamps, the `PENDING_NATIVE_REVIEW` sentinel, and any stamp starting with `AGENT-PROPOSED` (used for agent-authored rewrite candidates that need reviewer sign-off). All sentinel comparisons normalize via `.trim()` first to reject whitespace-padded variants.
- **N1 Circular-Import TDZ:** `nigerianHookPackApproved.ts` MUST NOT self-call `assertNigerianPackIntegrity` or `registerApprovedPoolReference` at module top level — the circular import (`nigerianHookPack.ts` ↔ `nigerianHookPackApproved.ts` ↔ `nigerianHookQuality.ts`) puts `PACK_FIELD_BOUNDS` and `APPROVED_POOL_REF` in TDZ when flag ON. Both calls live in `nigerianHookPack.ts` L370 and L378-380 (latter is conditional on `length > 0`). The codegen template in `buildApprovedNigerianPack.ts` enforces this.
- **N1 Agent-Proposed Rewrites:** The agent may add rewrite candidates to `.local/REGIONAL_N1_REWRITES.yaml` with an explicit `reviewedBy: "AGENT-PROPOSED — pending BI review"` per-row override. These ride through the worksheet→ingest path but are rejected by all three defense layers (`buildApprovedNigerianPack` validator, `assertNigerianPackIntegrity` boot assert, `scoreNigerianPackEntry` safety check) until the reviewer overwrites the stamp with their initials + date.

## Pointers

- **Replit AI Integrations:** [https://docs.replit.com/ai/](https://docs.replit.com/ai/)
- **Drizzle ORM Documentation:** [https://orm.drizzle.team/docs/overview](https://orm.drizzle.team/docs/overview)
- **Zod Documentation:** [https://zod.dev/](https://zod.dev/)
- **Expo Documentation:** [https://docs.expo.dev/](https://docs.expo.dev/)
- **Clerk Documentation:** [https://clerk.com/docs](https://clerk.com/docs)