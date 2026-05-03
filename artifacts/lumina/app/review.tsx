/**
 * Review — the Phase 1 side-by-side review skeleton.
 *
 * After filming and previewing in the create flow, the user
 * lands here to see how their new take compares against a past
 * similar video they imported during onboarding. The screen
 * reads as: BEFORE (a past upload) → AFTER (the new clip with
 * the idea hook overlay) → "Why this should perform better".
 *
 * Matching is rule-based and tiered (see `selectPastVideo`):
 *   1. Topic keyword — extract content tokens from the idea
 *      (hook, visualHook, whyItWorks, caption, payoffType) and
 *      check whether any appear as a whole token in any past
 *      video's filename. Will rarely fire on auto-generated
 *      filenames (IMG_1234.mp4) but lights up immediately on
 *      anything human-named (morning-routine.mp4). When past
 *      videos start carrying real topic metadata server-side,
 *      this tier picks up automatically.
 *   2. Same hook type — fall back to a duration bucket match
 *      (short ≤15s / medium ≤30s / long ≤60s / xlong >60s).
 *      Prefers the new clip's duration; falls back to the
 *      idea's planned `videoLengthSec`.
 *   3. Most recent — if neither tier hits, take the most-
 *      recently imported video.
 *
 * The matched reason is surfaced in the BEFORE pane so the
 * comparison doesn't feel arbitrary ("matched on topic" /
 * "matched on length" / "your most recent upload").
 *
 * If the user has no past imports at all (shouldn't happen
 * post-onboarding, but possible for resumed mid-session
 * flows), the screen shows a clean fallback line and the
 * WhyBetter card stays in place.
 *
 * The "Why this should perform better" card is a derived view
 * over the idea fields — it does not call the server. It reads
 * the idea's structured signals (hookSeconds, hasContrast,
 * hasVisualAction, payoffType) plus the `whyItWorks` copy and
 * presents them as a small bullet list. The framing is
 * "directional, not predictive" — these are heuristic reasons
 * the new take should land harder, not a real performance
 * forecast (that would need analytics, which is out of scope).
 *
 * Export is in scope here: a real save-to-gallery via
 * MediaLibrary plus an optional "Made with Lumina" watermark
 * preference. The watermark is currently overlaid on the
 * in-app AFTER preview only; burning it into the saved file
 * needs ffmpeg in a custom dev client (a known constraint of
 * Expo Go) and is queued for the post-MVP build.
 *
 * Out of scope (deliberate): publishing/share automation
 * (TikTok, Instagram, YouTube), analytics, monetization.
 * "Back to ideas" routes to Home; "Make another version"
 * pops back to /create so the user can re-record a different
 * take of the same idea (state-preserving, because /create
 * is still mounted underneath in the nav stack).
 */

import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import * as MediaLibrary from "expo-media-library";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, customFetch } from "@workspace/api-client-react";

import { Confetti } from "@/components/Confetti";
import { InlineToast } from "@/components/feedback/InlineToast";
import { CosmicBackdrop } from "@/components/foundation/CosmicBackdrop";
import { type IdeaCardData } from "@/components/IdeaCard";
import { lumina } from "@/constants/colors";
import { fontFamily, type } from "@/constants/typography";
import { feedback } from "@/lib/feedback";
import { isWebQaMode } from "@/lib/qaMode";
import { submitIdeatorSignal } from "@/lib/ideatorSignal";
import { POST_EXPORT_MESSAGE } from "@/lib/loopMessages";

/* ---------- Types ---------- */

type FilmedClip = {
  filename: string;
  durationSec?: number;
  uri?: string;
};

type ImportedVideo = {
  id: string;
  filename: string | null;
  durationSec: number | null;
  createdAt: string;
};

type ImportedVideosListResponse = {
  count: number;
  videos: ImportedVideo[];
};

/* ---------- Screen ---------- */

export default function ReviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Decode params once. Both idea and clip are required to
  // render anything meaningful — if either is missing we render
  // a recovery screen rather than half a comparison.
  const params = useLocalSearchParams<{
    idea?: string;
    clip?: string;
    clips?: string;
  }>();
  const { idea, clip, extraClips } = useMemo(() => {
    let parsedIdea: IdeaCardData | null = null;
    let parsedClips: FilmedClip[] = [];
    if (params.idea) {
      try {
        parsedIdea = JSON.parse(params.idea) as IdeaCardData;
      } catch {
        parsedIdea = null;
      }
    }
    // The Import stage produces 1 or 2 clips in canonical order.
    // We keep the FIRST as `clip` (drives the comparison/match
    // and the AFTER preview) and any remainder as `extraClips`
    // (saved alongside, surfaced as a footer hint). Cap at 2
    // belt-and-braces so an old/forged param can't smuggle in
    // a longer array.
    if (params.clips) {
      try {
        const arr = JSON.parse(params.clips) as FilmedClip[];
        if (Array.isArray(arr)) parsedClips = arr.slice(0, 2);
      } catch {
        parsedClips = [];
      }
    }
    if (parsedClips.length === 0 && params.clip) {
      try {
        parsedClips = [JSON.parse(params.clip) as FilmedClip];
      } catch {
        parsedClips = [];
      }
    }
    return {
      idea: parsedIdea,
      clip: parsedClips[0] ?? null,
      extraClips: parsedClips.slice(1),
    };
  }, [params.idea, params.clip, params.clips]);

  const [match, setMatch] = useState<PastMatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  // Export state — orthogonal to the match-loading state so a
  // save can run regardless of whether a past video matched.
  // Watermark is a UI preference today; see ExportSection +
  // BeforeAfter for how it's surfaced. SaveState is a tiny
  // FSM idle → saving → success | error, with success being
  // sticky until the user navigates away.
  const [watermarkOn, setWatermarkOn] = useState(false);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
  const [saveErrorMsg, setSaveErrorMsg] = useState<string | null>(null);

  // Post-flow state machine. Adds the "what happens after a save"
  // story on top of saveState's idle → saving → success | error
  // FSM. The two are intentionally orthogonal:
  //   • saveMode      — which intent the user expressed when they
  //                     tapped the primary CTA. "share" auto-opens
  //                     the platform sheet on success; "just-save"
  //                     stays put with a quieter confirmation.
  //   • shareStep     — where we are in the post flow.
  //                       idle             → ExportSection
  //                       saved            → success block visible
  //                       platform-select  → PlatformSheet modal
  //                       platform-handoff → caption + open-app
  //                       returned         → "Posted? How did it go?"
  //   • selectedPlatform — null until the user taps a tile in the
  //                     PlatformSheet. "copy" is treated specially:
  //                     it triggers a clipboard write + toast and
  //                     skips the handoff card.
  //   • copyConfirm   — short-lived ("Caption copied" / "Couldn't
  //                     open the app") inline confirmation line.
  type SaveMode = "share" | "just-save";
  type ShareStep =
    | "idle"
    | "saved"
    | "platform-select"
    | "platform-handoff"
    | "returned";
  type SocialPlatform = "tiktok" | "instagram" | "snapchat" | "copy";
  const [saveMode, setSaveMode] = useState<SaveMode>("share");
  const [shareStep, setShareStep] = useState<ShareStep>("idle");
  const [selectedPlatform, setSelectedPlatform] =
    useState<SocialPlatform | null>(null);
  const [copyConfirm, setCopyConfirm] = useState<string | null>(null);
  // Sticky flag — true once the user has picked any platform in
  // this session. Read by the AppState/focus listener to know
  // whether to show the return-loop "Posted?" card when they come
  // back from a deep link or backgrounded the app.
  const [hasInitiatedShare, setHasInitiatedShare] = useState(false);
  // Viral feedback-loop toast — set once when saveState flips to
  // "success" via the effect below, cleared when the InlineToast
  // auto-dismisses. Kept as an independent piece of state (rather
  // than derived from saveState) so the toast lifecycle is its
  // own thing — closing it doesn't reset the success block.
  const [exportToast, setExportToast] = useState<string | null>(null);

  // Semi-auto enhancement apply state — populated when the user
  // taps Apply on an EnhancementCard suggestion. Local/session-only
  // by spec ("No DB migration unless already needed"). Lives at the
  // screen level (not inside EnhancementCard) so BeforeAfter can
  // surface the new hook overlay the instant the user taps Apply.
  //   • caption / hook   — overrides the displayed text on the
  //                        review screen (caption is shown inside
  //                        the card itself; hook flows into
  //                        BeforeAfter's AFTER pane).
  //   • startHint        — formatted offset like "0:01"; shown as a
  //                        passive note. We do NOT trim — Phase 1
  //                        spec is explicit that this is a hint
  //                        only.
  //   • appliedSuggestionIds — set of suggestion ids the user has
  //                        already applied this session, so Apply
  //                        flips to a sticky "Applied" label and
  //                        we don't double-fire the signal.
  const [appliedEnhancements, setAppliedEnhancements] = useState<{
    caption?: string;
    hook?: string;
    startHint?: string;
    appliedSuggestionIds: string[];
  }>({ appliedSuggestionIds: [] });

  // Semi-auto EDIT layer (separate from the text-rewrite apply
  // layer above). Tracks the two preview-state edit intents the
  // SEMI-AUTO EDIT spec allows:
  //   • stitched         — user opted to combine clip 1 → clip 2.
  //                         No actual file mutation; the BeforeAfter
  //                         "After" frame chip flips from
  //                         "+1 more clip" to "stitched · 2 → 1".
  //   • trimStartSec     — number of seconds to lop off the head,
  //                         clamped to the spec's [0.5, 2] window.
  //                         Surfaced as a "trimmed first 1.0s" chip.
  //   • appliedActionTypes — for sticky "Applied" rendering and
  //                         double-fire signal protection.
  //
  // Lumina has no on-device video processing dependency today, so
  // this is intent-only — the saved gallery file is the original
  // bytes. The visual confirmation in BeforeAfter is what makes
  // the user feel the change land. This mirrors the same precedent
  // as `watermarkOn` (badge shown, file not burned) — see the
  // BeforeAfter watermark block for the pre-existing comment.
  const [appliedEdits, setAppliedEdits] = useState<{
    stitched: boolean;
    trimStartSec?: number;
    appliedActionTypes: string[];
  }>({ stitched: false, appliedActionTypes: [] });

  // Stale-call guard for the same reason as Home — Retry can
  // fire a second `loadMatch` while the first is still in
  // flight, and we don't want the slower one to clobber the
  // fresher result.
  const loadCallIdRef = useRef(0);

  // Per-URI dedupe set for multi-clip saves. When the user has
  // 2 clips and the second one fails partway through, we want
  // a retry to pick up where it left off — re-saving the first
  // clip would create a duplicate file in the gallery and
  // overclaim the count in the success copy. The ref shape
  // (vs state) is deliberate: we never need to re-render on
  // change, and we want the latest value inside the async
  // handleSave closure without it appearing in the dep array.
  const savedUrisRef = useRef<Set<string>>(new Set());
  // PHASE Z1 — fire `exported` ideator signal exactly once on
  // the first successful gallery save for this screen instance.
  // We dedupe with a separate boolean ref (NOT savedUrisRef)
  // because savedUrisRef is per-uri and a multi-clip save would
  // otherwise fire the signal twice for the same idea. Cleared
  // never — the ref is screen-scoped and dies with the unmount,
  // which is the desired lifecycle (a fresh /review visit for
  // the same idea SHOULD re-fire once on its first save).
  const exportedSignalFiredRef = useRef<boolean>(false);

  // List of clip URIs we'll attempt to save, in canonical order.
  // Driven by `clip` + `extraClips`; filtered to non-empty
  // strings so the success/saving copy is honest about how many
  // videos will actually land in the gallery (a clip with no
  // `uri` — e.g. a malformed picker payload — is silently
  // skipped rather than counted toward the total).
  const saveableUris = useMemo(() => {
    const out: string[] = [];
    if (clip?.uri) out.push(clip.uri);
    for (const c of extraClips) {
      if (c?.uri) out.push(c.uri);
    }
    // Web QA mode hatch — when running in the browser smoke-test
    // build (EXPO_PUBLIC_WEB_QA_MODE=true), seed a synthetic stub
    // URI so the Save & Post / Just save CTAs are enabled even
    // when the deep-linked fixture clip lacks a real `uri` field
    // (the picker / camera path supplies one on-device, but the
    // QA harness deep-links straight into /review with metadata
    // only). handleSave reads isWebQaMode() and short-circuits
    // before touching MediaLibrary, so no real file is written.
    if (out.length === 0 && clip && isWebQaMode()) {
      out.push("qa-stub://no-op");
    }
    return out;
  }, [clip, extraClips]);

  /* ---------- Past-video matching --------------------------- */

  const loadMatch = useCallback(async () => {
    const callId = ++loadCallIdRef.current;
    setLoading(true);
    setErrorMsg(null);
    setEmpty(false);
    // Clear the previous match so a retry that lands on
    // an error/empty state can't show stale BEFORE/AFTER
    // content underneath the new state.
    setMatch(null);
    try {
      const list = await customFetch<ImportedVideosListResponse>(
        "/api/imported-videos",
      );
      if (callId !== loadCallIdRef.current) return;

      if (!list.videos.length || !idea || !clip) {
        // No past videos at all — surface the friendly fallback.
        // The idea/clip guard is belt-and-braces; the effect
        // below is gated on both being present, but the closure
        // could in theory be invoked with a stale ref.
        setEmpty(true);
        return;
      }

      const picked = selectPastVideo(list.videos, idea, clip);
      if (picked) {
        setMatch(picked);
      } else {
        // selectPastVideo only returns null on empty input —
        // already handled above — but treat it as empty here
        // too to keep the state machine total.
        setEmpty(true);
      }
    } catch (err) {
      if (callId !== loadCallIdRef.current) return;
      setErrorMsg(formatError(err, "Couldn't load a past video to compare."));
    } finally {
      if (callId === loadCallIdRef.current) setLoading(false);
    }
  }, [idea, clip]);

  // Past-video matching is no longer rendered on this screen
  // (the BEFORE/AFTER comparison was removed in the post-export
  // finish-line redesign). The loadMatch helper + its state
  // (match, loading, empty, errorMsg, setMatch, etc.) are kept
  // intentionally unwired so the surrounding code paths stay
  // bounded for now and can be deleted in a follow-up cleanup.
  // Firing the effect here would burn a /api/imported-videos
  // call on every screen mount for a result nobody consumes.
  useEffect(() => {
    return;
  }, [idea, clip, loadMatch]);

  // Viral feedback-loop trigger — fire the export toast the
  // moment a save lands on "success". Setting once-per-success
  // is enough; the InlineToast owns its own auto-dismiss timer
  // and we explicitly DON'T re-fire on every render. A second
  // save (re-save / multi-clip) will flip back through "saving"
  // → "success" and naturally re-trigger this effect, which is
  // the desired behaviour.
  useEffect(() => {
    if (saveState === "success") {
      // Locked daily-habit copy (see loopMessages.ts) — a single
      // two-line message rendered inside the InlineToast bubble.
      // Was previously a random pick from a 3-string pool; the
      // daily-habit spec replaced rotation with one canonical
      // confirmation pair so every successful export feels like
      // the same satisfying beat.
      setExportToast(POST_EXPORT_MESSAGE);
      // Drive the post-flow state machine. Both modes flip into
      // "saved" first so the user sees the success block; then
      // the "share" mode (which is what "Save & Post" maps to)
      // auto-opens the platform sheet after a short beat so the
      // celebration registers before the next decision lands.
      // "just-save" stays put — the saved confirmation IS the
      // ending for that branch.
      setShareStep("saved");
      if (saveMode === "share") {
        const t = setTimeout(() => {
          setShareStep((prev) => (prev === "saved" ? "platform-select" : prev));
        }, 900);
        return () => clearTimeout(t);
      }
    }
  }, [saveState, saveMode]);

  /* ---------- Return-loop detection ----------------------- */

  // Watch the OS AppState. The moment the user comes back to the
  // app after picking a platform (we deep-link out of Lumina), we
  // surface the "Posted? How did it go?" card on the next focus
  // tick. We also listen via useFocusEffect so a navigation back
  // (e.g. from the platform handoff screen) triggers the same
  // transition.
  const lastAppStateRef = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    if (!hasInitiatedShare) return;
    const sub = AppState.addEventListener("change", (next) => {
      const prev = lastAppStateRef.current;
      lastAppStateRef.current = next;
      if (prev !== "active" && next === "active") {
        setShareStep("returned");
      }
    });
    return () => sub.remove();
  }, [hasInitiatedShare]);

  useFocusEffect(
    useCallback(() => {
      // No-op on first focus; only flip into "returned" if the
      // user has already picked a platform AND we're not currently
      // mid-handoff (so re-focusing the screen during normal
      // navigation doesn't bounce us prematurely).
      if (hasInitiatedShare && shareStep === "platform-handoff") {
        // Falling through here would feel like the app gave up on
        // the deep link. Wait for the AppState change listener
        // above to handle the actual "they came back" beat.
      }
      return undefined;
    }, [hasInitiatedShare, shareStep]),
  );

  /* ---------- Navigation ----------------------------------- */

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
  }, [router]);

  const handleHome = useCallback(() => {
    router.replace("/(tabs)");
  }, [router]);

  // One-shot guard for the "Make another version" CTA — a rapid
  // double-tap on a small button is realistic on mobile, and we
  // do NOT want to record the signal twice (would double the +2
  // weight to +4, polluting the per-tag memory) or fire two
  // simultaneous router.back() calls (Expo Router's behavior on
  // double-pop is screen-graph-dependent). One ref + early return
  // is the smallest fix that closes both holes.
  const makeAnotherFiredRef = useRef(false);
  const handleMakeAnother = useCallback(() => {
    if (makeAnotherFiredRef.current) return;
    makeAnotherFiredRef.current = true;
    // Record a `make_another_version` action signal BEFORE we
    // navigate so the next ideator batch picks it up via the
    // viral-pattern-memory aggregator (weight +2, same as
    // selected). Per Phase 1 spec we do NOT trigger generation
    // here — we only store the signal; the next /api/ideator/
    // generate call naturally inherits the bias. Forward all
    // four pattern tags so the server can credit the signal to
    // the right structure / hookStyle / spike / format buckets.
    // Fire-and-forget — submitIdeatorSignal swallows errors so
    // a failed signal never blocks navigation.
    if (idea?.hook) {
      submitIdeatorSignal({
        ideaHook: idea.hook,
        signalType: "make_another_version",
        ideaPattern: idea.pattern,
        emotionalSpike: idea.emotionalSpike,
        payoffType: idea.payoffType,
        structure: idea.structure,
        hookStyle: idea.hookStyle,
      });
    }
    // "Make another version" pops back to /create so the user
    // can re-record a different take of the same idea — going
    // back through the stack preserves their idea + clip state
    // because /create is still mounted underneath. We came in
    // via router.push from /create, so canGoBack should be
    // true; the explicit guard mirrors handleBack and protects
    // against deep-link entries with no nav history (router.
    // back is a no-op in that case, not a throw).
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
  }, [router, idea]);

  /* ---------- Export --------------------------------------- */

  const handleSave = useCallback(async () => {
    // Defensive — the Save button is disabled when canSave is
    // false, but a stale press could still land here.
    if (saveableUris.length === 0) {
      setSaveState("error");
      setSaveErrorMsg(
        Platform.OS === "web"
          ? "Saving to your gallery only works on a real device — open the app on your phone."
          : "No video file to save. Re-record and try again.",
      );
      return;
    }
    setSaveState("saving");
    setSaveErrorMsg(null);
    // Web QA mode short-circuit. The browser smoke-test build
    // doesn't have access to MediaLibrary (expo-media-library is
    // a no-op on web), so we simulate a successful save here so
    // the post-flow state machine (saved → platform-select →
    // handoff → returned) can be exercised end-to-end in
    // Playwright. Native builds always go through the real save
    // path below — isWebQaMode() returns false unless Platform
    // is "web" AND the EXPO_PUBLIC_WEB_QA_MODE env var is set.
    if (isWebQaMode()) {
      // Brief delay so the "Saving…" state is observable for the
      // test, matching the felt latency of the real save.
      await new Promise((resolve) => setTimeout(resolve, 250));
      for (const uri of saveableUris) {
        savedUrisRef.current.add(uri);
      }
      setSaveState("success");
      // PHASE Z1 — web QA path also fires the `exported` signal
      // so end-to-end Playwright runs exercise the same
      // attribution path real-device saves do.
      if (!exportedSignalFiredRef.current && idea?.hook) {
        exportedSignalFiredRef.current = true;
        submitIdeatorSignal({
          ideaHook: idea.hook,
          signalType: "exported",
          ideaPattern: idea.pattern,
          emotionalSpike: idea.emotionalSpike,
          payoffType: idea.payoffType,
          structure: idea.structure,
          hookStyle: idea.hookStyle,
        });
      }
      return;
    }
    try {
      // Android requires the permission before saveToLibrary;
      // iOS will surface its own modal too, but requesting
      // first means our error path is consistent across both.
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (perm.status !== "granted") {
        setSaveState("error");
        setSaveErrorMsg(
          "We need permission to save to your gallery. Enable Photos access in Settings and try again.",
        );
        return;
      }
      // TODO(post-mvp): when we move to a custom dev client,
      // burn the watermark into a re-encoded copy via ffmpeg
      // before saving. Today we save the original clip and
      // surface the watermark as an in-app preview overlay
      // when the toggle is on (see BeforeAfter).
      // Multi-clip: when the user uploaded 2 clips we save BOTH
      // originals to the gallery in canonical order. We don't
      // concatenate — that needs ffmpeg in a custom dev client
      // — so the user gets two adjacent files they can chain in
      // their own editor.
      //
      // The loop is awaited SEQUENTIALLY so a mid-save failure
      // surfaces immediately and we don't half-write a corrupt
      // pair. We track every successful URI in `savedUrisRef`
      // so a retry after a partial failure picks up where it
      // left off — re-saving an already-saved clip would create
      // a duplicate gallery file (Photos doesn't dedupe on
      // identical content). The ref persists across renders
      // and across handleSave invocations until the user
      // navigates away from /review.
      for (const uri of saveableUris) {
        if (savedUrisRef.current.has(uri)) continue;
        await MediaLibrary.saveToLibraryAsync(uri);
        savedUrisRef.current.add(uri);
      }
      setSaveState("success");
      // PHASE Z1 — fire-and-forget `exported` signal on the
      // first successful save. Server weights this heavier than
      // a verdict tap (see api-server/src/lib/viralPatternMemory.ts)
      // because actually exporting the video is the strongest
      // intent signal short of the `posted` confirmation. The
      // dedupe ref above guarantees one signal per /review
      // mount no matter how many retries / partial saves happen.
      if (!exportedSignalFiredRef.current && idea?.hook) {
        exportedSignalFiredRef.current = true;
        submitIdeatorSignal({
          ideaHook: idea.hook,
          signalType: "exported",
          ideaPattern: idea.pattern,
          emotionalSpike: idea.emotionalSpike,
          payoffType: idea.payoffType,
          structure: idea.structure,
          hookStyle: idea.hookStyle,
        });
      }
    } catch (err) {
      // Note: any URIs added to savedUrisRef BEFORE the throw
      // remain — we don't roll the set back, because the
      // gallery-side write already happened. Next attempt
      // skips them automatically.
      setSaveState("error");
      setSaveErrorMsg(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't save to your gallery. Try again.",
      );
    }
  }, [saveableUris, idea]);

  // "Save to gallery" appears as the first action inside the
  // success block too — so the user can re-save (e.g. they
  // deleted the gallery file, or they're just re-confirming).
  // The dedupe set above would otherwise turn the second tap
  // into a silent no-op; clearing it first makes the re-save
  // actually write a fresh copy. We do NOT clear it on the
  // initial call because that path is the partial-failure
  // retry — there we want the dedupe semantics.
  const handleSaveAgain = useCallback(() => {
    savedUrisRef.current.clear();
    void handleSave();
  }, [handleSave]);

  /* ---------- Post-flow handlers --------------------------- */

  // Two top-level CTAs map to two save intents:
  //   • Save & Post → mode "share". On success, the success effect
  //     (above) flips shareStep into "platform-select" so the
  //     platform sheet auto-opens.
  //   • Just save   → mode "just-save". Same write path, but the
  //     post-flow stops at the saved confirmation. The user can
  //     still come back to the platform sheet by tapping the CTA
  //     again — handleSaveAndPost re-triggers from "just-save".
  const handleSaveAndPost = useCallback(() => {
    setSaveMode("share");
    if (saveState === "success") {
      // Already saved (e.g. user did "Just save" first and now
      // wants the platform sheet). Skip re-saving and jump
      // straight into the post flow.
      setShareStep("saved");
      const t = setTimeout(() => {
        setShareStep((prev) => (prev === "saved" ? "platform-select" : prev));
      }, 200);
      return () => clearTimeout(t);
    }
    void handleSave();
    return undefined;
  }, [handleSave, saveState]);

  const handleJustSave = useCallback(() => {
    setSaveMode("just-save");
    if (saveState === "success") {
      // Already saved — show the just-save success line again
      // without re-writing the file (would create a gallery dup).
      setShareStep("saved");
      return;
    }
    void handleSave();
  }, [handleSave, saveState]);

  // Caption pulled from the idea. Falls back to the hook line if
  // no caption was generated, then to an empty string so the
  // copy-buttons remain operable (the user can still post manually).
  const generatedCaption = useMemo(() => {
    if (idea?.caption && idea.caption.trim().length > 0) {
      return idea.caption.trim();
    }
    if (idea?.hook && idea.hook.trim().length > 0) {
      return idea.hook.trim();
    }
    return "";
  }, [idea]);

  const PLATFORM_LABEL: Record<SocialPlatform, string> = {
    tiktok: "TikTok",
    instagram: "Instagram",
    snapchat: "Snapchat",
    copy: "Copy only",
  };

  // App scheme + web fallback per platform. Schemes are public
  // and well-documented; we attempt the app deep-link first and
  // catch silently because Linking.openURL throws if the scheme
  // isn't installed on the device. The web fallback is opened
  // through the browser via Linking.openURL too — on web the
  // first call already lands there.
  const PLATFORM_SCHEME: Record<Exclude<SocialPlatform, "copy">, {
    app: string;
    web: string;
  }> = {
    tiktok: { app: "snssdk1233://", web: "https://www.tiktok.com/upload" },
    instagram: { app: "instagram://library", web: "https://www.instagram.com" },
    snapchat: { app: "snapchat://", web: "https://www.snapchat.com" },
  };

  const flashCopyConfirm = useCallback((msg: string) => {
    setCopyConfirm(msg);
    // 1.6s is long enough to read but short enough to fade
    // before the next interaction lands.
    setTimeout(() => {
      setCopyConfirm((cur) => (cur === msg ? null : cur));
    }, 1600);
  }, []);

  const copyCaption = useCallback(async () => {
    if (!generatedCaption) {
      flashCopyConfirm("No caption to copy yet.");
      return false;
    }
    try {
      await Clipboard.setStringAsync(generatedCaption);
      flashCopyConfirm("Caption copied");
      feedback.tap();
      return true;
    } catch {
      flashCopyConfirm("Couldn't copy — try again.");
      return false;
    }
  }, [generatedCaption, flashCopyConfirm]);

  const handleSelectPlatform = useCallback(
    async (platform: SocialPlatform) => {
      setSelectedPlatform(platform);
      // NOTE: hasInitiatedShare is intentionally NOT set here.
      // The return-loop "Posted? How did it go?" card must only
      // surface when the user has actually launched a platform
      // (deep link or web fallback). Setting the flag on tile
      // selection — including the "Copy only" path, which never
      // leaves the app — would cause false-positive return-loop
      // prompts the next time the user backgrounds the app for
      // any unrelated reason. The flag is set inside
      // openPlatform, AFTER a successful Linking.openURL call.
      // Auto-copy the caption the moment the user picks a target
      // (per spec). For "Copy only" this IS the action; for the
      // app platforms it primes the clipboard so the in-app paste
      // is one tap.
      await copyCaption();
      if (platform === "copy") {
        // No handoff card for copy-only; just confirm and close.
        setShareStep("saved");
        return;
      }
      setShareStep("platform-handoff");
    },
    [copyCaption],
  );

  const openPlatform = useCallback(
    async (platform: Exclude<SocialPlatform, "copy">) => {
      // Always (re)copy first — handoff "Copy & open" implies a
      // fresh clipboard write, even if the user already tapped
      // the platform tile (which also auto-copied).
      const copied = await copyCaption();
      if (!copied) return;
      const { app, web } = PLATFORM_SCHEME[platform];
      try {
        const supported = await Linking.canOpenURL(app);
        if (supported) {
          await Linking.openURL(app);
          // Only mark as "initiated" once we have actually
          // launched the user out of the app. The AppState
          // listener gates the "Posted?" card on this flag, so
          // setting it any earlier would surface the return-loop
          // on unrelated foreground/background cycles.
          setHasInitiatedShare(true);
          return;
        }
      } catch {
        // Fall through to web.
      }
      try {
        await Linking.openURL(web);
        setHasInitiatedShare(true);
      } catch {
        flashCopyConfirm("Couldn't open the app — open it manually.");
      }
    },
    [copyCaption, flashCopyConfirm],
  );

  const dismissPlatformSheet = useCallback(() => {
    // Backdrop tap or close — return to the saved confirmation
    // without losing the success state.
    setShareStep((prev) => (prev === "platform-select" ? "saved" : prev));
  }, []);

  const exitHandoff = useCallback(() => {
    setShareStep("saved");
    setSelectedPlatform(null);
  }, []);

  const handleViewSaved = useCallback(() => {
    router.replace("/(tabs)");
  }, [router]);

  /* ---------- Render --------------------------------------- */

  if (!idea || !clip) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <CosmicBackdrop />
        <View style={[styles.recovery, { paddingTop: insets.top + 80 }]}>
          <Text style={styles.title}>Couldn't open the review.</Text>
          <Text style={styles.sub}>
            Head back to Home and start the create flow again.
          </Text>
          <PrimaryButton label="Back to Home" onPress={handleHome} />
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
        <View style={styles.topBar}>
          <Pressable
            onPress={handleBack}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Feather name="chevron-left" size={26} color="#FFFFFF" />
          </Pressable>
          {/* No top-bar title — the new H1 below ("Your video is
              ready 🎉") carries the screen's identity. A second
              static title up here would compete with the celebration
              and pull attention away from the finish-line moment. */}
          <View style={{ width: 26 }} />
        </View>

        <Animated.View entering={FadeIn.duration(280)} style={styles.stage}>
          {/* Finish-line header — the celebratory pair the user
              should land on. No comparison framing, no analysis
              prompt; the purpose of this screen is to push the
              save+post action, not invite more review. */}
          <Text style={styles.kicker}>Ready to ship</Text>
          <Text style={styles.title}>Your video is ready 🎉</Text>
          <Text style={styles.sub}>Looks good. Now go post it.</Text>

          {/* Final video preview — single full-width frame with a
              centered play affordance and the duration. The actual
              file plays from the user's gallery once saved; this
              pane is a finish-line placeholder, not a media player
              (Lumina has no on-device video module — same precedent
              as the prior AFTER frame). */}
          <VideoReady clip={clip} watermarkOn={watermarkOn} />

          {/* Three short confidence signals — flat, glanceable,
              no scoring. Strings are intentionally generic so this
              row reads identically across every idea (the spec
              wants one tone of voice here, not per-idea analysis). */}
          <ConfidenceStrip />

          {/* Quick boost — keeps the existing 2-action card
              (Smoother flow / Faster hook) with its Fix → Done ✓
              micro-interaction. Renders only when at least one
              action is actually applicable. */}
          <MakeItReadyCard
            idea={idea}
            extraClips={extraClips}
            appliedEnhancements={appliedEnhancements}
            appliedEdits={appliedEdits}
            onAppliedEdits={setAppliedEdits}
          />

          {/* While the user is in the platform handoff sub-flow,
              swap ExportSection out for the handoff card so the
              "Save & Post" affordance doesn't read as redundant
              with the "Copy & open TikTok" CTA two cards down.
              The handoff card carries its own back affordance
              that returns the user to the saved confirmation. */}
          {shareStep === "platform-handoff" && selectedPlatform &&
            selectedPlatform !== "copy" ? (
            <PlatformHandoff
              platform={selectedPlatform}
              platformLabel={PLATFORM_LABEL[selectedPlatform]}
              caption={generatedCaption}
              onCopyCaption={copyCaption}
              onCopyAndOpen={() => openPlatform(selectedPlatform)}
              onBack={exitHandoff}
              copyConfirm={copyConfirm}
            />
          ) : (
            <ExportSection
              saveState={saveState}
              saveMode={saveMode}
              shareStep={shareStep}
              onSaveAgain={handleSaveAgain}
              saveErrorMsg={saveErrorMsg}
              watermarkOn={watermarkOn}
              onToggleWatermark={setWatermarkOn}
              onSavePost={handleSaveAndPost}
              onJustSave={handleJustSave}
              canSave={saveableUris.length > 0}
              clipCount={saveableUris.length}
              copyConfirm={copyConfirm}
            />
          )}

          {/* Return-loop card — replaces the always-visible
              secondary text buttons once the user has come back
              from a platform deep-link. The "Posted? How did
              it go?" prompt carries its own next-step CTAs so
              we hide the text buttons to avoid duplication. */}
          {shareStep === "returned" ? (
            <ReturnLoop
              onMakeAnother={handleMakeAnother}
              onBackToIdeas={handleHome}
              onViewSaved={handleViewSaved}
            />
          ) : (
            <>
              {/* Secondary actions — always visible (no save-state
                  gate). The spec wants these to read as low-emphasis
                  follow-ups whether or not the user has tapped Save &
                  Post yet, so the next step is one tap away even
                  before they've saved. */}
              <TextButton
                label="Make another version"
                onPress={handleMakeAnother}
              />
              <TextButton label="Back to ideas" onPress={handleHome} />
            </>
          )}
        </Animated.View>
      </ScrollView>
      {/* Confetti is rendered as a sibling of the ScrollView so
          it overlays the entire screen rather than just the
          success block — feels like a real celebration. It's
          unmounted the moment we leave the success state, so
          there's no animation lifecycle to manage. */}
      {saveState === "success" ? <Confetti /> : null}
      {/* Viral feedback-loop whisper: a single ephemeral line
          that lands the moment a save succeeds. Reinforces
          "the app learns from what you ship" without blocking
          the celebration UI (Confetti + the success block in
          ExportSection). The toast owns its auto-dismiss. */}
      <InlineToast
        message={exportToast}
        onHide={() => setExportToast(null)}
      />
      {/* Platform sheet — opens automatically the moment a
          "Save & Post" tap succeeds, dismissable by backdrop
          tap or close button. Renders nothing when shareStep
          is not "platform-select". */}
      <PlatformSheet
        visible={shareStep === "platform-select"}
        onSelect={handleSelectPlatform}
        onDismiss={dismissPlatformSheet}
        labels={PLATFORM_LABEL}
      />
    </View>
  );
}

/* =================== Before / After =================== */

function BeforeAfter({
  match,
  clip,
  extraClips,
  idea,
  watermarkOn,
  appliedHookOverride,
  appliedEdits,
}: {
  match: PastMatch;
  clip: FilmedClip;
  // 0 or 1 entries — Phase 1 caps at 2 total clips. Surfaced as
  // a small "+1 more clip" hint under the AFTER footer so the
  // user can see at a glance both clips are along for the ride.
  // No timeline, no thumbnails, no order labels — just a count.
  extraClips: FilmedClip[];
  idea: IdeaCardData;
  watermarkOn: boolean;
  // Optional hook override fed by EnhancementCard's "Apply" — when
  // present, the AFTER frame renders this in place of `idea.hook`
  // so the preview reflects the user's just-applied improvement
  // without us mutating the underlying idea object.
  appliedHookOverride?: string;
  // Edit-intent overlay fed by MakeItReadyCard's "Apply". When the
  // user applies stitch_clips, the extras "+1 more clip" chip flips
  // to "stitched · 2 → 1". When trim_start is applied, an extra
  // "trimmed first 1.0s" chip renders below the clip footer. No
  // actual video mutation happens — see comment on appliedEdits in
  // the parent for why this is intent-only.
  appliedEdits?: {
    stitched: boolean;
    trimStartSec?: number;
  };
}) {
  const past = match.video;
  const extras = extraClips.length;
  return (
    <View style={styles.compareRow}>
      <View style={styles.compareCol}>
        <Text style={styles.compareLabel}>Before</Text>
        <View style={styles.frameBefore}>
          <View style={styles.frameBeforeBody}>
            <Text style={styles.frameBeforeHint}>your earlier upload</Text>
            {/* Surface WHY this past video was picked so the
                comparison doesn't feel arbitrary. The label
                comes from the tiered selector — topic > length
                > recent. */}
            <Text style={styles.matchReason}>
              {matchReasonLabel(match.reason)}
            </Text>
          </View>
          <View style={styles.frameFooter}>
            <Feather name="film" size={12} color="rgba(255,255,255,0.5)" />
            <Text style={styles.frameClip} numberOfLines={1}>
              {past.filename ?? "untitled.mp4"}
              {typeof past.durationSec === "number"
                ? ` · ${past.durationSec}s`
                : ""}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.compareCol}>
        <Text style={[styles.compareLabel, styles.compareLabelAfter]}>
          After
        </Text>
        <View style={styles.frameAfter}>
          <View style={styles.frameAfterHeader}>
            <View style={styles.framePill}>
              <Text style={styles.framePillText}>HOOK</Text>
            </View>
          </View>
          <View style={styles.frameAfterBody}>
            <Text style={styles.frameAfterHook} numberOfLines={4}>
              {appliedHookOverride ?? idea.hook}
            </Text>
          </View>
          <View style={styles.frameFooter}>
            <Feather name="film" size={12} color="rgba(255,255,255,0.55)" />
            <Text style={styles.frameClip} numberOfLines={1}>
              {clip.filename}
              {typeof clip.durationSec === "number"
                ? ` · ${clip.durationSec}s`
                : ""}
            </Text>
          </View>
          {extras > 0 ? (
            // When the user has applied stitch_clips, the chip
            // flips from the count-of-extras read ("+1 more clip")
            // to a confirmation read ("stitched · 2 clips → 1") so
            // the change is visible the instant they tap Apply.
            <Text
              style={[
                styles.frameExtra,
                appliedEdits?.stitched ? styles.frameExtraApplied : null,
              ]}
            >
              {appliedEdits?.stitched
                ? `stitched · ${extras + 1} clips → 1`
                : `+${extras} more clip${extras > 1 ? "s" : ""}`}
            </Text>
          ) : null}
          {/* Trim chip — only renders when the user has applied
              trim_start. Sits under the extras row so stitched +
              trimmed can stack visually without crowding. */}
          {typeof appliedEdits?.trimStartSec === "number" ? (
            <Text style={[styles.frameExtra, styles.frameExtraApplied]}>
              trimmed first {appliedEdits.trimStartSec.toFixed(1)}s
            </Text>
          ) : null}
          {/* Watermark badge — when on, overlays the AFTER pane
              so the user sees what "Made with Lumina" looks
              like in context. The saved video file is NOT
              currently watermarked — burn-in needs ffmpeg in
              a custom dev client (see ExportSection + the
              header doc comment for the constraint). */}
          {watermarkOn ? (
            <View style={styles.watermarkBadge} pointerEvents="none">
              <Text style={styles.watermarkBadgeText}>Made with Lumina</Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/* =================== Export =================== */

function ExportSection({
  saveState,
  saveMode,
  shareStep,
  saveErrorMsg,
  watermarkOn,
  onToggleWatermark,
  onSavePost,
  onJustSave,
  onSaveAgain,
  canSave,
  copyConfirm,
}: {
  saveState: "idle" | "saving" | "success" | "error";
  // Which intent the user expressed on their last primary tap.
  // "share" → drives the "Saved ✓ / Ready to post" success block
  // and the auto-opened platform sheet; "just-save" → quieter
  // "Saved ✓ / Post it later — it's ready" line.
  saveMode: "share" | "just-save";
  // Where the post-flow state machine sits. Used here to keep
  // the success block visible across "saved" → "platform-select"
  // → "saved" transitions without the card collapsing back to
  // the idle CTA when the user dismisses the sheet.
  shareStep:
    | "idle"
    | "saved"
    | "platform-select"
    | "platform-handoff"
    | "returned";
  saveErrorMsg: string | null;
  watermarkOn: boolean;
  onToggleWatermark: (next: boolean) => void;
  // Primary CTA — "Save & Post". On success this flips to a
  // re-trigger of the platform-select sheet rather than a
  // "Save again" button, because the spec wants the post-flow
  // CTA to be the dominant one even after a save.
  onSavePost: () => void;
  // Secondary CTA — "Just save". Same write path, no platform
  // sheet auto-open. Renders as a low-emphasis text button below
  // the primary so it doesn't compete for attention.
  onJustSave: () => void;
  // Re-save handler reserved for the error-retry path. Clears
  // the dedupe ref before re-running handleSave so the second
  // tap actually writes a fresh copy (vs the partial-failure
  // retry, which intentionally skips already-saved URIs).
  onSaveAgain: () => void;
  // Still tracked: when the gallery isn't writable (web preview
  // or a clip with no local URI), the primary button stays
  // visible but disables the tap path. We deliberately do NOT
  // surface a "phone only" notice — the spec is firm on no
  // technical warnings on this screen.
  canSave: boolean;
  // Reserved for future analytics hooks; the saving copy is now
  // singular per the friction-free spec.
  clipCount: number;
  // Short-lived inline confirmation line ("Caption copied" /
  // "Couldn't open the app — open it manually") shown when the
  // user picks "Copy only" from the platform sheet and we land
  // back on the saved confirmation card.
  copyConfirm: string | null;
}) {
  const ctaDisabled = !canSave || saveState === "saving";
  // The success block stays visible across the full post-flow,
  // not just at the moment of save. Once the user has hit
  // "Save & Post" successfully, we keep the success card up so
  // re-opening the platform sheet (via the primary CTA) doesn't
  // briefly flash the idle state.
  const showSuccess = saveState === "success";
  return (
    <View style={styles.exportCard}>
      {/* Watermark toggle is always visible (idle / saving /
          success / error) — the spec wants this as a single,
          friction-free row that the user can flip at any time.
          The label + sub copy frame it as support, not a
          configuration toggle. */}
      <View style={styles.watermarkRow}>
        <View style={styles.watermarkLabelCol}>
          <Text style={styles.watermarkLabel}>Add &ldquo;Made with Lumina&rdquo;</Text>
          <Text style={styles.watermarkHint}>
            Support Lumina and get inspired ✨
          </Text>
        </View>
        <Switch
          value={watermarkOn}
          onValueChange={onToggleWatermark}
          trackColor={{
            false: "rgba(255,255,255,0.15)",
            true: lumina.firefly,
          }}
          thumbColor="#FFFFFF"
          ios_backgroundColor="rgba(255,255,255,0.15)"
          disabled={saveState === "saving"}
          accessibilityRole="switch"
          accessibilityLabel="Add Made with Lumina watermark"
          accessibilityState={{ checked: watermarkOn }}
        />
      </View>

      {/* Primary "Save & Post" CTA. In idle/error it triggers a
          fresh save in share mode (auto-opens platform sheet on
          success). In success state it re-opens the platform
          sheet without re-saving — the user already has the
          file, they just want the share path again. */}
      {saveState !== "saving" ? (
        <Pressable
          onPress={
            saveState === "error" ? onSaveAgain : onSavePost
          }
          disabled={ctaDisabled && saveState !== "success"}
          style={({ pressed }) => [
            styles.primary,
            pressed && !(ctaDisabled && saveState !== "success")
              ? styles.primaryPressed
              : null,
            ctaDisabled && saveState !== "success"
              ? styles.primaryDisabled
              : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel={
            saveState === "error" ? "Try saving again" : "Save and post"
          }
          testID="save-and-post"
        >
          <Text style={styles.primaryLabel}>
            {saveState === "error" ? "Try again" : "Save & Post"}
          </Text>
          <Text style={styles.primarySub}>
            Save to gallery and post anywhere
          </Text>
        </Pressable>
      ) : null}

      {/* "Just save" secondary — low-emphasis text button
          directly below the primary CTA. Save-only path; no
          platform sheet auto-open. Hidden in saving and after
          a successful share-mode save (the success block plus
          the platform sheet carry the next step there). */}
      {saveState !== "saving" && !(showSuccess && saveMode === "share") ? (
        <Pressable
          onPress={onJustSave}
          disabled={ctaDisabled && saveState !== "success"}
          style={({ pressed }) => [
            styles.justSave,
            pressed ? styles.justSavePressed : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Just save"
          testID="just-save"
        >
          <Text style={styles.justSaveLabel}>Just save</Text>
        </Pressable>
      ) : null}

      {saveState === "saving" ? (
        <View style={styles.savingBox}>
          <ActivityIndicator color={lumina.firefly} />
          {/* Spec: minimal copy in the in-flight state — the
              spinner + one short word is the entire signal. */}
          <Text style={styles.savingText}>Saving…</Text>
        </View>
      ) : null}

      {showSuccess && saveMode === "share" ? (
        // Save & Post success block. Three quick lines + check
        // mark — the celebratory beat the user lands on between
        // the save completing and the platform sheet auto-
        // opening. Renders unconditionally for the share path
        // (we don't gate on shareStep so the block stays put if
        // the user dismisses the sheet and comes back).
        <Animated.View
          entering={FadeIn.duration(180)}
          style={styles.savedBlock}
          testID="saved-block-share"
        >
          <View style={styles.savedCheckRow}>
            <Feather name="check-circle" size={18} color={lumina.firefly} />
            <Text style={styles.savedTitle}>Saved ✓</Text>
          </View>
          <Text style={styles.savedLine}>Ready to post</Text>
          <Text style={styles.savedSub}>Takes ~10 seconds</Text>
        </Animated.View>
      ) : null}

      {showSuccess && saveMode === "just-save" ? (
        // Just-save success line — quieter; the user explicitly
        // said "I'll post later", so the page does not auto-
        // advance and the copy reassures rather than nudges.
        <Animated.View
          entering={FadeIn.duration(180)}
          style={styles.savedBlock}
          testID="saved-block-just-save"
        >
          <View style={styles.savedCheckRow}>
            <Feather name="check-circle" size={18} color={lumina.firefly} />
            <Text style={styles.savedTitle}>Saved ✓</Text>
          </View>
          <Text style={styles.savedLine}>Post it later — it&rsquo;s ready</Text>
        </Animated.View>
      ) : null}

      {/* Inline confirmation slot ("Caption copied" / "Couldn't
          open the app") — shown briefly when the user picks
          Copy only or returns from the handoff card. Auto-
          dismisses via the parent's flashCopyConfirm timer. */}
      {copyConfirm ? (
        <Animated.View
          entering={FadeIn.duration(140)}
          exiting={FadeOut.duration(140)}
          style={styles.copyConfirmRow}
          testID="copy-confirm"
        >
          <Feather name="clipboard" size={14} color={lumina.firefly} />
          <Text style={styles.copyConfirmText}>{copyConfirm}</Text>
        </Animated.View>
      ) : null}

      {saveState === "error" && saveErrorMsg ? (
        <Text style={styles.exportError}>{saveErrorMsg}</Text>
      ) : null}
    </View>
  );
}

/* =================== Platform sheet =================== */

/**
 * Bottom-sheet modal that opens automatically the moment a
 * "Save & Post" tap succeeds. Title plus four large tap targets
 * — TikTok, Instagram, Snapchat, Copy only. Backdrop tap or the
 * close affordance returns the user to the saved confirmation
 * card without losing the success state.
 *
 * Renders as a transparent React Native Modal anchored to the
 * bottom of the viewport (animationType="slide"). The native
 * sheet behaviour gives us free swipe-to-dismiss on iOS while
 * keeping the implementation framework-agnostic enough to work
 * on web (where it lays out as a centered card).
 */
function PlatformSheet({
  visible,
  onSelect,
  onDismiss,
  labels,
}: {
  visible: boolean;
  onSelect: (platform: "tiktok" | "instagram" | "snapchat" | "copy") => void;
  onDismiss: () => void;
  labels: Record<"tiktok" | "instagram" | "snapchat" | "copy", string>;
}) {
  type Tile = {
    key: "tiktok" | "instagram" | "snapchat" | "copy";
    icon: keyof typeof Feather.glyphMap;
    accent: string;
  };
  const tiles: Tile[] = [
    { key: "tiktok", icon: "music", accent: "#FE2C55" },
    { key: "instagram", icon: "camera", accent: "#E1306C" },
    { key: "snapchat", icon: "send", accent: "#FFFC00" },
    { key: "copy", icon: "copy", accent: lumina.firefly },
  ];
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
    >
      {/* Outer container is a plain View — NOT a Pressable — so
          the inner platform tiles and close button (which ARE
          Pressables with button role) do not nest inside another
          interactive element on web. React Native Web maps a
          Pressable with onPress to <div role="button">, and
          nesting buttons triggers a hydration warning. The
          backdrop dismiss is handled by the absolute-positioned
          Pressable below, which sits BEHIND the sheet card and
          covers only the area outside it. */}
      <View style={styles.sheetBackdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onDismiss}
          accessibilityLabel="Close platform sheet"
          testID="platform-sheet-backdrop"
        />
        <View style={styles.sheetCard} testID="platform-sheet">
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Post to</Text>
            <Pressable
              onPress={onDismiss}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
              testID="platform-sheet-close"
            >
              <Feather name="x" size={22} color="rgba(255,255,255,0.7)" />
            </Pressable>
          </View>
          <View style={styles.sheetTiles}>
            {tiles.map((tile) => (
              <Pressable
                key={tile.key}
                onPress={() => onSelect(tile.key)}
                style={({ pressed }) => [
                  styles.sheetTile,
                  pressed ? styles.sheetTilePressed : null,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Post to ${labels[tile.key]}`}
                testID={`platform-${tile.key}`}
              >
                <View
                  style={[
                    styles.sheetTileIconCircle,
                    { backgroundColor: tile.accent + "1F" },
                  ]}
                >
                  <Feather
                    name={tile.icon}
                    size={22}
                    color={tile.accent}
                  />
                </View>
                <Text style={styles.sheetTileLabel}>{labels[tile.key]}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* =================== Platform handoff =================== */

/**
 * Inline handoff card that replaces ExportSection while the user
 * is mid post-flow for a specific platform. Three regions:
 *   1. "Almost there!" + 2-step instructions ("Tap +", "Upload
 *      your video") — orienting copy so the user knows what the
 *      next two taps inside the platform app will be.
 *   2. Caption block — surfaces the generated caption verbatim
 *      with a small "ready" affordance. The text is selectable
 *      so the user can manually copy a slice if they want.
 *   3. Two CTAs — Copy caption, and Copy & open {Platform}.
 *      The latter is the primary; tapping it copies + tries the
 *      platform's app deep link, falling back to a web URL.
 */
function PlatformHandoff({
  platform,
  platformLabel,
  caption,
  onCopyCaption,
  onCopyAndOpen,
  onBack,
  copyConfirm,
}: {
  platform: "tiktok" | "instagram" | "snapchat";
  platformLabel: string;
  caption: string;
  onCopyCaption: () => Promise<boolean> | void;
  onCopyAndOpen: () => Promise<void> | void;
  onBack: () => void;
  copyConfirm: string | null;
}) {
  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      style={styles.handoffCard}
      testID="platform-handoff"
    >
      <View style={styles.handoffHeader}>
        <Pressable
          onPress={onBack}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back to saved confirmation"
          testID="handoff-back"
        >
          <Feather name="chevron-left" size={22} color="#FFFFFF" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.handoffTitle}>Almost there!</Text>
          <Text style={styles.handoffSub}>Just 2 quick steps</Text>
        </View>
      </View>

      <View style={styles.handoffSteps}>
        <View style={styles.handoffStepRow}>
          <View style={styles.handoffStepBadge}>
            <Text style={styles.handoffStepBadgeText}>1</Text>
          </View>
          <Text style={styles.handoffStepText}>
            Tap &ldquo;+&rdquo;
          </Text>
        </View>
        <View style={styles.handoffStepRow}>
          <View style={styles.handoffStepBadge}>
            <Text style={styles.handoffStepBadgeText}>2</Text>
          </View>
          <Text style={styles.handoffStepText}>Upload your video</Text>
        </View>
      </View>

      <View style={styles.handoffCaptionBlock}>
        <Text style={styles.handoffCaptionTitle}>Your caption is ready</Text>
        {caption.length > 0 ? (
          <Text
            style={styles.handoffCaptionText}
            selectable
            testID="handoff-caption"
          >
            {caption}
          </Text>
        ) : (
          <Text style={styles.handoffCaptionEmpty}>
            No caption was generated for this idea — you can write
            one once you&rsquo;re inside the app.
          </Text>
        )}
      </View>

      <View style={styles.handoffActions}>
        <Pressable
          onPress={() => {
            void onCopyCaption();
          }}
          style={({ pressed }) => [
            styles.handoffSecondary,
            pressed ? styles.handoffSecondaryPressed : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Copy caption"
          testID="copy-caption"
        >
          <Feather name="clipboard" size={16} color={lumina.firefly} />
          <Text style={styles.handoffSecondaryLabel}>Copy caption</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            void onCopyAndOpen();
          }}
          style={({ pressed }) => [
            styles.handoffPrimary,
            pressed ? styles.handoffPrimaryPressed : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Copy and open ${platformLabel}`}
          testID="copy-and-open"
        >
          <Text style={styles.handoffPrimaryLabel}>
            Copy &amp; open {platformLabel}
          </Text>
          <Feather name="external-link" size={16} color="#0F0820" />
        </Pressable>
      </View>

      {copyConfirm ? (
        <Animated.View
          entering={FadeIn.duration(140)}
          exiting={FadeOut.duration(140)}
          style={styles.copyConfirmRow}
          testID="handoff-copy-confirm"
        >
          <Feather name="clipboard" size={14} color={lumina.firefly} />
          <Text style={styles.copyConfirmText}>{copyConfirm}</Text>
        </Animated.View>
      ) : null}

      {/* Tiny platform-stamp footer so the user has a visual
          reminder of the target while they're walking through
          the steps. Renders the same Feather icon used in the
          sheet for consistency. */}
      <View style={styles.handoffFooter}>
        <Feather
          name={
            platform === "tiktok"
              ? "music"
              : platform === "instagram"
                ? "camera"
                : "send"
          }
          size={12}
          color="rgba(255,255,255,0.5)"
        />
        <Text style={styles.handoffFooterText}>{platformLabel}</Text>
      </View>
    </Animated.View>
  );
}

/* =================== Return loop =================== */

/**
 * "Posted? How did it go?" prompt rendered when the user comes
 * back to /review after deep-linking out to a platform. Replaces
 * the always-visible secondary text buttons so the next-step
 * CTAs read as a coherent set rather than a stack of duplicates.
 */
function ReturnLoop({
  onMakeAnother,
  onBackToIdeas,
  onViewSaved,
}: {
  onMakeAnother: () => void;
  onBackToIdeas: () => void;
  onViewSaved: () => void;
}) {
  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      style={styles.returnCard}
      testID="return-loop"
    >
      <Text style={styles.returnTitle}>Posted?</Text>
      <Text style={styles.returnSub}>How did it go?</Text>
      <Pressable
        onPress={onMakeAnother}
        style={({ pressed }) => [
          styles.returnPrimary,
          pressed ? styles.returnPrimaryPressed : null,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Make another version"
        testID="return-make-another"
      >
        <Text style={styles.returnPrimaryLabel}>Make another version</Text>
      </Pressable>
      <Pressable
        onPress={onBackToIdeas}
        style={({ pressed }) => [
          styles.returnSecondary,
          pressed ? styles.returnSecondaryPressed : null,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Back to ideas"
        testID="return-back-to-ideas"
      >
        <Text style={styles.returnSecondaryLabel}>Back to ideas</Text>
      </Pressable>
      <Pressable
        onPress={onViewSaved}
        style={({ pressed }) => [
          styles.returnTertiary,
          pressed ? styles.returnTertiaryPressed : null,
        ]}
        accessibilityRole="button"
        accessibilityLabel="View saved videos"
        testID="return-view-saved"
      >
        <Text style={styles.returnTertiaryLabel}>View saved videos</Text>
      </Pressable>
    </Animated.View>
  );
}

/* =================== Video Ready (final preview) =================== */

/**
 * Final-video preview card. Replaces the old BEFORE/AFTER
 * comparison with a single full-width frame: filename / duration
 * footer, a centered play affordance, and an optional watermark
 * badge that mirrors the user's toggle state.
 *
 * No on-device playback — Lumina has no video module wired in
 * (same precedent as the prior AFTER pane, which was also a
 * stylized View, not a player). The real playback surface is the
 * saved gallery file. The play button reads as "your video is
 * ready" not "tap to play here", and we keep it non-interactive
 * to avoid a dead tap.
 */
function VideoReady({
  clip,
  watermarkOn,
}: {
  clip: FilmedClip;
  watermarkOn: boolean;
}) {
  const totalLabel =
    typeof clip.durationSec === "number"
      ? formatDuration(clip.durationSec)
      : "00:00";
  return (
    <View style={styles.vidReady} testID="video-ready">
      <View style={styles.vidReadyBody}>
        <View style={styles.vidPlayCircle} pointerEvents="none">
          <Feather name="play" size={28} color="#0A0824" />
        </View>
        <Text style={styles.vidDuration}>00:00 / {totalLabel}</Text>
      </View>
      <View style={styles.vidFooter}>
        <Feather name="film" size={12} color="rgba(255,255,255,0.55)" />
        <Text style={styles.vidFooterText} numberOfLines={1}>
          {clip.filename}
        </Text>
      </View>
      {watermarkOn ? (
        <View style={styles.watermarkBadge} pointerEvents="none">
          <Text style={styles.watermarkBadgeText}>Made with Lumina</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Format seconds as MM:SS. Defensive on negative / NaN inputs
 * (returns "00:00") so a malformed clip durationSec never paints
 * "NaN:NaN" into the celebration moment.
 */
function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/* =================== Confidence Strip =================== */

/**
 * Three short, generic confidence signals — one row, no scoring,
 * no per-idea variance. The spec wants this to read identically
 * across every idea, so the strings are literal here (not derived
 * from the idea object). Icons stay quiet (firefly tint, small)
 * so the row reads as a glance, not a checklist to scan.
 */
function ConfidenceStrip() {
  const items: { icon: keyof typeof Feather.glyphMap; label: string }[] = [
    { icon: "zap", label: "Hook hits immediately" },
    { icon: "smile", label: "Clear reaction moment" },
    { icon: "eye", label: "Easy to watch and relatable" },
  ];
  return (
    <View style={styles.confidenceStrip} testID="confidence-strip">
      {items.map((item) => (
        <View key={item.label} style={styles.confidenceItem}>
          <Feather name={item.icon} size={14} color={lumina.firefly} />
          <Text style={styles.confidenceText} numberOfLines={2}>
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/* =================== Why-Better card =================== */

function WhyBetterCard({ idea }: { idea: IdeaCardData }) {
  // Derive a small list of "directional" signals straight from
  // the idea fields. Order matters — strongest evidence first.
  // None of this is a real performance prediction; it's why
  // the new take is *built* to land harder than a generic
  // upload of similar length. Fields used here are the ones
  // the ideator currently returns (see IdeaCardData); when
  // the schema grows (e.g. hasContrast, hasVisualAction) this
  // list grows with it.
  const signals: string[] = [];
  if (typeof idea.hookSeconds === "number") {
    signals.push(
      `Hook lands in ${idea.hookSeconds}s — built to grab the scroll early.`,
    );
  }
  if (idea.visualHook) {
    signals.push(`Has a visual hook — ${idea.visualHook}`);
  }
  if (idea.payoffType) {
    signals.push(`Built around a clear ${idea.payoffType} payoff.`);
  }
  if (typeof idea.videoLengthSec === "number") {
    signals.push(
      `Trimmed to ${idea.videoLengthSec}s — won't overstay its welcome.`,
    );
  }

  const hasAnything = signals.length > 0 || idea.whyItWorks;

  if (!hasAnything) {
    // Still render the card frame so the layout is consistent —
    // just with a soft fallback line. Better than the card
    // disappearing entirely on a sparse idea payload.
    return (
      <View style={styles.whyCard}>
        <Text style={styles.whyKicker}>Why this should perform better</Text>
        <Text style={styles.whyFallback}>
          Built around your style profile and your region's trends.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.whyCard}>
      <Text style={styles.whyKicker}>Why this should perform better</Text>
      <Text style={styles.whyDirectional}>
        Directional, not predictive — these are reasons it's built to
        land harder than a generic upload of the same length.
      </Text>

      {signals.length > 0 ? (
        <View style={styles.whyList}>
          {signals.map((s) => (
            <View key={s} style={styles.whyRow}>
              <Feather
                name="check"
                size={14}
                color={lumina.firefly}
                style={styles.whyCheck}
              />
              <Text style={styles.whyRowText}>{s}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {idea.whyItWorks ? (
        <Text style={styles.whyFooter}>{idea.whyItWorks}</Text>
      ) : null}
    </View>
  );
}

/* =================== Enhancement Brain ============ */

/**
 * EnhancementCard — quiet "make this hit harder" CTA that lazily
 * asks the server's enhancement brain for 1-3 high-impact, non-
 * technical suggestions on the user's filmed take.
 *
 * Lazy by design: we do NOT fetch on mount. Suggestions cost an
 * AI call and most users will save-and-go without ever asking. The
 * card sits in the post-review flow as an opt-in nudge — when the
 * user taps the CTA, we fire one POST and render the result.
 *
 * State machine: idle → loading → loaded | error. Retrying from
 * the error state rolls back to loading. Result is held in local
 * state and survives subsequent re-renders of the parent (we don't
 * re-fetch on prop changes — the card is keyed implicitly by the
 * parent screen, which is itself keyed by the idea via params).
 *
 * The /api/enhancements/suggest endpoint returns
 * { title: string, suggestions: string[1..3] }. The brain enforces
 * the no-editing-UI / 1-sentence / max-3 contract server-side, so
 * this component just renders what it gets.
 */
type SuggestionType = "caption" | "hook" | "start_hint" | "manual";
type Suggestion = {
  id: string;
  type: SuggestionType;
  text: string;
  applyValue?: string;
};
type AppliedEnhancements = {
  caption?: string;
  hook?: string;
  startHint?: string;
  appliedSuggestionIds: string[];
};

function EnhancementCard({
  idea,
  applied,
  onApplied,
}: {
  idea: IdeaCardData;
  applied: AppliedEnhancements;
  onApplied: React.Dispatch<React.SetStateAction<AppliedEnhancements>>;
}) {
  type Phase = "idle" | "loading" | "loaded" | "error";
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<{
    title: string;
    suggestions: Suggestion[];
  } | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  // Tiny reassurance line shown right after any successful Apply.
  // We auto-clear after a short window so it reads as a one-shot
  // confirmation rather than a permanent banner. Spec copy is
  // intentionally measured ("Nice — that's sharper.") so it doesn't
  // over-celebrate a 1-tap action.
  const [reassurance, setReassurance] = useState<string | null>(null);
  const reassureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Defensive single-flight — a rapid double-tap on the CTA could
  // otherwise issue two concurrent POSTs and double-bill the
  // creator's AI cost cap. The ref short-circuits the second tap
  // until the in-flight request resolves either way.
  const inFlightRef = useRef(false);

  // Synchronous double-fire guard for Apply. Reading
  // `applied.appliedSuggestionIds` from props is too late — props
  // only update after React commits, so two taps in the same frame
  // both pass that check and both fire the signal. This ref is
  // updated synchronously inside handleApply so the second tap
  // sees the id immediately and bails.
  const appliedIdsRef = useRef<Set<string>>(new Set());

  // Clean up the reassurance timer on unmount so a navigation-away
  // mid-fade doesn't fire setState on a stale instance.
  useEffect(() => {
    return () => {
      if (reassureTimerRef.current) {
        clearTimeout(reassureTimerRef.current);
        reassureTimerRef.current = null;
      }
    };
  }, []);

  const fetchEnhancements = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setPhase("loading");
    setErrMsg(null);
    try {
      const data = await customFetch<{
        title: string;
        suggestions: unknown;
      }>("/api/enhancements/suggest", {
        method: "POST",
        body: JSON.stringify({
          originalIdea: {
            hook: idea.hook,
            // Concept is a synthesis of the structured idea fields
            // we already have on the client — gives the brain
            // enough to infer intent without us having to type
            // anything new on the user's behalf.
            concept: [idea.whatToShow, idea.howToFilm, idea.whyItWorks]
              .filter((s): s is string => typeof s === "string" && s.length > 0)
              .join(" — ") || undefined,
            pattern: idea.pattern,
            structure: idea.structure,
            hookStyle: idea.hookStyle,
            emotionalSpike: idea.emotionalSpike,
          },
        }),
        responseType: "json",
      });
      // Normalise the response into our internal Suggestion shape.
      // The server now returns objects { id, type, text, applyValue? }
      // (Suggestion-Apply spec); we still defensively accept legacy
      // string entries from any cached client/proxy and downgrade
      // them to type=manual so the card never breaks on shape drift.
      const rawList = Array.isArray(data?.suggestions) ? data!.suggestions : [];
      const suggestions: Suggestion[] = [];
      for (let i = 0; i < rawList.length && suggestions.length < 3; i++) {
        const r = rawList[i];
        if (typeof r === "string" && r.trim().length > 0) {
          suggestions.push({
            id: `s${i + 1}`,
            type: "manual",
            text: r.trim(),
          });
          continue;
        }
        if (r && typeof r === "object") {
          const o = r as {
            id?: unknown;
            type?: unknown;
            text?: unknown;
            applyValue?: unknown;
          };
          const text = typeof o.text === "string" ? o.text.trim() : "";
          if (text.length === 0) continue;
          const t: SuggestionType =
            o.type === "caption" ||
            o.type === "hook" ||
            o.type === "start_hint" ||
            o.type === "manual"
              ? o.type
              : "manual";
          const id =
            typeof o.id === "string" && o.id.length > 0 ? o.id : `s${i + 1}`;
          const applyValue =
            t !== "manual" &&
            typeof o.applyValue === "string" &&
            o.applyValue.trim().length > 0
              ? o.applyValue.trim()
              : undefined;
          // Apply types missing a value can't be applied cleanly —
          // downgrade to manual so the UI shows "Try this" instead
          // of an Apply button that would do nothing.
          suggestions.push({
            id,
            type: applyValue || t === "manual" ? t : "manual",
            text,
            applyValue,
          });
        }
      }
      if (
        data &&
        typeof data.title === "string" &&
        suggestions.length > 0
      ) {
        setResult({ title: data.title, suggestions });
        setPhase("loaded");
      } else {
        setErrMsg("No suggestions came back. Try again in a moment.");
        setPhase("error");
      }
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? (err.message ?? "Couldn't load suggestions.")
          : err instanceof Error && err.message
            ? err.message
            : "Couldn't load suggestions.";
      setErrMsg(msg);
      setPhase("error");
    } finally {
      inFlightRef.current = false;
    }
  }, [idea]);

  // Apply handler — local-state mutation + fire-and-forget signal.
  // Idempotent on suggestion id: a second tap is a no-op (the
  // button has already flipped to "Applied" but a stale press
  // event slipping through must not double-fire the signal or
  // reset the reassurance timer). The synchronous ref-based guard
  // is what actually makes that hold under double-tap — checking
  // props/state alone is racy because both taps run before React
  // re-commits with the updated id list.
  const handleApply = useCallback(
    (s: Suggestion) => {
      if (s.type === "manual" || !s.applyValue) return;
      // Synchronous guard — must run BEFORE any side effect.
      if (appliedIdsRef.current.has(s.id)) return;
      appliedIdsRef.current.add(s.id);

      onApplied((prev) => {
        // Functional update so concurrent applies (unlikely but
        // possible if the user double-taps two suggestions back
        // to back) compose without dropping state.
        const next: AppliedEnhancements = {
          ...prev,
          appliedSuggestionIds: prev.appliedSuggestionIds.includes(s.id)
            ? prev.appliedSuggestionIds
            : [...prev.appliedSuggestionIds, s.id],
        };
        if (s.type === "caption") next.caption = s.applyValue;
        else if (s.type === "hook") next.hook = s.applyValue;
        else if (s.type === "start_hint") next.startHint = s.applyValue;
        return next;
      });

      // Positive but lighter-than-export signal. Server enum +
      // weight live in api-server/src/lib/viralPatternMemory.ts
      // (`applied_enhancement` = +1). Forward all four pattern
      // tags so the memory aggregator can credit the right
      // structure/hookStyle/spike/format buckets, plus the
      // suggestionType so future attribution can split applies by
      // caption/hook/start_hint without re-deploying.
      if (idea?.hook) {
        submitIdeatorSignal({
          ideaHook: idea.hook,
          signalType: "applied_enhancement",
          ideaPattern: idea.pattern,
          emotionalSpike: idea.emotionalSpike,
          payoffType: idea.payoffType,
          structure: idea.structure,
          hookStyle: idea.hookStyle,
          // Narrow to the apply-able subset — TS narrowing on
          // s.type=manual was already returned-out above.
          suggestionType: s.type as "caption" | "hook" | "start_hint",
        });
      }

      // Show the spec-mandated reassurance line and auto-clear.
      // Reset any pending timer so back-to-back applies extend
      // the visible window instead of cutting it short.
      setReassurance("Nice — that's sharper.");
      if (reassureTimerRef.current) clearTimeout(reassureTimerRef.current);
      reassureTimerRef.current = setTimeout(() => {
        setReassurance(null);
        reassureTimerRef.current = null;
      }, 2400);
    },
    [idea, onApplied],
  );

  // Keep the ref in sync with parent-driven state — covers the case
  // where the parent rehydrates from a higher source (none today,
  // but cheap insurance). Without this, a navigation that resets
  // appliedEnhancements wouldn't clear the ref, and the user would
  // be permanently locked out of re-applying the same id.
  useEffect(() => {
    appliedIdsRef.current = new Set(applied.appliedSuggestionIds);
  }, [applied.appliedSuggestionIds]);

  if (phase === "idle") {
    return (
      <Pressable
        onPress={fetchEnhancements}
        style={({ pressed }) => [
          styles.enhanceCta,
          pressed ? styles.enhanceCtaPressed : null,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Show me how to make this hit harder"
      >
        <Feather
          name="zap"
          size={14}
          color={lumina.firefly}
          style={styles.enhanceCtaIcon}
        />
        <Text style={styles.enhanceCtaLabel}>
          Show me how to make this hit harder
        </Text>
      </Pressable>
    );
  }

  if (phase === "loading") {
    return (
      <View style={styles.enhanceCard}>
        <Text style={styles.enhanceKicker}>Thinking…</Text>
        <View style={styles.enhanceLoadingRow}>
          <ActivityIndicator color={lumina.firefly} />
          <Text style={styles.enhanceLoadingText}>
            Reading your idea against your style and what tends to land for you.
          </Text>
        </View>
      </View>
    );
  }

  if (phase === "error") {
    return (
      <View style={styles.enhanceCard}>
        <Text style={styles.enhanceKicker}>Couldn't load</Text>
        <Text style={styles.enhanceErrorText}>{errMsg}</Text>
        <Pressable
          onPress={fetchEnhancements}
          style={({ pressed }) => [
            styles.enhanceRetryBtn,
            pressed ? styles.enhanceRetryBtnPressed : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Try loading suggestions again"
        >
          <Text style={styles.enhanceRetryLabel}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  // loaded
  // Spec note (Part 2): the card title is hard-coded to
  // "Make it hit harder". We deliberately ignore the brain's
  // returned `result.title` here — the brain's title is still a
  // useful internal signal for prompt-tuning and may be surfaced
  // elsewhere in future, but the user-facing copy stays stable so
  // the surface always reads the same way the spec describes.
  const suggestions = result?.suggestions ?? [];
  const appliedIds = new Set(applied.appliedSuggestionIds);
  return (
    <View style={styles.enhanceCard}>
      <Text style={styles.enhanceKicker}>Make it hit harder</Text>

      {/* Show the user what they've already applied so the change
          feels real even before they scroll back up to the AFTER
          frame. Caption + start-hint surface here because they're
          not visible elsewhere on /review; hook flows into the
          BeforeAfter overlay so we don't echo it twice. */}
      {applied.caption || applied.startHint ? (
        <View style={styles.enhanceAppliedBlock}>
          {applied.caption ? (
            <View style={styles.enhanceAppliedRow}>
              <Text style={styles.enhanceAppliedLabel}>Caption</Text>
              <Text style={styles.enhanceAppliedValue} numberOfLines={3}>
                {applied.caption}
              </Text>
            </View>
          ) : null}
          {applied.startHint ? (
            <View style={styles.enhanceAppliedRow}>
              <Feather
                name="clock"
                size={12}
                color={lumina.firefly}
                style={styles.enhanceAppliedIcon}
              />
              <Text style={styles.enhanceAppliedValue}>
                Start around {applied.startHint}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.enhanceList}>
        {suggestions.map((s) => {
          const isApplied = appliedIds.has(s.id);
          // Apply is gated on type + a clean apply value. Anything
          // else gets a passive "Try this" pill (no tap target) per
          // Part 6 of the spec — refilm / hold-shot / make-reaction-
          // bigger style suggestions can't be auto-applied.
          const canApply = s.type !== "manual" && Boolean(s.applyValue);
          return (
            <View key={s.id} style={styles.enhanceRow}>
              <Feather
                name="zap"
                size={14}
                color={lumina.firefly}
                style={styles.enhanceRowIcon}
              />
              <View style={styles.enhanceRowBody}>
                <Text style={styles.enhanceRowText}>{s.text}</Text>
                <View style={styles.enhanceRowActions}>
                  {canApply ? (
                    isApplied ? (
                      // Sticky "Applied" — non-pressable so a stray
                      // tap can't double-fire the signal. Visually
                      // distinct from the live Apply button so the
                      // state change is obvious without copy alone.
                      <View
                        style={[
                          styles.enhanceApplyBtn,
                          styles.enhanceApplyBtnDone,
                        ]}
                        accessible
                        accessibilityRole="text"
                        accessibilityLabel="Applied"
                      >
                        <Feather
                          name="check"
                          size={12}
                          color={lumina.firefly}
                          style={styles.enhanceApplyDoneIcon}
                        />
                        <Text
                          style={[
                            styles.enhanceApplyLabel,
                            styles.enhanceApplyLabelDone,
                          ]}
                        >
                          Applied
                        </Text>
                      </View>
                    ) : (
                      <Pressable
                        onPress={() => handleApply(s)}
                        style={({ pressed }) => [
                          styles.enhanceApplyBtn,
                          pressed ? styles.enhanceApplyBtnPressed : null,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`Apply suggestion: ${s.text}`}
                      >
                        <Text style={styles.enhanceApplyLabel}>Apply</Text>
                      </Pressable>
                    )
                  ) : (
                    <View
                      style={styles.enhanceTryPill}
                      accessible
                      accessibilityRole="text"
                      accessibilityLabel="Try this"
                    >
                      <Text style={styles.enhanceTryPillLabel}>Try this</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          );
        })}
      </View>

      {reassurance ? (
        <Text style={styles.enhanceReassurance}>{reassurance}</Text>
      ) : null}
    </View>
  );
}

/* =================== Make-it-ready (semi-auto edit) =================== */

// SEMI-AUTO EDIT — STITCH + TRIM ONLY.
//
// This card is the ENTIRE surface for the spec's two allowed
// preview-state edit actions:
//   1. stitch_clips — combine clip 1 → clip 2. No transitions,
//                     no effects. Available iff the user uploaded
//                     a second clip.
//   2. trim_start   — lop off the first 0.5–2 seconds of the head
//                     based on a suggested offset. Available iff
//                     the brain (or the idea metadata) hinted that
//                     the hook lands ≥0.5s in.
//
// Hard guard-rails the card MUST honour (spec "DO NOT" list):
//   • no timeline editor / scrubber / thumbnails
//   • no manual trim controls (sliders, time pickers)
//   • no filters, transitions, effects, colour, lighting
// Tap target = ONE Apply button per row. Nothing else.
//
// Action contract on the wire (also the props.params shape):
//   { type: "stitch_clips" | "trim_start", label, params }
// Defined locally — actions are derived deterministically from
// existing state, no server round-trip needed.
type EditActionType = "stitch_clips" | "trim_start";
type EditAction =
  | {
      type: "stitch_clips";
      label: string;
      params: { clipCount: number };
    }
  | {
      type: "trim_start";
      label: string;
      params: { seconds: number };
    };

// Parse a "M:SS" hint (the shape EnhancementCard's start_hint
// suggestions emit) into seconds. Returns undefined for anything
// that doesn't match — callers should fall back to a different
// signal source rather than guess.
function parseStartHintSeconds(hint?: string): number | undefined {
  if (!hint) return undefined;
  const m = hint.trim().match(/^(\d):([0-5]\d)$/);
  if (!m) return undefined;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Clamp the trim window per spec ("0.5–2 seconds"). One decimal
// of precision is plenty for a chip read like "trimmed first 1.0s".
function clampTrimWindow(seconds: number): number {
  if (!Number.isFinite(seconds)) return 0.5;
  const clamped = Math.min(2, Math.max(0.5, seconds));
  return Math.round(clamped * 10) / 10;
}

function MakeItReadyCard({
  idea,
  extraClips,
  appliedEnhancements,
  appliedEdits,
  onAppliedEdits,
}: {
  idea: IdeaCardData;
  extraClips: FilmedClip[];
  appliedEnhancements: {
    caption?: string;
    hook?: string;
    startHint?: string;
    appliedSuggestionIds: string[];
  };
  appliedEdits: {
    stitched: boolean;
    trimStartSec?: number;
    appliedActionTypes: string[];
  };
  onAppliedEdits: (
    next:
      | typeof appliedEdits
      | ((prev: typeof appliedEdits) => typeof appliedEdits),
  ) => void;
}) {
  // Build the available-action list deterministically. Sources:
  //   • stitch — extras count (the import stage caps at 2 total).
  //   • trim   — start_hint the user already applied takes
  //              priority (their explicit pick); otherwise fall
  //              back to idea.hookSeconds, which the ideator
  //              produces when the hook lands late and is the
  //              same number the film-stage "Hook lands in Xs"
  //              tip reads from.
  const actions: EditAction[] = useMemo(() => {
    const out: EditAction[] = [];
    if (extraClips.length >= 1) {
      out.push({
        type: "stitch_clips",
        // Note: `label` is now derived per-row from BOOST_COPY in
        // BoostRow — kept on the action object for backwards compat
        // with any external consumer that destructures it, but the
        // UI no longer reads it.
        label: BOOST_COPY.stitch_clips.label,
        params: { clipCount: extraClips.length + 1 },
      });
    }
    const hintedSec =
      parseStartHintSeconds(appliedEnhancements.startHint) ??
      (typeof idea.hookSeconds === "number" ? idea.hookSeconds : undefined);
    if (typeof hintedSec === "number" && hintedSec >= 0.5) {
      const seconds = clampTrimWindow(hintedSec);
      out.push({
        type: "trim_start",
        label: BOOST_COPY.trim_start.label,
        params: { seconds },
      });
    }
    return out;
  }, [
    extraClips.length,
    appliedEnhancements.startHint,
    idea.hookSeconds,
  ]);

  // Synchronous double-fire guard (same pattern + rationale as
  // EnhancementCard). Reading `appliedEdits.appliedActionTypes`
  // from props is too late — props only refresh after React
  // commits, so two taps in the same frame would both pass the
  // "is it already applied?" check and double-fire the signal.
  const firedTypesRef = useRef<Set<EditActionType>>(
    new Set(appliedEdits.appliedActionTypes as EditActionType[]),
  );
  useEffect(() => {
    firedTypesRef.current = new Set(
      appliedEdits.appliedActionTypes as EditActionType[],
    );
  }, [appliedEdits.appliedActionTypes]);

  const handleApply = useCallback(
    (action: EditAction) => {
      if (firedTypesRef.current.has(action.type)) return;
      firedTypesRef.current.add(action.type);

      // Mutate edit-intent state. The functional-updater form is
      // important: a fast double-action (e.g., tap stitch then
      // immediately tap trim) must compose without dropping the
      // earlier change.
      onAppliedEdits((prev) => {
        const nextTypes = prev.appliedActionTypes.includes(action.type)
          ? prev.appliedActionTypes
          : [...prev.appliedActionTypes, action.type];
        if (action.type === "stitch_clips") {
          return { ...prev, stitched: true, appliedActionTypes: nextTypes };
        }
        return {
          ...prev,
          trimStartSec: action.params.seconds,
          appliedActionTypes: nextTypes,
        };
      });

      // Same applied_enhancement signal + +1 weight as the
      // text-rewrite apply layer. The action.type tag rides on
      // suggestionType so the server-side aggregator can split
      // attribution by action flavour without a schema migration.
      if (idea?.hook) {
        submitIdeatorSignal({
          ideaHook: idea.hook,
          signalType: "applied_enhancement",
          ideaPattern: idea.pattern,
          emotionalSpike: idea.emotionalSpike,
          payoffType: idea.payoffType,
          structure: idea.structure,
          hookStyle: idea.hookStyle,
          suggestionType: action.type,
        });
      }
      // Per-row micro-confirmation is owned by BoostRow now (action-
      // specific copy + scoped fade timer). The card-level
      // "Nice — that's sharper." reassurance is gone on purpose —
      // it competed with the per-row line for attention.
    },
    [idea, onAppliedEdits],
  );

  // Quiet exit when neither action applies — the spec wants this
  // section out of the way unless we have something to offer. No
  // header, no empty-state copy, no "nothing to improve" message.
  if (actions.length === 0) return null;

  return (
    <View style={styles.readyCard} testID="make-it-ready-card">
      <Text style={styles.readyTitle}>Quick boost (optional)</Text>
      {/* Spec subtext — sets expectations on scope (max 2 actions)
          and stakes (this is the "make it hit harder" lever, not a
          required step) before the user reads the rows. */}
      <Text style={styles.readySubtitle}>
        2 taps max — makes this post hit harder
      </Text>

      <View style={styles.readyList}>
        {actions.map((action) => {
          const isApplied = appliedEdits.appliedActionTypes.includes(
            action.type,
          );
          return (
            <BoostRow
              key={action.type}
              action={action}
              isApplied={isApplied}
              onApply={handleApply}
            />
          );
        })}
      </View>
    </View>
  );
}

/**
 * Per-action copy table for the Quick Boost card.
 *
 * `label` is the row's primary text (kept short — 2-3 words — so
 * the user reads it as a single glance, not a sentence).
 *
 * `confirm` is the micro-confirmation that fades in under the row
 * the instant the user taps Fix. Each variant ends with a present-
 * tense, finished-state verb so the user feels the change *just
 * happened* — never aspirational ("would feel smoother") or
 * passive ("smoothing applied").
 */
const BOOST_COPY: Record<EditActionType, { label: string; confirm: string }> = {
  stitch_clips: {
    label: "Smoother flow",
    confirm: "Clips feel more natural now",
  },
  trim_start: {
    label: "Faster hook",
    confirm: "Hook now hits instantly",
  },
};

/**
 * One row in the Quick Boost card. Owns its own micro-interaction
 * state so the animations (button scale, row glow, micro-confirm
 * fade) stay scoped to the tapped row and don't ripple into the
 * sibling row when the user taps both in quick succession.
 *
 * Behaviour on press:
 *   1. Light haptic via the central feedback layer (web-safe).
 *   2. Button scales 0.95 → 1.0 (~150ms total).
 *   3. Row gets a brief firefly-tinted glow (120ms in, 200ms out).
 *   4. Micro-confirmation text fades in under the row, holds
 *      ~1.5s, fades out.
 *   5. Button label flips Fix → "Done ✓" and disables further taps.
 *
 * Pre-applied state (e.g., user navigated back into review with
 * the action already applied) renders the "Done ✓" terminal state
 * without firing animations or the micro-confirmation, so the
 * screen doesn't look like it's reacting to a tap that didn't
 * happen.
 */
function BoostRow({
  action,
  isApplied,
  onApply,
}: {
  action: EditAction;
  isApplied: boolean;
  onApply: (action: EditAction) => void;
}) {
  const copy = BOOST_COPY[action.type];

  // Local "just tapped" — drives the temporary micro-confirmation
  // line. Distinct from `isApplied` (props) so the line fades out
  // even though the row stays in the Done state forever.
  const [showConfirm, setShowConfirm] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, []);

  // Reanimated shared values for the button scale + row glow.
  // Driven exclusively by handlePress — never set on prop change —
  // so a re-render with a stale isApplied=true never plays a stray
  // animation.
  const btnScale = useSharedValue(1);
  const glow = useSharedValue(0);

  const btnAnim = useAnimatedStyle(() => ({
    transform: [{ scale: btnScale.value }],
  }));
  const glowAnim = useAnimatedStyle(() => ({
    opacity: glow.value,
  }));

  // Synchronous "already fired" latch. `isApplied` comes from
  // props and updates async after a parent commit, so a rapid
  // second tap inside the same frame would re-run haptic + scale
  // + glow + confirm even though handleApply's idempotency guard
  // safely no-ops the state change. This ref blocks the *visual*
  // duplication too. Guards against fast double-tap on Fix.
  const firedRef = useRef(false);
  useEffect(() => {
    // If the row mounts already-applied (deep link), pre-arm the
    // latch so a programmatic re-tap on the disabled button can't
    // sneak through.
    if (isApplied) firedRef.current = true;
  }, [isApplied]);

  const handlePress = useCallback(() => {
    if (isApplied || firedRef.current) return;
    firedRef.current = true;
    // Light tap haptic per spec ("light haptic on tap"). `feedback.tap`
    // maps to ImpactFeedbackStyle.Light on native; no-ops on web.
    feedback.tap();
    btnScale.value = withSequence(
      withTiming(0.95, { duration: 80 }),
      withSpring(1, { damping: 12, stiffness: 240, mass: 0.6 }),
    );
    glow.value = withSequence(
      withTiming(1, { duration: 120 }),
      withTiming(0, { duration: 200 }),
    );
    setShowConfirm(true);
    // iOS VoiceOver doesn't honour `accessibilityLiveRegion` (that
    // attr is Android-only). Announce the confirmation through the
    // imperative API so VoiceOver and TalkBack both speak it.
    if (Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(copy.confirm);
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => {
      setShowConfirm(false);
      confirmTimer.current = null;
    }, 1500);
    // Fire the actual apply *after* kicking off the visual feedback
    // so the user never sees a one-frame gap between tap and
    // animation start. handleApply itself is idempotent.
    onApply(action);
  }, [action, isApplied, onApply, btnScale, glow, copy.confirm]);

  return (
    <View
      style={styles.boostRowWrap}
      testID={`make-it-ready-row-${action.type}`}
    >
      <View style={styles.boostRow}>
        {/* Glow overlay — first child so later siblings paint on
            top. Pointer-events disabled so it can never eat a tap
            on the icon / label / button. */}
        <Animated.View
          pointerEvents="none"
          style={[styles.boostRowGlow, glowAnim]}
        />
        <Feather
          name={action.type === "stitch_clips" ? "link" : "scissors"}
          size={14}
          color={lumina.firefly}
          style={styles.boostRowIcon}
        />
        <View style={styles.boostRowBody}>
          <Text style={styles.boostRowLabel}>{copy.label}</Text>
        </View>
        <Animated.View style={btnAnim}>
          <Pressable
            onPress={handlePress}
            disabled={isApplied}
            style={({ pressed }) => [
              styles.boostBtn,
              isApplied ? styles.boostBtnDone : null,
              pressed && !isApplied ? styles.boostBtnPressed : null,
            ]}
            accessibilityRole="button"
            accessibilityLabel={
              isApplied ? `${copy.label} applied` : `Fix: ${copy.label}`
            }
            accessibilityState={{ disabled: isApplied }}
            testID={`make-it-ready-apply-${action.type}`}
          >
            <Text
              style={[
                styles.boostBtnText,
                isApplied ? styles.boostBtnTextDone : null,
              ]}
            >
              {isApplied ? "Done ✓" : "Fix"}
            </Text>
          </Pressable>
        </Animated.View>
      </View>
      {showConfirm ? (
        <Animated.Text
          entering={FadeIn.duration(120)}
          exiting={FadeOut.duration(200)}
          style={styles.boostConfirm}
          accessibilityLiveRegion="polite"
        >
          {copy.confirm}
        </Animated.Text>
      ) : null}
    </View>
  );
}

/* =================== Primitives =================== */

function PrimaryButton({
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
        styles.primary,
        pressed ? styles.primaryPressed : null,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={styles.primaryLabel}>{label}</Text>
    </Pressable>
  );
}

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

/* =================== Past-video selector =================== */

export type MatchReason = "topic" | "length" | "recent";

export type PastMatch = {
  video: ImportedVideo;
  reason: MatchReason;
};

// Tiered rule-based selector for the BEFORE pane. Past videos
// today only carry filename + durationSec server-side, so
// "topic" and "hook type" are best-effort:
//
//   - topic: substring match between idea-derived keywords
//     and the past video's filename. Will rarely fire on
//     auto-generated filenames (IMG_1234.mp4) but will hit
//     on anything human-named (morning-routine.mp4). When
//     past-video metadata grows (a `topic` column, etc.),
//     this tier picks up automatically without changing the
//     contract.
//   - length: same duration bucket as the new clip. Stands
//     in for "hook type" — short fast-cut hooks vs. medium
//     vs. long narrative.
//   - recent: most-recently imported. Always fires if any
//     past videos exist at all.
//
// Returns null only when there are zero past videos. Callers
// should distinguish that from a successful match.
export function selectPastVideo(
  videos: ImportedVideo[],
  idea: IdeaCardData,
  clip: FilmedClip,
): PastMatch | null {
  if (videos.length === 0) return null;

  // Defensive recency sort — server already returns DESC, but
  // matching on the wrong order here would corrupt every tier.
  const byRecency = [...videos].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );

  // TODO(post-mvp): match against extracted video topics and
  // style-profile metadata once the import pipeline starts
  // tagging past videos with topic/style labels server-side.
  // Today we only have filename, which rarely fires for raw
  // phone uploads like IMG_1234.mp4 — filename matching will
  // stay as a fallback once richer signals land.
  //
  // Tier 1 — topic keyword vs. filename. Tokenise the filename
  // on non-alphanumeric so we match whole words only ("morning"
  // in "morning-routine.mp4") instead of fragile substrings
  // ("effective" inside "ineffective"). Filenames typically use
  // -, _, or . as separators which all become token boundaries.
  const keywords = extractIdeaKeywords(idea);
  if (keywords.length > 0) {
    const keywordSet = new Set(keywords);
    const topicHit = byRecency.find((v) => {
      const fn = (v.filename ?? "").toLowerCase();
      if (fn.length === 0) return false;
      const tokens = fn.split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
      return tokens.some((t) => keywordSet.has(t));
    });
    if (topicHit) return { video: topicHit, reason: "topic" };
  }

  // Tier 2 — same duration bucket. Prefer the new clip's
  // length, fall back to the idea's planned length.
  const targetSec =
    typeof clip.durationSec === "number"
      ? clip.durationSec
      : typeof idea.videoLengthSec === "number"
        ? idea.videoLengthSec
        : null;
  if (targetSec !== null) {
    const targetBucket = durationBucket(targetSec);
    const lengthHit = byRecency.find(
      (v) =>
        typeof v.durationSec === "number" &&
        durationBucket(v.durationSec) === targetBucket,
    );
    if (lengthHit) return { video: lengthHit, reason: "length" };
  }

  // Tier 3 — most-recent fallback. Guaranteed to hit because
  // we already returned null on empty input above.
  return { video: byRecency[0]!, reason: "recent" };
}

// Pull a small set of meaningful tokens out of the idea's
// string fields. Length >= 4 + a tiny stopword set drops the
// obvious noise ("this", "that", "with", "your") while keeping
// content-bearing words ("morning", "routine", "tutorial").
const STOPWORDS = new Set([
  "this",
  "that",
  "with",
  "your",
  "what",
  "when",
  "have",
  "will",
  "from",
  "into",
  "they",
  "them",
  "then",
  "than",
  "just",
  "like",
  "only",
  "even",
  "more",
  "most",
  "much",
  "some",
  "such",
  "very",
  "well",
  "here",
  "there",
  "about",
  "after",
  "before",
  "again",
  "would",
  "could",
  "should",
  "these",
  "those",
  "every",
  "while",
]);

export function extractIdeaKeywords(idea: IdeaCardData): string[] {
  const blob = [
    idea.hook,
    idea.visualHook,
    idea.whyItWorks,
    idea.caption,
    idea.payoffType,
  ]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ");

  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of blob.split(/\s+/)) {
    if (tok.length < 4) continue;
    if (STOPWORDS.has(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
    if (out.length >= 8) break;
  }
  return out;
}

// Coarse duration buckets that approximate "hook type":
//   short  ≤ 15s  — fast-cut single-beat hook
//   medium ≤ 30s  — standard short-form
//   long   ≤ 60s  — longer narrative
//   xlong  > 60s  — long-form
export function durationBucket(sec: number): "short" | "medium" | "long" | "xlong" {
  if (sec <= 15) return "short";
  if (sec <= 30) return "medium";
  if (sec <= 60) return "long";
  return "xlong";
}

function matchReasonLabel(reason: MatchReason): string {
  switch (reason) {
    case "topic":
      return "matched on topic";
    case "length":
      return "matched on length";
    case "recent":
      return "your most recent upload";
  }
}

function formatError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message ?? fallback;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/* =================== Styles =================== */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0A0824" },
  recovery: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: "flex-start",
    alignItems: "stretch",
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },
  topBarTitle: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    letterSpacing: 0.4,
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
    marginBottom: 12,
    fontSize: 28,
    lineHeight: 34,
  },
  sub: {
    ...type.body,
    color: "rgba(255,255,255,0.7)",
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 22,
  },
  loadingBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 28,
  },
  loadingText: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
  },
  emptyBlock: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 18,
    paddingVertical: 28,
    paddingHorizontal: 22,
    marginBottom: 22,
  },
  emptyTitle: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.85)",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    marginBottom: 8,
  },
  emptyBody: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  // Side-by-side compare row
  compareRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 22,
  },
  compareCol: {
    flex: 1,
  },
  compareLabel: {
    fontFamily: fontFamily.bodyBold,
    color: "rgba(255,255,255,0.6)",
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  compareLabelAfter: {
    color: lumina.firefly,
  },
  // BEFORE frame — muted, neutral aesthetic
  frameBefore: {
    aspectRatio: 9 / 16,
    backgroundColor: "rgba(0,0,0,0.35)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
    padding: 12,
    justifyContent: "space-between",
  },
  frameBeforeBody: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  frameBeforeHint: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    textAlign: "center",
  },
  matchReason: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 10,
    letterSpacing: 0.6,
    textAlign: "center",
    marginTop: 6,
    opacity: 0.85,
  },
  // AFTER frame — firefly highlight to draw the eye
  frameAfter: {
    aspectRatio: 9 / 16,
    backgroundColor: "rgba(0,0,0,0.4)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.45)",
    overflow: "hidden",
    padding: 12,
    justifyContent: "space-between",
  },
  frameAfterHeader: {
    flexDirection: "row",
  },
  frameAfterBody: {
    flex: 1,
    justifyContent: "center",
    paddingVertical: 8,
  },
  frameAfterHook: {
    fontFamily: fontFamily.displayHeavy,
    color: "#FFFFFF",
    fontSize: 16,
    lineHeight: 21,
  },
  framePill: {
    backgroundColor: "rgba(0,255,204,0.16)",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  framePillText: {
    fontFamily: fontFamily.bodyBold,
    color: lumina.firefly,
    fontSize: 9,
    letterSpacing: 1.2,
  },
  frameFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  frameClip: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.55)",
    fontSize: 10,
    flex: 1,
  },
  // Tiny "+1 more clip" hint that sits just under the AFTER
  // footer when the user uploaded both slots. Kept intentionally
  // small and label-free — no ordering language, no thumbnails,
  // no timeline. Just enough to confirm both clips made it.
  frameExtra: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.45)",
    fontSize: 10,
    marginTop: 4,
  },
  // Applied-edit chip variant — same metrics as frameExtra but in
  // the firefly hue so the user sees the change land instantly
  // (chip text flips to "stitched · …" / "trimmed first …s" in
  // the BeforeAfter "After" frame the moment Apply is tapped).
  frameExtraApplied: {
    color: "rgba(0,255,204,0.90)",
  },
  // Why-Better card
  whyCard: {
    backgroundColor: "rgba(0,255,204,0.05)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.25)",
    borderRadius: 18,
    padding: 18,
    marginBottom: 22,
  },
  whyKicker: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  whyDirectional: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 14,
    fontStyle: "italic",
  },
  whyList: {
    gap: 10,
  },
  whyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  whyCheck: {
    marginTop: 3,
  },
  whyRowText: {
    flex: 1,
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.9)",
    fontSize: 14,
    lineHeight: 20,
  },
  whyFooter: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,255,204,0.18)",
    fontStyle: "italic",
  },
  whyFallback: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    lineHeight: 20,
  },
  // Enhancement Brain card — quieter than whyCard so the
  // "make it hit harder" nudge reads as a soft offer, not a
  // claim. Idle CTA is a borderless pill so the user can opt
  // in without feeling like they have to.
  enhanceCta: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: "rgba(0,255,204,0.08)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.22)",
    marginBottom: 22,
  },
  enhanceCtaPressed: {
    opacity: 0.7,
  },
  enhanceCtaIcon: {
    marginTop: 1,
  },
  enhanceCtaLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 13,
    letterSpacing: 0.2,
  },
  enhanceCard: {
    backgroundColor: "rgba(0,255,204,0.04)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.20)",
    borderRadius: 18,
    padding: 18,
    marginBottom: 22,
  },
  enhanceKicker: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  enhanceLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  enhanceLoadingText: {
    flex: 1,
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    lineHeight: 19,
  },
  enhanceErrorText: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  enhanceRetryBtn: {
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "rgba(0,255,204,0.10)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.28)",
  },
  enhanceRetryBtnPressed: {
    opacity: 0.7,
  },
  enhanceRetryLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 13,
  },
  enhanceList: {
    gap: 12,
  },
  enhanceRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  enhanceRowIcon: {
    marginTop: 3,
  },
  enhanceRowBody: {
    flex: 1,
    gap: 8,
  },
  enhanceRowText: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.92)",
    fontSize: 14,
    lineHeight: 20,
  },
  enhanceRowActions: {
    flexDirection: "row",
    alignItems: "center",
  },
  // Apply button — slightly stronger than the retry pill so the
  // primary action reads as live; "Applied" reuses the same shell
  // but goes muted + adds a check so the state change is obvious.
  enhanceApplyBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "rgba(0,255,204,0.14)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.34)",
  },
  enhanceApplyBtnPressed: {
    opacity: 0.7,
  },
  enhanceApplyBtnDone: {
    backgroundColor: "rgba(0,255,204,0.06)",
    borderColor: "rgba(0,255,204,0.22)",
  },
  enhanceApplyDoneIcon: {
    marginRight: 5,
  },
  enhanceApplyLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 12,
    letterSpacing: 0.3,
  },
  enhanceApplyLabelDone: {
    opacity: 0.85,
  },
  // Passive tag for non-applyable suggestions (refilm / hold shot /
  // bigger reaction). Same shape as the Apply button so the row
  // visually balances, but borderless + low contrast so it doesn't
  // beg for a tap that does nothing.
  enhanceTryPill: {
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  enhanceTryPillLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    letterSpacing: 0.3,
  },
  // Block summarising what the user has already applied (caption
  // and/or start hint). Sits above the suggestions list so the
  // user sees the change as they scroll. Hook is intentionally
  // omitted here because it flows straight into BeforeAfter.
  enhanceAppliedBlock: {
    marginBottom: 14,
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "rgba(0,255,204,0.06)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.18)",
  },
  enhanceAppliedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  enhanceAppliedIcon: {
    marginTop: 1,
  },
  enhanceAppliedLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  enhanceAppliedValue: {
    flex: 1,
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.92)",
    fontSize: 13,
    lineHeight: 18,
  },
  // Tiny one-line reassurance shown for ~2.4s after Apply.
  // Deliberately quiet — no icon, no big colour shift — so it
  // reads as "got it" rather than a celebration banner.
  enhanceReassurance: {
    marginTop: 14,
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(0,255,204,0.85)",
    fontSize: 12,
    letterSpacing: 0.2,
  },
  // Make-it-ready (semi-auto edit) card — visually paired with
  // EnhancementCard above it (same firefly accent, same border
  // weight) so the two semi-auto layers read as one progressive
  // polish step. Slightly tighter padding and a smaller list
  // gap so two rows feel like a checklist rather than a wall.
  readyCard: {
    backgroundColor: "rgba(0,255,204,0.05)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.22)",
    borderRadius: 18,
    padding: 18,
    marginBottom: 22,
  },
  readyTitle: {
    fontFamily: fontFamily.bodyMedium,
    color: "#fff",
    fontSize: 16,
    letterSpacing: 0.2,
  },
  readyList: {
    marginTop: 14,
    gap: 14,
  },
  // Quick Boost row — wrapper holds the row + the per-row micro-
  // confirmation line so they animate in/out together without
  // pushing siblings around.
  boostRowWrap: {
    gap: 6,
  },
  boostRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    // `relative` so the absolutely-positioned glow overlay anchors
    // to the row bounds.
    position: "relative",
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginHorizontal: -6,
    borderRadius: 12,
  },
  // Firefly-tinted glow that pulses behind the row on tap.
  // Painted as the first child + pointer-events disabled so it
  // can never intercept a press on the row's interactive children.
  boostRowGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 12,
    backgroundColor: "rgba(0,255,204,0.14)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.32)",
  },
  boostRowIcon: {
    marginTop: 1,
  },
  boostRowBody: {
    flex: 1,
  },
  boostRowLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.95)",
    fontSize: 14,
    lineHeight: 19,
  },
  // Fix / Done ✓ button — same outer metrics in both states so the
  // row doesn't reflow when the label flips.
  boostBtn: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: "rgba(0,255,204,0.16)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.36)",
    minWidth: 60,
    alignItems: "center",
  },
  boostBtnPressed: {
    opacity: 0.75,
  },
  boostBtnDone: {
    backgroundColor: "rgba(0,255,204,0.06)",
    borderColor: "rgba(0,255,204,0.22)",
  },
  boostBtnText: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 12,
    letterSpacing: 0.3,
  },
  boostBtnTextDone: {
    opacity: 0.85,
  },
  // Per-row micro-confirmation. Indents to align with the label
  // (icon width + gap) so it visually belongs to its row.
  boostConfirm: {
    marginLeft: 30,
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(0,255,204,0.9)",
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.2,
  },
  // Buttons (mirrored from create.tsx — kept local to avoid a
  // cross-screen primitive shuffle until a third caller appears)
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
  primaryLabel: {
    fontFamily: fontFamily.bodyBold,
    color: "#0A0824",
    fontSize: 16,
    letterSpacing: 0.4,
  },
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
  // Retry within the empty/error block
  retryBtn: {
    backgroundColor: lumina.firefly,
    borderRadius: 999,
    paddingHorizontal: 24,
    paddingVertical: 10,
    marginTop: 12,
  },
  retryBtnPressed: {
    opacity: 0.85,
  },
  retryLabel: {
    fontFamily: fontFamily.bodyBold,
    color: "#0A0824",
    fontSize: 13,
    letterSpacing: 0.4,
  },
  // Export card
  exportCard: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 18,
    padding: 18,
    marginBottom: 8,
  },
  watermarkRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
    gap: 12,
  },
  watermarkLabelCol: {
    flex: 1,
  },
  watermarkLabel: {
    fontFamily: fontFamily.bodySemiBold,
    color: "#FFFFFF",
    fontSize: 14,
    marginBottom: 3,
  },
  watermarkHint: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    lineHeight: 16,
  },
  primaryDisabled: {
    opacity: 0.4,
  },
  // Sub-label rendered under the "Save & Post" primary CTA. Same
  // dark-on-firefly contrast as the primary label, dropped a step
  // in weight + size + opacity so it reads as supporting copy and
  // doesn't compete with the action verb above it.
  primarySub: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(10,8,36,0.75)",
    fontSize: 12,
    letterSpacing: 0.2,
    marginTop: 4,
  },
  // Final-video preview card — replaces BeforeAfter on this
  // screen. 9:16 frame to match the AFTER pane the user has been
  // looking at all flow long, with a centered play affordance and
  // a duration line under it.
  vidReady: {
    aspectRatio: 9 / 16,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.45)",
    overflow: "hidden",
    padding: 14,
    justifyContent: "space-between",
    marginBottom: 18,
    position: "relative",
  },
  vidReadyBody: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },
  vidPlayCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: lumina.firefly,
    alignItems: "center",
    justifyContent: "center",
    // Nudge the play glyph optically off-center so it reads as a
    // play triangle and not an off-balance icon.
    paddingLeft: 4,
  },
  vidDuration: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.85)",
    fontSize: 13,
    letterSpacing: 0.4,
  },
  vidFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  vidFooterText: {
    flex: 1,
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
  },
  // Three-up confidence row. Items wrap their own icon + text in
  // a column so each signal feels like its own glanceable card,
  // and the three together still fit without overflow at 360px.
  confidenceStrip: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 22,
  },
  confidenceItem: {
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,255,204,0.06)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.18)",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  confidenceText: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.85)",
    fontSize: 11,
    lineHeight: 14,
    textAlign: "center",
  },
  // Subtitle under "Quick boost (optional)" — same family/colour
  // as readyTitle but smaller + dimmer so it reads as supporting
  // copy and doesn't fight the title for attention.
  readySubtitle: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
  },
  exportNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "rgba(0,255,204,0.06)",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  exportNoticeText: {
    flex: 1,
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.85)",
    fontSize: 13,
    lineHeight: 18,
  },
  savingBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
  },
  savingText: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
  },
  exportError: {
    fontFamily: fontFamily.bodyMedium,
    color: "#FF8A8A",
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 12,
  },
  // Watermark badge that overlays the AFTER frame
  watermarkBadge: {
    position: "absolute",
    bottom: 8,
    right: 8,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.45)",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  watermarkBadgeText: {
    fontFamily: fontFamily.bodyBold,
    color: lumina.firefly,
    fontSize: 8,
    letterSpacing: 0.6,
  },

  /* ---------- Just save secondary ---------- */
  justSave: {
    marginTop: 10,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  justSavePressed: {
    opacity: 0.5,
  },
  justSaveLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.65)",
    fontSize: 14,
    letterSpacing: 0.3,
  },

  /* ---------- Saved success block ---------- */
  savedBlock: {
    marginTop: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: "rgba(0,255,204,0.08)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.25)",
    alignItems: "center",
  },
  savedCheckRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  savedTitle: {
    fontFamily: fontFamily.displayHeavy,
    color: "#FFFFFF",
    fontSize: 18,
    letterSpacing: 0.2,
  },
  savedLine: {
    fontFamily: fontFamily.bodySemiBold,
    color: "#FFFFFF",
    fontSize: 14,
    marginTop: 6,
    letterSpacing: 0.2,
  },
  savedSub: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.65)",
    fontSize: 12,
    marginTop: 2,
    letterSpacing: 0.1,
  },

  /* ---------- Inline copy confirmation ---------- */
  copyConfirmRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  copyConfirmText: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 12,
    letterSpacing: 0.2,
  },

  /* ---------- Platform sheet (modal) ---------- */
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheetCard: {
    backgroundColor: "#1A0F35",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
    paddingHorizontal: 20,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  sheetHandle: {
    alignSelf: "center",
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.18)",
    marginBottom: 10,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  sheetTitle: {
    fontFamily: fontFamily.displayHeavy,
    color: "#FFFFFF",
    fontSize: 20,
    letterSpacing: 0.2,
  },
  sheetTiles: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 12,
  },
  sheetTile: {
    width: "48%",
    paddingVertical: 18,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    gap: 10,
  },
  sheetTilePressed: {
    opacity: 0.7,
    transform: [{ scale: 0.98 }],
  },
  sheetTileIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetTileLabel: {
    fontFamily: fontFamily.bodySemiBold,
    color: "#FFFFFF",
    fontSize: 14,
    letterSpacing: 0.2,
  },

  /* ---------- Platform handoff card ---------- */
  handoffCard: {
    marginTop: 18,
    paddingVertical: 18,
    paddingHorizontal: 18,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  handoffHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
  handoffTitle: {
    fontFamily: fontFamily.displayHeavy,
    color: "#FFFFFF",
    fontSize: 18,
    letterSpacing: 0.2,
  },
  handoffSub: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.65)",
    fontSize: 13,
    marginTop: 2,
    letterSpacing: 0.2,
  },
  handoffSteps: {
    gap: 10,
    marginBottom: 16,
  },
  handoffStepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  handoffStepBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,255,204,0.15)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.35)",
  },
  handoffStepBadgeText: {
    fontFamily: fontFamily.bodyBold,
    color: lumina.firefly,
    fontSize: 12,
  },
  handoffStepText: {
    fontFamily: fontFamily.bodyMedium,
    color: "#FFFFFF",
    fontSize: 14,
    letterSpacing: 0.2,
  },
  handoffCaptionBlock: {
    marginBottom: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.3)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  handoffCaptionTitle: {
    fontFamily: fontFamily.bodySemiBold,
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  handoffCaptionText: {
    fontFamily: fontFamily.bodyMedium,
    color: "#FFFFFF",
    fontSize: 14,
    lineHeight: 20,
  },
  handoffCaptionEmpty: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    fontStyle: "italic",
    lineHeight: 18,
  },
  handoffActions: {
    gap: 10,
  },
  handoffSecondary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "rgba(0,255,204,0.08)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.25)",
  },
  handoffSecondaryPressed: {
    opacity: 0.7,
  },
  handoffSecondaryLabel: {
    fontFamily: fontFamily.bodySemiBold,
    color: lumina.firefly,
    fontSize: 14,
    letterSpacing: 0.3,
  },
  handoffPrimary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: lumina.firefly,
  },
  handoffPrimaryPressed: {
    opacity: 0.85,
  },
  handoffPrimaryLabel: {
    fontFamily: fontFamily.bodyBold,
    color: "#0F0820",
    fontSize: 15,
    letterSpacing: 0.3,
  },
  handoffFooter: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  handoffFooterText: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
    letterSpacing: 0.4,
  },

  /* ---------- Return loop card ---------- */
  returnCard: {
    marginTop: 16,
    paddingVertical: 18,
    paddingHorizontal: 18,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    alignItems: "stretch",
  },
  returnTitle: {
    fontFamily: fontFamily.displayHeavy,
    color: "#FFFFFF",
    fontSize: 20,
    letterSpacing: 0.2,
    textAlign: "center",
  },
  returnSub: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.65)",
    fontSize: 14,
    textAlign: "center",
    marginTop: 4,
    marginBottom: 16,
    letterSpacing: 0.2,
  },
  returnPrimary: {
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: lumina.firefly,
    alignItems: "center",
    marginBottom: 10,
  },
  returnPrimaryPressed: {
    opacity: 0.85,
  },
  returnPrimaryLabel: {
    fontFamily: fontFamily.bodyBold,
    color: "#0F0820",
    fontSize: 15,
    letterSpacing: 0.3,
  },
  returnSecondary: {
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    marginBottom: 8,
  },
  returnSecondaryPressed: {
    opacity: 0.7,
  },
  returnSecondaryLabel: {
    fontFamily: fontFamily.bodySemiBold,
    color: "#FFFFFF",
    fontSize: 14,
    letterSpacing: 0.3,
  },
  returnTertiary: {
    paddingVertical: 10,
    alignItems: "center",
  },
  returnTertiaryPressed: {
    opacity: 0.5,
  },
  returnTertiaryLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    letterSpacing: 0.3,
  },
});
