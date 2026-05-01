/**
 * TEMPORARY — Phase 6D PREMISE EXECUTION EXPANSION QA driver.
 *
 * Runs 10 sequential `runHybridIdeator` batches against a sentinel
 * non-demo creator (`authUserId="qa:phase6d"`) with `regenerate=i>0`,
 * `count=3`, captures each batch's persisted cache entries, and
 * computes the spec PART 8 report shape + gates.
 *
 * DELETE this file + its mount in `routes/index.ts` after Phase 6D
 * sign-off (T005 cleanup step).
 */

import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import {
  runHybridIdeator,
  __phase6dDebugSink,
  __phase6dResetSink,
  type Phase6dSelectionDebug,
} from "../lib/hybridIdeator";
import {
  PREMISE_STYLE_DEFS,
  validateHook,
  validateBigPremise,
  validateOutputLine,
} from "../lib/patternIdeator";
import { styleProfileSchema } from "../lib/styleProfile";

const router: IRouter = Router();

const QA_AUTH_USER_ID = "qa:phase6d";

type CapturedEntry = {
  hook: string;
  bigPremiseStyle?: string;
  premiseStyleId?: string;
  executionId?: string;
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
    };
    out.push({
      hook: typeof e.idea?.hook === "string" ? e.idea.hook : "",
      bigPremiseStyle:
        typeof e.bigPremiseStyle === "string" ? e.bigPremiseStyle : undefined,
      premiseStyleId:
        typeof e.premiseStyleId === "string" ? e.premiseStyleId : undefined,
      executionId:
        typeof e.executionId === "string" ? e.executionId : undefined,
    });
  }
  return out;
}

router.post("/_qa/phase6d", async (_req, res, next) => {
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
          name: "QA Phase 6D",
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

    await db
      .update(schema.creators)
      .set({ lastIdeaBatchJson: null })
      .where(eq(schema.creators.id, creator.id));

    const styleProfile = styleProfileSchema.parse({});
    const N_BATCHES = 10;
    const COUNT = 3;

    const batches: CapturedEntry[][] = [];
    // PHASE 6D DIAGNOSTIC — enable debug sink for this run so the
    // selectWithNovelty capture site emits per-call breakdowns. Reset
    // before each batch so we can attribute records to the batch
    // they fired in. Restored to prior value at end via try/finally
    // so a runtime error doesn't leak the env var to other requests.
    const prevDebugEnv = process.env.PHASE6D_DEBUG;
    process.env.PHASE6D_DEBUG = "1";
    const debugByBatch: Phase6dSelectionDebug[][] = [];
    try {
      for (let i = 0; i < N_BATCHES; i++) {
        const c = (
          await db
            .select()
            .from(schema.creators)
            .where(eq(schema.creators.id, creator.id))
            .limit(1)
        )[0]!;
        __phase6dResetSink();
        await runHybridIdeator({
          creator: c,
          region: "western",
          styleProfile,
          count: COUNT,
          regenerate: i > 0,
        });
        debugByBatch.push([...__phase6dDebugSink]);
        const cAfter = (
          await db
            .select()
            .from(schema.creators)
            .where(eq(schema.creators.id, creator.id))
            .limit(1)
        )[0]!;
        batches.push(extractCurrent(cAfter.lastIdeaBatchJson));
      }
    } finally {
      if (prevDebugEnv === undefined) delete process.env.PHASE6D_DEBUG;
      else process.env.PHASE6D_DEBUG = prevDebugEnv;
      __phase6dResetSink();
    }

    const catalogFailures: {
      styleId: string;
      execId: string;
      hook: string;
      failed: string[];
    }[] = [];
    let catalogTotal = 0;
    const allExecIds = new Set<string>();
    for (const [styleId, def] of Object.entries(PREMISE_STYLE_DEFS)) {
      for (const exec of def.executions) {
        catalogTotal++;
        allExecIds.add(exec.id);
        const failed: string[] = [];
        if (!validateHook(exec.example)) failed.push("validateHook");
        if (!validateBigPremise(exec.example))
          failed.push("validateBigPremise");
        if (!validateOutputLine(exec.example))
          failed.push("validateOutputLine");
        if (failed.length > 0) {
          catalogFailures.push({
            styleId,
            execId: exec.id,
            hook: exec.example,
            failed,
          });
        }
      }
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

    const wordCounts = allEntries.map(
      (e) => e.hook.trim().split(/\s+/).filter(Boolean).length,
    );
    const avgWordCount =
      wordCounts.length > 0
        ? wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length
        : 0;

    const execShipped: Record<string, number> = {};
    for (const id of allExecIds) execShipped[id] = 0;
    for (const e of allEntries) {
      if (e.executionId) {
        execShipped[e.executionId] = (execShipped[e.executionId] ?? 0) + 1;
      }
    }
    const execNeverFired = Object.entries(execShipped)
      .filter(([, n]) => n === 0)
      .map(([id]) => id);

    let tupleDups = 0;
    let styleDups = 0;
    for (const batch of batches) {
      const tupleSeen = new Set<string>();
      const styleSeen = new Set<string>();
      for (const e of batch) {
        if (e.premiseStyleId && e.executionId) {
          const k = `${e.premiseStyleId}::${e.executionId}`;
          if (tupleSeen.has(k)) tupleDups++;
          tupleSeen.add(k);
        }
        if (e.premiseStyleId) {
          if (styleSeen.has(e.premiseStyleId)) styleDups++;
          styleSeen.add(e.premiseStyleId);
        }
      }
    }

    const hooksByStyle: Record<string, string[]> = {};
    for (const e of allEntries) {
      if (e.premiseStyleId) {
        if (!hooksByStyle[e.premiseStyleId]) hooksByStyle[e.premiseStyleId] = [];
        hooksByStyle[e.premiseStyleId].push(e.hook);
      }
    }

    const gates = {
      premise_share_min_85: {
        target: 0.85,
        actual: premiseShare,
        pass: premiseShare >= 0.85,
      },
      tuple_dups_zero: {
        target: 0,
        actual: tupleDups,
        pass: tupleDups === 0,
      },
      style_dups_zero: {
        target: 0,
        actual: styleDups,
        pass: styleDups === 0,
      },
      avg_words_in_6_to_10: {
        target: "6-10",
        actual: avgWordCount,
        pass: avgWordCount >= 6 && avgWordCount <= 10,
      },
      catalog_pass_rate_100: {
        target: catalogTotal,
        actual: catalogTotal - catalogFailures.length,
        pass: catalogFailures.length === 0,
      },
    };
    const allPass = Object.values(gates).every((g) => g.pass);

    res.json({
      ok: allPass,
      batches: batches.length,
      totalEntries,
      premiseShare,
      legacyShare,
      avgWordCount,
      tupleDups,
      styleDups,
      catalogTotal,
      catalogFailures,
      execShipped,
      execNeverFired,
      hooksByStyle,
      gates,
      perBatch: batches,
      debugByBatch,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
