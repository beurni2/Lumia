/**
 * MvpOnboarding — the lean Phase 1 onboarding flow.
 *
 * Three steps, designed for "value within 2 minutes":
 *
 *   1. REGION  — pick a country. We map 7 countries onto the 4 trend
 *                bundles (US/UK/CA/AU → western; IN, PH, NG → own).
 *   2. FIRST   — import 1 video. The instant the picker returns, we
 *                POST /api/imported-videos and call the ideator with
 *                count=1 in parallel — that's the "quick win" idea
 *                the user sees before they've even imported the rest.
 *   3. REST    — import 2 more. On the third, fire the ideator with
 *                count=3 to reveal the full daily feed, then advance
 *                to (tabs).
 *
 * No consent gate, no orb, no fireflies — those are scoped to the
 * cinematic flow which remains behind the
 * EXPO_PUBLIC_USE_CINEMATIC_ONBOARDING flag.
 *
 * The two POSTs (imported-videos + ideator) are not yet in the
 * OpenAPI spec, so we go straight through `customFetch`, which still
 * gets the bearer-token + base-URL handling from _layout.tsx.
 */

import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useState } from "react";
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

import { ApiError, customFetch } from "@workspace/api-client-react";
import { cosmic, lumina } from "@/constants/colors";
import { fontFamily, type } from "@/constants/typography";
import { useAppState } from "@/hooks/useAppState";

/* ---------- Region mapping ---------- */

type Bundle = "western" | "india" | "philippines" | "nigeria";

type Country = {
  code: string;
  name: string;
  bundle: Bundle;
};

// Order chosen so the four "western" bundle countries cluster at the top
// and the three single-bundle countries follow — least surprise for a
// first-time user scanning the list.
const COUNTRIES: readonly Country[] = [
  { code: "US", name: "United States", bundle: "western" },
  { code: "GB", name: "United Kingdom", bundle: "western" },
  { code: "CA", name: "Canada", bundle: "western" },
  { code: "AU", name: "Australia", bundle: "western" },
  { code: "IN", name: "India", bundle: "india" },
  { code: "PH", name: "Philippines", bundle: "philippines" },
  { code: "NG", name: "Nigeria", bundle: "nigeria" },
];

/* ---------- API payload types ---------- */

type Idea = {
  id: string;
  hook: string;
  hookSeconds: number;
  videoLengthSec: number;
  filmingTimeMin: number;
  payoff: string;
  payoffType?: string;
  visualHook?: string;
};

type IdeatorResponse = {
  region: Bundle;
  count: number;
  ideas: Idea[];
};

type ImportResponse = {
  id: string;
  count: number;
  dedup?: boolean;
};

type CountResponse = {
  count: number;
};

/* ---------- Screen ---------- */

type Step = "region" | "first" | "rest";

export default function MvpOnboarding() {
  const router = useRouter();
  const { setHasCompletedOnboarding } = useAppState();
  const [step, setStep] = useState<Step>("region");
  const [bundle, setBundle] = useState<Bundle | null>(null);
  // Total imported clips (incl. the first one). Drives the counter on
  // the "rest" step so the UI stays in sync with the server even if
  // /api/imported-videos is hit out-of-band on another device.
  const [importedCount, setImportedCount] = useState(0);
  // Tracks whether step 2's import POST has succeeded. The split lets
  // a user retry just the ideator call (which can fail independently —
  // e.g. transient AI provider error) without re-importing the clip
  // and consuming a duplicate row.
  const [firstImportSaved, setFirstImportSaved] = useState(false);
  const [quickWin, setQuickWin] = useState<Idea | null>(null);
  const [dailyFeed, setDailyFeed] = useState<Idea[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  /* --- One-time sync ------------------------------------------ */

  // Seed the counter from the server. Handles the case where the
  // user bounced out of onboarding mid-flight (AsyncStorage cleared,
  // server rows still there) — without this the UI would silently
  // lie about how many clips are saved.
  useEffect(() => {
    let cancelled = false;
    customFetch<CountResponse>("/api/imported-videos")
      .then((res) => {
        if (!cancelled) setImportedCount(res.count);
      })
      .catch(() => {
        // Swallow — a failed sync just means the counter starts at
        // zero, which is the safe default for a new user.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* --- Step 1: region picked ---------------------------------- */

  const handlePickRegion = useCallback(
    async (country: Country) => {
      if (busy) return;
      setBusy(true);
      setErrorMsg(null);
      try {
        await customFetch("/api/style-profile", {
          method: "POST",
          body: JSON.stringify({ region: country.bundle }),
        });
        if (Platform.OS !== "web") {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        setBundle(country.bundle);
        setStep("first");
      } catch (err) {
        setErrorMsg(formatError(err, "Couldn't save your region."));
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  /* --- Step 2: first video imported → quick win --------------- */

  // Pulled out so the "Generate my first idea" retry path can reuse
  // it when the import already landed but the ideator call failed.
  const generateFirstIdea = useCallback(
    async (forBundle: Bundle) => {
      const ideas = await customFetch<IdeatorResponse>(
        "/api/ideator/generate",
        {
          method: "POST",
          body: JSON.stringify({ region: forBundle, count: 1 }),
        },
      );
      const first = ideas.ideas[0];
      if (!first) {
        throw new Error("No idea returned");
      }
      return first;
    },
    [],
  );

  const handleFirstImport = useCallback(async () => {
    if (busy || !bundle) return;
    // Lock BEFORE awaiting the picker so a fast double-tap can't
    // open two pickers concurrently. We release inside `finally`,
    // including the cancel branch.
    setBusy(true);
    setErrorMsg(null);
    try {
      const picked = await pickVideo();
      if (!picked) return;
      // Sequential, not parallel: persist the clip first so a
      // failed ideator call doesn't strand us with a generated
      // idea but no record of the source clip (which would
      // confuse the daily-feed gate at step 3).
      const imp = await customFetch<ImportResponse>("/api/imported-videos", {
        method: "POST",
        body: JSON.stringify(picked.payload),
      });
      setImportedCount(imp.count);
      setFirstImportSaved(true);
      const first = await generateFirstIdea(bundle);
      setQuickWin(first);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      setErrorMsg(formatError(err, "Couldn't generate your first idea."));
    } finally {
      setBusy(false);
    }
  }, [busy, bundle, generateFirstIdea]);

  // Retry path — only fires the ideator call. Used when the import
  // succeeded on a prior tap but the ideator call failed (transient
  // provider error, network blip). Avoids re-inserting the clip,
  // which would inflate the count and skew step 3's gating.
  const handleRetryFirstIdea = useCallback(async () => {
    if (busy || !bundle) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const first = await generateFirstIdea(bundle);
      setQuickWin(first);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      setErrorMsg(formatError(err, "Couldn't generate your first idea."));
    } finally {
      setBusy(false);
    }
  }, [busy, bundle, generateFirstIdea]);

  /* --- Step 3: imports 2 + 3 → daily feed --------------------- */

  const handleAdditionalImport = useCallback(async () => {
    if (busy || !bundle) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const picked = await pickVideo();
      if (!picked) return;
      const imp = await customFetch<ImportResponse>("/api/imported-videos", {
        method: "POST",
        body: JSON.stringify(picked.payload),
      });
      setImportedCount(imp.count);
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      // Trigger the full daily feed exactly once, on the import that
      // crosses the 3-clip threshold. Server quota allows a second
      // batch (regenerate) so this won't burn the user's day.
      if (imp.count >= 3 && !dailyFeed) {
        const ideas = await customFetch<IdeatorResponse>(
          "/api/ideator/generate",
          {
            method: "POST",
            body: JSON.stringify({ region: bundle, count: 3 }),
          },
        );
        setDailyFeed(ideas.ideas);
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      }
    } catch (err) {
      setErrorMsg(formatError(err, "Couldn't import that video."));
    } finally {
      setBusy(false);
    }
  }, [busy, bundle, dailyFeed]);

  /* --- Final: enter the app ---------------------------------- */

  const handleEnter = useCallback(async () => {
    await setHasCompletedOnboarding(true);
    router.replace("/(tabs)");
  }, [router, setHasCompletedOnboarding]);

  /* --- Render ------------------------------------------------- */

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {step === "region" ? (
          <RegionStep
            countries={COUNTRIES}
            onPick={handlePickRegion}
            busy={busy}
          />
        ) : null}

        {step === "first" ? (
          <FirstStep
            onPick={handleFirstImport}
            onRetryIdea={handleRetryFirstIdea}
            firstImportSaved={firstImportSaved}
            quickWin={quickWin}
            onContinue={() => setStep("rest")}
            busy={busy}
          />
        ) : null}

        {step === "rest" ? (
          <RestStep
            count={importedCount}
            onPick={handleAdditionalImport}
            dailyFeed={dailyFeed}
            onEnter={handleEnter}
            busy={busy}
          />
        ) : null}

        {errorMsg ? (
          <Animated.View entering={FadeIn} exiting={FadeOut}>
            <Text style={styles.error}>{errorMsg}</Text>
          </Animated.View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/* =================== Step 1 · Region =================== */

function RegionStep({
  countries,
  onPick,
  busy,
}: {
  countries: readonly Country[];
  onPick: (c: Country) => void;
  busy: boolean;
}) {
  return (
    <Animated.View entering={FadeIn.duration(280)} style={styles.stage}>
      <Text style={styles.stepKicker}>Step 1 of 3</Text>
      <Text style={styles.heroTitle}>Where do you create?</Text>
      <Text style={styles.heroSub}>
        We tune your ideas to the trends, slang, and humour of your audience.
      </Text>

      <View style={styles.countryList}>
        {countries.map((c) => (
          <Pressable
            key={c.code}
            onPress={() => onPick(c)}
            disabled={busy}
            style={({ pressed }) => [
              styles.countryBtn,
              pressed && !busy ? styles.countryBtnPressed : null,
              busy ? styles.countryBtnDisabled : null,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Choose ${c.name}`}
          >
            <Text style={styles.countryCode}>{c.code}</Text>
            <Text style={styles.countryName}>{c.name}</Text>
          </Pressable>
        ))}
      </View>

      {busy ? (
        <ActivityIndicator color={lumina.firefly} style={{ marginTop: 24 }} />
      ) : null}
    </Animated.View>
  );
}

/* =================== Step 2 · First import =================== */

function FirstStep({
  onPick,
  onRetryIdea,
  firstImportSaved,
  quickWin,
  onContinue,
  busy,
}: {
  onPick: () => void;
  onRetryIdea: () => void;
  firstImportSaved: boolean;
  quickWin: Idea | null;
  onContinue: () => void;
  busy: boolean;
}) {
  if (quickWin) {
    return (
      <Animated.View entering={FadeIn.duration(280)} style={styles.stage}>
        <Text style={styles.stepKicker}>Step 2 of 3</Text>
        <Text style={styles.heroTitle}>Your first idea is ready.</Text>
        <Text style={styles.heroSub}>
          Built around your region. This is what every morning will feel like.
        </Text>
        <IdeaCard idea={quickWin} highlight />
        <PrimaryButton
          label="Add 2 more videos to unlock your daily feed"
          onPress={onContinue}
        />
      </Animated.View>
    );
  }

  // Retry path — clip is in, idea generation failed. Reusing the
  // already-imported clip avoids inflating the count and burning a
  // second slot in the daily ideator quota.
  if (firstImportSaved) {
    return (
      <Animated.View entering={FadeIn.duration(280)} style={styles.stage}>
        <Text style={styles.stepKicker}>Step 2 of 3</Text>
        <Text style={styles.heroTitle}>Almost there.</Text>
        <Text style={styles.heroSub}>
          Your video is saved. Let's try generating your first idea again.
        </Text>
        <PrimaryButton
          label={busy ? "Generating your first idea…" : "Generate my first idea"}
          onPress={onRetryIdea}
          disabled={busy}
          loading={busy}
        />
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={FadeIn.duration(280)} style={styles.stage}>
      <Text style={styles.stepKicker}>Step 2 of 3</Text>
      <Text style={styles.heroTitle}>Show me one of your videos.</Text>
      <Text style={styles.heroSub}>
        We'll generate your very first idea the moment it lands.
      </Text>
      <PrimaryButton
        label={busy ? "Generating your first idea…" : "Import a video"}
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

/* =================== Step 3 · Rest =================== */

function RestStep({
  count,
  onPick,
  dailyFeed,
  onEnter,
  busy,
}: {
  count: number;
  onPick: () => void;
  dailyFeed: Idea[] | null;
  onEnter: () => void;
  busy: boolean;
}) {
  if (dailyFeed) {
    return (
      <Animated.View entering={FadeIn.duration(280)} style={styles.stage}>
        <Text style={styles.stepKicker}>Step 3 of 3 · ready</Text>
        <Text style={styles.heroTitle}>Your daily feed.</Text>
        <Text style={styles.heroSub}>
          Three fresh ideas every day. Pick the one you want to film.
        </Text>
        {dailyFeed.map((idea, i) => (
          <IdeaCard key={idea.id} idea={idea} index={i + 1} />
        ))}
        <PrimaryButton label="Open Lumina" onPress={onEnter} />
      </Animated.View>
    );
  }

  const remaining = Math.max(0, 3 - count);
  return (
    <Animated.View entering={FadeIn.duration(280)} style={styles.stage}>
      <Text style={styles.stepKicker}>Step 3 of 3</Text>
      <Text style={styles.heroTitle}>
        {remaining === 1
          ? "One more video."
          : `${remaining} more videos.`}
      </Text>
      <Text style={styles.heroSub}>
        Three clips is the sweet spot — enough for your daily feed.
      </Text>

      <View style={styles.counterRow}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={[styles.dot, i < count ? styles.dotFilled : null]}
          />
        ))}
        <Text style={styles.counterText}>{count} / 3</Text>
      </View>

      <PrimaryButton
        label={
          busy
            ? count >= 2
              ? "Building your daily feed…"
              : "Adding your video…"
            : "Import another video"
        }
        onPress={onPick}
        disabled={busy}
        loading={busy}
      />
    </Animated.View>
  );
}

/* =================== Idea card =================== */

function IdeaCard({
  idea,
  index,
  highlight,
}: {
  idea: Idea;
  index?: number;
  highlight?: boolean;
}) {
  return (
    <View
      style={[styles.card, highlight ? styles.cardHighlight : null]}
      accessibilityRole="summary"
    >
      <View style={styles.cardHeader}>
        <Text style={styles.cardKicker}>
          {index ? `idea ${index}` : "first idea"} · hook {idea.hookSeconds}s
        </Text>
        <Text style={styles.cardKickerRight}>
          {idea.videoLengthSec}s · film in {idea.filmingTimeMin}m
        </Text>
      </View>
      <Text style={styles.cardHook}>{idea.hook}</Text>
      <Text style={styles.cardLabel}>Payoff</Text>
      <Text style={styles.cardBody}>{idea.payoff}</Text>
      {idea.visualHook ? (
        <>
          <Text style={styles.cardLabel}>Open with</Text>
          <Text style={styles.cardBody}>{idea.visualHook}</Text>
        </>
      ) : null}
    </View>
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
      disabled={disabled}
      style={({ pressed }) => [
        styles.primary,
        pressed && !disabled ? styles.primaryPressed : null,
        disabled ? styles.primaryDisabled : null,
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

/* =================== Helpers =================== */

type PickedClip = {
  payload: { filename?: string; durationSec?: number };
};

async function pickVideo(): Promise<PickedClip | null> {
  // Web has no system video picker in the Replit preview iframe — we
  // simulate a successful pick so the dev workflow stays usable.
  if (Platform.OS === "web") {
    return {
      payload: {
        filename: `web-sim-${Date.now()}.mp4`,
        durationSec: 18,
      },
    };
  }
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== "granted") {
      return null;
    }
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
    return { payload: { filename, durationSec } };
  } catch {
    // Picker is unreliable on some emulators — fall through with a
    // simulated payload so the user can still progress.
    return {
      payload: { filename: `fallback-${Date.now()}.mp4` },
    };
  }
}

function formatError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    return err.message ?? fallback;
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback;
}

/* =================== Styles =================== */

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: cosmic.voidTop,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 72,
    paddingBottom: 48,
  },
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
  countryList: {
    gap: 10,
    marginTop: 4,
  },
  countryBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  countryBtnPressed: {
    backgroundColor: "rgba(0,255,204,0.1)",
    borderColor: lumina.firefly,
  },
  countryBtnDisabled: {
    opacity: 0.4,
  },
  countryCode: {
    fontFamily: fontFamily.bodyBold,
    color: lumina.firefly,
    fontSize: 13,
    letterSpacing: 1.2,
    width: 38,
  },
  countryName: {
    fontFamily: fontFamily.bodyMedium,
    color: "#FFFFFF",
    fontSize: 16,
  },
  primary: {
    backgroundColor: lumina.firefly,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 22,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
    minHeight: 54,
  },
  primaryPressed: {
    backgroundColor: lumina.fireflySoft,
  },
  primaryDisabled: {
    opacity: 0.55,
  },
  primaryLabel: {
    fontFamily: fontFamily.bodySemiBold,
    color: "#0A0824",
    fontSize: 15,
    textAlign: "center",
  },
  privacy: {
    ...type.body,
    color: "rgba(0,255,204,0.6)",
    fontSize: 12,
    textAlign: "center",
    marginTop: 18,
  },
  counterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
    marginBottom: 24,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.3)",
  },
  dotFilled: {
    backgroundColor: lumina.firefly,
    borderColor: lumina.firefly,
  },
  counterText: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    marginLeft: 6,
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 16,
    padding: 18,
    marginTop: 16,
  },
  cardHighlight: {
    borderColor: "rgba(0,255,204,0.4)",
    backgroundColor: "rgba(0,255,204,0.06)",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  cardKicker: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  cardKickerRight: {
    ...type.body,
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
    letterSpacing: 0.6,
  },
  cardHook: {
    fontFamily: fontFamily.bodyBold,
    color: "#FFFFFF",
    fontSize: 20,
    lineHeight: 26,
    marginBottom: 12,
  },
  cardLabel: {
    fontFamily: fontFamily.bodySemiBold,
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    marginTop: 8,
    marginBottom: 4,
  },
  cardBody: {
    ...type.body,
    color: "rgba(255,255,255,0.85)",
    fontSize: 14,
    lineHeight: 20,
  },
  error: {
    ...type.body,
    color: "#FF6BBD",
    fontSize: 13,
    textAlign: "center",
    marginTop: 18,
  },
});
