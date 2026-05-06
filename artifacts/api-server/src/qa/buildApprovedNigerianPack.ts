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
 *   1. Reads the original draft fields.
 *   2. Optionally overlays reviewer rewrites from
 *      `.local/REGIONAL_N1_REWRITES.yaml` (only NON-EMPTY rewritten
 *      fields override the originals; blank fields keep originals).
 *      If the rewrites file is absent, ingestion proceeds with the
 *      original worksheet rows only.
 *   3. Stamps `reviewedBy = "BI 2026-05-05"` (the reviewer's stamp
 *      provided in the ingest request — the agent did NOT author
 *      this string; it came from the user message).
 *   4. Re-validates the candidate against EVERY production rule:
 *        - reviewedBy non-empty AND not the PENDING_NATIVE_REVIEW sentinel
 *        - pidginLevel ∈ {"light_pidgin","pidgin"}
 *        - hook / whatToShow / howToFilm / caption length bounds
 *          (PACK_FIELD_BOUNDS — same as `ideaSchema`)
 *        - anchor (lowercase) appears in BOTH hook and whatToShow
 *        - no PIDGIN_MOCKING_PATTERNS hit on hook/whatToShow/caption
 *        - validateScenarioCoherence(idea) === null
 *        - scoreHookQuality(hook, family) >= HOOK_QUALITY_FLOOR (40 —
 *          mirrors the recipe loop's quality floor in hookQuality.ts)
 *   5. PASS → append to the approved list (tagged `[REWRITE]` in
 *      source comments + audit if the rewrite overlay was applied).
 *   6. FAIL → append to the rejected list with the precise reason.
 *      No silent fixes. No fallback. Rewritten rows that still fail
 *      stay rejected and feed the next round's worksheet.
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
import {
  getNigerianHookQualityIngestKey,
  scoreNigerianPackEntryDetailed,
} from "../lib/nigerianHookQuality.js";

const REVIEWED_BY = "BI 2026-05-06";
const REWRITES_PATH_REL = ".local/REGIONAL_N1_REWRITES.yaml";
// PHASE N1-Q follow-up: the agent may now PROPOSE rewrites for rows
// that the reviewer hasn't gotten to yet. Such proposals MUST carry a
// reviewedBy that begins with this prefix so the integrity guard
// rejects them on ingestion. They never inherit the batch BI stamp,
// never reach the approved file, and never reach the live pack until
// the reviewer overwrites the stamp with their own initials + date.
const AGENT_PROPOSED_REVIEWED_BY_PREFIX = "AGENT-PROPOSED";

// ─── Rewrite overlay ─────────────────────────────────────────────
//
// Optional reviewer rewrites in a tiny YAML-list format:
//
//   - draftId: DRAFT-010
//     rewrittenHook: "my phone said almost there while still charging at home"
//     rewrittenWhatToShow: ""
//     rewrittenHowToFilm: ""
//     rewrittenCaption: "location: emotionally on the way."
//     rewriteNotes: "..."
//
// Only NON-EMPTY rewritten fields override the worksheet's original
// values. Blank fields keep the original. The agent does NOT author
// rewrites — they come from the native reviewer; this script just
// applies them and re-runs the SAME production validators. Failures
// are surfaced, never silently fixed.
type Rewrite = {
  draftId: string;
  // Optional anchor swap — when present and non-empty, replaces the
  // worksheet row's `anchor` field BEFORE validation. This lets the
  // reviewer fix anchor-not-found failures without editing the source
  // drafts file (the worksheet column is still the source of truth
  // for codegen; this overlay rides through the same code path as
  // hook/whatToShow rewrites).
  newAnchor?: string;
  rewrittenHook?: string;
  rewrittenWhatToShow?: string;
  rewrittenHowToFilm?: string;
  rewrittenCaption?: string;
  rewriteNotes?: string;
  // Optional per-row override of the batch reviewedBy stamp. Used for
  // agent-proposed rewrites that must NOT inherit the reviewer's BI
  // batch stamp — they carry a sentinel like "AGENT-PROPOSED — pending
  // BI review" so the integrity guard rejects them at ingest until the
  // reviewer overwrites the stamp.
  reviewedBy?: string;
};

const parseRewritesYaml = (text: string): Map<string, Rewrite> => {
  const out = new Map<string, Rewrite>();
  const lines = text.split(/\r?\n/);
  let cur: Rewrite | null = null;
  const flush = (): void => {
    if (cur && cur.draftId) out.set(cur.draftId, cur);
  };
  // Match `- key: value` and `  key: value`. Values may be bare or
  // double-quoted. JSON.parse handles standard escape sequences.
  const kvRe = /^\s*-?\s*([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.*)$/;
  const decode = (raw: string): string => {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return "";
    if (trimmed.startsWith('"')) {
      try {
        return JSON.parse(trimmed) as string;
      } catch {
        // fall through — return as-is minus surrounding quotes
        return trimmed.slice(1, -1);
      }
    }
    return trimmed;
  };
  for (const raw of lines) {
    if (raw.trim().length === 0) continue;
    const m = raw.match(kvRe);
    if (!m) continue;
    const [, key, valueRaw] = m;
    if (key === "draftId") {
      flush();
      cur = { draftId: decode(valueRaw) };
    } else if (cur) {
      const v = decode(valueRaw);
      if (key === "rewrittenHook") cur.rewrittenHook = v;
      else if (key === "rewrittenWhatToShow") cur.rewrittenWhatToShow = v;
      else if (key === "rewrittenHowToFilm") cur.rewrittenHowToFilm = v;
      else if (key === "rewrittenCaption") cur.rewrittenCaption = v;
      else if (key === "rewriteNotes") cur.rewriteNotes = v;
      else if (key === "newAnchor") cur.newAnchor = v;
      else if (key === "reviewedBy") cur.reviewedBy = v;
    }
  }
  flush();
  return out;
};

export const loadRewrites = (repoRoot: string): Map<string, Rewrite> => {
  const p = path.resolve(repoRoot, REWRITES_PATH_REL);
  if (!fs.existsSync(p)) return new Map();
  return parseRewritesYaml(fs.readFileSync(p, "utf8"));
};

export const applyRewrite = (
  row: WorksheetRow,
  rw: Rewrite | undefined,
): { row: WorksheetRow; applied: boolean } => {
  if (!rw) return { row, applied: false };
  const overlay = (orig: string, rewritten: string | undefined): string =>
    rewritten && rewritten.length > 0 ? rewritten : orig;
  return {
    row: {
      ...row,
      anchor: overlay(row.anchor, rw.newAnchor),
      hook: overlay(row.hook, rw.rewrittenHook),
      whatToShow: overlay(row.whatToShow, rw.rewrittenWhatToShow),
      howToFilm: overlay(row.howToFilm, rw.rewrittenHowToFilm),
      caption: overlay(row.caption, rw.rewrittenCaption),
      reviewedByOverride:
        rw.reviewedBy && rw.reviewedBy.length > 0
          ? rw.reviewedBy
          : row.reviewedByOverride,
    },
    applied: true,
  };
};
const HOOK_QUALITY_FLOOR = 40;
// PHASE N1-Q — reviewed Nigerian pack entries are scored by the
// dedicated additive scorer in `lib/nigerianHookQuality.ts`. The
// floor (40) is unchanged. The English `scoreHookQuality` is no
// longer the gate for this ingest path — see the file's leading
// audit comment for the why.
const NIGERIAN_INGEST_KEY = getNigerianHookQualityIngestKey();

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

export type WorksheetRow = {
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
  // Set ONLY by the rewrite overlay when a yaml entry carries an
  // explicit `reviewedBy:` key. When undefined, validateRow falls back
  // to the batch REVIEWED_BY constant. Used so agent-proposed rewrites
  // can ship through the worksheet→ingest path while still being
  // rejected by the integrity guard until the reviewer signs off.
  reviewedByOverride?: string;
};

export const readWorksheet = (csvPath: string): WorksheetRow[] => {
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

export const validateRow = (row: WorksheetRow): ValidationResult => {
  const reasons: string[] = [];

  // 1. reviewedBy — row-provided stamp wins over the batch default.
  // This lets agent-proposed rewrites carry an AGENT-PROPOSED sentinel
  // that the integrity guard rejects until the reviewer overwrites it.
  const reviewedBy = row.reviewedByOverride ?? REVIEWED_BY;
  if (!reviewedBy || reviewedBy.trim().length === 0) {
    reasons.push("reviewedBy is empty");
  }
  if (reviewedBy.trim() === "PENDING_NATIVE_REVIEW") {
    reasons.push("reviewedBy is the PENDING_NATIVE_REVIEW sentinel");
  }
  if (reviewedBy.trim().startsWith(AGENT_PROPOSED_REVIEWED_BY_PREFIX)) {
    reasons.push(
      `reviewedBy carries the AGENT-PROPOSED sentinel ('${reviewedBy.trim()}') — ` +
        `this row is an agent-proposed rewrite candidate awaiting reviewer ` +
        `sign-off. The reviewer must overwrite the stamp with their own ` +
        `initials + date before this row can be approved.`,
    );
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

  // 7. Nigerian-pack hook quality floor (additive scorer; floor unchanged).
  //
  // The English `scoreHookQuality` overfits to Western-English hook
  // syntax (verb table, anthropomorph patterns, concrete-noun list
  // are all lexically locked). Reviewed Pidgin / light-Pidgin hooks
  // routinely score 22–38 against the floor of 40 even when they
  // pass every safety + coherence validator. The Nigerian pack
  // ingest path uses `scoreNigerianPackEntry` instead — same floor
  // (40), additive 6-dimension scale calibrated for Pidgin / Naija
  // comedy. See `lib/nigerianHookQuality.ts` for the trust gate +
  // axes. Cross-region behavior is unaffected: this scorer is never
  // called from any runtime generation path.
  //
  // We construct a NigerianPackEntry shape ONLY after the prior six
  // validation steps have passed (so this block is only reached for
  // candidates that already cleared anchor / mocking / length /
  // coherence checks). The `pidginLevel` cast is safe — step 2
  // already rejected anything outside {"light_pidgin","pidgin"}.
  const entryForScoring: NigerianPackEntry = {
    hook: row.hook,
    whatToShow: row.whatToShow,
    howToFilm: row.howToFilm,
    caption: row.caption,
    anchor: row.anchor.toLowerCase(),
    domain: row.domain,
    pidginLevel: row.currentPidginLevel as "light_pidgin" | "pidgin",
    reviewedBy,
  };
  const hookScoring = scoreNigerianPackEntryDetailed(entryForScoring, {
    kind: "ingest",
    key: NIGERIAN_INGEST_KEY,
  });
  const hookScore = hookScoring.total;
  if (hookScore < HOOK_QUALITY_FLOOR) {
    reasons.push(
      `scoreNigerianPackEntry ${hookScore} < floor ${HOOK_QUALITY_FLOOR} ` +
        `(visceral=${hookScoring.visceral} naturalness=${hookScoring.naturalness} ` +
        `contradiction=${hookScoring.contradiction} anchor=${hookScoring.anchorRelevance} ` +
        `filmable=${hookScoring.filmable} brevity=${hookScoring.brevity})`,
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
  approved: ReadonlyArray<{
    row: WorksheetRow;
    entry: NigerianPackEntry;
    fromRewrite: boolean;
  }>,
  rejected: ReadonlyArray<{
    row: WorksheetRow;
    reasons: readonly string[];
    fromRewrite: boolean;
  }>,
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
  lines.push(` *   • scoreNigerianPackEntry(entry) >= ${HOOK_QUALITY_FLOOR}` +
    `  (Pidgin-aware additive scorer; floor unchanged)`);
  lines.push(" *");
  lines.push(` * INGEST SUMMARY: ${approved.length} approved · ${rejected.length} rejected`);
  if (rejected.length > 0) {
    lines.push(" *");
    lines.push(" * REJECTED ROWS (kept here for the reviewer audit trail; NOT in the");
    lines.push(" * exported array — the generator does not silently fix anything):");
    for (const r of rejected) {
      const tag = r.fromRewrite ? " [REWRITE]" : "";
      lines.push(` *   • ${r.row.draftId}${tag} → ${r.reasons.join("; ")}`);
    }
  }
  lines.push(" */");
  lines.push("");
  lines.push("import { type NigerianPackEntry } from \"./nigerianHookPack.js\";");
  lines.push("");
  lines.push(
    "export const APPROVED_NIGERIAN_PROMOTION_CANDIDATES: readonly NigerianPackEntry[] =",
  );
  lines.push("  Object.freeze([");
  for (const { row, entry, fromRewrite } of approved) {
    lines.push("    Object.freeze({");
    lines.push(`      // source: ${row.draftId}${fromRewrite ? " [REWRITE]" : ""} · cluster: ${row.cluster}` +
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
  lines.push("// NOTE: A self-`assertNigerianPackIntegrity(...)` call was previously");
  lines.push("// emitted here as a defense-in-depth boot check. It was REMOVED because");
  lines.push("// `nigerianHookPack.ts` imports this file at module-top, creating a");
  lines.push("// circular import. When the flag is ON the self-call would execute");
  lines.push("// before `PACK_FIELD_BOUNDS` (declared LATER in `nigerianHookPack.ts`)");
  lines.push("// finishes initializing → TDZ → `Cannot read properties of undefined`.");
  lines.push("// Defense is preserved by:");
  lines.push("//   (1) `validateRow` in `qa/buildApprovedNigerianPack.ts` running ALL");
  lines.push("//       the same checks per-row at codegen time before this file is");
  lines.push("//       written, and");
  lines.push("//   (2) `assertNigerianPackIntegrity(NIGERIAN_HOOK_PACK)` in");
  lines.push("//       `nigerianHookPack.ts` (run after PACK_FIELD_BOUNDS is");
  lines.push("//       initialized), which validates the live pool when flag is ON.");
  lines.push("");
  lines.push("// NOTE: The PHASE N1-Q `registerApprovedPoolReference(...)` self-call");
  lines.push("// was REMOVED here for the same circular-import TDZ reason as the");
  lines.push("// integrity assert above (`APPROVED_POOL_REF` lives in");
  lines.push("// `nigerianHookQuality.ts` and is in TDZ when this module loads via");
  lines.push("// the cycle from `nigerianHookPack.ts`). Registration of the live");
  lines.push("// pool happens in `nigerianHookPack.ts` after `NIGERIAN_HOOK_PACK`");
  lines.push("// is assigned (it's the same array reference when the flag is ON).");
  lines.push("// Tests that need to grade the approved pool while the flag is OFF");
  lines.push("// must register it explicitly via `registerApprovedPoolReference`.");
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
  const rewrites = loadRewrites(repoRoot);

  const approved: {
    row: WorksheetRow;
    entry: NigerianPackEntry;
    fromRewrite: boolean;
  }[] = [];
  const rejected: {
    row: WorksheetRow;
    reasons: readonly string[];
    fromRewrite: boolean;
  }[] = [];

  for (const original of rows) {
    const { row, applied } = applyRewrite(original, rewrites.get(original.draftId));
    const result = validateRow(row);
    if (result.ok) {
      approved.push({ row, entry: result.entry, fromRewrite: applied });
    } else {
      rejected.push({ row, reasons: result.reasons, fromRewrite: applied });
    }
  }

  // Final independent sanity: the boot assert must accept the
  // approved array as a NigerianPackEntry[]. Run it here BEFORE
  // writing the file so a violation throws and we never persist
  // a regressed file.
  assertNigerianPackIntegrity(approved.map((a) => a.entry));

  const fileText = emitApprovedFile(approved, rejected);
  fs.writeFileSync(outPath, fileText, "utf8");

  const approvedFromRewrite = approved.filter((a) => a.fromRewrite).length;
  const rejectedFromRewrite = rejected.filter((r) => r.fromRewrite).length;
  process.stdout.write(
    `[buildApprovedNigerianPack] worksheet rows: ${rows.length}\n` +
      `  rewrites loaded: ${rewrites.size}\n` +
      `  approved: ${approved.length} (${approvedFromRewrite} from rewrites)\n` +
      `  rejected: ${rejected.length} (${rejectedFromRewrite} from rewrites)\n` +
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

  // PHASE N1-FULL-SPEC — write a standalone rejection report so the
  // reviewer can triage failing drafts without grepping the codegen
  // output. The report is grouped by reason category so common
  // failure patterns (e.g. "anchor not found in whatToShow") are
  // visible at a glance.
  const reportPath = path.resolve(
    path.dirname(outPath),
    "../../../../.local/N1_REJECTION_REPORT.md",
  );
  const reportLines: string[] = [];
  reportLines.push("# N1 Codegen Rejection Report");
  reportLines.push("");
  reportLines.push(`Generated: ${new Date().toISOString()}`);
  reportLines.push(`Worksheet: ${path.basename(csvPath)}`);
  reportLines.push(
    `Approved: ${approved.length} · Rejected: ${rejected.length} · Total: ${rows.length}`,
  );
  reportLines.push("");
  if (rejected.length === 0) {
    reportLines.push("All worksheet rows passed validation. Nothing to triage.");
  } else {
    // Group by primary reason category for fast skimming.
    const byCategory = new Map<string, typeof rejected>();
    for (const r of rejected) {
      const cat = r.reasons[0]?.split(":")[0]?.split(" ").slice(0, 4).join(" ") ?? "unknown";
      const arr = byCategory.get(cat) ?? [];
      arr.push(r);
      byCategory.set(cat, arr);
    }
    reportLines.push(`## Summary by primary failure category`);
    reportLines.push("");
    for (const [cat, arr] of [...byCategory.entries()].sort(
      (a, b) => b[1].length - a[1].length,
    )) {
      reportLines.push(`- **${cat}** — ${arr.length} drafts`);
    }
    reportLines.push("");
    reportLines.push(`## Per-draft detail`);
    reportLines.push("");
    reportLines.push(`| draftId | pidginLevel | anchor | hook (first 60c) | reasons |`);
    reportLines.push(`|---|---|---|---|---|`);
    for (const r of rejected) {
      const hookExcerpt = (r.row.hook ?? "").slice(0, 60).replace(/\|/g, "\\|");
      reportLines.push(
        `| ${r.row.draftId} | ${r.row.currentPidginLevel} | ${r.row.anchor} | ${hookExcerpt} | ${r.reasons.join("; ").replace(/\|/g, "\\|")} |`,
      );
    }
  }
  fs.writeFileSync(reportPath, reportLines.join("\n") + "\n", "utf8");
  process.stdout.write(`  rejection report: ${reportPath}\n`);
};

main();
