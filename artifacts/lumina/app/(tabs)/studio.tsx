import React from "react";
import { View, Text, StyleSheet, ScrollView, Platform, Image, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { VIDEOS } from "@/constants/mockData";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";

export default function StudioScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const router = useRouter();

  const isWeb = Platform.OS === "web";
  const topInset = isWeb ? 67 : insets.top;
  const bottomInset = isWeb ? 84 : insets.bottom + 60;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingTop: topInset + 20, paddingBottom: bottomInset }}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>Studio</Text>
      </View>

      <View style={styles.list}>
        {VIDEOS.map((video) => (
          <Pressable
            key={video.id}
            style={({ pressed }) => [
              styles.videoCard,
              { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
            ]}
            onPress={() => router.push(`/studio/${video.id}`)}
          >
            <Image source={video.thumbnail} style={styles.thumbnail} />
            <View style={styles.info}>
              <Text style={[styles.videoTitle, { color: colors.foreground }]} numberOfLines={2}>
                {video.title}
              </Text>
              <Text style={[styles.status, { color: colors.tint }]}>{video.status}</Text>
            </View>
          </Pressable>
        ))}
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
    marginBottom: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
  },
  list: {
    paddingHorizontal: 24,
    gap: 16,
  },
  videoCard: {
    flexDirection: "row",
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  thumbnail: {
    width: 100,
    height: 100,
  },
  info: {
    flex: 1,
    padding: 16,
    justifyContent: "center",
  },
  videoTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
  },
  status: {
    fontSize: 14,
    fontWeight: "500",
  },
});
