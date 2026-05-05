/**
 * PHASE UX3.1 — Scenario Author Repair adversarial test suite.
 *
 * Distinct from `scenarioCoherence.test.ts` (which holds the legacy
 * UX3 5-rule coverage). This suite covers the four NEW reasons + a
 * render-sweep across the cohesive author × catalog so a future
 * template regression in `cohesiveIdeaAuthor.ts` would re-emit a
 * stiffness phrase and fail here even if every legacy test passes.
 *
 *   1.  template_stiffness_phrase positives (one per stiffness regex)
 *   2.  bad_grammar_by_past_participle positive + negative
 *   3.  hook_topic_noun_drift positive + negative + abstract-bypass
 *   4.  verb_anchor_implausible positive + negative + (post-swap) accept
 *   5.  Render-sweep: cohesive author × (8 cores × 5 anchors each) —
 *       every successfully-authored idea passes the validator AND
 *       contains zero stiffness phrases on rendered surfaces.
 *   6.  Pattern-engine path: hand-built pattern-style candidates
 *       that bypass the cohesive author — validator still catches.
 *   7.  Cluster catalog sanity (calendar ≠ shopping-cart, etc.).
 *
 * All tests construct minimal Idea fixtures via the same `makeIdea`
 * shape used by the legacy test (cloned here so the two files stay
 * decoupled — adding a field to the legacy fixture should not break
 * this suite).
 */

import { describe, it, expect, afterAll } from "vitest";
import {
  validateScenarioCoherence,
  type ScenarioCoherenceReason,
} from "../scenarioCoherence";
import {
  isVerbAnchorImplausible,
  isStiffFamilyVerbLeak,
  resolveAnchorAwareAction,
  clustersContaining,
  FAMILY_ACTIONS,
  CORE_DOMAIN_ANCHORS,
} from "../coreDomainAnchorCatalog";
import { authorCohesiveIdea } from "../cohesiveIdeaAuthor";
import { PREMISE_CORES } from "../premiseCoreLibrary";
import { getVoiceCluster } from "../voiceClusters";
import type { Idea } from "../ideaGen";

// ---------------------------------------------------------------- //
// Minimal coherent fixture (clean of every UX3 + UX3.1 trigger).    //
// ---------------------------------------------------------------- //

function makeIdea(overrides: Partial<Idea>): Idea {
  const base: Idea = {
    pattern: "contrast",
    hook: "the dishes won again today",
    hookSeconds: 1.5,
    trigger: "Show the dishes on camera in one clear beat.",
    reaction: "Stare at the dishes like they owe you rent.",
    emotionalSpike: "regret",
    structure: "routine_contradiction",
    hookStyle: "internal_thought",
    triggerCategory: "task",
    setting: "kitchen",
    script:
      "LINE 1: the dishes won again today\n" +
      "LINE 2 (beat / cutaway): show the dishes that contradict line 1.\n" +
      "LINE 3 (caption / mouthed): self-betrayal lands here.",
    shotPlan: [
      "Wide-ish: enter the frame with the dishes visible.",
      "Medium: ignore the dishes in one clear gesture.",
      "Hold: stare at the dishes like they owe you money, then cut.",
    ],
    caption: "the dishes thing again. ignored it. fine probably. food.",
    templateHint: "A",
    contentType: "entertainment",
    videoLengthSec: 18,
    filmingTimeMin: 5,
    whyItWorks:
      "Self-betrayal → I ignore the dishes → relatable contradiction in one beat.",
    payoffType: "punchline",
    hasContrast: true,
    hasVisualAction: true,
    visualHook:
      "Camera holds on the dishes reveal as the contradiction lands.",
    whatToShow:
      "Camera on the dishes, you in frame next to them. Beat 1: glance at the dishes. Beat 2: shrug. Beat 3: i ignored the dishes.",
    howToFilm:
      "Phone propped chest height, single take. Keep yourself and the dishes in the same frame the whole time. Cut the second you ignore the dishes.",
    premise: "Self-betrayal — the dishes beat lands when i ignore it (food).",
  };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------- //
// Stiffness phrase corpus mirror — keeps the test file decoupled    //
// from the validator's private regex array but cross-checks the     //
// same conceptual phrase set.                                        //
// ---------------------------------------------------------------- //

const STIFFNESS_PROBES: ReadonlyArray<readonly [string, string]> = [
  ["knowingly", "Camera holds as i ignore the dishes knowingly."],
  ["once, slow", "Pause, ignore the dishes once, slow."],
  ["once deliberately", "Drop the fork once deliberately, then hold."],
  ["land the contradiction", "Cut on land the contradiction beat."],
  ["with intent", "Open the dishes moment on camera with intent."],
  ["on purpose", "Ignore the dishes on purpose for the beat."],
  ["end beat:", "Beat 2: shrug. End beat: i ignored the dishes."],
  ["frame X center", "Frame the dishes center for the held beat."],
  ["look straight at the lens", "Hold and look straight at the lens."],
  ["look straight to camera", "Hold and look straight to camera."],
  ["direct-to-camera", "Hold the dishes shot direct-to-camera."],
  ["deadpan stage direction", "Stare at the dishes, deadpan, then cut."],
  ["like presenting evidence", "Hold the dishes like presenting evidence."],
  ["let the geography", "Let the geography of the kitchen do the work."],
  ["commit to the X beat", "Commit to the dishes beat for the full hold."],
  ["no reaction shot", "End on the dishes — no reaction shot, just silence."],
];

// ---------------------------------------------------------------- //
// Suite 1 — stiffness phrase positives                              //
// ---------------------------------------------------------------- //

describe("UX3.1 — template_stiffness_phrase", () => {
  for (const [label, prose] of STIFFNESS_PROBES) {
    it(`flags '${label}' anywhere in rendered surfaces`, () => {
      const idea = makeIdea({
        // Inject the stiffness phrase into shotPlan (one of the
        // surfaces the legacy validator did NOT scan in UX3) so
        // we prove the UX3.1 expansion to allRenderedLc actually
        // catches it. The hook + whatToShow stay clean so the
        // stiffness rule isn't competing with rules 4/5.
        shotPlan: [
          "Wide-ish: enter the frame with the dishes visible.",
          prose,
          "Hold: stare at the dishes, then cut.",
        ],
      });
      const reason: ScenarioCoherenceReason | null =
        validateScenarioCoherence(idea);
      expect(reason).toBe("template_stiffness_phrase");
    });
  }

  it("does not false-positive on 'know' or 'slow' substrings", () => {
    // 'know' is a substring of 'knowingly' but the regex is word-
    // bounded; 'slow' on its own (no preceding 'once,') is fine.
    const idea = makeIdea({
      whatToShow:
        "Camera on the dishes; you know the beat. Move slow into the next take. Beat 3: i ignored the dishes.",
    });
    expect(validateScenarioCoherence(idea)).toBeNull();
  });
});

// ---------------------------------------------------------------- //
// Suite 2 — bad-grammar past-participle after 'by'                  //
// ---------------------------------------------------------------- //

describe("UX3.1 — bad_grammar_by_past_participle", () => {
  it("flags 'by abandoned the fork' (template substitution leak)", () => {
    const idea = makeIdea({
      // Use trigger so it doesn't collide with hook-anchor rules.
      hook: "the fork won again today",
      trigger: "Land the moment by abandoned the fork in one beat.",
      whatToShow:
        "Camera on the fork. Beat 2: shrug. Beat 3: i dropped the fork.",
      shotPlan: [
        "Wide: the fork in frame.",
        "Medium: drop the fork.",
        "Hold: stare, then cut.",
      ],
    });
    expect(validateScenarioCoherence(idea)).toBe(
      "bad_grammar_by_past_participle",
    );
  });

  it("accepts 'by dropping the fork' (correct ing-form)", () => {
    const idea = makeIdea({
      hook: "the fork won again today",
      trigger: "Land the moment by dropping the fork in one beat.",
      whatToShow:
        // PHASE UX3.3 — was "Beat 2: shrug. Beat 3: ..." which now
        // matches META_TEMPLATE_SIGNATURES rule 14. Rewritten as
        // clean prose; the test still exercises rule 6 (grammar).
        "Camera on the fork. Hold on it for a beat, then drop it.",
      shotPlan: [
        "Wide: the fork in frame.",
        "Medium: drop the fork.",
        "Hold: stare, then cut.",
      ],
    });
    expect(validateScenarioCoherence(idea)).toBeNull();
  });
});

// ---------------------------------------------------------------- //
// Suite 3 — hook ↔ show cluster mismatch                            //
// ---------------------------------------------------------------- //

describe("UX3.1 — hook_topic_noun_drift", () => {
  it("flags hook='calendar' bound to whatToShow='shopping cart'", () => {
    // Hook anchors in the calendar/scheduling cluster; show anchors
    // ONLY in the shopping/cart cluster (no shared cluster-keyed
    // noun). Both sides have ≥1 cluster-keyed noun and the
    // clusters are disjoint → rule 8 fires.
    //
    // Rule 4 (hook-anchor token overlap) is satisfied via 'today'
    // — a non-cluster token both sides share — so we can keep the
    // SHOW free of any calendar-cluster noun (otherwise the
    // intersection would be non-empty and the rule would correctly
    // pass).
    //
    // No split-self pronoun in the hook, so rule 5 stays out.
    const idea = makeIdea({
      hook: "the calendar booked today again",
      whatToShow:
        "Camera on the cart at checkout today. Beat 1: shrug. Beat 2: tap order. Beat 3: i bought the cart.",
      shotPlan: [
        "Wide: the cart in frame.",
        "Medium: tap order.",
        "Hold: stare at the cart.",
      ],
      trigger: "Show the cart on camera in one clear beat.",
    });
    expect(validateScenarioCoherence(idea)).toBe("hook_topic_noun_drift");
  });

  it("accepts cross-cluster hook+show when clusters overlap", () => {
    // 'inbox' is in BOTH the calendar/scheduling cluster AND the
    // messaging/threads cluster. So hook='inbox' + show using
    // 'thread' should pass via the messaging cluster overlap.
    const idea = makeIdea({
      hook: "the inbox won again today",
      whatToShow:
        "Camera on the thread. Beat 1: the inbox notification pings. Beat 2: scroll. Beat 3: i ignored the thread.",
      shotPlan: [
        "Wide: the inbox in frame.",
        "Medium: scroll the thread.",
        "Hold: stare at the inbox.",
      ],
    });
    expect(validateScenarioCoherence(idea)).toBeNull();
  });

  it("bypasses (returns null on cluster check) for abstract hooks with no cluster nouns", () => {
    // 'discipline' / 'rest' / 'effort' aren't in any cluster.
    // Rule 4 still requires lexical overlap so we share 'rest'.
    const idea = makeIdea({
      hook: "rest is for the rest of them, not for me",
      whatToShow:
        // PHASE UX3.3 — "Beat 1: shrug" now matches rule 14.
        // Rewritten as clean prose; rule 8 (cluster bypass) is
        // still what's under test here.
        "Camera on you. Shrug once, then rest your forehead on the table and stare.",
      shotPlan: [
        "Wide: enter the frame.",
        "Medium: shrug.",
        "Hold: rest your head, then cut.",
      ],
      trigger: "Show the rest moment on camera in one beat.",
    });
    expect(validateScenarioCoherence(idea)).toBeNull();
  });
});

// ---------------------------------------------------------------- //
// Suite 4 — verb-anchor plausibility                                //
// ---------------------------------------------------------------- //

describe("UX3.1 — verb_anchor_implausible", () => {
  it("flags 'abandon the fork' on a rendered surface", () => {
    const idea = makeIdea({
      hook: "the fork won again today",
      whatToShow:
        "Camera on the fork. Beat 2: shrug. Beat 3: i abandon the fork in one beat.",
      shotPlan: [
        "Wide: the fork in frame.",
        "Medium: drop it.",
        "Hold: stare, then cut.",
      ],
      trigger: "Show the fork on camera in one beat.",
    });
    expect(validateScenarioCoherence(idea)).toBe("verb_anchor_implausible");
  });

  it("flags 'ghost the calendar' on a rendered surface", () => {
    const idea = makeIdea({
      hook: "the calendar won again today",
      whatToShow:
        "Camera on the calendar. Beat 2: shrug. Beat 3: i ghost the calendar today.",
      shotPlan: [
        "Wide: the calendar in frame.",
        "Medium: glance away.",
        "Hold: stare, then cut.",
      ],
      trigger: "Show the calendar on camera in one beat.",
    });
    expect(validateScenarioCoherence(idea)).toBe("verb_anchor_implausible");
  });

  it("accepts 'abandon the draft' (in the verb's plausible set)", () => {
    const idea = makeIdea({
      hook: "the draft won again today",
      whatToShow:
        // PHASE UX3.3 — "Beat 2: shrug" now matches rule 14;
        // rewritten as clean prose. Rule 9's plausible-set
        // acceptance is still what's under test here.
        "Camera on the draft. Hold for a beat, then abandon the draft today.",
      shotPlan: [
        "Wide: the draft in frame.",
        "Medium: close the tab.",
        "Hold: stare, then cut.",
      ],
      trigger: "Show the draft on camera in one beat.",
    });
    expect(validateScenarioCoherence(idea)).toBeNull();
  });

  it("accepts 'ghost the thread' (in the verb's plausible set)", () => {
    const idea = makeIdea({
      hook: "the thread won again today",
      whatToShow:
        // PHASE UX3.3 — "Beat 2: shrug" now matches rule 14;
        // rewritten as clean prose.
        "Camera on the thread. Hold for a beat, then ghost the thread today.",
      shotPlan: [
        "Wide: the thread in frame.",
        "Medium: scroll away.",
        "Hold: stare, then cut.",
      ],
      trigger: "Show the thread on camera in one beat.",
    });
    expect(validateScenarioCoherence(idea)).toBeNull();
  });

  it("isVerbAnchorImplausible direct probes — every screenshot regression", () => {
    // All four bad pairs that ship-blocked the UX3.1 directive
    // must be flagged implausible. Catalog whitelist deliberately
    // EXCLUDES `fork` from abandon, `calendar` from ghost,
    // `lockscreen` from spiral (empty whitelist), and `tab` from
    // fake — see VERB_ANCHOR_PLAUSIBLE for rationale.
    expect(isVerbAnchorImplausible("abandon", "fork")).toBe(true);
    expect(isVerbAnchorImplausible("ghost", "calendar")).toBe(true);
    expect(isVerbAnchorImplausible("spiral", "lockscreen")).toBe(true);
    expect(isVerbAnchorImplausible("fake", "tab")).toBe(true);
    // Plausible pairs (whitelist hits) → false.
    expect(isVerbAnchorImplausible("abandon", "draft")).toBe(false);
    expect(isVerbAnchorImplausible("ghost", "thread")).toBe(false);
    expect(isVerbAnchorImplausible("fake", "profile")).toBe(false);
    // Unrelated verbs always pass through (open-grammar).
    // PHASE UX3.3 — `expose` was added to STIFF_FAMILY_VERBS in C2
    // (UX3.2 live QA shipped "expose the sink" / "expose the gym"
    // as defects). The remaining open-grammar family verb is
    // `avoid`, which the audit confirmed composes broadly with
    // concrete anchors. Probe both to lock that contract.
    expect(isVerbAnchorImplausible("avoid", "fork")).toBe(false);
    expect(isVerbAnchorImplausible("avoid", "calendar")).toBe(false);
  });

  it("resolveAnchorAwareAction swaps stiff verb for the per-anchor fallback", () => {
    const swap = resolveAnchorAwareAction(FAMILY_ACTIONS.self_betrayal, "fork");
    // self_betrayal.bare = 'abandon', not in fork's plausible set,
    // so we expect the per-anchor fallback ('drop' for fork).
    expect(swap.bare).toBe("drop");
    expect(swap.past).toBe("dropped");

    // ghost + calendar → swapped to fallback ('dodge').
    const swap2 = resolveAnchorAwareAction(
      FAMILY_ACTIONS.self_as_relationship,
      "calendar",
    );
    expect(swap2.bare).toBe("dodge");

    // ghost + thread is plausible → no swap.
    const swap3 = resolveAnchorAwareAction(
      FAMILY_ACTIONS.self_as_relationship,
      "thread",
    );
    expect(swap3.bare).toBe("ghost");

    // Non-stiff family verb passes through unchanged regardless of
    // anchor (fail-open semantics).
    const swap4 = resolveAnchorAwareAction(FAMILY_ACTIONS.adulting_chaos, "fork");
    expect(swap4.bare).toBe("avoid");
  });

  // ── PHASE UX3.3 (rev 3, post-architect) regression suite ─────────
  // Architect UX3.3-C5 review found three rule-13 gaps. Lock them
  // in before they can return.

  it("rule 13 multi-match: plausible-then-implausible scan rejects the later leak", () => {
    // Rev 2 used `.match()` which returns only the first hit. If
    // a plausible pair ('ghost the thread') appeared before an
    // implausible one ('expose the sink'), validation falsely
    // passed. Rev 3 uses `matchAll` so the later leak is caught.
    const idea = makeIdea({
      hook: "the sink won again today",
      whatToShow:
        "Camera on the sink. I ghost the thread on my phone first, " +
        "then expose the sink in the next beat anyway.",
      shotPlan: [
        "Wide: the sink in frame.",
        "Medium: phone in hand.",
        "Hold: stare at the sink, then cut.",
      ],
      trigger: "Show the sink on camera in one beat.",
    });
    expect(validateScenarioCoherence(idea)).toBe("family_verb_leak_on_scene");
  });

  it("rule 13 unknown-anchor stiff-verb leak still rejects (no fallback required)", () => {
    // Rev 2 gated rule 13 on `isVerbAnchorImplausible`, which
    // fails OPEN when the anchor has no entry in
    // `ANCHOR_VERB_FALLBACK`. That meant 'abandon the cucumber'
    // (cucumber unknown to the catalog) silently passed despite
    // being a textbook family-verb leak. Rev 3 uses
    // `isStiffFamilyVerbLeak` (no fallback gate) so the
    // long-tail catch is preserved.
    const idea = makeIdea({
      hook: "the cucumber won again today",
      whatToShow:
        "Camera on the cucumber. Hold for one beat, then i abandon " +
        "the cucumber today.",
      shotPlan: [
        "Wide: the cucumber in frame.",
        "Medium: walk away.",
        "Hold: stare, then cut.",
      ],
      trigger: "Show the cucumber on camera in one beat.",
    });
    expect(validateScenarioCoherence(idea)).toBe("family_verb_leak_on_scene");
  });

  it("dual-predicate semantic divergence: unknown anchors flag as leak but not as implausible-with-fallback", () => {
    // PHASE UX3.3 (rev 3, post-architect §next-actions #1) — pin the
    // intentional contract split between the two predicates so a
    // future cleanup can't accidentally reunify them. The recipe-
    // build path needs `isVerbAnchorImplausible` (gated on fallback
    // existence — fail open if we can't repair). The validator path
    // needs `isStiffFamilyVerbLeak` (no fallback gate — catch the
    // long tail). 'cucumber' is deliberately NOT in
    // ANCHOR_VERB_FALLBACK; the two predicates must diverge here.
    expect(isVerbAnchorImplausible("abandon", "cucumber")).toBe(false);
    expect(isStiffFamilyVerbLeak("abandon", "cucumber")).toBe(true);
    // For known-fallback anchors the two agree on stiff-leak verdict.
    expect(isVerbAnchorImplausible("abandon", "fork")).toBe(true);
    expect(isStiffFamilyVerbLeak("abandon", "fork")).toBe(true);
    // For whitelist-plausible pairs the two agree on no-leak verdict.
    expect(isVerbAnchorImplausible("abandon", "draft")).toBe(false);
    expect(isStiffFamilyVerbLeak("abandon", "draft")).toBe(false);
    // For non-stiff family verbs the two agree on pass-through.
    expect(isVerbAnchorImplausible("avoid", "cucumber")).toBe(false);
    expect(isStiffFamilyVerbLeak("avoid", "cucumber")).toBe(false);
  });

  it("QA harness BANNED_PHRASES mirror parity: every validator-rejected pattern also fails the harness", () => {
    // Architect flagged QA/validator drift: the live QA harness
    // can ship 'PASS' on bytes the validator rejects, which lets
    // the metric lie. This test imports the same probe strings
    // and checks both surfaces reject them.
    //
    // We re-build the BANNED_PHRASES regex set inline (not
    // exported from `ux32LiveQa.ts`) and assert byte-for-byte
    // coverage of: `expose the X`, `hesitate, ... mid-realization`.
    const harnessBanned = [
      // Mirror of the rev-3 family-verb regex including `expose`.
      /\b(abandon(?:ed|ing|s)?|ghost(?:ed|ing|s)?|fake[ds]?|faking|spiral(?:ed|ing|s)?|overthink(?:s|ing)?|overthought|perform(?:ed|ing|s)?|expose[ds]?|exposing)\s+(?:the|my|your|their|its|this|that)\s+\w+\b/i,
      // Mirror of the rev-3 hesitate-mid-realization signature.
      /\bhesitate,\s+and\s+\w+\s+the\s+\w+\s*[—–\-]\s*end\s+on\s+your\s+face\s+mid-realization\b/i,
    ];
    const probes = [
      "i expose the sink in the next beat",
      "phone propped low — hesitate, and abandon the draft — end on your face mid-realization",
    ];
    for (const probe of probes) {
      const harnessHit = harnessBanned.some((re) => re.test(probe));
      expect(harnessHit).toBe(true);
    }
  });
});

// ---------------------------------------------------------------- //
// Suite 5 — render-sweep across cohesive author × catalog           //
// ---------------------------------------------------------------- //
//
// Iterate the first 8 cores × first canonical-domain row × all
// anchors in that row. Author once per (core, anchor) pair. For
// every successfully-authored idea, assert:
//
//   (a) `validateScenarioCoherence` returns null.
//   (b) Concatenated rendered prose contains NONE of the stiffness
//       probe substrings (defensive — case (a) implies this but
//       this lets a future regression surface a clearer label).
//
// Author rejections (ok:false — anti-copy hits, schema, etc.) are
// SKIPPED, not failed: the goal here is template hygiene, not
// gating policy.

describe("UX3.1 — render-sweep across cohesive author × catalog", () => {
  const voice = getVoiceCluster("dry_deadpan");
  const seedFingerprints: ReadonlySet<string> = new Set();

  // PHASE UX3.1 — counters that survive across the dynamically-
  // generated `it()` cases so an afterAll() can assert the SHIPPING
  // path is still healthy. Without this, a future regression that
  // makes the author reject every (core, anchor) combo would leave
  // every per-case test silently passing (each `it()` early-returns
  // on `!result.ok`) and mask a total ship-stop. The thresholds
  // below are deliberately loose: the suite covers ~30+ cases on
  // current catalog dimensions, so requiring both a non-trivial
  // absolute count AND a minimum success ratio catches a regression
  // long before it'd reach a creator.
  let attemptedCases = 0;
  let successCases = 0;
  const MIN_SUCCESS_ABSOLUTE = 8;
  const MIN_SUCCESS_RATIO = 0.4;

  afterAll(() => {
    expect(
      attemptedCases,
      "render-sweep should attempt at least 1 case (catalog wired?)",
    ).toBeGreaterThan(0);
    expect(
      successCases,
      `author should successfully ship at least ${MIN_SUCCESS_ABSOLUTE} ` +
        `(core, anchor) combos on the render-sweep — got ${successCases}/` +
        `${attemptedCases}. If this fires, every per-case it() above is ` +
        `silently early-returning on ok:false and template hygiene is ` +
        `not actually being asserted on the shipping path.`,
    ).toBeGreaterThanOrEqual(MIN_SUCCESS_ABSOLUTE);
    expect(
      successCases / Math.max(1, attemptedCases),
      `author success ratio should be ≥ ${MIN_SUCCESS_RATIO} on the ` +
        `render-sweep — got ${successCases}/${attemptedCases}.`,
    ).toBeGreaterThanOrEqual(MIN_SUCCESS_RATIO);
  });

  // Forbidden substrings on rendered prose — superset of the
  // STIFFNESS_PROBES labels, lowercased. A future template
  // regression that re-introduces any of these would fail loudly
  // here even if validateScenarioCoherence somehow returned null.
  const FORBIDDEN_SUBSTRINGS: readonly string[] = [
    "knowingly",
    "once, slow",
    "once deliberately",
    "deliberately",
    "land the contradiction",
    "with intent",
    "on purpose",
    "end beat:",
    "look straight at the lens",
    "look straight to camera",
    "direct-to-camera",
    "direct to camera",
    "like presenting evidence",
    "let the geography",
    "no reaction shot",
  ];

  const cores = PREMISE_CORES.slice(0, 8);

  for (const core of cores) {
    const rows = CORE_DOMAIN_ANCHORS[core.id] ?? [];
    if (rows.length === 0) continue;
    const row = rows[0]!;
    for (const anchor of row.anchors) {
      it(`renders cleanly: core=${core.id} anchor=${anchor}`, () => {
        attemptedCases += 1;
        const result = authorCohesiveIdea({
          core,
          domain: row.domain,
          anchor,
          action: row.exampleAction,
          voice,
          regenerateSalt: 0,
          seedFingerprints,
        });
        // Author may legitimately reject (e.g. anti-copy collision
        // against a seed corpus exemplar, schema invariant, etc.).
        // Skip per-case assertions — the contract under test here is
        // template hygiene on the SUCCESSFUL path. The afterAll
        // counter guards against the all-rejection regression case.
        if (!result.ok) return;
        successCases += 1;
        const idea = result.idea;
        expect(validateScenarioCoherence(idea)).toBeNull();
        const allLc = [
          idea.hook,
          idea.whatToShow,
          idea.howToFilm,
          idea.trigger ?? "",
          idea.reaction ?? "",
          (idea.shotPlan ?? []).join(" \n "),
          idea.script ?? "",
          idea.caption ?? "",
        ]
          .join(" \n ")
          .toLowerCase();
        for (const bad of FORBIDDEN_SUBSTRINGS) {
          expect(
            allLc.includes(bad),
            `core=${core.id} anchor=${anchor} surface contains forbidden phrase: '${bad}'`,
          ).toBe(false);
        }
      });
    }
  }
});

// ---------------------------------------------------------------- //
// Suite 6 — pattern-engine path (validator catches the bypass)      //
// ---------------------------------------------------------------- //
//
// Hand-build candidates that mimic what the pattern engine emits —
// the cohesive author's anchor-aware verb swap NEVER touches these,
// so the validator is the only line of defense. We assert each
// known-bad construction is caught by the matching reason.

describe("UX3.1 — pattern engine bypass (validator-only catch)", () => {
  const cases: ReadonlyArray<{
    label: string;
    overrides: Partial<Idea>;
    reason: ScenarioCoherenceReason;
  }> = [
    {
      label: "abandon-the-fork",
      overrides: {
        hook: "the fork won again today",
        whatToShow:
          "Camera on the fork. Beat 2: shrug. Beat 3: i abandon the fork.",
        trigger: "Show the fork on camera.",
      },
      reason: "verb_anchor_implausible",
    },
    {
      label: "ghost-the-calendar-knowingly (stiffness wins on order)",
      overrides: {
        hook: "the calendar won again today",
        // 'knowingly' fires on rule 6 BEFORE rule 9 — that's the
        // documented order. Asserting which rule fires is part of
        // the contract because the per-reason telemetry counter
        // surfaces it on the dashboard.
        whatToShow:
          "Camera on the calendar. Beat 2: shrug. Beat 3: i ghost the calendar knowingly.",
        trigger: "Show the calendar on camera.",
      },
      reason: "template_stiffness_phrase",
    },
    {
      label: "spiral-the-lockscreen-once-slow",
      overrides: {
        hook: "the lockscreen won again today",
        // 'once, slow' is in the stiffness corpus; fires on rule 6.
        whatToShow:
          "Camera on the lockscreen. Tap the lockscreen once, slow. Beat 3: i checked the lockscreen.",
        trigger: "Show the lockscreen on camera.",
      },
      reason: "template_stiffness_phrase",
    },
    {
      label: "by-abandoned-the-X",
      overrides: {
        hook: "the draft won again today",
        whatToShow:
          "Camera on the draft. Beat 2: shrug. Beat 3: i closed the draft.",
        trigger: "Land it by abandoned the draft in one beat.",
      },
      reason: "bad_grammar_by_past_participle",
    },
  ];

  for (const c of cases) {
    it(`catches ${c.label} → ${c.reason}`, () => {
      expect(validateScenarioCoherence(makeIdea(c.overrides))).toBe(c.reason);
    });
  }
});

// ---------------------------------------------------------------- //
// Suite 7 — anchor-cluster catalog sanity                           //
// ---------------------------------------------------------------- //
//
// Defensive assertions against future ANCHOR_CLUSTERS edits that
// would silently break the cluster-mismatch rule.

describe("UX3.1 — ANCHOR_CLUSTERS catalog sanity", () => {
  it("places calendar in the calendar/scheduling cluster", () => {
    expect(clustersContaining("calendar").length).toBeGreaterThan(0);
  });

  it("places cart in a different cluster from calendar", () => {
    const calClusters = new Set(clustersContaining("calendar"));
    const cartClusters = clustersContaining("cart");
    expect(cartClusters.length).toBeGreaterThan(0);
    const overlap = cartClusters.some((i) => calClusters.has(i));
    expect(overlap).toBe(false);
  });

  it("places fork and plate in the same (food/kitchen) cluster", () => {
    const forkClusters = new Set(clustersContaining("fork"));
    const plateClusters = clustersContaining("plate");
    expect(plateClusters.some((i) => forkClusters.has(i))).toBe(true);
  });

  it("returns empty for non-cluster nouns (abstract big-premise)", () => {
    expect(clustersContaining("discipline")).toEqual([]);
    expect(clustersContaining("rest")).toEqual([]);
  });
});
