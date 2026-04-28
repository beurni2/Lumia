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
import * as MediaLibrary from "expo-media-library";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, customFetch } from "@workspace/api-client-react";

import { Confetti } from "@/components/Confetti";
import { InlineToast } from "@/components/feedback/InlineToast";
import { CosmicBackdrop } from "@/components/foundation/CosmicBackdrop";
import { type IdeaCardData } from "@/components/IdeaCard";
import { lumina } from "@/constants/colors";
import { fontFamily, type } from "@/constants/typography";
import { submitIdeatorSignal } from "@/lib/ideatorSignal";
import {
  POST_EXPORT_MESSAGES,
  rotateRandom,
} from "@/lib/loopMessages";

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

  useEffect(() => {
    if (!idea || !clip) return;
    void loadMatch();
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
      setExportToast(rotateRandom(POST_EXPORT_MESSAGES));
    }
  }, [saveState]);

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
  }, [saveableUris]);

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
          <Text style={styles.topBarTitle}>Side-by-side review</Text>
          <View style={{ width: 26 }} />
        </View>

        <Animated.View entering={FadeIn.duration(280)} style={styles.stage}>
          <Text style={styles.kicker}>Compare your take</Text>
          <Text style={styles.title}>Before and after.</Text>
          <Text style={styles.sub}>
            Your earlier upload alongside the new take, built on this idea.
          </Text>

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={lumina.firefly} />
              <Text style={styles.loadingText}>Finding a similar video…</Text>
            </View>
          ) : null}

          {!loading && empty ? (
            <View style={styles.emptyBlock}>
              <Feather
                name="film"
                size={28}
                color={lumina.firefly}
                style={{ marginBottom: 12 }}
              />
              <Text style={styles.emptyTitle}>
                No similar past video yet — we'll compare once you import
                more.
              </Text>
            </View>
          ) : null}

          {!loading && errorMsg && !empty ? (
            <View style={styles.emptyBlock}>
              <Feather
                name="alert-circle"
                size={28}
                color={lumina.firefly}
                style={{ marginBottom: 12 }}
              />
              <Text style={styles.emptyTitle}>{errorMsg}</Text>
              <Pressable
                onPress={loadMatch}
                style={({ pressed }) => [
                  styles.retryBtn,
                  pressed ? styles.retryBtnPressed : null,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Retry loading past video"
              >
                <Text style={styles.retryLabel}>Retry</Text>
              </Pressable>
            </View>
          ) : null}

          {/* Only render BEFORE/AFTER on a successful match —
              gating on `match` alone would let stale content
              from a previous successful load sit underneath an
              error or empty state on retry. */}
          {!loading && !errorMsg && !empty && match ? (
            <BeforeAfter
              match={match}
              clip={clip}
              extraClips={extraClips}
              idea={idea}
              watermarkOn={watermarkOn}
              appliedHookOverride={appliedEnhancements.hook}
              appliedEdits={appliedEdits}
            />
          ) : null}

          {/* WhyBetter renders in success AND empty states, but
              not while we're showing an error block — the card
              would feel disconnected if we couldn't even load
              the comparison data it sits next to. */}
          {!loading && !errorMsg ? <WhyBetterCard idea={idea} /> : null}

          {/* Enhancement Brain — lazy "make it hit harder" suggestions.
              Renders a quiet CTA by default; only fires the AI call on
              tap so we don't burn cost on every review-screen mount.
              Mounts in the same conditions as WhyBetter so the two
              cards either both appear or both stay quiet. */}
          {!loading && !errorMsg ? (
            <EnhancementCard
              idea={idea}
              applied={appliedEnhancements}
              onApplied={setAppliedEnhancements}
            />
          ) : null}

          {/* Make-it-ready card — sits below the text-rewrite
              EnhancementCard and above ExportSection so the flow
              reads "improve idea → polish video → export". Only
              renders when at least one of the two actions is
              applicable; otherwise it stays out of the way. */}
          {!loading && !errorMsg ? (
            <MakeItReadyCard
              idea={idea}
              extraClips={extraClips}
              appliedEnhancements={appliedEnhancements}
              appliedEdits={appliedEdits}
              onAppliedEdits={setAppliedEdits}
            />
          ) : null}

          <ExportSection
            saveState={saveState}
            onSaveAgain={handleSaveAgain}
            saveErrorMsg={saveErrorMsg}
            watermarkOn={watermarkOn}
            onToggleWatermark={setWatermarkOn}
            onSave={handleSave}
            onMakeAnother={handleMakeAnother}
            onBack={handleHome}
            canSave={saveableUris.length > 0}
            clipCount={saveableUris.length}
          />

          {/* Bottom navigation tail — keeps "Make another
              version" visible and functional throughout the
              flow (not gated on a successful save). Hidden in
              the success state because the success block
              already promotes both actions as primary CTAs,
              and showing them twice would clutter the moment. */}
          {saveState !== "success" ? (
            <>
              <TextButton
                label="Make another version"
                onPress={handleMakeAnother}
              />
              <TextButton label="Back to ideas" onPress={handleHome} />
            </>
          ) : null}
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
  saveErrorMsg,
  watermarkOn,
  onToggleWatermark,
  onSave,
  onSaveAgain,
  onMakeAnother,
  onBack,
  canSave,
  clipCount,
}: {
  saveState: "idle" | "saving" | "success" | "error";
  saveErrorMsg: string | null;
  watermarkOn: boolean;
  onToggleWatermark: (next: boolean) => void;
  onSave: () => void;
  // Re-save handler used by the success-state "Save to gallery"
  // button. Clears the dedupe ref before re-running handleSave
  // so the second tap actually writes a fresh copy (vs the
  // partial-failure retry, which intentionally skips already-
  // saved URIs).
  onSaveAgain: () => void;
  onMakeAnother: () => void;
  onBack: () => void;
  canSave: boolean;
  // 1 or 2. Drives the "Video"/"Videos" pluralisation in the
  // saving copy so the user sees the truthful state
  // ("Saving 2 videos…") when both upload slots were filled.
  clipCount: number;
}) {
  const plural = clipCount > 1;
  return (
    <View style={styles.exportCard}>
      {/* Watermark toggle is visible in idle/saving/error and
          hidden in success — keeps the post-save card clean
          and avoids inviting the user to flip it after the
          file is already on disk. */}
      {saveState !== "success" ? (
        <View style={styles.watermarkRow}>
          <View style={styles.watermarkLabelCol}>
            <Text style={styles.watermarkLabel}>Add "Made with Lumina"</Text>
            <Text style={styles.watermarkHint}>
              Shown in the AFTER preview above — the saved file isn't watermarked yet.
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
            accessibilityHint="Adds the watermark to the in-app preview. The saved file is not watermarked yet."
            accessibilityState={{ checked: watermarkOn }}
          />
        </View>
      ) : null}

      {/* When canSave is false (web preview, or a clip with no
          local URI for any reason), don't bother showing a
          dead Save button — show the same explanation inline
          so the user understands the constraint immediately
          instead of bouncing off a disabled control. */}
      {!canSave && saveState !== "saving" && saveState !== "success" ? (
        <View style={styles.exportNotice}>
          <Feather
            name="smartphone"
            size={16}
            color={lumina.firefly}
            style={{ marginTop: 1 }}
          />
          <Text style={styles.exportNoticeText}>
            Saving to your gallery works on the phone app — open Lumina on
            your phone to export.
          </Text>
        </View>
      ) : null}

      {canSave && (saveState === "idle" || saveState === "error") ? (
        <Pressable
          onPress={onSave}
          style={({ pressed }) => [
            styles.primary,
            pressed ? styles.primaryPressed : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel={
            saveState === "error" ? "Try saving again" : "Save to gallery"
          }
        >
          <Text style={styles.primaryLabel}>
            {saveState === "error" ? "Try again" : "Save to gallery"}
          </Text>
        </Pressable>
      ) : null}

      {saveState === "saving" ? (
        <View style={styles.savingBox}>
          <ActivityIndicator color={lumina.firefly} />
          <Text style={styles.savingText}>
            {plural
              ? `Saving ${clipCount} videos to your gallery…`
              : "Saving to your gallery…"}
          </Text>
        </View>
      ) : null}

      {saveState === "success" ? (
        <View style={styles.successBox}>
          <Feather name="check-circle" size={32} color={lumina.firefly} />
          <Text style={styles.successTitle}>Video ready</Text>
          <Text style={styles.successHint}>
            Save it, post it manually, or make another version.
          </Text>
          {/* Three CTAs sit inside the success block so they
              read as the natural next-actions after the
              celebration. Save to gallery is primary — tapping
              it clears the dedupe ref and re-runs handleSave so
              the user can write a fresh copy on demand. Make
              another and Back to ideas drop to secondary. The
              bottom-of-screen navigation tail hides itself in
              this state to avoid duplicating these controls. */}
          <View style={styles.successActions}>
            <Pressable
              onPress={onSaveAgain}
              style={({ pressed }) => [
                styles.primary,
                pressed ? styles.primaryPressed : null,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Save to gallery"
            >
              <Text style={styles.primaryLabel}>Save to gallery</Text>
            </Pressable>
            <Pressable
              onPress={onMakeAnother}
              style={({ pressed }) => [
                styles.successSecondary,
                pressed ? styles.successSecondaryPressed : null,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Make another version"
            >
              <Text style={styles.successSecondaryLabel}>
                Make another version
              </Text>
            </Pressable>
            <Pressable
              onPress={onBack}
              style={({ pressed }) => [
                styles.successSecondary,
                pressed ? styles.successSecondaryPressed : null,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Back to ideas"
            >
              <Text style={styles.successSecondaryLabel}>Back to ideas</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {saveState === "error" && saveErrorMsg ? (
        <Text style={styles.exportError}>{saveErrorMsg}</Text>
      ) : null}
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
        label: "Combine your two clips",
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
        label: `Trim the first ${seconds.toFixed(1)}s so the hook lands faster`,
        params: { seconds },
      });
    }
    return out;
  }, [
    extraClips.length,
    appliedEnhancements.startHint,
    idea.hookSeconds,
  ]);

  // Reassurance line ("Nice — that's sharper.") and the same
  // 2.4s auto-clear behaviour as EnhancementCard. Reusing the
  // copy keeps the apply experience consistent across both
  // semi-auto layers.
  const [reassurance, setReassurance] = useState<string | null>(null);
  const reassureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (reassureTimerRef.current) clearTimeout(reassureTimerRef.current);
    };
  }, []);

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

      setReassurance("Nice — that's sharper.");
      if (reassureTimerRef.current) clearTimeout(reassureTimerRef.current);
      reassureTimerRef.current = setTimeout(() => {
        setReassurance(null);
        reassureTimerRef.current = null;
      }, 2400);
    },
    [idea, onAppliedEdits],
  );

  // Quiet exit when neither action applies — the spec wants this
  // section out of the way unless we have something to offer. No
  // header, no empty-state copy, no "nothing to improve" message.
  if (actions.length === 0) return null;

  return (
    <View style={styles.readyCard} testID="make-it-ready-card">
      <Text style={styles.readyTitle}>Make it ready (optional)</Text>
      <Text style={styles.readySub}>
        One tap each — your video is still your video.
      </Text>

      <View style={styles.readyList}>
        {actions.map((action) => {
          const isApplied = appliedEdits.appliedActionTypes.includes(
            action.type,
          );
          return (
            <View
              key={action.type}
              style={styles.readyRow}
              testID={`make-it-ready-row-${action.type}`}
            >
              <Feather
                name={action.type === "stitch_clips" ? "link" : "scissors"}
                size={14}
                color={lumina.firefly}
                style={styles.readyRowIcon}
              />
              <View style={styles.readyRowBody}>
                <Text style={styles.readyRowLabel}>{action.label}</Text>
              </View>
              {isApplied ? (
                <View style={styles.readyAppliedPill}>
                  <Feather name="check" size={12} color={lumina.firefly} />
                  <Text style={styles.readyAppliedPillText}>Applied</Text>
                </View>
              ) : (
                <Pressable
                  onPress={() => handleApply(action)}
                  style={({ pressed }) => [
                    styles.readyApplyBtn,
                    pressed ? styles.readyApplyBtnPressed : null,
                  ]}
                  testID={`make-it-ready-apply-${action.type}`}
                >
                  <Text style={styles.readyApplyBtnText}>Apply</Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </View>

      {reassurance ? (
        <Text style={styles.readyReassurance}>{reassurance}</Text>
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
  readySub: {
    marginTop: 6,
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.62)",
    fontSize: 12,
    lineHeight: 17,
  },
  readyList: {
    marginTop: 14,
    gap: 10,
  },
  readyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  readyRowIcon: {
    marginTop: 1,
  },
  readyRowBody: {
    flex: 1,
  },
  readyRowLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.92)",
    fontSize: 13,
    lineHeight: 18,
  },
  // Apply / Applied — same metrics as the EnhancementCard pills
  // so the two semi-auto layers visually rhyme. Kept as a
  // separate token namespace because the wider shape is the same
  // but the exact colours were tuned a hair lighter to balance
  // the smaller text in this card.
  readyApplyBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: "rgba(0,255,204,0.14)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.34)",
  },
  readyApplyBtnPressed: {
    opacity: 0.7,
  },
  readyApplyBtnText: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 12,
    letterSpacing: 0.3,
  },
  readyAppliedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "rgba(0,255,204,0.06)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.22)",
  },
  readyAppliedPillText: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 12,
    letterSpacing: 0.3,
    opacity: 0.85,
  },
  readyReassurance: {
    marginTop: 14,
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(0,255,204,0.85)",
    fontSize: 12,
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
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
    lineHeight: 15,
  },
  primaryDisabled: {
    opacity: 0.4,
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
  successBox: {
    alignItems: "center",
    paddingVertical: 8,
    gap: 8,
  },
  successTitle: {
    fontFamily: fontFamily.bodyBold,
    color: "#FFFFFF",
    fontSize: 16,
  },
  successHint: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
    paddingHorizontal: 8,
  },
  successActions: {
    alignSelf: "stretch",
    marginTop: 10,
    gap: 6,
  },
  successSecondary: {
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  successSecondaryPressed: {
    opacity: 0.6,
  },
  successSecondaryLabel: {
    fontFamily: fontFamily.bodySemiBold,
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    letterSpacing: 0.3,
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
});
