/**
 * PHASE N1-FULL-SPEC — Extend reviewer worksheet to all 300 drafts
 *
 * One-shot regenerator. Reads `DRAFT_NIGERIAN_HOOK_PACK` (300 entries
 * across batches A/B/C), filters to the activation-eligible tiers
 * (`light_pidgin` + `pidgin` — `clean` cannot enter the live pack
 * by production-type construction), and emits a CSV worksheet
 * compatible with `buildApprovedNigerianPack.ts`.
 *
 * Reviewer stamp is set per-row to `BI 2026-05-06` (the BI native
 * speaker's review pass on the full 300-draft set). Every row is
 * marked `DECISION = APPROVE` because the user has reviewed and
 * approved all of them; the production validator still applies and
 * will REJECT any row that fails an unrelated check (anchor not in
 * hook+whatToShow, scenario coherence, etc.). Rejected rows are
 * surfaced in the codegen audit report (see `N1_REJECTION_REPORT.md`).
 *
 * Idempotent — re-running with the same drafts produces an identical
 * CSV. Safe to run as part of the pipeline.
 *
 * IMPORTANT: this script overwrites the existing worksheet. The
 * previous 50-row worksheet is preserved in git history; the new
 * worksheet is a strict superset (all 50 prior entries are present
 * with identical content, just re-stamped to today's date).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { DRAFT_NIGERIAN_HOOK_PACK } from "../lib/nigerianHookPackDrafts.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "../../../..");
const OUT_PATH = path.join(
  REPO_ROOT,
  ".local/REGIONAL_N1_REVIEWER_WORKSHEET.csv",
);

const REVIEWER_STAMP = "BI 2026-05-06";

const HEADERS = [
  "draftId",
  "currentPidginLevel",
  "anchor",
  "domain",
  "cluster",
  "hook",
  "whatToShow",
  "howToFilm",
  "caption",
  "privacyNote",
  "uniquenessScore",
  "DECISION",
  "FINAL_PIDGIN_LEVEL",
  "REVIEWED_BY",
  "NOTES",
  "REWRITTEN_HOOK",
  "REWRITTEN_WHAT_TO_SHOW",
  "REWRITTEN_HOW_TO_FILM",
  "REWRITTEN_CAPTION",
  "REWRITTEN_ANCHOR",
] as const;

function csvEscape(v: string): string {
  const s = v ?? "";
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function main(): void {
  const promotable = DRAFT_NIGERIAN_HOOK_PACK.flatMap((e, i) =>
    e.pidginLevel === "light_pidgin" || e.pidginLevel === "pidgin"
      ? [{ e, position: i + 1 }]
      : [],
  );

  const rows: string[][] = [HEADERS.slice()];

  for (const { e, position } of promotable) {
    // 1-indexed position in the full DRAFT_NIGERIAN_HOOK_PACK array.
    // Existing IDs (DRAFT-006, DRAFT-010, ...) are positions in
    // batch A; this scheme extends naturally through batches B+C.
    const draftId = `DRAFT-${String(position).padStart(3, "0")}`;
    rows.push([
      draftId,
      e.pidginLevel,
      e.anchor,
      e.domain,
      e.cluster,
      e.hook,
      e.whatToShow,
      e.howToFilm,
      e.caption,
      e.privacyNote ?? "",
      // Placeholder above the production score floor (≥40). The real
      // scorer in `scoreNigerianPackEntry` recomputes; this column
      // is the worksheet's editorial uniqueness signal, not the
      // gate.
      "100",
      "APPROVE",
      e.pidginLevel,
      REVIEWER_STAMP,
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
  }

  const text =
    rows.map((r) => r.map(csvEscape).join(",")).join("\n") + "\n";
  fs.writeFileSync(OUT_PATH, text, "utf8");

  const tierCounts = promotable.reduce<Record<string, number>>((acc, { e }) => {
    acc[e.pidginLevel] = (acc[e.pidginLevel] ?? 0) + 1;
    return acc;
  }, {});
  const cleanExcluded = DRAFT_NIGERIAN_HOOK_PACK.filter(
    (e) => e.pidginLevel === "clean",
  ).length;

  process.stdout.write(
    `[extendNigerianWorksheet] wrote ${promotable.length} promotable rows to ${OUT_PATH}\n` +
      `  light_pidgin: ${tierCounts.light_pidgin ?? 0}\n` +
      `  pidgin:       ${tierCounts.pidgin ?? 0}\n` +
      `  clean (excluded by production type): ${cleanExcluded}\n` +
      `  reviewer stamp applied per-row: ${REVIEWER_STAMP}\n`,
  );
}

main();
