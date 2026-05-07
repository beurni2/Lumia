/**
 * PHASE W2-K2 — Staging QA driver.
 *
 * Sweep:
 *   • W2-ON western (clean):     W2K_WESTERN_BATCHES (default 20)
 *   • W2-OFF western (clean):    W2K_OFF_BATCHES (default 10)
 *   • Leak gates × 5 cohorts:    W2K_LEAK_REFRESHES (default 3)
 *
 * Toggling W2 between ON/OFF is achieved by sending the staging-only
 * header `x-lumina-qa-force-w2-off: 1` on OFF batches. The route
 * gates the header on `NODE_ENV !== "production"`, so the production
 * stack ignores it entirely; in dev the orchestrator AND-folds this
 * with the regular activation gate, forcing W2 off for that one
 * request without restarting the server.
 *
 * Hits the REAL `/api/ideator/generate` route via the shared proxy
 * with `x-lumina-qa-expose-meta: 1` so the per-idea telemetry array
 * surfaces all W2 axis tags.
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
  westernPackHookSkeleton?: string | null;
  westernPackAnchor?: string | null;
  westernPackComedyFamily?: string | null;
  westernPackEmotionalSpike?: string | null;
  westernPackSetting?: string | null;
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
const PER_BATCH_TIMEOUT_MS = 90_000;
const COUNT_PER_BATCH = 3;

const WESTERN_ON_BATCHES = Number(process.env.W2K_WESTERN_BATCHES ?? 20);
const WESTERN_OFF_BATCHES = Number(process.env.W2K_OFF_BATCHES ?? 10);
const LEAK_REFRESHES = Number(process.env.W2K_LEAK_REFRESHES ?? 3);

type Cohort = {
  label: string;
  region: string;
  languageStyle: string | null;
};

const LEAK_COHORTS: ReadonlyArray<Cohort> = [
  { label: "ng_pidgin", region: "nigeria", languageStyle: "pidgin" },
  { label: "ng_light", region: "nigeria", languageStyle: "light_pidgin" },
  { label: "ng_clean", region: "nigeria", languageStyle: "clean" },
  { label: "india", region: "india", languageStyle: null },
  { label: "philippines", region: "philippines", languageStyle: null },
];

async function callApi(args: {
  region: string;
  languageStyle: string | null;
  count: number;
  regenerate: boolean;
  forceW2Off: boolean;
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
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-lumina-qa-expose-meta": "1",
  };
  if (args.forceW2Off) headers["x-lumina-qa-force-w2-off"] = "1";
  const t0 = Date.now();
  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers,
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
  w2Skeletons: string[];
  w2Anchors: string[];
  w2Families: string[];
  w2Spikes: string[];
  w2Settings: string[];
  w2HookScores: number[];
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

function pickW2(perIdea: GenPerIdea[]): {
  entryIds: string[];
  skeletons: string[];
  anchors: string[];
  families: string[];
  spikes: string[];
  settings: string[];
  scores: number[];
} {
  const entryIds: string[] = [];
  const skeletons: string[] = [];
  const anchors: string[] = [];
  const families: string[] = [];
  const spikes: string[] = [];
  const settings: string[] = [];
  const scores: number[] = [];
  for (const p of perIdea) {
    const id = p.westernPackEntryId;
    if (typeof id !== "string" || id.length === 0) continue;
    entryIds.push(id);
    if (typeof p.westernPackHookSkeleton === "string")
      skeletons.push(p.westernPackHookSkeleton);
    if (typeof p.westernPackAnchor === "string")
      anchors.push(p.westernPackAnchor);
    if (typeof p.westernPackComedyFamily === "string")
      families.push(p.westernPackComedyFamily);
    if (typeof p.westernPackEmotionalSpike === "string")
      spikes.push(p.westernPackEmotionalSpike);
    if (typeof p.westernPackSetting === "string")
      settings.push(p.westernPackSetting);
    if (typeof p.hookQualityScore === "number")
      scores.push(p.hookQualityScore);
  }
  return { entryIds, skeletons, anchors, families, spikes, settings, scores };
}

async function runWesternSweep(
  label: string,
  batches: number,
  forceW2Off: boolean,
): Promise<WesternBatchRecord[]> {
  const out: WesternBatchRecord[] = [];
  for (let i = 0; i < batches; i++) {
    const r = await callApi({
      region: "western",
      languageStyle: "clean",
      count: COUNT_PER_BATCH,
      regenerate: i > 0,
      forceW2Off,
    });
    const perIdea = r.resp?.qaTelemetry?.perIdea ?? [];
    const w2 = pickW2(perIdea);
    const hooks = (r.resp?.ideas ?? [])
      .map((i) => i.hook ?? "")
      .filter((h) => h.length > 0);
    out.push({
      batchIdx: i,
      ideaCount: r.resp?.ideas.length ?? 0,
      w2EntryIds: w2.entryIds,
      w2Skeletons: w2.skeletons,
      w2Anchors: w2.anchors,
      w2Families: w2.families,
      w2Spikes: w2.spikes,
      w2Settings: w2.settings,
      w2HookScores: w2.scores,
      hooks,
      durationMs: r.durationMs,
      errored: r.err !== null,
    });
    process.stdout.write(
      `[${label}] batch ${i + 1}/${batches} ${r.durationMs}ms ` +
        `ideas=${r.resp?.ideas.length ?? 0} w2=${w2.entryIds.length}` +
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
        forceW2Off: false,
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

function countRepeats(arr: string[]): {
  totalRepeatedSlots: number;
  distinctRepeated: Array<[string, number]>;
} {
  const counts = new Map<string, number>();
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
  const distinctRepeated = [...counts.entries()].filter(([, c]) => c > 1);
  const totalRepeatedSlots = distinctRepeated.reduce(
    (s, [, c]) => s + (c - 1),
    0,
  );
  return { totalRepeatedSlots, distinctRepeated };
}

function summarizeWestern(
  label: string,
  batches: WesternBatchRecord[],
): string {
  const total = batches.length;
  if (total === 0) {
    return [`### ${label} — 0 batches (skipped)`, ""].join("\n");
  }
  const errored = batches.filter((b) => b.errored).length;
  const totalIdeas = batches.reduce((s, b) => s + b.ideaCount, 0);
  const totalW2 = batches.reduce((s, b) => s + b.w2EntryIds.length, 0);
  const dist = [0, 0, 0, 0]; // # of W2 in batch: 0, 1, 2, 3
  for (const b of batches) {
    const idx = Math.min(b.w2EntryIds.length, 3);
    dist[idx]!++;
  }
  const allEntryIds = batches.flatMap((b) => b.w2EntryIds);
  const allHooks = batches.flatMap((b) => b.hooks);
  const allW2Hooks = batches.flatMap((b, _i) =>
    b.hooks.slice(0, b.w2EntryIds.length),
  );
  const allSkeletons = batches.flatMap((b) => b.w2Skeletons);
  const allAnchors = batches.flatMap((b) => b.w2Anchors);
  const allFamilies = batches.flatMap((b) => b.w2Families);
  const allSpikes = batches.flatMap((b) => b.w2Spikes);
  const allSettings = batches.flatMap((b) => b.w2Settings);
  const allScores = batches.flatMap((b) => b.w2HookScores);

  const idStats = countRepeats(allEntryIds);
  const hookStats = countRepeats(allHooks);
  const skelStats = countRepeats(allSkeletons);
  const anchorStats = countRepeats(allAnchors);
  const familyStats = countRepeats(allFamilies);
  const settingStats = countRepeats(allSettings);
  const spikeStats = countRepeats(allSpikes);

  const inBatchEntryDups = batches.filter(
    (b) => new Set(b.w2EntryIds).size !== b.w2EntryIds.length,
  ).length;
  const inBatchAnchorDups = batches.filter(
    (b) => b.w2Anchors.length > 1 &&
      new Set(b.w2Anchors).size !== b.w2Anchors.length,
  ).length;
  const inBatchSkeletonDups = batches.filter(
    (b) => b.w2Skeletons.length > 1 &&
      new Set(b.w2Skeletons).size !== b.w2Skeletons.length,
  ).length;

  const avgScore = allScores.length > 0
    ? (allScores.reduce((s, v) => s + v, 0) / allScores.length).toFixed(1)
    : "—";

  const avgDuration =
    batches.reduce((s, b) => s + b.durationMs, 0) /
    Math.max(batches.length, 1);
  const latencyMin = Math.min(...batches.map((b) => b.durationMs));
  const latencyMax = Math.max(...batches.map((b) => b.durationMs));

  const fmtRepeats = (s: { totalRepeatedSlots: number; distinctRepeated: Array<[string, number]> }, sample = 3) =>
    `${s.totalRepeatedSlots}` +
    (s.distinctRepeated.length > 0
      ? ` (${s.distinctRepeated.slice(0, sample).map(([k, c]) => `${c}× "${k.slice(0, 32)}"`).join("; ")})`
      : "");

  return [
    `### ${label} — ${total} batches`,
    `- ideas total: ${totalIdeas} (avg per batch ${(totalIdeas / total).toFixed(2)})`,
    `- W2 ideas total: ${totalW2}/${totalIdeas} (${((totalW2 / Math.max(totalIdeas, 1)) * 100).toFixed(1)}%)`,
    `- batch W2-count distribution: 0=${dist[0]} | 1=${dist[1]} | 2=${dist[2]} | 3=${dist[3]} (3 SHOULD BE 0)`,
    `- distinct W2 entryIds across sweep: ${new Set(allEntryIds).size} / ${totalW2} W2 ideas`,
    `- repeated W2 entryIds (extra slots): ${fmtRepeats(idStats)}`,
    `- exact W2 hook repeats (extra slots): ${fmtRepeats(hookStats)}` +
      (allHooks.length !== allW2Hooks.length ? "  [includes non-W2 hooks]" : ""),
    `- W2 skeleton repeats (extra slots): ${fmtRepeats(skelStats)}`,
    `- W2 anchor repeats (extra slots): ${fmtRepeats(anchorStats)}`,
    `- W2 family repeats (extra slots): ${fmtRepeats(familyStats)}`,
    `- W2 setting repeats (extra slots): ${fmtRepeats(settingStats)}`,
    `- W2 spike repeats (extra slots): ${fmtRepeats(spikeStats)}`,
    `- in-batch entryId duplicates (SHOULD BE 0): ${inBatchEntryDups}`,
    `- in-batch anchor duplicates (SHOULD BE 0): ${inBatchAnchorDups}`,
    `- in-batch skeleton duplicates (SHOULD BE 0): ${inBatchSkeletonDups}`,
    `- avg W2 hookQualityScore (${allScores.length} sampled): ${avgScore}`,
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
  lines.push(`- TOTAL LEAKS: ${totalLeaks} ${totalLeaks === 0 ? "OK" : "FAIL"}`);
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  process.stdout.write(`[w2k2] hitting ${API_URL}\n`);
  process.stdout.write(
    `[w2k2] env LUMINA_W2_WESTERN_APPROVED_ENABLED=${process.env.LUMINA_W2_WESTERN_APPROVED_ENABLED ?? "<unset on driver — server-side controls activation>"}\n`,
  );
  process.stdout.write(
    `[w2k2] sweep plan: ON=${WESTERN_ON_BATCHES} OFF=${WESTERN_OFF_BATCHES} leak=${LEAK_REFRESHES}×${LEAK_COHORTS.length}\n`,
  );
  const t0 = Date.now();

  const onBatches = await runWesternSweep("W2-ON", WESTERN_ON_BATCHES, false);
  const offBatches = await runWesternSweep(
    "W2-OFF",
    WESTERN_OFF_BATCHES,
    true,
  );
  const leak = await runLeakSweep();

  const totalMs = Date.now() - t0;
  const report = [
    `# PHASE W2-K2 — Staging QA Report`,
    ``,
    `_Generated: ${new Date().toISOString()}_`,
    `_Total wall time: ${(totalMs / 1000).toFixed(1)}s_`,
    `_Server env LUMINA_W2_WESTERN_APPROVED_ENABLED=${process.env.LUMINA_W2_WESTERN_APPROVED_ENABLED ?? "<unset on driver>"}_`,
    `_Sweep: ON=${WESTERN_ON_BATCHES} OFF=${WESTERN_OFF_BATCHES} (header-toggled) leak=${LEAK_REFRESHES}×${LEAK_COHORTS.length}_`,
    ``,
    `## Western sweep`,
    summarizeWestern(`W2 ON (header off)`, onBatches),
    summarizeWestern(`W2 OFF (header x-lumina-qa-force-w2-off:1)`, offBatches),
    `## Leak gates`,
    summarizeLeak(leak),
  ].join("\n");
  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, report, "utf8");
  process.stdout.write(`\n[w2k2] wrote ${REPORT_PATH}\n`);
  process.stdout.write(report);
}

main().catch((e) => {
  process.stderr.write(`[w2k2] FATAL ${String((e as Error)?.stack ?? e)}\n`);
  process.exit(1);
});
