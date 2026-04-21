import React from "react";
import { View, Text, StyleSheet, ScrollView, Platform, Image, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useLocalSearchParams, useRouter } from "expo-router";
import { VIDEOS } from "@/constants/mockData";
import { Feather } from "@expo/vector-icons";

export default function StudioDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();

  const isWeb = Platform.OS === "web";
  const topInset = isWeb ? 67 : insets.top;
  const bottomInset = insets.bottom + 20;

  const video = VIDEOS.find((v) => v.id === id) || VIDEOS[0];

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topInset }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Feather name="chevron-down" size={28} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Swarm Studio</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}>
        <View style={styles.previewContainer}>
          <Image source={video.thumbnail} style={styles.previewImage} />
          <View style={styles.playOverlay}>
            <Feather name="play" size={48} color="white" />
          </View>
        </View>

        <Text style={[styles.title, { color: colors.foreground }]}>{video.title}</Text>
        
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardLabel, { color: colors.mutedForeground }]}>Script & Caption</Text>
          <Text style={[styles.script, { color: colors.foreground }]}>{video.script}</Text>
        </View>
        
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  placeholder: {
    width: 44,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  previewContainer: {
    width: "100%",
    aspectRatio: 9 / 16,
    borderRadius: 24,
    overflow: "hidden",
    marginBottom: 24,
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.3)",
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 24,
  },
  card: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
  },
  cardLabel: {
    fontSize: 14,
    marginBottom: 12,
    fontWeight: "500",
  },
  script: {
    fontSize: 16,
    lineHeight: 24,
  },
});
