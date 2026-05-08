/**
 * PHASE W2-O — Western LIVE promotion pool (editor-signed).
 *
 * This module produces the editor-signed live Western hook pack
 * (`WESTERN_HOOK_PACK_LIVE`) by running the deterministic
 * promotion rubric (`westernPromotionRubric.ts`) over the staging
 * pool (`APPROVED_WESTERN_PROMOTION_CANDIDATES`) and keeping only
 * entries whose recommendation is `"promote"`.
 *
 * The live pool is gated by a separate environment flag —
 * `LUMINA_W2_WESTERN_LIVE_ENABLED` — that is independent of the
 * staging-pool flag (`LUMINA_W2_WESTERN_APPROVED_ENABLED`). At the
 * activation site (`getActiveWesternPool` in
 * `westernPackSlotReservation.ts`) the two flags are MUTUALLY
 * EXCLUSIVE: when both are ON the live pool wins and a loud warning
 * is emitted by the caller. Production `start` script does NOT set
 * either flag — both default OFF in production.
 *
 * Safety model:
 *
 *   1. Live entries inherit every text field from the staging pool
 *      VERBATIM. Only `reviewedBy` is overwritten with the system
 *      sign-off stamp `WESTERN_LIVE_PROMOTION_SIGNOFF`. Promoting a
 *      different (e.g. human-curated) live pool would replace this
 *      module's body with a frozen literal whose `reviewedBy` is the
 *      human reviewer's initials+date stamp.
 *   2. The live-pool integrity check INVERTS the staging-pool stamp
 *      rule: it REJECTS `PENDING_EDITORIAL_REVIEW`, REJECTS empty /
 *      missing `reviewedBy`, and REJECTS duplicate ids / hooks /
 *      skeletons.
 *   3. The live pool ships SMALLER than the staging pool — exactly
 *      the rubric's `recommendation === "promote"` subset. The
 *      remaining staging entries continue to be reachable via the
 *      staging-pool flag for editorial iteration.
 *
 * Hard rules honored:
 *   • No validator loosening — the rubric's `validatorSurvival`
 *     dimension calls the SAME `authorWesternPackEntryAsIdea` used
 *     in production.
 *   • No Claude prompt change, no migration, no public-API change.
 *   • No NG / IN / PH / non-Western touch — the activation guard
 *     mirrors the staging guard (region∈{undef,"western"} +
 *     languageStyle∈{undef,null,"clean"} + flag ON + pool non-empty).
 *   • The two flags are mutex at the activation site.
 */

import type { Region } from "@workspace/lumina-trends";
import type { LanguageStyle } from "./tasteCalibration.js";
import {
  APPROVED_WESTERN_PROMOTION_CANDIDATES,
} from "./westernHookPackApproved.js";
import { normalizeWesternHookSkeleton } from "./westernPackAuthor.js";
import {
  PENDING_EDITORIAL_REVIEW,
  type WesternComedyFamily,
  type WesternEmotionalSpike,
  type WesternHookPackDraftEntry,
  type WesternSetting,
  type WesternVoiceCluster,
  type WesternBatchHookStyle,
} from "./westernHookPack.js";
import { scorePool } from "./westernPromotionRubric.js";

/** Staging-only env flag for the W2-O live pool. Defaults OFF when
 *  unset. Production `start` script does NOT set this flag. */
export const WESTERN_LIVE_POOL_FEATURE_FLAG_ENV =
  "LUMINA_W2_WESTERN_LIVE_ENABLED";

/** System sign-off stamp applied to every live-pool entry derived by
 *  the W2-O rubric. A future human-reviewer-curated live pool would
 *  replace this stamp with a real `INITIALS_YYYY-MM-DD` string. */
export const WESTERN_LIVE_PROMOTION_SIGNOFF = "W2O_SYSTEM_RUBRIC_2026-05-08";

export const isWesternLivePoolFeatureEnabled = (): boolean =>
  process.env[WESTERN_LIVE_POOL_FEATURE_FLAG_ENV] === "true";

/** Live-pool entry shape. Identical to `WesternHookPackDraftEntry`
 *  except `reviewedBy` is pinned to the W2-O sign-off literal. */
export type WesternHookPackLiveEntry = Readonly<{
  id: string;
  hook: string;
  whatToShow: string;
  howToFilm: string;
  caption: string;
  anchor: string;
  comedyFamily: WesternComedyFamily;
  emotionalSpike: WesternEmotionalSpike;
  setting: WesternSetting;
  reviewedBy: typeof WESTERN_LIVE_PROMOTION_SIGNOFF;
  voiceCluster?: WesternVoiceCluster;
  hookStyle?: WesternBatchHookStyle;
  safetyNote?: string;
  originalBatchNumber?: number;
}>;

// ---------------------------------------------------------------- //
// Build the live pool from the rubric output                         //
// ---------------------------------------------------------------- //

const RUBRIC_OUTPUT_AT_LOAD = scorePool(APPROVED_WESTERN_PROMOTION_CANDIDATES);

const PROMOTE_IDS_AT_LOAD: ReadonlySet<string> = new Set(
  RUBRIC_OUTPUT_AT_LOAD.filter((r) => r.recommendation === "promote").map(
    (r) => r.entryId,
  ),
);

/**
 * The editor-signed live Western hook pack. Members are the staging
 * entries whose rubric recommendation is `"promote"`, with the
 * `reviewedBy` field overwritten by `WESTERN_LIVE_PROMOTION_SIGNOFF`.
 *
 * Size depends on the rubric outcome over the current 300-entry
 * staging pool. The QA driver `qa/w2oPromotionRubricQa.ts` writes a
 * full per-entry breakdown to `.local/W2O_RUBRIC_REPORT.md`.
 */
export const WESTERN_HOOK_PACK_LIVE: readonly WesternHookPackLiveEntry[] =
  Object.freeze(
    APPROVED_WESTERN_PROMOTION_CANDIDATES.filter((e) =>
      PROMOTE_IDS_AT_LOAD.has(e.id),
    ).map(
      (e): WesternHookPackLiveEntry =>
        Object.freeze({
          id: e.id,
          hook: e.hook,
          whatToShow: e.whatToShow,
          howToFilm: e.howToFilm,
          caption: e.caption,
          anchor: e.anchor,
          comedyFamily: e.comedyFamily,
          emotionalSpike: e.emotionalSpike,
          setting: e.setting,
          reviewedBy: WESTERN_LIVE_PROMOTION_SIGNOFF,
          ...(e.voiceCluster !== undefined ? { voiceCluster: e.voiceCluster } : {}),
          ...(e.hookStyle !== undefined ? { hookStyle: e.hookStyle } : {}),
          ...(e.safetyNote !== undefined ? { safetyNote: e.safetyNote } : {}),
          ...(e.originalBatchNumber !== undefined
            ? { originalBatchNumber: e.originalBatchNumber }
            : {}),
        }),
    ),
  );

/** Internal: structural cast for runtime consumers (author / slot
 *  reservation) that take `WesternHookPackDraftEntry`. The fields
 *  read by those modules (hook / whatToShow / anchor / comedyFamily
 *  / emotionalSpike / setting / etc.) are identical; only
 *  `reviewedBy` differs by literal type. The cast is safe because
 *  the runtime modules NEVER read `reviewedBy`. */
export const WESTERN_HOOK_PACK_LIVE_AS_DRAFT: readonly WesternHookPackDraftEntry[] =
  WESTERN_HOOK_PACK_LIVE as unknown as readonly WesternHookPackDraftEntry[];

// ---------------------------------------------------------------- //
// Activation guard (mirrors the staging-pool guard)                  //
// ---------------------------------------------------------------- //

export interface CanActivateWesternLivePoolInput {
  region: Region | undefined;
  languageStyle: LanguageStyle | null | undefined;
  flagEnabled: boolean;
  packLength: number;
}

/**
 * Four-AND activation guard — short-circuits to false unless ALL
 * conditions hold. Mirrors `canActivateWesternApprovedPool` so the
 * NG / IN / PH cohorts are excluded by BOTH region and
 * languageStyle, preventing any single-axis bug from leaking the
 * live pool into a non-Western cohort.
 */
export const canActivateWesternLivePool = (
  input: CanActivateWesternLivePoolInput,
): boolean => {
  if (!input.flagEnabled) return false;
  if (input.packLength <= 0) return false;
  if (input.region !== undefined && input.region !== "western") return false;
  const ls = input.languageStyle ?? null;
  if (ls !== null && ls !== "clean") return false;
  return true;
};

const EMPTY_LIVE_FROZEN: readonly WesternHookPackDraftEntry[] = Object.freeze(
  [],
);

/**
 * Returns the eligible live entries for the given activation
 * context. Returns an empty frozen array (not the pool) when the
 * four-AND guard fails. Returned shape is `WesternHookPackDraftEntry`
 * so the existing W2-K runtime path can consume the live pool
 * without branching.
 */
export const getEligibleWesternLiveEntries = (
  input: CanActivateWesternLivePoolInput,
): readonly WesternHookPackDraftEntry[] => {
  if (!canActivateWesternLivePool(input)) return EMPTY_LIVE_FROZEN;
  return WESTERN_HOOK_PACK_LIVE_AS_DRAFT;
};

// ---------------------------------------------------------------- //
// Integrity check (INVERTS the staging-pool stamp rule)              //
// ---------------------------------------------------------------- //

export interface WesternLivePoolIntegrityReport {
  readonly ok: boolean;
  readonly failures: readonly string[];
}

/**
 * Validate the live pool. Returns a structured report. Rejects
 * (unlike the staging pool):
 *   - any entry whose `reviewedBy` is `PENDING_EDITORIAL_REVIEW`
 *   - any entry whose `reviewedBy` is empty / missing
 *   - duplicate ids / hooks / hook-skeletons
 *   - entries that are not present in the staging pool (defensive —
 *     the live pool is derived from the staging pool, so a foreign
 *     id indicates accidental drift)
 */
export function checkWesternLivePoolIntegrity(): WesternLivePoolIntegrityReport {
  const failures: string[] = [];
  const stagingIds = new Set(
    APPROVED_WESTERN_PROMOTION_CANDIDATES.map((e) => e.id),
  );
  const seenIds = new Set<string>();
  const seenHooks = new Set<string>();
  const seenSkeletons = new Set<string>();

  for (const e of WESTERN_HOOK_PACK_LIVE) {
    const stamp: string = e.reviewedBy as string;
    if (typeof stamp !== "string" || stamp.trim().length === 0) {
      failures.push(`live_reviewedBy_missing:${e.id}`);
    } else if (stamp === PENDING_EDITORIAL_REVIEW) {
      failures.push(`live_reviewedBy_must_not_be_pending:${e.id}`);
    }
    if (seenIds.has(e.id)) {
      failures.push(`duplicate_live_id:${e.id}`);
    } else {
      seenIds.add(e.id);
    }
    const hk = e.hook.toLowerCase().trim();
    if (seenHooks.has(hk)) {
      failures.push(`duplicate_live_hook:${e.id}`);
    } else {
      seenHooks.add(hk);
    }
    const sk = normalizeWesternHookSkeleton(e.hook);
    if (sk.length > 0) {
      if (seenSkeletons.has(sk)) {
        failures.push(`duplicate_live_skeleton:${e.id}`);
      } else {
        seenSkeletons.add(sk);
      }
    }
    if (!stagingIds.has(e.id)) {
      failures.push(`live_id_not_in_staging:${e.id}`);
    }
  }

  return { ok: failures.length === 0, failures };
}
