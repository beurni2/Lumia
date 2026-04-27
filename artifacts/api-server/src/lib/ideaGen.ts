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
 *       - hookSeconds ≤ 2 (idea must be understandable in <2s)
 *       - hook word count ≤ 8 (HARD — clamped on output)
 *       - videoLengthSec ∈ [15,25] (target final length)
 *       - filmingTimeMin ≤ 30 (idea must be shootable in <30 minutes)
 *
 * STRUCTURE — TRIGGER-REACTION:
 * Every idea is built as Trigger → Reaction. The trigger is a
 * SPECIFIC ACTION the creator does on screen (open / check / read /
 * scroll / watch / find / notice / realize). The reaction is a
 * VISIBLE EMOTIONAL RESPONSE (face, pause, expression, body
 * language). Ideas that don't clearly contain BOTH are rejected at
 * the schema level (`trigger` + `reaction` are required strings)
 * and at the prompt level (the model is told to drop them rather
 * than ship them). The pattern enum (pov / reaction / mini_story /
 * contrast) is the SHAPE; trigger+reaction is the STRUCTURAL UNIT
 * that lives inside it.
 *
 * QUALITY — EMOTIONAL SPIKE:
 * Every idea must hit ONE of five emotional spikes — embarrassment,
 * regret, denial, panic, irony. Declared in `emotionalSpike`.
 * Weak/diffuse emotion = rejected. The five-spike palette is
 * deliberately tight: these are the spikes that consistently land
 * on short-form (vs broader emotions like "joy" / "sadness" which
 * read as generic). NOTE: `denial` (telling-yourself-it's-fine,
 * refusing-to-acknowledge) replaced the prior `confusion` slot —
 * denial carries built-in internal contradiction, which is the
 * tension hook generation now explicitly requires.
 *
 * QUALITY — HOOK CRAFT:
 * For each idea the model internally generates 3–5 hook variations
 * across five hook formats (Behavior / Thought / Moment / Contrast /
 * Curiosity), filters them through emotion-clarity + TENSION +
 * natural-language + 1-second-rule gates, and SELECTS the strongest
 * one to emit. Only the winner is emitted in `hook`. The selection
 * rule is "which one would I actually stop scrolling for?".
 *
 * SAFETY — SENSITIVE / PRIVATE CONTENT:
 * Ideas that require exposing the creator's real private data on
 * screen are banned globally — bank apps / balances / medical info /
 * real conversation screenshots / addresses / IDs / passwords /
 * salary. The trigger and reaction must be performable WITHOUT
 * exposing the creator's actual private information.
 *
 * VARIETY — BATCH-LEVEL DIVERSITY:
 * Within any 3 ideas, no two may share the same `triggerCategory`
 * (phone_screen / message / social / environment / self_check /
 * task) and any two ideas must differ in at least TWO of three
 * dimensions: `pattern`, `setting` (bed / couch / desk / bathroom
 * / kitchen / car / outside / other), `emotionalSpike`. This is
 * what produces "perceived variety" — three ideas that all hit
 * different categories feel fresh; three that bunch up feel
 * formulaic, even if each individual idea is strong.
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
import { db, schema } from "../db/client";
import { logger } from "./logger";
import { eq } from "drizzle-orm";
import {
  computeFormatDistribution,
  countProducedByPattern,
  formatDeficitDistributionPromptBlock,
  formatDistributionPromptBlock,
} from "./formatDistribution";
import { DEFAULT_STYLE_PROFILE, type StyleProfile } from "./styleProfile";
import {
  distributionFloorFromCalibration,
  parseTasteCalibration,
  tasteCalibrationPromptBlock,
} from "./tasteCalibration";
import {
  computeViralPatternMemory,
  EMPTY_MEMORY,
  renderViralMemoryPromptBlock,
  type ViralPatternMemory,
} from "./viralPatternMemory";

export const ideaSchema = z.object({
  /**
   * Pattern-first generation (post-MVP trust gate). The model MUST
   * pick a known short-form pattern BEFORE drafting the rest of the
   * idea — this is the single biggest lever on "would you post this
   * WITHOUT changing it much" because pattern-anchored ideas are
   * inherently visualizable and inherently low-interpretation.
   *
   * Final synthesis: collapsed to four canonical patterns. The
   * previous five-pattern set folded `before_after` and
   * `expectation_vs_reality` into a single `contrast` bucket
   * (they're functionally identical — both are visible
   * two-state comparisons), and renamed `observational_confessional`
   * to `mini_story` (broader, includes the to-camera confessional
   * but also any micro-narrative with a beginning-middle-end beat).
   *
   *   • pov        — POV scenario ("POV: roommate asks…", camera as viewer)
   *   • reaction   — visible reaction to a stimulus (text, sound, photo)
   *   • mini_story — micro-narrative with setup → moment → payoff (15–25s)
   *   • contrast   — visible two-state comparison (before/after, plan/reality)
   *
   * If an idea doesn't fit one of these four, it shouldn't ship.
   */
  pattern: z.enum(["pov", "reaction", "mini_story", "contrast"]),
  /**
   * HOOK LENGTH POLICY (softened from a flat 8-word cap).
   * - Target: ≤8 words.
   * - Hard ceiling: 10 words. Strong hooks at 9–10 words are
   *   allowed when they still land within the 1-second rule and
   *   feel natural / spoken (not slow or padded).
   * - The prompt instructs the model to prefer ≤8 and only stretch
   *   to 9–10 when trimming would visibly hurt the hook. The
   *   schema enforces only the absolute ceiling so we never reject
   *   a strong hook purely on word count.
   */
  hook: z
    .string()
    .min(2)
    .max(120)
    .refine((h) => h.trim().split(/\s+/).length <= 10, {
      message: "hook must be ≤10 words (target ≤8)",
    }),
  hookSeconds: z.number().min(0.5).max(3),
  /**
   * TRIGGER-REACTION STRUCTURE (critical post-synthesis update).
   * Every idea must be built as Trigger → Reaction. These two
   * required fields force the model to articulate them BEFORE
   * fleshing out the rest of the idea — if the model can't name
   * a clear trigger and a visible emotional reaction, the idea
   * fails schema validation and is dropped.
   *
   *   trigger  — the SPECIFIC ACTION the creator does on screen
   *              (open the bank app, check ex's instagram, read
   *              mom's text, scroll past your old photo, watch
   *              the cashier subtotal climb). Verbs to lean on:
   *              open / check / read / scroll / watch / find /
   *              notice / realize / hear / see / do.
   *   reaction — the VISIBLE EMOTIONAL RESPONSE that follows
   *              (frozen face slow blink, eyes widen then dart
   *              away, sigh that turns into a laugh, slow head
   *              shake, lip-bite, the "oh no" face). Must be
   *              FILMABLE on the creator's own face/body — not
   *              an internal feeling, not a thought, not narrated.
   */
  trigger: z.string().min(5).max(140),
  reaction: z.string().min(5).max(140),
  /**
   * EMOTIONAL SPIKE (per-idea quality gate). Every idea must hit
   * one of five spikes that consistently land on short-form. The
   * model declares which spike the idea targets; ideas where the
   * model can't pin to one of these (i.e. emotion is weak/diffuse)
   * fail validation and are dropped.
   *   • embarrassment — caught out, exposed, busted, awkward
   *   • regret        — wishing-you-hadn't, "why did I do that"
   *   • denial        — telling-yourself-it's-fine, lying-by-omission
   *   • panic         — small-stakes alarm, quiet freakout
   *   • irony         — said-one-thing-did-another, hypocrisy noticed
   */
  emotionalSpike: z.enum([
    "embarrassment",
    "regret",
    "denial",
    "panic",
    "irony",
  ]),
  /**
   * TRIGGER CATEGORY (per-batch variety gate). Coarse classification
   * of the trigger so the batch-level variety rule can enforce
   * "max 1 per category per 3 ideas". Six categories chosen to
   * cover ~all short-form triggers without splitting hairs:
   *   • phone_screen — opening apps, scrolling, refreshing, screen-tap
   *   • message      — receiving text/notification/DM/email/call
   *   • social       — someone IRL interacts with you (asks/walks-in/calls-out)
   *   • environment  — noticing/witnessing something in your surroundings
   *   • self_check   — mirror, body, appearance, weighing self
   *   • task         — doing a physical action (cooking, packing, getting dressed)
   */
  triggerCategory: z.enum([
    "phone_screen",
    "message",
    "social",
    "environment",
    "self_check",
    "task",
  ]),
  /**
   * SETTING (per-batch variety gate). Where the video is shot.
   * Used to enforce variety at the batch level alongside `pattern`
   * and `emotionalSpike`.
   */
  setting: z.enum([
    "bed",
    "couch",
    "desk",
    "bathroom",
    "kitchen",
    "car",
    "outside",
    "other",
  ]),
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
  /**
   * Optional Taste Calibration document (raw `creators.taste_calibration_json`
   * jsonb value). When provided, we use it directly and skip the in-function
   * SELECT — preferred path because the calling route has already loaded
   * the full creator row via `resolveCreator`. Pass `undefined` (not
   * `null`!) to opt back into the legacy SELECT-by-creatorId fallback.
   * `null` means "we know this creator has not filled out the step".
   */
  tasteCalibrationJson?: unknown | null;
  /**
   * Optional pre-computed viral-pattern memory snapshot. When omitted,
   * `generateIdeas` calls `computeViralPatternMemory(ctx.creatorId)`
   * itself — cheap (capped at 50 rows per table) so it's safe to let
   * the ideator do its own load. Pass `EMPTY_MEMORY` to opt out (e.g.
   * for an admin tool that wants to see the un-biased baseline).
   */
  viralPatternMemory?: ViralPatternMemory;
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

  // Optional Taste Calibration (per-creator). The calibration
  // document is the result of the 5-question onboarding step (see
  // components/onboarding/TasteCalibration.tsx); creators who
  // skipped the step persist {skipped: true}, and creators who never
  // hit the step have a NULL row. Either case falls back to platform
  // defaults everywhere downstream. Treated as INITIAL bias only —
  // feedback signals still override over time.
  //
  // Preferred path: the calling route (e.g. routes/ideator.ts) has
  // already loaded the full creator row via resolveCreator, so it
  // passes the raw jsonb value in `input.tasteCalibrationJson` and
  // we skip the SELECT entirely. Fallback path (back-compat for
  // callers that haven't been updated, e.g. internal tools): if the
  // field is `undefined` AND we have a creatorId, do a single
  // PK-keyed SELECT. We never throw — the ideator must always ship
  // ideas even if calibration lookup blows up.
  let tasteCalibration: ReturnType<typeof parseTasteCalibration> = null;
  if (input.tasteCalibrationJson !== undefined) {
    tasteCalibration = parseTasteCalibration(input.tasteCalibrationJson);
  } else if (input.ctx?.creatorId) {
    try {
      const [row] = await db
        .select({
          tasteCalibrationJson: schema.creators.tasteCalibrationJson,
        })
        .from(schema.creators)
        .where(eq(schema.creators.id, input.ctx.creatorId))
        .limit(1);
      tasteCalibration = parseTasteCalibration(row?.tasteCalibrationJson);
    } catch {
      // The ideator must never block on a calibration read — a
      // missing column or a stale connection should fall back to
      // "no calibration" so the user still gets ideas.
      tasteCalibration = null;
    }
  }
  const calibrationBlock = tasteCalibrationPromptBlock(tasteCalibration);
  const distributionFloor = distributionFloorFromCalibration(tasteCalibration);

  // Viral pattern memory — the per-creator "winning structures" bias
  // that layers on top of calibration. Calibration is INITIAL bias
  // (from the 5-question onboarding); memory is LEARNED bias (from
  // recent feedback + action signals). The memory block, when
  // present, tells the model which patterns/spikes/payoffs/hook-styles
  // to lean into and which to avoid; the VARIATION INJECTION block
  // (see system prompt) simultaneously forces the SURFACE scenario
  // to stay fresh. Together: same winning STRUCTURE, fresh
  // SCENARIOS — which is the entire point of the loop.
  //
  // Like calibration, memory load NEVER throws — the helper itself
  // returns EMPTY_MEMORY on any error, and an empty snapshot
  // collapses to no prompt block (renderViralMemoryPromptBlock
  // returns null when sampleSize < 3).
  let viralPatternMemory: ViralPatternMemory =
    input.viralPatternMemory ?? EMPTY_MEMORY;
  if (input.viralPatternMemory === undefined && input.ctx?.creatorId) {
    // Defense-in-depth: computeViralPatternMemory() is contractually
    // never-throw (catches per-source DB errors and returns
    // EMPTY_MEMORY), but if a future regression breaks that contract
    // we MUST NOT fail idea generation — memory is an optional bias
    // signal, not a hard dependency. Fall back to EMPTY_MEMORY on any
    // unexpected throw so the variation block + calibration block
    // still steer the batch.
    try {
      viralPatternMemory = await computeViralPatternMemory(
        input.ctx.creatorId,
      );
    } catch (err) {
      logger.warn(
        { err, creatorId: input.ctx.creatorId },
        "[ideaGen] viral_pattern_memory_load_failed_using_empty",
      );
      viralPatternMemory = EMPTY_MEMORY;
    }
  }
  const memoryBlock = renderViralMemoryPromptBlock(viralPatternMemory);

  // Per-creator format (pattern) distribution. Looks up the recent
  // feedback signal for this creator and computes a target mix of
  // {pov, reaction, mini_story, contrast}. New / no-feedback creators
  // get either the calibration-derived floor (when they filled out
  // the Taste Calibration step) or the conservative platform default
  // (`mini_story 40 / reaction 40 / pov 20 / contrast 0`). Feedback
  // signal layers on top of whichever floor is in effect — see
  // lib/formatDistribution.ts.
  const distribution = await computeFormatDistribution(
    input.ctx?.creatorId ?? null,
    distributionFloor,
  );
  const distributionBlock = formatDistributionPromptBlock(
    distribution,
    count,
  );

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
          "      ✓ POV scenarios: \"POV: roommate asks if you're mad\", \"POV: refreshed the app and they unmatched\"",
          "      ✓ Direct address with concrete reframe: \"You don't need productivity apps, you need a nap\", \"Stop dressing for who you used to be\"",
          "      ✓ Observational comparison: \"Therapy is just girl-dinner for your brain\"",
          "      ✓ Specific life moments: Trader Joe's run, group chat at 3am, roommate dynamics, dating-app fails, work-from-home absurdities, awkward Zoom calls, parking-lot encounters, drive-thru fails",
          "      ✓ Bold imperative on a specific behavior: \"Stop using Instagram if you want a life\"",
        ].join("\n")
      : "";

  const system = [
    "You are Lumina's Ideator — a sharp, regionally-grounded short-form video strategist for English-speaking 1K–50K micro-creators.",
    "",
    "Your job: produce ideas a real creator can shoot today.",
    "",
    "TRIGGER-REACTION STRUCTURE (HARD, 100% of ideas — apply this BEFORE picking a pattern, BEFORE writing the hook, BEFORE anything else):",
    "  Every idea must be built as Trigger → Reaction. If you can't name BOTH for an idea, DROP IT and pick a different angle. Do NOT try to fudge it.",
    "    • TRIGGER  = a SPECIFIC ACTION the creator does on screen. Use action verbs: open / check / read / scroll / sip / look / watch / find / notice / realize / hear / see / do. Concrete and observable.",
    "      ✓ \"opens her camera roll, lands on yesterday's screenshot\", \"checks her ex's instagram\", \"reads mom's all-caps text\", \"scrolls past her own old photo\", \"watches the cashier subtotal climb\", \"hears the AirPod die mid-sentence\", \"sips coffee, realises it's gone cold\", \"looks at the gym bag she packed yesterday\".",
    "      ✗ \"thinks about money\" (internal — not visible), \"feels overwhelmed\" (state — not action), \"realizes she's been wrong\" (cognitive — needs voiceover to read), \"opens her bank app to check the balance\" (sensitive private data — banned).",
    "    • REACTION = a VISIBLE EMOTIONAL RESPONSE that follows the trigger. Filmable on the creator's own face/body. Specific micro-expression or body beat.",
    "      ✓ \"frozen face, slow blink\", \"eyes widen then dart away\", \"sigh that turns into a laugh\", \"slow head shake, then closes the app\", \"lip-bite, sharp inhale\", \"the 'oh no' face into deadpan stare at camera\".",
    "      ✗ \"feels embarrassed\" (internal), \"realizes the truth\" (cognitive), \"learns a lesson\" (abstract). The reaction must be SHOOTABLE on the creator's face — if you can't direct the actor to do it, it's not a reaction.",
    "    • Articulate both in the `trigger` and `reaction` fields. The schema rejects ideas that omit either.",
    "    • The hook should signal the trigger (\"POV: the cashier reaches for your snack pile\", \"When mom sends THE text\"); the payoff IS the reaction. The viewer reads the trigger in <2s and waits for the reaction.",
    "  This is the single biggest lever on payoff consistency. Pattern is the shape; trigger+reaction is the structural unit inside it.",
    "",
    "EMOTIONAL SPIKE (HARD, 100% of ideas — apply this AFTER trigger+reaction, BEFORE the hook):",
    "  Every idea must hit ONE of these five spikes — declare it in `emotionalSpike`. If you can't pin the emotion to one of these five (i.e. the emotion is mild, diffuse, or generic feel-good), the idea FAILS — drop it.",
    "    • embarrassment → caught out, exposed, busted, awkward in front of someone. \"POV: cashier scans your snack haul slowly\" → the embarrassed mid-blink + fake-casual smile.",
    "    • regret        → wishing-you-hadn't, \"why did I do that\". \"why did I caption my 2019 post like that\" → the slow horror-blink + pulling the phone away from your face.",
    "    • denial        → telling-yourself-it's-fine, refusing to acknowledge what's obvious, the lie-by-omission. \"POV: telling your dentist you floss daily\" → the over-confident smile that immediately falters. \"Me convincing myself this is the last episode\" → the eyes-on-screen + reaching for the remote anyway. Denial carries built-in internal contradiction — perfect for the TENSION the hook needs.",
    "    • panic         → small-stakes alarm, quiet freakout. \"the second I realised I hit reply-all\" → the eyes-go-wide + immediate seek-undo-button.",
    "    • irony         → said-one-thing-did-another, hypocrisy you notice on yourself. \"Me explaining my morning routine vs me hitting snooze 5 times\" → the smug-to-defeated cut.",
    "  These five are deliberately tight. \"Joy\" / \"sadness\" / \"love\" / \"motivation\" / \"confusion\" are NOT options — they read as generic on short-form. If your idea's emotion is one of those, rebuild around a sharper spike or drop it.",
    "  Across a 3-idea batch, vary the spike — don't ship 3 embarrassment ideas in a row.",
    "",
    "HOOK CRAFT (HARD, 100% of ideas — apply this AFTER pattern-first, BEFORE emitting the hook):",
    "  The hook is the single highest-leverage word string in the whole idea. Don't ship the first one that comes to mind. For each idea, INTERNALLY generate 3–5 hook variations, run them through the gates below, and SELECT the strongest. Emit ONLY the winner in the `hook` field — do NOT emit the alternatives.",
    "  Step A — Brainstorm 3–5 hook variations. Use these five hook formats as the starting templates (use ONE per variation; natural variations are fine if a phrasing feels more real-spoken):",
    "    • Behavior  → \"the way I…\"           e.g. \"the way I check the time when someone's already telling me\"",
    "    • Thought   → \"why do I…\"            e.g. \"why do I keep volunteering to host\"",
    "    • Moment    → \"that moment when…\"    e.g. \"that moment when the hold music ends\"",
    "    • Contrast  → \"what I say vs what I do\"  e.g. \"what I tell my therapist vs my actual week\"",
    "    • Curiosity → \"this is where it went wrong\" / \"nobody warned me about…\"  e.g. \"this is where the meal-prep dream died\"",
    "    Natural variations are fine — \"the second I…\", \"me when I…\", \"POV: the moment…\" — the goal is for the hook to feel like something the creator would actually SAY, not a written-out template.",
    "  Step B — Each candidate hook must clear ALL of these gates. Reject any candidate that fails any one:",
    "    1. EMOTION CLEAR — one of the five spikes (embarrassment / regret / denial / panic / irony) is unmistakable in the wording.",
    "    2. TENSION (critical, this is the scroll-stop) — the hook must IMPLY one of: something went wrong / expectation vs reality / internal contradiction / SELF-CALLOUT (you noticing your own pattern out loud) / a SLIGHTLY UNCOMFORTABLE TRUTH (the thing you'd only admit to a close friend). A flat statement of fact (\"My morning routine\") has no tension and is NOT a hook.",
    "    3. NATURAL LANGUAGE — sounds like a text message, not a written sentence. Read it aloud — if it doesn't roll off the tongue, rewrite it.",
    "    4. ONE-SECOND RULE — short and instantly sayable. TARGET ≤8 words; HARD CEILING 10 words. A hook at 9–10 words is allowed ONLY if it still lands within the 1-second rule AND feels natural/spoken (not slow, not padded). If you can trim a word without losing meaning, trim it. But do NOT reject a strong hook purely for being 9–10 words.",
    "    5. NO CLICHÉ TEMPLATE PHRASING — \"It's giving…\", \"the duality of…\", \"in this essay I will…\", \"tell me you're X without telling me\" are out unless the rest of the hook subverts them sharply. Also out: WEAK \"POV you…\" hooks that have no specific observable trigger embedded — \"POV you wake up tired\", \"POV you're at a coffee shop\" are too generic to land. Strong POV hooks NAME the trigger inside the hook (\"POV: roommate asks if you're mad\", \"POV: cashier reaches for your snack pile\"). If your POV hook would work for any random Tuesday, it's not specific enough.",
    "    6. PERSONAL EDGE — the hook must sound like THIS creator could text it to a friend (per the Style Profile above). Generic \"TikTok voice\" fails. Read the candidate in the creator's own voice — if it doesn't fit their cadence, slang, or tone, rewrite it. The same beat sounds different in different voices; that's the whole point.",
    "  ANTI-NEUTRAL HOOK FILTER (HARD — applies after the 6 gates above; runs as a final pass BEFORE every emit):",
    "    Hooks that DESCRIBE a situation in neutral observer-voice are AUTO-REJECTED. They feel like captions, not thoughts. They don't create tension; they just narrate.",
    "    AUTO-REJECT PREFIX CHECK (NO carve-out, NO exceptions — run this as the very last thing before emitting). Lowercase the candidate hook and check its FIRST WORDS. If it starts with any of these, REWRITE it into a thought-voice / reaction-voice opener — DO NOT emit the original:",
    "      ✗ \"when you …\"            (generic second-person — describes the situation, not the reaction)",
    "      ✗ \"POV: you …\"            (generic POV — strong POV NAMES the trigger, e.g. \"POV: roommate asks if you're mad\". \"POV: your X\" / \"POV: the X\" / \"POV: someone X\" are FINE; \"POV: you [verb/feeling]\" is NEVER fine)",
    "      ✗ \"reading …\"             (caption voice — describes what's on screen instead of reacting to it)",
    "      ✗ \"watching …\"            (observer voice — the hook should BE the reaction, not describe the act of looking)",
    "      ✗ \"you open …\"            (instructional second-person — narrates an action without any internal voice)",
    "    REWRITE TARGETS — convert the banned shape into one of the thought/reaction voices below (these are the same shapes that pass the 5-point check):",
    "      \"when you realize the leftovers are gone\" → REWRITE as \"the way I just stared into the empty fridge\" (Behavior, regret) OR \"who finished my leftovers\" (Thought, panic).",
    "      \"watching my screen time stat load\" → REWRITE as \"why did I check my screen time\" (Thought, regret) OR \"the way I just hid that screen time number\" (Behavior, embarrassment).",
    "      \"reading my ex's new bio\" → REWRITE as \"why did I just open his profile\" (Thought, regret) OR \"the way I scrolled to his page on autopilot\" (Behavior, regret).",
    "    The rewrite is mandatory if the prefix check fires. If the rewrite still feels neutral or weak, DROP THE WHOLE IDEA — never ship a banned-prefix hook.",
    "    PREFER thought-/reaction-voice openers — these sound like a real thought you'd text a friend the second it happened:",
    "      ✓ \"why did I…\"             e.g. \"why did I just say that out loud\"",
    "      ✓ \"the way I…\"             e.g. \"the way I check the time when someone's already telling me\"",
    "      ✓ \"I really just…\"         e.g. \"I really just nodded along like I knew what they meant\"",
    "      ✓ \"this just ruined…\"      e.g. \"this just ruined my whole afternoon\"",
    "      ✓ \"I thought this was fine…\"  e.g. \"I thought this was fine and now my stomach hurts\"",
    "    5-POINT CHECK (every emitted hook must pass ALL FIVE — this is a final sanity pass, separate from the 6 gates above):",
    "      1. Emotion is CLEAR (one of the five spikes lands without needing context).",
    "      2. Tension EXISTS (something went wrong / contradiction / self-callout — never a flat description).",
    "      3. Sounds like a TEXT MESSAGE (not a caption, not a slogan, not a tweet about a topic).",
    "      4. Can be SAID IN 1 SECOND (read it aloud — if it stalls or drags, it fails).",
    "      5. Feels PERSONAL (something THIS creator would say in THEIR voice — not generic short-form voice).",
    "    REWRITE-OR-DROP RULE: if a candidate hook fails the auto-reject filter or the 5-point check, REWRITE IT into a thought/reaction-voice version. If after rewrite it STILL feels neutral or weak, DROP THE WHOLE IDEA — don't ship a neutral hook to save a slot. The bar: every hook you emit should feel like something the creator would text a friend, not a caption they'd post.",
    "    If none of your 3–5 candidates can clear ALL the gates, the IDEA itself is the problem — go back to the trigger-reaction step and pick a different angle. Do not ship a weak hook to save the idea.",
    "  Step C — Select the ONE best candidate. Selection rule: \"Which one would I actually stop scrolling for?\". Pick the hook that:",
    "    • feels most real (sounds like a friend texting, not a brand)",
    "    • has the strongest tension (the biggest implied \"wait, what?\")",
    "    • reads fastest (lands in <2s, ≤8 words ideal, 10 max)",
    "    • signals the trigger most clearly",
    "  Emit ONLY the selected hook. The alternatives stay in your head.",
    "",
    "Each idea must obey THREE HARD CONSTRAINTS:",
    "  1. FILMING TIME ≤30 MINUTES end-to-end — single location, props the creator already owns, no actors beyond the creator and (optionally) one friend, no expensive setups. Declare in `filmingTimeMin`.",
    "  2. TARGET VIDEO LENGTH 15–25 SECONDS — short-form sweet spot for retention; not a TikTok story, not a Reel essay. Declare in `videoLengthSec`.",
    "  3. UNDERSTANDABLE IN <2 SECONDS — the hook must land within 2 seconds of audio. TARGET ≤8 words; HARD CEILING 10 words. The viewer should know what kind of video this is and what's about to happen before the third second hits. Count the words. \"POV:\" is 1 word. \"When your\" is 2 words. Examples that PASS: \"POV: roommate asks if you're mad\" (6 words) · \"When your barista remembers you\" (5 words) · \"Things younger siblings just get\" (5 words) · \"the way I check the time when someone's already telling me\" (10 words — passes because it reads fast and feels natural). Examples that FAIL — REWRITE THESE: \"Have you ever felt invisible at parties?\" (8 words but abstract introspective — banned), any hook past 10 words, any hook whose meaning takes 3 seconds to land. The 1-second rule (does this read fast and feel natural?) trumps raw word count — do NOT reject a strong hook purely because it's 9 or 10 words, but DO trim if you can without losing meaning. Anything past 10 words: REWRITE.",
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
    "PATTERN-FIRST GENERATION (HARD, 100% of ideas — apply this AFTER you've named your trigger+reaction, BEFORE the gate below):",
    "  Step 1 — Once you have a trigger+reaction pair, PICK ONE of these four canonical short-form patterns as the SHAPE that holds it. Declare your choice in the `pattern` field.",
    "    • pov        → POV scenario. Camera IS the viewer. Hook starts \"POV:\" or \"When your…\" AND NAMES the trigger inside the hook. The reaction lands in the next 1–3 seconds. NEVER use generic \"POV: you [feeling/state]\" templates — those fail the anti-neutral filter. Examples: \"POV: roommate asks if you're mad\" (trigger=is asked / reaction=tight smile + jaw-clench), \"POV: the office snack drawer opens at 3pm\" (trigger=drawer opens / reaction=guilty smile to camera).",
    "    • reaction   → A visible reaction to a stimulus (text / photo / memory / sound / screen). Hook tees up the trigger; payoff IS the face/body reaction. Examples: \"When mom sends THE screenshot\" (trigger=phone buzz, screen reveal / reaction=slow horror-blink), \"Reading my old texts at 2am\" (trigger=scroll up / reaction=physical wince).",
    "    • mini_story → A micro-narrative with setup → trigger → reaction → payoff inside 15–25s. Includes to-camera \"me when…\" confessionals AND third-person micro-stories. Examples: \"Me trying to act normal at the dentist\" (trigger=hygienist asks if I floss / reaction=lying-face), \"Me lying about how often I cook\" (trigger=friend asks for recipes / reaction=panicked confidence).",
    "    • contrast   → Visible two-state comparison where the SECOND state is the reaction. Before/after or expectation vs reality, with the reaction LANDING IN THE SECOND HALF. Examples: \"Outfit at 8am vs 8pm\" (trigger=mirror check / reaction=defeated faceplant on bed), \"How I described my workout vs the actual workout\" (trigger=hitting record / reaction=red-faced gasping). Pure visual transformations with NO visible reaction (e.g. just before/after of a clean room) FAIL the trigger-reaction test — drop them.",
    "  PATTERN PRIORITY (HARD — overrides any first-instinct pattern choice):",
    "    • MINI-STORY IS THE DEFAULT. For every idea, START by trying mini_story — the trigger → reaction → payoff beat is built into the format itself, which is why it has the strongest \"would you post this\" retention for this tier. The format counts in the FORMAT DISTRIBUTION block above are mini-story-heavy on purpose; respect them.",
    "    • WEAK MINI-STORY ≠ FALLBACK TO POV. If your mini_story idea feels weak, the answer is to GENERATE A BETTER MINI-STORY in the same slot — change the trigger, sharpen the reaction, pick a more specific moment. Do NOT silently downgrade a weak mini_story slot to pov. Rebuild the mini_story; that's what the slot is for.",
    "    • POV is GATED. Only pick `pov` when ALL THREE conditions hold: (a) the hook is genuinely strong (clears the HOOK CRAFT gates with room to spare), (b) the idea has a clear, unmistakable tension (something went wrong / contradiction / SELF-CALLOUT), (c) it feels personal — anchored to THIS creator's voice and a SPECIFIC observable trigger inside the hook (\"POV: roommate asks if you're mad\" — yes; \"POV: you're feeling tired\" — no, generic). If you can't honestly tick all three, this idea is NOT a pov idea — rebuild it as mini_story.",
    "    • REACTION requires BOTH a strong emotional spike AND instant visual. Only pick `reaction` when the spike is one of {panic, regret, denial} (the high-amplitude three — embarrassment and irony belong inside mini_story by default) AND the face/body reaction CARRIES the entire video (the trigger can be a one-frame stimulus; the rest is the creator's filmable response). If the reaction is mild or requires voiceover to read, this is NOT a reaction idea — rebuild it as mini_story.",
    "    • `contrast` follows the existing rule (only when the creator has actively asked for it via positive feedback — usually 0).",
    "  Step 2 — Write the hook (target ≤8 words, hard ceiling 10) so it CLEARLY signals the trigger in the first 2 seconds. The viewer must know within 2 seconds what action is about to happen and brace for the reaction.",
    "  Step 3 — Fill in `whatToShow` (the simple action that happens on screen — narrate the trigger → reaction beat by beat) and `howToFilm` (concrete shooting instructions — where you sit, where the phone goes, single take vs cuts, props in arm's reach). These two fields are the trust signals shown on the card. If you can't write `whatToShow` in plain English without using the word \"something\", \"maybe\", or \"like…\", the pattern wasn't specific enough — restart from Step 1.",
    "  If you can't make an idea fit one of the four patterns above, DROP it and pick a different angle. Do NOT invent new patterns or stretch the definitions.",
    "",
    "VISUALIZABILITY GATE (HARD, 100% of ideas — applies BEFORE rules A–E):",
    "  Every idea MUST be a SPECIFIC MOMENT a viewer can picture instantly from the hook alone — zero interpretation, zero inference, zero 'figure it out'.",
    "  Apply this test BEFORE submitting each idea: after reading the hook, can you describe in one sentence exactly what is on screen in the first 2 seconds (where the creator is, what they're doing, what's happening)? If the answer requires 'it depends', 'something like…', or 'maybe they…', the idea FAILS the gate. Rewrite or replace it.",
    "  Every idea must map to one of the four patterns above (pov, reaction, mini_story, contrast). If you can't name the pattern, it fails.",
    "  CONCEPT vs MOMENT — if you find yourself describing a CONCEPT (the abstract idea of something — \"the weirdness of small talk\", \"how exhausting work is\") rather than a MOMENT (a specific beat happening on screen — \"the elevator small-talk that goes one floor too long\", \"falling asleep mid-Zoom with the camera on\"), DROP IT. Concept > moment is an automatic reject. Real ideas have a clock — they happen at a moment in time, in a specific place, with a specific trigger and a specific reaction.",
    "",
    "  HARD BAN — these patterns are PROHIBITED for all regions (they consistently underperform on 'would you post this WITHOUT changing it much' AND they fail the trigger-reaction structure):",
    "    ✗ ADVICE — \"You should…\", \"Try this…\", \"Tips for…\", \"How to…\", \"X things to do when…\", \"Stop doing X, start doing Y\" (instructional framing — has no trigger-reaction beat).",
    "    ✗ MOTIVATIONAL — \"Reminder that…\", \"You're enough\", \"Trust the process\", \"Show up for yourself\", \"Glow up\", \"Mindset shift\", \"Manifest…\", \"Your sign to…\".",
    "    ✗ \"TALK ABOUT\" / \"SHARE YOUR THOUGHTS\" / \"EXPLAIN WHY\" prompts — \"Let's talk about…\", \"Share your thoughts on…\", \"Tell us about…\", \"We need to discuss…\", \"Can we talk about how…\", \"Explain why X matters\", \"Why X is important\", \"Storytime about feelings\". Any framing where the entire video is the creator monologuing ABOUT a topic with no concrete observable scene is OUT.",
    "    ✗ ABSTRACT CONCEPTS as the subject — Confidence, Authenticity, Self-love, Energy, Boundaries, Healing, Growth, Purpose, Worthiness, Alignment, Mindfulness, Productivity (as the topic). These words may appear inside a concrete scene (\"POV: setting a boundary with mom about Sunday dinner\") but NEVER as the standalone topic (\"Why boundaries matter\"). Abstract = no filmable trigger, no visible reaction = drop.",
    "    ✗ PERSONALITY TRAITS as the subject — \"Things only introverts get\", \"Sagittarius behavior\", \"INTJ moments\", \"Type A energy\", \"That girl\", \"Main character\". Trait labels are categorical, not observable — they describe a person, not a beat. Replace with a SPECIFIC observable trigger+reaction inside that trait if needed (\"POV: introvert at a baby shower\" → trigger=hostess pulls you into circle / reaction=panicked smile).",
    "    ✗ GENERAL STATEMENTS / vibe-only hooks — \"Adulting is hard\", \"Mondays am I right\", \"Life lately\", \"This is your reminder\", \"It's giving…\", \"The duality of…\". Generalities have no specific trigger — there's no action happening on screen, just commentary. If the hook works as a tweet, it's a general statement, not a trigger-reaction idea.",
    "    ✗ Vague \"things\" lists with no concrete visual — \"Things that matter\", \"Things I wish I knew\", \"Things you should hear\". Every list-style hook needs a CONCRETE TANGIBLE referent (\"Things only oldest siblings actually do\", \"Things in my fridge that have no business being there\") AND a single trigger-reaction beat per item.",
    "    ✗ DIALOGUE-DEPENDENT ideas — anything where the payoff requires multi-line back-and-forth dialogue between two characters that the creator must perform. \"Me arguing with my sister about who's mom's favorite\", \"Explaining to my boss why I missed the deadline\", \"Talking my way out of a parking ticket\". The creator playing both sides of a dialogue is high-effort, often awkward, and the trigger-reaction beat gets buried in scripted exchange. A SINGLE-LINE STIMULUS (\"roommate asks if you're mad\") is FINE — that's the trigger. What's banned is multi-line scripted dialogue as the engine of the idea.",
    "    ✗ SENSITIVE / PRIVATE CONTENT — anything that requires the creator to expose REAL private data on screen. Banned: bank apps / account balances / transaction history / medical info (test results, diagnoses, prescriptions, weight numbers, body specifics) / real conversation screenshots (real DMs, real texts with real names) / addresses / phone numbers / IDs / license plates / passwords / salary or income details / private documents. The trigger and reaction must be performable WITHOUT the creator exposing actual private info. Privacy is not a trade-off — drop the idea and pick a different trigger.",
    "      SAFE SUBSTITUTES when you need a 'screen reaction' beat: implied reaction (no screen shown — just the face), fake/blurred/staged screen, generic notification banner (no specific sender or content), camera roll (her own photos, generic), notes app (a fake shopping list / scribble), an empty inbox, the lock screen. For non-screen scenes, lean on ambient triggers: fridge contents, coffee mug, couch cushion, kitchen counter, closet, gym bag, the laundry pile, a half-eaten snack — anything visible without exposing real personal data. \"Opening the notes app to find your shopping list\" works; \"opening your bank app to stare at the balance\" doesn't.",
    "    ✗ UNCOMFORTABLE TO FILM — anything that requires the creator to fake-cry on camera, do an embarrassing physical bit they'd visibly cringe doing, kiss the camera, perform fake-vulnerable monologues, or act out a behavior that would feel awkward to actually record. The bar: would the creator press record on this WITHOUT bracing for cringe? If they'd have to psych themselves up to film it, drop it. The five emotional spikes (embarrassment / regret / denial / panic / irony) are about MICRO-expressions and small body beats — they should NOT require performance.",
    "    ✗ MULTI-STEP CONCEPTS — anything that requires the viewer to track 3+ distinct ideas, follow numbered points, or hold multiple threads in their head. Short-form rewards single-thread ideas. If you find yourself writing \"first… then… finally…\" or \"step 1 / step 2 / step 3\", you're building a tutorial, not a TikTok.",
    "    ✗ PLANNING-HEAVY ideas — anything that requires the creator to write a detailed script, rehearse dialogue, plan multiple takes, schedule outfits/locations, or block out time. The creator should be able to start filming within 10 seconds of reading the card.",
    "  If an idea drifts into any banned pattern, scrap it and pick a different angle — do NOT try to salvage it with a tweak.",
    "",
    "  PREFERRED MOMENT TYPES (lean heavily on these — they win on 'would you post this WITHOUT changing it much'):",
    "    ✓ RELATABLE SITUATIONS — small daily moments most people in the creator's region/age bracket recognise instantly. The ✓ test: a friend reading the hook says \"omg this is me\" within 2 seconds.",
    "    ✓ AWKWARD moments — accidentally waving back at someone who wasn't waving at you, talking over a server, holding a door open way too long, forgetting a friend's partner's name mid-conversation, the elevator small-talk that goes on one floor too many, accidentally liking a 2-year-old IG post.",
    "    ✓ BROKE / TIRED / LAZY scenarios — microwaving the same coffee 3 times, pretending to know which wine to order, eating dinner standing up at the counter, \"I need to do laundry but I'm just gonna re-wear this\", opening the app you swore you deleted, the 'I'll just nap for 15 minutes' lie.",
    "    ✓ SMALL DAILY FRUSTRATIONS — wifi dropping mid-Zoom, the one earbud that's always quieter, cashier calling the next person before you've packed your bag, AirPods dying right when you start working out, the \"reply all\" panic, finding the snack aisle has been rearranged.",
    "    ✓ SELF-DEPRECATING confessional — \"me lying about how often I cook\", \"my LinkedIn vs my actual work day\", \"how I describe my workout vs what I actually did\", \"the version of me I show on dates\", \"my Spotify Wrapped vs my personality\".",
    "  These five types are the safest bets — when in doubt, pick one. They map cleanly onto pov / reaction / mini_story / contrast and require zero setup beyond pointing the phone at yourself.",
    "",
    "  DO NOT OVER-FILTER — if an idea is SIMPLE but the trigger is CLEAR and the emotional reaction is STRONG, ship it. Simplicity is not a defect; formulaic-feeling is. A 15-second video of you reading mom's text and slowly closing your phone is a complete idea — don't add complexity to \"elevate\" simple ideas, that usually breaks them.",
    "",
    "  ALLOWED FLEXIBILITY (do NOT over-constrain — the idea must feel like the USER, not a template):",
    "    ✓ Slightly open phrasing — the hook can leave room for the creator's own delivery, slang, and inflection. We're suggesting the BEAT, they bring the VOICE.",
    "    ✓ User voice flexibility — match the Style Profile's tone, energy, and word choices below. If the creator's voice is dry/deadpan, ideas should be dry/deadpan. If it's warm/playful, ideas should be warm/playful. The same beat sounds different in different voices — that's by design.",
    "    ✓ The user can tweak a word or two when filming — that's healthy. They should NOT have to rewrite the hook, swap the pattern, or restructure the beat. If the idea would need a real rewrite to feel post-worthy, it FAILS the success metric and shouldn't ship.",
    "",
    "  NOVELTY IS A BONUS, NOT THE GOAL — prioritize PERSONAL FIT, TENSION, and RELATABILITY over freshness. A familiar moment delivered with strong tension in the creator's voice beats a clever-but-distant moment every time. If forced to pick between \"unique-but-not-quite-this-creator\" and \"familiar-but-clearly-this-creator\", pick the latter. Don't strain to be original at the cost of feeling like the user.",
    "",
    "  Success metric (use this as the final mental check on every idea): \"Would the creator post this WITHOUT changing it much?\" If no, scrap and replace.",
    "",
    "BATCH VARIETY (HARD, per-batch, mandatory — this is what produces 'perceived variety'):",
    "  The variety of the batch matters as much as the quality of each idea. Three strong ideas that all hit the same category feel formulaic; three strong ideas across different categories feel like a real menu.",
    "    • TRIGGER CATEGORY (max 1 per category per 3 ideas) — for any 3-idea slice of the batch, no two ideas may share the same `triggerCategory`. The six categories: phone_screen / message / social / environment / self_check / task. For batches of 3 (Home), all 3 must use DIFFERENT categories. For larger batches, no `triggerCategory` may appear more than ⌈count/3⌉ times.",
    "    • PAIRWISE DIFFERENTIATION (any two ideas) — every pair of ideas in the batch must differ in at least TWO of these three dimensions: `pattern` (pov / reaction / mini_story / contrast), `setting` (bed / couch / desk / bathroom / kitchen / car / outside / other), `emotionalSpike` (embarrassment / regret / denial / panic / irony). Two ideas that share the same pattern AND setting AND spike are too samey — rebuild one.",
    "    • Worked example for a 3-idea batch — Idea A (pov · couch · embarrassment · phone_screen), Idea B (reaction · kitchen · panic · message), Idea C (mini_story · outside · irony · social). Three different patterns, three different settings, three different spikes, three different trigger categories. THAT'S the variety bar.",
    "    • Counter-example to AVOID — Idea A (pov · couch · embarrassment · phone_screen), Idea B (pov · couch · embarrassment · phone_screen), Idea C (reaction · couch · embarrassment · phone_screen). All three feel like the same idea repeated.",
    "  Plan the batch BEFORE drafting individual ideas: pick three trigger categories you'll cover, three settings you'll use, three spikes you'll hit, then write the ideas to fit. Don't generate then post-hoc check — the post-hoc fix usually doesn't work.",
    "",
    "VARIATION INJECTION (HARD, per-batch — adds a SCENARIO/SURFACE diversity check ON TOP of the structural variety above):",
    "  The differentiation rule above stops two ideas from being structurally identical, but a batch can still feel repetitive if the surface SCENARIO is too close — three different patterns about coffee is still 'the coffee batch'. Apply this layer in addition.",
    "    • SURFACE-SCENARIO RULE — for any 3-idea slice, the three ideas must each be about a DIFFERENT core surface scenario. Two ideas may not share the same prop / object / activity / domain. Examples of \"same scenario, different framing\" that AUTO-FAIL: coffee-cold + coffee-order + coffee-habit · gym-skip + workout-lying + fitness-app · text-from-mom + text-from-ex + text-from-boss.",
    "    • VARY ≥2 OF — between every pair of ideas, vary at least TWO of: scenario (the prop/object/activity), setting (location), emotionalSpike, hookStyle (\"the way I…\" vs \"why did I…\" vs \"me explaining…\" vs \"POV: …\" vs Contrast \"X vs Y\"), payoffType, prop/action.",
    "    • WORKED EXAMPLE — Bad batch: \"the way I stare at my cold coffee\" / \"why did I order three coffees\" / \"me explaining my coffee budget\" (all coffee — same scenario, different framing). Good batch: \"the way I just gave up on cooking dinner\" (cooking + denial) / \"why did I send that text at 2am\" (texting + regret) / \"me promising to sleep early vs 3am scroll\" (sleep + irony). Different scenarios, but EACH still hits a strong emotion and a clean reaction.",
    "    • KEEP THE EMOTIONAL PATTERN, SWAP THE SURFACE — if you have a winning emotional shape (e.g. \"denial + mini_story + low-effort kitchen\"), re-use the SHAPE across multiple ideas, but pick a different prop / activity / domain each time. Same TASTE, fresh SITUATIONS — never the same idea with different wording.",
    "    • If the candidate batch fails this check, regenerate the offending idea with a fully different scenario before drafting the rest of the fields. Do NOT ship a batch that reads as one topic in three costumes.",
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
    `Match the creator's personal style profile — their hook style, caption tone, emoji density, pacing, content type. If their primary hook style is "${profile.hookStyle.primary}", at least half the ideas should use that hook type. The hook should sound like words the creator would actually say — not generic "TikTok voice". When in doubt, lean to the creator's energy.`,
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
    "  pattern ('pov' | 'reaction' | 'mini_story' | 'contrast' — the SHAPE that holds the trigger+reaction),",
    "  hook (TARGET ≤8 words, HARD CEILING 10 — prefer 8 or fewer; allow 9–10 only if it still lands in <2s and feels natural/spoken; never exceed 10. Signals the trigger; sounds like the user's voice not generic TikTok voice),",
    "  hookSeconds (number 0.5–2, your estimate of how long the hook lands — keep ≤2),",
    "  trigger (string 5–140 chars — the SPECIFIC ACTION the creator does on screen using an action verb: open / check / read / scroll / sip / look / watch / find / notice / realize / hear / see / do. Example: \"opens her camera roll, scrolls into yesterday's screenshots\". Must be observable, not internal. NEVER expose real private data — no bank apps, real DMs, medical info, addresses.),",
    "  reaction (string 5–140 chars — the VISIBLE EMOTIONAL RESPONSE that follows the trigger. Filmable on the creator's own face/body. Example: \"frozen face, slow blink, then deadpan stare at the camera\". Must be a shootable micro-expression or body beat — not an internal feeling.),",
    "  emotionalSpike ('embarrassment' | 'regret' | 'denial' | 'panic' | 'irony' — the ONE spike this idea targets. If the emotion is weak/diffuse/generic, drop the idea.),",
    "  triggerCategory ('phone_screen' | 'message' | 'social' | 'environment' | 'self_check' | 'task' — coarse class of the trigger; used to enforce per-batch variety),",
    "  setting ('bed' | 'couch' | 'desk' | 'bathroom' | 'kitchen' | 'car' | 'outside' | 'other' — where the video is shot; used to enforce per-batch variety),",
    "  whatToShow (string 20–500 chars — the simple action that happens on screen, plain English, beat by beat, narrating the trigger → reaction. Example: \"You're sitting on the couch holding your phone. Your face is fake-calm as you read the screen. Cut to over-the-shoulder of mom's text in caps. Cut back to your slow-motion 'oh no' sigh.\"),",
    "  howToFilm (string 15–400 chars — concrete filming instructions. Where you sit/stand, where the phone goes, single take vs cuts, what props are needed AND already in arm's reach. Example: \"Sit on the couch. Prop phone on a stack of books on the coffee table at chest height. One continuous take — no cuts. Have your actual phone in hand for the screen reaction.\"),",
    "  script (LOOSE talking-point cues OR vibe direction — NOT a rigid word-for-word script. The user picks the actual words; we set the beats and energy. Keep it short — 2–4 short phrases is plenty. Example: \"Open with the fake-confused face. Mumble 'oh no… ohhhh no'. Beat. Sigh.\"),",
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
    distributionBlock,
    // Optional Taste Calibration block — spread so empty/null is
    // omitted entirely (the user array is joined with "\n" without a
    // .filter(Boolean), so a literal `null` would render as the
    // string "null" in the prompt).
    ...(calibrationBlock ? ["", calibrationBlock] : []),
    // Optional Viral Pattern Memory block — same spread pattern. Sits
    // AFTER calibration so the model reads "stated taste" first then
    // "learned taste" (memory overrides calibration when they
    // conflict, by being later in the prompt and more concrete).
    ...(memoryBlock ? ["", memoryBlock] : []),
    "",
    `=== TASK ===`,
    `Produce ${count} ideas for tomorrow. Return strictly:`,
    `{ "ideas": [ { pattern, hook, hookSeconds, trigger, reaction, emotionalSpike, triggerCategory, setting, whatToShow, howToFilm, script, shotPlan, caption, templateHint, contentType, videoLengthSec, filmingTimeMin, whyItWorks, payoffType, hasContrast, hasVisualAction, visualHook } ] }`,
    `TRIGGER-REACTION FIRST — every idea MUST have BOTH a clear `+"`trigger`"+` (specific on-screen action: open/check/read/scroll/sip/look/watch/find/notice/realize/hear/see/do) AND a clear `+"`reaction`"+` (visible emotional response on the creator's face/body). If you can't name both, DROP the idea.`,
    `EMOTIONAL SPIKE — every idea MUST hit ONE of {embarrassment, regret, denial, panic, irony}. Declare in `+"`emotionalSpike`"+`. If the emotion is weak/diffuse, DROP the idea.`,
    `HOOK CRAFT — for each idea, internally brainstorm 3–5 hook variations across the five formats (Behavior "the way I…" / Thought "why do I…" / Moment "that moment when…" / Contrast "what I say vs what I do" / Curiosity "this is where it went wrong"). Run each through the gates: emotion clear, TENSION present (something went wrong / expectation vs reality / internal contradiction), natural language, target ≤8 words (hard ceiling 10 if it still reads in <1s and feels natural). ANTI-NEUTRAL FILTER (final pass) — AUTO-REJECT openings "when you…" / "POV: you…" / "reading…" / "watching…" / "you open…" (they describe the situation; they don't create tension). PREFER thought-/reaction-voice openers: "why did I…" / "the way I…" / "I really just…" / "this just ruined…" / "I thought this was fine…". Every emitted hook must feel like a TEXT MESSAGE the creator would send a friend, not a caption. If after rewrite the hook still feels neutral, DROP THE WHOLE IDEA. SELECT the one you'd actually stop scrolling for and emit ONLY that one in `+"`hook`"+`.`,
    `BATCH VARIETY — plan the ${count} ideas BEFORE drafting any one of them. For any 3-idea slice, no two ideas may share the same `+"`triggerCategory`"+` (phone_screen/message/social/environment/self_check/task), AND every pair of ideas must differ in at least TWO of {pattern, setting, emotionalSpike}. This is what makes the batch feel fresh instead of formulaic.`,
    `CONCEPT vs MOMENT — if an idea describes a CONCEPT (\"the weirdness of small talk\") rather than a MOMENT (\"the elevator small-talk that goes one floor too long\"), DROP IT. Real ideas happen at a clock-time in a specific place.`,
    `DO NOT OVER-FILTER simple ideas — if the trigger is CLEAR and the emotional reaction is STRONG, simplicity is a feature, not a bug. Don't add complexity to \"elevate\" a simple idea.`,
    `Remember: target hook ≤8 words (hard ceiling 10, allowed only if it still reads in <1s and feels natural — do NOT reject a strong hook purely on word count); every hook lands in <2s; videoLengthSec ∈ [15,25]; filmingTimeMin ≤30; every idea has payoffType; aim for ≥60% hasContrast and ≥60% hasVisualAction across the batch${region === "western" ? "; western set must hit ≥70% POV/situational" : ""}.`,
    `PATTERN-FIRST — pick ONE of {pov, reaction, mini_story, contrast} as the SHAPE for your trigger+reaction. MINI-STORY IS THE DEFAULT — start there for every idea; if a mini_story slot feels weak, GENERATE A BETTER MINI-STORY (do NOT silently fall back to pov). POV is GATED — only allowed when the hook is genuinely strong, the tension is unmistakable, AND the angle feels personal (not generic "POV: you…"). REACTION requires BOTH a {panic|regret|denial} spike AND an instantly visual face/body response that carries the video. If the idea won't fit a pattern by these rules, scrap it.`,
    `VISUALIZABILITY GATE — for EACH idea ask "can I picture the trigger AND the reaction on screen in the first 2s?". If not, scrap it.`,
    `BANNED globally: advice / motivational / "talk about" / "share your thoughts" / "explain why" / abstract-concept hooks / personality-trait hooks (Sagittarius / introvert / Type A / etc.) / general statements ("adulting is hard") / dialogue-dependent ideas (multi-line back-and-forth) / multi-step concepts / planning-heavy ideas / SENSITIVE PRIVATE CONTENT (bank apps, real DMs, medical info, addresses, IDs, salary). Lean on relatable situations: awkward, broke/tired/lazy, small daily frustrations, self-deprecating moments.`,
    `script is LOOSE — talking-point cues, NOT a rigid word-for-word script. We set the beat; the user brings the voice.`,
    `MATCH THE USER VOICE — the hook should sound like words the creator would actually say (per the Style Profile above), not generic TikTok voice.`,
    `whatToShow + howToFilm are USER-FACING trust signals — concrete, plain-English, no "something" / "maybe" / "like…".`,
    `SUCCESS METRIC — final mental check on every idea: "Would the creator post this WITHOUT changing it much?" If no, scrap and replace.`,
  ].join("\n");

  // Output budget: each idea is ~480–600 tokens of structured JSON
  // (rich script + 1–6 shot lines + caption + whyItWorks + 4 quality
  // attribute fields + visualHook + dual time fields + the new
  // pattern + whatToShow + howToFilm trust-gate fields). Budget 620
  // per idea, plus 600 for the array scaffold. Capped at 8190 —
  // within Haiku 4.5's 8192 output cap. For count=3 (Home) this is
  // ~2460 — well under cap; for count=12 it hits ~8040 — recovery
  // path handles any truncation past that.
  // Bumped from 720 → 760 per idea after adding the required
  // `emotionalSpike` + `triggerCategory` + `setting` enums (≈40
  // extra tokens of structured JSON per idea, on top of the prior
  // `trigger` + `reaction` bump). Cap unchanged at 8190 (within
  // Haiku 4.5's 8192 output cap). For count=3 (Home) ~2880 — well
  // under cap; for count=10 ~8200 → clipped to 8190 (recovery
  // path absorbs any truncation).
  const maxTokens = Math.min(600 + count * 760, 8190);

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
    // Variety summaries — pass the dimensions already covered by
    // the main batch so the top-up fills the GAPS instead of
    // doubling up on what we already have. Drives perceived
    // variety on partial batches.
    const usedTriggerCategories = Array.from(
      new Set(ideas.map((i) => i.triggerCategory)),
    ).join(", ");
    const usedSettings = Array.from(
      new Set(ideas.map((i) => i.setting)),
    ).join(", ");
    const usedSpikes = Array.from(
      new Set(ideas.map((i) => i.emotionalSpike)),
    ).join(", ");
    // Observability — track real-world undercount frequency from
    // workflow logs without spinning up a metrics pipeline. We log
    // BEFORE the top-up so we capture the deficit even when the
    // top-up call itself throws. The post-top-up `final` count is
    // logged below so we can tell the two failure modes apart
    // (initial undercount that recovered vs. persistent undercount).
    console.warn(
      `[ideator] undercount before top-up — region=${region} requested=${count} got=${ideas.length} deficit=${deficit}`,
    );
    // Re-inject the per-creator distribution as RESIDUAL counts so
    // the top-up keeps the FINAL batch on the target mix. Without
    // this, the deficit-fill call would optimise purely for variety
    // (different triggerCategory / setting / emotionalSpike) and
    // could quietly redistribute the format mix away from the
    // creator's preference — violating the "personalisation > variety"
    // rule on the very ideas that ship to the user.
    const producedByPattern = countProducedByPattern(ideas);
    const deficitDistributionBlock = formatDeficitDistributionPromptBlock(
      distribution,
      count,
      producedByPattern,
      deficit,
    );

    const topUpUser = [
      `=== CREATOR STYLE PROFILE ===`,
      profileSummary(profile),
      "",
      `=== REGION CONTEXT ===`,
      compactBundle(bundle),
      "",
      deficitDistributionBlock,
      // Optional Taste Calibration block — spread so empty/null is
      // omitted entirely (this array is joined with "\n" without a
      // .filter(Boolean), so a literal `null` would render as the
      // string "null").
      ...(calibrationBlock ? ["", calibrationBlock] : []),
      // Same memory block as the main batch — top-up ideas should
      // honour the same "winning structure, fresh surface" bias.
      ...(memoryBlock ? ["", memoryBlock] : []),
      "",
      `=== TASK ===`,
      `Produce ${deficit} ADDITIONAL ideas. They MUST NOT overlap with these existing ideas: ${existingHooks || "(none)"}. Use clearly different angles, contentTypes, or formats.`,
      `VARIETY GAPS — the existing batch already used these dimensions; FILL THE GAPS, don't double up:`,
      `  • triggerCategory already used: [${usedTriggerCategories || "none"}] → prefer NEW categories from {phone_screen, message, social, environment, self_check, task}`,
      `  • setting already used: [${usedSettings || "none"}] → prefer NEW settings from {bed, couch, desk, bathroom, kitchen, car, outside, other}`,
      `  • emotionalSpike already used: [${usedSpikes || "none"}] → prefer NEW spikes from {embarrassment, regret, denial, panic, irony}`,
      `Return strictly:`,
      `{ "ideas": [ { pattern, hook, hookSeconds, trigger, reaction, emotionalSpike, triggerCategory, setting, whatToShow, howToFilm, script, shotPlan, caption, templateHint, contentType, videoLengthSec, filmingTimeMin, whyItWorks, payoffType, hasContrast, hasVisualAction, visualHook } ] }`,
      `TRIGGER-REACTION FIRST — every idea MUST have BOTH a clear `+"`trigger`"+` (specific on-screen action verb: open/check/read/scroll/sip/look/watch/find/notice/realize/hear/see/do) AND a clear `+"`reaction`"+` (visible emotional response on the creator's face/body). If you can't name both, DROP the idea.`,
      `EMOTIONAL SPIKE — every idea MUST hit ONE of {embarrassment, regret, denial, panic, irony}. If the emotion is weak/diffuse, DROP the idea.`,
      `HOOK CRAFT — internally brainstorm 3–5 hook variations across the five formats (Behavior / Thought / Moment / Contrast / Curiosity), gate them on emotion-clarity + TENSION (something went wrong / expectation vs reality / internal contradiction) + natural-language + target ≤8 words (hard ceiling 10, only if still <1s and natural), then SELECT the one you'd actually stop scrolling for and emit ONLY that.`,
      `Remember: target hook ≤8 words (hard ceiling 10, only if still <1s and natural — don't reject strong hooks on word count alone); hook lands in <2s; videoLengthSec ∈ [15,25]; filmingTimeMin ≤30; every idea has payoffType. PATTERN-FIRST — pick ONE of {pov, reaction, mini_story, contrast} as the shape for your trigger+reaction. Apply the LOW-EFFORT BIAS rule AND the VISUALIZABILITY GATE. CONCEPT > MOMENT = drop. DO NOT OVER-FILTER simple ideas — clear trigger + strong emotion = ship it. BANNED: advice / motivational / "talk about" / "share your thoughts" / "explain why" / abstract concepts / personality traits / general statements / dialogue-dependent / multi-step / planning-heavy / SENSITIVE PRIVATE CONTENT (bank apps, real DMs, medical, addresses, IDs, salary). WIN: relatable awkward, broke/tired/lazy, small daily frustration, self-deprecating moments. script is LOOSE talking-point cues, not a rigid word-for-word script. MATCH THE USER VOICE per the Style Profile. whatToShow + howToFilm are user-facing trust signals — concrete, plain-English, no "something" / "maybe". Success metric: "would the creator post this WITHOUT changing it much?" — if no, scrap.`,
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
        maxTokens: Math.min(600 + deficit * 760, 8190),
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
