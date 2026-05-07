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
- **N1 Pack Eligible Draw Cap (BI 2026-05-07):** `NIGERIAN_PACK_ELIGIBLE_DRAW_CAP=12` (was 3 via shared `NIGERIAN_PACK_PREFIX_CAP`) inside the activation-gated `if (packEligible.length > 0)` block in `coreCandidateGenerator.ts`. Original `NIGERIAN_PACK_PREFIX_CAP=3` export preserved for non-NG use. Effect: per-core diagnostic shows `attempted: 12, authoredOk: 12` (was 3). End-to-end pack delivery 10% → 40% on fresh creator memory. Remaining ceiling at L1281-1304 per-core best-pick (single winner per core by `hookQualityScore` collapses 12 pack candidates → 1, where pack often loses to catalog).
- **N1 Pack-Aware Per-Core Retention (BI 2026-05-07):** Staging-only flag `LUMINA_NG_PACK_AWARE_RETENTION_ENABLED` (default OFF; production `start` does NOT set it). Inside the activation-gated `if (packEligible.length > 0)` block in `coreCandidateGenerator.ts` (L~1356-1387), when `passing.length > 1` the per-core picker now retains BOTH the global best AND a distinct best-PACK candidate (different `nigerianPackEntryId`) — widens per-core retention 1→2 in the activated NG branch only. The pack picker consults a per-creator pack memory snapshot (`recentNigerianPackEntryIds: ReadonlySet<string>` on `GenerateCoreCandidatesInput`, optional, empty-Set default) and skips entryIds the creator already saw, preventing cross-batch repeats. Snapshot is HOISTED above `generateCoreCandidates` in `hybridIdeator.ts` (L~3897-3913) and reused at the slot-reservation `excludeEntryIds` site (L4708) — single DB read per request, gated on full NG activation context (`region==="nigeria"` + `languageStyle ∈ {pidgin,light_pidgin}` + `LUMINA_NG_PACK_ENABLED`) so non-NG cohorts pay nothing. Global `best` is still pushed unconditionally — never under-fills vs pre-flag baseline. No validator/scorer/corpus/safety/anti-copy semantics changed. Result on demo creator with both flags ON (cohort=nigeria/pidgin+light_pidgin, fresh memory, x5 batches each): 26/30=87% pack delivery, 26/26 distinct entryIds=100% refresh, leak gates clean=0/western=0.
- **N1 Live-Harden P1+P2+P3+P4 (BI 2026-05-07):**
  - **P1 (memory soft-cap rescue):** Staging-only rescue gated by `LUMINA_NG_MEMORY_SOFT_CAP_ENABLED=true` (production `start` script does NOT set it → OFF in prod). When per-creator hook memory wipes the pack pool to 0 (`packPoolPostMemoryFilter===0` AND `packPoolPreFilter>0`), `applyNigerianPackSlotReservation` constructs a per-request relaxed seen-set keeping only the most-recent ⌈n/2⌉ entries (`getRecentSeenEntriesOrdered` in `nigerianPackCreatorMemory.ts`) and re-filters. Rescue runs UPSTREAM of per-batch dedup, which is preserved. New diagnostic fields `softCapRescueFired`/`softCapRelaxedSeenSize`. Emits `nigerian_pack.memory_soft_cap_rescued`.
  - **P2 (per-core diagnostic):** `coreCandidateGenerator` emits `nigerian_pack.candidate_block_diagnostic` info log per core showing pack pipeline counters (eligible→matching→attempted→authoredOk→survivedFpDedup→enteredPassing) for in-prod observability.
  - **P3 (skip Claude when local sufficient):** In `hybridIdeator`, normal-tap (`!regenerate`) requests skip the Claude fallback when `localResult.kept.length >= desiredCount && merged.length >= 3 && selection.batch.length >= desiredCount && selection.guardsPassed`. The skip ONLY masks the regenerate-novelty (`layer1CoreAwareTriggered`) path; the hard failure paths (under-fill, guard fail, bare-pool `merged<3`) ALWAYS trigger fallback. Emits `hybrid_ideator.p3_skip_fallback_local_sufficient`. Reduces warm-state non-regenerate latency from ~35s → 2-7s.
  - **P4 (45s generateIdeas timeout):** Wraps `generateIdeas` in a 45s `Promise.race` with `clearTimeout` in `finally`, preventing the orchestrator from hanging past the client's 60s budget when an upstream call stalls.
- **Catalog Skeleton Swap — Recency-Scored Picker (BI 2026-05-07):** Root-cause fix for cross-batch catalog hook repetition in the post-pack-reservation skeleton swap (`hybridIdeator.ts` ~L4778-4848). Two coordinated changes:
  1. **Recency-scored alt picker** replaces the prior deterministic `merged.find()` two-tier search. For every non-pack candidate in `merged` not used in-batch and whose skeleton differs from the repeating one, score = `Number.POSITIVE_INFINITY` if the skeleton is unseen by the creator, else its 0-indexed recency rank from the new `getRecentSeenSkeletonRecency` helper (0 = most recent, larger = older). The highest-score alt wins → unseen first, then oldest-seen. Rotates the picker away from always selecting the same first-match alt across batches, eliminating the 2× residual repeats the prior `find()` fallback left behind. SWAP-only semantics preserved (never drops, never shrinks pool).
  2. **`CATALOG_SKELETON_MEMORY_CAP` 24 → 48** in `catalogTemplateCreatorMemory.ts`. The previous cap saturated within ~3 batches in activated NG cohorts (catalog template space ≈ 7 templates × 16 scenarios), collapsing the picker's score gradient. 48 covers ~6 batches without saturation; payload remains a tiny per-row JSONB array of short skeleton strings. The matching cap test was updated and the "drops oldest" test was widened to 60 entries to still exercise eviction.
  
  Result on demo creator (45 batches, 7 cohorts, all 3 staging flags ON, fresh memory): **0 cross-batch catalog hook repeats in either ng_pidgin or ng_light** (prior partial fix left 4 hooks at 2× in ng_light); pack delivery ng_pidgin 80% / ng_light 33% (combined 56.7%); refresh ng_pidgin 95.8% / ng_light 100%; 0 in-batch dups; 0 pack leaks; 0 errors. The single residual ng_pidgin hook repeat (`ng_2cbca29` "group chat don hijack…") is a PACK entry, not catalog — outside this fix's scope.
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
- **N1 Draft Reviewer Stamp (BI 2026-05-06):** Draft assert in `nigerianHookPackDrafts.ts` rejects empty, `PENDING_NATIVE_REVIEW`, and `AGENT-PROPOSED*` reviewer stamps. After the BI 2026-05-06 ingest pass every draft must carry a real reviewer initials+date stamp. Codegen (`qa/buildApprovedNigerianPack.ts`) writes per-draft rejection detail to `.local/N1_REJECTION_REPORT.md`; current state: 204 approved / 13 rejected of 217 worksheet rows.

## Pointers

- **Replit AI Integrations:** [https://docs.replit.com/ai/](https://docs.replit.com/ai/)
- **Drizzle ORM Documentation:** [https://orm.drizzle.team/docs/overview](https://orm.drizzle.team/docs/overview)
- **Zod Documentation:** [https://zod.dev/](https://zod.dev/)
- **Expo Documentation:** [https://docs.expo.dev/](https://docs.expo.dev/)
- **Clerk Documentation:** [https://clerk.com/docs](https://clerk.com/docs)