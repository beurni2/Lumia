/**
 * PHASE W2-U — Editorial Review Packet for the W2-T staging slab.
 *
 * Pure I/O — runs:
 *   1. The W2-O promotion rubric over all 100 W2-T entries.
 *   2. The Western pack author + validator pipeline over the same.
 *   3. A diversity-impact simulation: if every W2-T entry the
 *      rubric currently recommends as `promote` were editorially
 *      signed off, what would the live pool look like?
 *
 * Writes a markdown packet at `.local/W2U_REVIEW_PACKET.md`. No
 * runtime path touched, no production wiring. The rubric's
 * recommendation is computed BEFORE the `reviewedBy` gate — i.e.
 * the rubric itself ignores the editor stamp, so a `promote`
 * verdict surfaces "would-be-promotable, blocked only on editor
 * sign-off" entries cleanly.
 *
 * Run:
 *   pnpm --filter @workspace/api-server exec tsx \
 *     src/qa/w2uEditorialReviewPacketQa.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PENDING_EDITORIAL_REVIEW,
  type WesternHookPackDraftEntry,
} from "../lib/westernHookPack.js";
import { WESTERN_HOOK_PACK_DIVERSITY } from "../lib/westernHookPackDiversity.js";
import { APPROVED_WESTERN_PROMOTION_CANDIDATES } from "../lib/westernHookPackApproved.js";
import { WESTERN_HOOK_PACK_LIVE } from "../lib/westernHookPackLive.js";
import {
  RUBRIC_DIMENSIONS,
  RUBRIC_MAX_SCORE,
  RUBRIC_PROMOTE_FLOOR,
  RUBRIC_REWRITE_FLOOR,
  RUBRIC_WEIGHTS,
  buildPoolContext,
  scoreEntry,
  type RubricEntryResult,
  type RubricRecommendation,
} from "../lib/westernPromotionRubric.js";
import { authorWesternPackEntryAsIdea } from "../lib/westernPackAuthor.js";

// ─────────────────────────────────────────────────────────────── //
// Helpers                                                         //
// ─────────────────────────────────────────────────────────────── //

function sourceBlock(id: string): "W2-I" | "W2-L" | "W2-N" | "W2-T" {
  if (id.startsWith("w2_t_diversity_")) return "W2-T";
  if (id.startsWith("w2_next2_")) return "W2-N";
  if (id.startsWith("w2_next_")) return "W2-L";
  return "W2-I";
}

function tally<T extends string>(
  values: readonly T[],
): ReadonlyMap<T, number> {
  const m = new Map<T, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
}

function sortMap(m: ReadonlyMap<string, number>): Array<[string, number]> {
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Phone/screen-led detector — same convention used by the diversity
 *  surveyor in `westernHookPack` (anchor or whatToShow tokens). */
function isPhoneScreenLed(e: WesternHookPackDraftEntry): boolean {
  const txt = `${e.anchor} ${e.whatToShow}`.toLowerCase();
  return /\b(phone|screen|notification|message|text|inbox|chat|app|laptop|desktop|monitor|browser)\b/.test(
    txt,
  );
}

function settingMatches(e: WesternHookPackDraftEntry, names: string[]): boolean {
  return names.includes(e.setting as string);
}

function isPhysicalBodyComedy(e: WesternHookPackDraftEntry): boolean {
  // tiny_humiliation + getting_ready cohorts that don't use phone/screen
  // tokens are the "physical body comedy" cluster the user means here.
  if (isPhoneScreenLed(e)) return false;
  return ["tiny_humiliation", "getting_ready", "procrestination"].includes(
    e.comedyFamily as string,
  );
}

// ─────────────────────────────────────────────────────────────── //
// Per-entry computation                                           //
// ─────────────────────────────────────────────────────────────── //

interface PerEntryRow {
  readonly entry: WesternHookPackDraftEntry;
  readonly authorOk: boolean;
  readonly authorReason: string;
  readonly rubric: RubricEntryResult;
  readonly onlyBlockerIsReviewedBy: boolean;
}

function computeRows(): PerEntryRow[] {
  // Build the rubric pool context against the FULL approved pool
  // (400 entries) so duplication / diversity contribution scoring
  // sees every neighbor — identical to the live load path.
  const ctx = buildPoolContext(APPROVED_WESTERN_PROMOTION_CANDIDATES);
  const rows: PerEntryRow[] = [];
  for (const entry of WESTERN_HOOK_PACK_DIVERSITY) {
    const authorRes = authorWesternPackEntryAsIdea({
      entry,
      regenerateSalt: 0,
      seedFingerprints: new Set<string>(),
    });
    const rubric = scoreEntry(entry, ctx);
    const onlyBlockerIsReviewedBy =
      rubric.recommendation === "promote" &&
      entry.reviewedBy === PENDING_EDITORIAL_REVIEW;
    rows.push({
      entry,
      authorOk: authorRes.ok,
      authorReason: authorRes.ok ? "ok" : authorRes.reason,
      rubric,
      onlyBlockerIsReviewedBy,
    });
  }
  return rows;
}

// ─────────────────────────────────────────────────────────────── //
// Diversity simulation                                            //
// ─────────────────────────────────────────────────────────────── //

interface DiversityProfile {
  readonly liveSize: number;
  readonly phoneScreenLed: number;
  readonly phoneScreenLedPct: number;
  readonly settingTally: ReadonlyArray<readonly [string, number]>;
  readonly familyTally: ReadonlyArray<readonly [string, number]>;
  readonly bathroomMirror: number;
  readonly hallwayDoorway: number;
  readonly parkedCar: number;
  readonly physicalBodyComedy: number;
  readonly closetOutfit: number;
  readonly desk: number;
  readonly kitchen: number;
  readonly bedroom: number;
  readonly couch: number;
  readonly sourceDist: Readonly<Record<"W2-I" | "W2-L" | "W2-N" | "W2-T", number>>;
}

function profile(
  pool: readonly WesternHookPackDraftEntry[],
): DiversityProfile {
  const phone = pool.filter(isPhoneScreenLed).length;
  const settingTally = sortMap(tally(pool.map((e) => e.setting as string)));
  const familyTally = sortMap(tally(pool.map((e) => e.comedyFamily as string)));
  const sourceDist = { "W2-I": 0, "W2-L": 0, "W2-N": 0, "W2-T": 0 } as Record<
    "W2-I" | "W2-L" | "W2-N" | "W2-T",
    number
  >;
  for (const e of pool) sourceDist[sourceBlock(e.id)]++;
  return {
    liveSize: pool.length,
    phoneScreenLed: phone,
    phoneScreenLedPct: pool.length === 0 ? 0 : (phone / pool.length) * 100,
    settingTally,
    familyTally,
    bathroomMirror: pool.filter((e) =>
      settingMatches(e, ["bathroom", "mirror"]),
    ).length,
    hallwayDoorway: pool.filter((e) =>
      settingMatches(e, ["hallway", "doorway"]),
    ).length,
    parkedCar: pool.filter((e) => settingMatches(e, ["car"])).length,
    physicalBodyComedy: pool.filter(isPhysicalBodyComedy).length,
    closetOutfit: pool.filter(
      (e) =>
        settingMatches(e, ["bedroom", "closet"]) &&
        ["getting_ready", "outfit_panic"].includes(e.comedyFamily as string),
    ).length,
    desk: pool.filter((e) => settingMatches(e, ["desk", "office"])).length,
    kitchen: pool.filter((e) => settingMatches(e, ["kitchen"])).length,
    bedroom: pool.filter((e) => settingMatches(e, ["bedroom"])).length,
    couch: pool.filter((e) =>
      settingMatches(e, ["couch", "living_room", "sofa"]),
    ).length,
    sourceDist,
  };
}

// ─────────────────────────────────────────────────────────────── //
// Markdown emission                                               //
// ─────────────────────────────────────────────────────────────── //

function fmtSafetyNote(note: string | undefined): string {
  if (note === undefined) return "—";
  const trimmed = note.trim();
  if (trimmed === "" || trimmed === "None.") return "—";
  return trimmed;
}

function fmtReasons(r: RubricEntryResult, authorReason: string): string {
  const parts: string[] = [];
  if (authorReason !== "ok") parts.push(`AUTHOR_FAIL:${authorReason}`);
  for (const x of r.rejectReasons) parts.push(`REJ:${x}`);
  for (const x of r.warningReasons) parts.push(`WARN:${x}`);
  return parts.length === 0 ? "—" : parts.join("; ");
}

function fmtPerDim(r: RubricEntryResult): string {
  return RUBRIC_DIMENSIONS.map(
    (d) => `${d}=${r.perDimension[d]}/${RUBRIC_WEIGHTS[d]}`,
  ).join(", ");
}

function buildPacket(rows: readonly PerEntryRow[]): string {
  const out: string[] = [];
  out.push("# W2-U — Editorial Review Packet for W2-T (100 entries)");
  out.push("");
  out.push(`Generated: ${new Date().toISOString()}`);
  out.push("");
  out.push(
    "Source: `WESTERN_HOOK_PACK_DIVERSITY` (100 staging-only entries, all `reviewedBy = PENDING_EDITORIAL_REVIEW`).",
  );
  out.push("");
  out.push("This packet is **report only**. No code changes. No flag changes.");
  out.push("Rubric recommendations are computed **before** the `reviewedBy`");
  out.push("gate — the rubric itself ignores the editor stamp. The");
  out.push('"only blocker is reviewedBy" column flips true when a `promote`');
  out.push("recommendation is paired with a `PENDING_EDITORIAL_REVIEW`");
  out.push("stamp (i.e. an editor sign-off is the sole remaining step).");
  out.push("");
  out.push(`- Rubric max score: ${RUBRIC_MAX_SCORE}`);
  out.push(`- Promote floor:    ${RUBRIC_PROMOTE_FLOOR}`);
  out.push(`- Rewrite floor:    ${RUBRIC_REWRITE_FLOOR}`);
  out.push("");

  // Summary counts
  const recCounts: Record<RubricRecommendation, number> = {
    promote: 0,
    needs_rewrite: 0,
    reject: 0,
  };
  let authorFails = 0;
  let validatorFails = 0;
  let safetyFails = 0;
  let hookLengthFails = 0;
  let cohesionFails = 0;
  let filmabilityFails = 0;
  let dupFails = 0;
  let onlyReviewerBlocker = 0;
  for (const r of rows) {
    recCounts[r.rubric.recommendation]++;
    if (!r.authorOk) authorFails++;
    for (const reason of r.rubric.rejectReasons) {
      if (reason.startsWith("validator_")) validatorFails++;
      if (reason.startsWith("safety_")) safetyFails++;
    }
    for (const reason of [...r.rubric.rejectReasons, ...r.rubric.warningReasons]) {
      if (reason.includes("hook_length")) hookLengthFails++;
      if (reason.includes("cohesion")) cohesionFails++;
      if (reason.includes("filmability")) filmabilityFails++;
      if (reason.includes("duplica") || reason.includes("novelty")) dupFails++;
    }
    if (r.onlyBlockerIsReviewedBy) onlyReviewerBlocker++;
  }

  out.push("## 1. Summary counts");
  out.push("");
  out.push("| Bucket | Count |");
  out.push("| --- | ---: |");
  out.push(`| promote_ready_pending_editor | ${recCounts.promote} |`);
  out.push(`| needs_rewrite | ${recCounts.needs_rewrite} |`);
  out.push(`| reject | ${recCounts.reject} |`);
  out.push(`| author failures | ${authorFails} |`);
  out.push(`| validator failures | ${validatorFails} |`);
  out.push(`| safety failures | ${safetyFails} |`);
  out.push(`| hook word-count failures | ${hookLengthFails} |`);
  out.push(`| anchor / cohesion failures | ${cohesionFails} |`);
  out.push(`| howToFilm / whatToShow / filmability failures | ${filmabilityFails} |`);
  out.push(`| duplication / novelty failures | ${dupFails} |`);
  out.push(
    `| **only blocker = reviewedBy=PENDING_EDITORIAL_REVIEW** | **${onlyReviewerBlocker}** |`,
  );
  out.push("");

  // Triplet & dedupe collisions inside W2-T (post-fix should be 0)
  const tripletFamSetAnchor = new Map<string, string[]>();
  const tripletFamSpikeAnchor = new Map<string, string[]>();
  const skeletonByHook = new Map<string, string[]>();
  for (const e of WESTERN_HOOK_PACK_DIVERSITY) {
    const k1 = `${e.comedyFamily}|${e.setting}|${e.anchor}`;
    const k2 = `${e.comedyFamily}|${e.emotionalSpike}|${e.anchor}`;
    const sk = e.hook.toLowerCase().trim();
    (tripletFamSetAnchor.get(k1) ?? tripletFamSetAnchor.set(k1, []).get(k1)!).push(e.id);
    (tripletFamSpikeAnchor.get(k2) ?? tripletFamSpikeAnchor.set(k2, []).get(k2)!).push(e.id);
    (skeletonByHook.get(sk) ?? skeletonByHook.set(sk, []).get(sk)!).push(e.id);
  }
  const tripletFamSetAnchorDups = [...tripletFamSetAnchor.values()].filter(
    (v) => v.length > 1,
  ).length;
  const tripletFamSpikeAnchorDups = [...tripletFamSpikeAnchor.values()].filter(
    (v) => v.length > 1,
  ).length;
  const dedupeDups = [...skeletonByHook.values()].filter((v) => v.length > 1).length;
  out.push("## 2. Intra-W2-T collision counts (post-fix)");
  out.push("");
  out.push("| Collision type | Count |");
  out.push("| --- | ---: |");
  out.push(`| (family\\|setting\\|anchor) triplets duped | ${tripletFamSetAnchorDups} |`);
  out.push(`| (family\\|spike\\|anchor) triplets duped | ${tripletFamSpikeAnchorDups} |`);
  out.push(`| exact-hook collisions | ${dedupeDups} |`);
  out.push("");

  // Top reject/warning reasons
  const allReject = tally(rows.flatMap((r) => r.rubric.rejectReasons));
  const allWarn = tally(rows.flatMap((r) => r.rubric.warningReasons));
  out.push("## 3. Top reject / warning reasons across W2-T");
  out.push("");
  out.push("### Reject reasons");
  out.push("| Reason | Count |");
  out.push("| --- | ---: |");
  for (const [k, v] of sortMap(allReject)) out.push(`| ${k} | ${v} |`);
  if (sortMap(allReject).length === 0) out.push("| (none) | 0 |");
  out.push("");
  out.push("### Warning reasons");
  out.push("| Reason | Count |");
  out.push("| --- | ---: |");
  for (const [k, v] of sortMap(allWarn)) out.push(`| ${k} | ${v} |`);
  if (sortMap(allWarn).length === 0) out.push("| (none) | 0 |");
  out.push("");

  // Diversity simulation
  out.push("## 4. Diversity-impact simulation");
  out.push("");
  out.push("Two pools compared:");
  out.push("");
  out.push(
    "- **Current live pool** (`WESTERN_HOOK_PACK_LIVE`) — only entries the W2-O rubric currently recommends `promote` AND that already carry a real editor stamp.",
  );
  out.push(
    "- **Projected live pool** — current live pool ∪ every W2-T entry whose rubric recommendation is `promote`, simulating the editor sign-off pass.",
  );
  out.push("");
  const currentLive = WESTERN_HOOK_PACK_LIVE as unknown as readonly WesternHookPackDraftEntry[];
  const promoteReadyW2T = rows
    .filter((r) => r.rubric.recommendation === "promote")
    .map((r) => r.entry);
  const projectedLive = [...currentLive, ...promoteReadyW2T];
  const cur = profile(currentLive);
  const proj = profile(projectedLive);

  const headers = [
    "metric",
    "current live",
    "projected (W2-T promote-ready added)",
    "delta",
  ];
  out.push("| " + headers.join(" | ") + " |");
  out.push("| " + headers.map(() => "---").join(" | ") + " |");
  function row(name: string, a: number, b: number, isPct = false): string {
    const fmt = (n: number) => (isPct ? n.toFixed(1) + "%" : String(n));
    const d = b - a;
    const dStr = isPct ? d.toFixed(1) + "pp" : (d >= 0 ? `+${d}` : String(d));
    return `| ${name} | ${fmt(a)} | ${fmt(b)} | ${dStr} |`;
  }
  out.push(row("live pool size", cur.liveSize, proj.liveSize));
  out.push(
    row("phone/screen-led %", cur.phoneScreenLedPct, proj.phoneScreenLedPct, true),
  );
  out.push(row("bathroom / mirror", cur.bathroomMirror, proj.bathroomMirror));
  out.push(row("hallway / doorway", cur.hallwayDoorway, proj.hallwayDoorway));
  out.push(row("parked car", cur.parkedCar, proj.parkedCar));
  out.push(
    row("physical body comedy", cur.physicalBodyComedy, proj.physicalBodyComedy),
  );
  out.push(row("closet / outfit", cur.closetOutfit, proj.closetOutfit));
  out.push(row("desk / office", cur.desk, proj.desk));
  out.push(row("kitchen", cur.kitchen, proj.kitchen));
  out.push(row("bedroom", cur.bedroom, proj.bedroom));
  out.push(row("couch / living_room", cur.couch, proj.couch));
  for (const blk of ["W2-I", "W2-L", "W2-N", "W2-T"] as const) {
    out.push(
      row(`source: ${blk}`, cur.sourceDist[blk], proj.sourceDist[blk]),
    );
  }
  out.push("");

  out.push("### Top settings — projected live pool");
  out.push("| Setting | Count |");
  out.push("| --- | ---: |");
  for (const [k, v] of proj.settingTally) out.push(`| ${k} | ${v} |`);
  out.push("");
  out.push("### Top comedyFamily — projected live pool");
  out.push("| Family | Count |");
  out.push("| --- | ---: |");
  for (const [k, v] of proj.familyTally) out.push(`| ${k} | ${v} |`);
  out.push("");

  // Per-entry detail
  out.push("## 5. Per-entry detail (100 rows)");
  out.push("");
  out.push("Each block lists the editorial fields, the rubric outcome,");
  out.push("the per-dimension breakdown, and the exact reject/warning");
  out.push('reasons. "only blocker = reviewedBy" means the rubric would');
  out.push("recommend `promote`; the only thing keeping this entry out");
  out.push("of the live pool is the `PENDING_EDITORIAL_REVIEW` stamp.");
  out.push("");
  for (const r of rows) {
    const e = r.entry;
    const finalRec = r.onlyBlockerIsReviewedBy
      ? "promote_ready_pending_editor"
      : r.rubric.recommendation;
    out.push(`### ${e.id} — ${finalRec} (${r.rubric.totalScore}/${RUBRIC_MAX_SCORE})`);
    out.push("");
    out.push(`- **hook**: ${e.hook}`);
    out.push(`- **whatToShow**: ${e.whatToShow}`);
    out.push(`- **howToFilm**: ${e.howToFilm}`);
    out.push(`- **caption**: ${e.caption}`);
    out.push(`- **anchor**: \`${e.anchor}\``);
    out.push(`- **comedyFamily**: \`${e.comedyFamily}\``);
    out.push(`- **emotionalSpike**: \`${e.emotionalSpike}\``);
    out.push(`- **setting**: \`${e.setting}\``);
    out.push(`- **voiceCluster**: \`${String(e.voiceCluster ?? "—")}\``);
    out.push(`- **hookStyle**: \`${String(e.hookStyle ?? "—")}\``);
    out.push(`- **safetyNote**: ${fmtSafetyNote(e.safetyNote)}`);
    out.push(`- **author**: ${r.authorOk ? "ok" : `FAIL — ${r.authorReason}`}`);
    out.push(
      `- **validator survival**: ${r.rubric.perDimension.validatorSurvival}/${RUBRIC_WEIGHTS.validatorSurvival} (${r.rubric.perDimension.validatorSurvival === RUBRIC_WEIGHTS.validatorSurvival ? "passed" : "FAIL"})`,
    );
    out.push(
      `- **rubric**: total=${r.rubric.totalScore}/${RUBRIC_MAX_SCORE}, recommendation=\`${r.rubric.recommendation}\``,
    );
    out.push(`- **per-dim**: ${fmtPerDim(r.rubric)}`);
    out.push(`- **reasons**: ${fmtReasons(r.rubric, r.authorReason)}`);
    out.push(
      `- **only blocker = reviewedBy**: ${r.onlyBlockerIsReviewedBy ? "**YES** (editor sign-off is the sole gate)" : "no"}`,
    );
    out.push("");
  }

  out.push("---");
  out.push("");
  out.push(
    `Generated from rubric parity: scoring the W2-T slab against the same pool context (${APPROVED_WESTERN_PROMOTION_CANDIDATES.length} entries) the live module uses at load time. Current live pool size: ${currentLive.length}.`,
  );
  return out.join("\n");
}

// ─────────────────────────────────────────────────────────────── //
// Main                                                            //
// ─────────────────────────────────────────────────────────────── //

function main(): void {
  const rows = computeRows();
  const md = buildPacket(rows);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const outPath = path.resolve(here, "..", "..", "..", "..", ".local", "W2U_REVIEW_PACKET.md");
  fs.writeFileSync(outPath, md, "utf8");
  // eslint-disable-next-line no-console
  console.log(`[W2-U] wrote ${outPath} (${md.length} bytes, ${rows.length} entries)`);
}

main();
