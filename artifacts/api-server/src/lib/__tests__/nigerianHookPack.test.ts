/**
 * PHASE N1 — Nigerian Comedy Pack infrastructure tests.
 *
 * Pins the safety contract:
 *   • empty pack loads cleanly
 *   • boot asserts trip on every flavour of malformed entry
 *   • central activation guard refuses every (region × languageStyle ×
 *     flag × packLength) combination EXCEPT the one supported case
 *     (region=nigeria + tier ∈ {light_pidgin,pidgin} + flag on +
 *     packLength > 0)
 *   • cross-region leak is impossible: india / philippines / western /
 *     undefined never activate even with a synthetic non-empty pack
 *     and a heavy `pidgin` tier injected
 *   • nigeria-clean (and `null` languageStyle) never activates
 *   • eligibility filter respects tier semantics (light tier never
 *     sees heavy entries) and the optional domain narrower
 *
 * The synthetic non-empty pack used here lives ONLY inside this file.
 * The exported `NIGERIAN_HOOK_PACK` ships empty and the production
 * `assertNigerianPackIntegrity` runs at module load — that import
 * itself is part of the test (any boot regression on the empty pack
 * would crash this file before the first `describe`).
 */

import { describe, expect, it } from "vitest";

import { assertNigerianPackIntegrity, type NigerianPackEntry } from "../nigerianHookPack.js";

describe("N1 production assert — sentinel rejection (defense in depth)", () => {
  const goodBase: NigerianPackEntry = {
    hook: "who send me make I tell them say I dey come",
    whatToShow:
      "Show a fake WhatsApp group chat. You stare at the dey-come message, type 'on the way,' and put the phone down.",
    howToFilm: "Phone-level lock-off, soft daylight, one take.",
    caption: "outside is now a subscription.",
    anchor: "dey",
    domain: "messaging",
    pidginLevel: "light_pidgin",
    reviewedBy: "AB 2026-05-05",
  };

  it("rejects an otherwise-valid entry that still carries the PENDING sentinel", () => {
    const bad: NigerianPackEntry = { ...goodBase, reviewedBy: "PENDING_NATIVE_REVIEW" };
    expect(() => assertNigerianPackIntegrity([bad])).toThrow(/PENDING_NATIVE_REVIEW/);
  });

  it("rejects sentinel even with surrounding whitespace", () => {
    const bad: NigerianPackEntry = { ...goodBase, reviewedBy: "  PENDING_NATIVE_REVIEW  " };
    expect(() => assertNigerianPackIntegrity([bad])).toThrow(/PENDING_NATIVE_REVIEW/);
  });
});


import {
  NIGERIAN_HOOK_PACK,
  PACK_FIELD_BOUNDS,
  assertNigerianPackIntegrity,
  canActivateNigerianPack,
  getEligibleNigerianPackEntries,
  isNigerianPackFeatureEnabled,
  nigerianPackPrefixGate,
  type NigerianPackEntry,
} from "../nigerianHookPack.js";
import type { Region } from "@workspace/lumina-trends";
import type { LanguageStyle } from "../tasteCalibration.js";

const VALID_LIGHT: NigerianPackEntry = {
  hook: "the way danfo conductor counts change",
  whatToShow:
    "Sit on the bus seat, phone propped on lap. Conductor leans in to hand back coins; you stare at the danfo coins for two beats before sighing.",
  howToFilm:
    "Lock-off on lap level inside the bus. One take. Daylight only.",
  caption: "the math is mathing (light_pidgin tier)",
  anchor: "danfo",
  domain: "mornings",
  pidginLevel: "light_pidgin",
  reviewedBy: "TEST-FIXTURE 2026-05-05",
};

const VALID_HEAVY: NigerianPackEntry = {
  hook: "who send me this whatsapp message?",
  whatToShow:
    "Phone is face-down on bed. It buzzes once. You stare at the whatsapp preview for four seconds without picking it up. Lock screen again, sigh.",
  howToFilm:
    "Bed-level lock-off. One take. Use a fake screenshot — never a real chat.",
  caption: "data finished. peace finished.",
  anchor: "whatsapp",
  domain: "phone",
  pidginLevel: "pidgin",
  reviewedBy: "TEST-FIXTURE 2026-05-05",
};

const SYNTHETIC_POOL: readonly NigerianPackEntry[] =
  Object.freeze([VALID_LIGHT, VALID_HEAVY]);

describe("N1 — module load + empty pack baseline", () => {
  it("ships with an empty pool by default", () => {
    expect(NIGERIAN_HOOK_PACK.length).toBe(0);
  });

  it("integrity assert is a no-op on the empty pool", () => {
    expect(() =>
      assertNigerianPackIntegrity(NIGERIAN_HOOK_PACK),
    ).not.toThrow();
  });

  it("integrity assert accepts the synthetic two-entry fixture", () => {
    expect(() => assertNigerianPackIntegrity(SYNTHETIC_POOL)).not.toThrow();
  });

  it("PACK_FIELD_BOUNDS are frozen", () => {
    expect(Object.isFrozen(PACK_FIELD_BOUNDS)).toBe(true);
  });
});

describe("N1 — boot integrity asserts", () => {
  it("rejects entries missing reviewedBy", () => {
    const bad = { ...VALID_LIGHT, reviewedBy: "" };
    expect(() => assertNigerianPackIntegrity([bad])).toThrow(/reviewedBy/);
  });

  it("rejects entries with whitespace-only reviewedBy", () => {
    const bad = { ...VALID_LIGHT, reviewedBy: "   " };
    expect(() => assertNigerianPackIntegrity([bad])).toThrow(/reviewedBy/);
  });

  it("rejects invalid pidginLevel values", () => {
    const bad = {
      ...VALID_LIGHT,
      pidginLevel: "clean" as unknown as NigerianPackEntry["pidginLevel"],
    };
    expect(() => assertNigerianPackIntegrity([bad])).toThrow(/pidginLevel/);
  });

  it("rejects entries whose anchor is not in the hook", () => {
    const bad = { ...VALID_LIGHT, anchor: "jollof" }; // not in hook string
    expect(() => assertNigerianPackIntegrity([bad])).toThrow(/anchor/);
  });

  it("rejects entries whose anchor is not in whatToShow", () => {
    const bad: NigerianPackEntry = {
      ...VALID_LIGHT,
      hook: "the way jollof shows up at every wedding",
      whatToShow:
        "Sit at a long event table, phone in hand. Stare at the empty plate for four beats before reacting deadpan to the camera.",
      anchor: "jollof",
    };
    expect(() => assertNigerianPackIntegrity([bad])).toThrow(
      /not found in whatToShow/,
    );
  });

  it("rejects multi-word anchors", () => {
    const bad = { ...VALID_LIGHT, anchor: "two words" };
    expect(() => assertNigerianPackIntegrity([bad])).toThrow(
      /single lowercase token/,
    );
  });

  it("rejects empty anchors", () => {
    const bad = { ...VALID_LIGHT, anchor: "" };
    expect(() => assertNigerianPackIntegrity([bad])).toThrow(
      /single lowercase token/,
    );
  });

  it("rejects empty domain", () => {
    const bad = { ...VALID_LIGHT, domain: "" };
    expect(() => assertNigerianPackIntegrity([bad])).toThrow(/domain/);
  });

  it("rejects hooks longer than 120 chars", () => {
    const bad = {
      ...VALID_LIGHT,
      hook:
        "danfo " +
        "x".repeat(PACK_FIELD_BOUNDS.hookMax),
    };
    expect(() => assertNigerianPackIntegrity([bad])).toThrow(/hook exceeds/);
  });

  it("rejects whatToShow shorter than the band minimum", () => {
    const bad = { ...VALID_LIGHT, whatToShow: "danfo short" };
    expect(() => assertNigerianPackIntegrity([bad])).toThrow(
      /whatToShow length out of band/,
    );
  });

  it("rejects howToFilm shorter than the band minimum", () => {
    const bad = { ...VALID_LIGHT, howToFilm: "tiny" };
    expect(() => assertNigerianPackIntegrity([bad])).toThrow(
      /howToFilm length out of band/,
    );
  });

  it("rejects caption longer than the band maximum", () => {
    const bad = {
      ...VALID_LIGHT,
      caption: "x".repeat(PACK_FIELD_BOUNDS.captionMax + 1),
    };
    expect(() => assertNigerianPackIntegrity([bad])).toThrow(
      /caption length out of band/,
    );
  });

  it("rejects mocking vowel-stretch in the hook", () => {
    const bad = {
      ...VALID_LIGHT,
      hook: "noooooo the danfo conductor said what",
    };
    expect(() => assertNigerianPackIntegrity([bad])).toThrow(
      /mocking-spelling/,
    );
  });

  it("rejects the NEPA / 'light just took' stereotype", () => {
    const bad: NigerianPackEntry = {
      ...VALID_LIGHT,
      hook: "the generator coughs and light just took us again",
      whatToShow:
        "You sit on the couch with the generator's cord in hand, phone on lap. Stare at the dead bulb for three beats, then sigh at the camera.",
      anchor: "generator",
      domain: "home",
    };
    expect(() => assertNigerianPackIntegrity([bad])).toThrow(
      /mocking-spelling/,
    );
  });

  it("rejects yahoo / 419 caption tropes", () => {
    const bad = { ...VALID_LIGHT, caption: "feeling like a yahoo boy today" };
    expect(() => assertNigerianPackIntegrity([bad])).toThrow(
      /mocking-spelling/,
    );
  });
});

// ---------------------------------------------------------------- //
// Activation guard — exhaustive matrix.
// ---------------------------------------------------------------- //

const REGIONS: readonly (Region | undefined)[] = [
  "western",
  "india",
  "philippines",
  "nigeria",
  undefined,
];
const STYLES: readonly (LanguageStyle | null)[] = [
  null,
  "clean",
  "light_pidgin",
  "pidgin",
];
const FLAGS: readonly boolean[] = [false, true];
const LENGTHS: readonly number[] = [0, 1];

describe("N1 — canActivateNigerianPack matrix (cross-region leak proof)", () => {
  for (const region of REGIONS) {
    for (const languageStyle of STYLES) {
      for (const flagEnabled of FLAGS) {
        for (const packLength of LENGTHS) {
          const expected =
            region === "nigeria" &&
            (languageStyle === "light_pidgin" ||
              languageStyle === "pidgin") &&
            flagEnabled === true &&
            packLength > 0;
          const label = `region=${region ?? "undef"} lang=${
            languageStyle ?? "null"
          } flag=${flagEnabled} len=${packLength} → ${expected}`;
          it(label, () => {
            expect(
              canActivateNigerianPack({
                region,
                languageStyle,
                flagEnabled,
                packLength,
              }),
            ).toBe(expected);
          });
        }
      }
    }
  }

  it("ONLY nigeria + light_pidgin/pidgin + flag on + non-empty pack returns true", () => {
    let trueCount = 0;
    for (const region of REGIONS)
      for (const languageStyle of STYLES)
        for (const flagEnabled of FLAGS)
          for (const packLength of LENGTHS)
            if (
              canActivateNigerianPack({
                region,
                languageStyle,
                flagEnabled,
                packLength,
              })
            )
              trueCount++;
    // 1 region × 2 valid tiers × 1 flag value × 1 length value = 2
    expect(trueCount).toBe(2);
  });

  it("non-nigeria regions NEVER activate, even with poisoned inputs", () => {
    for (const region of (["western", "india", "philippines"] as Region[]).concat(
      [undefined as unknown as Region],
    )) {
      expect(
        canActivateNigerianPack({
          region,
          languageStyle: "pidgin",
          flagEnabled: true,
          packLength: 999,
        }),
      ).toBe(false);
    }
  });

  it("nigeria + clean / null NEVER activates", () => {
    for (const languageStyle of [null, "clean"] as const) {
      expect(
        canActivateNigerianPack({
          region: "nigeria",
          languageStyle,
          flagEnabled: true,
          packLength: 999,
        }),
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------- //
// Eligibility filter — tier semantics + domain narrower.
// ---------------------------------------------------------------- //

describe("N1 — getEligibleNigerianPackEntries", () => {
  it("returns [] when guard fails (empty production pool, any inputs)", () => {
    const out = getEligibleNigerianPackEntries({
      region: "nigeria",
      languageStyle: "pidgin",
      flagEnabled: true,
    });
    expect(out.length).toBe(0);
  });

  it("returns [] when synthetic pool is provided but region is wrong", () => {
    for (const region of ["western", "india", "philippines"] as Region[]) {
      const out = getEligibleNigerianPackEntries(
        { region, languageStyle: "pidgin", flagEnabled: true },
        SYNTHETIC_POOL,
      );
      expect(out.length).toBe(0);
    }
  });

  it("returns [] for nigeria + clean even with synthetic pool + flag on", () => {
    const out = getEligibleNigerianPackEntries(
      { region: "nigeria", languageStyle: "clean", flagEnabled: true },
      SYNTHETIC_POOL,
    );
    expect(out.length).toBe(0);
  });

  it("returns [] when flag is off (synthetic pool, valid region+tier)", () => {
    const out = getEligibleNigerianPackEntries(
      { region: "nigeria", languageStyle: "pidgin", flagEnabled: false },
      SYNTHETIC_POOL,
    );
    expect(out.length).toBe(0);
  });

  it("light_pidgin tier sees ONLY light_pidgin entries", () => {
    const out = getEligibleNigerianPackEntries(
      {
        region: "nigeria",
        languageStyle: "light_pidgin",
        flagEnabled: true,
      },
      SYNTHETIC_POOL,
    );
    expect(out.length).toBe(1);
    expect(out[0]?.pidginLevel).toBe("light_pidgin");
  });

  it("pidgin tier sees BOTH light_pidgin and pidgin entries", () => {
    const out = getEligibleNigerianPackEntries(
      { region: "nigeria", languageStyle: "pidgin", flagEnabled: true },
      SYNTHETIC_POOL,
    );
    expect(out.length).toBe(2);
    const tiers = out.map((e) => e.pidginLevel).sort();
    expect(tiers).toEqual(["light_pidgin", "pidgin"]);
  });

  it("domain narrower filters to a matching domain", () => {
    const out = getEligibleNigerianPackEntries(
      {
        region: "nigeria",
        languageStyle: "pidgin",
        flagEnabled: true,
        domain: "phone",
      },
      SYNTHETIC_POOL,
    );
    expect(out.length).toBe(1);
    expect(out[0]?.anchor).toBe("whatsapp");
  });

  it("domain narrower returns [] when no entry matches", () => {
    const out = getEligibleNigerianPackEntries(
      {
        region: "nigeria",
        languageStyle: "pidgin",
        flagEnabled: true,
        domain: "study",
      },
      SYNTHETIC_POOL,
    );
    expect(out.length).toBe(0);
  });
});

// ---------------------------------------------------------------- //
// Feature flag — env-var semantics.
// ---------------------------------------------------------------- //

describe("N1 — isNigerianPackFeatureEnabled", () => {
  const ORIG = process.env.LUMINA_NG_PACK_ENABLED;

  it("defaults to false when unset", () => {
    delete process.env.LUMINA_NG_PACK_ENABLED;
    expect(isNigerianPackFeatureEnabled()).toBe(false);
  });

  it("only the literal string 'true' enables the flag", () => {
    for (const v of ["", "1", "yes", "TRUE", "True", "false", "0"]) {
      process.env.LUMINA_NG_PACK_ENABLED = v;
      expect(isNigerianPackFeatureEnabled()).toBe(false);
    }
  });

  it("enables on exact 'true'", () => {
    process.env.LUMINA_NG_PACK_ENABLED = "true";
    expect(isNigerianPackFeatureEnabled()).toBe(true);
  });

  // Restore original env so neighbouring tests are unaffected.
  it("restores env", () => {
    if (ORIG === undefined) delete process.env.LUMINA_NG_PACK_ENABLED;
    else process.env.LUMINA_NG_PACK_ENABLED = ORIG;
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------- //
// Prefix gate — deterministic ~25%.
// ---------------------------------------------------------------- //

describe("N1 — nigerianPackPrefixGate determinism", () => {
  it("is deterministic for the same (salt, coreId)", () => {
    expect(nigerianPackPrefixGate(123, "core_a")).toBe(
      nigerianPackPrefixGate(123, "core_a"),
    );
  });

  it("fires roughly 25% of the time across a sample sweep", () => {
    let on = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      if (nigerianPackPrefixGate(i, `core_${i % 50}`)) on++;
    }
    const ratio = on / N;
    // ±5pp band — djb2 % 4 is uniform but the sweep is finite.
    expect(ratio).toBeGreaterThan(0.2);
    expect(ratio).toBeLessThan(0.3);
  });
});
