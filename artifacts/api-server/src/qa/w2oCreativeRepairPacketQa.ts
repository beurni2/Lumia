/**
 * PHASE W2-O — Creative repair packet for manual editorial rewrite.
 *
 * Exports the full current runtime row for every recoverable W2-O
 * entry — 25 needs_rewrite + 53 fixable_anchor_cohesion_mismatch +
 * 40 fixable_schema_field + 5 fixable_filming_mismatch + 2
 * privacy_safety = 125 rows.
 *
 * Pure I/O. No source mutation, no creative rewriting. Writes
 * `.local/W2O_REPAIR_PACKET.md`.
 *
 * Run:
 *   pnpm --filter @workspace/api-server exec tsx src/qa/w2oCreativeRepairPacketQa.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { APPROVED_WESTERN_PROMOTION_CANDIDATES } from "../lib/westernHookPackApproved.js";
import {
  scorePool,
  type RubricEntryResult,
} from "../lib/westernPromotionRubric.js";
import { authorWesternPackEntryAsIdea } from "../lib/westernPackAuthor.js";
import type { WesternHookPackDraftEntry } from "../lib/westernHookPack.js";

type SourceBlock = "W2-I" | "W2-L" | "W2-N";
type Bucket =
  | "needs_rewrite"
  | "fixable_anchor_cohesion_mismatch"
  | "fixable_schema_field"
  | "fixable_filming_mismatch"
  | "privacy_safety"
  | "true_low_quality"
  | "promote";

function sourceBlock(id: string): SourceBlock {
  if (id.startsWith("w2_next2_")) return "W2-N";
  if (id.startsWith("w2_next_")) return "W2-L";
  return "W2-I";
}

function validatorReason(entry: WesternHookPackDraftEntry): string | null {
  const r = authorWesternPackEntryAsIdea({
    entry,
    regenerateSalt: 0,
    seedFingerprints: new Set<string>(),
  });
  return r.ok ? null : r.reason;
}

function classifyReject(reasons: readonly string[]): Bucket {
  if (reasons.some((r) => r.startsWith("privacy_"))) return "privacy_safety";
  if (
    reasons.some(
      (r) =>
        r === "validator_failed:show_missing_hook_anchor" ||
        r === "validator_failed:hook_topic_noun_drift",
    )
  )
    return "fixable_anchor_cohesion_mismatch";
  if (reasons.some((r) => r === "validator_failed:schema_invalid"))
    return "fixable_schema_field";
  if (
    reasons.some(
      (r) =>
        r === "validator_failed:filming_mismatch" ||
        r === "validator_failed:family_verb_leak_on_scene",
    )
  )
    return "fixable_filming_mismatch";
  return "true_low_quality";
}

function classify(result: RubricEntryResult): Bucket {
  if (result.recommendation === "promote") return "promote";
  if (result.recommendation === "needs_rewrite") return "needs_rewrite";
  return classifyReject(result.rejectReasons);
}

function fence(s: string | undefined): string {
  if (s === undefined || s === null || s === "") return "_(empty)_";
  return "`" + s.replace(/`/g, "\\`") + "`";
}

function blockFor(
  entry: WesternHookPackDraftEntry,
  result: RubricEntryResult,
  bucket: Bucket,
): string[] {
  const lines: string[] = [];
  const valReason = validatorReason(entry) ?? "—";
  lines.push(`### ${entry.id}  ·  ${sourceBlock(entry.id)}  ·  score ${result.totalScore}/107  ·  ${result.recommendation}`);
  lines.push("");
  lines.push(`- **bucket:** ${bucket}`);
  lines.push(`- **validator failure reason:** \`${valReason}\``);
  lines.push(
    `- **reject reasons:** ${
      result.rejectReasons.length
        ? result.rejectReasons.map((r) => "`" + r + "`").join(", ")
        : "_(none)_"
    }`,
  );
  lines.push(
    `- **warning reasons:** ${
      result.warningReasons.length
        ? result.warningReasons.map((r) => "`" + r + "`").join(", ")
        : "_(none)_"
    }`,
  );
  lines.push("");
  lines.push("| field | value |");
  lines.push("| --- | --- |");
  lines.push(`| hook | ${fence(entry.hook)} |`);
  lines.push(`| whatToShow | ${fence(entry.whatToShow)} |`);
  lines.push(`| howToFilm | ${fence(entry.howToFilm)} |`);
  lines.push(`| caption | ${fence(entry.caption)} |`);
  lines.push(`| anchor | ${fence(entry.anchor)} |`);
  lines.push(`| comedyFamily | ${fence(entry.comedyFamily)} |`);
  lines.push(`| emotionalSpike | ${fence(entry.emotionalSpike)} |`);
  lines.push(`| setting | ${fence(entry.setting)} |`);
  lines.push(`| voiceCluster | ${fence(entry.voiceCluster)} |`);
  lines.push(`| hookStyle | ${fence(entry.hookStyle)} |`);
  lines.push(
    `| safetyNote | ${fence((entry as { safetyNote?: string }).safetyNote)} |`,
  );
  lines.push("");
  return lines;
}

function main(): void {
  const results = scorePool(APPROVED_WESTERN_PROMOTION_CANDIDATES);
  const byId = new Map(
    APPROVED_WESTERN_PROMOTION_CANDIDATES.map((e) => [e.id, e]),
  );

  const grouped = new Map<Bucket, RubricEntryResult[]>();
  for (const r of results) {
    const b = classify(r);
    if (b === "promote" || b === "true_low_quality") continue;
    const arr = grouped.get(b) ?? [];
    arr.push(r);
    grouped.set(b, arr);
  }

  const order: { bucket: Bucket; title: string }[] = [
    { bucket: "needs_rewrite", title: "1. Needs rewrite" },
    {
      bucket: "fixable_anchor_cohesion_mismatch",
      title: "2. Anchor / cohesion mismatch",
    },
    { bucket: "fixable_schema_field", title: "3. Schema field issue" },
    { bucket: "fixable_filming_mismatch", title: "4. Filming mismatch" },
    { bucket: "privacy_safety", title: "5. Privacy / safety review" },
  ];

  const lines: string[] = [];
  lines.push("# W2-O Creative Repair Packet");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Source pool: APPROVED_WESTERN_PROMOTION_CANDIDATES (${APPROVED_WESTERN_PROMOTION_CANDIDATES.length} entries)`);
  lines.push("");
  lines.push(
    "Purpose: hand a human editor every current runtime field for every recoverable W2-O entry so rewrites preserve taste, funniness, realism, and filmability. **No code, no entries, and no validator semantics are modified by this driver.**",
  );
  lines.push("");
  lines.push("## Coverage");
  lines.push("");
  lines.push("| Bucket | Count |");
  lines.push("| --- | ---: |");
  let total = 0;
  for (const { bucket, title } of order) {
    const c = grouped.get(bucket)?.length ?? 0;
    total += c;
    lines.push(`| ${title.replace(/^\d+\.\s*/, "")} | ${c} |`);
  }
  lines.push(`| **TOTAL** | **${total}** |`);
  lines.push("");

  for (const { bucket, title } of order) {
    const arr = grouped.get(bucket) ?? [];
    lines.push(`## ${title} (${arr.length})`);
    lines.push("");
    if (arr.length === 0) {
      lines.push("_(none)_");
      lines.push("");
      continue;
    }
    const sorted = [...arr].sort((a, b) =>
      a.entryId.localeCompare(b.entryId),
    );
    for (const r of sorted) {
      const entry = byId.get(r.entryId)!;
      lines.push(...blockFor(entry, r, bucket));
    }
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
  const outPath = path.join(repoRoot, ".local", "W2O_REPAIR_PACKET.md");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join("\n"));
  // eslint-disable-next-line no-console
  console.log(`wrote ${outPath} — ${lines.length} lines, ${total} entries`);
}

main();
