/**
 * yesSwipeCounter — tracks the lifetime count of "Yes" verdicts
 * on Home so the feedback-loop toast can fire at meaningful
 * milestones rather than after every single accept.
 *
 * Single AsyncStorage int keyed by `lumina:yesSwipeCount`. A
 * tiny in-memory cache fronts AsyncStorage so the read on the
 * happy path doesn't cost a round-trip to the JS bridge each
 * time the user taps Yes.
 *
 * Milestone schedule is deliberately sparse — 3, 7, 15, 30, …
 * — so the toast feels like a small reward at growing
 * intervals, not a slot-machine ping every tap. The schedule
 * is centralised here so call sites can stay one-line.
 *
 * Web-safe: `@react-native-async-storage/async-storage` already
 * polyfills to localStorage on web, no platform branching.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "lumina:yesSwipeCount";

/**
 * Sparse milestone ladder. The first toast fires on the 3rd
 * lifetime YES (enough to be a real signal, not a fluke), then
 * intervals grow so the user isn't desensitised. Beyond 30 we
 * stop firing — the loop has been reinforced; further reminders
 * become noise.
 */
const MILESTONES: readonly number[] = [3, 7, 15, 30];

let memoCount: number | null = null;

// Single-writer queue. Every read+write goes through this chain
// so two concurrent `recordYesSwipe()` calls (e.g. the user
// rapid-tapping YES on idea 1 and idea 2 within the same render
// tick) can't both observe the same `prev` value and both
// compute the same `next` — which would lose a count AND
// double-fire a milestone toast. JS's single-threaded event loop
// means awaiting `opLock` before the read+write block guarantees
// strict serialisation.
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

async function readCountUnlocked(): Promise<number> {
  if (memoCount !== null) return memoCount;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
    memoCount = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    memoCount = 0;
  }
  return memoCount;
}

async function writeCountUnlocked(next: number): Promise<void> {
  memoCount = next;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    /* swallow — non-critical UX surface */
  }
}

/**
 * Increments the counter and reports whether the new value lands
 * on a milestone. Returns the new count too so callers can use
 * it for analytics or for choosing copy variants.
 *
 * Concurrency: the read+increment+write block runs under
 * `withLock`, so simultaneous calls (rapid multi-card YES) are
 * strictly serialised — each call sees the result of the
 * previous, no double-milestone, no lost updates.
 *
 * Idempotency note: this is best-effort, NOT exactly-once.
 * Submitted feedback is debounced upstream by IdeaFeedback's
 * `inFlightRef`, so a double-tap on the SAME pill won't bump
 * twice. A crash between read and write will under-count by 1
 * — acceptable for a UX-only counter.
 */
export async function recordYesSwipe(): Promise<{
  count: number;
  hitMilestone: boolean;
}> {
  return withLock(async () => {
    const prev = await readCountUnlocked();
    const next = prev + 1;
    await writeCountUnlocked(next);
    return { count: next, hitMilestone: MILESTONES.includes(next) };
  });
}

/**
 * Read-only peek used by surfaces that want to know "has this
 * user ever YES'd anything?" — gates the return-session signal
 * AND the personalized header titles on Home. No write; runs
 * under the same lock so it can't observe a torn state mid-write.
 */
export async function getYesSwipeCount(): Promise<number> {
  return withLock(() => readCountUnlocked());
}

/** Test-only — wipes the in-memory + persisted counter. */
export async function __resetYesSwipeCounter(): Promise<void> {
  await withLock(async () => {
    memoCount = 0;
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {
      /* swallow */
    }
  });
}
