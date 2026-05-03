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
  PREMISE_STYLE_DEFS,
  type PremiseStyleId,
} from "./patternIdeator.js";
import type { PremiseCore } from "./premiseCoreLibrary.js";
import type { CandidateMeta } from "./ideaScorer.js";
import type { VoiceCluster } from "./voiceClusters.js";
import type { CanonicalDomain } from "./coreDomainAnchorCatalog.js";
import { FAMILY_ACTIONS } from "./coreDomainAnchorCatalog.js";
import { computeScenarioFingerprint } from "./scenarioFingerprint.js";

// ---------------------------------------------------------------- //
// Public types                                                      //
// ---------------------------------------------------------------- //

export type CohesiveAuthorRejectionReason =
  | ComedyRejectionReason
  | "schema_invalid"
  | "construction_failed";

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
  const famAction = FAMILY_ACTIONS[core.family];
  const actionBare = (input.action || famAction.bare).toLowerCase();
  const actionPast =
    actionBare === famAction.bare ? famAction.past : pastTense(actionBare);
  const actionIng =
    actionBare === famAction.bare ? famAction.ing : ingForm(actionBare);
  const anchorLc = anchor.toLowerCase();

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
  const premise = capChars(
    `${capitalize(core.tension)} — the ${anchorLc} beat lands when i ${actionBare} it (${humanize(domain)}, ${humanize(core.mechanism)}).`,
    240,
  );

  // ---- 3. whatToShow -------------------------------------------- //
  // PHASE D1 — Pre-D1 was ONE deterministic template per recipe,
  // producing identical sentence shapes across batches (the
  // "Open with the X on screen. Camera holds as i Y..." that
  // appeared in the post-Y11 trash report). Now: a 4-shape pool
  // rotated by djb2(`${core.id}|${anchor}|wts`). Each shape
  // preserves the construction precondition (contains anchorLc
  // AND ends on the contradiction beat — see the validator below).
  const showShapes: ReadonlyArray<(a: string, ab: string, ap: string) => string> = [
    (a, ab, ap) =>
      `Open with the ${a} on screen. Camera holds as i ${ab} the ${a} knowingly. End beat: i ${ap} the ${a} and look straight to camera, deadpan.`,
    (a, ab, ap) =>
      `Wide on the ${a} — single static frame. Walk in, ${ab} the ${a} on purpose. Final beat: ${ap} the ${a}, no reaction shot, just the silence.`,
    (a, ab, ap) =>
      `Tight on the ${a} for a beat. Pull back as i ${ab} the ${a} deliberately. Cut hard the moment i ${ap} the ${a} — end on the held look.`,
    (a, ab, ap) =>
      `Hand-held into the ${a} scene. Pause, ${ab} the ${a} once, slow. Land the contradiction by ${ap} the ${a} on the final beat — direct to camera.`,
  ];
  const showIdx =
    djb2(`${core.id}|${anchor}|wts`) % showShapes.length;
  const whatToShow = capChars(showShapes[showIdx]!(anchorLc, actionBare, actionPast), 500);

  // ---- 4. howToFilm --------------------------------------------- //
  // PHASE D1 — same de-templating treatment. 4 phrasings rotated
  // by `${core.id}|${anchor}|htf`. Anchor still appears verbatim
  // so the construction precondition (filmContainsAnchor) holds.
  const filmShapes: ReadonlyArray<(a: string, ab: string) => string> = [
    (a, ab) =>
      `Phone propped chest height, single take. Frame yourself with the ${a} in shot. Hard cut on the ${ab} beat — keep both you and the ${a} in frame as the contradiction lands.`,
    (a, ab) =>
      `Camera at counter height, you and the ${a} in the same frame the whole take. Single shot, no music. The ${ab} gesture is the punchline — let the geography do the work.`,
    (a, ab) =>
      `Wide-ish, the ${a} occupies the lower-third of the frame. One take, no edits. ${ab.charAt(0).toUpperCase() + ab.slice(1)} the ${a} once, deliberately, then hold the look.`,
    (a, ab) =>
      `Locked-off on a tripod or shelf — frame so the ${a} is always visible. Walk in, ${ab} the ${a} on the beat, walk out without breaking the take.`,
  ];
  const filmIdx =
    djb2(`${core.id}|${anchor}|htf`) % filmShapes.length;
  const howToFilm = capChars(filmShapes[filmIdx]!(anchorLc, actionBare), 400);

  // ---- 5. shotPlan (3 beats keeps scoreFilmability max) --------- //
  const shotPlan: string[] = [
    `Wide-ish: enter the frame with the ${anchorLc} visible.`,
    `Medium: ${actionBare} the ${anchorLc} on camera, deliberately.`,
    `Hold: deadpan look at the ${anchorLc} reveal for one extra beat.`,
  ];

  // ---- 6. caption ----------------------------------------------- //
  // PHASE D1 — 4 caption shapes rotated by core/anchor djb2.
  // Same de-templating fix as whatToShow/howToFilm — pre-D1 the
  // single shape produced verbatim repetition across batches
  // (e.g. "the trick is to never look directly at the problem"
  // observed twice in the post-Y11 14-idea screenshot set).
  const captionShapes: ReadonlyArray<(a: string, ap: string, d: string) => string> = [
    (a, ap, d) => `the ${a} thing again. ${ap} it. fine probably. ${d}.`,
    (a, ap, d) => `${ap} the ${a}. lying about it now. ${d}, basically.`,
    (a, ap, d) => `the ${a} won. ${d} update: i'm pretending it didn't.`,
    (a, ap, d) => `me + ${a} = unresolved. ${d} edition. send help maybe.`,
  ];
  const capIdx = djb2(`${core.id}|${anchor}|cap`) % captionShapes.length;
  const caption = capChars(
    captionShapes[capIdx]!(anchorLc, actionPast, humanize(domain)),
    140,
  );

  // ---- 7. whyItWorks -------------------------------------------- //
  // PHASE D1 — 4 shape rotation. Each preserves the (mechanism,
  // anchor, action, voice) signal so the field still reads as
  // authored from the recipe rather than as a stock bullet list.
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
      capitalize(humanize(core.mechanism)),
      anchorLc,
      actionBare,
      voice.id,
    ),
    280,
  );

  // ---- 8. trigger / reaction (filmable verbs + visible response) //
  const trigger = capChars(
    `Open the ${anchorLc} moment on camera, deliberately and out loud.`,
    140,
  );
  const reaction = capChars(
    `Slow blink, half-laugh, then deadpan stare at the ${anchorLc} reveal.`,
    140,
  );

  // ---- 9. script ------------------------------------------------ //
  const script = capChars(
    `LINE 1: ${hook}\n` +
      `LINE 2 (beat / cutaway): show the ${anchorLc} that contradicts line 1.\n` +
      `LINE 3 (caption / mouthed): ${capitalize(humanize(core.mechanism))}.`,
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
  const showLc = whatToShow.toLowerCase();
  const filmLc = howToFilm.toLowerCase();
  const hookLcContainsAnchor = hookLower.includes(anchorLc);
  const showContainsAnchor = showLc.includes(anchorLc);
  const filmContainsAnchor = filmLc.includes(anchorLc);
  // Truly check the contradiction beat lives at the END of the
  // scene, not anywhere — extract the FINAL SENTENCE (split on
  // [.!?]) and look for the action verb there via word-boundary
  // regex. The previous version also cropped to the last 8 words
  // of that sentence, but the canonical end-beat template
  // (`End beat: i ${actionPast} the ${anchorLc} and look straight
  // to camera, deadpan.`) is 12 words and `${actionPast}` sits at
  // word 4 — the crop chopped the verb out and tripped
  // construction_failed for every candidate. Final-sentence
  // word-boundary is the correct semantic of "ends on the
  // contradiction" while still being terminal-position (not
  // anywhere in the show). Word-boundary rules out short-action
  // substring false positives (e.g. `lie` matching inside `lies`
  // / `belief`).
  const showEndsContradiction = showEndsOnContradiction(
    showLc,
    actionBare,
    actionPast,
  );
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

  // ---- 14. Build meta ------------------------------------------- //
  const meta: CandidateMeta = {
    source: "core_native",
    usedBigPremise: true,
    premiseCoreId: core.id,
    ...(premiseStyleId ? { premiseStyleId } : {}),
    executionId,
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

  return {
    ok: true,
    idea: parsed.data,
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
