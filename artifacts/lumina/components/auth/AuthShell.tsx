/**
 * AuthShell — bioluminescent backdrop + glass card for sign-in / sign-up.
 *
 * Reuses the same cosmic palette and motion primitives as the rest of
 * Lumina so the auth surface feels native, not bolted-on.
 */

import { BlurView } from "expo-blur";
import React from "react";
import { Platform, StyleSheet, Text, View, ScrollView } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { CosmicBackdrop } from "@/components/foundation/CosmicBackdrop";
import { FireflyParticles } from "@/components/foundation/FireflyParticles";
import { StyleTwinOrb } from "@/components/foundation/StyleTwinOrb";
import { lumina } from "@/constants/colors";
import { type } from "@/constants/typography";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
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
            <StyleTwinOrb size={140} mood="idle" />
          </View>
          <Animated.View entering={FadeInDown.duration(420).delay(120)}>
            <Text style={[type.heroDisplay, styles.title]}>{title}</Text>
            <Text style={[type.body, styles.subtitle]}>{subtitle}</Text>
          </Animated.View>
        </View>

        <Animated.View
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
        </Animated.View>

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
  footer: {
    marginTop: 22,
    alignItems: "center",
  },
});
