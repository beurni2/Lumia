/**
 * PHASE Z3 — Pick for you (dedicated full-screen route).
 *
 * Z2 promoted ideas[0] inside the Home feed via the `TodaysPickHero`
 * block, but the user can only see it sandwiched between the rest
 * of the feed. This screen gives the same top-ranked idea its own
 * dedicated surface — full-bleed cosmic backdrop, the hook
 * presented at display-typography rank, every trust signal we ship
 * with the idea (whyThisFitsYou, whatToShow, howToFilm,
 * whyItWorks, caption), and the same big "Film this now" / quiet
 * "Open in editor" CTA pair the hero uses.
 *
 * Why a separate screen on top of the hero block:
 *   • The hero is a "compare across today's three" affordance —
 *     it lives at the top of a feed that immediately cuts to
 *     "Other ideas for today". For users who want to commit to
 *     today's pick, the feed below is just visual noise.
 *   • This screen has no other ideas competing for attention.
 *     Hook + trust signals + CTA, in that order, on a focused
 *     surface that reads like "the one we'd film if we were you".
 *   • Same routing entry pattern as /film-this-now: parent passes
 *     the idea via `params.idea` (JSON-encoded) so this screen
 *     does ZERO new fetches. No new endpoint, no new cache, no new
 *     state. Reuses the same idea payload the Home feed already has.
 *
 * Signals contract:
 *   • The "Film this now" CTA navigates to `/film-this-now`,
 *     which fires the canonical `selected` ideator signal on its
 *     own "Start filming" handoff into /create — so we do NOT
 *     fire a duplicate `selected` here. Visiting this screen by
 *     itself is read-only ("the user is examining the pick"); the
 *     signal still belongs to the moment the user actually commits
 *     into the create flow.
 *   • The "Open in editor" CTA goes straight to /create and DOES
 *     fire the `selected` signal here (mirrors Home's openCreate
 *     and film-this-now's handleStartFilming) so the editor-direct
 *     path stays attributed.
 *
 * Discipline: dev-additive UI surface. ZERO new tables, ZERO
 * migrations, ZERO Claude calls, ZERO new endpoints. If we want
 * to remove this surface later, deleting this file + the kicker
 * navigation hook in `TodaysPickHero` is the entire rollback.
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
import { submitIdeatorSignal } from "@/lib/ideatorSignal";

// We accept the same FullIdea superset that /film-this-now does:
// the ideator response carries `script`, `shotPlan`, etc. that
// IdeaCardData doesn't formally declare, but we may want to render
// them here too without widening the public type.
type FullIdea = IdeaCardData & {
  script?: string;
  shotPlan?: string[];
  trigger?: string;
  reaction?: string;
};

export default function PickForYouScreen() {
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

  // Primary CTA — hand off to the existing Film-This-Now screen
  // with the same payload. That screen owns the `selected` signal
  // when the user actually taps "Start filming" into /create, so
  // this stays a pure navigation (no signal duplication).
  const handleFilmNow = useCallback(() => {
    if (!idea) return;
    router.push({
      pathname: "/film-this-now",
      params: { idea: JSON.stringify(idea) },
    });
  }, [router, idea]);

  // Secondary CTA — straight into /create, same attribution
  // contract Home's openCreate and film-this-now use: fire the
  // `selected` ideator signal BEFORE navigating so the
  // server-side memory aggregator credits the right structural
  // tags regardless of which surface launched the editor.
  const handleOpenEditor = useCallback(() => {
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

  const handleClose = useCallback(() => {
    // Back if there's a stack to pop, otherwise replace home —
    // covers the "deep-linked into pick-for-you" edge case where
    // the back stack would be empty and we'd otherwise dead-end.
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
  }, [router]);

  if (!idea) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <CosmicBackdrop />
        <View style={[styles.content, { paddingTop: insets.top + 24 }]}>
          <Text style={styles.errorTitle}>No pick to show</Text>
          <Text style={styles.errorBody}>
            Head back to Home and we&apos;ll surface today&apos;s pick again.
          </Text>
          <Pressable
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Back to Home"
            style={({ pressed }) => [
              styles.errorBtn,
              pressed ? styles.errorBtnPressed : null,
            ]}
          >
            <Text style={styles.errorBtnText}>Back to Home</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <CosmicBackdrop />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + 12,
            paddingBottom: insets.bottom + 32,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Top bar — close affordance + the same "Today's pick"
            kicker the Home hero uses, so the visual continuity
            from "tap kicker → land here" is unmistakable. */}
        <View style={styles.topBar}>
          <Pressable
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Close pick for you"
            style={({ pressed }) => [
              styles.closeBtn,
              pressed ? styles.closeBtnPressed : null,
            ]}
          >
            <Text style={styles.closeBtnText}>Close</Text>
          </Pressable>
          <View style={styles.kicker}>
            <View style={styles.kickerDot} />
            <Text style={styles.kickerLabel}>Today&apos;s pick</Text>
          </View>
          {/* Spacer so the kicker centers visually against the
              left-aligned Close button without flexbox math. */}
          <View style={styles.topBarSpacer} />
        </View>

        {/* Hero hook — display-rank typography. This is the one
            line on the entire screen that should read first. */}
        <Text style={styles.hook} accessibilityRole="header">
          {idea.hook}
        </Text>

        {/* whyThisFitsYou — the trust line the willingness scorer
            ships when a creator-specific match exists. Hidden when
            absent (cached pre-Z1 batches won't have it). */}
        {idea.whyThisFitsYou ? (
          <View style={styles.fitsCard}>
            <Text style={styles.fitsKicker}>Why this fits you</Text>
            <Text style={styles.fitsBody}>{idea.whyThisFitsYou}</Text>
          </View>
        ) : null}

        {/* What to show / how to film / why it works / caption —
            same fields as IdeaCard surfaces, but rendered with more
            breathing room so the user can actually read them as a
            "shooting brief" rather than a card preview. Each block
            is gated on its source field so older cached ideas
            without the v2 prompt's trust gates render cleanly. */}
        {idea.whatToShow ? (
          <Section title="What to show">{idea.whatToShow}</Section>
        ) : null}

        {idea.howToFilm ? (
          <Section title="How to film it">{idea.howToFilm}</Section>
        ) : null}

        {idea.whyItWorks ? (
          <Section title="Why it works">{idea.whyItWorks}</Section>
        ) : null}

        {idea.caption ? (
          <View style={styles.captionCard}>
            <View style={styles.captionHeaderRow}>
              <Text style={styles.sectionTitle}>Caption</Text>
              <Pressable
                onPress={handleCopyCaption}
                accessibilityRole="button"
                accessibilityLabel="Copy caption"
                style={({ pressed }) => [
                  styles.copyBtn,
                  pressed ? styles.copyBtnPressed : null,
                ]}
              >
                <Text style={styles.copyBtnText}>
                  {copyConfirm ?? "Copy"}
                </Text>
              </Pressable>
            </View>
            <Text style={styles.captionBody}>{idea.caption}</Text>
          </View>
        ) : null}

        {/* CTAs — same pair as the hero block, sized for the
            full-screen treatment. Primary first, secondary
            text-link below it. */}
        <Pressable
          onPress={handleFilmNow}
          accessibilityRole="button"
          accessibilityLabel={`Film this pick now: ${idea.hook}`}
          style={({ pressed }) => [
            styles.primaryBtn,
            pressed ? styles.primaryBtnPressed : null,
          ]}
        >
          <Text style={styles.primaryBtnText}>Film this now →</Text>
        </Pressable>
        <Pressable
          onPress={handleOpenEditor}
          accessibilityRole="button"
          accessibilityLabel={`Open this pick in editor: ${idea.hook}`}
          style={({ pressed }) => [
            styles.secondaryBtn,
            pressed ? styles.secondaryBtnPressed : null,
          ]}
        >
          <Text style={styles.secondaryBtnText}>Or open in editor →</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

/* =================== Sub-components =================== */

function Section({ title, children }: { title: string; children: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionBody}>{children}</Text>
    </View>
  );
}

/* =================== Styles =================== */

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0A0824",
  },
  content: {
    paddingHorizontal: 22,
    gap: 14,
  },
  /* ---- Top bar ---- */
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  closeBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  closeBtnPressed: {
    opacity: 0.7,
  },
  closeBtnText: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.85)",
    fontSize: 13,
    letterSpacing: 0.3,
  },
  kicker: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  kickerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: lumina.firefly,
  },
  kickerLabel: {
    fontFamily: fontFamily.bodyBold,
    color: lumina.firefly,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  topBarSpacer: {
    // Same approximate width as the Close button so the kicker
    // sits visually centered without flexbox calculations.
    width: 56,
  },
  /* ---- Hero hook ---- */
  hook: {
    ...type.display,
    color: "#FFFFFF",
    fontSize: 28,
    lineHeight: 34,
    marginTop: 12,
    marginBottom: 4,
  },
  /* ---- Fits-your-style trust card ---- */
  fitsCard: {
    backgroundColor: "rgba(0,255,204,0.06)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.28)",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 8,
  },
  fitsKicker: {
    fontFamily: fontFamily.bodyBold,
    color: lumina.firefly,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  fitsBody: {
    ...type.body,
    color: "rgba(255,255,255,0.9)",
    fontSize: 14,
    lineHeight: 20,
  },
  /* ---- Trust sections ---- */
  section: {
    marginTop: 6,
    marginBottom: 2,
  },
  sectionTitle: {
    fontFamily: fontFamily.bodyBold,
    color: "rgba(255,255,255,0.95)",
    fontSize: 13,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  sectionBody: {
    ...type.body,
    color: "rgba(255,255,255,0.82)",
    fontSize: 15,
    lineHeight: 22,
  },
  /* ---- Caption block ---- */
  captionCard: {
    marginTop: 8,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  captionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  copyBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "rgba(0,255,204,0.12)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.32)",
  },
  copyBtnPressed: {
    opacity: 0.7,
  },
  copyBtnText: {
    fontFamily: fontFamily.bodyBold,
    color: lumina.firefly,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  captionBody: {
    ...type.body,
    color: "rgba(255,255,255,0.82)",
    fontSize: 14,
    lineHeight: 20,
  },
  /* ---- CTAs ---- */
  primaryBtn: {
    backgroundColor: lumina.firefly,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 18,
    marginTop: 18,
    alignItems: "center",
  },
  primaryBtnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  primaryBtnText: {
    fontFamily: fontFamily.bodyBold,
    color: "#0A0824",
    fontSize: 16,
    letterSpacing: 0.4,
  },
  secondaryBtn: {
    alignSelf: "center",
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  secondaryBtnPressed: {
    opacity: 0.6,
  },
  secondaryBtnText: {
    ...type.body,
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(0,255,204,0.78)",
    fontSize: 13,
    letterSpacing: 0.3,
  },
  /* ---- Empty / error state ---- */
  errorTitle: {
    ...type.display,
    color: "#FFFFFF",
    fontSize: 22,
    marginBottom: 8,
  },
  errorBody: {
    ...type.body,
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 18,
  },
  errorBtn: {
    backgroundColor: lumina.firefly,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignSelf: "flex-start",
  },
  errorBtnPressed: {
    opacity: 0.85,
  },
  errorBtnText: {
    fontFamily: fontFamily.bodyBold,
    color: "#0A0824",
    fontSize: 14,
    letterSpacing: 0.4,
  },
});
