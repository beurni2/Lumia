/**
 * Sprint 2 regression — MockOrchestrator determinism contract.
 *
 * Pinning (twin, region, dayKey, now) MUST yield bit-identical
 * Brief / Storyboard / RenderedVideo / DealDraft outputs across runs.
 * The Compliance Shield depends on this to replay any creator's session
 * deterministically when auditing a flagged decision.
 */
import { strict as assert } from "node:assert";
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
import {
  AlwaysAllowConsent,
  InMemoryMemoryGraph,
  MockOrchestrator,
  type OrchestratorContext,
} from "../index";

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

async function runPipeline(twin: StyleTwin, pinnedNow: number, pinnedDay: string) {
  const orch = new MockOrchestrator({
    now: () => pinnedNow,
    dayKey: () => pinnedDay,
  });
  const ctx = makeCtx(twin);
  const briefs = await orch.dailyBriefs(ctx);
  const sb = await orch.storyboard(ctx, briefs[0].id);
  const v = await orch.produce(ctx, sb.id);
  const deals = await orch.monetize(ctx, v.id);
  return { briefs, sb, v, deals };
}

async function run() {
  const twin = await trainTwin("alice");

  const NOW = 1745251200000; // 2026-04-21T16:00:00Z
  const DAY = "2026-04-21";

  const a = await runPipeline(twin, NOW, DAY);
  const b = await runPipeline(twin, NOW, DAY);

  // Briefs identical
  assert.deepEqual(a.briefs, b.briefs, "briefs must be bit-identical under pinned (now,dayKey)");
  // Storyboard identical
  assert.deepEqual(a.sb, b.sb, "storyboard must be bit-identical");
  // Video identical (including viralConfidence and twinMatchScore)
  assert.deepEqual(a.v, b.v, "rendered video must be bit-identical");
  // Deals identical (including occurredAt and fee math)
  assert.deepEqual(a.deals, b.deals, "deal drafts must be bit-identical (fee math + occurredAt)");

  // Different dayKey → different briefs (sanity: determinism is non-trivial)
  const c = await runPipeline(twin, NOW, "2026-04-22");
  assert.notDeepEqual(
    a.briefs.map((x) => x.id),
    c.briefs.map((x) => x.id),
    "different dayKey must change brief IDs (otherwise determinism is vacuous)",
  );

  // ── now-axis advisory ──
  //    Sprint 2 contract: orchestrator outputs are deterministic on
  //    (twin, region, dayKey). The `now()` parameter is plumbed through to
  //    `monetize()` for future audit-trail timestamping but no user-visible
  //    output currently depends on it (DealDraft has no occurredAt field;
  //    calculateFee() ignores RevenueEvent.occurredAt). The check below
  //    locks that current behavior — when DealDraft eventually exposes
  //    occurredAt, this assertion will start failing and serve as a
  //    deliberate prompt to add now-sensitivity coverage.
  const LATER = NOW + 3_600_000;
  const d = await runPipeline(twin, LATER, DAY);
  assert.deepEqual(
    a.deals,
    d.deals,
    "Sprint 2: deals must be invariant under `now` (no user-visible field consumes it). " +
      "When DealDraft exposes occurredAt, flip this to notDeepEqual and add a sensitivity check.",
  );

  // ── monetizer fee math passthrough ────────────────────────────────────
  // DealDraft only surfaces fee + take (gross is internal to monetize()),
  // so we verify the algebraic invariant baked into @workspace/monetizer:
  //   gross    = fee + take
  //   baseline = 0.35 * gross   (per monetizer.ts brand.usd * 0.35)
  //   fee      = round2(0.10 * (gross - baseline))
  //            = round2(0.065 * gross)
  //            = round2(0.065 * (fee + take))
  // If monetize() ever bypasses calculateFee() and invents its own math,
  // this invariant breaks and the test fails.
  assert.ok(a.deals.length > 0, "monetize() must produce at least one deal for BR");
  for (const deal of a.deals) {
    const gross = deal.estimatedFeeUsd + deal.estimatedCreatorTakeUsd;
    const expectedFee = Math.round(0.065 * gross * 100) / 100;
    assert.ok(
      Math.abs(deal.estimatedFeeUsd - expectedFee) <= 0.01,
      `deal ${deal.id} fee math drift: fee=${deal.estimatedFeeUsd}, expected ≈${expectedFee} ` +
        `(gross=${gross}); monetize() must route through @workspace/monetizer.calculateFee`,
    );
    assert.ok(deal.estimatedFeeUsd >= 0, "fee must be non-negative");
    assert.ok(deal.estimatedCreatorTakeUsd > 0, "creator take must be positive");
  }

  console.log("swarm-studio orchestrator determinism: PASS");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
