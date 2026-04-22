/**
 * Swarm Studio — the centerpiece masterpiece screen.
 *
 * Pass A scaffold:
 *   • Cosmic backdrop + ambient firefly layer
 *   • Header with the video title + dismiss control
 *   • Top constellation: 4 agent avatars in elliptical orbit around the
 *     Hive Core, with thin neural threads that brighten on the active agent
 *   • Cinematic preview with 9:16 safe-zone overlays + film burn edges
 *   • Reasoning bubble stack — surfaces the active agent's thought
 *
 * Pass B (next iteration) will add:
 *   • Bottom lily-pad input with rising suggestion fireflies
 *   • "Let the Hive Publish" portal CTA + light-explosion transition
 *   • Live wiring to swarm-studio's mockOrchestrator
 */

import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CosmicBackdrop } from "@/components/foundation/CosmicBackdrop";
import { FireflyParticles } from "@/components/foundation/FireflyParticles";
import { GlassSurface } from "@/components/foundation/GlassSurface";
import { AgentConstellation } from "@/components/studio/AgentConstellation";
import { ReasoningBubble } from "@/components/studio/ReasoningBubble";
import { type AgentKey } from "@/constants/colors";
import { type } from "@/constants/typography";
import { VIDEOS } from "@/constants/mockData";

const REASONING_TIMELINE: Array<{
  agent: AgentKey;
  text: string;
}> = [
  {
    agent: "ideator",
    text: "Hook lands at 0.4s. Let's open on the cargo flip mid-cut — pattern-interrupt your audience expects.",
  },
  {
    agent: "director",
    text: "Vertical 9:16, two-cut intro. Holding the talking-head close-up for confidence.",
  },
  {
    agent: "editor",
    text: "Tightening pacing to 1.2× on the middle 8s — your retention curve needed it.",
  },
  {
    agent: "monetizer",
    text: "Brand fit: Depop affiliate, $0.18 RPM uplift if we tag in caption. Drafting now.",
  },
];

export default function SwarmStudioScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);

  const isWeb = Platform.OS === "web";
  const topInset = isWeb ? 24 : insets.top;
  const bottomInset = insets.bottom + 24;

  const video = VIDEOS.find((v) => v.id === id) ?? VIDEOS[0];

  // Cycle the active agent every ~3.6 s so the constellation feels alive.
  useEffect(() => {
    const id = setInterval(() => {
      setStep((s) => (s + 1) % REASONING_TIMELINE.length);
    }, 3600);
    return () => clearInterval(id);
  }, []);

  const current = REASONING_TIMELINE[step]!;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <CosmicBackdrop bloom>
        <FireflyParticles count={14} ambient />
      </CosmicBackdrop>

      <View style={[styles.header, { paddingTop: topInset + 8 }]}>
        <Pressable
          onPress={() => router.back()}
          style={styles.iconBtn}
          hitSlop={12}
        >
          <Feather name="chevron-down" size={24} color="#FFFFFF" />
        </Pressable>
        <View style={styles.headerCentre}>
          <Text style={[type.label, styles.headerEyebrow]}>swarm studio</Text>
          <Text style={[type.subheadSm, styles.headerTitle]} numberOfLines={1}>
            {video?.title ?? "Untitled"}
          </Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      {/* The constellation — the masterpiece centrepiece */}
      <View style={styles.constellation}>
        <AgentConstellation
          size={320}
          active={current.agent}
          agreeing={
            step % 4 === 0 ? ["ideator", "director", "editor", "monetizer"] : []
          }
        />
      </View>

      {/* Reasoning bubble — surfaces the active agent's thought */}
      <View style={styles.bubbleSlot}>
        <ReasoningBubble
          key={`${current.agent}-${step}`}
          agent={current.agent}
          text={current.text}
        />
      </View>

      {/* Cinematic preview with 9:16 safe-zone */}
      <View style={[styles.previewWrap, { paddingBottom: bottomInset }]}>
        <GlassSurface radius={28} agent={current.agent} breathing>
          <View style={styles.previewInner}>
            {video?.thumbnail ? (
              <Image source={video.thumbnail} style={styles.previewImage} />
            ) : (
              <View
                style={[styles.previewImage, { backgroundColor: "#15123A" }]}
              />
            )}

            {/* Safe-zone overlay: TikTok/Reels UI chrome guides */}
            <View pointerEvents="none" style={styles.safeZone}>
              <View style={styles.safeTop} />
              <View style={styles.safeBottom} />
              <View style={styles.safeRight} />
            </View>

            {/* Film burn edges */}
            <View pointerEvents="none" style={styles.filmBurn} />

            <View style={styles.previewMeta}>
              <Text style={[type.microDelight, styles.previewLabel]}>
                ✦ live preview · safe-zone honoured
              </Text>
            </View>
          </View>
        </GlassSurface>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0A0824",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  headerCentre: {
    flex: 1,
    alignItems: "center",
  },
  headerEyebrow: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  headerTitle: {
    color: "#FFFFFF",
    marginTop: 2,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  constellation: {
    alignItems: "center",
    justifyContent: "center",
    height: 320,
  },
  bubbleSlot: {
    paddingHorizontal: 22,
    minHeight: 110,
    justifyContent: "center",
  },
  previewWrap: {
    flex: 1,
    paddingHorizontal: 22,
    paddingTop: 14,
  },
  previewInner: {
    aspectRatio: 9 / 16,
    width: "100%",
    overflow: "hidden",
    position: "relative",
  },
  previewImage: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },
  safeZone: {
    ...StyleSheet.absoluteFillObject,
  },
  safeTop: {
    position: "absolute",
    top: "12%",
    left: 12,
    right: 12,
    height: 1,
    backgroundColor: "rgba(0,255,204,0.35)",
    borderStyle: "dashed",
    borderWidth: 0.5,
    borderColor: "rgba(0,255,204,0.35)",
  },
  safeBottom: {
    position: "absolute",
    bottom: "22%",
    left: 12,
    right: 12,
    height: 1,
    backgroundColor: "rgba(0,255,204,0.35)",
  },
  safeRight: {
    position: "absolute",
    top: 12,
    bottom: 12,
    right: "18%",
    width: 1,
    backgroundColor: "rgba(0,255,204,0.35)",
  },
  filmBurn: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24,
    borderWidth: 12,
    borderColor: "rgba(10,8,36,0.6)",
    shadowColor: "#000000",
    shadowOpacity: 0.65,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 18,
  },
  previewMeta: {
    position: "absolute",
    bottom: 14,
    left: 16,
    right: 16,
  },
  previewLabel: {
    color: "rgba(0,255,204,0.85)",
  },
});
