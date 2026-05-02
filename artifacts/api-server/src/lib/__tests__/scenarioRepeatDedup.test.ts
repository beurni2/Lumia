/**
 * PHASE Y8 — scenario-fingerprint dedup gate regression tests.
 *
 * Locks in three behaviors of the new HARD-REJECT gate the recipe
 * loop in `coreCandidateGenerator.generateCoreCandidates` runs
 * after a fresh recipe authors successfully:
 *
 *   1. EMPTY ENVELOPE — when `recentScenarioFingerprints` is
 *      empty / undefined (cold-start creator), every passing
 *      recipe ships normally; the gate is quiet.
 *
 *   2. CROSS-BATCH HARD-REJECT — when the harvested fingerprint
 *      from the FIRST cold-start run is replayed back into the
 *      `recentScenarioFingerprints` envelope, the SAME core +
 *      same salt that produced it can no longer ship that
 *      fingerprint and the rejection is recorded against
 *      `scenario_repeat`. (The recipe loop has up to 8 attempts
 *      per core, so the core may still ship a DIFFERENT
 *      fingerprint via a different recipe — what we're locking
 *      in is that the originally-shipped fp is no longer the
 *      one that ships, AND that the per-reason counter ticks.)
 *
 *   3. IN-BATCH HARD-REJECT — when two sibling cores in the same
 *      batch would author to the same fingerprint, the second one
 *      is rejected with `scenario_repeat` (or chooses a different
 *      recipe whose fp is fresh). Tested by stuffing the batch
 *      with the SAME core twice and verifying that distinct
 *      fingerprints ship per slot.
 */
import { describe, it, expect } from "vitest";
import {
  generateCoreCandidates,
  type GenerateCoreCandidatesInput,
} from "../coreCandidateGenerator.js";
import { PREMISE_CORES } from "../premiseCoreLibrary.js";

const COLD_START_INPUT: GenerateCoreCandidatesInput = {
  cores: [PREMISE_CORES[0]!],
  count: 1,
  regenerateSalt: 7,
};

describe("scenario fingerprint dedup gate (Y8 hard-reject)", () => {
  it("cold-start (empty envelope): the gate is quiet, recipe ships normally", () => {
    const out = generateCoreCandidates(COLD_START_INPUT);
    expect(out.candidates.length).toBe(1);
    expect(out.stats.rejectionReasons.scenario_repeat).toBe(0);
    // The shipped candidate must surface a fingerprint on its meta
    // — the entire downstream dedup chain (cross-batch + in-batch)
    // depends on this being non-empty for core_native ideas.
    const sf = out.candidates[0]!.meta.scenarioFingerprint;
    expect(typeof sf).toBe("string");
    expect(sf!).toMatch(/^sf_[0-9a-f]{12}$/);
  });

  it("cross-batch HARD-REJECT: replaying the cold-start fp into the envelope blocks it", () => {
    // Step 1 — cold-start run produces a deterministic fingerprint
    // for (core, salt) = (cores[0], 7).
    const firstRun = generateCoreCandidates(COLD_START_INPUT);
    expect(firstRun.candidates.length).toBe(1);
    const firstSf = firstRun.candidates[0]!.meta.scenarioFingerprint!;
    expect(firstSf).toBeDefined();

    // Step 2 — same input, same salt, but with the first fp seeded
    // into `recentScenarioFingerprints`. The recipe iterator must
    // walk past the recipe that authors to `firstSf` and either
    // (a) ship a different fp or (b) exhaust attempts. In EITHER
    // case the `scenario_repeat` counter must have ticked at least
    // once (the originally-first recipe still gets generated, then
    // rejected by the new gate).
    const secondRun = generateCoreCandidates({
      ...COLD_START_INPUT,
      noveltyContext: {
        recentScenarioFingerprints: new Set([firstSf]),
      },
    });
    expect(secondRun.stats.rejectionReasons.scenario_repeat).toBeGreaterThanOrEqual(1);
    // Whatever ships, it MUST NOT be the seeded fingerprint.
    if (secondRun.candidates.length > 0) {
      const secondSf = secondRun.candidates[0]!.meta.scenarioFingerprint;
      expect(secondSf).not.toBe(firstSf);
    }
  });

  it("in-batch HARD-REJECT: two slots for the same core ship distinct fingerprints", () => {
    // Stuff the batch with the SAME core twice. Without the in-batch
    // tracker, the deterministic recipe queue would author both slots
    // to the SAME fingerprint (same core + same salt + same first-
    // recipe-up). The Y8 `usedFingerprintsThisBatch` tracker forces
    // the second slot to either pick a different recipe or get
    // rejected with `scenario_repeat`.
    const out = generateCoreCandidates({
      cores: [PREMISE_CORES[0]!, PREMISE_CORES[0]!],
      count: 2,
      regenerateSalt: 7,
    });
    // Both slots should ship (the recipe queue has many anchors per
    // core) AND the two shipped fingerprints must differ.
    if (out.candidates.length === 2) {
      const sfs = out.candidates.map((c) => c.meta.scenarioFingerprint);
      expect(sfs[0]).toBeDefined();
      expect(sfs[1]).toBeDefined();
      expect(sfs[0]).not.toBe(sfs[1]);
    } else {
      // If only one shipped, the second must have been rejected by
      // `scenario_repeat` (the in-batch tracker firing) — locks in
      // the gate's symmetric behavior across cross-batch + in-batch.
      expect(out.stats.rejectionReasons.scenario_repeat).toBeGreaterThanOrEqual(1);
    }
  });

  it("rejectionReasons shape includes scenario_repeat from cold start", () => {
    // The full-shape EMPTY_REASONS contract — dashboards do
    // `.scenario_repeat` without `??`, so the field must exist
    // even when the gate never fires.
    const out = generateCoreCandidates(COLD_START_INPUT);
    expect(Object.keys(out.stats.rejectionReasons)).toContain("scenario_repeat");
    expect(typeof out.stats.rejectionReasons.scenario_repeat).toBe("number");
  });
});
