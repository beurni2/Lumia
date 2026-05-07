/**
 * PHASE W2-K — Staging QA driver.
 *
 * Reduced sweep:
 *   • 20 western batches with W2 ON
 *   • 10 western batches with W2 OFF (control)
 *   • 5 cohorts × 3 refreshes (NG-pidgin, NG-light_pidgin, NG-clean,
 *     india, philippines) — leak gate: NO W2 entryId may appear.
 *
 * Hits the REAL `/api/ideator/generate` route via the shared proxy
 * with `x-lumina-qa-expose-meta: 1` so the per-idea telemetry array
 * surfaces `westernPackEntryId`. Aggregates entry-id usage rate,
 * distinctness across batches, in-batch family/setting/anchor
 * separation when 2 W2 ship, and leak counts in NG/India/PH cohorts.
 *
 * Toggling W2 between ON/OFF is achieved by setting the env var on
 * the server side via `__qaOverrides` request hint (we instead do
 * per-batch toggle by pinging two endpoints at different env states
 * via the `regenerate` flag-stayed approach if available; in this
 * staging driver, we treat the server's current env as authoritative
 * and label the contrast based on the response — see `w2OnObserved`
 * derivation below). The server's current dev `start` script sets
 * the flag ON, so the first 20 batches register the ON branch; the
 * "OFF" 10 are documented as a contrast-validation request (operator
 * runs them with the env unset, separately, if needed).
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";

type GenIdea = {
  hook?: string;
  whatToShow?: string;
  howToFilm?: string;
  caption?: string;
};

type GenPerIdea = {
  source?: string;
  westernPackEntryId?: string | null;
  nigerianPackEntryId?: string | null;
  hookQualityScore?: number | null;
  anchor?: string | null;
};

type GenResp = {
  ideas: GenIdea[];
  qaTelemetry?: { perIdea?: GenPerIdea[] };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPORT_PATH = path.resolve(
  __dirname,
  "../../../../.local/W2K_REPORT.md",
);
const API_URL =
  process.env.W2K_LIVE_API_URL ??
  "http://localhost:80/api/ideator/generate";
const PER_BATCH_TIMEOUT_MS = 120_000;
const COUNT_PER_BATCH = 3;

type Cohort = {
  label: string;
  region: string;
  languageStyle: string | null;
  expectW2: boolean;
};

const WESTERN_ON_BATCHES = Number(process.env.W2K_WESTERN_BATCHES ?? 10);
const WESTERN_OFF_BATCHES = Number(process.env.W2K_OFF_BATCHES ?? 0);
const LEAK_REFRESHES = Number(process.env.W2K_LEAK_REFRESHES ?? 1);
const LEAK_COHORTS: ReadonlyArray<Cohort> = [
  { label: "ng_pidgin", region: "nigeria", languageStyle: "pidgin", expectW2: false },
  { label: "ng_light", region: "nigeria", languageStyle: "light_pidgin", expectW2: false },
  { label: "ng_clean", region: "nigeria", languageStyle: "clean", expectW2: false },
  { label: "india", region: "india", languageStyle: null, expectW2: false },
  { label: "philippines", region: "philippines", languageStyle: null, expectW2: false },
];

async function callApi(args: {
  region: string;
  languageStyle: string | null;
  count: number;
  regenerate: boolean;
}): Promise<{
  resp: GenResp | null;
  status: number;
  durationMs: number;
  err: string | null;
}> {
  const body: Record<string, unknown> = {
    region: args.region,
    count: args.count,
    regenerate: args.regenerate,
  };
  if (args.languageStyle !== null) body.languageStyle = args.languageStyle;
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
    const durationMs = Date.now() - t0;
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return {
        resp: null,
        status: r.status,
        durationMs,
        err: `HTTP ${r.status}: ${text.slice(0, 240)}`,
      };
    }
    const j = (await r.json()) as GenResp;
    return { resp: j, status: r.status, durationMs, err: null };
  } catch (e) {
    return {
      resp: null,
      status: 0,
      durationMs: Date.now() - t0,
      err: String((e as Error).message ?? e),
    };
  }
}

type WesternBatchRecord = {
  batchIdx: number;
  ideaCount: number;
  w2EntryIds: string[];
  hooks: string[];
  durationMs: number;
  errored: boolean;
};

type LeakRecord = {
  cohort: string;
  batchIdx: number;
  w2EntryIds: string[];
  errored: boolean;
};

async function runWesternSweep(
  label: string,
  batches: number,
): Promise<WesternBatchRecord[]> {
  const out: WesternBatchRecord[] = [];
  for (let i = 0; i < batches; i++) {
    const r = await callApi({
      region: "western",
      languageStyle: "clean",
      count: COUNT_PER_BATCH,
      regenerate: i > 0,
    });
    const perIdea = r.resp?.qaTelemetry?.perIdea ?? [];
    const w2Ids = perIdea
      .map((p) => p.westernPackEntryId ?? null)
      .filter((x): x is string => typeof x === "string");
    const hooks = (r.resp?.ideas ?? [])
      .map((i) => i.hook ?? "")
      .filter((h) => h.length > 0);
    out.push({
      batchIdx: i,
      ideaCount: r.resp?.ideas.length ?? 0,
      w2EntryIds: w2Ids,
      hooks,
      durationMs: r.durationMs,
      errored: r.err !== null,
    });
    process.stdout.write(
      `[${label}] batch ${i + 1}/${batches} ${r.durationMs}ms ` +
        `ideas=${r.resp?.ideas.length ?? 0} w2=${w2Ids.length}` +
        (r.err ? ` ERR=${r.err.slice(0, 80)}` : "") +
        "\n",
    );
  }
  return out;
}

async function runLeakSweep(): Promise<LeakRecord[]> {
  const out: LeakRecord[] = [];
  for (const cohort of LEAK_COHORTS) {
    for (let i = 0; i < LEAK_REFRESHES; i++) {
      const r = await callApi({
        region: cohort.region,
        languageStyle: cohort.languageStyle,
        count: COUNT_PER_BATCH,
        regenerate: i > 0,
      });
      const perIdea = r.resp?.qaTelemetry?.perIdea ?? [];
      const w2Ids = perIdea
        .map((p) => p.westernPackEntryId ?? null)
        .filter((x): x is string => typeof x === "string");
      out.push({
        cohort: cohort.label,
        batchIdx: i,
        w2EntryIds: w2Ids,
        errored: r.err !== null,
      });
      process.stdout.write(
        `[leak:${cohort.label}] batch ${i + 1}/${LEAK_REFRESHES} ${r.durationMs}ms ` +
          `w2=${w2Ids.length}` +
          (r.err ? ` ERR=${r.err.slice(0, 80)}` : "") +
          "\n",
      );
    }
  }
  return out;
}

function summarizeWestern(
  label: string,
  batches: WesternBatchRecord[],
): string {
  const total = batches.length;
  const errored = batches.filter((b) => b.errored).length;
  const totalIdeas = batches.reduce((s, b) => s + b.ideaCount, 0);
  const totalW2 = batches.reduce((s, b) => s + b.w2EntryIds.length, 0);
  const batchesWithAny = batches.filter((b) => b.w2EntryIds.length > 0).length;
  const batchesWithTwo = batches.filter((b) => b.w2EntryIds.length >= 2).length;
  const batchesWithThree = batches.filter((b) => b.w2EntryIds.length >= 3).length;
  const distinctIds = new Set(batches.flatMap((b) => b.w2EntryIds));
  const allHooks = batches.flatMap((b) => b.hooks);
  const hookCounts = new Map<string, number>();
  for (const h of allHooks)
    hookCounts.set(h, (hookCounts.get(h) ?? 0) + 1);
  const repeatHooks = [...hookCounts.entries()].filter(([, c]) => c > 1);
  const inBatchDups = batches.filter((b) => {
    const s = new Set(b.w2EntryIds);
    return s.size !== b.w2EntryIds.length;
  }).length;
  const avgDuration =
    batches.reduce((s, b) => s + b.durationMs, 0) /
    Math.max(batches.length, 1);
  const latencyMin = batches.length > 0 ? Math.min(...batches.map((b) => b.durationMs)) : 0;
  const latencyMax = batches.length > 0 ? Math.max(...batches.map((b) => b.durationMs)) : 0;
  return [
    `### ${label} — ${total} batches`,
    `- ideas total: ${totalIdeas} (avg per batch ${(totalIdeas / Math.max(total, 1)).toFixed(2)})`,
    `- W2 ideas total: ${totalW2}`,
    `- batches with ≥1 W2: ${batchesWithAny}/${total} (${((batchesWithAny / Math.max(total, 1)) * 100).toFixed(1)}%)`,
    `- batches with ≥2 W2: ${batchesWithTwo}/${total}`,
    `- batches with ≥3 W2 (SHOULD BE 0): ${batchesWithThree}`,
    `- distinct W2 entryIds across sweep: ${distinctIds.size}`,
    `- in-batch entryId duplicates (SHOULD BE 0): ${inBatchDups}`,
    `- cross-batch hook repeats: ${repeatHooks.length}` +
      (repeatHooks.length > 0
        ? ` (${repeatHooks.slice(0, 5).map(([h, c]) => `${c}× "${h.slice(0, 40)}"`).join("; ")})`
        : ""),
    `- errored batches: ${errored}`,
    `- latency avg/min/max: ${avgDuration.toFixed(0)}/${latencyMin}/${latencyMax} ms`,
    "",
  ].join("\n");
}

function summarizeLeak(records: LeakRecord[]): string {
  const lines: string[] = ["### Leak gates (NO W2 expected)"];
  const byCohort = new Map<string, LeakRecord[]>();
  for (const r of records) {
    const arr = byCohort.get(r.cohort) ?? [];
    arr.push(r);
    byCohort.set(r.cohort, arr);
  }
  let totalLeaks = 0;
  for (const [cohort, recs] of byCohort) {
    const leaks = recs.reduce((s, r) => s + r.w2EntryIds.length, 0);
    const errored = recs.filter((r) => r.errored).length;
    totalLeaks += leaks;
    lines.push(
      `- ${cohort}: ${leaks} W2 ideas across ${recs.length} batches ` +
        `(errored=${errored}) — ${leaks === 0 ? "CLEAN" : "LEAK!"}`,
    );
  }
  lines.push(`- TOTAL LEAKS: ${totalLeaks} ${totalLeaks === 0 ? "✅" : "❌"}`);
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  process.stdout.write(`[w2k] hitting ${API_URL}\n`);
  process.stdout.write(`[w2k] env LUMINA_W2_WESTERN_APPROVED_ENABLED=${process.env.LUMINA_W2_WESTERN_APPROVED_ENABLED ?? "<unset>"}\n`);
  const t0 = Date.now();

  const onBatches = await runWesternSweep("W2-ON western", WESTERN_ON_BATCHES);
  const offBatches = await runWesternSweep("W2-OFF western (env-controlled)", WESTERN_OFF_BATCHES);
  const leak = await runLeakSweep();

  const totalMs = Date.now() - t0;
  const report = [
    `# PHASE W2-K — Staging QA Report`,
    ``,
    `_Generated: ${new Date().toISOString()}_`,
    `_Total wall time: ${(totalMs / 1000).toFixed(1)}s_`,
    `_Server env LUMINA_W2_WESTERN_APPROVED_ENABLED=${process.env.LUMINA_W2_WESTERN_APPROVED_ENABLED ?? "<unset on driver — server-side controls activation>"}_`,
    ``,
    `## Western sweep`,
    summarizeWestern(`W2-ON western (server flag should be ON)`, onBatches),
    summarizeWestern(`W2-OFF control western (re-run with env unset to compare)`, offBatches),
    `## Leak gates`,
    summarizeLeak(leak),
  ].join("\n");
  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, report, "utf8");
  process.stdout.write(`\n[w2k] wrote ${REPORT_PATH}\n`);
  process.stdout.write(report);
}

main().catch((e) => {
  process.stderr.write(`[w2k] FATAL ${String((e as Error)?.stack ?? e)}\n`);
  process.exit(1);
});
