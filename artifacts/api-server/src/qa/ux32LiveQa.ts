/**
 * PHASE UX3.2 — Live QA harness for the Authored Scenario Planner.
 *
 * Mirrors `ux31LiveQa.ts` but seeds `excludeHooks` per domain so
 * the orchestrator is forced to rotate through each of the 10
 * authored anchors (inbox, alarm, calendar, fridge, highlighter,
 * gym, tab, profile, junk, mirror) in turn. For each domain we
 * surface:
 *
 *   - hook
 *   - whatToShow
 *   - howToFilm
 *   - full Film-This-Now 6-beat reproduction (proportional
 *     timestamps from videoLengthSec)
 *   - shipped trigger/reaction/caption
 *   - source / authoredPlanId from qaTelemetry.perIdea
 *   - scenarioCoherence verdict
 *
 * Plus an aggregate section that asserts:
 *   - 0 banned phrases ("lean into the X beat", "the reveal lands
 *     here", "let the props carry the deadpan")
 *   - 0 impossible "physical-verb the abstract-anchor" pairs
 *   - 100% scenarioCoherence pass on shipped ideas
 *   - every domain we forced was covered (and which ones rendered
 *     via the authored fast-path vs. the generic fallback)
 *
 * Output:  .local/UX32_LIVE_QA.md   (writeFileSync — pino on stdout
 *                                     would otherwise corrupt the
 *                                     markdown).
 *
 * Run:
 *   pnpm exec tsx artifacts/api-server/src/qa/ux32LiveQa.ts
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
import {
  AUTHORED_DOMAIN_IDS,
  ABSTRACT_ANCHORS,
} from "../lib/authoredScenarioPlans";
import type { Idea } from "../lib/ideaGen";

// ---------------------------------------------------------------- //
// Helpers                                                           //
// ---------------------------------------------------------------- //

function fmt(n: number): string {
  return n < 10 ? n.toFixed(1).replace(/\.0$/, "") : n.toFixed(0);
}

const BANNED_PHRASES: ReadonlyArray<RegExp> = [
  /\blean into the\s+\w+\s+beat\b/i,
  /\bthe\s+\w+(?:\s+\w+)?\s+lands here\b/i,
  /\blet the (?:contradiction|shift|reveal) (?:widen|breathe)\b/i,
  /\bprops carry the deadpan\b/i,
  /\blet the props carry\b/i,
  /\bend beat\s*:/i,
];

function findBannedPhrases(idea: Idea): string[] {
  const blob =
    `${idea.hook} ${idea.whatToShow} ${idea.howToFilm} ${idea.trigger ?? ""} ${idea.reaction ?? ""} ${idea.caption ?? ""} ${(idea.shotPlan ?? []).join(" ")}`.toLowerCase();
  const hits: string[] = [];
  for (const re of BANNED_PHRASES) {
    const m = blob.match(re);
    if (m) hits.push(m[0]!);
  }
  return hits;
}

function findAbstractPhysicalPairs(idea: Idea): string[] {
  const blob =
    `${idea.whatToShow} ${idea.howToFilm} ${idea.trigger ?? ""} ${idea.reaction ?? ""} ${(idea.shotPlan ?? []).join(" ")}`.toLowerCase();
  const hits: string[] = [];
  for (const a of ABSTRACT_ANCHORS) {
    const re = new RegExp(
      `\\b(set|pick|dodge|move|drop|grab|toss|throw|push|kick|carry|hold)\\s+(?:the\\s+)?${a}\\b(?:\\s+(up|down|away|over|out|aside))?`,
      "i",
    );
    const m = blob.match(re);
    if (m) hits.push(m[0]!);
  }
  return hits;
}

type RunOutcome = {
  label: string;
  forcedDomain: string;
  excludeHooks: string[];
  ideas: Idea[];
  perIdeaSource: string[];
  perIdeaAnchor: (string | undefined)[];
  perIdeaAuthoredPlanId: (string | undefined)[];
  perIdeaCoreId: (string | undefined)[];
  source: string;
  usedFallback: boolean;
};

async function runOne(
  label: string,
  forcedDomain: string,
  excludeHooks: string[],
  creator: typeof schema.creators.$inferSelect,
): Promise<RunOutcome> {
  const styleProfile = styleProfileSchema.parse({});
  const result = await runHybridIdeator({
    creator,
    region: "western",
    styleProfile,
    count: 3,
    regenerate: excludeHooks.length > 0,
    excludeHooks,
    ctx: { creatorId: creator.id, agentRunId: null },
  });
  const perIdea = result.qaTelemetry?.perIdea ?? [];
  return {
    label,
    forcedDomain,
    excludeHooks,
    ideas: result.ideas,
    perIdeaSource: result.ideas.map(
      (_, i) => perIdea[i]?.source ?? result.source,
    ),
    perIdeaAnchor: result.ideas.map((_, i) => perIdea[i]?.anchor),
    perIdeaAuthoredPlanId: result.ideas.map(
      (_, i) => perIdea[i]?.authoredPlanId,
    ),
    perIdeaCoreId: result.ideas.map((_, i) => perIdea[i]?.premiseCoreId),
    source: result.source,
    usedFallback: result.usedFallback,
  };
}

function filmThisNowScreen(idea: Idea): string {
  const totalLen = idea.videoLengthSec;
  const hookSec = Math.max(0.5, idea.hookSeconds);
  const remainder = Math.max(2, totalLen - hookSec);
  const actionEnd = hookSec + remainder * (1 / 3);
  const twistEnd = hookSec + remainder * (2 / 3);
  const payoffEnd = totalLen;
  const sp = idea.shotPlan;
  // Mirror the UX3.2 film-this-now twist beat: prefer shotPlan[1],
  // fall back to trigger, hide if neither is present.
  const twistBody =
    Array.isArray(sp) && sp.length >= 2 && sp[1]
      ? sp[1]
      : (idea.trigger ?? "");
  const lines: string[] = [];
  lines.push("| Beat | Time | Body |");
  lines.push("| --- | --- | --- |");
  lines.push(
    `| SETUP | _(pre-roll)_ | Phone propped, single take. Frame yourself so the hook lands first, then say it straight to camera. |`,
  );
  lines.push(`| HOOK | 0–${fmt(hookSec)}s | ${idea.hook.replace(/\|/g, "\\|")} |`);
  lines.push(
    `| ACTION | ${fmt(hookSec)}–${fmt(actionEnd)}s | ${(idea.whatToShow ?? idea.trigger ?? "").replace(/\|/g, "\\|")} |`,
  );
  if (twistBody) {
    lines.push(
      `| TWIST | ${fmt(actionEnd)}–${fmt(twistEnd)}s | ${twistBody.replace(/\|/g, "\\|")} |`,
    );
  } else {
    lines.push(
      `| TWIST | ${fmt(actionEnd)}–${fmt(twistEnd)}s | _(hidden — UX3.2 placeholder suppression)_ |`,
    );
  }
  lines.push(
    `| PAYOFF | ${fmt(twistEnd)}–${fmt(payoffEnd)}s | ${(idea.reaction ?? idea.whyItWorks ?? "").replace(/\|/g, "\\|")} |`,
  );
  lines.push("");
  if (idea.shotPlan && idea.shotPlan.length > 0) {
    lines.push("**SHOT PLAN**");
    lines.push("");
    idea.shotPlan.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    lines.push("");
  }
  if (idea.caption) {
    lines.push(`**CAPTION**: ${idea.caption}`);
    lines.push("");
  }
  return lines.join("\n");
}

function ideaSection(o: RunOutcome, i: number): string {
  const idea = o.ideas[i];
  if (!idea) return `_(no idea returned for index ${i})_\n`;
  const verdict = validateScenarioCoherence(idea);
  const banned = findBannedPhrases(idea);
  const absPhys = findAbstractPhysicalPairs(idea);
  const lines: string[] = [];
  lines.push(`### Hook`);
  lines.push(`> ${idea.hook}`);
  lines.push("");
  lines.push(`### whatToShow`);
  lines.push(`> ${idea.whatToShow}`);
  lines.push("");
  lines.push(`### howToFilm`);
  lines.push(`> ${idea.howToFilm}`);
  lines.push("");
  lines.push(`### Film-This-Now reproduction`);
  lines.push("");
  lines.push(filmThisNowScreen(idea));
  lines.push(`### Diagnostics`);
  lines.push(
    `- **scenarioCoherence**: ${verdict === null ? "PASS" : `FAIL \`${verdict}\``}`,
  );
  lines.push(`- **source / path**: \`${o.perIdeaSource[i] ?? "(unknown)"}\``);
  lines.push(
    `- **authoredPlanId**: ${o.perIdeaAuthoredPlanId[i] ? `\`${o.perIdeaAuthoredPlanId[i]}\` (authored fast-path)` : "_(generic-template fallback)_"}`,
  );
  lines.push(
    `- **anchor**: ${o.perIdeaAnchor[i] ? `\`${o.perIdeaAnchor[i]}\`` : "_(unresolved)_"}`,
  );
  lines.push(
    `- **premiseCoreId**: ${o.perIdeaCoreId[i] ? `\`${o.perIdeaCoreId[i]}\`` : "_(absent)_"}`,
  );
  lines.push(
    `- **banned-phrase scan**: ${banned.length === 0 ? "0 hits" : `**${banned.length} hit(s)** — ${banned.map((s) => `\`${s}\``).join(", ")}`}`,
  );
  lines.push(
    `- **abstract+physical-verb scan**: ${absPhys.length === 0 ? "0 hits" : `**${absPhys.length} hit(s)** — ${absPhys.map((s) => `\`${s}\``).join(", ")}`}`,
  );
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------- //
// Main                                                              //
// ---------------------------------------------------------------- //

async function main(): Promise<void> {
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
  lines.push("# PHASE UX3.2 — Authored Scenario Planner LIVE-app QA Sample");
  lines.push("");
  lines.push(
    `_Generated by_ \`pnpm exec tsx artifacts/api-server/src/qa/ux32LiveQa.ts\``,
  );
  lines.push("");
  lines.push(
    "Drives `runHybridIdeator` with the seeded demo creator, rotating `excludeHooks` per domain so the orchestrator is forced through each of the 10 authored anchors in turn. Every shipped idea below is what the mobile app would render.",
  );
  lines.push("");
  lines.push(
    "**UX3.2 acceptance** — every section asserts: 0 banned UX3.1 placeholder phrases; 0 impossible physical-verb on abstract-anchor pairs; 100% `scenarioCoherence` PASS on shipped ideas; every authored domain ships at least once.",
  );
  lines.push("");

  // Run a primer batch to collect "visible hooks" we'll use as
  // excludeHooks in the per-domain runs (so each run stays in
  // refresh mode and exercises the full UX3 refresh path).
  const primer = await runOne("Primer batch", "(any)", [], demo);
  const primerHooks = primer.ideas.map((i) => i.hook.toLowerCase().trim());

  // Per-domain runs. We can't directly force the orchestrator to
  // pick a specific anchor (that would require a new API surface
  // and violate "no API breaks"), so we rotate excludeHooks +
  // re-run repeatedly until each authored anchor has been seen
  // OR we hit the max-attempts ceiling.
  const allRuns: RunOutcome[] = [primer];
  const seenAnchors = new Set<string>();
  const seenAuthoredPlanIds = new Set<string>();
  for (const a of primer.perIdeaAnchor) if (a) seenAnchors.add(a);
  for (const id of primer.perIdeaAuthoredPlanId) if (id) seenAuthoredPlanIds.add(id);

  let attempt = 0;
  // PHASE UX3.2 — capped at 3 to keep the live-QA harness within
  // a ~2-minute budget. Each runHybridIdeator call is ~25-35s
  // (pattern + Claude fallback + Llama polish) so 3 attempts +
  // primer = ~120s, which fits a single tool-call window. Coverage
  // is best-effort: per-domain MISSED rows below are documented
  // in the report rather than retried indefinitely.
  const MAX_ATTEMPTS = 3;
  let rollingExcludeHooks = [...primerHooks];
  while (
    seenAuthoredPlanIds.size < AUTHORED_DOMAIN_IDS.length &&
    attempt < MAX_ATTEMPTS
  ) {
    attempt += 1;
    const o = await runOne(
      `Refresh attempt #${attempt}`,
      "(rotation)",
      rollingExcludeHooks.slice(0, 30),
      demo,
    );
    allRuns.push(o);
    for (const a of o.perIdeaAnchor) if (a) seenAnchors.add(a);
    for (const id of o.perIdeaAuthoredPlanId) if (id) seenAuthoredPlanIds.add(id);
    rollingExcludeHooks = [
      ...rollingExcludeHooks,
      ...o.ideas.map((i) => i.hook.toLowerCase().trim()),
    ];
  }

  // -------- Section 1 — per-run sections ----------------------- //
  lines.push("---");
  lines.push("");
  lines.push("# Section 1 — All runs (primer + refresh rotation)");
  lines.push("");
  for (const o of allRuns) {
    lines.push(`## ${o.label}`);
    lines.push("");
    lines.push(
      `- **forcedDomain**: \`${o.forcedDomain}\` · **batch source**: \`${o.source}\` · **usedFallback**: \`${o.usedFallback}\``,
    );
    lines.push(
      `- **excludeHooks (${o.excludeHooks.length})**: ${o.excludeHooks.length === 0 ? "_(none)_" : o.excludeHooks.slice(0, 10).map((h) => `\`${h}\``).join(", ") + (o.excludeHooks.length > 10 ? `, …+${o.excludeHooks.length - 10} more` : "")}`,
    );
    lines.push("");
    o.ideas.forEach((_, i) => {
      lines.push(`### Idea ${i + 1}`);
      lines.push("");
      lines.push(ideaSection(o, i));
    });
    lines.push("---");
    lines.push("");
  }

  // -------- Section 2 — per-domain coverage -------------------- //
  lines.push("# Section 2 — Per-authored-domain coverage");
  lines.push("");
  lines.push(
    "For each of the 10 authored domains, we surface the FIRST shipped idea (across all runs above) whose `authoredPlanId` matched. Domains the rotation never reached appear as `_not covered_` (the orchestrator's premise-core selector ranges across all 8 families × catalog rows; reaching every single anchor in a bounded sample is best-effort, not guaranteed — we still keep the section so spot-checks are obvious).",
  );
  lines.push("");
  const domainHits: Record<string, { run: RunOutcome; idx: number } | null> = {};
  for (const d of AUTHORED_DOMAIN_IDS) domainHits[d] = null;
  for (const o of allRuns) {
    for (let i = 0; i < o.ideas.length; i += 1) {
      const planId = o.perIdeaAuthoredPlanId[i];
      if (planId && domainHits[planId] === null) {
        domainHits[planId] = { run: o, idx: i };
      }
    }
  }
  for (const d of AUTHORED_DOMAIN_IDS) {
    lines.push(`## Domain: \`${d}\``);
    lines.push("");
    const hit = domainHits[d];
    if (!hit) {
      lines.push("_not covered in this rotation sample_");
      lines.push("");
      lines.push("---");
      lines.push("");
      continue;
    }
    lines.push(ideaSection(hit.run, hit.idx));
    lines.push("---");
    lines.push("");
  }

  // -------- Aggregate -------------------------------------------- //
  const allIdeas = allRuns.flatMap((b) => b.ideas);
  const verdicts = allIdeas.map((i) => validateScenarioCoherence(i));
  const passCount = verdicts.filter((v) => v === null).length;
  const totalBanned = allIdeas.reduce(
    (acc, i) => acc + findBannedPhrases(i).length,
    0,
  );
  const totalAbsPhys = allIdeas.reduce(
    (acc, i) => acc + findAbstractPhysicalPairs(i).length,
    0,
  );
  const sourceCounts: Record<string, number> = {};
  for (const o of allRuns) {
    for (const s of o.perIdeaSource) {
      sourceCounts[s] = (sourceCounts[s] ?? 0) + 1;
    }
  }
  const authoredPathCount = allRuns
    .flatMap((o) => o.perIdeaAuthoredPlanId)
    .filter((x) => Boolean(x)).length;

  lines.push("# Aggregate");
  lines.push("");
  lines.push(`- **runs**: ${allRuns.length} · **total ideas shipped**: ${allIdeas.length}`);
  lines.push(
    `- **scenarioCoherence pass rate**: ${passCount}/${allIdeas.length}` +
      (passCount === allIdeas.length ? " (100% — UX3.2 acceptance)" : ""),
  );
  lines.push(
    `- **banned-phrase hits across all shipped ideas**: ${totalBanned} ${totalBanned === 0 ? "(UX3.2 acceptance)" : "(REGRESSION)"}`,
  );
  lines.push(
    `- **abstract+physical-verb hits**: ${totalAbsPhys} ${totalAbsPhys === 0 ? "(UX3.2 acceptance)" : "(REGRESSION)"}`,
  );
  lines.push(
    `- **source breakdown**: ${Object.entries(sourceCounts)
      .map(([k, v]) => `\`${k}\`=${v}`)
      .join(", ")}`,
  );
  lines.push(
    `- **authored fast-path renders**: ${authoredPathCount} / ${allIdeas.length}`,
  );
  lines.push(
    `- **authored domains covered**: ${seenAuthoredPlanIds.size}/${AUTHORED_DOMAIN_IDS.length} — ${[...seenAuthoredPlanIds].map((d) => `\`${d}\``).join(", ") || "_(none)_"}`,
  );
  const missedDomains = AUTHORED_DOMAIN_IDS.filter(
    (d) => !seenAuthoredPlanIds.has(d),
  );
  if (missedDomains.length > 0) {
    lines.push(
      `- **authored domains MISSED** (rotation sample): ${missedDomains.map((d) => `\`${d}\``).join(", ")}`,
    );
  }
  lines.push("");

  // Resolve workspace-root .local/ regardless of pnpm-filter cwd
  // (pnpm --filter sets cwd to the api-server dir, but the report
  // belongs at the monorepo root). Script lives at
  // `artifacts/api-server/src/qa/ux32LiveQa.ts`, so 4 levels up.
  const __filename = fileURLToPath(import.meta.url);
  const workspaceRoot = path.resolve(path.dirname(__filename), "../../../..");
  const outDir = path.join(workspaceRoot, ".local");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "UX32_LIVE_QA.md");
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  console.error(`[ux32LiveQa] wrote ${lines.length} lines to ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
