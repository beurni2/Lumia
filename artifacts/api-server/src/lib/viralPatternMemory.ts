/**
 * Viral Pattern Memory — per-creator, server-derived "what STRUCTURES
 * earn YES / select / export vs NO / skip" weights.
 *
 * The point of this module (and its corresponding `creators.viral_
 * pattern_memory_json` column) is to bias the next ideator batch
 * toward the STRUCTURAL shapes (pattern × emotionalSpike × payoffType
 * × hookStyle) the creator has already responded to positively, while
 * the VARIATION INJECTION block in `ideaGen.ts` simultaneously forces
 * the SURFACE scenario / prop / domain to be fresh.
 *
 * PATTERN-LEVEL not TOPIC-LEVEL — emphatically. The memory remembers
 * "this creator likes denial + mini_story + punchline payoff", NOT
 * "this creator likes coffee jokes". Topic-level memory would loop
 * the user into a single domain forever; pattern-level memory keeps
 * the structural fit while the variation rule rotates the surface.
 *
 * Pure aggregation — no LLM, no probabilistic weights. Two sources:
 *   1. `idea_feedback` rows (verdict-weighted: yes=+2, maybe=+1,
 *      no=-2)
 *   2. `ideator_signal` rows (action-weighted: exported=+5,
 *      make_another=+4, selected=+3, skipped=-1, abandoned=-1,
 *      regenerated_batch=-0.5)
 *
 * Action signals outweigh verdicts because actions reveal real intent
 * (the creator went to make the video) while verdicts are cheap taps.
 *
 * The aggregator runs on every ideator request — cheap because we cap
 * the window at the last ~50 rows of each table and the indices on
 * (creator_id, created_at desc) make it a single b-tree scan. We do
 * NOT cache the result because feedback is sparse enough (a few rows
 * per day) that re-aggregating per call is simpler than maintaining
 * a write-through cache.
 *
 * Failure mode: any error (DB hiccup, malformed row) returns the
 * empty memory shape. The ideator must NEVER block on memory load.
 */

import { and, desc, eq, gte } from "drizzle-orm";

import { db, schema } from "../db/client";

/** Canonical patterns the ideator emits (same enum as ideaSchema). */
const STRUCTURES = ["pov", "reaction", "mini_story", "contrast"] as const;
/** Canonical emotional spikes (same enum as ideaSchema). */
const SPIKES = [
  "embarrassment",
  "regret",
  "denial",
  "panic",
  "irony",
] as const;
/** Canonical payoff types (same enum as ideaSchema). */
const PAYOFFS = ["reveal", "reaction", "transformation", "punchline"] as const;
/**
 * Hook style is NOT a structured ideator field — the prompt names
 * five styles (Behavior / Thought / Moment / Contrast / Curiosity /
 * POV) but the model only emits the final hook text. We classify
 * post-hoc with the regex below so memory still has a hook-style
 * dimension. Five-bucket coverage is intentional — anything that
 * doesn't match one of the four explicit shapes lands in
 * `moment`, the broadest bucket.
 */
const HOOK_STYLES = [
  "pov",
  "behavior",
  "thought",
  "contrast",
  "moment",
] as const;

export type ViralPatternMemory = {
  /** Top-3 / bottom-3 across {pattern, emotionalSpike, payoffType, hookStyle}. */
  likedStructures: string[];
  dislikedStructures: string[];
  likedEmotionalSpikes: string[];
  dislikedEmotionalSpikes: string[];
  likedPayoffTypes: string[];
  dislikedPayoffTypes: string[];
  likedHookStyles: string[];
  dislikedHookStyles: string[];
  /**
   * ISO timestamp of when this snapshot was computed. Not currently
   * persisted (we recompute per request) but included on the type so
   * a future caching layer can stamp it without a schema change.
   */
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
  likedStructures: [],
  dislikedStructures: [],
  likedEmotionalSpikes: [],
  dislikedEmotionalSpikes: [],
  likedPayoffTypes: [],
  dislikedPayoffTypes: [],
  likedHookStyles: [],
  dislikedHookStyles: [],
  lastUpdatedAt: new Date(0).toISOString(),
  sampleSize: 0,
};

/* ------------------------------------------------------------------ */
/* Hook-style classifier (post-hoc, regex-based).                      */
/* ------------------------------------------------------------------ */

/**
 * Classify a hook into one of the five hook-style buckets. Order
 * matters — "POV: X vs Y" is POV, not contrast; "the way X vs Y" is
 * contrast, not behavior. The cascade is intentional.
 */
export function classifyHookStyle(hook: string): (typeof HOOK_STYLES)[number] {
  const h = hook.trim().toLowerCase();
  if (/^pov[:\s]/.test(h)) return "pov";
  if (/\b(vs\.?|versus)\b/.test(h)) return "contrast";
  if (/^the way (i|you)\b/.test(h)) return "behavior";
  if (/^(why|how come)\b/.test(h)) return "thought";
  return "moment";
}

/* ------------------------------------------------------------------ */
/* Weight tables — single source of truth for memory aggregation.      */
/* ------------------------------------------------------------------ */

const VERDICT_WEIGHT: Record<string, number> = {
  yes: 2,
  maybe: 1,
  no: -2,
};

const SIGNAL_WEIGHT: Record<string, number> = {
  exported: 5,
  make_another: 4,
  selected: 3,
  skipped: -1,
  abandoned: -1,
  regenerated_batch: -0.5,
};

/* ------------------------------------------------------------------ */
/* Aggregation helpers.                                                */
/* ------------------------------------------------------------------ */

type Tally = Map<string, number>;

function bump(tally: Tally, key: string | null | undefined, w: number): void {
  if (!key) return;
  tally.set(key, (tally.get(key) ?? 0) + w);
}

/** Top-N keys by weight, filtered to a known whitelist + threshold. */
function topN(
  tally: Tally,
  whitelist: readonly string[],
  n: number,
  liked: boolean,
): string[] {
  const items = Array.from(tally.entries()).filter(([k]) =>
    (whitelist as readonly string[]).includes(k),
  );
  items.sort((a, b) => (liked ? b[1] - a[1] : a[1] - b[1]));
  // For "liked" we want positive weights; for "disliked" we want
  // negative weights. Anything sitting at 0 is noise and gets
  // dropped from BOTH lists — half-confidence is worse than no
  // signal at all in a small-window aggregator.
  return items
    .filter(([, w]) => (liked ? w > 0 : w < 0))
    .slice(0, n)
    .map(([k]) => k);
}

/* ------------------------------------------------------------------ */
/* Public API.                                                         */
/* ------------------------------------------------------------------ */

/**
 * Build the per-creator memory snapshot. Pulls the recent window
 * from both tables, weights each row, aggregates by dimension, and
 * returns the top-3 liked + top-3 disliked per dimension.
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

  let feedbackRows: Array<{
    ideaPattern: string | null;
    emotionalSpike: string | null;
    ideaPayoffType: string | null;
    ideaHook: string;
    verdict: string;
  }> = [];
  let signalRows: Array<{
    ideaPattern: string | null;
    emotionalSpike: string | null;
    payoffType: string | null;
    ideaHook: string;
    signalType: string;
  }> = [];

  try {
    feedbackRows = await db
      .select({
        ideaPattern: schema.ideaFeedback.ideaPattern,
        emotionalSpike: schema.ideaFeedback.emotionalSpike,
        ideaPayoffType: schema.ideaFeedback.ideaPayoffType,
        ideaHook: schema.ideaFeedback.ideaHook,
        verdict: schema.ideaFeedback.verdict,
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
        ideaPattern: schema.ideatorSignal.ideaPattern,
        emotionalSpike: schema.ideatorSignal.emotionalSpike,
        payoffType: schema.ideatorSignal.payoffType,
        ideaHook: schema.ideatorSignal.ideaHook,
        signalType: schema.ideatorSignal.signalType,
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

  const structures: Tally = new Map();
  const spikes: Tally = new Map();
  const payoffs: Tally = new Map();
  const hookStyles: Tally = new Map();

  for (const r of feedbackRows) {
    const w = VERDICT_WEIGHT[r.verdict];
    if (w === undefined) continue;
    bump(structures, r.ideaPattern, w);
    bump(spikes, r.emotionalSpike, w);
    bump(payoffs, r.ideaPayoffType, w);
    bump(hookStyles, classifyHookStyle(r.ideaHook), w);
  }
  for (const r of signalRows) {
    const w = SIGNAL_WEIGHT[r.signalType];
    if (w === undefined) continue;
    bump(structures, r.ideaPattern, w);
    bump(spikes, r.emotionalSpike, w);
    bump(payoffs, r.payoffType, w);
    bump(hookStyles, classifyHookStyle(r.ideaHook), w);
  }

  return {
    likedStructures: topN(structures, STRUCTURES, 3, true),
    dislikedStructures: topN(structures, STRUCTURES, 3, false),
    likedEmotionalSpikes: topN(spikes, SPIKES, 3, true),
    dislikedEmotionalSpikes: topN(spikes, SPIKES, 3, false),
    likedPayoffTypes: topN(payoffs, PAYOFFS, 3, true),
    dislikedPayoffTypes: topN(payoffs, PAYOFFS, 3, false),
    likedHookStyles: topN(hookStyles, HOOK_STYLES, 3, true),
    dislikedHookStyles: topN(hookStyles, HOOK_STYLES, 3, false),
    lastUpdatedAt: new Date().toISOString(),
    sampleSize: totalRows,
  };
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
 * killed v0 of this loop on the bench).
 */
export function renderViralMemoryPromptBlock(
  memory: ViralPatternMemory,
): string | null {
  if (memory.sampleSize < 3) return null;

  const fmt = (xs: string[]): string => (xs.length === 0 ? "(none yet)" : xs.join(", "));

  // Only emit dimensions where SOMETHING shows up on either side —
  // a dimension with no liked AND no disliked signals tells the
  // model nothing and just adds prompt noise.
  const lines: string[] = [];
  const push = (
    label: string,
    liked: string[],
    disliked: string[],
  ): void => {
    if (liked.length === 0 && disliked.length === 0) return;
    lines.push(`  • LEAN INTO ${label}: ${fmt(liked)}`);
    lines.push(`  • AVOID ${label}: ${fmt(disliked)}`);
  };
  push(
    "patterns",
    memory.likedStructures,
    memory.dislikedStructures,
  );
  push(
    "emotional spikes",
    memory.likedEmotionalSpikes,
    memory.dislikedEmotionalSpikes,
  );
  push(
    "payoff types",
    memory.likedPayoffTypes,
    memory.dislikedPayoffTypes,
  );
  push(
    "hook styles",
    memory.likedHookStyles,
    memory.dislikedHookStyles,
  );

  if (lines.length === 0) return null;

  return [
    "=== VIRAL PATTERN MEMORY (PATTERN-LEVEL, NOT TOPIC-LEVEL) ===",
    `Based on this creator's recent ${memory.sampleSize} verdicts + actions, the structural shapes that earn YES / select / export vs the shapes that earn NO / skip:`,
    ...lines,
    "",
    "KEEP the winning STRUCTURE, swap the SURFACE — this is PATTERN-level memory, not TOPIC-level. If the creator liked \"denial + mini_story\", ship a NEW denial + mini_story idea on a totally DIFFERENT scenario — never reuse the same prop / domain / activity. Worked example: liked \"I told myself I'd cook dinner\" → next batch ships \"I told myself I'd save money\" (same denial + mini_story shape, fresh surface), NOT \"I told myself I'd cook breakfast\" (same scenario, lazy reuse).",
    "Combine with the VARIATION INJECTION rule above: this memory tells you which STRUCTURAL bucket to lean into, the variation rule tells you each idea must hit a DIFFERENT surface scenario.",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Type guard for the jsonb column shape (when read back).             */
/* ------------------------------------------------------------------ */

/**
 * Defensive parse of `creators.viral_pattern_memory_json`. Accepts
 * unknown (matching the schema's `$type<unknown>`) and returns a
 * fully-shaped ViralPatternMemory or null. We currently do NOT
 * persist the snapshot to this column — `computeViralPatternMemory`
 * is cheap enough to call per request — but the column exists for
 * a future caching layer and this parser is the safe entry point
 * for that layer when it lands.
 */
export function parseViralPatternMemory(
  raw: unknown,
): ViralPatternMemory | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const arr = (k: string): string[] =>
    Array.isArray(r[k]) ? (r[k] as unknown[]).filter((x): x is string => typeof x === "string") : [];
  return {
    likedStructures: arr("likedStructures"),
    dislikedStructures: arr("dislikedStructures"),
    likedEmotionalSpikes: arr("likedEmotionalSpikes"),
    dislikedEmotionalSpikes: arr("dislikedEmotionalSpikes"),
    likedPayoffTypes: arr("likedPayoffTypes"),
    dislikedPayoffTypes: arr("dislikedPayoffTypes"),
    likedHookStyles: arr("likedHookStyles"),
    dislikedHookStyles: arr("dislikedHookStyles"),
    lastUpdatedAt:
      typeof r.lastUpdatedAt === "string" ? r.lastUpdatedAt : EMPTY_MEMORY.lastUpdatedAt,
    sampleSize: typeof r.sampleSize === "number" ? r.sampleSize : 0,
  };
}
