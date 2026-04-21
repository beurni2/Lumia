import type { ConsentGrant, ConsentScope } from "./types";

const TTL_MS = 5 * 60 * 1000;

function nonce(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function grantConsent(scope: ConsentScope): ConsentGrant {
  const now = Date.now();
  return { scope, grantedAt: now, expiresAt: now + TTL_MS, nonce: nonce() };
}

export function assertConsent(
  grant: ConsentGrant | null | undefined,
  expected: ConsentScope,
): asserts grant is ConsentGrant {
  if (!grant) throw new Error(`Consent required for "${expected}"`);
  if (grant.scope !== expected) {
    throw new Error(`Consent scope mismatch: have "${grant.scope}", need "${expected}"`);
  }
  if (Date.now() > grant.expiresAt) {
    throw new Error(`Consent for "${expected}" has expired`);
  }
}
