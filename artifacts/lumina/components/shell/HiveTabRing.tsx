/**
 * HiveTabRing — the Eternal Hive Frame's living foundation ring.
 *
 * Replaces the stock bottom tab bar with a floating glass orb cluster:
 *
 *   • A 76 pt glass-blur capsule hovering 8 pt above the safe-area inset.
 *   • Each tab is a luminous orb (mini Twin / firefly cluster / coin /
 *     person) instead of a flat icon — every orb keeps a faint heartbeat
 *     glow even when inactive so the hive always feels alive.
 *   • A central Hive Core dot sits between orbs as the origin of the
 *     active-tab "neural thread" (an animated underline that draws itself
 *     from the core to whichever orb you tapped).
 *   • The capsule's chromatic edge re-tints to the active tab's agent
 *     colour so the whole frame breathes with your current chamber.
 *   • Tap → magnetic haptic + soft radial bloom under the selected orb.
 *
 * Wired into `app/(tabs)/_layout.tsx` via the `tabBar` prop on `<Tabs>`.
 * On iOS Liquid Glass we still defer to `NativeTabs` (Apple's bar is
 * already premium) — this ring is what web/Android/older-iOS see.
 */

import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import React, { useEffect } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { agents, lumina, type AgentKey } from "@/constants/colors";
import { spring } from "@/constants/motion";

/** Per-route accent agent. Used for the chromatic ring border, neural
 *  thread, and active-orb glow. New tabs added later just need a row. */
const ROUTE_AGENT: Record<string, AgentKey> = {
  index: "monetizer", // Home / Constellation — Twin amethyst
  studio: "ideator", // Swarm Studio — Firefly cyan
  earnings: "editor", // Earnings — Victory gold
  profile: "director", // Profile — Spark magenta
};

const RING_HEIGHT = 76;
const ORB_SIZE = 52;

/**
 * Minimal local mirror of `BottomTabBarProps` from
 * `@react-navigation/bottom-tabs` — that package isn't a direct dep of
 * the workspace (it's a transitive of expo-router, not exposed for
 * import), so we type just the surface area we actually use.
 */
type TabRoute = { key: string; name: string; params?: object };
type TabBarProps = {
  state: { index: number; routes: TabRoute[] };
  descriptors: Record<
    string,
    { options: { title?: string; tabBarLabel?: unknown } }
  >;
  navigation: {
    emit: (event: {
      type: "tabPress";
      target: string;
      canPreventDefault: true;
    }) => { defaultPrevented: boolean };
    navigate: (name: string, params?: object) => void;
  };
};

export function HiveTabRing(props: TabBarProps) {
  const { state, descriptors, navigation } = props;
  const insets = useSafeAreaInsets();
  const activeIndex = state.index;
  const activeRoute = state.routes[activeIndex];
  const activeAgent: AgentKey =
    (activeRoute && ROUTE_AGENT[activeRoute.name]) ?? "ideator";
  const accent = agents[activeAgent].hex;

  // ── Ring chromatic edge — tints with the active tab. ────────────
  const accentT = useSharedValue(0);
  useEffect(() => {
    accentT.value = withTiming(activeIndex, {
      duration: 320,
      easing: Easing.out(Easing.cubic),
    });
  }, [accentT, activeIndex]);

  // ── Neural thread position — animates between orb centres. ──────
  // We track each orb's measured x-centre as it lays out; the indicator
  // springs to whichever index is active.
  const indicatorX = useSharedValue(0);
  const indicatorOpacity = useSharedValue(0);
  const orbCentresRef = React.useRef<number[]>([]);
  const ringWidthRef = React.useRef(0);

  const onRingLayout = (e: LayoutChangeEvent) => {
    ringWidthRef.current = e.nativeEvent.layout.width;
    refreshIndicator();
  };

  const refreshIndicator = () => {
    const x = orbCentresRef.current[activeIndex];
    if (typeof x === "number") {
      indicatorX.value = withSpring(x, spring.tap);
      indicatorOpacity.value = withTiming(1, { duration: 220 });
    }
  };

  useEffect(() => {
    refreshIndicator();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  const onOrbLayout = (i: number) => (e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    orbCentresRef.current[i] = x + width / 2;
    if (i === activeIndex) refreshIndicator();
  };

  // Border colour interpolation across the four agents.
  const borderStyle = useAnimatedStyle(() => {
    const colours = state.routes.map(
      (r) => agents[ROUTE_AGENT[r.name] ?? "ideator"].hex,
    );
    if (colours.length < 2) {
      return { borderColor: colours[0] ?? lumina.firefly };
    }
    const inputRange = colours.map((_, i) => i);
    return {
      borderColor: interpolateColor(accentT.value, inputRange, colours),
    };
  });

  // Indicator pill (the "neural thread" that anchors under the active tab).
  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: indicatorX.value - 18 }],
    opacity: indicatorOpacity.value,
  }));

  // Don't render if the active route is hiding the tab bar (e.g. modal
  // routes). Expo Router's BottomTabBarProps doesn't expose this on the
  // descriptor, but routes that explicitly set `tabBarStyle: { display:
  // "none" }` are honoured by the host — we just always render.
  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.outer,
        { paddingBottom: Math.max(insets.bottom, 6) + 8 },
      ]}
    >
      <View style={styles.ringWrap} onLayout={onRingLayout}>
        {/* Glass + blur substrate */}
        <BlurView
          intensity={Platform.OS === "ios" ? 50 : 28}
          tint="dark"
          style={StyleSheet.absoluteFill}
        />
        {/* Soft inner wash so the orbs read on Android (where blur is weak) */}
        <LinearGradient
          colors={["rgba(20,15,55,0.62)", "rgba(10,8,36,0.78)"]}
          style={StyleSheet.absoluteFill}
        />
        {/* Ambient bottom-glow under the active orb */}
        <Animated.View
          style={[
            styles.activeBloom,
            { backgroundColor: `${accent}33`, shadowColor: accent },
            indicatorStyle,
          ]}
          pointerEvents="none"
        />
        {/* Orb row */}
        <View style={styles.row}>
          {state.routes.map((route, i) => {
            const focused = state.index === i;
            const agent = ROUTE_AGENT[route.name] ?? "ideator";
            const { options } = descriptors[route.key]!;
            const label =
              typeof options.tabBarLabel === "string"
                ? options.tabBarLabel
                : options.title ?? route.name;

            const onPress = () => {
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                if (Platform.OS !== "web") {
                  Haptics.selectionAsync().catch(() => {});
                }
                navigation.navigate(route.name, route.params);
              }
            };

            return (
              <View
                key={route.key}
                style={styles.orbCell}
                onLayout={onOrbLayout(i)}
              >
                <TabOrb
                  routeName={route.name}
                  label={label}
                  agent={agent}
                  focused={focused}
                  onPress={onPress}
                />
              </View>
            );
          })}
        </View>
        {/* Animated chromatic border on top of everything */}
        <Animated.View
          style={[styles.border, borderStyle]}
          pointerEvents="none"
        />
        {/* Hive Core — the tiny pulsing orb at the dead-centre origin
            of the neural thread. */}
        <HiveCore />
      </View>
    </View>
  );
}

/* ───────────────────────── Tab Orb ───────────────────────────────── */

function TabOrb({
  routeName,
  label,
  agent,
  focused,
  onPress,
}: {
  routeName: string;
  label: string;
  agent: AgentKey;
  focused: boolean;
  onPress: () => void;
}) {
  const accent = agents[agent].hex;
  const focusV = useSharedValue(focused ? 1 : 0);
  const heartbeat = useSharedValue(0);

  useEffect(() => {
    focusV.value = withSpring(focused ? 1 : 0, spring.tap);
  }, [focused, focusV]);

  // Faint heartbeat for inactive orbs so the ring never feels dead.
  useEffect(() => {
    heartbeat.value = withRepeat(
      withTiming(1, {
        duration: 2400,
        easing: Easing.inOut(Easing.sin),
      }),
      -1,
      true,
    );
  }, [heartbeat]);

  const orbStyle = useAnimatedStyle(() => {
    const breath = focused ? 0 : heartbeat.value * 0.04;
    const scale = interpolate(focusV.value, [0, 1], [0.94, 1.12]) + breath;
    return {
      transform: [{ scale }],
      opacity: interpolate(focusV.value, [0, 1], [0.66, 1]),
    };
  });

  const haloStyle = useAnimatedStyle(() => ({
    opacity: interpolate(focusV.value, [0, 1], [0.0, 0.85]),
    transform: [
      { scale: interpolate(focusV.value, [0, 1], [0.85, 1.0]) },
    ],
  }));

  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: focused }}
      style={styles.pressable}
    >
      <Animated.View
        style={[
          styles.haloRing,
          { borderColor: accent, shadowColor: accent },
          haloStyle,
        ]}
      />
      <Animated.View
        style={[
          styles.orb,
          {
            backgroundColor: focused ? `${accent}22` : "rgba(255,255,255,0.04)",
            borderColor: focused ? accent : "rgba(255,255,255,0.12)",
          },
          orbStyle,
        ]}
      >
        <OrbVisual routeName={routeName} accent={accent} focused={focused} />
      </Animated.View>
      <Text
        numberOfLines={1}
        style={[
          styles.label,
          { color: focused ? accent : "rgba(255,255,255,0.55)" },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/* ─────────────────────────── Per-tab visuals ─────────────────────── */

function OrbVisual({
  routeName,
  accent,
  focused,
}: {
  routeName: string;
  accent: string;
  focused: boolean;
}) {
  switch (routeName) {
    case "index":
      // Constellation Orb — mini Twin core (radial gradient).
      return <ConstellationGlyph accent={accent} focused={focused} />;
    case "studio":
      // Firefly Cluster — four tiny dots around a spark.
      return <FireflyClusterGlyph accent={accent} focused={focused} />;
    case "earnings":
      // Golden Coin Aura
      return (
        <Feather
          name="dollar-sign"
          size={focused ? 18 : 16}
          color={focused ? accent : "rgba(255,255,255,0.7)"}
        />
      );
    case "profile":
      // Person silhouette w/ subtle bloom when focused
      return (
        <Feather
          name="user"
          size={focused ? 18 : 16}
          color={focused ? accent : "rgba(255,255,255,0.7)"}
        />
      );
    default:
      return (
        <Feather
          name="circle"
          size={14}
          color="rgba(255,255,255,0.7)"
        />
      );
  }
}

function ConstellationGlyph({
  accent,
  focused,
}: {
  accent: string;
  focused: boolean;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(
      withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [t]);
  const inner = useAnimatedStyle(() => ({
    transform: [
      { scale: interpolate(t.value, [0, 1], [0.92, 1.06]) },
    ],
    opacity: interpolate(t.value, [0, 1], [0.85, 1]),
  }));
  return (
    <View style={glyph.wrap}>
      <View
        style={[
          glyph.ring,
          { borderColor: focused ? accent : "rgba(255,255,255,0.35)" },
        ]}
      />
      <Animated.View
        style={[
          glyph.core,
          { backgroundColor: focused ? accent : "rgba(255,255,255,0.6)" },
          inner,
        ]}
      />
    </View>
  );
}

function FireflyClusterGlyph({
  accent,
  focused,
}: {
  accent: string;
  focused: boolean;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.linear }),
      -1,
      false,
    );
  }, [t]);
  // Four orbiting dots — angle is i*90° + rotation.
  const dotColor = focused ? accent : "rgba(255,255,255,0.55)";
  return (
    <View style={glyph.wrap}>
      <View
        style={[
          glyph.spark,
          { backgroundColor: focused ? accent : "rgba(255,255,255,0.7)" },
        ]}
      />
      {[0, 1, 2, 3].map((i) => (
        <ClusterDot key={i} index={i} t={t} color={dotColor} />
      ))}
    </View>
  );
}

function ClusterDot({
  index,
  t,
  color,
}: {
  index: number;
  t: SharedValue<number>;
  color: string;
}) {
  const style = useAnimatedStyle(() => {
    const angle = (index / 4) * Math.PI * 2 + t.value * Math.PI * 2;
    const r = 9;
    return {
      transform: [
        { translateX: Math.cos(angle) * r },
        { translateY: Math.sin(angle) * r },
      ],
    };
  });
  return <Animated.View style={[glyph.dot, { backgroundColor: color }, style]} />;
}

/* ─────────────────────────── Hive Core ───────────────────────────── */

function HiveCore() {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(
      withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [t]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 1], [0.4, 0.8]),
    transform: [{ scale: interpolate(t.value, [0, 1], [0.85, 1.1]) }],
  }));
  return (
    <View style={styles.coreWrap} pointerEvents="none">
      <Animated.View style={[styles.core, style]} />
    </View>
  );
}

/* ─────────────────────────── Styles ──────────────────────────────── */

const styles = StyleSheet.create({
  outer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
  },
  ringWrap: {
    height: RING_HEIGHT,
    borderRadius: RING_HEIGHT / 2,
    overflow: "hidden",
    backgroundColor: "rgba(10,8,36,0.55)",
    // iOS shadow
    shadowColor: lumina.core,
    shadowOpacity: 0.45,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    // Android elevation
    elevation: 12,
  },
  border: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: RING_HEIGHT / 2,
    borderWidth: 1.2,
  },
  row: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
  },
  orbCell: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  pressable: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 4,
    minWidth: 56,
  },
  orb: {
    width: ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  haloRing: {
    position: "absolute",
    top: 4,
    width: ORB_SIZE + 12,
    height: ORB_SIZE + 12,
    borderRadius: 999,
    borderWidth: 1.4,
    shadowOpacity: 0.7,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  label: {
    fontSize: 11,
    letterSpacing: 0.4,
    marginTop: 2,
    fontWeight: "600",
  },
  activeBloom: {
    position: "absolute",
    bottom: -2,
    width: 36,
    height: 8,
    borderRadius: 999,
    shadowOpacity: 0.9,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  coreWrap: {
    position: "absolute",
    top: 4,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  core: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: lumina.firefly,
    shadowColor: lumina.firefly,
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
});

const glyph = StyleSheet.create({
  wrap: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    position: "absolute",
    width: 20,
    height: 20,
    borderRadius: 999,
    borderWidth: 1,
  },
  core: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  spark: {
    width: 5,
    height: 5,
    borderRadius: 999,
  },
  dot: {
    position: "absolute",
    width: 3,
    height: 3,
    borderRadius: 999,
  },
});
