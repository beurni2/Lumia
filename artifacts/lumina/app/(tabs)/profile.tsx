import React from "react";
import { View, Text, StyleSheet, ScrollView, Platform, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { CURRENT_USER } from "@/constants/mockData";

export default function ProfileScreen() {
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
        <Image source={CURRENT_USER.image} style={styles.avatar} />
        <Text style={[styles.name, { color: colors.foreground }]}>{CURRENT_USER.name}</Text>
        <Text style={[styles.location, { color: colors.mutedForeground }]}>{CURRENT_USER.location}</Text>
      </View>

      <View style={styles.section}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Style Twin Status</Text>
          <Text style={[styles.cardDesc, { color: colors.mutedForeground }]}>
            Trained on 42 videos. Last retrained 2 days ago.
          </Text>
          <View style={[styles.button, { backgroundColor: colors.primary }]}>
            <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Retrain Model</Text>
          </View>
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
    alignItems: "center",
    marginBottom: 40,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    marginBottom: 16,
  },
  name: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 4,
  },
  location: {
    fontSize: 16,
  },
  section: {
    paddingHorizontal: 24,
  },
  card: {
    padding: 20,
    borderRadius: 24,
    borderWidth: 1,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  cardDesc: {
    fontSize: 14,
    marginBottom: 24,
  },
  button: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
