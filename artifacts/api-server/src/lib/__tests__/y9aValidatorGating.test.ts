/**
 * PHASE Y9-A — `validateBigPremise` path-segregation invariant.
 *
 * Y9-A's third "redundancy" was framed as "make `validateBigPremise`
 * a no-op for core_native." Pre-execution exploration revealed the
 * gate is ALREADY path-segregated by construction:
 *
 *   - `validateBigPremise` is called in EXACTLY ONE site:
 *     `pickValidatedLanguagePhrasing` inside `patternIdeator.ts`
 *     (the legacy template picker that builds `pattern_variation`
 *     candidates).
 *
 *   - The cohesive author (`cohesiveIdeaAuthor.authorCohesiveIdea`)
 *     constructs `core_native` candidates DIRECTLY from a recipe
 *     queue without going through the legacy picker, so a
 *     core_native candidate cannot reach `validateBigPremise`.
 *
 * This test locks in that structural invariant. A future refactor
 * that adds a `validateBigPremise` call from any non-picker path
 * (e.g. accidentally importing it into the cohesive author or the
 * Llama mutator) breaks this test, surfacing the invariant
 * regression at typecheck time.
 *
 * The test reads `patternIdeator.ts` source directly to count call
 * sites — it does NOT rely on runtime behavior, because the
 * structural guarantee is a SOURCE-CODE invariant (zero call sites
 * in code paths that handle core_native candidates).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const libDir = join(__dirname, "..");

function readLib(file: string): string {
  return readFileSync(join(libDir, file), "utf8");
}

/** Strip block + line comments + JSDoc so doc references to the
 *  validator name don't inflate the call-site count. */
function stripComments(src: string): string {
  // Block comments (including JSDoc). Non-greedy to avoid swallowing
  // multiple consecutive blocks.
  let out = src.replace(/\/\*[\s\S]*?\*\//g, "");
  // Line comments. Note: this is a heuristic — it could trim a `//`
  // inside a string literal, but `validateBigPremise` doesn't appear
  // in any string literal in the codebase, so the call-site count is
  // robust for this specific assertion.
  out = out.replace(/\/\/.*$/gm, "");
  return out;
}

describe("validateBigPremise — Y9-A path-segregation invariant", () => {
  it("is called from EXACTLY ONE site (the legacy picker walk)", () => {
    const src = stripComments(readLib("patternIdeator.ts"));
    // Count actual call sites: `validateBigPremise(` followed by an
    // argument (NOT followed by a type position like `<`, NOT a
    // function declaration `function validateBigPremise`).
    const calls = src.match(/(?<!function\s)validateBigPremise\s*\(/g) ?? [];
    // The function declaration itself uses `validateBigPremise(` so
    // the regex above excludes the declaration. We expect exactly
    // ONE remaining call site (the picker walk).
    expect(calls.length).toBe(1);
  });

  it("is NOT called from cohesiveIdeaAuthor.ts (core_native construction path)", () => {
    const src = stripComments(readLib("cohesiveIdeaAuthor.ts"));
    expect(src.includes("validateBigPremise")).toBe(false);
  });

  it("is NOT called from coreCandidateGenerator.ts (core_native recipe loop)", () => {
    const src = stripComments(readLib("coreCandidateGenerator.ts"));
    expect(src.includes("validateBigPremise")).toBe(false);
  });

  it("is NOT called from llamaHookMutator.ts (the Llama post-processor)", () => {
    const src = stripComments(readLib("llamaHookMutator.ts"));
    expect(src.includes("validateBigPremise")).toBe(false);
  });

  it("is NOT called from hybridIdeator.ts (the top-level orchestrator)", () => {
    const src = stripComments(readLib("hybridIdeator.ts"));
    expect(src.includes("validateBigPremise")).toBe(false);
  });

  it("is NOT called from comedyValidation.ts (the comedy gate)", () => {
    const src = stripComments(readLib("comedyValidation.ts"));
    expect(src.includes("validateBigPremise")).toBe(false);
  });
});
