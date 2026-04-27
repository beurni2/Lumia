/**
 * Viral Pattern Memory — Lumina Evolution Engine MVP.
 *
 * Per-creator weight aggregator that biases the next ideator batch
 * toward winning structural shapes while the VARIATION INJECTION
 * block in `ideaGen.ts` simultaneously forces the SURFACE scenario
 * to stay fresh. Together: same winning STRUCTURE, fresh SURFACES.
 *
 * PATTERN-LEVEL not TOPIC-LEVEL — emphatically. The memory remembers
 * "this creator likes denial_loop + mini_story + the_way_i hooks",
 * NOT "this creator likes coffee jokes". Topic-level memory loops the
 * user into a single domain forever; pattern-level memory keeps the
 * structural fit while the variation rule rotates the surface.
 *
 * FOUR DIMENSIONS we track (only these — keep it lightweight):
 *   • structures      — the SHAPE of the idea (7 values, see STRUCTURES)
 *   • hookStyles      — the SHAPE of the hook (5 values, see HOOK_STYLES)
 *   • emotionalSpikes — the targeted emotion (5 values)
 *   • formats         — the production form (4 values, = `pattern` field)
 *
 * STORED MEMORY = `Record<tag, weight>` per dimension + recent-accepted
 * and recent-rejected pattern bundles (last 10 of each). Weights are
 * clamped to [-5, +10] so a single bad day can't permanently bury a
 * tag, and a long winning streak can't shut out exploration entirely.
 *
 * COMPUTED-PER-CALL (NOT stored — these are session-scoped signals):
 *   • momentumBoosts        — tag in 2+ recent positive → 1.4×; 3+ → 1.7×
 *   • stalePenalties        — same structure 3/5 last accepted → -2;
 *                             same format 4/5 last accepted → -1.5
 *   • tasteShiftPromotions  — tag accepted 3+ times in last 10 positive
 *                             but currently weight≤0 → +2 promotion
 *   • explorationTarget     — top-1 structure + 1-2 ADJACENT structures
 *                             (from the explicit STRUCTURE_ADJACENCY map)
 *
 * Two source tables:
 *   1. `idea_feedback` — verdict-weighted: yes=+1, maybe=+0.5, no=-2
 *   2. `ideator_signal` — action-weighted: exported=+3, make_another=+2,
 *      selected=+2, regenerated_batch=-1, skipped=-1, abandoned=-1
 *
 * Action signals outweigh verdicts because actions reveal real intent
 * (the creator went to make the video) while verdicts are cheap taps.
 *
 * Failure mode: any error (DB hiccup, malformed row) returns the
 * empty memory shape. The ideator must NEVER block on memory load.
 *
 * Rebuilt for the Evolution Engine in migration #19 — replaces the
 * v1 top-3-arrays shape with a Record<tag, weight> shape that lets
 * us layer multiplicative momentum / additive penalties / promotions
 * on top of the base weights at render time.
 */

import { and, desc, eq, gte } from "drizzle-orm";

import { db, schema } from "../db/client";

/* ------------------------------------------------------------------ */
/* Canonical taxonomies — single source of truth across the Evolution */
/* Engine. Re-exported for ideaGen.ts (zod ideaSchema) and for         */
/* routes/ideaFeedback.ts (request body validation).                   */
/* ------------------------------------------------------------------ */

/** Idea SHAPE — "what kind of beat is this idea hitting". */
export const STRUCTURES = [
  "expectation_vs_reality",
  "self_callout",
  "denial_loop",
  "avoidance",
  "small_panic",
  "social_awareness",
  "routine_contradiction",
] as const;
export type Structure = (typeof STRUCTURES)[number];

/** Hook SHAPE — "what kind of opening line is this". */
export const HOOK_STYLES = [
  "the_way_i",
  "why_do_i",
  "contrast",
  "curiosity",
  "internal_thought",
] as const;
export type HookStyle = (typeof HOOK_STYLES)[number];

/** Targeted EMOTION — the spike the idea is aiming at. */
export const EMOTIONAL_SPIKES = [
  "denial",
  "regret",
  "panic",
  "embarrassment",
  "irony",
] as const;
export type EmotionalSpike = (typeof EMOTIONAL_SPIKES)[number];

/** Production FORMAT — same enum as `ideaSchema.pattern`. */
export const FORMATS = ["mini_story", "reaction", "pov", "contrast"] as const;
export type Format = (typeof FORMATS)[number];

/**
 * Adjacency map for the EXPLORATION TARGET — maps each structure
 * to the 2 structures most similar in EMOTIONAL family (not surface
 * scenario). The exploration computation picks the top LEAN INTO
 * structure, then directs the model to ship 1 idea using one of
 * its adjacent structures (so exploration is genuinely RELATED to
 * what's working, never random unrelated structures). Hand-curated
 * — small enough to debug.
 */
const STRUCTURE_ADJACENCY: Record<Structure, Structure[]> = {
  expectation_vs_reality: ["routine_contradiction", "self_callout"],
  self_callout: ["social_awareness", "denial_loop"],
  denial_loop: ["avoidance", "small_panic"],
  avoidance: ["denial_loop", "small_panic"],
  small_panic: ["denial_loop", "avoidance"],
  social_awareness: ["self_callout", "expectation_vs_reality"],
  routine_contradiction: ["expectation_vs_reality", "self_callout"],
};

/* ------------------------------------------------------------------ */
/* Memory shape.                                                       */
/* ------------------------------------------------------------------ */

export type PatternBundle = {
  structure: Structure | null;
  hookStyle: HookStyle | null;
  emotionalSpike: EmotionalSpike | null;
  format: Format | null;
  timestamp: string;
};

export type MomentumBoost = {
  tag: string;
  dimension: "structure" | "hookStyle" | "emotionalSpike" | "format";
  multiplier: 1.4 | 1.7;
};

export type StalePenalty = {
  tag: string;
  dimension: "structure" | "format";
  penalty: -2 | -1.5;
};

export type TasteShift = {
  tag: string;
  dimension: "structure" | "hookStyle" | "emotionalSpike" | "format";
  bonus: 2;
};

export type ViralPatternMemory = {
  /** Stored aggregates — Record<tag, clampedWeight> per dimension. */
  structures: Record<string, number>;
  hookStyles: Record<string, number>;
  emotionalSpikes: Record<string, number>;
  formats: Record<string, number>;
  /** Last ~10 positive-action bundles, most-recent-first. */
  recentAcceptedPatterns: PatternBundle[];
  /** Last ~10 negative-action bundles, most-recent-first. */
  recentRejectedPatterns: PatternBundle[];
  /** Computed per-call (NOT stored). Multiplicative session boosts. */
  momentumBoosts: MomentumBoost[];
  /** Computed per-call (NOT stored). Additive penalties for over-use. */
  stalePenalties: StalePenalty[];
  /** Computed per-call (NOT stored). +2 bonus for emerging tags. */
  tasteShiftPromotions: TasteShift[];
  /** Computed per-call (NOT stored). Aligned + adjacent for the batch. */
  explorationTarget: { aligned: Structure | null; adjacent: Structure[] };
  /** Snapshot timestamp — recomputed per request. */
  lastUpdatedAt: string;
  /**
   * Sample size — informs the prompt block whether the memory is
   * confident enough to mention. With <3 weighted rows we omit the
   * block entirely (the noise would mislead the model more than
   * help it).
   */
  sampleSize: number;
};

export const EMPTY_MEMORY: ViralPatternMemory = {
  structures: {},
  hookStyles: {},
  emotionalSpikes: {},
  formats: {},
  recentAcceptedPatterns: [],
  recentRejectedPatterns: [],
  momentumBoosts: [],
  stalePenalties: [],
  tasteShiftPromotions: [],
  explorationTarget: { aligned: null, adjacent: [] },
  lastUpdatedAt: new Date(0).toISOString(),
  sampleSize: 0,
};

/* ------------------------------------------------------------------ */
/* Hook-style classifier (post-hoc, regex-based).                      */
/* ------------------------------------------------------------------ */

/**
 * Backward-compat hook-style classifier. Pre-migration #19 rows have
 * NULL `hook_style` columns — for those rows we classify the free
 * text into one of the five canonical buckets so the historical
 * window still contributes to the hookStyle dimension. New rows
 * (post-#19) carry the model's own declared hookStyle and bypass
 * this classifier entirely.
 *
 * Order matters — POV-style hooks could match curiosity AND another
 * bucket; we resolve by prefix-checking the more specific shapes
 * first. Anything that doesn't match a specific shape lands in
 * `internal_thought` (the broadest bucket — "I really just…", "me
 * when…", "this just ruined…").
 */
export function classifyHookStyle(hook: string): HookStyle {
  const h = hook.trim().toLowerCase();
  if (/^the way (i|you)\b/.test(h)) return "the_way_i";
  if (/^(why|how come)\b/.test(h)) return "why_do_i";
  if (/\b(vs\.?|versus)\b/.test(h)) return "contrast";
  if (
    /^(pov[:\s]|nobody (told|warned)|this is where|when (your|the))/.test(h)
  ) {
    return "curiosity";
  }
  return "internal_thought";
}

/* ------------------------------------------------------------------ */
/* Weight tables — single source of truth (Evolution Engine spec).     */
/* ------------------------------------------------------------------ */

const VERDICT_WEIGHT: Record<string, number> = {
  yes: 1,
  maybe: 0.5,
  no: -2,
};

const SIGNAL_WEIGHT: Record<string, number> = {
  exported: 3,
  make_another: 2,
  selected: 2,
  regenerated_batch: -1,
  skipped: -1,
  abandoned: -1,
};

const POSITIVE_VERDICTS = new Set(["yes"]);
const NEGATIVE_VERDICTS = new Set(["no"]);
const POSITIVE_SIGNAL_TYPES = new Set([
  "exported",
  "make_another",
  "selected",
]);
const NEGATIVE_SIGNAL_TYPES = new Set([
  "regenerated_batch",
  "skipped",
  "abandoned",
]);

/** Spec clamp — Min: -5, Max: +10 (Part 3). */
const CLAMP_MIN = -5;
const CLAMP_MAX = 10;

function clamp(n: number): number {
  return Math.max(CLAMP_MIN, Math.min(CLAMP_MAX, n));
}

/* ------------------------------------------------------------------ */
/* Aggregation helpers.                                                */
/* ------------------------------------------------------------------ */

function bumpRec(
  rec: Record<string, number>,
  key: string | null | undefined,
  w: number,
): void {
  if (!key) return;
  rec[key] = (rec[key] ?? 0) + w;
}

function clampRec(rec: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec)) {
    out[k] = clamp(v);
  }
  return out;
}

function filterRec(
  rec: Record<string, number>,
  whitelist: readonly string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec)) {
    if ((whitelist as readonly string[]).includes(k)) out[k] = v;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Public API.                                                         */
/* ------------------------------------------------------------------ */

/**
 * Build the per-creator memory snapshot. Pulls the recent window
 * from both source tables, weights each row, aggregates by dimension,
 * computes the four transient signals (momentum / stale / taste-shift
 * / exploration), and returns a fully-shaped ViralPatternMemory.
 *
 * NEVER throws — any failure returns `EMPTY_MEMORY` so the ideator
 * keeps shipping. Window is capped at WINDOW_DAYS to avoid letting
 * a creator's tastes from 6 months ago dominate today's batch.
 */
export async function computeViralPatternMemory(
  creatorId: string | null | undefined,
): Promise<ViralPatternMemory> {
  if (!creatorId) return EMPTY_MEMORY;

  const WINDOW_DAYS = 60;
  const ROW_CAP = 50;
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000);

  type FeedbackRow = {
    structure: string | null;
    hookStyle: string | null;
    emotionalSpike: string | null;
    ideaPattern: string | null;
    ideaHook: string;
    verdict: string;
    createdAt: Date;
  };
  type SignalRow = {
    structure: string | null;
    hookStyle: string | null;
    emotionalSpike: string | null;
    ideaPattern: string | null;
    ideaHook: string;
    signalType: string;
    createdAt: Date;
  };

  let feedbackRows: FeedbackRow[] = [];
  let signalRows: SignalRow[] = [];

  try {
    feedbackRows = await db
      .select({
        structure: schema.ideaFeedback.structure,
        hookStyle: schema.ideaFeedback.hookStyle,
        emotionalSpike: schema.ideaFeedback.emotionalSpike,
        ideaPattern: schema.ideaFeedback.ideaPattern,
        ideaHook: schema.ideaFeedback.ideaHook,
        verdict: schema.ideaFeedback.verdict,
        createdAt: schema.ideaFeedback.createdAt,
      })
      .from(schema.ideaFeedback)
      .where(
        and(
          eq(schema.ideaFeedback.creatorId, creatorId),
          gte(schema.ideaFeedback.createdAt, since),
        ),
      )
      .orderBy(desc(schema.ideaFeedback.createdAt))
      .limit(ROW_CAP);
  } catch {
    feedbackRows = [];
  }

  try {
    signalRows = await db
      .select({
        structure: schema.ideatorSignal.structure,
        hookStyle: schema.ideatorSignal.hookStyle,
        emotionalSpike: schema.ideatorSignal.emotionalSpike,
        ideaPattern: schema.ideatorSignal.ideaPattern,
        ideaHook: schema.ideatorSignal.ideaHook,
        signalType: schema.ideatorSignal.signalType,
        createdAt: schema.ideatorSignal.createdAt,
      })
      .from(schema.ideatorSignal)
      .where(
        and(
          eq(schema.ideatorSignal.creatorId, creatorId),
          gte(schema.ideatorSignal.createdAt, since),
        ),
      )
      .orderBy(desc(schema.ideatorSignal.createdAt))
      .limit(ROW_CAP);
  } catch {
    signalRows = [];
  }

  const totalRows = feedbackRows.length + signalRows.length;
  if (totalRows === 0) return EMPTY_MEMORY;

  // Stored aggregates per dimension.
  const structures: Record<string, number> = {};
  const hookStyles: Record<string, number> = {};
  const emotionalSpikes: Record<string, number> = {};
  const formats: Record<string, number> = {};

  // Unified bundle stream for downstream window slicing.
  type UnifiedRow = {
    structure: string | null;
    hookStyle: string | null;
    emotionalSpike: string | null;
    format: string | null;
    isPositive: boolean;
    isNegative: boolean;
    createdAt: Date;
  };
  const allRows: UnifiedRow[] = [];

  for (const r of feedbackRows) {
    const w = VERDICT_WEIGHT[r.verdict];
    if (w === undefined) continue;
    // Backward-compat: pre-#19 rows have NULL hookStyle — fall back
    // to the regex classifier on the raw hook text.
    const hs = r.hookStyle ?? classifyHookStyle(r.ideaHook);
    bumpRec(structures, r.structure, w);
    bumpRec(hookStyles, hs, w);
    bumpRec(emotionalSpikes, r.emotionalSpike, w);
    bumpRec(formats, r.ideaPattern, w);
    allRows.push({
      structure: r.structure,
      hookStyle: hs,
      emotionalSpike: r.emotionalSpike,
      format: r.ideaPattern,
      isPositive: POSITIVE_VERDICTS.has(r.verdict),
      isNegative: NEGATIVE_VERDICTS.has(r.verdict),
      createdAt: r.createdAt,
    });
  }

  for (const r of signalRows) {
    const w = SIGNAL_WEIGHT[r.signalType];
    if (w === undefined) continue;
    const hs = r.hookStyle ?? classifyHookStyle(r.ideaHook);
    bumpRec(structures, r.structure, w);
    bumpRec(hookStyles, hs, w);
    bumpRec(emotionalSpikes, r.emotionalSpike, w);
    bumpRec(formats, r.ideaPattern, w);
    allRows.push({
      structure: r.structure,
      hookStyle: hs,
      emotionalSpike: r.emotionalSpike,
      format: r.ideaPattern,
      isPositive: POSITIVE_SIGNAL_TYPES.has(r.signalType),
      isNegative: NEGATIVE_SIGNAL_TYPES.has(r.signalType),
      createdAt: r.createdAt,
    });
  }

  // Whitelist + clamp before exposing — values outside the canonical
  // taxonomies would just be confusing in the prompt block.
  const structuresClamped = clampRec(filterRec(structures, STRUCTURES));
  const hookStylesClamped = clampRec(filterRec(hookStyles, HOOK_STYLES));
  const emotionalSpikesClamped = clampRec(
    filterRec(emotionalSpikes, EMOTIONAL_SPIKES),
  );
  const formatsClamped = clampRec(filterRec(formats, FORMATS));

  // Sort the unified stream once for the recent-window slicing.
  allRows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const RECENT_WINDOW = 10;
  const positiveRows = allRows
    .filter((r) => r.isPositive)
    .slice(0, RECENT_WINDOW);
  const negativeRows = allRows
    .filter((r) => r.isNegative)
    .slice(0, RECENT_WINDOW);

  const inWhitelist = <T extends string>(
    val: string | null,
    whitelist: readonly T[],
  ): T | null =>
    val !== null && (whitelist as readonly string[]).includes(val)
      ? (val as T)
      : null;

  const toBundle = (r: UnifiedRow): PatternBundle => ({
    structure: inWhitelist(r.structure, STRUCTURES),
    hookStyle: inWhitelist(r.hookStyle, HOOK_STYLES),
    emotionalSpike: inWhitelist(r.emotionalSpike, EMOTIONAL_SPIKES),
    format: inWhitelist(r.format, FORMATS),
    timestamp: r.createdAt.toISOString(),
  });

  const recentAcceptedPatterns = positiveRows.map(toBundle);
  const recentRejectedPatterns = negativeRows.map(toBundle);

  /* -------- MOMENTUM BOOST (Part 4) -------------------------------- */
  // Count tag occurrences across all four dimensions in the last 10
  // positive bundles. 2+ occurrences → 1.4× multiplier; 3+ → 1.7×.
  // Applied at render time (effectiveWeight()) — never written back
  // to stored aggregates so it decays naturally as the window rolls.
  const tagCount = (
    bundles: PatternBundle[],
    dim: "structure" | "hookStyle" | "emotionalSpike" | "format",
  ): Map<string, number> => {
    const c = new Map<string, number>();
    for (const b of bundles) {
      const v = b[dim];
      if (typeof v === "string") c.set(v, (c.get(v) ?? 0) + 1);
    }
    return c;
  };
  const momentumBoosts: MomentumBoost[] = [];
  for (const dim of [
    "structure",
    "hookStyle",
    "emotionalSpike",
    "format",
  ] as const) {
    for (const [tag, n] of tagCount(recentAcceptedPatterns, dim)) {
      const mult: 1.4 | 1.7 | null = n >= 3 ? 1.7 : n >= 2 ? 1.4 : null;
      if (mult !== null) momentumBoosts.push({ tag, dimension: dim, multiplier: mult });
    }
  }

  /* -------- STALE PENALTY (Part 5) --------------------------------- */
  // Only trigger when we have at least 5 accepted bundles to look at
  // — applying a "3 of last 5" check on a window of 3 would be noisy.
  // Penalty is TRANSIENT (subtracted from effective weight at render
  // time, never written back) so rebuilding the window naturally
  // resets it once the user accepts something different.
  const stalePenalties: StalePenalty[] = [];
  const lastFiveAccepted = recentAcceptedPatterns.slice(0, 5);
  if (lastFiveAccepted.length === 5) {
    const struCnt = new Map<string, number>();
    const fmtCnt = new Map<string, number>();
    for (const b of lastFiveAccepted) {
      if (b.structure) struCnt.set(b.structure, (struCnt.get(b.structure) ?? 0) + 1);
      if (b.format) fmtCnt.set(b.format, (fmtCnt.get(b.format) ?? 0) + 1);
    }
    for (const [tag, n] of struCnt) {
      if (n >= 3) stalePenalties.push({ tag, dimension: "structure", penalty: -2 });
    }
    for (const [tag, n] of fmtCnt) {
      if (n >= 4) stalePenalties.push({ tag, dimension: "format", penalty: -1.5 });
    }
  }

  /* -------- TASTE SHIFT (Part 7) ----------------------------------- */
  // A tag the creator just started accepting (3+ in the last 10
  // positive) but whose stored weight is still ≤0 (because the
  // historical window had it at zero or negative) gets a +2
  // promotion bonus. Lets new tastes emerge in 1 session instead of
  // waiting for the slow weight integral to flip.
  const tasteShiftPromotions: TasteShift[] = [];
  const checkShift = (
    rec: Record<string, number>,
    dim: "structure" | "hookStyle" | "emotionalSpike" | "format",
  ): void => {
    for (const [tag, n] of tagCount(recentAcceptedPatterns, dim)) {
      if (n >= 3 && (rec[tag] ?? 0) <= 0) {
        tasteShiftPromotions.push({ tag, dimension: dim, bonus: 2 });
      }
    }
  };
  checkShift(structuresClamped, "structure");
  checkShift(hookStylesClamped, "hookStyle");
  checkShift(emotionalSpikesClamped, "emotionalSpike");
  checkShift(formatsClamped, "format");

  /* -------- EXPLORATION TARGET (Part 6) ---------------------------- */
  // Pick the highest-weighted POSITIVE structure as the anchor, then
  // emit 1-2 ADJACENT structures (from STRUCTURE_ADJACENCY) that
  // currently have weight ≤0 — i.e. structures the creator HASN'T
  // explicitly accepted yet, but that share emotional family with
  // something they DO accept. This is what keeps the batch feeling
  // fresh while still aligned to taste.
  const sortedStructures = Object.entries(structuresClamped)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const anchor = sortedStructures[0]?.[0] as Structure | undefined;
  const adjacent = anchor
    ? STRUCTURE_ADJACENCY[anchor].filter(
        (s) => (structuresClamped[s] ?? 0) <= 0,
      )
    : [];

  return {
    structures: structuresClamped,
    hookStyles: hookStylesClamped,
    emotionalSpikes: emotionalSpikesClamped,
    formats: formatsClamped,
    recentAcceptedPatterns,
    recentRejectedPatterns,
    momentumBoosts,
    stalePenalties,
    tasteShiftPromotions,
    explorationTarget: {
      aligned: anchor ?? null,
      adjacent: adjacent.slice(0, 2),
    },
    lastUpdatedAt: new Date().toISOString(),
    sampleSize: totalRows,
  };
}

/* ------------------------------------------------------------------ */
/* Render the snapshot as a compact prompt block.                      */
/* ------------------------------------------------------------------ */

/**
 * Apply momentum (×) + stale penalty (-) + taste-shift (+) to a base
 * weight. The order matters: momentum is multiplicative, stale is
 * additive (it's a penalty on top of whatever the weight already is),
 * and taste-shift is additive (bonus on top of whatever's there).
 *
 * Returns the effective weight that drives ranking inside
 * `topNFromRecord` — used purely for sorting, never written back.
 */
function effectiveWeight(
  baseWeight: number,
  tag: string,
  dimension: "structure" | "hookStyle" | "emotionalSpike" | "format",
  memory: ViralPatternMemory,
): number {
  let w = baseWeight;
  const mom = memory.momentumBoosts.find(
    (m) => m.tag === tag && m.dimension === dimension,
  );
  if (mom) w *= mom.multiplier;
  if (dimension === "structure" || dimension === "format") {
    const stale = memory.stalePenalties.find(
      (s) => s.tag === tag && s.dimension === dimension,
    );
    if (stale) w += stale.penalty;
  }
  const shift = memory.tasteShiftPromotions.find(
    (s) => s.tag === tag && s.dimension === dimension,
  );
  if (shift) w += shift.bonus;
  return w;
}

function topNFromRecord(
  rec: Record<string, number>,
  n: number,
  liked: boolean,
  dimension: "structure" | "hookStyle" | "emotionalSpike" | "format",
  memory: ViralPatternMemory,
): string[] {
  return Object.entries(rec)
    .map(
      ([k, v]) => [k, effectiveWeight(v, k, dimension, memory)] as [string, number],
    )
    .filter(([, v]) => (liked ? v > 0 : v < 0))
    .sort(([, a], [, b]) => (liked ? b - a : a - b))
    .slice(0, n)
    .map(([k]) => k);
}

/**
 * Render the memory snapshot as a compact prompt block for the
 * ideator system prompt. Returns `null` when the snapshot is empty
 * or has too few signals to be trustworthy — the caller should
 * spread this into the prompt array (see ideaGen.ts) so an empty
 * result is omitted entirely instead of leaking the literal string
 * "null".
 *
 * The prose framing is deliberate: the model is told this is
 * PATTERN-LEVEL memory and given a worked example so it doesn't
 * collapse the bias into topic repetition (the failure mode that
 * killed v0 of this loop on the bench). Emits the Part-9 compact
 * summary: likes, dislikes, momentum boosts, stale penalties,
 * taste-shift promotions, and the per-batch mix instructions.
 */
export function renderViralMemoryPromptBlock(
  memory: ViralPatternMemory,
  batchSize: number = 8,
): string | null {
  if (memory.sampleSize < 3) return null;

  const fmt = (xs: string[]): string =>
    xs.length === 0 ? "(none yet)" : xs.join(", ");

  const lines: string[] = [];
  const push = (label: string, liked: string[], disliked: string[]): void => {
    if (liked.length === 0 && disliked.length === 0) return;
    lines.push(`  • LEAN INTO ${label}: ${fmt(liked)}`);
    lines.push(`  • AVOID ${label}: ${fmt(disliked)}`);
  };

  push(
    "structures",
    topNFromRecord(memory.structures, 3, true, "structure", memory),
    topNFromRecord(memory.structures, 3, false, "structure", memory),
  );
  push(
    "hook styles",
    topNFromRecord(memory.hookStyles, 2, true, "hookStyle", memory),
    topNFromRecord(memory.hookStyles, 2, false, "hookStyle", memory),
  );
  push(
    "emotional spikes",
    topNFromRecord(memory.emotionalSpikes, 2, true, "emotionalSpike", memory),
    topNFromRecord(memory.emotionalSpikes, 2, false, "emotionalSpike", memory),
  );
  push(
    "formats",
    topNFromRecord(memory.formats, 2, true, "format", memory),
    topNFromRecord(memory.formats, 2, false, "format", memory),
  );

  if (lines.length === 0) return null;

  const extras: string[] = [];
  if (memory.momentumBoosts.length > 0) {
    extras.push(
      "  • MOMENTUM (current session, transient): " +
        memory.momentumBoosts
          .map((m) => `${m.tag} (${m.dimension}, ${m.multiplier}×)`)
          .join("; "),
    );
  }
  if (memory.stalePenalties.length > 0) {
    extras.push(
      "  • STALE PENALTY (overused recently — vary it up): " +
        memory.stalePenalties
          .map((s) => `${s.tag} (${s.dimension}, ${s.penalty})`)
          .join("; "),
    );
  }
  if (memory.tasteShiftPromotions.length > 0) {
    extras.push(
      "  • EMERGING TASTE (was neutral, now winning — promoted +2): " +
        memory.tasteShiftPromotions
          .map((s) => `${s.tag} (${s.dimension})`)
          .join("; "),
    );
  }
  if (memory.explorationTarget.aligned) {
    const adj = memory.explorationTarget.adjacent.length > 0
      ? memory.explorationTarget.adjacent.join(" or ")
      : "(none — stretch to a structure adjacent to the anchor in emotional family)";
    extras.push(
      `  • EXPLORATION TARGET: anchor majority on "${memory.explorationTarget.aligned}"; ship ~25% of the batch using ADJACENT structure ${adj} for adjacent exploration (NOT random unrelated structures).`,
    );
  }

  // Batch mix instructions — Part 6 + Part 10 of the spec.
  // The spec demands ~70-80% aligned + ~20-30% adjacent-explore.
  // For tiny batches we have to round; the spec's worked example
  // explicitly calls for 2 aligned / 1 explore at batchSize=3, so
  // we ALWAYS reserve at least 1 explore slot when batchSize ≥ 3.
  // (At batchSize=1 or 2 there's no room for adjacency without
  // tilting the ratio past the upper bound — keep all aligned.)
  // Math.round on 0.25 gives a clean 2 explore at N=8 (= 25%) and
  // 3 explore at N=10 (= 30%), well within the band.
  const explore =
    batchSize >= 3 ? Math.max(1, Math.round(batchSize * 0.25)) : 0;
  const aligned = batchSize - explore;
  const halfCap = Math.ceil(batchSize / 2);
  const batchRules = [
    "",
    "BATCH MIX (Lumina Evolution Engine, HARD):",
    `  • OF ${batchSize} IDEAS → ~${aligned} must align with the LEAN INTO list above; ~${explore} must use the EXPLORATION TARGET above for ADJACENT exploration (never random unrelated structures).`,
    `  • NO MORE THAN ${halfCap} ideas may share the same \`structure\` value across the batch.`,
    `  • NO MORE THAN ${halfCap} ideas may share the same \`hookStyle\` value across the batch.`,
    "  • QUALITY OVERRIDE — even a perfect-memory-match idea must be DROPPED if it has a weak hook, unclear payoff, non-instant-visual, repetitive surface, requires private/sensitive content, or isn't filmable today. Memory is a bias; quality is a gate.",
  ];

  return [
    "=== VIRAL PATTERN MEMORY (PATTERN-LEVEL, NOT TOPIC-LEVEL) ===",
    `Based on this creator's recent ${memory.sampleSize} verdicts + actions, what's earning YES / select / export vs NO / skip across four dimensions:`,
    ...lines,
    ...extras,
    "",
    "KEEP the winning STRUCTURE, swap the SURFACE — this is PATTERN-level memory, not TOPIC-level. If \"denial_loop\" + \"mini_story\" is winning, ship a NEW denial_loop + mini_story idea on a totally DIFFERENT scenario — never reuse the same prop / domain / activity. Worked example: liked \"I told myself I'd cook dinner\" → next batch ships \"I told myself I'd save money\" (same denial_loop + mini_story, fresh surface), NOT \"I told myself I'd cook breakfast\" (same scenario, lazy reuse).",
    ...batchRules,
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Type guard for the jsonb column shape (when read back).             */
/* ------------------------------------------------------------------ */

/**
 * Defensive parse of `creators.viral_pattern_memory_json`. Currently
 * unused — `computeViralPatternMemory` is cheap enough to call per
 * request that we don't bother caching — but kept on the type so a
 * future caching layer can stamp the column without a schema change.
 *
 * Returns null on any malformed input. Conservative shape: copies
 * only the four stored Record dimensions and the recent bundle
 * arrays; transient fields (momentum / stale / taste-shift /
 * exploration) are NEVER read from the cache because they're
 * session-scoped by definition.
 */
export function parseViralPatternMemory(
  raw: unknown,
): ViralPatternMemory | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const rec = (k: string): Record<string, number> => {
    const v = r[k];
    if (!v || typeof v !== "object") return {};
    const out: Record<string, number> = {};
    for (const [kk, vv] of Object.entries(v as Record<string, unknown>)) {
      if (typeof vv === "number") out[kk] = clamp(vv);
    }
    return out;
  };
  const bundles = (k: string): PatternBundle[] => {
    const v = r[k];
    if (!Array.isArray(v)) return [];
    return v
      .filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
      .map((b) => ({
        structure:
          typeof b.structure === "string" &&
          (STRUCTURES as readonly string[]).includes(b.structure)
            ? (b.structure as Structure)
            : null,
        hookStyle:
          typeof b.hookStyle === "string" &&
          (HOOK_STYLES as readonly string[]).includes(b.hookStyle)
            ? (b.hookStyle as HookStyle)
            : null,
        emotionalSpike:
          typeof b.emotionalSpike === "string" &&
          (EMOTIONAL_SPIKES as readonly string[]).includes(b.emotionalSpike)
            ? (b.emotionalSpike as EmotionalSpike)
            : null,
        format:
          typeof b.format === "string" &&
          (FORMATS as readonly string[]).includes(b.format)
            ? (b.format as Format)
            : null,
        timestamp: typeof b.timestamp === "string" ? b.timestamp : "",
      }));
  };
  return {
    structures: rec("structures"),
    hookStyles: rec("hookStyles"),
    emotionalSpikes: rec("emotionalSpikes"),
    formats: rec("formats"),
    recentAcceptedPatterns: bundles("recentAcceptedPatterns"),
    recentRejectedPatterns: bundles("recentRejectedPatterns"),
    momentumBoosts: [],
    stalePenalties: [],
    tasteShiftPromotions: [],
    explorationTarget: { aligned: null, adjacent: [] },
    lastUpdatedAt:
      typeof r.lastUpdatedAt === "string"
        ? r.lastUpdatedAt
        : EMPTY_MEMORY.lastUpdatedAt,
    sampleSize: typeof r.sampleSize === "number" ? r.sampleSize : 0,
  };
}
