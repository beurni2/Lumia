/**
 * SwipeIdeaCard — single-idea presentation card for the IdeaFeed
 * surface (PHASE UI: SINGLE IDEA SWIPE EXPERIENCE — incremental
 * step 1 of 5; static visual-direction pass only).
 *
 * Renders ONE idea at a time, big-hook-first, in the visual
 * hierarchy spec'd in PARTS 1–3:
 *
 *   IdeaMeta      — small "IDEA n" kicker + pattern pill
 *   HeroHook      — 42–56 px bold hook, ~60–70% of visual focus
 *   ViralFeelBadge — non-numeric signal ("🔥 this would go viral")
 *   PatternPreview — short filming hint (1–2 lines)
 *   WhyItWorks    — one-line explanation
 *
 * NO gestures, NO reaction persistence, NO detail sheet — those
 * are subsequent incremental steps. This component is the
 * presentation primitive only; the parent screen owns idea
 * selection and (later) gesture handling.
 *
 * The viral-feel signal is intentionally derived from existing
 * client-visible idea fields (NOT the server-internal Phase 7
 * `viralFeelScore`, which is not on the wire today). The signal
 * is a non-numeric vibe label so swapping the source over to the
 * real score later doesn't change the visual surface — only the
 * input to `deriveViralFeelLabel` changes.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import type { IdeaCardData } from "@/components/IdeaCard";
import { lumina } from "@/constants/colors";
import { fontFamily } from "@/constants/typography";

// --- non-numeric viral-feel label ---------------------------------- //
//
// The spec's PART 3C explicitly forbids exposing the raw 0-10 score.
// We translate signals available on the IdeaCardData shape into one
// of three vibe bands. When `viralFeelScore` eventually lands on
// the client wire (not in this incremental step) the heuristic
// below collapses to a direct band lookup.

type ViralBand = "high" | "mid" | "low";

function deriveViralBand(idea: IdeaCardData): ViralBand {
  // Heuristic: short, first-person, emotional-spike-tagged hooks
  // tend to be the viral-feel winners. Coarse on purpose — this is
  // a vibe label, not a leaderboard. Replace with the real score
  // band when the field is exposed.
  const hook = (idea.hook ?? "").toLowerCase();
  const wordCount = hook.split(/\s+/).filter(Boolean).length;
  const isFirstPerson = /\b(i|i'm|my|me)\b/.test(hook);
  const hasSpike = Boolean(idea.emotionalSpike);
  const score = (wordCount <= 8 ? 1 : 0) + (isFirstPerson ? 1 : 0) + (hasSpike ? 1 : 0);
  if (score >= 3) return "high";
  if (score >= 2) return "mid";
  return "low";
}

const VIRAL_LABELS: Record<ViralBand, { emoji: string; text: string }> = {
  high: { emoji: "🔥", text: "this would go viral" },
  mid: { emoji: "⚡", text: "high share potential" },
  low: { emoji: "●", text: "scroll-stopper" },
};

// --- pattern label lookup ----------------------------------------- //
//
// Mirrors the existing IdeaCard's PATTERN_LABELS map but kept local
// so the card stays a self-contained presentation primitive.

const PATTERN_LABELS: Record<NonNullable<IdeaCardData["pattern"]>, string> = {
  pov: "POV",
  reaction: "Reaction",
  mini_story: "Mini-story",
  contrast: "Contrast",
  before_after: "Contrast",
  expectation_vs_reality: "Contrast",
  observational_confessional: "Mini-story",
};

// --- one-line "why it works" --------------------------------------- //
//
// Prefer the model's `whyItWorks` when present (already a
// short single-line explanation per the prompt contract). Fall
// back to a structure/spike-derived label so the row never
// renders empty.

function deriveWhyLine(idea: IdeaCardData): string | null {
  if (idea.whyItWorks && idea.whyItWorks.trim().length > 0) {
    return idea.whyItWorks.trim();
  }
  const parts: string[] = [];
  if (idea.structure) parts.push(idea.structure.replace(/_/g, " "));
  if (idea.emotionalSpike) parts.push(idea.emotionalSpike);
  if (parts.length === 0) return null;
  return parts.join(" + ");
}

// --- one-line filming hint ----------------------------------------- //
//
// Prefer `howToFilm`, fall back to `whatToShow`. Both are
// already short single-line strings per the IdeaCardData contract.

function deriveFilmingHint(idea: IdeaCardData): string | null {
  const raw = idea.howToFilm ?? idea.whatToShow;
  if (!raw || raw.trim().length === 0) return null;
  return raw.trim();
}

// ----------------------------------------------------------------- //
// Component                                                          //
// ----------------------------------------------------------------- //

export function SwipeIdeaCard({
  idea,
  index,
  total,
}: {
  idea: IdeaCardData;
  /** 0-based position in the current feed; rendered as 1-based. */
  index: number;
  /** Total ideas in the current feed; used by the kicker only. */
  total: number;
}) {
  const band = deriveViralBand(idea);
  const viral = VIRAL_LABELS[band];
  const patternLabel = idea.pattern ? PATTERN_LABELS[idea.pattern] : null;
  const filming = deriveFilmingHint(idea);
  const why = deriveWhyLine(idea);

  return (
    <View style={styles.card}>
      {/* PART 3A — IdeaMeta row */}
      <View style={styles.metaRow}>
        <Text style={styles.kicker}>
          IDEA {index + 1}
          {total > 0 ? ` / ${total}` : ""}
        </Text>
        {patternLabel ? (
          <View style={styles.patternPill}>
            <Text style={styles.patternPillText}>{patternLabel}</Text>
          </View>
        ) : null}
      </View>

      {/* PART 3B — HeroHook (the visual anchor) */}
      <View style={styles.hookWrap}>
        <Text style={styles.hook} numberOfLines={3} adjustsFontSizeToFit>
          {idea.hook}
        </Text>
      </View>

      {/* PART 3C — ViralFeelBadge */}
      <View style={styles.viralRow}>
        <Text style={styles.viralEmoji}>{viral.emoji}</Text>
        <Text style={styles.viralText}>{viral.text}</Text>
      </View>

      {/* PART 3D — PatternPreview */}
      {filming ? (
        <View style={styles.patternBlock}>
          <Text style={styles.patternBlockHead}>
            🎬 {patternLabel ?? "Filming"}
          </Text>
          <Text style={styles.patternBlockBody} numberOfLines={2}>
            {filming}
          </Text>
        </View>
      ) : null}

      {/* PART 3E — WhyItWorks (single line) */}
      {why ? (
        <Text style={styles.whyLine} numberOfLines={1}>
          {why}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    width: "100%",
    paddingHorizontal: 28,
    paddingTop: 32,
    paddingBottom: 28,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    justifyContent: "space-between",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  kicker: {
    fontFamily: fontFamily.bodyBold,
    fontSize: 11,
    letterSpacing: 1.6,
    color: lumina.firefly,
    textTransform: "uppercase",
  },
  patternPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(0,255,204,0.10)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.25)",
  },
  patternPillText: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 11,
    color: lumina.firefly,
    letterSpacing: 0.4,
  },
  hookWrap: {
    flexGrow: 1,
    justifyContent: "center",
    paddingVertical: 24,
  },
  hook: {
    fontFamily: fontFamily.displayHeavy,
    fontSize: 44,
    lineHeight: 50,
    color: "#F6F3FF",
    letterSpacing: -0.5,
  },
  viralRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 18,
  },
  viralEmoji: {
    fontSize: 16,
  },
  viralText: {
    fontFamily: fontFamily.bodyMedium,
    fontSize: 14,
    color: "#E9E3FF",
    letterSpacing: 0.2,
  },
  patternBlock: {
    marginBottom: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  patternBlockHead: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 13,
    color: "#F6F3FF",
    marginBottom: 4,
  },
  patternBlockBody: {
    fontFamily: fontFamily.body,
    fontSize: 13,
    lineHeight: 18,
    color: "#9B95C2",
  },
  whyLine: {
    fontFamily: fontFamily.italic,
    fontStyle: "italic",
    fontSize: 12,
    color: "#9B95C2",
    letterSpacing: 0.2,
  },
});
