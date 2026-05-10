/**
 * PHASE N1-FOLLOWUP-NG-CLEAN-FIRST-CARD-CORE-RESERVATION — unit tests.
 *
 * Covers `applyNgCleanFirstCardCoreReservation`:
 *   • SWAP-ONLY length preservation
 *   • slot 0 is NEVER written
 *   • only `pickerEligible` clean-core candidates are reserved
 *   • distinct `cleanCoreEntryId` dedup vs final[] AND inside the
 *     same reservation pass
 *   • no-op when preCount >= MIN
 *   • no-op when sidecar empty
 *   • no-op when no replaceable non-clean-core slot exists
 *   • configurable per-call MIN/PREFERRED/MAX targets
 *   • design ceiling clamping
 *   • lowest-priority replacement order (last → first)
 *   • determinism: same inputs ⇒ same output
 *   • returns input reference unchanged on no-op
 */
import { describe, expect, it } from "vitest";
import {
  applyNgCleanFirstCardCoreReservation,
  isNgCleanFirstCardReservationEnabled,
  MAX_NG_CLEAN_FIRST_CARD_CORE_CANDIDATES,
  MIN_NG_CLEAN_FIRST_CARD_CORE_CANDIDATES,
  PREFERRED_NG_CLEAN_FIRST_CARD_CORE_CANDIDATES,
  NG_CLEAN_FIRST_CARD_RESERVATION_FLAG_ENV,
  NG_CLEAN_PER_CORE_RETENTION_CAP,
  NG_CLEAN_RETENTION_HQS_FLOOR,
} from "../ngCleanFirstCardCoreReservation.js";
import { NIGERIAN_CLEAN_CORE_ENTRIES } from "../nigerianCleanCorePack.js";

type TestCand = { idea: { hook: string; pickerEligible?: boolean } };

const cleanById = (id: string) => {
  const e = NIGERIAN_CLEAN_CORE_ENTRIES.find((x) => x.id === id);
  if (!e) throw new Error(`unknown clean-core id: ${id}`);
  return e;
};

const cleanCand = (
  id: string,
  opts: { pickerEligible?: boolean } = {},
): TestCand => ({
  idea: {
    hook: cleanById(id).hook,
    pickerEligible: opts.pickerEligible ?? true,
  },
});

const filler = (
  hook: string,
  opts: { pickerEligible?: boolean } = {},
): TestCand => ({
  idea: { hook, pickerEligible: opts.pickerEligible ?? true },
});

describe("constants", () => {
  it("MIN/PREFERRED/MAX form a non-decreasing series with the design ceiling at MAX", () => {
    expect(MIN_NG_CLEAN_FIRST_CARD_CORE_CANDIDATES).toBe(3);
    expect(PREFERRED_NG_CLEAN_FIRST_CARD_CORE_CANDIDATES).toBe(5);
    expect(MAX_NG_CLEAN_FIRST_CARD_CORE_CANDIDATES).toBe(8);
    expect(MIN_NG_CLEAN_FIRST_CARD_CORE_CANDIDATES).toBeLessThanOrEqual(
      PREFERRED_NG_CLEAN_FIRST_CARD_CORE_CANDIDATES,
    );
    expect(PREFERRED_NG_CLEAN_FIRST_CARD_CORE_CANDIDATES).toBeLessThanOrEqual(
      MAX_NG_CLEAN_FIRST_CARD_CORE_CANDIDATES,
    );
  });
  it("per-core retention cap is positive and HQS floor mirrors PICKER_HQS_FLOOR", () => {
    expect(NG_CLEAN_PER_CORE_RETENTION_CAP).toBeGreaterThanOrEqual(2);
    expect(NG_CLEAN_RETENTION_HQS_FLOOR).toBe(50);
  });
  it("flag env var name is the staging-only constant", () => {
    expect(NG_CLEAN_FIRST_CARD_RESERVATION_FLAG_ENV).toBe(
      "LUMINA_NG_CLEAN_FIRST_CARD_RESERVATION_ENABLED",
    );
  });
});

describe("isNgCleanFirstCardReservationEnabled", () => {
  it("returns false when the env var is unset", () => {
    const prev = process.env[NG_CLEAN_FIRST_CARD_RESERVATION_FLAG_ENV];
    delete process.env[NG_CLEAN_FIRST_CARD_RESERVATION_FLAG_ENV];
    try {
      expect(isNgCleanFirstCardReservationEnabled()).toBe(false);
    } finally {
      if (prev !== undefined)
        process.env[NG_CLEAN_FIRST_CARD_RESERVATION_FLAG_ENV] = prev;
    }
  });
  it("returns true ONLY for the literal string 'true'", () => {
    const prev = process.env[NG_CLEAN_FIRST_CARD_RESERVATION_FLAG_ENV];
    try {
      process.env[NG_CLEAN_FIRST_CARD_RESERVATION_FLAG_ENV] = "true";
      expect(isNgCleanFirstCardReservationEnabled()).toBe(true);
      process.env[NG_CLEAN_FIRST_CARD_RESERVATION_FLAG_ENV] = "1";
      expect(isNgCleanFirstCardReservationEnabled()).toBe(false);
      process.env[NG_CLEAN_FIRST_CARD_RESERVATION_FLAG_ENV] = "TRUE";
      expect(isNgCleanFirstCardReservationEnabled()).toBe(false);
    } finally {
      if (prev === undefined)
        delete process.env[NG_CLEAN_FIRST_CARD_RESERVATION_FLAG_ENV];
      else process.env[NG_CLEAN_FIRST_CARD_RESERVATION_FLAG_ENV] = prev;
    }
  });
});

describe("applyNgCleanFirstCardCoreReservation", () => {
  it("(1) reserves 2 distinct clean-core into final[] when preCount=1 < MIN=3", () => {
    const final: TestCand[] = [
      cleanCand("ng_clean_001"),
      filler("filler a"),
      filler("filler b"),
      filler("filler c"),
      filler("filler d"),
    ];
    const sidecar: TestCand[] = [
      cleanCand("ng_clean_039"),
      cleanCand("ng_clean_023"),
    ];
    const r = applyNgCleanFirstCardCoreReservation(final, {
      sidecarPool: sidecar,
    });
    expect(r.reservedCount).toBe(2);
    expect(r.preCount).toBe(1);
    expect(r.postCount).toBe(3);
    expect(r.final.length).toBe(final.length);
    expect(r.final[0]).toBe(final[0]); // slot 0 untouched
  });

  it("(2) NEVER writes slot 0", () => {
    const final: TestCand[] = [
      filler("non clean"),
      cleanCand("ng_clean_001"),
      filler("filler a"),
      filler("filler b"),
    ];
    const sidecar: TestCand[] = [
      cleanCand("ng_clean_039"),
      cleanCand("ng_clean_023"),
    ];
    const r = applyNgCleanFirstCardCoreReservation(final, {
      sidecarPool: sidecar,
    });
    expect(r.final[0]).toBe(final[0]);
    for (const idx of r.replacedIndexes) {
      expect(idx).toBeGreaterThanOrEqual(1);
    }
  });

  it("(3) preserves length under all branches", () => {
    const final: TestCand[] = [
      cleanCand("ng_clean_001"),
      filler("a"),
      filler("b"),
      filler("c"),
      filler("d"),
    ];
    const sidecar: TestCand[] = [
      cleanCand("ng_clean_039"),
      cleanCand("ng_clean_023"),
      cleanCand("ng_clean_004"),
    ];
    const r = applyNgCleanFirstCardCoreReservation(final, {
      sidecarPool: sidecar,
    });
    expect(r.final.length).toBe(final.length);
  });

  it("(4) skips sidecar candidates that are not pickerEligible", () => {
    const final: TestCand[] = [
      cleanCand("ng_clean_001"),
      filler("a"),
      filler("b"),
      filler("c"),
    ];
    const sidecar: TestCand[] = [
      cleanCand("ng_clean_039", { pickerEligible: false }),
      cleanCand("ng_clean_023", { pickerEligible: false }),
    ];
    const r = applyNgCleanFirstCardCoreReservation(final, {
      sidecarPool: sidecar,
    });
    expect(r.reservedCount).toBe(0);
    expect(r.final).toBe(final);
  });

  it("(5) skips sidecar candidates whose hook does NOT resolve to a clean-core entry id", () => {
    const final: TestCand[] = [
      cleanCand("ng_clean_001"),
      filler("a"),
      filler("b"),
    ];
    const sidecar: TestCand[] = [
      filler("the fridge knows i'm lying."),
      filler("a non clean hook"),
    ];
    const r = applyNgCleanFirstCardCoreReservation(final, {
      sidecarPool: sidecar,
    });
    expect(r.reservedCount).toBe(0);
    expect(r.final).toBe(final);
  });

  it("(6) dedups sidecar candidates whose entry id is already in final[]", () => {
    const final: TestCand[] = [
      cleanCand("ng_clean_001"),
      filler("a"),
      filler("b"),
      filler("c"),
    ];
    const sidecar: TestCand[] = [
      cleanCand("ng_clean_001"), // duplicate of final[0]
      cleanCand("ng_clean_039"),
      cleanCand("ng_clean_023"),
    ];
    const r = applyNgCleanFirstCardCoreReservation(final, {
      sidecarPool: sidecar,
    });
    expect(r.reservedEntryIds).toEqual(["ng_clean_039", "ng_clean_023"]);
  });

  it("(7) dedups inside the same reservation pass (no two reservations of same entry id)", () => {
    const final: TestCand[] = [
      cleanCand("ng_clean_001"),
      filler("a"),
      filler("b"),
      filler("c"),
    ];
    const sidecar: TestCand[] = [
      cleanCand("ng_clean_039"),
      cleanCand("ng_clean_039"),
      cleanCand("ng_clean_023"),
    ];
    const r = applyNgCleanFirstCardCoreReservation(final, {
      sidecarPool: sidecar,
    });
    expect(new Set(r.reservedEntryIds).size).toBe(r.reservedEntryIds.length);
    expect(r.reservedEntryIds).toEqual(["ng_clean_039", "ng_clean_023"]);
  });

  it("(8) is a no-op when preCount >= MIN and the input reference is returned unchanged", () => {
    const final: TestCand[] = [
      cleanCand("ng_clean_001"),
      cleanCand("ng_clean_039"),
      cleanCand("ng_clean_023"),
      filler("a"),
    ];
    const sidecar: TestCand[] = [cleanCand("ng_clean_004")];
    const r = applyNgCleanFirstCardCoreReservation(final, {
      sidecarPool: sidecar,
    });
    expect(r.reservedCount).toBe(0);
    expect(r.final).toBe(final);
    expect(r.preCount).toBe(3);
    expect(r.postCount).toBe(3);
  });

  it("(9) is a no-op when sidecar pool is empty", () => {
    const final: TestCand[] = [
      cleanCand("ng_clean_001"),
      filler("a"),
      filler("b"),
    ];
    const r = applyNgCleanFirstCardCoreReservation(final, { sidecarPool: [] });
    expect(r.reservedCount).toBe(0);
    expect(r.final).toBe(final);
  });

  it("(10) is a no-op when there are no replaceable non-clean-core slots beyond slot 0", () => {
    const final: TestCand[] = [
      cleanCand("ng_clean_001"),
      cleanCand("ng_clean_039"),
    ];
    // preCount=2, MIN=3 ⇒ would attempt to reserve, but only slot 1
    // is non-slot-0 and it's already clean-core ⇒ no replaceable slot.
    const sidecar: TestCand[] = [cleanCand("ng_clean_023")];
    const r = applyNgCleanFirstCardCoreReservation(final, {
      sidecarPool: sidecar,
    });
    expect(r.reservedCount).toBe(0);
  });

  it("(11) replaces lowest-priority non-clean-core slots first (last → first)", () => {
    const final: TestCand[] = [
      cleanCand("ng_clean_001"),
      filler("rank-1 high"),
      filler("rank-2 mid"),
      filler("rank-3 low"),
    ];
    const sidecar: TestCand[] = [cleanCand("ng_clean_039")];
    const r = applyNgCleanFirstCardCoreReservation(final, {
      sidecarPool: sidecar,
    });
    expect(r.reservedCount).toBe(1);
    expect(r.replacedIndexes).toEqual([3]); // bottom slot replaced
    expect(r.final[1]).toBe(final[1]); // higher slots preserved
    expect(r.final[2]).toBe(final[2]);
  });

  it("(12) per-call minTarget override extends reservation past defaults (within MAX)", () => {
    const final: TestCand[] = [
      cleanCand("ng_clean_001"),
      filler("a"),
      filler("b"),
      filler("c"),
      filler("d"),
      filler("e"),
    ];
    const sidecar: TestCand[] = [
      cleanCand("ng_clean_039"),
      cleanCand("ng_clean_023"),
      cleanCand("ng_clean_004"),
      cleanCand("ng_clean_005"),
    ];
    const r = applyNgCleanFirstCardCoreReservation(final, {
      sidecarPool: sidecar,
      minTarget: 5,
      preferredTarget: 5,
    });
    expect(r.reservedCount).toBe(4);
    expect(r.postCount).toBe(5);
  });

  it("(13) per-call max is clamped to design ceiling", () => {
    const final: TestCand[] = Array.from({ length: 12 }, (_, i) =>
      i === 0 ? cleanCand("ng_clean_001") : filler(`f${i}`),
    );
    const sidecar: TestCand[] = NIGERIAN_CLEAN_CORE_ENTRIES.slice(1, 20).map(
      (e) => filler(e.hook),
    );
    const r = applyNgCleanFirstCardCoreReservation(final, {
      sidecarPool: sidecar,
      minTarget: 100, // way past MAX
      preferredTarget: 100,
      maxTarget: 100,
    });
    expect(r.postCount).toBeLessThanOrEqual(MAX_NG_CLEAN_FIRST_CARD_CORE_CANDIDATES);
  });

  it("(14) determinism — same inputs produce identical output across runs", () => {
    const build = (): { final: TestCand[]; sidecar: TestCand[] } => ({
      final: [
        cleanCand("ng_clean_001"),
        filler("a"),
        filler("b"),
        filler("c"),
        filler("d"),
      ],
      sidecar: [
        cleanCand("ng_clean_039"),
        cleanCand("ng_clean_023"),
        cleanCand("ng_clean_004"),
      ],
    });
    const a = build();
    const b = build();
    const ra = applyNgCleanFirstCardCoreReservation(a.final, {
      sidecarPool: a.sidecar,
    });
    const rb = applyNgCleanFirstCardCoreReservation(b.final, {
      sidecarPool: b.sidecar,
    });
    expect(ra.reservedEntryIds).toEqual(rb.reservedEntryIds);
    expect(ra.replacedIndexes).toEqual(rb.replacedIndexes);
    expect(ra.preCount).toBe(rb.preCount);
    expect(ra.postCount).toBe(rb.postCount);
  });

  it("(15) does not mutate the input final[] array", () => {
    const final: TestCand[] = [
      cleanCand("ng_clean_001"),
      filler("a"),
      filler("b"),
      filler("c"),
    ];
    const snapshot = final.slice();
    const sidecar: TestCand[] = [
      cleanCand("ng_clean_039"),
      cleanCand("ng_clean_023"),
    ];
    applyNgCleanFirstCardCoreReservation(final, { sidecarPool: sidecar });
    expect(final).toEqual(snapshot);
  });

  it("(16) replacedIndexes count matches reservedEntryIds count", () => {
    const final: TestCand[] = [
      cleanCand("ng_clean_001"),
      filler("a"),
      filler("b"),
      filler("c"),
      filler("d"),
    ];
    const sidecar: TestCand[] = [
      cleanCand("ng_clean_039"),
      cleanCand("ng_clean_023"),
    ];
    const r = applyNgCleanFirstCardCoreReservation(final, {
      sidecarPool: sidecar,
    });
    expect(r.replacedIndexes.length).toBe(r.reservedEntryIds.length);
    expect(r.replacedIndexes.length).toBe(r.reservedCount);
  });
});
