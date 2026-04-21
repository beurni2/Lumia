import { ALL_PLATFORMS } from "@workspace/swarm-studio";
import type { PlatformId } from "@workspace/compliance-shield";
import type { StyleTwin } from "@workspace/style-twin";

/**
 * Smart Publisher Sprint 3 — wiring helpers for the Lumina UI.
 *
 * Derives the per-creator stable key the smart watermark needs from the
 * Style Twin's first timbre coefficient. This is the same proxy the Sprint 3
 * tests use; Sprint 5's production-keys flow replaces it with a real X25519
 * public key derived during onboarding.
 */
export function creatorKeyFor(twin: StyleTwin): string {
  const first = twin.fingerprint.voice.timbreVector[0] ?? 0;
  // Stable across runs; deterministic; cheap.
  return `lumina-creator-${first.toFixed(6)}`;
}

/** Default platform set the "Launch to the World" button targets. */
export const DEFAULT_PLATFORMS: readonly PlatformId[] = ALL_PLATFORMS;

/** Default region set; UI exposes a picker in Sprint 4. */
export const DEFAULT_REGIONS: readonly string[] = ["br", "id"];
