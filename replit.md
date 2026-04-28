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
- **Phase 1 Multi-clip Rule:** The import stage shows two slot cards ("Clip 1" + "Clip 2 (optional)"), each rendering its own helper line and two equal-weight pill buttons — Film and Upload — so the user picks the path per slot rather than the screen. Title/subtitle is "Add your clip" / "1–2 quick clips is enough." with a confidence line under Continue ("Don't overthink it — quick and messy works."). Filled slots keep both buttons (now labeled Refilm/Upload) for replacement, with no separate remove affordance and no editing tools. Fast entry via `?action=camera|picker` still auto-opens Slot 1 on mount.
- **Phase 1 Preview/export tone:** Stage 3 reads as "Ready to post?" (kicker "Step 3 of 3 · Preview") with a sub line confirming the video already has hook + clip + caption. The suggested-caption block carries a confidence sub ("Short, casual, and made to match the idea."). Primary CTA is "Export video" (routes to /review for the gallery save flow); secondary is an active "Make another version" outline button that resets clips and drops the user back at the import stage with the same idea. A small footer line ("Post it manually wherever you usually post.") sets the expectation that posting is manual. No "template", "rough cut", "mock", or "coming soon" language anywhere in the user-facing flow. After save on /review, the success block reads "Video ready" / "Save it, post it manually, or make another version." with three CTAs in order: Save to gallery (primary, re-runs save with cleared dedupe), Make another version, Back to ideas.
- **Film-screen UX (Tips stage):** Renders a "Why this works" block derived client-side from idea metadata. Both "I'm ready to film" and "Upload video instead" routes lead to the same unified Import stage.
- **Camera permission UX:** When camera access is denied, `captureVideo()` throws a typed `CameraPermissionDeniedError` that the create flow surfaces as a soft auto-dismissing notice ("Camera not allowed — you can upload a clip instead") rather than a sticky red error. The user is not blocked, not redirected to system settings, and not shown a modal — Slot 1 stays empty so a tap falls back to the gallery picker. A `globalThis.__qaDenyCamera` hook lets the e2e harness simulate denial on web.
- Four fixed timing templates are deterministically selected based on the Ideator's `templateHint`.
- One-tap export to the gallery with an optional "Made with Lumina" watermark.
- **Enhancement Brain (Phase 1):** A lazy "Make it hit harder" card on `/review` calls `POST /api/enhancements/suggest` (server module `lib/enhancementBrain.ts`) which reuses the same `deriveStyleHints` and `computeViralPatternMemory` helpers as the ideator. Returns ≤3 typed suggestions `{ id, type: caption|hook|start_hint|manual, text, applyValue? }`. The server-side sanitiser enforces 1 sentence each, ≤1 emoji, no editing-UI vocabulary (filters / lighting / transitions / colour grading / camera settings / editor names) on both `text` and `applyValue`, and downgrades caption/hook/start_hint with bad/missing values to `manual` so the UI never ships an Apply button that would do nothing. Bills via `lib/aiCost.ts` daily cap; does not consume the per-batch idea quota.
- **Semi-auto Suggestion Apply:** Each suggestion renders an Apply button (caption / hook / start_hint) or a passive "Try this" pill (manual). Apply mutates a screen-level `appliedEnhancements` state (caption / hook / startHint / appliedSuggestionIds[]); the BeforeAfter AFTER frame reads `appliedHookOverride ?? idea.hook` so the new hook surfaces instantly. Caption + start hint are surfaced inside the EnhancementCard ("Start around 0:01"). After apply: button flips to a sticky "Applied" pill, a quiet 2.4s "Nice — that's sharper." reassurance shows, and a fire-and-forget `applied_enhancement` ideator signal is emitted (server weight +1, weaker than `exported`) carrying `suggestionType` + the four pattern tags. A synchronous `useRef<Set>` guard prevents double-tap from double-firing the signal. No DB migration, no trimming, no editor UI.
- **Semi-auto Edit (stitch + trim):** A `MakeItReadyCard` ("Make it ready (optional)") sits below the EnhancementCard on `/review` and offers up to two preview-state edit actions: `stitch_clips` when `extraClips.length >= 1` and `trim_start` when a start hint or `idea.hookSeconds` lands at ≥ 0.5s (clamped to the spec's [0.5, 2] window). Each row is one short label + one Apply button; spec's hard "DO NOT" list (timeline editor, manual trim controls, filters, transitions, effects) is honoured — no other surface exists. Apply mutates a screen-level `appliedEdits` state and the BeforeAfter "After" frame reflects the change instantly: the extras chip flips from "+1 more clip" to "stitched · 2 clips → 1", and a "trimmed first 1.0s" chip joins it. Reuses the same 2.4s "Nice — that's sharper." reassurance + fire-and-forget `applied_enhancement` signal as the text-rewrite layer (suggestionType union extended end-to-end on client + server with `stitch_clips`/`trim_start`; same +1 weight). Same synchronous useRef-Set double-fire guard. **Important — intent only:** Lumina has no on-device video processing dependency, so the saved gallery file is the original bytes (same precedent as the `Made with Lumina` watermark badge — shown but not burned in). The visual confirmation in the After frame is what makes the change land. Future iteration wires real stitching/trimming when a processing module is added.
- **QA-mode onboarding bypass:** `useAppState` honors `globalThis.__qaSkipOnboarding === true` on mount in web QA mode (`EXPO_PUBLIC_WEB_QA_MODE=true`) and pre-sets `hasCompletedOnboarding=true` so e2e tests can deep-link to `/review` and other post-onboarding screens without walking the brittle region-picker → ideas-generation → calibration sequence. In-memory only, no persistence write, native builds skip the branch entirely. Mirrors the existing `globalThis.__qaDenyCamera` hook in `app/create.tsx`.

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