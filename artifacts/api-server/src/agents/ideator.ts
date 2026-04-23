/**
 * Ideator — surfaces 2 fresh trend briefs scoped to the creator.
 *
 * Reads the creator's niche and recent global trends, asks Claude for
 * two distinctly different angles for tomorrow, and inserts them into
 * `trend_briefs` with creator_id set so they appear in the creator's
 * feed alongside the global catalog.
 */

import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import { callJsonAgent } from "../lib/ai";
import type { AgentContext, AgentResult } from "./runner";

const ideatorSchema = z.object({
  briefs: z
    .array(
      z.object({
        title: z.string().min(2).max(220),
        context: z.string().min(2).max(220),
        viralPotential: z.number().int().min(40).max(98),
        description: z.string().min(10).max(2000),
      }),
    )
    .min(1)
    .max(3),
});

export async function ideatorAgent(
  ctx: AgentContext,
): Promise<AgentResult> {
  const creator = (
    await db
      .select()
      .from(schema.creators)
      .where(eq(schema.creators.id, ctx.creatorId))
      .limit(1)
  )[0];
  if (!creator) throw new Error("creator not found");

  const recentGlobal = await db
    .select({
      title: schema.trendBriefs.title,
      context: schema.trendBriefs.context,
      viralPotential: schema.trendBriefs.viralPotential,
    })
    .from(schema.trendBriefs)
    .orderBy(desc(schema.trendBriefs.createdAt))
    .limit(8);

  const recentSummary =
    recentGlobal.length > 0
      ? recentGlobal
          .map(
            (t) =>
              `- ${t.title} (${t.context}, viral=${t.viralPotential})`,
          )
          .join("\n")
      : "(no recent trends)";

  const out = await callJsonAgent({
    schema: ideatorSchema,
    system:
      "You are the Ideator agent in Lumina's creative swarm — a sharp, " +
      "trend-spotting strategist for short-form video creators. Your job: " +
      "find 2 genuinely fresh angles the creator should chase tomorrow. " +
      "Avoid copying the recent trends — find adjacent or counter-takes. " +
      "Schema: { briefs: [{ title, context, viralPotential (40-98), " +
      "description }] }. The 'context' field is one short tag like " +
      `"Trending Audio" or "Niche Pivot". Description is 2-3 sentences ` +
      "of why it works for THIS creator.",
    user:
      `Creator niche: ${creator.niche}\n` +
      `Creator location: ${creator.location}\n` +
      `Followers: ${creator.followers}\n\n` +
      `Recent trends in the catalog (don't repeat):\n${recentSummary}\n\n` +
      `Surface 2 fresh trend briefs for tomorrow.`,
    // Two short briefs + reasoning fit comfortably in ~800 tokens;
    // capping prevents Haiku from drifting into long-form prose.
    maxTokens: 800,
  });

  const inserted = await db
    .insert(schema.trendBriefs)
    .values(
      out.briefs.map((b, i) => ({
        id: `swarm-${ctx.parentRunId.slice(0, 8)}-i${i}`,
        title: b.title,
        context: b.context,
        viralPotential: b.viralPotential,
        description: b.description,
        imageKey: "creator-1",
        creatorId: ctx.creatorId,
      })),
    )
    .returning({
      id: schema.trendBriefs.id,
      title: schema.trendBriefs.title,
      viralPotential: schema.trendBriefs.viralPotential,
    });

  const top = inserted.reduce((a, b) =>
    b.viralPotential > a.viralPotential ? b : a,
  );

  return {
    summary: `surfaced ${inserted.length} fresh trends — top: "${top.title}" (viral ${top.viralPotential})`,
    data: { briefs: inserted, topBriefId: top.id },
  };
}
