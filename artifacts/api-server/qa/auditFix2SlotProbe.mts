/**
 * Minimal probe for N1-FOLLOWUP-AUDIT-FIX-2 — verifies the
 * memory-aware per-core picker rotates slot 0 away from incumbents.
 *
 * 2 creators × 4 sequential batches each. Prints slot-0 cleanCoreEntryId
 * after each batch + final histogram. Real DB-backed creators so memory
 * persists between batches.
 */
process.env.LUMINA_NG_PACK_ENABLED = "true";
process.env.LUMINA_NG_PACK_AWARE_RETENTION_ENABLED = "true";
process.env.LUMINA_NG_MEMORY_SOFT_CAP_ENABLED = "true";
process.env.LUMINA_W2_WESTERN_APPROVED_ENABLED = "true";
process.env.LUMINA_W2M_LOCAL_FIRST_REFRESH_ENABLED = "true";
process.env.LUMINA_FALLBACK_GAP_ONLY = "true";
process.env.LUMINA_NG_STYLE_PENALTY_ENABLED = "true";
// Flag under test:
process.env.LUMINA_NG_CLEAN_SLOT0_MEMORY_AWARE_PICKER_ENABLED =
  process.env.PICKER_FLAG ?? "true";

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { eq } from "drizzle-orm";
import { runHybridIdeator } from "../src/lib/hybridIdeator.js";
import { styleProfileSchema } from "../src/lib/styleProfile.js";
import { NIGERIAN_CLEAN_CORE_ENTRIES } from "../src/lib/nigerianCleanCorePack.js";
import { db } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";

const HOOKS = NIGERIAN_CLEAN_CORE_ENTRIES.map((e) => ({
  id: e.id,
  norm: e.hook.toLowerCase().trim(),
}));

function resolveId(hook: string | undefined): string | null {
  if (!hook) return null;
  const n = hook.toLowerCase().trim();
  for (const { id, norm } of HOOKS) if (n === norm) return id;
  for (const { id, norm } of HOOKS) if (n.startsWith(norm) || n.includes(norm)) return id;
  return null;
}

const NUM_CREATORS = Number(process.env.NUM_CREATORS ?? 2);
const NUM_BATCHES = Number(process.env.NUM_BATCHES ?? 4);

const histogram: Record<string, number> = {};
const series: Array<{ creator: number; batch: number; slot0: string | null; allSlots: (string | null)[] }> = [];

async function makeCreator() {
  const id = randomUUID();
  const [created] = await db
    .insert(schema.creators)
    .values({
      id,
      authUserId: null,
      name: `audit_fix2_${id.slice(0, 8)}`,
      location: "Lagos, Nigeria",
      niche: "comedy",
      followers: 0,
      currency: "USD",
      imageKey: "stub",
      isDemo: true,
      region: "nigeria" as any,
    } as any)
    .returning();
  return created as any;
}

async function cleanup(id: string) {
  try {
    await db.delete(schema.creators).where(eq(schema.creators.id, id));
  } catch {}
}

const style = styleProfileSchema.parse({});

async function runOne(creatorIdx: number) {
  const creator = await makeCreator();
  try {
    for (let b = 0; b < NUM_BATCHES; b++) {
      const result: any = await runHybridIdeator({
        creator,
        region: "nigeria",
        styleProfile: style,
        count: 5,
        regenerate: false,
        excludeHooks: [],
        tasteCalibrationJson: { languageStyle: "clean" },
        visionStyleJson: null,
        ctx: { creatorId: creator.id, agentRunId: null },
        usageContext: { creatorId: creator.id, isDemo: true },
      } as any);
      const ideas = result?.ideas ?? result?.kept ?? [];
      const slotIds = ideas.map((i: any) => resolveId(i?.hook));
      const slot0 = slotIds[0] ?? null;
      series.push({ creator: creatorIdx, batch: b, slot0, allSlots: slotIds });
      if (slot0) histogram[slot0] = (histogram[slot0] ?? 0) + 1;
      process.stderr.write(`creator=${creatorIdx} batch=${b} slot0=${slot0 ?? "?"} all=${JSON.stringify(slotIds)}\n`);
    }
  } finally {
    await cleanup(creator.id);
  }
}

(async () => {
  process.stderr.write(`PICKER_FLAG=${process.env.LUMINA_NG_CLEAN_SLOT0_MEMORY_AWARE_PICKER_ENABLED}\n`);
  for (let i = 0; i < NUM_CREATORS; i++) await runOne(i);
  const sorted = Object.entries(histogram).sort((a, b) => b[1] - a[1]);
  const distinct = sorted.length;
  const newEntries = ["ng_clean_062", "ng_clean_063", "ng_clean_064"];
  const newCount = newEntries.reduce((s, id) => s + (histogram[id] ?? 0), 0);
  const out = {
    flag: process.env.LUMINA_NG_CLEAN_SLOT0_MEMORY_AWARE_PICKER_ENABLED,
    creators: NUM_CREATORS,
    batches_per_creator: NUM_BATCHES,
    total_batches: NUM_CREATORS * NUM_BATCHES,
    slot0_distinct_entry_ids: distinct,
    slot0_histogram: Object.fromEntries(sorted),
    new_entries_062_063_064_at_slot0: newCount,
    series,
  };
  const path = process.env.OUT_PATH ?? `.local/qa-runs/audit_fix2_probe_${process.env.LUMINA_NG_CLEAN_SLOT0_MEMORY_AWARE_PICKER_ENABLED === "true" ? "ON" : "OFF"}.json`;
  fs.mkdirSync(".local/qa-runs", { recursive: true });
  fs.writeFileSync(path, JSON.stringify(out, null, 2));
  process.stderr.write(`\n=== SUMMARY (${path}) ===\n${JSON.stringify(out, null, 2)}\n`);
  process.exit(0);
})();
