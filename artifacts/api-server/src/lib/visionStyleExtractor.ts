/**
 * Llama 3.2 Vision style-extraction wrapper.
 *
 * Goal (from `attached_assets/Pasted-LLAMA-3-2-VISION-...`): given a
 * small set of pre-sampled thumbnail frames from a creator's
 * uploaded video, ask Llama 3.2 Vision (via OpenRouter) to classify
 * the visual style along a fixed enum schema. The output is then
 * persisted + aggregated by `lib/visionProfileAggregator.ts` and
 * SOFT-biases the pattern engine's `personalFit` axis at scoring
 * time. Vision NEVER generates ideas, NEVER writes hooks, NEVER
 * replaces the ideator.
 *
 * Design choices (matches the rest of the cost/style stack):
 *   - Lazy `getOpenRouterClient()` so a missing env var never crashes
 *     boot (mirrors `llamaHookMutator`).
 *   - On any failure (timeout, network, parse error, malformed
 *     response, missing API key) we return `null` and the caller
 *     decides what to do — same fail-open posture as the hook
 *     mutator.
 *   - Exhaustive enum-clamping: if the model returns a value outside
 *     the spec'd enum, we coerce to `"unknown"` (per spec rule #1
 *     "Be conservative. If unsure, return unknown"). This is the
 *     ONLY way wrong-but-shippable text survives — every other
 *     parse failure returns null for the whole batch.
 *   - Frames are passed as `data:image/...;base64,...` URLs in a
 *     single multimodal user message — Llama 3.2 11B Vision accepts
 *     multiple `image_url` content parts per message, which is
 *     cheaper than N serial calls.
 *   - Low temperature (0.2) — this is classification, not
 *     creativity. We want stable enums.
 *
 * The `parseVisionResponse` function is exported separately so the
 * QA harness can exercise the validator paths without touching the
 * network.
 */

import { logger } from "./logger";
import { openrouter } from "@workspace/integrations-openrouter-ai";

type OpenRouterClient = typeof openrouter;

// -----------------------------------------------------------------------------
// Public types — these mirror the spec's JSON shape exactly.
// -----------------------------------------------------------------------------

export const CONTENT_TYPES = [
  "talking_head",
  "reaction",
  "pov",
  "mini_story",
  "lifestyle",
  "unknown",
] as const;
export type VisionContentType = (typeof CONTENT_TYPES)[number];

export const SETTINGS = [
  "bedroom",
  "kitchen",
  "car",
  "bathroom_mirror",
  "desk",
  "outside",
  "unknown",
] as const;
export type VisionSetting = (typeof SETTINGS)[number];

export const ENERGY_LEVELS = ["low", "medium", "high", "unknown"] as const;
export type VisionEnergyLevel = (typeof ENERGY_LEVELS)[number];

export const DELIVERY_STYLES = [
  "deadpan",
  "awkward",
  "expressive",
  "confident",
  "chaotic",
  "unknown",
] as const;
export type VisionDeliveryStyle = (typeof DELIVERY_STYLES)[number];

export const FRAMINGS = [
  "close_up_face",
  "mirror",
  "desk_pov",
  "handheld",
  "wide_static",
  "unknown",
] as const;
export type VisionFraming = (typeof FRAMINGS)[number];

export const REACTION_TYPES = [
  "freeze",
  "slow_blink",
  "smile",
  "panic",
  "eye_contact",
  "none",
  "unknown",
] as const;
export type VisionReactionType = (typeof REACTION_TYPES)[number];

export type VisionAnalysis = {
  contentType: VisionContentType;
  setting: VisionSetting;
  energyLevel: VisionEnergyLevel;
  deliveryStyle: VisionDeliveryStyle;
  framing: VisionFraming;
  reactionType: VisionReactionType;
  talking: boolean;
  // Free-text — kept for transient logging only. The aggregator
  // DROPS this field before persistence (per spec: "Do not store
  // raw video analysis as public text").
  visibleAction: string;
  privacyRisk: boolean;
  privacyRiskReason: string | null;
};

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const VISION_MODEL = "meta-llama/llama-3.2-11b-vision-instruct";

// The free 11B vision tier is plenty for enum classification; we
// don't need 90B's reasoning depth. Temperature stays low — we
// want the same frame to produce the same classification across
// calls, not creative variance.
const VISION_TEMPERATURE = 0.2;
const VISION_MAX_TOKENS = 500;
const VISION_TIMEOUT_MS = 30_000;

// Cap on `visibleAction` length — defensive only. The prompt asks
// for ≤80 chars; this is the ceiling we'll accept before truncating.
const VISIBLE_ACTION_MAX_LEN = 120;

const SYSTEM_PROMPT = `You are a careful vision classifier for a creator-tools app. You will be shown 1-5 thumbnail frames sampled from a single short user-uploaded video. Your job is to classify the video's visual style along a fixed enum schema and flag any privacy-sensitive content.

Return ONLY a JSON object with EXACTLY these keys (no extra keys, no commentary):

{
  "contentType": "talking_head" | "reaction" | "pov" | "mini_story" | "lifestyle" | "unknown",
  "setting": "bedroom" | "kitchen" | "car" | "bathroom_mirror" | "desk" | "outside" | "unknown",
  "energyLevel": "low" | "medium" | "high" | "unknown",
  "deliveryStyle": "deadpan" | "awkward" | "expressive" | "confident" | "chaotic" | "unknown",
  "framing": "close_up_face" | "mirror" | "desk_pov" | "handheld" | "wide_static" | "unknown",
  "reactionType": "freeze" | "slow_blink" | "smile" | "panic" | "eye_contact" | "none" | "unknown",
  "talking": true | false,
  "visibleAction": "<one short phrase, <=80 chars, describing what is happening>",
  "privacyRisk": true | false,
  "privacyRiskReason": "<short reason or null>"
}

RULES:
1. BE CONSERVATIVE. If you cannot tell from the frames, return "unknown" for that field. Do NOT guess.
2. DO NOT INFER PRIVATE IDENTITY TRAITS (age, race, gender, religion, health). Only describe visible content.
3. SET privacyRisk=true if any frame shows: visible direct messages or chat threads, banking apps, medical info, IDs, addresses, license plates, salary or paystub data, passwords, or other private documents. Set privacyRiskReason to a short factual reason. Otherwise privacyRisk=false and privacyRiskReason=null.
4. "talking" is true ONLY if the person's mouth is clearly mid-speech in at least one frame; otherwise false.
5. Output ONLY valid JSON. No markdown, no preamble, no code fences.`;

const USER_PROMPT_TEXT =
  "Here are the sampled frames from one short video. Classify the style along the enum schema and flag any privacy risk. Return JSON only.";

// -----------------------------------------------------------------------------
// Validators / clampers
// -----------------------------------------------------------------------------

function clampEnum<T extends readonly string[]>(
  raw: unknown,
  allowed: T,
): T[number] {
  if (typeof raw === "string") {
    const lower = raw.trim().toLowerCase();
    for (const v of allowed) {
      if (v === lower) return v as T[number];
    }
  }
  return "unknown" as T[number];
}

function clampBoolean(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") return raw;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

function clampVisibleAction(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (trimmed.length <= VISIBLE_ACTION_MAX_LEN) return trimmed;
  return trimmed.slice(0, VISIBLE_ACTION_MAX_LEN);
}

function clampPrivacyReason(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 200) return trimmed;
  return trimmed.slice(0, 200);
}

/**
 * Parse a raw JSON-string model response into a fully-validated
 * `VisionAnalysis`. Returns `null` if the input isn't parseable as
 * JSON or isn't an object — every other shape error is enum-clamped
 * to "unknown" per spec rule #1.
 *
 * Exported so the QA harness can exercise validator paths without
 * touching the network.
 */
export function parseVisionResponse(raw: string): VisionAnalysis | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;

  return {
    contentType: clampEnum(obj.contentType, CONTENT_TYPES),
    setting: clampEnum(obj.setting, SETTINGS),
    energyLevel: clampEnum(obj.energyLevel, ENERGY_LEVELS),
    deliveryStyle: clampEnum(obj.deliveryStyle, DELIVERY_STYLES),
    framing: clampEnum(obj.framing, FRAMINGS),
    reactionType: clampEnum(obj.reactionType, REACTION_TYPES),
    talking: clampBoolean(obj.talking, false),
    visibleAction: clampVisibleAction(obj.visibleAction),
    privacyRisk: clampBoolean(obj.privacyRisk, false),
    privacyRiskReason: clampPrivacyReason(obj.privacyRiskReason),
  };
}

// -----------------------------------------------------------------------------
// Public extractor
// -----------------------------------------------------------------------------

export type ExtractFramesArgs = {
  frames: string[]; // each is a `data:image/...;base64,...` URL
  // Optional override for testing; production always uses the real
  // OpenRouter client. Typed via the singleton's shape so tests can
  // pass a structurally-compatible mock without depending on the
  // OpenAI SDK class directly.
  client?: OpenRouterClient;
};

export type ExtractFramesResult = {
  ok: true;
  analysis: VisionAnalysis;
  // For telemetry — total approximate token count from the model
  // response, useful for cost dashboards downstream.
  usageTokens: number | null;
} | {
  ok: false;
  reason:
    | "no_frames"
    | "client_unavailable"
    | "request_failed"
    | "empty_response"
    | "parse_failed"
    | "timeout";
};

/**
 * Single OpenRouter call that takes 1-5 base64-data-URL frames and
 * returns a fully-validated VisionAnalysis (or a structured failure
 * reason for telemetry / counter-bookkeeping in the route layer).
 *
 * Caller responsibilities:
 *   - Cap frame count and per-frame size BEFORE calling — this
 *     function trusts its inputs to be reasonable.
 *   - Drop the analysis if `analysis.privacyRisk === true`
 *     (handled by `lib/visionProfileAggregator.ts`).
 *   - Bump the `vision_call` usage counter on success.
 */
export async function extractStyleFromFrames(
  args: ExtractFramesArgs,
): Promise<ExtractFramesResult> {
  if (!args.frames || args.frames.length === 0) {
    return { ok: false, reason: "no_frames" };
  }

  // Singleton client — same pattern as the hook mutator. The
  // module-level `openrouter` instance is constructed lazily in the
  // integration package, so importing it doesn't try to read env
  // vars. The actual API call below will surface any missing-key
  // failure through the catch block as a `request_failed` reason
  // (fail-open for the route layer).
  const client: OpenRouterClient = args.client ?? openrouter;

  // Build one user message containing the prompt text + every frame
  // as an image_url part. The OpenAI SDK's typing is strict — cast
  // through `unknown` for the multimodal content array.
  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [
    { type: "text", text: USER_PROMPT_TEXT },
    ...args.frames.map((url) => ({
      type: "image_url" as const,
      image_url: { url },
    })),
  ];

  let response: Awaited<
    ReturnType<typeof client.chat.completions.create>
  >;
  try {
    response = await client.chat.completions.create(
      {
        model: VISION_MODEL,
        temperature: VISION_TEMPERATURE,
        max_tokens: VISION_MAX_TOKENS,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            // SDK accepts string | Array<ContentPart>; the multimodal
            // shape is the latter.
            content: userContent as unknown as string,
          },
        ],
      },
      { timeout: VISION_TIMEOUT_MS },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // The OpenAI SDK throws an `APIConnectionTimeoutError` on
    // timeout; we collapse that into a single bucket for telemetry.
    const isTimeout = /timeout/i.test(msg);
    logger.warn(
      { err: msg, isTimeout },
      "vision_style.request_failed",
    );
    return {
      ok: false,
      reason: isTimeout ? "timeout" : "request_failed",
    };
  }

  const raw = response.choices?.[0]?.message?.content;
  if (!raw || typeof raw !== "string") {
    return { ok: false, reason: "empty_response" };
  }

  const analysis = parseVisionResponse(raw);
  if (!analysis) {
    logger.warn(
      { rawSnippet: raw.slice(0, 200) },
      "vision_style.parse_failed",
    );
    return { ok: false, reason: "parse_failed" };
  }

  return {
    ok: true,
    analysis,
    usageTokens: response.usage?.total_tokens ?? null,
  };
}
