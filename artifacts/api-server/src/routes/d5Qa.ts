/**
 * PHASE D5-QA — ephemeral dev-gated harness for D4 anti-copy
 * reject-source telemetry.
 *
 * GOAL: turn `qaTelemetry.coreNative.antiCopyRejects` (the additive
 * D4 surface that breaks `copied_seed_hook` rejects down by which
 * reference pool — `corpus` vs `style_defs` — the matched seed
 * came from) into a decision-grade aggregate report so D5
 * (threshold / pool tuning) can ship driven by real numbers
 * instead of a guess.
 *
 * Mounted ONLY when `process.env.NODE_ENV !== "production"`. A
 * defense-in-depth handler-entry re-check 404s in production even
 * if a misconfigured deploy somehow mounts the router.
 *
 * Pattern verbatim from PHASE Y11 — merged-and-removed harness:
 * inserts random-UUID NON-demo creators per scenario with
 * grep-friendly `authUserId = "_d5qa_<scenario>_<ts>_<rand>"`,
 * runs `runHybridIdeator` N times with `regenerate=true` so the
 * cache rotates and the recipe loop re-fires, REFETCHES the
 * creator after each batch so `lastIdeaBatchJson` history
 * accumulates and the freshness window sees real prior fingerprints,
 * then DELETEs both creators in `finally{}` (best-effort — errors
 * logged, never block the response).
 *
 * ZERO production code change beyond the additive `qaTelemetry.coreNative.antiCopyRejects` surface in
 * `hybridIdeator.ts`. ZERO new Claude calls (regenerate rotates
 * the existing pattern + core-native paths; Claude fallback only
 * fires under the existing `<3 candidates pass scoring` gate).
 * ZERO schema / migration / cache-shape / public-HTTP-API changes.
 *
 * REPORT SHAPE (per scenario):
 *   - `totalRejects`: total `copied_seed_hook` rejects across all
 *     batches (sum of `bySource.corpus + bySource.style_defs`)
 *   - `bySource`: { corpus, style_defs, ratio_corpus_pct } —
 *     compare ratio_corpus_pct vs the corpus's ~44% pool share
 *     (159/359). If corpus drives ≫44% of rejects, the D3
 *     expansion is over-aggressive.
 *   - `byGate`: { bigram, unigram } — bigram = the long-hook
 *     Jaccard ≥ 0.85 gate; unigram = the short-hook (≤6 token)
 *     Jaccard ≥ 0.6 fallback.
 *   - `jaccardDistribution`: { p50, p75, p90, p99, max,
 *     nearFloor_count, midRange_count, deepMatch_count } —
 *     answers "are rejects clustering at the 0.85 floor (cheap
 *     to soften) or are they all ≥0.95 (real near-copies)?"
 *   - `topHashes`: top-10 most-rejecting seed hashes (with source
 *     + count + an example jaccard). If 10 seeds drive 80% of
 *     rejects, the corpus needs dedup, not threshold tuning.
 *   - `perBatch`: raw per-batch trail for spot-checks.
 *
 * Deletion plan: this file is removed in the same commit that
 * ships D5 tuning, identical to Y11.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import { logger } from "../lib/logger";
import { runHybridIdeator } from "../lib/hybridIdeator";
import type { Creator } from "../db/schema";
import type { AntiCopyMatch } from "../lib/comedyValidation";
import type { AntiCopyRejectsTelemetry } from "../lib/coreCandidateGenerator";

const router: IRouter = Router();

type Scenario = "fresh" | "engaged";

type PerBatchSnapshot = {
  batchIdx: number;
  totalRejects: number;
  bySource: { corpus: number; style_defs: number };
  byGate: { bigram: number; unigram: number };
  sampleCount: number;
};

type ScenarioReport = {
  scenario: Scenario;
  batches: number;
  totalRejects: number;
  bySource: {
    corpus: number;
    style_defs: number;
    ratio_corpus_pct: number;
  };
  byGate: { bigram: number; unigram: number };
  jaccardDistribution: {
    p50: number;
    p75: number;
    p90: number;
    p99: number;
    max: number;
    nearFloor_count: number;   // 0.85 ≤ j < 0.90
    midRange_count: number;    // 0.90 ≤ j < 0.95
    deepMatch_count: number;   // j ≥ 0.95
  };
  topHashes: Array<{
    hash: string;
    source: "corpus" | "style_defs";
    count: number;
    exampleJaccard: number;
  }>;
  perBatch: PerBatchSnapshot[];
};

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

async function insertScenarioCreator(scenario: Scenario): Promise<Creator> {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  const authUserId = `_d5qa_${scenario}_${ts}_${rand}`;
  const tasteCalibrationJson =
    scenario === "engaged"
      ? {
          version: 1,
          completedAt: new Date().toISOString(),
          preferredTone: "dry_subtle",
          effortLevel: "low",
          privacyComfort: "moderate",
          hookStyle: "behavior_hook",
          format: "mini_story",
        }
      : null;
  const [row] = await db
    .insert(schema.creators)
    .values({
      authUserId,
      name: "D5QA Creator",
      location: "—",
      niche: "—",
      imageKey: "creator-1",
      isDemo: false,
      region: "western",
      tasteCalibrationJson,
    })
    .returning();
  return row;
}

async function refetchCreator(creatorId: string): Promise<Creator | undefined> {
  const rows = await db
    .select()
    .from(schema.creators)
    .where(eq(schema.creators.id, creatorId))
    .limit(1);
  return rows[0];
}

async function deleteCreator(creatorId: string): Promise<void> {
  try {
    await db.delete(schema.creators).where(eq(schema.creators.id, creatorId));
  } catch (err) {
    // Best-effort cleanup — never block the response on a transient
    // db hiccup. Orphan rows are identifiable via the `_d5qa_`
    // authUserId prefix and can be hand-cleaned later.
    logger.warn(
      { err, creatorId },
      "d5qa.creator_cleanup_failed",
    );
  }
}

async function runScenario(
  scenario: Scenario,
  batches: number,
): Promise<ScenarioReport> {
  let creator = await insertScenarioCreator(scenario);
  const collected: AntiCopyMatch[] = [];
  const perBatch: PerBatchSnapshot[] = [];
  // Aggregate counts continue past the per-batch sample cap (the
  // D4 sample array is bounded at 20 per batch, but `bySource`
  // counts every reject — same discipline applied here at the
  // cross-batch aggregation layer).
  const bySourceTotal = { corpus: 0, style_defs: 0 };
  const byGateTotal = { bigram: 0, unigram: 0 };

  try {
    for (let i = 0; i < batches; i++) {
      const result = await runHybridIdeator({
        region: "western",
        count: 3,
        regenerate: true,
        tasteCalibrationJson: creator.tasteCalibrationJson,
        visionStyleJson: creator.visionStyleJson,
        ctx: { creatorId: creator.id },
        creator,
      });
      const ac: AntiCopyRejectsTelemetry | undefined =
        result.qaTelemetry?.coreNative?.antiCopyRejects;
      const bySource = ac?.bySource ?? { corpus: 0, style_defs: 0 };
      const samples = ac?.samples ?? [];
      bySourceTotal.corpus += bySource.corpus;
      bySourceTotal.style_defs += bySource.style_defs;
      const batchByGate = { bigram: 0, unigram: 0 };
      for (const m of samples) {
        collected.push(m);
        byGateTotal[m.gate] += 1;
        batchByGate[m.gate] += 1;
      }
      perBatch.push({
        batchIdx: i,
        totalRejects: bySource.corpus + bySource.style_defs,
        bySource,
        byGate: batchByGate,
        sampleCount: samples.length,
      });
      // Refetch so the next iteration's `lastIdeaBatchJson` reflects
      // the just-persisted batch — without this the freshness
      // window stays empty and every batch sees a cold-start.
      const refreshed = await refetchCreator(creator.id);
      if (refreshed) creator = refreshed;
    }
  } finally {
    await deleteCreator(creator.id);
  }

  const totalRejects = bySourceTotal.corpus + bySourceTotal.style_defs;
  const ratio_corpus_pct =
    totalRejects > 0
      ? Math.round((bySourceTotal.corpus / totalRejects) * 1000) / 10
      : 0;

  const jaccards = collected.map((m) => m.jaccard).sort((a, b) => a - b);
  const nearFloor = collected.filter(
    (m) => m.jaccard >= 0.85 && m.jaccard < 0.9,
  ).length;
  const midRange = collected.filter(
    (m) => m.jaccard >= 0.9 && m.jaccard < 0.95,
  ).length;
  const deepMatch = collected.filter((m) => m.jaccard >= 0.95).length;

  // top-10 most-rejecting seeds across the run
  const byHash = new Map<
    string,
    { hash: string; source: "corpus" | "style_defs"; count: number; exampleJaccard: number }
  >();
  for (const m of collected) {
    const cur = byHash.get(m.hash);
    if (cur) {
      cur.count += 1;
    } else {
      byHash.set(m.hash, {
        hash: m.hash,
        source: m.source,
        count: 1,
        exampleJaccard: m.jaccard,
      });
    }
  }
  const topHashes = Array.from(byHash.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    scenario,
    batches,
    totalRejects,
    bySource: { ...bySourceTotal, ratio_corpus_pct },
    byGate: byGateTotal,
    jaccardDistribution: {
      p50: Math.round(quantile(jaccards, 0.5) * 1000) / 1000,
      p75: Math.round(quantile(jaccards, 0.75) * 1000) / 1000,
      p90: Math.round(quantile(jaccards, 0.9) * 1000) / 1000,
      p99: Math.round(quantile(jaccards, 0.99) * 1000) / 1000,
      max: jaccards.length > 0 ? jaccards[jaccards.length - 1] : 0,
      nearFloor_count: nearFloor,
      midRange_count: midRange,
      deepMatch_count: deepMatch,
    },
    topHashes,
    perBatch,
  };
}

router.post("/d5-qa/anti-copy-report", async (req: Request, res: Response) => {
  // Defense-in-depth: refuse to serve in production even if the
  // mount-time gate in `routes/index.ts` somehow lets us through.
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "not_found" });
  }
  const batches = Math.max(
    1,
    Math.min(50, Number.parseInt(String(req.query.batches ?? "10"), 10) || 10),
  );
  const scenariosRaw = String(req.query.scenarios ?? "fresh,engaged");
  const scenarios: Scenario[] = scenariosRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is Scenario => s === "fresh" || s === "engaged");
  if (scenarios.length === 0) {
    return res
      .status(400)
      .json({ error: "scenarios must contain at least one of: fresh, engaged" });
  }

  const startedAt = Date.now();
  const reports: ScenarioReport[] = [];
  for (const scenario of scenarios) {
    try {
      reports.push(await runScenario(scenario, batches));
    } catch (err) {
      logger.error({ err, scenario }, "d5qa.scenario_failed");
      return res.status(500).json({
        error: "scenario_failed",
        scenario,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return res.json({
    phase: "D5-QA",
    durationMs: Date.now() - startedAt,
    batchesPerScenario: batches,
    note:
      "Compare bySource.ratio_corpus_pct vs the corpus pool share (~44%, 159/359). " +
      "Compare jaccardDistribution.nearFloor_count vs deepMatch_count to decide if " +
      "the 0.85 floor is too aggressive. If topHashes is concentrated, dedup the " +
      "corpus instead of moving thresholds.",
    reports,
  });
});

export default router;
