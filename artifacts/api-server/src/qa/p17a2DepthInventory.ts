/**
 * P17-A2 — NG light_pidgin pack-pool depth inventory.
 *
 * Pure inspection. Imports the live in-process pack + projection
 * tables and counts:
 *
 *  1. Total Nigerian pack entries (by source module + by pidginLevel).
 *  2. light_pidgin-eligible entries (the slice the demo cohort sees).
 *  3. Source-domain distribution of the eligible slice.
 *  4. Anchor distribution of the eligible slice.
 *  5. Per-core matching count using the SAME projection tables as the
 *     runtime: legacy PACK_DOMAIN_MAP and the PROJECTION_T2 overlay.
 *  6. Union (across all 40 cores) of entries that project to ≥1
 *     active core domain — i.e. the maximum theoretically addressable
 *     pre-score / pre-memory pool for ANY single light_pidgin batch.
 *  7. Stranded entries (eligible but project to zero core domains).
 *
 * Writes:
 *   .local/P17_A2_DEPTH_INVENTORY.json
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { NIGERIAN_HOOK_PACK } from "../lib/nigerianHookPack.js";
import { APPROVED_NIGERIAN_PROMOTION_CANDIDATES } from "../lib/nigerianHookPackApproved.js";
import { FOOD_V2_NIGERIAN_PROMOTION_CANDIDATES } from "../lib/nigerianHookPackFoodV2.js";
import { SLEEP_V1_NIGERIAN_PROMOTION_CANDIDATES } from "../lib/nigerianHookPackSleepV1.js";
import { CORE_DOMAIN_ANCHORS } from "../lib/coreDomainAnchorCatalog.js";
import { PREMISE_CORES } from "../lib/premiseCoreLibrary.js";

// djb2, mirrored from nigerianPackAuthor.ts:567 derivation
//   `ng_${djb2(\`${hook}|${anchor}\`).toString(16)}`
// Mirrored byte-for-byte from artifacts/api-server/src/lib/nigerianPackAuthor.ts
// (djb2-add variant). MUST match exactly so derived `ng_*` ids equal runtime.
function djb2(s: string): number {
  let h = 5381 | 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}
const entryIdOf = (e: { hook: string; anchor: string }) =>
  `ng_${djb2(`${e.hook}|${e.anchor}`).toString(16)}`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  ".local",
  "P17_A2_DEPTH_INVENTORY.json",
);

// Mirror the runtime projection table verbatim. Kept in lockstep
// with `coreCandidateGenerator.ts` L1369-1421. If those drift, this
// inventory becomes stale; cross-checked at runtime via a single
// active-pool number printed below the JSON dump.
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
const PROJECTION_T2_OVERLAY: Record<string, readonly string[]> = {
  everyday: ["home", "mornings", "sleep", "food"],
  home: ["home", "food"],
};
const projectPackDomain = (sourceDomain: string): readonly string[] => {
  if (PROJECTION_T2_ENABLED) {
    const o = PROJECTION_T2_OVERLAY[sourceDomain];
    if (o) return o;
  }
  return [PACK_DOMAIN_MAP[sourceDomain] ?? "phone"];
};

function tally<T>(arr: ReadonlyArray<T>, key: (t: T) => string): Record<string, number> {
  const r: Record<string, number> = {};
  for (const x of arr) {
    const k = key(x);
    r[k] = (r[k] ?? 0) + 1;
  }
  return r;
}

function main() {
  const total = NIGERIAN_HOOK_PACK.length;
  const bySource = {
    APPROVED: APPROVED_NIGERIAN_PROMOTION_CANDIDATES.length,
    FOOD_V2: FOOD_V2_NIGERIAN_PROMOTION_CANDIDATES.length,
    SLEEP_V1: SLEEP_V1_NIGERIAN_PROMOTION_CANDIDATES.length,
  };
  const byPidginLevel = tally(NIGERIAN_HOOK_PACK, (e) => e.pidginLevel);

  // light_pidgin eligibility: when calibration languageStyle ===
  // "light_pidgin", the runtime keeps ONLY entries with pidginLevel
  // === "light_pidgin" (heavy pidgin filtered out). Mirror that.
  const lightEligible = NIGERIAN_HOOK_PACK.filter(
    (e) => e.pidginLevel === "light_pidgin",
  );

  const lightDomainDist = tally(lightEligible, (e) => e.domain);
  const lightAnchorDist = tally(lightEligible, (e) => e.anchor.toLowerCase());

  // Per-core projection counts (using PROJECTION_T2 if flag-on, else
  // legacy single-bucket projection).
  const perCore: Array<{
    coreId: string;
    family: string;
    coreDomains: string[];
    matchingLightEntries: number;
    legacyMatching: number;
    t2OnlyMatching: number;
    sampleDomainsHit: Record<string, number>;
  }> = [];

  const projectedAddressable = new Set<string>();
  for (const core of PREMISE_CORES) {
    const rows = CORE_DOMAIN_ANCHORS[core.id] ?? [];
    const coreDomains = new Set(rows.map((r) => r.domain));
    let legacyN = 0;
    let projectedN = 0;
    const hitDomains: Record<string, number> = {};
    for (const e of lightEligible) {
      const legacyTarget = PACK_DOMAIN_MAP[e.domain] ?? "phone";
      const cd = coreDomains as ReadonlySet<string>;
      const legacyHit = cd.has(legacyTarget);
      const projections = projectPackDomain(e.domain);
      let projectedHit = false;
      for (const p of projections) {
        if (cd.has(p)) {
          projectedHit = true;
          hitDomains[p] = (hitDomains[p] ?? 0) + 1;
        }
      }
      if (legacyHit) legacyN++;
      if (projectedHit) {
        projectedN++;
        projectedAddressable.add(entryIdOf(e));
      }
    }
    perCore.push({
      coreId: core.id,
      family: core.family,
      coreDomains: [...coreDomains],
      matchingLightEntries: projectedN,
      legacyMatching: legacyN,
      t2OnlyMatching: projectedN - legacyN,
      sampleDomainsHit: hitDomains,
    });
  }

  // Stranded eligible entries: light_pidgin but no core in the live
  // catalog has a row whose domain matches any of this entry's
  // projection targets.
  const stranded: Array<{ id: string; sourceDomain: string; projections: readonly string[] }> = [];
  for (const e of lightEligible) {
    const projections = projectPackDomain(e.domain);
    let anyHit = false;
    for (const core of PREMISE_CORES) {
      const rows = CORE_DOMAIN_ANCHORS[core.id] ?? [];
      const coreDomains = new Set(rows.map((r) => r.domain as string));
      for (const p of projections) {
        if (coreDomains.has(p)) {
          anyHit = true;
          break;
        }
      }
      if (anyHit) break;
    }
    if (!anyHit) {
      stranded.push({ id: entryIdOf(e), sourceDomain: e.domain, projections });
    }
  }

  const out = {
    flagState: {
      LUMINA_NG_PACK_ENABLED: process.env.LUMINA_NG_PACK_ENABLED === "true",
      LUMINA_NG_PACK_PROJECTION_T2_ENABLED: PROJECTION_T2_ENABLED,
    },
    totalPackEntries: total,
    bySourceModule: bySource,
    byPidginLevel,
    lightEligibleCount: lightEligible.length,
    lightDomainDistribution: lightDomainDist,
    lightAnchorDistribution: lightAnchorDist,
    coreCount: PREMISE_CORES.length,
    perCoreMatching: perCore.sort(
      (a, b) => b.matchingLightEntries - a.matchingLightEntries,
    ),
    sumPerCoreMatching: perCore.reduce(
      (s, c) => s + c.matchingLightEntries,
      0,
    ),
    addressableUnionAcrossAllCores: projectedAddressable.size,
    addressableUnionShareOfEligible:
      lightEligible.length === 0
        ? 0
        : projectedAddressable.size / lightEligible.length,
    strandedEligibleCount: stranded.length,
    strandedSample: stranded.slice(0, 30),
    strandedSourceDomains: tally(stranded, (s) => s.sourceDomain),
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`[p17a2-inv] wrote ${OUT}`);
  console.log(
    `[p17a2-inv] total=${total} light_eligible=${lightEligible.length} addressable_union=${projectedAddressable.size} (${Math.round((projectedAddressable.size / lightEligible.length) * 1000) / 10}%) stranded=${stranded.length}`,
  );
  console.log(
    `[p17a2-inv] flags: NG_PACK_ENABLED=${out.flagState.LUMINA_NG_PACK_ENABLED} T2=${out.flagState.LUMINA_NG_PACK_PROJECTION_T2_ENABLED}`,
  );
  console.log(
    `[p17a2-inv] light_pidgin domain distribution:`,
    JSON.stringify(lightDomainDist, undefined, 0),
  );
}

main();
