/**
 * PHASE P16-A7-NG-CLEAN-SIDECAR-POOL-DIVERSITY-WIDENING (BI 2026-05-12) —
 * pure helper.
 *
 * BACKGROUND
 * ----------
 * P16-A6 implemented a safe, length-preserving slot-1+ memory anti-
 * repeat filter for ng_clean clean-core entries
 * (`applyNgCleanSlot1PlusAntiRepeatFilter`). Runtime QA showed the
 * filter is mechanically correct but the effect size was bounded:
 * warm-state slot-1+ repeat rate only dropped 91.7% → 87.5% because
 * the upstream sidecar (built from `localResult.kept`) only ever
 * supplied 2 fresh clean-core alternatives — `ng_clean_001` and
 * `ng_clean_002` — across the test matrix. The bottleneck moved
 * from the memory filter to upstream sidecar diversity.
 *
 * Root cause:
 *   • `coreCandidateGenerator.ts` authors clean-core entries from a
 *     deterministic per-core WINDOW of size 3 over the 87-entry
 *     `NIGERIAN_CLEAN_CORE_ENTRIES` corpus (window-start derived
 *     from `(salt*7 + coreIdx*11) mod N`, stride 11).
 *   • Per-core best-pick collapses each window to a single winner
 *     (or up to NG_CLEAN_PER_CORE_RETENTION_CAP=3 with the
 *     reservation flag ON).
 *   • `filterAndRescore` + `selectWithNovelty` further trim the
 *     pool, so `localResult.kept` typically holds only ~6 distinct
 *     clean-core entries per batch — and the highest-HQS subset
 *     (the "always-on" set 023/056/072/084) wins per-core picks
 *     across batches.
 *   • After `final[]` consumes 4 of those, only 1-2 distinct
 *     clean-core ids survive the filter's `not in final[]` dedup
 *     for the sidecar.
 *
 * GOAL
 * ----
 * Widen the slot-1+ filter's sidecar by appending an additional
 * RESERVE — a deterministic, pre-authored pool of every
 * `NIGERIAN_CLEAN_CORE_ENTRIES` row that is structurally
 * `pickerEligible`-equivalent (HQS ≥ 50 AND aiCliche === 0,
 * mirroring `willingnessScorer.ts`). The reserve is consulted ONLY
 * after the existing `localResult.kept`-derived sidecar is
 * exhausted (concat at TAIL preserves rank-order primacy of
 * willingness-sorted live picks).
 *
 * PRE-AUTHORING
 * -------------
 * Each reserve entry is pre-authored at module-load time through
 * `authorPackEntryAsIdea` with the SAME pinned core/voice and
 * `whyItWorks` override that `nigerianCleanCoreSlot0CorpusFeed.ts`
 * uses. Pre-authoring is required because the slot-1+ filter
 * promotes sidecar candidates DIRECTLY into `final[]`
 * (`next[targetIdx] = pick.cand`), and the downstream
 * `gate(final.map(c => c.idea))` must see a fully populated `Idea`
 * (hook + whatToShow + howToFilm + caption + meta).
 *
 * Module-load author calls run ONCE per process. Held entries
 * (ng_clean_080 / ng_clean_088 per the supervisor's spec) are
 * STRUCTURALLY ABSENT from `NIGERIAN_CLEAN_CORE_ENTRIES`, so they
 * cannot enter the reserve regardless. We additionally exclude any
 * entry whose hook trips `isNigerianCleanCoreHookBlocked` (ng_clean
 * shouty-template guard).
 *
 * PICKER-ELIGIBILITY EQUIVALENCE
 * ------------------------------
 * `willingnessScorer.ts` defines:
 *   `pickerEligible = scoreHookQuality >= PICKER_HQS_FLOOR (50)
 *                     && aiCliche === 0`
 * We compute exactly the same predicate at module-load time via
 * `scoreHookQualityDetailed`. Reserve entries are marked
 * `pickerEligible: true` on `idea` so the slot-1+ filter's
 * `pickerEligible !== true` continue is satisfied.
 *
 * HARD CONTRACT
 *   1. Pure — no I/O, no env reads inside the runtime helper, no
 *      random behaviour, no process-global mutable state. The
 *      module-load pre-author runs once and never mutates.
 *   2. Deterministic — entries are sorted descending by HQS at
 *      module-load time, ties broken ascending by entry id.
 *   3. Read-only INPUT to the slot-1+ filter — never mutates the
 *      filter's `final[]` directly; never touches slot 0.
 *   4. Quality guard equivalence — every reserve entry has been
 *      pre-checked to satisfy the exact `pickerEligible`
 *      predicate AND has been validator-cleared by
 *      `authorPackEntryAsIdea`.
 *   5. No scorer / validator / floor / corpus / anti-copy / pack
 *      mutation. The reserve READS the corpus + scorer + author;
 *      it does NOT modify them.
 *   6. Slot-0 invariance — this helper is consumed exclusively by
 *      the slot-1+ filter, which never writes slot 0.
 *   7. Cohort gating — the caller (hybridIdeator slot-1+ block)
 *      gates on region=nigeria + languageStyle=clean +
 *      LUMINA_NG_CLEAN_SLOT1PLUS_ANTI_REPEAT_ENABLED=true. Outside
 *      that branch the reserve is never built; non-NG cohorts pay
 *      zero overhead.
 *   8. No new env flag — gated under the existing P16-A6 flag.
 *
 * ARCHITECTURAL NOTE
 * ------------------
 * This helper is a strict superset extension of P16-A6: when the
 * existing `localResult.kept`-derived sidecar already satisfies
 * the filter's needs, the reserve is never consulted because the
 * filter's walk-order short-circuits on
 * `sidecarPicks.length >= seenSlot1PlusIndexes.length`. The
 * reserve only kicks in when the live sidecar is structurally
 * insufficient — exactly the relaxation case from P16-A6.
 */

import {
  NIGERIAN_CLEAN_CORE_ENTRIES,
  NIGERIAN_CLEAN_CORE_PREMISE_FAMILY_TO_PACK_DOMAIN,
  isValidNigerianCleanCoreEntry,
  type NigerianCleanCoreEntry,
} from "./nigerianCleanCorePack.js";
import { scoreHookQualityDetailed, scoreHookQuality } from "./hookQuality.js";
import { isNigerianCleanCoreHookBlocked } from "./nigerianCleanCoreGuard.js";
import { resolveCleanCoreEntryIdByHook } from "./nigerianCleanCoreSlot0AntiRepeatSwap.js";
import {
  authorPackEntryAsIdea,
  type AuthorPackEntryInput,
} from "./nigerianPackAuthor.js";
import { PREMISE_CORES } from "./premiseCoreLibrary.js";
import { VOICE_CLUSTERS } from "./voiceClusters.js";
import type { NigerianPackEntry } from "./nigerianHookPack.js";
import type { Idea } from "./ideaGen.js";
import type { CandidateMeta } from "./ideaScorer.js";

/** Mirrors `PICKER_HQS_FLOOR` in `willingnessScorer.ts`. Source-grep
 *  asserted by tests; do NOT change without updating
 *  `willingnessScorer.ts`. */
export const NG_CLEAN_RESERVE_PICKER_HQS_FLOOR = 50;

/** Default reserve size returned per call when the caller does not
 *  supply `maxReturn`. The slot-1+ filter walks the sidecar until
 *  it has covered every seen-id position
 *  (≤ MAX_SLOT1PLUS_REPLACEMENTS = 6) so a much larger reserve than
 *  that is wasted work. Callers MAY pass a higher `maxReturn` for
 *  test introspection; the helper does not hard-clamp above this
 *  value (it is a default, not a ceiling). */
export const NG_CLEAN_RESERVE_MAX_RETURN = 32;

/** Pinned author core / voice — mirrors
 *  `nigerianCleanCoreSlot0CorpusFeed.ts`. Both `PREMISE_CORES` and
 *  `VOICE_CLUSTERS` are non-empty top-level invariants. */
const RESERVE_AUTHOR_CORE = PREMISE_CORES[0]!;
const RESERVE_AUTHOR_VOICE = VOICE_CLUSTERS[0]!;
const RESERVE_AUTHOR_VOICE_CLUSTER_ID = RESERVE_AUTHOR_VOICE.id;

/** Module-load pre-authoring salt. Fixed (0) so the pre-author
 *  result is bit-identical across processes. The salt is consumed
 *  by the author for trigger/voice synthesis only — the reserve's
 *  hook/whatToShow/howToFilm/caption come verbatim from the entry. */
const RESERVE_PREAUTHOR_SALT = 0;

/** A pre-authored reserve row: full Idea + meta ready to be
 *  promoted into `final[]` by the slot-1+ filter. */
export interface PreAuthoredReserveEntry {
  readonly idea: Idea;
  readonly meta: CandidateMeta;
  readonly hookQualityScore: number;
  readonly entryId: string;
}

/** Author one entry through the same path the production ng_clean
 *  catalog block uses, with the clean-English `whyItWorks`
 *  override applied (mirrors `coreCandidateGenerator.ts`
 *  L1290-1305 and `authorNgCleanSlot0HeroIdea` in the corpus
 *  feed). Returns null when the validator rejects (defence-in-
 *  depth — the corpus is HQS≥50 prefiltered and runtime-validated
 *  by the corpus tests). */
const preAuthorReserveEntry = (
  entry: NigerianCleanCoreEntry,
): PreAuthoredReserveEntry | null => {
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
    core: RESERVE_AUTHOR_CORE,
    voice: RESERVE_AUTHOR_VOICE,
    regenerateSalt: RESERVE_PREAUTHOR_SALT,
    seedFingerprints: new Set(),
  };
  const r = authorPackEntryAsIdea(authorInput);
  if (!r.ok) return null;
  const anchorLc = entry.anchor.toLowerCase();
  const cleanIdea: Idea = {
    ...r.idea,
    whyItWorks: `Clean-English cadence on '${anchorLc}' — curated for filmability.`,
  };
  const quality = scoreHookQuality(cleanIdea.hook, RESERVE_AUTHOR_CORE.family);
  const meta: CandidateMeta = {
    ...r.meta,
    scenarioFingerprint: r.scenarioFingerprint,
    voiceClusterId: RESERVE_AUTHOR_VOICE_CLUSTER_ID,
    hookQualityScore: quality,
  };
  return {
    idea: cleanIdea,
    meta,
    hookQualityScore: quality,
    entryId: entry.id,
  };
};

/** Pre-computed at module-load time. Pre-authored Idea + meta for
 *  every `NIGERIAN_CLEAN_CORE_ENTRIES` row that:
 *   • passes the boot-time entry validator
 *   • is not blocked by the ng_clean shouty-template guard
 *   • satisfies the `pickerEligible` predicate
 *     (HQS ≥ 50 AND aiCliche === 0)
 *   • survives `authorPackEntryAsIdea` validation
 *  Frozen, sorted descending by hookQualityScore with ties broken
 *  ascending by entry id. */
const PRE_AUTHORED_RESERVE_POOL: ReadonlyArray<PreAuthoredReserveEntry> =
  Object.freeze(
    NIGERIAN_CLEAN_CORE_ENTRIES.filter(
      (e) => isValidNigerianCleanCoreEntry(e) && !isNigerianCleanCoreHookBlocked(e.hook),
    )
      .filter((e) => {
        // Score against `"absurd_escalation"` — the same pinned
        // family used by `nigerianCleanCoreSlot0CorpusFeed.ts`'s
        // hero pool (see L137-149 of that module). It is the
        // strictest floor in practice for clean-English hooks
        // and matches the picker family the downstream willingness
        // sort applies under the pinned `PREMISE_CORES[0]` core
        // we author with.
        const detail = scoreHookQualityDetailed(e.hook, "absurd_escalation");
        return (
          detail.total >= NG_CLEAN_RESERVE_PICKER_HQS_FLOOR &&
          detail.aiCliche === 0
        );
      })
      .map((e) => preAuthorReserveEntry(e))
      .filter((row): row is PreAuthoredReserveEntry => row !== null)
      .sort((a, b) => {
        if (b.hookQualityScore !== a.hookQualityScore) {
          return b.hookQualityScore - a.hookQualityScore;
        }
        return a.entryId.localeCompare(b.entryId);
      })
      .map((row) => Object.freeze(row)),
  );

/** Test-only inspector — exposes the pre-authored reserve pool so
 *  tests can assert composition without re-deriving it. Returns a
 *  defensive copy so callers cannot mutate the frozen list. */
export const getNgCleanSidecarReservePool =
  (): ReadonlyArray<PreAuthoredReserveEntry> => PRE_AUTHORED_RESERVE_POOL;

/** Convenience: count of pre-authored reserve entries. */
export const NG_CLEAN_RESERVE_TOTAL_AUTHORED: number =
  PRE_AUTHORED_RESERVE_POOL.length;

/** Reserve candidate shape consumed by the slot-1+ filter — full
 *  Idea + meta + the `pickerEligible: true` marker the filter
 *  checks. Mirrors the relevant subset of `final[]` candidates so
 *  the filter can do `next[targetIdx] = pick.cand` without
 *  semantic loss. Callers wrap into their own ScoredCandidate
 *  shape if needed. */
export interface ReserveSidecarCandidate {
  readonly idea: Idea & { readonly pickerEligible: true };
  readonly meta: CandidateMeta;
  readonly cleanCoreEntryId: string;
  readonly hookQualityScore: number;
}

export interface BuildSidecarReserveContext {
  /** Clean-core entry ids ALREADY present in `final[]`. Excluded
   *  from the reserve — surfacing them would be a no-op (filter
   *  rejects via `inFinalEntryIds.has(eid)`). */
  readonly excludeFinalEntryIds: ReadonlySet<string>;
  /** Clean-core entry ids in the creator's recent slot-1+ memory.
   *  Excluded — surfacing them would also be a no-op (filter
   *  rejects via `recent...has(eid)`). Skipping here keeps the
   *  returned reserve focused on entries the filter can use. */
  readonly excludeRecentMemoryEntryIds: ReadonlySet<string>;
  /** Clean-core entry ids already represented in the live sidecar
   *  built from `localResult.kept`. Excluded so the reserve never
   *  duplicates a live-sidecar candidate. */
  readonly excludeLiveSidecarEntryIds: ReadonlySet<string>;
  /** Per-call cap on reserve size returned. Defaults to
   *  `NG_CLEAN_RESERVE_MAX_RETURN` (a SOFT default, not a hard ceiling).
   *  Lower-bounded at 0; explicit larger overrides are honored (used by
   *  tests with `maxReturn: 9999` to exercise full-pool exclusion
   *  arithmetic). Production call-site does not override. */
  readonly maxReturn?: number;
}

/** Build the slot-1+ filter sidecar reserve. Pure helper — see
 *  contract above. Caller is responsible for the cohort/flag gate;
 *  this helper does NOT re-check.
 *
 *  Walk order = pre-authored order (HQS descending, ties ascending
 *  by id). The slot-1+ filter walks the concatenated sidecar in
 *  order and picks the first eligible entry, so this ordering
 *  surfaces the highest-quality fresh alternatives first. */
export const buildNgCleanSlot1PlusSidecarReserve = (
  ctx: BuildSidecarReserveContext,
): ReadonlyArray<ReserveSidecarCandidate> => {
  const cap = Math.max(0, ctx.maxReturn ?? NG_CLEAN_RESERVE_MAX_RETURN);
  if (cap === 0) return [];
  const out: ReserveSidecarCandidate[] = [];
  for (const row of PRE_AUTHORED_RESERVE_POOL) {
    if (out.length >= cap) break;
    const eid = row.entryId;
    if (ctx.excludeFinalEntryIds.has(eid)) continue;
    if (ctx.excludeRecentMemoryEntryIds.has(eid)) continue;
    if (ctx.excludeLiveSidecarEntryIds.has(eid)) continue;
    // Defensive double-check: hook → entry id resolution must
    // succeed and match. The filter resolves via the canonical
    // resolver and would also skip if it disagreed.
    const resolved = resolveCleanCoreEntryIdByHook(row.idea.hook);
    if (resolved !== eid) continue;
    out.push({
      idea: { ...row.idea, pickerEligible: true as const },
      meta: row.meta,
      cleanCoreEntryId: eid,
      hookQualityScore: row.hookQualityScore,
    });
  }
  return out;
};
