/**
 * REGIONAL N1 — Build APPROVED_NIGERIAN_PROMOTION_CANDIDATES from the
 * native-reviewer worksheet CSV.
 *
 * READ-WRITE on a SINGLE generated file:
 *   artifacts/api-server/src/lib/nigerianHookPackApproved.ts
 *
 * READ-ONLY everywhere else. This script does NOT:
 *   • mutate `DRAFT_NIGERIAN_HOOK_PACK`
 *   • touch `NIGERIAN_HOOK_PACK` (the live pool stays empty / DARK)
 *   • flip `LUMINA_NG_PACK_ENABLED`
 *   • wire `coreCandidateGenerator.ts`
 *   • weaken validators or relax anchor checks
 *
 * For every row in the worksheet CSV the script:
 *   1. Reads the original draft fields (no rewrites — reviewer
 *      decision was "approve all 50 as-is").
 *   2. Stamps `reviewedBy = "BI 2026-05-05"` (the reviewer's stamp
 *      provided in the ingest request — the agent did NOT author
 *      this string; it came from the user message).
 *   3. Re-validates the candidate against EVERY production rule:
 *        - reviewedBy non-empty AND not the PENDING_NATIVE_REVIEW sentinel
 *        - pidginLevel ∈ {"light_pidgin","pidgin"}
 *        - hook / whatToShow / howToFilm / caption length bounds
 *          (PACK_FIELD_BOUNDS — same as `ideaSchema`)
 *        - anchor (lowercase) appears in BOTH hook and whatToShow
 *        - no PIDGIN_MOCKING_PATTERNS hit on hook/whatToShow/caption
 *        - validateScenarioCoherence(idea) === null
 *        - scoreHookQuality(hook, family) >= HOOK_QUALITY_FLOOR (40 —
 *          mirrors the recipe loop's quality floor in hookQuality.ts)
 *   4. PASS → append to the approved list.
 *   5. FAIL → append to the rejected list with the precise reason.
 *      No silent fixes. No fallback.
 *
 * After ingest the script emits `nigerianHookPackApproved.ts` with:
 *   • `APPROVED_NIGERIAN_PROMOTION_CANDIDATES: readonly NigerianPackEntry[]`
 *     (frozen, only entries that passed all checks)
 *   • a leading doc-comment listing every rejected row + reason
 *   • a module-load `assertNigerianPackIntegrity(...)` call as
 *     defense-in-depth (re-runs the boot rules on the static array)
 *
 * The approved file is INERT until a separate explicit promotion
 * step copies entries into `NIGERIAN_HOOK_PACK` AND
 * `LUMINA_NG_PACK_ENABLED=true` is set. Cross-region leak is
 * impossible by construction (the central guard still requires
 * region === "nigeria" + non-clean languageStyle).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PACK_FIELD_BOUNDS,
  PIDGIN_MOCKING_PATTERNS,
  assertNigerianPackIntegrity,
  type NigerianPackEntry,
} from "../lib/nigerianHookPack.js";
import { validateScenarioCoherence } from "../lib/scenarioCoherence.js";
import { scoreHookQuality } from "../lib/hookQuality.js";

const REVIEWED_BY = "BI 2026-05-05";
const HOOK_QUALITY_FLOOR = 40;
// Hook quality scoring is family-agnostic in the current implementation
// (the `_family` parameter is unused — see `scoreHookQuality` JSDoc).
// We pick a sensible default rather than guessing per-row.
const DEFAULT_FAMILY = "adulting_chaos" as const;

// ─── Worksheet CSV parser (RFC-4180 minimal) ─────────────────────
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
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
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
  }));
};

// ─── Per-row validation ───────────────────────────────────────────
type ValidationResult =
  | { ok: true; entry: NigerianPackEntry }
  | { ok: false; reasons: string[] };

const validateRow = (row: WorksheetRow): ValidationResult => {
  const reasons: string[] = [];

  // 1. reviewedBy
  const reviewedBy = REVIEWED_BY;
  if (!reviewedBy || reviewedBy.trim().length === 0) {
    reasons.push("reviewedBy is empty");
  }
  if (reviewedBy.trim() === "PENDING_NATIVE_REVIEW") {
    reasons.push("reviewedBy is the PENDING_NATIVE_REVIEW sentinel");
  }

  // 2. pidginLevel
  if (
    row.currentPidginLevel !== "light_pidgin" &&
    row.currentPidginLevel !== "pidgin"
  ) {
    reasons.push(
      `pidginLevel '${row.currentPidginLevel}' is not allowed in the live pack ` +
        `(must be light_pidgin or pidgin)`,
    );
  }

  // 3. Length bounds — mirror PACK_FIELD_BOUNDS exactly.
  const b = PACK_FIELD_BOUNDS;
  if (row.hook.length === 0 || row.hook.length > b.hookMax) {
    reasons.push(
      `hook length ${row.hook.length} out of bounds [1, ${b.hookMax}]`,
    );
  }
  if (
    row.whatToShow.length < b.whatToShowMin ||
    row.whatToShow.length > b.whatToShowMax
  ) {
    reasons.push(
      `whatToShow length ${row.whatToShow.length} out of bounds ` +
        `[${b.whatToShowMin}, ${b.whatToShowMax}]`,
    );
  }
  if (
    row.howToFilm.length < b.howToFilmMin ||
    row.howToFilm.length > b.howToFilmMax
  ) {
    reasons.push(
      `howToFilm length ${row.howToFilm.length} out of bounds ` +
        `[${b.howToFilmMin}, ${b.howToFilmMax}]`,
    );
  }
  if (
    row.caption.length < b.captionMin ||
    row.caption.length > b.captionMax
  ) {
    reasons.push(
      `caption length ${row.caption.length} out of bounds ` +
        `[${b.captionMin}, ${b.captionMax}]`,
    );
  }

  // 4. Anchor in hook AND whatToShow (lowercased substring).
  const a = row.anchor.toLowerCase();
  if (!a || /\s/.test(a)) {
    reasons.push(`anchor '${row.anchor}' must be a non-empty single token`);
  }
  if (a && !row.hook.toLowerCase().includes(a)) {
    reasons.push(`anchor '${a}' not found in hook`);
  }
  if (a && !row.whatToShow.toLowerCase().includes(a)) {
    reasons.push(`anchor '${a}' not found in whatToShow`);
  }

  // 5. Mocking-spelling patterns (hook + whatToShow + caption).
  for (const re of PIDGIN_MOCKING_PATTERNS) {
    if (re.test(row.hook)) reasons.push(`hook matches mocking pattern ${re}`);
    if (re.test(row.whatToShow)) {
      reasons.push(`whatToShow matches mocking pattern ${re}`);
    }
    if (re.test(row.caption)) {
      reasons.push(`caption matches mocking pattern ${re}`);
    }
  }

  // 6. validateScenarioCoherence — construct a minimal Idea shape.
  const ideaForCoherence = {
    hook: row.hook,
    whatToShow: row.whatToShow,
    howToFilm: row.howToFilm,
    caption: row.caption,
  };
  const coherenceFail = validateScenarioCoherence(
    ideaForCoherence as Parameters<typeof validateScenarioCoherence>[0],
  );
  if (coherenceFail !== null) {
    reasons.push(`validateScenarioCoherence: ${coherenceFail}`);
  }

  // 7. scoreHookQuality floor (recipe loop's published floor = 40).
  const hookScore = scoreHookQuality(row.hook, DEFAULT_FAMILY);
  if (hookScore < HOOK_QUALITY_FLOOR) {
    reasons.push(
      `scoreHookQuality ${hookScore} < floor ${HOOK_QUALITY_FLOOR}`,
    );
  }

  // 8. domain non-empty (boot assert requires it).
  if (!row.domain || row.domain.trim().length === 0) {
    reasons.push("domain is empty");
  }

  if (reasons.length > 0) return { ok: false, reasons };

  // pidginLevel is narrowed by the check above; cast is safe.
  const entry: NigerianPackEntry = Object.freeze({
    hook: row.hook,
    whatToShow: row.whatToShow,
    howToFilm: row.howToFilm,
    caption: row.caption,
    anchor: a,
    domain: row.domain,
    pidginLevel: row.currentPidginLevel as "light_pidgin" | "pidgin",
    reviewedBy,
  });
  return { ok: true, entry };
};

// ─── Code emission ────────────────────────────────────────────────
const tsEscape = (s: string): string =>
  // Use JSON.stringify for safe TS string-literal escaping (handles
  // quotes, backslashes, newlines, unicode). The leading/trailing
  // double-quotes JSON adds are exactly what we want for a TS string.
  JSON.stringify(s);

const emitApprovedFile = (
  approved: ReadonlyArray<{ row: WorksheetRow; entry: NigerianPackEntry }>,
  rejected: ReadonlyArray<{ row: WorksheetRow; reasons: readonly string[] }>,
): string => {
  const lines: string[] = [];
  lines.push("/**");
  lines.push(" * REGIONAL N1 — APPROVED Nigerian promotion candidates.");
  lines.push(" *");
  lines.push(" * AUTO-GENERATED by `qa/buildApprovedNigerianPack.ts`. Do NOT edit by hand.");
  lines.push(" * Re-run the generator to refresh after a new reviewer pass.");
  lines.push(" *");
  lines.push(" * STATUS: INERT. This array is NOT `NIGERIAN_HOOK_PACK`. The live pool");
  lines.push(" * remains empty (DARK). A separate, explicit promotion step is required");
  lines.push(" * to copy entries into the live pack, AND `LUMINA_NG_PACK_ENABLED=true`");
  lines.push(" * must be set, before `canActivateNigerianPack` can return true.");
  lines.push(" *");
  lines.push(" * Cross-region leak remains impossible by construction: the central");
  lines.push(" * activation guard still requires region === \"nigeria\" + non-clean");
  lines.push(" * languageStyle even after promotion.");
  lines.push(" *");
  lines.push(" * Every entry below was re-validated against EVERY production rule:");
  lines.push(" *   • reviewedBy non-empty AND not PENDING_NATIVE_REVIEW");
  lines.push(" *   • pidginLevel ∈ {light_pidgin, pidgin}");
  lines.push(" *   • hook/whatToShow/howToFilm/caption length bounds (PACK_FIELD_BOUNDS)");
  lines.push(" *   • anchor (lowercase) present in BOTH hook AND whatToShow");
  lines.push(" *   • no PIDGIN_MOCKING_PATTERNS hit on hook/whatToShow/caption");
  lines.push(" *   • validateScenarioCoherence(idea) === null");
  lines.push(` *   • scoreHookQuality(hook) >= ${HOOK_QUALITY_FLOOR}`);
  lines.push(" *");
  lines.push(` * INGEST SUMMARY: ${approved.length} approved · ${rejected.length} rejected`);
  if (rejected.length > 0) {
    lines.push(" *");
    lines.push(" * REJECTED ROWS (kept here for the reviewer audit trail; NOT in the");
    lines.push(" * exported array — the generator does not silently fix anything):");
    for (const r of rejected) {
      lines.push(` *   • ${r.row.draftId} → ${r.reasons.join("; ")}`);
    }
  }
  lines.push(" */");
  lines.push("");
  lines.push("import {");
  lines.push("  assertNigerianPackIntegrity,");
  lines.push("  type NigerianPackEntry,");
  lines.push("} from \"./nigerianHookPack.js\";");
  lines.push("");
  lines.push(
    "export const APPROVED_NIGERIAN_PROMOTION_CANDIDATES: readonly NigerianPackEntry[] =",
  );
  lines.push("  Object.freeze([");
  for (const { row, entry } of approved) {
    lines.push("    Object.freeze({");
    lines.push(`      // source: ${row.draftId} · cluster: ${row.cluster}` +
      (row.privacyNote ? ` · privacyNote: ${row.privacyNote.slice(0, 60)}` : ""));
    lines.push(`      hook: ${tsEscape(entry.hook)},`);
    lines.push(`      whatToShow: ${tsEscape(entry.whatToShow)},`);
    lines.push(`      howToFilm: ${tsEscape(entry.howToFilm)},`);
    lines.push(`      caption: ${tsEscape(entry.caption)},`);
    lines.push(`      anchor: ${tsEscape(entry.anchor)},`);
    lines.push(`      domain: ${tsEscape(entry.domain)},`);
    lines.push(`      pidginLevel: ${tsEscape(entry.pidginLevel)},`);
    lines.push(`      reviewedBy: ${tsEscape(entry.reviewedBy)},`);
    lines.push("    }),");
  }
  lines.push("  ]);");
  lines.push("");
  lines.push("// Defense in depth: re-run the production boot assert against the");
  lines.push("// generated array at module load. If anything regresses (e.g. a future");
  lines.push("// regenerate produces a row that violates a tightened rule) this throws");
  lines.push("// before the file can be imported by tests or any downstream module.");
  lines.push("assertNigerianPackIntegrity(APPROVED_NIGERIAN_PROMOTION_CANDIDATES);");
  lines.push("");
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
  const outPath = path.resolve(
    repoRoot,
    "artifacts/api-server/src/lib/nigerianHookPackApproved.ts",
  );

  const rows = readWorksheet(csvPath);

  const approved: { row: WorksheetRow; entry: NigerianPackEntry }[] = [];
  const rejected: { row: WorksheetRow; reasons: readonly string[] }[] = [];

  for (const row of rows) {
    const result = validateRow(row);
    if (result.ok) {
      approved.push({ row, entry: result.entry });
    } else {
      rejected.push({ row, reasons: result.reasons });
    }
  }

  // Final independent sanity: the boot assert must accept the
  // approved array as a NigerianPackEntry[]. Run it here BEFORE
  // writing the file so a violation throws and we never persist
  // a regressed file.
  assertNigerianPackIntegrity(approved.map((a) => a.entry));

  const fileText = emitApprovedFile(approved, rejected);
  fs.writeFileSync(outPath, fileText, "utf8");

  process.stdout.write(
    `[buildApprovedNigerianPack] worksheet rows: ${rows.length}\n` +
      `  approved: ${approved.length}\n` +
      `  rejected: ${rejected.length}\n` +
      `  reviewedBy stamp: ${REVIEWED_BY}\n` +
      `  output: ${outPath}\n` +
      `  NIGERIAN_HOOK_PACK still empty (DARK)\n` +
      `  LUMINA_NG_PACK_ENABLED still default-off\n` +
      `  no recipe-render integration wired\n` +
      `  no validators / anchor checks loosened\n`,
  );
  if (rejected.length > 0) {
    process.stdout.write("  rejected rows (audit):\n");
    for (const r of rejected) {
      process.stdout.write(
        `    - ${r.row.draftId}: ${r.reasons.join("; ")}\n`,
      );
    }
  }
};

main();
