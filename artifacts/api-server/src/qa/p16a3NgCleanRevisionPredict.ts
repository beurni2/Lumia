/**
 * P16-A3 REVISION — NG_CLEAN HUMAN-BATCH REVISED PREDICT (READ-ONLY)
 *
 * Predict-only harness for the 15 supervisor-revised entries that
 * came back from the original P16-A3 rejected/held set. NO IMPORT
 * step is performed by this driver — the supervisor will issue a
 * separate import directive after reviewing the predict report.
 * Reviewer stamp on the constructed entries: BI-CLEAN-P16A3-REVISION
 * 2026-05-12 (matches the supervisor packet header).
 *
 * Original predict harness header preserved below for reference:
 *
 * P16-A3 — NG_CLEAN HUMAN-BATCH PREDICT/IMPORT HARNESS
 *
 * Read-only predict for the 20 supervisor-curated ng_clean human-feel
 * candidates (CLEAN_P16A2_HUMAN_001..020). Constructs full
 * NigerianCleanCoreEntry objects with the supplied metadata
 * (anchor / premiseFamily / voiceTone / reviewedBy) and the
 * supervisor-assigned next-sequential ng_clean IDs (075..094), then
 * runs every validator the live boot path runs:
 *
 *   - classifyNigerianCleanCoreEntryFailure (the full validator
 *     including anchor-in-hook + anchor-in-whatToShow + pidgin /
 *     stereotype / filming / shouty-template guards + word-count cap)
 *   - isNigerianCleanCoreHookBlocked (shouty-template guard)
 *   - exact + token-Jaccard duplicate scan vs the existing 69-entry
 *     corpus
 *   - HQS scoring with LUMINA_HQS_HUMAN_LIFT_ENABLED toggled OFF and
 *     ON in-process (env restored after the toggle)
 *
 * The harness DOES NOT mutate the corpus, DOES NOT enable the human-
 * lift flag in production env, and DOES NOT author/rewrite any
 * supplied text. Survivors are listed in the final report; the
 * supervisor (or the agent in a separate edit) lifts them into
 * NIGERIAN_CLEAN_CORE_ENTRIES verbatim.
 *
 * Run from monorepo root:
 *   pnpm --filter @workspace/api-server exec tsx \
 *     src/qa/p16a3NgCleanHumanBatchPredict.ts
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
  "P16_A3_NG_CLEAN_REVISION_PREDICT.md",
);
const FAMILY: PremiseCoreFamily = "self_betrayal";
const REVIEWED_BY = "BI-CLEAN-P16A3-REVISION 2026-05-12";

interface Candidate extends Omit<NigerianCleanCoreEntry, "id"> {
  readonly suppliedId: string; // CLEAN_P16A2_HUMAN_NNN — preserved as draftId
  readonly assignedId: string; // ng_clean_NNN — sequential after 074
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

// P16-A3 REVISION packet — 15 supervisor-revised entries (the
// originally rejected/held set). NO ID assignment in this predict
// pass — the packet asks only for predict-and-report; the supervisor
// will assign sequential ng_clean ids in a follow-up import step.
// `assignedId` here is a placeholder used only for the harness's
// constructed-entry id field (the id-presence validator simply
// requires a non-empty string; the duplicate scan is on hook text,
// not id).
const CANDIDATES: readonly Candidate[] = [
  entry(
    "CLEAN_P16A2_HUMAN_004",
    "ng_clean_revision_004",
    "family group chat",
    "The family group chat turned silence into evidence.",
    "The family group chat asks one simple question, and everyone suddenly becomes careful. You stare at the family group chat like silence itself has become suspicious.",
    "Show the message, read receipts, typing bubbles, and your face choosing peace while clearly panicking.",
    "Silence became suspicious.",
    "group_chats",
    "clean_absurd_escalation",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_005",
    "ng_clean_revision_005",
    "rice pot",
    "The rice pot judged everybody\u2019s portion story.",
    "The rice pot is almost empty, but everybody insists they only took a little. The rice pot becomes the only honest witness in the room.",
    "Show the rice pot, then cut to suspiciously full plates and innocent faces pretending nothing happened.",
    "Portion stories collapsed.",
    "market_food",
    "clean_social_comedy",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_006",
    "ng_clean_revision_006",
    "landlord greeting",
    "The landlord greeting carried rent inside it.",
    "A landlord greeting arrives as a polite \u201cgood morning,\u201d but you immediately understand the real message is rent. The landlord greeting changes the whole mood of your breakfast.",
    "Show tea or breakfast, phone buzz, the landlord greeting on screen, then a slow cup placement like peace has left.",
    "Good morning had rent.",
    "money_pos_bank",
    "quiet_realization_clean",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_007",
    "ng_clean_revision_007",
    "mirror",
    "The mirror judged my outfit without kindness.",
    "The mirror catches you admiring an outfit that clearly needed more honesty. You look at the mirror again and quietly remove one confident item.",
    "Start with a proud outfit check, pause at the mirror, then cut to you removing something with silent embarrassment.",
    "Mirror rejected the plan.",
    "creator_social_behavior",
    "self_aware_clean",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_008",
    "ng_clean_revision_008",
    "charger",
    "The charger betrayed me at four percent.",
    "The charger is nowhere to be found just as your phone reaches four percent. You search for the charger like the whole day now depends on one cable.",
    "Show the low battery warning, then frantic drawer, bag, and socket checks while your face gets more serious.",
    "Four percent changed me.",
    "phone_data",
    "clean_absurd_escalation",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_009",
    "ng_clean_revision_009",
    "market list",
    "The market list returned with extra responsibilities.",
    "The market list starts simple at home, but by the time you return, it has become bags, explanations, and surprise errands. The market list looks innocent, but your hands are full.",
    "Show the neat market list, then cut to overloaded bags and your confused face outside or in the kitchen.",
    "List gained responsibility.",
    "market_food",
    "clean_deadpan",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_010",
    "ng_clean_revision_010",
    "church shoes",
    "The church shoes exposed one wrinkled shirt.",
    "The church shoes look polished and ready, but one wrinkled shirt ruins the entire confidence. The church shoes seem more prepared than the person wearing them.",
    "Start with a proud close-up of the church shoes, then tilt up to the wrinkled shirt and a disappointed face.",
    "Shoes told the truth.",
    "tailoring_events",
    "clean_deadpan",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_011",
    "ng_clean_revision_011",
    "remote control",
    "The remote control appointed my uncle chairman.",
    "The remote control sits in your uncle\u2019s hand while everyone else pretends they still have channel opinions. The remote control turns the room into a quiet government.",
    "Show family members suggesting channels, then close up on the remote control staying firmly in one hand.",
    "Democracy lost signal.",
    "family_aunties",
    "clean_social_comedy",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_012",
    "ng_clean_revision_012",
    "delivery rider",
    "The delivery rider judged my slipper delay.",
    "The delivery rider is already outside while you are still looking for the correct slippers and change. The delivery rider waits with the face of someone who has seen this performance before.",
    "Film from behind a curtain or gate, show the delivery rider waiting, then cut to you searching drawers and slippers.",
    "Delivery exposed preparation.",
    "transport",
    "clean_deadpan",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_013",
    "ng_clean_revision_013",
    "school form",
    "The school form asked for childhood witnesses.",
    "The school form begins with simple details, then suddenly asks for information only your mother and an old folder could know. The school form turns one desk into family history.",
    "Start confidently filling the school form, then pause at one impossible field and slowly look around for help.",
    "Form entered family history.",
    "school_work",
    "clean_absurd_escalation",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_014",
    "ng_clean_revision_014",
    "laundry chair",
    "The laundry chair accepted full-time employment.",
    "The laundry chair starts with one shirt, then quietly becomes the main storage department in the room. The laundry chair looks more permanent every time you pass it.",
    "Use jump cuts as clothes pile onto the laundry chair, then show yourself walking past like the arrangement is official.",
    "Chair accepted inventory.",
    "family_aunties",
    "quiet_realization_clean",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_015",
    "ng_clean_revision_015",
    "charger",
    "The charger exposed the visitor\u2019s actual mission.",
    "The visitor greets warmly, but their eyes keep searching for the charger before they even sit down. The charger becomes the real reason for the visit.",
    "Show the greeting, then cut to the visitor scanning sockets, extension cords, and the charger.",
    "The visit needed charging.",
    "phone_data",
    "clean_social_comedy",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_017",
    "ng_clean_revision_017",
    "errand",
    "The errand multiplied before my slippers settled.",
    "The errand begins as one quick request, but relatives keep adding small things before you even leave. The errand becomes employment while your slippers are still at the door.",
    "Start with one instruction, then quick cuts of extra requests arriving as you reach for your slippers.",
    "Errand expanded outside.",
    "family_aunties",
    "clean_absurd_escalation",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_019",
    "ng_clean_revision_019",
    "gate",
    "The gate humbled my courage before knocking.",
    "The gate closes just as you finally gather courage to ask someone for something. The gate makes your rehearsed speech useless.",
    "Film the slow walk, the inhale before speaking, then the gate closing with perfect timing.",
    "Courage arrived late.",
    "family_aunties",
    "quiet_realization_clean",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_020",
    "ng_clean_revision_020",
    "chores",
    "The chores exposed everyone\u2019s emergency phone calls.",
    "The chores are mentioned in a lively room, and suddenly everyone remembers an urgent phone call. The chores reduce the population without anybody announcing it.",
    "Show a noisy room, one person mentions chores, then quick cuts of people vanishing into calls and doorways.",
    "Chores reduced attendance.",
    "family_aunties",
    "clean_social_comedy",
  ),
];

// ------------------------------------------------------------------ //
// HQS scoring helpers (mirrors P16-A2 toggle pattern)                 //
// ------------------------------------------------------------------ //

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

// Best-effort introspection of the human-lift signal contributions
// from the breakdown object. The fields are present on the P16-A1
// breakdown shape; if a field is absent we report 0 conservatively.
function liftSignal(b: HookQualityBreakdown, key: string): number {
  const rec = b as unknown as Record<string, unknown>;
  const val = rec[key];
  return typeof val === "number" ? val : 0;
}

// ------------------------------------------------------------------ //
// Token / duplicate helpers                                           //
// ------------------------------------------------------------------ //

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

function hookWordCount(hook: string): number {
  return (hook.match(/\b[\w\u2019']+\b/g) ?? []).length;
}

// ------------------------------------------------------------------ //
// Per-candidate analysis row                                          //
// ------------------------------------------------------------------ //

interface Row {
  readonly suppliedId: string;
  readonly assignedId: string;
  readonly hook: string;
  readonly anchor: string;
  readonly premiseFamily: string;
  readonly voiceTone: string;
  readonly wordCount: number;
  readonly endsWithPeriod: boolean;
  readonly validatorResult: string; // "PASS" or the failure code
  readonly shoutyBlocked: boolean;
  readonly exactDup: string | null;
  readonly closest: ClosestMatch;
  readonly scored: HqsScored;
  readonly bootPasses: boolean; // total >= 40
  readonly pickerPasses: boolean; // total >= 50
  readonly decision: "IMPORT" | "REJECT" | "HOLD";
  readonly decisionReason: string;
}

function analyze(c: Candidate): Row {
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
  const dup = exactCorpusDuplicate(c.hook);
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
    validatorResult: validator === null ? "PASS" : validator,
    shoutyBlocked: shouty,
    exactDup: dup,
    closest,
    scored,
    bootPasses: bootOn,
    pickerPasses: pickerOn,
    decision,
    decisionReason: reason,
  };
}

// ------------------------------------------------------------------ //
// Markdown report                                                     //
// ------------------------------------------------------------------ //

function buildReport(rows: readonly Row[]): string {
  const lines: string[] = [];
  lines.push("# P16-A3 — NG_CLEAN HUMAN-BATCH PREDICT/IMPORT REPORT");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()} (read-only predict; importer is a separate step)`);
  lines.push("");
  lines.push("## Phase rules in force");
  lines.push("");
  lines.push("- No authoring, rewriting, or improvement of any candidate.");
  lines.push("- No validator / scorer / floor / anti-copy / schema changes.");
  lines.push("- `LUMINA_HQS_HUMAN_LIFT_ENABLED` toggled in-process for this predict only; never written to production env.");
  lines.push("- `PICKER_HQS_FLOOR=50` and `HOOK_QUALITY_FLOOR=40` both unchanged.");
  lines.push("- Reviewer stamp: `BI-CLEAN-P16A3 2026-05-12` (supervisor-supplied).");
  lines.push("- ID assignment: sequential `ng_clean_075..094` after the existing 074 high-water-mark; supplied IDs preserved verbatim as `draftId`.");
  lines.push("");

  // Summary table first
  lines.push("## Summary table (one row per candidate)");
  lines.push("");
  lines.push("| supplied | assigned | wc | ends. | validator | shouty | dup | OFF | ON | Δ | UA | ES | BW | boot≥40 | picker≥50 | decision |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of rows) {
    const off = r.scored.off.total ?? 0;
    const on = r.scored.on.total ?? 0;
    const delta = on - off;
    const ua = liftSignal(r.scored.on, "understatedAbsurdity");
    const es = liftSignal(r.scored.on, "emotionalSpecificity");
    const bw = liftSignal(r.scored.on, "brevityWideningDelta");
    lines.push(
      `| ${r.suppliedId} | ${r.assignedId} | ${r.wordCount} | ${r.endsWithPeriod ? "✓" : "✗"} | ${r.validatorResult} | ${r.shoutyBlocked ? "BLOCKED" : "ok"} | ${r.exactDup ?? "no"} | ${off} | ${on} | ${delta >= 0 ? "+" : ""}${delta} | ${ua} | ${es} | ${bw} | ${r.bootPasses ? "✓" : "✗"} | ${r.pickerPasses ? "✓" : "✗"} | **${r.decision}** |`,
    );
  }
  lines.push("");

  // Aggregate counters
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

  // Per-entry detailed block
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
    lines.push(`- **classifyNigerianCleanCoreEntryFailure:** ${r.validatorResult === "PASS" ? "**PASS**" : `**FAIL** (\`${r.validatorResult}\`)`}`);
    lines.push(`- **isNigerianCleanCoreHookBlocked (shouty-template):** ${r.shoutyBlocked ? "**BLOCKED**" : "ok"}`);
    lines.push(`- **Exact-duplicate vs corpus:** ${r.exactDup ?? "no"}`);
    lines.push(`- **Closest corpus hook (token-Jaccard):** ${r.closest.score.toFixed(2)} vs \`${r.closest.id}\` — ${r.closest.hook ? `"${r.closest.hook}"` : "(none)"}`);
    lines.push(`- **HQS scoring:**`);
    lines.push(`  - Flag OFF total = **${off}** (boot ≥40 ${off >= 40 ? "✓" : "✗"}, picker ≥50 ${off >= 50 ? "✓" : "✗"})`);
    lines.push(`  - Flag ON  total = **${on}** (boot ≥40 ${r.bootPasses ? "✓" : "✗"}, picker ≥50 ${r.pickerPasses ? "✓" : "✗"})`);
    lines.push(`  - Δ = **${delta >= 0 ? "+" : ""}${delta}**`);
    lines.push(`  - UA=${liftSignal(r.scored.on, "understatedAbsurdity")}, ES=${liftSignal(r.scored.on, "emotionalSpecificity")}, BW=${liftSignal(r.scored.on, "brevityWideningDelta")}`);
    lines.push(`- **IMPORT DECISION: \`${r.decision}\`**`);
    lines.push(`  - Reason: \`${r.decisionReason}\``);
    lines.push("");
  }

  // Survivor block — exact code-ready text for the importer
  const survivors = rows.filter((r) => r.decision === "IMPORT");
  lines.push("## Survivors (eligible for import; pass every hard gate)");
  lines.push("");
  if (survivors.length === 0) {
    lines.push("(none)");
  } else {
    for (const r of survivors) {
      lines.push(`- \`${r.assignedId}\` ← \`${r.suppliedId}\` (anchor=\`${r.anchor}\`, premiseFamily=\`${r.premiseFamily}\`, voiceTone=\`${r.voiceTone}\`)`);
    }
  }
  lines.push("");

  // Rejected / held block
  const rejected = rows.filter((r) => r.decision === "REJECT");
  const held = rows.filter((r) => r.decision === "HOLD");
  lines.push("## Rejected (hard validator fail — NOT rewritten per P16-A3 rules)");
  lines.push("");
  if (rejected.length === 0) {
    lines.push("(none)");
  } else {
    for (const r of rejected) {
      lines.push(`- \`${r.suppliedId}\` — ${r.decisionReason}`);
    }
  }
  lines.push("");
  lines.push("## Held for supervisor review (passes validators but below scorer floor)");
  lines.push("");
  if (held.length === 0) {
    lines.push("(none)");
  } else {
    for (const r of held) {
      lines.push(`- \`${r.suppliedId}\` — ${r.decisionReason}`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

function main(): void {
  const rows = CANDIDATES.map(analyze);
  const md = buildReport(rows);
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, md, "utf8");
  // eslint-disable-next-line no-console
  console.log(`Wrote ${REPORT_PATH} (${rows.length} candidates analyzed)`);
  // eslint-disable-next-line no-console
  console.log(
    `Decisions: IMPORT=${rows.filter((r) => r.decision === "IMPORT").length} REJECT=${rows.filter((r) => r.decision === "REJECT").length} HOLD=${rows.filter((r) => r.decision === "HOLD").length}`,
  );
}

main();
