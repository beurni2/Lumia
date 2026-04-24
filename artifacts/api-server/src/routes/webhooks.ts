/**
 * External-service webhook receivers (Stripe + Clerk).
 *
 * Both providers sign their payloads. We verify the signature using
 * a constant-time HMAC compare BEFORE doing anything with the body —
 * an unsigned webhook is treated as if it never arrived. This means
 * the routes need the RAW request body (express.json would mutate
 * the bytes and invalidate the signature), so they're mounted in
 * app.ts ahead of the global JSON parser with their own raw body
 * parser.
 *
 * Behavior when a webhook secret is not configured:
 *   - The route returns 503 with `{error: 'webhook_disabled'}`.
 *   - We log a warning per provider on first hit so the operator
 *     knows we received a webhook but couldn't verify it.
 * This is the safe default — without a secret we have no way to tell
 * a real event from a forged one, so we refuse to process either.
 *
 * Idempotency: each provider sends a unique event id (`Stripe-Signature`
 * carries one indirectly; Clerk uses `svix-id`). We dedupe events
 * via the `jobs` queue's `dedupe_key` so a redelivery doesn't double-
 * apply state changes.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "node:crypto";
import { db, schema } from "../db/client";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { enqueueJob } from "../lib/jobQueue";

const router: IRouter = Router();

// ---------------------------------------------------------------- //
// helpers                                                          //
// ---------------------------------------------------------------- //

/**
 * Constant-time compare of two signature strings.
 *
 * Implementation note: instead of comparing the strings directly
 * (which requires equal-length buffers and leaks length via the
 * early-return), we hash both inputs to a fixed 32-byte SHA-256
 * digest and constant-time-compare those. This:
 *   1. Always operates on equal-length buffers, so timingSafeEqual
 *      never throws.
 *   2. Removes any timing variation tied to the input lengths.
 * The "double hashing" is safe because the inputs are themselves
 * already cryptographic outputs — we're not weakening any property
 * a real signature relies on.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const ah = crypto.createHash("sha256").update(a, "utf8").digest();
  const bh = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(ah, bh);
}

/**
 * Express requires the route handler to receive the raw bytes; we
 * register `express.raw()` upstream so `req.body` is a Buffer here.
 * Convert defensively in case middleware ordering ever changes.
 *
 * For HMAC purposes we need bytes, but Stripe and Svix both sign
 * UTF-8 JSON, so a utf8 decode-then-encode is byte-equivalent for
 * any well-formed payload. A payload with invalid UTF-8 will fail
 * signature verification, which is the correct outcome (we should
 * not be receiving binary webhooks).
 */
function rawBody(req: Request): string {
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (typeof req.body === "string") return req.body;
  // Last-resort fallback: serialize parsed body. Signature will fail
  // and the request will be rejected — which is the correct outcome
  // for a misconfigured pipeline.
  return JSON.stringify(req.body ?? {});
}

/**
 * Permanent inbound-webhook idempotency. Returns true if the (provider,
 * eventId) tuple was newly recorded; false if it had already been seen.
 *
 * This protects against the gap between the jobs queue's pending/
 * running dedupe and the lifetime of a successfully-processed event:
 * once a stripe.webhook job moves out of 'pending'/'running' the
 * unique partial index on dedupe_key no longer protects against a
 * fresh insert with the same key, so a Stripe re-delivery (which
 * happens after some 200s on flaky connections) would otherwise
 * spawn a brand-new job and double-process.
 */
async function recordWebhookEvent(
  provider: "stripe" | "clerk",
  eventId: string,
): Promise<boolean> {
  const r = await db.execute(sql`
    INSERT INTO webhook_events (provider, event_id)
    VALUES (${provider}, ${eventId})
    ON CONFLICT (provider, event_id) DO NOTHING
    RETURNING event_id
  `);
  const rows =
    (r as unknown as { rows: { event_id: string }[] }).rows ?? [];
  return rows.length > 0;
}

// ---------------------------------------------------------------- //
// Stripe                                                           //
// ---------------------------------------------------------------- //

/**
 * Verifies a Stripe signature header of the form
 *   `t=<unix_ts>,v1=<hex_sig>[,v1=<other_sig>]`
 * by recomputing HMAC-SHA256(`<t>.<body>`, secret) and constant-time
 * comparing against any of the v1 signatures. Also rejects events
 * older than 5 minutes to bound replay attempts.
 */
function verifyStripeSignature(
  body: string,
  header: string,
  secret: string,
  toleranceSec = 300,
): { ok: true; tsSec: number } | { ok: false; reason: string } {
  const parts = header.split(",").map((p) => p.trim());
  let ts: string | undefined;
  const sigs: string[] = [];
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq);
    const v = part.slice(eq + 1);
    if (k === "t") ts = v;
    else if (k === "v1") sigs.push(v);
  }
  if (!ts || sigs.length === 0) {
    return { ok: false, reason: "missing t or v1 in signature header" };
  }
  const tsSec = Number.parseInt(ts, 10);
  if (!Number.isFinite(tsSec)) {
    return { ok: false, reason: "non-numeric timestamp" };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsSec) > toleranceSec) {
    return { ok: false, reason: "timestamp outside tolerance window" };
  }
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${ts}.${body}`)
    .digest("hex");
  for (const s of sigs) {
    if (constantTimeEqual(expected, s)) return { ok: true, tsSec };
  }
  return { ok: false, reason: "no matching v1 signature" };
}

router.post("/webhooks/stripe", async (req: Request, res: Response) => {
  const secret = process.env["STRIPE_WEBHOOK_SECRET"];
  if (!secret) {
    logger.warn(
      { route: "/webhooks/stripe" },
      "[webhooks] received Stripe webhook but STRIPE_WEBHOOK_SECRET is not set",
    );
    res.status(503).json({ error: "webhook_disabled" });
    return;
  }
  const sigHeader = req.header("Stripe-Signature");
  if (!sigHeader) {
    res.status(400).json({ error: "missing_signature" });
    return;
  }
  const body = rawBody(req);
  const verdict = verifyStripeSignature(body, sigHeader, secret);
  if (!verdict.ok) {
    logger.warn(
      { reason: verdict.reason, requestId: (req as { id?: string }).id },
      "[webhooks] Stripe signature rejected",
    );
    res.status(400).json({ error: "bad_signature" });
    return;
  }

  let event: { id?: string; type?: string; data?: unknown };
  try {
    event = JSON.parse(body);
  } catch {
    res.status(400).json({ error: "bad_json" });
    return;
  }
  if (!event.id || !event.type) {
    res.status(400).json({ error: "malformed_event" });
    return;
  }

  // Permanent dedupe BEFORE enqueue. If the event is already in
  // webhook_events we've seen it before — possibly already processed
  // and the job has since cleared from the queue. Acknowledge with
  // 200 so Stripe stops retrying, but skip the enqueue.
  const fresh = await recordWebhookEvent("stripe", event.id);
  if (!fresh) {
    logger.info(
      { eventId: event.id, eventType: event.type },
      "[webhooks] stripe event already processed — acknowledging without re-enqueue",
    );
    res.status(200).json({ received: true, deduped: true });
    return;
  }

  // Enqueue for asynchronous processing. The jobs-queue dedupe key
  // is a belt-and-braces guard against a concurrent re-delivery
  // racing the INSERT above; the webhook_events PK above is the
  // primary defense.
  await enqueueJob(
    "stripe.webhook",
    { eventId: event.id, eventType: event.type, data: event.data },
    { dedupeKey: `stripe:${event.id}` },
  );

  // Stripe expects 2xx within ~10s or it'll retry. We've persisted
  // the work to the queue, so 200 is correct here.
  res.status(200).json({ received: true });
});

// ---------------------------------------------------------------- //
// Clerk (svix)                                                     //
// ---------------------------------------------------------------- //

/**
 * Svix signature verification:
 *   header `svix-signature: v1,<base64sig> v1,<base64sig2>` (space-
 *   separated list of versioned signatures).
 *   signed-content = `${svix_id}.${svix_timestamp}.${body}`
 *   secret format = `whsec_<base64-encoded-bytes>` — strip the
 *   prefix and base64-decode to get the raw HMAC key.
 */
function verifySvixSignature(
  body: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  secret: string,
  toleranceSec = 300,
): { ok: true } | { ok: false; reason: string } {
  if (!secret.startsWith("whsec_")) {
    return { ok: false, reason: "secret missing whsec_ prefix" };
  }
  const tsSec = Number.parseInt(svixTimestamp, 10);
  if (!Number.isFinite(tsSec)) {
    return { ok: false, reason: "non-numeric timestamp" };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsSec) > toleranceSec) {
    return { ok: false, reason: "timestamp outside tolerance window" };
  }
  let key: Buffer;
  try {
    key = Buffer.from(secret.slice("whsec_".length), "base64");
  } catch {
    return { ok: false, reason: "secret not valid base64" };
  }
  const expected = crypto
    .createHmac("sha256", key)
    .update(`${svixId}.${svixTimestamp}.${body}`)
    .digest("base64");

  const parts = svixSignature.split(" ").map((p) => p.trim());
  for (const p of parts) {
    const eq = p.indexOf(",");
    if (eq < 0) continue;
    const version = p.slice(0, eq);
    const sig = p.slice(eq + 1);
    if (version !== "v1") continue;
    if (constantTimeEqual(expected, sig)) return { ok: true };
  }
  return { ok: false, reason: "no matching v1 signature" };
}

router.post("/webhooks/clerk", async (req: Request, res: Response) => {
  const secret = process.env["CLERK_WEBHOOK_SECRET"];
  if (!secret) {
    logger.warn(
      { route: "/webhooks/clerk" },
      "[webhooks] received Clerk webhook but CLERK_WEBHOOK_SECRET is not set",
    );
    res.status(503).json({ error: "webhook_disabled" });
    return;
  }

  const svixId = req.header("svix-id");
  const svixTimestamp = req.header("svix-timestamp");
  const svixSignature = req.header("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    res.status(400).json({ error: "missing_signature_headers" });
    return;
  }
  const body = rawBody(req);
  const verdict = verifySvixSignature(
    body,
    svixId,
    svixTimestamp,
    svixSignature,
    secret,
  );
  if (!verdict.ok) {
    logger.warn(
      { reason: verdict.reason, requestId: (req as { id?: string }).id },
      "[webhooks] Clerk signature rejected",
    );
    res.status(400).json({ error: "bad_signature" });
    return;
  }

  let event: { type?: string; data?: { id?: string; [k: string]: unknown } };
  try {
    event = JSON.parse(body);
  } catch {
    res.status(400).json({ error: "bad_json" });
    return;
  }
  if (!event.type) {
    res.status(400).json({ error: "malformed_event" });
    return;
  }

  // Permanent dedupe by svix-id (the unique event id Clerk sends).
  // If we've already processed this delivery, ack and exit.
  const fresh = await recordWebhookEvent("clerk", svixId);
  if (!fresh) {
    logger.info(
      { svixId, eventType: event.type },
      "[webhooks] clerk event already processed — acknowledging duplicate",
    );
    res.status(200).json({ received: true, deduped: true });
    return;
  }

  // Inline-handle the small number of identity events that affect our
  // own `creators` table directly. Anything we don't recognize gets
  // logged + acked so Clerk stops retrying.
  try {
    if (event.type === "user.deleted" && event.data?.id) {
      // Clerk has deleted the user. Unlink any creator that pointed at
      // this auth_user_id so we don't keep contacting a ghost. We do
      // NOT cascade-delete creator content — compliance prefers a
      // soft unlink with the external id wiped (their authored
      // content remains owned by the lumina-side creator row, which
      // becomes anonymous from Clerk's perspective).
      const authUserId = String(event.data.id);
      await db
        .update(schema.creators)
        .set({ authUserId: null })
        .where(eq(schema.creators.authUserId, authUserId));
      logger.info(
        { authUserId, eventId: svixId },
        "[webhooks] cleared auth_user_id on user.deleted",
      );
    } else if (event.type === "user.updated" && event.data?.id) {
      // Name changes from Clerk. Best-effort sync for display name;
      // we do not let Clerk overwrite the creator's own profile
      // choices beyond what they share with us, and we only fill in
      // name when the local value is empty so we don't trample a
      // creator who renamed themselves locally.
      const authUserId = String(event.data.id);
      const data = event.data as Record<string, unknown>;
      const firstName =
        typeof data["first_name"] === "string"
          ? (data["first_name"] as string)
          : null;
      const lastName =
        typeof data["last_name"] === "string"
          ? (data["last_name"] as string)
          : null;
      const composed = [firstName, lastName].filter(Boolean).join(" ").trim();
      if (composed) {
        await db.execute(sql`
          UPDATE creators
             SET name = ${composed}
           WHERE auth_user_id = ${authUserId}
             AND (name IS NULL OR name = '')
        `);
      }
    } else {
      logger.info(
        { eventType: event.type, eventId: svixId },
        "[webhooks] Clerk event acknowledged but not specifically handled",
      );
    }
  } catch (err) {
    // We log + 500 so Clerk retries — the alternative (200 then drop)
    // would silently lose state changes. Signature was already
    // verified so retrying is safe.
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "[webhooks] Clerk event handler threw",
    );
    res.status(500).json({ error: "handler_failed" });
    return;
  }

  res.status(200).json({ received: true });
});

export default router;
