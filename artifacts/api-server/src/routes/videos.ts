import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import { resolveCreator } from "../lib/resolveCreator";

const router: IRouter = Router();

/**
 * GET /api/videos
 *
 * Returns the resolved creator's video catalog.
 */
router.get("/videos", async (req, res, next) => {
  try {
    const r = await resolveCreator(req);
    if (r.kind !== "found") {
      res.status(401).json({ error: "unknown_user" });
      return;
    }
    const rows = await db
      .select()
      .from(schema.videos)
      .where(eq(schema.videos.creatorId, r.creator.id));

    res.json({
      videos: rows.map((v) => ({
        id: v.id,
        title: v.title,
        status: v.status,
        viralScore: v.viralScore,
        reasoning: v.reasoning,
        thumbnailKey: v.thumbnailKey,
        script: v.script,
        agents: v.agents,
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
