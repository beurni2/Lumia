import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
  Image,
  Pressable,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useStyleTwin } from "@/hooks/useStyleTwin";
import { StyleTwinPreview } from "@/components/StyleTwinPreview";
import { CURRENT_USER } from "@/constants/mockData";

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const router = useRouter();
  const { twin, loading, isTrained, remove } = useStyleTwin();

  const isWeb = Platform.OS === "web";
  const topInset = isWeb ? 67 : insets.top;
  const bottomInset = isWeb ? 84 : insets.bottom + 60;

  const goTrain = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push("/style-twin-train");
  };

  const onWipe = () => {
    const confirm = async () => {
      await remove();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    };
    if (Platform.OS === "web") {
      if (
        typeof window !== "undefined" &&
        window.confirm("Wipe your Style Twin? This cannot be undone.")
      ) {
        void confirm();
      }
      return;
    }
    Alert.alert(
      "Wipe Style Twin?",
      "Your encrypted Twin will be deleted from this device. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Wipe", style: "destructive", onPress: () => void confirm() },
      ],
    );
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingTop: topInset + 20, paddingBottom: bottomInset }}
    >
      <View style={styles.header}>
        <Image source={CURRENT_USER.image} style={styles.avatar} />
        <Text style={[styles.name, { color: colors.foreground }]}>
          {CURRENT_USER.name}
        </Text>
        <Text style={[styles.location, { color: colors.mutedForeground }]}>
          {CURRENT_USER.location}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
          Personal Style Twin
        </Text>

        <StyleTwinPreview twin={twin} inferenceMode="mock" />

        <Pressable
          onPress={goTrain}
          disabled={loading}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: colors.primary,
              opacity: pressed ? 0.85 : 1,
              marginTop: 16,
            },
          ]}
          testID="train-or-retrain"
        >
          <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
            {isTrained ? "Retrain Style Twin" : "Train Style Twin"}
          </Text>
        </Pressable>

        {isTrained && (
          <Pressable
            onPress={onWipe}
            style={({ pressed }) => [
              styles.buttonGhost,
              {
                borderColor: colors.border,
                opacity: pressed ? 0.7 : 1,
                marginTop: 10,
              },
            ]}
            testID="wipe-twin"
          >
            <Text
              style={[styles.buttonGhostText, { color: colors.destructive }]}
            >
              Wipe Twin from this device
            </Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { alignItems: "center", marginBottom: 32 },
  avatar: { width: 100, height: 100, borderRadius: 50, marginBottom: 16 },
  name: { fontSize: 24, fontWeight: "700", marginBottom: 4 },
  location: { fontSize: 16 },
  section: { paddingHorizontal: 24, gap: 4 },
  sectionLabel: {
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    fontWeight: "600",
    marginBottom: 12,
  },
  button: { paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  buttonText: { fontSize: 16, fontWeight: "600" },
  buttonGhost: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
  },
  buttonGhostText: { fontSize: 14, fontWeight: "600" },
});
