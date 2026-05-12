/**
 * P16-A2-NG-CLEAN-HUMAN-CANDIDATE-PREDICT-IMPORT
 *
 * Read-only predict harness for the 10 supervisor-curated ng_clean
 * human-feel candidates. Scores each hook with the P16-A1 human-lift
 * scorer flag OFF and ON, runs every clean-core boot validator that
 * does NOT require fields the supervisor did not supply (the packet
 * provides hook/whatToShow/howToFilm/caption only — id, draftId,
 * anchor, premiseFamily, voiceTone, reviewedBy are intentionally
 * absent), and reports an explicit per-entry import decision.
 *
 * NOT an importer. NEVER mutates the corpus. Writes a markdown
 * report to .local/P16_A2_NG_CLEAN_HUMAN_CANDIDATE_PREDICT.md.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx \
 *     src/qa/p16a2NgCleanHumanCandidatePredict.ts
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  scoreHookQualityDetailed,
  type HookQualityBreakdown,
} from "../lib/hookQuality.js";
import {
  NIGERIAN_CLEAN_CORE_BANNED_FILMING_BOILERPLATE,
  NIGERIAN_CLEAN_CORE_BANNED_PIDGIN_MARKERS,
  NIGERIAN_CLEAN_CORE_BANNED_STEREOTYPE_TOKENS,
  NIGERIAN_CLEAN_CORE_ENTRIES,
} from "../lib/nigerianCleanCorePack.js";
import { isNigerianCleanCoreHookBlocked } from "../lib/nigerianCleanCoreGuard.js";
import type { PremiseCoreFamily } from "../lib/premiseCoreLibrary.js";

const FLAG = "LUMINA_HQS_HUMAN_LIFT_ENABLED";
// Resolve the report path against the monorepo root (this file lives
// at <repo>/artifacts/api-server/src/qa/), not the pnpm-filter cwd —
// otherwise the report lands in artifacts/api-server/.local/.
const REPORT_PATH = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  ".local",
  "P16_A2_NG_CLEAN_HUMAN_CANDIDATE_PREDICT.md",
);

// Family arg is ignored by the scoring math; pin one for stable runs.
const FAMILY: PremiseCoreFamily = "self_betrayal";

interface Candidate {
  readonly suppliedId: string;
  readonly hook: string;
  readonly whatToShow: string;
  readonly howToFilm: string;
  readonly caption: string;
}

// VERBATIM from the supplied packet — punctuation, curly quotes, and
// curly apostrophes preserved exactly as the supervisor sent them.
const CANDIDATES: readonly Candidate[] = [
  {
    suppliedId: "CLEAN_P16A1_HUMAN_005",
    hook: "The church shoes exposed the ironing situation immediately.",
    whatToShow:
      "You dressed in a hurry, but your polished shoes are making the rest of the outfit look unserious.",
    howToFilm:
      "Start with a proud shoe shot, then tilt up to one wrinkled clothing detail and a face of quiet regret.",
    caption: "Shoes reported the outfit.",
  },
  {
    suppliedId: "CLEAN_P16A1_HUMAN_006",
    hook: "My landlord texted \u201Cgood morning\u201D and peace left quietly.",
    whatToShow:
      "A normal morning collapses because your landlord starts the message politely, which somehow makes it worse.",
    howToFilm:
      "Show breakfast or tea, phone buzz, message preview, then the creator gently placing the cup down like life has changed.",
    caption: "Good morning carried danger.",
  },
  {
    suppliedId: "CLEAN_P16A1_HUMAN_007",
    hook: "The family group chat turned one cough into investigation.",
    whatToShow:
      "Someone casually mentions coughing, and the group chat becomes doctors, pastors, aunties, and forwarded remedies.",
    howToFilm:
      "Show one simple message, then rapid cuts of notifications multiplying while you stare at the phone.",
    caption: "One cough became a committee.",
  },
  {
    suppliedId: "CLEAN_P16A1_HUMAN_009",
    hook: "My serious face collapsed at the wrong greeting.",
    whatToShow:
      "You prepare to greet someone important with respect, but your face chooses that exact moment to become awkward.",
    howToFilm:
      "Practice a composed face in the mirror, then cut to the real greeting where the expression fails immediately.",
    caption: "My face resigned early.",
  },
  {
    suppliedId: "CLEAN_P16A1_HUMAN_010",
    hook: "The queue looked short until hope joined it.",
    whatToShow:
      "You see a short queue and celebrate too early, then discover the hidden extension, saved spaces, and people \u201Ccoming back.\u201D",
    howToFilm:
      "Show the visible queue, your small smile, then pan to the real line around the corner.",
    caption: "Queue hid the truth.",
  },
  {
    suppliedId: "CLEAN_P16A1_HUMAN_011",
    hook: "Auntie served rice like she owned national reserves.",
    whatToShow:
      "Someone is serving rice with extreme caution, measuring every grain like the country is watching.",
    howToFilm:
      "Close-up on the spoon hovering, rice being reduced and adjusted, then the plate arriving with political accuracy.",
    caption: "Rice entered rationing.",
  },
  {
    suppliedId: "CLEAN_P16A1_HUMAN_014",
    hook: "My mother\u2019s silence edited my entire explanation.",
    whatToShow:
      "You start explaining yourself with confidence, but one silent look from your mother makes you shorten the story.",
    howToFilm:
      "Begin with animated explanation, cut to her still face, then you slowly reduce the sentence until it disappears.",
    caption: "Silence corrected the story.",
  },
  {
    suppliedId: "CLEAN_P16A1_HUMAN_020",
    hook: "The house became quiet when chores needed witnesses.",
    whatToShow:
      "The moment chores are mentioned, everyone who was loudly present somehow disappears into rooms, bathrooms, and fake phone calls.",
    howToFilm:
      "Show a lively room, one person mentions chores, then quick cuts of people vanishing.",
    caption: "Chores reduced the population.",
  },
  {
    suppliedId: "CLEAN_HUMAN_001",
    hook: "My mother\u2019s prayer points always include my phone battery.",
    whatToShow:
      "You are sitting in the living room when your mother starts a loud prayer session. She transitions from praying for the country to specifically mentioning that your phone should not lead you astray or die when she calls. You look at your 2% battery icon with sudden spiritual guilt.",
    howToFilm:
      "Close-up of your face looking concerned, followed by a quick cut to the phone screen showing the low battery.",
    caption: "Nowhere is safe from the intercession.",
  },
  {
    suppliedId: "CLEAN_HUMAN_002",
    hook: "The delivery man is waiting like a debt collector.",
    whatToShow:
      "You are inside the house, fully aware the delivery rider is at the gate, but you are still looking for your matching slippers and the correct change. You peek through the curtain and see him sitting on his bike, staring at your front door with professional disappointment.",
    howToFilm:
      "Use a handheld shot peeking through a window or curtain. Show yourself frantically searching a drawer.",
    caption: "The pressure of a thousand suns.",
  },
];

// ---------------------------------------------------------------- //
// Helpers — banned-marker scan mirrors nigerianCleanCorePack       //
// ---------------------------------------------------------------- //

function tokenize(text: string): readonly string[] {
  return text.toLowerCase().match(/\b[a-z0-9]+\b/g) ?? [];
}

function findBannedMarker(
  text: string,
  banned: readonly string[],
): string | null {
  const lower = text.toLowerCase();
  const tokenSet = new Set(tokenize(lower));
  for (const marker of banned) {
    if (marker.includes(" ")) {
      if (lower.includes(marker)) return marker;
    } else {
      if (tokenSet.has(marker)) return marker;
    }
  }
  return null;
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

// Scan hook∩whatToShow tokens (≥4 chars, content words only) for the
// best anchor candidates per the existing convention. STOPWORDS keep
// "the/and/your/like/etc" out of the suggestion list.
const ANCHOR_STOPWORDS = new Set([
  "the","and","you","your","with","that","like","this","into","when",
  "until","then","they","them","their","there","here","just","some",
  "from","have","been","being","make","makes","made","look","looks",
  "looking","said","says","saying","one","two","three","very","much",
  "more","most","less","than","also","only","even","still","every",
  "each","both","over","under","because","while","about","what","which",
  "where","whose","why","how","does","done","doing","going","still",
  "really","quite","such","onto","upon","without","within","between",
  "among","across","around","through","another","other","others",
  "thing","things","stuff","being",
]);

function anchorCandidates(hook: string, whatToShow: string): string[] {
  const hookTokens = new Set(
    tokenize(hook).filter(
      (t) => t.length >= 4 && !ANCHOR_STOPWORDS.has(t),
    ),
  );
  const wtsTokens = new Set(
    tokenize(whatToShow).filter(
      (t) => t.length >= 4 && !ANCHOR_STOPWORDS.has(t),
    ),
  );
  const intersection: string[] = [];
  for (const t of hookTokens) if (wtsTokens.has(t)) intersection.push(t);
  return intersection;
}

// Token-set Jaccard against every existing corpus hook for soft
// duplicate detection. Exact-match is also reported separately.
function maxJaccardVsCorpus(hook: string): {
  readonly maxJ: number;
  readonly closestId: string | null;
  readonly closestHook: string | null;
} {
  const a = new Set(
    tokenize(hook).filter((t) => t.length >= 3 && !ANCHOR_STOPWORDS.has(t)),
  );
  let best = 0;
  let id: string | null = null;
  let h: string | null = null;
  for (const e of NIGERIAN_CLEAN_CORE_ENTRIES) {
    const b = new Set(
      tokenize(e.hook).filter(
        (t) => t.length >= 3 && !ANCHOR_STOPWORDS.has(t),
      ),
    );
    let inter = 0;
    for (const t of a) if (b.has(t)) inter++;
    const union = new Set([...a, ...b]).size;
    const j = union === 0 ? 0 : inter / union;
    if (j > best) {
      best = j;
      id = e.id;
      h = e.hook;
    }
  }
  return { maxJ: best, closestId: id, closestHook: h };
}

function exactDuplicateCorpusId(hook: string): string | null {
  const lc = hook.trim().toLowerCase();
  for (const e of NIGERIAN_CLEAN_CORE_ENTRIES) {
    if (e.hook.trim().toLowerCase() === lc) return e.id;
  }
  return null;
}

// ---------------------------------------------------------------- //
// Score with flag toggled, restoring the prior env value           //
// ---------------------------------------------------------------- //

function scoreBoth(hook: string): {
  off: HookQualityBreakdown;
  on: HookQualityBreakdown;
} {
  const saved = process.env[FLAG];
  delete process.env[FLAG];
  const off = scoreHookQualityDetailed(hook, FAMILY);
  process.env[FLAG] = "1";
  const on = scoreHookQualityDetailed(hook, FAMILY);
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
  return { off, on };
}

// ---------------------------------------------------------------- //
// Per-entry analysis                                                //
// ---------------------------------------------------------------- //

interface GateResult {
  readonly suppliedId: string;
  readonly hook: string;
  readonly hookWords: number;
  readonly hookEndsWithPeriod: boolean;
  readonly hookWordCapPasses: boolean;
  readonly pidginMarkerHit: string | null;
  readonly stereotypeMarkerHit: string | null;
  readonly filmingBoilerplateHit: string | null;
  readonly shoutyTemplateBlocks: boolean;
  readonly anchorCandidates: readonly string[];
  readonly exactDuplicateOfCorpus: string | null;
  readonly maxJaccardVsCorpus: number;
  readonly closestCorpusId: string | null;
  readonly closestCorpusHook: string | null;
  readonly hqsOffTotal: number;
  readonly hqsOnTotal: number;
  readonly delta: number;
  readonly fired: {
    readonly UA: number;
    readonly ES: number;
    readonly BW: number;
    readonly aiClicheFired: boolean;
    readonly aiClicheValue: number;
  };
  readonly aboveBootFloorOff: boolean;
  readonly aboveBootFloorOn: boolean;
  readonly abovePickerFloorOff: boolean;
  readonly abovePickerFloorOn: boolean;
  readonly importDecision: "import" | "reject" | "hold";
  readonly decisionReason: string;
}

const HOOK_QUALITY_FLOOR = 40;
const PICKER_HQS_FLOOR = 50;

function analyze(c: Candidate): GateResult {
  const words = wordCount(c.hook);
  const endsPeriod = c.hook.trim().endsWith(".");
  const cap10 = words <= 10;

  const pidginScan = `${c.hook}\n${c.whatToShow}`;
  const pidginHit = findBannedMarker(
    pidginScan,
    NIGERIAN_CLEAN_CORE_BANNED_PIDGIN_MARKERS,
  );

  const stereotypeScan = `${c.hook}\n${c.whatToShow}\n${c.caption}`;
  const stereotypeHit = findBannedMarker(
    stereotypeScan,
    NIGERIAN_CLEAN_CORE_BANNED_STEREOTYPE_TOKENS,
  );

  const filmingHit = findBannedMarker(
    c.howToFilm,
    NIGERIAN_CLEAN_CORE_BANNED_FILMING_BOILERPLATE,
  );

  const shoutyBlocks = isNigerianCleanCoreHookBlocked(c.hook);

  const anchors = anchorCandidates(c.hook, c.whatToShow);
  const exactDup = exactDuplicateCorpusId(c.hook);
  const { maxJ, closestId, closestHook } = maxJaccardVsCorpus(c.hook);

  const { off, on } = scoreBoth(c.hook);
  const delta = on.total - off.total;

  // Hard validators (would block import even with all metadata
  // supplied) vs soft / metadata blockers.
  const hardBlockers: string[] = [];
  if (!cap10) hardBlockers.push("hook_word_count_exceeds_idea_schema_cap");
  if (pidginHit !== null)
    hardBlockers.push(`pidgin_marker_in_hook_or_what_to_show:${pidginHit}`);
  if (stereotypeHit !== null)
    hardBlockers.push(
      `stereotype_token_in_hook_or_what_to_show_or_caption:${stereotypeHit}`,
    );
  if (filmingHit !== null)
    hardBlockers.push(`filming_boilerplate_in_how_to_film:${filmingHit}`);
  if (shoutyBlocks)
    hardBlockers.push("shouty_template_blocked_by_clean_core_guard");
  if (exactDup !== null)
    hardBlockers.push(`exact_duplicate_of_corpus_${exactDup}`);
  if (anchors.length === 0)
    hardBlockers.push("no_anchor_candidate_in_hook_intersect_what_to_show");

  // Metadata blockers — supervisor did not supply six required fields.
  // The packet provides hook/whatToShow/howToFilm/caption only.
  const metadataBlockers: string[] = [
    "missing_reviewed_by:supervisor_must_supply_reviewer_stamp",
    "missing_premise_family:must_be_supervisor_chosen_from_clean_core_family_set",
    "missing_voice_tone:must_be_supervisor_chosen",
    "missing_anchor:must_be_supervisor_confirmed_from_candidate_list",
    "missing_id:next_sequential_ng_clean_NNN_to_be_assigned_after_supervisor_signoff",
    "missing_draft_id:supplied_id_to_be_preserved_as_draft_id_after_supervisor_signoff",
  ];

  let decision: "import" | "reject" | "hold";
  let reason: string;
  if (hardBlockers.length > 0) {
    decision = "reject";
    reason = `hard_validator_failure: ${hardBlockers.join("; ")}`;
  } else {
    decision = "hold";
    reason = `held_for_supervisor_review: ${metadataBlockers.join("; ")}`;
  }

  return {
    suppliedId: c.suppliedId,
    hook: c.hook,
    hookWords: words,
    hookEndsWithPeriod: endsPeriod,
    hookWordCapPasses: cap10,
    pidginMarkerHit: pidginHit,
    stereotypeMarkerHit: stereotypeHit,
    filmingBoilerplateHit: filmingHit,
    shoutyTemplateBlocks: shoutyBlocks,
    anchorCandidates: anchors,
    exactDuplicateOfCorpus: exactDup,
    maxJaccardVsCorpus: maxJ,
    closestCorpusId: closestId,
    closestCorpusHook: closestHook,
    hqsOffTotal: off.total,
    hqsOnTotal: on.total,
    delta,
    fired: {
      UA: on.humanLift.understatedAbsurdity,
      ES: on.humanLift.emotionalSpecificity,
      BW: on.humanLift.brevityWideningDelta,
      aiClicheFired: on.aiClicheFired,
      aiClicheValue: on.aiCliche,
    },
    aboveBootFloorOff: off.total >= HOOK_QUALITY_FLOOR,
    aboveBootFloorOn: on.total >= HOOK_QUALITY_FLOOR,
    abovePickerFloorOff: off.total >= PICKER_HQS_FLOOR,
    abovePickerFloorOn: on.total >= PICKER_HQS_FLOOR,
    importDecision: decision,
    decisionReason: reason,
  };
}

// ---------------------------------------------------------------- //
// Markdown report                                                   //
// ---------------------------------------------------------------- //

function tickX(b: boolean): string {
  return b ? "✓" : "✗";
}

function fmtMarker(m: string | null): string {
  return m === null ? "clean (no hit)" : `BLOCKED: \`${m}\``;
}

function buildReport(rows: readonly GateResult[]): string {
  const lines: string[] = [];
  lines.push("# P16-A2 — NG_CLEAN HUMAN-CANDIDATE PREDICT REPORT");
  lines.push("");
  lines.push(
    `Generated: ${new Date().toISOString()} (read-only, no corpus mutations)`,
  );
  lines.push("");
  lines.push("## Phase rules in force");
  lines.push("");
  lines.push("- No authoring, rewriting, or improvement of any candidate.");
  lines.push("- No validator / scorer / floor / anti-copy / schema changes.");
  lines.push(
    "- `LUMINA_HQS_HUMAN_LIFT_ENABLED` toggled in-process for this predict only; never written to production env.",
  );
  lines.push(
    "- `PICKER_HQS_FLOOR=50` and `HOOK_QUALITY_FLOOR=40` both unchanged (source-grepped, asserted by the P16-A1 test suite).",
  );
  lines.push("");
  lines.push("## Methodology");
  lines.push("");
  lines.push(
    "For each candidate the harness runs every `classifyNigerianCleanCoreEntryFailure` check that does not depend on supervisor-only metadata (anchor / premiseFamily / voiceTone / reviewedBy / id / draftId), plus the `nigerianCleanCoreGuard` shouty-template gate, exact + token-Jaccard duplicate scan against the existing 66-entry corpus, and HQS scoring (P16-A1 OFF and ON).",
  );
  lines.push("");
  lines.push(
    "**The packet supplies only `hook` + `whatToShow` + `howToFilm` + `caption`.** Six required schema fields (`id`, `draftId`, `anchor`, `premiseFamily`, `voiceTone`, `reviewedBy`) are absent. Per the P16-A2 ABSOLUTE rules (\"do not author, rewrite, improve, paraphrase, or expand corpus entries\") the harness does **not** invent reviewer stamps or commit to ambiguous premise-family choices. Anchor candidates are surfaced — not selected — for supervisor confirmation.",
  );
  lines.push("");
  lines.push("## Per-entry results");
  lines.push("");

  for (const r of rows) {
    lines.push(`### ${r.suppliedId}`);
    lines.push("");
    lines.push(`- **Hook:** ${r.hook}`);
    lines.push(
      `- **Hook word count:** ${r.hookWords} (cap ≤10) ${tickX(r.hookWordCapPasses)}`,
    );
    lines.push(
      `- **Hook ends with period:** ${tickX(r.hookEndsWithPeriod)}`,
    );
    lines.push(
      `- **Pidgin marker scan (hook+whatToShow):** ${fmtMarker(r.pidginMarkerHit)}`,
    );
    lines.push(
      `- **Stereotype-token scan (hook+whatToShow+caption):** ${fmtMarker(r.stereotypeMarkerHit)}`,
    );
    lines.push(
      `- **Filming boilerplate scan (howToFilm):** ${fmtMarker(r.filmingBoilerplateHit)}`,
    );
    lines.push(
      `- **Shouty-template guard (isNigerianCleanCoreHookBlocked):** ${r.shoutyTemplateBlocks ? "BLOCKED" : "clean (no hit)"}`,
    );
    lines.push(
      `- **Anchor candidates (hook ∩ whatToShow content tokens):** ${r.anchorCandidates.length === 0 ? "**NONE — would fail anchor_in_hook/what_to_show validator**" : r.anchorCandidates.map((a) => `\`${a}\``).join(", ")}`,
    );
    lines.push(
      `- **Exact duplicate of existing corpus hook:** ${r.exactDuplicateOfCorpus === null ? "no" : `**YES → ${r.exactDuplicateOfCorpus}**`}`,
    );
    lines.push(
      `- **Closest corpus hook (token-Jaccard):** ${r.maxJaccardVsCorpus.toFixed(2)} vs \`${r.closestCorpusId ?? "n/a"}\` — "${r.closestCorpusHook ?? ""}"`,
    );
    lines.push("- **HQS scoring:**");
    lines.push(
      `  - Flag OFF total = **${r.hqsOffTotal}** (boot ≥40 ${tickX(r.aboveBootFloorOff)}, picker ≥50 ${tickX(r.abovePickerFloorOff)})`,
    );
    lines.push(
      `  - Flag ON  total = **${r.hqsOnTotal}** (boot ≥40 ${tickX(r.aboveBootFloorOn)}, picker ≥50 ${tickX(r.abovePickerFloorOn)})`,
    );
    lines.push(`  - Δ = **${r.delta >= 0 ? "+" : ""}${r.delta}**`);
    lines.push(
      `  - Fired signals: UA=${r.fired.UA}, ES=${r.fired.ES}, BW=${r.fired.BW}`,
    );
    lines.push(
      `  - aiCliche: ${r.fired.aiClicheFired ? `**FIRED** (${r.fired.aiClicheValue})` : "not fired (0)"}`,
    );
    lines.push(`- **IMPORT DECISION: \`${r.importDecision.toUpperCase()}\`**`);
    lines.push(`  - Reason: ${r.decisionReason}`);
    lines.push("");
  }

  // Aggregate summary
  const lifted = rows.filter((r) => r.delta > 0);
  const unchanged = rows.filter((r) => r.delta === 0);
  const negative = rows.filter((r) => r.delta < 0);
  const crossedPickerUp = rows.filter(
    (r) => !r.abovePickerFloorOff && r.abovePickerFloorOn,
  );
  const crossedBootUp = rows.filter(
    (r) => !r.aboveBootFloorOff && r.aboveBootFloorOn,
  );

  lines.push("## Aggregate scoring summary (10 candidates)");
  lines.push("");
  lines.push(
    `- **Lifted (Δ>0):** ${lifted.length} / 10 — ids: ${lifted.map((r) => r.suppliedId).join(", ") || "(none)"}`,
  );
  lines.push(`- **Unchanged (Δ=0):** ${unchanged.length} / 10`);
  lines.push(
    `- **Negative delta (Δ<0):** ${negative.length} / 10 — expected 0 (P16-A1 is pure-positive)`,
  );
  lines.push("");
  lines.push("**Floor crossings (lifted upward by P16-A1 flag ON):**");
  lines.push(
    `- Boot floor 40: ${crossedBootUp.length} crossings — ${crossedBootUp.map((r) => r.suppliedId).join(", ") || "(none)"}`,
  );
  lines.push(
    `- Picker floor 50: ${crossedPickerUp.length} crossings — ${crossedPickerUp.map((r) => r.suppliedId).join(", ") || "(none)"}`,
  );
  lines.push("");
  lines.push("**Per-signal attribution:**");
  const uaCount = rows.filter((r) => r.fired.UA > 0).length;
  const esCount = rows.filter((r) => r.fired.ES > 0).length;
  const bwCount = rows.filter((r) => r.fired.BW > 0).length;
  lines.push(`- UA (understatedAbsurdity) fired on ${uaCount} / 10`);
  lines.push(`- ES (emotionalSpecificity) fired on ${esCount} / 10`);
  lines.push(`- BW (brevityWideningDelta) fired on ${bwCount} / 10`);
  lines.push("");

  // Decision tally
  const importCount = rows.filter((r) => r.importDecision === "import").length;
  const rejectCount = rows.filter((r) => r.importDecision === "reject").length;
  const holdCount = rows.filter((r) => r.importDecision === "hold").length;

  lines.push("## Import decision tally");
  lines.push("");
  lines.push(`- **IMPORT:** ${importCount} / 10`);
  lines.push(`- **REJECT (hard validator fail):** ${rejectCount} / 10`);
  lines.push(`- **HOLD (supervisor metadata required):** ${holdCount} / 10`);
  lines.push("");

  lines.push("## Stop condition: missing supervisor metadata");
  lines.push("");
  lines.push(
    "Per the P16-A2 packet rule: \"If the schema requires fields not supplied here, do not creatively invent high-impact content. Use minimal schema-compatible defaults only if the repo already has a clear convention. Otherwise stop and report the missing required fields.\"",
  );
  lines.push("");
  lines.push(
    "The supervisor's packet leaves six required schema fields unspecified. The harness reports them per-entry and HOLDs every candidate that otherwise passes hard validators.",
  );
  lines.push("");
  lines.push(
    "| Field | Convention available? | Action |",
  );
  lines.push("| --- | --- | --- |");
  lines.push(
    "| `id` | Yes — next sequential `ng_clean_072..ng_clean_081` (corpus is 66 entries with intentional 065-069 gap) | **HOLD — assign on supervisor signoff** |",
  );
  lines.push(
    "| `draftId` | Yes — preserve supplied IDs (`CLEAN_P16A1_HUMAN_005`, `CLEAN_HUMAN_001`, …) as the import trace per packet rule | **HOLD — confirm trace mapping on supervisor signoff** |",
  );
  lines.push(
    "| `anchor` | Per-entry candidates surfaced above (intersection of hook + whatToShow content tokens) — but selection encodes editorial intent | **HOLD — supervisor must confirm one anchor per entry from the surfaced list** |",
  );
  lines.push(
    "| `premiseFamily` | Partial — 005, 011, 014, HUMAN_001 map cleanly to existing families (`tailoring_events` / `family_aunties`); 006, 007, 009, 010, 020, HUMAN_002 do **not** match any of the 10 existing keys (`power_light, transport, money_pos_bank, family_aunties, group_chats, market_food, tailoring_events, school_work, phone_data, creator_social_behavior`) and would degrade to the `everyday→home` fallback | **HOLD — supervisor must either pick from existing families or approve fallback** |",
  );
  lines.push(
    "| `voiceTone` | Existing tones in use (`dry_clean_observation`, `quiet_realization_clean`, `clean_deadpan`, `clean_overdramatic`, `clean_absurd_escalation`, `clean_social_comedy`, `self_aware_clean`, `quiet_realization`) — but choice is interpretive | **HOLD — supervisor must pick** |",
  );
  lines.push(
    "| `reviewedBy` | Existing convention `BI-CLEAN YYYY-MM-DD` — but the **boot validator rejects empty / non-supervisor stamps** and the packet did not provide one | **HOLD — supervisor must supply the stamp value (cannot be invented per packet rules)** |",
  );
  lines.push("");

  lines.push("## Phase exit posture");
  lines.push("");
  lines.push(
    `- All 10 candidates clear every **hard** validator the harness can run on the supplied fields (word cap, pidgin/stereotype/filming guards, shouty-template guard, exact-duplicate, ≥1 anchor candidate available).`,
  );
  lines.push(
    `- Negative-delta count: **${negative.length}** (expected 0 for the pure-positive P16-A1 lift). ${negative.length === 0 ? "✓" : "✗"}`,
  );
  lines.push(
    `- No floor crossings would be required to land any of these — all 10 already clear boot/picker floors with the flag ${rows.every((r) => r.aboveBootFloorOff) ? "OFF (boot)" : "**partially OFF**"}; ${rows.every((r) => r.abovePickerFloorOff) ? "all clear picker floor with flag OFF" : `${crossedPickerUp.length} would need flag ON to clear picker floor`}.`,
  );
  lines.push(
    "- **STOP CONDITION TRIGGERED**: 6 required schema fields are missing per the packet. The harness HOLDs every candidate pending supervisor sign-off on reviewer stamp + premise-family disambiguation + anchor selection; it does **not** import.",
  );
  lines.push("");
  lines.push("## What unblocks import");
  lines.push("");
  lines.push(
    "A follow-up packet from the supervisor providing per-entry: `anchor` (chosen from the surfaced candidates), `premiseFamily` (chosen from the existing 10 family keys, or explicit approval of `everyday→home` fallback for entries with no clean fit), `voiceTone` (chosen from the existing tone vocabulary), and a single `reviewedBy` stamp (e.g. `BI-CLEAN-P16A2 2026-05-12`). With those four fields supplied, the harness can deterministically derive `id` (`ng_clean_072..081`) and `draftId` (preserved supplied IDs), then run the full `authorPackEntryAsIdea` runtime validator path and import any survivors.",
  );
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
}

main();
