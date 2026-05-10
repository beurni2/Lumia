/**
 * PHASE N1-FOLLOWUP-NG-CLEAN-IMPLICIT-ANTHROPOMORPH-HQS-FIX — regression
 * tests for the 10-verb expansion of the IMPLICIT_ANTHROPOMORPH
 * alternation in `hookQuality.ts`.
 *
 * Patch:
 *   • 9 REQUIRED verbs added: smiled, printed, appointed, rang, made,
 *     opened, turned, sounded, corrected.
 *   • 1 OPTIONAL verb added (evidence-gated by predict driver):
 *     arrived (lifts ng_clean_NEW_020 over PICKER_HQS_FLOOR=50).
 *
 * `PICKER_HQS_FLOOR` stays at 50. No validator/selector/rotation
 * changes. The structural `the <noun-phrase> <verb>` gate is
 * unchanged — these tests verify the new verbs trigger ONLY in that
 * shape.
 *
 * Report: .local/N1_FOLLOWUP_NG_CLEAN_IMPLICIT_ANTHROPOMORPH_HQS_FIX_REPORT.md
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  scoreHookQuality,
  scoreHookQualityDetailed,
} from "../hookQuality.js";

const PICKER_FLOOR = 50;

const ADDED_VERBS_REQUIRED = [
  "smiled",
  "printed",
  "appointed",
  "rang",
  "made",
  "opened",
  "turned",
  "sounded",
  "corrected",
];

const ADDED_VERBS_OPTIONAL = ["arrived"];

const ALL_ADDED_VERBS = [...ADDED_VERBS_REQUIRED, ...ADDED_VERBS_OPTIONAL];

describe("Implicit-anth HQS fix — PICKER_HQS_FLOOR invariance", () => {
  it("PICKER_HQS_FLOOR source constant is exactly 50 (this patch must not change it)", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(
      path.join(here, "..", "willingnessScorer.ts"),
      "utf8",
    );
    expect(src).toMatch(/const\s+PICKER_HQS_FLOOR\s*=\s*50\s*;/);
  });
});

describe("Implicit-anth HQS fix — added verbs are recognized in object-as-agent shape", () => {
  for (const verb of ALL_ADDED_VERBS) {
    it(`'the X ${verb}' fires implicit-anth (>=12)`, () => {
      const detail = scoreHookQualityDetailed(
        `the rumor ${verb} my evening`,
        "self_betrayal",
      );
      expect(detail.anthropomorph).toBeGreaterThanOrEqual(12);
    });
  }
});

describe("Implicit-anth HQS fix — human-subject negative carriers do NOT trigger anth", () => {
  for (const verb of ALL_ADDED_VERBS) {
    it(`'i ${verb} ...' does not trigger implicit-anth`, () => {
      const detail = scoreHookQualityDetailed(
        `i ${verb} the rumor today`,
        "self_betrayal",
      );
      expect(detail.anthropomorph).toBe(0);
    });
    it(`'someone ${verb} ...' does not trigger implicit-anth`, () => {
      const detail = scoreHookQualityDetailed(
        `someone ${verb} my whole afternoon`,
        "self_betrayal",
      );
      expect(detail.anthropomorph).toBe(0);
    });
  }
});

describe("Implicit-anth HQS fix — supervisor-cited positive examples lift over PICKER_HQS_FLOOR", () => {
  // Each hook is taken verbatim from the surviving subset of the
  // original supervisor packet. Five hooks (bank-app-smiled,
  // POS-receipt-printed, group-chat-appointed, doorbell-rang,
  // email-subject-sounded) were user-rejected for cohort fit and
  // removed from the corpus per phase
  // N1-FOLLOWUP-NG-CLEAN-SLOT0-CORPUS-FEED-NO-AUTHORING; they are
  // also removed from these positives so the test surface no longer
  // anchors on rejected creative copy. The verb-alternation patch
  // (smiled / printed / appointed / rang / sounded / arrived) is
  // preserved — these two retained ng_clean_070 + 071 hooks must
  // still clear the picker floor of 50, which is what this block
  // guarantees.
  const POSITIVES: ReadonlyArray<{ hook: string; family: "absurd_escalation" }> = [
    { hook: "The transfer narration sounded richer than my balance.",     family: "absurd_escalation" },
    { hook: "The calendar reminder arrived like family intervention.",    family: "absurd_escalation" },
  ];
  for (const { hook, family } of POSITIVES) {
    it(`'${hook}' clears PICKER_HQS_FLOOR (>=50)`, () => {
      const detail = scoreHookQualityDetailed(hook, family);
      expect(detail.anthropomorph).toBeGreaterThanOrEqual(12);
      expect(detail.total).toBeGreaterThanOrEqual(PICKER_FLOOR);
    });
  }
});

describe("Implicit-anth HQS fix — supervisor-cited negative carriers stay at anth=0", () => {
  // From the session-plan negative examples — same verbs, but in
  // human-subject shape. Must NOT receive implicit-anth credit.
  // After the post-architect human-subject negative-lookahead
  // tightening, all carriers in this list (including the structural
  // `the <human-noun> <verb>` cases) score anth === 0. This is the
  // strict assertion the architect requested.
  const NEGATIVES = [
    "i smiled before rejecting my confidence.",
    "someone printed slower than my excuses.",
    "my auntie appointed me without discussion.",
    "i opened the room door during my serious content.",
    "the creator sounded serious during content.",
    "the person made me sound suspicious outside.",
  ];
  for (const hook of NEGATIVES) {
    it(`'${hook}' anthropomorph axis is exactly 0 (strict)`, () => {
      const detail = scoreHookQualityDetailed(hook, "absurd_escalation");
      expect(detail.anthropomorph).toBe(0);
      expect(detail.total).toBeLessThan(PICKER_FLOOR);
    });
  }
});

describe("Implicit-anth HQS fix — human-noun negative lookahead (post-architect)", () => {
  // Each carrier uses `the <human-noun> <list-verb>` shape — the
  // structural gate matches and a verb in the alternation is
  // present, but the new negative lookahead excludes the human
  // head-noun, so anth must be exactly 0.
  const HUMAN_NOUNS = [
    "person", "people", "creator", "man", "woman", "boy", "girl",
    "kid", "child", "auntie", "aunt", "uncle", "supervisor", "boss",
    "manager", "teacher", "friend", "neighbor", "stranger", "guy",
    "lady", "driver", "cousin", "husband", "wife", "doctor", "nurse",
  ];
  for (const noun of HUMAN_NOUNS) {
    it(`'the ${noun} sounded ...' is excluded from implicit-anth credit`, () => {
      const detail = scoreHookQualityDetailed(
        `the ${noun} sounded suspicious during content.`,
        "absurd_escalation",
      );
      expect(detail.anthropomorph).toBe(0);
    });
  }

  it("non-human compound subject still receives credit ('the transfer narration sounded')", () => {
    // Original example used the user-rejected 'the bank app smiled'
    // hook; replaced with the surviving ng_clean_070 hook that
    // exercises the same compound-subject + alternation-verb shape
    // (compound-noun head 'the transfer narration' + verb 'sounded').
    const detail = scoreHookQualityDetailed(
      "the transfer narration sounded richer than my balance.",
      "absurd_escalation",
    );
    expect(detail.anthropomorph).toBeGreaterThanOrEqual(12);
  });
});

describe("Implicit-anth HQS fix — gaming-guard / quality-bar invariants", () => {
  it("a bland hook with NO captivating signal still misses the floor", () => {
    const detail = scoreHookQualityDetailed(
      "the moment is the moment again",
      "self_betrayal",
    );
    expect(detail.total).toBeLessThan(PICKER_FLOOR);
  });

  it("aiCliche behavior unchanged: 'my body quit' still penalized", () => {
    const cliche = scoreHookQualityDetailed(
      "my body quit on me again today",
      "self_betrayal",
    );
    expect(cliche.aiCliche).toBeLessThan(0);
  });

  it("Patch D regression hooks still clear PICKER_HQS_FLOOR (no breakage)", () => {
    // Sample two of the Patch D named regression hooks — they must
    // continue to clear the floor with this patch's verbs added.
    const stickerEnded = scoreHookQuality(
      "The sticker ended the serious meeting.",
      "absurd_escalation",
    );
    const tankChose = scoreHookQuality(
      "The tank chose drama at bath time.",
      "absurd_escalation",
    );
    expect(stickerEnded).toBeGreaterThanOrEqual(PICKER_FLOOR);
    expect(tankChose).toBeGreaterThanOrEqual(PICKER_FLOOR);
  });

  it("USER REQUIREMENT preserved: 'ghosted my own to-do list' still beats 'abandoned my checklist'", () => {
    const ghosted = scoreHookQuality("i ghosted my own to-do list", "self_betrayal");
    const abandoned = scoreHookQuality("i abandoned my checklist", "self_betrayal");
    expect(ghosted).toBeGreaterThan(abandoned);
    expect(ghosted).toBeGreaterThanOrEqual(70);
  });

  it("plain object-action sentences with NO concrete/contradiction signal stay under floor", () => {
    // Each carrier uses a NEW verb in object-agent shape, but no
    // concrete catalog noun, no contradiction marker, no explicit
    // anth. Must remain under 50 — the patch must not turn ANY
    // verb-only object-agent sentence into a passing hook.
    const carriers = [
      "the boy smiled at the wall today",
      "the door opened for the third time",
      "the wheel turned and turned and turned",
      "the man arrived for the meeting today",
    ];
    for (const hook of carriers) {
      const detail = scoreHookQualityDetailed(hook, "self_betrayal");
      expect(detail.total).toBeLessThan(PICKER_FLOOR);
    }
  });

  it("score remains 0..100 bounded post-patch", () => {
    for (const hook of [
      "",
      // Original used 'the bank app smiled' + 'the email subject already sounded';
      // both are user-rejected hooks (now removed from the corpus). Replaced with
      // the surviving ng_clean_070 + 071 hooks so this bound check still exercises
      // a compound-subject alternation-verb hook + a longer composite carrier.
      "the transfer narration sounded richer than my balance.",
      "the calendar reminder arrived like family intervention and the printer printed",
    ]) {
      const s = scoreHookQuality(hook, "self_betrayal");
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });
});
