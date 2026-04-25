/**
 * Anthropic client for the autonomous swarm.
 *
 * Wired through the Replit AI Integrations proxy so we don't ship our
 * own API key — the proxy routes to Anthropic and bills against repl
 * credits. Both env vars are auto-provisioned by the integration setup.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  checkDailyCap,
  recordUsage,
  DailyCapExceededError,
} from "./aiCost";

const baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;

if (!baseURL || !apiKey) {
  // Don't throw at module load — let routes return a clean 503 instead
  // so a misconfigured environment doesn't crash the whole server.
  // eslint-disable-next-line no-console
  console.warn(
    "[ai] Anthropic integration env vars missing — swarm runs will fail. " +
      "Re-run setupReplitAIIntegrations({ providerSlug: 'anthropic', ... }).",
  );
}

export const claude = new Anthropic({
  baseURL,
  apiKey: apiKey ?? "missing",
});

export const SWARM_MODEL = "claude-haiku-4-5";

/**
 * Asks Claude for a JSON object matching `schema` and parses it strictly.
 *
 * The agents are creative-copy tasks (trend riffs, storyboards, brand
 * matches) so haiku is the right cost/latency point. We coerce JSON via
 * a structural prompt + ```json fences, then strip and parse.
 */
/**
 * Optional cost-tracking context. When present, two things happen:
 *   1. PRE-CALL: we check the creator's daily $ cap. If they're over,
 *      we throw `DailyCapExceededError` BEFORE making the API call so
 *      no further spend accrues.
 *   2. POST-CALL: we insert a row into `ai_usage` with the actual
 *      input/output token counts the API returned.
 * All fields are optional — callers without a creator (system tasks)
 * can still record usage with `agent` only, and a fully-empty ctx
 * skips both check and record (legacy behavior).
 */
export type AiCallContext = {
  creatorId?: string | null;
  agentRunId?: string | null;
  agent?: string | null;
};

export async function callJsonAgent<T extends z.ZodTypeAny>({
  system,
  user,
  schema,
  maxTokens = 1024,
  ctx,
}: {
  system: string;
  user: string;
  schema: T;
  maxTokens?: number;
  ctx?: AiCallContext;
}): Promise<z.infer<T>> {
  if (ctx?.creatorId) {
    const cap = await checkDailyCap(ctx.creatorId);
    if (!cap.ok) {
      throw new DailyCapExceededError(cap.spentMicro, cap.capMicro);
    }
  }

  const res = await claude.messages.create({
    model: SWARM_MODEL,
    max_tokens: maxTokens,
    system:
      system +
      "\n\nRespond ONLY with a single JSON object (no prose, no markdown fences). " +
      "Do not wrap the JSON in code blocks. Do not include any other text.",
    messages: [{ role: "user", content: user }],
  });

  // Anthropic always returns a usage block with input/output counts.
  // Record it before parsing so even a bad-JSON failure still bills.
  // We use res.model rather than the SWARM_MODEL constant we sent —
  // Anthropic returns the resolved version (e.g. "claude-haiku-4-5"
  // may resolve to a dated sub-version), and rateFor() falls back
  // gracefully to defaultRate if the resolved name isn't in our
  // rate table.
  if (ctx) {
    await recordUsage({
      creatorId: ctx.creatorId ?? null,
      agentRunId: ctx.agentRunId ?? null,
      agent: ctx.agent ?? null,
      model: res.model ?? SWARM_MODEL,
      inputTokens: res.usage?.input_tokens ?? 0,
      outputTokens: res.usage?.output_tokens ?? 0,
    });
  }

  const text = res.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();

  // Strip code fences defensively even though we asked for raw JSON.
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Attach the full raw text to the error so callers can attempt
    // partial recovery (e.g. salvaging complete idea objects from a
    // truncated array). The user-facing message stays bounded.
    const e = new Error(
      `Agent returned non-JSON output: ${cleaned.slice(0, 200)}…`,
    ) as Error & { rawText?: string };
    e.rawText = cleaned;
    throw e;
  }

  try {
    return schema.parse(parsed);
  } catch (err) {
    // Schema validation failed (e.g. one idea had 9 words in hook,
    // another had too-long shotPlan). Attach raw text so the caller's
    // recovery path can salvage individually-valid ideas via safeParse.
    if (err && typeof err === "object") {
      (err as { rawText?: string }).rawText = cleaned;
    }
    throw err;
  }
}
