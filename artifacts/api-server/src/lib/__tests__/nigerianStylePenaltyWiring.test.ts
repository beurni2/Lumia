/**
 * PHASE N1-STYLE — wiring regression guard.
 *
 * The American-internet style penalty MUST be applied at the
 * catalog `scoreHookQuality` site only, NEVER at the pack-prefix
 * site. Pack hooks are reviewer-stamped (`BI 2026-05-06`) and
 * exempt by construction; penalising them would defeat the entire
 * pack mechanism (a low-quality American-style catalog hook could
 * out-rank a stamped pack hook if both received a penalty).
 *
 * The N1-INSTRUMENT throttle observer + production wiring share
 * the same file region; future edits could plausibly drop a
 * `computeNigerianStylePenalty(...)` call inside the pack-prefix
 * block. This static-source assertion catches that immediately.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE_GEN_PATH = resolve(HERE, "..", "coreCandidateGenerator.ts");

describe("N1-STYLE wiring — coreCandidateGenerator.ts", () => {
  const src = readFileSync(CORE_GEN_PATH, "utf8");
  const lines = src.split("\n");

  // Locate the pack-prefix block. It opens with the
  // `PHASE N1-INSTRUMENT — opt-in throttle observer` marker and
  // closes at the matching `PHASE N1-INSTRUMENT — emit throttle
  // record` marker. These two markers exist ONLY around the pack
  // block; the catalog scoring block uses different comments.
  const packBlockStartLine = lines.findIndex((l) =>
    l.includes("PHASE N1-INSTRUMENT — opt-in throttle observer"),
  );
  const packBlockEndLine = lines.findIndex((l) =>
    l.includes("PHASE N1-INSTRUMENT — emit throttle record"),
  );

  it("pack-prefix block markers are present and ordered", () => {
    expect(packBlockStartLine).toBeGreaterThan(-1);
    expect(packBlockEndLine).toBeGreaterThan(packBlockStartLine);
  });

  it("computeNigerianStylePenalty is wired exactly once (single source of truth)", () => {
    const callMatches = src.match(/computeNigerianStylePenalty\(/g) ?? [];
    expect(callMatches.length).toBe(1);
  });

  it("the single call site lives OUTSIDE the pack-prefix block", () => {
    const callLineIdx = lines.findIndex((l) =>
      /computeNigerianStylePenalty\(/.test(l),
    );
    expect(callLineIdx).toBeGreaterThan(-1);
    // The call must be AFTER the pack-prefix block ends, i.e. in
    // the catalog scoring region. Equivalently: never inside the
    // [packBlockStart, packBlockEnd] range.
    const insidePackBlock =
      callLineIdx >= packBlockStartLine && callLineIdx <= packBlockEndLine;
    expect(insidePackBlock).toBe(false);
    expect(callLineIdx).toBeGreaterThan(packBlockEndLine);
  });

  it("call site is preceded by the PHASE N1-STYLE marker (documentation invariant)", () => {
    const callLineIdx = lines.findIndex((l) =>
      /computeNigerianStylePenalty\(/.test(l),
    );
    // Look back up to 15 lines for the marker.
    const window = lines.slice(Math.max(0, callLineIdx - 15), callLineIdx);
    const hasMarker = window.some((l) => l.includes("PHASE N1-STYLE"));
    expect(hasMarker).toBe(true);
  });
});
