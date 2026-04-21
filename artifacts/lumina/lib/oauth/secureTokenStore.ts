import * as SecureStore from "expo-secure-store";
import type { OAuthTokens, PlatformAuthId, TokenStore } from "@workspace/swarm-studio";

/**
 * `expo-secure-store`-backed `TokenStore` — Lumina's production token vault.
 *
 * Storage layout: one SecureStore entry per platform, keyed
 * `lumina.oauth.<platform>`. The value is a JSON-encoded `OAuthTokens`
 * bundle. SecureStore on iOS uses the Keychain (kSecAttrAccessibleAfterFirstUnlock);
 * on Android it uses EncryptedSharedPreferences. We DO NOT use
 * `requireAuthentication: true` — the OAuth refresh path runs in the
 * background and would fail biometric prompts.
 *
 * The store never logs token contents. Audit pings (saved/cleared/refreshed)
 * go through the Lumina telemetry layer, not console.log.
 */

const KEY_PREFIX = "lumina.oauth.";
const SCHEMA_VERSION = 1;

interface StoredEnvelope {
  readonly schema: number;
  readonly tokens: OAuthTokens;
}

function key(platform: PlatformAuthId): string {
  return `${KEY_PREFIX}${platform}`;
}

export class SecureTokenStore implements TokenStore {
  async get(platform: PlatformAuthId): Promise<OAuthTokens | null> {
    const raw = await SecureStore.getItemAsync(key(platform));
    if (!raw) return null;
    try {
      const env = JSON.parse(raw) as StoredEnvelope;
      if (env.schema !== SCHEMA_VERSION) {
        // Forward-compatibility: drop unknown-schema bundles instead of
        // returning corrupt data. The user re-auths on next post.
        await SecureStore.deleteItemAsync(key(platform));
        return null;
      }
      if (env.tokens.platform !== platform) return null;
      return env.tokens;
    } catch {
      // Corrupted entry — wipe so we re-auth cleanly.
      await SecureStore.deleteItemAsync(key(platform));
      return null;
    }
  }

  async set(platform: PlatformAuthId, tokens: OAuthTokens): Promise<void> {
    if (tokens.platform !== platform) {
      throw new Error(`SecureTokenStore.set: tokens.platform=${tokens.platform} != ${platform}`);
    }
    const env: StoredEnvelope = { schema: SCHEMA_VERSION, tokens };
    await SecureStore.setItemAsync(key(platform), JSON.stringify(env), {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
  }

  async clear(platform: PlatformAuthId): Promise<void> {
    await SecureStore.deleteItemAsync(key(platform));
  }
}
