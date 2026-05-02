/**
 * PHASE D2 — corpus integrity + integration tests.
 *
 * - Corpus-side: every entry's anchor literally appears in its hook
 *   (the construction precondition the cohesive author depends on),
 *   every cluster has the boot-floor coverage (≥8), the deterministic
 *   pickers are stable across calls.
 * - Author-side: when the corpus gate trips and a hook is drawn,
 *   the resulting Idea's `hook` is the verbatim corpus hook AND the
 *   downstream `whatToShow` / `howToFilm` reference the corpus's
 *   anchor (not the recipe's catalog anchor).
 */
import { describe, it, expect } from "vitest";
import {
  USER_BLESSED_HOOK_CORPUS,
  getCorpusHooksByCluster,
  pickCorpusHook,
  shouldDrawFromCorpus,
} from "../userBlessedHookCorpus.js";
import {
  authorCohesiveIdea,
  type CohesiveAuthorResult,
} from "../cohesiveIdeaAuthor.js";

type CohesiveIdea = Extract<CohesiveAuthorResult, { ok: true }>["idea"];
import { getVoiceCluster, type VoiceClusterId } from "../voiceClusters.js";
import { PREMISE_CORES } from "../premiseCoreLibrary.js";

const CLUSTERS: readonly VoiceClusterId[] = [
  "dry_deadpan",
  "chaotic_confession",
  "overdramatic_reframe",
  "quiet_realization",
];

describe("USER_BLESSED_HOOK_CORPUS integrity", () => {
  it("has at least 100 entries (5x the per-cluster template pool)", () => {
    expect(USER_BLESSED_HOOK_CORPUS.length).toBeGreaterThanOrEqual(100);
  });

  it("every entry's anchor literally appears in its hook (lowercase substring)", () => {
    for (const e of USER_BLESSED_HOOK_CORPUS) {
      expect(
        e.hook.toLowerCase().includes(e.anchor.toLowerCase()),
        `anchor '${e.anchor}' missing from hook '${e.hook}'`,
      ).toBe(true);
    }
  });

  it("every entry's cluster is one of the 4 valid voice clusters", () => {
    for (const e of USER_BLESSED_HOOK_CORPUS) {
      expect(CLUSTERS).toContain(e.cluster);
    }
  });

  it("every cluster pool has ≥8 entries (boot-floor coverage)", () => {
    for (const cid of CLUSTERS) {
      expect(getCorpusHooksByCluster(cid).length).toBeGreaterThanOrEqual(8);
    }
  });
});

describe("pickCorpusHook / shouldDrawFromCorpus determinism", () => {
  it("pickCorpusHook returns byte-identical output for byte-identical input", () => {
    const a = pickCorpusHook({ cluster: "dry_deadpan", salt: 42, key: "k" });
    const b = pickCorpusHook({ cluster: "dry_deadpan", salt: 42, key: "k" });
    expect(a).toEqual(b);
    expect(a?.cluster).toBe("dry_deadpan");
  });

  it("shouldDrawFromCorpus is stable on a given (salt, key)", () => {
    expect(shouldDrawFromCorpus({ salt: 7, key: "x" })).toBe(
      shouldDrawFromCorpus({ salt: 7, key: "x" }),
    );
  });

  it("shouldDrawFromCorpus fires roughly ~30% across many keys", () => {
    let trips = 0;
    const N = 1000;
    for (let i = 0; i < N; i++) {
      if (shouldDrawFromCorpus({ salt: 0, key: `k${i}` })) trips++;
    }
    // 30% target with ±10% tolerance — generous bounds, the goal is
    // catching a regression that flipped the gate (always-on /
    // always-off / inverted), not pinning the precise rate.
    expect(trips).toBeGreaterThan(N * 0.2);
    expect(trips).toBeLessThan(N * 0.4);
  });
});

describe("authorCohesiveIdea — corpus path integration", () => {
  // Find a (core, voice, salt) where the corpus gate trips so we can
  // verify the corpus path actually wires through to the Idea. We
  // search across salts because the gate is deterministic; with the
  // ~30% rate the first salt that hits is small.
  function findCorpusHitInputs(): {
    salt: number;
    coreId: string;
    voiceId: VoiceClusterId;
    catalogAnchor: string;
  } | null {
    const core = PREMISE_CORES[0]!; // any core works for the gate
    const voiceId: VoiceClusterId = "dry_deadpan";
    const catalogAnchor = "alarm";
    for (let salt = 0; salt < 200; salt++) {
      const key = `${core.id}|${catalogAnchor}|${voiceId}`;
      if (shouldDrawFromCorpus({ salt, key })) {
        return { salt, coreId: core.id, voiceId, catalogAnchor };
      }
    }
    return null;
  }

  it("a corpus-gate-tripping recipe ships an Idea whose hook is the verbatim corpus hook AND the corpus anchor propagates to scene + caption + script", () => {
    // Search across the (core, voice, salt) space for an input that
    // (a) trips the corpus gate AND (b) yields ok=true. We MUST find
    // an ok corpus-path result to actually verify wiring through to
    // the rendered Idea — settling for "any non-construction_failed
    // outcome" leaves a regression hole (architect feedback D2).
    const voiceId: VoiceClusterId = "dry_deadpan";
    const voice = getVoiceCluster(voiceId);
    const catalogAnchor = "alarm";
    let okCorpusResult:
      | {
          salt: number;
          coreId: string;
          corpusAnchor: string;
          corpusHook: string;
          idea: CohesiveIdea;
        }
      | null = null;
    outer: for (const core of PREMISE_CORES.slice(0, 12)) {
      for (let salt = 0; salt < 400; salt++) {
        const key = `${core.id}|${catalogAnchor}|${voiceId}`;
        if (!shouldDrawFromCorpus({ salt, key })) continue;
        const corpusHit = pickCorpusHook({ cluster: voiceId, salt, key });
        if (!corpusHit) continue;
        const r = authorCohesiveIdea({
          core,
          domain: "sleep",
          anchor: catalogAnchor,
          action: "abandon",
          voice,
          regenerateSalt: salt,
          seedFingerprints: new Set<string>(),
        });
        if (r.ok) {
          okCorpusResult = {
            salt,
            coreId: core.id,
            corpusAnchor: corpusHit.anchor,
            corpusHook: corpusHit.hook,
            idea: r.idea,
          };
          break outer;
        }
      }
    }
    expect(
      okCorpusResult,
      "no (core, salt) in search space produced an ok corpus-path Idea — wiring may be broken",
    ).not.toBeNull();
    const { corpusAnchor, corpusHook, idea } = okCorpusResult!;
    const shipped = idea.hook.toLowerCase();
    // Hook is the verbatim corpus hook (modulo capWords truncation).
    const corpusPrefix = corpusHook
      .toLowerCase()
      .split(/\s+/)
      .slice(0, voice.lengthTargetWords[1])
      .join(" ");
    expect(shipped).toBe(corpusPrefix);
    // Anchor override propagates to ALL anchor-bearing scene + script fields.
    const lc = corpusAnchor.toLowerCase();
    expect(idea.whatToShow.toLowerCase()).toContain(lc);
    expect(idea.howToFilm.toLowerCase()).toContain(lc);
    expect(idea.hook.toLowerCase()).toContain(lc);
  });

  it("a NON-corpus-gate recipe still ships via the template path (no behavior change)", () => {
    const core = PREMISE_CORES[0]!;
    const voice = getVoiceCluster("dry_deadpan");
    // Find a salt that does NOT trip the gate.
    let salt = 0;
    for (; salt < 200; salt++) {
      if (
        !shouldDrawFromCorpus({
          salt,
          key: `${core.id}|alarm|dry_deadpan`,
        })
      ) {
        break;
      }
    }
    const result = authorCohesiveIdea({
      core,
      domain: "sleep",
      anchor: "alarm",
      action: "abandon",
      voice,
      regenerateSalt: salt,
      seedFingerprints: new Set<string>(),
    });
    if (result.ok) {
      // Template path: the hook contains the catalog anchor (the
      // template substitutes ${anchor} = "alarm").
      expect(result.idea.hook.toLowerCase()).toContain("alarm");
    } else {
      // Template path may still hit comedy/antiCopy; the regression
      // we guard against here is `construction_failed` from the
      // anchor-substitution path silently breaking.
      expect(result.reason).not.toBe("construction_failed");
    }
  });
});
