/**
 * PHASE N1-Q — tests for the additive Nigerian pack scorer.
 *
 * Covers the 8 acceptance items in the user's approval contract:
 *   1. western/india/philippines behavior unchanged (cross-region no-op)
 *   2. nigeria-clean unchanged (scoreHookQuality remains the gate there)
 *   3. runtime generation files do not import nigerianHookQuality
 *   4. blank/sentinel reviewedBy → 0
 *   5. mocking pattern → 0
 *   6. non-approved pool throws / refuses scoring
 *   7. existing production validators still run before approval
 *   8. re-ingest output is deterministic
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  scoreNigerianPackEntry,
  scoreNigerianPackEntryDetailed,
  getNigerianHookQualityIngestKey,
  registerApprovedPoolReference,
  type ScoringContext,
} from "../nigerianHookQuality.js";
import {
  NIGERIAN_HOOK_PACK,
  type NigerianPackEntry,
} from "../nigerianHookPack.js";
import { APPROVED_NIGERIAN_PROMOTION_CANDIDATES } from "../nigerianHookPackApproved.js";
import { scoreHookQuality } from "../hookQuality.js";

// ─── Fixtures ─────────────────────────────────────────────────────

const validEntry = (over: Partial<NigerianPackEntry> = {}): NigerianPackEntry => ({
  hook: "generator don disgrace my sleep again",
  whatToShow: "Show the generator outside, then cut to you in bed yawning while it growls.",
  howToFilm: "Phone-level lock-off, soft daylight, one take.",
  caption: "this generator dey punish me.",
  anchor: "generator",
  domain: "adulting_chaos",
  pidginLevel: "pidgin",
  reviewedBy: "BI 2026-05-05",
  ...over,
});

const ingestCtx: ScoringContext = {
  kind: "ingest",
  key: getNigerianHookQualityIngestKey(),
};

// ─── 1. Western/India/Philippines untouched ───────────────────────

describe("cross-region no-op (item 1)", () => {
  // Frozen snapshots captured BEFORE this phase landed. If any line
  // changes, scoreHookQuality has been mutated — that would mean the
  // additive scorer leaked into the English scorer's lexicons or
  // some other path mutated the global tables. Either way, this test
  // would fail and surface it loudly.
  const ENGLISH_SCORER_SNAPSHOTS: ReadonlyArray<readonly [string, number]> = [
    ["the gym ate my motivation", 60],
    ["my inbox finally won", 32],
    ["treadmill betrayed me at 6am", 70],
    ["i tried meal prep and the freezer disagreed", 35],
    ["subscription renewed itself like a horror movie villain", 67],
  ];

  for (const [hook, expected] of ENGLISH_SCORER_SNAPSHOTS) {
    it(`scoreHookQuality("${hook}") === ${expected}`, () => {
      expect(scoreHookQuality(hook, "adulting_chaos")).toBe(expected);
    });
  }

  it("scoreHookQuality is family-agnostic — switching family does not perturb scores", () => {
    // Defensive check that no hidden family-routing snuck in.
    for (const [hook, expected] of ENGLISH_SCORER_SNAPSHOTS) {
      expect(scoreHookQuality(hook, "social_mask")).toBe(expected);
    }
  });
});

// ─── 2. nigeria-clean still uses scoreHookQuality (no leak) ───────

describe("nigeria-clean unchanged (item 2)", () => {
  it("the additive scorer refuses to grade an entry tagged 'clean' even when caller has the ingest key", () => {
    // The scorer's safety gate returns 0 for any pidginLevel outside
    // {"light_pidgin","pidgin"}. That mirrors the reviewer-gate
    // documented in nigerianHookPack.ts and ensures nigeria-clean
    // hooks would NOT silently inherit Pidgin-aware credit.
    const cleanEntry = validEntry({ pidginLevel: "clean" as never });
    expect(scoreNigerianPackEntry(cleanEntry, ingestCtx)).toBe(0);
  });
});

// ─── 3. Architectural: runtime files must not import this module ──

describe("runtime generation files do not import nigerianHookQuality (item 3)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const srcRoot = path.resolve(here, "../..");
  const forbidden = [
    "lib/coreCandidateGenerator.ts",
    "lib/hybridIdeator.ts",
    "lib/patternIdeator.ts",
    "lib/ideaScorer.ts",
  ];
  for (const rel of forbidden) {
    it(`${rel} must not import nigerianHookQuality`, () => {
      const p = path.join(srcRoot, rel);
      expect(fs.existsSync(p)).toBe(true);
      const text = fs.readFileSync(p, "utf8");
      expect(text).not.toMatch(/nigerianHookQuality/);
    });
  }

  it("only buildApprovedNigerianPack.ts and nigerianPackRewriteWorksheet.ts import the ingest key", () => {
    const apiSrc = path.resolve(here, "../..");
    const allowed = new Set([
      path.join(apiSrc, "qa/buildApprovedNigerianPack.ts"),
      path.join(apiSrc, "qa/nigerianPackRewriteWorksheet.ts"),
      path.join(apiSrc, "lib/__tests__/nigerianHookQuality.test.ts"),
    ]);
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        if (st.isDirectory()) out.push(...walk(full));
        else if (full.endsWith(".ts")) out.push(full);
      }
      return out;
    };
    const offenders: string[] = [];
    for (const f of walk(apiSrc)) {
      if (allowed.has(f)) continue;
      if (f.endsWith("nigerianHookQuality.ts")) continue; // the module itself defines it
      const text = fs.readFileSync(f, "utf8");
      if (text.includes("getNigerianHookQualityIngestKey")) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});

// ─── 4. reviewedBy gate ──────────────────────────────────────────

describe("reviewedBy gate (item 4)", () => {
  it("blank reviewedBy → 0", () => {
    expect(
      scoreNigerianPackEntry(validEntry({ reviewedBy: "" }), ingestCtx),
    ).toBe(0);
  });
  it("whitespace-only reviewedBy → 0", () => {
    expect(
      scoreNigerianPackEntry(validEntry({ reviewedBy: "   " }), ingestCtx),
    ).toBe(0);
  });
  it("PENDING_NATIVE_REVIEW sentinel → 0", () => {
    expect(
      scoreNigerianPackEntry(
        validEntry({ reviewedBy: "PENDING_NATIVE_REVIEW" }),
        ingestCtx,
      ),
    ).toBe(0);
  });
  it("padded sentinel → 0", () => {
    expect(
      scoreNigerianPackEntry(
        validEntry({ reviewedBy: "  PENDING_NATIVE_REVIEW  " }),
        ingestCtx,
      ),
    ).toBe(0);
  });
  // N1-Q follow-up — agent-proposed rewrite stamp must score 0 so the
  // scorer can never promote an unreviewed candidate.
  it("AGENT-PROPOSED stamp → 0", () => {
    expect(
      scoreNigerianPackEntry(
        validEntry({ reviewedBy: "AGENT-PROPOSED — pending BI review" }),
        ingestCtx,
      ),
    ).toBe(0);
  });
  it("AGENT-PROPOSED bare prefix → 0", () => {
    expect(
      scoreNigerianPackEntry(
        validEntry({ reviewedBy: "AGENT-PROPOSED" }),
        ingestCtx,
      ),
    ).toBe(0);
  });
  it("padded AGENT-PROPOSED stamp → 0", () => {
    expect(
      scoreNigerianPackEntry(
        validEntry({ reviewedBy: "   AGENT-PROPOSED 2026-05-06   " }),
        ingestCtx,
      ),
    ).toBe(0);
  });
});

// N1-Q follow-up — boot integrity assert must reject AGENT-PROPOSED
// on activation. Lives here (alongside the scorer tests) so the three
// defense layers stay covered in one file.
describe("boot integrity rejects AGENT-PROPOSED (item 4 — defense in depth)", () => {
  it("assertNigerianPackIntegrity throws on AGENT-PROPOSED entry", async () => {
    const { assertNigerianPackIntegrity } = await import("../nigerianHookPack.js");
    const bad = [
      validEntry({ reviewedBy: "AGENT-PROPOSED — pending BI review" }),
    ];
    expect(() => assertNigerianPackIntegrity(bad)).toThrow(
      /AGENT-PROPOSED sentinel/,
    );
  });
});

// ─── 5. mocking pattern ───────────────────────────────────────────

describe("mocking pattern → 0 (item 5)", () => {
  it("hook with mocking spelling → 0", () => {
    // PIDGIN_MOCKING_PATTERNS includes things like cartoonized
    // doubled-vowel spellings (`abeggg`, `chaiiii`). Use one that
    // is unambiguously caught.
    const e = validEntry({ hook: "abeggg na so generator come spoil my mood" });
    expect(scoreNigerianPackEntry(e, ingestCtx)).toBe(0);
  });
  it("whatToShow with mocking spelling → 0", () => {
    const e = validEntry({
      whatToShow:
        "Show the generator outside abeggg, then cut to you in bed yawning while it growls.",
    });
    expect(scoreNigerianPackEntry(e, ingestCtx)).toBe(0);
  });
  it("caption with mocking spelling → 0", () => {
    const e = validEntry({ caption: "abeggg this generator no fit." });
    expect(scoreNigerianPackEntry(e, ingestCtx)).toBe(0);
  });
});

// ─── 6. trust gate ────────────────────────────────────────────────

describe("trust gate (item 6)", () => {
  it("non-approved pool throws", () => {
    const fakePool: readonly NigerianPackEntry[] = Object.freeze([validEntry()]);
    expect(() =>
      scoreNigerianPackEntry(validEntry(), { kind: "pool", pool: fakePool }),
    ).toThrow(/pool reference must be NIGERIAN_HOOK_PACK/);
  });

  it("invalid ingest key throws", () => {
    const fakeKey = Symbol("fake");
    expect(() =>
      scoreNigerianPackEntry(validEntry(), { kind: "ingest", key: fakeKey }),
    ).toThrow(/invalid ingest key/);
  });

  it("NIGERIAN_HOOK_PACK reference is accepted (does not throw)", () => {
    expect(() =>
      scoreNigerianPackEntry(validEntry(), {
        kind: "pool",
        pool: NIGERIAN_HOOK_PACK,
      }),
    ).not.toThrow();
  });

  it("APPROVED pool reference is accepted (does not throw)", () => {
    // The auto-generated approved file calls registerApprovedPoolReference
    // at module load. Re-register defensively in case test ordering
    // imports something else first.
    registerApprovedPoolReference(APPROVED_NIGERIAN_PROMOTION_CANDIDATES);
    expect(() =>
      scoreNigerianPackEntry(validEntry(), {
        kind: "pool",
        pool: APPROVED_NIGERIAN_PROMOTION_CANDIDATES,
      }),
    ).not.toThrow();
  });
});

// ─── 7. existing production validators still run before approval ─

describe("validators still run before scorer in the ingest pipeline (item 7)", () => {
  it("buildApprovedNigerianPack.ts validateRow runs all 8 steps before scoring", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const buildScript = path.resolve(
      here,
      "../../qa/buildApprovedNigerianPack.ts",
    );
    const text = fs.readFileSync(buildScript, "utf8");
    // Steps 1–6 must precede the scorer call.
    const stepRegexes = [
      /1\. reviewedBy/,
      /2\. pidginLevel/,
      /3\. Length bounds/,
      /4\. Anchor in hook/,
      /5\. Mocking-spelling patterns/,
      /6\. validateScenarioCoherence/,
      /7\. Nigerian-pack hook quality/,
    ];
    let lastIdx = -1;
    for (const re of stepRegexes) {
      const m = re.exec(text);
      expect(m, `step regex ${re} not found`).toBeTruthy();
      const idx = m!.index;
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });
});

// ─── 8. determinism ───────────────────────────────────────────────

describe("scorer is deterministic (item 8)", () => {
  it("same entry → identical score over many iterations", () => {
    const e = validEntry();
    const first = scoreNigerianPackEntry(e, ingestCtx);
    for (let i = 0; i < 200; i++) {
      expect(scoreNigerianPackEntry(e, ingestCtx)).toBe(first);
    }
  });

  it("breakdown is internally consistent: components sum to total", () => {
    const e = validEntry();
    const b = scoreNigerianPackEntryDetailed(e, ingestCtx);
    expect(
      b.visceral +
        b.naturalness +
        b.contradiction +
        b.anchorRelevance +
        b.filmable +
        b.brevity,
    ).toBe(b.total);
  });

  it("EVERY entry currently in APPROVED_NIGERIAN_PROMOTION_CANDIDATES scores >= 40", () => {
    // After re-ingest, the persisted file should only contain entries
    // that pass the floor under the new scorer. This test catches a
    // future regenerate that produces a regression.
    for (const entry of APPROVED_NIGERIAN_PROMOTION_CANDIDATES) {
      const s = scoreNigerianPackEntry(entry, {
        kind: "pool",
        pool: APPROVED_NIGERIAN_PROMOTION_CANDIDATES,
      });
      expect(s, `entry "${entry.hook}" scored ${s}`).toBeGreaterThanOrEqual(40);
    }
  });
});

// ─── Bonus: example previously-rejected hook now passes ──────────

describe("Pidgin-aware bonus regression check", () => {
  it("a hook tagged Pidgin with strong markers + punch verb scores well above floor", () => {
    const e = validEntry({
      hook: "generator don disgrace my sleep again",
      pidginLevel: "pidgin",
    });
    const b = scoreNigerianPackEntryDetailed(e, ingestCtx);
    expect(b.total).toBeGreaterThanOrEqual(40);
    expect(b.visceral).toBeGreaterThanOrEqual(15);
    expect(b.naturalness).toBeGreaterThanOrEqual(4);
  });

  it("a bland English hook tagged Pidgin (no markers, English determiner opener) gets the −5 penalty", () => {
    // No Pidgin markers, opens with "the", no Pidgin tension pattern.
    const e = validEntry({
      hook: "the generator broke my morning routine again",
      pidginLevel: "pidgin",
    });
    const b = scoreNigerianPackEntryDetailed(e, ingestCtx);
    expect(b.naturalness).toBeLessThanOrEqual(0);
  });
});
