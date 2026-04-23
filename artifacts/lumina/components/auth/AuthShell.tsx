/**
 * AuthShell — bioluminescent backdrop + glass card for sign-in / sign-up.
 *
 * Reuses the same cosmic palette and motion primitives as the rest of
 * Lumina so the auth surface feels native, not bolted-on. The orb
 * accepts a `mood` so screens can drive it (idle / excited while the
 * user types, supernova on successful submit).
 */

import { BlurView } from "expo-blur";
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  View,
  ScrollView,
} from "react-native";
import Reanimated, { FadeInDown } from "react-native-reanimated";

import { CosmicBackdrop } from "@/components/foundation/CosmicBackdrop";
import { FireflyParticles } from "@/components/foundation/FireflyParticles";
import { StyleTwinOrb } from "@/components/foundation/StyleTwinOrb";
import { lumina } from "@/constants/colors";
import { type } from "@/constants/typography";

export function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
  mood = "idle",
}: {
  eyebrow?: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  mood?: "idle" | "excited" | "supernova";
}) {
  // A slow-rotating constellation halo around the orb — the same visual
  // language the swarm studio uses for the agent ring, but smaller and
  // calmer so it reads as "presence" rather than activity.
  const haloRot = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(haloRot, {
        toValue: 1,
        duration: 24000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [haloRot]);
  const haloSpin = haloRot.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <View style={styles.root}>
      <CosmicBackdrop>
        <FireflyParticles count={18} ambient />
      </CosmicBackdrop>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.orbWrap}>
            <Animated.View
              pointerEvents="none"
              style={[styles.halo, { transform: [{ rotate: haloSpin }] }]}
            >
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <View
                  key={i}
                  style={[
                    styles.haloDot,
                    {
                      transform: [
                        { rotate: `${i * 60}deg` },
                        { translateY: -88 },
                      ],
                    },
                  ]}
                />
              ))}
            </Animated.View>
            <StyleTwinOrb size={140} mood={mood} />
          </View>
          <Reanimated.View entering={FadeInDown.duration(420).delay(120)}>
            {eyebrow ? (
              <Text style={[type.microDelight, styles.eyebrow]}>{eyebrow}</Text>
            ) : null}
            <Text style={[type.heroDisplay, styles.title]}>{title}</Text>
            <Text style={[type.body, styles.subtitle]}>{subtitle}</Text>
          </Reanimated.View>
        </View>

        <Reanimated.View
          entering={FadeInDown.duration(420).delay(220)}
          style={styles.cardWrap}
        >
          {Platform.OS === "ios" ? (
            <BlurView
              intensity={32}
              tint="dark"
              style={[styles.card, styles.cardGlass]}
            >
              {children}
            </BlurView>
          ) : (
            <View style={[styles.card, styles.cardFallback]}>{children}</View>
          )}
          {/* bottom bioluminescent under-glow so the card looks like it
              radiates rather than just sits on the backdrop */}
          <View pointerEvents="none" style={styles.cardUnderglow} />
        </Reanimated.View>

        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0A0824" },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 96,
    paddingBottom: 48,
  },
  header: {
    alignItems: "center",
    marginBottom: 28,
  },
  orbWrap: {
    marginBottom: 18,
    width: 200,
    height: 200,
    alignItems: "center",
    justifyContent: "center",
  },
  halo: {
    position: "absolute",
    width: 200,
    height: 200,
    alignItems: "center",
    justifyContent: "center",
  },
  haloDot: {
    position: "absolute",
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: lumina.core,
    shadowColor: lumina.core,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 6,
    shadowOpacity: 0.9,
  },
  eyebrow: {
    color: "rgba(0,255,204,0.85)",
    textAlign: "center",
    letterSpacing: 2,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  title: {
    color: "#FFFFFF",
    textAlign: "center",
    textShadowColor: lumina.core,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
    fontSize: 32,
  },
  subtitle: {
    color: "rgba(255,255,255,0.65)",
    textAlign: "center",
    marginTop: 8,
    maxWidth: 320,
    alignSelf: "center",
  },
  cardWrap: {
    alignSelf: "stretch",
  },
  card: {
    borderRadius: 24,
    padding: 22,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  cardGlass: {
    backgroundColor: "rgba(20, 12, 60, 0.45)",
  },
  cardFallback: {
    backgroundColor: "rgba(20, 12, 60, 0.78)",
  },
  cardUnderglow: {
    position: "absolute",
    bottom: -18,
    left: 24,
    right: 24,
    height: 18,
    borderRadius: 18,
    backgroundColor: lumina.core,
    opacity: 0.18,
    shadowColor: lumina.core,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 24,
    shadowOpacity: 0.7,
  },
  footer: {
    marginTop: 22,
    alignItems: "center",
  },
});
