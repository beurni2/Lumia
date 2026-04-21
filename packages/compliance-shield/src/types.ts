/**
 * @workspace/compliance-shield — types.
 *
 * The Shield's job is to refuse to let a single creator-facing decision out
 * the door without an in-process policy verdict. Every outbound piece of
 * content (caption, hook, hashtags, audio cue, thumbnail label) is evaluated
 * against the platform packs the user is publishing to. Soft flags get
 * auto-rewritten in place; hard flags block the publish with a plain-language
 * explanation the creator can read in the Smart Publisher UI.
 *
 * The Shield is a pure, in-process function. Zero network. Deterministic
 * for any (content, pack) pair so the Sprint 3 phase-complete audit's red-
 * team corpus replays bit-identically in CI.
 */

export type PlatformId =
  | "tiktok"
  | "reels"
  | "shorts"
  | "kwai"
  | "goplay" // Indonesia (Telkom Indonesia)
  | "kumu";  // Philippines

export type RuleSeverity = "soft" | "hard";

/** What an outbound publish looks like before the Shield rules run. */
export interface PublishContent {
  readonly caption: string;
  readonly hook: string;
  readonly hashtags: readonly string[];
  readonly audioCue: string;
  readonly thumbnailLabel: string;
  readonly durationSec: number;
  /** Region codes the creator is publishing into (e.g. ["br","mx"]). */
  readonly regions: readonly string[];
}

/**
 * A single in-process rule. Pure; runs on the device.
 *
 *   - `match` returns true iff the rule applies to this content.
 *   - `rewrite` (soft only) returns an auto-corrected PublishContent.
 *     Hard rules MUST NOT define a rewrite — they exist to block.
 */
export interface PolicyRule {
  readonly id: string;
  readonly severity: RuleSeverity;
  readonly humanExplanation: string;
  readonly match: (c: PublishContent) => boolean;
  readonly rewrite?: (c: PublishContent) => PublishContent;
}

export interface PolicyPack {
  readonly platform: PlatformId;
  readonly displayName: string;
  /** Region the pack is canonical for (UI hint; rules apply globally). */
  readonly canonicalRegion: string;
  readonly rules: readonly PolicyRule[];
}

export interface RuleHit {
  readonly ruleId: string;
  readonly platform: PlatformId;
  readonly severity: RuleSeverity;
  readonly explanation: string;
}

export type ShieldStatus = "pass" | "rewritten" | "blocked";

export interface ShieldVerdict {
  readonly status: ShieldStatus;
  /** All rule hits across every supplied pack, in deterministic order. */
  readonly hits: readonly RuleHit[];
  /** Auto-rewritten content if any soft rule fired (still subject to hard hits). */
  readonly rewritten: PublishContent;
  /** Number of rewrite passes applied (capped — see MAX_REWRITE_PASSES). */
  readonly rewritePasses: number;
}

/**
 * Cap on auto-rewrite iterations. Rewrites can themselves trip new soft
 * rules; we re-run until the verdict stabilises or this cap is reached.
 * Above the cap the Shield falls back to "blocked" with all unresolved hits.
 */
export const MAX_REWRITE_PASSES = 4 as const;
