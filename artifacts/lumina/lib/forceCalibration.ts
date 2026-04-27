/**
 * Dev / QA override for forcing the Taste Calibration prompt to
 * surface even when the creator already has a calibration document
 * on file. Two activation paths, both gated by `__DEV__` so a
 * production build can never be tricked into re-prompting:
 *
 *   1. URL query param `?forceCalibration=1` (web only — handy for
 *      quickly re-testing the trigger from a browser without
 *      touching the database).
 *   2. Build-time env var `EXPO_PUBLIC_FORCE_CALIBRATION=true` (all
 *      platforms — useful when iterating on the screen itself in
 *      a dev client without burning DB resets).
 *
 * When either fires, the Home-load gate routes to /calibration even
 * if the creator already saved or skipped previously. The screen
 * itself still POSTs on Save / Skip so the next launch (without
 * the override) returns to the normal "don't re-prompt" behaviour.
 */

import { Platform } from "react-native";

export function shouldForceCalibration(): boolean {
  if (!__DEV__) return false;

  if (process.env.EXPO_PUBLIC_FORCE_CALIBRATION === "true") {
    return true;
  }

  if (Platform.OS === "web" && typeof window !== "undefined") {
    try {
      const params = new URLSearchParams(window.location.search);
      const v = params.get("forceCalibration");
      if (v === "1" || v === "true") return true;
    } catch {
      // Defensive: SSR / sandboxed iframe with no `URLSearchParams`
      // shouldn't crash the app — just fall through to the env-var
      // path above.
    }
  }
  return false;
}
