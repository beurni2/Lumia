<!--
  Lumina — Pull Request
  This template is mandatory. PRs that delete sections, leave required boxes
  unchecked, or score below 100% on Vision Alignment will be auto-closed.
-->

## Summary

<!-- One paragraph. What changed and why. Plain English. No marketing. -->

## Linked Sprint & Capability

- **Sprint:** <!-- 0 / 1 / 2 / 3 / 4 / 5 / Hardening -->
- **Capability advanced:** <!-- e.g. Personal Style Twin · Swarm Studio · Compliance Shield · Earnings Engine -->
- **Issue / ADR:** <!-- #123 or docs/adr/0007-... -->

---

## 1 · Vision Alignment Score — must be **100 %**

Tick every box. Each unchecked box is a **−25 %** to the score. Anything below 100 % is rejected.

- [ ] **Aligned** — directly advances a capability listed in `README.md` or `ROADMAP.md`. No drive-by features.
- [ ] **Constitutional** — preserves the immutable v1.0 spec language verbatim where it appears (autonomous GenAI creative swarm · Personal Style Twin 99.8 % · Swarm Studio · Compliance Shield · 10 % performance fee on incremental only · *"The only app that works for you while you live your life"*).
- [ ] **Culturally authentic** — copy, mock data, and trend logic for SEA / LATAM markets reviewed by a regional contributor (BR, MX, ID, PH, VN, TH, CO, AR). Reviewer tagged below.
- [ ] **No scope drift** — does not introduce capabilities outside the sprint's acceptance criteria in `ROADMAP.md`.

**Self-scored Vision Alignment:** `___ %` *(must be 100)*
**Cultural reviewer:** `@___`

---

## 2 · On-Device Privacy Compliance — non-negotiable

- [ ] **Zero raw egress** — no raw video, audio, frames, or biometric signal leaves the device.
- [ ] **Style Twin stays local** — never serialized to network, logs, analytics, or crash reports.
- [ ] **Per-action consent** — every cloud burst is gated by an explicit, scoped, user-tap consent grant.
- [ ] **Stateless cloud payloads** — any cloud call carries no creator identity, no Style Twin, no raw audio.
- [ ] **Encrypted at rest** — new on-device persistence uses iOS Keychain / Android Keystore (or `expo-secure-store`).
- [ ] **No third-party SDKs that fingerprint** — no analytics, attribution, ad, or crash SDK that exfiltrates creator-identifying signals.
- [ ] **Packet-capture proof attached** for any change touching the inference, Style Twin, or publisher paths.

**Privacy proof:** <!-- link to packet capture, screen recording, or N/A with justification -->

---

## 3 · Performance Budget — hard limits

| Metric | Budget | This PR |
|---|---|---|
| End-to-end video generation (script → export, on-device) | **< 90 s** | `___ s` |
| Heavy render burst (when invoked) | **< 5 s** | `___ s` |
| Cold app start (iPhone 13 / Pixel 7) | **< 1.5 s** | `___ s` |
| Style Twin retrain (incremental) | **< 8 s** | `___ s` |
| Compliance Shield latency per asset | **< 250 ms** | `___ ms` |
| Battery cost per video (4000 mAh device) | **≤ 3 %** | `___ %` |
| Resident memory budget (8 GB device) | **≤ 5.5 GB** | `___ GB` |

- [ ] All budgets met, **or** a regression is documented and approved by a code owner with a remediation issue linked: <!-- #___ -->
- [ ] Measured on a real floor device (iPhone SE 3 / Pixel 6a). No simulator-only numbers.

---

## 4 · Conventional Commit — required

- [ ] Every commit on this branch follows [Conventional Commits](https://www.conventionalcommits.org/).
- [ ] Scope is one of: `mobile`, `style-twin`, `swarm`, `publisher`, `monetizer`, `infra`, `repo`, `docs`.
- [ ] Branch follows `feat/<sprint>-<short-name>` or `fix/<sprint>-<short-name>`.

**Primary commit message:**

```
<type>(<scope>): <imperative summary>

<body>

Refs: ROADMAP.md Sprint <n>
```

---

## 5 · Test Coverage Target

- [ ] **Unit tests** added for every new public function, hook, and component.
- [ ] **Integration tests** added for every new package boundary or agent transition.
- [ ] **E2E tests** (Maestro) added for every new user-visible flow.
- [ ] Touched files meet **≥ 85 % line coverage**.
- [ ] Touched files on the **monetization** or **consent** paths meet **100 % line coverage**.
- [ ] CI is green: `pnpm run typecheck && pnpm run lint && pnpm run test`.

| Surface | Coverage before | Coverage after |
|---|---|---|
| Files touched by this PR | `___ %` | `___ %` |
| Monetization / consent paths touched | `___ %` | `___ %` |

---

## 6 · Reviewer Sign-off

- [ ] At least one sibling contributor has reviewed and approved.
- [ ] Cultural reviewer has signed off (when copy or trend logic was touched).
- [ ] Code owner of the touched package has approved.

---

## Screenshots / Recordings

<!-- Required for any user-visible change. Include a real-device recording for animations and gestures. -->

## Risk & Rollback

<!-- One paragraph. What could break? How do we roll back? -->
