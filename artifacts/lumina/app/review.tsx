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
            />
          ) : null}

          {/* WhyBetter renders in success AND empty states, but
              not while we're showing an error block — the card
              would feel disconnected if we couldn't even load
              the comparison data it sits next to. */}
          {!loading && !errorMsg ? <WhyBetterCard idea={idea} /> : null}

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
              {idea.hook}
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
            <Text style={styles.frameExtra}>
              +{extras} more clip{extras > 1 ? "s" : ""}
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
