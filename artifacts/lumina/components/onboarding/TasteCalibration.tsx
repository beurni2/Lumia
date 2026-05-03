/**
 * Taste Calibration — the lightweight Quick Tune that surfaces
 * AFTER the Style Profile reveal OR after the user has viewed 2-3
 * ideas on Home. Tap-only, ~10 seconds end to end, no typing.
 *
 * Three steps with auto-advance behaviour (PHASE Z3 — format and
 * hook now allow up to 3 selections; tone remains single-select):
 *   step 0 → format     (multi, ≤3, Continue button OR auto-adv on 3rd)
 *   step 1 → tone       (single, auto-advance on tap)
 *   step 2 → hook style (multi, ≤3, Continue button OR auto-adv on 3rd)
 *   step 3 → confirmation card with fade + scale, ~800 ms, then
 *            onComplete()
 *
 * Multi-select rules (PHASE Z3):
 *   • Persisted shape was always `preferredFormats: PreferredFormat[]`
 *     and `preferredHookStyles: PreferredHookStyle[]` — server zod
 *     schema is unchanged, we just stop constraining ourselves to a
 *     1-element array.
 *   • Tone stays single because the server stores `preferredTone:
 *     PreferredTone | null` (a single nullable enum); switching it
 *     to an array would force a server schema migration and updates
 *     to every consumer (e.g. TONE_GUIDANCE[cal.preferredTone]).
 *     The "additive only, ZERO migrations" discipline keeps tone
 *     single-select on this surface.
 *   • Multi steps render a "Continue →" pill when ≥1 selected.
 *     Tapping the 3rd selection auto-advances (max reached) so the
 *     "no Next button if I already know" UX still feels tight for
 *     decisive users.
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

/**
 * PHASE Y14 — `mode` distinguishes the first-time onboarding flow
 * ("initial", default — preserves the prior copy verbatim) from the
 * 30-day-stale refresh re-surface ("refresh" — branded copy that
 * tells the returning creator WHY they're seeing the modal again so
 * the prompt doesn't read as a duplicate of their first session).
 *
 * Default is "initial" so every existing call site (MvpOnboarding,
 * the dev-tool reset path) keeps the prior copy without an opt-in.
 * The /calibration route opt-IN derives mode from the server doc
 * (completedAt set + not skipped → refresh), so the user's entry
 * path determines the framing without the route having to know
 * which gate fired.
 */
export type TasteCalibrationMode = "initial" | "refresh";

type Props = {
  onComplete: () => void;
  mode?: TasteCalibrationMode;
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

// PHASE Z3 — multi-select cap. We allow the user to tap up to 3
// options on the format and hook steps. The 3rd tap auto-advances
// (matches the original "no Next button if I'm decisive" feel);
// 1 or 2 selections require a Continue tap. Persisted shape is
// already an array so this is a UI-only widening.
const MULTI_SELECT_MAX = 3;

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

export function TasteCalibration({ onComplete, mode = "initial" }: Props) {
  const isRefresh = mode === "refresh";
  // step 0 = format, 1 = tone, 2 = hook, 3 = confirmation
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  // PHASE Z3 — format and hookStyles are arrays (≤3). Tone stays a
  // single nullable enum because the server schema persists it as
  // a scalar; see the file-header comment.
  const [formats, setFormats] = useState<PreferredFormat[]>([]);
  const [tone, setTone] = useState<PreferredTone | null>(null);
  const [hookStyles, setHookStyles] = useState<PreferredHookStyle[]>([]);

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
    (
      chosenFormats: PreferredFormat[],
      chosenTone: PreferredTone,
      chosenHooks: PreferredHookStyle[],
    ) => {
      const doc: TasteCalibrationDoc = {
        ...EMPTY_CALIBRATION,
        // PHASE Z3 — both arrays may carry 1..3 entries. Server zod
        // schema (`z.array(...).default([])`) accepts this without
        // any change; downstream consumers already iterate.
        preferredFormats: chosenFormats,
        preferredTone: chosenTone,
        preferredHookStyles: chosenHooks,
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

  // PHASE Z3 — multi-select toggle for the format step. Tapping a
  // selected item removes it; tapping a new one appends, capped at
  // MULTI_SELECT_MAX. Auto-advance fires the moment the user
  // reaches the cap so decisive users keep the original "tap and
  // go" rhythm.
  const handleFormatToggle = useCallback(
    (v: PreferredFormat) => {
      if (busy) return;
      lightHaptic();
      setFormats((prev) => {
        const already = prev.includes(v);
        if (already) {
          return prev.filter((x) => x !== v);
        }
        if (prev.length >= MULTI_SELECT_MAX) {
          // At cap — ignore the new tap (the option also renders
          // visually disabled below, this is defense in depth).
          return prev;
        }
        const next = [...prev, v];
        if (next.length === MULTI_SELECT_MAX) {
          // Auto-advance on the cap-reaching tap.
          setStep(1);
        }
        return next;
      });
    },
    [busy],
  );

  // Continue button on the format step — fires when the user is
  // happy with 1 or 2 selections (3 auto-advances above).
  const handleFormatContinue = useCallback(() => {
    if (busy || formats.length === 0) return;
    lightHaptic();
    setStep(1);
  }, [busy, formats.length]);

  const handleTonePick = useCallback(
    (v: PreferredTone) => {
      if (busy) return;
      lightHaptic();
      setTone(v);
      setStep(2);
    },
    [busy],
  );

  // PHASE Z3 — multi-select toggle for the hook step. Mirrors the
  // format handler: append/remove with a cap of 3. The cap-reaching
  // tap fires the save side effects directly (same one-shot guard
  // as the prior single-tap path) and transitions to confirmation.
  const handleHookToggle = useCallback(
    (v: PreferredHookStyle) => {
      if (busy) return;
      // Defensive: format and tone should always be set by the
      // time we land on step 2; bail without persisting half-state.
      if (formats.length === 0 || tone === null) return;
      lightHaptic();
      setHookStyles((prev) => {
        const already = prev.includes(v);
        if (already) {
          return prev.filter((x) => x !== v);
        }
        if (prev.length >= MULTI_SELECT_MAX) return prev;
        const next = [...prev, v];
        if (next.length === MULTI_SELECT_MAX) {
          // Cap reached — fire the terminal save side effects on
          // this same synchronous tick, guarded by the one-shot
          // ref so a duplicate event can't double-fire.
          if (!saveFiredRef.current) {
            saveFiredRef.current = true;
            setBusy(true);
            fireSaveSideEffects(formats, tone, next);
            setStep(3);
          }
        }
        return next;
      });
    },
    [busy, formats, tone, fireSaveSideEffects],
  );

  // Continue button on the hook step — fires the terminal save
  // side effects when the user is happy with 1 or 2 selections.
  // Uses the same one-shot guard as the cap-reaching auto-advance
  // path so the two terminal entry points can't both fire.
  const handleHookContinue = useCallback(() => {
    if (busy) return;
    if (saveFiredRef.current) return;
    if (formats.length === 0 || tone === null || hookStyles.length === 0) return;
    saveFiredRef.current = true;
    setBusy(true);
    lightHaptic();
    fireSaveSideEffects(formats, tone, hookStyles);
    setStep(3);
  }, [busy, formats, tone, hookStyles, fireSaveSideEffects]);

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
  // PHASE Y14 — refresh-mode rebrands the kicker so a returning
  // creator immediately reads this as "we're checking in" not
  // "you missed onboarding". Step labels stay 1-of-3 so the
  // progress affordance is identical.
  const kickerPrefix = isRefresh ? "Quick refresh" : "Quick tune";
  const stepKicker = useMemo(() => {
    if (step === 0) return `${kickerPrefix} · 1 of 3`;
    if (step === 1) return `${kickerPrefix} · 2 of 3`;
    if (step === 2) return `${kickerPrefix} · 3 of 3`;
    return null;
  }, [step, kickerPrefix]);

  // PHASE Y14 — refresh-mode question copy. The first step doubles
  // as the "why are you seeing this again" surface (the only step
  // whose hero text differs from the initial flow). Steps 1 and 2
  // keep the initial-flow copy because the question text is
  // identical regardless of whether this is a first sit-down or a
  // 30-day check-in — only the framing on step 0 needs to change.
  const step0Title = isRefresh
    ? "Your taste profile is 30+ days old — let's refresh it"
    : "What format feels most like you?";
  // PHASE Z3 — step0 sub-copy is rendered inline below (it's a
  // multi-select prompt now, so the wording is unified across the
  // initial / refresh paths in the JSX itself).

  if (step === 3 && formats.length > 0 && tone && hookStyles.length > 0) {
    return (
      <ConfirmationCard
        // PHASE Z3 — chip arrays may carry 1..3 entries each; the
        // confirmation card flexWrap-renders them in the order the
        // user picked them.
        formatLabels={formats.map((f) => FORMAT_SUMMARY[f])}
        toneLabel={TONE_SUMMARY[tone]}
        hookLabels={hookStyles.map((h) => HOOK_SUMMARY[h])}
        // PHASE Y14 — confirmation kicker mirrors the entry framing:
        // a refresh closes with "Refreshed" so the creator knows the
        // re-pin landed; initial flow keeps the original "Got it".
        kickerLabel={isRefresh ? "Refreshed" : "Got it"}
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
          <Text style={styles.heroTitle}>{step0Title}</Text>
          {/* PHASE Z3 — sub-copy reflects the new multi-select cap so
              the user knows up front they can pick more than one. */}
          <Text style={styles.heroSub}>
            {isRefresh
              ? "Tap up to 3 — same as before, your favorites."
              : "Tap up to 3 — pick whatever feels true."}
          </Text>
          <MultiSelect
            choices={FORMAT_CHOICES}
            values={formats}
            onToggle={handleFormatToggle}
            disabled={busy}
            max={MULTI_SELECT_MAX}
          />
          <ContinueButton
            visible={formats.length > 0 && formats.length < MULTI_SELECT_MAX}
            onPress={handleFormatContinue}
            disabled={busy}
            // Tiny counter so the user knows they can pick more.
            label={`Continue (${formats.length}/${MULTI_SELECT_MAX}) →`}
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
          <Text style={styles.heroSub}>Tap up to 3 — your go-to openers.</Text>
          <MultiSelect
            choices={HOOK_CHOICES}
            values={hookStyles}
            onToggle={handleHookToggle}
            disabled={busy}
            max={MULTI_SELECT_MAX}
          />
          <ContinueButton
            visible={hookStyles.length > 0 && hookStyles.length < MULTI_SELECT_MAX}
            onPress={handleHookContinue}
            disabled={busy}
            label={`Continue (${hookStyles.length}/${MULTI_SELECT_MAX}) →`}
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
  formatLabels,
  toneLabel,
  hookLabels,
  kickerLabel,
}: {
  formatLabels: string[];
  toneLabel: string;
  hookLabels: string[];
  kickerLabel: string;
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
        <Text style={styles.confirmKicker}>{kickerLabel}</Text>
        <Text style={styles.confirmTitle}>
          Making your ideas more:
        </Text>
        {/* PHASE Z3 — chips render in flexWrap as a single cluster
            (format chips, then tone, then hook) so 1..3 entries per
            category land cleanly on small screens without per-group
            dot separators that get awkward when one group has 3. */}
        <View style={styles.confirmChips}>
          {formatLabels.map((label) => (
            <View key={`f-${label}`} style={styles.confirmChip}>
              <Text style={styles.confirmChipText}>{label}</Text>
            </View>
          ))}
          <View key={`t-${toneLabel}`} style={styles.confirmChip}>
            <Text style={styles.confirmChipText}>{toneLabel}</Text>
          </View>
          {hookLabels.map((label) => (
            <View key={`h-${label}`} style={styles.confirmChip}>
              <Text style={styles.confirmChipText}>{label}</Text>
            </View>
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

/* =================== Sub-components =================== */

/**
 * MultiSelect — PHASE Z3.
 *
 * Tap to toggle, capped at `max`. Once the cap is reached, the
 * unselected options render in the disabled style (and `onToggle`
 * is also defended against the over-cap case in the caller). The
 * accessibility role is "checkbox" rather than "radio" so screen
 * readers announce the multi-select semantics.
 */
function MultiSelect<T extends string>({
  choices,
  values,
  onToggle,
  disabled,
  max,
}: {
  choices: Choice<T>[];
  values: T[];
  onToggle: (v: T) => void;
  disabled?: boolean;
  max: number;
}) {
  const atCap = values.length >= max;
  return (
    <View style={styles.choices}>
      {choices.map((c) => {
        const selected = values.includes(c.value);
        // Cap-locked: an unselected option is non-interactive once
        // the user has hit the cap, but a selected option always
        // remains tappable so it can be removed.
        const capLocked = atCap && !selected;
        const fullyDisabled = disabled || capLocked;
        return (
          <Pressable
            key={c.value}
            onPress={() => onToggle(c.value)}
            disabled={fullyDisabled}
            style={({ pressed }) => [
              styles.choice,
              selected ? styles.choiceSelected : null,
              pressed && !fullyDisabled && !selected ? styles.choicePressed : null,
              fullyDisabled ? styles.choiceDisabled : null,
            ]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected, disabled: fullyDisabled }}
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

/**
 * ContinueButton — PHASE Z3.
 *
 * Small filled-teal pill that appears below a multi-select once
 * the user has at least one selection but hasn't reached the cap
 * (the cap-reaching tap auto-advances, so Continue would be
 * redundant in that state). Hidden via `visible` rather than
 * unmounted so the layout doesn't jump as the user toggles.
 */
function ContinueButton({
  visible,
  onPress,
  disabled,
  label,
}: {
  visible: boolean;
  onPress: () => void;
  disabled?: boolean;
  label: string;
}) {
  if (!visible) {
    // Reserve no space when hidden — the layout below (Skip link)
    // sits naturally against the choices when there's nothing to
    // continue from yet.
    return null;
  }
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.continueBtn,
        pressed && !disabled ? styles.continueBtnPressed : null,
        disabled ? styles.continueBtnDisabled : null,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={styles.continueBtnLabel}>{label}</Text>
    </Pressable>
  );
}

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
  /* ---- Continue button (PHASE Z3 multi-select advance) ---- */
  continueBtn: {
    backgroundColor: lumina.firefly,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    marginBottom: 6,
    alignSelf: "stretch",
  },
  continueBtnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  continueBtnDisabled: {
    opacity: 0.45,
  },
  continueBtnLabel: {
    fontFamily: fontFamily.bodyBold,
    color: "#0A0824",
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
