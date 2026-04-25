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

export const flags = {
  ARCHIVED_AUTONOMY: flagOn(process.env.EXPO_PUBLIC_ARCHIVED_AUTONOMY),
  ARCHIVED_MONETIZATION: flagOn(
    process.env.EXPO_PUBLIC_ARCHIVED_MONETIZATION,
  ),
  ARCHIVED_POSTING: flagOn(process.env.EXPO_PUBLIC_ARCHIVED_POSTING),
} as const;
