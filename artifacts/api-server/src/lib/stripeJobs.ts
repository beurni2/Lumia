/**
 * Stripe webhook job handler.
 *
 * The /api/webhooks/stripe receiver verifies the signature, dedupes
 * via webhook_events, and enqueues a `stripe.webhook` job containing
 * the parsed event. THIS module is the consumer side: it pulls those
 * jobs off the queue and dispatches by event type into focused
 * handlers, each of which is responsible for keeping our own
 * `creators` row in sync with the truth held by Stripe.
 *
 * Design choices:
 *   - The dispatcher is intentionally narrow. Unknown event types are
 *     logged and skipped (returning success), NOT retried — Stripe
 *     fires hundreds of distinct event types and we should not retry
 *     forever just because we don't care about a `radar.early_fraud_*`.
 *   - Every per-event handler is defensive about not finding a
 *     creator: a webhook can race with checkout completion (the
 *     creator row may not yet have stripe_customer_id when the very
 *     first subscription.created arrives if the customer was created
 *     out-of-band). We log a warning and skip rather than fail-retry.
 *   - We DO NOT fetch from Stripe again to "re-verify" payloads. The
 *     receiver already validated the HMAC; any further fetch just
 *     adds latency and a failure mode.
 */

import { eq, sql } from "drizzle-orm";
import type Stripe from "stripe";

import { db, schema } from "../db/client";
import { logger } from "./logger";
import { registerJobHandler } from "./jobQueue";

export const STRIPE_WEBHOOK_JOB = "stripe.webhook";

/**
 * Shape the receiver enqueues. We accept anything Stripe might send
 * and discriminate by `eventType` inside the handler.
 */
type StripeWebhookPayload = {
  eventId: string;
  eventType: string;
  data: { object?: Record<string, unknown> } & Record<string, unknown>;
};

function isPayload(p: unknown): p is StripeWebhookPayload {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  return typeof o["eventType"] === "string" && typeof o["eventId"] === "string";
}

/**
 * Convert a Stripe-delivered seconds-epoch number into a Date, or
 * null when the field is absent / not a number.
 */
function toDate(epochSec: unknown): Date | null {
  if (typeof epochSec !== "number" || !Number.isFinite(epochSec)) return null;
  return new Date(epochSec * 1000);
}

// ---------------------------------------------------------------- //
// per-event handlers                                               //
// ---------------------------------------------------------------- //

/**
 * Subscription created/updated — sync status, plan, period end onto
 * the creator row identified by `customer`.
 */
async function handleSubscriptionUpsert(
  sub: Stripe.Subscription,
): Promise<void> {
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customerId) {
    logger.warn(
      { subId: sub.id },
      "[stripeJobs] subscription event with no customer id — skipping",
    );
    return;
  }

  // Pull the price id off the first item to identify the plan. We
  // don't currently support multi-item subscriptions on Lumina; if
  // that changes we'd map all items to a normalized plan list here.
  const firstItem = sub.items?.data?.[0];
  const planId = firstItem?.price?.id ?? null;
  const periodEnd = toDate(sub.current_period_end);

  const r = await db
    .update(schema.creators)
    .set({
      stripeSubscriptionId: sub.id,
      subscriptionStatus: sub.status,
      subscriptionPlan: planId,
      subscriptionCurrentPeriodEnd: periodEnd,
    })
    .where(eq(schema.creators.stripeCustomerId, customerId))
    .returning({ id: schema.creators.id });

  if (r.length === 0) {
    // The webhook can race with the API route that creates the
    // Stripe customer (POST /billing/checkout). If that route
    // hasn't yet committed the stripe_customer_id when the very
    // first subscription.created arrives, we have no creator to
    // attach the subscription to. THROW so the job queue retries
    // with exponential backoff — the customer-id write should be
    // visible by the second attempt 30 s later. If the link still
    // isn't there after maxAttempts, the job goes to status='failed'
    // and surfaces in /admin/errors for an operator to reconcile.
    throw new Error(
      `creator_link_pending: no creator yet bears stripe_customer_id ${customerId} ` +
        `(subscription ${sub.id}, status ${sub.status})`,
    );
  }
  logger.info(
    {
      creatorId: r[0]!.id,
      customerId,
      subId: sub.id,
      status: sub.status,
      planId,
    },
    "[stripeJobs] subscription synced onto creator",
  );
}

async function handleSubscriptionDeleted(
  sub: Stripe.Subscription,
): Promise<void> {
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customerId) return;
  await db
    .update(schema.creators)
    .set({
      subscriptionStatus: "canceled",
      // Keep stripeSubscriptionId so we can surface "your last
      // subscription ended on …" in the UI. The actual gating is on
      // status, not on the id being null.
    })
    .where(eq(schema.creators.stripeCustomerId, customerId));
  logger.info(
    { customerId, subId: sub.id },
    "[stripeJobs] subscription marked canceled",
  );
}

/**
 * Connect Express account state change — sync the capability flags
 * onto the creator. `details_submitted` flipping to true is what we
 * use as "fully onboarded"; the two booleans on our side mirror
 * Stripe's own capability checks.
 */
async function handleAccountUpdated(account: Stripe.Account): Promise<void> {
  const accountId = account.id;
  if (!accountId) return;
  await db
    .update(schema.creators)
    .set({
      connectChargesEnabled: Boolean(account.charges_enabled),
      connectPayoutsEnabled: Boolean(account.payouts_enabled),
    })
    .where(eq(schema.creators.connectAccountId, accountId));
  logger.info(
    {
      accountId,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
    },
    "[stripeJobs] connect account state synced",
  );
}

/**
 * Successful payout — append a row to ledger_entries so the
 * earnings/summary endpoint can prove it. We use raw SQL because the
 * ledger_entries table is hash-chained and we don't want to invent
 * new schema fields here; a real implementation would route through
 * `packages/monetizer`'s hash chainer. For now we record an
 * informational entry tagged 'stripe.payout' so it's distinguishable
 * from agent-booked projections.
 */
async function handlePayoutPaid(
  payout: Stripe.Payout,
  accountId: string | null,
): Promise<void> {
  if (!accountId) return;
  // Find the creator owning this connect account.
  const rows = await db
    .select({ id: schema.creators.id })
    .from(schema.creators)
    .where(eq(schema.creators.connectAccountId, accountId))
    .limit(1);
  if (rows.length === 0) {
    logger.warn(
      { accountId, payoutId: payout.id },
      "[stripeJobs] payout for unknown connect account",
    );
    return;
  }
  const creatorId = rows[0]!.id;

  // ledger_entries: { creator_id uuid, month_bucket varchar(7), amount
  // integer (cents), source varchar(64), created_at timestamptz }.
  // Stripe payout `amount` is already in the smallest currency unit
  // so we keep it as-is; month_bucket is YYYY-MM of the payout's
  // arrival_date so the per-month aggregate query stays accurate.
  const arrival = new Date(payout.arrival_date * 1000);
  const monthBucket =
    `${arrival.getUTCFullYear().toString().padStart(4, "0")}-` +
    `${(arrival.getUTCMonth() + 1).toString().padStart(2, "0")}`;
  // `source` length is varchar(64). Stripe payout ids are well under
  // that, but we slice defensively in case Stripe ever extends them.
  const source = `stripe.payout:${payout.id}`.slice(0, 64);

  await db
    .execute(
      sql`
        INSERT INTO ledger_entries (creator_id, month_bucket, amount, source)
        VALUES (
          ${creatorId},
          ${monthBucket},
          ${Math.round(payout.amount)},
          ${source}
        )
      `,
    )
    .catch((err: unknown) => {
      // Don't fail the job on a duplicate or schema drift — the
      // Stripe-side source of truth is unaffected, and we don't want
      // to block our queue retrying a long-resolved payout. Log it
      // for the admin/errors dashboard so an operator can reconcile.
      logger.error(
        { err, accountId, payoutId: payout.id, source },
        "[stripeJobs] ledger insert for payout failed (skipped)",
      );
    });
}

// ---------------------------------------------------------------- //
// dispatcher                                                       //
// ---------------------------------------------------------------- //

/**
 * Dispatches one webhook event to the right handler. Returns nothing
 * on success; throws to trigger the queue's retry/backoff.
 */
async function dispatch(payload: StripeWebhookPayload): Promise<void> {
  const obj = payload.data?.object as Record<string, unknown> | undefined;
  if (!obj) {
    logger.warn(
      { eventId: payload.eventId, type: payload.eventType },
      "[stripeJobs] event has no data.object — ignoring",
    );
    return;
  }

  switch (payload.eventType) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await handleSubscriptionUpsert(obj as unknown as Stripe.Subscription);
      return;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(obj as unknown as Stripe.Subscription);
      return;
    case "account.updated":
      await handleAccountUpdated(obj as unknown as Stripe.Account);
      return;
    case "payout.paid": {
      // Connect events ride on the top-level event with an `account`
      // field at the envelope level — the receiver passes through
      // both the data envelope and the event data, so we need to
      // look at both.
      const accountId =
        typeof (payload as unknown as { account?: string }).account === "string"
          ? (payload as unknown as { account: string }).account
          : null;
      await handlePayoutPaid(obj as unknown as Stripe.Payout, accountId);
      return;
    }
    default:
      // Stripe fires hundreds of distinct event types and we only
      // care about a few. Demote to debug so a busy production env
      // doesn't drown the log stream — `/admin/overview` already
      // surfaces job throughput separately.
      logger.debug(
        { eventId: payload.eventId, type: payload.eventType },
        "[stripeJobs] event type not handled — acknowledging without action",
      );
      return;
  }
}

/**
 * Idempotent registration. Called from index.ts BEFORE the worker
 * begins polling so the very first claim has somewhere to dispatch.
 */
export function registerStripeJobHandlers(): void {
  registerJobHandler(STRIPE_WEBHOOK_JOB, async (payload, { jobId }) => {
    if (!isPayload(payload)) {
      logger.error(
        { jobId },
        "[stripeJobs] payload shape rejected — failing fast (won't retry)",
      );
      // Throwing would retry; we want this to drain via max_attempts
      // since a malformed payload will never become well-formed. Just
      // return — the job is marked succeeded (a no-op handler).
      return;
    }
    await dispatch(payload);
  });
}
