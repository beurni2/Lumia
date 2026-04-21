import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { useColors } from "@/hooks/useColors";
import { useStyleTwin } from "@/hooks/useStyleTwin";
import { creatorKeyFor } from "@/lib/publisherFactory";
import {
  buildMorningRecap,
  REFERRAL_BOUNTY_BREAKDOWN,
  type MorningRecap,
} from "@/lib/morningRecapFactory";
import ConfettiBurst from "@/components/ConfettiBurst";

/**
 * "While You Slept" morning recap — Sprint 4 closeout.
 *
 * Lands the closed-loop value prop in a single screen:
 *   - Confetti the moment you open it (the swarm shipped while you slept).
 *   - Hero card: $X earned overnight + 8h shift summary.
 *   - Earnings list: every deposit that hit your wallet (fee take + bounty).
 *   - Referral cash-out callout: both you and your friend just got paid.
 *   - Tomorrow's plan: 3 trend briefs the swarm will tackle today.
 *   - "Open today's queue" CTA → home.
 *
 * Pure read screen. All numbers come from `buildMorningRecap()`, which
 * exercises the full Sprint 4 monetizer stack end to end (auto-match →
 * ledger → escrow → wallet → bounty) so the demo is the contract test.
 */
export default function WhileYouSleptScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const router = useRouter();
  const { twin, loading: twinLoading } = useStyleTwin();

  const isWeb = Platform.OS === "web";
  const topInset = isWeb ? 67 : insets.top;
  const bottomInset = isWeb ? 24 : insets.bottom + 24;

  const [recap, setRecap] = useState<MorningRecap | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    if (twinLoading) return;
    // Fall back to a stable demo key when the user hasn't trained their
    // Twin yet — the recap is read-only and never mutates Twin state.
    const key = twin ? creatorKeyFor(twin) : "lumina-demo-creator";
    (async () => {
      try {
        const r = await buildMorningRecap(key);
        if (mounted) setRecap(r);
      } catch (e) {
        if (mounted) setError(String(e));
      }
    })();
    return () => {
      mounted = false;
    };
  }, [twin, twinLoading]);

  if (!recap) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.background, paddingTop: topInset }]}>
        <ActivityIndicator color={colors.tint} size="large" />
        <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
          {error ?? "Stitching together your overnight earnings…"}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ConfettiBurst pieces={56} durationMs={2200} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingTop: topInset + 12, paddingBottom: bottomInset }}
        showsVerticalScrollIndicator={false}
      >
        {/* Close header */}
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.closeBtn}>
            <Feather name="x" size={22} color={colors.mutedForeground} />
          </Pressable>
          <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>
            Last night · {recap.hoursAsleep}h shift
          </Text>
          <View style={styles.closeBtn} />
        </View>

        {/* Hero earnings card */}
        <View
          style={[
            styles.heroCard,
            { backgroundColor: colors.card, borderColor: colors.tint },
          ]}
        >
          <View
            style={[
              styles.iconRing,
              { borderColor: colors.tint, backgroundColor: colors.tint + "22" },
            ]}
          >
            <Feather name="moon" size={26} color={colors.tint} />
          </View>
          <Text style={[styles.headline, { color: colors.foreground }]}>{recap.headline}</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{recap.subtitle}</Text>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.balanceRow}>
            {Object.entries(recap.totalsByCurrency).map(([cur, amt]) => (
              <View key={cur} style={styles.balanceCell}>
                <Text style={[styles.balanceAmount, { color: colors.foreground }]}>
                  {cur} {(amt ?? 0).toLocaleString()}
                </Text>
                <Text style={[styles.balanceLabel, { color: colors.mutedForeground }]}>
                  {cur === "USD" ? "wallet" : "regional"}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Referral bounty callout */}
        {recap.bounty.fired && (
          <View
            style={[
              styles.bountyCard,
              { backgroundColor: colors.card, borderColor: colors.accent ?? colors.tint },
            ]}
          >
            <View style={styles.bountyIconRow}>
              <Feather name="gift" size={20} color={colors.accent ?? colors.tint} />
              <Text style={[styles.bountyTitle, { color: colors.foreground }]}>
                Referral Rocket fired
              </Text>
            </View>
            <Text style={[styles.bountyBody, { color: colors.mutedForeground }]}>
              Your first overnight payout triggered a real-cash bounty for both sides. You earned{" "}
              <Text style={{ color: colors.foreground, fontWeight: "700" }}>
                ${REFERRAL_BOUNTY_BREAKDOWN.refereeUsd}
              </Text>{" "}
              and your referrer earned{" "}
              <Text style={{ color: colors.foreground, fontWeight: "700" }}>
                ${REFERRAL_BOUNTY_BREAKDOWN.referrerUsd}
              </Text>
              .
            </Text>
            <Text style={[styles.bountyFootnote, { color: colors.mutedForeground }]}>
              Your code: <Text style={{ color: colors.tint, fontWeight: "700" }}>{recap.referralCode}</Text>
            </Text>
          </View>
        )}

        {/* Earnings list */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Deposits overnight</Text>
          {recap.deposits.length === 0 ? (
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              No deposits hit your wallet last night.
            </Text>
          ) : (
            recap.deposits.map((d) => (
              <View
                key={d.id}
                style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <View style={styles.rowLeft}>
                  <View
                    style={[
                      styles.rowDot,
                      {
                        backgroundColor:
                          d.source === "performance-fee-creator-take"
                            ? colors.tint
                            : (colors.accent ?? colors.tint),
                      },
                    ]}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowLabel, { color: colors.foreground }]} numberOfLines={2}>
                      {d.label}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.rowAmount, { color: colors.foreground }]}>
                  +{d.currency} {d.amount.toLocaleString()}
                </Text>
              </View>
            ))
          )}
        </View>

        {/* Tomorrow's plan */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Tomorrow's plan · the swarm queued these
          </Text>
          {recap.tomorrowPlan.map((slot, i) => (
            <View
              key={slot.id}
              style={[styles.planRow, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={[styles.planIndex, { backgroundColor: colors.muted }]}>
                <Text style={[styles.planIndexText, { color: colors.tint }]}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.planTitle, { color: colors.foreground }]} numberOfLines={1}>
                  {slot.title}
                </Text>
                <Text style={[styles.planHook, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {slot.hook}
                </Text>
              </View>
              <View style={[styles.viralPill, { backgroundColor: colors.muted }]}>
                <Feather name="trending-up" size={12} color={colors.tint} />
                <Text style={[styles.viralPillText, { color: colors.tint }]}>{slot.viralPotential}%</Text>
              </View>
            </View>
          ))}
        </View>

        <Pressable
          onPress={() => router.replace("/(tabs)")}
          style={({ pressed }) => [
            styles.cta,
            { backgroundColor: colors.tint, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Feather name="play" size={18} color={colors.background} />
          <Text style={[styles.ctaText, { color: colors.background }]}>Open today's queue</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { fontSize: 14 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    marginBottom: 14,
  },
  closeBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  eyebrow: { fontSize: 13, fontWeight: "500", letterSpacing: 0.4 },
  heroCard: {
    marginHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1.5,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 20,
    alignItems: "center",
    gap: 6,
    marginBottom: 18,
  },
  iconRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  headline: {
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.4,
    textAlign: "center",
  },
  subtitle: { fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 4 },
  divider: { width: "60%", height: StyleSheet.hairlineWidth, marginVertical: 14 },
  balanceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 18,
  },
  balanceCell: { alignItems: "center" },
  balanceAmount: { fontSize: 18, fontWeight: "700" },
  balanceLabel: { fontSize: 11, marginTop: 2, textTransform: "uppercase", letterSpacing: 0.6 },
  bountyCard: {
    marginHorizontal: 16,
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    marginBottom: 22,
    gap: 8,
  },
  bountyIconRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  bountyTitle: { fontSize: 16, fontWeight: "700" },
  bountyBody: { fontSize: 14, lineHeight: 20 },
  bountyFootnote: { fontSize: 12, marginTop: 4 },
  section: { marginHorizontal: 16, marginBottom: 22 },
  sectionTitle: { fontSize: 16, fontWeight: "700", marginBottom: 10, paddingHorizontal: 4 },
  empty: { fontSize: 13, fontStyle: "italic", paddingHorizontal: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    gap: 10,
  },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  rowDot: { width: 8, height: 8, borderRadius: 4 },
  rowLabel: { fontSize: 14, fontWeight: "500" },
  rowAmount: { fontSize: 15, fontWeight: "700" },
  planRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    gap: 12,
  },
  planIndex: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  planIndexText: { fontSize: 13, fontWeight: "700" },
  planTitle: { fontSize: 14, fontWeight: "600" },
  planHook: { fontSize: 12, marginTop: 2 },
  viralPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  viralPillText: { fontSize: 11, fontWeight: "700" },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 18,
    marginTop: 6,
  },
  ctaText: { fontSize: 16, fontWeight: "700" },
});
