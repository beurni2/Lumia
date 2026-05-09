/**
 * PHASE W2-AUTHOR HYBRID — cohesiveIdeaAuthor Path B V2 rewrite.
 *
 * Tests the module-scope show / film shape pools used by Path B
 * (the abstract-anchor generic path) directly, against the
 * representative non-authored anchors named in the spec:
 *
 *   - thread
 *   - tasks
 *   - swipe
 *   - draft
 *
 * Assertions:
 *   - All 4 × 4 = 16 (show, film) pairs satisfy passesV2Gate
 *     (no banned phrase, wts !== htf).
 *   - Anchor literal preserved in BOTH whatToShow and howToFilm.
 *   - Action verb literal preserved in BOTH surfaces.
 *   - Substantive token overlap between wts and htf is at least 2
 *     tokens (anchor + action verb at minimum).
 *   - Per-template output is deterministic across re-renders.
 */

import { describe, expect, it } from "vitest";

import {
  PATH_B_SHOW_SHAPES,
  PATH_B_FILM_SHAPES,
} from "../cohesiveIdeaAuthor";
import {
  WTS_HTF_BANNED_RE,
  passesV2Gate,
} from "../wtsHtfQualityGate";

const ANCHORS: ReadonlyArray<string> = ["thread", "tasks", "swipe", "draft"];
const ACTION_BARE = "open";
// For abstract anchors, Path B substitutes a concrete prop noun
// (`ABSTRACT_TO_CONCRETE_PROP[anchorLc]`) in for `n` while the
// `anchor` literal stays the abstract token. Mirror that here.
const RENDER_NOUN_BY_ANCHOR: Record<string, string> = {
  thread: "phone with the thread open",
  tasks: "task list on the laptop",
  swipe: "phone showing the swipe screen",
  draft: "draft on the screen",
};

const STOPWORDS_LITE = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "you",
  "your",
  "this",
  "that",
  "is",
  "it",
  "be",
  "as",
  "at",
  "by",
  "so",
  "but",
  "not",
  "no",
  "if",
  "then",
  "than",
  "into",
  "from",
  "out",
  "up",
  "down",
  "over",
  "before",
  "after",
  "like",
  "one",
  "two",
  "three",
  "first",
  "second",
  "third",
  "are",
  "was",
  "were",
  "had",
  "has",
  "have",
  "do",
  "did",
  "does",
  "i",
  "me",
  "my",
  "we",
  "they",
  "them",
  "their",
  "its",
  "itself",
  "yourself",
  "any",
  "all",
  "every",
  "each",
  "what",
  "who",
  "which",
  "when",
  "where",
  "why",
  "how",
  "just",
  "really",
  "very",
  "even",
  "much",
  "more",
  "most",
  "some",
  "such",
  "own",
  "same",
  "other",
  "another",
  "anyway",
  "instead",
  "again",
  "still",
  "now",
]);
function tokens(s: string): Set<string> {
  return new Set(
    (s.toLowerCase().match(/[a-z]+/g) ?? []).filter(
      (t) => t.length >= 4 && !STOPWORDS_LITE.has(t),
    ),
  );
}

describe("PATH_B_SHOW_SHAPES + PATH_B_FILM_SHAPES — V2 grammar", () => {
  it("exposes 4 × 4 templates", () => {
    expect(PATH_B_SHOW_SHAPES.length).toBe(4);
    expect(PATH_B_FILM_SHAPES.length).toBe(4);
  });

  it("16-pair Cartesian enumeration covers every (s, f) combo exactly once and starts at (0, 0)", () => {
    // Mirrors the Path B pair generator in cohesiveIdeaAuthor.ts
    // (showStart = filmStart = 0 for this assertion). The fast
    // axis is `s` (k % sn), the slow axis is `f` (floor(k / sn)).
    const sn = PATH_B_SHOW_SHAPES.length;
    const fn = PATH_B_FILM_SHAPES.length;
    const total = sn * fn;
    const seen = new Set<string>();
    const pairs: Array<{ s: number; f: number }> = [];
    for (let k = 0; k < total; k++) {
      pairs.push({ s: (0 + (k % sn)) % sn, f: (0 + Math.floor(k / sn)) % fn });
    }
    for (const p of pairs) seen.add(`${p.s},${p.f}`);
    expect(pairs.length).toBe(16);
    expect(seen.size).toBe(16);
    expect(pairs[0]).toEqual({ s: 0, f: 0 });
  });

  for (const anchor of ANCHORS) {
    const renderNoun = RENDER_NOUN_BY_ANCHOR[anchor]!;
    describe(`anchor=${anchor}`, () => {
      for (let s = 0; s < 4; s++) {
        for (let f = 0; f < 4; f++) {
          it(`(show ${s}, film ${f}) passes the V2 gate`, () => {
            const wts = PATH_B_SHOW_SHAPES[s]!(
              renderNoun,
              ACTION_BARE,
              anchor,
            );
            const htf = PATH_B_FILM_SHAPES[f]!(
              renderNoun,
              ACTION_BARE,
              anchor,
            );

            // 1. No banned phrase, wts !== htf.
            expect(WTS_HTF_BANNED_RE.test(wts)).toBe(false);
            expect(WTS_HTF_BANNED_RE.test(htf)).toBe(false);
            expect(passesV2Gate(wts, htf)).toBe(true);

            // 2. Anchor + action literals preserved on both sides.
            expect(wts.toLowerCase()).toContain(anchor);
            expect(htf.toLowerCase()).toContain(anchor);
            expect(wts.toLowerCase()).toContain(ACTION_BARE);
            expect(htf.toLowerCase()).toContain(ACTION_BARE);

            // 3. Substantive token overlap ≥ 2.
            const wtsT = tokens(wts);
            const htfT = tokens(htf);
            const overlap = [...wtsT].filter((t) => htfT.has(t)).length;
            expect(overlap).toBeGreaterThanOrEqual(2);

            // 4. Length within the cohesive-author caps.
            expect(wts.length).toBeLessThanOrEqual(500);
            expect(htf.length).toBeLessThanOrEqual(400);
            expect(wts.length).toBeGreaterThanOrEqual(50);
            expect(htf.length).toBeGreaterThanOrEqual(50);
          });
        }
      }
    });
  }

  it("is deterministic across re-renders for a fixed (anchor, action) pair", () => {
    for (let s = 0; s < 4; s++) {
      const a = PATH_B_SHOW_SHAPES[s]!("phone with the thread open", "open", "thread");
      const b = PATH_B_SHOW_SHAPES[s]!("phone with the thread open", "open", "thread");
      expect(a).toBe(b);
    }
    for (let f = 0; f < 4; f++) {
      const a = PATH_B_FILM_SHAPES[f]!("task list on the laptop", "open", "tasks");
      const b = PATH_B_FILM_SHAPES[f]!("task list on the laptop", "open", "tasks");
      expect(a).toBe(b);
    }
  });
});
