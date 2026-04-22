/**
 * PortalButton — pulsating portal-ring CTA.
 *
 * The signature Lumina action button: a glowing concentric ring that
 * breathes continuously and blooms on press. Used for "Enter the Hive",
 * "Let the Hive Publish", "Awaken your Twin" — anywhere a tap should
 * feel like crossing a threshold.
 */

import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import React, { useEffect } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { lumina } from "@/constants/colors";
import { spring } from "@/constants/motion";
import { type } from "@/constants/typography";

type Props = {
  label: string;
  onPress: () => void;
  /** Default 240. */
  width?: number;
  /** Disable the breathing loop (useful inside busy screens). */
  staticPulse?: boolean;
  disabled?: boolean;
  /** Reduce halo size + opacity for inline use inside dense screens. */
  subtle?: boolean;
};

export function PortalButton({
  label,
  onPress,
  width = 240,
  staticPulse = false,
  disabled = false,
  subtle = false,
}: Props) {
  const pulse = useSharedValue(0);
  const press = useSharedValue(1);

  useEffect(() => {
    if (staticPulse || disabled) return;
    pulse.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [pulse, staticPulse, disabled]);

  const haloStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [{ scale: 1 + pulse.value * 0.18 }],
      opacity: 0.45 + 0.35 * (1 - pulse.value),
    };
  });
  const ringStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [{ scale: press.value * (1 + 0.04 * pulse.value) }],
    };
  });

  function handlePressIn() {
    if (disabled) return;
    press.value = withSpring(0.95, spring.tap);
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  }

  function handlePressOut() {
    press.value = withSequence(
      withSpring(1.05, spring.tap),
      withSpring(1, spring.settle),
    );
  }

  function handlePress() {
    if (disabled) return;
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    onPress();
  }

  return (
    <View style={{ alignItems: "center", justifyContent: "center", width }}>
      {/* Outer breathing halo */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            width: subtle ? width + 18 : width + 64,
            height: subtle ? 80 : width + 64,
            borderRadius: 999,
            backgroundColor: lumina.core,
            opacity: subtle ? 0.18 : 0.22,
          },
          haloStyle,
        ]}
      />

      <Animated.View style={ringStyle}>
        <Pressable
          onPress={handlePress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          disabled={disabled}
          style={{
            width,
            paddingVertical: 18,
            borderRadius: 999,
            overflow: "hidden",
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <LinearGradient
            colors={[lumina.coreSoft, lumina.core, lumina.coreDeep]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          {/* Inner ring highlight */}
          <View
            pointerEvents="none"
            style={{
              ...StyleSheet.absoluteFillObject,
              borderRadius: 999,
              borderWidth: 1.5,
              borderColor: "rgba(255,255,255,0.35)",
              margin: 4,
            }}
          />
          <Text
            style={[
              type.label,
              {
                color: "#FFFFFF",
                textAlign: "center",
                fontSize: 17,
                letterSpacing: 0.4,
              },
            ]}
          >
            {label}
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}
