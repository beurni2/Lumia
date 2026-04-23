import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client";
import { resolveCreator } from "../lib/resolveCreator";

const router: IRouter = Router();

const PLATFORMS = ["tiktok", "reels", "shorts"] as const;
const STATUSES = ["queued", "published", "failed", "blocked"] as const;
const SHIELD_VERDICTS = ["pass", "rewritten", "blocked"] as const;

const CreatePublicationInput = z.object({
  platform: z.enum(PLATFORMS),
  status: z.enum(STATUSES),
  // Shield verdict at the moment of publish — required so the server
  // can independently refuse status='published' rows the Shield blocked.
  shieldVerdict: z.enum(SHIELD_VERDICTS),
  platformPostId: z.string().max(255).nullish(),
  mockUrl: z.string().max(2048).nullish(),
  scheduledFor: z.string().datetime().nullish(),
  publishedAt: z.string().datetime().nullish(),
  error: z.string().max(2000).nullish(),
});

const UpdateMetricsInput = z.object({
  views: z.number().int().min(0),
  likes: z.number().int().min(0),
  comments: z.number().int().min(0),
  shares: z.number().int().min(0),
});

type PublicationRow = typeof schema.publications.$inferSelect;

function serialize(row: PublicationRow) {
  return {
    id: row.id,
    videoId: row.videoId,
    platform: row.platform,
    status: row.status,
    platformPostId: row.platformPostId,
    mockUrl: row.mockUrl,
    scheduledFor: row.scheduledFor?.toISOString() ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    error: row.error,
    shieldVerdict: row.shieldVerdict,
    metrics: row.metrics,
    metricsFetchedAt: row.metricsFetchedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * POST /api/videos/:id/publications
 *
 * Records one platform's publish outcome for a video. The mobile
 * Publisher calls this once per platform after `launchPublishPlan`
 * resolves. Validates the video belongs to the resolved creator so
 * one creator cannot record publications against another's videos.
 */
router.post("/videos/:id/publications", async (req, res, next) => {
  try {
    const r = await resolveCreator(req);
    if (r.kind !== "found") {
      res.status(401).json({ error: "unknown_user" });
      return;
    }
    // Compliance gate: a creator must have stamped both AI-disclosure and
    // adult-confirmation consent before any publication record can land.
    // Mirrors the gate on /agents/run-overnight so the publish path can't
    // be used as an end-run around onboarding consent.
    if (
      !r.creator.aiDisclosureConsentedAt ||
      !r.creator.adultConfirmedAt
    ) {
      res.status(403).json({ error: "consent_required" });
      return;
    }
    const videoId = req.params.id;
    const [video] = await db
      .select({ id: schema.videos.id, creatorId: schema.videos.creatorId })
      .from(schema.videos)
      .where(eq(schema.videos.id, videoId))
      .limit(1);
    if (!video || video.creatorId !== r.creator.id) {
      res.status(404).json({ error: "video_not_found" });
      return;
    }
    const parsed = CreatePublicationInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_input", details: parsed.error.format() });
      return;
    }
    const input = parsed.data;
    // Server-side compliance gate: a 'blocked' Shield verdict can never
    // co-exist with a 'published' status. The mobile Publisher should
    // already short-circuit here, but the server is the source of truth
    // for what's allowed to land in the publications log.
    if (input.shieldVerdict === "blocked" && input.status === "published") {
      res.status(409).json({ error: "shield_blocked" });
      return;
    }
    const [row] = await db
      .insert(schema.publications)
      .values({
        creatorId: r.creator.id,
        videoId,
        platform: input.platform,
        status: input.status,
        shieldVerdict: input.shieldVerdict,
        platformPostId: input.platformPostId ?? null,
        mockUrl: input.mockUrl ?? null,
        scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
        publishedAt:
          input.publishedAt != null
            ? new Date(input.publishedAt)
            : input.status === "published"
              ? new Date()
              : null,
        error: input.error ?? null,
      })
      .returning();
    res.status(201).json(serialize(row));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/videos/:id/publications
 *
 * Lists publications for a single video (most recent first).
 */
router.get("/videos/:id/publications", async (req, res, next) => {
  try {
    const r = await resolveCreator(req);
    if (r.kind !== "found") {
      res.status(401).json({ error: "unknown_user" });
      return;
    }
    const videoId = req.params.id;
    const rows = await db
      .select()
      .from(schema.publications)
      .where(
        and(
          eq(schema.publications.creatorId, r.creator.id),
          eq(schema.publications.videoId, videoId),
        ),
      )
      .orderBy(desc(schema.publications.createdAt));
    res.json({ publications: rows.map(serialize) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/publications/recent
 *
 * Recent publications across all videos for the resolved creator.
 */
router.get("/publications/recent", async (req, res, next) => {
  try {
    const r = await resolveCreator(req);
    if (r.kind !== "found") {
      res.status(401).json({ error: "unknown_user" });
      return;
    }
    const rows = await db
      .select()
      .from(schema.publications)
      .where(eq(schema.publications.creatorId, r.creator.id))
      .orderBy(desc(schema.publications.createdAt))
      .limit(50);
    res.json({ publications: rows.map(serialize) });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/videos/:id/publications/:pubId/metrics
 *
 * Stores fresh views/likes/comments/shares for a single publication.
 * The mobile app is the source of platform analytics here because it
 * holds the OAuth tokens — the server merely stamps and persists.
 */
router.patch(
  "/videos/:id/publications/:pubId/metrics",
  async (req, res, next) => {
    try {
      const r = await resolveCreator(req);
      if (r.kind !== "found") {
        res.status(401).json({ error: "unknown_user" });
        return;
      }
      const parsed = UpdateMetricsInput.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "invalid_input", details: parsed.error.format() });
        return;
      }
      const [pub] = await db
        .select()
        .from(schema.publications)
        .where(eq(schema.publications.id, req.params.pubId))
        .limit(1);
      if (
        !pub ||
        pub.creatorId !== r.creator.id ||
        pub.videoId !== req.params.id
      ) {
        res.status(404).json({ error: "publication_not_found" });
        return;
      }
      const [updated] = await db
        .update(schema.publications)
        .set({
          metrics: parsed.data,
          metricsFetchedAt: new Date(),
        })
        .where(eq(schema.publications.id, pub.id))
        .returning();
      res.json(serialize(updated));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
