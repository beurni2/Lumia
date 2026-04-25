/**
 * Onboarding route — thin gating layer.
 *
 * Defaults to the lean Phase-1 MVP flow (region picker → 3 video
 * imports with a quick-win idea after the first). The original
 * cinematic 3-act experience is frozen behind a build-time flag —
 * set EXPO_PUBLIC_USE_CINEMATIC_ONBOARDING=true to switch back.
 *
 * The MVP onboarding does NOT collect FTC/COPPA consent because
 * the publish + swarm endpoints that would refuse without it are
 * archived behind their own server-side feature flags during
 * Phase 1. If those subsystems are reactivated, route the user
 * through CinematicOnboarding (or surface a focused consent modal)
 * BEFORE re-mounting them.
 */

import React from "react";

import CinematicOnboarding from "@/components/onboarding/CinematicOnboarding";
import MvpOnboarding from "@/components/onboarding/MvpOnboarding";

const USE_CINEMATIC =
  process.env.EXPO_PUBLIC_USE_CINEMATIC_ONBOARDING === "true";

export default function OnboardingRoute() {
  return USE_CINEMATIC ? <CinematicOnboarding /> : <MvpOnboarding />;
}
