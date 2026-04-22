/**
 * Earnings — the swarm's payout, with a cosmic skin.
 *
 * Bioluminescent redesign:
 *   • Cosmic backdrop + ambient fireflies
 *   • Hero: chromatic gradient month total (the gold→firefly axis)
 *   • Sparkline: 7-point history ribbon, glowing endpoint
 *   • Brand deals as glass cards with status pills coloured by state
 *     (Paid → firefly, Signed → gold, Negotiating → amethyst)
 */

import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import React, { useMemo } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path } from "react-native-svg";

import { useGetEarningsSummary } from "@workspace/api-client-react";

import { CosmicBackdrop } from "@/components/foundation/CosmicBackdrop";
import { FireflyParticles } from "@/components/foundation/FireflyParticles";
import { GlassSurface } from "@/components/foundation/GlassSurface";
import { lumina } from "@/constants/colors";
import { type } from "@/constants/typography";
import { useCountUp } from "@/hooks/useCountUp";

const STATUS_TONE: Record<string, { hex: string; bg: string }> = {
  Paid: { hex: lumina.firefly, bg: "rgba(0,255,204,0.12)" },
  Signed: { hex: lumina.goldTo, bg: "rgba(255,215,0,0.12)" },
  Negotiating: { hex: lumina.coreSoft, bg: "rgba(139,77,255,0.18)" },
};

export default function EarningsScreen() {
  const insets = useSafeAreaInsets();
  const { data: earnings } = useGetEarningsSummary();
  const animatedAmount = useCountUp(earnings?.currentMonth ?? 0, 1400);
  const deals = earnings?.deals ?? [];
  const history = earnings?.history ?? [];
  const growth = earnings?.growth ?? "";

  const isWeb = Platform.OS === "web";
  const topInset = isWeb ? 24 : insets.top;
  const bottomInset = isWeb ? 84 : insets.bottom + 84;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <CosmicBackdrop bloom>
        <FireflyParticles count={14} ambient />
      </CosmicBackdrop>

      <ScrollView
        contentContainerStyle={{
          paddingTop: topInset + 12,
          paddingBottom: bottomInset,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={[type.label, styles.eyebrow]}>earnings</Text>
        </View>

        {/* Hero: chromatic month total */}
        <View style={styles.hero}>
          <Text style={[type.microDelight, styles.heroLabel]}>
            this month
          </Text>
          <View style={styles.heroAmountWrap}>
            <Text style={[type.numeric, styles.heroAmount]}>
              ${animatedAmount.toLocaleString()}
            </Text>
            {/* Chromatic underline — replaces web-only mix-blend overlay so
                the gold→firefly→spark axis shows on native too. */}
            <LinearGradient
              colors={[lumina.goldFrom, lumina.firefly, lumina.spark] as [
                string,
                string,
                string,
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.heroUnderline}
            />
          </View>
          <View style={styles.growthTag}>
            <Feather name="arrow-up-right" size={14} color={lumina.firefly} />
            <Text style={[type.label, styles.growthText]}>
              {growth} vs last month
            </Text>
          </View>

          {/* Sparkline */}
          <View style={styles.sparklineWrap}>
            <Sparkline data={history} />
          </View>
        </View>

        {/* Deals */}
        <View style={styles.section}>
          <Text style={[type.subheadSm, styles.sectionTitle]}>
            brand deals
          </Text>
          <View style={styles.dealsList}>
            {deals.map((deal) => {
              const tone = STATUS_TONE[deal.status] ?? STATUS_TONE.Negotiating!;
              return (
                <GlassSurface key={deal.id} radius={20}>
                  <View style={styles.dealRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={[type.bodyEmphasis, styles.dealBrand]}>
                        {deal.brand}
                      </Text>
                      <View
                        style={[styles.statusPill, { backgroundColor: tone.bg }]}
                      >
                        <View
                          style={[
                            styles.statusDot,
                            {
                              backgroundColor: tone.hex,
                              boxShadow: `0 0 5px ${tone.hex}` as never,
                            },
                          ]}
                        />
                        <Text style={[type.label, { color: tone.hex, fontSize: 12 }]}>
                          {deal.status.toLowerCase()}
                        </Text>
                      </View>
                    </View>
                    <Text style={[type.subheadSm, styles.dealAmount]}>
                      ${deal.amount.toLocaleString()}
                    </Text>
                  </View>
                </GlassSurface>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function Sparkline({ data }: { data: number[] }) {
  const w = 280;
  const h = 64;
  const pad = 8;

  const { path, endpoint } = useMemo(() => {
    if (data.length === 0) return { path: "", endpoint: { x: 0, y: 0 } };
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = Math.max(1, max - min);
    const dx = (w - pad * 2) / Math.max(1, data.length - 1);
    const points = data.map((v, i) => ({
      x: pad + i * dx,
      y: pad + (h - pad * 2) * (1 - (v - min) / range),
    }));
    let d = `M ${points[0]!.x} ${points[0]!.y}`;
    for (let i = 1; i < points.length; i++) {
      const p0 = points[i - 1]!;
      const p1 = points[i]!;
      const cx = (p0.x + p1.x) / 2;
      d += ` Q ${cx} ${p0.y} ${cx} ${(p0.y + p1.y) / 2} T ${p1.x} ${p1.y}`;
    }
    return { path: d, endpoint: points[points.length - 1]! };
  }, [data]);

  return (
    <Svg width={w} height={h}>
      <Path
        d={path}
        stroke={lumina.firefly}
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.95}
      />
      <Circle cx={endpoint.x} cy={endpoint.y} r={6} fill={lumina.firefly} opacity={0.25} />
      <Circle cx={endpoint.x} cy={endpoint.y} r={3} fill={lumina.firefly} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0A0824" },
  header: { paddingHorizontal: 22, marginBottom: 6 },
  eyebrow: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
    letterSpacing: 1.8,
    textTransform: "uppercase",
  },
  hero: { paddingHorizontal: 22, alignItems: "center", marginBottom: 36 },
  heroLabel: { color: "rgba(255,255,255,0.65)", marginBottom: 6, fontSize: 13 },
  heroAmountWrap: { alignItems: "center" },
  heroAmount: {
    color: "#FFFFFF",
    fontSize: 64,
    lineHeight: 68,
    textShadowColor: "rgba(0,255,204,0.4)",
    textShadowRadius: 22,
    fontVariant: ["tabular-nums"],
  },
  heroUnderline: {
    height: 3,
    width: 180,
    borderRadius: 2,
    marginTop: 4,
    opacity: 0.85,
  },
  growthTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,255,204,0.10)",
    borderColor: "rgba(0,255,204,0.35)",
    borderWidth: 0.5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    marginTop: 10,
  },
  growthText: { color: lumina.firefly, fontSize: 12 },
  sparklineWrap: { marginTop: 22, alignItems: "center" },
  section: { paddingHorizontal: 22 },
  sectionTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    marginBottom: 14,
    textTransform: "lowercase",
  },
  dealsList: { gap: 12 },
  dealRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  dealBrand: { color: "#FFFFFF", marginBottom: 6 },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusDot: { width: 5, height: 5, borderRadius: 999 },
  dealAmount: { color: "#FFFFFF" },
});
