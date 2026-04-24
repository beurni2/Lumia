/**
 * AI spend ledger + per-creator daily $ cap.
 *
 * Why this exists: the existing run-count quota (LUMINA_MAX_SWARM_RUNS_PER_DAY)
 * caps how MANY swarms a creator can launch but says nothing about how
 * EXPENSIVE each call is. A creator on a verbose niche or an agent
 * regression that bloats prompts could blow through real money even
 * inside the run-count cap. This module gives us cost visibility (per
 * call → per agent → per creator → per day) and a hard $ cap that
 * trips before the bill hits the credit card.
 *
 * Storage:
 *   - Each AI call records one row in `ai_usage` with input/output
 *     token counts and cost in MICRO-DOLLARS (integer bigint).
 *   - We store integer micro-dollars rather than float USD so summing
 *     thousands of rows never loses a fraction of a cent.
 *
 * Cap enforcement:
 *   - Checked BEFORE each call so a creator who is at $X.99 of their
 *     $X cap can't fire one more 200K-token request that swings them
 *     well over.
 *   - Cap is per-creator-per-UTC-day. Same UTC day boundary as the
 *     run-count quota so behavior is consistent.
 *   - Calls without a creator id (admin tooling, system tasks) are
 *     never blocked — the cap is a creator-scoped abuse guard.
 */

import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { logger } from "./logger";

export type ModelRate = {
  /** USD per 1,000,000 input tokens. */
  inPerMTok: number;
  /** USD per 1,000,000 output tokens. */
  outPerMTok: number;
};

// Published Anthropic rates (per their pricing page). These are the
// fall-back values; ops can override per-model via env without a
// deploy:
//   LUMINA_MODEL_RATES='{"claude-haiku-4-5":{"inPerMTok":1,"outPerMTok":5}}'
// An unrecognized model bills at the conservative `defaultRate`
// rather than $0 so a typo can never silently zero out cost tracking.
const builtinRates: Record<string, ModelRate> = {
  "claude-haiku-4-5": { inPerMTok: 1.0, outPerMTok: 5.0 },
};

const defaultRate: ModelRate = { inPerMTok: 3.0, outPerMTok: 15.0 };

// Strict shape for env-overridden rates. Both fields must be finite
// non-negative numbers; anything else (negative, string, NaN) gets
// rejected so a typo can't silently zero out cost tracking.
const RateOverrideSchema = z.record(
  z.string().min(1),
  z.object({
    inPerMTok: z.number().finite().nonnegative(),
    outPerMTok: z.number().finite().nonnegative(),
  }),
);

let cachedRates: Record<string, ModelRate> | null = null;

function rates(): Record<string, ModelRate> {
  if (cachedRates) return cachedRates;
  const raw = process.env["LUMINA_MODEL_RATES"];
  if (!raw) {
    cachedRates = builtinRates;
    return cachedRates;
  }
  try {
    const parsed = JSON.parse(raw);
    const validated = RateOverrideSchema.parse(parsed);
    cachedRates = { ...builtinRates, ...validated };
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[aiCost] LUMINA_MODEL_RATES invalid (must be JSON object of " +
        "{model: {inPerMTok, outPerMTok}} with non-negative numbers) — " +
        "falling back to built-in rates",
    );
    cachedRates = builtinRates;
  }
  return cachedRates;
}

export function rateFor(model: string): ModelRate {
  return rates()[model] ?? defaultRate;
}

/**
 * USD micro-dollars (integer) for a (model, input, output) tuple.
 *
 * We use Math.ceil — never Math.floor — so the ledger always rounds
 * UP to the next micro-dollar. With Math.floor a small call (one
 * input token at $1/MTok = 0.001 micro) would round to zero, so a
 * creator could chip away at a cap with thousands of tiny calls and
 * be billed nothing. Ceiling guarantees the recorded total is >= the
 * real cost, which is the safe direction for a cost cap.
 */
export function costMicroFor(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const r = rateFor(model);
  const usd =
    (inputTokens / 1_000_000) * r.inPerMTok +
    (outputTokens / 1_000_000) * r.outPerMTok;
  return Math.max(0, Math.ceil(usd * 1_000_000));
}

export type RecordUsageInput = {
  creatorId?: string | null;
  agentRunId?: string | null;
  agent?: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

/**
 * Best-effort insert with one transient retry. Errors are logged at
 * error level but never thrown — losing a cost ledger row is
 * strictly better than failing a creator's swarm because the ledger
 * table was unreachable.
 *
 * The single retry-with-backoff handles transient lock contention
 * (the most common failure mode under load). A persistent failure
 * still loses the row but at least surfaces in logs as an explicit
 * "exhausted retries" event so ops can investigate.
 */
export async function recordUsage(input: RecordUsageInput): Promise<void> {
  const cost = costMicroFor(
    input.model,
    input.inputTokens,
    input.outputTokens,
  );
  const insert = () =>
    db.execute(sql`
      INSERT INTO ai_usage
        (creator_id, agent_run_id, agent, model,
         input_tokens, output_tokens, cost_usd_micro)
      VALUES
        (${input.creatorId ?? null}, ${input.agentRunId ?? null},
         ${input.agent ?? null}, ${input.model},
         ${input.inputTokens}, ${input.outputTokens}, ${cost})
    `);

  try {
    await insert();
    return;
  } catch (firstErr) {
    // Tiny backoff to dodge brief lock contention.
    await new Promise((r) => setTimeout(r, 50));
    try {
      await insert();
      return;
    } catch (secondErr) {
      logger.error(
        {
          firstErr:
            firstErr instanceof Error ? firstErr.message : String(firstErr),
          secondErr:
            secondErr instanceof Error
              ? secondErr.message
              : String(secondErr),
          creatorId: input.creatorId,
          model: input.model,
          costMicro: cost,
        },
        "[aiCost] failed to record usage after retry — spend is real but unrecorded",
      );
    }
  }
}

/** Today's spend (UTC) for a creator, in micro-dollars. */
export async function getDailySpendMicro(
  creatorId: string,
): Promise<number> {
  // Range-scan form: bind the day-start once and use a plain `>=`
  // comparison so Postgres can drive the lookup directly off the
  // (creator_id, created_at DESC) index. Wrapping created_at in
  // date_trunc() inside the WHERE clause prevents that index from
  // being used as efficiently.
  const r = await db.execute(sql`
    WITH window_start AS (
      SELECT (date_trunc('day', now() AT TIME ZONE 'UTC')
              AT TIME ZONE 'UTC') AS ts
    )
    SELECT COALESCE(SUM(cost_usd_micro), 0)::bigint AS micro
      FROM ai_usage, window_start
     WHERE creator_id = ${creatorId}
       AND created_at >= window_start.ts
  `);
  const rows =
    (r as unknown as { rows: { micro: string | number }[] }).rows ?? [];
  return Number(rows[0]?.micro ?? 0);
}

function dailyCapMicro(): number {
  const raw = process.env["LUMINA_DAILY_USD_CAP"];
  // Default $5 / creator / day. At Haiku rates that's many thousands
  // of swarm steps — fine for normal use, immediate brake for abuse.
  const usd = raw ? Number(raw) : 5;
  if (!Number.isFinite(usd) || usd <= 0) return 5_000_000;
  return Math.floor(usd * 1_000_000);
}

/**
 * Returns `{ ok: true }` if the creator has budget remaining, or
 * `{ ok: false, ... }` with diagnostic numbers if they don't. A
 * missing creatorId always returns ok — system/admin calls are not
 * subject to the per-creator cap.
 *
 * KNOWN LIMITATION — check-then-act race: two concurrent calls from
 * the same creator that both pass this check can both proceed and
 * push the creator over the cap by one in-flight burst. We accept
 * this trade-off because (a) the cap is an abuse guard, not an
 * accounting hard line, (b) the typical creator has at most a single
 * sequential swarm in flight, and (c) the alternative — a real
 * reservation/credit system — adds enough complexity that a strict
 * pre-paid model would deserve a separate design.
 */
export async function checkDailyCap(
  creatorId?: string | null,
): Promise<
  | { ok: true }
  | { ok: false; spentMicro: number; capMicro: number }
> {
  if (!creatorId) return { ok: true };
  const cap = dailyCapMicro();
  const spent = await getDailySpendMicro(creatorId);
  if (spent >= cap) return { ok: false, spentMicro: spent, capMicro: cap };
  return { ok: true };
}

export class DailyCapExceededError extends Error {
  spentMicro: number;
  capMicro: number;
  constructor(spentMicro: number, capMicro: number) {
    super(
      `Daily AI spend cap exceeded: $${(spentMicro / 1_000_000).toFixed(4)} ` +
        `of $${(capMicro / 1_000_000).toFixed(2)} cap`,
    );
    this.name = "DailyCapExceededError";
    this.spentMicro = spentMicro;
    this.capMicro = capMicro;
  }
}

export const __test = { rates, defaultRate, dailyCapMicro };
