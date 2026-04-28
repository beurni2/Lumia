/**
 * Profile — the daily-habit creator surface.
 *
 * Bioluminescent layout (April 2026 rework):
 *   • Cosmic backdrop with ambient fireflies
 *   • Identity hero — orb + creator name + niche/location
 *   • "Your Style" card — what Lumina has learned (top format /
 *     tone / hooks / avoidances) read live from /api/style-profile +
 *     /api/taste-calibration
 *   • "Tune your ideas" chips — five tap-only nudges that mutate the
 *     calibration document on tap (More mini-stories / More
 *     reactions / Try new styles / More chaotic / More subtle)
 *   • (gated) Billing & Privacy archived cards
 *   • "Make ideas even more like you" footer — the optional video
 *     training entry point, deliberately at the bottom so it never
 *     reads as a barrier to using the app
 *   • Dev tools (calibration reset) — bottom-most, gated
 *
 * The previous "Style Twin" status block (with "No Style Twin yet"
 * copy + train CTA above the fold) was removed: the orb in the hero
 * already carries the visual identity and the training CTA was
 * pushed below to keep first-paint focused on what's working, not
 * what's missing.
 */

import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import {
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CosmicBackdrop } from "@/components/foundation/CosmicBackdrop";
import { FireflyParticles } from "@/components/foundation/FireflyParticles";
import { GlassSurface } from "@/components/foundation/GlassSurface";
import { PortalButton } from "@/components/foundation/PortalButton";
import { StyleTwinOrb } from "@/components/foundation/StyleTwinOrb";
import { BillingAndPayoutsCards } from "@/components/profile/BillingAndPayoutsCards";
import { PrivacyAndScheduleCards } from "@/components/profile/PrivacyAndScheduleCards";
import { TuneIdeasButtons } from "@/components/profile/TuneIdeasButtons";
import { YourStyleSection } from "@/components/profile/YourStyleSection";
import { useStyleTwin } from "@/hooks/useStyleTwin";
import { type } from "@/constants/typography";
import { feedback } from "@/lib/feedback";
import { flags } from "@/lib/featureFlags";
import { getImage } from "@/lib/imageRegistry";
import { isWebQaMode } from "@/lib/qaMode";
import { resetTasteCalibration } from "@/lib/tasteCalibration";
import { useGetCurrentCreator } from "@workspace/api-client-react";

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // useStyleTwin still drives the orb mood (excited when trained,
  // idle otherwise) AND the train/retrain CTA label at the bottom of
  // the screen. The "Wipe twin" affordance moves with it.
  const { loading, isTrained, remove } = useStyleTwin();
  const { data: creator } = useGetCurrentCreator();

  const isWeb = Platform.OS === "web";
  const topInset = isWeb ? 24 : insets.top;
  const bottomInset = isWeb ? 108 : insets.bottom + 108;

  const goTrain = () => {
    feedback.portal();
    router.push("/style-twin-train");
  };

  // Dev / QA reset for the Taste Calibration prompt — wipes the
  // server document back to NULL so the next Home mount re-triggers
  // the calibration interrupt. Only mounted in __DEV__ / web QA mode
  // (see `showCalibrationReset` below); a production build can never
  // see this affordance.
  const onResetCalibration = () => {
    const run = async () => {
      try {
        await resetTasteCalibration();
        const msg =
          "Calibration reset. Re-open Home to see the prompt.";
        if (Platform.OS === "web") {
          if (typeof window !== "undefined") window.alert(msg);
        } else {
          Alert.alert("Calibration reset", msg);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Reset failed";
        if (Platform.OS === "web") {
          if (typeof window !== "undefined") window.alert(msg);
        } else {
          Alert.alert("Reset failed", msg);
        }
      }
    };
    void run();
  };

  // Gate the dev affordance on either:
  //   • __DEV__ (any dev client / Expo dev server build), OR
  //   • web QA mode (the EXPO_PUBLIC_WEB_QA_MODE=true smoke-test path).
  // Production builds (release native bundle, prod web) see neither.
  const showCalibrationReset = __DEV__ || isWebQaMode();

  const onWipe = () => {
    const confirm = async () => {
      await remove();
      feedback.success();
    };
    if (Platform.OS === "web") {
      if (
        typeof window !== "undefined" &&
        window.confirm("Wipe your training videos? This cannot be undone.")
      ) {
        void confirm();
      }
      return;
    }
    Alert.alert(
      "Wipe training data?",
      "Your encrypted training data will be deleted from this device. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Wipe", style: "destructive", onPress: () => void confirm() },
      ],
    );
  };

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
        {/* Identity hero — orb + name + niche/location. The orb itself
            is iconic and stays; the explicit "Style Twin" copy that
            used to live in the card below has been removed. */}
        <View style={styles.hero}>
          <StyleTwinOrb size={180} mood={isTrained ? "excited" : "idle"}>
            <Image source={getImage(creator?.imageKey)} style={styles.avatar} />
          </StyleTwinOrb>
          <Text style={[type.subhead, styles.name]}>{creator?.name ?? "—"}</Text>
          <Text style={[type.microDelight, styles.location]}>
            {creator ? `${creator.location} · ${creator.niche}` : ""}
          </Text>
        </View>

        {/* Your Style — what Lumina has learned. Reads live from
            /api/style-profile + /api/taste-calibration. Honest empty
            state when neither has data yet. */}
        <YourStyleSection />

        {/* Tune your ideas — five chips that nudge the calibration
            doc on tap. Persists immediately (fire-and-forget POST). */}
        <TuneIdeasButtons />

        <View style={{ height: 36 }} />

        {/* Billing + Payouts (Lumina Pro / Stripe Connect). Frozen
            under the Phase 1 MVP scope — there is no monetization
            surface in v1. Returns when monetization comes back. */}
        {!flags.ARCHIVED_MONETIZATION && <BillingAndPayoutsCards />}

        {/* Privacy/consent + nightly swarm scheduler. The consent
            half existed to unblock autonomous publishing/swarm runs;
            with both archived in Phase 1 the surface is dormant.
            Will be split — the consent half returns separately if
            v1 ever adds publishing. */}
        {!flags.ARCHIVED_AUTONOMY && <PrivacyAndScheduleCards />}

        {/* "Make ideas even more like you" — the OPTIONAL video
            training entry point, intentionally placed at the bottom
            so it reads as a "you can sharpen this further" upsell
            rather than a barrier to first use. */}
        <View style={styles.section}>
          <Text style={[type.label, styles.sectionLabel]}>
            make ideas even more like you
          </Text>
          <GlassSurface radius={22} agent="monetizer" breathing>
            <View style={styles.cardInner}>
              <Text style={styles.trainBody}>
                Upload a few videos to sharpen your style (optional).
              </Text>
              <View style={{ alignItems: "center", marginTop: 18 }}>
                <PortalButton
                  label={isTrained ? "retrain with videos" : "train with videos"}
                  onPress={goTrain}
                  width={260}
                  subtle
                  disabled={loading}
                />
              </View>
              {isTrained && (
                <Pressable
                  onPress={onWipe}
                  style={({ pressed }) => [
                    styles.wipeBtn,
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                  testID="wipe-twin"
                  accessibilityRole="button"
                  accessibilityLabel="Wipe training data from this device"
                >
                  <Text style={[type.label, styles.wipeText]}>
                    wipe training data from this device
                  </Text>
                </Pressable>
              )}
            </View>
          </GlassSurface>
        </View>

        {/* Dev / QA-only — reset the Taste Calibration document so the
            Home-load gate re-triggers on the next mount. Hidden in
            production. The label is small and ghost-styled to match
            the existing wipe affordances and clearly signal "this is
            a tool, not a feature". */}
        {showCalibrationReset && (
          <View style={styles.devToolsBlock}>
            <Text style={[type.label, styles.devToolsLabel]}>
              dev tools
            </Text>
            <Pressable
              onPress={onResetCalibration}
              style={({ pressed }) => [
                styles.devToolsBtn,
                { opacity: pressed ? 0.7 : 1 },
              ]}
              testID="reset-taste-calibration"
              accessibilityRole="button"
              accessibilityLabel="Reset taste calibration"
            >
              <Text style={[type.body, styles.devToolsBtnText]}>
                reset taste calibration
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0A0824" },
  hero: {
    alignItems: "center",
    paddingTop: 12,
    paddingBottom: 32,
    paddingHorizontal: 22,
  },
  avatar: {
    width: 110,
    height: 110,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.25)",
  },
  name: { color: "#FFFFFF", marginTop: 18 },
  location: { color: "rgba(255,255,255,0.65)", marginTop: 4, fontSize: 13 },
  section: { paddingHorizontal: 22, marginTop: 18 },
  sectionLabel: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  cardInner: { padding: 18 },
  trainBody: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    paddingHorizontal: 6,
  },
  wipeBtn: { paddingVertical: 14, alignItems: "center", marginTop: 6 },
  wipeText: { color: "rgba(255,90,128,0.85)", fontSize: 13 },
  // Dev tools block — bottom of profile, ghost-styled so it never
  // competes with real surfaces but is always reachable for QA.
  devToolsBlock: {
    paddingHorizontal: 22,
    paddingTop: 36,
    alignItems: "center",
  },
  devToolsLabel: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 10,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  devToolsBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  devToolsBtnText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
  },
});
