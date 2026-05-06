/**
 * REGIONAL N1 — Native-Reviewer Worksheet (Top 50 safest activation candidates)
 *
 * READ-ONLY EXPORT. This script does NOT:
 *   • mutate `DRAFT_NIGERIAN_HOOK_PACK`
 *   • write to `NIGERIAN_HOOK_PACK` (live pack stays empty / DARK)
 *   • flip `LUMINA_NG_PACK_ENABLED`
 *   • promote, approve, or stamp any entry
 *   • weaken validators, the activation guard, or the anchor-in-hook
 *     and anchor-in-whatToShow rule
 *
 * It selects the Top 50 safest activation candidates from the DRAFT pack
 * (light_pidgin / pidgin entries that already pass production preflight:
 * anchor present in hook AND whatToShow, no mocking-pattern hit, field
 * lengths within bounds), sorts them by a uniqueness score, and emits a
 * reviewer worksheet at:
 *
 *   .local/REGIONAL_N1_REVIEWER_WORKSHEET.md
 *   .local/REGIONAL_N1_REVIEWER_WORKSHEET.csv
 *
 * The reviewer fills in the DECISION / FINAL_PIDGIN_LEVEL / REVIEWED_BY /
 * NOTES (and REWRITTEN_* if decision === "rewrite") columns. The returned
 * decisions are then ingested in a SEPARATE follow-up phase that creates
 * the `APPROVED_NIGERIAN_PROMOTION_CANDIDATES` constant. Until that
 * follow-up runs, every `reviewedBy` remains `PENDING_NATIVE_REVIEW` and
 * the live pack remains empty.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PIDGIN_MOCKING_PATTERNS,
  PACK_FIELD_BOUNDS,
} from "../lib/nigerianHookPack.js";
import {
  DRAFT_NIGERIAN_HOOK_PACK,
  PENDING_NATIVE_REVIEW,
  type DraftNigerianPackEntry,
} from "../lib/nigerianHookPackDrafts.js";

// ─── Shared preflight helpers (mirror promotion sheet) ────────────
const passesProductionAnchorRule = (e: DraftNigerianPackEntry): boolean => {
  const a = e.anchor.toLowerCase();
  return (
    e.hook.toLowerCase().includes(a) &&
    e.whatToShow.toLowerCase().includes(a)
  );
};

const matchesMockingPattern = (e: DraftNigerianPackEntry): RegExp | null => {
  for (const re of PIDGIN_MOCKING_PATTERNS) {
    if (re.test(e.hook) || re.test(e.whatToShow) || re.test(e.caption)) {
      return re;
    }
  }
  return null;
};

const passesFieldBounds = (e: DraftNigerianPackEntry): boolean => {
  const b = PACK_FIELD_BOUNDS;
  return (
    e.hook.length >= 1 &&
    e.hook.length <= b.hookMax &&
    e.whatToShow.length >= b.whatToShowMin &&
    e.whatToShow.length <= b.whatToShowMax &&
    e.howToFilm.length >= b.howToFilmMin &&
    e.howToFilm.length <= b.howToFilmMax &&
    e.caption.length >= b.captionMin &&
    e.caption.length <= b.captionMax
  );
};

// ─── Duplicate signatures (shared with promotion sheet) ───────────
const normalizeHook = (h: string): string =>
  h
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const fiveWordSig = (h: string): string =>
  normalizeHook(h).split(" ").slice(0, 5).join(" ");

const firstFifteenSig = (h: string): string =>
  normalizeHook(h).slice(0, 15);

const padId = (i: number): string => `DRAFT-${String(i + 1).padStart(3, "0")}`;

// ─── Selection ────────────────────────────────────────────────────
type SafestRow = {
  draftId: string;
  index: number;
  entry: DraftNigerianPackEntry;
  uniquenessScore: number;
};

const selectTop50Safest = (): SafestRow[] => {
  const sigToIds = new Map<string, string[]>();
  const fifteenToIds = new Map<string, string[]>();
  DRAFT_NIGERIAN_HOOK_PACK.forEach((e, i) => {
    const id = padId(i);
    const sig = fiveWordSig(e.hook);
    const prefix = firstFifteenSig(e.hook);
    if (!sigToIds.has(sig)) sigToIds.set(sig, []);
    sigToIds.get(sig)!.push(id);
    if (!fifteenToIds.has(prefix)) fifteenToIds.set(prefix, []);
    fifteenToIds.get(prefix)!.push(id);
  });

  const anchorCount = new Map<string, number>();
  const clusterCount = new Map<string, number>();
  for (const e of DRAFT_NIGERIAN_HOOK_PACK) {
    anchorCount.set(e.anchor, (anchorCount.get(e.anchor) ?? 0) + 1);
    clusterCount.set(e.cluster, (clusterCount.get(e.cluster) ?? 0) + 1);
  }

  const safest: SafestRow[] = [];
  DRAFT_NIGERIAN_HOOK_PACK.forEach((e, i) => {
    if (e.pidginLevel !== "light_pidgin" && e.pidginLevel !== "pidgin") return;
    if (!passesProductionAnchorRule(e)) return;
    if (matchesMockingPattern(e) !== null) return;
    if (!passesFieldBounds(e)) return;

    const id = padId(i);
    const sig = fiveWordSig(e.hook);
    const prefix = firstFifteenSig(e.hook);
    const dups = new Set<string>();
    for (const other of sigToIds.get(sig) ?? []) if (other !== id) dups.add(other);
    for (const other of fifteenToIds.get(prefix) ?? []) {
      if (other !== id) dups.add(other);
    }

    let score = 100;
    if (e.pidginLevel === "pidgin") score += 15;
    else score += 5;
    if (dups.size > 0) score -= 10 * Math.min(dups.size, 3);
    const ac = anchorCount.get(e.anchor) ?? 0;
    if (ac >= 8) score -= 10;
    else if (ac >= 5) score -= 5;
    const cc = clusterCount.get(e.cluster) ?? 0;
    if (cc >= 4) score -= 8;

    safest.push({ draftId: id, index: i, entry: e, uniquenessScore: score });
  });

  safest.sort((a, b) => b.uniquenessScore - a.uniquenessScore || a.index - b.index);
  return safest.slice(0, 50);
};

// ─── CSV emit ─────────────────────────────────────────────────────
const csvEscape = (v: string): string => {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
};

const buildCsv = (rows: SafestRow[]): string => {
  const header = [
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
    // Reviewer-editable columns (blank — reviewer fills in)
    "DECISION",                // approve | rewrite | reject
    "FINAL_PIDGIN_LEVEL",      // light_pidgin | pidgin
    "REVIEWED_BY",             // initials + ISO date, e.g. "AO 2026-05-08"
    "NOTES",                   // free text
    "REWRITTEN_HOOK",          // only if DECISION === "rewrite"
    "REWRITTEN_WHAT_TO_SHOW",
    "REWRITTEN_HOW_TO_FILM",
    "REWRITTEN_CAPTION",
    "REWRITTEN_ANCHOR",
  ];
  const lines: string[] = [header.join(",")];
  for (const r of rows) {
    const e = r.entry;
    lines.push(
      [
        r.draftId,
        e.pidginLevel,
        e.anchor,
        e.domain,
        e.cluster,
        e.hook,
        e.whatToShow,
        e.howToFilm,
        e.caption,
        e.privacyNote ?? "",
        String(r.uniquenessScore),
        "", "", "", "", "", "", "", "", "",
      ].map(csvEscape).join(","),
    );
  }
  return lines.join("\n") + "\n";
};

// ─── Markdown emit ────────────────────────────────────────────────
const buildMarkdown = (rows: SafestRow[]): string => {
  const lines: string[] = [];
  lines.push("# REGIONAL N1 — Native Reviewer Worksheet");
  lines.push("");
  lines.push(
    "> **Read-only export.** Pack remains DARK. None of these entries has been",
  );
  lines.push("> promoted, approved, or copied into the live `NIGERIAN_HOOK_PACK`.");
  lines.push(
    "> Every `reviewedBy` is still `PENDING_NATIVE_REVIEW`. After you return your",
  );
  lines.push(
    "> decisions, a separate follow-up step will create the",
  );
  lines.push(
    "> `APPROVED_NIGERIAN_PROMOTION_CANDIDATES` constant from the approved rows",
  );
  lines.push(
    "> only. The live pack stays empty until then.",
  );
  lines.push("");
  lines.push(
    `Selected: **${rows.length}** safest activation candidates ` +
      "(light_pidgin / pidgin tier · anchor present in hook AND whatToShow · " +
      "no mocking-pattern hit · field lengths within production bounds).",
  );
  lines.push("");
  lines.push("## Reviewer instructions");
  lines.push("");
  lines.push(
    "For each entry below, fill in the four required fields (and the rewritten-* fields if your decision is `rewrite`). Return the completed Markdown or CSV — do not edit any other file.",
  );
  lines.push("");
  lines.push("**`DECISION`** — pick exactly one:");
  lines.push("");
  lines.push(
    "- `approve` — entry is ready to ship as written. The 8 fields (hook, whatToShow, howToFilm, caption, anchor, domain, pidginLevel, reviewedBy) will be promoted unchanged.",
  );
  lines.push(
    "- `rewrite` — entry is salvageable but needs your rewording. Fill in any `REWRITTEN_*` fields you want changed; leave the others blank to keep the original. The rewritten entry must still satisfy the production rules: anchor (lowercased) appears as a substring in BOTH the hook and whatToShow, no mocking spelling, field lengths within `PACK_FIELD_BOUNDS`.",
  );
  lines.push(
    "- `reject` — drop from the corpus. No further fields needed.",
  );
  lines.push("");
  lines.push("**`FINAL_PIDGIN_LEVEL`** — must be `light_pidgin` or `pidgin`. The live pack rejects `clean`. (Required for `approve` and `rewrite`; ignored for `reject`.)");
  lines.push("");
  lines.push(
    "**`REVIEWED_BY`** — your initials + ISO date, e.g. `AO 2026-05-08`. Must NOT be blank or contain `PENDING_NATIVE_REVIEW`. The boot assert refuses both.",
  );
  lines.push("");
  lines.push("**`NOTES`** — optional free text (regional caveats, slang risk, alternate framings).");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Hard rules (the worksheet ingestion step will enforce these)");
  lines.push("");
  lines.push("1. Only entries with `DECISION = approve` or `DECISION = rewrite` enter `APPROVED_NIGERIAN_PROMOTION_CANDIDATES`.");
  lines.push("2. The `reviewedBy` value you provide is copied verbatim — there is no fallback. A blank or sentinel value trips the boot assert.");
  lines.push("3. Anchor-in-hook AND anchor-in-whatToShow is re-checked after rewrite. A failed rewrite is rejected at ingest, not silently fixed.");
  lines.push("4. The mocking-spelling regex is re-run on every approved/rewritten entry.");
  lines.push("5. Even after ingestion, the live pack stays empty until a separate explicit promotion step copies approved entries into `NIGERIAN_HOOK_PACK`, AND `LUMINA_NG_PACK_ENABLED=true` is set.");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Candidates");
  lines.push("");

  rows.forEach((r, i) => {
    const e = r.entry;
    lines.push(`### ${i + 1}. ${r.draftId} — anchor: \`${e.anchor}\` · tier: \`${e.pidginLevel}\` · domain: \`${e.domain}\` · cluster: \`${e.cluster}\``);
    lines.push("");
    lines.push(`- **uniquenessScore:** ${r.uniquenessScore}`);
    if (e.privacyNote) lines.push(`- **privacyNote:** ${e.privacyNote}`);
    lines.push("");
    lines.push("**Original (read-only):**");
    lines.push("");
    lines.push(`- **hook:** ${e.hook}`);
    lines.push(`- **whatToShow:** ${e.whatToShow}`);
    lines.push(`- **howToFilm:** ${e.howToFilm}`);
    lines.push(`- **caption:** ${e.caption}`);
    lines.push("");
    lines.push("**Reviewer decision (fill in):**");
    lines.push("");
    lines.push("```yaml");
    lines.push(`draftId: ${r.draftId}`);
    lines.push("DECISION:                # approve | rewrite | reject");
    lines.push("FINAL_PIDGIN_LEVEL:      # light_pidgin | pidgin   (required for approve/rewrite)");
    lines.push("REVIEWED_BY:             # e.g. \"AO 2026-05-08\"   (required for approve/rewrite)");
    lines.push("NOTES:                   # optional free text");
    lines.push("# only fill in REWRITTEN_* if DECISION is \"rewrite\"; blank fields keep the original");
    lines.push("REWRITTEN_HOOK:");
    lines.push("REWRITTEN_WHAT_TO_SHOW:");
    lines.push("REWRITTEN_HOW_TO_FILM:");
    lines.push("REWRITTEN_CAPTION:");
    lines.push("REWRITTEN_ANCHOR:");
    lines.push("```");
    lines.push("");
    lines.push("---");
    lines.push("");
  });

  return lines.join("\n");
};

// ─── Main ─────────────────────────────────────────────────────────
const main = (): void => {
  const rows = selectTop50Safest();

  // Resolve repo-root .local regardless of pnpm cwd.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.resolve(here, "../../../../.local");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const mdPath = path.join(outDir, "REGIONAL_N1_REVIEWER_WORKSHEET.md");
  const csvPath = path.join(outDir, "REGIONAL_N1_REVIEWER_WORKSHEET.csv");

  fs.writeFileSync(mdPath, buildMarkdown(rows), "utf8");
  fs.writeFileSync(csvPath, buildCsv(rows), "utf8");

  // Final sanity: every selected row's reviewedBy is still the sentinel.
  // If this ever flips, it means the draft pool was mutated upstream.
  for (const r of rows) {
    if (r.entry.reviewedBy !== PENDING_NATIVE_REVIEW) {
      throw new Error(
        `[nigerianPackReviewerWorksheet] reviewedBy on ${r.draftId} is ` +
          `not PENDING_NATIVE_REVIEW — draft pool was mutated. Refusing to write.`,
      );
    }
  }

  // Tier breakdown of the 50 selected.
  const tierCount: Record<string, number> = {};
  for (const r of rows) {
    tierCount[r.entry.pidginLevel] =
      (tierCount[r.entry.pidginLevel] ?? 0) + 1;
  }

  const tierStr = Object.entries(tierCount)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");

  process.stdout.write(
    `[nigerianPackReviewerWorksheet] selected ${rows.length} safest candidates ` +
      `→ md=${mdPath} csv=${csvPath}\n` +
      `  tiers in selection: ${tierStr}\n` +
      `  reviewedBy still PENDING_NATIVE_REVIEW on every row (pack DARK)\n` +
      `  next step (BLOCKED on reviewer): ingest decisions into ` +
      `APPROVED_NIGERIAN_PROMOTION_CANDIDATES (separate file). ` +
      `NIGERIAN_HOOK_PACK still empty.\n`,
  );
};

main();
