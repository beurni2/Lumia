/**
 * In-process per-IP rate limit (sliding-window token bucket).
 *
 * Why in-process: the API server currently runs as a single process.
 * If we ever fan out behind a load balancer with N replicas the
 * effective limit becomes N×limit, which is acceptable for a coarse
 * abuse guard. A real distributed limiter (Redis INCR, sliding-log)
 * is a follow-up task once we actually horizontal-scale.
 *
 * Mechanics:
 *   - Buckets are keyed by (`prefix`, `client ip`).
 *   - Each bucket holds the timestamps of recent hits inside the
 *     window (default 60s). On every hit, expired timestamps are
 *     dropped, the new one is appended, and we refuse if the bucket
 *     has more than `max` entries.
 *   - A small janitor sweeps idle buckets every 5 minutes so memory
 *     usage stays bounded even with many distinct ips.
 *
 * Client ip resolution honors `X-Forwarded-For` only when the express
 * `trust proxy` setting is enabled — otherwise we use the socket
 * address. Lumina doesn't enable trust proxy yet, so this always uses
 * the socket address (correct for direct connections and dev).
 */

import type { Request, Response, NextFunction } from "express";

type Bucket = {
  hits: number[];
  expiresAt: number;
};

// Hard ceiling on the bucket map. Prevents a unique-IP DoS (or just
// a long uptime with many honest clients) from filling memory before
// the 5-minute janitor sweep. When we're over the cap we evict the
// oldest-expiring bucket on every insert — `Map` iteration order is
// insertion order, and we re-insert on every hit (delete+set), so
// the first key in the map is always the least-recently-touched.
const MAX_BUCKETS = 50_000;

const buckets = new Map<string, Bucket>();
let janitor: ReturnType<typeof setInterval> | null = null;

function startJanitor() {
  if (janitor) return;
  janitor = setInterval(
    () => {
      const now = Date.now();
      for (const [k, b] of buckets) {
        if (b.expiresAt < now) buckets.delete(k);
      }
    },
    5 * 60 * 1000,
  );
  // Don't keep the process alive just for the janitor.
  janitor.unref?.();
}

function evictIfFull() {
  while (buckets.size >= MAX_BUCKETS) {
    const oldest = buckets.keys().next().value;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }
}

function clientIp(req: Request): string {
  // express's req.ip already honors trust-proxy if configured. Fall
  // back to the raw socket address for safety.
  return (
    req.ip ??
    (req.socket as { remoteAddress?: string }).remoteAddress ??
    "unknown"
  );
}

export type RateLimitOpts = {
  /** Window length in ms. Default 60_000 (1 minute). */
  windowMs?: number;
  /** Max hits per window. Required. */
  max: number;
  /** Bucket-key prefix so different middleware instances don't share buckets. */
  prefix?: string;
  /**
   * Optional predicate that, when it returns true for a request, lets
   * the request bypass this limiter entirely without incrementing the
   * bucket. Used to keep specific paths (e.g. webhook receivers) on
   * their own dedicated limiter instead of competing for the global
   * /api bucket — a flood of bogus webhooks must not push real API
   * traffic from the same IP into 429s.
   */
  skip?: (req: Request) => boolean;
};

/**
 * Returns express middleware that rejects requests over the configured
 * cap with a 429 + `Retry-After` header. The body includes the limit
 * and current count so clients can self-throttle.
 */
export function rateLimit(opts: RateLimitOpts) {
  const windowMs = opts.windowMs ?? 60_000;
  const { max } = opts;
  const prefix = opts.prefix ?? "rl";
  startJanitor();

  const skip = opts.skip;
  return (req: Request, res: Response, next: NextFunction): void => {
    if (skip && skip(req)) {
      next();
      return;
    }
    const now = Date.now();
    const key = `${prefix}:${clientIp(req)}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      evictIfFull();
      bucket = { hits: [], expiresAt: now + windowMs };
      buckets.set(key, bucket);
    } else {
      // Re-insert so this key moves to the end of insertion order —
      // makes the LRU eviction in evictIfFull() correct.
      buckets.delete(key);
      buckets.set(key, bucket);
    }
    // Trim hits outside the window.
    const cutoff = now - windowMs;
    if (bucket.hits.length > 0 && bucket.hits[0]! < cutoff) {
      bucket.hits = bucket.hits.filter((t) => t >= cutoff);
    }

    if (bucket.hits.length >= max) {
      const oldest = bucket.hits[0] ?? now;
      const retryAfterMs = Math.max(1_000, oldest + windowMs - now);
      const retryAfterSec = Math.ceil(retryAfterMs / 1_000);
      res.setHeader("Retry-After", retryAfterSec.toString());
      res.status(429).json({
        error: "rate_limited",
        limit: max,
        windowMs,
        retryAfterMs,
        retryAfterSec,
      });
      return;
    }

    bucket.hits.push(now);
    bucket.expiresAt = now + windowMs;
    next();
  };
}

export const __test = { buckets };
