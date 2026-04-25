/**
 * Stripe client wrapper.
 *
 * The rest of the codebase MUST go through this module rather than
 * importing the SDK directly so that:
 *
 *   1. We can short-circuit every billing/payout code path with a
 *      clean `stripe_disabled` error envelope when the secret isn't
 *      configured. Nothing in the swarm pipeline depends on Stripe,
 *      so a missing secret should never crash the process — it
 *      should simply make the four endpoints (checkout / portal /
 *      connect-onboard / connect-status) return 503.
 *
 *   2. We pin a single `apiVersion` so a Stripe SDK upgrade can never
 *      silently change webhook payload shapes underneath us.
 *
 *   3. Tests can swap the singleton without touching every route.
 *
 * Env contract:
 *   STRIPE_SECRET_KEY         — required for ANY Stripe API call.
 *   STRIPE_PRICE_ID_PRO       — the price id for Lumina Pro ($12.99/mo
 *                               recurring). Required for checkout.
 *   STRIPE_BILLING_RETURN_URL — where Stripe Checkout / Portal sends
 *                               the user back to. Required for either
 *                               of those flows. A deep link works for
 *                               mobile (e.g. lumina://billing/return).
 *   STRIPE_CONNECT_REFRESH_URL — Connect onboarding-link refresh URL.
 *   STRIPE_CONNECT_RETURN_URL  — Connect onboarding-link return URL.
 *   STRIPE_WEBHOOK_SECRET     — verified separately in routes/webhooks.ts
 *                               (this module doesn't need it).
 */

import Stripe from "stripe";

let cached: Stripe | null = null;

/**
 * Returns true when STRIPE_SECRET_KEY is set. Use this in routes to
 * decide whether to 503-bail before doing any work.
 */
export function isStripeEnabled(): boolean {
  return Boolean(process.env["STRIPE_SECRET_KEY"]);
}

/**
 * Returns the singleton Stripe instance. Throws if the secret isn't
 * configured — callers MUST gate on `isStripeEnabled()` first.
 */
export function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) {
    throw new Error(
      "Stripe is not configured (STRIPE_SECRET_KEY missing). " +
        "Gate on isStripeEnabled() before calling getStripe().",
    );
  }
  cached = new Stripe(key, {
    // Pin to a known stable version. Bumping this requires re-reading
    // the migration guide and re-testing every webhook handler.
    apiVersion: "2025-02-24.acacia",
    appInfo: {
      name: "lumina-api-server",
      version: "1.0.0",
    },
    // 20 s — Stripe's own SDK default is 80 s but our request /
    // response cycle should never sit that long. A faster fail keeps
    // user-facing routes responsive when Stripe is degraded.
    timeout: 20_000,
    // Modest retry budget for transient 5xx / network errors. The job
    // queue handles its own retry on top of this for webhook
    // processing, so two layers is intentional.
    maxNetworkRetries: 2,
  });
  return cached;
}

/**
 * Reset the cached client. Test-only.
 */
export const __test = {
  reset(): void {
    cached = null;
  },
};
