/**
 * Pitch deck + DM draft contracts.
 *
 * Locks: 6-slide carousel invariant, ask-USD bounds, manual-send gate,
 * channel caption-cap enforcement.
 */

import assert from "node:assert";
import { generatePitchDeck } from "../pitchDeck";
import { draftDm } from "../dmDraft";
import type { BrandRecord } from "../brandGraph";

const BRAND: BrandRecord = {
  id: "br-reserva",
  handle: "@reservaoficial",
  region: "br",
  typicalPayoutUsd: 380,
  tags: ["fashion", "streetwear"],
};

function run() {
  // ── 1. Carousel always has exactly 6 slides ───────────────────────────
  const deck = generatePitchDeck(
    {
      videoId: "v1",
      hook: "the matcha that broke São Paulo",
      viralConfidencePct: 78,
      twinMatchPct: 96,
      creatorHandle: "@alice",
      creatorRegion: "br",
      avgViewsPerVideo: 12_400,
    },
    BRAND,
  );
  assert.equal(deck.carousel.length, 6, "carousel must have 6 slides");
  assert.deepEqual(
    deck.carousel.map((s) => s.kind),
    ["cover", "stats", "hook", "fit", "ask", "next-step"],
    "carousel slot order is locked",
  );
  for (let i = 0; i < deck.carousel.length; i++) {
    assert.equal(deck.carousel[i]!.slot, i + 1, `slot ${i + 1} must be 1-indexed`);
  }

  // ── 2. Ask USD is bounded [0.6×, 1.8×] of typical ────────────────────
  assert.ok(deck.askUsd >= BRAND.typicalPayoutUsd * 0.6);
  assert.ok(deck.askUsd <= BRAND.typicalPayoutUsd * 1.8);

  // ── 3. Markdown contains key fields ───────────────────────────────────
  assert.ok(deck.markdown.includes(BRAND.handle));
  assert.ok(deck.markdown.includes("@alice"));
  assert.ok(deck.markdown.includes(`USD ${deck.askUsd}`));

  // ── 4. Determinism ────────────────────────────────────────────────────
  const deck2 = generatePitchDeck(
    {
      videoId: "v1",
      hook: "the matcha that broke São Paulo",
      viralConfidencePct: 78,
      twinMatchPct: 96,
      creatorHandle: "@alice",
      creatorRegion: "br",
      avgViewsPerVideo: 12_400,
    },
    BRAND,
  );
  assert.deepEqual(deck, deck2, "pitch deck must be bit-deterministic");

  // ── 5. DM drafts: manual-send gate is hard-coded true ─────────────────
  for (const channel of ["whatsapp", "instagram", "tiktok"] as const) {
    const dm = draftDm(channel, BRAND, {
      creatorHandle: "@alice",
      hook: "test hook",
      viralConfidencePct: 70,
      askUsd: deck.askUsd,
    });
    assert.equal(dm.requiresManualSend, true, `${channel}: requiresManualSend must be true (hard contract)`);
    assert.ok(dm.readyToSend, `${channel}: well-formed draft must be readyToSend`);
    assert.equal(dm.toHandle, BRAND.handle);
    assert.equal(dm.channel, channel);
  }

  // ── 6. DM with zero ask is BLOCKED from sending ───────────────────────
  const blocked = draftDm("instagram", BRAND, {
    creatorHandle: "@alice",
    hook: "x",
    viralConfidencePct: 50,
    askUsd: 0,
  });
  assert.equal(blocked.readyToSend, false);
  assert.match(blocked.blockedReason!, /ask must be > 0/);

  // ── 7. TikTok DM cap (500 chars) enforced ─────────────────────────────
  const huge = draftDm("tiktok", BRAND, {
    creatorHandle: "@alice",
    hook: "x".repeat(600),
    viralConfidencePct: 50,
    askUsd: 100,
  });
  assert.equal(huge.readyToSend, false);
  assert.match(huge.blockedReason!, /exceeds tiktok cap/);

  console.log("monetizer pitch deck + DM drafts: PASS");
}

run();
console.log("Done");
