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

/** Locked daily-habit header title — single, fixed, no rotation.
 *  Per the daily-habit spec, the H1 on Home is always exactly
 *  "3 ideas for today." so the user opens the app expecting the
 *  same predictable promise every session. Rotating the title
 *  was found to undermine the felt "my ideas are ready" beat,
 *  so the previous NEUTRAL/PERSONALIZED pools were retired. */
export const HOME_HEADER_TITLE = "3 ideas for today";

/** Locked daily-habit subtitle — single line, always shown
 *  directly under HOME_HEADER_TITLE. True on day 1 because
 *  onboarding (region pick + Style Twin trainer + calibration)
 *  has already produced a baseline style profile by the time
 *  this screen renders, so the line is not over-claiming. */
export const HOME_HEADER_SUB = "Made for your style";

/** Subtitles shown ONCE per UTC day on the first Home view of a
 *  returning user (one who has prior YES signal — gated by the
 *  call site, not here). Both variants are calm and forward-
 *  looking; they describe today's batch in terms of accumulated
 *  taste signal. The call site uses rotateDaily so a user who
 *  reloads Home three times in one day sees the same line, but
 *  day-to-day they see variety. Both lines require prior YES
 *  history to be true; first-time visitors see neither. */
export const RETURN_SESSION_SIGNALS: readonly string[] = [
  "Today's ideas are sharper",
  "New ideas that match your style",
];

/** Small ephemeral message shown after the user accepts (YES'd)
 *  enough ideas to be a meaningful signal — every Nth YES,
 *  decided by yesSwipeCounter. */
export const POST_YES_MESSAGES: readonly string[] = [
  "That worked. I'll refine your next ideas.",
  "I'm learning your style.",
  "Next batch will be sharper.",
  "Got it — more like that.",
];

/** Single locked message shown after a successful gallery export.
 *  Per the daily-habit spec, the post-action confirmation pairs
 *  a present-tense acknowledgement with a forward-looking promise
 *  to keep the loop reinforcing without introducing streaks or
 *  scoring. Rendered as two lines inside one toast bubble — the
 *  InlineToast's <Text> respects the literal newline. */
export const POST_EXPORT_MESSAGE =
  "Nice — that works.\nNext one will be even faster.";

/** Single notification copy line. The daily-habit spec carves
 *  out exactly ONE notification type — a low-noise "your three
 *  are ready" ping — and forbids streaks, gamification, or any
 *  other push surface. The actual local-notification scheduling
 *  module is intentionally NOT wired today (Lumina has no
 *  expo-notifications dependency yet, and adding it requires
 *  native config + a permission UX) — but the copy lives here
 *  in one place so the eventual wiring is a one-line import,
 *  not a copy decision. Until then, this constant is referenced
 *  only by docs and tests. */
export const NOTIFICATION_DAILY_READY = "Your ideas for today are ready";

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
