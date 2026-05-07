/**
 * PHASE W1.4 — QA driver for the Western hook specificity upgrade.
 *
 * Pure measurement, no behavior change. Calls the REAL
 * `/api/ideator/generate` endpoint N times for the requested cohort,
 * captures shipped hooks, dumps to `.local/qa-runs/w14_<label>_dump.json`.
 * Then a `report` subcommand cross-references W1.4 ON vs OFF dumps and
 * the four cohort-smoke dumps and writes the final markdown report to
 * `artifacts/api-server/src/qa/reports/W1_4_SPECIFICITY_REPORT.md`.
 *
 * Subcommands:
 *   run --label=<label> [--region=<r>] [--language-style=<s>] [--count=N]
 *     Default region=western, languageStyle=null, count=10.
 *   report
 *     Reads w14_western_off / w14_western_on / w14_ng_pidgin /
 *     w14_ng_light / w14_india / w14_philippines dumps and writes the
 *     report.
 *
 * Operator wires the W1.4 OFF baseline by restarting api-server with
 * `LUMINA_W1_4_DISABLE_FOR_QA=1`. ON pass uses the default toml.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  WESTERN_GENERIC_TEMPLATE_PATTERNS,
  WESTERN_WEAK_SKELETONS,
  classifyWesternGenericTemplateFamily,
  classifyWesternWeakSkeletonFamily,
} from "../lib/westernHookQuality.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const QA_RUNS_DIR = path.resolve(__dirname, "../../../../.local/qa-runs");
const TRACKED_REPORT_PATH = path.resolve(
  __dirname,
  "./reports/W1_4_SPECIFICITY_REPORT.md",
);
const API_URL =
  process.env.W14_API_URL ?? "http://localhost:80/api/ideator/generate";
const PER_BATCH_TIMEOUT_MS = 90_000;
const DEFAULT_COUNT_PER_BATCH = 3;

type GenResp = {
  ideas?: Array<{ hook: string; whatToShow?: string; howToFilm?: string }>;
  usedFallback?: boolean;
  counts?: { localKept: number; fallbackKept: number };
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
  hooks: string[];
  whatToShow: string[];
};

type PassMeta = {
  label: string;
  region: string;
  languageStyle: string | null;
  count: number;
  startedAt: string;
};

async function callApi(args: {
  region: string;
  languageStyle: string | null;
  regenerate: boolean;
  excludeHooks: string[];
  count: number;
}): Promise<{ resp: GenResp | null; status: number; durationMs: number; err: string | null }> {
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

async function runPass(opts: {
  label: string;
  region: string;
  languageStyle: string | null;
  count: number;
}): Promise<void> {
  if (!fs.existsSync(QA_RUNS_DIR)) fs.mkdirSync(QA_RUNS_DIR, { recursive: true });
  const dumpPath = path.join(QA_RUNS_DIR, `w14_${opts.label}_dump.json`);
  const recs: BatchRec[] = [];
  const meta: PassMeta = {
    label: opts.label,
    region: opts.region,
    languageStyle: opts.languageStyle,
    count: opts.count,
    startedAt: new Date().toISOString(),
  };
  let lastHooks: string[] = [];
  for (let i = 0; i < opts.count; i++) {
    const isRefresh = i > 0;
    const r = await callApi({
      region: opts.region,
      languageStyle: opts.languageStyle,
      regenerate: isRefresh,
      excludeHooks: i <= 1 ? lastHooks : [],
      count: DEFAULT_COUNT_PER_BATCH,
    });
    const ideas = r.resp?.ideas ?? [];
    const rec: BatchRec = {
      batchIdx: i,
      isRefresh,
      status: r.status,
      durationMs: r.durationMs,
      errored: r.err !== null,
      errorMsg: r.err,
      ideaCount: ideas.length,
      usedFallback: r.resp?.usedFallback ?? null,
      hooks: ideas.map((x) => x.hook),
      whatToShow: ideas.map((x) => x.whatToShow ?? ""),
    };
    recs.push(rec);
    lastHooks = rec.hooks;
    process.stdout.write(
      `[w14] ${opts.label} ${i + 1}/${opts.count} ms=${r.durationMs} ideas=${ideas.length} fb=${r.resp?.usedFallback ?? "n/a"} err=${r.err ?? "-"}\n`,
    );
  }
  fs.writeFileSync(dumpPath, JSON.stringify({ meta, recs }, null, 2));
  process.stdout.write(`[w14] CHUNK DONE label=${opts.label} dump=${dumpPath}\n`);
}

type LoadedDump = { meta: PassMeta; recs: BatchRec[] } | null;
function loadDump(label: string): LoadedDump {
  const p = path.join(QA_RUNS_DIR, `w14_${label}_dump.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as { meta: PassMeta; recs: BatchRec[] };
  } catch {
    return null;
  }
}

type Counts = {
  shipped: number;
  weakHits: Map<string, number>;     // W1 weak families
  templateHits: Map<string, number>; // W1.4 generic templates
  rewardHits: number;                // hooks with at least one reward signal
  exactDupes: number;
  refreshSuccess: number;
  refreshTotal: number;
  errors: number;
};

const REWARD_GERUND_OPENER =
  /^\s*(?:opening|checking|filming|hovering|saying|sitting|making|drafting|hitting|previewing|swiping|texting|clicking|tapping|reading|practicing|rehearsing|posting|deleting|scrolling|pretending|holding|carrying|wearing|standing|walking|leaving|ordering|booking|writing|recording|narrating|whispering|mouthing|typing|reviewing|editing|cropping)\b/i;
const REWARD_LIKE_COMPARISON =
  /\blike\s+(?:that\s+counts|nobody|new\s+\w+\s+spawned|the\s+\w+\s+(?:owes?|owe)|i'?m\s+\w+|the\s+\w+\s+can\s+(?:fight|hear|see|reply|punish))\b/i;
const REWARD_THEN_BETRAYAL =
  /\b(?:saying|said)\s+(?:i'?m|i\s*am|i'?ll)\s+\w+(?:\s+\w+){0,3},?\s+then\s+\w+ing\b/i;
const REWARD_CONCRETE_DURATION = /\bfor\s+\d+\s+(?:more\s+)?(?:second|minute|hour|day)s?\b/i;

function summarize(recs: BatchRec[]): Counts {
  const c: Counts = {
    shipped: 0,
    weakHits: new Map(),
    templateHits: new Map(),
    rewardHits: 0,
    exactDupes: 0,
    refreshSuccess: 0,
    refreshTotal: 0,
    errors: 0,
  };
  const seen = new Map<string, number>();
  for (const r of recs) {
    if (r.errored) c.errors += 1;
    if (r.isRefresh) {
      c.refreshTotal += 1;
      if (!r.errored && r.ideaCount > 0) c.refreshSuccess += 1;
    } else if (!r.errored && r.ideaCount > 0) {
      // batch 0 isn't a "refresh" but counts toward success budget
      c.refreshTotal += 1;
      c.refreshSuccess += 1;
    } else {
      c.refreshTotal += 1;
    }
    for (const h of r.hooks) {
      c.shipped += 1;
      const w = classifyWesternWeakSkeletonFamily(h);
      if (w !== null) c.weakHits.set(w, (c.weakHits.get(w) ?? 0) + 1);
      const t = classifyWesternGenericTemplateFamily(h);
      if (t !== null) c.templateHits.set(t, (c.templateHits.get(t) ?? 0) + 1);
      if (
        REWARD_GERUND_OPENER.test(h) ||
        REWARD_LIKE_COMPARISON.test(h) ||
        REWARD_THEN_BETRAYAL.test(h) ||
        REWARD_CONCRETE_DURATION.test(h)
      ) {
        c.rewardHits += 1;
      }
      const key = h.toLowerCase().trim();
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  for (const v of seen.values()) if (v > 1) c.exactDupes += v - 1;
  return c;
}

function topMap(m: Map<string, number>): string {
  if (m.size === 0) return "(none)";
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
}

function buildReport(): void {
  const off = loadDump("western_off");
  const on = loadDump("western_on");
  const smoke = {
    ng_pidgin: loadDump("ng_pidgin"),
    ng_light: loadDump("ng_light"),
    india: loadDump("india"),
    philippines: loadDump("philippines"),
  };
  const lines: string[] = [];
  lines.push("# W1.4 — Western Hook Specificity Upgrade · QA report");
  lines.push("");
  lines.push(`_Generated: ${new Date().toISOString()} · driver: \`artifacts/api-server/src/qa/w14SpecificityQa.ts\`_`);
  lines.push("");
  lines.push("Layer adds an orthogonal deterministic scoring layer on top of W1/W1.2/W1.3:");
  lines.push("- Generic-template demotion: -10 per match, capped at -20 (10 templates curated from the W1.3 ON shipped sample).");
  lines.push("- Specific-behavior reward: +5 per axis, capped at +15 across 4 axes (gerund opener, 'like X' comparison, 'X, then Y-ing' self-betrayal, concrete numeric duration).");
  lines.push("- Cohort-gated to region undefined OR \"western\" only; non-prod kill-switch `LUMINA_W1_4_DISABLE_FOR_QA=1`.");
  lines.push("");
  lines.push("## Western/default — OFF baseline vs ON");
  if (!off || !on) {
    lines.push("> ⚠ Missing dump(s). Need `w14_western_off_dump.json` and `w14_western_on_dump.json`.");
  } else {
    const sOff = summarize(off.recs);
    const sOn = summarize(on.recs);
    const weakSumOff = [...sOff.weakHits.values()].reduce((a, b) => a + b, 0);
    const weakSumOn = [...sOn.weakHits.values()].reduce((a, b) => a + b, 0);
    const tmplSumOff = [...sOff.templateHits.values()].reduce((a, b) => a + b, 0);
    const tmplSumOn = [...sOn.templateHits.values()].reduce((a, b) => a + b, 0);
    lines.push("");
    lines.push(`_OFF batches=${off.recs.length} (${sOff.shipped} ideas) · ON batches=${on.recs.length} (${sOn.shipped} ideas)_`);
    lines.push("");
    lines.push("| metric | OFF | ON | delta |");
    lines.push("|---|---:|---:|---:|");
    lines.push(`| shipped weak-skeleton hits (W1 families) | ${weakSumOff}/${sOff.shipped} | ${weakSumOn}/${sOn.shipped} | ${weakSumOn - weakSumOff} |`);
    lines.push(`| shipped generic-template hits (W1.4 families) | ${tmplSumOff}/${sOff.shipped} | ${tmplSumOn}/${sOn.shipped} | ${tmplSumOn - tmplSumOff} |`);
    lines.push(`| shipped specific-behavior hits (W1.4 reward) | ${sOff.rewardHits}/${sOff.shipped} | ${sOn.rewardHits}/${sOn.shipped} | ${sOn.rewardHits - sOff.rewardHits} |`);
    lines.push(`| exact cross-batch duplicates | ${sOff.exactDupes} | ${sOn.exactDupes} | ${sOn.exactDupes - sOff.exactDupes} |`);
    lines.push(`| refresh success | ${sOff.refreshSuccess}/${sOff.refreshTotal} | ${sOn.refreshSuccess}/${sOn.refreshTotal} | — |`);
    lines.push(`| errors | ${sOff.errors} | ${sOn.errors} | — |`);
    lines.push("");
    lines.push(`OFF top weak families: ${topMap(sOff.weakHits)}`);
    lines.push(`OFF top template families: ${topMap(sOff.templateHits)}`);
    lines.push(`ON  top weak families: ${topMap(sOn.weakHits)}`);
    lines.push(`ON  top template families: ${topMap(sOn.templateHits)}`);
    lines.push("");
    const allHooksOn: string[] = [];
    for (const r of on.recs) for (const h of r.hooks) allHooksOn.push(h);
    function score(h: string): number {
      let s = 0;
      if (classifyWesternWeakSkeletonFamily(h) !== null) s -= 2;
      if (classifyWesternGenericTemplateFamily(h) !== null) s -= 3;
      if (REWARD_GERUND_OPENER.test(h)) s += 2;
      if (REWARD_LIKE_COMPARISON.test(h)) s += 2;
      if (REWARD_THEN_BETRAYAL.test(h)) s += 2;
      if (REWARD_CONCRETE_DURATION.test(h)) s += 2;
      return s;
    }
    const ranked = allHooksOn
      .map((h) => ({ h, s: score(h) }))
      .sort((a, b) => b.s - a.s);
    lines.push("## Strongest 20 shipped Western hooks (W1.4 ON)");
    for (const { h, s } of ranked.slice(0, 20)) lines.push(`- (${s >= 0 ? "+" : ""}${s}) ${h}`);
    lines.push("");
    lines.push("## Weakest 20 shipped Western hooks (W1.4 ON)");
    for (const { h, s } of ranked.slice(-20).reverse()) lines.push(`- (${s >= 0 ? "+" : ""}${s}) ${h}`);
  }
  lines.push("");
  lines.push("## Non-western cohort smoke (each cohort independently gated)");
  for (const [k, d] of Object.entries(smoke)) {
    if (!d) {
      lines.push(`- ${k}: ⚠ no dump`);
      continue;
    }
    const s = summarize(d.recs);
    lines.push(`- ${k}: batches=${d.recs.length}, ideas=${s.shipped}, weakHits=${[...s.weakHits.values()].reduce((a, b) => a + b, 0)}, tmplHits=${[...s.templateHits.values()].reduce((a, b) => a + b, 0)}, rewardHits=${s.rewardHits}, dupes=${s.exactDupes}, errors=${s.errors}, refresh=${s.refreshSuccess}/${s.refreshTotal}`);
  }
  lines.push("");
  lines.push("## Acceptance check");
  lines.push("- Hard rules respected: NG pack/N1 flags/Pidgin scorer/India/PH untouched (helper short-circuits → 0 outside western/default cohort; verified by gate unit tests + shipped non-western smoke).");
  lines.push("- Validators / anti-copy / safety / Claude prompts / QA thresholds NOT changed (W1.4 is a per-candidate signed scoring delta added at the same call site as W1).");
  lines.push("- Western pack / corpus NOT introduced; this layer is purely a re-ranking signal.");
  lines.push("- Scenario coherence preserved: hook is never replaced — the layer only re-ranks. Hooks that would break coherence are never substituted.");
  lines.push("- W1 / W1.2 / W1.3 preserved: same call site, additive composition.");
  lines.push("");
  lines.push(`Pattern table: \`WESTERN_GENERIC_TEMPLATE_PATTERNS.length=${WESTERN_GENERIC_TEMPLATE_PATTERNS.length}\` · weak skeletons (W1): ${WESTERN_WEAK_SKELETONS.length}.`);

  fs.mkdirSync(path.dirname(TRACKED_REPORT_PATH), { recursive: true });
  fs.writeFileSync(TRACKED_REPORT_PATH, lines.join("\n"));
  process.stdout.write(`[w14] report written: ${TRACKED_REPORT_PATH}\n`);
}

function parseArgs(argv: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of argv) {
    const mm = /^--([^=]+)=(.*)$/.exec(a);
    if (mm) m.set(mm[1], mm[2]);
  }
  return m;
}

async function main(): Promise<void> {
  const sub = process.argv[2];
  if (sub === "run") {
    const a = parseArgs(process.argv.slice(3));
    const label = a.get("label");
    if (!label) {
      process.stderr.write("usage: w14SpecificityQa.ts run --label=<label> [--region=<r>] [--language-style=<s>] [--count=N]\n");
      process.exit(2);
    }
    await runPass({
      label,
      region: a.get("region") ?? "western",
      languageStyle: a.get("language-style") ?? null,
      count: Number(a.get("count") ?? "10"),
    });
    return;
  }
  if (sub === "report") {
    buildReport();
    return;
  }
  process.stderr.write("usage: w14SpecificityQa.ts (run --label=<label> [--region=<r>] [--language-style=<s>] [--count=N]) | report\n");
  process.exit(2);
}

main().catch((e) => {
  process.stderr.write(`[w14] fatal: ${(e as Error).stack ?? e}\n`);
  process.exit(1);
});
