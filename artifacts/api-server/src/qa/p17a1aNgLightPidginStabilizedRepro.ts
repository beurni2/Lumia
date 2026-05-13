/**
 * P17-A1A — NG light_pidgin STABILIZED 10-batch repro.
 *
 * Successor to `p17a1NgLightPidginPreEditFinding.ts`. Same per-batch
 * shape (memBefore / memImmediate / memSettled probe + shipped pack
 * accounting), but with three correctness fixes that came out of the
 * P17-A1 finding:
 *
 *   1. PIN canonical creator id. The pre-edit driver did its own
 *      `WHERE is_demo=TRUE LIMIT 1` lookup, but so did the route —
 *      and with no ORDER BY, two unordered LIMIT 1's against a
 *      108-row demo population are not guaranteed to agree. After
 *      `qaCleanupDemoCreators --apply` only one demo row survives
 *      (Alex, `00000000-0000-0000-0000-0000000a1e00`); we hard-pin
 *      to that id and assert both reads/writes target it.
 *
 *   2. ASSERT route/driver row identity per batch. The route now
 *      echoes its resolved creator id back on `qaTelemetry`; the
 *      driver compares it against the pinned id and bails on
 *      mismatch. This makes any future regression of
 *      `resolveCreator`'s ordering, or accidental promotion of a
 *      stale qa_sweep row back to `is_demo=TRUE`, a hard error
 *      instead of silent data corruption.
 *
 *   3. CAPTURE slot-reservation diagnostic in-band per batch.
 *      Replaces the prior plan to scrape api-server stdout for
 *      `nigerian_pack.slot_reservation_decision` log lines. The
 *      diagnostic now rides on `qaTelemetry.slotReservationDiagnostic`
 *      under the same gate (header + non-prod), so the timeline is
 *      exact instead of best-effort log alignment.
 *
 * Run:
 *   pnpm --filter @workspace/api-server exec tsx \
 *     src/qa/p17a1aNgLightPidginStabilizedRepro.ts
 *
 * Resume support (same envs as the pre-edit driver, in case the
 * 120s shell reaper interrupts):
 *   P17_START_BATCH=N P17_STOP_BATCH=M ... tsx ...
 *
 * Writes:
 *   .local/P17_A1A_RUN_DATA.json
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
const N_BATCHES = 10;
const COUNT = 5;
const SETTLE_MS = 1500;
const INTER_BATCH_MS = 250;

// P17-A1A — pinned canonical demo. After cleanup, this is the only
// `is_demo=TRUE` row remaining and matches `resolveCreator`'s
// `ORDER BY created_at ASC, id ASC` LIMIT 1 result.
const CANONICAL_DEMO_ID = "00000000-0000-0000-0000-0000000a1e00";

type SlotReservationDiagnostic = {
  packPoolPreFilter: number;
  packPoolPostMemoryFilter: number;
  packPoolPostBatchDedup: number;
  earlyReturnEmptyPack: boolean;
  softCapRescueFired: boolean;
  softCapRelaxedSeenSize: number;
};

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
    routeResolvedCreatorId?: string;
    slotReservationDiagnostic?: SlotReservationDiagnostic;
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

async function assertCanonicalDemoIsAlone(): Promise<void> {
  const demos = await db
    .select({ id: schema.creators.id, name: schema.creators.name })
    .from(schema.creators)
    .where(eq(schema.creators.isDemo, true));
  if (demos.length !== 1) {
    throw new Error(
      `expected exactly 1 is_demo=TRUE row, found ${demos.length}. ` +
        `Re-run qaCleanupDemoCreators --apply before this driver.`,
    );
  }
  if (demos[0].id !== CANONICAL_DEMO_ID) {
    throw new Error(
      `canonical demo mismatch: db says ${demos[0].id} (${demos[0].name}) ` +
        `but driver expects ${CANONICAL_DEMO_ID}`,
    );
  }
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
  routeResolvedCreatorId: string | null;
  routeRowMatchesPinned: boolean;
  slotReservationDiagnostic: SlotReservationDiagnostic | null;
  memBeforeIds: string[];
  memImmediateIds: string[];
  memSettledIds: string[];
  memBeforeSize: number;
  memImmediateSize: number;
  memSettledSize: number;
  growImmediate: number;
  growSettled: number;
  growSettleDelta: number;
  shippedEntryIds: string[];
  shippedHooks: string[];
  shippedSources: string[];
  shippedHookQualityScores: number[];
  shippedAlreadyInMemBefore: string[];
  shippedAlreadyInMemSettled: string[];
  shippedNotInAnyMemory: string[];
  tStart: number;
  tResp: number;
  tImmediate: number;
  tSettled: number;
};

const STATE_FILE = path.join(OUT_DIR, "_p17a1a_partial.json");

async function main() {
  const startBatch = Number(process.env.P17_START_BATCH ?? "0");
  const stopBatch = Number(process.env.P17_STOP_BATCH ?? String(N_BATCHES));

  const creatorId = CANONICAL_DEMO_ID;
  let batches: BatchProbe[] = [];
  let lastHooks: string[] = [];
  let tRunStart = Date.now();

  if (startBatch === 0) {
    await assertCanonicalDemoIsAlone();
    console.log(`[p17a1a] canonical demo verified id=${creatorId}`);
    await resetPackMemory(creatorId);
    console.log(`[p17a1a] reset pack/catalog memory to []`);
  } else if (fs.existsSync(STATE_FILE)) {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (s.creatorId !== creatorId)
      throw new Error(`state creatorId mismatch ${s.creatorId} vs ${creatorId}`);
    batches = s.batches;
    lastHooks = s.lastHooks ?? [];
    tRunStart = s.tRunStart ?? Date.now();
    console.log(
      `[p17a1a] resumed from ${STATE_FILE} priorBatches=${batches.length}`,
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

    const memImmediate = await readPackMemory(creatorId);
    const memImmediateIds = memImmediate.map((m) => m.entryId);
    const tImmediate = Date.now();

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

    const routeResolvedCreatorId =
      r.resp?.qaTelemetry?.routeResolvedCreatorId ?? null;
    const routeRowMatchesPinned = routeResolvedCreatorId === creatorId;
    const slotReservationDiagnostic =
      r.resp?.qaTelemetry?.slotReservationDiagnostic ?? null;

    if (r.resp && !routeRowMatchesPinned) {
      throw new Error(
        `[p17a1a] FATAL: route resolved creator ${routeResolvedCreatorId} but driver pinned ${creatorId} (batch ${batchIdx + 1})`,
      );
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
      routeResolvedCreatorId,
      routeRowMatchesPinned,
      slotReservationDiagnostic,
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

    fs.writeFileSync(
      path.join(OUT_DIR, "P17_A1A_RUN_DATA.json"),
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

    const slot = slotReservationDiagnostic;
    const slotStr = slot
      ? `pre=${slot.packPoolPreFilter} postMem=${slot.packPoolPostMemoryFilter} postBdd=${slot.packPoolPostBatchDedup} early=${slot.earlyReturnEmptyPack} softCap=${slot.softCapRescueFired}/${slot.softCapRelaxedSeenSize}`
      : "(none)";
    console.log(
      `[p17a1a] batch=${batchIdx + 1}/${N_BATCHES} regen=${isRefresh} ms=${r.durationMs} ideas=${ideaCount} pack=${shippedEntryIds.length}/${COUNT} memB=${memBeforeIds.length} memI=${memImmediateIds.length} memS=${memSettledIds.length} growI=${probe.growImmediate} growS=${probe.growSettled} settleDelta=${probe.growSettleDelta} alreadyInMemB=${shippedAlreadyInMemBefore.length} alreadyInMemS=${shippedAlreadyInMemSettled.length} fresh=${shippedNotInAnyMemory.length} routeId=${routeResolvedCreatorId === creatorId ? "OK" : routeResolvedCreatorId} slot=${slotStr}${r.err ? ` err=${r.err.slice(0, 60)}` : ""}`,
    );

    if (INTER_BATCH_MS > 0) await sleep(INTER_BATCH_MS);
  }

  const tRunEnd = Date.now();
  const out = {
    runStart: new Date(tRunStart).toISOString(),
    runEnd: new Date(tRunEnd).toISOString(),
    runDurationMs: tRunEnd - tRunStart,
    creatorId,
    canonicalDemoId: CANONICAL_DEMO_ID,
    nBatches: N_BATCHES,
    count: COUNT,
    settleMs: SETTLE_MS,
    interBatchMs: INTER_BATCH_MS,
    batches,
  };
  fs.writeFileSync(
    path.join(OUT_DIR, "P17_A1A_RUN_DATA.json"),
    JSON.stringify(out, null, 2),
  );
  console.log(
    `[p17a1a] wrote .local/P17_A1A_RUN_DATA.json (run ${Math.round((tRunEnd - tRunStart) / 1000)}s)`,
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("[p17a1a] FATAL", err);
    process.exit(1);
  },
);
