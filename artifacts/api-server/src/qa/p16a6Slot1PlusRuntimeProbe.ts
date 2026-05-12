/**
 * P16-A6 — NG_CLEAN slot-1+ anti-repeat runtime probe.
 *
 * Drives `runHybridIdeator` in-process across an ng_clean creator
 * matrix in TWO passes (PASS=off baseline, PASS=on treatment) plus
 * ng_lp + western negative-control cohorts. Reads the new
 * `qaTelemetry.slot1PlusFilterDetail` + `slot1PlusRecordedEntryIds`
 * surface to attribute every batch's slot-1+ filter activity, and
 * computes cross-batch repetition + held-id + leak metrics from the
 * raw shipped ideas.
 *
 * Read-only: no corpus/scorer/validator/floor/schema changes; only
 * the staging-only `LUMINA_NG_CLEAN_SLOT1PLUS_ANTI_REPEAT_ENABLED`
 * differs between PASS=off and PASS=on.
 *
 * Chunking:
 *   PASS=off|on
 *   COHORT=ng_clean|ng_lp|western|all
 *   CREATOR_START / CREATOR_END
 *   AGGREGATE=1 (no batches, just write summary file from partials)
 *
 * Per-batch flush + per-cohort partial files => safe to resume.
 */

// Pin workflow flags BEFORE any lib imports.
process.env.LUMINA_NG_PACK_ENABLED ??= "true";
process.env.LUMINA_NG_PACK_AWARE_RETENTION_ENABLED ??= "true";
process.env.LUMINA_NG_MEMORY_SOFT_CAP_ENABLED ??= "true";
process.env.LUMINA_W2_WESTERN_APPROVED_ENABLED ??= "true";
process.env.LUMINA_W2M_LOCAL_FIRST_REFRESH_ENABLED ??= "true";
process.env.LUMINA_NG_CLEAN_SLOT0_MEMORY_AWARE_PICKER_ENABLED ??= "true";
process.env.LUMINA_NG_CLEAN_FIRST_CARD_RESERVATION_ENABLED ??= "true";
process.env.LUMINA_FALLBACK_GAP_ONLY ??= "true";
process.env.LUMINA_NG_PACK_PROJECTION_T2_ENABLED ??= "true";
process.env.LUMINA_NG_STYLE_PENALTY_ENABLED ??= "true";

const PASS = (process.env.PASS ?? "off").toLowerCase();
if (PASS === "on") {
  process.env.LUMINA_NG_CLEAN_SLOT1PLUS_ANTI_REPEAT_ENABLED = "true";
} else {
  delete process.env.LUMINA_NG_CLEAN_SLOT1PLUS_ANTI_REPEAT_ENABLED;
}
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "error";

import * as fs from "node:fs";
import * as path from "node:path";
import { sql } from "drizzle-orm";
import { runHybridIdeator } from "../lib/hybridIdeator.js";
import { styleProfileSchema } from "../lib/styleProfile.js";
import { NIGERIAN_CLEAN_CORE_ENTRIES } from "../lib/nigerianCleanCorePack.js";
import { db } from "../db/client.js";
import type { Creator } from "../db/schema.js";

// ---------- Target sets ----------------------------------------------

const ALWAYS_ON_SLOT1PLUS_IDS = new Set([
  "ng_clean_002",
  "ng_clean_023",
  "ng_clean_056",
  "ng_clean_072",
  "ng_clean_084",
]);
const P16_A3_IMPORTED_IDS = new Set([
  "ng_clean_075", "ng_clean_076", "ng_clean_077",
  "ng_clean_090", "ng_clean_092",
  "ng_clean_078", "ng_clean_079", "ng_clean_081", "ng_clean_082",
  "ng_clean_083", "ng_clean_084", "ng_clean_085", "ng_clean_086",
  "ng_clean_087", "ng_clean_089", "ng_clean_091", "ng_clean_093",
  "ng_clean_094",
]);
const HELD_IDS = new Set(["ng_clean_080", "ng_clean_088"]);

// ---------- Hook → clean-core ID resolver ---------------------------

const CLEAN_CORE_HOOK_INDEX = new Map<string, string>();
const CLEAN_CORE_BY_ID = new Map<string, { id: string; hook: string }>();
for (const e of NIGERIAN_CLEAN_CORE_ENTRIES) {
  CLEAN_CORE_HOOK_INDEX.set(e.hook.toLowerCase().trim(), e.id);
  CLEAN_CORE_BY_ID.set(e.id, { id: e.id, hook: e.hook });
}
function resolveCleanCoreId(hook: string | undefined): string | null {
  if (!hook) return null;
  return CLEAN_CORE_HOOK_INDEX.get(hook.toLowerCase().trim()) ?? null;
}

// ---------- Pidgin leak detector ------------------------------------

const PIDGIN_TOKENS = [
  /\bdon\b/i, /\bdey\b/i, /\bna\b/i, /\babeg\b/i, /\bsabi\b/i,
  /\bwahala\b/i, /\bomo\b/i, /\bsef\b/i, /\bbiko\b/i, /\boya\b/i,
  /\bgist\b/i, /\bvex\b/i, /\bchop\b/i, /\bnaija\b/i,
];
function pidginHits(text: string): string[] {
  return PIDGIN_TOKENS.filter((rx) => rx.test(text)).map(
    (rx) => rx.source.replace(/\\b/g, "").toLowerCase(),
  );
}

// ---------- Deterministic UUID stub ---------------------------------

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

// ---------- Cohort config -------------------------------------------

type Cohort = "ng_clean" | "ng_lp" | "western";
interface CohortCfg {
  region: string;
  languageStyle: "clean" | "light_pidgin" | null;
  creators: number;
  batchesPerCreator: number;
}
const COHORTS: Record<Cohort, CohortCfg> = {
  ng_clean: { region: "nigeria", languageStyle: "clean",        creators: 4, batchesPerCreator: 4 },
  ng_lp:    { region: "nigeria", languageStyle: "light_pidgin", creators: 2, batchesPerCreator: 1 },
  western:  { region: "western", languageStyle: null,            creators: 2, batchesPerCreator: 1 },
};
const COUNT_PER_BATCH = 6;

const NG_CLEAN_NICHES = [
  "food/home",
  "fashion/outfit",
  "family comedy",
  "student/school/work",
];

// ---------- DB helpers ----------------------------------------------

async function upsertCreator(
  id: string,
  cohort: Cohort,
  region: string,
  idx: number,
  niche: string,
): Promise<void> {
  const name = `qa_sweep:p16a6_slot1plus_runtime:${PASS}:${cohort}:${idx}`;
  await db.execute(sql`
    INSERT INTO creators (
      id, name, location, niche, image_key, is_demo, region, currency, followers,
      nigerian_clean_core_slot0_seen_ids_json,
      nigerian_clean_core_slot1plus_seen_ids_json,
      nigerian_pack_seen_entry_ids_json,
      catalog_template_seen_ids_json,
      last_idea_batch_json,
      last_idea_batch_date
    )
    VALUES (
      ${id}, ${name}, 'Lagos, Nigeria', ${niche}, 'stub', true, ${region}, 'USD', 0,
      '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, NULL, NULL
    )
    ON CONFLICT (id) DO UPDATE SET
      region = EXCLUDED.region,
      niche  = EXCLUDED.niche,
      nigerian_clean_core_slot0_seen_ids_json     = '[]'::jsonb,
      nigerian_clean_core_slot1plus_seen_ids_json = '[]'::jsonb,
      nigerian_pack_seen_entry_ids_json           = '[]'::jsonb,
      catalog_template_seen_ids_json              = '[]'::jsonb,
      last_idea_batch_json                        = NULL,
      last_idea_batch_date                        = NULL
  `);
}

function makeStubCreator(
  id: string,
  cohort: Cohort,
  region: string,
  idx: number,
  niche: string,
): Creator {
  return {
    id,
    authUserId: null,
    name: `qa_sweep:p16a6_slot1plus_runtime:${PASS}:${cohort}:${idx}`,
    location: "Lagos, Nigeria",
    niche,
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
    nigerianCleanCoreSlot1PlusSeenIdsJson: null,
  } as unknown as Creator;
}

// ---------- Per-batch run -------------------------------------------

interface IdeaRec {
  cohort: Cohort;
  creatorIdx: number;
  niche: string;
  batchInSeries: number;
  positionInBatch: number;
  hook: string;
  source: string | null;
  cleanCoreId: string | null;
  isHeld: boolean;
  isP16A3: boolean;
  isAlwaysOn: boolean;
  pidginLeak: string[];
}
interface BatchRec {
  cohort: Cohort;
  creatorIdx: number;
  niche: string;
  batchInSeries: number;
  durationMs: number;
  shipped: number;
  underfill: boolean;
  usedFallback: boolean | null;
  fallbackReason: string | null;
  filterRan: boolean;
  filterSwapped: number;
  filterRelaxed: number;
  filterSuppressedIds: string[];
  filterInsertedIds: string[];
  recordedEntryIds: string[];
  error: string | null;
}

async function runOneBatch(
  cohort: Cohort,
  creatorId: string,
  creatorIdx: number,
  niche: string,
  batchInSeries: number,
): Promise<{ ideas: IdeaRec[]; batch: BatchRec }> {
  const cfg = COHORTS[cohort];
  const creator = makeStubCreator(creatorId, cohort, cfg.region, creatorIdx, niche);
  const styleProfile = styleProfileSchema.parse({});
  const t0 = Date.now();
  let result: Awaited<ReturnType<typeof runHybridIdeator>> | undefined;
  let error: string | null = null;
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

  const ideas: IdeaRec[] = [];
  const shipped = result?.ideas ?? [];
  for (let i = 0; i < shipped.length; i++) {
    const idea = shipped[i];
    const qa = result?.qaTelemetry?.perIdea?.[i];
    const cleanCoreId = resolveCleanCoreId(idea.hook);
    const text = `${idea.hook ?? ""}\n${idea.caption ?? ""}\n${idea.whatToShow ?? ""}`;
    const leak = cohort === "ng_clean" ? pidginHits(text) : [];
    ideas.push({
      cohort,
      creatorIdx,
      niche,
      batchInSeries,
      positionInBatch: i,
      hook: idea.hook,
      source: qa?.source ?? null,
      cleanCoreId,
      isHeld: cleanCoreId !== null && HELD_IDS.has(cleanCoreId),
      isP16A3: cleanCoreId !== null && P16_A3_IMPORTED_IDS.has(cleanCoreId),
      isAlwaysOn: cleanCoreId !== null && ALWAYS_ON_SLOT1PLUS_IDS.has(cleanCoreId),
      pidginLeak: leak,
    });
  }

  const filterDetail = result?.qaTelemetry?.slot1PlusFilterDetail;
  const recorded = result?.qaTelemetry?.slot1PlusRecordedEntryIds ?? [];
  const batch: BatchRec = {
    cohort,
    creatorIdx,
    niche,
    batchInSeries,
    durationMs,
    shipped: shipped.length,
    underfill: error === null && shipped.length < COUNT_PER_BATCH,
    usedFallback: result?.usedFallback ?? null,
    fallbackReason:
      result?.qaTelemetry?.fallbackDecision?.reason ?? null,
    filterRan: filterDetail !== undefined,
    filterSwapped: filterDetail?.swappedCount ?? 0,
    filterRelaxed: filterDetail?.relaxedCount ?? 0,
    filterSuppressedIds: [...(filterDetail?.suppressedEntryIds ?? [])],
    filterInsertedIds: [...(filterDetail?.insertedEntryIds ?? [])],
    recordedEntryIds: [...recorded],
    error,
  };
  return { ideas, batch };
}

// ---------- Output paths --------------------------------------------

const REPO_ROOT = process.env.REPO_ROOT ?? "/home/runner/workspace";
const OUT_DIR = path.join(REPO_ROOT, ".local", "qa-runs", "p16a6");
fs.mkdirSync(OUT_DIR, { recursive: true });

function partialPath(pass: string, cohort: Cohort): string {
  return path.join(OUT_DIR, `_partial_${pass}_${cohort}.json`);
}
function passSummaryPath(pass: string): string {
  return path.join(OUT_DIR, `summary_${pass}.json`);
}
function combinedSummaryPath(): string {
  return path.join(OUT_DIR, "summary_combined.json");
}

interface PartialFile { ideas: IdeaRec[]; batches: BatchRec[]; }
function loadPartial(p: string): PartialFile {
  if (!fs.existsSync(p)) return { ideas: [], batches: [] };
  try { return JSON.parse(fs.readFileSync(p, "utf-8")) as PartialFile; }
  catch { return { ideas: [], batches: [] }; }
}
function savePartial(p: string, data: PartialFile): void {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

// ---------- Cohort runner -------------------------------------------

async function runCohortChunk(cohort: Cohort): Promise<void> {
  const cfg = COHORTS[cohort];
  const partial = loadPartial(partialPath(PASS, cohort));
  const cStart = Math.max(0, parseInt(process.env.CREATOR_START ?? "0", 10) || 0);
  const cEnd = Math.min(
    cfg.creators,
    parseInt(process.env.CREATOR_END ?? String(cfg.creators), 10) || cfg.creators,
  );
  process.stderr.write(
    `\n=== pass=${PASS} cohort=${cohort} creators=[${cStart}..${cEnd}) batches/creator=${cfg.batchesPerCreator} ===\n`,
  );
  for (let i = cStart; i < cEnd; i++) {
    const niche = NG_CLEAN_NICHES[i % NG_CLEAN_NICHES.length];
    const id = uuidFromString(`p16a6:${PASS}:${cohort}:c${i}`);
    await upsertCreator(id, cohort, cfg.region, i, niche);
    const have = partial.batches.filter(
      (b) => b.cohort === cohort && b.creatorIdx === i,
    ).length;
    if (have >= cfg.batchesPerCreator) {
      process.stderr.write(`  c${i} ${niche} already complete\n`);
      continue;
    }
    for (let b = have; b < cfg.batchesPerCreator; b++) {
      const r = await runOneBatch(cohort, id, i, niche, b);
      partial.ideas.push(...r.ideas);
      partial.batches.push(r.batch);
      const slot1plusIds = r.ideas
        .filter((x) => x.positionInBatch >= 1 && x.cleanCoreId !== null)
        .map((x) => x.cleanCoreId!)
        .join(",");
      process.stderr.write(
        `  [${cohort} c${i} b${b} ${niche}] ` +
        `slot0=${r.ideas[0]?.cleanCoreId ?? "-"} slot1+=${slot1plusIds || "-"} ` +
        `filter=${r.batch.filterRan ? `swap${r.batch.filterSwapped}/relax${r.batch.filterRelaxed}` : "off"} ` +
        `recorded=${r.batch.recordedEntryIds.length} ` +
        `fb=${r.batch.usedFallback ?? "?"} ${r.batch.durationMs}ms` +
        `${r.batch.error ? " ERR=" + r.batch.error.slice(0, 60) : ""}\n`,
      );
      savePartial(partialPath(PASS, cohort), partial);
    }
  }
}

// ---------- Aggregation --------------------------------------------

interface PassSummary {
  pass: string;
  perCohort: Record<Cohort, {
    ideas: number;
    batches: number;
    underfills: number;
    errors: number;
    fallbackUsed: number;
    fallbackReasons: Record<string, number>;
    avgBatchMs: number;
  }>;
  ngClean: {
    totalIdeas: number;
    uniqueHooks: number;
    slot0CleanCoreCount: number;
    slot1PlusCleanCoreCount: number;
    p16A3SurfacedDistinct: number;
    olderCleanCoreSurfacedDistinct: number;
    heldAppearances: number;
    pidginLeakCards: number;
    sameBatchDuplicateHooks: number;
    underfills: number;
    fallbackUsed: number;
    // Cross-batch slot-1+ repetition
    topRepeatedSlot1PlusIds: Array<{ id: string; count: number; hook: string }>;
    topRepeatedSlot1PlusHooks: Array<{ hook: string; count: number }>;
    maxRepeatCountSlot1PlusId: number;
    alwaysOnIdsRepeatCounts: Record<string, number>;
    // Warm-state repeat rate (batches >= 2 per creator)
    warmSlot1PlusEntries: number;
    warmSlot1PlusDistinct: number;
    warmRepeatRate: number;
    // Filter activity
    filterApplied: number;     // batches with swappedCount > 0
    filterRelaxed: number;     // batches with relaxedCount > 0
    filterRan: number;         // batches with detail present
    suppressedIdsAll: string[];
    insertedIdsAll: string[];
    suppressedTopCounts: Array<{ id: string; count: number }>;
    insertedTopCounts: Array<{ id: string; count: number }>;
  };
  controls: {
    ng_lp: { batches: number; filterRan: number; recordedWrites: number };
    western: { batches: number; filterRan: number; recordedWrites: number };
  };
}

function aggregatePass(pass: string): PassSummary {
  const all: Record<Cohort, PartialFile> = {
    ng_clean: loadPartial(partialPath(pass, "ng_clean")),
    ng_lp:    loadPartial(partialPath(pass, "ng_lp")),
    western:  loadPartial(partialPath(pass, "western")),
  };

  const perCohort: PassSummary["perCohort"] = {
    ng_clean: { ideas: 0, batches: 0, underfills: 0, errors: 0, fallbackUsed: 0, fallbackReasons: {}, avgBatchMs: 0 },
    ng_lp:    { ideas: 0, batches: 0, underfills: 0, errors: 0, fallbackUsed: 0, fallbackReasons: {}, avgBatchMs: 0 },
    western:  { ideas: 0, batches: 0, underfills: 0, errors: 0, fallbackUsed: 0, fallbackReasons: {}, avgBatchMs: 0 },
  };
  for (const c of ["ng_clean", "ng_lp", "western"] as Cohort[]) {
    const p = all[c];
    perCohort[c].ideas = p.ideas.length;
    perCohort[c].batches = p.batches.length;
    perCohort[c].underfills = p.batches.filter((b) => b.underfill).length;
    perCohort[c].errors = p.batches.filter((b) => b.error !== null).length;
    perCohort[c].fallbackUsed = p.batches.filter((b) => b.usedFallback === true).length;
    for (const b of p.batches) {
      if (b.fallbackReason) {
        perCohort[c].fallbackReasons[b.fallbackReason] =
          (perCohort[c].fallbackReasons[b.fallbackReason] ?? 0) + 1;
      }
    }
    const tot = p.batches.reduce((s, b) => s + b.durationMs, 0);
    perCohort[c].avgBatchMs = p.batches.length === 0 ? 0 : Math.round(tot / p.batches.length);
  }

  const ng = all.ng_clean;
  const ngIdeas = ng.ideas;
  const ngBatches = ng.batches;
  const ngUniqueHooks = new Set(ngIdeas.map((i) => i.hook.toLowerCase().trim())).size;
  const slot0CleanCore = ngIdeas.filter((i) => i.positionInBatch === 0 && i.cleanCoreId !== null).length;
  const slot1PlusIdeas = ngIdeas.filter((i) => i.positionInBatch >= 1 && i.cleanCoreId !== null);
  const slot1PlusCleanCore = slot1PlusIdeas.length;
  const p16a3Distinct = new Set(ngIdeas.filter((i) => i.isP16A3).map((i) => i.cleanCoreId!)).size;
  const olderDistinct = new Set(
    ngIdeas
      .filter((i) => i.cleanCoreId !== null && !i.isP16A3 && !i.isAlwaysOn)
      .map((i) => i.cleanCoreId!),
  ).size;
  const heldAppearances = ngIdeas.filter((i) => i.isHeld).length;
  const pidginLeakCards = ngIdeas.filter((i) => i.pidginLeak.length > 0).length;

  // Same-batch duplicate hook detection
  let sameBatchDups = 0;
  const batchKey = new Map<string, Set<string>>();
  for (const i of ngIdeas) {
    const k = `${i.creatorIdx}|${i.batchInSeries}`;
    if (!batchKey.has(k)) batchKey.set(k, new Set());
    const s = batchKey.get(k)!;
    const h = i.hook.toLowerCase().trim();
    if (s.has(h)) sameBatchDups++;
    s.add(h);
  }

  // Cross-batch slot-1+ repetition counts (per creator) — repeats are
  // counts in excess of the first surfacing within a creator's series.
  const slot1PlusIdCounts = new Map<string, { count: number; hook: string }>();
  const slot1PlusHookCounts = new Map<string, number>();
  for (const i of slot1PlusIdeas) {
    const idRec = slot1PlusIdCounts.get(i.cleanCoreId!) ?? {
      count: 0, hook: CLEAN_CORE_BY_ID.get(i.cleanCoreId!)?.hook ?? i.hook,
    };
    idRec.count += 1;
    slot1PlusIdCounts.set(i.cleanCoreId!, idRec);
    const h = i.hook.toLowerCase().trim();
    slot1PlusHookCounts.set(h, (slot1PlusHookCounts.get(h) ?? 0) + 1);
  }
  const topRepeatedIds = [...slot1PlusIdCounts.entries()]
    .map(([id, r]) => ({ id, count: r.count, hook: r.hook }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  const topRepeatedHooks = [...slot1PlusHookCounts.entries()]
    .map(([hook, count]) => ({ hook, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  const maxRepeatId = topRepeatedIds[0]?.count ?? 0;
  const alwaysOnRepeats: Record<string, number> = {};
  for (const id of ALWAYS_ON_SLOT1PLUS_IDS) {
    alwaysOnRepeats[id] = slot1PlusIdCounts.get(id)?.count ?? 0;
  }

  // Warm-state repeat rate: ideas at slot 1+ in batches >= 2 (i.e.
  // batchInSeries >= 1) with memory already populated.
  const warmIdeas = slot1PlusIdeas.filter((i) => i.batchInSeries >= 1);
  const warmDistinct = new Set(warmIdeas.map((i) => i.cleanCoreId!)).size;
  const warmRepeatRate =
    warmIdeas.length === 0
      ? 0
      : Math.round((1 - warmDistinct / warmIdeas.length) * 1000) / 1000;

  const filterApplied = ngBatches.filter((b) => b.filterSwapped > 0).length;
  const filterRelaxed = ngBatches.filter((b) => b.filterRelaxed > 0).length;
  const filterRan = ngBatches.filter((b) => b.filterRan).length;
  const suppressedAll = ngBatches.flatMap((b) => b.filterSuppressedIds);
  const insertedAll = ngBatches.flatMap((b) => b.filterInsertedIds);
  const tally = (xs: string[]) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return [...m.entries()].map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count).slice(0, 10);
  };

  // Controls — should have ZERO filter activity / writes.
  const lp = all.ng_lp;
  const we = all.western;
  const lpFilterRan = lp.batches.filter((b) => b.filterRan).length;
  const lpRecorded = lp.batches.filter((b) => b.recordedEntryIds.length > 0).length;
  const weFilterRan = we.batches.filter((b) => b.filterRan).length;
  const weRecorded = we.batches.filter((b) => b.recordedEntryIds.length > 0).length;

  return {
    pass,
    perCohort,
    ngClean: {
      totalIdeas: ngIdeas.length,
      uniqueHooks: ngUniqueHooks,
      slot0CleanCoreCount: slot0CleanCore,
      slot1PlusCleanCoreCount: slot1PlusCleanCore,
      p16A3SurfacedDistinct: p16a3Distinct,
      olderCleanCoreSurfacedDistinct: olderDistinct,
      heldAppearances,
      pidginLeakCards,
      sameBatchDuplicateHooks: sameBatchDups,
      underfills: perCohort.ng_clean.underfills,
      fallbackUsed: perCohort.ng_clean.fallbackUsed,
      topRepeatedSlot1PlusIds: topRepeatedIds,
      topRepeatedSlot1PlusHooks: topRepeatedHooks,
      maxRepeatCountSlot1PlusId: maxRepeatId,
      alwaysOnIdsRepeatCounts: alwaysOnRepeats,
      warmSlot1PlusEntries: warmIdeas.length,
      warmSlot1PlusDistinct: warmDistinct,
      warmRepeatRate,
      filterApplied,
      filterRelaxed,
      filterRan,
      suppressedIdsAll: suppressedAll,
      insertedIdsAll: insertedAll,
      suppressedTopCounts: tally(suppressedAll),
      insertedTopCounts: tally(insertedAll),
    },
    controls: {
      ng_lp:   { batches: lp.batches.length, filterRan: lpFilterRan, recordedWrites: lpRecorded },
      western: { batches: we.batches.length, filterRan: weFilterRan, recordedWrites: weRecorded },
    },
  };
}

// ---------- Main ---------------------------------------------------

async function main(): Promise<void> {
  if (process.env.AGGREGATE === "1") {
    const summary = aggregatePass(PASS);
    fs.writeFileSync(passSummaryPath(PASS), JSON.stringify(summary, null, 2));
    process.stderr.write(`\nWrote ${passSummaryPath(PASS)}\n`);
    if (PASS === "combined" ||
        (fs.existsSync(passSummaryPath("off")) && fs.existsSync(passSummaryPath("on")))) {
      const off = JSON.parse(fs.readFileSync(passSummaryPath("off"), "utf-8")) as PassSummary;
      const on  = JSON.parse(fs.readFileSync(passSummaryPath("on"),  "utf-8")) as PassSummary;
      fs.writeFileSync(combinedSummaryPath(), JSON.stringify({ off, on }, null, 2));
      process.stderr.write(`Wrote ${combinedSummaryPath()}\n`);
    }
    return;
  }
  const cohortArg = (process.env.COHORT ?? "all").toLowerCase();
  const cohorts: Cohort[] = cohortArg === "all"
    ? ["ng_clean", "ng_lp", "western"]
    : [cohortArg as Cohort];
  for (const c of cohorts) await runCohortChunk(c);
  process.stderr.write(`\nDone pass=${PASS}.\n`);
}

main().then(
  () => process.exit(0),
  (e) => { process.stderr.write(`FATAL: ${e?.stack ?? e}\n`); process.exit(1); },
);
