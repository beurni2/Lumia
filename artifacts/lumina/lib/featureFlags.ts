/**
 * Phase 1 MVP — frozen subsystems (mobile mirror).
 *
 * Same three flags as the server (`artifacts/api-server/src/lib/
 * featureFlags.ts`), defaulting to ARCHIVED. Every UI surface that
 * depends on an out-of-scope server route is wrapped in a check so
 * the v1 MVP loop — onboarding → ideas → create → review → export —
 * cannot accidentally surface a billing CTA, a swarm trigger, or a
 * publishing button.
 *
 * Flip via `EXPO_PUBLIC_ARCHIVED_*` env vars (the `EXPO_PUBLIC_`
 * prefix is required for the value to make it into the bundle). Set
 * to `"false"` (or `"0"`) to unfreeze; any other value, including
 * absence, leaves the subsystem archived.
 */

function flagOn(envValue: string | undefined): boolean {
  if (envValue == null) return true;
  return envValue !== "false" && envValue !== "0";
}

/**
 * PHASE UX3.3 — closed-beta surface gate.
 *
 * Default `false` (post-beta surfaces hidden). Flip to `true` via
 * `EXPO_PUBLIC_SHOW_POST_BETA_SURFACES=true` to reveal:
 *   - publisher (vertical-publisher modal)
 *   - style-twin-train (training onboarding)
 *   - while-you-slept (overnight recap)
 *   - earnings (tab)
 *
 * Per-vision §10: nav reduces to Home / Studio / Profile during the
 * closed beta. No route file is deleted — routes remain mountable
 * once the flag flips. CTAs and tab triggers are wrapped in this
 * check so the user cannot reach the surfaces unintentionally.
 *
 * NOTE: This is a separate axis from the `ARCHIVED_*` Phase-1 freeze
 * flags above (which govern subsystems that may never ship). A
 * surface can be gated by both — e.g. earnings is hidden when
 * `ARCHIVED_MONETIZATION` is set OR when `SHOW_POST_BETA_SURFACES`
 * is false (the default).
 */
function showFlagOn(envValue: string | undefined): boolean {
  // Inverse of `flagOn`: defaults to FALSE (hidden) and only flips
  // to true if the env var is explicitly set to "true" or "1".
  if (envValue == null) return false;
  return envValue === "true" || envValue === "1";
}

export const flags = {
  ARCHIVED_AUTONOMY: flagOn(process.env.EXPO_PUBLIC_ARCHIVED_AUTONOMY),
  ARCHIVED_MONETIZATION: flagOn(
    process.env.EXPO_PUBLIC_ARCHIVED_MONETIZATION,
  ),
  ARCHIVED_POSTING: flagOn(process.env.EXPO_PUBLIC_ARCHIVED_POSTING),
  SHOW_POST_BETA_SURFACES: showFlagOn(
    process.env.EXPO_PUBLIC_SHOW_POST_BETA_SURFACES,
  ),
} as const;
