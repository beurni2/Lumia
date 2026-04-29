/**
 * extractVideoFrames — on-device thumbnail sampler for the
 * Llama 3.2 Vision style-extraction layer.
 *
 * Spec: `attached_assets/Pasted-LLAMA-3-2-VISION-STYLE-EXTRACTION-FROM-USER-VIDEOS-Goal_*.txt`
 *
 * Privacy contract (LOAD-BEARING — do not relax without revisiting
 * the spec):
 *   - The raw video file NEVER leaves the device. Only a small
 *     number of low-quality JPEG thumbnails (sampled in-process via
 *     expo-video-thumbnails) are read as base64 and handed to the
 *     uploader, which POSTs them to our own endpoint. The full clip
 *     stays in the OS-managed picker cache.
 *   - We sample at fractional offsets `[0.15, 0.4, 0.65, 0.9]` of the
 *     known duration, which deliberately skips dead-air at the very
 *     start and end (the model's "what is this person doing?"
 *     classification is much sharper on mid-clip frames). When the
 *     duration is unknown we fall back to fixed wall-clock seconds
 *     `[1, 3, 5, 8]` — same shape, just less precise.
 *   - All errors are swallowed and surface as `[]` so the caller can
 *     no-op silently. Vision-style extraction is an enhancement; it
 *     must never block or fail-loud the import flow.
 *
 * Web QA path: expo-video-thumbnails has no web implementation in
 * Expo SDK 54 (the native module simply isn't there), so we
 * short-circuit on `Platform.OS === "web"`. The web QA harness
 * exercises the upload helper itself with pre-supplied frames; it
 * does not exercise this function.
 */

import { Platform } from "react-native";
import * as VideoThumbnails from "expo-video-thumbnails";
// expo-file-system v19 split the namespace into a new `File`/`Paths`
// object API and a `/legacy` re-export of the old function-style
// surface. The new API is awkward for the "read a one-shot file as
// base64" case (no `.base64()` method on `File`), so we use the
// legacy `readAsStringAsync` which is still shipped and supported
// in SDK 54 (the package's `legacyWarnings` re-export is opt-in via
// a separate import path).
import * as LegacyFs from "expo-file-system/legacy";

/** Fractional offsets used when the clip's duration is known. */
const FRACTIONAL_OFFSETS = [0.15, 0.4, 0.65, 0.9] as const;

/** Wall-clock fallback offsets (seconds) when duration is unknown. */
const WALL_CLOCK_FALLBACK_SEC = [1, 3, 5, 8] as const;

/** Ceiling on the number of frames we will ever sample. The server
 *  enforces this too (max 5 frames per request); keeping the client
 *  cap a touch lower means we never have to deal with a 400 on a
 *  legitimate import. */
const MAX_FRAMES = 4;

/** JPEG quality fed to expo-video-thumbnails. 0.5 keeps each
 *  thumbnail well under the server's 350KB-per-frame guard while
 *  still leaving the model enough fidelity to identify setting,
 *  framing, etc. */
const THUMBNAIL_QUALITY = 0.5;

function clampOffsetsToDuration(
  durationSec: number,
  count: number,
): number[] {
  // Map fractional offsets onto the known duration, in milliseconds.
  // We respect `count` so callers that pass a non-default value get
  // the same fractional spread, just sliced.
  const fractions = FRACTIONAL_OFFSETS.slice(0, Math.min(count, MAX_FRAMES));
  return fractions.map((f) => Math.max(0, Math.round(durationSec * 1000 * f)));
}

function fallbackOffsets(count: number): number[] {
  return WALL_CLOCK_FALLBACK_SEC.slice(0, Math.min(count, MAX_FRAMES)).map(
    (s) => s * 1000,
  );
}

/**
 * Sample up to `count` thumbnail frames from a local video URI and
 * return them as `data:image/jpeg;base64,...` strings ready to POST
 * to `/api/imported-videos/:id/vision-frames`.
 *
 * Always returns an array — `[]` on any failure or on web. Never
 * throws. Callers should treat `[]` as "skip vision for this
 * import" and proceed with the rest of the import flow.
 */
export async function extractFrames(
  uri: string,
  durationSec: number | null,
  count = MAX_FRAMES,
): Promise<string[]> {
  if (Platform.OS === "web") return [];
  if (!uri) return [];

  const offsetsMs =
    typeof durationSec === "number" && durationSec > 0
      ? clampOffsetsToDuration(durationSec, count)
      : fallbackOffsets(count);

  const out: string[] = [];
  for (const time of offsetsMs) {
    try {
      const thumb = await VideoThumbnails.getThumbnailAsync(uri, {
        time,
        quality: THUMBNAIL_QUALITY,
      });
      // The native module writes the JPEG to the cache directory and
      // hands us back a `file://` URI. Read it back as base64 so we
      // can ship it inside a JSON body (the alternative — multipart
      // upload — would force the server to handle a multer pipeline
      // for what is otherwise a tiny request).
      const b64 = await LegacyFs.readAsStringAsync(thumb.uri, {
        encoding: LegacyFs.EncodingType.Base64,
      });
      if (b64 && b64.length > 0) {
        out.push(`data:image/jpeg;base64,${b64}`);
      }
    } catch (err) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.warn(
          "[extractVideoFrames] frame sample failed (non-fatal)",
          { time, err },
        );
      }
      // Don't bail — partial frames are still useful. The aggregator
      // doesn't care if we send 2 instead of 4.
    }
  }
  return out;
}
