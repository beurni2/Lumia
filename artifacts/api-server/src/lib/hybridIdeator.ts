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
  lookupTopicLane,
  lookupVisualActionPattern,
  type PatternCandidate,
  type TopicLane,
  type VisualActionPattern,
} from "./patternIdeator";
import {
  filterAndRescore,
  scoreNovelty,
  selectionPenalty,
  type CandidateMeta,
  type NoveltyContext,
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
 * Novelty-aware selector for the final batch.
 *
 * Replaces the prior 4-pass HARD diversifier with a greedy selector
 * that picks by `qualityScore + noveltyBonus + penalty`, then
 * validates HARD batch guards. The novelty bonus (0–5) only applies
 * to candidates with quality >= HIGH_QUALITY_SCORE (8) so a weak
 * idea cannot be rescued by being "different".
 *
 * Selection algorithm:
 *
 *   Step 1: Filter to high-tier (quality >= 8); fall back to the
 *           full scored pool when high-tier can't fill `count`.
 *   Step 2: Greedy — for each slot, score every remaining candidate
 *           with current penalties + novelty against already-picked,
 *           pick the highest adjustedScore.
 *   Step 3: Run hard batch guards on the result. If they fail AND
 *           count <= 5, exhaustively search top-(count*4) combinations
 *           for the best guard-passing batch (capped at C(20,5) work).
 *   Step 4: Return { batch, guardsPassed }. The orchestrator decides
 *           whether a guard failure should trigger Claude fallback.
 *
 * Hard batch guards (any failure → reselect, then signal fallback):
 *   - all 3 share hookStyle  →  fail
 *   - all 3 share structure  →  fail
 *   - more than 2 share scenarioFamily / visualAction / topicLane → fail
 *
 * For batches of size 1 or 2, the guards trivially pass (you can't
 * have "3 share X" with fewer than 3 picks).
 */
const HIGH_QUALITY_SCORE = 8;
const RESELECT_MAX_COUNT = 5;
const RESELECT_TOP_MULTIPLIER = 4;

type SelectionResult = {
  batch: ScoredCandidate[];
  guardsPassed: boolean;
};

function adjustedScore(
  c: ScoredCandidate,
  batchSoFar: ScoredCandidate[],
  ctx: NoveltyContext,
): number {
  const novelty =
    c.score.total >= HIGH_QUALITY_SCORE
      ? scoreNovelty(c, batchSoFar, ctx)
      : 0;
  const penalty = selectionPenalty(c, batchSoFar);
  return c.score.total + novelty + penalty;
}

function greedySelect(
  pool: ScoredCandidate[],
  count: number,
  ctx: NoveltyContext,
): ScoredCandidate[] {
  const picked: ScoredCandidate[] = [];
  const pickedSet = new Set<ScoredCandidate>();
  while (picked.length < count) {
    let best: { c: ScoredCandidate; adj: number; baseIdx: number } | null = null;
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i];
      if (pickedSet.has(c)) continue;
      const adj = adjustedScore(c, picked, ctx);
      // Tie-break: prefer earlier sorted position (preserves the
      // filterAndRescore ordering: score → personalFit → hookImpact →
      // pattern_variation). Important so deterministic input → same output.
      if (
        best === null ||
        adj > best.adj ||
        (adj === best.adj && i < best.baseIdx)
      ) {
        best = { c, adj, baseIdx: i };
      }
    }
    if (!best) break;
    picked.push(best.c);
    pickedSet.add(best.c);
  }
  return picked;
}

function batchGuardsPass(batch: ScoredCandidate[]): boolean {
  if (batch.length === 0) return false;
  // Guards only meaningful at >=3 picks — at 1 or 2 every "max 2
  // per group" condition is vacuously satisfied.
  if (batch.length < 3) return true;
  // Spec: "never 3× same hookStyle/format/structure, never >2
  // share family/visualAction/topic" — both clauses collapse to
  // a uniform "max 2 per group" rule for any batch size, so use
  // `> 2` everywhere. (Earlier draft used `>= batch.length` for
  // hookStyle/structure which let 3-of-a-kind through any
  // batch larger than 3.)
  const MAX_GROUP_SHARE = 2;
  // No 3-same hookStyle.
  if (countMax(batch.map((b) => b.idea.hookStyle)) > MAX_GROUP_SHARE) return false;
  // No 3-same format/pattern. Spec called this out explicitly
  // alongside hookStyle and structure; without it a batch of
  // three "stitch_redo" or three "voiceover" formats could ship.
  if (countMax(batch.map((b) => b.idea.pattern)) > MAX_GROUP_SHARE) return false;
  // No 3-same structure.
  if (countMax(batch.map((b) => b.idea.structure)) > MAX_GROUP_SHARE) return false;
  // No more than 2 share family.
  if (
    countMax(
      batch
        .map((b) => b.meta.scenarioFamily)
        .filter((x): x is string => !!x),
    ) > MAX_GROUP_SHARE
  ) {
    return false;
  }
  // No more than 2 share visualActionPattern.
  if (
    countMax(
      batch
        .map((b) => b.meta.visualActionPattern)
        .filter((x): x is VisualActionPattern => !!x),
    ) > MAX_GROUP_SHARE
  ) {
    return false;
  }
  // No more than 2 share topicLane.
  if (
    countMax(
      batch
        .map((b) => b.meta.topicLane)
        .filter((x): x is TopicLane => !!x),
    ) > MAX_GROUP_SHARE
  ) {
    return false;
  }
  return true;
}

function countMax<T>(arr: T[]): number {
  if (arr.length === 0) return 0;
  const m = new Map<T, number>();
  let max = 0;
  for (const x of arr) {
    const v = (m.get(x) ?? 0) + 1;
    m.set(x, v);
    if (v > max) max = v;
  }
  return max;
}

/**
 * Exhaustive guard-passing search over the top-(count*4) candidates.
 * Returns the highest-adjustedScore-sum batch that passes guards, or
 * `null` if no combination passes. Capped at count <= 5 because
 * C(20,5) = 15,504 is an acceptable worst case but C(40,10) is not.
 */
function exhaustiveReselect(
  pool: ScoredCandidate[],
  count: number,
  ctx: NoveltyContext,
): ScoredCandidate[] | null {
  if (count > RESELECT_MAX_COUNT) return null;
  const top = pool.slice(
    0,
    Math.min(pool.length, count * RESELECT_TOP_MULTIPLIER),
  );
  if (top.length < count) return null;

  // Wrap in an object so the recursive closure mutates a property
  // rather than reassigning a `let` (which trips TypeScript's
  // control-flow narrowing into `never` at the post-recursion read).
  const bestRef: { value: { batch: ScoredCandidate[]; total: number } | null } = {
    value: null,
  };

  const indices: number[] = new Array(count).fill(0);
  function recurse(slot: number, start: number): void {
    if (slot === count) {
      const batch = indices.map((i) => top[i]);
      if (!batchGuardsPass(batch)) return;
      let total = 0;
      const partial: ScoredCandidate[] = [];
      for (const c of batch) {
        total += adjustedScore(c, partial, ctx);
        partial.push(c);
      }
      if (bestRef.value === null || total > bestRef.value.total) {
        bestRef.value = { batch: batch.slice(), total };
      }
      return;
    }
    for (let i = start; i <= top.length - (count - slot); i++) {
      indices[slot] = i;
      recurse(slot + 1, i + 1);
    }
  }
  recurse(0, 0);

  return bestRef.value ? bestRef.value.batch : null;
}

function selectWithNovelty(
  scored: ScoredCandidate[],
  count: number,
  ctx: NoveltyContext,
): SelectionResult {
  if (scored.length === 0 || count <= 0) {
    return { batch: [], guardsPassed: false };
  }
  const highTier = scored.filter((c) => c.score.total >= HIGH_QUALITY_SCORE);
  const pool = highTier.length >= count ? highTier : scored;

  const greedy = greedySelect(pool, count, ctx);
  if (batchGuardsPass(greedy)) {
    return { batch: greedy, guardsPassed: true };
  }
  // Greedy violated guards — try exhaustive search over top candidates.
  const reselected = exhaustiveReselect(pool, count, ctx);
  if (reselected) {
    return { batch: reselected, guardsPassed: true };
  }
  // No guard-passing combination exists in the top-N. Return the
  // greedy result so the orchestrator can decide to call fallback
  // and re-select on a wider merged pool.
  return { batch: greedy, guardsPassed: false };
}

/**
 * Build cross-batch novelty context from the previous cached batch.
 * `recentFamilies` and `recentStyles` come straight from the cache;
 * `recentTopics` and `recentVisualActions` are derived via the
 * pattern-ideator's family→category lookup tables (so we don't need
 * to migrate the cache shape every time we add a new dimension).
 */
function buildNoveltyContext(prev: CachedBatchEntry[]): NoveltyContext {
  if (prev.length === 0) return { };
  const recentFamilies = new Set<string>();
  const recentStyles = new Set<string>();
  const recentTopics = new Set<TopicLane>();
  const recentVisualActions = new Set<VisualActionPattern>();
  for (const e of prev) {
    if (e.family) {
      recentFamilies.add(e.family);
      const tl = lookupTopicLane(e.family);
      if (tl) recentTopics.add(tl);
      const va = lookupVisualActionPattern(e.family);
      if (va) recentVisualActions.add(va);
    }
    recentStyles.add(e.idea.hookStyle);
  }
  return { recentFamilies, recentStyles, recentTopics, recentVisualActions };
}

/**
 * Cached-batch entry shape — `idea` plus the metadata we need to
 * exclude / penalize on regenerate. The legacy cache wrote raw
 * `Idea[]`; new writes use `CachedBatchEntry[]`. Reader accepts both
 * to keep yesterday's cache rows usable.
 */
type CachedBatchEntry = {
  idea: Idea;
  family?: string;
  templateId?: string;
};

/**
 * Validate a cached batch. Accepts either:
 *   - new shape: `[{ idea, family?, templateId? }, ...]`
 *   - legacy shape: `[Idea, ...]`
 * Returns the entries on success, `null` on any shape failure.
 */
function tryParseCachedBatch(raw: unknown): CachedBatchEntry[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: CachedBatchEntry[] = [];
  for (const item of raw) {
    if (item && typeof item === "object" && "idea" in item) {
      const wrapper = item as { idea: unknown; family?: unknown; templateId?: unknown };
      const parsed = ideaSchema.safeParse(wrapper.idea);
      if (!parsed.success) return null;
      out.push({
        idea: parsed.data,
        family:
          typeof wrapper.family === "string" ? wrapper.family : undefined,
        templateId:
          typeof wrapper.templateId === "string"
            ? wrapper.templateId
            : undefined,
      });
    } else {
      const parsed = ideaSchema.safeParse(item);
      if (!parsed.success) return null;
      out.push({ idea: parsed.data });
    }
  }
  return out;
}

/**
 * Normalize a hook for exclusion comparison — lowercase, strip
 * punctuation, collapse whitespace. Two hooks that differ only in
 * casing or stray punctuation collide here so regenerate can't ship
 * "the way I sleep at 3am" right after "The way I sleep at 3am!".
 */
function normalizeHook(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Stable 32-bit hash of all hooks in a batch — fed into the pattern
 * engine's `regenerateSalt` so each regenerate produces a different
 * (template, scenario, style) starting offset.
 */
function hashEntries(entries: CachedBatchEntry[]): number {
  let h = 2166136261;
  for (const e of entries) {
    const s = e.idea.hook;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return Math.abs(h | 0);
}

type ExclusionSet = {
  hooks: Set<string>;
  families: Set<string>;
  styles: Set<string>;
};

function buildExclusion(prev: CachedBatchEntry[]): ExclusionSet {
  const hooks = new Set<string>();
  const families = new Set<string>();
  const styles = new Set<string>();
  for (const e of prev) {
    hooks.add(normalizeHook(e.idea.hook));
    if (e.family) families.add(e.family);
    styles.add(e.idea.hookStyle);
  }
  return { hooks, families, styles };
}

const EMPTY_EXCLUSION: ExclusionSet = {
  hooks: new Set(),
  families: new Set(),
  styles: new Set(),
};

/**
 * HARD exclusion gate — drop any pattern candidate whose hook
 * (normalized) appears in the previous batch OR whose
 * `scenarioFamily` was used in the previous batch. This is what
 * makes regenerate=true feel actually fresh instead of returning
 * the same 3 hooks on repeat.
 */
function applyExclusion(
  candidates: PatternCandidate[],
  exclude: ExclusionSet,
): PatternCandidate[] {
  if (exclude.hooks.size === 0 && exclude.families.size === 0) {
    return candidates;
  }
  return candidates.filter((c) => {
    if (exclude.hooks.has(normalizeHook(c.idea.hook))) return false;
    if (exclude.families.has(c.meta.scenarioFamily)) return false;
    return true;
  });
}

/**
 * Same exclusion logic for Claude fallback ideas — but family info
 * is unavailable so we can only hard-exclude by hook. Style/family
 * repetition is handled downstream by the diversifier.
 */
function applyExclusionToFallback(
  ideas: Idea[],
  exclude: ExclusionSet,
): Idea[] {
  if (exclude.hooks.size === 0) return ideas;
  return ideas.filter((i) => !exclude.hooks.has(normalizeHook(i.hook)));
}

function toCacheEntries(picks: ScoredCandidate[]): CachedBatchEntry[] {
  return picks.map((c) => ({
    idea: c.idea,
    family: c.meta.scenarioFamily,
    templateId:
      c.meta.source === "pattern_variation" ? c.meta.templateId : undefined,
  }));
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
  const entries = tryParseCachedBatch(creator.lastIdeaBatchJson);
  return entries ? entries.map((e) => e.idea) : null;
}

/**
 * Read the previous batch (regardless of date) for exclusion
 * purposes during regenerate. Stale-day batches are still valuable
 * input — they tell us what the creator just saw.
 */
function readPreviousBatch(creator: Creator | undefined): CachedBatchEntry[] {
  if (!creator) return [];
  const entries = tryParseCachedBatch(creator.lastIdeaBatchJson);
  return entries ?? [];
}

async function persistCache(
  creator: Creator | undefined,
  entries: CachedBatchEntry[],
): Promise<void> {
  if (!creator || creator.isDemo) return;
  if (entries.length === 0) return;
  try {
    await db
      .update(schema.creators)
      .set({
        lastIdeaBatchJson: entries,
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

  // -------- Step 2: regenerate exclusion + salt + novelty ctx ----
  // Always read the previously-cached batch (any date) so the
  // novelty scorer can see "what did the creator just look at" and
  // demote repeats of those families/topics/styles. The HARD
  // exclusion gate (`buildExclusion`) is still regenerate-only —
  // non-regen requests should be free to ship the same family if
  // the scorer thinks it's the best fit, just with a small novelty
  // penalty for repeating it.
  const previousEntries = readPreviousBatch(input.creator);
  const exclude = regenerate
    ? buildExclusion(previousEntries)
    : EMPTY_EXCLUSION;
  const noveltyContext: NoveltyContext = buildNoveltyContext(previousEntries);
  // `>>> 0` coerces the XOR result to an unsigned 32-bit int so the
  // subsequent `% 997` is always non-negative (JS keeps the sign of
  // the dividend, so a negative seedSalt would produce negative
  // array offsets downstream).
  const regenerateSalt = regenerate
    ? ((hashEntries(previousEntries) ^ Date.now()) >>> 0) % 997
    : undefined;

  // -------- Step 3: Layer 1 + Layer 2 ----------------------------
  const memory = await loadMemory(input);
  // Generate enough pattern candidates to cover the requested count
  // even after hard-rejects + scoring drops: target = max(16, desired + 4)
  // capped at 20 (the engine's hard ceiling). For desiredCount=3 this
  // stays at 16; for desiredCount=20 it bumps to 20.
  const candidateTarget = Math.max(16, Math.min(desiredCount + 4, 20));
  const rawCandidates: PatternCandidate[] = generatePatternCandidates({
    count: candidateTarget,
    profile,
    memory,
    recentScenarios: input.recentScenarios,
    regenerate,
    regenerateSalt,
  });
  // HARD-exclude any candidate matching the previous batch's hooks
  // or scenarioFamilies. This is the core of the regenerate fix —
  // the diversifier alone can't conjure freshness from a stale pool.
  const localCandidates = applyExclusion(rawCandidates, exclude);
  const localResult = filterAndRescore({
    candidates: localCandidates,
    profile,
    memory,
    recentScenarios: input.recentScenarios,
  });

  let usedFallback = false;
  let fallbackKeptCount = 0;
  let merged: ScoredCandidate[] = localResult.kept;

  // -------- Step 4a: first selection on local pool ----------------
  // Run the novelty-aware selector on the local pool. If batch
  // guards pass AND we have at least `desiredCount` picks, we're
  // done — no Claude needed. If guards fail OR we're short, we'll
  // top up with fallback below and re-select on the merged pool.
  let selection = selectWithNovelty(merged, desiredCount, noveltyContext);

  // -------- Step 4b: Claude fallback (when needed) ---------------
  // Three triggers, in spec order:
  //   1. Fewer than 3 local candidates passed the scorer — same as
  //      pre-novelty rule: we just don't have enough raw material.
  //      Threshold is the literal `3`, NOT `desiredCount`, so for
  //      count=1|2 we still demand a healthy pool (which gives the
  //      novelty selector real choice).
  //   2. The selector couldn't fill `desiredCount` picks even
  //      against the local pool (e.g. all candidates clustered on
  //      one family).
  //   3. Hard batch guards failed on the local pool — adding
  //      Claude variety may unlock a guard-passing combination
  //      (different family / topic / visual).
  // For count=1|2 trigger 3 is vacuous (guards short-circuit at
  // batch.length<3), so the effective rule there is "fewer than 3
  // local candidates passed."
  const needFallback =
    merged.length < 3 ||
    selection.batch.length < desiredCount ||
    !selection.guardsPassed;
  if (needFallback) {
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
      // Apply the same hook-exclusion to Claude's output so a
      // regenerate fallback can't ship a near-duplicate of the
      // previous batch (Claude lacks scenarioFamily, so family
      // exclusion is structurally a no-op here).
      const freshFallback = applyExclusionToFallback(
        claudeResult.ideas,
        exclude,
      );
      const wrapped = freshFallback.map(wrapFallbackIdea);
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
      // Re-select on the merged pool — Claude may have unlocked
      // axis variety the local pool lacked.
      selection = selectWithNovelty(merged, desiredCount, noveltyContext);
    } catch (err) {
      // Fallback failure is non-fatal — we still ship whatever local
      // candidates we have. If we ALSO have zero local, the catch
      // below the rescue path will surface the empty state.
      logger.error(
        { err, creatorId: input.creator?.id },
        "hybrid_ideator.fallback_failed",
      );
    }
  }

  // -------- Step 5: ship final batch, persist --------------------
  const final = selection.batch;
  if (final.length >= desiredCount && !selection.guardsPassed) {
    // Best-effort ship — neither local nor merged pools could yield
    // a guard-passing combination. Surface in logs so we can grep
    // for cohorts that need richer scenario coverage.
    logger.warn(
      {
        creatorId: input.creator?.id,
        regenerate,
        localKept: localResult.kept.length,
        fallbackKept: fallbackKeptCount,
        usedFallback,
        styles: final.map((c) => c.idea.hookStyle),
        families: final.map((c) => c.meta.scenarioFamily),
        topics: final.map((c) => c.meta.topicLane),
        visuals: final.map((c) => c.meta.visualActionPattern),
      },
      "hybrid_ideator.guards_failed_shipping_best_effort",
    );
  }

  // Final schema gate — every Idea returned (including the rescue
  // path below) MUST validate against ideaSchema. This is paranoia,
  // not policy: the pattern engine already builds candidates against
  // the schema and the cache reader pre-validates, but a final gate
  // makes the public contract bulletproof.
  function gate(ideas: Idea[]): Idea[] {
    return ideas.filter((i) => ideaSchema.safeParse(i).success);
  }

  if (final.length === 0) {
    // Last-ditch rescue: ship the unfiltered top of the local pool so
    // the user almost never sees an empty page. This is rare — pattern
    // candidates almost always clear the scorer because the engine
    // builds them from the same rubric the scorer enforces.
    //
    // HARD-EXCLUSION INVARIANT: on regenerate=true we MUST NOT ship
    // any hook/family that was in the previous batch. The previous
    // implementation fell back to `rawCandidates` (pre-exclusion) when
    // the post-exclusion pool was empty — that silently violated the
    // contract by re-shipping the very items we just excluded.
    //
    // New rescue policy:
    //   * regenerate=false → can use rawCandidates (no exclusion to honor).
    //   * regenerate=true  → only post-exclusion candidates are eligible;
    //                        if exclusion zeroed the pool AND fallback
    //                        couldn't fill, return an empty list. The
    //                        client surfaces a "no fresh ideas — try
    //                        again" state rather than re-serving stale.
    const rescueSource: PatternCandidate[] =
      localCandidates.length > 0
        ? localCandidates
        : regenerate
          ? []
          : rawCandidates;
    const rescueSlice = rescueSource.slice(0, desiredCount);
    const ideasOnly = gate(rescueSlice.map((c) => c.idea));
    logger.warn(
      {
        creatorId: input.creator?.id,
        regenerate,
        rawCandidateCount: rawCandidates.length,
        localCandidateCount: localCandidates.length,
        localKept: localResult.kept.length,
        hardRejected: localResult.hardRejected,
        rejected: localResult.rejected,
        excluded: rawCandidates.length - localCandidates.length,
        rescueShipped: ideasOnly.length,
      },
      ideasOnly.length === 0
        ? "hybrid_ideator.empty_after_exclusion_no_rescue"
        : "hybrid_ideator.empty_after_filter_using_unfiltered_local",
    );
    // Only persist when we actually shipped something — empty
    // rescue must not overwrite the previous batch (otherwise the
    // next regenerate has nothing to exclude against).
    if (ideasOnly.length > 0) {
      const rescueEntries: CachedBatchEntry[] = rescueSlice
        .filter((c) => ideaSchema.safeParse(c.idea).success)
        .slice(0, ideasOnly.length)
        .map((c) => ({
          idea: c.idea,
          family: c.meta.scenarioFamily,
          templateId: c.meta.templateId,
        }));
      await persistCache(input.creator, rescueEntries);
    }
    return {
      ideas: ideasOnly,
      source: "pattern",
      usedFallback,
      counts: { localKept: 0, fallbackKept: 0 },
    };
  }

  const ideas = gate(final.map((c) => c.idea));
  // Persist as entries so the next regenerate has family +
  // templateId for HARD exclusion, not just hook strings.
  const entriesToCache = toCacheEntries(final).slice(0, ideas.length);
  await persistCache(input.creator, entriesToCache);

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
