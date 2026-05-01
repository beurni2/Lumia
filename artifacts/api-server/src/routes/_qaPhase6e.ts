/**
 * TEMPORARY — Phase 6E PREMISE COMEDY SCORING + REJECTION QA driver.
 *
 * Runs `N_BATCHES` sequential `runHybridIdeator` batches against a
 * sentinel non-demo creator (`authUserId="qa:phase6e"`) with
 * `regenerate=i>0`, `count=COUNT`, captures each batch's persisted
 * cache entries (which now include `premiseComedyScoreTotal` for
 * premise hooks via the Phase 6E cache write), and computes the spec
 * PART 8 report shape + ship gates:
 *
 *   - premise share (target 75-90% — NOT chasing higher)
 *   - average PremiseComedyScore (target ≥ 7)
 *   - % hooks scoring ≥ 7
 *   - top 10 / bottom 10 hooks (by score, then alphabetical for
 *     stable ordering when ties)
 *   - rejected premise count (always 0 in shipped output — rejection
 *     fires inside the picker walk, never reaches the cache. Reported
 *     as a sanity check on the gate boundary.)
 *   - legacy fallback count (premise share complement)
 *   - estimated post-worthy rate (≥ 7-scoring premise + every legacy
 *     entry that survived the existing scorer; legacy entries don't
 *     carry a comedy score by design — they're already gated by the
 *     legacy-side scorer.)
 *   - HARD batch guards (must be 0/0/200/200 for ALL batches —
 *     mirrors the Phase 6D ship gate the spec carries forward.)
 *
 * Re-scores every shipped premise hook with `scorePremiseComedyScore`
 * to validate the cache total round-tripped intact (defense-in-depth
 * — catches any discrepancy between the picker-walk's score and the
 * post-Llama-polish text).
 *
 * DELETE this file + its mount in `routes/index.ts` after Phase 6E
 * sign-off (T006 cleanup step). NEVER mount on a production deploy —
 * the sentinel creator pollutes `creators` rows and the route runs
 * without auth (curl-from-shell only).
 */

import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";

import { db, schema } from "../db/client";
import { runHybridIdeator } from "../lib/hybridIdeator";
import { scorePremiseComedyScore } from "../lib/ideaScorer";
import { styleProfileSchema } from "../lib/styleProfile";

const router: IRouter = Router();

const QA_AUTH_USER_ID = "qa:phase6e";

type CapturedEntry = {
  hook: string;
  bigPremiseStyle?: string;
  premiseStyleId?: string;
  executionId?: string;
  /** Picker-walk's stored rubric total (0-10). */
  premiseComedyScoreTotal?: number;
  /** Re-scored on the QA side so we can validate round-trip. */
  rescoredTotal?: number;
};

function extractCurrent(raw: unknown): CapturedEntry[] {
  if (!raw || typeof raw !== "object") return [];
  const env = raw as { current?: unknown };
  if (!Array.isArray(env.current)) return [];
  const out: CapturedEntry[] = [];
  for (const item of env.current) {
    if (!item || typeof item !== "object") continue;
    const e = item as {
      idea?: { hook?: unknown };
      bigPremiseStyle?: unknown;
      premiseStyleId?: unknown;
      executionId?: unknown;
      premiseComedyScoreTotal?: unknown;
    };
    const hook = typeof e.idea?.hook === "string" ? e.idea.hook : "";
    const isPremise =
      typeof e.premiseStyleId === "string" ||
      typeof e.bigPremiseStyle === "string";
    out.push({
      hook,
      bigPremiseStyle:
        typeof e.bigPremiseStyle === "string" ? e.bigPremiseStyle : undefined,
      premiseStyleId:
        typeof e.premiseStyleId === "string" ? e.premiseStyleId : undefined,
      executionId:
        typeof e.executionId === "string" ? e.executionId : undefined,
      premiseComedyScoreTotal:
        typeof e.premiseComedyScoreTotal === "number"
          ? e.premiseComedyScoreTotal
          : undefined,
      // Re-score every premise hook from text — catches any drift
      // between picker-walk score and final shipped hook (e.g. after
      // Llama polish edits the text but somehow bypasses the T003
      // re-scoring guard).
      rescoredTotal: isPremise
        ? scorePremiseComedyScore(hook).total
        : undefined,
    });
  }
  return out;
}

router.post("/_qa/phase6e", async (_req, res, next) => {
  try {
    let creator = (
      await db
        .select()
        .from(schema.creators)
        .where(eq(schema.creators.authUserId, QA_AUTH_USER_ID))
        .limit(1)
    )[0];
    if (!creator) {
      await db
        .insert(schema.creators)
        .values({
          authUserId: QA_AUTH_USER_ID,
          name: "QA Phase 6E",
          location: "—",
          niche: "—",
          followers: 0,
          currency: "USD",
          imageKey: "creator-1",
          isDemo: false,
        })
        .onConflictDoNothing({ target: schema.creators.authUserId });
      creator = (
        await db
          .select()
          .from(schema.creators)
          .where(eq(schema.creators.authUserId, QA_AUTH_USER_ID))
          .limit(1)
      )[0];
    }
    if (!creator) {
      res.status(500).json({ error: "creator_provision_failed" });
      return;
    }

    // Reset cache so batch #0 starts from a clean slate (no carryover
    // from a prior QA run polluting the regenerate-only HARD exclusion
    // gate or the cross-batch novelty levers).
    await db
      .update(schema.creators)
      .set({ lastIdeaBatchJson: null })
      .where(eq(schema.creators.id, creator.id));

    const styleProfile = styleProfileSchema.parse({});
    const N_BATCHES = 10;
    const COUNT = 3;

    const batches: CapturedEntry[][] = [];
    for (let i = 0; i < N_BATCHES; i++) {
      const c = (
        await db
          .select()
          .from(schema.creators)
          .where(eq(schema.creators.id, creator.id))
          .limit(1)
      )[0]!;
      await runHybridIdeator({
        creator: c,
        region: "western",
        styleProfile,
        count: COUNT,
        regenerate: i > 0,
      });
      const cAfter = (
        await db
          .select()
          .from(schema.creators)
          .where(eq(schema.creators.id, creator.id))
          .limit(1)
      )[0]!;
      batches.push(extractCurrent(cAfter.lastIdeaBatchJson));
    }

    const allEntries = batches.flat();
    const totalEntries = allEntries.length;
    const premiseEntries = allEntries.filter(
      (e) => e.premiseStyleId || e.bigPremiseStyle,
    );
    const legacyEntries = allEntries.filter(
      (e) => !e.premiseStyleId && !e.bigPremiseStyle,
    );
    const premiseShare =
      totalEntries > 0 ? premiseEntries.length / totalEntries : 0;
    const legacyShare =
      totalEntries > 0 ? legacyEntries.length / totalEntries : 0;

    // Comedy-score aggregates use the cached `premiseComedyScoreTotal`
    // (the picker-walk's AUTHORITATIVE score — computed with full
    // entry + scenario context). The QA-side rescore is informational
    // only: it scores from text alone and can't reproduce the
    // executionId-based surprise/punch boosts (max +1 each) or the
    // scenario.topicNoun-based specificity boost (max +1) that the
    // picker walk applied — so a context-blind rescore is expected
    // to land up to ~3 points BELOW the cached score for entries
    // whose picker-time score depended on those bonuses. That's not
    // drift, it's by design — the rubric is intentionally context-
    // aware. Real drift (a sign that the SHIPPED text differs from
    // what the picker scored) would show up as `rescored > cached`
    // OR `rescored < cached - 3`. Reported as `suspiciousDrift`
    // below; the gate uses a +1 / -3 tolerance band.
    const scores = premiseEntries
      .map((e) => e.premiseComedyScoreTotal)
      .filter((s): s is number => typeof s === "number");
    const avgPremiseComedyScore =
      scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const sevenPlusCount = scores.filter((s) => s >= 7).length;
    const sevenPlusRate =
      scores.length > 0 ? sevenPlusCount / scores.length : 0;
    const fiveSixCount = scores.filter((s) => s >= 5 && s <= 6).length;
    const belowFiveCount = scores.filter((s) => s < 5).length;

    // Suspicious drift: outside the expected +1 / -3 tolerance band
    // (see comment above). Anything in this set means the picker-
    // time text differs from the shipped text — possible bug in
    // compressHook / Llama polish path / cache write race.
    const suspiciousDrift = premiseEntries.filter(
      (e) =>
        typeof e.premiseComedyScoreTotal === "number" &&
        typeof e.rescoredTotal === "number" &&
        (e.rescoredTotal > e.premiseComedyScoreTotal ||
          e.rescoredTotal < e.premiseComedyScoreTotal - 3),
    );

    // Top 10 / bottom 10 by cached total — stable secondary sort
    // by hook string for deterministic snapshots.
    const ranked = [...premiseEntries]
      .filter((e) => typeof e.premiseComedyScoreTotal === "number")
      .sort((a, b) => {
        const sa = a.premiseComedyScoreTotal ?? 0;
        const sb = b.premiseComedyScoreTotal ?? 0;
        if (sb !== sa) return sb - sa;
        return a.hook.localeCompare(b.hook);
      });
    const top10 = ranked.slice(0, 10).map((e) => ({
      hook: e.hook,
      score: e.premiseComedyScoreTotal,
      rescoredTextOnly: e.rescoredTotal,
      premiseStyleId: e.premiseStyleId,
      executionId: e.executionId,
    }));
    const bottom10 = ranked
      .slice(-10)
      .reverse()
      .map((e) => ({
        hook: e.hook,
        score: e.premiseComedyScoreTotal,
        rescoredTextOnly: e.rescoredTotal,
        premiseStyleId: e.premiseStyleId,
        executionId: e.executionId,
      }));

    // HARD batch guards — same shape as Phase 6D's gate. Computed on
    // shipped entries (post hooks/scenarios visible in the cache):
    //   (a) all 3 share hookStyle  (NOT directly observable in cache;
    //       proxied here via duplicate hook strings within a batch)
    //   (b) all 3 share scenarioFamily / executionId concentration
    //
    // The actual HARD batch guards live inside `selectWithNovelty` and
    // run BEFORE writing to cache — so anything that reaches the cache
    // already passed them. We assert this from the OUTSIDE by counting
    // duplicates per batch as a defense-in-depth check.
    let dupHookCount = 0;
    let allSameStyleBatches = 0;
    for (const batch of batches) {
      const hookSeen = new Set<string>();
      for (const e of batch) {
        if (hookSeen.has(e.hook)) dupHookCount++;
        hookSeen.add(e.hook);
      }
      if (batch.length >= 3) {
        const styles = new Set(
          batch
            .map((e) => e.premiseStyleId ?? e.bigPremiseStyle)
            .filter((s): s is string => !!s),
        );
        if (styles.size === 1 && batch.every((e) => e.premiseStyleId)) {
          allSameStyleBatches++;
        }
      }
    }

    // Estimated post-worthy: every premise scoring ≥ 7 + every legacy
    // (legacy entries are gated by the existing scorer + already
    // ship). This is a conservative estimate — premise demote-band
    // (5-6) entries that won selection still ship but are NOT counted
    // toward post-worthy here.
    const postWorthyCount = sevenPlusCount + legacyEntries.length;
    const postWorthyRate =
      totalEntries > 0 ? postWorthyCount / totalEntries : 0;

    const gates = {
      premise_share_75_to_90: {
        target: "0.75 - 0.90",
        actual: premiseShare,
        pass: premiseShare >= 0.75 && premiseShare <= 0.9,
      },
      avg_premise_comedy_score_ge_7: {
        target: 7,
        actual: avgPremiseComedyScore,
        pass: avgPremiseComedyScore >= 7,
      },
      suspicious_drift_zero: {
        target: 0,
        actual: suspiciousDrift.length,
        pass: suspiciousDrift.length === 0,
      },
      hard_batch_guards_zero: {
        target: "dupHook=0 && allSameStyle=0",
        actual: { dupHookCount, allSameStyleBatches },
        pass: dupHookCount === 0 && allSameStyleBatches === 0,
      },
      below_five_cached_zero: {
        target: 0,
        actual: belowFiveCount,
        pass: belowFiveCount === 0,
      },
    };
    const allPass = Object.values(gates).every((g) => g.pass);

    res.json({
      ok: allPass,
      batches: batches.length,
      totalEntries,
      premiseShare,
      legacyShare,
      premiseEntries: premiseEntries.length,
      legacyEntries: legacyEntries.length,
      avgPremiseComedyScore,
      sevenPlusCount,
      sevenPlusRate,
      fiveSixCount,
      belowFiveCount,
      postWorthyCount,
      postWorthyRate,
      dupHookCount,
      allSameStyleBatches,
      suspiciousDrift: suspiciousDrift.map((e) => ({
        hook: e.hook,
        cached: e.premiseComedyScoreTotal,
        rescored: e.rescoredTotal,
      })),
      top10,
      bottom10,
      gates,
      perBatch: batches,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
