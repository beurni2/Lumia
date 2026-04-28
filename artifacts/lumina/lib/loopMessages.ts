/**
 * loopMessages — copy banks for the "you taught me, I improved"
 * feedback loop. Pure data, zero side effects.
 *
 * The product surface is small but high-impact: short, plain,
 * first-person micro-copy that reinforces the felt sense that
 * the app is learning. We rotate variants so it doesn't feel
 * stamped-out.
 *
 * Selection is deterministic per UTC day (rotateDaily) when we
 * want the user to see one consistent line per session, and
 * random (rotateRandom) for ephemeral toasts where repeat
 * exposure within a session is fine.
 *
 * Constraint: every line MUST be true at the moment it's shown.
 * Don't put copy here that implies an action the app hasn't
 * actually taken — call sites are responsible for gating.
 */

/** Cold-start-safe header titles for users with no learning
 *  signal yet. Every line here is true on day 1 — it describes
 *  the day's batch, not a learned adaptation. Selecting from
 *  this pool when the user has zero YES history avoids the
 *  false-positive "I learned" claim that would otherwise read
 *  as a lie ("Built from what you liked." with no likes yet). */
export const HOME_HEADER_TITLES_NEUTRAL: readonly string[] = [
  "Your three ideas.",
  "Three ideas for today.",
  "Today's three.",
];

/** Personalized header titles for users with at least one YES
 *  on record — these explicitly claim adaptation, so they MUST
 *  only render once the underlying signal exists. Call sites
 *  are responsible for the gate (Home checks yesSwipeCount > 0). */
export const HOME_HEADER_TITLES_PERSONALIZED: readonly string[] = [
  "Sharper ideas for you.",
  "Built from what you liked.",
  "Adjusted to your style.",
  "Tuned for you today.",
];

/** Subtitle shown ONCE per UTC day on the first Home view of a
 *  returning user (one who has prior signal — gated by the call
 *  site, not here). Kept calm and matter-of-fact. */
export const RETURN_SESSION_SIGNAL = "I adjusted your ideas.";

/** Small ephemeral message shown after the user accepts (YES'd)
 *  enough ideas to be a meaningful signal — every Nth YES,
 *  decided by yesSwipeCounter. */
export const POST_YES_MESSAGES: readonly string[] = [
  "That worked. I'll refine your next ideas.",
  "I'm learning your style.",
  "Next batch will be sharper.",
  "Got it — more like that.",
];

/** Small ephemeral message after a successful gallery export. */
export const POST_EXPORT_MESSAGES: readonly string[] = [
  "Saved. I'll bias toward what you ship.",
  "Got it — I'll learn from this one.",
  "Noted. Your next ideas will lean this way.",
];

/** Studio "Your Creator Style" — single line shown when the
 *  creator has actual signal (sampleSize > 0). Don't show this
 *  to a fresh creator with zero feedback — it would be a lie. */
export const STUDIO_EVOLVING_LINE = "Your style is evolving.";

/* ----------------------------------------------------------------
 * Selection helpers — deterministic + random.
 * ---------------------------------------------------------------- */

/** Deterministic UTC-day-stable rotation. Returns the same item
 *  for the same `(items, dayKey)` pair so a user who reloads the
 *  Home tab three times in one day sees the same header. The
 *  caller passes a `dayKey` (typically `utcDateKey()`) so this
 *  helper stays pure and trivially testable. */
export function rotateDaily<T>(items: readonly T[], dayKey: string): T {
  if (items.length === 0) {
    throw new Error("rotateDaily: items must not be empty");
  }
  let h = 0;
  for (let i = 0; i < dayKey.length; i++) {
    h = (h * 31 + dayKey.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(h) % items.length;
  return items[idx]!;
}

/** Random pick for ephemeral surfaces (toasts) where seeing two
 *  different variants within a session is fine. */
export function rotateRandom<T>(items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error("rotateRandom: items must not be empty");
  }
  const idx = Math.floor(Math.random() * items.length);
  return items[idx]!;
}

/** YYYY-MM-DD UTC, stable across the current calendar day. */
export function utcDateKey(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Generic "show this once per UTC day" gate backed by
 *  AsyncStorage. Returns true on the first call of a new UTC
 *  day for the given key, then false for the rest of that day.
 *  Used by the Home return-session subtitle so the "I adjusted
 *  your ideas" line lands once per session-day, not on every
 *  re-render of the tab. Imports inline to keep this module
 *  side-effect free at top level. */
export async function shouldShowOncePerDay(key: string): Promise<boolean> {
  const AsyncStorage = (
    await import("@react-native-async-storage/async-storage")
  ).default;
  const today = utcDateKey();
  const storageKey = `lumina:oncePerDay:${key}`;
  try {
    const last = await AsyncStorage.getItem(storageKey);
    if (last === today) return false;
    await AsyncStorage.setItem(storageKey, today);
    return true;
  } catch {
    // On storage failure, fail closed — don't pester the user
    // with a banner we can't suppress later.
    return false;
  }
}
