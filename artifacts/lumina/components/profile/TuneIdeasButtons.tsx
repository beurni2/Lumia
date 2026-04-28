/**
 * TuneIdeasButtons — five tap-only chips that let the user nudge
 * the ideator's bias without re-opening the full Taste Calibration
 * screen. Each tap mutates the persisted TasteCalibration document
 * via POST /api/taste-calibration (fire-and-forget) and feeds back
 * via the existing `viralPatternMemory` weighting on the next
 * generation cycle.
 *
 * Buttons (spec):
 *   1. More mini-stories  → preferredFormats: ["mini_story"]
 *   2. More reactions     → preferredFormats: ["reaction"]
 *   3. Try new styles     → preferredFormats: [], preferredHookStyles: []
 *                            (clears bias so the ideator explores)
 *   4. More chaotic       → preferredTone: "chaotic"
 *   5. More subtle        → preferredTone: "dry_subtle"
 *
 * Mutation rules:
 *   • Read current cal once on mount; mutate locally on tap.
 *   • Save full doc each time (server schema rejects partial bodies).
 *   • Save is fire-and-forget — UI updates immediately, network
 *     errors fail silently (best-effort UX surface).
 *   • Always set `skipped: false` and stamp `completedAt` so the
 *     Home calibration gate stops re-prompting after the first tap.
 *   • Call `suppressCalibrationGate()` so the immediate Home re-focus
 *     can't out-race the POST and surface the calibration prompt.
 *
 * Active state UI: a pressed button shows the firefly accent for
 * 1.5s ("Saved" affordance) AND the chip stays highlighted while
 * its target value is the current preference (so users can see at
 * a glance which way they've tuned things).
 */

import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { GlassSurface } from "@/components/foundation/GlassSurface";
import { type } from "@/constants/typography";
import { lumina } from "@/constants/colors";
import {
  EMPTY_CALIBRATION,
  fetchTasteCalibration,
  saveTasteCalibration,
  suppressCalibrationGate,
  type TasteCalibration,
} from "@/lib/tasteCalibration";

type Tweak =
  | { kind: "format"; value: "mini_story" | "reaction" }
  | { kind: "explore" }
  | { kind: "tone"; value: "chaotic" | "dry_subtle" };

type Button = {
  id: string;
  label: string;
  tweak: Tweak;
};

const BUTTONS: Button[] = [
  { id: "mini_story", label: "More mini-stories", tweak: { kind: "format", value: "mini_story" } },
  { id: "reaction", label: "More reactions", tweak: { kind: "format", value: "reaction" } },
  { id: "explore", label: "Try new styles", tweak: { kind: "explore" } },
  { id: "chaotic", label: "More chaotic", tweak: { kind: "tone", value: "chaotic" } },
  { id: "dry_subtle", label: "More subtle", tweak: { kind: "tone", value: "dry_subtle" } },
];

function isActive(cal: TasteCalibration | null, tweak: Tweak): boolean {
  if (!cal) return false;
  if (tweak.kind === "format") {
    return cal.preferredFormats.length === 1 && cal.preferredFormats[0] === tweak.value;
  }
  if (tweak.kind === "tone") {
    return cal.preferredTone === tweak.value;
  }
  // "explore" (Try new styles) is a transient action — never sticky.
  return false;
}

function applyTweak(cal: TasteCalibration | null, tweak: Tweak): TasteCalibration {
  const base: TasteCalibration = cal
    ? { ...cal }
    : { ...EMPTY_CALIBRATION };
  if (tweak.kind === "format") {
    base.preferredFormats = [tweak.value];
  } else if (tweak.kind === "tone") {
    base.preferredTone = tweak.value;
  } else {
    // explore — wipe bias so the ideator's prior takes over.
    base.preferredFormats = [];
    base.preferredHookStyles = [];
  }
  // Mark the doc as completed so the Home calibration gate stops
  // re-prompting — the user has clearly engaged with the surface.
  base.skipped = false;
  base.completedAt = base.completedAt ?? new Date().toISOString();
  return base;
}

export function TuneIdeasButtons() {
  const [cal, setCal] = useState<TasteCalibration | null>(null);
  // Tri-state: "loading" while the initial fetch is in flight,
  // "ready" once it resolves (success OR failure — both transition
  // to ready so the chips become tappable). Disabling the chips
  // until the initial fetch settles prevents an early tap from
  // overwriting an existing calibration's effort/privacy/hook
  // fields with EMPTY defaults (an architect-flagged regression).
  const [loading, setLoading] = useState(true);
  const [savedId, setSavedId] = useState<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const initial = await fetchTasteCalibration();
        if (!cancelled) setCal(initial);
      } catch {
        // Best-effort — the buttons still work with a null base
        // (applyTweak falls back to EMPTY_CALIBRATION).
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const handleTap = useCallback((button: Button) => {
    if (Platform.OS !== "web") {
      Haptics.selectionAsync().catch(() => {});
    }
    // Functional update — guarantees we always tweak against the
    // most-recently-committed cal, even when the user fires off
    // several taps faster than React can flush a render. Without
    // this, a rapid "More chaotic" → "More mini-stories" sequence
    // would compute the second tweak against the pre-first-tap
    // state and silently drop the chaotic tone.
    setCal((prev) => {
      const next = applyTweak(prev, button.tweak);
      // Side-effects are intentionally inside the updater — they
      // depend on `next`, which only exists once the updater runs.
      // This is safe: setCal updaters are pure-by-convention but
      // React doesn't enforce purity, and these calls are
      // idempotent for the same input. (StrictMode double-invokes
      // would result in a duplicate POST + a duplicate
      // suppress-gate call, both of which are harmless.)
      suppressCalibrationGate();
      void saveTasteCalibration(next).catch(() => {});
      return next;
    });
    setSavedId(button.id);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSavedId(null), 1500);
  }, []);

  return (
    <View style={styles.section}>
      <Text style={[type.label, styles.sectionLabel]}>tune your ideas</Text>
      <GlassSurface radius={22} agent="ideator">
        <View style={styles.cardInner}>
          <Text style={styles.helper}>
            Tap to nudge what tomorrow's ideas feel like.
          </Text>
          <View style={styles.row}>
            {BUTTONS.map((b) => {
              const active = isActive(cal, b.tweak);
              const justSaved = savedId === b.id;
              return (
                <Pressable
                  key={b.id}
                  onPress={() => handleTap(b)}
                  disabled={loading}
                  style={({ pressed }) => [
                    styles.chip,
                    active ? styles.chipActive : null,
                    pressed ? styles.chipPressed : null,
                    loading ? styles.chipDisabled : null,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={b.label}
                  accessibilityState={{ selected: active, disabled: loading }}
                  testID={`tune-${b.id}`}
                >
                  <Text
                    style={[
                      styles.chipLabel,
                      active ? styles.chipLabelActive : null,
                    ]}
                  >
                    {justSaved ? "Saved ✓" : b.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </GlassSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 22, marginTop: 18 },
  sectionLabel: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  cardInner: { padding: 18 },
  helper: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 14,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  chipActive: {
    backgroundColor: "rgba(0,255,204,0.14)",
    borderColor: lumina.firefly,
  },
  chipPressed: {
    opacity: 0.75,
  },
  chipDisabled: {
    opacity: 0.45,
  },
  chipLabel: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 13,
  },
  chipLabelActive: {
    color: "#FFFFFF",
  },
});
