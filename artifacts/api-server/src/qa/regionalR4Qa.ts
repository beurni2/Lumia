/**
 * PHASE R4 — REGIONAL VOICE-CLUSTER SAMPLING BIAS QA
 *
 * R4 is a sampling-config change inside `resolveVoiceCluster`, so the
 * meaningful QA is a deterministic sweep of the resolver across many
 * (salt, family, recipeIdx) tuples per region. This proves the bias
 * is wired correctly without paying the live-orchestrator latency
 * cost (count=5 × 4 regions × runHybridIdeator > 115s on CI).
 *
 * Acceptance bar:
 *   - western distribution byte-identical to a region=undefined sweep
 *     (zero entries pushed into biasedTable)
 *   - no region forces dominant cluster ≥70% (monoculture risk)
 *   - all 5 voice clusters have ≥1 occurrence per region (no cluster
 *     drops to 0 — the +0 baseline 2 slots guarantees this)
 *   - bias config integrity: all bonuses ≥ 0
 *
 * Output: .local/REGIONAL_R4_QA.md
 *
 * Run: pnpm exec tsx artifacts/api-server/src/qa/regionalR4Qa.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveVoiceCluster } from "../lib/coreCandidateGenerator";
import { REGIONS, type Region } from "@workspace/lumina-trends";
import { REGION_VOICE_BIAS } from "../lib/regionProfile";
import {
  VOICE_CLUSTERS,
  type VoiceClusterId,
} from "../lib/voiceClusters";
import type { PremiseCore } from "../lib/premiseCoreLibrary";

// All 8 families that map to a voice via FAMILY_VOICE.
const FAMILIES: PremiseCore["family"][] = [
  "self_betrayal",
  "self_as_relationship",
  "absurd_escalation",
  "confident_vs_real",
  "social_mask",
  "adulting_chaos",
  "dopamine_overthinking",
  "identity_exposure",
];

function sweep(region: Region | undefined): Record<VoiceClusterId, number> {
  const counts: Record<VoiceClusterId, number> = {
    dry_deadpan: 0,
    chaotic_confession: 0,
    quiet_realization: 0,
    overdramatic_reframe: 0,
    high_energy_rant: 0,
  };
  // 8 families × 50 salts × 5 recipeIdx = 2000 samples per region.
  for (const family of FAMILIES) {
    for (let salt = 0; salt < 50; salt++) {
      for (let recipeIdx = 0; recipeIdx < 5; recipeIdx++) {
        const cluster = resolveVoiceCluster({
          family,
          salt,
          coreId: `${family}__${salt}`,
          recipeIdx,
          ...(region ? { region } : {}),
        });
        counts[cluster]++;
      }
    }
  }
  return counts;
}

function fmtRow(
  region: string,
  counts: Record<VoiceClusterId, number>,
): string {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const pct = (k: VoiceClusterId): string =>
    `${counts[k]} (${((counts[k] / total) * 100).toFixed(1)}%)`;
  return (
    `| \`${region}\` | ` +
    [
      "dry_deadpan",
      "chaotic_confession",
      "quiet_realization",
      "overdramatic_reframe",
      "high_energy_rant",
    ]
      .map((k) => pct(k as VoiceClusterId))
      .join(" | ") +
    ` | ${total} |`
  );
}

function main(): void {
  const lines: string[] = [];
  lines.push("# PHASE R4 — Regional Voice-Cluster Bias QA");
  lines.push("");
  lines.push(
    "Synthetic sweep of `resolveVoiceCluster` across 8 families × 50 salts × 5 recipeIdx = **2 000 samples per region**. Proves the additive `REGION_VOICE_BIAS` config produces the intended distribution shift without paying the live-orchestrator cost. Live R1 QA already validated end-to-end orchestrator correctness; R4 only changes voice-table weights, so the resolver-level sweep is the appropriate gate.",
  );
  lines.push("");
  lines.push("## Bias config (additive +slot bonus per region)");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(REGION_VOICE_BIAS, null, 2));
  lines.push("```");
  lines.push("");

  // Baseline: region=undefined (the pre-R4 path).
  const baseline = sweep(undefined);

  lines.push("## Distribution by region");
  lines.push("");
  lines.push(
    "| region | dry_deadpan | chaotic_confession | quiet_realization | overdramatic_reframe | high_energy_rant | total |",
  );
  lines.push(
    "| --- | --- | --- | --- | --- | --- | --- |",
  );
  lines.push(fmtRow("(undefined / pre-R4)", baseline));

  const distros: Record<Region, Record<VoiceClusterId, number>> = {} as Record<
    Region,
    Record<VoiceClusterId, number>
  >;
  for (const region of REGIONS) {
    distros[region] = sweep(region);
    lines.push(fmtRow(region, distros[region]));
  }
  lines.push("");

  // ---- Acceptance checks --------------------------------------- //
  const westernSame =
    JSON.stringify(distros.western) === JSON.stringify(baseline);

  const noClusterDrops = REGIONS.every((region) =>
    VOICE_CLUSTERS.every((c) => (distros[region][c.id] ?? 0) > 0),
  );

  const dominantPctByRegion: Record<Region, number> = {} as Record<
    Region,
    number
  >;
  for (const region of REGIONS) {
    const counts = distros[region];
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    dominantPctByRegion[region] =
      Math.max(...Object.values(counts)) / total;
  }
  const noMonoculture = Object.values(dominantPctByRegion).every(
    (p) => p < 0.7,
  );

  const allBonusesNonNeg = Object.values(REGION_VOICE_BIAS).every((entry) =>
    Object.values(entry).every((v) => (v ?? 0) >= 0),
  );

  // Spec-aligned shifts: each non-western region's intended cluster
  // should have a HIGHER share than the baseline (sanity check that
  // the bias landed where intended).
  const expectedShifts: Record<Region, VoiceClusterId> = {
    western: "dry_deadpan", // unused (western is identity)
    nigeria: "chaotic_confession",
    india: "quiet_realization",
    philippines: "chaotic_confession",
  };
  const intendedShiftsLanded: Record<Region, boolean> = {} as Record<
    Region,
    boolean
  >;
  for (const region of REGIONS) {
    if (region === "western") {
      intendedShiftsLanded[region] = true; // n/a
      continue;
    }
    const target = expectedShifts[region];
    const baselineShare =
      baseline[target] /
      Object.values(baseline).reduce((a, b) => a + b, 0);
    const regionShare =
      distros[region][target] /
      Object.values(distros[region]).reduce((a, b) => a + b, 0);
    intendedShiftsLanded[region] = regionShare > baselineShare;
  }
  const allShiftsLanded = Object.values(intendedShiftsLanded).every(Boolean);

  lines.push("---");
  lines.push("");
  lines.push("## Acceptance");
  lines.push("");
  lines.push(
    `- **western byte-identical to baseline**: ${westernSame ? "✓" : "✗ REGRESSION"}`,
  );
  lines.push(
    `- **all 5 clusters survive in every region** (no cluster drops to 0): ${noClusterDrops ? "✓" : "✗ REGRESSION"}`,
  );
  lines.push(
    `- **no region exceeds 70% on a single cluster** (monoculture guard): ${noMonoculture ? "✓" : "✗ MONOCULTURE"}`,
  );
  lines.push(
    `- **bias config integrity (all bonuses ≥ 0)**: ${allBonusesNonNeg ? "✓" : "✗"}`,
  );
  lines.push(
    `- **intended bias landed for every non-western region**: ${allShiftsLanded ? "✓" : "✗"}`,
  );
  lines.push("");
  lines.push("### Per-region dominant-cluster share");
  lines.push("");
  for (const region of REGIONS) {
    lines.push(
      `- \`${region}\`: ${(dominantPctByRegion[region] * 100).toFixed(1)}%`,
    );
  }
  lines.push("");
  lines.push("### Per-region intended-shift verification");
  lines.push("");
  for (const region of REGIONS) {
    if (region === "western") {
      lines.push(`- \`${region}\`: n/a (identity)`);
      continue;
    }
    const target = expectedShifts[region];
    const baselineShare =
      (baseline[target] /
        Object.values(baseline).reduce((a, b) => a + b, 0)) *
      100;
    const regionShare =
      (distros[region][target] /
        Object.values(distros[region]).reduce((a, b) => a + b, 0)) *
      100;
    lines.push(
      `- \`${region}\` → \`${target}\`: ${baselineShare.toFixed(1)}% → ${regionShare.toFixed(1)}% (${(regionShare - baselineShare).toFixed(1)}pp ${regionShare > baselineShare ? "✓" : "✗"})`,
    );
  }
  lines.push("");

  const __filename = fileURLToPath(import.meta.url);
  const workspaceRoot = path.resolve(path.dirname(__filename), "../../../..");
  const outDir = path.join(workspaceRoot, ".local");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "REGIONAL_R4_QA.md");
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  console.error(`[regionalR4Qa] wrote ${lines.length} lines to ${outPath}`);
}

main();
