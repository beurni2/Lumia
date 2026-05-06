// PHASE N1-INSTRUMENT — Throttle measurement + non-pack style audit.
//
// Two reads in one sweep:
//
//   1. THROTTLE: per-(seed, cohort, core) record of how many pack
//      entries make it through each gate (eligible → matching →
//      attempted → authoredOk → survivedFpDedup → enteredPassing).
//      Subscribes to the additive observer hook in
//      `coreCandidateGenerator.ts` (PHASE N1-INSTRUMENT). Aggregates
//      across the 5-seed sweep × 2 NG-eligible cohorts so we can
//      tell which throttle gate is the marginal one. Decision tree:
//        - mean(matching) ≤ 3        → R1 (raise drawCap) gains nothing
//        - mean(matching == 0) high  → R2 (relax domain filter) wins
//        - mean(matching) ≥ 5        → R1 has real headroom
//        - attempted ≈ authoredOk
//          but pack share still low  → quality-loss to catalog → R3 wins
//
//   2. STYLE AUDIT: heuristic classification of non-pack NG-pidgin
//      hooks into "american-internet-style" vs. "neutral" vs.
//      "pidgin-leaning". Based on curated phrase lists (American Gen-Z
//      patterns vs. authentic Pidgin tokens). Heuristic, NOT human-
//      validated — output includes per-class examples for the user
//      to spot-check. Purpose: confirm or refute that the catalog-
//      recipe path is shipping wrong-style content for NG-pidgin
//      users at a rate that would block rollout independently of
//      fill rate.
//
// Hard-rule compliance:
//   - The instrumentation hook in production code is gated by
//     `globalThis.__nigerianThrottleObserver`; when unset (the
//     default), it is a no-op. Production behavior unchanged.
//   - Read-only sweep using the existing harness exports.
//   - Outputs to .local only.

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
import {
  NIGERIAN_HOOK_PACK,
  isNigerianPackFeatureEnabled,
} from "../lib/nigerianHookPack.js";
import { AMERICAN_INTERNET_PATTERNS } from "../lib/nigerianStylePenalty.js";

// ─── Throttle observer types ─── //
type ThrottleRecord = {
  seed: number;
  cohort: string;
  coreId: string;
  eligible: number;
  matching: number;
  attempted: number;
  authoredOk: number;
  survivedFpDedup: number;
  enteredPassing: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __nigerianThrottleObserver:
    | ((rec: Omit<ThrottleRecord, "seed" | "cohort">) => void)
    | undefined;
}

// ─── Style audit patterns ─── //
// American Gen-Z internet vernacular — imported from the shared
// `nigerianStylePenalty` module so the audit and the production
// penalty stay perfectly aligned (single source of truth).

// Authentic Nigerian-Pidgin tokens / cadence markers. Presence of
// any of these (case-insensitive) strongly suggests the hook reads
// as Nigerian-native rather than American-internet.
const PIDGIN_TOKENS: ReadonlyArray<RegExp> = [
  /\babeg\b/i,
  /\bwahala\b/i,
  /\bsef\b/i,
  /\bna\b/i, // "na you", "na me" — Pidgin copula
  /\bdon\b/i, // "don finish", "don tire" — Pidgin perfective
  /\bno (be|de|fit|wan)\b/i,
  /\bunà\b|\buna\b/i,
  /\bnaija\b/i,
  /\bpalava\b/i,
  /\bgist\b/i,
  /\bmadam\b/i,
  /\baunty\b|\bauntie\b/i,
  /\bconductor\b/i,
  /\bdanfo\b/i,
  /\bgo dey\b|\bdey go\b/i,
  /\bchai\b/i,
  /\boya\b/i,
  /\bsabi\b/i,
];

type StyleClass =
  | "american-internet"
  | "pidgin-leaning"
  | "neutral";

function classifyStyle(hook: string): {
  cls: StyleClass;
  internetMatches: string[];
  pidginMatches: string[];
} {
  const internetMatches: string[] = [];
  for (const r of AMERICAN_INTERNET_PATTERNS) {
    const m = hook.match(r);
    if (m) internetMatches.push(m[0]);
  }
  const pidginMatches: string[] = [];
  for (const r of PIDGIN_TOKENS) {
    const m = hook.match(r);
    if (m) pidginMatches.push(m[0]);
  }
  // Prefer pidgin signal when both are present (rare); otherwise
  // internet beats neutral; otherwise neutral.
  let cls: StyleClass = "neutral";
  if (pidginMatches.length > 0) cls = "pidgin-leaning";
  else if (internetMatches.length > 0) cls = "american-internet";
  return { cls, internetMatches, pidginMatches };
}

function main(): void {
  if (!isNigerianPackFeatureEnabled()) {
    console.error(
      "[instrumentNigerianThrottle] ABORT: LUMINA_NG_PACK_ENABLED must be 'true'.",
    );
    process.exit(2);
  }
  if (NIGERIAN_HOOK_PACK.length === 0) {
    console.error("[instrumentNigerianThrottle] ABORT: pack is empty.");
    process.exit(2);
  }

  const COHORT_BASE_SALTS: Record<string, number> = {
    ng_light_pidgin: 1,
    ng_pidgin: 1009,
  };
  const eligibleCohortLabels = ["ng_light_pidgin", "ng_pidgin"] as const;
  const eligibleCohorts = COHORTS.filter((c) =>
    (eligibleCohortLabels as readonly string[]).includes(c.label),
  );

  const throttleRecords: ThrottleRecord[] = [];
  const allRows: Row[] = [];

  for (const seed of DEFAULT_SWEEP_SEEDS) {
    for (const cohort of eligibleCohorts) {
      // Wire the observer for this run only; clear after.
      globalThis.__nigerianThrottleObserver = (rec) => {
        throttleRecords.push({ seed, cohort: cohort.label, ...rec });
      };
      try {
        withSeededRandom(seed, () => {
          const baseSalt = COHORT_BASE_SALTS[cohort.label] ?? 1;
          const rows = runCohort(cohort, baseSalt);
          for (const r of rows) allRows.push(r);
        });
      } finally {
        globalThis.__nigerianThrottleObserver = undefined;
      }
    }
    console.error(`[instrumentNigerianThrottle] seed=${seed} done`);
  }

  // ─── Throttle aggregation ─── //
  const N = throttleRecords.length;
  const sum = (sel: (r: ThrottleRecord) => number) =>
    throttleRecords.reduce((s, r) => s + sel(r), 0);
  const mean = (sel: (r: ThrottleRecord) => number) => (N === 0 ? 0 : sum(sel) / N);
  const countWhere = (pred: (r: ThrottleRecord) => boolean) =>
    throttleRecords.filter(pred).length;

  const meanEligible = mean((r) => r.eligible);
  const meanMatching = mean((r) => r.matching);
  const meanAttempted = mean((r) => r.attempted);
  const meanAuthoredOk = mean((r) => r.authoredOk);
  const meanSurvived = mean((r) => r.survivedFpDedup);
  const meanEntered = mean((r) => r.enteredPassing);
  const matchingZeroPct = N === 0 ? 0 : (countWhere((r) => r.matching === 0) / N) * 100;
  const matchingGe5Pct = N === 0 ? 0 : (countWhere((r) => r.matching >= 5) / N) * 100;
  const matchingGeAttemptedAndGtCapPct =
    N === 0 ? 0 : (countWhere((r) => r.matching > r.attempted) / N) * 100;
  const authoredDropPct =
    sum((r) => r.attempted) === 0
      ? 0
      : (1 - sum((r) => r.authoredOk) / sum((r) => r.attempted)) * 100;
  const fpDropPct =
    sum((r) => r.authoredOk) === 0
      ? 0
      : (1 - sum((r) => r.survivedFpDedup) / sum((r) => r.authoredOk)) * 100;
  const enteredPassingTotal = sum((r) => r.enteredPassing);

  // ─── Throttle decision tree ─── //
  let throttleVerdict = "";
  const reasons: string[] = [];
  if (meanMatching < 3) {
    throttleVerdict =
      "**R1 (raise NIGERIAN_PACK_PREFIX_CAP) gains nothing** — mean matching count per (cohort, core) is below the current cap of 3, so raising the cap does not unlock additional pack candidates.";
    if (matchingZeroPct >= 25) {
      reasons.push(
        `${matchingZeroPct.toFixed(1)}% of (cohort, core) cells have ZERO matching pack entries — the per-core domain filter is the dominant chokepoint. **R2 (relax domain filter, cohort-gated) is the marginal lever.**`,
      );
    } else {
      reasons.push(
        `Matching set is small but non-zero on most cells (only ${matchingZeroPct.toFixed(1)}% are empty). R2 would help on the empty cells but its ceiling is bounded by how many cells it can rescue.`,
      );
    }
  } else if (matchingGtAttemptedHelper(meanMatching)) {
    throttleVerdict =
      "**R1 (raise NIGERIAN_PACK_PREFIX_CAP from 3 to 5 or 6) has real headroom** — mean matching count per (cohort, core) exceeds the current cap, so raising the cap unlocks pack entries that the salt rotation currently leaves on the table.";
    reasons.push(
      `${matchingGeAttemptedAndGtCapPct.toFixed(1)}% of (cohort, core) cells have more matching entries than the cap allows to be tried.`,
    );
    reasons.push(
      `Caveat: prior Option-C interleave attempt regressed staging QA via fp-dedup correlation across sibling cores (.local/N1_ROTATION_FIX_PROPOSAL.md). Raising the cap touches the same correlation surface — must run staging QA after any change.`,
    );
  } else {
    throttleVerdict =
      "Throttle gates leave room but the binding constraint is downstream (validators / fp-dedup / quality competition).";
  }
  if (authoredDropPct >= 20) {
    reasons.push(
      `Validator drop rate is ${authoredDropPct.toFixed(1)}% (attempted → authoredOk). Pack content is failing scenarioCoherence/comedy/anti-copy at meaningful rate — Batch D drafts would inherit this rate. Worth a separate audit of WHICH validators are dropping pack candidates.`,
    );
  }
  if (fpDropPct >= 30) {
    reasons.push(
      `Fingerprint-dedup drop rate is ${fpDropPct.toFixed(1)}% (authoredOk → survivedFpDedup). High intra-batch fp correlation across sibling cores is real — this is the same failure mode that broke Option-C, and it caps the benefit of any matcher relaxation.`,
    );
  }

  // ─── Style audit ─── //
  const nonPackRows = allRows.filter((r) => r.packEntryId === undefined);
  type Classified = {
    row: Row;
    cls: StyleClass;
    internetMatches: string[];
    pidginMatches: string[];
  };
  const classified: Classified[] = nonPackRows.map((r) => {
    const c = classifyStyle(r.hook);
    return { row: r, ...c };
  });
  const styleCounts: Record<StyleClass, number> = {
    "american-internet": 0,
    "pidgin-leaning": 0,
    neutral: 0,
  };
  for (const c of classified) styleCounts[c.cls] += 1;
  const totalNonPack = classified.length;
  const internetPct =
    totalNonPack === 0 ? 0 : (styleCounts["american-internet"] / totalNonPack) * 100;
  const pidginPct =
    totalNonPack === 0 ? 0 : (styleCounts["pidgin-leaning"] / totalNonPack) * 100;
  const neutralPct =
    totalNonPack === 0 ? 0 : (styleCounts.neutral / totalNonPack) * 100;

  let styleVerdict = "";
  if (internetPct >= 25) {
    styleVerdict = `**Style issue confirmed** — ${internetPct.toFixed(1)}% of non-pack NG-pidgin hooks trip American-internet patterns. This is a content-correctness ship-blocker independent of fill rate. Even at 100% pack-fill, the catalog-side ${(100 - 100 * (totalNonPack / (totalNonPack + (allRows.length - totalNonPack))))}% slot would still ship wrong-style content.`;
  } else if (internetPct >= 10) {
    styleVerdict = `**Style issue moderate** — ${internetPct.toFixed(1)}% of non-pack hooks trip internet patterns. Worth raising with BI but probably not a hard ship-blocker on its own.`;
  } else {
    styleVerdict = `**Style issue not confirmed by heuristic** — only ${internetPct.toFixed(1)}% trip the patterns. Either the v2 unmatched-43% finding was sample-driven, or the heuristic patterns are missing the actual style markers BI would flag. Recommend manual spot-check of the "neutral" bucket below before concluding.`;
  }

  // ─── Render report ─── //
  const __filename = fileURLToPath(import.meta.url);
  const workspaceRoot = path.resolve(path.dirname(__filename), "../../../..");
  const outDir = path.join(workspaceRoot, ".local");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "N1_THROTTLE_INSTRUMENTATION.md");

  const lines: string[] = [];
  lines.push("# N1 — Throttle Instrumentation + Non-Pack Style Audit");
  lines.push("");
  lines.push(
    `_generated by_: \`artifacts/api-server/src/qa/instrumentNigerianThrottle.ts\``,
  );
  lines.push(
    `_method (throttle)_: 5-seed sweep × 2 NG-eligible cohorts; subscribes to the additive observer hook in \`coreCandidateGenerator.ts\` (PHASE N1-INSTRUMENT, opt-in via \`globalThis.__nigerianThrottleObserver\`).`,
  );
  lines.push(
    `_method (style audit)_: heuristic regex classification of all non-pack hooks emitted by the same sweep against curated American-internet vs. authentic-Pidgin pattern lists. NOT human-validated — examples below for spot-check.`,
  );
  lines.push(
    `_sample (throttle)_: ${N} (cohort, core) records across ${DEFAULT_SWEEP_SEEDS.length} seeds × ${eligibleCohorts.length} cohorts.`,
  );
  lines.push(
    `_sample (style)_: ${totalNonPack} non-pack hooks (${allRows.length} total ideas, ${(((allRows.length - totalNonPack) / allRows.length) * 100).toFixed(1)}% pack-filled).`,
  );
  lines.push("");
  lines.push("---");
  lines.push("");

  // PART 1: throttle
  lines.push("## Part 1 — Throttle behavior");
  lines.push("");
  lines.push("Per-(cohort, core) pack-entry counts at each gate. Mean across all records:");
  lines.push("");
  lines.push("| gate | mean per (cohort, core) | aggregate drop % from prior gate |");
  lines.push("| --- | ---: | ---: |");
  lines.push(`| eligible (after region/style filter) | ${meanEligible.toFixed(2)} | — |`);
  lines.push(
    `| matching (after per-core domain filter) | ${meanMatching.toFixed(2)} | ${meanEligible === 0 ? "—" : ((1 - meanMatching / meanEligible) * 100).toFixed(1) + "%"} |`,
  );
  lines.push(
    `| attempted (after \`drawCap=${"NIGERIAN_PACK_PREFIX_CAP=3"}\` truncation) | ${meanAttempted.toFixed(2)} | ${meanMatching === 0 ? "—" : ((1 - meanAttempted / meanMatching) * 100).toFixed(1) + "%"} |`,
  );
  lines.push(
    `| authoredOk (after 4 production validators) | ${meanAuthoredOk.toFixed(2)} | ${meanAttempted === 0 ? "—" : ((1 - meanAuthoredOk / meanAttempted) * 100).toFixed(1) + "%"} |`,
  );
  lines.push(
    `| survivedFpDedup (intra+cross-batch fp gate) | ${meanSurvived.toFixed(2)} | ${meanAuthoredOk === 0 ? "—" : ((1 - meanSurvived / meanAuthoredOk) * 100).toFixed(1) + "%"} |`,
  );
  lines.push(
    `| enteredPassing (competes on quality vs. catalog) | ${meanEntered.toFixed(2)} | ${meanSurvived === 0 ? "—" : ((1 - meanEntered / meanSurvived) * 100).toFixed(1) + "%"} |`,
  );
  lines.push("");
  lines.push("Distributional signals:");
  lines.push("");
  lines.push(`- (cohort, core) cells with **zero** matching pack entries: **${matchingZeroPct.toFixed(1)}%**`);
  lines.push(`- (cohort, core) cells with **≥ 5** matching pack entries: **${matchingGe5Pct.toFixed(1)}%**`);
  lines.push(
    `- (cohort, core) cells where matching > attempted (cap throttled them): **${matchingGeAttemptedAndGtCapPct.toFixed(1)}%**`,
  );
  lines.push(`- Total pack candidates that entered \`passing[]\` across the sweep: **${enteredPassingTotal}**`);
  lines.push("");
  lines.push("### Throttle verdict");
  lines.push("");
  lines.push(throttleVerdict);
  lines.push("");
  for (const r of reasons) lines.push(`- ${r}`);
  lines.push("");

  // PART 2: style
  lines.push("---");
  lines.push("");
  lines.push("## Part 2 — Non-pack style audit");
  lines.push("");
  lines.push("Heuristic classification of all non-pack NG-pidgin hooks:");
  lines.push("");
  lines.push("| class | count | % of non-pack |");
  lines.push("| --- | ---: | ---: |");
  lines.push(
    `| **american-internet** | ${styleCounts["american-internet"]} | ${internetPct.toFixed(1)}% |`,
  );
  lines.push(
    `| **pidgin-leaning** | ${styleCounts["pidgin-leaning"]} | ${pidginPct.toFixed(1)}% |`,
  );
  lines.push(`| neutral | ${styleCounts.neutral} | ${neutralPct.toFixed(1)}% |`);
  lines.push("");
  lines.push("### Style verdict");
  lines.push("");
  lines.push(styleVerdict);
  lines.push("");

  // Examples per class for user spot-check
  for (const cls of [
    "american-internet",
    "neutral",
    "pidgin-leaning",
  ] as const) {
    const examples = classified.filter((c) => c.cls === cls).slice(0, 10);
    if (examples.length === 0) continue;
    lines.push(`### Examples — \`${cls}\` (up to 10)`);
    lines.push("");
    for (const e of examples) {
      const matchTag =
        cls === "american-internet"
          ? ` _(matched: ${JSON.stringify(e.internetMatches)})_`
          : cls === "pidgin-leaning"
            ? ` _(matched: ${JSON.stringify(e.pidginMatches)})_`
            : "";
      lines.push(`- ${JSON.stringify(e.row.hook)}${matchTag} _(cohort: ${e.row.cohort})_`);
    }
    lines.push("");
  }

  // Decision summary
  lines.push("---");
  lines.push("");
  lines.push("## Combined decision");
  lines.push("");
  lines.push(
    "Read the throttle verdict and style verdict together — they answer different questions:",
  );
  lines.push("");
  lines.push(
    `- **Fill rate** (target 60%, current 50%): the throttle table tells you which lever (R1/R2/R3) is marginal, or that none of them are.`,
  );
  lines.push(
    `- **Content correctness** (independent of fill rate): the style audit tells you whether the catalog-recipe path is shipping wrong-style hooks at a rate that's a ship-blocker on its own.`,
  );
  lines.push("");
  lines.push(
    `Fix the more dangerous one first. If style is a ship-blocker, no amount of fill-rate tuning matters — the wrong-style hooks still ship in the non-pack slots. If throttle has a clear marginal lever AND style is acceptable, take that lever.`,
  );
  lines.push("");

  fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
  console.error(
    `[instrumentNigerianThrottle] wrote ${outPath} (throttle records=${N}, non-pack hooks=${totalNonPack}, internet-style=${styleCounts["american-internet"]}, pidgin-leaning=${styleCounts["pidgin-leaning"]})`,
  );
}

// Helper used in throttle-verdict branch above (kept named for
// readability — `meanMatching > NIGERIAN_PACK_PREFIX_CAP=3`).
function matchingGtAttemptedHelper(meanMatching: number): boolean {
  return meanMatching > 3;
}

main();
process.exit(0);
