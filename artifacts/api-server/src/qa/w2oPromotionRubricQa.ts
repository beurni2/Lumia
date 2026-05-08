/**
 * PHASE W2-O — Promotion rubric QA driver.
 *
 * Runs the deterministic Western promotion rubric over the as-shipped
 * staging pool (`APPROVED_WESTERN_PROMOTION_CANDIDATES`, 300 entries)
 * and writes a markdown report at `.local/W2O_RUBRIC_REPORT.md`.
 *
 * Pure I/O — no runtime behavior change, no production wiring.
 *
 * Run:
 *   pnpm --filter @workspace/api-server exec tsx src/qa/w2oPromotionRubricQa.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { APPROVED_WESTERN_PROMOTION_CANDIDATES } from "../lib/westernHookPackApproved.js";
import {
  RUBRIC_DIMENSIONS,
  RUBRIC_MAX_SCORE,
  RUBRIC_PROMOTE_FLOOR,
  RUBRIC_REWRITE_FLOOR,
  RUBRIC_WEIGHTS,
  scorePool,
  type RubricEntryResult,
  type RubricRecommendation,
} from "../lib/westernPromotionRubric.js";
import { WESTERN_HOOK_PACK_LIVE } from "../lib/westernHookPackLive.js";

function sourceBlock(id: string): string {
  if (id.startsWith("w2_next2_")) return "W2-N (BATCH-NEXT-2)";
  if (id.startsWith("w2_next_")) return "W2-L (BATCH-NEXT)";
  if (/^W2[A-Z]-/.test(id)) return "W2-I (DRAFT promotion)";
  return "OTHER";
}

function tally<T extends string>(
  values: readonly T[],
): ReadonlyMap<T, number> {
  const m = new Map<T, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
}

function sortMap(m: ReadonlyMap<string, number>): Array<[string, number]> {
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function fmtRow(r: RubricEntryResult): string {
  const dims = RUBRIC_DIMENSIONS.map(
    (d) => `${d}=${r.perDimension[d]}/${RUBRIC_WEIGHTS[d]}`,
  ).join(", ");
  const reasons = [
    ...r.rejectReasons.map((x) => `REJ:${x}`),
    ...r.warningReasons.map((x) => `WARN:${x}`),
  ].join("; ");
  return `| ${r.entryId} | ${r.totalScore}/${RUBRIC_MAX_SCORE} | ${r.recommendation} | ${dims} | ${reasons} |`;
}

function main(): void {
  const results = scorePool(APPROVED_WESTERN_PROMOTION_CANDIDATES);

  const byRecommendation = new Map<RubricRecommendation, RubricEntryResult[]>();
  for (const r of results) {
    const arr = byRecommendation.get(r.recommendation) ?? [];
    arr.push(r);
    byRecommendation.set(r.recommendation, arr);
  }

  const idToBlock = new Map<string, string>(
    APPROVED_WESTERN_PROMOTION_CANDIDATES.map((e) => [e.id, sourceBlock(e.id)]),
  );

  const blockOutcomes = new Map<string, Map<RubricRecommendation, number>>();
  for (const r of results) {
    const block = idToBlock.get(r.entryId) ?? "OTHER";
    const inner = blockOutcomes.get(block) ?? new Map();
    inner.set(r.recommendation, (inner.get(r.recommendation) ?? 0) + 1);
    blockOutcomes.set(block, inner);
  }

  const allRejectReasons = tally(results.flatMap((r) => r.rejectReasons));
  const allWarningReasons = tally(results.flatMap((r) => r.warningReasons));

  const sortedByScore = [...results].sort((a, b) => b.totalScore - a.totalScore);
  const top10 = sortedByScore.slice(0, 10);
  const bottom10 = sortedByScore.slice(-10);

  const lines: string[] = [];
  lines.push("# W2-O Western Promotion Rubric Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Staging pool size: ${APPROVED_WESTERN_PROMOTION_CANDIDATES.length}`);
  lines.push(`Live pool size:    ${WESTERN_HOOK_PACK_LIVE.length}`);
  lines.push(`Rubric max score:  ${RUBRIC_MAX_SCORE}`);
  lines.push(`Promote floor:     ${RUBRIC_PROMOTE_FLOOR}`);
  lines.push(`Rewrite floor:     ${RUBRIC_REWRITE_FLOOR}`);
  lines.push("");

  lines.push("## Rubric dimensions & weights");
  lines.push("");
  lines.push("| Dimension | Weight |");
  lines.push("| --- | ---: |");
  for (const d of RUBRIC_DIMENSIONS) {
    lines.push(`| ${d} | ${RUBRIC_WEIGHTS[d]} |`);
  }
  lines.push("");

  lines.push("## Recommendation totals");
  lines.push("");
  lines.push("| Recommendation | Count |");
  lines.push("| --- | ---: |");
  for (const rec of ["promote", "needs_rewrite", "reject"] as const) {
    lines.push(`| ${rec} | ${byRecommendation.get(rec)?.length ?? 0} |`);
  }
  lines.push("");

  lines.push("## Outcomes by source block");
  lines.push("");
  lines.push("| Block | promote | needs_rewrite | reject | total |");
  lines.push("| --- | ---: | ---: | ---: | ---: |");
  for (const [block, inner] of [...blockOutcomes.entries()].sort()) {
    const p = inner.get("promote") ?? 0;
    const n = inner.get("needs_rewrite") ?? 0;
    const r = inner.get("reject") ?? 0;
    lines.push(`| ${block} | ${p} | ${n} | ${r} | ${p + n + r} |`);
  }
  lines.push("");

  lines.push("## Most common reject reasons");
  lines.push("");
  lines.push("| Reason | Count |");
  lines.push("| --- | ---: |");
  for (const [reason, count] of sortMap(allRejectReasons).slice(0, 15)) {
    lines.push(`| ${reason} | ${count} |`);
  }
  lines.push("");

  lines.push("## Most common warning reasons");
  lines.push("");
  lines.push("| Reason | Count |");
  lines.push("| --- | ---: |");
  for (const [reason, count] of sortMap(allWarningReasons).slice(0, 15)) {
    lines.push(`| ${reason} | ${count} |`);
  }
  lines.push("");

  lines.push("## Top 10 entries by total score");
  lines.push("");
  lines.push("| ID | Score | Recommendation | Per-dimension | Reasons |");
  lines.push("| --- | ---: | --- | --- | --- |");
  for (const r of top10) lines.push(fmtRow(r));
  lines.push("");

  lines.push("## Bottom 10 entries by total score");
  lines.push("");
  lines.push("| ID | Score | Recommendation | Per-dimension | Reasons |");
  lines.push("| --- | ---: | --- | --- | --- |");
  for (const r of bottom10) lines.push(fmtRow(r));
  lines.push("");

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
  const outPath = path.join(repoRoot, ".local", "W2O_RUBRIC_REPORT.md");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join("\n"));
  // eslint-disable-next-line no-console
  console.log(`wrote ${outPath}`);
}

main();
