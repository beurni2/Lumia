/**
 * @workspace/swarm-studio
 *
 * The collaborative agent swarm:
 *   Sprint 2: Ideator → Director → Editor → Monetizer.
 *   Sprint 3: + Smart Publisher (12-variant A/B + Compliance Shield + smart
 *             watermark + per-platform adaptation).
 */
export * from "./types";
export { InMemoryMemoryGraph, AlwaysAllowConsent } from "./memory";
export { MockOrchestrator, type MockOrchestratorOptions } from "./mockOrchestrator";
export { ideate, isoDay, scoreBrief } from "./agents/ideator";
export { direct } from "./agents/director";
export { edit, TwinMatchRejected } from "./agents/editor";
export { monetize } from "./agents/monetizer";
export { buildPublishPlan, launchPublishPlan, ALL_PLATFORMS } from "./agents/publisher";
export {
  generateABVariants,
  pickWinner,
  type ABVariant,
  type ABInputs,
  VARIANT_COUNT,
  REQUIRED_THUMBNAILS,
  REQUIRED_CAPTIONS,
  REQUIRED_HOOKS,
} from "./abTest";
export {
  watermark,
  readWatermark,
  WATERMARK_TAG,
  WATERMARK_VERSION,
  type SmartWatermark,
  type WatermarkInput,
} from "./watermark";
export { REGIONAL_TRENDS, type RegionalTrend } from "./regionalTrends";
export {
  runEarningsCycle,
  type EarningsContext,
  type EarningsCycleInput,
  type EarningsCycleResult,
} from "./agents/earnings";

export const SPRINT = 3 as const;
export const STATUS = "smart-publisher" as const;
