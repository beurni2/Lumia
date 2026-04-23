import { Router, type IRouter } from "express";
import { asc, eq, sum } from "drizzle-orm";
import { db, schema } from "../db/client";
import { resolveCreator } from "../lib/resolveCreator";

const router: IRouter = Router();

/**
 * GET /api/earnings/summary
 *
 * Aggregates the resolved creator's ledger into a sparkline + growth %
 * and returns their current brand-deal pipeline.
 */
router.get("/earnings/summary", async (req, res, next) => {
  try {
    const r = await resolveCreator(req);
    if (r.kind !== "found") {
      res.status(401).json({ error: "unknown_user" });
      return;
    }
    const creator = r.creator;

    const monthly = await db
      .select({
        month: schema.ledgerEntries.monthBucket,
        total: sum(schema.ledgerEntries.amount).as("total"),
      })
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.creatorId, creator.id))
      .groupBy(schema.ledgerEntries.monthBucket)
      .orderBy(asc(schema.ledgerEntries.monthBucket));

    const history = monthly.map((m) => Number(m.total));
    const currentMonth = history[history.length - 1] ?? 0;
    const previousMonth = history[history.length - 2] ?? 0;
    const growth =
      previousMonth > 0
        ? `${currentMonth >= previousMonth ? "+" : ""}${Math.round(
            ((currentMonth - previousMonth) / previousMonth) * 100,
          )}%`
        : "—";

    const deals = await db
      .select()
      .from(schema.brandDeals)
      .where(eq(schema.brandDeals.creatorId, creator.id));

    res.json({
      currentMonth,
      currency: creator.currency,
      growth,
      deals: deals.map((d) => ({
        id: d.id,
        brand: d.brand,
        status: d.status,
        amount: d.amount,
      })),
      history,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
