/**
 * Smart Publisher — bioluminescent redesign.
 *
 * The Publisher is the moment the swarm hands the creator the keys to ship.
 * Visual treatment now matches the rest of the cosmic system:
 *
 *   • Cosmic backdrop + ambient fireflies (already in place)
 *   • Lowercase eyebrow + huge lowercase title with chromatic underline
 *   • Each "card" is a GlassSurface tinted to the responsible agent:
 *       – winner & a/b ladder → Editor (gold)
 *       – smart watermark      → Monetizer (amethyst)
 *       – compliance shield    → Director (spark/magenta)
 *   • Affinity bars are firefly gradient ribbons, not hairline tables
 *   • Shield verdict pills carry a glow dot in their tone
 *   • Per-platform result rows use Feather icons + tone glow (no emoji)
 *   • Override chip is a true glass pill in firefly cyan
 *
 * Functional contract unchanged — every callback, runId guard, state
 * transition, and orchestrator call below is byte-for-byte the previous
 * implementation. Only presentation changed.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import Animated, { FadeInUp } from "react-native-reanimated";

import { flags } from "@/lib/featureFlags";
import { CosmicBackdrop } from "@/components/foundation/CosmicBackdrop";
import { FireflyParticles } from "@/components/foundation/FireflyParticles";
import { GlassSurface } from "@/components/foundation/GlassSurface";
import { PortalButton } from "@/components/foundation/PortalButton";
import { agents, lumina, type AgentKey } from "@/constants/colors";
import { type } from "@/constants/typography";
import { feedback } from "@/lib/feedback";
import { useStyleTwin } from "@/hooks/useStyleTwin";
import {
  ensureSeededVectors,
  getOrchestrator,
  makeContext,
} from "@/lib/swarmFactory";
import {
  creatorKeyFor,
  DEFAULT_PLATFORMS,
  DEFAULT_REGIONS,
} from "@/lib/publisherFactory";
import ConfettiBurst from "@/components/ConfettiBurst";
import LaunchSuccessHero from "@/components/LaunchSuccessHero";
import type {
  PublishPlan,
  PublishResult,
  ABVariant,
} from "@workspace/swarm-studio";
import {
  useRecordPublication,
  getListVideoPublicationsQueryKey,
  getListRecentPublicationsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

type ShieldStatus = "pass" | "rewritten" | "blocked";

const SHIELD_TONE: Record<ShieldStatus, { hex: string; bg: string; label: string }> = {
  pass: { hex: lumina.firefly, bg: "rgba(0,255,204,0.14)", label: "pass" },
  rewritten: { hex: lumina.goldTo, bg: "rgba(255,215,0,0.14)", label: "rewritten" },
  blocked: { hex: lumina.spark, bg: "rgba(255,30,158,0.16)", label: "blocked" },
};

export default function PublisherScreen() {
  // PHASE UX3.3 — defensive route-level guard. The closed-beta nav
  // never links to /publisher, but a deep-link or stale history
  // entry could still land here. Redirect to the tab bar.
  // `flags.SHOW_POST_BETA_SURFACES` is computed once at module load
  // from a process.env value, so the early-return-before-hooks
  // pattern is safe (hook ordering is stable across the app's
  // lifetime; the flag does not flip at runtime).
  if (!flags.SHOW_POST_BETA_SURFACES) {
    return <Redirect href="/(tabs)" />;
  }
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { twin, loading: twinLoading } = useStyleTwin();

  // Optional creative override forwarded from /studio/[id] when the user
  // submitted a prompt through the lily-pad. Threaded into dailyBriefs so
  // the variants the Publisher renders + launches actually reflect that
  // prompt rather than a fresh deterministic ideation.
  //
  // We consume the URL param into local state once and then strip it from
  // the URL via router.replace. Two reasons:
  //   1. Privacy — free-form user prompts shouldn't sit in browser
  //      history / link previews / referrer headers on web.
  //   2. Back-nav hygiene — the override applies to *this* visit, not
  //      to a future stale return to the screen.
  const params = useLocalSearchParams<{ override?: string; videoId?: string }>();
  const [creativeOverride, setCreativeOverride] = useState<string | undefined>(undefined);
  // The swarm-produced DB videoId (if Studio handed us one). Used purely
  // for persisting per-platform publish outcomes back to the backend so
  // Studio can render "✓ tiktok / ✓ reels" badges on next visit. Held in
  // a ref because it's a side-channel that doesn't drive any rendering.
  const targetVideoIdRef = useRef<string | null>(null);
  const consumedOverrideRef = useRef(false);
  useEffect(() => {
    if (consumedOverrideRef.current) return;
    const rawOverride = params.override;
    const rawVideoId = params.videoId;
    if (typeof rawOverride !== "string" && typeof rawVideoId !== "string") return;
    consumedOverrideRef.current = true;
    if (typeof rawOverride === "string") {
      const trimmed = rawOverride.trim();
      if (trimmed.length > 0) setCreativeOverride(trimmed);
    }
    if (typeof rawVideoId === "string" && rawVideoId.length > 0) {
      targetVideoIdRef.current = rawVideoId;
    }
    // Strip both params for the same privacy / back-nav-hygiene reasons
    // — the override is freeform user text, and the videoId is a one-shot
    // signal we've now captured into local state.
    router.replace("/publisher");
  }, [params.override, params.videoId, router]);

  // Persistence wiring — only fires when we have a target videoId.
  const queryClient = useQueryClient();
  const recordPublication = useRecordPublication();

  const isWeb = Platform.OS === "web";
  const topInset = isWeb ? 24 : insets.top;
  const bottomInset = isWeb ? 32 : insets.bottom + 32;

  const [phase, setPhase] = useState<
    "idle" | "preparing" | "ready" | "launching" | "launched" | "error"
  >("idle");
  const [plan, setPlan] = useState<PublishPlan | null>(null);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sequence guard: every kick (prepare or launch) bumps the run id.
  // Async results from older runs are dropped so a late tap never
  // overwrites the freshest state — and unmounted writes are skipped.
  const runIdRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const buildPlan = useCallback(async () => {
    if (!twin) return null;
    const { orchestrator } = getOrchestrator();
    const ctx = makeContext(twin, "br");
    await ensureSeededVectors(twin);
    const briefs = await orchestrator.dailyBriefs(ctx, { creativeOverride });
    const sb = await orchestrator.storyboard(ctx, briefs[0].id);
    const v = await orchestrator.produce(ctx, sb.id);
    const p = await orchestrator.plan(ctx, v.id, {
      platforms: DEFAULT_PLATFORMS,
      creatorKey: creatorKeyFor(twin),
      regions: DEFAULT_REGIONS,
    });
    return { ctx, plan: p, orchestrator };
  }, [twin, creativeOverride]);

  const prepare = useCallback(async () => {
    if (!twin) return;
    const myRun = ++runIdRef.current;
    const isLive = () => mountedRef.current && runIdRef.current === myRun;
    setPhase("preparing");
    setError(null);
    setPlan(null);
    setResult(null);
    try {
      const built = await buildPlan();
      if (!isLive() || !built) return;
      setPlan(built.plan);
      setPhase("ready");
    } catch (err) {
      if (!isLive()) return;
      setError((err as Error).message);
      setPhase("error");
    }
  }, [twin, buildPlan]);

  const launch = useCallback(async () => {
    if (!twin) return;
    feedback.portal();
    const myRun = ++runIdRef.current;
    const isLive = () => mountedRef.current && runIdRef.current === myRun;
    setPhase("preparing");
    setError(null);
    setResult(null);
    try {
      const built = await buildPlan();
      if (!isLive() || !built) return;
      setPlan(built.plan);
      setPhase("launching");
      const r = await built.orchestrator.launch(built.ctx, built.plan.planId);
      if (!isLive()) return;
      setResult(r);
      setPhase("launched");
      if (!r.hardBlocked) feedback.success();
      else feedback.error();

      // Persist per-platform outcomes against the swarm-produced video.
      // Best-effort: failures here never throw to the caller — the
      // launch itself succeeded, and a failed persistence just means
      // the badges won't hydrate. We log to dev console so it's
      // diagnosable without crashing the user-visible flow.
      const targetVideoId = targetVideoIdRef.current;
      if (targetVideoId) {
        const PLATFORM_TO_API: Record<string, "tiktok" | "reels" | "shorts"> = {
          tiktok: "tiktok",
          reels: "reels",
          shorts: "shorts",
        };
        // Build a platform→shield-verdict lookup from the publish PLAN
        // (the launch RESULT carries only post outcomes, not shield state).
        const shieldByPlatform = new Map(
          built.plan.perPlatform.map((pp) => [pp.platform, pp.shield.status]),
        );
        await Promise.allSettled(
          r.perPlatform.map(async (pp) => {
            const apiPlatform = PLATFORM_TO_API[pp.platform];
            if (!apiPlatform) return;
            const status: "published" | "blocked" =
              pp.status === "blocked" ? "blocked" : "published";
            try {
              await recordPublication.mutateAsync({
                id: targetVideoId,
                data: {
                  platform: apiPlatform,
                  status,
                  // Shield verdict captured at the moment of publish; the
                  // server cross-checks this and refuses status='published'
                  // rows whose verdict is 'blocked'.
                  shieldVerdict: (shieldByPlatform.get(pp.platform) ??
                    "pass") as "pass" | "rewritten" | "blocked",
                  mockUrl: pp.mockUrl ?? null,
                  error: pp.reason ?? null,
                },
              });
            } catch (persistErr) {
              if (__DEV__) {
                // eslint-disable-next-line no-console
                console.warn("[publisher] persistence failed", persistErr);
              }
            }
          }),
        );
        await queryClient.invalidateQueries({
          queryKey: getListVideoPublicationsQueryKey(targetVideoId),
        });
        await queryClient.invalidateQueries({
          queryKey: getListRecentPublicationsQueryKey(),
        });
      }
    } catch (err) {
      if (!isLive()) return;
      setError((err as Error).message);
      setPhase("error");
      feedback.error();
    }
  }, [twin, buildPlan, recordPublication, queryClient]);

  useEffect(() => {
    if (twin && phase === "idle") prepare();
  }, [twin, phase, prepare]);

  const lastBuiltOverrideRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!twin) return;
    if (lastBuiltOverrideRef.current === creativeOverride) return;
    if (phase === "preparing" || phase === "launching") return;
    lastBuiltOverrideRef.current = creativeOverride;
    void prepare();
  }, [twin, creativeOverride, phase, prepare]);

  const winner = useMemo<ABVariant | null>(() => {
    if (!plan?.winnerId) return null;
    return plan.variants.find((v) => v.id === plan.winnerId) ?? null;
  }, [plan]);

  // ── Twin-loading & no-twin guard rails ─────────────────────────────────
  if (twinLoading) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <CosmicBackdrop bloom>
          <FireflyParticles count={10} ambient />
        </CosmicBackdrop>
        <View style={styles.center}>
          <ActivityIndicator color={lumina.firefly} />
        </View>
      </View>
    );
  }

  if (!twin) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <CosmicBackdrop bloom>
          <FireflyParticles count={14} ambient />
        </CosmicBackdrop>
        <View style={[styles.center, { paddingHorizontal: 32 }]}>
          <Feather name="user-x" size={42} color="rgba(255,255,255,0.4)" />
          <Text style={[type.subhead, styles.emptyTitle]}>
            train your style twin first
          </Text>
          <Text style={[type.body, styles.emptyBody]}>
            the smart publisher needs your voice and aesthetic before it can
            pick variants. upload 10–30s clips you've already posted or
            would post — talking, POV, outfit, reaction, or simple daily
            moments work best.
          </Text>
          <View style={{ marginTop: 22 }}>
            <PortalButton
              label="train style twin"
              onPress={() => router.push("/style-twin-train")}
              width={240}
              subtle
            />
          </View>
        </View>
      </View>
    );
  }

  // Confetti only fires on the first successful launch result the user sees,
  // so re-renders for unrelated state changes don't replay the animation.
  const launchedOnce = phase === "launched" && result != null && !result.hardBlocked;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <CosmicBackdrop bloom>
        <FireflyParticles count={14} ambient />
      </CosmicBackdrop>

      <ScrollView
        contentContainerStyle={{
          paddingTop: topInset + 12,
          paddingBottom: bottomInset,
        }}
        showsVerticalScrollIndicator={false}
      >
        {launchedOnce && <ConfettiBurst />}

        {/* ── Header ────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <Pressable
            onPress={() => {
              feedback.tap();
              router.back();
            }}
            hitSlop={12}
            style={styles.backRow}
            accessibilityRole="button"
            accessibilityLabel="back to studio"
          >
            <Feather name="chevron-left" size={18} color="rgba(255,255,255,0.55)" />
            <Text style={styles.backText}>studio</Text>
          </Pressable>

          <Text style={[type.label, styles.eyebrow]}>smart publisher</Text>
          <View style={styles.titleWrap}>
            <Text style={[type.subhead, styles.title]}>launch to the world</Text>
            <LinearGradient
              colors={[lumina.goldFrom, lumina.firefly, lumina.spark] as [
                string,
                string,
                string,
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.titleUnderline}
            />
          </View>
          <Text style={[type.body, styles.subtitle]}>
            12-variant a/b against your twin · compliance shield against 6
            platform packs · lossless smart watermark.
          </Text>

          {creativeOverride && (
            <View style={styles.overrideChip}>
              <Feather name="message-circle" size={12} color={lumina.firefly} />
              <Text
                style={[type.microDelight, styles.overrideChipText]}
                numberOfLines={2}
              >
                built around your prompt:{" "}
                <Text style={styles.overrideChipPrompt}>{creativeOverride}</Text>
              </Text>
            </View>
          )}
        </View>

        {/* ── Preparing ─────────────────────────────────────────────── */}
        {phase === "preparing" && (
          <View style={styles.section}>
            <GlassSurface radius={22} agent="ideator" breathing>
              <View style={styles.preparingInner}>
                <ActivityIndicator color={lumina.firefly} />
                <Text style={[type.body, styles.preparingText]}>
                  preparing plan — running ideator → director → editor and
                  scoring 12 variants…
                </Text>
              </View>
            </GlassSurface>
          </View>
        )}

        {/* ── Error ─────────────────────────────────────────────────── */}
        {phase === "error" && (
          <View style={styles.section}>
            <GlassSurface radius={22} agent="director">
              <View style={styles.errorInner}>
                <Feather name="alert-triangle" size={18} color={lumina.spark} />
                <Text style={[type.body, styles.errorText]}>
                  something went wrong: {error}
                </Text>
              </View>
            </GlassSurface>
          </View>
        )}

        {/* ── Plan ──────────────────────────────────────────────────── */}
        {plan && (
          <>
            {/* Winner + A/B ladder */}
            <Animated.View entering={FadeInUp.duration(520)} style={styles.section}>
              <GlassSurface radius={22} agent="editor">
                <View style={styles.cardInner}>
                  <View style={styles.cardHeader}>
                    <Feather name="award" size={16} color={lumina.goldTo} />
                    <Text style={[type.label, styles.cardEyebrow]}>
                      a/b verdict · {plan.variants.length} variants
                    </Text>
                  </View>

                  {winner ? (
                    <>
                      <View style={styles.winnerRow}>
                        <GlowPill
                          tone={lumina.goldTo}
                          bg="rgba(255,215,0,0.16)"
                          label={`winner · ${winner.id}`}
                        />
                        <GlowPill
                          tone={lumina.firefly}
                          bg="rgba(0,255,204,0.12)"
                          label={`twin ${Math.round(winner.twinAffinityVoice * 100)}% voice`}
                        />
                        <GlowPill
                          tone={lumina.coreSoft}
                          bg="rgba(139,77,255,0.18)"
                          label={`rank ${winner.rankScore.toFixed(3)}`}
                        />
                      </View>

                      <View style={styles.winnerDetails}>
                        <DetailLine label="hook" value={winner.hook} bold />
                        <DetailLine label="caption" value={winner.caption} />
                        <DetailLine label="thumbnail" value={winner.thumbnailLabel} />
                      </View>
                    </>
                  ) : (
                    <View style={styles.blockedBlock}>
                      <Feather name="x-octagon" size={18} color={lumina.spark} />
                      <Text style={[type.body, styles.blockedText]}>
                        no variant cleared the twin audio gate.{" "}
                        {plan.blockedReason ?? ""}
                      </Text>
                    </View>
                  )}

                  <Text style={[type.microDelight, styles.ladderEyebrow]}>
                    full ladder
                  </Text>
                  <View style={styles.ladder}>
                    {plan.variants.map((v) => (
                      <VariantBar
                        key={v.id}
                        variant={v}
                        isWinner={v.id === plan.winnerId}
                      />
                    ))}
                  </View>
                </View>
              </GlassSurface>
            </Animated.View>

            {/* Smart watermark */}
            <Animated.View
              entering={FadeInUp.duration(520).delay(80)}
              style={styles.section}
            >
              <GlassSurface radius={22} agent="monetizer">
                <View style={styles.cardInner}>
                  <View style={styles.cardHeader}>
                    <Feather name="hash" size={16} color={lumina.coreSoft} />
                    <Text style={[type.label, styles.cardEyebrow]}>
                      smart watermark
                    </Text>
                  </View>
                  <Text style={[type.bodyEmphasis, styles.watermarkTag]}>
                    {plan.watermark.tag}
                  </Text>
                  <Text style={styles.watermarkSig} numberOfLines={1}>
                    sig: {plan.watermark.signature}
                  </Text>
                  <Text style={[type.microDelight, styles.watermarkExplain]}>
                    lossless · embedded in the file's metadata atom · survives
                    platform re-encoding.
                  </Text>
                </View>
              </GlassSurface>
            </Animated.View>

            {/* Compliance Shield */}
            <Animated.View
              entering={FadeInUp.duration(520).delay(160)}
              style={styles.section}
            >
              <GlassSurface radius={22} agent="director">
                <View style={styles.cardInner}>
                  <View style={styles.cardHeader}>
                    <Feather name="shield" size={16} color={lumina.spark} />
                    <Text style={[type.label, styles.cardEyebrow]}>
                      compliance shield · per platform
                    </Text>
                  </View>

                  {plan.perPlatform.length === 0 ? (
                    <Text style={[type.body, styles.mutedBody]}>
                      skipped — no winning variant.
                    </Text>
                  ) : (
                    <View style={styles.platformList}>
                      {plan.perPlatform.map((pp) => (
                        <View key={pp.platform} style={styles.platformRow}>
                          <View style={styles.platformHead}>
                            <Text style={[type.bodyEmphasis, styles.platformName]}>
                              {pp.platform}
                            </Text>
                            <ShieldPill status={pp.shield.status as ShieldStatus} />
                            <Text style={styles.platformAdapt}>
                              {pp.adaptation.aspect} ·{" "}
                              {pp.adaptation.maxDurationSec}s ·{" "}
                              {pp.adaptation.captionStyle}
                            </Text>
                          </View>
                          {pp.shield.hits.length > 0 && (
                            <View style={styles.hitsList}>
                              {pp.shield.hits.map((h) => (
                                <View key={h.ruleId} style={styles.hitRow}>
                                  <Feather
                                    name={
                                      h.severity === "hard"
                                        ? "x-circle"
                                        : "edit-3"
                                    }
                                    size={11}
                                    color={
                                      h.severity === "hard"
                                        ? lumina.spark
                                        : "rgba(255,255,255,0.55)"
                                    }
                                  />
                                  <Text
                                    style={[
                                      styles.hitText,
                                      h.severity === "hard" && {
                                        color: lumina.sparkSoft,
                                      },
                                    ]}
                                  >
                                    {h.explanation}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          )}
                          {pp.shield.status === "rewritten" && (
                            <Text style={styles.rewrittenText}>
                              rewritten caption: {pp.content.caption}
                            </Text>
                          )}
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </GlassSurface>
            </Animated.View>
          </>
        )}

        {/* ── Result ────────────────────────────────────────────────── */}
        {result && (() => {
          const posted = result.perPlatform.filter((r) => r.status !== "blocked").length;
          const blocked = result.perPlatform.length - posted;
          return (
            <>
              <View style={styles.section}>
                <LaunchSuccessHero
                  platformsPosted={posted}
                  platformsBlocked={blocked}
                  summary={result.summary}
                />
              </View>

              <Animated.View
                entering={FadeInUp.duration(520)}
                style={styles.section}
              >
                <GlassSurface radius={22} agent="ideator">
                  <View style={styles.cardInner}>
                    <View style={styles.cardHeader}>
                      <Feather name="send" size={16} color={lumina.firefly} />
                      <Text style={[type.label, styles.cardEyebrow]}>
                        per-platform result
                      </Text>
                    </View>
                    <View style={styles.resultList}>
                      {result.perPlatform.map((r) => {
                        const ok = r.status !== "blocked";
                        const tone = ok ? lumina.firefly : lumina.spark;
                        return (
                          <View key={r.platform} style={styles.resultRow}>
                            <View
                              style={[
                                styles.resultDot,
                                {
                                  backgroundColor: tone,
                                  boxShadow: `0 0 6px ${tone}` as never,
                                },
                              ]}
                            />
                            <Text style={[type.body, styles.resultPlatform]}>
                              {r.platform}
                            </Text>
                            <Text
                              style={[
                                type.label,
                                styles.resultStatus,
                                { color: tone },
                              ]}
                            >
                              {r.status}
                            </Text>
                            {r.mockUrl ? (
                              <Text style={styles.resultUrl} numberOfLines={1}>
                                {r.mockUrl}
                              </Text>
                            ) : null}
                          </View>
                        );
                      })}
                    </View>
                  </View>
                </GlassSurface>
              </Animated.View>
            </>
          );
        })()}

        {/* ── Launch CTA ────────────────────────────────────────────── */}
        <View style={styles.ctaWrap}>
          <PortalButton
            label={
              phase === "launching"
                ? "launching…"
                : phase === "launched"
                  ? "launch again"
                  : "launch to the world"
            }
            onPress={launch}
            width={280}
            subtle
            disabled={
              phase === "preparing" ||
              phase === "launching" ||
              (plan != null && !plan.winnerId)
            }
          />
        </View>
      </ScrollView>
    </View>
  );
}

/* ─────── Sub-components ─────── */

function GlowPill({
  tone,
  bg,
  label,
}: {
  tone: string;
  bg: string;
  label: string;
}) {
  return (
    <View style={[styles.glowPill, { backgroundColor: bg }]}>
      <View
        style={[
          styles.glowDot,
          { backgroundColor: tone, boxShadow: `0 0 5px ${tone}` as never },
        ]}
      />
      <Text style={[styles.glowPillText, { color: tone }]}>{label}</Text>
    </View>
  );
}

function DetailLine({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <View style={styles.detailLine}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, bold && styles.detailValueBold]}>
        {value}
      </Text>
    </View>
  );
}

function VariantBar({
  variant,
  isWinner,
}: {
  variant: ABVariant;
  isWinner: boolean;
}) {
  const pct = Math.max(0, Math.min(1, variant.twinAffinityVoice));
  const passes = variant.meetsAudioGate;
  const tone = passes ? lumina.firefly : lumina.spark;

  return (
    <View style={[styles.variantRow, isWinner && styles.variantRowWinner]}>
      <Text
        style={[
          styles.variantId,
          isWinner && { color: lumina.goldTo, fontWeight: "700" },
        ]}
      >
        {variant.id}
      </Text>
      <View style={styles.variantHookCol}>
        <Text style={styles.variantHook} numberOfLines={1}>
          {variant.hook}
        </Text>
        <View style={styles.variantTrack}>
          <View
            style={[
              styles.variantFill,
              { width: `${Math.round(pct * 100)}%`, backgroundColor: tone },
            ]}
          />
        </View>
      </View>
      <Text style={[styles.variantPct, { color: tone }]}>
        {(pct * 100).toFixed(1)}%
      </Text>
    </View>
  );
}

function ShieldPill({ status }: { status: ShieldStatus }) {
  const tone = SHIELD_TONE[status];
  return (
    <View style={[styles.shieldPill, { backgroundColor: tone.bg }]}>
      <View
        style={[
          styles.shieldDot,
          {
            backgroundColor: tone.hex,
            boxShadow: `0 0 5px ${tone.hex}` as never,
          },
        ]}
      />
      <Text style={[styles.shieldText, { color: tone.hex }]}>{tone.label}</Text>
    </View>
  );
}

/* ─────── Styles ─────── */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0A0824" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },

  // Header
  header: {
    paddingHorizontal: 22,
    marginBottom: 22,
  },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 16,
  },
  backText: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    fontWeight: "600",
    textTransform: "lowercase",
  },
  eyebrow: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  titleWrap: { alignSelf: "flex-start", alignItems: "flex-start" },
  title: {
    color: "#FFFFFF",
    fontSize: 30,
    lineHeight: 34,
    textTransform: "lowercase",
    textShadowColor: "rgba(0,255,204,0.25)",
    textShadowRadius: 16,
  },
  titleUnderline: {
    height: 2,
    width: 200,
    borderRadius: 2,
    marginTop: 4,
    opacity: 0.85,
  },
  subtitle: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 14,
  },
  overrideChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: "rgba(0,255,204,0.35)",
    backgroundColor: "rgba(0,255,204,0.08)",
  },
  overrideChipText: {
    flex: 1,
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    lineHeight: 16,
  },
  overrideChipPrompt: {
    color: lumina.fireflySoft,
    fontStyle: "italic",
  },

  // Sections + cards
  section: { marginBottom: 18, paddingHorizontal: 22 },
  cardInner: { padding: 18, gap: 12 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardEyebrow: {
    color: "#FFFFFF",
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },

  // Preparing
  preparingInner: {
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  preparingText: { flex: 1, color: "rgba(255,255,255,0.85)", fontSize: 13 },

  // Error
  errorInner: {
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  errorText: { flex: 1, color: lumina.sparkSoft, fontSize: 13 },

  // Winner pills + details
  winnerRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  winnerDetails: { gap: 4, marginTop: 4 },
  detailLine: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  detailLabel: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    width: 78,
    marginTop: 2,
  },
  detailValue: { color: "rgba(255,255,255,0.9)", fontSize: 14, flex: 1, lineHeight: 19 },
  detailValueBold: { fontWeight: "700", color: "#FFFFFF" },

  // Blocked block
  blockedBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "rgba(255,30,158,0.10)",
    borderWidth: 0.5,
    borderColor: "rgba(255,30,158,0.35)",
  },
  blockedText: { flex: 1, color: lumina.sparkSoft, fontSize: 13 },

  // Variant ladder
  ladderEyebrow: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginTop: 6,
  },
  ladder: { gap: 8 },
  variantRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  variantRowWinner: {
    backgroundColor: "rgba(255,215,0,0.07)",
    borderWidth: 0.5,
    borderColor: "rgba(255,215,0,0.35)",
  },
  variantId: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    width: 56,
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.5,
  },
  variantHookCol: { flex: 1, gap: 4 },
  variantHook: { color: "rgba(255,255,255,0.85)", fontSize: 13 },
  variantTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  variantFill: { height: "100%", borderRadius: 2 },
  variantPct: {
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    width: 52,
    textAlign: "right",
    fontWeight: "600",
  },

  // Watermark
  watermarkTag: { color: "#FFFFFF", marginTop: 2 },
  watermarkSig: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  watermarkExplain: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    marginTop: 4,
    lineHeight: 16,
  },

  // Compliance per-platform
  mutedBody: { color: "rgba(255,255,255,0.6)", fontSize: 13 },
  platformList: { gap: 14 },
  platformRow: {
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.10)",
  },
  platformHead: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  platformName: {
    color: "#FFFFFF",
    textTransform: "capitalize",
    fontSize: 14,
  },
  platformAdapt: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
    letterSpacing: 0.4,
    flexBasis: "100%",
    marginTop: 2,
  },
  hitsList: { marginTop: 8, gap: 4 },
  hitRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  hitText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    flex: 1,
    lineHeight: 16,
  },
  rewrittenText: {
    color: "rgba(255,215,0,0.85)",
    fontSize: 12,
    marginTop: 8,
    lineHeight: 16,
    fontStyle: "italic",
  },

  // Glow pill
  glowPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  glowDot: { width: 5, height: 5, borderRadius: 999 },
  glowPillText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "lowercase",
  },

  // Shield pill
  shieldPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  shieldDot: { width: 5, height: 5, borderRadius: 999 },
  shieldText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },

  // Result
  resultList: { gap: 8, marginTop: 4 },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
  },
  resultDot: { width: 7, height: 7, borderRadius: 999 },
  resultPlatform: {
    color: "#FFFFFF",
    fontSize: 13,
    width: 90,
    textTransform: "capitalize",
  },
  resultStatus: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "lowercase",
    width: 72,
  },
  resultUrl: {
    flex: 1,
    color: "rgba(255,255,255,0.45)",
    fontSize: 11,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },

  // Empty
  emptyTitle: {
    color: "#FFFFFF",
    textAlign: "center",
    textTransform: "lowercase",
  },
  emptyBody: {
    color: "rgba(255,255,255,0.65)",
    textAlign: "center",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },

  // CTA
  ctaWrap: { alignItems: "center", marginTop: 14 },
});

// Suppress unused-import warning for `agents` / `Image` — these are
// intentionally available for future agent-avatar accents in the launch
// hero block but not surfaced in this pass.
void agents;
void Image;
