/**
 * LightExplosion — full-screen "the swarm has published" transition.
 *
 * A tiny seed of light at the focal point blooms outward to fill the
 * screen with white, then fades to reveal the next route. Used after
 * the user taps "Let the Hive Publish".
 *
 * Drives `onComplete` once the explosion has fully resolved.
 */

import React, { useEffect, useMemo } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";

const SEED_SIZE = 48;

type Props = {
  /** When true, the explosion plays from start to finish. */
  active: boolean;
  /** Focal point (in screen coords). Defaults to centre. */
  origin?: { x: number; y: number };
  onComplete?: () => void;
};

export function LightExplosion({ active, origin, onComplete }: Props) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const scaleTarget = useMemo(() => {
    const diagonal = Math.sqrt(screenW * screenW + screenH * screenH);
    return (diagonal * 2.2) / SEED_SIZE;
  }, [screenW, screenH]);

  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (!active) return;
    // Plays once per active=true edge.
    scale.value = 0;
    opacity.value = 0;
    opacity.value = withSequence(
      withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) }),
      withDelay(380, withTiming(0, { duration: 380 })),
    );
    scale.value = withTiming(
      scaleTarget,
      { duration: 700, easing: Easing.out(Easing.cubic) },
      (finished) => {
        if (finished && onComplete) runOnJS(onComplete)();
      },
    );
  }, [active, scale, opacity, scaleTarget, onComplete]);

  const seedStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      opacity: opacity.value,
      transform: [{ scale: scale.value }],
    };
  });

  if (!active) return null;

  const cx = origin?.x ?? screenW / 2;
  const cy = origin?.y ?? screenH / 2;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View
        style={[
          {
            position: "absolute",
            left: cx - SEED_SIZE / 2,
            top: cy - SEED_SIZE / 2,
            width: SEED_SIZE,
            height: SEED_SIZE,
            borderRadius: 999,
            backgroundColor: "#FFFFFF",
            shadowColor: "#FFFFFF",
            shadowOpacity: 0.95,
            shadowRadius: 60,
            shadowOffset: { width: 0, height: 0 },
          },
          seedStyle,
        ]}
      />
    </View>
  );
}
