/**
 * P11 — T2 LIVE-ROUTE RE-AUDIT.
 *
 * Audit-only. Drives the REAL `POST /api/ideator/generate` route
 * (proxied at http://localhost:80) and measures whether the P10
 * FOOD_V2 corpus expansion materially improved the live home→food
 * widened-edge surface.
 *
 * KNOWN CONSTRAINT (live route):
 *   `resolveCreator` returns a SINGLE shared demo creator for
 *   unauthenticated requests (LIMIT 1 on `is_demo=true`). To simulate
 *   N "logical creators", this driver clears the per-creator memory
 *   JSONB columns BETWEEN logical-creator groups (DB writes only —
 *   no schema/runtime/source change). Within a logical creator,
 *   batches run sequentially with `excludeHooks` chained (real
 *   refresh path). Cross-creator Jaccard overlap is NOT computed
 *   (would require true distinct creators) — reported as N/A in §9.
 *
 * Run:
 *   LUMINA_NG_PACK_ENABLED=true \
 *   LUMINA_NG_PACK_AWARE_RETENTION_ENABLED=true \
 *   LUMINA_NG_MEMORY_SOFT_CAP_ENABLED=true \
 *   LUMINA_NG_PACK_PROJECTION_T2_ENABLED=true \
 *   pnpm exec tsx .local/scripts/p11T2LiveRouteReAudit.mts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";

// `pnpm --filter @workspace/api-server exec tsx` runs with cwd set to
// the api-server package dir, so relative paths like ".local/qa-runs/"
// resolve to artifacts/api-server/.local/... — NOT the project root.
// Anchor every IO path on a constant derived from this module's URL
// (ESM scope has no __dirname) so all chunked invocations + the
// final aggregate read/write the same files at the project root.
// This file lives at .../artifacts/api-server/src/qa  → root is 4
// levels up.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const QA_RUNS_DIR = path.resolve(__dirname, "..", "..", "..", "..", ".local", "qa-runs");
fs.mkdirSync(QA_RUNS_DIR, { recursive: true });

import {
  NIGERIAN_HOOK_PACK,
  type NigerianPackEntry,
} from "../lib/nigerianHookPack";
import { FOOD_V2_NIGERIAN_PROMOTION_CANDIDATES } from "../lib/nigerianHookPackFoodV2";
import { CORE_DOMAIN_ANCHORS } from "../lib/coreDomainAnchorCatalog";
import { db, schema } from "../db/client";

// Direct hit to the api-server localPort (`8080` from
// `.replit-artifact/artifact.toml`). The shared mTLS proxy at
// :80 has a hard ~20s idle timeout that aborts heavy generate
// calls (some warm cohort batches take 25-30s end-to-end) — those
// aborts hose this driver's fetch loop. Direct port bypasses the
// proxy entirely and matches what the workflow actually serves.
const API_URL = process.env.P11_LIVE_API_URL ?? "http://localhost:8080/api/ideator/generate";
const QA_HEADER = { name: "x-lumina-qa-expose-meta", value: "1" } as const;
const PER_BATCH_TIMEOUT_MS = 75_000;

// ---------- pack ID derivation (mirrors `nigerianPackAuthor.ts`) -------
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}
const packEntryIdFor = (hook: string, anchor: string) => `ng_${djb2(`${hook}|${anchor}`).toString(16)}`;

const PACK_BY_ID = new Map<string, NigerianPackEntry>();
for (const e of NIGERIAN_HOOK_PACK) PACK_BY_ID.set(packEntryIdFor(e.hook, e.anchor), e);

const FOOD_V2_IDS = new Set<string>(
  FOOD_V2_NIGERIAN_PROMOTION_CANDIDATES.map((e) => packEntryIdFor(e.hook, e.anchor)),
);

// ---------- canonical anchor → domain set --------------------------
const ANCHOR_DOMAINS = new Map<string, Set<string>>();
for (const coreId of Object.keys(CORE_DOMAIN_ANCHORS)) {
  const rows = (CORE_DOMAIN_ANCHORS as Record<string, ReadonlyArray<{ domain: string; anchors: ReadonlyArray<string> }>>)[coreId];
  for (const row of rows) for (const a of row.anchors) {
    const k = a.toLowerCase();
    if (!ANCHOR_DOMAINS.has(k)) ANCHOR_DOMAINS.set(k, new Set());
    ANCHOR_DOMAINS.get(k)!.add(row.domain);
  }
}
const anchorIsFoodCompatible = (a: string) => ANCHOR_DOMAINS.get(a.toLowerCase())?.has("food") ?? false;
const anchorIsMorningsCompatible = (a: string) => ANCHOR_DOMAINS.get(a.toLowerCase())?.has("mornings") ?? false;
const anchorIsSleepCompatible = (a: string) => ANCHOR_DOMAINS.get(a.toLowerCase())?.has("sleep") ?? false;

// ---------- T2 edge classification -------------------------------------
type T2Edge = "everyday→mornings" | "everyday→sleep" | "home→food" | "non-widened" | "non-pack";
function classifyT2Edge(packEntryId: string | null, ideaAnchor: string | null): T2Edge {
  if (packEntryId === null) return "non-pack";
  const packEntry = PACK_BY_ID.get(packEntryId);
  if (!packEntry) return "non-pack";
  const anchor = (ideaAnchor ?? packEntry.anchor).toLowerCase();
  if (packEntry.domain === "home" && anchorIsFoodCompatible(anchor) && !ANCHOR_DOMAINS.get(anchor)?.has("home")) {
    return "home→food";
  }
  if (packEntry.domain === "home" && anchorIsFoodCompatible(anchor)) {
    return "home→food";
  }
  if (packEntry.domain === "everyday" && anchorIsMorningsCompatible(anchor) && !ANCHOR_DOMAINS.get(anchor)?.has("everyday")) {
    return "everyday→mornings";
  }
  if (packEntry.domain === "everyday" && anchorIsSleepCompatible(anchor) && !ANCHOR_DOMAINS.get(anchor)?.has("everyday")) {
    return "everyday→sleep";
  }
  if (packEntry.domain === "everyday" && anchorIsMorningsCompatible(anchor)) return "everyday→mornings";
  if (packEntry.domain === "everyday" && anchorIsSleepCompatible(anchor)) return "everyday→sleep";
  return "non-widened";
}

// ---------- response shape -----------------------------------------
type QaPerIdea = {
  source?: string;
  nigerianPackEntryId?: string;
  hookQualityScore?: number;
  anchor?: string;
  premiseCoreId?: string;
  voiceClusterId?: string;
};
type GenResp = {
  region: string;
  count: number;
  regenerate: boolean;
  ideas: Array<{ hook: string; whatToShow: string; howToFilm: string; caption: string; anchor?: string }>;
  qaTelemetry?: {
    perIdea: QaPerIdea[];
    fallbackDecision?: { needFallback: boolean; reason: string };
    w2ActivePoolSource?: string;
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
  localKept: number | null;
  fallbackKept: number | null;
};

// ---------- HTTP -------------------------------------------------------
async function callApi(args: { region: string; languageStyle: string | null; count: number; regenerate: boolean; excludeHooks: string[] }): Promise<{ resp: GenResp | null; status: number; durationMs: number; err: string | null }> {
  const body: Record<string, unknown> = {
    region: args.region,
    count: args.count,
    regenerate: args.regenerate,
  };
  if (args.languageStyle !== null) body.languageStyle = args.languageStyle;
  if (args.excludeHooks.length > 0) body.excludeHooks = args.excludeHooks.slice(0, 20);
  const t0 = Date.now();
  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", [QA_HEADER.name]: QA_HEADER.value },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PER_BATCH_TIMEOUT_MS),
    });
    const durationMs = Date.now() - t0;
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return { resp: null, status: r.status, durationMs, err: `HTTP ${r.status}: ${text.slice(0, 200)}` };
    }
    const j = (await r.json()) as GenResp;
    return { resp: j, status: r.status, durationMs, err: null };
  } catch (e) {
    return { resp: null, status: 0, durationMs: Date.now() - t0, err: String((e as Error).message ?? e) };
  }
}

// ---------- per-creator memory reset (DB-only; no schema change) -------
async function resetDemoCreatorMemory(): Promise<void> {
  const demo = (
    await db.select().from(schema.creators).where(eq(schema.creators.isDemo, true)).limit(1)
  )[0];
  if (!demo) throw new Error("[p11] no demo creator row found — cannot reset memory");
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

// ---------- cohort runner ----------------------------------------------
type Cohort = {
  label: string;
  region: string;
  languageStyle: string | null;
  creators: number;
  batchesPerCreator: number;
  ideasPerBatch: number;
};
// SIZING NOTE (BI 2026-05-11): two earlier full-spec background runs
// (10×5×6 ng_lp + 5×2×6 each control) died mid-run from process
// termination correlated with the api-server workflow auto-restarting
// in dev mode (kills keep-alive sockets) and the bash tool's parent
// shell sending SIGTERM to detached children. Reduced + chunked: each
// cohort runs in its own foreground invocation that fits the 110s
// per-call bash budget. Still surfaces FOOD_V2 / widened-edge signal
// at the same statistical resolution per-batch. Reported as a known
// reduction + constraint in §2 + §18.
//
// Env contract:
//   P11_COHORT=ng_light_pidgin|ng_clean|western|all
//     Runs that single cohort and writes its partial JSON; default `all`.
//   P11_MODE=run|aggregate
//     `run` (default): runs the selected cohort(s), persists
//       `_p11_partial_<cohort>.json`. `aggregate`: reads partials of
//       all 3 cohorts and writes the final JSON + summary + .md report.
const COHORTS: readonly Cohort[] = [
  { label: "ng_light_pidgin", region: "nigeria", languageStyle: "light_pidgin", creators: 3, batchesPerCreator: 2, ideasPerBatch: 6 },
  { label: "ng_clean",         region: "nigeria", languageStyle: "clean",        creators: 2, batchesPerCreator: 2, ideasPerBatch: 6 },
  { label: "western",          region: "western", languageStyle: null,           creators: 2, batchesPerCreator: 2, ideasPerBatch: 6 },
];

function classify(cohortLabel: string, creatorIdx: number, batchIdx: number, ideaIdx: number, idea: GenResp["ideas"][number], qa: QaPerIdea | undefined): IdeaRec {
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
    isPackEntry: packEntry !== undefined,
    packEntrySourceDomain: packEntry?.domain ?? null,
    packEntryPidginLevel: packEntry?.pidginLevel ?? null,
    t2Edge: classifyT2Edge(packId, anchor),
    hookQualityScore: qa?.hookQualityScore ?? null,
  };
}

async function runCohort(c: Cohort): Promise<{ ideas: IdeaRec[]; batches: BatchRec[] }> {
  // Resume support: load existing partial if present so a chunked
  // run (one creator slice per bash invocation) accumulates instead
  // of overwriting. P11_CREATOR_OFFSET / P11_CREATOR_LIMIT trim which
  // creators this invocation runs.
  const partialPath = path.join(QA_RUNS_DIR, `_p11_partial_${c.label}.json`);
  let ideas: IdeaRec[] = [];
  let batches: BatchRec[] = [];
  if (fs.existsSync(partialPath)) {
    try {
      const prior = JSON.parse(fs.readFileSync(partialPath, "utf8")) as { ideas: IdeaRec[]; batches: BatchRec[] };
      ideas = prior.ideas; batches = prior.batches;
      console.log(`[p11] resumed cohort=${c.label} priorIdeas=${ideas.length} priorBatches=${batches.length}`);
    } catch { /* start fresh */ }
  }
  const offset = Number(process.env.P11_CREATOR_OFFSET ?? "0");
  const limit = Number(process.env.P11_CREATOR_LIMIT ?? String(c.creators));
  const start = Math.max(0, offset);
  const stop = Math.min(c.creators, offset + limit);
  // Idempotent resume (architect feedback): if this invocation is
  // about to (re)write any creatorIdx in [start, stop), drop all
  // prior records keyed to those creators so a rerun overwrites
  // its slice cleanly instead of appending duplicates.
  const overwriting = new Set<number>();
  for (let i = start; i < stop; i++) overwriting.add(i);
  const beforeIdeas = ideas.length, beforeBatches = batches.length;
  ideas = ideas.filter((x) => !overwriting.has(x.creatorIdx));
  batches = batches.filter((b) => !overwriting.has(b.creatorIdx));
  if (ideas.length !== beforeIdeas || batches.length !== beforeBatches) {
    console.log(`[p11] dropped prior creator-slice records to keep resume idempotent: ideas ${beforeIdeas}→${ideas.length}, batches ${beforeBatches}→${batches.length}`);
  }
  for (let creatorIdx = start; creatorIdx < stop; creatorIdx++) {
    // Wrap memory reset in retry loop — DB pool can die when the dev
    // workflow auto-restarts mid-run; one retry is enough to span the
    // restart without aborting the whole audit.
    let resetErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await resetDemoCreatorMemory(); resetErr = null; break; }
      catch (e) { resetErr = e; await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); }
    }
    if (resetErr) {
      console.log(`[p11] cohort=${c.label} cre=${creatorIdx + 1} memory-reset-failed-after-3-attempts err=${String((resetErr as Error).message ?? resetErr).slice(0, 120)} — continuing without reset`);
    }
    let lastHooks: string[] = [];
    for (let batchIdx = 0; batchIdx < c.batchesPerCreator; batchIdx++) {
      const isRefresh = batchIdx > 0;
      let r: Awaited<ReturnType<typeof callApi>>;
      try {
        r = await callApi({
          region: c.region,
          languageStyle: c.languageStyle,
          count: c.ideasPerBatch,
          regenerate: isRefresh,
          excludeHooks: lastHooks,
        });
      } catch (e) {
        // callApi already catches everything inside, but belt-and-
        // suspenders for any unexpected throw — never let one batch
        // kill the audit.
        r = { resp: null, status: 0, durationMs: 0, err: `outer-catch: ${String((e as Error).message ?? e).slice(0, 200)}` };
      }
      const ideaCount = r.resp?.ideas.length ?? 0;
      batches.push({
        cohort: c.label, creatorIdx, batchIdx, isRefresh,
        status: r.status, durationMs: r.durationMs,
        errored: r.err !== null, errorMsg: r.err,
        ideaCount,
        underfill: r.status === 200 && ideaCount < c.ideasPerBatch,
        usedFallback: r.resp?.usedFallback ?? null,
        fallbackReason: r.resp?.qaTelemetry?.fallbackDecision?.reason ?? null,
        localKept: r.resp?.counts?.localKept ?? null,
        fallbackKept: r.resp?.counts?.fallbackKept ?? null,
      });
      if (r.resp) {
        for (let i = 0; i < r.resp.ideas.length; i++) {
          ideas.push(classify(c.label, creatorIdx, batchIdx, i, r.resp.ideas[i], r.resp.qaTelemetry?.perIdea?.[i]));
        }
        lastHooks = r.resp.ideas.map((x) => x.hook);
      } else {
        lastHooks = [];
      }
      // console.log auto-flushes on every call (avoids the
      // process.stdout.write buffer-not-flushed-on-exit failure
      // mode that hid two earlier silent crashes).
      console.log(`[p11] cohort=${c.label} cre=${creatorIdx + 1}/${c.creators} batch=${batchIdx + 1}/${c.batchesPerCreator} ms=${r.durationMs} status=${r.status} ideas=${ideaCount} fb=${r.resp?.usedFallback ?? "?"} fbReason=${r.resp?.qaTelemetry?.fallbackDecision?.reason ?? "?"}${r.err ? ` err=${r.err.slice(0, 80)}` : ""}`);
      // Persist progress after every batch — even if the next batch
      // crashes the process we still have audit data on disk.
      try {
        fs.writeFileSync(path.join(QA_RUNS_DIR, `_p11_partial_${c.label}.json`), JSON.stringify({ ideas, batches }, null, 2));
      } catch { /* ignore */ }
    }
  }
  return { ideas, batches };
}

// ---------- aggregation helpers ----------------------------------------
const tally = <T,>(arr: T[], key: (x: T) => string): Map<string, number> => {
  const m = new Map<string, number>();
  for (const x of arr) {
    const k = key(x);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
};
const topN = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const distinct = <T,>(arr: T[], key: (x: T) => string): number => new Set(arr.map(key)).size;
const hhi = (m: Map<string, number>): number => {
  const total = [...m.values()].reduce((s, v) => s + v, 0);
  if (total === 0) return 0;
  let h = 0;
  for (const v of m.values()) {
    const s = v / total;
    h += s * s;
  }
  return Math.round(h * 10000) / 10000;
};

// ---------- main -------------------------------------------------------
async function runMode(cohortFilter: string): Promise<void> {
  console.log(`[p11] mode=run cohort=${cohortFilter}`);
  console.log(`[p11] API_URL=${API_URL}`);
  console.log(`[p11] flags: NG_PACK=${process.env.LUMINA_NG_PACK_ENABLED} T2=${process.env.LUMINA_NG_PACK_PROJECTION_T2_ENABLED} PAR=${process.env.LUMINA_NG_PACK_AWARE_RETENTION_ENABLED} SOFT=${process.env.LUMINA_NG_MEMORY_SOFT_CAP_ENABLED}`);
  console.log(`[p11] NIGERIAN_HOOK_PACK.length=${NIGERIAN_HOOK_PACK.length}, FOOD_V2 ids=${FOOD_V2_IDS.size}`);
  const selected = cohortFilter === "all" ? COHORTS : COHORTS.filter((c) => c.label === cohortFilter);
  if (selected.length === 0) throw new Error(`unknown cohort filter: ${cohortFilter}`);
  for (const c of selected) {
    console.log(`[p11] === cohort start: ${c.label} (creators=${c.creators}, batches/cre=${c.batchesPerCreator}, ideas/batch=${c.ideasPerBatch}) ===`);
    const r = await runCohort(c);
    fs.writeFileSync(path.join(QA_RUNS_DIR, `_p11_partial_${c.label}.json`), JSON.stringify(r, null, 2));
    console.log(`[p11] === cohort done: ${c.label} ideas=${r.ideas.length} batches=${r.batches.length} ===`);
  }
}

function loadPartial(label: string): { ideas: IdeaRec[]; batches: BatchRec[] } {
  const p = path.join(QA_RUNS_DIR, `_p11_partial_${label}.json`);
  if (!fs.existsSync(p)) {
    console.warn(`[p11] missing partial for cohort=${label} — using empty`);
    return { ideas: [], batches: [] };
  }
  return JSON.parse(fs.readFileSync(p, "utf8")) as { ideas: IdeaRec[]; batches: BatchRec[] };
}

async function aggregateMode(): Promise<void> {
  console.log("[p11] mode=aggregate — loading partials + writing final outputs");
  const results = new Map<string, { ideas: IdeaRec[]; batches: BatchRec[] }>();
  // Strict aggregator (architect feedback): every COHORTS entry must
  // have a partial on disk unless P11_ALLOW_PARTIAL_AGGREGATE=1 is set
  // explicitly. Prevents silent "looks complete" final outputs.
  const missing: string[] = [];
  for (const c of COHORTS) {
    const p = path.join(QA_RUNS_DIR, `_p11_partial_${c.label}.json`);
    if (!fs.existsSync(p)) missing.push(c.label);
    results.set(c.label, loadPartial(c.label));
  }
  if (missing.length > 0 && process.env.P11_ALLOW_PARTIAL_AGGREGATE !== "1") {
    console.error(`[p11] FATAL: missing partials for cohort(s) ${missing.join(", ")}. Set P11_ALLOW_PARTIAL_AGGREGATE=1 to override.`);
    process.exit(3);
  }
  const cohortsActuallyPresent = COHORTS.length - missing.length;
  const totalRunMs = [...results.values()].reduce((s, r) => s + r.batches.reduce((sb, b) => sb + b.durationMs, 0), 0);

  // ---------- aggregate metrics ---------------------------------------
  const ngLp = results.get("ng_light_pidgin")!;
  const ngClean = results.get("ng_clean")!;
  const western = results.get("western")!;

  const lpPack = ngLp.ideas.filter((i) => i.isPackEntry);
  const lpFoodV2 = ngLp.ideas.filter((i) => i.isFoodV2);
  const lpHomeFood = ngLp.ideas.filter((i) => i.t2Edge === "home→food");
  const lpEvMornings = ngLp.ideas.filter((i) => i.t2Edge === "everyday→mornings");
  const lpEvSleep = ngLp.ideas.filter((i) => i.t2Edge === "everyday→sleep");
  const lpSlot0 = ngLp.ideas.filter((i) => i.slot0);

  const aggregate = {
    ng_light_pidgin: {
      totalIdeas: ngLp.ideas.length,
      packIdeas: lpPack.length,
      packShare: ngLp.ideas.length === 0 ? 0 : Math.round((lpPack.length / ngLp.ideas.length) * 1000) / 1000,
      distinctPackIds: distinct(lpPack, (i) => i.nigerianPackEntryId ?? ""),
      distinctHooks: distinct(ngLp.ideas, (i) => i.hook.toLowerCase()),
      distinctAnchors: distinct(ngLp.ideas, (i) => (i.anchor ?? "").toLowerCase()),
      distinctSlot0Hooks: distinct(lpSlot0, (i) => i.hook.toLowerCase()),
      distinctSlot0PackIds: distinct(lpSlot0.filter((i) => i.isPackEntry), (i) => i.nigerianPackEntryId ?? ""),
      topRepeatedHooks: topN(tally(ngLp.ideas, (i) => i.hook.toLowerCase()), 10),
      topRepeatedPackIds: topN(tally(lpPack, (i) => i.nigerianPackEntryId ?? ""), 10),
      topRepeatedAnchors: topN(tally(ngLp.ideas, (i) => (i.anchor ?? "").toLowerCase()), 10),
      hhiHook: hhi(tally(ngLp.ideas, (i) => i.hook.toLowerCase())),
      hhiAnchor: hhi(tally(ngLp.ideas, (i) => (i.anchor ?? "").toLowerCase())),
    },
    widenedEdges: {
      "home→food": {
        shipped: lpHomeFood.length,
        distinctPackIds: distinct(lpHomeFood, (i) => i.nigerianPackEntryId ?? ""),
        distinctHooks: distinct(lpHomeFood, (i) => i.hook.toLowerCase()),
        distinctAnchors: distinct(lpHomeFood, (i) => (i.anchor ?? "").toLowerCase()),
        slot0Shipped: lpHomeFood.filter((i) => i.slot0).length,
        topHook: topN(tally(lpHomeFood, (i) => i.hook.toLowerCase()), 1),
        topPackId: topN(tally(lpHomeFood, (i) => i.nigerianPackEntryId ?? ""), 1),
        hhi: hhi(tally(lpHomeFood, (i) => i.hook.toLowerCase())),
      },
      "everyday→mornings": {
        shipped: lpEvMornings.length,
        distinctPackIds: distinct(lpEvMornings, (i) => i.nigerianPackEntryId ?? ""),
        distinctHooks: distinct(lpEvMornings, (i) => i.hook.toLowerCase()),
        distinctAnchors: distinct(lpEvMornings, (i) => (i.anchor ?? "").toLowerCase()),
        slot0Shipped: lpEvMornings.filter((i) => i.slot0).length,
        topHook: topN(tally(lpEvMornings, (i) => i.hook.toLowerCase()), 1),
        topPackId: topN(tally(lpEvMornings, (i) => i.nigerianPackEntryId ?? ""), 1),
        hhi: hhi(tally(lpEvMornings, (i) => i.hook.toLowerCase())),
      },
      "everyday→sleep": {
        shipped: lpEvSleep.length,
        distinctPackIds: distinct(lpEvSleep, (i) => i.nigerianPackEntryId ?? ""),
        distinctHooks: distinct(lpEvSleep, (i) => i.hook.toLowerCase()),
        distinctAnchors: distinct(lpEvSleep, (i) => (i.anchor ?? "").toLowerCase()),
        slot0Shipped: lpEvSleep.filter((i) => i.slot0).length,
        topHook: topN(tally(lpEvSleep, (i) => i.hook.toLowerCase()), 1),
        topPackId: topN(tally(lpEvSleep, (i) => i.nigerianPackEntryId ?? ""), 1),
        hhi: hhi(tally(lpEvSleep, (i) => i.hook.toLowerCase())),
      },
    },
    foodV2: {
      importedTotal: FOOD_V2_IDS.size,
      shippedAtLeastOnce: distinct(lpFoodV2, (i) => i.nigerianPackEntryId ?? ""),
      totalShippedCards: lpFoodV2.length,
      distinctHooksShipped: distinct(lpFoodV2, (i) => i.hook.toLowerCase()),
      topHooks: topN(tally(lpFoodV2, (i) => i.hook.toLowerCase()), 10),
      topAnchors: topN(tally(lpFoodV2, (i) => (i.anchor ?? "").toLowerCase()), 10),
      slot0Shipped: lpFoodV2.filter((i) => i.slot0).length,
    },
    slot0: {
      lp_total: lpSlot0.length,
      lp_distinctHooks: distinct(lpSlot0, (i) => i.hook.toLowerCase()),
      lp_distinctPackIds: distinct(lpSlot0.filter((i) => i.isPackEntry), (i) => i.nigerianPackEntryId ?? ""),
      lp_packShare: lpSlot0.length === 0 ? 0 : Math.round((lpSlot0.filter((i) => i.isPackEntry).length / lpSlot0.length) * 1000) / 1000,
      lp_foodV2Slot0: lpSlot0.filter((i) => i.isFoodV2).length,
      lp_topHooks: topN(tally(lpSlot0, (i) => i.hook.toLowerCase()), 10),
    },
    controlCohorts: {
      ng_clean: {
        totalIdeas: ngClean.ideas.length,
        distinctHooks: distinct(ngClean.ideas, (i) => i.hook.toLowerCase()),
        packIdeas: ngClean.ideas.filter((i) => i.isPackEntry).length,
        foodV2Leakage: ngClean.ideas.filter((i) => i.isFoodV2).length,
        lightPidginLeakageBySource: ngClean.ideas.filter((i) => i.packEntryPidginLevel === "light_pidgin").length,
        errors: ngClean.batches.filter((b) => b.errored).length,
        underfills: ngClean.batches.filter((b) => b.underfill).length,
        usedFallbackBatches: ngClean.batches.filter((b) => b.usedFallback === true).length,
      },
      western: {
        totalIdeas: western.ideas.length,
        nigerianPackIds: western.ideas.filter((i) => i.isPackEntry).length,
        foodV2Ids: western.ideas.filter((i) => i.isFoodV2).length,
        errors: western.batches.filter((b) => b.errored).length,
        underfills: western.batches.filter((b) => b.underfill).length,
        usedFallbackBatches: western.batches.filter((b) => b.usedFallback === true).length,
      },
    },
    fallbackUnderfill: {
      ng_lp: {
        totalBatches: ngLp.batches.length,
        underfills: ngLp.batches.filter((b) => b.underfill).length,
        errors: ngLp.batches.filter((b) => b.errored).length,
        usedFallbackBatches: ngLp.batches.filter((b) => b.usedFallback === true).length,
        fallbackReasons: Object.fromEntries(tally(ngLp.batches.filter((b) => b.fallbackReason !== null), (b) => b.fallbackReason!)),
        avgDurationMs: Math.round(ngLp.batches.reduce((s, b) => s + b.durationMs, 0) / Math.max(1, ngLp.batches.length)),
        medianDurationMs: (() => {
          const xs = [...ngLp.batches.map((b) => b.durationMs)].sort((a, b) => a - b);
          return xs.length === 0 ? 0 : xs[Math.floor(xs.length / 2)];
        })(),
      },
    },
    runtime: {
      totalRunMs,
      cohortsRun: cohortsActuallyPresent,
      totalBatches: [...results.values()].reduce((s, r) => s + r.batches.length, 0),
      totalIdeas: [...results.values()].reduce((s, r) => s + r.ideas.length, 0),
    },
  };

  // ---------- write JSON outputs --------------------------------------
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
    },
    aggregate,
    perCohortIdeas: Object.fromEntries([...results.entries()].map(([k, r]) => [k, r.ideas])),
    perCohortBatches: Object.fromEntries([...results.entries()].map(([k, r]) => [k, r.batches])),
  };
  fs.writeFileSync(path.join(QA_RUNS_DIR, "p11_t2_live_route_re_audit.json"), JSON.stringify(audit, null, 2));
  fs.writeFileSync(path.join(QA_RUNS_DIR, "p11_t2_live_route_re_audit_summary.json"), JSON.stringify({ meta: audit.meta, aggregate }, null, 2));
  console.log(`[p11] wrote ${QA_RUNS_DIR}/p11_t2_live_route_re_audit{,_summary}.json (totalRunMs=${totalRunMs})`);
  console.log(`[p11] ng_lp: total=${aggregate.ng_light_pidgin.totalIdeas} pack=${aggregate.ng_light_pidgin.packIdeas} (${(aggregate.ng_light_pidgin.packShare * 100).toFixed(1)}%) distinctHooks=${aggregate.ng_light_pidgin.distinctHooks}`);
  console.log(`[p11] home→food shipped=${aggregate.widenedEdges["home→food"].shipped} distinctPackIds=${aggregate.widenedEdges["home→food"].distinctPackIds}`);
  console.log(`[p11] FOOD_V2 shippedAtLeastOnce=${aggregate.foodV2.shippedAtLeastOnce}/${aggregate.foodV2.importedTotal} totalCards=${aggregate.foodV2.totalShippedCards}`);
}

async function main(): Promise<void> {
  const mode = process.env.P11_MODE ?? "run";
  if (mode === "aggregate") { await aggregateMode(); return; }
  if (mode !== "run") throw new Error(`unknown P11_MODE: ${mode}`);
  const cohort = process.env.P11_COHORT ?? "all";
  // Pre-flight gated by P11_PREFLIGHT=1 so chunked invocations after
  // the first don't pay the cold-start tax (~23s) we already
  // confirmed once. Aggregation in §1 of the report records that
  // telemetry visibility was verified on invocation #1.
  if (process.env.P11_PREFLIGHT === "1") {
    const probe = await callApi({ region: "nigeria", languageStyle: "light_pidgin", count: 1, regenerate: false, excludeHooks: [] });
    const telemetryOk = probe.resp?.qaTelemetry !== undefined;
    console.log(`[p11] pre-flight telemetry visible: ${telemetryOk} (status=${probe.status} ms=${probe.durationMs})`);
    if (!telemetryOk) { console.error("[p11] FATAL: qaTelemetry not visible"); process.exit(2); }
  }
  await runMode(cohort);
}

main()
  .catch((e) => {
    console.error("[p11] FATAL", e);
    process.exit(1);
  })
  .finally(() => {
    void db.$client.end();
  });
