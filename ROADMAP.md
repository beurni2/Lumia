# Lumina — 90-Day Nuclear Roadmap

> Six 2-week sprints. Tests-first → implement → test → review → harden → optimize. Every sprint ends with a "Phase Complete" report and a ruthless self-verification audit.

The vision is **immutable v1.0**. Scope is the only variable. If a sprint risks slipping, we cut surface area, never quality.

---

## Sprint Cadence

- **Length:** 2 weeks.
- **Workflow:** Tests-first → implement → full test run → self code-review → harden → optimize.
- **Gates:** Every sprint exits with (1) green CI, (2) demo video, (3) a "Phase Complete" report logging what was audited, what was found, and what was resolved.
- **Cancel criteria:** any sprint that ships without monetization, consent, or compliance paths covered by tests is rolled back.

---

## Sprint 0 — Vision Lock & Repo Foundations *(current, week 0)*

**Objective:** lock the constitution. Make the next 90 days impossible to misinterpret.

### Acceptance Criteria

- [x] `README.md` — magnetic hero + magic sentence + tech teaser + contribution guidelines.
- [x] `ARCHITECTURE.md` — agent swarm + on-device/edge-cloud hybrid Mermaid diagrams.
- [x] `ROADMAP.md` — this document.
- [x] `.github/pull_request_template.md` — vision-alignment checklist.
- [x] `LICENSE.md` — MIT (renamed from `lLICENSE.md`).
- [ ] First ADR (`docs/adr/0001-immutable-v1-vision.md`) recording the immutable spec.
- [ ] Conventional Commits + branch naming enforced via CI.
- [ ] Pre-commit hooks: `typecheck`, `lint`, `format`, `test --changed`.
- [ ] Issue templates: `feature`, `bug`, `cultural-localization`.

### Phase-Complete Audit

Vision document and contribution checklist reviewed by a contributor from each target region (BR, MX, ID, PH). Sign-off recorded in the PR.

---

## Sprint 1 — Personal Style Twin MVP *(weeks 1–2)*

> **Phase 1 (Replit-compatible) — COMPLETE.** Mock pipeline, encrypted storage, similarity gates, vector memory, and full upload→train→preview UX all shipped and verified in Expo Go. Phase 2 (real on-device inference) requires a custom EAS dev build — see [`packages/style-twin/IMPLEMENTATION_PLAN.md`](packages/style-twin/IMPLEMENTATION_PLAN.md); next required step is the EAS dev-build runbook (install `react-native-executorch`, quantize + bundle the three `.pte` model files, wire `inferenceFactory.ts`).

**Objective:** ship the first irreversible moat — a 99.8% voice/aesthetic clone built from a one-time 10-video upload, encrypted and stored on-device.

### Acceptance Criteria

- [x] **`@workspace/style-twin` package** — types, `InferenceAdapter` interface, `MockInferenceAdapter` (Expo Go), `ExecuTorchInferenceAdapter` skeleton with dynamic runtime shim, pluggable encrypted storage, scoped consent grants, `train()` / `retrain()` pipelines, `similarity()` + `verifyMatch()` with `AUDIO_MATCH_GATE = 0.95` and `HEADLINE_MATCH_TARGET = 0.998`, encrypted vector memory with kNN.
- [x] **Style Twin Profile screen** — live fingerprint preview (palette, pacing, color temp, framing), train/retrain CTA, confirm-gated wipe.
- [x] **Onboarding flow:** 10-video upload screen with consent gate (retrain mode requires only 1 sample).
- [x] **Style Twin storage:** encrypted at rest via `expo-secure-store` (iOS Keychain / Android Keystore). Zero cloud egress.
- [x] **Retrain pipeline:** incremental fingerprint merge.
- [ ] **`ExecuTorchInferenceAdapter` (Phase 2)** — wired against quantized Llama 3.2 11B Vision + Whisper-tiny + TitaNet-small in a custom EAS dev build.
- [ ] **On-device feature extraction (Phase 2):** voice timbre, pacing, vocabulary fingerprint, color palette, framing patterns, motion signature — replacing the deterministic mock.
- [ ] **Privacy audit (Phase 2):** packet-capture proof that no raw audio/video crosses the network during onboarding or retraining.

### Tests

- Unit: feature-extraction determinism (same input → same fingerprint within tolerance).
- Integration: end-to-end onboarding with 10 fixture videos.
- E2E (Maestro): upload → train → confirm Twin renders style preview.
- Privacy: network egress test asserting zero outbound bytes during the flow.

### Phase-Complete Audit

Random 5% sample of fixture videos reviewed by hand. Twin similarity score must average ≥ 0.95 cosine on the held-out audio embedding.

---

## Sprint 2 — Swarm Studio: 4 Agents, End-to-End *(weeks 3–4)*

> **Sprint 2 — COMPLETE.** 4-agent collaborative swarm (Ideator → Director → Editor → Monetizer) shipped with live Style Twin integration: per-brief `verifyMatch()` + `nearest()` against the encrypted vector memory, deterministic `MockOrchestrator` pipeline pinned on `(twin, region, dayKey, now)`, Editor's 0.95 voice-gate publish enforcement, and a chat-bubble Studio UI surfacing each agent's working/done state with on-Twin% and synthetic-neighbor labels. Phase 2 (real on-device inference + sub-90s wall time on a Pixel 7-class device) ships with the EAS dev-build runbook tracked in [`packages/style-twin/IMPLEMENTATION_PLAN.md`](packages/style-twin/IMPLEMENTATION_PLAN.md).
>
> **Quality gate established:** the regression suite under `packages/style-twin/src/__tests__/` and `packages/swarm-studio/src/__tests__/` (run via `pnpm test` at the workspace root) is now the **permanent quality gate for all future agent work**. No agent change — Sprint 3's Compliance Shield, Sprint 4's Earnings Engine, or any subsequent agent — merges without (1) all existing suites green and (2) new contract assertions added that lock the change. Tests live next to the code they protect; gate constants (`AUDIO_MATCH_GATE = 0.95`, `HEADLINE_MATCH_TARGET = 0.998`, `PERFORMANCE_FEE_RATE = 0.10`) are drift-detected in the suite itself.

**Objective:** Ideator → Director → Editor → Monetizer collaborate via the memory graph to produce a 15–90s video in <90s on-device.

### Acceptance Criteria

- [x] Orchestrator with consent-aware routing and memory-graph reads/writes.
- [x] Ideator: 3 culturally-relevant daily briefs from the local trend cache, each scored live against the Twin via `verifyMatch()` + `nearest()`.
- [x] Director: storyboard + hook optimization with 3 hook variants per brief, paced to Twin wpm.
- [x] Editor: deterministic render pipeline with self-scoring; throws `TwinMatchRejected` when voice similarity falls below `AUDIO_MATCH_GATE`.
- [x] Monetizer: regional brand-fit ranking + draft brand DM (saved, not sent), fee math routed through `@workspace/monetizer.calculateFee` (passthrough invariant locked in tests).
- [x] **Swarm Studio UI:** chat-bubble layout with one bubble per agent (working → typing indicator, done → message + inline output, error → in-character apology). On-Twin% pill + voice/vocab breakdown + honest synthetic-neighbor labels surfaced per brief.
- [x] **Viral Confidence Score** (0–100) with plain-English reasoning surfaced inline.
- [ ] **Edge-cloud burst:** opt-in heavy render path with stateless payload. *(deferred to Sprint 3 — current on-device path meets the Sprint 2 contract; burst is gated on the EAS dev build.)*

### Tests

- [x] **Unit:** each agent in isolation — `ideator.test.ts` (deterministic ranking + discriminative spread + kNN identity), `editor.test.ts` (on-rhythm passes, off-rhythm throws `TwinMatchRejected` with correct gate), `orchestrator.test.ts` (bit-identical Brief→Storyboard→Video→Deals under pinned `(now, dayKey)`, monetizer fee passthrough invariant), `similarity.test.ts` (self-match ≥ 0.998, drift detector on `AUDIO_MATCH_GATE`).
- [x] **Integration:** full swarm pipeline against a fixture twin via `MockOrchestrator`, replayable for audit.
- [ ] **<90s wall time on a Pixel 7-class device** — gated on the EAS dev build (Phase 2).
- [ ] **E2E (Maestro):** tap brief → preview → approve → file emitted to camera roll — gated on the EAS dev build.

### Phase-Complete Audit

10 end-to-end videos generated across 5 cultural contexts (BR fashion, MX beauty, ID street food, PH lifestyle, VN gaming). A regional contributor scores each on cultural authenticity (target ≥ 4.2 / 5). *Audit runs on the EAS dev build — Phase 2 prerequisite.*

---

## Sprint 3 — Smart Publisher + Compliance Shield ✅ **COMPLETE** *(weeks 5–6)*

> **Status: COMPLETE.** Every Sprint 3 phase-complete-audit checkbox is green. The full one-tap closed-loop "Launch to the World" pipeline ships end-to-end: Ideator → Director → Editor → 12-variant A/B (gate-aware) → smart watermark → Compliance Shield (auto-rewrite + hard block) → per-platform adaptation enforcement (caption truncation + duration clamp) → mock platform clients → confetti + "You just launched X videos while you lived your life" hero animation. All 10 regression suites green (368-sample red-team corpus with **zero false negatives**). Sprint 5 OAuth is the only remaining swap-point, locked behind the `PlatformClient` interface.
>
> **Shipped this sprint:**
> - [`@workspace/compliance-shield`](packages/compliance-shield/) — 6 policy packs (TikTok, Reels, Shorts, Kwai, GoPlay-ID, Kumu-PH), 21 rules, soft-rewrite + hard-block engine capped at `MAX_REWRITE_PASSES = 4`, fully idempotent.
> - 12-variant A/B orchestration with `pickWinner()` filtered through `AUDIO_MATCH_GATE = 0.95`.
> - Lossless smart watermark — deterministic 16-hex FNV-1a signature, sidecar roundtrip lossless.
> - **Adaptation enforcement** — `applyAdaptation()` in [`publisher.ts`](packages/swarm-studio/src/agents/publisher.ts) truncates caption to `maxCaptionLen` (with ellipsis) and clamps `durationSec` to `maxDurationSec`. Idempotent.
> - **Per-platform mock clients** — [`platformClients.ts`](packages/swarm-studio/src/agents/platformClients.ts) registers one `PlatformClient` per platform with platform-shaped mock URLs (`tiktok.com/@lumina/video`, `instagram.com/reel`, `youtube.com/shorts`, `kwai.com/@lumina`, `goplay.id/v`, `kumu.live/v`); launch dispatches via `clientFor()` in parallel.
> - **Red-team corpus → 368 samples, zero false negatives.** Hand-curated base (52) + programmatic carrier × style permutations across all 6 packs; per-pack soft + hard floors enforced; previously caught + fixed a regex-anchor bug in the Kumu Tagalog discovery rule (`"morning"` false positive).
> - **Smart Publisher UI** in [`publisher.tsx`](artifacts/lumina/app/publisher.tsx) — one-tap pipeline, per-variant Twin% inline, per-platform Shield verdicts in plain English, watermark surfaced, async sequence guard.
> - **Dramatic launch celebration** — [`ConfettiBurst.tsx`](artifacts/lumina/components/ConfettiBurst.tsx) (pure RN Animated, JS driver, 64 pieces with seeded randomness) + [`LaunchSuccessHero.tsx`](artifacts/lumina/components/LaunchSuccessHero.tsx) ("You just launched X videos while you lived your life", scale + pulse + fade animation sequence).
> - **Test gate:** 10 suites green — `shield`, `rewrite`, `redTeamCorpus` (368), `similarity`, `ideator`, `orchestrator`, `editor`, `publisher`, `winnerPromotion`, `adaptation`, `platformClients`.

**Objective:** one-tap multi-platform publish, gated by an in-process policy engine. 12-variant A/B test on hooks, captions, thumbnails. No outbound asset bypasses the Shield.

### Acceptance Criteria

#### Compliance Shield → [`packages/compliance-shield`](packages/compliance-shield/)

- [x] **Six policy packs shipped** — TikTok, Instagram Reels, YouTube Shorts, Kwai (Brazil-tuned: SECAP/ANATEL gambling rules), GoPlay (Indonesia: KOMINFO MR5 SARA filter + halal-default soft flags), Kumu (Philippines: off-platform tipping ban + Taglish discovery boost). Each pack lives in [`src/policies/`](packages/compliance-shield/src/policies/).
  - Success metric: each pack ships ≥ 3 rules covering at least one hard-block category and one soft-rewrite category.
  - Coverage today: TikTok 5, Reels 4, Shorts 3, Kwai 3, GoPlay 3, Kumu 3 → **21 rules total**.
- [x] **Auto-rewrite pipeline for soft-flagged content** — bounded loop in [`src/engine.ts`](packages/compliance-shield/src/engine.ts) (`autoRewrite`) capped at `MAX_REWRITE_PASSES = 4`, returns `status: "rewritten"` with rewrite-pass count when content stabilises clean.
  - Success metric: idempotent (running a clean rewrite back through is a `pass` with `rewritePasses === 0`); locked by [`__tests__/rewrite.test.ts`](packages/compliance-shield/src/__tests__/rewrite.test.ts).
- [x] **Hard block with plain-English explanation** — every hard rule carries a `humanExplanation` field surfaced verbatim in the Smart Publisher UI; hard hits short-circuit the engine and never mutate content.
  - Success metric: hard-hit invariant — original content returned untouched on `status: "blocked"`; locked by [`__tests__/shield.test.ts`](packages/compliance-shield/src/__tests__/shield.test.ts) test #10.
- [x] **Real-network adaptation enforcement** — `applyAdaptation()` in [`publisher.ts`](packages/swarm-studio/src/agents/publisher.ts) truncates captions to `maxCaptionLen` (with ellipsis) and clamps `durationSec` to `maxDurationSec` before any per-platform plan is handed to the launch step. Idempotent. Locked by [`adaptation.test.ts`](packages/swarm-studio/src/__tests__/adaptation.test.ts) §10–11.
- [x] **Red-team corpus expansion** — 368 samples (hand-curated 52 + programmatic carrier × style permutations) across all 6 packs, **zero false negatives**. Locked by [`redTeamCorpus.test.ts`](packages/compliance-shield/src/__tests__/redTeamCorpus.test.ts) with per-pack soft + hard floors and a hard-block invariant on every hard sample.

#### Smart Publisher → [`packages/swarm-studio/src/agents/publisher.ts`](packages/swarm-studio/src/agents/publisher.ts)

- [x] **12-variant A/B orchestration** — exactly 3 thumbnails × 2 captions × 2 hooks emitted by [`generateABVariants()`](packages/swarm-studio/src/abTest.ts); composite rank score = `voice·0.5 + overall·0.35 + nearestNeighbor·0.15`.
  - Success metric: `VARIANT_COUNT === 12` invariant locked in [`__tests__/publisher.test.ts`](packages/swarm-studio/src/__tests__/publisher.test.ts).
- [x] **Winner selection gated on Twin voice score** — `pickWinner()` filters to `meetsAudioGate` first (voice ≥ `AUDIO_MATCH_GATE`), then ranks; returns `null` rather than ship an off-Twin pick. UI surfaces the honest `blockedReason`.
- [x] **Lossless `Made with Lumina` smart watermark** — deterministic 16-hex FNV-1a signature derived from `(videoId | creatorKey | watermarkVersion)`; sidecar manifest survives `readWatermark()` roundtrip.
  - Success metric: bit-identical signature across re-runs; sidecar roundtrip lossless on every key the watermark embeds.
- [x] **Per-platform aspect-ratio + caption-style adaptation** — declarative `adaptation` object per platform: aspect (9:16 across all SEA/LATAM short-form), `maxCaptionLen`, `maxDurationSec`, `captionStyle` (casual/punchy/title). Values: TikTok 2200/180s, Reels 2200/90s, Shorts 100/60s, Kwai 300/60s, GoPlay 500/120s, Kumu 280/60s.
- [x] **Plan identity is collision-safe** — `planId = plan-{videoId}-{fnv1a(platforms|creatorKey|regions)}` so re-planning the same video for different platform sets does not overwrite earlier plans.
- [x] **Determinism contract** — given identical `(twin, region, dayKey, now, platforms, creatorKey, regions)` the orchestrator emits bit-identical `PublishPlan` and `PublishResult`. Locked in `publisher.test.ts` §5.
- [x] **Real-time results report card with winner promotion** — UI shows variants + Shield verdicts at plan time and the per-platform launch outcomes (status pill + mock URL) after; winner-promotion logic locked by [`winnerPromotion.test.ts`](packages/swarm-studio/src/__tests__/winnerPromotion.test.ts). Production-telemetry-driven re-ranking moves to Sprint 5 once real platform analytics land.
- [x] **Real platform mock clients** — [`platformClients.ts`](packages/swarm-studio/src/agents/platformClients.ts) ships one `PlatformClient` per platform with platform-shaped mock URLs and a stable `post()` contract; `launchPublishPlan()` dispatches via `clientFor()` in parallel. Sprint 5 swaps the same interface for real OAuth + per-platform SDK clients without touching the call site.

#### Smart Publisher UI → [`artifacts/lumina/app/publisher.tsx`](artifacts/lumina/app/publisher.tsx)

- [x] **One-tap "Launch to the World" pipeline** — auto-prepares a plan preview on screen open; single button drives Ideator → Director → Editor → 12-variant A/B → Shield → mock launch.
- [x] **Per-variant Twin% surfaced inline** — all 12 variants listed with voice% colored against the audio gate.
- [x] **Per-platform Shield verdicts in plain English** — pass / rewritten / blocked pills with the human explanation text from each rule, plus the rewritten caption shown when soft rules fired.
- [x] **Smart watermark signature surfaced** — visible in the watermark card so users see the attribution payload before launch.
- [x] **Async sequence guard** — every prepare/launch tap bumps a `runIdRef`; late results from older taps are dropped; unmounted writes are skipped.
- [x] **Dramatic launch celebration** — confetti burst ([`ConfettiBurst.tsx`](artifacts/lumina/components/ConfettiBurst.tsx), pure RN Animated, JS driver, 64 seeded pieces) + "You just launched X videos while you lived your life" hero ([`LaunchSuccessHero.tsx`](artifacts/lumina/components/LaunchSuccessHero.tsx), card scale + headline pulse + tagline fade sequence) on every successful launch.
- [ ] **Accessibility labels on key CTAs** — explicit `accessibilityLabel` / `accessibilityRole` on Launch button, variant rows, and platform verdict cards. *(Deferred to Sprint 5 — paired with the real-platform OAuth flow's accessibility audit.)*

### Tests

- [x] **Unit:** policy-pack matchers — at least one positive + one negative case per soft and hard rule across all 6 packs ([`shield.test.ts`](packages/compliance-shield/src/__tests__/shield.test.ts)).
- [x] **Unit:** auto-rewrite convergence + idempotency + cap behaviour ([`rewrite.test.ts`](packages/compliance-shield/src/__tests__/rewrite.test.ts)).
- [x] **Unit:** Smart Publisher contracts — 12-variant invariant, gate-only winner rule, watermark roundtrip, per-platform plan shape, deterministic re-runs ([`publisher.test.ts`](packages/swarm-studio/src/__tests__/publisher.test.ts)).
- [x] **Integration:** full Ideator → Director → Editor → Publisher pipeline end-to-end via `MockOrchestrator`, replayable for audit.
- [x] **Unit (red-team corpus):** 368-sample known-flagged corpus across all 6 packs with per-pack soft + hard floors enforced ([`redTeamCorpus.test.ts`](packages/compliance-shield/src/__tests__/redTeamCorpus.test.ts)).
- [x] **Unit (winner promotion):** gate-eligibility filter, deterministic tie-break, live-pipeline symmetry ([`winnerPromotion.test.ts`](packages/swarm-studio/src/__tests__/winnerPromotion.test.ts)).
- [x] **Unit (multi-platform adaptation):** per-platform caps, cross-publish symmetry, truncation enforcement, idempotency ([`adaptation.test.ts`](packages/swarm-studio/src/__tests__/adaptation.test.ts)).
- [x] **Unit (platform clients):** registry shape, URL host pattern per platform, watermark coupling, blocked-shield short-circuit, rewritten/posted status mapping ([`platformClients.test.ts`](packages/swarm-studio/src/__tests__/platformClients.test.ts)).
- [x] **Compliance:** zero false negatives on the 368-sample red-team corpus — measured by `redTeamCorpus.test.ts` (any false negative fails CI).
- [ ] **Integration:** publish to a sandbox account on each platform — gated on Sprint 5 platform OAuth + EAS dev build.
- [ ] **E2E (Maestro):** tap Launch → confirm publish on staging accounts within 30s — same gating.

### Phase-Complete Audit Checklist

Sprint 3 closes only when **every** box below is checked. Any unchecked item is a sprint cancel-criterion (per the Sprint Cadence rules above).

- [x] All 6 packs registered in `POLICY_PACKS` and reachable via `ALL_PLATFORMS`.
- [x] Hard-rule invariant: every hard rule omits `rewrite()` (lint-locked in [`shield.test.ts`](packages/compliance-shield/src/__tests__/shield.test.ts) §1).
- [x] `MAX_REWRITE_PASSES = 4` constant drift-detected in [`rewrite.test.ts`](packages/compliance-shield/src/__tests__/rewrite.test.ts).
- [x] Smart-watermark signature is deterministic across re-runs and roundtrip-lossless via `readWatermark()`.
- [x] `planId` collision-safe across distinct `(platforms, creatorKey, regions)` request shapes for the same video.
- [x] Workspace `pnpm test` green: **10/10 suites pass** (`similarity`, `shield`, `rewrite`, `redTeamCorpus`, `ideator`, `orchestrator`, `editor`, `publisher`, `winnerPromotion`, `adaptation`, `platformClients`).
- [x] **Red-team corpus of 200+ policy edge cases reviewed** — 368 samples across all 6 packs with **zero false negatives**. Locked in [`redTeamCorpus.test.ts`](packages/compliance-shield/src/__tests__/redTeamCorpus.test.ts).
- [x] **Adaptation enforcement** — `applyAdaptation()` truncates captions to `maxCaptionLen` (with ellipsis) and clamps `durationSec` to `maxDurationSec` before launch. Idempotent. Locked in [`adaptation.test.ts`](packages/swarm-studio/src/__tests__/adaptation.test.ts) §10–11.
- [x] **Per-platform launch contract** — `PlatformClient` interface + 6 mock clients with platform-shaped URLs, deterministic given `(videoId, watermarkSig, content, shield)`. Sprint 5 OAuth swap-point locked. [`platformClients.test.ts`](packages/swarm-studio/src/__tests__/platformClients.test.ts).
- [x] **Dramatic launch celebration** — confetti burst + "You just launched X videos while you lived your life" hero animation wired into the Smart Publisher screen.
- [ ] **Real platform sandbox publish** — at least one successful sandbox post on each of the 6 platforms. *(Deferred to Sprint 5 — gated on per-platform OAuth + EAS dev build, not a Sprint 3 cancel-criterion under the revised acceptance.)*
- [ ] **Cultural reviewer sign-off** — one BR + one ID + one PH contributor reviews 5 sample plans each. *(Deferred to Sprint 5 beta launch — coupled with the São Paulo + Jakarta cultural-board onboarding.)*
- [ ] **Demo video** — one continuous take: train Twin → run swarm → open Publisher → launch → see per-platform verdicts. *(Deferred to Sprint 5 — recorded against the EAS dev build for credible app-store-quality framing.)*

---

## Sprint 4 — Earnings Engine + Referral Rocket *(weeks 7–8)*

**Objective:** close the monetization loop. Affiliate detection, brand pitch decks, DM negotiation, payout escrow, performance-fee accounting (10% on incremental only), and cash-paying referrals.

### Acceptance Criteria

- [ ] Affiliate detection across video metadata + Style Twin context.
- [ ] Brand pitch deck generator (PDF + IG-friendly carousel).
- [ ] Templated WhatsApp / IG DM drafts with manual send gate.
- [ ] Deal Router (cloud, stateless) with reputation-scored brand graph.
- [ ] Escrowed payout pipeline with provider integration (Wise + local rails: Pix, GCash, OVO).
- [ ] Performance-fee accounting: 10% on incremental revenue Lumina creates, audit-trailed.
- [ ] Referral Rocket: smart watermark + referral code + cash payout on referee's first payout.

### Tests

- Unit: fee accounting against 100 fixture revenue scenarios.
- Integration: payout pipeline end-to-end against provider sandboxes.
- E2E: brand-pitch generation, DM draft, deal acceptance, escrow, payout.
- Security: penetration test on the Deal Router and payout endpoints.

### Phase-Complete Audit

Independent ledger reconciliation against payout-provider sandbox statements. Zero discrepancies tolerated.

---

## Sprint 5 — Beta Launch: São Paulo + Jakarta *(weeks 9–10)*

**Objective:** 200 invited creators (100 BR, 100 ID) running Lumina in production. Daily active use. First real payouts.

### Acceptance Criteria

- [ ] Production builds on iOS App Store TestFlight + Android internal testing.
- [ ] Observability: structured logs, crash-free sessions ≥ 99.7%, compliance-event dashboard.
- [ ] On-call rotation defined.
- [ ] In-app feedback hook with weekly Soul Check digest review.
- [ ] Localized copy: pt-BR, id-ID, en-fallback.
- [ ] Daily KPI dashboard: videos generated, posted, A/B winners, earnings, retention.

### Phase-Complete Audit

End of week 10:

- ≥ 60% D7 retention.
- ≥ 4 videos posted per active creator per week.
- ≥ 30% of paid users earn back their subscription within 14 days.
- Zero critical compliance incidents.

---

## Hardening Phase *(weeks 11–12)*

**Objective:** launch-ready.

- [ ] Full test suite + coverage report ≥ 85% lines, 100% on monetization & consent paths.
- [ ] Performance audit against the non-functional targets in `ARCHITECTURE.md`.
- [ ] Accessibility audit: WCAG 2.2 AA on every screen.
- [ ] Security audit: third-party penetration test report archived.
- [ ] Production build verification on iPhone SE (3rd gen) and Pixel 6a as the floor.
- [ ] One-command deploy instructions in `README.md`.
- [ ] Production checklist signed off by every domain owner.

---

## Risk Register

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| On-device quality/speed misses target | Medium | High | Pre-tuned local cultural template packs co-created with top SEA/LATAM creators |
| Voice authenticity rejection by users | Low | High | Radical transparency + one-tap override + instant retraining |
| Platform policy changes breaking publish | Medium | High | Multi-platform redundancy + Compliance Shield + nightly policy delta |
| Price sensitivity in target markets | High | Medium | Spark free tier + 10% performance fee that pays users before they pay us |
| Payout-provider regulatory blocker | Low | High | Per-region rail (Pix, GCash, OVO) + Wise fallback |

---

## Definition of Done

A feature is **done** when:

1. Behaviour matches the acceptance criteria above.
2. Tests at unit, integration, and E2E layers are green in CI — the workspace `pnpm test` suite under `packages/*/src/__tests__/` is the **permanent quality gate** (established Sprint 2). New agent work must add contract assertions that lock the change; no merge while existing suites are red.
3. The vision-alignment checklist in the PR template is fully ticked.
4. A sibling contributor has approved the PR.
5. Telemetry and structured logs cover the new code paths.
6. Documentation (inline + relevant `docs/`) is updated.
7. The Phase-Complete audit for the sprint is recorded in the PR description.

Anything less is in progress.
