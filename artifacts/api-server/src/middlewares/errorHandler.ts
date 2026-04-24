/**
 * Express error handler — must be the LAST app.use() so it catches
 * errors from every preceding middleware and route handler.
 *
 * Responsibilities:
 *   1. Pick a sensible status (preserves any `err.statusCode`/`err.status`
 *      already set, otherwise 500).
 *   2. Persist a structured row to `error_events` via captureError so
 *      we can introspect failures from the admin endpoint.
 *   3. Log via pino with the same correlation id as the request.
 *   4. Send a sanitized JSON body to the client — never the stack.
 *
 * The `creatorId` is best-effort: routes that have already resolved
 * a creator (via resolveCreator) usually stash it on `res.locals` —
 * we look there. Errors thrown before resolution simply have no
 * creatorId attached, which is fine.
 */

import type { Request, Response, NextFunction } from "express";
import { captureError } from "../lib/errorCapture";
import { logger } from "../lib/logger";

type ErrorWithStatus = Error & {
  statusCode?: number;
  status?: number;
  expose?: boolean;
};

export function errorHandlerMiddleware() {
  return (
    err: unknown,
    req: Request,
    res: Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: NextFunction,
  ): void => {
    const e = err as ErrorWithStatus;
    const statusCode =
      typeof e?.statusCode === "number"
        ? e.statusCode
        : typeof e?.status === "number"
          ? e.status
          : 500;

    const requestId =
      typeof (req as { id?: unknown }).id === "string"
        ? ((req as { id?: string }).id as string)
        : undefined;

    // Best-effort creator id from res.locals (set by resolveCreator
    // when it has run successfully) or req.auth (Clerk).
    const localsCreatorId = (res.locals as { creatorId?: string }).creatorId;
    const creatorId =
      typeof localsCreatorId === "string" ? localsCreatorId : undefined;

    // Route pattern — req.route.path is set when express has matched
    // a route; otherwise fall back to the raw path so 404s and
    // pre-routing errors still record something useful.
    const route =
      (req.route as { path?: string } | undefined)?.path ??
      req.originalUrl.split("?")[0];

    // Persist BEFORE responding so a slow DB doesn't delay the user.
    void captureError({
      requestId,
      method: req.method,
      route,
      statusCode,
      creatorId,
      err,
    });

    if (statusCode >= 500) {
      logger.error(
        { err, requestId, statusCode, route, method: req.method },
        "unhandled error",
      );
    } else {
      logger.warn(
        { err, requestId, statusCode, route, method: req.method },
        "client error",
      );
    }

    if (res.headersSent) {
      // Express will close the connection — nothing more we can do.
      return;
    }

    // Sanitize the body. 4xx errors that opt-in via `expose=true`
    // (http-errors convention) get their message surfaced; everything
    // else gets a generic body so we don't leak internals.
    const safeBody =
      statusCode < 500 && (e?.expose === true || statusCode === 400)
        ? { error: e?.message || "request_failed", requestId }
        : { error: "internal_error", requestId };

    res.status(statusCode).json(safeBody);
  };
}
