import React, { useEffect, useRef } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";

interface LaunchSuccessHeroProps {
  readonly platformsPosted: number;
  readonly platformsBlocked: number;
  readonly summary: string;
}

/**
 * "You just launched X videos while you lived your life" — the dramatic
 * Sprint 3 success moment that lands the closed-loop value prop:
 * Lumina did the work, the creator did the living.
 *
 * Animation contract:
 *   - Card scales up + fades in over 420ms (overshoot ease).
 *   - The headline number pulses once after the card lands.
 *   - Tagline fades in 200ms after the headline.
 *
 * No external animation deps — pure RN Animated, JS driver, works on iOS,
 * Android, and web preview.
 */
export default function LaunchSuccessHero({
  platformsPosted,
  platformsBlocked,
  summary,
}: LaunchSuccessHeroProps) {
  const colors = useColors();
  const cardScale = useRef(new Animated.Value(0.8)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const numberScale = useRef(new Animated.Value(1)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(cardScale, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.back(1.6)),
          useNativeDriver: true,
        }),
        Animated.timing(cardOpacity, {
          toValue: 1,
          duration: 320,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.sequence([
          Animated.timing(numberScale, {
            toValue: 1.18,
            duration: 220,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(numberScale, {
            toValue: 1,
            duration: 240,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(taglineOpacity, {
          toValue: 1,
          duration: 380,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [cardScale, cardOpacity, numberScale, taglineOpacity]);

  const headline = platformsPosted === 1
    ? "You just launched 1 video"
    : `You just launched ${platformsPosted} videos`;

  return (
    <Animated.View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.tint,
          opacity: cardOpacity,
          transform: [{ scale: cardScale }],
        },
      ]}
    >
      <View style={[styles.iconRing, { borderColor: colors.tint, backgroundColor: colors.tint + "22" }]}>
        <Feather name="zap" size={28} color={colors.tint} />
      </View>

      <Animated.Text
        style={[
          styles.headline,
          { color: colors.foreground, transform: [{ scale: numberScale }] },
        ]}
      >
        {headline}
      </Animated.Text>

      <Animated.Text
        style={[styles.tagline, { color: colors.mutedForeground, opacity: taglineOpacity }]}
      >
        …while you lived your life.
      </Animated.Text>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      <Text style={[styles.body, { color: colors.foreground }]}>
        {summary}
      </Text>
      {platformsBlocked > 0 && (
        <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
          The Compliance Shield held back {platformsBlocked} platform
          {platformsBlocked === 1 ? "" : "s"} so you don't have to deal with a takedown.
        </Text>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1.5,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 18,
    alignItems: "center",
    gap: 6,
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOpacity: 0.18, shadowOffset: { width: 0, height: 6 }, shadowRadius: 18 },
      android: { elevation: 6 },
      default: {},
    }),
  },
  iconRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  headline: {
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.4,
    textAlign: "center",
  },
  tagline: {
    fontSize: 15,
    fontStyle: "italic",
    textAlign: "center",
    marginTop: 2,
  },
  divider: {
    width: "60%",
    height: StyleSheet.hairlineWidth,
    marginVertical: 14,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  footnote: {
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
    marginTop: 8,
  },
});
