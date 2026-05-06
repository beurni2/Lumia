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
- `LUMINA_NG_PACK_ENABLED`: Nigerian Comedy Pack feature flag (default: `false`). Must be the literal string `"true"` to enable; only meaningful once the pack is populated and the integration site is wired (currently dark).

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
- **Nigerian Comedy Pack (N1, DARK):** `artifacts/api-server/src/lib/nigerianHookPack.ts` (atomic 8-field entries, empty pool, boot asserts, central activation guard); QA harness `artifacts/api-server/src/qa/nigerianPackQa.ts` → `.local/REGIONAL_N1_QA.md`
- **N1 Promotion Review Sheet (read-only export):** `artifacts/api-server/src/qa/nigerianPackPromotionSheet.ts` → `.local/REGIONAL_N1_PROMOTION_SHEET.{md,csv}`. Heuristic suggestions only (`suggestedPromotionTier`, `needsRewrite`, `notes`); native reviewer remains the authority on tier + sentinel replacement.
- **N1 Native Reviewer Worksheet (read-only export, Top 50 only):** `artifacts/api-server/src/qa/nigerianPackReviewerWorksheet.ts` → `.local/REGIONAL_N1_REVIEWER_WORKSHEET.{md,csv}`. Selects 50 safest activation candidates (light_pidgin/pidgin · anchor in hook AND whatToShow · no mocking · field bounds OK) and emits a worksheet with reviewer-editable columns: `DECISION` (approve/rewrite/reject), `FINAL_PIDGIN_LEVEL`, `REVIEWED_BY`, `NOTES`, `REWRITTEN_*`. Does NOT mutate drafts, does NOT touch live pack, does NOT create `APPROVED_NIGERIAN_PROMOTION_CANDIDATES` (that comes in a separate ingestion step after reviewer returns decisions). Final sanity guard throws if any selected row's `reviewedBy !== PENDING_NATIVE_REVIEW`.
- **Nigerian Pack DRAFT Batches A+B+C (300 candidates, INERT):** `artifacts/api-server/src/lib/nigerianHookPackDrafts.ts` — separate `DRAFT_NIGERIAN_HOOK_PACK` constant holds Batch A (100) + Batch B (100) + Batch C (100), each appended with section divider. Combined tier breakdown: 163 clean / 136 light_pidgin / 1 pidgin (activation-eligible after promotion: 137). `DraftNigerianPackEntry` type extends 8-field shape with `cluster`, optional `privacyNote`, widens `pidginLevel` to allow `clean` for triage. `PENDING_NATIVE_REVIEW` sentinel, structural-only `assertNigerianDraftPackIntegrity` (skips anchor-in-text + mocking regex — those are reviewer's job). Reference-identity guard in `getEligibleNigerianPackEntries` throws if drafts are passed via `as` cast.

## Architecture decisions

- **Hybrid Ideator Pipeline:** Prioritizes cost-efficiency by routing requests through a deterministic local pattern engine first, falling back to Claude Haiku 4.5 only when necessary.
- **Micro-creator Focus:** UI/UX decisions, such as the 3-step onboarding and single-tap export, are tailored for micro-creators to reduce friction.
- **Additive Development:** New features are layered as additive overlays, preserving existing functionality and minimizing schema/migration changes. Data changes are often pure TypeScript.
- **Quality-First LLM Mutation:** Llama 3.1 hook mutation only replaces original content if it scores strictly better, preventing quality regressions.
- **Layered Diversity & Novelty:** Utilizes multiple axes (script type, archetype, scene object tag, hook language style, voice profile, hook fingerprint, anchor, region) with tiered penalties and boosts to ensure diversity and freshness across generated ideas and batches.
- **N1 Draft Batches A+B+C (300 candidate Pidgin/clean entries, INERT):** All 300 source entries imported into a SEPARATE `DRAFT_NIGERIAN_HOOK_PACK` (163 clean / 136 light_pidgin / 1 pidgin combined; activation-eligible after promotion: 137). Cannot activate by construction: (1) drafts live in their own constant — `NIGERIAN_HOOK_PACK` remains `Object.freeze([])`; (2) every `reviewedBy` is the literal `PENDING_NATIVE_REVIEW` sentinel; (3) `getEligibleNigerianPackEntries` does a runtime reference check and throws if the draft pool is passed via `as`; (4) the activation guard's `packLength > 0` only sees the live pack. Drafts skip the production assert's mocking regex and anchor-in-text check (the production regex `\b(abe+g+|waha+la+)\b` false-positives on authentic Pidgin words "abeg" / "wahala" — must be tightened to require ≥3 vowel repeats in the SAME PR that promotes the first real entry, otherwise `assertNigerianPackIntegrity` will trip on natural Pidgin). The production `assertNigerianPackIntegrity` was STRENGTHENED in this phase to explicitly reject `reviewedBy === "PENDING_NATIVE_REVIEW"` (with whitespace tolerance) — closes the fake-review gap so a draft entry can never be promoted into the live pack with the sentinel intact. Tier-clean entries (50/100) cannot be promoted as-is — production type forbids `pidginLevel: "clean"`; reviewer must reclassify or route them through the clean-Nigerian baseline path.
- **N1 Nigerian Comedy Pack (DARK INFRASTRUCTURE):** Pack ships EMPTY behind the `LUMINA_NG_PACK_ENABLED` env flag (default off). Activation requires ALL FOUR conditions via `canActivateNigerianPack`: `region === "nigeria"`, `languageStyle ∈ {"light_pidgin","pidgin"}`, flag on, `packLength > 0`. Cross-region leak is impossible by construction (non-nigeria short-circuits). Nigeria-clean and `null` languageStyle are byte-identical to pre-N1. The recipe-render path in `coreCandidateGenerator` is intentionally NOT wired in N1 — keeps byte-identity proof trivial. Pack entries are atomic (hook + whatToShow + howToFilm + caption + anchor + domain + pidginLevel + reviewedBy); the agent CANNOT author entries — `reviewedBy` (initials + date of a Nigerian native speaker) is a hard boot precondition. Mocking-spelling regex catches cartoonised vowel stretching, NEPA "light just took" cliché, yahoo/419 tropes, etc. Additive `languageStyle`/`slangIntensity` fields on `tasteCalibrationSchema` default to `null`/`0` so pre-N1 docs round-trip byte-identically.
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
- **N1 Pack Activation:** Never relax `canActivateNigerianPack` — all four AND-conditions are the cross-region leak guard. Never author Pidgin entries inside the pack — `reviewedBy` must be a real Nigerian native speaker stamp; the boot assert will refuse blank ones. The pre-existing typecheck errors in `retentionNoveltyScorer.test.ts` and `z57RetentionQa.test.ts` (`rewriteAttempted` / `"guilt"`) are unrelated to N1 and pre-date this phase.

## Pointers

- **Replit AI Integrations:** [https://docs.replit.com/ai/](https://docs.replit.com/ai/)
- **Drizzle ORM Documentation:** [https://orm.drizzle.team/docs/overview](https://orm.drizzle.team/docs/overview)
- **Zod Documentation:** [https://zod.dev/](https://zod.dev/)
- **Expo Documentation:** [https://docs.expo.dev/](https://docs.expo.dev/)
- **Clerk Documentation:** [https://clerk.com/docs](https://clerk.com/docs)