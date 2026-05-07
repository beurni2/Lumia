# W1.1 — Western under-fill / fallback audit

_Generated: 2026-05-07T08:26:42.559Z · driver: `artifacts/api-server/src/qa/w11AuditDriver.ts`_

Investigation-only. NO generation behavior changed. Cohort+env-gated funnel instrumentation only: `coreCandidateGenerator.stats.westernAdjustmentSummary` (cohort-gated) + `qaTelemetry.westernFunnel` (cohort-gated, only surfaced when the QA header is present in non-prod) + an opt-in `phase_w1.funnel_summary` log gated by `LUMINA_W1_FUNNEL_LOG=true`.

## Methodology

- Endpoint: real `POST /api/ideator/generate` via the shared proxy at `localhost:80`. Header `x-lumina-qa-expose-meta: 1` enables the additive `qaTelemetry` surface in non-production.
- Cohort: `region="western"`, `count=3`, `regenerate=false` for batch 0 + `regenerate=true` for every subsequent batch (with `excludeHooks` chained from the previous batch on batches 0/1, mirroring the pre-existing W1 harness's serial-then-parallel cadence — adapted to plain serial here because we want clean per-batch funnel data without parallel exclude-hook drift).
- Two passes: **W1 ON** (production W1 hook adjustment active, the staging baseline) and **W1 OFF** (`LUMINA_W1_DISABLE_FOR_QA=1` set on the api-server process; the helper short-circuits to `0` adjustment in non-production). Operator restarts the api-server between passes.
- All numbers below are pulled from the orchestrator's pre-strip `qaTelemetry.westernFunnel` (the orchestrator is the source of truth for the funnel — every counter is read off the same in-flight state the production code path uses).

> **Capture-point note:** The orchestrator now snapshots `firstSelectionBatchSize` / `firstSelectionGuardsPassed` immediately after the first `selectWithNovelty` call (at hybridIdeator.ts L4234), BEFORE Claude fallback / reselect / mutation can mutate `selection`. If a dump in this report was produced before that fix, those two fields reflect end-of-function state and must be read with caution; the corresponding dump's per-batch entries are tagged with the orchestrator version implicitly via the presence of `funnel.mergedSizeAtFirstSelection` (only present in the corrected version). All other funnel counters were correct in v1.

## Pass: `W1 ON (production behavior)` (run 2026-05-07T08:24:37.948Z)

- batches: **6**, ideas shipped: **18/18** = 100.0%
- under-filled batches (ideaCount<3): **0/6** = 0.0%
- errored batches: **0/6**
- claude fallback used (server says): **5/6** = 83.3%
- needFallback decision triggered (pre-P3): **5/6** = 83.3%
- P3 (skip-fallback-local-sufficient) fired: **1/6** = 16.7%
- final selection guards FAILED: **0/6** = 0.0%
- duration ms — avg=16239 median=9322 min=2191 max=64367

### Funnel pipeline (per-batch averages)

| stage | n | avg | median | min | max |
| --- | --- | --- | --- | --- | --- |
| rawPatternCount | 6 | 16.0 | 16.0 | 16 | 16 |
| patternAfterExclusion | 6 | 16.0 | 16.0 | 16 | 16 |
| coherenceKept | 6 | 12.8 | 13.0 | 11 | 14 |
| coreNativeGenerated | 6 | 40.0 | 40.0 | 40 | 40 |
| coreNativeKept | 6 | 4.8 | 5.0 | 4 | 5 |
| mergedIntoFilterAndRescore | 6 | 17.7 | 18.0 | 15 | 19 |
| localKept | 6 | 14.2 | 15.0 | 11 | 18 |
| mergedAfterExclude (final) | 6 | 14.2 | 15.0 | 11 | 18 |
| firstSelectionBatchSize | 6 | 3.0 | 3.0 | 3 | 3 |
| finalSelectionBatchSize | 6 | 3.0 | 3.0 | 3 | 3 |
| fallbackKept | 6 | 0.0 | 0.0 | 0 | 0 |

### Fallback trigger attribution (count of batches each trigger fired)

| trigger | count | % of batches |
| --- | --- | --- |
| layer1CoreAware (regenerate-novelty, P3 not active) | 5 | 83.3% |
| mergedShort (`merged.length<3`) | 0 | 0.0% |
| selectionUnderfilled (`selection.batch.length<desired`) | 0 | 0.0% |
| guardsFailed (`!selection.guardsPassed`) | 0 | 0.0% |

### Top rejection reasons (aggregated across all batches)

**coherenceRejections (pre-coherence → coherenceKept)** (top 10):
- `hook_topic_noun_drift`: 8
- `template_stiffness_phrase`: 7
- `family_verb_leak_on_scene`: 4

**coreNativeRejectionReasons** (top 10):
- `construction_failed`: 29
- `family_verb_leak_on_scene`: 15
- `template_stiffness_phrase`: 7
- `hook_scenario_mismatch`: 5
- `copied_seed_hook`: 4

**filterAndRescore (localRejectionReasons)** (top 10):
- `hook_scenario_mismatch`: 17
- `filming_mismatch`: 4

**fallback (claude) rejection reasons** (top 10):
- _(no rejections)_

### Western adjustment summary (W1 helper output, aggregated)

- recipes scored: **180**
- demoted (adj<0): **54** = 30.0%
- boosted (adj>0): **5** = 2.8%
- zero (adj==0): **121** = 67.2%
- net delta sum: **-710**, per-recipe avg: -3.94

### Shipped source mix (aggregated)


### Fallback ↔ shipped replacement & weak skeleton families

- batches where Claude fallback REPLACED local picks in the final shipped batch: **0/6** = 0.0%
- avg repeated hook-skeleton families per batch (skeletons with ≥2 candidates in pre-fallback merged pool): **0.00**
- (no `meta.hookSkeletonId` populated on merged candidates in this run)

- `core_native`: 10 = 55.6%
- `pattern_variation`: 8 = 44.4%

## Pass: `W1 OFF (W1 helper bypassed)` (run 2026-05-07T08:25:15.654Z)

- batches: **3**, ideas shipped: **9/9** = 100.0%
- under-filled batches (ideaCount<3): **0/3** = 0.0%
- errored batches: **0/3**
- claude fallback used (server says): **2/3** = 66.7%
- needFallback decision triggered (pre-P3): **2/3** = 66.7%
- P3 (skip-fallback-local-sufficient) fired: **1/3** = 33.3%
- final selection guards FAILED: **0/3** = 0.0%
- duration ms — avg=7296 median=7436 min=6984 max=7468

### Funnel pipeline (per-batch averages)

| stage | n | avg | median | min | max |
| --- | --- | --- | --- | --- | --- |
| rawPatternCount | 3 | 16.0 | 16.0 | 16 | 16 |
| patternAfterExclusion | 3 | 16.0 | 16.0 | 16 | 16 |
| coherenceKept | 3 | 13.7 | 14.0 | 13 | 14 |
| coreNativeGenerated | 3 | 40.0 | 40.0 | 40 | 40 |
| coreNativeKept | 3 | 5.0 | 5.0 | 5 | 5 |
| mergedIntoFilterAndRescore | 3 | 18.7 | 19.0 | 18 | 19 |
| localKept | 3 | 16.3 | 16.0 | 15 | 18 |
| mergedAfterExclude (final) | 3 | 16.3 | 16.0 | 15 | 18 |
| firstSelectionBatchSize | 3 | 3.0 | 3.0 | 3 | 3 |
| finalSelectionBatchSize | 3 | 3.0 | 3.0 | 3 | 3 |
| fallbackKept | 3 | 0.0 | 0.0 | 0 | 0 |

### Fallback trigger attribution (count of batches each trigger fired)

| trigger | count | % of batches |
| --- | --- | --- |
| layer1CoreAware (regenerate-novelty, P3 not active) | 2 | 66.7% |
| mergedShort (`merged.length<3`) | 0 | 0.0% |
| selectionUnderfilled (`selection.batch.length<desired`) | 0 | 0.0% |
| guardsFailed (`!selection.guardsPassed`) | 0 | 0.0% |

### Top rejection reasons (aggregated across all batches)

**coherenceRejections (pre-coherence → coherenceKept)** (top 10):
- `hook_topic_noun_drift`: 4
- `template_stiffness_phrase`: 2
- `family_verb_leak_on_scene`: 1

**coreNativeRejectionReasons** (top 10):
- `hook_scenario_mismatch`: 5
- `construction_failed`: 5
- `family_verb_leak_on_scene`: 3
- `copied_seed_hook`: 3
- `template_stiffness_phrase`: 1
- `hook_topic_noun_drift`: 1

**filterAndRescore (localRejectionReasons)** (top 10):
- `hook_scenario_mismatch`: 6
- `filming_mismatch`: 1

**fallback (claude) rejection reasons** (top 10):
- _(no rejections)_

### Western adjustment summary (W1 helper output, aggregated)

- recipes scored: **102**
- demoted (adj<0): **0** = 0.0%
- boosted (adj>0): **0** = 0.0%
- zero (adj==0): **102** = 100.0%
- net delta sum: **0**, per-recipe avg: 0.00

### Shipped source mix (aggregated)


### Fallback ↔ shipped replacement & weak skeleton families

- batches where Claude fallback REPLACED local picks in the final shipped batch: **0/3** = 0.0%
- avg repeated hook-skeleton families per batch (skeletons with ≥2 candidates in pre-fallback merged pool): **2.00**

Top merged hook-skeleton families across all batches (skeletonId → total count, top 10):
- `totally_fine_about`: 17
- `is_it_really_still_about`: 9
- `how_to_avoid_three_steps`: 2
- `planned_to_handle`: 1
- `just_observing_disaster`: 1

- `pattern_variation`: 5 = 55.6%
- `core_native`: 3 = 33.3%
- `llama_3_1`: 1 = 11.1%

## ON vs OFF — head-to-head deltas

| metric | W1 ON | W1 OFF | Δ (ON−OFF) |
| --- | --- | --- | --- |
| ideas shipped % | 100.0 | 100.0 | 0.0 |
| under-filled batches % | 0.0 | 0.0 | 0.0 |
| claude fallback used % | 83.3 | 66.7 | 16.7 |
| needFallback decision % | 83.3 | 66.7 | 16.7 |
| P3 skip fired % | 16.7 | 33.3 | -16.7 |
| avg coreNativeKept | 4.8 | 5.0 | -0.2 |
| avg mergedIntoFilterAndRescore | 17.7 | 18.7 | -1.0 |
| avg localKept | 14.2 | 16.3 | -2.2 |
| avg firstSelectionBatchSize | 3.0 | 3.0 | 0.0 |
| avg finalSelectionBatchSize | 3.0 | 3.0 | 0.0 |
| avg duration ms | 16239 | 7296 | 8943 |

### Diagnosis (auto-generated, observation-only)

> Caveat: ON and OFF sample sizes differ. All comparisons below use **rates**, not raw counts, and any causal claim is flagged as a hypothesis pending a matched-N follow-up.

- **Under-fill is NOT observed in either pass**: every batch shipped the requested ideas. The pipeline reliably fills `desiredCount` from the local pool plus (when triggered) Claude fallback. If a downstream symptom labelled "western under-fill" exists, it is NOT happening at the orchestrator surface for this configuration — investigate cache replay paths, post-strip mobile parsing, or a different `count` value.
- **W1 ON shows a +16.7pp higher Claude fallback rate** (ON=83.3%, OFF=66.7%). **Hypothesis**: W1 demotion may be tipping the local pool below the P3 sufficiency bar in some additional batches, but the dominant trigger in both passes is `layer1CoreAware` (regenerate-novelty design path) so the marginal effect is small relative to the baseline cost.
- **Latency cost**: avg ON 16239ms vs OFF 7296ms. Latency tracks fallback rate (regenerate-novelty Claude calls account for the bulk).
- **Most-frequent fallback trigger (W1 ON)**: `layer1CoreAware` (83.3% of batches).
- **Pre-fallback first selection is filling `desiredCount` in 6/6 ON batches** (100.0%). This is the TRUE pre-fallback snapshot (captured before any reselect/mutation can change `selection`); when this rate is high but Claude is still firing, the trigger is the regenerate-novelty path, not pool starvation.

**Interpretation rules of thumb:**
- `coreNativeKept` < 3 in many batches → core_native generator is the bottleneck. Check `coreNativeRejectionTop` for the dominant reason (`scenario_repeat`, anti-copy, coherence).
- `mergedIntoFilterAndRescore` >> `localKept` → `filterAndRescore` (downstream scorer) is the bottleneck. Check `localRejectionTop`.
- `firstSelectionBatchSize == desiredCount` AND `firstSelectionGuardsPassed=true` AND `needFallback=false` → the happy path is firing; any user-visible under-fill is post-orchestrator (cache replay / post-strip / mobile).
- `mergedShort` trigger dominant → upstream supply is starving. Bare pool fix is needed before anything else.
- `layer1CoreAware` trigger dominant → regenerate-novelty fallback IS the design; cost is latency, not under-fill. Look at P3 hit-rate to decide whether to widen the skip condition.

## Minimal fix plan (auto-derived; investigation only — DO NOT implement here)

- **Tune P3 skip condition**: P3 fired 1/5 of needFallback batches. Widening the `merged.length >= 3` threshold or relaxing `selection.guardsPassed` for layer1-only triggers could cut ~4 additional Claude calls per 6 batches.

## Hard-rule compliance

- ✅ No NG pack / N1 flag / validator / anti-copy / safety / Claude prompt code path touched.
- ✅ No threshold or scoring change. `westernHookQuality.ts` byte-identical (the existing `LUMINA_W1_DISABLE_FOR_QA` bypass is reused, not introduced here).
- ✅ Instrumentation is cohort-gated (region undefined OR "western"); India / PH / Nigeria pay zero cost (the new `westernAdjustmentSummary` field is omitted from `coreCandidateGenerator` stats and the `westernFunnel` field is omitted from `qaTelemetry` for those cohorts).
- ✅ Production wire is unchanged. The funnel field is only attached when the dev-only `x-lumina-qa-expose-meta: 1` header is present AND `NODE_ENV !== "production"` (the existing `exposeMeta` gate in `routes/ideator.ts`); the structured log is gated by `LUMINA_W1_FUNNEL_LOG=true`, off by default. Production callers see no shape drift.
