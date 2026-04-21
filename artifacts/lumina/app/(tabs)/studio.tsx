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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useStyleTwin } from "@/hooks/useStyleTwin";
import { getOrchestrator, makeContext } from "@/lib/swarmFactory";
import type {
  Brief,
  DealDraft,
  RenderedVideo,
  Storyboard,
} from "@workspace/swarm-studio";

type StepId = "ideator" | "director" | "editor" | "monetizer";
type StepStatus = "pending" | "active" | "done" | "error";

const STEPS: { id: StepId; title: string; verb: string }[] = [
  { id: "ideator",   title: "Ideator",   verb: "Scanning regional trends"      },
  { id: "director",  title: "Director",  verb: "Storyboarding to your rhythm"  },
  { id: "editor",    title: "Editor",    verb: "Assembling and self-scoring"   },
  { id: "monetizer", title: "Monetizer", verb: "Drafting brand pitches"        },
];

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

  // Run-version guard: every invocation increments runIdRef. Async stages
  // check their captured `myRun` against the current runId before writing
  // state, so a stale run from a re-render or duplicated effect cannot
  // overwrite a newer run's results.
  const runIdRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const runSwarm = useCallback(async () => {
    if (!twin) return;
    const myRun = ++runIdRef.current;
    const isLive = () => mountedRef.current && runIdRef.current === myRun;

    setStatuses({ ideator: "pending", director: "pending", editor: "pending", monetizer: "pending" });
    setBriefs(null); setStoryboard(null); setVideo(null); setDeals(null); setError(null);
    setRunning(true);

    const { orchestrator } = getOrchestrator();
    const ctx = makeContext(twin, "br"); // Maria — São Paulo
    try {
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
      <View
        style={[styles.center, { backgroundColor: colors.background, paddingHorizontal: 32 }]}
      >
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
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingTop: topInset + 20, paddingBottom: bottomInset, gap: 18 }}
    >
      <View style={styles.header}>
        <Text style={[styles.eyebrow, { color: colors.tint }]}>SWARM STUDIO</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>Working for you</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Four agents collaborating on your next post — entirely on your phone.
        </Text>
      </View>

      <View style={styles.stepsCard}>
        {STEPS.map((s, i) => (
          <StepRow
            key={s.id}
            index={i}
            title={s.title}
            verb={s.verb}
            status={statuses[s.id]}
            colors={colors}
          />
        ))}
      </View>

      {error && (
        <View style={[styles.errorCard, { borderColor: colors.destructive ?? "#ff6b6b" }]}>
          <Text style={{ color: colors.destructive ?? "#ff6b6b" }}>{error}</Text>
        </View>
      )}

      {briefs && <BriefsBlock briefs={briefs} colors={colors} />}
      {storyboard && <StoryboardBlock storyboard={storyboard} colors={colors} />}
      {video && <VideoBlock video={video} colors={colors} />}
      {deals && <DealsBlock deals={deals} colors={colors} />}

      <Pressable
        onPress={runSwarm}
        disabled={running}
        style={({ pressed }) => [
          styles.cta,
          {
            backgroundColor: colors.tint,
            opacity: running ? 0.5 : pressed ? 0.85 : 1,
            marginHorizontal: 24,
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

function StepRow({
  index, title, verb, status, colors,
}: {
  index: number; title: string; verb: string; status: StepStatus;
  colors: ReturnType<typeof useColors>;
}) {
  const accent =
    status === "done" ? colors.tint :
    status === "active" ? colors.tint :
    status === "error" ? (colors.destructive ?? "#ff6b6b") :
    colors.mutedForeground;
  return (
    <View style={[styles.step, { borderColor: colors.border }]}>
      <View
        style={[
          styles.stepIcon,
          { borderColor: accent, backgroundColor: status === "done" ? accent : "transparent" },
        ]}
      >
        {status === "active" ? (
          <ActivityIndicator size="small" color={accent} />
        ) : status === "done" ? (
          <Feather name="check" size={14} color="#0a0820" />
        ) : status === "error" ? (
          <Feather name="alert-triangle" size={14} color={accent} />
        ) : (
          <Text style={[styles.stepIndex, { color: accent }]}>{index + 1}</Text>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.stepTitle, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.stepVerb, { color: colors.mutedForeground }]}>{verb}</Text>
      </View>
    </View>
  );
}

function BriefsBlock({ briefs, colors }: { briefs: Brief[]; colors: ReturnType<typeof useColors> }) {
  return (
    <Section title="Today's briefs" colors={colors}>
      {briefs.map((b) => (
        <View key={b.id} style={[styles.subCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[styles.subEyebrow, { color: colors.tint }]}>{b.culturalTag.toUpperCase()}</Text>
          <Text style={[styles.subTitle, { color: colors.foreground }]}>{b.hook}</Text>
          <Text style={[styles.subBody, { color: colors.mutedForeground }]}>
            {b.beats.join(" → ")}
          </Text>
        </View>
      ))}
    </Section>
  );
}

function StoryboardBlock({ storyboard, colors }: { storyboard: Storyboard; colors: ReturnType<typeof useColors> }) {
  const total = storyboard.shots.reduce((s, x) => s + x.duration, 0);
  return (
    <Section title={`Storyboard · ${total.toFixed(1)}s`} colors={colors}>
      <View style={[styles.subCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
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
    </Section>
  );
}

function VideoBlock({ video, colors }: { video: RenderedVideo; colors: ReturnType<typeof useColors> }) {
  return (
    <Section title="Editor's verdict" colors={colors}>
      <View style={[styles.subCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <View style={styles.scoreRow}>
          <ScoreBlock label="Viral confidence" value={`${Math.round(video.viralConfidence * 100)}%`} colors={colors} />
          <ScoreBlock label="Twin match" value={`${Math.round(video.twinMatchScore * 100)}%`} colors={colors} />
          <ScoreBlock label="Duration" value={`${video.durationSec.toFixed(1)}s`} colors={colors} />
        </View>
        <Text style={[styles.subBody, { color: colors.mutedForeground }]}>{video.reasoning}</Text>
      </View>
    </Section>
  );
}

function DealsBlock({ deals, colors }: { deals: DealDraft[]; colors: ReturnType<typeof useColors> }) {
  return (
    <Section title="Brand pitches drafted" colors={colors}>
      {deals.map((d) => (
        <View key={d.id} style={[styles.subCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
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
    </Section>
  );
}

function Section({
  title, children, colors,
}: { title: string; children: React.ReactNode; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={{ paddingHorizontal: 24, gap: 10 }}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
      {children}
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
  header: { paddingHorizontal: 24, gap: 6 },
  eyebrow: { fontSize: 11, letterSpacing: 1.6, fontWeight: "700" },
  title: { fontSize: 32, fontWeight: "700" },
  subtitle: { fontSize: 15 },
  stepsCard: { marginHorizontal: 24, gap: 12 },
  step: {
    flexDirection: "row", alignItems: "center", gap: 14,
    paddingVertical: 12, paddingHorizontal: 14,
    borderWidth: 1, borderRadius: 14,
  },
  stepIcon: {
    width: 28, height: 28, borderRadius: 14, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  stepIndex: { fontSize: 13, fontWeight: "700" },
  stepTitle: { fontSize: 15, fontWeight: "600" },
  stepVerb: { fontSize: 12, marginTop: 2 },
  sectionTitle: { fontSize: 13, fontWeight: "600", letterSpacing: 0.4, opacity: 0.85 },
  subCard: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 },
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
  errorCard: { marginHorizontal: 24, padding: 14, borderWidth: 1, borderRadius: 12 },
  cta: {
    flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center",
    paddingVertical: 14, borderRadius: 14,
  },
  ctaText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  emptyTitle: { fontSize: 22, fontWeight: "700", textAlign: "center" },
  emptyBody: { fontSize: 15, textAlign: "center" },
});
