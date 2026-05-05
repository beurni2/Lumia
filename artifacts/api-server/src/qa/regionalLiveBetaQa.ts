/**
 * STAGED REGIONAL BETA — FINAL LIVE QA GATE
 *
 * Drives `runHybridIdeator` once per region against the seeded demo
 * creator with `count=20`, capturing the FULL per-idea field set
 * the rollout checklist requires (hook / whatToShow / howToFilm /
 * caption / source / fallback / region anchor used / scenario
 * coherence / human-filmable / regional relevance / forced or
 * stereotyped / safety / notes), 3 Film-This-Now examples per
 * region, and the aggregate kept-rate / fallback delta / anchor
 * usage block.
 *
 * Heuristic flags (filmable / regional / stereotype / safety) are
 * deliberately conservative — they SURFACE candidates for human
 * review rather than auto-approve. Each per-idea row reports the
 * heuristic verdict AND the trigger phrase so the reviewer can
 * verify or override.
 *
 * Output: `.local/REGIONAL_LIVE_BETA_QA.md`
 *
 * Run: `pnpm exec tsx artifacts/api-server/src/qa/regionalLiveBetaQa.ts`
 *
 * No DB writes, no schema changes, no API surface changes.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { db, schema } from "../db/client";
import { eq } from "drizzle-orm";
import { runHybridIdeator } from "../lib/hybridIdeator";
import { validateScenarioCoherence } from "../lib/scenarioCoherence";
import { styleProfileSchema } from "../lib/styleProfile";
import { REGIONS, type Region } from "@workspace/lumina-trends";
import { ideaWasRegionDecorated } from "../lib/regionProfile";
import { REGION_ANCHORS } from "../lib/regionAnchorCatalog";
import type { Idea } from "../lib/ideaGen";

// ---------------------------------------------------------------- //
// Heuristic signal definitions                                       //
// ---------------------------------------------------------------- //

// Stereotype phrases per region — the EXACT things the R2 prompt
// block told the model to avoid. Two or more of these in the same
// idea (or one of the truly canonical clichés) trips the flag.
const STEREOTYPE_PATTERNS: Record<Region, RegExp[]> = {
  western: [],
  nigeria: [
    /\bnepa\b/i,
    /\blight just (took|gone)\b/i,
    /\bnigerian time\b/i,
    /\bauntie [a-z]+ said\b/i,
  ],
  india: [
    /\bbhai bhai\b/i,
    /\baunty ji\b/i,
    /\bbollywood (style|drama)\b/i,
  ],
  philippines: [
    /\bsana all\b/i,
    /\btita drama\b/i,
    /\bbeauty queen\b/i,
  ],
};

// Heavy-dialect tokens — counting these gives a "forced slang" signal.
// The R2 prompt block says light dialect (1 in 4-5 hooks) is fine, so
// we only flag when 3+ heavy tokens land in a single short idea.
const DIALECT_TOKENS: Record<Region, RegExp[]> = {
  western: [],
  nigeria: [/\babeg\b/i, /\bomo\b/i, /\bwahala\b/i, /\bna so\b/i, /\bjare\b/i],
  india: [/\byaar\b/i, /\bbhai\b/i, /\bbhaiya\b/i, /\bdidi\b/i, /\barrey\b/i],
  philippines: [/\bbes\b/i, /\blodi\b/i, /\bpetmalu\b/i, /\bcharot\b/i, /\bteh\b/i],
};

// Safety triggers — references to REAL screen content. R2 says use
// fake / cropped / demo screens for any chat / payment / app data.
const SAFETY_PATTERNS: RegExp[] = [
  /\breal\s+(balance|chat|message|account|number|name|address)\b/i,
  /\bactual\s+(balance|chat|message|account|number|gcash|upi|swiggy)\b/i,
  /\bmy\s+(real|actual)\s+\w+/i,
  /\bshow(?:ing)?\s+(?:my|the)\s+(?:real|actual)\b/i,
];

// Filmability red flags — howToFilm requirements that violate the
// "single phone, no crew, <30 min, executable solo" contract.
const UNFILMABLE_PATTERNS: RegExp[] = [
  /\b(?:second|another)\s+(?:person|actor|friend|partner)\b/i,
  /\b(?:two|2)\s+(?:phones|cameras|tripods)\b/i,
  /\b(?:hire|cast|recruit)\b/i,
  /\bchange\s+(?:locations?|outfits?)\s+(?:multiple|several|many)\s+times\b/i,
  /\b(?:camera\s+crew|film\s+crew|production\s+team)\b/i,
];

// Generic verb-object nonsense — hooks that don't commit to a
// concrete action. Heuristic: hook is short AND contains a vague
// filler phrase.
const GENERIC_NONSENSE_PATTERNS: RegExp[] = [
  /\bdoing\s+(?:the|a|that|this)\s+thing\b/i,
  /\b(?:that|this|the)\s+random\s+thing\b/i,
  /\bsomething\s+(?:weird|random|crazy)\s+(?:happens?|happened)\b/i,
];

// Region-relevance signal: idea text contains a region-anchor token.
// Pre-computed lower-cased per region.
const REGION_ANCHOR_TOKENS: Record<Region, string[]> = {
  western: [],
  nigeria: REGION_ANCHORS.nigeria.flatMap((r) => r.anchors.map((a) => a.toLowerCase())),
  india: REGION_ANCHORS.india.flatMap((r) => r.anchors.map((a) => a.toLowerCase())),
  philippines: REGION_ANCHORS.philippines.flatMap((r) =>
    r.anchors.map((a) => a.toLowerCase()),
  ),
};

// ---------------------------------------------------------------- //
// Helpers                                                           //
// ---------------------------------------------------------------- //

function ideaText(idea: Idea): string {
  return [
    idea.hook,
    idea.whatToShow ?? "",
    idea.howToFilm ?? "",
    idea.caption ?? "",
    idea.whyItWorks ?? "",
    idea.trigger ?? "",
    idea.reaction ?? "",
  ].join(" \n ");
}

function detectRegionAnchor(region: Region, idea: Idea): string | null {
  const tokens = REGION_ANCHOR_TOKENS[region];
  if (tokens.length === 0) return null;
  const text = ideaText(idea).toLowerCase();
  for (const t of tokens) {
    const re = new RegExp(`\\b${t}\\b`);
    if (re.test(text)) return t;
  }
  return null;
}

function detectStereotype(region: Region, idea: Idea): string | null {
  const text = ideaText(idea);
  for (const re of STEREOTYPE_PATTERNS[region]) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}

function detectForcedDialect(region: Region, idea: Idea): string | null {
  const text = ideaText(idea);
  const hits: string[] = [];
  for (const re of DIALECT_TOKENS[region]) {
    const m = text.match(re);
    if (m) hits.push(m[0]);
  }
  // 3+ heavy-dialect tokens in one idea = forced.
  if (hits.length >= 3) return hits.join(", ");
  return null;
}

function detectSafetyIssue(idea: Idea): string | null {
  const text = ideaText(idea);
  for (const re of SAFETY_PATTERNS) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}

function detectUnfilmable(idea: Idea): string | null {
  const text = ideaText(idea);
  for (const re of UNFILMABLE_PATTERNS) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}

function detectGenericNonsense(idea: Idea): string | null {
  const text = idea.hook + " " + (idea.whatToShow ?? "");
  for (const re of GENERIC_NONSENSE_PATTERNS) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}

// ---------------------------------------------------------------- //
// Per-region run                                                     //
// ---------------------------------------------------------------- //

type RegionRun = {
  region: Region;
  ok: boolean;
  errMsg?: string;
  durationMs: number;
  ideas: Idea[];
  perIdeaSource: string[];
  perIdeaAnchor: (string | undefined)[];
  perIdeaCoreId: (string | undefined)[];
  perIdeaVoice: (string | undefined)[];
  source: string;
  usedFallback: boolean;
  rejectionReasonsCount: number;
};

async function runOneRegion(
  region: Region,
  creator: typeof schema.creators.$inferSelect,
  count: number,
  excludeHooks: string[],
): Promise<RegionRun> {
  const styleProfile = styleProfileSchema.parse({});
  const t0 = Date.now();
  try {
    const result = await runHybridIdeator({
      creator,
      region,
      styleProfile,
      count,
      regenerate: excludeHooks.length > 0,
      excludeHooks,
      ctx: { creatorId: creator.id, agentRunId: null },
    });
    const perIdea = result.qaTelemetry?.perIdea ?? [];
    return {
      region,
      ok: true,
      durationMs: Date.now() - t0,
      ideas: result.ideas,
      perIdeaSource: result.ideas.map(
        (_, i) => perIdea[i]?.source ?? result.source,
      ),
      perIdeaAnchor: result.ideas.map((_, i) => perIdea[i]?.anchor),
      perIdeaCoreId: result.ideas.map((_, i) => perIdea[i]?.premiseCoreId),
      perIdeaVoice: result.ideas.map((_, i) => perIdea[i]?.voiceClusterId),
      source: result.source,
      usedFallback: result.usedFallback,
      rejectionReasonsCount: 0,
    };
  } catch (err) {
    return {
      region,
      ok: false,
      errMsg: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - t0,
      ideas: [],
      perIdeaSource: [],
      perIdeaAnchor: [],
      perIdeaCoreId: [],
      perIdeaVoice: [],
      source: "error",
      usedFallback: false,
      rejectionReasonsCount: 0,
    };
  }
}

// ---------------------------------------------------------------- //
// Reporting                                                         //
// ---------------------------------------------------------------- //

function fmt(n: number): string {
  return n < 10 ? n.toFixed(1).replace(/\.0$/, "") : n.toFixed(0);
}

type IdeaJudgment = {
  filmable: boolean;
  filmableTrigger?: string;
  regional: boolean;
  regionalAnchor?: string;
  decorated: boolean;
  stereotype?: string;
  forcedDialect?: string;
  safety?: string;
  generic?: string;
  scenarioVerdict: string;
};

function judgeIdea(region: Region, idea: Idea): IdeaJudgment {
  const verdict = validateScenarioCoherence(idea);
  const decorated = ideaWasRegionDecorated(region, idea);
  const regionalAnchor = detectRegionAnchor(region, idea);
  const stereotype = detectStereotype(region, idea);
  const forcedDialect = detectForcedDialect(region, idea);
  const safety = detectSafetyIssue(idea);
  const generic = detectGenericNonsense(idea);
  const unfilmableTrigger = detectUnfilmable(idea);
  const filmable = verdict === null && !unfilmableTrigger;
  const regional =
    region === "western" ? true : decorated || regionalAnchor !== null;
  return {
    filmable,
    ...(unfilmableTrigger ? { filmableTrigger: unfilmableTrigger } : {}),
    regional,
    ...(regionalAnchor ? { regionalAnchor } : {}),
    decorated,
    ...(stereotype ? { stereotype } : {}),
    ...(forcedDialect ? { forcedDialect } : {}),
    ...(safety ? { safety } : {}),
    ...(generic ? { generic } : {}),
    scenarioVerdict: verdict === null ? "PASS" : `FAIL ${verdict}`,
  };
}

function ideaSection(o: RegionRun, i: number): string {
  const idea = o.ideas[i];
  if (!idea) return `_(no idea ${i + 1} returned)_\n`;
  const j = judgeIdea(o.region, idea);
  const lines: string[] = [];
  lines.push(`#### Idea ${i + 1} — core=\`${o.perIdeaCoreId[i] ?? "?"}\` · voice=\`${o.perIdeaVoice[i] ?? "?"}\``);
  lines.push("");
  lines.push(`- **hook**: ${idea.hook}`);
  lines.push(`- **whatToShow**: ${idea.whatToShow ?? "_(empty)_"}`);
  lines.push(`- **howToFilm**: ${idea.howToFilm ?? "_(empty)_"}`);
  lines.push(`- **caption**: ${idea.caption ?? "_(empty)_"}`);
  lines.push(
    `- **source / path**: \`${o.perIdeaSource[i]}\` · usedFallback (batch): ${o.usedFallback ? "YES" : "no"}`,
  );
  lines.push(
    `- **region anchor used**: ${j.regionalAnchor ? `YES (\`${j.regionalAnchor}\`)` : "no"} · catalog anchor=\`${o.perIdeaAnchor[i] ?? "?"}\` · decorated=${j.decorated ? "YES" : "no"}`,
  );
  lines.push(`- **scenarioCoherence**: ${j.scenarioVerdict}`);
  lines.push(
    `- **human-filmable** (heuristic): ${j.filmable ? "YES" : `NO (${j.filmableTrigger ?? j.scenarioVerdict})`}`,
  );
  lines.push(
    `- **regional relevance** (heuristic): ${j.regional ? "YES" : "no"}`,
  );
  lines.push(
    `- **forced/stereotyped** (heuristic): ${j.stereotype || j.forcedDialect ? `YES (${j.stereotype ?? j.forcedDialect})` : "no"}`,
  );
  lines.push(
    `- **safety issue** (heuristic): ${j.safety ? `YES (${j.safety})` : "no"}`,
  );
  lines.push(
    `- **generic nonsense** (heuristic): ${j.generic ? `YES (${j.generic})` : "no"}`,
  );
  lines.push(
    `- **notes**: ${[
      !j.filmable ? "filmability failure" : null,
      !j.regional && o.region !== "western" ? "no regional grounding" : null,
      j.stereotype ? "stereotype trigger" : null,
      j.forcedDialect ? "heavy dialect" : null,
      j.safety ? "safety trigger" : null,
      j.generic ? "generic phrasing" : null,
    ]
      .filter(Boolean)
      .join("; ") || "none"}`,
  );
  lines.push("");
  return lines.join("\n");
}

function filmThisNow(idea: Idea): string {
  const totalLen = idea.videoLengthSec;
  const hookSec = Math.max(0.5, idea.hookSeconds);
  const remainder = Math.max(2, totalLen - hookSec);
  const actionEnd = hookSec + remainder * (1 / 3);
  const twistEnd = hookSec + remainder * (2 / 3);
  const sp = idea.shotPlan;
  const twistBody =
    Array.isArray(sp) && sp.length >= 2 && sp[1] ? sp[1] : (idea.trigger ?? "");
  const lines: string[] = [];
  lines.push("| Beat | Time | Body |");
  lines.push("| --- | --- | --- |");
  lines.push(`| **SETUP** | _pre-roll_ | ${(idea.whatToShow ?? "").replace(/\|/g, "\\|")} |`);
  lines.push(`| **HOOK / OVERLAY** | 0–${fmt(hookSec)}s | ${idea.hook.replace(/\|/g, "\\|")} |`);
  lines.push(`| **ACTION** | ${fmt(hookSec)}–${fmt(actionEnd)}s | ${(idea.howToFilm ?? "").slice(0, 160).replace(/\|/g, "\\|")} |`);
  lines.push(`| **TWIST / REVEAL** | ${fmt(actionEnd)}–${fmt(twistEnd)}s | ${twistBody.replace(/\|/g, "\\|")} |`);
  lines.push(`| **PAYOFF** | ${fmt(twistEnd)}–${fmt(totalLen)}s | ${(idea.reaction ?? "").replace(/\|/g, "\\|")} |`);
  lines.push("");
  if (idea.caption) lines.push(`**CAPTION**: ${idea.caption}`);
  return lines.join("\n");
}

function renderRegionSection(o: RegionRun, COUNT_PER_REGION: number, passLabel = "1"): string[] {
  const lines: string[] = [];
  lines.push("---");
  lines.push("");
  lines.push(`## Region: \`${o.region}\` — pass ${passLabel}`);
  lines.push("");
  if (!o.ok) {
    lines.push(`**RUN FAILED** after ${o.durationMs}ms — ${o.errMsg}`);
    lines.push("");
    return lines;
  }
  lines.push(
    `- **shipped**: ${o.ideas.length}/${COUNT_PER_REGION} ideas · **source**: \`${o.source}\` · **fallback used**: ${o.usedFallback ? "YES" : "no"} · **duration**: ${o.durationMs}ms`,
  );
  lines.push("");
  const judgments = o.ideas.map((idea) => judgeIdea(o.region, idea));
  const filmable = judgments.filter((j) => j.filmable).length;
  const regional = judgments.filter((j) => j.regional).length;
  const stereotype = judgments.filter((j) => j.stereotype).length;
  const forcedDialect = judgments.filter((j) => j.forcedDialect).length;
  const safety = judgments.filter((j) => j.safety).length;
  const generic = judgments.filter((j) => j.generic).length;
  const scenarioFails = judgments.filter((j) =>
    j.scenarioVerdict.startsWith("FAIL"),
  ).length;
  const regionalAnchorHits = judgments.filter((j) => j.regionalAnchor).length;
  const decoratedCount = judgments.filter((j) => j.decorated).length;
  lines.push(
    `- **filmable**: ${filmable}/${o.ideas.length} (target ≥${Math.ceil(o.ideas.length * 0.9)})`,
  );
  lines.push(
    `- **regionally relevant**: ${regional}/${o.ideas.length}` +
      (o.region === "western"
        ? " _(western: trivially true)_"
        : ` (target ≥${Math.ceil(o.ideas.length * 0.5)} = 50%)`),
  );
  lines.push(`- **regional anchor hits**: ${regionalAnchorHits}/${o.ideas.length}`);
  lines.push(`- **decoration coverage**: ${decoratedCount}/${o.ideas.length}`);
  lines.push(`- **scenario failures**: ${scenarioFails} (target 0)`);
  lines.push(`- **stereotype triggers**: ${stereotype} (target 0)`);
  lines.push(`- **forced-dialect triggers**: ${forcedDialect} (target 0)`);
  lines.push(`- **safety triggers**: ${safety} (target 0)`);
  lines.push(`- **generic-nonsense triggers**: ${generic} (target 0)`);
  lines.push("");
  lines.push("### Per-idea details");
  lines.push("");
  for (let i = 0; i < o.ideas.length; i++) {
    lines.push(ideaSection(o, i));
  }
  const ftnIndices: number[] = [];
  for (let i = 0; i < o.ideas.length && ftnIndices.length < 3; i++) {
    if (judgments[i]!.filmable) ftnIndices.push(i);
  }
  if (ftnIndices.length > 0) {
    lines.push("### Film-This-Now examples");
    lines.push("");
    for (const idx of ftnIndices) {
      lines.push(`#### FTN ${ftnIndices.indexOf(idx) + 1} — Idea ${idx + 1}`);
      lines.push("");
      lines.push(filmThisNow(o.ideas[idx]!));
      lines.push("");
      lines.push(
        "_Comfort mode adaptation_: shoot from the couch holding the phone — no setup change required.",
      );
      lines.push("");
    }
  }
  const anchorCounts = new Map<string, number>();
  for (const a of o.perIdeaAnchor) {
    if (!a) continue;
    anchorCounts.set(a, (anchorCounts.get(a) ?? 0) + 1);
  }
  const topAnchors = [...anchorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (topAnchors.length > 0) {
    lines.push(
      `**top anchors**: ${topAnchors.map(([a, n]) => `\`${a}\`×${n}`).join(", ")}`,
    );
    lines.push("");
  }
  return lines;
}

// ---------------------------------------------------------------- //
// Main                                                              //
// ---------------------------------------------------------------- //

async function main(): Promise<void> {
  const COUNT_PER_REGION = Number(process.env.QA_COUNT ?? 20);

  const demo = (
    await db
      .select()
      .from(schema.creators)
      .where(eq(schema.creators.isDemo, true))
      .limit(1)
  )[0];
  if (!demo) {
    console.error("No demo creator seeded — abort.");
    process.exit(1);
  }

  const lines: string[] = [];
  lines.push("# STAGED REGIONAL BETA — FINAL LIVE QA GATE");
  lines.push("");
  lines.push(
    `_Generated by_ \`pnpm exec tsx artifacts/api-server/src/qa/regionalLiveBetaQa.ts\` — count=${COUNT_PER_REGION}/region`,
  );
  lines.push("");
  lines.push(
    "This harness drives the **live** `runHybridIdeator` orchestrator (local cohesive author primary, Claude Haiku 4.5 fallback only) for each region. Each idea is graded against the rollout checklist via conservative regex heuristics — flags SURFACE candidates for human review, they do NOT auto-approve. The trigger phrase is included for every flag so the reviewer can verify or override.",
  );
  lines.push("");

  const __filename = fileURLToPath(import.meta.url);
  const workspaceRoot = path.resolve(path.dirname(__filename), "../../../..");
  const outDir = path.join(workspaceRoot, ".local");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "REGIONAL_LIVE_BETA_QA.md");

  // Optional region filter so we can split runs across multiple
  // invocations when the live orchestrator approaches the bash budget.
  const filter = process.env.QA_REGIONS?.split(",").map((s) => s.trim()).filter(Boolean);
  const targetRegions = (filter && filter.length > 0
    ? filter.filter((r) => (REGIONS as readonly string[]).includes(r))
    : REGIONS) as readonly Region[];

  // Append-mode: if QA_APPEND=1, append to existing file (don't reset header).
  const append = process.env.QA_APPEND === "1";
  if (!append) {
    fs.writeFileSync(outPath, lines.join("\n"), "utf8");
    lines.length = 0;
  }

  // Optional excludeHooks chaining: pass=2 reads /tmp/qa_hooks_<region>.json
  // from a prior pass=1 run and feeds them as `excludeHooks` so the second
  // batch produces distinct ideas (lets us hit count=20 across 2 invocations
  // when the bash 120s/call budget can't fit a single count=20 run).
  const passLabel = process.env.QA_PASS ?? "1";

  const allRuns: RegionRun[] = [];
  for (const region of targetRegions) {
    const excludeFile = `/tmp/qa_hooks_${region}.json`;
    const excludeHooks: string[] =
      passLabel !== "1" && fs.existsSync(excludeFile)
        ? (JSON.parse(fs.readFileSync(excludeFile, "utf8")) as string[])
        : [];
    console.error(
      `[liveBetaQa] running region=${region} count=${COUNT_PER_REGION} pass=${passLabel} excludeHooks=${excludeHooks.length}…`,
    );
    const o = await runOneRegion(region, demo, COUNT_PER_REGION, excludeHooks);
    allRuns.push(o);
    console.error(
      `[liveBetaQa]   region=${region} ok=${o.ok} ideas=${o.ideas.length} ms=${o.durationMs} fallback=${o.usedFallback}`,
    );
    // Persist this batch's hooks so a later pass can exclude them.
    const accumulated = [...excludeHooks, ...o.ideas.map((i) => i.hook)];
    fs.writeFileSync(excludeFile, JSON.stringify(accumulated), "utf8");
    // Flush this region's section immediately so a downstream timeout
    // can't wipe the work we already paid for.
    const regionLines = renderRegionSection(o, COUNT_PER_REGION, passLabel);
    fs.appendFileSync(outPath, regionLines.join("\n") + "\n", "utf8");
  }

  // -------- Aggregate ------------------------------------------- //
  lines.push("---");
  lines.push("");
  lines.push("## Aggregate (cross-region)");
  lines.push("");
  const western = allRuns.find((r) => r.region === "western");
  const westernKept = western ? western.ideas.length : 0;
  const westernExpected = COUNT_PER_REGION;
  const westernKeepRate = westernExpected
    ? westernKept / westernExpected
    : 0;
  const westernFallback = western?.usedFallback ?? false;

  lines.push("| region | shipped/req | kept-rate | fallback | duration |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const o of allRuns) {
    lines.push(
      `| \`${o.region}\` | ${o.ideas.length}/${COUNT_PER_REGION} | ${(
        (o.ideas.length / COUNT_PER_REGION) *
        100
      ).toFixed(0)}% | ${o.usedFallback ? "YES" : "no"} | ${o.durationMs}ms |`,
    );
  }
  lines.push("");
  lines.push(`**Western kept-rate baseline**: ${(westernKeepRate * 100).toFixed(0)}%`);
  lines.push(`**Western fallback triggered**: ${westernFallback ? "YES" : "no"}`);
  lines.push("");
  for (const o of allRuns) {
    if (o.region === "western") continue;
    const delta = o.ideas.length - westernKept;
    const fallbackDelta =
      Number(o.usedFallback) - Number(westernFallback);
    lines.push(
      `- \`${o.region}\` vs western: kept Δ=${delta >= 0 ? "+" : ""}${delta}, fallback Δ=${fallbackDelta >= 0 ? "+" : ""}${fallbackDelta}`,
    );
  }
  lines.push("");

  // Cross-region rollout verdict.
  const verdicts: { region: Region; pass: boolean; reasons: string[] }[] = [];
  for (const o of allRuns) {
    if (!o.ok) {
      verdicts.push({ region: o.region, pass: false, reasons: ["run failed"] });
      continue;
    }
    const total = o.ideas.length;
    if (total === 0) {
      verdicts.push({ region: o.region, pass: false, reasons: ["zero ideas"] });
      continue;
    }
    const judgments = o.ideas.map((idea) => judgeIdea(o.region, idea));
    const filmable = judgments.filter((j) => j.filmable).length;
    const regional = judgments.filter((j) => j.regional).length;
    const reasons: string[] = [];
    const filmableTarget = Math.ceil(total * 0.9);
    if (filmable < filmableTarget) {
      reasons.push(`filmable ${filmable}/${total} < ${filmableTarget}`);
    }
    if (judgments.some((j) => j.scenarioVerdict.startsWith("FAIL"))) {
      reasons.push("scenarioCoherence failures");
    }
    if (judgments.some((j) => j.stereotype || j.forcedDialect)) {
      reasons.push("stereotype / forced-dialect triggers");
    }
    if (judgments.some((j) => j.safety)) reasons.push("safety triggers");
    if (judgments.some((j) => j.generic)) reasons.push("generic nonsense");
    if (o.region !== "western") {
      const regionalTarget = Math.ceil(total * 0.5);
      if (regional < regionalTarget) {
        reasons.push(`regional ${regional}/${total} < ${regionalTarget}`);
      }
    }
    verdicts.push({ region: o.region, pass: reasons.length === 0, reasons });
  }

  lines.push("## Rollout verdict per region");
  lines.push("");
  for (const v of verdicts) {
    lines.push(
      `- \`${v.region}\`: ${v.pass ? "✅ READY" : "❌ HOLD"} ${v.reasons.length ? `— ${v.reasons.join("; ")}` : ""}`,
    );
  }
  lines.push("");
  const allPass = verdicts.every((v) => v.pass);
  lines.push(
    `**Beta launch decision (auto-heuristic)**: ${allPass ? "✅ ALL REGIONS READY (pending human review of flagged ideas)" : "❌ HOLD — at least one region has triggers requiring review"}`,
  );
  lines.push("");
  lines.push(
    "_Reminder_: heuristics surface candidates; the human reviewer must confirm filmable / stereotype / safety verdicts on each flagged idea before final beta launch sign-off.",
  );
  lines.push("");

  fs.appendFileSync(outPath, lines.join("\n") + "\n", "utf8");
  console.error(
    `[liveBetaQa] appended ${lines.length} aggregate lines to ${outPath} (${allRuns.length} regions, ${allRuns.reduce((n, r) => n + r.ideas.length, 0)} total ideas)`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
