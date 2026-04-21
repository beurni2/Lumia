import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import {
  configureBackend,
  configureVectorBackend,
  MemoryBackend,
  type SecureBackend,
} from "@workspace/style-twin";

class ExpoSecureBackend implements SecureBackend {
  async getItem(key: string) {
    return SecureStore.getItemAsync(key);
  }
  async setItem(key: string, value: string) {
    await SecureStore.setItemAsync(key, value);
  }
  async deleteItem(key: string) {
    await SecureStore.deleteItemAsync(key);
  }
}

let configured = false;

/**
 * Configures BOTH the StyleTwin envelope storage AND the encrypted vector
 * memory used by `nearest()` kNN. Both share the same SecureBackend so a
 * single device-key wipe clears the entire on-device footprint.
 */
export function ensureStyleTwinBackend() {
  if (configured) return;
  const backend: SecureBackend =
    Platform.OS === "web" ? new MemoryBackend() : new ExpoSecureBackend();
  configureBackend(backend);
  configureVectorBackend(backend);
  configured = true;
}
