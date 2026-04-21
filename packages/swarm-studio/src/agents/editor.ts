import type { StyleFingerprint, StyleTwin } from "@workspace/style-twin";
import { AUDIO_MATCH_GATE, similarity } from "@workspace/style-twin";
import type { RenderedVideo, Storyboard } from "../types";

/**
 * Editor — assembles a RenderedVideo and validates it against the StyleTwin.
 *
 * In the mock pipeline the "render" is synthetic. To produce a *meaningful*
 * self-score (per Sprint 2 phase-complete audit), we synthesise a candidate
 * fingerprint that is a deterministic perturbation of the Twin's own
 * fingerprint, weighted by how much the storyboard deviates from the Twin's
 * natural rhythm. A perfectly-on-rhythm storyboard returns ~1.0; a
 * dramatically off-rhythm storyboard pushes the candidate below the
 * AUDIO_MATCH_GATE (0.95) and is rejected.
 *
 * The real ExecuTorch dev build replaces `synthesiseCandidateFingerprint`
 * with the re-extracted fingerprint of the on-device-rendered video.
 */

export class TwinMatchRejected extends Error {
  constructor(
    public readonly score: number,
    public readonly gate: number,
  ) {
    super(`Render rejected: voice match ${score.toFixed(3)} < gate ${gate}`);
    this.name = "TwinMatchRejected";
  }
}

export function edit(storyboard: Storyboard, twin: StyleTwin): RenderedVideo {
  const totalDuration = storyboard.shots.reduce((s, x) => s + x.duration, 0);
  const avgShot = totalDuration / Math.max(1, storyboard.shots.length);
  const idealShot = 5.5 - (twin.fingerprint.voice.pacingWpm - 120) * 0.025;
  const pacingDrift = Math.min(1, Math.abs(idealShot - avgShot) / 3);

  // Synthetic candidate: perturb the Twin in proportion to pacing drift, so
  // the similarity score actually means something. Deterministic given inputs.
  const candidate = synthesiseCandidateFingerprint(twin.fingerprint, pacingDrift);
  const score = similarity(twin.fingerprint, candidate);

  if (score.voice < AUDIO_MATCH_GATE) {
    throw new TwinMatchRejected(score.voice, AUDIO_MATCH_GATE);
  }

  const pacingFit = 1 - pacingDrift;
  const viralConfidence = clamp01((0.78 + score.overall * 0.18) * (0.85 + pacingFit * 0.15));

  const reasoning =
    `${Math.round(viralConfidence * 100)}% — pacing ${avgShot.toFixed(1)}s/shot ` +
    `vs your ${idealShot.toFixed(1)}s natural rhythm; Twin-match ${(score.overall * 100).toFixed(1)}% ` +
    `(voice ${(score.voice * 100).toFixed(1)}%).`;

  return {
    id: `video-${storyboard.id}`,
    storyboardId: storyboard.id,
    filePath: `mock://render/${storyboard.id}.mp4`,
    durationSec: round1(totalDuration),
    viralConfidence: round2(viralConfidence),
    twinMatchScore: round2(score.overall),
    reasoning,
  };
}

/** Deterministic perturbation. drift ∈ [0,1] — 0 = identity, 1 = far. */
function synthesiseCandidateFingerprint(
  twin: StyleFingerprint,
  drift: number,
): StyleFingerprint {
  const d = Math.max(0, Math.min(1, drift));
  const timbre = twin.voice.timbreVector.map((v, i) => {
    const noise = ((i * 2654435761) >>> 0) / 0xffffffff - 0.5;
    return v * (1 - d * 0.08) + noise * d * 0.12;
  });
  const norm = Math.sqrt(timbre.reduce((s, x) => s + x * x, 0)) || 1;
  return {
    voice: {
      pacingWpm: twin.voice.pacingWpm * (1 + d * 0.15),
      energyMean: twin.voice.energyMean * (1 - d * 0.1),
      energyStd: twin.voice.energyStd,
      timbreVector: timbre.map((x) => x / norm),
      fillerRate: twin.voice.fillerRate * (1 + d * 0.2),
    },
    visual: twin.visual,
    vocabulary: twin.vocabulary,
  };
}

function clamp01(n: number): number { return Math.max(0, Math.min(1, n)); }
function round1(n: number): number { return Math.round(n * 10) / 10; }
function round2(n: number): number { return Math.round(n * 100) / 100; }
