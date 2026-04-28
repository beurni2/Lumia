/**
 * tasteOnboardingState — local-state machine for the Quick Tune
 * (taste-onboarding) trigger.
 *
 * Why this lives client-side and not on the server:
 *   The server already stores a `taste_calibration_json` document
 *   (see `creators` table + `lib/tasteCalibration.ts`) that drives
 *   the ideator's INITIAL prompt bias. That doc is the right place
 *   for "what did the user actually answer". It is the WRONG place
 *   for "should we *ask* the user", because the ask is a behaviour-
 *   triggered prompt that depends on how much of the app the user
 *   has actually seen on THIS device — a count that's pure UX state,
 *   not data the ideator needs.
 *
 *   Splitting them this way also lets Skip mean "don't ask me right
 *   now" without permanently muting the prompt: skip just leaves
 *   `hasCompletedTasteOnboarding=false` and the gate re-evaluates
 *   on the next cold start.
 *
 * Two AsyncStorage keys:
 *   • `lumina:hasCompletedTasteOnboarding`  →  "1" once the user
 *     submits the calibration form. Sticky forever afterwards (until
 *     the dev-only reset clears it). Skip does NOT set this.
 *   • `lumina:ideasViewedCount`  →  monotonic int, bumped when the
 *     user dwells on Home with ideas visible OR scrolls past the
 *     first card. Capped at MAX_COUNT to keep the persisted value
 *     small (no functional effect — the gate only checks `>= 2`).
 *
 * Tiny in-memory cache fronts AsyncStorage so the read on the happy
 * path doesn't cost a JS-bridge round-trip on every Home focus. All
 * read+write blocks run under `withLock` so two concurrent
 * `incrementIdeasViewedCount` calls (e.g. dwell timer firing in the
 * same tick as a scroll past the first card) are strictly
 * serialised — same pattern as `lib/yesSwipeCounter.ts`, picked for
 * the same reason: a torn read+write loses a count and could prevent
 * the threshold from ever being reached.
 *
 * Web-safe: `@react-native-async-storage/async-storage` polyfills to
 * localStorage on web, no platform branching needed.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_HAS_COMPLETED = "lumina:hasCompletedTasteOnboarding";
const KEY_IDEAS_VIEWED = "lumina:ideasViewedCount";
// Two single-shot coordination flags used by the visible-adaptation
// flow. Both are "set on save in <TasteCalibration />, consumed on
// next Home focus" — the consumer reads-and-clears atomically inside
// the same lock so a focus race can't run the side effect twice.
//
//   • pendingPostCalibrationRefresh: tells Home "the user just
//     completed Quick Tune, immediately regenerate ideas with the
//     fresh bias and play the 'Updated for you' treatment".
//   • pendingBetterMatchPrompt: armed by Home when the user taps
//     into the create flow during the adapted-treatment window.
//     The next Home focus shows a small Yes/No "Better match?" row.
const KEY_PENDING_POST_CAL_REFRESH = "lumina:pendingPostCalibrationRefresh";
const KEY_PENDING_BETTER_MATCH_PROMPT = "lumina:pendingBetterMatchPrompt";

// Cap the persisted counter at a small number — the gate predicate
// is `>= 2`, so anything beyond ~5 is wasted bytes. Cap also
// protects against a runaway bump loop ever bloating the value.
const MAX_COUNT = 99;

let memoHasCompleted: boolean | null = null;
let memoCount: number | null = null;
// Single-shot coordination flags fronted by AsyncStorage. `null`
// means "not yet read"; `true`/`false` is the cached value. The
// consume helpers flip the memo to `false` synchronously inside
// the lock so re-entrant callers in the same tick see the cleared
// state without waiting for AsyncStorage to settle.
let memoPendingPostCalRefresh: boolean | null = null;
let memoPendingBetterMatchPrompt: boolean | null = null;

// Single-writer queue. Same rationale as `yesSwipeCounter.ts`:
// JS is single-threaded, so awaiting the lock before each
// read+write block guarantees strict serialisation under
// concurrent callers (dwell-timer + scroll-handler firing in
// the same tick is the realistic case here).
let opLock: Promise<void> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = opLock.then(fn, fn);
  // Swallow rejections on the chain so one failed op doesn't
  // poison the lock for every subsequent caller.
  opLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readHasCompletedUnlocked(): Promise<boolean> {
  if (memoHasCompleted !== null) return memoHasCompleted;
  try {
    const raw = await AsyncStorage.getItem(KEY_HAS_COMPLETED);
    memoHasCompleted = raw === "1";
  } catch {
    memoHasCompleted = false;
  }
  return memoHasCompleted;
}

async function readPendingPostCalRefreshUnlocked(): Promise<boolean> {
  if (memoPendingPostCalRefresh !== null) return memoPendingPostCalRefresh;
  try {
    const raw = await AsyncStorage.getItem(KEY_PENDING_POST_CAL_REFRESH);
    memoPendingPostCalRefresh = raw === "1";
  } catch {
    memoPendingPostCalRefresh = false;
  }
  return memoPendingPostCalRefresh;
}

async function readPendingBetterMatchPromptUnlocked(): Promise<boolean> {
  if (memoPendingBetterMatchPrompt !== null) return memoPendingBetterMatchPrompt;
  try {
    const raw = await AsyncStorage.getItem(KEY_PENDING_BETTER_MATCH_PROMPT);
    memoPendingBetterMatchPrompt = raw === "1";
  } catch {
    memoPendingBetterMatchPrompt = false;
  }
  return memoPendingBetterMatchPrompt;
}

async function readCountUnlocked(): Promise<number> {
  if (memoCount !== null) return memoCount;
  try {
    const raw = await AsyncStorage.getItem(KEY_IDEAS_VIEWED);
    const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
    memoCount = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    memoCount = 0;
  }
  return memoCount;
}

/**
 * Has the user completed the Quick Tune (taste calibration) prompt?
 * Skip does NOT count as completion — the gate re-evaluates on the
 * next cold start so the user gets another chance.
 */
export async function getHasCompletedTasteOnboarding(): Promise<boolean> {
  return withLock(() => readHasCompletedUnlocked());
}

/**
 * Mark the Quick Tune as completed. Called from the calibration
 * screen's Save handler (NOT Skip). Idempotent — safe to call more
 * than once.
 */
export async function markTasteOnboardingCompleted(): Promise<void> {
  await withLock(async () => {
    memoHasCompleted = true;
    try {
      await AsyncStorage.setItem(KEY_HAS_COMPLETED, "1");
    } catch {
      /* swallow — non-critical UX surface */
    }
  });
}

/**
 * Read-only peek used by the Home gate. Counts dwells AND scrolls
 * (any "saw an idea" signal). The gate's threshold is `>= 2`.
 */
export async function getIdeasViewedCount(): Promise<number> {
  return withLock(() => readCountUnlocked());
}

/**
 * Increment the ideas-viewed counter and return the new value.
 *
 * Concurrency: the read+increment+write block runs under `withLock`,
 * so simultaneous calls (a dwell timer firing in the same tick as a
 * scroll-past-first-card event) are strictly serialised. Each call
 * sees the result of the previous, so the counter cannot lose an
 * update.
 *
 * Cap: clamped at MAX_COUNT to avoid bloating the persisted value
 * over a long-lived install. The gate only needs `>= 2`, so any
 * value at or above the cap is functionally equivalent.
 */
export async function incrementIdeasViewedCount(): Promise<number> {
  return withLock(async () => {
    const prev = await readCountUnlocked();
    const next = Math.min(prev + 1, MAX_COUNT);
    memoCount = next;
    try {
      await AsyncStorage.setItem(KEY_IDEAS_VIEWED, String(next));
    } catch {
      /* swallow — non-critical UX surface */
    }
    return next;
  });
}

/**
 * Mark that Quick Tune just completed and Home should run the
 * "visible adaptation" path on its next focus: regenerate ideas
 * with the fresh bias, swap the header to "Updated for you", tag
 * cards with "Fits your style". Called from <TasteCalibration />
 * Save (NOT Skip — Skip means "ask me later", we don't claim to
 * have adapted to anything).
 */
export async function markPendingPostCalibrationRefresh(): Promise<void> {
  await withLock(async () => {
    memoPendingPostCalRefresh = true;
    try {
      await AsyncStorage.setItem(KEY_PENDING_POST_CAL_REFRESH, "1");
    } catch {
      /* swallow — UX-only surface */
    }
  });
}

/**
 * Atomic read-and-clear: returns true if the flag was set, and
 * also wipes it in the same lock so a second focus event in the
 * same tick can't re-trigger the regenerate. Returning false on
 * any AsyncStorage error is the right failure mode — we'd rather
 * skip the adapted treatment than fire it twice.
 */
export async function consumePendingPostCalibrationRefresh(): Promise<boolean> {
  return withLock(async () => {
    const wasSet = await readPendingPostCalRefreshUnlocked();
    if (!wasSet) return false;
    memoPendingPostCalRefresh = false;
    try {
      await AsyncStorage.removeItem(KEY_PENDING_POST_CAL_REFRESH);
    } catch {
      /* swallow — UX-only surface */
    }
    return true;
  });
}

/**
 * Arm the "Better match?" micro-feedback prompt. Set when the user
 * taps an idea while the post-cal "Updated for you" treatment is
 * still on screen, consumed when Home regains focus. Idempotent.
 */
export async function markPendingBetterMatchPrompt(): Promise<void> {
  await withLock(async () => {
    memoPendingBetterMatchPrompt = true;
    try {
      await AsyncStorage.setItem(KEY_PENDING_BETTER_MATCH_PROMPT, "1");
    } catch {
      /* swallow — UX-only surface */
    }
  });
}

/**
 * Atomic read-and-clear, same shape as the post-cal-refresh flag.
 */
export async function consumePendingBetterMatchPrompt(): Promise<boolean> {
  return withLock(async () => {
    const wasSet = await readPendingBetterMatchPromptUnlocked();
    if (!wasSet) return false;
    memoPendingBetterMatchPrompt = false;
    try {
      await AsyncStorage.removeItem(KEY_PENDING_BETTER_MATCH_PROMPT);
    } catch {
      /* swallow — UX-only surface */
    }
    return true;
  });
}

/**
 * Dev / QA reset — wipes the completion flag, counter, AND the two
 * single-shot coordination flags back to a fresh-install state.
 * Wired into the Profile-screen "reset onboarding" affordance and
 * into `resetTasteCalibration()` so a single button gives QA a
 * clean slate (otherwise a stale pending-refresh flag could fire
 * an unwanted "Updated for you" treatment on the very next focus
 * after a reset).
 */
export async function resetTasteOnboarding(): Promise<void> {
  await withLock(async () => {
    memoHasCompleted = false;
    memoCount = 0;
    memoPendingPostCalRefresh = false;
    memoPendingBetterMatchPrompt = false;
    try {
      await AsyncStorage.multiRemove([
        KEY_HAS_COMPLETED,
        KEY_IDEAS_VIEWED,
        KEY_PENDING_POST_CAL_REFRESH,
        KEY_PENDING_BETTER_MATCH_PROMPT,
      ]);
    } catch {
      /* swallow */
    }
  });
}
