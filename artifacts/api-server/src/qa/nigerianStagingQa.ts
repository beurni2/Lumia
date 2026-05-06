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
export const COHORTS: readonly Cohort[] = [
  { label: "ng_light_pidgin", region: "nigeria", languageStyle: "light_pidgin", count: 30 },
  { label: "ng_pidgin", region: "nigeria", languageStyle: "pidgin", count: 30 },
  { label: "ng_clean", region: "nigeria", languageStyle: "clean", count: 30 },
  { label: "western", region: "western", languageStyle: null, count: 30 },
  { label: "india", region: "india", languageStyle: null, count: 20 },
  { label: "philippines", region: "philippines", languageStyle: null, count: 20 },
];

const PRODUCTION_BATCH_SIZE = 3; // mirrors hybridIdeator desiredCount

export type Row = {
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
  westernLeakHit: string | null;
  anchor: string | undefined;
};

// PHASE N1-FULL-SPEC — Western-anchor leakage detection.
// Spec §"REGION-WRONG OUTPUTS": Nigerian Pidgin/light_pidgin users
// must not see obviously Western-specific anchors. Scans the FULL
// idea text (hook + whatToShow + howToFilm + caption + script) for
// US/UK-only brand and daily-life terms. Word-boundary matched so
// "target" inside other words is not falsely flagged.
const WESTERN_ONLY_TERMS: readonly RegExp[] = [
  /\bvenmo\b/i,
  /\bzelle\b/i,
  /\bcashapp\b/i,
  /\bcash app\b/i,
  /\bdoordash\b/i,
  /\bgrubhub\b/i,
  /\bubereats\b/i,
  /\buber eats\b/i,
  /\bwalmart\b/i,
  /\btarget store\b/i,
  /\bcostco\b/i,
  /\btrader joe('s)?\b/i,
  /\bwhole foods\b/i,
  /\bairpods\b/i,
  /\bstarbucks\b/i,
  /\bdunkin('|s)?\b/i,
  /\bchipotle\b/i,
  /\b401k\b/i,
  /\bdmv\b/i,
  /\bcvs\b/i,
  /\bwalgreens\b/i,
];

function checkWesternLeak(idea: Idea): string | null {
  const text = ideaText(idea);
  for (const re of WESTERN_ONLY_TERMS) {
    const m = text.match(re);
    if (m) return `${re.toString()} → "${m[0]}"`;
  }
  return null;
}

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
    const westernLeak = checkWesternLeak(c.idea);
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
      westernLeakHit: westernLeak,
      anchor: hookFirstWord?.[1],
    };
  });
}

// Drive the cohort to its desired total idea count by running
// `cohort.count / PRODUCTION_BATCH_SIZE` independent 3-idea batches,
// each with a distinct regenerate salt. Trims the final batch if
// the total would exceed cohort.count.
export function runCohort(cohort: Cohort, baseSalt: number): Row[] {
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

// ─── Deterministic Math.random override (PHASE N1-QA-DET, 2026-05-06) ─── //
//
// Why: `selectPremiseCores` (and indirectly other call sites in the
// generation pipeline) rely on `Math.random` for stochastic core
// selection. With unseeded `Math.random` the harness produced a
// per-run combined fill anywhere in 24-35/60 — a ±5 spread that
// made single-sample GO/HOLD verdicts noise-driven (see
// `.local/N1_ROTATION_FIX_PROPOSAL.md` Outcome appendix and
// `.local/N1_ROTATION_REGRESSION_ANALYSIS.md` top-of-doc correction
// for the full post-mortem).
//
// What this does: we replace the global `Math.random` with a seeded
// mulberry32 PRNG inside each `runOneSweep(seed)` call and restore
// the original immediately after. Same seed → byte-identical output.
//
// Run modes (PHASE N1-QA-DET-MEDIAN, 2026-05-06):
//   • `LUMINA_NG_QA_SEED` unset / `=sweep` → MULTI-SEED MEDIAN MODE
//     (default). Runs 5 seeds (1, 7, 42, 1337, 31337), reports per-
//     seed metrics + median verdict. Median pack-fill ≥ threshold +
//     all 5 runs satisfy correctness criteria (no ng_clean leaks,
//     no cross-region leaks, no safety hits) → GO. ~5× runtime.
//   • `LUMINA_NG_QA_SEED=<int>` → SINGLE-SEED MODE. Runs that one
//     seed and emits the legacy detailed per-cohort report.
//   • `LUMINA_NG_QA_SEED=random` → LEGACY non-deterministic mode
//     (does not override Math.random). Single-sample run.
//
// Hard-rule compliance:
//   • This only affects the QA harness process. Production server
//     code is untouched (the harness is a CLI script, never imported
//     by the running API).
//   • No validator, scorer, threshold, or pack content changed.
//   • Non-NG cohorts behave identically to NG cohorts — the override
//     applies uniformly to every cohort in the same process, so
//     cross-cohort relative behaviour is preserved.
const __ORIGINAL_MATH_RANDOM = Math.random;
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function (): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function withSeededRandom<T>(seed: number | "random", fn: () => T): T {
  if (seed === "random") {
    // Don't override — caller wants legacy non-deterministic behaviour.
    return fn();
  }
  Math.random = mulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = __ORIGINAL_MATH_RANDOM;
  }
}

// ─── GO-criteria thresholds (module-level so sweep + single share) ─── //
//
// PHASE N1-FULL-SPEC — targets recalibrated honestly after the
// BI 2026-05-06 ingest expanded the live pack from 50 → 204 entries.
// Spec floor (§GO criteria) is ≥4/12 = 33%; we exceed it by ~1.5×.
// The 50% combined / 13-per-cohort targets remain calibrated to the
// LOWER bound of observed run-to-run variance (24-35 combined under
// unseeded Math.random) so a median across 5 seeds reliably clears
// them when the pack is healthy.
const PER_COHORT_TARGET = 13;
const COMBINED_TARGET_PCT = 0.5;

// Default sweep seeds — provenance:
//   • Five common, "obvious" small integers chosen for memorability:
//     1 (canonical), 7 (lucky), 42 (HHGTTG), 1337 (leet), 31337 (eleet).
//   • All five were committed to `.local/N1_QA_SEED_SWEEP.md` BEFORE
//     sweep results were observed (see git log for that doc); the same
//     five are reused here unchanged so a reviewer can audit the
//     selection chain via git history.
//   • Anti-cherry-pick rule: NEVER reorder, replace, or "rotate" this
//     list based on observed verdicts. Adding seeds is allowed only
//     if the additions are committed to the doc + this constant
//     simultaneously, before observing their fill rates. Doing
//     otherwise is the same class of integrity violation as tuning
//     the GO threshold downward to mask a HOLD.
//   • The list is intentionally kept at 5 (odd) so the median is a
//     concrete observed value, not a synthesized average of two.
export const DEFAULT_SWEEP_SEEDS = [1, 7, 42, 1337, 31337] as const;

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

type SweepMetrics = {
  ngLightPackUsed: number;
  ngLightTotal: number;
  ngPidginPackUsed: number;
  ngPidginTotal: number;
  ngPackUsed: number;
  ngPackEligibleTotal: number;
  combinedTarget: number;
  ngCleanPackUsed: number;
  leakCount: number;
  safetyHitCount: number;
  westernLeakCount: number;
  westernLeakDenom: number;
  coherenceFails: number;
  totalRows: number;
  perSeedVerdict: boolean;
};

type SweepRun = {
  seed: number | "random";
  metrics: SweepMetrics;
  allRows: Row[];
  cohortMeta: { cohort: string; durationMs: number; shipped: number }[];
};

// Run all cohorts once under a single seed. Returns metrics + raw
// rows in memory; does NO file I/O so the caller can compose either
// a single-seed report or a multi-seed median report.
function runOneSweep(seed: number | "random"): SweepRun {
  return withSeededRandom(seed, () => {
    const allRows: Row[] = [];
    const cohortMeta: SweepRun["cohortMeta"] = [];

    for (const cohort of COHORTS) {
      const baseSalt = COHORT_BASE_SALTS[cohort.label] ?? 1;
      const totalBatches = Math.ceil(cohort.count / PRODUCTION_BATCH_SIZE);
      console.error(
        `[nigerianStagingQa] seed=${seed} cohort=${cohort.label} region=${cohort.region} languageStyle=${cohort.languageStyle ?? "null"} count=${cohort.count} (${totalBatches} batches × ${PRODUCTION_BATCH_SIZE} ideas)…`,
      );
      const start = Date.now();
      let rows: Row[] = [];
      try {
        rows = runCohort(cohort, baseSalt);
      } catch (err) {
        console.error(
          `[nigerianStagingQa] seed=${seed} cohort=${cohort.label} ERROR`,
          err,
        );
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
    }

    const ngPackEligibleRows = allRows.filter(
      (r) =>
        r.region === "nigeria" &&
        (r.languageStyle === "light_pidgin" || r.languageStyle === "pidgin"),
    );
    const ngPackUsed = ngPackEligibleRows.filter(
      (r) => r.packEntryId !== undefined,
    ).length;
    const ngLightRows = allRows.filter((r) => r.cohort === "ng_light_pidgin");
    const ngLightPackUsed = ngLightRows.filter(
      (r) => r.packEntryId !== undefined,
    ).length;
    const ngPidginRows = allRows.filter((r) => r.cohort === "ng_pidgin");
    const ngPidginPackUsed = ngPidginRows.filter(
      (r) => r.packEntryId !== undefined,
    ).length;
    const ngCleanRows = allRows.filter((r) => r.cohort === "ng_clean");
    const ngCleanPackUsed = ngCleanRows.filter(
      (r) => r.packEntryId !== undefined,
    ).length;
    const leaks = allRows.filter(
      (r) =>
        r.packEntryId !== undefined &&
        !(
          r.region === "nigeria" &&
          (r.languageStyle === "light_pidgin" ||
            r.languageStyle === "pidgin")
        ),
    );
    const safetyHits = allRows.filter((r) => r.mockingPatternHit !== null);
    const ngEligibleNonPackRows = ngPackEligibleRows.filter(
      (r) => r.packEntryId === undefined,
    );
    const westernLeaks = ngEligibleNonPackRows.filter(
      (r) => r.westernLeakHit !== null,
    );
    const coherenceFails = allRows.filter(
      (r) => !r.scenarioCoherence.startsWith("PASS"),
    ).length;
    const combinedTarget = Math.ceil(
      ngPackEligibleRows.length * COMBINED_TARGET_PCT,
    );
    const perSeedVerdict =
      ngLightPackUsed >= PER_COHORT_TARGET &&
      ngPidginPackUsed >= PER_COHORT_TARGET &&
      ngPackUsed >= combinedTarget &&
      ngCleanPackUsed === 0 &&
      leaks.length === 0 &&
      safetyHits.length === 0;

    const metrics: SweepMetrics = {
      ngLightPackUsed,
      ngLightTotal: ngLightRows.length,
      ngPidginPackUsed,
      ngPidginTotal: ngPidginRows.length,
      ngPackUsed,
      ngPackEligibleTotal: ngPackEligibleRows.length,
      combinedTarget,
      ngCleanPackUsed,
      leakCount: leaks.length,
      safetyHitCount: safetyHits.length,
      westernLeakCount: westernLeaks.length,
      westernLeakDenom: ngEligibleNonPackRows.length,
      coherenceFails,
      totalRows: allRows.length,
      perSeedVerdict,
    };
    return { seed, metrics, allRows, cohortMeta };
  });
}

// ─── Per-seed detail block (used in single-seed mode and as the
// trailing detail section in multi-seed mode for the median seed). ─── //
function buildPerSeedDetail(run: SweepRun): string[] {
  const lines: string[] = [];
  for (const cm of run.cohortMeta) {
    const cohortRows = run.allRows.filter((r) => r.cohort === cm.cohort);
    const cohort = COHORTS.find((c) => c.label === cm.cohort);
    lines.push(
      `## Cohort \`${cm.cohort}\` (${cohort?.region}, ${cohort?.languageStyle ?? "null"})`,
    );
    lines.push("");
    lines.push(
      `shipped=${cm.shipped}/${cohort?.count}, duration=${cm.durationMs}ms`,
    );
    lines.push("");
    lines.push(
      "| # | source | packEntryId | voice | hook | anchor | coherence | mocking |",
    );
    lines.push(
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const r of cohortRows) {
      lines.push(
        `| ${r.idx} | \`${r.source}\` | \`${r.packEntryId ?? "—"}\` | \`${r.voiceClusterId ?? "—"}\` | ${JSON.stringify(r.hook).slice(0, 80)} | \`${r.anchor ?? "—"}\` | ${r.scenarioCoherence} | ${r.mockingPatternHit ?? "—"} |`,
      );
    }
    lines.push("");
  }
  const m = run.metrics;
  lines.push("---");
  lines.push("");
  lines.push("## GO criteria evaluation (this seed)");
  lines.push("");
  lines.push(
    `**(1a) Pack usage — nigeria + light_pidgin**: ${m.ngLightPackUsed}/${m.ngLightTotal} (target ≥ ${PER_COHORT_TARGET}/30) — ${m.ngLightPackUsed >= PER_COHORT_TARGET ? "✅ PASS" : "❌ FAIL"}`,
  );
  lines.push(
    `**(1b) Pack usage — nigeria + pidgin**: ${m.ngPidginPackUsed}/${m.ngPidginTotal} (target ≥ ${PER_COHORT_TARGET}/30) — ${m.ngPidginPackUsed >= PER_COHORT_TARGET ? "✅ PASS" : "❌ FAIL"}`,
  );
  lines.push(
    `**(1c) Pack usage — combined eligible**: ${m.ngPackUsed}/${m.ngPackEligibleTotal} (target ≥ ${m.combinedTarget}, i.e. ≥${Math.round(COMBINED_TARGET_PCT * 100)}%) — ${m.ngPackUsed >= m.combinedTarget ? "✅ PASS" : "❌ FAIL"}`,
  );
  lines.push(
    `**(1d) Pack usage — nigeria + clean (must be 0)**: ${m.ngCleanPackUsed}/30 — ${m.ngCleanPackUsed === 0 ? "✅ PASS" : "❌ FAIL"}`,
  );
  lines.push(
    `**(2) Cross-region leak**: ${m.leakCount} pack ideas in non-eligible cohorts — ${m.leakCount === 0 ? "✅ PASS" : "❌ FAIL"}`,
  );
  lines.push(
    `**(3) Safety (mocking-spelling)**: ${m.safetyHitCount} hits — ${m.safetyHitCount === 0 ? "✅ PASS" : "❌ FAIL"}`,
  );
  lines.push(
    `**(4) Scenario coherence**: ${m.totalRows - m.coherenceFails}/${m.totalRows} pass — ${m.coherenceFails === 0 ? "✅ PASS" : `⚠ ${m.coherenceFails} failed`}`,
  );
  lines.push(
    `**(5) Western-anchor leakage in NG eligible non-pack slots**: ${m.westernLeakCount}/${m.westernLeakDenom} leaked — ${m.westernLeakCount === 0 ? "✅ PASS" : "⚠ AUDIT (catalog regional decoration gap; not a slot-reservation regression)"}`,
  );
  lines.push("");
  lines.push("## Cohort summary");
  lines.push("");
  lines.push("| cohort | shipped | duration | pack used |");
  lines.push("| --- | --- | --- | --- |");
  for (const cm of run.cohortMeta) {
    const cohortRows = run.allRows.filter((r) => r.cohort === cm.cohort);
    const packUsed = cohortRows.filter(
      (r) => r.packEntryId !== undefined,
    ).length;
    lines.push(
      `| \`${cm.cohort}\` | ${cm.shipped} | ${cm.durationMs}ms | ${packUsed} |`,
    );
  }
  lines.push("");
  lines.push(
    `## Verdict (this seed): ${m.perSeedVerdict ? "✅ GO" : "❌ HOLD"}`,
  );
  lines.push("");
  return lines;
}

function median(nums: readonly number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

// ─── Run mode parsing ─── //
type RunMode =
  | { kind: "sweep"; seeds: readonly number[] }
  | { kind: "single"; seed: number }
  | { kind: "random" };
function parseRunMode(): RunMode {
  const raw = process.env.LUMINA_NG_QA_SEED;
  if (raw === "random") return { kind: "random" };
  if (raw === undefined || raw === "" || raw === "sweep") {
    return { kind: "sweep", seeds: DEFAULT_SWEEP_SEEDS };
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed)) return { kind: "single", seed: parsed };
  return { kind: "sweep", seeds: DEFAULT_SWEEP_SEEDS };
}

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

  const mode = parseRunMode();
  const __filename = fileURLToPath(import.meta.url);
  const workspaceRoot = path.resolve(path.dirname(__filename), "../../../..");
  const outDir = path.join(workspaceRoot, ".local");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "N1S_STAGING_QA.md");

  const header: string[] = [];
  header.push("# N1-S — NIGERIAN PACK STAGING QA SWEEP");
  header.push("");
  header.push(`_pack length_: ${NIGERIAN_HOOK_PACK.length}`);
  header.push(`_flag_: \`LUMINA_NG_PACK_ENABLED=true\``);
  header.push(
    `_method_: direct \`generateCoreCandidates\` per cohort (orchestrator-bypass; see file header for rationale)`,
  );

  if (mode.kind === "random") {
    header.push(
      `_PRNG mode_: **random** (LEGACY non-deterministic; single-sample verdict is noise-driven)`,
    );
    header.push("");
    fs.writeFileSync(outPath, header.join("\n") + "\n", "utf8");
    console.error(`[nigerianStagingQa] mode=random (single-sample legacy)`);
    const run = runOneSweep("random");
    fs.appendFileSync(
      outPath,
      buildPerSeedDetail(run).join("\n") + "\n",
      "utf8",
    );
    console.error(
      `[nigerianStagingQa] wrote ${outPath} (verdict=${run.metrics.perSeedVerdict ? "GO" : "HOLD"})`,
    );
    return;
  }

  if (mode.kind === "single") {
    header.push(
      `_PRNG mode_: single-seed \`0x${mode.seed.toString(16)}\` (deterministic; same seed → byte-identical output)`,
    );
    header.push("");
    fs.writeFileSync(outPath, header.join("\n") + "\n", "utf8");
    console.error(
      `[nigerianStagingQa] mode=single seed=0x${mode.seed.toString(16)}`,
    );
    const run = runOneSweep(mode.seed);
    fs.appendFileSync(
      outPath,
      buildPerSeedDetail(run).join("\n") + "\n",
      "utf8",
    );
    console.error(
      `[nigerianStagingQa] wrote ${outPath} (verdict=${run.metrics.perSeedVerdict ? "GO" : "HOLD"})`,
    );
    return;
  }

  // ─── Multi-seed sweep (default) ─── //
  header.push(
    `_PRNG mode_: multi-seed median across ${mode.seeds.length} seeds [${mode.seeds.join(", ")}] (deterministic; reproducible)`,
  );
  header.push(
    `_overrides_: \`LUMINA_NG_QA_SEED=<int>\` for single-seed detail; \`=random\` for legacy non-deterministic`,
  );
  header.push("");
  fs.writeFileSync(outPath, header.join("\n") + "\n", "utf8");
  console.error(
    `[nigerianStagingQa] mode=sweep seeds=[${mode.seeds.join(",")}]`,
  );

  const runs: SweepRun[] = [];
  for (const seed of mode.seeds) {
    runs.push(runOneSweep(seed));
  }

  // Per-seed sweep table.
  const sweepTable: string[] = [];
  sweepTable.push("## Multi-seed sweep");
  sweepTable.push("");
  sweepTable.push(
    "| seed | combined / 60 | light_pidgin / 30 | pidgin / 30 | ng_clean | leaks | safety | per-seed verdict |",
  );
  sweepTable.push(
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const r of runs) {
    const m = r.metrics;
    sweepTable.push(
      `| \`${r.seed}\` | ${m.ngPackUsed}/${m.ngPackEligibleTotal} | ${m.ngLightPackUsed}/${m.ngLightTotal} | ${m.ngPidginPackUsed}/${m.ngPidginTotal} | ${m.ngCleanPackUsed} | ${m.leakCount} | ${m.safetyHitCount} | ${m.perSeedVerdict ? "✅ GO" : "❌ HOLD"} |`,
    );
  }
  sweepTable.push("");

  // Median across seeds — pack-fill metrics use median; correctness
  // criteria (ng_clean must be 0, no cross-region leaks, no safety
  // hits) require ALL seeds to satisfy them, since these are
  // categorical correctness gates not statistical ones.
  const medianCombined = median(runs.map((r) => r.metrics.ngPackUsed));
  const medianLight = median(runs.map((r) => r.metrics.ngLightPackUsed));
  const medianPidgin = median(runs.map((r) => r.metrics.ngPidginPackUsed));
  const combinedTargetCanonical = runs[0]!.metrics.combinedTarget;
  const allNgCleanZero = runs.every((r) => r.metrics.ngCleanPackUsed === 0);
  const allLeaksZero = runs.every((r) => r.metrics.leakCount === 0);
  const allSafetyZero = runs.every((r) => r.metrics.safetyHitCount === 0);
  const medianVerdict =
    medianCombined >= combinedTargetCanonical &&
    medianLight >= PER_COHORT_TARGET &&
    medianPidgin >= PER_COHORT_TARGET &&
    allNgCleanZero &&
    allLeaksZero &&
    allSafetyZero;

  const summary: string[] = [];
  summary.push("## Median verdict");
  summary.push("");
  summary.push(
    `- **combined median**: ${medianCombined}/60 (target ≥ ${combinedTargetCanonical}, i.e. ≥${Math.round(COMBINED_TARGET_PCT * 100)}%) — ${medianCombined >= combinedTargetCanonical ? "✅ PASS" : "❌ FAIL"}`,
  );
  summary.push(
    `- **light_pidgin median**: ${medianLight}/30 (target ≥ ${PER_COHORT_TARGET}/30) — ${medianLight >= PER_COHORT_TARGET ? "✅ PASS" : "❌ FAIL"}`,
  );
  summary.push(
    `- **pidgin median**: ${medianPidgin}/30 (target ≥ ${PER_COHORT_TARGET}/30) — ${medianPidgin >= PER_COHORT_TARGET ? "✅ PASS" : "❌ FAIL"}`,
  );
  summary.push(
    `- **ng_clean = 0 in ALL seeds**: ${allNgCleanZero ? "✅ PASS" : "❌ FAIL"}`,
  );
  summary.push(
    `- **cross-region leaks = 0 in ALL seeds**: ${allLeaksZero ? "✅ PASS" : "❌ FAIL"}`,
  );
  summary.push(
    `- **safety hits = 0 in ALL seeds**: ${allSafetyZero ? "✅ PASS" : "❌ FAIL"}`,
  );
  summary.push("");
  summary.push(
    `## Verdict: ${medianVerdict ? "✅ GO" : "❌ HOLD"} (median across ${mode.seeds.length} deterministic seeds; pack-fill uses median, correctness gates require ALL seeds)`,
  );
  summary.push("");

  // Pick the seed whose combined fill is closest to median for the
  // detail block (gives the reviewer a representative per-cohort view).
  const detailRun =
    runs.find((r) => r.metrics.ngPackUsed === medianCombined) ?? runs[0]!;
  const detailIntro: string[] = [];
  detailIntro.push("---");
  detailIntro.push("");
  detailIntro.push(
    `## Detailed per-cohort breakdown — seed \`${detailRun.seed}\` (representative-of-median)`,
  );
  detailIntro.push("");
  detailIntro.push(
    `_each seed in the sweep ran deterministically and reproducibly (same seed → byte-identical output). Only this representative seed's per-idea table is shown to keep the report manageable. Re-run with \`LUMINA_NG_QA_SEED=<seed>\` to see another seed's full detail._`,
  );
  detailIntro.push("");

  fs.appendFileSync(
    outPath,
    sweepTable.join("\n") +
      "\n" +
      summary.join("\n") +
      "\n" +
      detailIntro.join("\n") +
      "\n" +
      buildPerSeedDetail(detailRun).join("\n") +
      "\n",
    "utf8",
  );
  console.error(
    `[nigerianStagingQa] wrote ${outPath} (sweep of ${mode.seeds.length} seeds; medianCombined=${medianCombined}/60; verdict=${medianVerdict ? "GO" : "HOLD"})`,
  );
}

// Module-execution guard — only run main() when invoked directly via
// `tsx src/qa/nigerianStagingQa.ts`, NOT when imported by another
// script (e.g. `analyzeNigerianBatchDTargets.ts` reuses `runCohort`,
// `COHORTS`, `withSeededRandom`, etc. without triggering a sweep).
const __thisFile = fileURLToPath(import.meta.url);
const __invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (__thisFile === __invokedFile) {
  main();
  process.exit(0);
}
