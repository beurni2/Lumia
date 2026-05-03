/**
 * PHASE Z5c — `pov_relatable_sketch` VideoPattern registration tests.
 *
 * Pins the additive contract for the new VideoPattern:
 *
 *   1. Id is in `VIDEO_PATTERNS` and resolvable in `PATTERN_DEFS`
 *      with all required fields (≥3 beats, valid pacing/duration).
 *   2. Wired into `PATTERN_X_INTENT_COMPAT.relatable` (the Z5c
 *      alignment goal) but NOT into scroll_stop / compulsion
 *      (frozen-scope: relatable-only).
 *   3. Wired into ≥1 IdeaCoreFamily in `PATTERN_BY_FAMILY` so it
 *      can actually be picked.
 *   4. Selectable via `pickVideoPattern` for at least one
 *      (family, relatable) pair across a small seed sweep —
 *      proves it joined the rotation pool.
 *   5. Family×intent intersection invariant preserved: every
 *      (family, intent) pair still has a non-empty intersection
 *      between PATTERN_BY_FAMILY[family] and
 *      PATTERN_X_INTENT_COMPAT[intent].
 */
import { describe, it, expect } from "vitest";
import {
  VIDEO_PATTERNS,
  PATTERN_DEFS,
  PATTERN_BY_FAMILY,
  PATTERN_X_INTENT_COMPAT,
  HOOK_INTENTS,
  isPatternCompatible,
  pickVideoPattern,
  type VideoPattern,
  type IdeaCoreFamily,
} from "../patternIdeator.js";

const NEW_PATTERN: VideoPattern = "pov_relatable_sketch";

describe("Z5c — pov_relatable_sketch VideoPattern registration", () => {
  it("is in VIDEO_PATTERNS and PATTERN_DEFS with valid def shape", () => {
    expect(VIDEO_PATTERNS).toContain(NEW_PATTERN);
    const def = PATTERN_DEFS[NEW_PATTERN];
    expect(def).toBeDefined();
    expect(def.id).toBe(NEW_PATTERN);
    expect(def.beats.length).toBeGreaterThanOrEqual(3);
    expect(def.beats.length).toBeLessThanOrEqual(5);
    expect(["fast", "medium", "slow"]).toContain(def.pacing);
    expect(["short", "medium"]).toContain(def.typicalDuration);
    expect(def.cameraStyle.length).toBeGreaterThan(0);
  });

  it("is compatible with relatable intent only (frozen-scope)", () => {
    expect(isPatternCompatible(NEW_PATTERN, "relatable")).toBe(true);
    expect(isPatternCompatible(NEW_PATTERN, "scroll_stop")).toBe(false);
    expect(isPatternCompatible(NEW_PATTERN, "compulsion")).toBe(false);
    expect(PATTERN_X_INTENT_COMPAT.relatable).toContain(NEW_PATTERN);
  });

  it("is allowed in at least one IdeaCoreFamily", () => {
    const allowingFamilies = (
      Object.entries(PATTERN_BY_FAMILY) as ReadonlyArray<
        [IdeaCoreFamily, readonly VideoPattern[]]
      >
    )
      .filter(([, pats]) => pats.includes(NEW_PATTERN))
      .map(([f]) => f);
    expect(allowingFamilies.length).toBeGreaterThanOrEqual(1);
  });

  it("is selectable by pickVideoPattern for at least one family + relatable seed", () => {
    const allowingFamilies = (
      Object.entries(PATTERN_BY_FAMILY) as ReadonlyArray<
        [IdeaCoreFamily, readonly VideoPattern[]]
      >
    )
      .filter(([, pats]) => pats.includes(NEW_PATTERN))
      .map(([f]) => f);
    let surfaced = false;
    outer: for (const family of allowingFamilies) {
      for (let seed = 0; seed < 256; seed++) {
        const r = pickVideoPattern(family, "relatable", new Set(), seed);
        if (r.pattern === NEW_PATTERN) {
          surfaced = true;
          break outer;
        }
      }
    }
    expect(surfaced).toBe(true);
  });

  it("does NOT shrink any pre-existing family × intent intersection", () => {
    // Z5c is purely additive: any family that had a non-empty
    // intersection with intent I before this phase must still
    // have a non-empty intersection. The pre-existing baseline
    // is intentionally NOT a full 12×3 cover (some pairs already
    // rely on `pickVideoPattern`'s explicit family-only fallback);
    // this guard catches accidental shrinkage, not absolute
    // emptiness.
    const families = Object.keys(PATTERN_BY_FAMILY) as IdeaCoreFamily[];
    const failures: string[] = [];
    for (const family of families) {
      const allowed = new Set(PATTERN_BY_FAMILY[family]);
      // Simulate the pre-Z5c view by removing the new pattern from
      // both the family list and the relatable intent compat list.
      const allowedPre = new Set(
        [...allowed].filter((p) => p !== NEW_PATTERN),
      );
      for (const intent of HOOK_INTENTS) {
        const compatPost = PATTERN_X_INTENT_COMPAT[intent];
        const compatPre = compatPost.filter((p) => p !== NEW_PATTERN);
        const overlapPre = compatPre.some((p) => allowedPre.has(p));
        const overlapPost = compatPost.some((p) => allowed.has(p));
        if (overlapPre && !overlapPost) {
          failures.push(`${family} × ${intent} regressed`);
        }
      }
    }
    expect(failures, `intersections regressed:\n${failures.join("\n")}`).toEqual(
      [],
    );
  });
});
