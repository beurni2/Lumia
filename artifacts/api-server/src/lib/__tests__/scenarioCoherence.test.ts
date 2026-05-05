/**
 * PHASE UX3 — scenario coherence guard tests.
 *
 * Covers the five failure modes the validator catches. Builds a
 * minimal Idea fixture per case using the Idea schema's required
 * fields (the validator only reads `hook`, `whatToShow`,
 * `howToFilm`, but the type insists on the rest).
 */

import { describe, it, expect } from "vitest";
import {
  validateScenarioCoherence,
  type ScenarioCoherenceReason,
} from "../scenarioCoherence";
import type { Idea } from "../ideaGen";

function makeIdea(overrides: Partial<Idea>): Idea {
  // PHASE UX3.1 — baseline cleaned of every stiffness phrase the
  // expanded validator now catches (knowingly / End beat: / with
  // intent / look-straight-to-camera). Each override-based test
  // below relies on its specific UX3 rule firing BEFORE the new
  // UX3.1 stiffness rule, but the BASELINE itself must pass the
  // full validator (returns null) — hence the clean prose.
  const base: Idea = {
    pattern: "contrast",
    hook: "the dishes won again today",
    hookSeconds: 1.5,
    trigger: "Show the dishes on camera, out loud, in one clear beat.",
    reaction: "Stare at the dishes like they owe you rent.",
    emotionalSpike: "regret",
    structure: "routine_contradiction",
    hookStyle: "internal_thought",
    triggerCategory: "task",
    setting: "kitchen",
    script:
      "LINE 1: the dishes won again today\n" +
      "LINE 2 (beat / cutaway): show the dishes that contradict line 1.\n" +
      "LINE 3 (caption / mouthed): Self-betrayal lands here.",
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
      "Self-betrayal → I ignore the dishes → relatable contradiction in one beat (firefly).",
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

describe("validateScenarioCoherence", () => {
  it("returns null for a coherent baseline idea", () => {
    expect(validateScenarioCoherence(makeIdea({}))).toBeNull();
  });

  it("rejects 'deliberately' template stiffness in whatToShow", () => {
    const idea = makeIdea({
      whatToShow:
        "Open with the dishes on screen. Pull back as i ignore the dishes deliberately. End beat: ignored the dishes.",
    });
    const reason: ScenarioCoherenceReason | null =
      validateScenarioCoherence(idea);
    expect(reason).toBe("deliberate_template_artifact");
  });

  it("rejects 'deliberately' template stiffness in howToFilm", () => {
    const idea = makeIdea({
      howToFilm:
        "Wide-ish, the dishes occupies the lower-third. Ignore the dishes once, deliberately, then hold.",
    });
    expect(validateScenarioCoherence(idea)).toBe("deliberate_template_artifact");
  });

  it("rejects 'the {anchor} scene' template tail leak", () => {
    const idea = makeIdea({
      whatToShow:
        "Hand-held into the kitchen scene. Pause, ignore the dishes once, slow. End beat: ignored the dishes.",
    });
    expect(validateScenarioCoherence(idea)).toBe("scene_template_leakage");
  });

  it("rejects 'direct to camera' template phrase in whatToShow", () => {
    const idea = makeIdea({
      whatToShow:
        "Open with the dishes on screen. Hold as i ignore the dishes. End beat: ignored the dishes — direct to camera.",
    });
    expect(validateScenarioCoherence(idea)).toBe("direct_to_camera_in_show");
  });

  it("rejects when whatToShow shares zero substantial tokens with the hook", () => {
    const idea = makeIdea({
      hook: "yesterday me booked chaos for today",
      // whatToShow describes a totally different scene with no
      // overlap on substantial tokens (yesterday/booked/chaos).
      whatToShow:
        "Open with the laptop on screen. Camera holds as i ignore the laptop. End beat: ignored the laptop.",
    });
    expect(validateScenarioCoherence(idea)).toBe("show_missing_hook_anchor");
  });

  it("rejects split-self hook when whatToShow lacks temporal/contrast cue", () => {
    const idea = makeIdea({
      hook: "yesterday me booked the calendar today me has to live in",
      // Has overlap on "calendar" so token check passes, but no
      // yesterday/today/then/contrast marker in show.
      whatToShow:
        "Open with the calendar on screen. Camera holds as i open the calendar knowingly. End beat: opened the calendar.",
    });
    expect(validateScenarioCoherence(idea)).toBe("split_self_show_mismatch");
  });

  it("accepts split-self hook when whatToShow names the temporal cue", () => {
    // PHASE UX3.1 — cleaned of "End beat:" stiffness phrase the
    // expanded validator now catches; replaced with neutral
    // "Final beat:" framing.
    const idea = makeIdea({
      hook: "yesterday me booked the calendar today me has to live in",
      whatToShow:
        "Open with yesterday's calendar on screen. Camera holds as today i open the calendar. Final beat: opened the calendar.",
    });
    expect(validateScenarioCoherence(idea)).toBeNull();
  });

  it("accepts split-self hook when whatToShow uses a contrast marker", () => {
    // `rest` is the shared substantive token between hook and show
    // (so rule 4 passes); the `but` clause provides the contrast
    // marker rule 5 looks for. PHASE UX3.1 — cleaned of "End beat:"
    // stiffness phrase that the expanded validator now catches.
    const idea = makeIdea({
      hook: "past me thought rest was earned, present me knows better",
      whatToShow:
        "Open with the calendar on screen. Camera holds as i open the calendar but rest is already on the line. Final beat: opened the calendar.",
    });
    expect(validateScenarioCoherence(idea)).toBeNull();
  });
});
