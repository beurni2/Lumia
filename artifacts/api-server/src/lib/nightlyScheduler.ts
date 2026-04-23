/**
 * Nightly swarm scheduler — process-singleton.
 *
 * Every TICK_INTERVAL_MS the scheduler scans for opted-in creators
 * whose local hour (per their `nightlySwarmTz`) currently equals
 * their preferred `nightlySwarmHour`, AND whose `lastNightlyRunAt`
 * is older than RUN_DEDUPE_HOURS.
 *
 * For each match we *first* stamp `lastNightlyRunAt = now()` (so a
 * second tick that lands in the same hour is dedupped even if the
 * first run is still in flight) and then kick `executeSwarmRun`
 * via setImmediate so the tick loop never blocks.
 *
 * The scheduler is idempotent and safe to start multiple times in a
 * single process — only the first call installs the interval.
 *
 * Compliance: a creator with `nightlySwarmEnabled = true` necessarily
 * has `aiDisclosureConsentedAt` set (the POST /me/schedule route
 * refuses to enable without consent). We re-check inside the tick
 * loop in case consent was withdrawn after enabling.
 */

import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { logger } from "./logger";
import { executeSwarmRun, startSwarmRun } from "../agents/swarm";

const TICK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const RUN_DEDUPE_HOURS = 20;

let timer: ReturnType<typeof setInterval> | null = null;

function localHourFor(tz: string, now: Date): number | null {
  try {
    // Intl.DateTimeFormat with hourCycle h23 returns 0-23.
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const h = parts.find((p) => p.type === "hour")?.value;
    if (h == null) return null;
    const n = Number(h);
    return Number.isInteger(n) && n >= 0 && n <= 23 ? n : null;
  } catch {
    return null;
  }
}

async function tick(): Promise<void> {
  const now = new Date();
  const dedupeFloor = new Date(
    now.getTime() - RUN_DEDUPE_HOURS * 60 * 60 * 1000,
  );
  let candidates;
  try {
    candidates = await db
      .select()
      .from(schema.creators)
      .where(
        and(
          eq(schema.creators.nightlySwarmEnabled, true),
          isNotNull(schema.creators.nightlySwarmHour),
          isNotNull(schema.creators.nightlySwarmTz),
          isNotNull(schema.creators.aiDisclosureConsentedAt),
          isNotNull(schema.creators.adultConfirmedAt),
        ),
      );
  } catch (err) {
    logger.error({ err }, "[nightlyScheduler] candidate scan failed");
    return;
  }

  for (const c of candidates) {
    const tz = c.nightlySwarmTz ?? "UTC";
    const wantedHour = c.nightlySwarmHour;
    if (wantedHour == null) continue;
    const localHour = localHourFor(tz, now);
    if (localHour !== wantedHour) continue;
    if (c.lastNightlyRunAt && c.lastNightlyRunAt > dedupeFloor) continue;

    // Atomic claim: only proceed if we win the conditional UPDATE.
    // The dedupe predicate is re-checked inside the WHERE so two
    // ticks racing for the same creator can never both win — the
    // first UPDATE flips lastNightlyRunAt past the floor and the
    // second's predicate fails.
    const claimed = await db
      .update(schema.creators)
      .set({ lastNightlyRunAt: now })
      .where(
        and(
          eq(schema.creators.id, c.id),
          eq(schema.creators.nightlySwarmEnabled, true),
          or(
            isNull(schema.creators.lastNightlyRunAt),
            sql`${schema.creators.lastNightlyRunAt} < ${dedupeFloor}`,
          ),
        ),
      )
      .returning({ id: schema.creators.id });
    if (claimed.length === 0) continue;

    try {
      const { runId } = await startSwarmRun(c.id);
      logger.info({ creatorId: c.id, runId }, "[nightlyScheduler] kicked");
      setImmediate(() => {
        executeSwarmRun(runId, c.id).catch((err) => {
          logger.error(
            { err, creatorId: c.id, runId },
            "[nightlyScheduler] run failed",
          );
        });
      });
    } catch (err) {
      logger.error({ err, creatorId: c.id }, "[nightlyScheduler] start failed");
    }
  }
}

export function startNightlyScheduler(): void {
  if (timer) return;
  // Fire-and-forget the first tick on next event-loop turn so any
  // listen() callbacks complete first.
  setImmediate(() => {
    void tick();
  });
  timer = setInterval(() => {
    void tick();
  }, TICK_INTERVAL_MS);
  logger.info(
    { intervalMs: TICK_INTERVAL_MS, dedupeHours: RUN_DEDUPE_HOURS },
    "[nightlyScheduler] started",
  );
}

export function stopNightlyScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

// Exposed for tests.
export const __test = { tick, localHourFor };
