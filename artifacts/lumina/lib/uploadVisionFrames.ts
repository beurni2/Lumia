/**
 * uploadVisionFrames — fire-and-forget POST of on-device thumbnail
 * frames to `/api/imported-videos/:id/vision-frames` for the
 * Llama 3.2 Vision style-extraction layer.
 *
 * Critical-path posture (LOAD-BEARING — do not change without
 * revisiting the spec): vision-style extraction is a soft
 * personalisation enhancement, NOT a feature the user is waiting on.
 * Callers must invoke this with `void uploadVisionFrames(...)` and
 * never await it. All errors (network, HTTP non-2xx, malformed
 * response, frame-extract failure, web no-op) are swallowed; the
 * worst case is the creator gets the same idea quality as a
 * brand-new account, which is already a fully supported state.
 *
 * Mirrors the shape of `submitIdeatorSignal` in `lib/ideatorSignal.ts`.
 */

import { customFetch } from "@workspace/api-client-react";

import { extractFrames } from "./extractVideoFrames";

/**
 * Sample frames on-device and POST them to the vision endpoint.
 * Returns `Promise<void>` for type clarity, but callers MUST NOT
 * await it (see the critical-path posture comment above).
 */
export function uploadVisionFrames(
  importedVideoId: string,
  uri: string,
  durationSec: number | null,
): void {
  void (async () => {
    try {
      if (!importedVideoId || !uri) return;
      const frames = await extractFrames(uri, durationSec);
      if (frames.length === 0) {
        // Either web (no-op) or every sample failed. Either way,
        // nothing to send. The server endpoint requires `min(1)` so
        // we'd just get a 400.
        return;
      }
      await customFetch(
        `/api/imported-videos/${encodeURIComponent(importedVideoId)}/vision-frames`,
        {
          method: "POST",
          body: JSON.stringify({ frames }),
        },
      );
    } catch (err) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.warn(
          "[uploadVisionFrames] upload failed (non-fatal)",
          err,
        );
      }
    }
  })();
}
