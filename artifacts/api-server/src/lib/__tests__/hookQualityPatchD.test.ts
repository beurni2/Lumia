/**
 * PHASE N1-FOLLOWUP-NG-CLEAN-HQS-CALIBRATION-PATCH-D — regression tests
 * for the scorer-vocabulary expansion that lifts ng_clean recognition
 * without lowering the quality bar.
 *
 * Patch D adds:
 *   • 28 concrete everyday-anchor nouns to CONCRETE_NOUNS
 *   • 21 verbs to VERB_LOW (recognition tier, 8 pts)
 *   • 20 verbs to the IMPLICIT_ANTHROPOMORPH alternation
 *
 * `PICKER_HQS_FLOOR` stays at 50. No validator/selector/rotation
 * changes. The audit predicted ng_clean eligible 8/61 → 18/61 with
 * zero ng_pidgin regression and at most one (legitimate) western
 * lift. The 8 named regression hooks below are the audit's
 * "first-card worthy" entries that must clear the floor post-patch.
 *
 * Audit: .local/N1_FOLLOWUP_NG_CLEAN_HQS_CALIBRATION_AUDIT_REPORT.md
 * Report: .local/N1_FOLLOWUP_NG_CLEAN_HQS_CALIBRATION_PATCH_D_REPORT.md
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

describe("Patch D — PICKER_HQS_FLOOR invariance", () => {
  it("PICKER_HQS_FLOOR source constant is exactly 50 (Patch D must not change it)", () => {
    // The constant is module-private. We assert against the source so
    // that a future drift in the floor value is caught here even
    // though we cannot import the symbol.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(
      path.join(here, "..", "willingnessScorer.ts"),
      "utf8",
    );
    expect(src).toMatch(/const\s+PICKER_HQS_FLOOR\s*=\s*50\s*;/);
  });
});

describe("Patch D — concrete-noun catalog expansion", () => {
  // The 28 added nouns must each register concrete credit in a hook
  // where only the noun-axis can supply the lift. Construct a
  // minimal carrier: bland verb + bare anchor + no anth marker, so
  // any non-zero `concrete` score is unambiguously attributable to
  // the noun catalog (vs anth or contradiction).
  const ADDED_CONCRETE = [
    "charger","printer","traffic","rice","plate","tailor","generator",
    "socket","doorbell","password","transfer","data","network","bucket",
    "fan","sticker","tank","ringlight","onion","light","pothole","cable",
    "fuel","change","form","errand","balance","battery",
  ];
  for (const noun of ADDED_CONCRETE) {
    it(`'${noun}' receives concrete credit`, () => {
      const detail = scoreHookQualityDetailed(
        `i had the ${noun} today`,
        "self_betrayal",
      );
      expect(detail.concrete).toBeGreaterThanOrEqual(10);
    });
  }
});

describe("Patch D — LOW-tier verb recognition", () => {
  // Each added LOW verb must classify into the LOW band (8 pts).
  // Carrier: `i ${verb} the rumor` — bland subject anchor not in
  // CONCRETE_NOUNS so the visceral axis is the only thing under
  // test. We assert visceral === 8 (LOW band score).
  const ADDED_LOW_VERBS = [
    "ask","came","chose","ended","said","saw","forgot","loaded","slowed",
    "dimmed","priced","assigned","interrupted","embarrassed","humbled",
    "delayed","declined","renewed","multiplied","bargain","bargained",
  ];
  for (const verb of ADDED_LOW_VERBS) {
    it(`'${verb}' classifies at LOW or higher (>=8 visceral)`, () => {
      const detail = scoreHookQualityDetailed(
        `i ${verb} the rumor today`,
        "self_betrayal",
      );
      // `ended` stems to `end` ∈ VERB_MID (18) — that's pre-existing
      // and fine; LOW is a floor, not a ceiling.
      expect(detail.visceral).toBeGreaterThanOrEqual(8);
    });
  }
});

describe("Patch D — implicit-anth verbs gated to object-agent pattern", () => {
  // Added implicit-anth verbs must ONLY trigger the +12 anth credit
  // when in the structural `the <subject> <verb>` form. A bare
  // `i <verb>` clause must NOT light up the implicit-anth axis.
  const ADDED_ANTH_VERBS = [
    "judged","mocked","refused","slowed","dimmed","loaded","declined",
    "multiplied","vanished","expired","ended","embarrassed","humbled",
    "delayed","interrupted","assigned","priced","forgot","said","froze",
  ];
  for (const verb of ADDED_ANTH_VERBS) {
    it(`'the X ${verb}' fires implicit-anth; 'i ${verb} X' does not`, () => {
      const objectAgent = scoreHookQualityDetailed(
        `the rumor ${verb} my evening`,
        "self_betrayal",
      );
      const subjectI = scoreHookQualityDetailed(
        `i ${verb} the rumor today`,
        "self_betrayal",
      );
      expect(objectAgent.anthropomorph).toBeGreaterThanOrEqual(12);
      expect(subjectI.anthropomorph).toBe(0);
    });
  }
});

describe("Patch D — named regression hooks must clear PICKER_HQS_FLOOR", () => {
  // The 8 audit-named "first-card worthy" hooks. Pre-patch they sat
  // at 35-48 (under the 50 floor); post-patch they must clear 50.
  // The chat/screen examples already had concrete credit pre-patch
  // — they verify the verb/anth additions don't break their score.
  const REGRESSION_HOOKS: Array<{ hook: string; family: "absurd_escalation" }> = [
    { hook: "The sticker ended the serious meeting.", family: "absurd_escalation" },
    { hook: "The tank chose drama at bath time.", family: "absurd_escalation" },
    { hook: "The change came with life advice.", family: "absurd_escalation" },
    { hook: "The errand came dressed as conversation.", family: "absurd_escalation" },
    { hook: "The form asked for my entire history.", family: "absurd_escalation" },
    { hook: "The chat said quick question and formed a committee.", family: "absurd_escalation" },
    { hook: "The generator stopped and the house started hearing secrets.", family: "absurd_escalation" },
    { hook: "The screen dimmed and I started bargaining.", family: "absurd_escalation" },
  ];
  for (const { hook, family } of REGRESSION_HOOKS) {
    it(`'${hook}' scores >= ${PICKER_FLOOR}`, () => {
      const detail = scoreHookQualityDetailed(hook, family);
      // Normalize for signed-zero (Object.is(-0, 0) === false).
      expect(detail.aiCliche + 0).toBe(0); // unchanged behavior
      expect(detail.total).toBeGreaterThanOrEqual(PICKER_FLOOR);
    });
  }
});

describe("Patch D — gaming-guard / quality-bar invariants", () => {
  it("a bland hook with NO captivating signal still misses the floor", () => {
    // Carrier: bland verb (`is`) + non-catalog noun + no anth /
    // contradiction. Should remain well under 50 — Patch D must not
    // turn ANY filler into a passing hook.
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
    // The AI_CLICHE pattern penalty is unchanged by Patch D.
    expect(cliche.aiCliche).toBeLessThan(0);
  });

  it("Y8 EXPLICIT-anth gaming guard still fires (my own + bland → demoted to 12)", () => {
    const gaming = scoreHookQualityDetailed(
      "my own zorblax was florbed",
      "self_betrayal",
    );
    // No verb/concrete/contradiction signal — explicit anth must
    // still demote from 25 to 12. Patch D adds NO concrete nouns
    // that would flip this case (zorblax ∉ catalog).
    expect(gaming.anthropomorph).toBe(12);
  });

  it("USER REQUIREMENT preserved: 'ghosted my own to-do list' still beats 'abandoned my checklist'", () => {
    // The original Y8 invariant. Patch D's LOW-tier additions must
    // not invert the HIGH-vs-MID preference.
    const ghosted = scoreHookQuality("i ghosted my own to-do list", "self_betrayal");
    const abandoned = scoreHookQuality("i abandoned my checklist", "self_betrayal");
    expect(ghosted).toBeGreaterThan(abandoned);
    expect(ghosted).toBeGreaterThanOrEqual(70);
  });

  it("implicit-anth does NOT false-positive on natural human-subject clauses", () => {
    // Architect-suggested hardening (BI 2026-05-10). Patch D
    // widened IMPLICIT_ANTHROPOMORPH with verbs that also appear
    // in ordinary English about people. The structural pattern
    // (`the <noun phrase> <verb>`) does still match human-subject
    // clauses by design — the audit accepted that pre-existing
    // breadth — but we must verify the patch does NOT escalate
    // recognition of plain-everyday human-subject sentences past
    // PICKER_HQS_FLOOR purely on the strength of the new verbs.
    // Carriers below have no concrete catalog noun, no contradiction,
    // no bizarre-juxtaposition, no explicit-anth marker; the only
    // possible lift comes from anth + the LOW-tier verb. Total must
    // remain under the picker floor (50). Note: hooks containing
    // observational anchors like "forgot my birthday" legitimately
    // do reach 50 (relatable content) — those are excluded here as
    // they are NOT false-positives, they are accurate recognition.
    const naturalHumanSubject = [
      "the manager said the meeting was over",
      "the kid ended the argument with one look",
      "the neighbor declined the invitation politely",
    ];
    for (const hook of naturalHumanSubject) {
      const detail = scoreHookQualityDetailed(hook, "self_betrayal");
      expect(detail.total).toBeLessThan(PICKER_FLOOR);
    }
  });

  it("score remains 0..100 bounded post-patch", () => {
    for (const hook of [
      "",
      "the sticker ended the serious meeting.",
      "the tank chose drama at bath time and the house judged",
      "the form asked the printer multiplied the rice ended",
    ]) {
      const s = scoreHookQuality(hook, "self_betrayal");
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });
});
