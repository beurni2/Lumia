import { type StyleTwin } from "./types";
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
export declare function configureBackend(impl: SecureBackend): void;
export declare function loadTwin(): Promise<StyleTwin | null>;
export declare function saveTwin(twin: StyleTwin): Promise<void>;
export declare function wipe(): Promise<void>;
/** In-memory backend for tests and SSR. */
export declare class MemoryBackend implements SecureBackend {
    private store;
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    deleteItem(key: string): Promise<void>;
}
