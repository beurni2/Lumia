/**
 * W2-AUTHOR HYBRID — V2 sample printer (NOT a real test).
 *
 * Single `it` that prints actual rendered (whatToShow, howToFilm)
 * pairs from every author surface this phase touched. The test
 * asserts nothing meaningful — it exists so the printed strings
 * are visible in the test runner's stdout for the proof package.
 *
 * Surfaces covered:
 *   1. core_native Path B — non-authored anchors thread / tasks /
 *      swipe / draft, original-pair pick (pre-HYBRID byte-for-byte
 *      happy path)
 *   2. patternIdeator pattern_variation — phone_scroll_freeze and
 *      face_reaction_deadpan howToFilm rewrites
 *   3. authoredScenarioPlans — aps_inbox + aps_alarm hardened
 *      howToFilm
 *
 * Pack samples (W2 / N1) are intentionally omitted: this phase
 * does NOT change pack output (gate is log-only, corpus
 * pass-through). They would be byte-identical to pre-HYBRID.
 */

import { describe, expect, it } from "vitest";

import {
  PATH_B_SHOW_SHAPES,
  PATH_B_FILM_SHAPES,
} from "../cohesiveIdeaAuthor";
import { HOW_TO_FILM_BY_VISUAL_ACTION } from "../patternIdeator";
import { getAllAuthoredPlans } from "../authoredScenarioPlans";

const PATH_B_ANCHORS: ReadonlyArray<{
  anchor: string;
  renderNoun: string;
  action: string;
}> = [
  { anchor: "thread", renderNoun: "phone with the thread open", action: "open" },
  { anchor: "tasks", renderNoun: "task list on the laptop", action: "open" },
  { anchor: "swipe", renderNoun: "phone showing the swipe screen", action: "open" },
  { anchor: "draft", renderNoun: "draft on the screen", action: "open" },
];

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

describe("W2-AUTHOR HYBRID V2 SAMPLES (proof printer)", () => {
  it("prints rendered (whatToShow, howToFilm) pairs", () => {
    const lines: string[] = [];
    const sep = "=".repeat(72);
    lines.push("");
    lines.push(sep);
    lines.push("V2 SAMPLES — source: core_native Path B");
    lines.push(sep);
    for (const { anchor, renderNoun, action } of PATH_B_ANCHORS) {
      // Match the live picker's start indices so we sample what
      // the warm path would actually emit (deterministic per
      // `coreId|anchor`). Use a stable demo coreId.
      const coreId = "demo_core_2026_05_09";
      const showStart =
        djb2(`${coreId}|${anchor}|wts`) % PATH_B_SHOW_SHAPES.length;
      const filmStart =
        djb2(`${coreId}|${anchor}|htf`) % PATH_B_FILM_SHAPES.length;
      const wts = PATH_B_SHOW_SHAPES[showStart]!(renderNoun, action, anchor);
      const htf = PATH_B_FILM_SHAPES[filmStart]!(renderNoun, action, anchor);
      lines.push("");
      lines.push(`anchor       : ${anchor}`);
      lines.push(`pair         : (showStart=${showStart}, filmStart=${filmStart})`);
      lines.push(`whatToShow   : ${wts}`);
      lines.push(`howToFilm    : ${htf}`);
    }

    lines.push("");
    lines.push(sep);
    lines.push("V2 SAMPLES — source: pattern_variation (rewritten templates)");
    lines.push(sep);
    const STUB_SCEN = {
      topicNoun: "kitchen",
      settingDetail: "kitchen counter at golden hour",
      family: "self_betrayal",
    } as unknown as Parameters<
      typeof HOW_TO_FILM_BY_VISUAL_ACTION.phone_scroll_freeze
    >[0];
    for (const tplName of [
      "phone_scroll_freeze",
      "face_reaction_deadpan",
    ] as const) {
      const out = HOW_TO_FILM_BY_VISUAL_ACTION[tplName](STUB_SCEN);
      lines.push("");
      lines.push(`template     : ${tplName}`);
      lines.push(`howToFilm    : ${out}`);
    }

    lines.push("");
    lines.push(sep);
    lines.push("V2 SAMPLES — source: authored plan (hardened)");
    lines.push(sep);
    const byId = new Map(getAllAuthoredPlans().map((p) => [p.planId, p]));
    for (const id of ["aps_inbox", "aps_alarm"] as const) {
      const p = byId.get(id)!;
      lines.push("");
      lines.push(`planId       : ${id}`);
      lines.push(`anchor(s)    : ${p.anchors.join(", ")}`);
      lines.push(`whatToShow   : ${p.whatToShow}`);
      lines.push(`howToFilm    : ${p.howToFilm}`);
    }
    lines.push("");
    lines.push(sep);

    // eslint-disable-next-line no-console
    console.log(lines.join("\n"));
    expect(lines.length).toBeGreaterThan(0);
  });
});
