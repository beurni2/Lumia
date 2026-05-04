/**
 * PHASE Z5 — corpus expansion tests (Batches 1-3).
 *
 * Pins the additive contract for the Z5 corpus expansions:
 *   Batch 1+2: 200 POV/relatable skit hooks (233 → 433)
 *   Batch 3:    99 Surprise twist ending hooks (433 → 532)
 *
 *   1. Corpus size pinned at 532.
 *   2. No duplicate hook texts exist across entire corpus.
 *   3. Every entry's anchor appears in its hook (boot-time assert parity).
 *   4. Every entry's cluster is one of the 4 valid voice clusters.
 *   5. Per-cluster boot-floor (≥8) still holds with new distribution.
 *   6. No unsubstituted placeholders (${...}, {{...}}, [PLACEHOLDER]).
 *   7. All Z5 hooks are wired into the seed-hook fingerprint set.
 *   8. Pre-Z5 baseline (first 233) integrity hash.
 *   9. Pre-Batch-3 baseline (first 433) integrity hash.
 *  10. Scenario catalog pinned at 253 entries.
 */
import { describe, it, expect } from "vitest";
import crypto from "crypto";
import {
  USER_BLESSED_HOOK_CORPUS,
  getCorpusHooksByCluster,
} from "../userBlessedHookCorpus.js";
import {
  loadSeedHookFingerprints,
  normalizeHookFingerprint,
} from "../comedyValidation.js";
import { POV_SCENARIO_CATALOG } from "../povScenarioCatalog.js";
import { type VoiceClusterId } from "../voiceClusters.js";

const CLUSTERS: readonly VoiceClusterId[] = [
  "dry_deadpan",
  "chaotic_confession",
  "overdramatic_reframe",
  "quiet_realization",
];

const PRE_Z5_COUNT = 233;
const Z5_BATCH12_ADDITION = 200;
const Z5_BATCH3_ADDITION = 99;
const Z5_ADDITION = Z5_BATCH12_ADDITION + Z5_BATCH3_ADDITION;
const EXPECTED_TOTAL = PRE_Z5_COUNT + Z5_ADDITION;
const PRE_BATCH3_COUNT = PRE_Z5_COUNT + Z5_BATCH12_ADDITION;

describe("Z5 — corpus expansion (Batches 1-3)", () => {
  it(`corpus grew to exactly ${EXPECTED_TOTAL} entries`, () => {
    expect(USER_BLESSED_HOOK_CORPUS.length).toBe(EXPECTED_TOTAL);
  });

  it("no duplicate hook texts exist across entire corpus", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const e of USER_BLESSED_HOOK_CORPUS) {
      const norm = e.hook.toLowerCase().trim();
      if (seen.has(norm)) dupes.push(e.hook);
      seen.add(norm);
    }
    expect(dupes, `duplicate hooks:\n${dupes.join("\n")}`).toEqual([]);
  });

  it("every entry's cluster is one of the 4 valid voice clusters", () => {
    for (const e of USER_BLESSED_HOOK_CORPUS) {
      expect(CLUSTERS, `invalid cluster for "${e.hook}"`).toContain(e.cluster);
    }
  });

  it("every entry's anchor literally appears in its hook", () => {
    for (const e of USER_BLESSED_HOOK_CORPUS) {
      expect(
        e.hook.toLowerCase().includes(e.anchor.toLowerCase()),
        `anchor '${e.anchor}' missing from hook '${e.hook}'`,
      ).toBe(true);
    }
  });

  it("every cluster pool has ≥8 entries (boot-floor coverage)", () => {
    for (const cid of CLUSTERS) {
      const count = getCorpusHooksByCluster(cid).length;
      expect(count, `${cid} has only ${count} entries`).toBeGreaterThanOrEqual(
        8,
      );
    }
  });

  it("no hook contains unsubstituted placeholders", () => {
    const placeholderRe = /\$\{|{{|PLACEHOLDER|\[INSERT|__FILL__/i;
    const offenders = USER_BLESSED_HOOK_CORPUS.filter((e) =>
      placeholderRe.test(e.hook),
    );
    expect(
      offenders.map((o) => o.hook),
      "hooks with placeholders",
    ).toEqual([]);
  });

  it("pre-Z5 baseline (first 233 entries) is unchanged", () => {
    const pre = USER_BLESSED_HOOK_CORPUS.slice(0, PRE_Z5_COUNT);
    const payload = pre
      .map((e) => `${e.hook}|${e.cluster}|${e.anchor}`)
      .join("\n");
    const hash = crypto.createHash("sha256").update(payload).digest("hex");
    expect(hash).toBe(
      "cb6af4aec080a60f86d3780d851126f4c72dcdc87194d7fcd3c1425a89ad5a24",
    );
  });

  it("pre-Batch-3 baseline (first 433 entries) is unchanged", () => {
    const pre = USER_BLESSED_HOOK_CORPUS.slice(0, PRE_BATCH3_COUNT);
    const payload = pre
      .map((e) => `${e.hook}|${e.cluster}|${e.anchor}`)
      .join("\n");
    const hash = crypto.createHash("sha256").update(payload).digest("hex");
    expect(hash).toBe(
      "0967e2756e1966ae96287ce0a6864909169f21f360ef7ed2a250afb649f6da77",
    );
  });

  it("all Z5 hooks are in the seed-hook fingerprint set", () => {
    const seeds = loadSeedHookFingerprints();
    const z5Hooks = USER_BLESSED_HOOK_CORPUS.slice(PRE_Z5_COUNT);
    expect(z5Hooks.length).toBe(Z5_ADDITION);
    const missing: string[] = [];
    for (const e of z5Hooks) {
      const fp = normalizeHookFingerprint(e.hook);
      if (!seeds.has(fp)) missing.push(e.hook);
    }
    expect(
      missing,
      `Z5 hooks missing from seed fingerprints:\n${missing.join("\n")}`,
    ).toEqual([]);
  });
});

describe("Z5 — POV scenario catalog integrity", () => {
  it("has exactly 253 entries with scenarios", () => {
    expect(POV_SCENARIO_CATALOG.length).toBe(253);
  });

  it("every entry has a non-empty hook and scenario", () => {
    for (const e of POV_SCENARIO_CATALOG) {
      expect(e.hook.length, "empty hook").toBeGreaterThan(0);
      expect(e.scenario.length, `empty scenario for "${e.hook}"`).toBeGreaterThan(0);
    }
  });

  it("no scenario contains unsubstituted placeholders", () => {
    const placeholderRe = /\$\{|{{|PLACEHOLDER|\[INSERT|__FILL__/i;
    const offenders = POV_SCENARIO_CATALOG.filter((e) =>
      placeholderRe.test(e.scenario),
    );
    expect(
      offenders.map((o) => o.hook),
      "scenarios with placeholders",
    ).toEqual([]);
  });

  it("every scenario catalog hook exists in the blessed corpus", () => {
    const norm = (s: string) =>
      s
        .toLowerCase()
        .trim()
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"');
    const corpusHooks = new Set(
      USER_BLESSED_HOOK_CORPUS.map((e) => norm(e.hook)),
    );
    const missing: string[] = [];
    for (const e of POV_SCENARIO_CATALOG) {
      if (!corpusHooks.has(norm(e.hook))) {
        missing.push(e.hook);
      }
    }
    expect(
      missing,
      `scenario hooks not in corpus:\n${missing.join("\n")}`,
    ).toEqual([]);
  });
});
