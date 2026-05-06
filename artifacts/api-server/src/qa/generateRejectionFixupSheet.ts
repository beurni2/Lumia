/**
 * PHASE N1-FULL-SPEC — Rejection Fix-up Worksheet generator.
 *
 * Reads `.local/REGIONAL_N1_REVIEWER_WORKSHEET.csv`, re-runs the
 * codegen validators on every row, and emits a CSV containing ONLY
 * the rejected rows plus a "suggested anchor" pulled from each
 * row's `whatToShow` field. The suggested anchor is the strongest
 * single-token candidate that:
 *
 *   1. Appears in BOTH `hook` and `whatToShow` (lowercased substring),
 *      satisfying the codegen anchor check (`buildApprovedNigerianPack.ts`
 *      L364–374) without any other field edits.
 *   2. Is not in a small stop-word list (`a`, `the`, `you`, etc.).
 *   3. Is at least 4 characters (filters out grammatical fillers).
 *
 * If no token meets all three criteria, the suggestion column is
 * blank and the row is flagged `NEEDS_REWRITE` so the reviewer
 * knows the failure can't be fixed by an anchor swap alone.
 *
 * The output CSV is intentionally a SUGGESTION sheet — every
 * proposed change still needs a native speaker (BI) to either
 * confirm or override before a second ingest pass. The script
 * does NOT mutate the source worksheet or the drafts file.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx \
 *     src/qa/generateRejectionFixupSheet.ts
 *
 * Output:
 *   .local/N1_REJECTION_FIXUP_WORKSHEET.csv
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readWorksheet,
  validateRow,
  loadRewrites,
  applyRewrite,
  type WorksheetRow,
} from "./buildApprovedNigerianPack.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..", "..", "..");
const WORKSHEET_PATH = path.join(
  REPO_ROOT,
  ".local",
  "REGIONAL_N1_REVIEWER_WORKSHEET.csv",
);
const OUT_PATH = path.join(
  REPO_ROOT,
  ".local",
  "N1_REJECTION_FIXUP_WORKSHEET.csv",
);

// Tiny stop-word list — function words and ultra-generic grammar
// glue that would technically satisfy the anchor check but produce
// a useless live-pack anchor (e.g. "the", "you", "and"). The codegen
// scorer's `anchor` axis rewards concreteness, so picking "the"
// would still trip the score floor.
const STOP_WORDS = new Set<string>([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for",
  "from", "had", "has", "have", "her", "his", "i", "if", "in", "into",
  "is", "it", "its", "me", "my", "no", "not", "now", "of", "off",
  "on", "or", "our", "out", "over", "own", "she", "so", "than", "that",
  "the", "their", "them", "then", "there", "they", "this", "to", "too",
  "up", "us", "was", "we", "were", "what", "when", "where", "who",
  "will", "with", "you", "your", "like", "just", "one", "two", "still",
  "back", "even", "also", "only", "very", "more", "most", "some",
  "any", "all", "again", "after", "before", "while", "show", "shows",
  "showing", "shown", "open", "opens", "close", "closes", "look",
  "looks", "looking", "looked", "say", "says", "said", "go", "goes",
  "went", "gone", "do", "does", "did", "done", "make", "makes",
  "made", "take", "takes", "took", "taken", "get", "gets", "got",
  "put", "puts", "see", "sees", "saw", "seen", "come", "comes",
  "came", "use", "uses", "used", "fake", "real", "low", "high",
  "soft", "hard", "small", "big", "long", "short", "next", "last",
  "first", "between",
  // Verb-style and meta words that satisfy the substring check but
  // would be useless live-pack anchors (the codegen scorer's
  // `anchor` axis rewards concrete nouns; these would still trip
  // the score floor).
  "starts", "started", "starting", "ends", "ended", "ending",
  "tries", "tried", "trying", "tells", "told", "telling",
  "wants", "wanted", "needs", "needed", "feels", "felt",
  "spoon", "plate", "thing", "things", "stuff", "screen",
  "minute", "minutes", "second", "seconds", "hour", "hours",
  "today", "tomorrow", "yesterday", "morning", "evening",
  "don't", "doesn't", "didn't", "isn't", "wasn't", "won't",
  "can't", "couldn't", "shouldn't", "wouldn't", "i'm", "i've",
  "i'll", "i'd", "you're", "you've", "you'll", "they're",
  "going", "gonna", "wanna", "yeah", "okay",
]);

const tokenize = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z'\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);

/**
 * Find the strongest anchor candidate present in BOTH `hook` and
 * `whatToShow`. Returns `null` when no qualifying token exists,
 * meaning the row genuinely needs a content rewrite (the hook and
 * whatToShow describe disjoint scenarios).
 *
 * Scoring: among shared tokens, prefer the LONGEST (proxy for a
 * concrete noun like "presentation" over short helper words like
 * "post"). Ties broken by first occurrence in `whatToShow` so the
 * suggested anchor reads naturally with the existing copy.
 */
const suggestAnchor = (hook: string, whatToShow: string): string | null => {
  const hookTokens = new Set(tokenize(hook));
  const wtsOrdered = tokenize(whatToShow);
  const candidates = wtsOrdered.filter(
    (t) =>
      t.length >= 4 &&
      !STOP_WORDS.has(t) &&
      hookTokens.has(t),
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    return wtsOrdered.indexOf(a) - wtsOrdered.indexOf(b);
  });
  return candidates[0];
};

const csvCell = (raw: string): string => {
  const needsQuote = /[",\n]/.test(raw);
  if (!needsQuote) return raw;
  return `"${raw.replace(/"/g, '""')}"`;
};

const csvRow = (cells: string[]): string => cells.map(csvCell).join(",");

const main = (): void => {
  const rawRows = readWorksheet(WORKSHEET_PATH);
  const rewrites = loadRewrites(REPO_ROOT);
  // Mirror the codegen pipeline exactly: overlay the per-draft
  // rewrite (if any) BEFORE validating, so the fix-up sheet
  // reflects the FINAL post-overlay state of every still-rejected
  // row. Without this step the sheet would propose anchor swaps
  // for rows the live ingest already approved via rewrite.
  const rows: WorksheetRow[] = rawRows.map((original) => {
    const { row } = applyRewrite(original, rewrites.get(original.draftId));
    return row;
  });
  type RejectedRow = {
    row: WorksheetRow;
    reasons: string[];
    suggested: string | null;
    rationale: string;
    fromRewrite: boolean;
  };
  const rejected: RejectedRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const fromRewrite = rewrites.has(row.draftId);
    const v = validateRow(row);
    if (v.ok) continue;
    let suggested: string | null = null;
    let rationale = "";
    // Classify failure reasons. A row may fail multiple checks at
    // once — an anchor swap only fixes the anchor check (and the
    // co-occurring scenario-coherence `show_missing_hook_anchor`,
    // which IS triggered by the same root cause). It does NOT fix
    // an independent `scoreNigerianPackEntry < floor` failure
    // unless the scorer's `anchor` axis was the deficit.
    const anchorReasons = v.reasons.filter((r) => r.includes("anchor '"));
    const scoreReasons = v.reasons.filter((r) =>
      r.includes("scoreNigerianPackEntry"),
    );
    const coherenceReasons = v.reasons.filter(
      (r) =>
        r.includes("validateScenarioCoherence") &&
        !r.includes("show_missing_hook_anchor"),
    );
    const lengthReasons = v.reasons.filter((r) => r.includes("out of bounds"));
    const stampReasons = v.reasons.filter(
      (r) => r.includes("reviewedBy") || r.includes("AGENT-PROPOSED"),
    );

    if (anchorReasons.length > 0) {
      suggested = suggestAnchor(row.hook, row.whatToShow);
    }

    if (suggested && scoreReasons.length === 0 && coherenceReasons.length === 0 &&
        lengthReasons.length === 0 && stampReasons.length === 0) {
      rationale = "anchor swap is the SOLE fix needed; row will pass after BI confirms suggested anchor";
    } else if (suggested && scoreReasons.length > 0) {
      rationale =
        "anchor swap fixes anchor check, but row ALSO fails score floor — needs voice/concreteness rewrite for the score axes (see allFailureReasons for breakdown)";
    } else if (suggested && coherenceReasons.length > 0) {
      rationale = "anchor swap fixes anchor check, but row ALSO fails an independent coherence check — needs scenario rewrite";
    } else if (anchorReasons.length > 0 && !suggested) {
      rationale = "no shared concrete noun in hook+whatToShow — full content rewrite required, not just an anchor swap";
    } else if (scoreReasons.length > 0) {
      rationale = "anchor check passed; failure is score floor — needs voice/concreteness rewrite";
    } else if (coherenceReasons.length > 0) {
      rationale = "anchor check passed; failure is scenario coherence — needs whatToShow rewrite to match hook scenario";
    } else if (lengthReasons.length > 0) {
      rationale = "field length out of bounds — trim/expand to fit PACK_FIELD_BOUNDS";
    } else {
      rationale = "see allFailureReasons for details";
    }
    rejected.push({ row, reasons: v.reasons, suggested, rationale, fromRewrite });
  }

  const header = [
    "draftId",
    "currentPidginLevel",
    "originalAnchor",
    "hook",
    "whatToShow",
    "suggestedAnchor",
    "fixupAction",
    "rationale",
    "rewriteAlreadyAttempted",
    "allFailureReasons",
  ];

  // Action precedence (most-actionable first):
  //   REPLACE_ANCHOR_ONLY        — anchor swap is sufficient; row
  //                                 will pass after the BI confirms.
  //   REPLACE_ANCHOR_AND_REWRITE — anchor swap helps, but row also
  //                                 fails another check; reviewer
  //                                 must do both.
  //   NEEDS_REWRITE              — anchor failure with no shared
  //                                 noun in hook+whatToShow; full
  //                                 content rewrite required.
  //   NEEDS_REWRITE_FOR_SCORE    — anchor passed; score floor fails.
  //   NEEDS_REWRITE_FOR_COHERENCE — anchor passed; coherence fails.
  //   NEEDS_LENGTH_FIX           — length-bounds violation.
  const classify = (
    reasons: string[],
    suggested: string | null,
  ): string => {
    const hasAnchor = reasons.some((r) => r.includes("anchor '"));
    const hasScore = reasons.some((r) => r.includes("scoreNigerianPackEntry"));
    const hasCoherence = reasons.some(
      (r) =>
        r.includes("validateScenarioCoherence") &&
        !r.includes("show_missing_hook_anchor"),
    );
    const hasLength = reasons.some((r) => r.includes("out of bounds"));
    if (suggested && !hasScore && !hasCoherence && !hasLength) {
      return "REPLACE_ANCHOR_ONLY";
    }
    if (suggested) return "REPLACE_ANCHOR_AND_REWRITE";
    if (hasAnchor) return "NEEDS_REWRITE";
    if (hasScore) return "NEEDS_REWRITE_FOR_SCORE";
    if (hasCoherence) return "NEEDS_REWRITE_FOR_COHERENCE";
    if (hasLength) return "NEEDS_LENGTH_FIX";
    return "NEEDS_REVIEW";
  };

  const lines: string[] = [csvRow(header)];
  for (const { row, reasons, suggested, rationale, fromRewrite } of rejected) {
    const fixupAction = classify(reasons, suggested);
    lines.push(
      csvRow([
        row.draftId,
        row.currentPidginLevel,
        row.anchor,
        row.hook,
        row.whatToShow,
        suggested ?? "",
        fixupAction,
        rationale,
        fromRewrite ? "yes" : "no",
        reasons.join(" | "),
      ]),
    );
  }

  fs.writeFileSync(OUT_PATH, lines.join("\n") + "\n", "utf8");

  const byAction = new Map<string, number>();
  for (const r of rejected) {
    const action = classify(r.reasons, r.suggested);
    byAction.set(action, (byAction.get(action) ?? 0) + 1);
  }
  console.log(`[generateRejectionFixupSheet] wrote ${OUT_PATH}`);
  console.log(`[generateRejectionFixupSheet] rejected total: ${rejected.length}`);
  for (const [action, n] of [...byAction.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${action}: ${n}`);
  }
};

main();
