/**
 * StyleTwinOrb — the radiant central star at the heart of Lumina.
 *
 * Used in:
 *   • Onboarding (collapses, explodes, emerges)
 *   • Home dashboard (the floating greeter)
 *   • Style Twin Profile (centerpiece of the personal garden)
 *
 * Layered, bottom → top:
 *   1. Outermost soft halo (largest, lowest opacity, slowest pulse)
 *   2. Mid chromatic aurora ring (rotates, picks up agent palette)
 *   3. Inner glowing core (the "star")
 *   4. Optional avatar slot in the centre (children prop)
 */

import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";

import { lumina } from "@/constants/colors";
import { spring } from "@/constants/motion";

type Props = {
  /** Diameter in pts. Default 220. */
  size?: number;
  /** Mood: idle pulse vs. excited rapid pulse vs. collapsing (small + dim). */
  mood?: "idle" | "excited" | "collapsed" | "supernova";
  /** Optional avatar/content for the centre. */
  children?: React.ReactNode;
};

export function StyleTwinOrb({
  size = 220,
  mood = "idle",
  children,
}: Props) {
  const pulse = useSharedValue(0);
  const rotate = useSharedValue(0);
  const scale = useSharedValue(1);
  const intensity = useSharedValue(1);

  // Continuous breathing pulse + slow aurora rotation.
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    rotate.value = withRepeat(
      withTiming(1, { duration: 18000, easing: Easing.linear }),
      -1,
      false,
    );
  }, [pulse, rotate]);

  // Mood drives scale + intensity.
  useEffect(() => {
    if (mood === "collapsed") {
      scale.value = withSpring(0.18, spring.bloom);
      intensity.value = withTiming(0.35, { duration: 600 });
    } else if (mood === "supernova") {
      scale.value = withSpring(1.55, spring.bloom);
      intensity.value = withTiming(1.6, { duration: 400 });
    } else if (mood === "excited") {
      scale.value = withSpring(1.08, spring.tap);
      intensity.value = withTiming(1.25, { duration: 240 });
    } else {
      scale.value = withSpring(1, spring.settle);
      intensity.value = withTiming(1, { duration: 320 });
    }
  }, [mood, scale, intensity]);

  const haloStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [
        { scale: scale.value * (1 + 0.06 * pulse.value) },
      ],
      opacity: 0.55 * intensity.value,
    };
  });
  const auroraStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [
        { scale: scale.value },
        { rotate: `${rotate.value * 360}deg` },
      ],
      opacity: 0.85 * intensity.value,
    };
  });
  const coreStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [{ scale: scale.value * (1 + 0.04 * pulse.value) }],
      opacity: interpolate(intensity.value, [0, 1, 1.6], [0.4, 1, 1]),
    };
  });

  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Outer soft halo */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: size, overflow: "hidden" },
          haloStyle,
        ]}
      >
        <Svg width="100%" height="100%" viewBox="0 0 100 100">
          <Defs>
            <RadialGradient id="halo" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={lumina.core} stopOpacity="0.55" />
              <Stop
                offset="60%"
                stopColor={lumina.firefly}
                stopOpacity="0.18"
              />
              <Stop offset="100%" stopColor={lumina.core} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle cx="50" cy="50" r="50" fill="url(#halo)" />
        </Svg>
      </Animated.View>

      {/* Aurora ring — rotates, picks up the chromatic edge */}
      <Animated.View
        style={[
          {
            width: size * 0.75,
            height: size * 0.75,
            borderRadius: size,
            overflow: "hidden",
          },
          auroraStyle,
        ]}
      >
        <LinearGradient
          colors={[
            lumina.firefly,
            lumina.core,
            lumina.spark,
            lumina.goldTo,
            lumina.firefly,
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: size }]}
        />
        {/* Cut a hole in the centre to make it a ring, not a disc */}
        <View
          style={{
            position: "absolute",
            top: size * 0.07,
            left: size * 0.07,
            right: size * 0.07,
            bottom: size * 0.07,
            borderRadius: size,
            backgroundColor: "#0A0824",
          }}
        />
      </Animated.View>

      {/* Inner glowing core */}
      <Animated.View
        style={[
          {
            position: "absolute",
            width: size * 0.55,
            height: size * 0.55,
            borderRadius: size,
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          },
          coreStyle,
        ]}
      >
        <Svg width="100%" height="100%" viewBox="0 0 100 100">
          <Defs>
            <RadialGradient id="core" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
              <Stop offset="35%" stopColor={lumina.firefly} stopOpacity="0.85" />
              <Stop offset="75%" stopColor={lumina.core} stopOpacity="0.7" />
              <Stop offset="100%" stopColor={lumina.core} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle cx="50" cy="50" r="50" fill="url(#core)" />
        </Svg>
        {children ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {children}
            </View>
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}
