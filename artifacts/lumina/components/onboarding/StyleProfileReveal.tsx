/**
 * The payoff moment after the 3rd video import — shows the user
 * the rule-based Style Profile we just derived from their region
 * + clip metadata, then hands off to Home.
 *
 * Five rows mirror the five meaningful sections of the v1 schema
 * (`styleProfileSchema` on the server): hook style, caption tone,
 * pacing, topic focus, language. Keyword chips appear under
 * "topic focus" only when filename mining produced something
 * non-trivial, which is rare for gallery clips and that's fine —
 * the four other rows still feel meaningful.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import type { Bundle } from "@/constants/regions";
import { lumina } from "@/constants/colors";
import { fontFamily, type } from "@/constants/typography";
import {
  CONTENT_TYPE_LABELS,
  HOOK_LABELS,
  LANGUAGE_LABELS,
  TONE_LABELS,
  type DerivedStyleProfile,
} from "@/lib/deriveStyleProfile";

export function StyleProfileReveal({
  profile,
  region,
  onEnter,
  busy,
}: {
  profile: DerivedStyleProfile;
  region: Bundle;
  onEnter: () => void;
  busy?: boolean;
}) {
  const slang = profile.language.slangMarkers.slice(0, 3);
  const keywords = profile.topics.keywords.slice(0, 6);

  return (
    <Animated.View entering={FadeIn.duration(280)} style={styles.stage}>
      <Text style={styles.stepKicker}>Step 3 of 3 · ready</Text>
      <Text style={styles.heroTitle}>This is your style.</Text>
      <Text style={styles.heroSub}>
        We tuned the ideator to your region and your clips. Open the app to
        see today's three ideas.
      </Text>

      <View style={styles.card}>
        <ProfileRow
          label="Hook style"
          value={HOOK_LABELS[profile.hookStyle.primary]}
        />
        <ProfileRow
          label="Caption tone"
          value={TONE_LABELS[profile.captionStyle.tone]}
        />
        <ProfileRow
          label="Pacing"
          value={`${profile.pacing.avgVideoDurationSeconds}s clips`}
        />
        <ProfileRow
          label="Topic focus"
          value={CONTENT_TYPE_LABELS[profile.topics.contentType]}
          chips={keywords}
        />
        <ProfileRow
          label="Language"
          value={LANGUAGE_LABELS[profile.language.primary]}
          chips={slang}
          last
        />
      </View>

      <Text style={styles.footnote}>
        We'll keep tuning this as you import more clips. {regionTagline(region)}
      </Text>

      <Pressable
        onPress={onEnter}
        disabled={busy}
        style={({ pressed }) => [
          styles.primary,
          pressed && !busy ? styles.primaryPressed : null,
          busy ? styles.primaryDisabled : null,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Open Lumina"
      >
        <Text style={styles.primaryLabel}>
          {busy ? "Opening Lumina…" : "Open Lumina"}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

function ProfileRow({
  label,
  value,
  chips,
  last,
}: {
  label: string;
  value: string;
  chips?: string[];
  last?: boolean;
}) {
  return (
    <View style={[styles.row, last ? null : styles.rowDivider]}>
      <View style={styles.rowHead}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
      </View>
      {chips && chips.length > 0 ? (
        <View style={styles.chipsRow}>
          {chips.map((c) => (
            <View key={c} style={styles.chip}>
              <Text style={styles.chipText}>{c}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function regionTagline(b: Bundle): string {
  switch (b) {
    case "western":
      return "Tuned for US/UK/CA/AU audiences.";
    case "india":
      return "Tuned for Indian audiences with light Hinglish.";
    case "philippines":
      return "Tuned for Filipino audiences with light Tagalog.";
    case "nigeria":
      return "Tuned for Nigerian audiences with light Pidgin.";
  }
}

const styles = StyleSheet.create({
  stage: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
  },
  stepKicker: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  heroTitle: {
    ...type.display,
    color: "#FFFFFF",
    marginBottom: 12,
  },
  heroSub: {
    ...type.body,
    color: "rgba(255,255,255,0.7)",
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 24,
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 18,
    padding: 6,
    marginBottom: 18,
  },
  row: {
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  rowHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 12,
  },
  rowLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  rowValue: {
    fontFamily: fontFamily.bodySemiBold,
    color: "#FFFFFF",
    fontSize: 15,
    flexShrink: 1,
    textAlign: "right",
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
    justifyContent: "flex-end",
  },
  chip: {
    backgroundColor: "rgba(0,255,204,0.08)",
    borderColor: "rgba(0,255,204,0.25)",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 12,
  },
  footnote: {
    ...type.body,
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 18,
  },
  primary: {
    backgroundColor: lumina.firefly,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryPressed: {
    opacity: 0.85,
  },
  primaryDisabled: {
    opacity: 0.5,
  },
  primaryLabel: {
    fontFamily: fontFamily.bodyBold,
    color: "#0A0824",
    fontSize: 16,
    letterSpacing: 0.5,
  },
});
