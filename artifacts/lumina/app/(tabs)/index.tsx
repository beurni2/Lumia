import React from "react";
import { View, Text, StyleSheet, ScrollView, Image, Platform, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { CURRENT_USER, TREND_BRIEFS, EARNINGS } from "@/constants/mockData";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const router = useRouter();

  const isWeb = Platform.OS === "web";
  const topInset = isWeb ? 67 : insets.top;
  const bottomInset = isWeb ? 84 : insets.bottom + 60; // Extra padding for tab bar

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingTop: topInset + 20, paddingBottom: bottomInset }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <View style={styles.greeting}>
          <Text style={[styles.greetingText, { color: colors.foreground }]}>
            Bom dia, {CURRENT_USER.name}
          </Text>
          <Text style={[styles.subGreeting, { color: colors.mutedForeground }]}>
            The swarm cooked up 3 ideas while you slept.
          </Text>
        </View>
        <Image source={CURRENT_USER.image} style={styles.avatar} />
      </View>

      <View style={styles.section}>
        <Pressable
          onPress={() => router.push("/while-you-slept")}
          style={({ pressed }) => [
            styles.recapCard,
            { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <View style={styles.recapHeader}>
            <Feather name="star" size={20} color={colors.accent} />
            <Text style={[styles.recapTitle, { color: colors.foreground }]}>While You Slept</Text>
            <View style={{ flex: 1 }} />
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </View>
          <View style={styles.recapStats}>
            <View style={styles.recapStat}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>+142</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Followers</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.recapStat}>
              <Text style={[styles.statValue, { color: colors.foreground }]}>
                {EARNINGS.currency} 425
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Earned</Text>
            </View>
          </View>
          <Text style={[styles.recapCta, { color: colors.tint }]}>
            Open full overnight recap →
          </Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Today's Trend Briefs</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trendsContainer}>
          {TREND_BRIEFS.map((trend) => (
            <Pressable
              key={trend.id}
              style={({ pressed }) => [
                styles.trendCard,
                { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
              ]}
              onPress={() => router.push(`/studio/new?trendId=${trend.id}`)}
            >
              <Image source={trend.image} style={styles.trendImage} />
              <View style={styles.trendContent}>
                <View style={[styles.tag, { backgroundColor: colors.muted }]}>
                  <Text style={[styles.tagText, { color: colors.tint }]}>{trend.context}</Text>
                </View>
                <Text style={[styles.trendTitle, { color: colors.foreground }]} numberOfLines={2}>
                  {trend.title}
                </Text>
                <View style={styles.viralScore}>
                  <Feather name="trending-up" size={14} color={colors.accent} />
                  <Text style={[styles.viralScoreText, { color: colors.accent }]}>
                    {trend.viralPotential}% Viral Potential
                  </Text>
                </View>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    marginBottom: 32,
  },
  greeting: {
    flex: 1,
  },
  greetingText: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 4,
  },
  subGreeting: {
    fontSize: 16,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginLeft: 16,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 16,
    paddingHorizontal: 24,
  },
  recapCard: {
    marginHorizontal: 24,
    padding: 20,
    borderRadius: 24,
    borderWidth: 1,
  },
  recapHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    gap: 8,
  },
  recapTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  recapStats: {
    flexDirection: "row",
    alignItems: "center",
  },
  recapStat: {
    flex: 1,
  },
  statValue: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
  },
  statDivider: {
    width: 1,
    height: 40,
    marginHorizontal: 20,
  },
  recapCta: {
    fontSize: 13,
    fontWeight: "600",
    marginTop: 14,
  },
  trendsContainer: {
    paddingHorizontal: 24,
    gap: 16,
  },
  trendCard: {
    width: 280,
    borderRadius: 24,
    borderWidth: 1,
    overflow: "hidden",
  },
  trendImage: {
    width: "100%",
    height: 160,
  },
  trendContent: {
    padding: 16,
  },
  tag: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 8,
  },
  tagText: {
    fontSize: 12,
    fontWeight: "600",
  },
  trendTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
  },
  viralScore: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  viralScoreText: {
    fontSize: 14,
    fontWeight: "500",
  },
});
