/**
 * Per-idea creator feedback ("Would you post this? Yes / Maybe / No").
 *
 * Two responsibilities:
 *   1. POST the verdict (and optional reason) to the server, fire-
 *      and-forget — the UI optimistically marks "thanks" as soon as
 *      the user taps, so a network blip never makes them vote twice.
 *   2. Cache the local verdict so a re-mount of the Home feed
 *      doesn't re-prompt the user on an idea they already voted on.
 *
 * The natural identifier is the idea's `hook` text (truncated for
 * key safety). The ideator response is transient — there's no
 * server-side stable id we could key on — so the client and server
 * both use the hook as the identifier. This means re-prompting
 * across days is impossible by construction (a new day yields a
 * fresh batch of hooks).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { customFetch } from "@workspace/api-client-react";

export type IdeaVerdict = "yes" | "maybe" | "no";

export type SubmitFeedbackInput = {
  ideaHook: string;
  verdict: IdeaVerdict;
  reason?: string;
  region?: string;
  ideaCaption?: string;
  ideaPayoffType?: string;
};

const KEY_PREFIX = "lumina:idea-feedback:v1:";

// Truncate hooks to a safe AsyncStorage key length. Any two ideas
// with the same first 80 chars will collide, but ideator hooks are
// capped at ≤8 words by prompt rules (~50 chars typical) so this
// is comfortably above the natural ceiling.
function keyFor(ideaHook: string): string {
  return `${KEY_PREFIX}${ideaHook.trim().slice(0, 80)}`;
}

export async function getLocalVerdict(
  ideaHook: string,
): Promise<IdeaVerdict | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(ideaHook));
    if (raw === "yes" || raw === "maybe" || raw === "no") return raw;
    return null;
  } catch {
    return null;
  }
}

export async function setLocalVerdict(
  ideaHook: string,
  verdict: IdeaVerdict,
): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(ideaHook), verdict);
  } catch {
    // Best-effort — worst case the user gets re-prompted on next
    // mount and we simply re-record the same verdict server-side.
  }
}

/**
 * Fire-and-forget POST. Caller is expected to have already updated
 * local state + cached the verdict optimistically; this just sends
 * the signal to the server. Network/5xx failures log to the dev
 * console but never throw, because there is nothing meaningful the
 * UI could do with a failure here — the user already moved on.
 */
export function submitIdeaFeedback(input: SubmitFeedbackInput): void {
  // Intentionally not awaited — the UI doesn't render any spinner
  // for this and we don't want a slow round-trip to leak into the
  // user's perception of how snappy the home feed is.
  void (async () => {
    try {
      await customFetch("/api/ideas/feedback", {
        method: "POST",
        body: JSON.stringify(input),
      });
    } catch (err) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.warn("[ideaFeedback] submit failed (non-fatal)", err);
      }
    }
  })();
}
