import { SCHEMA_VERSION, STORAGE_KEY, type StyleTwin } from "./types";

/**
 * Pluggable encrypted backend. The mobile app injects an implementation
 * backed by `expo-secure-store` (iOS Keychain / Android Keystore). Tests
 * inject an in-memory backend. The library never directly depends on Expo.
 */
export interface SecureBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

let backend: SecureBackend | null = null;

export function configureBackend(impl: SecureBackend): void {
  backend = impl;
}

function requireBackend(): SecureBackend {
  if (!backend) {
    throw new Error(
      "@workspace/style-twin: secure storage backend not configured. " +
        "Call configureBackend() at app startup.",
    );
  }
  return backend;
}

interface Envelope {
  schema: number;
  twin: StyleTwin;
}

export async function loadTwin(): Promise<StyleTwin | null> {
  const raw = await requireBackend().getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const env = JSON.parse(raw) as Envelope;
    if (env.schema !== SCHEMA_VERSION) return null;
    return env.twin;
  } catch {
    return null;
  }
}

export async function saveTwin(twin: StyleTwin): Promise<void> {
  const env: Envelope = { schema: SCHEMA_VERSION, twin };
  await requireBackend().setItem(STORAGE_KEY, JSON.stringify(env));
}

export async function wipe(): Promise<void> {
  await requireBackend().deleteItem(STORAGE_KEY);
}

/** In-memory backend for tests and SSR. */
export class MemoryBackend implements SecureBackend {
  private store = new Map<string, string>();
  async getItem(key: string) {
    return this.store.get(key) ?? null;
  }
  async setItem(key: string, value: string) {
    this.store.set(key, value);
  }
  async deleteItem(key: string) {
    this.store.delete(key);
  }
}
