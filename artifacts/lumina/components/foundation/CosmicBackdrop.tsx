/**
 * CosmicBackdrop — the deep midnight void with subtle moving starfield.
 *
 * Foundation primitive #1. Used as the base layer of every dark-mode
 * screen. Layers, bottom-up:
 *   1. LinearGradient #0A0824 → #1F1B45 (60% gradient stop)
 *   2. SVG starfield with 60 stars at varying opacities
 *   3. Optional drifting "neural vein" radial pulse (off by default)
 *
 * Performance: stars use a single shared Reanimated value driving a
 * sin-wave opacity loop (one timer for the whole field, not 60).
 */

import { LinearGradient } from "expo-linear-gradient";
import React, { useMemo } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";

import { cosmic } from "@/constants/colors";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type Star = {
  cx: number;
  cy: number;
  r: number;
  baseOpacity: number;
  twinklePhase: number;
};

function generateStars(count: number, seed = 7): Star[] {
  // Deterministic LCG so the starfield is identical between renders.
  let state = seed;
  const rand = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  return Array.from({ length: count }, () => ({
    cx: rand() * 100,
    cy: rand() * 100,
    r: 0.15 + rand() * 0.55,
    baseOpacity: 0.25 + rand() * 0.6,
    twinklePhase: rand() * Math.PI * 2,
  }));
}

type Props = ViewProps & {
  /** Number of background stars. Default 60. Set 0 to disable. */
  starCount?: number;
  /** Soft radial bloom in the upper centre — useful behind hero orbs. */
  bloom?: boolean;
  /** Override the gradient stops. Default = cosmic.voidTop → cosmic.voidBottom. */
  colors?: readonly [string, string, ...string[]];
};

export function CosmicBackdrop({
  starCount = 60,
  bloom = false,
  colors,
  style,
  children,
  ...rest
}: Props) {
  const stars = useMemo(() => generateStars(starCount), [starCount]);
  const t = useSharedValue(0);

  React.useEffect(() => {
    t.value = withRepeat(
      withTiming(1, { duration: 4200, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [t]);

  const gradientColors =
    colors ??
    ([cosmic.voidTop, cosmic.voidMid, cosmic.voidBottom] as const);

  return (
    <View style={[StyleSheet.absoluteFill, style]} {...rest}>
      <LinearGradient
        colors={gradientColors as unknown as [string, string, ...string[]]}
        locations={[0, 0.6, 1]}
        style={StyleSheet.absoluteFill}
      />
      {starCount > 0 ? (
        <Svg
          style={StyleSheet.absoluteFill}
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid slice"
        >
          {bloom ? (
            <>
              <Defs>
                <RadialGradient id="bloom" cx="50%" cy="28%" r="55%">
                  <Stop offset="0%" stopColor="#6B1EFF" stopOpacity="0.32" />
                  <Stop offset="60%" stopColor="#6B1EFF" stopOpacity="0.05" />
                  <Stop offset="100%" stopColor="#6B1EFF" stopOpacity="0" />
                </RadialGradient>
              </Defs>
              <Circle cx="50" cy="28" r="55" fill="url(#bloom)" />
            </>
          ) : null}
          {stars.map((s, i) => (
            <TwinklingStar key={i} star={s} t={t} />
          ))}
        </Svg>
      ) : null}
      {children}
    </View>
  );
}

function TwinklingStar({
  star,
  t,
}: {
  star: Star;
  t: SharedValue<number>;
}) {
  const animatedProps = useAnimatedProps(() => {
    "worklet";
    const phase = t.value * Math.PI * 2 + star.twinklePhase;
    const factor = 0.5 + 0.5 * Math.sin(phase);
    return { opacity: star.baseOpacity * (0.55 + 0.45 * factor) };
  });
  return (
    <AnimatedCircle
      cx={star.cx}
      cy={star.cy}
      r={star.r}
      fill="#FFFFFF"
      animatedProps={animatedProps}
    />
  );
}
