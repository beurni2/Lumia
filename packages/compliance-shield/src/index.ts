/**
 * @workspace/compliance-shield
 *
 * In-process policy engine that gates every outbound publish. Six policy
 * packs (TikTok, Reels, Shorts, Kwai, GoPlay-ID, Kumu-PH) — auto-rewrite
 * pipeline for soft flags, plain-language hard blocks for the rest.
 *
 * SPRINT 3 (weeks 5–6) — pure, deterministic, zero network. Ships against
 * the Sprint 3 phase-complete audit (zero false negatives on the red-team
 * corpus).
 */
export * from "./types";
export { evaluate, autoRewrite } from "./engine";
export {
  POLICY_PACKS,
  ALL_PLATFORMS,
  TIKTOK_PACK,
  REELS_PACK,
  SHORTS_PACK,
  KWAI_PACK,
  GOPLAY_PACK,
  KUMU_PACK,
} from "./policies";

export const SPRINT = 3 as const;
export const STATUS = "policy-engine" as const;
