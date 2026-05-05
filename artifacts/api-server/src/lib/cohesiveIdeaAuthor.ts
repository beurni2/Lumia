/**
 * PHASE Y6 — COHESIVE IDEA AUTHOR
 *
 * Single-pass authoring function. Given a `(core, domain, anchor,
 * action, voice, regenerateSalt)` recipe, emits ONE complete `Idea`
 * where hook / premise / whatToShow / howToFilm / shotPlan /
 * caption / whyItWorks all share the same anchor noun and the same
 * contradiction beat by construction.
 *
 * Replaces the Y5 fragment-assembly loop inside
 * `coreCandidateGenerator.ts`: instead of picking a hook from
 * `core.examples` and post-hoc gluing show/film/etc around its
 * tokens, the author starts from the recipe and renders all
 * downstream fields from the same (anchor, actionPast, ingForm)
 * substitution table. There is no fragment-assembly step left to
 * be incoherent across.
 *
 * Determinism: byte-identical output for byte-identical input. No
 * Math.random, no Date.now, no module-level mutation. Salt is the
 * sole knob.
 *
 * Validation: passes through `ideaSchema.safeParse` →
 * `validateComedy` → `validateAntiCopy`. Returns a tagged result
 * (`{ok:true,...} | {ok:false, reason:...}`) so the caller can
 * advance to the next recipe AND record a per-reason rejection
 * counter for telemetry.
 *
 * No Claude. No new cost. No DB / API / schema change.
 */

import { ideaSchema, type Idea } from "./ideaGen.js";
import {
  validateComedy,
  validateAntiCopyDetailed,
  computeSeedHash,
  type AntiCopyMatch,
  type ComedyRejectionReason,
} from "./comedyValidation.js";
import {
  validateScenarioCoherence,
  type ScenarioCoherenceReason,
} from "./scenarioCoherence.js";
import {
  PREMISE_STYLE_DEFS,
  type PremiseStyleId,
} from "./patternIdeator.js";
import type { PremiseCore } from "./premiseCoreLibrary.js";
import type { CandidateMeta } from "./ideaScorer.js";
import type { VoiceCluster } from "./voiceClusters.js";
import type { CanonicalDomain } from "./coreDomainAnchorCatalog.js";
import {
  FAMILY_ACTIONS,
  resolveAnchorAwareAction,
  resolveSceneSafeAction,
} from "./coreDomainAnchorCatalog.js";
import { computeScenarioFingerprint } from "./scenarioFingerprint.js";
import {
  selectAuthoredPlan,
  ABSTRACT_ANCHORS,
  ABSTRACT_TO_CONCRETE_PROP,
  type AuthoredScenarioPlan,
} from "./authoredScenarioPlans.js";
import { decorateForRegion } from "./regionProfile.js";
import type { Region } from "@workspace/lumina-trends";

// ---------------------------------------------------------------- //
// Public types                                                      //
// ---------------------------------------------------------------- //

export type CohesiveAuthorRejectionReason =
  | ComedyRejectionReason
  | "schema_invalid"
  | "construction_failed"
  // PHASE UX3 — scenario coherence guard reasons. Pure additive
  // overlay onto the existing rejection-reason union; the recipe
  // loop in `coreCandidateGenerator` rolls these into the same
  // per-reason counter map (`stats.rejectionReasons`) it already
  // uses for `validateComedy` / `validateAntiCopy` rejections.
  | ScenarioCoherenceReason;

export type CohesiveAuthorInput = {
  core: PremiseCore;
  domain: CanonicalDomain;
  anchor: string;
  action: string;
  voice: VoiceCluster;
  regenerateSalt: number;
  /** Optional anti-copy context. When supplied, threaded into
   *  `validateAntiCopy` (premise dedup) — the seed-hook check is
   *  always applied via `loadSeedHookFingerprints()` upstream. */
  recentPremises?: ReadonlySet<string>;
  /** Pre-loaded seed-hook fingerprints (post-Y6 the gate uses
   *  Jaccard ≥ 0.85 on bigrams; the cache is still keyed on the
   *  set passed in). */
  seedFingerprints: ReadonlySet<string>;
  /** PHASE R1 — optional region for deterministic regional baseline
   *  decoration. When supplied AND not `"western"`, the
   *  `decorateForRegion` adapter appends light per-domain context
   *  to `caption`, `howToFilm`, and `whyItWorks` AFTER all
   *  validators have already passed on the BASE idea (so decoration
   *  cannot CAUSE a rejection). Western and undefined both
   *  short-circuit to identity — pre-R1 baseline is byte-identical
   *  on those paths. See `regionProfile.ts` for the safety
   *  contract decoration text is hand-vetted against. */
  region?: Region;
};

export type CohesiveAuthorResult =
  | {
      ok: true;
      idea: Idea;
      meta: CandidateMeta;
      scenarioFingerprint: string;
      /** PHASE D15-alt — surfaces a `style_defs_self` self-recipe
       *  exemption event so the recipe loop can roll it under the
       *  new bySource bucket. Only populated when the unigram-
       *  fallback gate detected a match against the candidate's
       *  ORIGINATING execution example and passed it through
       *  (reason: null + source: "style_defs_self"). For genuine
       *  passes (no gate fired) this stays undefined. */
      antiCopyMatch?: AntiCopyMatch;
    }
  | {
      ok: false;
      reason: CohesiveAuthorRejectionReason;
      /** PHASE D4 — reject-source telemetry. Only populated when
       *  `reason === "copied_seed_hook"`. Identifies which seed
       *  reference pool (`corpus` vs `style_defs`) the matched
       *  seed came from, plus its stable hash + the Jaccard score
       *  + which gate fired. Pure additive overlay — every other
       *  rejection reason omits it. Consumed by
       *  `coreCandidateGenerator`'s recipe loop to roll up per-
       *  source counts on `stats.antiCopyRejects`. */
      antiCopyMatch?: AntiCopyMatch;
    };

// ---------------------------------------------------------------- //
// Family → Idea axis maps (moved here from coreCandidateGenerator   //
// — the cohesive author owns the family→axis derivation now)        //
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

const DOMAIN_TRIGGER_CATEGORY: Record<
  CanonicalDomain,
  Idea["triggerCategory"]
> = {
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
// Deterministic helpers                                             //
// ---------------------------------------------------------------- //

function djb2(s: string): number {
  let h = 5381 | 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function pickIndex(salt: number, key: string, length: number): number {
  if (length <= 0) return 0;
  return djb2(`${salt}|${key}`) % length;
}

function capWords(s: string, maxWords: number): string {
  const parts = s.trim().split(/\s+/);
  if (parts.length <= maxWords) return s.trim();
  return parts.slice(0, maxWords).join(" ");
}

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s[0]!.toUpperCase() + s.slice(1);
}

function humanize(s: string): string {
  return s.replace(/_/g, " ");
}

function pastTense(verb: string): string {
  // Allow callers to pass the (already-conjugated) family-action past
  // form; idempotent if it already ends in -ed.
  if (verb.endsWith("ed")) return verb;
  if (verb.endsWith("e")) return verb + "d";
  if (/[^aeiou]y$/.test(verb)) return verb.slice(0, -1) + "ied";
  return verb + "ed";
}

function ingForm(verb: string): string {
  if (verb.endsWith("ing")) return verb;
  if (verb.endsWith("e") && !verb.endsWith("ee")) {
    return verb.slice(0, -1) + "ing";
  }
  return verb + "ing";
}

function pickTemplateHint(
  salt: number,
  key: string,
): Idea["templateHint"] {
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

// ---------------------------------------------------------------- //
// Hook template substitution                                        //
// ---------------------------------------------------------------- //

type SubVars = {
  anchor: string;
  action: string;
  actionPast: string;
  ingForm: string;
  mechanism: string;
  contradiction: string;
};

function substitute(template: string, vars: SubVars): string {
  return template.replace(/\$\{(\w+)\}/g, (_, k) => {
    const v = (vars as Record<string, string>)[k];
    return typeof v === "string" ? v : "";
  });
}

/** PHASE Y6 (extracted Y7) — terminal-position contradiction-beat
 *  detector. Returns true iff the FINAL sentence (split on `.!?`)
 *  of the lower-cased show contains either the action verb's bare
 *  or past form via WORD-BOUNDARY regex. Word-boundary (vs raw
 *  substring) avoids the `lie` ↔ `lies`/`belief` false-positive
 *  class the Y6 architect-fix flagged. Final-sentence (vs anywhere
 *  in the show) preserves the "ends on the contradiction" semantic
 *  the cohesive author relies on. Exported for unit testing — the
 *  authoring function is the only production caller.
 *
 *  - showLc: lower-cased whatToShow text
 *  - actionBare / actionPast: catalog action verb + past-tense form
 *    (raw, NOT escaped — function escapes them internally) */
export function showEndsOnContradiction(
  showLc: string,
  actionBare: string,
  actionPast: string,
): boolean {
  const parts = showLc.split(/[.!?]/).map((p) => p.trim()).filter(Boolean);
  const lastSegment = parts[parts.length - 1] ?? showLc;
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const actionPastBoundary = new RegExp(`\\b${escape(actionPast)}\\b`);
  const actionBareBoundary = new RegExp(`\\b${escape(actionBare)}\\b`);
  return (
    actionPastBoundary.test(lastSegment) || actionBareBoundary.test(lastSegment)
  );
}

// ---------------------------------------------------------------- //
// Core authoring function                                           //
// ---------------------------------------------------------------- //

export function authorCohesiveIdea(
  input: CohesiveAuthorInput,
): CohesiveAuthorResult {
  const { core, domain, anchor, voice, regenerateSalt, seedFingerprints } =
    input;

  // Family-action provides authoritative past + ing forms. The
  // input.action override (if non-empty and different) wins for the
  // bare verb but we still derive past/ing through the helpers so
  // the substitution table stays internally consistent.
  //
  // PHASE UX3.1 — Anchor-aware verb override. Stiff family verbs
  // (abandon/ghost/spiral/fake) get swapped to a fitting per-anchor
  // verb when the (verb, anchor) pair is implausible. Eliminates
  // "abandon the fork", "ghost the calendar", "spiral the
  // lockscreen" classes of nonsense at render time. The swap fires
  // BEFORE the SubVars table is built so every downstream
  // substitution (hook, show, film, shotPlan, trigger, reaction,
  // caption, whyItWorks, script) uses the swapped verb consistently.
  const rawFamAction = FAMILY_ACTIONS[core.family];
  const famAction = resolveAnchorAwareAction(rawFamAction, anchor);
  // PHASE UX3.1 — bug fix: previously `input.action || famAction.bare`
  // always lost the anchor-aware swap because every production caller
  // (recipe loop, QA harness, tests) threads the catalog row's
  // `exampleAction` through `input.action` — and that field is hard-
  // wired to `FAMILY_ACTIONS[family].bare` (i.e. the RAW family verb).
  // Result: the swap fired in `famAction` but was immediately discarded
  // because `input.action === rawFamAction.bare` truthy-overrode it.
  // Fix: only treat `input.action` as an explicit override when the
  // caller passed something OTHER than the raw family verb. The default
  // path now flows the swapped verb through to the SubVars table so
  // every downstream surface (hook, show, film, shotPlan, trigger,
  // reaction, caption, script, premise, whyItWorks) sees `dodge` /
  // `snooze` / `drop` / `raid` instead of `abandon` / `ghost` / etc.
  const rawFamilyBareLc = rawFamAction.bare.toLowerCase();
  const callerOverrideLc = (input.action ?? "").toLowerCase();
  const isExplicitOverride =
    callerOverrideLc !== "" && callerOverrideLc !== rawFamilyBareLc;
  const actionBare = isExplicitOverride
    ? callerOverrideLc
    : famAction.bare.toLowerCase();
  const actionPast = isExplicitOverride
    ? pastTense(actionBare)
    : famAction.past;
  const actionIng = isExplicitOverride
    ? ingForm(actionBare)
    : famAction.ing;
  const anchorLc = anchor.toLowerCase();

  // PHASE UX3.3 (rev-4) — scene-side action. The hook templates can
  // use the family verb metaphorically when (verb, anchor) is in the
  // `VERB_ANCHOR_PLAUSIBLE` whitelist ("still ghosting the app",
  // "fake the selfie one more time"). But scene templates render
  // those same verbs as imperative directorial copy ("then ghost it",
  // "fake the selfie in one clear gesture", "perform the gift") which
  // is unfilmable. `resolveSceneSafeAction` ALWAYS swaps stiff family
  // verbs to a fallback regardless of whitelist, so scene-side
  // surfaces (premise/howToFilm/shotPlan/trigger/reaction/caption/
  // whyItWorks/script) never leak the family verb. Hook substitution
  // continues to use the whitelist-aware action via `subs` above.
  const sceneAction = isExplicitOverride
    ? { bare: actionBare, past: actionPast, ing: actionIng }
    : resolveSceneSafeAction(rawFamAction, anchorLc);
  const sceneActionBare = sceneAction.bare.toLowerCase();
  const sceneActionPast = sceneAction.past;
  const sceneActionIng = sceneAction.ing;

  const subs: SubVars = {
    anchor: anchorLc,
    action: actionBare,
    actionPast,
    ingForm: actionIng,
    mechanism: humanize(core.mechanism),
    contradiction: `${actionPast} the ${anchorLc}`,
  };

  // ---- 1. Hook --------------------------------------------------- //
  // PHASE D3 — pure template-substitution path (D2 corpus-draw
  // branch reverted). The user's 159-hook blessed corpus is now a
  // VOICE TRAINING REFERENCE only — fed into the seed-bigram set
  // consumed by `validateAntiCopy`'s Jaccard near-verbatim gate (so
  // generated hooks must stay in the corpus's voice without copying
  // it verbatim) and into the per-cluster `seedHookExemplars` pool
  // expansion in `voiceClusters.ts`. No corpus hook is ever shipped
  // as the rendered idea's hook field.
  const tplIdx = pickIndex(
    regenerateSalt,
    `${core.id}|${anchor}|${voice.id}|tpl`,
    voice.hookTemplates.length,
  );
  const tpl = voice.hookTemplates[tplIdx]!;
  const hookRaw = substitute(tpl, subs);
  const hookCapped = capWords(hookRaw, voice.lengthTargetWords[1]);
  const hook = hookCapped;
  const hookLower = hook.toLowerCase();

  // ---- 2. premise ------------------------------------------------ //
  // Stitches (tension, anchor, action, mechanism, domain) through
  // core.generatorRule so the alignment edge `premise→hook` shares
  // ≥1 token (anchorLc appears in both). Capped 240 chars by schema.
  // PHASE Z5.5 — premise uses core.tension instead of humanize(core.mechanism)
  // to avoid word-salad like "shop chef eat student" leaking into the premise.
  const premise = capChars(
    `${capitalize(core.tension)} — the ${anchorLc} beat lands when i ${sceneActionBare} it (${humanize(domain)}).`,
    240,
  );

  // ---- 3. whatToShow / howToFilm / shotPlan / trigger / reaction //
  //         / caption — AUTHORED PLAN PATH (PHASE UX3.2)            //
  // ---------------------------------------------------------------- //
  // PHASE UX3.2 — Authored Scenario Planner. For the 10 high-
  // frequency anchors (inbox, alarm, calendar, fridge, highlighter,
  // gym, tab, profile, junk, mirror) the cohesive author renders
  // the scene from a hand-curated plan instead of stitching the
  // generic shape templates. The plan supplies pre-rendered
  // whatToShow / howToFilm / shotPlan / trigger / reaction /
  // caption surfaces and the construction precondition's END-ON-
  // VERB check is bypassed (the plan's payoff IS the curated
  // contradiction beat — it's quality-controlled by hand, not
  // shape-stitched).
  //
  // For abstract anchors NOT in the authored set (thread, tasks,
  // rsvp, doc, yoga, swipe, bio, app, draft, syllabus,
  // flashcards, wallpaper, lockscreen) the author falls back to
  // the generic show/film templates BUT swaps the bare anchor
  // for a concrete-prop phrase from `ABSTRACT_TO_CONCRETE_PROP`
  // so the templates' physical "set down / pick up" verbs apply
  // to a real shootable object instead of an abstraction.
  const authoredPlan: AuthoredScenarioPlan | null =
    selectAuthoredPlan(anchorLc);

  let whatToShow: string;
  let howToFilm: string;
  let shotPlan: string[];
  let trigger: string;
  let reaction: string;
  let caption: string;

  if (authoredPlan) {
    // ── Authored path ─────────────────────────────────────────── //
    // Plan surfaces are byte-for-byte rendered (no templating);
    // variants are picked by djb2 so the same plan re-used across
    // cores still varies trigger/reaction/caption between batches.
    const trigIdx =
      djb2(`${core.id}|${anchor}|trg`) % authoredPlan.triggerVariants.length;
    const reactIdx =
      djb2(`${core.id}|${anchor}|rxn`) % authoredPlan.reactionVariants.length;
    const capIdx =
      djb2(`${core.id}|${anchor}|cap`) % authoredPlan.captionVariants.length;
    whatToShow = capChars(authoredPlan.whatToShow, 500);
    howToFilm = capChars(authoredPlan.howToFilm, 400);
    shotPlan = [
      authoredPlan.shotPlan[0],
      authoredPlan.shotPlan[1],
      authoredPlan.shotPlan[2],
    ];
    trigger = capChars(authoredPlan.triggerVariants[trigIdx]!, 140);
    reaction = capChars(authoredPlan.reactionVariants[reactIdx]!, 140);
    caption = capChars(authoredPlan.captionVariants[capIdx]!, 140);
  } else {
    // ── Generic path (with abstract-anchor prop substitution) ──── //
    // For abstract anchors with no plan, render the showShapes /
    // filmShapes templates against a CONCRETE PROP phrase that
    // CONTAINS the anchor token (so showContainsAnchor /
    // filmContainsAnchor preconditions still hold) instead of
    // substituting the bare abstract noun directly.
    const isAbstract = ABSTRACT_ANCHORS.has(anchorLc);
    const renderNoun = isAbstract
      ? (ABSTRACT_TO_CONCRETE_PROP[anchorLc] ?? anchorLc)
      : anchorLc;

    // PHASE D1 — Pre-D1 was ONE deterministic template per recipe,
    // producing identical sentence shapes across batches. Now: a
    // 4-shape pool rotated by djb2(`${core.id}|${anchor}|wts`).
    // PHASE UX3.1 — full template rewrite to drop stiffness
    // vocabulary. Each shape preserves the construction
    // precondition (contains anchorLc AND ends on the
    // contradiction beat).
    // PHASE UX3.2 — abstract anchors render against a concrete
    // prop ("phone open to the inbox") instead of the bare
    // abstract noun ("the inbox") so "set the X down" / "pick the
    // X up" templates land on shootable objects.
    // PHASE UX3.3 — REMOVED three weak shapes from the original
    // 4-shape pool:
    //   - "Beat 1: glance / Beat 2: shrug / Beat 3: i ${ap} the X"
    //     was the canonical placeholder filler the directive flagged
    //     and is also already caught by `meta_template_signature` in
    //     `scenarioCoherence` — every attempt was wasted retries.
    //   - "Step in, pick the X up, put it back. One more beat — then
    //     ${ab} the X for real this time" was the canonical "fake
    //     gesture" pattern, also caught by `meta_template_signature`
    //     — every attempt was wasted retries.
    //   - "Phone propped low so the X dominates the foreground. You
    //     enter behind it, hesitate, and ${ab} the X — end on your
    //     face mid-realization" was NOT caught by the validator but
    //     UX3.2 live QA hand-grade showed it shipped weak content
    //     (e.g. "freeze the thumb", "expose the sink", "ignore the
    //     wallpaper", "close the wallet") because the "hesitate /
    //     end on your face" filler is template scaffolding, not a
    //     real shootable beat.
    // Replaced with three concrete-action shapes so generic ideas
    // still have variety; each shape is a real physical sequence
    // with no scaffolding language.
    const showShapes: ReadonlyArray<
      (n: string, ab: string, ap: string) => string
    > = [
      (n, ab, _ap) =>
        `Set the ${n} down where the camera can see it. Sit beside it for a second like you're thinking. Then ${ab} the ${anchorLc} and walk out of frame.`,
      // PHASE UX3.3 — Place + negotiate. Concrete physical setup,
      // works for wallet / dumbbell / fork / phone-prop class.
      (n, ab, _ap) =>
        `Place the ${n} on the table in front of you. Sit across from it for one full beat like you're negotiating with it. Then ${ab} the ${anchorLc} anyway.`,
      // PHASE UX3.3 — Walk past + return. Concrete movement,
      // works for fixed-environment anchors (wallpaper / mirror /
      // sink / mail / dishes / lamp class).
      (n, ab, _ap) =>
        `Walk past the ${n} once without looking. Stop. Walk back. ${ab.charAt(0).toUpperCase() + ab.slice(1)} the ${anchorLc} this time — single take, no music.`,
      // PHASE UX3.3 — Catch yourself reaching. Concrete micro-
      // gesture, works broadly for any object you'd touch.
      (n, ab, _ap) =>
        `Catch yourself reaching for the ${n}. Pull your hand back like it bit you. One beat. Then ${ab} the ${anchorLc} anyway because of course you do.`,
    ];
    const showIdx =
      djb2(`${core.id}|${anchor}|wts`) % showShapes.length;
    whatToShow = capChars(
      showShapes[showIdx]!(renderNoun, sceneActionBare, sceneActionPast),
      500,
    );

    const filmShapes: ReadonlyArray<(n: string, ab: string) => string> = [
      (n, ab) =>
        `Phone propped chest height, single take. Keep yourself and the ${n} in the same frame the whole time. Cut the second you ${ab} the ${anchorLc}.`,
      (n, ab) =>
        `Counter-height shelf shot, one continuous take. The ${n} stays visible from start to finish. The moment you ${ab} the ${anchorLc} is the cut.`,
      (n, ab) =>
        `Wide-ish framing — the ${n} sits in the lower third. No edits. Walk in, do the ${ab} beat on the ${anchorLc} once, then leave the frame.`,
      (n, ab) =>
        `Locked-off on tripod or shelf, the ${n} always in shot. Step in, ${ab} the ${anchorLc} on the beat, step out — single take, no music.`,
    ];
    const filmIdx =
      djb2(`${core.id}|${anchor}|htf`) % filmShapes.length;
    howToFilm = capChars(
      filmShapes[filmIdx]!(renderNoun, sceneActionBare),
      400,
    );

    // shotPlan beat 3 pool (PHASE UX3.1 cleaned).
    const shotPlanBeat3: ReadonlyArray<(a: string) => string> = [
      (a) => `Hold: let the ${a} sit in frame one more beat, no reaction.`,
      (a) => `Hold: look at the ${a}, nod once like you accept this, then cut.`,
      (a) => `Hold: slow blink at the ${a}, then walk out of frame.`,
      (a) => `Hold: stare at the ${a} like it owes you money, then cut.`,
      (a) => `Hold: close your eyes for a second, exhale, then cut.`,
      (a) => `Hold: rest your hand on the ${a}, sigh once, then cut.`,
    ];
    const beat3Idx = djb2(`${core.id}|${anchor}|sp3`) % shotPlanBeat3.length;
    shotPlan = [
      `Wide-ish: enter the frame with the ${renderNoun} visible.`,
      `Medium: ${sceneActionBare} the ${anchorLc} in one clear gesture.`,
      shotPlanBeat3[beat3Idx]!(anchorLc),
    ];

    // PHASE UX3.1 — trigger pool (filmable verbs).
    const triggerShapes: ReadonlyArray<(a: string, ab: string) => string> = [
      (a, _ab) => `Show the ${a} on camera, out loud, in one clear beat.`,
      (a, ab) =>
        `${ab.charAt(0).toUpperCase() + ab.slice(1)} the ${a} in one visible motion.`,
      (a, ab) => `Open on the ${a}, then ${ab} it without hesitation.`,
      (a, ab) => `Frame the ${a}, pause for a beat, then ${ab} it.`,
      (a, ab) => `Let the ${a} sit in frame for one second before you ${ab} it.`,
      (a, ab) => `Walk up to the ${a} and ${ab} it like nothing happened.`,
    ];
    const trigIdx = djb2(`${core.id}|${anchor}|trg`) % triggerShapes.length;
    trigger = capChars(triggerShapes[trigIdx]!(anchorLc, sceneActionBare), 140);

    // PHASE Z5.5 — rotating reaction pool.
    const reactionShapes: ReadonlyArray<(a: string) => string> = [
      (a) => `Close the laptop gently like the ${a} hurt your feelings.`,
      (a) => `Lower the phone like the ${a} betrayed you personally.`,
      (a) => `Freeze mid-action while the ${a} realization loads.`,
      (a) => `Walk away from the ${a} with fake dignity.`,
      (a) => `Pretend to check your phone to survive the ${a} moment.`,
      (a) => `Put the ${a} back and act like nothing happened.`,
      (a) => `Sit down slowly and accept the ${a} consequences.`,
      (a) => `Stare at the ${a} like it is legally binding.`,
      (a) => `Nod once at the ${a} like you expected this betrayal.`,
      (a) => `Blink twice at the ${a}, then carry on like a professional.`,
    ];
    const reactIdx = djb2(`${core.id}|${anchor}|rxn`) % reactionShapes.length;
    reaction = capChars(reactionShapes[reactIdx]!(anchorLc), 140);

    // PHASE D1/Z5.5 — caption pool.
    const captionShapes: ReadonlyArray<
      (a: string, ap: string, d: string) => string
    > = [
      (a, ap, d) => `the ${a} thing again. ${ap} it. fine probably. ${d}.`,
      (a, ap, d) => `${ap} the ${a}. lying about it now. ${d}, basically.`,
      (a, ap, d) => `the ${a} won. ${d} update: i'm pretending it didn't.`,
      (a, ap, d) => `me + ${a} = unresolved. ${d} edition. send help maybe.`,
      (a, ap, d) =>
        `${ap} the ${a} and immediately regretted it. ${d} moment.`,
      (a, ap, d) => `${a} 1, me 0. ${d} scoreboard is not great.`,
      (a, ap, d) =>
        `tried to ignore the ${a}. the ${a} did not ignore me. ${d}.`,
      (a, ap, d) =>
        `just ${ap} the ${a} like that was a normal thing to do. ${d} era.`,
      (a, ap, d) => `the ${a} situation is evolving. i am not. ${d} report.`,
      (a, ap, d) => `committed to the ${a}. commitment lasted 4 seconds. ${d}.`,
    ];
    const capIdx = djb2(`${core.id}|${anchor}|cap`) % captionShapes.length;
    caption = capChars(
      captionShapes[capIdx]!(anchorLc, sceneActionPast, humanize(domain)),
      140,
    );
  }

  // ---- 7. whyItWorks -------------------------------------------- //
  // PHASE D1 — 4 shape rotation. Each preserves the (mechanism,
  // anchor, action, voice) signal so the field still reads as
  // authored from the recipe rather than as a stock bullet list.
  // PHASE Z5.5 — whyItWorks uses core.tension instead of humanize(core.mechanism)
  const whyShapes: ReadonlyArray<
    (m: string, a: string, ab: string, v: string) => string
  > = [
    (m, a, ab, v) => `${m} → I ${ab} the ${a} → relatable contradiction in one beat (${v}).`,
    (m, a, ab, v) => `${v}: the ${a} is the real subject — ${ab.toLowerCase()}-then-look reframes ${m.toLowerCase()} as the joke.`,
    (m, a, ab, v) => `Lands because ${m.toLowerCase()} maps onto a tiny visible action (${ab} the ${a}) — recognition, not explanation. Voice: ${v}.`,
    (m, a, ab, v) => `${m} compresses into one beat: ${ab} the ${a}, hold, cut. The ${v} voice keeps it specific instead of generic.`,
  ];
  const whyIdx = djb2(`${core.id}|${anchor}|why`) % whyShapes.length;
  const whyItWorks = capChars(
    whyShapes[whyIdx]!(
      capitalize(core.tension),
      anchorLc,
      sceneActionBare,
      voice.id,
    ),
    280,
  );

  // ---- 9. script ------------------------------------------------ //
  // PHASE Z5.5 — LINE 3 uses core.tension (human-readable) instead of
  // core.mechanism (snake_case id). Pre-Z5.5 produced nonsensical
  // output like "Shop chef eat student" from humanize("shop_chef_eat_student").
  // PHASE UX3.3 (rev-4) — LINE 2 was shipping the literal template
  // metadata "show the ${anchorLc} that contradicts line 1." as
  // creative direction (e.g. "show the slippers that contradicts
  // line 1."). This is a placeholder, not a beat. Fix: derive LINE 2
  // from `shotPlan[1]` (the middle beat, already vetted by either
  // the authored plan or the scene-safe shape templates), stripped
  // of its leading "Medium:" / "Wide:" / "Close:" director label so
  // it reads as in-script direction. shotPlan[1] is always present
  // (both authored and generic paths emit a 3-beat plan).
  const cutawayBeat = (shotPlan[1] ?? "").replace(/^[A-Za-z][A-Za-z\-]*:\s*/, "");
  const script = capChars(
    `LINE 1: ${hook}\n` +
      `LINE 2 (beat / cutaway): ${cutawayBeat}\n` +
      `LINE 3 (caption / mouthed): ${capitalize(core.tension)}.`,
    800,
  );

  // ---- 10. premiseStyleId / executionId for traceability -------- //
  const premiseStyleId: PremiseStyleId | undefined =
    core.compatiblePremiseStyles[0];
  const styleDef = premiseStyleId
    ? PREMISE_STYLE_DEFS[premiseStyleId]
    : undefined;
  const executions = styleDef?.executions ?? [];
  const executionId = executions.length > 0 ? executions[0]!.id : "default";
  // PHASE D15-alt — compute the originating seed hash from the SAME
  // example string `loadSeedHookBigrams` hashes when it folds
  // PREMISE_STYLE_DEFS entries into the seed-bigram pool. Threaded
  // into the anti-copy meta so the unigram-fallback gate can
  // recognise a self-recipe match (4-token style_defs seed like
  // "the dishes won again" trips the 0.6 unigram bar against any
  // single-word substitution of itself) and exempt it instead of
  // counting it as plagiarism. Long-hook bigram gate stays in
  // force; only the short-hook unigram fallback honours the hash.
  const originatingExample =
    executions.length > 0 && typeof executions[0]!.example === "string"
      ? (executions[0]!.example as string)
      : undefined;
  const originatingSeedHash = originatingExample
    ? computeSeedHash(originatingExample)
    : undefined;

  // ---- 11. Assemble Idea + structural fields -------------------- //
  const draft: Idea = {
    pattern: FAMILY_PATTERN[core.family],
    hook,
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
    caption,
    templateHint: pickTemplateHint(regenerateSalt, `${core.id}|${anchor}`),
    contentType: "entertainment",
    videoLengthSec: 18,
    filmingTimeMin: 5,
    whyItWorks,
    payoffType: FAMILY_PAYOFF[core.family],
    hasContrast: true,
    hasVisualAction: true,
    visualHook: capChars(
      `Camera holds on the ${anchorLc} reveal as the contradiction lands.`,
      160,
    ),
    whatToShow,
    howToFilm,
    premise,
    premiseCoreId: core.id,
  };

  // ---- 12. Construction precondition ---------------------------- //
  // The whole point of cohesive authoring: hook ↔ whatToShow ↔
  // howToFilm MUST share the anchor literally, and whatToShow MUST
  // end on the contradiction beat (verb form of action). Surface a
  // construction failure rather than letting the comedy gate
  // discover it later.
  // PHASE UX3.2 — when the AUTHORED plan path rendered the show /
  // film / shotPlan, the END-ON-VERB check is bypassed. The
  // plan's payoff sentence IS the curated contradiction beat (e.g.
  // "Mute the alarm without sitting up. Stare at the ceiling.")
  // — quality-controlled by hand, not stitched from action verbs.
  // Anchor-presence checks still apply.
  const showLc = whatToShow.toLowerCase();
  const filmLc = howToFilm.toLowerCase();
  const hookLcContainsAnchor = hookLower.includes(anchorLc);
  const showContainsAnchor = showLc.includes(anchorLc);
  const filmContainsAnchor = filmLc.includes(anchorLc);
  const showEndsContradiction =
    authoredPlan !== null
      ? true
      : showEndsOnContradiction(showLc, actionBare, actionPast);
  if (
    !hookLcContainsAnchor ||
    !showContainsAnchor ||
    !filmContainsAnchor ||
    !showEndsContradiction
  ) {
    return { ok: false, reason: "construction_failed" };
  }

  // ---- 13. Schema parse ----------------------------------------- //
  const parsed = ideaSchema.safeParse(draft);
  if (!parsed.success) {
    return { ok: false, reason: "schema_invalid" };
  }

  // ---- 13b. Scenario coherence guard --------------------------- //
  // PHASE UX3 — defensive validators that catch failure modes the
  // construction precondition above can't see (template-language
  // leaks, hook↔show token absence, split-self temporal mismatch).
  // Pure / synchronous; reasons fold into the same per-reason
  // rejection telemetry consumed by the recipe loop above.
  const coherenceReason = validateScenarioCoherence(parsed.data);
  if (coherenceReason) return { ok: false, reason: coherenceReason };

  // ---- 14. Build meta ------------------------------------------- //
  // PHASE UX3.2 — `authoredPlanId` is the plan's domainId (e.g.
  // "inbox") when the authored plan path ran; absent when the
  // generic shape templates rendered. Telemetry-only — pipeline
  // never branches on it. Surfaces in qaTelemetry.perIdea so
  // ux32LiveQa.ts and the new authored_domain_used_generic_template
  // validator can verify which path each shipped core_native idea
  // took.
  const meta: CandidateMeta = {
    source: "core_native",
    usedBigPremise: true,
    premiseCoreId: core.id,
    ...(premiseStyleId ? { premiseStyleId } : {}),
    executionId,
    ...(authoredPlan ? { authoredPlanId: authoredPlan.domainId } : {}),
  };

  // ---- 15. Comedy + anti-copy gates ----------------------------- //
  const comedyReason = validateComedy(parsed.data, {
    source: meta.source,
    usedBigPremise: true,
  });
  if (comedyReason) return { ok: false, reason: comedyReason };

  // PHASE D4 — call the detailed variant so we can propagate
  // `antiCopyMatch` (source pool + seed hash + Jaccard + gate) up
  // to the recipe loop's per-source telemetry roll-up. Pure
  // additive — when the gate doesn't fire (`reason === null`) the
  // call shape is byte-identical to the back-compat path.
  // PHASE D15-alt — also pass `originatingSeedHash` so the
  // unigram-fallback gate can exempt a self-recipe match. When
  // exempt, the result carries `reason: null` AND a
  // `style_defs_self`-tagged antiCopyMatch for telemetry.
  const copyResult = validateAntiCopyDetailed(
    parsed.data,
    {
      source: meta.source,
      usedBigPremise: true,
      ...(originatingSeedHash ? { originatingSeedHash } : {}),
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

  // ---- 16. Scenario fingerprint --------------------------------- //
  const scenarioFingerprint = computeScenarioFingerprint({
    mechanism: core.mechanism,
    anchor: anchorLc,
    action: actionBare,
  });

  // ---- 17. PHASE R1 — regional baseline decoration -------------- //
  // Apply AFTER all validators (comedy / anti-copy / scenario
  // coherence) have already passed on the BASE idea above. The
  // adapter is a no-op for `region === "western"` and
  // `region === undefined`, so cold-start creators and the western
  // baseline are byte-identical to pre-R1 by construction.
  //
  // Decoration touches ONLY the three free-text fields with no
  // anchor / contradiction positional constraint downstream:
  // `caption`, `howToFilm`, `whyItWorks`. Hook / premise /
  // whatToShow / shotPlan / trigger / reaction are not touched, so
  // the construction precondition (anchor presence + end-on-
  // contradiction) and scenario fingerprint remain valid as
  // computed above.
  //
  // Defense in depth: re-run the scenarioCoherence guard against
  // the decorated idea so any future decoration regression is
  // caught at author time rather than shipping silently. The R1
  // copy in `regionProfile.ts` is hand-vetted against every active
  // rule, so the re-check is expected to pass; if it ever fires
  // we fail loud as a regression signal rather than degrading to
  // a silent ship of bad copy.
  const decoration = decorateForRegion({
    region: input.region,
    domain,
    caption: parsed.data.caption,
    howToFilm: parsed.data.howToFilm,
    whyItWorks: parsed.data.whyItWorks,
  });
  const decoratedIdea: Idea =
    decoration.decorated.length === 0
      ? parsed.data
      : {
          ...parsed.data,
          caption: decoration.caption,
          howToFilm: decoration.howToFilm,
          whyItWorks: decoration.whyItWorks,
        };
  if (decoration.decorated.length > 0) {
    const postDecorReason = validateScenarioCoherence(decoratedIdea);
    if (postDecorReason) {
      // Regression signal: a regionProfile.ts entry slipped past
      // hand-vetting and now trips a validator rule. Surface as a
      // standard rejection so the recipe loop tries another recipe
      // and the rejection is counted by reason in telemetry. This
      // path should NEVER fire in steady state.
      return { ok: false, reason: postDecorReason };
    }
  }

  return {
    ok: true,
    idea: decoratedIdea,
    meta,
    scenarioFingerprint,
    // PHASE D15-alt — surface the self-exemption event (if any)
    // on the ok:true path so the recipe loop can roll it under
    // the new `style_defs_self` bySource bucket without losing
    // visibility into how often the circularity fires. Genuine
    // passes (no gate triggered) still omit the field.
    ...(copyResult.antiCopyMatch
      ? { antiCopyMatch: copyResult.antiCopyMatch }
      : {}),
  };
}

// ---------------------------------------------------------------- //
// Length cap helper                                                 //
// ---------------------------------------------------------------- //

function capChars(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}
