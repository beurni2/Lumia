/**
 * PHASE W2-I — unit tests for the Western APPROVED promotion pool
 * (DARK).
 *
 * Confirms the approved pool's count, taxonomy uniqueness,
 * editorial-cleanliness gates, and the dark-infrastructure
 * import-surface guarantee (no runtime path imports the pool).
 *
 * NOT covered (out of W2-I scope): runtime activation, slot
 * reservation, scoring changes — none exist for the approved pool
 * yet, by design.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  PENDING_EDITORIAL_REVIEW,
  WESTERN_DRAFT_WEAK_SKELETON_PATTERNS,
} from "../westernHookPack.js";
import {
  APPROVED_WESTERN_PROMOTION_CANDIDATES,
  APPROVED_WESTERN_PROMOTION_IDS,
  checkApprovedWesternPromotionPoolIntegrity,
} from "../westernHookPackApproved.js";

// ---------------------------------------------------------------- //
// Editorial-cleanliness helpers (mirror the W2-D ranker rubric).
// Kept here so the test stays self-contained — these helpers are
// NOT exported from the approved pool module (it must stay light).
// ---------------------------------------------------------------- //

const VISIBLE_ACTION_VERBS = new Set([
  "open", "opens", "close", "closes", "type", "types", "typed",
  "delete", "deletes", "scroll", "scrolls", "stare", "stares",
  "staring", "hover", "hovers", "fold", "folds", "peek", "peeks",
  "lean", "leans", "leaned", "squint", "squints", "toss", "tossed",
  "flip", "glance", "glances", "glanced", "wipe", "wipes", "drag",
  "drags", "clean", "cleans", "lock", "locks", "unlock", "grab",
  "grabs", "sit", "sits", "sat", "lie", "lies", "lying", "collapse",
  "collapses", "tap", "taps", "tapped", "swipe", "swipes", "press",
  "presses", "look", "looks", "walk", "walks", "pace", "paces",
  "reach", "reaches", "place", "places", "put", "puts", "shove",
  "hide", "cover", "dial", "count", "pretend", "pretends", "adjust",
  "adjusts", "smile", "nod", "nods", "blink", "wave", "rehearse",
  "rehearses", "rehearsed", "pour", "pours", "watch", "spot",
  "spots", "whisper", "whispers", "start", "starts",
]);

function tokens(s: string): string[] {
  return s.toLowerCase().match(/[a-z]+/g) ?? [];
}

function normalizeHookSkeleton(hook: string): string {
  return hook
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => (w.length >= 5 ? "__" : w))
    .slice(0, 24)
    .join(" ");
}

// ---------------------------------------------------------------- //
// Tests                                                              //
// ---------------------------------------------------------------- //

describe("W2-I — approved Western promotion pool (dark)", () => {
  it("contains exactly 100 entries", () => {
    expect(APPROVED_WESTERN_PROMOTION_CANDIDATES.length).toBe(100);
    expect(APPROVED_WESTERN_PROMOTION_IDS.length).toBe(100);
  });

  it("ids match the candidate ids in order", () => {
    const candidateIds = APPROVED_WESTERN_PROMOTION_CANDIDATES.map(
      (e) => e.id,
    );
    expect(candidateIds).toEqual([...APPROVED_WESTERN_PROMOTION_IDS]);
  });

  it("every entry retains reviewedBy = PENDING_EDITORIAL_REVIEW", () => {
    for (const e of APPROVED_WESTERN_PROMOTION_CANDIDATES) {
      expect(e.reviewedBy).toBe(PENDING_EDITORIAL_REVIEW);
    }
  });

  it("has no duplicate hook strings", () => {
    const hookCounts = new Map<string, number>();
    for (const e of APPROVED_WESTERN_PROMOTION_CANDIDATES) {
      hookCounts.set(e.hook, (hookCounts.get(e.hook) ?? 0) + 1);
    }
    const dups = [...hookCounts.entries()].filter(([, c]) => c > 1);
    expect(dups).toEqual([]);
  });

  it("has no duplicate hook skeletons", () => {
    const skelCounts = new Map<string, number>();
    for (const e of APPROVED_WESTERN_PROMOTION_CANDIDATES) {
      const k = normalizeHookSkeleton(e.hook);
      skelCounts.set(k, (skelCounts.get(k) ?? 0) + 1);
    }
    const dups = [...skelCounts.entries()].filter(([, c]) => c > 1);
    expect(dups).toEqual([]);
  });

  it("has no triplet collisions on (comedyFamily | emotionalSpike | anchor)", () => {
    const tripletCounts = new Map<string, number>();
    for (const e of APPROVED_WESTERN_PROMOTION_CANDIDATES) {
      const k = `${e.comedyFamily}|${e.emotionalSpike}|${e.anchor}`;
      tripletCounts.set(k, (tripletCounts.get(k) ?? 0) + 1);
    }
    const dups = [...tripletCounts.entries()].filter(([, c]) => c > 1);
    expect(dups).toEqual([]);
  });

  it("has no weak banned skeleton hits in any field", () => {
    for (const e of APPROVED_WESTERN_PROMOTION_CANDIDATES) {
      const haystack = [e.hook, e.whatToShow, e.howToFilm, e.caption]
        .join(" \n ")
        .toLowerCase();
      for (const entry of WESTERN_DRAFT_WEAK_SKELETON_PATTERNS) {
        expect(
          entry.pattern.test(haystack),
          `weak skeleton ${entry.id} hit on ${e.id}`,
        ).toBe(false);
      }
    }
  });

  it("has no privacy / safety surface hits", () => {
    // Mirror the QA driver's privacy/safety sniff: any phone number,
    // email, full name pattern, or address-shaped string in any text
    // field would be a hit. The corpus is designed to have none.
    const PRIVACY_PATTERNS: RegExp[] = [
      /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/, // phone
      /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/, // email
      /\b\d+\s+[A-Z][a-z]+\s+(Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Boulevard|Blvd)\b/, // address
    ];
    for (const e of APPROVED_WESTERN_PROMOTION_CANDIDATES) {
      const haystack = [e.hook, e.whatToShow, e.howToFilm, e.caption].join(
        " ",
      );
      for (const pat of PRIVACY_PATTERNS) {
        expect(pat.test(haystack), `privacy hit ${pat} on ${e.id}`).toBe(
          false,
        );
      }
    }
  });

  it("every entry has a visible action verb in whatToShow (no visible-action blockers)", () => {
    for (const e of APPROVED_WESTERN_PROMOTION_CANDIDATES) {
      const wtsTokens = tokens(e.whatToShow);
      const hasVerb = wtsTokens.some((t) => VISIBLE_ACTION_VERBS.has(t));
      expect(hasVerb, `${e.id} missing visible verb in whatToShow`).toBe(
        true,
      );
    }
  });

  it("every entry's anchor token appears in whatToShow (no anchor-cohesion blockers)", () => {
    for (const e of APPROVED_WESTERN_PROMOTION_CANDIDATES) {
      const wtsLower = e.whatToShow.toLowerCase();
      const anchorLower = e.anchor.toLowerCase();
      expect(
        wtsLower.includes(anchorLower),
        `${e.id} anchor "${e.anchor}" missing from whatToShow`,
      ).toBe(true);
    }
  });

  it("integrity assertion returns ok=true on the as-shipped pool", () => {
    const result = checkApprovedWesternPromotionPoolIntegrity();
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("approved pool is only imported by the W2-K/W2-K2 runtime allowlist", () => {
    // Originally a dark-infrastructure invariant (no runtime importers
    // at all). PHASE W2-K intentionally activated the approved pool
    // as a Western promotion runtime; PHASE W2-K2 extended the wiring
    // for cross-batch dedup. The guard now asserts the importer set
    // is exactly the W2-K/W2-K2 allowlist plus the module itself,
    // its dedicated test, and the QA driver — no NEW accidental
    // importers may appear.
    const repoSrc = path.resolve(__dirname, "..", "..");
    const allowedSuffixes = [
      path.join("lib", "westernHookPackApproved.ts"),
      path.join("lib", "__tests__", "westernHookPackApproved.test.ts"),
      path.join("qa", "buildWesternDraftQa.ts"),
      // W2-K runtime activation
      path.join("lib", "hybridIdeator.ts"),
      path.join("lib", "westernPackSlotReservation.ts"),
      path.join("lib", "westernPackAuthor.ts"),
      // W2-K2 — meta scoring extension
      path.join("lib", "ideaScorer.ts"),
    ];

    function walk(dir: string): string[] {
      const out: string[] = [];
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) out.push(...walk(full));
        else if (full.endsWith(".ts")) out.push(full);
      }
      return out;
    }

    const offenders: string[] = [];
    for (const file of walk(repoSrc)) {
      if (allowedSuffixes.some((s) => file.endsWith(s))) continue;
      const txt = fs.readFileSync(file, "utf8");
      if (
        txt.includes("westernHookPackApproved") ||
        txt.includes("APPROVED_WESTERN_PROMOTION_CANDIDATES") ||
        txt.includes("APPROVED_WESTERN_PROMOTION_IDS") ||
        txt.includes("checkApprovedWesternPromotionPoolIntegrity")
      ) {
        offenders.push(path.relative(repoSrc, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
