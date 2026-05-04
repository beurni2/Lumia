/**
 * PHASE Z1 — Film-This-Now screen.
 *
 * Lightweight timeline view of a single idea, surfaced as a
 * secondary path off the Home card so the creator can scan the
 * shotlist without committing to the full creation flow. Built
 * entirely client-side from the idea payload that Home passes
 * through `router.push({ pathname: "/film-this-now", params })`.
 * No new server endpoint, no new fetch — everything we render
 * is already on the cached/freshly-shipped idea.
 *
 * Tap "Start filming" to enter the existing /create flow, which
 * fires the same `selected` ideator signal Home would have fired,
 * so attribution stays consistent regardless of which path the
 * user took to reach the camera.
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Clipboard from "expo-clipboard";
import React, { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CosmicBackdrop } from "@/components/foundation/CosmicBackdrop";
import { type IdeaCardData } from "@/components/IdeaCard";
import { lumina } from "@/constants/colors";
import { fontFamily, type } from "@/constants/typography";
import {
  deriveActionConversion,
  deriveConfidenceLabels,
} from "@/lib/actionConversion";
import { submitIdeatorSignal } from "@/lib/ideatorSignal";

// Idea payload shape — same JSON-encoded blob Home pushes into
// /create. We accept the superset (includes shotPlan + script)
// even though IdeaCardData doesn't declare them, because the
// ideator response carries them and we want to render them here
// without widening the public IdeaCardData type just for one
// screen.
type FullIdea = IdeaCardData & {
  script?: string;
  shotPlan?: string[];
  trigger?: string;
  reaction?: string;
};

export default function FilmThisNowScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ idea?: string }>();

  const idea = useMemo<FullIdea | null>(() => {
    if (!params.idea) return null;
    try {
      return JSON.parse(params.idea) as FullIdea;
    } catch {
      return null;
    }
  }, [params.idea]);

  const [copyConfirm, setCopyConfirm] = useState<string | null>(null);

  // Copy-to-clipboard with a 1.5s confirmation toast. We keep
  // the toast purely local to this screen — no signal fires for
  // a copy here, by design: "exported" is reserved for the
  // gallery-save in /review (which is the actual export event).
  const handleCopyCaption = useCallback(async () => {
    if (!idea?.caption) return;
    try {
      await Clipboard.setStringAsync(idea.caption);
      setCopyConfirm("Caption copied");
      setTimeout(() => setCopyConfirm(null), 1500);
    } catch {
      setCopyConfirm("Couldn't copy");
      setTimeout(() => setCopyConfirm(null), 1500);
    }
  }, [idea?.caption]);

  // "Start filming" hands off to the existing creation flow.
  // We re-encode the same idea payload so /create receives it
  // exactly as Home would have sent it.
  //
  // ATTRIBUTION FIX (architect catch): Home's `openCreate`
  // fires the `selected` ideator signal BEFORE navigating to
  // /create, but /create itself doesn't emit one on mount —
  // so a Film-This-Now → /create handoff would silently lose
  // attribution for this entry path. We mirror Home's pattern
  // and fire the same `selected` signal here, threading every
  // available structural tag so the server-side memory
  // aggregator credits the correct structure / hookStyle /
  // pattern / spike / payoff buckets. Fire-and-forget; the
  // helper swallows network failures.
  const handleStartFilming = useCallback(() => {
    if (!idea) return;
    submitIdeatorSignal({
      ideaHook: idea.hook,
      signalType: "selected",
      ideaPattern: idea.pattern,
      emotionalSpike: idea.emotionalSpike,
      payoffType: idea.payoffType,
      structure: idea.structure,
      hookStyle: idea.hookStyle,
    });
    router.push({
      pathname: "/create",
      params: { idea: JSON.stringify(idea) },
    });
  }, [router, idea]);

  if (!idea) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <CosmicBackdrop />
        <View style={[styles.content, { paddingTop: insets.top + 24 }]}>
          <Text style={styles.errorTitle}>No idea to film</Text>
          <Text style={styles.errorBody}>
            We couldn&rsquo;t read the idea you tapped. Head back home
            and try again.
          </Text>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed ? styles.primaryBtnPressed : null,
            ]}
            accessibilityRole="button"
          >
            <Text style={styles.primaryBtnText}>Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Derive timeline windows from the idea's own metadata. The
  // hookSeconds field gates the first beat; everything after is
  // a soft suggestion based on the 15-25s short-form window the
  // ideator targets. We never INVENT durations — if the idea
  // didn't ship hookSeconds, the beat is rendered without a
  // timestamp.
  const hookEnd =
    typeof idea.hookSeconds === "number" && idea.hookSeconds > 0
      ? idea.hookSeconds
      : 2;
  const totalLen =
    typeof idea.videoLengthSec === "number" && idea.videoLengthSec > 0
      ? idea.videoLengthSec
      : 20;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <CosmicBackdrop />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.backBtn,
            pressed ? styles.backBtnPressed : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text style={styles.backBtnText}>← Back</Text>
        </Pressable>

        <Text style={styles.kicker}>FILM THIS NOW</Text>
        <Text style={styles.title}>{idea.hook}</Text>
        {idea.whyThisFitsYou ? (
          <Text style={styles.whyFits}>{idea.whyThisFitsYou}</Text>
        ) : null}

        {/* Beat 1 — the hook. Always renders because every idea
            has a hook by schema contract. */}
        <View style={styles.beat}>
          <Text style={styles.beatTime}>0&ndash;{hookEnd.toFixed(0)}s</Text>
          <Text style={styles.beatLabel}>HOOK</Text>
          <Text style={styles.beatBody}>{idea.hook}</Text>
        </View>

        {/* Beat 2 — what to show. Falls back to the trigger field
            from the ideator response when whatToShow is missing
            (cached pre-v2 batches). */}
        {idea.whatToShow || idea.trigger ? (
          <View style={styles.beat}>
            <Text style={styles.beatTime}>
              {hookEnd.toFixed(0)}&ndash;{Math.max(hookEnd + 3, 5).toFixed(0)}s
            </Text>
            <Text style={styles.beatLabel}>WHAT TO SHOW</Text>
            <Text style={styles.beatBody}>
              {idea.whatToShow ?? idea.trigger}
            </Text>
          </View>
        ) : null}

        {/* Beat 3 — payoff / why-it-works. Reaction wins when
            present (more concrete than whyItWorks); whyItWorks
            is the fallback. */}
        {idea.reaction || idea.whyItWorks ? (
          <View style={styles.beat}>
            <Text style={styles.beatTime}>
              {Math.max(hookEnd + 3, 5).toFixed(0)}&ndash;
              {totalLen.toFixed(0)}s
            </Text>
            <Text style={styles.beatLabel}>PAYOFF</Text>
            <Text style={styles.beatBody}>
              {idea.reaction ?? idea.whyItWorks}
            </Text>
          </View>
        ) : null}

        {/* Shot plan — the model's bullet-list of the actual
            shots needed. Optional because pre-v2 cached batches
            lack the field; renders nothing if absent. */}
        {Array.isArray(idea.shotPlan) && idea.shotPlan.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>SHOT PLAN</Text>
            {idea.shotPlan.map((shot, i) => (
              <Text key={i} style={styles.shotLine}>
                {i + 1}. {shot}
              </Text>
            ))}
          </View>
        ) : null}

        {/* Caption + copy button. Same Clipboard pattern review.tsx
            uses for its caption block. */}
        {idea.caption ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>CAPTION</Text>
            <Text style={styles.captionBody}>{idea.caption}</Text>
            <Pressable
              onPress={handleCopyCaption}
              style={({ pressed }) => [
                styles.copyBtn,
                pressed ? styles.copyBtnPressed : null,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Copy caption"
            >
              <Text style={styles.copyBtnText}>
                {copyConfirm ?? "Copy caption"}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* PHASE UX1 — Action Conversion footer. Time +
            difficulty + confidence labels in a tight,
            scannable block right above the primary CTA so the
            user sees "this is small, fast, and private" at the
            exact moment they're deciding to tap "Start
            filming". All three values are derived purely from
            fields the server already ships — see
            `lib/actionConversion.ts`. Each row is HIDDEN when
            its underlying signal is missing (legacy cached
            ideas / Llama wraps); the section header itself is
            suppressed when nothing inside it would render. */}
        {(() => {
          const ac = deriveActionConversion(idea);
          const labels = deriveConfidenceLabels(idea, 4);
          const timeLine =
            ac.estimatedShootSec !== null
              ? `${Math.round(ac.estimatedShootSec)} seconds on camera`
              : ac.filmingTimeMin !== null
                ? `~${ac.filmingTimeMin} min start to finish`
                : null;
          const hasAnything =
            timeLine !== null || ac.difficultyLabel !== null || labels.length > 0;
          if (!hasAnything) return null;
          return (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>PLAN</Text>
              {timeLine !== null ? (
                <View style={styles.planRow}>
                  <Text style={styles.planRowLabel}>Time</Text>
                  <Text style={styles.planRowValue}>{timeLine}</Text>
                </View>
              ) : null}
              {ac.difficultyLabel !== null ? (
                <View style={styles.planRow}>
                  <Text style={styles.planRowLabel}>Difficulty</Text>
                  <Text style={styles.planRowValue}>{ac.difficultyLabel}</Text>
                </View>
              ) : null}
              {labels.length > 0 ? (
                <View style={styles.planChipRow}>
                  {labels.map((chip, idx) => (
                    <View key={idx} style={styles.planChip}>
                      <Text style={styles.planChipText}>{chip}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })()}

        <Pressable
          onPress={handleStartFilming}
          style={({ pressed }) => [
            styles.primaryBtn,
            pressed ? styles.primaryBtnPressed : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Start filming"
        >
          <Text style={styles.primaryBtnText}>Start filming →</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  content: {
    paddingHorizontal: 22,
    gap: 4,
  },
  backBtn: {
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  backBtnPressed: { opacity: 0.6 },
  backBtnText: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
  },
  kicker: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 11,
    letterSpacing: 1.4,
    marginBottom: 8,
  },
  title: {
    ...type.display,
    color: "#FFFFFF",
    marginBottom: 8,
  },
  whyFits: {
    ...type.body,
    fontStyle: "italic",
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    marginBottom: 18,
  },
  beat: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 14,
    padding: 14,
    marginVertical: 6,
  },
  beatTime: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 11,
    letterSpacing: 1,
    marginBottom: 4,
  },
  beatLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.55)",
    fontSize: 10,
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  beatBody: {
    ...type.body,
    color: "rgba(255,255,255,0.9)",
    fontSize: 15,
    lineHeight: 21,
  },
  section: {
    marginTop: 18,
    marginBottom: 6,
  },
  sectionLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  shotLine: {
    ...type.body,
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4,
  },
  captionBody: {
    ...type.body,
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  copyBtn: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(0,255,204,0.10)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.32)",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  copyBtnPressed: { opacity: 0.7 },
  copyBtnText: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 13,
  },
  // PHASE UX1 — Plan footer block. Two-column rows for Time +
  // Difficulty (label on left, value on right) plus a flex-wrap
  // chip row for confidence labels. Quiet visual rank so the
  // primary "Start filming" CTA below stays unambiguously the
  // dominant element on the screen.
  planRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  planRowLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    letterSpacing: 0.6,
  },
  planRowValue: {
    fontFamily: fontFamily.bodyBold,
    color: "rgba(255,255,255,0.92)",
    fontSize: 14,
  },
  planChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 12,
  },
  planChip: {
    backgroundColor: "rgba(0,255,204,0.10)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.30)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  planChipText: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 11,
    letterSpacing: 0.3,
  },
  primaryBtn: {
    marginTop: 24,
    backgroundColor: lumina.firefly,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  primaryBtnText: {
    fontFamily: fontFamily.bodyBold,
    color: "#001D17",
    fontSize: 16,
    letterSpacing: 0.4,
  },
  errorTitle: {
    ...type.display,
    color: "#FFFFFF",
    marginBottom: 8,
    marginTop: 24,
  },
  errorBody: {
    ...type.body,
    color: "rgba(255,255,255,0.7)",
    marginBottom: 24,
  },
});
