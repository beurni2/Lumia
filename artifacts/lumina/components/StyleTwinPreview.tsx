import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { StyleTwin } from "@workspace/style-twin";
import { useColors } from "@/hooks/useColors";

interface Props {
  twin: StyleTwin | null;
  inferenceMode?: "mock" | "executorch";
}

export function StyleTwinPreview({ twin, inferenceMode }: Props) {
  const colors = useColors();

  if (!twin) {
    return (
      <View
        style={[
          styles.card,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <View style={styles.row}>
          <Feather name="user-x" size={18} color={colors.mutedForeground} />
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>
            No Style Twin yet. Train one to unlock the swarm.
          </Text>
        </View>
      </View>
    );
  }

  const { fingerprint, trainedOnCount, lastRetrainedAt, version } = twin;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.label, { color: colors.mutedForeground }]}>
          Style Twin
        </Text>
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>
          v{version} · {trainedOnCount} videos
        </Text>
      </View>

      <View style={styles.paletteRow}>
        {fingerprint.visual.palette.slice(0, 5).map((p, i) => (
          <View
            key={`${p.hex}-${i}`}
            style={[
              styles.swatch,
              { backgroundColor: p.hex, borderColor: colors.border },
            ]}
          />
        ))}
      </View>

      <View style={styles.statRow}>
        <Stat
          label="Pacing"
          value={`${Math.round(fingerprint.voice.pacingWpm)} wpm`}
          color={colors.foreground}
          muted={colors.mutedForeground}
        />
        <Stat
          label="Temp"
          value={`${Math.round(fingerprint.visual.temperatureKelvin)}K`}
          color={colors.foreground}
          muted={colors.mutedForeground}
        />
        <Stat
          label="Thirds"
          value={fingerprint.visual.framingBias.thirdsScore.toFixed(2)}
          color={colors.foreground}
          muted={colors.mutedForeground}
        />
      </View>

      <View style={styles.row}>
        <Feather name="lock" size={12} color={colors.mutedForeground} />
        <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
          Encrypted on device · {timeAgo(lastRetrainedAt)}
          {inferenceMode === "mock" ? " · mock inference" : ""}
        </Text>
      </View>
    </View>
  );
}

function Stat({
  label,
  value,
  color,
  muted,
}: {
  label: string;
  value: string;
  color: string;
  muted: string;
}) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statLabel, { color: muted }]}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </View>
  );
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1, padding: 18, gap: 14 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: {
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    fontWeight: "600",
  },
  meta: { fontSize: 12 },
  paletteRow: { flexDirection: "row", gap: 8 },
  swatch: { width: 36, height: 36, borderRadius: 8, borderWidth: 1 },
  statRow: { flexDirection: "row", gap: 18 },
  stat: { flex: 1 },
  statLabel: { fontSize: 11, marginBottom: 2 },
  statValue: { fontSize: 18, fontWeight: "700" },
  footnote: { fontSize: 11, flexShrink: 1 },
  empty: { fontSize: 14, flexShrink: 1 },
});
