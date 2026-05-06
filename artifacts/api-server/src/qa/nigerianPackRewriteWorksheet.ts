/**
 * REGIONAL N1 — Rewrite Worksheet (rejected rows from the first
 * approved-candidates ingest pass).
 *
 * READ-ONLY EXPORT. This script does NOT:
 *   • mutate `DRAFT_NIGERIAN_HOOK_PACK`
 *   • mutate `APPROVED_NIGERIAN_PROMOTION_CANDIDATES`
 *   • touch `NIGERIAN_HOOK_PACK` (live pool stays empty / DARK)
 *   • flip `LUMINA_NG_PACK_ENABLED`
 *   • lower `scoreHookQuality` floors or add family-aware exemptions
 *   • weaken any validator or anchor check
 *
 * Re-runs the exact same per-row validation as
 * `buildApprovedNigerianPack.ts` and emits ONLY the failing rows to
 * a reviewer-friendly worksheet at:
 *
 *   .local/REGIONAL_N1_REWRITE_WORKSHEET.md
 *   .local/REGIONAL_N1_REWRITE_WORKSHEET.csv
 *
 * Each row carries the full original context + the precise failure
 * reasons + the scoreHookQuality value + blank columns for the
 * reviewer's rewrite (`rewrittenHook` required; the rest optional).
 * The next ingest pass will run the rewrites back through the
 * existing production gates — no validator changes required.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PACK_FIELD_BOUNDS,
  PIDGIN_MOCKING_PATTERNS,
} from "../lib/nigerianHookPack.js";
import { validateScenarioCoherence } from "../lib/scenarioCoherence.js";
import { scoreHookQuality } from "../lib/hookQuality.js";

const REVIEWED_BY = "BI 2026-05-05";
const HOOK_QUALITY_FLOOR = 40;
const DEFAULT_FAMILY = "adulting_chaos" as const;

// ─── Worksheet CSV parser (same as builder) ──────────────────────
const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        row.push(cell);
        cell = "";
      } else if (c === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else if (c === "\r") {
        // skip
      } else {
        cell += c;
      }
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].length > 0));
};

type WorksheetRow = {
  draftId: string;
  currentPidginLevel: string;
  anchor: string;
  domain: string;
  cluster: string;
  hook: string;
  whatToShow: string;
  howToFilm: string;
  caption: string;
  privacyNote: string;
  reviewerNotes: string;
};

const readWorksheet = (csvPath: string): WorksheetRow[] => {
  const text = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsv(text);
  const header = rows[0];
  const idx = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`worksheet missing column: ${name}`);
    return i;
  };
  const cols = {
    draftId: idx("draftId"),
    currentPidginLevel: idx("currentPidginLevel"),
    anchor: idx("anchor"),
    domain: idx("domain"),
    cluster: idx("cluster"),
    hook: idx("hook"),
    whatToShow: idx("whatToShow"),
    howToFilm: idx("howToFilm"),
    caption: idx("caption"),
    privacyNote: idx("privacyNote"),
    notes: header.indexOf("NOTES"),
  };
  return rows.slice(1).map((r) => ({
    draftId: r[cols.draftId],
    currentPidginLevel: r[cols.currentPidginLevel],
    anchor: r[cols.anchor],
    domain: r[cols.domain],
    cluster: r[cols.cluster],
    hook: r[cols.hook],
    whatToShow: r[cols.whatToShow],
    howToFilm: r[cols.howToFilm],
    caption: r[cols.caption],
    privacyNote: r[cols.privacyNote] ?? "",
    reviewerNotes: cols.notes >= 0 ? r[cols.notes] ?? "" : "",
  }));
};

// ─── Validation (mirrors buildApprovedNigerianPack) ──────────────
type RejectedRow = {
  row: WorksheetRow;
  reasons: string[];
  hookScore: number;
};

const validateRow = (row: WorksheetRow): RejectedRow | null => {
  const reasons: string[] = [];

  if (!REVIEWED_BY || REVIEWED_BY.trim().length === 0) {
    reasons.push("reviewedBy is empty");
  }
  if (REVIEWED_BY.trim() === "PENDING_NATIVE_REVIEW") {
    reasons.push("reviewedBy is the PENDING_NATIVE_REVIEW sentinel");
  }
  if (
    row.currentPidginLevel !== "light_pidgin" &&
    row.currentPidginLevel !== "pidgin"
  ) {
    reasons.push(
      `pidginLevel '${row.currentPidginLevel}' not allowed (must be light_pidgin or pidgin)`,
    );
  }
  const b = PACK_FIELD_BOUNDS;
  if (row.hook.length === 0 || row.hook.length > b.hookMax) {
    reasons.push(`hook length ${row.hook.length} out of bounds [1, ${b.hookMax}]`);
  }
  if (row.whatToShow.length < b.whatToShowMin || row.whatToShow.length > b.whatToShowMax) {
    reasons.push(
      `whatToShow length ${row.whatToShow.length} out of bounds [${b.whatToShowMin}, ${b.whatToShowMax}]`,
    );
  }
  if (row.howToFilm.length < b.howToFilmMin || row.howToFilm.length > b.howToFilmMax) {
    reasons.push(
      `howToFilm length ${row.howToFilm.length} out of bounds [${b.howToFilmMin}, ${b.howToFilmMax}]`,
    );
  }
  if (row.caption.length < b.captionMin || row.caption.length > b.captionMax) {
    reasons.push(
      `caption length ${row.caption.length} out of bounds [${b.captionMin}, ${b.captionMax}]`,
    );
  }
  const a = row.anchor.toLowerCase();
  if (!a || /\s/.test(a)) reasons.push(`anchor '${row.anchor}' must be a single token`);
  if (a && !row.hook.toLowerCase().includes(a)) reasons.push(`anchor '${a}' not in hook`);
  if (a && !row.whatToShow.toLowerCase().includes(a)) {
    reasons.push(`anchor '${a}' not in whatToShow`);
  }
  for (const re of PIDGIN_MOCKING_PATTERNS) {
    if (re.test(row.hook)) reasons.push(`hook matches mocking pattern ${re}`);
    if (re.test(row.whatToShow)) reasons.push(`whatToShow matches mocking pattern ${re}`);
    if (re.test(row.caption)) reasons.push(`caption matches mocking pattern ${re}`);
  }
  const coherenceFail = validateScenarioCoherence({
    hook: row.hook,
    whatToShow: row.whatToShow,
    howToFilm: row.howToFilm,
    caption: row.caption,
  } as Parameters<typeof validateScenarioCoherence>[0]);
  if (coherenceFail !== null) reasons.push(`validateScenarioCoherence: ${coherenceFail}`);
  const hookScore = scoreHookQuality(row.hook, DEFAULT_FAMILY);
  if (hookScore < HOOK_QUALITY_FLOOR) {
    reasons.push(`scoreHookQuality ${hookScore} < floor ${HOOK_QUALITY_FLOOR}`);
  }
  if (!row.domain || row.domain.trim().length === 0) reasons.push("domain is empty");

  if (reasons.length === 0) return null;
  return { row, reasons, hookScore };
};

// ─── CSV emit ────────────────────────────────────────────────────
const csvEscape = (v: string): string => {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
};

const buildCsv = (rejected: RejectedRow[]): string => {
  const header = [
    "draftId",
    "pidginLevel",
    "anchor",
    "domain",
    "cluster",
    "hook",
    "whatToShow",
    "howToFilm",
    "caption",
    "scoreHookQuality",
    "failureReason",
    "reviewerNotes",
    // Reviewer-editable columns (blank — reviewer fills in)
    "rewrittenHook",            // REQUIRED — must lift score >= 40 + preserve anchor
    "rewrittenWhatToShow",      // optional — leave blank to keep original
    "rewrittenHowToFilm",       // optional — leave blank to keep original
    "rewrittenCaption",         // optional — leave blank to keep original
    "rewriteNotes",             // optional — what changed and why
  ];
  const lines: string[] = [header.join(",")];
  for (const r of rejected) {
    lines.push(
      [
        r.row.draftId,
        r.row.currentPidginLevel,
        r.row.anchor,
        r.row.domain,
        r.row.cluster,
        r.row.hook,
        r.row.whatToShow,
        r.row.howToFilm,
        r.row.caption,
        String(r.hookScore),
        r.reasons.join(" | "),
        r.row.reviewerNotes,
        "", "", "", "", "",
      ].map(csvEscape).join(","),
    );
  }
  return lines.join("\n") + "\n";
};

// ─── Markdown emit ───────────────────────────────────────────────
const buildMarkdown = (rejected: RejectedRow[]): string => {
  const lines: string[] = [];
  lines.push("# REGIONAL N1 — Rewrite Worksheet");
  lines.push("");
  lines.push(
    "> **Read-only export.** Pack remains DARK. `DRAFT_NIGERIAN_HOOK_PACK` and",
  );
  lines.push(
    "> `APPROVED_NIGERIAN_PROMOTION_CANDIDATES` are unchanged. This worksheet only",
  );
  lines.push(
    "> collects the rows the first ingest pass rejected so they can be rewritten",
  );
  lines.push("> and re-submitted through the SAME production gates.");
  lines.push("");
  lines.push(
    `Source: \`.local/REGIONAL_N1_REVIEWER_WORKSHEET.csv\` · ${rejected.length} rejected rows`,
  );
  lines.push("");
  lines.push("## Why these rows failed");
  lines.push("");
  const reasonCounts = new Map<string, number>();
  for (const r of rejected) {
    for (const reason of r.reasons) {
      const key = reason.replace(/\d+/g, "N"); // group "score 35" with "score 22"
      reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
    }
  }
  lines.push("| failure reason (numbers normalised) | rows |");
  lines.push("| --- | --- |");
  for (const [reason, count] of [...reasonCounts.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    lines.push(`| ${reason} | ${count} |`);
  }
  lines.push("");
  lines.push("## Rewrite guidance (reviewer brief)");
  lines.push("");
  lines.push("Goal: lift each hook above the production `scoreHookQuality >= 40` floor **without** weakening any validator. The same gates run on the rewrite — no exemptions.");
  lines.push("");
  lines.push("- Make hooks **shorter and punchier**. Long conversational lines lose visceral score.");
  lines.push("- Add **clear contradiction or tension** — the unexpected beat that makes the hook funny.");
  lines.push("- Keep the **Nigerian voice** but avoid **forced slang**.");
  lines.push("- **Preserve the anchor** verbatim in the rewritten hook (anchor must still appear in hook AND whatToShow).");
  lines.push("- Preserve the **scenario pairing** — the rewrite must still describe the same beat as the original `whatToShow`.");
  lines.push("- Avoid generic conversational openings unless the line carries strong tension.");
  lines.push("- Avoid overusing **\"why is,\" \"the way,\" \"omo,\" \"I said.\"**");
  lines.push("- **light_pidgin** hooks: mostly English with one natural Nigerian / Pidgin phrase.");
  lines.push("- **pidgin** hooks: natural register, never cartoonish vowel-stretching (`PIDGIN_MOCKING_PATTERNS` is re-checked).");
  lines.push("");
  lines.push("## Per-row required fields");
  lines.push("");
  lines.push("- `rewrittenHook` — REQUIRED. Must (a) keep the anchor, (b) lift `scoreHookQuality >= 40`, (c) stay within length bounds (≤ 120 chars), (d) avoid mocking-spelling regex.");
  lines.push("- `rewrittenWhatToShow` / `rewrittenHowToFilm` / `rewrittenCaption` — OPTIONAL. Leave blank to keep the original; fill in only if your hook rewrite needs scene support.");
  lines.push("- `rewriteNotes` — OPTIONAL. What you changed and why (helps the next reviewer).");
  lines.push("");
  lines.push("Once you return the filled worksheet, the next ingest pass will run every rewritten row through the existing production validators (length bounds · anchor in hook AND whatToShow · `PIDGIN_MOCKING_PATTERNS` · `validateScenarioCoherence` · `scoreHookQuality >= 40`) and emit a fresh `APPROVED_NIGERIAN_PROMOTION_CANDIDATES`. Failures are again surfaced — never silently fixed.");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Rejected rows");
  lines.push("");
  rejected.forEach((r, i) => {
    const e = r.row;
    lines.push(`### ${i + 1}. ${e.draftId} — anchor: \`${e.anchor}\` · tier: \`${e.currentPidginLevel}\` · domain: \`${e.domain}\` · cluster: \`${e.cluster}\``);
    lines.push("");
    lines.push(`- **scoreHookQuality:** ${r.hookScore} (floor ${HOOK_QUALITY_FLOOR})`);
    lines.push(`- **failureReason:** ${r.reasons.join("; ")}`);
    if (e.privacyNote) lines.push(`- **privacyNote:** ${e.privacyNote}`);
    if (e.reviewerNotes) lines.push(`- **reviewerNotes:** ${e.reviewerNotes}`);
    lines.push("");
    lines.push("**Original (read-only):**");
    lines.push("");
    lines.push(`- **hook:** ${e.hook}`);
    lines.push(`- **whatToShow:** ${e.whatToShow}`);
    lines.push(`- **howToFilm:** ${e.howToFilm}`);
    lines.push(`- **caption:** ${e.caption}`);
    lines.push("");
    lines.push("**Rewrite (fill in):**");
    lines.push("");
    lines.push("```yaml");
    lines.push(`draftId: ${e.draftId}`);
    lines.push("rewrittenHook:               # REQUIRED — keep anchor, lift score >= 40, <= 120 chars");
    lines.push("rewrittenWhatToShow:         # optional — blank keeps original");
    lines.push("rewrittenHowToFilm:          # optional — blank keeps original");
    lines.push("rewrittenCaption:            # optional — blank keeps original");
    lines.push("rewriteNotes:                # optional — what changed and why");
    lines.push("```");
    lines.push("");
    lines.push("---");
    lines.push("");
  });
  return lines.join("\n");
};

// ─── Main ────────────────────────────────────────────────────────
const main = (): void => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, "../../../..");
  const csvPath = path.resolve(
    repoRoot,
    ".local/REGIONAL_N1_REVIEWER_WORKSHEET.csv",
  );
  const outDir = path.resolve(repoRoot, ".local");
  const mdPath = path.join(outDir, "REGIONAL_N1_REWRITE_WORKSHEET.md");
  const csvOut = path.join(outDir, "REGIONAL_N1_REWRITE_WORKSHEET.csv");

  const rows = readWorksheet(csvPath);
  const rejected: RejectedRow[] = [];
  for (const row of rows) {
    const r = validateRow(row);
    if (r !== null) rejected.push(r);
  }
  // Sort: highest score first (closest to passing → easiest rewrite).
  rejected.sort((a, b) => b.hookScore - a.hookScore || a.row.draftId.localeCompare(b.row.draftId));

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(mdPath, buildMarkdown(rejected), "utf8");
  fs.writeFileSync(csvOut, buildCsv(rejected), "utf8");

  const tierCount: Record<string, number> = {};
  for (const r of rejected) {
    tierCount[r.row.currentPidginLevel] =
      (tierCount[r.row.currentPidginLevel] ?? 0) + 1;
  }
  process.stdout.write(
    `[nigerianPackRewriteWorksheet] worksheet rows scanned: ${rows.length}\n` +
      `  rejected (rewrite candidates): ${rejected.length}\n` +
      `  tier breakdown: ${Object.entries(tierCount).map(([k, v]) => `${k}=${v}`).join(" ")}\n` +
      `  md: ${mdPath}\n` +
      `  csv: ${csvOut}\n` +
      `  DRAFT_NIGERIAN_HOOK_PACK: unchanged\n` +
      `  APPROVED_NIGERIAN_PROMOTION_CANDIDATES: unchanged\n` +
      `  NIGERIAN_HOOK_PACK: still empty (DARK)\n` +
      `  LUMINA_NG_PACK_ENABLED: still default-off\n` +
      `  no validators / anchor checks / hookQuality floor changed\n`,
  );
};

main();
