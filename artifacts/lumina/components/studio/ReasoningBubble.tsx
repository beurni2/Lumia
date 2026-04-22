/**
 * ReasoningBubble — translucent thought bubble with color-coded tail.
 *
 * Materialises with gentle float physics + a "ting" haptic when an
 * agent surfaces a new reasoning step. Tail picks up the agent's hue.
 */

import * as Haptics from "expo-haptics";
import React, { useEffect } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { GlassSurface } from "@/components/foundation/GlassSurface";
import { agents, type AgentKey } from "@/constants/colors";
import { spring } from "@/constants/motion";
import { type } from "@/constants/typography";

type Props = {
  agent: AgentKey;
  text: string;
  /** Where the tail points from (relative offset). Default centred-bottom. */
  tailSide?: "left" | "right" | "center";
};

export function ReasoningBubble({
  agent,
  text,
  tailSide = "center",
}: Props) {
  const float = useSharedValue(0);
  const scale = useSharedValue(0.9);
  const meta = agents[agent];

  useEffect(() => {
    scale.value = withSpring(1, spring.bloom);
    float.value = withRepeat(
      withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    if (Platform.OS !== "web") {
      Haptics.selectionAsync();
    }
  }, [scale, float]);

  const containerStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [
        { scale: scale.value },
        { translateY: -float.value * 4 },
      ],
    };
  });

  return (
    <Animated.View
      entering={FadeIn.duration(280)}
      exiting={FadeOut.duration(180)}
      style={containerStyle}
    >
      <GlassSurface agent={agent} radius={20} breathing>
        <View style={styles.header}>
          <View
            style={[
              styles.dot,
              { backgroundColor: meta.hex, shadowColor: meta.hex },
            ]}
          />
          <Text style={[type.label, { color: meta.hex }]}>
            {capitalise(agent)}
          </Text>
        </View>
        <Text style={[type.body, styles.body]}>{text}</Text>
      </GlassSurface>

      {/* Color-coded tail */}
      <View
        style={[
          styles.tail,
          {
            backgroundColor: meta.hex,
            alignSelf:
              tailSide === "left"
                ? "flex-start"
                : tailSide === "right"
                  ? "flex-end"
                  : "center",
            shadowColor: meta.hex,
          },
        ]}
      />
    </Animated.View>
  );
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  body: {
    color: "rgba(255,255,255,0.88)",
    paddingHorizontal: 16,
    paddingBottom: 14,
    paddingTop: 4,
    fontSize: 14,
    lineHeight: 19,
  },
  tail: {
    width: 8,
    height: 8,
    borderRadius: 2,
    transform: [{ rotate: "45deg" }, { translateY: -4 }],
    marginHorizontal: 24,
    shadowOpacity: 0.8,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
});
