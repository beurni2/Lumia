/**
 * Payouts surface — Stripe Connect (Express).
 *
 * `POST /api/payouts/connect/onboard`
 *     Idempotently creates the creator's Express account if it
 *     doesn't exist yet, then issues a fresh AccountLink the mobile
 *     client opens in the browser to complete KYC. The link is
 *     single-use and short-lived; calling this endpoint repeatedly
 *     is safe and will simply mint a new link each time.
 *
 * `GET /api/payouts/connect/status`
 *     Returns `{ onboarded, payoutsEnabled, chargesEnabled,
 *     accountId }`. The first call after a successful onboarding
 *     will reflect the truth from our own webhook-mirrored boolean
 *     flags; the booleans get flipped by `account.updated` events
 *     hitting `/api/webhooks/stripe`.
 *
 * Country selection: Express accounts must be created with a
 * country at creation time and it can never be changed. We default
 * to US but accept an explicit `country` in the body so the mobile
 * app can pass a 2-letter ISO code from the creator's profile. The
 * country is persisted on the creator row so the UI can show "your
 * Connect account is registered in <country>".
 */

import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "../db/client";
import { resolveCreator } from "../lib/resolveCreator";
import { logger } from "../lib/logger";
import { getStripe, isStripeEnabled } from "../lib/stripe";

const router: IRouter = Router();

// Two-letter ISO country code, uppercase. Stripe Connect supports a
// curated list — we don't enforce it here so that a country-not-
// supported error bubbles up from Stripe with the actual reason.
const OnboardInput = z.object({
  country: z
    .string()
    .regex(/^[A-Z]{2}$/, "country must be a 2-letter ISO code")
    .optional(),
});

router.post("/payouts/connect/onboard", async (req, res, next) => {
  try {
    if (!isStripeEnabled()) {
      res.status(503).json({ error: "stripe_disabled" });
      return;
    }
    const refreshUrl = process.env["STRIPE_CONNECT_REFRESH_URL"];
    const returnUrl = process.env["STRIPE_CONNECT_RETURN_URL"];
    if (!refreshUrl || !returnUrl) {
      res.status(503).json({ error: "stripe_misconfigured" });
      return;
    }

    const parsed = OnboardInput.safeParse(req.body ?? {});
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
    // Demo creator is shared across anonymous sessions — refuse to
    // attach a real Connect account to it. Same rationale as the
    // checkout/portal gates in routes/billing.ts.
    if (creator.isDemo) {
      res.status(403).json({ error: "demo_account_cannot_onboard" });
      return;
    }
    const stripe = getStripe();

    let accountId = creator.connectAccountId;
    if (!accountId) {
      const country = parsed.data.country ?? creator.connectCountry ?? "US";
      const account = await stripe.accounts.create({
        type: "express",
        country,
        // Default capabilities for content-creator payouts. `transfers`
        // is what actually moves funds for Connect platforms; we omit
        // `card_payments` because Lumina is the merchant of record on
        // subscription billing, not the creator.
        capabilities: {
          transfers: { requested: true },
        },
        business_type: "individual",
        metadata: { creatorId: creator.id },
      });
      accountId = account.id;
      await db
        .update(schema.creators)
        .set({
          connectAccountId: accountId,
          connectCountry: country,
        })
        .where(eq(schema.creators.id, creator.id));
      logger.info(
        { creatorId: creator.id, accountId, country },
        "[payouts] created stripe connect express account",
      );
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    });

    res.json({ url: link.url, expiresAt: link.expires_at });
  } catch (err) {
    next(err);
  }
});

router.get("/payouts/connect/status", async (req, res, next) => {
  try {
    const r = await resolveCreator(req);
    if (r.kind !== "found") {
      res.status(401).json({ error: "unknown_user" });
      return;
    }
    const c = r.creator;
    res.json({
      stripeConfigured: isStripeEnabled(),
      accountId: c.connectAccountId ?? null,
      country: c.connectCountry ?? null,
      // `onboarded` is the operator-facing summary: payouts AND
      // charges enabled. The two raw flags are also surfaced so the
      // mobile app can show "almost done — finish identity check"
      // when one is true but not the other.
      onboarded: c.connectPayoutsEnabled && c.connectChargesEnabled,
      payoutsEnabled: c.connectPayoutsEnabled,
      chargesEnabled: c.connectChargesEnabled,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
