/**
 * PHASE Z5a — high_energy_rant voice cluster registration tests.
 *
 * Pins the additive contract for the fifth voice cluster:
 *
 *   1. Cluster is registered in `VOICE_CLUSTERS` and resolvable
 *      via `getVoiceCluster` and `isVoiceClusterId`.
 *   2. Catalog satisfies the boot-floor invariants directly
 *      (≥8 hookTemplates each scoring ≥40 against the same
 *      TEST_FILL the module-load assert uses; ≥3 seedHookExemplars;
 *      lengthTargetWords ⊂ [2, 10]). Defence-in-depth against a
 *      future template edit that would silently drop a render below
 *      the floor — the boot assert would also catch this, but the
 *      test surface gives a clean per-template diagnostic.
 *   3. `whyThisFitsYou.composeWhyThisFitsYou` produces a
 *      cluster-specific (non-fallback) line that respects the
 *      anti-boring discipline (no `safe` / `easy`).
 *   4. Cold-start salt-rotation surfaces the cluster at least once
 *      across a sweep of (salt, recipeIdx) — proves it joined the
 *      rotation pool and isn't a dead entry in the union type.
 *   5. PHASE Z5.8 — high_energy_rant IS now a `preferredTone` enum
 *      value (closed-beta Quick Tune); when pinned it participates
 *      in the same +5 slot tone-bias as the other 4 tones. The Z5a
 *      "internal-first" posture is superseded by the explicit beta
 *      spec. We pin the new contract: pinning `high_energy_rant`
 *      gives the cluster a dominant share (>40%) without
 *      monopolising (D1 soft-pin).
 */
import { describe, it, expect } from "vitest";
import {
  VOICE_CLUSTERS,
  getVoiceCluster,
  isVoiceClusterId,
} from "../voiceClusters.js";
import { scoreHookQuality } from "../hookQuality.js";
import { composeWhyThisFitsYou } from "../whyThisFitsYou.js";
import { resolveVoiceCluster } from "../coreCandidateGenerator.js";
import type { TasteCalibration } from "../tasteCalibration.js";

// Mirror of the boot assert's TEST_FILL. Kept duplicated (rather
// than imported) because the module-private constant is part of the
// boot contract — re-deriving it here proves the test is exercising
// the same render the production assert would catch on.
const TEST_FILL: Readonly<Record<string, string>> = {
  anchor: "list",
  action: "abandon",
  actionPast: "abandoned",
  ingForm: "abandoning",
  mechanism: "self betrayal",
  contradiction: "abandoned the list",
};
const HOOK_QUALITY_FLOOR = 40;

function render(tpl: string): string {
  return tpl.replace(/\$\{(\w+)\}/g, (_, key: string) => {
    const v = TEST_FILL[key];
    return typeof v === "string" ? v : `\${${key}}`;
  });
}

describe("Z5a — high_energy_rant cluster registration", () => {
  it("is registered in VOICE_CLUSTERS and resolvable", () => {
    const cluster = getVoiceCluster("high_energy_rant");
    expect(cluster.id).toBe("high_energy_rant");
    expect(isVoiceClusterId("high_energy_rant")).toBe(true);
    // Also visible in the public registry array.
    const ids = VOICE_CLUSTERS.map((c) => c.id);
    expect(ids).toContain("high_energy_rant");
  });

  it("has ≥8 hookTemplates, each rendering to scoreHookQuality ≥ 40", () => {
    const cluster = getVoiceCluster("high_energy_rant");
    expect(cluster.hookTemplates.length).toBeGreaterThanOrEqual(8);
    const failures: { tpl: string; rendered: string; score: number }[] = [];
    for (const tpl of cluster.hookTemplates) {
      const rendered = render(tpl);
      const score = scoreHookQuality(rendered, "self_betrayal");
      if (score < HOOK_QUALITY_FLOOR) {
        failures.push({ tpl, rendered, score });
      }
    }
    expect(
      failures,
      `templates below boot floor:\n${failures
        .map((f) => `  ${f.score}  ${f.rendered}  (template: ${f.tpl})`)
        .join("\n")}`,
    ).toEqual([]);
  });

  it("has ≥3 seedHookExemplars and lengthTargetWords ⊂ [2,10]", () => {
    const cluster = getVoiceCluster("high_energy_rant");
    expect(cluster.seedHookExemplars.length).toBeGreaterThanOrEqual(3);
    expect(cluster.lengthTargetWords[0]).toBeGreaterThanOrEqual(2);
    expect(cluster.lengthTargetWords[1]).toBeLessThanOrEqual(10);
  });

  it("composeWhyThisFitsYou returns a cluster-specific line (not the fallback)", () => {
    // Probe several fingerprints to land on every template in the
    // cluster's pool. Each line must:
    //   (a) be non-empty,
    //   (b) avoid the anti-boring banned words,
    //   (c) NOT be one of the FALLBACK_TEMPLATES (proxied by
    //       checking each line includes a high_energy_rant marker
    //       word — `rant`, `manic`, `unhinged`, `panic-volume`,
    //       `breathless` — at least one of which appears in every
    //       template the cluster pool ships).
    const markers = ["rant", "manic", "unhinged", "panic-volume", "breathless"];
    const seen = new Set<string>();
    for (let i = 0; i < 16; i++) {
      const line = composeWhyThisFitsYou({
        voiceClusterId: "high_energy_rant",
        scenarioFingerprint: `sf_z5a_${i}`,
        hook: "h",
      });
      seen.add(line);
      expect(line.length).toBeGreaterThan(20);
      expect(line.toLowerCase()).not.toContain("safe");
      expect(line.toLowerCase()).not.toContain("easy");
      const lower = line.toLowerCase();
      expect(
        markers.some((m) => lower.includes(m)),
        `line did not match any high_energy_rant marker word: "${line}"`,
      ).toBe(true);
    }
    // Rotation: at least 2 distinct lines across the probe.
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  it("cold-start salt-rotation surfaces high_energy_rant at least once across a sweep", () => {
    // Internal-first surfacing relies on the salt-rotated biased
    // table including the new cluster's 2 base slots. Sweep many
    // (salt, recipeIdx) combinations across families that DON'T
    // pin high_energy_rant as a familyDefault (none do — the
    // cluster is intentionally excluded from FAMILY_VOICE) and
    // confirm the cluster wins at least once.
    let hits = 0;
    const families = [
      "self_betrayal",
      "absurd_escalation",
      "social_mask",
      "dopamine_overthinking",
    ] as const;
    for (const family of families) {
      for (let salt = 0; salt < 32; salt++) {
        for (let recipeIdx = 0; recipeIdx < 4; recipeIdx++) {
          const got = resolveVoiceCluster({
            family,
            tasteCalibration: null,
            salt,
            coreId: `z5a_sweep_${family}`,
            recipeIdx,
          });
          if (got === "high_energy_rant") hits++;
        }
      }
    }
    // 4 families × 32 salts × 4 recipeIdx = 512 picks. With ~2/11
    // base share per non-family-default cluster, expected hits
    // ≈ 93. Assert >= 20 to leave wide margin against incidental
    // hash skew — the contract is "appears at all", not "appears
    // at exactly the expected share".
    expect(hits).toBeGreaterThanOrEqual(20);
  });

  it("PHASE Z5.8 — non-rant tone pins keep high_energy_rant share bounded", () => {
    // Sweep the 4 NON-RANT calibration tone values × many salts.
    // With a non-rant tone pinned, high_energy_rant gets only its
    // 2-slot baseline share (2/16 = 12.5%) — no +5 bias. We assert
    // the cluster's share never exceeds 30% (wide margin for hash
    // skew) so a future regression that wires the +5 bias to the
    // wrong cluster would surface here.
    const nonRantTones = [
      "dry_subtle",
      "chaotic",
      "bold",
      "self_aware",
    ] as const;
    for (const tone of nonRantTones) {
      const calibration: TasteCalibration = {
        preferredFormats: [],
        preferredTone: tone,
        preferredTones: [tone],
        effortPreference: null,
        privacyAvoidances: [],
        preferredHookStyles: [],
        selectedSituations: [],
        languageStyle: null,
        slangIntensity: 0,
        completedAt: null,
        skipped: false,
      };
      let hits = 0;
      const N = 200;
      for (let salt = 0; salt < N; salt++) {
        const got = resolveVoiceCluster({
          family: "self_betrayal",
          tasteCalibration: calibration,
          salt,
          coreId: "z5a_tone_pin",
          recipeIdx: 0,
        });
        if (got === "high_energy_rant") hits++;
      }
      expect(hits / N).toBeLessThanOrEqual(0.3);
    }
  });

  it("PHASE Z5.8 — pinning preferredTone='high_energy_rant' makes the cluster dominant", () => {
    // The Z5.8 enum promotion wires the same priority-1 tone-bias
    // (+5 slots) as the other 4 tones. With a self_betrayal family
    // and rant pinned, the slot share becomes ~7/16 = 43.75% before
    // the histogram-LRU walk. We assert >= 40% across a salt sweep
    // — that's the dominance contract Quick Tune promises a creator
    // who picks "high-energy rant".
    const calibration: TasteCalibration = {
      preferredFormats: [],
      preferredTone: "high_energy_rant",
      preferredTones: ["high_energy_rant"],
      effortPreference: null,
      privacyAvoidances: [],
      preferredHookStyles: [],
      selectedSituations: [],
      languageStyle: null,
      slangIntensity: 0,
      completedAt: null,
      skipped: false,
    };
    let hits = 0;
    const N = 400;
    for (let salt = 0; salt < N; salt++) {
      const got = resolveVoiceCluster({
        family: "self_betrayal",
        tasteCalibration: calibration,
        salt,
        coreId: "z58_rant_pin",
        recipeIdx: 0,
      });
      if (got === "high_energy_rant") hits++;
    }
    expect(hits / N).toBeGreaterThanOrEqual(0.4);
  });
});
