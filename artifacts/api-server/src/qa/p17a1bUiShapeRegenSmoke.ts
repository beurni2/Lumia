/**
 * P17-A1B — UI-SHAPE regenerate smoke (30 batches).
 *
 * Mirrors the EXACT request body the Lumina app sends from
 * `artifacts/lumina/app/(tabs)/index.tsx`:
 *
 *   initial:    { region, count: 5 }
 *   regenerate: { region, count: 5, regenerate: true, excludeHooks }
 *
 * Critically the UI does NOT send `languageStyle` on either path. The
 * server resolves it from `creator.tasteCalibrationJson` (and falls
 * back to `light_pidgin` via `applyNigerianLanguageStyleDefault` when
 * region=nigeria + null calibration). The canonical demo row Alex has
 * `region=nigeria` + `taste_calibration_json.languageStyle=light_pidgin`,
 * so this driver exercises the real UI request shape against the same
 * server path a NG-onboarded user hits.
 *
 * Demo creator bypasses the 2-batch/UTC-day quota
 * (`if (!creator.isDemo)` at routes/ideator.ts:235), so a 30-batch
 * regenerate sweep is feasible — a real user never could run this.
 *
 * QA expose-meta header is sent so we can also assert
 * routeResolvedCreatorId per batch (carrying the A1A invariant
 * forward).
 *
 * Resume support via P17_START_BATCH / P17_STOP_BATCH (10s reaper).
 *
 * Writes:
 *   .local/P17_A1B_UI_SHAPE_RUN.json
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

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

type QaPerIdea = {
  source?: string;
  nigerianPackEntryId?: string;
  hookQualityScore?: number;
};
type GenResp = {
  region: string;
  count: number;
  regenerate: boolean;
  ideas: Array<{ hook: string; whatToShow?: string }>;
  qaTelemetry?: {
    perIdea: QaPerIdea[];
    fallbackDecision?: { needFallback: boolean; reason: string };
    routeResolvedCreatorId?: string;
    slotReservationDiagnostic?: {
      packPoolPreFilter: number;
      packPoolPostMemoryFilter: number;
      packPoolPostBatchDedup: number;
      earlyReturnEmptyPack: boolean;
      softCapRescueFired: boolean;
      softCapRelaxedSeenSize: number;
    };
    w2ActivePoolSource?: string;
  };
  usedFallback?: boolean;
};

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
        status: r.status,
        durationMs: tResp - t0,
        err: `HTTP ${r.status}: ${text.slice(0, 200)}`,
      };
    }
    return {
      resp: (await r.json()) as GenResp,
      status: r.status,
      durationMs: tResp - t0,
      err: null as string | null,
    };
  } catch (e) {
    return {
      resp: null as GenResp | null,
      status: 0,
      durationMs: Date.now() - t0,
      err: String((e as Error).message ?? e),
    };
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Batch = {
  batchIdx: number;
  isInitial: boolean;
  requestBody: Record<string, unknown>;
  status: number;
  durationMs: number;
  errored: boolean;
  errorMsg: string | null;
  ideaCount: number;
  hooks: string[];
  packEntryIds: Array<string | null>;
  sources: string[];
  routeResolvedCreatorId: string | null;
  routeRowMatchesPinned: boolean;
  usedFallback: boolean | null;
  fallbackReason: string | null;
  packShippedCount: number;
  westernActivePoolSource: string | null;
  // overlap metrics
  hookOverlapWithPrev: number;
  hookOverlapWithAllPrior: number;
  packEntryOverlapWithAllPrior: number;
};

const STATE_FILE = path.join(OUT_DIR, "_p17a1b_partial.json");

async function main() {
  const startBatch = Number(process.env.P17_START_BATCH ?? "0");
  const stopBatch = Number(process.env.P17_STOP_BATCH ?? String(N_BATCHES));

  let batches: Batch[] = [];
  let lastHooks: string[] = [];
  let allPriorHooks = new Set<string>();
  let allPriorPackIds = new Set<string>();
  let tRunStart = Date.now();

  if (startBatch === 0) {
    console.log(`[p17a1b] starting fresh, canonical demo=${CANONICAL_DEMO_ID}`);
  } else if (fs.existsSync(STATE_FILE)) {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    batches = s.batches;
    lastHooks = s.lastHooks ?? [];
    allPriorHooks = new Set(s.allPriorHooks ?? []);
    allPriorPackIds = new Set(s.allPriorPackIds ?? []);
    tRunStart = s.tRunStart ?? Date.now();
    console.log(`[p17a1b] resumed priorBatches=${batches.length}`);
  } else {
    throw new Error(`startBatch=${startBatch} but no state file`);
  }

  for (let batchIdx = startBatch; batchIdx < stopBatch; batchIdx++) {
    const isInitial = batchIdx === 0;
    // EXACT UI body shape from index.tsx:
    //   initial L274-280:    { region, count: 5 }
    //   regenerate L538-543: { region, count: 5, regenerate: true, excludeHooks }
    const body: Record<string, unknown> = isInitial
      ? { region: "nigeria", count: COUNT }
      : {
          region: "nigeria",
          count: COUNT,
          regenerate: true,
          excludeHooks: lastHooks
            .map((h) => h.toLowerCase().trim())
            .filter((h) => h.length > 0)
            .slice(0, 20),
        };

    const r = await callApi(body);
    const ideas = r.resp?.ideas ?? [];
    const hooks = ideas.map((i) => i.hook);
    const perIdea = r.resp?.qaTelemetry?.perIdea ?? [];
    const packEntryIds = perIdea.map((p) => p?.nigerianPackEntryId ?? null);
    const sources = perIdea.map((p) => p?.source ?? "");
    const packShipped = packEntryIds.filter((id) => id !== null).length;

    const routeResolvedCreatorId =
      r.resp?.qaTelemetry?.routeResolvedCreatorId ?? null;
    const routeRowMatchesPinned = routeResolvedCreatorId === CANONICAL_DEMO_ID;

    // overlap metrics
    const lastSet = new Set(lastHooks.map((h) => h.toLowerCase().trim()));
    const overlapPrev = hooks.filter((h) =>
      lastSet.has(h.toLowerCase().trim()),
    ).length;
    const overlapAllPrior = hooks.filter((h) =>
      allPriorHooks.has(h.toLowerCase().trim()),
    ).length;
    const packOverlapAllPrior = packEntryIds.filter(
      (id): id is string => id !== null && allPriorPackIds.has(id),
    ).length;

    const probe: Batch = {
      batchIdx,
      isInitial,
      requestBody: body,
      status: r.status,
      durationMs: r.durationMs,
      errored: r.err !== null,
      errorMsg: r.err,
      ideaCount: ideas.length,
      hooks,
      packEntryIds,
      sources,
      routeResolvedCreatorId,
      routeRowMatchesPinned,
      usedFallback: r.resp?.usedFallback ?? null,
      fallbackReason: r.resp?.qaTelemetry?.fallbackDecision?.reason ?? null,
      packShippedCount: packShipped,
      westernActivePoolSource: r.resp?.qaTelemetry?.w2ActivePoolSource ?? null,
      hookOverlapWithPrev: overlapPrev,
      hookOverlapWithAllPrior: overlapAllPrior,
      packEntryOverlapWithAllPrior: packOverlapAllPrior,
    };
    batches.push(probe);

    for (const h of hooks) allPriorHooks.add(h.toLowerCase().trim());
    for (const id of packEntryIds)
      if (id !== null) allPriorPackIds.add(id);
    lastHooks = hooks;

    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify({
        batches,
        lastHooks,
        allPriorHooks: [...allPriorHooks],
        allPriorPackIds: [...allPriorPackIds],
        tRunStart,
      }),
    );
    fs.writeFileSync(
      path.join(OUT_DIR, "P17_A1B_UI_SHAPE_RUN.json"),
      JSON.stringify(
        {
          runStart: new Date(tRunStart).toISOString(),
          partial: batchIdx + 1 < N_BATCHES,
          completedBatches: batchIdx + 1,
          canonicalDemoId: CANONICAL_DEMO_ID,
          batches,
        },
        null,
        2,
      ),
    );

    console.log(
      `[p17a1b] b=${batchIdx + 1}/${N_BATCHES} ${isInitial ? "INIT" : "REGEN"} ms=${r.durationMs} ideas=${ideas.length} pack=${packShipped}/${COUNT} routeId=${routeRowMatchesPinned ? "OK" : routeResolvedCreatorId} overlapPrev=${overlapPrev} overlapAllPrior=${overlapAllPrior} packOverlapPrior=${packOverlapAllPrior}${r.err ? ` err=${r.err.slice(0, 60)}` : ""}`,
    );

    if (INTER_BATCH_MS > 0) await sleep(INTER_BATCH_MS);
  }

  const tEnd = Date.now();
  console.log(`[p17a1b] done ${Math.round((tEnd - tRunStart) / 1000)}s`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("[p17a1b] FATAL", err);
    process.exit(1);
  },
);
