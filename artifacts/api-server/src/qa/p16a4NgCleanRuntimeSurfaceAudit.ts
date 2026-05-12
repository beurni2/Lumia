/**
 * P16-A4-NG-CLEAN-RUNTIME-SURFACE-AUDIT — read-only runtime probe.
 *
 * Drives `runHybridIdeator` in-process across realistic ng_clean creator
 * profiles, plus negative-control cohorts (ng_light_pidgin + western),
 * and counts how often the 18 P16-A3 imported ng_clean entries surface
 * (overall + slot-0 separately). Verifies held IDs (080, 088) never
 * appear, that the picker is not over-favoring P16-A3, that older
 * entries still compete, and that no leakage / underfill / fallback
 * regressions occur.
 *
 * Read-only: no corpus, scorer, validator, floor, schema, API, mobile,
 * DB, prod-env, or fallback changes. Pure observation harness.
 *
 * Modes:
 *   MODE=off  → LUMINA_HQS_HUMAN_LIFT_ENABLED unset (picker uses base HQS)
 *   MODE=on   → LUMINA_HQS_HUMAN_LIFT_ENABLED=true (local audit only)
 *
 * Chunking:
 *   COHORT=ng_clean|ng_lp|western|all
 *   CREATOR_START / CREATOR_END
 *   Per-batch flush + per-cohort partial file => safe to resume.
 *
 * Workflow flags pinned to match the api-server workflow command so
 * the picker behavior under audit matches production:
 *   LUMINA_NG_PACK_ENABLED=true
 *   LUMINA_NG_PACK_AWARE_RETENTION_ENABLED=true
 *   LUMINA_NG_MEMORY_SOFT_CAP_ENABLED=true
 *   LUMINA_W2_WESTERN_APPROVED_ENABLED=true
 *   LUMINA_W2M_LOCAL_FIRST_REFRESH_ENABLED=true
 *   LUMINA_NG_CLEAN_SLOT0_MEMORY_AWARE_PICKER_ENABLED=true
 *   LUMINA_NG_CLEAN_FIRST_CARD_RESERVATION_ENABLED=true
 *   LUMINA_FALLBACK_GAP_ONLY=true
 *   LUMINA_NG_PACK_PROJECTION_T2_ENABLED=true
 *
 * Run:
 *   MODE=off  COHORT=ng_clean CREATOR_START=0 CREATOR_END=3 \
 *     pnpm --filter @workspace/api-server exec tsx \
 *       src/qa/p16a4NgCleanRuntimeSurfaceAudit.ts
 *   ... (chunks) ...
 *   MODE=off  AGGREGATE=1 ... (write off-mode summary)
 *   MODE=on   ... (repeat)
 *   MODE=both AGGREGATE=1 (write combined summary)
 */

// Pin workflow env BEFORE any lib imports (modules read flags at load).
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
// MODE handling: ON sets HUMAN_LIFT for THIS process only. OFF leaves it
// unset so the base scorer path runs.
const MODE = (process.env.MODE ?? "off").toLowerCase();
if (MODE === "on") {
  process.env.LUMINA_HQS_HUMAN_LIFT_ENABLED = "true";
} else {
  delete process.env.LUMINA_HQS_HUMAN_LIFT_ENABLED;
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

const P16_A3_IMPORTED_IDS: ReadonlySet<string> = new Set([
  // earlier P16-A3 survivors (5)
  "ng_clean_075", "ng_clean_076", "ng_clean_077",
  "ng_clean_090", "ng_clean_092",
  // P16-A3 REVISION imports (13)
  "ng_clean_078", "ng_clean_079", "ng_clean_081", "ng_clean_082",
  "ng_clean_083", "ng_clean_084", "ng_clean_085", "ng_clean_086",
  "ng_clean_087", "ng_clean_089", "ng_clean_091", "ng_clean_093",
  "ng_clean_094",
]);
const P16_A3_HELD_IDS: ReadonlySet<string> = new Set([
  "ng_clean_080", "ng_clean_088",
]);

// ---------- Hook → clean-core ID resolver ---------------------------

const CLEAN_CORE_HOOK_INDEX = new Map<string, string>();
const CLEAN_CORE_BY_ID = new Map<
  string,
  { id: string; draftId?: string; hook: string; reviewedBy?: string }
>();
for (const e of NIGERIAN_CLEAN_CORE_ENTRIES) {
  CLEAN_CORE_HOOK_INDEX.set(e.hook.toLowerCase().trim(), e.id);
  CLEAN_CORE_BY_ID.set(e.id, {
    id: e.id,
    draftId: (e as { draftId?: string }).draftId,
    hook: e.hook,
    reviewedBy: (e as { reviewedBy?: string }).reviewedBy,
  });
}
function resolveCleanCoreId(hook: string | undefined): string | null {
  if (!hook) return null;
  return CLEAN_CORE_HOOK_INDEX.get(hook.toLowerCase().trim()) ?? null;
}

// Sanity check the target sets match the corpus we just loaded.
for (const id of P16_A3_IMPORTED_IDS)
  if (!CLEAN_CORE_BY_ID.has(id))
    throw new Error(`P16-A4 probe: target id ${id} missing from corpus`);
for (const id of P16_A3_HELD_IDS)
  if (CLEAN_CORE_BY_ID.has(id))
    throw new Error(`P16-A4 probe: held id ${id} unexpectedly present`);

// ---------- Pidgin / stereotype leakage tokens ----------------------
// ng_clean output should contain ZERO of these.
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

// ---------- Deterministic UUID stub for creators --------------------

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

// ---------- Cohort + creator-profile config -------------------------

type Cohort = "ng_clean" | "ng_lp" | "western";

interface CohortConfig {
  region: string;
  languageStyle: "clean" | "light_pidgin" | null;
  creators: number;
  batchesPerCreator: number;
  helperShouldFire: boolean; // ng_clean slot-0 helper / first-card reservation
}
const COHORTS: Record<Cohort, CohortConfig> = {
  ng_clean: { region: "nigeria", languageStyle: "clean",         creators: 6, batchesPerCreator: 3, helperShouldFire: true  },
  ng_lp:    { region: "nigeria", languageStyle: "light_pidgin",  creators: 3, batchesPerCreator: 1, helperShouldFire: false },
  western:  { region: "western", languageStyle: null,             creators: 3, batchesPerCreator: 1, helperShouldFire: false },
};
const COUNT_PER_BATCH = 6;

// Audit's suggested 10 creator angles. The in-process call routes mainly
// on region+languageStyle+tasteCalibration, so `niche` here is realism
// flavor, not a behavior knob. We rotate through the angles so the 6
// ng_clean creators each represent a distinct everyday scenario.
const NG_CLEAN_NICHES: ReadonlyArray<string> = [
  "food/home",
  "fashion/outfit",
  "family comedy",
  "student/school/work",
  "market/errand",
  "phone/tech everyday",
  "church/family-life",
  "transport/queue",
  "creator self-awareness",
  "general lifestyle",
];

// ---------- DB helpers ----------------------------------------------

async function upsertCreator(
  id: string,
  cohort: Cohort,
  region: string,
  idx: number,
  niche: string,
): Promise<void> {
  const name = `qa_sweep:p16a4_ng_clean_runtime_surface:${MODE}:${cohort}:${idx}`;
  await db.execute(sql`
    INSERT INTO creators (
      id, name, location, niche, image_key, is_demo, region, currency, followers,
      nigerian_clean_core_slot0_seen_ids_json,
      nigerian_pack_seen_entry_ids_json,
      catalog_template_seen_ids_json,
      last_idea_batch_json,
      last_idea_batch_date
    )
    VALUES (
      ${id}, ${name}, 'Lagos, Nigeria', ${niche}, 'stub', true, ${region}, 'USD', 0,
      '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, NULL, NULL
    )
    ON CONFLICT (id) DO UPDATE SET
      region = EXCLUDED.region,
      niche  = EXCLUDED.niche,
      nigerian_clean_core_slot0_seen_ids_json = '[]'::jsonb,
      nigerian_pack_seen_entry_ids_json       = '[]'::jsonb,
      catalog_template_seen_ids_json          = '[]'::jsonb,
      last_idea_batch_json                    = NULL,
      last_idea_batch_date                    = NULL
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
    name: `qa_sweep:p16a4_ng_clean_runtime_surface:${MODE}:${cohort}:${idx}`,
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
  } as unknown as Creator;
}

// ---------- Per-batch run -------------------------------------------

interface IdeaRec {
  cohort: Cohort;
  creatorIdx: number;
  niche: string;
  batchInSeries: number;
  positionInBatch: number; // 0 = slot-0
  hook: string;
  caption: string;
  whatToShow: string;
  source: string | null; // qa.source (e.g. core_native, claude_fallback)
  cleanCoreId: string | null;
  isP16A3: boolean;
  isHeld: boolean;
  pidginLeak: string[]; // matched pidgin tokens (should be [] on ng_clean)
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
  let result;
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
  const shippedIdeas = result?.ideas ?? [];
  for (let i = 0; i < shippedIdeas.length; i++) {
    const idea = shippedIdeas[i];
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
      caption: idea.caption,
      whatToShow: idea.whatToShow,
      source: qa?.source ?? null,
      cleanCoreId,
      isP16A3: cleanCoreId !== null && P16_A3_IMPORTED_IDS.has(cleanCoreId),
      isHeld: cleanCoreId !== null && P16_A3_HELD_IDS.has(cleanCoreId),
      pidginLeak: leak,
    });
  }
  const batch: BatchRec = {
    cohort,
    creatorIdx,
    niche,
    batchInSeries,
    durationMs,
    shipped: shippedIdeas.length,
    underfill: error === null && shippedIdeas.length < COUNT_PER_BATCH,
    usedFallback: result?.usedFallback ?? null,
    fallbackReason:
      result?.qaTelemetry?.fallbackDecision?.reason ?? null,
    error,
  };
  return { ideas, batch };
}

// ---------- Main ----------------------------------------------------

const REPO_ROOT = process.env.REPO_ROOT ?? "/home/runner/workspace";
const OUT_DIR = path.join(REPO_ROOT, ".local", "qa-runs", "p16a4");
fs.mkdirSync(OUT_DIR, { recursive: true });

function partialPath(mode: string, cohort: Cohort): string {
  return path.join(OUT_DIR, `_partial_${mode}_${cohort}.json`);
}
function modeSummaryPath(mode: string): string {
  return path.join(OUT_DIR, `summary_${mode}.json`);
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

async function runCohortChunk(cohort: Cohort): Promise<void> {
  const cfg = COHORTS[cohort];
  const partial = loadPartial(partialPath(MODE, cohort));
  const cStart = Math.max(0, parseInt(process.env.CREATOR_START ?? "0", 10) || 0);
  const cEnd = Math.min(cfg.creators, parseInt(process.env.CREATOR_END ?? String(cfg.creators), 10) || cfg.creators);
  process.stderr.write(
    `\n=== mode=${MODE} cohort=${cohort} creators=[${cStart}..${cEnd}) batches/creator=${cfg.batchesPerCreator} ===\n`,
  );
  for (let i = cStart; i < cEnd; i++) {
    const niche = NG_CLEAN_NICHES[i % NG_CLEAN_NICHES.length];
    const id = uuidFromString(`p16a4:${MODE}:${cohort}:c${i}`);
    await upsertCreator(id, cohort, cfg.region, i, niche);
    const haveForCreator = partial.batches.filter(
      (b) => b.cohort === cohort && b.creatorIdx === i,
    ).length;
    if (haveForCreator >= cfg.batchesPerCreator) {
      process.stderr.write(`  c${i} ${niche} already complete (${haveForCreator}/${cfg.batchesPerCreator})\n`);
      continue;
    }
    for (let b = haveForCreator; b < cfg.batchesPerCreator; b++) {
      const r = await runOneBatch(cohort, id, i, niche, b);
      partial.ideas.push(...r.ideas);
      partial.batches.push(r.batch);
      const slot0Id = r.ideas[0]?.cleanCoreId ?? "-";
      const p16a3Cards = r.ideas.filter((x) => x.isP16A3).length;
      const heldCards = r.ideas.filter((x) => x.isHeld).length;
      const leakCards = r.ideas.filter((x) => x.pidginLeak.length > 0).length;
      process.stderr.write(
        `  [${cohort} c${i} b${b} ${niche}] ` +
        `slot0=${slot0Id} p16a3=${p16a3Cards}/6 held=${heldCards} leak=${leakCards} ` +
        `fb=${r.batch.usedFallback ?? "?"} ${r.batch.durationMs}ms` +
        `${r.batch.error ? " ERR=" + r.batch.error.slice(0, 80) : ""}\n`,
      );
      savePartial(partialPath(MODE, cohort), partial);
    }
  }
}

interface ModeSummary {
  mode: string;
  totalIdeas: number;
  totalBatches: number;
  perCohort: Record<Cohort, {
    ideas: number; batches: number;
    underfills: number; errors: number;
    fallbackUsed: number; fallbackReasons: Record<string, number>;
    avgBatchMs: number;
  }>;
  ngClean: {
    totalIdeas: number;
    distinctCleanCoreIds: number;
    p16a3Total: number;
    p16a3Slot0: number;
    p16a3DistinctIds: number;
    p16a3Share: number;       // p16a3Total / totalIdeas
    p16a3Slot0Share: number;  // p16a3Slot0 / batches
    olderTotal: number;       // clean-core ID present AND not P16-A3
    olderSlot0: number;
    olderDistinctIds: number;
    nonCoreTotal: number;     // catalog/pattern/other (clean-core ID null)
    nonCoreSlot0: number;
    heldAppearances: number;  // MUST be 0
    pidginLeakCards: number;  // MUST be 0
    perIdSurfacing: Array<{
      id: string; draftId: string | null; hook: string; reviewedBy: string | null;
      total: number; slot0: number; avgPosition: number | null;
      isP16A3: boolean;
    }>;
    p16a3SurfacedIds: string[];
    p16a3UnsurfacedIds: string[];
    topOlderSurfacing: Array<{ id: string; total: number; slot0: number; hook: string }>;
    firstCardSample: Array<{
      cohort: Cohort; creatorIdx: number; niche: string; batch: number;
      hook: string; cleanCoreId: string | null;
      sourceType: "P16-A3" | "older ng_clean" | "non-core" | "unknown";
      qualitative: "strong" | "acceptable" | "weak";
      note: string;
    }>;
    repeatedHooks: Array<{ hook: string; count: number }>;
    repeatedSlot0Ids: Array<{ id: string; count: number }>;
  };
  leakage: {
    ng_lp: { totalIdeas: number; cleanCoreIdHit: number; sample: string[] };
    western: { totalIdeas: number; cleanCoreIdHit: number; sample: string[] };
  };
  acceptance: Record<string, boolean>;
  decision: "PASS" | "HOLD" | "FAIL";
}

function qualitativeJudge(hook: string, isP16A3: boolean, leak: string[]): {
  q: "strong" | "acceptable" | "weak"; note: string;
} {
  // Lightweight heuristic. Not a substitute for human eval, but
  // surfaces obvious problems (pidgin leak, very short, repeated
  // boilerplate openers).
  if (leak.length > 0) return { q: "weak", note: `pidgin leak: ${leak.join(",")}` };
  const wc = hook.split(/\s+/).filter(Boolean).length;
  if (wc < 5) return { q: "weak", note: `too short (${wc} words)` };
  if (wc > 22) return { q: "acceptable", note: `long (${wc} words)` };
  if (isP16A3) return { q: "strong", note: "P16-A3 import landed" };
  return { q: "acceptable", note: `${wc} words` };
}

function aggregateMode(mode: string): ModeSummary {
  const all: Record<Cohort, PartialFile> = {
    ng_clean: loadPartial(partialPath(mode, "ng_clean")),
    ng_lp:    loadPartial(partialPath(mode, "ng_lp")),
    western:  loadPartial(partialPath(mode, "western")),
  };
  const allIdeas = [...all.ng_clean.ideas, ...all.ng_lp.ideas, ...all.western.ideas];
  const allBatches = [...all.ng_clean.batches, ...all.ng_lp.batches, ...all.western.batches];

  const perCohort: ModeSummary["perCohort"] = {
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
      if (b.fallbackReason !== null) {
        perCohort[c].fallbackReasons[b.fallbackReason] =
          (perCohort[c].fallbackReasons[b.fallbackReason] ?? 0) + 1;
      }
    }
    const total = p.batches.reduce((s, b) => s + b.durationMs, 0);
    perCohort[c].avgBatchMs =
      p.batches.length === 0 ? 0 : Math.round(total / p.batches.length);
  }

  const ngCleanIdeas = all.ng_clean.ideas;
  const ngCleanBatches = all.ng_clean.batches;
  const ngCleanIdeasByCleanCore = ngCleanIdeas.filter((i) => i.cleanCoreId !== null);
  const p16a3Cards = ngCleanIdeas.filter((i) => i.isP16A3);
  const olderCards = ngCleanIdeas.filter((i) => i.cleanCoreId !== null && !i.isP16A3);
  const slot0Cards = ngCleanIdeas.filter((i) => i.positionInBatch === 0);
  const heldCards = ngCleanIdeas.filter((i) => i.isHeld);
  const leakCards = ngCleanIdeas.filter((i) => i.pidginLeak.length > 0);

  // Per-ID surfacing
  const surfaceMap = new Map<string, { total: number; slot0: number; positions: number[] }>();
  for (const idea of ngCleanIdeasByCleanCore) {
    const id = idea.cleanCoreId!;
    if (!surfaceMap.has(id)) surfaceMap.set(id, { total: 0, slot0: 0, positions: [] });
    const r = surfaceMap.get(id)!;
    r.total += 1;
    if (idea.positionInBatch === 0) r.slot0 += 1;
    r.positions.push(idea.positionInBatch);
  }
  const perIdSurfacing: ModeSummary["ngClean"]["perIdSurfacing"] =
    [...surfaceMap.entries()]
      .map(([id, r]) => {
        const meta = CLEAN_CORE_BY_ID.get(id)!;
        return {
          id, draftId: meta.draftId ?? null, hook: meta.hook,
          reviewedBy: meta.reviewedBy ?? null,
          total: r.total, slot0: r.slot0,
          avgPosition: r.positions.length === 0 ? null
            : Math.round(r.positions.reduce((s, x) => s + x, 0) / r.positions.length * 100) / 100,
          isP16A3: P16_A3_IMPORTED_IDS.has(id),
        };
      })
      .sort((a, b) => b.total - a.total);

  const p16a3SurfacedIds = perIdSurfacing.filter((r) => r.isP16A3).map((r) => r.id);
  const p16a3UnsurfacedIds = [...P16_A3_IMPORTED_IDS].filter((id) => !p16a3SurfacedIds.includes(id));
  const topOlderSurfacing = perIdSurfacing
    .filter((r) => !r.isP16A3)
    .slice(0, 10)
    .map((r) => ({ id: r.id, total: r.total, slot0: r.slot0, hook: r.hook }));

  // First-card sample (top 20 across batches; ng_clean only)
  const firstCardSample: ModeSummary["ngClean"]["firstCardSample"] = slot0Cards
    .slice(0, 20)
    .map((idea) => {
      const sourceType: ModeSummary["ngClean"]["firstCardSample"][number]["sourceType"] =
        idea.isP16A3 ? "P16-A3"
          : idea.cleanCoreId !== null ? "older ng_clean"
          : idea.source !== null ? "non-core"
          : "unknown";
      const j = qualitativeJudge(idea.hook, idea.isP16A3, idea.pidginLeak);
      return {
        cohort: idea.cohort, creatorIdx: idea.creatorIdx, niche: idea.niche,
        batch: idea.batchInSeries,
        hook: idea.hook, cleanCoreId: idea.cleanCoreId,
        sourceType, qualitative: j.q, note: j.note,
      };
    });

  // Repetition: same hook within all ng_clean output (any creator/batch)
  const hookCounts = new Map<string, number>();
  for (const i of ngCleanIdeas) {
    const k = i.hook.toLowerCase().trim();
    hookCounts.set(k, (hookCounts.get(k) ?? 0) + 1);
  }
  const repeatedHooks = [...hookCounts.entries()]
    .filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([hook, count]) => ({ hook, count }));

  const slot0IdCounts = new Map<string, number>();
  for (const i of slot0Cards) {
    if (i.cleanCoreId === null) continue;
    slot0IdCounts.set(i.cleanCoreId, (slot0IdCounts.get(i.cleanCoreId) ?? 0) + 1);
  }
  const repeatedSlot0Ids = [...slot0IdCounts.entries()]
    .filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, count]) => ({ id, count }));

  // Leakage on negative controls (cohort-cross check that ng_clean
  // entries don't surface in non-clean cohorts via hook string match)
  const lpHits = all.ng_lp.ideas.filter((i) => i.cleanCoreId !== null);
  const wHits  = all.western.ideas.filter((i) => i.cleanCoreId !== null);

  const ngClean: ModeSummary["ngClean"] = {
    totalIdeas: ngCleanIdeas.length,
    distinctCleanCoreIds: surfaceMap.size,
    p16a3Total: p16a3Cards.length,
    p16a3Slot0: p16a3Cards.filter((i) => i.positionInBatch === 0).length,
    p16a3DistinctIds: p16a3SurfacedIds.length,
    p16a3Share: ngCleanIdeas.length === 0 ? 0
      : Math.round((p16a3Cards.length / ngCleanIdeas.length) * 1000) / 1000,
    p16a3Slot0Share: ngCleanBatches.length === 0 ? 0
      : Math.round(
          (p16a3Cards.filter((i) => i.positionInBatch === 0).length / ngCleanBatches.length) * 1000,
        ) / 1000,
    olderTotal: olderCards.length,
    olderSlot0: olderCards.filter((i) => i.positionInBatch === 0).length,
    olderDistinctIds: new Set(olderCards.map((i) => i.cleanCoreId!)).size,
    nonCoreTotal: ngCleanIdeas.filter((i) => i.cleanCoreId === null).length,
    nonCoreSlot0: ngCleanIdeas.filter((i) => i.cleanCoreId === null && i.positionInBatch === 0).length,
    heldAppearances: heldCards.length,
    pidginLeakCards: leakCards.length,
    perIdSurfacing,
    p16a3SurfacedIds,
    p16a3UnsurfacedIds,
    topOlderSurfacing,
    firstCardSample,
    repeatedHooks,
    repeatedSlot0Ids,
  };

  // Acceptance criteria from the audit doc
  const acceptance: Record<string, boolean> = {
    "P16-A3 entries surface at least sometimes": ngClean.p16a3Total > 0,
    "≥ 3 distinct P16-A3 entries surface": ngClean.p16a3DistinctIds >= 3,
    "≥ 1 P16-A3 entry appears as first-card / slot-0": ngClean.p16a3Slot0 >= 1,
    "Held IDs (080, 088) do not appear": ngClean.heldAppearances === 0,
    "No pidgin leakage on ng_clean": ngClean.pidginLeakCards === 0,
    "No batch-level errors on ng_clean": perCohort.ng_clean.errors === 0,
    "No underfills on ng_clean": perCohort.ng_clean.underfills === 0,
    "Old ng_clean entries still compete (≥ 1)": ngClean.olderTotal >= 1,
    "Slot-0 not dominated by a single P16-A3 ID":
      !(repeatedSlot0Ids.length > 0 &&
        ngClean.p16a3Slot0 > 0 &&
        repeatedSlot0Ids[0].count >= Math.max(2, Math.ceil(ngCleanBatches.length * 0.5))),
    "No ng_clean entry-id leak into ng_lp": lpHits.length === 0,
    "No ng_clean entry-id leak into western": wHits.length === 0,
  };
  const allPass = Object.values(acceptance).every(Boolean);
  // Decision
  let decision: ModeSummary["decision"];
  if (ngClean.heldAppearances > 0) decision = "FAIL";
  else if (perCohort.ng_clean.errors > 0) decision = "FAIL";
  else if (allPass) decision = "PASS";
  else decision = "HOLD";

  return {
    mode,
    totalIdeas: allIdeas.length,
    totalBatches: allBatches.length,
    perCohort,
    ngClean,
    leakage: {
      ng_lp: {
        totalIdeas: all.ng_lp.ideas.length,
        cleanCoreIdHit: lpHits.length,
        sample: lpHits.slice(0, 3).map((i) => `${i.cleanCoreId}: ${i.hook.slice(0, 80)}`),
      },
      western: {
        totalIdeas: all.western.ideas.length,
        cleanCoreIdHit: wHits.length,
        sample: wHits.slice(0, 3).map((i) => `${i.cleanCoreId}: ${i.hook.slice(0, 80)}`),
      },
    },
    acceptance,
    decision,
  };
}

async function main() {
  const aggOnly = process.env.AGGREGATE === "1";
  const cohortFilter = (process.env.COHORT ?? "all").toLowerCase();
  process.stderr.write(
    `[p16a4] mode=${MODE} aggregate=${aggOnly} cohort=${cohortFilter} ` +
    `humanLift=${process.env.LUMINA_HQS_HUMAN_LIFT_ENABLED ?? "unset"} ` +
    `corpus=${NIGERIAN_CLEAN_CORE_ENTRIES.length}\n`,
  );

  if (!aggOnly) {
    const cohorts: Cohort[] =
      cohortFilter === "all" ? ["ng_clean", "ng_lp", "western"]
      : cohortFilter === "ng_clean" ? ["ng_clean"]
      : cohortFilter === "ng_lp" ? ["ng_lp"]
      : cohortFilter === "western" ? ["western"]
      : (() => { throw new Error(`unknown COHORT=${cohortFilter}`); })();
    for (const c of cohorts) await runCohortChunk(c);
  }

  // Write per-mode summary if all 3 partials exist for THIS mode.
  const haveAll = (["ng_clean", "ng_lp", "western"] as Cohort[])
    .every((c) => fs.existsSync(partialPath(MODE, c)));
  if (haveAll) {
    const summary = aggregateMode(MODE);
    fs.writeFileSync(modeSummaryPath(MODE), JSON.stringify(summary, null, 2));
    process.stderr.write(
      `[p16a4] wrote ${modeSummaryPath(MODE)} decision=${summary.decision} ` +
      `p16a3=${summary.ngClean.p16a3Total}/${summary.ngClean.totalIdeas} ` +
      `slot0=${summary.ngClean.p16a3Slot0} held=${summary.ngClean.heldAppearances} ` +
      `leak=${summary.ngClean.pidginLeakCards}\n`,
    );
  }

  // If both modes have summaries, also write a combined view.
  const offSum = fs.existsSync(modeSummaryPath("off")) ? JSON.parse(fs.readFileSync(modeSummaryPath("off"), "utf-8")) as ModeSummary : null;
  const onSum  = fs.existsSync(modeSummaryPath("on"))  ? JSON.parse(fs.readFileSync(modeSummaryPath("on"),  "utf-8")) as ModeSummary : null;
  if (offSum && onSum) {
    fs.writeFileSync(combinedSummaryPath(), JSON.stringify({
      generatedAt: new Date().toISOString(),
      modeOff: offSum,
      modeOn: onSum,
      crossMode: {
        offDecision: offSum.decision, onDecision: onSum.decision,
        offP16a3Share: offSum.ngClean.p16a3Share,
        onP16a3Share: onSum.ngClean.p16a3Share,
        offP16a3DistinctIds: offSum.ngClean.p16a3DistinctIds,
        onP16a3DistinctIds: onSum.ngClean.p16a3DistinctIds,
      },
    }, null, 2));
    process.stderr.write(`[p16a4] wrote combined summary (off=${offSum.decision} on=${onSum.decision})\n`);
  }
}

async function cleanupProbeCreators(): Promise<void> {
  // Probe creators are stamped with a unique name prefix, so cleanup
  // is safely scoped — nothing else in the DB shares this name pattern.
  // Run unconditionally so successive probe runs leave no residue.
  try {
    await db.execute(sql`
      DELETE FROM creators
      WHERE name LIKE 'qa_sweep:p16a4_ng_clean_runtime_surface:%'
    `);
  } catch (e) {
    process.stderr.write(`[p16a4] cleanup warning: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => {
    await cleanupProbeCreators();
    void db.$client.end();
  });
