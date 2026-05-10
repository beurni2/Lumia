/**
 * N1-FOLLOWUP-NG-CLEAN-SLOT0-ANTI-REPEAT-SWAP — runtime QA sweep.
 *
 * Drives the helper end-to-end against the real api-server pipeline
 * + DB-backed per-creator memory column. Validates:
 *
 *   • ng_clean cold-start baseline (10 creators × 6 ideas, fresh DB
 *     row per creator) — captures the natural slot-0 leader.
 *
 *   • ng_clean memory exercise (10 creators × 3 sequential batches
 *     each, same creator across the three batches) — proves the
 *     swap fires once memory is populated. Acceptance: distinct
 *     slot-0 leaders across the 3-batch series ≥ 2 for the cohort.
 *
 *   • Negative controls (10 fresh creators × 1 batch each):
 *       - ng_pidgin       (NG cohort but languageStyle ≠ clean)
 *       - ng_light_pidgin (NG cohort but languageStyle ≠ clean)
 *       - western         (region ≠ nigeria)
 *     The helper must NOT touch the memory column on these (post-
 *     run column value still `[]`).
 *
 * Hard rules:
 *   • No product code modified. Read-only QA driver.
 *   • Creators are upserted into a real DB row per cohort so the
 *     memory module's UPDATE actually persists; rows are NOT cleaned
 *     up afterward (they're stamped `is_demo=true` + identifiable
 *     `qa_sweep:n1_ng_clean_slot0_anti_repeat_swap:` name prefix).
 *   • Memory column is reset to `[]` before every creator's first
 *     batch so the run is reproducible.
 */

process.env.LUMINA_NG_PACK_ENABLED = "true";
process.env.LUMINA_NG_PACK_AWARE_RETENTION_ENABLED = "true";
process.env.LUMINA_NG_MEMORY_SOFT_CAP_ENABLED = "true";
process.env.LUMINA_W2_WESTERN_APPROVED_ENABLED = "true";
process.env.LUMINA_W2M_LOCAL_FIRST_REFRESH_ENABLED = "true";
process.env.LUMINA_FALLBACK_GAP_ONLY = "true";
process.env.LUMINA_NG_STYLE_PENALTY_ENABLED = "true";
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "error";

import * as fs from "node:fs";
import * as path from "node:path";
import { sql } from "drizzle-orm";
import { runHybridIdeator } from "../lib/hybridIdeator.js";
import { styleProfileSchema } from "../lib/styleProfile.js";
import { NIGERIAN_CLEAN_CORE_ENTRIES } from "../lib/nigerianCleanCorePack.js";
import { db } from "../db/client.js";
import type { Creator } from "../db/schema.js";

// -------- Resolver ---------------------------------------------------

const CLEAN_CORE_HOOK_INDEX = new Map<string, string>();
for (const e of NIGERIAN_CLEAN_CORE_ENTRIES) {
  CLEAN_CORE_HOOK_INDEX.set(e.hook.toLowerCase().trim(), e.id);
}
function resolveCleanCoreId(hook: string | undefined): string | null {
  if (!hook) return null;
  return CLEAN_CORE_HOOK_INDEX.get(hook.toLowerCase().trim()) ?? null;
}

// -------- Deterministic UUID stub for creators -----------------------

function uuidFromString(seed: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const hex = (n: number, len: number) =>
    (n >>> 0).toString(16).padStart(len, "0").slice(-len);
  const p1 = hex(h, 8);
  let h2 = h;
  for (let i = 0; i < 4; i++) { h2 ^= p1.charCodeAt(i); h2 = Math.imul(h2, 0x01000193); }
  const p2 = hex(h2, 4);
  let h3 = h2;
  for (let i = 0; i < 4; i++) { h3 ^= p2.charCodeAt(i); h3 = Math.imul(h3, 0x01000193); }
  const p3 = "4" + hex(h3, 4).slice(1);
  let h4 = h3;
  for (let i = 0; i < 4; i++) { h4 ^= p3.charCodeAt(i); h4 = Math.imul(h4, 0x01000193); }
  const variant = ["8", "9", "a", "b"][h4 & 0x3];
  const p4 = variant + hex(h4, 4).slice(1);
  let h5 = h4;
  for (let i = 0; i < 12; i++) { h5 ^= seed.charCodeAt(i % seed.length); h5 = Math.imul(h5, 0x01000193); }
  const p5 = hex(h5, 12);
  return `${p1}-${p2}-${p3}-${p4}-${p5}`;
}

// -------- Cohort config ----------------------------------------------

type Cohort =
  | "ng_clean_cold"
  | "ng_clean_memory"
  | "ng_pidgin"
  | "ng_light_pidgin"
  | "western";

interface CohortConfig {
  region: string;
  languageStyle: "clean" | "pidgin" | "light_pidgin" | null;
  helperShouldFire: boolean;
  memoryExercise: boolean;
}

const COHORTS: Record<Cohort, CohortConfig> = {
  ng_clean_cold: { region: "nigeria", languageStyle: "clean", helperShouldFire: true, memoryExercise: false },
  ng_clean_memory: { region: "nigeria", languageStyle: "clean", helperShouldFire: true, memoryExercise: true },
  ng_pidgin: { region: "nigeria", languageStyle: "pidgin", helperShouldFire: false, memoryExercise: false },
  ng_light_pidgin: { region: "nigeria", languageStyle: "light_pidgin", helperShouldFire: false, memoryExercise: false },
  western: { region: "western", languageStyle: null, helperShouldFire: false, memoryExercise: false },
};

const CREATORS_PER_COHORT = 5;
const COUNT_PER_BATCH = 6;
const MEMORY_BATCHES = 3;

// -------- DB helpers -------------------------------------------------

async function upsertCreator(id: string, cohort: Cohort, region: string, idx: number): Promise<void> {
  const name = `qa_sweep:n1_ng_clean_slot0_anti_repeat_swap:${cohort}:${idx}`;
  await db.execute(sql`
    INSERT INTO creators (id, name, location, niche, image_key, is_demo, region, currency, followers, nigerian_clean_core_slot0_seen_ids_json)
    VALUES (${id}, ${name}, 'Lagos, Nigeria', 'comedy', 'stub', true, ${region}, 'USD', 0, '[]'::jsonb)
    ON CONFLICT (id) DO UPDATE SET
      region = EXCLUDED.region,
      nigerian_clean_core_slot0_seen_ids_json = '[]'::jsonb
  `);
}

async function readSlot0Memory(creatorId: string): Promise<Array<{ entryId: string; lastSeenAt: string }>> {
  const r = await db.execute(sql`
    SELECT nigerian_clean_core_slot0_seen_ids_json AS m FROM creators WHERE id = ${creatorId}
  `);
  const rows = (r as unknown as { rows: Array<{ m: unknown }> }).rows ?? [];
  const raw = rows[0]?.m;
  if (!Array.isArray(raw)) return [];
  return raw as Array<{ entryId: string; lastSeenAt: string }>;
}

// -------- Stub creator object (handed to runHybridIdeator) ----------

function makeStubCreator(id: string, cohort: Cohort, region: string, idx: number): Creator {
  return {
    id,
    authUserId: null,
    name: `qa_sweep:n1_ng_clean_slot0_anti_repeat_swap:${cohort}:${idx}`,
    location: "Lagos, Nigeria",
    niche: "comedy",
    followers: 0,
    currency: "USD",
    imageKey: "stub",
    isDemo: true,
    region,
    lastIdeaBatchJson: null,
    lastIdeaBatchDate: null,
    lastIdeaBatchAt: null,
    tasteCalibrationJson: null,
    visionStyleJson: null,
    catalogTemplateSeenIdsJson: null,
    nigerianPackSeenEntryIdsJson: null,
    westernPackSeenAxesJson: null,
    nigerianCleanCoreSlot0SeenIdsJson: null,
  } as unknown as Creator;
}

// -------- Per-batch run ---------------------------------------------

interface BatchResult {
  cohort: Cohort;
  creatorId: string;
  creatorIdx: number;
  batchInSeries: number;
  durationMs: number;
  shippedHooks: string[];
  slot0Hook: string;
  slot0CleanCoreId: string | null;
  memoryBefore: string[];
  memoryAfter: string[];
  swapInferred: boolean;
  error?: string;
}

async function runOneBatch(
  cohort: Cohort,
  creatorId: string,
  creatorIdx: number,
  batchInSeries: number,
): Promise<BatchResult> {
  const cfg = COHORTS[cohort];
  const memoryBefore = (await readSlot0Memory(creatorId)).map((e) => e.entryId);
  const creator = makeStubCreator(creatorId, cohort, cfg.region, creatorIdx);
  const styleProfile = styleProfileSchema.parse({});
  const t0 = Date.now();
  let result;
  let error: string | undefined;
  try {
    result = await runHybridIdeator({
      creator,
      region: cfg.region,
      styleProfile,
      count: COUNT_PER_BATCH,
      regenerate: false,
      excludeHooks: [],
      tasteCalibrationJson:
        cfg.languageStyle === null ? null : { languageStyle: cfg.languageStyle },
      visionStyleJson: null,
      ctx: { creatorId: creator.id, agentRunId: null },
      usageContext: {
        creatorId: creator.id,
        creatorIsDemo: true,
        ideaRequestCountToday: 0,
        llamaCallsLast2Min: 0,
      },
    } as unknown as Parameters<typeof runHybridIdeator>[0]);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const durationMs = Date.now() - t0;
  // Brief settle so the fire-and-forget memory write completes before
  // we read it back. The write is awaited inside the void chain so a
  // 250ms grace is plenty in practice.
  await new Promise((r) => setTimeout(r, 250));
  const memoryAfter = (await readSlot0Memory(creatorId)).map((e) => e.entryId);

  const shippedHooks: string[] = (result?.ideas ?? []).map((i) => i.hook);
  const slot0Hook = shippedHooks[0] ?? "";
  const slot0CleanCoreId = resolveCleanCoreId(slot0Hook);

  // Swap inference: a swap fired when slot-0 in the FINAL stream has
  // a cleanCoreEntryId that differs from any entry already in the
  // pre-run memory AND the pre-run memory was non-empty AND slot-0
  // is itself clean-core. (i.e. memory steered slot-0 elsewhere.)
  const swapInferred =
    cfg.helperShouldFire &&
    slot0CleanCoreId !== null &&
    memoryBefore.length > 0 &&
    !memoryBefore.includes(slot0CleanCoreId);

  return {
    cohort,
    creatorId,
    creatorIdx,
    batchInSeries,
    durationMs,
    shippedHooks,
    slot0Hook,
    slot0CleanCoreId,
    memoryBefore,
    memoryAfter,
    swapInferred,
    error,
  };
}

// -------- Main -------------------------------------------------------

async function main() {
  // Always write to the canonical workspace .local/qa-runs, regardless
  // of where the script was invoked from. The api-server's `node_modules`
  // resolution requires us to invoke from `artifacts/api-server/`, but
  // the report and history live at the workspace root.
  const repoRoot = process.env.REPO_ROOT ?? "/home/runner/workspace";
  const outDir = path.join(repoRoot, ".local", "qa-runs");
  fs.mkdirSync(outDir, { recursive: true });
  const fullOut = path.join(outDir, "n1_ng_clean_slot0_anti_repeat_swap.json");
  const summaryOut = path.join(outDir, "n1_ng_clean_slot0_anti_repeat_swap_summary.json");

  const allBatches: BatchResult[] = [];

  // Optional cohort filter so we can chunk the run across multiple
  // bash invocations and stay inside the 2-minute timeout.
  const cohortFilter = (process.env.COHORTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  // Resume support: load any prior batches so chunked runs accumulate.
  if (fs.existsSync(fullOut)) {
    try {
      const prior = JSON.parse(fs.readFileSync(fullOut, "utf-8")) as { batches?: BatchResult[] };
      if (Array.isArray(prior.batches)) allBatches.push(...prior.batches);
    } catch { /* ignore */ }
  }
  for (const cohort of Object.keys(COHORTS) as Cohort[]) {
    if (cohortFilter.length > 0 && !cohortFilter.includes(cohort)) continue;
    // Skip if this cohort already has the expected number of batches in the resume file.
    const expected = (COHORTS[cohort].memoryExercise ? MEMORY_BATCHES : 1) * CREATORS_PER_COHORT;
    const have = allBatches.filter((b) => b.cohort === cohort).length;
    if (have >= expected) {
      process.stderr.write(`\n--- cohort ${cohort} already complete (${have}/${expected}), skipping ---\n`);
      continue;
    }
    const cfg = COHORTS[cohort];
    process.stderr.write(`\n--- cohort ${cohort} (region=${cfg.region} style=${cfg.languageStyle}) ---\n`);
    const cStart = Math.max(0, parseInt(process.env.CREATOR_START ?? "0", 10) || 0);
    const cEnd = Math.min(CREATORS_PER_COHORT, parseInt(process.env.CREATOR_END ?? String(CREATORS_PER_COHORT), 10) || CREATORS_PER_COHORT);
    for (let i = cStart; i < cEnd; i++) {
      const id = uuidFromString(`qa:n1ngcleanslot0:v1:${cohort}:c${i}`);
      await upsertCreator(id, cohort, cfg.region, i);
      const seriesLen = cfg.memoryExercise ? MEMORY_BATCHES : 1;
      // Skip series that are already complete in the resume file (per creator).
      const haveForCreator = allBatches.filter((b) => b.cohort === cohort && b.creatorId === id).length;
      if (haveForCreator >= seriesLen) {
        process.stderr.write(`  c${i} already complete (${haveForCreator}/${seriesLen}), skipping\n`);
        continue;
      }
      for (let b = haveForCreator; b < seriesLen; b++) {
        const r = await runOneBatch(cohort, id, i, b);
        allBatches.push(r);
        process.stderr.write(
          `  [${cohort} c${i} b${b}] slot0=${r.slot0CleanCoreId ?? "-"} ` +
          `memBefore=[${r.memoryBefore.join(",")}] memAfter=[${r.memoryAfter.join(",")}] ` +
          `swap=${r.swapInferred} (${r.durationMs}ms)${r.error ? " ERR: " + r.error : ""}\n`,
        );
        // Per-batch flush in case the run is killed mid-sweep.
        fs.writeFileSync(fullOut, JSON.stringify({
          phase: "N1-FOLLOWUP-NG-CLEAN-SLOT0-ANTI-REPEAT-SWAP",
          generatedAt: new Date().toISOString(),
          cohorts: COHORTS,
          creatorsPerCohort: CREATORS_PER_COHORT,
          countPerBatch: COUNT_PER_BATCH,
          memoryBatches: MEMORY_BATCHES,
          batches: allBatches,
        }, null, 2));
      }
    }
  }

  // -------- Aggregate ------------------------------------------------

  type CohortStats = {
    cohort: Cohort;
    region: string;
    languageStyle: string | null;
    helperShouldFire: boolean;
    creators: number;
    batches: number;
    errors: number;
    distinctSlot0Leaders: number;
    slot0LeaderCounts: Record<string, number>;
    swapsFired: number;
    memoryColumnTouched: number; // # batches where memoryAfter differs from memoryBefore (gives a "did the helper write" signal)
    memoryColumnLeaked: number;  // helperShouldFire=false AND memoryAfter !== []
  };

  const stats: CohortStats[] = [];
  for (const cohort of Object.keys(COHORTS) as Cohort[]) {
    const cb = allBatches.filter((b) => b.cohort === cohort);
    const cfg = COHORTS[cohort];
    const leaderCounts: Record<string, number> = {};
    for (const b of cb) {
      const k = b.slot0CleanCoreId ?? `<non-clean:${b.slot0Hook.slice(0, 40)}>`;
      leaderCounts[k] = (leaderCounts[k] ?? 0) + 1;
    }
    const cleanLeaders = new Set(
      cb.filter((b) => b.slot0CleanCoreId !== null).map((b) => b.slot0CleanCoreId!),
    );
    const memoryTouched = cb.filter((b) =>
      JSON.stringify(b.memoryAfter) !== JSON.stringify(b.memoryBefore),
    ).length;
    const memoryLeaked = cfg.helperShouldFire
      ? 0
      : cb.filter((b) => b.memoryAfter.length > 0).length;
    stats.push({
      cohort,
      region: cfg.region,
      languageStyle: cfg.languageStyle,
      helperShouldFire: cfg.helperShouldFire,
      creators: new Set(cb.map((b) => b.creatorId)).size,
      batches: cb.length,
      errors: cb.filter((b) => b.error).length,
      distinctSlot0Leaders: cleanLeaders.size,
      slot0LeaderCounts: leaderCounts,
      swapsFired: cb.filter((b) => b.swapInferred).length,
      memoryColumnTouched: memoryTouched,
      memoryColumnLeaked: memoryLeaked,
    });
  }

  // -------- Memory-exercise drill-down -------------------------------

  // For ng_clean_memory: per-creator series, did slot-0 distinct-id
  // count rise above 1 (i.e. swap actually changed the leader)?
  const memoryCreators = Array.from(
    new Set(allBatches.filter((b) => b.cohort === "ng_clean_memory").map((b) => b.creatorId)),
  );
  type SeriesObs = {
    creatorId: string;
    slot0Series: Array<{ batch: number; cleanId: string | null; swap: boolean }>;
    distinctCleanIds: number;
    swapsObserved: number;
  };
  const memorySeries: SeriesObs[] = memoryCreators.map((cid) => {
    const series = allBatches
      .filter((b) => b.cohort === "ng_clean_memory" && b.creatorId === cid)
      .sort((a, b) => a.batchInSeries - b.batchInSeries)
      .map((b) => ({ batch: b.batchInSeries, cleanId: b.slot0CleanCoreId, swap: b.swapInferred }));
    const distinctCleanIds = new Set(series.map((s) => s.cleanId).filter((x): x is string => x !== null)).size;
    const swapsObserved = series.filter((s) => s.swap).length;
    return { creatorId: cid, slot0Series: series, distinctCleanIds, swapsObserved };
  });

  const memorySeriesAggregate = {
    creators: memoryCreators.length,
    creatorsWithDistinctLeadersGte2: memorySeries.filter((s) => s.distinctCleanIds >= 2).length,
    creatorsWithAnySwap: memorySeries.filter((s) => s.swapsObserved > 0).length,
    cohortDistinctSlot0Leaders: new Set(
      allBatches
        .filter((b) => b.cohort === "ng_clean_memory")
        .map((b) => b.slot0CleanCoreId)
        .filter((x): x is string => x !== null),
    ).size,
  };

  // -------- Acceptance -----------------------------------------------

  const acceptance = {
    "#9 distinct ng_clean slot-0 leaders ≥ 2 once memory exercised":
      memorySeriesAggregate.cohortDistinctSlot0Leaders >= 2,
    "no errors": allBatches.every((b) => !b.error),
    "no negative-control memory leak (memoryAfter remains [])":
      stats
        .filter((s) => !s.helperShouldFire)
        .every((s) => s.memoryColumnLeaked === 0),
    "ng_clean_cold writes memory after batch (helper write path active)":
      stats.find((s) => s.cohort === "ng_clean_cold")!.memoryColumnTouched > 0,
  };

  const summary = {
    phase: "N1-FOLLOWUP-NG-CLEAN-SLOT0-ANTI-REPEAT-SWAP",
    generatedAt: new Date().toISOString(),
    creatorsPerCohort: CREATORS_PER_COHORT,
    countPerBatch: COUNT_PER_BATCH,
    memoryBatches: MEMORY_BATCHES,
    perCohort: stats,
    memorySeries,
    memorySeriesAggregate,
    acceptance,
    overallPass: Object.values(acceptance).every(Boolean),
  };

  fs.writeFileSync(summaryOut, JSON.stringify(summary, null, 2));
  fs.writeFileSync(fullOut, JSON.stringify({
    phase: "N1-FOLLOWUP-NG-CLEAN-SLOT0-ANTI-REPEAT-SWAP",
    generatedAt: new Date().toISOString(),
    cohorts: COHORTS,
    creatorsPerCohort: CREATORS_PER_COHORT,
    countPerBatch: COUNT_PER_BATCH,
    memoryBatches: MEMORY_BATCHES,
    summary,
    batches: allBatches,
  }, null, 2));

  process.stderr.write(`\n=== ACCEPTANCE ${summary.overallPass ? "PASS" : "FAIL"} ===\n`);
  for (const [k, v] of Object.entries(acceptance)) {
    process.stderr.write(`  ${v ? "✓" : "✗"} ${k}\n`);
  }
  process.stderr.write(`Outputs:\n  ${fullOut}\n  ${summaryOut}\n`);

}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
