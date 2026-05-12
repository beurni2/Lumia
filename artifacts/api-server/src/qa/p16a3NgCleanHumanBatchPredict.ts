/**
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
  "P16_A3_NG_CLEAN_HUMAN_BATCH_PREDICT.md",
);
const FAMILY: PremiseCoreFamily = "self_betrayal";
const REVIEWED_BY = "BI-CLEAN-P16A3 2026-05-12";

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

const CANDIDATES: readonly Candidate[] = [
  entry(
    "CLEAN_P16A2_HUMAN_001",
    "ng_clean_075",
    "receipt",
    "The receipt exposed my confidence at checkout.",
    "You enter a shop with quiet confidence, picking items like someone who understands money. At checkout, the receipt prints and immediately changes your posture.",
    "Start with relaxed shopping shots, then cut to the receipt printing and your face slowly losing confidence.",
    "Receipt corrected my confidence.",
    "money_pos_bank",
    "clean_deadpan",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_002",
    "ng_clean_076",
    "tailor",
    "The tailor smiled and my deadline became spiritual.",
    "You arrive to collect clothes for an event, but the tailor\u2019s smile tells you the outfit is still a theory. You start calculating prayers, transport, and excuses.",
    "Show you entering confidently, then cut to unfinished fabric and the tailor\u2019s calm smile.",
    "Deadline entered prayer mode.",
    "tailoring_events",
    "clean_absurd_escalation",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_003",
    "ng_clean_077",
    "queue",
    "The queue humbled everyone who arrived with confidence.",
    "You reach a queue thinking you came early, then notice everyone else also came early with the same foolish hope.",
    "Show your confident arrival, then pan across the full queue and end on your face accepting defeat.",
    "Queue humbled the morning.",
    "transport",
    "clean_deadpan",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_004",
    "ng_clean_078",
    "family group chat",
    "The family group chat turned silence into evidence.",
    "Someone asks a simple family question in the group chat. Everyone who stays silent somehow becomes more suspicious than the people replying.",
    "Show the message, then cut between typing bubbles, read receipts, and your face choosing peace badly.",
    "Silence became suspicious.",
    "group_chats",
    "clean_absurd_escalation",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_005",
    "ng_clean_079",
    "rice pot",
    "The rice pot judged everybody\u2019s portion story.",
    "The pot is nearly empty, but every person insists they only took a little. The pot tells a different story.",
    "Show the pot, then cut to different plates and innocent faces around the room.",
    "Portion stories collapsed.",
    "market_food",
    "clean_social_comedy",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_006",
    "ng_clean_080",
    "landlord greeting",
    "My landlord\u2019s greeting carried rent inside it.",
    "You receive a polite \u201cgood morning\u201d from your landlord and immediately understand the message has another message inside it.",
    "Show a peaceful morning, phone buzz, message preview, then you slowly placing your cup down.",
    "Good morning had rent.",
    "family_aunties",
    "quiet_realization_clean",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_007",
    "ng_clean_081",
    "mirror",
    "The mirror reviewed my outfit without kindness.",
    "You dress with confidence, then the mirror calmly reveals that confidence was not evidence.",
    "Start with a proud outfit check, pause at the mirror, then remove one item with quiet shame.",
    "Mirror rejected the plan.",
    "creator_social_behavior",
    "self_aware_clean",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_008",
    "ng_clean_082",
    "charger",
    "The charger disappeared when battery became national security.",
    "Your phone reaches a dangerous percentage exactly when the charger decides to become invisible. Suddenly everyone\u2019s socket matters.",
    "Show low battery, frantic drawer searching, then you checking every outlet like a detective.",
    "Charger vanished professionally.",
    "phone_data",
    "clean_absurd_escalation",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_009",
    "ng_clean_083",
    "market list",
    "The market list returned with extra responsibilities.",
    "You leave with a simple list, but the market somehow adds items, favors, and explanations you never budgeted for.",
    "Show the neat list at home, then cut to overloaded bags and your confused face.",
    "List gained responsibility.",
    "market_food",
    "clean_deadpan",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_010",
    "ng_clean_084",
    "church shoes",
    "The church shoes reported my ironing failure.",
    "Your shoes look ready for service, but the rest of the outfit looks like it woke up late.",
    "Start with a proud shoe close-up, then tilt up to the wrinkled clothing detail.",
    "Shoes told the truth.",
    "tailoring_events",
    "clean_deadpan",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_011",
    "ng_clean_085",
    "remote control",
    "The remote controlled democracy from my uncle\u2019s hand.",
    "Everyone in the room has channel suggestions, but your uncle holds the remote like a constitutional office.",
    "Show people suggesting programs, then close-up on the remote staying firmly in one hand.",
    "Democracy lost signal.",
    "family_aunties",
    "clean_social_comedy",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_012",
    "ng_clean_086",
    "delivery rider",
    "The delivery rider waited with professional disappointment.",
    "You know the rider is outside, but you are still searching for slippers, change, and dignity. He waits like he has seen your type before.",
    "Film from behind the curtain, show him waiting, then cut to you searching drawers.",
    "Delivery exposed my preparation.",
    "transport",
    "clean_deadpan",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_013",
    "ng_clean_087",
    "school form",
    "The school form asked for my childhood witnesses.",
    "You open a form expecting basic details, then it starts asking for information only your mother and an old folder could possibly remember.",
    "Start confidently filling the form, then pause at one impossible field and slowly look around for help.",
    "Form entered family history.",
    "school_work",
    "clean_absurd_escalation",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_014",
    "ng_clean_088",
    "laundry chair",
    "The laundry chair became a quiet warehouse.",
    "One clean shirt lands on the chair, then another, until the chair quietly becomes the main storage system in the room.",
    "Use jump cuts as clothes pile up, then show yourself walking past it like the arrangement is official.",
    "Chair accepted inventory.",
    "family_aunties",
    "quiet_realization_clean",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_015",
    "ng_clean_089",
    "charger",
    "The visitor located the charger before greeting properly.",
    "A guest arrives smiling, but their eyes are already scanning the wall sockets before they even sit down.",
    "Show the handshake or greeting, then cut to their eyes moving toward sockets, extension cords, and your charger.",
    "The visit needed charging.",
    "phone_data",
    "clean_social_comedy",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_016",
    "ng_clean_090",
    "soup",
    "The soup exposed everybody\u2019s fake small appetite.",
    "Everyone claims they are \u201cnot that hungry,\u201d but the soup reduces faster than honesty can explain.",
    "Show the full bowl, then quick cuts of people serving \u201csmall\u201d portions that are clearly not small.",
    "Appetite denied responsibility.",
    "market_food",
    "clean_social_comedy",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_017",
    "ng_clean_091",
    "errand",
    "The errand wore slippers and became employment.",
    "You agree to one quick errand, then each relative adds something small until the errand starts looking like a full shift.",
    "Start with one simple instruction, then show extra requests arriving as you reach for your slippers.",
    "Errand expanded outside.",
    "family_aunties",
    "clean_absurd_escalation",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_018",
    "ng_clean_092",
    "meeting",
    "The meeting ended and left another meeting behind.",
    "Everyone says the meeting is over, but the final decision is to schedule another meeting with even less hope.",
    "Show relief as people close notebooks, then a message or calendar invite appearing immediately.",
    "Meeting gave birth quietly.",
    "school_work",
    "clean_deadpan",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_019",
    "ng_clean_093",
    "gate",
    "The gate closed before my courage finished loading.",
    "You finally decide to ask someone for something, rehearse your words, and reach the gate just as it closes.",
    "Film the slow confident walk, the inhale before speaking, then the gate closing with perfect timing.",
    "Courage arrived late.",
    "family_aunties",
    "quiet_realization_clean",
  ),
  entry(
    "CLEAN_P16A2_HUMAN_020",
    "ng_clean_094",
    "chores",
    "The house disappeared when chores entered conversation.",
    "The room is full and loud until someone mentions chores. Suddenly everyone has a call, a bathroom trip, or urgent silence.",
    "Show a lively room, one person mentions chores, then quick cuts of people vanishing.",
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
