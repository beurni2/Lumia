/**
 * N1-FOLLOWUP-NG-CLEAN-IMPLICIT-ANTHROPOMORPH-HQS-FIX runtime QA.
 *
 * 5 cohorts × 5 creators each, in-process via runHybridIdeator.
 * - ng_clean_cold: 1 batch each (5 batches)
 * - ng_clean_memory: 4 sequential batches each (20 batches)
 * - ng_pidgin: 1 batch each (5 batches)
 * - ng_light_pidgin: 1 batch each (5 batches)
 * - western: 1 batch each (5 batches)
 *
 * Memory cohort uses real DB-backed creators (isDemo=true to skip
 * quota/rate-limits, but memory write paths persist regardless of
 * isDemo). Cold cohorts don't need persistence.
 *
 * Constraints honored:
 *   • No product code modified.
 *   • No flag changes.
 *   • Read-only against the candidate stream + creator state.
 */

process.env.LUMINA_NG_PACK_ENABLED = "true";
process.env.LUMINA_NG_PACK_AWARE_RETENTION_ENABLED = "true";
process.env.LUMINA_NG_MEMORY_SOFT_CAP_ENABLED = "true";
process.env.LUMINA_W2_WESTERN_APPROVED_ENABLED = "true";
process.env.LUMINA_W2M_LOCAL_FIRST_REFRESH_ENABLED = "true";
process.env.LUMINA_FALLBACK_GAP_ONLY = "true";
process.env.LUMINA_NG_STYLE_PENALTY_ENABLED = "true";

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runHybridIdeator } from "../src/lib/hybridIdeator.js";
import { styleProfileSchema } from "../src/lib/styleProfile.js";
import { NIGERIAN_CLEAN_CORE_ENTRIES } from "../src/lib/nigerianCleanCorePack.js";
import { db } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import type { Creator } from "../src/db/schema.js";

const CLEAN_HOOKS_NORM: Array<{ id: string; norm: string }> =
  NIGERIAN_CLEAN_CORE_ENTRIES.map((e) => ({
    id: e.id,
    norm: e.hook.toLowerCase().trim(),
  }));

function resolveCleanCoreId(hook: string | undefined): string | null {
  if (!hook) return null;
  const norm = hook.toLowerCase().trim();
  for (const { id, norm: h } of CLEAN_HOOKS_NORM) if (norm === h) return id;
  for (const { id, norm: h } of CLEAN_HOOKS_NORM) if (norm.startsWith(h) || norm.includes(h)) return id;
  return null;
}

const NEW_IMPORTS = new Set(["ng_clean_065","ng_clean_066","ng_clean_067","ng_clean_068","ng_clean_069","ng_clean_070","ng_clean_071"]);

type Cohort = {
  name: string;
  region: "nigeria" | "western" | "india" | "philippines";
  languageStyle: "clean" | "pidgin" | "light_pidgin" | null;
  batchesPerCreator: number;
  creators: number;
};

const COHORTS: Cohort[] = [
  { name: "ng_clean_cold",   region: "nigeria", languageStyle: "clean",         batchesPerCreator: 1, creators: Number(process.env.QA_CREATORS ?? 5) },
  { name: "ng_clean_memory", region: "nigeria", languageStyle: "clean",         batchesPerCreator: 4, creators: Number(process.env.QA_CREATORS ?? 5) },
  { name: "ng_pidgin",       region: "nigeria", languageStyle: "pidgin",        batchesPerCreator: 1, creators: Number(process.env.QA_CREATORS ?? 5) },
  { name: "ng_light_pidgin", region: "nigeria", languageStyle: "light_pidgin",  batchesPerCreator: 1, creators: Number(process.env.QA_CREATORS ?? 5) },
  { name: "western",         region: "western", languageStyle: null,            batchesPerCreator: 1, creators: Number(process.env.QA_CREATORS ?? 5) },
];

const COUNT_PER_BATCH = 6;

type BatchResult = {
  cohort: string;
  creatorId: string;
  creatorIdx: number;
  batchIdx: number;
  durationMs: number;
  shippedHooks: string[];
  shippedCleanCoreIds: Array<string | null>;
  slot0Hook: string;
  slot0CleanCoreId: string | null;
  underfilled: boolean;
  fallbackUsed: boolean | null;
  errors: string[];
  westernPackEntryIdsShipped: string[];
  ngPackEntryIdsShipped: string[];
};

async function insertCreator(name: string, region: string): Promise<Creator> {
  const id = randomUUID();
  const [created] = await db
    .insert(schema.creators)
    .values({
      id,
      authUserId: null,
      name,
      location: region === "nigeria" ? "Lagos, Nigeria" : "Los Angeles, USA",
      niche: "comedy",
      followers: 0,
      currency: "USD",
      imageKey: "stub",
      isDemo: true,
      region: region as any,
    } as any)
    .returning();
  return created as Creator;
}

async function loadCreator(id: string): Promise<Creator> {
  const rows = await db.select().from(schema.creators).where(eq(schema.creators.id, id)).limit(1);
  return rows[0] as Creator;
}

async function deleteCreator(id: string): Promise<void> {
  try { await db.delete(schema.creators).where(eq(schema.creators.id, id)); } catch { /* ignore */ }
}

async function runOneBatch(
  cohort: Cohort,
  creator: Creator,
  creatorIdx: number,
  batchIdx: number,
): Promise<BatchResult> {
  const styleProfile = styleProfileSchema.parse({});
  const tasteCalibrationJson =
    cohort.languageStyle ? { languageStyle: cohort.languageStyle } : null;
  const t0 = Date.now();
  const errors: string[] = [];
  let result: any = null;
  try {
    result = await runHybridIdeator({
      creator,
      region: cohort.region,
      styleProfile,
      count: COUNT_PER_BATCH,
      regenerate: false,
      excludeHooks: [],
      tasteCalibrationJson,
      visionStyleJson: null,
      ctx: { creatorId: creator.id, agentRunId: null },
      usageContext: {
        creatorId: creator.id,
        creatorIsDemo: true,
        ideaRequestCountToday: 0,
        llamaCallsLast2Min: 0,
      },
    } as any);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  const durationMs = Date.now() - t0;

  const ideas: any[] = result?.ideas ?? [];
  const shippedHooks = ideas.map((i: any) => i.hook);
  const shippedCleanCoreIds = shippedHooks.map((h) => resolveCleanCoreId(h));
  const ngPackEntryIdsShipped = ideas
    .map((i: any) => i.nigerianPackEntryId)
    .filter((x: any): x is string => typeof x === "string");
  const westernPackEntryIdsShipped = ideas
    .map((i: any) => i.westernPackEntryId)
    .filter((x: any): x is string => typeof x === "string");

  return {
    cohort: cohort.name,
    creatorId: creator.id,
    creatorIdx,
    batchIdx,
    durationMs,
    shippedHooks,
    shippedCleanCoreIds,
    slot0Hook: shippedHooks[0] ?? "",
    slot0CleanCoreId: shippedCleanCoreIds[0] ?? null,
    underfilled: ideas.length < COUNT_PER_BATCH,
    fallbackUsed: result?.qaTelemetry?.fallbackDecision?.needFallback ?? null,
    errors,
    westernPackEntryIdsShipped,
    ngPackEntryIdsShipped,
  };
}

async function runCohort(cohort: Cohort): Promise<BatchResult[]> {
  const out: BatchResult[] = [];
  const createdIds: string[] = [];
  for (let c = 0; c < cohort.creators; c++) {
    const creator = await insertCreator(`qa-${cohort.name}-${c}`, cohort.region);
    createdIds.push(creator.id);
    for (let b = 0; b < cohort.batchesPerCreator; b++) {
      // Reload creator each batch to pick up persisted memory.
      const cur = b === 0 ? creator : await loadCreator(creator.id);
      const r = await runOneBatch(cohort, cur, c, b);
      out.push(r);
      process.stderr.write(
        `  [${cohort.name}] c${c} b${b}: slot0=${r.slot0CleanCoreId ?? "-"} (${r.shippedHooks.length}/${COUNT_PER_BATCH}, ${r.durationMs}ms)${r.errors.length ? " ERR:" + r.errors[0] : ""}\n`,
      );
    }
  }
  // Cleanup: delete created creators to keep DB clean.
  for (const id of createdIds) await deleteCreator(id);
  return out;
}

async function main() {
  const outDir = path.join(process.cwd(), ".local", "qa-runs");
  fs.mkdirSync(outDir, { recursive: true });
  const fullOutPath = path.join(outDir, "n1_ng_clean_implicit_anthropomorph_hqs_fix.json");
  const summaryOutPath = path.join(outDir, "n1_ng_clean_implicit_anthropomorph_hqs_fix_summary.json");

  const cohortFilter = process.env.COHORT?.trim();
  const cohortsToRun = cohortFilter
    ? COHORTS.filter((c) => c.name === cohortFilter)
    : COHORTS;

  let allResults: BatchResult[] = [];
  // Resume support: if running a single cohort, load prior file.
  if (cohortFilter && fs.existsSync(fullOutPath)) {
    try {
      const prior = JSON.parse(fs.readFileSync(fullOutPath, "utf-8"));
      if (Array.isArray(prior.batches)) {
        allResults = prior.batches.filter((r: BatchResult) => r.cohort !== cohortFilter);
      }
    } catch { /* ignore */ }
  }

  for (const cohort of cohortsToRun) {
    process.stderr.write(`\n=== Running cohort: ${cohort.name} (${cohort.creators}c × ${cohort.batchesPerCreator}b) ===\n`);
    const results = await runCohort(cohort);
    allResults.push(...results);
    fs.writeFileSync(fullOutPath, JSON.stringify({
      phase: "N1-FOLLOWUP-NG-CLEAN-IMPLICIT-ANTHROPOMORPH-HQS-FIX",
      generatedAt: new Date().toISOString(),
      newImports: [...NEW_IMPORTS],
      batches: allResults,
    }, null, 2));
  }

  // Aggregate
  const byCohort: Record<string, BatchResult[]> = {};
  for (const r of allResults) {
    (byCohort[r.cohort] ??= []).push(r);
  }

  const ngCleanResults = [...(byCohort.ng_clean_cold ?? []), ...(byCohort.ng_clean_memory ?? [])];
  const slot0Ids = ngCleanResults.map((r) => r.slot0CleanCoreId).filter((x): x is string => !!x);
  const distinctSlot0Leaders = [...new Set(slot0Ids)];
  const newImportsAtSlot0 = distinctSlot0Leaders.filter((id) => NEW_IMPORTS.has(id));
  const slot0LeaderCounts: Record<string, number> = {};
  for (const id of slot0Ids) slot0LeaderCounts[id] = (slot0LeaderCounts[id] ?? 0) + 1;

  // Memory series — slot-0 progression per creator across 4 batches
  const memorySeries: Record<string, Array<string | null>> = {};
  for (const r of byCohort.ng_clean_memory ?? []) {
    const key = `creator${r.creatorIdx}`;
    if (!memorySeries[key]) memorySeries[key] = [];
    memorySeries[key][r.batchIdx] = r.slot0CleanCoreId;
  }

  // Leak checks
  const ngCleanLeaks = ngCleanResults.flatMap((r) =>
    [...r.ngPackEntryIdsShipped, ...r.westernPackEntryIdsShipped].map((id) => ({
      cohort: r.cohort, creatorId: r.creatorId, batchIdx: r.batchIdx, leakedId: id,
    })),
  );
  const westernLeaks = (byCohort.western ?? []).flatMap((r) =>
    r.shippedCleanCoreIds.filter((id): id is string => !!id).concat(r.ngPackEntryIdsShipped).map((id) => ({
      cohort: r.cohort, creatorId: r.creatorId, batchIdx: r.batchIdx, leakedId: id,
    })),
  );

  const errors = allResults.filter((r) => r.errors.length > 0);
  const underfills = allResults.filter((r) => r.underfilled);

  const summary = {
    phase: "N1-FOLLOWUP-NG-CLEAN-IMPLICIT-ANTHROPOMORPH-HQS-FIX",
    generatedAt: new Date().toISOString(),
    newImports: [...NEW_IMPORTS],
    totals: {
      cohorts: cohortsToRun.length,
      batches: allResults.length,
      errors: errors.length,
      underfills: underfills.length,
    },
    byCohortCounts: Object.fromEntries(
      Object.entries(byCohort).map(([k, v]) => [k, v.length]),
    ),
    ngClean: {
      batches: ngCleanResults.length,
      slot0LeadersDistinct: distinctSlot0Leaders.length,
      slot0LeaderCounts,
      newImportsReachedSlot0: newImportsAtSlot0,
      newImportReachedSlot0AtLeastOnce: newImportsAtSlot0.length > 0,
      distinctLeadersImproved: distinctSlot0Leaders.length >= 3,
    },
    memorySeries,
    leakChecks: {
      ngCleanLeaks: ngCleanLeaks.length,
      westernLeaksToNg: westernLeaks.length,
      ngCleanLeakDetails: ngCleanLeaks.slice(0, 10),
      westernLeakDetails: westernLeaks.slice(0, 10),
    },
    errors: errors.map((r) => ({ cohort: r.cohort, batchIdx: r.batchIdx, msg: r.errors[0] })),
  };

  fs.writeFileSync(summaryOutPath, JSON.stringify(summary, null, 2));

  process.stderr.write(`\n=== SUMMARY ===\n`);
  process.stderr.write(`Total batches: ${allResults.length}, errors: ${errors.length}, underfills: ${underfills.length}\n`);
  process.stderr.write(`ng_clean distinct slot-0 leaders: ${distinctSlot0Leaders.length} (${distinctSlot0Leaders.join(", ")})\n`);
  process.stderr.write(`New imports reached slot 0: ${newImportsAtSlot0.length > 0 ? newImportsAtSlot0.join(", ") : "NONE"}\n`);
  process.stderr.write(`Leaks: ngClean=${ngCleanLeaks.length}, western=${westernLeaks.length}\n`);
  process.stderr.write(`Outputs:\n  ${fullOutPath}\n  ${summaryOutPath}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
