/**
 * Layer 4 of the Hybrid Ideator Pipeline — orchestrator.
 *
 * Routes a single ideator request through:
 *   1. Same-day cache check on the creator row.
 *   2. Layer 1 (`generatePatternCandidates`) + Layer 2
 *      (`filterAndRescore`) — fully local, $0.
 *   3. Claude fallback via existing `generateIdeas` ONLY when fewer
 *      than 3 local candidates clear the scorer. Fallback ideas are
 *      run through the same scorer so the bar is identical.
 *   4. Persist the final batch back into `creators.last_idea_batch_*`
 *      so a same-day repeat without `regenerate=true` is free.
 *
 * Public contract: returns `{ ideas: Idea[] }` shaped exactly like
 * `generateIdeas`, plus telemetry fields the route layer logs but
 * does NOT forward to clients. The mobile app stays unchanged.
 *
 * No mutation of the public Idea shape. The pipeline never throws —
 * any failure inside cache load, persistence, or memory aggregation
 * falls back to the next viable step so the user always sees ideas.
 */

import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { logger } from "./logger";
import {
  generateIdeas,
  ideaSchema,
  type GenerateIdeasInput,
  type Idea,
} from "./ideaGen";
import {
  generatePatternCandidates,
  type PatternCandidate,
} from "./patternIdeator";
import {
  filterAndRescore,
  type CandidateMeta,
  type ScoredCandidate,
} from "./ideaScorer";
import {
  computeViralPatternMemory,
  EMPTY_MEMORY,
  type ViralPatternMemory,
} from "./viralPatternMemory";
import {
  DEFAULT_STYLE_PROFILE,
  type StyleProfile,
} from "./styleProfile";
import type { Creator } from "../db/schema";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type HybridIdeatorInput = GenerateIdeasInput & {
  /** Full creator row (from `resolveCreator`) — required for cache. */
  creator?: Creator;
  /** Soft-penalty list of recently-used scenario families. */
  recentScenarios?: string[];
};

export type HybridIdeatorSource = "cache" | "pattern" | "fallback" | "mixed";

export type HybridIdeatorResult = {
  ideas: Idea[];
  source: HybridIdeatorSource;
  usedFallback: boolean;
  counts: {
    /** Local pattern candidates that survived scoring. */
    localKept: number;
    /** Claude-fallback candidates that survived scoring. */
    fallbackKept: number;
  };
};

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** UTC `YYYY-MM-DD` string — matches Postgres `date` text representation. */
function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Diversity-aware top-N picker.
 *
 * Sort is already done by the scorer (score desc, then personalFit,
 * then hookImpact, then pattern_variation tie-break). We then walk
 * the sorted list and prefer NOT to repeat scenarioFamily or
 * hookStyle until the cap is hit. If the diversified pass produces
 * fewer than `count`, we top up from the rest.
 */
function diversifyAndTake(
  scored: ScoredCandidate[],
  count: number,
): ScoredCandidate[] {
  const seenScenarios = new Set<string>();
  const seenHookStyles = new Set<string>();
  const picked: ScoredCandidate[] = [];
  const remainder: ScoredCandidate[] = [];

  for (const c of scored) {
    const family = familyOf(c.meta);
    const hookStyle = c.idea.hookStyle;
    if (
      (family && seenScenarios.has(family)) ||
      seenHookStyles.has(hookStyle)
    ) {
      remainder.push(c);
      continue;
    }
    picked.push(c);
    if (family) seenScenarios.add(family);
    seenHookStyles.add(hookStyle);
    if (picked.length >= count) break;
  }
  if (picked.length < count) {
    for (const c of remainder) {
      picked.push(c);
      if (picked.length >= count) break;
    }
  }
  return picked.slice(0, count);
}

function familyOf(meta: CandidateMeta): string | null {
  if (meta.source === "pattern_variation") return meta.scenarioFamily;
  return meta.scenarioFamily ?? null;
}

/**
 * Validate a cached batch — must be an array of objects that all
 * pass `ideaSchema.safeParse`. Returns the parsed array on success,
 * `null` on any shape failure (schema drift, partial write, etc).
 */
function tryParseCachedIdeas(raw: unknown): Idea[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: Idea[] = [];
  for (const item of raw) {
    const parsed = ideaSchema.safeParse(item);
    if (!parsed.success) return null;
    out.push(parsed.data);
  }
  return out;
}

/**
 * Wrap a Claude `Idea` as a scorer candidate. The fallback loses the
 * `scenarioFamily` we'd get from pattern_variation, so the scorer
 * tie-breakers naturally prefer pattern_variation when scores match.
 */
function wrapFallbackIdea(idea: Idea): { idea: Idea; meta: CandidateMeta } {
  return {
    idea,
    meta: { source: "claude_fallback" },
  };
}

// -----------------------------------------------------------------------------
// Cache
// -----------------------------------------------------------------------------

async function tryCache(
  creator: Creator | undefined,
  regenerate: boolean,
): Promise<Idea[] | null> {
  if (!creator) return null;
  if (regenerate) return null;
  if (creator.isDemo) return null;
  const today = utcToday();
  // Drizzle's `date` column returns a `YYYY-MM-DD` string by default
  // (no `mode: "date"`), so direct string compare is correct.
  const cachedDate = creator.lastIdeaBatchDate;
  if (!cachedDate || cachedDate !== today) return null;
  return tryParseCachedIdeas(creator.lastIdeaBatchJson);
}

async function persistCache(
  creator: Creator | undefined,
  ideas: Idea[],
): Promise<void> {
  if (!creator || creator.isDemo) return;
  if (ideas.length === 0) return;
  try {
    await db
      .update(schema.creators)
      .set({
        lastIdeaBatchJson: ideas,
        lastIdeaBatchDate: utcToday(),
        lastIdeaBatchAt: sql`now()` as unknown as Date,
      })
      .where(eq(schema.creators.id, creator.id));
  } catch (err) {
    // Cache persistence is best-effort — never fail the request
    // because we couldn't stash the batch for tomorrow.
    logger.warn(
      { err, creatorId: creator.id },
      "hybrid_ideator.cache_persist_failed",
    );
  }
}

// -----------------------------------------------------------------------------
// Memory loader (mirrors generateIdeas' own logic)
// -----------------------------------------------------------------------------

async function loadMemory(
  input: HybridIdeatorInput,
): Promise<ViralPatternMemory> {
  if (input.viralPatternMemory) return input.viralPatternMemory;
  const cid = input.ctx?.creatorId ?? input.creator?.id;
  if (!cid) return EMPTY_MEMORY;
  try {
    return await computeViralPatternMemory(cid);
  } catch {
    return EMPTY_MEMORY;
  }
}

// -----------------------------------------------------------------------------
// Public entry point
// -----------------------------------------------------------------------------

export async function runHybridIdeator(
  input: HybridIdeatorInput,
): Promise<HybridIdeatorResult> {
  const startedAt = Date.now();
  const desiredCount = Math.max(1, Math.min(input.count ?? 3, 20));
  const profile: StyleProfile = input.styleProfile ?? DEFAULT_STYLE_PROFILE;
  const regenerate = input.regenerate ?? false;

  // -------- Step 1: cache check -----------------------------------
  const cached = await tryCache(input.creator, regenerate);
  if (cached && cached.length >= desiredCount) {
    const ideas = cached.slice(0, desiredCount);
    logger.info(
      {
        source: "cache",
        creatorId: input.creator?.id,
        count: ideas.length,
        durationMs: Date.now() - startedAt,
      },
      "hybrid_ideator.served",
    );
    return {
      ideas,
      source: "cache",
      usedFallback: false,
      counts: { localKept: 0, fallbackKept: 0 },
    };
  }

  // -------- Step 2: Layer 1 + Layer 2 ----------------------------
  const memory = await loadMemory(input);
  // Generate enough pattern candidates to cover the requested count
  // even after hard-rejects + scoring drops: target = max(16, desired + 4)
  // capped at 20 (the engine's hard ceiling). For desiredCount=3 this
  // stays at 16; for desiredCount=20 it bumps to 20.
  const candidateTarget = Math.max(16, Math.min(desiredCount + 4, 20));
  const localCandidates: PatternCandidate[] = generatePatternCandidates({
    count: candidateTarget,
    profile,
    memory,
    recentScenarios: input.recentScenarios,
    regenerate,
  });
  const localResult = filterAndRescore({
    candidates: localCandidates,
    profile,
    memory,
    recentScenarios: input.recentScenarios,
  });

  let usedFallback = false;
  let fallbackKeptCount = 0;
  let merged: ScoredCandidate[] = localResult.kept;

  // -------- Step 3: Claude fallback (only if needed) -------------
  // Spec: fall back to Claude when fewer than 3 local candidates
  // pass the scorer, regardless of desiredCount. For count=1|2 this
  // still triggers when local kept is 0/1/2 — preserving idea
  // quality is worth the rare fallback for small batches.
  if (merged.length < 3) {
    usedFallback = true;
    try {
      const claudeResult = await generateIdeas({
        region: input.region,
        styleProfile: input.styleProfile,
        count: desiredCount,
        regenerate,
        tasteCalibrationJson: input.tasteCalibrationJson,
        viralPatternMemory: memory,
        ctx: input.ctx,
      });
      const wrapped = claudeResult.ideas.map(wrapFallbackIdea);
      const fallbackResult = filterAndRescore({
        candidates: wrapped,
        profile,
        memory,
        recentScenarios: input.recentScenarios,
      });
      fallbackKeptCount = fallbackResult.kept.length;
      merged = [...merged, ...fallbackResult.kept].sort(
        (a, b) => b.score.total - a.score.total,
      );
    } catch (err) {
      // Fallback failure is non-fatal — we still ship whatever local
      // candidates we have. If we ALSO have zero local, the catch
      // below the diversify call will surface the empty state.
      logger.error(
        { err, creatorId: input.creator?.id },
        "hybrid_ideator.fallback_failed",
      );
    }
  }

  // -------- Step 4: diversify, take top N, persist ---------------
  const final = diversifyAndTake(merged, desiredCount);

  // Final schema gate — every Idea returned (including the rescue
  // path below) MUST validate against ideaSchema. This is paranoia,
  // not policy: the pattern engine already builds candidates against
  // the schema and the cache reader pre-validates, but a final gate
  // makes the public contract bulletproof.
  function gate(ideas: Idea[]): Idea[] {
    return ideas.filter((i) => ideaSchema.safeParse(i).success);
  }

  if (final.length === 0) {
    // Last-ditch: ship the unfiltered top of the local candidate pool
    // so the user never sees an empty page. This is rare — pattern
    // candidates almost always clear the scorer because the engine
    // builds them from the same rubric the scorer enforces.
    const ideasOnly = gate(
      localCandidates.slice(0, desiredCount).map((c) => c.idea),
    );
    logger.warn(
      {
        creatorId: input.creator?.id,
        localCandidateCount: localCandidates.length,
        localKept: localResult.kept.length,
        hardRejected: localResult.hardRejected,
        rejected: localResult.rejected,
      },
      "hybrid_ideator.empty_after_filter_using_unfiltered_local",
    );
    await persistCache(input.creator, ideasOnly);
    return {
      ideas: ideasOnly,
      source: "pattern",
      usedFallback,
      counts: { localKept: 0, fallbackKept: 0 },
    };
  }

  const ideas = gate(final.map((c) => c.idea));
  await persistCache(input.creator, ideas);

  // Source label: "fallback" only if EVERY shipped idea came from
  // Claude; "mixed" if we used fallback but kept at least one local
  // idea; "pattern" when fallback wasn't used at all.
  const localShipped = final.filter(
    (c) => c.meta.source === "pattern_variation",
  ).length;
  const fallbackShipped = final.length - localShipped;
  const source: HybridIdeatorSource = !usedFallback
    ? "pattern"
    : fallbackShipped === final.length
      ? "fallback"
      : "mixed";

  logger.info(
    {
      source,
      creatorId: input.creator?.id,
      count: ideas.length,
      localCandidates: localCandidates.length,
      localKept: localResult.kept.length,
      fallbackKept: fallbackKeptCount,
      hardRejected: localResult.hardRejected,
      rewriteSucceeded: localResult.rewriteSucceeded,
      usedFallback,
      durationMs: Date.now() - startedAt,
    },
    "hybrid_ideator.served",
  );

  return {
    ideas,
    source,
    usedFallback,
    counts: {
      localKept: localShipped,
      fallbackKept: fallbackShipped,
    },
  };
}
