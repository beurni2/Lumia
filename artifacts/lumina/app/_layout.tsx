import {
  Inter_400Regular,
  Inter_400Regular_Italic,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_700Bold,
} from "@expo-google-fonts/space-grotesk";
import { setBaseUrl } from "@workspace/api-client-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { Platform } from "react-native";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppStateProvider, useAppState } from "@/hooks/useAppState";

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

// Point the generated API client at the api-server artifact. In Replit dev
// and production, both artifacts are reachable through the same proxy domain
// (api-server lives under /api/*). EXPO_PUBLIC_DOMAIN is baked into the
// bundle by scripts/build.js.
//
// On web preview the bundle runs in a browser, so a relative `/api/...` URL
// works fine — leave the base URL unset. On native (iOS/Android), relative
// URLs cannot be resolved by fetch, so a missing domain is a hard error.
{
  const raw = process.env.EXPO_PUBLIC_DOMAIN;
  // Strip any accidental protocol prefix to avoid `https://https://...`.
  const host = raw?.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (host) {
    setBaseUrl(`https://${host}`);
  } else if (Platform.OS !== "web") {
    // eslint-disable-next-line no-console
    console.error(
      "[Lumina] EXPO_PUBLIC_DOMAIN is not set — API requests will fail on native. " +
        "Ensure scripts/build.js ran before bundling.",
    );
  }
}

function RootLayoutNav() {
  const { hasCompletedOnboarding, isLoading } = useAppState();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (isLoading) return;

    const inTabsGroup = segments[0] === "(tabs)";

    if (!hasCompletedOnboarding && inTabsGroup) {
      router.replace("/onboarding");
    } else if (hasCompletedOnboarding && segments[0] === "onboarding") {
      router.replace("/(tabs)");
    }
  }, [hasCompletedOnboarding, isLoading, segments, router]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="onboarding" options={{ presentation: "fullScreenModal" }} />
      <Stack.Screen name="studio/[id]" options={{ presentation: "modal" }} />
      <Stack.Screen name="publisher" options={{ presentation: "modal" }} />
      <Stack.Screen name="while-you-slept" options={{ presentation: "modal" }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_400Regular_Italic,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <AppStateProvider>
                <RootLayoutNav />
              </AppStateProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
