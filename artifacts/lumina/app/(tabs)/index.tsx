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
import { useRouter } from "expo-router";
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

  // Tracks the most recent `loadIdeas` invocation so a slow
  // initial load that resolves AFTER the user tapped Retry can't
  // overwrite the fresher result. Cheaper than maintaining a
  // separate AbortController for both code paths.
  const loadCallIdRef = useRef(0);

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
  const openCreate = useCallback(
    (idea: CachedIdea) => {
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

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <CosmicBackdrop bloom>
        <FireflyParticles count={14} ambient />
      </CosmicBackdrop>

      <ScrollView
        contentContainerStyle={{
          paddingTop: topInset + 24,
          paddingBottom: bottomInset,
          paddingHorizontal: 22,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.duration(420)}>
          <Text style={styles.kicker}>today · {greetingTimeOfDay()}</Text>
          <Text style={styles.title}>Your three ideas.</Text>
          <Text style={styles.sub}>
            Region-tuned to your style profile. Pick one to film.
          </Text>
        </Animated.View>

        {loading ? (
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
                Tuning your three ideas to today…
              </Text>
            </View>
          </View>
        ) : null}

        {!loading && ideas ? (
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
                <IdeaFeedback idea={idea} region={region ?? undefined} />
              </View>
            ))}
          </Animated.View>
        ) : null}

        {!loading && ideas ? (
          <Pressable
            onPress={handleRegenerate}
            disabled={regenerating}
            style={({ pressed }) => [
              styles.refreshBtn,
              pressed && !regenerating ? styles.refreshBtnPressed : null,
              regenerating ? styles.refreshBtnDisabled : null,
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
              {regenerating ? "Refreshing…" : "Show me 3 different ideas"}
            </Text>
          </Pressable>
        ) : null}

        {/* Inline error for the regenerate path — only shows
            when ideas are already on screen, otherwise the full
            error block below covers it. */}
        {!loading && ideas && errorMsg ? (
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
    </View>
  );
}

function greetingTimeOfDay(): string {
  const h = new Date().getHours();
  if (h < 12) return "good morning";
  if (h < 18) return "good afternoon";
  return "good evening";
}

function formatError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message ?? fallback;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0A0824" },
  kicker: {
    fontFamily: fontFamily.bodyMedium,
    color: lumina.firefly,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  title: {
    ...type.display,
    color: "#FFFFFF",
    marginBottom: 8,
  },
  sub: {
    ...type.body,
    color: "rgba(255,255,255,0.65)",
    fontSize: 15,
    lineHeight: 21,
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
