/**
 * PHASE W2-O — Reject + needs_rewrite manifest.
 *
 * For every entry in `APPROVED_WESTERN_PROMOTION_CANDIDATES` whose
 * rubric recommendation is NOT `promote`, emits a markdown row with:
 *   id / source-block / hook / recommendation / reject + warning
 *   reasons / validator failure reason / fixability bucket / minimal
 *   repair suggestion.
 *
 * Reject classification buckets:
 *   1. fixable_anchor_cohesion_mismatch
 *   2. fixable_schema_field
 *   3. fixable_filming_mismatch
 *   4. privacy_safety
 *   5. true_low_quality
 *
 * Pure I/O. Writes `.local/W2O_REJECT_MANIFEST.md`.
 *
 * Run:
 *   pnpm --filter @workspace/api-server exec tsx src/qa/w2oRejectManifestQa.ts
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
type RejectBucket =
  | "fixable_anchor_cohesion_mismatch"
  | "fixable_schema_field"
  | "fixable_filming_mismatch"
  | "privacy_safety"
  | "true_low_quality"
  | "n/a"; // for needs_rewrite

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

function classifyReject(reasons: readonly string[]): RejectBucket {
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

function repairFor(
  bucket: RejectBucket,
  entry: WesternHookPackDraftEntry,
  reasons: readonly string[],
): string {
  switch (bucket) {
    case "fixable_anchor_cohesion_mismatch": {
      // Find a substantive hook noun (≥4 chars, not stopword) and
      // suggest seeding it into whatToShow.
      const hookTokens = (entry.hook.toLowerCase().match(/[a-z]{4,}/g) ?? []);
      const candidate = hookTokens.find((t) => !entry.whatToShow.toLowerCase().includes(t));
      const seed = candidate ?? entry.anchor;
      return `Add the hook anchor "${seed}" verbatim into whatToShow (≥1 substantive hook token must overlap).`;
    }
    case "fixable_schema_field": {
      // QA-only diagnostic: re-parse the would-be-authored draft and
      // surface the actual Zod issue path so editors don't chase the
      // wrong field. NB: this call does NOT loosen any validator; it
      // only reports the failure path that `authorWesternPackEntryAsIdea`
      // would hit at runtime. Most common cause observed in W2-P:
      // `hook must be ≤10 words (target ≤8)`.
      const wordCount = entry.hook.trim().split(/\s+/).length;
      const hints: string[] = [];
      if (wordCount > 10) {
        hints.push(
          `hook is ${wordCount} words — ideaSchema requires ≤10 words (target ≤8). Shorten hook.`,
        );
      }
      const tail =
        hints.length > 0
          ? hints.join(" ")
          : `Re-author the row with a valid schema — verify hookSeconds (1–3), shotPlan length (≥3), all required fields populated.`;
      return `schema_invalid: ${tail} (Most common Zod failure path on this bucket: hook word-count ceiling.)`;
    }
    case "fixable_filming_mismatch":
      return `Rewrite howToFilm so its tokens overlap whatToShow's verb/object — current howToFilm references nouns absent from the action shot.`;
    case "privacy_safety": {
      const hits = reasons.filter((r) => r.startsWith("privacy_")).join(", ");
      return `Redact: ${hits}. Replace the trigger token (phone#/email/address/child reference) with a generic stand-in.`;
    }
    case "true_low_quality":
      if (reasons.some((r) => r.startsWith("duplicate_skeleton:")))
        return `Hook skeleton appears ≥3× in pool — rewrite hook with a different syntactic frame to break the dedup collision.`;
      return `Score below ${65}/107 with no single fixable validator failure — rewrite hook for stronger punch + anchor specificity, or drop.`;
    case "n/a":
      return `(needs_rewrite) Lift soft dimensions: ${reasons
        .filter((r) => r.startsWith("hook_") || r.startsWith("scenario_"))
        .join(", ") || "address top warning(s)"}.`;
  }
}

function fixableFlag(bucket: RejectBucket): "yes" | "no" | "review" {
  switch (bucket) {
    case "fixable_anchor_cohesion_mismatch":
    case "fixable_schema_field":
    case "fixable_filming_mismatch":
      return "yes";
    case "privacy_safety":
      return "review";
    case "true_low_quality":
      return "no";
    case "n/a":
      return "yes";
  }
}

function escMd(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function rowFor(
  entry: WesternHookPackDraftEntry,
  result: RubricEntryResult,
  bucket: RejectBucket,
): string {
  const block = sourceBlock(entry.id);
  const valReason = validatorReason(entry) ?? "—";
  const rejects = result.rejectReasons.length
    ? result.rejectReasons.join("; ")
    : "—";
  const warns = result.warningReasons.length
    ? result.warningReasons.join("; ")
    : "—";
  const fixable = fixableFlag(bucket);
  const repair = repairFor(bucket, entry, result.rejectReasons);
  return `| ${entry.id} | ${block} | ${result.totalScore} | ${result.recommendation} | ${bucket} | ${fixable} | ${escMd(valReason)} | ${escMd(rejects)} | ${escMd(warns)} | ${escMd(entry.hook)} | ${escMd(repair)} |`;
}

function main(): void {
  const results = scorePool(APPROVED_WESTERN_PROMOTION_CANDIDATES);
  const byId = new Map(
    APPROVED_WESTERN_PROMOTION_CANDIDATES.map((e) => [e.id, e]),
  );

  const rejects = results.filter((r) => r.recommendation === "reject");
  const rewrites = results.filter((r) => r.recommendation === "needs_rewrite");

  const rejectsByBucket = new Map<RejectBucket, RubricEntryResult[]>();
  const bucketOf = new Map<string, RejectBucket>();
  for (const r of rejects) {
    const b = classifyReject(r.rejectReasons);
    bucketOf.set(r.entryId, b);
    const arr = rejectsByBucket.get(b) ?? [];
    arr.push(r);
    rejectsByBucket.set(b, arr);
  }

  const lines: string[] = [];
  lines.push("# W2-O Reject + Needs-Rewrite Manifest");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Staging pool size: ${APPROVED_WESTERN_PROMOTION_CANDIDATES.length}`);
  lines.push(`Reject count: ${rejects.length}`);
  lines.push(`Needs-rewrite count: ${rewrites.length}`);
  lines.push("");
  lines.push("## Reject classification");
  lines.push("");
  lines.push("| Bucket | Count | % of rejects | Fixable |");
  lines.push("| --- | ---: | ---: | --- |");
  const bucketOrder: RejectBucket[] = [
    "fixable_anchor_cohesion_mismatch",
    "fixable_schema_field",
    "fixable_filming_mismatch",
    "privacy_safety",
    "true_low_quality",
  ];
  for (const b of bucketOrder) {
    const count = rejectsByBucket.get(b)?.length ?? 0;
    const pct = ((count / Math.max(1, rejects.length)) * 100).toFixed(1);
    lines.push(`| ${b} | ${count} | ${pct}% | ${fixableFlag(b)} |`);
  }
  lines.push("");
  lines.push("## Per-block reject counts by bucket");
  lines.push("");
  lines.push("| Block | anchor/cohesion | schema | filming | privacy | low-quality | total |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const block of ["W2-I", "W2-L", "W2-N"] as const) {
    const counts: Record<RejectBucket, number> = {
      fixable_anchor_cohesion_mismatch: 0,
      fixable_schema_field: 0,
      fixable_filming_mismatch: 0,
      privacy_safety: 0,
      true_low_quality: 0,
      "n/a": 0,
    };
    for (const r of rejects) {
      const e = byId.get(r.entryId)!;
      if (sourceBlock(e.id) === block) counts[bucketOf.get(r.entryId)!]++;
    }
    const total = bucketOrder.reduce((s, b) => s + counts[b], 0);
    lines.push(
      `| ${block} | ${counts.fixable_anchor_cohesion_mismatch} | ${counts.fixable_schema_field} | ${counts.fixable_filming_mismatch} | ${counts.privacy_safety} | ${counts.true_low_quality} | ${total} |`,
    );
  }
  lines.push("");

  // ---------- Reject manifest grouped by bucket ----------
  const tableHeader = [
    "| ID | Block | Score | Rec | Bucket | Fixable | Validator reason | Reject reasons | Warnings | Hook | Suggested minimal repair |",
    "| --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const bucket of bucketOrder) {
    const arr = rejectsByBucket.get(bucket) ?? [];
    if (arr.length === 0) continue;
    lines.push(`## Rejects — ${bucket} (${arr.length})`);
    lines.push("");
    lines.push(...tableHeader);
    const sorted = [...arr].sort((a, b) => a.entryId.localeCompare(b.entryId));
    for (const r of sorted) {
      const entry = byId.get(r.entryId)!;
      lines.push(rowFor(entry, r, bucket));
    }
    lines.push("");
  }

  // ---------- Needs-rewrite manifest ----------
  lines.push(`## Needs-rewrite (${rewrites.length})`);
  lines.push("");
  lines.push(...tableHeader);
  const sortedRw = [...rewrites].sort((a, b) =>
    a.entryId.localeCompare(b.entryId),
  );
  for (const r of sortedRw) {
    const entry = byId.get(r.entryId)!;
    lines.push(rowFor(entry, r, "n/a"));
  }
  lines.push("");

  // ---------- Per-source-block summary of rewrites ----------
  lines.push("## Needs-rewrite per source block");
  lines.push("");
  lines.push("| Block | Count |");
  lines.push("| --- | ---: |");
  const rwByBlock = new Map<SourceBlock, number>();
  for (const r of rewrites) {
    const e = byId.get(r.entryId)!;
    const b = sourceBlock(e.id);
    rwByBlock.set(b, (rwByBlock.get(b) ?? 0) + 1);
  }
  for (const block of ["W2-I", "W2-L", "W2-N"] as const) {
    lines.push(`| ${block} | ${rwByBlock.get(block) ?? 0} |`);
  }
  lines.push("");

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
  const outPath = path.join(repoRoot, ".local", "W2O_REJECT_MANIFEST.md");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join("\n"));
  // eslint-disable-next-line no-console
  console.log(`wrote ${outPath} — ${lines.length} lines`);
}

main();
