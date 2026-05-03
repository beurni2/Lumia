import { describe, expect, it } from "vitest";

import {
  buildHookLookup,
  buildWillingnessReport,
  type HookCacheRecord,
  type SignalRow,
} from "../../routes/z1Qa";

describe("buildHookLookup", () => {
  it("extracts willingnessScore + pickerEligible from current and history", () => {
    const env = {
      version: 2,
      current: [
        {
          idea: {
            hook: "current hook",
            willingnessScore: 82,
            pickerEligible: true,
          },
        },
      ],
      history: [
        [
          {
            idea: {
              hook: "old hook",
              willingnessScore: 41,
              pickerEligible: false,
            },
          },
        ],
      ],
    };
    const map = buildHookLookup(env);
    expect(map.size).toBe(2);
    expect(map.get("current hook")).toEqual({
      willingnessScore: 82,
      pickerEligible: true,
    });
    expect(map.get("old hook")).toEqual({
      willingnessScore: 41,
      pickerEligible: false,
    });
  });

  it("prefers current-batch annotation when the same hook appears in both", () => {
    const env = {
      current: [
        {
          idea: {
            hook: "same hook",
            willingnessScore: 90,
            pickerEligible: true,
          },
        },
      ],
      history: [
        [
          {
            idea: {
              hook: "same hook",
              willingnessScore: 30,
              pickerEligible: false,
            },
          },
        ],
      ],
    };
    const map = buildHookLookup(env);
    expect(map.get("same hook")?.pickerEligible).toBe(true);
    expect(map.get("same hook")?.willingnessScore).toBe(90);
  });

  it("treats pre-Z1 entries (no Z1 fields) as null records", () => {
    const env = {
      current: [{ idea: { hook: "pre-z1 hook" } }],
      history: [],
    };
    const map = buildHookLookup(env);
    expect(map.get("pre-z1 hook")).toEqual({
      willingnessScore: null,
      pickerEligible: null,
    });
  });

  it("returns an empty map for malformed input", () => {
    expect(buildHookLookup(null).size).toBe(0);
    expect(buildHookLookup("not json").size).toBe(0);
    expect(buildHookLookup({ wrong: "shape" }).size).toBe(0);
  });
});

describe("buildWillingnessReport", () => {
  const creator1 = "00000000-0000-0000-0000-000000000001";
  const creator2 = "00000000-0000-0000-0000-000000000002";

  function rec(ws: number, pe: boolean): HookCacheRecord {
    return { willingnessScore: ws, pickerEligible: pe };
  }
  function sig(
    creatorId: string,
    ideaHook: string,
    signalType: string,
  ): SignalRow {
    return { creatorId, ideaHook, signalType, createdAt: new Date() };
  }

  it("classifies signals into eligible / ineligible / unknown tiers", () => {
    const lookup = new Map<string, Map<string, HookCacheRecord>>();
    lookup.set(
      creator1,
      new Map([
        ["eligible hook", rec(80, true)],
        ["ineligible hook", rec(20, false)],
      ]),
    );
    const signals: SignalRow[] = [
      sig(creator1, "eligible hook", "selected"),
      sig(creator1, "eligible hook", "exported"),
      sig(creator1, "ineligible hook", "selected"),
      sig(creator1, "missing hook", "selected"),
    ];
    const report = buildWillingnessReport(7, signals, lookup);

    expect(report.totalSignals).toBe(4);
    expect(report.totalCreators).toBe(1);
    expect(report.totalHooksMatched).toBe(3);
    expect(report.totalHooksUnmatched).toBe(1);
    expect(report.totalsByTier).toEqual({
      eligible: 2,
      ineligible: 1,
      unknown: 1,
    });
    expect(report.bySignalType.selected?.total).toBe(3);
    expect(report.bySignalType.selected?.byTier).toEqual({
      eligible: 1,
      ineligible: 1,
      unknown: 1,
    });
    expect(report.bySignalType.exported?.total).toBe(1);
    expect(report.bySignalType.exported?.byTier.eligible).toBe(1);
  });

  it("computes median willingness per signal type from matched hooks only", () => {
    const lookup = new Map<string, Map<string, HookCacheRecord>>();
    lookup.set(
      creator1,
      new Map([
        ["a", rec(20, false)],
        ["b", rec(40, true)],
        ["c", rec(80, true)],
      ]),
    );
    const signals: SignalRow[] = [
      sig(creator1, "a", "exported"),
      sig(creator1, "b", "exported"),
      sig(creator1, "c", "exported"),
      sig(creator1, "missing", "exported"),
    ];
    const report = buildWillingnessReport(7, signals, lookup);
    // Median of [20, 40, 80] = 40. The unmatched "missing" hook
    // contributes nothing to the willingness sample.
    expect(report.bySignalType.exported?.medianWillingness).toBe(40);
  });

  it("handles a multi-creator window without leaking lookups across creators", () => {
    const lookup = new Map<string, Map<string, HookCacheRecord>>();
    lookup.set(creator1, new Map([["shared hook", rec(90, true)]]));
    lookup.set(creator2, new Map([["shared hook", rec(10, false)]]));
    const signals: SignalRow[] = [
      sig(creator1, "shared hook", "selected"),
      sig(creator2, "shared hook", "selected"),
    ];
    const report = buildWillingnessReport(7, signals, lookup);
    expect(report.totalCreators).toBe(2);
    expect(report.totalsByTier.eligible).toBe(1);
    expect(report.totalsByTier.ineligible).toBe(1);
  });

  it("returns an empty report shape when there are no signals", () => {
    const report = buildWillingnessReport(7, [], new Map());
    expect(report.totalSignals).toBe(0);
    expect(report.totalCreators).toBe(0);
    expect(report.totalsByTier).toEqual({
      eligible: 0,
      ineligible: 0,
      unknown: 0,
    });
    expect(report.bySignalType).toEqual({});
  });
});
