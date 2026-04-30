/**
 * Layer 3 of the Hybrid Ideator Pipeline — Llama 3.1 hook mutation.
 *
 * The pattern engine (Layer 1) + scorer + novelty selector (Layer 2)
 * still do all structural work: scenarios, structure, filming
 * direction, shot plan, scene beats. This layer is text-only — it
 * takes the already-selected batch and asks Llama 3.1 8B Instruct to
 * rewrite the HOOK (and optionally caption) of a few candidates so
 * the output reads like a creator texted it to themselves rather
 * than a template with swapped nouns.
 *
 * Triggers (any one is enough):
 *   - regenerate=true (user asked for fresh ideas)
 *   - templated_phrasing (2+ in-batch hooks share an opener or family)
 *   - recent_history_similarity (2+ batch picks share family/topic/visual
 *     with the rolling cache history)
 *   - all_pattern_batch (every pick is from the deterministic pattern
 *     engine — opportunity to humanize at least one)
 *   - borderline_novelty (any pick has hookImpact<2 even though total
 *     score passed)
 *
 * Selection rule (per spec):
 *   Replace original ONLY if the mutated hook scores strictly better
 *   on hookImpact OR personalFit OR (quality-first override) total
 *   score is at least +1. Never replace a strong original with a
 *   weaker mutation. If Llama fails for any reason, ship originals
 *   unchanged — this layer is purely additive.
 *
 * Cost envelope: 1 Llama call per request, ≤5 candidates, ≤3 hook
 * options each. The 8B model at OpenRouter pricing is ~$0.05/M
 * tokens, so a typical mutation request costs <$0.001.
 */

import { openrouter } from "@workspace/integrations-openrouter-ai";
import type { Idea } from "./ideaGen";
import type { ScoredCandidate, IdeaScore, NoveltyContext } from "./ideaScorer";
import { scoreIdea } from "./ideaScorer";
import {
  lookupHookOpener,
  validateHook,
  type HookOpener,
  type Setting,
} from "./patternIdeator";
import type { StyleProfile, DerivedTone } from "./styleProfile";
import { deriveTone } from "./styleProfile";
import type { ViralPatternMemory } from "./viralPatternMemory";
import {
  recordLlamaCall,
  getLlamaCallsLast2Min,
  incrementUsage,
} from "./usageTracker";
import { logger } from "./logger";

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export type MutationTrigger =
  | "regenerate"
  | "templated_openers"
  | "recent_history_similarity"
  | "all_pattern_batch"
  | "borderline_novelty";

/**
 * Subset of usage data the cost-control gates need. Optional on
 * MutationContext so callers without a creator context (QA scripts,
 * one-offs) still work — when absent, no cost-control skip ever
 * fires, matching the demo-creator bypass.
 */
export type MutationUsageContext = {
  creatorId?: string;
  creatorIsDemo?: boolean;
  /** Today's count of /api/ideator/generate ideas served (NOT batches). */
  ideaRequestCountToday: number;
  /** Llama mutator calls for this creator in the last 2 minutes. */
  llamaCallsLast2Min: number;
};

export type MutationContext = {
  profile: StyleProfile;
  memory: ViralPatternMemory;
  recentScenarios: string[];
  novelty: NoveltyContext;
  regenerate: boolean;
  usage?: MutationUsageContext;
};

export type CostControlSkipReason =
  | "throttle_2min"
  | "adaptation_25"
  | "adaptation_40";

export type MutationTelemetry = {
  used: boolean;
  reason: MutationTrigger | null;
  candidatesSent: number;
  optionsReturned: number;
  mutationsSelected: number;
  costEstimateTokens: number;
  rejectedReasonCounts: Record<string, number>;
  errored: boolean;
  /** Set when the layer was skipped by a cost-control gate. */
  costControlSkipped?: boolean;
  skipReason?: CostControlSkipReason;
  /** Snapshot of the inputs that drove the gate decision (for logs). */
  ideaRequestCountToday?: number;
  llamaCallsLast2Min?: number;
};

export type MutationResult = {
  batch: ScoredCandidate[];
  telemetry: MutationTelemetry;
};

// -----------------------------------------------------------------------------
// Trigger detection
// -----------------------------------------------------------------------------

/**
 * Returns the first matching trigger reason, or null if the batch
 * already feels strong + distinct + no regen pressure.
 *
 * Spec ordering (any-of, first match wins for telemetry clarity):
 *   1. regenerate
 *   2. templated_openers (in-batch repetition)
 *   3. recent_history_similarity (cross-batch repetition)
 *   4. all_pattern_batch (every pick is deterministic)
 *   5. borderline_novelty (any pick with weak hookImpact)
 */
export function shouldMutateBatch(
  batch: ReadonlyArray<ScoredCandidate>,
  ctx: MutationContext,
): MutationTrigger | null {
  if (batch.length === 0) return null;

  if (ctx.regenerate) return "regenerate";

  // (2) In-batch templated phrasing — repeated openers OR repeated families
  // OR repeated hookLanguageStyle. The hookLanguageStyle count parallels
  // the opener count: identical language mode across ≥2 picks reads as
  // the same monologue voice repeated, even when the literal opener
  // strings differ. HOOK STYLE spec PART 7 — extends the existing
  // templated_openers trigger rather than introducing a new code (the
  // remediation pickMutationTargets does for templated_openers — mutate
  // ALL picks — is exactly what we want here).
  const openerCounts = new Map<string, number>();
  const familyCounts = new Map<string, number>();
  const langStyleCounts = new Map<string, number>();
  for (const c of batch) {
    const op =
      c.meta.hookOpener ?? lookupHookOpener(c.idea.hook) ?? null;
    if (op) openerCounts.set(op, (openerCounts.get(op) ?? 0) + 1);
    const fam = c.meta.scenarioFamily;
    if (fam) familyCounts.set(fam, (familyCounts.get(fam) ?? 0) + 1);
    const hls = c.meta.hookLanguageStyle;
    if (hls) langStyleCounts.set(hls, (langStyleCounts.get(hls) ?? 0) + 1);
  }
  for (const n of openerCounts.values()) if (n >= 2) return "templated_openers";
  for (const n of familyCounts.values()) if (n >= 2) return "templated_openers";
  for (const n of langStyleCounts.values()) if (n >= 2) return "templated_openers";

  // (3) Cross-batch similarity — at least 2 picks overlap with recent
  // history on family / topic / visualAction / hookLanguageStyle. The
  // hookLanguageStyle membership check is the spec's
  // "hookSimilarityScore vs recent" proxy: when 2+ picks repeat the
  // immediate-prior batch's language mode the day's voice has stalled,
  // exactly the situation this trigger was designed for.
  let overlapCount = 0;
  for (const c of batch) {
    const fam = c.meta.scenarioFamily;
    const topic = c.meta.topicLane;
    const visual = c.meta.visualActionPattern;
    const hls = c.meta.hookLanguageStyle;
    const overlapsFamily = fam ? ctx.novelty.recentFamilies?.has(fam) : false;
    const overlapsTopic = topic ? ctx.novelty.recentTopics?.has(topic) : false;
    const overlapsVisual = visual
      ? ctx.novelty.recentVisualActions?.has(visual)
      : false;
    const overlapsLang = hls
      ? ctx.novelty.recentHookLanguageStyles?.has(hls)
      : false;
    if (overlapsFamily || overlapsTopic || overlapsVisual || overlapsLang)
      overlapCount++;
  }
  if (overlapCount >= 2) return "recent_history_similarity";

  // (4) All-pattern batch — every pick is from the deterministic engine.
  const allPattern = batch.every(
    (c) => c.meta.source === "pattern_variation",
  );
  if (allPattern) return "all_pattern_batch";

  // (5) Borderline novelty — any pick passed quality but hookImpact is weak.
  const anyBorderline = batch.some(
    (c) => c.score.hookImpact < 2 && c.score.total >= 6,
  );
  if (anyBorderline) return "borderline_novelty";

  return null;
}

/**
 * Returns the candidates to mutate, scaled per spec by trigger type.
 * Returned candidates are a SUBSET of `batch` (not copies), so the
 * caller knows which slot each rewrite refers to.
 */
// Hard cap on candidates sent to Llama in a single request. Spec says
// "≤5 candidates per call" regardless of batch size, so every trigger
// branch caps at this value as the final clamp.
const MAX_TARGETS_PER_CALL = 5;

export function pickMutationTargets(
  batch: ReadonlyArray<ScoredCandidate>,
  trigger: MutationTrigger,
): ScoredCandidate[] {
  const sortedByQuality = [...batch].sort(
    (a, b) => b.score.total - a.score.total,
  );
  let picked: ScoredCandidate[];
  switch (trigger) {
    case "regenerate":
      picked = sortedByQuality.slice(0, Math.min(5, batch.length));
      break;
    case "templated_openers":
      // Mutate ALL picks — the spec says "for repeated/templated batch,
      // mutate all selected before final output." Sort by quality so
      // the strongest picks are kept when we have to truncate.
      picked = sortedByQuality;
      break;
    case "recent_history_similarity":
      picked = sortedByQuality.slice(0, Math.min(3, batch.length));
      break;
    case "all_pattern_batch":
      picked = sortedByQuality.slice(0, Math.min(2, batch.length));
      break;
    case "borderline_novelty":
      picked = batch
        .filter((c) => c.score.hookImpact < 2 && c.score.total >= 6)
        .sort((a, b) => b.score.total - a.score.total);
      break;
  }
  // Universal hard cap — spec ≤5 candidates per Llama call.
  return picked.slice(0, MAX_TARGETS_PER_CALL);
}

// -----------------------------------------------------------------------------
// Cost-control gates (anti-abuse layer)
// -----------------------------------------------------------------------------

/**
 * Pure decision: should the mutation layer be skipped for this
 * request based on per-creator usage signals? Returns the skip
 * reason string when one applies, otherwise null. Always allows
 * mutation when no usage context is present (e.g. internal calls
 * with no creator) or when the creator is a demo account — matches
 * the existing demo-bypass pattern in cache + quota paths.
 *
 * Gate priority (per spec):
 *   1. throttle_2min     — llamaCallsLast2Min > 3
 *   2. adaptation_40     — ideaRequestCountToday > 40 with 75% prob
 *   3. adaptation_25     — ideaRequestCountToday > 25 with 50% prob
 *
 * The probabilistic gates use Math.random so test paths can stub it
 * if they need deterministic behavior. We deliberately favour the
 * tighter (40) gate over the looser (25) gate when both apply, so a
 * power user past 40 ideas always sees the 75% suppression.
 *
 * @param rng - injectable randomness for deterministic tests; defaults to Math.random
 */
export function applyCostControlGates(
  ctx: MutationContext,
  rng: () => number = Math.random,
): { skip: boolean; reason?: CostControlSkipReason } {
  const usage = ctx.usage;
  if (!usage) return { skip: false };
  if (usage.creatorIsDemo) return { skip: false };
  if (usage.llamaCallsLast2Min > 3) {
    return { skip: true, reason: "throttle_2min" };
  }
  if (usage.ideaRequestCountToday > 40 && rng() < 0.75) {
    return { skip: true, reason: "adaptation_40" };
  }
  if (usage.ideaRequestCountToday > 25 && rng() < 0.5) {
    return { skip: true, reason: "adaptation_25" };
  }
  return { skip: false };
}

// -----------------------------------------------------------------------------
// Llama prompt + transport
// -----------------------------------------------------------------------------

const LLAMA_MODEL = "meta-llama/llama-3.1-8b-instruct";
const LLAMA_TIMEOUT_MS = 45_000;
const LLAMA_TEMPERATURE = 0.85;
const LLAMA_MAX_TOKENS = 800;

const SYSTEM_PROMPT = `You rewrite short-form video idea hooks so they feel human and specific, like a real creator texted it to themselves at 11pm.

You are NOT generating new ideas. You are ONLY rewriting the wording of an existing hook. The scene stays exactly the same.

# HARD CONSTRAINTS (never break these)

1. Do not invent any new props, new people, new locations, new apps, or new actions. If the original has no roommate, do not introduce one. If the original has no Starbucks, do not introduce one. If the original has no phone, do not introduce one.
2. Rewrite only the wording. The scene, action, setting, props, and people must remain exactly as given in the candidate's "scene", "setting", and "action" fields.
3. Preserve the core object. If "fridge" → keep "fridge". If "laundry" → keep "laundry". If "sink" → keep "sink". Never swap (no "fridge"→"freezer", no "sink"→"dishwasher", no "laundry"→"closet").
4. Do not make it motivational or advice-like.
5. Do not use generic POV phrasing ("POV: you...", "when you...", "watching...", "reading...", "how to...").
6. Avoid repeating the original opener — change the first 1-2 words. If the original starts with "I", try starting with "the", "still", or "why do i". If it starts with "the way I", switch to a different opener.
7. Hard maximum 12 words; aim for 4-9 words.
8. Every hook must imply contradiction, denial, regret, awkwardness, panic, embarrassment, or avoidance.
9. Return JSON only.

# WHAT MAKES A WINNING REWRITE

A rewrite only ships if it scores STRICTLY higher than the original. Two specific elements drive that score — you should hit BOTH in every hook option you return:

**Element A — TENSION WORD.** Include at least one of these words verbatim:
   "vs", "but", "actually", "really", "instead", "anyway", "again", "still", "and then", "the way i", "why do i", "why did i"

**Element B — SPECIFIC SCENE OBJECT.** Include the literal noun the camera will see. Strongly preferred when they fit the scene:
   "fridge", "laundry", "sink", "coffee", "inbox", "gym", "hoodie", "pile", "alarm", "cart", "3am", "11pm", or simple numbers/times like "two minutes", "one episode", "five tabs".

Hitting BOTH A and B = winning rewrite. Hitting only one usually ties or loses, which means it gets thrown away. So: pick a tension word from list A, name the actual object from list B, keep it under 10 words, keep it casual.

# CREATOR VOICE — keep it imperfect on purpose

This is short-form social text from a real person at 11pm, not copy from a brand. PRESERVE imperfection:
- lowercase is fine and often better
- fragments are fine ("anyway, the front step")
- casual grammar, slang, dropped articles are fine ("nobody talks about the same hoodie again")
- a single emoji at the end is allowed if it fits (😭, sparingly)
- DO NOT professionalize. DO NOT over-polish. DO NOT add proper punctuation it doesn't need. DO NOT make it sound like a tagline.

# EXAMPLES — study GOOD vs BAD

Original hook: "the way I avoid the sink like a sport"
Scene: "kitchen sink full of dishes"
GOOD rewrites (tension word + scene noun + casual voice):
  - "still avoiding the sink like it's a sport"      ← "still" + "sink"
  - "the sink and I are not speaking again"           ← "again" + "sink"
  - "why do i act like the sink isn't there"         ← "why do i" + "sink"
BAD rewrites (DO NOT DO THIS):
  - "my laundry started judging me"        ← invented new object (laundry was never in the scene)
  - "I left the house instead"             ← invented new location (scene is the kitchen)
  - "my roommate asked why I'm like this"  ← invented a new person (no roommate)
  - "Avoiding the kitchen sink area."      ← over-polished, no tension word, no creator voice

Original hook: "I really planned to handle the coffee"
Scene: "coffee setup on kitchen counter"
GOOD rewrites:
  - "the coffee watched me give up again"             ← "again" + "coffee"
  - "still acting like I'll handle the coffee"        ← "still" + "coffee"
  - "the coffee setup vs my actual mornings"          ← "vs" + "coffee"
BAD rewrites:
  - "my friend brought me matcha"          ← invented person AND object
  - "I went to Starbucks"                  ← invented location and brand
  - "my wallet started crying"             ← invented new object
  - "Coffee preparation continues."         ← over-polished, no tension, no voice

Original hook: "still avoiding the laundry like it's optional"
Scene: "laundry pile on bedroom chair"
GOOD rewrites:
  - "the laundry pile and i are not speaking"        ← "and" linker + "laundry pile"
  - "why do i act like the laundry isn't there"      ← "why do i" + "laundry"
  - "the laundry won again, anyway"                  ← "again" + "anyway" + "laundry"
BAD rewrites:
  - "my hamper finally gave up on me"      ← invented new object (hamper)
  - "took it to the dry cleaners"          ← invented location
  - "laundry day rescheduled to never"     ← over-polished, no tension word from list A

The pattern: GOOD rewrites stay inside the scene, hit a tension word from list A, name the actual object from list B, sound like a casual 11pm text. BAD rewrites either invent new things OR sound like a press release.`;

type LlamaCandidateInput = {
  id: string;
  hook: string;
  scene: string;
  setting: string;
  action: string;
  emotion: string;
  caption: string;
};

type LlamaCandidateOutput = {
  id: string;
  hookOptions?: string[];
  captionOptions?: string[];
};

function toMinimalInput(c: ScoredCandidate, id: string): LlamaCandidateInput {
  // Whatever the scorer's `whatToShow` is, we use it as the "scene"
  // description because it's the single most concrete thing about
  // the candidate (it's literally "you do X then Y in Z").
  return {
    id,
    hook: c.idea.hook,
    scene: c.idea.whatToShow,
    setting: c.idea.setting,
    action: c.idea.howToFilm.split(".")[0] ?? c.idea.howToFilm,
    emotion: c.idea.emotionalSpike,
    caption: c.idea.caption,
  };
}

function tonePhrase(profile: StyleProfile): string {
  const t: DerivedTone = deriveTone(profile);
  switch (t) {
    case "dry":
      return "dry, deadpan, self-aware";
    case "chaotic":
      return "chaotic, exasperated, self-deprecating";
    case "self-aware":
      return "self-aware, observational, low-key";
    case "confident":
      return "confident, dry, knowing";
  }
}

function buildUserPrompt(
  candidates: LlamaCandidateInput[],
  avoidOpeners: string[],
  creatorTone: string,
): string {
  return [
    `Creator tone: ${creatorTone}`,
    `Avoid these opener patterns (already used recently or in this batch): ${
      avoidOpeners.length > 0 ? avoidOpeners.join(", ") : "(none yet)"
    }`,
    "",
    "For each candidate, return JSON in this exact shape:",
    `{ "rewrites": [{ "id": "...", "hookOptions": ["...","...","..."], "captionOptions": ["...","..."] }] }`,
    "Return exactly 3 hookOptions and 2 captionOptions per candidate.",
    "",
    "Candidates:",
    JSON.stringify(candidates, null, 2),
  ].join("\n");
}

type LlamaCallResult = {
  options: LlamaCandidateOutput[];
  tokensUsed: number;
};

async function callLlamaMutator(
  candidates: LlamaCandidateInput[],
  avoidOpeners: string[],
  creatorTone: string,
): Promise<LlamaCallResult> {
  const userPrompt = buildUserPrompt(candidates, avoidOpeners, creatorTone);
  const response = await openrouter.chat.completions.create(
    {
      model: LLAMA_MODEL,
      max_tokens: LLAMA_MAX_TOKENS,
      temperature: LLAMA_TEMPERATURE,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    },
    { timeout: LLAMA_TIMEOUT_MS },
  );
  const raw = response.choices[0]?.message?.content?.trim() ?? "";
  if (raw.length === 0) {
    return { options: [], tokensUsed: response.usage?.total_tokens ?? 0 };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // The 8B model occasionally returns prose-wrapped JSON. Attempt
    // a soft recovery by snipping the first {...} block.
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return { options: [], tokensUsed: response.usage?.total_tokens ?? 0 };
    }
    try {
      parsed = JSON.parse(raw.slice(start, end + 1));
    } catch {
      return { options: [], tokensUsed: response.usage?.total_tokens ?? 0 };
    }
  }
  const options = extractRewritesArray(parsed);
  return {
    options,
    tokensUsed: response.usage?.total_tokens ?? 0,
  };
}

function extractRewritesArray(parsed: unknown): LlamaCandidateOutput[] {
  if (!parsed || typeof parsed !== "object") return [];
  const obj = parsed as Record<string, unknown>;
  // Accept the canonical { rewrites: [...] } envelope or a bare top-level array.
  const arr = Array.isArray(obj.rewrites)
    ? obj.rewrites
    : Array.isArray(parsed)
      ? (parsed as unknown[])
      : [];
  const out: LlamaCandidateOutput[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== "string") continue;
    const hookOptions = Array.isArray(o.hookOptions)
      ? o.hookOptions.filter((s): s is string => typeof s === "string")
      : [];
    const captionOptions = Array.isArray(o.captionOptions)
      ? o.captionOptions.filter((s): s is string => typeof s === "string")
      : [];
    out.push({ id: o.id, hookOptions, captionOptions });
  }
  return out;
}

// -----------------------------------------------------------------------------
// Mutation rule validators
// -----------------------------------------------------------------------------

const BANNED_OPENER_PATTERNS: RegExp[] = [
  /^pov:?\s/i,
  /^when you\b/i,
  /^watching\b/i,
  /^reading\b/i,
  /^how to\b/i,
  /^did you know\b/i,
  /^anyone else\b/i,
  /^have you ever\b/i,
];

const SENSITIVE_TOKENS: RegExp[] = [
  /\bdms?\b/i,
  /\bpassword[s]?\b/i,
  /\bbank\b/i,
  /\bsalary\b/i,
  /\bssn\b/i,
  /\baddress(es)?\b/i,
  /\bmedical\b/i,
  /\bprescription\b/i,
  /\bcredit card\b/i,
  /\bvenmo\b/i,
  /\bzelle\b/i,
  /\bpaypal\b/i,
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN-shaped
];

const ABSTRACT_ADVICE_PATTERNS: RegExp[] = [
  /\blearning to (accept|love|embrace)\b/i,
  /\bstop avoiding\b/i,
  /\bremember that you\b/i,
  /\byou deserve\b/i,
  /\bmanifest(ing)?\b/i,
  /\bgood vibes\b/i,
];

const HOOK_MAX_WORDS_LLAMA = 12;
const HOOK_MIN_WORDS_LLAMA = 3;

/**
 * Returns null if the rewrite is acceptable, or a short reason
 * string for telemetry / logging.
 *
 * Validates:
 *   - completeness via the existing validateHook (no dangling
 *     fragments, no `${` leaks, no truncation ellipses)
 *   - relaxed length (3–12) — Llama gets the spec's hard max,
 *     not the strict 3–10 we use for pattern hooks
 *   - no banned opener
 *   - no sensitive-content tokens
 *   - no abstract-advice patterns
 *   - opener differs from the original (no shipping the same
 *     opener back as a "rewrite")
 *   - scene preservation: the rewrite must keep at least one
 *     content noun from the original hook OR setting (substring
 *     check on lowercased token overlap)
 */
export function passesHookMutationRules(
  hook: string,
  original: ScoredCandidate,
): string | null {
  const trimmed = hook.trim();
  if (trimmed.length === 0) return "empty_hook";
  const lower = trimmed.toLowerCase();
  const wordCount = trimmed.split(/\s+/).length;

  // Length first — cheap.
  if (wordCount > HOOK_MAX_WORDS_LLAMA) return "too_long";
  if (wordCount < HOOK_MIN_WORDS_LLAMA) return "too_short";

  // Banned openers / sensitive content / abstract advice come BEFORE
  // the strict completeness check so telemetry surfaces the most
  // useful rejection reason. (e.g. "when you left the stove on" would
  // otherwise be tagged 'incomplete_or_dangling' by validateHook even
  // though the real problem is the banned opener.)
  for (const re of BANNED_OPENER_PATTERNS) {
    if (re.test(trimmed)) return "banned_opener";
  }
  for (const re of SENSITIVE_TOKENS) {
    if (re.test(trimmed)) return "sensitive_content";
  }
  for (const re of ABSTRACT_ADVICE_PATTERNS) {
    if (re.test(trimmed)) return "abstract_advice";
  }

  // Run the strict completeness validator BUT bypass the upper-bound
  // check (the validator caps at 10; we allow 12 for Llama). The
  // validator's other checks — dangling-word terminator, ${ leak,
  // ellipsis truncation — are still authoritative.
  if (wordCount <= 10) {
    if (!validateHook(trimmed)) return "incomplete_or_dangling";
  } else {
    // For 11-12 word hooks, run a lighter completeness check
    // (validateHook would reject on word count alone).
    if (
      /\$\{/.test(trimmed) ||
      /\.\.\.$/.test(trimmed) ||
      /\b(and|but|or|vs|with|to|from|at|in|on|of|the|my|me|a|an)$/i.test(
        trimmed.replace(/[.?!]+$/, ""),
      )
    ) {
      return "incomplete_or_dangling";
    }
  }

  // Opener must differ from the original to count as a rewrite.
  const newOpener = lookupHookOpener(trimmed);
  const oldOpener =
    original.meta.hookOpener ?? lookupHookOpener(original.idea.hook);
  if (newOpener && oldOpener && newOpener === oldOpener) {
    return "same_opener_as_original";
  }

  // Scene preservation — the rewrite must mention at least one
  // content noun (length >=4) from the original hook OR the
  // setting/setting-detail. This is a heuristic — Llama already gets
  // told to preserve the scene in the system prompt; this rule
  // catches drift like "kitchen sink" → "office meeting".
  const originalNouns = extractContentNouns(
    `${original.idea.hook} ${original.idea.setting} ${original.idea.whatToShow}`,
  );
  const rewriteTokens = new Set(lower.split(/[^a-z0-9]+/).filter(Boolean));
  const sceneOverlap = originalNouns.some((n) => rewriteTokens.has(n));
  if (originalNouns.length > 0 && !sceneOverlap) {
    return "scene_drift";
  }

  return null;
}

/** Stop-words skipped when extracting content nouns for scene check. */
const STOP_WORDS = new Set([
  "the","a","an","my","me","i","you","your","we","our","us","they","them",
  "and","or","but","if","then","so","that","this","these","those",
  "is","am","are","was","were","be","been","being","do","does","did",
  "have","has","had","will","would","should","could","can","may","might",
  "to","from","of","in","on","at","by","for","with","about","into","over",
  "how","why","what","when","where","who","which",
  "really","just","still","again","like","very","much","actually","instead",
  "vs","not","no","yes",
  "bed","desk","couch","kitchen","car","outside","other","bathroom",
  // Settings themselves are uninformative as scene anchors — the real
  // anchor is the OBJECT in the scene (gym bag, sink, inbox, hoodie).
]);

function extractContentNouns(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !STOP_WORDS.has(t));
  return Array.from(new Set(tokens));
}

// -----------------------------------------------------------------------------
// Apply mutations — re-score and accept the best winning option per slot
// -----------------------------------------------------------------------------

/**
 * Returns true iff the mutated candidate is strictly better than
 * the original on at least one of the spec's three axes:
 *   - hookImpact strictly higher, OR
 *   - personalFit strictly higher, OR
 *   - quality-first override: total score is at least +1 higher
 *
 * Ties never replace.
 */
function isBetterMutation(
  mutated: IdeaScore,
  original: IdeaScore,
): boolean {
  if (mutated.hookImpact > original.hookImpact) return true;
  if (mutated.personalFit > original.personalFit) return true;
  if (mutated.total >= original.total + 1) return true;
  return false;
}

function applyHookRewrite(
  original: ScoredCandidate,
  newHook: string,
  ctx: MutationContext,
): { candidate: ScoredCandidate; better: boolean } {
  const newIdea: Idea = { ...original.idea, hook: newHook };
  const newOpener = lookupHookOpener(newHook) ?? undefined;
  const newMeta = {
    ...original.meta,
    hookOpener: newOpener,
    source: "llama_3_1" as const,
  };
  const newScore = scoreIdea(
    newIdea,
    ctx.profile,
    ctx.memory,
    ctx.recentScenarios,
    newMeta,
  );
  const better = isBetterMutation(newScore, original.score);
  return {
    candidate: {
      idea: newIdea,
      meta: newMeta,
      score: newScore,
      rewriteAttempted: true,
    },
    better,
  };
}

function maybeApplyCaption(
  base: ScoredCandidate,
  captionOptions: string[],
  original: ScoredCandidate,
  ctx: MutationContext,
): ScoredCandidate {
  if (captionOptions.length === 0) return base;
  let best = base;
  for (const cap of captionOptions) {
    const trimmed = cap.trim();
    if (trimmed.length < 10) continue;
    if (trimmed.toLowerCase() === base.idea.hook.toLowerCase()) continue;
    if (trimmed.length > 200) continue;
    // Quick sensitive-content guard on captions too.
    let bad = false;
    for (const re of SENSITIVE_TOKENS) if (re.test(trimmed)) { bad = true; break; }
    if (bad) continue;
    const candidateIdea: Idea = { ...base.idea, caption: trimmed };
    const score = scoreIdea(
      candidateIdea,
      ctx.profile,
      ctx.memory,
      ctx.recentScenarios,
      base.meta,
    );
    if (score.captionStrength > best.score.captionStrength ||
        score.total > best.score.total) {
      best = {
        idea: candidateIdea,
        meta: base.meta,
        score,
        rewriteAttempted: true,
      };
    }
    // First improvement wins — original kept otherwise.
    if (best !== base) break;
  }
  // Final guardrail: never accept a caption rewrite that scores worse
  // overall than the candidate we started with for this slot.
  if (best.score.total < original.score.total) return base;
  return best;
}

// -----------------------------------------------------------------------------
// Top-level orchestrator
// -----------------------------------------------------------------------------

const NO_OP_TELEMETRY: MutationTelemetry = {
  used: false,
  reason: null,
  candidatesSent: 0,
  optionsReturned: 0,
  mutationsSelected: 0,
  costEstimateTokens: 0,
  rejectedReasonCounts: {},
  errored: false,
};

/**
 * Top-level entry point invoked by the hybrid orchestrator.
 *
 * Contract:
 *   - Never throws. Llama failures are caught and the original
 *     batch is returned unchanged with `telemetry.errored = true`.
 *   - Returns the same-length batch, with 0+ slots replaced by
 *     mutated versions that scored strictly better on at least one
 *     of (hookImpact, personalFit, total+1).
 *   - Slot order is preserved so the orchestrator can persist cache
 *     entries 1:1 against the input batch.
 */
export async function maybeMutateBatch(
  batch: ScoredCandidate[],
  ctx: MutationContext,
): Promise<MutationResult> {
  // Refresh the throttle snapshot from the in-memory ring buffer so
  // parallel calls can't all pass the gate against a stale value the
  // route handed us pre-await. Sync read; safe in the single-threaded
  // event-loop model — the gate-check + recordLlamaCall pair below
  // runs in one task slot, so the second of two parallel calls sees
  // the first's just-recorded count.
  if (
    ctx.usage?.creatorId !== undefined &&
    ctx.usage.creatorIsDemo !== true
  ) {
    ctx.usage.llamaCallsLast2Min = getLlamaCallsLast2Min(ctx.usage.creatorId);
  }

  const usageSnapshot: Pick<
    MutationTelemetry,
    "ideaRequestCountToday" | "llamaCallsLast2Min"
  > = ctx.usage
    ? {
        ideaRequestCountToday: ctx.usage.ideaRequestCountToday,
        llamaCallsLast2Min: ctx.usage.llamaCallsLast2Min,
      }
    : {};

  // (1) Cost-control gates run BEFORE trigger detection. A throttled
  // or daily-adapted skip means the layer never runs at all — pattern
  // engine output ships unchanged (the existing graceful path).
  const gate = applyCostControlGates(ctx);
  if (gate.skip) {
    return {
      batch,
      telemetry: {
        ...NO_OP_TELEMETRY,
        costControlSkipped: true,
        skipReason: gate.reason,
        ...usageSnapshot,
      },
    };
  }

  const trigger = shouldMutateBatch(batch, ctx);
  if (!trigger) {
    return {
      batch,
      telemetry: { ...NO_OP_TELEMETRY, ...usageSnapshot },
    };
  }

  const targets = pickMutationTargets(batch, trigger);
  if (targets.length === 0) {
    return {
      batch,
      telemetry: { ...NO_OP_TELEMETRY, reason: trigger, ...usageSnapshot },
    };
  }

  // Build the avoid-opener list from BOTH recent history (cross-batch)
  // and the current batch's own openers, so Llama doesn't return the
  // same opener pattern we're trying to escape.
  const avoidOpeners = new Set<string>();
  for (const op of ctx.novelty.recentHookOpeners ?? []) avoidOpeners.add(op);
  for (const c of batch) {
    const op = c.meta.hookOpener ?? lookupHookOpener(c.idea.hook);
    if (op) avoidOpeners.add(op);
  }

  const slotIds = new Map<string, number>();
  const llamaInputs: LlamaCandidateInput[] = targets.map((c) => {
    const idx = batch.indexOf(c);
    const id = `slot_${idx}`;
    slotIds.set(id, idx);
    return toMinimalInput(c, id);
  });

  const creatorTone = tonePhrase(ctx.profile);

  // Record the call attempt in the in-memory 2-min sliding window
  // BEFORE awaiting the response, so a long-running call still
  // counts toward the throttle. Skip for demo creators / no creator
  // (matches the gate's bypass). Also fire a best-effort DB
  // increment for the per-day llama_call counter; awaited writes
  // would widen the gate→call race window, so we let it settle in
  // the background. `incrementUsage` swallows DB errors internally.
  if (ctx.usage?.creatorId && !ctx.usage.creatorIsDemo) {
    recordLlamaCall(ctx.usage.creatorId);
    void incrementUsage(ctx.usage.creatorId, "llama_call", 1).catch(() => {});
  }

  let llamaResult: LlamaCallResult;
  try {
    llamaResult = await callLlamaMutator(
      llamaInputs,
      Array.from(avoidOpeners),
      creatorTone,
    );
  } catch (err) {
    logger.warn(
      { err, reason: trigger, candidates: llamaInputs.length },
      "llama_mutator.call_failed",
    );
    return {
      batch,
      telemetry: {
        used: true,
        reason: trigger,
        candidatesSent: llamaInputs.length,
        optionsReturned: 0,
        mutationsSelected: 0,
        costEstimateTokens: 0,
        rejectedReasonCounts: {},
        errored: true,
        ...usageSnapshot,
      },
    };
  }

  const rejectedCounts: Record<string, number> = {};
  let mutationsSelected = 0;

  // Walk each Llama option, find its slot, validate hookOptions,
  // re-score, and replace the original in `final` if any option
  // scores strictly better.
  const final: ScoredCandidate[] = [...batch];
  for (const opt of llamaResult.options) {
    const slotIdx = slotIds.get(opt.id);
    if (slotIdx === undefined) continue;
    const originalAtSlot = batch[slotIdx];
    if (!originalAtSlot) continue;
    const currentAtSlot = final[slotIdx]!;

    let acceptedHookSlot: ScoredCandidate | null = null;
    // Hard cap at 3 hookOptions per slot — spec ≤3 even if model returns more.
    const cappedHookOptions = (opt.hookOptions ?? []).slice(0, 3);
    // Track Llama returning a candidate envelope with no hookOptions
    // (the 8B model occasionally emits `{"id":"...","hookOptions":[]}`).
    // Empty arrays are NOT success — log them so we can see the rate.
    // Caption rewrite is independent and still gets a chance below.
    if (cappedHookOptions.length === 0) {
      rejectedCounts["empty_hook_options"] =
        (rejectedCounts["empty_hook_options"] ?? 0) + 1;
    }
    for (const rawHook of cappedHookOptions) {
      const hook = rawHook.trim();
      const reason = passesHookMutationRules(hook, originalAtSlot);
      if (reason !== null) {
        rejectedCounts[reason] = (rejectedCounts[reason] ?? 0) + 1;
        continue;
      }
      const { candidate, better } = applyHookRewrite(
        originalAtSlot,
        hook,
        ctx,
      );
      if (better) {
        acceptedHookSlot = candidate;
        break;
      } else {
        rejectedCounts["not_better"] =
          (rejectedCounts["not_better"] ?? 0) + 1;
      }
    }

    let nextAtSlot = currentAtSlot;
    if (acceptedHookSlot !== null) {
      nextAtSlot = acceptedHookSlot;
      mutationsSelected++;
    }

    nextAtSlot = maybeApplyCaption(
      nextAtSlot,
      opt.captionOptions ?? [],
      originalAtSlot,
      ctx,
    );

    final[slotIdx] = nextAtSlot;
  }

  return {
    batch: final,
    telemetry: {
      used: true,
      reason: trigger,
      candidatesSent: llamaInputs.length,
      optionsReturned: llamaResult.options.length,
      mutationsSelected,
      costEstimateTokens: llamaResult.tokensUsed,
      rejectedReasonCounts: rejectedCounts,
      errored: false,
      ...usageSnapshot,
    },
  };
}
