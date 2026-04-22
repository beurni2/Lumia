/**
 * AgentConstellation — the four agents in elliptical orbit around the
 * central Hive Core.
 *
 * Brief:
 *   • 4 agent avatars in a perfect elliptical path around a central
 *     "Hive Core" pulse.
 *   • When an agent thinks, it surges forward in 3D (already handled
 *     by AgentAvatar's `state="thinking"`).
 *   • Thin glowing neural threads connect agents to the core; threads
 *     belonging to active agents brighten.
 *
 * Performance: a single Reanimated time value drives all four orbital
 * positions plus the SVG thread strokes — roughly the cost of one timer.
 */

import React, { useEffect, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Line } from "react-native-svg";

import { agents, type AgentKey } from "@/constants/colors";
import { AgentAvatar } from "@/components/foundation/AgentAvatar";
import { StyleTwinOrb } from "@/components/foundation/StyleTwinOrb";

const AnimatedLine = Animated.createAnimatedComponent(Line);

const AGENT_ORDER: AgentKey[] = [
  "ideator",
  "director",
  "editor",
  "monetizer",
];

type Props = {
  /** Width of the constellation stage in pts. Default 320. */
  size?: number;
  /** Agent currently "thinking" — drives surge + thread brightness. */
  active?: AgentKey | null;
  /** Agents that are agreeing — threads pulse in unison. */
  agreeing?: AgentKey[];
};

export function AgentConstellation({
  size = 320,
  active = null,
  agreeing = [],
}: Props) {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withRepeat(
      withTiming(1, { duration: 22000, easing: Easing.linear }),
      -1,
      false,
    );
  }, [t]);

  // Geometry of the ellipse
  const cx = size / 2;
  const cy = size / 2;
  const rx = size * 0.36;
  const ry = size * 0.28;

  // Phase offsets for each agent (evenly spaced around the orbit)
  const phases = useMemo(
    () => AGENT_ORDER.map((_, i) => (i / AGENT_ORDER.length) * Math.PI * 2),
    [],
  );

  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Neural threads — drawn first so avatars sit on top */}
      <Svg
        style={StyleSheet.absoluteFill}
        width={size}
        height={size}
        pointerEvents="none"
      >
        {AGENT_ORDER.map((agent, i) => (
          <Thread
            key={agent}
            agent={agent}
            phase={phases[i] ?? 0}
            t={t}
            cx={cx}
            cy={cy}
            rx={rx}
            ry={ry}
            isActive={agent === active || agreeing.includes(agent)}
          />
        ))}
      </Svg>

      {/* Hive Core */}
      <View style={{ position: "absolute" }}>
        <StyleTwinOrb
          size={size * 0.42}
          mood={active ? "excited" : "idle"}
        />
      </View>

      {/* Orbiting agent avatars */}
      {AGENT_ORDER.map((agent, i) => (
        <OrbitingAvatar
          key={agent}
          agent={agent}
          phase={phases[i] ?? 0}
          t={t}
          rx={rx}
          ry={ry}
          state={
            agent === active
              ? "thinking"
              : agreeing.includes(agent)
                ? "agreeing"
                : "idle"
          }
        />
      ))}
    </View>
  );
}

function OrbitingAvatar({
  agent,
  phase,
  t,
  rx,
  ry,
  state,
}: {
  agent: AgentKey;
  phase: number;
  t: SharedValue<number>;
  rx: number;
  ry: number;
  state: "idle" | "thinking" | "agreeing";
}) {
  const style = useAnimatedStyle(() => {
    "worklet";
    const angle = t.value * Math.PI * 2 + phase;
    return {
      transform: [
        { translateX: rx * Math.cos(angle) },
        { translateY: ry * Math.sin(angle) },
      ],
    };
  });
  return (
    <Animated.View style={[{ position: "absolute" }, style]}>
      <AgentAvatar agent={agent} state={state} size={48} />
    </Animated.View>
  );
}

function Thread({
  agent,
  phase,
  t,
  cx,
  cy,
  rx,
  ry,
  isActive,
}: {
  agent: AgentKey;
  phase: number;
  t: SharedValue<number>;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  isActive: boolean;
}) {
  const meta = agents[agent];
  const props = useAnimatedProps(() => {
    "worklet";
    const angle = t.value * Math.PI * 2 + phase;
    return {
      x2: cx + rx * Math.cos(angle),
      y2: cy + ry * Math.sin(angle),
      strokeOpacity: isActive
        ? 0.55 + 0.3 * Math.sin(t.value * Math.PI * 8)
        : 0.18,
    };
  });
  return (
    <AnimatedLine
      x1={cx}
      y1={cy}
      stroke={meta.hex}
      strokeWidth={isActive ? 1.2 : 0.6}
      animatedProps={props}
    />
  );
}
