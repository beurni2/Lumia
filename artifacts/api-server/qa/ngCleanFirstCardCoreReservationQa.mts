/**
 * N1-FOLLOWUP-NG-CLEAN-FIRST-CARD-CORE-RESERVATION runtime QA.
 *
 * Verifies the new staging-flag-gated reservation helper raises the
 * count of distinct slot-0 leaders in the ng_clean memory cohort
 * from the prior baseline of 2 to ≥3 (preferred 4-5).
 *
 * Cohorts:
 *   • ng_clean_memory: 5 creators × 5 sequential batches each
 *   • ng_pidgin       : 5 creators × 1 batch (leak check)
 *   • ng_light_pidgin : 5 creators × 1 batch (leak check)
 *   • western         : 5 creators × 1 batch (leak check)
 *   • ng_clean_cold   : 5 creators × 1 batch (cold smoke)
 */

process.env.LUMINA_NG_PACK_ENABLED = "true";
process.env.LUMINA_NG_PACK_AWARE_RETENTION_ENABLED = "true";
process.env.LUMINA_NG_MEMORY_SOFT_CAP_ENABLED = "true";
process.env.LUMINA_W2_WESTERN_APPROVED_ENABLED = "true";
process.env.LUMINA_W2M_LOCAL_FIRST_REFRESH_ENABLED = "true";
process.env.LUMINA_FALLBACK_GAP_ONLY = "true";
process.env.LUMINA_NG_STYLE_PENALTY_ENABLED = "true";
process.env.LUMINA_NG_CLEAN_SLOT0_MEMORY_AWARE_PICKER_ENABLED = "true";
process.env.LUMINA_NG_CLEAN_FIRST_CARD_RESERVATION_ENABLED = "true";

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
  NIGERIAN_CLEAN_CORE_ENTRIES.map((e) => ({ id: e.id, norm: e.hook.toLowerCase().trim() }));

function resolveCleanCoreId(hook: string | undefined): string | null {
  if (!hook) return null;
  const norm = hook.toLowerCase().trim();
  for (const { id, norm: h } of CLEAN_HOOKS_NORM) if (norm === h) return id;
  for (const { id, norm: h } of CLEAN_HOOKS_NORM) if (norm.startsWith(h) || norm.includes(h)) return id;
  return null;
}

type Cohort = {
  name: string;
  region: "nigeria" | "western" | "india" | "philippines";
  languageStyle: "clean" | "pidgin" | "light_pidgin" | null;
  batchesPerCreator: number;
  creators: number;
};

const NC = Number(process.env.QA_CREATORS ?? 5);
const NB = Number(process.env.QA_MEM_BATCHES ?? 5);
const COHORTS: Cohort[] = [
  { name: "ng_clean_memory", region: "nigeria", languageStyle: "clean",        batchesPerCreator: NB, creators: NC },
  { name: "ng_clean_cold",   region: "nigeria", languageStyle: "clean",        batchesPerCreator: 1,  creators: NC },
  { name: "ng_pidgin",       region: "nigeria", languageStyle: "pidgin",       batchesPerCreator: 1,  creators: NC },
  { name: "ng_light_pidgin", region: "nigeria", languageStyle: "light_pidgin", batchesPerCreator: 1,  creators: NC },
  { name: "western",         region: "western", languageStyle: null,           batchesPerCreator: 1,  creators: NC },
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
  const [created] = await db.insert(schema.creators).values({
    id, authUserId: null, name,
    location: region === "nigeria" ? "Lagos, Nigeria" : "Los Angeles, USA",
    niche: "comedy", followers: 0, currency: "USD", imageKey: "stub",
    isDemo: true, region: region as any,
  } as any).returning();
  return created as Creator;
}
async function loadCreator(id: string): Promise<Creator> {
  const rows = await db.select().from(schema.creators).where(eq(schema.creators.id, id)).limit(1);
  return rows[0] as Creator;
}
async function deleteCreator(id: string): Promise<void> {
  try { await db.delete(schema.creators).where(eq(schema.creators.id, id)); } catch { /* ignore */ }
}

async function runOneBatch(cohort: Cohort, creator: Creator, creatorIdx: number, batchIdx: number): Promise<BatchResult> {
  const styleProfile = styleProfileSchema.parse({});
  const tasteCalibrationJson = cohort.languageStyle ? { languageStyle: cohort.languageStyle } : null;
  const t0 = Date.now();
  const errors: string[] = [];
  let result: any = null;
  try {
    result = await runHybridIdeator({
      creator, region: cohort.region, styleProfile, count: COUNT_PER_BATCH,
      regenerate: false, excludeHooks: [], tasteCalibrationJson, visionStyleJson: null,
      ctx: { creatorId: creator.id, agentRunId: null },
      usageContext: { creatorId: creator.id, creatorIsDemo: true, ideaRequestCountToday: 0, llamaCallsLast2Min: 0 },
    } as any);
  } catch (err) { errors.push(err instanceof Error ? err.message : String(err)); }
  const durationMs = Date.now() - t0;
  const ideas: any[] = result?.ideas ?? [];
  const shippedHooks = ideas.map((i: any) => i.hook);
  const shippedCleanCoreIds = shippedHooks.map((h) => resolveCleanCoreId(h));
  const ngPackEntryIdsShipped = ideas.map((i: any) => i.nigerianPackEntryId).filter((x: any): x is string => typeof x === "string");
  const westernPackEntryIdsShipped = ideas.map((i: any) => i.westernPackEntryId).filter((x: any): x is string => typeof x === "string");
  return {
    cohort: cohort.name, creatorId: creator.id, creatorIdx, batchIdx, durationMs,
    shippedHooks, shippedCleanCoreIds,
    slot0Hook: shippedHooks[0] ?? "",
    slot0CleanCoreId: shippedCleanCoreIds[0] ?? null,
    underfilled: ideas.length < COUNT_PER_BATCH,
    fallbackUsed: result?.qaTelemetry?.fallbackDecision?.needFallback ?? null,
    errors, westernPackEntryIdsShipped, ngPackEntryIdsShipped,
  };
}

async function runCohort(cohort: Cohort): Promise<BatchResult[]> {
  const out: BatchResult[] = [];
  const createdIds: string[] = [];
  for (let c = 0; c < cohort.creators; c++) {
    const creator = await insertCreator(`qa-ngcfccr-${cohort.name}-${c}`, cohort.region);
    createdIds.push(creator.id);
    for (let b = 0; b < cohort.batchesPerCreator; b++) {
      const cur = b === 0 ? creator : await loadCreator(creator.id);
      const r = await runOneBatch(cohort, cur, c, b);
      out.push(r);
      process.stderr.write(`  [${cohort.name}] c${c} b${b}: slot0=${r.slot0CleanCoreId ?? "-"} (${r.shippedHooks.length}/${COUNT_PER_BATCH}, ${r.durationMs}ms)${r.errors.length ? " ERR:" + r.errors[0] : ""}\n`);
    }
  }
  for (const id of createdIds) await deleteCreator(id);
  return out;
}

async function main() {
  const outDir = path.join(process.cwd(), "..", "..", ".local", "qa-runs");
  fs.mkdirSync(outDir, { recursive: true });
  const fullOutPath = path.join(outDir, "n1_followup_ng_clean_first_card_core_reservation.json");
  const summaryOutPath = path.join(outDir, "n1_followup_ng_clean_first_card_core_reservation_summary.json");

  const cohortFilter = process.env.COHORT?.trim();
  const cohortsToRun = cohortFilter
    ? COHORTS.filter((c) => c.name === cohortFilter)
    : COHORTS;
  let allResults: BatchResult[] = [];
  if (cohortFilter && fs.existsSync(fullOutPath)) {
    try {
      const prior = JSON.parse(fs.readFileSync(fullOutPath, "utf-8"));
      if (Array.isArray(prior.batches)) {
        allResults = prior.batches.filter((r: BatchResult) => r.cohort !== cohortFilter);
      }
    } catch { /* ignore */ }
  }
  for (const cohort of cohortsToRun) {
    process.stderr.write(`\n=== Cohort: ${cohort.name} (${cohort.creators}c × ${cohort.batchesPerCreator}b) ===\n`);
    const results = await runCohort(cohort);
    allResults.push(...results);
    fs.writeFileSync(fullOutPath, JSON.stringify({
      phase: "N1-FOLLOWUP-NG-CLEAN-FIRST-CARD-CORE-RESERVATION",
      generatedAt: new Date().toISOString(),
      flagsActive: { LUMINA_NG_CLEAN_FIRST_CARD_RESERVATION_ENABLED: true },
      batches: allResults,
    }, null, 2));
  }

  const byCohort: Record<string, BatchResult[]> = {};
  for (const r of allResults) (byCohort[r.cohort] ??= []).push(r);

  const memBatches = byCohort.ng_clean_memory ?? [];
  const memSlot0Ids = memBatches.map((r) => r.slot0CleanCoreId).filter((x): x is string => !!x);
  const memDistinct = [...new Set(memSlot0Ids)];
  const memCounts: Record<string, number> = {};
  for (const id of memSlot0Ids) memCounts[id] = (memCounts[id] ?? 0) + 1;

  const memorySeries: Record<string, Array<string | null>> = {};
  for (const r of memBatches) {
    const key = `creator${r.creatorIdx}`;
    if (!memorySeries[key]) memorySeries[key] = [];
    memorySeries[key][r.batchIdx] = r.slot0CleanCoreId;
  }

  const allNgClean = [...(byCohort.ng_clean_memory ?? []), ...(byCohort.ng_clean_cold ?? [])];
  const ngCleanLeaks = allNgClean.flatMap((r) =>
    [...r.ngPackEntryIdsShipped, ...r.westernPackEntryIdsShipped].map((id) => ({
      cohort: r.cohort, creatorId: r.creatorId, batchIdx: r.batchIdx, leakedId: id,
    })),
  );
  const westernLeaks = (byCohort.western ?? []).flatMap((r) =>
    r.shippedCleanCoreIds.filter((id): id is string => !!id)
      .concat(r.ngPackEntryIdsShipped)
      .map((id) => ({ cohort: r.cohort, creatorId: r.creatorId, batchIdx: r.batchIdx, leakedId: id })),
  );
  const errors = allResults.filter((r) => r.errors.length > 0);
  const underfills = allResults.filter((r) => r.underfilled);

  const summary = {
    phase: "N1-FOLLOWUP-NG-CLEAN-FIRST-CARD-CORE-RESERVATION",
    generatedAt: new Date().toISOString(),
    flagsActive: { LUMINA_NG_CLEAN_FIRST_CARD_RESERVATION_ENABLED: true },
    totals: { cohorts: COHORTS.length, batches: allResults.length, errors: errors.length, underfills: underfills.length },
    byCohortCounts: Object.fromEntries(Object.entries(byCohort).map(([k, v]) => [k, v.length])),
    ngCleanMemory: {
      batches: memBatches.length,
      slot0LeadersDistinct: memDistinct.length,
      slot0LeaderCounts: memCounts,
      acceptanceMin3: memDistinct.length >= 3,
      acceptancePreferred5: memDistinct.length >= 5,
      memorySeries,
    },
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
  process.stderr.write(`ng_clean_memory distinct slot-0 leaders: ${memDistinct.length} (${memDistinct.join(", ")})\n`);
  process.stderr.write(`Acceptance MIN=3: ${memDistinct.length >= 3 ? "PASS" : "FAIL"}\n`);
  process.stderr.write(`Leaks: ngClean=${ngCleanLeaks.length}, western=${westernLeaks.length}\n`);
  process.stderr.write(`Outputs:\n  ${fullOutPath}\n  ${summaryOutPath}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
