/**
 * PHASE N1-LIVE-HARDEN F2 — Nigerian region-anchor brand validator.
 *
 * Rejects obviously Western-only brand / region anchors when they
 * appear in outputs that will ship to a Nigeria + light_pidgin /
 * pidgin (pack-eligible) creator. Wired ONLY at the post-merge
 * filter stage in `hybridIdeator.ts`, gated on
 * `canActivateNigerianPack(...)`. Non-NG / NG-clean / NG-null /
 * flag-OFF cohorts are byte-identical to baseline because the
 * gate short-circuits the call.
 *
 * Hard rules honoured:
 *   • Does not loosen any existing validator. Pure additive reject
 *     branch — a candidate that fails this check is dropped from
 *     `merged` exactly like a `validateScenarioCoherence` failure
 *     would drop it.
 *   • Does not touch anti-copy, comedy, safety, or scoring.
 *   • Does not add corpus.
 *   • Term list is the SAME literal seed set used by the QA
 *     detector (`qa/n1LiveHardenQa.ts`'s `WESTERN_BRAND_TERMS`),
 *     so a hook that the QA detector flags as a leak is also
 *     rejected here. Adding a term here ⇒ also extend the QA
 *     detector to keep symmetry.
 *
 * Surfaces scanned: hook + whatToShow + howToFilm + caption +
 * script + trigger + reaction + shotPlan + filmingGuide. Same
 * "all-rendered surface" join the QA harness uses for its
 * `westernLeakAllHits` count, so production rejection mirrors
 * QA detection.
 */

import type { Idea } from "./ideaGen.js";
import type { Region } from "@workspace/lumina-trends";
import type { LanguageStyle } from "./tasteCalibration.js";
import { canActivateNigerianPack } from "./nigerianHookPack.js";

export type NigerianRegionAnchorReason = "western_anchor_in_ng_pidgin";

// Word-boundary matched. Same seed list as the QA detector. KEEP
// IN SYNC with `qa/n1LiveHardenQa.ts` `WESTERN_BRAND_TERMS`.
export const WESTERN_ONLY_BRAND_TERMS: readonly RegExp[] = [
  /\bdoordash\b/i,
  /\bvenmo\b/i,
  /\bcashapp\b/i,
  /\bcash\s+app\b/i,
  /\bzelle\b/i,
  /\btarget\b/i,
  /\bwalmart\b/i,
  /\btrader\s+joe(?:'s|s)?\b/i,
  /\bstarbucks\b/i,
  /\bdunkin\b/i,
  /\bwhole\s+foods\b/i,
  /\bcostco\b/i,
  /\bcvs\b/i,
  /\bwalgreens\b/i,
  /\bihop\b/i,
  /\bchipotle\b/i,
  /\bubereats\b/i,
  /\buber\s+eats\b/i,
  /\bgrubhub\b/i,
  /\bamazon\s+prime\b/i,
  /\bnetflix\b/i,
  /\bhulu\b/i,
];

export type NigerianRegionAnchorGuardInput = {
  readonly region: Region | undefined;
  readonly languageStyle: LanguageStyle | null | undefined;
  readonly flagEnabled: boolean;
  readonly packLength: number;
};

/**
 * Returns `true` when the validator should run for this request
 * cohort. Mirrors the activation gate used by every other N1
 * surface (`canActivateNigerianPack`) so cohort gating is
 * symmetric across the pack ecosystem — never split.
 */
export function shouldApplyNigerianRegionAnchorValidator(
  input: NigerianRegionAnchorGuardInput,
): boolean {
  return canActivateNigerianPack({
    region: input.region,
    languageStyle: input.languageStyle,
    flagEnabled: input.flagEnabled,
    packLength: input.packLength,
  });
}

/**
 * Pure validator. Returns `null` when the idea is acceptable for
 * the NG-pidgin cohort, or a reason string when one of the
 * Western-only brand terms appears in any rendered surface.
 *
 * NOT cohort-gated by itself — the caller MUST consult
 * `shouldApplyNigerianRegionAnchorValidator` first. This keeps
 * the function trivially testable and side-effect free.
 */
export function validateNigerianRegionAnchor(
  idea: Idea,
): NigerianRegionAnchorReason | null {
  const surfaces = [
    idea.hook,
    idea.whatToShow,
    idea.howToFilm,
    idea.caption,
    idea.trigger ?? "",
    idea.reaction ?? "",
    idea.script ?? "",
    Array.isArray(idea.shotPlan) ? idea.shotPlan.join(" \n ") : "",
    Array.isArray(idea.filmingGuide) ? idea.filmingGuide.join(" \n ") : "",
  ].join(" \n ");
  for (const re of WESTERN_ONLY_BRAND_TERMS) {
    if (re.test(surfaces)) return "western_anchor_in_ng_pidgin";
  }
  return null;
}
