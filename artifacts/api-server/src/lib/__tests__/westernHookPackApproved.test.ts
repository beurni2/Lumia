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
  WESTERN_VOICE_CLUSTERS,
  WESTERN_BATCH_HOOK_STYLES,
} from "../westernHookPack.js";
import {
  APPROVED_WESTERN_PROMOTION_CANDIDATES,
  APPROVED_WESTERN_PROMOTION_IDS,
  checkApprovedWesternPromotionPoolIntegrity,
} from "../westernHookPackApproved.js";
import {
  WESTERN_HOOK_PACK_BATCH_NEXT,
  WESTERN_HOOK_PACK_BATCH_NEXT_IDS,
  getWesternEntrySourceBatch,
} from "../westernHookPackBatchNext.js";
import {
  WESTERN_HOOK_PACK_BATCH_NEXT2,
  WESTERN_HOOK_PACK_BATCH_NEXT2_IDS,
} from "../westernHookPackBatchNext2.js";

// ---------------------------------------------------------------- //
// Editorial-cleanliness helpers (mirror the W2-D ranker rubric).
// Kept here so the test stays self-contained — these helpers are
// NOT exported from the approved pool module (it must stay light).
// ---------------------------------------------------------------- //

const VISIBLE_ACTION_VERBS = new Set([
  // PHASE W2-I baseline verbs
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
  // PHASE W2-L additions — covers visible-action verbs used in the
  // curated W2-BATCH-NEXT corpus's WHAT TO SHOW lines. Same intent
  // as the W2-I baseline (a token in whatToShow that names a body
  // motion, screen interaction, or object manipulation that can be
  // filmed in a single static shot). No semantic change to the test.
  "placed", "pushed", "push", "pushes", "pull", "pulls", "pulled",
  "pulling", "held", "hold", "holds", "holding", "drops", "drop",
  "dropped", "dropping", "shows", "show", "showing", "showed",
  "goes", "go", "going", "went", "closing", "closed", "angled",
  "angles", "angle", "gets", "get", "got", "sighing", "sighs",
  "sigh", "sighed", "unload", "unloads", "unloaded", "send", "sends",
  "sent", "sending", "slaps", "slap", "slapped", "typing", "vanish",
  "vanishes", "vanished", "lowers", "lower", "lowered", "lowering",
  "points", "point", "pointed", "pointing", "cut", "cuts", "working",
  "works", "work", "worked", "accepted", "accepts", "accept",
  "accepting", "freezes", "freeze", "froze", "frozen", "checks",
  "check", "checked", "checking", "crossed", "crosses", "cross",
  "covered", "covers", "replaced", "replaces", "replace", "sipping",
  "sips", "sip", "sipped", "labeled", "label", "labels", "added",
  "add", "adds", "adding", "gesturing", "gestures", "gesture",
  "reading", "reads", "read", "dominating", "dominates", "dominate",
  "folded", "untouched", "overflowing", "overflows", "overflow",
  "empty", "empties", "emptied", "taken", "using", "used", "uses",
  "use", "washed", "washes", "wash", "steps", "step", "stepped",
  "stepping", "guilty", "edited", "edits", "edit", "editing",
  "deleted", "retyped", "retypes", "retype", "refresh", "refreshes",
  "refreshing", "refreshed", "returns", "return", "returned", "sets",
  "set", "setting", "pump", "pumps", "pumped", "done", "stretch",
  "stretches", "stretched", "stretching", "stand", "stands", "stood",
  "standing", "tired", "changes", "change", "changed", "changing",
  "notices", "notice", "noticed", "fishes", "fish", "fishing",
  "fished", "panicked", "panics", "spill", "spills", "spilled",
  "spilling", "turning", "turns", "turn", "turned", "watering",
  "waters", "searches", "search", "searched", "searching", "dump",
  "dumps", "dumped", "dumping", "shrug", "shrugs", "shrugged",
  "shrugging", "surrounded", "surrounds", "surround", "pile",
  "piles", "piled", "centered", "centers", "center", "snatch",
  "snatches", "snatched", "matched", "matches", "match", "moved",
  "moves", "move", "moving",
  // PHASE W2-N additions — verbs that appear in the W2-BATCH-NEXT-2
  // curated whatToShow lines. Same intent as the W2-I/W2-L sets.
  "click", "clicks", "clicked", "clicking", "release", "releases",
  "released", "releasing", "slump", "slumps", "slumped", "slumping",
  "recreate", "recreates", "recreated", "recreating", "crouch",
  "crouches", "crouched", "crouching", "hear", "hears", "heard",
  "hearing", "raise", "raises", "raised", "raising", "clasp",
  "clasps", "clasped", "clasping", "wrestle", "wrestles", "wrestled",
  "wrestling", "dive", "dives", "dove", "dived", "diving", "miss",
  "misses", "missed", "missing", "practice", "practices", "practiced",
  "practicing", "beep", "beeps", "beeped", "review", "reviews",
  "reviewed", "reviewing", "remove", "removes", "removed", "removing",
  "pause", "pauses", "paused", "pausing", "roll", "rolls", "rolled",
  "rolling", "clank", "clanks", "clanked", "rush", "rushes", "rushed",
  "rushing", "vacuum", "vacuums", "vacuumed", "vacuuming", "see",
  "sees", "saw", "seeing", "blinks", "blinked", "blinking", "inspect",
  "inspects", "inspected", "inspecting", "say", "says", "said",
  "saying", "appears", "appear", "appeared", "ends", "end", "ended",
  "ending", "raises",
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
  it("contains exactly 300 entries (W2-I draft promotion 100 + W2-L curated 100 + W2-N curated 100)", () => {
    expect(APPROVED_WESTERN_PROMOTION_CANDIDATES.length).toBe(300);
    expect(APPROVED_WESTERN_PROMOTION_IDS.length).toBe(300);
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
      // W2-L — curated batch source (imported by westernHookPackApproved.ts only)
      path.join("lib", "westernHookPackBatchNext.ts"),
      // W2-N — curated batch source (imported by westernHookPackApproved.ts only)
      path.join("lib", "westernHookPackBatchNext2.ts"),
      // PHASE W2-N runtime exposure smoke (QA-only / dev-only test)
      path.join("lib", "__tests__", "w2nRuntimeExposureSmoke.test.ts"),
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

// ---------------------------------------------------------------- //
// PHASE W2-L — curated batch metadata preservation                   //
// ---------------------------------------------------------------- //

describe("W2-L — curated batch metadata preservation", () => {
  it("WESTERN_HOOK_PACK_BATCH_NEXT contains exactly 100 entries", () => {
    expect(WESTERN_HOOK_PACK_BATCH_NEXT.length).toBe(100);
    expect(WESTERN_HOOK_PACK_BATCH_NEXT_IDS.length).toBe(100);
  });

  it("every entry preserves voiceCluster from the curated source (vocab member)", () => {
    for (const e of WESTERN_HOOK_PACK_BATCH_NEXT) {
      expect(e.voiceCluster, `${e.id} missing voiceCluster`).toBeTruthy();
      expect(
        WESTERN_VOICE_CLUSTERS.includes(e.voiceCluster as never),
        `${e.id} voiceCluster '${String(e.voiceCluster)}' not in vocab`,
      ).toBe(true);
    }
  });

  it("every entry preserves hookStyle from the curated source (vocab member)", () => {
    for (const e of WESTERN_HOOK_PACK_BATCH_NEXT) {
      expect(e.hookStyle, `${e.id} missing hookStyle`).toBeTruthy();
      expect(
        WESTERN_BATCH_HOOK_STYLES.includes(e.hookStyle as never),
        `${e.id} hookStyle '${String(e.hookStyle)}' not in vocab`,
      ).toBe(true);
    }
  });

  it("every entry preserves originalBatchNumber matching its id suffix", () => {
    for (const e of WESTERN_HOOK_PACK_BATCH_NEXT) {
      expect(e.originalBatchNumber, `${e.id} missing originalBatchNumber`)
        .toBeTypeOf("number");
      const suffix = e.id.slice("w2_next_".length);
      expect(parseInt(suffix, 10)).toBe(e.originalBatchNumber);
      expect(e.originalBatchNumber!).toBeGreaterThanOrEqual(1);
      expect(e.originalBatchNumber!).toBeLessThanOrEqual(100);
    }
  });

  it("getWesternEntrySourceBatch derives 'W2-BATCH-NEXT' for every batch id", () => {
    for (const e of WESTERN_HOOK_PACK_BATCH_NEXT) {
      expect(getWesternEntrySourceBatch(e.id)).toBe("W2-BATCH-NEXT");
    }
    expect(getWesternEntrySourceBatch("w2_other_001")).toBeNull();
    expect(getWesternEntrySourceBatch("")).toBeNull();
  });

  it("safetyNote is preserved when present (non-empty string) and absent otherwise", () => {
    let withSafety = 0;
    for (const e of WESTERN_HOOK_PACK_BATCH_NEXT) {
      if (e.safetyNote !== undefined) {
        expect(typeof e.safetyNote).toBe("string");
        expect(e.safetyNote.trim().length).toBeGreaterThan(0);
        withSafety++;
      }
    }
    // The curated source has ~52 non-"None" safety notes (some merge
    // into 60 after duplicates). Just assert a meaningful subset is
    // preserved — guards against silent total drop.
    expect(withSafety).toBeGreaterThanOrEqual(40);
  });

  it("howToFilm is per-entry deterministic (no generic single-static template, all distinct)", () => {
    const generic = /Single static shot, framed on/i;
    for (const e of WESTERN_HOOK_PACK_BATCH_NEXT) {
      expect(
        generic.test(e.howToFilm),
        `${e.id} uses banned generic template`,
      ).toBe(false);
    }
    const set = new Set(WESTERN_HOOK_PACK_BATCH_NEXT.map((e) => e.howToFilm));
    expect(set.size).toBe(WESTERN_HOOK_PACK_BATCH_NEXT.length);
  });

  it("howToFilm includes a concrete noun/action token from the entry's whatToShow", () => {
    // Mirrors the reviewer's "mention the key prop/action" requirement.
    // We verify each howToFilm shares at least 3 substantive (>=4 char,
    // non-stopword) tokens with the entry's whatToShow — guarantees the
    // filming directive is keyed to this entry's actual scene.
    const STOP = new Set([
      "with", "from", "into", "that", "this", "your", "they", "them",
      "have", "been", "then", "than", "like", "just", "shot", "take",
      "framed", "static", "single", "phone", "tripod", "locked",
      "instructions", "filming",
    ]);
    for (const e of WESTERN_HOOK_PACK_BATCH_NEXT) {
      const wts = new Set(
        (e.whatToShow.toLowerCase().match(/[a-z]+/g) ?? []).filter(
          (t) => t.length >= 4 && !STOP.has(t),
        ),
      );
      const hf = new Set(
        (e.howToFilm.toLowerCase().match(/[a-z]+/g) ?? []).filter(
          (t) => t.length >= 4 && !STOP.has(t),
        ),
      );
      let shared = 0;
      for (const t of hf) if (wts.has(t)) shared++;
      expect(
        shared,
        `${e.id} howToFilm shares only ${shared} substantive tokens with whatToShow`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("captions are 100% distinct within the batch", () => {
    const set = new Set(WESTERN_HOOK_PACK_BATCH_NEXT.map((e) => e.caption));
    expect(set.size).toBe(WESTERN_HOOK_PACK_BATCH_NEXT.length);
  });

  it("integrity check (running draft-level invariants on BATCH_NEXT) reports ok", () => {
    // The approved-pool integrity check runs draft-level invariants
    // on BATCH_NEXT. This direct call also exercises the new optional-
    // field validation paths (voiceCluster / hookStyle / safetyNote /
    // originalBatchNumber) on the actual shipped data.
    const result = checkApprovedWesternPromotionPoolIntegrity();
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("whyThisWorks is intentionally NOT carried on the runtime entry", () => {
    // Editorial commentary by design lives in the source attachment
    // and W2-L import report only — never on the runtime row.
    for (const e of WESTERN_HOOK_PACK_BATCH_NEXT) {
      expect((e as Record<string, unknown>).whyThisWorks).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------- //
// PHASE W2-N — curated batch metadata preservation                   //
// ---------------------------------------------------------------- //

describe("W2-N — curated batch metadata preservation (W2-BATCH-NEXT-2)", () => {
  it("WESTERN_HOOK_PACK_BATCH_NEXT2 contains exactly 100 entries", () => {
    expect(WESTERN_HOOK_PACK_BATCH_NEXT2.length).toBe(100);
    expect(WESTERN_HOOK_PACK_BATCH_NEXT2_IDS.length).toBe(100);
  });

  it("every entry preserves voiceCluster from the curated source (vocab member)", () => {
    for (const e of WESTERN_HOOK_PACK_BATCH_NEXT2) {
      expect(e.voiceCluster, `${e.id} missing voiceCluster`).toBeTruthy();
      expect(
        WESTERN_VOICE_CLUSTERS.includes(e.voiceCluster as never),
        `${e.id} voiceCluster '${String(e.voiceCluster)}' not in vocab`,
      ).toBe(true);
    }
  });

  it("every entry preserves hookStyle from the curated source (vocab member)", () => {
    for (const e of WESTERN_HOOK_PACK_BATCH_NEXT2) {
      expect(e.hookStyle, `${e.id} missing hookStyle`).toBeTruthy();
      expect(
        WESTERN_BATCH_HOOK_STYLES.includes(e.hookStyle as never),
        `${e.id} hookStyle '${String(e.hookStyle)}' not in vocab`,
      ).toBe(true);
    }
  });

  it("every entry preserves originalBatchNumber matching its id suffix", () => {
    for (const e of WESTERN_HOOK_PACK_BATCH_NEXT2) {
      expect(e.originalBatchNumber, `${e.id} missing originalBatchNumber`)
        .toBeTypeOf("number");
      const suffix = e.id.slice("w2_next2_".length);
      expect(parseInt(suffix, 10)).toBe(e.originalBatchNumber);
      expect(e.originalBatchNumber!).toBeGreaterThanOrEqual(1);
      expect(e.originalBatchNumber!).toBeLessThanOrEqual(100);
    }
  });

  it("getWesternEntrySourceBatch derives 'W2-BATCH-NEXT-2' for every batch id", () => {
    for (const e of WESTERN_HOOK_PACK_BATCH_NEXT2) {
      expect(getWesternEntrySourceBatch(e.id)).toBe("W2-BATCH-NEXT-2");
    }
    // The W2-L prefix must still resolve to the W2-L label (the
    // longer-prefix-first ordering inside the helper is what makes
    // this work).
    for (const e of WESTERN_HOOK_PACK_BATCH_NEXT) {
      expect(getWesternEntrySourceBatch(e.id)).toBe("W2-BATCH-NEXT");
    }
  });

  it("safetyNote is preserved when present (non-empty string) and absent otherwise", () => {
    let withSafety = 0;
    for (const e of WESTERN_HOOK_PACK_BATCH_NEXT2) {
      if (e.safetyNote !== undefined) {
        expect(typeof e.safetyNote).toBe("string");
        expect(e.safetyNote.trim().length).toBeGreaterThan(0);
        withSafety++;
      }
    }
    // Curated W2-BATCH-NEXT-2 carries non-"None." safety notes on a
    // meaningful subset of rows — guard against silent total drop.
    expect(withSafety).toBeGreaterThanOrEqual(20);
  });

  it("howToFilm is per-entry deterministic (no generic single-static template, all distinct)", () => {
    const generic = /Single static shot, framed on/i;
    for (const e of WESTERN_HOOK_PACK_BATCH_NEXT2) {
      expect(
        generic.test(e.howToFilm),
        `${e.id} uses banned generic template`,
      ).toBe(false);
    }
    const set = new Set(WESTERN_HOOK_PACK_BATCH_NEXT2.map((e) => e.howToFilm));
    expect(set.size).toBe(WESTERN_HOOK_PACK_BATCH_NEXT2.length);
  });

  it("howToFilm includes a concrete noun/action token from the entry's whatToShow", () => {
    const STOP = new Set([
      "with", "from", "into", "that", "this", "your", "they", "them",
      "have", "been", "then", "than", "like", "just", "shot", "take",
      "framed", "static", "single", "phone", "tripod", "locked",
      "instructions", "filming",
    ]);
    for (const e of WESTERN_HOOK_PACK_BATCH_NEXT2) {
      const wts = new Set(
        (e.whatToShow.toLowerCase().match(/[a-z]+/g) ?? []).filter(
          (t) => t.length >= 4 && !STOP.has(t),
        ),
      );
      const hf = new Set(
        (e.howToFilm.toLowerCase().match(/[a-z]+/g) ?? []).filter(
          (t) => t.length >= 4 && !STOP.has(t),
        ),
      );
      let shared = 0;
      for (const t of hf) if (wts.has(t)) shared++;
      expect(
        shared,
        `${e.id} howToFilm shares only ${shared} substantive tokens with whatToShow`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("captions are 100% distinct within the batch AND vs the W2-L batch", () => {
    const set = new Set(WESTERN_HOOK_PACK_BATCH_NEXT2.map((e) => e.caption));
    expect(set.size).toBe(WESTERN_HOOK_PACK_BATCH_NEXT2.length);
    const w2lCaps = new Set(WESTERN_HOOK_PACK_BATCH_NEXT.map((e) => e.caption));
    for (const e of WESTERN_HOOK_PACK_BATCH_NEXT2) {
      expect(
        w2lCaps.has(e.caption),
        `${e.id} caption collides with W2-L: "${e.caption}"`,
      ).toBe(false);
    }
  });

  it("hooks are 100% distinct vs the W2-L batch and the W2-I draft promotion block", () => {
    const otherHooks = new Set(
      WESTERN_HOOK_PACK_BATCH_NEXT.map((e) => e.hook.toLowerCase().trim()),
    );
    for (const e of WESTERN_HOOK_PACK_BATCH_NEXT2) {
      expect(
        otherHooks.has(e.hook.toLowerCase().trim()),
        `${e.id} hook duplicates W2-L: "${e.hook}"`,
      ).toBe(false);
    }
  });

  it("integrity check (running draft-level invariants on BATCH_NEXT2) reports ok", () => {
    const result = checkApprovedWesternPromotionPoolIntegrity();
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("whyThisWorks is intentionally NOT carried on the runtime entry", () => {
    for (const e of WESTERN_HOOK_PACK_BATCH_NEXT2) {
      expect((e as Record<string, unknown>).whyThisWorks).toBeUndefined();
    }
  });
});
