import Constants from "expo-constants";
import { Platform } from "react-native";
import {
  type InferenceAdapter,
  MockInferenceAdapter,
} from "@workspace/style-twin";

let cached: InferenceAdapter | null = null;

/**
 * Adapter selection policy.
 *
 *   Expo Go (any platform)        → MockInferenceAdapter
 *   Web                           → MockInferenceAdapter
 *   Custom dev / production build → ExecuTorchInferenceAdapter (Sprint 1.5)
 *
 * The mock adapter generates deterministic, plausible Style Twin fingerprints
 * so the upload + train + retrain loop runs end-to-end in Expo Go.
 */
export function getInferenceAdapter(): InferenceAdapter {
  if (cached) return cached;
  const inExpoGo = Constants.appOwnership === "expo";
  const isWeb = Platform.OS === "web";
  if (inExpoGo || isWeb) {
    cached = new MockInferenceAdapter();
    return cached;
  }
  // TODO(sprint-1.5): probe device RAM, then load quantized weights.
  cached = new MockInferenceAdapter();
  return cached;
}
