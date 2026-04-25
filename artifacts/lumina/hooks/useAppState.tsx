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
      if (isWebQaMode()) {
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
