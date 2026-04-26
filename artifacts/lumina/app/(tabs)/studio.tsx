/**
 * Swarm Studio Tab — the beating heart of Lumina.
 *
 * This is the *tab landing* version of Studio. It shares the cinematic
 * primitives with `app/studio/[id].tsx` (constellation, reasoning bubble,
 * lily-pad input, light-explosion → publisher hand-off) but is composed
 * for an open-ended landing experience rather than a specific video.
 *
 * Differences from `studio/[id].tsx`:
 *   1. Top Command Deck instead of a back-button header — small Twin orb
 *      on the left, live status pill in the centre, "new idea" portal on
 *      the right. There is no /tabs back-nav by design.
 *   2. The preview theater renders **live swarm output** (top brief →
 *      storyboard → video → deal) as the chain resolves, instead of a
 *      pre-bound video thumbnail. Empty state shows the lily-pad zone.
 *   3. A subtle "Hive Ignition" bloom on first mount: constellation +
 *      preview slide/fade in with a 320 ms spring overshoot.
 *
 * Data path mirrors `studio/[id].tsx` exactly: a guarded async chain
 * (Ideator → Director → Editor → Monetizer) with seeded fallbacks so
 * the bubble + status pill always have something cinematic to say even
 * before live data resolves.
 */

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing,
  FadeInDown,
  FadeInUp,
  ZoomIn,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { CosmicBackdrop } from "@/components/foundation/CosmicBackdrop";
import { FireflyParticles } from "@/components/foundation/FireflyParticles";
import { GlassSurface } from "@/components/foundation/GlassSurface";
import { PortalButton } from "@/components/foundation/PortalButton";
import { StyleTwinOrb } from "@/components/foundation/StyleTwinOrb";
import { AgentConstellation } from "@/components/studio/AgentConstellation";
import { LightExplosion } from "@/components/studio/LightExplosion";
import { LilyPadInput } from "@/components/studio/LilyPadInput";
import { ReasoningBubble } from "@/components/studio/ReasoningBubble";
import { agents, lumina, type AgentKey } from "@/constants/colors";
import { type } from "@/constants/typography";
import { useStyleTwin } from "@/hooks/useStyleTwin";
import {
  ensureSeededVectors,
  getOrchestrator,
  makeContext,
} from "@/lib/swarmFactory";
import type {
  Brief,
  DealDraft,
  RenderedVideo,
  Storyboard,
} from "@workspace/swarm-studio";

type ReasoningMap = Record<AgentKey, string>;

/** Where in the chain we currently are. Drives status pill + preview state. */
type ChainStep =
  | "warming"
  | "ideating"
  | "directing"
  | "editing"
  | "monetizing"
  | "complete"
  | "error";

const SEED_REASONING: ReasoningMap = {
  ideator:
    "Scanning today's regional trend feed for hooks that match your timbre fingerprint…",
  director:
    "Sketching a 9:16 storyboard with safe-zone-aware framing…",
  editor:
    "Pacing the middle beats against your retention-curve memory…",
  monetizer:
    "Matching your audience to brand pools — drafting a respectful DM…",
};

const AGENT_ORDER: AgentKey[] = ["ideator", "director", "editor", "monetizer"];

const SUGGESTIONS = [
  "Make the hook punchier",
  "Add a B-roll sweep",
  "Caption in PT/BR too",
];

/** Status pill copy keyed on chain step. */
const STATUS_COPY: Record<ChainStep, string> = {
  warming: "Swarm warming up · 4 agents online",
  ideating: "Ideator scoring trends…",
  directing: "Director storyboarding…",
  editing: "Editor cutting + scoring…",
  monetizing: "Monetizer drafting deals…",
  complete: "Swarm ready · tap to publish",
  error: "Swarm hit a snag · retry from the bar",
};

export default function StudioTabScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const topInset = isWeb ? 24 : insets.top;
  // Tab bar inset — leave room above the floating glass tab bar.
  const bottomInset = isWeb ? 108 : insets.bottom + 108;

  const { twin, loading: twinLoading } = useStyleTwin();

  // ── Live swarm chain state ───────────────────────────────────────────
  const [reasoning, setReasoning] = useState<ReasoningMap>(SEED_REASONING);
  const [chainStep, setChainStep] = useState<ChainStep>("warming");
  const [briefs, setBriefs] = useState<Brief[] | null>(null);
  const [storyboard, setStoryboard] = useState<Storyboard | null>(null);
  const [video, setVideo] = useState<RenderedVideo | null>(null);
  const [deals, setDeals] = useState<DealDraft[] | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);

  // Cycle through agents *only while idle* so the constellation breathes
  // without remounting bubbles during an active chain or publish walk.
  const [idleStep, setIdleStep] = useState(0);

  // Run-id guard + unmount guard so a late chain doesn't overwrite a
  // fresher one *and* so callbacks resolving after unmount become no-ops.
  const runIdRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );
  const runSwarmChain = useCallback(
    async (opts?: {
      preserveIdeatorAck?: boolean;
      creativeOverride?: string;
    }) => {
      if (!twin) return;
      const myRun = ++runIdRef.current;
      const isLive = () =>
        mountedRef.current && runIdRef.current === myRun;

      setReasoning((prev) =>
        opts?.preserveIdeatorAck
          ? { ...SEED_REASONING, ideator: prev.ideator }
          : SEED_REASONING,
      );
      setBriefs(null);
      setStoryboard(null);
      setVideo(null);
      setDeals(null);
      setChainError(null);
      setChainStep("ideating");

      const { orchestrator } = getOrchestrator();
      const ctx = makeContext(twin, "us");
      try {
        await ensureSeededVectors(twin);
        if (!isLive()) return;

        const bs = await orchestrator.dailyBriefs(ctx, {
          creativeOverride: opts?.creativeOverride,
        });
        if (!isLive()) return;
        // Empty briefs is a recoverable terminal state — surface it instead
        // of leaving the pill stuck on "Ideator scoring trends…".
        if (bs.length === 0) {
          setChainError("No briefs surfaced. Try a different prompt.");
          setChainStep("error");
          return;
        }
        const brief = bs[0]!;
        setBriefs(bs);
        const affinity = Math.round(brief.twinAffinity.overall * 100);
        setReasoning((r) => ({
          ...r,
          ideator: `Hook: "${brief.hook}" — ${brief.culturalTag}, ${affinity}% twin affinity.`,
        }));
        setChainStep("directing");

        const sb = await orchestrator.storyboard(ctx, brief.id);
        if (!isLive()) return;
        setStoryboard(sb);
        const opener = sb.shots[0]?.description ?? "opening shot";
        setReasoning((r) => ({
          ...r,
          director: `${sb.shots.length}-shot vertical board. Opening on: ${opener}`,
        }));
        setChainStep("editing");

        const v = await orchestrator.produce(ctx, sb.id);
        if (!isLive()) return;
        setVideo(v);
        setReasoning((r) => ({ ...r, editor: v.reasoning }));
        setChainStep("monetizing");

        const drafts = await orchestrator.monetize(ctx, v.id);
        if (!isLive()) return;
        // No matched brand pool — still a successful render, just nothing
        // to monetize today. Mark complete so the user can publish anyway.
        if (drafts.length === 0) {
          setReasoning((r) => ({
            ...r,
            monetizer:
              "No brand pool matched today — publishing organically is still a great call.",
          }));
          setChainStep("complete");
          return;
        }
        setDeals(drafts);
        const d = drafts[0]!;
        setReasoning((r) => ({
          ...r,
          monetizer: `Brand fit: ${d.brandHandle} via ${d.channel} — ~$${d.estimatedCreatorTakeUsd.toFixed(0)} creator take. Drafting DM.`,
        }));
        setChainStep("complete");
      } catch (err) {
        if (!isLive()) return;
        if (__DEV__) console.warn("[studio-tab] swarm chain failed", err);
        setChainError((err as Error).message);
        setChainStep("error");
      }
    },
    [twin],
  );

  useEffect(() => {
    void runSwarmChain();
  }, [runSwarmChain]);

  // ── Prompt + publish state ───────────────────────────────────────────
  const [prompt, setPrompt] = useState("");
  const [stickyOverride, setStickyOverride] = useState<string | undefined>(
    undefined,
  );
  const [phase, setPhase] = useState<"idle" | "walking" | "exploding">("idle");
  const [walkAgent, setWalkAgent] = useState<AgentKey | null>(null);
  const walkTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const clearWalkTimers = useCallback(() => {
    walkTimers.current.forEach(clearTimeout);
    walkTimers.current = [];
  }, []);
  useEffect(() => () => clearWalkTimers(), [clearWalkTimers]);

  const handlePublish = useCallback(() => {
    if (chainStep !== "complete") return;
    setPhase("walking");
    clearWalkTimers();
    AGENT_ORDER.forEach((agent, i) => {
      const t = setTimeout(() => setWalkAgent(agent), i * 700);
      walkTimers.current.push(t);
    });
    const ignite = setTimeout(() => {
      setPhase("exploding");
    }, AGENT_ORDER.length * 700);
    walkTimers.current.push(ignite);
  }, [clearWalkTimers, chainStep]);

  const handleExplosionComplete = useCallback(() => {
    setPhase("idle");
    setWalkAgent(null);
    router.push(
      stickyOverride
        ? { pathname: "/publisher", params: { override: stickyOverride } }
        : "/publisher",
    );
  }, [router, stickyOverride]);

  const handleSubmit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed) {
        setReasoning((r) => ({
          ...r,
          ideator: `Heard: "${trimmed}". Re-running the swarm with this in mind…`,
        }));
        setStickyOverride(trimmed);
      }
      setPrompt("");
      setIdleStep(0);
      void runSwarmChain({
        preserveIdeatorAck: trimmed.length > 0,
        creativeOverride: trimmed || undefined,
      });
    },
    [runSwarmChain],
  );

  // ── Active agent for constellation surge + bubble ────────────────────
  // While the chain is actively running, the *running* agent surges. While
  // walking the publish sequence, walkAgent overrides. Otherwise idle
  // cycler drives.
  const runningAgent: AgentKey | null = useMemo(() => {
    switch (chainStep) {
      case "ideating":
        return "ideator";
      case "directing":
        return "director";
      case "editing":
        return "editor";
      case "monetizing":
        return "monetizer";
      default:
        return null;
    }
  }, [chainStep]);

  // Idle = chain is settled AND we're not in the publish walk. We only let
  // the idle cycler tick (and only let it influence the rendered active
  // agent / bubble key) in idle, so an active chain has cinematic
  // continuity instead of remount churn every 3.6 s.
  const isIdle = phase === "idle" && runningAgent === null;
  useEffect(() => {
    if (!isIdle) return;
    const t = setInterval(
      () => setIdleStep((s) => (s + 1) % AGENT_ORDER.length),
      3600,
    );
    return () => clearInterval(t);
  }, [isIdle]);

  const activeAgent: AgentKey =
    phase === "walking" && walkAgent
      ? walkAgent
      : (runningAgent ?? AGENT_ORDER[idleStep]!);

  const activeBubbleText = reasoning[activeAgent];

  // Only re-key the bubble on idle ticks while idle; otherwise key by the
  // chain phase + active agent so the bubble persists across cycler ticks.
  const bubbleKey = isIdle
    ? `idle-${activeAgent}-${idleStep}`
    : `${activeAgent}-${chainStep}-${phase}`;

  // ── Empty Twin gate ──────────────────────────────────────────────────
  if (twinLoading) {
    return (
      <View style={styles.root}>
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
        <CosmicBackdrop bloom>
          <FireflyParticles count={14} ambient />
        </CosmicBackdrop>
        <View style={[styles.center, { paddingHorizontal: 32 }]}>
          <Feather
            name="user-x"
            size={42}
            color="rgba(255,255,255,0.4)"
          />
          <Text style={[styles.emptyTitle, { color: "#FFFFFF" }]}>
            Train your Style Twin first
          </Text>
          <Text style={[styles.emptyBody, { color: "rgba(255,255,255,0.65)" }]}>
            The hive needs your voice and aesthetic before it can light up.
            Upload 10–30s videos you've already posted or would post —
            talking, POV, outfit, reaction, or simple daily clips work best.
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

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <CosmicBackdrop bloom>
        <FireflyParticles count={14} ambient />
      </CosmicBackdrop>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={topInset}
      >
        {/* ── Top Command Deck ────────────────────────────────────── */}
        <Animated.View
          entering={FadeInDown.duration(320).easing(
            Easing.out(Easing.cubic),
          )}
          style={[styles.commandDeck, { paddingTop: topInset + 8 }]}
          accessibilityLiveRegion="polite"
        >
          {/* Mini Twin orb — left */}
          <View style={styles.twinOrbSlot}>
            <StyleTwinOrb
              size={56}
              mood={runningAgent ? "excited" : "idle"}
            />
          </View>

          {/* Status pill — center */}
          <View style={styles.statusSlot}>
            <StatusPill step={chainStep} />
          </View>

          {/* New idea — right */}
          <Pressable
            onPress={() => {
              if (phase !== "idle") return;
              setPrompt("");
              setStickyOverride(undefined);
              setIdleStep(0);
              void runSwarmChain();
            }}
            disabled={phase !== "idle"}
            accessibilityRole="button"
            accessibilityLabel="Run a fresh swarm idea"
            style={({ pressed }) => [
              styles.newIdeaBtn,
              {
                opacity: phase !== "idle" ? 0.4 : pressed ? 0.7 : 1,
                shadowColor: lumina.spark,
              },
            ]}
            hitSlop={10}
          >
            <Feather name="plus" size={20} color="#FFFFFF" />
          </Pressable>
        </Animated.View>

        {/* ── Constellation centerpiece — Hive Ignition bloom ─────── */}
        <Animated.View
          entering={ZoomIn.duration(360).easing(
            Easing.out(Easing.cubic),
          )}
          style={styles.constellation}
        >
          <AgentConstellation
            size={300}
            active={activeAgent}
            agreeing={
              phase === "walking" && walkAgent === "monetizer"
                ? AGENT_ORDER
                : []
            }
          />
        </Animated.View>

        {/* ── Reasoning bubble ────────────────────────────────────── */}
        <View style={styles.bubbleSlot}>
          <ReasoningBubble
            key={bubbleKey}
            agent={activeAgent}
            text={activeBubbleText}
          />
        </View>

        {/* ── Cinematic Preview Theater ───────────────────────────── */}
        <Animated.View
          entering={FadeInUp.duration(380)
            .delay(120)
            .easing(Easing.out(Easing.cubic))}
          style={styles.previewWrap}
        >
          <GlassSurface radius={20} agent={activeAgent} breathing>
            <LiveOutputPreview
              chainStep={chainStep}
              briefs={briefs}
              storyboard={storyboard}
              video={video}
              deals={deals}
              chainError={chainError}
            />
          </GlassSurface>
        </Animated.View>

        {/* ── Publish portal ───────────────────────────────────────── */}
        <View style={styles.publishWrap}>
          <PortalButton
            label={
              phase === "walking"
                ? "the hive is publishing…"
                : chainStep === "complete"
                  ? "approve & publish"
                  : "the hive is still working…"
            }
            onPress={handlePublish}
            width={260}
            subtle
            disabled={phase !== "idle" || chainStep !== "complete"}
          />
        </View>

        {/* ── Lily-pad command bar ─────────────────────────────────── */}
        <View style={{ paddingBottom: bottomInset }}>
          <LilyPadInput
            value={prompt}
            onChangeText={setPrompt}
            onSubmit={handleSubmit}
            suggestions={SUGGESTIONS}
            disabled={phase !== "idle"}
          />
        </View>
      </KeyboardAvoidingView>

      <LightExplosion
        active={phase === "exploding"}
        onComplete={handleExplosionComplete}
      />
    </View>
  );
}

/* ────────────────────── Live Output Preview ──────────────────────── */

/**
 * Theater contents — morphs as the chain progresses. Empty state shows
 * the lily-pad zone; each completed step replaces it with a compact
 * cinematic card. Every agent contribution becomes visible *here* the
 * moment it lands.
 */
function LiveOutputPreview({
  chainStep,
  briefs,
  storyboard,
  video,
  deals,
  chainError,
}: {
  chainStep: ChainStep;
  briefs: Brief[] | null;
  storyboard: Storyboard | null;
  video: RenderedVideo | null;
  deals: DealDraft[] | null;
  chainError: string | null;
}) {
  // Pick the most-advanced piece of data we have.
  const latest: "deals" | "video" | "storyboard" | "briefs" | "empty" =
    deals && deals.length > 0
      ? "deals"
      : video
        ? "video"
        : storyboard
          ? "storyboard"
          : briefs && briefs.length > 0
            ? "briefs"
            : "empty";

  if (chainStep === "error") {
    return (
      <View style={styles.previewInner}>
        <Feather
          name="alert-circle"
          size={28}
          color={lumina.spark}
          style={{ alignSelf: "center", marginBottom: 8 }}
        />
        <Text
          style={[type.body, styles.previewBody, { textAlign: "center" }]}
        >
          The hive paused.{chainError ? ` ${chainError}` : ""} Tap the bar
          below to ask the swarm to try again.
        </Text>
      </View>
    );
  }

  if (latest === "empty") {
    return <EmptyLilyPadState />;
  }

  if (latest === "briefs" && briefs) {
    const brief = briefs[0]!;
    const aff = Math.round(brief.twinAffinity.overall * 100);
    return (
      <View style={styles.previewInner}>
        <PreviewEyebrow color={agents.ideator.hex}>
          IDEATOR · BRIEF #1
        </PreviewEyebrow>
        <Text style={[type.subheadSm, styles.previewHook]}>
          “{brief.hook}”
        </Text>
        <View style={styles.previewMetaRow}>
          <PreviewChip
            label={brief.culturalTag.toUpperCase()}
            tint={agents.ideator.hex}
          />
          <PreviewChip
            label={`${aff}% on-twin`}
            tint={
              brief.twinAffinity.meetsAudioGate
                ? lumina.firefly
                : lumina.spark
            }
          />
        </View>
      </View>
    );
  }

  if (latest === "storyboard" && storyboard) {
    const total = storyboard.shots.reduce((s, x) => s + x.duration, 0);
    return (
      <View style={styles.previewInner}>
        <PreviewEyebrow color={agents.director.hex}>
          DIRECTOR · {storyboard.shots.length} SHOTS · {total.toFixed(1)}s
        </PreviewEyebrow>
        <Text style={[type.body, styles.previewBody]} numberOfLines={3}>
          Opening on: {storyboard.shots[0]?.description ?? "—"}
        </Text>
        <View style={styles.previewMetaRow}>
          {storyboard.shots.slice(0, 4).map((shot, i) => (
            <View
              key={i}
              style={[
                styles.shotTick,
                { backgroundColor: agents.director.hex },
              ]}
            />
          ))}
        </View>
      </View>
    );
  }

  if (latest === "video" && video) {
    return (
      <View style={styles.previewInner}>
        <PreviewEyebrow color={agents.editor.hex}>
          EDITOR · CUT ASSEMBLED
        </PreviewEyebrow>
        <View style={styles.previewScoreRow}>
          <ScoreBlock
            label="VIRAL"
            value={`${Math.round(video.viralConfidence * 100)}%`}
          />
          <ScoreBlock
            label="TWIN"
            value={`${Math.round(video.twinMatchScore * 100)}%`}
          />
          <ScoreBlock
            label="DUR"
            value={`${video.durationSec.toFixed(1)}s`}
          />
        </View>
        <Text style={[type.body, styles.previewBody]} numberOfLines={2}>
          {video.reasoning}
        </Text>
      </View>
    );
  }

  // deals (the chain is complete — show the brand match)
  if (latest === "deals" && deals) {
    const d = deals[0]!;
    return (
      <View style={styles.previewInner}>
        <PreviewEyebrow color={agents.monetizer.hex}>
          MONETIZER · DEAL DRAFTED
        </PreviewEyebrow>
        <Text style={[type.subheadSm, styles.previewHook]}>
          {d.brandHandle}
        </Text>
        <Text style={[type.body, styles.previewBody]} numberOfLines={2}>
          {d.dmDraft}
        </Text>
        <View style={styles.previewMetaRow}>
          <PreviewChip
            label={d.channel.toUpperCase()}
            tint={agents.monetizer.hex}
          />
          <PreviewChip
            label={`$${d.estimatedCreatorTakeUsd} take`}
            tint={lumina.firefly}
          />
        </View>
      </View>
    );
  }

  return <EmptyLilyPadState />;
}

function EmptyLilyPadState() {
  return (
    <View style={[styles.previewInner, { alignItems: "center" }]}>
      <View style={styles.lilyDots}>
        <LilyDot offset={0} />
        <LilyDot offset={0.33} />
        <LilyDot offset={0.66} />
      </View>
      <Text style={[type.microDelight, styles.lilyHint]}>
        Drop an idea below — the swarm is listening.
      </Text>
    </View>
  );
}

/** Single bobbing dot — split out so each instance gets its own hook
 *  call site (Rules of Hooks). They share phase by their `offset` prop. */
function LilyDot({ offset }: { offset: number }) {
  const a = useSharedValue(0);
  useEffect(() => {
    a.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [a]);
  const style = useAnimatedStyle(() => {
    "worklet";
    const v = (a.value + offset) % 1;
    return {
      opacity: 0.35 + 0.5 * Math.sin(v * Math.PI),
      transform: [{ scale: 0.9 + 0.2 * Math.sin(v * Math.PI) }],
    };
  });
  return <Animated.View style={[styles.lilyDot, style]} />;
}

/* ────────────────────────── Status pill ──────────────────────────── */

function StatusPill({ step }: { step: ChainStep }) {
  const live = step !== "complete" && step !== "error" && step !== "warming";
  const dotColor =
    step === "error"
      ? lumina.spark
      : step === "complete"
        ? lumina.firefly
        : live
          ? lumina.goldTo
          : lumina.firefly;

  // Subtle heartbeat on the leading dot — faster while live, slower idle.
  const beat = useSharedValue(0);
  useEffect(() => {
    beat.value = withRepeat(
      withTiming(1, {
        duration: live ? 800 : 1800,
        easing: Easing.inOut(Easing.sin),
      }),
      -1,
      true,
    );
  }, [beat, live]);
  const dotStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      opacity: 0.55 + 0.45 * beat.value,
      transform: [{ scale: 0.85 + 0.25 * beat.value }],
    };
  });

  return (
    <GlassSurface radius={999} intensity={30}>
      <View
        style={styles.statusInner}
        accessible
        accessibilityRole="text"
        accessibilityLabel={`Swarm status: ${STATUS_COPY[step]}`}
        accessibilityLiveRegion="polite"
      >
        <Animated.View
          style={[
            styles.statusDot,
            { backgroundColor: dotColor, shadowColor: dotColor },
            dotStyle,
          ]}
        />
        <Text style={styles.statusText} numberOfLines={1}>
          {STATUS_COPY[step]}
        </Text>
      </View>
    </GlassSurface>
  );
}

/* ─────────────────────── Preview primitives ─────────────────────── */

function PreviewEyebrow({
  color,
  children,
}: {
  color: string;
  children: React.ReactNode;
}) {
  return (
    <Text
      style={[
        type.label,
        {
          color,
          fontSize: 11,
          letterSpacing: 1.4,
          marginBottom: 8,
        },
      ]}
    >
      {children}
    </Text>
  );
}

function PreviewChip({ label, tint }: { label: string; tint: string }) {
  return (
    <View
      style={[
        styles.previewChip,
        { borderColor: tint, backgroundColor: `${tint}1A` },
      ]}
    >
      <Text style={[styles.previewChipText, { color: tint }]}>{label}</Text>
    </View>
  );
}

function ScoreBlock({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text
        style={{
          color: "rgba(255,255,255,0.5)",
          fontSize: 10,
          letterSpacing: 1.2,
          fontWeight: "700",
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: "#FFFFFF",
          fontSize: 22,
          fontWeight: "700",
          marginTop: 2,
          fontVariant: ["tabular-nums"],
        }}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0A0824" },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },

  /* Top command deck */
  commandDeck: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 4,
    gap: 12,
  },
  twinOrbSlot: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  statusSlot: {
    flex: 1,
    alignItems: "center",
  },
  statusInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  statusText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.2,
    maxWidth: 220,
  },
  newIdeaBtn: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,30,158,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,30,158,0.55)",
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },

  /* Constellation centrepiece */
  constellation: {
    alignItems: "center",
    justifyContent: "center",
    height: 280,
    marginTop: 4,
  },

  /* Reasoning bubble slot */
  bubbleSlot: {
    paddingHorizontal: 22,
    minHeight: 92,
    justifyContent: "center",
  },

  /* Preview theater */
  previewWrap: {
    paddingHorizontal: 22,
    paddingTop: 4,
  },
  previewInner: {
    minHeight: 132,
    paddingHorizontal: 16,
    paddingVertical: 16,
    justifyContent: "center",
  },
  previewHook: {
    color: "#FFFFFF",
    marginBottom: 10,
  },
  previewBody: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 13,
    lineHeight: 18,
  },
  previewMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
    alignItems: "center",
  },
  previewChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  previewChipText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  previewScoreRow: {
    flexDirection: "row",
    gap: 14,
    marginBottom: 8,
  },
  shotTick: {
    width: 40,
    height: 4,
    borderRadius: 2,
    opacity: 0.65,
  },
  lilyDots: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
  },
  lilyDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: lumina.firefly,
    shadowColor: lumina.firefly,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  lilyHint: {
    color: "rgba(255,255,255,0.65)",
    textAlign: "center",
  },

  /* Publish CTA */
  publishWrap: {
    alignItems: "center",
    paddingTop: 16,
    paddingBottom: 6,
    marginTop: "auto",
  },

  /* Twin-gate empty state */
  emptyTitle: { fontSize: 22, fontWeight: "700", textAlign: "center" },
  emptyBody: { fontSize: 15, textAlign: "center", lineHeight: 21 },
});
