/**
 * PHASE W1 — WESTERN CATALOG HOOK QUALITY + REPETITION CONTROL
 *
 * Cohort-gated, demotion-only score adjustment for catalog (non-pack)
 * hooks targeted at western/default creators. Mirrors the wiring
 * pattern of `nigerianStylePenalty.ts`: a tiny standalone helper +
 * `canApplyWesternHookAdjustments` cohort gate + a single call site
 * in `coreCandidateGenerator.ts` AFTER `scoreHookQuality(...)` for
 * the catalog (non-pack) recipe path.
 *
 * MOTIVATION
 * ----------
 * Western catalog hooks pass validators but feel template-like and
 * repetitive — "the fridge knows I'm lying", "the sink won. obviously.",
 * "someone explain the keyboard to me. NOW." — same skeleton, swapped
 * anchor. Phase W1 layers an additive scoring nudge that:
 *   • DEMOTES weak Western skeleton families so they no longer
 *     dominate the per-core picker.
 *   • BONUSES hooks that show concrete visible action, contradiction
 *     / self-betrayal, or posting/notification anxiety beats.
 *   • DEMOTES hooks whose normalized skeleton matches a recently
 *     shipped catalog skeleton from the per-creator memory (anchor
 *     swaps fridge↔sink↔microwave already collapse to the same
 *     skeleton via `normalizeHookToSkeleton`'s `__` mask).
 *   • EXTRA DEMOTION when both the hook IS a weak skeleton AND the
 *     `whatToShow` describes a generic "object set down / stared at /
 *     ignored / object wins" scenario.
 *
 * HARD-RULE COMPLIANCE
 * --------------------
 *   • Cohort-gated. Returns 0 unless cohort is western/default
 *     (region === undefined OR region === "western"). India / PH /
 *     Nigeria see ZERO adjustment — byte-identical to baseline.
 *     Symmetric to `canApplyNigerianStylePenalty`'s 4-AND gate.
 *   • Demotion-only NET on weak hooks; positive bonus possible only
 *     for hooks with no weak-skeleton match. Never a hard filter —
 *     even a maximally-demoted hook can still ship if it's the only
 *     candidate. Goal is to LOSE the per-core quality competition,
 *     not to be excluded.
 *   • No validator touched. No `scoreHookQuality` source modified.
 *     Adjustment applied at the call site by addition.
 *   • Pack candidates MUST NOT be adjusted. Wiring in
 *     `coreCandidateGenerator.ts` calls this only on the catalog
 *     path (the same site as the N1 style penalty), never on the
 *     pack-prefix path.
 *   • Reuses the existing `normalizeHookToSkeleton` from
 *     `catalogTemplateCreatorMemory.ts` so the recent-skeleton
 *     repetition signal compares against the same fingerprint that
 *     already lives in the per-creator memory column. No parallel
 *     normalizer = no drift.
 */

import type { Region } from "@workspace/lumina-trends";
import type { LanguageStyle } from "./tasteCalibration.js";
import { normalizeHookToSkeleton } from "./catalogTemplateCreatorMemory.js";

// ---------------------------------------------------------------- //
// Weak Western skeleton family patterns                             //
// ---------------------------------------------------------------- //
//
// Each entry matches the RAW hook string (signal-preserving).
// Family identity is the entry's `id`; same id across anchor swaps
// (fridge↔sink↔microwave) so `classifyWesternWeakSkeletonFamily`
// returns ONE id regardless of which noun the catalog rendered.
//
// Patterns drawn from the spec's confirmed weak skeleton list.

interface WesternWeakSkeleton {
  readonly id: string;
  readonly hookPattern: RegExp;
}

export const WESTERN_WEAK_SKELETONS: ReadonlyArray<WesternWeakSkeleton> = [
  // "the fridge won", "the sink won. obviously.", "my list won again"
  {
    id: "anchor_won",
    hookPattern: /\b(?:the|my)\s+\w+(?:[-\s]\w+)?\s+won\b/i,
  },
  // "the fridge knows I'm lying", "the kitchen knows i am lying"
  {
    id: "anchor_knows_lying",
    hookPattern:
      /\b(?:the|my)\s+\w+(?:[-\s]\w+)?\s+knows\s+(?:i'?m|i\s*am)\s+lying\b/i,
  },
  // "someone explain the keyboard to me", "someone please explain the fridge"
  {
    id: "someone_explain_anchor",
    hookPattern: /\bsomeone\s+(?:please\s+)?explain\s+(?:the|my)\s+\w+/i,
  },
  // "i am totally fine about the fridge", "totally fine about my list"
  {
    id: "totally_fine_about_anchor",
    hookPattern: /\b(?:totally|completely)\s+fine\s+(?:about|with)\b/i,
  },
  // "the fridge itself became", "the list itself became my villain"
  {
    id: "anchor_itself_became",
    hookPattern: /\b(?:the|my)\s+\w+(?:[-\s]\w+)?\s+itself\s+became\b/i,
  },
  // "the fridge flatlined my whole week"
  {
    id: "anchor_flatlined",
    hookPattern: /\bflatlined\s+my\s+(?:whole|entire)\s+\w+/i,
  },
  // "the fridge demolished my entire vibe"
  {
    id: "anchor_demolished_vibe",
    hookPattern: /\bdemolished\s+my\s+(?:entire|whole)\s+vibe\b/i,
  },
  // "the fridge keeps revealing itself"
  {
    id: "anchor_keeps_revealing_itself",
    hookPattern: /\bkeeps?\s+revealing\s+itself\b/i,
  },
  // "my body quit. my brain kept screaming"
  {
    id: "body_quit_brain_screaming",
    hookPattern: /\bmy\s+body\s+quit\b.*\bmy\s+brain\b/i,
  },
];

/**
 * Classify a hook string into a weak-Western skeleton family id, or
 * null if no family matches. First-match wins (the family table is
 * intentionally narrow so collisions are rare; ties on a hook that
 * matches multiple patterns just resolve to the first declared id —
 * deterministic + stable for tests).
 */
export function classifyWesternWeakSkeletonFamily(
  hook: string,
): string | null {
  if (!hook) return null;
  for (const fam of WESTERN_WEAK_SKELETONS) {
    if (fam.hookPattern.test(hook)) return fam.id;
  }
  return null;
}

// ---------------------------------------------------------------- //
// Specificity bonus signals                                         //
// ---------------------------------------------------------------- //
//
// Concrete visible verbs (open / refresh / hover / rehearse / ...)
// — the hook describes an actually-filmable action, not an abstract
// reframing. Posting/notification anxiety + private embarrassment
// add a second axis (the user's day-to-day creator emotional beat).
// Contradiction / self-betrayal phrasing ("said I was X and …",
// "made a list and …") adds a third.
//
// Each axis is worth a small bonus; capped at WESTERN_BONUS_CAP so
// the layer stays a tie-break-grade re-order, not a force-multiplier
// that overrides anti-copy or comedy validation.

const VISIBLE_ACTION_VERBS: RegExp =
  /\b(?:opened?|opens|opening|checked?|checking|checks|refreshed?|refreshes|refreshing|hovered?|hovering|hovers|rehearsed?|rehearses|rehearsing|practiced?|practicing|practices|pretended?|pretending|pretends|drafted?|drafting|drafts|typed?|typing|types|deleted?|deleting|deletes|scrolled?|scrolling|scrolls|tapped?|tapping|taps|hit\s+post|hit\s+send|previewed?|previewing|previews)\b/i;

const POSTING_ANXIETY: RegExp =
  /\b(?:notification|notifications|dm|dms|draft|drafts|post|posted|posting|reply|replies|read\s+receipt|seen\s+at|left\s+on\s+read|unsent|story\s+view|viewer|engagement)\b/i;

const PRIVATE_EMBARRASSMENT: RegExp =
  /\b(?:in\s+front\s+of|audience|crowd|whole\s+room|everyone\s+(?:saw|watching|heard|watched)|caught\s+myself|alone\s+in\s+the|nobody\s+(?:asked|saw)|witness)\b/i;

const SELF_BETRAYAL_CONTRADICTION: RegExp =
  /\b(?:said\s+i\s+(?:was|would|wouldn'?t|won'?t|am)\b.+\b(?:and|but|then)\b)|(?:made\s+a\s+(?:list|plan|promise)\s+and\b)|(?:promised\s+myself\b.+\b(?:and|but|then)\b)/i;

const SPECIFICITY_PER_SIGNAL = 5;
export const WESTERN_BONUS_CAP = 10;

function computeSpecificityBonus(hook: string): number {
  if (!hook) return 0;
  let signals = 0;
  if (VISIBLE_ACTION_VERBS.test(hook)) signals += 1;
  if (POSTING_ANXIETY.test(hook)) signals += 1;
  if (PRIVATE_EMBARRASSMENT.test(hook)) signals += 1;
  if (SELF_BETRAYAL_CONTRADICTION.test(hook)) signals += 1;
  if (signals === 0) return 0;
  return Math.min(signals * SPECIFICITY_PER_SIGNAL, WESTERN_BONUS_CAP);
}

// ---------------------------------------------------------------- //
// Generic-scenario detection                                        //
// ---------------------------------------------------------------- //
//
// Probes the candidate's `whatToShow` text for "object set down /
// stared at / ignored / walks out of frame / object wins" patterns.
// Conservative: each phrase has a clear filmable-but-empty quality
// (the camera is told to film an inert beat). When BOTH the hook
// matches a weak skeleton AND the scenario is generic, the combined
// candidate gets an extra demotion on top of the per-axis hits.

const GENERIC_SCENARIO_PATTERNS: ReadonlyArray<RegExp> = [
  /\bset\s+(?:it|the\s+\w+)\s+down\b/i,
  /\bstares?\s+at\s+(?:it|the\s+\w+)\b/i,
  /\bjust\s+(?:stares?|stands?|sits?)\b/i,
  /\bignores?\s+(?:it|the\s+\w+)\b/i,
  /\bwalks?\s+out\s+of\s+(?:the\s+)?frame\b/i,
  /\b(?:the|my)\s+\w+\s+wins?\b/i,
  /\bnothing\s+happens\b/i,
];

export function isGenericWhatToShow(whatToShow: string): boolean {
  if (!whatToShow) return false;
  for (const re of GENERIC_SCENARIO_PATTERNS) {
    if (re.test(whatToShow)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- //
// Adjustment magnitudes                                             //
// ---------------------------------------------------------------- //
//
// Tuned to be in the same ballpark as the N1 style penalty
// (PER_MATCH=20, CAP=60) so the layer is meaningful but not
// catastrophic. A 0-100 hook score that picks up the maximum
// negative adjustment (-15 weak skeleton + -10 recent-skeleton
// + -10 generic combo = -35) still leaves a hook with strong
// other axes shippable as the sole survivor in its core; the goal
// is to LOSE per-core competitions to authentic catalog or pack
// alternatives, not to be excluded.

export const WEAK_SKELETON_DEMOTION = 15;
export const RECENT_SKELETON_DEMOTION = 10;
export const GENERIC_COMBO_DEMOTION = 10;

// ---------------------------------------------------------------- //
// Cohort gate                                                       //
// ---------------------------------------------------------------- //

export interface WesternHookAdjustmentInput {
  hook: string;
  whatToShow: string;
  region: Region | undefined;
  languageStyle: LanguageStyle | null;
  /** Per-creator catalog skeleton memory (read via
   *  `getRecentSeenSkeletons` upstream and threaded through). Empty
   *  Set for cold-start creators / non-western cohorts (the helper
   *  also short-circuits via the cohort gate). */
  recentSkeletons: ReadonlySet<string>;
}

/**
 * Activation gate. Mirrors the symmetry of
 * `canApplyNigerianStylePenalty` but inverted: returns true ONLY for
 * the western/default cohort (region undefined OR "western"). India,
 * Philippines, and Nigeria short-circuit to 0 adjustment.
 *
 * The `languageStyle` argument is accepted but unused by the western
 * gate today — the cohort decision is region-only. Kept on the
 * signature for symmetry with the N1 helper and to leave room for
 * a future western-language carve-out without changing call sites.
 */
export function canApplyWesternHookAdjustments(
  input: Pick<WesternHookAdjustmentInput, "region" | "languageStyle">,
): boolean {
  if (input.region === undefined) return true;
  if (input.region === "western") return true;
  return false;
}

/**
 * Returns a SIGNED adjustment to ADD to the catalog hook's
 * `scoreHookQuality` result (negative = demotion, positive = bonus).
 * Returns 0 for any cohort that doesn't pass the activation gate, so
 * the wiring in `coreCandidateGenerator.ts` is
 * `quality + computeWesternHookAdjustment(...)` with no branching at
 * the call site.
 *
 * Composition:
 *   weakSkeleton match              → -WEAK_SKELETON_DEMOTION
 *   currentSkeleton ∈ recentSkeletons → -RECENT_SKELETON_DEMOTION
 *   weakSkeleton + genericScenario   → -GENERIC_COMBO_DEMOTION (extra)
 *   specificity bonus (no weak match) → +bonus, capped at WESTERN_BONUS_CAP
 *
 * The specificity bonus only fires when no weak-skeleton family
 * matched. A hook that hits a weak family AND has visible-action
 * verbs is still demoted on net — the weak-skeleton signal dominates
 * (the spec's "stop weak skeletons from dominating output" mandate).
 */
export function computeWesternHookAdjustment(
  input: WesternHookAdjustmentInput,
): number {
  // QA-only diagnostic bypass: lets the W1 live-QA harness collect a
  // matched "before" baseline against the same running server without
  // a separate build. Hard-gated to non-production: even if the env
  // var leaked into a deployed environment it would be a no-op when
  // NODE_ENV === "production". Reads each call (cheap; the adjustment
  // helper is invoked per-candidate inside an already O(N) scoring
  // loop). Strictly off by default.
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.LUMINA_W1_DISABLE_FOR_QA === "1"
  ) {
    return 0;
  }
  if (!canApplyWesternHookAdjustments(input)) return 0;
  let adj = 0;
  const weakFamily = classifyWesternWeakSkeletonFamily(input.hook);
  if (weakFamily !== null) {
    adj -= WEAK_SKELETON_DEMOTION;
    if (isGenericWhatToShow(input.whatToShow)) {
      adj -= GENERIC_COMBO_DEMOTION;
    }
  } else {
    const bonus = computeSpecificityBonus(input.hook);
    adj += bonus;
  }
  const skeleton = normalizeHookToSkeleton(input.hook);
  if (skeleton.length > 0 && input.recentSkeletons.has(skeleton)) {
    adj -= RECENT_SKELETON_DEMOTION;
  }
  return adj;
}

// ---------------------------------------------------------------- //
// PHASE W1.2 — Per-batch weak-family diversity cap                  //
// ---------------------------------------------------------------- //
//
// Caller-side (selection-time) lever that prevents the same weak
// Western skeleton family from occupying more than one slot in the
// shipped batch unless the pool would under-fill. Implemented as a
// LARGE soft penalty (-100) added by `selectionPenalty` when this
// candidate's hook matches a weak family already present in
// `batchSoFar`.
//
// Why -100 (not -1000 hard reject): the spec mandates "Allow at most
// 1 candidate per weak skeleton family per generated batch UNLESS the
// pool would under-fill". `selectWithNovelty` is a greedy picker that
// always selects the highest (score - penalty) survivor, so a -100
// penalty puts a 2nd weak-family candidate well below ANY normal
// candidate (whose typical penalty band is single-digit), but if the
// only remaining survivors are all -100 (the pool genuinely has no
// alternatives), the selector still ships the best weak candidate
// rather than under-filling.
//
// Cohort-gated by the caller — `selectionPenalty` only invokes this
// when `ctx.westernWeakFamilyCapEnabled` is true (set by
// `hybridIdeator` only on the western/default cohort + W1.2 enabled).
// Nigerian / India / Philippines cohorts pay zero overhead.

export const WESTERN_WEAK_FAMILY_BATCH_PENALTY = 100;

export function computeWesternWeakFamilyBatchPenalty(
  candidateHook: string,
  batchSoFarHooks: ReadonlyArray<string>,
): number {
  if (batchSoFarHooks.length === 0) return 0;
  const candFamily = classifyWesternWeakSkeletonFamily(candidateHook);
  if (candFamily === null) return 0;
  for (const h of batchSoFarHooks) {
    if (classifyWesternWeakSkeletonFamily(h) === candFamily) {
      return WESTERN_WEAK_FAMILY_BATCH_PENALTY;
    }
  }
  return 0;
}

/**
 * Activation gate for the W1.2 per-batch weak-family cap. Mirrors
 * `canApplyWesternHookAdjustments` (region-only) AND adds an env
 * kill-switch (`LUMINA_W1_2_DISABLE_FOR_QA=1`, non-prod only) so the
 * QA harness can collect a matched OFF baseline against the same
 * running server.
 */
export function canApplyWesternWeakFamilyCap(
  input: Pick<WesternHookAdjustmentInput, "region" | "languageStyle">,
): boolean {
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.LUMINA_W1_2_DISABLE_FOR_QA === "1"
  ) {
    return false;
  }
  return canApplyWesternHookAdjustments(input);
}

// ---------------------------------------------------------------- //
// PHASE W1.3 — Upstream weak-skeleton generation quota              //
// ---------------------------------------------------------------- //
//
// W1.2 fixed the in-batch cap (max 1 per family per shipped batch),
// but the W1.2 QA sweep showed the merged candidate pool is still
// flooded by a small set of pattern-engine templates:
//   - `totally_fine_about`              — 100 occurrences in 20-batch ON run
//   - `is_it_really_still_about`        —  41 occurrences
//   - `noun_won_today`                  —  10 occurrences
// These are the patternIdeator `skeletonId` values for the templates
// that produce the user's weak-family hooks at the source.
//
// W1.3 caps how many candidates with a known weak skeleton enter the
// merged pool BEFORE selection, on the western/default cohort only.
// Detection combines:
//   (1) `meta.hookSkeletonId` membership in `WESTERN_WEAK_SKELETON_IDS`
//       (catches the dominant patternIdeator-emitted templates), and
//   (2) regex match against `WESTERN_WEAK_SKELETONS` (catches Claude /
//       llama mutation hooks that reproduce the weak shape without a
//       skeletonId tag — emergent volume is low but non-zero).
//
// Quota:
//   - max 1 candidate per weak family entering merged pool
//   - max 3 total weak candidates entering merged pool
//   - if final `kept.length` < `safetyFloor` (= max(desiredCount, 4)),
//     promote dropped weak candidates back into kept until floor met
//     (under-fill carve-out — caller logs `relaxed=true`)
//
// Cohort-gated: same gate as W1.2 + a separate non-prod kill-switch
// `LUMINA_W1_3_DISABLE_FOR_QA=1` so the QA harness can collect a
// matched OFF baseline against the same running server. Nigerian /
// India / Philippines cohorts pay zero overhead — the helper short-
// circuits if the caller's gate returns false.

// Map from patternIdeator `skeletonId` (template-tag namespace) to the
// canonical W1.2 regex family id. Detection paths (skeletonId vs regex)
// MUST collapse to a single family key, otherwise `maxPerFamily=1`
// silently allows two effectively-same-family survivors when one
// candidate carries `meta.hookSkeletonId` and another (Claude/llama
// mutation reproducing the same shape) does not.
//
// `is_it_really_still_about` has no W1.2 regex family — it stays as
// its own canonical key (the regex table doesn't try to match the
// "is it really still about X" question shape and we deliberately do
// not widen W1.2 here per spec rule "no validator/regex changes").
export const WESTERN_WEAK_SKELETON_ID_TO_FAMILY: ReadonlyMap<string, string> =
  new Map([
    ["totally_fine_about", "totally_fine_about_anchor"],
    ["noun_won_today", "anchor_won"],
    ["is_it_really_still_about", "is_it_really_still_about"],
  ]);

export const WESTERN_WEAK_SKELETON_IDS: ReadonlySet<string> = new Set(
  WESTERN_WEAK_SKELETON_ID_TO_FAMILY.keys(),
);

export const WESTERN_WEAK_QUOTA_MAX_PER_FAMILY = 1;
export const WESTERN_WEAK_QUOTA_MAX_TOTAL = 3;
export const WESTERN_WEAK_QUOTA_SAFETY_FLOOR_MIN = 4;

/**
 * Family identity for a candidate. Returns the patternIdeator
 * `skeletonId` if it's in the known weak set, else falls back to the
 * regex classifier in `classifyWesternWeakSkeletonFamily`. Returns
 * null if the candidate is not weak.
 *
 * Symmetric with the W1.2 selection-time check — both layers must
 * agree on what "weak" means or the protection layers diverge.
 */
export function classifyWesternWeakCandidate(input: {
  hook: string;
  hookSkeletonId?: string | null | undefined;
}): string | null {
  if (input.hookSkeletonId) {
    const fam = WESTERN_WEAK_SKELETON_ID_TO_FAMILY.get(input.hookSkeletonId);
    if (fam !== undefined) return fam;
  }
  return classifyWesternWeakSkeletonFamily(input.hook);
}

export type WesternWeakQuotaCandidate = {
  idea: { hook: string };
  meta: { hookSkeletonId?: string };
};

export type WesternWeakQuotaResult<T> = {
  kept: T[];
  dropped: T[];
  relaxed: boolean;
  perFamilyKept: Record<string, number>;
  perFamilyDropped: Record<string, number>;
  totalWeakKept: number;
  totalWeakDropped: number;
};

/**
 * Apply the W1.3 weak-skeleton quota to a merged candidate pool.
 *
 * Algorithm (single pass + carve-out):
 *   1. Walk candidates in input order. Non-weak → keep all.
 *   2. Weak (per `classifyWesternWeakCandidate`) → keep only when
 *      both `perFamilyKept[fam] < maxPerFamily` and
 *      `totalWeakKept < maxTotal`. Otherwise spill into `dropped`.
 *   3. After the walk, if `kept.length < safetyFloor` promote spilled
 *      candidates back into `kept` (in original order) until the
 *      floor is met or the spill is empty. Sets `relaxed = true`.
 *
 * The helper itself is cohort-agnostic — the caller is responsible
 * for gating on `canApplyWesternWeakSkeletonQuota`. Keeps the helper
 * trivially testable without env state.
 */
export function applyWesternWeakSkeletonQuota<T extends WesternWeakQuotaCandidate>(
  candidates: ReadonlyArray<T>,
  opts: {
    desiredCount: number;
    maxPerFamily?: number;
    maxTotal?: number;
    safetyFloorMin?: number;
  },
): WesternWeakQuotaResult<T> {
  const maxPerFamily = opts.maxPerFamily ?? WESTERN_WEAK_QUOTA_MAX_PER_FAMILY;
  const maxTotal = opts.maxTotal ?? WESTERN_WEAK_QUOTA_MAX_TOTAL;
  const safetyFloor = Math.max(
    opts.desiredCount,
    opts.safetyFloorMin ?? WESTERN_WEAK_QUOTA_SAFETY_FLOOR_MIN,
  );
  const kept: T[] = [];
  const droppedWithFamily: Array<{ cand: T; fam: string }> = [];
  const perFamilyKept: Record<string, number> = {};
  const perFamilyDropped: Record<string, number> = {};
  let totalWeakKept = 0;
  for (const c of candidates) {
    const fam = classifyWesternWeakCandidate({
      hook: c.idea.hook,
      hookSkeletonId: c.meta.hookSkeletonId,
    });
    if (fam === null) {
      kept.push(c);
      continue;
    }
    const famKept = perFamilyKept[fam] ?? 0;
    if (famKept < maxPerFamily && totalWeakKept < maxTotal) {
      kept.push(c);
      perFamilyKept[fam] = famKept + 1;
      totalWeakKept++;
    } else {
      droppedWithFamily.push({ cand: c, fam });
      perFamilyDropped[fam] = (perFamilyDropped[fam] ?? 0) + 1;
    }
  }
  let relaxed = false;
  let i = 0;
  while (kept.length < safetyFloor && i < droppedWithFamily.length) {
    const { cand, fam } = droppedWithFamily[i];
    kept.push(cand);
    perFamilyKept[fam] = (perFamilyKept[fam] ?? 0) + 1;
    perFamilyDropped[fam] = (perFamilyDropped[fam] ?? 0) - 1;
    if (perFamilyDropped[fam] <= 0) delete perFamilyDropped[fam];
    totalWeakKept++;
    relaxed = true;
    i++;
  }
  const dropped = droppedWithFamily.slice(i).map((x) => x.cand);
  return {
    kept,
    dropped,
    relaxed,
    perFamilyKept,
    perFamilyDropped,
    totalWeakKept,
    totalWeakDropped: dropped.length,
  };
}

/**
 * Activation gate for the W1.3 upstream weak-skeleton quota. Mirrors
 * `canApplyWesternHookAdjustments` (region-only) plus a non-prod env
 * kill-switch `LUMINA_W1_3_DISABLE_FOR_QA=1` so the QA harness can
 * collect a matched OFF baseline against the same running server.
 *
 * Independent from the W1.2 kill-switch — flipping one does not
 * affect the other, so the QA harness can isolate either layer.
 */
export function canApplyWesternWeakSkeletonQuota(
  input: Pick<WesternHookAdjustmentInput, "region" | "languageStyle">,
): boolean {
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.LUMINA_W1_3_DISABLE_FOR_QA === "1"
  ) {
    return false;
  }
  return canApplyWesternHookAdjustments(input);
}

// ---------------------------------------------------------------- //
// PHASE W1.4 — Western hook specificity upgrade                     //
// ---------------------------------------------------------------- //
//
// W1.3 stopped a small set of skeleton TEMPLATES from flooding the
// merged pool, but the W1.3 ON shipped sample still contains
// generic-template comedy that pre-W1.3 weak-skeleton detection
// doesn't classify, e.g.
//
//   "the bed itself isn't the problem. i am."
//   "i avoided the pan AGAIN. AGAIN!!!"
//   "watched myself fake the gym live"          (drift toward generic)
//   "one inbox aged me 10 years visibly"
//   "the inbox ruined my villain arc"
//
// And it lacks a positive bias toward the spec's preferred direction:
//
//   "opening the fridge like new food spawned"
//   "checking the post like the likes owe me rent"
//   "filming a gym story from the couch like nobody will notice"
//   "saying I'm leaving, then sitting down for 18 more minutes"
//
// W1.4 adds a SECOND, parallel, deterministic scoring layer on top of
// W1's `computeWesternHookAdjustment` — same cohort gate, same call
// site, but with an orthogonal signal set. The two layers compose by
// addition; no validator or anti-copy or safety semantics changes.
//
// Two signal axes:
//
//   (A) GENERIC_TEMPLATE_PATTERNS — narrowly-scoped regexes that
//       match the weak-but-not-W1-classified template shapes shown
//       in the W1.3 ON QA sample. Each pattern hit = -DEMOTION,
//       capped at MAX_DEMOTION so a single hook can't be demoted
//       beyond a sane bound.
//
//   (B) SPECIFIC_BEHAVIOR_SIGNALS — gerund-led action openers,
//       "like X" comparison structure, concrete numeric duration,
//       and self-betrayal "X, then Y" structure. Each = +REWARD,
//       capped at MAX_REWARD.
//
// Like W1, the two axes are MUTUALLY EXCLUSIVE per hook: if any
// generic-template fires, the specificity reward path is skipped
// (a hook that hits a known template AND has concrete-action verbs
// is still demoted on net — the template signal dominates).
//
// Demotion-only NET on template hits, never a hard filter. Even a
// fully-demoted hook ships if it's the sole survivor in its core.

// ----- (A) generic-template patterns -----
//
// Curated ONLY from shapes observed in the W1.3 ON shipped sample.
// Each pattern is intentionally narrow (multi-token shape, not a
// single common word) so legitimate creator phrasing isn't caught.

interface WesternGenericTemplatePattern {
  readonly id: string;
  readonly hookPattern: RegExp;
}

export const WESTERN_GENERIC_TEMPLATE_PATTERNS: ReadonlyArray<WesternGenericTemplatePattern> =
  [
    // "quietly realized the towel itself is the personality"
    // "quiet realization: the inbox itself is anxiety now"
    // Listed FIRST so it wins over `anchor_itself_is_abstract_noun`
    // for hooks that carry both markers (the meta-narration is the
    // stronger template signal). The two patterns can also stack:
    // see the multi-template demotion test where both fire and the
    // demotion accumulates to the cap.
    {
      id: "quiet_realization_template",
      hookPattern:
        /(?:\bquiet\s+realization\b|\bquietly\s+realiz(?:ed|ation)\b)/i,
    },
    // "the bed itself isn't the problem. i am."
    {
      id: "anchor_itself_isnt_the_problem",
      hookPattern: /\b(?:the|my)\s+\w+(?:[-\s]\w+)?\s+itself\s+isn'?t\s+the\s+problem\b/i,
    },
    // "the inbox itself is the entire pattern"
    // "the inbox itself is anxiety now"
    // "the towel itself is the personality"
    {
      id: "anchor_itself_is_abstract_noun",
      hookPattern:
        /\b(?:the|my)\s+\w+(?:[-\s]\w+)?\s+itself\s+is\s+(?:the\s+entire\s+pattern|anxiety|the\s+personality|the\s+plot|the\s+villain)\b/i,
    },
    // "one inbox aged me 10 years visibly"
    {
      id: "aged_me_n_years",
      hookPattern: /\baged\s+me\s+\d+\s+years?\b/i,
    },
    // "i ignored the wallpaper AGAIN. AGAIN!!!"
    // "i avoided the pan AGAIN. AGAIN!!!"
    // Repeated emphatic AGAIN is a clear template marker — case-
    // sensitive on at least one occurrence to avoid catching the
    // ordinary lowercase word.
    {
      id: "repeated_emphatic_again",
      hookPattern: /\bAGAIN[.!]?\s+AGAIN[!.]*/,
    },
    // "the inbox ruined my villain arc"
    // "the junk ruined my villain arc"
    {
      id: "ruined_my_villain_arc",
      hookPattern: /\bruined\s+my\s+villain\s+arc\b/i,
    },
    // "i CANNOT stop avoiding the fork. i CANNOT"
    // "i CANNOT stop claiming the couch. i CANNOT"
    {
      id: "i_cannot_stop_doubled",
      hookPattern: /\bi\s+CANNOT\s+stop\b/,
    },
    // "WHY does the alarm keep snoozing itself"
    // "WHY does the sink keep ignoring itself"
    {
      id: "why_does_anchor_keep_verbing_itself",
      hookPattern:
        /\bWHY\s+does\s+(?:the|my)\s+\w+\s+keep\s+\w+ing\s+itself\b/,
    },
    // "the tasks drained the whole battery"
    {
      id: "drained_the_whole_battery",
      hookPattern: /\bdrained\s+the\s+whole\s+battery\b/i,
    },
    // "the mirror broke me!! and I'M NOT FINE"
    // "this is where the gift broke me"
    // Anchor-broke-me as a rigid template; require the noun-phrase
    // shape to avoid catching legitimate "broke me" usage in long
    // narrative hooks.
    {
      id: "anchor_broke_me",
      hookPattern: /\b(?:the|my)\s+\w+(?:[-\s]\w+)?\s+broke\s+me\b/i,
    },
    // "watched myself fake the gym live"
    // The shape "watched myself <verb> the X live" is a generic
    // self-observation template (the verb slot is filler).
    {
      id: "watched_myself_verb_anchor_live",
      hookPattern:
        /\bwatched\s+myself\s+\w+\s+(?:the|my)\s+\w+\s+live\b/i,
    },
  ];

/**
 * Returns the matched generic-template family id (or null) for a hook.
 * First-match wins; the table is intentionally narrow so collisions are
 * rare. Stable + deterministic for tests.
 */
export function classifyWesternGenericTemplateFamily(
  hook: string,
): string | null {
  if (!hook) return null;
  for (const fam of WESTERN_GENERIC_TEMPLATE_PATTERNS) {
    if (fam.hookPattern.test(hook)) return fam.id;
  }
  return null;
}

// ----- (B) specificity reward signals -----
//
// Gerund-led openers ("opening the fridge like new food spawned…")
// — anchored at hook start so middle-of-sentence verbs from W1's
// existing VISIBLE_ACTION_VERBS don't double-count.

const W14_GERUND_OPENER: RegExp =
  /^\s*(?:opening|checking|filming|hovering|saying|sitting|making|drafting|hitting|previewing|swiping|texting|clicking|tapping|reading|practicing|rehearsing|posting|deleting|scrolling|pretending|holding|carrying|wearing|standing|walking|leaving|ordering|booking|writing|recording|narrating|whispering|mouthing|typing|previewing|reviewing|editing|cropping)\b/i;

// "like new food spawned" / "like that counts" / "like the likes owe me"
// — comparison structure. Distinct from W1's POSTING_ANXIETY.
const W14_LIKE_COMPARISON: RegExp =
  /\blike\s+(?:that\s+counts|nobody|new\s+\w+\s+spawned|the\s+\w+\s+(?:owes?|owe)|i'?m\s+\w+|the\s+\w+\s+can\s+(?:fight|hear|see|reply|punish))\b/i;

// "saying I'm leaving, then sitting down" — "X, then Y" inversion
// where X is a stated intent and Y is the betrayal action. Distinct
// from W1's SELF_BETRAYAL_CONTRADICTION ("said I was X and …").
const W14_THEN_BETRAYAL: RegExp =
  /\b(?:saying|said)\s+(?:i'?m|i\s*am|i'?ll)\s+\w+(?:\s+\w+){0,3},?\s+then\s+\w+ing\b/i;

// "for 18 more minutes" / "for 20 minutes" — concrete numeric
// durations make a hook visibly filmable.
const W14_CONCRETE_DURATION: RegExp =
  /\bfor\s+\d+\s+(?:more\s+)?(?:second|minute|hour|day)s?\b/i;

const W14_REWARD_PER_AXIS = 5;
export const WESTERN_W14_REWARD_CAP = 15;
const W14_DEMOTION_PER_MATCH = 10;
export const WESTERN_W14_DEMOTION_CAP = 20;

/**
 * Compute the W1.4 specificity adjustment (signed). Returns 0 for any
 * cohort that doesn't pass the cohort gate. Composition rule mirrors
 * W1: if any generic-template fires, only the demotion path runs;
 * otherwise the specificity reward path runs. Caps applied per axis.
 */
export function computeWesternSpecificityAdjustment(
  input: Pick<WesternHookAdjustmentInput, "hook" | "region" | "languageStyle">,
): number {
  // QA-only diagnostic kill-switch: lets the W1.4 live-QA harness
  // collect a matched OFF baseline against the same running server.
  // Hard-gated to non-production: even if the env var leaked into a
  // deployed environment it would be a no-op when NODE_ENV ===
  // "production". Strictly off by default.
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.LUMINA_W1_4_DISABLE_FOR_QA === "1"
  ) {
    return 0;
  }
  if (!canApplyWesternHookAdjustments(input)) return 0;
  const hook = input.hook ?? "";
  if (!hook) return 0;
  let demotion = 0;
  for (const fam of WESTERN_GENERIC_TEMPLATE_PATTERNS) {
    if (fam.hookPattern.test(hook)) {
      demotion += W14_DEMOTION_PER_MATCH;
      if (demotion >= WESTERN_W14_DEMOTION_CAP) {
        return -WESTERN_W14_DEMOTION_CAP;
      }
    }
  }
  if (demotion > 0) return -demotion;
  let reward = 0;
  if (W14_GERUND_OPENER.test(hook)) reward += W14_REWARD_PER_AXIS;
  if (W14_LIKE_COMPARISON.test(hook)) reward += W14_REWARD_PER_AXIS;
  if (W14_THEN_BETRAYAL.test(hook)) reward += W14_REWARD_PER_AXIS;
  if (W14_CONCRETE_DURATION.test(hook)) reward += W14_REWARD_PER_AXIS;
  if (reward === 0) return 0;
  return Math.min(reward, WESTERN_W14_REWARD_CAP);
}

/**
 * Activation gate for the W1.4 specificity upgrade. Mirrors
 * `canApplyWesternHookAdjustments` (region-only) plus a non-prod env
 * kill-switch (`LUMINA_W1_4_DISABLE_FOR_QA=1`) so the QA harness can
 * collect a matched OFF baseline against the same running server.
 *
 * Independent from W1, W1.2, and W1.3 kill-switches — flipping one
 * does not affect the others, so the QA harness can isolate any layer.
 */
export function canApplyWesternSpecificityUpgrade(
  input: Pick<WesternHookAdjustmentInput, "region" | "languageStyle">,
): boolean {
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.LUMINA_W1_4_DISABLE_FOR_QA === "1"
  ) {
    return false;
  }
  return canApplyWesternHookAdjustments(input);
}
