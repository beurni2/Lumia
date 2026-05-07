/**
 * PHASE W1 — Western Catalog Hook Quality live QA harness.
 *
 * Calls the REAL `/api/ideator/generate` route, captures pre-strip
 * `qaTelemetry` (set via the `x-lumina-qa-expose-meta: 1` header), and
 * appends a measurement section to `.local/W1_REPORT.md`.
 *
 * Cohorts (per task-5):
 *   western/default — 20 batches × 3 = 60 ideas
 *   ng_pidgin       —  5 batches × 3 = 15 ideas (smoke regression)
 *   ng_light_pidgin —  5 batches × 3 = 15 ideas (smoke regression)
 *   india           —  3 batches × 3 =  9 ideas (smoke)
 *   philippines     —  3 batches × 3 =  9 ideas (smoke)
 *
 * Two-pass on western only: a "before" pass with
 * `LUMINA_W1_DISABLE_FOR_QA=1` (env signaled to the server via the
 * `x-lumina-w1-disable: 1` request header IS NOT possible — the bypass
 * is process-env only). Operator must restart the api-server with the
 * env between phases. The harness supports `--phase=before|after|smoke`.
 *
 * Run examples:
 *   # 1. Restart API Server with LUMINA_W1_DISABLE_FOR_QA=1, then:
 *   pnpm --filter @workspace/api-server exec tsx src/qa/w1WesternLiveQa.ts \
 *     --phase=before
 *   # 2. Restart API Server WITHOUT the bypass, then:
 *   pnpm --filter @workspace/api-server exec tsx src/qa/w1WesternLiveQa.ts \
 *     --phase=after
 *   # 3. Smoke regressions (with bypass OFF):
 *   pnpm --filter @workspace/api-server exec tsx src/qa/w1WesternLiveQa.ts \
 *     --phase=smoke
 *
 * Output:
 *   .local/W1_REPORT.md (appended; created if missing)
 *   .local/qa-runs/w1_<phase>_<timestamp>.json (raw idea dump)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  WESTERN_WEAK_SKELETONS,
  classifyWesternWeakSkeletonFamily,
  isGenericWhatToShow,
} from "../lib/westernHookQuality.js";
import { normalizeHookToSkeleton } from "../lib/catalogTemplateCreatorMemory.js";

type Cohort = {
  label: string;
  region: string;
  languageStyle: string | null;
  totalRefreshes: number;
};

type Idea = {
  hook: string;
  whatToShow: string;
  howToFilm: string;
  caption: string;
  pattern?: string;
};

type GenResp = {
  region: string;
  ideas: Idea[];
  qaTelemetry?: {
    perIdea: Array<{
      source?: string;
      nigerianPackEntryId?: string;
      hookQualityScore?: number;
      anchor?: string;
    }>;
  };
  usedFallback?: boolean;
  counts?: { localKept: number; fallbackKept: number };
};

type IdeaRecord = {
  cohort: string;
  batchIdx: number;
  ideaIdx: number;
  hook: string;
  whatToShow: string;
  howToFilm: string;
  caption: string;
  source: string | null;
  packEntryId: string | null;
  hookQualityScore: number | null;
  weakSkeletonFamily: string | null;
  isGenericScenario: boolean;
  hookSkeleton: string;
  westernLeak: string[];
  privacyHits: string[];
};

type BatchRecord = {
  cohort: string;
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
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPORT_PATH = path.resolve(__dirname, "../../../../.local/W1_REPORT.md");
const QA_RUNS_DIR = path.resolve(__dirname, "../../../../.local/qa-runs");
const API_URL = process.env.W1_LIVE_API_URL ?? "http://localhost:80/api/ideator/generate";
const PER_BATCH_TIMEOUT_MS = 120_000;
const COUNT_PER_BATCH = 3;

process.on("unhandledRejection", (e) => {
  process.stderr.write(`[w1QA] unhandledRejection: ${String((e as Error)?.stack ?? e)}\n`);
});
process.on("uncaughtException", (e) => {
  process.stderr.write(`[w1QA] uncaughtException: ${String((e as Error)?.stack ?? e)}\n`);
});

const PRIVACY_FAIL_RE: readonly RegExp[] = [
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\b\d{4}\s\d{4}\s\d{4}\s\d{4}\b/,
  /\bbalance:\s*\$?\d{4,}\b/i,
  /\bpassword[:=]\s*\S+/i,
];
const NG_LEAK_TERMS = [
  "abeg", "wahala", "oga", "biko", "wetin", "abi", "omo", "naija",
  "9ja", "lagos", "abuja", "ibadan", "danfo", "okada", "jollof",
];
const WESTERN_LEAK_TERMS = [
  "doordash", "venmo", "cashapp", "cash app", "zelle", "trader joe",
  "starbucks", "dunkin", "whole foods", "costco",
];

function detectLeak(text: string, terms: readonly string[]): string[] {
  const lc = text.toLowerCase();
  return terms.filter((t) => lc.includes(t));
}
function detectPrivacy(text: string): string[] {
  const out: string[] = [];
  for (const re of PRIVACY_FAIL_RE) {
    const m = text.match(re);
    if (m) out.push(m[0]);
  }
  return out;
}

async function callApi(args: {
  region: string;
  languageStyle: string | null;
  count: number;
  regenerate: boolean;
  excludeHooks: string[];
}): Promise<{ resp: GenResp | null; status: number; durationMs: number; err: string | null }> {
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
      return { resp: null, status: r.status, durationMs, err: `HTTP ${r.status}: ${text.slice(0, 200)}` };
    }
    const j = (await r.json()) as GenResp;
    return { resp: j, status: r.status, durationMs, err: null };
  } catch (e) {
    const durationMs = Date.now() - t0;
    return { resp: null, status: 0, durationMs, err: String((e as Error).message ?? e) };
  }
}

function classify(cohort: string, batchIdx: number, ideaIdx: number, idea: Idea, qa: GenResp["qaTelemetry"] extends infer T ? T extends { perIdea: Array<infer U> } ? U : never : never | undefined): IdeaRecord {
  const hook = idea.hook ?? "";
  const wts = idea.whatToShow ?? "";
  const allText = [idea.hook, idea.whatToShow, idea.howToFilm, idea.caption].join(" \n ");
  return {
    cohort,
    batchIdx,
    ideaIdx,
    hook,
    whatToShow: wts,
    howToFilm: idea.howToFilm ?? "",
    caption: idea.caption ?? "",
    source: qa?.source ?? null,
    packEntryId: qa?.nigerianPackEntryId ?? null,
    hookQualityScore: qa?.hookQualityScore ?? null,
    weakSkeletonFamily: classifyWesternWeakSkeletonFamily(hook),
    isGenericScenario: isGenericWhatToShow(wts),
    hookSkeleton: normalizeHookToSkeleton(hook),
    westernLeak: detectLeak(allText, WESTERN_LEAK_TERMS),
    privacyHits: detectPrivacy(allText),
  };
}

async function runCohort(cohort: Cohort): Promise<{ ideas: IdeaRecord[]; batches: BatchRecord[] }> {
  const ideas: IdeaRecord[] = [];
  const batches: BatchRecord[] = [];
  let lastHooks: string[] = [];

  function record(bi: number, isRefresh: boolean, r: Awaited<ReturnType<typeof callApi>>): void {
    const ideaCount = r.resp?.ideas.length ?? 0;
    if (r.resp) {
      const tele = r.resp.qaTelemetry;
      for (let i = 0; i < r.resp.ideas.length; i++) {
        ideas.push(classify(cohort.label, bi, i, r.resp.ideas[i], tele?.perIdea?.[i] ?? {}));
      }
    }
    batches.push({
      cohort: cohort.label, batchIdx: bi, isRefresh,
      status: r.status, durationMs: r.durationMs,
      errored: r.err !== null, errorMsg: r.err,
      ideaCount,
      usedFallback: r.resp?.usedFallback ?? null,
      localKept: r.resp?.counts?.localKept ?? null,
      fallbackKept: r.resp?.counts?.fallbackKept ?? null,
    });
    process.stdout.write(`[w1QA] cohort=${cohort.label} batch=${bi + 1}/${cohort.totalRefreshes} ms=${r.durationMs} status=${r.status} ideas=${ideaCount} fb=${r.resp?.usedFallback ?? "?"}${r.err ? ` err=${r.err.slice(0, 80)}` : ""}\n`);
  }

  // Serial batches 0 (initial) and 1 (first refresh w/ exclude) so the
  // creator's per-creator memory + excludeHooks chaining is real-tested.
  for (let bi = 0; bi < Math.min(2, cohort.totalRefreshes); bi++) {
    const isRefresh = bi > 0;
    const r = await callApi({
      region: cohort.region, languageStyle: cohort.languageStyle,
      count: COUNT_PER_BATCH, regenerate: isRefresh, excludeHooks: lastHooks,
    });
    record(bi, isRefresh, r);
    if (r.resp) lastHooks = r.resp.ideas.map((x) => x.hook);
  }

  // Parallelize remaining refresh batches in chunks.
  const CONCURRENCY = 2;
  const remaining: number[] = [];
  for (let bi = 2; bi < cohort.totalRefreshes; bi++) remaining.push(bi);
  while (remaining.length > 0) {
    const chunk = remaining.splice(0, CONCURRENCY);
    const results = await Promise.all(chunk.map((bi) =>
      callApi({
        region: cohort.region, languageStyle: cohort.languageStyle,
        count: COUNT_PER_BATCH, regenerate: true, excludeHooks: [],
      }).then((r) => ({ bi, r })),
    ));
    for (const { bi, r } of results) record(bi, true, r);
  }
  batches.sort((a, b) => a.batchIdx - b.batchIdx);
  ideas.sort((a, b) => a.batchIdx - b.batchIdx || a.ideaIdx - b.ideaIdx);
  return { ideas, batches };
}

function pct(n: number, d: number): string {
  if (d === 0) return "—";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function tally<T>(arr: T[], key: (x: T) => string | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of arr) {
    const k = key(x);
    if (k === null) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function buildWesternSection(phase: "before" | "after", cohortRes: { ideas: IdeaRecord[]; batches: BatchRecord[] }): string {
  const { ideas, batches } = cohortRes;
  const lines: string[] = [];
  lines.push(`### Western/default — \`${phase.toUpperCase()}\` (LUMINA_W1_DISABLE_FOR_QA=${phase === "before" ? "1" : "(unset)"})`);
  lines.push("");
  const refreshOk = batches.filter((b) => !b.errored && b.ideaCount === COUNT_PER_BATCH).length;
  const totalBatches = batches.length;
  const timeouts = batches.filter((b) => b.errored && /timed?\s*out|aborted/i.test(b.errorMsg ?? "")).length;
  const fallbacks = batches.filter((b) => b.usedFallback === true).length;
  lines.push(`- batches: **${totalBatches}**, ideas captured: **${ideas.length}**`);
  lines.push(`- refresh success: **${refreshOk}/${totalBatches}** (${pct(refreshOk, totalBatches)}) — timeouts: ${timeouts}, claude fallback used: ${fallbacks}`);
  const weakHits = ideas.filter((i) => i.weakSkeletonFamily !== null);
  lines.push(`- weak-skeleton hits: **${weakHits.length}/${ideas.length}** = ${pct(weakHits.length, ideas.length)}`);
  const famTally = tally(weakHits, (i) => i.weakSkeletonFamily);
  if (famTally.size > 0) {
    lines.push("- weak-skeleton families:");
    for (const [k, v] of [...famTally.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`  - \`${k}\`: ${v}`);
    }
  }
  // Repeated normalized skeletons (across-batch).
  const skTally = tally(ideas, (i) => (i.hookSkeleton.length > 0 ? i.hookSkeleton : null));
  const repeatedSkeletons = [...skTally.entries()].filter(([, v]) => v >= 2).sort((a, b) => b[1] - a[1]);
  lines.push(`- repeated normalized skeletons (≥2 occurrences): **${repeatedSkeletons.length}** distinct families`);
  if (repeatedSkeletons.length > 0) {
    lines.push("  - top 10:");
    for (const [k, v] of repeatedSkeletons.slice(0, 10)) {
      lines.push(`    - \`${k.slice(0, 80)}\` × ${v}`);
    }
  }
  // Exact hook duplicates.
  const hookTally = tally(ideas, (i) => i.hook.trim().toLowerCase());
  const dupHooks = [...hookTally.entries()].filter(([, v]) => v >= 2).sort((a, b) => b[1] - a[1]);
  lines.push(`- exact-hook duplicates: **${dupHooks.length}** distinct (any hook seen ≥2 times across the run)`);
  if (dupHooks.length > 0) {
    for (const [k, v] of dupHooks.slice(0, 10)) {
      lines.push(`    - "${k.slice(0, 100)}" × ${v}`);
    }
  }
  // Generic-scenario × weak-skeleton combo.
  const genericCombo = ideas.filter((i) => i.weakSkeletonFamily !== null && i.isGenericScenario);
  lines.push(`- weak-skeleton + generic-scenario combo: **${genericCombo.length}/${ideas.length}** = ${pct(genericCombo.length, ideas.length)}`);
  // Privacy / leak.
  const privacy = ideas.filter((i) => i.privacyHits.length > 0);
  const westLeakInWestCohort = ideas.filter((i) => i.westernLeak.length > 0);
  lines.push(`- privacy hits: **${privacy.length}** (must be 0)`);
  lines.push(`- western-brand mentions in western cohort (informational, not a fail): ${westLeakInWestCohort.length}`);
  // Quality score distribution.
  const scores = ideas.map((i) => i.hookQualityScore).filter((s): s is number => s !== null);
  if (scores.length > 0) {
    const sorted = [...scores].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const avg = scores.reduce((s, x) => s + x, 0) / scores.length;
    lines.push(`- hookQualityScore: min=${min.toFixed(1)} median=${median.toFixed(1)} avg=${avg.toFixed(1)} max=${max.toFixed(1)} (n=${scores.length})`);
  }
  // Top-20 / bottom-20.
  const ranked = [...ideas].filter((i) => i.hookQualityScore !== null).sort((a, b) => (b.hookQualityScore ?? 0) - (a.hookQualityScore ?? 0));
  if (ranked.length > 0) {
    lines.push("");
    lines.push("**Top-20 strongest hooks (by hookQualityScore):**");
    for (const r of ranked.slice(0, 20)) {
      lines.push(`  - [${(r.hookQualityScore ?? 0).toFixed(1)}] "${r.hook.slice(0, 110)}"`);
    }
    lines.push("");
    lines.push("**Bottom-20 weakest hooks (by hookQualityScore):**");
    for (const r of ranked.slice(-20).reverse()) {
      lines.push(`  - [${(r.hookQualityScore ?? 0).toFixed(1)}] "${r.hook.slice(0, 110)}"${r.weakSkeletonFamily ? ` (weak=${r.weakSkeletonFamily})` : ""}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function buildSmokeSection(perCohort: Map<string, { ideas: IdeaRecord[]; batches: BatchRecord[] }>): string {
  const lines: string[] = [];
  lines.push("## Smoke regressions — non-western cohorts (W1 ON)");
  lines.push("");
  lines.push("| cohort | batches | ideas | refresh ok | pack ideas (telemetry) | NG-leak hooks (NG cohort: must be 0 cross-region) | privacy hits | claude fb | median ms |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const [label, { ideas, batches }] of perCohort.entries()) {
    const totalBatches = batches.length;
    const refreshOk = batches.filter((b) => !b.errored && b.ideaCount === COUNT_PER_BATCH).length;
    const packIdeas = ideas.filter((i) => i.packEntryId !== null).length;
    const fallbacks = batches.filter((b) => b.usedFallback === true).length;
    const privacy = ideas.filter((i) => i.privacyHits.length > 0).length;
    const ngLeakHits = ideas.filter((i) => detectLeak([i.hook, i.whatToShow, i.howToFilm, i.caption].join(" "), NG_LEAK_TERMS).length > 0).length;
    const durations = batches.map((b) => b.durationMs).sort((a, b) => a - b);
    const medMs = durations.length > 0 ? durations[Math.floor(durations.length / 2)] : 0;
    lines.push(`| \`${label}\` | ${totalBatches} | ${ideas.length} | ${refreshOk}/${totalBatches} (${pct(refreshOk, totalBatches)}) | ${packIdeas}/${ideas.length} (${pct(packIdeas, ideas.length)}) | ${ngLeakHits} | ${privacy} | ${fallbacks} | ${medMs} |`);
  }
  lines.push("");
  // Detailed exemplars.
  lines.push("**Top-3 hooks per non-western cohort (sanity sample):**");
  lines.push("");
  for (const [label, { ideas }] of perCohort.entries()) {
    const sample = ideas.slice(0, 3);
    lines.push(`- \`${label}\`:`);
    for (const i of sample) {
      lines.push(`  - "${i.hook.slice(0, 110)}"${i.packEntryId ? ` _(pack=${i.packEntryId})_` : ""}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const arg = (process.argv[2] ?? "").replace(/^--phase=/, "");
  const phase = arg === "before" || arg === "after" || arg === "smoke" ? arg : "after";
  if (!fs.existsSync(QA_RUNS_DIR)) fs.mkdirSync(QA_RUNS_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");

  if (phase === "before" || phase === "after") {
    const western: Cohort = { label: "western", region: "western", languageStyle: null, totalRefreshes: 20 };
    process.stdout.write(`[w1QA] running western/${phase} (20 batches × 3 ideas)\n`);
    const res = await runCohort(western);
    fs.writeFileSync(path.join(QA_RUNS_DIR, `w1_${phase}_${ts}.json`), JSON.stringify(res, null, 2));
    const section = buildWesternSection(phase, res);
    appendToReport(phase, section);
  } else {
    const cohorts: Cohort[] = [
      { label: "ng_pidgin", region: "nigeria", languageStyle: "pidgin", totalRefreshes: 5 },
      { label: "ng_light_pidgin", region: "nigeria", languageStyle: "light_pidgin", totalRefreshes: 5 },
      { label: "india", region: "india", languageStyle: null, totalRefreshes: 3 },
      { label: "philippines", region: "philippines", languageStyle: null, totalRefreshes: 3 },
    ];
    const all = new Map<string, { ideas: IdeaRecord[]; batches: BatchRecord[] }>();
    for (const c of cohorts) {
      process.stdout.write(`[w1QA] running smoke ${c.label} (${c.totalRefreshes} batches × 3 ideas)\n`);
      const res = await runCohort(c);
      all.set(c.label, res);
      fs.writeFileSync(path.join(QA_RUNS_DIR, `w1_smoke_${c.label}_${ts}.json`), JSON.stringify(res, null, 2));
    }
    appendToReport("smoke", buildSmokeSection(all));
  }
}

function appendToReport(phase: string, section: string): void {
  const header = `\n\n<!-- W1_QA_APPEND ${phase} ${new Date().toISOString()} pid=${process.pid} -->\n`;
  const banner = phase === "smoke" ? "" : `## Real-API western/default measurement (${phase})\n\n_endpoint_: \`${API_URL}\` · _weak-skeleton families_: ${WESTERN_WEAK_SKELETONS.length}\n\n`;
  fs.appendFileSync(REPORT_PATH, header + banner + section + "\n");
  process.stdout.write(`[w1QA] appended ${phase} section to ${REPORT_PATH}\n`);
}

main().catch((e) => {
  console.error("[w1QA] fatal:", e);
  process.exit(1);
});
