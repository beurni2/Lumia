/**
 * Shared idea card — used both in onboarding's quick-win reveal
 * and on the Home screen's "today's 3 ideas" feed. Single source
 * of styling so the card looks identical in both surfaces.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { lumina } from "@/constants/colors";
import { fontFamily, type } from "@/constants/typography";
import { deriveWhyThisWorksLines } from "@/lib/whyThisWorks";

// Mirrors the ideator response shape from the server (only the
// fields the card actually displays). Anything optional here is
// either truly optional in the contract (`visualHook`) or guarded
// against transient AI provider responses where a field went
// missing — defensive rendering is cheaper than a crash.
//
// `pattern`, `whatToShow`, `howToFilm` are post-MVP trust-gate
// fields and are kept OPTIONAL on the mobile side because cached
// batches generated before the v2 prompt won't have them. New
// generations always include all three.
//
// Pattern set was synthesised from five → four in the final pass:
// `before_after` and `expectation_vs_reality` collapsed into
// `contrast`; `observational_confessional` folded into `mini_story`.
// We keep the legacy enum values typed here so cached batches from
// the v2 prompt era still pass type-check; the label map below
// handles the visual mapping.
export type IdeaCardData = {
  id?: string;
  pattern?:
    | "pov"
    | "reaction"
    | "mini_story"
    | "contrast"
    // Legacy patterns from the previous v2 prompt — accepted only
    // so cached batches still render. New generations only use the
    // four canonical values above.
    | "before_after"
    | "expectation_vs_reality"
    | "observational_confessional";
  hook: string;
  hookSeconds?: number;
  videoLengthSec?: number;
  filmingTimeMin?: number;
  whatToShow?: string;
  howToFilm?: string;
  whyItWorks?: string;
  visualHook?: string;
  caption?: string;
  payoffType?: string;
  // One of {embarrassment, regret, denial, panic, irony}. Threaded
  // through from the ideator response so feedback / selection
  // signals can attribute to a spike — see lib/viralPatternMemory.ts
  // on the server. Optional because pre-v18 cached batches lack it.
  emotionalSpike?: string;
  // Lumina Evolution Engine — see ideaSchema in
  // api-server/src/lib/ideaGen.ts for the canonical 7+5 enums.
  // Threaded straight through from the ideator response into the
  // verdict + signal POSTs (lib/ideaFeedback.ts +
  // lib/ideatorSignal.ts) so the per-creator memory aggregator can
  // credit each interaction to the right structure / hookStyle.
  // Optional because pre-Evolution-Engine cached batches lack them.
  structure?: string;
  hookStyle?: string;
  // PHASE Z1 — willingness ranker overlay. Three additive optional
  // fields the server stamps onto every freshly-shipped idea (see
  // api-server/src/lib/willingnessScorer.ts +
  // api-server/src/lib/whyThisFitsYou.ts). Pre-Z1 cached batches
  // lack them and the card simply hides the trust line — no
  // crashes, no empty states. The server has already SORTED the
  // ideas array by (pickerEligible desc, willingnessScore desc),
  // so Home renders them in array order without any client work.
  willingnessScore?: number;
  pickerEligible?: boolean;
  whyThisFitsYou?: string;
};

// User-facing labels for the four canonical patterns + transitional
// labels for the three legacy values still potentially in cache.
// Short and recognisable so the small badge on the card doesn't
// dominate. Legacy values map to their nearest new equivalent so
// the badge stays meaningful instead of disappearing mid-day.
const PATTERN_LABELS: Record<NonNullable<IdeaCardData["pattern"]>, string> = {
  pov: "POV",
  reaction: "Reaction",
  mini_story: "Mini-story",
  contrast: "Contrast",
  // Legacy → new mapping (transitional; cached only).
  before_after: "Contrast",
  expectation_vs_reality: "Contrast",
  observational_confessional: "Mini-story",
};

export function IdeaCard({
  idea,
  index,
  highlight,
  fitsYourStyle,
  suppressKicker,
}: {
  idea: IdeaCardData;
  index?: number;
  highlight?: boolean;
  /**
   * Visible-adaptation flag: when true, render a small teal
   * "Fits your style" pill in the kicker row next to the pattern
   * badge. Set by Home for the brief window after the user just
   * completed Quick Tune so the user can SEE that the new batch
   * was generated against their fresh preferences. Off by default
   * — most renders should never show this pill.
   */
  fitsYourStyle?: boolean;
  /**
   * PHASE Z2 — when true, suppress the "idea N" / "first idea"
   * kicker text. Used by `<TodaysPickHero>` so the hero's own
   * "Today's pick" kicker doesn't compete with IdeaCard's
   * fallback "first idea" label (kicker text defaults to "first
   * idea" when `index` is absent — passing `index` would have
   * been worse since "idea 1" also conflicts with the hero
   * promotion). The kicker row itself is preserved when other
   * elements (`patternBadge`, `fitsBadge`) need to render in it.
   */
  suppressKicker?: boolean;
}) {
  // Surface contract drift loudly in development. If the ideator
  // ever stops returning the body fields we expect, we want to
  // see it in the Metro logs immediately rather than discover it
  // by way of a customer-reported "the idea card is empty". Note
  // we deliberately don't warn on missing pattern/whatToShow/
  // howToFilm — cached batches from before the v2 prompt are
  // expected to lack them and that's not drift, that's history.
  if (
    __DEV__ &&
    !idea.whyItWorks &&
    !idea.visualHook &&
    !idea.whatToShow &&
    !idea.caption
  ) {
    console.warn(
      "[IdeaCard] idea has hook only; missing body fields — possible API drift",
      { hook: idea.hook?.slice(0, 60) },
    );
  }

  // Friendly metadata footer — kept deliberately to two human
  // pieces (length + filming time). Hook-second timing and other
  // production-y numbers are dropped from the card to keep it
  // feeling like a creative prompt, not a dashboard.
  const shootLine =
    typeof idea.filmingTimeMin === "number"
      ? `Takes ~${idea.filmingTimeMin} min to shoot`
      : null;

  // Pattern badge — small, recognisable trust signal that this
  // idea maps to a known short-form format. Only shows when the
  // model declared a pattern (post-v2-prompt batches).
  const patternLabel = idea.pattern ? PATTERN_LABELS[idea.pattern] : null;

  // Skip the kicker row entirely when there's nothing to put in
  // it — happens in the Z2 hero case where the kicker text is
  // suppressed AND there's no pattern badge / fits-style pill to
  // anchor. Otherwise we'd render an empty 10-px-tall row with
  // unwanted bottom margin above the hook.
  const showKickerRow =
    !suppressKicker || patternLabel !== null || fitsYourStyle === true;

  return (
    <View
      style={[styles.card, highlight ? styles.cardHighlight : null]}
      accessibilityRole="summary"
    >
      {showKickerRow ? (
      <View style={styles.kickerRow}>
        {!suppressKicker ? (
          <Text style={styles.cardKicker}>
            {index ? `idea ${index}` : "first idea"}
          </Text>
        ) : null}
        {patternLabel ? (
          <View style={styles.patternBadge}>
            <Text style={styles.patternBadgeText}>{patternLabel}</Text>
          </View>
        ) : null}
        {fitsYourStyle ? (
          <View
            style={styles.fitsBadge}
            accessibilityLabel="Fits your style"
          >
            <Text style={styles.fitsBadgeText}>Fits your style</Text>
          </View>
        ) : null}
      </View>
      ) : null}
      <Text style={styles.cardHook}>{idea.hook}</Text>

      {/* PHASE Z1 — "Why this fits you" trust line. Composed
          server-side from voice cluster + scenario fingerprint
          (deterministic, no Claude). Italic + dimmer than the
          hook so it reads as a quiet aside, not another headline.
          Hidden when absent (pre-Z1 cached batches). */}
      {idea.whyThisFitsYou ? (
        <Text style={styles.whyFitsLine} accessibilityLabel="Why this fits you">
          {idea.whyThisFitsYou}
        </Text>
      ) : null}

      {/* PRIMARY trust block — the user-facing "Hook / What to
          show / How to film" structure. These three blocks are
          deliberately the most prominent part of the card. */}
      {idea.whatToShow ? (
        <>
          <Text style={styles.cardLabel}>What to show</Text>
          <Text style={styles.cardBody}>{idea.whatToShow}</Text>
        </>
      ) : idea.visualHook ? (
        // Back-compat: cached batches from before the v2 prompt
        // only have `visualHook` (a one-liner). Render it under
        // the old label so old cards don't lose their context.
        <>
          <Text style={styles.cardLabel}>Open with</Text>
          <Text style={styles.cardBody}>{idea.visualHook}</Text>
        </>
      ) : null}
      {idea.howToFilm ? (
        <>
          <Text style={styles.cardLabel}>How to film</Text>
          <Text style={styles.cardBody}>{idea.howToFilm}</Text>
        </>
      ) : null}

      {/* Supporting context — "Why this works".
          We derive 2–3 short, plain-language confidence lines
          from the idea's own metadata rather than rendering the
          LLM's `whyItWorks` free-text. The model used to leak
          internal pattern names ("denial_loop core", etc.) into
          this slot, which read like docs and added friction.
          See lib/whyThisWorks.ts for the contract. */}
      <Text style={styles.cardLabel}>Why this works</Text>
      {deriveWhyThisWorksLines(idea).map((line, idx) => (
        <Text key={idx} style={styles.cardBodySmall}>
          {line}
        </Text>
      ))}
      {idea.caption ? (
        <>
          <Text style={styles.cardLabel}>Caption</Text>
          <Text style={styles.cardBodySmall}>{idea.caption}</Text>
        </>
      ) : null}

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>15–30s video</Text>
        {shootLine ? (
          <Text style={styles.metaText}>{shootLine}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 18,
    padding: 18,
    marginVertical: 8,
  },
  cardHighlight: {
    borderColor: lumina.firefly,
    backgroundColor: "rgba(0,255,204,0.06)",
  },
  kickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    gap: 8,
  },
  cardKicker: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  // Small recognisable badge naming the canonical TikTok pattern
  // this idea maps to ("POV", "Reaction", "Before / After", etc).
  // The trust signal: this isn't a freeform "topic about X", it
  // fits a known winning format.
  patternBadge: {
    backgroundColor: "rgba(0,255,204,0.12)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.3)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  patternBadgeText: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 10,
    letterSpacing: 0.8,
  },
  // Visible-adaptation pill — sits next to the pattern badge in
  // the kicker row when the user just completed Quick Tune. Same
  // visual family as the pattern badge (teal pill on dark) but a
  // touch warmer to read as a small celebration rather than a
  // metadata label.
  fitsBadge: {
    backgroundColor: "rgba(0,255,204,0.18)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.45)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  fitsBadgeText: {
    fontFamily: fontFamily.bodyBold,
    color: "#FFFFFF",
    fontSize: 10,
    letterSpacing: 0.8,
  },
  metaRow: {
    marginTop: 14,
    gap: 4,
  },
  metaPill: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  metaText: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.75)",
    fontSize: 12,
  },
  cardHook: {
    ...type.subhead,
    color: "#FFFFFF",
    marginBottom: 14,
  },
  // PHASE Z1 — quiet italic trust line under the hook. Same font
  // family as body text but italic + slightly dimmer so it
  // disappears into the card's background hierarchy rather than
  // competing with the hook or the "What to show" block.
  whyFitsLine: {
    ...type.body,
    fontStyle: "italic",
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    lineHeight: 18,
    marginTop: -8,
    marginBottom: 14,
  },
  cardLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 6,
    marginBottom: 4,
  },
  cardBody: {
    ...type.body,
    color: "rgba(255,255,255,0.85)",
    fontSize: 15,
    lineHeight: 21,
  },
  // Smaller variant used for the supporting context (Why it works,
  // Caption) so the primary "What to show / How to film" trust
  // block dominates the card visually.
  cardBodySmall: {
    ...type.body,
    color: "rgba(255,255,255,0.65)",
    fontSize: 13,
    lineHeight: 18,
  },
});
