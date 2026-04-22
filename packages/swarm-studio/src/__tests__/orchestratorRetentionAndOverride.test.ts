/**
 * Regression tests for two MockOrchestrator extensions:
 *
 *   1. FIFO retention caps: long-running creator sessions must not grow
 *      the orchestrator's intermediate-state Maps without bound.
 *
 *   2. dailyBriefs creativeOverride: when the user submits a free-form
 *      prompt via the lily-pad input, the top brief's hook is rewritten
 *      with the override text so the rest of the chain (storyboard →
 *      video → deal) propagates it naturally. Omitting the override
 *      preserves the Sprint-2 determinism contract.
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
  return (
    await train(
      makeSamples(prefix, 10),
      new MockInferenceAdapter(),
      grantConsent("train"),
    )
  ).twin;
}

function makeCtx(twin: StyleTwin, memory: InMemoryMemoryGraph): OrchestratorContext {
  return {
    styleTwin: twin,
    memory,
    consent: new AlwaysAllowConsent(),
    region: "br",
  };
}

async function run() {
  const twin = await trainTwin("alice");

  // ── 1. Retention caps ──────────────────────────────────────────────
  // Configure a tiny cap and re-run the chain enough times to overflow
  // it. The MemoryGraph also gets a small cap. After the run, neither
  // store may exceed its configured maximum.
  {
    const memory = new InMemoryMemoryGraph({ maxNodes: 12 });
    const orch = new MockOrchestrator({
      maxEntriesPerKind: 3,
      // Vary dayKey so each run produces fresh brief IDs (otherwise the
      // boundedSet would just overwrite the same key).
      dayKey: (() => {
        let i = 0;
        return () => `2026-04-${String((i++ % 30) + 1).padStart(2, "0")}`;
      })(),
    });
    const ctx = makeCtx(twin, memory);

    for (let i = 0; i < 10; i++) {
      const briefs = await orch.dailyBriefs(ctx);
      const sb = await orch.storyboard(ctx, briefs[0].id);
      const v = await orch.produce(ctx, sb.id);
      await orch.monetize(ctx, v.id);
      // Exercise the publish plan path too so the `plans` map is covered
      // by the FIFO cap assertion below.
      await orch.plan(ctx, v.id, {
        platforms: ["tiktok"],
        creatorKey: `creator-${i}`,
        regions: ["br"],
      });
    }

    // Reach into private state via JSON-stringifyable size assertions.
    // We don't expose internals publicly, so use the snapshot helper for
    // the memory graph and assert via duck-typing on the orchestrator.
    const snapshot = memory.snapshot();
    assert.ok(
      snapshot.length <= 12,
      `MemoryGraph exceeded cap: ${snapshot.length} > 12`,
    );

    // The orchestrator's storyboard map is keyed by storyboard.id. After
    // 10 runs with distinct dayKeys → 10 distinct storyboards. With cap
    // 3 we should only retain the most recent 3.
    const internal = orch as unknown as {
      storyboards: Map<string, unknown>;
      videos: Map<string, unknown>;
      briefs: Map<string, unknown>;
      plans: Map<string, unknown>;
    };
    assert.ok(
      internal.storyboards.size <= 3,
      `storyboards Map exceeded cap: ${internal.storyboards.size} > 3`,
    );
    assert.ok(
      internal.videos.size <= 3,
      `videos Map exceeded cap: ${internal.videos.size} > 3`,
    );
    // briefs is bounded too, though dailyBriefs writes 3 per call so the
    // cap may be saturated sooner.
    assert.ok(
      internal.briefs.size <= 3,
      `briefs Map exceeded cap: ${internal.briefs.size} > 3`,
    );
    assert.ok(
      internal.plans.size <= 3,
      `plans Map exceeded cap: ${internal.plans.size} > 3`,
    );
  }

  // ── 2. creativeOverride rewrites the top brief's hook ──────────────
  {
    const memory = new InMemoryMemoryGraph();
    const orch = new MockOrchestrator({
      now: () => 1745251200000,
      dayKey: () => "2026-04-21",
    });
    const ctx = makeCtx(twin, memory);

    const baseline = await orch.dailyBriefs(ctx);
    const override = "make a cargo-pant flip but with neon thread";
    const overridden = await orch.dailyBriefs(ctx, { creativeOverride: override });

    assert.equal(
      overridden[0].hook,
      override,
      "creativeOverride must replace the top brief's hook verbatim",
    );
    assert.notEqual(
      baseline[0].hook,
      overridden[0].hook,
      "override path must produce a different hook than the baseline",
    );
    assert.ok(
      overridden[0].beats[0].includes(override),
      "creativeOverride must be reflected in the opening beat for downstream agents",
    );

    // Determinism contract: omitting the override must still yield the
    // same briefs as a pinned baseline run.
    const baseline2 = await orch.dailyBriefs(ctx);
    assert.deepEqual(
      baseline,
      baseline2,
      "no-override path must remain deterministic across calls",
    );

    // Whitespace-only override must be ignored (treated as no override).
    const blank = await orch.dailyBriefs(ctx, { creativeOverride: "   " });
    assert.deepEqual(
      blank,
      baseline,
      "whitespace-only override must be treated as no override",
    );
  }

  console.log("swarm-studio retention + creativeOverride: PASS");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
