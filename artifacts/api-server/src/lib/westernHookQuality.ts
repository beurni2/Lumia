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
