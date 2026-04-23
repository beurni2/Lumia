import { Router, type IRouter } from "express";
import { resolveCreator } from "../lib/resolveCreator";

const router: IRouter = Router();

/**
 * GET /api/creator/me
 *
 * Returns the resolved creator profile (see lib/resolveCreator for the
 * resolution contract). Until Clerk is wired the contract permits a
 * demo-creator fallback ONLY when no auth header is present.
 */
router.get("/creator/me", async (req, res, next) => {
  try {
    const r = await resolveCreator(req);
    if (r.kind !== "found") {
      res.status(401).json({ error: "unknown_user" });
      return;
    }
    res.json({
      id: r.creator.id,
      name: r.creator.name,
      location: r.creator.location,
      niche: r.creator.niche,
      followers: r.creator.followers,
      currency: r.creator.currency,
      imageKey: r.creator.imageKey,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
