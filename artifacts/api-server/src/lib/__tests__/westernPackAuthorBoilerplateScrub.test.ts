/**
 * PHASE POST-W2-AUTHOR F1 regression test.
 *
 * The post-W2-AUTHOR runtime QA (`.local/POST_W2_AUTHOR_RUNTIME_QA_REPORT.md`)
 * surfaced 4 banned-phrase leaks (`"Phone on a tripod, one
 * locked-off shot."` + `"...let the silence land."`) in user-facing
 * `howToFilm` output. All 4 carried `sourceRaw="core_native"` AND
 * `westernPackEntryId=w2_*`, which uniquely identifies them as
 * `westernPackAuthor.authorWesternPackEntryAsIdea` outputs whose
 * `entry.howToFilm` came verbatim from a W2-K BATCH_NEXT corpus
 * row.
 *
 * The fix scrubs the V1-grammar prefix + trailing flat-face clause
 * out of `entry.howToFilm` at this single author site BEFORE the
 * field is written into the draft idea. This test:
 *
 *   1. Calls `scrubBannedHowToFilmBoilerplate` directly with the
 *      4 corpus strings the runtime QA flagged.
 *   2. Asserts the scrubbed output contains NONE of the 5 banned
 *      tokens enumerated in the F1 task spec.
 *   3. Asserts the scrubbed output preserves the corpus skit body
 *      verbatim (the comedic intent is unchanged).
 *   4. Asserts idempotence — running the scrub twice yields the
 *      same string.
 *   5. Asserts no-op on already-V2 corpus strings.
 *   6. Asserts the scrubbed string still passes
 *      `passesV2Gate(wts, htf)` against a representative
 *      `whatToShow` companion.
 *   7. End-to-end: feeds two of the offending corpus rows through
 *      the full `authorWesternPackEntryAsIdea` and asserts the
 *      authored draft `howToFilm` is banned-phrase free.
 */

import { describe, it, expect } from "vitest";
import {
  scrubBannedHowToFilmBoilerplate,
  authorWesternPackEntryAsIdea,
} from "../westernPackAuthor.js";
import { passesV2Gate } from "../wtsHtfQualityGate.js";
import type { WesternHookPackDraftEntry } from "../westernHookPack.js";

const F1_BANNED_TOKENS: ReadonlyArray<RegExp> = [
  /phone on a tripod/i,
  /locked-off shot/i,
  /one locked-off shot/i,
  /let the silence land/i,
  /let the joke land/i,
];

function assertNoBanned(s: string, label: string): void {
  for (const re of F1_BANNED_TOKENS) {
    expect(re.test(s), `${label} contains banned token /${re.source}/`).toBe(
      false,
    );
  }
}

// The four exact corpus rows that produced the 4 F1 hits in the
// post-W2-AUTHOR runtime QA. Anchors taken from the corpus rows in
// `westernHookPackBatchNext.ts`.
const F1_FIXTURE: ReadonlyArray<{
  readonly label: string;
  readonly anchor: string;
  readonly howToFilm: string;
  readonly skitFragment: string; // a substring of the corpus skit body that MUST survive the scrub verbatim
}> = [
  {
    label: "snooze",
    anchor: "alarm",
    howToFilm:
      "Phone on a tripod, one locked-off shot. Alarm at 7:00, quick cuts of snooze taps, final clock reads 11:48. Keep your face flat the whole time; let the silence land.",
    skitFragment:
      "Alarm at 7:00, quick cuts of snooze taps, final clock reads 11:48.",
  },
  {
    label: "caption",
    anchor: "post",
    howToFilm:
      "Phone on a tripod, one locked-off shot. Post with likes, caption edited to blank. End on a held silent stare; let the realization sit.",
    skitFragment: "Post with likes, caption edited to blank.",
  },
  {
    label: "meditation",
    anchor: "streak",
    howToFilm:
      "Phone on a tripod, one locked-off shot. Meditation timer open, phone notification distracts, streak broken. Keep your face flat the whole time; let the silence land.",
    skitFragment:
      "Meditation timer open, phone notification distracts, streak broken.",
  },
  {
    label: "freezer",
    anchor: "drawer",
    howToFilm:
      "Phone on a tripod, one locked-off shot. Freezer door open, hand shoving ice cream tub deeper, drawer still won\u2019t shut. End on a held silent stare; let the realization sit.",
    skitFragment:
      "Freezer door open, hand shoving ice cream tub deeper, drawer still won\u2019t shut.",
  },
];

describe("scrubBannedHowToFilmBoilerplate (POST-W2-AUTHOR F1)", () => {
  for (const f of F1_FIXTURE) {
    it(`strips banned tokens from the ${f.label} corpus row`, () => {
      const scrubbed = scrubBannedHowToFilmBoilerplate(f.howToFilm, f.anchor);
      assertNoBanned(scrubbed, `${f.label} scrubbed`);
    });

    it(`preserves the ${f.label} skit body verbatim`, () => {
      const scrubbed = scrubBannedHowToFilmBoilerplate(f.howToFilm, f.anchor);
      expect(scrubbed).toContain(f.skitFragment);
    });

    it(`emits a V2 framing tied to the ${f.label} anchor`, () => {
      const scrubbed = scrubBannedHowToFilmBoilerplate(f.howToFilm, f.anchor);
      expect(scrubbed.toLowerCase()).toContain(`frame the ${f.anchor}`);
      expect(scrubbed.length).toBeGreaterThanOrEqual(15);
      expect(scrubbed.length).toBeLessThanOrEqual(400);
    });

    it(`is idempotent on the ${f.label} row`, () => {
      const once = scrubBannedHowToFilmBoilerplate(f.howToFilm, f.anchor);
      const twice = scrubBannedHowToFilmBoilerplate(once, f.anchor);
      expect(twice).toBe(once);
    });

    it(`scrubbed ${f.label} passes the V2 quality gate`, () => {
      const scrubbed = scrubBannedHowToFilmBoilerplate(f.howToFilm, f.anchor);
      // Use a generic V2-grammar `whatToShow` companion (same shape
      // the corpus emits but trimmed to a generic action so we are
      // testing the htf scrubber, not the wts).
      const wts = `Open the ${f.anchor} on your phone or laptop. Hold on it for a beat, then put it down without doing anything about it.`;
      expect(passesV2Gate(wts, scrubbed)).toBe(true);
    });
  }

  it("is a no-op on a corpus row that does not start with the banned prefix", () => {
    const v2Row =
      "Camera at counter height, framing you and the calendar in the same shot. Single take, natural light. Walk in, look, decide, walk out — let the geography of the kitchen tell the contradiction.";
    expect(scrubBannedHowToFilmBoilerplate(v2Row, "calendar")).toBe(v2Row);
  });

  it("strips a stray standalone 'let the joke land' clause defensively", () => {
    const input =
      "Eye-level from across the desk. Land the beat, let the joke land. Cut.";
    const out = scrubBannedHowToFilmBoilerplate(input, "desk");
    expect(/let the joke land/i.test(out)).toBe(false);
  });

  it("returns input unchanged on empty / non-string", () => {
    expect(scrubBannedHowToFilmBoilerplate("", "desk")).toBe("");
    // @ts-expect-error — exercising the runtime guard path.
    expect(scrubBannedHowToFilmBoilerplate(undefined, "desk")).toBe(undefined);
  });
});

describe("authorWesternPackEntryAsIdea — F1 end-to-end", () => {
  // Two of the four offenders, fed through the full authoring path.
  // We construct the entries inline (the corpus rows happen to fit
  // the schema; we are testing the synthesis path, not corpus
  // integrity).
  function makeEntry(overrides: {
    readonly id: string;
    readonly hook: string;
    readonly anchor: string;
    readonly whatToShow: string;
    readonly howToFilm: string;
    readonly caption: string;
  }): WesternHookPackDraftEntry {
    return {
      id: overrides.id,
      hook: overrides.hook,
      anchor: overrides.anchor,
      whatToShow: overrides.whatToShow,
      howToFilm: overrides.howToFilm,
      caption: overrides.caption,
      hookStyle: "internal_thought",
      comedyFamily: "tiny_humiliation",
      emotionalSpike: "self_recognition",
      setting: "bedroom_solo",
      // The author does not require a real reviewer stamp at runtime
      // (only the boot integrity assertion does), so this is fine
      // for an end-to-end synthesis test.
      reviewedBy: "TEST",
    } as unknown as WesternHookPackDraftEntry;
  }

  const e2eCases = [
    makeEntry({
      id: "w2_test_snooze",
      hook: "Snooze button turned morning into a rumor",
      anchor: "alarm",
      whatToShow:
        "You set the alarm at 7:00 the night before. Cut to: it is 11:48 and you are still in bed, blanket pulled up, alarm long-since silenced. Hold on the clock for one beat.",
      howToFilm:
        "Phone on a tripod, one locked-off shot. Alarm at 7:00, quick cuts of snooze taps, final clock reads 11:48. Keep your face flat the whole time; let the silence land.",
      caption: "set the alarm. ignored the alarm. became the alarm.",
    }),
    makeEntry({
      id: "w2_test_freezer",
      hook: "Freezer drawer refuses to close for the fourth night",
      anchor: "drawer",
      whatToShow:
        "You open the freezer drawer to grab one tub. The drawer will not close. You shove an ice cream tub deeper, push again, give up, and walk away leaving the drawer ajar.",
      howToFilm:
        "Phone on a tripod, one locked-off shot. Freezer door open, hand shoving ice cream tub deeper, drawer still won\u2019t shut. End on a held silent stare; let the realization sit.",
      caption: "the drawer and i have an arrangement now.",
    }),
  ];

  for (const entry of e2eCases) {
    it(`authored draft for "${entry.hook}" emits no banned tokens in howToFilm`, () => {
      const result = authorWesternPackEntryAsIdea({
        entry,
        regenerateSalt: 0,
        seedFingerprints: new Set<string>(),
      });
      // The author may legitimately reject for unrelated reasons
      // (e.g. seedFingerprint anti-copy hash collision) on synthetic
      // input — but in either case the only failure mode we care
      // about for F1 is "ok=true with banned tokens present".
      if (result.ok) {
        assertNoBanned(result.idea.howToFilm, `${entry.id} authored htf`);
        // Anchor presence invariant (the author appends ` Keep the
        // <anchor> centered.` if the scrubbed film does not already
        // contain the anchor token). Either way, the anchor must be
        // present in the final string.
        expect(result.idea.howToFilm.toLowerCase()).toContain(
          entry.anchor.toLowerCase(),
        );
      }
    });
  }
});
