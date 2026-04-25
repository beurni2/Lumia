/**
 * Profile — the Style Twin garden.
 *
 * Bioluminescent redesign:
 *   • Cosmic backdrop with ambient fireflies
 *   • Style Twin orb hero (the user's twin literally radiates from the page)
 *   • Glass identity card (name, niche, location)
 *   • Glass twin status card with the existing inner StyleTwinPreview
 *   • Portal-flavoured train CTA + ghost wipe button
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
import { StyleTwinPreview } from "@/components/StyleTwinPreview";
import { BillingAndPayoutsCards } from "@/components/profile/BillingAndPayoutsCards";
import { PrivacyAndScheduleCards } from "@/components/profile/PrivacyAndScheduleCards";
import { useStyleTwin } from "@/hooks/useStyleTwin";
import { type } from "@/constants/typography";
import { feedback } from "@/lib/feedback";
import { flags } from "@/lib/featureFlags";
import { getImage } from "@/lib/imageRegistry";
import { useGetCurrentCreator } from "@workspace/api-client-react";

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { twin, loading, isTrained, remove } = useStyleTwin();
  const { data: creator } = useGetCurrentCreator();

  const isWeb = Platform.OS === "web";
  const topInset = isWeb ? 24 : insets.top;
  const bottomInset = isWeb ? 108 : insets.bottom + 108;

  const goTrain = () => {
    feedback.portal();
    router.push("/style-twin-train");
  };

  const onWipe = () => {
    const confirm = async () => {
      await remove();
      feedback.success();
    };
    if (Platform.OS === "web") {
      if (
        typeof window !== "undefined" &&
        window.confirm("Wipe your Style Twin? This cannot be undone.")
      ) {
        void confirm();
      }
      return;
    }
    Alert.alert(
      "Wipe Style Twin?",
      "Your encrypted Twin will be deleted from this device. This cannot be undone.",
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
        {/* Twin orb hero */}
        <View style={styles.hero}>
          <StyleTwinOrb size={180} mood={isTrained ? "excited" : "idle"}>
            <Image source={getImage(creator?.imageKey)} style={styles.avatar} />
          </StyleTwinOrb>
          <Text style={[type.subhead, styles.name]}>{creator?.name ?? "—"}</Text>
          <Text style={[type.microDelight, styles.location]}>
            {creator ? `${creator.location} · ${creator.niche}` : ""}
          </Text>
        </View>

        {/* Twin status */}
        <View style={styles.section}>
          <Text style={[type.label, styles.sectionLabel]}>your style twin</Text>
          <GlassSurface radius={22} agent="monetizer" breathing>
            <View style={styles.cardInner}>
              <StyleTwinPreview twin={twin} inferenceMode="mock" />
            </View>
          </GlassSurface>

          <View style={{ alignItems: "center", marginTop: 18 }}>
            <PortalButton
              label={isTrained ? "retrain style twin" : "train style twin"}
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
              accessibilityLabel="Wipe Style Twin from this device"
            >
              <Text style={[type.label, styles.wipeText]}>
                wipe twin from this device
              </Text>
            </Pressable>
          )}
        </View>

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
  section: { paddingHorizontal: 22 },
  sectionLabel: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  cardInner: { padding: 16 },
  wipeBtn: { paddingVertical: 14, alignItems: "center", marginTop: 10 },
  wipeText: { color: "rgba(255,90,128,0.85)", fontSize: 13 },
});
