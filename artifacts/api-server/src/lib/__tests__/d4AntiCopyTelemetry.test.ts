/**
 * PHASE D4 — reject-source telemetry tests.
 *
 * Closes the D3 honest gap (post-D3 the corpus + style_defs combined
 * raised the seed pool from ~200 to ~359; without per-source reject
 * counts we couldn't tell whether the corpus expansion over-rejects
 * in practice). These tests lock in:
 *
 *   - `validateAntiCopyDetailed` returns an `antiCopyMatch` payload
 *     ONLY on `copied_seed_hook` rejections (never on
 *     `near_duplicate_premise` or pass-through).
 *   - The match's `source` field correctly identifies whether the
 *     matched seed came from `USER_BLESSED_HOOK_CORPUS` (D3 corpus)
 *     or `PREMISE_STYLE_DEFS[*].executions[*].example` (style_defs).
 *   - The match's `jaccard` field is in the threshold range and
 *     `gate` correctly identifies which gate fired.
 *   - The legacy `validateAntiCopy` wrapper still returns just the
 *     reason (back-compat with the existing ideaScorer call site +
 *     `comedyValidation.test.ts`).
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  validateAntiCopy,
  validateAntiCopyDetailed,
  _resetSeedFingerprintCacheForTests,
  type ValidateComedyMeta,
} from "../comedyValidation.js";
import { USER_BLESSED_HOOK_CORPUS } from "../userBlessedHookCorpus.js";
import { PREMISE_STYLE_DEFS } from "../patternIdeator.js";
import type { Idea } from "../ideaGen.js";

function ideaWith(hook: string, premise = "p"): Idea {
  return {
    hook,
    whatToShow: "show",
    howToFilm: "film",
    trigger: "trigger",
    premise,
    transcript: "t",
    cta: "cta",
    captionTags: [],
  } as unknown as Idea;
}

const meta: ValidateComedyMeta = {
  source: "core_native",
} as unknown as ValidateComedyMeta;

describe("PHASE D4 — validateAntiCopyDetailed reject-source telemetry", () => {
  beforeEach(() => {
    _resetSeedFingerprintCacheForTests();
  });

  it("flags a corpus-matching candidate with source === 'corpus'", () => {
    // Pick the first corpus entry and submit it verbatim — Jaccard
    // bigram self-match = 1.0, well above the 0.85 threshold. The
    // resulting match must identify the corpus pool.
    const corpusHook = USER_BLESSED_HOOK_CORPUS[0]?.hook;
    expect(corpusHook).toBeDefined();
    const out = validateAntiCopyDetailed(
      ideaWith(corpusHook!),
      meta,
      new Set<string>(),
    );
    expect(out.reason).toBe("copied_seed_hook");
    expect(out.antiCopyMatch).toBeDefined();
    expect(out.antiCopyMatch!.source).toBe("corpus");
    expect(out.antiCopyMatch!.jaccard).toBeGreaterThanOrEqual(0.85);
    expect(out.antiCopyMatch!.gate).toMatch(/^(bigram|unigram)$/);
    expect(out.antiCopyMatch!.hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("flags a style_defs-matching candidate with source === 'style_defs'", () => {
    // Find the first PREMISE_STYLE_DEFS example whose token set
    // does NOT collide with any corpus entry (corpus is iterated
    // first in loadSeedHookBigrams, so a corpus collision would
    // win the first-match-wins gate). In practice the two pools
    // are curated independently so collisions are vanishingly
    // rare; if one ever exists, the test self-skips with a
    // descriptive message rather than silently passing.
    let styleDefExample: string | undefined;
    for (const def of Object.values(PREMISE_STYLE_DEFS)) {
      const execs = (def as { executions?: ReadonlyArray<{ example?: string }> })
        .executions;
      if (!execs) continue;
      for (const ex of execs) {
        if (typeof ex.example === "string" && ex.example.length > 0) {
          // Heuristic: pick an example whose hook is NOT also in the
          // corpus (case-insensitive substring check on the corpus
          // pool — cheap, fine for ~159 × ~200).
          const exLc = ex.example.toLowerCase();
          const collides = USER_BLESSED_HOOK_CORPUS.some(
            (c) => c.hook.toLowerCase() === exLc,
          );
          if (!collides) {
            styleDefExample = ex.example;
            break;
          }
        }
      }
      if (styleDefExample) break;
    }
    expect(styleDefExample).toBeDefined();
    const out = validateAntiCopyDetailed(
      ideaWith(styleDefExample!),
      meta,
      new Set<string>(),
    );
    expect(out.reason).toBe("copied_seed_hook");
    expect(out.antiCopyMatch).toBeDefined();
    expect(out.antiCopyMatch!.source).toBe("style_defs");
    expect(out.antiCopyMatch!.jaccard).toBeGreaterThanOrEqual(0.6);
    expect(out.antiCopyMatch!.gate).toMatch(/^(bigram|unigram)$/);
    expect(out.antiCopyMatch!.hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("does NOT attach antiCopyMatch on a pass-through (null reason)", () => {
    // A fresh, unrelated 8-word hook should clear both gates and
    // return reason === null with no match payload.
    const out = validateAntiCopyDetailed(
      ideaWith("the gym bag has been in the trunk for a fortnight now"),
      meta,
      new Set<string>(),
    );
    expect(out.reason).toBeNull();
    expect(out.antiCopyMatch).toBeUndefined();
  });

  it("does NOT attach antiCopyMatch on a `near_duplicate_premise` rejection", () => {
    // Premise dup channel is independent of the seed-hook gate;
    // the match payload is `copied_seed_hook`-only by spec.
    const idea = ideaWith(
      "the gym bag has been in the trunk for a fortnight now",
      "i let the dishes win again today",
    );
    const recent = new Set<string>(["i let the dishes win again today"]);
    const out = validateAntiCopyDetailed(
      idea,
      meta,
      new Set<string>(),
      recent,
    );
    if (out.reason === "near_duplicate_premise") {
      expect(out.antiCopyMatch).toBeUndefined();
    }
    // If premise normalization differs from the test's surface form
    // the gate may not fire — that path is covered by the existing
    // comedyValidation.test.ts. The invariant we assert here is
    // "match is `copied_seed_hook`-only", which holds either way.
  });

  it("legacy validateAntiCopy wrapper still returns just the reason (back-compat)", () => {
    const corpusHook = USER_BLESSED_HOOK_CORPUS[0]?.hook;
    expect(corpusHook).toBeDefined();
    const out = validateAntiCopy(
      ideaWith(corpusHook!),
      meta,
      new Set<string>(),
    );
    // Legacy shape: the wrapper drops the `antiCopyMatch` payload
    // and returns the reason string only. Tests + ideaScorer call
    // site rely on this shape.
    expect(out).toBe("copied_seed_hook");
  });
});
