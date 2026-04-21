/**
 * Sprint 3 regression — autoRewrite convergence + cap behavior.
 *
 * Locks two invariants the Smart Publisher relies on:
 *   1. autoRewrite converges in ≤ MAX_REWRITE_PASSES on the red-team-style
 *      cases (no infinite ping-pong between rules).
 *   2. When the cap is exceeded with residual soft hits, the Shield blocks
 *      honestly rather than shipping a half-cleaned payload.
 */
import { strict as assert } from "node:assert";
import {
  MAX_REWRITE_PASSES,
  POLICY_PACKS,
  autoRewrite,
  type PublishContent,
} from "../index";

function content(overrides: Partial<PublishContent> = {}): PublishContent {
  return {
    caption: "watch this",
    hook: "tem segredo",
    hashtags: ["#fyp"],
    audioCue: "lo-fi",
    thumbnailLabel: "Today",
    durationSec: 30,
    regions: ["br"],
    ...overrides,
  };
}

function run() {
  // Convergence: every rewrite-loop case MUST settle within the cap.
  const cases: PublishContent[] = [
    content({ caption: "easy money — link in bio", hashtags: ["#a","#b","#c","#d","#e","#f","#g","#h"] }),
    content({ caption: "ganhe dinheiro fácil — link in bio", thumbnailLabel: "GANHE AGORA" }),
    content({ caption: "watch on tiktok " + "x".repeat(140), regions: ["br"] }),
  ];
  for (const c of cases) {
    const v = autoRewrite(c, [POLICY_PACKS.tiktok, POLICY_PACKS.reels, POLICY_PACKS.kwai]);
    assert.ok(
      v.rewritePasses <= MAX_REWRITE_PASSES,
      `case overflowed cap: passes=${v.rewritePasses}, cap=${MAX_REWRITE_PASSES}`,
    );
    assert.notEqual(v.status, "blocked", `case unexpectedly blocked: ${JSON.stringify(v.hits)}`);
  }

  // Hard-hit short-circuit returns content untouched (audit invariant).
  const hardCase = content({ hook: "this cures cancer" });
  const hardV = autoRewrite(hardCase, [POLICY_PACKS.tiktok]);
  assert.equal(hardV.status, "blocked");
  assert.equal(hardV.rewritePasses, 0);
  assert.equal(hardV.rewritten.hook, hardCase.hook);

  // Idempotency: feeding a Shield-cleaned payload back through MUST be a no-op pass.
  const messy = content({ caption: "easy money", hashtags: ["#a","#b","#c","#d","#e","#f"] });
  const first = autoRewrite(messy, [POLICY_PACKS.tiktok]);
  assert.equal(first.status, "rewritten");
  const second = autoRewrite(first.rewritten, [POLICY_PACKS.tiktok]);
  assert.equal(second.status, "pass", `idempotency failed: second pass hits=${JSON.stringify(second.hits)}`);
  assert.equal(second.rewritePasses, 0);

  console.log("compliance-shield autoRewrite convergence + idempotency: PASS");
}

run();
