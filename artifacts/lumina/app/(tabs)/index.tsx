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
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, customFetch } from "@workspace/api-client-react";

import { CosmicBackdrop } from "@/components/foundation/CosmicBackdrop";
import { FireflyParticles } from "@/components/foundation/FireflyParticles";
import { IdeaCard, type IdeaCardData } from "@/components/IdeaCard";
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
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const topInset = isWeb ? 24 : insets.top;
  const bottomInset = isWeb ? 108 : insets.bottom + 108;

  const [region, setRegion] = useState<Bundle | null>(null);
  const [ideas, setIdeas] = useState<CachedIdea[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  /* ---------- Initial load ----------------------------------- */

  // First mount: figure out the user's region (server is the
  // source of truth, the cache only knows region as a key) and
  // hydrate ideas from cache. If the cache has nothing fresh,
  // call the ideator. Both fetches are tied to a `cancelled`
  // flag so a fast unmount doesn't write into stale state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sp = await customFetch<StyleProfileResponse>("/api/style-profile");
        if (cancelled) return;
        if (!sp.region) {
          // Pre-onboarding state shouldn't be reachable from
          // here (the auth layout routes signed-in users to
          // onboarding until hasCompletedOnboarding flips), so
          // surface the unexpected case rather than silently
          // showing an empty Home.
          setErrorMsg("No region on your profile yet.");
          return;
        }
        setRegion(sp.region);

        const cached = await readDailyIdeas(sp.region);
        if (cancelled) return;
        if (cached) {
          setIdeas(cached);
          return;
        }

        const fresh = await customFetch<IdeatorResponse>(
          "/api/ideator/generate",
          {
            method: "POST",
            body: JSON.stringify({ region: sp.region, count: 3 }),
          },
        );
        if (cancelled) return;
        setIdeas(fresh.ideas);
        await writeDailyIdeas(sp.region, fresh.ideas);
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(formatError(err, "Couldn't load today's ideas."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  /* ---------- Render ----------------------------------------- */

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
          <View style={styles.loadingBox}>
            <ActivityIndicator color={lumina.firefly} />
            <Text style={styles.loadingText}>Loading today's ideas…</Text>
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
              <IdeaCard
                key={
                  idea.id ??
                  `${i}-${(idea.hook ?? "idea").slice(0, 24)}`
                }
                idea={idea}
                index={i + 1}
              />
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

        {errorMsg ? (
          <Text style={styles.error}>{errorMsg}</Text>
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
    gap: 10,
    paddingVertical: 28,
  },
  loadingText: {
    fontFamily: fontFamily.bodyMedium,
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
  },
  feed: {
    marginTop: 4,
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
});
