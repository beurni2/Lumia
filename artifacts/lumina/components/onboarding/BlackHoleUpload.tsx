/**
 * BlackHoleUpload — the glowing portal that "sucks in" video clips.
 *
 * Used only in onboarding's Awaken act. Tap → opens the system video
 * picker → on success: haptic "thud" + spiral swirl animation that
 * collapses inward → counter increments → a sleeping firefly wakes.
 *
 * Falls back to a no-op tap on web (preview environment) so the
 * dev workflow doesn't crash.
 */

import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
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
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";

import { lumina } from "@/constants/colors";
import { spring } from "@/constants/motion";
import { type } from "@/constants/typography";

type Props = {
  /** Number of clips collected so far — drives the firefly counter. */
  count: number;
  /** Target before the user can advance. Default 3. */
  target?: number;
  /** Called with the picked URI (or "demo" string for the simulated path). */
  onClipAdded: (uri: string) => void;
  size?: number;
};

export function BlackHoleUpload({
  count,
  target = 3,
  onClipAdded,
  size = 200,
}: Props) {
  const swirl = useSharedValue(0);
  const breathe = useSharedValue(0);
  const press = useSharedValue(1);

  useEffect(() => {
    breathe.value = withRepeat(
      withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [breathe]);

  async function handlePress() {
    press.value = withSequence(
      withSpring(0.92, spring.tap),
      withSpring(1, spring.settle),
    );

    let uri = "demo";
    if (Platform.OS !== "web") {
      try {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (perm.status === "granted") {
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Videos,
            allowsEditing: false,
            quality: 0.7,
          });
          if (result.canceled) return;
          uri = result.assets[0]?.uri ?? "demo";
        }
      } catch {
        /* swallow — fall through to demo */
      }
    }

    // The satisfying "thud" + swirl
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
    swirl.value = 0;
    swirl.value = withTiming(1, {
      duration: 900,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
    });
    onClipAdded(uri);
  }

  const ringStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [
        { scale: press.value * (1 + 0.04 * breathe.value) },
      ],
    };
  });
  const swirlStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      opacity: 1 - swirl.value,
      transform: [
        { rotate: `${swirl.value * 720}deg` },
        { scale: 1 - swirl.value * 0.95 },
      ],
    };
  });

  const remaining = Math.max(0, target - count);

  return (
    <View style={{ alignItems: "center" }}>
      <Animated.View style={ringStyle}>
        <Pressable
          onPress={handlePress}
          style={{
            width: size,
            height: size,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* Black hole event horizon */}
          <Svg width={size} height={size} viewBox="0 0 100 100">
            <Defs>
              <RadialGradient id="hole" cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor="#000000" stopOpacity="1" />
                <Stop offset="55%" stopColor={lumina.coreDeep} stopOpacity="0.9" />
                <Stop offset="80%" stopColor={lumina.core} stopOpacity="0.55" />
                <Stop
                  offset="100%"
                  stopColor={lumina.firefly}
                  stopOpacity="0.7"
                />
              </RadialGradient>
            </Defs>
            <Circle cx="50" cy="50" r="48" fill="url(#hole)" />
            <Circle
              cx="50"
              cy="50"
              r="48"
              fill="none"
              stroke={lumina.firefly}
              strokeOpacity={0.55}
              strokeWidth={0.6}
            />
          </Svg>

          {/* Swirling clip-being-swallowed indicator */}
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: "absolute",
                width: size * 0.75,
                height: size * 0.75,
                borderRadius: size,
                borderWidth: 2,
                borderColor: lumina.firefly,
                borderStyle: "dashed",
              },
              swirlStyle,
            ]}
          />

          {/* Centre label */}
          <View style={[StyleSheet.absoluteFill, styles.centerOverlay]}>
            <Text
              style={[
                type.subheadSm,
                { color: lumina.firefly, textAlign: "center" },
              ]}
            >
              {count}
              <Text style={{ color: "rgba(255,255,255,0.4)" }}>/{target}</Text>
            </Text>
            <Text
              style={[
                type.microDelight,
                {
                  color: "rgba(255,255,255,0.65)",
                  textAlign: "center",
                  marginTop: 2,
                },
              ]}
            >
              {remaining === 0 ? "ready ✦" : "tap to feed the void"}
            </Text>
          </View>
        </Pressable>
      </Animated.View>

      {/* Sleeping → waking firefly indicators */}
      <View style={styles.fireflyRow}>
        {Array.from({ length: target }).map((_, i) => {
          const awake = i < count;
          return (
            <View
              key={i}
              style={[
                styles.fireflyDot,
                {
                  backgroundColor: awake
                    ? lumina.firefly
                    : "rgba(255,255,255,0.12)",
                  shadowColor: awake ? lumina.firefly : "transparent",
                  shadowOpacity: awake ? 0.9 : 0,
                  shadowRadius: awake ? 10 : 0,
                  shadowOffset: { width: 0, height: 0 },
                },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centerOverlay: {
    alignItems: "center",
    justifyContent: "center",
  },
  fireflyRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 24,
  },
  fireflyDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
});
