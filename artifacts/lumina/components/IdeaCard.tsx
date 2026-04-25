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

  return (
    <View
      style={[styles.card, highlight ? styles.cardHighlight : null]}
      accessibilityRole="summary"
    >
      <View style={styles.cardHeader}>
        <Text style={styles.cardKicker}>
          {index ? `idea ${index}` : "first idea"}
          {typeof idea.hookSeconds === "number"
            ? ` · hook ${idea.hookSeconds}s`
            : ""}
        </Text>
        {typeof idea.videoLengthSec === "number" &&
        typeof idea.filmingTimeMin === "number" ? (
          <Text style={styles.cardKickerRight}>
            {idea.videoLengthSec}s · film in {idea.filmingTimeMin}m
          </Text>
        ) : null}
      </View>
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
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  cardKicker: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  cardKickerRight: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
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
