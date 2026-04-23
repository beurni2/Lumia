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
import {
  setAuthTokenGetter,
  setBaseUrl,
} from "@workspace/api-client-react";
import { ClerkLoaded, ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments, type Href } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { Platform } from "react-native";
import React, { useEffect, useRef } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppStateProvider, useAppState } from "@/hooks/useAppState";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

// Point the generated API client at the api-server artifact. In Replit dev
// and production, both artifacts are reachable through the same proxy domain
// (api-server lives under /api/*). EXPO_PUBLIC_DOMAIN is baked into the
// bundle by scripts/build.js.
{
  const raw = process.env.EXPO_PUBLIC_DOMAIN;
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

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
const clerkProxyUrl = process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined;

if (!publishableKey) {
  // eslint-disable-next-line no-console
  console.error(
    "[Lumina] EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY missing — auth will not work. " +
      "Verify the dev script forwards CLERK_PUBLISHABLE_KEY.",
  );
}

/**
 * Routes the user based on their auth + onboarding state:
 *   signed-out                          → /(auth)/sign-in
 *   signed-in & not onboarded           → /onboarding
 *   signed-in & onboarded & on auth     → /(tabs)
 *   signed-in & onboarded & on onboard  → /(tabs)
 *
 * Also wires the Clerk session token into the generated API client so
 * every request carries a Bearer token the api-server can verify.
 */
// Module-scoped ref to the latest getToken. The token getter is registered
// SYNCHRONOUSLY at module load, so the very first API request — even if
// fired during initial render before any effect runs — finds the getter
// installed. Each render updates the ref so the getter always delegates
// to the freshest Clerk session.
const getTokenRef: { current: null | (() => Promise<string | null>) } = {
  current: null,
};
setAuthTokenGetter(async () => {
  if (!getTokenRef.current) return null;
  return getTokenRef.current();
});

function AuthAwareRouter() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { hasCompletedOnboarding, isLoading: stateLoading } = useAppState();
  const router = useRouter();
  const segments = useSegments();
  const liveGetToken = useRef(getToken);
  liveGetToken.current = getToken;
  // Wire the module-scoped delegate to the freshest hook value every render.
  getTokenRef.current = () => liveGetToken.current();

  useEffect(() => {
    if (!isLoaded || stateLoading) return;

    const firstSegment = segments[0] as string | undefined;
    const inAuthGroup = firstSegment === "(auth)";
    const onOnboarding = firstSegment === "onboarding";

    if (!isSignedIn) {
      if (!inAuthGroup) router.replace("/(auth)/sign-in" as Href);
      return;
    }

    if (!hasCompletedOnboarding) {
      if (!onOnboarding) router.replace("/onboarding");
      return;
    }

    if (inAuthGroup || onOnboarding) {
      router.replace("/(tabs)");
    }
  }, [
    isLoaded,
    isSignedIn,
    stateLoading,
    hasCompletedOnboarding,
    segments,
    router,
  ]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="onboarding"
        options={{ presentation: "fullScreenModal" }}
      />
      <Stack.Screen
        name="studio/[id]"
        options={{ presentation: "modal" }}
      />
      <Stack.Screen name="publisher" options={{ presentation: "modal" }} />
      <Stack.Screen
        name="while-you-slept"
        options={{ presentation: "modal" }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_400Regular_Italic,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <ErrorBoundary>
      <ClerkProvider
        publishableKey={publishableKey ?? ""}
        tokenCache={tokenCache}
        proxyUrl={clerkProxyUrl}
      >
        <ClerkLoaded>
          <SafeAreaProvider>
            <KeyboardProvider>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <QueryClientProvider client={queryClient}>
                  <AppStateProvider>
                    <AuthAwareRouter />
                  </AppStateProvider>
                </QueryClientProvider>
              </GestureHandlerRootView>
            </KeyboardProvider>
          </SafeAreaProvider>
        </ClerkLoaded>
      </ClerkProvider>
    </ErrorBoundary>
  );
}
