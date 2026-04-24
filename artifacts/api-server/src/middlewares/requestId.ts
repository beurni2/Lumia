/**
 * Request-ID middleware.
 *
 * Assigns a stable id to every request and surfaces it on:
 *   - `req.id` (so pino-http picks it up automatically — see app.ts'
 *     `req.id` serializer).
 *   - the `X-Request-Id` response header (so creators reporting bugs
 *     can quote it and we can grep it out of error_events).
 *
 * Honors an inbound `X-Request-Id` if present (e.g. from a load
 * balancer or another service in a future fan-out), otherwise mints
 * a fresh uuid v4.
 *
 * Mounted FIRST in app.ts so pino-http and the error handler both see
 * a populated id.
 */

import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

const HEADER = "x-request-id";
// Allowlist for inbound ids reflected back into a response header.
// Restricting to alnum + dash + underscore prevents CRLF injection
// (response splitting) — an inbound `foo\r\nSet-Cookie: ...` would
// otherwise be reflected verbatim by `res.setHeader`.
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function requestIdMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const inbound = req.headers[HEADER];
    const id =
      typeof inbound === "string" && SAFE_ID.test(inbound)
        ? inbound
        : randomUUID();
    // express's `req.id` is read-only on its types, but pino-http
    // mutates it the same way — assign through `any` to match.
    (req as unknown as { id: string }).id = id;
    res.setHeader("X-Request-Id", id);
    next();
  };
}
