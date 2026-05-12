/**
 * P16-A6 — one-off ALTER TABLE migration helper.
 *
 * `pnpm drizzle-kit push:pg` is not on the path in this environment
 * (drizzle-kit is not installed). The slot-1+ memory column was
 * added to `schema.ts` additively; the runtime helpers swallow the
 * "column does not exist" error gracefully so production behaviour
 * does not regress when this migration has not yet been applied.
 *
 * For local QA we want the column to actually exist so the QA
 * harness can demonstrate cross-batch repetition reduction. This
 * driver issues a single idempotent ALTER TABLE.
 *
 * Run: `pnpm --filter @workspace/api-server exec tsx src/qa/p16a6Slot1PlusMigrate.ts`
 */
import { sql } from "drizzle-orm";

import { db } from "../db/client.js";

const main = async (): Promise<void> => {
  await db.execute(
    sql`ALTER TABLE creators ADD COLUMN IF NOT EXISTS nigerian_clean_core_slot1plus_seen_ids_json jsonb DEFAULT '[]'::jsonb`,
  );
  // eslint-disable-next-line no-console
  console.log(
    "P16-A6: nigerian_clean_core_slot1plus_seen_ids_json column ensured (idempotent ALTER TABLE).",
  );
  process.exit(0);
};

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("P16-A6 migration failed:", err);
  process.exit(1);
});
