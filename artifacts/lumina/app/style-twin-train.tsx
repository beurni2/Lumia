/**
 * Style Twin Training — low-friction style capture.
 *
 * A four-stage flow whose heavy "upload 10 then ignite a ritual"
 * shape has been deliberately softened: the user only needs ONE clip
 * to get value (an immediate idea via the ideator) and full training
 * (10 clips) is optional. The cinematic visuals are preserved but
 * the ritual / hive / memory-garden / "twin" wording is gone from
 * user-facing copy. Stages are local UI state; the backend wiring
 * (`train` / `retrain` / `grantConsent`, ImagePicker, the inference
 * adapter, the `useStyleTwin` refresh) is preserved end-to-end.
 *
 * Low-friction onboarding rule
 * ----------------------------
 *  • Headers/CTAs read like a friend, not a wizard. No "twin",
 *    "swarm", "hive", "ignite", "memory garden", "ritual".
 *  • The only required action to see value is uploading ONE clip.
 *    After it lands we surface "Got it — I see your style." + a
 *    "Try one idea →" CTA that generates a single idea (count=1
 *    against `/api/ideator/generate`) and routes the user into the
 *    create flow. Training (10 clips → `train()`) is offered as an
 *    optional polish step once they've added that many.
 *  • Progress is framed as "X / 10 videos added" — never as work
 *    remaining ("X more"). "You can add more anytime." footnote is
 *    always visible during invitation/garden.
 *
 *   1. Invitation  — TwinOrb sleeps in a private cosmic greenhouse.
 *                    Lily-pad memory orbs bob below. "Begin Training"
 *                    portal wakes the orb.
 *   2. Garden      — Memory orbs become interactive. Each upload lights
 *                    one with a bioluminescent vein and triggers an
 *                    agent feedback bubble. Reaches threshold → ignite.
 *   3. Ritual      — Memory orbs converge into orbit around the Twin,
 *                    accelerate inward, and collapse into a supernova.
 *                    Real `train()` / `retrain()` resolves under cover
 *                    of the choreography (with a min duration so the
 *                    cinematic always plays in full).
 *   4. Welcome     — Twin emerges, addresses the user, and offers the
 *                    portal into Swarm Studio.
 *
 * Memory-orb layout uses a circular "flower" arrangement around the
 * central TwinOrb. During the ritual a single shared `ritualPhase` value
 * drives all orbs through grid → orbit → consumed via interpolation.
 */

import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { Redirect, router, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  FadeOut,
  ZoomIn,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  MIN_SAMPLES,
  grantConsent,
  retrain,
  train,
  type VideoSample,
} from "@workspace/style-twin";
import { customFetch } from "@workspace/api-client-react";

import { CosmicBackdrop } from "@/components/foundation/CosmicBackdrop";
import { FireflyParticles } from "@/components/foundation/FireflyParticles";
import { GlassSurface } from "@/components/foundation/GlassSurface";
import { PortalButton } from "@/components/foundation/PortalButton";
import { StyleTwinOrb } from "@/components/foundation/StyleTwinOrb";
import { LightExplosion } from "@/components/studio/LightExplosion";
import { ReasoningBubble } from "@/components/studio/ReasoningBubble";
import { type IdeaCardData } from "@/components/IdeaCard";
import { agents, lumina, type AgentKey } from "@/constants/colors";
import { spring } from "@/constants/motion";
import { type } from "@/constants/typography";
import { useStyleTwin } from "@/hooks/useStyleTwin";
import { flags } from "@/lib/featureFlags";
import { getInferenceAdapter } from "@/lib/inferenceFactory";

/** Shape of POST /api/ideator/generate. We only consume `ideas[0]`
 *  for the "Try one idea →" path; region/count are echoed for debug. */
type IdeatorResponse = {
  region: string;
  count: number;
  ideas: IdeaCardData[];
};

type Phase = "invitation" | "garden" | "ritual" | "welcome";

/** Agent feedback pool — one phrase fires per upload, randomised but
 *  weighted so every agent gets at least one credit before repeats. */
const AGENT_LINES: Record<AgentKey, string[]> = {
  ideator: [
    "Ooh — that opener has range. Saving that energy.",
    "There's a beat in your pacing I'm already obsessed with.",
    "This is the kind of frame that travels. Hooked.",
  ],
  director: [
    "Loving this lighting — your golden hour vibe is chef's kiss.",
    "Look at that camera move. Already learning your blocking.",
    "That cut feels like you. Filing it away.",
  ],
  editor: [
    "That signature laugh at 0:18? I'm already obsessed.",
    "The mid-clip silence — quiet flex. Got it.",
    "Your retention curve is going to love this rhythm.",
  ],
  monetizer: [
    "Brand-safe and on-vibe. Future deals will fit beautifully here.",
    "Audience match instinct just lit up. Keep going.",
    "This is the one I'd pitch to a beauty house. Noted.",
  ],
};

const AGENT_ORDER: AgentKey[] = ["ideator", "director", "editor", "monetizer"];

/** Minimum duration of the ritual stage so the cinematic always lands,
 *  even when on-device training resolves in <100 ms (mock mode). */
const MIN_RITUAL_MS = 3200;

export default function StyleTwinTrainScreen() {
  // PHASE UX3.3 — defensive route-level guard. The closed-beta nav
  // never links to /style-twin-train (gated CTAs in profile, studio,
  // publisher), but a stale history entry could still land here.
  // Redirect to the tab bar. Safe early-return: the flag is computed
  // once at module load from a process.env value.
  if (!flags.SHOW_POST_BETA_SURFACES) {
    return <Redirect href="/(tabs)" />;
  }
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const { twin, refresh } = useStyleTwin();
  const adapter = useMemo(() => getInferenceAdapter(), []);

  const isRetrain = !!twin;
  // Brief: minimum 7 sparks the system, the remaining 3 sharpen it.
  // We honour MIN_SAMPLES (10) for first-time training as the package's
  // contract requires, but surface the 7 threshold as the "ignite is
  // unlocked" gate inside the UI when retraining for delight parity.
  const required = isRetrain ? 1 : MIN_SAMPLES;

  const [phase, setPhase] = useState<Phase>("invitation");
  const [samples, setSamples] = useState<VideoSample[]>([]);
  const [feedback, setFeedback] = useState<{
    agent: AgentKey;
    text: string;
    nonce: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // True while the "Try one idea →" CTA is awaiting the ideator. Kept
  // separate from `busy`-style locks so the orb taps and the optional
  // "Save my style" path remain interactive while the ideator works.
  const [tryingIdea, setTryingIdea] = useState(false);

  const ready = samples.length >= required;

  // ── Upload ─────────────────────────────────────────────────────────
  const pickVideos = useCallback(
    async (singleSlot?: boolean) => {
      if (phase !== "garden" && phase !== "invitation") return;
      // Auto-advance into the garden the first time the user touches an orb.
      if (phase === "invitation") setPhase("garden");
      setError(null);

      const remainingSlots = required - samples.length;
      if (remainingSlots <= 0) return;

      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsMultipleSelection: !singleSlot && remainingSlots > 1,
        selectionLimit: singleSlot ? 1 : remainingSlots,
        quality: 1,
      });
      if (res.canceled) return;

      const fresh: VideoSample[] = res.assets.map((a, i) => ({
        id: `${Date.now()}-${i}-${a.assetId ?? a.uri.slice(-12)}`,
        uri: a.uri,
        durationMs: a.duration ?? 0,
        capturedAt: Date.now(),
      }));
      const next = [...samples, ...fresh].slice(0, required);
      setSamples(next);

      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      }

      // Surface an agent compliment for the *latest* upload only — random
      // agent picked deterministically by sample count so retries don't
      // spam the same line.
      const nth = next.length - 1;
      const agent = AGENT_ORDER[nth % AGENT_ORDER.length]!;
      const lines = AGENT_LINES[agent];
      const text = lines[nth % lines.length]!;
      setFeedback({ agent, text, nonce: Date.now() });
    },
    [phase, required, samples],
  );

  const removeSample = useCallback(
    (id: string) => {
      if (phase !== "garden") return;
      setSamples((prev) => prev.filter((s) => s.id !== id));
      if (Platform.OS !== "web") {
        Haptics.selectionAsync().catch(() => {});
      }
    },
    [phase],
  );

  // Auto-clear the feedback bubble after a few seconds so it doesn't pile up.
  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 4200);
    return () => clearTimeout(t);
  }, [feedback]);

  // ── Ritual choreography (shared values) ─────────────────────────────
  const ritualConverge = useSharedValue(0); // 0 grid → 1 orbiting
  const ritualOrbitT = useSharedValue(0); // continuous rotation 0..1
  const ritualCollapse = useSharedValue(0); // 0 spread → 1 consumed
  const explosionActive = useSharedValue(false);
  const [explosionOn, setExplosionOn] = useState(false);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const igniteRitual = useCallback(async () => {
    if (!ready || phase !== "garden") return;
    setPhase("ritual");
    setFeedback(null);

    if (Platform.OS !== "web") {
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Warning,
      ).catch(() => {});
    }

    // Animation timeline:
    //   0.0 – 1.2 s  orbs converge from grid into an orbital ring
    //   0.6 – ∞      orbit time accelerates (continuous spin)
    //   1.6 – 2.6 s  collapse: orbs spiral inward into the Twin core
    //   2.8 – 3.2 s  light explosion bloom, then welcome
    ritualConverge.value = withTiming(1, {
      duration: 1200,
      easing: Easing.out(Easing.cubic),
    });
    ritualOrbitT.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.linear }),
      -1,
      false,
    );
    setTimeout(() => {
      if (!mountedRef.current) return;
      ritualCollapse.value = withTiming(1, {
        duration: 1100,
        easing: Easing.in(Easing.quad),
      });
    }, 1600);

    const ritualMin = new Promise<void>((r) => setTimeout(r, MIN_RITUAL_MS));

    try {
      const trainPromise = isRetrain
        ? retrain(samples, adapter, grantConsent("retrain"))
        : train(samples, adapter, grantConsent("train"));
      // We don't actually need the result here — `useStyleTwin.refresh()`
      // re-loads the persisted twin from storage after success. We do
      // need both the cinematic-min and the train to settle before
      // moving on, and we need to surface train errors honestly.
      const [, ] = await Promise.all([trainPromise, ritualMin]);
      if (!mountedRef.current) return;
      await refresh();
      // Light explosion is the punctuation between ritual and welcome.
      setExplosionOn(true);
      explosionActive.value = true;
    } catch (e) {
      if (!mountedRef.current) return;
      const msg = e instanceof Error ? e.message : "Training stumbled.";
      setError(msg);
      // Roll back to garden so the user can retry without re-uploading.
      // Cancel the infinite orbit repeat first — otherwise the rotation
      // would keep advancing under the hood and orbs would jump on retry.
      cancelAnimation(ritualOrbitT);
      ritualOrbitT.value = 0;
      ritualConverge.value = withTiming(0, { duration: 300 });
      ritualCollapse.value = withTiming(0, { duration: 300 });
      setPhase("garden");
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Error,
        ).catch(() => {});
      }
    }
  }, [
    adapter,
    explosionActive,
    isRetrain,
    phase,
    ready,
    refresh,
    ritualCollapse,
    ritualConverge,
    ritualOrbitT,
    samples,
  ]);

  const onExplosionComplete = useCallback(() => {
    setExplosionOn(false);
    explosionActive.value = false;
    // Halt the infinite orbit rotation now that the orbs are gone.
    cancelAnimation(ritualOrbitT);
    setPhase("welcome");
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
    }
  }, [explosionActive]);

  const onMeetTheSwarm = useCallback(() => {
    router.replace("/(tabs)");
  }, []);

  // "Try one idea →" — the low-friction unlock. Kicks the ideator
  // for a single idea (count=1) using the creator's persisted
  // region + style profile (the server falls back to those when
  // the body omits them — see ideator.ts), then routes the user
  // straight into the create flow with that idea preloaded. Lets
  // someone get value from a single uploaded clip without having
  // to grind to the 10-clip training threshold.
  const tryOneIdea = useCallback(async () => {
    // Defensive callback contract: even though the UI only renders
    // the "Try one idea →" CTA in branches where samples.length≥1,
    // the explicit guard keeps the contract honest if a future
    // refactor wires the callback into a different code path.
    if (tryingIdea || samples.length === 0) return;
    setTryingIdea(true);
    setError(null);
    try {
      const res = await customFetch<IdeatorResponse>(
        "/api/ideator/generate",
        {
          method: "POST",
          body: JSON.stringify({ count: 1 }),
        },
      );
      const idea = res.ideas?.[0];
      if (!idea) throw new Error("No idea came back — try again in a sec.");
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        ).catch(() => {});
      }
      router.push({
        pathname: "/create",
        params: { idea: JSON.stringify(idea) },
      });
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Couldn't generate an idea.";
      setError(msg);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Error,
        ).catch(() => {});
      }
    } finally {
      setTryingIdea(false);
    }
  }, [tryingIdea]);

  // ── Layout maths for the flower ────────────────────────────────────
  // Memory orbs sit on a ring around the central TwinOrb. We compute
  // ring radius from the screen width with safe horizontal padding so
  // nothing clips on small devices.
  const orbCount = required;
  const orbSize = 54;
  const ringRadius = Math.min(
    (screenW - 64 - orbSize) / 2,
    140,
  );

  // Tightly packed angles, with a small open-mouth gap at the top so it
  // reads as a flower rather than a perfect ring of dots.
  const angles = useMemo(() => {
    const start = -Math.PI / 2 + 0.18; // start near 12 o'clock
    const total = Math.PI * 2 - 0.36;
    return Array.from(
      { length: orbCount },
      (_, i) => start + (i / orbCount) * total,
    );
  }, [orbCount]);

  // Twin orb mood follows the phase — sleepy → idle → supernova → idle.
  const orbMood: React.ComponentProps<typeof StyleTwinOrb>["mood"] =
    phase === "invitation"
      ? "collapsed"
      : phase === "ritual"
        ? "supernova"
        : phase === "welcome"
          ? "excited"
          : "idle";

  const interactive = phase === "invitation" || phase === "garden";

  // Header copy — friend-of-the-creator tone. Three optional lines:
  //   title    — the headline
  //   body     — the practical "what / how" line
  //   support  — the soft promise ("I'll match your tone…")
  // The eyebrow is intentionally a single short label per phase
  // (no all-caps incantations like "AWAKEN YOUR STYLE TWIN").
  const headerCopy = useMemo<{
    eyebrow: string;
    title: string;
    body: string;
    support?: string;
  }>(() => {
    switch (phase) {
      case "invitation":
        return {
          eyebrow: "STYLE",
          title: isRetrain ? "Welcome back." : "Make ideas sound like you",
          body: isRetrain
            ? "Add a few new 10–30s clips you've posted (or would post) — talking, POV, reaction, daily moments. All great."
            : "Upload 1–2 videos you've posted (or would post).",
          support: isRetrain
            ? "I'll sharpen the read on your tone, hooks, and style."
            : "I'll match your tone, hooks, and style.",
        };
      case "garden":
        if (samples.length === 0) {
          return {
            eyebrow: "STYLE",
            title: "Pick your first video",
            body: "A 10–30s clip works best — talking, POV, reaction, or a daily moment. Anything you'd post.",
          };
        }
        if (ready) {
          return {
            eyebrow: "STYLE",
            title: "Locked in.",
            body: "Save my style now to bake this into every idea — or keep going with one for now.",
          };
        }
        return {
          eyebrow: "STYLE",
          title: "Got it — I see your style.",
          body: "Try an idea now, or add more clips to sharpen the read.",
        };
      case "ritual":
        return {
          eyebrow: "STYLE",
          title: "Saving your style…",
          body: "Locking in your tone, pacing, and look. Just a few seconds.",
        };
      case "welcome":
        return {
          eyebrow: "STYLE",
          title: isRetrain ? "Style sharpened." : "Style saved.",
          body: isRetrain
            ? "I've absorbed the new clips. Every idea will sound more like you."
            : "I've got your tone, pacing, and look. Every idea will sound like you.",
        };
    }
  }, [phase, isRetrain, ready, samples.length]);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <Stack.Screen options={{ headerShown: false }} />
      <CosmicBackdrop bloom>
        <FireflyParticles
          count={phase === "ritual" ? 28 : phase === "welcome" ? 22 : 16}
          ambient
        />
      </CosmicBackdrop>

      {/* ── Header copy ───────────────────────────────────────────── */}
      <Animated.View
        key={`hdr-${phase}`}
        entering={FadeInDown.duration(360).easing(Easing.out(Easing.cubic))}
        exiting={FadeOut.duration(180)}
        style={[styles.header, { paddingTop: insets.top + 14 }]}
      >
        <View style={styles.headerRow}>
          {/* Dismiss is hidden during ritual so users can't bail mid-bloom. */}
          {phase !== "ritual" ? (
            <Pressable
              onPress={() =>
                phase === "welcome" ? onMeetTheSwarm() : router.back()
              }
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={phase === "welcome" ? "Skip" : "Close"}
              style={styles.dismiss}
            >
              <Feather
                name={phase === "welcome" ? "skip-forward" : "x"}
                size={20}
                color="rgba(255,255,255,0.7)"
              />
            </Pressable>
          ) : (
            <View style={styles.dismiss} />
          )}
        </View>
        <Text style={styles.eyebrow}>{headerCopy.eyebrow}</Text>
        <Text style={styles.title}>{headerCopy.title}</Text>
        <Text style={styles.body}>{headerCopy.body}</Text>
        {headerCopy.support ? (
          <Text style={styles.support}>{headerCopy.support}</Text>
        ) : null}
      </Animated.View>

      {/* ── The Garden — TwinOrb + memory-orb flower ─────────────── */}
      <View style={styles.gardenWrap} pointerEvents="box-none">
        <Animated.View
          entering={ZoomIn.duration(420).easing(Easing.out(Easing.cubic))}
          style={styles.twinSlot}
        >
          <StyleTwinOrb size={150} mood={orbMood} />
        </Animated.View>

        {/* Memory orbs orbit the Twin. Each is a separate component so
            its hooks live at its own callsite (Rules of Hooks). */}
        {angles.map((angle, i) => (
          <MemoryOrb
            key={i}
            index={i}
            total={orbCount}
            angle={angle}
            radius={ringRadius}
            size={orbSize}
            sample={samples[i] ?? null}
            interactive={interactive}
            ritualConverge={ritualConverge}
            ritualOrbitT={ritualOrbitT}
            ritualCollapse={ritualCollapse}
            onTap={() => {
              const filled = samples[i];
              if (filled) {
                removeSample(filled.id);
              } else {
                void pickVideos();
              }
            }}
          />
        ))}
      </View>

      {/* ── Agent feedback bubble (Garden only) ──────────────────── */}
      {feedback && phase === "garden" ? (
        <View
          style={[styles.feedbackSlot, { bottom: insets.bottom + 230 }]}
          pointerEvents="none"
        >
          <ReasoningBubble
            key={feedback.nonce}
            agent={feedback.agent}
            text={feedback.text}
          />
        </View>
      ) : null}

      {/* ── Bottom rail: consent + adapter + CTA + counter ──────── */}
      <View
        style={[styles.bottom, { paddingBottom: insets.bottom + 14 }]}
        pointerEvents="box-none"
      >
        {phase === "invitation" || phase === "garden" ? (
          <Animated.View
            entering={FadeInUp.duration(320).easing(Easing.out(Easing.cubic))}
            style={styles.bottomStack}
          >
            <ConsentRow />
            {error ? (
              <Text style={styles.errorText}>
                {error} — let's try again.
              </Text>
            ) : null}
            <View style={styles.ctaWrap}>
              {phase === "invitation" ? (
                // "Add your first video" jumps straight into the
                // picker — no extra "begin training" speed-bump
                // step. pickVideos auto-transitions invitation →
                // garden so the orbs become tappable on return.
                <PortalButton
                  label={isRetrain ? "Add a clip" : "Add your first video"}
                  onPress={() => void pickVideos(true)}
                  width={260}
                  subtle
                />
              ) : samples.length === 0 ? (
                // Garden, no clips yet — same "Add a video" CTA as
                // the orb taps; gives users a second affordance below
                // the flower.
                <PortalButton
                  label="Add a video"
                  onPress={() => void pickVideos(true)}
                  width={260}
                  subtle
                />
              ) : ready ? (
                // 10+ clips — full training is unlocked. Optional;
                // the secondary "Try one idea →" link below stays
                // available so they don't have to commit to training
                // to keep using the app.
                <PortalButton
                  label="Save my style"
                  onPress={igniteRitual}
                  width={260}
                  subtle
                />
              ) : (
                // 1+ clip but below the training threshold — primary
                // CTA is "Try one idea →" so the user can see real
                // value immediately.
                <PortalButton
                  label={
                    tryingIdea ? "Generating an idea…" : "Try one idea →"
                  }
                  onPress={() => void tryOneIdea()}
                  width={260}
                  subtle
                  disabled={tryingIdea}
                />
              )}
            </View>
            {/* Secondary affordance row. Two cases:
                  • 1+ clips, not yet ready → let them keep adding
                    without leaving the screen.
                  • Ready → let them try an idea right now instead of
                    committing to the full save flow. */}
            {phase === "garden" && samples.length >= 1 && !ready ? (
              <Pressable
                onPress={() => void pickVideos(true)}
                accessibilityRole="button"
                accessibilityLabel="Add another video"
                hitSlop={8}
                style={styles.linkBtn}
              >
                <Text style={styles.linkText}>Add another video</Text>
              </Pressable>
            ) : null}
            {phase === "garden" && ready ? (
              <Pressable
                onPress={() => void tryOneIdea()}
                disabled={tryingIdea}
                accessibilityRole="button"
                accessibilityLabel="Try one idea"
                hitSlop={8}
                style={styles.linkBtn}
              >
                <Text style={styles.linkText}>
                  {tryingIdea ? "Generating an idea…" : "Try one idea →"}
                </Text>
              </Pressable>
            ) : null}
            <Text style={styles.counter}>
              {/* First-time framing per spec: "X / 10 videos added".
                  Retrain has its own required=1 gate (incremental
                  evolution of an already-saved style) so we drop the
                  denominator and just say "X new video(s) added"
                  there, otherwise the counter would read "1 / 1"
                  which feels like a checklist instead of an update. */}
              {isRetrain
                ? `${samples.length} new video${samples.length === 1 ? "" : "s"} added`
                : `${samples.length} / ${MIN_SAMPLES} videos added`}
              {adapter.mode === "executorch"
                ? " · on-device"
                : " · mock (Expo Go)"}
            </Text>
            <Text style={styles.footnote}>You can add more anytime.</Text>
          </Animated.View>
        ) : null}

        {phase === "ritual" ? (
          <Animated.Text
            entering={FadeIn.duration(320)}
            style={styles.ritualHint}
          >
            ✦ saving your style ✦
          </Animated.Text>
        ) : null}

        {phase === "welcome" ? (
          <Animated.View
            entering={FadeInUp.duration(420).easing(Easing.out(Easing.cubic))}
            style={styles.bottomStack}
          >
            <View style={styles.ctaWrap}>
              <PortalButton
                label="Open Lumina"
                onPress={onMeetTheSwarm}
                width={260}
              />
            </View>
            <Text style={styles.counter}>
              Saved {samples.length || required} videos · ready to create
            </Text>
          </Animated.View>
        ) : null}
      </View>

      <LightExplosion active={explosionOn} onComplete={onExplosionComplete} />
    </View>
  );
}

/* ───────────────────────── Memory Orb ───────────────────────────── */

function MemoryOrb({
  index,
  total,
  angle,
  radius,
  size,
  sample,
  interactive,
  ritualConverge,
  ritualOrbitT,
  ritualCollapse,
  onTap,
}: {
  index: number;
  total: number;
  angle: number;
  radius: number;
  size: number;
  sample: VideoSample | null;
  interactive: boolean;
  ritualConverge: SharedValue<number>;
  ritualOrbitT: SharedValue<number>;
  ritualCollapse: SharedValue<number>;
  onTap: () => void;
}) {
  const filled = !!sample;
  const agent: AgentKey = AGENT_ORDER[index % AGENT_ORDER.length]!;
  const accent = agents[agent].hex;

  // Idle bob — gentle Y oscillation, phase-staggered so the row never
  // breathes in unison and reads as a living lily-pad cluster.
  const bob = useSharedValue(0);
  useEffect(() => {
    bob.value = withRepeat(
      withTiming(1, {
        duration: 2400 + (index % 4) * 280,
        easing: Easing.inOut(Easing.sin),
      }),
      -1,
      true,
    );
  }, [bob, index]);

  // Bloom-in when filled.
  const bloom = useSharedValue(filled ? 1 : 0);
  useEffect(() => {
    bloom.value = withSpring(filled ? 1 : 0, spring.bloom);
  }, [bloom, filled]);

  // Garden grid → orbit → consumed transformation.
  const animStyle = useAnimatedStyle(() => {
    "worklet";
    // Grid position — derived from angle + radius (the flower).
    const gx = Math.cos(angle) * radius;
    const gy = Math.sin(angle) * radius;

    // Orbit position — rotates the whole ring during ritual and pulls
    // each orb slightly inward as the collapse progresses.
    const orbitAngle = angle + ritualOrbitT.value * Math.PI * 2 * 1.4;
    const orbitR = interpolate(ritualCollapse.value, [0, 1], [radius, 0]);
    const ox = Math.cos(orbitAngle) * orbitR;
    const oy = Math.sin(orbitAngle) * orbitR;

    // Blend between grid and orbit by ritualConverge.
    const x = gx * (1 - ritualConverge.value) + ox * ritualConverge.value;
    const y =
      gy * (1 - ritualConverge.value) +
      oy * ritualConverge.value -
      bob.value * (1 - ritualConverge.value) * 4; // bob only in garden

    // Scale: bloom up when filled, shrink during collapse to zero, plus
    // a tiny breathing scale tied to bob in garden.
    const garden = 0.92 + bob.value * 0.08;
    const scale =
      garden * (1 - ritualCollapse.value) +
      0.05 * ritualCollapse.value +
      bloom.value * 0.08;

    return {
      transform: [{ translateX: x }, { translateY: y }, { scale }],
      opacity: 1 - ritualCollapse.value * 0.85,
    };
  });

  // Position relative to the parent's center via absolute centring.
  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          width: size,
          height: size,
        },
        animStyle,
      ]}
    >
      <Pressable
        onPress={interactive ? onTap : undefined}
        disabled={!interactive}
        accessibilityRole="button"
        accessibilityLabel={
          filled
            ? `Video ${index + 1} added. Tap to remove.`
            : `Slot ${index + 1} of ${total}. Tap to add a video.`
        }
        style={({ pressed }) => [
          styles.orb,
          {
            borderColor: filled ? accent : "rgba(255,255,255,0.18)",
            backgroundColor: filled ? `${accent}33` : "rgba(255,255,255,0.04)",
            shadowColor: accent,
            shadowOpacity: filled ? 0.85 : 0.25,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        {filled ? (
          <Feather name="check" size={20} color={accent} />
        ) : (
          <Text style={styles.orbDigit}>{index + 1}</Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

/* ─────────────────────────── Consent row ────────────────────────── */

function ConsentRow() {
  return (
    <GlassSurface radius={999} intensity={28}>
      <View style={styles.consentInner}>
        <Feather name="lock" size={13} color={lumina.firefly} />
        <Text style={styles.consentText}>
          Encrypted on this device · single-use consent · wipe anytime
        </Text>
      </View>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0A0824" },
  header: {
    paddingHorizontal: 24,
    gap: 6,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 8,
  },
  dismiss: {
    width: 36,
    height: 36,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  eyebrow: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    letterSpacing: 1.6,
    fontWeight: "700",
  },
  title: {
    ...type.subhead,
    color: "#FFFFFF",
    marginTop: 2,
  },
  body: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
    maxWidth: 360,
  },
  // Soft "I'll match your tone…" line under body. Slightly dimmer
  // and indented in spirit (no actual indent, just visual hierarchy
  // via colour) so the title→body→support cascade reads top-down.
  support: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
    maxWidth: 360,
    fontStyle: "italic",
  },

  /* Garden centerpiece — Twin + memory orb flower */
  gardenWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  twinSlot: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  orb: {
    width: "100%",
    height: "100%",
    borderRadius: 999,
    borderWidth: 1.2,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 12,
  },
  orbDigit: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    fontWeight: "600",
  },

  /* Agent feedback bubble */
  feedbackSlot: {
    position: "absolute",
    left: 22,
    right: 22,
  },

  /* Bottom rail */
  bottom: {
    paddingHorizontal: 22,
    paddingTop: 8,
  },
  bottomStack: {
    gap: 14,
    alignItems: "center",
  },
  consentInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  consentText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 12,
  },
  ctaWrap: { alignItems: "center" },
  counter: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
    letterSpacing: 0.6,
    textAlign: "center",
  },
  // Soft "You can add more anytime." reassurance under the counter.
  // Even smaller / dimmer than the counter so it feels like an
  // afterthought rather than another instruction.
  footnote: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 11,
    textAlign: "center",
    marginTop: 2,
  },
  // Tertiary text-link affordance ("Add another video", "Try one
  // idea →") — sits between the primary PortalButton and the
  // counter, deliberately low-key so the primary CTA stays the eye.
  linkBtn: {
    alignSelf: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  linkText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    letterSpacing: 0.3,
  },
  ritualHint: {
    color: lumina.firefly,
    fontSize: 13,
    letterSpacing: 2,
    textAlign: "center",
    fontWeight: "700",
    paddingBottom: 28,
  },
  errorText: {
    color: "#FF8A80",
    fontSize: 12,
    textAlign: "center",
    paddingHorizontal: 12,
  },
});
