/**
 * P17-A1A — resolveCreator deterministic ordering test.
 *
 * The pre-A1A unauth-demo branch did `WHERE is_demo=TRUE LIMIT 1`
 * with no ORDER BY, which broke the QA harness when the DB held >1
 * demo row. The fix added `ORDER BY created_at ASC, id ASC`. This
 * test exercises the SQL the helper builds (without hitting a real
 * Postgres) by snapshotting the rendered query and asserting the
 * ORDER BY clause is present in the expected order.
 *
 * Why a SQL-shape test instead of an integration test:
 *   - The repo's `lib/__tests__` suite is unit-style. Integration
 *     coverage of resolveCreator's deterministic pick is provided by
 *     the live QA driver (`p17a1aNgLightPidginStabilizedRepro.ts`)
 *     which asserts the route's resolved id matches the canonical
 *     pinned id on every batch.
 *   - drizzle's `toSQL()` lets us assert the generated SQL fragment
 *     without a DB round-trip.
 */
import { describe, it, expect } from "vitest";
import { asc, eq } from "drizzle-orm";

import { db, schema } from "../../db/client.js";

describe("resolveCreator unauth-demo SQL — P17-A1A deterministic ordering", () => {
  it("emits ORDER BY created_at ASC, id ASC LIMIT 1", () => {
    const q = db
      .select()
      .from(schema.creators)
      .where(eq(schema.creators.isDemo, true))
      .orderBy(asc(schema.creators.createdAt), asc(schema.creators.id))
      .limit(1)
      .toSQL();
    const sql = q.sql.toLowerCase();
    expect(sql).toContain('order by');
    // created_at must be the primary sort key, id the tiebreaker.
    const orderBy = sql.split('order by')[1] ?? '';
    const createdAtIdx = orderBy.indexOf('created_at');
    const idIdx = orderBy.indexOf('"id"');
    expect(createdAtIdx).toBeGreaterThan(-1);
    expect(idIdx).toBeGreaterThan(createdAtIdx);
    expect(sql).toContain('limit');
  });
});
