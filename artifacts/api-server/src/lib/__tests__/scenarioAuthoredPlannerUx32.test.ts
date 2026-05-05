/**
 * PHASE UX3.2 — Authored Scenario Planner adversarial tests.
 *
 * Negative + positive coverage for the new authored-plan path,
 * the abstract-anchor prop substitution in the generic fallback,
 * the 3 new scenarioCoherence reasons, the comfortAdaptCopy
 * concrete-instruction overlay, and a render sweep across the 10
 * authored domains × representative families to prove zero banned
 * phrases / zero abstract+physical-verb pairs ship.
 *
 * No DB, no network, no mocks — pure validator + plan-library +
 * cohesive-author sweeps.
 */

import { describe, expect, it } from "vitest";

import {
  AUTHORED_DOMAIN_IDS,
  ABSTRACT_ANCHORS,
  ABSTRACT_TO_CONCRETE_PROP,
  getAllAuthoredPlans,
  getAuthoredAnchorSet,
  selectAuthoredPlan,
  type AuthoredScenarioPlan,
} from "../authoredScenarioPlans";
import { validateScenarioCoherence } from "../scenarioCoherence";
import type { Idea } from "../ideaGen";

// ---------------------------------------------------------------- //
// Helpers                                                          //
// ---------------------------------------------------------------- //

function makeIdea(over: Partial<Idea> = {}): Idea {
  const base: Idea = {
    pattern: "contrast",
    hook: "the inbox always wins",
    hookSeconds: 1.5,
    trigger: "Open the inbox.",
    reaction: "Close the laptop gently.",
    emotionalSpike: "regret",
    structure: "routine_contradiction",
    hookStyle: "internal_thought",
    triggerCategory: "phone_screen",
    setting: "desk",
    script: "LINE 1: hook.\nLINE 2: show.\nLINE 3: caption.",
    shotPlan: ["wide", "medium", "hold"],
    caption: "the inbox thing again.",
    templateHint: "A",
    contentType: "entertainment",
    videoLengthSec: 18,
    filmingTimeMin: 5,
    whyItWorks: "because the inbox is the joke.",
    payoffType: "punchline",
    hasContrast: true,
    hasVisualAction: true,
    visualHook: "Camera holds on the inbox reveal.",
    whatToShow: "Open the inbox. Hold on the unread count. Close the laptop.",
    howToFilm: "Phone propped, the inbox visible. One take.",
    premise: "the inbox is the contradiction",
    premiseCoreId: "core_test",
  };
  return { ...base, ...over };
}

// ---------------------------------------------------------------- //
// 1. Authored plan library — coverage + lookup                      //
// ---------------------------------------------------------------- //

describe("authoredScenarioPlans library", () => {
  it("exports all 10 expected domains", () => {
    expect(AUTHORED_DOMAIN_IDS).toEqual([
      "inbox",
      "alarm",
      "calendar",
      "fridge",
      "highlighter",
      "gym",
      "tab",
      "profile",
      "junk",
      "mirror",
    ]);
    expect(getAllAuthoredPlans()).toHaveLength(10);
  });

  it("each plan has all 4 surface slots populated (show/film/shotPlan/variants)", () => {
    for (const p of getAllAuthoredPlans()) {
      expect(p.whatToShow.length).toBeGreaterThan(40);
      expect(p.howToFilm.length).toBeGreaterThan(40);
      expect(p.shotPlan).toHaveLength(3);
      expect(p.shotPlan.every((s) => s.length > 8)).toBe(true);
      expect(p.triggerVariants.length).toBeGreaterThanOrEqual(3);
      expect(p.reactionVariants.length).toBeGreaterThanOrEqual(3);
      expect(p.captionVariants.length).toBeGreaterThanOrEqual(3);
      expect(p.comfortNotes.no_face.length).toBeGreaterThan(20);
      expect(p.comfortNotes.no_voice.length).toBeGreaterThan(20);
    }
  });

  it("selectAuthoredPlan returns the right plan for each canonical anchor", () => {
    const cases: Array<[string, AuthoredScenarioPlan["domainId"]]> = [
      ["inbox", "inbox"],
      ["alarm", "alarm"],
      ["calendar", "calendar"],
      ["fridge", "fridge"],
      ["highlighter", "highlighter"],
      ["gym", "gym"],
      ["tab", "tab"],
      ["profile", "profile"],
      ["junk", "junk"],
      ["mirror", "mirror"],
    ];
    for (const [anchor, expected] of cases) {
      const plan = selectAuthoredPlan(anchor);
      expect(plan, `expected plan for anchor ${anchor}`).not.toBeNull();
      expect(plan!.domainId).toBe(expected);
    }
  });

  it("selectAuthoredPlan returns null for an out-of-domain anchor", () => {
    expect(selectAuthoredPlan("fork")).toBeNull();
    expect(selectAuthoredPlan("toaster")).toBeNull();
    expect(selectAuthoredPlan("pillow")).toBeNull();
  });

  it("ABSTRACT_TO_CONCRETE_PROP swap exists for every abstract anchor", () => {
    for (const a of ABSTRACT_ANCHORS) {
      const swap = ABSTRACT_TO_CONCRETE_PROP[a];
      expect(swap, `abstract anchor ${a} missing concrete prop`).toBeDefined();
      expect(typeof swap).toBe("string");
      // Substitution must contain the original anchor token so
      // showContainsAnchor / filmContainsAnchor preconditions
      // still hold when the cohesive author swaps it in.
      expect(swap).toMatch(new RegExp(`\\b${a}\\b`));
    }
  });
});

// ---------------------------------------------------------------- //
// 2. Authored-domain content sanity                                 //
// ---------------------------------------------------------------- //

describe("authored plan content sanity", () => {
  it("alarm plan references snooze + (blanket OR pillow OR phone)", () => {
    const p = selectAuthoredPlan("alarm")!;
    const blob =
      `${p.whatToShow} ${p.howToFilm} ${p.shotPlan.join(" ")} ${p.triggerVariants.join(" ")} ${p.reactionVariants.join(" ")}`.toLowerCase();
    // Inflected — `snoozes` / `snoozed` both count.
    expect(blob).toMatch(/\bsnooze[ds]?\b/);
    expect(blob).toMatch(/\b(blanket|pillow|phone)\b/);
  });

  it("highlighter plan emits an over-highlight notes scene (not 'overthink the highlighter')", () => {
    const p = selectAuthoredPlan("highlighter")!;
    const blob = `${p.whatToShow} ${p.howToFilm} ${p.shotPlan.join(" ")}`.toLowerCase();
    expect(blob).toMatch(/\bnotes?\b|\bpage\b|\btextbook\b|\bbook\b/);
    expect(blob).not.toMatch(/\boverthink the highlighter\b/);
  });

  it("inbox plan never emits 'set down inbox' / 'dodge inbox' style copy", () => {
    const p = selectAuthoredPlan("inbox")!;
    const blob =
      `${p.whatToShow} ${p.howToFilm} ${p.shotPlan.join(" ")} ${p.triggerVariants.join(" ")} ${p.reactionVariants.join(" ")} ${p.captionVariants.join(" ")}`.toLowerCase();
    expect(blob).not.toMatch(/\bset (?:the )?inbox down\b/);
    expect(blob).not.toMatch(/\bdodge (?:the )?inbox\b/);
    expect(blob).not.toMatch(/\bpick (?:the )?inbox up\b/);
  });

  it("gym plan never emits 'pick up gym' / 'set down gym' copy", () => {
    const p = selectAuthoredPlan("gym")!;
    const blob =
      `${p.whatToShow} ${p.howToFilm} ${p.shotPlan.join(" ")} ${p.triggerVariants.join(" ")} ${p.reactionVariants.join(" ")} ${p.captionVariants.join(" ")}`.toLowerCase();
    expect(blob).not.toMatch(/\bpick (?:the )?gym up\b/);
    expect(blob).not.toMatch(/\bset (?:the )?gym down\b/);
    // Gym plan SHOULD reference shoes / door / sitting per spec.
    expect(blob).toMatch(/\b(shoe|shoes|door|sit|sitting|couch)\b/);
  });

  it("no authored plan contains a banned UX3.1 placeholder phrase", () => {
    const banned = [
      /\bprops carry the deadpan\b/,
      /\blean into the\s+\w+\s+beat\b/,
      /\bthe\s+\w+(?:\s+\w+)?\s+lands here\b/,
      /\blet the (?:contradiction|shift|reveal) (?:widen|breathe)\b/,
      /\bend beat\s*:/,
    ];
    for (const p of getAllAuthoredPlans()) {
      const blob =
        `${p.whatToShow} ${p.howToFilm} ${p.shotPlan.join(" ")} ${p.triggerVariants.join(" ")} ${p.reactionVariants.join(" ")} ${p.captionVariants.join(" ")} ${p.comfortNotes.no_face} ${p.comfortNotes.no_voice}`.toLowerCase();
      for (const re of banned) {
        expect(blob, `plan ${p.planId} contains banned phrase ${re}`).not.toMatch(
          re,
        );
      }
    }
  });
});

// ---------------------------------------------------------------- //
// 3. scenarioCoherence — new UX3.2 reasons                          //
// ---------------------------------------------------------------- //

describe("validateScenarioCoherence — UX3.2 reasons", () => {
  it("rejects 'set the inbox down' as impossible_physical_action_on_abstract", () => {
    const idea = makeIdea({
      hook: "the inbox is winning",
      whatToShow:
        "Open the laptop. set the inbox down for one beat. close the laptop.",
      howToFilm: "Phone propped, the inbox visible.",
    });
    expect(validateScenarioCoherence(idea)).toBe(
      "impossible_physical_action_on_abstract",
    );
  });

  it("rejects 'pick the gym up' as impossible_physical_action_on_abstract", () => {
    const idea = makeIdea({
      hook: "the gym is calling",
      whatToShow:
        "Walk to the door. pick the gym up like a backpack and head out.",
      howToFilm: "Locked-off shot of the door, the gym visible behind.",
    });
    expect(validateScenarioCoherence(idea)).toBe(
      "impossible_physical_action_on_abstract",
    );
  });

  it("rejects 'Lean into the panic beat — the reveal lands here' as placeholder_filming_phrase", () => {
    const idea = makeIdea({
      whatToShow:
        "Open the inbox. Lean into the panic beat — the reveal lands here.",
    });
    expect(validateScenarioCoherence(idea)).toBe("placeholder_filming_phrase");
  });

  it("rejects 'let the props carry the deadpan' as placeholder_filming_phrase", () => {
    const idea = makeIdea({
      reaction: "Close the laptop and let the props carry the deadpan.",
    });
    expect(validateScenarioCoherence(idea)).toBe("placeholder_filming_phrase");
  });

  it("rejects authored anchor + generic-template signature as authored_domain_used_generic_template", () => {
    const idea = makeIdea({
      hook: "the inbox always wins",
      whatToShow:
        "Camera on the inbox, you in frame next to it. Beat 1: glance at the inbox. Beat 2: shrug. Beat 3: i opened the inbox.",
      howToFilm:
        "Phone propped chest height, single take. Keep yourself and the inbox in the same frame the whole time.",
    });
    expect(validateScenarioCoherence(idea)).toBe(
      "authored_domain_used_generic_template",
    );
  });

  // PHASE UX3.2 (post-architect-review) — substitution-proof rule 12.
  // The earlier rule 12 signatures keyed off `${n}` patterns (the
  // renderNoun, which becomes a concrete-prop swap like "phone
  // showing the inbox" for ALL 10 authored anchors). The architect
  // surfaced that every abstract authored anchor would silently
  // bypass rule 12 because none of those signatures could match
  // post-swap. The new signatures key off `${anchorLc}` patterns
  // (always the literal authored anchor), so this regression
  // sweep confirms each authored anchor going through every
  // generic-template show / film / shotPlan path is caught.
  describe("rule 12 catches every generic-template path per authored anchor", () => {
    const SHOW_TEMPLATES: ReadonlyArray<(n: string, a: string) => string> = [
      // L493 generic show shape 1
      (n, a) =>
        `Camera on the ${n}, you in frame next to it. Beat 1: glance at the ${n}. Beat 2: shrug. Beat 3: i opened the ${a}.`,
      // L495 generic show shape 2
      (n, a) =>
        `Set the ${n} down where the camera can see it. Sit beside it for a second like you're thinking. Then opened the ${a} and walk out of frame.`,
      // L497 generic show shape 3
      (n, a) =>
        `Static wide of the ${n}. Step in, pick the ${n} up, put it back. One more beat — then opened the ${a} for real this time.`,
      // L499 generic show shape 4
      (n, a) =>
        `Phone propped low so the ${n} dominates the foreground. You enter behind it, hesitate, and opened the ${a} — end on your face mid-realization.`,
    ];
    const FILM_TEMPLATES: ReadonlyArray<(n: string, a: string) => string> = [
      // L510 generic film shape 1
      (n, a) =>
        `Phone propped chest height, single take. Keep yourself and the ${n} in the same frame the whole time. Cut the second you opened the ${a}.`,
      // L512 generic film shape 2
      (n, a) =>
        `Counter-height shelf shot, one continuous take. The ${n} stays visible from start to finish. The moment you opened the ${a} is the cut.`,
      // L514 generic film shape 3
      (n, a) =>
        `Wide-ish framing — the ${n} sits in the lower third. No edits. Walk in, do the opened beat on the ${a} once, then leave the frame.`,
      // L516 generic film shape 4
      (n, a) =>
        `Locked-off on tripod or shelf, the ${n} always in shot. Step in, opened the ${a} on the beat, step out — single take, no music.`,
    ];
    const SHOT_PLAN_BEAT2 = (a: string): string =>
      `Medium: opened the ${a} in one clear gesture.`;
    const SHOT_PLAN_BEAT1_BARE = (a: string): string =>
      `Wide-ish: enter the frame with the ${a} visible.`;
    const SHOT_PLAN_BEAT1_SWAPPED = (n: string): string =>
      `Wide-ish: enter the frame with the ${n} visible.`;

    for (const a of AUTHORED_DOMAIN_IDS) {
      const renderNoun = ABSTRACT_ANCHORS.has(a)
        ? (ABSTRACT_TO_CONCRETE_PROP[a] ?? a)
        : a;

      // Every show shape MUST trip rule 12 for this authored anchor.
      for (let i = 0; i < SHOW_TEMPLATES.length; i++) {
        it(`anchor ${a} via generic show shape ${i + 1} → rule 12`, () => {
          const idea = makeIdea({
            hook: `the ${a} always wins again today`,
            whatToShow: SHOW_TEMPLATES[i]!(renderNoun, a),
            howToFilm: `Phone propped, ${renderNoun} in frame.`,
            shotPlan: ["Wide.", "Medium.", "Hold."],
          });
          expect(validateScenarioCoherence(idea)).toBe(
            "authored_domain_used_generic_template",
          );
        });
      }

      // Every film shape MUST trip rule 12 for this authored anchor.
      for (let i = 0; i < FILM_TEMPLATES.length; i++) {
        it(`anchor ${a} via generic film shape ${i + 1} → rule 12`, () => {
          const idea = makeIdea({
            hook: `the ${a} always wins again today`,
            whatToShow: `Open the ${renderNoun}. Hold for one beat.`,
            howToFilm: FILM_TEMPLATES[i]!(renderNoun, a),
            shotPlan: ["Wide.", "Medium.", "Hold."],
          });
          expect(validateScenarioCoherence(idea)).toBe(
            "authored_domain_used_generic_template",
          );
        });
      }

      // Generic shotPlan beat 2 MUST trip rule 12.
      it(`anchor ${a} via generic shotPlan beat 2 → rule 12`, () => {
        const idea = makeIdea({
          hook: `the ${a} always wins again today`,
          whatToShow: `Open the ${renderNoun}. Hold for one beat.`,
          howToFilm: `Phone propped, ${renderNoun} in frame.`,
          shotPlan: ["Wide.", SHOT_PLAN_BEAT2(a), "Hold."],
        });
        expect(validateScenarioCoherence(idea)).toBe(
          "authored_domain_used_generic_template",
        );
      });

      // Generic shotPlan beat 1 — both bare and swapped forms MUST
      // trip rule 12. Bare form fires the existing wide-ish regex
      // for non-abstract anchors; swapped form fires the bounded
      // `.{1,40}?` form for abstract anchors that go through the
      // concrete-prop substitution.
      it(`anchor ${a} via generic shotPlan beat 1 (bare) → rule 12`, () => {
        const idea = makeIdea({
          hook: `the ${a} always wins again today`,
          whatToShow: `Open the ${renderNoun}. Hold for one beat.`,
          howToFilm: `Phone propped, ${renderNoun} in frame.`,
          shotPlan: [SHOT_PLAN_BEAT1_BARE(a), "Medium.", "Hold."],
        });
        expect(validateScenarioCoherence(idea)).toBe(
          "authored_domain_used_generic_template",
        );
      });

      if (ABSTRACT_ANCHORS.has(a)) {
        it(`anchor ${a} via generic shotPlan beat 1 (concrete-prop swapped) → rule 12`, () => {
          const idea = makeIdea({
            hook: `the ${a} always wins again today`,
            whatToShow: `Open the ${renderNoun}. Hold for one beat.`,
            howToFilm: `Phone propped, ${renderNoun} in frame.`,
            shotPlan: [SHOT_PLAN_BEAT1_SWAPPED(renderNoun), "Medium.", "Hold."],
          });
          expect(validateScenarioCoherence(idea)).toBe(
            "authored_domain_used_generic_template",
          );
        });
      }
    }
  });

  it("passes a clean authored-style inbox idea", () => {
    const p = selectAuthoredPlan("inbox")!;
    const idea = makeIdea({
      hook: "the inbox always wins again today",
      whatToShow: p.whatToShow,
      howToFilm: p.howToFilm,
      shotPlan: [p.shotPlan[0], p.shotPlan[1], p.shotPlan[2]],
      trigger: p.triggerVariants[0]!,
      reaction: p.reactionVariants[0]!,
      caption: p.captionVariants[0]!,
    });
    expect(validateScenarioCoherence(idea)).toBeNull();
  });

  it("legacy UX3.1 'verb_anchor_implausible' still fires before UX3.2 rules", () => {
    // "ghost the calendar" — pre-existing UX3.1 implausible (verb,
    // anchor) pair from the calendar cluster. The hook AND show
    // both reference calendar so `show_missing_hook_anchor` (rule
    // 4) and `hook_topic_noun_drift` (rule 8) both pass cleanly,
    // letting `verb_anchor_implausible` (rule 9) fire first as
    // expected — and BEFORE any UX3.2 rule.
    const idea = makeIdea({
      hook: "i ghost the calendar every monday",
      whatToShow:
        "Open the calendar on the laptop. Hold for one beat. Ghost the calendar without scheduling anything.",
      howToFilm: "Phone propped, calendar visible on screen.",
    });
    expect(validateScenarioCoherence(idea)).toBe("verb_anchor_implausible");
  });
});

// ---------------------------------------------------------------- //
// 4. Render sweep — every authored plan ships clean                 //
// ---------------------------------------------------------------- //

describe("render sweep — 10 authored domains", () => {
  const authoredAnchors = getAuthoredAnchorSet();

  it("every authored plan, packed into an Idea, passes scenarioCoherence", () => {
    for (const p of getAllAuthoredPlans()) {
      const anchor = p.anchors[0]!;
      const idea = makeIdea({
        hook: `the ${anchor} thing again, every day, every week`,
        whatToShow: p.whatToShow,
        howToFilm: p.howToFilm,
        shotPlan: [p.shotPlan[0], p.shotPlan[1], p.shotPlan[2]],
        trigger: p.triggerVariants[0]!,
        reaction: p.reactionVariants[0]!,
        caption: p.captionVariants[0]!,
      });
      const verdict = validateScenarioCoherence(idea);
      expect(
        verdict,
        `plan ${p.planId} failed scenarioCoherence: ${verdict}`,
      ).toBeNull();
    }
  });

  it("authored anchor set covers all 10 domain anchors", () => {
    expect(authoredAnchors.size).toBeGreaterThanOrEqual(10);
    for (const d of AUTHORED_DOMAIN_IDS) {
      expect(authoredAnchors.has(d)).toBe(true);
    }
  });
});
