/**
 * Sprint 3 regression — A/B winner promotion logic.
 *
 * The Smart Publisher's selection contract (locked here):
 *
 *   1. Eligibility: only variants with `meetsAudioGate === true` may win.
 *      An off-Twin variant must NEVER be promoted, even if its rankScore
 *      is the highest in the cohort.
 *
 *   2. Ranking: among eligible variants, the highest `rankScore` wins.
 *
 *   3. Tie-break: ties on `rankScore` resolve deterministically by
 *      lexicographic variant id (so re-runs always promote the same id).
 *
 *   4. Empty eligibility: pickWinner returns null. The Smart Publisher
 *      surfaces a `blockedReason` rather than silently shipping.
 *
 *   5. Determinism: identical (twin, seeds) → identical winner across runs.
 *
 *   6. Symmetry with the live Smart Publisher pipeline: the variant
 *      pickWinner promotes is the variant whose id appears in
 *      PublishPlan.winnerId.
 */
import { strict as assert } from "node:assert";
import {
  AlwaysAllowConsent,
  InMemoryMemoryGraph,
  MockOrchestrator,
  generateABVariants,
  pickWinner,
  type ABVariant,
  type OrchestratorContext,
} from "../index";
import {
  AUDIO_MATCH_GATE,
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

function fakeVariant(overrides: Partial<ABVariant>): ABVariant {
  return {
    id: "v-0-0-0",
    hookIndex: 0,
    captionIndex: 0,
    thumbnailIndex: 0,
    hook: "h",
    caption: "c",
    thumbnailLabel: "t",
    twinAffinityOverall: 0.9,
    twinAffinityVoice: 0.99,
    meetsAudioGate: true,
    nearestNeighborScore: 0.5,
    rankScore: 0.7,
    ...overrides,
  };
}

async function run() {
  // ── 1. Eligibility: gate-failers can never win, even with top rankScore.
  const cheater = fakeVariant({
    id: "v-cheater",
    twinAffinityVoice: 0.6,
    meetsAudioGate: false,
    rankScore: 0.99, // best score in the room
  });
  const honest = fakeVariant({
    id: "v-honest",
    twinAffinityVoice: 0.97,
    meetsAudioGate: true,
    rankScore: 0.55,
  });
  const winner1 = pickWinner([cheater, honest]);
  assert.ok(winner1, "expected a winner when at least one variant clears the gate");
  assert.equal(winner1!.id, "v-honest", "off-Twin variant must NEVER be promoted, even with highest rankScore");

  // ── 2. Ranking among eligibles: highest rankScore wins.
  const losers = [
    fakeVariant({ id: "v-a", rankScore: 0.40 }),
    fakeVariant({ id: "v-b", rankScore: 0.85 }),
    fakeVariant({ id: "v-c", rankScore: 0.60 }),
  ];
  const winner2 = pickWinner(losers);
  assert.equal(winner2!.id, "v-b", "highest rankScore must win among eligibles");

  // ── 3. Deterministic tiebreak on lexicographic id.
  const tiers = [
    fakeVariant({ id: "v-2-1-0", rankScore: 0.7 }),
    fakeVariant({ id: "v-1-1-0", rankScore: 0.7 }),
    fakeVariant({ id: "v-3-1-0", rankScore: 0.7 }),
  ];
  const winner3 = pickWinner(tiers);
  assert.equal(winner3!.id, "v-1-1-0", "tie must resolve by lexicographic id (smallest first)");

  // Tiebreak is stable under input reorder.
  const reordered = [...tiers].reverse();
  assert.equal(pickWinner(reordered)!.id, "v-1-1-0", "tiebreak must be input-order independent");

  // ── 4. Empty eligibility returns null.
  const allBad = [
    fakeVariant({ id: "v-a", meetsAudioGate: false, twinAffinityVoice: 0.5, rankScore: 0.9 }),
    fakeVariant({ id: "v-b", meetsAudioGate: false, twinAffinityVoice: 0.4, rankScore: 0.8 }),
  ];
  assert.equal(pickWinner(allBad), null, "no eligible variants must return null (no silent ship)");

  // ── 5. Eligibility flag agrees with the gate constant.
  // If a variant's voice score is exactly at the gate, it MUST be eligible.
  const atGate = fakeVariant({ id: "v-atgate", twinAffinityVoice: AUDIO_MATCH_GATE, meetsAudioGate: true, rankScore: 0.5 });
  const justBelow = fakeVariant({ id: "v-below", twinAffinityVoice: AUDIO_MATCH_GATE - 0.01, meetsAudioGate: false, rankScore: 0.99 });
  assert.equal(pickWinner([atGate, justBelow])!.id, "v-atgate", "voice at AUDIO_MATCH_GATE must be eligible");

  // ── 6. Live pipeline symmetry: the orchestrator's PublishPlan.winnerId
  //      is exactly the id pickWinner promotes from the same variants list.
  const twin = await trainTwin("alice-promo");
  const orch = new MockOrchestrator({ now: () => 1745251200000, dayKey: () => "2026-04-21" });
  const ctx: OrchestratorContext = {
    styleTwin: twin,
    memory: new InMemoryMemoryGraph(),
    consent: new AlwaysAllowConsent(),
    region: "br",
  };
  const briefs = await orch.dailyBriefs(ctx);
  const sb = await orch.storyboard(ctx, briefs[0].id);
  const v = await orch.produce(ctx, sb.id);
  const plan = await orch.plan(ctx, v.id, {
    platforms: ["tiktok", "reels"],
    creatorKey: "alice-key-v1",
    regions: ["br"],
  });
  assert.equal(plan.variants.length, 12);
  const livePromoted = pickWinner(plan.variants);
  assert.equal(plan.winnerId, livePromoted?.id ?? null, "PublishPlan.winnerId must equal pickWinner(plan.variants)");

  // ── 7. Live A/B determinism + tiebreak: re-run produces identical winner.
  const variantsA = await generateABVariants(twin, {
    seedHooks: ["uma coisa", "tem segredo"],
    seedCaptions: ["a", "b"],
    seedThumbnailLabels: ["x", "y", "z"],
  });
  const variantsB = await generateABVariants(twin, {
    seedHooks: ["uma coisa", "tem segredo"],
    seedCaptions: ["a", "b"],
    seedThumbnailLabels: ["x", "y", "z"],
  });
  assert.deepEqual(variantsA, variantsB, "generateABVariants must be deterministic for identical inputs");
  assert.equal(pickWinner(variantsA)?.id ?? null, pickWinner(variantsB)?.id ?? null, "winner must be identical across re-runs");

  // ── 8. Eligibility flag MUST agree with rule §1: a variant flagged
  //      meetsAudioGate=true while voice < AUDIO_MATCH_GATE would be a
  //      contract violation. Catch it here so a future bug in
  //      generateABVariants can't smuggle off-Twin winners through.
  for (const v of variantsA) {
    assert.equal(
      v.meetsAudioGate,
      v.twinAffinityVoice >= AUDIO_MATCH_GATE,
      `variant ${v.id} meetsAudioGate flag inconsistent with voice score ${v.twinAffinityVoice} vs gate ${AUDIO_MATCH_GATE}`,
    );
  }

  console.log("swarm-studio A/B winner promotion logic: PASS");
}

run().catch((err) => { console.error(err); process.exit(1); });
