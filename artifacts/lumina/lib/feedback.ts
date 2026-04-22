/**
 * Lumina Feedback Layer
 *
 * Single, web-safe entry point for the haptic + sonic delight moments.
 *
 * Why a layer instead of calling expo-haptics directly?
 *   • Centralises the "intent → physical sensation" mapping so the same
 *     gesture always feels the same across the app.
 *   • Web-safe: every entry point silently no-ops when not on a native
 *     device (`Platform.OS === "web"`), so we never throw or pollute logs.
 *   • Sound is a *stub* today — it logs in dev so designers can hear the
 *     intent during reviews, and is wired to be replaced by `expo-av`
 *     ambient loops + one-shots in Phase 6 once the audio assets land.
 *
 * Intent vocabulary (locked to keep app feel coherent):
 *   tap        — generic press, light bump
 *   selection  — picker / segmented / tab change, crisp tick
 *   success    — launch ok, twin trained, light burst
 *   error      — blocked, validation fail
 *   portal     — committing through a CTA — heavier, with a soft chord
 *   spark      — micro-delight (firefly bob, suggestion accept) — feather light
 */

import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

const isNative = Platform.OS !== "web";

type SoundCue = "tap" | "selection" | "success" | "error" | "portal" | "spark";

/** Stub — replaced by expo-av loader in Phase 6 once assets land. */
function playCue(cue: SoundCue) {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log(`[lumina/sound] cue:${cue}`);
  }
}

export const feedback = {
  tap() {
    if (isNative) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    playCue("tap");
  },
  selection() {
    if (isNative) Haptics.selectionAsync();
    playCue("selection");
  },
  success() {
    if (isNative) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    playCue("success");
  },
  error() {
    if (isNative) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    playCue("error");
  },
  portal() {
    if (isNative) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    playCue("portal");
  },
  spark() {
    if (isNative) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
    playCue("spark");
  },
};
