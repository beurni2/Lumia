/**
 * N1 PROMOTION REVIEW SHEET GENERATOR
 *
 * Read-only export tool. Reads `DRAFT_NIGERIAN_HOOK_PACK` and produces:
 *   - .local/REGIONAL_N1_PROMOTION_SHEET.md   (human review)
 *   - .local/REGIONAL_N1_PROMOTION_SHEET.csv  (spreadsheet review)
 *
 * Hard contract:
 *   - Does NOT modify the draft pool, the live pack, the validator,
 *     the activation guard, the env flag, or any generation behavior.
 *   - Does NOT fake review (every `reviewedBy` stays
 *     `PENDING_NATIVE_REVIEW`).
 *   - Pack stays DARK.
 *
 * The `suggestedPromotionTier`, `needsRewrite`, and `notes` columns
 * are HEURISTIC guidance for the native reviewer — never authoritative.
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

// ─── Heuristic vocabularies ──────────────────────────────────────
const NIGERIA_MARKERS: readonly string[] = [
  "nepa",
  "danfo",
  "keke",
  "okada",
  "garri",
  "indomie",
  "maggi",
  "naira",
  "oga",
  "aunty",
  "jollof",
  "abeg",
  "wahala",
  "mtn",
  "glo",
  "agbero",
  "oshodi",
  "ikeja",
  "lagos",
  "abuja",
  "pos",
  "dey",
  "una",
  "wetin",
  "bros",
  "biko",
  "ehen",
  "omo",
  "chai",
  "haba",
  "oyibo",
  "suya",
  "boli",
  "akara",
  "kobo",
  "1k",
  "2k",
  "5k",
  "wahalaa",
  "shey",
  "no gree",
  "no wahala",
  "i go",
  "you go",
  "we go",
  "make i",
  "make we",
  "don finish",
  "don show",
  "don turn",
  "don reduce",
  "don thaw",
  "i don",
  "you no go",
  "don buy",
  "don edit",
  "no dey",
  "go quick",
  "no worry",
  "every five minutes",
  "ekobi",
];

const containsNigeriaMarker = (text: string): boolean => {
  const t = text.toLowerCase();
  return NIGERIA_MARKERS.some((m) => t.includes(m));
};

// ─── Production-assert pre-flight (read-only mirror of live rule) ─
const passesProductionAnchorRule = (e: DraftNigerianPackEntry): boolean => {
  const a = e.anchor.toLowerCase();
  return e.hook.toLowerCase().includes(a) && e.whatToShow.toLowerCase().includes(a);
};

const matchesMockingPattern = (e: DraftNigerianPackEntry): RegExp | null => {
  for (const pat of PIDGIN_MOCKING_PATTERNS) {
    if (pat.test(e.hook) || pat.test(e.whatToShow) || pat.test(e.caption)) {
      return pat;
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

// ─── Duplicate / repetition signatures ───────────────────────────
const normalizeHook = (h: string): string =>
  h
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const fiveWordSig = (h: string): string =>
  normalizeHook(h).split(" ").slice(0, 5).join(" ");

const firstFifteenSig = (h: string): string =>
  normalizeHook(h).slice(0, 15);

// ─── Row shape ────────────────────────────────────────────────────
type SuggestedTier =
  | "pidgin"
  | "light_pidgin"
  | "rewrite_to_light_pidgin"
  | "keep_clean_baseline"
  | "reject";

type ReviewRow = {
  draftId: string;
  index: number;
  hook: string;
  whatToShow: string;
  howToFilm: string;
  caption: string;
  currentPidginLevel: DraftNigerianPackEntry["pidginLevel"];
  suggestedPromotionTier: SuggestedTier;
  anchor: string;
  domain: string;
  cluster: string;
  privacyNote: string;
  reviewedBy: string;
  needsRewrite: boolean;
  prodAnchorOk: boolean;
  mockingHit: boolean;
  fieldBoundsOk: boolean;
  duplicateOfDraftIds: readonly string[];
  notes: string;
  uniquenessScore: number;
};

const decideSuggestion = (
  e: DraftNigerianPackEntry,
): { tier: SuggestedTier; needsRewrite: boolean; reason: string } => {
  const anchorOk = passesProductionAnchorRule(e);
  const mocking = matchesMockingPattern(e);
  const boundsOk = passesFieldBounds(e);

  if (e.pidginLevel === "pidgin") {
    const needs = !anchorOk || mocking !== null || !boundsOk;
    const reasons: string[] = [];
    if (!anchorOk) reasons.push("anchor not in hook AND whatToShow");
    if (mocking) reasons.push(`mocking pattern (${mocking.source})`);
    if (!boundsOk) reasons.push("field length out of bounds");
    return {
      tier: "pidgin",
      needsRewrite: needs,
      reason: needs ? reasons.join("; ") : "ready for native review",
    };
  }

  if (e.pidginLevel === "light_pidgin") {
    const needs = !anchorOk || mocking !== null || !boundsOk;
    const reasons: string[] = [];
    if (!anchorOk) reasons.push("anchor not in hook AND whatToShow");
    if (mocking) reasons.push(`mocking pattern (${mocking.source})`);
    if (!boundsOk) reasons.push("field length out of bounds");
    return {
      tier: "light_pidgin",
      needsRewrite: needs,
      reason: needs ? reasons.join("; ") : "ready for native review",
    };
  }

  // pidginLevel === "clean"
  // Explicit reject branch: a clean entry caught by the mocking-spelling
  // regex, or under the production length floors, has no path forward —
  // even a rewrite would be starting from corrupt material. Surface as
  // `reject` so the reviewer skips it.
  if (mocking !== null) {
    return {
      tier: "reject",
      needsRewrite: false,
      reason: `clean entry caught by mocking pattern (${mocking.source}); reject from corpus`,
    };
  }
  if (!boundsOk) {
    return {
      tier: "reject",
      needsRewrite: false,
      reason: "clean entry violates production length bounds; reject from corpus",
    };
  }
  const nigeriaRooted =
    containsNigeriaMarker(e.hook) || containsNigeriaMarker(e.whatToShow);
  if (nigeriaRooted) {
    return {
      tier: "rewrite_to_light_pidgin",
      needsRewrite: true,
      reason:
        "scene is Nigeria-rooted; native reviewer should rewrite hook/caption to light_pidgin tier (pack rejects pidginLevel:clean)",
    };
  }
  return {
    tier: "keep_clean_baseline",
    needsRewrite: false,
    reason:
      "generic English; route via clean Nigerian R1 baseline, not the pack",
  };
};

// ─── Build rows ───────────────────────────────────────────────────
const padId = (i: number): string => `DRAFT-${String(i + 1).padStart(3, "0")}`;

const buildRows = (): ReviewRow[] => {
  // First pass: signatures and duplicate map.
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

  // Anchor + domain frequency for uniqueness scoring.
  const anchorCount = new Map<string, number>();
  const clusterCount = new Map<string, number>();
  for (const e of DRAFT_NIGERIAN_HOOK_PACK) {
    anchorCount.set(e.anchor, (anchorCount.get(e.anchor) ?? 0) + 1);
    clusterCount.set(e.cluster, (clusterCount.get(e.cluster) ?? 0) + 1);
  }

  return DRAFT_NIGERIAN_HOOK_PACK.map((e, i): ReviewRow => {
    const id = padId(i);
    const decision = decideSuggestion(e);
    const anchorOk = passesProductionAnchorRule(e);
    const mocking = matchesMockingPattern(e);
    const boundsOk = passesFieldBounds(e);

    const sig = fiveWordSig(e.hook);
    const prefix = firstFifteenSig(e.hook);
    const dups = new Set<string>();
    for (const other of sigToIds.get(sig) ?? []) if (other !== id) dups.add(other);
    for (const other of fifteenToIds.get(prefix) ?? []) if (other !== id) dups.add(other);

    // Uniqueness score: higher = better promotion candidate.
    let score = 100;
    if (e.pidginLevel === "pidgin") score += 15;
    else if (e.pidginLevel === "light_pidgin") score += 5;
    else score -= 10; // clean is not directly promotable
    if (decision.needsRewrite) score -= 25;
    if (decision.tier === "reject") score -= 80;
    if (decision.tier === "keep_clean_baseline") score -= 30;
    if (!anchorOk) score -= 20;
    if (mocking) score -= 40;
    if (!boundsOk) score -= 30;
    if (dups.size > 0) score -= 10 * Math.min(dups.size, 3);
    const ac = anchorCount.get(e.anchor) ?? 0;
    if (ac >= 8) score -= 10;
    else if (ac >= 5) score -= 5;
    const cc = clusterCount.get(e.cluster) ?? 0;
    if (cc >= 4) score -= 8;

    return {
      draftId: id,
      index: i,
      hook: e.hook,
      whatToShow: e.whatToShow,
      howToFilm: e.howToFilm,
      caption: e.caption,
      currentPidginLevel: e.pidginLevel,
      suggestedPromotionTier: decision.tier,
      anchor: e.anchor,
      domain: e.domain,
      cluster: e.cluster,
      privacyNote: e.privacyNote ?? "",
      reviewedBy: e.reviewedBy,
      needsRewrite: decision.needsRewrite,
      prodAnchorOk: anchorOk,
      mockingHit: mocking !== null,
      fieldBoundsOk: boundsOk,
      duplicateOfDraftIds: [...dups].sort(),
      notes: decision.reason,
      uniquenessScore: score,
    };
  });
};

// ─── CSV writer ───────────────────────────────────────────────────
const csvEscape = (v: string | number | boolean): string => {
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

const writeCsv = (rows: readonly ReviewRow[], outPath: string): void => {
  const header = [
    "draftId",
    "index",
    "hook",
    "whatToShow",
    "howToFilm",
    "caption",
    "currentPidginLevel",
    "suggestedPromotionTier",
    "anchor",
    "domain",
    "cluster",
    "privacyNote",
    "reviewedBy",
    "needsRewrite",
    "prodAnchorOk",
    "mockingHit",
    "fieldBoundsOk",
    "duplicateOfDraftIds",
    "uniquenessScore",
    "notes",
  ];
  const lines: string[] = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.draftId,
        r.index,
        r.hook,
        r.whatToShow,
        r.howToFilm,
        r.caption,
        r.currentPidginLevel,
        r.suggestedPromotionTier,
        r.anchor,
        r.domain,
        r.cluster,
        r.privacyNote,
        r.reviewedBy,
        r.needsRewrite,
        r.prodAnchorOk,
        r.mockingHit,
        r.fieldBoundsOk,
        r.duplicateOfDraftIds.join("|"),
        r.uniquenessScore,
        r.notes,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
};

// ─── Markdown writer ──────────────────────────────────────────────
const mdEscape = (s: string): string => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const trunc = (s: string, n: number): string =>
  s.length <= n ? s : s.slice(0, n - 1) + "…";

const tableRows = (
  rows: readonly ReviewRow[],
  cols: readonly (keyof ReviewRow)[],
  truncMap: Partial<Record<keyof ReviewRow, number>> = {},
): string[] => {
  const header = `| ${cols.join(" | ")} |`;
  const sep = `| ${cols.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => {
    const cells = cols.map((c) => {
      const v = r[c];
      const s = Array.isArray(v) ? (v as readonly string[]).join("|") : String(v);
      const t = truncMap[c] ? trunc(s, truncMap[c]!) : s;
      return mdEscape(t);
    });
    return `| ${cells.join(" | ")} |`;
  });
  return [header, sep, ...body];
};

const writeMarkdown = (rows: readonly ReviewRow[], outPath: string): void => {
  const total = rows.length;
  const cleanCount = rows.filter((r) => r.currentPidginLevel === "clean").length;
  const lightCount = rows.filter((r) => r.currentPidginLevel === "light_pidgin").length;
  const pidginCount = rows.filter((r) => r.currentPidginLevel === "pidgin").length;
  const activationEligible = lightCount + pidginCount;
  const withPrivacy = rows.filter((r) => r.privacyNote.length > 0).length;
  const needsRewrite = rows.filter((r) => r.needsRewrite).length;
  const mockingHits = rows.filter((r) => r.mockingHit).length;
  const anchorFails = rows.filter((r) => !r.prodAnchorOk).length;
  const dupAffected = rows.filter((r) => r.duplicateOfDraftIds.length > 0).length;

  // Suggestion buckets.
  const sugBuckets = new Map<SuggestedTier, number>();
  for (const r of rows) {
    sugBuckets.set(r.suggestedPromotionTier, (sugBuckets.get(r.suggestedPromotionTier) ?? 0) + 1);
  }

  // Anchor frequency table.
  const anchorFreq = new Map<string, number>();
  const domainFreq = new Map<string, number>();
  const clusterFreq = new Map<string, number>();
  for (const r of rows) {
    anchorFreq.set(r.anchor, (anchorFreq.get(r.anchor) ?? 0) + 1);
    domainFreq.set(r.domain, (domainFreq.get(r.domain) ?? 0) + 1);
    clusterFreq.set(r.cluster, (clusterFreq.get(r.cluster) ?? 0) + 1);
  }
  const sortDesc = (m: Map<string, number>): [string, number][] =>
    [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const repeatedAnchors = sortDesc(anchorFreq).filter(([, n]) => n >= 3);
  const repeatedClusters = sortDesc(clusterFreq).filter(([, n]) => n >= 2);
  const allDomains = sortDesc(domainFreq);

  // Promotion shortlists.
  const promotable = rows.filter(
    (r) =>
      r.suggestedPromotionTier === "pidgin" ||
      r.suggestedPromotionTier === "light_pidgin" ||
      r.suggestedPromotionTier === "rewrite_to_light_pidgin",
  );
  const top100 = [...promotable]
    .sort((a, b) => b.uniquenessScore - a.uniquenessScore || a.index - b.index)
    .slice(0, 100);

  const safest = rows.filter(
    (r) =>
      (r.currentPidginLevel === "light_pidgin" || r.currentPidginLevel === "pidgin") &&
      !r.needsRewrite &&
      r.prodAnchorOk &&
      !r.mockingHit &&
      r.fieldBoundsOk,
  );
  const top50Safest = [...safest]
    .sort((a, b) => b.uniquenessScore - a.uniquenessScore || a.index - b.index)
    .slice(0, 50);

  const weakReject = rows.filter(
    (r) =>
      r.suggestedPromotionTier === "reject" ||
      (r.duplicateOfDraftIds.length >= 2 && r.uniquenessScore < 70) ||
      r.mockingHit,
  );

  const nativePriority = [...rows]
    .filter(
      (r) =>
        r.currentPidginLevel === "pidgin" ||
        (r.currentPidginLevel === "light_pidgin" && !r.needsRewrite),
    )
    .sort((a, b) => {
      // Pidgin first, then by score, then by index.
      if (a.currentPidginLevel !== b.currentPidginLevel) {
        return a.currentPidginLevel === "pidgin" ? -1 : 1;
      }
      return b.uniquenessScore - a.uniquenessScore || a.index - b.index;
    })
    .slice(0, 50);

  const lines: string[] = [];
  lines.push("# REGIONAL N1 — Promotion Review Sheet");
  lines.push("");
  lines.push(
    "> **Read-only export.** Pack remains DARK. No entry in `DRAFT_NIGERIAN_HOOK_PACK`",
  );
  lines.push("> has been modified, promoted, or activated by this report.");
  lines.push(
    "> All `reviewedBy` values are still `PENDING_NATIVE_REVIEW`. The native reviewer is the",
  );
  lines.push("> sole authority on tier classification, mocking-spelling, and anchor validity.");
  lines.push("");
  lines.push("## Summary counts");
  lines.push("");
  lines.push(`- Total draft entries: **${total}**`);
  lines.push(`- Clean entries: **${cleanCount}**`);
  lines.push(`- Light pidgin entries: **${lightCount}**`);
  lines.push(`- Pidgin entries: **${pidginCount}**`);
  lines.push(`- Activation-eligible (light_pidgin + pidgin): **${activationEligible}**`);
  lines.push(`- Entries with privacy note: **${withPrivacy}**`);
  lines.push(`- Entries flagged needsRewrite: **${needsRewrite}**`);
  lines.push(`- Mocking-pattern hits (production assert would trip): **${mockingHits}**`);
  lines.push(`- Anchor-not-in-hook-AND-whatToShow (production assert would trip): **${anchorFails}**`);
  lines.push(`- Entries involved in 5-word / 15-char prefix duplicate clusters: **${dupAffected}**`);
  lines.push("");
  lines.push("### Suggested-tier breakdown");
  lines.push("");
  lines.push("| suggestedPromotionTier | count |");
  lines.push("| --- | --- |");
  for (const [tier, n] of [...sugBuckets.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${tier} | ${n} |`);
  }
  lines.push("");

  lines.push("## Domain distribution");
  lines.push("");
  lines.push("| domain | count |");
  lines.push("| --- | --- |");
  for (const [d, n] of allDomains) lines.push(`| ${d} | ${n} |`);
  lines.push("");

  lines.push("## Repeated anchors (≥3 occurrences)");
  lines.push("");
  if (repeatedAnchors.length === 0) lines.push("_None._");
  else {
    lines.push("| anchor | count |");
    lines.push("| --- | --- |");
    for (const [a, n] of repeatedAnchors) lines.push(`| ${a} | ${n} |`);
  }
  lines.push("");

  lines.push("## Repeated clusters (≥2 occurrences)");
  lines.push("");
  if (repeatedClusters.length === 0) lines.push("_None._");
  else {
    lines.push("| cluster | count |");
    lines.push("| --- | --- |");
    for (const [c, n] of repeatedClusters) lines.push(`| ${c} | ${n} |`);
  }
  lines.push("");

  lines.push("## Top 100 promotion candidates");
  lines.push("");
  lines.push(
    "_Ranked by `uniquenessScore` descending. Includes light_pidgin/pidgin tiers" +
      " AND clean entries flagged `rewrite_to_light_pidgin`. Native reviewer must" +
      " still re-tier and stamp `reviewedBy` before any entry can ship._",
  );
  lines.push("");
  lines.push.apply(
    lines,
    tableRows(
      top100,
      [
        "draftId",
        "currentPidginLevel",
        "suggestedPromotionTier",
        "uniquenessScore",
        "anchor",
        "domain",
        "cluster",
        "needsRewrite",
        "hook",
      ],
      { hook: 80 },
    ),
  );
  lines.push("");

  lines.push("## Top 50 safest activation candidates");
  lines.push("");
  lines.push(
    "_Subset of activation-eligible (light_pidgin / pidgin) that ALSO passes the" +
      " production anchor + mocking + length-band rules today. These are the" +
      " entries the reviewer can stamp with the least rewrite work — but stamping" +
      " is still a manual native-review step._",
  );
  lines.push("");
  if (top50Safest.length === 0) {
    lines.push("_No entries cleanly pass all production-assert preflight checks._");
  } else {
    lines.push.apply(
      lines,
      tableRows(
        top50Safest,
        [
          "draftId",
          "currentPidginLevel",
          "uniquenessScore",
          "anchor",
          "domain",
          "cluster",
          "hook",
        ],
        { hook: 80 },
      ),
    );
  }
  lines.push("");

  lines.push("## Weak / repetitive entries to reject");
  lines.push("");
  lines.push(
    "_Suggested `reject`, OR caught by a mocking pattern, OR part of a duplicate" +
      " cluster ≥2 with low uniqueness. Native reviewer makes the final call._",
  );
  lines.push("");
  if (weakReject.length === 0) {
    lines.push("_None flagged by heuristics._");
  } else {
    lines.push.apply(
      lines,
      tableRows(
        weakReject,
        [
          "draftId",
          "currentPidginLevel",
          "suggestedPromotionTier",
          "duplicateOfDraftIds",
          "mockingHit",
          "anchor",
          "hook",
          "notes",
        ],
        { hook: 70, notes: 60 },
      ),
    );
  }
  lines.push("");

  lines.push("## Native-review priority (top 50)");
  lines.push("");
  lines.push(
    "_Pidgin tier first (rarest in the corpus), then high-score light_pidgin." +
      " These are the entries whose review unlocks the most activation surface area._",
  );
  lines.push("");
  lines.push.apply(
    lines,
    tableRows(
      nativePriority,
      [
        "draftId",
        "currentPidginLevel",
        "uniquenessScore",
        "anchor",
        "cluster",
        "hook",
      ],
      { hook: 80 },
    ),
  );
  lines.push("");

  lines.push("## Full review table");
  lines.push("");
  lines.push(
    "_All 300 entries. For spreadsheet review use the companion CSV file._",
  );
  lines.push("");
  lines.push.apply(
    lines,
    tableRows(
      rows,
      [
        "draftId",
        "currentPidginLevel",
        "suggestedPromotionTier",
        "needsRewrite",
        "anchor",
        "domain",
        "cluster",
        "privacyNote",
        "reviewedBy",
        "hook",
        "notes",
      ],
      { hook: 70, notes: 60 },
    ),
  );
  lines.push("");

  fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf8");
};

// ─── Main ────────────────────────────────────────────────────────
const main = (): void => {
  const rows = buildRows();
  // Resolve repo-root .local regardless of pnpm cwd (file lives at
  // <repo>/artifacts/api-server/src/qa/nigerianPackPromotionSheet.ts).
  const here = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.resolve(here, "../../../../.local");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const mdPath = path.join(outDir, "REGIONAL_N1_PROMOTION_SHEET.md");
  const csvPath = path.join(outDir, "REGIONAL_N1_PROMOTION_SHEET.csv");
  writeMarkdown(rows, mdPath);
  writeCsv(rows, csvPath);

  // Console summary.
  const total = rows.length;
  const clean = rows.filter((r) => r.currentPidginLevel === "clean").length;
  const light = rows.filter((r) => r.currentPidginLevel === "light_pidgin").length;
  const pidgin = rows.filter((r) => r.currentPidginLevel === "pidgin").length;
  const promotable = rows.filter(
    (r) =>
      r.suggestedPromotionTier === "pidgin" ||
      r.suggestedPromotionTier === "light_pidgin" ||
      r.suggestedPromotionTier === "rewrite_to_light_pidgin",
  ).length;
  const safe = rows.filter(
    (r) =>
      (r.currentPidginLevel === "light_pidgin" || r.currentPidginLevel === "pidgin") &&
      !r.needsRewrite &&
      r.prodAnchorOk &&
      !r.mockingHit,
  ).length;
  const needsRewrite = rows.filter((r) => r.needsRewrite).length;

  // eslint-disable-next-line no-console
  console.log(
    `[nigerianPackPromotionSheet] ${total} entries → md=${mdPath} csv=${csvPath}\n` +
      `  tiers: clean=${clean} light_pidgin=${light} pidgin=${pidgin}\n` +
      `  promotion candidates: ${promotable}\n` +
      `  safe-to-stamp (activation-eligible & passes prod-assert preflight): ${safe}\n` +
      `  needs-rewrite flagged: ${needsRewrite}\n` +
      `  reviewedBy still ${PENDING_NATIVE_REVIEW} on every row (pack DARK)`,
  );

  // Sanity: confirm we did not mutate the draft pool.
  if (DRAFT_NIGERIAN_HOOK_PACK.some((e) => e.reviewedBy !== PENDING_NATIVE_REVIEW)) {
    throw new Error(
      "[nigerianPackPromotionSheet] FATAL: a draft entry has a non-sentinel reviewedBy",
    );
  }
};

main();
