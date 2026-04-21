import React from "react";
import { View, Text, StyleSheet, ScrollView, Platform, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { EARNINGS } from "@/constants/mockData";
import { Feather } from "@expo/vector-icons";

export default function EarningsScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();

  const isWeb = Platform.OS === "web";
  const topInset = isWeb ? 67 : insets.top;
  const bottomInset = isWeb ? 84 : insets.bottom + 60;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingTop: topInset + 20, paddingBottom: bottomInset }}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>Earnings</Text>
      </View>

      <View style={styles.hero}>
        <Text style={[styles.heroLabel, { color: colors.mutedForeground }]}>Current Month</Text>
        <Text style={[styles.heroAmount, { color: colors.foreground }]}>
          {EARNINGS.currency} {EARNINGS.currentMonth.toLocaleString()}
        </Text>
        <View style={[styles.growthTag, { backgroundColor: colors.muted }]}>
          <Feather name="arrow-up-right" size={16} color={colors.tint} />
          <Text style={[styles.growthText, { color: colors.tint }]}>{EARNINGS.growth} vs last month</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Brand Deals</Text>
        <View style={styles.dealsList}>
          {EARNINGS.deals.map((deal) => (
            <View key={deal.id} style={[styles.dealCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.dealInfo}>
                <Text style={[styles.dealBrand, { color: colors.foreground }]}>{deal.brand}</Text>
                <Text style={[styles.dealStatus, { color: colors.mutedForeground }]}>{deal.status}</Text>
              </View>
              <Text style={[styles.dealAmount, { color: colors.foreground }]}>
                {EARNINGS.currency} {deal.amount.toLocaleString()}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 24,
    marginBottom: 32,
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
  },
  hero: {
    paddingHorizontal: 24,
    marginBottom: 40,
    alignItems: "center",
  },
  heroLabel: {
    fontSize: 16,
    marginBottom: 8,
  },
  heroAmount: {
    fontSize: 48,
    fontWeight: "800",
    marginBottom: 16,
  },
  growthTag: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 100,
    gap: 6,
  },
  growthText: {
    fontSize: 14,
    fontWeight: "600",
  },
  section: {
    paddingHorizontal: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 16,
  },
  dealsList: {
    gap: 12,
  },
  dealCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  dealInfo: {
    gap: 4,
  },
  dealBrand: {
    fontSize: 16,
    fontWeight: "600",
  },
  dealStatus: {
    fontSize: 14,
  },
  dealAmount: {
    fontSize: 16,
    fontWeight: "600",
  },
});
