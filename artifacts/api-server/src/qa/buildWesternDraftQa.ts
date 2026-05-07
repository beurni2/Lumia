/**
 * PHASE W2-A — QA report generator for the Western draft hook pack.
 *
 * Reads the (currently empty) `WESTERN_HOOK_PACK_DRAFT` corpus, runs
 * the integrity checker, and writes a markdown report at
 * `.local/W2_WESTERN_DRAFT_QA.md` (project root .local). Pure I/O —
 * no runtime behavior change, no production wiring.
 *
 * Run:
 *   pnpm --filter @workspace/api-server exec tsx src/qa/buildWesternDraftQa.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  WESTERN_COMEDY_FAMILIES,
  WESTERN_EMOTIONAL_SPIKES,
  WESTERN_HOOK_PACK_DRAFT,
  WESTERN_SETTINGS,
  checkWesternHookPackDraftIntegrity,
  type WesternHookPackDraftEntry,
} from "../lib/westernHookPack.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPORT_PATH = path.resolve(
  __dirname,
  "../../../../.local/W2_WESTERN_DRAFT_QA.md",
);

function bucketCounts<T extends string>(
  entries: readonly WesternHookPackDraftEntry[],
  field: keyof WesternHookPackDraftEntry,
  vocabulary: readonly T[],
): string {
  if (entries.length === 0) return "(corpus empty — no buckets to report)";
  const counts = new Map<string, number>();
  for (const v of vocabulary) counts.set(v, 0);
  for (const e of entries) {
    const k = String(e[field] ?? "");
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `- ${k}: ${n}`)
    .join("\n");
}

function build(): string {
  const report = checkWesternHookPackDraftIntegrity(WESTERN_HOOK_PACK_DRAFT);
  const lines: string[] = [];
  lines.push("# W2-A — Western draft hook pack · QA report");
  lines.push("");
  lines.push(
    `_Generated: ${new Date().toISOString()} · driver: \`artifacts/api-server/src/qa/buildWesternDraftQa.ts\`_`,
  );
  lines.push("");
  lines.push("## Corpus state");
  lines.push("");
  lines.push(`- **Total entries**: ${WESTERN_HOOK_PACK_DRAFT.length}`);
  lines.push(`- **Integrity check**: ${report.ok ? "OK" : "FAILED"}`);
  lines.push(
    `- **Activation status**: DARK — corpus is not wired into any runtime path. No slot reservation, no scoring change, no API surface.`,
  );
  lines.push("");
  lines.push("## Category counts");
  lines.push("");
  lines.push("### comedyFamily");
  lines.push(
    bucketCounts(WESTERN_HOOK_PACK_DRAFT, "comedyFamily", WESTERN_COMEDY_FAMILIES),
  );
  lines.push("");
  lines.push("### emotionalSpike");
  lines.push(
    bucketCounts(
      WESTERN_HOOK_PACK_DRAFT,
      "emotionalSpike",
      WESTERN_EMOTIONAL_SPIKES,
    ),
  );
  lines.push("");
  lines.push("### setting");
  lines.push(bucketCounts(WESTERN_HOOK_PACK_DRAFT, "setting", WESTERN_SETTINGS));
  lines.push("");
  lines.push("## Duplicate report");
  if (report.duplicateHookFingerprints.length === 0) {
    lines.push("- (none)");
  } else {
    for (const fp of report.duplicateHookFingerprints) lines.push(`- ${fp}`);
  }
  lines.push("");
  lines.push("## Weak banned-skeleton report");
  if (report.weakSkeletonHits.size === 0) {
    lines.push("- (none)");
  } else {
    for (const [k, n] of report.weakSkeletonHits) lines.push(`- ${k}: ${n}`);
  }
  lines.push("");
  lines.push("## Length failures");
  if (report.lengthFailures.length === 0) {
    lines.push("- (none)");
  } else {
    for (const f of report.lengthFailures)
      lines.push(`- [${f.index}] ${f.id ?? "?"} · ${f.code}: ${f.detail}`);
  }
  lines.push("");
  lines.push("## Privacy / safety failures");
  if (report.privacyFailures.length === 0) {
    lines.push("- (none)");
  } else {
    for (const f of report.privacyFailures)
      lines.push(`- [${f.index}] ${f.id ?? "?"} · ${f.code}: ${f.detail}`);
  }
  lines.push("");
  lines.push("## All failures (full)");
  if (report.failures.length === 0) {
    lines.push("- (none)");
  } else {
    for (const f of report.failures)
      lines.push(`- [${f.index}] ${f.id ?? "?"} · ${f.code}: ${f.detail}`);
  }
  lines.push("");
  lines.push("## Sample entries");
  if (WESTERN_HOOK_PACK_DRAFT.length === 0) {
    lines.push("- (corpus is empty — sample table will populate when entries are authored)");
  } else {
    for (const e of WESTERN_HOOK_PACK_DRAFT.slice(0, 5)) {
      lines.push(`### ${e.id}`);
      lines.push(`- hook: ${e.hook}`);
      lines.push(`- whatToShow: ${e.whatToShow}`);
      lines.push(`- howToFilm: ${e.howToFilm}`);
      lines.push(`- caption: ${e.caption}`);
      lines.push(
        `- anchor: ${e.anchor} · comedyFamily: ${e.comedyFamily} · emotionalSpike: ${e.emotionalSpike} · setting: ${e.setting}`,
      );
      lines.push(`- reviewedBy: ${e.reviewedBy}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

function main(): void {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  const md = build();
  fs.writeFileSync(REPORT_PATH, md);
  process.stdout.write(`[w2a] report written: ${REPORT_PATH}\n`);
}

main();
