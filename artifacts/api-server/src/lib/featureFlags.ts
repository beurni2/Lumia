/**
 * Phase 1 MVP — frozen subsystems.
 *
 * Each flag, when ON (the default), keeps the corresponding subsystem
 * physically present in the source tree but unreachable at runtime:
 *   • routes are not mounted on the express app
 *   • job-queue handlers are not registered with the worker
 *   • background workers / schedulers do not start
 *
 * The intent is a *reversible* freeze: the source still compiles, the
 * tests still run, and nothing has been deleted. Flip a flag to
 * `"false"` via the corresponding env var to wake the subsystem back
 * up (useful for one-off reconciliation runs or smoke tests against
 * the archived endpoints).
 *
 * The physical move into `/archive` is a deliberate follow-up step,
 * gated on confirmation that the v1 MVP loop still boots cleanly with
 * every flag in its archived position.
 */

function flagOn(name: string): boolean {
  const raw = process.env[name];
  if (raw == null) return true;
  return raw !== "false" && raw !== "0";
}

export const flags = {
  /** Four-agent swarm, runner, nightly scheduler, admin dashboards. */
  ARCHIVED_AUTONOMY: flagOn("ARCHIVED_AUTONOMY"),
  /** Stripe billing, Connect payouts, earnings projections. */
  ARCHIVED_MONETIZATION: flagOn("ARCHIVED_MONETIZATION"),
  /** OAuth posting clients, publications, platform metrics, webhooks. */
  ARCHIVED_POSTING: flagOn("ARCHIVED_POSTING"),
} as const;
