/**
 * GlassSurface — Glassmorphism 2.0 primitive.
 *
 * Spec from brief:
 *   • 25 % opacity fill
 *   • 40 px backdrop blur
 *   • dynamic chromatic edge (hue shifts with active agent)
 *   • 0.8 px neon border
 *   • 8 % opacity inner glow
 *
 * Implementation:
 *   - expo-blur for the backdrop blur.
 *   - LinearGradient layered above for the chromatic edge.
 *   - Reanimated borderColor pulse driven by the breathing prop.
 *
 * Use everywhere a card, panel, or pill needs to feel like part of the
 * cosmic void rather than a hard rectangle.
 */

import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect } from "react";
import { Platform, StyleSheet, View, type ViewProps } from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { agents, type AgentKey } from "@/constants/colors";
import { timing } from "@/constants/motion";

type Props = ViewProps & {
  /** Corner rounding. Default 24. */
  radius?: number;
  /** Blur intensity 0–100. Default 40 (matches brief). */
  intensity?: number;
  /** Tint of the glass. Default "dark". */
  tint?: "dark" | "light" | "default";
  /** When set, the chromatic edge & border pulse in this agent's hue. */
  agent?: AgentKey;
  /** Subtle 1.4 s breathing pulse on the border. Default false. */
  breathing?: boolean;
  /** Adds the 8 % inner glow. Default true. */
  innerGlow?: boolean;
};

export function GlassSurface({
  radius = 24,
  intensity = 40,
  tint = "dark",
  agent,
  breathing = false,
  innerGlow = true,
  style,
  children,
  ...rest
}: Props) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (!breathing) return;
    pulse.value = withRepeat(
      withTiming(1, { duration: 1400, easing: timing.ambient.easing }),
      -1,
      true,
    );
  }, [breathing, pulse]);

  const accent = agent ? agents[agent].hex : "#FFFFFF";
  const accentGlow = agent ? agents[agent].glow : "rgba(255,255,255,0.18)";

  const animatedBorder = useAnimatedStyle(() => {
    "worklet";
    if (!breathing) return { borderColor: "rgba(255,255,255,0.10)" };
    const colour = interpolateColor(
      pulse.value,
      [0, 1],
      ["rgba(255,255,255,0.10)", accent],
    );
    return { borderColor: colour };
  });

  return (
    <View
      style={[styles.outer, { borderRadius: radius }, style]}
      {...rest}
    >
      {/* Backdrop blur — falls back to a translucent View on web. */}
      {Platform.OS === "web" ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: "rgba(255,255,255,0.06)", borderRadius: radius },
          ]}
        />
      ) : (
        <BlurView
          intensity={intensity}
          tint={tint}
          style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
        />
      )}

      {/* Chromatic edge — angled gradient that picks up the agent hue. */}
      <LinearGradient
        pointerEvents="none"
        colors={[accentGlow, "rgba(255,255,255,0)", accentGlow] as [
          string,
          string,
          string,
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: radius, opacity: 0.55 },
        ]}
      />

      {/* 8 % inner glow — a soft coloured wash. */}
      {innerGlow ? (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: radius,
              backgroundColor: agent
                ? `${accent}14` // ~8 % alpha
                : "rgba(255,255,255,0.04)",
            },
          ]}
        />
      ) : null}

      {/* 0.8 px neon border (rendered as 1 px since RN doesn't sub-pixel). */}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: radius,
            borderWidth: 1,
          },
          animatedBorder,
        ]}
      />

      <View style={[styles.content, { borderRadius: radius }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    overflow: "hidden",
  },
  content: {
    overflow: "hidden",
  },
});
