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
  /**
   * Pattern-first generation (post-MVP trust gate). The model MUST
   * pick a known short-form pattern BEFORE drafting the rest of the
   * idea — this is the single biggest lever on "would you post
   * this" because pattern-anchored ideas are inherently visualizable
   * and inherently low-interpretation. Five canonical patterns:
   *   • pov                       — POV scenario ("POV: roommate asks…")
   *   • reaction                  — visible reaction to a stimulus
   *   • before_after              — visible transformation / contrast
   *   • expectation_vs_reality    — split or sequential contrast
   *   • observational_confessional — "me when…" / self-deprecating to-camera
   * If an idea doesn't fit one of these five, it shouldn't ship.
   */
  pattern: z.enum([
    "pov",
    "reaction",
    "before_after",
    "expectation_vs_reality",
    "observational_confessional",
  ]),
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
  /**
   * Trust-gate display fields (post-MVP). Surfaced directly on the
   * idea card so the user sees CONCRETELY what they'd shoot before
   * tapping in. These are the user-facing trust signals — vague
   * here = we lose the post-worthiness uplift.
   *   whatToShow — scene-by-scene of what's literally on screen,
   *                in plain English, beat by beat.
   *   howToFilm  — concrete filming instructions: where you sit /
   *                stand, where the phone goes, single take vs cuts,
   *                lighting if relevant. Should read like a friend
   *                walking you through it.
   */
  whatToShow: z.string().min(20).max(500),
  howToFilm: z.string().min(15).max(400),
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
    // QA-driven uplift (target: 70% → 85%+ "would you post this").
    // The 30% failure mode in real outputs was almost entirely
    // ideas that were "topics about X" rather than "a specific
    // moment". This gate is highest-priority — it runs BEFORE the
    // existing per-batch quality rules (A–E), and applies globally
    // (not just western).
    // QA-driven, post-MVP trust gate. The single biggest lever on
    // "would you post this" is forcing the model to pick a known,
    // recognisable pattern BEFORE drafting any other field —
    // pattern-anchored ideas are inherently visualizable and
    // inherently low-interpretation. This block runs FIRST so the
    // pattern choice frames every other decision.
    "PATTERN-FIRST GENERATION (HARD, 100% of ideas — apply this BEFORE the gate below):",
    "  Step 1 — PICK ONE of these five canonical short-form patterns. Do this BEFORE you write the hook. Declare your choice in the `pattern` field.",
    "    • pov                       → POV scenario. Camera is the viewer. Hook starts \"POV:\" or \"When your…\". Specific, observable situation. Examples: \"POV: roommate asks if you're mad\", \"When your barista remembers you\".",
    "    • reaction                  → A visible reaction to a stimulus (a text, a photo, a memory, a thought, a sound). Hook tees up what triggers it. The payoff IS the face/body reaction. Examples: \"When mom sends THE screenshot\", \"Reading old texts at 2am\".",
    "    • before_after              → Visible transformation between two states (a room, an outfit, a meal, your own face/energy). Hook teases the reveal. Examples: \"My desk before the deadline\", \"Outfit at 8am vs 8pm\".",
    "    • expectation_vs_reality    → Split-screen or sequential contrast between what was planned/promised and what actually happened. Hook names the expectation. Examples: \"How I described my workout vs the actual workout\", \"My meal-prep plan vs what I ate\".",
    "    • observational_confessional → To-camera \"me when…\" / self-deprecating confession about a small everyday behaviour. Hook is the confession. Examples: \"Me lying about how often I cook\", \"Me opening my bank app then immediately closing it\".",
    "  Step 2 — Write the hook (≤8 words) so it CLEARLY signals the pattern in the first 3 seconds. The viewer must know within 3 seconds what kind of video this is.",
    "  Step 3 — Fill in `whatToShow` (scene-by-scene of what's literally on screen — talk through it like a friend) and `howToFilm` (concrete shooting instructions — where you sit, where the phone goes, single take vs cuts, props in arm's reach). These two fields are the trust signals shown on the card. If you can't write `whatToShow` in plain English without using the word \"something\", \"maybe\", or \"like…\", the pattern wasn't specific enough — restart from Step 1.",
    "  If you can't make an idea fit one of the five patterns above, DROP it and pick a different angle. Do NOT invent new patterns or stretch the definitions.",
    "",
    "VISUALIZABILITY GATE (HARD, 100% of ideas — applies BEFORE rules A–E):",
    "  Every idea MUST be a SPECIFIC MOMENT a viewer can picture instantly from the hook alone — zero interpretation, zero inference, zero 'figure it out'.",
    "  Apply this test BEFORE submitting each idea: after reading the hook, can you describe in one sentence exactly what is on screen in the first 3 seconds (where the creator is, what they're doing, what's happening)? If the answer requires 'it depends', 'something like…', or 'maybe they…', the idea FAILS the gate. Rewrite or replace it.",
    "  Every idea must map to a known short-form pattern — POV scenario, reaction/expression, before↔after contrast, expectation vs reality, observational confessional. If you can't name the pattern, it fails.",
    "",
    "  HARD BAN — these patterns are PROHIBITED for all regions (they consistently underperform on 'would you post this'):",
    "    ✗ ADVICE — \"You should…\", \"Try this…\", \"Tips for…\", \"How to…\", \"X things to do when…\", \"Stop doing X, start doing Y\" (instructional framing).",
    "    ✗ MOTIVATIONAL — \"Reminder that…\", \"You're enough\", \"Trust the process\", \"Show up for yourself\", \"Glow up\", \"Mindset shift\", \"Manifest…\", \"Your sign to…\".",
    "    ✗ \"TALK ABOUT\" prompts — \"Let's talk about…\", \"We need to discuss…\", \"Can we talk about how…\", \"Storytime about feelings\", or any framing where the entire video is the creator monologuing ABOUT a topic with no concrete observable scene.",
    "    ✗ ABSTRACT concepts as the subject — Confidence, Authenticity, Self-love, Energy, Boundaries, Healing, Growth, Purpose, Worthiness, Alignment. These words may appear inside a concrete scene (\"POV: setting a boundary with your mom about Sunday dinner\") but NEVER as the standalone topic (\"Why boundaries matter\").",
    "    ✗ Vague \"things\" lists with no concrete visual — \"Things that matter\", \"Things I wish I knew\", \"Things you should hear\". Every list-style hook needs a CONCRETE TANGIBLE referent (\"Things only oldest siblings actually do\", \"Things in my fridge that have no business being there\").",
    "  If an idea drifts into any banned pattern, scrap it and pick a different angle — do NOT try to salvage it with a tweak.",
    "",
    "  PREFERRED MOMENT TYPES (lean heavily on these — they win on 'would you post this'):",
    "    ✓ AWKWARD moments — accidentally waving back at someone who wasn't waving at you, talking over a server, holding a door open way too long, forgetting a friend's partner's name mid-conversation, the elevator small-talk that goes on one floor too many, accidentally liking a 2-year-old IG post.",
    "    ✓ BROKE / TIRED / LAZY scenarios — microwaving the same coffee 3 times, pretending to know which wine to order, eating dinner standing up at the counter, \"I need to do laundry but I'm just gonna re-wear this\", checking your bank app then immediately closing it, the 'I'll just nap for 15 minutes' lie.",
    "    ✓ SMALL DAILY FRUSTRATIONS — wifi dropping mid-Zoom, the one earbud that's always quieter, cashier calling the next person before you've packed your bag, AirPods dying right when you start working out, the \"reply all\" panic, finding the snack aisle has been rearranged.",
    "    ✓ SELF-DEPRECATING confessional — \"me lying about how often I cook\", \"my LinkedIn vs my actual work day\", \"how I describe my workout vs what I actually did\", \"the version of me I show on dates\", \"my Spotify Wrapped vs my personality\".",
    "  These four types are the safest bets — when in doubt, pick one. They map cleanly onto POV / reaction / contrast / 'me when' patterns and require zero setup beyond pointing the phone at yourself.",
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
    "  E. LOW-EFFORT BIAS (HARD, ≥50% of batch): At least HALF the ideas must be filmable from the couch / bed / kitchen counter / car — sitting or lying down, no setup, no props beyond what's already at arm's reach, no second location, no outfit change. The creator should be able to start filming within 10 seconds of picking up their phone.",
    "     PREFERRED low-effort patterns (use these heavily):",
    "       ✓ Stays seated or in one spot the whole time",
    "       ✓ Zero props or props already in hand (phone, snack, drink, pet, blanket)",
    "       ✓ The 'shoot' is essentially: prop phone, talk or react, hit stop",
    "       ✓ Relatable micro-moments — texting, scrolling, pet noises, snack runs, mid-task pauses, group-chat reactions, things-you-do-when-no-one's-watching",
    "       ✓ Talking-head reactions to a thought, message, memory, or observation",
    "     AVOID for the low-effort half: outfit changes, location changes, multiple actors, choreography, food prep that takes >2 min, anything needing a tripod or second pair of hands, anything that requires getting up from the couch. If an idea needs more than 'pick up phone and shoot', it does NOT count toward the 50%.",
    "     The remaining ≤50% can require slightly more setup (a quick prop swap, a walk to another room, simple before/after) but NEVER more than the 30-minute total filming cap.",
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
    "  pattern ('pov' | 'reaction' | 'before_after' | 'expectation_vs_reality' | 'observational_confessional' — picked FIRST per Step 1 above),",
    "  hook (≤8 words HARD CAP — count them, rewrite if over),",
    "  hookSeconds (number 0.5–3, your estimate of how long the hook lands),",
    "  whatToShow (string 20–500 chars — scene-by-scene of what's literally on screen, plain English, beat by beat. Example: \"You're sitting on the couch holding your phone. Your face shows fake confusion as you look at the screen. Cut to over-the-shoulder of the screen showing mom's text in caps. Cut back to your slow-motion sigh.\"),",
    "  howToFilm (string 15–400 chars — concrete filming instructions. Where you sit/stand, where the phone goes, single take vs cuts, what props are needed and they're already in arm's reach. Example: \"Sit on the couch. Prop phone on a stack of books on the coffee table at chest height. One continuous take — no cuts. Have your actual phone in hand for the screen reaction.\"),",
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
    `{ "ideas": [ { pattern, hook, hookSeconds, whatToShow, howToFilm, script, shotPlan, caption, templateHint, contentType, videoLengthSec, filmingTimeMin, whyItWorks, payoffType, hasContrast, hasVisualAction, visualHook } ] }`,
    `Remember: every hook ≤8 words HARD; videoLengthSec ∈ [15,25]; filmingTimeMin ≤30; every idea has payoffType; aim for ≥60% hasContrast and ≥60% hasVisualAction across the batch${region === "western" ? "; western set must hit ≥70% POV/situational" : ""}.`,
    `PATTERN-FIRST — pick one of {pov, reaction, before_after, expectation_vs_reality, observational_confessional} BEFORE writing the hook. If the idea won't fit a pattern, scrap it.`,
    `VISUALIZABILITY GATE — for EACH idea ask "can I picture exactly what's on screen in the first 3s?". If not, scrap it. NO advice / motivational / "talk about" / abstract-concept hooks. Lean on awkward, broke/tired/lazy, small daily frustrations, and self-deprecating moments — they win.`,
    `whatToShow + howToFilm are USER-FACING trust signals — they go on the card. Be concrete, plain-English, no "something" / "maybe" / "like…".`,
  ].join("\n");

  // Output budget: each idea is ~480–600 tokens of structured JSON
  // (rich script + 1–6 shot lines + caption + whyItWorks + 4 quality
  // attribute fields + visualHook + dual time fields + the new
  // pattern + whatToShow + howToFilm trust-gate fields). Budget 620
  // per idea, plus 600 for the array scaffold. Capped at 8190 —
  // within Haiku 4.5's 8192 output cap. For count=3 (Home) this is
  // ~2460 — well under cap; for count=12 it hits ~8040 — recovery
  // path handles any truncation past that.
  const maxTokens = Math.min(600 + count * 620, 8190);

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
  const clip = (i: Idea): Idea => ({
    ...i,
    hookSeconds: Math.min(i.hookSeconds, 3),
    videoLengthSec: Math.min(Math.max(Math.round(i.videoLengthSec), 15), 25),
    filmingTimeMin: Math.min(Math.max(Math.round(i.filmingTimeMin), 1), 30),
  });
  const ideas: Idea[] = out.ideas.map(clip);

  // Count-guarantee top-up. Real-world cause: a single idea with a
  // 9-word hook (or any other refine-failing field) makes the whole
  // response fail strict schema parse, falling into recoverPartialIdeas
  // which only returns COMPLETE objects — net result: home renders 1
  // or 2 ideas instead of 3. We resolve by issuing ONE small follow-up
  // call asking only for the deficit, with the existing hooks listed
  // as hard "do-not-overlap". Stays inside the same quota slot — the
  // outer route consumed quota once for this whole generateIdeas call.
  if (ideas.length < count) {
    const deficit = count - ideas.length;
    const existingHooks = ideas.map((i) => `"${i.hook}"`).join(", ");
    // Observability — track real-world undercount frequency from
    // workflow logs without spinning up a metrics pipeline. We log
    // BEFORE the top-up so we capture the deficit even when the
    // top-up call itself throws. The post-top-up `final` count is
    // logged below so we can tell the two failure modes apart
    // (initial undercount that recovered vs. persistent undercount).
    console.warn(
      `[ideator] undercount before top-up — region=${region} requested=${count} got=${ideas.length} deficit=${deficit}`,
    );
    const topUpUser = [
      `=== CREATOR STYLE PROFILE ===`,
      profileSummary(profile),
      "",
      `=== REGION CONTEXT ===`,
      compactBundle(bundle),
      "",
      `=== TASK ===`,
      `Produce ${deficit} ADDITIONAL ideas. They MUST NOT overlap with these existing ideas: ${existingHooks || "(none)"}. Use clearly different angles, contentTypes, or formats.`,
      `Return strictly:`,
      `{ "ideas": [ { pattern, hook, hookSeconds, whatToShow, howToFilm, script, shotPlan, caption, templateHint, contentType, videoLengthSec, filmingTimeMin, whyItWorks, payoffType, hasContrast, hasVisualAction, visualHook } ] }`,
      `Remember: every hook ≤8 words HARD CAP — count words, rewrite if over; videoLengthSec ∈ [15,25]; filmingTimeMin ≤30; every idea has payoffType. PATTERN-FIRST — pick one of {pov, reaction, before_after, expectation_vs_reality, observational_confessional} before writing the hook. Apply the LOW-EFFORT BIAS rule AND the VISUALIZABILITY GATE: each idea must be a specific picturable moment. NO advice, motivational, "talk about", or abstract-concept hooks. Awkward / broke / tired / lazy / small daily frustration / self-deprecating moments win. whatToShow + howToFilm are user-facing trust signals — be concrete, plain-English, no "something" / "maybe".`,
    ].join("\n");
    try {
      const topUp = await callJsonAgent({
        ctx: {
          creatorId: input.ctx?.creatorId ?? null,
          agentRunId: input.ctx?.agentRunId ?? null,
          agent: "ideator",
        },
        schema: responseSchema,
        system,
        user: topUpUser,
        maxTokens: Math.min(600 + deficit * 620, 8190),
      });
      const extra = topUp.ideas.slice(0, deficit).map(clip);
      ideas.push(...extra);
    } catch (err) {
      // Top-up failed (rate limit, schema fail again, etc.) — return
      // what we already have rather than throw the whole batch away.
      // Caller will see ideas.length < count, but we never block the
      // user's home screen on this best-effort retry.
      const rawText = (err as { rawText?: string } | null)?.rawText;
      if (rawText) {
        const recovered = recoverPartialIdeas(rawText)
          .slice(0, deficit)
          .map(clip);
        if (recovered.length > 0) ideas.push(...recovered);
      }
    }
    // Paired follow-up log so we can tell the two failure modes
    // apart in workflow logs: deficit=2 final=3 (recovered fully)
    // vs deficit=2 final=1 (top-up itself failed and we shipped
    // the partial batch).
    console.warn(
      `[ideator] undercount after top-up — region=${region} requested=${count} final=${ideas.length}`,
    );
  }

  return { ideas: ideas.slice(0, count) };
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
