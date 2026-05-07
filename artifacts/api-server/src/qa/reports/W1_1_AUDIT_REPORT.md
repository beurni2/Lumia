# W1.1 — Western under-fill / fallback audit

_Generated: 2026-05-07T08:43:10.488Z · driver: `artifacts/api-server/src/qa/w11AuditDriver.ts`_

Investigation-only. NO generation behavior changed. Cohort+env-gated funnel instrumentation only: `coreCandidateGenerator.stats.westernAdjustmentSummary` (cohort-gated) + `qaTelemetry.westernFunnel` (cohort-gated, only surfaced when the QA header is present in non-prod) + an opt-in `phase_w1.funnel_summary` log gated by `LUMINA_W1_FUNNEL_LOG=true`.

## Methodology

- Endpoint: real `POST /api/ideator/generate` via the shared proxy at `localhost:80`. Header `x-lumina-qa-expose-meta: 1` enables the additive `qaTelemetry` surface in non-production.
- Cohort: `region="western"`, `count=3`, `regenerate=false` for batch 0 + `regenerate=true` for every subsequent batch (with `excludeHooks` chained from the previous batch on batches 0/1, mirroring the pre-existing W1 harness's serial-then-parallel cadence — adapted to plain serial here because we want clean per-batch funnel data without parallel exclude-hook drift).
- Two passes: **W1 ON** (production W1 hook adjustment active, the staging baseline) and **W1 OFF** (`LUMINA_W1_DISABLE_FOR_QA=1` set on the api-server process; the helper short-circuits to `0` adjustment in non-production). Operator restarts the api-server between passes.
- All numbers below are pulled from the orchestrator's pre-strip `qaTelemetry.westernFunnel` (the orchestrator is the source of truth for the funnel — every counter is read off the same in-flight state the production code path uses).

> **Capture-point note:** The orchestrator now snapshots `firstSelectionBatchSize` / `firstSelectionGuardsPassed` immediately after the first `selectWithNovelty` call (at hybridIdeator.ts L4234), BEFORE Claude fallback / reselect / mutation can mutate `selection`. If a dump in this report was produced before that fix, those two fields reflect end-of-function state and must be read with caution; the corresponding dump's per-batch entries are tagged with the orchestrator version implicitly via the presence of `funnel.mergedSizeAtFirstSelection` (only present in the corrected version). All other funnel counters were correct in v1.

## Pass: `W1 ON (production behavior)` (run 2026-05-07T08:41:09.548Z)

- batches: **3**, ideas shipped: **9/9** = 100.0%
- under-filled batches (ideaCount<3): **0/3** = 0.0%
- errored batches: **0/3**
- claude fallback used (server says): **2/3** = 66.7%
- needFallback decision triggered (pre-P3): **2/3** = 66.7%
- P3 (skip-fallback-local-sufficient) fired: **1/3** = 33.3%
- final selection guards FAILED: **0/3** = 0.0%
- duration ms — avg=17165 median=17896 min=10465 max=23134

### Funnel pipeline (per-batch averages)

| stage | n | avg | median | min | max |
| --- | --- | --- | --- | --- | --- |
| rawPatternCount | 3 | 16.0 | 16.0 | 16 | 16 |
| patternAfterExclusion | 3 | 16.0 | 16.0 | 16 | 16 |
| coherenceKept | 3 | 13.7 | 14.0 | 13 | 14 |
| coreNativeGenerated | 3 | 40.0 | 40.0 | 40 | 40 |
| coreNativeKept | 3 | 5.0 | 5.0 | 5 | 5 |
| mergedIntoFilterAndRescore | 3 | 18.7 | 19.0 | 18 | 19 |
| localKept | 3 | 17.0 | 18.0 | 15 | 18 |
| mergedAfterExclude (final) | 3 | 16.7 | 17.0 | 15 | 18 |
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
- `template_stiffness_phrase`: 3

**coreNativeRejectionReasons** (top 10):
- `construction_failed`: 12
- `family_verb_leak_on_scene`: 5
- `hook_scenario_mismatch`: 2
- `copied_seed_hook`: 1
- `hook_topic_noun_drift`: 1
- `no_contradiction`: 0
- `no_tension`: 0
- `generic_observation`: 0
- `too_soft`: 0
- `filming_mismatch`: 0

**filterAndRescore (localRejectionReasons)** (top 10):
- `hook_scenario_mismatch`: 5
- `no_contradiction`: 0
- `no_tension`: 0
- `generic_observation`: 0
- `too_soft`: 0
- `filming_mismatch`: 0
- `copied_seed_hook`: 0
- `near_duplicate_premise`: 0

**fallback (claude) rejection reasons** (top 10):
- _(no rejections)_

### Western adjustment summary (W1 helper output, aggregated)

- recipes scored: **99**
- demoted (adj<0): **28** = 28.3%
- boosted (adj>0): **7** = 7.1%
- zero (adj==0): **64** = 64.6%
- net delta sum: **-390**, per-recipe avg: -3.94

### Shipped source mix (aggregated)

- `pattern_variation`: 6 = 66.7%
- `core_native`: 3 = 33.3%

### Fallback ↔ shipped replacement & weak skeleton families

- batches where Claude fallback REPLACED local picks in the final shipped batch: **0/3** = 0.0%
- avg repeated hook-skeleton families per batch (skeletons with ≥2 candidates in pre-fallback merged pool): **2.00**

Top merged hook-skeleton families across all batches (skeletonId → total count, top 10):
- `totally_fine_about`: 19
- `is_it_really_still_about`: 7
- `noun_taking_notes`: 2
- `planned_to_handle`: 1
- `how_many_days_gets`: 1

### Funnel rejection by stage (aggregated, derived from rejection-reason maps)

> Stages are derived by pattern-matching every rejection reason against the canonical stage taxonomy (schema → scenario_coherence → comedy → anti_copy → safety_privacy → novelty_diversity → other). Reasons that match no pattern fall into `other`. This is a reporting-time derivation only — no in-orchestrator counter was added; the pipeline still emits its native rejection-reason aggregates and the driver buckets them.

| stage | total rejected (across batches) |
| --- | --- |
| schema | 0 |
| scenario_coherence | 7 |
| comedy | 0 |
| anti_copy | 1 |
| safety_privacy | 0 |
| novelty_diversity | 5 |
| other | 20 |

### Hook corpus — strongest 20, weakest 20, repeated hooks

Total hooks scored: **3** of 9 captured.

**Strongest 20 (highest `hookQualityScore`):**

| # | score | source | batch | hook |
| --- | --- | --- | --- | --- |
| 1 | 62.0 | `core_native` | 0 | the inbox ruined my villain arc |
| 2 | 60.0 | `core_native` | 2 | i SAID i'd snooze the alarm but NO |
| 3 | 57.0 | `core_native` | 0 | the flashcards itself isn't the problem. i am. |

**Weakest 20 (lowest `hookQualityScore`):**

| # | score | source | batch | hook |
| --- | --- | --- | --- | --- |
| 1 | 57.0 | `core_native` | 0 | the flashcards itself isn't the problem. i am. |
| 2 | 60.0 | `core_native` | 2 | i SAID i'd snooze the alarm but NO |
| 3 | 62.0 | `core_native` | 0 | the inbox ruined my villain arc |

**Exact repeated hooks** (same hook string shipped in ≥2 batches): **0**

- _(no exact repeats across batches in this pass)_

## Pass: `W1 OFF (W1 helper bypassed)` (run 2026-05-07T08:42:32.252Z)

- batches: **3**, ideas shipped: **9/9** = 100.0%
- under-filled batches (ideaCount<3): **0/3** = 0.0%
- errored batches: **0/3**
- claude fallback used (server says): **2/3** = 66.7%
- needFallback decision triggered (pre-P3): **2/3** = 66.7%
- P3 (skip-fallback-local-sufficient) fired: **1/3** = 33.3%
- final selection guards FAILED: **0/3** = 0.0%
- duration ms — avg=9325 median=2653 min=2625 max=22697

### Funnel pipeline (per-batch averages)

| stage | n | avg | median | min | max |
| --- | --- | --- | --- | --- | --- |
| rawPatternCount | 3 | 16.0 | 16.0 | 16 | 16 |
| patternAfterExclusion | 3 | 16.0 | 16.0 | 16 | 16 |
| coherenceKept | 3 | 14.3 | 14.0 | 14 | 15 |
| coreNativeGenerated | 3 | 40.0 | 40.0 | 40 | 40 |
| coreNativeKept | 3 | 5.0 | 5.0 | 5 | 5 |
| mergedIntoFilterAndRescore | 3 | 19.3 | 19.0 | 19 | 20 |
| localKept | 3 | 16.7 | 18.0 | 14 | 18 |
| mergedAfterExclude (final) | 3 | 16.3 | 17.0 | 14 | 18 |
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
- `template_stiffness_phrase`: 3
- `hook_topic_noun_drift`: 1
- `family_verb_leak_on_scene`: 1

**coreNativeRejectionReasons** (top 10):
- `hook_scenario_mismatch`: 5
- `construction_failed`: 5
- `copied_seed_hook`: 3
- `family_verb_leak_on_scene`: 3
- `no_contradiction`: 0
- `no_tension`: 0
- `generic_observation`: 0
- `too_soft`: 0
- `filming_mismatch`: 0
- `near_duplicate_premise`: 0

**filterAndRescore (localRejectionReasons)** (top 10):
- `hook_scenario_mismatch`: 7
- `filming_mismatch`: 1
- `no_contradiction`: 0
- `no_tension`: 0
- `generic_observation`: 0
- `too_soft`: 0
- `copied_seed_hook`: 0
- `near_duplicate_premise`: 0

**fallback (claude) rejection reasons** (top 10):
- _(no rejections)_

### Western adjustment summary (W1 helper output, aggregated)

- recipes scored: **104**
- demoted (adj<0): **0** = 0.0%
- boosted (adj>0): **0** = 0.0%
- zero (adj==0): **104** = 100.0%
- net delta sum: **0**, per-recipe avg: 0.00

### Shipped source mix (aggregated)

- `core_native`: 5 = 55.6%
- `pattern_variation`: 4 = 44.4%

### Fallback ↔ shipped replacement & weak skeleton families

- batches where Claude fallback REPLACED local picks in the final shipped batch: **0/3** = 0.0%
- avg repeated hook-skeleton families per batch (skeletons with ≥2 candidates in pre-fallback merged pool): **1.67**

Top merged hook-skeleton families across all batches (skeletonId → total count, top 10):
- `totally_fine_about`: 19
- `is_it_really_still_about`: 8
- `noun_taking_notes`: 2
- `not_great_with_today`: 1
- `how_to_avoid_three_steps`: 1
- `noun_watching_decide`: 1

### Funnel rejection by stage (aggregated, derived from rejection-reason maps)

> Stages are derived by pattern-matching every rejection reason against the canonical stage taxonomy (schema → scenario_coherence → comedy → anti_copy → safety_privacy → novelty_diversity → other). Reasons that match no pattern fall into `other`. This is a reporting-time derivation only — no in-orchestrator counter was added; the pipeline still emits its native rejection-reason aggregates and the driver buckets them.

| stage | total rejected (across batches) |
| --- | --- |
| schema | 0 |
| scenario_coherence | 5 |
| comedy | 0 |
| anti_copy | 3 |
| safety_privacy | 0 |
| novelty_diversity | 3 |
| other | 18 |

### Hook corpus — strongest 20, weakest 20, repeated hooks

Total hooks scored: **5** of 9 captured.

**Strongest 20 (highest `hookQualityScore`):**

| # | score | source | batch | hook |
| --- | --- | --- | --- | --- |
| 1 | 72.0 | `core_native` | 1 | the tab demolished my entire vibe |
| 2 | 63.0 | `core_native` | 2 | WHY does the sink keep ignoring itself |
| 3 | 60.0 | `core_native` | 0 | my own bed is leaving me back!! |
| 4 | 53.0 | `core_native` | 0 | watched myself ignore the voicememo live |
| 5 | 38.0 | `core_native` | 1 | i checked the wallpaper. mistake. |

**Weakest 20 (lowest `hookQualityScore`):**

| # | score | source | batch | hook |
| --- | --- | --- | --- | --- |
| 1 | 38.0 | `core_native` | 1 | i checked the wallpaper. mistake. |
| 2 | 53.0 | `core_native` | 0 | watched myself ignore the voicememo live |
| 3 | 60.0 | `core_native` | 0 | my own bed is leaving me back!! |
| 4 | 63.0 | `core_native` | 2 | WHY does the sink keep ignoring itself |
| 5 | 72.0 | `core_native` | 1 | the tab demolished my entire vibe |

**Exact repeated hooks** (same hook string shipped in ≥2 batches): **0**

- _(no exact repeats across batches in this pass)_

## ON vs OFF — head-to-head deltas

| metric | W1 ON | W1 OFF | Δ (ON−OFF) |
| --- | --- | --- | --- |
| ideas shipped % | 100.0 | 100.0 | 0.0 |
| under-filled batches % | 0.0 | 0.0 | 0.0 |
| claude fallback used % | 66.7 | 66.7 | 0.0 |
| needFallback decision % | 66.7 | 66.7 | 0.0 |
| P3 skip fired % | 33.3 | 33.3 | 0.0 |
| avg coreNativeKept | 5.0 | 5.0 | 0.0 |
| avg mergedIntoFilterAndRescore | 18.7 | 19.3 | -0.7 |
| avg localKept | 17.0 | 16.7 | 0.3 |
| avg firstSelectionBatchSize | 3.0 | 3.0 | 0.0 |
| avg finalSelectionBatchSize | 3.0 | 3.0 | 0.0 |
| avg duration ms | 17165 | 9325 | 7840 |

### Diagnosis (auto-generated, observation-only)

> Caveat: ON and OFF sample sizes differ. All comparisons below use **rates**, not raw counts, and any causal claim is flagged as a hypothesis pending a matched-N follow-up.

- **Under-fill is NOT observed in either pass**: every batch shipped the requested ideas. The pipeline reliably fills `desiredCount` from the local pool plus (when triggered) Claude fallback. If a downstream symptom labelled "western under-fill" exists, it is NOT happening at the orchestrator surface for this configuration — investigate cache replay paths, post-strip mobile parsing, or a different `count` value.
- **Claude fallback rate is comparable across passes** (ON=66.7%, OFF=66.7%, Δ=0.0pp). The layer1CoreAware trigger dominates in BOTH passes (ON=66.7%, OFF=66.7%). This is the regenerate-novelty design path, not W1-induced. **Hypothesis only**: W1 demotion is NOT the dominant fallback driver — the regenerate-path always invokes Claude regardless.
- **Latency cost**: avg ON 17165ms vs OFF 9325ms. Latency tracks fallback rate (regenerate-novelty Claude calls account for the bulk).
- **Most-frequent fallback trigger (W1 ON)**: `layer1CoreAware` (66.7% of batches).
- **Pre-fallback first selection is filling `desiredCount` in 3/3 ON batches** (100.0%). This is the TRUE pre-fallback snapshot (captured before any reselect/mutation can change `selection`); when this rate is high but Claude is still firing, the trigger is the regenerate-novelty path, not pool starvation.

**Interpretation rules of thumb:**
- `coreNativeKept` < 3 in many batches → core_native generator is the bottleneck. Check `coreNativeRejectionTop` for the dominant reason (`scenario_repeat`, anti-copy, coherence).
- `mergedIntoFilterAndRescore` >> `localKept` → `filterAndRescore` (downstream scorer) is the bottleneck. Check `localRejectionTop`.
- `firstSelectionBatchSize == desiredCount` AND `firstSelectionGuardsPassed=true` AND `needFallback=false` → the happy path is firing; any user-visible under-fill is post-orchestrator (cache replay / post-strip / mobile).
- `mergedShort` trigger dominant → upstream supply is starving. Bare pool fix is needed before anything else.
- `layer1CoreAware` trigger dominant → regenerate-novelty fallback IS the design; cost is latency, not under-fill. Look at P3 hit-rate to decide whether to widen the skip condition.

## Minimal fix plan (auto-derived; investigation only — DO NOT implement here)

- **Tune P3 skip condition**: P3 fired 1/2 of needFallback batches. Widening the `merged.length >= 3` threshold or relaxing `selection.guardsPassed` for layer1-only triggers could cut ~1 additional Claude calls per 3 batches.

## Hard-rule compliance

- ✅ No NG pack / N1 flag / validator / anti-copy / safety / Claude prompt code path touched.
- ✅ No threshold or scoring change. `westernHookQuality.ts` byte-identical (the existing `LUMINA_W1_DISABLE_FOR_QA` bypass is reused, not introduced here).
- ✅ Instrumentation is cohort-gated (region undefined OR "western"); India / PH / Nigeria pay zero cost (the new `westernAdjustmentSummary` field is omitted from `coreCandidateGenerator` stats and the `westernFunnel` field is omitted from `qaTelemetry` for those cohorts).
- ✅ Production wire is unchanged. The funnel field is only attached when the dev-only `x-lumina-qa-expose-meta: 1` header is present AND `NODE_ENV !== "production"` (the existing `exposeMeta` gate in `routes/ideator.ts`); the structured log is gated by `LUMINA_W1_FUNNEL_LOG=true`, off by default. Production callers see no shape drift.
