/**
 * PHASE N1-FOLLOWUP-NG-CLEAN-SLOT0-CORPUS-FEED-NO-AUTHORING — pure
 * helper that promotes a deterministic clean-core "hero" entry into
 * slot 0 of an ng_clean batch.
 *
 * Contrast with the sibling `nigerianCleanCoreSlot0AntiRepeatSwap`:
 * the anti-repeat swap can ONLY rotate slot 0 to an alternative
 * already present in `final` (SWAP-only). The corpus-feed selector,
 * by design, draws the hero directly from
 * `NIGERIAN_CLEAN_CORE_ENTRIES`, runs it through the existing
 * `authorPackEntryAsIdea` validator path (no validator changes), and
 * promotes the result to slot 0 — preserving slots 1..N untouched.
 *
 * Hard constraints (mirrored from the session plan):
 *   1. NO new corpus entries — the hero pool is a strict subset of
 *      `NIGERIAN_CLEAN_CORE_ENTRIES` filtered at module load by:
 *        • boot-time validator (`isValidNigerianCleanCoreEntry`)
 *        • non-empty reviewer stamp (sanity)
 *        • `scoreHookQuality(hook, "absurd_escalation") >= 50`
 *          (the picker floor used at the catalog selection site)
 *        • not in the user-rejected `REJECTED_HOOKS_LC` set
 *   2. NO floor / validator / K / prompt / API / mobile / DB /
 *      schema changes — this module only reads existing public
 *      surfaces and writes a fresh slot-0 candidate built from the
 *      authoring helper that the production ng_clean catalog block
 *      already invokes (`authorPackEntryAsIdea`).
 *   3. NO random behaviour — selection is deterministic in
 *      `(creatorId, recentSlot0CleanCoreEntryIds)`. Tied entries
 *      (same HQS) are broken by ascending entry id.
 *   4. NO cohort leakage — the helper does NOT consult the
 *      activation gate; the caller MUST guard with
 *      `region === "nigeria" && languageStyle === "clean" &&
 *      regenerate === false && creatorId is non-empty`. With the
 *      hero pool drawn from the clean-core corpus only, even a
 *      forgotten gate cannot leak non-clean material.
 *   5. SWAP-/REPLACE-IN-PLACE for slot 0 only. Slots 1..N are kept
 *      bit-identical (same array order, same identities). Returned
 *      array length always equals `final.length`.
 *   6. Best-effort: if the hero pool is empty (extreme corpus
 *      regression) or the chosen entry fails the runtime validator
 *      at apply-time (defence-in-depth — should never fire because
 *      the pool is HQS≥50-prefiltered and runtime-validated by the
 *      existing `nigerianCleanCorePack.test.ts` aggregate), the
 *      helper is a no-op and returns the input array unchanged.
 *
 * Stage placement (caller wires it AFTER the anti-repeat swap and
 * BEFORE the per-creator slot-0 memory write so the freshly placed
 * hero entry id is the value persisted into recent memory).
 */

import {
  NIGERIAN_CLEAN_CORE_ENTRIES,
  NIGERIAN_CLEAN_CORE_PREMISE_FAMILY_TO_PACK_DOMAIN,
  isValidNigerianCleanCoreEntry,
  type NigerianCleanCoreEntry,
} from "./nigerianCleanCorePack.js";
import { scoreHookQuality } from "./hookQuality.js";
import {
  authorPackEntryAsIdea,
  type AuthorPackEntryInput,
} from "./nigerianPackAuthor.js";
import { PREMISE_CORES } from "./premiseCoreLibrary.js";
import { VOICE_CLUSTERS } from "./voiceClusters.js";
import type { NigerianPackEntry } from "./nigerianHookPack.js";
import type { Idea } from "./ideaGen.js";
import type {
  CandidateMeta,
  IdeaScore,
  ScoredCandidate,
} from "./ideaScorer.js";

/**
 * The 9 user-rejected hook strings — 5 that were imported into the
 * corpus as ng_clean_065..069 and 4 that were drafted but never
 * imported. Stored lowercased + trimmed; the corpus has been hard-
 * deleted of all 9, so this set is a defence-in-depth filter that
 * also documents intent.
 */
export const REJECTED_HOOKS_LC: ReadonlySet<string> = new Set([
  "the bank app smiled before rejecting my confidence.",
  "the pos receipt printed slower than my excuses.",
  "the group chat appointed me without discussion.",
  "the doorbell rang while i was acting serious.",
  "the email subject already sounded like extra work.",
  "the delivery code made me sound suspicious outside.",
  "the room door opened during my serious content.",
  "the extension box turned charging into family politics.",
  "the front camera corrected my whole confidence.",
]);

/**
 * The picker quality floor used at the catalog site
 * (`willingnessScorer.ts` PICKER_HQS_FLOOR = 50). We hold our hero
 * pool to the same bar so a hero promotion can never bypass the
 * production picker floor.
 */
export const NG_CLEAN_SLOT0_HERO_HQS_FLOOR = 50;

/**
 * Pre-scored hero pool entry — built once at module load so the
 * runtime selector is O(N) over a tiny pool, not O(N) over the full
 * 66-entry corpus + a per-call HQS scoring pass.
 */
export interface HeroPoolEntry {
  readonly entry: NigerianCleanCoreEntry;
  readonly hookQualityScore: number;
}

/**
 * Pinned author core / voice — `PREMISE_CORES[0]` and
 * `VOICE_CLUSTERS[0]`. The same pinning is used by the
 * `nigerianCleanCorePack.test.ts` runtime-validator describe block
 * which proves all 66 corpus entries author-and-validate cleanly
 * with this exact pin. Pinning here gives us bit-identical author
 * behaviour with no new surface.
 *
 * Both arrays are non-empty (top-level invariants of their
 * respective modules), but we still guard with `??` to satisfy
 * `noUncheckedIndexedAccess`.
 */
const HERO_AUTHOR_CORE = PREMISE_CORES[0]!;
const HERO_AUTHOR_VOICE = VOICE_CLUSTERS[0]!;
const HERO_AUTHOR_VOICE_CLUSTER_ID = HERO_AUTHOR_VOICE.id;

/**
 * Build the hero pool ONCE at module load:
 *   • passes the boot-time entry validator
 *   • carries a non-empty reviewer stamp (defence-in-depth — the
 *     entry validator already enforces this, but we re-check so any
 *     future relaxation of `isValidNigerianCleanCoreEntry` does not
 *     accidentally widen the hero pool)
 *   • hook is NOT in `REJECTED_HOOKS_LC`
 *   • `scoreHookQuality(hook, "absurd_escalation") >= 50`
 *
 * Sorted by `(hookQualityScore DESC, entry.id ASC)` so a downstream
 * "best fresh hero" walk is just a linear scan of this array.
 *
 * Family note: we deliberately score against the
 * `"absurd_escalation"` family rather than each entry's curator-
 * declared `premiseFamily`. The hero will be authored under the
 * pinned `PREMISE_CORES[0]` core (which carries its own `family`
 * field set by the library); pre-scoring against
 * `absurd_escalation` mirrors the family the
 * `hookQualityImplicitAnthropomorphFix.test.ts` POSITIVES describe
 * block uses for the surviving 070/071 hooks, and is the strictest
 * floor in practice (the absurd-escalation family is the most
 * conservative scorer for clean-English hooks). A hero that clears
 * this floor will also clear the per-core family floor at the
 * downstream picker.
 */
const HERO_POOL: ReadonlyArray<HeroPoolEntry> = (() => {
  const pool: HeroPoolEntry[] = [];
  for (const entry of NIGERIAN_CLEAN_CORE_ENTRIES) {
    if (!isValidNigerianCleanCoreEntry(entry)) continue;
    if (typeof entry.reviewedBy !== "string" || entry.reviewedBy.length === 0)
      continue;
    const hookLc = entry.hook.toLowerCase().trim();
    if (REJECTED_HOOKS_LC.has(hookLc)) continue;
    const hqs = scoreHookQuality(entry.hook, "absurd_escalation");
    if (hqs < NG_CLEAN_SLOT0_HERO_HQS_FLOOR) continue;
    pool.push({ entry, hookQualityScore: hqs });
  }
  pool.sort((a, b) => {
    if (b.hookQualityScore !== a.hookQualityScore) {
      return b.hookQualityScore - a.hookQualityScore;
    }
    return a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0;
  });
  return Object.freeze(pool);
})();

/** Test/observability accessor — read-only view of the hero pool. */
export const getNgCleanSlot0HeroPool = (): ReadonlyArray<HeroPoolEntry> =>
  HERO_POOL;

/**
 * Deterministic per-creator djb2 hash modulo the tied-set length.
 * Used ONLY to break ties when multiple hero entries share the
 * top HQS AND none are in recent memory. Same `(creatorId, n)` ⇒
 * same index; replays are bit-identical.
 */
const djb2Mod = (s: string, n: number): number => {
  if (n <= 1) return 0;
  let h = 5381 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return h % n;
};

export interface Slot0CorpusFeedSelectorInput {
  readonly creatorId: string;
  readonly recentSlot0CleanCoreEntryIds: ReadonlySet<string>;
}

export interface Slot0CorpusFeedSelectorResult {
  /** Selected hero entry, or null if the hero pool is empty. */
  readonly entry: NigerianCleanCoreEntry | null;
  /** Pre-scored HQS used in selection (mirrors HERO_POOL). */
  readonly hookQualityScore: number;
  /** True when no fresh hero existed; the picker fell back to the
   *  full hero pool to honour the never-empty contract. */
  readonly fellBackToFullPool: boolean;
}

/**
 * Pick the slot-0 hero entry deterministically.
 *
 *   1. Filter the pre-scored hero pool to entries NOT in recent
 *      memory.
 *   2. If non-empty, the candidate set is "fresh"; otherwise we
 *      fall back to the full pool so the helper still has SOMETHING
 *      to author (this fallback only fires after a creator has
 *      cycled through every fresh hero, which on a 60+-entry pool
 *      with a 20-entry memory cap means after ≥40 ng_clean batches).
 *   3. Within the chosen set, the top HQS group wins; ties are
 *      broken by `djb2(creatorId)` mod the tied-set length, then
 *      by ascending id.
 */
export const selectNgCleanSlot0CorpusHero = (
  input: Slot0CorpusFeedSelectorInput,
): Slot0CorpusFeedSelectorResult => {
  if (HERO_POOL.length === 0) {
    return {
      entry: null,
      hookQualityScore: 0,
      fellBackToFullPool: false,
    };
  }
  const fresh = HERO_POOL.filter(
    (h) => !input.recentSlot0CleanCoreEntryIds.has(h.entry.id),
  );
  const fellBack = fresh.length === 0;
  const pool = fellBack ? HERO_POOL : fresh;
  const topScore = pool[0]!.hookQualityScore;
  const tiedTop = pool.filter((h) => h.hookQualityScore === topScore);
  // tiedTop is already sorted by id ASC because HERO_POOL is.
  const idx = djb2Mod(input.creatorId, tiedTop.length);
  const winner = tiedTop[idx]!;
  return {
    entry: winner.entry,
    hookQualityScore: winner.hookQualityScore,
    fellBackToFullPool: fellBack,
  };
};

/**
 * Author the chosen hero entry into a fully-validated `Idea + meta`
 * pair via the existing production helper `authorPackEntryAsIdea`,
 * with the ng_clean catalog block's "clean-English whyItWorks
 * override" applied so the shipped copy does not say "Pidgin
 * cadence" (mirrors `coreCandidateGenerator.ts` L1290–1305).
 *
 * Returns `null` when the validator rejects the entry (defence-in-
 * depth — the hero pool is HQS≥50-prefiltered and proven validator-
 * clean by the corpus tests).
 */
export interface HeroAuthorResult {
  readonly idea: Idea;
  readonly meta: CandidateMeta;
  readonly hookQualityScore: number;
  readonly entryId: string;
}

export const authorNgCleanSlot0HeroIdea = (
  entry: NigerianCleanCoreEntry,
  regenerateSalt: number,
): HeroAuthorResult | null => {
  const projectedDomain =
    NIGERIAN_CLEAN_CORE_PREMISE_FAMILY_TO_PACK_DOMAIN[entry.premiseFamily] ??
    "everyday";
  const packShape: NigerianPackEntry = {
    hook: entry.hook,
    whatToShow: entry.whatToShow,
    howToFilm: entry.howToFilm,
    caption: entry.caption,
    anchor: entry.anchor,
    domain: projectedDomain,
    pidginLevel: "light_pidgin",
    reviewedBy: entry.reviewedBy,
  };
  const authorInput: AuthorPackEntryInput = {
    entry: packShape,
    core: HERO_AUTHOR_CORE,
    voice: HERO_AUTHOR_VOICE,
    regenerateSalt,
    seedFingerprints: new Set(),
  };
  const r = authorPackEntryAsIdea(authorInput);
  if (!r.ok) return null;
  const anchorLc = entry.anchor.toLowerCase();
  const cleanIdea: Idea = {
    ...r.idea,
    whyItWorks: `Clean-English cadence on '${anchorLc}' — curated for filmability.`,
  };
  const quality = scoreHookQuality(cleanIdea.hook, HERO_AUTHOR_CORE.family);
  const meta: CandidateMeta = {
    ...r.meta,
    scenarioFingerprint: r.scenarioFingerprint,
    voiceClusterId: HERO_AUTHOR_VOICE_CLUSTER_ID,
    hookQualityScore: quality,
  };
  return {
    idea: cleanIdea,
    meta,
    hookQualityScore: quality,
    entryId: entry.id,
  };
};

export interface ApplyResultDetail {
  readonly heroEntryId: string;
  readonly heroHookQualityScore: number;
  readonly replacedHook: string;
  readonly fellBackToFullPool: boolean;
}

export interface ApplyResult<T extends ScoredCandidate> {
  readonly final: ReadonlyArray<T>;
  readonly applied: boolean;
  readonly detail: ApplyResultDetail | null;
}

/**
 * Apply the corpus-feed hero to slot 0.
 *
 * Returns the input array reference unchanged when:
 *   • final.length === 0
 *   • the selector returns no hero (empty pool)
 *   • the runtime author rejects the hero (defence-in-depth)
 *
 * Otherwise returns a NEW array where slot 0 is the freshly
 * authored hero candidate (with `score` and `rewriteAttempted`
 * inherited from the original slot-0 shell so downstream telemetry
 * has the same shape) and slots 1..N are byte-identical references
 * from the original `final`.
 *
 * `score` and `rewriteAttempted` are inherited from the displaced
 * slot-0 shell on purpose: the score is a transient willingness
 * ranking artefact that downstream code does not re-consult after
 * this point in the pipeline; preserving the shell's value avoids
 * introducing a synthetic IdeaScore here.
 */
export const applyNgCleanSlot0CorpusFeed = <T extends ScoredCandidate>(
  final: ReadonlyArray<T>,
  input: Slot0CorpusFeedSelectorInput,
  regenerateSalt: number,
): ApplyResult<T> => {
  if (final.length === 0) {
    return { final, applied: false, detail: null };
  }
  const selection = selectNgCleanSlot0CorpusHero(input);
  if (!selection.entry) {
    return { final, applied: false, detail: null };
  }
  const authored = authorNgCleanSlot0HeroIdea(selection.entry, regenerateSalt);
  if (!authored) {
    return { final, applied: false, detail: null };
  }
  const slot0Shell = final[0]!;
  const replacedHook = slot0Shell.idea.hook;
  // Build a fresh slot-0 candidate. Inheriting `score` /
  // `rewriteAttempted` from the displaced shell keeps the
  // ScoredCandidate shape intact without any new IdeaScore math.
  const heroCandidate = {
    ...slot0Shell,
    idea: authored.idea,
    meta: authored.meta,
    score: slot0Shell.score satisfies IdeaScore,
    rewriteAttempted: slot0Shell.rewriteAttempted,
  } as T;
  const next: T[] = final.slice();
  next[0] = heroCandidate;
  return {
    final: next,
    applied: true,
    detail: {
      heroEntryId: authored.entryId,
      heroHookQualityScore: authored.hookQualityScore,
      replacedHook,
      fellBackToFullPool: selection.fellBackToFullPool,
    },
  };
};
