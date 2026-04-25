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
 *     plan + caption + template hint, plus the hard constraints:
 *       - hookSeconds ≤ 3 (idea must be understandable in <3s)
 *       - hook word count ≤ 8 (HARD — clamped on output)
 *       - videoLengthSec ∈ [15,25] (target final length)
 *       - filmingTimeMin ≤ 30 (idea must be shootable in <30 minutes)
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
  hook: z
    .string()
    .min(2)
    .max(100)
    .refine((h) => h.trim().split(/\s+/).length <= 8, {
      message: "hook must be ≤8 words",
    }),
  hookSeconds: z.number().min(0.5).max(3),
  script: z.string().min(10).max(800),
  shotPlan: z.array(z.string().min(2).max(160)).min(1).max(10),
  caption: z.string().min(2).max(280),
  templateHint: z.enum(["A", "B", "C", "D"]),
  contentType: z.enum([
    "entertainment",
    "educational",
    "lifestyle",
    "storytelling",
  ]),
  /** Target final video length in seconds (15–25 for short-form). */
  videoLengthSec: z.number().int().min(15).max(25),
  /** End-to-end filming time the creator must invest (≤30 min hard cap). */
  filmingTimeMin: z.number().int().min(1).max(30),
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
          "WESTERN-REGION TONE BIAS (HARD, ≥70% target):",
          "  • AT LEAST 70% of western ideas MUST be POV / situational / observational — not abstract questions or introspective musings.",
          "  • EXPLICITLY BANNED for western ideas — these abstract introspective patterns underperform and must NOT appear:",
          "      ✗ \"Have you ever…?\" / \"Why does no one…?\" / \"Anyone else…?\" / \"Do you ever…?\" / \"Ever notice…?\"",
          "      ✗ \"What I learned…\" / \"My journey…\" / \"Reminder that…\" / \"Mindset shift…\" / generic 'lessons'",
          "      ✗ Existential questioning about life/age/purpose without a concrete observable scene",
          "  • PREFERRED western patterns (use these heavily):",
          "      ✓ POV scenarios: \"POV: roommate asks if you're mad\", \"POV: you matched and they ghosted\"",
          "      ✓ Direct address with concrete reframe: \"You don't need productivity apps, you need a nap\", \"Stop dressing for who you used to be\"",
          "      ✓ Observational comparison: \"Therapy is just girl-dinner for your brain\"",
          "      ✓ Specific life moments: Trader Joe's run, group chat at 3am, roommate dynamics, dating-app fails, work-from-home absurdities, awkward Zoom calls, parking-lot encounters, drive-thru fails",
          "      ✓ Bold imperative on a specific behavior: \"Stop using Instagram if you want a life\"",
        ].join("\n")
      : "";

  const system = [
    "You are Lumina's Ideator — a sharp, regionally-grounded short-form video strategist for English-speaking 1K–50K micro-creators.",
    "",
    "Your job: produce ideas a real creator can shoot today. Each idea must obey THREE HARD CONSTRAINTS:",
    "  1. FILMING TIME ≤30 MINUTES end-to-end — single location, props the creator already owns, no actors beyond the creator and (optionally) one friend, no expensive setups. Declare in `filmingTimeMin`.",
    "  2. TARGET VIDEO LENGTH 15–25 SECONDS — short-form sweet spot for retention; not a TikTok story, not a Reel essay. Declare in `videoLengthSec`.",
    "  3. UNDERSTANDABLE IN <3 SECONDS — the hook must land within 3 seconds of audio AND must be ≤8 WORDS HARD CAP. Count the words. \"POV:\" is 1 word. \"When your\" is 2 words. Examples that PASS: \"POV: roommate asks if you're mad\" (6 words) · \"When your barista remembers you\" (5 words) · \"Things younger siblings just get\" (5 words). Examples that FAIL — REWRITE THESE: \"POV: your roommate asks why you're upset\" (8 words counted but 'your' redundant — tighten to \"POV: roommate asks why you're upset\" / 6 words) · \"Have you ever felt invisible at parties?\" (8 but abstract introspective — banned for western anyway). If your hook is 9+ words, REWRITE IT before submitting. NO EXCEPTIONS.",
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
    "  D. RESTRICTED FORMATS — allowed ONLY when the hook contains a STRONG TWIST or specific CONSTRAINT (not just the bare framing):",
    "     • \"a day in my life\" / \"day in the life\"",
    "     • \"X tips\" / \"top X\" / \"things you should know\"",
    "     • \"what I eat in a day\" / \"what I eat\"",
    "     • \"things only X understand\" / \"things only X get\"",
    "     • \"get ready with me\" / \"GRWM\"",
    "     • \"morning routine\" / \"night routine\"",
    "     What counts as a strong twist or constraint:",
    "       ✓ Specific budget/price: \"What I eat in a day for ₹400\", \"GRWM under $5\"",
    "       ✓ Specific subversion: \"Day in my life if I lied about my job\", \"Morning routine of someone late for work\"",
    "       ✓ Observable specificity: \"Things only oldest siblings actually get\" (not just \"things only siblings understand\")",
    "       ✓ POV reframe: \"POV: a day in my life as the office snack person\"",
    "     What does NOT count:",
    "       ✗ \"Day in my life as a freelancer\" (no twist)",
    "       ✗ \"Things only Gen Z understand\" (too broad — nothing specific to react to visually)",
    "       ✗ \"What I eat in a day\" (no constraint)",
    "       ✗ \"5 productivity tips\" (no twist)",
    "     If you can't add a strong twist or constraint, pick a different angle entirely.",
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
    "  hook (≤8 words HARD CAP — count them, rewrite if over),",
    "  hookSeconds (number 0.5–3, your estimate of how long the hook lands),",
    "  script (talking points OR shot narration as plain prose, sized for a 15–25s final video),",
    "  shotPlan (3–8 short shot descriptions ideal, up to 10 max, e.g. ['Phone in hand', \"Mom's reaction\", 'You hiding screen']),",
    "  caption (a social caption matching the creator's tone, emoji count within their range),",
    "  templateHint ('A' | 'B' | 'C' | 'D'),",
    "  contentType ('entertainment' | 'educational' | 'lifestyle' | 'storytelling'),",
    "  videoLengthSec (integer 15–25, target FINAL video length in seconds),",
    "  filmingTimeMin (integer 1–30, end-to-end FILMING time in minutes),",
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
    `{ "ideas": [ { hook, hookSeconds, script, shotPlan, caption, templateHint, contentType, videoLengthSec, filmingTimeMin, whyItWorks, payoffType, hasContrast, hasVisualAction, visualHook } ] }`,
    `Remember: every hook ≤8 words HARD; videoLengthSec ∈ [15,25]; filmingTimeMin ≤30; every idea has payoffType; aim for ≥60% hasContrast and ≥60% hasVisualAction across the batch${region === "western" ? "; western set must hit ≥70% POV/situational" : ""}.`,
  ].join("\n");

  // Output budget: each idea is ~330–420 tokens of structured JSON
  // (rich script + 1–6 shot lines + caption + whyItWorks + 4 quality
  // attribute fields + visualHook + dual time fields). Budget 450 per
  // idea, plus 600 for the array scaffold. Capped at 8190 — within
  // Haiku 4.5's 8192 output cap. For count=15 this lands at ~7350,
  // count=17 hits the cap and the partial-recovery path takes over.
  const maxTokens = Math.min(600 + count * 450, 8190);

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
    // Partial-recovery path: when Haiku's output tops out mid-array,
    // callJsonAgent throws an Error carrying `.rawText` with the full
    // raw model output. Salvage every COMPLETE, schema-valid idea
    // object from the truncated stream.
    const rawText = (err as { rawText?: string } | null)?.rawText;
    const recovered = rawText ? recoverPartialIdeas(rawText) : [];
    if (recovered.length === 0) throw err;
    out = { ideas: recovered };
  }

  // Defensive numeric clipping. We deliberately do NOT silently truncate
  // hook words anymore — that destroyed meaning when the model returned
  // an 11-word twist. The schema's .refine() drops over-long hooks; the
  // recovery path salvages the rest of the batch.
  const ideas = out.ideas.map((i) => ({
    ...i,
    hookSeconds: Math.min(i.hookSeconds, 3),
    videoLengthSec: Math.min(Math.max(Math.round(i.videoLengthSec), 15), 25),
    filmingTimeMin: Math.min(Math.max(Math.round(i.filmingTimeMin), 1), 30),
  }));

  return { ideas };
}

/**
 * Best-effort recovery of complete idea objects from a Haiku response
 * that got truncated mid-stream. Walks the raw text with a
 * string-aware brace counter (so braces inside JSON string literals
 * don't throw off depth), extracts each top-level `{...}` block
 * inside the `"ideas": [...]` array, then JSON-parses + zod-validates
 * each one. Malformed or partial objects (the final one if truncation
 * happened mid-object) are silently dropped.
 *
 * Returns [] when nothing is salvageable, in which case the caller
 * re-throws the original error rather than returning silent zero.
 */
function recoverPartialIdeas(rawText: string): Idea[] {
  const arrStart = rawText.indexOf('"ideas"');
  if (arrStart < 0) return [];
  const bracketStart = rawText.indexOf("[", arrStart);
  if (bracketStart < 0) return [];

  const recovered: Idea[] = [];
  let depth = 0;
  let objStart = -1;
  let inStr = false;
  let escape = false;
  for (let i = bracketStart + 1; i < rawText.length; i++) {
    const ch = rawText[i]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === "{") {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && objStart >= 0) {
        const blob = rawText.slice(objStart, i + 1);
        try {
          const parsedObj = JSON.parse(blob);
          const result = ideaSchema.safeParse(parsedObj);
          if (result.success) recovered.push(result.data);
        } catch {
          // skip malformed; the final object is most likely truncated
        }
        objStart = -1;
      } else if (depth < 0) {
        // we walked past the array's closing ]
        break;
      }
    } else if (ch === "]" && depth === 0) {
      break;
    }
  }
  return recovered;
}
