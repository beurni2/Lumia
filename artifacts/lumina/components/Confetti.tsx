/**
 * Confetti — a lightweight one-shot celebration overlay.
 *
 * Used by the review screen to mark a successful export
 * (save-to-gallery). Implemented with react-native-reanimated +
 * absolutely-positioned Views — no SVG, no third-party
 * confetti library, no native module. Works in Expo Go.
 *
 * Each piece falls from above the viewport with a small
 * horizontal drift and rotation, then fades out near the
 * bottom of its travel. Pieces stagger with a tiny random
 * delay so the burst feels organic rather than uniform.
 *
 * Pure decoration — render conditionally and unmount when the
 * success state goes away. There is no "stop" API; the
 * animation runs once and then the views sit idle until they
 * are torn down by the parent.
 */
import React, { useEffect, useMemo } from "react";
import { Dimensions, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { lumina } from "@/constants/colors";

const COUNT = 28;

// A small palette that reads against the cosmic backdrop.
// Firefly is the brand accent, the others give variety.
const PIECE_COLORS = [
  lumina.firefly,
  "#FFFFFF",
  "#FFB37A",
  "#9D6BFF",
  "#7BE0FF",
];

type Piece = {
  startX: number;
  drift: number;
  delay: number;
  duration: number;
  size: number;
  rotation: number;
  color: string;
};

export function Confetti() {
  const { width, height } = Dimensions.get("window");

  // Generate piece config once per mount. Re-rendering the
  // parent should NOT reshuffle (no width-only dep beyond the
  // initial layout snapshot).
  const pieces: Piece[] = useMemo(
    () =>
      Array.from({ length: COUNT }, () => ({
        startX: Math.random() * width,
        drift: (Math.random() - 0.5) * 90,
        delay: Math.random() * 280,
        duration: 1500 + Math.random() * 1300,
        size: 6 + Math.random() * 7,
        rotation: Math.random() * 720 - 360,
        color: PIECE_COLORS[Math.floor(Math.random() * PIECE_COLORS.length)]!,
      })),
    // Width is sampled once on mount; intentionally no rerun on
    // resize — confetti is a one-shot effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFillObject}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {pieces.map((p, i) => (
        <ConfettiPiece key={i} piece={p} fallDistance={height} />
      ))}
    </View>
  );
}

function ConfettiPiece({
  piece,
  fallDistance,
}: {
  piece: Piece;
  fallDistance: number;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      piece.delay,
      withTiming(1, {
        duration: piece.duration,
        easing: Easing.in(Easing.quad),
      }),
    );
  }, [piece.delay, piece.duration, progress]);

  const animStyle = useAnimatedStyle(() => {
    // Fade out over the last 15% of travel so pieces don't
    // visibly clip at the bottom edge.
    const fadeStart = 0.85;
    const opacity =
      progress.value < fadeStart
        ? 1
        : Math.max(0, 1 - (progress.value - fadeStart) / (1 - fadeStart));
    return {
      transform: [
        { translateX: piece.drift * progress.value },
        // Overshoot the viewport slightly so pieces clear the
        // bottom edge before they fade.
        { translateY: fallDistance * 1.1 * progress.value },
        { rotate: `${piece.rotation * progress.value}deg` },
      ],
      opacity,
    };
  });

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          left: piece.startX,
          top: -24,
          width: piece.size,
          height: piece.size * 0.6,
          backgroundColor: piece.color,
          borderRadius: 1,
        },
        animStyle,
      ]}
    />
  );
}
