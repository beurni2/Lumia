/**
 * Taste Calibration — the optional 5-question onboarding step that
 * surfaces AFTER the Style Profile reveal. Tap-only, ~10 seconds end
 * to end, no typing. The user can skip the whole thing at any time;
 * answers are persisted to `creators.taste_calibration_json` and
 * become INITIAL bias for the ideator's per-creator format
 * distribution + the prompt's tone / effort / privacy / hook-style
 * fragments.
 *
 * Three of the five questions are SINGLE-select (format, tone,
 * effort) because the spec says one strong preference is what shifts
 * the distribution; two are MULTI-select (privacy avoidances, hook
 * styles) because creators legitimately want to ban multiple
 * categories at once. The "no privacy limits" option is an exclusive
 * toggle within the privacy question — picking it clears the others
 * (and vice versa) so the persisted document is internally
 * consistent.
 *
 * The submit + skip buttons share the same disabled state during
 * network round-trips so a fast double-tap can't fire two POSTs.
 * Either branch (submit OR skip) calls `onComplete()` on success;
 * the parent (MvpOnboarding) owns the navigation transition into
 * the home tabs so the flow stays linear.
 */

import * as Haptics from "expo-haptics";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { ApiError } from "@workspace/api-client-react";

import { cosmic, lumina } from "@/constants/colors";
import { fontFamily, type } from "@/constants/typography";
import {
  EMPTY_CALIBRATION,
  saveTasteCalibration,
  skipTasteCalibration,
  suppressCalibrationGate,
  type EffortPreference,
  type PreferredFormat,
  type PreferredHookStyle,
  type PreferredTone,
  type PrivacyAvoidance,
  type TasteCalibration,
} from "@/lib/tasteCalibration";

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

const EFFORT_CHOICES: Choice<EffortPreference>[] = [
  { value: "zero_effort", label: "Zero effort", sub: "1 take, 1 location" },
  { value: "low_effort", label: "Low effort", sub: "1–2 quick clips" },
  { value: "structured", label: "A bit of structure", sub: "Mini-story or contrast setup" },
];

const PRIVACY_CHOICES: Choice<PrivacyAvoidance>[] = [
  { value: "avoid_messages", label: "No real messages or DM screenshots" },
  { value: "avoid_finance", label: "No bank apps, balances or salary numbers" },
  { value: "avoid_people", label: "Nothing that needs another person on camera" },
  { value: "avoid_private_info", label: "Nothing personal (address, ID, medical)" },
  { value: "no_privacy_limits", label: "I'm fine with all of the above" },
];

const HOOK_CHOICES: Choice<PreferredHookStyle>[] = [
  { value: "behavior_hook", label: '"The way I…"', sub: "Behavior hooks" },
  { value: "thought_hook", label: '"Why do I…"', sub: "Thought hooks" },
  { value: "curiosity_hook", label: '"This is where it went wrong…"', sub: "Curiosity hooks" },
  { value: "contrast_hook", label: '"What I say vs what I do"', sub: "Contrast hooks" },
];

function lightHaptic() {
  if (Platform.OS !== "web") {
    Haptics.selectionAsync().catch(() => {});
  }
}

export function TasteCalibration({ onComplete }: Props) {
  // Format + tone + effort are single-select (one option moves the
  // distribution / tone bias). Hook styles and privacy are
  // multi-select.
  const [format, setFormat] = useState<PreferredFormat | null>(null);
  const [tone, setTone] = useState<PreferredTone | null>(null);
  const [effort, setEffort] = useState<EffortPreference | null>(null);
  const [privacy, setPrivacy] = useState<PrivacyAvoidance[]>([]);
  const [hookStyles, setHookStyles] = useState<PreferredHookStyle[]>([]);

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const togglePrivacy = useCallback((value: PrivacyAvoidance) => {
    lightHaptic();
    setPrivacy((prev) => {
      // "no_privacy_limits" is exclusive — picking it clears the
      // others, picking any other clears it. Keeps the persisted
      // doc internally consistent so the server-side prompt block
      // never has to reason about the contradictory state.
      if (value === "no_privacy_limits") {
        return prev.includes("no_privacy_limits") ? [] : ["no_privacy_limits"];
      }
      const without = prev.filter(
        (p) => p !== value && p !== "no_privacy_limits",
      );
      return prev.includes(value) ? without : [...without, value];
    });
  }, []);

  const toggleHookStyle = useCallback((value: PreferredHookStyle) => {
    lightHaptic();
    setHookStyles((prev) =>
      prev.includes(value)
        ? prev.filter((p) => p !== value)
        : [...prev, value],
    );
  }, []);

  const hasAnyAnswer = useMemo(
    () =>
      format !== null ||
      tone !== null ||
      effort !== null ||
      privacy.length > 0 ||
      hookStyles.length > 0,
    [format, tone, effort, privacy, hookStyles],
  );

  // Fire-and-forget: navigation NEVER blocks on the network. Both
  // Save and Skip flip UI/route immediately and dispatch the POST in
  // a detached task. Matches the idea-feedback pattern so a flaky
  // connection cannot strand the user mid-onboarding (severe
  // architect finding from the Phase 1 review). On the rare network
  // failure the row gets re-prompted on a future cold start, which
  // is the acceptable failure mode for an optional step.
  const handleSave = useCallback(() => {
    if (busy) return;
    setBusy(true);
    setErrorMsg(null);
    const doc: TasteCalibration = {
      ...EMPTY_CALIBRATION,
      preferredFormats: format ? [format] : [],
      preferredTone: tone,
      effortPreference: effort,
      privacyAvoidances: privacy,
      preferredHookStyles: hookStyles,
      skipped: false,
    };
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => {},
      );
    }
    // Suppress the Home gate BEFORE the fire-and-forget POST settles.
    // Otherwise on slow networks the user lands on Home, the focus
    // gate fetches before our POST has been written, sees the old
    // (or null) doc, and re-pushes /calibration in a tight loop.
    suppressCalibrationGate();
    // Detached — never await. swallow error so a transient network
    // hiccup never bubbles up as an unhandled rejection.
    void saveTasteCalibration(doc).catch(() => {});
    onComplete();
  }, [busy, format, tone, effort, privacy, hookStyles, onComplete]);

  const handleSkip = useCallback(() => {
    if (busy) return;
    setBusy(true);
    setErrorMsg(null);
    // Same race-prevention as handleSave — suppress the gate window
    // synchronously so the immediate Home re-focus can't out-race
    // the skip POST.
    suppressCalibrationGate();
    // Detached — same reasoning as handleSave above.
    void skipTasteCalibration().catch(() => {});
    onComplete();
  }, [busy, onComplete]);

  return (
    <Animated.View entering={FadeIn.duration(280)} style={styles.stage}>
      <Text style={styles.stepKicker}>Optional · ~10 seconds</Text>
      <Text style={styles.heroTitle}>Tune your ideas.</Text>
      <Text style={styles.heroSub}>
        Tap whatever fits — or skip. Your reactions to ideas teach Lumina far
        more than this ever will.
      </Text>

      <Question label="Which format feels most like you?">
        <SingleSelect
          choices={FORMAT_CHOICES}
          value={format}
          onChange={(v) => {
            lightHaptic();
            setFormat(v);
          }}
          disabled={busy}
        />
      </Question>

      <Question label="What tone do you naturally land on?">
        <SingleSelect
          choices={TONE_CHOICES}
          value={tone}
          onChange={(v) => {
            lightHaptic();
            setTone(v);
          }}
          disabled={busy}
        />
      </Question>

      <Question label="How much effort do you want each idea to take?">
        <SingleSelect
          choices={EFFORT_CHOICES}
          value={effort}
          onChange={(v) => {
            lightHaptic();
            setEffort(v);
          }}
          disabled={busy}
        />
      </Question>

      <Question label="Anything you'd rather not show on camera? (Pick any)">
        <MultiSelect
          choices={PRIVACY_CHOICES}
          values={privacy}
          onToggle={togglePrivacy}
          disabled={busy}
        />
      </Question>

      <Question label="Which hook openers feel most like you? (Pick any)">
        <MultiSelect
          choices={HOOK_CHOICES}
          values={hookStyles}
          onToggle={toggleHookStyle}
          disabled={busy}
        />
      </Question>

      <Pressable
        onPress={handleSave}
        disabled={busy || !hasAnyAnswer}
        style={({ pressed }) => [
          styles.primary,
          pressed && !busy && hasAnyAnswer ? styles.primaryPressed : null,
          busy || !hasAnyAnswer ? styles.primaryDisabled : null,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Save my preferences"
      >
        {busy ? (
          <ActivityIndicator color="#0A0824" />
        ) : (
          <Text style={styles.primaryLabel}>
            {hasAnyAnswer ? "Save my preferences" : "Pick at least one to save"}
          </Text>
        )}
      </Pressable>

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

      {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}
    </Animated.View>
  );
}

/* =================== Sub-components =================== */

function Question({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.question}>
      <Text style={styles.questionLabel}>{label}</Text>
      {children}
    </View>
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

function MultiSelect<T extends string>({
  choices,
  values,
  onToggle,
  disabled,
}: {
  choices: Choice<T>[];
  values: T[];
  onToggle: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.choices}>
      {choices.map((c) => {
        const selected = values.includes(c.value);
        return (
          <Pressable
            key={c.value}
            onPress={() => onToggle(c.value)}
            disabled={disabled}
            style={({ pressed }) => [
              styles.choice,
              selected ? styles.choiceSelected : null,
              pressed && !disabled && !selected ? styles.choicePressed : null,
              disabled ? styles.choiceDisabled : null,
            ]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected, disabled }}
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

function formatErr(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message ?? fallback;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
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
    marginBottom: 12,
  },
  heroSub: {
    ...type.body,
    color: "rgba(255,255,255,0.7)",
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 28,
  },
  question: {
    marginBottom: 24,
  },
  questionLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.85)",
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 10,
  },
  choices: {
    gap: 8,
  },
  choice: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
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
  primary: {
    backgroundColor: lumina.firefly,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  primaryPressed: {
    opacity: 0.85,
  },
  primaryDisabled: {
    opacity: 0.45,
  },
  primaryLabel: {
    fontFamily: fontFamily.bodyBold,
    color: "#0A0824",
    fontSize: 16,
    letterSpacing: 0.5,
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
  error: {
    fontFamily: fontFamily.bodyMedium,
    color: "#FF8FA1",
    fontSize: 14,
    marginTop: 14,
    textAlign: "center",
  },
});

// Background uses cosmic.voidTop in MvpOnboarding's root container —
// referencing it here keeps the import live for the linter and makes
// the styling intent explicit to anyone reading just this file.
void cosmic.voidTop;
