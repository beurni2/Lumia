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
 * HARD diversity-first selector for the final batch.
 *
 * Spec (per product owner): perceived creativity collapses when a
 * batch ships with the same `structure`, `hookStyle`, or
 * `scenarioFamily` repeated. After the scorer's >=8 quality gate,
 * diversity beats raw score. Walks the sorted pool in four
 * progressively-relaxed passes:
 *
 *   Pass A (strict)   : new structure AND new hookStyle AND new family
 *   Pass B (structure): new structure only (allow repeat style/family)
 *   Pass C (axes)     : new hookStyle OR new family (allow structure repeat)
 *   Pass D (rescue)   : anything left, by score, to fill `count`
 *
 * The score gate uses `>= 8` only when the high-tier pool already
 * has at least `count` candidates; otherwise it falls back to the
 * full scored pool so we never under-deliver. Sort order from
 * `filterAndRescore` (score desc → personalFit → hookImpact →
 * pattern_variation) is preserved across all passes.
 */
const HIGH_QUALITY_SCORE = 8;

function diversifiedSelect(
  scored: ScoredCandidate[],
  count: number,
): ScoredCandidate[] {
  if (scored.length === 0 || count <= 0) return [];

  const highTier = scored.filter((c) => c.score.total >= HIGH_QUALITY_SCORE);
  const pool = highTier.length >= count ? highTier : scored;

  const picked: ScoredCandidate[] = [];
  const pickedSet = new Set<ScoredCandidate>();
  const usedStructures = new Set<string>();
  const usedHookStyles = new Set<string>();
  const usedFamilies = new Set<string>();

  const accept = (c: ScoredCandidate) => {
    picked.push(c);
    pickedSet.add(c);
    usedStructures.add(c.idea.structure);
    usedHookStyles.add(c.idea.hookStyle);
    const fam = familyOf(c.meta);
    if (fam) usedFamilies.add(fam);
  };

  const sweep = (filter: (c: ScoredCandidate) => boolean) => {
    if (picked.length >= count) return;
    for (const c of pool) {
      if (picked.length >= count) return;
      if (pickedSet.has(c)) continue;
      if (!filter(c)) continue;
      accept(c);
    }
  };

  // Pass A — strict diversity on all three axes.
  sweep((c) => {
    const fam = familyOf(c.meta);
    return (
      !usedStructures.has(c.idea.structure) &&
      !usedHookStyles.has(c.idea.hookStyle) &&
      (!fam || !usedFamilies.has(fam))
    );
  });

  // Pass B — HARD structure uniqueness, relax style/family.
  sweep((c) => !usedStructures.has(c.idea.structure));

  // Pass C — at least one fresh axis when we must reuse structure.
  sweep((c) => {
    const fam = familyOf(c.meta);
    return (
      !usedHookStyles.has(c.idea.hookStyle) ||
      (!!fam && !usedFamilies.has(fam))
    );
  });

  // Pass D — rescue fill so we always return `count` ideas if the
  // pool has enough candidates at all.
  sweep(() => true);

  return picked.slice(0, count);
}

function familyOf(meta: CandidateMeta): string | null {
  if (meta.source === "pattern_variation") return meta.scenarioFamily;
  return meta.scenarioFamily ?? null;
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

  // -------- Step 2: regenerate exclusion + salt ------------------
  // On regenerate, read the previously-cached batch (any date) and
  // build a HARD exclusion set so this batch can't repeat the last
  // batch's hooks or scenarioFamilies. Salt the pattern weave with
  // a hash of the previous batch XOR'd with a millisecond cursor so
  // the candidate ordering shifts every call — even for back-to-back
  // regenerates by the same creator.
  const previousEntries = regenerate
    ? readPreviousBatch(input.creator)
    : [];
  const exclude = regenerate
    ? buildExclusion(previousEntries)
    : EMPTY_EXCLUSION;
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

  // -------- Step 4: Claude fallback (only if needed) -------------
  // Spec: fall back to Claude when fewer than 3 local candidates
  // pass the scorer (or pass the post-exclusion scorer on regenerate).
  // For count=1|2 this still triggers when local kept is 0/1/2 —
  // preserving idea quality is worth the rare fallback for small
  // batches.
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

  // -------- Step 5: diversify, take top N, persist ---------------
  const final = diversifiedSelect(merged, desiredCount);

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
