/**
 * AgentAvatar — small orbital avatar for the four Lumina agents.
 *
 * Each agent has a signature glow + glyph (3D-lite illustration TBD via
 * Rive in a later pass — for now we render an iconic vector mark).
 *
 * States:
 *   idle      — gentle breathing pulse
 *   thinking  — surge forward (scale + bright halo + faster pulse)
 *   agreeing  — synchronised heartbeat with other agreeing agents
 */

import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";

import { agents, type AgentKey } from "@/constants/colors";
import { spring } from "@/constants/motion";

type Props = {
  agent: AgentKey;
  state?: "idle" | "thinking" | "agreeing";
  size?: number;
};

const GLYPH: Record<AgentKey, React.ComponentProps<typeof Feather>["name"]> = {
  ideator: "zap",
  director: "film",
  editor: "scissors",
  monetizer: "trending-up",
};

export function AgentAvatar({ agent, state = "idle", size = 56 }: Props) {
  const meta = agents[agent];
  const pulse = useSharedValue(0);
  const scale = useSharedValue(1);
  const glow = useSharedValue(0.55);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, {
        duration: state === "thinking" ? 900 : 2400,
        easing: Easing.inOut(Easing.sin),
      }),
      -1,
      true,
    );
  }, [pulse, state]);

  useEffect(() => {
    if (state === "thinking") {
      scale.value = withSpring(1.18, spring.bloom);
      glow.value = withTiming(1, { duration: 220 });
    } else if (state === "agreeing") {
      scale.value = withSpring(1.06, spring.tap);
      glow.value = withTiming(0.85, { duration: 220 });
    } else {
      scale.value = withSpring(1, spring.settle);
      glow.value = withTiming(0.55, { duration: 320 });
    }
  }, [state, scale, glow]);

  const haloStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [{ scale: scale.value * (1 + 0.08 * pulse.value) }],
      opacity: glow.value,
    };
  });
  const orbStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [{ scale: scale.value * (1 + 0.03 * pulse.value) }],
    };
  });

  return (
    <View style={{ width: size * 1.6, height: size * 1.6, alignItems: "center", justifyContent: "center" }}>
      {/* Outer halo */}
      <Animated.View
        style={[
          {
            position: "absolute",
            width: size * 1.6,
            height: size * 1.6,
            borderRadius: 999,
            overflow: "hidden",
          },
          haloStyle,
        ]}
        pointerEvents="none"
      >
        <Svg width="100%" height="100%" viewBox="0 0 100 100">
          <Defs>
            <RadialGradient id={`halo-${agent}`} cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={meta.hex} stopOpacity="0.7" />
              <Stop offset="60%" stopColor={meta.hex} stopOpacity="0.18" />
              <Stop offset="100%" stopColor={meta.hex} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle cx="50" cy="50" r="50" fill={`url(#halo-${agent})`} />
        </Svg>
      </Animated.View>

      {/* Orb */}
      <Animated.View
        style={[
          {
            width: size,
            height: size,
            borderRadius: 999,
            overflow: "hidden",
            borderWidth: 1,
            borderColor: meta.hex,
            alignItems: "center",
            justifyContent: "center",
          },
          orbStyle,
        ]}
      >
        <LinearGradient
          colors={[meta.hex, "rgba(10,8,36,0.85)"]}
          start={{ x: 0.2, y: 0.1 }}
          end={{ x: 0.8, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Feather name={GLYPH[agent]} size={size * 0.42} color="#FFFFFF" />
      </Animated.View>
    </View>
  );
}
