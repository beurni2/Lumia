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

export type MutationContext = {
  profile: StyleProfile;
  memory: ViralPatternMemory;
  recentScenarios: string[];
  novelty: NoveltyContext;
  regenerate: boolean;
};

export type MutationTelemetry = {
  used: boolean;
  reason: MutationTrigger | null;
  candidatesSent: number;
  optionsReturned: number;
  mutationsSelected: number;
  costEstimateTokens: number;
  rejectedReasonCounts: Record<string, number>;
  errored: boolean;
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

  // (2) In-batch templated phrasing — repeated openers OR repeated families.
  const openerCounts = new Map<string, number>();
  const familyCounts = new Map<string, number>();
  for (const c of batch) {
    const op =
      c.meta.hookOpener ?? lookupHookOpener(c.idea.hook) ?? null;
    if (op) openerCounts.set(op, (openerCounts.get(op) ?? 0) + 1);
    const fam = c.meta.scenarioFamily;
    if (fam) familyCounts.set(fam, (familyCounts.get(fam) ?? 0) + 1);
  }
  for (const n of openerCounts.values()) if (n >= 2) return "templated_openers";
  for (const n of familyCounts.values()) if (n >= 2) return "templated_openers";

  // (3) Cross-batch similarity — at least 2 picks overlap with recent history
  // on family / topic / visualAction.
  let overlapCount = 0;
  for (const c of batch) {
    const fam = c.meta.scenarioFamily;
    const topic = c.meta.topicLane;
    const visual = c.meta.visualActionPattern;
    const overlapsFamily = fam ? ctx.novelty.recentFamilies?.has(fam) : false;
    const overlapsTopic = topic ? ctx.novelty.recentTopics?.has(topic) : false;
    const overlapsVisual = visual
      ? ctx.novelty.recentVisualActions?.has(visual)
      : false;
    if (overlapsFamily || overlapsTopic || overlapsVisual) overlapCount++;
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
// Llama prompt + transport
// -----------------------------------------------------------------------------

const LLAMA_MODEL = "meta-llama/llama-3.1-8b-instruct";
const LLAMA_TIMEOUT_MS = 45_000;
const LLAMA_TEMPERATURE = 0.85;
const LLAMA_MAX_TOKENS = 800;

const SYSTEM_PROMPT = `You rewrite short-form video idea hooks so they feel human and specific, like a real creator texted it to themselves.

Rules:
- Keep the same scene, action, and emotion as the original.
- Do not invent new props, people, locations, private data, or story events.
- Do not make it motivational or advice-like.
- Do not use generic POV phrasing ("POV: you...", "when you...", "watching...", "reading...", "how to...").
- Avoid repeating the original opener pattern.
- Prefer under 10 words; hard maximum 12 words.
- Every hook must imply contradiction, denial, regret, awkwardness, panic, embarrassment, or avoidance.
- Return JSON only.`;

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
  const trigger = shouldMutateBatch(batch, ctx);
  if (!trigger) return { batch, telemetry: NO_OP_TELEMETRY };

  const targets = pickMutationTargets(batch, trigger);
  if (targets.length === 0) {
    return {
      batch,
      telemetry: { ...NO_OP_TELEMETRY, reason: trigger },
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
    },
  };
}
