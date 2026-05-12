/**
 * P16-A1 — predict-the-impact harness for the staging-flagged
 * HQS HUMAN-LIFT scorer.
 *
 * Reads every approved Western + Nigerian pack hook (the same hooks
 * that ship through the live picker) plus the curated Nigerian
 * draft worksheet. Scores each hook TWICE — once with the flag OFF
 * (baseline) and once with the flag ON. Reports:
 *
 *   • Distribution: flag-OFF vs flag-ON totals (mean / median / p10 /
 *     p90 / max delta).
 *   • Floor crossings: how many hooks crossed the picker floor (50)
 *     or the boot floor (40) in EITHER direction. P16-A1 is pure-
 *     positive so the only legitimate crossing is OFF→ON upward.
 *   • Per-signal attribution: how many hooks fired understatedAbsurdity
 *     vs emotionalSpecificity vs brevityWideningDelta (and at what
 *     average magnitude).
 *   • Top-20 movers (largest +delta hooks) so a reviewer can sanity-
 *     check that the lift goes to the right kind of writing.
 *
 * Pure read-only / deterministic — no DB writes, no LLM calls, no
 * pack mutations.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx \
 *     src/qa/predictHumanLiftCorpusImpact.ts \
 *     > .local/HQS_HUMAN_LIFT_P16_A1_PREDICT.md
 */

import {
  scoreHookQualityDetailed,
  type HookQualityBreakdown,
} from "../lib/hookQuality.js";
import { NIGERIAN_HOOK_PACK } from "../lib/nigerianHookPack.js";
import { DRAFT_NIGERIAN_HOOK_PACK } from "../lib/nigerianHookPackDrafts.js";
import { APPROVED_WESTERN_PROMOTION_CANDIDATES } from "../lib/westernHookPackApproved.js";
import type { PremiseCoreFamily } from "../lib/premiseCoreLibrary.js";

const FLAG = "LUMINA_HQS_HUMAN_LIFT_ENABLED";

// Pick a single representative family for scoring — the family arg
// is currently unused by the scoring math (see hookQuality.ts L757)
// so this preserves apples-to-apples baseline vs lift comparison.
const FAMILY: PremiseCoreFamily = "self_betrayal";

type Sample = {
  source: string;
  id: string;
  hook: string;
};

function loadCorpus(): Sample[] {
  const samples: Sample[] = [];
  for (const e of NIGERIAN_HOOK_PACK) {
    samples.push({ source: "ng_pack_approved", id: e.id, hook: e.hook });
  }
  let draftIdx = 0;
  for (const e of DRAFT_NIGERIAN_HOOK_PACK) {
    draftIdx += 1;
    const id =
      (e as { id?: string }).id ?? `draft_${String(draftIdx).padStart(3, "0")}`;
    samples.push({ source: "ng_pack_draft", id, hook: e.hook });
  }
  for (const e of APPROVED_WESTERN_PROMOTION_CANDIDATES) {
    samples.push({ source: "western_approved", id: e.id, hook: e.hook });
  }
  return samples;
}

function scoreBoth(
  hook: string,
): { off: HookQualityBreakdown; on: HookQualityBreakdown } {
  const saved = process.env[FLAG];
  delete process.env[FLAG];
  const off = scoreHookQualityDetailed(hook, FAMILY);
  process.env[FLAG] = "1";
  const on = scoreHookQualityDetailed(hook, FAMILY);
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
  return { off, on };
}

function pct(arr: number[], q: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[idx];
}
function mean(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function run(): void {
  const samples = loadCorpus();
  const rows = samples.map((s) => {
    const { off, on } = scoreBoth(s.hook);
    return {
      ...s,
      off,
      on,
      delta: on.total - off.total,
      crossedPicker:
        (off.total < 50 && on.total >= 50) || (off.total >= 50 && on.total < 50),
      crossedBoot:
        (off.total < 40 && on.total >= 40) || (off.total >= 40 && on.total < 40),
    };
  });

  const deltas = rows.map((r) => r.delta);
  const offTotals = rows.map((r) => r.off.total);
  const onTotals = rows.map((r) => r.on.total);

  // Per-signal attribution
  let understatedFires = 0;
  let understatedSum = 0;
  let emotionFires = 0;
  let emotionSum = 0;
  let wideningFires = 0;
  let wideningSum = 0;
  for (const r of rows) {
    if (r.on.humanLift.understatedAbsurdity > 0) {
      understatedFires++;
      understatedSum += r.on.humanLift.understatedAbsurdity;
    }
    if (r.on.humanLift.emotionalSpecificity > 0) {
      emotionFires++;
      emotionSum += r.on.humanLift.emotionalSpecificity;
    }
    if (r.on.humanLift.brevityWideningDelta > 0) {
      wideningFires++;
      wideningSum += r.on.humanLift.brevityWideningDelta;
    }
  }

  const movers = [...rows]
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 20);

  const downwardMovers = rows.filter((r) => r.delta < 0);
  const downwardPickerCross = rows.filter(
    (r) => r.off.total >= 50 && r.on.total < 50,
  );
  const downwardBootCross = rows.filter(
    (r) => r.off.total >= 40 && r.on.total < 40,
  );

  const lines: string[] = [];
  lines.push("# P16-A1 HUMAN-LIFT SCORER — Predict-the-Impact Report");
  lines.push("");
  lines.push(`Corpus: ${samples.length} hooks total`);
  for (const src of ["ng_pack_approved", "ng_pack_draft", "western_approved"]) {
    const c = samples.filter((s) => s.source === src).length;
    lines.push(`  - ${src}: ${c}`);
  }
  lines.push("");
  lines.push("## 1. Score distribution (flag OFF vs flag ON)");
  lines.push("");
  lines.push("|        | mean | median | p10 | p90 | min | max |");
  lines.push("|--------|------|--------|-----|-----|-----|-----|");
  lines.push(
    `| OFF    | ${fmt(mean(offTotals))} | ${fmt(pct(offTotals, 0.5))} | ${fmt(pct(offTotals, 0.1))} | ${fmt(pct(offTotals, 0.9))} | ${Math.min(...offTotals)} | ${Math.max(...offTotals)} |`,
  );
  lines.push(
    `| ON     | ${fmt(mean(onTotals))} | ${fmt(pct(onTotals, 0.5))} | ${fmt(pct(onTotals, 0.1))} | ${fmt(pct(onTotals, 0.9))} | ${Math.min(...onTotals)} | ${Math.max(...onTotals)} |`,
  );
  lines.push(
    `| Δ      | ${fmt(mean(deltas))} | ${fmt(pct(deltas, 0.5))} | ${fmt(pct(deltas, 0.1))} | ${fmt(pct(deltas, 0.9))} | ${Math.min(...deltas)} | ${Math.max(...deltas)} |`,
  );
  lines.push("");
  lines.push("## 2. Pure-positive guarantee");
  lines.push("");
  lines.push(`- Hooks with delta < 0: **${downwardMovers.length}** (must be 0)`);
  lines.push(`- Downward picker crossings (50): **${downwardPickerCross.length}** (must be 0)`);
  lines.push(`- Downward boot crossings (40): **${downwardBootCross.length}** (must be 0)`);
  lines.push("");
  lines.push("## 3. Floor-crossing summary (upward only is legitimate)");
  lines.push("");
  const upPicker = rows.filter((r) => r.off.total < 50 && r.on.total >= 50);
  const upBoot = rows.filter((r) => r.off.total < 40 && r.on.total >= 40);
  lines.push(`- Upward picker crossings (OFF<50, ON≥50): **${upPicker.length}**`);
  lines.push(`- Upward boot crossings (OFF<40, ON≥40): **${upBoot.length}**`);
  lines.push("");
  lines.push("## 4. Per-signal attribution");
  lines.push("");
  lines.push("| Signal | Fires | % of corpus | Mean magnitude when fired |");
  lines.push("|--------|------:|------------:|--------------------------:|");
  lines.push(
    `| understatedAbsurdity | ${understatedFires} | ${fmt((understatedFires / rows.length) * 100)}% | ${understatedFires ? fmt(understatedSum / understatedFires) : "—"} |`,
  );
  lines.push(
    `| emotionalSpecificity | ${emotionFires} | ${fmt((emotionFires / rows.length) * 100)}% | ${emotionFires ? fmt(emotionSum / emotionFires) : "—"} |`,
  );
  lines.push(
    `| brevityWideningDelta | ${wideningFires} | ${fmt((wideningFires / rows.length) * 100)}% | ${wideningFires ? fmt(wideningSum / wideningFires) : "—"} |`,
  );
  lines.push("");
  lines.push("## 5. Top-20 +delta movers");
  lines.push("");
  lines.push("| source | id | OFF | ON | Δ | UA | ES | BW | hook |");
  lines.push("|--------|----|----:|---:|--:|---:|---:|---:|------|");
  for (const m of movers) {
    lines.push(
      `| ${m.source} | ${m.id} | ${m.off.total} | ${m.on.total} | +${m.delta} | ${m.on.humanLift.understatedAbsurdity} | ${m.on.humanLift.emotionalSpecificity} | ${m.on.humanLift.brevityWideningDelta} | ${m.hook.replace(/\|/g, "\\|").slice(0, 80)} |`,
    );
  }
  lines.push("");
  lines.push("## 6. Methodology");
  lines.push("");
  lines.push(
    "- Each hook scored twice via `scoreHookQualityDetailed` (the canonical scorer used by `voiceClusters.ts` boot assert + `willingnessScorer.ts` picker).",
  );
  lines.push(
    "- Env var `LUMINA_HQS_HUMAN_LIFT_ENABLED` toggled per-call via direct `process.env` mutation; restored to original value at end of run (deterministic).",
  );
  lines.push(
    "- Family arg pinned to `self_betrayal` (the family arg is unused by the scoring math today; pinning preserves apples-to-apples).",
  );
  lines.push(
    "- No DB / LLM / pack mutations. No production gates touched. Predict-only.",
  );
  console.log(lines.join("\n"));
}

run();
