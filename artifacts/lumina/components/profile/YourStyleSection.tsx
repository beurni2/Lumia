/**
 * YourStyleSection — replaces the old "Style Twin" status block on
 * Profile. Reads two existing endpoints (no new server work):
 *
 *   • GET /api/style-profile      → viralMemory.{topFormats,topHookStyles,
 *                                   topEmotionalSpike} + derivedTone
 *   • GET /api/taste-calibration  → preferred{Formats,Tone,HookStyles}
 *                                   + privacyAvoidances (the "avoiding"
 *                                   row)
 *
 * Render contract (3 rows inside a GlassSurface card titled "Your
 * Style"):
 *
 *   Mostly:    [top format] · [tone] · [top emotional spike]
 *   You like:  hook openers as quoted examples
 *   Avoiding:  privacy avoidances joined human-friendly,
 *              or the empty-state line "Nothing in particular yet"
 *
 * Data fallback rules (so a brand-new user with sampleSize=0 still
 * sees an honest, non-empty card):
 *   • format:  topFormats[0] || preferredFormats[0] || null
 *   • tone:    derivedTone   || preferredTone        || null
 *   • spike:   topEmotionalSpike || null (omitted if null)
 *   • hooks:   topHookStyles[]  || preferredHookStyles[]
 *
 * If BOTH viralMemory AND tasteCalibration are empty, we render a
 * single honest line: "Use the buttons below to start tuning."
 *
 * Label maps are inlined (mirroring artifacts/lumina/app/(tabs)/
 * studio.tsx) so this component stays self-contained — no new shared
 * module to maintain.
 */

import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { customFetch } from "@workspace/api-client-react";

import { GlassSurface } from "@/components/foundation/GlassSurface";
import { type } from "@/constants/typography";
import {
  fetchTasteCalibration,
  type PreferredFormat,
  type PreferredHookStyle,
  type PreferredTone,
  type PrivacyAvoidance,
  type TasteCalibration,
} from "@/lib/tasteCalibration";
import type {
  DerivedToneValue,
  ViralMemorySummary,
} from "@/hooks/useStudioSummary";

/* ------------------------------------------------------------------ */
/* Label maps — mirror artifacts/lumina/app/(tabs)/studio.tsx so a    */
/* server-side enum rename surfaces here in code review (not at run). */
/* ------------------------------------------------------------------ */

const FORMAT_LABELS: Record<string, string> = {
  mini_story: "Mini-stories",
  reaction: "Reactions",
  pov: "POV",
  contrast: "Contrast",
  mixed: "Mixed",
};

const TONE_LABELS_DERIVED: Record<DerivedToneValue, string> = {
  dry: "Dry tone",
  chaotic: "Chaotic energy",
  "self-aware": "Self-aware",
  confident: "Confident",
};

const TONE_LABELS_CAL: Record<PreferredTone, string> = {
  dry_subtle: "Dry tone",
  chaotic: "Chaotic energy",
  bold: "Confident",
  self_aware: "Self-aware",
  // PHASE Z5.8 — 5th Quick Tune tone option.
  high_energy_rant: "High-energy rant",
};

const HOOK_LABELS_VIRAL: Record<string, string> = {
  the_way_i: "“the way I…”",
  why_do_i: "“why do I…”",
  internal_thought: "Internal thought",
  curiosity: "Curiosity",
  contrast: "Contrast",
};

const HOOK_LABELS_CAL: Record<PreferredHookStyle, string> = {
  behavior_hook: "“the way I…”",
  thought_hook: "“why do I…”",
  curiosity_hook: "“this is where it went wrong…”",
  contrast_hook: "“what I say vs what I do”",
  // PHASE Z5.8 — 5th opener option (optional step).
  pov_hook: "POV opener",
};

const EMOTIONAL_SPIKE_LABELS: Record<string, string> = {
  embarrassment: "Relatable embarrassment",
  regret: "Regret moments",
  denial: "Denial energy",
  panic: "Quiet panic",
  irony: "Ironic moments",
};

const PRIVACY_LABELS: Record<PrivacyAvoidance, string> = {
  avoid_messages: "DM screenshots",
  avoid_finance: "Money / balances on camera",
  avoid_people: "Other people on camera",
  avoid_private_info: "Personal info on camera",
  no_privacy_limits: "",
};

function labelFromTag(map: Record<string, string>, tag: string): string {
  return map[tag] ?? tag.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

/* ------------------------------------------------------------------ */
/* Server payload types — narrow projections of the route response.   */
/* ------------------------------------------------------------------ */

type StyleProfilePayload = {
  derivedTone: DerivedToneValue | null;
  viralMemory: ViralMemorySummary | null;
};

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */

export function YourStyleSection() {
  const [profile, setProfile] = useState<StyleProfilePayload | null>(null);
  const [cal, setCal] = useState<TasteCalibration | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Two independent reads; either one may fail without blanking
      // the whole card. Each settled-result is guarded against the
      // unmount race so a slow network can't setState on a dead
      // component.
      const [profileRes, calRes] = await Promise.allSettled([
        customFetch<StyleProfilePayload>("/api/style-profile"),
        fetchTasteCalibration(),
      ]);
      if (cancelled) return;
      if (profileRes.status === "fulfilled") setProfile(profileRes.value);
      if (calRes.status === "fulfilled") setCal(calRes.value);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const memory = profile?.viralMemory ?? null;
  const derivedTone = profile?.derivedTone ?? null;

  // Mostly row — top format, tone, optional emotional spike.
  const mostlyParts: string[] = [];
  const topFormatTag =
    memory?.topFormat ?? cal?.preferredFormats?.[0] ?? null;
  if (topFormatTag) {
    mostlyParts.push(labelFromTag(FORMAT_LABELS, topFormatTag));
  }
  if (derivedTone) {
    mostlyParts.push(TONE_LABELS_DERIVED[derivedTone]);
  } else if (cal?.preferredTone) {
    mostlyParts.push(TONE_LABELS_CAL[cal.preferredTone]);
  }
  if (memory?.topEmotionalSpike) {
    mostlyParts.push(
      labelFromTag(EMOTIONAL_SPIKE_LABELS, memory.topEmotionalSpike),
    );
  }

  // You-like row — quoted hook examples.
  const hookLabels: string[] = [];
  if (memory && memory.topHookStyles.length > 0) {
    for (const h of memory.topHookStyles.slice(0, 2)) {
      hookLabels.push(labelFromTag(HOOK_LABELS_VIRAL, h.name));
    }
  } else if (cal && cal.preferredHookStyles.length > 0) {
    for (const h of cal.preferredHookStyles.slice(0, 2)) {
      hookLabels.push(HOOK_LABELS_CAL[h]);
    }
  }

  // Avoiding row — privacy avoidances expressed positively as
  // "things Lumina won't ask you to do".
  const avoidLabels: string[] = [];
  if (cal) {
    for (const p of cal.privacyAvoidances) {
      const label = PRIVACY_LABELS[p];
      if (label) avoidLabels.push(label);
    }
  }

  const hasAnySignal =
    mostlyParts.length > 0 || hookLabels.length > 0 || avoidLabels.length > 0;

  return (
    <View style={styles.section}>
      <Text style={[type.label, styles.sectionLabel]}>your style</Text>
      <GlassSurface radius={22} agent="ideator" breathing>
        <View style={styles.cardInner}>
          {loading ? (
            <Text style={styles.empty}>Loading your style…</Text>
          ) : !hasAnySignal ? (
            <Text style={styles.empty}>
              Use the buttons below to start tuning.
            </Text>
          ) : (
            <>
              {mostlyParts.length > 0 && (
                <Row label="Mostly" value={mostlyParts.join("  ·  ")} />
              )}
              {hookLabels.length > 0 && (
                <Row label="You like" value={hookLabels.join("   ")} />
              )}
              <Row
                label="Avoiding"
                value={
                  avoidLabels.length > 0
                    ? avoidLabels.join(", ")
                    : "Nothing in particular yet"
                }
                muted={avoidLabels.length === 0}
              />
            </>
          )}
        </View>
      </GlassSurface>
    </View>
  );
}

function Row({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, muted ? styles.rowValueMuted : null]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 22 },
  sectionLabel: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  cardInner: { padding: 18, gap: 14 },
  row: { flexDirection: "column", gap: 4 },
  rowLabel: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  rowValue: {
    color: "#FFFFFF",
    fontSize: 15,
    lineHeight: 21,
  },
  rowValueMuted: {
    color: "rgba(255,255,255,0.55)",
  },
  empty: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
});
