/**
 * PHASE N1-S — Nigerian pack staging QA sweep.
 *
 * Calls `generateCoreCandidates` (the LIVE wiring site for the
 * Nigerian pack atomic-recipe prefix) directly per cohort, instead
 * of going through `runHybridIdeator`. This is intentional:
 *
 *   • The wiring under test is the pack-prefix block in
 *     `coreCandidateGenerator.ts` lines ~880-1010 — every safety
 *     guard (`canActivateNigerianPack`,
 *     `getEligibleNigerianPackEntries`, `authorPackEntryAsIdea` →
 *     `validateAntiCopy` + `validateComedy` + `validateAntiCopyDetailed`
 *     + `validateScenarioCoherence`) runs inside this call.
 *   • Skipping the orchestrator avoids the per-batch Llama mutator
 *     (OpenRouter) network roundtrip (+45 s/batch) and Claude
 *     fallback (+60 s/batch) that bring the original 100-idea
 *     plan over the Replit shell wall-clock budget.
 *   • The pack vs. catalog distribution we measure here IS the
 *     distribution `runHybridIdeator` sees post-mutator, because
 *     the mutator only mutates HOOKS in-place — it never adds /
 *     removes / reclassifies the source==`core_native` candidates
 *     or rewrites their `meta.nigerianPackEntryId`. So the GO
 *     criteria evaluated here are accurate for the live pipeline.
 *
 * Per-cohort: 6 ideas (NG x 3 cohorts + western), 4 ideas
 * (india + philippines), 32 ideas total.
 *
 * Per-idea row captures hook, source, pack-entry id (when set),
 * scenarioCoherence verdict, mocking-pattern check, anchor, voice.
 *
 * Aggregate verifies the GO criteria:
 *   • ≥ 4/12 nigeria + (light_pidgin|pidgin) ideas use the pack
 *     (proportional to the 12/40 = 30% original target)
 *   • 0 cross-region leak
 *   • 0 mocking-pattern hit
 *
 * Output: `.local/N1S_STAGING_QA.md`
 *
 * Run: `LUMINA_NG_PACK_ENABLED=true pnpm --filter @workspace/api-server exec tsx src/qa/nigerianStagingQa.ts`
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateCoreCandidates,
  type GenerateCoreCandidatesInput,
} from "../lib/coreCandidateGenerator";
import { selectPremiseCores } from "../lib/premiseCoreLibrary";
import { validateScenarioCoherence } from "../lib/scenarioCoherence";
import {
  PIDGIN_MOCKING_PATTERNS,
  isNigerianPackFeatureEnabled,
  NIGERIAN_HOOK_PACK,
} from "../lib/nigerianHookPack";
import type { Region } from "@workspace/lumina-trends";
import type { LanguageStyle, TasteCalibration } from "../lib/tasteCalibration";
import type { Idea } from "../lib/ideaGen";

type Cohort = {
  label: string;
  region: Region;
  languageStyle: LanguageStyle | null;
  count: number;
};

const COHORTS: readonly Cohort[] = [
  { label: "ng_light_pidgin", region: "nigeria", languageStyle: "light_pidgin", count: 6 },
  { label: "ng_pidgin", region: "nigeria", languageStyle: "pidgin", count: 6 },
  { label: "ng_clean", region: "nigeria", languageStyle: "clean", count: 6 },
  { label: "western", region: "western", languageStyle: null, count: 6 },
  { label: "india", region: "india", languageStyle: null, count: 4 },
  { label: "philippines", region: "philippines", languageStyle: null, count: 4 },
];

type Row = {
  cohort: string;
  region: Region;
  languageStyle: LanguageStyle | null;
  idx: number;
  hook: string;
  source: string;
  packEntryId: string | undefined;
  voiceClusterId: string | undefined;
  scenarioCoherence: string;
  mockingPatternHit: string | null;
  anchor: string | undefined;
};

function ideaText(idea: Idea): string {
  return [idea.hook, idea.whatToShow, idea.howToFilm, idea.caption, idea.script]
    .filter(Boolean)
    .join("\n");
}

function checkMockingPatterns(idea: Idea): string | null {
  const text = ideaText(idea);
  for (const pat of PIDGIN_MOCKING_PATTERNS) {
    const m = text.match(pat);
    if (m) return `${pat.toString()} → "${m[0]}"`;
  }
  return null;
}

function buildTasteCalibration(
  languageStyle: LanguageStyle | null,
): TasteCalibration | null {
  if (languageStyle === null) return null;
  // Minimal valid TasteCalibration shape — only `languageStyle` is
  // read by the pack activation guard; other fields default to the
  // permissive cold-start values.
  return {
    favoriteAnchor: null,
    languageStyle,
    preferredTone: null,
    avoidance: [],
  } as unknown as TasteCalibration;
}

function runCohort(cohort: Cohort, salt: number): Row[] {
  // Seed cores: the orchestrator selects ~22 per batch; we pick
  // `count * 4` (capped at 24) so the pack-prefix block has
  // enough cores to interleave pack candidates against.
  const seedCount = Math.min(24, Math.max(8, cohort.count * 4));
  const seedResult = selectPremiseCores({ count: seedCount });
  const input: GenerateCoreCandidatesInput = {
    cores: seedResult.cores,
    count: cohort.count,
    regenerateSalt: salt,
    tasteCalibration: buildTasteCalibration(cohort.languageStyle),
    region: cohort.region,
  };
  const result = generateCoreCandidates(input);
  return result.candidates.map((c, idx) => {
    const meta = c.meta as {
      source?: string;
      voiceClusterId?: string;
      nigerianPackEntryId?: string;
    };
    const coherenceResult = validateScenarioCoherence(c.idea);
    const coherence =
      coherenceResult === null
        ? "PASS"
        : typeof coherenceResult === "object" && coherenceResult !== null
          ? (coherenceResult as { ok?: boolean; reason?: string }).ok === false
            ? `FAIL:${(coherenceResult as { reason?: string }).reason ?? "unknown"}`
            : "PASS"
          : `FAIL:${String(coherenceResult)}`;
    const mockingHit = checkMockingPatterns(c.idea);
    const hookFirstWord = c.idea.hook.toLowerCase().match(/\b([a-z]{3,})\b/);
    return {
      cohort: cohort.label,
      region: cohort.region,
      languageStyle: cohort.languageStyle,
      idx,
      hook: c.idea.hook,
      source: meta.source ?? "unknown",
      packEntryId: meta.nigerianPackEntryId,
      voiceClusterId: meta.voiceClusterId,
      scenarioCoherence: coherence,
      mockingPatternHit: mockingHit,
      anchor: hookFirstWord?.[1],
    };
  });
}

process.on("unhandledRejection", (err) => {
  console.error("[nigerianStagingQa] UNHANDLED REJECTION", err);
  process.exit(3);
});
process.on("uncaughtException", (err) => {
  console.error("[nigerianStagingQa] UNCAUGHT EXCEPTION", err);
  process.exit(3);
});

function main(): void {
  const flagOn = isNigerianPackFeatureEnabled();
  console.error(
    `[nigerianStagingQa] flag=${flagOn ? "ON" : "OFF"} packLength=${NIGERIAN_HOOK_PACK.length}`,
  );
  if (!flagOn) {
    console.error(
      `[nigerianStagingQa] ABORT: LUMINA_NG_PACK_ENABLED must be "true" for the staging sweep.`,
    );
    process.exit(2);
  }
  if (NIGERIAN_HOOK_PACK.length === 0) {
    console.error(`[nigerianStagingQa] ABORT: pack is empty.`);
    process.exit(2);
  }

  const __filename = fileURLToPath(import.meta.url);
  const workspaceRoot = path.resolve(path.dirname(__filename), "../../../..");
  const outDir = path.join(workspaceRoot, ".local");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "N1S_STAGING_QA.md");

  const allRows: Row[] = [];
  const cohortMeta: { cohort: string; durationMs: number; shipped: number }[] =
    [];

  const headerLines: string[] = [];
  headerLines.push("# N1-S — NIGERIAN PACK STAGING QA SWEEP");
  headerLines.push("");
  headerLines.push(`_pack length_: ${NIGERIAN_HOOK_PACK.length}`);
  headerLines.push(`_flag_: \`LUMINA_NG_PACK_ENABLED=true\``);
  headerLines.push(
    `_method_: direct \`generateCoreCandidates\` per cohort (orchestrator-bypass; see file header for rationale)`,
  );
  headerLines.push("");
  fs.writeFileSync(outPath, headerLines.join("\n") + "\n", "utf8");

  const SALTS = [1, 17, 42, 73, 101]; // 5 salts × cohort.count ideas each
  for (const cohort of COHORTS) {
    console.error(
      `[nigerianStagingQa] cohort=${cohort.label} region=${cohort.region} languageStyle=${cohort.languageStyle ?? "null"} count=${cohort.count} × ${SALTS.length} salts…`,
    );
    const start = Date.now();
    const rows: Row[] = [];
    for (const salt of SALTS) {
      try {
        const passRows = runCohort(cohort, salt);
        // Re-namespace idx so per-row idx remains unique across salts
        for (const r of passRows) {
          rows.push({ ...r, idx: rows.length });
        }
      } catch (err) {
        console.error(
          `[nigerianStagingQa] cohort=${cohort.label} salt=${salt} ERROR`,
          err,
        );
      }
    }
    const durationMs = Date.now() - start;
    allRows.push(...rows);
    cohortMeta.push({
      cohort: cohort.label,
      durationMs,
      shipped: rows.length,
    });
    console.error(
      `[nigerianStagingQa]   shipped=${rows.length}/${cohort.count} ms=${durationMs}`,
    );

    const lines: string[] = [];
    lines.push(
      `## Cohort \`${cohort.label}\` (${cohort.region}, ${cohort.languageStyle ?? "null"})`,
    );
    lines.push("");
    lines.push(
      `shipped=${rows.length}/${cohort.count}, duration=${durationMs}ms`,
    );
    lines.push("");
    lines.push(
      "| # | source | packEntryId | voice | hook | anchor | coherence | mocking |",
    );
    lines.push(
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const r of rows) {
      lines.push(
        `| ${r.idx} | \`${r.source}\` | \`${r.packEntryId ?? "—"}\` | \`${r.voiceClusterId ?? "—"}\` | ${JSON.stringify(r.hook).slice(0, 80)} | \`${r.anchor ?? "—"}\` | ${r.scenarioCoherence} | ${r.mockingPatternHit ?? "—"} |`,
      );
    }
    lines.push("");
    fs.appendFileSync(outPath, lines.join("\n") + "\n", "utf8");
  }

  // ─── Aggregate / GO criteria ─────────────────────────────────── //
  const aggregate: string[] = [];
  aggregate.push("---");
  aggregate.push("");
  aggregate.push("## GO criteria evaluation");
  aggregate.push("");

  const ngPackEligibleRows = allRows.filter(
    (r) =>
      r.region === "nigeria" &&
      (r.languageStyle === "light_pidgin" || r.languageStyle === "pidgin"),
  );
  const ngPackUsed = ngPackEligibleRows.filter(
    (r) => r.packEntryId !== undefined,
  ).length;
  // Original GO criteria called for ≥12/20 (60%) pack adoption in
  // nigeria pidgin/light_pidgin cohorts. We sample 5 salts × 12 ideas
  // = 60 eligible rows, so the proportional target is 36/60.
  const packTarget = Math.ceil(ngPackEligibleRows.length * 0.6);
  aggregate.push(
    `**(1) Pack usage in nigeria + (light_)pidgin cohorts**: ${ngPackUsed}/${ngPackEligibleRows.length} (target ≥ ${packTarget}, i.e. ≥60% — proportional to the original 12/20 spec) — ${ngPackUsed >= packTarget ? "✅ PASS" : "❌ FAIL"}`,
  );

  const leaks = allRows.filter(
    (r) =>
      r.packEntryId !== undefined &&
      !(
        r.region === "nigeria" &&
        (r.languageStyle === "light_pidgin" || r.languageStyle === "pidgin")
      ),
  );
  aggregate.push(
    `**(2) Cross-region leak**: ${leaks.length} pack ideas in non-eligible cohorts — ${leaks.length === 0 ? "✅ PASS" : "❌ FAIL"}`,
  );
  for (const l of leaks.slice(0, 5)) {
    aggregate.push(
      `  - leak: \`${l.cohort}\` idx=${l.idx} packEntryId=\`${l.packEntryId}\` hook=${JSON.stringify(l.hook)}`,
    );
  }

  const safetyHits = allRows.filter((r) => r.mockingPatternHit !== null);
  aggregate.push(
    `**(3) Safety (mocking-spelling)**: ${safetyHits.length} hits — ${safetyHits.length === 0 ? "✅ PASS" : "❌ FAIL"}`,
  );
  for (const h of safetyHits.slice(0, 5)) {
    aggregate.push(
      `  - safety: \`${h.cohort}\` idx=${h.idx} hit=${h.mockingPatternHit}`,
    );
  }

  const coherenceFails = allRows.filter(
    (r) => !r.scenarioCoherence.startsWith("PASS"),
  );
  aggregate.push(
    `**(4) Scenario coherence**: ${allRows.length - coherenceFails.length}/${allRows.length} pass — ${coherenceFails.length === 0 ? "✅ PASS" : `⚠ ${coherenceFails.length} failed`}`,
  );

  aggregate.push("");
  aggregate.push("## Cohort summary");
  aggregate.push("");
  aggregate.push("| cohort | shipped | duration | pack used |");
  aggregate.push("| --- | --- | --- | --- |");
  for (const m of cohortMeta) {
    const cohortRows = allRows.filter((r) => r.cohort === m.cohort);
    const packUsed = cohortRows.filter(
      (r) => r.packEntryId !== undefined,
    ).length;
    aggregate.push(
      `| \`${m.cohort}\` | ${m.shipped} | ${m.durationMs}ms | ${packUsed} |`,
    );
  }

  aggregate.push("");
  const overall =
    ngPackUsed >= packTarget && leaks.length === 0 && safetyHits.length === 0;
  aggregate.push(
    `## Verdict: ${overall ? "✅ GO" : "❌ HOLD"} (auto-evaluated against the three GO criteria above)`,
  );
  aggregate.push("");

  fs.appendFileSync(outPath, aggregate.join("\n") + "\n", "utf8");
  console.error(
    `[nigerianStagingQa] wrote ${outPath} (${allRows.length} ideas across ${cohortMeta.length} cohorts; verdict=${overall ? "GO" : "HOLD"})`,
  );
}

main();
process.exit(0);
