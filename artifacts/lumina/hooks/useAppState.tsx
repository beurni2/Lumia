import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

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
