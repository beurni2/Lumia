/**
 * Onboarding — the cinematic 3-act opener.
 *
 *   Act 1 · GENESIS    Logo collapses into a single point, explodes into
 *                      the Style Twin orb. (~5 s, auto-advances)
 *   Act 2 · AWAKEN     Glowing black-hole upload zone; sleeping fireflies
 *                      wake as the user feeds it 3 video clips.
 *   Act 3 · EMERGE     Supernova transformation — orb scales up, micro-
 *                      delight copy reveals, "Enter the Hive" portal CTA.
 *
 * Target wall time: < 45 seconds. Designed to be impossible to forget.
 */

import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { CosmicBackdrop } from "@/components/foundation/CosmicBackdrop";
import { FireflyParticles } from "@/components/foundation/FireflyParticles";
import { PortalButton } from "@/components/foundation/PortalButton";
import { StyleTwinOrb } from "@/components/foundation/StyleTwinOrb";
import { BlackHoleUpload } from "@/components/onboarding/BlackHoleUpload";
import { lumina } from "@/constants/colors";
import { spring } from "@/constants/motion";
import { type } from "@/constants/typography";
import { useAppState } from "@/hooks/useAppState";

type Act = "genesis" | "awaken" | "emerge";
const TARGET_CLIPS = 3;

export default function OnboardingScreen() {
  const router = useRouter();
  const { setHasCompletedOnboarding } = useAppState();
  const [act, setAct] = useState<Act>("genesis");
  const [clips, setClips] = useState<string[]>([]);

  // Auto-advance Genesis → Awaken after the cinematic plays out.
  useEffect(() => {
    if (act !== "genesis") return;
    const id = setTimeout(() => setAct("awaken"), 4400);
    return () => clearTimeout(id);
  }, [act]);

  // Auto-advance Awaken → Emerge once all fireflies are awake.
  useEffect(() => {
    if (act !== "awaken" || clips.length < TARGET_CLIPS) return;
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    const id = setTimeout(() => setAct("emerge"), 700);
    return () => clearTimeout(id);
  }, [act, clips.length]);

  const handleClip = useCallback((uri: string) => {
    setClips((prev) =>
      prev.length >= TARGET_CLIPS ? prev : [...prev, uri],
    );
  }, []);

  const handleEnter = useCallback(async () => {
    await setHasCompletedOnboarding(true);
    router.replace("/(tabs)");
  }, [router, setHasCompletedOnboarding]);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <CosmicBackdrop bloom>
        <FireflyParticles
          count={act === "genesis" ? 6 : act === "awaken" ? 14 : 28}
          ambient={act !== "emerge"}
        />
      </CosmicBackdrop>

      <View style={styles.stage}>
        {act === "genesis" ? <GenesisAct /> : null}
        {act === "awaken" ? (
          <AwakenAct count={clips.length} onClip={handleClip} />
        ) : null}
        {act === "emerge" ? <EmergeAct onEnter={handleEnter} /> : null}
      </View>

      {/* Skip — only for Genesis, never for Emerge */}
      {act === "genesis" ? (
        <Pressable
          style={styles.skip}
          onPress={() => setAct("awaken")}
          hitSlop={16}
        >
          <Text
            style={[type.microDelight, { color: "rgba(255,255,255,0.5)" }]}
          >
            skip the spectacle
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ─── Act 1 · Genesis ─────────────────────────────────────────────── */

function GenesisAct() {
  const collapse = useSharedValue(0);
  const titleOpacity = useSharedValue(0);

  useEffect(() => {
    // Logo materialises (collapse 0 → 1 = collapsed) then explodes back.
    collapse.value = withSequence(
      withTiming(1, { duration: 1300, easing: Easing.in(Easing.cubic) }),
      withTiming(0, { duration: 800, easing: Easing.out(Easing.back(1.6)) }),
    );
    titleOpacity.value = withDelay(
      1900,
      withTiming(1, { duration: 600 }),
    );
  }, [collapse, titleOpacity]);

  const titleStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ translateY: (1 - titleOpacity.value) * 16 }],
  }));

  // The orb mood moves: idle → collapsed → idle → handed off to Awaken.
  // We approximate by overriding scale via a wrapping Animated.View.
  const orbStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - collapse.value * 0.82 }],
    opacity: 1 - collapse.value * 0.5,
  }));

  return (
    <View style={styles.actCenter}>
      <Animated.View style={orbStyle}>
        <StyleTwinOrb size={260} mood="idle" />
      </Animated.View>
      <Animated.View style={[styles.copyBlock, titleStyle]}>
        <Text style={[type.heroDisplay, styles.heroTitle]}>Lumina</Text>
        <Text style={[type.body, styles.heroSubtitle]}>
          Your private creative constellation.
        </Text>
      </Animated.View>
    </View>
  );
}

/* ─── Act 2 · Awaken ─────────────────────────────────────────────── */

function AwakenAct({
  count,
  onClip,
}: {
  count: number;
  onClip: (uri: string) => void;
}) {
  return (
    <Animated.View
      entering={FadeIn.duration(420)}
      exiting={FadeOut.duration(220)}
      style={styles.actCenter}
    >
      <View style={styles.copyTop}>
        <Text style={[type.subhead, styles.titleAwaken]}>
          Feed the void.
        </Text>
        <Text style={[type.body, styles.subAwaken]}>
          Three clips of you being you.{"\n"}
          The Twin learns your pacing, your humour, your light.
        </Text>
      </View>

      <BlackHoleUpload
        count={count}
        target={TARGET_CLIPS}
        onClipAdded={onClip}
      />

      <Text style={[type.microDelight, styles.privacyNote]}>
        nothing leaves this device · processed locally on Llama 3.2
      </Text>
    </Animated.View>
  );
}

/* ─── Act 3 · Emerge ─────────────────────────────────────────────── */

function EmergeAct({ onEnter }: { onEnter: () => void }) {
  const scale = useSharedValue(0.4);
  const copyOpacity = useSharedValue(0);

  useEffect(() => {
    scale.value = withSpring(1, spring.bloom);
    copyOpacity.value = withDelay(
      450,
      withTiming(1, { duration: 540, easing: Easing.out(Easing.cubic) }),
    );
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [scale, copyOpacity]);

  const orbStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const copyStyle = useAnimatedStyle(() => ({
    opacity: copyOpacity.value,
    transform: [{ translateY: (1 - copyOpacity.value) * 14 }],
  }));

  return (
    <View style={styles.actCenter}>
      <Animated.View style={orbStyle}>
        <StyleTwinOrb size={240} mood="supernova" />
      </Animated.View>

      <Animated.View style={[styles.copyBlock, copyStyle]}>
        <Text style={[type.subhead, styles.emergeTitle]}>
          Your Twin is awake.
        </Text>
        <Text style={[type.microDelight, styles.emergeSub]}>
          she'll get sharper every time you create
        </Text>

        <View style={{ height: 36 }} />

        <PortalButton label="Enter the Hive" onPress={onEnter} />
      </Animated.View>
    </View>
  );
}

/* ─── Styles ─────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0A0824",
  },
  stage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  actCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  copyBlock: {
    alignItems: "center",
    marginTop: 44,
  },
  copyTop: {
    alignItems: "center",
    marginBottom: 38,
  },
  heroTitle: {
    color: "#FFFFFF",
    textAlign: "center",
    textShadowColor: lumina.core,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 24,
  },
  heroSubtitle: {
    color: "rgba(255,255,255,0.7)",
    textAlign: "center",
    marginTop: 12,
    maxWidth: 280,
  },
  titleAwaken: {
    color: "#FFFFFF",
    textAlign: "center",
  },
  subAwaken: {
    color: "rgba(255,255,255,0.7)",
    textAlign: "center",
    marginTop: 10,
    maxWidth: 320,
  },
  privacyNote: {
    color: "rgba(0,255,204,0.65)",
    marginTop: 38,
    textAlign: "center",
  },
  emergeTitle: {
    color: "#FFFFFF",
    textAlign: "center",
  },
  emergeSub: {
    color: "rgba(255,255,255,0.6)",
    textAlign: "center",
    marginTop: 6,
  },
  skip: {
    position: "absolute",
    bottom: 36,
    alignSelf: "center",
    paddingVertical: 8,
    paddingHorizontal: 18,
  },
});
