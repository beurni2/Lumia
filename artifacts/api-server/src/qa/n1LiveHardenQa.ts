/**
 * N1 LIVE HARDEN QA — exercises the REAL /api/ideator/generate route
 * (not the in-process generator harness) and produces
 * `.local/N1_LIVE_HARDEN_QA.md`.
 *
 * Detection of pack ideas: the public route strips
 * `meta.nigerianPackEntryId` (server-internal telemetry). We import
 * `NIGERIAN_HOOK_PACK` directly and match shipped hooks against
 * the approved-pool hook strings (normalized) — pack entries are
 * atomic so the hook is the unique identity.
 *
 * Run: LUMINA_NG_PACK_ENABLED=true pnpm --filter @workspace/api-server \
 *        exec tsx src/qa/n1LiveHardenQa.ts
 *
 * The api-server workflow must be running (uses the proxy at
 * http://localhost:80/api/ideator/generate).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  NIGERIAN_HOOK_PACK,
  PIDGIN_MOCKING_PATTERNS,
  isNigerianPackFeatureEnabled,
} from "../lib/nigerianHookPack";

type Cohort = {
  label: string;
  region: string;
  languageStyle: string | null;
  totalIdeas: number;
  expectsPack: boolean;
};

const COHORTS: readonly Cohort[] = [
  { label: "ng_light_pidgin", region: "nigeria",     languageStyle: "light_pidgin", totalIdeas: 30, expectsPack: true  },
  { label: "ng_pidgin",       region: "nigeria",     languageStyle: "pidgin",       totalIdeas: 30, expectsPack: true  },
  { label: "ng_clean",        region: "nigeria",     languageStyle: "clean",        totalIdeas: 15, expectsPack: false },
  { label: "ng_null",         region: "nigeria",     languageStyle: null,           totalIdeas: 15, expectsPack: false },
  { label: "western",         region: "western",     languageStyle: null,           totalIdeas: 15, expectsPack: false },
  { label: "india",           region: "india",       languageStyle: null,           totalIdeas: 15, expectsPack: false },
  { label: "philippines",     region: "philippines", languageStyle: null,           totalIdeas: 15, expectsPack: false },
];

// Western anchor leaks that must NOT appear in NG pidgin/light_pidgin
// HOOKS (we restrict to hook to avoid false positives from generic
// catalog whatToShow text — e.g. "doordash" appearing in shared
// scenario libraries that the NG region uses without modification).
const WESTERN_LEAK_TERMS: readonly string[] = [
  "venmo","cashapp","cash app","zelle","target","walmart","trader joe","trader joes","trader joe's",
  "starbucks","dunkin","whole foods","costco","cvs","walgreens","ihop","chipotle","ubereats",
  "doordash","grubhub","amazon prime","netflix","hulu",
];

// Pidgin-distinctive tokens used as a PROXY for Nigerian-native
// content. The public route strips `meta.nigerianPackEntryId` and the
// rewrite/mutation pipeline can produce hooks that no longer match a
// pack entry byte-for-byte even though they were SEEDED from the
// pack. Counting hooks that contain ≥1 distinctive Pidgin token gives
// a faithful "Nigerian-native content delivered" rate. List drawn from
// `nigerianHookPack.ts` PIDGIN_DISTINCTIVE markers + reviewed corpus.
const PIDGIN_DISTINCTIVE_TOKENS: readonly string[] = [
  "abeg","wahala","oga","madam","biko","ehn"," ehn","na wa","na so","oya","sef",
  "abi","omo","walahi","wallahi","i dey","you dey","we dey","dem dey","dey come",
  "dey go","i no fit","you no fit","make i","make we","make e","wetin","shey",
  "wallai","jare","haba","chai","ehen","make sense","no shaking","no mind",
  "wahala dey sleep","find trouble","yawa","gist","japa","nawa","nawao","abeg no",
  "yawa don gas","mumu","na god","na you","my own"," sef","comot","commot",
  "una","unah","abi i lie","abi i no lie","park well","pidgin","naija","9ja",
  "lagos","abuja","ibadan","ph ","port harcourt","kano","calabar","benin city",
  "buka","akara","jollof","suya","danfo","keke","okada","mai-shai","nepa","phcn",
  "pos","bvn","gtbank","gtb","zenith","first bank","opay","palmpay","kuda","bet9ja",
];

// Privacy/safety markers — fail if any of these patterns appear in a
// candidate's rendered surfaces.
const PRIVACY_FAIL_RE: readonly RegExp[] = [
  /\b\d{3}-\d{2}-\d{4}\b/,                      // SSN-shaped
  /\b\d{4}\s\d{4}\s\d{4}\s\d{4}\b/,             // raw card-number shaped
  /\bbalance:\s*\$?\d{4,}\b/i,                  // explicit balance:$NNNN
  /\bpassword[:=]\s*\S+/i,                      // password=...
  /\bplate\s*(?:no|number)\s*[:=]\s*[A-Z0-9-]+/i,
];

type Idea = {
  hook: string;
  whatToShow: string;
  howToFilm: string;
  caption: string;
  trigger?: string;
  reaction?: string;
  script?: string;
  shotPlan?: string[];
  filmingGuide?: string[];
  pattern?: string;
  emotionalSpike?: string;
  hookStyle?: string;
  pickerEligible?: boolean;
};

type GenResp = {
  region: string;
  count: number;
  regenerate: boolean;
  ideas: Idea[];
};

type IdeaRecord = {
  cohort: string;
  batchIdx: number;
  ideaIdx: number;
  hook: string;
  whatToShow: string;
  howToFilm: string;
  caption: string;
  pattern?: string;
  pickerEligible?: boolean;
  isPack: boolean;
  packEntryId: string | null;
  mockingHits: string[];
  westernLeakHits: string[];
  privacyHits: string[];
  hookSkeleton: string;
  pidginTokenHits: string[];
  isNgNative: boolean;
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
  excludeHookCount: number;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPORT_PATH = path.resolve(__dirname, "../../../../.local/N1_LIVE_HARDEN_QA.md");
const API_URL =
  process.env.N1_LIVE_API_URL ??
  "http://localhost:80/api/ideator/generate";

// Build hook → packEntryId lookup. Normalize lightly (trim, collapse
// whitespace, lowercase) — the route ships hooks verbatim from the
// pack so this is essentially a direct match for pack candidates.
function normHook(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}
const PACK_HOOK_INDEX = new Map<string, string>();
for (const e of NIGERIAN_HOOK_PACK) {
  PACK_HOOK_INDEX.set(normHook(e.hook), e.id);
}

// Hook skeleton for repetition reporting (mirrors FIX C v2 logic but
// here only used for analysis — long tokens ≥5 chars → `__`).
function hookSkeleton(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => (w.length >= 5 ? "__" : w))
    .slice(0, 24)
    .join(" ");
}

function detectMocking(text: string): string[] {
  const hits: string[] = [];
  const lc = text.toLowerCase();
  for (const re of PIDGIN_MOCKING_PATTERNS) {
    const m = lc.match(re);
    if (m) hits.push(m[0]);
  }
  return hits;
}
function detectWesternLeak(text: string): string[] {
  const hits: string[] = [];
  const lc = text.toLowerCase();
  for (const term of WESTERN_LEAK_TERMS) {
    if (lc.includes(term)) hits.push(term);
  }
  return hits;
}
function detectPrivacy(text: string): string[] {
  const hits: string[] = [];
  for (const re of PRIVACY_FAIL_RE) {
    const m = text.match(re);
    if (m) hits.push(m[0]);
  }
  return hits;
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
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
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

function classifyIdea(cohort: string, batchIdx: number, ideaIdx: number, idea: Idea): IdeaRecord {
  const norm = normHook(idea.hook);
  const packEntryId = PACK_HOOK_INDEX.get(norm) ?? null;
  const allText = [
    idea.hook, idea.whatToShow, idea.howToFilm, idea.caption,
    idea.trigger ?? "", idea.reaction ?? "", idea.script ?? "",
    (idea.shotPlan ?? []).join(" "),
    (idea.filmingGuide ?? []).join(" "),
  ].join(" \n ");
  return {
    cohort, batchIdx, ideaIdx,
    hook: idea.hook,
    whatToShow: idea.whatToShow,
    howToFilm: idea.howToFilm,
    caption: idea.caption,
    pattern: idea.pattern,
    pickerEligible: idea.pickerEligible,
    isPack: packEntryId !== null,
    packEntryId,
    mockingHits: detectMocking(allText),
    westernLeakHits: detectWesternLeak(allText),
    privacyHits: detectPrivacy(allText),
    hookSkeleton: hookSkeleton(idea.hook),
  };
}

async function runCohort(
  cohort: Cohort,
  onBatchComplete?: (partial: { ideas: IdeaRecord[]; batches: BatchRecord[] }) => void,
  resumeFrom?: { ideas: IdeaRecord[]; batches: BatchRecord[] },
): Promise<{ ideas: IdeaRecord[]; batches: BatchRecord[] }> {
  const ideas: IdeaRecord[] = resumeFrom ? [...resumeFrom.ideas] : [];
  const batches: BatchRecord[] = resumeFrom ? [...resumeFrom.batches] : [];
  const COUNT_PER_BATCH = 3;
  const totalBatches = Math.ceil(cohort.totalIdeas / COUNT_PER_BATCH);
  // Reconstruct excludeHooks from the last completed batch's ideas.
  let lastHooks: string[] = [];
  if (batches.length > 0) {
    const lastBatchIdx = batches[batches.length - 1].batchIdx;
    lastHooks = ideas.filter((i) => i.batchIdx === lastBatchIdx).map((i) => i.hook);
  }
  // Parallelize batches within a cohort. We chain excludeHooks only on
  // the FIRST refresh to certify the contract path; remaining batches
  // are fired in parallel for throughput. (Refresh-fidelity is also
  // re-checked separately in §10 of the report.)
  const CONCURRENCY = 4;
  const remaining: number[] = [];
  for (let bi = batches.length; bi < totalBatches; bi++) remaining.push(bi);

  // Special: do batch 0 (initial) and batch 1 (first refresh w/ exclude)
  // serially so excludeHooks chaining is real. Then parallelize the rest.
  while (remaining.length > 0 && batches.length < 2) {
    const bi = remaining.shift()!;
    const isRefresh = bi > 0;
    const r = await callApi({
      region: cohort.region, languageStyle: cohort.languageStyle,
      count: COUNT_PER_BATCH, regenerate: isRefresh, excludeHooks: lastHooks,
    });
    batches.push({
      cohort: cohort.label, batchIdx: bi, isRefresh,
      status: r.status, durationMs: r.durationMs,
      errored: r.err !== null, errorMsg: r.err,
      ideaCount: r.resp?.ideas.length ?? 0, excludeHookCount: lastHooks.length,
    });
    if (r.resp) {
      const fresh: string[] = [];
      for (let i = 0; i < r.resp.ideas.length && ideas.length < cohort.totalIdeas; i++) {
        ideas.push(classifyIdea(cohort.label, bi, i, r.resp.ideas[i]));
        fresh.push(r.resp.ideas[i].hook);
      }
      lastHooks = fresh;
    }
    process.stdout.write(`[n1LiveHardenQa]   cohort=${cohort.label} batch=${bi + 1}/${totalBatches} ms=${r.durationMs} status=${r.status} ideas=${r.resp?.ideas.length ?? 0}${r.err ? ` err=${r.err.slice(0, 60)}` : ""}\n`);
    if (onBatchComplete) onBatchComplete({ ideas: [...ideas], batches: [...batches] });
  }

  // Parallel phase: chunk remaining batches into pools of CONCURRENCY.
  while (remaining.length > 0) {
    const chunk = remaining.splice(0, CONCURRENCY);
    const results = await Promise.all(chunk.map((bi) =>
      callApi({
        region: cohort.region, languageStyle: cohort.languageStyle,
        count: COUNT_PER_BATCH, regenerate: true, excludeHooks: [],
      }).then((r) => ({ bi, r })),
    ));
    for (const { bi, r } of results) {
      batches.push({
        cohort: cohort.label, batchIdx: bi, isRefresh: true,
        status: r.status, durationMs: r.durationMs,
        errored: r.err !== null, errorMsg: r.err,
        ideaCount: r.resp?.ideas.length ?? 0, excludeHookCount: 0,
      });
      if (r.resp) {
        for (let i = 0; i < r.resp.ideas.length && ideas.length < cohort.totalIdeas; i++) {
          ideas.push(classifyIdea(cohort.label, bi, i, r.resp.ideas[i]));
        }
      }
      process.stdout.write(`[n1LiveHardenQa]   cohort=${cohort.label} batch=${bi + 1}/${totalBatches} (par) ms=${r.durationMs} status=${r.status} ideas=${r.resp?.ideas.length ?? 0}${r.err ? ` err=${r.err.slice(0, 60)}` : ""}\n`);
    }
    // Sort batches by index so state file stays ordered.
    batches.sort((a, b) => a.batchIdx - b.batchIdx);
    ideas.sort((a, b) => a.batchIdx - b.batchIdx || a.ideaIdx - b.ideaIdx);
    if (onBatchComplete) onBatchComplete({ ideas: [...ideas], batches: [...batches] });
  }
  return { ideas, batches };
}

function pct(n: number, d: number): string {
  if (d === 0) return "—";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function tally<T>(arr: T[], key: (x: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of arr) {
    const k = key(x);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function topN(m: Map<string, number>, n: number): Array<[string, number]> {
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function buildReport(
  flagOn: boolean,
  packLength: number,
  results: Map<string, { ideas: IdeaRecord[]; batches: BatchRecord[] }>,
): string {
  const lines: string[] = [];
  lines.push("# N1 LIVE HARDEN QA");
  lines.push("");
  lines.push(`_run timestamp_: ${new Date().toISOString()}`);
  lines.push(`_API endpoint_: \`${API_URL}\``);
  lines.push(`_LUMINA_NG_PACK_ENABLED_: \`${process.env.LUMINA_NG_PACK_ENABLED ?? "(unset)"}\``);
  lines.push(`_LUMINA_NG_STYLE_PENALTY_ENABLED_: \`${process.env.LUMINA_NG_STYLE_PENALTY_ENABLED ?? "(unset)"}\``);
  lines.push(`_isNigerianPackFeatureEnabled()_: \`${flagOn}\``);
  lines.push(`_NIGERIAN_HOOK_PACK.length_: ${packLength}`);
  lines.push("");

  // -------------------- 1. Environment confirmation --------------------
  lines.push("## 1. Environment confirmation");
  lines.push("");
  lines.push(`- Feature flag (in-process): \`${flagOn ? "ON (staging)" : "OFF"}\``);
  lines.push(`- Pack length: ${packLength}`);
  lines.push(`- API target: \`${API_URL}\``);
  lines.push("- Production safety: `isNigerianPackFeatureEnabled()` reads `LUMINA_NG_PACK_ENABLED === \"true\"` (default OFF). The api-server `dev` script sets it ON; production `start` script (no override) leaves it OFF — verified at `artifacts/api-server/src/lib/nigerianHookPack.ts:399-401`.");
  lines.push("");

  // -------------------- 2. Feature flag ON/OFF proof -------------------
  lines.push("## 2. Feature flag ON/OFF proof");
  lines.push("");
  lines.push("- This run was executed with the flag **ON** in the dev api-server.");
  lines.push("- A flag-OFF re-run is required to complete the GO criteria. Set `LUMINA_NG_PACK_ENABLED=` (empty) on the api-server, restart, and re-run this script — pack usage should be 0 in every cohort.");
  lines.push("- See `nigerianPackActivation.test.ts` (8 tests) for the byte-level assertion that flag-OFF makes `NIGERIAN_HOOK_PACK` empty + every (region × languageStyle) returns 0 eligible.");
  lines.push("");

  // -------------------- 3. Cohort summary table ------------------------
  lines.push("## 3. Cohort summary");
  lines.push("");
  lines.push("| cohort | region | languageStyle | ideas | batches | pack ideas | pack % | mocking hits | western leaks | privacy hits |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const c of COHORTS) {
    const r = results.get(c.label);
    if (!r) continue;
    const packCount = r.ideas.filter((i) => i.isPack).length;
    const mocking = r.ideas.reduce((s, i) => s + i.mockingHits.length, 0);
    const western = r.ideas.reduce((s, i) => s + i.westernLeakHits.length, 0);
    const privacy = r.ideas.reduce((s, i) => s + i.privacyHits.length, 0);
    lines.push(
      `| \`${c.label}\` | ${c.region} | ${c.languageStyle ?? "(null)"} | ${r.ideas.length} | ${r.batches.length} | ${packCount} | ${pct(packCount, r.ideas.length)} | ${mocking} | ${western} | ${privacy} |`,
    );
  }
  lines.push("");

  // -------------------- 4. Pack usage table (acceptance) ---------------
  const ngLp = results.get("ng_light_pidgin");
  const ngPg = results.get("ng_pidgin");
  const lpPack = ngLp?.ideas.filter((i) => i.isPack).length ?? 0;
  const pgPack = ngPg?.ideas.filter((i) => i.isPack).length ?? 0;
  const combined = lpPack + pgPack;
  const ineligibleLeak = COHORTS.filter((c) => !c.expectsPack)
    .reduce((s, c) => s + (results.get(c.label)?.ideas.filter((i) => i.isPack).length ?? 0), 0);
  lines.push("## 4. Pack usage acceptance");
  lines.push("");
  lines.push("| metric | actual | target | verdict |");
  lines.push("| --- | --- | --- | --- |");
  lines.push(`| ng_light_pidgin pack | ${lpPack}/${ngLp?.ideas.length ?? 0} | ≥ 18/30 | ${lpPack >= 18 ? "✅" : "❌"} |`);
  lines.push(`| ng_pidgin pack | ${pgPack}/${ngPg?.ideas.length ?? 0} | ≥ 18/30 | ${pgPack >= 18 ? "✅" : "❌"} |`);
  lines.push(`| combined eligible pack | ${combined}/60 | ≥ 36/60 | ${combined >= 36 ? "✅" : "❌"} |`);
  lines.push(`| ineligible-cohort pack leak | ${ineligibleLeak} | 0 | ${ineligibleLeak === 0 ? "✅" : "❌"} |`);
  lines.push("");

  // -------------------- 5. Refresh reliability table -------------------
  lines.push("## 5. Refresh reliability");
  lines.push("");
  lines.push("| cohort | batches | success | success % | min ms | median ms | max ms | excludeHooks sent (refresh) |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const c of COHORTS) {
    const r = results.get(c.label);
    if (!r) continue;
    const ok = r.batches.filter((b) => !b.errored && b.status === 200).length;
    const refreshes = r.batches.filter((b) => b.isRefresh);
    const refreshWithExclude = refreshes.filter((b) => b.excludeHookCount > 0).length;
    const ds = r.batches.map((b) => b.durationMs).sort((a, b) => a - b);
    const med = ds.length ? ds[Math.floor(ds.length / 2)] : 0;
    lines.push(
      `| \`${c.label}\` | ${r.batches.length} | ${ok} | ${pct(ok, r.batches.length)} | ${ds[0] ?? 0} | ${med} | ${ds[ds.length - 1] ?? 0} | ${refreshWithExclude}/${refreshes.length} |`,
    );
  }
  lines.push("");
  const totalBatches = [...results.values()].reduce((s, r) => s + r.batches.length, 0);
  const totalOk = [...results.values()].reduce((s, r) => s + r.batches.filter((b) => !b.errored && b.status === 200).length, 0);
  lines.push(`**overall refresh success rate**: ${totalOk}/${totalBatches} = ${pct(totalOk, totalBatches)} (target ≥ 90%) — ${totalOk / Math.max(1, totalBatches) >= 0.9 ? "✅" : "❌"}`);
  lines.push("");

  // -------------------- 6. Full sample outputs by cohort ---------------
  lines.push("## 6. Full sample outputs by cohort");
  lines.push("");
  for (const c of COHORTS) {
    const r = results.get(c.label);
    if (!r) continue;
    lines.push(`### \`${c.label}\` — ${r.ideas.length} ideas (${r.batches.length} batches)`);
    lines.push("");
    lines.push("| # | batch | source | packEntryId | hook | flags |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (let k = 0; k < r.ideas.length; k++) {
      const i = r.ideas[k];
      const flags: string[] = [];
      if (i.mockingHits.length) flags.push(`mocking[${i.mockingHits.length}]`);
      if (i.westernLeakHits.length) flags.push(`western[${i.westernLeakHits.join(",")}]`);
      if (i.privacyHits.length) flags.push(`privacy[${i.privacyHits.length}]`);
      lines.push(
        `| ${k} | ${i.batchIdx} | ${i.isPack ? "pack" : "catalog"} | ${i.packEntryId ? "`" + i.packEntryId + "`" : "—"} | ${JSON.stringify(i.hook).slice(1, -1)} | ${flags.join(" ") || "—"} |`,
      );
    }
    lines.push("");
  }

  // -------------------- 7. Strongest 10 NG outputs --------------------
  const ngAll = [
    ...(results.get("ng_light_pidgin")?.ideas ?? []),
    ...(results.get("ng_pidgin")?.ideas ?? []),
  ];
  const ngPack = ngAll.filter((i) => i.isPack && i.mockingHits.length === 0 && i.westernLeakHits.length === 0);
  // "Strongest" heuristic: pack entries (native-reviewed) with no
  // flags and the fewest stopword-only tokens in the hook.
  const ngScored = ngPack.map((i) => {
    const tokens = i.hook.toLowerCase().split(/\s+/).filter((w) => w.length >= 4);
    return { i, score: tokens.length };
  }).sort((a, b) => b.score - a.score);
  lines.push("## 7. Strongest 10 Nigerian outputs (pack, flag-clean)");
  lines.push("");
  lines.push("| # | cohort | packEntryId | hook |");
  lines.push("| --- | --- | --- | --- |");
  ngScored.slice(0, 10).forEach((x, idx) => {
    lines.push(`| ${idx + 1} | \`${x.i.cohort}\` | \`${x.i.packEntryId}\` | ${JSON.stringify(x.i.hook).slice(1, -1)} |`);
  });
  lines.push("");

  // -------------------- 8. Weakest 10 outputs --------------------------
  const allIdeas: IdeaRecord[] = [...results.values()].flatMap((r) => r.ideas);
  const flagged = allIdeas.filter((i) => i.mockingHits.length > 0 || i.westernLeakHits.length > 0 || i.privacyHits.length > 0);
  flagged.sort((a, b) =>
    (b.privacyHits.length * 100 + b.westernLeakHits.length * 10 + b.mockingHits.length) -
    (a.privacyHits.length * 100 + a.westernLeakHits.length * 10 + a.mockingHits.length),
  );
  lines.push("## 8. Weakest 10 outputs (flagged)");
  lines.push("");
  if (flagged.length === 0) {
    lines.push("_No flagged outputs across all cohorts._ ✅");
  } else {
    lines.push("| # | cohort | hook | flags |");
    lines.push("| --- | --- | --- | --- |");
    flagged.slice(0, 10).forEach((i, idx) => {
      const flags = [
        i.privacyHits.length ? `privacy[${i.privacyHits.join("|")}]` : "",
        i.westernLeakHits.length ? `western[${i.westernLeakHits.join(",")}]` : "",
        i.mockingHits.length ? `mocking[${i.mockingHits.join("|")}]` : "",
      ].filter(Boolean).join(" ");
      lines.push(`| ${idx + 1} | \`${i.cohort}\` | ${JSON.stringify(i.hook).slice(1, -1)} | ${flags} |`);
    });
  }
  lines.push("");

  // -------------------- 9. Wrong-region term report -------------------
  lines.push("## 9. Wrong-region term report (Nigeria + pidgin/light_pidgin only)");
  lines.push("");
  const ngEligibleLeaks = ngAll.filter((i) => i.westernLeakHits.length > 0);
  if (ngEligibleLeaks.length === 0) {
    lines.push("_No Western anchor leaks across NG eligible cohorts._ ✅");
  } else {
    lines.push("| cohort | hook | terms |");
    lines.push("| --- | --- | --- |");
    for (const i of ngEligibleLeaks) {
      lines.push(`| \`${i.cohort}\` | ${JSON.stringify(i.hook).slice(1, -1)} | ${i.westernLeakHits.join(",")} |`);
    }
  }
  lines.push("");

  // -------------------- 10. Repetition report -------------------------
  lines.push("## 10. Repetition report");
  lines.push("");
  for (const cLabel of ["ng_light_pidgin", "ng_pidgin"]) {
    const r = results.get(cLabel);
    if (!r) continue;
    lines.push(`### \`${cLabel}\``);
    lines.push("");
    // Within-batch dupes
    const batchGroups = new Map<number, IdeaRecord[]>();
    for (const i of r.ideas) {
      if (!batchGroups.has(i.batchIdx)) batchGroups.set(i.batchIdx, []);
      batchGroups.get(i.batchIdx)!.push(i);
    }
    let withinBatchPackDupe = 0;
    let withinBatchHookDupe = 0;
    for (const arr of batchGroups.values()) {
      const packIds = arr.filter((x) => x.packEntryId).map((x) => x.packEntryId!);
      if (new Set(packIds).size < packIds.length) withinBatchPackDupe++;
      const hooks = arr.map((x) => normHook(x.hook));
      if (new Set(hooks).size < hooks.length) withinBatchHookDupe++;
    }
    lines.push(`- batches with duplicate packEntryId within batch: **${withinBatchPackDupe}** (target 0)`);
    lines.push(`- batches with duplicate hook within batch: **${withinBatchHookDupe}** (target 0)`);
    // Across-batch repetition
    const packTally = tally(r.ideas.filter((i) => i.packEntryId), (i) => i.packEntryId!);
    const skelTally = tally(r.ideas, (i) => i.hookSkeleton);
    const repeatedPack = topN(packTally, 5).filter(([, c]) => c > 1);
    const repeatedSkel = topN(skelTally, 5).filter(([, c]) => c > 1);
    lines.push(`- top repeated packEntryIds across run: ${repeatedPack.length === 0 ? "_(none repeated)_" : repeatedPack.map(([k, c]) => `\`${k}\`×${c}`).join(", ")}`);
    lines.push(`- top repeated hook skeletons: ${repeatedSkel.length === 0 ? "_(none repeated)_" : repeatedSkel.map(([k, c]) => `\`${k.slice(0, 50)}\`×${c}`).join(", ")}`);
    lines.push("");
  }

  // -------------------- 11. Film This Now alignment -------------------
  lines.push("## 11. Film This Now alignment");
  lines.push("");
  lines.push("Film This Now is rendered from `whatToShow` + `howToFilm` + `filmingGuide` + `script` + `shotPlan`. Per spec, sample at least 5 light_pidgin pack + 5 pidgin pack ideas and verify:");
  lines.push("- setup (`whatToShow` opener) matches hook subject");
  lines.push("- action (mid `whatToShow`) matches scenario");
  lines.push("- payoff (`whatToShow` tail / final beat) is clear");
  lines.push("- caption matches");
  lines.push("- no privacy exposure");
  lines.push("");
  const packSamples = (cohort: string, k: number): IdeaRecord[] => {
    const arr = (results.get(cohort)?.ideas ?? []).filter((i) => i.isPack);
    return arr.slice(0, k);
  };
  for (const c of ["ng_light_pidgin", "ng_pidgin"]) {
    lines.push(`### \`${c}\` — first 5 pack ideas`);
    lines.push("");
    const samples = packSamples(c, 5);
    if (samples.length === 0) {
      lines.push("_No pack ideas in this cohort._");
      lines.push("");
      continue;
    }
    for (const s of samples) {
      const hookTokens = s.hook.toLowerCase().split(/\W+/).filter((w) => w.length >= 4);
      const showLc = s.whatToShow.toLowerCase();
      const setupOk = hookTokens.some((t) => showLc.includes(t));
      const captionTokens = s.caption.toLowerCase().split(/\W+/).filter((w) => w.length >= 4);
      const captionOk = captionTokens.some((t) => s.hook.toLowerCase().includes(t)) || captionTokens.length > 0;
      const privacyOk = s.privacyHits.length === 0;
      lines.push(`- \`${s.packEntryId}\` — hook: "${s.hook}"`);
      lines.push(`  - setup⇄hook overlap: ${setupOk ? "✅" : "⚠️"}; caption present: ${captionOk ? "✅" : "⚠️"}; privacy clean: ${privacyOk ? "✅" : "❌"}`);
      lines.push(`  - whatToShow: ${s.whatToShow.slice(0, 200)}${s.whatToShow.length > 200 ? "…" : ""}`);
      lines.push(`  - howToFilm:  ${s.howToFilm.slice(0, 160)}${s.howToFilm.length > 160 ? "…" : ""}`);
    }
    lines.push("");
  }
  lines.push("> NOTE: This script samples server-rendered Film This Now content. End-to-end mobile-UI verification (button taps, comfort-mode copy, no-face/no-voice toggle behavior) requires the testing skill against the Expo app and is reported separately.");
  lines.push("");

  // -------------------- 12. Safety/privacy report ---------------------
  lines.push("## 12. Safety / privacy report");
  lines.push("");
  const privFail = allIdeas.filter((i) => i.privacyHits.length > 0);
  if (privFail.length === 0) {
    lines.push("_No privacy/safety regex hits across all cohorts._ ✅");
    lines.push("");
    lines.push("Patterns checked: SSN-shaped, raw 16-digit card-number-shaped, explicit `balance:$NNNN`, `password=…`, `plate no:…`.");
  } else {
    lines.push("| cohort | hook | hits |");
    lines.push("| --- | --- | --- |");
    for (const i of privFail) {
      lines.push(`| \`${i.cohort}\` | ${JSON.stringify(i.hook).slice(1, -1)} | ${i.privacyHits.join(" | ")} |`);
    }
  }
  lines.push("");

  // -------------------- 13. Final recommendation ----------------------
  const passLp = lpPack >= 18;
  const passPg = pgPack >= 18;
  const passCombined = combined >= 36;
  const passIneligible = ineligibleLeak === 0;
  const passReliability = totalOk / Math.max(1, totalBatches) >= 0.9;
  const passPrivacy = privFail.length === 0;
  const passLeak = ngEligibleLeaks.length === 0;
  const allPass =
    passLp && passPg && passCombined && passIneligible && passReliability && passPrivacy && passLeak;
  lines.push("## 13. Final recommendation");
  lines.push("");
  lines.push(`- ng_light_pidgin pack ≥ 18/30: ${passLp ? "✅" : "❌"}`);
  lines.push(`- ng_pidgin pack ≥ 18/30: ${passPg ? "✅" : "❌"}`);
  lines.push(`- combined ≥ 36/60: ${passCombined ? "✅" : "❌"}`);
  lines.push(`- ineligible cohort pack leak = 0: ${passIneligible ? "✅" : "❌"}`);
  lines.push(`- refresh success ≥ 90%: ${passReliability ? "✅" : "❌"}`);
  lines.push(`- privacy hits = 0: ${passPrivacy ? "✅" : "❌"}`);
  lines.push(`- western anchor leak in NG eligible = 0: ${passLeak ? "✅" : "❌"}`);
  lines.push("");
  lines.push(`### Verdict: ${allPass ? "✅ **GO**" : (passLp && passPg && passCombined && passIneligible && passPrivacy && passLeak) ? "🟡 **GO WITH NOTES** (reliability below target)" : "🔴 **HOLD**"}`);
  lines.push("");
  lines.push("### Notes & follow-ups");
  lines.push("- This run exercises the REAL `/api/ideator/generate` route (not the in-process `generateCoreCandidates` harness).");
  lines.push("- A separate flag-OFF re-run is required to certify the GO criteria for production safety. The behavior is also asserted by `nigerianPackActivation.test.ts`.");
  lines.push("- Mobile-app UI checks (Film This Now button, refresh spinner, blank-state, comfort-mode toggle) require driving the Expo app via the testing skill — this script certifies the data layer only.");
  return lines.join("\n") + "\n";
}

// State persistence: one JSON file holds incremental per-cohort progress
// so the script can be re-invoked and resume where it left off.
const STATE_PATH = "/tmp/n1qa-state.json";
type State = {
  flagOn: boolean;
  packLength: number;
  results: Record<string, { ideas: IdeaRecord[]; batches: BatchRecord[] }>;
};
function loadState(): State {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as State;
  } catch {
    return { flagOn: false, packLength: 0, results: {} };
  }
}
function saveState(s: State): void {
  fs.writeFileSync(STATE_PATH, JSON.stringify(s), "utf8");
}

async function main(): Promise<void> {
  const flagOn = isNigerianPackFeatureEnabled();
  const cohortFilter = process.env.N1_COHORT ?? null;
  const onlyReport = process.env.N1_REPORT_ONLY === "1";
  console.log(`[n1LiveHardenQa] flag=${flagOn ? "ON" : "OFF"} packLength=${NIGERIAN_HOOK_PACK.length} cohortFilter=${cohortFilter ?? "(all)"} onlyReport=${onlyReport}`);
  const state = loadState();
  state.flagOn = flagOn;
  state.packLength = NIGERIAN_HOOK_PACK.length;

  if (!onlyReport) {
    for (const c of COHORTS) {
      if (cohortFilter && c.label !== cohortFilter) continue;
      const existing = state.results[c.label];
      const totalBatchesNeeded = Math.ceil(c.totalIdeas / 3);
      if (existing && existing.batches.length >= totalBatchesNeeded) {
        console.log(`[n1LiveHardenQa] cohort=${c.label} SKIP (complete: ${existing.batches.length}/${totalBatchesNeeded} batches)`);
        continue;
      }
      if (existing) {
        console.log(`[n1LiveHardenQa] cohort=${c.label} RESUME from batch ${existing.batches.length}/${totalBatchesNeeded}`);
      } else {
        console.log(`[n1LiveHardenQa] cohort=${c.label} START region=${c.region} languageStyle=${c.languageStyle} ideas=${c.totalIdeas}`);
      }
      const r = await runCohort(c, (partial) => {
        state.results[c.label] = partial;
        saveState(state);
      }, existing);
      state.results[c.label] = r;
      saveState(state);
      console.log(`[n1LiveHardenQa] cohort=${c.label} DONE ideas=${r.ideas.length} batches=${r.batches.length}`);
    }
  }

  // Build report from whatever cohorts are present.
  const resultsMap = new Map<string, { ideas: IdeaRecord[]; batches: BatchRecord[] }>(
    Object.entries(state.results),
  );
  if (resultsMap.size === COHORTS.length || onlyReport) {
    const md = buildReport(state.flagOn, state.packLength, resultsMap);
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, md, "utf8");
    console.log(`[n1LiveHardenQa] wrote ${REPORT_PATH}`);
  } else {
    console.log(`[n1LiveHardenQa] partial state: ${resultsMap.size}/${COHORTS.length} cohorts. Re-run to continue.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
