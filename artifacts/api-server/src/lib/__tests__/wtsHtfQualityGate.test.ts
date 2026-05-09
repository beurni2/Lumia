/**
 * PHASE W2-AUTHOR HYBRID — wtsHtfQualityGate unit tests.
 *
 * Pure-function coverage of the deterministic V2 quality gate:
 *   - every banned phrase is rejected case-insensitively
 *   - benign positive examples pass
 *   - `show the <noun> on camera` placeholder is rejected
 *   - byte-identical wts/htf is rejected
 *   - pickFromPoolWithGate rotates deterministically
 *   - pickFromPoolWithGate falls through after retries (NEVER
 *     returns undefined, NEVER under-fills)
 */

import { describe, expect, it } from "vitest";

import {
  WTS_HTF_BANNED_RE,
  passesV2Gate,
  pickFromPoolWithGate,
} from "../wtsHtfQualityGate";

const PASSING_HTF =
  "Frame yourself and the desk together at chest height. Reach, hesitate, set the mug down, then cut on the moment your face says you knew better.";
const PASSING_WTS =
  "Walk into frame like you have a plan, notice the desk, then set the mug down anyway because apparently this is who you are today.";

describe("WTS_HTF_BANNED_RE", () => {
  const banned = [
    "Phone on a tripod, just shoot it.",
    "Single static shot of the kitchen.",
    "Single locked-off shot at eye level.",
    "single locked off shot at eye level.",
    "Locked-off on tripod, no cuts.",
    "locked off on tripod, no cuts.",
    "Let the joke land on its own.",
    "Film yourself reacting to the screen.",
    "Creator reacts to the news.",
    "Show the wallet on camera, plain.",
    "Show the FRIDGE on camera while you stare.",
  ];
  it("rejects every banned phrase (case-insensitive)", () => {
    for (const s of banned) {
      expect(WTS_HTF_BANNED_RE.test(s)).toBe(true);
    }
  });
  it("does not reject neutral concrete copy", () => {
    const positives = [
      "Hold the phone vertically at face level so the screen glow lights you.",
      "Counter-height shelf shot, one continuous take.",
      "Frame the bed and alarm together from beside the nightstand.",
      "Catch yourself reaching for the wallet, pull back, then pay anyway.",
    ];
    for (const s of positives) {
      expect(WTS_HTF_BANNED_RE.test(s)).toBe(false);
    }
  });
});

describe("passesV2Gate", () => {
  it("passes a clean (wts, htf) pair", () => {
    expect(passesV2Gate(PASSING_WTS, PASSING_HTF)).toBe(true);
  });
  it("rejects when wts is byte-identical to htf", () => {
    expect(passesV2Gate(PASSING_WTS, PASSING_WTS)).toBe(false);
  });
  it("rejects when wts contains a banned phrase", () => {
    expect(
      passesV2Gate(
        "Show the wallet on camera and pay.",
        PASSING_HTF,
      ),
    ).toBe(false);
  });
  it("rejects when htf contains a banned phrase", () => {
    expect(
      passesV2Gate(
        PASSING_WTS,
        "Phone on a tripod. Single static shot.",
      ),
    ).toBe(false);
  });
  it("rejects placeholder `show the X on camera` regardless of case", () => {
    expect(
      passesV2Gate(
        "SHOW THE WALLET ON CAMERA briefly.",
        PASSING_HTF,
      ),
    ).toBe(false);
  });
  it("returns false on non-string input (defensive)", () => {
    // @ts-expect-error — defensive runtime guard
    expect(passesV2Gate(undefined, PASSING_HTF)).toBe(false);
    // @ts-expect-error — defensive runtime guard
    expect(passesV2Gate(PASSING_WTS, null)).toBe(false);
  });
});

describe("pickFromPoolWithGate", () => {
  type Item = { id: number; bad: boolean };
  const POOL: ReadonlyArray<Item> = [
    { id: 0, bad: true },
    { id: 1, bad: false },
    { id: 2, bad: true },
    { id: 3, bad: false },
  ];
  function render(item: Item): {
    value: Item;
    whatToShow: string;
    howToFilm: string;
  } {
    return {
      value: item,
      whatToShow: item.bad ? "Phone on a tripod." : PASSING_WTS,
      howToFilm: PASSING_HTF + ` // ${item.id}`,
    };
  }

  it("returns the first passing item rotating from idx", () => {
    // start = 0 → idx 0 fails, idx 1 passes
    const r = pickFromPoolWithGate(POOL, 0, render, 4);
    expect(r.id).toBe(1);
  });

  it("rotates deterministically across calls", () => {
    const a = pickFromPoolWithGate(POOL, 2, render, 4);
    const b = pickFromPoolWithGate(POOL, 2, render, 4);
    expect(a.id).toBe(b.id);
    // start = 2 → idx 2 fails, idx 3 passes
    expect(a.id).toBe(3);
  });

  it("wraps idx into [0, len)", () => {
    const r = pickFromPoolWithGate(POOL, -1, render, 4);
    // start = ((-1 % 4) + 4) % 4 = 3 → idx 3 passes immediately
    expect(r.id).toBe(3);
  });

  it("falls through to the original idx when every retry fails", () => {
    const allBad: ReadonlyArray<Item> = [
      { id: 10, bad: true },
      { id: 11, bad: true },
    ];
    const r = pickFromPoolWithGate(allBad, 1, render, 4);
    expect(r).toBeDefined();
    expect(r.id).toBe(11); // idx wraps within [0,2); start=1 is original
  });

  it("never returns undefined when pool is non-empty", () => {
    for (let i = 0; i < 32; i++) {
      const r = pickFromPoolWithGate(POOL, i, render, 4);
      expect(r).toBeDefined();
    }
  });

  it("throws on empty pool (programming error)", () => {
    expect(() => pickFromPoolWithGate([], 0, render, 4)).toThrow();
  });
});
