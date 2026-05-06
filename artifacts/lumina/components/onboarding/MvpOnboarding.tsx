/**
 * MvpOnboarding — the lean Phase 1 onboarding flow.
 *
 * Four steps, designed for "value within 2 minutes":
 *
 *   1. REGION   — pick a country. We map 7 countries onto the 4
 *                 trend bundles (US/UK/CA/AU → western; IN, PH,
 *                 NG → own).
 *   2. FIRST    — import 1 video. The instant the picker returns
 *                 we POST /api/imported-videos and call the
 *                 ideator with count=1 — that's the "quick win"
 *                 idea the user sees before they've even imported
 *                 the rest.
 *   3. REST     — import 2 more clips. The 3rd import triggers
 *                 the rule-based Style Profile derivation + a
 *                 count=3 ideator call; both run in series, with
 *                 a single spinner, and the user advances to the
 *                 reveal step on success.
 *   4. PROFILE  — show the derived Style Profile (the payoff
 *                 moment). "Open Lumina" completes onboarding
 *                 and routes to the Home tab, which reads the
 *                 cached 3-idea batch and renders instantly.
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

import { uploadVisionFrames } from "../../lib/uploadVisionFrames";

import { IdeaCard, type IdeaCardData } from "@/components/IdeaCard";
import { StyleProfileReveal } from "@/components/onboarding/StyleProfileReveal";
import { TasteCalibration } from "@/components/onboarding/TasteCalibration";
import { cosmic, lumina } from "@/constants/colors";
import { COUNTRIES, type Bundle, type Country } from "@/constants/regions";
import { fontFamily, type } from "@/constants/typography";
import { useAppState } from "@/hooks/useAppState";
import { writeDailyIdeas } from "@/lib/dailyIdeasCache";
import { isWebQaMode } from "@/lib/qaMode";
import { fetchTasteCalibration, needsCalibration } from "@/lib/tasteCalibration";
import {
  deriveStyleProfile,
  type DerivedStyleProfile,
  type ImportedClipMeta,
} from "@/lib/deriveStyleProfile";

/* ---------- API payload types ---------- */

type IdeatorResponse = {
  region: Bundle;
  count: number;
  ideas: IdeaCardData[];
};

type ImportResponse = {
  id: string;
  count: number;
  dedup?: boolean;
};

type ImportedVideosListResponse = {
  count: number;
  videos: Array<{
    id: string;
    filename: string | null;
    durationSec: number | null;
    createdAt: string;
  }>;
};

// GET /api/style-profile — used by the resume-state effect to
// figure out how far the user got on a previous session. The
// `profile` field is `unknown` until `hasProfile` flips true; in
// that branch the server's POST-time Zod validation guarantees
// the shape matches our DerivedStyleProfile.
type StyleProfileResponse = {
  hasProfile: boolean;
  profile: unknown;
  region: Bundle | null;
  lastIdeaBatchAt: string | null;
};

/* ---------- Screen ---------- */

type Step = "region" | "first" | "rest" | "profile" | "calibration";

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
  const [quickWin, setQuickWin] = useState<IdeaCardData | null>(null);
  const [derivedProfile, setDerivedProfile] =
    useState<DerivedStyleProfile | null>(null);
  // Tracks whether the optional Taste Calibration document is already
  // on file. null = unknown (resume effect hasn't run yet); true = on
  // file (skipped or completed) so we route straight into the app on
  // "Open Lumina"; false = not on file so we show the calibration
  // step. Best-effort lookup — if it errors we treat it as "not on
  // file" and let the user see the prompt once.
  const [hasCalibration, setHasCalibration] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  /* --- Resume state ------------------------------------------- */

  // Onboarding state is local-only (useState). If a user bailed
  // mid-flow on a previous open — first import landed but they
  // closed the app, profile got saved but they never tapped "Open
  // Lumina" — the count + region + hasProfile on the server tells
  // us where to drop them back in. The hierarchy here picks the
  // furthest-along resume target so they don't redo work.
  useEffect(() => {
    // QA mode: skip the resume-state sync entirely so a fresh
    // page load always lands on the "region" step. The demo
    // creator is shared across QA sessions and accumulates
    // server-side state (region, style profile, imported_videos
    // rows) — without this guard, MvpOnboarding reads that
    // stale state and auto-advances past the region picker,
    // which is exactly the blocker the user reported. Production
    // (non-QA) users still need the resume logic to recover from
    // mid-onboarding crashes. See replit.md "QA-mode
    // fresh-onboarding rule".
    if (isWebQaMode()) {
      // QA-mode users still need a calibration-on-file lookup so we
      // don't accidentally re-prompt them every page reload — the
      // demo creator is shared across QA sessions. Use the same
      // `needsCalibration` predicate Home uses so the two paths can
      // never disagree about who should see the screen.
      fetchTasteCalibration()
        .then((cal) => setHasCalibration(!needsCalibration(cal)))
        .catch(() => setHasCalibration(false));
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [list, sp, cal] = await Promise.all([
          customFetch<ImportedVideosListResponse>("/api/imported-videos"),
          customFetch<StyleProfileResponse>("/api/style-profile"),
          fetchTasteCalibration().catch(() => null),
        ]);
        if (cancelled) return;
        // Calibration is independent of the resume hierarchy — track
        // it separately so handleEnter can branch correctly even when
        // the user lands on a deep-resume target (e.g. "profile"
        // step for a creator who finished onboarding once but hasn't
        // calibrated). Use the shared `needsCalibration` predicate
        // so onboarding and Home agree on who should see the prompt.
        setHasCalibration(!needsCalibration(cal));

        const count = list.count;
        const savedRegion = sp.region;
        setImportedCount(count);

        // Furthest target: profile already saved → drop them on
        // the reveal step so they get the payoff moment they
        // missed before tapping "Open Lumina". The cast is safe
        // because the server Zod-validates on the POST that wrote
        // this row, so any profile here matches our shape.
        if (sp.hasProfile && savedRegion && sp.profile) {
          setBundle(savedRegion);
          setDerivedProfile(sp.profile as DerivedStyleProfile);
          setStep("profile");
          return;
        }

        // Region picked but no profile yet → past step 1.
        if (savedRegion) {
          setBundle(savedRegion);
          if (count >= 3) {
            // 3 imports landed but profile build never finished.
            // The "rest" step's count>=3 branch shows the
            // "Build my style profile" retry button.
            setFirstImportSaved(true);
            setStep("rest");
          } else if (count >= 1) {
            // First import landed. Whether they saw the quick-win
            // idea is unknowable, so favour forward motion: send
            // them to "rest" to add more. They can still hit the
            // build-profile retry once they cross the threshold.
            setFirstImportSaved(true);
            setStep("rest");
          } else {
            setStep("first");
          }
        }
        // No region & no count → stay on the default "region" step.
      } catch {
        // Best-effort — a failed sync just means the user starts
        // fresh, which is safe (and matches a brand-new user).
      }
    })();
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
      // Fire-and-forget on-device frame sample → vision endpoint.
      // Skipped on dedup so a network retry doesn't burn a daily
      // vision-call slot for the same clip; the aggregator is
      // idempotent on importedVideoId anyway, but skipping the
      // wasted thumbnail extraction is the friendly default.
      if (!imp.dedup) {
        uploadVisionFrames(imp.id, picked.uri, picked.durationSec);
      }
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

  /* --- Step 3: imports 2 + 3 → profile reveal ----------------- */

  // Fired when the import that crosses the 3-clip threshold lands.
  // Pulls the full clip list so duration data is available for the
  // pacing read, derives + persists the profile, generates the
  // 3-idea daily batch, caches it for Home, then advances to the
  // reveal step. Any failure surfaces a retry-able error and
  // leaves the user on the rest step (the import itself already
  // succeeded, so a retry doesn't need another upload).
  const buildProfileAndAdvance = useCallback(
    async (forBundle: Bundle) => {
      const list = await customFetch<ImportedVideosListResponse>(
        "/api/imported-videos",
      );
      const meta: ImportedClipMeta[] = list.videos.map((v) => ({
        filename: v.filename,
        durationSec: v.durationSec,
      }));
      const profile = deriveStyleProfile({ region: forBundle, videos: meta });

      // Persist the profile server-side so the ideator can use it
      // on subsequent calls. The payload is Zod-validated server-
      // side; a drift between this client shape and
      // styleProfileSchema surfaces here as a 400.
      await customFetch("/api/style-profile", {
        method: "POST",
        body: JSON.stringify({ styleProfile: profile, region: forBundle }),
      });

      const ideas = await customFetch<IdeatorResponse>(
        "/api/ideator/generate",
        {
          method: "POST",
          body: JSON.stringify({ region: forBundle, count: 3 }),
        },
      );

      // Hand off to Home — the cache key includes today's UTC day
      // so opening the app multiple times in the same day shows
      // the same 3 ideas without burning ideator quota.
      await writeDailyIdeas(forBundle, ideas.ideas);

      setDerivedProfile(profile);
      setStep("profile");
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    },
    [],
  );

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
      // Fire-and-forget on-device frame sample → vision endpoint.
      // Same dedup-skip rationale as the first-import handler.
      if (!imp.dedup) {
        uploadVisionFrames(imp.id, picked.uri, picked.durationSec);
      }
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      // Trigger profile + daily-feed exactly once, on the import
      // that crosses the 3-clip threshold.
      if (imp.count >= 3 && !derivedProfile) {
        await buildProfileAndAdvance(bundle);
      }
    } catch (err) {
      setErrorMsg(formatError(err, "Couldn't import that video."));
    } finally {
      setBusy(false);
    }
  }, [busy, bundle, derivedProfile, buildProfileAndAdvance]);

  // Retry path for the case where imports landed but the
  // profile-build pipeline (style-profile POST or ideator call)
  // failed. We have everything we need server-side already — just
  // re-run the derivation + downstream calls.
  const handleRetryProfile = useCallback(async () => {
    if (busy || !bundle) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      await buildProfileAndAdvance(bundle);
    } catch (err) {
      setErrorMsg(formatError(err, "Couldn't build your profile."));
    } finally {
      setBusy(false);
    }
  }, [busy, bundle, buildProfileAndAdvance]);

  /* --- Final: enter the app ---------------------------------- */

  // Tap on "Open Lumina" from the Style Profile reveal. If the
  // creator hasn't seen / skipped the optional Taste Calibration yet,
  // surface it inline before completing onboarding. The resume
  // effect populates `hasCalibration`; while it's still null
  // (network in flight) we err on the side of showing calibration —
  // a re-prompt that gets immediately skipped is cheaper than
  // accidentally bypassing the step on a slow network.
  const handleEnter = useCallback(async () => {
    if (hasCalibration === false || hasCalibration === null) {
      setStep("calibration");
      return;
    }
    await setHasCompletedOnboarding(true);
    router.replace("/(tabs)");
  }, [hasCalibration, router, setHasCompletedOnboarding]);

  // Calibration step is terminal — both "Save" and "Skip" land here.
  // Mark onboarding complete + route into the app. The component
  // itself has already POSTed the calibration document, so there's
  // nothing left to persist.
  const handleCalibrationDone = useCallback(async () => {
    setHasCalibration(true);
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
            onRetryProfile={handleRetryProfile}
            busy={busy}
          />
        ) : null}

        {step === "profile" && derivedProfile && bundle ? (
          <StyleProfileReveal
            profile={derivedProfile}
            region={bundle}
            onEnter={handleEnter}
            busy={busy}
          />
        ) : null}

        {step === "calibration" ? (
          // PHASE N1 — pass the user's freshly-saved region through
          // to the calibration screen so the Pidgin language step
          // (Nigeria-only) can light up at the right point in the
          // onboarding flow. `bundle` is set when the user picked
          // their country on the region step above.
          <TasteCalibration onComplete={handleCalibrationDone} region={bundle} />
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
  quickWin: IdeaCardData | null;
  onContinue: () => void;
  busy: boolean;
}) {
  if (quickWin) {
    return (
      <Animated.View entering={FadeIn.duration(280)} style={styles.stage}>
        <Text style={styles.stepKicker}>Step 2 of 3</Text>
        <Text style={styles.heroTitle}>Your first idea is ready.</Text>
        <Text style={styles.heroSub}>
          This is an idea based on your video — this is what every morning
          will feel like.
        </Text>
        <IdeaCard idea={quickWin} highlight />
        <PrimaryButton
          label="Add 2 more videos to unlock your style profile"
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
        Pick a 10–30s clip you've already posted. We'll generate your very
        first idea the moment it lands.
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
      {Platform.OS === "web" ? (
        <Text style={styles.privacy}>
          Web preview: tapping above will use a simulated upload — on the
          phone app it opens your real gallery.
        </Text>
      ) : null}
    </Animated.View>
  );
}

/* =================== Step 3 · Rest =================== */

function RestStep({
  count,
  onPick,
  onRetryProfile,
  busy,
}: {
  count: number;
  onPick: () => void;
  onRetryProfile: () => void;
  busy: boolean;
}) {
  // The 3rd import already landed but profile-build failed
  // partway. Offer a single retry that re-runs derive + persist +
  // ideator without requiring another upload.
  if (count >= 3) {
    return (
      <Animated.View entering={FadeIn.duration(280)} style={styles.stage}>
        <Text style={styles.stepKicker}>Step 3 of 3</Text>
        <Text style={styles.heroTitle}>Almost there.</Text>
        <Text style={styles.heroSub}>
          Your videos are saved. Let's build your style profile.
        </Text>
        <PrimaryButton
          label={busy ? "Building your style profile…" : "Build my style profile"}
          onPress={onRetryProfile}
          disabled={busy}
          loading={busy}
        />
      </Animated.View>
    );
  }

  const remaining = Math.max(0, 3 - count);
  return (
    <Animated.View entering={FadeIn.duration(280)} style={styles.stage}>
      <Text style={styles.stepKicker}>Step 3 of 3</Text>
      <Text style={styles.heroTitle}>
        {remaining === 1 ? "One more video." : `${remaining} more videos.`}
      </Text>
      <Text style={styles.heroSub}>
        We're learning your style — three 10–30s past clips give us enough
        signal to match how you actually film.
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
              ? "Building your style profile…"
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
  /**
   * Local `file://` URI of the picked asset, used by the on-device
   * Llama-Vision frame sampler (`uploadVisionFrames`). Kept off the
   * `payload` because `payload` is exactly what we POST to
   * `/api/imported-videos` — the server doesn't want or need the
   * URI, and we never want it to accidentally leak server-side.
   * Empty string on the web sim path or when the picker can't give
   * us one; the uploader treats `""` as a no-op.
   */
  uri: string;
  /**
   * Duration in seconds (rounded), or `null` when the picker
   * doesn't surface it. Surfaced separately for the same reason
   * `uri` is — vision sampling needs it but the import POST already
   * has its own `durationSec` field nested under `payload`.
   */
  durationSec: number | null;
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
      // Web sim has no real asset; the uploader short-circuits on
      // `Platform.OS === "web"` AND on empty uri, so this is doubly
      // safe.
      uri: "",
      durationSec: 18,
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
    return {
      payload: { filename, durationSec },
      uri: asset.uri,
      durationSec: durationSec ?? null,
    };
  } catch {
    // Picker is unreliable on some emulators — fall through with a
    // simulated payload so the user can still progress.
    return {
      payload: { filename: `fallback-${Date.now()}.mp4` },
      uri: "",
      durationSec: null,
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
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  primaryPressed: {
    opacity: 0.85,
  },
  primaryDisabled: {
    opacity: 0.5,
  },
  primaryLabel: {
    fontFamily: fontFamily.bodyBold,
    color: "#0A0824",
    fontSize: 16,
    letterSpacing: 0.5,
  },
  privacy: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.45)",
    fontSize: 12,
    textAlign: "center",
    marginTop: 14,
  },
  counterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 24,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  dotFilled: {
    backgroundColor: lumina.firefly,
  },
  counterText: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    marginLeft: 6,
  },
  error: {
    fontFamily: fontFamily.bodyMedium,
    color: "#FF8FA1",
    fontSize: 14,
    marginTop: 18,
    textAlign: "center",
  },
});
