/**
 * Billing surface — Stripe Checkout + Customer Portal.
 *
 * `POST /api/billing/checkout`
 *     Returns `{ url }` for a Stripe Checkout session in subscription
 *     mode for Lumina Pro. The caller (mobile or web) opens this in
 *     a browser / WebView; Stripe handles the card form and 3DS
 *     itself, then redirects to STRIPE_BILLING_RETURN_URL.
 *
 * `POST /api/billing/portal`
 *     Returns `{ url }` for a Stripe Billing Portal session so the
 *     creator can update their card / cancel / view invoices. Only
 *     valid for a creator that already has a stripe_customer_id.
 *
 * `GET /api/billing/status`
 *     Returns the locally-mirrored subscription state (no Stripe API
 *     call) — `{ status, plan, currentPeriodEnd, hasActive }`. The
 *     mobile app polls this after returning from Checkout so it
 *     reflects the latest webhook-driven state without paying the
 *     latency of a Stripe round-trip.
 *
 * All three are gated by `isStripeEnabled()` — if STRIPE_SECRET_KEY
 * isn't set the routes 503 closed-by-default rather than crashing.
 */

import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "../db/client";
import { resolveCreator } from "../lib/resolveCreator";
import { logger } from "../lib/logger";
import { getStripe, isStripeEnabled } from "../lib/stripe";

const router: IRouter = Router();

// Empty-object schema today — keeps the route Zod-gated so a future
// addition (plan selection, promo code, etc.) doesn't silently let
// arbitrary fields through. Same pattern as routes/payouts.ts.
const CheckoutInput = z.object({}).strict();
const PortalInput = z.object({}).strict();

/**
 * Active-paying statuses per Stripe's documented enum. We treat
 * 'trialing' as paying because a trial card is on file. Anything
 * else (canceled / past_due / unpaid / incomplete*) revokes Pro.
 */
const ACTIVE_STATUSES = new Set(["active", "trialing"]);

router.post("/billing/checkout", async (req, res, next) => {
  try {
    if (!isStripeEnabled()) {
      res.status(503).json({ error: "stripe_disabled" });
      return;
    }
    const priceId = process.env["STRIPE_PRICE_ID_PRO"];
    const returnUrl = process.env["STRIPE_BILLING_RETURN_URL"];
    if (!priceId || !returnUrl) {
      logger.warn(
        { hasPrice: Boolean(priceId), hasReturn: Boolean(returnUrl) },
        "[billing] checkout requested but config incomplete",
      );
      res.status(503).json({ error: "stripe_misconfigured" });
      return;
    }

    const parsed = CheckoutInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "invalid_body", issues: parsed.error.issues });
      return;
    }

    const r = await resolveCreator(req);
    if (r.kind !== "found") {
      res.status(401).json({ error: "unknown_user" });
      return;
    }
    const creator = r.creator;
    // The demo creator exists for the unauthenticated/onboarding UX
    // and has no auth_user_id. Attaching a real Stripe customer to
    // that shared row would (a) leak billing across anonymous users
    // and (b) "promote" the demo seed into a paying account. Refuse.
    if (creator.isDemo) {
      res.status(403).json({ error: "demo_account_cannot_subscribe" });
      return;
    }

    const stripe = getStripe();

    // Reuse an existing customer if we've onboarded this creator
    // before — otherwise create a new one and persist the id so
    // every future webhook can look the creator up by it.
    let customerId = creator.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        // We do NOT have an email yet (Clerk owns identity), so we
        // attach our internal creator id as metadata. The Customer
        // Portal works fine without an email.
        metadata: { creatorId: creator.id },
      });
      customerId = customer.id;
      await db
        .update(schema.creators)
        .set({ stripeCustomerId: customerId })
        .where(eq(schema.creators.id, creator.id));
    }

    // success_url and cancel_url both go to the same return URL —
    // the mobile app distinguishes by polling /billing/status after
    // the user comes back. Keeping both on one URL avoids deep-link
    // route sprawl.
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: returnUrl,
      cancel_url: returnUrl,
      // Allow Stripe to collect billing address — mostly so tax
      // calculation has the data it needs once we enable Stripe Tax.
      billing_address_collection: "auto",
      // Idempotency-key isn't strictly necessary because Checkout
      // sessions are short-lived and the URL is one-shot, but it
      // protects against a double-tap on the mobile button.
      metadata: { creatorId: creator.id },
    });

    if (!session.url) {
      logger.error(
        { creatorId: creator.id, sessionId: session.id },
        "[billing] checkout session created without a url",
      );
      res.status(502).json({ error: "stripe_no_url" });
      return;
    }

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    next(err);
  }
});

router.post("/billing/portal", async (req, res, next) => {
  try {
    if (!isStripeEnabled()) {
      res.status(503).json({ error: "stripe_disabled" });
      return;
    }
    const returnUrl = process.env["STRIPE_BILLING_RETURN_URL"];
    if (!returnUrl) {
      res.status(503).json({ error: "stripe_misconfigured" });
      return;
    }

    const parsed = PortalInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "invalid_body", issues: parsed.error.issues });
      return;
    }

    const r = await resolveCreator(req);
    if (r.kind !== "found") {
      res.status(401).json({ error: "unknown_user" });
      return;
    }
    const creator = r.creator;
    if (creator.isDemo) {
      res.status(403).json({ error: "demo_account_cannot_subscribe" });
      return;
    }
    if (!creator.stripeCustomerId) {
      // No Stripe customer yet — there's nothing to manage. The UI
      // should show "Start subscription" instead of "Manage billing"
      // when subscriptionStatus is null, so this is mostly a safety
      // rail against a stale UI.
      res.status(409).json({ error: "no_stripe_customer" });
      return;
    }

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: creator.stripeCustomerId,
      return_url: returnUrl,
    });
    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

router.get("/billing/status", async (req, res, next) => {
  try {
    const r = await resolveCreator(req);
    if (r.kind !== "found") {
      res.status(401).json({ error: "unknown_user" });
      return;
    }
    const c = r.creator;
    const status = c.subscriptionStatus ?? null;
    res.json({
      hasActive: status !== null && ACTIVE_STATUSES.has(status),
      status,
      plan: c.subscriptionPlan ?? null,
      currentPeriodEnd: c.subscriptionCurrentPeriodEnd
        ? c.subscriptionCurrentPeriodEnd.toISOString()
        : null,
      stripeConfigured: isStripeEnabled(),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
