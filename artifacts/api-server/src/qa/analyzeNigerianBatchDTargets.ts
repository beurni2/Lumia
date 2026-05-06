// PHASE N1-BATCH-D-GAP — Pack-supply gap analysis for Batch D authoring.
//
// Goal:
//   Identify under-served anchors/domains in the Nigerian Comedy Pack
//   so the next reviewer-stamped batch (Batch D) can target the
//   exact gaps that hold combined pack-fill at ~50% (vs. the brief's
//   60% bar and the architectural ~67% per-batch ceiling).
//
// Method:
//   1. Run the existing deterministic harness across all 5 default
//      sweep seeds, only for the two NG-eligible cohorts
//      (ng_light_pidgin + ng_pidgin) — the cohorts where pack-fill
//      matters. ~10s wall-clock total.
//   2. Collect every NON-pack row (source !== "pack"). The anchor on
//      a non-pack row tells us "the per-batch core pool needed an
//      anchor of this domain, but the pack didn't have a candidate
//      for it" — this is unfilled demand.
//   3. Tally pack supply by anchor and by domain.
//   4. Compute gap = unfilled-demand-rank − pack-supply-rank. High
//      gap = high demand, low supply = exactly what Batch D should
//      target.
//
// Hard-rule compliance:
//   - This is a READ-ONLY analysis script. No production code, no
//     validators, no scorers, no thresholds, no pack content
//     touched. Imports the harness only to reuse its deterministic
//     `runCohort` + seeded random helpers.
//   - The harness's module-execution guard prevents importing it
//     from triggering a sweep run.
//
// Output: .local/N1_BATCH_D_TARGETS.md

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COHORTS,
  DEFAULT_SWEEP_SEEDS,
  runCohort,
  withSeededRandom,
  type Row,
} from "./nigerianStagingQa.js";
import { NIGERIAN_HOOK_PACK } from "../lib/nigerianHookPack.js";
import { isNigerianPackFeatureEnabled } from "../lib/nigerianHookPack.js";

function main(): void {
  if (!isNigerianPackFeatureEnabled()) {
    console.error(
      "[analyzeNigerianBatchDTargets] ABORT: LUMINA_NG_PACK_ENABLED must be 'true'.",
    );
    process.exit(2);
  }
  if (NIGERIAN_HOOK_PACK.length === 0) {
    console.error("[analyzeNigerianBatchDTargets] ABORT: pack is empty.");
    process.exit(2);
  }

  // Per-cohort base salts must match the canonical harness so the
  // gap analysis sees the SAME core pools the staging QA sees.
  const COHORT_BASE_SALTS: Record<string, number> = {
    ng_light_pidgin: 1,
    ng_pidgin: 1009,
  };
  const eligibleCohortLabels = ["ng_light_pidgin", "ng_pidgin"] as const;
  const eligibleCohorts = COHORTS.filter((c) =>
    (eligibleCohortLabels as readonly string[]).includes(c.label),
  );

  // Step 1: run all 5 seeds × 2 NG-eligible cohorts.
  const allRows: Row[] = [];
  for (const seed of DEFAULT_SWEEP_SEEDS) {
    withSeededRandom(seed, () => {
      for (const cohort of eligibleCohorts) {
        const baseSalt = COHORT_BASE_SALTS[cohort.label] ?? 1;
        try {
          const rows = runCohort(cohort, baseSalt);
          for (const r of rows) {
            allRows.push(r);
          }
        } catch (err) {
          console.error(
            `[analyzeNigerianBatchDTargets] seed=${seed} cohort=${cohort.label} ERROR`,
            err,
          );
        }
      }
    });
    console.error(`[analyzeNigerianBatchDTargets] seed=${seed} done`);
  }

  // Step 2: split into pack-filled vs unfilled rows.
  const packRows = allRows.filter((r) => r.packEntryId !== undefined);
  const nonPackRows = allRows.filter((r) => r.packEntryId === undefined);

  // Tally non-pack-row anchors (unfilled demand). A `null`/undefined
  // anchor means the core itself didn't surface a discrete anchor —
  // those are reported separately under `<no-anchor>`.
  const demandByAnchor = new Map<string, number>();
  for (const r of nonPackRows) {
    const key = r.anchor ?? "<no-anchor>";
    demandByAnchor.set(key, (demandByAnchor.get(key) ?? 0) + 1);
  }

  // Step 3: tally pack supply by anchor and domain.
  const supplyByAnchor = new Map<string, number>();
  const supplyByDomain = new Map<string, number>();
  for (const entry of NIGERIAN_HOOK_PACK) {
    supplyByAnchor.set(
      entry.anchor,
      (supplyByAnchor.get(entry.anchor) ?? 0) + 1,
    );
    // domain may not exist on every entry shape historically; guard.
    const domain = (entry as { domain?: string }).domain ?? "<no-domain>";
    supplyByDomain.set(domain, (supplyByDomain.get(domain) ?? 0) + 1);
  }

  // Step 4: rank-based gap calculation.
  // For each anchor with non-zero unfilled demand:
  //   gap = demand_count − supply_count
  // Positive gap → demand exceeds supply → Batch D candidate.
  // Negative gap → supply already saturates demand for this anchor.
  // We list anchors with the highest gap first.
  type GapRow = {
    anchor: string;
    demand: number;
    supply: number;
    gap: number;
  };
  const gapRows: GapRow[] = [];
  // Union of anchors seen in either side.
  const anchorUniverse = new Set<string>([
    ...demandByAnchor.keys(),
    ...supplyByAnchor.keys(),
  ]);
  for (const anchor of anchorUniverse) {
    const demand = demandByAnchor.get(anchor) ?? 0;
    const supply = supplyByAnchor.get(anchor) ?? 0;
    gapRows.push({ anchor, demand, supply, gap: demand - supply });
  }
  // Sort: highest unfilled demand first, then by gap descending.
  gapRows.sort((a, b) => {
    if (b.demand !== a.demand) return b.demand - a.demand;
    return b.gap - a.gap;
  });

  // ─── Render report ─── //
  const __filename = fileURLToPath(import.meta.url);
  const workspaceRoot = path.resolve(path.dirname(__filename), "../../../..");
  const outDir = path.join(workspaceRoot, ".local");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "N1_BATCH_D_TARGETS.md");

  const lines: string[] = [];
  lines.push("# N1 — BATCH D PACK-SUPPLY GAP ANALYSIS");
  lines.push("");
  lines.push(
    `_generated by_: \`artifacts/api-server/src/qa/analyzeNigerianBatchDTargets.ts\``,
  );
  lines.push(
    `_method_: 5-seed deterministic sweep × 2 NG-eligible cohorts (light_pidgin, pidgin); non-pack-row anchors = unfilled demand`,
  );
  lines.push(
    `_pack length_: ${NIGERIAN_HOOK_PACK.length} entries across ${supplyByAnchor.size} anchors / ${supplyByDomain.size} domains`,
  );
  lines.push(
    `_sample_: ${allRows.length} ideas total (${packRows.length} pack-filled, ${nonPackRows.length} non-pack)`,
  );
  lines.push(
    `_combined fill rate_: ${packRows.length}/${allRows.length} (${((packRows.length / allRows.length) * 100).toFixed(1)}%)`,
  );
  lines.push("");
  lines.push("---");
  lines.push("");

  lines.push("## Top unfilled-demand anchors (Batch D priority list)");
  lines.push("");
  lines.push(
    "Each row = an anchor that the per-batch core pool surfaced AT LEAST ONCE during the 5-seed sweep but the pack couldn't fill. **High `demand`, low `supply` = priority Batch D target.**",
  );
  lines.push("");
  lines.push("| rank | anchor | unfilled demand | current pack supply | gap |");
  lines.push("| ---: | --- | ---: | ---: | ---: |");
  let rank = 1;
  for (const row of gapRows) {
    if (row.demand === 0) continue; // only list anchors with actual unfilled demand
    lines.push(
      `| ${rank} | \`${row.anchor}\` | ${row.demand} | ${row.supply} | ${row.gap >= 0 ? `+${row.gap}` : row.gap} |`,
    );
    rank++;
    if (rank > 30) break; // top 30 is plenty for a Batch D brief
  }
  lines.push("");

  lines.push("## Saturated anchors (pack supply already covers demand)");
  lines.push("");
  lines.push("These anchors have `supply ≥ demand`; Batch D should NOT add more entries here (would dilute the pack without raising fill).");
  lines.push("");
  lines.push("| anchor | unfilled demand | current pack supply | gap |");
  lines.push("| --- | ---: | ---: | ---: |");
  const saturated = gapRows
    .filter((r) => r.supply > 0 && r.gap <= 0)
    .sort((a, b) => b.supply - a.supply);
  for (const row of saturated.slice(0, 20)) {
    lines.push(
      `| \`${row.anchor}\` | ${row.demand} | ${row.supply} | ${row.gap >= 0 ? `+${row.gap}` : row.gap} |`,
    );
  }
  lines.push("");

  lines.push("## Pack supply by domain (current state)");
  lines.push("");
  lines.push(
    "Domain-level view of where the 204 pack entries sit today. Use alongside the anchor table to pick a coherent Batch D theme.",
  );
  lines.push("");
  lines.push("| domain | entries |");
  lines.push("| --- | ---: |");
  const domainEntries = [...supplyByDomain.entries()].sort(
    (a, b) => b[1] - a[1],
  );
  for (const [domain, count] of domainEntries) {
    lines.push(`| \`${domain}\` | ${count} |`);
  }
  lines.push("");

  lines.push("## Recommended Batch D shape");
  lines.push("");
  const top10 = gapRows.filter((r) => r.demand > 0).slice(0, 10);
  const totalTopDemand = top10.reduce((sum, r) => sum + r.demand, 0);
  lines.push(
    `- Target **the top ${top10.length} anchors** above (~${totalTopDemand} cumulative unfilled-demand events across the 5-seed sweep).`,
  );
  lines.push(
    `- Suggested draft count: **2-3 drafts per top anchor** = ~${top10.length * 2}-${top10.length * 3} drafts. Historical reject rate is ~16% (13/80 across batches A-C per \`.local/N1_REJECTION_REPORT.md\`), so authoring ~30-40 drafts should yield ~25-33 approved entries.`,
  );
  lines.push(
    `- Mathematical projection: filling the top ${top10.length} unfilled-demand anchors at full saturation could lift combined fill from ~${((packRows.length / allRows.length) * 100).toFixed(0)}% toward ~${(((packRows.length + totalTopDemand) / allRows.length) * 100).toFixed(0)}% — past the brief's 60% bar.`,
  );
  lines.push(
    `- Hand this list to the native-speaker reviewer (BI) for authoring + stamping. The agent must NOT author pack entries directly; only reviewer-stamped entries are eligible for ingest (see \`replit.md\` Architecture decisions § N1).`,
  );
  lines.push("");

  fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
  console.error(
    `[analyzeNigerianBatchDTargets] wrote ${outPath} (${gapRows.filter((r) => r.demand > 0).length} unfilled-demand anchors, top demand=${gapRows[0]?.demand ?? 0})`,
  );
}

main();
process.exit(0);
