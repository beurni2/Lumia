// PHASE N1-BATCH-D-GAP v2 — Domain-level pack-supply gap analysis.
//
// v1 was withdrawn: it compared two different things (hand-curated
// pack `anchor` vs orchestrator-extracted non-pack `anchor`), which
// surfaced stop words ("the", "watched", "someone") as the top
// "unfilled demand" — useless as a Batch D brief.
//
// v2 method:
//   1. Build a per-domain keyword vocabulary from pack entries
//      (anchor + hook + whatToShow tokens, stopword-filtered).
//   2. For each non-pack row in NG-eligible cohorts (5 seeds × 60 =
//      300 ideas), classify its HOOK text into the pack domain with
//      the highest token-overlap count, or "unmatched" if no
//      pack-domain vocabulary matches.
//   3. Compute demand_share% (non-pack rows per domain) and
//      supply_share% (pack entries per domain). Gap_pp = demand% −
//      supply%; positive = under-served.
//   4. Surface representative non-pack hooks for under-served
//      domains so the reviewer (BI) sees concrete content to
//      author Batch D against, not just numbers.
//
// Hard-rule compliance:
//   - Read-only analysis. No production code, validators, scorers,
//     thresholds, or pack content touched.
//   - Imports the harness purely for `runCohort` + seeded random.
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
import {
  NIGERIAN_HOOK_PACK,
  isNigerianPackFeatureEnabled,
} from "../lib/nigerianHookPack.js";

// ─── Tokenization ─── //
// Common English + Nigerian-Pidgin stop words. Conservative list
// (lowercased, length ≥ 2 captured by regex). Pidgin discourse
// markers ("don", "abeg", "wahala") intentionally KEPT — they're
// content-bearing for this domain.
const STOPWORDS = new Set<string>([
  // articles, conjunctions, prepositions
  "the", "and", "but", "for", "with", "from", "into", "onto", "upon",
  "this", "that", "these", "those", "what", "when", "where", "why",
  "how", "who", "which", "than", "then", "now", "just", "even",
  "still", "only", "also", "very", "too", "out", "off", "over",
  "under", "about", "after", "before", "again", "own", "same",
  "such", "more", "most", "other", "another", "each", "either",
  "neither", "both", "few", "many", "much", "less", "least", "all",
  "any", "some", "one", "two", "three", "yes",
  // pronouns & possessives
  "you", "your", "yours", "they", "them", "their", "theirs", "she",
  "his", "her", "hers", "him", "its", "our", "ours", "myself",
  "yourself", "himself", "herself", "itself", "ourselves", "themselves",
  // verbs (auxiliaries / very generic)
  "are", "was", "were", "been", "being", "have", "has", "had",
  "will", "would", "could", "should", "can", "may", "might", "must",
  "did", "does", "doing", "done", "got", "get", "getting", "make",
  "made", "making", "take", "took", "taking", "taken", "give",
  "gave", "given", "giving", "say", "said", "saying", "tell", "told",
  "telling", "know", "knew", "known", "knowing", "think", "thought",
  "thinking", "feel", "felt", "feeling", "want", "wanted", "wanting",
  "need", "needed", "needing", "use", "used", "using", "find",
  "found", "finding", "show", "showed", "showing", "shown", "put",
  "putting", "ask", "asked", "asking", "look", "looked", "looking",
  "see", "saw", "seen", "seeing", "come", "came", "coming", "went",
  "going", "goes", "go",
  // generic intensifiers / fillers
  "really", "actually", "basically", "literally", "kind", "sort",
  "thing", "things", "stuff", "way", "ways", "time", "times",
  "people", "person", "someone", "anyone", "everyone", "nobody",
  "something", "anything", "everything", "nothing", "somewhere",
  "anywhere", "everywhere", "nowhere",
]);

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z']+/g) ?? []).filter(
    (t) => t.length >= 3 && !STOPWORDS.has(t),
  );
}

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

  // ─── Step 1: build per-domain vocabulary ─── //
  // Each pack domain gets a Set of distinctive content tokens drawn
  // from its entries' anchor + hook + whatToShow text. Tokens that
  // appear in ≥ 3 different domains are treated as cross-domain
  // noise and dropped from every domain's vocabulary (prevents
  // generic words like "phone" from forcing every hook into one
  // domain just because they appear there).
  const domainTokenCounts = new Map<string, Map<string, number>>();
  const supplyByDomain = new Map<string, number>();
  for (const entry of NIGERIAN_HOOK_PACK) {
    const domain = (entry as { domain?: string }).domain ?? "<no-domain>";
    supplyByDomain.set(domain, (supplyByDomain.get(domain) ?? 0) + 1);
    const tokens = [
      ...tokenize(entry.anchor),
      ...tokenize(entry.hook),
      ...tokenize((entry as { whatToShow?: string }).whatToShow ?? ""),
    ];
    if (!domainTokenCounts.has(domain)) {
      domainTokenCounts.set(domain, new Map());
    }
    const dc = domainTokenCounts.get(domain)!;
    for (const t of tokens) dc.set(t, (dc.get(t) ?? 0) + 1);
  }

  // Compute cross-domain frequency: how many distinct domains each
  // token appears in. Tokens in ≥ 4 of 10 domains are dropped as
  // generic noise.
  const tokenDomainSpread = new Map<string, number>();
  for (const [, tokens] of domainTokenCounts) {
    for (const t of tokens.keys()) {
      tokenDomainSpread.set(t, (tokenDomainSpread.get(t) ?? 0) + 1);
    }
  }
  const NOISE_DOMAIN_SPREAD = 4;
  const noiseTokens = new Set<string>();
  for (const [t, spread] of tokenDomainSpread) {
    if (spread >= NOISE_DOMAIN_SPREAD) noiseTokens.add(t);
  }

  // Final per-domain vocabulary = tokens NOT in noiseTokens.
  const domainVocab = new Map<string, Set<string>>();
  for (const [domain, tokens] of domainTokenCounts) {
    const v = new Set<string>();
    for (const t of tokens.keys()) {
      if (!noiseTokens.has(t)) v.add(t);
    }
    domainVocab.set(domain, v);
  }

  // ─── Step 2: run sweep + classify non-pack rows ─── //
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

  const packRows = allRows.filter((r) => r.packEntryId !== undefined);
  const nonPackRows = allRows.filter((r) => r.packEntryId === undefined);

  // Classify each non-pack hook into the highest-overlap pack domain.
  // Ties broken by domain name alphabetic order (deterministic).
  type Classification = {
    row: Row;
    domain: string;
    matchCount: number;
    matches: string[];
  };
  const classifications: Classification[] = [];
  for (const r of nonPackRows) {
    const tokens = tokenize(r.hook);
    let bestDomain = "<unmatched>";
    let bestCount = 0;
    let bestMatches: string[] = [];
    const domainNames = [...domainVocab.keys()].sort();
    for (const domain of domainNames) {
      const vocab = domainVocab.get(domain)!;
      const matches = tokens.filter((t) => vocab.has(t));
      if (matches.length > bestCount) {
        bestCount = matches.length;
        bestDomain = domain;
        bestMatches = matches;
      }
    }
    classifications.push({
      row: r,
      domain: bestDomain,
      matchCount: bestCount,
      matches: bestMatches,
    });
  }

  // ─── Step 3: tally + compute gap ─── //
  const demandByDomain = new Map<string, number>();
  for (const c of classifications) {
    demandByDomain.set(c.domain, (demandByDomain.get(c.domain) ?? 0) + 1);
  }

  const totalSupply = NIGERIAN_HOOK_PACK.length;
  const totalDemand = nonPackRows.length;
  const allDomains = new Set<string>([
    ...supplyByDomain.keys(),
    ...demandByDomain.keys(),
  ]);
  type DomainRow = {
    domain: string;
    supply: number;
    supplyPct: number;
    demand: number;
    demandPct: number;
    gapPp: number;
  };
  const domainRows: DomainRow[] = [];
  for (const domain of allDomains) {
    const supply = supplyByDomain.get(domain) ?? 0;
    const demand = demandByDomain.get(domain) ?? 0;
    const supplyPct = totalSupply > 0 ? (supply / totalSupply) * 100 : 0;
    const demandPct = totalDemand > 0 ? (demand / totalDemand) * 100 : 0;
    domainRows.push({
      domain,
      supply,
      supplyPct,
      demand,
      demandPct,
      gapPp: demandPct - supplyPct,
    });
  }
  // Sort: under-served first (highest gap_pp). "<unmatched>" gets
  // its own callout below since it indicates "demand for a domain
  // that doesn't exist in the pack at all".
  domainRows.sort((a, b) => b.gapPp - a.gapPp);

  // ─── Render report ─── //
  const __filename = fileURLToPath(import.meta.url);
  const workspaceRoot = path.resolve(path.dirname(__filename), "../../../..");
  const outDir = path.join(workspaceRoot, ".local");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "N1_BATCH_D_TARGETS.md");

  const lines: string[] = [];
  lines.push("# N1 — BATCH D PACK-SUPPLY GAP ANALYSIS (v2)");
  lines.push("");
  lines.push(
    `_generated by_: \`artifacts/api-server/src/qa/analyzeNigerianBatchDTargets.ts\``,
  );
  lines.push(
    `_method_: 5-seed deterministic sweep × 2 NG-eligible cohorts; non-pack hooks classified into pack domains via token-overlap (stop-word filtered, generic cross-domain tokens dropped)`,
  );
  lines.push(
    `_pack_: ${totalSupply} entries across ${supplyByDomain.size} domains`,
  );
  lines.push(
    `_sample_: ${allRows.length} ideas total (${packRows.length} pack-filled = ${((packRows.length / allRows.length) * 100).toFixed(1)}%, ${nonPackRows.length} non-pack)`,
  );
  lines.push(
    `_vocabulary noise filter_: ${noiseTokens.size} tokens dropped (appeared in ≥ ${NOISE_DOMAIN_SPREAD} of ${domainVocab.size} domains)`,
  );
  lines.push("");
  lines.push("---");
  lines.push("");

  lines.push("## Domain-level supply vs demand");
  lines.push("");
  lines.push(
    "**Demand%** = share of non-pack hooks classified into this domain. **Supply%** = share of pack entries in this domain. **Gap (pp)** = demand% − supply%; positive = under-served (Batch D should add here).",
  );
  lines.push("");
  lines.push(
    "| domain | supply | supply % | demand | demand % | gap (pp) |",
  );
  lines.push(
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const r of domainRows) {
    const gapStr =
      r.gapPp >= 0
        ? `**+${r.gapPp.toFixed(1)}**`
        : `${r.gapPp.toFixed(1)}`;
    lines.push(
      `| \`${r.domain}\` | ${r.supply} | ${r.supplyPct.toFixed(1)}% | ${r.demand} | ${r.demandPct.toFixed(1)}% | ${gapStr} |`,
    );
  }
  lines.push("");

  // Under-served domains with concrete examples for BI.
  const underserved = domainRows.filter(
    (r) => r.gapPp > 0 && r.domain !== "<unmatched>",
  );
  lines.push("## Under-served domains — representative non-pack hooks");
  lines.push("");
  if (underserved.length === 0) {
    lines.push(
      "_No under-served pack domains found — every domain's pack supply already exceeds or matches its demand share._",
    );
  } else {
    lines.push(
      "Concrete hook examples the orchestrator generated in non-pack slots, grouped by the under-served domain they classified into. Each block shows up to 8 examples; the matched tokens that drove the classification are listed in `[brackets]`.",
    );
    lines.push("");
    for (const ur of underserved) {
      const examples = classifications
        .filter((c) => c.domain === ur.domain && c.matchCount > 0)
        .slice(0, 8);
      lines.push(
        `### \`${ur.domain}\` (gap +${ur.gapPp.toFixed(1)}pp; ${ur.demand} non-pack hooks vs ${ur.supply} pack entries)`,
      );
      lines.push("");
      for (const e of examples) {
        lines.push(
          `- ${JSON.stringify(e.row.hook)} _(cohort: ${e.row.cohort}, matched: [${e.matches.join(", ")}])_`,
        );
      }
      lines.push("");
    }
  }

  // Unmatched hooks = potential new domain opportunities.
  const unmatchedCount = demandByDomain.get("<unmatched>") ?? 0;
  if (unmatchedCount > 0) {
    lines.push("## Unmatched non-pack hooks (potential new domain)");
    lines.push("");
    lines.push(
      `${unmatchedCount} non-pack hook${unmatchedCount === 1 ? "" : "s"} matched zero pack-domain vocabulary — these don't fit any existing pack domain. They may indicate either (a) generic/low-anchor hooks the core generator produced, or (b) a coherent missing domain worth adding to the pack. Sample below for BI to skim:`,
    );
    lines.push("");
    const unmatchedExamples = classifications
      .filter((c) => c.domain === "<unmatched>")
      .slice(0, 12);
    for (const e of unmatchedExamples) {
      lines.push(
        `- ${JSON.stringify(e.row.hook)} _(cohort: ${e.row.cohort})_`,
      );
    }
    lines.push("");
  }

  // Recommendation block.
  lines.push("## Recommended Batch D shape");
  lines.push("");
  if (underserved.length === 0) {
    lines.push(
      "- Pack supply is already balanced against observed demand across every domain. The remaining ~50% non-pack share is structural (per-batch core pools surface concepts that legitimately don't fit the pack's curated catalog), not a domain-coverage problem.",
    );
    lines.push(
      "- If lifting fill above ~50% is required, consider Lever 2 from the prior conversation (cohort-gated core-pool widening) or expand into the `<unmatched>` space if it shows a coherent missing domain.",
    );
  } else {
    const topUnderserved = underserved.slice(0, 5);
    const cumulativeDemandPct = topUnderserved.reduce(
      (s, r) => s + r.demandPct,
      0,
    );
    lines.push(
      `- Target **the top ${topUnderserved.length} under-served domain${topUnderserved.length === 1 ? "" : "s"}** above (cumulative ${cumulativeDemandPct.toFixed(1)}% of non-pack demand).`,
    );
    lines.push(
      `- For each under-served domain, author drafts that match the representative hooks shown — those are exactly the kinds of cores the orchestrator surfaces when the pack can't fill them.`,
    );
    lines.push(
      `- Suggested draft count per domain: gap_pp × 0.6 ≈ drafts needed to close the gap (assumes ~16% historical reject rate from \`.local/N1_REJECTION_REPORT.md\`).`,
    );
    lines.push(
      `- Hand this list to the native-speaker reviewer (BI) for authoring + stamping. The agent must NOT author pack entries directly; only reviewer-stamped entries are eligible for ingest (see \`replit.md\` Architecture decisions § N1).`,
    );
  }
  lines.push("");

  fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
  console.error(
    `[analyzeNigerianBatchDTargets] wrote ${outPath} (${underserved.length} under-served domains; ${unmatchedCount} unmatched non-pack hooks; combined fill ${((packRows.length / allRows.length) * 100).toFixed(1)}%)`,
  );
}

main();
process.exit(0);
