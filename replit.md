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
- The post-export flow extends Save & Post into a complete posting loop: a "Just save" secondary path (quieter "Saved ✓ / Post it later" copy with no auto-handoff); a "Save & Post" success block ("Saved ✓ / Ready to post / Takes ~10 seconds") that auto-opens a bottom-sheet platform picker (TikTok / Instagram / Snapchat / Copy only); an inline platform handoff card ("Almost there!" + 2-step guide + caption box + Copy caption / Copy & open {Platform} buttons); real deep links via `expo-linking` with web fallbacks (TikTok `snssdk1233://`, Instagram `instagram://library`, Snapchat `snapchat://`); clipboard writes via `expo-clipboard` on every platform tap; and a return-loop "Posted? / How did it go?" card that surfaces via `AppState`/`useFocusEffect` once the user comes back from a platform deep-link, replacing the two text buttons with Make another version / Back to ideas / View saved videos.
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
- **Hybrid Ideator Pipeline (Layers 1/2/4 shipped):** Cost-reduction pipeline routing requests through a deterministic local pattern engine first (`lib/patternIdeator.ts` — 6 templates × ~20 safe scenarios × 5 hook-style phrasings, fully memory-biased), filtering candidates through a 6-axis 0–10 scorer with one rewrite attempt (`lib/ideaScorer.ts`), and only falling back to Claude `generateIdeas` when fewer than 3 local candidates pass the gate. Daily per-creator cache on `creators.last_idea_batch_json` + `last_idea_batch_date` (migration #20) serves same-day repeat requests for free; demo creators bypass cache writes. The orchestrator (`lib/hybridIdeator.ts`) exposes `{ ideas, source: cache|pattern|fallback|mixed, usedFallback, counts }` and the `/api/ideator/generate` route shape is unchanged. Llama 3.1 fallback and Llama 3.2 Vision are deferred to follow-up sessions.
  - **Within-batch diversity (HARD):** `diversifiedSelect` is a four-pass picker (strict → structure-unique → fresh-axis → rescue) gated at score≥8, fed by a cartesian-diagonal weave so every 16-candidate pool covers all 5 hookStyles, all 6 structures, and ≥3 distinct families.
  - **Between-batch regenerate variation (HARD):** When `regenerate=true`, the orchestrator reads the previous cached batch (any date) and HARD-excludes its hooks (normalized) and `scenarioFamily`s before scoring; the pattern engine is salted with `((hashEntries(prev) ^ Date.now()) >>> 0) % 997` so each regenerate produces a structurally different (template, scenario, style) starting offset. Claude fallback (when triggered) is hook-excluded too. The cache JSON shape is now `[{idea, family, templateId}]` — backward-compatible reader still accepts legacy `Idea[]`. JSONB column means no migration needed for the shape extension.
  - **Novelty-aware selection (SOFT, BOOST + PENALTY):** The greedy selector replaces the four-pass `diversifiedSelect`. Each candidate carries `visualActionPattern` (11-value enum: `kitchen_contradiction`, `desk_avoidance`, `phone_scroll_freeze`, `bedroom_avoidance`, `outfit_check_cut`, `text_message_panic`, `face_reaction_deadpan`, `mirror_self_call_out`, `gym_no_show`, `car_avoidance`, `meal_prep_chaos`) and `topicLane` (5 values: `food_home`, `work_productivity`, `social_texting`, `body_fitness`, `daily_routine`) derived from `scenarioFamily` via `VISUAL_ACTION_BY_FAMILY` / `TOPIC_LANE_BY_FAMILY` lookup tables (`patternIdeator.ts`). `scoreNovelty` (`ideaScorer.ts`) awards 0–5 across 5 dims (hookStyle, scenario, structure, visualAction, topic) compared to the prior batch + the in-progress pick set, but ONLY when `qualityScore≥8` (no quality-rescue). `selectionPenalty` re-applies per-pick demerits with set-based saturation (-2 hookStyle, -3 family, -1 structure, -2 topic, -2 visualAction). The orchestrator uses `selectWithNovelty` (greedy by `quality + novelty + penalty`) with HARD batch guards (never 3× same hookStyle/format/structure, never >2 share family/visualAction/topic); `exhaustiveReselect` (capped at count≤5, top-`count*4` candidates) brute-forces a guard-passing combination if greedy fails. Claude fallback now triggers on EITHER `merged.length<3` OR guard failure; if guards still fail post-Claude, ships best-effort with `hybrid_ideator.guards_failed_shipping_best_effort` warn log. QA: 5 regens → 6/6 unique batches, 0 duplicate hooks, `usedFallback=false`, ≥2 distinct visual scenes + ≥2 distinct hookStyles per batch.
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