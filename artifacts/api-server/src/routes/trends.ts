import { Router, type IRouter } from "express";
import { db, schema } from "../db/client";
import { desc, isNull } from "drizzle-orm";

const router: IRouter = Router();

/**
 * GET /api/trends
 *
 * Returns the global trend brief feed (creator_id IS NULL). Per-creator
 * briefs queued by the swarm will be merged in once auth is wired.
 */
router.get("/trends", async (_req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(schema.trendBriefs)
      .where(isNull(schema.trendBriefs.creatorId))
      .orderBy(desc(schema.trendBriefs.viralPotential));

    res.json({
      briefs: rows.map((r) => ({
        id: r.id,
        title: r.title,
        context: r.context,
        viralPotential: r.viralPotential,
        description: r.description,
        imageKey: r.imageKey,
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
