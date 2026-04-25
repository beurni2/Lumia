/**
 * Shared idea card — used both in onboarding's quick-win reveal
 * and on the Home screen's "today's 3 ideas" feed. Single source
 * of styling so the card looks identical in both surfaces.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { lumina } from "@/constants/colors";
import { fontFamily, type } from "@/constants/typography";

// Mirrors the ideator response shape from the server (only the
// fields the card actually displays). Anything optional here is
// either truly optional in the contract (`visualHook`) or guarded
// against transient AI provider responses where a field went
// missing — defensive rendering is cheaper than a crash.
export type IdeaCardData = {
  id?: string;
  hook: string;
  hookSeconds?: number;
  videoLengthSec?: number;
  filmingTimeMin?: number;
  whyItWorks?: string;
  visualHook?: string;
  caption?: string;
  payoffType?: string;
};

export function IdeaCard({
  idea,
  index,
  highlight,
}: {
  idea: IdeaCardData;
  index?: number;
  highlight?: boolean;
}) {
  // Surface contract drift loudly in development. If the ideator
  // ever stops returning the body fields we expect, we want to
  // see it in the Metro logs immediately rather than discover it
  // by way of a customer-reported "the idea card is empty".
  if (
    __DEV__ &&
    !idea.whyItWorks &&
    !idea.visualHook &&
    !idea.caption
  ) {
    console.warn(
      "[IdeaCard] idea has hook only; missing whyItWorks/visualHook/caption — possible API drift",
      { hook: idea.hook?.slice(0, 60) },
    );
  }

  // Friendly metadata footer — kept deliberately to two human
  // pieces (length + filming time). Hook-second timing and other
  // production-y numbers are dropped from the card to keep it
  // feeling like a creative prompt, not a dashboard.
  const lengthChip =
    typeof idea.videoLengthSec === "number"
      ? `${idea.videoLengthSec} sec video`
      : null;
  const filmChip =
    typeof idea.filmingTimeMin === "number"
      ? `${idea.filmingTimeMin} min to film`
      : null;

  return (
    <View
      style={[styles.card, highlight ? styles.cardHighlight : null]}
      accessibilityRole="summary"
    >
      <Text style={styles.cardKicker}>
        {index ? `idea ${index}` : "first idea"}
      </Text>
      <Text style={styles.cardHook}>{idea.hook}</Text>
      {idea.visualHook ? (
        <>
          <Text style={styles.cardLabel}>Open with</Text>
          <Text style={styles.cardBody}>{idea.visualHook}</Text>
        </>
      ) : null}
      {idea.whyItWorks ? (
        <>
          <Text style={styles.cardLabel}>Why it works</Text>
          <Text style={styles.cardBody}>{idea.whyItWorks}</Text>
        </>
      ) : null}
      {idea.caption ? (
        <>
          <Text style={styles.cardLabel}>Caption</Text>
          <Text style={styles.cardBody}>{idea.caption}</Text>
        </>
      ) : null}
      {lengthChip || filmChip ? (
        <View style={styles.metaRow}>
          {lengthChip ? (
            <View style={styles.metaPill}>
              <Text style={styles.metaText}>{lengthChip}</Text>
            </View>
          ) : null}
          {filmChip ? (
            <View style={styles.metaPill}>
              <Text style={styles.metaText}>{filmChip}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
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
  cardKicker: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 14,
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
});
