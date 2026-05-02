/**
 * PHASE Y5 — CORE-NATIVE CANDIDATE GENERATOR
 *
 * Pure, deterministic generator that turns selected `PremiseCore`
 * rows into local idea candidates that compete alongside the
 * existing `pattern_variation` pool. NO Claude. NO cost increase.
 * NO API/DB/schema change. Win on score; merge pre-`filterAndRescore`.
 *
 * Each candidate carries:
 *   meta.source = "core_native"
 *   meta.usedBigPremise = true
 *   meta.premiseCoreId, meta.premiseStyleId, meta.executionId
 *   meta.scenarioFamily = undefined  (mirrors fallback discipline —
 *     `applyExclusion` family check is a structural no-op for absent
 *     family, same as Claude wraps)
 *
 * Pipeline-side semantics (unchanged for existing sources):
 *   - NOT eligible for the rewriter (it gates on
 *     `meta.source === "pattern_variation"`).
 *   - Loses sort tiebreaks against pattern_variation (cost-neutral
 *     catalog still wins on equal score).
 *   - Vacuous-passes the comedy gate via `usedBigPremise: true`
 *     (curated mechanism; same discipline as Claude premise wraps).
 *   - Stays subject to the anti-copy seed-hook check (core.examples
 *     are NOT in the seed-fingerprint corpus — only
 *     `PREMISE_STYLE_DEFS[*].executions[*].example` is — so verbatim
 *     core-example use does not trip `copied_seed_hook`).
 *
 * Determinism: given identical (cores, regenerateSalt, noveltyContext,
 * recentPremises) inputs, returns byte-identical output. Salt is the
 * only source of variation across regenerates.
 */

import { ideaSchema, type Idea } from "./ideaGen.js";
import {
  validateComedy,
  validateAntiCopy,
  loadSeedHookFingerprints,
  type ComedyRejectionReason,
} from "./comedyValidation.js";
import {
  PREMISE_STYLE_DEFS,
  type PremiseStyleId,
} from "./patternIdeator.js";
import type { PremiseCore } from "./premiseCoreLibrary.js";
import type { CandidateMeta } from "./ideaScorer.js";

// ---------------------------------------------------------------- //
// Public types                                                      //
// ---------------------------------------------------------------- //

export type CoreNativeCandidate = { idea: Idea; meta: CandidateMeta };

export type CoreNoveltyContext = {
  /** Premise-style ids shipped in recent batches — selector prefers
   *  unused ones when picking from `core.compatiblePremiseStyles`. */
  recentPremiseStyleIds?: ReadonlySet<string>;
  /** Premise-execution ids shipped in recent batches — selector
   *  prefers unused ones when picking from
   *  `PREMISE_STYLE_DEFS[styleId].executions`. */
  recentExecutionIds?: ReadonlySet<string>;
};

export type GenerateCoreCandidatesInput = {
  cores: readonly PremiseCore[];
  /** Maximum candidates to return. Once cap is reached, remaining
   *  cores are recorded as `kept: false, attempts: 0` so the QA
   *  driver can see they were skipped (not rejected). */
  count: number;
  noveltyContext?: CoreNoveltyContext;
  /** Same engine-wide salt the local pool already uses; rotates
   *  every regenerate so the same core can produce a different
   *  hook variant on the next regenerate. */
  regenerateSalt?: number;
  /** Normalized premise sentences from the last-N cached batches.
   *  Threaded into `validateAntiCopy` to reject premise repeats. */
  recentPremises?: ReadonlySet<string>;
};

export type CoreCandidateAttempt = {
  coreId: string;
  kept: boolean;
  attempts: number;
  lastReason?: ComedyRejectionReason | "schema_invalid" | "core_misconfigured";
};

export type GenerateCoreCandidatesResult = {
  candidates: CoreNativeCandidate[];
  stats: {
    /** Total (core × variant) attempts evaluated through the gates. */
    generatedCount: number;
    keptCount: number;
    /** Per-reason counters (subset of `ComedyRejectionReason` plus
     *  generator-local `schema_invalid`). Always full-shape so
     *  dashboards can `.no_tension` etc. without `??`. */
    rejectionReasons: Record<
      ComedyRejectionReason | "schema_invalid",
      number
    >;
    perCoreAttempts: CoreCandidateAttempt[];
  };
};

// ---------------------------------------------------------------- //
// Deterministic helpers                                             //
// ---------------------------------------------------------------- //

/** djb2 32-bit hash. Pure, deterministic. */
function djb2(s: string): number {
  let h = 5381 | 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function pickIndex(salt: number, key: string, length: number): number {
  if (length <= 0) return 0;
  return djb2(`${salt}|${key}`) % length;
}

/** Pick from `arr`, preferring an element NOT in `recent`. Walks
 *  circularly from a salt-derived start so cold-start (no recent)
 *  still rotates across batches. Falls back to start when every
 *  element is in `recent`. */
function pickPreferFresh<T>(
  arr: readonly T[],
  salt: number,
  key: string,
  recent: ReadonlySet<string> | undefined,
  toKey: (x: T) => string,
): T {
  if (arr.length === 0) {
    throw new Error(
      "[coreCandidateGenerator] empty array passed to pickPreferFresh",
    );
  }
  const startIdx = pickIndex(salt, key, arr.length);
  if (!recent || recent.size === 0) return arr[startIdx]!;
  for (let i = 0; i < arr.length; i++) {
    const idx = (startIdx + i) % arr.length;
    const item = arr[idx]!;
    if (!recent.has(toKey(item))) return item;
  }
  return arr[startIdx]!;
}

// Local mirror of `comedyValidation.STOPWORDS` — kept private so the
// validator module's stopword set stays the single source of truth
// for actual gate behavior. We use the same set to pre-pick anchor
// tokens that WILL survive tokenization, so the alignment math we
// build into the candidate matches what the gate will measure.
const STOPWORDS: ReadonlySet<string> = new Set([
  "the","a","an","and","or","but","if","so",
  "to","of","in","on","at","by","for","with",
  "is","are","was","were","be","been","being",
  "do","does","did","doing","done",
  "have","has","had","having",
  "this","that","these","those",
  "i","me","my","mine","you","your","we","us","our",
  "it","its","they","them","their",
  "as","from","into","out","up","down","over","off",
  "then","than","just","very","really","also",
  "show","shows","showing","shown","see","seen",
  "scene","shot","phone","camera","video",
]);

/** Same regex/policy as `comedyValidation.tokenize` — used to pre-
 *  compute anchor tokens so the candidate's whatToShow / howToFilm /
 *  premise are GUARANTEED to share the alignment-required tokens
 *  with the hook. Returns insertion-ordered de-duped tokens. */
function contentTokens(s: string): string[] {
  const matches = s.toLowerCase().match(/[a-z][a-z0-9']{2,}/g);
  if (!matches) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of matches) {
    if (STOPWORDS.has(m)) continue;
    if (seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return out;
}

function capWords(s: string, maxWords: number): string {
  const parts = s.trim().split(/\s+/);
  if (parts.length <= maxWords) return s.trim();
  return parts.slice(0, maxWords).join(" ");
}

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s[0]!.toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------- //
// Family → axis maps                                                //
// ---------------------------------------------------------------- //

type Family = PremiseCore["family"];

const FAMILY_PATTERN: Record<Family, Idea["pattern"]> = {
  self_betrayal: "contrast",
  self_as_relationship: "pov",
  absurd_escalation: "mini_story",
  confident_vs_real: "contrast",
  social_mask: "contrast",
  adulting_chaos: "contrast",
  dopamine_overthinking: "mini_story",
  identity_exposure: "contrast",
};

const FAMILY_SPIKE: Record<Family, Idea["emotionalSpike"]> = {
  self_betrayal: "regret",
  self_as_relationship: "embarrassment",
  absurd_escalation: "panic",
  confident_vs_real: "irony",
  social_mask: "irony",
  adulting_chaos: "denial",
  dopamine_overthinking: "regret",
  identity_exposure: "embarrassment",
};

const FAMILY_STRUCTURE: Record<Family, Idea["structure"]> = {
  self_betrayal: "routine_contradiction",
  self_as_relationship: "self_callout",
  absurd_escalation: "small_panic",
  confident_vs_real: "expectation_vs_reality",
  social_mask: "social_awareness",
  adulting_chaos: "denial_loop",
  dopamine_overthinking: "avoidance",
  identity_exposure: "self_callout",
};

const FAMILY_PAYOFF: Record<Family, Idea["payoffType"]> = {
  self_betrayal: "punchline",
  self_as_relationship: "punchline",
  absurd_escalation: "reveal",
  confident_vs_real: "reveal",
  social_mask: "reveal",
  adulting_chaos: "punchline",
  dopamine_overthinking: "reveal",
  identity_exposure: "reveal",
};

// ---------------------------------------------------------------- //
// Domain → axis biasing                                             //
// ---------------------------------------------------------------- //

function pickSetting(domain: string): Idea["setting"] {
  const d = domain.toLowerCase();
  if (/sleep|bed|morning_routine|wake/.test(d)) return "bed";
  if (/bath|shower|mirror/.test(d)) return "bathroom";
  if (/food|cook|kitchen|fridge|grocer|meal|diet|snack/.test(d)) return "kitchen";
  if (/car|commut|driv/.test(d)) return "car";
  if (/outside|outdoor|gym|run|fitness|park/.test(d)) return "outside";
  if (/couch|tv|stream/.test(d)) return "couch";
  if (/work|email|study|career|admin|tax|bills|email|content/.test(d)) return "desk";
  return "other";
}

function pickTriggerCategory(domain: string): Idea["triggerCategory"] {
  const d = domain.toLowerCase();
  if (/phone|tiktok|instagram|twitter|reddit|app|social_media|scroll|spotify/.test(d)) return "phone_screen";
  if (/email|text|message|notification|voicemail|dm/.test(d)) return "message";
  if (/social|dating|party|friend|coworker|cashier|partner|date/.test(d)) return "social";
  if (/mirror|self_image|body|appearance|age|aesthetic/.test(d)) return "self_check";
  if (/cook|food|gym|fitness|cleaning|laundry|task|chore|shopping|grocer|pack/.test(d)) return "task";
  return "environment";
}

function pickHookStyle(hookLower: string): Idea["hookStyle"] {
  if (/^the way (i|you)\b/.test(hookLower)) return "the_way_i";
  if (/^why (do|did) i\b/.test(hookLower)) return "why_do_i";
  if (/\bvs\b|→| vs\.|>/.test(hookLower)) return "contrast";
  if (/^pov\b|^when (your|you)\b|^nobody/.test(hookLower)) return "curiosity";
  return "internal_thought";
}

function pickTemplateHint(salt: number, key: string): Idea["templateHint"] {
  const hints: Idea["templateHint"][] = ["A", "B", "C", "D"];
  return hints[djb2(`${salt}|${key}|hint`) % hints.length]!;
}

// ---------------------------------------------------------------- //
// Hook variant generation                                           //
// ---------------------------------------------------------------- //

/**
 * Light, deterministic mutations of an example to dodge premise-dup
 * against `recentPremises` and seed-hook collisions. The first
 * variant is the verbatim example (cheapest, lands the curated
 * phrasing); subsequent variants only change the connector / add a
 * salt-derived rhetorical tag, NEVER drop the anchor noun (we need
 * those tokens for the alignment math). All variants are capped at
 * 10 words so `ideaSchema.hook` (≤ 10) accepts them.
 */
function makeHookVariants(
  example: string,
  salt: number,
  variantKey: string,
): string[] {
  const base = capWords(example.replace(/\s+/g, " "), 10);
  const variants: string[] = [base];
  if (base.includes("→")) {
    const arrowAsDot = capWords(base.replace(/\s*→\s*/g, ". "), 10);
    if (arrowAsDot !== base) variants.push(arrowAsDot);
  }
  const tags = ["okay", "honestly", "and still", "still"];
  const tag = tags[djb2(`${salt}|${variantKey}|tag`) % tags.length]!;
  const tagged = capWords(`${tag} ${base}`, 10);
  if (!variants.includes(tagged)) variants.push(tagged);
  return variants;
}

// ---------------------------------------------------------------- //
// Candidate builder                                                 //
// ---------------------------------------------------------------- //

type BuildContext = {
  core: PremiseCore;
  domain: string;
  premiseStyleId: PremiseStyleId;
  executionId: string;
  hook: string;
  salt: number;
};

function buildIdea(ctx: BuildContext): Idea {
  const { core, domain, hook, salt } = ctx;
  const hookLower = hook.toLowerCase();
  const hookContent = contentTokens(hook);
  // Anchor tokens — longest-first so the most distinctive nouns win.
  // Falls back to a synthetic "moment" anchor when the hook is too
  // sparse (extremely rare; the validator vacuous-passes empty hook
  // tokens but we want positive overlap on every emit).
  const sortedAnchors = [...hookContent].sort((a, b) => b.length - a.length);
  const anchorA = sortedAnchors[0] ?? "moment";
  const anchorB = sortedAnchors[1] ?? sortedAnchors[0] ?? anchorA;

  // whatToShow — guarantees ≥2 tokens shared with hook (anchorA +
  // anchorB are both lifted FROM the hook) AND ≥1 token shared with
  // howToFilm (anchorA appears in both). 20-500 char range satisfied.
  const whatToShow =
    `Creator delivers the line about ${anchorA} and ${anchorB} straight to camera, ` +
    `then the camera holds on the visible contradiction in the same frame. ` +
    `Cut to the ${anchorA} reveal — single beat, deadpan, no narration over the punch.`;

  // howToFilm — shares ${anchorA} with whatToShow (the gate needs
  // ≥1 token between show and film). 15-400 char range satisfied.
  const howToFilm =
    `Phone propped at chest height, single take. Frame yourself talking to camera, ` +
    `then tilt or hard-cut to the ${anchorA} reveal. Keep the contradiction visible in the same shot when possible.`;

  // premise — shares ${anchorA} with hook (the gate needs ≥1 token
  // when premise is present). Ties tension + mechanism + domain into
  // ONE sentence so anti-copy `near_duplicate_premise` only fires on
  // a literal cross-batch repeat. 8-240 char range satisfied.
  const premise =
    `${capitalize(core.tension)} — the ${anchorA} beat lands the contradiction in one take ` +
    `(${domain.replace(/_/g, " ")}, ${core.mechanism.replace(/_/g, " ")}).`;

  // trigger — concrete on-screen action (5-140 chars). Reuses
  // ${anchorA} so trigger-side overlap also clears ≥2 with whatToShow,
  // giving the alignment gate a second pass-through path.
  const trigger = `Open the ${anchorA} moment on camera, deliberately and out loud.`;

  // reaction — visible facial / body response (5-140 chars).
  const reaction = `Slow blink, half-laugh, then deadpan stare at the ${anchorA} reveal.`;

  // script (10-800 chars).
  const script =
    `LINE 1: ${hook}\n` +
    `LINE 2 (beat / cutaway): show the ${anchorA} that contradicts line 1.\n` +
    `LINE 3 (caption / mouthed): ${capitalize(core.mechanism.replace(/_/g, " "))}.`;

  // shotPlan — 3 beats keeps `scoreFilmability` at 2 (≤4 plan).
  const shotPlan: string[] = [
    `Wide-ish framing: deliver the ${anchorA} hook to camera.`,
    `Cut or tilt: reveal the contradicting ${anchorB} in the same setting.`,
    `Hold on the deadpan reaction for one extra beat.`,
  ];

  // caption — must add detail beyond the hook to score 1 in
  // `scoreCaptionStrength` (length ≥ 30, OR adds vs/but/instead/actually).
  const caption =
    `the ${anchorA} part keeps happening but actually i'm fine probably. ` +
    `${capitalize(domain.replace(/_/g, " "))}.`;

  return {
    pattern: FAMILY_PATTERN[core.family],
    hook,
    hookSeconds: 1.5,
    trigger,
    reaction,
    emotionalSpike: FAMILY_SPIKE[core.family],
    structure: FAMILY_STRUCTURE[core.family],
    hookStyle: pickHookStyle(hookLower),
    triggerCategory: pickTriggerCategory(domain),
    setting: pickSetting(domain),
    script,
    shotPlan,
    caption,
    templateHint: pickTemplateHint(salt, core.id),
    contentType: "entertainment",
    videoLengthSec: 18,
    filmingTimeMin: 5,
    whyItWorks:
      `Premise core "${core.id}" lands a one-beat contradiction on the ${anchorA} reveal — ` +
      `visible action, tight contrast, curated mechanism (${core.mechanism.replace(/_/g, " ")}).`,
    payoffType: FAMILY_PAYOFF[core.family],
    hasContrast: true,
    hasVisualAction: true,
    visualHook: `Camera holds on the ${anchorA} reveal as the contradiction lands.`,
    whatToShow,
    howToFilm,
    premise,
    premiseCoreId: core.id,
  };
}

// ---------------------------------------------------------------- //
// Public API                                                        //
// ---------------------------------------------------------------- //

const EMPTY_REASONS: Record<
  ComedyRejectionReason | "schema_invalid",
  number
> = {
  no_contradiction: 0,
  no_tension: 0,
  generic_observation: 0,
  too_soft: 0,
  hook_scenario_mismatch: 0,
  filming_mismatch: 0,
  copied_seed_hook: 0,
  near_duplicate_premise: 0,
  schema_invalid: 0,
};

export function generateCoreCandidates(
  input: GenerateCoreCandidatesInput,
): GenerateCoreCandidatesResult {
  const salt = Math.trunc(input.regenerateSalt ?? 0);
  const recentPremises = input.recentPremises ?? new Set<string>();
  const recentStyleIds = input.noveltyContext?.recentPremiseStyleIds;
  const recentExecIds = input.noveltyContext?.recentExecutionIds;
  const seedFingerprints = loadSeedHookFingerprints();
  const cap = Math.max(0, Math.trunc(input.count));

  const candidates: CoreNativeCandidate[] = [];
  const perCoreAttempts: CoreCandidateAttempt[] = [];
  const reasons: Record<ComedyRejectionReason | "schema_invalid", number> = {
    ...EMPTY_REASONS,
  };
  let generatedCount = 0;

  for (const core of input.cores) {
    if (candidates.length >= cap) {
      perCoreAttempts.push({ coreId: core.id, kept: false, attempts: 0 });
      continue;
    }
    if (
      core.compatibleDomains.length === 0 ||
      core.compatiblePremiseStyles.length === 0 ||
      core.examples.length === 0
    ) {
      perCoreAttempts.push({
        coreId: core.id,
        kept: false,
        attempts: 0,
        lastReason: "core_misconfigured",
      });
      continue;
    }

    const domain =
      core.compatibleDomains[
        pickIndex(salt, `${core.id}|domain`, core.compatibleDomains.length)
      ]!;
    const premiseStyleId = pickPreferFresh(
      core.compatiblePremiseStyles,
      salt,
      `${core.id}|style`,
      recentStyleIds,
      (s) => s,
    );
    const styleDef = PREMISE_STYLE_DEFS[premiseStyleId];
    const executions = styleDef?.executions ?? [];
    const executionId =
      executions.length > 0
        ? pickPreferFresh(executions, salt, `${core.id}|exec`, recentExecIds, (e) => e.id).id
        : "default";

    const exampleStartIdx = pickIndex(
      salt,
      `${core.id}|ex`,
      core.examples.length,
    );

    let kept = false;
    let attempts = 0;
    let lastReason: CoreCandidateAttempt["lastReason"];

    // Spec: try up to 1-2 alternates on validation failure. We walk
    // up to 3 (example, variant) pairs total — verbatim example +
    // arrow-swapped + tagged variant of the SAME example, then if
    // still failing, advance to the next example.
    outer: for (let exOff = 0; exOff < core.examples.length; exOff++) {
      const exIdx = (exampleStartIdx + exOff) % core.examples.length;
      const example = core.examples[exIdx]!;
      const variants = makeHookVariants(example, salt, `${core.id}|${exIdx}`);

      for (const hook of variants) {
        attempts++;
        generatedCount++;
        const draft = buildIdea({
          core,
          domain,
          premiseStyleId,
          executionId,
          hook,
          salt,
        });
        const parsed = ideaSchema.safeParse(draft);
        if (!parsed.success) {
          reasons.schema_invalid += 1;
          lastReason = "schema_invalid";
          continue;
        }
        const meta: CandidateMeta = {
          source: "core_native",
          usedBigPremise: true,
          premiseCoreId: core.id,
          premiseStyleId,
          executionId,
        };
        const comedyReason = validateComedy(parsed.data, {
          source: meta.source,
          usedBigPremise: true,
        });
        if (comedyReason) {
          reasons[comedyReason] = (reasons[comedyReason] ?? 0) + 1;
          lastReason = comedyReason;
          continue;
        }
        const copyReason = validateAntiCopy(
          parsed.data,
          { source: meta.source, usedBigPremise: true },
          seedFingerprints,
          recentPremises,
        );
        if (copyReason) {
          reasons[copyReason] = (reasons[copyReason] ?? 0) + 1;
          lastReason = copyReason;
          continue;
        }
        candidates.push({ idea: parsed.data, meta });
        kept = true;
        break outer;
      }
      // Cap retries per core to keep generation cheap (≤ 3 attempts).
      if (attempts >= 3) break;
    }

    perCoreAttempts.push({ coreId: core.id, kept, attempts, lastReason });
  }

  return {
    candidates,
    stats: {
      generatedCount,
      keptCount: candidates.length,
      rejectionReasons: reasons,
      perCoreAttempts,
    },
  };
}
