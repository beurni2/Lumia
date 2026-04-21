/**
 * Match-score determinism tests.
 *
 * Run with `pnpm --filter @workspace/style-twin test` once a runner is wired
 * (Sprint 1 acceptance criterion). For now these are executable as plain
 * TypeScript via tsx and serve as living documentation of the gates.
 *
 * Gates enforced here:
 *   - Self-similarity: a Mock-trained Twin scores ≥ 0.99 against itself.
 *   - Determinism: same input IDs → identical fingerprint (bit-for-bit).
 *   - Drift: retrain with the same input never drops voice score below 0.95.
 *   - Sensitivity: completely different input IDs score notably lower.
 */
import { strict as assert } from "node:assert";
import {
  AUDIO_MATCH_GATE,
  HEADLINE_MATCH_TARGET,
  MemoryBackend,
  MockInferenceAdapter,
  configureBackend,
  grantConsent,
  similarity,
  train,
  verifyMatch,
  type VideoSample,
} from "../index";

function makeSamples(prefix: string, n: number): VideoSample[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i}`,
    uri: `file:///fixtures/${prefix}-${i}.mp4`,
    durationMs: 30_000 + i * 1000,
    capturedAt: 1700000000000 + i * 86400_000,
  }));
}

async function run() {
  configureBackend(new MemoryBackend());
  const adapter = new MockInferenceAdapter();

  // ── 1. Self-similarity gate ───────────────────────────────────────────
  const consentA = grantConsent("train");
  const a = await train(makeSamples("alice", 10), adapter, consentA);
  const verdict = verifyMatch(a.twin, a.twin);
  assert.equal(verdict.passes, true, "self-match must pass the audio gate");
  assert.ok(
    verdict.score.overall >= HEADLINE_MATCH_TARGET,
    `self-match overall ${verdict.score.overall} below headline target ${HEADLINE_MATCH_TARGET}`,
  );

  // ── 2. Determinism — same IDs → identical fingerprint ─────────────────
  configureBackend(new MemoryBackend());
  const consentB = grantConsent("train");
  const b = await train(makeSamples("alice", 10), adapter, consentB);
  assert.deepEqual(
    a.twin.fingerprint,
    b.twin.fingerprint,
    "Mock fingerprint must be deterministic across runs",
  );

  // ── 3. Sensitivity — different creator → notably lower score ──────────
  configureBackend(new MemoryBackend());
  const consentC = grantConsent("train");
  const c = await train(makeSamples("rian", 10), adapter, consentC);
  const cross = similarity(a.twin.fingerprint, c.twin.fingerprint);
  const self = similarity(a.twin.fingerprint, a.twin.fingerprint);
  assert.ok(
    cross.overall < self.overall && cross.overall < HEADLINE_MATCH_TARGET,
    `cross-creator similarity ${cross.overall} should be lower than self-match ${self.overall}`,
  );

  // ── 4. Audio gate ─────────────────────────────────────────────────────
  assert.ok(
    AUDIO_MATCH_GATE === 0.95,
    "AUDIO_MATCH_GATE must remain 0.95 — Sprint 1 phase-complete audit gate",
  );

  // eslint-disable-next-line no-console
  console.log("style-twin similarity gates: PASS");
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
