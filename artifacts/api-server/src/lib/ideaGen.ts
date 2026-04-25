/**
 * Region-conditioned, style-aware idea generation.
 *
 * Single cloud call to Claude Haiku via the AI Integrations proxy.
 * Inputs:
 *   • the creator's local Style Profile (so ideas feel like *them*)
 *   • the static regional trend bundle (so ideas land in the
 *     creator's actual cultural moment)
 * Outputs:
 *   • an array of `Idea` records, each with a hook + script + shot
 *     plan + caption + template hint, plus the two hard constraints:
 *       - hookSeconds ≤ 3 (idea must be understandable in <3s)
 *       - shootMinutes ≤ 30 (idea must be shootable in <30 minutes)
 *
 * Never sees raw footage. Cost ~$0.01–0.05 per call (Haiku 4.5 input
 * + 3–20 ideas of structured JSON output). Per-creator daily $ cap is
 * enforced upstream by `lib/aiCost.ts` via `callJsonAgent`.
 */

import { z } from "zod";
import {
  loadTrendBundle,
  topByScore,
  type Region,
  type TrendBundle,
} from "@workspace/lumina-trends";
import { callJsonAgent } from "./ai";
import { DEFAULT_STYLE_PROFILE, type StyleProfile } from "./styleProfile";

export const ideaSchema = z.object({
  hook: z.string().min(2).max(100),
  hookSeconds: z.number().min(0.5).max(3),
  script: z.string().min(10).max(800),
  shotPlan: z.array(z.string().min(2).max(160)).min(1).max(6),
  caption: z.string().min(2).max(280),
  templateHint: z.enum(["A", "B", "C", "D"]),
  contentType: z.enum([
    "entertainment",
    "educational",
    "lifestyle",
    "storytelling",
  ]),
  shootMinutes: z.number().min(1).max(30),
  whyItWorks: z.string().min(2).max(280),
  /**
   * Quality attributes — the LLM must self-attest. Validated downstream
   * against per-batch thresholds (≥60% hasVisualAction, ≥60% hasContrast,
   * 100% payoffType present).
   */
  payoffType: z.enum(["reveal", "reaction", "transformation", "punchline"]),
  hasContrast: z.boolean(),
  hasVisualAction: z.boolean(),
  /**
   * Required when hasVisualAction = true: a one-line description of the
   * physical action the camera shows. When hasVisualAction = false (e.g.
   * pure talking-head educational), can be an empty string.
   */
  visualHook: z.string().max(160),
});
export type Idea = z.infer<typeof ideaSchema>;

const responseSchema = z.object({
  ideas: z.array(ideaSchema).min(1).max(20),
});

const TEMPLATE_DESCRIPTIONS = `
- A (Fast Hook): 0–2s hook overlay · 2–5s reveal · 5–12s main · 12–18s payoff. Best for question / bold-statement hooks.
- B (Story Build): 0–3s scenario hook · 3–10s build tension · 10–20s twist. Best for narrative.
- C (POV/Relatable): 0–3s direct-to-camera hook · 3–12s story · 12–18s CTA. Best for personal / talking-head.
- D (Trend Jack): 0–1.5s trending audio sync · 1.5–6s visual match · 6–15s cultural twist. Best for trend-based.
`.trim();

function compactBundle(bundle: TrendBundle): string {
  // Pass only the top items so the prompt stays compact even as bundles
  // grow. Top 15 hooks, 10 captions, 6 formats covers the regional
  // moment without flooding Haiku's context.
  const hooks = topByScore(bundle.hooks, 15);
  const caps = topByScore(bundle.captionTemplates, 10);
  const fmts = topByScore(bundle.formats, 6);
  const lines = [
    `REGION: ${bundle.region}`,
    `CULTURAL NOTE: ${bundle.culturalNote}`,
    "",
    "TOP TRENDING HOOKS (text · type · contentType · pop+rec):",
    ...hooks.map(
      (h) =>
        `  • "${h.text}" · ${h.type} · ${h.contentType} · ${h.popularityScore + h.recencyScore}`,
    ),
    "",
    "TOP CAPTION TEMPLATES (text · tone · pop+rec):",
    ...caps.map(
      (c) =>
        `  • "${c.template}" · ${c.tone} · ${c.popularityScore + c.recencyScore}`,
    ),
    "",
    "TOP FORMATS (name · template · pop+rec):",
    ...fmts.map(
      (f) =>
        `  • ${f.name} → template ${f.template} · "${f.description}" · ${f.popularityScore + f.recencyScore}`,
    ),
  ];
  return lines.join("\n");
}

function profileSummary(p: StyleProfile): string {
  const dist = p.hookStyle.distribution;
  return [
    `Primary hook style: ${p.hookStyle.primary}`,
    `Hook distribution: question=${dist.question} bold=${dist.boldStatement} sceneSetter=${dist.sceneSetter}`,
    p.hookStyle.sampleHooks.length > 0
      ? `Their past hooks: ${p.hookStyle.sampleHooks.slice(0, 5).map((h) => `"${h}"`).join(", ")}`
      : "No past hook samples (use defaults).",
    `Caption tone: ${p.captionStyle.tone}; emoji avg ${p.captionStyle.avgEmojiCount} (range ${p.captionStyle.emojiRange[0]}–${p.captionStyle.emojiRange[1]}); avg sentence length ${p.captionStyle.avgSentenceLengthWords} words; punctuation: ${p.captionStyle.punctuationPattern}`,
    `Pacing: ~${p.pacing.avgCutsPerSecond} cuts/sec, ~${p.pacing.avgVideoDurationSeconds}s typical duration`,
    `Content type: ${p.topics.contentType}`,
    p.topics.keywords.length > 0
      ? `Recurring keywords: ${p.topics.keywords.slice(0, 10).join(", ")}`
      : "No recurring keywords yet.",
    p.topics.recurringPhrases.length > 0
      ? `Recurring phrases: ${p.topics.recurringPhrases.slice(0, 5).join(" · ")}`
      : "",
    `Language: ${p.language.primary}${p.language.slangMarkers.length > 0 ? ` (slang: ${p.language.slangMarkers.slice(0, 8).join(", ")})` : ""}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export type GenerateIdeasInput = {
  region: Region;
  styleProfile?: StyleProfile;
  count?: number;
  /** When true, force creative variation away from the prior batch. */
  regenerate?: boolean;
  /** Cost-tracking hooks (creatorId for daily $ cap). */
  ctx?: {
    creatorId?: string | null;
    agentRunId?: string | null;
  };
};

export async function generateIdeas(
  input: GenerateIdeasInput,
): Promise<{ ideas: Idea[] }> {
  const region = input.region;
  const count = Math.max(1, Math.min(input.count ?? 3, 20));
  const profile = input.styleProfile ?? DEFAULT_STYLE_PROFILE;
  const bundle = loadTrendBundle(region);

  // Region-specific tone guidance. Western (US/UK/CA/AU) over-indexes
  // on introspective "self-help / what I learned / mindset" framings
  // when left to its own devices — bias the model HARD toward the
  // formats that actually win in feed for English-speaking creators.
  const regionToneGuidance =
    region === "western"
      ? [
          "WESTERN-REGION TONE BIAS (mandatory):",
          "  • REDUCE introspective self-help, mindset, 'what I learned', 'my journey', or 'reminder that…' framings — these underperform in feed.",
          "  • INCREASE POV scenarios (\"POV: you tell your roommate rent went up\"), confrontation comedy, awkward social situations, and situational humor with a clear visual punchline.",
          "  • Lean into specific, observable life moments (Trader Joe's run, group-chat screenshots, roommate dynamics, dating-app oddities, work-from-home absurdities) over abstract advice.",
        ].join("\n")
      : "";

  const system = [
    "You are Lumina's Ideator — a sharp, regionally-grounded short-form video strategist for English-speaking 1K–50K micro-creators.",
    "",
    "Your job: produce ideas a real creator can shoot today. Each idea must obey TWO HARD CONSTRAINTS:",
    "  1. SHOOTABLE IN <30 MINUTES end-to-end — single location, props the creator already owns, no actors beyond the creator and (optionally) one friend, no expensive setups.",
    "  2. UNDERSTANDABLE IN <3 SECONDS — the hook must land within 3 seconds of audio (≤8 words spoken aloud); a viewer scrolling at speed must instantly grasp what the video is about. THIS IS A HARD WORD COUNT — count the words in your hook before you submit. \"POV:\" counts as one word. If the hook is 9+ words, rewrite it.",
    "",
    "QUALITY RULES (per-batch, mandatory):",
    "  A. EVERY idea must have a clear PAYOFF — declare it in `payoffType` as one of:",
    "     • reveal       — something hidden or unexpected is shown",
    "     • reaction     — someone's genuine surprise / amusement / shock is captured",
    "     • transformation — visible before→after change (look, space, situation)",
    "     • punchline    — a verbal or visual joke that lands at the end",
    "     If the idea has no clear payoff, do not submit it. Find a different angle.",
    "  B. AT LEAST 60% of ideas in the batch must have a visible CONTRAST — set `hasContrast: true` only when the video shows one of:",
    "     • before / after (her room before vs after)",
    "     • expectation vs reality ('what I planned' vs 'what actually happened')",
    "     • assumption vs truth ('what people think jollof rice is' vs 'what it actually is')",
    "     • two opposing sides (POV scenarios with two characters)",
    "  C. AT LEAST 60% of ideas must include a clear VISUAL ACTION — set `hasVisualAction: true` only when the camera shows a concrete physical thing happening (not pure talking-head). Articulate the action in `visualHook` (e.g. \"Pours coffee, then accidentally drops phone in cup\"). For talking-head ideas, set `hasVisualAction: false` and leave `visualHook` empty.",
    "  D. BANNED FORMATS unless the hook contains a sharp TWIST that subverts the format:",
    "     • \"a day in my life\" / \"day in the life\"",
    "     • \"X tips\" / \"top X\" / \"things you should know\"",
    "     • \"what I eat in a day\"",
    "     • \"get ready with me\" / \"GRWM\"",
    "     • \"morning routine\" / \"night routine\"",
    "     If you use any of these framings, the hook MUST contain a clear subversion (e.g. \"Day in my life if I lied about my job\" — twist; \"Day in my life as a freelancer\" — banned).",
    "",
    "Region authenticity is mandatory. Use the regional cultural note + trending hooks as your grounding. Code-switch to the region's natural slang where appropriate (Hinglish for India, Tagalog for Philippines, Pidgin for Nigeria) — but keep the hook itself parseable to a wider English-speaking audience.",
    regionToneGuidance,
    "",
    `Match the creator's personal style profile — their hook style, caption tone, emoji density, pacing, content type. If their primary hook style is "${profile.hookStyle.primary}", at least half the ideas should use that hook type.`,
    "",
    "Pick the templateHint deterministically from the hook type:",
    "  • question / boldStatement (educational or entertainment) → 'A'",
    "  • storytelling, narrative builds → 'B'",
    "  • POV / direct-to-camera / lifestyle → 'C'",
    "  • trend-based, audio-driven → 'D'",
    "",
    "Templates available:",
    TEMPLATE_DESCRIPTIONS,
    "",
    "Each idea is one JSON object with fields:",
    "  hook (≤8 words HARD CAP, the actual spoken/overlaid first line),",
    "  hookSeconds (number 0.5–3, your estimate of how long the hook lands),",
    "  script (10–60 second talking points OR shot narration, plain prose),",
    "  shotPlan (1–6 short shot descriptions, e.g. ['Phone in hand', \"Mom's reaction\", 'You hiding screen']),",
    "  caption (a social caption matching the creator's tone, emoji count within their range),",
    "  templateHint ('A' | 'B' | 'C' | 'D'),",
    "  contentType ('entertainment' | 'educational' | 'lifestyle' | 'storytelling'),",
    "  shootMinutes (integer 1–30, your honest estimate),",
    "  whyItWorks (one sentence connecting the idea to the creator's style or the regional moment),",
    "  payoffType ('reveal' | 'reaction' | 'transformation' | 'punchline'),",
    "  hasContrast (boolean — honest self-attestation per rule B),",
    "  hasVisualAction (boolean — honest self-attestation per rule C),",
    "  visualHook (string — required when hasVisualAction=true, empty string otherwise).",
    "",
    "Ideas must be specific and concrete, not generic templates. Reference the regional moment. Avoid clichés.",
    input.regenerate
      ? "REGENERATION MODE: This is a second batch — produce ideas in clearly different angles or content types from a typical first batch. Surprise the creator."
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    `=== CREATOR STYLE PROFILE ===`,
    profileSummary(profile),
    "",
    `=== REGION CONTEXT ===`,
    compactBundle(bundle),
    "",
    `=== TASK ===`,
    `Produce ${count} ideas for tomorrow. Return strictly:`,
    `{ "ideas": [ { hook, hookSeconds, script, shotPlan, caption, templateHint, contentType, shootMinutes, whyItWorks, payoffType, hasContrast, hasVisualAction, visualHook } ] }`,
    `Remember: every hook ≤8 words HARD; every shootMinutes ≤30; every idea has payoffType; aim for ≥60% hasContrast and ≥60% hasVisualAction across the batch.`,
  ].join("\n");

  // Output budget: each idea is ~250–320 tokens of structured JSON
  // (rich script + 1–6 shot lines + caption + whyItWorks). Budget
  // 350 per idea to leave breathing room for longer scripts, plus
  // 600 for the array scaffold. Capped at 8000 — within Haiku 4.5's
  // 8192 output cap. For count=20 this lands at ~7600.
  const maxTokens = Math.min(600 + count * 350, 8000);

  let out: { ideas: Idea[] };
  try {
    out = await callJsonAgent({
      ctx: {
        creatorId: input.ctx?.creatorId ?? null,
        agentRunId: input.ctx?.agentRunId ?? null,
        agent: "ideator",
      },
      schema: responseSchema,
      system,
      user,
      maxTokens,
    });
  } catch (err) {
    // Partial-recovery path: when Haiku's output tops out mid-array
    // (e.g. count=20 and the model writes long scripts), the parser
    // throws "Agent returned non-JSON output". Salvage by extracting
    // every COMPLETE idea object from the truncated stream.
    const msg = err instanceof Error ? err.message : String(err);
    const recovered = recoverPartialIdeas(msg);
    if (recovered.length === 0) throw err;
    out = { ideas: recovered };
  }

  // Defensive constraint enforcement: clip values that drift past the
  // hard limits even if the LLM tried to slip past them. The schema's
  // .max() already rejects truly invalid values; this just normalizes.
  const ideas = out.ideas.map((i) => ({
    ...i,
    hookSeconds: Math.min(i.hookSeconds, 3),
    shootMinutes: Math.min(Math.round(i.shootMinutes), 30),
  }));

  return { ideas };
}

/**
 * Best-effort recovery of complete idea objects from a Haiku response
 * that got truncated mid-stream. We only know the truncated text via
 * the upstream "Agent returned non-JSON output: <preview…>" error
 * message, but `callJsonAgent` truncates at 200 chars, so the
 * 200-char preview alone is unusable. Therefore this function is
 * a no-op for the current ai.ts (it simply returns []), kept as a
 * placeholder so callers can adopt full-text recovery if/when ai.ts
 * starts re-throwing the full body.
 *
 * The real fix is the bumped maxTokens above. This recovery path is
 * defense in depth — if a future idea has a particularly long script
 * and pushes us over budget anyway, the user sees an error rather
 * than silent partial results. We deliberately do NOT swallow the
 * truncation here without proof of well-formed objects.
 */
function recoverPartialIdeas(_truncatedPreview: string): Idea[] {
  // Intentionally returns [] — see docstring.
  return [];
}
