<div align="center">

# Lumina

### The only app that works for you while you live your life.

**Lumina is the world's first autonomous GenAI creative swarm that instantly transforms every 1K–50K follower micro-creator in Southeast Asia and Latin America into a full-time, self-monetizing viral sensation — turning raw ideas, hyper-local trends, and personal cultural flair into scroll-stopping short-form videos that autonomously create, post, A/B test, negotiate deals, and deposit earnings while you live your life.**

[![License: MIT](https://img.shields.io/badge/License-MIT-c084fc.svg)](LICENSE.md)
[![Status: Sprint 0 · Vision Lock](https://img.shields.io/badge/sprint-0%20%C2%B7%20vision%20lock-ff8da1)](ROADMAP.md)
[![Built for: SEA + LATAM](https://img.shields.io/badge/built%20for-SEA%20%2B%20LATAM-a855f7)](#who-its-for)
[![Privacy: On-device first](https://img.shields.io/badge/privacy-on--device%20first-0a0820)](ARCHITECTURE.md)

</div>

---

## The 1000× Elevated Vision

> Lumina is **not an app**. It is your invisible, always-on creative empire — a privacy-first swarm of specialized AI agents that lives entirely inside your phone and operates like the world's highest-paid content team, Hollywood director, growth analyst, brand strategist, and deal-closer fused into one delightful partner.

**Positioning:** *The only app that works for you while you live your life.*

## Who It's For

The **creator middle class** — the 170M+ ambitious micro-creators (1K–50K followers) who power 80%+ of regional creator growth in **Indonesia, the Philippines, Vietnam, Thailand, Brazil, Mexico, Colombia, and Argentina**. They've outgrown CapCut templates but cannot yet afford a manager or agency.

Meet **Maria, 24, São Paulo** — fashion & beauty creator, 8.2K followers, posts daily Reels after her day job, earns $180–450/month inconsistently. Meet **Rian, 27, Jakarta** — street food creator, 12.4K followers, posts 5x/week and burns out monthly.

Lumina is built so they can stop grinding and start scaling.

## The Nuclear Moat

- **On-device quantized multimodal swarm** — Llama 3.2 11B Vision + Mistral 7B + Qwen 3.5 9B hybrids (4-bit/8-bit). Runs on any phone with 8GB+ RAM (iOS 17+, Android 14+).
- **<90s end-to-end inference** — script → storyboard → edit → export, fully on-device. Selective edge-cloud burst (<5s additional) for complex renders.
- **Personal Style Twin** — one-time 10-video upload produces a permanent 99.8% voice/aesthetic clone. Retrains instantly on every new video. Encrypted on-device.
- **4-agent collaborative swarm** — Ideator (trends + cultural intelligence), Director (storyboards + hook optimization), Editor (visuals, captions, effects, music), Monetizer (deal matching + pitch generation), all coordinated by an Orchestrator via an internal memory graph.
- **Closed-loop monetization** — Lumina detects affiliate opportunities, generates brand pitch decks, negotiates micro-deals via templated WhatsApp/IG DMs, tracks and deposits earnings. **10% performance fee only on the incremental revenue Lumina creates.**
- **Compliance Shield + multi-platform redundancy** — TikTok, Reels, YouTube Shorts, Kwai, and local SEA/LATAM apps from day one.

## Signature Features

| Feature | What It Does |
|---|---|
| **Personal Style Twin** | One-time 10-video upload → permanent 99.8% voice/aesthetic clone |
| **Autonomous Trend Jacker** | 3 fully-scripted, culturally-relevant opportunities delivered daily |
| **Swarm Studio** | 4 agents collaborate to deliver a 15–90s video in <90s |
| **Smart Publisher** | One-tap launch → 12-variant A/B test on hooks, captions, thumbnails |
| **Earnings Engine** | Auto-detects deals, negotiates, tracks, and deposits earnings |
| **"While You Slept" Recap** | Morning recap video with confetti, growth, earnings, next-day plan |
| **Viral Confidence Score** | 0–100 with plain-English reasoning for every video |
| **Magic Moments** | Real-time culturally perfect sound/effect suggestions |
| **Soul Check** | Weekly gentle prompt that keeps content 100% human |
| **Referral Rocket** | "Made with Lumina" smart watermark + cash-paying referrals |

## Tech Teaser

```
Mobile         Expo (React Native) · TypeScript · Reanimated · NativeTabs (iOS 26 liquid glass)
Edge           On-device quantized Llama 3.2 11B Vision · Mistral 7B · Qwen 3.5 9B (4/8-bit)
Orchestration  Internal memory graph · 4 specialized agents + 1 Orchestrator
Hybrid Cloud   Selective edge-cloud burst (<5s) for heavy renders only
Backend        Express 5 · TypeScript · Drizzle ORM · PostgreSQL · OpenAPI-first
Monorepo       pnpm workspaces · TypeScript project references · Orval codegen
Privacy        Zero raw footage leaves device without explicit consent · encrypted on-device
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full agent swarm and hybrid inference diagram.

## Quick Start

```bash
pnpm install
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/lumina run dev   # Mobile (Expo)
pnpm --filter @workspace/api-server run dev
```

Scan the Expo QR from the Replit URL bar to load the app on your physical device via Expo Go.

## Project Layout

```
artifacts/
├── lumina/             # Expo mobile app — the product surface
├── api-server/         # DEPRECATED · frozen until Sprint 3 (edge-cloud burst layer)
└── mockup-sandbox/     # Canvas for UI exploration
packages/
├── style-twin/         # Personal Style Twin · 99.8% on-device clone (Sprint 1)
├── swarm-studio/       # 4-agent collaborative swarm (Sprint 2)
├── monetizer/          # Closed-loop monetization · 10% performance fee (Sprint 4)
├── edge-cloud/         # Stateless burst client · <5s additional (Sprint 2/3)
├── api-spec/           # OpenAPI single source of truth
├── api-client-react/   # Generated React Query hooks (Orval)
└── api-zod/            # Generated Zod schemas (Orval)
.agents/                # Agent definitions, prompts, memory-graph schemas
scripts/                # Repo-wide tooling
```

> **On-device-first by construction.** PostgreSQL has been removed from the workspace — there is no `lib/db`. The api-server artifact is frozen until Sprint 3 unfreezes it strictly for the Compliance Shield CDN, Deal Router, and stateless burst layer described in `ARCHITECTURE.md`.

## Roadmap

This is a **90-day nuclear sprint** to a self-monetizing v1. See [ROADMAP.md](ROADMAP.md).

- **Sprint 0** — Vision lock, architecture, repo foundations *(current)*
- **Sprint 1** — Personal Style Twin MVP
- **Sprint 2** — Swarm Studio (4 agents collaborating end-to-end)
- **Sprint 3** — Smart Publisher + Compliance Shield
- **Sprint 4** — Earnings Engine + Referral Rocket
- **Sprint 5** — Beta launch in São Paulo + Jakarta

## Contribution Guidelines

Lumina is built to a **non-negotiable standard**. Every contribution must clear the same bar.

### The Constitution

1. **Vision-aligned or rejected.** Every PR must declare which spec capability it advances. Drive-by features that do not serve the immutable v1.0 vision are closed without discussion.
2. **Privacy-first, always.** Zero raw user footage leaves the device without explicit per-action consent. No analytics that fingerprint creators. No third-party SDKs that exfiltrate.
3. **On-device first, cloud only when justified.** Any cloud call must document why on-device cannot serve the use case within budget.
4. **Tests are not optional.** Every public endpoint, hook, component, and utility ships with tests. Major features include integration + E2E coverage.
5. **No placeholders, no shortcuts, no compromise.** Senior-engineer-grade code or it does not merge.
6. **Cultural authenticity is a P0 requirement.** Copy, mock data, and trend logic for SEA/LATAM markets must be reviewed by a regional contributor before merge.

### Workflow

```bash
git checkout -b feat/<sprint>-<short-name>
# build · test · self-review · harden · optimize
pnpm run typecheck && pnpm run build
git commit -m "feat(<area>): <imperative summary>"
gh pr create
```

Every PR must complete the [vision-alignment checklist](.github/pull_request_template.md). PRs that fail the checklist are auto-closed.

### Commit Conventions

[Conventional Commits](https://www.conventionalcommits.org/). Types: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `chore`. Scopes mirror the repo (`mobile`, `api`, `swarm`, `style-twin`, `publisher`, `monetizer`, `infra`).

### Code of Conduct

Be the kind of collaborator Maria and Rian deserve: kind, direct, and ruthlessly committed to their success.

## License

[MIT](LICENSE.md) © Lumina contributors.
