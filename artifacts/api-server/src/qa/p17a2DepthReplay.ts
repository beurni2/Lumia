/**
 * P17-A2 — NG light_pidgin pack-pool depth replay (30 batches).
 *
 * Same UI request shape as P17-A1B. Captures EVERYTHING needed to
 * attribute depth saturation:
 *
 *  - per batch: slotReservationDiagnostic (preFilter, postMemory,
 *    postBatchDedup, softCapRescueFired, softCapRelaxedSeenSize,
 *    earlyReturnEmptyPack)
 *  - per batch: per-idea (premiseCoreId, nigerianPackEntryId, source,
 *    anchor)
 *  - per batch: in-batch entry-id duplicates
 *  - per batch: overlap with previous + with all prior + cumulative
 *    distinct
 *  - per batch: memory size before / after (from a side-channel DB
 *    query so we can prove the cap is saturated)
 *
 * Resume support via P17_START_BATCH / P17_STOP_BATCH (10 s reaper).
 *
 * Writes:
 *   .local/P17_A2_DEPTH_REPLAY.json
 *   .local/_p17a2_partial.json
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";

import { db, schema } from "../db/client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT_DIR = path.resolve(__dirname, "..", "..", "..", "..", ".local");
fs.mkdirSync(OUT_DIR, { recursive: true });

const API_URL =
  process.env.P17_LIVE_API_URL ?? "http://localhost:80/api/ideator/generate";
const PER_BATCH_TIMEOUT_MS = 75_000;
const N_BATCHES = 30;
const COUNT = 5;
const INTER_BATCH_MS = 100;
const CANONICAL_DEMO_ID = "00000000-0000-0000-0000-0000000a1e00";
const STATE_FILE = path.join(OUT_DIR, "_p17a2_partial.json");
const FINAL_FILE = path.join(OUT_DIR, "P17_A2_DEPTH_REPLAY.json");

interface QaPerIdea {
  source?: string;
  premiseCoreId?: string;
  nigerianPackEntryId?: string;
  anchor?: string;
  hookQualityScore?: number;
}
interface SlotResDiag {
  packPoolPreFilter: number;
  packPoolPostMemoryFilter: number;
  packPoolPostBatchDedup: number;
  earlyReturnEmptyPack: boolean;
  softCapRescueFired: boolean;
  softCapRelaxedSeenSize: number | null;
}
interface GenResp {
  ideas: Array<{ hook: string }>;
  qaTelemetry?: {
    perIdea: QaPerIdea[];
    fallbackDecision?: { needFallback: boolean; reason: string };
    routeResolvedCreatorId?: string;
    slotReservationDiagnostic?: SlotResDiag;
  };
  usedFallback?: boolean;
}

async function callApi(body: Record<string, unknown>) {
  const t0 = Date.now();
  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-lumina-qa-expose-meta": "1",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PER_BATCH_TIMEOUT_MS),
    });
    const tResp = Date.now();
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return {
        resp: null as GenResp | null,
        durationMs: tResp - t0,
        err: `HTTP ${r.status}: ${text.slice(0, 200)}`,
      };
    }
    return {
      resp: (await r.json()) as GenResp,
      durationMs: tResp - t0,
      err: null as string | null,
    };
  } catch (e) {
    return {
      resp: null as GenResp | null,
      durationMs: Date.now() - t0,
      err: String((e as Error).message ?? e),
    };
  }
}

async function memorySize(creatorId: string): Promise<number> {
  try {
    const rows = await db
      .select({ m: schema.creators.nigerianPackSeenEntryIdsJson })
      .from(schema.creators)
      .where(eq(schema.creators.id, creatorId))
      .limit(1);
    const m = rows[0]?.m;
    return Array.isArray(m) ? m.length : 0;
  } catch {
    return -1;
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Batch {
  batchIdx: number;
  isInitial: boolean;
  durationMs: number;
  err: string | null;
  routeRowOK: boolean;
  ideaCount: number;
  hooks: string[];
  packEntryIds: Array<string | null>;
  premiseCoreIds: Array<string | null>;
  packShipped: number;
  inBatchEntryIdDupCount: number;
  inBatchHookDupCount: number;
  fallbackReason: string | null;
  usedFallback: boolean | null;
  slotResDiag: SlotResDiag | null;
  memSizeBefore: number;
  memSizeAfter: number;
  excludeHooksSentCount: number;
  hookOverlapPrev: number;
  hookOverlapAllPrior: number;
  packOverlapAllPrior: number;
  cumulativeDistinctPackIds: number;
}

async function main() {
  const start = Number(process.env.P17_START_BATCH ?? "0");
  const stop = Number(process.env.P17_STOP_BATCH ?? String(N_BATCHES));

  let batches: Batch[] = [];
  let lastHooks: string[] = [];
  const allPriorHooks = new Set<string>();
  const allPriorPackIds = new Set<string>();
  let tStart = Date.now();

  if (start > 0 && fs.existsSync(STATE_FILE)) {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    batches = s.batches;
    lastHooks = s.lastHooks ?? [];
    for (const h of s.allPriorHooks ?? []) allPriorHooks.add(h);
    for (const p of s.allPriorPackIds ?? []) allPriorPackIds.add(p);
    tStart = s.tStart ?? Date.now();
    console.log(`[p17a2-rep] resumed prior=${batches.length}`);
  }

  for (let i = start; i < stop; i++) {
    const isInitial = i === 0;
    const memBefore = await memorySize(CANONICAL_DEMO_ID);
    const excludeHooks = isInitial
      ? []
      : lastHooks
          .map((h) => h.toLowerCase().trim())
          .filter((h) => h.length > 0)
          .slice(0, 20);
    const body: Record<string, unknown> = isInitial
      ? { region: "nigeria", count: COUNT }
      : { region: "nigeria", count: COUNT, regenerate: true, excludeHooks };

    const r = await callApi(body);
    const ideas = r.resp?.ideas ?? [];
    const hooks = ideas.map((x) => x.hook);
    const perIdea = r.resp?.qaTelemetry?.perIdea ?? [];
    const packEntryIds = perIdea.map((p) => p?.nigerianPackEntryId ?? null);
    const premiseCoreIds = perIdea.map((p) => p?.premiseCoreId ?? null);
    const packShipped = packEntryIds.filter((x) => x !== null).length;

    const idCounts = new Map<string, number>();
    for (const id of packEntryIds) if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
    const inBatchIdDup = [...idCounts.values()].filter((c) => c > 1).length;
    const hookCounts = new Map<string, number>();
    for (const h of hooks) {
      const k = h.toLowerCase().trim();
      hookCounts.set(k, (hookCounts.get(k) ?? 0) + 1);
    }
    const inBatchHookDup = [...hookCounts.values()].filter((c) => c > 1).length;

    const lastSet = new Set(lastHooks.map((h) => h.toLowerCase().trim()));
    const overlapPrev = hooks.filter((h) => lastSet.has(h.toLowerCase().trim())).length;
    const overlapAllPrior = hooks.filter((h) =>
      allPriorHooks.has(h.toLowerCase().trim()),
    ).length;
    const packOverlapAllPrior = packEntryIds.filter(
      (id): id is string => id !== null && allPriorPackIds.has(id),
    ).length;

    for (const h of hooks) allPriorHooks.add(h.toLowerCase().trim());
    for (const id of packEntryIds) if (id) allPriorPackIds.add(id);
    lastHooks = hooks;

    const memAfter = await memorySize(CANONICAL_DEMO_ID);

    const b: Batch = {
      batchIdx: i,
      isInitial,
      durationMs: r.durationMs,
      err: r.err,
      routeRowOK:
        r.resp?.qaTelemetry?.routeResolvedCreatorId === CANONICAL_DEMO_ID,
      ideaCount: ideas.length,
      hooks,
      packEntryIds,
      premiseCoreIds,
      packShipped,
      inBatchEntryIdDupCount: inBatchIdDup,
      inBatchHookDupCount: inBatchHookDup,
      fallbackReason: r.resp?.qaTelemetry?.fallbackDecision?.reason ?? null,
      usedFallback: r.resp?.usedFallback ?? null,
      slotResDiag: r.resp?.qaTelemetry?.slotReservationDiagnostic ?? null,
      memSizeBefore: memBefore,
      memSizeAfter: memAfter,
      excludeHooksSentCount: excludeHooks.length,
      hookOverlapPrev: overlapPrev,
      hookOverlapAllPrior: overlapAllPrior,
      packOverlapAllPrior,
      cumulativeDistinctPackIds: allPriorPackIds.size,
    };
    batches.push(b);

    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify({
        batches,
        lastHooks,
        allPriorHooks: [...allPriorHooks],
        allPriorPackIds: [...allPriorPackIds],
        tStart,
      }),
    );
    fs.writeFileSync(
      FINAL_FILE,
      JSON.stringify(
        { runStart: new Date(tStart).toISOString(), completed: i + 1, batches },
        null,
        2,
      ),
    );

    const d = b.slotResDiag;
    console.log(
      `[p17a2-rep] b=${i + 1}/${N_BATCHES} ${isInitial ? "INIT" : "REGEN"} ms=${r.durationMs} ideas=${ideas.length} pack=${packShipped}/${COUNT} routeOK=${b.routeRowOK} mem=${memBefore}->${memAfter} ` +
        (d
          ? `pre=${d.packPoolPreFilter} postMem=${d.packPoolPostMemoryFilter} postBD=${d.packPoolPostBatchDedup} rescue=${d.softCapRescueFired} earlyEmpty=${d.earlyReturnEmptyPack}`
          : `diag=null`) +
        ` overlapPrev=${overlapPrev} allPrior=${overlapAllPrior} cumDistinctPack=${allPriorPackIds.size}` +
        (r.err ? ` err=${r.err.slice(0, 60)}` : ""),
    );

    if (INTER_BATCH_MS > 0) await sleep(INTER_BATCH_MS);
  }

  console.log(`[p17a2-rep] done ${Math.round((Date.now() - tStart) / 1000)}s`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("[p17a2-rep] FATAL", e);
    process.exit(1);
  },
);
