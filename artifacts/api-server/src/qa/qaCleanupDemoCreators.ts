/**
 * P17-A1A — QA cleanup for stale demo creators.
 *
 * Why this exists
 * ---------------
 * The DB historically accumulated ~108 `is_demo=TRUE` rows from old
 * `qa_sweep:*` and `qa-*` test runs that were never cleaned up. The
 * pre-A1A `resolveCreator` did `WHERE is_demo=TRUE LIMIT 1` with no
 * `ORDER BY`, so an unauth demo curl could resolve to *any* of those
 * rows. The QA driver pinned its read row while the route resolved
 * a different demo for write — memory probes always read 0.
 *
 * `resolveCreator` is now deterministic (`ORDER BY created_at ASC,
 * id ASC` — picks "Alex"), but the stale qa_sweep rows are still
 * sitting around with `is_demo=TRUE` and pollute any future QA tool
 * that does its own un-ordered demo lookup. This script flips them
 * to `is_demo=FALSE` so they fall out of every demo-row consideration.
 *
 * Behaviour
 * ---------
 *   • Default: DRY-RUN. Prints counts, lists candidate rows, prints
 *     the canonical demo row resolveCreator would pick, exits 0.
 *     No DB writes.
 *   • `--apply`: actually flips matched rows to `is_demo=FALSE`.
 *     Idempotent (re-run on a clean DB is a no-op). Reports rows
 *     changed.
 *
 * Safety rails
 * ------------
 *   • `is_demo=FALSE` flip, NOT delete. Reversible. No FK / history
 *     impact: the rows stay queryable, just stop being picked by
 *     the unauth demo branch.
 *   • Hard-coded filter: name LIKE `qa_sweep:%` OR name LIKE `qa-%`.
 *     Will not match the canonical Alex row (name = `Alex`).
 *   • Will refuse to flip the canonical demo (defence-in-depth: if
 *     somehow a row with name "Alex" matched the prefix filter, it
 *     would be excluded).
 *
 * Run
 * ---
 *   pnpm --filter @workspace/api-server exec tsx \
 *     src/qa/qaCleanupDemoCreators.ts            # dry-run
 *   pnpm --filter @workspace/api-server exec tsx \
 *     src/qa/qaCleanupDemoCreators.ts --apply    # actually modify
 */
import { and, asc, eq, ne, or, like, sql } from "drizzle-orm";

import { db, schema } from "../db/client.js";

const QA_NAME_PATTERNS = ["qa_sweep:%", "qa-%"] as const;

async function main() {
  const apply = process.argv.includes("--apply");

  // 1. Total demo count, before.
  const [{ totalBefore }] = await db
    .select({ totalBefore: sql<number>`count(*)::int` })
    .from(schema.creators)
    .where(eq(schema.creators.isDemo, true));

  // 2. Canonical demo row resolveCreator picks. Mirrors the
  //    deterministic ordering exactly.
  const canonical = (
    await db
      .select({
        id: schema.creators.id,
        name: schema.creators.name,
        createdAt: schema.creators.createdAt,
      })
      .from(schema.creators)
      .where(eq(schema.creators.isDemo, true))
      .orderBy(asc(schema.creators.createdAt), asc(schema.creators.id))
      .limit(1)
  )[0];

  // 3. Candidate rows for flip.
  const candidates = await db
    .select({
      id: schema.creators.id,
      name: schema.creators.name,
      createdAt: schema.creators.createdAt,
    })
    .from(schema.creators)
    .where(
      and(
        eq(schema.creators.isDemo, true),
        or(
          like(schema.creators.name, QA_NAME_PATTERNS[0]),
          like(schema.creators.name, QA_NAME_PATTERNS[1]),
        ),
        // Defence-in-depth: never touch the canonical row.
        canonical ? ne(schema.creators.id, canonical.id) : sql`true`,
      ),
    )
    .orderBy(asc(schema.creators.name));

  console.log("=== qaCleanupDemoCreators ===");
  console.log(`mode:                  ${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`totalDemoBefore:       ${totalBefore}`);
  console.log(`patternFilter:         name LIKE 'qa_sweep:%' OR 'qa-%'`);
  console.log(
    `canonicalDemo:         ${canonical ? `${canonical.id}  name=${canonical.name}` : "(none)"}`,
  );
  console.log(`candidateRowsToFlip:   ${candidates.length}`);
  if (candidates.length > 0) {
    console.log("--- candidates (first 20) ---");
    for (const c of candidates.slice(0, 20)) {
      console.log(`  ${c.id}  ${c.name}`);
    }
    if (candidates.length > 20) {
      console.log(`  ... + ${candidates.length - 20} more`);
    }
  }

  if (!apply) {
    console.log("\nDRY-RUN. No rows modified. Re-run with --apply to flip.");
    return;
  }

  if (!canonical) {
    console.log(
      "\nABORT: no canonical demo row resolved. Refusing to flip without a known canonical.",
    );
    process.exit(2);
  }

  if (candidates.length === 0) {
    console.log("\nNothing to do (already clean).");
    return;
  }

  // 4. Flip in a single statement; same filter, idempotent.
  const result = await db
    .update(schema.creators)
    .set({ isDemo: false })
    .where(
      and(
        eq(schema.creators.isDemo, true),
        or(
          like(schema.creators.name, QA_NAME_PATTERNS[0]),
          like(schema.creators.name, QA_NAME_PATTERNS[1]),
        ),
        ne(schema.creators.id, canonical.id),
      ),
    )
    .returning({ id: schema.creators.id, name: schema.creators.name });

  const [{ totalAfter }] = await db
    .select({ totalAfter: sql<number>`count(*)::int` })
    .from(schema.creators)
    .where(eq(schema.creators.isDemo, true));

  console.log(`\nrowsFlipped:           ${result.length}`);
  console.log(`totalDemoAfter:        ${totalAfter}`);
  console.log(`expectedDemoAfter:     1 (canonical only)`);
  console.log(
    totalAfter === 1
      ? "OK — exactly one demo row remains (the canonical)."
      : `NOTE — ${totalAfter} demo rows remain; non-qa_sweep demos were not touched.`,
  );
}

main().catch((err) => {
  console.error("qaCleanupDemoCreators failed:", err);
  process.exit(1);
});
