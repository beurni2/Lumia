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

## Sprint 3 — Smart Publisher + Compliance Shield *(weeks 5–6)*

**Objective:** one-tap multi-platform publish, gated by an in-process policy engine. 12-variant A/B test on hooks, captions, thumbnails. No outbound asset bypasses the Shield.

### Acceptance Criteria

- [ ] Compliance Shield with policy packs for TikTok, Reels, Shorts, Kwai, and 2 local SEA/LATAM apps.
- [ ] Auto-rewrite pipeline for soft-flagged content; hard block with explanation for severe.
- [ ] Multi-platform publisher with per-platform aspect-ratio and caption-style adaptation.
- [ ] 12-variant A/B test orchestration: thumbnails × captions × hooks.
- [ ] Real-time results report card with winner promotion.
- [ ] Smart watermark (`Made with Lumina`) embedded losslessly.

### Tests

- Unit: policy-pack matchers against a corpus of 200 known-flagged samples.
- Integration: publish to a sandbox account on each platform.
- E2E: tap Launch → confirm publish on staging accounts within 30s.
- Compliance: zero false negatives on the red-team corpus.

### Phase-Complete Audit

Red-team corpus of 50 policy edge cases reviewed. Any false negative = sprint not complete.

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
