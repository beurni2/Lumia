/**
 * InlineToast — small ephemeral message that fades in, sits for
 * a few seconds, then fades out. Used by the "feedback loop"
 * surfaces (post-export, post-multi-YES) to whisper "I'm
 * learning" without interrupting the user.
 *
 * Design constraints:
 *   • Caller-owned visibility: the parent screen holds the
 *     `message` string in state and clears it when ready. This
 *     component is a dumb renderer with auto-dismiss baked in.
 *     No global toast queue, no provider — Lumina has no
 *     existing toast infra and we don't want to introduce one
 *     for two surfaces.
 *   • Non-blocking: pointerEvents="none" wraps the bubble so a
 *     toast over the YES pill doesn't intercept the user's next
 *     tap.
 *   • Web-safe: react-native-reanimated FadeIn/FadeOut already
 *     work on web; no native-only modules.
 *
 * Auto-dismiss fires `onHide` after `durationMs` (default 3.4s)
 * so the parent can clear its `message` state without owning a
 * timer.
 */

import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { lumina } from "@/constants/colors";
import { fontFamily } from "@/constants/typography";

export type InlineToastProps = {
  /** When non-null, the toast is visible. Set to null to hide. */
  message: string | null;
  /** Called once the auto-dismiss timer fires. Caller should
   *  clear its `message` state in this callback. */
  onHide: () => void;
  /** Override default 3400ms display duration. */
  durationMs?: number;
};

export function InlineToast({
  message,
  onHide,
  durationMs = 3400,
}: InlineToastProps) {
  useEffect(() => {
    if (message === null) return;
    const t = setTimeout(onHide, durationMs);
    return () => clearTimeout(t);
  }, [message, onHide, durationMs]);

  if (message === null) return null;

  return (
    <View pointerEvents="none" style={styles.wrap}>
      <Animated.View
        entering={FadeIn.duration(220)}
        exiting={FadeOut.duration(220)}
        style={styles.bubble}
      >
        <Text style={styles.text}>{message}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 24,
    alignItems: "center",
    zIndex: 50,
  },
  bubble: {
    maxWidth: 320,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(10,8,36,0.92)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.35)",
    shadowColor: lumina.firefly,
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
  },
  text: {
    fontFamily: fontFamily.bodyMedium,
    color: "#FFFFFF",
    fontSize: 13,
    textAlign: "center",
  },
});
