/**
 * PHASE Z1-QA — willingness ranker effectiveness report.
 *
 * Dev-gated, ephemeral measurement harness. Closes the Z1
 * observation loop: Z1 reorders the surfaced 3-card feed by
 * (pickerEligible desc, willingnessScore desc), but until we can
 * SEE whether picker-eligible cards actually convert at a higher
 * rate than ineligible ones — and whether high-willingness cards
 * drive more `exported` signals than low-willingness ones — we
 * have no way to validate the ranker's design or tune the floor.
 *
 * Why a route, not a script: the join between `ideator_signal`
 * and the cache envelope on `creators.lastIdeaBatchJson` is too
 * thick for a one-off SQL query (the cache is JSONB-encoded and
 * the willingness fields live nested inside a per-entry `idea`
 * object), and we want the report runnable by anyone with dev
 * access without shipping a one-off binary. Same pattern as the
 * D5-QA anti-copy harness (which was merged-and-removed in the
 * same cycle as D5 ship) — this route is intended to live for
 * the Z1 measurement window and then be deleted.
 *
 * ZERO schema migrations: the Z1 fields (`willingnessScore`,
 * `pickerEligible`, `whyThisFitsYou`) are already persisted
 * inside the cached idea JSON because `annotateAndSortByWillingness`
 * mutates `c.idea` BEFORE `persistCache` writes the envelope.
 * That makes the cache the source of truth for "was this idea
 * eligible when we shipped it" — we read it back at report
 * time and join against the signal table by `(creatorId, hook)`.
 *
 * Endpoint: GET /api/z1-qa/willingness-report
 *   ?days=N            — lookback window (default 7, clamped 1-90)
 *   ?creatorId=<uuid>  — optional single-creator filter
 */

import { Router, type IRouter } from "express";
import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "../db/client";
import { logger } from "../lib/logger";

// -----------------------------------------------------------------------------
// Cache envelope parsing — tolerant by design.
// -----------------------------------------------------------------------------
// We DELIBERATELY don't import `tryParseCachedEnvelope` from
// hybridIdeator — that function is internal to the orchestrator
// and is intentionally strict (a partial parse there means the
// cache is broken and gets re-seeded). Here we want the opposite:
// pull whatever we can from whatever shape the JSON happens to
// be in. A creator with a malformed envelope contributes zero
// hooks to the lookup map; their signals will be classified as
// `unknown_eligibility` in the aggregate.

/** Minimal entry shape — only the fields the report cares about. */
const reportEntrySchema = z
  .object({
    idea: z
      .object({
        hook: z.string().min(1),
        // Z1 fields — optional because pre-Z1 cached entries
        // lack them. Their absence is the signal value here:
        // pre-Z1 hooks land in the `unknown_eligibility` bucket.
        willingnessScore: z.number().min(0).max(100).optional(),
        pickerEligible: z.boolean().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const envelopeSchema = z
  .object({
    current: z.array(reportEntrySchema).default([]),
    history: z.array(z.array(reportEntrySchema)).default([]),
  })
  .passthrough();

export type HookCacheRecord = {
  willingnessScore: number | null;
  pickerEligible: boolean | null;
};

/**
 * Walk one creator's cache envelope and produce a hook → Z1-fields
 * lookup map. When the same hook appears in both `current` and
 * `history`, `current` wins (most-recent-batch attribution).
 */
export function buildHookLookup(rawJson: unknown): Map<string, HookCacheRecord> {
  const out = new Map<string, HookCacheRecord>();
  const parsed = envelopeSchema.safeParse(rawJson);
  if (!parsed.success) return out;
  const env = parsed.data;
  // Walk history first, then current — that way `current`
  // overwrites any history entry with the same hook (set by
  // last-write-wins). The recency preference is intentional:
  // the same hook in both buckets means the same idea shipped
  // in two consecutive batches, and the freshest annotation is
  // the truthful one for any signal fired after that ship.
  for (const batch of env.history) {
    for (const entry of batch) {
      out.set(entry.idea.hook, {
        willingnessScore: entry.idea.willingnessScore ?? null,
        pickerEligible: entry.idea.pickerEligible ?? null,
      });
    }
  }
  for (const entry of env.current) {
    out.set(entry.idea.hook, {
      willingnessScore: entry.idea.willingnessScore ?? null,
      pickerEligible: entry.idea.pickerEligible ?? null,
    });
  }
  return out;
}

// -----------------------------------------------------------------------------
// Aggregator — pure function, unit-testable.
// -----------------------------------------------------------------------------

export type SignalRow = {
  creatorId: string;
  ideaHook: string;
  signalType: string;
  createdAt: Date;
};

export type EligibilityTier = "eligible" | "ineligible" | "unknown";

export type WillingnessReport = {
  windowDays: number;
  totalSignals: number;
  totalCreators: number;
  totalHooksMatched: number;
  totalHooksUnmatched: number;
  /**
   * Per-signal-type breakdown. The KEY question Z1 wants answered
   * is the ratio of eligible vs ineligible inside the `selected`
   * and `exported` buckets — if the ranker is doing its job,
   * eligible-tier counts should dominate both.
   */
  bySignalType: Record<
    string,
    {
      total: number;
      byTier: Record<EligibilityTier, number>;
      /** Median willingness of matched hooks (eligible+ineligible). */
      medianWillingness: number | null;
    }
  >;
  /** Cross-cut: per-tier signal counts so a single number tells
   *  the story "did eligibility predict action". */
  totalsByTier: Record<EligibilityTier, number>;
};

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

export function buildWillingnessReport(
  windowDays: number,
  signals: SignalRow[],
  hookLookupByCreator: Map<string, Map<string, HookCacheRecord>>,
): WillingnessReport {
  const bySignalType = new Map<
    string,
    { total: number; tiers: Record<EligibilityTier, number>; ws: number[] }
  >();
  const totalsByTier: Record<EligibilityTier, number> = {
    eligible: 0,
    ineligible: 0,
    unknown: 0,
  };
  let matched = 0;
  let unmatched = 0;
  const creatorSet = new Set<string>();

  for (const s of signals) {
    creatorSet.add(s.creatorId);
    const lookup = hookLookupByCreator.get(s.creatorId);
    const rec = lookup?.get(s.ideaHook);
    let tier: EligibilityTier;
    if (!rec) {
      tier = "unknown";
      unmatched += 1;
    } else if (rec.pickerEligible === true) {
      tier = "eligible";
      matched += 1;
    } else if (rec.pickerEligible === false) {
      tier = "ineligible";
      matched += 1;
    } else {
      // hook present in cache but Z1 fields missing — pre-Z1 entry.
      tier = "unknown";
      matched += 1;
    }
    totalsByTier[tier] += 1;

    let bucket = bySignalType.get(s.signalType);
    if (!bucket) {
      bucket = {
        total: 0,
        tiers: { eligible: 0, ineligible: 0, unknown: 0 },
        ws: [],
      };
      bySignalType.set(s.signalType, bucket);
    }
    bucket.total += 1;
    bucket.tiers[tier] += 1;
    if (rec && typeof rec.willingnessScore === "number") {
      bucket.ws.push(rec.willingnessScore);
    }
  }

  const out: WillingnessReport["bySignalType"] = {};
  for (const [k, v] of bySignalType) {
    out[k] = {
      total: v.total,
      byTier: v.tiers,
      medianWillingness: median(v.ws),
    };
  }

  return {
    windowDays,
    totalSignals: signals.length,
    totalCreators: creatorSet.size,
    totalHooksMatched: matched,
    totalHooksUnmatched: unmatched,
    bySignalType: out,
    totalsByTier,
  };
}

// -----------------------------------------------------------------------------
// Route — dev-gated, defense-in-depth at handler entry.
// -----------------------------------------------------------------------------

const router: IRouter = Router();

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
  creatorId: z.string().uuid().optional(),
});

// NB: the top-level router is mounted at `/api`, so the path
// here is `/z1-qa/...` not `/api/z1-qa/...` (mirrors the rest
// of this folder — e.g. ideaFeedback uses `/ideas/signal`).
router.get("/z1-qa/willingness-report", async (req, res) => {
  // Defense in depth: even if a misconfigured prod build mounts
  // this router, the handler itself 404s in production. Same
  // discipline D5-QA used.
  if (process.env.NODE_ENV === "production") {
    res.status(404).end();
    return;
  }
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { days, creatorId } = parsed.data;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    // 1) Pull signals in window (optionally filtered to one creator).
    const signalRows = await db
      .select({
        creatorId: schema.ideatorSignal.creatorId,
        ideaHook: schema.ideatorSignal.ideaHook,
        signalType: schema.ideatorSignal.signalType,
        createdAt: schema.ideatorSignal.createdAt,
      })
      .from(schema.ideatorSignal)
      .where(
        and(
          gte(schema.ideatorSignal.createdAt, since),
          creatorId
            ? eq(schema.ideatorSignal.creatorId, creatorId)
            : sql`TRUE`,
        ),
      );

    // 2) Pull cache envelopes for every creator that fired at
    //    least one signal in the window. We only need the JSON
    //    blob — the orchestrator wrote willingnessScore /
    //    pickerEligible directly into each entry's `idea` object.
    const creatorIds = Array.from(new Set(signalRows.map((r) => r.creatorId)));
    const hookLookupByCreator = new Map<
      string,
      Map<string, HookCacheRecord>
    >();
    if (creatorIds.length > 0) {
      const cacheRows = await db
        .select({
          id: schema.creators.id,
          lastIdeaBatchJson: schema.creators.lastIdeaBatchJson,
        })
        .from(schema.creators)
        .where(
          sql`${schema.creators.id} IN (${sql.join(
            creatorIds.map((c) => sql`${c}`),
            sql`, `,
          )})`,
        );
      for (const row of cacheRows) {
        hookLookupByCreator.set(
          row.id,
          buildHookLookup(row.lastIdeaBatchJson),
        );
      }
    }

    const report = buildWillingnessReport(
      days,
      signalRows.map((r) => ({
        creatorId: r.creatorId,
        ideaHook: r.ideaHook,
        signalType: r.signalType,
        createdAt: r.createdAt,
      })),
      hookLookupByCreator,
    );

    res.json(report);
  } catch (err) {
    logger.warn({ err }, "z1_qa.willingness_report.failed");
    res.status(500).json({ error: "report_failed" });
  }
});

export default router;
