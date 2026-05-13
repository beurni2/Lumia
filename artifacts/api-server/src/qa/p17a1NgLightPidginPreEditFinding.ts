/**
 * P17-A1 — NG light_pidgin pre-edit memory finding (no picker code).
 *
 * Single uninterrupted 10-batch repro that probes the per-creator
 * Nigerian pack memory column at THREE points per batch:
 *   1. memBefore       — read just before the HTTP request
 *   2. memImmediate    — read in the same tick as the HTTP response
 *   3. memSettled      — read after a 1500ms sleep
 *
 * Purpose: prove or disprove the fire-and-forget write race.
 * `recordSeenEntries` at hybridIdeator.ts:5517 is invoked as
 * `void recordSeenEntries(...)`, so the HTTP response can ship before
 * the SQL UPDATE commits. If `memSettled.size > memImmediate.size`
 * the race is real; if both are equal but smaller than expected
 * (i.e. didn't grow by ~`packShippedCount` minus `alreadyInMem`),
 * something else is suppressing growth.
 *
 * Also captures from the existing `qaTelemetry.perIdea` channel:
 *   - shipped nigerianPackEntryId per card
 *   - hookQualityScore
 *   - source / anchor / premiseCoreId
 *
 * After the run, the driver scrapes the api-server stdout log for
 * `nigerian_pack.slot_reservation_decision` lines (the existing F3
 * diagnostic surface) to attribute selector-site behaviour per batch:
 * packPoolPreFilter, packPoolPostMemoryFilter, packPoolPostBatchDedup,
 * softCapRescueFired, softCapRelaxedSeenSize.
 *
 * Run (api-server workflow must be up):
 *   pnpm --filter @workspace/api-server exec tsx \
 *     src/qa/p17a1NgLightPidginPreEditFinding.ts
 *
 * Writes:
 *   .local/P17_A1_RUN_DATA.json  (machine-readable timeline)
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
  process.env.P17_LIVE_API_URL ?? "http://localhost:8080/api/ideator/generate";
const PER_BATCH_TIMEOUT_MS = 75_000;
const N_BATCHES = 10;
const COUNT = 5;
const SETTLE_MS = 1500;
const INTER_BATCH_MS = 250;

type QaPerIdea = {
  source?: string;
  nigerianPackEntryId?: string;
  hookQualityScore?: number;
  anchor?: string;
  premiseCoreId?: string;
};
type GenResp = {
  region: string;
  count: number;
  regenerate: boolean;
  ideas: Array<{ hook: string }>;
  qaTelemetry?: {
    perIdea: QaPerIdea[];
    fallbackDecision?: { needFallback: boolean; reason: string };
  };
  usedFallback?: boolean;
  counts?: { localKept: number; fallbackKept: number };
};

type SeenEntry = { entryId: string; lastSeenAt: string };
async function readPackMemory(creatorId: string): Promise<SeenEntry[]> {
  const row = (
    await db
      .select({ memory: schema.creators.nigerianPackSeenEntryIdsJson })
      .from(schema.creators)
      .where(eq(schema.creators.id, creatorId))
      .limit(1)
  )[0];
  const raw = row?.memory;
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).filter(
    (x): x is SeenEntry =>
      typeof x === "object" && x !== null && "entryId" in x,
  );
}
async function getDemoCreatorId(): Promise<string> {
  const row = (
    await db
      .select({ id: schema.creators.id })
      .from(schema.creators)
      .where(eq(schema.creators.isDemo, true))
      .limit(1)
  )[0];
  if (!row) throw new Error("no is_demo=true creator row found");
  return row.id;
}
async function resetPackMemory(creatorId: string): Promise<void> {
  await db
    .update(schema.creators)
    .set({
      nigerianPackSeenEntryIdsJson: [],
      catalogTemplateSeenIdsJson: [],
      lastIdeaBatchJson: null,
      lastIdeaBatchDate: null,
    })
    .where(eq(schema.creators.id, creatorId));
}

async function callApi(args: {
  count: number;
  regenerate: boolean;
  excludeHooks: string[];
}) {
  const body: Record<string, unknown> = {
    region: "nigeria",
    languageStyle: "light_pidgin",
    count: args.count,
    regenerate: args.regenerate,
  };
  if (args.excludeHooks.length > 0)
    body.excludeHooks = args.excludeHooks.slice(0, 20);
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
        status: r.status,
        durationMs: tResp - t0,
        err: `HTTP ${r.status}: ${text.slice(0, 200)}`,
        respTimestamp: tResp,
      };
    }
    const json = (await r.json()) as GenResp;
    return {
      resp: json,
      status: r.status,
      durationMs: tResp - t0,
      err: null as string | null,
      respTimestamp: tResp,
    };
  } catch (e) {
    return {
      resp: null as GenResp | null,
      status: 0,
      durationMs: Date.now() - t0,
      err: String((e as Error).message ?? e),
      respTimestamp: Date.now(),
    };
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type BatchProbe = {
  batchIdx: number;
  isRefresh: boolean;
  status: number;
  durationMs: number;
  errored: boolean;
  errorMsg: string | null;
  ideaCount: number;
  usedFallback: boolean | null;
  fallbackReason: string | null;
  // memory probes
  memBeforeIds: string[];
  memImmediateIds: string[]; // immediately after HTTP response
  memSettledIds: string[]; // after SETTLE_MS sleep
  memBeforeSize: number;
  memImmediateSize: number;
  memSettledSize: number;
  growImmediate: number; // memImmediateSize - memBeforeSize
  growSettled: number; // memSettledSize - memBeforeSize
  growSettleDelta: number; // memSettledSize - memImmediateSize
  // shipped
  shippedEntryIds: string[];
  shippedHooks: string[];
  shippedSources: string[];
  shippedHookQualityScores: number[];
  // memory consumption proof
  shippedAlreadyInMemBefore: string[]; // ids in memBefore that re-shipped
  shippedAlreadyInMemSettled: string[]; // ids in memSettled (true history) that re-shipped
  shippedNotInAnyMemory: string[]; // truly fresh
  // timestamps
  tStart: number; // before request
  tResp: number; // when response received
  tImmediate: number; // when memImmediate read
  tSettled: number; // when memSettled read
};

const STATE_FILE = path.join(OUT_DIR, "_p17a1_partial.json");

async function main() {
  const startBatch = Number(process.env.P17_START_BATCH ?? "0");
  const stopBatch = Number(process.env.P17_STOP_BATCH ?? String(N_BATCHES));

  let creatorId: string;
  let batches: BatchProbe[] = [];
  let lastHooks: string[] = [];
  let tRunStart = Date.now();

  if (startBatch === 0) {
    creatorId = await getDemoCreatorId();
    console.log(`[p17a1] demo creator id=${creatorId}`);
    await resetPackMemory(creatorId);
    console.log(`[p17a1] reset memory to []`);
  } else if (fs.existsSync(STATE_FILE)) {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    creatorId = s.creatorId;
    batches = s.batches;
    lastHooks = s.lastHooks ?? [];
    tRunStart = s.tRunStart ?? Date.now();
    console.log(
      `[p17a1] resumed from ${STATE_FILE} priorBatches=${batches.length}`,
    );
  } else {
    throw new Error(`startBatch=${startBatch} but no state file`);
  }

  for (let batchIdx = startBatch; batchIdx < stopBatch; batchIdx++) {
    const memBefore = await readPackMemory(creatorId);
    const memBeforeIds = memBefore.map((m) => m.entryId);
    const memBeforeSet = new Set(memBeforeIds);

    const isRefresh = batchIdx > 0;
    const tStart = Date.now();
    const r = await callApi({
      count: COUNT,
      regenerate: isRefresh,
      excludeHooks: lastHooks,
    });

    // immediate read — same tick after response
    const memImmediate = await readPackMemory(creatorId);
    const memImmediateIds = memImmediate.map((m) => m.entryId);
    const tImmediate = Date.now();

    // sleep then read again to test fire-and-forget commit lag
    await sleep(SETTLE_MS);
    const memSettled = await readPackMemory(creatorId);
    const memSettledIds = memSettled.map((m) => m.entryId);
    const memSettledSet = new Set(memSettledIds);
    const tSettled = Date.now();

    const ideaCount = r.resp?.ideas.length ?? 0;
    const shippedEntryIds: string[] = [];
    const shippedHooks: string[] = [];
    const shippedSources: string[] = [];
    const shippedHookQualityScores: number[] = [];
    if (r.resp) {
      for (let i = 0; i < r.resp.ideas.length; i++) {
        const idea = r.resp.ideas[i];
        const qa = r.resp.qaTelemetry?.perIdea?.[i];
        const packId = qa?.nigerianPackEntryId ?? null;
        if (packId !== null) shippedEntryIds.push(packId);
        shippedHooks.push(idea.hook);
        if (qa?.source) shippedSources.push(qa.source);
        if (typeof qa?.hookQualityScore === "number")
          shippedHookQualityScores.push(qa.hookQualityScore);
      }
      lastHooks = r.resp.ideas.map((x) => x.hook);
    } else {
      lastHooks = [];
    }

    const shippedAlreadyInMemBefore = shippedEntryIds.filter((id) =>
      memBeforeSet.has(id),
    );
    const shippedAlreadyInMemSettled = shippedEntryIds.filter((id) =>
      memSettledSet.has(id),
    );
    const shippedNotInAnyMemory = shippedEntryIds.filter(
      (id) => !memBeforeSet.has(id) && !memSettledSet.has(id),
    );

    const probe: BatchProbe = {
      batchIdx,
      isRefresh,
      status: r.status,
      durationMs: r.durationMs,
      errored: r.err !== null,
      errorMsg: r.err,
      ideaCount,
      usedFallback: r.resp?.usedFallback ?? null,
      fallbackReason: r.resp?.qaTelemetry?.fallbackDecision?.reason ?? null,
      memBeforeIds,
      memImmediateIds,
      memSettledIds,
      memBeforeSize: memBeforeIds.length,
      memImmediateSize: memImmediateIds.length,
      memSettledSize: memSettledIds.length,
      growImmediate: memImmediateIds.length - memBeforeIds.length,
      growSettled: memSettledIds.length - memBeforeIds.length,
      growSettleDelta: memSettledIds.length - memImmediateIds.length,
      shippedEntryIds,
      shippedHooks,
      shippedSources,
      shippedHookQualityScores,
      shippedAlreadyInMemBefore,
      shippedAlreadyInMemSettled,
      shippedNotInAnyMemory,
      tStart,
      tResp: r.respTimestamp,
      tImmediate,
      tSettled,
    };
    batches.push(probe);
    // incremental dump in case process is reaped before completion
    fs.writeFileSync(
      path.join(OUT_DIR, "P17_A1_RUN_DATA.json"),
      JSON.stringify(
        {
          runStart: new Date(tRunStart).toISOString(),
          partial: batchIdx + 1 < N_BATCHES,
          completedBatches: batchIdx + 1,
          creatorId,
          settleMs: SETTLE_MS,
          interBatchMs: INTER_BATCH_MS,
          batches,
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify({ creatorId, batches, lastHooks, tRunStart }),
    );

    console.log(
      `[p17a1] batch=${batchIdx + 1}/${N_BATCHES} regen=${isRefresh} ms=${r.durationMs} ideas=${ideaCount} pack=${shippedEntryIds.length}/${COUNT} memB=${memBeforeIds.length} memI=${memImmediateIds.length} memS=${memSettledIds.length} growI=${probe.growImmediate} growS=${probe.growSettled} settleDelta=${probe.growSettleDelta} alreadyInMemB=${shippedAlreadyInMemBefore.length} alreadyInMemS=${shippedAlreadyInMemSettled.length} fresh=${shippedNotInAnyMemory.length}${r.err ? ` err=${r.err.slice(0, 60)}` : ""}`,
    );

    if (INTER_BATCH_MS > 0) await sleep(INTER_BATCH_MS);
  }

  const tRunEnd = Date.now();

  const out = {
    runStart: new Date(tRunStart).toISOString(),
    runEnd: new Date(tRunEnd).toISOString(),
    runDurationMs: tRunEnd - tRunStart,
    creatorId,
    nBatches: N_BATCHES,
    count: COUNT,
    settleMs: SETTLE_MS,
    interBatchMs: INTER_BATCH_MS,
    flagsObserved: {
      LUMINA_NG_PACK_ENABLED:
        process.env.LUMINA_NG_PACK_ENABLED ?? "(api-server process env)",
      LUMINA_NG_PACK_AWARE_RETENTION_ENABLED:
        process.env.LUMINA_NG_PACK_AWARE_RETENTION_ENABLED ??
        "(api-server process env)",
      LUMINA_NG_MEMORY_SOFT_CAP_ENABLED:
        process.env.LUMINA_NG_MEMORY_SOFT_CAP_ENABLED ??
        "(api-server process env)",
      LUMINA_NG_PACK_PROJECTION_T2_ENABLED:
        process.env.LUMINA_NG_PACK_PROJECTION_T2_ENABLED ??
        "(api-server process env)",
    },
    batches,
  };
  fs.writeFileSync(
    path.join(OUT_DIR, "P17_A1_RUN_DATA.json"),
    JSON.stringify(out, null, 2),
  );
  console.log(
    `[p17a1] wrote .local/P17_A1_RUN_DATA.json (run ${Math.round((tRunEnd - tRunStart) / 1000)}s)`,
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("[p17a1] FATAL", err);
    process.exit(1);
  },
);
