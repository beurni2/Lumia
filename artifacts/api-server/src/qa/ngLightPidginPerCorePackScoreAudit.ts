/**
 * NG light_pidgin per-core pack score-gap audit (offline, read-only).
 *
 * Answers the user's 5 questions by replicating the per-core pack
 * scoring path WITHOUT touching production code:
 *   1. How many pack candidates survive per core before K=1 collapse?
 *   2. What are score gaps between rank #1 and rank #2?
 *   3. How often is #2 within 2-5 points of #1?
 *   4. Are #1 and #2 meaningfully different hooks/entryIds?
 *   5. Would K=2 create duplicate anchors/domains in the same batch?
 *
 * Mirrors the per-core pack pipeline in `coreCandidateGenerator.ts`
 * (pack eligibility filter → PACK_DOMAIN_MAP per-core filter →
 * `authorPackEntryAsIdea` → fp dedup → `scoreHookQuality`) but
 * captures the FULL `passing[]` PACK subset per core (not just the
 * K=1 winner). Uses a representative active-creator tasteCalibration
 * (light_pidgin, 4 situations) and the empty memory snapshot so the
 * gradient measured is the COLD per-core ranking signal.
 *
 * Run:
 *   LUMINA_NG_PACK_ENABLED=true \
 *   LUMINA_NG_PACK_PROJECTION_T2_ENABLED=true \
 *   pnpm --filter @workspace/api-server exec tsx \
 *     src/qa/ngLightPidginPerCorePackScoreAudit.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  NIGERIAN_HOOK_PACK,
  getEligibleNigerianPackEntries,
  type NigerianPackEntry,
} from "../lib/nigerianHookPack.js";
import { PREMISE_CORES, type PremiseCore } from "../lib/premiseCoreLibrary.js";
import { CORE_DOMAIN_ANCHORS } from "../lib/coreDomainAnchorCatalog.js";
import { authorPackEntryAsIdea } from "../lib/nigerianPackAuthor.js";
import { scoreHookQuality } from "../lib/hookQuality.js";
import { getVoiceCluster } from "../lib/voiceClusters.js";
// Inlined verbatim from coreCandidateGenerator.ts L1418-1437 — that
// helper is module-local. Two copies must stay in sync (P13-T2 BI
// 2026-05-12 set the everyday/home overlays).
const PROJECTION_T2_OVERLAY: Record<string, readonly string[]> = {
  everyday: ["home", "mornings", "sleep", "food"],
  home: ["home", "food"],
};
function projectPackDomain(sourceDomain: string): readonly string[] {
  if (process.env.LUMINA_NG_PACK_PROJECTION_T2_ENABLED === "true") {
    const overlay = PROJECTION_T2_OVERLAY[sourceDomain];
    if (overlay !== undefined) return overlay;
  }
  return [PACK_DOMAIN_MAP[sourceDomain] ?? "phone"];
}

// ---------- output dir ------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT_DIR = path.resolve(__dirname, "..", "..", "..", "..", ".local");
fs.mkdirSync(OUT_DIR, { recursive: true });

// ---------- replicate the production filter ---------------------------
// (mirrors coreCandidateGenerator.ts L1369-1380 + L1464-1474)
const PACK_DOMAIN_MAP: Record<string, string> = {
  messaging: "phone",
  movement: "fitness",
  transport: "fitness",
  family: "social",
  creator: "content",
  everyday: "home",
  home: "home",
  money: "money",
  phone: "phone",
  work: "work",
};

const PROJECTION_T2_ENABLED =
  process.env.LUMINA_NG_PACK_PROJECTION_T2_ENABLED === "true";

function matchesViaProjection(
  e: NigerianPackEntry,
  coreDomains: Set<string>,
): boolean {
  if (PROJECTION_T2_ENABLED) {
    const projections = projectPackDomain(e.domain);
    for (const projected of projections) {
      if (coreDomains.has(projected)) return true;
    }
    return false;
  }
  const target = PACK_DOMAIN_MAP[e.domain] ?? "phone";
  return coreDomains.has(target);
}

// ---------- audit ----------------------------------------------------
type PerCandidateRecord = {
  rank: number;
  entryId: string;
  hook: string;
  anchor: string;
  domain: string;
  score: number;
  gapToBest: number;
};

type PerCoreReport = {
  coreId: string;
  family: string;
  coreDomains: string[];
  packEligible: number;
  matchingAfterFilter: number;
  authoredOk: number;
  survivedFpDedup: number;
  passingPack: number;
  topCandidates: PerCandidateRecord[];
  rank1Anchor: string | null;
  rank2Anchor: string | null;
  rank1Domain: string | null;
  rank2Domain: string | null;
};

// Minimal voice cluster — pack author requires one but doesn't read
// fields used for scoring. Picking a stable cluster keeps numbers
// reproducible across runs.
const VOICE = getVoiceCluster("dry_deadpan");
const SALT = 0; // cold seed; we want pre-rotation gradient
const EMPTY_FP_SET: ReadonlySet<string> = new Set();

function auditCore(
  core: PremiseCore,
  packEligible: readonly NigerianPackEntry[],
): PerCoreReport {
  const rows = CORE_DOMAIN_ANCHORS[core.id];
  if (!rows || rows.length === 0) {
    return {
      coreId: core.id,
      family: core.family,
      coreDomains: [],
      packEligible: packEligible.length,
      matchingAfterFilter: 0,
      authoredOk: 0,
      survivedFpDedup: 0,
      passingPack: 0,
      topCandidates: [],
      rank1Anchor: null,
      rank2Anchor: null,
      rank1Domain: null,
      rank2Domain: null,
    };
  }

  const coreDomains = new Set<string>(rows.map((r) => r.domain));
  const matching = packEligible.filter((e) =>
    matchesViaProjection(e, coreDomains),
  );

  let authoredOk = 0;
  let survivedFpDedup = 0;
  const usedFp = new Set<string>();
  const passing: Array<{
    entryId: string;
    hook: string;
    anchor: string;
    domain: string;
    score: number;
  }> = [];

  for (const entry of matching) {
    const r = authorPackEntryAsIdea({
      entry,
      core,
      voice: VOICE,
      regenerateSalt: SALT,
      seedFingerprints: EMPTY_FP_SET,
    });
    if (!r.ok) continue;
    authoredOk += 1;
    const sf = r.scenarioFingerprint;
    if (sf && usedFp.has(sf)) continue;
    if (sf) usedFp.add(sf);
    survivedFpDedup += 1;
    const score = scoreHookQuality(r.idea.hook, core.family);
    const entryId = (r.meta as { nigerianPackEntryId?: string })
      .nigerianPackEntryId;
    if (!entryId) continue;
    passing.push({
      entryId,
      hook: entry.hook,
      anchor: entry.anchor,
      domain: entry.domain,
      score,
    });
  }

  const sorted = passing.slice().sort((a, b) => b.score - a.score);
  const bestScore = sorted[0]?.score ?? 0;
  const top = sorted.slice(0, 5).map(
    (c, i): PerCandidateRecord => ({
      rank: i + 1,
      entryId: c.entryId,
      hook: c.hook,
      anchor: c.anchor,
      domain: c.domain,
      score: c.score,
      gapToBest: bestScore - c.score,
    }),
  );

  return {
    coreId: core.id,
    family: core.family,
    coreDomains: [...coreDomains].sort(),
    packEligible: packEligible.length,
    matchingAfterFilter: matching.length,
    authoredOk,
    survivedFpDedup,
    passingPack: passing.length,
    topCandidates: top,
    rank1Anchor: sorted[0]?.anchor.toLowerCase() ?? null,
    rank2Anchor: sorted[1]?.anchor.toLowerCase() ?? null,
    rank1Domain: sorted[0]?.domain ?? null,
    rank2Domain: sorted[1]?.domain ?? null,
  };
}

// ---------- main -----------------------------------------------------
function main(): void {
  const packEligible = getEligibleNigerianPackEntries(
    {
      region: "nigeria",
      languageStyle: "light_pidgin",
      flagEnabled: true,
    },
    NIGERIAN_HOOK_PACK,
  );
  console.log(
    `[audit] light_pidgin eligible pack entries: ${packEligible.length} / ${NIGERIAN_HOOK_PACK.length}`,
  );
  console.log(
    `[audit] LUMINA_NG_PACK_PROJECTION_T2_ENABLED=${PROJECTION_T2_ENABLED}`,
  );
  console.log(`[audit] PREMISE_CORES count: ${PREMISE_CORES.length}`);

  const reports = PREMISE_CORES.map((c) => auditCore(c, packEligible));

  // ---------- aggregate stats ---------------------------------------
  const coresWithPack = reports.filter((r) => r.passingPack > 0);
  const coresWithRank2 = reports.filter((r) => r.passingPack >= 2);
  const passingCounts = coresWithPack.map((r) => r.passingPack);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const avg = (xs: number[]) =>
    xs.length === 0 ? 0 : sum(xs) / xs.length;
  const median = (xs: number[]) => {
    if (xs.length === 0) return 0;
    const s = xs.slice().sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[m - 1]! + s[m]!) / 2 : s[m]!;
  };

  // Score gaps rank#1 vs rank#2 (only on cores with ≥2 candidates)
  const gaps12 = coresWithRank2.map((r) => r.topCandidates[1]!.gapToBest);
  const within2 = gaps12.filter((g) => g <= 2).length;
  const within5 = gaps12.filter((g) => g <= 5).length;
  const within2to5 = gaps12.filter((g) => g >= 2 && g <= 5).length;
  const exactTie = gaps12.filter((g) => g === 0).length;

  // #1 vs #2 distinctness on cores with ≥2 candidates
  const distinctEntryId = coresWithRank2.filter(
    (r) =>
      r.topCandidates[0]!.entryId !== r.topCandidates[1]!.entryId,
  ).length;
  const distinctHook = coresWithRank2.filter(
    (r) =>
      r.topCandidates[0]!.hook.toLowerCase().trim() !==
      r.topCandidates[1]!.hook.toLowerCase().trim(),
  ).length;

  // K=2 anchor / domain duplication risk (in-batch perspective).
  // For each core, compare rank#1 anchor/domain vs rank#2's. We
  // measure two things:
  //   (a) intra-core: how often rank#1 and rank#2 share the SAME
  //       anchor/domain on the same core (would be a "wasted" K=2
  //       slot since slot reservation already de-dups by entryId).
  //   (b) cross-core: how often rank#2 of core X has the same anchor
  //       as rank#1 of core Y (X ≠ Y) — this is what the user is
  //       really asking about ("duplicate anchors in the same batch").
  const intraCoreSameAnchor = coresWithRank2.filter(
    (r) => r.rank1Anchor === r.rank2Anchor,
  ).length;
  const intraCoreSameDomain = coresWithRank2.filter(
    (r) => r.rank1Domain === r.rank2Domain,
  ).length;

  // Cross-core: build a set of all rank#1 anchors/domains across
  // cores that have any pack passing, then count how many cores'
  // rank#2 anchor/domain collides with SOME OTHER core's rank#1.
  const rank1AnchorByCore = new Map<string, string | null>();
  const rank1DomainByCore = new Map<string, string | null>();
  for (const r of coresWithPack) {
    rank1AnchorByCore.set(r.coreId, r.rank1Anchor);
    rank1DomainByCore.set(r.coreId, r.rank1Domain);
  }
  let crossCoreSameAnchorAsAnotherRank1 = 0;
  let crossCoreSameDomainAsAnotherRank1 = 0;
  for (const r of coresWithRank2) {
    for (const [otherCoreId, otherAnchor] of rank1AnchorByCore) {
      if (otherCoreId === r.coreId) continue;
      if (otherAnchor !== null && otherAnchor === r.rank2Anchor) {
        crossCoreSameAnchorAsAnotherRank1 += 1;
        break;
      }
    }
    for (const [otherCoreId, otherDomain] of rank1DomainByCore) {
      if (otherCoreId === r.coreId) continue;
      if (otherDomain !== null && otherDomain === r.rank2Domain) {
        crossCoreSameDomainAsAnotherRank1 += 1;
        break;
      }
    }
  }

  // ---------- write report ------------------------------------------
  const reportPath = path.join(
    OUT_DIR,
    "NG_LIGHT_PIDGIN_PER_CORE_PACK_SCORE_AUDIT.md",
  );
  const lines: string[] = [];
  lines.push("# NG light_pidgin per-core pack score-gap audit");
  lines.push("");
  lines.push(`**Date:** ${new Date().toISOString().slice(0, 10)}`);
  lines.push(
    `**Eligible pack entries (light_pidgin):** ${packEligible.length} / ${NIGERIAN_HOOK_PACK.length}`,
  );
  lines.push(
    `**LUMINA_NG_PACK_PROJECTION_T2_ENABLED:** ${PROJECTION_T2_ENABLED}`,
  );
  lines.push(`**PREMISE_CORES audited:** ${PREMISE_CORES.length}`);
  lines.push(`**Salt:** 0 (cold seed; pre-rotation gradient)`);
  lines.push(
    `**Memory snapshots:** empty (cold creator; no recentNigerianPackEntryIds)`,
  );
  lines.push("");

  // ---------- TL;DR --------------------------------------------------
  lines.push("## TL;DR");
  lines.push("");
  lines.push(
    `- **K=11 retention is ALREADY enabled in production** ` +
      `(\`NIGERIAN_PACK_AWARE_RETENTION_TOP_K = 11\`, BI 2026-05-13, ` +
      `\`coreCandidateGenerator.ts:2059-2061\`). Per-core retention ` +
      `widens up to 11 distinct pack candidates (1 best + 10 runners-up). ` +
      `**The user's K=2 question is moot — we're already at K=11.**`,
  );
  lines.push(
    `- **${coresWithPack.length} / ${PREMISE_CORES.length}** cores have ≥1 pack candidate after PACK_DOMAIN_MAP filtering.`,
  );
  lines.push(
    `- **${coresWithRank2.length} / ${PREMISE_CORES.length}** cores have ≥2 pack candidates (i.e. K=2+ would actually retain a runner-up).`,
  );
  lines.push(
    `- Per-core passing pack count: avg=${avg(passingCounts).toFixed(1)}, median=${median(passingCounts)}, min=${Math.min(...passingCounts, 0)}, max=${Math.max(...passingCounts, 0)}.`,
  );
  if (gaps12.length > 0) {
    lines.push(
      `- **Score gap rank#1 vs rank#2:** avg=${avg(gaps12).toFixed(2)}, median=${median(gaps12)}, exact ties=${exactTie}/${gaps12.length}, ≤2pt=${within2}/${gaps12.length} (${((within2 / gaps12.length) * 100).toFixed(0)}%), ≤5pt=${within5}/${gaps12.length} (${((within5 / gaps12.length) * 100).toFixed(0)}%), in [2,5]=${within2to5}/${gaps12.length}.`,
    );
    lines.push(
      `- **#1 vs #2 distinct entryId:** ${distinctEntryId}/${coresWithRank2.length} (100% structurally — pack entries are atomic).`,
    );
    lines.push(
      `- **#1 vs #2 distinct hook text:** ${distinctHook}/${coresWithRank2.length}.`,
    );
    lines.push(
      `- **Intra-core anchor collision (#1 anchor === #2 anchor):** ${intraCoreSameAnchor}/${coresWithRank2.length}.`,
    );
    lines.push(
      `- **Intra-core domain collision (#1 domain === #2 domain):** ${intraCoreSameDomain}/${coresWithRank2.length} — by construction high (same core; same PACK_DOMAIN_MAP target).`,
    );
    lines.push(
      `- **Cross-core: core-X rank#2 anchor matches some core-Y rank#1 anchor:** ${crossCoreSameAnchorAsAnotherRank1}/${coresWithRank2.length}.`,
    );
    lines.push(
      `- **Cross-core: core-X rank#2 domain matches some core-Y rank#1 domain:** ${crossCoreSameDomainAsAnotherRank1}/${coresWithRank2.length}.`,
    );
  }
  lines.push("");

  // ---------- per-question answers -----------------------------------
  lines.push("## Answers to the audit questions");
  lines.push("");
  lines.push(
    "### Q1 — How many pack candidates survive per core before K=1 collapse?",
  );
  lines.push("");
  lines.push("| stat | value |");
  lines.push("|---|---|");
  lines.push(`| cores with ≥1 pack candidate | ${coresWithPack.length} / ${PREMISE_CORES.length} |`);
  lines.push(`| cores with ≥2 pack candidates | ${coresWithRank2.length} / ${PREMISE_CORES.length} |`);
  lines.push(`| avg passing per core (cores with ≥1) | ${avg(passingCounts).toFixed(1)} |`);
  lines.push(`| median passing per core | ${median(passingCounts)} |`);
  lines.push(`| max passing on a single core | ${Math.max(...passingCounts, 0)} |`);
  lines.push("");

  lines.push("### Q2 — Score gaps rank#1 vs rank#2");
  lines.push("");
  if (gaps12.length === 0) {
    lines.push("_No cores have ≥2 pack candidates — gap N/A._");
  } else {
    lines.push("| stat | value |");
    lines.push("|---|---|");
    lines.push(`| avg gap | ${avg(gaps12).toFixed(2)} |`);
    lines.push(`| median gap | ${median(gaps12)} |`);
    lines.push(`| min gap | ${Math.min(...gaps12)} |`);
    lines.push(`| max gap | ${Math.max(...gaps12)} |`);
    lines.push(`| exact ties (gap = 0) | ${exactTie} / ${gaps12.length} (${((exactTie / gaps12.length) * 100).toFixed(0)}%) |`);
  }
  lines.push("");

  lines.push("### Q3 — How often is #2 within 2-5 points of #1?");
  lines.push("");
  if (gaps12.length === 0) {
    lines.push("_No cores have ≥2 pack candidates — N/A._");
  } else {
    lines.push("| range | count | % of cores with ≥2 |");
    lines.push("|---|---|---|");
    lines.push(`| gap = 0 (exact tie) | ${exactTie} | ${((exactTie / gaps12.length) * 100).toFixed(0)}% |`);
    lines.push(`| gap ≤ 2 | ${within2} | ${((within2 / gaps12.length) * 100).toFixed(0)}% |`);
    lines.push(`| gap in [2, 5] | ${within2to5} | ${((within2to5 / gaps12.length) * 100).toFixed(0)}% |`);
    lines.push(`| gap ≤ 5 | ${within5} | ${((within5 / gaps12.length) * 100).toFixed(0)}% |`);
  }
  lines.push("");

  lines.push("### Q4 — Are #1 and #2 meaningfully different hooks/entryIds?");
  lines.push("");
  if (coresWithRank2.length === 0) {
    lines.push("_No cores have ≥2 pack candidates — N/A._");
  } else {
    lines.push(`- distinct entryId: **${distinctEntryId} / ${coresWithRank2.length}** (pack entries are atomic; collision impossible by construction).`);
    lines.push(`- distinct hook text: **${distinctHook} / ${coresWithRank2.length}**.`);
  }
  lines.push("");

  lines.push("### Q5 — Would K=2 create duplicate anchors/domains in the same batch?");
  lines.push("");
  lines.push(
    "Note: K=2 means *per-core retention* of 2 candidates, NOT 2 cards in the final batch. The downstream `applyNigerianPackSlotReservation` deduplicates on `nigerianPackEntryId` and on normalized hook text before composing the final batch (see `replit.md` BI 2026-05-13 retention block). So the question reduces to: would adding a second pack candidate per core *increase the variety pool* or just feed the slot reservation more anchor/domain duplicates?",
  );
  lines.push("");
  if (coresWithRank2.length > 0) {
    lines.push("| collision type | count | % |");
    lines.push("|---|---|---|");
    lines.push(`| intra-core (same core: #1 anchor === #2 anchor) | ${intraCoreSameAnchor} | ${((intraCoreSameAnchor / coresWithRank2.length) * 100).toFixed(0)}% |`);
    lines.push(`| intra-core (same core: #1 domain === #2 domain) | ${intraCoreSameDomain} | ${((intraCoreSameDomain / coresWithRank2.length) * 100).toFixed(0)}% |`);
    lines.push(`| cross-core (core X #2 anchor === some core Y #1 anchor) | ${crossCoreSameAnchorAsAnotherRank1} | ${((crossCoreSameAnchorAsAnotherRank1 / coresWithRank2.length) * 100).toFixed(0)}% |`);
    lines.push(`| cross-core (core X #2 domain === some core Y #1 domain) | ${crossCoreSameDomainAsAnotherRank1} | ${((crossCoreSameDomainAsAnotherRank1 / coresWithRank2.length) * 100).toFixed(0)}% |`);
  }
  lines.push("");
  lines.push(
    "Domain collision is structurally near-100% because core membership is itself a domain-affinity filter (a 'phone' core only retains 'phone'/'messaging' pack entries, etc.). This is benign — slot reservation does not enforce domain diversity at the pack stage.",
  );
  lines.push("");

  // ---------- per-core appendix --------------------------------------
  lines.push("## Per-core appendix (top 5 pack candidates)");
  lines.push("");
  for (const r of reports) {
    lines.push(`### ${r.coreId} (${r.family})`);
    lines.push("");
    lines.push(
      `domains=[${r.coreDomains.join(", ")}] | matchingAfterFilter=${r.matchingAfterFilter} | authoredOk=${r.authoredOk} | passingPack=${r.passingPack}`,
    );
    if (r.topCandidates.length === 0) {
      lines.push("");
      lines.push("_no pack candidates for this core_");
      lines.push("");
      continue;
    }
    lines.push("");
    lines.push("| rank | score | gap | entryId | anchor | domain | hook |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const c of r.topCandidates) {
      const safeHook = c.hook.replace(/\|/g, "\\|").slice(0, 70);
      lines.push(
        `| ${c.rank} | ${c.score} | ${c.gapToBest} | \`${c.entryId}\` | ${c.anchor} | ${c.domain} | ${safeHook} |`,
      );
    }
    lines.push("");
  }

  fs.writeFileSync(reportPath, lines.join("\n"));
  console.log(`[audit] wrote ${reportPath}`);

  // also dump JSON for downstream tooling
  const jsonPath = reportPath.replace(/\.md$/, ".json");
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        eligiblePackEntries: packEligible.length,
        totalPack: NIGERIAN_HOOK_PACK.length,
        projectionT2Enabled: PROJECTION_T2_ENABLED,
        cores: PREMISE_CORES.length,
        coresWithPack: coresWithPack.length,
        coresWithRank2: coresWithRank2.length,
        passingPerCore: { avg: avg(passingCounts), median: median(passingCounts), min: Math.min(...passingCounts, 0), max: Math.max(...passingCounts, 0) },
        gap12: gaps12.length === 0 ? null : { avg: avg(gaps12), median: median(gaps12), min: Math.min(...gaps12), max: Math.max(...gaps12), exactTies: exactTie, within2, within2to5, within5 },
        distinct: { entryId: distinctEntryId, hook: distinctHook },
        collisions: { intraCoreSameAnchor, intraCoreSameDomain, crossCoreSameAnchorAsAnotherRank1, crossCoreSameDomainAsAnotherRank1 },
        reports,
      },
      null,
      2,
    ),
  );
  console.log(`[audit] wrote ${jsonPath}`);
}

main();
