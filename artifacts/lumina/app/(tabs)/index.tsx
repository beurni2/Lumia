/**
 * Home — the floating greeter.
 *
 * Bioluminescent redesign:
 *   • Cosmic backdrop with ambient firefly drift
 *   • Hero greeting + creator avatar nestled inside a small Style Twin
 *     orb (the "you, but the swarm version of you")
 *   • While You Slept stat card on a glass surface, with cyan firefly
 *     ticks for the metric values
 *   • Today's Trend Briefs in horizontally-scrolling glass cards, each
 *     with a viral-score halo whose intensity scales with the score
 */

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  useGetCurrentCreator,
  useGetEarningsSummary,
  useListTrendBriefs,
} from "@workspace/api-client-react";

import { CosmicBackdrop } from "@/components/foundation/CosmicBackdrop";
import { FireflyParticles } from "@/components/foundation/FireflyParticles";
import { GlassSurface } from "@/components/foundation/GlassSurface";
import { StyleTwinOrb } from "@/components/foundation/StyleTwinOrb";
import { lumina } from "@/constants/colors";
import { type } from "@/constants/typography";
import { feedback } from "@/lib/feedback";
import { getImage } from "@/lib/imageRegistry";

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data: creator } = useGetCurrentCreator();
  const { data: earnings } = useGetEarningsSummary();
  const { data: trendsData } = useListTrendBriefs();
  const trendBriefs = trendsData?.briefs ?? [];
  const lastEarning = earnings?.history?.at(-1);

  const isWeb = Platform.OS === "web";
  const topInset = isWeb ? 24 : insets.top;
  // Floating Hive Tab Ring needs ~24pt of breathing room below content.
  const bottomInset = isWeb ? 108 : insets.bottom + 108;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <CosmicBackdrop bloom>
        <FireflyParticles count={18} ambient />
      </CosmicBackdrop>

      <ScrollView
        contentContainerStyle={{
          paddingTop: topInset + 12,
          paddingBottom: bottomInset,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Greeting hero */}
        <View style={styles.hero}>
          <View style={styles.heroText}>
            <Text style={[type.label, styles.eyebrow]}>good morning</Text>
            <Text style={[type.subhead, styles.greeting]}>
              {creator?.name ?? "—"}
            </Text>
            <Text style={[type.microDelight, styles.subGreeting]}>
              the swarm cooked up 3 ideas while you slept
            </Text>
          </View>

          {/* Creator avatar nestled in the StyleTwin orb */}
          <View style={styles.orbAvatar}>
            <StyleTwinOrb size={88} mood="idle">
              <Image source={getImage(creator?.imageKey)} style={styles.avatarImg} />
            </StyleTwinOrb>
          </View>
        </View>

        {/* While You Slept */}
        <Animated.View
          entering={FadeInDown.duration(520).delay(120)}
          style={styles.section}
        >
          <Pressable
            onPress={() => {
              feedback.tap();
              router.push("/while-you-slept");
            }}
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            accessibilityRole="button"
            accessibilityLabel="Open overnight recap"
          >
            <GlassSurface radius={22} agent="ideator" breathing>
              <View style={styles.recapInner}>
                <View style={styles.recapHeader}>
                  <Feather name="moon" size={16} color={lumina.firefly} />
                  <Text style={[type.label, styles.recapTitle]}>
                    while you slept
                  </Text>
                  <View style={styles.flex} />
                  <Feather
                    name="chevron-right"
                    size={18}
                    color="rgba(255,255,255,0.45)"
                  />
                </View>
                <View style={styles.recapStats}>
                  <Stat value="+142" label="new followers" />
                  <View style={styles.statDivider} />
                  <Stat
                    value={
                      earnings && lastEarning != null
                        ? `${earnings.currency} ${lastEarning}`
                        : "—"
                    }
                    label="earned"
                  />
                </View>
                <Text style={[type.microDelight, styles.recapCta]}>
                  ✦ tap for the full overnight recap
                </Text>
              </View>
            </GlassSurface>
          </Pressable>
        </Animated.View>

        {/* Trend briefs */}
        <Animated.View
          entering={FadeInDown.duration(520).delay(260)}
          style={styles.section}
        >
          <Text style={[type.subheadSm, styles.sectionTitle]}>
            today's trend briefs
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.trendsRow}
            decelerationRate="fast"
            snapToInterval={296}
          >
            {trendBriefs.map((trend) => (
              <Pressable
                key={trend.id}
                style={({ pressed }) => [
                  styles.trendCard,
                  { opacity: pressed ? 0.85 : 1 },
                ]}
                onPress={() => {
                  feedback.spark();
                  router.push(`/studio/new?trendId=${trend.id}`);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Open trend: ${trend.title}`}
              >
                <GlassSurface
                  radius={22}
                  agent={
                    trend.viralPotential >= 90
                      ? "director"
                      : trend.viralPotential >= 80
                        ? "ideator"
                        : "monetizer"
                  }
                >
                  <Image
                    source={getImage(trend.imageKey)}
                    style={styles.trendImage}
                    resizeMode="cover"
                  />
                  <View style={styles.trendContent}>
                    <Text style={[type.microDelight, styles.trendContext]}>
                      {trend.context}
                    </Text>
                    <Text
                      style={[type.subheadSm, styles.trendTitle]}
                      numberOfLines={2}
                    >
                      {trend.title}
                    </Text>
                    <ViralScore score={trend.viralPotential} />
                  </View>
                </GlassSurface>
              </Pressable>
            ))}
          </ScrollView>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[type.subhead, styles.statValue]}>{value}</Text>
      <Text style={[type.microDelight, styles.statLabel]}>{label}</Text>
    </View>
  );
}

function ViralScore({ score }: { score: number }) {
  const tone = score >= 90 ? lumina.spark : score >= 80 ? lumina.firefly : lumina.coreSoft;
  return (
    <View style={styles.viralWrap}>
      <View
        style={[
          styles.viralDot,
          { backgroundColor: tone, boxShadow: `0 0 6px ${tone}` as never },
        ]}
      />
      <Text style={[type.label, { color: tone, fontSize: 13 }]}>
        {score}% viral potential
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0A0824" },
  hero: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 22,
    marginBottom: 28,
  },
  heroText: { flex: 1 },
  eyebrow: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  greeting: { color: "#FFFFFF", marginBottom: 6 },
  subGreeting: { color: "rgba(255,255,255,0.7)", fontSize: 13 },
  orbAvatar: { width: 100, height: 100, alignItems: "center", justifyContent: "center" },
  avatarImg: { width: 56, height: 56, borderRadius: 999 },
  section: { marginBottom: 28 },
  recapInner: { padding: 18 },
  recapHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 },
  recapTitle: {
    color: "#FFFFFF",
    fontSize: 13,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  flex: { flex: 1 },
  recapStats: { flexDirection: "row", alignItems: "center", marginHorizontal: 6 },
  stat: { flex: 1 },
  statValue: { color: "#FFFFFF", fontSize: 28, lineHeight: 32 },
  statLabel: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    marginTop: 2,
    textTransform: "lowercase",
  },
  statDivider: {
    width: 1,
    height: 36,
    backgroundColor: "rgba(255,255,255,0.12)",
    marginHorizontal: 14,
  },
  recapCta: {
    color: "rgba(0,255,204,0.9)",
    marginTop: 14,
    fontSize: 12,
  },
  sectionTitle: {
    color: "#FFFFFF",
    paddingHorizontal: 22,
    marginBottom: 14,
    fontSize: 20,
    textTransform: "lowercase",
  },
  trendsRow: { paddingHorizontal: 22, gap: 16 },
  trendCard: { width: 280 },
  trendImage: {
    width: "100%",
    height: 150,
  },
  trendContent: { padding: 14, gap: 8 },
  trendContext: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  trendTitle: { color: "#FFFFFF", fontSize: 18, lineHeight: 22 },
  viralWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  viralDot: { width: 7, height: 7, borderRadius: 999 },
});
