/**
 * Taste Calibration — the lightweight Quick Tune that surfaces
 * AFTER the Style Profile reveal OR after the user has viewed 2-3
 * ideas on Home. Tap-only, ~15 seconds end to end, no typing.
 *
 * PHASE Z5.8 — closed-beta layout: FOUR screens (3 required + 1
 * optional). The third "situations" screen is new; tone gains a
 * high_energy_rant fifth option, opener gains a pov_hook fifth.
 *
 *   step 0 → format     (required, multi ≤3, Continue blocked at 0)
 *   step 1 → tone       (required, multi ≤3, Continue blocked at 0)
 *   step 2 → situations (required, multi ≤4, Continue blocked at 0)
 *   step 3 → opener     (OPTIONAL, multi ≤3, "Skip for now" link)
 *   step 4 → confirmation card (~800 ms fade + scale)
 *
 * Multi-select rules:
 *   • Persisted shape stays additive — `selectedSituations` is the
 *     only new field (server zod default = []) so older docs still
 *     parse and the route response shape is unchanged.
 *   • Required screens (0, 1, 2) DO NOT render the "Skip for now"
 *     link — only the opener (step 3) keeps it. This is the
 *     closed-beta "minimum viable taste signal" guarantee.
 *   • Continue is the ONLY exit on required screens; the button is
 *     not rendered until the user has at least one selection
 *     (matches the prior implicit "Continue blocked at 0" rule).
 *   • Cap-reaching tap auto-advances on every multi step (3 for
 *     format/tone/opener; 4 for situations).
 *
 * Save side effects fire SYNCHRONOUSLY when the OPTIONAL opener
 * step terminates (either via cap-reaching tap, Continue, or Skip)
 * so the fire-and-forget POST is in flight while the confirmation
 * animation plays. Skip writes the SAME doc the user built across
 * the three required screens — it just leaves preferredHookStyles
 * empty (Skip means "no opener pin", not "discard everything").
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
  suppressCalibrationGate,
  type PreferredFormat,
  type PreferredHookStyle,
  type PreferredTone,
  type Situation,
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
  // PHASE Z5.8 — fifth tone. Loud + ranty energy.
  { value: "high_energy_rant", label: "High-energy rant", sub: "ok BUT WHY does this happen every single time 🔥" },
];

const HOOK_CHOICES: Choice<PreferredHookStyle>[] = [
  { value: "behavior_hook", label: '"The way I…"', sub: "Behavior hooks" },
  { value: "thought_hook", label: '"Why do I…"', sub: "Thought hooks" },
  { value: "curiosity_hook", label: '"This is where it went wrong…"', sub: "Curiosity hooks" },
  { value: "contrast_hook", label: '"What I say vs what I do"', sub: "Contrast hooks" },
  // PHASE Z5.8 — fifth opener. POV / second-person scene.
  { value: "pov_hook", label: '"POV: you\'re…"', sub: "POV hooks" },
];

// PHASE Z5.8 — six situation / topic-lane buckets. The label is
// the chip the creator taps; the sub-line gives a concrete example
// of the kind of moment that lane covers, in the same "show what
// it feels like" register the other Quick Tune steps use.
const SITUATION_CHOICES: Choice<Situation>[] = [
  { value: "food_home", label: "Food & home", sub: "kitchen, fridge, eating, chores, cleaning" },
  { value: "dating_texting", label: "Dating & texting", sub: "talking stage, texts, situationships, exes" },
  { value: "work_school", label: "Work & school", sub: "deadlines, meetings, classes, assignments" },
  { value: "social_awkwardness", label: "Social awkwardness", sub: "small talk, parties, eye contact, group chats" },
  { value: "health_wellness", label: "Health & wellness", sub: "sleep, gym, mental load, the doctor said…" },
  { value: "creator_social", label: "Creator / online life", sub: "filming, posting, comments, the algorithm" },
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
  // PHASE Z5.8 — chip copy for the new tone option.
  high_energy_rant: "High-energy rant",
};
const HOOK_SUMMARY: Record<PreferredHookStyle, string> = {
  behavior_hook: "“the way I…”",
  thought_hook: "“why do I…”",
  curiosity_hook: "“where it went wrong…”",
  contrast_hook: "“say vs do”",
  // PHASE Z5.8 — chip copy for the new opener option.
  pov_hook: "“POV: you’re…”",
};
// PHASE Z5.8 — situation chip copy. Short, punchy versions of the
// MultiSelect labels — the confirmation card flexWraps these with
// the format / tone / opener chips so the user reads back a single
// summary cluster.
const SITUATION_SUMMARY: Record<Situation, string> = {
  food_home: "Food & home",
  dating_texting: "Dating & texting",
  work_school: "Work & school",
  social_awkwardness: "Social awkwardness",
  health_wellness: "Health & wellness",
  creator_social: "Creator / online life",
};

// PHASE Z3 — multi-select cap. We allow the user to tap up to 3
// options on the format / tone / opener steps. The 3rd tap auto-
// advances (matches the original "no Next button if I'm decisive"
// feel); 1 or 2 selections require a Continue tap.
const MULTI_SELECT_MAX = 3;
// PHASE Z5.8 — situations get a wider cap (4) because topic lanes
// are intentionally broader than format / tone — a creator who
// makes both food AND dating content is a normal case, and the
// downstream consumer (when wired) will need that breadth.
const SITUATIONS_MAX = 4;

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
  // PHASE Z5.8 — 5 step indices: 0=format, 1=tone, 2=situations,
  // 3=opener (optional), 4=confirmation.
  const [step, setStep] = useState<0 | 1 | 2 | 3 | 4>(0);
  // PHASE Z3/Z4/Z5.8 — four multi-step axes (formats / tones /
  // situations are required ≥1; hookStyles is optional ≥0). Z4
  // widened tone from a single nullable enum to an array; the
  // server keeps the scalar `preferredTone` field in sync as
  // `tones[0] ?? null` so every existing server consumer that reads
  // the scalar (coreCandidateGenerator, hybridIdeator, ideaScorer,
  // patternIdeator, getToneGuidance) stays unchanged.
  const [formats, setFormats] = useState<PreferredFormat[]>([]);
  const [tones, setTones] = useState<PreferredTone[]>([]);
  const [situations, setSituations] = useState<Situation[]>([]);
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
  //
  // PHASE Z5.8 — fired exactly once when the OPTIONAL opener step
  // terminates (cap-reaching tap, Continue, or "Skip for now"). The
  // three required arrays are always populated; `chosenHooks` may
  // be empty (Skip path). The doc is never written with `skipped:
  // true` from this component anymore — required taste signal has
  // already been collected, so a "skip the opener pin" decision
  // becomes a normal completed save with `preferredHookStyles: []`.
  const fireSaveSideEffects = useCallback(
    (
      chosenFormats: PreferredFormat[],
      chosenTones: PreferredTone[],
      chosenSituations: Situation[],
      chosenHooks: PreferredHookStyle[],
    ) => {
      const doc: TasteCalibrationDoc = {
        ...EMPTY_CALIBRATION,
        // PHASE Z3/Z4 — all three arrays may carry 1..3 entries.
        // For tone we ALSO send the back-compat scalar so a
        // pre-Z4 server (or one that hasn't redeployed yet)
        // still sees a populated `preferredTone`. The Z4 server
        // re-derives the scalar from `preferredTones[0]` on save
        // so both sides agree regardless of which one ships first.
        preferredFormats: chosenFormats,
        preferredTone: chosenTones.length > 0 ? chosenTones[0] : null,
        preferredTones: chosenTones,
        preferredHookStyles: chosenHooks,
        // PHASE Z5.8 — required topic lanes (1..4 entries by the
        // time we get here; 0 is impossible because step 2's
        // Continue is gated on length>=1 and there is no Skip).
        selectedSituations: chosenSituations,
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

  // PHASE Z4 — multi-select toggle for the tone step. Same
  // mechanics as the format/hook handlers: append/remove with a
  // cap of MULTI_SELECT_MAX. Cap-reaching tap auto-advances; 1-2
  // selections require the Continue tap below.
  const handleToneToggle = useCallback(
    (v: PreferredTone) => {
      if (busy) return;
      lightHaptic();
      setTones((prev) => {
        const already = prev.includes(v);
        if (already) {
          return prev.filter((x) => x !== v);
        }
        if (prev.length >= MULTI_SELECT_MAX) return prev;
        const next = [...prev, v];
        if (next.length === MULTI_SELECT_MAX) {
          // Auto-advance on the cap-reaching tap.
          setStep(2);
        }
        return next;
      });
    },
    [busy],
  );

  // Continue button on the tone step — fires when the user is
  // happy with 1 or 2 selections (3 auto-advances above).
  const handleToneContinue = useCallback(() => {
    if (busy || tones.length === 0) return;
    lightHaptic();
    setStep(2);
  }, [busy, tones.length]);

  // PHASE Z5.8 — multi-select toggle for the new situations step.
  // Same mechanics as the other multi handlers but with cap=4
  // (SITUATIONS_MAX). Cap-reaching tap auto-advances; 1..3
  // selections require the Continue tap below. NO Skip on this
  // step — it is required.
  const handleSituationToggle = useCallback(
    (v: Situation) => {
      if (busy) return;
      lightHaptic();
      setSituations((prev) => {
        const already = prev.includes(v);
        if (already) {
          return prev.filter((x) => x !== v);
        }
        if (prev.length >= SITUATIONS_MAX) return prev;
        const next = [...prev, v];
        if (next.length === SITUATIONS_MAX) {
          // Auto-advance on the cap-reaching tap.
          setStep(3);
        }
        return next;
      });
    },
    [busy],
  );

  const handleSituationContinue = useCallback(() => {
    if (busy || situations.length === 0) return;
    lightHaptic();
    setStep(3);
  }, [busy, situations.length]);

  // PHASE Z3 — multi-select toggle for the opener (hook) step.
  // PHASE Z5.8 — moved to step 3, optional. Mirrors the format
  // handler: append/remove with a cap of 3. The cap-reaching tap
  // fires the terminal save side effects directly (one-shot
  // guarded) and transitions to the confirmation step.
  const handleHookToggle = useCallback(
    (v: PreferredHookStyle) => {
      if (busy) return;
      // Defensive: required arrays must be populated before we
      // land here. If they aren't, bail without persisting a
      // partial doc — the user can navigate back through the flow.
      if (
        formats.length === 0 ||
        tones.length === 0 ||
        situations.length === 0
      )
        return;
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
            fireSaveSideEffects(formats, tones, situations, next);
            setStep(4);
          }
        }
        return next;
      });
    },
    [busy, formats, tones, situations, fireSaveSideEffects],
  );

  // Continue button on the opener step — fires the terminal save
  // side effects when the user is happy with 1 or 2 selections.
  // Uses the same one-shot guard as the cap-reaching auto-advance
  // path so the two terminal entry points can't both fire.
  const handleHookContinue = useCallback(() => {
    if (busy) return;
    if (saveFiredRef.current) return;
    if (
      formats.length === 0 ||
      tones.length === 0 ||
      situations.length === 0 ||
      hookStyles.length === 0
    )
      return;
    saveFiredRef.current = true;
    setBusy(true);
    lightHaptic();
    fireSaveSideEffects(formats, tones, situations, hookStyles);
    setStep(4);
  }, [busy, formats, tones, situations, hookStyles, fireSaveSideEffects]);

  // PHASE Z5.8 — Skip on the OPTIONAL opener step. Persists the
  // same doc the user built across the three required screens
  // (formats / tones / situations) with `preferredHookStyles: []`
  // and `skipped: false`. The user did NOT skip calibration — they
  // skipped the opener pin, which is a normal "I don't have a
  // preference" signal. Routes through the same one-shot guard +
  // confirmation flow as the Continue / cap-reaching paths so the
  // user gets the same celebratory beat regardless of how they
  // exit the opener step.
  const handleSkip = useCallback(() => {
    if (busy) return;
    if (saveFiredRef.current) return;
    if (
      formats.length === 0 ||
      tones.length === 0 ||
      situations.length === 0
    )
      return;
    saveFiredRef.current = true;
    setBusy(true);
    lightHaptic();
    fireSaveSideEffects(formats, tones, situations, []);
    setStep(4);
  }, [busy, formats, tones, situations, fireSaveSideEffects]);

  // Confirmation step lives below — when we land on step 4 we
  // schedule the auto-dismiss timer ourselves so the parent's
  // onComplete() runs after the animation has had time to land.
  useEffect(() => {
    if (step !== 4) return;
    const t = setTimeout(onComplete, CONFIRMATION_TOTAL_MS);
    return () => clearTimeout(t);
  }, [step, onComplete]);

  // Tiny step kicker — keeps the user oriented without adding a
  // progress bar (which the spec doesn't ask for). Hidden on the
  // confirmation step so the "Got it" beat reads cleanly.
  //
  // PHASE Y14 — refresh-mode rebrands the kicker so a returning
  // creator immediately reads this as "we're checking in" not
  // "you missed onboarding".
  // PHASE Z5.8 — kicker now spans 4 steps; the optional opener
  // step is suffixed " · optional" so a creator who scans the
  // kicker first knows Skip is available there (and only there).
  const kickerPrefix = isRefresh ? "Quick refresh" : "Quick tune";
  const stepKicker = useMemo(() => {
    if (step === 0) return `${kickerPrefix} · 1 of 4`;
    if (step === 1) return `${kickerPrefix} · 2 of 4`;
    if (step === 2) return `${kickerPrefix} · 3 of 4`;
    if (step === 3) return `${kickerPrefix} · 4 of 4 · optional`;
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

  // PHASE Z5.8 — confirmation lives at step 4. Required arrays
  // are guaranteed populated (the only way to reach step 4 is
  // through the opener step's terminal handlers, all of which
  // gate on length>=1 for formats / tones / situations). The
  // hookStyles array MAY be empty (Skip path) — the confirmation
  // card simply renders no opener chips in that case.
  if (
    step === 4 &&
    formats.length > 0 &&
    tones.length > 0 &&
    situations.length > 0
  ) {
    return (
      <ConfirmationCard
        formatLabels={formats.map((f) => FORMAT_SUMMARY[f])}
        toneLabels={tones.map((t) => TONE_SUMMARY[t])}
        situationLabels={situations.map((s) => SITUATION_SUMMARY[s])}
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
          {/* PHASE Z5.8 — required-step Continue is rendered as soon
              as ≥1 selection lands (the cap-reaching tap auto-
              advances independently). The button itself is the only
              exit; there is no Skip on this step. */}
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
          <Text style={styles.heroSub}>Tap up to 3 — your range, not just one note.</Text>
          <MultiSelect
            choices={TONE_CHOICES}
            values={tones}
            onToggle={handleToneToggle}
            disabled={busy}
            max={MULTI_SELECT_MAX}
          />
          <ContinueButton
            visible={tones.length > 0 && tones.length < MULTI_SELECT_MAX}
            onPress={handleToneContinue}
            disabled={busy}
            label={`Continue (${tones.length}/${MULTI_SELECT_MAX}) →`}
          />
        </>
      ) : null}

      {/* PHASE Z5.8 — NEW required step: situations / topic lanes.
          Cap is 4 (SITUATIONS_MAX) instead of 3. NO Skip — Continue
          is the only exit and is gated on length>=1. */}
      {step === 2 ? (
        <>
          <Text style={styles.heroTitle}>Which moments do you make about?</Text>
          <Text style={styles.heroSub}>
            Tap up to 4 — the scenes your ideas should live in.
          </Text>
          <MultiSelect
            choices={SITUATION_CHOICES}
            values={situations}
            onToggle={handleSituationToggle}
            disabled={busy}
            max={SITUATIONS_MAX}
          />
          <ContinueButton
            visible={
              situations.length > 0 && situations.length < SITUATIONS_MAX
            }
            onPress={handleSituationContinue}
            disabled={busy}
            label={`Continue (${situations.length}/${SITUATIONS_MAX}) →`}
          />
        </>
      ) : null}

      {/* PHASE Z5.8 — opener step moved from index 2 to 3 and is
          now the only OPTIONAL screen. Skip-for-now link below is
          gated on this step alone. */}
      {step === 3 ? (
        <>
          <Text style={styles.heroTitle}>Which opener feels most like you?</Text>
          <Text style={styles.heroSub}>
            Tap up to 3 — or skip if nothing fits.
          </Text>
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

      {/* PHASE Z5.8 — Skip link is rendered ONLY on the optional
          opener step (step 3). The three required screens (0, 1, 2)
          intentionally have no escape hatch — the closed-beta needs
          a minimum viable taste signal before the user lands back
          on Home. */}
      {step === 3 ? (
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
      ) : null}
    </Animated.View>
  );
}

/* =================== Confirmation card =================== */

function ConfirmationCard({
  formatLabels,
  toneLabels,
  // PHASE Z5.8 — situation chips render between tone and opener.
  // Always at least one entry by contract (required step gates).
  situationLabels,
  hookLabels,
  kickerLabel,
}: {
  formatLabels: string[];
  toneLabels: string[];
  situationLabels: string[];
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
        {/* PHASE Z3/Z5.8 — chips render in flexWrap as a single
            cluster (format → tone → situations → opener) so 1..3
            entries per category land cleanly on small screens
            without per-group dot separators that get awkward when
            one group has 3. The opener group renders nothing if
            the user took the Skip path. */}
        <View style={styles.confirmChips}>
          {formatLabels.map((label) => (
            <View key={`f-${label}`} style={styles.confirmChip}>
              <Text style={styles.confirmChipText}>{label}</Text>
            </View>
          ))}
          {toneLabels.map((label) => (
            <View key={`t-${label}`} style={styles.confirmChip}>
              <Text style={styles.confirmChipText}>{label}</Text>
            </View>
          ))}
          {situationLabels.map((label) => (
            <View key={`s-${label}`} style={styles.confirmChip}>
              <Text style={styles.confirmChipText}>{label}</Text>
            </View>
          ))}
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
    marginBottom: 12,
    fontSize: 28,
    lineHeight: 34,
  },
  heroSub: {
    ...type.body,
    color: "rgba(255,255,255,0.72)",
    fontSize: 16,
    lineHeight: 23,
    // PHASE UX3 — extra breathing room between sub-copy and the
    // first choice card so each Quick Tune step reads as a
    // single deliberate question rather than a dense form.
    marginBottom: 28,
  },
  choices: {
    // PHASE UX3 — taller gap + bigger cards = more "tap me"
    // affordance on each choice. Padding + font bumps below.
    gap: 12,
    marginBottom: 22,
  },
  choice: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 18,
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
    // PHASE UX3 — bumped one step for legibility on the larger
    // card. choiceSub stays small so the visual hierarchy holds.
    fontSize: 16,
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
    borderRadius: 14,
    // PHASE UX3 — bottom-anchored CTA feel: taller pill + extra
    // top margin so the button visually settles at the bottom
    // of the step rather than crowding the choice cards above
    // it. We don't truly absolute-position because MvpOnboarding
    // owns the outer ScrollView, but the visual rank now reads
    // as the dominant action on the step.
    paddingVertical: 16,
    paddingHorizontal: 22,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
    marginBottom: 8,
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
    // PHASE UX3 — match the larger pill from `continueBtn`.
    fontSize: 15,
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
