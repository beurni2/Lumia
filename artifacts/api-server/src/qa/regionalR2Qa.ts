/**
 * PHASE R2 — CLAUDE FALLBACK REGIONAL PROMPT POLISH QA
 *
 * Dumps the per-region `REGION_PROMPT_GUIDANCE` block that gets
 * injected into the Claude fallback system prompt and verifies:
 *
 *   - western entry is empty string (preserves baseline prompt)
 *   - each non-western entry contains the safety, anti-stereotype,
 *     and clean-English-default phrases the spec requires
 *   - each non-western entry includes local daily-life context tags
 *     the spec lists (group chats, transport, food, family, etc.)
 *   - no entry contains heavy-dialect tokens that would force slang
 *     unconditionally (we look for the OPPOSITE — explicit "do NOT
 *     force heavy" wording)
 *
 * Live Claude QA (10 fallback outputs / region) is a manual gate
 * before beta rollout — this synthetic check verifies the prompt
 * payload is correct without burning Claude budget on a CI loop
 * that will produce non-deterministic output anyway.
 *
 * Output: .local/REGIONAL_R2_QA.md
 *
 * Run: pnpm exec tsx artifacts/api-server/src/qa/regionalR2Qa.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { REGIONS, type Region } from "@workspace/lumina-trends";
import { REGION_PROMPT_GUIDANCE } from "../lib/regionProfile";

type AcceptanceCheck = {
  name: string;
  // Each inner array is an OR-group; outer array is AND-joined.
  // Entry passes when EVERY group has at least one substring match
  // (case-insensitive) in the region's prompt block.
  required: string[][];
};

const NON_WESTERN_CHECKS: AcceptanceCheck[] = [
  {
    name: "Clean-English default (anti-forced-dialect)",
    required: [["DEFAULT TO CLEAN ENGLISH"], ["Do NOT force heavy"]],
  },
  {
    name: "Anti-stereotype guidance",
    required: [["AVOID"]],
  },
  {
    name: "Privacy / safety guidance for screens",
    required: [["SAFETY"], ["fake or demo screens"]],
  },
  {
    name: "Local daily-life context tags (group/transport/food/family)",
    required: [
      ["group", "barkada", "WhatsApp"],
      ["commute", "transport", "jeepney", "danfo", "metro"],
      ["food", "delivery", "snack", "cooking"],
      ["family"],
    ],
  },
  {
    name: "Filming reality (single phone, <30 min, solo)",
    required: [["single phone"], ["30 minutes"]],
  },
];

function checkRegion(
  _region: Region,
  text: string,
): { check: AcceptanceCheck; pass: boolean }[] {
  const lower = text.toLowerCase();
  return NON_WESTERN_CHECKS.map((check) => {
    const allGroupsMatch = check.required.every((group) =>
      group.some((sub) => lower.includes(sub.toLowerCase())),
    );
    return { check, pass: allGroupsMatch };
  });
}

function main(): void {
  const lines: string[] = [];
  lines.push("# PHASE R2 — Claude Fallback Regional Prompt Polish QA");
  lines.push("");
  lines.push(
    "Dumps `REGION_PROMPT_GUIDANCE` per region and verifies each non-western entry contains the safety / anti-stereotype / clean-English-default / local-context / filming-reality phrases the spec requires. Western entry must be empty string (preserves the pre-R2 prompt verbatim).",
  );
  lines.push("");
  lines.push(
    "Live Claude QA (≥10 fallback outputs per region) is a manual gate before beta rollout — this synthetic check verifies the prompt payload is correct without burning Claude budget on a CI loop with non-deterministic output.",
  );
  lines.push("");

  // Western check: must be empty string.
  const westernEmpty = REGION_PROMPT_GUIDANCE.western === "";
  lines.push("## Western (must preserve baseline)");
  lines.push("");
  lines.push(
    `- **western entry empty**: ${westernEmpty ? "✓ baseline prompt preserved verbatim" : "✗ REGRESSION (would change western prompt)"}`,
  );
  lines.push("");

  let allChecksPass = westernEmpty;

  for (const region of REGIONS) {
    if (region === "western") continue;
    const text = REGION_PROMPT_GUIDANCE[region];
    const results = checkRegion(region, text);
    const allPass = results.every((r) => r.pass);
    if (!allPass) allChecksPass = false;

    lines.push("---");
    lines.push("");
    lines.push(`## Region: \`${region}\``);
    lines.push("");
    lines.push(`- **char count**: ${text.length}`);
    lines.push(`- **line count**: ${text.split("\n").length}`);
    lines.push("");
    lines.push("### Acceptance checks");
    lines.push("");
    for (const r of results) {
      lines.push(
        `- ${r.pass ? "✓" : "✗"} ${r.check.name} — needs all of: ${r.check.required.map((s) => `\`${s}\``).join(", ")}`,
      );
    }
    lines.push("");
    lines.push("### Full prompt block");
    lines.push("");
    lines.push("```");
    lines.push(text);
    lines.push("```");
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("## Aggregate (R2 acceptance)");
  lines.push("");
  lines.push(
    `- **all checks pass**: ${allChecksPass ? "✓" : "✗"}`,
  );
  lines.push(
    "- **rollback path**: replace any region's `REGION_PROMPT_GUIDANCE` value with `\"\"` to revert that region's fallback prompt to the pre-R2 baseline.",
  );
  lines.push(
    "- **claude remains fallback only**: validated by inspection — `runHybridIdeator` only calls `generateIdeas` when fewer than 3 local candidates clear the scorer (header comment lines 8-10 of `hybridIdeator.ts`); R2 only changes the system prompt content, not the trigger condition.",
  );
  lines.push(
    "- **validators unchanged**: Claude output continues to flow through `ideaSchema.parse` (strict) → `recoverPartialIdeas` (safeParse) → `recoverIdeasWithHookFix` (safeParse) → comedy + scenarioCoherence + anti-copy gates. R2 cannot loosen acceptance.",
  );
  lines.push("");

  const __filename = fileURLToPath(import.meta.url);
  const workspaceRoot = path.resolve(path.dirname(__filename), "../../../..");
  const outDir = path.join(workspaceRoot, ".local");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "REGIONAL_R2_QA.md");
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  console.error(`[regionalR2Qa] wrote ${lines.length} lines to ${outPath}`);
}

main();
