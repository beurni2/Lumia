/**
 * PHASE N1 — Nigerian Comedy Pack QA HARNESS SKELETON
 *
 * Inert until BOTH:
 *   (a) `NIGERIAN_HOOK_PACK` is non-empty (reviewed entries shipped)
 *   (b) `LUMINA_NG_PACK_ENABLED=true`
 *
 * In its current dark state the harness verifies the activation
 * matrix, prints the gate truth table, and writes a markdown report
 * to `.local/REGIONAL_N1_QA.md`. No live ideas are generated, no
 * Claude calls, no DB writes — running this file is safe at any
 * time and will simply confirm "infrastructure ready, pack empty,
 * no live QA possible yet".
 *
 * When the pack ships:
 *   • this harness gains a `runLiveSweep()` that calls hybridIdeator
 *     with `count=20` per (region × tier) cell, mirroring
 *     `regionalLiveBetaQa.ts`.
 *   • the byte-identity check (western / india / philippines /
 *     nigeria-clean / undefined) is the gate before any beta flip:
 *     those rows MUST equal the pre-N1 baseline.
 *   • cross-tier leak check: a `light_pidgin` request must not return
 *     a `pidgin`-tier hook.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server tsx src/qa/nigerianPackQa.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { Region } from "@workspace/lumina-trends";

import {
  NIGERIAN_HOOK_PACK,
  canActivateNigerianPack,
  isNigerianPackFeatureEnabled,
} from "../lib/nigerianHookPack.js";
import {
  DRAFT_NIGERIAN_HOOK_PACK,
  isPotentiallyActivatable,
  type DraftNigerianPackEntry,
} from "../lib/nigerianHookPackDrafts.js";
import type { LanguageStyle } from "../lib/tasteCalibration.js";

const OUTPUT_PATH = resolve(
  process.cwd(),
  "../../.local/REGIONAL_N1_QA.md",
);

const REGIONS: readonly (Region | "undefined")[] = [
  "western",
  "india",
  "philippines",
  "nigeria",
  "undefined",
];
const STYLES: readonly (LanguageStyle | "null")[] = [
  "null",
  "clean",
  "light_pidgin",
  "pidgin",
];

function styleArg(s: LanguageStyle | "null"): LanguageStyle | null {
  return s === "null" ? null : s;
}
function regionArg(r: Region | "undefined"): Region | undefined {
  return r === "undefined" ? undefined : r;
}

type Row = {
  region: Region | "undefined";
  languageStyle: LanguageStyle | "null";
  flagEnabled: boolean;
  packLength: number;
  activates: boolean;
};

function sweep(): Row[] {
  const flagEnabled = isNigerianPackFeatureEnabled();
  const packLength = NIGERIAN_HOOK_PACK.length;
  const rows: Row[] = [];
  for (const r of REGIONS) {
    for (const s of STYLES) {
      const activates = canActivateNigerianPack({
        region: regionArg(r),
        languageStyle: styleArg(s),
        flagEnabled,
        packLength,
      });
      rows.push({
        region: r,
        languageStyle: s,
        flagEnabled,
        packLength,
        activates,
      });
    }
  }
  return rows;
}

function md(rows: Row[]): string {
  const flagOn = isNigerianPackFeatureEnabled();
  const len = NIGERIAN_HOOK_PACK.length;
  const lines: string[] = [];
  lines.push("# N1 — Nigerian Comedy Pack QA");
  lines.push("");
  lines.push(`- generated: ${new Date().toISOString()}`);
  lines.push(`- LUMINA_NG_PACK_ENABLED: ${flagOn ? "true" : "false (off)"}`);
  lines.push(`- NIGERIAN_HOOK_PACK length: ${len}`);
  lines.push("");
  if (len === 0 || !flagOn) {
    lines.push(
      "**STATUS: DARK** — the pack is inert. " +
        (len === 0 ? "Pool is empty (no reviewed entries). " : "") +
        (!flagOn
          ? "Server-side flag is OFF. "
          : "") +
        "Live sweep is not runnable; this report verifies the activation gate matrix only.",
    );
    lines.push("");
  } else {
    lines.push(
      "**STATUS: ARMED** — pool non-empty AND flag on. The activation " +
        "gate matrix below shows which (region, languageStyle) cells " +
        "would draw from the pack. Run the live sweep before any beta " +
        "rollout (TODO — implement once entries land).",
    );
    lines.push("");
  }

  lines.push("## Activation gate matrix");
  lines.push("");
  lines.push(
    "| region | languageStyle | flag | packLength | activates? |",
  );
  lines.push("|---|---|---|---|---|");
  for (const r of rows) {
    lines.push(
      `| ${r.region} | ${r.languageStyle} | ${r.flagEnabled ? "on" : "off"} | ${r.packLength} | ${r.activates ? "YES" : "no"} |`,
    );
  }
  lines.push("");

  const positives = rows.filter((r) => r.activates);
  lines.push("## Cross-region leak check");
  lines.push("");
  if (positives.length === 0) {
    lines.push(
      "✓ No (region, languageStyle) cell activates. Pack is dark.",
    );
  } else {
    const wrongRegion = positives.filter((r) => r.region !== "nigeria");
    const wrongStyle = positives.filter(
      (r) =>
        r.languageStyle !== "light_pidgin" && r.languageStyle !== "pidgin",
    );
    lines.push(
      `Activating cells: ${positives.length} ` +
        `(expect ≤ 2: nigeria/light_pidgin and nigeria/pidgin).`,
    );
    lines.push(
      `- Non-nigeria activations: ${wrongRegion.length} ` +
        `${wrongRegion.length === 0 ? "✓" : "✗ LEAK"}`,
    );
    lines.push(
      `- Clean/null activations: ${wrongStyle.length} ` +
        `${wrongStyle.length === 0 ? "✓" : "✗ LEAK"}`,
    );
  }
  lines.push("");
  lines.push("## Draft Batch A inventory");
  lines.push("");
  lines.push(`- DRAFT_NIGERIAN_HOOK_PACK length: ${DRAFT_NIGERIAN_HOOK_PACK.length}`);
  const tiers = { clean: 0, light_pidgin: 0, pidgin: 0 } as Record<
    DraftNigerianPackEntry["pidginLevel"],
    number
  >;
  let activatable = 0;
  const clusters = new Map<string, number>();
  const domains = new Map<string, number>();
  for (const e of DRAFT_NIGERIAN_HOOK_PACK) {
    tiers[e.pidginLevel]++;
    if (isPotentiallyActivatable(e)) activatable++;
    clusters.set(e.cluster, (clusters.get(e.cluster) ?? 0) + 1);
    domains.set(e.domain, (domains.get(e.domain) ?? 0) + 1);
  }
  lines.push(
    `- Tiers: clean=${tiers.clean} | light_pidgin=${tiers.light_pidgin} | pidgin=${tiers.pidgin}`,
  );
  lines.push(
    `- Activation-eligible after promotion (light_pidgin + pidgin): ${activatable}`,
  );
  lines.push(`- Domains: ${[...domains.entries()].map(([d, n]) => `${d}=${n}`).join(", ")}`);
  lines.push(`- Clusters (${clusters.size}): ${[...clusters.keys()].join(", ")}`);
  lines.push("");
  lines.push("## Next steps before activation");
  lines.push("");
  lines.push(
    "1. Native Nigerian speaker provides reviewed entries with ALL 8 " +
      "atomic fields (hook, whatToShow, howToFilm, caption, anchor, " +
      "domain, pidginLevel, reviewedBy).",
  );
  lines.push(
    "2. Module-load `assertNigerianPackIntegrity` must pass on the " +
      "populated pool (boot crashes the server on any malformed entry).",
  );
  lines.push(
    "3. Wire the integration site in `coreCandidateGenerator.ts` " +
      "(see TODO at top of `lib/nigerianHookPack.ts`).",
  );
  lines.push(
    "4. Live sweep: 20 ideas/region × 3 tiers (clean / light_pidgin / " +
      "pidgin), reviewed by native speaker; western / india / " +
      "philippines / nigeria-clean / undefined rows MUST be byte-" +
      "identical to the pre-N1 baseline before the flag flips.",
  );
  return lines.join("\n");
}

function main(): void {
  const rows = sweep();
  const out = md(rows);
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, out, "utf8");
  console.log(out);
  console.log("");
  console.log(`[nigerianPackQa] wrote ${OUTPUT_PATH}`);
}

const invokedDirectly =
  // tsx / node both populate import.meta.url; running via `tsx <file>`
  // matches argv[1]'s resolved path.
  process.argv[1] && process.argv[1].endsWith("nigerianPackQa.ts");
if (invokedDirectly) main();

export { sweep, md };
