import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, Stack } from "expo-router";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { Feather } from "@expo/vector-icons";
import {
  MIN_SAMPLES,
  grantConsent,
  retrain,
  train,
  type VideoSample,
} from "@workspace/style-twin";

import { useColors } from "@/hooks/useColors";
import { useStyleTwin } from "@/hooks/useStyleTwin";
import { getInferenceAdapter } from "@/lib/inferenceFactory";

export default function StyleTwinTrainScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { twin, refresh } = useStyleTwin();
  const adapter = getInferenceAdapter();
  const [samples, setSamples] = useState<VideoSample[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const isRetrain = !!twin;
  const required = isRetrain ? 1 : MIN_SAMPLES;

  const pickVideos = useCallback(async () => {
    setError(null);
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsMultipleSelection: true,
      selectionLimit: required,
      quality: 1,
    });
    if (res.canceled) return;
    const fresh: VideoSample[] = res.assets.map((a, i) => ({
      id: `${Date.now()}-${i}-${a.assetId ?? a.uri.slice(-12)}`,
      uri: a.uri,
      durationMs: a.duration ?? 0,
      capturedAt: Date.now(),
    }));
    setSamples((prev) => [...prev, ...fresh].slice(0, required));
    Haptics.selectionAsync();
  }, [required]);

  const remove = useCallback((id: string) => {
    setSamples((prev) => prev.filter((s) => s.id !== id));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const onTrain = useCallback(async () => {
    if (samples.length < required) return;
    setBusy(true);
    setError(null);
    setStatus(isRetrain ? "Retraining your Style Twin…" : "Training your Style Twin…");
    try {
      if (isRetrain) {
        const consent = grantConsent("retrain");
        const { twin: t, durationMs } = await retrain(samples, adapter, consent);
        setStatus(`Retrained v${t.version} in ${durationMs}ms`);
      } else {
        const consent = grantConsent("train");
        const { twin: t, durationMs } = await train(samples, adapter, consent);
        setStatus(`Trained v${t.version} in ${durationMs}ms`);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await refresh();
      setTimeout(() => router.back(), 700);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Training failed");
      setStatus(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(false);
    }
  }, [samples, adapter, isRetrain, refresh, required]);

  const ready = samples.length >= required;
  const remaining = required - samples.length;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: isRetrain ? "Retrain Style Twin" : "Train Style Twin",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerShadowVisible: false,
        }}
      />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.eyebrow, { color: colors.primary }]}>
          {isRetrain ? "Refresh your clone" : "Step 1 of 1"}
        </Text>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {isRetrain
            ? "Add new videos to sharpen your Twin"
            : "Train your Style Twin"}
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {isRetrain
            ? "Drop in 1+ recent videos. Lumina blends them into your existing Twin in seconds."
            : "Drop in 10 of your recent videos. Lumina learns your voice, pacing, and look — entirely on your phone. Nothing is uploaded."}
        </Text>

        <View
          style={[
            styles.consent,
            { borderColor: colors.border, backgroundColor: colors.card },
          ]}
        >
          <Feather name="lock" size={16} color={colors.primary} />
          <Text style={[styles.consentText, { color: colors.mutedForeground }]}>
            Encrypted on this device · single-use consent · wipe anytime
          </Text>
        </View>

        <View style={styles.grid}>
          {Array.from({ length: required }).map((_, i) => {
            const s = samples[i];
            const filled = !!s;
            return (
              <Pressable
                key={i}
                onPress={filled ? () => remove(s.id) : pickVideos}
                style={({ pressed }) => [
                  styles.tile,
                  {
                    backgroundColor: filled ? colors.primary : colors.card,
                    borderColor: colors.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
                testID={`tile-${i}`}
              >
                {filled ? (
                  <Feather
                    name="check"
                    size={22}
                    color={colors.primaryForeground}
                  />
                ) : (
                  <Text style={{ color: colors.mutedForeground, fontSize: 16 }}>
                    {i + 1}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>

        <View style={[styles.adapterBadge, { backgroundColor: colors.muted }]}>
          <Feather name="cpu" size={12} color={colors.mutedForeground} />
          <Text style={[styles.adapterText, { color: colors.mutedForeground }]}>
            {adapter.mode === "executorch"
              ? "On-device quantized swarm"
              : "Mock inference (Expo Go) — quantized models in dev build"}
          </Text>
        </View>

        {status && (
          <Text style={[styles.status, { color: colors.primary }]}>{status}</Text>
        )}
        {error && (
          <Text style={[styles.error, { color: colors.destructive }]}>
            {error}
          </Text>
        )}

        <Pressable
          disabled={!ready || busy}
          onPress={onTrain}
          style={({ pressed }) => [
            styles.cta,
            {
              backgroundColor: ready ? colors.primary : colors.muted,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
          testID="train-style-twin"
        >
          {busy ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text
              style={[
                styles.ctaText,
                {
                  color: ready
                    ? colors.primaryForeground
                    : colors.mutedForeground,
                },
              ]}
            >
              {ready
                ? isRetrain
                  ? "Retrain Style Twin"
                  : "Train Style Twin"
                : `Add ${remaining} more`}
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 24, gap: 16 },
  eyebrow: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  title: { fontSize: 32, fontWeight: "700", lineHeight: 38 },
  subtitle: { fontSize: 15, lineHeight: 22, marginBottom: 8 },
  consent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  consentText: { fontSize: 13, flexShrink: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 16 },
  tile: {
    width: "18.5%",
    aspectRatio: 9 / 16,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  adapterBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    marginTop: 8,
  },
  adapterText: { fontSize: 11 },
  status: { fontSize: 14, marginTop: 8, fontWeight: "600" },
  error: { fontSize: 14, marginTop: 8, fontWeight: "600" },
  cta: {
    marginTop: 24,
    paddingVertical: 18,
    borderRadius: 18,
    alignItems: "center",
  },
  ctaText: { fontSize: 16, fontWeight: "700", letterSpacing: 0.3 },
});
