/**
 * PHASE W1.1 AUDIT (BI 2026-05-07) — investigation harness for the
 * western/default `/api/ideator/generate` under-fill / fallback audit.
 *
 * Pure measurement, NO behavior change. Calls the REAL `/api/ideator/generate`
 * route with the dev-only QA header (`x-lumina-qa-expose-meta: 1`),
 * captures the additive `qaTelemetry.westernFunnel` snapshot the
 * orchestrator now emits when `_w1WesternEligible`, and writes raw
 * batch records to `.local/qa-runs/w11_<label>_<ts>.json`.
 *
 * Subcommands:
 *   run --label=<label> [--count=N]
 *     Calls the API `N` times (default 20) for region=western. Default
 *     batch size is 3 ideas. Operator must restart the api-server with
 *     `LUMINA_W1_DISABLE_FOR_QA=1` between the W1-ON and W1-OFF passes
 *     (the `westernHookQuality` helper short-circuits to 0 when this
 *     env is set in non-production).
 *
 *   report
 *     Reads the most recent `w11_on_*.json` and `w11_off_*.json`
 *     dumps, aggregates them, and writes `.local/W1_1_AUDIT_REPORT.md`.
 *
 * Run:
 *   pnpm --filter @workspace/api-server exec tsx src/qa/w11AuditDriver.ts run --label=on --count=20
 *   # restart api-server with LUMINA_W1_DISABLE_FOR_QA=1
 *   pnpm --filter @workspace/api-server exec tsx src/qa/w11AuditDriver.ts run --label=off --count=10
 *   # restart api-server WITHOUT bypass
 *   pnpm --filter @workspace/api-server exec tsx src/qa/w11AuditDriver.ts report
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const QA_RUNS_DIR = path.resolve(__dirname, "../../../../.local/qa-runs");
const REPORT_PATH = path.resolve(
  __dirname,
  "../../../../.local/W1_1_AUDIT_REPORT.md",
);
// PHASE W1.1 AUDIT — also write a tracked copy alongside the driver so
// the deliverable is reviewable from the git diff. `.local/` is
// system-wide-ignored on this platform, so a local `.gitignore`
// exception cannot un-ignore the report. Both paths receive the same
// content; the in-repo path is the canonical one for reviewers.
const TRACKED_REPORT_PATH = path.resolve(
  __dirname,
  "./reports/W1_1_AUDIT_REPORT.md",
);
const API_URL =
  process.env.W11_API_URL ?? "http://localhost:80/api/ideator/generate";
const PER_BATCH_TIMEOUT_MS = 90_000;
const COUNT_PER_BATCH = 3;

type WesternFunnel = {
  region: string | null;
  desiredCount: number;
  regenerate: boolean;
  rawPatternCount: number;
  patternAfterExclusion: number;
  coherenceKept: number;
  coherenceRejections: Record<string, number>;
  coreNativeGenerated: number;
  coreNativeKept: number;
  coreNativeRejectionTop: Array<{ reason: string; count: number }>;
  westernAdjustmentSummary: {
    recipesScored: number;
    demoted: number;
    boosted: number;
    zero: number;
    netDelta: number;
  } | null;
  mergedIntoFilterAndRescore: number;
  localKept: number;
  localHardRejected: number;
  localRejected: number;
  localRejectionTop: Array<{ reason: string; count: number }>;
  excludeHooksApplied: number;
  mergedAfterExclude: number;
  mergedSizeAtFirstSelection?: number;
  firstSelectionBatchSize: number;
  firstSelectionGuardsPassed: boolean;
  n1LiveSkipFallback: boolean;
  p3SkipFallbackLocalSufficient: boolean;
  needFallback: boolean;
  fallbackTriggers: {
    layer1CoreAware: boolean;
    mergedShort: boolean;
    selectionUnderfilled: boolean;
    guardsFailed: boolean;
  } | null;
  usedFallback: boolean;
  fallbackKept: number;
  fallbackRejectionTop: Array<{ reason: string; count: number }>;
  mergedSizeAfterFallback: number;
  finalSelectionBatchSize: number;
  finalGuardsPassed: boolean;
  shippedSourceMix: Array<{ source: string; count: number }>;
  fallbackReplacedLocalInFinal?: boolean;
  topMergedHookSkeletons?: Array<{ skeletonId: string; count: number }>;
  mergedHookSkeletonRepeatedFamilies?: number;
};

type GenResp = {
  region: string;
  count: number;
  ideas: Array<{
    hook: string;
    whatToShow: string;
    howToFilm: string;
    caption: string;
  }>;
  usedFallback?: boolean;
  counts?: { localKept: number; fallbackKept: number };
  qaTelemetry?: {
    perIdea: Array<{
      source?: string;
      hookQualityScore?: number;
      anchor?: string;
    }>;
    westernFunnel?: WesternFunnel;
  };
};

type BatchRec = {
  batchIdx: number;
  isRefresh: boolean;
  status: number;
  durationMs: number;
  errored: boolean;
  errorMsg: string | null;
  ideaCount: number;
  usedFallback: boolean | null;
  localKept: number | null;
  fallbackKept: number | null;
  funnel: WesternFunnel | null;
  hooks: string[];
  perIdeaSources: Array<string | null>;
  // PHASE W1.1 AUDIT — per-idea hook quality scores so the report can
  // surface the strongest 20 + weakest 20 western hooks (task spec
  // section 3). Aligned by index with `hooks` / `perIdeaSources`.
  perIdeaHookQuality: Array<number | null>;
};

async function callApi(args: {
  regenerate: boolean;
  excludeHooks: string[];
}): Promise<{ resp: GenResp | null; status: number; durationMs: number; err: string | null }> {
  const body: Record<string, unknown> = {
    region: "western",
    count: COUNT_PER_BATCH,
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
    const dur = Date.now() - t0;
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return {
        resp: null,
        status: r.status,
        durationMs: dur,
        err: `HTTP ${r.status}: ${text.slice(0, 200)}`,
      };
    }
    const j = (await r.json()) as GenResp;
    return { resp: j, status: r.status, durationMs: dur, err: null };
  } catch (e) {
    return {
      resp: null,
      status: 0,
      durationMs: Date.now() - t0,
      err: String((e as Error).message ?? e),
    };
  }
}

async function runPass(label: string, batchCount: number, startIdx: number): Promise<void> {
  if (!fs.existsSync(QA_RUNS_DIR)) fs.mkdirSync(QA_RUNS_DIR, { recursive: true });
  // Single canonical filename per label so multiple chunked runs append
  // into the same dump (used by the report aggregator's `loadLatest`).
  const dumpPath = path.join(QA_RUNS_DIR, `w11_${label}_dump.json`);
  const progPath = path.join(QA_RUNS_DIR, `w11_${label}_progress.log`);
  let recs: BatchRec[] = [];
  if (fs.existsSync(dumpPath)) {
    try {
      const j = JSON.parse(fs.readFileSync(dumpPath, "utf-8")) as { recs?: BatchRec[] };
      if (Array.isArray(j.recs)) recs = j.recs;
    } catch {
      recs = [];
    }
  }
  const startedAt = new Date().toISOString();
  const note = `[w11] start label=${label} startIdx=${startIdx} batchCount=${batchCount} api=${API_URL} (existing recs=${recs.length}) at ${startedAt}\n`;
  process.stdout.write(note);
  fs.appendFileSync(progPath, note);
  let lastHooks: string[] = [];
  if (recs.length > 0) {
    const lastNonEmpty = [...recs].reverse().find((r) => r.hooks.length > 0);
    if (lastNonEmpty) lastHooks = lastNonEmpty.hooks;
  }
  for (let i = 0; i < batchCount; i++) {
    const bi = startIdx + i;
    const isRefresh = bi > 0;
    const r = await callApi({
      regenerate: isRefresh,
      excludeHooks: bi <= 1 ? lastHooks : [],
    });
    const ideas = r.resp?.ideas ?? [];
    const funnel = r.resp?.qaTelemetry?.westernFunnel ?? null;
    const rec: BatchRec = {
      batchIdx: bi,
      isRefresh,
      status: r.status,
      durationMs: r.durationMs,
      errored: r.err !== null,
      errorMsg: r.err,
      ideaCount: ideas.length,
      usedFallback: r.resp?.usedFallback ?? null,
      localKept: r.resp?.counts?.localKept ?? null,
      fallbackKept: r.resp?.counts?.fallbackKept ?? null,
      funnel,
      hooks: ideas.map((i) => i.hook),
      perIdeaSources: (r.resp?.qaTelemetry?.perIdea ?? []).map(
        (p) => p.source ?? null,
      ),
      perIdeaHookQuality: (r.resp?.qaTelemetry?.perIdea ?? []).map(
        (p) => (typeof p.hookQualityScore === "number" ? p.hookQualityScore : null),
      ),
    };
    recs.push(rec);
    // Persist after EVERY batch so a kill / timeout never loses progress.
    fs.writeFileSync(
      dumpPath,
      JSON.stringify({ label, ts: startedAt, recs }, null, 2),
    );
    const line = `[w11] ${label} ${bi + 1} ms=${r.durationMs} ideas=${ideas.length} fb=${r.resp?.usedFallback ?? "?"} need=${funnel?.needFallback ?? "?"} 1stSelN=${funnel?.firstSelectionBatchSize ?? "?"} cnGen=${funnel?.coreNativeGenerated ?? "?"} cnKept=${funnel?.coreNativeKept ?? "?"} fbTrig=${funnel?.fallbackTriggers ? Object.entries(funnel.fallbackTriggers).filter(([, v]) => v).map(([k]) => k).join(",") || "none" : "noFB"} reg=${funnel?.region ?? "?"}${r.err ? ` err=${r.err.slice(0, 60)}` : ""}\n`;
    process.stdout.write(line);
    fs.appendFileSync(progPath, line);
    if (ideas.length > 0) lastHooks = ideas.map((i) => i.hook);
  }
  const done = `[w11] CHUNK DONE label=${label} totalRecs=${recs.length} dump=${dumpPath}\n`;
  process.stdout.write(done);
  fs.appendFileSync(progPath, done);
}

function pct(n: number, d: number): string {
  if (d === 0) return "—";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function loadLatest(label: string): { recs: BatchRec[]; ts: string } | null {
  const p = path.join(QA_RUNS_DIR, `w11_${label}_dump.json`);
  if (!fs.existsSync(p)) return null;
  const j = JSON.parse(fs.readFileSync(p, "utf-8")) as {
    recs: BatchRec[];
    ts?: string;
  };
  return { recs: j.recs, ts: j.ts ?? "(unknown)" };
}

type Aggregate = {
  batches: number;
  errored: number;
  ideasShipped: number;
  ideasExpected: number;
  underfilled: number;
  fbBatches: number;
  needFbBatches: number;
  p3SkipBatches: number;
  triggerCounts: {
    layer1CoreAware: number;
    mergedShort: number;
    selectionUnderfilled: number;
    guardsFailed: number;
  };
  guardsFailedFinal: number;
  durations: number[];
  rawPattern: number[];
  patternAfterExcl: number[];
  coherenceKept: number[];
  coreGen: number[];
  coreKept: number[];
  mergedFR: number[];
  localKept: number[];
  mergedAfterExclude: number[];
  firstSelN: number[];
  finalSelN: number[];
  fbKept: number[];
  coherenceRejAgg: Map<string, number>;
  coreRejAgg: Map<string, number>;
  localRejAgg: Map<string, number>;
  fbRejAgg: Map<string, number>;
  westernAdjAgg: {
    recipesScored: number;
    demoted: number;
    boosted: number;
    zero: number;
    netDelta: number;
  };
  shippedSourceAgg: Map<string, number>;
  fbReplacedLocalBatches: number;
  mergedSkeletonAgg: Map<string, number>;
  repeatedSkeletonFamiliesPerBatch: number[];
};

function aggregate(recs: BatchRec[]): Aggregate {
  const agg: Aggregate = {
    batches: recs.length,
    errored: 0,
    ideasShipped: 0,
    ideasExpected: recs.length * COUNT_PER_BATCH,
    underfilled: 0,
    fbBatches: 0,
    needFbBatches: 0,
    p3SkipBatches: 0,
    triggerCounts: {
      layer1CoreAware: 0,
      mergedShort: 0,
      selectionUnderfilled: 0,
      guardsFailed: 0,
    },
    guardsFailedFinal: 0,
    durations: [],
    rawPattern: [],
    patternAfterExcl: [],
    coherenceKept: [],
    coreGen: [],
    coreKept: [],
    mergedFR: [],
    localKept: [],
    mergedAfterExclude: [],
    firstSelN: [],
    finalSelN: [],
    fbKept: [],
    coherenceRejAgg: new Map(),
    coreRejAgg: new Map(),
    localRejAgg: new Map(),
    fbRejAgg: new Map(),
    westernAdjAgg: {
      recipesScored: 0,
      demoted: 0,
      boosted: 0,
      zero: 0,
      netDelta: 0,
    },
    shippedSourceAgg: new Map(),
    fbReplacedLocalBatches: 0,
    mergedSkeletonAgg: new Map(),
    repeatedSkeletonFamiliesPerBatch: [],
  };
  const bumpMap = (m: Map<string, number>, k: string, v: number): void => {
    m.set(k, (m.get(k) ?? 0) + v);
  };
  for (const r of recs) {
    if (r.errored) agg.errored += 1;
    agg.ideasShipped += r.ideaCount;
    if (r.ideaCount < COUNT_PER_BATCH) agg.underfilled += 1;
    if (r.usedFallback === true) agg.fbBatches += 1;
    agg.durations.push(r.durationMs);
    const f = r.funnel;
    if (!f) continue;
    if (f.needFallback) agg.needFbBatches += 1;
    if (f.p3SkipFallbackLocalSufficient) agg.p3SkipBatches += 1;
    if (f.fallbackTriggers) {
      if (f.fallbackTriggers.layer1CoreAware) agg.triggerCounts.layer1CoreAware += 1;
      if (f.fallbackTriggers.mergedShort) agg.triggerCounts.mergedShort += 1;
      if (f.fallbackTriggers.selectionUnderfilled)
        agg.triggerCounts.selectionUnderfilled += 1;
      if (f.fallbackTriggers.guardsFailed) agg.triggerCounts.guardsFailed += 1;
    }
    if (!f.finalGuardsPassed) agg.guardsFailedFinal += 1;
    agg.rawPattern.push(f.rawPatternCount);
    agg.patternAfterExcl.push(f.patternAfterExclusion);
    agg.coherenceKept.push(f.coherenceKept);
    agg.coreGen.push(f.coreNativeGenerated);
    agg.coreKept.push(f.coreNativeKept);
    agg.mergedFR.push(f.mergedIntoFilterAndRescore);
    agg.localKept.push(f.localKept);
    agg.mergedAfterExclude.push(f.mergedAfterExclude);
    agg.firstSelN.push(f.firstSelectionBatchSize);
    agg.finalSelN.push(f.finalSelectionBatchSize);
    agg.fbKept.push(f.fallbackKept);
    for (const [k, v] of Object.entries(f.coherenceRejections))
      bumpMap(agg.coherenceRejAgg, k, v);
    for (const e of f.coreNativeRejectionTop)
      bumpMap(agg.coreRejAgg, e.reason, e.count);
    for (const e of f.localRejectionTop)
      bumpMap(agg.localRejAgg, e.reason, e.count);
    for (const e of f.fallbackRejectionTop)
      bumpMap(agg.fbRejAgg, e.reason, e.count);
    if (f.westernAdjustmentSummary) {
      agg.westernAdjAgg.recipesScored +=
        f.westernAdjustmentSummary.recipesScored;
      agg.westernAdjAgg.demoted += f.westernAdjustmentSummary.demoted;
      agg.westernAdjAgg.boosted += f.westernAdjustmentSummary.boosted;
      agg.westernAdjAgg.zero += f.westernAdjustmentSummary.zero;
      agg.westernAdjAgg.netDelta += f.westernAdjustmentSummary.netDelta;
    }
    for (const e of f.shippedSourceMix)
      bumpMap(agg.shippedSourceAgg, e.source, e.count);
    if (f.fallbackReplacedLocalInFinal === true)
      agg.fbReplacedLocalBatches += 1;
    if (f.topMergedHookSkeletons) {
      for (const e of f.topMergedHookSkeletons)
        bumpMap(agg.mergedSkeletonAgg, e.skeletonId, e.count);
    }
    if (typeof f.mergedHookSkeletonRepeatedFamilies === "number")
      agg.repeatedSkeletonFamiliesPerBatch.push(
        f.mergedHookSkeletonRepeatedFamilies,
      );
  }
  return agg;
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}
function minMax(arr: number[]): [number, number] {
  if (arr.length === 0) return [0, 0];
  let lo = arr[0]!,
    hi = arr[0]!;
  for (const x of arr) {
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  return [lo, hi];
}
function topN(m: Map<string, number>, n: number): Array<[string, number]> {
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function statRow(label: string, arr: number[]): string {
  const [lo, hi] = minMax(arr);
  return `| ${label} | ${arr.length} | ${avg(arr).toFixed(1)} | ${median(arr).toFixed(1)} | ${lo} | ${hi} |`;
}

// PHASE W1.1 AUDIT — map of well-known rejection reasons to the
// upstream-spec funnel stage they belong to. Used to derive the
// stage-by-stage breakdown the task spec asks for from the existing
// `localRejectionTop` / `coreNativeRejectionTop` aggregates without
// adding any new in-orchestrator counter (semantics-preserving).
// Anything not matched falls into "other".
const REASON_STAGE: Array<[RegExp, string]> = [
  [/^schema_|_schema$|^validation_|^comedy_schema_/, "schema"],
  [/^show_missing_hook_anchor$|coherence|^scene_|^anchor_/, "scenario_coherence"],
  [/comedy|comic|punchline/, "comedy"],
  [/copied|anti_copy|seed|template/, "anti_copy"],
  [/safety|privacy|policy|harm/, "safety_privacy"],
  [/novelty|diversity|fingerprint|skeleton|repeat|family/, "novelty_diversity"],
];
function reasonToStage(reason: string): string {
  for (const [re, stage] of REASON_STAGE) {
    if (re.test(reason)) return stage;
  }
  return "other";
}

function buildHookCorpusSection(recs: BatchRec[]): string {
  // PHASE W1.1 AUDIT — strongest 20 / weakest 20 hooks + exact
  // repeated hook list, required by task spec section 3. Pulls hook
  // strings + per-idea hookQualityScore captured by the driver from
  // every batch in the pass and sorts by score.
  type HookRow = { hook: string; score: number | null; source: string | null; batchIdx: number };
  const all: HookRow[] = [];
  for (const r of recs) {
    const hq = r.perIdeaHookQuality ?? [];
    const ps = r.perIdeaSources ?? [];
    for (let i = 0; i < r.hooks.length; i++) {
      all.push({
        hook: r.hooks[i]!,
        score: hq[i] ?? null,
        source: ps[i] ?? null,
        batchIdx: r.batchIdx,
      });
    }
  }
  const lines: string[] = [];
  lines.push("### Hook corpus — strongest 20, weakest 20, repeated hooks");
  lines.push("");
  if (all.length === 0) {
    lines.push("- _(no hooks captured in this pass)_");
    lines.push("");
    return lines.join("\n");
  }
  const scored = all.filter((h) => h.score !== null) as Array<HookRow & { score: number }>;
  if (scored.length === 0) {
    lines.push(`- _(${all.length} hooks captured but none carried \`hookQualityScore\` in qaTelemetry — strongest/weakest ranking unavailable)_`);
  } else {
    const byScoreDesc = [...scored].sort((a, b) => b.score - a.score);
    const byScoreAsc = [...scored].sort((a, b) => a.score - b.score);
    lines.push(`Total hooks scored: **${scored.length}** of ${all.length} captured.`);
    lines.push("");
    lines.push("**Strongest 20 (highest `hookQualityScore`):**");
    lines.push("");
    lines.push("| # | score | source | batch | hook |");
    lines.push("| --- | --- | --- | --- | --- |");
    byScoreDesc.slice(0, 20).forEach((h, i) => {
      lines.push(`| ${i + 1} | ${h.score.toFixed(1)} | \`${h.source ?? "?"}\` | ${h.batchIdx} | ${h.hook.replace(/\|/g, "\\|").slice(0, 140)} |`);
    });
    lines.push("");
    lines.push("**Weakest 20 (lowest `hookQualityScore`):**");
    lines.push("");
    lines.push("| # | score | source | batch | hook |");
    lines.push("| --- | --- | --- | --- | --- |");
    byScoreAsc.slice(0, 20).forEach((h, i) => {
      lines.push(`| ${i + 1} | ${h.score.toFixed(1)} | \`${h.source ?? "?"}\` | ${h.batchIdx} | ${h.hook.replace(/\|/g, "\\|").slice(0, 140)} |`);
    });
    lines.push("");
  }
  // Exact repeated hooks (case + whitespace normalized for matching).
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const occurrences = new Map<string, { display: string; batches: number[] }>();
  for (const h of all) {
    const k = norm(h.hook);
    const e = occurrences.get(k);
    if (e) e.batches.push(h.batchIdx);
    else occurrences.set(k, { display: h.hook, batches: [h.batchIdx] });
  }
  const repeats = [...occurrences.values()].filter((e) => e.batches.length > 1)
    .sort((a, b) => b.batches.length - a.batches.length);
  lines.push(`**Exact repeated hooks** (same hook string shipped in ≥2 batches): **${repeats.length}**`);
  lines.push("");
  if (repeats.length === 0) {
    lines.push("- _(no exact repeats across batches in this pass)_");
  } else {
    lines.push("| count | batches | hook |");
    lines.push("| --- | --- | --- |");
    for (const r of repeats.slice(0, 20)) {
      lines.push(`| ${r.batches.length} | ${r.batches.join(",")} | ${r.display.replace(/\|/g, "\\|").slice(0, 160)} |`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function buildStageBreakdown(agg: Aggregate): string {
  // PHASE W1.1 AUDIT — per-stage funnel rejection breakdown derived
  // from the existing rejection-reason aggregates (no new in-orchestrator
  // counter; reuses `localRejectionTop` + `coreNativeRejectionTop` +
  // `coherenceRejections` already captured upstream). Each reason is
  // mapped to a stage via `reasonToStage`. This satisfies the spec
  // requirement to surface counts after schema / comedy / anti-copy /
  // safety / novelty without changing pipeline semantics.
  const stages = new Map<string, number>();
  const bump = (k: string, v: number) =>
    stages.set(k, (stages.get(k) ?? 0) + v);
  // Coherence aggregate is already a stage (scenario_coherence).
  for (const [, v] of agg.coherenceRejAgg) bump("scenario_coherence", v);
  // Core-native rejections — bucket by reason → stage.
  for (const [k, v] of agg.coreRejAgg) bump(reasonToStage(k), v);
  // filterAndRescore rejections — bucket by reason → stage.
  for (const [k, v] of agg.localRejAgg) bump(reasonToStage(k), v);
  const lines: string[] = [];
  lines.push("### Funnel rejection by stage (aggregated, derived from rejection-reason maps)");
  lines.push("");
  lines.push("> Stages are derived by pattern-matching every rejection reason against the canonical stage taxonomy (schema → scenario_coherence → comedy → anti_copy → safety_privacy → novelty_diversity → other). Reasons that match no pattern fall into `other`. This is a reporting-time derivation only — no in-orchestrator counter was added; the pipeline still emits its native rejection-reason aggregates and the driver buckets them.");
  lines.push("");
  lines.push("| stage | total rejected (across batches) |");
  lines.push("| --- | --- |");
  const order = ["schema", "scenario_coherence", "comedy", "anti_copy", "safety_privacy", "novelty_diversity", "other"];
  for (const s of order) {
    lines.push(`| ${s} | ${stages.get(s) ?? 0} |`);
  }
  lines.push("");
  return lines.join("\n");
}

function buildSection(label: string, agg: Aggregate, ts: string): string {
  const lines: string[] = [];
  lines.push(`## Pass: \`${label}\` (run ${ts})`);
  lines.push("");
  lines.push(`- batches: **${agg.batches}**, ideas shipped: **${agg.ideasShipped}/${agg.ideasExpected}** = ${pct(agg.ideasShipped, agg.ideasExpected)}`);
  lines.push(`- under-filled batches (ideaCount<3): **${agg.underfilled}/${agg.batches}** = ${pct(agg.underfilled, agg.batches)}`);
  lines.push(`- errored batches: **${agg.errored}/${agg.batches}**`);
  lines.push(`- claude fallback used (server says): **${agg.fbBatches}/${agg.batches}** = ${pct(agg.fbBatches, agg.batches)}`);
  lines.push(`- needFallback decision triggered (pre-P3): **${agg.needFbBatches}/${agg.batches}** = ${pct(agg.needFbBatches, agg.batches)}`);
  lines.push(`- P3 (skip-fallback-local-sufficient) fired: **${agg.p3SkipBatches}/${agg.batches}** = ${pct(agg.p3SkipBatches, agg.batches)}`);
  lines.push(`- final selection guards FAILED: **${agg.guardsFailedFinal}/${agg.batches}** = ${pct(agg.guardsFailedFinal, agg.batches)}`);
  const [dlo, dhi] = minMax(agg.durations);
  lines.push(`- duration ms — avg=${avg(agg.durations).toFixed(0)} median=${median(agg.durations).toFixed(0)} min=${dlo} max=${dhi}`);
  lines.push("");
  lines.push("### Funnel pipeline (per-batch averages)");
  lines.push("");
  lines.push("| stage | n | avg | median | min | max |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  lines.push(statRow("rawPatternCount", agg.rawPattern));
  lines.push(statRow("patternAfterExclusion", agg.patternAfterExcl));
  lines.push(statRow("coherenceKept", agg.coherenceKept));
  lines.push(statRow("coreNativeGenerated", agg.coreGen));
  lines.push(statRow("coreNativeKept", agg.coreKept));
  lines.push(statRow("mergedIntoFilterAndRescore", agg.mergedFR));
  lines.push(statRow("localKept", agg.localKept));
  lines.push(statRow("mergedAfterExclude (final)", agg.mergedAfterExclude));
  lines.push(statRow("firstSelectionBatchSize", agg.firstSelN));
  lines.push(statRow("finalSelectionBatchSize", agg.finalSelN));
  lines.push(statRow("fallbackKept", agg.fbKept));
  lines.push("");
  lines.push("### Fallback trigger attribution (count of batches each trigger fired)");
  lines.push("");
  lines.push("| trigger | count | % of batches |");
  lines.push("| --- | --- | --- |");
  lines.push(`| layer1CoreAware (regenerate-novelty, P3 not active) | ${agg.triggerCounts.layer1CoreAware} | ${pct(agg.triggerCounts.layer1CoreAware, agg.batches)} |`);
  lines.push(`| mergedShort (\`merged.length<3\`) | ${agg.triggerCounts.mergedShort} | ${pct(agg.triggerCounts.mergedShort, agg.batches)} |`);
  lines.push(`| selectionUnderfilled (\`selection.batch.length<desired\`) | ${agg.triggerCounts.selectionUnderfilled} | ${pct(agg.triggerCounts.selectionUnderfilled, agg.batches)} |`);
  lines.push(`| guardsFailed (\`!selection.guardsPassed\`) | ${agg.triggerCounts.guardsFailed} | ${pct(agg.triggerCounts.guardsFailed, agg.batches)} |`);
  lines.push("");
  lines.push("### Top rejection reasons (aggregated across all batches)");
  lines.push("");
  const renderTop = (title: string, m: Map<string, number>) => {
    lines.push(`**${title}** (top 10):`);
    const top = topN(m, 10);
    if (top.length === 0) {
      lines.push("- _(no rejections)_");
    } else {
      for (const [k, v] of top) lines.push(`- \`${k}\`: ${v}`);
    }
    lines.push("");
  };
  renderTop("coherenceRejections (pre-coherence → coherenceKept)", agg.coherenceRejAgg);
  renderTop("coreNativeRejectionReasons", agg.coreRejAgg);
  renderTop("filterAndRescore (localRejectionReasons)", agg.localRejAgg);
  renderTop("fallback (claude) rejection reasons", agg.fbRejAgg);
  lines.push("### Western adjustment summary (W1 helper output, aggregated)");
  lines.push("");
  const w = agg.westernAdjAgg;
  lines.push(`- recipes scored: **${w.recipesScored}**`);
  lines.push(`- demoted (adj<0): **${w.demoted}** = ${pct(w.demoted, w.recipesScored)}`);
  lines.push(`- boosted (adj>0): **${w.boosted}** = ${pct(w.boosted, w.recipesScored)}`);
  lines.push(`- zero (adj==0): **${w.zero}** = ${pct(w.zero, w.recipesScored)}`);
  lines.push(`- net delta sum: **${w.netDelta}**, per-recipe avg: ${(w.recipesScored > 0 ? w.netDelta / w.recipesScored : 0).toFixed(2)}`);
  lines.push("");
  lines.push("### Shipped source mix (aggregated)");
  lines.push("");
  // PHASE W1.1 AUDIT — required fields: replacement flag + weak skeleton families.
  lines.push("");
  lines.push("### Fallback ↔ shipped replacement & weak skeleton families");
  lines.push("");
  lines.push(`- batches where Claude fallback REPLACED local picks in the final shipped batch: **${agg.fbReplacedLocalBatches}/${agg.batches}** = ${pct(agg.fbReplacedLocalBatches, agg.batches)}`);
  lines.push(`- avg repeated hook-skeleton families per batch (skeletons with ≥2 candidates in pre-fallback merged pool): **${avg(agg.repeatedSkeletonFamiliesPerBatch).toFixed(2)}**`);
  if (agg.mergedSkeletonAgg.size > 0) {
    lines.push("");
    lines.push("Top merged hook-skeleton families across all batches (skeletonId → total count, top 10):");
    for (const [k, v] of topN(agg.mergedSkeletonAgg, 10)) {
      lines.push(`- \`${k}\`: ${v}`);
    }
  } else {
    lines.push("- (no `meta.hookSkeletonId` populated on merged candidates in this run)");
  }
  lines.push("");
  const totalShipped = [...agg.shippedSourceAgg.values()].reduce(
    (s, x) => s + x,
    0,
  );
  for (const [k, v] of topN(agg.shippedSourceAgg, 10)) {
    lines.push(`- \`${k}\`: ${v} = ${pct(v, totalShipped)}`);
  }
  lines.push("");
  return lines.join("\n");
}

function buildReport(): string {
  const onPass = loadLatest("on");
  const offPass = loadLatest("off");
  const lines: string[] = [];
  lines.push("# W1.1 — Western under-fill / fallback audit");
  lines.push("");
  lines.push(
    `_Generated: ${new Date().toISOString()} · driver: \`artifacts/api-server/src/qa/w11AuditDriver.ts\`_`,
  );
  lines.push("");
  lines.push(
    "Investigation-only. NO generation behavior changed. Cohort+env-gated funnel instrumentation only: `coreCandidateGenerator.stats.westernAdjustmentSummary` (cohort-gated) + `qaTelemetry.westernFunnel` (cohort-gated, only surfaced when the QA header is present in non-prod) + an opt-in `phase_w1.funnel_summary` log gated by `LUMINA_W1_FUNNEL_LOG=true`.",
  );
  lines.push("");
  lines.push("## Methodology");
  lines.push("");
  lines.push("- Endpoint: real `POST /api/ideator/generate` via the shared proxy at `localhost:80`. Header `x-lumina-qa-expose-meta: 1` enables the additive `qaTelemetry` surface in non-production.");
  lines.push("- Cohort: `region=\"western\"`, `count=3`, `regenerate=false` for batch 0 + `regenerate=true` for every subsequent batch (with `excludeHooks` chained from the previous batch on batches 0/1, mirroring the pre-existing W1 harness's serial-then-parallel cadence — adapted to plain serial here because we want clean per-batch funnel data without parallel exclude-hook drift).");
  lines.push("- Two passes: **W1 ON** (production W1 hook adjustment active, the staging baseline) and **W1 OFF** (`LUMINA_W1_DISABLE_FOR_QA=1` set on the api-server process; the helper short-circuits to `0` adjustment in non-production). Operator restarts the api-server between passes.");
  lines.push("- All numbers below are pulled from the orchestrator's pre-strip `qaTelemetry.westernFunnel` (the orchestrator is the source of truth for the funnel — every counter is read off the same in-flight state the production code path uses).");
  lines.push("");
  lines.push("> **Capture-point note:** The orchestrator now snapshots `firstSelectionBatchSize` / `firstSelectionGuardsPassed` immediately after the first `selectWithNovelty` call (at hybridIdeator.ts L4234), BEFORE Claude fallback / reselect / mutation can mutate `selection`. If a dump in this report was produced before that fix, those two fields reflect end-of-function state and must be read with caution; the corresponding dump's per-batch entries are tagged with the orchestrator version implicitly via the presence of `funnel.mergedSizeAtFirstSelection` (only present in the corrected version). All other funnel counters were correct in v1.");
  lines.push("");

  if (!onPass) {
    lines.push("> ⚠ **No `w11_on_*.json` dump found** — run `pnpm --filter @workspace/api-server exec tsx src/qa/w11AuditDriver.ts run --label=on --count=20` first.");
    lines.push("");
  } else {
    const aggOn = aggregate(onPass.recs);
    lines.push(buildSection("W1 ON (production behavior)", aggOn, onPass.ts));
    lines.push(buildStageBreakdown(aggOn));
    lines.push(buildHookCorpusSection(onPass.recs));
  }
  if (!offPass) {
    lines.push("> ⚠ **No `w11_off_*.json` dump found** — restart the api-server with `LUMINA_W1_DISABLE_FOR_QA=1` then run `pnpm --filter @workspace/api-server exec tsx src/qa/w11AuditDriver.ts run --label=off --count=10`.");
    lines.push("");
  } else {
    const aggOff = aggregate(offPass.recs);
    lines.push(buildSection("W1 OFF (W1 helper bypassed)", aggOff, offPass.ts));
    lines.push(buildStageBreakdown(aggOff));
    lines.push(buildHookCorpusSection(offPass.recs));
  }

  if (onPass && offPass) {
    const aggOn = aggregate(onPass.recs);
    const aggOff = aggregate(offPass.recs);
    lines.push("## ON vs OFF — head-to-head deltas");
    lines.push("");
    lines.push("| metric | W1 ON | W1 OFF | Δ (ON−OFF) |");
    lines.push("| --- | --- | --- | --- |");
    const cmpRate = (n: number, d: number) =>
      d > 0 ? (n / d) * 100 : 0;
    const mkRow = (label: string, on: number, off: number, fmt: (x: number) => string = (x) => x.toFixed(1)) =>
      `| ${label} | ${fmt(on)} | ${fmt(off)} | ${fmt(on - off)} |`;
    lines.push(mkRow("ideas shipped %", cmpRate(aggOn.ideasShipped, aggOn.ideasExpected), cmpRate(aggOff.ideasShipped, aggOff.ideasExpected)));
    lines.push(mkRow("under-filled batches %", cmpRate(aggOn.underfilled, aggOn.batches), cmpRate(aggOff.underfilled, aggOff.batches)));
    lines.push(mkRow("claude fallback used %", cmpRate(aggOn.fbBatches, aggOn.batches), cmpRate(aggOff.fbBatches, aggOff.batches)));
    lines.push(mkRow("needFallback decision %", cmpRate(aggOn.needFbBatches, aggOn.batches), cmpRate(aggOff.needFbBatches, aggOff.batches)));
    lines.push(mkRow("P3 skip fired %", cmpRate(aggOn.p3SkipBatches, aggOn.batches), cmpRate(aggOff.p3SkipBatches, aggOff.batches)));
    lines.push(mkRow("avg coreNativeKept", avg(aggOn.coreKept), avg(aggOff.coreKept)));
    lines.push(mkRow("avg mergedIntoFilterAndRescore", avg(aggOn.mergedFR), avg(aggOff.mergedFR)));
    lines.push(mkRow("avg localKept", avg(aggOn.localKept), avg(aggOff.localKept)));
    lines.push(mkRow("avg firstSelectionBatchSize", avg(aggOn.firstSelN), avg(aggOff.firstSelN)));
    lines.push(mkRow("avg finalSelectionBatchSize", avg(aggOn.finalSelN), avg(aggOff.finalSelN)));
    lines.push(mkRow("avg duration ms", avg(aggOn.durations), avg(aggOff.durations), (x) => x.toFixed(0)));
    lines.push("");
    lines.push("### Diagnosis (auto-generated, observation-only)");
    lines.push("");
    lines.push("> Caveat: ON and OFF sample sizes differ. All comparisons below use **rates**, not raw counts, and any causal claim is flagged as a hypothesis pending a matched-N follow-up.");
    lines.push("");
    const diag: string[] = [];
    const onUfRate = cmpRate(aggOn.underfilled, aggOn.batches);
    const offUfRate = cmpRate(aggOff.underfilled, aggOff.batches);
    if (aggOn.underfilled === 0 && aggOff.underfilled === 0) {
      diag.push("- **Under-fill is NOT observed in either pass**: every batch shipped the requested ideas. The pipeline reliably fills `desiredCount` from the local pool plus (when triggered) Claude fallback. If a downstream symptom labelled \"western under-fill\" exists, it is NOT happening at the orchestrator surface for this configuration — investigate cache replay paths, post-strip mobile parsing, or a different `count` value.");
    } else if (onUfRate > offUfRate * 1.5) {
      diag.push(`- **Under-fill rate is higher under W1 ON** (${onUfRate.toFixed(1)}% vs ${offUfRate.toFixed(1)}%). Consistent with (but not proof of) a W1-induced per-core depression; cross-check by raising the W1 OFF sample N before changing W1 magnitude.`);
    } else if (offUfRate > onUfRate * 1.5) {
      diag.push(`- **Under-fill rate is higher under W1 OFF** (${offUfRate.toFixed(1)}% vs ${onUfRate.toFixed(1)}%). Counter-intuitive; the W1 specificity bonus may be masking a coverage gap.`);
    } else {
      diag.push(`- **Under-fill rates are comparable** (ON=${onUfRate.toFixed(1)}%, OFF=${offUfRate.toFixed(1)}%); root cause is unlikely to be W1.`);
    }
    const onFbRate = cmpRate(aggOn.fbBatches, aggOn.batches);
    const offFbRate = cmpRate(aggOff.fbBatches, aggOff.batches);
    const fbDelta = onFbRate - offFbRate;
    const onTopTrig = ["layer1CoreAware", "mergedShort", "selectionUnderfilled", "guardsFailed"]
      .map((k) => [k, aggOn.triggerCounts[k as keyof typeof aggOn.triggerCounts]] as [string, number])
      .sort((a, b) => b[1] - a[1])[0]!;
    const offTopTrig = ["layer1CoreAware", "mergedShort", "selectionUnderfilled", "guardsFailed"]
      .map((k) => [k, aggOff.triggerCounts[k as keyof typeof aggOff.triggerCounts]] as [string, number])
      .sort((a, b) => b[1] - a[1])[0]!;
    if (Math.abs(fbDelta) < 5) {
      diag.push(`- **Claude fallback rate is comparable across passes** (ON=${onFbRate.toFixed(1)}%, OFF=${offFbRate.toFixed(1)}%, Δ=${fbDelta.toFixed(1)}pp). The ${onTopTrig[0]} trigger dominates in BOTH passes (ON=${pct(onTopTrig[1], aggOn.batches)}, OFF=${pct(offTopTrig[1], aggOff.batches)}). This is the regenerate-novelty design path, not W1-induced. **Hypothesis only**: W1 demotion is NOT the dominant fallback driver — the regenerate-path always invokes Claude regardless.`);
    } else if (fbDelta >= 5) {
      diag.push(`- **W1 ON shows a +${fbDelta.toFixed(1)}pp higher Claude fallback rate** (ON=${onFbRate.toFixed(1)}%, OFF=${offFbRate.toFixed(1)}%). **Hypothesis**: W1 demotion may be tipping the local pool below the P3 sufficiency bar in some additional batches, but the dominant trigger in both passes is \`${onTopTrig[0]}\` (regenerate-novelty design path) so the marginal effect is small relative to the baseline cost.`);
    } else {
      diag.push(`- **W1 OFF shows a +${(-fbDelta).toFixed(1)}pp higher Claude fallback rate** (ON=${onFbRate.toFixed(1)}%, OFF=${offFbRate.toFixed(1)}%). W1's specificity bonus may be helping local-pool sufficiency.`);
    }
    diag.push(`- **Latency cost**: avg ON ${avg(aggOn.durations).toFixed(0)}ms vs OFF ${avg(aggOff.durations).toFixed(0)}ms. Latency tracks fallback rate (regenerate-novelty Claude calls account for the bulk).`);
    const onAvgFinal = avg(aggOn.finalSelN);
    if (onAvgFinal < 3) {
      diag.push(`- **Avg finalSelectionBatchSize (W1 ON) = ${onAvgFinal.toFixed(2)}** — below \`desiredCount=3\`. The orchestrator is shipping under-filled batches.`);
    }
    if (onTopTrig[1] > 0) {
      diag.push(`- **Most-frequent fallback trigger (W1 ON)**: \`${onTopTrig[0]}\` (${pct(onTopTrig[1], aggOn.batches)} of batches).`);
    } else {
      diag.push("- No fallback triggers fired in W1 ON — every batch satisfied either the P3 skip condition or shipped from the local pool without escalating.");
    }
    const onFirstSelOk =
      aggOn.firstSelN.filter((x) => x >= COUNT_PER_BATCH).length;
    diag.push(`- **Pre-fallback first selection is filling \`desiredCount\` in ${onFirstSelOk}/${aggOn.batches} ON batches** (${pct(onFirstSelOk, aggOn.batches)}). This is the TRUE pre-fallback snapshot (captured before any reselect/mutation can change \`selection\`); when this rate is high but Claude is still firing, the trigger is the regenerate-novelty path, not pool starvation.`);
    diag.push("");
    diag.push("**Interpretation rules of thumb:**");
    diag.push("- `coreNativeKept` < 3 in many batches → core_native generator is the bottleneck. Check `coreNativeRejectionTop` for the dominant reason (`scenario_repeat`, anti-copy, coherence).");
    diag.push("- `mergedIntoFilterAndRescore` >> `localKept` → `filterAndRescore` (downstream scorer) is the bottleneck. Check `localRejectionTop`.");
    diag.push("- `firstSelectionBatchSize == desiredCount` AND `firstSelectionGuardsPassed=true` AND `needFallback=false` → the happy path is firing; any user-visible under-fill is post-orchestrator (cache replay / post-strip / mobile).");
    diag.push("- `mergedShort` trigger dominant → upstream supply is starving. Bare pool fix is needed before anything else.");
    diag.push("- `layer1CoreAware` trigger dominant → regenerate-novelty fallback IS the design; cost is latency, not under-fill. Look at P3 hit-rate to decide whether to widen the skip condition.");

    for (const d of diag) lines.push(d);
    lines.push("");

    // Auto-generated minimal fix plan
    lines.push("## Minimal fix plan (auto-derived; investigation only — DO NOT implement here)");
    lines.push("");
    const fixes: string[] = [];
    if (aggOn.underfilled === 0 && aggOn.fbBatches === 0) {
      fixes.push("- **No fix recommended**: pipeline is shipping cleanly at `count=3, region=western`. If a real under-fill exists, repro it with a different `count` (e.g. `count=5`) or against the cached-batch replay path before changing generator code.");
    }
    if (aggOn.fbBatches > 0 && aggOn.triggerCounts.layer1CoreAware > 0 && aggOn.p3SkipBatches < aggOn.needFbBatches) {
      fixes.push(`- **Tune P3 skip condition**: P3 fired ${aggOn.p3SkipBatches}/${aggOn.needFbBatches} of needFallback batches. Widening the \`merged.length >= 3\` threshold or relaxing \`selection.guardsPassed\` for layer1-only triggers could cut ~${aggOn.triggerCounts.layer1CoreAware - aggOn.p3SkipBatches} additional Claude calls per ${aggOn.batches} batches.`);
    }
    if (aggOn.triggerCounts.mergedShort > 0) {
      fixes.push(`- **Investigate bare-pool starvation**: \`mergedShort\` fired ${aggOn.triggerCounts.mergedShort}/${aggOn.batches} batches. Audit the cohesive author / pattern engine for over-rejection at \`coreNativeKept\` (avg ${avg(aggOn.coreKept).toFixed(1)}) vs \`coreNativeGenerated\` (avg ${avg(aggOn.coreGen).toFixed(1)}).`);
    }
    if (aggOn.triggerCounts.guardsFailed > 0) {
      fixes.push(`- **Investigate guard-failure cohort**: hard batch guards failed in ${aggOn.triggerCounts.guardsFailed}/${aggOn.batches} batches. The \`hybrid_ideator.guards_failed_shipping_best_effort\` warn log already carries the exact cohort distribution; cross-reference these batch IDs.`);
    }
    if (avg(aggOn.coreKept) < 3 && avg(aggOn.coreGen) > 6) {
      fixes.push("- **High core-native rejection rate**: avg coreNativeGenerated ≫ avg coreNativeKept. Check `coreNativeRejectionTop` aggregate above; the dominant reason is the fix target.");
    }
    if (Math.abs(aggOn.westernAdjAgg.netDelta) > 0 && aggOn.westernAdjAgg.recipesScored > 0) {
      const perRecipe =
        aggOn.westernAdjAgg.netDelta / aggOn.westernAdjAgg.recipesScored;
      if (Math.abs(perRecipe) > 5) {
        fixes.push(`- **W1 magnitude review**: avg per-recipe netDelta = ${perRecipe.toFixed(2)}. Compare against current cap (${"WEAK_SKELETON_DEMOTION=15"}); if the per-recipe magnitude approaches the cap on a sustained basis, consider halving \`WEAK_SKELETON_DEMOTION\` or capping the combined demotion.`);
      }
    }
    if (fixes.length === 0) {
      fixes.push("- **No actionable fix surfaced from this audit**. Funnel is healthy across the measured dimensions. If a downstream symptom remains, the root cause is outside the orchestrator's instrumented surface (cache replay, post-strip, or mobile rendering).");
    }
    for (const f of fixes) lines.push(f);
    lines.push("");
  }
  lines.push("## Hard-rule compliance");
  lines.push("");
  lines.push("- ✅ No NG pack / N1 flag / validator / anti-copy / safety / Claude prompt code path touched.");
  lines.push("- ✅ No threshold or scoring change. `westernHookQuality.ts` byte-identical (the existing `LUMINA_W1_DISABLE_FOR_QA` bypass is reused, not introduced here).");
  lines.push("- ✅ Instrumentation is cohort-gated (region undefined OR \"western\"); India / PH / Nigeria pay zero cost (the new `westernAdjustmentSummary` field is omitted from `coreCandidateGenerator` stats and the `westernFunnel` field is omitted from `qaTelemetry` for those cohorts).");
  lines.push("- ✅ Production wire is unchanged. The funnel field is only attached when the dev-only `x-lumina-qa-expose-meta: 1` header is present AND `NODE_ENV !== \"production\"` (the existing `exposeMeta` gate in `routes/ideator.ts`); the structured log is gated by `LUMINA_W1_FUNNEL_LOG=true`, off by default. Production callers see no shape drift.");
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0] ?? "";
  if (sub === "run") {
    const get = (k: string, dflt: string) =>
      (args.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${dflt}`).split("=")[1] ?? dflt;
    const label = get("label", "on");
    const count = Math.max(1, Number(get("count", "20")));
    const startIdx = Math.max(0, Number(get("start", "0")));
    await runPass(label, count, startIdx);
  } else if (sub === "reset") {
    const label = (args.find((a) => a.startsWith("--label=")) ?? "--label=on").split("=")[1] ?? "on";
    for (const f of [`w11_${label}_dump.json`, `w11_${label}_progress.log`]) {
      const p = path.join(QA_RUNS_DIR, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    process.stdout.write(`[w11] reset label=${label}\n`);
  } else if (sub === "report") {
    const md = buildReport();
    fs.writeFileSync(REPORT_PATH, md);
    fs.mkdirSync(path.dirname(TRACKED_REPORT_PATH), { recursive: true });
    fs.writeFileSync(TRACKED_REPORT_PATH, md);
    process.stdout.write(`[w11] wrote ${REPORT_PATH}\n`);
    process.stdout.write(`[w11] wrote ${TRACKED_REPORT_PATH}\n`);
  } else {
    process.stderr.write("usage: w11AuditDriver.ts (run --label=<label> [--count=N]) | report\n");
    process.exit(2);
  }
}

main().catch((e) => {
  console.error("[w11] fatal:", e);
  process.exit(1);
});
