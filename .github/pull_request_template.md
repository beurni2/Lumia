<!--
Lumina PRs are held to the immutable v1.0 vision. Every box must be honestly addressed.
PRs that fail the vision-alignment checklist are auto-closed. No exceptions.
-->

## Summary

<!-- One paragraph. What does this PR do, and why now? -->

## Vision Alignment

Tick the capability this PR advances. If you cannot tick at least one, **do not open this PR**.

- [ ] **Personal Style Twin** — on-device 99.8% voice/aesthetic clone
- [ ] **Autonomous Trend Jacker** — 3 culturally-relevant daily briefs
- [ ] **Swarm Studio** — Ideator / Director / Editor / Monetizer collaboration
- [ ] **Smart Publisher** — one-tap multi-platform launch + 12-variant A/B
- [ ] **Earnings Engine** — affiliate / brand deals / payout / 10% performance fee
- [ ] **Compliance Shield** — runtime policy enforcement
- [ ] **Referral Rocket** — smart watermark + cash-paying referrals
- [ ] **Hybrid Inference** — on-device first, edge-cloud burst <5s
- [ ] **Cultural Intelligence** — SEA/LATAM hyper-localization
- [ ] **Foundational** — repo, infra, observability, or developer-experience work that unblocks the above

> **Capability this PR advances:** <!-- name it here, in one sentence -->

## Vision-Alignment Checklist

- [ ] This change serves the immutable v1.0 spec — not a drive-by feature.
- [ ] No raw user footage, audio, or biometric signal leaves the device without **explicit per-action consent**.
- [ ] No new cloud egress path. *(If this PR adds one, justify why on-device cannot serve the use case within budget.)*
- [ ] The Style Twin remains encrypted at rest on-device with zero exceptions.
- [ ] The Compliance Shield gates every outbound asset introduced or modified by this PR.
- [ ] On-device inference budget respected (≤ 90s end-to-end, ≤ 3% battery per video).
- [ ] Cultural authenticity reviewed by a contributor from a target region (BR / MX / CO / AR / ID / PH / VN / TH) when copy, mock data, or trend logic is touched.
- [ ] No emojis in the product UI (use `@expo/vector-icons` / SF Symbols).
- [ ] No placeholder or mock data shipped to production paths.
- [ ] Payout / fee accounting (if touched) audit-trailed and reconciled against provider sandbox.

## Engineering Quality

- [ ] Tests at the appropriate layer(s): unit · integration · E2E.
- [ ] `pnpm run typecheck` passes.
- [ ] `pnpm run build` passes.
- [ ] Coverage on monetization and consent paths is **100%**.
- [ ] Structured logs (Pino) cover new code paths — no `console.log` in server code.
- [ ] Generated client (Orval) regenerated if the OpenAPI spec changed.
- [ ] No new dependencies that are not Expo-Go compatible (mobile) or that bloat the on-device runtime.

## Performance & Privacy

- [ ] Cold-start, render-time, and battery budgets verified on at least one floor device (iPhone SE 3rd gen / Pixel 6a class).
- [ ] Network egress diff reviewed — no unintentional new outbound calls.
- [ ] Telemetry added does not fingerprint individual creators.

## Screenshots / Demo

<!-- For UI changes, attach before/after screenshots or a short screen capture. For agent changes, attach a sample memory-graph trace or video output. -->

## Phase-Complete Notes

<!-- If this PR closes out a sprint milestone, copy in the sprint's audit summary from ROADMAP.md. -->

## Linked Issues

<!-- Closes #... · Relates to #... -->

---

By opening this PR I confirm I have read [`ARCHITECTURE.md`](../ARCHITECTURE.md) and [`ROADMAP.md`](../ROADMAP.md) and that this change honours the immutable v1.0 vision.
