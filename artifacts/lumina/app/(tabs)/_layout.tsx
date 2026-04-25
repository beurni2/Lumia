import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import React from "react";

import { HiveTabRing } from "@/components/shell/HiveTabRing";
import { flags } from "@/lib/featureFlags";

// Earnings is gated on `ARCHIVED_MONETIZATION` — under the Phase 1
// MVP freeze it is hidden from the tab bar entirely. The screen
// file (`earnings.tsx`) still exists and is registered as a route
// by expo-router, but is unreachable from navigation.
function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "sparkles", selected: "sparkles" }} />
        <Label>Home</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="studio">
        <Icon sf={{ default: "play.rectangle", selected: "play.rectangle.fill" }} />
        <Label>Studio</Label>
      </NativeTabs.Trigger>
      {!flags.ARCHIVED_MONETIZATION && (
        <NativeTabs.Trigger name="earnings">
          <Icon
            sf={{
              default: "chart.line.uptrend.xyaxis",
              selected: "chart.line.uptrend.xyaxis",
            }}
          />
          <Label>Earnings</Label>
        </NativeTabs.Trigger>
      )}
      <NativeTabs.Trigger name="profile">
        <Icon sf={{ default: "person", selected: "person.fill" }} />
        <Label>Profile</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  // The hive ring renders its own background, border, and orbs — we
  // strip every default tabBar style so it can float freely.
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <HiveTabRing {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="studio" options={{ title: "Studio" }} />
      {!flags.ARCHIVED_MONETIZATION && (
        <Tabs.Screen name="earnings" options={{ title: "Earnings" }} />
      )}
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}

export default function TabLayout() {
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
