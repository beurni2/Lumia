/**
 * Editor — refines the draft script for retention and predicts a
 * viral score. Updates the video row to status='ready' and fills the
 * viralScore + agents.editor='done'.
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import { callJsonAgent } from "../lib/ai";
import type { AgentContext, AgentResult } from "./runner";

const editorSchema = z.object({
  refinedScript: z.string().min(20).max(3000),
  viralScore: z.number().int().min(40).max(98),
  reasoning: z.string().min(10).max(2000),
});

export async function editorAgent(
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

  const out = await callJsonAgent({
    ctx: {
      creatorId: ctx.creatorId,
      agentRunId: ctx.parentRunId,
      agent: "editor",
    },
    schema: editorSchema,
    system:
      "You are the Editor agent — a retention-obsessed cutter. You take " +
      "a director's draft and tighten it: trim filler, sharpen the hook, " +
      "land the payoff. Then predict a viral score 40–98 based on hook " +
      "strength and pattern interrupt. " +
      "Schema: { refinedScript, viralScore, reasoning }. The reasoning " +
      "explains the cuts you made and why the score lands where it does.",
    user:
      `Director draft title: ${video.title}\n\n` +
      `Draft script:\n${video.script}\n\n` +
      `Director's reasoning:\n${video.reasoning}\n\n` +
      `Refine this for retention and predict viral_score.`,
    maxTokens: 1500,
  });

  // Read-modify-write on the JSONB `agents` map. Safe today because
  // the swarm runs strictly sequentially and is the only writer to a
  // freshly-created video row. If a future Phase introduces parallel
  // agents touching the same video, switch to `jsonb_set` to avoid
  // last-writer-wins clobbering.
  const nextAgents = {
    ...(video.agents ?? {}),
    Editor: "done",
    Monetizer: "active",
  };

  await db
    .update(schema.videos)
    .set({
      // VideoStatus contract: Ideating | Editing | Ready.
      status: "Ready",
      viralScore: out.viralScore,
      script: out.refinedScript,
      reasoning: out.reasoning,
      agents: nextAgents,
    })
    .where(eq(schema.videos.id, videoId));

  return {
    summary: `polished "${video.title}" → ready (viral ${out.viralScore})`,
    data: { videoId, viralScore: out.viralScore },
  };
}
