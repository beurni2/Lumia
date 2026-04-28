/**
 * Create — the Phase 1 creation flow skeleton.
 *
 * Three stages, each rendered in turn from local state:
 *
 *   1. TIPS    — show the idea's hook as a large title plus a
 *                single "What you do" list of ≤4 short physical-
 *                action lines (derived from `whatToShow`) and a
 *                one-line confidence micro-line. Designed so the
 *                user reads once, pictures the scene, and taps —
 *                no paragraphs, no rationale, no meta pills.
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
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CosmicBackdrop } from "@/components/foundation/CosmicBackdrop";
import { type IdeaCardData } from "@/components/IdeaCard";
import { lumina } from "@/constants/colors";
import { fontFamily, type } from "@/constants/typography";

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
  // Transient, non-blocking hint channel — separate from
  // `errorMsg` because the two have different contracts.
  // `errorMsg` is sticky (waits for the user to retry, which
  // resets it) and signals an actual failure the user must
  // notice. `notice` auto-dismisses and signals soft, non-
  // critical feedback the flow should keep moving past — e.g.
  // "Camera not allowed — you can upload a clip instead".
  const [notice, setNotice] = useState<string | null>(null);
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
        // A hard error supersedes any soft notice that might be
        // mid-display, so the user doesn't see a stacked
        // soft-hint + red-banner pair within the notice's
        // 3.5s auto-dismiss window.
        setNotice(null);
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
  //
  // Permission denial is a known, recoverable case — not an
  // error. We surface it through the soft `notice` channel
  // ("Camera not allowed — you can upload a clip instead") so
  // the user sees the alternative without being blocked, and
  // we leave Slot 1 empty so a tap falls back to the picker.
  // Any other failure goes to the sticky `errorMsg` channel.
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
        if (err instanceof CameraPermissionDeniedError) {
          setNotice("Camera not allowed — you can upload a clip instead");
        } else {
          // A hard error supersedes any soft notice that might be
          // mid-display, so the user doesn't see a stacked
          // soft-hint + red-banner pair within the notice's
          // 3.5s auto-dismiss window.
          setNotice(null);
          setErrorMsg(formatError(err, "Couldn't capture that clip."));
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, clips.length, writeClipToSlot],
  );

  // Auto-dismiss the soft notice after a few seconds. Long
  // enough to read the line out loud once, short enough that
  // it doesn't linger past the user's next interaction. Errors
  // are NOT auto-dismissed (they reset on the next handler
  // call instead — that's the existing contract).
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);

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

  // PreviewStage "Make another version" — clear the picked clips
  // and drop the user back at the Add Clips stage so they can
  // record a different take of the same idea. We intentionally
  // do NOT emit a `make_another_version` ideator signal here:
  // that signal is reserved for the post-export /review moment
  // where the intent is unambiguous ("I exported and still want
  // another"). Pre-export, this is a re-record of the same take,
  // not a fresh pattern preference, so emitting would over-
  // weight the per-tag memory.
  const handleMakeAnotherTake = useCallback(() => {
    if (busy) return;
    setClips([]);
    // Wipe any stale toast/error from the prior take so the
    // user lands on a clean Add Clips screen — leftover
    // "Camera not allowed" or "Couldn't import that clip"
    // messaging would read as if it applied to the new
    // attempt.
    setNotice(null);
    setErrorMsg(null);
    setStage("import");
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [busy]);

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
            onExport={handleSeeReview}
            onMakeAnother={handleMakeAnotherTake}
          />
        ) : null}

        {notice ? (
          <Animated.View
            entering={FadeIn.duration(180)}
            exiting={FadeOut.duration(220)}
            style={styles.noticeWrap}
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
          >
            <Text style={styles.notice}>{notice}</Text>
          </Animated.View>
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

/**
 * Derive a short, scannable list of physical-action lines for the
 * "What you do" block from the idea's `whatToShow` field (with
 * progressively weaker fallbacks).
 *
 * The product principle (April 2026 Film polish): the user should
 * read once, instantly picture the scene, and tap. So we strip the
 * paragraph-style prose the ideator returns and render it as ≤ 4
 * short visual steps. No paragraphs, no explanation, only physical
 * actions.
 *
 * Splitting heuristic (`splitToLines`):
 *   1. Split on sentence-ish delimiters. We require trailing
 *      whitespace after `. ! ? ;` so abbreviations like
 *      "e.g.", "i.e.", "U.S." don't shatter into garbage; the
 *      arrow `→` and newlines split unconditionally because the
 *      LLM uses them as explicit beat separators.
 *   2. Trim, drop empties + fragments shorter than 3 chars (one
 *      stray letter is noise, but "Nod" / "Sip" / "Stare" should
 *      survive — they're valid one-word physical actions).
 *   3. Soft-cap each line at ~64 chars so a single long sentence
 *      that didn't split well doesn't blow out the layout on a
 *      narrow phone.
 *   4. Cap at 4 lines (spec: "max 4 lines").
 *
 * Fallback chain runs *after* parsing each candidate, not before,
 * so a `whatToShow` that collapses to zero usable beats still
 * gracefully degrades to `visualHook` and finally `hook` — instead
 * of returning empty and letting the consumer render the bare
 * hook as a single line.
 */
function splitToLines(source: string): string[] {
  if (!source) return [];
  return source
    .split(/[.!?;]\s+|[→\n]+/g)
    .map((s) => s.trim())
    // Strip a trailing period left from non-whitespace-followed
    // dots (e.g. last sentence in the source, or a fragment that
    // ended on `etc.`). Keeps lines visually clean.
    .map((s) => s.replace(/\.+$/, "").trim())
    .filter((s) => s.length >= 3)
    // Soft cap so an unsplittable run-on sentence still renders
    // legibly. We trim on a word boundary and add an ellipsis so
    // it's obvious there was more.
    .map((s) => (s.length <= 64 ? s : `${s.slice(0, 61).trimEnd()}…`))
    .slice(0, 4);
}

function deriveActionLines(idea: IdeaCardData): string[] {
  const candidates = [idea.whatToShow, idea.visualHook, idea.hook];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const lines = splitToLines(candidate);
    if (lines.length > 0) return lines;
  }
  return [];
}

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
  // ≤ 4 short physical-action lines. See deriveActionLines() above
  // for the contract. We render the section unconditionally — the
  // function falls back to the hook itself so there's always at
  // least one line to display.
  const actionLines = deriveActionLines(idea);
  // Confidence micro-line under the action list. The filming-time
  // estimate is per-idea on the server (filmingTimeMin); when the
  // model omitted it we fall back to ~1 min so the line still
  // reads correctly. "Just your face" is intentionally fixed copy —
  // it sets expectation that no props / no setup are required.
  const minutes =
    typeof idea.filmingTimeMin === "number" && idea.filmingTimeMin > 0
      ? idea.filmingTimeMin
      : 1;
  const confidenceLine = `Takes ~${minutes} min • Just your face`;

  return (
    <Animated.View entering={FadeIn.duration(280)} style={styles.stage}>
      <Text style={styles.kicker}>Step 1 of 3 · Let's film this</Text>
      {/* The hook IS the title — read once, instantly picture it. */}
      <Text style={styles.title}>{idea.hook}</Text>

      {/* Single "What you do" section — physical actions only. The
          previous Open with / Hook (first 3s) / Why this works
          stack was teaching the user; this version triggers them
          to act. */}
      <View style={styles.actionSection}>
        <Text style={styles.actionSectionLabel}>What you do</Text>
        <View style={styles.actionList}>
          {actionLines.length > 0 ? (
            actionLines.map((line, idx) => (
              <Text key={idx} style={styles.actionLine}>
                {line}
              </Text>
            ))
          ) : (
            // Defensive empty state — should never trigger because
            // deriveActionLines falls back to the hook, but keep
            // the section non-empty if the model ever ships an
            // idea with neither whatToShow / visualHook / hook.
            <Text style={styles.actionLine}>{idea.hook}</Text>
          )}
        </View>
      </View>

      {/* Confidence micro-line — single sentence, tight under the
          action list. Sets expectation: low effort, fast, no setup. */}
      <Text style={styles.confidenceLine}>{confidenceLine}</Text>

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
      <Text style={styles.title}>Add your clip</Text>
      <Text style={styles.helper}>1–2 quick clips is enough.</Text>

      <ClipSlot
        label="Clip 1"
        helper="Start with the main moment."
        clip={clip1}
        onFilm={() => onCaptureAt(0)}
        onUpload={() => onPickAt(0)}
        busy={busy}
        disabled={busy}
      />
      <ClipSlot
        label="Clip 2 (optional)"
        helper="Add a reaction or second angle."
        clip={clip2}
        onFilm={() => onCaptureAt(1)}
        onUpload={() => onPickAt(1)}
        busy={busy}
        disabled={slot2Disabled}
      />

      <PrimaryButton
        label="Continue"
        onPress={onContinue}
        disabled={continueDisabled}
      />

      {/* Reassurance copy that sits directly under Continue —
          fights perfection pressure at the exact moment the
          user is deciding whether their clips are "good enough"
          to move forward. Italic + dim so it reads as friendly
          context, not another instruction. */}
      <Text style={styles.microConfidence}>
        Don't overthink it — quick and messy works.
      </Text>

      <Text style={styles.privacy}>
        We only record the filename · the file stays on your device.
      </Text>
      {Platform.OS === "web" ? (
        <Text style={styles.privacy}>
          Web preview: tapping a button uses a simulated upload — on the
          phone app it opens your real gallery or camera.
        </Text>
      ) : null}
    </Animated.View>
  );
}

/* ----------- ClipSlot ----------- *
 * One slot card per clip. Renders a label + helper guidance and
 * two explicit action buttons — Film and Upload — inside the
 * card. Filled cards keep the same two buttons (Film/Upload now
 * act as Replace) and additionally surface the picked
 * filename · duration so the user knows what's been added.
 *
 * The card itself is presentational (a View, not a Pressable).
 * All actions go through the labeled buttons so a screen reader
 * sees two distinct affordances per slot rather than a single
 * ambiguous tap-target — this is the intentional shift from the
 * previous "tap-anywhere-on-the-slot" pattern, in service of
 * removing thinking from the Add Clips screen.
 *
 * When `disabled` is true the card dims and both buttons disable
 * + read as locked. Slot 2 is locked until Slot 1 is filled —
 * order is enforced at the UI so the data model never sees a
 * "Clip 2 only" arrangement. */
function ClipSlot({
  label,
  helper,
  clip,
  onFilm,
  onUpload,
  busy,
  disabled,
}: {
  label: string;
  helper: string;
  clip: FilmedClip | undefined;
  onFilm: () => void;
  onUpload: () => void;
  busy: boolean;
  disabled: boolean;
}) {
  const filled = !!clip;
  const valueText = filled
    ? `${clip!.filename}${
        typeof clip!.durationSec === "number" ? ` · ${clip!.durationSec}s` : ""
      }`
    : null;
  return (
    <View
      style={[
        styles.slot,
        filled ? styles.slotFilled : styles.slotEmpty,
        disabled && !filled ? styles.slotDisabled : null,
      ]}
      accessibilityLabel={
        filled
          ? `${label} added: ${clip!.filename}.`
          : disabled
            ? `${label}. Locked until the previous clip is added.`
            : `${label}.`
      }
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
          styles.slotHelper,
          disabled && !filled ? styles.slotHelperMuted : null,
        ]}
      >
        {helper}
      </Text>

      {valueText ? (
        <Text
          style={[styles.slotValue, styles.slotValueFilled]}
          numberOfLines={1}
        >
          {valueText}
        </Text>
      ) : busy && !disabled ? (
        <Text style={styles.slotValueMuted}>Adding…</Text>
      ) : null}

      <View style={styles.slotActions}>
        <SlotActionButton
          icon="video"
          label={filled ? "Refilm" : "Film"}
          onPress={onFilm}
          disabled={disabled}
          accessibilityLabel={
            filled ? `Replace ${label} by filming.` : `Film ${label}.`
          }
        />
        <SlotActionButton
          icon="upload"
          label="Upload"
          onPress={onUpload}
          disabled={disabled}
          accessibilityLabel={
            filled ? `Replace ${label} by uploading.` : `Upload ${label}.`
          }
        />
      </View>
    </View>
  );
}

// Small inline pill button used inside a ClipSlot. Two of them
// sit side-by-side (Film / Upload) and share visual weight so
// neither path feels like the "right" answer — the user picks
// whichever matches their next move. Bordered transparent fill
// keeps them subordinate to the screen's primary Continue CTA.
function SlotActionButton({
  icon,
  label,
  onPress,
  disabled,
  accessibilityLabel,
}: {
  icon: "video" | "upload";
  label: string;
  onPress: () => void;
  disabled: boolean;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.slotAction,
        pressed && !disabled ? styles.slotActionPressed : null,
        disabled ? styles.slotActionDisabled : null,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
    >
      <Feather
        name={icon}
        size={14}
        color={disabled ? "rgba(255,255,255,0.3)" : lumina.firefly}
      />
      <Text
        style={[
          styles.slotActionLabel,
          disabled ? styles.slotActionLabelDisabled : null,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/* =================== Stage 3 · Preview =================== */

function PreviewStage({
  idea,
  clips,
  onDone,
  onExport,
  onMakeAnother,
}: {
  idea: IdeaCardData;
  // Phase 1: clips[0] is the canonical primary clip rendered
  // into the template; the remainder are carried as data for
  // Phase 2's multi-clip structuring. No reorder/trim/
  // transition UI in Phase 1.
  clips: FilmedClip[];
  onDone: () => void;
  // Primary action — routes to the export experience (the
  // /review screen, which owns the gallery save flow). Renamed
  // from onSeeReview to read as the user-facing action ("Export
  // video") rather than the screen name it lands on.
  onExport: () => void;
  // Secondary action — clear the picked clips and drop the user
  // back at the Add Clips stage so they can re-record a
  // different take of the same idea. Replaces the previous
  // "coming soon" placeholder.
  onMakeAnother: () => void;
}) {
  const primary = clips[0];
  const extras = clips.length - 1;
  return (
    <Animated.View entering={FadeIn.duration(280)} style={styles.stage}>
      <Text style={styles.kicker}>Step 3 of 3 · Preview</Text>
      <Text style={styles.title}>Ready to post?</Text>
      <Text style={styles.previewSub}>
        Your video already has the hook, clip, and caption.
      </Text>

      {/* Stylised preview frame. Real composition (caption
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
          <Text style={styles.captionSub}>
            Short, casual, and made to match the idea.
          </Text>
        </View>
      ) : null}

      {/* Primary forward action — route to the export
          experience. The /review screen owns the actual gallery
          save flow (watermark toggle, MediaLibrary write); this
          button reads as the user-facing intent rather than the
          screen name. */}
      <PrimaryButton label="Export video" onPress={onExport} />

      {/* Secondary — re-record a different take of the same
          idea. Outline button keeps it visually subordinate to
          Export but clearly tappable (vs the old disabled
          "coming soon" placeholder, which left the loop feeling
          like a dead end). */}
      <OutlineButton label="Make another version" onPress={onMakeAnother} />

      <Text style={styles.postManually}>
        Post it manually wherever you usually post.
      </Text>

      <TextButton label="Back to ideas" onPress={onDone} />
    </Animated.View>
  );
}

/* =================== Primitives =================== */

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

// Typed signal for "the user (or the OS) declined to grant the
// camera permission". Distinct from generic capture errors so
// the caller can surface a soft, friendly hint ("Camera not
// allowed — you can upload a clip instead") instead of the
// sticky red error banner. We deliberately do NOT redirect to
// system settings or block the flow — the user can still tap
// Slot 1 to use the gallery picker.
class CameraPermissionDeniedError extends Error {
  constructor() {
    super("Camera permission denied");
    this.name = "CameraPermissionDeniedError";
  }
}

// Camera capture sibling of pickVideo. Always single-shot —
// the camera UX is "record one clip, save it" and we want each
// recorded clip to land in exactly one slot. Used by the Import
// stage's auto-open useEffect when the user enters via "I'm
// ready to film". Web QA returns a synthetic clip identical in
// shape to pickVideo's so the browser e2e path stays uniform
// (launchCameraAsync isn't available on web in any case). A
// `globalThis.__qaDenyCamera` hook lets the e2e harness simulate
// a permission-denied response on web so the toast path can be
// exercised end-to-end without touching native code.
async function captureVideo(): Promise<FilmedClip[] | null> {
  if (Platform.OS === "web") {
    if (
      typeof globalThis !== "undefined" &&
      (globalThis as { __qaDenyCamera?: boolean }).__qaDenyCamera === true
    ) {
      throw new CameraPermissionDeniedError();
    }
    return [
      {
        filename: `web-sim-cap-${Date.now()}.mp4`,
        durationSec: 22,
      },
    ];
  }
  try {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.status !== "granted") {
      throw new CameraPermissionDeniedError();
    }
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
    // Re-throw the typed denial signal as-is so the caller can
    // route it to the soft notice channel instead of the error
    // banner. Other failures fall through to the generic wrap.
    if (err instanceof CameraPermissionDeniedError) throw err;
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
  // "What you do" section — single visual block under the hook
  // title. Subtle frame so the action lines feel like content, not
  // a tip card. Replaces the previous tipBlock stack.
  actionSection: {
    marginTop: 4,
    marginBottom: 14,
  },
  actionSectionLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  actionList: {
    gap: 8,
  },
  actionLine: {
    ...type.body,
    color: "#FFFFFF",
    fontSize: 17,
    lineHeight: 24,
  },
  // Single confidence micro-line under the action list. Tighter
  // typography than the action lines themselves so it reads as
  // metadata, not content. Bumped from 0.55 → 0.7 alpha so the
  // 13px text clears WCAG AA contrast on the cosmic backdrop.
  confidenceLine: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    marginTop: 6,
    marginBottom: 28,
  },
  // Used by ImportStage's "+N more clips imported" line — kept
  // even though the Tips screen no longer renders a metaRow.
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
  // Soft transient hint (auto-dismissing). Visually a small
  // pill-shaped banner — quieter than `error` (no alarm
  // colour, no all-red), louder than plain helper text. Lives
  // in the same render slot as `error` so layout doesn't jump
  // when one or the other appears.
  noticeWrap: {
    alignSelf: "center",
    marginTop: 18,
    marginHorizontal: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderRadius: 14,
    overflow: "hidden",
  },
  notice: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.92)",
    fontSize: 14,
    lineHeight: 20,
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
  // Helper text under each slot label — guides the user on what
  // to put in this specific slot ("Start with the main moment",
  // "Add a reaction or second angle") without using setup/payoff
  // structure language. Always visible (filled or empty) so the
  // intent of each slot stays legible during a re-record.
  slotHelper: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
  },
  slotHelperMuted: {
    color: "rgba(255,255,255,0.4)",
  },
  // Inline action row (Film | Upload) inside a slot card. Two
  // equal-weight pill buttons so neither path feels like the
  // "right" answer.
  slotActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  slotAction: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "rgba(0,255,204,0.08)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.4)",
  },
  slotActionPressed: {
    opacity: 0.7,
  },
  slotActionDisabled: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: "rgba(255,255,255,0.12)",
  },
  slotActionLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 13,
    letterSpacing: 0.3,
  },
  slotActionLabelDisabled: {
    color: "rgba(255,255,255,0.35)",
  },
  // Tiny reassurance line that lives directly under the Continue
  // button on the Add Clips screen. Italic + dim so it reads as
  // friendly context rather than another instruction.
  microConfidence: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 12,
    fontStyle: "italic",
  },
  // Sub line under the Preview screen title — supports the
  // "Ready to post?" framing by reminding the user what's
  // already baked in (hook, clip, caption).
  previewSub: {
    ...type.body,
    color: "rgba(255,255,255,0.7)",
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 18,
  },
  // Sub line under the suggested caption body — reassures the
  // user that the caption is intentionally short/casual, so they
  // don't feel they need to rewrite it.
  captionSub: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    lineHeight: 16,
    marginTop: 8,
  },
  // Footer hint on the Preview screen — sets the expectation
  // that posting is a manual step the user does in their own
  // app. We deliberately don't add a publish integration.
  postManually: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center",
    marginTop: 10,
  },
});
