/**
 * TodaysPickHero — promoted hero treatment for the top-ranked
 * idea on Home.
 *
 * Phase Z2 layer on top of Phase Z1: Z1 already sorts the
 * batch by `(pickerEligible desc, willingnessScore desc)`, so
 * `ideas[0]` IS today's best pick by the willingness ranker.
 * Z1 surfaced this as just "the first card in a flat list of
 * three" — the ranker did its job but the user never saw a
 * visual hierarchy that said "start with this one." Z2 closes
 * that gap with a dedicated promoted block:
 *   • "Today's pick" kicker label (firefly teal, bold) so the
 *     promotion is unmistakable.
 *   • The full IdeaCard with `highlight=true` (reuses the
 *     existing teal-border affordance).
 *   • A LARGE filled-teal "Film this now" button BELOW the
 *     card — promoted from the secondary chip the smaller
 *     cards still use, because for the hero we want filming
 *     to feel like the obvious next move.
 *   • A subtle "Or open in editor →" text link below the
 *     primary CTA so power users still have the existing
 *     /create handoff one tap away (mirrors the small-card
 *     primary press behaviour, just dropped to a quieter rank).
 *
 * Component is purely visual: it accepts press handlers from
 * the parent Home screen so all signal-firing (the existing
 * `selected` ideator signal in `openCreate`) and navigation
 * stays owned by the screen. The hero never wraps `IdeaFeedback`
 * — that sibling stays mounted by Home so the layout / tap
 * targets are identical between hero and non-hero rendering
 * paths.
 *
 * Edge cases handled by the parent (NOT here):
 *   • Empty/error: parent's existing empty-state block runs.
 *   • Single idea: hero renders alone, no "Other ideas" header.
 *   • All-ineligible batch: ranker still picks a top item;
 *     hero treatment applies regardless of `pickerEligible`
 *     (no "Top pick" downgrade label — the ranker chose it,
 *     so it IS today's pick).
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { lumina } from "@/constants/colors";
import { fontFamily, type } from "@/constants/typography";

import { IdeaCard, type IdeaCardData } from "./IdeaCard";

export function TodaysPickHero({
  idea,
  onFilmNow,
  onOpenCreate,
  fitsYourStyle,
}: {
  idea: IdeaCardData;
  /** Primary CTA: route to /film-this-now with this idea. */
  onFilmNow: () => void;
  /** Secondary CTA: route to /create with this idea (also
   *  fires the canonical `selected` ideator signal — handler
   *  owned by the screen so the hero stays presentation-only). */
  onOpenCreate: () => void;
  /** Threaded through to IdeaCard for the brief post-Quick-Tune
   *  "Fits your style" pill window. */
  fitsYourStyle?: boolean;
}) {
  return (
    <View style={styles.heroBlock} accessibilityLabel="Today's pick">
      <View style={styles.kicker}>
        <View style={styles.kickerDot} />
        <Text style={styles.kickerLabel}>Today's pick</Text>
      </View>

      {/* The card itself — reuse the canonical IdeaCard with
          highlight=true so the teal border affordance the
          component already supports does the work. We pass
          `suppressKicker` (rather than `index`) so the card's
          own "first idea" / "idea N" kicker text is hidden —
          the hero's "Today's pick" kicker above is the
          authoritative label and we don't want them competing.
          The kicker row inside IdeaCard still renders if a
          `patternBadge` or `fitsYourStyle` pill needs the
          space; otherwise the row is omitted entirely so the
          hook sits flush below the hero kicker. */}
      <IdeaCard
        idea={idea}
        highlight
        suppressKicker
        fitsYourStyle={fitsYourStyle}
      />

      {/* PRIMARY CTA — large filled-teal button. Promoted from
          the small chip the non-hero cards use because for the
          top-ranked idea we want filming to feel like the
          obvious next move. */}
      <Pressable
        onPress={onFilmNow}
        accessibilityRole="button"
        accessibilityLabel={`Film today's pick now: ${idea.hook}`}
        style={({ pressed }) => [
          styles.primaryBtn,
          pressed ? styles.primaryBtnPressed : null,
        ]}
      >
        <Text style={styles.primaryBtnText}>Film this now →</Text>
      </Pressable>

      {/* SECONDARY — quiet text link to the full /create flow.
          Power users (and anyone who wants the editor over the
          shotlist) keep one-tap access; visual rank makes it
          clear that filming is the recommended path. */}
      <Pressable
        onPress={onOpenCreate}
        accessibilityRole="button"
        accessibilityLabel={`Open today's pick in editor: ${idea.hook}`}
        style={({ pressed }) => [
          styles.secondaryBtn,
          pressed ? styles.secondaryBtnPressed : null,
        ]}
      >
        <Text style={styles.secondaryBtnText}>Or open in editor →</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  heroBlock: {
    marginBottom: 8,
  },
  kicker: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
    marginLeft: 2,
  },
  // Tiny solid-teal dot before the kicker label so the
  // promotion reads as a single graphical unit rather than
  // floating text. Same firefly hue as the IdeaCard kicker
  // text below for visual continuity.
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
  // Filled-teal primary CTA — visually heavier than the
  // outline chip the smaller cards use. Sized to feel like
  // the obvious next tap.
  primaryBtn: {
    backgroundColor: lumina.firefly,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
    marginTop: 10,
    alignItems: "center",
  },
  primaryBtnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  primaryBtnText: {
    fontFamily: fontFamily.bodyBold,
    color: "#0A0824",
    fontSize: 15,
    letterSpacing: 0.4,
  },
  // Plain text-link rank — no background, no border, just a
  // dim teal label so it disappears under the primary button
  // visually. Tap target preserved by the vertical padding.
  secondaryBtn: {
    alignSelf: "center",
    marginTop: 8,
    marginBottom: 4,
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
});
