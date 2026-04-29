/**
 * TREND CONTEXT LAYER (lightweight) — context-enrichment overlay
 * atop the now-frozen pattern engine.
 *
 * Per spec: this is NOT a new idea generator. It's a small curated
 * catalog of trending objects / behaviors / phrases that the
 * generator may inject into ~30% of emitted candidates when a
 * strict scenario+archetype fit predicate passes. Forced injection
 * is explicitly rejected — better to skip than ship a stale-feeling
 * trend graft.
 *
 * Curator workflow:
 *   - Edit `TREND_CATALOG` directly. Each item carries a static
 *     `freshnessScore` ∈ [0.0, 1.0] which biases selection AND gates
 *     emission via the `MIN_FRESHNESS` floor. Decay items by lowering
 *     the score; remove items by deleting them outright.
 *   - Aim for 20–50 active items (currently 27). Below 20 → coverage
 *     gaps; above 50 → noise + curator burden.
 *   - Each item MUST tag at least one `compatibleFamilies` (scenario)
 *     entry AND at least one `compatibleArchetypeFamilies` entry.
 *     Empty arrays are caught by the QA harness — they would make
 *     the trend un-injectable (silently dead inventory).
 *
 * ZERO schema changes — the selected `trendId` is persisted through
 * the existing JSONB cache envelope as `meta.trendId`.
 */

import type { ArchetypeFamily } from "./archetypeTaxonomy";

export type TrendType = "object" | "behavior" | "phrase" | "format";

/**
 * A scenario-family identifier. Mirrors the untyped `string` used
 * throughout `patternIdeator.ts` — kept as a type alias here so
 * future migration to a typed enum requires only a single file change.
 * Validated at QA time against the actual catalog of scenario family
 * strings (currently 25 families: cleaning, coffee, dishes, …).
 */
export type ScenarioFamilyId = string;

export interface TrendItem {
  /** Stable identifier — written into `meta.trendId` and the JSONB
   *  cache envelope. Must be globally unique across the catalog. */
  readonly id: string;
  /** Discriminator for the injection mode (substitute vs append). */
  readonly type: TrendType;
  /** Display label injected into hook/caption text. Keep short
   *  (≤24 chars recommended) — long labels overflow the per-trend
   *  length cap and silently skip. */
  readonly label: string;
  /** Curator-managed freshness in [0.0, 1.0]. Items with
   *  `freshnessScore < MIN_FRESHNESS` are filtered out by
   *  `getActiveTrends()` and therefore never selected. */
  readonly freshnessScore: number;
  /** Strict scenario-family fit list. The trend selector rejects
   *  any candidate whose `scenarioFamily` is not in this list. */
  readonly compatibleFamilies: ReadonlyArray<ScenarioFamilyId>;
  /** Strict archetype-family fit list. The trend selector rejects
   *  any candidate whose `archetypeFamily` is not in this list. */
  readonly compatibleArchetypeFamilies: ReadonlyArray<ArchetypeFamily>;
  /** Optional negative-compat list. When the candidate's archetype
   *  family appears here the trend is HARD-rejected by
   *  `trendFitsCandidate` BEFORE the positive-fit check. Per spec:
   *  encodes "bad pairings" (matcha + social_micro_fail, stanley_cup
   *  + delayed_consequence, tiktok_dance_format + low_energy_realism).
   *  An item MUST NOT list the same family in both
   *  `compatibleArchetypeFamilies` and `avoidArchetypeFamilies` —
   *  that overlap is caught by the QA harness as catalog drift. */
  readonly avoidArchetypeFamilies?: ReadonlyArray<ArchetypeFamily>;
  /** Optional region tag. When set, the trend only matches callers
   *  that ALSO supply the same region. When unset (or when the
   *  caller doesn't supply a region) the trend acts as global —
   *  this is the default for the entire current catalog since the
   *  creator-region data flow has not yet landed. Future creator
   *  metadata can begin populating this field per spec
   *  (US/UK/Nigeria/Philippines/India bundles). */
  readonly region?: string;
}

/**
 * Freshness floor — items below this score are filtered out at
 * selection time (treated as "decayed past the threshold"). Set at
 * 0.30 so scores naturally fade through the 1.0 → 0.3 band over the
 * curator-defined decay window before disappearing entirely.
 */
export const MIN_FRESHNESS = 0.3 as const;

/**
 * The injection rate — fraction of candidates that may receive a
 * trend overlay (per spec: "20–40% of ideas should include trends").
 * 30 = 30% target; the actual emission rate is lower because many
 * eligible candidates fail the strict fit predicate (no compatible
 * trend exists for the picked scenario+archetype combination).
 */
export const TREND_INJECTION_RATE_PCT = 30 as const;

/**
 * The hand-curated trend catalog. Edit directly to add / remove /
 * decay items. Per spec: "small JSON file, manually updated daily
 * or every few days". 31 items split across the 4 types (objects,
 * behaviors, phrases, formats) — well inside the 20–50 active band.
 *
 * Per the TREND + ARCHETYPE PAIRING spec, items may also tag
 * `avoidArchetypeFamilies` (negative-compat hard reject) and
 * `region` (creator-region routing). Both are optional — most items
 * intentionally stay region-less (= global) until the creator-region
 * data flow lands upstream.
 */
export const TREND_CATALOG: ReadonlyArray<TrendItem> = [
  // ─── OBJECTS (12) — substituted into scenario topicNoun ──────────
  {
    id: "matcha",
    type: "object",
    label: "matcha",
    freshnessScore: 0.92,
    compatibleFamilies: ["coffee", "snack", "hydration", "morning"],
    compatibleArchetypeFamilies: [
      "micro_rituals",
      "identity",
      "weird_habits",
    ],
    // Spec: matcha + social_micro_fail = forced (wrong vibe — the
    // matcha ritual is internal/identity, not social-friction).
    avoidArchetypeFamilies: ["social_observation"],
  },
  {
    id: "stanley_cup",
    type: "object",
    label: "stanley cup",
    freshnessScore: 0.78,
    compatibleFamilies: ["hydration", "gym", "walk", "errands"],
    compatibleArchetypeFamilies: [
      "micro_rituals",
      "identity",
      "object_personality",
    ],
    // Spec: stanley_cup + delayed_consequence = weak unless context
    // supports it. `escalation` family covers delayed-consequence
    // archetypes (domino_effect, now_its_worse, mistake_spiral) so
    // we hard-reject that pairing rather than rely on luck.
    avoidArchetypeFamilies: ["escalation"],
  },
  {
    id: "owala",
    type: "object",
    label: "owala",
    freshnessScore: 0.85,
    compatibleFamilies: ["hydration", "gym", "walk"],
    compatibleArchetypeFamilies: [
      "micro_rituals",
      "identity",
      "object_personality",
    ],
  },
  {
    id: "air_fryer",
    type: "object",
    label: "air fryer",
    freshnessScore: 0.7,
    compatibleFamilies: ["snack", "fridge", "productivity"],
    compatibleArchetypeFamilies: [
      "object_personality",
      "micro_rituals",
      "escalation",
    ],
  },
  {
    id: "lululemon_align",
    type: "object",
    label: "lululemons",
    freshnessScore: 0.74,
    compatibleFamilies: ["gym", "outfit", "mirror_pep_talk", "walk"],
    compatibleArchetypeFamilies: [
      "identity",
      "micro_rituals",
      "weird_habits",
    ],
  },
  {
    id: "dyson_airwrap",
    type: "object",
    label: "airwrap",
    freshnessScore: 0.72,
    compatibleFamilies: ["outfit", "mirror_pep_talk", "skincare"],
    compatibleArchetypeFamilies: [
      "object_personality",
      "micro_rituals",
      "identity",
    ],
  },
  {
    id: "crumbl_cookie",
    type: "object",
    label: "crumbl",
    freshnessScore: 0.68,
    compatibleFamilies: ["snack", "fridge", "weekend_plans"],
    compatibleArchetypeFamilies: [
      "object_personality",
      "social_observation",
      "identity",
    ],
  },
  {
    id: "pickleball",
    type: "object",
    label: "pickleball",
    freshnessScore: 0.66,
    compatibleFamilies: ["gym", "errands", "weekend_plans", "walk"],
    compatibleArchetypeFamilies: [
      "identity",
      "escalation",
      "weird_habits",
    ],
  },
  {
    id: "labubu",
    type: "object",
    label: "labubu",
    freshnessScore: 0.95,
    compatibleFamilies: ["shopping", "weekend_plans", "social_post"],
    compatibleArchetypeFamilies: [
      "identity",
      "weird_habits",
      "object_personality",
    ],
  },
  {
    id: "erewhon_smoothie",
    type: "object",
    label: "erewhon smoothie",
    freshnessScore: 0.71,
    compatibleFamilies: ["coffee", "snack", "social_post"],
    compatibleArchetypeFamilies: [
      "identity",
      "social_observation",
      "micro_rituals",
    ],
  },
  {
    id: "zara_dress",
    type: "object",
    label: "zara dress",
    freshnessScore: 0.6,
    compatibleFamilies: ["shopping", "outfit", "weekend_plans"],
    compatibleArchetypeFamilies: [
      "identity",
      "social_observation",
      "micro_rituals",
    ],
  },
  {
    id: "shrimp_chips",
    type: "object",
    label: "shrimp chips",
    freshnessScore: 0.55,
    compatibleFamilies: ["snack", "fridge"],
    compatibleArchetypeFamilies: [
      "object_personality",
      "weird_habits",
    ],
  },

  // ─── BEHAVIORS (10) — appended as " (label)" to caption ──────────
  {
    id: "doomscrolling",
    type: "behavior",
    label: "doomscroll arc",
    freshnessScore: 0.93,
    compatibleFamilies: [
      "texting",
      "sleep",
      "doom_scroll_car",
      "social_post",
    ],
    compatibleArchetypeFamilies: [
      "time_distortion",
      "low_energy_realism",
      "self_deception",
    ],
  },
  {
    id: "just_one_episode",
    type: "behavior",
    label: "just one episode",
    freshnessScore: 0.7,
    compatibleFamilies: ["sleep", "weekend_plans", "doom_scroll_car"],
    compatibleArchetypeFamilies: [
      "self_deception",
      "time_distortion",
    ],
  },
  {
    id: "soft_quitting",
    type: "behavior",
    label: "soft quitting",
    freshnessScore: 0.75,
    compatibleFamilies: ["productivity", "emails", "gym"],
    compatibleArchetypeFamilies: [
      "self_deception",
      "low_energy_realism",
    ],
  },
  {
    id: "revenge_bedtime",
    type: "behavior",
    label: "revenge bedtime",
    freshnessScore: 0.82,
    compatibleFamilies: ["sleep", "doom_scroll_car"],
    compatibleArchetypeFamilies: [
      "self_deception",
      "time_distortion",
    ],
  },
  {
    id: "soft_launching",
    type: "behavior",
    label: "soft launch",
    freshnessScore: 0.68,
    compatibleFamilies: ["social_post", "social_call"],
    compatibleArchetypeFamilies: [
      "identity",
      "social_observation",
    ],
  },
  {
    id: "silent_walking",
    type: "behavior",
    label: "silent walking",
    freshnessScore: 0.81,
    compatibleFamilies: ["walk", "podcast"],
    compatibleArchetypeFamilies: [
      "identity",
      "weird_habits",
      "micro_rituals",
    ],
  },
  {
    id: "hot_girl_walk",
    type: "behavior",
    label: "hot girl walk",
    freshnessScore: 0.5,
    compatibleFamilies: ["walk", "gym"],
    compatibleArchetypeFamilies: [
      "identity",
      "micro_rituals",
    ],
  },
  {
    id: "parking_lot_chronicles",
    type: "behavior",
    label: "parking lot chronicles",
    freshnessScore: 0.67,
    compatibleFamilies: ["doom_scroll_car", "errands"],
    compatibleArchetypeFamilies: [
      "low_energy_realism",
      "inner_monologue",
    ],
  },
  {
    id: "delulu_planning",
    type: "behavior",
    label: "delulu planning",
    freshnessScore: 0.84,
    compatibleFamilies: ["productivity", "weekend_plans"],
    compatibleArchetypeFamilies: [
      "self_deception",
      "identity",
      "time_distortion",
    ],
  },
  {
    id: "fake_busy",
    type: "behavior",
    label: "fake busy mode",
    freshnessScore: 0.62,
    compatibleFamilies: ["productivity", "emails", "social_call"],
    compatibleArchetypeFamilies: [
      "self_deception",
      "social_observation",
    ],
  },

  // ─── PHRASES (6) — appended as " — label" to caption ─────────────
  // PHRASES intentionally fewer + higher fit-bar than objects /
  // behaviors. They're the most meme-prone of the 3 types and the
  // QA validator (`validateTrendInjection`) will silently drop any
  // injection that trips banned-prefix / generic-filler / voice-
  // violation regexes. Curator should bias toward phrases that
  // describe a state rather than instruct an action.
  {
    id: "no_thoughts_head_empty",
    type: "phrase",
    label: "no thoughts, head empty",
    freshnessScore: 0.42,
    compatibleFamilies: [
      "doom_scroll_car",
      "sleep",
      "morning",
      "productivity",
    ],
    compatibleArchetypeFamilies: [
      "low_energy_realism",
      "inner_monologue",
    ],
  },
  {
    id: "i_fear",
    type: "phrase",
    label: "i fear",
    freshnessScore: 0.58,
    compatibleFamilies: [
      "texting",
      "social_post",
      "social_call",
      "mirror_pep_talk",
    ],
    compatibleArchetypeFamilies: [
      "inner_monologue",
      "self_deception",
    ],
  },
  {
    id: "in_my_era",
    type: "phrase",
    label: "in my era",
    freshnessScore: 0.5,
    compatibleFamilies: [
      "outfit",
      "mirror_pep_talk",
      "social_post",
      "weekend_plans",
    ],
    compatibleArchetypeFamilies: [
      "identity",
      "micro_rituals",
    ],
  },
  {
    id: "low_stakes",
    type: "phrase",
    label: "low stakes era",
    freshnessScore: 0.55,
    compatibleFamilies: [
      "weekend_plans",
      "walk",
      "podcast",
      "morning",
    ],
    compatibleArchetypeFamilies: [
      "low_energy_realism",
      "identity",
    ],
  },
  {
    id: "girl_dinner",
    type: "phrase",
    label: "girl dinner",
    freshnessScore: 0.45,
    compatibleFamilies: ["snack", "fridge"],
    // Spec: girl dinner → petty_logic / self_deception → "this
    // counts as dinner". Existing low_energy_realism / weird_habits
    // / identity tags are kept (still valid alternative pairings)
    // and the spec families are added so the pairing fires.
    compatibleArchetypeFamilies: [
      "low_energy_realism",
      "weird_habits",
      "identity",
      "petty_logic",
      "self_deception",
    ],
  },
  {
    // Spec: quiet luxury → identity / fake_self → "me pretending
    // I'm that person". `fake_self` maps to the identity family
    // (granular archetypes self_vs_reality, fake_competence,
    // aspirational_self, contrasting_self all live there).
    id: "quiet_luxury",
    type: "phrase",
    label: "quiet luxury era",
    freshnessScore: 0.62,
    compatibleFamilies: [
      "outfit",
      "shopping",
      "mirror_pep_talk",
      "social_post",
    ],
    compatibleArchetypeFamilies: ["identity", "low_energy_realism"],
  },

  // ─── FORMATS (3) — appended as " (label)" to caption ─────────────
  // FORMATS describe the VIDEO format/style hint rather than an
  // object substitution or behavior beat. Same parenthetical shape
  // as `behavior` (see `applyTrendToCaption`) — distinguished only
  // at the catalog/curation layer so the label reads as a format
  // instruction (e.g. "voice memo style") not an extra action.
  {
    // Spec: TikTok dance trend + low_energy_realism = wrong energy.
    // The format demands performative kinetic energy, which clashes
    // with low-energy realism's deadpan acceptance / quiet failure.
    id: "tiktok_dance_format",
    type: "format",
    label: "tiktok dance format",
    freshnessScore: 0.55,
    compatibleFamilies: [
      "outfit",
      "mirror_pep_talk",
      "social_post",
      "weekend_plans",
    ],
    compatibleArchetypeFamilies: [
      "identity",
      "social_observation",
      "escalation",
    ],
    avoidArchetypeFamilies: ["low_energy_realism"],
  },
  {
    id: "voice_memo_format",
    type: "format",
    label: "voice memo style",
    freshnessScore: 0.68,
    compatibleFamilies: [
      "texting",
      "social_call",
      "mirror_pep_talk",
      "podcast",
    ],
    compatibleArchetypeFamilies: [
      "inner_monologue",
      "low_energy_realism",
      "self_deception",
    ],
  },
  {
    id: "lazy_grwm_format",
    type: "format",
    label: "lazy GRWM",
    freshnessScore: 0.6,
    compatibleFamilies: [
      "outfit",
      "morning",
      "mirror_pep_talk",
      "skincare",
    ],
    compatibleArchetypeFamilies: [
      "low_energy_realism",
      "self_deception",
      "micro_rituals",
    ],
  },
];

/**
 * O(1) lookup by id — used by the cache-replay path to resolve a
 * persisted `meta.trendId` back to its TrendItem (e.g. for the
 * cross-batch novelty -2 penalty in `selectionPenalty`).
 */
export const TREND_BY_ID: Readonly<Record<string, TrendItem>> =
  Object.freeze(
    TREND_CATALOG.reduce<Record<string, TrendItem>>((acc, t) => {
      acc[t.id] = t;
      return acc;
    }, {}),
  );

/**
 * Returns trends whose `freshnessScore >= MIN_FRESHNESS`. Currently
 * `now` is unused (decay is curator-managed via direct edits to the
 * static `freshnessScore` field) but the parameter is kept on the
 * signature so a future "compute live freshness from `addedAt`
 * timestamp" implementation can land without a cross-callsite
 * migration.
 */
export function getActiveTrends(_now?: Date): ReadonlyArray<TrendItem> {
  void _now;
  return TREND_CATALOG.filter((t) => t.freshnessScore >= MIN_FRESHNESS);
}

/**
 * Strict fit predicate. Both the scenario family AND the archetype
 * family must appear in the trend's compatibility lists. Null /
 * undefined inputs ALWAYS reject (no "any-fits-anything" wildcards
 * — keeps cold-start / fallback candidates from accidentally
 * receiving a trend graft when their derivation pipeline didn't
 * fully resolve).
 *
 * Negative-compat (avoidArchetypeFamilies) is checked BEFORE the
 * positive-fit lists — a hard reject wins over any other signal.
 * This encodes the spec's "bad pairings" (matcha + social_micro_fail
 * → forced; stanley_cup + delayed_consequence → weak; tiktok_dance
 * + low_energy_realism → wrong energy).
 *
 * Region predicate (4th optional param) is a global-by-default
 * wildcard: when EITHER side is unset the check passes. A trend
 * with `region` set only matches callers that supply the same
 * region string (case-sensitive, exact match — region taxonomy is
 * a curator-controlled controlled vocabulary, not user input).
 */
export function trendFitsCandidate(
  trend: TrendItem,
  scenarioFamily: ScenarioFamilyId | null | undefined,
  archetypeFamily: ArchetypeFamily | null | undefined,
  region?: string | null,
): boolean {
  if (!scenarioFamily || !archetypeFamily) return false;
  // Negative compat first — hard reject wins.
  if (
    trend.avoidArchetypeFamilies &&
    trend.avoidArchetypeFamilies.includes(archetypeFamily)
  ) {
    return false;
  }
  if (!trend.compatibleFamilies.includes(scenarioFamily)) return false;
  if (!trend.compatibleArchetypeFamilies.includes(archetypeFamily))
    return false;
  // Region: only enforced when BOTH sides supply a value. Trend
  // without `region` acts as global; caller without `region` accepts
  // all trends regardless of their tag.
  if (trend.region && region && trend.region !== region) return false;
  return true;
}

/**
 * Deterministic 32-bit FNV-1a-style hash. Used by
 * `selectTrendForCandidate` to produce a stable bucket per
 * (slotIndex, scenarioFamily, salt) triple so the same input always
 * returns the same trend (cache-replay reproducibility) while still
 * spreading across all 100 buckets uniformly.
 */
function hashTriple(slotIndex: number, family: string, salt: number): number {
  let h = (2166136261 ^ salt) >>> 0;
  h = Math.imul(h ^ (slotIndex + 1), 16777619) >>> 0;
  for (let i = 0; i < family.length; i++) {
    h = Math.imul(h ^ family.charCodeAt(i), 16777619) >>> 0;
  }
  return h >>> 0;
}

export interface TrendSelectionInput {
  readonly slotIndex: number;
  readonly scenarioFamily: ScenarioFamilyId | null | undefined;
  readonly archetypeFamily: ArchetypeFamily | null | undefined;
  readonly salt: number;
  /** Optional creator-region passthrough. When supplied, the
   *  selector enforces region match against each trend's `region`
   *  tag (with global-default semantics — see `trendFitsCandidate`).
   *  When omitted, all trends are eligible regardless of their
   *  region tag. Currently no upstream caller supplies this — the
   *  field is wired for the future creator.region data flow. */
  readonly region?: string;
}

/**
 * Deterministic trend selector.
 *
 * 1. Hash (slotIndex, family, salt) into a 0-99 bucket.
 * 2. If `bucket >= TREND_INJECTION_RATE_PCT` → return null (skip —
 *    keeps emission rate ≤ rate%).
 * 3. Else filter `getActiveTrends()` by `trendFitsCandidate`.
 * 4. If filter empty → return null (NO forced trend — strict fit).
 * 5. Else freshness-weighted deterministic pick from the filtered
 *    list using the same hash as a tie-breaker.
 *
 * Same input ALWAYS returns the same trend (reproducibility — the
 * cache-replay path relies on this).
 */
export function selectTrendForCandidate(
  input: TrendSelectionInput,
): TrendItem | null {
  const { slotIndex, scenarioFamily, archetypeFamily, salt, region } = input;
  if (!scenarioFamily || !archetypeFamily) return null;
  const h = hashTriple(slotIndex, scenarioFamily, salt);
  const bucket = h % 100;
  if (bucket >= TREND_INJECTION_RATE_PCT) return null;
  const eligible = getActiveTrends().filter((t) =>
    trendFitsCandidate(t, scenarioFamily, archetypeFamily, region),
  );
  if (eligible.length === 0) return null;
  // Freshness-weighted pick: cumulative weight sum, then h-modulo
  // into the cumulative distribution. Same hash → same pick.
  const totalWeight = eligible.reduce((s, t) => s + t.freshnessScore, 0);
  if (totalWeight <= 0) return null;
  // Use the upper 16 bits of h for the weighted draw so it's
  // independent of the lower-bits bucket gate above.
  const draw = ((h >>> 16) / 0xffff) * totalWeight;
  let acc = 0;
  for (const t of eligible) {
    acc += t.freshnessScore;
    if (draw <= acc) return t;
  }
  // Floating-point safety: last item wins on rounding overflow.
  return eligible[eligible.length - 1] ?? null;
}

/**
 * Apply a trend to a caption. Pure / idempotent — calling twice
 * with the same trend produces the same output as calling once.
 *
 * Injection modes:
 *   - `object`   → substitute first occurrence of `scenarioTopicNoun`
 *                  (when present in the caption) with `trend.label`.
 *                  No-op when the topic noun is absent (signaled by
 *                  the validator as "substitution failed silently").
 *   - `behavior` → append ` (${trend.label})` if the result fits
 *                  within the 80-char budget. No-op otherwise.
 *   - `phrase`   → append ` — ${trend.label}` if the result fits
 *                  within the 80-char budget. No-op otherwise.
 *   - `format`   → append ` (${trend.label})` — same parenthetical
 *                  shape as `behavior` so the per-trend length
 *                  ceiling and idempotency rules apply identically.
 *                  Distinguished from `behavior` only at the
 *                  catalog/curation layer: the LABEL should describe
 *                  a video FORMAT (e.g. "voice memo style", "lazy
 *                  GRWM format") so the parenthetical reads as a
 *                  format hint rather than an extra behavior beat.
 *
 * The 80-char ceiling is tighter than the upstream caption length
 * cap (which varies by template) — keeps the trend graft from
 * pushing captions past the comfortable read-in-one-glance size.
 */
const CAPTION_LENGTH_CEILING = 80 as const;

export function applyTrendToCaption(
  caption: string,
  trend: TrendItem,
  scenarioTopicNoun: string,
): string {
  const trimmed = caption.trim();
  if (!trimmed || !trend.label.trim()) return caption;
  switch (trend.type) {
    case "object": {
      if (!scenarioTopicNoun) return caption;
      // Idempotency: if the trend label is already in the caption,
      // skip — substitution would duplicate. We DON'T check for the
      // topicNoun absence here because that's the validator's job
      // (validateTrendInjection rejects when result === input).
      if (trimmed.toLowerCase().includes(trend.label.toLowerCase())) {
        return trimmed;
      }
      // Word-boundary case-insensitive substitution of the FIRST
      // occurrence only. RegExp escape on topicNoun is paranoia —
      // current scenario topicNouns are all plain words.
      const escaped = scenarioTopicNoun.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      );
      const re = new RegExp(`\\b${escaped}\\b`, "i");
      if (!re.test(trimmed)) return caption;
      return trimmed.replace(re, trend.label);
    }
    case "behavior":
    case "format": {
      // `format` shares the parenthetical-append shape with
      // `behavior` — see the doc block above for the curation-time
      // distinction. Identical idempotency + length-ceiling rules.
      const addition = ` (${trend.label})`;
      if (trimmed.toLowerCase().includes(trend.label.toLowerCase())) {
        return trimmed;
      }
      if (trimmed.length + addition.length > CAPTION_LENGTH_CEILING) {
        return caption;
      }
      return `${trimmed}${addition}`;
    }
    case "phrase": {
      const addition = ` — ${trend.label}`;
      if (trimmed.toLowerCase().includes(trend.label.toLowerCase())) {
        return trimmed;
      }
      if (trimmed.length + addition.length > CAPTION_LENGTH_CEILING) {
        return caption;
      }
      return `${trimmed}${addition}`;
    }
    default:
      return caption;
  }
}

/**
 * Validator for trend injections — returns `true` ONLY when the
 * injection is safe to ship. Soft-skip discipline: if this returns
 * `false`, the caller drops `meta.trendId` and reverts the caption
 * to its pre-trend state. The candidate STILL ships (no whole-batch
 * rejection — trends are an OPTIONAL overlay per the spec).
 *
 * Reject criteria:
 *   1. Substitution failed silently — `original === transformed`
 *      means `applyTrendToCaption` couldn't find the topic noun OR
 *      the transformation hit the length ceiling. Better to ship
 *      the candidate without the trend tag than tag a candidate
 *      whose caption never received the trend.
 *   2. The transformed caption matches one of the validator regex
 *      sets imported by the caller (banned-prefix, generic-filler,
 *      voice-violation). Defense-in-depth: catches catalog drift
 *      where a trend label happens to compose into a banned phrase.
 *
 * The actual regex composition lives in the caller (we don't import
 * `validateHook` here to keep the catalog file's dependency surface
 * tiny). The caller passes a predicate `isCleanCaption` that wraps
 * its preferred validator chain.
 */
export function validateTrendInjection(
  originalCaption: string,
  transformedCaption: string,
  isCleanCaption: (s: string) => boolean,
): boolean {
  if (originalCaption === transformedCaption) return false;
  if (!isCleanCaption(transformedCaption)) return false;
  return true;
}
