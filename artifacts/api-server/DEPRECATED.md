# DEPRECATED — Frozen until Sprint 3

This artifact is **frozen** as of the Sprint 0 → packages migration (Apr 2026).

## Why it still exists

`ARCHITECTURE.md` reserves a thin **edge-cloud burst layer** for three roles:

1. **Compliance Shield policy delta sync** (Sprint 3) — nightly signed pull of TikTok / Reels / Shorts / Kwai policy packs.
2. **Heavy render bursts** (Sprint 2/3) — 4K upscale, 3D VFX, multi-track music synthesis. <5s additional latency, stateless, per-action consent.
3. **Deal Router + escrowed payouts** (Sprint 4) — brand reputation graph, performance-fee accounting, Wise + Pix + GCash + OVO rails.

These are the **only** legitimate cloud responsibilities under the immutable v1.0 vision. Everything else stays on the device.

## Current status

- **Workflow:** registered but unused. Safe to stop.
- **Routes:** stub `/health` only.
- **Dependencies:** no longer depends on `@workspace/db` (removed in Sprint 0 migration; on-device-first means no Postgres).
- **Reactivation owner:** unfreezes during Sprint 3 to host the Compliance Shield policy CDN.

## Do not

- Do not add user data persistence here. `@workspace/db` was deliberately deleted; PostgreSQL has no role in Lumina's privacy model.
- Do not add routes that require creator identity. The burst layer must remain **stateless** — see `packages/edge-cloud/src/index.ts` for the burst invariants.
- Do not delete this artifact. Removing the registration is destructive and forfeits the reserved preview slot.

## Before reactivation

Read `packages/edge-cloud/src/index.ts` and `ARCHITECTURE.md` "Burst rules" section. Implement the contracts there, not new ones.
