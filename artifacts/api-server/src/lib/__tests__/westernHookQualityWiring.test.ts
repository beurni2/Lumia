/**
 * PHASE W1 — wiring regression guard.
 *
 * The Western catalog hook adjustment MUST be applied at the catalog
 * `scoreHookQuality` site only, NEVER at the pack-prefix site. Pack
 * candidates are atomic reviewer-stamped entries (cf. nigerianHookPackApproved.ts)
 * and the spec mandates pack candidates receive ZERO Western
 * adjustment.
 *
 * This static-source assertion mirrors `nigerianStylePenaltyWiring.test.ts`:
 * any future edit that drops a `computeWesternHookAdjustment(...)`
 * call inside the pack-prefix block (between the
 * `PHASE N1-INSTRUMENT — opt-in throttle observer` /
 * `PHASE N1-INSTRUMENT — emit throttle record` markers) will fail
 * this test immediately.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE_GEN_PATH = resolve(HERE, "..", "coreCandidateGenerator.ts");

describe("W1 wiring — coreCandidateGenerator.ts", () => {
  const src = readFileSync(CORE_GEN_PATH, "utf8");
  const lines = src.split("\n");

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

  it("computeWesternHookAdjustment is wired exactly once (single source of truth)", () => {
    const callMatches = src.match(/computeWesternHookAdjustment\(/g) ?? [];
    expect(callMatches.length).toBe(1);
  });

  it("the single call site lives OUTSIDE the pack-prefix block", () => {
    const callLineIdx = lines.findIndex((l) =>
      /computeWesternHookAdjustment\(/.test(l),
    );
    expect(callLineIdx).toBeGreaterThan(-1);
    const insidePackBlock =
      callLineIdx >= packBlockStartLine && callLineIdx <= packBlockEndLine;
    expect(insidePackBlock).toBe(false);
    expect(callLineIdx).toBeGreaterThan(packBlockEndLine);
  });

  it("call site is preceded by the PHASE W1 marker (documentation invariant)", () => {
    const callLineIdx = lines.findIndex((l) =>
      /computeWesternHookAdjustment\(/.test(l),
    );
    const window = lines.slice(Math.max(0, callLineIdx - 15), callLineIdx);
    const hasMarker = window.some((l) => l.includes("PHASE W1"));
    expect(hasMarker).toBe(true);
  });
});
