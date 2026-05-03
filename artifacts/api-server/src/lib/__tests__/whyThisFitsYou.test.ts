/**
 * PHASE Z1 — whyThisFitsYou template composer tests.
 * Locks in determinism + cluster coverage + anti-boring vocabulary.
 */
import { describe, it, expect } from "vitest";
import { composeWhyThisFitsYou } from "../whyThisFitsYou.js";
import { VOICE_CLUSTERS } from "../voiceClusters.js";

describe("composeWhyThisFitsYou (Z1)", () => {
  it("DETERMINISM: same inputs ⇒ same string", () => {
    const args = {
      voiceClusterId: "dry_deadpan" as const,
      scenarioFingerprint: "sf_abc_123",
      hook: "i ghosted my own to-do list",
    };
    const a = composeWhyThisFitsYou(args);
    const b = composeWhyThisFitsYou(args);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("COVERAGE: produces a non-empty line for every voice cluster", () => {
    for (const cluster of VOICE_CLUSTERS) {
      const line = composeWhyThisFitsYou({
        voiceClusterId: cluster.id,
        scenarioFingerprint: `sf_${cluster.id}`,
        hook: "test hook",
      });
      expect(line.length).toBeGreaterThan(20);
    }
  });

  it("FALLBACK: missing voiceClusterId still produces a non-empty line", () => {
    const line = composeWhyThisFitsYou({
      hook: "i ghosted my own to-do list",
    });
    expect(line.length).toBeGreaterThan(20);
  });

  it("ANTI-BORING: no template uses the word 'safe' or 'easy'", () => {
    // The doc's "safest fit / slightly bolder" picker framing is
    // explicitly avoided — these templates lean on personality
    // markers, not on comfort.
    for (const cluster of VOICE_CLUSTERS) {
      // Probe several fingerprints to land on different templates.
      for (let i = 0; i < 8; i++) {
        const line = composeWhyThisFitsYou({
          voiceClusterId: cluster.id,
          scenarioFingerprint: `sf_${cluster.id}_${i}`,
          hook: "test hook",
        }).toLowerCase();
        expect(line).not.toContain("safe");
        expect(line).not.toContain("easy");
      }
    }
  });

  it("ROTATION: different fingerprints in the same cluster can yield different lines", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      seen.add(
        composeWhyThisFitsYou({
          voiceClusterId: "dry_deadpan",
          scenarioFingerprint: `sf_rotation_${i}`,
          hook: "h",
        }),
      );
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
