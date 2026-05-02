/**
 * PHASE Y7 — regression tests for `computeScenarioFingerprint`.
 * Locks in the three invariants Y6 relies on for cross-batch
 * scenario dedup:
 *
 *   1. Token-order invariance: the same triple in any field-order
 *      permutation produces the same `sf_*`.
 *   2. Lemmatization: inflected forms (`running`/`ran`) collapse
 *      to the same fingerprint.
 *   3. SYNONYM_MAP normalization: synonymized nouns
 *      (`list`/`checklist`/`tasks`) collapse to the same
 *      fingerprint.
 */
import { describe, it, expect } from "vitest";
import { computeScenarioFingerprint } from "../scenarioFingerprint.js";

describe("computeScenarioFingerprint — Y7 invariants", () => {
  it("token-order invariant across field permutations", () => {
    const a = computeScenarioFingerprint({
      mechanism: "i open the gym bag",
      anchor: "gym bag",
      action: "abandon",
    });
    // Same tokens, different field order — fingerprint is built
    // from the union of tokens, sorted, so this MUST equal `a`.
    const b = computeScenarioFingerprint({
      mechanism: "i abandon the gym bag",
      anchor: "open gym",
      action: "bag i the",
    });
    expect(a).toBe(b);
  });

  it("starts with the `sf_` prefix and is 12 hex chars long", () => {
    const fp = computeScenarioFingerprint({
      mechanism: "i ghosted the calendar",
      anchor: "calendar",
      action: "ghost",
    });
    expect(fp).toMatch(/^sf_[0-9a-f]{12}$/);
  });

  it("`-ed` strip: `abandon` vs `abandoned` produce the same fingerprint", () => {
    const a = computeScenarioFingerprint({
      mechanism: "i abandon the gym",
      anchor: "gym",
      action: "abandon",
    });
    const b = computeScenarioFingerprint({
      mechanism: "i abandoned the gym",
      anchor: "gym",
      action: "abandoned",
    });
    expect(a).toBe(b);
  });

  it("`-ing` strip: `ghosting` and `ghost` produce the same fingerprint", () => {
    const a = computeScenarioFingerprint({
      mechanism: "ghosting the inbox",
      anchor: "inbox",
      action: "ghost",
    });
    const b = computeScenarioFingerprint({
      mechanism: "ghost the inbox",
      anchor: "inbox",
      action: "ghosting",
    });
    expect(a).toBe(b);
  });

  it("SYNONYM_MAP collapse: `list` / `checklist` / `tasks` → same fingerprint", () => {
    const a = computeScenarioFingerprint({
      mechanism: "i ghost my list",
      anchor: "list",
      action: "ghost",
    });
    const b = computeScenarioFingerprint({
      mechanism: "i ghost my checklist",
      anchor: "checklist",
      action: "ghost",
    });
    const c = computeScenarioFingerprint({
      mechanism: "i ghost my tasks",
      anchor: "tasks",
      action: "ghost",
    });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("SYNONYM_MAP collapse: `phone` / `screen` / `notification` → same fingerprint", () => {
    const a = computeScenarioFingerprint({
      mechanism: "i abandon the phone",
      anchor: "phone",
      action: "abandon",
    });
    const b = computeScenarioFingerprint({
      mechanism: "i abandon the screen",
      anchor: "screen",
      action: "abandon",
    });
    const c = computeScenarioFingerprint({
      mechanism: "i abandon the notification",
      anchor: "notification",
      action: "abandon",
    });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("genuinely different scenarios produce different fingerprints", () => {
    const a = computeScenarioFingerprint({
      mechanism: "i ghost the inbox",
      anchor: "inbox",
      action: "ghost",
    });
    const b = computeScenarioFingerprint({
      mechanism: "i abandon the gym bag",
      anchor: "gym bag",
      action: "abandon",
    });
    expect(a).not.toBe(b);
  });
});
