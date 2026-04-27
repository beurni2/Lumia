/**
 * Per-creator FORMAT (pattern) distribution targeting for the ideator.
 *
 * Why this exists
 * ---------------
 * Earlier the prompt enforced batch variety on its own (every pair of
 * ideas must differ in ≥2 of {pattern, setting, emotionalSpike}). That
 * produces *fresh-feeling* batches, but it does not personalise — every
 * creator gets roughly the same pattern mix regardless of whether they
 * keep saying "no" to e.g. all the contrast ideas.
 *
 * This module turns the binary YES / MAYBE / NO feedback (already
 * captured in `idea_feedback`) into a per-creator target distribution
 * over the four canonical patterns:
 *
 *   pov · reaction · mini_story · contrast
 *
 * The defaults are deliberately mini-story-heavy:
 *
 *   mini_story 70 · reaction 20 · pov 10 · contrast 0
 *
 * — `mini_story` is the DEFAULT shape for every batch. It carries the
 * strongest "would you post this" retention for the 1K–50K tier
 * because the trigger+reaction beat is built into the format itself
 * (setup → trigger → reaction → payoff inside 15–25s). `reaction` is
 * the second-line format for moments with a strong emotional spike
 * (panic / regret / denial) that are instantly visual. `pov` is
 * gated — only used when the hook is very strong, the tension is
 * unmistakable, and the angle feels personal (not a generic
 * "POV: you…" template). `contrast` only appears once a creator has
 * actively asked for it (via positive feedback) since "before/after"
 * setups are easy to do badly and we'd rather not introduce them
 * blind.
 *
 * Weak-mini-story rule (the non-obvious one): if a mini_story idea
 * isn't landing, the answer is to generate a BETTER mini_story —
 * never to silently fall back to POV. The format counts in the
 * prompt block enforce this; the ideator rebuilds inside the slot.
 *
 * Adaptation rules (in order)
 * ---------------------------
 * 1. Suppression — if a pattern has accumulated ≥ SUPPRESS_NO_THRESHOLD
 *    NO verdicts and zero YES verdicts, it's suppressed (target = 0)
 *    until a YES arrives. This is the "strong preference" rule from
 *    the spec.
 * 2. Per-pattern signal score — yes = +SIGNAL_STEP, no = −SIGNAL_STEP,
 *    maybe = 0. The score shifts the pattern's base target additively.
 * 3. Floor — any non-suppressed pattern that has appeared keeps a small
 *    floor (FLOOR_NONZERO) so a single NO never collapses it to zero
 *    before the suppression rule fires.
 * 4. Renormalise — non-suppressed targets are scaled to sum to 100.
 *
 * Personalisation > variety
 * -------------------------
 * Once the distribution skews enough that a batch of 3 yields e.g. 2
 * mini_story slots, the ideator is told to *fill those slots* even at
 * the cost of pattern variety. The pairwise variety rule still applies
 * across `setting` and `emotionalSpike`, so the batch never feels
 * formulaic — but the format mix follows the user's taste.
 *
 * Demo / no-feedback path
 * -----------------------
 * Creators with no feedback rows (new users, the seeded demo creator)
 * receive the default distribution unchanged.
 */

import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import { db, schema } from "../db/client";
import { logger } from "./logger";

export type Pattern = "pov" | "reaction" | "mini_story" | "contrast";

export type FormatDistribution = {
  pov: number;
  reaction: number;
  mini_story: number;
  contrast: number;
};

export type FormatDistributionResult = {
  /** Target percentages, summing to 100 over non-suppressed patterns. */
  targets: FormatDistribution;
  /** Patterns currently suppressed (target = 0). */
  suppressed: Pattern[];
  /** Per-pattern verdict counts used to compute the targets. */
  signal: Record<Pattern, { yes: number; maybe: number; no: number }>;
  /** Whether any feedback was applied (false → defaults). */
  adapted: boolean;
};

const PATTERNS: Pattern[] = ["pov", "reaction", "mini_story", "contrast"];

const DEFAULTS: FormatDistribution = {
  mini_story: 70,
  reaction: 20,
  pov: 10,
  contrast: 0,
};

/** How many recent feedback rows to consider per creator. */
const FEEDBACK_WINDOW = 30;

/** ≥ this many NO verdicts (with 0 YES) → suppress the pattern. */
const SUPPRESS_NO_THRESHOLD = 3;

/** Each YES/NO shifts the pattern's target by ±SIGNAL_STEP percentage points. */
const SIGNAL_STEP = 10;

/** Floor for any non-suppressed pattern that has appeared at least once. */
const FLOOR_NONZERO = 5;

/** Hard cap on any single pattern after adjustment, before normalisation. */
const PATTERN_CAP = 70;

function emptySignal(): Record<Pattern, { yes: number; maybe: number; no: number }> {
  return {
    pov: { yes: 0, maybe: 0, no: 0 },
    reaction: { yes: 0, maybe: 0, no: 0 },
    mini_story: { yes: 0, maybe: 0, no: 0 },
    contrast: { yes: 0, maybe: 0, no: 0 },
  };
}

function isPattern(s: string | null): s is Pattern {
  return s === "pov" || s === "reaction" || s === "mini_story" || s === "contrast";
}

/**
 * Pure function — given the per-pattern feedback signal and an
 * optional baseline distribution, compute the target distribution.
 * Exported for testing / debugging via the API.
 *
 * The `baseline` argument lets the optional Taste Calibration seed
 * the floor (e.g. `mini_story 60 / reaction 30 / pov 10 / contrast 0`
 * for a creator who picked mini_story on Q1). When omitted we fall
 * back to the conservative platform default. Feedback ALWAYS layers
 * on top of whichever baseline is in effect — "behaviour beats
 * stated preference" is the explicit spec rule.
 */
export function distributionFromSignal(
  signal: Record<Pattern, { yes: number; maybe: number; no: number }>,
  baseline?: FormatDistribution,
): FormatDistributionResult {
  const floor: FormatDistribution = baseline ?? DEFAULTS;
  const suppressed: Pattern[] = [];
  const adjusted: FormatDistribution = { ...floor };
  let anySignal = false;

  for (const p of PATTERNS) {
    const s = signal[p];
    const total = s.yes + s.maybe + s.no;
    if (total > 0) anySignal = true;

    // Rule 1: suppression.
    if (s.no >= SUPPRESS_NO_THRESHOLD && s.yes === 0) {
      suppressed.push(p);
      adjusted[p] = 0;
      continue;
    }

    // Rule 2: signal score (yes = +step, no = −step) on top of the
    // calibrated floor (or default when no calibration on file).
    const delta = (s.yes - s.no) * SIGNAL_STEP;
    let next = floor[p] + delta;

    // Rule 3: floor — if the pattern has appeared and isn't suppressed,
    // keep it visible.
    if (total > 0 && next < FLOOR_NONZERO) next = FLOOR_NONZERO;

    // Hard cap before normalisation, so a 5-yes streak doesn't crush
    // the other patterns to ~zero.
    if (next > PATTERN_CAP) next = PATTERN_CAP;
    if (next < 0) next = 0;
    adjusted[p] = next;
  }

  // Rule 4: renormalise to sum to 100 across non-suppressed.
  const sum = PATTERNS.reduce((acc, p) => acc + adjusted[p], 0);
  if (sum > 0) {
    for (const p of PATTERNS) {
      adjusted[p] = Math.round((adjusted[p] / sum) * 100);
    }
    // Fix rounding drift to land exactly on 100.
    const drift = 100 - PATTERNS.reduce((acc, p) => acc + adjusted[p], 0);
    if (drift !== 0) {
      // Apply drift to the largest non-suppressed pattern.
      const largest = PATTERNS
        .filter((p) => !suppressed.includes(p))
        .sort((a, b) => adjusted[b] - adjusted[a])[0];
      if (largest) adjusted[largest] += drift;
    }
  } else {
    // Pathological: every adjusted target collapsed to zero (e.g.
    // every pattern got suppressed in one batch of feedback). Fall
    // back to the floor (calibrated baseline OR the default) so the
    // prompt block stays coherent — and CRUCIALLY clear `suppressed`
    // too. Otherwise the prompt would declare "DO NOT use any of
    // {pov, reaction, mini_story, contrast}" while still asking for
    // ideas, which is contradictory and would either crash the model
    // or produce garbage. Treat it as a signal-reset and let the next
    // round of feedback re-shape.
    Object.assign(adjusted, floor);
    suppressed.length = 0;
  }

  return {
    targets: adjusted,
    suppressed,
    signal,
    adapted: anySignal,
  };
}

/**
 * Look up the per-creator format distribution from the most recent
 * FEEDBACK_WINDOW feedback rows that have a non-null pattern.
 *
 * `baseline` is the optional calibrated floor — when the creator has
 * filled out the Taste Calibration step, ideaGen passes the result of
 * `distributionFloorFromCalibration(...)` here so the floor reflects
 * stated preference. Feedback signal still layers on top.
 *
 * Returns the (baseline-or-default) distribution on any error or
 * when there's no usable signal — the ideator must never block on
 * this lookup.
 */
export async function computeFormatDistribution(
  creatorId: string | null | undefined,
  baseline?: FormatDistribution,
): Promise<FormatDistributionResult> {
  const floor: FormatDistribution = baseline ?? DEFAULTS;
  if (!creatorId) {
    return {
      targets: { ...floor },
      suppressed: [],
      signal: emptySignal(),
      adapted: false,
    };
  }

  try {
    const rows = await db
      .select({
        pattern: schema.ideaFeedback.ideaPattern,
        verdict: schema.ideaFeedback.verdict,
      })
      .from(schema.ideaFeedback)
      .where(
        and(
          eq(schema.ideaFeedback.creatorId, creatorId),
          isNotNull(schema.ideaFeedback.ideaPattern),
        ),
      )
      .orderBy(desc(schema.ideaFeedback.createdAt))
      .limit(FEEDBACK_WINDOW);

    const signal = emptySignal();
    for (const r of rows) {
      if (!isPattern(r.pattern)) continue;
      if (r.verdict === "yes") signal[r.pattern].yes += 1;
      else if (r.verdict === "no") signal[r.pattern].no += 1;
      else if (r.verdict === "maybe") signal[r.pattern].maybe += 1;
    }

    return distributionFromSignal(signal, baseline);
  } catch (err) {
    logger.warn(
      { err: String(err), creatorId },
      "[format-distribution] lookup failed — using defaults",
    );
    return {
      targets: { ...floor },
      suppressed: [],
      signal: emptySignal(),
      adapted: false,
    };
  }
}

/**
 * Render the distribution result as a prompt block the ideator can
 * follow. Includes integer counts for the target batch size so the
 * model doesn't have to do the percent → count math itself.
 */
export function formatDistributionPromptBlock(
  res: FormatDistributionResult,
  batchSize: number,
): string {
  const counts = patternCountsForBatch(res.targets, batchSize, res.suppressed);
  const allowed = PATTERNS.filter((p) => !res.suppressed.includes(p));

  const lines: string[] = [];
  lines.push("=== FORMAT DISTRIBUTION (per-creator, follow this) ===");
  if (res.adapted) {
    lines.push(
      "This distribution is derived from THIS creator's recent Yes/Maybe/No feedback. Match it — personalisation beats raw variety.",
    );
  } else {
    lines.push(
      "Default distribution (this creator has no actionable feedback yet). Match it — these are the formats that work for early-stage micro-creators.",
    );
  }
  lines.push("");
  lines.push("Target percentages (sum to 100):");
  for (const p of allowed) {
    lines.push(`  • ${p.padEnd(11)} ${res.targets[p]}%`);
  }
  if (res.suppressed.length > 0) {
    lines.push("");
    lines.push(
      `SUPPRESSED — DO NOT use these patterns at all (creator has rejected them repeatedly): ${res.suppressed.join(", ")}.`,
    );
  }
  lines.push("");
  lines.push(`For this batch of ${batchSize}, produce exactly:`);
  for (const p of allowed) {
    if (counts[p] > 0) {
      lines.push(`  • ${counts[p]}× ${p}`);
    }
  }
  lines.push("");
  lines.push(
    "Variety still matters WITHIN the format mix — every pair of ideas must differ in at least TWO of {setting, emotionalSpike, triggerCategory}. But do NOT reach for a different `pattern` to satisfy variety; the format counts above are the target.",
  );
  return lines.join("\n");
}

/**
 * Convert percentages into per-pattern integer counts for a batch.
 * Largest-remainder method — rounds correctly so the counts sum to
 * batchSize even when percentages don't divide cleanly.
 */
export function patternCountsForBatch(
  targets: FormatDistribution,
  batchSize: number,
  suppressed: Pattern[],
): Record<Pattern, number> {
  const allowed = PATTERNS.filter((p) => !suppressed.includes(p));
  const raw = new Map<Pattern, number>();
  let floorSum = 0;
  for (const p of allowed) {
    const v = (targets[p] / 100) * batchSize;
    raw.set(p, v);
    floorSum += Math.floor(v);
  }

  const counts: Record<Pattern, number> = {
    pov: 0,
    reaction: 0,
    mini_story: 0,
    contrast: 0,
  };
  for (const p of allowed) counts[p] = Math.floor(raw.get(p) ?? 0);

  // Distribute the remainder by the largest fractional part.
  let remainder = batchSize - floorSum;
  const fractional = allowed
    .map((p) => ({ p, frac: (raw.get(p) ?? 0) - Math.floor(raw.get(p) ?? 0) }))
    .sort((a, b) => b.frac - a.frac);
  let i = 0;
  while (remainder > 0 && fractional.length > 0) {
    counts[fractional[i % fractional.length].p] += 1;
    remainder -= 1;
    i += 1;
  }

  return counts;
}

/**
 * Count the patterns of ideas already produced in the main batch.
 * Used by the deficit-fill prompt so the top-up call can lean toward
 * under-represented patterns instead of redistributing from scratch.
 */
export function countProducedByPattern(
  produced: ReadonlyArray<{ pattern?: string | null }>,
): Record<Pattern, number> {
  const out: Record<Pattern, number> = {
    pov: 0,
    reaction: 0,
    mini_story: 0,
    contrast: 0,
  };
  for (const i of produced) {
    if (isPattern(i.pattern ?? null)) out[i.pattern as Pattern] += 1;
  }
  return out;
}

/**
 * Render the per-pattern guidance block for the count-guarantee
 * top-up call. Goal: keep the FINAL batch matching the per-creator
 * target distribution — so we tell the model what's still missing,
 * not the full-batch percentages (which would re-bias from scratch).
 */
export function formatDeficitDistributionPromptBlock(
  res: FormatDistributionResult,
  fullBatchSize: number,
  alreadyProduced: Record<Pattern, number>,
  deficit: number,
): string {
  const fullCounts = patternCountsForBatch(
    res.targets,
    fullBatchSize,
    res.suppressed,
  );
  const allowed = PATTERNS.filter((p) => !res.suppressed.includes(p));

  // Residual = how many of each pattern we still owe to hit the
  // original target. Clamp at 0 — over-produced patterns just don't
  // need more.
  const residual: Record<Pattern, number> = {
    pov: 0,
    reaction: 0,
    mini_story: 0,
    contrast: 0,
  };
  let residualTotal = 0;
  for (const p of allowed) {
    const r = Math.max(0, fullCounts[p] - (alreadyProduced[p] ?? 0));
    residual[p] = r;
    residualTotal += r;
  }

  // If residuals don't sum to the deficit (rare — would only happen
  // when the main batch over-produced one pattern), fall back to a
  // fresh distribution-shaped split for the deficit slots so the
  // prompt still asks for the right number of ideas.
  let target: Record<Pattern, number>;
  if (residualTotal === deficit) {
    target = residual;
  } else if (residualTotal > deficit) {
    // Trim the residuals to exactly `deficit` slots, taking from the
    // patterns with the largest residual first.
    target = { pov: 0, reaction: 0, mini_story: 0, contrast: 0 };
    let left = deficit;
    const sorted = allowed
      .slice()
      .sort((a, b) => residual[b] - residual[a]);
    while (left > 0) {
      let assigned = false;
      for (const p of sorted) {
        if (left <= 0) break;
        if (residual[p] - target[p] > 0) {
          target[p] += 1;
          left -= 1;
          assigned = true;
        }
      }
      if (!assigned) break;
    }
  } else {
    target = patternCountsForBatch(res.targets, deficit, res.suppressed);
  }

  const lines: string[] = [];
  lines.push("=== FORMAT DISTRIBUTION (top-up — keep the final batch on target) ===");
  lines.push(
    `Original per-creator target for the full batch of ${fullBatchSize}:`,
  );
  for (const p of allowed) {
    if (fullCounts[p] > 0) lines.push(`  • ${p.padEnd(11)} ${fullCounts[p]}× (${res.targets[p]}%)`);
  }
  lines.push("");
  lines.push("Already produced in the main batch:");
  for (const p of allowed) {
    lines.push(`  • ${p.padEnd(11)} ${alreadyProduced[p] ?? 0}×`);
  }
  if (res.suppressed.length > 0) {
    lines.push("");
    lines.push(
      `SUPPRESSED — STILL DO NOT use: ${res.suppressed.join(", ")}.`,
    );
  }
  lines.push("");
  lines.push(
    `For these ${deficit} TOP-UP ideas, produce exactly:`,
  );
  for (const p of allowed) {
    if (target[p] > 0) lines.push(`  • ${target[p]}× ${p}`);
  }
  lines.push("");
  lines.push(
    "Personalisation > variety: hit the format counts above even if it means repeating a pattern. Variety still applies across {setting, emotionalSpike, triggerCategory} so the top-up doesn't echo the main batch.",
  );
  return lines.join("\n");
}

// Quiet "unused import" warning for sql in future debug helpers.
void sql;
