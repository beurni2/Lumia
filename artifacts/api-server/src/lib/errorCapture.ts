/**
 * Persists one row to `error_events` for every uncaught error that
 * reaches the express error boundary.
 *
 * Best-effort: the insert is wrapped in its own try so a DB failure
 * during error capture cannot mask the original error or take down
 * the response. We log the secondary failure to pino and move on.
 */

import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { logger } from "./logger";

export type CaptureInput = {
  requestId?: string | undefined;
  method?: string | undefined;
  route?: string | undefined;
  statusCode?: number | undefined;
  creatorId?: string | undefined;
  err: unknown;
  context?: Record<string, unknown>;
};

const MAX_MESSAGE_BYTES = 4_000;
const MAX_STACK_BYTES = 8_000;

function truncate(s: string | undefined | null, max: number): string | null {
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

export async function captureError(input: CaptureInput): Promise<void> {
  const { err } = input;
  const isError = err instanceof Error;
  const errorName = isError ? err.name.slice(0, 120) : "NonError";
  const errorMessage = truncate(
    isError ? err.message : String(err),
    MAX_MESSAGE_BYTES,
  );
  const errorStack = truncate(isError ? err.stack ?? null : null, MAX_STACK_BYTES);

  try {
    await db.execute(sql`
      INSERT INTO error_events (
        request_id, method, route, status_code, creator_id,
        error_name, error_message, error_stack, context
      ) VALUES (
        ${input.requestId ?? null},
        ${input.method ?? null},
        ${input.route ?? null},
        ${input.statusCode ?? null},
        ${input.creatorId ?? null},
        ${errorName},
        ${errorMessage},
        ${errorStack},
        ${JSON.stringify(input.context ?? {})}::jsonb
      )
    `);
  } catch (captureErr) {
    // Never let error-capture failure mask the real error or break
    // the response — just log it and move on.
    logger.error(
      { captureErr, originalErr: errorMessage },
      "[errorCapture] failed to persist error_events row",
    );
  }
}
