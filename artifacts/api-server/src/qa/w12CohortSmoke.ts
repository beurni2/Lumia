/**
 * W1.2 cohort smoke — quick non-western confirmation that W1.2 doesn't
 * leak. Calls /api/ideator/generate for nigeria/pidgin, india, philippines
 * (3 batches each, serial, regenerate cadence per batch). Dumps to
 * `.local/qa-runs/w12_smoke_<label>.json`.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const API_URL = "http://localhost:80/api/ideator/generate";
const QA_DIR = "/home/runner/workspace/.local/qa-runs";

type Cohort = {
  label: string;
  region: string;
  languageStyle: string | null;
  batches: number;
};

const COHORTS: Cohort[] = [
  { label: "ng_pidgin",   region: "nigeria",     languageStyle: "pidgin",       batches: 3 },
  { label: "ng_light",    region: "nigeria",     languageStyle: "light_pidgin", batches: 3 },
  { label: "india",       region: "india",       languageStyle: null,           batches: 3 },
  { label: "philippines", region: "philippines", languageStyle: null,           batches: 3 },
];

async function callApi(c: Cohort, regenerate: boolean) {
  const body: Record<string, unknown> = { region: c.region, count: 3, regenerate };
  if (c.languageStyle !== null) body.languageStyle = c.languageStyle;
  const t0 = Date.now();
  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lumina-qa-expose-meta": "1" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const dur = Date.now() - t0;
    if (!r.ok) return { dur, status: r.status, err: `HTTP ${r.status}`, resp: null as unknown };
    const j = await r.json();
    return { dur, status: 200, err: null, resp: j };
  } catch (e) {
    return { dur: Date.now() - t0, status: 0, err: String((e as Error).message ?? e), resp: null };
  }
}

async function runCohort(c: Cohort) {
  const recs: Array<Record<string, unknown>> = [];
  for (let i = 0; i < c.batches; i++) {
    const r = await callApi(c, i > 0);
    const resp = r.resp as
      | { ideas?: Array<{ hook: string }>; usedFallback?: boolean; qaTelemetry?: { perIdea?: Array<{ source?: string }>; westernFunnel?: unknown; nigerianPack?: unknown } }
      | null;
    const ideas = resp?.ideas ?? [];
    const rec = {
      batchIdx: i,
      durationMs: r.dur,
      status: r.status,
      err: r.err,
      ideaCount: ideas.length,
      hooks: ideas.map((x) => x.hook),
      usedFallback: resp?.usedFallback ?? null,
      sources: (resp?.qaTelemetry?.perIdea ?? []).map((p) => p.source ?? null),
      hasWesternFunnel: Boolean(resp?.qaTelemetry?.westernFunnel),
      nigerianPackCount: Array.isArray(resp?.qaTelemetry?.nigerianPack)
        ? (resp?.qaTelemetry?.nigerianPack as unknown[]).length
        : null,
    };
    recs.push(rec);
    process.stdout.write(`[w12-smoke] ${c.label} ${i + 1}/${c.batches} ms=${r.dur} ideas=${ideas.length} fb=${rec.usedFallback} hasWestFunnel=${rec.hasWesternFunnel}${r.err ? ` err=${r.err}` : ""}\n`);
  }
  const out = path.join(QA_DIR, `w12_smoke_${c.label}.json`);
  fs.writeFileSync(out, JSON.stringify({ cohort: c, recs }, null, 2));
  process.stdout.write(`[w12-smoke] DONE ${c.label} -> ${out}\n`);
}

(async () => {
  if (!fs.existsSync(QA_DIR)) fs.mkdirSync(QA_DIR, { recursive: true });
  // Run cohorts in parallel — they hit different creator memory.
  await Promise.all(COHORTS.map(runCohort));
})();
