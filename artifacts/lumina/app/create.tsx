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
import React, { useCallback, useMemo, useState } from "react";
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
  const [clip, setClip] = useState<FilmedClip | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  /* ---------- Stage transitions ------------------------------- */

  const goImport = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setStage("import");
  }, []);

  const goPreview = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setStage("preview");
  }, []);

  const handlePickClip = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const picked = await pickVideo();
      if (!picked) {
        // User cancelled the picker — release the busy lock and
        // stay on this stage. No error, no advance.
        return;
      }
      setClip(picked);
      goPreview();
    } catch (err) {
      setErrorMsg(formatError(err, "Couldn't import that clip."));
    } finally {
      setBusy(false);
    }
  }, [busy, goPreview]);

  const handleDone = useCallback(() => {
    router.replace("/(tabs)");
  }, [router]);

  // Hand-off to the side-by-side review skeleton. We pass the
  // idea + clip JSON-encoded so /review is fully self-contained
  // and can be re-entered (back-nav, deep-link) without needing
  // any global state. Guarded on `clip` so the button can only
  // fire from the preview stage.
  const handleSeeReview = useCallback(() => {
    if (!idea || !clip) return;
    router.push({
      pathname: "/review",
      params: {
        idea: JSON.stringify(idea),
        clip: JSON.stringify(clip),
      },
    });
  }, [router, idea, clip]);

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
          <TipsStage idea={idea} onContinue={goImport} />
        ) : null}
        {stage === "import" ? (
          <ImportStage onPick={handlePickClip} busy={busy} />
        ) : null}
        {stage === "preview" && clip ? (
          <PreviewStage
            idea={idea}
            clip={clip}
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
}: {
  idea: IdeaCardData;
  onContinue: () => void;
}) {
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

      {idea.whyItWorks ? (
        <TipBlock title="Why it works" body={idea.whyItWorks} />
      ) : null}

      {typeof idea.videoLengthSec === "number" ||
      typeof idea.filmingTimeMin === "number" ? (
        <View style={styles.metaRow}>
          {typeof idea.videoLengthSec === "number" ? (
            <View style={styles.metaPill}>
              <Text style={styles.metaText}>
                Aim for {idea.videoLengthSec} sec
              </Text>
            </View>
          ) : null}
          {typeof idea.filmingTimeMin === "number" ? (
            <View style={styles.metaPill}>
              <Text style={styles.metaText}>
                ~{idea.filmingTimeMin} min to film
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <PrimaryButton label="I'm ready to film" onPress={onContinue} />
    </Animated.View>
  );
}

/* =================== Stage 2 · Import =================== */

function ImportStage({
  onPick,
  busy,
}: {
  onPick: () => void;
  busy: boolean;
}) {
  return (
    <Animated.View entering={FadeIn.duration(280)} style={styles.stage}>
      <Text style={styles.kicker}>Step 2 of 3 · Got your clip?</Text>
      <Text style={styles.title}>Bring in what you filmed.</Text>
      <Text style={styles.sub}>
        Pick the clip from your gallery. We'll show you a quick preview
        of how it would look.
      </Text>
      <PrimaryButton
        label={busy ? "Importing…" : "Import my clip"}
        onPress={onPick}
        disabled={busy}
        loading={busy}
      />
      <Text style={styles.privacy}>
        We only record the filename · the file stays on your device.
      </Text>
    </Animated.View>
  );
}

/* =================== Stage 3 · Preview =================== */

function PreviewStage({
  idea,
  clip,
  onDone,
  onSeeReview,
}: {
  idea: IdeaCardData;
  clip: FilmedClip;
  onDone: () => void;
  onSeeReview: () => void;
}) {
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
            {clip.filename}
            {typeof clip.durationSec === "number"
              ? ` · ${clip.durationSec}s`
              : ""}
          </Text>
        </View>
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
// promote this to `lib/pickVideo.ts`.
async function pickVideo(): Promise<FilmedClip | null> {
  if (Platform.OS === "web") {
    return {
      filename: `web-sim-clip-${Date.now()}.mp4`,
      durationSec: 22,
    };
  }
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== "granted") return null;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: false,
      quality: 0.7,
    });
    if (result.canceled) return null;
    const asset = result.assets[0];
    if (!asset) return null;
    const filename =
      asset.fileName ??
      asset.uri.split("/").pop() ??
      `clip-${Date.now()}.mp4`;
    const durationSec =
      typeof asset.duration === "number" && asset.duration > 0
        ? Math.round(asset.duration / 1000)
        : undefined;
    return { filename, durationSec, uri: asset.uri };
  } catch {
    return { filename: `fallback-${Date.now()}.mp4` };
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
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
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
});
