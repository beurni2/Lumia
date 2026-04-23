/**
 * Anthropic client for the autonomous swarm.
 *
 * Wired through the Replit AI Integrations proxy so we don't ship our
 * own API key — the proxy routes to Anthropic and bills against repl
 * credits. Both env vars are auto-provisioned by the integration setup.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

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
export async function callJsonAgent<T extends z.ZodTypeAny>({
  system,
  user,
  schema,
  maxTokens = 1024,
}: {
  system: string;
  user: string;
  schema: T;
  maxTokens?: number;
}): Promise<z.infer<T>> {
  const res = await claude.messages.create({
    model: SWARM_MODEL,
    max_tokens: maxTokens,
    system:
      system +
      "\n\nRespond ONLY with a single JSON object (no prose, no markdown fences). " +
      "Do not wrap the JSON in code blocks. Do not include any other text.",
    messages: [{ role: "user", content: user }],
  });

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
    throw new Error(
      `Agent returned non-JSON output: ${cleaned.slice(0, 200)}…`,
    );
  }

  return schema.parse(parsed);
}
