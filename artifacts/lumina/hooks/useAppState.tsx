import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { isWebQaMode } from "@/lib/qaMode";

interface AppState {
  hasCompletedOnboarding: boolean;
  setHasCompletedOnboarding: (val: boolean) => Promise<void>;
  isLoading: boolean;
}

const AppStateContext = createContext<AppState>({
  hasCompletedOnboarding: false,
  setHasCompletedOnboarding: async () => {},
  isLoading: true,
});

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [hasCompletedOnboarding, setHasCompletedOnboardingState] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadState() {
      // QA mode (web only): never trust persisted onboarding
      // state. Mobile-Safari localStorage holds onto
      // "hasCompletedOnboarding=true" across QA sessions, which
      // makes the QaAwareRouter route straight to /(tabs) and
      // skip the region picker entirely. By starting fresh on
      // every page load in QA mode, each browser refresh is a
      // true "first run" view. Within-session writes still call
      // AsyncStorage.setItem so navigation logic is correct
      // mid-flow; the next reload resets us to false again.
      // See replit.md "QA-mode fresh-onboarding rule".
      //
      // E2E escape hatch — mirrors the existing
      // `globalThis.__qaDenyCamera` hook used by the create-flow
      // tests (see create.tsx). When the harness sets
      // `globalThis.__qaSkipOnboarding = true` BEFORE the page
      // loads (or via an init script), we boot straight into the
      // onboarded state so deep-link tests for /review and other
      // post-onboarding screens don't have to walk the full
      // region-picker → ideas-generation → calibration sequence
      // (which is brittle and depends on a healthy LLM response).
      // Effect is in-memory only — nothing persisted. Native
      // builds skip this branch entirely because isWebQaMode()
      // is web-only.
      if (isWebQaMode()) {
        const skip =
          typeof globalThis !== "undefined" &&
          (globalThis as { __qaSkipOnboarding?: boolean })
            .__qaSkipOnboarding === true;
        if (skip) setHasCompletedOnboardingState(true);
        setIsLoading(false);
        return;
      }
      try {
        const val = await AsyncStorage.getItem("hasCompletedOnboarding");
        if (val === "true") {
          setHasCompletedOnboardingState(true);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    }
    loadState();
  }, []);

  const setHasCompletedOnboarding = async (val: boolean) => {
    try {
      await AsyncStorage.setItem("hasCompletedOnboarding", String(val));
      setHasCompletedOnboardingState(val);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <AppStateContext.Provider
      value={{ hasCompletedOnboarding, setHasCompletedOnboarding, isLoading }}
    >
      {children}
    </AppStateContext.Provider>
  );
}

export const useAppState = () => useContext(AppStateContext);
