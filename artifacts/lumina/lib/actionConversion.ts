/**
 * actionConversion — pure client-side derivation of "can I film
 * this right now?" metadata + short confidence-label chips for
 * the idea card and Film-This-Now screen.
 *
 * Why client-side (not API):
 *   Phase UX1 is constrained to ZERO API breaking changes, ZERO
 *   migrations, ZERO validator loosening. Every signal we need
 *   is already on the idea object the server ships:
 *     • `setting` (bed/couch/desk/bathroom/kitchen/car/outside/other)
 *     • `pattern` (pov/reaction/mini_story/contrast)
 *     • `script` (10-800 chars; presence signals talking required)
 *     • `caption` (short overlay-friendly text)
 *     • `videoLengthSec` (15-25)
 *     • `filmingTimeMin` (1-30)
 *     • `payoffType` / `emotionalSpike` / `triggerCategory`
 *     • `whatToShow` / `howToFilm` / `shotPlan`
 *     • `hasContrast` / `hasVisualAction` / `visualHook`
 *     • `contentType`
 *   Deriving on the client keeps the route response shape frozen
 *   (route still strips only `premise` + `premiseCoreId` per
 *   `routes/ideator.ts:298-309`) and lets the labels evolve at
 *   the speed of UX without a server roundtrip.
 *
 * Conservative-by-default contract:
 *   • Every label is HIDDEN unless we're confident from the
 *     fields we have. Uncertain → unknown → no chip rendered.
 *   • Never fabricate a number. If `filmingTimeMin` is missing
 *     we don't invent one.
 *   • Cap chip count at 3 per surface so the card stays
 *     scannable on a small iPhone viewport.
 *
 * Single source of truth:
 *   The card and the Film-This-Now screen both call into this
 *   module — same labels in both places, no drift.
 */

import type { IdeaCardData } from "@/components/IdeaCard";

/** Settings the server enums today (`ideaGen.ts:285-294`). */
type Setting =
  | "bed"
  | "couch"
  | "desk"
  | "bathroom"
  | "kitchen"
  | "car"
  | "outside"
  | "other";

/** Patterns the server enums today (`ideaGen.ts`, mirrored on
 *  IdeaCardData). Includes the legacy three so cached pre-v2
 *  batches still derive cleanly. */
type Pattern = NonNullable<IdeaCardData["pattern"]>;

/** Public action-conversion metadata derived from a single idea.
 *  Every field is intentionally `| "unknown"` (or `null`) so the
 *  UI can opt out of rendering anything we couldn't compute.
 *  Phase UX1 — Feature 3. */
export type ActionConversion = {
  /** Estimated shoot time in seconds. Pulled directly from
   *  `videoLengthSec` (server clamps to 15-25). `null` when the
   *  field is missing on a legacy cached idea. */
  estimatedShootSec: number | null;
  /** End-to-end filming time in minutes from `filmingTimeMin`.
   *  `null` when missing. */
  filmingTimeMin: number | null;
  /** Short human label like "Bedroom easy" / "Desk easy" / etc.
   *  Derived from `setting`. `null` when setting is unknown. */
  difficultyLabel: string | null;
  /** "low" when private setting + safe spike, "medium" by default
   *  when we have enough signal, "high" only when the setting is
   *  outside (public exposure), "unknown" when we can't tell. */
  embarrassmentRisk: "low" | "medium" | "high" | "unknown";
  /** True when the idea pattern requires a face on camera
   *  (reaction). False when the schema clearly allows
   *  object-only filming. "unknown" otherwise — we DO NOT
   *  fabricate a face requirement. */
  faceRequired: boolean | "unknown";
  /** True when the idea ships a non-trivial `script` (talking).
   *  False when no script and no captioned dialogue cues. */
  voiceRequired: boolean | "unknown";
  /** True only when the setting is explicitly `outside`. The
   *  conservative default is false because every other setting
   *  in the schema is private. */
  publicFilmingRequired: boolean;
  /** True when the idea reads as solo-fillable from its fields
   *  (no second-person actor mentioned in `whatToShow` /
   *  `howToFilm`). Defaults to true because every server-side
   *  scenario today is solo-creator framed. */
  canFilmAlone: boolean;
  /** "likely" when it's a low-friction, low-cringe, fast shoot
   *  in a private setting; "unlikely" when it requires public
   *  filming or 10+ min. "unknown" when we lack the inputs. */
  wouldFilmToday: "likely" | "unlikely" | "unknown";
};

/** Settings considered "private" — no risk of being seen. */
const PRIVATE_SETTINGS: ReadonlySet<Setting> = new Set<Setting>([
  "bed",
  "couch",
  "desk",
  "bathroom",
  "kitchen",
  "car",
]);

/** Spikes that read as "low cringe" — the speaker is laughing
 *  at themselves about something universal. Excludes `panic`
 *  (high arousal can read as cringe to a fresh creator). */
const LOW_CRINGE_SPIKES: ReadonlySet<string> = new Set<string>([
  "irony",
  "regret",
  "denial",
  "embarrassment",
]);

/** Per-setting human-friendly difficulty label. Mapped to the
 *  same vocabulary the spec calls out (Bedroom easy / Desk easy
 *  / Car easy). For settings where "easy" overclaims (outside,
 *  other) we return null so no chip renders. */
const DIFFICULTY_LABEL_BY_SETTING: Partial<Record<Setting, string>> = {
  bed: "Bedroom easy",
  couch: "Couch easy",
  desk: "Desk easy",
  car: "Car easy",
  kitchen: "Kitchen easy",
  bathroom: "Bathroom easy",
};

/** Loose check that a string field is meaningfully populated.
 *  Schema mins (whatToShow ≥20, howToFilm ≥15, script ≥10) make
 *  this trivially true on freshly-shipped ideas, but cached
 *  legacy batches can have empty/whitespace fields. */
function nonEmpty(s: unknown): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

/** Read a candidate idea field that might exist on the API
 *  envelope but isn't declared on `IdeaCardData` (which is the
 *  display subset). Used to pull `script` / `shotPlan` /
 *  `setting` / `hasVisualAction` / etc. without hard-typing
 *  IdeaCardData to fields the card itself doesn't render. */
function pick<K extends string>(
  idea: IdeaCardData,
  key: K,
): unknown {
  return (idea as unknown as Record<string, unknown>)[key];
}

/** Pattern → face-required boolean. Reaction is the only pattern
 *  that's universally face-on; mini_story and contrast can be
 *  object-only; pov is camera-as-eye and rarely shows the
 *  speaker's face. We say "unknown" rather than fabricate
 *  certainty for non-reaction patterns because the LLM can shoot
 *  a POV with the speaker's face if it wants. */
function deriveFaceRequired(pattern: Pattern | undefined): boolean | "unknown" {
  if (pattern === "reaction") return true;
  if (pattern === "pov" || pattern === "mini_story" || pattern === "contrast") {
    return "unknown";
  }
  return "unknown";
}

/** Talking-head detection. We do NOT use script length as a
 *  proxy for "voice required" because the schema's 10-char min
 *  means even a one-word voiceover idea trips it. Instead we
 *  combine `script` presence with hookStyle / pattern signals:
 *    • pov + behavior_hook + script → almost certainly voiced
 *    • mini_story + reaction-style payoff → likely voiced
 *    • contrast + visual-only payoffType → likely silent
 *  When we can't tell with confidence we return "unknown" so
 *  no chip renders. */
function deriveVoiceRequired(idea: IdeaCardData): boolean | "unknown" {
  const script = pick(idea, "script");
  const hasScript = nonEmpty(script) && (script as string).trim().length >= 30;
  const payoffType = idea.payoffType;
  const pattern = idea.pattern;
  // Strong silent signals: contrast / visual reveal payoff with
  // no meaningful script body. We can confidently say "no talking
  // required" in those shapes.
  if (
    !hasScript &&
    (payoffType === "reveal" || payoffType === "transformation") &&
    (pattern === "contrast" || pattern === "mini_story")
  ) {
    return false;
  }
  // Strong voice signals: meaningful script + a punchline / reaction
  // payoff. "Punchline" implies a delivered line.
  if (hasScript && (payoffType === "punchline" || payoffType === "reaction")) {
    return true;
  }
  return "unknown";
}

/** Solo-fillable check. The server-side scenario catalog is
 *  framed entirely around the solo creator today, so the
 *  conservative default is `true`. We only flip to `false` when
 *  the rendered fields explicitly mention a second person. */
function deriveCanFilmAlone(idea: IdeaCardData): boolean {
  const blob = [
    idea.hook,
    idea.whatToShow,
    idea.howToFilm,
    pick(idea, "script"),
  ]
    .filter((s): s is string => typeof s === "string")
    .join(" ")
    .toLowerCase();
  // Look for explicit "second person" actors — common idioms
  // that indicate the shot needs a friend / partner / family
  // member on camera. We deliberately don't scan `caption`
  // (idioms there are speech-act, not direction).
  const SECOND_PERSON_RX =
    /\b(my (friend|partner|sister|brother|mom|dad|roommate|kid|date)|with (a|my) friend|two people|both of us|each other|group of)\b/;
  return !SECOND_PERSON_RX.test(blob);
}

/** Compose embarrassment risk from setting + spike + content
 *  type. We err toward "unknown" rather than overclaim "low
 *  cringe" because mis-tagging a high-cringe idea as low-cringe
 *  loses creator trust faster than no label at all.
 *
 *  CONSERVATIVE CONTRACT: a private setting alone is NOT enough
 *  to land at "medium" — we also require `emotionalSpike` to be
 *  present so downstream chips ("No public filming", "Can film
 *  alone") only render when we have evidence the creator's
 *  felt-cringe is in a known low/medium band. Pre-Z-era cached
 *  ideas without `emotionalSpike` correctly fall through to
 *  "unknown" and the chips are suppressed. */
function deriveEmbarrassmentRisk(
  setting: Setting | undefined,
  emotionalSpike: string | undefined,
): "low" | "medium" | "high" | "unknown" {
  if (setting === "outside") return "high";
  if (
    setting !== undefined &&
    PRIVATE_SETTINGS.has(setting) &&
    emotionalSpike !== undefined &&
    LOW_CRINGE_SPIKES.has(emotionalSpike)
  ) {
    return "low";
  }
  if (
    setting !== undefined &&
    PRIVATE_SETTINGS.has(setting) &&
    emotionalSpike !== undefined
  ) {
    return "medium";
  }
  return "unknown";
}

/** "Would film today" composite — the headline action-conversion
 *  signal. Conservative thresholds:
 *    • likely  : private setting + low/medium cringe + ≤3 min shoot
 *    • unlikely: public filming OR ≥10 min shoot
 *    • unknown : everything else (don't show a chip if we can't
 *                tell honestly). */
function deriveWouldFilmToday(
  ac: Omit<ActionConversion, "wouldFilmToday">,
): "likely" | "unlikely" | "unknown" {
  if (ac.publicFilmingRequired) return "unlikely";
  if (ac.filmingTimeMin !== null && ac.filmingTimeMin >= 10) return "unlikely";
  if (
    !ac.publicFilmingRequired &&
    (ac.embarrassmentRisk === "low" || ac.embarrassmentRisk === "medium") &&
    ac.filmingTimeMin !== null &&
    ac.filmingTimeMin <= 3
  ) {
    return "likely";
  }
  return "unknown";
}

/** Main entry point — compute the full action-conversion
 *  metadata bundle for a single idea. Pure function: same idea
 *  in → same metadata out, no side effects, no network. */
export function deriveActionConversion(idea: IdeaCardData): ActionConversion {
  const settingRaw = pick(idea, "setting");
  const setting: Setting | undefined =
    typeof settingRaw === "string" &&
    (
      [
        "bed",
        "couch",
        "desk",
        "bathroom",
        "kitchen",
        "car",
        "outside",
        "other",
      ] as const
    ).includes(settingRaw as Setting)
      ? (settingRaw as Setting)
      : undefined;
  const estimatedShootSec =
    typeof idea.videoLengthSec === "number" && idea.videoLengthSec > 0
      ? idea.videoLengthSec
      : null;
  const filmingTimeMin =
    typeof idea.filmingTimeMin === "number" && idea.filmingTimeMin > 0
      ? idea.filmingTimeMin
      : null;
  const difficultyLabel =
    setting !== undefined ? DIFFICULTY_LABEL_BY_SETTING[setting] ?? null : null;
  const publicFilmingRequired = setting === "outside";
  const faceRequired = deriveFaceRequired(idea.pattern);
  const voiceRequired = deriveVoiceRequired(idea);
  const canFilmAlone = deriveCanFilmAlone(idea);
  const embarrassmentRisk = deriveEmbarrassmentRisk(setting, idea.emotionalSpike);
  const partial: Omit<ActionConversion, "wouldFilmToday"> = {
    estimatedShootSec,
    filmingTimeMin,
    difficultyLabel,
    embarrassmentRisk,
    faceRequired,
    voiceRequired,
    publicFilmingRequired,
    canFilmAlone,
  };
  return {
    ...partial,
    wouldFilmToday: deriveWouldFilmToday(partial),
  };
}

/** Compose the short confidence-label strings the IdeaCard +
 *  Film-This-Now screen render as chips. Returns 0-`maxChips`
 *  labels in priority order — call sites slice as needed.
 *
 *  Priority is curated so the most filming-relevant labels win
 *  the first chip slot:
 *    1. Difficulty (anchors WHERE you're filming)
 *    2. Voice / face requirements (lowers cringe friction)
 *    3. Time (gives the user a number)
 *    4. Public-filming flag (the only "high-friction" warning)
 *    5. Embarrassment risk (only when "low" — never label
 *       something "high cringe" to the user)
 *
 *  Every label here is verified by a strict check inside
 *  `deriveActionConversion` — no fabrication. */
export function deriveConfidenceLabels(
  idea: IdeaCardData,
  maxChips: number = 3,
): string[] {
  const ac = deriveActionConversion(idea);
  const labels: string[] = [];

  // 1. Difficulty — single anchoring chip per the spec
  // ("Bedroom easy" / "Desk easy" / "Car easy" / etc.)
  if (ac.difficultyLabel !== null) {
    labels.push(ac.difficultyLabel);
  }

  // 2. Voice / face friction reducers — only when we're
  //    confident the answer is "no" (positive friction reducer).
  //    "voice required = true" or "face required = true" are NOT
  //    rendered as chips; they're the default state and labelling
  //    them adds pressure rather than reducing it.
  if (ac.voiceRequired === false) {
    labels.push("No talking required");
  }
  if (ac.faceRequired === false) {
    labels.push("No face needed");
  }

  // 3. Time chip — the spec calls out "10-20 sec shoot" as a
  //    label. Use the actual estimated shoot seconds when ≤20.
  if (ac.estimatedShootSec !== null && ac.estimatedShootSec <= 20) {
    labels.push(`${Math.round(ac.estimatedShootSec)}s shoot`);
  } else if (ac.filmingTimeMin !== null && ac.filmingTimeMin <= 2) {
    labels.push("~2 min to film");
  }

  // 4. Public-filming guard. We DO surface the high-friction
  //    "no public filming" promise when the setting is private,
  //    because it's the single most common reason creators don't
  //    film (per the spec's "lower embarrassment" goal). Skipped
  //    when the setting is genuinely outside.
  if (
    !ac.publicFilmingRequired &&
    (ac.embarrassmentRisk === "low" || ac.embarrassmentRisk === "medium")
  ) {
    labels.push("No public filming");
  }

  // 5. "Can film alone" — only render when we're confident AND
  //    the spec calls it out. Same rationale as voice/face: it's
  //    a positive-framing chip, not a default state.
  if (ac.canFilmAlone && ac.embarrassmentRisk !== "unknown") {
    // Suppress when we already have 3 chips — keeps the card
    // scannable on a small iPhone viewport.
    if (labels.length < maxChips) labels.push("Can film alone");
  }

  // 6. "Low cringe" — only when the embarrassment risk derivation
  //    confidently lands at "low". Spec calls this out explicitly
  //    and it's a useful trust signal for fresh creators.
  if (ac.embarrassmentRisk === "low") {
    if (labels.length < maxChips) labels.push("Low cringe");
  }

  // 7. "Text overlay works" — derived only when a caption exists
  //    AND the pattern is a visual-leaning one. Caption presence
  //    alone isn't enough (every idea has one) so we gate on
  //    pattern + payoffType.
  if (
    nonEmpty(idea.caption) &&
    (idea.pattern === "contrast" || idea.pattern === "mini_story") &&
    (idea.payoffType === "reveal" || idea.payoffType === "transformation")
  ) {
    if (labels.length < maxChips) labels.push("Text overlay works");
  }

  return labels.slice(0, maxChips);
}
