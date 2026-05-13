/**
 * Single source of truth for "which creator owns this request?"
 *
 * Resolution order:
 *   1. Clerk session present → look up creators.auth_user_id == userId.
 *      If none exists yet (first sign-in), provision a fresh creator
 *      row using the Clerk userId so subsequent calls find it.
 *   2. No Clerk session → fall back to the seeded demo creator
 *      (is_demo = TRUE) so signed-out / onboarding-stage clients still
 *      render content. The mobile app gates the tabs behind sign-in,
 *      so in production this branch only fires for curl / dev tools.
 */

import type { Request } from "express";
import { asc, eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { db, schema } from "../db/client";
import type { Creator } from "../db/schema";

export type CreatorResolution =
  | { kind: "found"; creator: Creator }
  | { kind: "unauthenticated_unknown" };

async function findOrCreateForAuthUser(
  authUserId: string,
): Promise<Creator | undefined> {
  // Atomic provision: INSERT ... ON CONFLICT DO NOTHING is safe under
  // concurrent first requests for the same Clerk user. We always
  // re-select afterwards so both branches (created here vs created by
  // a racing request) return the same row.
  await db
    .insert(schema.creators)
    .values({
      authUserId,
      name: "New Creator",
      location: "—",
      niche: "—",
      followers: 0,
      currency: "USD",
      imageKey: "creator-1",
      isDemo: false,
    })
    .onConflictDoNothing({ target: schema.creators.authUserId });

  return (
    await db
      .select()
      .from(schema.creators)
      .where(eq(schema.creators.authUserId, authUserId))
      .limit(1)
  )[0];
}

export async function resolveCreator(
  req: Request,
): Promise<CreatorResolution> {
  const auth = getAuth(req);
  const authUserId = auth?.userId;

  if (authUserId) {
    const creator = await findOrCreateForAuthUser(authUserId);
    if (creator) return { kind: "found", creator };
    return { kind: "unauthenticated_unknown" };
  }

  // P17-A1A — deterministic ordering. The DB historically accumulated
  // ~108 `is_demo=TRUE` rows from old qa_sweep:* runs that were never
  // cleaned up; an unordered `LIMIT 1` returned an arbitrary row, which
  // broke the QA harness (driver pinned its read row while the route
  // resolved a different demo for write). `ORDER BY created_at ASC, id
  // ASC` makes the resolution deterministic and selects the canonical
  // (earliest-seeded) demo row. The `id ASC` tiebreaker covers any case
  // where two demo rows share a `created_at` (same migration / same
  // millisecond seed). Production behaviour is unchanged for authed
  // users; only the unauth-demo branch is affected and it now resolves
  // consistently to the canonical demo creator. Pairs with the
  // qaCleanupDemoCreators script which flips stale qa_sweep:* rows to
  // is_demo=FALSE so they fall out of consideration entirely.
  const demo = (
    await db
      .select()
      .from(schema.creators)
      .where(eq(schema.creators.isDemo, true))
      .orderBy(asc(schema.creators.createdAt), asc(schema.creators.id))
      .limit(1)
  )[0];

  if (demo) return { kind: "found", creator: demo };
  return { kind: "unauthenticated_unknown" };
}
