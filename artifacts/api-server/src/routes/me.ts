import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/client";
import { resolveCreator } from "../lib/resolveCreator";

const router: IRouter = Router();

/**
 * /api/me/* — creator-self compliance + privacy surface.
 *
 * Three responsibilities live here:
 *   1. Consent state    — FTC AI-disclosure + COPPA adult gate.
 *   2. Schedule prefs   — opt-in to the nightly swarm + local hour/tz.
 *   3. Data rights      — GDPR/CCPA export + delete-my-data.
 */

const ConsentInput = z.object({
  aiDisclosureConsented: z.boolean(),
  adultConfirmed: z.boolean(),
});

router.get("/me/consent", async (req, res, next) => {
  try {
    const r = await resolveCreator(req);
    if (r.kind !== "found") {
      res.status(401).json({ error: "unknown_user" });
      return;
    }
    res.json({
      aiDisclosureConsentedAt:
        r.creator.aiDisclosureConsentedAt?.toISOString() ?? null,
      adultConfirmedAt: r.creator.adultConfirmedAt?.toISOString() ?? null,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/me/consent", async (req, res, next) => {
  try {
    const r = await resolveCreator(req);
    if (r.kind !== "found") {
      res.status(401).json({ error: "unknown_user" });
      return;
    }
    const parsed = ConsentInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_input", details: parsed.error.format() });
      return;
    }
    const now = new Date();
    // Withdrawing consent (false) clears the timestamp; granting (true)
    // stamps now. We never overwrite an existing grant with the same
    // value to preserve the original consent moment for audit.
    const patch: Partial<typeof schema.creators.$inferInsert> = {};
    if (parsed.data.aiDisclosureConsented) {
      if (!r.creator.aiDisclosureConsentedAt) patch.aiDisclosureConsentedAt = now;
    } else {
      patch.aiDisclosureConsentedAt = null;
    }
    if (parsed.data.adultConfirmed) {
      if (!r.creator.adultConfirmedAt) patch.adultConfirmedAt = now;
    } else {
      patch.adultConfirmedAt = null;
    }
    if (Object.keys(patch).length > 0) {
      await db
        .update(schema.creators)
        .set(patch)
        .where(eq(schema.creators.id, r.creator.id));
    }
    const [fresh] = await db
      .select()
      .from(schema.creators)
      .where(eq(schema.creators.id, r.creator.id))
      .limit(1);
    res.json({
      aiDisclosureConsentedAt:
        fresh?.aiDisclosureConsentedAt?.toISOString() ?? null,
      adultConfirmedAt: fresh?.adultConfirmedAt?.toISOString() ?? null,
    });
  } catch (err) {
    next(err);
  }
});

const ScheduleInput = z.object({
  enabled: z.boolean(),
  hour: z.number().int().min(0).max(23).nullable(),
  tz: z.string().max(64).nullable(),
});

router.get("/me/schedule", async (req, res, next) => {
  try {
    const r = await resolveCreator(req);
    if (r.kind !== "found") {
      res.status(401).json({ error: "unknown_user" });
      return;
    }
    res.json({
      enabled: r.creator.nightlySwarmEnabled,
      hour: r.creator.nightlySwarmHour,
      tz: r.creator.nightlySwarmTz,
      lastRunAt: r.creator.lastNightlyRunAt?.toISOString() ?? null,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/me/schedule", async (req, res, next) => {
  try {
    const r = await resolveCreator(req);
    if (r.kind !== "found") {
      res.status(401).json({ error: "unknown_user" });
      return;
    }
    const parsed = ScheduleInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_input", details: parsed.error.format() });
      return;
    }
    // Enabling without consent is rejected — the nightly swarm produces
    // AI content, which the user must have actively disclosed first.
    if (
      parsed.data.enabled &&
      (!r.creator.aiDisclosureConsentedAt || !r.creator.adultConfirmedAt)
    ) {
      res.status(403).json({ error: "consent_required" });
      return;
    }
    await db
      .update(schema.creators)
      .set({
        nightlySwarmEnabled: parsed.data.enabled,
        nightlySwarmHour: parsed.data.hour,
        nightlySwarmTz: parsed.data.tz,
      })
      .where(eq(schema.creators.id, r.creator.id));
    res.json({
      enabled: parsed.data.enabled,
      hour: parsed.data.hour,
      tz: parsed.data.tz,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GDPR/CCPA data export — every row owned by this creator, returned as
 * a single JSON document. Not paginated by design (creators aren't
 * data-warehouse scale), and the response is `Content-Disposition:
 * attachment` so a browser save-as does the right thing.
 */
router.post("/me/data-export", async (req, res, next) => {
  try {
    const r = await resolveCreator(req);
    if (r.kind !== "found") {
      res.status(401).json({ error: "unknown_user" });
      return;
    }
    const cid = r.creator.id;
    const [trends, vids, deals, ledger, runs, pubs] = await Promise.all([
      db.select().from(schema.trendBriefs).where(eq(schema.trendBriefs.creatorId, cid)),
      db.select().from(schema.videos).where(eq(schema.videos.creatorId, cid)),
      db.select().from(schema.brandDeals).where(eq(schema.brandDeals.creatorId, cid)),
      db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.creatorId, cid)),
      db.select().from(schema.agentRuns).where(eq(schema.agentRuns.creatorId, cid)),
      db.select().from(schema.publications).where(eq(schema.publications.creatorId, cid)),
    ]);
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="lumina-export-${cid}.json"`,
    );
    res.json({
      exportedAt: new Date().toISOString(),
      creator: r.creator,
      trends,
      videos: vids,
      brandDeals: deals,
      ledgerEntries: ledger,
      agentRuns: runs,
      publications: pubs,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/me/data-delete", async (req, res, next) => {
  try {
    const r = await resolveCreator(req);
    if (r.kind !== "found") {
      res.status(401).json({ error: "unknown_user" });
      return;
    }
    // ON DELETE CASCADE on every owning FK wipes children automatically.
    await db.delete(schema.creators).where(eq(schema.creators.id, r.creator.id));
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

export default router;
