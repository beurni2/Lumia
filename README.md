<div align="center">

# Lumina

### 3 daily ideas that feel like you + post-production that makes your videos consistently better than your last ones.

**Lumina is a creator tool that lifts daily consistency.** Import a few of your own videos, pick your region, and Lumina extracts a lightweight style profile from your past work. Each morning it serves 3 region-specific video ideas matched to your hooks, captions, and pacing — then walks you through a templated build that ends with a side-by-side comparison to a similar past video of yours.

[![License: MIT](https://img.shields.io/badge/License-MIT-c084fc.svg)](LICENSE.md)
[![Phase 1 MVP](https://img.shields.io/badge/scope-Phase%201%20MVP-ff8da1)](#phase-1-mvp-scope)
[![Built for English-first creators](https://img.shields.io/badge/built%20for-English--first-a855f7)](#who-its-for)

</div>

---

## Phase 1 MVP scope

This repo is currently scoped to **Phase 1 MVP only**. Earlier-built systems (autonomous swarm, monetization, Stripe billing/payouts, brand deals, OAuth posting, schedulers, admin dashboards, earnings projections) are present in the source tree but **frozen behind feature flags** — `ARCHIVED_AUTONOMY`, `ARCHIVED_MONETIZATION`, `ARCHIVED_POSTING` — and are not reachable from the running app or API. They will be moved into `/archive` once the v1 loop is proven.

The locked v1 loop, end-to-end:

1. **Onboarding** — pick a region, import 3+ short videos from gallery
2. **Style Profile** — rule-based extraction of hook style, caption style, pacing, topics, and content type → small JSON file
3. **Daily Ideator** — 3 region-conditioned ideas every morning (cloud LLM, conditioned by your local profile + a static regional trend bundle)
4. **Templated creation** — pick an idea, follow 2–3 filming tips, record on the native camera, import the clip; one of 4 fixed retention-optimized templates is auto-selected
5. **Side-by-side review** — left = a similar past video of yours; right = the Lumina version; below = plain-English "why this should perform better"
6. **One-tap export** to gallery with optional "Made with Lumina" watermark, plus a "make another version" button

**Day-1 markets** — US (primary focus), UK, Canada, Australia, India, Philippines, Nigeria.

**Core promise** — *3 daily ideas that feel like you + post-production that makes your videos consistently better than your last ones.*

## Who it's for

The English-speaking creator middle class — 1K–50K micro-creators in the US, UK, CA, AU, IN, PH, NG who post regularly but struggle with daily idea fatigue and post-production friction. The whole loop is designed so a creator's *next* video is reliably better than their last, with less thinking effort, in a region-authentic voice.

## What's in the v1 build

### Onboarding — minimal friction + instant value

- Region picker: **Western (US/UK/CA/AU) · India · Philippines · Nigeria** — changeable later in Settings
- 3-video gallery import (encourage adding up to 10 over time)
- Rule-based style extraction (no heavy ML):
  - **Hook detection** — first-sentence classification (question / bold statement / scene setter)
  - **Caption style** — emoji count, sentence length, punctuation patterns, tone
  - **Pacing** — approximate cuts-per-second via simple scene-change detection
  - **Topics & slang** — keyword frequency + recurring phrases (English + Hinglish/Tagalog/Nigerian Pidgin where relevant)
  - **Content type** — entertainment / educational / lifestyle / storytelling
- Stored as a lightweight JSON Style Profile
- **Quick-win**: after the first video uploads, immediately surface 1 instant idea + script (no waiting for the full profile)

### Daily Ideator — hybrid, quality-first, region-conditioned

- Single cloud LLM call for idea generation + freshness — **never sees raw footage**
- Conditioned 100% by the local Style Profile + the region's static trend bundle
- Trend bundles are static JSON shipped with the app (~50–100 hooks, ~50 captions, ~30 formats per region; updated manually every few days)
- Each trend item carries `popularity_score` (1–10) and `recency_score` (1–10); the ideator prioritizes higher combined score first
- Ideas cached locally for offline access
- One regenerate-batch per day if the initial 3 don't appeal

### Creation flow

- Pick one idea → see hook + script + shot plan + suggested caption
- 2–3 filming tips appear before recording (lighting, steadiness, shot list)
- Record with the native camera, import the clips
- Template-based editing (deterministic selection):
  - **A — Fast Hook** (question / bold statement): 0–2s hook overlay · 2–5s quick reveal · 5–12s main · 12–18s payoff
  - **B — Story Build** (narrative): 0–3s scenario hook · 3–10s build tension · 10–20s twist
  - **C — POV/Relatable** (personal/talking): 0–3s direct-to-camera hook · 3–12s story · 12–18s CTA
  - **D — Trend Jack** (trend-based): 0–1.5s trending audio sync · 1.5–6s visual match · 6–15s cultural twist
- Auto-captions match the user's profile (emoji count ±1, sentence length range, tone)
- Region-specific bundled audio packs with fixed sync points (no dynamic beat detection in v1)
- Target: **<90 s** post-production on device

### Review & export

- Side-by-side: a past video of yours (chosen by simple rule-based topic + duration + hook-type matching) vs. the Lumina version
- Plain-English diff: *"Stronger hook than your last outfit video — starts with a question instead of slow intro."* — must reference specific differences from the user's past content
- One-tap export to gallery + optional "Made with Lumina" watermark
- **Make another version** — reuse the same idea with a hook variation or different template

### Delight layer (lightweight only)

- Personal greeting using the Style Profile
- Confetti + "video ready" notification on export
- Morning recap: "3 new ideas waiting"

## Tech stack

```
Mobile      Expo (React Native) · TypeScript · Reanimated
API         Express 5 · TypeScript · Drizzle ORM · Replit Postgres
LLM         Cloud (single ideator endpoint) · Claude Haiku via Replit
            AI Integrations · $5/day per-creator cap
Extraction  Rule-based (regex + keyword frequency + simple scene-change
            detection) — no vector DB, no on-device model
Templates   4 fixed timing templates (no dynamic AI cutting)
Trends      Static JSON bundles per region (Western · IN · PH · NG)
Auth        Clerk (with demo-creator fallback so the first idea lands
            before sign-up)
Monorepo    pnpm workspaces · TypeScript project references · Orval codegen
```

The spec calls for an eventual move to **Flutter + ExecuTorch/LiteRT + FFmpeg-kit** for the on-device parts. That is a Phase 2 optimization once the loop is validated; the current build keeps Expo + Express to avoid a stack rewrite ahead of product proof.

## Explicitly NOT in v1

Listed for clarity since this is a deliberate scope contraction from earlier roadmaps:

- Vector DBs or heavy on-device ML for style extraction
- Dynamic / smart AI cutting (only the four fixed templates above)
- Real-time trend scraping (static JSON only)
- In-app camera UI (use the native camera)
- Numeric performance projections of any kind
- Engagement / earnings / metrics dashboards
- Anything autonomous (no nightly swarm, no auto-publish)
- Anything monetization-related (no subscriptions, no Connect, no payouts, no brand deals, no performance fees, no Lumina Pro tier)
- One-tap publish to TikTok / Reels / Shorts
- A/B test variants of hooks, captions, or thumbnails

## Quick start

```bash
pnpm install
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/lumina run dev
```

## Project layout

```
artifacts/
├── lumina/              # Expo mobile app — the product surface
├── api-server/          # Express API — ideator + style profile + trends + videos
│   └── src/lib/
│       ├── styleProfile.ts   # Phase 1: lightweight rule-based Style Profile schema
│       └── ideaGen.ts        # Phase 1: single Haiku call with hard constraints
└── mockup-sandbox/      # Canvas for UI exploration
packages/
├── lumina-trends/       # Phase 1: static regional trend bundles (western · IN · PH · NG)
├── api-spec/            # OpenAPI single source of truth
├── api-client-react/    # Generated React Query hooks (Orval)
├── api-zod/             # Generated Zod schemas (Orval)
├── style-twin/          # FROZEN — was the 99.8% on-device clone (v2.0 blueprint).
│                        #   v1 uses the rule-based Style Profile in api-server/src/lib instead.
├── swarm-studio/        # FROZEN — autonomous swarm + Smart Publisher + 12-variant A/B
├── monetizer/           # FROZEN — 10% perf fee + brand graph + escrow + payout rails
├── compliance-shield/   # FROZEN — 6 policy packs + 368-sample red-team corpus
└── edge-cloud/          # FROZEN — stateless burst-render client
```

All `FROZEN` packages stay in tree (gated by `ARCHIVED_AUTONOMY` / `ARCHIVED_MONETIZATION` / `ARCHIVED_POSTING` feature flags) until milestone **M7** in [`ROADMAP.md`](ROADMAP.md), at which point they physically relocate to `/archive`.

## Success metrics (v1)

- ≥ **60 %** of ideas users select are Lumina-generated
- ≥ **3 exports** per user in the first 7 days

## Documentation map

| Doc | What it's for |
|---|---|
| [`README.md`](README.md) | This document — magnetic intro + v1 scope |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Phase 1 MVP architecture (5 surfaces, 4 templates, Style Profile schema, trend bundles, tech stack) |
| [`ROADMAP.md`](ROADMAP.md) | Phase 1 MVP roadmap (M0 → M8) with hard-constraint quality gates |
| [`replit.md`](replit.md) | Workspace memory — what's where, env vars, conventions, archived systems |
| [`attached_assets/Pasted-LUMINA-PHASE-1-MVP-FINAL-LOCKED-SPEC*`](attached_assets/) | The locked spec |

The earlier v2.0 blueprint (autonomous swarm, Smart Publisher, Compliance Shield, Earnings Engine, Stripe Connect, 99.8% Style Twin clone) is preserved as historical context inside the Archived sections of `ARCHITECTURE.md`, `ROADMAP.md`, and `replit.md`.

## License

[MIT](LICENSE.md) © Lumina contributors.
