import type { StyleTwin } from "@workspace/style-twin";
import type { Brief, Storyboard } from "../types";

/**
 * Director — translates a Brief into a Storyboard whose shot pacing matches
 * the StyleTwin's voice rhythm. Faster pacing → shorter shots. Generates 3
 * hook variants so the Editor can A/B internally.
 *
 * In Sprint 3 this also reads `nearest()` from the encrypted vector memory
 * to retrieve the creator's most stylistically similar past hooks.
 */
export function direct(brief: Brief, twin: StyleTwin): Storyboard {
  const wpm = twin.fingerprint.voice.pacingWpm;
  // Empirical mapping: 140 wpm → 4.0 s shots; 200 wpm → 2.5 s shots.
  const baseShot = Math.max(2.0, Math.min(5.0, 5.5 - (wpm - 120) * 0.025));

  const shots = brief.beats.map((beat, i) => ({
    duration: round1(baseShot * (i === 0 ? 1.2 : 1.0)),
    description: beat,
    cameraNote: cameraNoteFor(beat, twin),
  }));

  const phrases = twin.fingerprint.vocabulary.catchphrases;
  const hookVariants = [
    brief.hook,
    phrases[0] ? `${phrases[0]} — ${brief.hook}` : `wait for it: ${brief.hook}`,
    phrases[1] ? `${phrases[1]}, ${brief.hook}` : `nobody is talking about ${brief.hook}`,
  ];

  return {
    id: `storyboard-${brief.id}`,
    briefId: brief.id,
    shots,
    hookVariants,
  };
}

function cameraNoteFor(beat: string, twin: StyleTwin): string {
  const motion = twin.fingerprint.visual.motionEnergy;
  if (motion > 0.6) return "handheld, high motion";
  if (motion > 0.35) return "handheld, gentle drift";
  return /reveal|reaction/i.test(beat) ? "static, eye-level" : "static, locked-off";
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
