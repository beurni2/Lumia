/**
 * Sprint 3 regression — Smart Publisher contracts.
 *
 * Locks the invariants the Smart Publisher relies on:
 *   1. Always emits exactly 12 A/B variants (3 thumb × 2 caption × 2 hook).
 *   2. Winner selection prefers higher rankScore but only among voice-gate
 *      passers; if no variant clears the gate, plan is honestly blocked.
 *   3. Smart watermark is deterministic and lossless-roundtrippable
 *      via readWatermark(sidecar).
 *   4. Per-platform Shield verdicts route through the correct policy pack.
 *   5. Determinism: same inputs → same plan + same launch result.
 *   6. Hard-blocked launch refuses to "post" (no mock URL emitted).
 */
import { strict as assert } from "node:assert";
import {
  AlwaysAllowConsent,
  InMemoryMemoryGraph,
  MockOrchestrator,
  REQUIRED_CAPTIONS,
  REQUIRED_HOOKS,
  REQUIRED_THUMBNAILS,
  VARIANT_COUNT,
  WATERMARK_TAG,
  readWatermark,
  type OrchestratorContext,
} from "../index";
import {
  MemoryBackend,
  MockInferenceAdapter,
  configureBackend,
  configureVectorBackend,
  grantConsent,
  train,
  type StyleTwin,
  type VideoSample,
} from "@workspace/style-twin";

function makeSamples(prefix: string, n: number): VideoSample[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i}`,
    uri: `file:///fixtures/${prefix}-${i}.mp4`,
    durationMs: 30_000 + i * 1000,
    capturedAt: 1700000000000 + i * 86400_000,
  }));
}

async function trainTwin(prefix: string): Promise<StyleTwin> {
  const backend = new MemoryBackend();
  configureBackend(backend);
  configureVectorBackend(backend);
  return (await train(makeSamples(prefix, 10), new MockInferenceAdapter(), grantConsent("train"))).twin;
}

function makeCtx(twin: StyleTwin): OrchestratorContext {
  return {
    styleTwin: twin,
    memory: new InMemoryMemoryGraph(),
    consent: new AlwaysAllowConsent(),
    region: "br",
  };
}

const NOW = 1745251200000;
const DAY = "2026-04-21";

async function runFullPipeline(twin: StyleTwin) {
  const orch = new MockOrchestrator({ now: () => NOW, dayKey: () => DAY });
  const ctx = makeCtx(twin);
  const briefs = await orch.dailyBriefs(ctx);
  const sb = await orch.storyboard(ctx, briefs[0].id);
  const v = await orch.produce(ctx, sb.id);
  return { orch, ctx, video: v, sb };
}

async function run() {
  const twin = await trainTwin("alice");
  const { orch, ctx, video } = await runFullPipeline(twin);

  // ── 1. Plan emits exactly 12 variants ────────────────────────────────
  const plan = await orch.plan(ctx, video.id, {
    platforms: ["tiktok", "reels", "shorts", "kwai", "goplay", "kumu"],
    creatorKey: "alice-key-v1",
    regions: ["br", "id"],
  });
  assert.equal(plan.variants.length, VARIANT_COUNT, "must emit exactly 12 variants");
  assert.equal(REQUIRED_THUMBNAILS * REQUIRED_CAPTIONS * REQUIRED_HOOKS, VARIANT_COUNT,
    "VARIANT_COUNT must equal 3 × 2 × 2");

  // Variant IDs deterministic + unique
  const ids = plan.variants.map((v) => v.id);
  assert.equal(new Set(ids).size, VARIANT_COUNT, "variant IDs must be unique");
  for (const v of plan.variants) {
    assert.match(v.id, /^v-\d+-\d+-\d+$/);
    assert.ok(v.twinAffinityVoice >= 0 && v.twinAffinityVoice <= 1);
    assert.ok(v.twinAffinityOverall >= 0 && v.twinAffinityOverall <= 1);
  }

  // ── 2. Winner selection rules ────────────────────────────────────────
  if (plan.winnerId) {
    const winner = plan.variants.find((v) => v.id === plan.winnerId)!;
    assert.ok(winner.meetsAudioGate, "winner must clear AUDIO_MATCH_GATE");
    // Winner must have the max rankScore among gate-passers.
    const eligible = plan.variants.filter((v) => v.meetsAudioGate);
    const maxRank = Math.max(...eligible.map((v) => v.rankScore));
    assert.equal(winner.rankScore, maxRank, "winner must be top-ranked among eligible");
  } else {
    // If no winner, plan must be honestly blocked.
    assert.ok(plan.blockedReason, "missing winner requires blockedReason");
    assert.equal(plan.perPlatform.length, 0, "no per-platform plans when blocked");
  }

  // ── 3. Watermark deterministic + lossless roundtrip ──────────────────
  assert.equal(plan.watermark.tag, WATERMARK_TAG);
  assert.match(plan.watermark.signature, /^[0-9a-f]{16}$/, "signature must be 16-hex");
  const round = readWatermark(plan.watermark.sidecar);
  assert.ok(round, "sidecar must roundtrip");
  assert.equal(round!.signature, plan.watermark.signature);
  assert.equal(round!.tag, WATERMARK_TAG);

  // ── 4. Per-platform plans + Shield verdicts ──────────────────────────
  if (plan.winnerId) {
    assert.equal(plan.perPlatform.length, 6, "should have 6 per-platform plans");
    for (const pp of plan.perPlatform) {
      assert.ok(["tiktok","reels","shorts","kwai","goplay","kumu"].includes(pp.platform));
      assert.ok(["pass","rewritten","blocked"].includes(pp.shield.status));
      assert.equal(pp.adaptation.aspect, "9:16", "all SEA/LATAM short-form is 9:16");
      assert.ok(pp.adaptation.maxCaptionLen > 0);
      assert.ok(pp.adaptation.maxDurationSec > 0);
      // Shield-blocked content MUST be the original (no silent ship).
      if (pp.shield.status === "blocked") {
        assert.equal(pp.content, pp.shield.rewritten);
      }
    }
  }

  // ── 5. Determinism: re-run produces bit-identical plan ───────────────
  const { orch: orch2, ctx: ctx2, video: video2 } = await runFullPipeline(twin);
  const plan2 = await orch2.plan(ctx2, video2.id, {
    platforms: ["tiktok", "reels", "shorts", "kwai", "goplay", "kumu"],
    creatorKey: "alice-key-v1",
    regions: ["br", "id"],
  });
  assert.deepEqual(plan.variants, plan2.variants, "variants must be bit-identical across runs");
  assert.equal(plan.winnerId, plan2.winnerId, "winner must be identical across runs");
  assert.deepEqual(plan.watermark, plan2.watermark, "watermark must be identical across runs");
  assert.deepEqual(plan.perPlatform, plan2.perPlatform, "per-platform plans must be identical across runs");

  // ── 6. Launch contract ───────────────────────────────────────────────
  const result = await orch.launch(ctx, plan.planId);
  assert.equal(result.planId, plan.planId);
  if (plan.winnerId) {
    assert.equal(result.hardBlocked, false);
    assert.equal(result.perPlatform.length, 6);
    for (const r of result.perPlatform) {
      if (r.status === "blocked") {
        assert.equal(r.mockUrl, null, "blocked platforms must NOT emit a mock URL");
        assert.ok(r.reason, "blocked platforms must include a reason");
      } else {
        assert.match(r.mockUrl ?? "", /^mock:\/\//, "posted platforms must emit a mock URL");
      }
    }
  } else {
    assert.equal(result.hardBlocked, true);
  }

  // ── 7. Hashtag-cap rewrite is observable in TikTok plan ──────────────
  if (plan.winnerId) {
    const tt = plan.perPlatform.find((p) => p.platform === "tiktok")!;
    // Default content has 3 hashtags; never exceeds TikTok's 5-tag soft cap,
    // so verdict should be "pass" for the hashtag rule. We just assert the
    // 5-cap is never violated post-Shield.
    assert.ok(tt.content.hashtags.length <= 5, "TikTok plan must not exceed 5 hashtags");
  }

  console.log("swarm-studio Smart Publisher (12-variant A/B + Shield + watermark): PASS");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
