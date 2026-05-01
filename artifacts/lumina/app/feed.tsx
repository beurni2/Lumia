/**
 * IdeaFeedScreen — single-idea swipe feed (PHASE UI: SINGLE IDEA
 * SWIPE EXPERIENCE — incremental step 1 of 5).
 *
 * This step ships the STATIC visual direction only:
 *   • screen scaffold + FeedHeader
 *   • SwipeIdeaCard (one idea at a time)
 *   • non-wired ReactionBar + SecondaryActions rows for layout
 *     pacing (so the visual rhythm of the page is correct
 *     before reactions/gestures land)
 *   • prev/next chevron buttons for previewing all 3 ideas
 *
 * Out-of-scope for this step (per the user's incremental plan):
 *   • swipe gestures + animations
 *   • reaction persistence
 *   • detail sheet
 *   • preload pipeline
 *   • bottom-nav rewrite
 *
 * Data source: reuses the existing per-region `dailyIdeasCache`
 * the (tabs)/index.tsx Home screen populates. We try every known
 * Bundle in priority order and use the first hit — keeps the new
 * screen backend-free for this preview pass. If nothing is cached
 * (fresh install / cache rolled past UTC midnight), we render a
 * tiny built-in mock idea set so the layout is still inspectable
 * without a server round-trip.
 *
 * The route lives OUTSIDE the (tabs) group so the existing tab
 * bar / Home flow are untouched. Navigate to it via `/feed`
 * (Expo web) or `router.push("/feed")` from anywhere.
 */
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CosmicBackdrop } from "@/components/foundation/CosmicBackdrop";
import { type IdeaCardData } from "@/components/IdeaCard";
import { SwipeIdeaCard } from "@/components/SwipeIdeaCard";
import { lumina } from "@/constants/colors";
import { type Bundle } from "@/constants/regions";
import { fontFamily } from "@/constants/typography";
import { readDailyIdeas } from "@/lib/dailyIdeasCache";

// ----------------------------------------------------------------- //
// Built-in mock fallback                                              //
// ----------------------------------------------------------------- //
//
// Used ONLY when no per-region cache hit. Lets the screen render
// correctly on a fresh install / web preview without needing the
// API server. Three ideas covers the spec's "3 ideas for today"
// header copy. Hooks intentionally span the viral-feel band so the
// `deriveViralBand` heuristic in SwipeIdeaCard surfaces all three
// label tiers across the demo set.

const MOCK_IDEAS: IdeaCardData[] = [
  {
    id: "mock-1",
    hook: "i ghosted my own to-do list",
    pattern: "reaction",
    whatToShow: "Open your notes app, scroll past 14 unchecked items.",
    howToFilm: "Look → pause → close app",
    whyItWorks: "Self-roast + everyday avoidance",
    structure: "confession",
    emotionalSpike: "regret",
  },
  {
    id: "mock-2",
    hook: "yesterday me booked chaos for today me",
    pattern: "contrast",
    whatToShow: "Calendar reveal: 6 back-to-back blocks before noon.",
    howToFilm: "Slow zoom on calendar, hold 2s on the 9am alarm.",
    whyItWorks: "Duality clash — past self vs. present self",
    structure: "before_after",
    emotionalSpike: "panic",
  },
  {
    id: "mock-3",
    hook: "the fridge knows i'm lying",
    pattern: "pov",
    whatToShow: "POV from inside the fridge as you open it for the 4th time.",
    howToFilm: "Phone propped on a shelf, low angle, no cuts.",
    whyItWorks: "Object personification + relatable shame",
    structure: "mini_story",
  },
];

// ----------------------------------------------------------------- //
// Cache reader                                                       //
// ----------------------------------------------------------------- //
//
// Tries every known Bundle in priority order — we don't know the
// user's region without an /api/style-profile round-trip, and this
// preview screen is intentionally backend-free. The Home screen
// owns the canonical per-region cache write, so whichever bundle
// hit will be the user's actual region. Returns mock if nothing
// hits.

const ALL_BUNDLES: readonly Bundle[] = [
  "western",
  "india",
  "philippines",
  "nigeria",
];

async function loadIdeas(): Promise<{
  ideas: IdeaCardData[];
  source: "cache" | "mock";
}> {
  for (const region of ALL_BUNDLES) {
    try {
      const cached = await readDailyIdeas(region);
      if (cached && cached.length > 0) {
        return { ideas: cached, source: "cache" };
      }
    } catch {
      // ignore per-region cache misses
    }
  }
  return { ideas: MOCK_IDEAS, source: "mock" };
}

// ----------------------------------------------------------------- //
// Screen                                                              //
// ----------------------------------------------------------------- //

export default function IdeaFeedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [ideas, setIdeas] = useState<IdeaCardData[] | null>(null);
  const [source, setSource] = useState<"cache" | "mock" | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await loadIdeas();
      if (cancelled) return;
      setIdeas(result.ideas);
      setSource(result.source);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const goPrev = useCallback(() => {
    setActiveIdx((i) => Math.max(0, i - 1));
  }, []);
  const goNext = useCallback(() => {
    setActiveIdx((i) => (ideas ? Math.min(ideas.length - 1, i + 1) : i));
  }, [ideas]);

  const total = ideas?.length ?? 0;
  const idea = ideas && ideas.length > 0 ? ideas[Math.min(activeIdx, ideas.length - 1)] : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <CosmicBackdrop />

      {/* PART 2 — Feed Header */}
      <View style={styles.header}>
        <View style={styles.headerTextCol}>
          <Text style={styles.headerTitle}>
            {total > 0 ? `${total} ideas for today` : "Ideas for today"}
          </Text>
          <Text style={styles.headerSub}>Made for your style</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          onPress={() => router.push("/profile")}
          style={styles.settingsBtn}
        >
          <Text style={styles.settingsGlyph}>⚙</Text>
        </Pressable>
      </View>

      {/* PART 3 — Card */}
      <View style={styles.cardSlot}>
        {idea ? (
          <SwipeIdeaCard idea={idea} index={activeIdx} total={total} />
        ) : (
          <View style={styles.cardSkeleton}>
            <Text style={styles.skeletonText}>Loading today's ideas…</Text>
          </View>
        )}
      </View>

      {/* PART 4 placeholder — temporary chevron buttons until the
          gesture pass lands. Lets the user walk through all 3
          ideas in this preview build. */}
      <View style={styles.swipeHints}>
        <Pressable
          onPress={goPrev}
          disabled={activeIdx === 0}
          accessibilityRole="button"
          accessibilityLabel="Previous idea"
          style={[
            styles.chevronBtn,
            activeIdx === 0 ? styles.chevronBtnDisabled : null,
          ]}
        >
          <Text style={styles.chevronGlyph}>‹</Text>
        </Pressable>
        <Text style={styles.swipeHintLabel}>swipe coming soon</Text>
        <Pressable
          onPress={goNext}
          disabled={!ideas || activeIdx >= ideas.length - 1}
          accessibilityRole="button"
          accessibilityLabel="Next idea"
          style={[
            styles.chevronBtn,
            !ideas || activeIdx >= ideas.length - 1
              ? styles.chevronBtnDisabled
              : null,
          ]}
        >
          <Text style={styles.chevronGlyph}>›</Text>
        </Pressable>
      </View>

      {/* PART 5 — Reaction Bar (non-wired layout placeholder) */}
      <View style={styles.reactionRow}>
        {(["this is me", "too real", "would post", "meh"] as const).map(
          (label) => (
            <View key={label} style={styles.reactionBtn}>
              <Text style={styles.reactionText}>{label}</Text>
            </View>
          ),
        )}
      </View>

      {/* PART 6 — Secondary Actions (non-wired) */}
      <View style={styles.secondaryRow}>
        {(["Remix", "Copy", "More"] as const).map((label) => (
          <View key={label} style={styles.secondaryBtn}>
            <Text style={styles.secondaryText}>{label}</Text>
          </View>
        ))}
      </View>

      {/* Tiny dev-only source badge so the user can tell whether
          they're seeing real cached ideas or the built-in mock
          fallback. Removable once the gesture pass lands. */}
      {source === "mock" ? (
        <View style={[styles.sourceBadge, { bottom: insets.bottom + 8 }]}>
          <Text style={styles.sourceBadgeText}>preview · mock data</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0A0824",
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingTop: 12,
    paddingBottom: 20,
  },
  headerTextCol: {
    flex: 1,
    paddingRight: 12,
  },
  headerTitle: {
    fontFamily: fontFamily.displayHeavy,
    fontSize: 32,
    lineHeight: 36,
    color: "#F6F3FF",
    letterSpacing: -0.5,
  },
  headerSub: {
    marginTop: 6,
    fontFamily: fontFamily.body,
    fontSize: 15,
    color: "#9B95C2",
  },
  settingsBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  settingsGlyph: {
    color: "#E9E3FF",
    fontSize: 18,
    ...Platform.select({ web: { lineHeight: 18 }, default: {} }),
  },
  cardSlot: {
    flex: 1,
    minHeight: 360,
  },
  cardSkeleton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  skeletonText: {
    fontFamily: fontFamily.body,
    color: "#9B95C2",
    fontSize: 14,
  },
  swipeHints: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
  },
  chevronBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,255,204,0.08)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.20)",
  },
  chevronBtnDisabled: {
    opacity: 0.3,
  },
  chevronGlyph: {
    color: lumina.firefly,
    fontSize: 22,
    fontFamily: fontFamily.bodyBold,
    ...Platform.select({ web: { lineHeight: 22 }, default: {} }),
  },
  swipeHintLabel: {
    fontFamily: fontFamily.body,
    fontSize: 11,
    letterSpacing: 1,
    color: "#6B6485",
    textTransform: "uppercase",
  },
  reactionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 4,
  },
  reactionBtn: {
    flexBasis: "47%",
    flexGrow: 1,
    alignItems: "center",
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  reactionText: {
    fontFamily: fontFamily.bodyMedium,
    color: "#F6F3FF",
    fontSize: 14,
  },
  secondaryRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 24,
    marginTop: 14,
  },
  secondaryBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  secondaryText: {
    fontFamily: fontFamily.body,
    fontSize: 13,
    color: "#9B95C2",
    letterSpacing: 0.4,
  },
  sourceBadge: {
    position: "absolute",
    alignSelf: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: "rgba(255,30,158,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,30,158,0.30)",
  },
  sourceBadgeText: {
    fontFamily: fontFamily.body,
    fontSize: 10,
    color: "#FF6BBD",
    letterSpacing: 0.5,
  },
});
