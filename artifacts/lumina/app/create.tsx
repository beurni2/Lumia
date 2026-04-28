/**
 * Create — the Phase 1 creation flow skeleton.
 *
 * Three stages, each rendered in turn from local state:
 *
 *   1. TIPS    — surface the idea's hook, opening shot, and
 *                "why it works" as filming guidance, plus the
 *                target length / filming time.
 *   2. IMPORT  — let the user pick the clip they actually filmed
 *                from the device gallery. The picked clip is
 *                kept in local state only — there is no server
 *                roundtrip for filmed clips in this PR (no
 *                export yet, so nothing downstream needs them
 *                persisted).
 *   3. PREVIEW — render a stylised "what your post would look
 *                like" surface using the clip's metadata + the
 *                idea's caption + script. No real composition,
 *                no rendering pipeline — that's the next PR.
 *
 * Out of scope (deliberate): export, share, save-to-camera-roll,
 * schedule, publish. The "Done" CTA returns the user to Home.
 *
 * The idea is delivered to this screen via `useLocalSearchParams`
 * as a JSON-encoded blob. There is no stable server-side id for
 * an ideator response, so encoding the whole object is the
 * lightest-weight handoff that survives re-mount, deep links,
 * and back-navigation without touching global state.
 */

import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CosmicBackdrop } from "@/components/foundation/CosmicBackdrop";
import { type IdeaCardData } from "@/components/IdeaCard";
import { lumina } from "@/constants/colors";
import { fontFamily, type } from "@/constants/typography";
import { deriveWhyThisWorksLines } from "@/lib/whyThisWorks";

type Stage = "tips" | "import" | "preview";

type FilmedClip = {
  filename: string;
  durationSec?: number;
  uri?: string;
};

export default function CreateScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Decode the idea once. If the param is missing or malformed we
  // fall back to null and render a friendly recovery screen rather
  // than crashing — the user can always go back and pick again.
  const params = useLocalSearchParams<{ idea?: string }>();
  const idea = useMemo<IdeaCardData | null>(() => {
    if (!params.idea) return null;
    try {
      return JSON.parse(params.idea) as IdeaCardData;
    } catch {
      return null;
    }
  }, [params.idea]);

  const [stage, setStage] = useState<Stage>("tips");
  const [clips, setClips] = useState<FilmedClip[]>([]);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // "Fast entry" intent: which capture path the user committed to
  // on the Tips screen. The Import stage consumes this exactly
  // once on mount to auto-open the matching native modal so the
  // user feels the choice they just tapped — without us having
  // to fork the Add Clips UI per intent. null after consumption
  // (or when entering Import via any other path).
  type AutoAction = "camera" | "picker";
  const [pendingAutoAction, setPendingAutoAction] =
    useState<AutoAction | null>(null);

  /* ---------- Stage transitions ------------------------------- */

  // "I'm ready to film" → land on the unified Add Clips screen
  // and immediately open the device camera for Slot 1. The user
  // never sees an empty Add Clips screen on this path; the auto-
  // open closes the perceived gap between intent and action.
  const goImport = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setPendingAutoAction("camera");
    setStage("import");
  }, []);

  const goPreview = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setStage("preview");
  }, []);

  // Slot-indexed write. Both the gallery picker and the camera
  // capture paths ultimately produce a single FilmedClip and
  // need to land it in the right slot while preserving the
  // other slot. Extracted so the picker and camera handlers
  // share one source of truth for ordering — no duplicated
  // "rebuild the array" logic between them.
  const writeClipToSlot = useCallback(
    (index: 0 | 1, picked: FilmedClip) => {
      setClips((prev) => {
        // Build the next array slot-by-slot so order survives
        // a "replace slot 0 while slot 1 is filled" sequence.
        const next: FilmedClip[] = [];
        if (index === 0) {
          next.push(picked);
          if (prev[1]) next.push(prev[1]);
        } else {
          // index === 1 — guarded by callers (slot 1 is locked
          // in the UI until slot 0 is filled).
          next.push(prev[0]);
          next.push(picked);
        }
        return next;
      });
    },
    [],
  );

  // Per-slot gallery picker. The Import stage exposes two
  // labeled slots ("Clip 1" / "Clip 2 (optional)") and each one
  // calls this helper with its own index. We pick a SINGLE video
  // per call so each slot maps 1:1 to a file. Re-tapping a
  // filled slot replaces just that slot without disturbing the
  // other one.
  const handlePickClipAt = useCallback(
    async (index: 0 | 1) => {
      if (busy) return;
      // Belt-and-braces: the UI disables slot 1 until slot 0
      // is filled, so the only legal write to clips[1] is when
      // clips[0] already exists. Guard here too in case a stale
      // press races the disable.
      if (index === 1 && clips.length === 0) return;
      setBusy(true);
      setErrorMsg(null);
      try {
        const picked = await pickVideo({ limit: 1 });
        if (!picked || picked.length === 0) {
          // User cancelled or empty selection — release the
          // busy lock and stay on the Import stage. No error,
          // no state change.
          return;
        }
        writeClipToSlot(index, picked[0]);
      } catch (err) {
        setErrorMsg(formatError(err, "Couldn't import that clip."));
      } finally {
        setBusy(false);
      }
    },
    [busy, clips.length, writeClipToSlot],
  );

  // Camera capture for a slot. Mirrors handlePickClipAt but
  // sources the clip from the device camera instead of the
  // gallery. Currently invoked only by the Import stage's
  // auto-open useEffect (Slot 0, "I'm ready to film" intent) —
  // slot taps themselves still use the picker so the screen's
  // visible behaviour matches the spec ("screen remains the
  // same"). Kept index-parameterised for symmetry with the
  // picker handler.
  const handleCaptureClipAt = useCallback(
    async (index: 0 | 1) => {
      if (busy) return;
      if (index === 1 && clips.length === 0) return;
      setBusy(true);
      setErrorMsg(null);
      try {
        const captured = await captureVideo();
        if (!captured || captured.length === 0) return;
        writeClipToSlot(index, captured[0]);
      } catch (err) {
        setErrorMsg(formatError(err, "Couldn't capture that clip."));
      } finally {
        setBusy(false);
      }
    },
    [busy, clips.length, writeClipToSlot],
  );

  // Called by ImportStage exactly once after it consumes the
  // pending auto-action. Clearing here (not inside the action
  // handler) keeps the parent state authoritative and prevents
  // a re-fire if the user backs out and returns without re-
  // pressing one of the entry buttons.
  const handleAutoActionConsumed = useCallback(() => {
    setPendingAutoAction(null);
  }, []);

  // Continue from Import → Preview. Allowed once at least one
  // clip is in the array (Clip 2 is genuinely optional per the
  // spec). The handler is intentionally tiny so the slot buttons
  // can call it without going through any extra validation —
  // the disabled state on the button is the source of truth.
  const handleContinue = useCallback(() => {
    if (clips.length === 0) return;
    goPreview();
  }, [clips.length, goPreview]);

  // "Upload video instead" path from the Tips screen. Routes to
  // the same Import stage as "I'm ready to film" — both onramps
  // land on the unified two-slot picker so there's exactly one
  // upload UI in the app. The only difference is the auto-open
  // intent: this path opens the gallery picker on entry, the
  // film path opens the camera. No separate single-shot
  // shortcut: the spec wants "up to 2 video uploads" everywhere
  // uploads happen.
  const handleUploadInstead = useCallback(() => {
    if (busy) return;
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setPendingAutoAction("picker");
    setStage("import");
  }, [busy]);

  const handleDone = useCallback(() => {
    router.replace("/(tabs)");
  }, [router]);

  // Hand-off to the side-by-side review skeleton. We pass the
  // idea + clip JSON-encoded so /review is fully self-contained
  // and can be re-entered (back-nav, deep-link) without needing
  // any global state. Guarded on `clip` so the button can only
  // fire from the preview stage.
  const handleSeeReview = useCallback(() => {
    if (!idea || clips.length === 0) return;
    router.push({
      pathname: "/review",
      params: {
        idea: JSON.stringify(idea),
        // We pass `clip` (legacy single — the canonical primary
        // for Phase 1's single-output template) AND `clips` (the
        // full input array) so the review screen can keep its
        // existing single-clip behaviour today while Phase 2's
        // multi-clip structuring picks up the array without a
        // route-param migration.
        clip: JSON.stringify(clips[0]),
        clips: JSON.stringify(clips),
      },
    });
  }, [router, idea, clips]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
  }, [router]);

  /* ---------- Render ----------------------------------------- */

  if (!idea) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <CosmicBackdrop />
        <View
          style={[styles.notFound, { paddingTop: insets.top + 80 }]}
        >
          <Text style={styles.title}>Couldn't open that idea.</Text>
          <Text style={styles.sub}>
            Head back to Home and tap the idea again.
          </Text>
          <PrimaryButton label="Back to Home" onPress={handleDone} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <CosmicBackdrop />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 48,
          paddingHorizontal: 22,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Top bar with back / stage marker. Three dots so the
            user always knows where in the flow they are. */}
        <View style={styles.topBar}>
          <Pressable
            onPress={handleBack}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Feather name="chevron-left" size={26} color="#FFFFFF" />
          </Pressable>
          <View style={styles.stageDots}>
            {(["tips", "import", "preview"] as const).map((s) => (
              <View
                key={s}
                style={[
                  styles.stageDot,
                  stageIndex(stage) >= stageIndex(s)
                    ? styles.stageDotActive
                    : null,
                ]}
              />
            ))}
          </View>
          <View style={{ width: 26 }} />
        </View>

        {stage === "tips" ? (
          <TipsStage
            idea={idea}
            onContinue={goImport}
            onUpload={handleUploadInstead}
            uploadBusy={busy}
          />
        ) : null}
        {stage === "import" ? (
          <ImportStage
            clips={clips}
            autoAction={pendingAutoAction}
            onPickAt={handlePickClipAt}
            onCaptureAt={handleCaptureClipAt}
            onAutoActionConsumed={handleAutoActionConsumed}
            onContinue={handleContinue}
            busy={busy}
          />
        ) : null}
        {stage === "preview" && clips.length > 0 ? (
          <PreviewStage
            idea={idea}
            clips={clips}
            onDone={handleDone}
            onSeeReview={handleSeeReview}
          />
        ) : null}

        {errorMsg ? (
          <Animated.View entering={FadeIn}>
            <Text style={styles.error}>{errorMsg}</Text>
          </Animated.View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/* =================== Stage 1 · Tips =================== */

function TipsStage({
  idea,
  onContinue,
  onUpload,
  uploadBusy,
}: {
  idea: IdeaCardData;
  onContinue: () => void;
  onUpload: () => void;
  uploadBusy: boolean;
}) {
  // Plain-language confidence lines, derived from the idea's own
  // metadata — not the LLM's `whyItWorks` free-text (which used
  // to leak system terms like "denial_loop core" / "exploration
  // target" into the UI right before the user films).
  // See lib/whyThisWorks.ts for the contract.
  const whyLines = deriveWhyThisWorksLines(idea);

  return (
    <Animated.View entering={FadeIn.duration(280)} style={styles.stage}>
      <Text style={styles.kicker}>Step 1 of 3 · Let's film this</Text>
      <Text style={styles.title}>{idea.hook}</Text>

      {idea.visualHook ? (
        <TipBlock title="Open with" body={idea.visualHook} />
      ) : null}

      <TipBlock
        title="Hook (first 3 seconds)"
        body={idea.hook}
      />

      <WhyThisWorksBlock lines={whyLines} />

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>15–30s video</Text>
        {typeof idea.filmingTimeMin === "number" ? (
          <Text style={styles.metaText}>
            Takes ~{idea.filmingTimeMin} min to shoot
          </Text>
        ) : null}
      </View>

      {/* Both CTAs share the busy lock: while the upload picker
          is open we disable the primary too so a tap can't race
          a stage transition to ImportStage mid-pick. */}
      <PrimaryButton
        label="I'm ready to film"
        onPress={onContinue}
        disabled={uploadBusy}
      />
      {/* Secondary capture path — same downstream as filming.
          Lower visual emphasis (outline, not filled) so it doesn't
          compete with the primary "I'm ready to film" CTA. */}
      <OutlineButton
        label={uploadBusy ? "Opening…" : "Upload video instead"}
        onPress={onUpload}
        disabled={uploadBusy}
      />
    </Animated.View>
  );
}

/* =================== Stage 2 · Import =================== */

function ImportStage({
  clips,
  autoAction,
  onPickAt,
  onCaptureAt,
  onAutoActionConsumed,
  onContinue,
  busy,
}: {
  clips: FilmedClip[];
  autoAction: "camera" | "picker" | null;
  onPickAt: (index: 0 | 1) => void;
  onCaptureAt: (index: 0 | 1) => void;
  onAutoActionConsumed: () => void;
  onContinue: () => void;
  busy: boolean;
}) {
  const clip1 = clips[0];
  const clip2 = clips[1];
  // Slot 2 is locked until Slot 1 is filled — order is enforced
  // at the UI so the user can't end up with a "Clip 2 only"
  // arrangement that the data model doesn't represent.
  const slot2Disabled = !clip1 || busy;
  const continueDisabled = clips.length === 0 || busy;
  // Fast-entry: when the user lands here from "I'm ready to
  // film" or "Upload video instead", auto-open the matching
  // native modal for Slot 1 exactly once. Two layers of
  // single-fire defence:
  //   1. consumedRef — survives React 18 dev StrictMode's
  //      simulated mount/unmount/mount cycle (refs persist
  //      across the cycle within one component instance), so
  //      the effect cannot invoke the camera/picker twice on
  //      mount in dev. A real unmount-remount (user backs to
  //      Tips and re-enters) creates a new instance with a
  //      fresh ref, so the next entry still fires correctly.
  //   2. We also clear the parent's pendingAutoAction BEFORE
  //      invoking the action so any unrelated re-render that
  //      changes the deps (busy flips, callback identity)
  //      finds autoAction === null and the early return hits
  //      anyway. Belt-and-braces.
  // If the user cancels the modal, the slot stays empty and a
  // tap on Slot 1 falls back to the picker (the screen's
  // normal behaviour).
  const consumedRef = useRef(false);
  useEffect(() => {
    if (!autoAction) return;
    if (consumedRef.current) return;
    consumedRef.current = true;
    const action = autoAction;
    onAutoActionConsumed();
    if (action === "camera") {
      void onCaptureAt(0);
    } else {
      void onPickAt(0);
    }
  }, [autoAction, onCaptureAt, onPickAt, onAutoActionConsumed]);
  return (
    <Animated.View entering={FadeIn.duration(280)} style={styles.stage}>
      <Text style={styles.kicker}>Step 2 of 3 · Got your clips?</Text>
      <Text style={styles.title}>Add your clips.</Text>
      <Text style={styles.helper}>Most videos are just 1–2 quick clips</Text>

      <ClipSlot
        label="Clip 1"
        clip={clip1}
        onPress={() => onPickAt(0)}
        busy={busy}
        disabled={busy}
      />
      <ClipSlot
        label="Clip 2 (optional)"
        clip={clip2}
        onPress={() => onPickAt(1)}
        busy={busy}
        disabled={slot2Disabled}
      />

      <PrimaryButton
        label="Continue"
        onPress={onContinue}
        disabled={continueDisabled}
      />

      <Text style={styles.privacy}>
        We only record the filename · the file stays on your device.
      </Text>
      {Platform.OS === "web" ? (
        <Text style={styles.privacy}>
          Web preview: tapping a slot uses a simulated upload — on the
          phone app it opens your real gallery.
        </Text>
      ) : null}
    </Animated.View>
  );
}

/* ----------- ClipSlot ----------- *
 * One labeled tap-target per slot. Empty: shows label + "Tap to
 * choose". Filled: shows label + filename · duration plus a
 * checkmark glyph. Tapping a filled slot reopens the picker so
 * the user can replace just that slot — no separate remove
 * affordance (no editing tools per spec). When `disabled` is
 * true the slot dims and reads as locked to the screen reader. */
function ClipSlot({
  label,
  clip,
  onPress,
  busy,
  disabled,
}: {
  label: string;
  clip: FilmedClip | undefined;
  onPress: () => void;
  busy: boolean;
  disabled: boolean;
}) {
  const filled = !!clip;
  const valueText = filled
    ? `${clip!.filename}${
        typeof clip!.durationSec === "number" ? ` · ${clip!.durationSec}s` : ""
      }`
    : busy && !disabled
      ? "Adding…"
      : "Tap to choose";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.slot,
        filled ? styles.slotFilled : styles.slotEmpty,
        disabled && !filled ? styles.slotDisabled : null,
        pressed && !disabled ? styles.slotPressed : null,
      ]}
      accessibilityRole="button"
      accessibilityLabel={
        filled
          ? `${label} added: ${clip!.filename}. Tap to replace.`
          : disabled
            ? `${label}. Locked.`
            : `${label}. Tap to choose.`
      }
      accessibilityState={{ disabled }}
    >
      <View style={styles.slotRow}>
        <Text
          style={[styles.slotLabel, disabled && !filled && styles.slotLabelMuted]}
        >
          {label}
        </Text>
        <Feather
          name={filled ? "check-circle" : "plus-circle"}
          size={18}
          color={
            filled
              ? lumina.firefly
              : disabled
                ? "rgba(255,255,255,0.3)"
                : "rgba(255,255,255,0.6)"
          }
        />
      </View>
      <Text
        style={[
          styles.slotValue,
          filled ? styles.slotValueFilled : null,
          disabled && !filled ? styles.slotValueMuted : null,
        ]}
        numberOfLines={1}
      >
        {valueText}
      </Text>
    </Pressable>
  );
}

/* =================== Stage 3 · Preview =================== */

function PreviewStage({
  idea,
  clips,
  onDone,
  onSeeReview,
}: {
  idea: IdeaCardData;
  // Phase 1: clips[0] is the canonical primary clip rendered
  // into the template; the remainder are carried as data for
  // Phase 2's multi-clip structuring. No reorder/trim/
  // transition UI in Phase 1.
  clips: FilmedClip[];
  onDone: () => void;
  onSeeReview: () => void;
}) {
  const primary = clips[0];
  const extras = clips.length - 1;
  return (
    <Animated.View entering={FadeIn.duration(280)} style={styles.stage}>
      <Text style={styles.kicker}>Step 3 of 3 · Template preview</Text>
      <Text style={styles.title}>Here's the rough cut.</Text>

      {/* Stylised template frame. Real composition (caption
          overlay timing, transitions, music bed) lands in the
          export PR. This frame just communicates the shape. */}
      <View style={styles.frame}>
        <View style={styles.frameHeader}>
          <View style={styles.framePill}>
            <Text style={styles.framePillText}>HOOK · 0:00</Text>
          </View>
        </View>
        <View style={styles.frameBody}>
          <Text style={styles.frameHook}>{idea.hook}</Text>
          {idea.visualHook ? (
            <Text style={styles.frameVisualHook}>{idea.visualHook}</Text>
          ) : null}
        </View>
        <View style={styles.frameFooter}>
          <Feather name="film" size={14} color="rgba(255,255,255,0.55)" />
          <Text style={styles.frameClip} numberOfLines={1}>
            {primary.filename}
            {typeof primary.durationSec === "number"
              ? ` · ${primary.durationSec}s`
              : ""}
          </Text>
        </View>
        {extras > 0 ? (
          <Text style={styles.metaText}>
            +{extras} more clip{extras > 1 ? "s" : ""} imported
          </Text>
        ) : null}
      </View>

      {idea.caption ? (
        <View style={styles.captionBlock}>
          <Text style={styles.captionLabel}>Suggested caption</Text>
          <Text style={styles.captionBody}>{idea.caption}</Text>
        </View>
      ) : null}

      {/* Primary forward action — show the side-by-side review
          of this take against a past similar video. This is the
          new "next beat" after preview; "Back to ideas" stays as
          the secondary escape hatch. */}
      <PrimaryButton label="See how this compares" onPress={onSeeReview} />

      {/* Iteration-loop placeholder. Disabled on purpose — wiring
          this to a real "regenerate this preview with a different
          take" pass lands with the export PR. Keeping it visible
          (not hidden) so the user can see the loop is the next
          beat after preview, not a dead end. */}
      <ComingSoonButton
        label="Make another version"
        hint="coming soon"
        accessibilityLabel="Make another version (coming soon)"
      />

      <TextButton label="Back to ideas" onPress={onDone} />
    </Animated.View>
  );
}

/* =================== Primitives =================== */

function TipBlock({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.tipBlock}>
      <Text style={styles.tipTitle}>{title}</Text>
      <Text style={styles.tipBody}>{body}</Text>
    </View>
  );
}

// "Why this works" block — same visual frame as TipBlock so it
// blends with the rest of the tips, but renders 2–3 short
// confidence lines stacked instead of a single body paragraph.
// Lines come from deriveWhyThisWorksLines() — see
// lib/whyThisWorks.ts for the contract (no system terms,
// 3–6 words each, max 3 lines).
function WhyThisWorksBlock({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <View style={styles.tipBlock}>
      <Text style={styles.tipTitle}>Why this works</Text>
      {lines.map((line, idx) => (
        <Text
          key={idx}
          style={[styles.tipBody, idx > 0 ? styles.whyLineSpacer : null]}
        >
          {line}
        </Text>
      ))}
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.primary,
        pressed && !disabled ? styles.primaryPressed : null,
        disabled || loading ? styles.primaryDisabled : null,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {loading ? (
        <ActivityIndicator color="#0A0824" />
      ) : (
        <Text style={styles.primaryLabel}>{label}</Text>
      )}
    </Pressable>
  );
}

// Outline button — secondary affordance with lower visual
// emphasis than PrimaryButton (transparent fill + bordered)
// but more discoverable than TextButton. Used on the Tips
// screen for "Upload video instead" so the filming path stays
// the unambiguous primary while uploading is still one tap.
function OutlineButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.outline,
        pressed && !disabled ? styles.outlinePressed : null,
        disabled ? styles.outlineDisabled : null,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Text style={styles.outlineLabel}>{label}</Text>
    </Pressable>
  );
}

// Tertiary "text link" button — used for escape-hatch actions
// that we don't want competing with the primary forward CTA.
function TextButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.textButton,
        pressed ? styles.textButtonPressed : null,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={styles.textButtonLabel}>{label}</Text>
    </Pressable>
  );
}

// Visible-but-disabled affordance for skeleton screens. Renders
// the label + a small "coming soon" hint, and is wired up as a
// Pressable with disabled=true so it picks up the right
// accessibilityState (vs. just a styled View, which screen
// readers wouldn't recognise as a button at all).
function ComingSoonButton({
  label,
  hint,
  accessibilityLabel,
}: {
  label: string;
  hint: string;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      disabled
      style={styles.secondary}
      accessibilityRole="button"
      accessibilityState={{ disabled: true }}
      accessibilityLabel={accessibilityLabel ?? `${label} (${hint})`}
    >
      <Text style={styles.secondaryLabel}>{label}</Text>
      <Text style={styles.secondaryHint}>{hint}</Text>
    </Pressable>
  );
}

/* =================== Helpers =================== */

function stageIndex(s: Stage): number {
  return s === "tips" ? 0 : s === "import" ? 1 : 2;
}

function formatError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

// Local copy of the onboarding picker — same web fallback so the
// Replit preview iframe stays usable. Kept inline to avoid a
// cross-package shuffle; when a third caller appears we should
// promote both helpers to `lib/pickVideo.ts`.
// Phase 1 picker: returns one or more clips. Multi-select is
// enabled at the OS level (iOS surfaces it natively when the
// user taps "Select"). Per-slot callers pass limit=1 so each
// slot maps 1:1 to a file; the slot-write helper is the single
// source of truth for ordering. See replit.md "multi-clip rule".
async function pickVideo(
  opts: { limit?: 1 | 2 } = {},
): Promise<FilmedClip[] | null> {
  // limit=1 is used by the per-slot picker in ImportStage; each
  // slot maps to one file. limit=2 is reserved for any future
  // bulk-select call site.
  const limit = opts.limit ?? 2;
  if (Platform.OS === "web") {
    // Web QA mock — return a single synthetic clip so the
    // browser test path stays identical. Real multi-clip
    // selection is exercised on device.
    return [
      {
        filename: `web-sim-clip-${Date.now()}.mp4`,
        durationSec: 22,
      },
    ];
  }
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== "granted") return null;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: false,
      allowsMultipleSelection: limit > 1,
      // Phase 1 cap: 2 clips. We use 2 here because templates
      // still render a single short-form output and there's no
      // sequencer/editor UI yet — letting the picker accept 8
      // was overpromising. See replit.md "multi-clip rule".
      selectionLimit: limit,
      quality: 0.7,
    });
    if (result.canceled) return null;
    const assets = result.assets ?? [];
    if (assets.length === 0) return null;
    return assets.map((asset, idx) => {
      const filename =
        asset.fileName ??
        asset.uri.split("/").pop() ??
        `clip-${Date.now()}-${idx}.mp4`;
      const durationSec =
        typeof asset.duration === "number" && asset.duration > 0
          ? Math.round(asset.duration / 1000)
          : undefined;
      return { filename, durationSec, uri: asset.uri };
    });
  } catch (err) {
    // Surface the real picker failure to the caller instead of
    // synthesising a placeholder clip. The previous behaviour
    // (returning a `fallback-*.mp4` with no `uri`) faked success
    // and broke downstream rendering / save in /review. Callers
    // wrap this in their own try/catch and route the message to
    // `setErrorMsg`, so the user sees a friendly error toast
    // instead of a silently-broken clip.
    throw err instanceof Error
      ? err
      : new Error("Couldn't open your gallery. Try again?");
  }
}

// Camera capture sibling of pickVideo. Always single-shot —
// the camera UX is "record one clip, save it" and we want each
// recorded clip to land in exactly one slot. Used by the Import
// stage's auto-open useEffect when the user enters via "I'm
// ready to film". Web QA returns a synthetic clip identical in
// shape to pickVideo's so the browser e2e path stays uniform
// (launchCameraAsync isn't available on web in any case).
async function captureVideo(): Promise<FilmedClip[] | null> {
  if (Platform.OS === "web") {
    return [
      {
        filename: `web-sim-cap-${Date.now()}.mp4`,
        durationSec: 22,
      },
    ];
  }
  try {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.status !== "granted") return null;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: false,
      quality: 0.7,
    });
    if (result.canceled) return null;
    const assets = result.assets ?? [];
    if (assets.length === 0) return null;
    return assets.map((asset, idx) => {
      const filename =
        asset.fileName ??
        asset.uri.split("/").pop() ??
        `cap-${Date.now()}-${idx}.mp4`;
      const durationSec =
        typeof asset.duration === "number" && asset.duration > 0
          ? Math.round(asset.duration / 1000)
          : undefined;
      return { filename, durationSec, uri: asset.uri };
    });
  } catch (err) {
    throw err instanceof Error
      ? err
      : new Error("Couldn't open the camera. Try again?");
  }
}

/* =================== Styles =================== */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0A0824" },
  notFound: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: "flex-start",
    alignItems: "stretch",
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 28,
  },
  stageDots: {
    flexDirection: "row",
    gap: 8,
  },
  stageDot: {
    width: 28,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  stageDotActive: {
    backgroundColor: lumina.firefly,
  },
  stage: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
  },
  kicker: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  title: {
    ...type.display,
    color: "#FFFFFF",
    marginBottom: 14,
    fontSize: 28,
    lineHeight: 34,
  },
  sub: {
    ...type.body,
    color: "rgba(255,255,255,0.7)",
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 28,
  },
  tipBlock: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  tipTitle: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  tipBody: {
    ...type.body,
    color: "rgba(255,255,255,0.9)",
    fontSize: 15,
    lineHeight: 21,
  },
  metaRow: {
    gap: 4,
    marginTop: 6,
    marginBottom: 24,
  },
  metaPill: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  metaText: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
  },
  privacy: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    textAlign: "center",
    marginTop: 14,
  },
  // Preview stylised frame
  frame: {
    aspectRatio: 9 / 16,
    backgroundColor: "rgba(0,0,0,0.4)",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.35)",
    overflow: "hidden",
    marginBottom: 22,
    padding: 18,
    justifyContent: "space-between",
  },
  frameHeader: {
    flexDirection: "row",
  },
  framePill: {
    backgroundColor: "rgba(0,255,204,0.16)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  framePillText: {
    fontFamily: fontFamily.bodyBold,
    color: lumina.firefly,
    fontSize: 10,
    letterSpacing: 1.2,
  },
  frameBody: {
    flex: 1,
    justifyContent: "center",
    paddingVertical: 24,
  },
  frameHook: {
    ...type.display,
    color: "#FFFFFF",
    fontSize: 26,
    lineHeight: 32,
    marginBottom: 12,
  },
  frameVisualHook: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    lineHeight: 20,
  },
  frameFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  frameClip: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    flex: 1,
  },
  captionBlock: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  captionLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  captionBody: {
    ...type.body,
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    lineHeight: 20,
  },
  // Buttons
  primary: {
    backgroundColor: lumina.firefly,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 12,
  },
  primaryPressed: {
    opacity: 0.85,
  },
  primaryDisabled: {
    opacity: 0.4,
  },
  primaryLabel: {
    fontFamily: fontFamily.bodyBold,
    color: "#0A0824",
    fontSize: 16,
    letterSpacing: 0.4,
  },
  // Disabled "coming soon" placeholder. Reads as a secondary
  // outlined button with a small hint underneath the label.
  secondary: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    opacity: 0.6,
    marginBottom: 4,
  },
  secondaryLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.85)",
    fontSize: 15,
  },
  secondaryHint: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.45)",
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 4,
  },
  // Outline secondary button — bordered, transparent fill,
  // sits visually below the filled PrimaryButton without
  // competing for attention. Used by "Upload video instead".
  outline: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.45)",
    marginTop: 10,
  },
  outlinePressed: {
    backgroundColor: "rgba(0,255,204,0.08)",
  },
  outlineDisabled: {
    opacity: 0.5,
  },
  outlineLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 15,
    letterSpacing: 0.3,
  },
  // Spacer between successive lines of the "Why this works"
  // block so each short line gets a little breathing room
  // without needing a separate Text component per gap.
  whyLineSpacer: {
    marginTop: 4,
  },
  // Tertiary text-link button — used as the secondary escape
  // hatch when the primary CTA points forward to the next stage.
  textButton: {
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  textButtonPressed: {
    opacity: 0.6,
  },
  textButtonLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.65)",
    fontSize: 14,
  },
  error: {
    fontFamily: fontFamily.bodyMedium,
    color: "#FF8FA1",
    fontSize: 14,
    marginTop: 18,
    textAlign: "center",
  },
  // One-line helper directly under the Import stage title.
  // Lighter weight than `sub` so it reads as a soft hint, not
  // an instruction the user has to parse.
  helper: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 22,
  },
  // Slot button shared base — sits between two states (empty /
  // filled) and a disabled variant. Mirrors the visual rhythm
  // of `tipBlock` so the import stage feels consistent with
  // tips without introducing a new card style.
  slot: {
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
  },
  slotEmpty: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: "rgba(0,255,204,0.35)",
    borderStyle: "dashed",
  },
  slotFilled: {
    backgroundColor: "rgba(0,255,204,0.08)",
    borderColor: "rgba(0,255,204,0.5)",
  },
  slotDisabled: {
    opacity: 0.55,
    borderColor: "rgba(255,255,255,0.12)",
    borderStyle: "solid",
  },
  slotPressed: {
    opacity: 0.85,
  },
  slotRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  slotLabel: {
    fontFamily: fontFamily.bodyBold,
    color: "#FFFFFF",
    fontSize: 15,
    letterSpacing: 0.2,
  },
  slotLabelMuted: {
    color: "rgba(255,255,255,0.55)",
  },
  slotValue: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    marginTop: 6,
  },
  slotValueFilled: {
    color: "rgba(255,255,255,0.85)",
  },
  slotValueMuted: {
    color: "rgba(255,255,255,0.4)",
  },
});
