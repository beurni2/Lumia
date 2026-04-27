/**
 * Mobile-side types + API client for the optional Taste Calibration
 * step (5 tap-only preference questions surfaced after the Style
 * Profile reveal on first onboarding). Mirrors the schema in
 * `artifacts/api-server/src/lib/tasteCalibration.ts`. The two files
 * MUST stay in sync — the server zod-validates the POST body so a
 * drift here would surface as a 400 invalid_body, not silent
 * corruption.
 */

import { customFetch } from "@workspace/api-client-react";

export type PreferredFormat = "mini_story" | "reaction" | "pov" | "mixed";
export type PreferredTone =
  | "dry_subtle"
  | "chaotic"
  | "bold"
  | "self_aware";
export type EffortPreference = "zero_effort" | "low_effort" | "structured";
export type PrivacyAvoidance =
  | "avoid_messages"
  | "avoid_finance"
  | "avoid_people"
  | "avoid_private_info"
  | "no_privacy_limits";
export type PreferredHookStyle =
  | "behavior_hook"
  | "thought_hook"
  | "curiosity_hook"
  | "contrast_hook";

export type TasteCalibration = {
  preferredFormats: PreferredFormat[];
  preferredTone: PreferredTone | null;
  effortPreference: EffortPreference | null;
  privacyAvoidances: PrivacyAvoidance[];
  preferredHookStyles: PreferredHookStyle[];
  completedAt: string | null;
  skipped: boolean;
};

export type CalibrationResponse = {
  calibration: TasteCalibration | null;
};

export const EMPTY_CALIBRATION: TasteCalibration = {
  preferredFormats: [],
  preferredTone: null,
  effortPreference: null,
  privacyAvoidances: [],
  preferredHookStyles: [],
  completedAt: null,
  skipped: false,
};

export async function fetchTasteCalibration(): Promise<TasteCalibration | null> {
  const res = await customFetch<CalibrationResponse>("/api/taste-calibration");
  return res.calibration;
}

export async function saveTasteCalibration(
  doc: TasteCalibration,
): Promise<TasteCalibration | null> {
  const res = await customFetch<CalibrationResponse>(
    "/api/taste-calibration",
    {
      method: "POST",
      body: JSON.stringify(doc),
    },
  );
  return res.calibration;
}

export async function skipTasteCalibration(): Promise<TasteCalibration | null> {
  return saveTasteCalibration({ ...EMPTY_CALIBRATION, skipped: true });
}
