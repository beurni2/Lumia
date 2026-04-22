/**
 * FireflyParticles — the signature bioluminescent orb field.
 *
 * Foundation primitive #3. The "magic dust" used across:
 *   • Onboarding (sleeping fireflies that wake as you add content)
 *   • Swarm Studio (idle ambient layer behind agent constellation)
 *   • Earnings Dashboard (constellation-forming bursts)
 *   • Suggestion bar (excited fireflies rising on tap)
 *
 * Implementation: pure SVG + Reanimated 3. One shared time value drives
 * every firefly's position via a deterministic Lissajous orbit, so 24
 * fireflies cost roughly the same as one timer.
 */

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

import { agents, lumina, type AgentKey } from "@/constants/colors";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type Firefly = {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  px: number;
  py: number;
  size: number;
  speed: number;
  baseOpacity: number;
  hue: string;
};

function generate(
  count: number,
  palette: readonly string[],
  seed: number,
): Firefly[] {
  let state = seed;
  const rand = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  return Array.from({ length: count }, (_, i) => ({
    ax: 18 + rand() * 16,
    ay: 12 + rand() * 14,
    bx: 25 + rand() * 25,
    by: 30 + rand() * 25,
    px: rand() * Math.PI * 2,
    py: rand() * Math.PI * 2,
    size: 0.5 + rand() * 1.6,
    speed: 0.35 + rand() * 0.55,
    baseOpacity: 0.5 + rand() * 0.45,
    hue: palette[i % palette.length] ?? lumina.firefly,
  }));
}

type Props = ViewProps & {
  /** Number of fireflies. Default 18. Reduce for low-end devices. */
  count?: number;
  /** Palette to draw from. Default = cyan + magenta + amethyst. */
  palette?: readonly string[];
  /** Restrict palette to a single agent's hue. Overrides `palette`. */
  agent?: AgentKey;
  /** Seed for deterministic placement. Default 42. */
  seed?: number;
  /** Slow ambient (true) vs energetic (false). Default true. */
  ambient?: boolean;
};

export function FireflyParticles({
  count = 18,
  palette,
  agent,
  seed = 42,
  ambient = true,
  style,
  pointerEvents = "none",
  ...rest
}: Props) {
  const effectivePalette = agent
    ? [agents[agent].hex]
    : (palette ?? [lumina.firefly, lumina.spark, lumina.coreSoft]);

  const flies = useMemo(
    () => generate(count, effectivePalette, seed),
    [count, effectivePalette, seed],
  );

  const t = useSharedValue(0);
  React.useEffect(() => {
    t.value = withRepeat(
      withTiming(1, {
        duration: ambient ? 14000 : 6000,
        easing: Easing.inOut(Easing.sin),
      }),
      -1,
      false,
    );
  }, [t, ambient]);

  return (
    <View
      style={[StyleSheet.absoluteFill, style]}
      pointerEvents={pointerEvents}
      {...rest}
    >
      <Svg
        style={StyleSheet.absoluteFill}
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid slice"
      >
        <Defs>
          {effectivePalette.map((hue, i) => (
            <RadialGradient
              key={i}
              id={`ff-${i}`}
              cx="50%"
              cy="50%"
              r="50%"
            >
              <Stop offset="0%" stopColor={hue} stopOpacity="1" />
              <Stop offset="60%" stopColor={hue} stopOpacity="0.45" />
              <Stop offset="100%" stopColor={hue} stopOpacity="0" />
            </RadialGradient>
          ))}
        </Defs>
        {flies.map((fly, i) => (
          <Firefly
            key={i}
            fly={fly}
            t={t}
            gradientId={`ff-${effectivePalette.indexOf(fly.hue)}`}
          />
        ))}
      </Svg>
    </View>
  );
}

function Firefly({
  fly,
  t,
  gradientId,
}: {
  fly: Firefly;
  t: SharedValue<number>;
  gradientId: string;
}) {
  const props = useAnimatedProps(() => {
    "worklet";
    const phase = t.value * Math.PI * 2 * fly.speed;
    const cx = 50 + fly.ax * Math.sin(phase + fly.px);
    const cy = 50 + fly.ay * Math.cos(phase * 0.8 + fly.py);
    const opacity =
      fly.baseOpacity *
      (0.55 + 0.45 * Math.sin(phase * 1.4 + fly.px));
    return { cx, cy, opacity };
  });

  return (
    <AnimatedCircle
      r={fly.size}
      fill={`url(#${gradientId})`}
      animatedProps={props}
    />
  );
}
