import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import {
  configureBackend,
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

export function ensureStyleTwinBackend() {
  if (configured) return;
  if (Platform.OS === "web") {
    configureBackend(new MemoryBackend());
  } else {
    configureBackend(new ExpoSecureBackend());
  }
  configured = true;
}
