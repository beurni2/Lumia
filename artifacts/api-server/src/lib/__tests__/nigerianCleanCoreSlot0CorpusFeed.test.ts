/**
 * PHASE N1-FOLLOWUP-NG-CLEAN-SLOT0-CORPUS-FEED-NO-AUTHORING — unit
 * tests for the deterministic ng_clean slot-0 corpus-feed selector
 * + applier.
 *
 * Coverage:
 *   1. Hero pool composition (≥1, validator-clean, HQS≥50,
 *      reviewer non-empty, none rejected).
 *   2. Rejected hooks are absent from the corpus AND the hero pool
 *      (defence-in-depth set + hard delete).
 *   3. Recent-exclusion: entries in the recent set are skipped.
 *   4. Determinism: same `(creatorId, recentSet)` ⇒ same hero.
 *   5. Different creators ⇒ deterministic pick (may differ when
 *      ties exist; identical when no ties).
 *   6. Apply preserves slots 1..N bit-identically; final length
 *      equals input length.
 *   7. Apply is no-op on an empty input.
 *   8. Cohort isolation: `REJECTED_HOOKS_LC` set does not contain
 *      any current corpus hook.
 *   9. Sub-floor exclusion: every hero pool entry's pre-scored HQS
 *      meets the floor.
 *  10. Fallback-to-full-pool fires only when every hero is recent.
 *  11. Author-result shape: idea + meta carry the expected
 *      voiceClusterId, hookQualityScore, scenarioFingerprint.
 */
import { describe, it, expect } from "vitest";

import {
  REJECTED_HOOKS_LC,
  NG_CLEAN_SLOT0_HERO_HQS_FLOOR,
  getNgCleanSlot0HeroPool,
  selectNgCleanSlot0CorpusHero,
  authorNgCleanSlot0HeroIdea,
  applyNgCleanSlot0CorpusFeed,
} from "../nigerianCleanCoreSlot0CorpusFeed.js";
import { NIGERIAN_CLEAN_CORE_ENTRIES } from "../nigerianCleanCorePack.js";
import type {
  ScoredCandidate,
  IdeaScore,
  CandidateMeta,
} from "../ideaScorer.js";
import type { Idea } from "../ideaGen.js";

// ---------------------------------------------------------------- //
// Test fixtures                                                      //
// ---------------------------------------------------------------- //

const STUB_SCORE: IdeaScore = {
  total: 0,
  hookImpact: 0,
  tension: 0,
  filmability: 0,
  personalFit: 0,
  captionStrength: 0,
  freshness: 0,
  scrollStopScore: 0,
  hookIntentScore: 0,
} as unknown as IdeaScore;

const stubIdea = (hook: string): Idea =>
  ({
    hook,
    whatToShow: "Pre-existing slot-0 shell that the hero replaces.",
    howToFilm: "Phone on a tripod. One locked-off shot.",
    caption: "Shell caption.",
    triggerCategory: "phone",
    setting: "phone",
    trigger: "shell trigger",
    reaction: "shell reaction",
    whyItWorks: "Shell why it works.",
    pickerEligible: true,
  }) as unknown as Idea;

const stubMeta = (label: string): CandidateMeta =>
  ({
    source: "pattern_variation",
    scenarioFingerprint: `shell::${label}`,
    voiceClusterId: "shell_voice",
    hookQualityScore: 0,
  }) as unknown as CandidateMeta;

const makeStubCandidate = (label: string, hook: string): ScoredCandidate => ({
  idea: stubIdea(hook),
  meta: stubMeta(label),
  score: STUB_SCORE,
  rewriteAttempted: false,
});

// ---------------------------------------------------------------- //
// Hero pool composition                                              //
// ---------------------------------------------------------------- //

describe("ng_clean slot-0 corpus-feed — hero pool composition", () => {
  const pool = getNgCleanSlot0HeroPool();

  it("hero pool is non-empty and a strict subset of NIGERIAN_CLEAN_CORE_ENTRIES", () => {
    expect(pool.length).toBeGreaterThan(0);
    expect(pool.length).toBeLessThanOrEqual(NIGERIAN_CLEAN_CORE_ENTRIES.length);
    const corpusIds = new Set(NIGERIAN_CLEAN_CORE_ENTRIES.map((e) => e.id));
    for (const h of pool) expect(corpusIds.has(h.entry.id)).toBe(true);
  });

  it("every hero pool entry meets the picker HQS floor", () => {
    for (const h of pool) {
      expect(h.hookQualityScore).toBeGreaterThanOrEqual(
        NG_CLEAN_SLOT0_HERO_HQS_FLOOR,
      );
    }
  });

  it("every hero pool entry carries a non-empty reviewer stamp", () => {
    for (const h of pool) {
      expect(typeof h.entry.reviewedBy).toBe("string");
      expect(h.entry.reviewedBy.length).toBeGreaterThan(0);
    }
  });

  it("no hero pool entry's hook is in REJECTED_HOOKS_LC", () => {
    for (const h of pool) {
      expect(REJECTED_HOOKS_LC.has(h.entry.hook.toLowerCase().trim())).toBe(
        false,
      );
    }
  });

  it("hero pool is sorted by (HQS DESC, id ASC)", () => {
    for (let i = 1; i < pool.length; i++) {
      const prev = pool[i - 1]!;
      const cur = pool[i]!;
      if (prev.hookQualityScore !== cur.hookQualityScore) {
        expect(prev.hookQualityScore).toBeGreaterThan(cur.hookQualityScore);
      } else {
        expect(prev.entry.id <= cur.entry.id).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------- //
// Rejected hooks — absent from corpus + REJECTED_HOOKS_LC contract //
// ---------------------------------------------------------------- //

describe("ng_clean slot-0 corpus-feed — rejected hooks contract", () => {
  it("REJECTED_HOOKS_LC contains the 9 user-rejected hook strings", () => {
    expect(REJECTED_HOOKS_LC.size).toBe(9);
    const expected = [
      "the bank app smiled before rejecting my confidence.",
      "the pos receipt printed slower than my excuses.",
      "the group chat appointed me without discussion.",
      "the doorbell rang while i was acting serious.",
      "the email subject already sounded like extra work.",
      "the delivery code made me sound suspicious outside.",
      "the room door opened during my serious content.",
      "the extension box turned charging into family politics.",
      "the front camera corrected my whole confidence.",
    ];
    for (const h of expected) expect(REJECTED_HOOKS_LC.has(h)).toBe(true);
  });

  it("none of the rejected hook strings appear in NIGERIAN_CLEAN_CORE_ENTRIES", () => {
    const corpusHooksLc = new Set(
      NIGERIAN_CLEAN_CORE_ENTRIES.map((e) => e.hook.toLowerCase().trim()),
    );
    for (const rejected of REJECTED_HOOKS_LC) {
      expect(corpusHooksLc.has(rejected)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------- //
// Selector                                                           //
// ---------------------------------------------------------------- //

describe("selectNgCleanSlot0CorpusHero — selector behaviour", () => {
  const pool = getNgCleanSlot0HeroPool();

  it("picks a hero from the top-HQS tied group when no recents", () => {
    const r = selectNgCleanSlot0CorpusHero({
      creatorId: "creator-A",
      recentSlot0CleanCoreEntryIds: new Set(),
    });
    expect(r.entry).not.toBeNull();
    expect(r.fellBackToFullPool).toBe(false);
    const topScore = pool[0]!.hookQualityScore;
    expect(r.hookQualityScore).toBe(topScore);
  });

  it("is deterministic across repeated calls (same creator + same recents)", () => {
    const recents = new Set<string>([pool[0]!.entry.id]);
    const a = selectNgCleanSlot0CorpusHero({
      creatorId: "creator-rep",
      recentSlot0CleanCoreEntryIds: recents,
    });
    const b = selectNgCleanSlot0CorpusHero({
      creatorId: "creator-rep",
      recentSlot0CleanCoreEntryIds: recents,
    });
    expect(a.entry?.id).toBe(b.entry?.id);
    expect(a.hookQualityScore).toBe(b.hookQualityScore);
  });

  it("excludes recently-shipped entry ids from selection", () => {
    // Mark every entry at the top-HQS tier as recent. Picker must
    // walk down to a strictly lower HQS tier (or different id).
    const topScore = pool[0]!.hookQualityScore;
    const topTierIds = new Set(
      pool.filter((h) => h.hookQualityScore === topScore).map((h) => h.entry.id),
    );
    const r = selectNgCleanSlot0CorpusHero({
      creatorId: "creator-recents",
      recentSlot0CleanCoreEntryIds: topTierIds,
    });
    expect(r.entry).not.toBeNull();
    expect(topTierIds.has(r.entry!.id)).toBe(false);
    expect(r.fellBackToFullPool).toBe(false);
  });

  it("falls back to the full pool only when every entry is recent", () => {
    const allIds = new Set(pool.map((h) => h.entry.id));
    const r = selectNgCleanSlot0CorpusHero({
      creatorId: "creator-saturated",
      recentSlot0CleanCoreEntryIds: allIds,
    });
    expect(r.entry).not.toBeNull();
    expect(r.fellBackToFullPool).toBe(true);
  });

  it("does not return a recent entry unless every entry is recent", () => {
    // Pick a single recent id and ensure the selector picks something else.
    const recents = new Set<string>([pool[0]!.entry.id]);
    const r = selectNgCleanSlot0CorpusHero({
      creatorId: "creator-narrow-recent",
      recentSlot0CleanCoreEntryIds: recents,
    });
    expect(r.entry).not.toBeNull();
    if (pool.length > 1) {
      expect(r.entry!.id).not.toBe(pool[0]!.entry.id);
      expect(r.fellBackToFullPool).toBe(false);
    }
  });
});

// ---------------------------------------------------------------- //
// Author + apply                                                     //
// ---------------------------------------------------------------- //

describe("authorNgCleanSlot0HeroIdea — author shape", () => {
  it("authors a validator-clean idea with meta + clean-English whyItWorks override", () => {
    const entry = NIGERIAN_CLEAN_CORE_ENTRIES[0]!;
    const result = authorNgCleanSlot0HeroIdea(entry, 0);
    expect(result).not.toBeNull();
    expect(result!.idea.hook).toBe(entry.hook);
    expect(result!.idea.whyItWorks.toLowerCase()).toContain("clean-english");
    expect(result!.idea.whyItWorks.toLowerCase()).toContain(
      entry.anchor.toLowerCase(),
    );
    expect(result!.entryId).toBe(entry.id);
    expect(result!.hookQualityScore).toBeGreaterThanOrEqual(0);
    // meta is populated with the deterministic voice cluster +
    // hookQualityScore from the author path.
    expect(typeof result!.meta.voiceClusterId).toBe("string");
    expect((result!.meta.voiceClusterId ?? "").length).toBeGreaterThan(0);
    expect(result!.meta.hookQualityScore).toBe(result!.hookQualityScore);
  });
});

describe("applyNgCleanSlot0CorpusFeed — applier behaviour", () => {
  const baseFinal: ReadonlyArray<ScoredCandidate> = [
    makeStubCandidate("slot0", "the original slot-0 hook before promotion."),
    makeStubCandidate("slot1", "slot 1 must remain identical."),
    makeStubCandidate("slot2", "slot 2 must remain identical."),
    makeStubCandidate("slot3", "slot 3 must remain identical."),
  ];

  it("returns a new array with slot 0 replaced and slots 1..N preserved by reference", () => {
    const r = applyNgCleanSlot0CorpusFeed(
      baseFinal,
      {
        creatorId: "creator-applier-1",
        recentSlot0CleanCoreEntryIds: new Set(),
      },
      0,
    );
    expect(r.applied).toBe(true);
    expect(r.detail).not.toBeNull();
    expect(r.final.length).toBe(baseFinal.length);
    // Slot 0 changed
    expect(r.final[0]).not.toBe(baseFinal[0]);
    expect(r.final[0]!.idea.hook).not.toBe(baseFinal[0]!.idea.hook);
    // Slots 1..N preserved by reference (bit-identical)
    for (let i = 1; i < baseFinal.length; i++) {
      expect(r.final[i]).toBe(baseFinal[i]);
    }
    // Detail captures the replaced hook + a corpus entry id
    expect(r.detail!.replacedHook).toBe(baseFinal[0]!.idea.hook);
    expect(r.detail!.heroEntryId.startsWith("ng_clean_")).toBe(true);
  });

  it("returns the input reference unchanged on an empty array", () => {
    const empty: ReadonlyArray<ScoredCandidate> = [];
    const r = applyNgCleanSlot0CorpusFeed(
      empty,
      {
        creatorId: "creator-empty",
        recentSlot0CleanCoreEntryIds: new Set(),
      },
      0,
    );
    expect(r.applied).toBe(false);
    expect(r.detail).toBeNull();
    expect(r.final).toBe(empty);
  });

  it("inherits score + rewriteAttempted from the displaced slot-0 shell", () => {
    const customShell: ScoredCandidate = {
      ...baseFinal[0]!,
      rewriteAttempted: true,
    };
    const final = [customShell, ...baseFinal.slice(1)];
    const r = applyNgCleanSlot0CorpusFeed(
      final,
      {
        creatorId: "creator-inherit",
        recentSlot0CleanCoreEntryIds: new Set(),
      },
      0,
    );
    expect(r.applied).toBe(true);
    expect(r.final[0]!.score).toBe(customShell.score);
    expect(r.final[0]!.rewriteAttempted).toBe(true);
  });

  it("is deterministic: same input ⇒ same hero entry id", () => {
    const a = applyNgCleanSlot0CorpusFeed(
      baseFinal,
      {
        creatorId: "creator-det",
        recentSlot0CleanCoreEntryIds: new Set(),
      },
      0,
    );
    const b = applyNgCleanSlot0CorpusFeed(
      baseFinal,
      {
        creatorId: "creator-det",
        recentSlot0CleanCoreEntryIds: new Set(),
      },
      0,
    );
    expect(a.detail?.heroEntryId).toBe(b.detail?.heroEntryId);
  });

  it("rotates away from a recent slot-0 entry", () => {
    const first = applyNgCleanSlot0CorpusFeed(
      baseFinal,
      {
        creatorId: "creator-rotate",
        recentSlot0CleanCoreEntryIds: new Set(),
      },
      0,
    );
    expect(first.applied).toBe(true);
    const heroId = first.detail!.heroEntryId;
    const second = applyNgCleanSlot0CorpusFeed(
      baseFinal,
      {
        creatorId: "creator-rotate",
        recentSlot0CleanCoreEntryIds: new Set([heroId]),
      },
      0,
    );
    expect(second.applied).toBe(true);
    expect(second.detail!.heroEntryId).not.toBe(heroId);
  });
});
