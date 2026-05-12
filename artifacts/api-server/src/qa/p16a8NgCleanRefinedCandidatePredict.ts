/**
 * P16-A8 — NG_CLEAN REFINED CANDIDATE PREDICT/IMPORT HARNESS
 *
 * Read-only predict for the 12 supervisor-curated ng_clean refined
 * candidates (CLEAN_P16A8_REFINED_001..012). Mirrors the P16-A3
 * harness pattern verbatim — same validators, same scorer toggle,
 * same duplicate scan, same decision tree.
 *
 * Phase rules:
 *   - No authoring, rewriting, or improvement of any candidate.
 *   - No validator / scorer / floor / anti-copy / schema changes.
 *   - LUMINA_HQS_HUMAN_LIFT_ENABLED toggled in-process for this
 *     predict only; never written to production env.
 *   - PICKER_HQS_FLOOR=50 and HOOK_QUALITY_FLOOR=40 unchanged.
 *   - Reviewer stamp: BI-CLEAN-P16A8 2026-05-12 (supervisor-supplied).
 *   - ID assignment: sequential ng_clean_095..106 after the existing
 *     094 high-water-mark; 080/088 GAPS preserved (HELD). Supplied
 *     IDs preserved verbatim as draftId.
 *
 * Run from monorepo root:
 *   pnpm --filter @workspace/api-server exec tsx \
 *     src/qa/p16a8NgCleanRefinedCandidatePredict.ts
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import {
  scoreHookQualityDetailed,
  type HookQualityBreakdown,
} from "../lib/hookQuality.js";
import {
  NIGERIAN_CLEAN_CORE_ENTRIES,
  classifyNigerianCleanCoreEntryFailure,
  type NigerianCleanCoreEntry,
} from "../lib/nigerianCleanCorePack.js";
import { isNigerianCleanCoreHookBlocked } from "../lib/nigerianCleanCoreGuard.js";
import type { PremiseCoreFamily } from "../lib/premiseCoreLibrary.js";

const FLAG = "LUMINA_HQS_HUMAN_LIFT_ENABLED";
const REPORT_PATH = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  ".local",
  "P16_A8_NG_CLEAN_REFINED_CANDIDATE_PREDICT.md",
);
const FAMILY: PremiseCoreFamily = "self_betrayal";
const REVIEWED_BY = "BI-CLEAN-P16A8 2026-05-12";

interface Candidate extends Omit<NigerianCleanCoreEntry, "id"> {
  readonly suppliedId: string;
  readonly assignedId: string;
}

function entry(
  suppliedId: string,
  assignedId: string,
  anchor: string,
  hook: string,
  whatToShow: string,
  howToFilm: string,
  caption: string,
  premiseFamily: string,
  voiceTone: string,
): Candidate {
  return {
    suppliedId,
    assignedId,
    draftId: suppliedId,
    anchor,
    hook,
    whatToShow,
    howToFilm,
    caption,
    premiseFamily,
    voiceTone,
    reviewedBy: REVIEWED_BY,
  };
}

// Verbatim packet from P16-A8 user message. DO NOT EDIT.
const CANDIDATES: readonly Candidate[] = [
  entry(
    "CLEAN_P16A8_REFINED_001",
    "ng_clean_095",
    "visitor's bag",
    "The visitor's bag arrived with food expectations.",
    "The visitor's bag enters the house, and everyone quietly assumes something edible is inside. The visitor's bag sits in the room like a small promise nobody wants to mention.",
    "Show the visitor's bag being placed down, then cut to people casually glancing at it while pretending they are not interested.",
    "The bag carried hope.",
    "family_aunties",
    "clean_deadpan",
  ),
  entry(
    "CLEAN_P16A8_REFINED_002",
    "ng_clean_096",
    "account balance",
    "The account balance loaded and my posture changed.",
    "The account balance loads slowly while you sit with unnecessary confidence. The account balance appears, and your shoulders immediately remember humility.",
    "Keep the screen private; show the loading pause, then your shoulders dropping after the reveal.",
    "Balance adjusted the body.",
    "money_pos_bank",
    "quiet_realization_clean",
  ),
  entry(
    "CLEAN_P16A8_REFINED_003",
    "ng_clean_097",
    "transfer receipt",
    "The transfer receipt arrived before the money behaved.",
    "The transfer receipt appears instantly, but the money still refuses to show up. The transfer receipt gives everyone confidence except the person waiting.",
    "Show the transfer receipt notification, then cut to repeated balance checks and a calm but worried face.",
    "Receipt came alone.",
    "money_pos_bank",
    "clean_deadpan",
  ),
  entry(
    "CLEAN_P16A8_REFINED_004",
    "ng_clean_098",
    "market receipt",
    "The market receipt refused to match the bag.",
    "The market receipt is in your hand while you check the items in the bag. The market receipt says one thing, but the bag looks like it attended a different market.",
    "Film the market receipt beside the bag contents, then cut to your confused face counting items twice.",
    "The numbers disagreed quietly.",
    "market_food",
    "quiet_realization_clean",
  ),
  entry(
    "CLEAN_P16A8_REFINED_005",
    "ng_clean_099",
    "yam pieces",
    "The yam pieces shrank after my bargaining confidence.",
    "The yam pieces look respectable before the bargaining starts. After the price drops, the yam pieces in your hand suddenly look like they also negotiated.",
    "Show the cutting, the bargaining gesture, then a close-up of the smaller yam pieces in your palm.",
    "Bargain reduced the evidence.",
    "market_food",
    "clean_social_comedy",
  ),
  entry(
    "CLEAN_P16A8_REFINED_006",
    "ng_clean_100",
    "soup ingredients",
    "The soup ingredients disappeared before cooking began.",
    "The soup ingredients are arranged neatly on the table before cooking starts. Minutes later, the soup ingredients have developed gaps nobody in the house wants to explain.",
    "Use an overhead shot of the soup ingredients, then cut to empty spaces and one innocent person walking past.",
    "Cooking started with investigation.",
    "market_food",
    "clean_deadpan",
  ),
  entry(
    "CLEAN_P16A8_REFINED_007",
    "ng_clean_101",
    "room fan",
    "The room fan started its own family meeting.",
    "The room fan begins rattling loudly during a serious discussion. The room fan becomes the only thing everyone can agree to stare at.",
    "Start with a medium group shot, then tilt sharply to the noisy room fan while everyone pauses.",
    "Fan interrupted with authority.",
    "power_light",
    "clean_social_comedy",
  ),
  entry(
    "CLEAN_P16A8_REFINED_008",
    "ng_clean_102",
    "market list",
    "The market list grew heavier on the way home.",
    "The market list starts as a small folded paper in your hand. By the time you get home, the market list has somehow become extra bags and explanations.",
    "Show the market list before leaving, then cut to the overflowing bag and your tired arrival.",
    "Lists expand outside.",
    "market_food",
    "quiet_realization_clean",
  ),
  entry(
    "CLEAN_P16A8_REFINED_009",
    "ng_clean_103",
    "outfit adjustment",
    "The outfit adjustment refused to respect closing time.",
    "The outfit adjustment begins as one small correction after you thought everything was finished. The outfit adjustment continues until your patience starts standing separately from your body.",
    "Use a mirror shot with repeated pinning, then cut to your patient face slowly losing meaning.",
    "Adjustment enjoyed attention.",
    "tailoring_events",
    "quiet_realization_clean",
  ),
  entry(
    "CLEAN_P16A8_REFINED_010",
    "ng_clean_104",
    "data bundle",
    "The data bundle disappeared mid-sentence.",
    "The data bundle warning appears while you are speaking with confidence on a call. The data bundle disappears, and your words immediately start racing against silence.",
    "Show the phone warning, then cut to your face speeding through the sentence before the connection dies.",
    "Bundle chose drama.",
    "phone_data",
    "clean_absurd_escalation",
  ),
  entry(
    "CLEAN_P16A8_REFINED_011",
    "ng_clean_105",
    "market list",
    "The market list argued with inflation politely.",
    "The market list is from a time when prices still had manners. The market list meets the current shelf prices, and your wallet quietly loses confidence.",
    "Show the market list, then pan to the current prices and a slow zoom on your confused face.",
    "Math changed its behavior.",
    "market_food",
    "clean_social_comedy",
  ),
  entry(
    "CLEAN_P16A8_REFINED_012",
    "ng_clean_106",
    "phone battery",
    "The phone battery died before the apology finished.",
    "The phone battery is already low while you record a careful apology for being late. The phone battery dies before the apology reaches the important part.",
    "Close up on the voice note recording, then cut to the dead screen and your face realizing silence now looks suspicious.",
    "Silence became the excuse.",
    "phone_data",
    "clean_absurd_escalation",
  ),
];

interface HqsScored {
  readonly off: HookQualityBreakdown;
  readonly on: HookQualityBreakdown;
}

function scoreBoth(hook: string): HqsScored {
  const prev = process.env[FLAG];
  delete process.env[FLAG];
  const off = scoreHookQualityDetailed(hook, FAMILY);
  process.env[FLAG] = "1";
  const on = scoreHookQualityDetailed(hook, FAMILY);
  if (prev === undefined) {
    delete process.env[FLAG];
  } else {
    process.env[FLAG] = prev;
  }
  return { off, on };
}

function liftSignal(b: HookQualityBreakdown, key: string): number {
  const rec = b as unknown as Record<string, unknown>;
  const val = rec[key];
  return typeof val === "number" ? val : 0;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "in", "on", "at", "to",
  "for", "with", "by", "is", "was", "were", "be", "been", "being",
  "are", "i", "my", "me", "you", "your", "we", "our", "they",
  "them", "their", "this", "that", "these", "those", "it", "its",
  "as", "but", "from", "into", "than", "then", "so", "if", "not",
  "no", "yes", "do", "does", "did", "have", "has", "had", "will",
  "would", "could", "should",
]);

function tokens(text: string): string[] {
  const matched = text.toLowerCase().match(/\b[a-z0-9]+\b/g) ?? [];
  return matched.filter((t) => !STOPWORDS.has(t) && t.length > 1);
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

interface ClosestMatch {
  readonly id: string;
  readonly hook: string;
  readonly score: number;
}

function closestCorpusMatch(hook: string): ClosestMatch {
  const toks = tokens(hook);
  let best: ClosestMatch = { id: "n/a", hook: "", score: 0 };
  for (const e of NIGERIAN_CLEAN_CORE_ENTRIES) {
    const s = jaccard(toks, tokens(e.hook));
    if (s > best.score) best = { id: e.id, hook: e.hook, score: s };
  }
  return best;
}

function exactCorpusDuplicate(hook: string): string | null {
  const lc = hook.toLowerCase().trim();
  for (const e of NIGERIAN_CLEAN_CORE_ENTRIES) {
    if (e.hook.toLowerCase().trim() === lc) return e.id;
  }
  return null;
}

function intraBatchExactDup(
  rowIdx: number,
  hook: string,
): string | null {
  const lc = hook.toLowerCase().trim();
  for (let i = 0; i < CANDIDATES.length; i++) {
    if (i === rowIdx) continue;
    if (CANDIDATES[i].hook.toLowerCase().trim() === lc) {
      return CANDIDATES[i].suppliedId;
    }
  }
  return null;
}

function hookWordCount(hook: string): number {
  // Match the boot validator's split semantics exactly.
  return hook.trim().split(/\s+/).filter(Boolean).length;
}

interface Row {
  readonly suppliedId: string;
  readonly assignedId: string;
  readonly hook: string;
  readonly anchor: string;
  readonly premiseFamily: string;
  readonly voiceTone: string;
  readonly wordCount: number;
  readonly endsWithPeriod: boolean;
  readonly anchorInHook: boolean;
  readonly anchorInWhatToShow: boolean;
  readonly validatorResult: string;
  readonly shoutyBlocked: boolean;
  readonly exactCorpusDup: string | null;
  readonly intraDup: string | null;
  readonly closest: ClosestMatch;
  readonly scored: HqsScored;
  readonly bootPasses: boolean;
  readonly pickerPasses: boolean;
  readonly decision: "IMPORT" | "REJECT" | "HOLD";
  readonly decisionReason: string;
}

function analyze(c: Candidate, idx: number): Row {
  const constructed: NigerianCleanCoreEntry = {
    id: c.assignedId,
    draftId: c.draftId,
    anchor: c.anchor,
    hook: c.hook,
    whatToShow: c.whatToShow,
    howToFilm: c.howToFilm,
    caption: c.caption,
    premiseFamily: c.premiseFamily,
    voiceTone: c.voiceTone,
    reviewedBy: c.reviewedBy,
  };
  const validator = classifyNigerianCleanCoreEntryFailure(constructed);
  const shouty = isNigerianCleanCoreHookBlocked(c.hook);
  const wc = hookWordCount(c.hook);
  const ends = c.hook.trimEnd().endsWith(".");
  const anchorInHook = c.hook.toLowerCase().includes(c.anchor.toLowerCase());
  const anchorInShow = c.whatToShow.toLowerCase().includes(c.anchor.toLowerCase());
  const dup = exactCorpusDuplicate(c.hook);
  const intra = intraBatchExactDup(idx, c.hook);
  const closest = closestCorpusMatch(c.hook);
  const scored = scoreBoth(c.hook);
  const bootOn = (scored.on.total ?? 0) >= 40;
  const pickerOn = (scored.on.total ?? 0) >= 50;

  let decision: "IMPORT" | "REJECT" | "HOLD" = "IMPORT";
  let reason = "all_gates_passed";
  if (validator !== null) {
    decision = "REJECT";
    reason = `validator_failure:${validator}`;
  } else if (shouty) {
    decision = "REJECT";
    reason = "shouty_template_blocked_by_clean_core_guard";
  } else if (wc > 10) {
    decision = "REJECT";
    reason = `hook_word_count_${wc}_exceeds_cap_10`;
  } else if (!ends) {
    decision = "REJECT";
    reason = "hook_does_not_end_with_period";
  } else if (dup !== null) {
    decision = "REJECT";
    reason = `exact_duplicate_of_${dup}`;
  } else if (intra !== null) {
    decision = "REJECT";
    reason = `intra_batch_duplicate_of_${intra}`;
  } else if (!bootOn) {
    decision = "HOLD";
    reason = `held_below_boot_floor:hqs_on=${scored.on.total}_lt_40`;
  } else if (!pickerOn) {
    decision = "HOLD";
    reason = `held_below_picker_floor:hqs_on=${scored.on.total}_lt_50`;
  }

  return {
    suppliedId: c.suppliedId,
    assignedId: c.assignedId,
    hook: c.hook,
    anchor: c.anchor,
    premiseFamily: c.premiseFamily,
    voiceTone: c.voiceTone,
    wordCount: wc,
    endsWithPeriod: ends,
    anchorInHook,
    anchorInWhatToShow: anchorInShow,
    validatorResult: validator === null ? "PASS" : validator,
    shoutyBlocked: shouty,
    exactCorpusDup: dup,
    intraDup: intra,
    closest,
    scored,
    bootPasses: bootOn,
    pickerPasses: pickerOn,
    decision,
    decisionReason: reason,
  };
}

function buildReport(rows: readonly Row[]): string {
  const lines: string[] = [];
  lines.push("# P16-A8 — NG_CLEAN REFINED CANDIDATE PREDICT/IMPORT REPORT");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()} (read-only predict; importer is a separate edit step)`);
  lines.push("");
  lines.push("## Phase rules in force");
  lines.push("");
  lines.push("- No authoring, rewriting, or improvement of any candidate.");
  lines.push("- No validator / scorer / floor / anti-copy / schema changes.");
  lines.push("- `LUMINA_HQS_HUMAN_LIFT_ENABLED` toggled in-process for this predict only; never written to production env.");
  lines.push("- `PICKER_HQS_FLOOR=50` and `HOOK_QUALITY_FLOOR=40` both unchanged.");
  lines.push("- Reviewer stamp: `BI-CLEAN-P16A8 2026-05-12` (supervisor-supplied).");
  lines.push("- ID assignment: sequential `ng_clean_095..106` after the existing `094` high-water-mark; gaps `080` (HELD) and `088` (HELD) preserved per repo convention. Supplied IDs preserved verbatim as `draftId`.");
  lines.push("");

  lines.push("## Summary table");
  lines.push("");
  lines.push("| supplied | assigned | wc | end. | anchor∈hook | anchor∈show | validator | shouty | corpus-dup | intra-dup | OFF | ON | Δ | UA | ES | BW | boot≥40 | picker≥50 | decision |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of rows) {
    const off = r.scored.off.total ?? 0;
    const on = r.scored.on.total ?? 0;
    const delta = on - off;
    const ua = liftSignal(r.scored.on, "understatedAbsurdity");
    const es = liftSignal(r.scored.on, "emotionalSpecificity");
    const bw = liftSignal(r.scored.on, "brevityWideningDelta");
    lines.push(
      `| ${r.suppliedId} | ${r.assignedId} | ${r.wordCount} | ${r.endsWithPeriod ? "✓" : "✗"} | ${r.anchorInHook ? "✓" : "✗"} | ${r.anchorInWhatToShow ? "✓" : "✗"} | ${r.validatorResult} | ${r.shoutyBlocked ? "BLOCKED" : "ok"} | ${r.exactCorpusDup ?? "no"} | ${r.intraDup ?? "no"} | ${off} | ${on} | ${delta >= 0 ? "+" : ""}${delta} | ${ua} | ${es} | ${bw} | ${r.bootPasses ? "✓" : "✗"} | ${r.pickerPasses ? "✓" : "✗"} | **${r.decision}** |`,
    );
  }
  lines.push("");

  const importCount = rows.filter((r) => r.decision === "IMPORT").length;
  const rejectCount = rows.filter((r) => r.decision === "REJECT").length;
  const holdCount = rows.filter((r) => r.decision === "HOLD").length;
  const lifted = rows.filter(
    (r) => (r.scored.on.total ?? 0) > (r.scored.off.total ?? 0),
  );
  const negDelta = rows.filter(
    (r) => (r.scored.on.total ?? 0) < (r.scored.off.total ?? 0),
  );
  lines.push("## Aggregate decision tally");
  lines.push("");
  lines.push(`- **IMPORT:** ${importCount} / ${rows.length}`);
  lines.push(`- **REJECT (hard validator fail):** ${rejectCount} / ${rows.length}`);
  lines.push(`- **HOLD (passes validators but below scorer floor):** ${holdCount} / ${rows.length}`);
  lines.push(`- Lifted by P16-A1 flag (Δ>0): ${lifted.length} / ${rows.length} — ids: ${lifted.map((r) => r.suppliedId).join(", ") || "(none)"}`);
  lines.push(`- Negative deltas (Δ<0; expected 0 — P16-A1 is pure-positive): ${negDelta.length} / ${rows.length}`);
  lines.push("");

  lines.push("## Per-entry results");
  lines.push("");
  for (const r of rows) {
    const off = r.scored.off.total ?? 0;
    const on = r.scored.on.total ?? 0;
    const delta = on - off;
    lines.push(`### ${r.suppliedId} → ${r.assignedId}`);
    lines.push("");
    lines.push(`- **Hook:** ${r.hook}`);
    lines.push(`- **Anchor:** \`${r.anchor}\` · **premiseFamily:** \`${r.premiseFamily}\` · **voiceTone:** \`${r.voiceTone}\``);
    lines.push(`- **Word count:** ${r.wordCount} (cap ≤10) ${r.wordCount <= 10 ? "✓" : "✗"} · **ends with period:** ${r.endsWithPeriod ? "✓" : "✗"}`);
    lines.push(`- **Anchor in hook:** ${r.anchorInHook ? "✓" : "✗"} · **Anchor in whatToShow:** ${r.anchorInWhatToShow ? "✓" : "✗"}`);
    lines.push(`- **classifyNigerianCleanCoreEntryFailure:** ${r.validatorResult === "PASS" ? "**PASS**" : `**FAIL** (\`${r.validatorResult}\`)`}`);
    lines.push(`- **isNigerianCleanCoreHookBlocked (shouty-template):** ${r.shoutyBlocked ? "**BLOCKED**" : "ok"}`);
    lines.push(`- **Exact-duplicate vs corpus:** ${r.exactCorpusDup ?? "no"}`);
    lines.push(`- **Intra-batch exact duplicate:** ${r.intraDup ?? "no"}`);
    lines.push(`- **Closest corpus hook (token-Jaccard):** ${r.closest.score.toFixed(2)} vs \`${r.closest.id}\` — ${r.closest.hook ? `"${r.closest.hook}"` : "(none)"}`);
    lines.push(`- **HQS scoring:**`);
    lines.push(`  - Flag OFF total = **${off}** (boot ≥40 ${off >= 40 ? "✓" : "✗"}, picker ≥50 ${off >= 50 ? "✓" : "✗"})`);
    lines.push(`  - Flag ON  total = **${on}** (boot ≥40 ${r.bootPasses ? "✓" : "✗"}, picker ≥50 ${r.pickerPasses ? "✓" : "✗"})`);
    lines.push(`  - Δ = **${delta >= 0 ? "+" : ""}${delta}**`);
    const ua = liftSignal(r.scored.on, "understatedAbsurdity");
    const es = liftSignal(r.scored.on, "emotionalSpecificity");
    const bw = liftSignal(r.scored.on, "brevityWideningDelta");
    lines.push(`  - P16-A1 fired signals: UA=${ua}, ES=${es}, BW=${bw}`);
    lines.push(`- **DECISION: ${r.decision}** — ${r.decisionReason}`);
    lines.push("");
  }

  lines.push("## Confirmation");
  lines.push("");
  lines.push("- No corpus entries authored by coding agent (predict only).");
  lines.push("- No text rewritten — entries verbatim from supervisor packet.");
  lines.push("- Supplied IDs preserved as `draftId`; corpus IDs sequential after the 094 high-water-mark.");
  lines.push("- No validators / scorer / floors / anti-copy / schema / API / mobile / DB changed.");
  lines.push("- No production env flag enabled (`LUMINA_HQS_HUMAN_LIFT_ENABLED` toggled in-process only).");
  lines.push("- No fallback / Claude behavior changed.");
  lines.push("");

  return lines.join("\n");
}

function main(): void {
  const rows = CANDIDATES.map((c, i) => analyze(c, i));
  const report = buildReport(rows);
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, report, "utf-8");
  process.stdout.write(`P16-A8 predict report written: ${REPORT_PATH}\n`);
  const importCount = rows.filter((r) => r.decision === "IMPORT").length;
  const rejectCount = rows.filter((r) => r.decision === "REJECT").length;
  const holdCount = rows.filter((r) => r.decision === "HOLD").length;
  process.stdout.write(`IMPORT=${importCount} REJECT=${rejectCount} HOLD=${holdCount}\n`);
  for (const r of rows) {
    process.stdout.write(
      `  ${r.suppliedId} → ${r.assignedId}: ${r.decision} ` +
      `[v=${r.validatorResult} wc=${r.wordCount} OFF=${r.scored.off.total} ON=${r.scored.on.total}] ` +
      `${r.decision === "IMPORT" ? "" : "(" + r.decisionReason + ")"}\n`,
    );
  }
}

main();
