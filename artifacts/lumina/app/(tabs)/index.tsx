/**
 * Home — today's three region-conditioned ideas.
 *
 * Phase 1 MVP scope: the only persistent surface in v1 besides
 * onboarding. Onboarding's last step pre-fills the daily-ideas
 * cache so this screen renders instantly the first time the user
 * lands on it. On subsequent opens within the same UTC day we
 * read from the same cache. If the cache is empty or stale, we
 * fall back to a server fetch.
 *
 * Cache-first behaviour is load-bearing: every mount and every
 * retry checks AsyncStorage first and only falls through to the
 * ideator when the cache misses. Re-opening the app within the
 * same UTC day must NEVER fire `/api/ideator/generate` —
 * regression-test that path before changing this screen.
 *
 * The "regenerate" affordance uses the ideator's second-batch
 * slot (server enforces a 2-batch-per-UTC-day cap) so the user
 * can ask for a different angle without waiting until tomorrow.
 *
 * The legacy swarm Home (While-You-Slept recap, run-the-swarm
 * CTA, scrolling trend briefs) lives in this file's git history
 * — it remains gated under `flags.ARCHIVED_AUTONOMY` in the rest
 * of the codebase but is not rendered here.
 */

import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, customFetch } from "@workspace/api-client-react";

import { CosmicBackdrop } from "@/components/foundation/CosmicBackdrop";
import { InlineToast } from "@/components/feedback/InlineToast";
import { FireflyParticles } from "@/components/foundation/FireflyParticles";
import { IdeaCard, type IdeaCardData } from "@/components/IdeaCard";
import { IdeaFeedback } from "@/components/IdeaFeedback";
import { lumina } from "@/constants/colors";
import { type Bundle } from "@/constants/regions";
import { fontFamily, type } from "@/constants/typography";
import {
  readDailyIdeas,
  writeDailyIdeas,
  type CachedIdea,
} from "@/lib/dailyIdeasCache";
import { shouldForceCalibration } from "@/lib/forceCalibration";
import { submitIdeatorSignal } from "@/lib/ideatorSignal";
import {
  HOME_HEADER_SUB,
  HOME_HEADER_TITLE,
  POST_YES_MESSAGES,
  RETURN_SESSION_SIGNALS,
  rotateRandom,
  shouldShowOncePerDay,
} from "@/lib/loopMessages";
import {
  isCalibrationGateSuppressed,
  isCalibrationPromptedThisProcess,
  markCalibrationPromptedThisProcess,
} from "@/lib/tasteCalibration";
import {
  getHasCompletedTasteOnboarding,
  getIdeasViewedCount,
  incrementIdeasViewedCount,
} from "@/lib/tasteOnboardingState";
import { getYesSwipeCount, recordYesSwipe } from "@/lib/yesSwipeCounter";

type StyleProfileResponse = {
  hasProfile: boolean;
  profile: unknown;
  region: Bundle | null;
  lastIdeaBatchAt: string | null;
};

type IdeatorResponse = {
  region: Bundle;
  count: number;
  ideas: IdeaCardData[];
};

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const topInset = isWeb ? 24 : insets.top;
  const bottomInset = isWeb ? 108 : insets.bottom + 108;

  const [region, setRegion] = useState<Bundle | null>(null);
  const [ideas, setIdeas] = useState<CachedIdea[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // QA-driven: refresh latency is inconsistent (the LLM second-batch
  // can land in 1s or 8s depending on the model's mood). When it's
  // slow the UI must not feel frozen — after 5s of waiting we swap
  // the loading copy to a reassuring "still working" message.
  const [slowLoad, setSlowLoad] = useState(false);

  // Tracks the most recent `loadIdeas` invocation so a slow
  // initial load that resolves AFTER the user tapped Retry can't
  // overwrite the fresher result. Cheaper than maintaining a
  // separate AbortController for both code paths.
  const loadCallIdRef = useRef(0);

  // ── Viral feedback-loop UI state ────────────────────────────
  // Ephemeral toast string shown after multi-YES milestones.
  // null = hidden. The InlineToast component owns its own
  // auto-dismiss timer and calls back to clear this.
  const [loopToast, setLoopToast] = useState<string | null>(null);
  // Once-per-UTC-day "returning user" subtitle. Per the daily-
  // habit spec, this is the ONLY line that varies day-to-day on
  // Home — the H1 + sub are locked. Variants come from
  // RETURN_SESSION_SIGNALS; the picker is intentionally NOT
  // rotateDaily because that helper is hash-based and with only
  // two items consecutive UTC days can collide on the same
  // index, breaking the "you see the OTHER line tomorrow" beat.
  // Instead we use the UTC-day count modulo items.length, which
  // is stable within a day (every reload picks the same line)
  // and strictly alternates across days regardless of month or
  // year boundaries. Gated below by BOTH yesSwipeCount > 0 (so
  // the "sharper" / "match your style" claim isn't a lie on
  // day 1) AND shouldShowOncePerDay (so it doesn't reappear on
  // every tab switch).
  const [returnSignalText, setReturnSignalText] = useState<string | null>(
    null,
  );

  // Mount-only: check whether the returning-user subtitle should
  // appear today. The yesCount > 0 gate prevents false-positive
  // "I learned" claims for first-time visitors — the line only
  // lands once the underlying signal exists. shouldShowOncePerDay
  // then guarantees the line shows at most once per UTC day
  // rather than on every Home re-render or tab switch.
  // Failing closed (catch → null) is intentional: a transient
  // AsyncStorage error shouldn't pester the user with a banner
  // we can't subsequently suppress.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const yesCount = await getYesSwipeCount();
        if (yesCount <= 0) return;
        const allowed = await shouldShowOncePerDay("returnSignal");
        if (alive && allowed) {
          // UTC-day-count modulo length: stable within a day,
          // strictly alternates across days. 86400000 = ms/day.
          const dayCount = Math.floor(Date.now() / 86_400_000);
          const idx = dayCount % RETURN_SESSION_SIGNALS.length;
          setReturnSignalText(RETURN_SESSION_SIGNALS[idx] ?? null);
        }
      } catch {
        /* swallow — UX-only surface */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Per-card YES handler. Increments the lifetime YES counter
  // and, when the new count lands on a milestone (3, 7, 15, 30),
  // fires the loop-reinforcement toast. We pick a random copy
  // variant so seeing two milestones doesn't feel repetitive.
  // Maybe / No verdicts intentionally don't trigger the toast —
  // we only celebrate the verdict that signals "this batch
  // worked".
  const handleIdeaVerdict = useCallback(async (verdict: "yes" | "maybe" | "no") => {
    if (verdict !== "yes") return;
    try {
      const { hitMilestone } = await recordYesSwipe();
      if (hitMilestone) {
        setLoopToast(rotateRandom(POST_YES_MESSAGES));
      }
    } catch {
      /* swallow — UX-only surface */
    }
  }, []);
  // Ref to snap back to the top after a successful regenerate —
  // otherwise the user's scroll position (often near idea 3 because
  // they just read all three before tapping refresh) sits over the
  // new batch, hiding the new idea 1.
  const scrollViewRef = useRef<ScrollView>(null);

  // Spin up a 5s timer whenever any load is in flight. When it
  // expires we flip `slowLoad` so the loading copy can change. The
  // timer is rearmed every time loading/regenerating toggles, and
  // cleared on unmount, so we never leak it.
  useEffect(() => {
    if (!loading && !regenerating) {
      setSlowLoad(false);
      return;
    }
    setSlowLoad(false);
    const timer = setTimeout(() => setSlowLoad(true), 5000);
    return () => clearTimeout(timer);
  }, [loading, regenerating]);

  /* ---------- Load (cache-first) ----------------------------- */

  // Single source of truth for the load sequence — used by both
  // the initial mount effect and the Retry button. Cache-first
  // by design: we ALWAYS hit AsyncStorage before the network, so
  // re-opening Home within the same UTC day costs zero ideator
  // quota.
  const loadIdeas = useCallback(async () => {
    const callId = ++loadCallIdRef.current;
    setLoading(true);
    setErrorMsg(null);
    try {
      const sp = await customFetch<StyleProfileResponse>("/api/style-profile");
      if (callId !== loadCallIdRef.current) return;
      if (!sp.region) {
        setErrorMsg("No region on your profile yet.");
        return;
      }
      setRegion(sp.region);

      // Cache hit → done. No network call to the ideator.
      const cached = await readDailyIdeas(sp.region);
      if (callId !== loadCallIdRef.current) return;
      if (cached) {
        setIdeas(cached);
        return;
      }

      // Cache miss → fetch fresh, then write through so the next
      // open in this UTC day stays cache-only.
      const fresh = await customFetch<IdeatorResponse>(
        "/api/ideator/generate",
        {
          method: "POST",
          body: JSON.stringify({ region: sp.region, count: 3 }),
        },
      );
      if (callId !== loadCallIdRef.current) return;
      setIdeas(fresh.ideas);
      await writeDailyIdeas(sp.region, fresh.ideas);
    } catch (err) {
      if (callId !== loadCallIdRef.current) return;
      setErrorMsg(formatError(err, "We couldn't load ideas. Try again."));
    } finally {
      if (callId === loadCallIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadIdeas();
  }, [loadIdeas]);

  /* ---------- Quick Tune (taste-onboarding) gate ----------- */

  // Behaviour-triggered prompt: ask the user to calibrate ONLY after
  // they've seen enough of the app to have context for the question.
  // Fresh-install rule (April 2026 quick-tune rework):
  //
  //   trigger ⇔ !hasCompletedTasteOnboarding && ideasViewedCount >= 2
  //
  // Both inputs live in AsyncStorage (`lib/tasteOnboardingState.ts`).
  // The legacy server-doc check (`needsCalibration(cal)`) is gone —
  // the local flag is now the authoritative gate input, so Skip can
  // mean "ask me later" without permanently muting the prompt.
  //
  // The counter bumps in two places below:
  //   1. Per-focus dwell timer (~1.5 s with ideas visible) — the user
  //      actually sat on Home long enough to take in the cards.
  //   2. First scroll past the first card per focus session — the
  //      user explored the batch within this visit.
  // Each is one-shot per focus session (refs cleared in the focus
  // cleanup), so a re-render or a brief tab swap can't double-count.
  //
  // Why useFocusEffect (not useEffect):
  //   Tabs persist their mount state, so useEffect with [] deps fires
  //   only ONCE — the first time the Home tab is touched. That breaks
  //   QA reset (Profile → reset → tap Home) and the post-modal flow
  //   (calibration dismissed → focus returns to Home). useFocusEffect
  //   re-runs every time Home regains focus, which is what we need.
  //
  // Dev override (`shouldForceCalibration()`) checks for either
  // `?forceCalibration=1` (web) or `EXPO_PUBLIC_FORCE_CALIBRATION=true`
  // and bypasses every guard so QA can re-open the screen on demand.
  //
  // Fail-open: AsyncStorage error treats the user as "already
  // calibrated" (don't surface the prompt). Calibration is optional —
  // better to skip the prompt than to block Home for a storage
  // hiccup. The gate retries on the next focus.

  // One-shot per-focus latches for the two increment sources. We
  // hold them on refs (not state) so flipping them never forces a
  // re-render. Reset ONLY on focus transitions (see effect below) —
  // crucially NOT when `ideas` changes mid-focus, otherwise the
  // initial-load and regenerate paths (each of which mutates
  // `ideas` while Home is still focused) would clear the latches
  // and let the same focus session double-count.
  const dwellCountedRef = useRef(false);
  const scrollCountedRef = useRef(false);

  // We need a focus boolean (not a callback) so downstream effects
  // can depend on focus state without picking up `ideas` churn.
  // Expo Router re-exports useFocusEffect but NOT useIsFocused, and
  // we don't want to take a new direct dependency on
  // @react-navigation/native just for this. Instead we promote
  // focus state to React state via useFocusEffect with stable empty
  // deps (no `ideas`, no `checkAndMaybeTrigger`), so this hook
  // only fires on the real focus → blur transition. The useState
  // setter is stable, so the empty dep array is honest.
  const [isFocused, setIsFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, []),
  );

  // Stable trigger predicate — runs the gate using the LATEST values
  // of the local state. Called both on focus gain (cheap recheck)
  // and immediately after each successful counter bump (so the
  // bump that crosses the threshold can fire the prompt without
  // waiting for the next focus).
  const checkAndMaybeTrigger = useCallback(async () => {
    const force = shouldForceCalibration();
    // Suppression short-circuit: <TasteCalibration /> sets a small
    // window (default 5 s) on Save / Skip so the immediate Home
    // re-focus can't out-race the navigation back to /(tabs) and
    // re-push the modal. Force bypasses for the QA flow.
    if (!force && isCalibrationGateSuppressed()) return;
    // Once-per-process latch: even if the user dismisses
    // /calibration via Skip and bounces between Home and other
    // tabs, we don't fire again until the next cold start. The
    // latch lives in `lib/tasteCalibration.ts`; <TasteCalibration />
    // also arms it on Save / Skip so calibrations opened from
    // MvpOnboarding (not the Home gate) still get the same
    // same-process suppression. The dev-only reset clears it.
    // Force bypasses.
    if (!force && isCalibrationPromptedThisProcess()) return;
    try {
      const [hasCompleted, count] = await Promise.all([
        getHasCompletedTasteOnboarding(),
        getIdeasViewedCount(),
      ]);
      if (force || (!hasCompleted && count >= 2)) {
        markCalibrationPromptedThisProcess();
        router.replace("/calibration");
      }
    } catch {
      // Fail-open — swallow the error; next focus will retry.
    }
  }, [router]);

  // Focus-transition effect — reset latches when Home loses focus,
  // run a cheap gate check when Home gains it. Decoupled from
  // `ideas` deliberately so an in-focus data refresh can't reset
  // the per-focus latches.
  useEffect(() => {
    if (isFocused) {
      void checkAndMaybeTrigger();
    } else {
      dwellCountedRef.current = false;
      scrollCountedRef.current = false;
    }
  }, [isFocused, checkAndMaybeTrigger]);

  // Dwell timer — fires once per focus session (the dwellCountedRef
  // guard short-circuits subsequent runs even when `ideas` changes
  // mid-focus and re-runs this effect). 1.5 s is long enough to
  // exclude tab-bounces but short enough to feel snappy. Without
  // ideas on screen there's nothing to "view", so we bail until
  // they're loaded.
  useEffect(() => {
    if (!isFocused) return;
    if (dwellCountedRef.current) return;
    if (!ideas || ideas.length === 0) return;
    const t = setTimeout(() => {
      if (dwellCountedRef.current) return;
      dwellCountedRef.current = true;
      void incrementIdeasViewedCount().then(() => {
        void checkAndMaybeTrigger();
      });
    }, 1500);
    return () => clearTimeout(t);
  }, [isFocused, ideas, checkAndMaybeTrigger]);

  // Scroll handler — bumps the counter the first time the user
  // scrolls a meaningful amount in this focus session. One-shot
  // per focus via scrollCountedRef so flinging up and down can't
  // spam increments. Threshold of 24 px is small on purpose: on a
  // mobile viewport with three idea cards, the entire feed often
  // fits with only ~50 px of scrollable runway, so anything taller
  // (say 240 px) would never trip.
  const handleHomeScroll = useCallback(
    (offsetY: number) => {
      if (scrollCountedRef.current) return;
      if (offsetY < 24) return;
      scrollCountedRef.current = true;
      void incrementIdeasViewedCount().then(() => {
        void checkAndMaybeTrigger();
      });
    },
    [checkAndMaybeTrigger],
  );

  /* ---------- Regenerate (uses today's 2nd ideator slot) ----- */

  const handleRegenerate = useCallback(async () => {
    if (!region || regenerating) return;
    setRegenerating(true);
    setErrorMsg(null);
    try {
      const fresh = await customFetch<IdeatorResponse>(
        "/api/ideator/generate",
        {
          method: "POST",
          body: JSON.stringify({
            region,
            count: 3,
            regenerate: true,
          }),
        },
      );
      setIdeas(fresh.ideas);
      await writeDailyIdeas(region, fresh.ideas);
      // Snap to the top so the new batch reads from idea 1 — the
      // user almost certainly tapped refresh while sitting near
      // idea 3 (where the button lives), and seeing idea 1 first
      // is what "fresh batch" should feel like. Defer one tick so
      // the scroll runs after the new feed has rendered.
      setTimeout(() => {
        scrollViewRef.current?.scrollTo({ y: 0, animated: true });
      }, 0);
    } catch (err) {
      setErrorMsg(formatError(err, "Couldn't refresh ideas."));
    } finally {
      setRegenerating(false);
    }
  }, [region, regenerating]);

  /* ---------- Idea press → creation flow ---------------------- */

  // Stable navigator: opens the create flow with this idea as
  // its starting point. The whole idea object is JSON-encoded
  // into params because there is no server-side stable id we
  // could fetch by — the ideator's response is transient.
  //
  // ALSO fires a fire-and-forget 'selected' signal so the server-
  // side viral-pattern-memory aggregator can credit this idea's
  // STRUCTURE (pattern × emotionalSpike × payoffType) — selections
  // are weighted more heavily than verdicts in the memory snapshot
  // because tapping into the create flow is a real intent signal,
  // not just a cheap Yes/Maybe/No tap on the card.
  const openCreate = useCallback(
    (idea: CachedIdea) => {
      submitIdeatorSignal({
        ideaHook: idea.hook,
        signalType: "selected",
        ideaPattern: idea.pattern,
        emotionalSpike: idea.emotionalSpike,
        payoffType: idea.payoffType,
        // Lumina Evolution Engine — see lib/ideatorSignal.ts.
        structure: idea.structure,
        hookStyle: idea.hookStyle,
      });
      router.push({
        pathname: "/create",
        params: { idea: JSON.stringify(idea) },
      });
    },
    [router],
  );

  /* ---------- Render ----------------------------------------- */

  // Treat an empty array the same as null — both mean "nothing to
  // show". Without this, an ideator response of `{ ideas: [] }`
  // would slip past `!loading && ideas` (truthy) and `!ideas`
  // (false), leaving the user staring at a blank Home with only
  // the regenerate button to escape.
  const hasIdeas = Array.isArray(ideas) && ideas.length > 0;
  const showEmptyError = !loading && !hasIdeas;
  // The ideator does best-effort top-up to reach `count: 3` (see
  // replit.md "ideator best-effort top-up rule"), but a partial
  // failure can still land 1 or 2 ideas instead of 3. Showing those
  // silently — without explanation — is the QA gap we're closing
  // here: the user gets a friendly inline notice + a clear refresh
  // affordance so they always know why they're seeing fewer than
  // the promised three.
  const ideaCount = ideas?.length ?? 0;
  const showUndercountNotice =
    !loading && hasIdeas && ideaCount < 3;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <CosmicBackdrop bloom>
        <FireflyParticles count={14} ambient />
      </CosmicBackdrop>

      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={{
          paddingTop: topInset + 24,
          paddingBottom: bottomInset,
          paddingHorizontal: 22,
        }}
        showsVerticalScrollIndicator={false}
        // Scroll-based input to the Quick Tune trigger counter (see
        // `handleHomeScroll`). Throttled at 64 ms / ~15 fps because the
        // handler fires once and short-circuits — there's no point
        // sampling at 60 fps when the post-trip behaviour is a single
        // ref flip + AsyncStorage write.
        onScroll={(e) => handleHomeScroll(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={64}
      >
        <Animated.View entering={FadeInDown.duration(420)}>
          {/* Daily-habit header — locked copy. The H1 + sub never
              rotate. The user opens the app and sees the same
              "3 ideas for today / Made for your style" promise
              every session, which is the whole point of the
              daily-habit spec. */}
          <Text style={styles.title}>{HOME_HEADER_TITLE}</Text>
          <Text style={styles.sub}>{HOME_HEADER_SUB}</Text>
          {/* Once-per-UTC-day subtitle for returning users with
              prior YES signal — quiet teal line that reinforces
              "the app remembers". Skipped for first-time visitors
              so it doesn't read as a false promise. Sits BELOW
              the locked sub so the primary header pair always
              renders identically and the personalization line
              feels like a layered grace note rather than the
              header itself. */}
          {returnSignalText ? (
            <Text style={styles.returnSignal}>{returnSignalText}</Text>
          ) : null}
        </Animated.View>

        {/* Skeleton screen covers BOTH initial load AND regenerate.
            QA-driven: the spinner-in-button was easy to miss when
            the user was scrolled near idea 3, and a slow refresh
            felt like the app had frozen. Promoting regenerate to
            the same big skeleton — same as initial load — guarantees
            the loading state is visible regardless of scroll
            position, and the loadingText below adapts so the user
            knows whether they're loading the day's first batch or
            asking for a refresh. On regenerate FAILURE, regenerating
            flips back to false in the finally and the existing
            cards re-render (we never cleared `ideas`). */}
        {loading || regenerating ? (
          <View style={styles.skeletonFeed}>
            {/* Three skeleton cards mirror the IdeaCard footprint
                so the layout doesn't reflow when the real ideas
                land — feels like content arriving, not a screen
                rebuild. The small spinner row beneath gives the
                user a "we're working" cue without dominating. */}
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.skeletonCard}>
                <View style={styles.skeletonHookA} />
                <View style={styles.skeletonHookB} />
                <View style={styles.skeletonMetaRow}>
                  <View style={styles.skeletonMetaPill} />
                  <View style={styles.skeletonMetaPill} />
                </View>
                <View style={styles.skeletonScript} />
                <View style={styles.skeletonScriptShort} />
              </View>
            ))}
            <View style={styles.loadingBox}>
              <ActivityIndicator color={lumina.firefly} />
              <Text style={styles.loadingText}>
                {slowLoad
                  ? "Still finding better ideas…"
                  : regenerating
                    ? "Refreshing your three ideas…"
                    : "Tuning your three ideas to today…"}
              </Text>
            </View>
          </View>
        ) : null}

        {!loading && !regenerating && ideas ? (
          <Animated.View
            entering={FadeInDown.duration(520).delay(80)}
            style={styles.feed}
          >
            {ideas.map((idea, i) => (
              // Ideator responses don't carry a stable `id`, so
              // fall back to a positional+hook-prefix key. The
              // hook prefix lets React preserve cell identity
              // across regenerate when the same idea happens to
              // come back, while the index prevents collisions
              // among same-prefix ideas.
              <View
                key={
                  idea.id ??
                  `${i}-${(idea.hook ?? "idea").slice(0, 24)}`
                }
              >
                <Pressable
                  onPress={() => openCreate(idea)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open creation flow for ${idea.hook}`}
                  style={({ pressed }) => [
                    pressed ? styles.cardPressed : null,
                  ]}
                >
                  <IdeaCard idea={idea} index={i + 1} />
                </Pressable>
                {/* Lightweight per-idea feedback row — sits as a
                    sibling to the card pressable, not a wrapper, so
                    voting never accidentally navigates into the
                    create flow. Hidden once the user has voted (the
                    component reads its own AsyncStorage cache). */}
                <IdeaFeedback
                  idea={idea}
                  region={region ?? undefined}
                  onSubmit={handleIdeaVerdict}
                />
              </View>
            ))}
          </Animated.View>
        ) : null}

        {/* Friendly undercount explainer — sits above the refresh
            button so the message and the action read together. We
            only render this when ideas DID land (1 or 2) and the
            full empty/error block is NOT going to render below; the
            two are mutually exclusive by construction. */}
        {showUndercountNotice ? (
          <View style={styles.undercountBlock}>
            <Feather
              name="info"
              size={14}
              color={lumina.firefly}
              style={{ marginRight: 8 }}
            />
            <Text style={styles.undercountText}>
              {`Only ${ideaCount} ${
                ideaCount === 1 ? "idea" : "ideas"
              } loaded this time — tap refresh for another batch.`}
            </Text>
          </View>
        ) : null}

        {/* Refresh button hides during regenerate — the skeleton
            above is the loading indicator now, and a duplicate
            disabled button below it would just clutter. The button
            reappears when regenerating flips false (success OR
            error), so the user always has a way to try again. */}
        {!loading && !regenerating && ideas ? (
          <Pressable
            onPress={handleRegenerate}
            style={({ pressed }) => [
              styles.refreshBtn,
              pressed ? styles.refreshBtnPressed : null,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Refresh today's ideas"
          >
            <Feather
              name="refresh-ccw"
              size={14}
              color={lumina.firefly}
              style={{ marginRight: 8 }}
            />
            <Text style={styles.refreshLabel}>
              Show me 3 different ideas
            </Text>
          </Pressable>
        ) : null}

        {/* Inline error for the regenerate path — only shows
            when ideas are already on screen, otherwise the full
            error block below covers it. */}
        {!loading && !regenerating && ideas && errorMsg ? (
          <Text style={styles.error}>{errorMsg}</Text>
        ) : null}

        {/* Full empty/error state — covers initial-load failures
            and the (unlikely) case where the load resolved but
            returned no ideas. */}
        {showEmptyError ? (
          <View style={styles.errorBlock}>
            <Feather
              name="alert-circle"
              size={28}
              color={lumina.firefly}
              style={{ marginBottom: 14 }}
            />
            <Text style={styles.errorBlockTitle}>
              {errorMsg ?? "We couldn't load ideas. Try again."}
            </Text>
            <Pressable
              onPress={loadIdeas}
              disabled={loading}
              style={({ pressed }) => [
                styles.retryBtn,
                pressed && !loading ? styles.retryBtnPressed : null,
                loading ? styles.retryBtnDisabled : null,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Retry loading ideas"
            >
              <Text style={styles.retryLabel}>Retry</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
      {/* Viral feedback-loop whisper — fires on the Nth lifetime
          YES (3rd, 7th, 15th, 30th). Sits as a sibling of the
          ScrollView so it overlays the entire screen and isn't
          clipped by the scroll view's content bounds. The toast
          owns its own auto-dismiss timer. */}
      <InlineToast
        message={loopToast}
        onHide={() => setLoopToast(null)}
      />
    </View>
  );
}

function formatError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message ?? fallback;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0A0824" },
  title: {
    ...type.display,
    color: "#FFFFFF",
    marginBottom: 8,
  },
  // Locked daily-habit subtitle — sits directly under the H1 and
  // is part of the daily promise; the once-per-day return-signal
  // line below is layered on top, not a replacement.
  sub: {
    ...type.body,
    color: "rgba(255,255,255,0.65)",
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 12,
  },
  // Returning-user signal — quiet teal italic grace note shown
  // ONCE per UTC day after the locked sub. Visually subordinate
  // to the title pair; deliberately not a chip or banner so it
  // reads as the app speaking, not announcing.
  returnSignal: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(0,255,204,0.78)",
    fontSize: 13,
    fontStyle: "italic",
    marginTop: -4,
    marginBottom: 22,
  },
  loadingBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 12,
  },
  loadingText: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
  },
  // Skeleton placeholders for the 3-card feed. Sized to roughly
  // mirror IdeaCard so when real content lands we don't get a
  // jarring layout shift. Static opacity (no shimmer animation)
  // — keeps the bundle lighter and feels calm rather than busy
  // for a load that usually finishes within a couple seconds.
  skeletonFeed: {
    marginTop: 4,
    gap: 14,
  },
  skeletonCard: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 18,
    padding: 18,
  },
  skeletonHookA: {
    height: 14,
    width: "78%",
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.10)",
    marginBottom: 8,
  },
  skeletonHookB: {
    height: 14,
    width: "55%",
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.10)",
    marginBottom: 14,
  },
  skeletonMetaRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  skeletonMetaPill: {
    height: 18,
    width: 72,
    borderRadius: 999,
    backgroundColor: "rgba(0,255,204,0.08)",
  },
  skeletonScript: {
    height: 10,
    width: "92%",
    borderRadius: 5,
    backgroundColor: "rgba(255,255,255,0.07)",
    marginBottom: 6,
  },
  skeletonScriptShort: {
    height: 10,
    width: "64%",
    borderRadius: 5,
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  feed: {
    marginTop: 4,
  },
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  // Inline explainer for the partial-batch case (1 or 2 ideas
  // landed instead of 3). Same surface treatment as a tip block
  // — soft background, small icon + body text, no border — so
  // it reads as informational rather than as a hard error.
  undercountBlock: {
    flexDirection: "row",
    alignItems: "flex-start",
    alignSelf: "stretch",
    backgroundColor: "rgba(0,255,204,0.06)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.18)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 14,
  },
  undercountText: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.85)",
    fontSize: 13,
    lineHeight: 19,
    flex: 1,
  },
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    backgroundColor: "rgba(0,255,204,0.06)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.25)",
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
    marginTop: 18,
  },
  refreshBtnPressed: {
    backgroundColor: "rgba(0,255,204,0.12)",
  },
  refreshBtnDisabled: {
    opacity: 0.5,
  },
  refreshLabel: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 14,
  },
  error: {
    fontFamily: fontFamily.bodyMedium,
    color: "#FF8FA1",
    fontSize: 14,
    marginTop: 18,
    textAlign: "center",
  },
  errorBlock: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 18,
    paddingVertical: 32,
    paddingHorizontal: 24,
    marginTop: 16,
  },
  errorBlockTitle: {
    ...type.body,
    color: "rgba(255,255,255,0.85)",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    marginBottom: 18,
  },
  retryBtn: {
    backgroundColor: lumina.firefly,
    borderRadius: 999,
    paddingHorizontal: 28,
    paddingVertical: 12,
  },
  retryBtnPressed: {
    opacity: 0.85,
  },
  retryBtnDisabled: {
    opacity: 0.4,
  },
  retryLabel: {
    fontFamily: fontFamily.bodyBold,
    color: "#0A0824",
    fontSize: 14,
    letterSpacing: 0.5,
  },
});
