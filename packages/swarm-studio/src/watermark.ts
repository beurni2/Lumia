import type { RenderedVideo } from "./types";

/**
 * Smart Watermark — "Made with Lumina".
 *
 * Lossless contract: the watermark is a sidecar manifest that travels with
 * the rendered .mp4 (in the file's `udta` atom on iOS / metadata box on
 * Android). It survives platform re-encoding because it's metadata, not
 * pixels. The visible mark — a 14px corner glyph rendered into the final
 * frame by the on-device editor — is also encoded here so the Smart
 * Publisher can reproduce it identically across all 12 A/B variants.
 *
 * Two pieces:
 *   1. `signature`      — opaque deterministic ID derived from (videoId,
 *                         creatorPublicKey, watermarkVersion). Used for
 *                         attribution + referral payouts (Sprint 4 Referral
 *                         Rocket reads this to credit the originator).
 *   2. `visibleGlyph`   — the human-readable corner badge spec.
 *
 * Pure & deterministic: same inputs → same signature. No I/O.
 */

export const WATERMARK_VERSION = 1 as const;
export const WATERMARK_TAG = "Made with Lumina" as const;

export interface SmartWatermark {
  readonly version: typeof WATERMARK_VERSION;
  readonly tag: typeof WATERMARK_TAG;
  /** Hex-encoded deterministic signature: hash(videoId|creatorKey|version). */
  readonly signature: string;
  readonly visibleGlyph: {
    readonly text: string;
    readonly corner: "bottom-right" | "bottom-left";
    readonly opacity: number;
  };
  /** Sidecar manifest written into the .mp4 metadata atom. */
  readonly sidecar: Readonly<Record<string, string>>;
}

export interface WatermarkInput {
  readonly video: Pick<RenderedVideo, "id" | "filePath" | "durationSec">;
  /** Stable per-creator key — derived once from the StyleTwin during Sprint 1
   * onboarding. In Sprint 3 we pass the Twin's first timbre coefficient as a
   * cheap proxy until the Sprint 5 production-keys flow lands. */
  readonly creatorKey: string;
}

export function watermark(input: WatermarkInput): SmartWatermark {
  const sig = sigHex(`${input.video.id}|${input.creatorKey}|v${WATERMARK_VERSION}`);
  return {
    version: WATERMARK_VERSION,
    tag: WATERMARK_TAG,
    signature: sig,
    visibleGlyph: {
      text: WATERMARK_TAG,
      corner: "bottom-right",
      opacity: 0.55,
    },
    sidecar: {
      "lumina:tag": WATERMARK_TAG,
      "lumina:version": String(WATERMARK_VERSION),
      "lumina:signature": sig,
      "lumina:videoId": input.video.id,
      "lumina:durationSec": input.video.durationSec.toFixed(1),
    },
  };
}

/** Inverse: extract a watermark from a sidecar manifest. Returns null if absent. */
export function readWatermark(sidecar: Readonly<Record<string, string>>): SmartWatermark | null {
  if (sidecar["lumina:tag"] !== WATERMARK_TAG) return null;
  if (sidecar["lumina:version"] !== String(WATERMARK_VERSION)) return null;
  const sig = sidecar["lumina:signature"];
  const videoId = sidecar["lumina:videoId"];
  const durationSec = Number(sidecar["lumina:durationSec"]);
  if (!sig || !videoId || !Number.isFinite(durationSec)) return null;
  return {
    version: WATERMARK_VERSION,
    tag: WATERMARK_TAG,
    signature: sig,
    visibleGlyph: {
      text: WATERMARK_TAG,
      corner: "bottom-right",
      opacity: 0.55,
    },
    sidecar,
  };
}

function sigHex(s: string): string {
  // FNV-1a 32-bit mixed twice for a 64-bit-flavoured deterministic ID.
  const a = fnv1a(s);
  const b = fnv1a(s + "#twist");
  return (toHex8(a) + toHex8(b));
}

function fnv1a(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function toHex8(n: number): string {
  return n.toString(16).padStart(8, "0");
}
