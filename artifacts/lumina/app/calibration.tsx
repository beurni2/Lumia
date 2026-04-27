/**
 * /calibration — full-screen interrupt that hosts the Taste
 * Calibration screen for users who already finished onboarding
 * but never filled it out (or QA users who reset it via the
 * Profile dev tools).
 *
 * Routing rules:
 *   • Home (`app/(tabs)/index.tsx`) pushes here on mount when
 *     `needsCalibration(cal) || shouldForceCalibration()`.
 *   • The screen has its own "Skip for now" button so the user can
 *     always escape — that's the "do not block main flow" rule.
 *   • On Save / Skip we `router.replace("/(tabs)")` so the user
 *     can't navigate back into the calibration screen via the back
 *     stack (Skip is the only "no thanks" path).
 *   • Registered with `presentation: "modal"` and
 *     `gestureEnabled: false` in `_layout.tsx` — the gesture lock
 *     prevents an iOS swipe-back from dismissing without saving or
 *     skipping (which would leave the trigger stuck in a re-prompt
 *     loop on every Home mount).
 *
 * The component itself (`<TasteCalibration />`) handles its own POST
 * via fire-and-forget, so this route never awaits the network — same
 * pattern as the onboarding step.
 */

import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useCallback } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TasteCalibration } from "@/components/onboarding/TasteCalibration";
import { cosmic } from "@/constants/colors";

export default function CalibrationModal() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const topInset = isWeb ? 28 : insets.top + 12;
  const bottomInset = isWeb ? 32 : insets.bottom + 32;

  const handleDone = useCallback(() => {
    // Replace, not back — back would put the user on Home with the
    // gate still firing in StrictMode-style double-mount, which can
    // re-push the modal. Replace cleanly hands off to /(tabs).
    router.replace("/(tabs)");
  }, [router]);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={{
          paddingTop: topInset,
          paddingBottom: bottomInset,
          paddingHorizontal: 22,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <TasteCalibration onComplete={handleDone} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: cosmic.voidTop,
  },
});
