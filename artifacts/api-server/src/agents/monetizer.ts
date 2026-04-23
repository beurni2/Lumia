/**
 * Monetizer — matches the ready video to a brand deal and projects an
 * earnings ledger entry for the deal advance.
 *
 * Inserts one `brand_deals` row (status='Negotiating') and one
 * `ledger_entries` row representing the platform's projected slice
 * (we book the gross deal amount; the 10% performance fee will be
 * computed in the earnings route, not double-recorded here).
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import { callJsonAgent } from "../lib/ai";
import type { AgentContext, AgentResult } from "./runner";

const monetizerSchema = z.object({
  brand: z.string().min(2).max(160),
  amountUsd: z.number().int().min(50).max(50000),
  status: z.enum(["Negotiating", "Signed"]),
  rationale: z.string().min(10).max(2000),
});

export async function monetizerAgent(
  ctx: AgentContext,
  videoId: string,
): Promise<AgentResult> {
  const video = (
    await db
      .select()
      .from(schema.videos)
      .where(eq(schema.videos.id, videoId))
      .limit(1)
  )[0];
  if (!video) throw new Error(`video ${videoId} not found`);

  const creator = (
    await db
      .select()
      .from(schema.creators)
      .where(eq(schema.creators.id, ctx.creatorId))
      .limit(1)
  )[0];
  if (!creator) throw new Error("creator not found");

  const out = await callJsonAgent({
    schema: monetizerSchema,
    system:
      "You are the Monetizer agent — a brand partnerships matcher. You " +
      "study the video and propose ONE realistic brand deal that fits " +
      "the creator's niche, follower tier, and the video's angle. Use " +
      "real-feeling brand names (not 'BrandX'). Amount in whole USD. " +
      "Schema: { brand, amountUsd, status: 'Negotiating'|'Signed', " +
      "rationale }. Status='Negotiating' for new pitches; only mark " +
      "'Signed' if the rationale shows clear product-market fit.",
    user:
      `Creator: ${creator.name} (${creator.followers} followers, ${creator.niche})\n` +
      `Video title: ${video.title}\n` +
      `Viral score: ${video.viralScore}\n` +
      `Script preview: ${video.script.slice(0, 400)}…\n\n` +
      `Propose the best-fit brand deal.`,
    maxTokens: 500,
  });

  const dealId = `swarm-${ctx.parentRunId.slice(0, 8)}-d`;
  const amountCents = out.amountUsd * 100;

  await db.insert(schema.brandDeals).values({
    id: dealId,
    creatorId: ctx.creatorId,
    brand: out.brand,
    status: out.status,
    amount: amountCents,
  });

  // Book the projected payout to the current calendar month so the
  // earnings sparkline reacts immediately.
  const monthBucket = new Date().toISOString().slice(0, 7);
  await db.insert(schema.ledgerEntries).values({
    creatorId: ctx.creatorId,
    monthBucket,
    amount: amountCents,
    source: `brand:${out.brand}`,
  });

  // Mark monetizer done on the video.
  await db
    .update(schema.videos)
    .set({
      agents: {
        ...(video.agents ?? {}),
        Monetizer: "done",
      },
    })
    .where(eq(schema.videos.id, videoId));

  return {
    summary: `matched "${video.title}" → ${out.brand} ($${out.amountUsd}, ${out.status})`,
    data: { dealId, brand: out.brand, amountUsd: out.amountUsd },
  };
}
