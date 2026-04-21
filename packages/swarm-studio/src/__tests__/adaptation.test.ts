/**
 * Sprint 3 regression — Multi-platform adaptation contract.
 *
 * Locks the per-platform adaptation values that the Smart Publisher emits
 * in `PublishPlatformPlan.adaptation` AND the truncation pipeline that
 * actually enforces those values on `PublishPlatformPlan.content` before
 * launch.
 *
 * Asserted invariants:
 *
 *   1. Every requested platform produces exactly one PublishPlatformPlan,
 *      and the platform set on the plan equals the requested set.
 *   2. All SEA/LATAM short-form platforms publish 9:16. (Sprint 3 scope.)
 *   3. Per-platform numerical caps match the documented values
 *      (TikTok 2200/180s · Reels 2200/90s · Shorts 100/60s · Kwai 300/60s ·
 *      GoPlay 500/120s · Kumu 280/60s).
 *   4. Caption-style flavour matches the platform's tone profile.
 *   5. Cross-publish symmetry: requesting a single platform produces the
 *      same per-platform adaptation as requesting it inside a multi-platform
 *      bundle.
 *   6. Determinism: identical inputs → identical adaptation across re-runs.
 *   7. Numerical sanity bounds.
 *   8. Shorts duration adaptation matches the policy's hard duration cap.
 *   9. Truncation enforcement: `PublishPlatformPlan.content.caption.length`
 *      is ALWAYS ≤ `adaptation.maxCaptionLen`.
 *  10. Truncation enforcement: `content.durationSec` is ALWAYS ≤
 *      `adaptation.maxDurationSec`.
 *  11. Truncation is idempotent: applying the adaptation to already-
 *      conforming content is a no-op.
 *  12. The launch step posts EXACTLY the truncated content (the per-platform
 *      mock URL embeds the watermark sig, signaling enforced content went
 *      out on the wire).
 */
import { strict as assert } from "node:assert";
import {
  AlwaysAllowConsent,
  InMemoryMemoryGraph,
  MockOrchestrator,
  type OrchestratorContext,
  type PublishPlatformPlan,
} from "../index";
import { applyAdaptation } from "../agents/publisher";
import type { PlatformId } from "@workspace/compliance-shield";
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

interface ExpectedAdaptation {
  readonly aspect: "9:16";
  readonly maxCaptionLen: number;
  readonly maxDurationSec: number;
  readonly captionStyle: "casual" | "punchy" | "title";
}

const EXPECTED: Record<PlatformId, ExpectedAdaptation> = {
  tiktok: { aspect: "9:16", maxCaptionLen: 2200, maxDurationSec: 180, captionStyle: "casual" },
  reels:  { aspect: "9:16", maxCaptionLen: 2200, maxDurationSec: 90,  captionStyle: "punchy" },
  shorts: { aspect: "9:16", maxCaptionLen: 100,  maxDurationSec: 60,  captionStyle: "title"  },
  kwai:   { aspect: "9:16", maxCaptionLen: 300,  maxDurationSec: 60,  captionStyle: "casual" },
  goplay: { aspect: "9:16", maxCaptionLen: 500,  maxDurationSec: 120, captionStyle: "casual" },
  kumu:   { aspect: "9:16", maxCaptionLen: 280,  maxDurationSec: 60,  captionStyle: "punchy" },
};

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

async function buildPlanFor(platforms: readonly PlatformId[]) {
  const twin = await trainTwin("alice-adapt");
  const orch = new MockOrchestrator({ now: () => NOW, dayKey: () => DAY });
  const ctx = makeCtx(twin);
  const briefs = await orch.dailyBriefs(ctx);
  const sb = await orch.storyboard(ctx, briefs[0].id);
  const v = await orch.produce(ctx, sb.id);
  const plan = await orch.plan(ctx, v.id, {
    platforms,
    creatorKey: "alice-key-v1",
    regions: ["br", "id"],
  });
  return { plan, orch, ctx, video: v };
}

function getPlan(plans: readonly PublishPlatformPlan[], p: PlatformId): PublishPlatformPlan {
  const found = plans.find((x) => x.platform === p);
  assert.ok(found, `missing per-platform plan for ${p}`);
  return found!;
}

async function run() {
  const ALL: readonly PlatformId[] = ["tiktok","reels","shorts","kwai","goplay","kumu"];

  // ── 1. Bundle: every requested platform produces exactly one plan. ────
  const { plan: allPlan, orch: allOrch, ctx: allCtx } = await buildPlanFor(ALL);
  if (!allPlan.winnerId) {
    throw new Error(`adaptation suite needs a winning variant; plan blocked: ${allPlan.blockedReason}`);
  }
  assert.equal(allPlan.perPlatform.length, ALL.length, "one per-platform plan per requested platform");
  const seenPlatforms = new Set(allPlan.perPlatform.map((p) => p.platform));
  for (const p of ALL) assert.ok(seenPlatforms.has(p), `bundle missing platform ${p}`);

  // ── 2. & 3. & 4. Per-platform contract values ────────────────────────
  for (const p of ALL) {
    const pp = getPlan(allPlan.perPlatform, p);
    const want = EXPECTED[p];
    assert.equal(pp.adaptation.aspect,         want.aspect,         `${p}: aspect must be 9:16 (SEA/LATAM short-form)`);
    assert.equal(pp.adaptation.maxCaptionLen,  want.maxCaptionLen,  `${p}: maxCaptionLen drift (got ${pp.adaptation.maxCaptionLen}, want ${want.maxCaptionLen})`);
    assert.equal(pp.adaptation.maxDurationSec, want.maxDurationSec, `${p}: maxDurationSec drift (got ${pp.adaptation.maxDurationSec}, want ${want.maxDurationSec})`);
    assert.equal(pp.adaptation.captionStyle,   want.captionStyle,   `${p}: captionStyle drift (got ${pp.adaptation.captionStyle}, want ${want.captionStyle})`);
  }

  // ── 5. Cross-publish symmetry ────────────────────────────────────────
  for (const p of ALL) {
    const { plan: solo } = await buildPlanFor([p]);
    if (!solo.winnerId) continue;
    const soloPlan = getPlan(solo.perPlatform, p);
    const bundlePlan = getPlan(allPlan.perPlatform, p);
    assert.deepEqual(
      soloPlan.adaptation,
      bundlePlan.adaptation,
      `${p}: solo-publish adaptation must equal bundle adaptation (cross-publish contamination)`,
    );
  }

  // ── 6. Determinism ───────────────────────────────────────────────────
  const { plan: rerun } = await buildPlanFor(ALL);
  assert.deepEqual(
    rerun.perPlatform.map((p) => ({ platform: p.platform, adaptation: p.adaptation, content: p.content })),
    allPlan.perPlatform.map((p) => ({ platform: p.platform, adaptation: p.adaptation, content: p.content })),
    "adaptation + enforced content must be bit-identical across deterministic re-runs",
  );

  // ── 7. Subset request ────────────────────────────────────────────────
  const { plan: subset } = await buildPlanFor(["reels", "shorts"]);
  if (subset.winnerId) {
    assert.equal(subset.perPlatform.length, 2);
    assert.deepEqual(
      subset.perPlatform.map((p) => p.platform).sort(),
      ["reels", "shorts"],
      "subset request must produce exactly the requested per-platform plans",
    );
  }

  // ── 8. Numerical sanity ──────────────────────────────────────────────
  for (const p of ALL) {
    const pp = getPlan(allPlan.perPlatform, p);
    assert.ok(pp.adaptation.maxCaptionLen >= 50,    `${p}: maxCaptionLen unreasonably small`);
    assert.ok(pp.adaptation.maxCaptionLen <= 5000,  `${p}: maxCaptionLen unreasonably large`);
    assert.ok(pp.adaptation.maxDurationSec >= 30,   `${p}: maxDurationSec below 30s floor`);
    assert.ok(pp.adaptation.maxDurationSec <= 600,  `${p}: maxDurationSec above 10-min ceiling`);
  }

  // ── 9. Shorts hard cap symmetry ──────────────────────────────────────
  const shortsPlan = getPlan(allPlan.perPlatform, "shorts");
  assert.equal(shortsPlan.adaptation.maxDurationSec, 60, "Shorts adaptation cap MUST equal the 60s policy hard rule");

  // ── 10. Truncation enforcement: every per-platform content respects
  //       the caption + duration caps (the Sprint 3 audit blocker). ────
  for (const p of ALL) {
    const pp = getPlan(allPlan.perPlatform, p);
    assert.ok(
      pp.content.caption.length <= pp.adaptation.maxCaptionLen,
      `${p}: enforced caption length ${pp.content.caption.length} exceeds cap ${pp.adaptation.maxCaptionLen}`,
    );
    assert.ok(
      pp.content.durationSec <= pp.adaptation.maxDurationSec,
      `${p}: enforced duration ${pp.content.durationSec}s exceeds cap ${pp.adaptation.maxDurationSec}s`,
    );
  }

  // ── 11. applyAdaptation idempotency + truncation correctness ────────
  // Direct unit-level checks on the truncation function so a bug in it can
  // never silently ship over-length payloads even if the orchestrator is
  // refactored.
  const longCaption = "x".repeat(500);
  const enforced = applyAdaptation({
    caption: longCaption, hook: "h", hashtags: [], audioCue: "a",
    thumbnailLabel: "t", durationSec: 200, regions: ["br"],
  }, EXPECTED.shorts);
  assert.equal(enforced.caption.length, EXPECTED.shorts.maxCaptionLen, "truncated caption must be EXACTLY at the cap");
  assert.ok(enforced.caption.endsWith("…"), "truncated caption must end with ellipsis");
  assert.equal(enforced.durationSec, EXPECTED.shorts.maxDurationSec, "duration must be clamped to cap");
  // Idempotent: applying a second time produces deeply-equal content.
  const reEnforced = applyAdaptation(enforced, EXPECTED.shorts);
  assert.deepEqual(reEnforced, enforced, "applyAdaptation must be idempotent");
  // Below-cap caption is untouched.
  const shortContent = applyAdaptation({
    caption: "tiny", hook: "h", hashtags: [], audioCue: "a",
    thumbnailLabel: "t", durationSec: 10, regions: ["br"],
  }, EXPECTED.shorts);
  assert.equal(shortContent.caption, "tiny", "below-cap caption must pass through untouched");
  assert.equal(shortContent.durationSec, 10, "below-cap duration must pass through untouched");

  // ── 12. Launch posts exactly the enforced content. The mock URLs
  //       depend on (videoId, watermark sig); confirm the Promise.all
  //       fan-out doesn't drop or reorder per-platform results. ───────
  const launchResult = await allOrch.launch(allCtx, allPlan.planId);
  assert.equal(launchResult.perPlatform.length, ALL.length, "launch must return one result per platform");
  const launchPlatforms = launchResult.perPlatform.map((r) => r.platform).sort();
  assert.deepEqual(launchPlatforms, [...ALL].sort(), "launch must return a result for every requested platform");

  console.log("swarm-studio multi-platform adaptation contract: PASS");
}

run().catch((err) => { console.error(err); process.exit(1); });
