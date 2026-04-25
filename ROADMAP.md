# Lumina — Roadmap (Phase 1 MVP)

> **Current scope:** Phase 1 MVP only. Day-1 markets: US (primary), UK, CA, AU, IN, PH, NG.
> Locked spec: [`attached_assets/Pasted-LUMINA-PHASE-1-MVP-FINAL-LOCKED-SPEC*`](attached_assets/).
>
> The earlier 90-day "nuclear roadmap" (Sprints 0–7 covering autonomous swarm, Smart Publisher, Compliance Shield, Earnings Engine, Referral Rocket, Stripe Connect payouts, 99.8 % clone) is **archived** — see [§ Archived 90-day roadmap](#archived-90-day-roadmap-v20-blueprint) at the bottom of this document. The next 30 days replace it with a much narrower loop.

---

## Phase 1 MVP — the entire roadmap on one screen

The whole product is one loop:

> **Onboarding → Style Profile → Daily Ideator → Templated creation → Side-by-side review → Export.**

We don't proceed past one milestone without the previous one working end-to-end on a real device.

| # | Milestone | What ships | What proves it |
|---|---|---|---|
| **M0** | **Freeze** — everything not in v1 is gated behind feature flags | Archived endpoints return 404; v1 endpoints return 200; legacy mobile screens removed from navigation | `ARCHIVED_AUTONOMY=true`, `ARCHIVED_MONETIZATION=true`, `ARCHIVED_POSTING=true` defaults verified. Public docs (this file, `README.md`, `ARCHITECTURE.md`, `replit.md`) match the locked spec. |
| **M1** | **Region trend bundles** | `packages/lumina-trends` with 4 region JSONs (western · india · philippines · nigeria), each ≥ 25 hooks + 15 caption templates + 10 formats with `popularityScore` + `recencyScore`. Typed loader + `topByScore()`. | Loadable via `import { loadTrendBundle } from '@workspace/lumina-trends'`. Bundles refresh manually every few days. |
| **M2** | **Ideator endpoint** (testable independently) | `POST /api/ideator/generate` with hard constraints baked into the prompt: hook ≤ 3 s · shoot ≤ 30 min. Daily quota: 2 batches / UTC day. Per-creator $ cap. | Quality gate: 20+ ideas per region, hook ≤ 3 s and shoot ≤ 30 min on **100 %** of generated ideas, region authenticity ≥ 95 % of non-default regions. |
| **M3** | **Style Profile persistence** | `GET/POST /api/style-profile` + `creators.style_profile_json` + `creators.region` columns (migration #12, additive). Zod-validated, all-optional defaults so the Ideator works pre-onboarding. | Round-trip a profile through the API; subsequent ideator calls reflect the change. |
| **M4** | **Onboarding quick-win flow** | Mobile `RegionPicker` → 3-video gallery import → rule-based extraction → instant 1-idea quick win after the **first** upload (no waiting for the full profile). Branded as "your first idea — already in your voice." | A new creator gets to a usable idea in < 60 s from app open. |
| **M5** | **Templated creation flow** | Pick idea → 2–3 filming tips → record on native camera → import → deterministic template (A/B/C/D from `templateHint`) → auto-captions matching the Style Profile → bundled regional audio with fixed sync points. | < 90 s post-production on device. No dynamic AI cutting. |
| **M6** | **Side-by-side review + export** | Past Lumina-imported video on the left; Lumina version on the right; plain-English diff that references **specific** differences from the user's past content; one-tap export to gallery; optional "Made with Lumina" watermark; "make another version" reuses the same idea with hook variation or template swap. | Diff text quotes specific hook/caption/pacing differences (not generic copy). |
| **M7** | **Physical `/archive` move** | All frozen code physically relocated to `/archive/<package-or-route>/`. Imports rewritten or removed. The active tree contains only Phase 1 surfaces. | `pnpm build` green with zero references into archived code from active code. |
| **M8** | **v1 success-metric dashboard (internal)** | Read-only ops view: % of selected ideas that were Lumina-generated; exports per creator over rolling 7 days. | Numbers computable from `videos` + a small `idea_selection_events` table (M2/M5 will already write the events). |

---

## Hard constraints baked into every milestone

These are **non-negotiable** — every idea, every screen, every milestone respects them:

1. **Understandable in < 3 seconds.** Hook ≤ 3 s, ≤ 8 words. Enforced in the Ideator's prompt and clamped on output.
2. **Shootable in < 30 minutes.** Single location, props the creator already owns, no actors beyond the creator + (optionally) one friend, no expensive setups. Enforced in the Ideator's prompt and clamped on output.
3. **Region-authentic.** Code-switch to the region's natural slang where appropriate (Hinglish for IN, Tagalog for PH, Pidgin for NG) — but keep the hook itself parseable to a wider English-speaking audience.
4. **No autonomy.** No background jobs, no nightly swarms, no auto-publish.
5. **No monetization.** No subscriptions, no Stripe Connect, no payouts, no brand deals, no performance fees, no Lumina Pro.
6. **One AI surface.** Ideator only. Captions, templates, diffs, and review are all rule-based / template-based.

---

## Quality gates (run before declaring a milestone complete)

| Gate | Where it lives | Threshold |
|---|---|---|
| **Hard constraint compliance** | scripted curl + JSON validator | 100 % of generated ideas obey hook ≤ 3 s and shoot ≤ 30 min |
| **Region authenticity** | scripted marker check (Hinglish / Tagalog / Pidgin tokens) | ≥ 95 % of ideas in IN/PH/NG hit at least one regional marker |
| **Cost discipline** | `lib/aiCost.ts` ledger | Per-creator daily $ cap (`$5` default) never exceeded; hard-throw on cap |
| **Quota discipline** | `lib/quota.ts` `usage_counters` | ≤ 2 idea batches per creator per UTC day |
| **Privacy** | route audit | Ideator request body never contains raw footage; only profile + region cross the wire |
| **Onboarding speed** | manual stopwatch on a real device | New creator → first usable idea in < 60 s |
| **Post-production speed** | manual stopwatch on a real device | Pick-to-export in < 90 s |

---

## Day-1 markets

US (primary focus), UK, CA, AU, India, Philippines, Nigeria. The four region bundles cover these by design:

| Bundle | Markets covered |
|---|---|
| `western` | US · UK · CA · AU |
| `india` | India |
| `philippines` | Philippines |
| `nigeria` | Nigeria |

A creator picks one region in onboarding; they can change it in Settings.

---

## Out of scope for Phase 1 (deliberate)

These are listed so we don't drift back into them mid-build:

- Vector DBs or heavy on-device ML for style extraction
- Dynamic / smart AI cutting (only the four fixed templates)
- Real-time trend scraping
- In-app camera UI
- Numeric performance projections
- Engagement / earnings / metrics dashboards (a *creator-facing* one)
- Anything autonomous
- Anything monetization-related
- One-tap multi-platform publishing
- A/B test variants of hooks, captions, or thumbnails
- Compliance Shield as a v1 feature
- The 99.8 % Style Twin clone

---

## Phase 2 (post-validation, not started)

These are *candidates* once the loop is validated; none are committed:

- Stack rewrite to Flutter + ExecuTorch / LiteRT + FFmpeg-kit for the on-device parts
- Progressively richer Style Profile fields (motion signature, timbre, palette) as on-device inference becomes practical
- A more dynamic trend pipeline (cron-pulled instead of manually-refreshed JSON)
- Optional one-tap export to a single platform (probably TikTok first)

Anything from the archived v2.0 blueprint (Compliance Shield, Smart Publisher, Earnings Engine, etc.) is candidate-only and gated on validated demand from the Phase 1 loop.

---

## Archived 90-day roadmap (v2.0 blueprint)

The earlier 90-day "nuclear roadmap" planned six 2-week sprints around the autonomous-swarm + monetization vision. **It is not the current scope.** All of it is preserved in git history; the corresponding code lives behind feature flags and will physically move to `/archive` at milestone **M7** above.

Summary of the archived sprints (for historical context only):

| Sprint | Theme | Status when archived |
|---|---|---|
| **Sprint 0** | Vision lock + repo foundations | Done |
| **Sprint 1** | Personal Style Twin MVP — 99.8 % voice/aesthetic clone, encrypted on-device storage, similarity gates | Phase 1 (mock pipeline) shipped; Phase 2 (real on-device inference via ExecuTorch) gated on EAS dev build, never built. **Now superseded by the lightweight rule-based Style Profile in v1.** |
| **Sprint 2** | Swarm Studio — Ideator + Director + Editor + Monetizer collaborating via a memory graph; chat-bubble Studio UI; voice-gate publish enforcement | Mock orchestrator + 4 agents shipped against fixture twins. **Frozen.** |
| **Sprint 3** | Smart Publisher + Compliance Shield — 6 policy packs, 21 rules, 368-sample red-team corpus (zero false negatives), 12-variant A/B, lossless smart watermark, mock platform clients | Shipped end-to-end against mock platform clients. **Frozen.** |
| **Sprint 4** | Earnings Engine + Referral Rocket — 10 % performance fee on incremental, hash-chained ledger, escrow with regional rails (Pix · GCash · OVO · SPEI · PromptPay · Wise), `LocalWallet`, dual $25 bounty | Closed-loop monetization simulator shipped. **Frozen.** |
| **Sprint 5** | Real OAuth + real platform posting (TikTok / IG Reels / YT Shorts) + EAS dev build | Real OAuth providers + posting clients shipped (`packages/swarm-studio/src/platforms/*`); persistence in `publications` table; mobile bridge in `app/studio/[id].tsx` + `app/publisher.tsx`. **Frozen.** |
| **Sprint 6** | Compliance + scheduler + platform-metrics fetch | Consent surface + nightly scheduler + per-publication metrics shipped. **Consent surface kept in v1; rest frozen.** |
| **Sprint 7** | Production hardening + Stripe billing + Stripe Connect payouts | Job queue, AI cost ledger, idempotent swarm steps, ops endpoints, webhooks, Stripe billing + Connect onboarding. **Job queue + AI cost ledger + ops + webhook plumbing kept in v1; Stripe-specific endpoints frozen and closed-by-default.** |

The full historical roadmap is recoverable from git: `git log --follow ROADMAP.md`.
