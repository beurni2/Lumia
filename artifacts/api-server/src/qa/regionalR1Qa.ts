/**
 * PHASE R1 — DETERMINISTIC REGIONAL BASELINE LIVE QA
 *
 * Drives `runHybridIdeator` once per region against the seeded
 * demo creator. For each of the 4 regions (western / nigeria /
 * india / philippines) we ship a batch of ~5 ideas and surface:
 *
 *   - hook / whatToShow / howToFilm / caption / whyItWorks
 *   - per-idea scenarioCoherence verdict
 *   - per-idea region-decoration flag (computed via
 *     `ideaWasRegionDecorated` against the SHIPPED text)
 *   - one Film-This-Now reproduction sample per region
 *
 * Acceptance encoded in the aggregate section:
 *   - 0 scenarioCoherence failures across all 4 regions
 *   - ≥60% of NON-WESTERN ideas show visible region decoration
 *   - western baseline is unchanged (not byte-checked here — that's
 *     covered by vitest snapshots; this surface inspects the live
 *     orchestrator output for human grading)
 *
 * Output:  .local/REGIONAL_R1_QA.md   (writeFileSync — pino on
 *                                      stdout would otherwise corrupt
 *                                      the markdown).
 *
 * Run:
 *   pnpm exec tsx artifacts/api-server/src/qa/regionalR1Qa.ts
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
import { ideaWasRegionDecorated, REGION_PROFILES } from "../lib/regionProfile";
import type { Idea } from "../lib/ideaGen";

// ---------------------------------------------------------------- //
// Helpers                                                           //
// ---------------------------------------------------------------- //

function fmt(n: number): string {
  return n < 10 ? n.toFixed(1).replace(/\.0$/, "") : n.toFixed(0);
}

type RunOutcome = {
  region: Region;
  ideas: Idea[];
  perIdeaSource: string[];
  perIdeaAnchor: (string | undefined)[];
  perIdeaCoreId: (string | undefined)[];
  source: string;
  usedFallback: boolean;
};

async function runOneRegion(
  region: Region,
  creator: typeof schema.creators.$inferSelect,
): Promise<RunOutcome> {
  const styleProfile = styleProfileSchema.parse({});
  const result = await runHybridIdeator({
    creator,
    region,
    styleProfile,
    count: 3,
    regenerate: false,
    excludeHooks: [],
    ctx: { creatorId: creator.id, agentRunId: null },
  });
  const perIdea = result.qaTelemetry?.perIdea ?? [];
  return {
    region,
    ideas: result.ideas,
    perIdeaSource: result.ideas.map(
      (_, i) => perIdea[i]?.source ?? result.source,
    ),
    perIdeaAnchor: result.ideas.map((_, i) => perIdea[i]?.anchor),
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
  const twistBody =
    Array.isArray(sp) && sp.length >= 2 && sp[1]
      ? sp[1]
      : (idea.trigger ?? "");
  const lines: string[] = [];
  lines.push("| Beat | Time | Body |");
  lines.push("| --- | --- | --- |");
  lines.push(
    `| HOOK | 0–${fmt(hookSec)}s | ${idea.hook.replace(/\|/g, "\\|")} |`,
  );
  lines.push(
    `| ACTION | ${fmt(hookSec)}–${fmt(actionEnd)}s | ${(idea.whatToShow ?? "").replace(/\|/g, "\\|")} |`,
  );
  lines.push(
    `| TWIST | ${fmt(actionEnd)}–${fmt(twistEnd)}s | ${twistBody.replace(/\|/g, "\\|")} |`,
  );
  lines.push(
    `| PAYOFF | ${fmt(twistEnd)}–${fmt(payoffEnd)}s | ${(idea.reaction ?? "").replace(/\|/g, "\\|")} |`,
  );
  lines.push("");
  if (idea.caption) lines.push(`**CAPTION**: ${idea.caption}`);
  return lines.join("\n");
}

function ideaSection(o: RunOutcome, i: number): string {
  const idea = o.ideas[i];
  if (!idea) return `_(no idea returned for index ${i})_\n`;
  const verdict = validateScenarioCoherence(idea);
  const decorated = ideaWasRegionDecorated(o.region, idea);
  const lines: string[] = [];
  lines.push(`#### Idea ${i + 1} — \`${o.perIdeaCoreId[i] ?? "(no core)"}\``);
  lines.push("");
  lines.push(`- **hook**: ${idea.hook}`);
  lines.push(`- **whatToShow**: ${idea.whatToShow}`);
  lines.push(`- **howToFilm**: ${idea.howToFilm}`);
  lines.push(`- **caption**: ${idea.caption ?? "_(empty)_"}`);
  lines.push(`- **whyItWorks**: ${idea.whyItWorks}`);
  lines.push(
    `- **scenarioCoherence**: ${verdict === null ? "PASS" : `FAIL \`${verdict}\``}`,
  );
  lines.push(
    `- **region decoration**: ${decorated ? "YES" : "no"} · anchor=${o.perIdeaAnchor[i] ?? "?"} · source=\`${o.perIdeaSource[i]}\``,
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
  lines.push("# PHASE R1 — Deterministic Regional Baseline LIVE QA");
  lines.push("");
  lines.push(
    `_Generated by_ \`pnpm exec tsx artifacts/api-server/src/qa/regionalR1Qa.ts\``,
  );
  lines.push("");
  lines.push(
    "Drives `runHybridIdeator` once per region against the seeded demo creator. Region decoration is applied inside `cohesiveIdeaAuthor` AFTER all comedy / anti-copy / scenarioCoherence validators have already passed on the BASE idea — so decoration cannot CAUSE a rejection. `western` short-circuits the adapter to identity (pre-R1 baseline preserved).",
  );
  lines.push("");

  const allRuns: RunOutcome[] = [];
  for (const region of REGIONS) {
    console.error(`[regionalR1Qa] running region=${region}…`);
    try {
      const o = await runOneRegion(region, demo);
      allRuns.push(o);
    } catch (err) {
      console.error(`[regionalR1Qa] region=${region} FAILED`, err);
      // Continue other regions — partial reports are still useful.
    }
  }

  // -------- Per-region sections --------------------------------- //
  for (const o of allRuns) {
    const profile = REGION_PROFILES[o.region];
    const decoratedDomains = Object.keys(profile.captionSuffixByDomain).length;
    lines.push("---");
    lines.push("");
    lines.push(`## Region: \`${o.region}\``);
    lines.push("");
    lines.push(
      `- **shipped**: ${o.ideas.length} ideas · **source**: \`${o.source}\` · **fallback used**: ${o.usedFallback ? "YES" : "no"}`,
    );
    lines.push(
      `- **decoration coverage in profile**: ${decoratedDomains}/12 canonical domains have caption tags`,
    );
    lines.push("");
    for (let i = 0; i < o.ideas.length; i++) {
      lines.push(ideaSection(o, i));
    }
    if (o.ideas[0]) {
      lines.push(`### Film-This-Now reproduction (idea 1)`);
      lines.push("");
      lines.push(filmThisNowScreen(o.ideas[0]));
      lines.push("");
    }
  }

  // -------- Aggregate ------------------------------------------- //
  const allIdeas = allRuns.flatMap((r) =>
    r.ideas.map((idea) => ({ idea, region: r.region })),
  );
  const verdicts = allIdeas.map((x) => validateScenarioCoherence(x.idea));
  const passCount = verdicts.filter((v) => v === null).length;

  const nonWestern = allIdeas.filter((x) => x.region !== "western");
  const nonWesternDecorated = nonWestern.filter((x) =>
    ideaWasRegionDecorated(x.region, x.idea),
  ).length;
  const decorationRate =
    nonWestern.length === 0 ? 0 : nonWesternDecorated / nonWestern.length;

  lines.push("---");
  lines.push("");
  lines.push("## Aggregate");
  lines.push("");
  lines.push(
    `- **regions exercised**: ${allRuns.length}/${REGIONS.length}`,
  );
  lines.push(
    `- **total ideas shipped**: ${allIdeas.length}`,
  );
  lines.push(
    `- **scenarioCoherence pass rate**: ${passCount}/${allIdeas.length}` +
      (passCount === allIdeas.length ? " ✓ R1 acceptance" : " ✗ REGRESSION"),
  );
  lines.push(
    `- **non-western decoration rate**: ${nonWesternDecorated}/${nonWestern.length}` +
      ` (${(decorationRate * 100).toFixed(0)}%)` +
      (decorationRate >= 0.6 ? " ✓ R1 acceptance" : " ✗ below 60% target"),
  );
  lines.push("");

  const __filename = fileURLToPath(import.meta.url);
  const workspaceRoot = path.resolve(path.dirname(__filename), "../../../..");
  const outDir = path.join(workspaceRoot, ".local");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "REGIONAL_R1_QA.md");
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  console.error(`[regionalR1Qa] wrote ${lines.length} lines to ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
