import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

import { CosmicBackdrop } from "@/components/foundation/CosmicBackdrop";
import { FireflyParticles } from "@/components/foundation/FireflyParticles";
import { GlassSurface } from "@/components/foundation/GlassSurface";
import { PortalButton } from "@/components/foundation/PortalButton";
import { lumina } from "@/constants/colors";
import { useColors } from "@/hooks/useColors";
import { useStyleTwin } from "@/hooks/useStyleTwin";
import { ensureSeededVectors, getOrchestrator, makeContext } from "@/lib/swarmFactory";
import { creatorKeyFor, DEFAULT_PLATFORMS, DEFAULT_REGIONS } from "@/lib/publisherFactory";
import ConfettiBurst from "@/components/ConfettiBurst";
import LaunchSuccessHero from "@/components/LaunchSuccessHero";
import type {
  PublishPlan,
  PublishResult,
  ABVariant,
} from "@workspace/swarm-studio";

/**
 * Smart Publisher screen — Sprint 3.
 *
 * One-tap "Launch to the World" pipeline:
 *   1. Boot the swarm + walk Ideator → Director → Editor (uses MockOrchestrator).
 *   2. Build the 12-variant A/B + Compliance Shield + smart watermark plan.
 *   3. Render the per-platform Shield verdict (pass / rewritten / blocked)
 *      with plain-English explanations.
 *   4. Single launch tap fires the mock platform clients and shows results.
 *
 * No real network — all platform clients are in-process mocks. Sprint 5
 * swaps in the OAuth + per-platform SDK clients.
 */
export default function PublisherScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const router = useRouter();
  const { twin, loading: twinLoading } = useStyleTwin();

  const isWeb = Platform.OS === "web";
  const topInset = isWeb ? 67 : insets.top;
  const bottomInset = isWeb ? 24 : insets.bottom + 24;

  const [phase, setPhase] = useState<"idle" | "preparing" | "ready" | "launching" | "launched" | "error">("idle");
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
    const briefs = await orchestrator.dailyBriefs(ctx);
    const sb = await orchestrator.storyboard(ctx, briefs[0].id);
    const v = await orchestrator.produce(ctx, sb.id);
    const p = await orchestrator.plan(ctx, v.id, {
      platforms: DEFAULT_PLATFORMS,
      creatorKey: creatorKeyFor(twin),
      regions: DEFAULT_REGIONS,
    });
    return { ctx, plan: p, orchestrator };
  }, [twin]);

  // Auto-prepare a plan preview (without launching) once the Twin is ready,
  // so the user sees the variants + Shield verdicts BEFORE one-tap launch.
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
    const myRun = ++runIdRef.current;
    const isLive = () => mountedRef.current && runIdRef.current === myRun;
    setPhase("preparing");
    setError(null);
    setResult(null);
    try {
      // Reuse a freshly built plan so the variants the user just saw match
      // the launch result exactly (same deterministic plan inputs).
      const built = await buildPlan();
      if (!isLive() || !built) return;
      setPlan(built.plan);
      setPhase("launching");
      const r = await built.orchestrator.launch(built.ctx, built.plan.planId);
      if (!isLive()) return;
      setResult(r);
      setPhase("launched");
    } catch (err) {
      if (!isLive()) return;
      setError((err as Error).message);
      setPhase("error");
    }
  }, [twin, buildPlan]);

  useEffect(() => {
    if (twin && phase === "idle") prepare();
  }, [twin, phase, prepare]);

  const winner = useMemo<ABVariant | null>(() => {
    if (!plan?.winnerId) return null;
    return plan.variants.find((v) => v.id === plan.winnerId) ?? null;
  }, [plan]);

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
          <Feather name="user-x" size={42} color="rgba(255,255,255,0.4)" />
          <Text style={[styles.emptyTitle, { color: "#FFFFFF" }]}>
            Train your Style Twin first
          </Text>
          <Text style={[styles.emptyBody, { color: "rgba(255,255,255,0.65)" }]}>
            The Smart Publisher needs your voice and aesthetic before it can pick variants.
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
      <CosmicBackdrop bloom>
        <FireflyParticles count={14} ambient />
      </CosmicBackdrop>
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: topInset + 16, paddingBottom: bottomInset + 24, gap: 16 }}
    >
      {launchedOnce && <ConfettiBurst />}

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backRow} accessibilityRole="button" accessibilityLabel="Back to Studio">
          <Feather name="chevron-left" size={20} color="rgba(255,255,255,0.55)" />
          <Text style={{ color: "rgba(255,255,255,0.55)", fontWeight: "600" }}>Studio</Text>
        </Pressable>
        <Text style={[styles.eyebrow, { color: lumina.firefly }]}>SMART PUBLISHER</Text>
        <Text style={[styles.title, { color: "#FFFFFF" }]}>Launch to the World</Text>
        <Text style={[styles.subtitle, { color: "rgba(255,255,255,0.65)" }]}>
          12-variant A/B against your Twin · Compliance Shield against 6 platform packs · lossless smart watermark.
        </Text>
      </View>

      {phase === "preparing" && (
        <Card colors={colors}>
          <Row><ActivityIndicator color={colors.tint} /><Text style={[styles.bodyText, { color: colors.foreground, marginLeft: 10 }]}>Preparing plan — running Ideator → Director → Editor and scoring 12 variants…</Text></Row>
        </Card>
      )}

      {phase === "error" && (
        <Card colors={colors} tone="error">
          <Text style={{ color: colors.destructive ?? "#ff6b6b", fontWeight: "600" }}>
            Something went wrong: {error}
          </Text>
        </Card>
      )}

      {plan && (
        <>
          <Card colors={colors}>
            <SectionTitle colors={colors}>A/B verdict ({plan.variants.length} variants)</SectionTitle>
            {winner ? (
              <>
                <Row>
                  <Pill bg={colors.tint} fg="#fff">WINNER · {winner.id}</Pill>
                  <Pill bg={colors.muted} fg={colors.foreground}>Twin {Math.round(winner.twinAffinityVoice * 100)}% voice</Pill>
                  <Pill bg={colors.muted} fg={colors.foreground}>Rank {winner.rankScore.toFixed(3)}</Pill>
                </Row>
                <Text style={[styles.bodyText, { color: colors.foreground, marginTop: 10 }]}>
                  Hook: <Text style={{ fontWeight: "600" }}>{winner.hook}</Text>
                </Text>
                <Text style={[styles.bodyText, { color: colors.foreground }]}>
                  Caption: {winner.caption}
                </Text>
                <Text style={[styles.bodyText, { color: colors.foreground }]}>
                  Thumbnail: {winner.thumbnailLabel}
                </Text>
              </>
            ) : (
              <Text style={[styles.bodyText, { color: colors.destructive ?? "#ff6b6b" }]}>
                No variant cleared the Twin audio gate. {plan.blockedReason}
              </Text>
            )}
            <View style={{ marginTop: 12 }}>
              {plan.variants.map((v) => (
                <View key={v.id} style={[styles.variantRow, { borderColor: colors.border }]}>
                  <Text style={{ color: colors.mutedForeground, width: 64, fontVariant: ["tabular-nums"] }}>{v.id}</Text>
                  <Text style={{ color: colors.foreground, flex: 1 }} numberOfLines={1}>
                    {v.hook}
                  </Text>
                  <Text style={{ color: v.meetsAudioGate ? "#22c2a5" : (colors.destructive ?? "#ff6b6b"), fontVariant: ["tabular-nums"] }}>
                    {(v.twinAffinityVoice * 100).toFixed(1)}%
                  </Text>
                </View>
              ))}
            </View>
          </Card>

          <Card colors={colors}>
            <SectionTitle colors={colors}>Smart watermark</SectionTitle>
            <Text style={[styles.bodyText, { color: colors.foreground }]}>{plan.watermark.tag}</Text>
            <Text style={[styles.mono, { color: colors.mutedForeground }]}>
              sig: {plan.watermark.signature}
            </Text>
            <Text style={[styles.bodyText, { color: colors.mutedForeground, marginTop: 4 }]}>
              Lossless · embedded in the file's metadata atom · survives platform re-encoding.
            </Text>
          </Card>

          <Card colors={colors}>
            <SectionTitle colors={colors}>Compliance Shield · per platform</SectionTitle>
            {plan.perPlatform.length === 0 ? (
              <Text style={[styles.bodyText, { color: colors.mutedForeground }]}>
                Skipped — no winning variant.
              </Text>
            ) : plan.perPlatform.map((pp) => (
              <View key={pp.platform} style={[styles.platformRow, { borderColor: colors.border }]}>
                <Row>
                  <Text style={[styles.platformName, { color: colors.foreground }]}>{pp.platform}</Text>
                  <ShieldStatusPill status={pp.shield.status} colors={colors} />
                  <Text style={{ color: colors.mutedForeground, marginLeft: 8, fontSize: 12 }}>
                    {pp.adaptation.aspect} · {pp.adaptation.maxDurationSec}s · {pp.adaptation.captionStyle}
                  </Text>
                </Row>
                {pp.shield.hits.length > 0 && (
                  <View style={{ marginTop: 6 }}>
                    {pp.shield.hits.map((h) => (
                      <Text key={h.ruleId} style={{
                        color: h.severity === "hard" ? (colors.destructive ?? "#ff6b6b") : colors.mutedForeground,
                        fontSize: 12,
                        marginTop: 2,
                      }}>
                        {h.severity === "hard" ? "🛑 " : "✎ "}{h.explanation}
                      </Text>
                    ))}
                  </View>
                )}
                {pp.shield.status === "rewritten" && (
                  <Text style={{ color: colors.mutedForeground, marginTop: 6, fontSize: 12 }}>
                    Rewritten caption: {pp.content.caption}
                  </Text>
                )}
              </View>
            ))}
          </Card>
        </>
      )}

      {result && (() => {
        const posted = result.perPlatform.filter((r) => r.status !== "blocked").length;
        const blocked = result.perPlatform.length - posted;
        return (
          <>
            <LaunchSuccessHero
              platformsPosted={posted}
              platformsBlocked={blocked}
              summary={result.summary}
            />
            <Card colors={colors}>
              <SectionTitle colors={colors}>Per-platform result</SectionTitle>
              {result.perPlatform.map((r) => (
                <Row key={r.platform}>
                  <Feather
                    name={r.status === "blocked" ? "x-circle" : "check-circle"}
                    size={16}
                    color={r.status === "blocked" ? (colors.destructive ?? "#ff6b6b") : "#22c2a5"}
                  />
                  <Text style={[styles.bodyText, { color: colors.foreground, marginLeft: 8, flex: 1 }]}>
                    {r.platform} — {r.status}
                    {r.mockUrl ? `  ·  ${r.mockUrl}` : ""}
                  </Text>
                </Row>
              ))}
            </Card>
          </>
        );
      })()}

      <View style={{ alignItems: "center", marginTop: 14 }}>
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

/* ─────── primitives ─────── */

function Card({ children, tone }: { children: React.ReactNode; colors: ReturnType<typeof useColors>; tone?: "error" }) {
  return (
    <View style={{ marginHorizontal: 16 }}>
      <GlassSurface radius={18} agent={tone === "error" ? "director" : "ideator"}>
        <View style={{ padding: 16, gap: 4 }}>{children}</View>
      </GlassSurface>
    </View>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

function SectionTitle({ children, colors }: { children: React.ReactNode; colors: ReturnType<typeof useColors> }) {
  return (
    <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{children}</Text>
  );
}

function Pill({ children, bg, fg }: { children: React.ReactNode; bg: string; fg: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color: fg }]}>{children}</Text>
    </View>
  );
}

function ShieldStatusPill({ status }: { status: "pass" | "rewritten" | "blocked"; colors: ReturnType<typeof useColors> }) {
  const bg =
    status === "pass" ? lumina.firefly : status === "rewritten" ? lumina.goldTo : "#FF5A80";
  return (
    <Pill bg={bg} fg="#0A0824">
      {status.toUpperCase()}
    </Pill>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0A0824" },
  container: { flex: 1, backgroundColor: "transparent" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  header: { paddingHorizontal: 24, gap: 4 },
  backRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 6 },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 1.4, marginTop: 4 },
  title: { fontSize: 28, fontWeight: "700", letterSpacing: -0.5 },
  subtitle: { fontSize: 14, lineHeight: 20, marginTop: 4 },
  card: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 4 },
  sectionTitle: { fontSize: 14, fontWeight: "700", marginBottom: 8 },
  bodyText: { fontSize: 14, lineHeight: 20 },
  mono: { fontSize: 12, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", marginTop: 4 },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, marginRight: 6 },
  pillText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.4 },
  variantRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 },
  platformRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, paddingBottom: 6 },
  platformName: { fontSize: 14, fontWeight: "700", textTransform: "capitalize", marginRight: 6 },
  launchCta: { marginHorizontal: 16, marginTop: 8, height: 56, borderRadius: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  launchCtaText: { color: "#fff", fontSize: 16, fontWeight: "700", letterSpacing: 0.2 },
  cta: { marginTop: 20, paddingHorizontal: 24, height: 48, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  ctaText: { color: "#fff", fontWeight: "700" },
  emptyTitle: { fontSize: 20, fontWeight: "700", textAlign: "center" },
  emptyBody: { fontSize: 14, textAlign: "center", lineHeight: 20 },
});
