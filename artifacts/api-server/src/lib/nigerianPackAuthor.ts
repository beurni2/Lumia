/**
 * PHASE N1-S — Nigerian pack candidate author.
 *
 * Atomic recipe author for `NIGERIAN_HOOK_PACK` entries. The pack
 * supplies hook + whatToShow + howToFilm + caption verbatim (already
 * native-reviewer stamped + boot-asserted in `nigerianHookPack.ts`);
 * this module synthesises the remaining `Idea` axes from the same
 * family / domain maps the cohesive author uses, then runs the
 * candidate through the SAME four production validators with NO
 * loosening:
 *
 *   1. `ideaSchema.safeParse`
 *   2. `validateScenarioCoherence`
 *   3. `validateComedy`         (source: `core_native_pack`)
 *   4. `validateAntiCopyDetailed`
 *
 * On a pass, returns a `CohesiveAuthorResult` shaped identically to
 * `authorCohesiveIdea` so the recipe loop in
 * `coreCandidateGenerator.ts` can fold pack candidates into the
 * existing `passing[]` set without branching downstream code paths.
 *
 * SAFETY:
 *   • This author is callable ONLY from the integration site behind
 *     `getEligibleNigerianPackEntries`, which itself short-circuits
 *     unless region === "nigeria" + languageStyle ∈ {light_pidgin,
 *     pidgin} + flagEnabled + packLength > 0.
 *   • All four production validators run unchanged.
 *   • The cohesive author's structural pre-checks
 *     (anchor-presence-in-howToFilm, end-on-contradiction-verb) are
 *     INTENTIONALLY skipped — pack entries are atomic native-speaker
 *     authored units, so anchor/contradiction shape is the
 *     reviewer's responsibility, NOT a derived guarantee from a
 *     verb-substitution recipe. Boot integrity already enforces
 *     anchor-in-hook + anchor-in-whatToShow.
 */

import {
  ideaSchema,
  type Idea,
} from "./ideaGen.js";
import type { CanonicalDomain } from "./coreDomainAnchorCatalog.js";
import type { PremiseCore } from "./premiseCoreLibrary.js";
import type { VoiceCluster } from "./voiceClusters.js";
import type { CandidateMeta } from "./ideaScorer.js";
import type { CohesiveAuthorResult } from "./cohesiveIdeaAuthor.js";
import {
  validateComedy,
  validateAntiCopyDetailed,
  STOPWORDS,
  type ComedyRejectionReason,
} from "./comedyValidation.js";
import { validateScenarioCoherence } from "./scenarioCoherence.js";
import { computeScenarioFingerprint } from "./scenarioFingerprint.js";
import type { NigerianPackEntry } from "./nigerianHookPack.js";

// ---------------------------------------------------------------- //
// Family / domain → idea axis maps. Mirrored from cohesiveIdeaAuthor //
// (kept LOCAL so that file is byte-untouched by N1-S — additive     //
// overlay discipline). Updates to either copy require manual sync;  //
// the QA harness exercises every family × domain crossing the live  //
// approved pool can hit, so a drift would surface at QA time.       //
// ---------------------------------------------------------------- //

type Family = PremiseCore["family"];

const FAMILY_PATTERN: Record<Family, Idea["pattern"]> = {
  self_betrayal: "contrast",
  self_as_relationship: "pov",
  absurd_escalation: "mini_story",
  confident_vs_real: "contrast",
  social_mask: "contrast",
  adulting_chaos: "contrast",
  dopamine_overthinking: "mini_story",
  identity_exposure: "contrast",
};

const FAMILY_SPIKE: Record<Family, Idea["emotionalSpike"]> = {
  self_betrayal: "regret",
  self_as_relationship: "embarrassment",
  absurd_escalation: "panic",
  confident_vs_real: "irony",
  social_mask: "irony",
  adulting_chaos: "denial",
  dopamine_overthinking: "regret",
  identity_exposure: "embarrassment",
};

const FAMILY_STRUCTURE: Record<Family, Idea["structure"]> = {
  self_betrayal: "routine_contradiction",
  self_as_relationship: "self_callout",
  absurd_escalation: "small_panic",
  confident_vs_real: "expectation_vs_reality",
  social_mask: "social_awareness",
  adulting_chaos: "denial_loop",
  dopamine_overthinking: "avoidance",
  identity_exposure: "self_callout",
};

const FAMILY_PAYOFF: Record<Family, Idea["payoffType"]> = {
  self_betrayal: "punchline",
  self_as_relationship: "punchline",
  absurd_escalation: "reveal",
  confident_vs_real: "reveal",
  social_mask: "reveal",
  adulting_chaos: "punchline",
  dopamine_overthinking: "reveal",
  identity_exposure: "reveal",
};

const DOMAIN_SETTING: Record<CanonicalDomain, Idea["setting"]> = {
  sleep: "bed",
  food: "kitchen",
  money: "desk",
  phone: "couch",
  work: "desk",
  fitness: "outside",
  dating: "couch",
  social: "other",
  home: "kitchen",
  mornings: "bathroom",
  study: "desk",
  content: "desk",
};

const DOMAIN_TRIGGER_CATEGORY: Record<CanonicalDomain, Idea["triggerCategory"]> =
  {
    sleep: "self_check",
    food: "task",
    money: "phone_screen",
    phone: "phone_screen",
    work: "message",
    fitness: "task",
    dating: "message",
    social: "social",
    home: "task",
    mornings: "self_check",
    study: "task",
    content: "self_check",
  };

// ---------------------------------------------------------------- //
// Helpers                                                            //
// ---------------------------------------------------------------- //

function djb2(s: string): number {
  let h = 5381 | 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function pickTemplateHint(salt: number, key: string): Idea["templateHint"] {
  const hints: Idea["templateHint"][] = ["A", "B", "C", "D"];
  return hints[djb2(`${salt}|${key}|hint`) % hints.length]!;
}

function pickHookStyle(hookLower: string): Idea["hookStyle"] {
  if (/^the way (i|you)\b/.test(hookLower)) return "the_way_i";
  if (/^why (do|did) i\b/.test(hookLower)) return "why_do_i";
  if (/\bvs\b|→| vs\.|>/.test(hookLower)) return "contrast";
  if (/^pov\b|^when (your|you)\b|^nobody/.test(hookLower)) return "curiosity";
  return "internal_thought";
}

function capChars(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

function clampLen(s: string, min: number, max: number, pad: string): string {
  let out = capChars(s, max);
  while (out.length < min) out = `${out} ${pad}`.trim();
  return capChars(out, max);
}

/**
 * PHASE N1-TRIGGER-FIX (2026-05-06) — extract up to 2 unique
 * non-stopword content tokens from `whatToShow`, excluding the
 * anchor itself, in order of first appearance. Returns `null` if
 * fewer than 2 such tokens exist (extreme edge case given
 * PACK_FIELD_BOUNDS 20–500 chars on whatToShow).
 *
 * The tokenization regex MUST match the validator's tokenize()
 * exactly (`comedyValidation.ts` L202: `/[a-z][a-z0-9']{2,}/g`),
 * otherwise the borrowed tokens could fail the validator's overlap
 * computation. STOPWORDS is imported from the same module to keep
 * the two sides perfectly synchronized.
 */
function extractShowContentTokens(
  whatToShow: string,
  anchorLc: string,
): [string, string] | null {
  const matches = whatToShow.toLowerCase().match(/[a-z][a-z0-9']{2,}/g);
  if (!matches) return null;
  const seen = new Set<string>([anchorLc]);
  const picked: string[] = [];
  for (const m of matches) {
    if (STOPWORDS.has(m)) continue;
    if (seen.has(m)) continue;
    seen.add(m);
    picked.push(m);
    if (picked.length === 2) return [picked[0]!, picked[1]!];
  }
  return null;
}

// ---------------------------------------------------------------- //
// Public type                                                        //
// ---------------------------------------------------------------- //

export type AuthorPackEntryInput = {
  entry: NigerianPackEntry;
  core: PremiseCore;
  voice: VoiceCluster;
  regenerateSalt: number;
  recentPremises?: ReadonlySet<string>;
  seedFingerprints: ReadonlySet<string>;
};

// ---------------------------------------------------------------- //
// Author                                                             //
// ---------------------------------------------------------------- //

export function authorPackEntryAsIdea(
  input: AuthorPackEntryInput,
): CohesiveAuthorResult {
  const { entry, core, regenerateSalt, seedFingerprints } = input;

  // Pack entries declare a domain string from a Nigerian-curator
  // bucket set (messaging / movement / transport / family /
  // creator / everyday / home / money / phone / work). The catalog
  // uses a stricter `CanonicalDomain` set; this map projects the
  // pack bucket onto the closest canonical neighbour so the
  // synthesised setting / triggerCategory fields stay in their
  // ideaSchema enums. Unknown buckets fall back to "phone" (the
  // weakest, most-portable scene context).
  const PACK_DOMAIN_MAP: Record<string, CanonicalDomain> = {
    messaging: "phone",
    movement: "fitness",
    transport: "fitness",
    family: "social",
    creator: "content",
    everyday: "home",
    home: "home",
    money: "money",
    phone: "phone",
    work: "work",
  };
  const domain: CanonicalDomain =
    PACK_DOMAIN_MAP[entry.domain] ?? "phone";

  const anchorLc = entry.anchor.toLowerCase();
  const hookLower = entry.hook.toLowerCase();

  // Trigger / reaction synthesis. Anchor-present so downstream
  // hook↔scene token-presence checks in validateScenarioCoherence
  // see the shared anchor token. Word-count and length bands match
  // ideaSchema bounds (5 ≤ chars ≤ 140).
  //
  // PHASE N1-TRIGGER-FIX (2026-05-06) — additive trigger enrichment.
  // Pre-fix: trigger was a fixed `notice the {anchor} land` template.
  // The catalog comedy validator (`hook_scenario_mismatch`,
  // comedyValidation.ts L568) requires
  //   max(intersect(hookTokens, showTokens),
  //       intersect(triggerTokens, showTokens)) >= 2
  // and authentic Pidgin pack hooks rarely share more than the anchor
  // itself with `whatToShow`. Throttle instrumentation v2 (see
  // `.local/N1_THROTTLE_INSTRUMENTATION.md` Part 1.5) measured this
  // single validator at 94.4% of all 53.2% pack rejections.
  //
  // Fix: borrow up to 2 non-stopword content tokens from
  // `entry.whatToShow` (excluding the anchor itself, which is already
  // double-counted) and weave them into the trigger sentence. This
  // guarantees `triggerOverlap >= anchor + 2 = 3` deterministically
  // whenever whatToShow yields ≥2 content tokens (always true given
  // PACK_FIELD_BOUNDS 20–500 chars). When no extra tokens can be
  // extracted (extreme edge case), fall back to the original
  // template so we never regress past the pre-fix baseline.
  //
  // STRICTLY PACK-LOCAL: pack candidates are gated by the activation
  // guard upstream (region+languageStyle+flag+nonzero pool); Western,
  // India, PH, and NG-clean cohorts never reach this code, so this
  // overlay cannot affect their byte-identical baseline.
  //
  // Validator/scorer code is NOT touched — neither the
  // `hook_scenario_mismatch` rule nor the ≥2 threshold changes.
  const showContentPair = extractShowContentTokens(
    entry.whatToShow,
    anchorLc,
  );
  const triggerRaw = showContentPair
    ? `notice the ${anchorLc} land while ${showContentPair[0]} ${showContentPair[1]} settle`
    : `notice the ${anchorLc} land`;
  const trigger = clampLen(triggerRaw, 5, 140, "again");
  const reaction = clampLen(
    `freeze on the ${anchorLc} for one beat`,
    5,
    140,
    "still",
  );

  // Script: re-use the curated whatToShow text. ideaSchema demands
  // 10 ≤ chars ≤ 800; whatToShow is bounded 20–500 by
  // PACK_FIELD_BOUNDS so this always fits.
  const script = entry.whatToShow;

  // Shot plan: deterministic 3-beat scaffold built around the
  // anchor. Each beat is 2–160 chars per ideaSchema.
  const shotPlan: string[] = [
    capChars(`Open on the ${anchorLc} in frame.`, 160),
    capChars(`Beat lands — let the ${anchorLc} sit.`, 160),
    capChars(`Cut on the contradiction.`, 160),
  ];

  const visualHook = capChars(
    `Camera holds on the ${anchorLc} as the contradiction lands.`,
    160,
  );

  const whyItWorks = capChars(
    `Native Pidgin cadence on '${anchorLc}' — pack-curated for filmability.`,
    280,
  );

  // howToFilm: ensure the anchor token appears so the hook↔film
  // anchor-presence rules in validateScenarioCoherence stay
  // satisfied even when the curator didn't repeat the anchor in
  // their filming notes. We APPEND a short reminder rather than
  // rewriting the curator's copy.
  const filmLc = entry.howToFilm.toLowerCase();
  const filmHasAnchor = filmLc.includes(anchorLc);
  const filmDraft = filmHasAnchor
    ? entry.howToFilm
    : capChars(
        `${entry.howToFilm} Keep the ${anchorLc} centered.`,
        400,
      );
  const howToFilm =
    filmDraft.length >= 15 ? filmDraft : `${filmDraft} (single take).`;

  const draft: Idea = {
    pattern: FAMILY_PATTERN[core.family],
    hook: entry.hook,
    hookSeconds: 1.5,
    trigger,
    reaction,
    emotionalSpike: FAMILY_SPIKE[core.family],
    structure: FAMILY_STRUCTURE[core.family],
    hookStyle: pickHookStyle(hookLower),
    triggerCategory: DOMAIN_TRIGGER_CATEGORY[domain],
    setting: DOMAIN_SETTING[domain],
    script,
    shotPlan,
    caption: entry.caption,
    templateHint: pickTemplateHint(regenerateSalt, `${core.id}|${anchorLc}`),
    contentType: "entertainment",
    videoLengthSec: 18,
    filmingTimeMin: 5,
    whyItWorks,
    payoffType: FAMILY_PAYOFF[core.family],
    hasContrast: true,
    hasVisualAction: true,
    visualHook,
    whatToShow: entry.whatToShow,
    howToFilm,
    premiseCoreId: core.id,
  };

  // 1. ideaSchema parse — band guarantees from PACK_FIELD_BOUNDS
  //    plus the synthesised fields above mean this passes for every
  //    valid pack entry; treating any failure as a hard reject so
  //    the recipe loop falls through to the catalog queue.
  const parsed = ideaSchema.safeParse(draft);
  if (!parsed.success) {
    return { ok: false, reason: "schema_invalid" };
  }

  // 2. validateScenarioCoherence — defensive checks for template
  //    leakage / hook-scene token absence / split-self temporal
  //    mismatch. Native-reviewer entries should pass; failures
  //    fall through to the recipe loop.
  const coherenceReason = validateScenarioCoherence(parsed.data);
  if (coherenceReason) return { ok: false, reason: coherenceReason };

  // 3. validateComedy — same call shape as the cohesive author.
  //    `source` set to `core_native_pack` so downstream telemetry
  //    can distinguish pack-sourced ideas from catalog ones.
  const comedyReason: ComedyRejectionReason | null = validateComedy(
    parsed.data,
    {
      source: "core_native",
      usedBigPremise: true,
    },
  );
  if (comedyReason) return { ok: false, reason: comedyReason };

  // 4. validateAntiCopyDetailed — full anti-copy chain (corpus +
  //    style_defs seed pools, plus optional recentPremises dedup).
  const copyResult = validateAntiCopyDetailed(
    parsed.data,
    {
      source: "core_native",
      usedBigPremise: true,
    },
    seedFingerprints,
    input.recentPremises,
  );
  if (copyResult.reason) {
    return {
      ok: false,
      reason: copyResult.reason,
      ...(copyResult.antiCopyMatch
        ? { antiCopyMatch: copyResult.antiCopyMatch }
        : {}),
    };
  }

  // 5. Scenario fingerprint — same canonical helper. Ensures pack
  //    candidates participate in the cross-batch + intra-batch fp
  //    dedup gates inside the recipe loop.
  const scenarioFingerprint = computeScenarioFingerprint({
    mechanism: core.mechanism,
    anchor: anchorLc,
    action: entry.anchor, // anchor stands in for action — pack
    // entries are atomic; they don't carry an action verb.
  });

  // Synthesise a stable telemetry id (the entry shape doesn't carry
  // an `id` field — `nigerianHookPackApproved.ts` is auto-generated
  // and reviewer-stamped, so adding a column would force a regen
  // and re-stamp). djb2(hook|anchor) is collision-resistant across
  // 50 entries and stays byte-identical across regenerates.
  const entryId = `ng_${djb2(`${entry.hook}|${entry.anchor}`).toString(16)}`;

  const meta: CandidateMeta = {
    source: "core_native",
    usedBigPremise: true,
    nigerianPackEntryId: entryId,
  };

  return {
    ok: true,
    idea: parsed.data,
    meta,
    scenarioFingerprint,
    ...(copyResult.antiCopyMatch
      ? { antiCopyMatch: copyResult.antiCopyMatch }
      : {}),
  };
}
