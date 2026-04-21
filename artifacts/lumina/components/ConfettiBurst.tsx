import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Dimensions, Easing, StyleSheet, View } from "react-native";

interface ConfettiBurstProps {
  /** Number of confetti pieces (default: 64). Keep modest for perf on low-end Android. */
  readonly pieces?: number;
  /** Total animation duration in ms (default: 2400). */
  readonly durationMs?: number;
  /** Color palette — defaults to Lumina brand spectrum. */
  readonly colors?: readonly string[];
}

const DEFAULT_COLORS = [
  "#22c2a5", // Lumina teal
  "#ffb547", // amber
  "#7c5cff", // electric violet
  "#ff6bb1", // hot pink
  "#5cb8ff", // sky
  "#ffd966", // gold
];

interface PieceSpec {
  readonly id: number;
  readonly startX: number;
  readonly endX: number;
  readonly endY: number;
  readonly delay: number;
  readonly rotations: number;
  readonly size: number;
  readonly color: string;
  readonly shape: "square" | "rect" | "circle";
}

/**
 * Pure React Native Animated confetti burst — no native deps required.
 *
 * Each piece animates from above the top of the viewport down to a random
 * resting Y, while spinning. Built with the JS Animated driver so it works
 * unchanged on iOS / Android / web, including the Expo Go preview.
 *
 * Designed for one-shot celebration on launch success: mount it, it plays
 * once, then unmount via parent state. Set `pointerEvents="none"` so it
 * never blocks taps on the success card behind it.
 */
export default function ConfettiBurst({
  pieces = 64,
  durationMs = 2400,
  colors = DEFAULT_COLORS,
}: ConfettiBurstProps) {
  const { width, height } = Dimensions.get("window");

  // Build the piece specs once, deterministic-ish per mount.
  const specs = useMemo<PieceSpec[]>(() => {
    return Array.from({ length: pieces }, (_, i) => {
      // Seeded pseudo-random per index so re-mounts feel fresh but a single
      // mount produces consistent, evenly-spread confetti.
      const r1 = pseudoRandom(i * 9301 + 49297);
      const r2 = pseudoRandom(i * 1234 + 5678);
      const r3 = pseudoRandom(i * 4242 + 1);
      const r4 = pseudoRandom(i * 73 + 17);
      const r5 = pseudoRandom(i * 8192 + 31);
      const startX = r1 * width;
      const drift = (r2 - 0.5) * width * 0.4;
      const endX = clamp(startX + drift, 0, width - 12);
      const endY = height * (0.4 + r3 * 0.55);
      const delay = r4 * 600;
      const rotations = 1 + r2 * 4;
      const size = 6 + r5 * 8;
      const color = colors[i % colors.length];
      const shape: PieceSpec["shape"] =
        i % 3 === 0 ? "rect" : i % 3 === 1 ? "square" : "circle";
      return { id: i, startX, endX, endY, delay, rotations, size, color, shape };
    });
  }, [pieces, width, height, colors]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {specs.map((s) => (
        <Piece key={s.id} spec={s} durationMs={durationMs} />
      ))}
    </View>
  );
}

function Piece({ spec, durationMs }: { spec: PieceSpec; durationMs: number }) {
  const fall = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fall, {
      toValue: 1,
      duration: durationMs,
      delay: spec.delay,
      easing: Easing.bezier(0.22, 0.61, 0.36, 1), // gentle ease-out
      useNativeDriver: true,
    }).start();
  }, [fall, durationMs, spec.delay]);

  const translateY = fall.interpolate({
    inputRange: [0, 1],
    outputRange: [-40, spec.endY],
  });
  const translateX = fall.interpolate({
    inputRange: [0, 1],
    outputRange: [spec.startX, spec.endX],
  });
  const rotate = fall.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", `${spec.rotations * 360}deg`],
  });
  const opacity = fall.interpolate({
    inputRange: [0, 0.85, 1],
    outputRange: [1, 1, 0],
  });

  const baseStyle = {
    width: spec.shape === "rect" ? spec.size * 2 : spec.size,
    height: spec.size,
    backgroundColor: spec.color,
    borderRadius: spec.shape === "circle" ? spec.size : 1.5,
  };

  return (
    <Animated.View
      style={[
        styles.piece,
        baseStyle,
        { transform: [{ translateX }, { translateY }, { rotate }], opacity },
      ]}
    />
  );
}

function pseudoRandom(seed: number): number {
  // Mulberry32 — small, deterministic, avoids needing a real PRNG dep.
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (((t ^ (t >>> 14)) >>> 0) % 100000) / 100000;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

const styles = StyleSheet.create({
  piece: {
    position: "absolute",
    top: 0,
    left: 0,
  },
});
