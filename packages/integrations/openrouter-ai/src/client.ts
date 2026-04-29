import OpenAI from "openai";

let cached: OpenAI | null = null;

/**
 * Lazy OpenRouter client. We defer env-var validation and client
 * construction until the first call so that:
 *   1. importing this module never throws at process start (the
 *      api-server boots even if the integration isn't provisioned)
 *   2. consumers (e.g. the Llama hook mutator) can catch the throw
 *      at call time and gracefully fall back to shipping originals.
 */
export function getOpenRouterClient(): OpenAI {
  if (cached) return cached;
  if (!process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL) {
    throw new Error(
      "AI_INTEGRATIONS_OPENROUTER_BASE_URL must be set. Did you forget to provision the OpenRouter AI integration?",
    );
  }
  if (!process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY) {
    throw new Error(
      "AI_INTEGRATIONS_OPENROUTER_API_KEY must be set. Did you forget to provision the OpenRouter AI integration?",
    );
  }
  cached = new OpenAI({
    baseURL: process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL,
    apiKey: process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY,
  });
  return cached;
}

/**
 * Back-compat re-export. Acts like the old eager singleton but resolves
 * lazily on first property access. New code should call
 * `getOpenRouterClient()` directly so the throw point is obvious.
 */
export const openrouter: OpenAI = new Proxy({} as OpenAI, {
  get(_t, prop, recv) {
    return Reflect.get(getOpenRouterClient(), prop, recv);
  },
});
