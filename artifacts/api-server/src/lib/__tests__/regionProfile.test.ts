/**
 * PHASE N1-ELEVATION-P1 — symmetric languageStyle gate on
 * `decorateForRegion`. Regression coverage: nigeria + clean/null
 * must short-circuit to identity (no NEPA/buka/jollof leakage into
 * ng_clean / ng_null catalog/core_native outputs); nigeria +
 * pidgin/light_pidgin keeps the existing decoration behavior;
 * india / philippines are unaffected by languageStyle; western /
 * undefined remain identity.
 */
import { describe, it, expect } from "vitest";
import { decorateForRegion } from "../regionProfile.js";

const BASE = {
  caption: "the morning ran me",
  howToFilm: "Frame the kettle and your face. Hold for the loading.",
  whyItWorks: "Hits the universal morning spiral.",
} as const;

describe("decorateForRegion — N1-ELEVATION-P1 languageStyle gate", () => {
  it("nigeria + clean → identity (no decoration, no risky tokens)", () => {
    const out = decorateForRegion({
      region: "nigeria",
      domain: "mornings",
      languageStyle: "clean",
      ...BASE,
    });
    expect(out.decorated).toEqual([]);
    expect(out.caption).toBe(BASE.caption);
    expect(out.howToFilm).toBe(BASE.howToFilm);
    expect(out.whyItWorks).toBe(BASE.whyItWorks);
    for (const v of [out.caption, out.howToFilm, out.whyItWorks]) {
      expect(v).not.toMatch(/\bNEPA\b/i);
      expect(v).not.toMatch(/\bbuka\b/i);
      expect(v).not.toMatch(/\bjollof\b/i);
    }
  });

  it("nigeria + null → identity (no decoration, no risky tokens)", () => {
    const out = decorateForRegion({
      region: "nigeria",
      domain: "food",
      languageStyle: null,
      ...BASE,
    });
    expect(out.decorated).toEqual([]);
    expect(out.caption).toBe(BASE.caption);
    expect(out.howToFilm).toBe(BASE.howToFilm);
    expect(out.whyItWorks).toBe(BASE.whyItWorks);
    for (const v of [out.caption, out.howToFilm, out.whyItWorks]) {
      expect(v).not.toMatch(/\bNEPA\b/i);
      expect(v).not.toMatch(/\bbuka\b/i);
      expect(v).not.toMatch(/\bjollof\b/i);
    }
  });

  it("nigeria + omitted languageStyle → identity (defensive default)", () => {
    const out = decorateForRegion({
      region: "nigeria",
      domain: "mornings",
      ...BASE,
    });
    expect(out.decorated).toEqual([]);
    expect(out.caption).toBe(BASE.caption);
  });

  it("nigeria + pidgin → still decorated (caption + howToFilm + whyItWorks)", () => {
    const out = decorateForRegion({
      region: "nigeria",
      domain: "mornings",
      languageStyle: "pidgin",
      ...BASE,
    });
    expect(out.decorated).toEqual(
      expect.arrayContaining(["caption", "howToFilm", "whyItWorks"]),
    );
    expect(out.caption).toContain("(NEPA witness moment)");
  });

  it("nigeria + light_pidgin → still decorated", () => {
    const out = decorateForRegion({
      region: "nigeria",
      domain: "food",
      languageStyle: "light_pidgin",
      ...BASE,
    });
    expect(out.decorated).toEqual(
      expect.arrayContaining(["caption", "howToFilm", "whyItWorks"]),
    );
    expect(out.caption).toContain("(buka run aftermath)");
  });

  it("india + clean → still decorated (gate is nigeria-only)", () => {
    const out = decorateForRegion({
      region: "india",
      domain: "mornings",
      languageStyle: "clean",
      ...BASE,
    });
    expect(out.decorated.length).toBeGreaterThan(0);
    expect(out.caption).toContain("(metro rush witness)");
  });

  it("india + null → still decorated (gate is nigeria-only)", () => {
    const out = decorateForRegion({
      region: "india",
      domain: "food",
      languageStyle: null,
      ...BASE,
    });
    expect(out.decorated.length).toBeGreaterThan(0);
    expect(out.caption).toContain("(Swiggy cart guilt)");
  });

  it("philippines + null → still decorated (gate is nigeria-only)", () => {
    const out = decorateForRegion({
      region: "philippines",
      domain: "mornings",
      languageStyle: null,
      ...BASE,
    });
    expect(out.decorated.length).toBeGreaterThan(0);
  });

  it("philippines + clean → still decorated (gate is nigeria-only)", () => {
    const out = decorateForRegion({
      region: "philippines",
      domain: "food",
      languageStyle: "clean",
      ...BASE,
    });
    expect(out.decorated.length).toBeGreaterThan(0);
  });

  it("western → identity regardless of languageStyle", () => {
    for (const ls of ["pidgin", "light_pidgin", "clean", null] as const) {
      const out = decorateForRegion({
        region: "western",
        domain: "mornings",
        languageStyle: ls,
        ...BASE,
      });
      expect(out.decorated).toEqual([]);
      expect(out.caption).toBe(BASE.caption);
    }
  });

  it("undefined region → identity", () => {
    const out = decorateForRegion({
      region: undefined,
      domain: "mornings",
      languageStyle: "pidgin",
      ...BASE,
    });
    expect(out.decorated).toEqual([]);
    expect(out.caption).toBe(BASE.caption);
  });
});
