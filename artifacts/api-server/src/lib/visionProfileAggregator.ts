/**
 * Aggregates per-video vision analyses into a per-creator
 * `visionStyleJson` document and a small `derivedStyleHints`
 * rollup that the pattern engine can SOFT-bias on.
 *
 * Privacy posture (per spec, NON-NEGOTIABLE):
 *   - When `analysis.privacyRisk === true`, the analysis is NOT
 *     aggregated into the per-video log and NOT counted toward
 *     derivedStyleHints frequency. We still bump `totalAnalyzed`
 *     so `/me/data-delete` and any future per-creator transparency
 *     surface can show the user "we analyzed N frames, dropped K
 *     for privacy."
 *   - The free-text `visibleAction` field is DROPPED before
 *     persistence. Only the enum signals + a one-line summary
 *     ("setting=…, framing=…") are stored long-term.
 *   - `perVideoSignals` is capped at MAX_PER_VIDEO_SIGNALS = 10
 *     (FIFO eviction) so a creator who imports 100 videos doesn't
 *     accumulate 100 forever.
 *   - Idempotent on `importedVideoId` — re-POSTing the same video
 *     replaces the existing entry rather than double-counting.
 *
 * Hint computation rule (per spec):
 *   "After 3+ uploaded videos: count repeated style signals."
 *
 *   We require `perVideoSignals.length >= MIN_VIDEOS_FOR_HINTS = 3`
 *   before producing any hints at all (under-sample → empty hints
 *   → no bias). Once at threshold, for each category we tally the
 *   non-`unknown` values across the window and include any value
 *   that appears in `>= ceil(window * 0.5)` videos. The 50% floor
 *   matches the spec's "2/3" example and scales naturally as the
 *   window grows. Capped at the top-2 most-frequent per category
 *   so a noisy distribution doesn't produce a half-dozen weak
 *   "preferences."
 */

import type { VisionAnalysis } from "./visionStyleExtractor";

// -----------------------------------------------------------------------------
// Tunables
// -----------------------------------------------------------------------------

export const MAX_PER_VIDEO_SIGNALS = 10;
export const MIN_VIDEOS_FOR_HINTS = 3;
export const MIN_FREQUENCY_RATIO = 0.5; // 50% floor — matches spec's "2/3" example
export const MAX_HINTS_PER_CATEGORY = 2;

export const VISION_STYLE_DOC_VERSION = 1 as const;

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * Persisted-per-video signal. Note the deliberate ABSENCE of
 * `visibleAction` and `privacyRiskReason` — we don't keep raw
 * text, only enums.
 */
export type PerVideoSignal = {
  importedVideoId: string;
  analyzedAt: string; // ISO8601 UTC
  contentType: VisionAnalysis["contentType"];
  setting: VisionAnalysis["setting"];
  energyLevel: VisionAnalysis["energyLevel"];
  deliveryStyle: VisionAnalysis["deliveryStyle"];
  framing: VisionAnalysis["framing"];
  reactionType: VisionAnalysis["reactionType"];
  talking: boolean;
};

export type DerivedStyleHints = {
  preferredFormats: VisionAnalysis["contentType"][];
  preferredSettings: VisionAnalysis["setting"][];
  preferredEnergy: VisionAnalysis["energyLevel"][];
  preferredFraming: VisionAnalysis["framing"][];
  preferredReactionTypes: VisionAnalysis["reactionType"][];
};

export type VisionStyleDoc = {
  version: typeof VISION_STYLE_DOC_VERSION;
  perVideoSignals: PerVideoSignal[];
  derivedStyleHints: DerivedStyleHints;
  // Total frame-batches we *processed* — including ones we dropped
  // for privacy. Differs from `perVideoSignals.length` after a
  // privacy drop or a FIFO eviction; the latter is bounded at 10.
  totalAnalyzed: number;
  // Total frame-batches we DROPPED for privacy. Bookkeeping only;
  // surfaces in /me/data-delete as "we received N frames you
  // uploaded but never persisted any of them."
  totalDroppedForPrivacy: number;
  lastUpdatedAt: string; // ISO8601 UTC
};

export const EMPTY_DERIVED_STYLE_HINTS: DerivedStyleHints = {
  preferredFormats: [],
  preferredSettings: [],
  preferredEnergy: [],
  preferredFraming: [],
  preferredReactionTypes: [],
};

export const EMPTY_VISION_STYLE_DOC: VisionStyleDoc = {
  version: VISION_STYLE_DOC_VERSION,
  perVideoSignals: [],
  derivedStyleHints: EMPTY_DERIVED_STYLE_HINTS,
  totalAnalyzed: 0,
  totalDroppedForPrivacy: 0,
  lastUpdatedAt: new Date(0).toISOString(),
};

// -----------------------------------------------------------------------------
// Parser — accepts the raw jsonb column shape (unknown), tolerant of
// pre-v21 NULL and any future shape drift.
// -----------------------------------------------------------------------------

/**
 * Parse the raw jsonb value off `creators.vision_style_json` into a
 * fully-typed `VisionStyleDoc`. Tolerant: any malformed shape (or
 * NULL / undefined) returns the empty doc rather than throwing.
 */
export function parseVisionStyleDoc(raw: unknown): VisionStyleDoc {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...EMPTY_VISION_STYLE_DOC };
  }
  const obj = raw as Record<string, unknown>;

  const signals: PerVideoSignal[] = [];
  if (Array.isArray(obj.perVideoSignals)) {
    for (const item of obj.perVideoSignals) {
      if (!item || typeof item !== "object") continue;
      const s = item as Record<string, unknown>;
      if (typeof s.importedVideoId !== "string") continue;
      if (typeof s.analyzedAt !== "string") continue;
      // Trust the values here — they were enum-clamped at write
      // time by visionStyleExtractor.parseVisionResponse. Cast
      // through unknown so the type system follows along.
      signals.push({
        importedVideoId: s.importedVideoId,
        analyzedAt: s.analyzedAt,
        contentType: (s.contentType ?? "unknown") as VisionAnalysis["contentType"],
        setting: (s.setting ?? "unknown") as VisionAnalysis["setting"],
        energyLevel: (s.energyLevel ?? "unknown") as VisionAnalysis["energyLevel"],
        deliveryStyle: (s.deliveryStyle ?? "unknown") as VisionAnalysis["deliveryStyle"],
        framing: (s.framing ?? "unknown") as VisionAnalysis["framing"],
        reactionType: (s.reactionType ?? "unknown") as VisionAnalysis["reactionType"],
        talking: typeof s.talking === "boolean" ? s.talking : false,
      });
    }
  }

  const totalAnalyzed =
    typeof obj.totalAnalyzed === "number" && obj.totalAnalyzed >= 0
      ? Math.floor(obj.totalAnalyzed)
      : signals.length;
  const totalDroppedForPrivacy =
    typeof obj.totalDroppedForPrivacy === "number" &&
    obj.totalDroppedForPrivacy >= 0
      ? Math.floor(obj.totalDroppedForPrivacy)
      : 0;
  const lastUpdatedAt =
    typeof obj.lastUpdatedAt === "string"
      ? obj.lastUpdatedAt
      : EMPTY_VISION_STYLE_DOC.lastUpdatedAt;

  return {
    version: VISION_STYLE_DOC_VERSION,
    perVideoSignals: signals,
    // Derived hints are recomputed on every aggregate; the stored
    // value is just a cache for read-time bias. Trust it on read.
    derivedStyleHints:
      parseDerivedHints(obj.derivedStyleHints) ?? EMPTY_DERIVED_STYLE_HINTS,
    totalAnalyzed,
    totalDroppedForPrivacy,
    lastUpdatedAt,
  };
}

function parseDerivedHints(raw: unknown): DerivedStyleHints | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const arr = (key: string): string[] => {
    const v = obj[key];
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === "string");
  };
  return {
    preferredFormats: arr("preferredFormats") as VisionAnalysis["contentType"][],
    preferredSettings: arr("preferredSettings") as VisionAnalysis["setting"][],
    preferredEnergy: arr("preferredEnergy") as VisionAnalysis["energyLevel"][],
    preferredFraming: arr("preferredFraming") as VisionAnalysis["framing"][],
    preferredReactionTypes: arr("preferredReactionTypes") as VisionAnalysis["reactionType"][],
  };
}

// -----------------------------------------------------------------------------
// Hint computation — frequency-based, with a 50% floor + top-2 cap
// -----------------------------------------------------------------------------

function topN<T extends string>(
  values: T[],
  threshold: number,
  cap: number,
): T[] {
  if (values.length === 0) return [];
  const tally = new Map<T, number>();
  for (const v of values) {
    if (v === ("unknown" as T)) continue; // never bias toward "unknown"
    tally.set(v, (tally.get(v) ?? 0) + 1);
  }
  const eligible = [...tally.entries()].filter(([, n]) => n >= threshold);
  // Stable ordering: highest frequency first, ties broken by insertion order
  // (Map iteration order is insertion order in JS).
  eligible.sort((a, b) => b[1] - a[1]);
  return eligible.slice(0, cap).map(([v]) => v);
}

/**
 * Recompute the `derivedStyleHints` rollup from the current
 * `perVideoSignals` window. Returns the empty hints object when
 * we're under the minimum-videos threshold (no premature bias on
 * the first 1-2 uploads).
 *
 * Exported separately so the QA harness + the route's "what did we
 * just learn" response shape can both consume it without going
 * through the full aggregate path.
 */
export function computeDerivedStyleHints(
  signals: PerVideoSignal[],
): DerivedStyleHints {
  if (signals.length < MIN_VIDEOS_FOR_HINTS) {
    return { ...EMPTY_DERIVED_STYLE_HINTS };
  }
  const threshold = Math.ceil(signals.length * MIN_FREQUENCY_RATIO);
  return {
    preferredFormats: topN(
      signals.map((s) => s.contentType),
      threshold,
      MAX_HINTS_PER_CATEGORY,
    ),
    preferredSettings: topN(
      signals.map((s) => s.setting),
      threshold,
      MAX_HINTS_PER_CATEGORY,
    ),
    preferredEnergy: topN(
      signals.map((s) => s.energyLevel),
      threshold,
      MAX_HINTS_PER_CATEGORY,
    ),
    preferredFraming: topN(
      signals.map((s) => s.framing),
      threshold,
      MAX_HINTS_PER_CATEGORY,
    ),
    preferredReactionTypes: topN(
      signals.map((s) => s.reactionType),
      threshold,
      MAX_HINTS_PER_CATEGORY,
    ),
  };
}

// -----------------------------------------------------------------------------
// Aggregator — the canonical write path
// -----------------------------------------------------------------------------

export type AggregateArgs = {
  existing: VisionStyleDoc | null;
  newAnalysis: VisionAnalysis;
  importedVideoId: string;
  // Optional override for testing. In production this is `new Date()`.
  now?: Date;
};

export type AggregateResult = {
  doc: VisionStyleDoc;
  // For telemetry / route-response surfacing — did we drop the
  // analysis for privacy reasons?
  droppedForPrivacy: boolean;
  // Did the derivedStyleHints rollup actually change as a result
  // of this update? Lets the route avoid spurious "you just
  // learned X" UX for incremental no-op uploads.
  hintsChanged: boolean;
};

/**
 * Idempotent on `importedVideoId`. Drops privacy-flagged analyses
 * (still bumps counters). FIFO-evicts down to MAX_PER_VIDEO_SIGNALS
 * after insert. Recomputes hints from scratch (cheap — the window
 * is tiny by construction).
 */
export function aggregateVisionStyle(args: AggregateArgs): AggregateResult {
  const existing = args.existing ?? { ...EMPTY_VISION_STYLE_DOC };
  const now = args.now ?? new Date();
  const nowIso = now.toISOString();

  // Privacy drop — short-circuit before we touch the signals array.
  // Counter still bumps so /me/data-delete can show the drop.
  if (args.newAnalysis.privacyRisk) {
    return {
      doc: {
        ...existing,
        version: VISION_STYLE_DOC_VERSION,
        // Keep the derivedStyleHints unchanged — a privacy drop
        // shouldn't cause a hint flicker.
        totalAnalyzed: existing.totalAnalyzed + 1,
        totalDroppedForPrivacy: existing.totalDroppedForPrivacy + 1,
        lastUpdatedAt: nowIso,
      },
      droppedForPrivacy: true,
      hintsChanged: false,
    };
  }

  // Build the new per-video signal — note the deliberate omission
  // of `visibleAction` and `privacyRiskReason`. Enums only.
  const newSignal: PerVideoSignal = {
    importedVideoId: args.importedVideoId,
    analyzedAt: nowIso,
    contentType: args.newAnalysis.contentType,
    setting: args.newAnalysis.setting,
    energyLevel: args.newAnalysis.energyLevel,
    deliveryStyle: args.newAnalysis.deliveryStyle,
    framing: args.newAnalysis.framing,
    reactionType: args.newAnalysis.reactionType,
    talking: args.newAnalysis.talking,
  };

  // Idempotency — replace any existing entry for the same
  // importedVideoId. The "first hit wins" alternative would let
  // a user re-trigger the analysis (e.g. after we improve the
  // model) without seeing the update; replace-on-id matches the
  // user expectation that a re-upload reflects the latest call.
  const filteredExisting = existing.perVideoSignals.filter(
    (s) => s.importedVideoId !== args.importedVideoId,
  );
  const isReplacement =
    filteredExisting.length !== existing.perVideoSignals.length;

  // FIFO eviction — most-recent at the END of the array, oldest at
  // the START. Cap to MAX_PER_VIDEO_SIGNALS by trimming from the
  // FRONT after we append.
  let nextSignals = [...filteredExisting, newSignal];
  if (nextSignals.length > MAX_PER_VIDEO_SIGNALS) {
    nextSignals = nextSignals.slice(
      nextSignals.length - MAX_PER_VIDEO_SIGNALS,
    );
  }

  const nextHints = computeDerivedStyleHints(nextSignals);
  const hintsChanged = !areHintsEqual(existing.derivedStyleHints, nextHints);

  return {
    doc: {
      version: VISION_STYLE_DOC_VERSION,
      perVideoSignals: nextSignals,
      derivedStyleHints: nextHints,
      // Replacements DON'T bump totalAnalyzed — the user already
      // got "credit" for the first analysis; a re-analysis of the
      // same video isn't a new piece of data.
      totalAnalyzed: existing.totalAnalyzed + (isReplacement ? 0 : 1),
      totalDroppedForPrivacy: existing.totalDroppedForPrivacy,
      lastUpdatedAt: nowIso,
    },
    droppedForPrivacy: false,
    hintsChanged,
  };
}

function areHintsEqual(a: DerivedStyleHints, b: DerivedStyleHints): boolean {
  const keys: (keyof DerivedStyleHints)[] = [
    "preferredFormats",
    "preferredSettings",
    "preferredEnergy",
    "preferredFraming",
    "preferredReactionTypes",
  ];
  for (const k of keys) {
    const av = a[k];
    const bv = b[k];
    if (av.length !== bv.length) return false;
    // Order matters in our representation (highest-frequency
    // first), so a reordering counts as a change.
    for (let i = 0; i < av.length; i++) {
      if (av[i] !== bv[i]) return false;
    }
  }
  return true;
}
