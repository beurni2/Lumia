/**
 * PHASE W2-K — Western APPROVED pack candidate author.
 *
 * Atomic recipe author for `APPROVED_WESTERN_PROMOTION_CANDIDATES`
 * entries. Mirrors `nigerianPackAuthor.ts`:
 *
 *   • The pack supplies hook + whatToShow + howToFilm + caption
 *     verbatim (already PENDING_EDITORIAL_REVIEW stamped + boot-
 *     asserted by `westernHookPackApproved.ts`). This module
 *     synthesises the remaining `Idea` axes from W2-specific maps
 *     (comedyFamily / setting / emotionalSpike → Idea axes) and
 *     runs the candidate through the SAME four production
 *     validators with NO loosening:
 *       1. `ideaSchema.safeParse`
 *       2. `validateScenarioCoherence`
 *       3. `validateComedy`
 *       4. `validateAntiCopyDetailed`
 *
 * On a pass, returns a `CohesiveAuthorResult` shaped identically to
 * `authorCohesiveIdea` so the caller can fold W2 candidates into
 * the existing slot-reservation pipeline without branching
 * downstream code paths.
 *
 * SAFETY:
 *   • The integration site behind `getEligibleWesternApprovedEntries`
 *     short-circuits unless region∈{undefined,"western"} +
 *     languageStyle∈{undefined,null,"clean"} + flag ON + pool
 *     non-empty.
 *   • All four production validators run unchanged.
 *   • The cohesive author's structural pre-checks are intentionally
 *     skipped — pack entries are atomic editorial-reviewed units;
 *     anchor/hook structural shape is the reviewer's responsibility.
 *   • The trigger-overlap fix is mirrored from
 *     `nigerianPackAuthor.ts` so the catalog comedy validator's
 *     `hook_scenario_mismatch` rule (≥2 token intersection)
 *     deterministically passes for every entry whose `whatToShow`
 *     yields ≥2 content tokens (always true given the 20–500 char
 *     band on whatToShow).
 */

import { ideaSchema, type Idea } from "./ideaGen.js";
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
import type {
  WesternComedyFamily,
  WesternEmotionalSpike,
  WesternSetting,
  WesternHookPackDraftEntry,
} from "./westernHookPack.js";

// ---------------------------------------------------------------- //
// W2 comedyFamily → Idea axis maps. Designed to derive coherent    //
// pattern / structure / payoffType / hookStyle from W2's coarser   //
// comedy buckets. Unknown families default to a safe contrast +    //
// self_callout shape — but every family in WESTERN_COMEDY_FAMILIES //
// is mapped explicitly below.                                       //
// ---------------------------------------------------------------- //

const W2_FAMILY_PATTERN: Record<WesternComedyFamily, Idea["pattern"]> = {
  self_betrayal: "contrast",
  denial_loop: "contrast",
  performative_dread: "mini_story",
  tiny_humiliation: "mini_story",
  parasocial_object: "pov",
  anxious_optimism: "contrast",
  procrastination_theatre: "mini_story",
  catastrophizing: "mini_story",
  posting_anxiety: "mini_story",
  food_self_control: "contrast",
  texting_overthinking: "mini_story",
  task_avoidance: "mini_story",
  leaving_house_delay: "mini_story",
  creator_anxiety: "mini_story",
  procrastination: "mini_story",
  getting_ready: "mini_story",
  phone_distraction: "mini_story",
  tiny_public_private_awkwardness: "mini_story",
  work_school_panic: "mini_story",
  adulting_panic: "contrast",
  self_control: "contrast",
  self_improvement_attempt: "contrast",
  social_plans: "contrast",
};

const W2_FAMILY_STRUCTURE: Record<WesternComedyFamily, Idea["structure"]> = {
  self_betrayal: "routine_contradiction",
  denial_loop: "denial_loop",
  performative_dread: "small_panic",
  tiny_humiliation: "social_awareness",
  parasocial_object: "self_callout",
  anxious_optimism: "expectation_vs_reality",
  procrastination_theatre: "avoidance",
  catastrophizing: "small_panic",
  posting_anxiety: "self_callout",
  food_self_control: "routine_contradiction",
  texting_overthinking: "self_callout",
  task_avoidance: "avoidance",
  leaving_house_delay: "avoidance",
  creator_anxiety: "self_callout",
  procrastination: "avoidance",
  getting_ready: "expectation_vs_reality",
  phone_distraction: "avoidance",
  tiny_public_private_awkwardness: "social_awareness",
  work_school_panic: "small_panic",
  adulting_panic: "small_panic",
  self_control: "routine_contradiction",
  self_improvement_attempt: "expectation_vs_reality",
  social_plans: "denial_loop",
};

const W2_FAMILY_PAYOFF: Record<WesternComedyFamily, Idea["payoffType"]> = {
  self_betrayal: "punchline",
  denial_loop: "punchline",
  performative_dread: "reveal",
  tiny_humiliation: "punchline",
  parasocial_object: "punchline",
  anxious_optimism: "reveal",
  procrastination_theatre: "punchline",
  catastrophizing: "reveal",
  posting_anxiety: "punchline",
  food_self_control: "punchline",
  texting_overthinking: "reveal",
  task_avoidance: "punchline",
  leaving_house_delay: "punchline",
  creator_anxiety: "reveal",
  procrastination: "punchline",
  getting_ready: "reveal",
  phone_distraction: "punchline",
  tiny_public_private_awkwardness: "reveal",
  work_school_panic: "reveal",
  adulting_panic: "punchline",
  self_control: "punchline",
  self_improvement_attempt: "reveal",
  social_plans: "punchline",
};

// W2 emotionalSpike → Idea emotionalSpike (5 canonical values).
// The Idea schema accepts: embarrassment / regret / denial / panic / irony.
const W2_SPIKE_MAP: Record<WesternEmotionalSpike, Idea["emotionalSpike"]> = {
  shame: "embarrassment",
  dread: "panic",
  glee: "irony",
  despair: "regret",
  defeat: "regret",
  smugness: "irony",
  panic: "panic",
  embarrassment: "embarrassment",
  private_embarrassment: "embarrassment",
  self_betrayal: "regret",
  social_panic: "panic",
  quiet_realization: "regret",
  exposed_lie: "embarrassment",
  false_productivity: "denial",
  instant_regret: "regret",
  confused_pause: "denial",
  quiet_guilt: "regret",
  impatient_spiral: "panic",
  avoidance_spike: "denial",
  polite_rage: "irony",
  physical_embarrassment: "embarrassment",
  financial_dread: "panic",
  quiet_defeat: "regret",
  performance_panic: "panic",
  overprepared_panic: "panic",
  excuse_found: "denial",
  caught_off_guard: "embarrassment",
  decision_avoidance: "denial",
  time_loss: "regret",
  self_doubt_spike: "panic",
  mask_drop: "embarrassment",
  self_critique: "regret",
  deadline_panic: "panic",
};

// W2 setting → Idea setting. Idea schema accepts:
// bed / couch / desk / bathroom / kitchen / car / outside / other.
const W2_SETTING_MAP: Record<WesternSetting, Idea["setting"]> = {
  bedroom: "bed",
  kitchen: "kitchen",
  bathroom: "bathroom",
  desk: "desk",
  couch: "couch",
  car: "car",
  gym: "outside",
  doorway: "other",
  mirror: "bathroom",
  phone: "couch",
  living_room: "couch",
  home: "other",
  entryway: "other",
  store: "outside",
  hallway: "other",
};

// triggerCategory derived from the setting bucket. Idea schema accepts:
// phone_screen / message / social / environment / self_check / task.
const W2_SETTING_TRIGGER_CATEGORY: Record<
  WesternSetting,
  Idea["triggerCategory"]
> = {
  bedroom: "self_check",
  kitchen: "task",
  bathroom: "self_check",
  desk: "phone_screen",
  couch: "phone_screen",
  car: "task",
  gym: "task",
  doorway: "environment",
  mirror: "self_check",
  phone: "phone_screen",
  living_room: "phone_screen",
  home: "task",
  entryway: "environment",
  store: "environment",
  hallway: "environment",
};

// ---------------------------------------------------------------- //
// Helpers (mirrored from nigerianPackAuthor.ts; kept LOCAL so the   //
// NG file is not touched). Updates require manual sync — the QA     //
// harness exercises every W2 entry so drift surfaces at QA time.    //
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

// Trigger-overlap fix — same two-pass picker as nigerianPackAuthor.
// Borrows up to 2 non-stopword content tokens from `whatToShow`
// (excluding the anchor itself) so the validator's
// `hook_scenario_mismatch` rule deterministically sees ≥2 trigger↔show
// token intersections.
const TRIGGER_TOKEN_SKIP: ReadonlySet<string> = new Set([
  "own", "who", "whom", "whose", "what", "which",
  "everyone", "someone", "anyone", "nobody", "somebody", "everybody",
  "all", "any", "some", "many", "more", "most", "every", "each",
  "around", "behind", "below", "between", "through", "against",
  "across", "under", "before", "after", "while", "until", "during",
  "without", "within", "back", "away", "inside", "outside", "near",
  "open", "opens", "close", "closes", "watch", "watches",
  "look", "looks", "ask", "asks", "tell", "tells",
  "say", "says", "make", "makes", "take", "takes",
  "get", "gets", "go", "goes", "come", "comes",
  "hold", "holds", "hit", "hits", "land", "lands",
  "drop", "drops", "pause", "pauses", "freeze", "freezes",
  "scroll", "scrolls", "type", "types", "send", "sends",
  "plug", "plugs", "pick", "picks", "walk", "walks",
  "sit", "sits", "stand", "stands", "fall", "falls",
  "run", "runs", "jump", "jumps", "move", "moves",
  "turn", "turns", "cut", "cuts",
  "check", "checks", "click", "clicks", "tap", "taps",
  "wait", "waits", "hover", "hovers",
  "delete", "deletes", "lock", "locks",
  "smile", "smiles", "stare", "stares",
  "scoop", "scoops", "stretch", "stretches",
  "answer", "answers", "reply", "replies",
  "remove", "removes", "rehearse", "rehearses",
  "vanish", "vanishes", "explain", "explains",
  "reach", "reaches", "begs", "begging",
  "use", "uses", "find", "finds", "leave", "leaves",
  "let", "lets", "give", "gives", "keep", "keeps",
  "put", "try", "tries", "want", "wants",
  "need", "needs", "feel", "feels",
  "start", "starts", "stop", "stops",
  // W2-specific common scene verbs surfaced in the Top 100 corpus.
  "refresh", "refreshes", "swipe", "swipes",
  "lean", "leans", "flip", "flips",
  "post", "posts", "snatch", "snatches",
]);

function extractShowContentTokens(
  whatToShow: string,
  anchorLc: string,
): [string, string] | null {
  const matches = whatToShow.toLowerCase().match(/[a-z][a-z0-9']{2,}/g);
  if (!matches) return null;
  // Pass 1: drop pronouns / scene verbs / locatives / apostrophe forms.
  {
    const seen = new Set<string>([anchorLc]);
    const picked: string[] = [];
    for (const m of matches) {
      if (STOPWORDS.has(m)) continue;
      if (TRIGGER_TOKEN_SKIP.has(m)) continue;
      if (m.includes("'")) continue;
      if (seen.has(m)) continue;
      seen.add(m);
      picked.push(m);
      if (picked.length === 2) return [picked[0]!, picked[1]!];
    }
  }
  // Pass 2: any 2 non-stopword non-anchor tokens.
  {
    const seen = new Set<string>([anchorLc]);
    const picked: string[] = [];
    for (const m of matches) {
      if (STOPWORDS.has(m)) continue;
      if (seen.has(m)) continue;
      seen.add(m);
      picked.push(m);
      if (picked.length === 2) return [picked[0]!, picked[1]!];
    }
  }
  return null;
}

// ---------------------------------------------------------------- //
// Public API                                                         //
// ---------------------------------------------------------------- //

/** Stable W2 telemetry id for an entry. djb2(hook|anchor) hex. */
export function w2EntryIdOf(entry: WesternHookPackDraftEntry): string {
  return `w2_${djb2(`${entry.hook}|${entry.anchor}`).toString(16)}`;
}

export type AuthorWesternPackEntryInput = {
  entry: WesternHookPackDraftEntry;
  regenerateSalt: number;
  recentPremises?: ReadonlySet<string>;
  seedFingerprints: ReadonlySet<string>;
};

export function authorWesternPackEntryAsIdea(
  input: AuthorWesternPackEntryInput,
): CohesiveAuthorResult {
  const { entry, regenerateSalt, seedFingerprints } = input;

  const anchorLc = entry.anchor.toLowerCase();
  const hookLower = entry.hook.toLowerCase();

  // Trigger / reaction synthesis with two-token whatToShow borrow
  // (mirrors nigerianPackAuthor — see lengthy rationale there).
  const showContentPair = extractShowContentTokens(entry.whatToShow, anchorLc);
  const triggerRaw = showContentPair
    ? `notice the ${anchorLc} land while ${showContentPair[0]} ${showContentPair[1]} settle`
    : `notice the ${anchorLc} land`;
  let trigger = clampLen(triggerRaw, 5, 140, "again");

  // Post-clamp invariant check — defensive: re-measure overlap, fall
  // back to the bare-anchor template if truncation broke it.
  {
    const showTokenSet = new Set(
      (entry.whatToShow.toLowerCase().match(/[a-z][a-z0-9']{2,}/g) ?? [])
        .filter((t) => !STOPWORDS.has(t)),
    );
    const trigTokens = new Set(
      (trigger.toLowerCase().match(/[a-z][a-z0-9']{2,}/g) ?? [])
        .filter((t) => !STOPWORDS.has(t)),
    );
    let overlap = 0;
    for (const t of trigTokens) if (showTokenSet.has(t)) overlap++;
    if (overlap < 2 && showContentPair) {
      trigger = clampLen(`notice the ${anchorLc} land`, 5, 140, "again");
    }
  }

  const reaction = clampLen(
    `freeze on the ${anchorLc} for one beat`,
    5,
    140,
    "still",
  );

  const script = entry.whatToShow;
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
    `Editorial-curated Western hook on '${anchorLc}' — packaged for filmability.`,
    280,
  );

  const filmLc = entry.howToFilm.toLowerCase();
  const filmHasAnchor = filmLc.includes(anchorLc);
  const filmDraft = filmHasAnchor
    ? entry.howToFilm
    : capChars(`${entry.howToFilm} Keep the ${anchorLc} centered.`, 400);
  const howToFilm =
    filmDraft.length >= 15 ? filmDraft : `${filmDraft} (single take).`;

  const draft: Idea = {
    pattern: W2_FAMILY_PATTERN[entry.comedyFamily],
    hook: entry.hook,
    hookSeconds: 1.5,
    trigger,
    reaction,
    emotionalSpike: W2_SPIKE_MAP[entry.emotionalSpike],
    structure: W2_FAMILY_STRUCTURE[entry.comedyFamily],
    hookStyle: pickHookStyle(hookLower),
    triggerCategory: W2_SETTING_TRIGGER_CATEGORY[entry.setting],
    setting: W2_SETTING_MAP[entry.setting],
    script,
    shotPlan,
    caption: entry.caption,
    templateHint: pickTemplateHint(regenerateSalt, `${entry.id}|${anchorLc}`),
    contentType: "entertainment",
    videoLengthSec: 18,
    filmingTimeMin: 5,
    whyItWorks,
    payoffType: W2_FAMILY_PAYOFF[entry.comedyFamily],
    hasContrast: true,
    hasVisualAction: true,
    visualHook,
    whatToShow: entry.whatToShow,
    howToFilm,
    // No premiseCoreId — W2 author doesn't iterate per-core. The
    // ideaSchema field is optional so this is safe.
  };

  const parsed = ideaSchema.safeParse(draft);
  if (!parsed.success) return { ok: false, reason: "schema_invalid" };

  const coherenceReason = validateScenarioCoherence(parsed.data);
  if (coherenceReason) return { ok: false, reason: coherenceReason };

  const comedyReason: ComedyRejectionReason | null = validateComedy(
    parsed.data,
    { source: "core_native", usedBigPremise: true },
  );
  if (comedyReason) return { ok: false, reason: comedyReason };

  const copyResult = validateAntiCopyDetailed(
    parsed.data,
    { source: "core_native", usedBigPremise: true },
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

  const scenarioFingerprint = computeScenarioFingerprint({
    mechanism: entry.comedyFamily,
    anchor: anchorLc,
    action: entry.anchor,
  });

  const meta: CandidateMeta = {
    source: "core_native",
    usedBigPremise: true,
    westernPackEntryId: w2EntryIdOf(entry),
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
