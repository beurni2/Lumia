/**
 * Mobile-side types + API client for the optional Taste Calibration
 * step (5 tap-only preference questions surfaced after the Style
 * Profile reveal on first onboarding). Mirrors the schema in
 * `artifacts/api-server/src/lib/tasteCalibration.ts`. The two files
 * MUST stay in sync — the server zod-validates the POST body so a
 * drift here would surface as a 400 invalid_body, not silent
 * corruption.
 */

import { customFetch } from "@workspace/api-client-react";

import {
  clearHasCompletedTasteOnboardingForStaleRefresh,
  getLastTasteOnboardingCompletedAtMs,
  resetTasteOnboarding,
} from "@/lib/tasteOnboardingState";

export type PreferredFormat = "mini_story" | "reaction" | "pov" | "mixed";
export type PreferredTone =
  | "dry_subtle"
  | "chaotic"
  | "bold"
  | "self_aware"
  // PHASE Z5.8 — fifth tone option mirrors server enum.
  | "high_energy_rant";
export type EffortPreference = "zero_effort" | "low_effort" | "structured";
export type PrivacyAvoidance =
  | "avoid_messages"
  | "avoid_finance"
  | "avoid_people"
  | "avoid_private_info"
  | "no_privacy_limits";
export type PreferredHookStyle =
  | "behavior_hook"
  | "thought_hook"
  | "curiosity_hook"
  | "contrast_hook"
  // PHASE Z5.8 — fifth opener option mirrors server enum.
  | "pov_hook";

// PHASE Z5.8 — six situation / topic-lane buckets surfaced on the
// new third Quick Tune screen. Mirrors `situationEnum` on the
// server. Persisted on the JSONB doc; downstream ideator
// consumption is not yet wired up.
export type Situation =
  | "food_home"
  | "dating_texting"
  | "work_school"
  | "social_awkwardness"
  | "health_wellness"
  | "creator_social";

export type TasteCalibration = {
  preferredFormats: PreferredFormat[];
  // PHASE Z4 — `preferredTone` is the SCALAR back-compat mirror;
  // server normalizes it to `preferredTones[0] ?? null` on every
  // save so existing server consumers (which read the scalar) stay
  // unchanged. UI source-of-truth is `preferredTones`.
  preferredTone: PreferredTone | null;
  preferredTones: PreferredTone[];
  effortPreference: EffortPreference | null;
  privacyAvoidances: PrivacyAvoidance[];
  preferredHookStyles: PreferredHookStyle[];
  // PHASE Z5.8 — required topic-lane multi-select (≤4). Persisted
  // additively; the server's zod schema defaults missing fields to
  // [] so older client payloads still accept on save.
  selectedSituations: Situation[];
  completedAt: string | null;
  skipped: boolean;
};

export type CalibrationResponse = {
  calibration: TasteCalibration | null;
};

export const EMPTY_CALIBRATION: TasteCalibration = {
  preferredFormats: [],
  preferredTone: null,
  preferredTones: [],
  effortPreference: null,
  privacyAvoidances: [],
  preferredHookStyles: [],
  selectedSituations: [],
  completedAt: null,
  skipped: false,
};

export async function fetchTasteCalibration(): Promise<TasteCalibration | null> {
  const res = await customFetch<CalibrationResponse>("/api/taste-calibration");
  return res.calibration;
}

export async function saveTasteCalibration(
  doc: TasteCalibration,
): Promise<TasteCalibration | null> {
  const res = await customFetch<CalibrationResponse>(
    "/api/taste-calibration",
    {
      method: "POST",
      body: JSON.stringify(doc),
    },
  );
  return res.calibration;
}

export async function skipTasteCalibration(): Promise<TasteCalibration | null> {
  return saveTasteCalibration({ ...EMPTY_CALIBRATION, skipped: true });
}

/**
 * QA / dev-only — wipe BOTH the server calibration doc AND the
 * client-side onboarding state (hasCompletedTasteOnboarding flag +
 * ideasViewedCount counter) so the next Home focus re-evaluates
 * from a fresh-install state. Backs the Profile-tab "reset
 * onboarding" action (visible only in dev / QA mode).
 *
 * Also clears any active suppression window AND the once-per-process
 * prompt latch — without those clears, a user who just skipped
 * (which arms both guards) and then immediately tapped the dev
 * reset would still see the Home gate quietly no-op on the next
 * focus, leaving the dev affordance feeling broken.
 *
 * Returns null on success (kept for backward compat with the few
 * callers that destructured the old return shape).
 */
export async function resetTasteCalibration(): Promise<null> {
  await customFetch<CalibrationResponse>("/api/taste-calibration", {
    method: "DELETE",
  });
  // Local flag + counter are the authoritative gate inputs after
  // the daily-habit rework — wiping the server doc alone is no
  // longer sufficient to re-trigger the prompt. Run before the
  // suppression / latch clears so the next focus sees a fully
  // fresh state, never a half-reset.
  await resetTasteOnboarding();
  clearCalibrationGateSuppression();
  clearCalibrationPromptedThisProcess();
  return null;
}

/* ----------------------------------------------------------------- */
/* Calibration-gate suppression                                      */
/* ----------------------------------------------------------------- */

/**
 * Short-lived in-memory window that tells the Home calibration gate
 * to skip its server fetch. Needed because Save / Skip on the
 * <TasteCalibration /> screen fire the POST as fire-and-forget and
 * navigate back to /(tabs) immediately — on a slow network the
 * server can still report `null` (or the old stale doc) when Home
 * regains focus, which would re-push the modal in a tight loop and
 * break the "immediate skip lets the user proceed" rule.
 *
 * Lives in module scope (not React state) on purpose:
 *   • Survives the unmount-of-/calibration → focus-of-/(tabs)
 *     transition without needing a context or AsyncStorage round-trip.
 *   • Cheap and synchronous — the gate's first check is a single
 *     Date.now() compare with no I/O.
 *   • Process-lifetime only — a real browser reload clears it, which
 *     is the right behaviour: a reload should re-evaluate from the
 *     server, not a stale 5-second-old skip intent.
 *
 * Tunable via `ms` so callers can pick a window appropriate to the
 * trip they just made (default 5 s covers a 1 RTT POST + GET on a
 * slow mobile connection; the QA reset in `resetTasteCalibration`
 * clears it to 0 so the next focus re-prompts immediately).
 */
let calibrationGateSuppressedUntilMs = 0;

export function suppressCalibrationGate(ms: number = 5000): void {
  calibrationGateSuppressedUntilMs = Date.now() + ms;
}

export function isCalibrationGateSuppressed(): boolean {
  return Date.now() < calibrationGateSuppressedUntilMs;
}

export function clearCalibrationGateSuppression(): void {
  calibrationGateSuppressedUntilMs = 0;
}

/* ----------------------------------------------------------------- */
/* Once-per-process prompt latch                                     */
/* ----------------------------------------------------------------- */

/**
 * Companion latch to the suppression window. Where the suppression
 * window is short-lived (5 s) and exists to swallow the immediate
 * Skip → Home re-focus race, this latch is process-lifetime and
 * exists to ensure that a user who skips the calibration prompt is
 * not re-prompted by every subsequent Home focus until the JS
 * process restarts (cold reload). Cold reload + dev reset are the
 * only two ways to clear it.
 *
 * Lives here (rather than in app/(tabs)/index.tsx) so the dev-only
 * `resetTasteCalibration` flow can clear it without reaching across
 * the module boundary into a screen file. Centralising both gate
 * guards in this module keeps the contract auditable.
 */
let calibrationPromptedThisProcess = false;

export function isCalibrationPromptedThisProcess(): boolean {
  return calibrationPromptedThisProcess;
}

export function markCalibrationPromptedThisProcess(): void {
  calibrationPromptedThisProcess = true;
}

export function clearCalibrationPromptedThisProcess(): void {
  calibrationPromptedThisProcess = false;
}

/**
 * Authoritative trigger predicate — used by BOTH the Home-load gate
 * (for already-onboarded users who never saw the prompt) AND
 * MvpOnboarding's "Open Lumina" handler (for new users mid-flow), so
 * the two paths can never disagree about who should see the screen.
 *
 * The rule (from the spec):
 *   needsCalibration ⇔ (no document on file)
 *                   OR (a document exists but `completedAt` is null
 *                       AND `skipped` is not true)
 *
 * The second branch covers the rare half-state where a save started
 * but the server never stamped completedAt (shouldn't happen in
 * practice — the POST handler always stamps — but defending against
 * it makes the predicate robust to schema drift).
 */
export function needsCalibration(cal: TasteCalibration | null): boolean {
  if (!cal) return true;
  if (cal.skipped === true) return false;
  if (cal.completedAt) return false;
  return true;
}

/* ----------------------------------------------------------------- */
/* Calibration staleness — refresh-prompt resurface                  */
/* ----------------------------------------------------------------- */

/**
 * PHASE Y13 — staleness threshold for the "refresh your taste
 * calibration" prompt. Mirrors the server-side constant in
 * `artifacts/api-server/src/lib/tasteCalibration.ts` so client gate
 * and any future server job apply the same window.
 *
 * PHASE Y14 — tightened 90 → 30 days. The Y13 90-day window was a
 * conservative first pass; field feedback showed creator taste
 * materially shifts on a much shorter cycle (a single content-
 * format A/B run, a tone-pivot week, a niche change). 30 days
 * catches drift while the EXPLICIT pin (preferredTone, hookStyles)
 * still matters for `resolveVoiceCluster`'s hard short-circuit,
 * which the implicit memory cannot overwrite. The behavior gate
 * (count >= 2 ideas viewed + once-per-process latch) keeps the
 * prompt from feeling pushy at the new tighter cadence.
 */
export const CALIBRATION_STALE_DAYS = 30;

/**
 * Pure predicate — true when the document is a COMPLETED (non-
 * skipped) calibration whose `completedAt` is older than
 * `staleDays`. Returns false for null/missing/skipped/half-state
 * docs (those are handled by `needsCalibration`, not this gate).
 */
export function isCalibrationStale(
  cal: TasteCalibration | null,
  staleDays: number = CALIBRATION_STALE_DAYS,
  now: Date = new Date(),
): boolean {
  if (!cal) return false;
  if (cal.skipped) return false;
  if (!cal.completedAt) return false;
  const completed = Date.parse(cal.completedAt);
  if (!Number.isFinite(completed)) return false;
  const ageMs = now.getTime() - completed;
  const staleMs = staleDays * 24 * 60 * 60 * 1000;
  return ageMs > staleMs;
}

/* ----------------------------------------------------------------- */
/* Once-per-process stale-check latch                                */
/* ----------------------------------------------------------------- */

/**
 * One-shot gate so `runStaleCalibrationCheck()` performs at most
 * one network fetch + one local-flag reset per JS process. The
 * staleness window is measured in days; checking it once per cold
 * start is more than sufficient and keeps Home's mount path free
 * of a recurring server round-trip.
 */
let staleCheckRanThisProcess = false;

export function clearStaleCheckLatchForTests(): void {
  staleCheckRanThisProcess = false;
}

/**
 * PHASE Y13 — refresh-prompt resurface helper.
 *
 * Idempotent, fail-open. Call once at app/Home cold start. If the
 * server-side calibration doc is stale (completed > N days ago and
 * not skipped), wipes the LOCAL `hasCompletedTasteOnboarding`
 * sticky flag so the existing Home gate (which keys off that flag
 * + ideasViewedCount) re-fires the calibration modal naturally on
 * the next behaviour trigger.
 *
 * Why reset the local flag instead of pushing the modal directly:
 *   • The Home gate already enforces the "wait until the user has
 *     seen ≥2 ideas" behaviour rule. Pushing the modal directly
 *     here would fire on EVERY cold start regardless of whether
 *     the user just opened the app — too aggressive.
 *   • Resetting the local flag lets the existing trigger machinery
 *     (focus + dwell + scroll counters, suppression window, once-
 *     per-process latch) handle the prompt the same way it handles
 *     a first-time user. One code path, one set of guards.
 *
 * Why a once-per-process latch:
 *   • Staleness is measured in DAYS — checking more than once per
 *     cold start is wasted work.
 *   • A second fetch on the same process would re-reset the flag
 *     after the user just completed the refresh, undoing the
 *     `markTasteOnboardingCompleted` write from <TasteCalibration />.
 *
 * Errors are swallowed — the next cold start retries.
 */
export async function runStaleCalibrationCheck(): Promise<void> {
  if (staleCheckRanThisProcess) return;
  staleCheckRanThisProcess = true;
  // Capture a same-process timestamp BEFORE the network fetch so
  // we can detect a concurrent local completion that lands while
  // the fetch is in flight. See lost-update guard below.
  const checkStartedAtMs = Date.now();
  try {
    const cal = await fetchTasteCalibration();
    if (!isCalibrationStale(cal)) return;
    // PHASE Y13 lost-update guard — `<TasteCalibration />`'s Save
    // path calls `markTasteOnboardingCompleted` BEFORE its
    // fire-and-forget POST hits the server. If the user happened
    // to open /calibration via deep-link, MvpOnboarding, or the
    // Profile dev tool DURING this fetch's round-trip and saved
    // before our response landed, the local flag is now true and
    // the local mirror timestamp is newer than `checkStartedAtMs`
    // — even though the SERVER doc we just fetched still shows
    // the old `completedAt` (the POST hasn't propagated yet, or
    // is still in flight). Without this guard, we'd silently flip
    // the freshly-set local flag back to false and trigger a
    // re-prompt on the next behaviour beat — undoing the user's
    // just-completed calibration. Skipping the wipe in this case
    // is the safe choice: the cal IS now fresh; the next cold
    // start will re-evaluate against the propagated server doc.
    const lastLocalCompletedAtMs = await getLastTasteOnboardingCompletedAtMs();
    if (lastLocalCompletedAtMs > checkStartedAtMs) return;
    // Narrow clear: only the completion flag, NOT the ideas-viewed
    // counter or the pending-* coordination flags. Using
    // `resetTasteOnboarding()` here would (a) zero the counter so
    // a user with 50 dwells already past count≥2 would have to
    // re-accumulate two views before the gate fires, and (b) wipe
    // unrelated visible-adaptation flags that have nothing to do
    // with staleness. The narrow helper keeps surface area honest.
    await clearHasCompletedTasteOnboardingForStaleRefresh();
  } catch {
    // Fail-open — refresh prompt is a soft surface; never block.
  }
}
