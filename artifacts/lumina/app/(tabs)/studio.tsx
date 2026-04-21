import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useStyleTwin } from "@/hooks/useStyleTwin";
import { ensureSeededVectors, getOrchestrator, makeContext } from "@/lib/swarmFactory";
import type {
  Brief,
  DealDraft,
  RenderedVideo,
  Storyboard,
} from "@workspace/swarm-studio";

type StepId = "ideator" | "director" | "editor" | "monetizer";
type StepStatus = "pending" | "active" | "done" | "error";

type AgentMeta = {
  id: StepId;
  name: string;
  initial: string;
  hue: string; // avatar background tint
  workingMsg: string;
  doneMsg: string;
};

const AGENTS: Record<StepId, AgentMeta> = {
  ideator:   { id: "ideator",   name: "Ideator",   initial: "I", hue: "#7c5cff", workingMsg: "Scanning today's regional trends and scoring each one against your Twin…", doneMsg: "Here are three briefs I scored live for you:" },
  director:  { id: "director",  name: "Director",  initial: "D", hue: "#3aa6ff", workingMsg: "Storyboarding the top brief to your natural rhythm…",                          doneMsg: "Storyboard ready — paced to your Twin's wpm:" },
  editor:    { id: "editor",    name: "Editor",    initial: "E", hue: "#f25fa6", workingMsg: "Assembling the cut and self-scoring against the publish gate…",              doneMsg: "Cut assembled. Here's how it scored:" },
  monetizer: { id: "monetizer", name: "Monetizer", initial: "M", hue: "#ffb547", workingMsg: "Drafting brand pitches sized to projected reach…",                            doneMsg: "Brand pitches drafted — fee preview included:" },
};

const ORDER: StepId[] = ["ideator", "director", "editor", "monetizer"];

export default function StudioScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const router = useRouter();
  const { twin, loading: twinLoading } = useStyleTwin();

  const isWeb = Platform.OS === "web";
  const topInset = isWeb ? 67 : insets.top;
  const bottomInset = isWeb ? 84 : insets.bottom + 60;

  const [running, setRunning] = useState(false);
  const [statuses, setStatuses] = useState<Record<StepId, StepStatus>>({
    ideator: "pending", director: "pending", editor: "pending", monetizer: "pending",
  });
  const [briefs, setBriefs] = useState<Brief[] | null>(null);
  const [storyboard, setStoryboard] = useState<Storyboard | null>(null);
  const [video, setVideo] = useState<RenderedVideo | null>(null);
  const [deals, setDeals] = useState<DealDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const runIdRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Auto-scroll to bottom whenever a new bubble lands.
  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
    return () => clearTimeout(t);
  }, [statuses, briefs, storyboard, video, deals, error]);

  const runSwarm = useCallback(async () => {
    if (!twin) return;
    const myRun = ++runIdRef.current;
    const isLive = () => mountedRef.current && runIdRef.current === myRun;

    setStatuses({ ideator: "pending", director: "pending", editor: "pending", monetizer: "pending" });
    setBriefs(null); setStoryboard(null); setVideo(null); setDeals(null); setError(null);
    setRunning(true);

    const { orchestrator } = getOrchestrator();
    const ctx = makeContext(twin, "br");
    try {
      await ensureSeededVectors(twin);
      if (!isLive()) return;

      if (isLive()) setStatuses((s) => ({ ...s, ideator: "active" }));
      const bs = await orchestrator.dailyBriefs(ctx);
      if (!isLive()) return;
      setBriefs(bs);
      setStatuses((s) => ({ ...s, ideator: "done", director: "active" }));

      const sb = await orchestrator.storyboard(ctx, bs[0].id);
      if (!isLive()) return;
      setStoryboard(sb);
      setStatuses((s) => ({ ...s, director: "done", editor: "active" }));

      const v = await orchestrator.produce(ctx, sb.id);
      if (!isLive()) return;
      setVideo(v);
      setStatuses((s) => ({ ...s, editor: "done", monetizer: "active" }));

      const ds = await orchestrator.monetize(ctx, v.id);
      if (!isLive()) return;
      setDeals(ds);
      setStatuses((s) => ({ ...s, monetizer: "done" }));
    } catch (err) {
      if (!isLive()) return;
      setError((err as Error).message);
      setStatuses((s) => {
        const next = { ...s };
        for (const id of Object.keys(next) as StepId[]) {
          if (next[id] === "active") next[id] = "error";
        }
        return next;
      });
    } finally {
      if (isLive()) setRunning(false);
    }
  }, [twin]);

  useEffect(() => {
    if (twin && !running && !briefs && !error) runSwarm();
  }, [twin, briefs, running, error, runSwarm]);

  if (twinLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.tint} />
      </View>
    );
  }

  if (!twin) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, paddingHorizontal: 32 }]}>
        <Feather name="user-x" size={42} color={colors.mutedForeground} />
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
          Train your Style Twin first
        </Text>
        <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
          The swarm needs your voice and aesthetic before it can work for you.
        </Text>
        <Pressable
          onPress={() => router.push("/style-twin-train")}
          style={({ pressed }) => [
            styles.cta,
            { backgroundColor: colors.tint, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={styles.ctaText}>Train Style Twin</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingTop: topInset + 16, paddingBottom: bottomInset + 88, gap: 14 }}
    >
      <View style={styles.header}>
        <Text style={[styles.eyebrow, { color: colors.tint }]}>SWARM STUDIO</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>Working for you</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Four agents collaborating on your next post — entirely on your phone.
        </Text>
      </View>

      <SystemBubble colors={colors}>
        Good morning, Maria. The swarm is starting a fresh run for São Paulo (BR).
      </SystemBubble>

      {ORDER.map((id) => {
        const status = statuses[id];
        const agent = AGENTS[id];
        if (status === "pending") return null;

        // Working bubble (typing indicator)
        if (status === "active") {
          return (
            <AgentBubble key={id} agent={agent} colors={colors}>
              <Text style={[styles.bubbleText, { color: colors.foreground }]}>
                {agent.workingMsg}
              </Text>
              <TypingDots colors={colors} />
            </AgentBubble>
          );
        }

        // Error bubble
        if (status === "error") {
          return (
            <AgentBubble key={id} agent={agent} colors={colors} tone="error">
              <Text style={{ color: colors.destructive ?? "#ff6b6b", fontWeight: "600" }}>
                I had to stop. {error}
              </Text>
            </AgentBubble>
          );
        }

        // Done bubble — render the agent's actual output inline.
        return (
          <AgentBubble key={id} agent={agent} colors={colors}>
            <Text style={[styles.bubbleText, { color: colors.foreground }]}>{agent.doneMsg}</Text>
            {id === "ideator"   && briefs     && <BriefsContent     briefs={briefs}         colors={colors} />}
            {id === "director"  && storyboard && <StoryboardContent storyboard={storyboard} colors={colors} />}
            {id === "editor"    && video      && <VideoContent      video={video}           colors={colors} />}
            {id === "monetizer" && deals      && <DealsContent      deals={deals}           colors={colors} />}
          </AgentBubble>
        );
      })}

      {!running && deals && (
        <SystemBubble colors={colors}>
          Run complete. Send it to the world or run another draft.
        </SystemBubble>
      )}

      {!running && deals && (
        <Pressable
          onPress={() => router.push("/publisher")}
          style={({ pressed }) => [
            styles.cta,
            {
              backgroundColor: "#22c2a5",
              opacity: pressed ? 0.85 : 1,
              marginHorizontal: 24,
              marginTop: 8,
            },
          ]}
        >
          <Feather name="zap" size={16} color="#fff" />
          <Text style={styles.ctaText}>Launch to the World</Text>
        </Pressable>
      )}

      <Pressable
        onPress={runSwarm}
        disabled={running}
        style={({ pressed }) => [
          styles.cta,
          {
            backgroundColor: colors.tint,
            opacity: running ? 0.5 : pressed ? 0.85 : 1,
            marginHorizontal: 24,
            marginTop: 8,
          },
        ]}
      >
        <Feather name="refresh-cw" size={16} color="#fff" />
        <Text style={styles.ctaText}>
          {running ? "Swarm working…" : "Run swarm again"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

/* ───────────────────── Bubble primitives ──────────────────── */

function AgentBubble({
  agent, colors, tone, children,
}: {
  agent: AgentMeta;
  colors: ReturnType<typeof useColors>;
  tone?: "error";
  children: React.ReactNode;
}) {
  const borderColor = tone === "error"
    ? (colors.destructive ?? "#ff6b6b")
    : colors.border;
  return (
    <View style={styles.bubbleRow}>
      <View style={[styles.avatar, { backgroundColor: agent.hue }]}>
        <Text style={styles.avatarLetter}>{agent.initial}</Text>
      </View>
      <View style={styles.bubbleColumn}>
        <Text style={[styles.bubbleAuthor, { color: colors.mutedForeground }]}>
          {agent.name}
        </Text>
        <View
          style={[
            styles.bubble,
            {
              backgroundColor: colors.card,
              borderColor,
              borderTopLeftRadius: 4,
            },
          ]}
        >
          {children}
        </View>
      </View>
    </View>
  );
}

function SystemBubble({
  colors, children,
}: { colors: ReturnType<typeof useColors>; children: React.ReactNode }) {
  return (
    <View style={styles.systemRow}>
      <View
        style={[
          styles.systemBubble,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.systemText, { color: colors.mutedForeground }]}>
          {children}
        </Text>
      </View>
    </View>
  );
}

function TypingDots({ colors }: { colors: ReturnType<typeof useColors> }) {
  const a = useRef(new Animated.Value(0)).current;
  const b = useRef(new Animated.Value(0)).current;
  const c = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const dot = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, { toValue: 1, duration: 360, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 360, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      );
    const loops = [dot(a, 0), dot(b, 140), dot(c, 280)];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [a, b, c]);

  const dotStyle = (v: Animated.Value) => ({
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
    transform: [
      { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -2] }) },
    ],
  });

  return (
    <View style={styles.typingRow}>
      <Animated.View style={[styles.typingDot, { backgroundColor: colors.mutedForeground }, dotStyle(a)]} />
      <Animated.View style={[styles.typingDot, { backgroundColor: colors.mutedForeground }, dotStyle(b)]} />
      <Animated.View style={[styles.typingDot, { backgroundColor: colors.mutedForeground }, dotStyle(c)]} />
    </View>
  );
}

/* ───────────────────── Bubble bodies ──────────────────── */

function BriefsContent({ briefs, colors }: { briefs: Brief[]; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={{ gap: 10, marginTop: 10 }}>
      {briefs.map((b) => {
        const aff = b.twinAffinity;
        const gateColor = aff.meetsAudioGate ? colors.tint : (colors.destructive ?? "#ff6b6b");
        return (
          <View key={b.id} style={[styles.subCard, { borderColor: colors.border, backgroundColor: colors.background }]}>
            <View style={styles.briefHeader}>
              <Text style={[styles.subEyebrow, { color: colors.tint }]}>{b.culturalTag.toUpperCase()}</Text>
              <View style={[styles.affinityPill, { borderColor: gateColor }]}>
                <Feather
                  name={aff.meetsAudioGate ? "check-circle" : "alert-circle"}
                  size={11}
                  color={gateColor}
                />
                <Text style={[styles.affinityPillText, { color: gateColor }]}>
                  {(aff.overall * 100).toFixed(1)}% on-Twin
                </Text>
              </View>
            </View>
            <Text style={[styles.subTitle, { color: colors.foreground }]}>{b.hook}</Text>
            <Text style={[styles.subBody, { color: colors.mutedForeground }]}>
              {b.beats.join(" → ")}
            </Text>
            <View style={styles.affinityRow}>
              <Text style={[styles.subMeta, { color: colors.mutedForeground }]}>
                voice <Text style={{ color: colors.foreground, fontWeight: "700" }}>{(aff.voice * 100).toFixed(1)}%</Text>
              </Text>
              <Text style={[styles.subMeta, { color: colors.mutedForeground }]}>
                vocab <Text style={{ color: colors.foreground, fontWeight: "700" }}>{(aff.vocabulary * 100).toFixed(1)}%</Text>
              </Text>
              {b.pastWinReferences.length > 0 && (() => {
                const real = b.pastWinReferences.filter((p) => !p.synthetic).length;
                const synth = b.pastWinReferences.length - real;
                const label =
                  real > 0
                    ? `${real} past win${real === 1 ? "" : "s"} matched`
                    : `${synth} demo neighbor${synth === 1 ? "" : "s"}`;
                return (
                  <Text style={[styles.subMeta, { color: colors.mutedForeground }]}>{label}</Text>
                );
              })()}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function StoryboardContent({ storyboard, colors }: { storyboard: Storyboard; colors: ReturnType<typeof useColors> }) {
  const total = storyboard.shots.reduce((s, x) => s + x.duration, 0);
  return (
    <View style={[styles.subCard, { borderColor: colors.border, backgroundColor: colors.background, marginTop: 10 }]}>
      <Text style={[styles.subEyebrow, { color: colors.mutedForeground }]}>
        TOTAL · {total.toFixed(1)}s
      </Text>
      {storyboard.shots.map((shot, i) => (
        <View key={i} style={styles.shotRow}>
          <Text style={[styles.shotDuration, { color: colors.tint }]}>
            {shot.duration.toFixed(1)}s
          </Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.subBody, { color: colors.foreground }]}>{shot.description}</Text>
            {shot.cameraNote && (
              <Text style={[styles.subMeta, { color: colors.mutedForeground }]}>
                {shot.cameraNote}
              </Text>
            )}
          </View>
        </View>
      ))}
      <View style={{ marginTop: 10, gap: 4 }}>
        <Text style={[styles.subEyebrow, { color: colors.mutedForeground }]}>HOOK VARIANTS</Text>
        {storyboard.hookVariants.map((h, i) => (
          <Text key={i} style={[styles.subBody, { color: colors.foreground }]}>
            · {h}
          </Text>
        ))}
      </View>
    </View>
  );
}

function VideoContent({ video, colors }: { video: RenderedVideo; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={[styles.subCard, { borderColor: colors.border, backgroundColor: colors.background, marginTop: 10 }]}>
      <View style={styles.scoreRow}>
        <ScoreBlock label="Viral confidence" value={`${Math.round(video.viralConfidence * 100)}%`} colors={colors} />
        <ScoreBlock label="Twin match" value={`${Math.round(video.twinMatchScore * 100)}%`} colors={colors} />
        <ScoreBlock label="Duration" value={`${video.durationSec.toFixed(1)}s`} colors={colors} />
      </View>
      <Text style={[styles.subBody, { color: colors.mutedForeground }]}>{video.reasoning}</Text>
    </View>
  );
}

function DealsContent({ deals, colors }: { deals: DealDraft[]; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={{ gap: 10, marginTop: 10 }}>
      {deals.map((d) => (
        <View key={d.id} style={[styles.subCard, { borderColor: colors.border, backgroundColor: colors.background }]}>
          <View style={styles.dealHeader}>
            <Text style={[styles.subTitle, { color: colors.foreground }]}>{d.brandHandle}</Text>
            <Text style={[styles.channelTag, { color: colors.tint, borderColor: colors.tint }]}>
              {d.channel.toUpperCase()}
            </Text>
          </View>
          <Text style={[styles.subBody, { color: colors.mutedForeground }]}>{d.dmDraft}</Text>
          <View style={styles.feeRow}>
            <Text style={[styles.subMeta, { color: colors.mutedForeground }]}>
              You take: <Text style={{ color: colors.foreground, fontWeight: "700" }}>${d.estimatedCreatorTakeUsd}</Text>
            </Text>
            <Text style={[styles.subMeta, { color: colors.mutedForeground }]}>
              Lumina fee: ${d.estimatedFeeUsd}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function ScoreBlock({
  label, value, colors,
}: { label: string; value: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={[styles.subEyebrow, { color: colors.mutedForeground }]}>{label.toUpperCase()}</Text>
      <Text style={[styles.scoreValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  header: { paddingHorizontal: 24, gap: 6, marginBottom: 4 },
  eyebrow: { fontSize: 11, letterSpacing: 1.6, fontWeight: "700" },
  title: { fontSize: 32, fontWeight: "700" },
  subtitle: { fontSize: 15 },

  // Chat row
  bubbleRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 10,
    alignItems: "flex-start",
  },
  avatar: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: "center", justifyContent: "center",
    marginTop: 18,
  },
  avatarLetter: { color: "#fff", fontWeight: "700", fontSize: 14 },
  bubbleColumn: { flex: 1, gap: 4 },
  bubbleAuthor: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    paddingLeft: 4,
  },
  bubble: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 6,
  },
  bubbleText: { fontSize: 14, lineHeight: 20 },

  // System (centered) bubble
  systemRow: {
    paddingHorizontal: 24,
    alignItems: "center",
  },
  systemBubble: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    maxWidth: "90%",
  },
  systemText: { fontSize: 12, textAlign: "center" },

  // Typing indicator
  typingRow: { flexDirection: "row", gap: 5, marginTop: 6, paddingLeft: 2 },
  typingDot: { width: 6, height: 6, borderRadius: 3 },

  // Sub-cards inside bubbles
  subCard: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  subEyebrow: { fontSize: 10, letterSpacing: 1.4, fontWeight: "700" },
  subTitle: { fontSize: 16, fontWeight: "700" },
  subBody: { fontSize: 14, lineHeight: 20 },
  subMeta: { fontSize: 12 },
  shotRow: { flexDirection: "row", gap: 12, paddingVertical: 6 },
  shotDuration: { fontSize: 13, fontWeight: "700", width: 44 },
  scoreRow: { flexDirection: "row", gap: 14, marginBottom: 6 },
  scoreValue: { fontSize: 22, fontWeight: "700", marginTop: 2 },
  dealHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  channelTag: {
    fontSize: 10, fontWeight: "700", letterSpacing: 1,
    paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderRadius: 8,
  },
  feeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  briefHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  affinityPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderRadius: 999,
  },
  affinityPillText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.4 },
  affinityRow: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 4 },

  cta: {
    flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center",
    paddingVertical: 14, borderRadius: 14,
  },
  ctaText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  emptyTitle: { fontSize: 22, fontWeight: "700", textAlign: "center" },
  emptyBody: { fontSize: 15, textAlign: "center" },
});
