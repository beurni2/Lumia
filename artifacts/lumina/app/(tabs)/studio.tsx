/**
 * Studio — Creator Control Centre.
 *
 * Replaces the previous "swarm orchestration" cinematic Studio with
 * a clear, value-forward control panel that answers four questions
 * for the creator on a single scroll:
 *
 *   1. How does Lumina see my style?               → "Your Creator Style"
 *   2. Can I make it sound more like me?           → "Style Twin"
 *   3. What about my taste is actually working?    → "What's Working"
 *   4. Can I steer the next batch?                 → "Tune Your Ideas"
 *                                                    + "Give me something different"
 *
 * No new backend logic — every section pulls from existing helpers
 * already exposed by the api-server (style-profile + viral-memory
 * summary + imported-videos count + taste-calibration). The data
 * fan-out lives in `useStudioSummary`; this screen is just layout +
 * wiring.
 */

import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { customFetch } from "@workspace/api-client-react";

import { CosmicBackdrop } from "@/components/foundation/CosmicBackdrop";
import { FireflyParticles } from "@/components/foundation/FireflyParticles";
import { lumina } from "@/constants/colors";
import { type Bundle } from "@/constants/regions";
import { fontFamily, type } from "@/constants/typography";
import {
  useStudioSummary,
  type DerivedToneValue,
  type ViralMemorySummary,
} from "@/hooks/useStudioSummary";
import {
  type PreferredFormat,
  type PreferredHookStyle,
  type PreferredTone,
  type TasteCalibration,
  EMPTY_CALIBRATION,
  saveTasteCalibration,
} from "@/lib/tasteCalibration";
import {
  writeDailyIdeas,
  type CachedIdea,
} from "@/lib/dailyIdeasCache";

/* ------------------------------------------------------------------ */
/* Display helpers — turn snake_case enum tags into friendly labels.   */
/* ------------------------------------------------------------------ */

const TONE_LABELS: Record<DerivedToneValue, string> = {
  dry: "Dry / Subtle",
  chaotic: "Chaotic",
  "self-aware": "Self-aware",
  confident: "Confident",
};

const FORMAT_LABELS: Record<string, string> = {
  mini_story: "Mini-stories",
  reaction: "Reactions",
  pov: "POV",
  contrast: "Contrast",
  mixed: "Mixed",
};

const HOOK_STYLE_LABELS: Record<string, string> = {
  the_way_i: "“the way I…”",
  why_do_i: "“why do I…”",
  internal_thought: "Internal thought",
  curiosity: "Curiosity",
  contrast: "Contrast",
};

const EMOTIONAL_SPIKE_LABELS: Record<string, string> = {
  embarrassment: "Embarrassment",
  regret: "Regret",
  denial: "Denial",
  panic: "Panic",
  irony: "Irony",
};

const PREFERRED_FORMATS: { value: PreferredFormat; label: string }[] = [
  { value: "mini_story", label: "Mini-stories" },
  { value: "reaction", label: "Reactions" },
  { value: "pov", label: "POV" },
  { value: "mixed", label: "Mixed" },
];

const PREFERRED_TONES: { value: PreferredTone; label: string }[] = [
  { value: "dry_subtle", label: "Dry" },
  { value: "chaotic", label: "Chaotic" },
  { value: "bold", label: "Bold" },
  { value: "self_aware", label: "Self-aware" },
];

const PREFERRED_HOOK_STYLES: { value: PreferredHookStyle; label: string }[] = [
  { value: "thought_hook", label: "Thought" },
  { value: "behavior_hook", label: "Behavior" },
  { value: "curiosity_hook", label: "Curiosity" },
  { value: "contrast_hook", label: "Contrast" },
];

function labelFromTag(map: Record<string, string>, tag: string): string {
  return map[tag] ?? tag.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

/* ------------------------------------------------------------------ */
/* Idea-shape used by /api/ideator/generate response.                  */
/* ------------------------------------------------------------------ */

type IdeatorResponse = {
  region: Bundle;
  count: number;
  ideas: CachedIdea[];
};

/* ------------------------------------------------------------------ */
/* Screen                                                              */
/* ------------------------------------------------------------------ */

export default function StudioScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const topInset = isWeb ? 24 : insets.top;
  const bottomInset = isWeb ? 120 : insets.bottom + 120;

  const { data, loading, error, refresh } = useStudioSummary();

  // Refetch when the tab regains focus — covers the case where the
  // user just came back from /style-twin-train having uploaded more
  // videos, or from /calibration having tweaked their taste.
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  /* ---------- Reset style ----------------------------------------- */

  const [resetting, setResetting] = useState(false);

  const handleResetStyle = useCallback(() => {
    Alert.alert(
      "Reset your style?",
      "This will clear what Lumina has learned about your style. " +
        "Your uploaded videos stay — re-train any time by adding more.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: async () => {
            setResetting(true);
            try {
              // Posting an empty styleProfile object lets the
              // server's zod schema fill in every default — the
              // persisted JSON ends up at DEFAULT_STYLE_PROFILE,
              // which the ideator treats as "untrained".
              await customFetch("/api/style-profile", {
                method: "POST",
                body: JSON.stringify({ styleProfile: {} }),
              });
              await refresh();
            } catch {
              Alert.alert(
                "Couldn't reset",
                "Try again in a moment.",
              );
            } finally {
              setResetting(false);
            }
          },
        },
      ],
    );
  }, [refresh]);

  /* ---------- Tune your ideas (chips → calibration) ---------------- */

  const [savingTune, setSavingTune] = useState(false);

  const calibration: TasteCalibration =
    data?.calibration ?? EMPTY_CALIBRATION;

  const updateCalibration = useCallback(
    async (patch: Partial<TasteCalibration>) => {
      setSavingTune(true);
      try {
        const next: TasteCalibration = {
          ...calibration,
          ...patch,
          // The server treats taste-calibration as a "last value
          // wins" doc — once the user has touched any chip on this
          // screen, mark it completed so Home stops re-prompting.
          completedAt: calibration.completedAt ?? new Date().toISOString(),
          skipped: false,
        };
        await saveTasteCalibration(next);
        await refresh();
      } catch {
        Alert.alert("Couldn't save", "Try again in a moment.");
      } finally {
        setSavingTune(false);
      }
    },
    [calibration, refresh],
  );

  const toggleFormat = useCallback(
    (value: PreferredFormat) => {
      const cur = calibration.preferredFormats;
      const next = cur.includes(value)
        ? cur.filter((v) => v !== value)
        : [...cur, value];
      void updateCalibration({ preferredFormats: next });
    },
    [calibration.preferredFormats, updateCalibration],
  );

  const toggleHookStyle = useCallback(
    (value: PreferredHookStyle) => {
      const cur = calibration.preferredHookStyles;
      const next = cur.includes(value)
        ? cur.filter((v) => v !== value)
        : [...cur, value];
      void updateCalibration({ preferredHookStyles: next });
    },
    [calibration.preferredHookStyles, updateCalibration],
  );

  const setTone = useCallback(
    (value: PreferredTone) => {
      void updateCalibration({
        preferredTone: calibration.preferredTone === value ? null : value,
      });
    },
    [calibration.preferredTone, updateCalibration],
  );

  /* ---------- Give me something different ------------------------- */

  const [exploring, setExploring] = useState(false);

  const handleGiveMeDifferent = useCallback(async () => {
    if (exploring) return;
    const region = data?.styleProfile?.region;
    if (!region) {
      Alert.alert(
        "Add a region first",
        "Lumina needs to know your region to generate ideas. " +
          "Open Profile to set one.",
      );
      return;
    }
    setExploring(true);
    try {
      const fresh = await customFetch<IdeatorResponse>(
        "/api/ideator/generate",
        {
          method: "POST",
          body: JSON.stringify({ region, count: 3, regenerate: true }),
        },
      );
      await writeDailyIdeas(region, fresh.ideas);
      router.push("/");
    } catch {
      Alert.alert(
        "Couldn't refresh",
        "You may have already used today's refresh slot. " +
          "Try again tomorrow.",
      );
    } finally {
      setExploring(false);
    }
  }, [data?.styleProfile?.region, exploring, router]);

  /* ---------- Derived view-models -------------------------------- */

  const tone = data?.styleProfile?.derivedTone ?? null;
  const memory: ViralMemorySummary | null =
    data?.styleProfile?.viralMemory ?? null;

  const topFormats = useMemo(() => {
    if (!memory) return [];
    return memory.topFormats.slice(0, 3);
  }, [memory]);

  const topHookStyles = useMemo(() => {
    if (!memory) return [];
    return memory.topHookStyles.slice(0, 3);
  }, [memory]);

  const importedCount = data?.importedVideosCount ?? 0;
  const importedVideosFailed = data?.importedVideosFailed ?? false;
  const styleProfileFailed = data?.styleProfileFailed ?? false;
  const calibrationFailed = data?.calibrationFailed ?? false;
  // We must NOT render the State A "no uploads" empty state when the
  // imported-videos fetch failed — that would silently lie to a
  // creator who has actually trained their style twin. We treat
  // failure as "unknown" and surface a small recoverable error
  // instead of guessing. Same logic for the other two surfaces:
  // their inline disclosures sit at the top of each section card.
  const styleTrained = !importedVideosFailed && importedCount > 0;

  /* ---------- Render --------------------------------------------- */

  if (loading && !data) {
    return (
      <View style={styles.root}>
        <CosmicBackdrop />
        <FireflyParticles count={12} />
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={lumina.firefly} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <CosmicBackdrop />
      <FireflyParticles count={14} />
      <StatusBar style="light" />

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: topInset + 24, paddingBottom: bottomInset },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Animated.View entering={FadeInDown.duration(280)} style={styles.header}>
          <Text style={styles.headerKicker}>Studio</Text>
          <Text style={styles.headerTitle}>Your control centre</Text>
          <Text style={styles.headerSub}>
            See how Lumina understands you. Tune what comes next.
          </Text>
        </Animated.View>

        {error ? (
          <View style={styles.errorPill}>
            <Text style={styles.errorPillText}>{error}</Text>
          </View>
        ) : null}

        {/* SECTION 1 — Your Creator Style */}
        <SectionCard delay={40}>
          <SectionHeader title="Your Creator Style" />
          {styleProfileFailed ? (
            <Text style={styles.styleHint}>
              Couldn’t load your style right now — try again in a moment.
            </Text>
          ) : null}
          <View style={styles.styleRow}>
            <Text style={styles.styleRowLabel}>Tone</Text>
            <View style={styles.tonePill}>
              <Text style={styles.tonePillText}>
                {tone ? TONE_LABELS[tone] : "Learning…"}
              </Text>
            </View>
          </View>
          <Divider />
          <View style={styles.styleRow}>
            <Text style={styles.styleRowLabel}>Top formats</Text>
            <View style={styles.tagRow}>
              {topFormats.length > 0 ? (
                topFormats.map((s) => (
                  <Tag key={s.name} label={labelFromTag(FORMAT_LABELS, s.name)} />
                ))
              ) : (
                <Text style={styles.emptyInline}>No data yet</Text>
              )}
            </View>
          </View>
          <Divider />
          <View style={styles.styleRow}>
            <Text style={styles.styleRowLabel}>Top hook styles</Text>
            <View style={styles.tagRow}>
              {topHookStyles.length > 0 ? (
                topHookStyles.map((s) => (
                  <Tag
                    key={s.name}
                    label={labelFromTag(HOOK_STYLE_LABELS, s.name)}
                  />
                ))
              ) : (
                <Text style={styles.emptyInline}>No data yet</Text>
              )}
            </View>
          </View>
          {memory && memory.sampleSize === 0 ? (
            <Text style={styles.styleHint}>
              Pick a few ideas on Home and Lumina will start to learn what works
              for you.
            </Text>
          ) : null}
        </SectionCard>

        {/* SECTION 2 — Style Twin */}
        <SectionCard delay={80}>
          <SectionHeader title="Make Lumina sound like you" />
          {importedVideosFailed ? (
            <Text style={styles.styleHint}>
              Couldn’t check your trained videos right now. Pull to refresh in
              a moment.
            </Text>
          ) : null}
          {!styleTrained ? (
            <View>
              <Text style={styles.bodyText}>
                Upload a few videos — I’ll match your tone, humor, and pacing.
              </Text>
              <PrimaryButton
                label="Add videos (optional)"
                icon="upload"
                onPress={() => router.push("/style-twin-train")}
              />
            </View>
          ) : (
            <View>
              <Text style={styles.bodyText}>
                Style trained from {importedCount}{" "}
                {importedCount === 1 ? "video" : "videos"}.
              </Text>
              <View style={styles.actionRow}>
                <SecondaryButton
                  label="Add more"
                  icon="plus"
                  onPress={() => router.push("/style-twin-train")}
                />
                <SecondaryButton
                  label={resetting ? "Resetting…" : "Reset style"}
                  icon="rotate-ccw"
                  destructive
                  disabled={resetting}
                  onPress={handleResetStyle}
                />
              </View>
            </View>
          )}
        </SectionCard>

        {/* SECTION 3 — What's Working */}
        <SectionCard delay={120}>
          <SectionHeader title="What's working for you" />
          <WhatsWorkingList memory={memory} />
        </SectionCard>

        {/* SECTION 4 — Tune Your Ideas */}
        <SectionCard delay={160}>
          <SectionHeader
            title="Tune your ideas"
            kicker={savingTune ? "Saving…" : "Optional"}
          />
          {calibrationFailed ? (
            <Text style={styles.styleHint}>
              Couldn’t load your current preferences — your selections will
              still save.
            </Text>
          ) : null}
          <Text style={styles.bodyText}>
            Tap the formats and tone you want more of. Tap again to remove.
          </Text>

          <Text style={styles.subLabel}>Formats</Text>
          <View style={styles.chipRow}>
            {PREFERRED_FORMATS.map((opt) => (
              <Chip
                key={opt.value}
                label={opt.label}
                selected={calibration.preferredFormats.includes(opt.value)}
                onPress={() => toggleFormat(opt.value)}
                disabled={savingTune}
              />
            ))}
          </View>

          <Text style={styles.subLabel}>Hook style</Text>
          <View style={styles.chipRow}>
            {PREFERRED_HOOK_STYLES.map((opt) => (
              <Chip
                key={opt.value}
                label={opt.label}
                selected={calibration.preferredHookStyles.includes(opt.value)}
                onPress={() => toggleHookStyle(opt.value)}
                disabled={savingTune}
              />
            ))}
          </View>

          <Text style={styles.subLabel}>Tone</Text>
          <View style={styles.chipRow}>
            {PREFERRED_TONES.map((opt) => (
              <Chip
                key={opt.value}
                label={opt.label}
                selected={calibration.preferredTone === opt.value}
                onPress={() => setTone(opt.value)}
                disabled={savingTune}
              />
            ))}
          </View>
        </SectionCard>

        {/* SECTION 5 — Give me something different */}
        <View style={styles.exploreWrap}>
          <Pressable
            onPress={handleGiveMeDifferent}
            disabled={exploring}
            style={({ pressed }) => [
              styles.exploreBtn,
              pressed && styles.exploreBtnPressed,
              exploring && styles.exploreBtnDisabled,
            ]}
          >
            {exploring ? (
              <ActivityIndicator color="#0B0824" />
            ) : (
              <>
                <Feather name="shuffle" size={18} color="#0B0824" />
                <Text style={styles.exploreBtnText}>
                  Give me something different
                </Text>
              </>
            )}
          </Pressable>
          <Text style={styles.exploreHint}>
            Asks Lumina to push outside your usual patterns for the next batch.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components — kept inline so the screen reads top-to-bottom.     */
/* ------------------------------------------------------------------ */

function SectionCard({
  children,
  delay = 0,
}: {
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <Animated.View
      entering={FadeInDown.duration(320).delay(delay)}
      style={styles.card}
    >
      {children}
    </Animated.View>
  );
}

function SectionHeader({
  title,
  kicker,
}: {
  title: string;
  kicker?: string;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {kicker ? <Text style={styles.sectionKicker}>{kicker}</Text> : null}
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

function Tag({ label }: { label: string }) {
  return (
    <View style={styles.tag}>
      <Text style={styles.tagText}>{label}</Text>
    </View>
  );
}

function Chip({
  label,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && !disabled && styles.chipPressed,
        disabled && styles.chipDisabled,
      ]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

function PrimaryButton({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryBtn,
        pressed && styles.primaryBtnPressed,
      ]}
    >
      <Feather name={icon} size={16} color="#0B0824" />
      <Text style={styles.primaryBtnText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({
  label,
  icon,
  onPress,
  destructive,
  disabled,
}: {
  label: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.secondaryBtn,
        pressed && !disabled && styles.secondaryBtnPressed,
        disabled && styles.secondaryBtnDisabled,
      ]}
    >
      <Feather
        name={icon}
        size={16}
        color={destructive ? "#FFB4B4" : "#F6F3FF"}
      />
      <Text
        style={[
          styles.secondaryBtnText,
          destructive && styles.secondaryBtnTextDestructive,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function WhatsWorkingList({ memory }: { memory: ViralMemorySummary | null }) {
  // We surface up to 3 distinct insights derived from the existing
  // viral-memory aggregate: top emotional spike, top hook style,
  // top format. Each is gated on having any signal at all so we
  // never lie about a creator's data.
  if (!memory || memory.sampleSize === 0) {
    return (
      <Text style={styles.bodyText}>
        Once you give a few thumbs-ups on Home, Lumina will surface what’s
        working most for your audience here.
      </Text>
    );
  }

  const items: { label: string; value: string }[] = [];
  if (memory.topEmotionalSpike) {
    items.push({
      label: "Top emotion",
      value: labelFromTag(EMOTIONAL_SPIKE_LABELS, memory.topEmotionalSpike),
    });
  }
  if (memory.topHookStyles[0]) {
    items.push({
      label: "Best hook style",
      value: labelFromTag(HOOK_STYLE_LABELS, memory.topHookStyles[0].name),
    });
  }
  if (memory.topFormat) {
    items.push({
      label: "Top format",
      value: labelFromTag(FORMAT_LABELS, memory.topFormat),
    });
  }
  if (items.length === 0) {
    return (
      <Text style={styles.bodyText}>
        Lumina is gathering signal — check back after a few more taps.
      </Text>
    );
  }

  return (
    <View>
      {items.map((it, i) => (
        <View key={it.label}>
          <View style={styles.insightRow}>
            <Text style={styles.insightLabel}>{it.label}</Text>
            <Text style={styles.insightValue}>{it.value}</Text>
          </View>
          {i < items.length - 1 ? <Divider /> : null}
        </View>
      ))}
      <Text style={styles.styleHint}>
        Based on your last {memory.sampleSize}{" "}
        {memory.sampleSize === 1 ? "signal" : "signals"}.
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0A0824",
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: {
    paddingHorizontal: 20,
  },

  /* Header */
  header: {
    marginBottom: 22,
  },
  headerKicker: {
    ...type.label,
    color: lumina.firefly,
    textTransform: "uppercase",
    letterSpacing: 1.4,
    fontSize: 12,
    marginBottom: 6,
  },
  headerTitle: {
    ...type.display,
    fontSize: 32,
    lineHeight: 36,
    color: "#F6F3FF",
  },
  headerSub: {
    ...type.body,
    color: "rgba(246,243,255,0.7)",
    marginTop: 8,
  },

  /* Card */
  card: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderRadius: 22,
    padding: 18,
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  sectionTitle: {
    ...type.subheadSm,
    color: "#F6F3FF",
  },
  sectionKicker: {
    ...type.microDelight,
    color: "rgba(246,243,255,0.55)",
    fontStyle: "normal",
    opacity: 1,
  },

  /* Body */
  bodyText: {
    ...type.body,
    color: "rgba(246,243,255,0.78)",
  },
  subLabel: {
    ...type.label,
    color: "rgba(246,243,255,0.55)",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontSize: 11,
    marginTop: 16,
    marginBottom: 8,
  },
  styleHint: {
    ...type.microDelight,
    color: "rgba(246,243,255,0.6)",
    marginTop: 12,
  },

  /* Style row (label + value) */
  styleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    flexWrap: "wrap",
    gap: 8,
  },
  styleRowLabel: {
    ...type.label,
    color: "rgba(246,243,255,0.6)",
    fontSize: 13,
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.06)",
  },

  /* Tone pill */
  tonePill: {
    backgroundColor: "rgba(0,255,204,0.12)",
    borderColor: "rgba(0,255,204,0.4)",
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  tonePillText: {
    ...type.label,
    color: lumina.firefly,
    fontSize: 13,
  },

  /* Tags */
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    justifyContent: "flex-end",
    flexShrink: 1,
  },
  tag: {
    backgroundColor: "rgba(107,30,255,0.18)",
    borderColor: "rgba(139,77,255,0.4)",
    borderWidth: 1,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  tagText: {
    ...type.label,
    color: "#E9E3FF",
    fontSize: 12,
  },
  emptyInline: {
    ...type.microDelight,
    color: "rgba(246,243,255,0.45)",
    fontStyle: "italic",
  },

  /* Insights row */
  insightRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
  },
  insightLabel: {
    ...type.label,
    color: "rgba(246,243,255,0.6)",
    fontSize: 13,
  },
  insightValue: {
    ...type.bodyEmphasis,
    color: "#F6F3FF",
  },

  /* Chips */
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  chipSelected: {
    backgroundColor: "rgba(0,255,204,0.15)",
    borderColor: lumina.firefly,
  },
  chipPressed: {
    opacity: 0.7,
  },
  chipDisabled: {
    opacity: 0.5,
  },
  chipText: {
    ...type.label,
    color: "rgba(246,243,255,0.85)",
    fontSize: 13,
  },
  chipTextSelected: {
    color: lumina.firefly,
  },

  /* Buttons */
  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: lumina.firefly,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 14,
  },
  primaryBtnPressed: {
    opacity: 0.85,
  },
  primaryBtnText: {
    ...type.label,
    color: "#0B0824",
    fontSize: 15,
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    flex: 1,
  },
  secondaryBtnPressed: {
    opacity: 0.7,
  },
  secondaryBtnDisabled: {
    opacity: 0.5,
  },
  secondaryBtnText: {
    ...type.label,
    color: "#F6F3FF",
    fontSize: 14,
  },
  secondaryBtnTextDestructive: {
    color: "#FFB4B4",
  },

  /* Explore (Give me something different) */
  exploreWrap: {
    marginTop: 8,
    marginBottom: 8,
    alignItems: "center",
  },
  exploreBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: lumina.spark,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 999,
    width: "100%",
    shadowColor: lumina.spark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  exploreBtnPressed: {
    opacity: 0.9,
  },
  exploreBtnDisabled: {
    opacity: 0.6,
  },
  exploreBtnText: {
    ...type.label,
    color: "#0B0824",
    fontSize: 15,
    fontFamily: fontFamily.bodyBold,
  },
  exploreHint: {
    ...type.microDelight,
    color: "rgba(246,243,255,0.55)",
    marginTop: 10,
    textAlign: "center",
  },

  /* Error pill */
  errorPill: {
    backgroundColor: "rgba(248,113,113,0.12)",
    borderColor: "rgba(248,113,113,0.4)",
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    marginBottom: 14,
  },
  errorPillText: {
    ...type.body,
    color: "#F87171",
    fontSize: 14,
  },
});
