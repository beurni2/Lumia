/**
 * useStudioSummary — single-fan-out data hook for the Studio control
 * centre tab.
 *
 * The new Studio tab needs three independent reads to render:
 *   1. GET /api/style-profile      — derivedTone + viralMemory summary
 *   2. GET /api/imported-videos    — Style Twin state A (no uploads)
 *                                    vs B (count > 0) detection
 *   3. GET /api/taste-calibration  — current preferred formats / tone
 *                                    for the "Tune your ideas" chips
 *
 * They are all cheap and independent so we fire them in parallel
 * with `Promise.all`. Each one is swallowed individually on failure
 * so a single 500 doesn't blank the whole screen — the affected
 * section just falls back to its "no data yet" empty state.
 *
 * Matches the home tab's patterns exactly: customFetch + plain
 * useState, no react-query (Lumina doesn't pull react-query into
 * the bundle for the few screens that need fetching).
 */

import { useCallback, useEffect, useState } from "react";

import { customFetch } from "@workspace/api-client-react";

import type { Bundle } from "@/constants/regions";
import {
  fetchTasteCalibration,
  type TasteCalibration,
} from "@/lib/tasteCalibration";

/**
 * Mirrors the additive shape of GET /api/style-profile in
 * `artifacts/api-server/src/routes/styleProfile.ts`. The legacy
 * fields (hasProfile / profile / region / lastIdeaBatchAt) match the
 * Home tab's local copy of the type so existing consumers keep
 * working unchanged. The three new fields below are populated by
 * existing pure helpers — see the route comment for the rationale.
 */
export type DerivedToneValue =
  | "dry"
  | "chaotic"
  | "self-aware"
  | "confident";

export type DerivedStyleHintsValue = {
  tone: "dry" | "chaotic" | "self_aware" | "confident" | "neutral";
  hookVoice: string[];
  captionVoice: string[];
  emojiPreference: "none" | "low" | "medium";
  sentenceStyle: "short" | "medium" | "punchy";
  energyLevel: "low" | "medium" | "high";
  confidence: number;
};

export type ViralMemorySummary = {
  topStructures: { name: string; weight: number }[];
  topHookStyles: { name: string; weight: number }[];
  topFormats: { name: string; weight: number }[];
  topEmotionalSpike: string | null;
  topFormat: string | null;
  sampleSize: number;
};

export type StyleProfilePayload = {
  hasProfile: boolean;
  profile: unknown;
  region: Bundle | null;
  lastIdeaBatchAt: string | null;
  derivedTone: DerivedToneValue | null;
  derivedStyleHints: DerivedStyleHintsValue | null;
  viralMemory: ViralMemorySummary | null;
};

type ImportedVideosPayload = {
  count: number;
  videos: {
    id: string;
    filename: string | null;
    durationSec: number | null;
    createdAt: string;
  }[];
};

export type StudioSummary = {
  styleProfile: StyleProfilePayload | null;
  importedVideosCount: number;
  calibration: TasteCalibration | null;
  /**
   * Per-surface failure flags. We keep partial-failure isolation
   * (one bad endpoint shouldn't blank the screen) but the UI MUST
   * be able to tell "no data yet" from "the fetch failed", because
   * those two states imply very different copy + actions. e.g. if
   * imported-videos failed we don't want to silently render the
   * "Make Lumina sound like you" empty state for a creator who
   * has actually trained — that would be a lie.
   */
  styleProfileFailed: boolean;
  importedVideosFailed: boolean;
  calibrationFailed: boolean;
};

export type StudioSummaryState = {
  data: StudioSummary | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

/**
 * Fetches the three Studio surfaces in parallel. Each branch is
 * try/catch-isolated so one failure doesn't poison the rest.
 */
async function loadStudioSummary(): Promise<StudioSummary> {
  const [styleResult, videosResult, calibrationResult] = await Promise.all([
    (async () => {
      try {
        const r = await customFetch<StyleProfilePayload>("/api/style-profile");
        return { value: r, failed: false };
      } catch {
        return { value: null, failed: true };
      }
    })(),
    (async () => {
      try {
        const r = await customFetch<ImportedVideosPayload>(
          "/api/imported-videos",
        );
        return { value: r.count, failed: false };
      } catch {
        return { value: 0, failed: true };
      }
    })(),
    (async () => {
      try {
        const r = await fetchTasteCalibration();
        return { value: r, failed: false };
      } catch {
        return { value: null, failed: true };
      }
    })(),
  ]);

  return {
    styleProfile: styleResult.value,
    importedVideosCount: videosResult.value,
    calibration: calibrationResult.value,
    styleProfileFailed: styleResult.failed,
    importedVideosFailed: videosResult.failed,
    calibrationFailed: calibrationResult.failed,
  };
}

export function useStudioSummary(): StudioSummaryState {
  const [data, setData] = useState<StudioSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const summary = await loadStudioSummary();
      setData(summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load studio.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const summary = await loadStudioSummary();
        if (!cancelled) setData(summary);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Couldn't load studio.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, loading, error, refresh };
}
