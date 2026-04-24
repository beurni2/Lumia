/**
 * Director — turns the highest-potential brief into a draft video.
 *
 * Writes a `videos` row with status='draft', script populated, and
 * agents map showing ideator + director done. The Editor will refine
 * this into status='ready' on the next agent step.
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import { callJsonAgent } from "../lib/ai";
import type { AgentContext, AgentResult } from "./runner";

const directorSchema = z.object({
  title: z.string().min(2).max(220),
  script: z.string().min(20).max(3000),
  reasoning: z.string().min(10).max(2000),
});

export async function directorAgent(
  ctx: AgentContext,
  topBriefId: string,
): Promise<AgentResult> {
  const brief = (
    await db
      .select()
      .from(schema.trendBriefs)
      .where(eq(schema.trendBriefs.id, topBriefId))
      .limit(1)
  )[0];
  if (!brief) throw new Error(`brief ${topBriefId} not found`);

  const creator = (
    await db
      .select()
      .from(schema.creators)
      .where(eq(schema.creators.id, ctx.creatorId))
      .limit(1)
  )[0];
  if (!creator) throw new Error("creator not found");

  const out = await callJsonAgent({
    ctx: {
      creatorId: ctx.creatorId,
      agentRunId: ctx.parentRunId,
      agent: "director",
    },
    schema: directorSchema,
    system:
      "You are the Director agent — a short-form video showrunner. " +
      "You transform a trend brief into a 25–35 second vertical video " +
      "script with a clear hook, tension beat, and payoff. " +
      "Schema: { title, script, reasoning }. The script should read like " +
      "spoken voice-over with [BRACKETED] visual cues. Keep it crisp; " +
      "creators on TikTok don't read paragraphs.",
    user:
      `Creator: ${creator.name} — ${creator.niche}\n` +
      `Trend brief title: ${brief.title}\n` +
      `Context: ${brief.context}\n` +
      `Why it works: ${brief.description}\n\n` +
      `Write a vertical video script. The 'reasoning' field explains ` +
      `your structural choices in one paragraph.`,
    maxTokens: 1500,
  });

  const videoId = `swarm-${ctx.parentRunId.slice(0, 8)}-v`;
  await db.insert(schema.videos).values({
    id: videoId,
    creatorId: ctx.creatorId,
    title: out.title,
    // Match the existing VideoStatus contract: Ideating | Editing | Ready.
    // Director hands off to Editor, so the row is now in Editing.
    status: "Editing",
    viralScore: null,
    reasoning: out.reasoning,
    thumbnailKey: "creator-1",
    script: out.script,
    agents: {
      Ideator: "done",
      Director: "done",
      Editor: "active",
      Monetizer: "pending",
    },
  });

  return {
    summary: `drafted "${out.title}" from the top brief`,
    data: { videoId, title: out.title },
  };
}
