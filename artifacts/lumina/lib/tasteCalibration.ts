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

export type PreferredFormat = "mini_story" | "reaction" | "pov" | "mixed";
export type PreferredTone =
  | "dry_subtle"
  | "chaotic"
  | "bold"
  | "self_aware";
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
  | "contrast_hook";

export type TasteCalibration = {
  preferredFormats: PreferredFormat[];
  preferredTone: PreferredTone | null;
  effortPreference: EffortPreference | null;
  privacyAvoidances: PrivacyAvoidance[];
  preferredHookStyles: PreferredHookStyle[];
  completedAt: string | null;
  skipped: boolean;
};

export type CalibrationResponse = {
  calibration: TasteCalibration | null;
};

export const EMPTY_CALIBRATION: TasteCalibration = {
  preferredFormats: [],
  preferredTone: null,
  effortPreference: null,
  privacyAvoidances: [],
  preferredHookStyles: [],
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
 * QA / dev-only — wipe the calibration document on the server back
 * to NULL so the next Home load re-triggers the prompt. Used by the
 * Profile-tab "Reset taste calibration" action (visible only in
 * dev / QA mode). Returns null on success.
 *
 * Also clears any active suppression window so the very next Home
 * focus is guaranteed to re-prompt — without this, a user who just
 * skipped (which sets a 5s suppression) and then immediately tapped
 * the dev reset would have to wait for the window to elapse before
 * the gate fired again.
 */
export async function resetTasteCalibration(): Promise<null> {
  await customFetch<CalibrationResponse>("/api/taste-calibration", {
    method: "DELETE",
  });
  clearCalibrationGateSuppression();
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
