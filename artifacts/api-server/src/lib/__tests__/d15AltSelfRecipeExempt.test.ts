/**
 * PHASE D15-alt — self-recipe exemption for the unigram fallback.
 *
 * D5 surfaced a circularity in the anti-copy gate: short (4-token)
 * `PREMISE_STYLE_DEFS` examples like "the dishes won again" both
 * SEED the deterministic recipe loop (via cohesiveIdeaAuthor's
 * substitution table) AND get folded into the seed-bigram pool that
 * filters the loop's output. With a 0.6 unigram-fallback threshold
 * on short hooks, any single-word substitution of a 4-token seed
 * lands at exactly 3 / 5 = 0.6 Jaccard against itself — guaranteed
 * to trip the gate.
 *
 * D15-alt threads `originatingSeedHash` (computed via the exported
 * `computeSeedHash`) through `ValidateComedyMeta`. When the unigram-
 * fallback fires AND `seed.source === "style_defs"` AND
 * `meta.originatingSeedHash === seed.hash`, the gate exempts the
 * match (returns `reason: null` with a `style_defs_self`-tagged
 * `antiCopyMatch` for telemetry).
 *
 * This test asserts the three invariants:
 *   (a) self-recipe single-word swap PASSES + carries the
 *       style_defs_self telemetry tag
 *   (b) cross-template near-copy (different originating hash) still
 *       REJECTS through the same unigram fallback
 *   (c) corpus-source match (different reference pool entirely) is
 *       unaffected by the exemption — the originatingSeedHash never
 *       matches a corpus entry's hash
 */
import { describe, it, expect, beforeEach } from "vitest";

import {
  computeSeedHash,
  validateAntiCopyDetailed,
  _resetSeedFingerprintCacheForTests,
  type ValidateComedyMeta,
} from "../comedyValidation.js";
import { USER_BLESSED_HOOK_CORPUS } from "../userBlessedHookCorpus.js";
import { PREMISE_STYLE_DEFS } from "../patternIdeator.js";
import type { Idea } from "../ideaGen.js";

// Minimal Idea factory — only the fields the anti-copy gate reads
// (`hook` + `premise`). The rest can be anything that satisfies the
// inferred type since validateAntiCopyDetailed never inspects them.
function ideaWith(hook: string, premise?: string): Idea {
  return {
    pattern: "contrast",
    hook,
    hookSeconds: 1.5,
    trigger: "trigger placeholder for the gate",
    reaction: "reaction placeholder for the gate",
    emotionalSpike: "regret",
    structure: "expectation_vs_reality",
    hookStyle: "deadpan",
    triggerCategory: "domestic",
    setting: "kitchen",
    script: "LINE 1: placeholder line\nLINE 2: placeholder line",
    shotPlan: "single static shot, eye level, 18s",
    caption: "placeholder caption",
    templateHint: "deadpan_observation",
    contentType: "entertainment",
    videoLengthSec: 18,
    filmingTimeMin: 5,
    whyItWorks: "placeholder",
    payoffType: "punchline",
    hasContrast: true,
    hasVisualAction: true,
    visualHook: "static reveal",
    whatToShow: "placeholder show that includes the hook anchor",
    howToFilm: "single take",
    ...(premise ? { premise } : {}),
  } as unknown as Idea;
}

const META_LAYER1: ValidateComedyMeta = {
  source: "core_native",
  usedBigPremise: true,
};

// Find a SHORT (≤4-token) style_defs example so we can construct a
// near-verbatim with one substitution and reliably trip the unigram
// fallback. Returns null if none exists (test self-skips if so —
// the fixture moved or shrank in a follow-up phase).
function findShortStyleDefExample(): {
  example: string;
  tokens: string[];
} | null {
  const TOKEN_RE = /[a-z][a-z'\-]*/g;
  for (const def of Object.values(PREMISE_STYLE_DEFS)) {
    const execs = (def as { executions?: ReadonlyArray<{ example?: string }> })
      .executions;
    if (!execs) continue;
    for (const ex of execs) {
      if (typeof ex.example !== "string") continue;
      const tokens = ex.example.toLowerCase().match(TOKEN_RE) ?? [];
      if (tokens.length >= 3 && tokens.length <= 4) {
        // Skip if this example also appears in the corpus pool —
        // corpus is iterated first in loadSeedHookBigrams so a
        // collision would mask the style_defs path entirely.
        const exLc = ex.example.toLowerCase();
        const collides = USER_BLESSED_HOOK_CORPUS.some(
          (c) => c.hook.toLowerCase() === exLc,
        );
        if (!collides) return { example: ex.example, tokens };
      }
    }
  }
  return null;
}

describe("PHASE D15-alt — self-recipe exemption (unigram fallback)", () => {
  beforeEach(() => {
    _resetSeedFingerprintCacheForTests();
  });

  it("EXEMPTS a self-recipe single-word swap (passes with style_defs_self tag)", () => {
    const fixture = findShortStyleDefExample();
    // Surface a hard failure (NOT a silent skip) if the fixture pool
    // shrinks — a future PHASE that drops every short style_defs
    // example would silently neutralise this gate-coverage test
    // otherwise. The PHASE D5 root cause requires SHORT seeds to
    // exist; if none do, D15-alt's whole motivation is gone and
    // this test deserves an explicit signal to revisit.
    expect(fixture).not.toBeNull();
    if (!fixture) return; // narrow for TS

    // Build a single-word swap of the originating example. Replace
    // the LAST content token with a fresh anchor noun ("kettle")
    // that doesn't appear elsewhere in the seed pool. With a
    // 4-token seed this lands at 3/5 = 0.6 unigram Jaccard — at the
    // exemption boundary, which is exactly the case D5 flagged.
    const swapped =
      fixture.tokens.slice(0, -1).join(" ") + " kettle";

    const out = validateAntiCopyDetailed(
      ideaWith(swapped),
      {
        ...META_LAYER1,
        originatingSeedHash: computeSeedHash(fixture.example),
      },
      new Set<string>(),
    );

    // Exemption invariants: passes, AND carries the telemetry tag.
    expect(out.reason).toBeNull();
    expect(out.antiCopyMatch).toBeDefined();
    expect(out.antiCopyMatch!.source).toBe("style_defs_self");
    expect(out.antiCopyMatch!.gate).toBe("unigram");
    expect(out.antiCopyMatch!.hash).toBe(computeSeedHash(fixture.example));
  });

  it("STILL REJECTS a cross-template near-copy (different originating hash)", () => {
    const fixture = findShortStyleDefExample();
    expect(fixture).not.toBeNull();
    if (!fixture) return;
    const swapped =
      fixture.tokens.slice(0, -1).join(" ") + " kettle";

    // Pretend the candidate originated from an UNRELATED example.
    // The exemption hash check fails (`originatingSeedHash` !==
    // `seed.hash` for the matching seed) and the unigram fallback
    // proceeds to reject normally.
    const out = validateAntiCopyDetailed(
      ideaWith(swapped),
      {
        ...META_LAYER1,
        originatingSeedHash: "deadbeef",
      },
      new Set<string>(),
    );

    expect(out.reason).toBe("copied_seed_hook");
    expect(out.antiCopyMatch).toBeDefined();
    expect(out.antiCopyMatch!.source).toBe("style_defs");
    expect(out.antiCopyMatch!.gate).toBe("unigram");
  });

  it("does NOT poison the clean-pass path when originatingSeedHash is set but no seed matches", () => {
    // A fresh, unrelated 8-word hook should still clear both gates
    // and return reason === null with no antiCopyMatch — even when
    // the candidate carries an `originatingSeedHash`. Proves the
    // new meta field is purely additive and never accidentally
    // surfaces a phantom self-exemption on a clean candidate.
    //
    // Note: corpus-source rejection invariance is already covered
    // independently by `d4AntiCopyTelemetry.test.ts` (which
    // constructs a candidate that DOES trigger a corpus match and
    // asserts `source === "corpus"` in the reject metadata). The
    // exemption code path is hard-gated on `seed.source ===
    // "style_defs"`, so by construction it cannot fire on a
    // corpus seed regardless of the originatingSeedHash value.
    const out = validateAntiCopyDetailed(
      ideaWith("the umbrella has been in the trunk since last winter"),
      {
        ...META_LAYER1,
        // Bogus hash — guaranteed to match no seed in the pool.
        originatingSeedHash: "deadbeef",
      },
      new Set<string>(),
    );

    expect(out.reason).toBeNull();
    expect(out.antiCopyMatch).toBeUndefined();
  });
});
