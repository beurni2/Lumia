/**
 * Single source of truth for "which creator is this request about?"
 *
 * Contract (uniform across every user-scoped route):
 *   - If x-auth-user-id header is present:
 *       - Return the matching creator row, OR
 *       - Return null if no creator owns that authUserId.  The route MUST
 *         respond 401 in that case rather than silently falling back to
 *         the demo account (otherwise tabs would show contradictory
 *         identities for the same caller).
 *   - If x-auth-user-id is absent (signed-out / onboarding state):
 *       - Return the seeded demo creator so the mobile app keeps
 *         rendering content.
 *
 * Once Clerk middleware lands this header read becomes a verified
 * `req.auth.userId` lookup; the rest of the contract is unchanged.
 */

import type { Request } from "express";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import type { Creator } from "../db/schema";

export type CreatorResolution =
  | { kind: "found"; creator: Creator }
  | { kind: "unauthenticated_unknown" };

export async function resolveCreator(
  req: Request,
): Promise<CreatorResolution> {
  const authUserId = req.header("x-auth-user-id");

  if (authUserId) {
    const row = (
      await db
        .select()
        .from(schema.creators)
        .where(eq(schema.creators.authUserId, authUserId))
        .limit(1)
    )[0];
    if (row) return { kind: "found", creator: row };
    return { kind: "unauthenticated_unknown" };
  }

  const demo = (
    await db
      .select()
      .from(schema.creators)
      .where(eq(schema.creators.isDemo, true))
      .limit(1)
  )[0];

  if (demo) return { kind: "found", creator: demo };
  return { kind: "unauthenticated_unknown" };
}
