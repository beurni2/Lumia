/**
 * P13-T2 — TOPOLOGY + SLEEP CLUSTER + SELECTIVE TASTE LIVE PROBE.
 *
 * Audit-only. Drives the REAL `POST /api/ideator/generate` route
 * (direct port to bypass the proxy 20s idle timeout) and verifies:
 *   • everyday→food projection edge ships at least 1 card on
 *     ng_lp (PART A topology correction)
 *   • SLEEP_V1 entries actually reach the live route (PART B import)
 *   • everyday→sleep projection edge ships meaningfully more than
 *     P12-T2 baseline (PART B topology gain)
 *   • the 5 P13-T2 rewritten FOOD_V2 hooks ship + score telemetry
 *     uplift vs P12 baseline (PART C selective taste pass)
 *   • zero pack/SLEEP_V1 leak into ng_clean and western controls
 *   • no error/underfill regression vs P12 baseline
 *
 * Sizing (single-pass, foreground-friendly):
 *   ng_lp:    5 creators × 3 batches × 6 ideas = 90 cards
 *   ng_clean: 2 creators × 2 batches × 6 ideas = 24 cards
 *   western:  2 creators × 2 batches × 6 ideas = 24 cards
 *
 * Run:
 *   LUMINA_NG_PACK_ENABLED=true \
 *   LUMINA_NG_PACK_AWARE_RETENTION_ENABLED=true \
 *   LUMINA_NG_MEMORY_SOFT_CAP_ENABLED=true \
 *   LUMINA_NG_PACK_PROJECTION_T2_ENABLED=true \
 *   pnpm --filter @workspace/api-server exec tsx src/qa/p13T2TopologyTasteLiveProbe.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const QA_RUNS_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  ".local",
  "qa-runs",
);
fs.mkdirSync(QA_RUNS_DIR, { recursive: true });

import {
  NIGERIAN_HOOK_PACK,
  type NigerianPackEntry,
} from "../lib/nigerianHookPack.js";
import { FOOD_V2_NIGERIAN_PROMOTION_CANDIDATES } from "../lib/nigerianHookPackFoodV2.js";
import { SLEEP_V1_NIGERIAN_PROMOTION_CANDIDATES } from "../lib/nigerianHookPackSleepV1.js";
import { CORE_DOMAIN_ANCHORS } from "../lib/coreDomainAnchorCatalog.js";
import { db, schema } from "../db/client.js";

const API_URL =
  process.env.P13_LIVE_API_URL ?? "http://localhost:8080/api/ideator/generate";
const QA_HEADER = { name: "x-lumina-qa-expose-meta", value: "1" } as const;
const PER_BATCH_TIMEOUT_MS = 75_000;

// ---------- pack ID derivation (mirrors `nigerianPackAuthor.ts`) ------
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}
const packEntryIdFor = (hook: string, anchor: string) =>
  `ng_${djb2(`${hook}|${anchor}`).toString(16)}`;

const PACK_BY_ID = new Map<string, NigerianPackEntry>();
for (const e of NIGERIAN_HOOK_PACK)
  PACK_BY_ID.set(packEntryIdFor(e.hook, e.anchor), e);

const FOOD_V2_IDS = new Set<string>(
  FOOD_V2_NIGERIAN_PROMOTION_CANDIDATES.map((e) =>
    packEntryIdFor(e.hook, e.anchor),
  ),
);
const SLEEP_V1_IDS = new Set<string>(
  SLEEP_V1_NIGERIAN_PROMOTION_CANDIDATES.map((e) =>
    packEntryIdFor(e.hook, e.anchor),
  ),
);

// 5 P13-T2 rewritten FOOD_V2 hooks (verbatim new strings)
const P13_REWRITTEN_HOOKS = new Set<string>([
  "fridge just make small sound, i don confess before anybody ask",
  "fridge get leftover, the house don enter court session",
  "fridge open na for water, but my hand don carry evidence",
  "plate don expose me, small taste no suppose reach corner",
  "pan don smell finish, but food no carry evidence",
]);
const P13_REWRITTEN_IDS = new Set<string>(
  FOOD_V2_NIGERIAN_PROMOTION_CANDIDATES.filter((e) =>
    P13_REWRITTEN_HOOKS.has(e.hook),
  ).map((e) => packEntryIdFor(e.hook, e.anchor)),
);

// ---------- canonical anchor → domain set ------------------------------
const ANCHOR_DOMAINS = new Map<string, Set<string>>();
for (const coreId of Object.keys(CORE_DOMAIN_ANCHORS)) {
  const rows = (
    CORE_DOMAIN_ANCHORS as Record<
      string,
      ReadonlyArray<{ domain: string; anchors: ReadonlyArray<string> }>
    >
  )[coreId];
  for (const row of rows)
    for (const a of row.anchors) {
      const k = a.toLowerCase();
      if (!ANCHOR_DOMAINS.has(k)) ANCHOR_DOMAINS.set(k, new Set());
      ANCHOR_DOMAINS.get(k)!.add(row.domain);
    }
}
const compatible = (a: string | null, dom: string) =>
  a === null
    ? false
    : (ANCHOR_DOMAINS.get(a.toLowerCase())?.has(dom) ?? false);

type T2Edge =
  | "everyday→mornings"
  | "everyday→sleep"
  | "everyday→food"
  | "home→food"
  | "non-widened"
  | "non-pack";
function classifyT2Edge(
  packEntryId: string | null,
  ideaAnchor: string | null,
): T2Edge {
  if (packEntryId === null) return "non-pack";
  const packEntry = PACK_BY_ID.get(packEntryId);
  if (!packEntry) return "non-pack";
  const anchor = (ideaAnchor ?? packEntry.anchor).toLowerCase();
  if (packEntry.domain === "home" && compatible(anchor, "food")) {
    return "home→food";
  }
  if (packEntry.domain === "everyday" && compatible(anchor, "food")) {
    return "everyday→food";
  }
  if (packEntry.domain === "everyday" && compatible(anchor, "sleep")) {
    return "everyday→sleep";
  }
  if (packEntry.domain === "everyday" && compatible(anchor, "mornings")) {
    return "everyday→mornings";
  }
  return "non-widened";
}

type QaPerIdea = {
  source?: string;
  nigerianPackEntryId?: string;
  hookQualityScore?: number;
  anchor?: string;
};
type GenResp = {
  region: string;
  count: number;
  regenerate: boolean;
  ideas: Array<{ hook: string; whatToShow: string; caption: string; anchor?: string }>;
  qaTelemetry?: {
    perIdea: QaPerIdea[];
    fallbackDecision?: { needFallback: boolean; reason: string };
  };
  usedFallback?: boolean;
  counts?: { localKept: number; fallbackKept: number };
};

type IdeaRec = {
  cohort: string;
  creatorIdx: number;
  batchIdx: number;
  ideaIdx: number;
  slot0: boolean;
  hook: string;
  whatToShow: string;
  caption: string;
  anchor: string | null;
  source: string | null;
  nigerianPackEntryId: string | null;
  isFoodV2: boolean;
  isSleepV1: boolean;
  isP13Rewritten: boolean;
  isPackEntry: boolean;
  packEntrySourceDomain: string | null;
  packEntryPidginLevel: string | null;
  t2Edge: T2Edge;
  hookQualityScore: number | null;
};
type BatchRec = {
  cohort: string;
  creatorIdx: number;
  batchIdx: number;
  isRefresh: boolean;
  status: number;
  durationMs: number;
  errored: boolean;
  errorMsg: string | null;
  ideaCount: number;
  underfill: boolean;
  usedFallback: boolean | null;
  fallbackReason: string | null;
};

async function callApi(args: {
  region: string;
  languageStyle: string | null;
  count: number;
  regenerate: boolean;
  excludeHooks: string[];
}) {
  const body: Record<string, unknown> = {
    region: args.region,
    count: args.count,
    regenerate: args.regenerate,
  };
  if (args.languageStyle !== null) body.languageStyle = args.languageStyle;
  if (args.excludeHooks.length > 0)
    body.excludeHooks = args.excludeHooks.slice(0, 20);
  const t0 = Date.now();
  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [QA_HEADER.name]: QA_HEADER.value,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PER_BATCH_TIMEOUT_MS),
    });
    const durationMs = Date.now() - t0;
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return {
        resp: null as GenResp | null,
        status: r.status,
        durationMs,
        err: `HTTP ${r.status}: ${text.slice(0, 200)}`,
      };
    }
    const j = (await r.json()) as GenResp;
    return { resp: j, status: r.status, durationMs, err: null as string | null };
  } catch (e) {
    return {
      resp: null as GenResp | null,
      status: 0,
      durationMs: Date.now() - t0,
      err: String((e as Error).message ?? e),
    };
  }
}

async function resetDemoCreatorMemory(): Promise<void> {
  const demo = (
    await db
      .select()
      .from(schema.creators)
      .where(eq(schema.creators.isDemo, true))
      .limit(1)
  )[0];
  if (!demo) throw new Error("no demo creator row found — cannot reset memory");
  await db
    .update(schema.creators)
    .set({
      nigerianPackSeenEntryIdsJson: [],
      catalogTemplateSeenIdsJson: [],
      nigerianCleanCoreSlot0SeenIdsJson: [],
      viralPatternMemoryJson: null,
      lastIdeaBatchJson: null,
      lastIdeaBatchDate: null,
    })
    .where(eq(schema.creators.id, demo.id));
}

type Cohort = {
  label: string;
  region: string;
  languageStyle: string | null;
  creators: number;
  batchesPerCreator: number;
  ideasPerBatch: number;
};
const COHORTS: readonly Cohort[] = [
  { label: "ng_light_pidgin", region: "nigeria", languageStyle: "light_pidgin", creators: 5, batchesPerCreator: 3, ideasPerBatch: 6 },
  { label: "ng_clean",        region: "nigeria", languageStyle: "clean",        creators: 2, batchesPerCreator: 2, ideasPerBatch: 6 },
  { label: "western",         region: "western", languageStyle: null,           creators: 2, batchesPerCreator: 2, ideasPerBatch: 6 },
];

function classify(
  cohortLabel: string,
  creatorIdx: number,
  batchIdx: number,
  ideaIdx: number,
  idea: GenResp["ideas"][number],
  qa: QaPerIdea | undefined,
): IdeaRec {
  const packId = qa?.nigerianPackEntryId ?? null;
  const packEntry = packId !== null ? PACK_BY_ID.get(packId) : undefined;
  const anchor = qa?.anchor ?? idea.anchor ?? null;
  return {
    cohort: cohortLabel,
    creatorIdx,
    batchIdx,
    ideaIdx,
    slot0: ideaIdx === 0,
    hook: idea.hook,
    whatToShow: idea.whatToShow,
    caption: idea.caption,
    anchor,
    source: qa?.source ?? null,
    nigerianPackEntryId: packId,
    isFoodV2: packId !== null && FOOD_V2_IDS.has(packId),
    isSleepV1: packId !== null && SLEEP_V1_IDS.has(packId),
    isP13Rewritten: packId !== null && P13_REWRITTEN_IDS.has(packId),
    isPackEntry: packEntry !== undefined,
    packEntrySourceDomain: packEntry?.domain ?? null,
    packEntryPidginLevel: packEntry?.pidginLevel ?? null,
    t2Edge: classifyT2Edge(packId, anchor),
    hookQualityScore: qa?.hookQualityScore ?? null,
  };
}

async function runCohort(c: Cohort): Promise<{ ideas: IdeaRec[]; batches: BatchRec[] }> {
  const partialFile = path.join(QA_RUNS_DIR, `_p13_partial_${c.label}.json`);
  let ideas: IdeaRec[] = [];
  let batches: BatchRec[] = [];
  if (fs.existsSync(partialFile)) {
    try {
      const prior = JSON.parse(fs.readFileSync(partialFile, "utf8")) as { ideas: IdeaRec[]; batches: BatchRec[] };
      ideas = prior.ideas; batches = prior.batches;
      console.log(`[p13] resumed cohort=${c.label} priorIdeas=${ideas.length} priorBatches=${batches.length}`);
    } catch { /* start fresh */ }
  }
  const offset = Number(process.env.P13_CREATOR_OFFSET ?? "0");
  const limit = Number(process.env.P13_CREATOR_LIMIT ?? String(c.creators));
  const start = Math.max(0, offset);
  const stop = Math.min(c.creators, offset + limit);
  // idempotent slice overwrite
  const overwrite = new Set<number>();
  for (let i = start; i < stop; i++) overwrite.add(i);
  ideas = ideas.filter((x) => !overwrite.has(x.creatorIdx));
  batches = batches.filter((b) => !overwrite.has(b.creatorIdx));
  for (let creatorIdx = start; creatorIdx < stop; creatorIdx++) {
    let resetErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await resetDemoCreatorMemory(); resetErr = null; break; }
      catch (e) { resetErr = e; await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); }
    }
    if (resetErr) console.log(`[p13] reset failed cre=${creatorIdx} ${String((resetErr as Error).message).slice(0, 100)}`);
    let lastHooks: string[] = [];
    for (let batchIdx = 0; batchIdx < c.batchesPerCreator; batchIdx++) {
      const isRefresh = batchIdx > 0;
      const r = await callApi({
        region: c.region,
        languageStyle: c.languageStyle,
        count: c.ideasPerBatch,
        regenerate: isRefresh,
        excludeHooks: lastHooks,
      });
      const ideaCount = r.resp?.ideas.length ?? 0;
      batches.push({
        cohort: c.label, creatorIdx, batchIdx, isRefresh,
        status: r.status, durationMs: r.durationMs,
        errored: r.err !== null, errorMsg: r.err,
        ideaCount,
        underfill: r.status === 200 && ideaCount < c.ideasPerBatch,
        usedFallback: r.resp?.usedFallback ?? null,
        fallbackReason: r.resp?.qaTelemetry?.fallbackDecision?.reason ?? null,
      });
      if (r.resp) {
        for (let i = 0; i < r.resp.ideas.length; i++) {
          ideas.push(classify(c.label, creatorIdx, batchIdx, i, r.resp.ideas[i], r.resp.qaTelemetry?.perIdea?.[i]));
        }
        lastHooks = r.resp.ideas.map((x) => x.hook);
      } else {
        lastHooks = [];
      }
      console.log(`[p13] ${c.label} cre=${creatorIdx + 1}/${c.creators} batch=${batchIdx + 1}/${c.batchesPerCreator} ms=${r.durationMs} status=${r.status} ideas=${ideaCount} fb=${r.resp?.usedFallback ?? "?"} fbReason=${r.resp?.qaTelemetry?.fallbackDecision?.reason ?? "?"}${r.err ? ` err=${r.err.slice(0, 80)}` : ""}`);
      try { fs.writeFileSync(partialFile, JSON.stringify({ ideas, batches }, null, 2)); } catch { /* ignore */ }
    }
  }
  return { ideas, batches };
}

const tally = <T,>(arr: T[], key: (x: T) => string): Map<string, number> => {
  const m = new Map<string, number>();
  for (const x of arr) {
    const k = key(x);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
};
const topN = (m: Map<string, number>, n: number) =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const distinct = <T,>(arr: T[], key: (x: T) => string): number =>
  new Set(arr.map(key)).size;
const avg = (nums: number[]) =>
  nums.length === 0
    ? null
    : Math.round((nums.reduce((s, x) => s + x, 0) / nums.length) * 100) / 100;

function partialPath(label: string): string {
  return path.join(QA_RUNS_DIR, `_p13_partial_${label}.json`);
}

async function main(): Promise<void> {
  const mode = process.env.P13_MODE ?? "run";
  const cohortFilter = process.env.P13_COHORT ?? "all";
  console.log(`[p13] mode=${mode} cohort=${cohortFilter} pack=${NIGERIAN_HOOK_PACK.length} foodV2=${FOOD_V2_IDS.size} sleepV1=${SLEEP_V1_IDS.size}`);
  console.log(`[p13] flags: NG=${process.env.LUMINA_NG_PACK_ENABLED} T2=${process.env.LUMINA_NG_PACK_PROJECTION_T2_ENABLED} PAR=${process.env.LUMINA_NG_PACK_AWARE_RETENTION_ENABLED} SOFT=${process.env.LUMINA_NG_MEMORY_SOFT_CAP_ENABLED}`);

  if (mode === "run") {
    const selected = cohortFilter === "all"
      ? COHORTS
      : COHORTS.filter((c) => c.label === cohortFilter);
    if (selected.length === 0) throw new Error(`unknown cohort: ${cohortFilter}`);
    for (const c of selected) {
      console.log(`[p13] === cohort ${c.label} ===`);
      const r = await runCohort(c);
      fs.writeFileSync(partialPath(c.label), JSON.stringify(r, null, 2));
      console.log(`[p13] === cohort ${c.label} done ideas=${r.ideas.length} batches=${r.batches.length} → ${partialPath(c.label)} ===`);
    }
    return;
  }
  if (mode !== "aggregate") throw new Error(`unknown P13_MODE: ${mode}`);

  // aggregate mode: load all partials and write final outputs
  const results = new Map<string, { ideas: IdeaRec[]; batches: BatchRec[] }>();
  const missing: string[] = [];
  for (const c of COHORTS) {
    const p = partialPath(c.label);
    if (!fs.existsSync(p)) {
      missing.push(c.label);
      results.set(c.label, { ideas: [], batches: [] });
    } else {
      results.set(c.label, JSON.parse(fs.readFileSync(p, "utf8")));
    }
  }
  if (missing.length > 0) {
    console.error(`[p13] FATAL: missing partials for cohort(s): ${missing.join(", ")}`);
    process.exit(3);
  }

  const ngLp = results.get("ng_light_pidgin")!;
  const ngClean = results.get("ng_clean")!;
  const western = results.get("western")!;

  const lpPack = ngLp.ideas.filter((i) => i.isPackEntry);
  const lpFoodV2 = ngLp.ideas.filter((i) => i.isFoodV2);
  const lpSleepV1 = ngLp.ideas.filter((i) => i.isSleepV1);
  const lpP13 = ngLp.ideas.filter((i) => i.isP13Rewritten);
  const lpEdgeFood = ngLp.ideas.filter((i) => i.t2Edge === "everyday→food");
  const lpEdgeSleep = ngLp.ideas.filter((i) => i.t2Edge === "everyday→sleep");
  const lpEdgeHomeFood = ngLp.ideas.filter((i) => i.t2Edge === "home→food");
  const lpEdgeMornings = ngLp.ideas.filter((i) => i.t2Edge === "everyday→mornings");

  const aggregate = {
    ng_light_pidgin: {
      totalIdeas: ngLp.ideas.length,
      packIdeas: lpPack.length,
      packShare: ngLp.ideas.length === 0 ? 0 : Math.round((lpPack.length / ngLp.ideas.length) * 1000) / 1000,
      distinctHooks: distinct(ngLp.ideas, (i) => i.hook.toLowerCase()),
      distinctPackIds: distinct(lpPack, (i) => i.nigerianPackEntryId ?? ""),
      sleepV1Cards: lpSleepV1.length,
      sleepV1DistinctIds: distinct(lpSleepV1, (i) => i.nigerianPackEntryId ?? ""),
      sleepV1ImportedTotal: SLEEP_V1_IDS.size,
      foodV2Cards: lpFoodV2.length,
      p13RewrittenCards: lpP13.length,
      p13RewrittenDistinctHooks: distinct(lpP13, (i) => i.hook.toLowerCase()),
      p13AvgHookQualityScore: avg(lpP13.map((i) => i.hookQualityScore ?? 0).filter((x) => x > 0)),
      foodV2AvgHookQualityScore: avg(lpFoodV2.map((i) => i.hookQualityScore ?? 0).filter((x) => x > 0)),
    },
    edges: {
      "everyday→food": {
        shipped: lpEdgeFood.length,
        distinctPackIds: distinct(lpEdgeFood, (i) => i.nigerianPackEntryId ?? ""),
        distinctHooks: distinct(lpEdgeFood, (i) => i.hook.toLowerCase()),
        topPackId: topN(tally(lpEdgeFood, (i) => i.nigerianPackEntryId ?? ""), 1),
      },
      "everyday→sleep": {
        shipped: lpEdgeSleep.length,
        distinctPackIds: distinct(lpEdgeSleep, (i) => i.nigerianPackEntryId ?? ""),
        distinctHooks: distinct(lpEdgeSleep, (i) => i.hook.toLowerCase()),
        sleepV1ContributionCards: lpEdgeSleep.filter((i) => i.isSleepV1).length,
        topPackId: topN(tally(lpEdgeSleep, (i) => i.nigerianPackEntryId ?? ""), 1),
      },
      "home→food": {
        shipped: lpEdgeHomeFood.length,
        distinctPackIds: distinct(lpEdgeHomeFood, (i) => i.nigerianPackEntryId ?? ""),
        distinctHooks: distinct(lpEdgeHomeFood, (i) => i.hook.toLowerCase()),
      },
      "everyday→mornings": {
        shipped: lpEdgeMornings.length,
        distinctPackIds: distinct(lpEdgeMornings, (i) => i.nigerianPackEntryId ?? ""),
        distinctHooks: distinct(lpEdgeMornings, (i) => i.hook.toLowerCase()),
      },
    },
    leakGuards: {
      ng_clean: {
        totalIdeas: ngClean.ideas.length,
        packLeak: ngClean.ideas.filter((i) => i.isPackEntry).length,
        sleepV1Leak: ngClean.ideas.filter((i) => i.isSleepV1).length,
        lightPidginLeakBySource: ngClean.ideas.filter((i) => i.packEntryPidginLevel === "light_pidgin").length,
        errors: ngClean.batches.filter((b) => b.errored).length,
        underfills: ngClean.batches.filter((b) => b.underfill).length,
      },
      western: {
        totalIdeas: western.ideas.length,
        packLeak: western.ideas.filter((i) => i.isPackEntry).length,
        sleepV1Leak: western.ideas.filter((i) => i.isSleepV1).length,
        errors: western.batches.filter((b) => b.errored).length,
        underfills: western.batches.filter((b) => b.underfill).length,
      },
    },
    runtime: {
      totalRunMs: [...results.values()].reduce((s, r) => s + r.batches.reduce((sb, b) => sb + b.durationMs, 0), 0),
      ngLpAvgDurationMs: avg(ngLp.batches.map((b) => b.durationMs)),
      ngLpUnderfills: ngLp.batches.filter((b) => b.underfill).length,
      ngLpErrors: ngLp.batches.filter((b) => b.errored).length,
      ngLpFallbackReasons: Object.fromEntries(tally(ngLp.batches.filter((b) => b.fallbackReason !== null), (b) => b.fallbackReason!)),
    },
  };

  const audit = {
    meta: {
      generatedAt: new Date().toISOString(),
      apiUrl: API_URL,
      flags: {
        LUMINA_NG_PACK_ENABLED: process.env.LUMINA_NG_PACK_ENABLED ?? null,
        LUMINA_NG_PACK_AWARE_RETENTION_ENABLED: process.env.LUMINA_NG_PACK_AWARE_RETENTION_ENABLED ?? null,
        LUMINA_NG_MEMORY_SOFT_CAP_ENABLED: process.env.LUMINA_NG_MEMORY_SOFT_CAP_ENABLED ?? null,
        LUMINA_NG_PACK_PROJECTION_T2_ENABLED: process.env.LUMINA_NG_PACK_PROJECTION_T2_ENABLED ?? null,
      },
      packLength: NIGERIAN_HOOK_PACK.length,
      foodV2IdCount: FOOD_V2_IDS.size,
      sleepV1IdCount: SLEEP_V1_IDS.size,
      p13RewrittenIdCount: P13_REWRITTEN_IDS.size,
    },
    aggregate,
    perCohortIdeas: Object.fromEntries([...results.entries()].map(([k, r]) => [k, r.ideas])),
    perCohortBatches: Object.fromEntries([...results.entries()].map(([k, r]) => [k, r.batches])),
  };

  fs.writeFileSync(path.join(QA_RUNS_DIR, "p13_t2_topology_taste_live.json"), JSON.stringify(audit, null, 2));
  fs.writeFileSync(path.join(QA_RUNS_DIR, "p13_t2_topology_taste_live_summary.json"), JSON.stringify({ meta: audit.meta, aggregate }, null, 2));
  console.log(`[p13] wrote audit JSONs (totalRunMs=${aggregate.runtime.totalRunMs})`);
  console.log(`[p13] ng_lp pack=${aggregate.ng_light_pidgin.packIdeas}/${aggregate.ng_light_pidgin.totalIdeas} (${(aggregate.ng_light_pidgin.packShare * 100).toFixed(1)}%) sleepV1Cards=${aggregate.ng_light_pidgin.sleepV1Cards} sleepV1Distinct=${aggregate.ng_light_pidgin.sleepV1DistinctIds}/${SLEEP_V1_IDS.size}`);
  console.log(`[p13] edges: e→food=${aggregate.edges["everyday→food"].shipped} e→sleep=${aggregate.edges["everyday→sleep"].shipped} h→food=${aggregate.edges["home→food"].shipped} e→morn=${aggregate.edges["everyday→mornings"].shipped}`);
  console.log(`[p13] p13-rewritten cards=${aggregate.ng_light_pidgin.p13RewrittenCards} avgScore=${aggregate.ng_light_pidgin.p13AvgHookQualityScore}`);
  console.log(`[p13] leak: ng_clean=${aggregate.leakGuards.ng_clean.packLeak} western=${aggregate.leakGuards.western.packLeak}`);
}

main()
  .catch((e) => {
    console.error("[p13] FATAL", e);
    process.exit(1);
  })
  .finally(() => {
    void db.$client.end();
  });
