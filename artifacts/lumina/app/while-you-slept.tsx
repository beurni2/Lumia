/**
 * "While You Slept" — the sacred morning ritual.
 *
 * This is the screen the creator wakes up to. The brief calls it a
 * "private victory ceremony" where the swarm hands the user the proof
 * their empire grew overnight. The screen orchestrates five acts:
 *
 *   1. Dawn Awakening      — cosmic backdrop with a warm sunrise glow
 *                            sweeping in from the top edge, fireflies
 *                            drifting, Style Twin orb breathing.
 *   2. Hero Greeting       — personalised welcome + Twin voice-note bubble.
 *   3. Money Moment        — gold supernova count-up with the four agent
 *                            avatars orbiting and personality lines that
 *                            describe each agent's overnight contribution.
 *   4. Growth Constellation — interconnected glass orbs (followers, views,
 *                            best performer, viral confidence).
 *   5. Agent Love Letters  — horizontal carousel where each agent
 *                            "speaks" directly to the creator.
 *   6. Tomorrow's Promise  — three Ignite-This-Now orbs that route into
 *                            Swarm Studio with the trend pre-loaded.
 *
 * Data discipline:
 *   • Authoritative numbers come from `buildMorningRecap()` (deposits,
 *     totals, bounty, tomorrowPlan, headline). Sprint-4 contract intact.
 *   • Narrative numbers (new followers, total views, viral confidence)
 *     are *derived* from the recap on-screen so the demo always feels
 *     consistent with the gold money moment — every doc'd as a derived
 *     value below, never hard-coded magic strings.
 *
 * Explicitly deferred (would need new assets / native modules):
 *   • Spoken voice-note playback (audio assets pending Phase 6).
 *   • Device-tilt parallax (would need expo-sensors + per-layer transforms).
 *   • Rive-driven 3D agent avatars (today's `<AgentAvatar>` is the SVG-lite
 *     version — Rive swap is a foundation-level upgrade, not screen work).
 *   • Auto-playing 9:16 best-performer preview (no overnight video asset
 *     in the recap contract — shows static still + breathing border instead).
 */

import React, { useEffect, useMemo, useState } from "react";
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
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  AgentAvatar,
  CosmicBackdrop,
  FireflyParticles,
  GlassSurface,
  StyleTwinOrb,
} from "@/components/foundation";
import ConfettiBurst from "@/components/ConfettiBurst";
import { SwarmCta } from "@/components/SwarmCta";
import { agents, lumina, type AgentKey } from "@/constants/colors";
import { getImage } from "@/lib/imageRegistry";
import {
  useGetCurrentCreator,
  useGetEarningsSummary,
  useListTrendBriefs,
} from "@workspace/api-client-react";
import { type } from "@/constants/typography";
import { useCountUp } from "@/hooks/useCountUp";
import { useStyleTwin } from "@/hooks/useStyleTwin";
import { feedback } from "@/lib/feedback";
import { creatorKeyFor } from "@/lib/publisherFactory";
import {
  buildMorningRecap,
  REFERRAL_BOUNTY_BREAKDOWN,
  type MorningRecap,
  type RecapDeposit,
} from "@/lib/morningRecapFactory";

/** Personality lines per agent — locked copy from the brief. */
const AGENT_VOICE: Record<
  AgentKey,
  { tagline: string; loveLetter: string; signoff: string }
> = {
  monetizer: {
    tagline: "I snuck in the perfect affiliate at peak watch time",
    loveLetter:
      "I watched your audience hit peak attention at 0:23 and slid the brand link in cleanly. They didn't even notice the pivot.",
    signoff: "Thank you for trusting me with your wallet.",
  },
  editor: {
    tagline: "Cut the awkward pause at 0:09 — retention exploded",
    loveLetter:
      "There was a beat where you breathed in. I trimmed it. The graph after that point looks like a heartbeat — exactly how it should.",
    signoff: "Thank you for trusting me with your timing.",
  },
  director: {
    tagline: "Paced it like a cinema trailer",
    loveLetter:
      "I rebuilt the structure: hook, tension, payoff. Average watch time shot up. People stayed for you, not the algorithm.",
    signoff: "Thank you for trusting me with your story.",
  },
  ideator: {
    tagline: "Found the trending audio your audience is obsessed with",
    loveLetter:
      "Three sounds were spiking in your niche while you slept. I picked the one that fits your voice. It's already moving.",
    signoff: "Thank you for trusting me with your spark.",
  },
};

const AGENT_ORDER: readonly AgentKey[] = [
  "monetizer",
  "editor",
  "director",
  "ideator",
];

export default function WhileYouSleptScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { twin, loading: twinLoading } = useStyleTwin();
  const { data: creator } = useGetCurrentCreator();
  const { data: trendsData } = useListTrendBriefs();
  const { data: earnings } = useGetEarningsSummary();
  // Stabilise the array reference — React Query memoises `data`, but the
  // optional-chained fallback would otherwise build a fresh `[]` each render
  // and retrigger the recap effect endlessly while data is loading.
  const trendBriefs = useMemo(() => trendsData?.briefs ?? [], [trendsData]);
  const seedBrandDealUsd = earnings?.deals?.[0]?.amount;

  const isWeb = Platform.OS === "web";
  const topInset = isWeb ? 24 : insets.top;
  const bottomInset = isWeb ? 32 : insets.bottom + 32;

  const [recap, setRecap] = useState<MorningRecap | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    if (twinLoading) return;
    const key = twin ? creatorKeyFor(twin) : "lumina-demo-creator";
    (async () => {
      try {
        const r = await buildMorningRecap(key, {
          trendBriefs,
          seedBrandDealUsd,
        });
        if (mounted) setRecap(r);
      } catch (e) {
        if (mounted) setError(String(e));
      }
    })();
    return () => {
      mounted = false;
    };
  }, [twin, twinLoading, trendBriefs, seedBrandDealUsd]);

  // Total USD overnight earnings — drives the supernova count-up + mood.
  const usdTotal = recap?.totalsByCurrency.USD ?? 0;
  const animatedUsd = useCountUp(usdTotal, 1600);

  const orbMood: "idle" | "excited" | "supernova" =
    usdTotal > 300 ? "supernova" : usdTotal > 50 ? "excited" : "idle";

  // Bucket each deposit into the agent that earned it. Performance-fee
  // creator-take is the Monetizer's win; referral bounties are the
  // Director's (community storytelling). Ideator + Editor share the
  // remainder evenly by index so every agent always has a contribution
  // number to talk about — keeps the constellation visually balanced.
  const perAgentUsd = useMemo(() => {
    if (!recap) {
      return { monetizer: 0, editor: 0, director: 0, ideator: 0 } as Record<
        AgentKey,
        number
      >;
    }
    const totals: Record<AgentKey, number> = {
      monetizer: 0,
      editor: 0,
      director: 0,
      ideator: 0,
    };
    let leftoverIdx = 0;
    for (const d of recap.deposits) {
      if (d.currency !== "USD") continue;
      if (d.source === "performance-fee-creator-take") {
        totals.monetizer += d.amount;
      } else if (
        d.source === "referral-bounty-referrer" ||
        d.source === "referral-bounty-referee"
      ) {
        totals.director += d.amount;
      } else {
        // brand-deal / future sources alternate Ideator ↔ Editor.
        if (leftoverIdx % 2 === 0) totals.ideator += d.amount;
        else totals.editor += d.amount;
        leftoverIdx++;
      }
    }
    return totals;
  }, [recap]);

  // Narrative numbers — derived from the recap so the constellation feels
  // anchored to the same overnight story (never hard-coded constants).
  const growth = useMemo(() => {
    if (!recap) {
      return { followers: 0, viewsM: 0, viralConfidence: 0 };
    }
    const depositCount = recap.deposits.length;
    const followers = 90 + depositCount * 56; // every deposit ≈ 56 new fans
    const viewsM = +(0.4 + usdTotal / 250).toFixed(1); // M views per $250
    const viralConfidence = recap.tomorrowPlan.length
      ? Math.round(
          recap.tomorrowPlan.reduce((s, p) => s + p.viralPotential, 0) /
            recap.tomorrowPlan.length,
        )
      : 0;
    return { followers, viewsM, viralConfidence };
  }, [recap, usdTotal]);

  if (!recap) {
    return (
      <View style={[styles.loading, { paddingTop: topInset }]}>
        <CosmicBackdrop />
        <ActivityIndicator color={lumina.firefly} size="large" />
        <Text style={styles.loadingText}>
          {error ?? "Stitching together your overnight earnings…"}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <CosmicBackdrop />
      <FireflyParticles count={28} ambient />

      {/* Dawn glow — warm volumetric sunrise sweeping in from the top edge.
          A real volumetric sunrise needs a fragment shader; this layered
          gradient + radial halo reads "dawn returning home" cheaply. */}
      <LinearGradient
        colors={[
          "rgba(255,215,0,0.18)",
          "rgba(255,30,158,0.10)",
          "rgba(107,30,255,0.04)",
          "rgba(10,8,36,0)",
        ]}
        locations={[0, 0.35, 0.7, 1]}
        style={[styles.dawnGlow, { height: 320 + topInset }]}
        pointerEvents="none"
      />

      {usdTotal > 0 && <ConfettiBurst pieces={36} durationMs={2200} />}

      <ScrollView
        contentContainerStyle={{
          paddingTop: topInset + 12,
          paddingBottom: bottomInset,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Close header */}
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => {
              feedback.tap();
              router.back();
            }}
            hitSlop={12}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel="Close overnight recap"
          >
            <Feather name="x" size={22} color="rgba(246,243,255,0.65)" />
          </Pressable>
          <Text style={styles.eyebrow}>
            last night · {recap.hoursAsleep}h shift
          </Text>
          <View style={styles.closeBtn} />
        </View>

        {/* ── Act 1+2: Dawn Awakening + Hero Greeting ────────────────── */}
        <Animated.View
          entering={FadeInDown.duration(720)}
          style={styles.heroSection}
        >
          <StyleTwinOrb size={196} mood={orbMood}>
            <Image
              source={getImage(creator?.imageKey)}
              style={styles.heroAvatar}
              accessibilityIgnoresInvertColors
            />
          </StyleTwinOrb>

          <Text style={[type.subhead, styles.heroHeadline]}>
            Good morning,{"\n"}
            <Text style={styles.heroHeadlineEmphasis}>{creator?.name ?? ""}</Text>
          </Text>
          <Text style={[type.body, styles.heroSub]}>
            Your hive never sleeps — and neither does your empire.
          </Text>

          {/* Voice-note bubble (visual stub — real audio in Phase 6). */}
          <View style={styles.voiceBubble}>
            <View style={styles.voiceWave}>
              {[6, 10, 14, 9, 12, 7, 11].map((h, i) => (
                <View
                  key={i}
                  style={[
                    styles.voiceBar,
                    { height: h, backgroundColor: lumina.firefly },
                  ]}
                />
              ))}
            </View>
            <Text style={[type.microDelight, styles.voiceText]}>
              "we missed you. look what we built while you dreamed."
            </Text>
          </View>
        </Animated.View>

        {/* ── Act 3: The Money Moment ────────────────────────────────── */}
        <Animated.View
          entering={FadeInUp.duration(640).delay(180)}
          style={styles.moneySection}
        >
          <Text style={[type.microDelight, styles.moneyEyebrow]}>
            ✦ earned while you slept
          </Text>
          <View style={styles.moneyAmountWrap}>
            <Text style={[type.heroDisplay, styles.moneyAmount]}>
              ${animatedUsd.toLocaleString()}
            </Text>
            {/* Gold underline bloom */}
            <LinearGradient
              colors={[lumina.goldFrom, lumina.spark, lumina.goldTo] as [
                string,
                string,
                string,
              ]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.moneyUnderline}
            />
          </View>
          <Text style={[type.body, styles.moneySubline]}>
            your swarm's love letter to you
          </Text>

          {/* Agent contribution constellation — four orbs in a row, each
              with the agent's personality tagline and the dollar amount
              bucketed from the recap above. */}
          <View style={styles.agentConstellation}>
            {AGENT_ORDER.map((key) => {
              const meta = agents[key];
              const amt = perAgentUsd[key];
              return (
                <View key={key} style={styles.agentNode}>
                  <AgentAvatar agent={key} state="agreeing" size={48} />
                  <Text
                    style={[
                      type.label,
                      styles.agentNodeAmount,
                      { color: meta.hex },
                    ]}
                  >
                    {amt > 0 ? `+$${Math.round(amt).toLocaleString()}` : "—"}
                  </Text>
                  <Text style={styles.agentNodeName}>{meta.name}</Text>
                  <Text
                    style={[type.microDelight, styles.agentNodeTag]}
                    numberOfLines={2}
                  >
                    {AGENT_VOICE[key].tagline}
                  </Text>
                </View>
              );
            })}
          </View>
        </Animated.View>

        {/* Referral bounty callout (only when fired) — kept from Sprint-4
            so the real-cash flywheel still earns its moment. */}
        {recap.bounty.fired && (
          <Animated.View
            entering={FadeInUp.duration(540).delay(360)}
            style={styles.section}
          >
            <GlassSurface radius={22} agent="director">
              <View style={styles.bountyInner}>
                <View style={styles.bountyHead}>
                  <Feather name="gift" size={18} color={lumina.spark} />
                  <Text style={[type.subheadSm, styles.bountyTitle]}>
                    Referral Rocket fired
                  </Text>
                </View>
                <Text style={[type.body, styles.bountyBody]}>
                  Your overnight payout triggered a real-cash bounty — you
                  earned{" "}
                  <Text style={styles.bountyMoney}>
                    ${REFERRAL_BOUNTY_BREAKDOWN.refereeUsd}
                  </Text>{" "}
                  and your referrer earned{" "}
                  <Text style={styles.bountyMoney}>
                    ${REFERRAL_BOUNTY_BREAKDOWN.referrerUsd}
                  </Text>
                  .
                </Text>
                <Text style={[type.microDelight, styles.bountyCode]}>
                  your code:{" "}
                  <Text style={{ color: lumina.firefly }}>
                    {recap.referralCode}
                  </Text>
                </Text>
              </View>
            </GlassSurface>
          </Animated.View>
        )}

        {/* ── Act 4: Growth Constellation ────────────────────────────── */}
        <Animated.View
          entering={FadeInUp.duration(540).delay(420)}
          style={styles.section}
        >
          <Text style={[type.subheadSm, styles.sectionTitle]}>
            growth constellation
          </Text>
          <View style={styles.growthGrid}>
            <GrowthOrb
              label="new followers"
              value={`+${growth.followers}`}
              tone={lumina.firefly}
              icon="users"
            />
            <GrowthOrb
              label="overnight views"
              value={`${growth.viewsM}M`}
              tone={lumina.coreSoft}
              icon="eye"
            />
          </View>

          {/* Best performer — uses the first trend brief as the demo
              video stand-in (the recap doesn't carry video assets yet). */}
          <View style={styles.bestPerformer}>
            <GlassSurface radius={22} agent="ideator" breathing>
              <View style={styles.bestInner}>
                <View style={styles.bestThumbWrap}>
                  <Image
                    source={getImage(trendBriefs[0]?.imageKey)}
                    style={styles.bestThumb}
                    resizeMode="cover"
                  />
                  <View style={styles.bestBadge}>
                    <Feather name="zap" size={11} color="#0A0824" />
                    <Text style={styles.bestBadgeText}>went viral</Text>
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[type.microDelight, styles.bestEyebrow]}>
                    best performer
                  </Text>
                  <Text style={[type.bodyEmphasis, styles.bestTitle]}>
                    {trendBriefs[0]?.title ?? "Last night's hero"}
                  </Text>
                  <Text style={[type.microDelight, styles.bestNote]}>
                    your signature humor + cat cameo = magic
                  </Text>
                </View>
              </View>
            </GlassSurface>
          </View>

          {/* Viral confidence meter — liquid-light fill. */}
          <View style={styles.confidenceCard}>
            <GlassSurface radius={22} agent="director">
              <View style={styles.confInner}>
                <View style={styles.confHead}>
                  <Text style={[type.microDelight, styles.confEyebrow]}>
                    viral confidence
                  </Text>
                  <Text style={[type.subhead, styles.confValue]}>
                    {growth.viralConfidence}%
                  </Text>
                </View>
                <View style={styles.confTrack}>
                  <LinearGradient
                    colors={[lumina.firefly, lumina.spark, lumina.goldTo] as [
                      string,
                      string,
                      string,
                    ]}
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 1, y: 0.5 }}
                    style={[
                      styles.confFill,
                      { width: `${Math.min(100, growth.viralConfidence)}%` },
                    ]}
                  />
                </View>
                <Text style={[type.microDelight, styles.confExplain]}>
                  averaged across the three briefs your swarm queued for today
                </Text>
              </View>
            </GlassSurface>
          </View>
        </Animated.View>

        {/* Deposits — Sprint-4 ledger remains visible for the receipts feel. */}
        {recap.deposits.length > 0 && (
          <Animated.View
            entering={FadeInUp.duration(540).delay(520)}
            style={styles.section}
          >
            <Text style={[type.subheadSm, styles.sectionTitle]}>
              deposits overnight
            </Text>
            {recap.deposits.map((d) => (
              <DepositRow key={d.id} d={d} />
            ))}
          </Animated.View>
        )}

        {/* ── Act 5: Agent Love Letters ──────────────────────────────── */}
        <Animated.View
          entering={FadeInUp.duration(540).delay(600)}
          style={[styles.section, { paddingHorizontal: 0 }]}
        >
          <Text style={[type.subheadSm, styles.sectionTitle, styles.padX]}>
            your swarm wants you to know…
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.lettersRow}
            decelerationRate="fast"
            snapToInterval={266}
          >
            {AGENT_ORDER.map((key) => {
              const meta = agents[key];
              const voice = AGENT_VOICE[key];
              return (
                <View key={key} style={styles.letterCard}>
                  <GlassSurface radius={22} agent={key}>
                    <View style={styles.letterInner}>
                      <AgentAvatar agent={key} state="idle" size={56} />
                      <Text
                        style={[
                          type.label,
                          styles.letterName,
                          { color: meta.hex },
                        ]}
                      >
                        {meta.name}
                      </Text>
                      <Text style={[type.body, styles.letterBody]}>
                        {voice.loveLetter}
                      </Text>
                      <Text style={[type.microDelight, styles.letterSign]}>
                        {voice.signoff}
                      </Text>
                    </View>
                  </GlassSurface>
                </View>
              );
            })}
          </ScrollView>
        </Animated.View>

        {/* ── Act 6: Tomorrow's Promise ──────────────────────────────── */}
        <Animated.View
          entering={FadeInUp.duration(540).delay(700)}
          style={styles.section}
        >
          <Text style={[type.subheadSm, styles.sectionTitle]}>
            while you were dreaming, we already planned tomorrow
          </Text>
          {/* Manual swarm trigger — fires the four-agent pipeline so
              the demo can produce fresh briefs/videos/deals on
              demand without waiting for an actual overnight run. */}
          <View style={styles.swarmCtaWrap}>
            <SwarmCta label="Run the swarm now" />
          </View>
          {recap.tomorrowPlan.map((slot, i) => (
            <Pressable
              key={slot.id}
              onPress={() => {
                feedback.portal();
                router.push(`/studio/new?trendId=${slot.id}`);
              }}
              style={({ pressed }) => [
                styles.promiseCard,
                { opacity: pressed ? 0.85 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Ignite trend: ${slot.title}`}
            >
              <GlassSurface
                radius={22}
                agent={
                  slot.viralPotential >= 90
                    ? "director"
                    : slot.viralPotential >= 80
                      ? "ideator"
                      : "monetizer"
                }
                breathing={i === 0}
              >
                <View style={styles.promiseInner}>
                  <View style={styles.promiseLeft}>
                    <Text style={[type.microDelight, styles.promiseEyebrow]}>
                      ready-to-create · {slot.viralPotential}% viral potential
                    </Text>
                    <Text
                      style={[type.bodyEmphasis, styles.promiseTitle]}
                      numberOfLines={2}
                    >
                      {slot.title}
                    </Text>
                    <Text
                      style={[type.microDelight, styles.promiseHook]}
                      numberOfLines={2}
                    >
                      {slot.hook}
                    </Text>
                  </View>
                  <View style={styles.ignitePill}>
                    <Feather name="zap" size={14} color="#0A0824" />
                    <Text style={styles.igniteText}>ignite</Text>
                  </View>
                </View>
              </GlassSurface>
            </Pressable>
          ))}
        </Animated.View>

        <Pressable
          onPress={() => {
            feedback.portal();
            router.replace("/(tabs)");
          }}
          style={({ pressed }) => [
            styles.cta,
            { opacity: pressed ? 0.88 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Open today's queue"
        >
          <LinearGradient
            colors={[lumina.core, lumina.spark] as [string, string]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Feather name="play" size={18} color="#FFFFFF" />
          <Text style={styles.ctaText}>open today's queue</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function GrowthOrb({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone: string;
  icon: React.ComponentProps<typeof Feather>["name"];
}) {
  return (
    <View style={styles.growthOrb}>
      <GlassSurface radius={22}>
        <View style={styles.growthOrbInner}>
          <Feather name={icon} size={16} color={tone} />
          <Text style={[type.subhead, styles.growthValue, { color: tone }]}>
            {value}
          </Text>
          <Text style={[type.microDelight, styles.growthLabel]}>{label}</Text>
        </View>
      </GlassSurface>
    </View>
  );
}

function DepositRow({ d }: { d: RecapDeposit }) {
  const tone =
    d.source === "performance-fee-creator-take"
      ? lumina.firefly
      : d.source === "referral-bounty-referrer" ||
          d.source === "referral-bounty-referee"
        ? lumina.spark
        : lumina.goldTo;
  return (
    <View style={styles.depositRow}>
      <GlassSurface radius={16}>
        <View style={styles.depositInner}>
          <View
            style={[
              styles.depositDot,
              { backgroundColor: tone, boxShadow: `0 0 6px ${tone}` as never },
            ]}
          />
          <Text style={[type.body, styles.depositLabel]} numberOfLines={2}>
            {d.label}
          </Text>
          <Text style={[type.label, styles.depositAmount, { color: tone }]}>
            +{d.currency} {d.amount.toLocaleString()}
          </Text>
        </View>
      </GlassSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  swarmCtaWrap: { alignItems: "center", marginBottom: 18 },
  root: { flex: 1, backgroundColor: cosmicBg() },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    backgroundColor: "#0A0824",
  },
  loadingText: { color: "rgba(246,243,255,0.7)", fontSize: 14 },

  dawnGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    marginBottom: 18,
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  eyebrow: {
    color: "rgba(246,243,255,0.55)",
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },

  // ── Hero ──
  heroSection: {
    alignItems: "center",
    paddingHorizontal: 28,
    marginBottom: 34,
  },
  heroAvatar: {
    width: 78,
    height: 78,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.55)",
  },
  heroHeadline: {
    color: "rgba(246,243,255,0.78)",
    textAlign: "center",
    marginTop: 16,
  },
  heroHeadlineEmphasis: {
    color: "#FFFFFF",
    fontSize: 38,
    lineHeight: 42,
    letterSpacing: -0.6,
  },
  heroSub: {
    color: "rgba(246,243,255,0.7)",
    textAlign: "center",
    marginTop: 6,
    paddingHorizontal: 12,
  },
  voiceBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(0,255,204,0.08)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.25)",
    marginTop: 14,
    maxWidth: 340,
  },
  voiceWave: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    height: 18,
  },
  voiceBar: {
    width: 2,
    borderRadius: 2,
    opacity: 0.85,
  },
  voiceText: {
    color: "rgba(246,243,255,0.85)",
    fontSize: 12,
    flexShrink: 1,
  },

  // ── Money Moment ──
  moneySection: {
    alignItems: "center",
    paddingHorizontal: 22,
    marginBottom: 36,
  },
  moneyEyebrow: {
    color: lumina.goldTo,
    letterSpacing: 1.2,
    textTransform: "lowercase",
    marginBottom: 6,
  },
  moneyAmountWrap: { alignItems: "center" },
  moneyAmount: {
    color: "#FFFFFF",
    fontSize: 84,
    lineHeight: 88,
    letterSpacing: -2,
    textShadowColor: "rgba(255,215,0,0.6)",
    textShadowRadius: 28,
    fontVariant: ["tabular-nums"],
  },
  moneyUnderline: {
    height: 4,
    width: 220,
    borderRadius: 2,
    marginTop: 6,
  },
  moneySubline: {
    color: "rgba(246,243,255,0.75)",
    marginTop: 12,
    fontStyle: "italic",
  },
  agentConstellation: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    marginTop: 28,
    gap: 6,
  },
  agentNode: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 4,
  },
  agentNodeAmount: {
    fontSize: 14,
    marginTop: 6,
  },
  agentNodeName: {
    color: "rgba(246,243,255,0.65)",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 2,
  },
  agentNodeTag: {
    color: "rgba(246,243,255,0.6)",
    fontSize: 11,
    textAlign: "center",
    marginTop: 6,
    minHeight: 28,
  },

  // ── Sections (generic) ──
  section: { paddingHorizontal: 18, marginBottom: 26 },
  sectionTitle: {
    color: "rgba(246,243,255,0.78)",
    marginBottom: 12,
    paddingHorizontal: 4,
    textTransform: "lowercase",
  },
  padX: { paddingHorizontal: 18 },

  // ── Bounty ──
  bountyInner: { padding: 18, gap: 8 },
  bountyHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  bountyTitle: { color: "#FFFFFF" },
  bountyBody: { color: "rgba(246,243,255,0.78)" },
  bountyMoney: { color: lumina.goldTo, fontWeight: "700" as const },
  bountyCode: { color: "rgba(246,243,255,0.6)", marginTop: 4 },

  // ── Growth ──
  growthGrid: { flexDirection: "row", gap: 12, marginBottom: 12 },
  growthOrb: { flex: 1 },
  growthOrbInner: { padding: 16, alignItems: "flex-start", gap: 4 },
  growthValue: { fontSize: 28, lineHeight: 32 },
  growthLabel: {
    color: "rgba(246,243,255,0.6)",
    textTransform: "lowercase",
  },

  bestPerformer: { marginBottom: 12 },
  bestInner: { flexDirection: "row", padding: 14, gap: 14, alignItems: "center" },
  bestThumbWrap: { position: "relative" },
  bestThumb: {
    width: 92,
    height: 116,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.4)",
  },
  bestBadge: {
    position: "absolute",
    bottom: 6,
    left: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: lumina.firefly,
  },
  bestBadgeText: {
    color: "#0A0824",
    fontSize: 10,
    fontWeight: "800" as const,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  bestEyebrow: { color: "rgba(246,243,255,0.55)", marginBottom: 4 },
  bestTitle: { color: "#FFFFFF", marginBottom: 4 },
  bestNote: { color: lumina.fireflySoft, fontStyle: "italic" },

  confidenceCard: {},
  confInner: { padding: 16, gap: 10 },
  confHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  confEyebrow: { color: "rgba(246,243,255,0.6)" },
  confValue: { color: "#FFFFFF", fontSize: 26, lineHeight: 30 },
  confTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  confFill: { height: "100%", borderRadius: 999 },
  confExplain: { color: "rgba(246,243,255,0.6)" },

  // ── Deposits ──
  depositRow: { marginBottom: 8 },
  depositInner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  depositDot: { width: 8, height: 8, borderRadius: 4 },
  depositLabel: { flex: 1, color: "rgba(246,243,255,0.85)", fontSize: 14 },
  depositAmount: { fontSize: 14 },

  // ── Letters ──
  lettersRow: { paddingHorizontal: 18, gap: 14 },
  letterCard: { width: 252 },
  letterInner: { padding: 18, gap: 10, alignItems: "flex-start" },
  letterName: { fontSize: 14, marginTop: 4 },
  letterBody: { color: "rgba(246,243,255,0.85)", fontSize: 14, lineHeight: 20 },
  letterSign: { color: "rgba(246,243,255,0.55)" },

  // ── Promise ──
  promiseCard: { marginBottom: 10 },
  promiseInner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
  },
  promiseLeft: { flex: 1, gap: 4 },
  promiseEyebrow: {
    color: lumina.fireflySoft,
    fontSize: 11,
    textTransform: "lowercase",
  },
  promiseTitle: { color: "#FFFFFF", fontSize: 16, lineHeight: 20 },
  promiseHook: { color: "rgba(246,243,255,0.65)" },
  ignitePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: lumina.goldTo,
    boxShadow: `0 0 14px ${lumina.goldTo}` as never,
  },
  igniteText: {
    color: "#0A0824",
    fontWeight: "800" as const,
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },

  // ── CTA ──
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginHorizontal: 18,
    marginTop: 8,
    paddingVertical: 18,
    borderRadius: 22,
    overflow: "hidden",
  },
  ctaText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800" as const,
    textTransform: "lowercase",
    letterSpacing: 0.2,
  },
});

/** Tiny helper so the top-level View has a guaranteed solid base behind
 *  the cosmic backdrop while it mounts. */
function cosmicBg() {
  return "#0A0824";
}
