# Lumina — Founder Demo Script

**Length:** 4 minutes · **Audience:** investor / partner / first design partner
**Stack:** Replit preview → `artifacts/lumina` (Expo web). One continuous take.
**Pre-flight:** preview pane visible, viewport ~390×844 (iPhone 14), workflow `artifacts/lumina: expo` running.

---

## Cold open · 0:00 → 0:20 — *“The 1K–50K creator is a one-person studio. Lumina is their swarm.”*

> "Micro-creators in São Paulo and Jakarta earn 5–10× more per follower than mega-creators — but they burn out in 18 months because they're producing, editing, posting, and chasing brand DMs alone. Lumina runs the studio for them while they sleep."

**Action:** preview pane shows the home tab. Pause on the hero.

---

## Beat 1 · 0:20 → 0:50 — Personal Style Twin (`/style-twin-train`)

**Tap:** Profile tab → **"Train your Style Twin"**.

> "First thing every creator does is train their Style Twin — a 99.8% voice + aesthetic clone, on-device. We never upload raw footage. It learns from 20 of their best videos in under 4 minutes on an iPhone 12 or better."

**Show:** progress bar, the on-device-inference badge, the cosine-similarity gate.
**Land the line:** "This is the moat. The Twin owns the creator's voice — Lumina just rents the compute."

---

## Beat 2 · 0:50 → 1:40 — Swarm Studio (`/(tabs)/studio`)

**Tap:** Studio tab.

> "The swarm is five agents working in parallel: Ideator pulls trends scoped to the creator's niche, Director storyboards, Editor cuts, Monetizer matches affiliates and brands, Publisher schedules. Every output is checked against the creator's Twin before it leaves the device."

**Show:** today's queued briefs, the trend hooks with viral-potential scores, the "approve → swarm runs" CTA.
**Land the line:** "The creator approves the **idea**. The swarm does the **work**."

---

## Beat 3 · 1:40 → 2:30 — Smart Publisher (`/publisher`)

**Tap:** the top brief → **"Open Publisher"**.

> "Publisher generates 12 platform-adapted variants — TikTok, Reels, Shorts, Kwai — runs each through the Compliance Shield (368 red-team patterns, zero false negatives), watermarks them with the creator's referral code, then schedules an A/B test. The winner gets promoted automatically."

**Show:** the variant grid, the per-platform verdicts (PUBLISH / HOLD / REWRITE), the auto-rewrite that converged in 2 passes.
**Land the line:** "This is the closed loop. Every post is a hypothesis. The swarm learns from the winner."

---

## Beat 4 · 2:30 → 3:30 — Earnings + “While You Slept” (`/(tabs)/earnings` → `/while-you-slept`)

**Tap:** Earnings tab → the **"While You Slept"** card.

> "This is what the creator wakes up to. Last night, Maria's swarm matched a Shopee affiliate, opened a brand deal in BRL, settled both via Pix and Wise, and deposited her 90% take into her on-device wallet. We took 10% — but only on the **incremental** revenue we created, audit-trailed by a hash-chained ledger that catches any tampering down to the cent."

**Show on screen:**
- Hero: **"You earned $151.70 while you slept · plus BRL 204 from regional payouts"**
- Referral Rocket fired card: **"You earned $25 and your referrer earned $25"** with code `L5353939A5353`
- Deposits list: BRL 204 creator-take · USD 101.70 creator-take · USD 25 welcome bounty

> "Referral Rocket pays both sides $25 in real cash on the referee's first payout — and the dual-credit is **atomic**: if the referrer's wallet can't be reached, the referee isn't credited either, and the next cycle retries cleanly. We tested it under simulated network failure."

---

## Close · 3:30 → 4:00 — *“This is the new creator economy operating system.”*

> "Lumina is privacy-first, on-device, and aligned: we only get paid when our creators get paid more than they would have without us. We're live with seven design partners across Brazil, the Philippines, and Indonesia. Sprint 5 brings real partner-network webhooks and the EAS dev build. We're raising a $2.5M seed."

**End on:** the "While You Slept" recap still on screen — confetti subtle, the $25 + $25 callout visible.

---

## Backup answers (don't volunteer — only if asked)

- **"Why on-device?"** — The Twin is the moat; we won't centralize voice clones. Latency, privacy, and regulatory tailwind in BR (LGPD) and ID (PDP Law).
- **"How do you take 10% and stay aligned?"** — Performance fee is gated on `attributableToLumina = true` revenue *above* the creator's pre-Lumina baseline. If we don't lift them, we don't earn. Locked in `feeAccounting.test.ts` against 100 fixtures.
- **"What if a brand deal falls through?"** — Escrow state machine: `open → in-escrow → settled | reversed`. Reversed payouts roll the ledger back atomically; the creator's wallet is append-only and never sees the false credit.
- **"Why SEA + LATAM first?"** — Highest revenue-per-follower ratio globally, lowest creator-tool penetration, and a regulatory window that rewards on-device inference. The diaspora distribution does the rest.

---

## Run-of-show cheat sheet (tape to your laptop)

| t | screen | one phrase |
| --- | --- | --- |
| 0:00 | Home | "Studio for one." |
| 0:20 | Style Twin Train | "99.8% voice clone, on-device." |
| 0:50 | Studio | "Five agents. Creator approves the idea." |
| 1:40 | Publisher | "12 variants, Shield-cleared, watermarked." |
| 2:30 | Earnings → While You Slept | "$151.70 + $25 + $25, while she slept." |
| 3:30 | (recap held) | "Aligned. Privacy-first. $2.5M seed." |
