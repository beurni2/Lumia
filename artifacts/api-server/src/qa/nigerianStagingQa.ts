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
import { applyNigerianPackSlotReservation } from "../lib/nigerianPackSlotReservation";
import type { ScoredCandidate, IdeaScore } from "../lib/ideaScorer";
import type { Region } from "@workspace/lumina-trends";
import type { LanguageStyle, TasteCalibration } from "../lib/tasteCalibration";
import type { Idea } from "../lib/ideaGen";

type Cohort = {
  label: string;
  region: Region;
  languageStyle: LanguageStyle | null;
  count: number;
};

// N1-S2 acceptance targets call for 30/30/30/30/20/20 shipped ideas.
// We model the production batch shape (desiredCount=3) faithfully so
// the slot-reservation helper sees the same layout as runHybridIdeator
// would: 10 batches of 3 ideas per nigeria/western cohort = 30 ideas;
// for india/philippines the spec asks for 20 ideas total → ~7 batches
// (rounded up to give 21 ideas, then trimmed to 20).
const COHORTS: readonly Cohort[] = [
  { label: "ng_light_pidgin", region: "nigeria", languageStyle: "light_pidgin", count: 30 },
  { label: "ng_pidgin", region: "nigeria", languageStyle: "pidgin", count: 30 },
  { label: "ng_clean", region: "nigeria", languageStyle: "clean", count: 30 },
  { label: "western", region: "western", languageStyle: null, count: 30 },
  { label: "india", region: "india", languageStyle: null, count: 20 },
  { label: "philippines", region: "philippines", languageStyle: null, count: 20 },
];

const PRODUCTION_BATCH_SIZE = 3; // mirrors hybridIdeator desiredCount

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

// Wrap a per-core candidate as a ScoredCandidate so we can feed it
// through `applyNigerianPackSlotReservation`. The slot reservation
// helper only reads `score.total` (for ranking pack candidates) and
// `meta` + `idea` (for dedup); the other IdeaScore axes are not
// inspected, so we synthesize an IdeaScore from `meta.hookQualityScore`
// and zero the rest. This matches what `filterAndRescore` would
// produce in the orchestrator path for the dedup/ranking purposes
// the helper exercises.
function asScoredCandidate(c: {
  idea: Idea;
  meta: { hookQualityScore?: number };
}): ScoredCandidate {
  const total = c.meta.hookQualityScore ?? 0;
  const score: IdeaScore = {
    hookImpact: 0,
    personalFit: 0,
    novelty: 0,
    timeliness: 0,
    captionQuality: 0,
    visualClarity: 0,
    riskScore: 0,
    confidence: 0,
    total,
    lowEffortSetting: false,
    captionSynergy: 0,
    isHero: false,
  } as unknown as IdeaScore;
  return {
    idea: c.idea,
    meta: c.meta as ScoredCandidate["meta"],
    score,
    rewriteAttempted: false,
  };
}

function runCohortBatch(cohort: Cohort, salt: number): Row[] {
  // Seed cores: production runs ~22 cores per batch and emits one
  // best-of candidate per core into the merged pool. We mirror that
  // here so the slot-reservation helper sees a candidate pool of
  // ~22 (mixed pack + catalog), the same shape `runHybridIdeator`
  // hands it post-validation. With only `desiredCount + 3` the
  // pool would lack enough pack candidates for the helper to
  // reserve 2 of 3 slots reliably (the pack-prefix block caps
  // per-core pack draws at NIGERIAN_PACK_PREFIX_CAP = 3 and the
  // per-core winner is picked by `>` strict on hookQualityScore,
  // so a wider pool is necessary to surface the full pack supply).
  const seedResult = selectPremiseCores({ count: 22 });
  const input: GenerateCoreCandidatesInput = {
    cores: seedResult.cores,
    count: 22,
    regenerateSalt: salt,
    tasteCalibration: buildTasteCalibration(cohort.languageStyle),
    region: cohort.region,
  };
  const result = generateCoreCandidates(input);
  // Wrap candidates as ScoredCandidates and apply slot reservation
  // exactly as `runHybridIdeator` does (post-batch-composition,
  // pre-final-ship). The helper's activation guard short-circuits
  // for every cohort other than nigeria + pidgin/light_pidgin.
  const wrapped = result.candidates.map(asScoredCandidate);
  // Upstream "selection.batch" — first PRODUCTION_BATCH_SIZE wrapped
  // candidates (mirrors the highest-quality-first ordering inside
  // the per-core loop's `passing[]` selection).
  const selectionBatch = wrapped.slice(0, PRODUCTION_BATCH_SIZE);
  const reordered = applyNigerianPackSlotReservation({
    selectionBatch,
    candidatePool: wrapped,
    desiredCount: PRODUCTION_BATCH_SIZE,
    region: cohort.region,
    languageStyle: cohort.languageStyle,
    flagEnabled: isNigerianPackFeatureEnabled(),
    packLength: NIGERIAN_HOOK_PACK.length,
  });
  return reordered.map((c, idx) => {
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

// Drive the cohort to its desired total idea count by running
// `cohort.count / PRODUCTION_BATCH_SIZE` independent 3-idea batches,
// each with a distinct regenerate salt. Trims the final batch if
// the total would exceed cohort.count.
function runCohort(cohort: Cohort, baseSalt: number): Row[] {
  const totalBatches = Math.ceil(cohort.count / PRODUCTION_BATCH_SIZE);
  const out: Row[] = [];
  for (let b = 0; b < totalBatches; b++) {
    const salt = baseSalt + b * 17;
    const rows = runCohortBatch(cohort, salt);
    for (const r of rows) {
      if (out.length >= cohort.count) break;
      out.push({ ...r, idx: out.length });
    }
    if (out.length >= cohort.count) break;
  }
  return out;
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

  // Per-cohort base salt — each cohort gets its own seed so the
  // cross-cohort core selection isn't pinned to one slate. The
  // `runCohort` driver runs cohort.count / PRODUCTION_BATCH_SIZE
  // independent 3-idea batches internally with salt+(b*17).
  const COHORT_BASE_SALTS: Record<string, number> = {
    ng_light_pidgin: 1,
    ng_pidgin: 1009,
    ng_clean: 2017,
    western: 3023,
    india: 4001,
    philippines: 5003,
  };
  for (const cohort of COHORTS) {
    const baseSalt = COHORT_BASE_SALTS[cohort.label] ?? 1;
    const totalBatches = Math.ceil(cohort.count / PRODUCTION_BATCH_SIZE);
    console.error(
      `[nigerianStagingQa] cohort=${cohort.label} region=${cohort.region} languageStyle=${cohort.languageStyle ?? "null"} count=${cohort.count} (${totalBatches} batches × ${PRODUCTION_BATCH_SIZE} ideas)…`,
    );
    const start = Date.now();
    let rows: Row[] = [];
    try {
      rows = runCohort(cohort, baseSalt);
    } catch (err) {
      console.error(`[nigerianStagingQa] cohort=${cohort.label} ERROR`, err);
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
  // N1-S2 acceptance:
  //   • nigeria + light_pidgin pack usage ≥ 18/30
  //   • nigeria + pidgin       pack usage ≥ 18/30
  //   • combined eligible      pack usage ≥ 60%
  const ngLightRows = allRows.filter(
    (r) => r.cohort === "ng_light_pidgin",
  );
  const ngLightPackUsed = ngLightRows.filter(
    (r) => r.packEntryId !== undefined,
  ).length;
  const ngPidginRows = allRows.filter((r) => r.cohort === "ng_pidgin");
  const ngPidginPackUsed = ngPidginRows.filter(
    (r) => r.packEntryId !== undefined,
  ).length;
  const PER_COHORT_TARGET = 18;
  const COMBINED_TARGET_PCT = 0.6;
  const combinedTarget = Math.ceil(
    ngPackEligibleRows.length * COMBINED_TARGET_PCT,
  );
  aggregate.push(
    `**(1a) Pack usage — nigeria + light_pidgin**: ${ngLightPackUsed}/${ngLightRows.length} (target ≥ ${PER_COHORT_TARGET}/30) — ${ngLightPackUsed >= PER_COHORT_TARGET ? "✅ PASS" : "❌ FAIL"}`,
  );
  aggregate.push(
    `**(1b) Pack usage — nigeria + pidgin**: ${ngPidginPackUsed}/${ngPidginRows.length} (target ≥ ${PER_COHORT_TARGET}/30) — ${ngPidginPackUsed >= PER_COHORT_TARGET ? "✅ PASS" : "❌ FAIL"}`,
  );
  aggregate.push(
    `**(1c) Pack usage — combined eligible**: ${ngPackUsed}/${ngPackEligibleRows.length} (target ≥ ${combinedTarget}, i.e. ≥60%) — ${ngPackUsed >= combinedTarget ? "✅ PASS" : "❌ FAIL"}`,
  );
  // ng_clean must NEVER draw from pack
  const ngCleanRows = allRows.filter((r) => r.cohort === "ng_clean");
  const ngCleanPackUsed = ngCleanRows.filter(
    (r) => r.packEntryId !== undefined,
  ).length;
  aggregate.push(
    `**(1d) Pack usage — nigeria + clean (must be 0)**: ${ngCleanPackUsed}/${ngCleanRows.length} — ${ngCleanPackUsed === 0 ? "✅ PASS" : "❌ FAIL"}`,
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
    ngLightPackUsed >= PER_COHORT_TARGET &&
    ngPidginPackUsed >= PER_COHORT_TARGET &&
    ngPackUsed >= combinedTarget &&
    ngCleanPackUsed === 0 &&
    leaks.length === 0 &&
    safetyHits.length === 0;
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
