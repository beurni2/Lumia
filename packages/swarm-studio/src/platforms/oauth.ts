/**
 * Tiny PKCE + state utilities. Pure, dependency-free, isomorphic.
 * Relies on Web Crypto, which is global in:
 *   - Node ≥ 19 (`globalThis.crypto`)
 *   - All modern browsers
 *   - React Native via `expo-crypto` polyfill (registered by Lumina at boot)
 */

function getCrypto(): Crypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle || !c.getRandomValues) {
    throw new Error("Web Crypto API not available — install expo-crypto on React Native or upgrade to Node ≥ 19.");
  }
  return c;
}

/** Base64url encode without padding — matches RFC 7636 §4.2. */
function base64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  const b64Encode =
    (globalThis as { btoa?: (s: string) => string }).btoa ??
    ((s: string) => {
      // Final fallback for Node-only contexts that don't expose btoa: hand-rolled
      // base64 over latin-1, RFC 4648 §4. Avoids the `Buffer` dep so the file
      // typechecks without @types/node.
      const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      let out = "";
      let i = 0;
      while (i < s.length) {
        const a = s.charCodeAt(i++) & 0xff;
        const b = i < s.length ? s.charCodeAt(i++) & 0xff : -1;
        const c = i < s.length ? s.charCodeAt(i++) & 0xff : -1;
        out += ALPHA[a >> 2]!;
        out += ALPHA[((a & 0x03) << 4) | (b === -1 ? 0 : b >> 4)]!;
        out += b === -1 ? "=" : ALPHA[((b & 0x0f) << 2) | (c === -1 ? 0 : c >> 6)]!;
        out += c === -1 ? "=" : ALPHA[c & 0x3f]!;
      }
      return out;
    });
  const b64 = b64Encode(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function randomString(byteLength = 32): string {
  const buf = new Uint8Array(byteLength);
  getCrypto().getRandomValues(buf);
  return base64Url(buf);
}

/** Returns `{ codeVerifier, codeChallenge }` per RFC 7636. */
export async function pkcePair(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const codeVerifier = randomString(32);
  const digest = await getCrypto().subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  return { codeVerifier, codeChallenge: base64Url(new Uint8Array(digest)) };
}

/** RFC 6749 §4.1.3 — application/x-www-form-urlencoded token request body. */
export function encodeForm(params: Record<string, string | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  return parts.join("&");
}

/**
 * Generic token endpoint POST. Each provider wraps this with platform-shaped
 * params and response decoding so the wire calls look identical across the
 * three integrations.
 */
export async function postForm(
  url: string,
  body: Record<string, string | undefined>,
  init: { fetch?: typeof fetch; headers?: Record<string, string> } = {},
): Promise<unknown> {
  const f = init.fetch ?? globalThis.fetch;
  if (!f) throw new Error("postForm: fetch is not available in this runtime");
  const res = await f(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
    body: encodeForm(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    /* fall through; some providers return text/plain on error */
  }
  if (!res.ok) {
    const reason =
      (parsed && typeof parsed === "object" && "error_description" in parsed && (parsed as { error_description: string }).error_description) ||
      (parsed && typeof parsed === "object" && "error" in parsed && String((parsed as { error: unknown }).error)) ||
      text ||
      `HTTP ${res.status}`;
    throw new Error(`token endpoint ${url} → ${reason}`);
  }
  return parsed;
}
