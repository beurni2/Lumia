/**
 * PHASE R3 — REGION-TAGGED ANCHOR CATALOG (additive overlay)
 *
 * Small, curated, hand-vetted list of region-specific concrete-noun
 * anchors (e.g. `jollof`, `chai`, `jeepney`) that the recipe-queue
 * builder optionally PREPENDS to the catalog queue with a low,
 * deterministic ~25% probability per (salt, coreId). When fired,
 * the region recipes are tried FIRST for that core; otherwise the
 * pre-R3 catalog queue is used unchanged.
 *
 * SAFETY CONTRACT
 * ───────────────
 *  - Western entry is `[]` (empty). The freshness/queue logic short-
 *    circuits to the pre-R3 catalog queue when the region rows array
 *    is empty, so western and undefined-region creators are
 *    BYTE-IDENTICAL to pre-R3.
 *  - Each anchor is a SINGLE concrete noun the comedy-validation
 *    tokenizer keeps as one stable token (same constraint as
 *    `coreDomainAnchorCatalog.ts`).
 *  - Each anchor is hand-vetted to be region-distinctive, anti-
 *    stereotype-safe, and camera-friendly (a micro-creator can
 *    produce a believable beat using it without props or crew).
 *  - Recipe shape (`{ domain, anchors, exampleAction }`) matches
 *    `CoreDomainAnchorRow` exactly so the queue-builder treats
 *    region rows and catalog rows uniformly — no validator is
 *    bypassed, no template path forks, no schema field changes.
 *  - The cohesive-author preconditions (`hookContainsAnchor`,
 *    `showContainsAnchor`) operate on the anchor STRING only and
 *    are agnostic to source. Region anchors are subject to the
 *    EXACT same gates as catalog anchors.
 *  - All Claude/local validators (`ideaSchema`, `validateComedy`,
 *    `validateAntiCopy`, `validateScenarioCoherence`) run on the
 *    output unchanged. R3 cannot loosen acceptance.
 *
 * ROLLBACK
 * ────────
 * Replace any region's array with `[]` and that region reverts to
 * the pre-R3 catalog-only queue.
 */

import type { Region } from "@workspace/lumina-trends";
import type { CoreDomainAnchorRow } from "./coreDomainAnchorCatalog";

export const REGION_ANCHORS: Record<Region, readonly CoreDomainAnchorRow[]> = {
  western: [],

  nigeria: [
    // Food — `jollof` is the canonical Nigerian-party staple, single
    // token, no false-positive risk against catalog vocabulary.
    { domain: "food", anchors: ["jollof"], exampleAction: "eating" },
    // Mornings/commute — `danfo` is the Lagos public-bus single-
    // token noun. Filmable from inside or near one without props.
    { domain: "mornings", anchors: ["danfo"], exampleAction: "boarding" },
    // Home — `generator` (the household NEPA backup) is universally
    // recognised; AVOID the stale "light just took" stereotype in
    // hook copy — that's enforced by the R2 prompt block when the
    // fallback path renders region anchors.
    { domain: "home", anchors: ["generator"], exampleAction: "starting" },
    // Phone — `whatsapp` is the dominant chat surface; pairs with
    // the R2 SAFETY note (use fake / cropped screens).
    { domain: "phone", anchors: ["whatsapp"], exampleAction: "checking" },
    // Social — `wedding` (cousin's wedding / aso-ebi) is the
    // canonical social-pressure beat; single token, evergreen.
    { domain: "social", anchors: ["wedding"], exampleAction: "attending" },
    // Money — `payday` is the canonical money beat; deliberately
    // generic-feeling so it lands as relatable, not stereotype.
    { domain: "money", anchors: ["payday"], exampleAction: "spending" },
  ],

  india: [
    // Food — `chai` is the canonical break/morning beat. Single
    // token, immediately recognisable, filmable solo.
    { domain: "food", anchors: ["chai"], exampleAction: "sipping" },
    // Food — `thali` for the meal-platter beat (lunch / dinner
    // after a long day).
    { domain: "food", anchors: ["thali"], exampleAction: "eating" },
    // Phone — `swiggy` (food-delivery cart guilt). Pairs with R2
    // SAFETY note — fake order screens only.
    { domain: "phone", anchors: ["swiggy"], exampleAction: "ordering" },
    // Mornings/commute — `rickshaw` (auto). Single token, filmable
    // from inside or near one.
    { domain: "mornings", anchors: ["rickshaw"], exampleAction: "haggling" },
    // Home — `hostel` (PG / college) is the canonical roommate-
    // chaos beat for younger creators.
    { domain: "home", anchors: ["hostel"], exampleAction: "lounging" },
    // Study — `tuition` (extra classes / coaching) is the
    // canonical study-pressure beat.
    { domain: "study", anchors: ["tuition"], exampleAction: "skipping" },
  ],

  philippines: [
    // Mornings/commute — `jeepney` is the canonical PH transit beat.
    { domain: "mornings", anchors: ["jeepney"], exampleAction: "boarding" },
    // Money — `gcash` is the dominant mobile-wallet surface; pairs
    // with R2 SAFETY note (no real balances / contact lists).
    { domain: "money", anchors: ["gcash"], exampleAction: "checking" },
    // Social — `barkada` (close friend group); the canonical group-
    // chat / weekend-plans beat.
    { domain: "social", anchors: ["barkada"], exampleAction: "messaging" },
    // Phone — `foodpanda` (food delivery). Same SAFETY note as
    // chats / payments.
    { domain: "phone", anchors: ["foodpanda"], exampleAction: "ordering" },
    // Food — `adobo` (the canonical home-cooked dish).
    { domain: "food", anchors: ["adobo"], exampleAction: "eating" },
    // Home — `aircon` (heat-relief beat); single token.
    { domain: "home", anchors: ["aircon"], exampleAction: "blasting" },
  ],
};

/** Returns true when the region has at least one curated anchor row.
 *  Western and any future regions with empty arrays return false so
 *  the queue-builder can short-circuit to the pre-R3 path. */
export function hasRegionAnchors(region: Region | undefined): boolean {
  if (!region) return false;
  return REGION_ANCHORS[region].length > 0;
}
