/**
 * Review — the Phase 1 side-by-side review skeleton.
 *
 * After filming and previewing in the create flow, the user
 * lands here to see how their new take compares against a past
 * similar video they imported during onboarding. The screen
 * reads as: BEFORE (a past upload) → AFTER (the new clip with
 * the idea hook overlay) → "Why this should perform better".
 *
 * Matching is rule-based and intentionally simple:
 *   - Pull all the user's imported_videos (already populated
 *     server-side from onboarding).
 *   - Pick the one with `durationSec` closest to the new clip's
 *     `durationSec`. Ties broken by most-recent `createdAt`.
 *   - If the new clip has no duration data, fall back to the
 *     most-recently imported video.
 *   - If the user has no past imports at all (shouldn't happen
 *     post-onboarding, but possible mid-session for resumed
 *     flows), surface a friendly empty state and route them
 *     back to Home.
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
 * Out of scope (deliberate): real export, share, save to
 * gallery, publishing, analytics, monetization. The "Back to
 * ideas" CTA returns to Home; "Make another version" stays as
 * the same disabled placeholder used on the preview screen.
 */

import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, customFetch } from "@workspace/api-client-react";

import { CosmicBackdrop } from "@/components/foundation/CosmicBackdrop";
import { type IdeaCardData } from "@/components/IdeaCard";
import { lumina } from "@/constants/colors";
import { fontFamily, type } from "@/constants/typography";

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
  const params = useLocalSearchParams<{ idea?: string; clip?: string }>();
  const { idea, clip } = useMemo(() => {
    let parsedIdea: IdeaCardData | null = null;
    let parsedClip: FilmedClip | null = null;
    if (params.idea) {
      try {
        parsedIdea = JSON.parse(params.idea) as IdeaCardData;
      } catch {
        parsedIdea = null;
      }
    }
    if (params.clip) {
      try {
        parsedClip = JSON.parse(params.clip) as FilmedClip;
      } catch {
        parsedClip = null;
      }
    }
    return { idea: parsedIdea, clip: parsedClip };
  }, [params.idea, params.clip]);

  const [past, setPast] = useState<ImportedVideo | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  // Stale-call guard for the same reason as Home — Retry can
  // fire a second `loadMatch` while the first is still in
  // flight, and we don't want the slower one to clobber the
  // fresher result.
  const loadCallIdRef = useRef(0);

  /* ---------- Past-video matching --------------------------- */

  const loadMatch = useCallback(async () => {
    const callId = ++loadCallIdRef.current;
    setLoading(true);
    setErrorMsg(null);
    setEmpty(false);
    // Clear the previous match so a retry that lands on
    // an error/empty state can't show stale BEFORE/AFTER
    // content underneath the new state. Architect-flagged.
    setPast(null);
    try {
      const list = await customFetch<ImportedVideosListResponse>(
        "/api/imported-videos",
      );
      if (callId !== loadCallIdRef.current) return;

      if (!list.videos.length) {
        setEmpty(true);
        return;
      }

      // Defensive sort by createdAt DESC — the server already
      // returns most-recent first today, but relying on order
      // here would couple us to that contract. Cheap to sort
      // a tiny list locally.
      const byRecency = [...list.videos].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );

      const target = clip?.durationSec;
      const pick =
        typeof target === "number"
          ? pickClosestDuration(byRecency, target)
          : byRecency[0];

      setPast(pick ?? byRecency[0] ?? null);
    } catch (err) {
      if (callId !== loadCallIdRef.current) return;
      setErrorMsg(formatError(err, "Couldn't load a past video to compare."));
    } finally {
      if (callId === loadCallIdRef.current) setLoading(false);
    }
  }, [clip?.durationSec]);

  useEffect(() => {
    if (!idea || !clip) return;
    void loadMatch();
  }, [idea, clip, loadMatch]);

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
                No past videos to compare against yet.
              </Text>
              <Text style={styles.emptyBody}>
                Once you import a few clips, you'll see a side-by-side here.
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
              gating on `past` alone would let stale content
              from a previous successful load sit underneath an
              error or empty state on retry. */}
          {!loading && !errorMsg && !empty && past ? (
            <BeforeAfter past={past} clip={clip} idea={idea} />
          ) : null}

          {/* WhyBetter renders in success AND empty states, but
              not while we're showing an error block — the card
              would feel disconnected if we couldn't even load
              the comparison data it sits next to. */}
          {!loading && !errorMsg ? <WhyBetterCard idea={idea} /> : null}

          <ComingSoonButton
            label="Make another version"
            hint="coming soon"
            accessibilityLabel="Make another version (coming soon)"
          />

          <TextButton label="Back to ideas" onPress={handleHome} />
        </Animated.View>
      </ScrollView>
    </View>
  );
}

/* =================== Before / After =================== */

function BeforeAfter({
  past,
  clip,
  idea,
}: {
  past: ImportedVideo;
  clip: FilmedClip;
  idea: IdeaCardData;
}) {
  return (
    <View style={styles.compareRow}>
      <View style={styles.compareCol}>
        <Text style={styles.compareLabel}>Before</Text>
        <View style={styles.frameBefore}>
          <View style={styles.frameBeforeBody}>
            <Text style={styles.frameBeforeHint}>your earlier upload</Text>
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
        </View>
      </View>
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

// Closest-by-duration match. If two videos tie on absolute
// distance, the earlier-in-the-list (already DESC by createdAt)
// wins via the `<` comparison — i.e., the more recent one.
function pickClosestDuration(
  videos: ImportedVideo[],
  target: number,
): ImportedVideo | null {
  let best: ImportedVideo | null = null;
  let bestDist = Infinity;
  for (const v of videos) {
    if (typeof v.durationSec !== "number") continue;
    const d = Math.abs(v.durationSec - target);
    if (d < bestDist) {
      best = v;
      bestDist = d;
    }
  }
  // If none of the videos had a recorded duration, fall back to
  // the first (most-recent) one so the "before" pane has
  // something to render rather than going blank.
  return best ?? videos[0] ?? null;
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
});
