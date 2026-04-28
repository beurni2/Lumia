/**
 * Taste Calibration — the lightweight Quick Tune that surfaces
 * AFTER the Style Profile reveal OR after the user has viewed 2-3
 * ideas on Home. Tap-only, ~10 seconds end to end, no typing.
 *
 * Three single-select steps with auto-advance (no Next button):
 *   step 0 → format
 *   step 1 → tone
 *   step 2 → hook style
 *   step 3 → confirmation card with fade + scale, ~800 ms, then
 *            onComplete()
 *
 * Hook style is single-select on this surface (the persisted shape
 * still carries `preferredHookStyles: PreferredHookStyle[]` so the
 * server zod schema is unchanged — we just send a 1-element array).
 * Multi-select would require a Next button, which the spec
 * explicitly forbids ("auto advances (no next button)"); making
 * hook single-select is the smallest change that honours that.
 *
 * Save side effects fire SYNCHRONOUSLY when the hook step's choice
 * is tapped (i.e. as we transition into step 3) so the fire-and-
 * forget POST is in flight while the confirmation animation plays.
 * That matches the "user must SEE the system adapt" UX principle —
 * by the time the 800 ms confirmation finishes, the home screen's
 * post-cal effect can already trigger a regenerate against the
 * fresh server-side bias.
 *
 * Skip stays a small persistent link below the question. It keeps
 * its old contract (suppress + same-process latch + skipped POST)
 * and DOES NOT arm the post-cal refresh flag — Skip means "ask me
 * later", not "you've adapted to nothing".
 */

import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { cosmic, lumina } from "@/constants/colors";
import { fontFamily, type } from "@/constants/typography";
import {
  EMPTY_CALIBRATION,
  markCalibrationPromptedThisProcess,
  saveTasteCalibration,
  skipTasteCalibration,
  suppressCalibrationGate,
  type PreferredFormat,
  type PreferredHookStyle,
  type PreferredTone,
  type TasteCalibration as TasteCalibrationDoc,
} from "@/lib/tasteCalibration";
import {
  markPendingPostCalibrationRefresh,
  markTasteOnboardingCompleted,
} from "@/lib/tasteOnboardingState";

type Props = {
  onComplete: () => void;
};

type Choice<T extends string> = { value: T; label: string; sub?: string };

const FORMAT_CHOICES: Choice<PreferredFormat>[] = [
  { value: "mini_story", label: "Mini-stories", sub: "me explaining something vs what I actually do" },
  { value: "reaction", label: "Reactions", sub: "the way I check something and instantly regret it" },
  { value: "pov", label: "POVs", sub: "pretending you're paying attention but you're not" },
  { value: "mixed", label: "A mix of everything", sub: "surprise me" },
];

const TONE_CHOICES: Choice<PreferredTone>[] = [
  { value: "dry_subtle", label: "Dry / subtle", sub: "I'm fine 🙂 (I'm not)" },
  { value: "chaotic", label: "Chaotic / expressive", sub: "why is everything happening at once 😭" },
  { value: "bold", label: "Confident / bold", sub: "I already know how this ends" },
  { value: "self_aware", label: "Awkward / self-aware", sub: "I shouldn't have done that 💀" },
];

const HOOK_CHOICES: Choice<PreferredHookStyle>[] = [
  { value: "behavior_hook", label: '"The way I…"', sub: "Behavior hooks" },
  { value: "thought_hook", label: '"Why do I…"', sub: "Thought hooks" },
  { value: "curiosity_hook", label: '"This is where it went wrong…"', sub: "Curiosity hooks" },
  { value: "contrast_hook", label: '"What I say vs what I do"', sub: "Contrast hooks" },
];

// Short summary chips shown on the confirmation card. Kept
// distinct from the full sub-line copy so the confirmation reads
// like a punchy "we got it" rather than re-listing the question
// options. Format / tone / hook are sourced from the same
// constant set — three short labels, easy to scan.
const FORMAT_SUMMARY: Record<PreferredFormat, string> = {
  mini_story: "Mini-stories",
  reaction: "Reactions",
  pov: "POVs",
  mixed: "A mix of formats",
};
const TONE_SUMMARY: Record<PreferredTone, string> = {
  dry_subtle: "Dry tone",
  chaotic: "Chaotic energy",
  bold: "Confident voice",
  self_aware: "Self-aware humor",
};
const HOOK_SUMMARY: Record<PreferredHookStyle, string> = {
  behavior_hook: "“the way I…”",
  thought_hook: "“why do I…”",
  curiosity_hook: "“where it went wrong…”",
  contrast_hook: "“say vs do”",
};

// Confirmation animation budget. Spec calls for "fade + slight
// scale, ~800 ms" — we split that into a fast intro (220 ms fade
// + scale-up overshoot) and a hold so the user can read the three
// chips before we hand control back to onComplete().
const CONFIRMATION_TOTAL_MS = 800;

function lightHaptic() {
  if (Platform.OS !== "web") {
    Haptics.selectionAsync().catch(() => {});
  }
}

function successHaptic() {
  if (Platform.OS !== "web") {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {},
    );
  }
}

export function TasteCalibration({ onComplete }: Props) {
  // step 0 = format, 1 = tone, 2 = hook, 3 = confirmation
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [format, setFormat] = useState<PreferredFormat | null>(null);
  const [tone, setTone] = useState<PreferredTone | null>(null);
  const [hookStyle, setHookStyle] = useState<PreferredHookStyle | null>(null);

  // Single in-flight latch: blocks double-tap from re-running the
  // save side effects when the hook step's choice fires twice in
  // the same tick (Pressable can deliver onPress + onPressOut in
  // very fast succession, especially on web). Once the save fires
  // we never go back, so a one-shot ref is enough.
  const [busy, setBusy] = useState(false);
  // Synchronous one-shot guard for the actual save POST + flag
  // arming. React state updates are async, so two presses within
  // the same render frame can both observe `busy === false` and
  // both call fireSaveSideEffects(). This ref is set and checked
  // synchronously in the same call, which closes that window.
  // It guards both handleHookPick and handleSkip because they
  // are mutually-exclusive terminal paths — only one of them
  // should ever fire its side effects per session.
  const saveFiredRef = useRef(false);

  // Save side effects: identical contract to the previous monolithic
  // handleSave (suppress + latch + mark-complete + fire-and-forget
  // POST) PLUS the new pending-post-cal-refresh flag that wakes the
  // home-screen's visible-adaptation effect on the next focus.
  // Fired exactly once when the user picks their hook style.
  const fireSaveSideEffects = useCallback(
    (chosenFormat: PreferredFormat, chosenTone: PreferredTone, chosenHook: PreferredHookStyle) => {
      const doc: TasteCalibrationDoc = {
        ...EMPTY_CALIBRATION,
        preferredFormats: [chosenFormat],
        preferredTone: chosenTone,
        // Persisted shape is still an array — server zod schema is
        // unchanged. The Quick Tune just constrains itself to a
        // single-element selection so each step can auto-advance.
        preferredHookStyles: [chosenHook],
        skipped: false,
      };
      successHaptic();
      // Same race-prevention as the previous handler: suppress and
      // latch BEFORE the fire-and-forget POST settles so the home
      // gate can't out-race the navigation back to /(tabs).
      suppressCalibrationGate();
      markCalibrationPromptedThisProcess();
      // Local "completed" flag is what the home gate keys off — flip
      // it before navigating so the next focus doesn't re-prompt.
      void markTasteOnboardingCompleted();
      // Wake the visible-adaptation effect on the home screen's
      // next focus so the user sees ideas update with the fresh
      // bias. Detached — the AsyncStorage write is fast and
      // failure is acceptable (we just skip the celebratory
      // treatment, the calibration itself still saved).
      void markPendingPostCalibrationRefresh();
      // Detached POST — never blocks navigation. Same fire-and-
      // forget pattern as the prior implementation; on the rare
      // network failure the next cold start will show the prompt
      // again, which is the acceptable failure mode.
      void saveTasteCalibration(doc).catch(() => {});
    },
    [],
  );

  const handleFormatPick = useCallback(
    (v: PreferredFormat) => {
      if (busy) return;
      lightHaptic();
      setFormat(v);
      setStep(1);
    },
    [busy],
  );

  const handleTonePick = useCallback(
    (v: PreferredTone) => {
      if (busy) return;
      lightHaptic();
      setTone(v);
      setStep(2);
    },
    [busy],
  );

  const handleHookPick = useCallback(
    (v: PreferredHookStyle) => {
      // Double-tap latch: the hook step's tap is the one that
      // fires the save POST and arms the post-cal refresh flag.
      // We only ever want that to happen once per session, so
      // bail immediately if a previous tap already started the
      // confirmation transition. The ref check is the real
      // guarantee — `busy` state lags by a render and would let
      // a same-frame double-press through.
      if (saveFiredRef.current) return;
      // Defensive: format and tone should always be set by the
      // time we land on step 2, but if a developer tool or
      // unexpected re-render skipped the earlier steps, bail
      // without firing the side effects rather than persisting a
      // half-empty doc.
      if (format === null || tone === null) return;
      saveFiredRef.current = true;
      setBusy(true);
      lightHaptic();
      setHookStyle(v);
      fireSaveSideEffects(format, tone, v);
      setStep(3);
    },
    [format, tone, fireSaveSideEffects],
  );

  const handleSkip = useCallback(() => {
    // Same synchronous one-shot guard as the hook pick — the two
    // terminal paths are mutually exclusive, so a single shared
    // ref is the right primitive.
    if (saveFiredRef.current) return;
    saveFiredRef.current = true;
    setBusy(true);
    // Same race-prevention as the previous handler — suppress and
    // latch synchronously so the immediate Home re-focus can't
    // out-race the navigation. Skip does NOT mark completion (so
    // the next cold start can re-prompt) and does NOT arm the
    // post-cal refresh (Skip didn't change anything we should
    // celebrate).
    suppressCalibrationGate();
    markCalibrationPromptedThisProcess();
    void skipTasteCalibration().catch(() => {});
    onComplete();
  }, [busy, onComplete]);

  // Confirmation step lives below — when we land on step 3 we
  // schedule the auto-dismiss timer ourselves so the parent's
  // onComplete() runs after the animation has had time to land.
  useEffect(() => {
    if (step !== 3) return;
    const t = setTimeout(onComplete, CONFIRMATION_TOTAL_MS);
    return () => clearTimeout(t);
  }, [step, onComplete]);

  // Tiny step kicker — keeps the user oriented without adding a
  // progress bar (which the spec doesn't ask for). Hidden on the
  // confirmation step so the "Got it" beat reads cleanly.
  const stepKicker = useMemo(() => {
    if (step === 0) return "Quick tune · 1 of 3";
    if (step === 1) return "Quick tune · 2 of 3";
    if (step === 2) return "Quick tune · 3 of 3";
    return null;
  }, [step]);

  if (step === 3 && format && tone && hookStyle) {
    return (
      <ConfirmationCard
        formatLabel={FORMAT_SUMMARY[format]}
        toneLabel={TONE_SUMMARY[tone]}
        hookLabel={HOOK_SUMMARY[hookStyle]}
      />
    );
  }

  return (
    <Animated.View
      // Re-key the entering animation per step so each question
      // gets its own gentle fade-in rather than reusing the
      // previous step's view.
      key={`step-${step}`}
      entering={FadeIn.duration(240)}
      style={styles.stage}
    >
      {stepKicker ? <Text style={styles.stepKicker}>{stepKicker}</Text> : null}

      {step === 0 ? (
        <>
          <Text style={styles.heroTitle}>What format feels most like you?</Text>
          <Text style={styles.heroSub}>Tap one — no wrong answer.</Text>
          <SingleSelect
            choices={FORMAT_CHOICES}
            value={format}
            onChange={handleFormatPick}
            disabled={busy}
          />
        </>
      ) : null}

      {step === 1 ? (
        <>
          <Text style={styles.heroTitle}>What tone do you naturally land on?</Text>
          <Text style={styles.heroSub}>Tap one — no wrong answer.</Text>
          <SingleSelect
            choices={TONE_CHOICES}
            value={tone}
            onChange={handleTonePick}
            disabled={busy}
          />
        </>
      ) : null}

      {step === 2 ? (
        <>
          <Text style={styles.heroTitle}>Which opener feels most like you?</Text>
          <Text style={styles.heroSub}>Tap one — no wrong answer.</Text>
          <SingleSelect
            choices={HOOK_CHOICES}
            value={hookStyle}
            onChange={handleHookPick}
            disabled={busy}
          />
        </>
      ) : null}

      <Pressable
        onPress={handleSkip}
        disabled={busy}
        style={({ pressed }) => [
          styles.skip,
          pressed && !busy ? styles.skipPressed : null,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Skip for now"
      >
        <Text style={styles.skipLabel}>Skip for now</Text>
      </Pressable>
    </Animated.View>
  );
}

/* =================== Confirmation card =================== */

function ConfirmationCard({
  formatLabel,
  toneLabel,
  hookLabel,
}: {
  formatLabel: string;
  toneLabel: string;
  hookLabel: string;
}) {
  // Reanimated shared values: opacity 0→1 over 220 ms (snappy fade
  // in), scale 0.94 → 1.02 → 1.0 (subtle overshoot) over 360 ms.
  // The combined motion lands inside the 800 ms total so the user
  // has ~440 ms of held, fully-visible state to read the chips
  // before the home screen takes over.
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.94);

  useEffect(() => {
    opacity.value = withTiming(1, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
    scale.value = withSequence(
      withTiming(1.02, {
        duration: 220,
        easing: Easing.out(Easing.cubic),
      }),
      withTiming(1, {
        duration: 140,
        easing: Easing.inOut(Easing.cubic),
      }),
    );
  }, [opacity, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <View style={styles.confirmStage}>
      <Animated.View style={[styles.confirmCard, animatedStyle]}>
        <Text style={styles.confirmKicker}>Got it</Text>
        <Text style={styles.confirmTitle}>
          Making your ideas more:
        </Text>
        <View style={styles.confirmChips}>
          <View style={styles.confirmChip}>
            <Text style={styles.confirmChipText}>{formatLabel}</Text>
          </View>
          <Text style={styles.confirmDot}>•</Text>
          <View style={styles.confirmChip}>
            <Text style={styles.confirmChipText}>{toneLabel}</Text>
          </View>
          <Text style={styles.confirmDot}>•</Text>
          <View style={styles.confirmChip}>
            <Text style={styles.confirmChipText}>{hookLabel}</Text>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

/* =================== Sub-components =================== */

function SingleSelect<T extends string>({
  choices,
  value,
  onChange,
  disabled,
}: {
  choices: Choice<T>[];
  value: T | null;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.choices}>
      {choices.map((c) => {
        const selected = value === c.value;
        return (
          <Pressable
            key={c.value}
            onPress={() => onChange(c.value)}
            disabled={disabled}
            style={({ pressed }) => [
              styles.choice,
              selected ? styles.choiceSelected : null,
              pressed && !disabled && !selected ? styles.choicePressed : null,
              disabled ? styles.choiceDisabled : null,
            ]}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={c.label}
          >
            <Text
              style={[
                styles.choiceLabel,
                selected ? styles.choiceLabelSelected : null,
              ]}
            >
              {c.label}
            </Text>
            {c.sub ? <Text style={styles.choiceSub}>{c.sub}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/* =================== Styles =================== */

const styles = StyleSheet.create({
  stage: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
  },
  stepKicker: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  heroTitle: {
    ...type.display,
    color: "#FFFFFF",
    marginBottom: 10,
    fontSize: 26,
    lineHeight: 32,
  },
  heroSub: {
    ...type.body,
    color: "rgba(255,255,255,0.7)",
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 22,
  },
  choices: {
    gap: 8,
    marginBottom: 18,
  },
  choice: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  choicePressed: {
    backgroundColor: "rgba(0,255,204,0.08)",
    borderColor: "rgba(0,255,204,0.4)",
  },
  choiceSelected: {
    backgroundColor: "rgba(0,255,204,0.14)",
    borderColor: lumina.firefly,
  },
  choiceDisabled: {
    opacity: 0.5,
  },
  choiceLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.92)",
    fontSize: 15,
  },
  choiceLabelSelected: {
    color: "#FFFFFF",
    fontFamily: fontFamily.bodyBold,
  },
  choiceSub: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    marginTop: 2,
  },
  skip: {
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  skipPressed: {
    opacity: 0.6,
  },
  skipLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    letterSpacing: 0.4,
  },
  /* ---- Confirmation card ---- */
  confirmStage: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    minHeight: 320,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 32,
  },
  confirmCard: {
    width: "100%",
    backgroundColor: "rgba(0,255,204,0.08)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.35)",
    borderRadius: 18,
    paddingHorizontal: 22,
    paddingVertical: 26,
    alignItems: "center",
  },
  confirmKicker: {
    fontFamily: fontFamily.bodyBold,
    color: lumina.firefly,
    fontSize: 12,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  confirmTitle: {
    fontFamily: fontFamily.bodyBold,
    color: "#FFFFFF",
    fontSize: 20,
    lineHeight: 26,
    textAlign: "center",
    marginBottom: 16,
  },
  confirmChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
  },
  confirmChip: {
    backgroundColor: "rgba(0,255,204,0.18)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.45)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  confirmChipText: {
    fontFamily: fontFamily.bodyBold,
    color: "#FFFFFF",
    fontSize: 13,
  },
  confirmDot: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.5)",
    fontSize: 14,
  },
});

// Background uses cosmic.voidTop in MvpOnboarding's root container —
// referencing it here keeps the import live for the linter and makes
// the styling intent explicit to anyone reading just this file.
void cosmic.voidTop;
