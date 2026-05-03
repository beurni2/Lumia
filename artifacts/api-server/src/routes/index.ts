import { Router, type IRouter } from "express";

import { flags } from "../lib/featureFlags";
import healthRouter from "./health";
import creatorRouter from "./creator";
import trendsRouter from "./trends";
import earningsRouter from "./earnings";
import videosRouter from "./videos";
import agentsRouter from "./agents";
import publicationsRouter from "./publications";
import meRouter from "./me";
import adminRouter from "./admin";
import webhooksRouter from "./webhooks";
import billingRouter from "./billing";
import payoutsRouter from "./payouts";
import ideatorRouter from "./ideator";
import styleProfileRouter from "./styleProfile";
import importedVideosRouter from "./importedVideos";
import visionStyleRouter from "./visionStyle";
import ideaFeedbackRouter from "./ideaFeedback";
import tasteCalibrationRouter from "./tasteCalibration";
import enhancementsRouter from "./enhancements";
// PHASE Z1-QA — dev-gated willingness ranker effectiveness
// report. Mounted only outside production (defense-in-depth
// re-check at handler entry too). Intended to be merged-and-
// removed in the same cycle the Z1 measurement window closes —
// same pattern D5-QA used.
import z1QaRouter from "./z1Qa";

const router: IRouter = Router();

// ---------------------------------------------------------------- //
// v1 MVP routes (always mounted)                                   //
// ---------------------------------------------------------------- //
//   • health         — operational pings
//   • creator        — /api/creator/me, the single resolved-creator read
//   • trends         — legacy global trend feed (kept for back-compat)
//   • videos         — the user's imported clips
//   • me             — consent surface (withdraw / export / delete)
//   • style-profile  — GET/POST the lightweight rule-based Style Profile
//   • ideator        — POST /api/ideator/generate, the single v1 LLM call
router.use(healthRouter);
router.use(creatorRouter);
router.use(trendsRouter);
router.use(videosRouter);
router.use(meRouter);
router.use(styleProfileRouter);
router.use(ideatorRouter);
router.use(importedVideosRouter);
//   • vision-style   — POST /api/imported-videos/:id/vision-frames
//     receives on-device-sampled thumbnail frames, runs Llama 3.2
//     Vision via OpenRouter, aggregates per-creator vision-derived
//     style hints. Mounted AFTER importedVideosRouter so the same
//     `/imported-videos/...` prefix is shared cleanly by both.
router.use(visionStyleRouter);
//   • idea-feedback  — POST /api/ideas/feedback ("Would you post this?")
router.use(ideaFeedbackRouter);
//   • enhancements   — POST /api/enhancements/suggest, the per-clip
//     improvement brain. Reuses the ideator's style hints + viral
//     pattern memory so the suggestions speak in the same logic
//     stack the ideator ships ideas in.
router.use(enhancementsRouter);
//   • taste-calibration — GET/POST /api/taste-calibration (optional
//     5-question onboarding bias for the ideator). Pure additive;
//     skipped state is honoured so we never re-prompt.
router.use(tasteCalibrationRouter);

// PHASE Z1-QA — dev-only. The route handler also 404s in
// production as defense-in-depth, but skipping the mount here
// keeps the production router table free of any Z1-QA path.
if (process.env.NODE_ENV !== "production") {
  router.use(z1QaRouter);
}

// ---------------------------------------------------------------- //
// Archived routes (Phase 1 freeze)                                 //
// ---------------------------------------------------------------- //
// Each subsystem is gated on its own flag. In the default build
// every flag is ON ⇒ none of these routes are reachable. A request
// to a frozen path falls through to the 404 handler, which is the
// desired closed-by-default behaviour while we validate the v1 loop.
if (!flags.ARCHIVED_AUTONOMY) {
  router.use(agentsRouter);
  router.use(adminRouter);
}
if (!flags.ARCHIVED_MONETIZATION) {
  router.use(earningsRouter);
  router.use(billingRouter);
  router.use(payoutsRouter);
}
if (!flags.ARCHIVED_POSTING) {
  router.use(publicationsRouter);
}
// Webhooks bundle Stripe (monetization) + Clerk (account lifecycle
// for posting / metrics). Mount only if at least one of those
// dependent subsystems is unfrozen, otherwise no event has anywhere
// to be dispatched and we'd rather 404 than accept-and-drop.
if (!flags.ARCHIVED_MONETIZATION || !flags.ARCHIVED_POSTING) {
  router.use(webhooksRouter);
}

export default router;
