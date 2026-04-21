/**
 * Sprint 3 regression — Multi-platform adaptation contract.
 *
 * Locks the per-platform adaptation values that the Smart Publisher emits
 * in `PublishPlatformPlan.adaptation`. This is the contract Sprint 5's
 * real platform-SDK clients are going to enforce — once the adaptation
 * pipeline starts truncating captions and re-encoding durations against
 * these numbers, drifting any of them silently would ship over-length
 * payloads to platforms that hard-reject them.
 *
 * Asserted invariants:
 *
 *   1. Every requested platform produces exactly one PublishPlatformPlan,
 *      and the platform set on the plan equals the requested set.
 *
 *   2. All SEA/LATAM short-form platforms publish 9:16. (Sprint 3 scope.)
 *
 *   3. Per-platform numerical caps match the documented values
 *      (TikTok 2200/180s · Reels 2200/90s · Shorts 100/60s · Kwai 300/60s ·
 *      GoPlay 500/120s · Kumu 280/60s).
 *
 *   4. Caption-style flavour matches the platform's tone profile.
 *
 *   5. Cross-publish symmetry: requesting a single platform produces the
 *      same per-platform adaptation as requesting it inside a multi-platform
 *      bundle.
 *
 *   6. Determinism: identical inputs → identical adaptation across re-runs.
 *
 *   7. Adaptation is immutable per the type contract — re-evaluating a
 *      plan produces deeply-equal adaptation objects.
 */
import { strict as assert } from "node:assert";
import {
  AlwaysAllowConsent,
  InMemoryMemoryGraph,
  MockOrchestrator,
  type OrchestratorContext,
  type PublishPlatformPlan,
} from "../index";
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
  const { plan: allPlan } = await buildPlanFor(ALL);
  if (!allPlan.winnerId) {
    // No winner means perPlatform is empty by contract — re-run with a
    // smaller set still validates the rest. This branch is defensive.
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

  // ── 5. Cross-publish symmetry: requesting a single platform produces
  //      the same adaptation as the bundle. (Pulls a separate run so we
  //      catch any cross-platform contamination in the orchestrator.)
  for (const p of ALL) {
    const { plan: solo } = await buildPlanFor([p]);
    if (!solo.winnerId) continue; // skip if blocked
    const soloPlan = getPlan(solo.perPlatform, p);
    const bundlePlan = getPlan(allPlan.perPlatform, p);
    assert.deepEqual(
      soloPlan.adaptation,
      bundlePlan.adaptation,
      `${p}: solo-publish adaptation must equal bundle adaptation (cross-publish contamination)`,
    );
  }

  // ── 6. Determinism: re-run produces identical adaptation objects. ────
  const { plan: rerun } = await buildPlanFor(ALL);
  assert.deepEqual(
    rerun.perPlatform.map((p) => ({ platform: p.platform, adaptation: p.adaptation })),
    allPlan.perPlatform.map((p) => ({ platform: p.platform, adaptation: p.adaptation })),
    "adaptation must be bit-identical across deterministic re-runs",
  );

  // ── 7. Subset request: requesting [reels, shorts] omits the others. ──
  const { plan: subset } = await buildPlanFor(["reels", "shorts"]);
  if (subset.winnerId) {
    assert.equal(subset.perPlatform.length, 2);
    assert.deepEqual(
      subset.perPlatform.map((p) => p.platform).sort(),
      ["reels", "shorts"],
      "subset request must produce exactly the requested per-platform plans",
    );
  }

  // ── 8. Adaptation values respect platform reality (sanity caps). ─────
  // Numerical sanity bounds — these are defensive lower/upper limits
  // that catch egregiously broken constants regardless of the EXPECTED
  // table above (e.g. a typo dropping `maxDurationSec` to 0).
  for (const p of ALL) {
    const pp = getPlan(allPlan.perPlatform, p);
    assert.ok(pp.adaptation.maxCaptionLen >= 50,    `${p}: maxCaptionLen unreasonably small`);
    assert.ok(pp.adaptation.maxCaptionLen <= 5000,  `${p}: maxCaptionLen unreasonably large`);
    assert.ok(pp.adaptation.maxDurationSec >= 30,   `${p}: maxDurationSec below 30s floor`);
    assert.ok(pp.adaptation.maxDurationSec <= 600,  `${p}: maxDurationSec above 10-min ceiling`);
  }

  // ── 9. Shorts-specific: Shorts has a hard 60s duration cap. The
  //      adaptation MUST reflect this — drifting it above 60 would
  //      produce content that the Shorts policy pack itself hard-blocks
  //      at evaluate-time, a self-inconsistent state.
  const shortsPlan = getPlan(allPlan.perPlatform, "shorts");
  assert.equal(shortsPlan.adaptation.maxDurationSec, 60, "Shorts adaptation cap MUST equal the 60s policy hard rule");

  console.log("swarm-studio multi-platform adaptation contract: PASS");
}

run().catch((err) => { console.error(err); process.exit(1); });
